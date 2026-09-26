// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The side camera's post-ride report: what changed between the start and
 * the end of one session, in words, sagittal only** —
 * [#388](https://github.com/openzigs/onyourleft/issues/388),
 * [ADR 0030](../../../../docs/adr/0030-what-the-app-may-say-about-a-body.md),
 * [ADR 0033](../../../../docs/adr/0033-side-camera-link.md) D-6.
 *
 * Pure. The pose numbers a session kept (`side-analysis.ts`
 * §`SidePoseSample`) in, sentences out. Nothing here reads a clock, a store or
 * a picture, and nothing here can reach a trainer — `side-report-safety.test.ts`
 * holds that in the module graph.
 *
 * ## What it compares, and why only that
 *
 * **The first third of the session's posed pictures against its last third,
 * on the same camera.** ADR 0030 R1: a quantity is reported only as a change
 * between two things this app observed. A systematic error that is constant
 * across one session — the camera not quite side-on, the lens, the tripod's
 * height — is in both thirds and cancels out of a difference; it does not
 * cancel out of a standing value, which is why there is none.
 *
 * ⚠️ **Within ONE session only.** A comparison with an earlier session needs
 * that session's pose numbers, which are never kept (the owner's retention
 * ruling on #388 keeps sentences only), and ADR 0033 D-7 permits one only when
 * the framing check passed. The owner put cross-session comparison out of
 * scope for this issue; it needs its own issue and ruling.
 *
 * ## The five observations — the owner's list, and nothing across the rider
 *
 * Measured in the picture's own plane, in the rider's facing direction:
 *
 * | Kind | What is compared | Statistic per third |
 * |---|---|---|
 * | `torso` | the line from hip to shoulder, above the horizontal | median |
 * | `knee` | the angle at the knee between thigh and shin | the {@link BOTTOM_OF_STROKE_QUANTILE} quantile — the leg at its straightest, which is the bottom of the stroke |
 * | `elbow` | the angle at the elbow between upper arm and forearm | median |
 * | `head` | the ear ahead of the shoulder, as a share of the torso's length | median |
 * | `saddle` | the hip ahead of the centre of the ankle's circle, as a share of the thigh's length | median of the hip, mean of the ankle |
 *
 * ⚠️ **Every one is along the rider, never across them** (ADR 0030 D-4). No
 * hip drop, no knee tracking, no sway: a single sagittal camera is not
 * imprecise about the frontal plane, it is wrong about it by an order of
 * magnitude.
 *
 * ## Degrees are computed and never rendered
 *
 * {@link ObservedChange} carries the difference in degrees, because a future
 * report with a measured spread may show one (ADR 0030 R1 and R8). Until
 * [#385](https://github.com/openzigs/onyourleft/issues/385)'s accuracy half
 * measures that spread, {@link MEASURED_SPREAD_DEGREES} is `undefined` and
 * {@link renderableChanges} returns nothing — the owner's ruling: *"`ObservedChange`
 * with degrees is not rendered until the spread exists. Keep the type and gate
 * it on a measured spread constant that is absent today."* And even then an
 * ABSOLUTE angle never is: there is deliberately no `absoluteDegrees` anywhere
 * here, and `no-absolute-angles.test.ts` fails the build on a degree sign in
 * any string the client renders.
 */

import type { SidePose, SidePoseLandmark } from './side-analysis-port';
import {
  SIDE_OBSERVATION_KINDS,
  SIDE_OBSERVATION_SENTENCES,
  SIDE_REPORT_NO_MODEL,
  SIDE_REPORT_OBSERVED,
  SIDE_REPORT_TOO_SHORT,
  SIDE_REPORT_UNCHANGED,
  SIDE_REPORT_UNCHANGED_IN_PART,
  SIDE_REPORT_UNREADABLE,
  type SideChangeDirection,
  type SideObservationKind,
} from './side-report-wording';

/** What the report reads: one picture's pose and when it was taken. The shape of `side-analysis.ts` §`SidePoseSample`. */
export interface SideReportSample {
  readonly milliseconds: number;
  readonly pose: SidePose;
}

/** How a session's pictures came out, from `side-analysis-port.ts` §`SideAnalysisState`. */
export interface SideReportLooked {
  readonly model: 'waiting' | 'loading' | 'ready' | 'unavailable';
  readonly posed: number;
  readonly noRider: number;
  readonly unreadable: number;
}

/** What the report says: always one summary, and zero or more observations. Sentences only. */
export interface SideReport {
  readonly summary: string;
  readonly observations: readonly string[];
}

/**
 * A change, never a state — the owner's ruling keeps this type and does not
 * render it. There is deliberately no `absoluteDegrees`.
 */
export interface ObservedChange {
  readonly what: 'knee' | 'torso' | 'elbow';
  /** Late third minus early third. */
  readonly deltaDegrees: number;
  /** From #385's measured spread. Never invented — see {@link MEASURED_SPREAD_DEGREES}. */
  readonly spreadDegrees: number;
  readonly between: readonly ['first third of the session', 'last third of the session'];
}

/**
 * The session-internal spread of a within-session difference at this camera
 * placement, in degrees — **`undefined`, because nobody has measured it**.
 *
 * ## Provenance — ⚠️ absent on purpose
 *
 * #388's criterion: *"a confidence or uncertainty statement accompanies every
 * number, sourced from the Phase C spike's measured session-internal spread —
 * not invented, and not omitted."* That spike is
 * [#385](https://github.com/openzigs/onyourleft/issues/385)'s accuracy half and
 * has not been run. So there is no spread, and while there is none
 * {@link renderableChanges} renders no number. Setting this is #385's to do,
 * with the measurement cited here.
 */
export const MEASURED_SPREAD_DEGREES: number | undefined = undefined;

/**
 * The shortest session the report will compare: six minutes between its first
 * and last posed picture, so each third is two minutes.
 *
 * ## Provenance — ⚠️ a provisional choice, not a measurement
 *
 * Two minutes is about two hundred pedal strokes at a steady cadence, which is
 * enough for a median or a quantile over a third not to be one stroke's
 * posture, and short enough that an hour's ride is always long enough.
 * #385's repeatability measurement is what would move it.
 * `SIDE_REPORT_TOO_SHORT` says "about six minutes", and a test holds the two
 * together.
 */
export const MINIMUM_SESSION_MILLISECONDS = 6 * 60 * 1000;

/**
 * The fewest usable poses a third must hold for a kind to be compared at all:
 * thirty, six seconds of pictures at ADR 0033 D-3's five a second.
 *
 * ## Provenance — ⚠️ a provisional choice, not a measurement
 *
 * Below this a third is a few strokes, and a quantile over a few strokes is a
 * posture, not a trend. A kind whose landmarks were missing too often is left
 * out rather than guessed at.
 */
export const MINIMUM_POSES_PER_THIRD = 30;

/**
 * The share of a session's looked-at pictures that must come to a pose for the
 * report to try at all: a half.
 *
 * ## Provenance — ⚠️ a provisional choice, not a measurement
 *
 * A session where most pictures had nobody usable in them is a camera that
 * was pointed wrong, and a comparison of the few it did read would be a
 * comparison of whatever moments the rider happened to lean into frame.
 */
export const MINIMUM_POSED_SHARE = 0.5;

/**
 * The quantile of the knee's angle taken as "the bottom of the stroke": 0.9.
 *
 * ## Provenance — ⚠️ a provisional choice, not a measurement
 *
 * The knee is straightest at the bottom of the stroke, so its largest angles
 * over a third are that moment; the maximum would be one mislabelled picture,
 * so a high quantile stands in for it.
 */
export const BOTTOM_OF_STROKE_QUANTILE = 0.9;

/**
 * How much each kind must change between the thirds before the report says it
 * **possibly** did.
 *
 * ## Provenance — ⚠️ provisional choices, not measurements
 *
 * The owner's ruling on #388: *"the thresholds that trigger one are constants
 * whose reason says they are provisional choices, not measurements."* Each is
 * set well above what one noisy picture could move a median by, and none is
 * derived from #385, which has not run. The angle thresholds are about half the
 * per-picture knee error a four-camera research rig measured during cycling
 * (Kakavand et al. 2025, ~9–10°, as ADR 0030 D-3 cites) — a difference of
 * medians over hundreds of pictures is steadier than one picture, but not
 * steadier than that has been shown to be here. The two shares are a twentieth
 * of a body segment.
 */
export const OBSERVATION_THRESHOLDS: Readonly<Record<SideObservationKind, number>> = {
  /** Degrees of the hip-to-shoulder line. */
  torso: 5,
  /** Degrees at the knee, at the bottom of the stroke. */
  knee: 5,
  /** Degrees at the elbow. */
  elbow: 8,
  /** Share of the torso's length. */
  head: 0.06,
  /** Share of the thigh's length. */
  saddle: 0.05,
};

/**
 * What a session came to, as sentences — or `undefined` when nothing was
 * looked at at all (a pairing that never filmed has nothing to report).
 */
export function sideReportFrom(
  samples: readonly SideReportSample[],
  looked: SideReportLooked,
): SideReport | undefined {
  const lookedAt = looked.posed + looked.noRider + looked.unreadable;
  if (looked.model === 'unavailable' && looked.posed === 0) {
    return { summary: SIDE_REPORT_NO_MODEL, observations: [] };
  }
  if (lookedAt === 0) {
    return undefined;
  }
  if (samples.length === 0 || looked.posed < lookedAt * MINIMUM_POSED_SHARE) {
    return { summary: SIDE_REPORT_UNREADABLE, observations: [] };
  }
  const thirds = thirdsOf(samples);
  if (thirds === undefined) {
    return { summary: SIDE_REPORT_TOO_SHORT, observations: [] };
  }
  const { early, late } = thirds;

  const compared = SIDE_OBSERVATION_KINDS.map((kind) => ({
    kind,
    change: changeOf(kind, early, late),
  }));
  if (compared.every(({ change }) => change === undefined)) {
    return { summary: SIDE_REPORT_UNREADABLE, observations: [] };
  }
  const observations = compared.flatMap(({ kind, change }) => {
    if (change === undefined || Math.abs(change) < OBSERVATION_THRESHOLDS[kind]) {
      return [];
    }
    const direction: SideChangeDirection = change > 0 ? 'increased' : 'decreased';
    return [SIDE_OBSERVATION_SENTENCES[kind][direction]];
  });
  if (observations.length > 0) {
    return { summary: SIDE_REPORT_OBSERVED, observations };
  }
  // ⚠️ "Nothing changed" is a claim about everything the report looks at, so
  // it is made only when all five kinds were compared. When some could not
  // be — an ankle the model rarely found leaves out the knee and the saddle —
  // the sentence says so rather than reading as though all five were (ADR
  // 0030 R2: a comparison names its conditions; #561's review).
  return {
    summary: compared.every(({ change }) => change !== undefined)
      ? SIDE_REPORT_UNCHANGED
      : SIDE_REPORT_UNCHANGED_IN_PART,
    observations,
  };
}

/**
 * The angle changes between the thirds, in degrees, for the kinds that are
 * angles, each carrying `spread` — kept for the day #385 measures one.
 *
 * ⚠️ **Nothing in production calls this, on purpose**, and nothing renders
 * what it returns: {@link renderableChanges} is the gate, and it passes nothing
 * while {@link MEASURED_SPREAD_DEGREES} is absent. It exists so that the type
 * the owner asked to keep is computed from the same arithmetic as the words,
 * and is tested now rather than written for the first time on the day it may
 * be shown.
 */
export function observedChanges(
  samples: readonly SideReportSample[],
  spread: number,
): readonly ObservedChange[] {
  const thirds = thirdsOf(samples);
  if (thirds === undefined) {
    return [];
  }
  return (['torso', 'knee', 'elbow'] as const).flatMap((what) => {
    const delta = changeOf(what, thirds.early, thirds.late);
    return delta === undefined
      ? []
      : [
          {
            what,
            deltaDegrees: delta,
            spreadDegrees: spread,
            between: ['first third of the session', 'last third of the session'] as const,
          },
        ];
  });
}

/**
 * The changes a report may show as numbers: **none**, while no spread has been
 * measured. The gate the owner asked for, in one place.
 */
export function renderableChanges(
  changes: readonly ObservedChange[],
  spread: number | undefined = MEASURED_SPREAD_DEGREES,
): readonly ObservedChange[] {
  return spread === undefined ? [] : changes;
}

/**
 * The first and last thirds of a session by time, or `undefined` when the
 * session is shorter than {@link MINIMUM_SESSION_MILLISECONDS}.
 */
function thirdsOf(
  samples: readonly SideReportSample[],
): { readonly early: SideReportSample[]; readonly late: SideReportSample[] } | undefined {
  const ordered = [...samples].sort((a, b) => a.milliseconds - b.milliseconds);
  const first = ordered[0]?.milliseconds ?? 0;
  const last = ordered[ordered.length - 1]?.milliseconds ?? 0;
  const span = last - first;
  if (ordered.length === 0 || span < MINIMUM_SESSION_MILLISECONDS) {
    return undefined;
  }
  return {
    early: ordered.filter((sample) => sample.milliseconds <= first + span / 3),
    late: ordered.filter((sample) => sample.milliseconds >= last - span / 3),
  };
}

/** One kind's change between the thirds, or `undefined` when either third has too little to say. */
function changeOf(
  kind: SideObservationKind,
  early: readonly SideReportSample[],
  late: readonly SideReportSample[],
): number | undefined {
  const before = statisticOf(kind, early);
  const after = statisticOf(kind, late);
  return before === undefined || after === undefined ? undefined : after - before;
}

function statisticOf(
  kind: SideObservationKind,
  third: readonly SideReportSample[],
): number | undefined {
  if (kind === 'saddle') {
    return saddleOf(third);
  }
  const values = third.flatMap((sample) => {
    const value = measureOf(kind, sample.pose);
    return value === undefined ? [] : [value];
  });
  if (values.length < MINIMUM_POSES_PER_THIRD) {
    return undefined;
  }
  return kind === 'knee' ? quantile(values, BOTTOM_OF_STROKE_QUANTILE) : quantile(values, 0.5);
}

/** A point in the picture, with `x` scaled by the aspect so a unit across equals a unit down. */
interface Point {
  readonly x: number;
  readonly y: number;
}

function pointOf(pose: SidePose, name: SidePoseLandmark): Point | undefined {
  const mark = pose.landmarks.find((each) => each.name === name);
  return mark === undefined ? undefined : { x: mark.x * pose.aspect, y: mark.y };
}

/**
 * Which way the rider faces in the picture: +1 when their hands are to the
 * right of their hips, −1 when to the left. The hands are on the bars, ahead
 * of the rider, whichever side faces the camera.
 */
function facingOf(pose: SidePose): 1 | -1 | undefined {
  const hip = pointOf(pose, 'hip');
  const wrist = pointOf(pose, 'wrist');
  if (hip === undefined || wrist === undefined || wrist.x === hip.x) {
    return undefined;
  }
  return wrist.x > hip.x ? 1 : -1;
}

function measureOf(
  kind: Exclude<SideObservationKind, 'saddle'>,
  pose: SidePose,
): number | undefined {
  const facing = facingOf(pose);
  if (facing === undefined) {
    return undefined;
  }
  switch (kind) {
    case 'torso': {
      const hip = pointOf(pose, 'hip');
      const shoulder = pointOf(pose, 'shoulder');
      if (hip === undefined || shoulder === undefined) {
        return undefined;
      }
      // Up is smaller y in the picture, so the rise is hip minus shoulder.
      return degrees(Math.atan2(hip.y - shoulder.y, facing * (shoulder.x - hip.x)));
    }
    case 'knee':
      return jointAngle(pose, 'hip', 'knee', 'ankle');
    case 'elbow':
      return jointAngle(pose, 'shoulder', 'elbow', 'wrist');
    case 'head': {
      const ear = pointOf(pose, 'ear');
      const shoulder = pointOf(pose, 'shoulder');
      const hip = pointOf(pose, 'hip');
      if (ear === undefined || shoulder === undefined || hip === undefined) {
        return undefined;
      }
      const torso = distance(shoulder, hip);
      return torso === 0 ? undefined : (facing * (ear.x - shoulder.x)) / torso;
    }
  }
}

/**
 * Where the rider sat over a third: the hip's median position ahead of the
 * centre of the ankle's circle — the pedals' axle, near enough, and fixed to
 * the bicycle — as a share of the thigh's length. The mean of the ankle's
 * positions is that centre because a third covers hundreds of whole strokes.
 */
function saddleOf(third: readonly SideReportSample[]): number | undefined {
  const hips: number[] = [];
  const ankles: number[] = [];
  const thighs: number[] = [];
  const facings: number[] = [];
  for (const { pose } of third) {
    const facing = facingOf(pose);
    const hip = pointOf(pose, 'hip');
    const knee = pointOf(pose, 'knee');
    const ankle = pointOf(pose, 'ankle');
    if (facing === undefined || hip === undefined || knee === undefined || ankle === undefined) {
      continue;
    }
    facings.push(facing);
    hips.push(hip.x);
    ankles.push(ankle.x);
    thighs.push(distance(hip, knee));
  }
  if (hips.length < MINIMUM_POSES_PER_THIRD) {
    return undefined;
  }
  const thigh = quantile(thighs, 0.5);
  if (thigh === 0) {
    return undefined;
  }
  const facing = quantile(facings, 0.5) >= 0 ? 1 : -1;
  const centre = ankles.reduce((sum, x) => sum + x, 0) / ankles.length;
  return (facing * (quantile(hips, 0.5) - centre)) / thigh;
}

/** The angle at `middle` between the two segments to `from` and `to`, in degrees: 180 is straight. */
function jointAngle(
  pose: SidePose,
  from: SidePoseLandmark,
  middle: SidePoseLandmark,
  to: SidePoseLandmark,
): number | undefined {
  const a = pointOf(pose, from);
  const b = pointOf(pose, middle);
  const c = pointOf(pose, to);
  if (a === undefined || b === undefined || c === undefined) {
    return undefined;
  }
  const one = { x: a.x - b.x, y: a.y - b.y };
  const two = { x: c.x - b.x, y: c.y - b.y };
  const lengths = Math.hypot(one.x, one.y) * Math.hypot(two.x, two.y);
  if (lengths === 0) {
    return undefined;
  }
  const cosine = Math.min(1, Math.max(-1, (one.x * two.x + one.y * two.y) / lengths));
  return degrees(Math.acos(cosine));
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function degrees(radians: number): number {
  return (radians * 180) / Math.PI;
}

/** The `q` quantile of `values` by linear interpolation between order statistics. */
function quantile(values: readonly number[], q: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (sorted.length - 1) * q;
  const low = Math.floor(at);
  const high = Math.ceil(at);
  const lower = sorted[low] ?? 0;
  const upper = sorted[high] ?? lower;
  return lower + (upper - lower) * (at - low);
}
