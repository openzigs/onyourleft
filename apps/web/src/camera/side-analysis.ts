// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The tablet's analysis of the side camera: each picture looked at as it
 * arrives, dropped at once, and only numbers kept** —
 * [#530](https://github.com/openzigs/onyourleft/issues/530),
 * [ADR 0033](../../../../docs/adr/0033-side-camera-link.md) D-3, D-6 and D-7.
 *
 * One per pairing, made with it by `side-link.ts` §`sidePairingPort` and
 * ended with it. It listens to the link's pictures and to the phone's state,
 * and it does five things:
 *
 * 1. **Looks at each picture as it arrives**, with the pose model on this
 *    tablet (`pose-estimator.ts`), during the ride — the owner's ruling on
 *    #527, which replaced #530's own *"after the ride"* criterion.
 * 2. **Keeps at most one picture waiting.** A newer arrival replaces the
 *    waiting one and the drop is counted (D-6: *"the newest survives"*,
 *    `simulation-writer.ts`'s rule applied to pictures). A queue of
 *    photographs is refused, so a tablet that falls behind drops pictures and
 *    never lets the ride stutter.
 * 3. **Keeps pose numbers, and never a picture.** A picture's bytes are handed
 *    to the model and not held here after that; what is kept is the near
 *    side's landmark positions, keyed by the picture's sequence number and
 *    milliseconds **and nothing else** — no arrival time, no wall clock, no
 *    offset into the ride (D-3: *"the camera stands alone"*). Nothing in this
 *    file reads a clock.
 * 4. **Runs the framing check** (D-7) once enough pictures have a rider in
 *    them, against the reference stored from the rider's last session, and
 *    tells the phone the verdict.
 * 5. **Stores this session's placement as the next session's reference** when
 *    it ends, if it saw enough of the rider to have one **and its framing
 *    check passed or had nothing to check against** (#388) — with whether this
 *    session's framing check passed on the same row (D-7's record).
 *
 * ## What it does not do: send the pictures to the rider's own computer
 *
 * ADR 0033 D-11 lets a rider choose their own computer (#387) as the analyser
 * instead of this tablet. It is not built:
 * [#553](https://github.com/openzigs/onyourleft/issues/553) says why — #387's
 * transport returns a description, not pose numbers, and what the computer is
 * asked is the owner's to decide. Nothing on this path reaches a network.
 *
 * ## Nothing is said about a body during the ride (D-6)
 *
 * {@link SideAnalysisState} is counts and the framing check, which is a
 * statement about where a tripod stands. The pose numbers are read by
 * {@link SideAnalysis.poseSamples}, whose one intended reader is the post-ride
 * report ([#388](https://github.com/openzigs/onyourleft/issues/388)), and
 * every sentence that report says is bound by ADR 0030 — differences only,
 * sagittal only, uncertainty in the same sentence. **This file reports no
 * quantity about a body at all**, which is how #530's ADR 0030 criterion is
 * met here: there is nothing for it to bind yet.
 *
 * ## The reference moves forward only on a passing check (#388)
 *
 * ⚠️ **#555 built "every session becomes the next reference", and a reader
 * who remembers that is reading the old file.** The owner's ruling on #388
 * (2026-09-26): a session's placement becomes the next reference only when
 * its framing check was `matches`, or when there was no reference yet
 * (`no-reference`, the first session). A session that `differs`, or was
 * `not-checked`, leaves the previous reference where it is. The reason is the
 * review's drift concern: a tripod that creeps a little every session used to
 * reset the baseline it was being checked against, so it never failed.
 * {@link REFERENCE_MOVES_ON} is the rule, and `side-analysis.test.ts` holds
 * each of the four outcomes to it.
 *
 * ## What it hands the post-ride report (#388)
 *
 * When the session ends, the pose numbers are reduced by `side-report.ts` to
 * the report's SENTENCES — words, no numbers, sagittal only — and those are
 * handed to `side-report-port.ts` §`SideReportSession`, which saves them with
 * the ride. The numbers themselves are never handed on and never saved.
 */

import type { AthleteId, FramingCheckRecord, FramingReferenceRecord } from '@onyourleft/store';

import {
  FRAMING_LANDMARKS,
  framingReferenceFrom,
  framingVerdict,
  type FramingLandmark,
  type FramingReference,
} from './framing';
import type {
  SideAnalysisPort,
  SideAnalysisState,
  SidePose,
  SidePoseEstimator,
  SidePoseOutcome,
} from './side-analysis-port';
import type { SidePicture } from './side-link-pictures';
import { sideReportFrom } from './side-report';
import type { SideReportKeepingPort, SideReportSession } from './side-report-port';
import type { SideCameraControlPort } from './side-pairing-port';

/**
 * How many pictures with a rider in them the framing check waits for: ten,
 * which is two seconds at ADR 0033 D-3's five a second.
 *
 * ## Provenance — ⚠️ the author's choice, not a measurement
 *
 * One picture is one pedal stroke's worth of a pose, and the check is about
 * where the tripod is, not where a knee is at one instant; the median of ten
 * spread over two seconds takes in most of a pedal revolution at a normal
 * cadence and is still early enough in a session to tell the rider before
 * much has been filmed. #385's repeatability measurement is what would move
 * it. It is also the least a session must see before its placement is kept
 * as the next session's reference.
 */
export const FRAMING_CHECK_POSES = 10;

/**
 * The most poses one session keeps: three hours at five a second.
 *
 * A bound rather than a limit anybody should meet — a numbers-only pose is a
 * few hundred bytes, so this is some tens of megabytes at worst — because a
 * tablet left filming overnight should not grow a list without end.
 *
 * ⚠️ **Past it the kept poses are THINNED, not truncated** (#561's review).
 * They used to stop being kept, so a four-hour session's "last third" was the
 * last third of its first three hours, and the report told the rider it was
 * the session's. {@link PoseSamples} keeps every other pose when it fills and
 * then keeps one in twice as many, so what is kept always spans the whole
 * session at an even spacing and the thirds are the session's own.
 */
export const MAXIMUM_POSE_SAMPLES = 3 * 60 * 60 * 5;

/**
 * A session's kept poses, bounded by thinning rather than by truncation — see
 * {@link MAXIMUM_POSE_SAMPLES}.
 *
 * Every kept pose is the `k × stride`-th pose offered, for one stride: when
 * the list is full, every other kept pose is dropped and the stride doubles.
 * So the kept poses are evenly spaced over everything offered so far, the
 * first is always the first offered (the framing check reads the first
 * {@link FRAMING_CHECK_POSES}, long before any thinning), and at most
 * `maximum` are held.
 */
export class PoseSamples {
  readonly #maximum: number;
  readonly #kept: SidePoseSample[] = [];
  #stride = 1;
  #offered = 0;

  constructor(maximum: number = MAXIMUM_POSE_SAMPLES) {
    if (!Number.isInteger(maximum) || maximum < 2) {
      throw new RangeError('a pose sample bound must be a whole number of at least two');
    }
    this.#maximum = maximum;
  }

  /** The kept poses, oldest first. */
  get kept(): readonly SidePoseSample[] {
    return this.#kept;
  }

  /** Offer the next pose; it is kept if it falls on the current stride. */
  offer(sample: SidePoseSample): void {
    const index = this.#offered;
    this.#offered += 1;
    if (index % this.#stride !== 0) {
      return;
    }
    if (this.#kept.length >= this.#maximum) {
      let write = 0;
      for (let read = 0; read < this.#kept.length; read += 2) {
        const each = this.#kept[read];
        if (each !== undefined) {
          this.#kept[write] = each;
          write += 1;
        }
      }
      this.#kept.length = write;
      this.#stride *= 2;
      if (index % this.#stride !== 0) {
        return;
      }
    }
    this.#kept.push(sample);
  }
}

/**
 * One picture's pose, as the report will read it.
 *
 * ⚠️ **Exactly these keys.** `side-analysis.test.ts` pins the key set, so an
 * arrival time added here is a red test (D-3).
 */
export interface SidePoseSample {
  /** The picture's sequence number, from the phone. */
  readonly sequence: number;
  /** Milliseconds since the phone began filming, from the phone. */
  readonly milliseconds: number;
  readonly pose: SidePose;
}

/**
 * The framing outcomes after which this session's placement becomes the next
 * session's reference — the owner's ruling on #388: a passing check, or a
 * first session with nothing to check against. `differs` and `not-checked`
 * keep the previous reference.
 */
export const REFERENCE_MOVES_ON: readonly FramingCheckRecord[] = ['matches', 'no-reference'];

/** Where the rider's framing reference is kept, and whose it is. */
export interface FramingReferenceKeeping {
  readonly store: {
    getFramingReference(owner: AthleteId): Promise<FramingReferenceRecord | undefined>;
    putFramingReference(record: FramingReferenceRecord): Promise<void>;
  };
  readonly athleteId: AthleteId;
}

/** How one is made. */
export interface SideAnalysisOptions {
  readonly control: SideCameraControlPort;
  /** The pose model, made on the first picture — `pose-estimator.ts` in production. */
  readonly estimator: () => SidePoseEstimator;
  /** Where the reference lives. Without it there is no check and nothing is kept between sessions. */
  readonly references?: FramingReferenceKeeping | undefined;
  /**
   * Where this pairing's post-ride report goes when it ends (#388) —
   * `side-report-keeper.ts` in production. Without it no report is made.
   */
  readonly reports?: SideReportKeepingPort | undefined;
}

/** The analysis of one pairing's pictures. */
export class SideAnalysis implements SideAnalysisPort {
  readonly #control: SideCameraControlPort;
  readonly #makeEstimator: () => SidePoseEstimator;
  readonly #references: FramingReferenceKeeping | undefined;
  readonly #listeners = new Set<() => void>();
  readonly #unsubscribe: (() => void)[] = [];
  readonly #poses = new PoseSamples();
  readonly #report: SideReportSession | undefined;

  #estimator: SidePoseEstimator | undefined;
  #busy = false;
  /** The one picture waiting for the model, if any (D-6). */
  #waiting: SidePicture | undefined;
  #reference: FramingReference | undefined;
  #referenceAsked = false;
  #state: SideAnalysisState = {
    model: 'waiting',
    posed: 0,
    noRider: 0,
    unreadable: 0,
    skipped: 0,
    framing: 'checking',
    finished: false,
  };

  constructor(options: SideAnalysisOptions) {
    this.#control = options.control;
    this.#makeEstimator = options.estimator;
    this.#references = options.references;
    this.#report = options.reports?.beginSideReportSession();
    if (this.#references === undefined) {
      this.#state = { ...this.#state, framing: 'no-reference' };
    }
    this.#unsubscribe.push(
      this.#control.onSideCameraPicture((picture) => {
        this.#arrive(picture);
      }),
      this.#control.onSideControlChange(() => {
        this.#controlChanged();
      }),
    );
  }

  sideAnalysisState(): SideAnalysisState {
    return this.#state;
  }

  onSideAnalysisChange(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  /**
   * Every pose kept this session, in the order the model finished them — the
   * post-ride report's input (#388). Numbers only; see {@link SidePoseSample}.
   */
  poseSamples(): readonly SidePoseSample[] {
    return this.#poses.kept;
  }

  #controlChanged(): void {
    const { phone, ended } = this.#control.sideControlState();
    if (!this.#referenceAsked && (phone === 'framing' || phone === 'filming')) {
      // The phone is proved and its camera is on: it can draw the outline.
      this.#referenceAsked = true;
      void this.#shareReference();
    }
    if (ended !== undefined || phone === 'stopped') {
      this.#finish();
    }
  }

  async #shareReference(): Promise<void> {
    const keeping = this.#references;
    if (keeping === undefined) {
      return;
    }
    let stored: FramingReferenceRecord | undefined;
    try {
      stored = await keeping.store.getFramingReference(keeping.athleteId);
    } catch {
      stored = undefined;
    }
    // Read back through the same decoder the phone uses: a stored row that is
    // not a reference this build understands is no reference at all.
    const reference =
      stored === undefined
        ? undefined
        : framingReferenceFrom({ aspect: stored.aspect, landmarks: stored.landmarks });
    if (this.#state.finished) {
      return;
    }
    if (reference === undefined) {
      this.#set({ framing: 'no-reference' });
      return;
    }
    this.#reference = reference;
    this.#control.shareFramingReference(reference);
    this.#check();
  }

  #arrive(picture: SidePicture): void {
    if (this.#state.finished || this.#state.model === 'unavailable') {
      return;
    }
    if (this.#busy) {
      if (this.#waiting !== undefined) {
        this.#set({ skipped: this.#state.skipped + 1 });
      }
      this.#waiting = picture;
      return;
    }
    void this.#look(picture);
  }

  async #look(picture: SidePicture): Promise<void> {
    this.#busy = true;
    this.#estimator ??= this.#makeEstimator();
    if (this.#state.model === 'waiting') {
      this.#set({ model: 'loading' });
    }
    const outcome = await this.#estimator.estimateSidePose(picture.bytes);
    if (this.#state.finished) {
      this.#busy = false;
      return;
    }
    this.#record(picture, outcome);
    const next = this.#waiting;
    this.#waiting = undefined;
    if (next !== undefined && this.#state.model !== 'unavailable') {
      void this.#look(next);
      return;
    }
    this.#busy = false;
  }

  #record(picture: SidePicture, outcome: SidePoseOutcome): void {
    switch (outcome.kind) {
      case 'pose':
        this.#poses.offer({
          sequence: picture.sequence,
          milliseconds: picture.milliseconds,
          pose: outcome.pose,
        });
        this.#set({ model: 'ready', posed: this.#state.posed + 1 });
        this.#check();
        return;
      case 'no-rider':
        this.#set({ model: 'ready', noRider: this.#state.noRider + 1 });
        return;
      case 'unreadable':
        this.#set({ model: 'ready', unreadable: this.#state.unreadable + 1 });
        return;
      case 'unavailable':
        this.#waiting = undefined;
        this.#set({ model: 'unavailable' });
        return;
    }
  }

  /** D-7's check, once, as soon as there is a reference and enough of the rider. */
  #check(): void {
    if (
      this.#state.framing !== 'checking' ||
      this.#reference === undefined ||
      this.#poses.kept.length < FRAMING_CHECK_POSES
    ) {
      return;
    }
    const placement = placementOf(this.#poses.kept.slice(0, FRAMING_CHECK_POSES));
    const verdict =
      placement === undefined ? 'differs' : framingVerdict(this.#reference, placement);
    this.#control.shareFramingVerdict(verdict);
    this.#set({ framing: verdict });
  }

  #finish(): void {
    if (this.#state.finished) {
      return;
    }
    this.#waiting = undefined;
    for (const unsubscribe of this.#unsubscribe.splice(0)) {
      unsubscribe();
    }
    this.#estimator?.closeSidePoseModel();
    const framing = this.#state.framing === 'checking' ? 'not-checked' : this.#state.framing;
    this.#set({ finished: true, framing });
    this.#keepReference(framing);
    // #388: the report's sentences, and nothing they were made from, go to
    // the ride this session filmed. The samples stay here, in memory only.
    this.#report?.endSideReportSession(sideReportFrom(this.#poses.kept, this.#state));
  }

  /**
   * This session's placement, as the next session's reference when
   * {@link REFERENCE_MOVES_ON} says it may be — and, on the
   * same row and in the same put, whether this session's framing check passed
   * (D-7: *"Whether the check passed is stored with the session's numbers.
   * That record is what the report reads when it decides whether a
   * cross-session sentence is permitted."*). One put, so the verdict and the
   * placement cannot describe two different sessions.
   */
  #keepReference(check: FramingCheckRecord): void {
    const keeping = this.#references;
    if (
      keeping === undefined ||
      !REFERENCE_MOVES_ON.includes(check) ||
      this.#poses.kept.length < FRAMING_CHECK_POSES
    ) {
      return;
    }
    const placement = placementOf(this.#poses.kept);
    if (placement === undefined) {
      return;
    }
    keeping.store
      .putFramingReference({
        athleteId: keeping.athleteId,
        aspect: placement.aspect,
        landmarks: placement.landmarks,
        check,
      })
      .catch(() => {
        // Nothing of the error is read (ADR 0029 D-8, and a storage error names
        // the key it could not write). The next session finds the old
        // reference, or none, and says so; nothing is lost but a comparison.
      });
  }

  #set(change: Partial<SideAnalysisState>): void {
    this.#state = { ...this.#state, ...change };
    for (const listener of [...this.#listeners]) {
      listener();
    }
  }
}

/**
 * Where the rider sat across `samples`: for each framing landmark seen in at
 * least half of them, the median of its position; and the median picture
 * shape. `undefined` when no landmark was seen often enough.
 *
 * The median rather than the mean because a pedalling leg sweeps a circle and
 * the model occasionally misplaces a point, and one wild point must not move
 * a tripod's placement.
 */
export function placementOf(samples: readonly SidePoseSample[]): FramingReference | undefined {
  if (samples.length === 0) {
    return undefined;
  }
  const landmarks: (FramingReference['landmarks'][number] & { name: FramingLandmark })[] = [];
  for (const name of FRAMING_LANDMARKS) {
    const seen = samples.flatMap((sample) =>
      sample.pose.landmarks.filter((mark) => mark.name === name),
    );
    if (seen.length * 2 < samples.length) {
      continue;
    }
    landmarks.push({
      name,
      x: median(seen.map((mark) => mark.x)),
      y: median(seen.map((mark) => mark.y)),
    });
  }
  if (landmarks.length === 0) {
    return undefined;
  }
  return { aspect: median(samples.map((sample) => sample.pose.aspect)), landmarks };
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[middle] ?? 0)
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}
