// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The browser's camera, behind the port** (#382).
 *
 * This is the only file in the client that names `getUserMedia`, a
 * `MediaStream` or an `HTMLVideoElement`, and `boundary.test.ts` is what keeps
 * that true. The rule is `packages/sensors`': *"Web Bluetooth types must not
 * escape above the transport boundary"*, applied to a second platform API — and
 * for the same reason, which is that #383's Android path and #328's classifier
 * both have to be satisfiable by the same interface.
 *
 * ## The re-encode is the privacy guarantee, and it is one line
 *
 * [ADR 0029](../../../../docs/adr/0029-camera-imagery-as-a-data-class.md) D-9:
 * a frame is *"re-encoded from raw pixels, not filtered"*, at capture, in one
 * place. That place is {@link canvasFrameGrabber}: the video track is drawn
 * onto a canvas and the **canvas** is asked for an image. A canvas holds
 * pixels; it has nowhere to put an Exif GPS IFD, an XMP packet or an IPTC
 * block, so the output has none — not because they were removed but because
 * they were never in the pipeline.
 *
 * ⚠️ **`frame.ts` refuses anything that came back carrying one anyway**, which
 * is the check on this guarantee rather than the guarantee itself. A future
 * adapter that reached for the sensor's own JPEG — `ImageCapture.takePhoto()`
 * is the obvious candidate and returns exactly that — would leak the rider's
 * front door, and every test above it would stay green because a JPEG is a
 * JPEG. `capturedFrame` throws instead.
 *
 * ## Why every platform object is injected
 *
 * jsdom implements no `getUserMedia`, no `<video>` playback and no canvas 2D
 * context, so a module that reached for `navigator.mediaDevices` directly could
 * not be tested at all — and the states that matter most are the refusals,
 * which no test machine can produce on demand even in a real browser.
 * `main.tsx` is the one caller that reads the real browser, exactly as it is
 * for `probeBrowser` and `platformWakeLock`.
 *
 * ⚠️ **What the injection does NOT cover is the one line that matters**, and it
 * is said here rather than left implied: the re-encode itself runs only in a
 * real engine. `browser/shell.browser.spec.ts` §"the camera, in a real engine"
 * is where it is exercised — Chromium is launched with
 * `--use-fake-device-for-media-stream`, which gives a synthetic camera, and the
 * spec asserts that a real `getUserMedia` → canvas → `toBlob` round trip
 * produces a JPEG whose bytes carry no metadata marker. Without it, the whole
 * of D-9 would rest on a fake returning whatever the test author typed.
 */

import { CameraCaptureError } from './camera-port';
import type {
  CameraAvailability,
  CameraPermission,
  CameraPort,
  CameraProblemKind,
  CameraSession,
  CapturedFrame,
  LuminanceGrid,
} from './camera-port';
import { capturedFrame, FRAME_MEDIA_TYPE, FRAME_QUALITY } from './frame';
import { cameraProblemMessage } from './notice';
import { lumaGrid, PRESENCE_GRID_COLUMNS, PRESENCE_GRID_ROWS } from './presence';

/** The slice of `MediaStreamTrack` this module uses. */
export interface VideoTrackLike {
  /** `'live'` while the camera is running; `'ended'` once it is not. */
  readonly readyState: string;
  /**
   * `true` while the track is live but delivering no frames — #516.
   *
   * ⚠️ **`readyState` stays `'live'` through this**, which is why it is read
   * separately: the operating system suspending the camera, or another
   * application taking it, mutes the track rather than ending it, and the
   * `<video>` goes on drawing the last frame it had. Optional, because a
   * double that says nothing about it is a track that is not muted.
   */
  readonly muted?: boolean;
  /**
   * ⚠️ `stop`, not `stopCamera` — this mirrors `MediaStreamTrack`, whose method
   * is called `stop`, and a name of our own would stop the real object being
   * assignable to it. {@link CameraSession.stopCamera} is the one that carries
   * a distinctive name, and `camera-port.ts` says why.
   */
  stop(): void;
}

/** The slice of `MediaStream` this module uses. */
export interface MediaStreamLike {
  getVideoTracks(): readonly VideoTrackLike[];
}

