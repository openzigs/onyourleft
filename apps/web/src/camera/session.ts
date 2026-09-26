// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The one thing that holds a camera on, and the one thing that knows whether
 * it is** (#382).
 *
 * `CameraPort` is the seam; this is its only production consumer, and it exists
 * because two very different parts of the client need the same answer at the
 * same moment: the Camera screen, which turns the camera on, and
 * {@link CameraIndicator} in `AppShell`, which has to be showing **wherever the
 * rider is** while it is on. A boolean held inside the view would be invisible
 * to the shell, and a second source of truth for "is the camera running" is the
 * one bug this feature must not have.
 *
 * ## Why it is a subscription rather than React state
 *
 * The indicator is rendered by `AppShell`, above the router, and the control
 * that starts the camera is inside a route. Lifting the state into `AppShell`
 * would work and would put the camera's lifetime under a component that
 * re-renders on every navigation; this is the shape `ride/RideSession.tsx`
 * already uses for a recording, and for the same reason — *"a recording belongs
 * to the app and not to whichever page is on screen"*. A camera is more so: the
 * rider may well switch screens while it runs.
 *
 * ## The camera is OFF by default, and that is a property of this file
 *
 * #382: *"A test asserts that a freshly-constructed session with no recorded
 * consent yields no capture — **not a disabled button, no capture**."*
 * {@link CameraController.turnOn} and {@link CameraController.captureOne} both
 * return a `no-consent` problem **without calling the port at all**, so a view
 * that rendered an enabled control by mistake still cannot open a camera.
 * `session.test.ts` asserts the port was never touched, which is the assertion
 * a disabled-button test cannot make.
 *
 * ## What it does not do
 *
 * It keeps nothing. Every frame it takes is dropped as soon as it has been
 * measured — [ADR 0029](../../../../docs/adr/0029-camera-imagery-as-a-data-class.md)
 * D-2's default, which the owner ratified on 2026-09-23. The per-ride keep that
 * the same decision permits arrives with
 * [#384](https://github.com/openzigs/onyourleft/issues/384), in this same pull
 * request and in its own commit, because #382's own scope says *"until it lands
 * nothing is persisted"*.
 *
 * And it sends nothing on its own. Since #387 there is exactly one way a
 * picture leaves this device — {@link CameraController.askAboutPicture}, to an
 * address the rider typed and switched on, on a press — and
 * `privacy/no-network.test.ts` is the gate that keeps it the only one.
 */

import type {
  CameraNotice,
  CameraPort,
  CameraProblemKind,
  CameraSession,
  CapturedFrame,
  PreviewSurface,
} from './camera-port';
import { CameraCaptureError } from './camera-port';
import { consentDecision, NO_CONSENT, type CameraConsent, type ConsentAnswers } from './consent';
import type {
  AnalysisCall,
  AnalysisFailure,
  AnalysisOutcome,
  AnalysisPort,
  AnalysisQuestion,
} from './analysis-port';
import type { FrameKeep } from './keep';
import { cameraNotice } from './notice';
import { pairingCodeFromPixels } from './side-link-qr';
import {
  nextPresence,
  observePair,
  PRESENCE_CHECK_MILLISECONDS,
  PRESENCE_NOT_OBSERVED,
  PRESENCE_PAIR_GAP_MILLISECONDS,
  presenceAt,
  type PresenceTracker,
} from './presence';
import type { RiderPresence, RiderPresencePort } from '../ride/presence-port';

/**
 * How often the controller checks that the camera is still running.
 *
 * ⚠️ **A poll rather than an event, because there is no event that covers the
 * case this is for.** A `MediaStreamTrack` fires `ended` when the track stops —
 * and `CameraPort` is deliberately platform-free, so it exposes
 * {@link CameraSession.live} rather than a `MediaStreamTrack`, and the Android
 * half of the port may not have an event at all. A poll over a boolean the
 * adapter already maintains works on both and needs no listener plumbing
 * through the port.
 *
 * ⚠️ **The interval is what bounds how long a stale indicator can be showing**,
 * which is the direction that matters: an indicator still lit after the camera
 * has gone is a lie in the safe direction, and one that goes out while the
 * camera runs is a lie in the dangerous one. This cannot produce the second —
 * the poll only ever turns the indicator *off*.
 *
 * One second, because the thing it is racing is a person walking into a room.
 */
export const LIVENESS_POLL_MILLISECONDS = 1000;

/**
 * The one thing the trainer game needs of a camera.
 *
 * ⚠️ **A structural interface rather than the whole {@link CameraController}**,
 * so that `game/GameView.tsx` — which is watched by `check:wiring` and is the
 * largest component in the client — gains one method rather than a class with a
 * lifecycle it has no business driving. The game may tell the camera that this
 * phone has run out of headroom; it may not turn it on, turn it off, take a
 * picture or revoke a consent, and this type is what says so.
 */
export interface CameraThrottle {
  /** @see CameraController.throttle */
  throttle(captureAllowed: boolean): void;
  /** @see CameraController.throttlePresence */
  throttlePresence(presenceAllowed: boolean): void;
}

/** Everything a screen or the indicator needs to know, in one object. */
export interface CameraState {
  /** What the rider has agreed to. @see consent.ts */
  readonly consent: CameraConsent;
  /**
   * Whether a camera is running **right now**.
   *
   * This is the indicator's whole input, and it is deliberately not derived
   * from `consent.local`: consent is a standing answer and a running camera is
   * an event. An indicator driven by consent would be showing all the time on a
   * device where the rider had agreed once, which is an indicator that means
   * nothing.
   */
  readonly live: boolean;
  /** Why the camera is not running, when it is not. `undefined` while it is. */
  readonly problem: CameraProblemKind | undefined;
  /** How many frames have been taken since the camera was last turned on. */
  readonly captured: number;
  /**
   * Whether the **next** picture will be kept — #384, ADR 0029 D-2.
   *
   * **`false` every time the camera is turned on**, and there is nowhere it is
   * persisted. `keep.ts` is the whole of it.
   *
   * ⚠️ **It says nothing about the pictures already taken**, and reading it as
   * though it did is the defect this pair of fields exists to stop: the switch
   * can be turned on and off inside one session, which `keep.ts` argues for
   * explicitly, so `keeping === false` is perfectly compatible with pictures
   * being on the disk. {@link keptThisSession} is the one to show a rider.
   */
  readonly keeping: boolean;
  /**
   * How many of those {@link captured} frames are **on this device**.
   *
   * Counted from what the sink actually did with each frame rather than from
   * {@link keeping}, and reset with {@link captured} at every switch-on. Never
   * greater than `captured`; equal to it on a session kept throughout; `0` on
   * the ordinary session where the rider kept nothing.
   */
  readonly keptThisSession: number;
  /**
   * Whether the quality ladder currently permits a capture — `quality.ts`
   * §`QualitySettings.capture`.
   *
   * `true` until a ride steps the ladder down. @see CameraController.throttle
   */
  readonly captureAllowed: boolean;
  /**
   * Whether the rider has asked for their ride to pause when nobody is on the
   * bike — #390.
   *
   * **`false` every time the camera is turned on**, for the reason
   * {@link keeping} is: a camera that decides when a ride stops accumulating
   * is a thing a rider chooses knowing where it is pointed *this* time.
   */
  readonly watchingPresence: boolean;
  /**
   * Whether the quality ladder currently permits a presence check —
   * `quality.ts` §`QualitySettings.presence`. `true` until a ride steps the
   * ladder down.
   */
  readonly presenceAllowed: boolean;
  /**
   * The answer the ride is being given right now. @see CameraController.riderPresence
   *
   * One of three words, and ⚠️ **the whole of what presence derives** — no
   * picture, no grid, no count of people and nothing about who.
   */
  readonly presence: RiderPresence;
}

/** What a caller is told about a capture, with nothing of the picture in it. */
export interface CaptureOutcome {
  readonly taken: boolean;
  /** The refusal, when there was one. @see cameraNotice */
  readonly problem: CameraProblemKind | undefined;
  /** Whether this picture is on this device. `false` when it was dropped. */
  readonly kept: boolean;
  /**
   * Whether the rider asked for this one to be kept and the device refused.
   *
   * ⚠️ **The picture was still taken.** In production the sink is an IndexedDB
   * write of a whole JPEG, so `QuotaExceededError` is the expected failure and
   * not an exotic one — and before this field the rejection escaped
   * {@link CameraController.captureOne} altogether: the screen's
   * `void …then(setOutcome)` had no `catch`, so a full disk produced an
   * unhandled rejection, no notice and a counter that did not move.
   *
   * ⚠️ **Nothing of the error survives** — not its message, not its name, not a
   * key. ADR 0029 D-8 binds a message about a frame, and a storage error's text
   * routinely carries the key it could not write.
   */
  readonly keepFailed: boolean;
  /**
   * How big the picture was, in bytes, and how many pixels across and down.
   *
   * ⚠️ **A count and a size, which ADR 0029 D-8 explicitly permits** — its
   * table lists *"a count, a byte size, a format name"* on the permitted side
   * and *"a thumbnail, a crop, a downscale, a single pixel sample"* on the
   * forbidden one. There is nothing here from which any part of the image can
   * be recovered, and it is what lets the Camera screen tell a rider that the
   * camera is pointing at something rather than at a lens cap.
   */
  readonly bytes: number;
  readonly width: number;
  readonly height: number;
}

/**
 * What {@link CameraController} does with a frame once it has one.
 *
 * ⚠️ **A seam with exactly one implementation in this commit, and it drops the
 * frame.** It is here rather than inlined because #384 adds the second — the
 * per-ride keep — and the alternative was for that issue to reach into this
 * class and change what `captureOne` does to a frame, which is the line this
 * file most wants to stay reviewable.
 *
 * The default is {@link discardTheFrame}, which is ADR 0029 D-2's default
 * expressed as the *absence* of anything else rather than as a branch: a
 * controller built with no sink cannot keep a frame however it is called.
 */
export interface FrameSink {
  /**
   * Takes the frame.
   *
   * @returns `true` when the frame is now **on this device** and `false` when
   * it was dropped.
   *
   * ⚠️ **A boolean rather than `void`, and the reason is a sentence that was
   * false.** The Camera screen used to read the *present-tense* keep switch and
   * say *"None of them was kept."* of every picture taken since switch-on — so
   * a rider who kept three and then turned the switch off was told, on the one
   * screen that exists to say what this device is holding, that it was holding
   * none. `keeping` is what the next frame will do; this is what **this** frame
   * did, and only the sink knows it. `CameraState.keptThisSession` is what the
   * screen reads instead.
   */
  accept(frame: CapturedFrame): Promise<boolean>;
}

/**
 * The default sink: it does nothing at all, on purpose.
 *
 * ⚠️ It does not zero the buffer, and that is not an oversight worth
 * "fixing". The bytes are a `Uint8Array` held by nothing once this returns, and
 * overwriting them would be a gesture: the garbage collector, not this
 * function, decides when the memory is reused, and JavaScript offers no way to
 * make a guarantee about it. A comment claiming the frame was wiped would be
 * the kind of promise ADR 0029's §"What would make this ADR wrong" warns about.
 */
export const discardTheFrame: FrameSink = {
  accept: async (): Promise<boolean> => {
    // `false`: nothing was kept. A controller built with no keep at all can
    // therefore never report a kept picture, whatever it is called.
    return Promise.resolve(false);
  },
};

/** How the controller is built. @see CameraController */
export interface CameraControllerOptions {
  readonly port: CameraPort;
  /** @see FrameSink — omit it and every frame is dropped. */
  readonly sink?: FrameSink | undefined;
  /**
   * How the liveness poll is scheduled. Injected so a test needs no timers.
   *
   * The same shape `apps/mobile`'s transport uses for its own deadline: a
   * function that returns a cancel, rather than `setInterval` reached for
   * inside the class, so the whole lifecycle is reachable from a test on a
   * machine with no camera.
   */
  readonly schedule?: ((tick: () => void, everyMilliseconds: number) => () => void) | undefined;
  /**
   * Where the words for a problem come from — #383.
   *
   * Defaults to `notice.ts`'s shared table, which is right in a browser. Inside
   * the Android shell `main.tsx` passes `shell-camera.ts`'s
   * {@link shellCameraNotice} bound to `apps/mobile`'s own wording, because
   * *"open this device's settings"* is right for a browser and useless to a
   * rider in a garage — the same reason `support/shell-support.ts` exists.
   *
   * ⚠️ **Injected rather than branched on inside this class**, so nothing here
   * names `@onyourleft/mobile`: a static import of that package from a module
   * the browser build renders would put Capacitor in the entry chunk for every
   * visitor, which is what `main.tsx`'s `import()` behind `isNativeShell`
   * exists to prevent.
   */
  readonly notices?: ((kind: CameraProblemKind) => CameraNotice) | undefined;
  /**
   * The per-ride keep — #384, ADR 0029 D-2.
   *
   * ⚠️ **Optional, and its absence is the default rather than a degraded
   * mode.** A controller built without one uses {@link discardTheFrame}, which
   * has no store in it, so a build with no local store cannot keep a picture
   * however it is called. `keep.ts` is what a build with one passes.
   *
   * ⚠️ **It is the same object as {@link CameraControllerOptions.sink}, and
   * supplying both is a mistake this type deliberately still permits** —
   * `keepThisRide` *is* a `FrameSink`, so a caller passes it here and this
   * class uses it for both. Forbidding it in the type would need a union that
   * every call site then has to discriminate, for a mistake that costs a
   * `keeping` switch nothing reads.
   */
  readonly keep?: FrameKeep | undefined;
  /**
   * The clock a presence observation is stamped with, in milliseconds —
   * #390. `Date.now` in production; injected so a test can walk fifteen
   * seconds of stillness without waiting for them.
   */
  readonly clock?: (() => number) | undefined;
  /**
   * How the gap between a presence check's two samples is waited out.
   * @see presence.ts §`PRESENCE_PAIR_GAP_MILLISECONDS`
   */
  readonly wait?: ((milliseconds: number) => Promise<void>) | undefined;
  /**
   * The rider's own computer, looked up afresh on every press — #387.
   *
   * A function rather than a port, because the rider configures, switches on
   * and switches off their computer on the Camera screen while this controller
   * lives on, and a port captured at construction would go on sending to an
   * address the rider had just switched off. `main.tsx` passes
   * `analysis-transport.ts` §`riderAnalysisPort` over the stored endpoint.
   *
   * ⚠️ **Omitted, and every answer is `not-configured`** — no picture is taken
   * and nothing is sent. So is an answer of `undefined`, which is what an
   * unconfigured or switched-off device gives. ⚠️ And omitting it is **green**
   * under `check:wiring`, because an optional option nobody supplies is well
   * typed: `analysis-port.ts` records that limit and `CameraView.test.tsx`
   * drives the branch.
   */
  readonly analysis?: (() => AnalysisPort | undefined) | undefined;
}

/** A promise that settles after `milliseconds`, on the browser's own timer. */
export async function browserWait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

/** The browser's own timer, in the shape {@link CameraControllerOptions} wants. */
export function browserInterval(tick: () => void, everyMilliseconds: number): () => void {
  const handle = setInterval(tick, everyMilliseconds);
  return () => {
    clearInterval(handle);
  };
}

/**
 * The camera's state machine: consent, on, off, and one frame at a time.
 *
 * Every method that could reach the hardware checks consent first and refuses
 * without touching the port — see the file header.
 */
export class CameraController implements CameraThrottle, RiderPresencePort {
  readonly #port: CameraPort;
  readonly #sink: FrameSink;
  readonly #schedule: (tick: () => void, everyMilliseconds: number) => () => void;
  readonly #notices: (kind: CameraProblemKind) => CameraNotice;
  readonly #keep: FrameKeep | undefined;
  readonly #clock: () => number;
  readonly #wait: (milliseconds: number) => Promise<void>;
  readonly #analysis: (() => AnalysisPort | undefined) | undefined;
  readonly #listeners = new Set<() => void>();

  #consent: CameraConsent = NO_CONSENT;
  #session: CameraSession | undefined;
  #problem: CameraProblemKind | undefined = 'no-consent';
  #captured = 0;
  #keptThisSession = 0;
  #captureAllowed = true;
  #cancelPoll: (() => void) | undefined;
  #watchingPresence = false;
  #presenceAllowed = true;
  #presenceTracker: PresenceTracker = PRESENCE_NOT_OBSERVED;
  #presenceChecking = false;
  /**
   * Which watch a presence check belongs to — #516.
   *
   * Moved on by everything that resets {@link #presenceTracker}: stopping the
   * watch, starting it, and the ladder taking presence away or giving it back.
   * A check reads it before its first sample and throws its answer away when it
   * has moved, because comparing the SESSION is not enough: a
   * `watchPresence(false)` → `(true)` inside the 150 ms between the two
   * samples leaves the same session, a running watch and a freshly reset
   * tracker, and the old watch's observation would be written into it.
   */
  #presenceGeneration = 0;
  #cancelPresence: (() => void) | undefined;

  constructor(options: CameraControllerOptions) {
    this.#port = options.port;
    this.#keep = options.keep;
    // ⚠️ The keep IS the sink when there is one. Two objects would be the
    // arrangement where the rider turns the switch off and the next frame is
    // written anyway — `keep.ts` §`FrameKeep` records why they are one thing.
    this.#sink = options.sink ?? options.keep ?? discardTheFrame;
    this.#schedule = options.schedule ?? browserInterval;
    this.#notices = options.notices ?? cameraNotice;
    this.#clock = options.clock ?? Date.now;
    this.#wait = options.wait ?? browserWait;
    this.#analysis = options.analysis;
  }

  /** The current answer. Cheap; call it in a render. */
  state(): CameraState {
    return {
      consent: this.#consent,
      live: this.#session?.live ?? false,
      problem: this.#problem,
      captured: this.#captured,
      keeping: this.#keep?.keeping ?? false,
      keptThisSession: this.#keptThisSession,
      captureAllowed: this.#captureAllowed,
      watchingPresence: this.#watchingPresence,
      presenceAllowed: this.#presenceAllowed,
      presence: this.#presenceNow(),
    };
  }

  /** Call `listener` whenever {@link state} would answer differently. */
  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  /**
   * Record what the rider agreed to.
   *
   * @returns the refusal, or `undefined` when the consent was recorded. The
   * decision itself is `consent.ts` §`consentDecision`, which is pure and is
   * tested with no camera and no DOM.
   */
  agree(answers: ConsentAnswers): ReturnType<typeof consentDecision> {
    const decision = consentDecision(answers);
    if (decision.consent !== undefined) {
      this.#consent = decision.consent;
      this.#problem = undefined;
      this.#announce();
    }
    return decision;
  }

  /**
   * Take the consent back, and stop the camera if it is running.
   *
   * ⚠️ **The stop is the point, not the flag.** #382: *"Consent is revocable,
   * and revoking it stops capture, asserted by a test that revokes
   * mid-session."* A revocation that only set a boolean would leave the camera
   * running and the indicator showing, which is the worst of both — the rider
   * has withdrawn and the hardware has not heard.
   */
  revoke(): void {
    this.#consent = NO_CONSENT;
    this.turnOff();
    this.#problem = 'no-consent';
    this.#announce();
  }

  /**
   * Turn the camera on.
   *
   * @returns `undefined` when it is running, or the problem when it is not.
   */
  async turnOn(): Promise<CameraProblemKind | undefined> {
    if (!this.#consent.local) {
      // ⚠️ Before the port, deliberately — see the file header. Deleting this
      // guard opens a camera on a device nobody agreed on, and
      // `session.test.ts` §"the camera is off by default" catches it by
      // asserting the port was never called rather than by reading a flag.
      this.#problem = 'no-consent';
      this.#announce();
      return 'no-consent';
    }
    if (this.#session?.live === true) {
      return undefined;
    }
    const availability = await this.#port.cameraAvailability();
    if (availability.kind !== 'available') {
      return this.#fail(availability.kind);
    }
    const permission = await this.#port.requestCameraAccess();
    if (permission.kind !== 'granted') {
      return this.#fail(permission.kind);
    }
    try {
      this.#session = await this.#port.startCamera();
    } catch (error) {
      // The kind, and nothing else. `CameraCaptureError` carries no `cause` and
      // the adapter has already dropped the platform's own message — ADR 0029
      // D-8, and `camera-port.ts` §`CameraCaptureError` says why here rather
      // than at the call site.
      return this.#fail(error instanceof CameraCaptureError ? error.kind : 'unavailable');
    }
    this.#problem = undefined;
    this.#captured = 0;
    // Reset with `#captured`, because the two are read as one sentence: "N
    // taken since the camera was turned on, M of them on this device".
    this.#keptThisSession = 0;
    // ⚠️ **OFF at every switch-on, which is ADR 0029 D-2's "off every time".**
    // A rider who kept last time is not keeping this time, and this line is the
    // one that makes that true rather than the screen remembering to reset a
    // checkbox. `keep.test.ts` asserts it by turning the keep on, stopping,
    // starting again and capturing.
    this.#keep?.setKeeping(false);
    this.#startPolling();
    this.#announce();
    return undefined;
  }

  /** Turn the camera off. Idempotent. */
  turnOff(): void {
    this.#session?.stopCamera();
    this.#session = undefined;
    this.#stopPolling();
    // ⚠️ With the camera, not after it: a watch left running over no camera
    // would go on answering from its last observation until it went stale.
    // And this — with `#fail`'s — is what makes #390's switch OFF at every
    // switch-on: every way a camera stops passes through one of the two, so
    // the next `turnOn` finds it off. @see CameraState.watchingPresence
    this.#stopWatchingPresence();
    if (this.#problem === undefined) {
      this.#problem = this.#consent.local ? undefined : 'no-consent';
    }
    this.#announce();
  }

  /**
   * Play the running camera, live, into `surface` — the side camera's framing
   * screen (#528, ADR 0033 D-7).
   *
   * ⚠️ **Only a camera that is already running**, which is only ever one the
   * rider agreed to and turned on: this never opens a camera and never asks
   * the port for anything else. With no running camera it attaches nothing and
   * returns a detach that does nothing.
   *
   * ⚠️ The port's method is called lexically here, not in a private helper, for
   * `watchPresence`'s reason — `check:wiring` credits a `#private` body to the
   * class.
   *
   * @returns the detach. Call it when the element goes away.
   */
  showPreview(surface: PreviewSurface): () => void {
    const session = this.#session;
    if (session === undefined || !session.live) {
      return noPreview;
    }
    return session.attachCameraPreview(surface);
  }

  /**
   * Look once for a pairing code in what the running camera sees — #529,
   * [ADR 0033](../../../../docs/adr/0033-side-camera-link.md) D-1 and D-4.
   *
   * The phone reads the tablet's code this way, and the tablet the phone's.
   * ⚠️ **Only a camera that is already running**, which is only ever one the
   * rider agreed to and turned on, on THIS device — D-4: *"scanning counts as
   * camera use"*, so the consent flow has already been shown. It never opens a
   * camera and never asks the port for anything but the one read.
   *
   * ⚠️ **The pixels do not outlive this call**: they go to
   * `side-link-qr.ts` §`pairingCodeFromPixels` and are dropped with it — never
   * sent, never kept, never counted as a capture, and never analysed for
   * anything but a code (D-4).
   *
   * @returns the code's text, or `undefined` when there was no camera, no code,
   * or the read failed. Never rejects: the screen reads again on its next tick.
   */
  async readPairingCode(): Promise<string | undefined> {
    // No consent check of its own: a session exists only after `turnOn`, which
    // refuses without consent, and `revoke` ends it — so a running session IS
    // the consent, and a second check here could never fire.
    const session = this.#session;
    if (session === undefined || !session.live) {
      return undefined;
    }
    try {
      return pairingCodeFromPixels(await session.readCodePixels());
    } catch {
      return undefined;
    }
  }

  /**
   * Take one frame and hand it to the sink.
   *
   * ⚠️ **Nothing here holds the frame after this returns**, which is the
   * property #384's keep is then allowed to change in exactly one place. The
   * outcome carries a byte count and a pixel size and no part of the image —
   * ADR 0029 D-8's permitted column.
   *
   * ⚠️ **It never rejects.** Every failure — the camera's and the sink's — comes
   * back as a field on the {@link CaptureOutcome}, so a caller that writes
   * `void controller.captureOne().then(setOutcome)` cannot produce an unhandled
   * rejection. That is a promise this method makes to its callers rather than a
   * habit, and `session.test.ts` §"a sink that rejects" is what holds it.
   */
  async captureOne(): Promise<CaptureOutcome> {
    if (!this.#consent.local) {
      return refused('no-consent');
    }
    if (!this.#captureAllowed) {
      // The quality ladder has taken capture away for this ride —
      // `quality.ts` §`QualitySettings.capture` argues the ordering. The rider
      // is told the camera could not be opened, which is what has happened to
      // it: there is nothing they can do about a phone that is too hot except
      // wait, and `unavailable`'s instruction is the honest one.
      return refused('unavailable');
    }
    const session = this.#session;
    if (session === undefined || !session.live) {
      return refused('unavailable');
    }
    let frame: CapturedFrame;
    try {
      frame = await session.captureFrame();
    } catch (error) {
      return refused(error instanceof CameraCaptureError ? error.kind : 'unavailable');
    }
    // ⚠️ **The sink's rejection is caught here, and this is the one `catch` in
    // this file that is not about the camera.** In production the sink writes a
    // whole JPEG to IndexedDB, so a `QuotaExceededError` on a full device is
    // the expected failure rather than a remote one — and uncaught it escaped
    // through `captureOne`'s promise into a view that does not `catch`, which
    // is an unhandled rejection, no notice, and a counter that does not move.
    // Nothing of the error is read: ADR 0029 D-8, and a storage error's own
    // message routinely carries the key it could not write.
    let kept = false;
    let keepFailed = false;
    try {
      kept = await this.#sink.accept(frame);
    } catch {
      keepFailed = true;
    }
    this.#captured += 1;
    if (kept) {
      this.#keptThisSession += 1;
    }
    this.#announce();
    return {
      taken: true,
      problem: undefined,
      kept,
      keepFailed,
      bytes: frame.bytes.length,
      width: frame.width,
      height: frame.height,
    };
  }

  /**
   * Take one picture and ask the rider's own computer about it — #387.
   *
   * The order is the privacy argument, and each step refuses without doing the
   * next:
   *
   * 1. **Consent** — `consent.local`, exactly as {@link captureOne}. No port is
   *    touched without it.
   * 2. **Configuration** — the rider's computer, looked up NOW. Nothing
   *    configured, or configured and switched off, is `not-configured`
   *    **before the camera is asked for anything**: a picture taken only to be
   *    thrown away because there was nowhere to send it would still have been a
   *    picture of somebody's room.
   * 3. **The camera** — running, and permitted by the quality ladder.
   * 4. **One picture, one question** — and then the picture goes through the
   *    same {@link FrameSink} {@link captureOne} uses, so this ride's keep means
   *    what it says for an analysed picture too: kept if the rider asked,
   *    dropped otherwise. ADR 0029 D-2's *"discarded after analysis"* is this
   *    line.
   *
   * ⚠️ **Nothing the computer said reaches this controller's state.** The
   * outcome is returned to the caller and not stored, not announced, and not
   * compared with anything — in particular it touches neither the presence
   * tracker nor anything the ride reads through `ride/presence-port.ts`, which
   * is the one path from this class to a trainer (a paused ride eases one).
   * A model's words are attacker-influenceable through the image, and
   * `analysis-safety.test.ts` holds this by running a hostile answer through
   * and comparing the whole state before and after.
   *
   * ⚠️ **The port's method is called lexically inside this method**, not in a
   * private helper, for the reason {@link watchPresence} gives: `check:wiring`
   * credits a `#private` body to the class and would keep `askAboutFrame`
   * alive whatever called this.
   *
   * Never rejects. {@link AnalysisCall.cancel} stops the request, if one has
   * been made, and settles the outcome as `cancelled`.
   */
  askAboutPicture(question: AnalysisQuestion): AnalysisCall {
    let cancelled = false;
    let inFlight: AnalysisCall | undefined;
    const failed = (failure: AnalysisFailure): AnalysisOutcome => ({ kind: 'failed', failure });

    const outcome = (async (): Promise<AnalysisOutcome> => {
      if (!this.#consent.local) {
        return failed('no-picture');
      }
      const port = this.#analysis?.();
      if (port === undefined) {
        return failed('not-configured');
      }
      const session = this.#session;
      if (!this.#captureAllowed || session === undefined || !session.live) {
        return failed('no-picture');
      }
      let frame: CapturedFrame;
      try {
        frame = await session.captureFrame();
      } catch {
        return failed('no-picture');
      }
      if (cancelled) {
        return failed('cancelled');
      }
      inFlight = port.askAboutFrame({ frame, question });
      const answer = await inFlight.outcome;
      // The picture is done with. Kept if the rider asked, dropped otherwise —
      // and a keep that fails is not the analysis's failure, so it is swallowed
      // here exactly as `captureOne` swallows it, with nothing of the error read.
      let kept: boolean;
      try {
        kept = await this.#sink.accept(frame);
      } catch {
        kept = false;
      }
      this.#captured += 1;
      if (kept) {
        this.#keptThisSession += 1;
      }
      this.#announce();
      return answer;
    })();

    return {
      outcome,
      cancel: () => {
        cancelled = true;
        inFlight?.cancel();
      },
    };
  }

  /**
   * What the quality ladder currently permits — `quality.ts`
   * §`QualitySettings.capture`.
   *
   * ⚠️ **Turning capture off does NOT turn the camera off**, and the
   * distinction is the whole reason this is a separate flag rather than a call
   * to {@link turnOff}. A ride that steps down a rung and back up again would
   * otherwise be a camera that stops and restarts — which on Android means a
   * second permission check, a second hardware open, and an indicator that
   * flickers on the one screen where a flickering indicator is worst. What the
   * rung takes away is the work: encoding a frame is the expensive part, and
   * holding a track open is not.
   */
  throttle(captureAllowed: boolean): void {
    if (this.#captureAllowed === captureAllowed) {
      return;
    }
    this.#captureAllowed = captureAllowed;
    this.#announce();
  }

  /**
   * Turn this ride's keep on or off — #384.
   *
   * ⚠️ **Refused while the camera is off**, so the switch cannot be armed
   * before a session that would then reset it — which would read to a rider as
   * a control that does not work. It is a no-op rather than a throw: a view
   * that renders the switch outside a session is a view bug, not a rider error.
   */
  setKeeping(on: boolean): void {
    if (this.#session?.live !== true) {
      return;
    }
    this.#keep?.setKeeping(on);
    this.#announce();
  }

  /** How many pictures this device is holding. A count, never a picture. */
  async keptCount(): Promise<number> {
    return this.#keep?.count() ?? Promise.resolve(0);
  }

  /**
   * Deletes every picture this device kept — ADR 0029 D-2's rider-driven
   * expiry, and the only one that works in this milestone.
   */
  async forgetKept(): Promise<number> {
    const removed = (await this.#keep?.forget()) ?? 0;
    this.#announce();
    return removed;
  }

  /**
   * Turn #390's presence check on or off — "pause my ride when nobody is on
   * the bike".
   *
   * ⚠️ **It asks for nothing new and grants nothing new.** It runs only under
   * the consent the camera is already on under (`consent.local`), through the
   * same port and the same session, with the same live indicator showing — and
   * it touches neither {@link CameraConsent.hosted} nor the frame sink: a
   * presence check takes no frame, keeps nothing and sends nothing. Consent
   * for this is not consent for analysis, and `session.test.ts` §"#390"
   * asserts both halves.
   *
   * Refused while the camera is off, for the reason {@link setKeeping} is.
   */
  watchPresence(on: boolean): void {
    if (!on) {
      this.#stopWatchingPresence();
      this.#announce();
      return;
    }
    if (this.#session?.live !== true || !this.#consent.local || this.#watchingPresence) {
      return;
    }
    this.#watchingPresence = true;
    this.#presenceGeneration += 1;
    // ⚠️ **The two samples are taken HERE, lexically inside this method, and
    // not in a private helper — and that is `check:wiring` being made to see
    // the chain.** The gate splits a class into its methods by name so that a
    // method nothing calls does not keep what it calls alive, but it does not
    // split a `#private` one: that body is credited to the class, which is
    // reached whenever the camera is. Measured on the way in: with the samples
    // in a `#checkPresence`, deleting the Camera screen's only call of
    // `watchPresence` left `WIRE003` silent about `sampleLuminance`. Here, it
    // names it.
    this.#cancelPresence = this.#schedule(() => {
      void this.#observePresence(async (session) => {
        const first = await session.sampleLuminance();
        await this.#wait(PRESENCE_PAIR_GAP_MILLISECONDS);
        const second = await session.sampleLuminance();
        return observePair(first, second);
      });
    }, PRESENCE_CHECK_MILLISECONDS);
    this.#announce();
  }

  /**
   * What the quality ladder permits of presence — `quality.ts`
   * §`QualitySettings.presence`.
   *
   * ⚠️ **Withdrawn, the answer becomes `unknown` at once**, not at the next
   * stale deadline: the ride goes back to exactly the movement rule it had
   * before #390 on the same frame the ladder stepped down. Like
   * {@link throttle} it does not turn the camera off.
   */
  throttlePresence(presenceAllowed: boolean): void {
    if (this.#presenceAllowed === presenceAllowed) {
      return;
    }
    this.#presenceAllowed = presenceAllowed;
    this.#presenceTracker = PRESENCE_NOT_OBSERVED;
    this.#presenceGeneration += 1;
    this.#announce();
  }

  /**
   * Whether anybody is on the bike, for the ride — `ride/presence-port.ts`.
   *
   * `unknown` unless every one of these holds: the rider has consented, the
   * camera is running, the rider asked for presence, the ladder permits it —
   * and the last observation is recent. Cheap, and never throws: it is called
   * once per sensor reading.
   */
  riderPresence(): RiderPresence {
    return this.#presenceNow();
  }

  /**
   * ⚠️ **The same answer under a private name, and the name is the point.**
   * `check:wiring` matches member names as names, so every call of
   * `riderPresence` inside this class would keep the port method alive and
   * `WIRE003` could never fire for `ride/presence-port.ts`. Measured on the way
   * in: with {@link state} calling `riderPresence()`, deleting the ride
   * controller's only call left the gate green.
   */
  #presenceNow(): RiderPresence {
    if (!this.#presenceMayRun()) {
      return 'unknown';
    }
    return presenceAt(this.#presenceTracker, this.#clock());
  }

  /** The words for the current problem, or `null` while there is none. */
  notice(): CameraNotice | null {
    return this.#problem === undefined ? null : this.#notices(this.#problem);
  }

  #fail(kind: CameraProblemKind): CameraProblemKind {
    this.#session = undefined;
    this.#stopPolling();
    this.#stopWatchingPresence();
    this.#problem = kind;
    this.#announce();
    return kind;
  }

  #presenceMayRun(): boolean {
    return (
      this.#consent.local &&
      this.#session?.live === true &&
      this.#watchingPresence &&
      this.#presenceAllowed
    );
  }

  #stopWatchingPresence(): void {
    this.#cancelPresence?.();
    this.#cancelPresence = undefined;
    this.#watchingPresence = false;
    this.#presenceTracker = PRESENCE_NOT_OBSERVED;
    this.#presenceGeneration += 1;
  }

  /**
   * One presence check: two coarse samples a moment apart, compared, dropped.
   *
   * ⚠️ **Neither grid outlives this method.** They are locals; nothing is
   * handed to the sink, the store, a listener or a message, and what survives
   * is {@link PresenceTracker} — three primitives. A sample that fails is
   * `unreadable`, which is `unknown`, which pauses nothing; the error itself is
   * not read, for ADR 0029 D-8's reason.
   *
   * Skipped when the previous check has not finished, so a slow camera cannot
   * pile up samples behind the timer.
   *
   * `look` is what takes the samples; {@link watchPresence} says why it is
   * passed in rather than written here.
   */
  async #observePresence(
    look: (session: CameraSession) => Promise<ReturnType<typeof observePair>>,
  ): Promise<void> {
    const session = this.#session;
    if (!this.#presenceMayRun() || session === undefined || this.#presenceChecking) {
      return;
    }
    this.#presenceChecking = true;
    const generation = this.#presenceGeneration;
    const before = this.#presenceNow();
    try {
      let observation: ReturnType<typeof observePair>;
      try {
        observation = await look(session);
      } catch {
        observation = 'unreadable';
      }
      // The world may have changed while the samples were taken: the camera
      // turned off, the watch stopped, the ladder stepped down. An answer for
      // a watch that is no longer running would be written into a tracker
      // that has just been reset — and so would one for a watch that was
      // stopped and started again inside the pair gap, which the session
      // comparison alone cannot see (#516).
      if (
        !this.#presenceMayRun() ||
        this.#session !== session ||
        this.#presenceGeneration !== generation
      ) {
        return;
      }
      this.#presenceTracker = nextPresence(this.#presenceTracker, observation, this.#clock());
    } finally {
      this.#presenceChecking = false;
    }
    if (this.#presenceNow() !== before) {
      this.#announce();
    }
  }

  #startPolling(): void {
    this.#stopPolling();
    this.#cancelPoll = this.#schedule(() => {
      if (this.#session !== undefined && !this.#session.live) {
        // The camera went away without this client asking — the rider revoked
        // the permission from the operating system's own indicator, or
        // something else took the device. The indicator must follow the
        // hardware rather than follow our last intention.
        this.turnOff();
      }
    }, LIVENESS_POLL_MILLISECONDS);
  }

  #stopPolling(): void {
    this.#cancelPoll?.();
    this.#cancelPoll = undefined;
  }

  #announce(): void {
    for (const listener of this.#listeners) {
      listener();
    }
  }
}

function refused(problem: CameraProblemKind): CaptureOutcome {
  return { taken: false, problem, kept: false, keepFailed: false, bytes: 0, width: 0, height: 0 };
}

/** The detach for a preview that was never attached. */
function noPreview(): void {
  /* nothing was attached, so there is nothing to detach */
}
