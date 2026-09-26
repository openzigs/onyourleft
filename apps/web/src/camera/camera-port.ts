// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **What this client may ask of a camera, and the five things it is told when
 * it may not** ([#382](https://github.com/openzigs/onyourleft/issues/382)).
 *
 * One port, shared with [#328](https://github.com/openzigs/onyourleft/issues/328)
 * by owner decision D-C on [#377](https://github.com/openzigs/onyourleft/issues/377):
 * *"ONE camera-capture pipeline and ONE consent flow, built once, used by
 * both."* `boundary.test.ts` is what keeps that a fact rather than an
 * intention — `check:wiring` cannot catch a duplicate, because two wired
 * modules are both wired.
 *
 * ## Why this is a `*-port.ts`, and what the suffix buys
 *
 * CLAUDE.md §4j: `check:wiring` watches `apps/web/src/game/`,
 * `apps/web/src/ride/`, `apps/web/src/offline/` and **every `*-port.ts` under
 * `apps/`**. A camera module in a directory of its own would be in none of the
 * three, so a correct, unit-tested, typechecked capture pipeline that nothing
 * called would be invisible — which is the defect #278 was opened for and which
 * §5's mutation requirement provably cannot see, because a test calling
 * something is not evidence that anything ships it.
 *
 * ⚠️ **Every method here carries a DISTINCTIVE name, and that is the suffix
 * being made to work rather than decoration.** `check-wiring.mjs`'s own header
 * says *"names are matched as names — `member:initialize` is one node however
 * many types declare it"*, and this port's obvious names —
 * `availability`, `request`, `start`, `capture`, `stop` — are among the most
 * common member names in this client: `ride/controller.ts`, `recording/`,
 * `game/` and `packages/sensors` between them declare or call all five.
 *
 * ⚠️ **Measured on the way in.** With the obvious names, deleting **all three**
 * of this port's calls from `CameraController` left `check:wiring` **green**:
 * `member:start` was reached through some unrelated `start`, so `WIRE003`
 * could not fire for this port at all and the `*-port.ts` suffix bought
 * nothing. With `cameraAvailability`, `requestCameraAccess`, `startCamera` and
 * `captureFrame`, deleting one call is a red `WIRE003` naming it. The mutation
 * list in this pull request records both runs.
 *
 * ⚠️ **The cover is still partial, in exactly the shape
 * `support/shell-support-port.ts` records for #284.** Have `main.tsx` pass
 * `camera: undefined` into `AppShell`, so the Camera screen is handed nothing:
 * the gate stays **green**. That is `check-wiring.mjs` §Limits' third entry —
 * *"a prop threaded through JSX it does not follow"* — and no suffix here can
 * close it. What stands in its place is `CameraView.test.tsx`, which drives the
 * branch, and this paragraph.
 *
 * ## Why the interface is here and the Android half is not
 *
 * `apps/web` depends on `@onyourleft/mobile`, so `apps/mobile` cannot depend
 * back without a workspace cycle — and CLAUDE.md §4h's rule is that the split
 * is *by capability, not by folder*: `apps/mobile/capacitor.config.ts` sets
 * `webDir: '../web/dist'`, so the shell ships **this** bundle and a capture
 * pipeline written under `apps/mobile/src` would typecheck, test green and
 * never be copied into the APK.
 *
 * So the shape is `support/shell-support-port.ts`'s, which #382 names as the
 * worked example: the **interface and both implementations live here**, and
 * `apps/mobile` supplies the parts only Android knows — its wording, and what
 * it can say about the manifest it ships — as data passed in.
 *
 * ## What a frame is, in this program
 *
 * [ADR 0029](../../../../docs/adr/0029-camera-imagery-as-a-data-class.md) D-1:
 * camera imagery is **its own data class**, never a stream channel beside
 * power, cadence and heart rate, never inside a `StreamSet`, and never covered
 * by a rule whose subject is "activity data". {@link CapturedFrame} is
 * therefore a type of this module's own, and `boundary.test.ts` asserts it
 * reaches no file outside `apps/web/src/camera/` — the same rule
 * `packages/sensors` states about Web Bluetooth types not escaping the
 * transport boundary.
 *
 * ⚠️ **A frame arrives already stripped of metadata, and that is a property of
 * the constructor rather than a habit of the callers** — ADR 0029 D-9, and
 * `frame.ts` is the one place it happens. The reason it is at capture and not
 * at an export boundary is that `privacy/boundaries.ts` **cannot see inside a
 * `Blob`**: `coordinatesIn` walks a JavaScript structure for finite numeric
 * `latitude`/`longitude`, and an EXIF GPS IFD is bytes. A departing boundary
 * over a payload with a frame in it is green for a reason unrelated to the
 * frame.
 */

/** Why a camera cannot be used here. @see CameraNotice */
export type CameraProblemKind =
  /** No camera API at all — an old browser, or a page served over plain HTTP. */
  | 'unsupported'
  /** The API is there and the device reports no camera. */
  | 'no-camera'
  /** The rider, or the operating system, said no. */
  | 'not-permitted'
  /** Something else has it, or the hardware failed to open. */
  | 'unavailable'
  /**
   * The rider has not agreed to this yet.
   *
   * ⚠️ **Not an error state and not a failure of the device.** It is the
   * ordinary state of a fresh install, and `session.ts` §`CameraController`
   * returns it **without touching the port at all** — #382's own criterion is
   * that the camera is off by default, *"not a disabled button, no capture"*.
   */
  | 'no-consent';

/**
 * What a rider is told about a problem, already worded.
 *
 * ⚠️ **A fixed table rather than a formatted error, and that is ADR 0029 D-8
 * being enforced rather than described.** That rule says a message about
 * imagery may name *that there was an image* and *what went wrong with it*, and
 * must never carry the image, a part of it, a rendering of it, **or a locator
 * for it** — no data URL, no `blob:` URL, no filesystem path, no cache key, no
 * content hash. It binds harder than ADR 0004 decision D's coordinate rule,
 * because that one lets a non-coordinate quantity keep its value on the
 * argument that *"the value is most of the diagnostic"*, and nothing about an
 * image is diagnosed by having the image in the message.
 *
 * The only way to keep that true for every future caller is to give the module
 * nothing to interpolate: a platform's `DOMException` is mapped to one of five
 * kinds and its own text is **discarded**. `notice.test.ts` asserts that a
 * rejection carrying a `blob:` URL in its message produces a notice that does
 * not contain it.
 */
export interface CameraNotice {
  /** What happened, not what the rider did wrong. */
  readonly title: string;
  /** Why, in one sentence, in the rider's terms rather than the platform's. */
  readonly explanation: string;
  /**
   * The one thing to do **outside this app**, or `null` when there is none.
   *
   * `null` covers two cases and both are right: a stack with no camera API,
   * where nothing helps; and a state whose only action is to answer the
   * consent screen, which is already on the page. Prose telling a rider to
   * press the control beside it is noise — `support/shell-support.ts`
   * §`INSTRUCTION` makes the same call for the same reason.
   */
  readonly instruction: string | null;
  /** Whether asking again could change the answer. */
  readonly recoverable: boolean;
}

/** What a platform says about its camera, before anything is opened. */
export interface CameraAvailability {
  readonly kind: 'available' | CameraProblemKind;
}

/** What a platform says after the rider has been asked. */
export interface CameraPermission {
  readonly kind: 'granted' | CameraProblemKind;
}

/**
 * One still, stripped, in memory.
 *
 * ⚠️ **Opaque above this module.** Phase C decides what may cross a boundary
 * ([#387](https://github.com/openzigs/onyourleft/issues/387)); until then the
 * only things that touch `bytes` are `frame.ts`, which produces them, and
 * `session.ts`, which either drops them or hands them to the store. Widening
 * that is a change somebody has to make on purpose, and `boundary.test.ts`
 * turns red when they do it by accident.
 *
 * No filename, no path, no object URL and no source device name — there is
 * nothing here for D-8 to leak even if a future caller formatted the whole
 * object into a log line.
 */
export interface CapturedFrame {
  /** The re-encoded image. @see frame.ts for what "re-encoded" guarantees */
  readonly bytes: Uint8Array;
  /** `image/jpeg`. Fixed, because the encoder is fixed. */
  readonly mediaType: string;
  readonly width: number;
  readonly height: number;
}

/**
 * A very coarse brightness grid, for one question only: did anything move —
 * [#390](https://github.com/openzigs/onyourleft/issues/390).
 *
 * ⚠️ **It is not a frame and it is never treated as one.** It is
 * `presence.ts` §`PRESENCE_GRID_COLUMNS` × §`PRESENCE_GRID_ROWS` cells of
 * luminance and nothing else: no colour, no encoding, no container, so there
 * is no metadata for `frame.ts` to refuse and nothing a file could be made
 * of. It is compared with the one taken a moment before and **dropped** — it
 * never reaches `session.ts` §`FrameSink`, a store, a log or a message, and
 * `boundary.test.ts` holds it inside this directory the way it holds
 * {@link CapturedFrame}.
 *
 * ADR 0029 D-8 lists *"a downscale"* on the forbidden side of what a MESSAGE
 * may carry, and this is one; the rule it follows is therefore the frame's —
 * held in memory for the length of one comparison and formatted into nothing.
 */
export interface LuminanceGrid {
  readonly columns: number;
  readonly rows: number;
  /** Row-major, one byte of luminance per cell, 0 black to 255 white. */
  readonly values: Uint8Array;
  /**
   * How far the source had got when this grid was drawn — a count of the
   * frames it had delivered, or its playback position — or `undefined` where
   * the platform cannot say. #516.
   *
   * ⚠️ **What stops a frozen picture reading as an empty room.** A `<video>`
   * that has stopped receiving frames — a muted track, a stalled USB webcam, a
   * hidden tab whose video Chrome stopped decoding — still draws its last
   * frame, so two grids of a pair are the same picture and would read as
   * `still`. `presence.ts` §`observePair` reads a pair whose second grid is no
   * further on than its first as `unreadable` instead. A number that only ever
   * goes up and says nothing about what is in the picture.
   */
  readonly frame?: number | undefined;
}

/**
 * One picture's pixels, for one question only: is there a pairing code in it
 * — #529, [ADR 0033](../../../../docs/adr/0033-side-camera-link.md) D-4.
 *
 * ⚠️ **Not a frame, and never treated as one**, on {@link LuminanceGrid}'s
 * terms: no encoding and no container, handed to `side-link-qr.ts`
 * §`pairingCodeFromPixels` and dropped with the call. D-4: *"decoded in memory
 * for the code only, discarded as soon as a code is read or scanning is
 * cancelled, never sent, never kept and never analysed for anything else"*.
 * `boundary.test.ts` holds it inside this directory.
 */
export interface CodePixels {
  readonly width: number;
  readonly height: number;
  /** Row-major RGBA, four bytes a pixel. */
  readonly rgba: Uint8ClampedArray;
}

/**
 * Where a live preview is shown — #528.
 *
 * The slice of a `<video>` element {@link CameraSession.attachCameraPreview}
 * uses, and nothing more, so this module names no platform type
 * (`boundary.test.ts`).
 *
 * ⚠️ **A preview is not a frame.** Nothing here draws the picture into a
 * canvas, encodes it or hands it to anything: the platform plays the camera's
 * own stream into an element on the screen and the pixels never reach this
 * program's code. ADR 0029 D-11's rule is about a KEPT frame on a screen
 * somebody could meet by accident; a live preview on the capturing phone,
 * while the camera's own indicator is showing, is what the owner chose for
 * framing (#386, ADR 0033 D-7).
 */
export interface PreviewSurface {
  srcObject: unknown;
  muted: boolean;
  playsInline: boolean;
  play(): Promise<void>;
}

/**
 * A camera that is on.
 *
 * ⚠️ Nothing here is bounded, on purpose, and the reason is
 * `shell-support-port.ts`'s: a rider reading an operating system's permission
 * dialog is not a hang, so a deadline on {@link CameraPort.start} would
 * abandon the answer at exactly the moment it was about to arrive. What the
 * rider gets instead is a live indicator that appears only once a track is
 * really running, which is the honest signal and is #382's third criterion.
 */
export interface CameraSession {
  /**
   * One frame, now.
   *
   * @throws never. A capture that cannot be taken rejects with a
   * {@link CameraCaptureError}, whose message is drawn from the fixed table in
   * `notice.ts` and carries nothing of the frame — D-8.
   */
  captureFrame(): Promise<CapturedFrame>;
  /**
   * One coarse brightness grid, now — #390's presence check.
   *
   * ⚠️ **Deliberately not {@link captureFrame}**: a frame is drawn at full
   * size and JPEG-encoded, which `quality.ts` §`QualitySettings.capture` calls
   * the most expensive thing this client does during a ride. A presence check
   * needs neither the size nor the encoding, so it asks the platform for the
   * few hundred numbers it uses and nothing more.
   *
   * @throws never with anything of the picture in it: a sample that cannot be
   * taken rejects with a {@link CameraCaptureError} from the fixed table.
   */
  sampleLuminance(): Promise<LuminanceGrid>;
  /**
   * One picture's pixels, now, at most {@link CODE_PIXELS_LONG_SIDE} on its
   * long side — #529's pairing-code reader, and nothing else.
   *
   * ⚠️ **Deliberately not {@link captureFrame}**: nothing is encoded, so there
   * is no file a picture could become, and the size is bounded because a QR
   * code across a metre needs no more.
   *
   * @throws never with anything of the picture in it: a read that cannot be
   * taken rejects with a {@link CameraCaptureError} from the fixed table.
   */
  readCodePixels(): Promise<CodePixels>;
  /**
   * One small frame, now, at most {@link SIDE_FRAME_LONG_SIDE} on its long
   * side — the side camera's picture for the tablet (#530, ADR 0033 D-3).
   *
   * ⚠️ **A frame in every sense {@link captureFrame} is**: re-encoded from
   * pixels and passed through `frame.ts` §`capturedFrame`, so ADR 0029 D-9's
   * one strip point is unchanged. It differs only in size, and in holding one
   * `<video>` and one canvas for the session rather than one per picture,
   * because it is asked for five times a second.
   *
   * @throws never with anything of the picture in it: a capture that cannot
   * be taken rejects with a {@link CameraCaptureError} from the fixed table.
   */
  captureSideFrame(): Promise<CapturedFrame>;
  /**
   * Play this camera, live, into `surface` — the side camera's framing screen
   * (#528).
   *
   * @returns the detach, which stops the surface playing and holds no
   * reference to it. Idempotent. Stopping the camera detaches nothing on its
   * own, because the surface is the caller's element; a stopped camera simply
   * has nothing left to play.
   */
  attachCameraPreview(surface: PreviewSurface): () => void;
  /** Releases the hardware. Idempotent: stopping a stopped session is a no-op. */
  stopCamera(): void;
  /**
   * Whether the camera is still running.
   *
   * Read rather than assumed, because a track can end without this client
   * asking — a rider revoking the permission from the operating system's own
   * indicator, another application taking the device, a phone being unplugged.
   * `session.ts` polls it so the live indicator goes out when the camera does
   * rather than when this client next happens to call something.
   */
  readonly live: boolean;
}

/**
 * The longest side, in pixels, a pairing-code read is drawn at: 640. A code on
 * a tablet or a phone at arm's length fills a good part of the picture, and
 * `jsqr` reads one of version 10 at this size; a larger read is more work on
 * the thread drawing the screen, several times a second, for nothing.
 */
export const CODE_PIXELS_LONG_SIDE = 640;

/**
 * The longest side, in pixels, of a side-camera picture: 256.
 *
 * The owner's figure (#527: *"about 5 per second, at the model's input size
 * (~256 px)"*), which spike 0010 costed on the tablet with a 256 × 256
 * picture. Pose Landmarker lite takes a 256-pixel input, so a larger picture
 * would be scaled down on the tablet after crossing the link at several times
 * the size — the bytes on the wire and the pixels the model sees are the same
 * picture at this size.
 */
export const SIDE_FRAME_LONG_SIDE = 256;

/**
 * Which way a camera faces — #557.
 *
 * `'environment'` is the back of the device, the one a tripod phone points at
 * the rider. `'user'` is the screen's side, the one the TABLET reads the
 * phone's pairing code with: the two screens face each other, so the tablet
 * can show a viewfinder and the rider can see both codes at once. Reading it
 * with the back camera meant pointing the tablet's back at the phone with
 * neither screen in view, which the owner could not do (#557).
 */
export type CameraFacing = 'environment' | 'user';

/** The one seam between this client and a camera. */
export interface CameraPort {
  /** What this platform can say before anything is opened. Never rejects. */
  cameraAvailability(): Promise<CameraAvailability>;
  /**
   * Ask the rider, through whatever the platform's own prompt is.
   *
   * ⚠️ On Android this is the call that raises the runtime permission dialog,
   * and it is reached only from the Camera screen's own control — #383's
   * criterion that *"the permission is not requested at app start"*. A camera
   * prompt on first launch of a cycling app is the thing that gets an app
   * uninstalled, and nothing in a manifest prevents it.
   *
   * Never rejects: every platform failure is one of {@link CameraProblemKind}.
   */
  requestCameraAccess(): Promise<CameraPermission>;
  /**
   * Turn the camera on.
   *
   * @param facing - which way the camera should face, as a PREFERENCE: a
   * device with one camera uses it whichever way it faces. `'environment'`
   * when omitted.
   *
   * @throws {CameraCaptureError} with a notice from the fixed table, never a
   * platform message. See {@link CameraNotice}.
   */
  startCamera(facing?: CameraFacing): Promise<CameraSession>;
}

/**
 * What a camera failure is, once every trace of the frame has been dropped.
 *
 * ⚠️ It carries a {@link CameraProblemKind} and **not** the platform's error.
 * `cause` is deliberately not set: a `DOMException` from `getUserMedia` can
 * name a device, and a rejection from an encoder can carry a data URL, and both
 * would then travel into whatever a caller logs. D-8's scope is *"every layer
 * that formats one"*, so the layer that could is the one that drops it.
 */
export class CameraCaptureError extends Error {
  readonly kind: CameraProblemKind;

  constructor(kind: CameraProblemKind, message: string) {
    super(message);
    this.name = 'CameraCaptureError';
    this.kind = kind;
  }
}