/** The slice of `navigator.mediaDevices` this module uses. */
export interface MediaDevicesLike {
  getUserMedia(constraints: unknown): Promise<MediaStreamLike>;
  /**
   * Optional, because a browser may expose `getUserMedia` and not this.
   *
   * ⚠️ **It is used for `cameraAvailability()` only, and it is NOT authoritative
   * about whether a camera exists.** Before any permission is granted, a
   * browser reports device entries with empty labels and — in some versions —
   * reports a `videoinput` for a device that has none, or none for a device
   * that has one. So an empty list is read as `no-camera` and a non-empty one
   * as `available`, and the real answer comes from `getUserMedia` rejecting,
   * which is the call that actually knows.
   */
  enumerateDevices?: () => Promise<readonly { readonly kind: string }[]>;
}

/** One frame's worth of pixels, encoded. @see canvasFrameGrabber */
export interface GrabbedFrame {
  readonly bytes: Uint8Array;
  readonly mediaType: string;
  readonly width: number;
  readonly height: number;
}

/**
 * Turns a live stream into encoded bytes.
 *
 * Injected rather than imported so that {@link browserCameraPort} is reachable
 * from a test with no canvas — see the file header for what that costs and
 * where the cost is paid.
 */
export interface FrameGrabber {
  grab(stream: MediaStreamLike): Promise<GrabbedFrame>;
  /**
   * A sampler of coarse brightness grids over this stream — #390.
   *
   * A second member rather than a use of {@link grab}, because a presence
   * check must not pay for a full-size draw and a JPEG encode twice every two
   * seconds; and a sampler rather than a one-shot, because it holds one
   * playing `<video>` for the session instead of starting one per sample.
   */
  luminance(stream: MediaStreamLike): LuminanceSampler;
}

/** Coarse brightness grids from one stream. @see FrameGrabber.luminance */
export interface LuminanceSampler {
  /** @throws {CameraCaptureError} from the fixed table, never a platform message. */
  sample(): Promise<LuminanceGrid>;
  /** Lets go of whatever the sampler holds. Idempotent. */
  release(): void;
}

/** What a camera is asked for. @see browserCameraPort */
export interface BrowserCameraOptions {
  /**
   * ⚠️ Called `devices` rather than `mediaDevices`, which is the name it has on
   * `navigator`. `boundary.test.ts` forbids that word outside this directory
   * and a property key is a word — so a caller writing
   * `mediaDevices: somethingElse` would be a red test in a file that had done
   * nothing wrong. Renaming the *key* is cheaper than loosening the scan,
   * because what the scan is for is a platform object being carried around
   * under its own name by code with no business holding one.
   */
  readonly devices: MediaDevicesLike;
  readonly grabber: FrameGrabber;
  /**
   * Whether this page may use a camera at all.
   *
   * `isSecureContext` in production. A camera is gated on a secure context in
   * every browser that has one, and a page opened from the disk as `file://` is
   * not one — which is a real state for this product, because the bundle is
   * something a rider can download and open. `support/bluetooth-support.ts`
   * makes the same check for the same reason and #48's first criterion is why:
   * no control that looks like the way in and cannot work.
   */
  readonly secureContext: boolean;
  /**
   * Whether the page is hidden right now — #516. Omitted, it reads
   * `document.hidden`; injected so a test can hide a page jsdom will not.
   *
   * ⚠️ **A hidden page's sample is refused**, which is `unreadable`, which is
   * `unknown`. Chrome keeps a hidden tab's timers running, so the presence
   * check would otherwise go on taking fresh-looking samples of a `<video>`
   * the browser may have stopped decoding — two grids of one frozen frame,
   * `still`, and fifteen seconds later a rider who is pedalling is `absent`.
   * `presence.ts` §`observePair`'s frame check catches the same picture from
   * the other side; this one does not depend on the platform saying where
   * the video had got.
   */
  readonly hidden?: (() => boolean) | undefined;
}

/** `document.hidden`, or `false` where there is no document. @see BrowserCameraOptions.hidden */
function documentHidden(): boolean {
  return globalThis.document?.hidden === true;
}

