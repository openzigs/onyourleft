// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The side camera's JPEG encoder, off the page's main thread** —
 * [#1112](https://github.com/openzigs/onyourleft/issues/1112).
 *
 * ## Why it is not `canvas.toBlob`
 *
 * The owner's phone sent about 0.3 pictures a second where ADR 0033 D-3 asks
 * for five. A 256 px JPEG takes a few milliseconds to encode, so the time was
 * not the encode — it was the WAIT for one. Chromium encodes a main-thread
 * `toBlob` (and a main-thread `OffscreenCanvas.convertToBlob`) JPEG or PNG in
 * **idle tasks**, and only starts it unprompted after
 * `kIdleTaskStartTimeoutDelayMs` — **4 000 ms on Android**, 1 000 ms on a
 * desktop — when the page gives it no idle period first; a started encode
 * that idle time cannot finish is forced after a further 9 000 ms on Android
 * (`third_party/blink/renderer/core/html/canvas/canvas_async_blob_creator.cc`
 * §`ScheduleAsyncBlobCreation`, read 2026-10-04). Off the main thread there is
 * no idle scheduling: *"we do not need to use background task runner … So we
 * just directly encode images on the worker thread"*.
 *
 * Measured in the pinned Chromium on 2026-10-04 with a 256 × 144 canvas: idle,
 * every path took 0–7 ms; with a main thread that is never idle (one 4 ms
 * task after another), `toBlob` and a main-thread `convertToBlob` took
 * **1 013–1 016 ms each**, the desktop timeout to the millisecond, and this
 * worker took **8 ms**. `browser/sidecamera.browser.spec.ts` §"#1112" holds
 * that through the real filming screen. ⚠️ **What keeps the WebView's main
 * thread from idling on the owner's phone is not established** — the
 * timeout's 4 s and the measured 1.3–3 s a picture agree with it, and the
 * device reading (`side-picture-timings.ts`) is what confirms it.
 *
 * ## The re-encode is unchanged (ADR 0029 D-9)
 *
 * The page still draws the video's pixels into a canvas; what crosses to the
 * worker is an `ImageBitmap` of that canvas — pixels, not a camera file — and
 * the worker draws it into an `OffscreenCanvas` and encodes it, so the JPEG is
 * still made here from pixels and still goes through `frame.ts`
 * §`capturedFrame`'s metadata tripwire. The worker fetches nothing, keeps
 * nothing and imports nothing but its message shapes.
 *
 * ## When the worker cannot be had
 *
 * An engine with no `Worker`, `OffscreenCanvas` or `createImageBitmap`, a
 * worker that errors, and a worker that does not answer inside
 * {@link SIDE_ENCODE_DEADLINE_MILLISECONDS} all fall back to
 * {@link mainThreadJpegEncoder} for the rest of the session: slow pictures
 * rather than none, and `side-picture-timings.ts` says which encoder ran.
 */

import { CameraCaptureError } from './camera-port';
import { FRAME_MEDIA_TYPE, FRAME_QUALITY } from './frame';
import { cameraProblemMessage } from './notice';
import { sideEncodeReplyFrom, type SideEncodeRequest } from './side-encode-messages';
import type { SidePictureEncoder } from './side-picture-timings';

/** One encoded picture, and which encoder made it. */
export interface EncodedSidePicture {
  readonly bytes: Uint8Array;
  readonly encoder: SidePictureEncoder;
}

/** Turns a drawn canvas into JPEG bytes. */
export interface JpegEncoder {
  /** @throws {CameraCaptureError} from the fixed table, never a platform message. */
  encode(canvas: HTMLCanvasElement): Promise<EncodedSidePicture>;
  /**
   * Lets go of the worker, if there is one. Idempotent. The worker encoder
   * then refuses a picture in flight or asked for afterwards rather than
   * encoding it (ADR 0033 D-5; {@link workerJpegEncoder}).
   */
  release(): void;
}

/**
 * How long the worker is given to answer one picture before the session falls
 * back to the main thread: two seconds.
 *
 * ## Provenance — the author's choice, not a measurement
 *
 * The worker answered in 8 ms in the pinned Chromium and a cold worker's first
 * answer is its script's load, tens of milliseconds. Two seconds is far above
 * both and still shorter than the main thread's own 4 s wait on Android, so a
 * worker that has gone quiet costs one slow picture rather than every one.
 */
export const SIDE_ENCODE_DEADLINE_MILLISECONDS = 2000;

/** The slice of a `Worker` the encoder uses, so a test can supply one. */
export interface EncoderWorkerLike {
  postMessage(message: unknown, transfer: Transferable[]): void;
  terminate(): void;
  onmessage: ((event: { readonly data: unknown }) => void) | null;
  onerror: ((event: unknown) => void) | null;
}

/**
 * The real worker.
 *
 * ⚠️ **This exact expression is what Vite looks for** — `new Worker(new
 * URL(…, import.meta.url), …)` — as `pose-estimator.ts` §`poseWorker` says.
 */
export function sideEncoderWorker(): EncoderWorkerLike {
  return new Worker(new URL('./side-picture-encoder-worker.ts', import.meta.url), {
    type: 'module',
    name: 'oyl-side-picture',
  }) as unknown as EncoderWorkerLike;
}

/** What {@link workerJpegEncoder} is built from, so a test needs no engine. */
export interface WorkerEncoderOptions {
  readonly worker: () => EncoderWorkerLike;
  readonly bitmap: (canvas: HTMLCanvasElement) => Promise<ImageBitmap>;
  readonly fallback: JpegEncoder;
  readonly after?: ((task: () => void, milliseconds: number) => () => void) | undefined;
}

function timeoutAfter(task: () => void, milliseconds: number): () => void {
  const handle = setTimeout(task, milliseconds);
  return () => {
    clearTimeout(handle);
  };
}

/** The fixed refusal for a picture asked for, or still in flight, after release. */
function releasedError(): CameraCaptureError {
  return new CameraCaptureError('unavailable', cameraProblemMessage('unavailable'));
}

/** What one picture's wait on the worker ends in. */
type WorkerAnswer = { readonly bytes: Uint8Array } | 'failed' | 'released';

/**
 * The encoder that hands each picture to a worker, and falls back to
 * `options.fallback` for good the first time the worker fails.
 *
 * ⚠️ **Released is not failed.** A picture asked for, or still in flight,
 * after {@link JpegEncoder.release} is refused with the fixed
 * `CameraCaptureError` and never handed to the fallback: the session has
 * stopped, and ADR 0033 D-5 says a picture then is dropped at once, not
 * encoded on the main thread and dropped afterwards.
 */
export function workerJpegEncoder(options: WorkerEncoderOptions): JpegEncoder {
  const after = options.after ?? timeoutAfter;
  let worker: EncoderWorkerLike | undefined;
  let broken = false;
  let released = false;
  let next = 0;
  // The one picture waiting on the worker. One at a time is the session's own
  // rule (`side-camera.ts`), so there is never a second to keep apart — but a
  // deadline armed for one picture can still go off while the NEXT one waits,
  // which is why its timer asks whose waiter this is before it acts.
  let waiting: ((reply: WorkerAnswer) => void) | undefined;

  const giveUp = (): void => {
    broken = true;
    worker?.terminate();
    worker = undefined;
    waiting?.('failed');
  };

  const ready = (): EncoderWorkerLike | undefined => {
    if (broken) {
      return undefined;
    }
    if (worker === undefined) {
      try {
        worker = options.worker();
      } catch {
        broken = true;
        return undefined;
      }
      worker.onerror = giveUp;
    }
    return worker;
  };

  return {
    async encode(canvas: HTMLCanvasElement): Promise<EncodedSidePicture> {
      if (released) {
        throw releasedError();
      }
      const current = ready();
      if (current === undefined) {
        return options.fallback.encode(canvas);
      }
      let bitmap: ImageBitmap;
      try {
        bitmap = await options.bitmap(canvas);
      } catch {
        if (released) {
          throw releasedError();
        }
        giveUp();
        return options.fallback.encode(canvas);
      }
      if (released) {
        bitmap.close();
        throw releasedError();
      }
      next += 1;
      const id = next;
      const reply = await new Promise<WorkerAnswer>((resolve) => {
        let cancel: () => void = () => undefined;
        const own = (answer: WorkerAnswer): void => {
          cancel();
          if (waiting === own) {
            waiting = undefined;
          }
          resolve(answer);
        };
        waiting = own;
        cancel = after(() => {
          // Only this picture's own wait: a late deadline from an earlier
          // picture must not fail the one waiting now (#1112's review).
          if (waiting === own) {
            own('failed');
          }
        }, SIDE_ENCODE_DEADLINE_MILLISECONDS);
        current.onmessage = (event) => {
          const answer = sideEncodeReplyFrom(event.data, id);
          if (answer !== undefined) {
            waiting?.(answer);
          }
        };
        try {
          const request: SideEncodeRequest = {
            id,
            bitmap,
            mediaType: FRAME_MEDIA_TYPE,
            quality: FRAME_QUALITY,
          };
          current.postMessage(request, [bitmap]);
        } catch {
          // Not transferred, so still ours to close.
          bitmap.close();
          own('failed');
        }
      });
      if (reply === 'released') {
        throw releasedError();
      }
      if (reply === 'failed') {
        giveUp();
        return options.fallback.encode(canvas);
      }
      return { bytes: reply.bytes, encoder: 'worker' };
    },
    release(): void {
      released = true;
      worker?.terminate();
      worker = undefined;
      waiting?.('released');
      options.fallback.release();
    },
  };
}

/**
 * `canvas.toBlob`, as an encoder — the path every picture took before #1112,
 * kept as the fallback. ⚠️ **Subject to Chromium's idle-task wait** (this
 * file's header), which is why it is no longer the first choice.
 */
export function mainThreadJpegEncoder(): JpegEncoder {
  return {
    async encode(canvas: HTMLCanvasElement): Promise<EncodedSidePicture> {
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (made) => {
            if (made === null) {
              reject(new CameraCaptureError('unavailable', cameraProblemMessage('unavailable')));
              return;
            }
            resolve(made);
          },
          FRAME_MEDIA_TYPE,
          FRAME_QUALITY,
        );
      });
      return { bytes: new Uint8Array(await blob.arrayBuffer()), encoder: 'main-thread' };
    },
    release(): void {
      // Nothing held.
    },
  };
}

/**
 * The encoder the side camera uses: the worker where the engine has
 * everything it needs, the main thread where it does not.
 */
export function sidePictureEncoder(): JpegEncoder {
  const fallback = mainThreadJpegEncoder();
  if (
    typeof Worker !== 'function' ||
    typeof OffscreenCanvas !== 'function' ||
    typeof createImageBitmap !== 'function'
  ) {
    return fallback;
  }
  return workerJpegEncoder({
    worker: sideEncoderWorker,
    bitmap: async (canvas) => createImageBitmap(canvas),
    fallback,
  });
}
