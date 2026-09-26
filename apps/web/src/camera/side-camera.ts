// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The tripod phone's side-camera session: set up, film, and stop — on its
 * own timer when the tablet goes quiet** — #528,
 * [ADR 0033](../../../../docs/adr/0033-side-camera-link.md) D-3, D-5, D-7 and
 * D-8.
 *
 * A state machine with no DOM, driven by three things: the rider on this
 * phone, the tablet over {@link SideCameraLinkPort}, and a clock. The screen
 * (`views/SideCameraView.tsx`) renders what {@link SideCameraSession.state}
 * says and calls two methods; everything a rider's safety rests on is here,
 * where it is tested without a camera, a link or a browser.
 *
 * ## The 30 seconds, and why they are this phone's own
 *
 * D-5, in the owner's words: *"Link lost: the phone keeps filming **at most 30
 * seconds**, then stops and says so."* And the ADR's rule:
 *
 * > When the link is lost, the phone keeps filming for **at most 30 seconds,
 * > measured by its own timer**, and then stops the camera and says *stopped,
 * > link lost* on its own screen. The limit never depends on the link, because
 * > the case it covers is the link being gone.
 *
 * So the stop is a timer this session starts the moment it hears
 * `condition: 'lost'`, and nothing the link does afterwards can extend it
 * except the one thing D-5 permits: the link coming back **inside** the
 * window, which cancels it (*"streaming resumes with the next frame captured
 * and the session continues"*). A second loss starts a fresh 30 seconds from
 * that loss; it never inherits time from the first, and it never adds any.
 *
 * ⚠️ **The camera, not a flag.** *"The camera track is stopped at 30 s and not
 * later"* is #528's test, and `side-camera.test.ts` asserts it on the camera's
 * own `stopCamera` call, one millisecond either side of the limit — a session
 * that set `phase: 'stopped'` and left the track running would pass any
 * assertion on the phase.
 *
 * ## What this phone keeps: nothing (D-8)
 *
 * The reference and the verdict arrive over the link and live in this object
 * for as long as the session does. Nothing here names a store, `localStorage`,
 * IndexedDB or a cache, and `side-camera.test.ts` §"keeps nothing" scans this
 * file and its screen to hold that.
 *
 * ## The pictures, since #530
 *
 * While filming, the session takes a small picture every
 * {@link PICTURE_INTERVAL_MILLISECONDS} (`camera-port.ts`
 * §`SIDE_FRAME_LONG_SIDE` on its long side, re-encoded from pixels) and hands
 * it to the link, numbered and timed from the moment filming began and with
 * nothing else (ADR 0033 D-3). ⚠️ **A reviewer who remembers "it does NOT
 * send pictures yet" is reading #528's file.** Three rules, each of which the
 * tests hold:
 *
 * - **Nothing is taken while the link is not connected**, and a picture that
 *   was being taken when the link went is dropped rather than sent later —
 *   D-5's *"a frame captured while the link is down is discarded at once"*,
 *   in its narrower form: the camera keeps running for the 30 seconds, but no
 *   picture is made for nobody.
 * - **One picture at a time.** A picture still being taken when the next tick
 *   comes means the tick is skipped, and the link refuses a picture while the
 *   last one has not left (`side-camera-link-port.ts` §`SidePictureSent`).
 * - **Nothing is kept.** The picture goes to the link and this object holds no
 *   reference to it afterwards, whatever the link answered (D-8).
 */

import type { CameraProblemKind, CapturedFrame } from './camera-port';
import {
  framingReferenceFrom,
  framingVerdictFrom,
  type FramingReference,
  type FramingVerdict,
} from './framing';
import type {
  SideCameraLinkPort,
  SideCameraStopReason,
  SideLinkCondition,
  SideLinkEvent,
} from './side-camera-link-port';

/**
 * How long the phone goes on filming after it loses the tablet: **30 seconds,
 * and not a millisecond more.**
 *
 * The owner's number (#386, ADR 0033 D-5), not a tuning. It is on the consent
 * screen in {@link LINK_LOSS_SENTENCE}, so changing it here without changing
 * that sentence would make the consent false — `side-camera.test.ts` reads the
 * number out of the sentence and compares.
 */
export const LINK_LOSS_LIMIT_MILLISECONDS = 30_000;

/**
 * The sentence the consent screen on THIS phone shows beside ADR 0029 D-5's
 * bystander sentence — ADR 0033 D-5, in the owner's wording from #528.
 *
 * ⚠️ **Do not improve this.** It is quoted in ADR 0033 and
 * `side-camera.test.ts` reads the ADR off disk and compares, which is the
 * move `consent.ts` makes for the bystander sentence and for the same reason:
 * the point of quoting a sentence in an ADR is that the product says the
 * sentence somebody ruled on.
 */
export const LINK_LOSS_SENTENCE =
  'If this phone loses touch with your tablet, it keeps filming for up to 30 seconds, then stops.';

/**
 * How often the phone takes a picture while filming: every 200 ms, five a
 * second.
 *
 * The owner's figure (#527: *"about 5 per second, at the model's input size
 * (~256 px)"*), and the rate spike 0010 costed the model at on the tablet:
 * 65.8 / 80.9 ms p50 / p95 per picture beside the ride, so the model is busy
 * for well under half of each interval. ADR 0033 D-3 says #385 confirms or
 * adjusts it by an amendment there; it has not moved.
 */
export const PICTURE_INTERVAL_MILLISECONDS = 200;

/**
 * How often the countdown is refreshed while the link is lost.
 *
 * Four times a second so the number on screen is never more than a quarter of
 * a second behind the timer that actually stops the camera. ⚠️ **It does not
 * stop the camera**: the stop is its own one-shot timer at exactly
 * {@link LINK_LOSS_LIMIT_MILLISECONDS}, so a slow tick can make the countdown
 * late and never the stop.
 */
export const COUNTDOWN_REFRESH_MILLISECONDS = 250;

/**
 * Where the session is.
 *
 * - `off` — the camera is not on. The ordinary state before the rider has
 *   turned it on to frame the shot.
 * - `framing` — the camera is on and showing the rider a preview, and the
 *   tablet has not said *start*.
 * - `filming` — the tablet said *start*. The screen is the indicator and one
 *   stop control, and nothing else (#528).
 * - `stopped` — over. {@link SideCameraState.stopReason} says why. A new
 *   session is a new pairing (ADR 0033 D-4: *"scan every time"*).
 */
export type SideCameraPhase = 'off' | 'framing' | 'filming' | 'stopped';

/** Everything the screen renders from, in one object that changes only when it does. */
export interface SideCameraState {
  readonly phase: SideCameraPhase;
  /** Why it stopped, when {@link phase} is `stopped`. */
  readonly stopReason: SideCameraStopReason | undefined;
  /** Why the camera would not turn on, when it would not. */
  readonly problem: CameraProblemKind | undefined;
  /** Whether this phone has a link to a tablet at all. */
  readonly paired: boolean;
  /** The link's condition, or `undefined` with no link. */
  readonly linkCondition: SideLinkCondition | undefined;
  /**
   * Whole seconds until the camera stops because the link is lost, counted
   * down, or `undefined` while there is no countdown. Rounded UP, so the
   * screen says 1 until the moment it stops and never 0 while still filming.
   */
  readonly secondsLeft: number | undefined;
  /** The last session's framing, sent by the tablet, held in memory only (D-8). */
  readonly reference: FramingReference | undefined;
  /** The tablet's check of this session against {@link reference} (D-7). */
  readonly verdict: FramingVerdict | undefined;
}

/**
 * The slice of `CameraController` a side-camera session drives.
 *
 * Structural, like `session.ts` §`CameraThrottle`, so this machine is tested
 * with a scripted controller and can do nothing to a camera but turn it on,
 * turn it off and watch whether it is running. Consent is the controller's:
 * `turnOn` refuses without it, and the screen asks for it first.
 */
export interface SideCameraCamera {
  turnOn(): Promise<CameraProblemKind | undefined>;
  /** One small picture, or `undefined`. Never rejects. @see CameraController.captureSideFrame */
  captureSideFrame(): Promise<CapturedFrame | undefined>;
  turnOff(): void;
  state(): { readonly live: boolean };
  subscribe(listener: () => void): () => void;
}

/** How a session is built. Every clock is injected so a test needs no timers. */
export interface SideCameraSessionOptions {
  readonly camera: SideCameraCamera;
  /** The tablet, or `undefined` on a phone that is not paired. */
  readonly link?: SideCameraLinkPort | undefined;
  /** Milliseconds, on this phone's own clock. `Date.now` by default. */
  readonly clock?: (() => number) | undefined;
  /** Run `task` once after `milliseconds`. @returns the cancel. */
  readonly after?: ((task: () => void, milliseconds: number) => () => void) | undefined;
  /** Run `task` every `milliseconds`. @returns the cancel. */
  readonly every?: ((task: () => void, milliseconds: number) => () => void) | undefined;
}

/** The browser's own one-shot timer, in the shape the session wants. */
export function browserAfter(task: () => void, milliseconds: number): () => void {
  const handle = setTimeout(task, milliseconds);
  return () => {
    clearTimeout(handle);
  };
}

/** The browser's own repeating timer, in the shape the session wants. */
export function browserEvery(task: () => void, milliseconds: number): () => void {
  const handle = setInterval(task, milliseconds);
  return () => {
    clearInterval(handle);
  };
}

/** The side camera's session. One per visit to the screen. */
export class SideCameraSession {
  readonly #camera: SideCameraCamera;
  #link: SideCameraLinkPort | undefined;
  readonly #clock: () => number;
  readonly #after: (task: () => void, milliseconds: number) => () => void;
  readonly #every: (task: () => void, milliseconds: number) => () => void;
  readonly #listeners = new Set<() => void>();
  readonly #unsubscribe: (() => void)[] = [];

  #phase: SideCameraPhase = 'off';
  /**
   * Set by {@link dispose}. ⚠️ **The phase cannot stand in for it**: a session
   * disposed while the camera is still turning on is still `off`, so a
   * "still off?" check after the wait would let it through (#536's review).
   */
  #disposed = false;
  #stopReason: SideCameraStopReason | undefined;
  #problem: CameraProblemKind | undefined;
  #condition: SideLinkCondition | undefined;
  #lostAt: number | undefined;
  #cancelStop: (() => void) | undefined;
  #cancelCountdown: (() => void) | undefined;
  #reference: FramingReference | undefined;
  #verdict: FramingVerdict | undefined;
  #snapshot: SideCameraState;
  /** The picture timer, while filming. */
  #cancelPictures: (() => void) | undefined;
  /** When filming began, on this phone's clock — the zero of every picture's milliseconds. */
  #filmingSince = 0;
  /** The next picture's number. */
  #sequence = 0;
  /** Whether a picture is being taken now. */
  #taking = false;

  constructor(options: SideCameraSessionOptions) {
    this.#camera = options.camera;
    this.#link = options.link;
    this.#clock = options.clock ?? Date.now;
    this.#after = options.after ?? browserAfter;
    this.#every = options.every ?? browserEvery;
    this.#condition = this.#link?.sideLinkCondition();
    this.#snapshot = this.#build();
    if (this.#link !== undefined) {
      this.#listen(this.#link);
    }
    this.#unsubscribe.push(
      this.#camera.subscribe(() => {
        // The camera went out without this session asking — the rider
        // revoked the permission from the operating system, another app took
        // the device, consent was withdrawn on the Camera screen. Said, and
        // the tablet told, rather than left showing "filming" over nothing.
        if (
          (this.#phase === 'framing' || this.#phase === 'filming') &&
          !this.#camera.state().live
        ) {
          this.#stop('camera');
        }
      }),
    );
  }

  /**
   * Take the link the rider has just paired — #529.
   *
   * The phone pairs AFTER its camera is on, because the camera is what reads
   * the tablet's code (ADR 0033 D-1), so a session that began unpaired is
   * handed its link here rather than being rebuilt — rebuilding would stop the
   * camera the rider has just framed with.
   *
   * ⚠️ **Once, and never over a stopped session.** A session that already has
   * a link keeps it — D-4's *"one connection, once"* — and a stopped one takes
   * none, because a pairing is spent with the session it belonged to. A link
   * that is not `connected` is refused too: the screen waits for the tablet to
   * connect before it hands one over.
   *
   * @returns whether the link was taken. One that was not is the caller's to
   * end.
   */
  pair(link: SideCameraLinkPort): boolean {
    if (
      this.#disposed ||
      this.#link !== undefined ||
      this.#phase === 'stopped' ||
      link.sideLinkCondition() !== 'connected'
    ) {
      return false;
    }
    this.#link = link;
    this.#condition = 'connected';
    this.#listen(link);
    if (this.#phase === 'framing' || this.#phase === 'filming') {
      link.reportToTablet({ state: this.#phase });
    }
    this.#announce();
    return true;
  }

  /** The current state. The same object until something changes. */
  state(): SideCameraState {
    return this.#snapshot;
  }

  /** Call `listener` whenever {@link state} would answer differently. */
  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  /**
   * Turn the camera on so the rider can frame the shot.
   *
   * Only from `off`. The camera's own consent check applies — this never
   * opens a camera the rider has not agreed to — and a refusal is kept in
   * {@link SideCameraState.problem} rather than thrown.
   */
  async turnOnForFraming(): Promise<void> {
    if (this.#phase !== 'off') {
      return;
    }
    const problem = await this.#camera.turnOn();
    if (problem !== undefined) {
      this.#problem = problem;
      this.#announce();
      return;
    }
    // The screen may have gone, or the tablet said stop, while the platform's
    // own prompt was up. A camera that arrives after the session ended is
    // turned straight back off rather than left running under nobody.
    // ⚠️ **Both checks, not one.** The tablet's stop moves the phase to
    // `stopped`; the screen going away does NOT — `dispose` stops only a
    // session that is framing or filming, so one disposed mid-prompt is still
    // `off` here, and without `#disposed` it would go on to `framing` with a
    // live camera, tell the tablet so, and leave nothing listening to show a
    // stop control or run the 30-second stop (#536's review).
    if (this.#disposed || this.#phase !== 'off') {
      this.#camera.turnOff();
      return;
    }
    this.#problem = undefined;
    this.#phase = 'framing';
    this.#link?.reportToTablet({ state: 'framing' });
    // Already lost (or ended) when the camera came on: the 30 seconds apply
    // from now, because a camera is running and nobody at the tablet can stop
    // it.
    if (this.#condition === 'lost' || this.#condition === 'ended') {
      this.#startCountdown();
    }
    this.#announce();
  }

  /**
   * The phone's own stop — #528's *"one stop control"*, and ADR 0033 D-5's
   * *"the phone's own stop control still works"*. Ends the session and the
   * pairing with it.
   */
  stopHere(): void {
    if (this.#phase === 'stopped') {
      return;
    }
    this.#stop('rider');
  }

  /**
   * The screen is going away. A camera still running is stopped as if the
   * rider had pressed stop, because nothing would be left to show the
   * countdown or offer the stop control; then every subscription is dropped.
   */
  dispose(): void {
    this.#disposed = true;
    if (this.#phase === 'framing' || this.#phase === 'filming') {
      this.#stop('rider');
    }
    this.#cancelTimers();
    this.#cancelPictures?.();
    this.#cancelPictures = undefined;
    for (const unsubscribe of this.#unsubscribe.splice(0)) {
      unsubscribe();
    }
    this.#listeners.clear();
  }

  #listen(link: SideCameraLinkPort): void {
    this.#unsubscribe.push(
      link.onSideLinkEvent((event) => {
        this.#hear(event);
      }),
    );
  }

  #hear(event: SideLinkEvent): void {
    if (this.#phase === 'stopped') {
      // The session is over. Nothing the tablet says can restart a camera on
      // a pairing D-4 says is spent.
      return;
    }
    switch (event.kind) {
      case 'condition':
        this.#conditionChanged(event.condition);
        return;
      case 'start':
        // Only from framing: the camera is on because the rider turned it on
        // here and saw the picture. A tablet cannot turn this phone's camera
        // on by itself — the narrower reading of *"the tablet drives it"*.
        if (this.#phase === 'framing') {
          this.#phase = 'filming';
          this.#startPictures();
          this.#link?.reportToTablet({ state: 'filming' });
          this.#announce();
        }
        return;
      case 'stop':
        this.#stop('tablet');
        return;
      case 'reference': {
        // Untrusted input (D-4). Anything that is not a reference is dropped
        // and the one already held stays — a malformed message can take the
        // ghost outline away from nobody.
        const reference = framingReferenceFrom(event.reference);
        if (reference !== undefined) {
          this.#reference = reference;
          this.#announce();
        }
        return;
      }
      case 'verdict': {
        // Untrusted input too (D-4), under the same rule as the reference: a
        // value that is not one of the two verdicts is dropped and the one
        // already held stays. It is a key into `FRAMING_VERDICT_TEXT`, so a
        // `'constructor'` kept here would render a function's source.
        const verdict = framingVerdictFrom(event.verdict);
        if (verdict !== undefined) {
          this.#verdict = verdict;
          this.#announce();
        }
        return;
      }
    }
  }

  #conditionChanged(condition: SideLinkCondition): void {
    if (condition === this.#condition) {
      return;
    }
    this.#condition = condition;
    if (condition === 'lost' || condition === 'ended') {
      // ⚠️ **`ended` is `lost` that cannot recover** (#529): the countdown
      // starts, or — when the link was already lost — goes on from where it
      // was. A link going from `lost` to `ended` must not restart the 30
      // seconds, which would give a camera nobody can stop a second helping.
      if ((this.#phase === 'framing' || this.#phase === 'filming') && this.#lostAt === undefined) {
        this.#startCountdown();
      }
    } else if (condition === 'connected') {
      // Back inside the window: D-5's recovery. The countdown goes and the
      // tablet is told where this phone is, because it may have missed it.
      this.#cancelTimers();
      if (this.#phase === 'framing' || this.#phase === 'filming') {
        this.#link?.reportToTablet({ state: this.#phase });
      }
    }
    this.#announce();
  }

  #startPictures(): void {
    this.#filmingSince = this.#clock();
    this.#sequence = 0;
    this.#cancelPictures = this.#every(() => {
      void this.#takePicture();
    }, PICTURE_INTERVAL_MILLISECONDS);
  }

  /** One tick: a picture, if the link can take one, sent and let go. */
  async #takePicture(): Promise<void> {
    if (this.#taking || !this.#mayPicture()) {
      return;
    }
    this.#taking = true;
    const milliseconds = this.#clock() - this.#filmingSince;
    let frame: CapturedFrame | undefined;
    try {
      frame = await this.#camera.captureSideFrame();
    } finally {
      this.#taking = false;
    }
    // Asked again: the link may have gone, or the session stopped, while the
    // picture was being taken — and then it is dropped here, at once (D-5).
    if (frame === undefined || !this.#mayPicture()) {
      return;
    }
    const sent = this.#link?.sendPictureToTablet({
      sequence: this.#sequence,
      milliseconds,
      bytes: frame.bytes,
    });
    if (sent === 'sent') {
      this.#sequence += 1;
    }
  }

  #mayPicture(): boolean {
    return (
      !this.#disposed &&
      this.#phase === 'filming' &&
      this.#link !== undefined &&
      this.#condition === 'connected'
    );
  }

  #startCountdown(): void {
    this.#cancelTimers();
    this.#lostAt = this.#clock();
    // ⚠️ **The stop is its own one-shot timer at exactly the limit**, not the
    // countdown's tick noticing it has run out: a tick is late by up to its
    // own period, and D-5 says *at most* 30 seconds.
    this.#cancelStop = this.#after(() => {
      this.#stop('link-lost');
    }, LINK_LOSS_LIMIT_MILLISECONDS);
    let shown = this.#secondsLeft();
    this.#cancelCountdown = this.#every(() => {
      const now = this.#secondsLeft();
      if (now !== shown) {
        shown = now;
        this.#announce();
      }
    }, COUNTDOWN_REFRESH_MILLISECONDS);
  }

  #secondsLeft(): number | undefined {
    if (this.#lostAt === undefined) {
      return undefined;
    }
    const remaining = this.#lostAt + LINK_LOSS_LIMIT_MILLISECONDS - this.#clock();
    return Math.max(0, Math.ceil(remaining / 1000));
  }

  #cancelTimers(): void {
    this.#cancelStop?.();
    this.#cancelStop = undefined;
    this.#cancelCountdown?.();
    this.#cancelCountdown = undefined;
    this.#lostAt = undefined;
  }

  #stop(reason: SideCameraStopReason): void {
    this.#cancelTimers();
    this.#cancelPictures?.();
    this.#cancelPictures = undefined;
    // ⚠️ The phase before the camera, and only because turning the camera off
    // announces: the camera watch in the constructor would otherwise hear a
    // camera going out under a session still "filming" and stop it a second
    // time, as `camera`. Both lines are synchronous, so nothing can run
    // between them — the camera is off before this method returns, before any
    // report, which is the line D-5 and #528's test are about.
    this.#phase = 'stopped';
    this.#stopReason = reason;
    this.#camera.turnOff();
    // Told, and then let go: a pairing lasts one session (D-4). On a lost
    // link the report reaches nobody, which the port says is fine.
    this.#link?.reportToTablet({ state: 'stopped', reason });
    this.#link?.endSideLink();
    this.#announce();
  }

  #build(): SideCameraState {
    return {
      phase: this.#phase,
      stopReason: this.#stopReason,
      problem: this.#problem,
      paired: this.#link !== undefined,
      linkCondition: this.#condition,
      secondsLeft: this.#phase === 'stopped' ? undefined : this.#secondsLeft(),
      reference: this.#reference,
      verdict: this.#verdict,
    };
  }

  #announce(): void {
    this.#snapshot = this.#build();
    for (const listener of [...this.#listeners]) {
      listener();
    }
  }
}

/**
 * What the screen says once the session is over, one sentence per reason.
 *
 * ⚠️ `link-lost` opens with #528's own words, *"stopped, link lost"*, because
 * that is the sentence the criterion names and the one a rider walking back to
 * the tripod needs first.
 */
export const STOPPED_TEXT: Readonly<Record<SideCameraStopReason, string>> = {
  'link-lost':
    'Stopped, link lost. This phone could not reach your tablet for 30 seconds, so it stopped filming.',
  tablet: 'Stopped. Your tablet ended the session.',
  rider: 'Stopped. You ended the session on this phone.',
  camera: 'Stopped. The camera went off, so there was nothing left to film with.',
};