/**
 * What a rejection from `getUserMedia` means.
 *
 * ⚠️ **The mapping takes the `name` and throws the `message` away.** A
 * `DOMException`'s message is written by the browser and can name a device —
 * *"Requested device not found"* is the harmless end, and Chromium has shipped
 * messages carrying a device label. ADR 0029 D-8's scope is *"every layer that
 * formats one"*, and this is the layer where a platform string would otherwise
 * enter the program.
 *
 * The four names are the ones the Media Capture and Streams specification
 * defines for this call. Anything else is `unavailable`, which is the honest
 * answer for "the camera did not open and we do not know why".
 */
function problemFor(error: unknown): CameraProblemKind {
  const name = error instanceof Error ? error.name : '';
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'not-permitted';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'no-camera';
    default:
      return 'unavailable';
  }
}

/**
 * What the camera is asked for.
 *
 * ⚠️ `facingMode: 'environment'` is an **ideal**, not a requirement: on the
 * owner's arrangement — a second phone on a tripod, side-on — the rear camera
 * is the one pointing at the rider, and on a laptop there is only one camera
 * and an exact constraint would make `getUserMedia` reject with
 * `OverconstrainedError` rather than use it.
 *
 * ⚠️ There is **no resolution constraint**, deliberately. Asking for a
 * specific size makes the browser scale, which costs a copy per frame for a
 * property nothing in this milestone reads; `frame.ts` records the actual
 * dimensions instead, so whatever the device gave is what is written down.
 */
export const CAMERA_CONSTRAINTS = {
  video: { facingMode: { ideal: 'environment' } },
  audio: false,
} as const;

/**
 * This browser's own media devices, or `undefined`.
 *
 * ⚠️ **The read lives HERE rather than in `main.tsx`**, which is otherwise
 * *"the one file that may read a global"*, and the reason is `boundary.test.ts`:
 * the rule it enforces is that no camera platform name appears outside
 * `apps/web/src/camera/`, and `navigator.mediaDevices` is one. An exception for
 * one file would be an exception a second file inherits — `support/capacitor.ts`
 * and `support/persistent-storage.ts` both make the same move for the same
 * reason, each owning the one global its own feature needs.
 *
 * `undefined` on every browser where the API is absent, which includes every
 * page that is not a secure context — a bundle opened straight off the disk as
 * `file://` among them, which is a real state for this product.
 */
export function platformMediaDevices(): MediaDevicesLike | undefined {
  const devices = globalThis.navigator?.mediaDevices as MediaDevicesLike | undefined;
  return devices === undefined || typeof devices.getUserMedia !== 'function' ? undefined : devices;
}

/**
 * A {@link CameraPort} over a browser's own media devices.
 *
 * ⚠️ **`requestCameraAccess()` and `startCamera()` are the same platform call**, and that is a
 * property of the web platform rather than a shortcut here: there is no way to
 * ask a browser for camera permission without asking for a camera. So
 * `requestCameraAccess()` opens a stream, **stops it immediately**, and reports the answer;
 * `startCamera()` opens one and keeps it. The cost is that a rider sees the camera
 * light blink once when they grant permission, and the alternative — folding
 * the two into one method — would make the port unimplementable on a platform
 * where they genuinely are separate, which is every native one.
 */
export function browserCameraPort(options: BrowserCameraOptions): CameraPort {
  const { devices, grabber, secureContext } = options;
  const hidden = options.hidden ?? documentHidden;

  return {
    async cameraAvailability(): Promise<CameraAvailability> {
      if (!secureContext) {
        return { kind: 'unsupported' };
      }
      const enumerate = devices.enumerateDevices;
      if (enumerate === undefined) {
        // No way to ask in advance. That is not a fault: `startCamera()` is the call
        // that knows, and reporting `available` here lets the rider reach it.
        return { kind: 'available' };
      }
      try {
        const listed = await enumerate.call(devices);
        return listed.some((device) => device.kind === 'videoinput')
          ? { kind: 'available' }
          : { kind: 'no-camera' };
      } catch {
        // A browser that refuses to enumerate has told us nothing about
        // whether there is a camera, so `startCamera()` is still worth reaching.
        return { kind: 'available' };
      }
    },

    async requestCameraAccess(): Promise<CameraPermission> {
      if (!secureContext) {
        return { kind: 'unsupported' };
      }
      try {
        const stream = await devices.getUserMedia(CAMERA_CONSTRAINTS);
        // Stopped at once: this call exists to raise the prompt, not to hold
        // the hardware. Leaving it running would light the camera from the
        // moment consent was given, which is precisely the thing the indicator
        // is supposed to mean something about.
        for (const track of stream.getVideoTracks()) {
          track.stop();
        }
        return { kind: 'granted' };
      } catch (error) {
        return { kind: problemFor(error) };
      }
    },

    async startCamera(): Promise<CameraSession> {
      if (!secureContext) {
        throw new CameraCaptureError('unsupported', cameraProblemMessage('unsupported'));
      }
      let stream: MediaStreamLike;
      try {
        stream = await devices.getUserMedia(CAMERA_CONSTRAINTS);
      } catch (error) {
        const kind = problemFor(error);
        throw new CameraCaptureError(kind, cameraProblemMessage(kind));
      }
      return browserSession(stream, grabber, hidden);
    },
  };
}

