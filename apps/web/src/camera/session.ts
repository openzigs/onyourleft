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
 * And it sends nothing. There is no `fetch` in this client at all and
 * `privacy/no-network.test.ts` is the gate that keeps it that way.
 */

import type {
  CameraNotice,
  CameraPort,
  CameraProblemKind,
  CameraSession,
  CapturedFrame,
} from './camera-port';
import { CameraCaptureError } from './camera-port';
import { consentDecision, NO_CONSENT, type CameraConsent, type ConsentAnswers } from './consent';
import type { FrameKeep } from './keep';
import { cameraNotice } from './notice';

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
   * Whether the next picture will be kept — #384, ADR 0029 D-2.
   *
   * **`false` every time the camera is turned on**, and there is nowhere it is
   * persisted. `keep.ts` is the whole of it.
   */
  readonly keeping: boolean;
  /**
   * Whether the quality ladder currently permits a capture — `quality.ts`
   * §`QualitySettings.capture`.
   *
   * `true` until a ride steps the ladder down. @see CameraController.throttle
   */
  readonly captureAllowed: boolean;
}

/** What a caller is told about a capture, with nothing of the picture in it. */
export interface CaptureOutcome {
  readonly taken: boolean;
  /** The refusal, when there was one. @see cameraNotice */
  readonly problem: CameraProblemKind | undefined;
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
  /** Takes the frame. Returns when it is done with it. */
  accept(frame: CapturedFrame): Promise<void>;
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
  accept: async (): Promise<void> => {
    await Promise.resolve();
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
export class CameraController {
  readonly #port: CameraPort;
  readonly #sink: FrameSink;
  readonly #schedule: (tick: () => void, everyMilliseconds: number) => () => void;
  readonly #notices: (kind: CameraProblemKind) => CameraNotice;
  readonly #keep: FrameKeep | undefined;
  readonly #listeners = new Set<() => void>();

  #consent: CameraConsent = NO_CONSENT;
  #session: CameraSession | undefined;
  #problem: CameraProblemKind | undefined = 'no-consent';
  #captured = 0;
  #captureAllowed = true;
  #cancelPoll: (() => void) | undefined;

  constructor(options: CameraControllerOptions) {
    this.#port = options.port;
    this.#keep = options.keep;
    // ⚠️ The keep IS the sink when there is one. Two objects would be the
    // arrangement where the rider turns the switch off and the next frame is
    // written anyway — `keep.ts` §`FrameKeep` records why they are one thing.
    this.#sink = options.sink ?? options.keep ?? discardTheFrame;
    this.#schedule = options.schedule ?? browserInterval;
    this.#notices = options.notices ?? cameraNotice;
  }

  /** The current answer. Cheap; call it in a render. */
  state(): CameraState {
    return {
      consent: this.#consent,
      live: this.#session?.live ?? false,
      problem: this.#problem,
      captured: this.#captured,
      keeping: this.#keep?.keeping ?? false,
      captureAllowed: this.#captureAllowed,
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
    if (this.#problem === undefined) {
      this.#problem = this.#consent.local ? undefined : 'no-consent';
    }
    this.#announce();
  }

  /**
   * Take one frame and hand it to the sink.
   *
   * ⚠️ **Nothing here holds the frame after this returns**, which is the
   * property #384's keep is then allowed to change in exactly one place. The
   * outcome carries a byte count and a pixel size and no part of the image —
   * ADR 0029 D-8's permitted column.
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
    await this.#sink.accept(frame);
    this.#captured += 1;
    this.#announce();
    return {
      taken: true,
      problem: undefined,
      bytes: frame.bytes.length,
      width: frame.width,
      height: frame.height,
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

  /** The words for the current problem, or `null` while there is none. */
  notice(): CameraNotice | null {
    return this.#problem === undefined ? null : this.#notices(this.#problem);
  }

  #fail(kind: CameraProblemKind): CameraProblemKind {
    this.#session = undefined;
    this.#stopPolling();
    this.#problem = kind;
    this.#announce();
    return kind;
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
  return { taken: false, problem, bytes: 0, width: 0, height: 0 };
}