function browserSession(
  stream: MediaStreamLike,
  grabber: FrameGrabber,
  hidden: () => boolean,
): CameraSession {
  let stopped = false;
  // Made on the first presence check and let go with the camera, so a session
  // that never checks presence never builds one.
  let sampler: LuminanceSampler | undefined;
  return {
    get live(): boolean {
      if (stopped) {
        return false;
      }
      // Read from the TRACK rather than from our own flag: a track ends when
      // the rider revokes the permission from the operating system's own
      // indicator, or when something else takes the device, and neither goes
      // through this object. `session.ts` polls this so the live indicator
      // follows the hardware.
      return stream.getVideoTracks().some((track) => track.readyState === 'live');
    },
    async captureFrame(): Promise<CapturedFrame> {
      if (stopped) {
        throw new CameraCaptureError('unavailable', cameraProblemMessage('unavailable'));
      }
      let grabbed: GrabbedFrame;
      try {
        grabbed = await grabber.grab(stream);
      } catch (error) {
        // A `CameraCaptureError` from the grabber already carries a message
        // from the fixed table; anything else is a platform string and is
        // replaced rather than wrapped. ADR 0029 D-8.
        if (error instanceof CameraCaptureError) {
          throw error;
        }
        throw new CameraCaptureError('unavailable', cameraProblemMessage('unavailable'));
      }
      return capturedFrame(grabbed);
    },
    async sampleLuminance(): Promise<LuminanceGrid> {
      if (stopped) {
        throw new CameraCaptureError('unavailable', cameraProblemMessage('unavailable'));
      }
      // #516. A muted track and a hidden page are both a camera that is not
      // delivering new pictures while every flag says it is running, and a
      // `<video>` in that state draws its LAST frame — a pair of which reads
      // as `still`. Refused before the draw, so the answer is `unknown`.
      if (hidden() || stream.getVideoTracks().some((track) => track.muted === true)) {
        throw new CameraCaptureError('unavailable', cameraProblemMessage('unavailable'));
      }
      sampler ??= grabber.luminance(stream);
      try {
        return await sampler.sample();
      } catch (error) {
        // The same rule as `captureFrame`: the fixed wording or nothing.
        if (error instanceof CameraCaptureError) {
          throw error;
        }
        throw new CameraCaptureError('unavailable', cameraProblemMessage('unavailable'));
      }
    },
    stopCamera(): void {
      stopped = true;
      sampler?.release();
      sampler = undefined;
      for (const track of stream.getVideoTracks()) {
        track.stop();
      }
    },
  };
}

/**
 * The real grabber: a `<video>` playing the stream, drawn onto a canvas, asked
 * for a JPEG.
 *
 * ⚠️ **Every step of this is the D-9 guarantee and none of it is reachable from
 * jsdom**, which implements no media playback and no 2D context. It is
 * exercised in `browser/shell.browser.spec.ts` against a real Chromium with a
 * synthetic camera; see the file header.
 *
 * ⚠️ The video element is **not** attached to the document. It does not need to
 * be — `drawImage` reads from the element, not from the layout — and attaching
 * it would put a live picture of the rider on a screen nobody asked to see it
 * on, which is ADR 0029 D-11's own concern arriving through a back door.
 */
export function canvasFrameGrabber(): FrameGrabber {
  return {
    luminance: videoLuminanceSampler,
    async grab(stream: MediaStreamLike): Promise<GrabbedFrame> {
      // The cast is the boundary: above this line the program has a
      // `MediaStreamLike`, and only the browser's own API needs the real thing.
      const media = stream as unknown as MediaStream;
      const video = document.createElement('video');
      video.srcObject = media;
      video.muted = true;
      video.playsInline = true;
      try {
        await video.play();
        await onceReady(video);
        const width = video.videoWidth;
        const height = video.videoHeight;
        if (width === 0 || height === 0) {
          throw new CameraCaptureError('unavailable', cameraProblemMessage('unavailable'));
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d');
        if (context === null) {
          throw new CameraCaptureError('unavailable', cameraProblemMessage('unavailable'));
        }
        context.drawImage(video, 0, 0, width, height);
        const blob = await toBlob(canvas);
        return {
          bytes: new Uint8Array(await blob.arrayBuffer()),
          mediaType: FRAME_MEDIA_TYPE,
          width,
          height,
        };
      } finally {
        // Detached whatever happened, so a failed capture does not leave an
        // element holding the stream alive.
        video.srcObject = null;
      }
    },
  };
}

/**
 * The real presence sampler: one detached `<video>` playing the stream, drawn
 * straight into a {@link PRESENCE_GRID_COLUMNS} × {@link PRESENCE_GRID_ROWS}
 * canvas and read back — #390.
 *
 * ⚠️ **The browser does the downscale** — `drawImage` into a canvas that
 * small is the whole of the resizing — so what crosses back from the GPU is
 * 768 pixels, not a frame. No encode, no `Blob`, nothing that could be written
 * anywhere; `lumaGrid` turns the pixels into brightness and the RGBA buffer is
 * dropped with the call.
 *
 * `willReadFrequently`, because this canvas exists to be read back every two
 * seconds and the hint keeps it off the GPU, which is what makes a readback a
 * copy rather than a pipeline stall on the thread drawing the world.
 *
 * Exported, rather than reached only through {@link canvasFrameGrabber}, for
 * one caller: `browser/game-harness.ts`, which measures what a sample costs
 * with the renderer running. Like the rest of this file's platform half it is
 * reachable from no jsdom suite.
 */
export function videoLuminanceSampler(stream: MediaStreamLike): LuminanceSampler {
  const media = stream as unknown as MediaStream;
  const video = document.createElement('video');
  video.srcObject = media;
  video.muted = true;
  video.playsInline = true;
  const canvas = document.createElement('canvas');
  canvas.width = PRESENCE_GRID_COLUMNS;
  canvas.height = PRESENCE_GRID_ROWS;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  let started: Promise<void> | undefined;
  return {
    async sample(): Promise<LuminanceGrid> {
      if (context === null) {
        throw new CameraCaptureError('unavailable', cameraProblemMessage('unavailable'));
      }
      started ??= video.play().then(async () => onceReady(video));
      try {
        await started;
      } catch (error) {
        // Tried again on the next check rather than failing for the rest of
        // the session: a video that would not start once may start the next
        // time, and a sampler that stayed broken would be `unknown` for ever.
        started = undefined;
        throw error;
      }
      // #516. Read immediately before the draw. A frame landing between the
      // two lines is the only gap, and it can only happen on a camera that IS
      // delivering frames — which is not the frozen source this is for.
      const frame = frameProgress(video);
      context.drawImage(video, 0, 0, PRESENCE_GRID_COLUMNS, PRESENCE_GRID_ROWS);
      const pixels = context.getImageData(0, 0, PRESENCE_GRID_COLUMNS, PRESENCE_GRID_ROWS);
      return { ...lumaGrid(pixels.data, PRESENCE_GRID_COLUMNS, PRESENCE_GRID_ROWS), frame };
    },
    release(): void {
      video.pause();
      video.srcObject = null;
    },
  };
}

/** The little of a `<video>` {@link frameProgress} reads, so a test can supply one. */
export interface FrameProgressSource {
  readonly currentTime: number;
  getVideoPlaybackQuality?: () => { readonly totalVideoFrames: number };
}

/**
 * How far a playing `<video>` has got — the count of frames it has been
 * handed, or failing that its playback position — #516.
 *
 * ⚠️ **Measured rather than assumed**, in the pinned Chromium (revision 1243)
 * on a DETACHED element, which is what {@link videoLuminanceSampler} holds: a
 * `canvas.captureStream(0)` that is never asked for another frame — a frozen
 * source made to order — leaves `totalVideoFrames` at 1 and `currentTime` at 0
 * across 450 ms, while the same stream driven with `requestFrame()` advances
 * both, and the synthetic camera advances both by about three frames in
 * 150 ms. `game.browser.spec.ts` §"a frozen source" holds that in the gate.
 *
 * `totalVideoFrames` first because it counts pictures, which is the question;
 * `currentTime` second because it is on every element. `undefined` only for
 * an element that reports neither as a number, and then nothing is inferred.
 */
export function frameProgress(video: FrameProgressSource): number | undefined {
  const quality = video.getVideoPlaybackQuality?.();
  if (quality !== undefined && Number.isFinite(quality.totalVideoFrames)) {
    return quality.totalVideoFrames;
  }
  return Number.isFinite(video.currentTime) ? video.currentTime : undefined;
}

/**
 * How long a granted camera is given to produce its first frame.
 *
 * ⚠️ **The wait this bounds is NOT the permission prompt**, and conflating the
 * two is how it came to be unbounded. `requestCameraAccess()` waits for a
 * person to answer a dialog and has to wait as long as they take; by the time
 * `grab` runs the rider has already answered and the hardware is open, so a
 * `loadeddata` that never arrives is a camera that has stopped producing
 * frames — another application taking the device, a USB camera unplugged, a
 * driver that has wedged. Waiting for ever on that leaves a listener and a live
 * stream attached to an element nothing will ever detach, with the operating
 * system's own camera indicator lit and no notice on the screen.
 *
 * Five seconds, which is long for a camera that is working — a webcam's first
 * frame is tens of milliseconds and a cold phone camera is a few hundred — and
 * short enough that a rider gets a sentence rather than a spinner.
 */
export const FIRST_FRAME_MILLISECONDS = 5000;

/** The little of a `<video>` {@link onceReady} needs, so a test can supply one. */
export interface FrameReadySource {
  readonly readyState: number;
  readonly HAVE_CURRENT_DATA: number;
  addEventListener(type: 'loadeddata', listener: () => void): void;
  removeEventListener(type: 'loadeddata', listener: () => void): void;
}

/**
 * Resolves once the element has a frame to draw.
 *
 * @throws {CameraCaptureError} of kind `unavailable` when no frame arrives
 * inside {@link FIRST_FRAME_MILLISECONDS}. The message is the fixed one — this
 * is a message about a frame and ADR 0029 D-8 binds it, so it names no element,
 * no `blob:` URL and no timing.
 *
 * ⚠️ **The listener is removed on every path**, including the timeout, and the
 * timer is cleared on every path including the event. Either half left behind
 * is a leak on the one page that holds a camera open.
 */
export async function onceReady(
  video: FrameReadySource,
  withinMilliseconds = FIRST_FRAME_MILLISECONDS,
): Promise<void> {
  if (video.readyState >= video.HAVE_CURRENT_DATA) {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const settle = (): void => {
      clearTimeout(timer);
      video.removeEventListener('loadeddata', onLoaded);
    };
    const onLoaded = (): void => {
      settle();
      resolve();
    };
    const timer = setTimeout(() => {
      settle();
      reject(new CameraCaptureError('unavailable', cameraProblemMessage('unavailable')));
    }, withinMilliseconds);
    video.addEventListener('loadeddata', onLoaded);
  });
}

/**
 * `canvas.toBlob`, as a promise.
 *
 * ⚠️ It hands back `null` rather than rejecting when it cannot encode, which is
 * the sort of API contract that turns into a `TypeError` three frames later.
 * The `null` is turned into the same fixed-message error as everything else
 * here.
 */
async function toBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob === null) {
          reject(new CameraCaptureError('unavailable', cameraProblemMessage('unavailable')));
          return;
        }
        resolve(blob);
      },
      FRAME_MEDIA_TYPE,
      FRAME_QUALITY,
    );
  });
}
