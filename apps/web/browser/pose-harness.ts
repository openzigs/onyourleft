// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The side camera's pose model, in a real engine** — #530.
 *
 * Everything the tablet runs on a picture, through exactly what production
 * uses: `camera/pose-estimator.ts` §`workerPoseEstimator` with its default
 * worker — the real `pose-worker.ts`, bundled by Vite, the network fence
 * first, MediaPipe Pose Landmarker lite on its CPU delegate, the runtime
 * `tools/pose/pose-runtime-plugin.ts` serves and the weights committed in
 * `public/pose/`, all from this page's own origin.
 *
 * It looks at three pictures:
 *
 * 1. **A photograph of a rider side-on** (`side-rider.jpg`, CC0, recorded in
 *    `ASSETS.toml`) — which must come back as a pose, near side and landmarks,
 *    because a pipeline that answered "nobody here" to everything would pass
 *    every other check on this page.
 * 2. **A blank picture**, drawn here — which must come back as nobody, the
 *    control for the first.
 * 3. **Bytes that are not a picture** — which must come back unreadable
 *    rather than hang or take the worker down.
 *
 * Then, on a worker of its own, it asks MediaPipe to CLOSE its task, which is
 * when MediaPipe flushes the usage log it keeps (`camera/pose-runtime.ts`
 * §"The runtime reports usage to Google unless it is stopped"), and waits.
 * The spec watches every request the page and its workers make and requires
 * each to be on this origin.
 *
 * ## What this does NOT prove
 *
 * - **Accuracy.** One photograph of a stranger, once. #385's accuracy half —
 *   repeatability, a known saddle-height change — needs a rider, and nobody
 *   has run it.
 * - **The tablet's cost.** Timings are printed for the runner the gate ran on,
 *   which is not a Pixel Tablet; spike 0010 §5 is the published per-picture
 *   cost on the tablet.
 * - **The Android shell.** The WebView served from `https://localhost/` by
 *   Capacitor is where the runtime's `.wasm` MIME type is Capacitor's to set;
 *   this page is served by `vite preview`. [#554](https://github.com/openzigs/onyourleft/issues/554)
 *   is the device measurement.
 */

import { poseWorker, workerPoseEstimator } from '../src/camera/pose-estimator';
import type { SidePoseOutcome } from '../src/camera/side-analysis-port';

import riderUrl from './side-rider.jpg?url';

/** What the page publishes on `window.__oylPose`. */
export interface PoseMeasurement {
  readonly errors: readonly string[];
  readonly rider: SidePoseOutcome | undefined;
  readonly blank: SidePoseOutcome | undefined;
  readonly noise: SidePoseOutcome | undefined;
  /** The first picture's milliseconds, which include loading the model. */
  readonly firstMilliseconds: number | undefined;
  /** Ten more of the rider, one at a time, in milliseconds. */
  readonly pacedMilliseconds: readonly number[];
  /** Whether the close was asked for and waited out. */
  readonly closed: boolean;
}

declare global {
  interface Window {
    __oylPose?: PoseMeasurement;
  }
}

/** A white JPEG, `width` × `height`, with nobody in it. */
async function blankJpeg(width: number, height: number): Promise<Uint8Array> {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (context !== null) {
    context.fillStyle = '#f4f1ea';
    context.fillRect(0, 0, width, height);
  }
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, 'image/jpeg', 0.8);
  });
  return new Uint8Array(await (blob ?? new Blob()).arrayBuffer());
}

async function run(): Promise<PoseMeasurement> {
  const errors: string[] = [];
  const rider = new Uint8Array(await (await fetch(riderUrl)).arrayBuffer());
  const estimator = workerPoseEstimator();

  const started = performance.now();
  // A copy each time: the estimator transfers what it is given.
  const riderOutcome = await estimator.estimateSidePose(rider.slice());
  const firstMilliseconds = performance.now() - started;
  const pacedMilliseconds: number[] = [];
  for (let index = 0; index < 10; index += 1) {
    const at = performance.now();
    await estimator.estimateSidePose(rider.slice());
    pacedMilliseconds.push(performance.now() - at);
  }
  const blank = await estimator.estimateSidePose(await blankJpeg(256, 144));
  const noise = await estimator.estimateSidePose(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]));
  estimator.closeSidePoseModel();

  // A worker of its own, driven by hand, for the one thing the estimator
  // never does: ask MediaPipe to close its task, which flushes the log.
  let closed = false;
  try {
    const worker = poseWorker();
    await new Promise<void>((resolve) => {
      worker.onmessage = () => {
        resolve();
      };
      worker.onerror = () => {
        errors.push('the second worker failed');
        resolve();
      };
      const picture = rider.slice().buffer;
      worker.postMessage({ id: 0, picture }, [picture]);
    });
    worker.postMessage({ close: true });
    // Long enough for a flush to be attempted and refused, or sent.
    await new Promise((resolve) => setTimeout(resolve, 2000));
    worker.terminate();
    closed = true;
  } catch (error) {
    errors.push(`the close was not made: ${String(error)}`);
  }

  return {
    errors,
    rider: riderOutcome,
    blank,
    noise,
    firstMilliseconds,
    pacedMilliseconds,
    closed,
  };
}

run().then(
  (measurement) => {
    window.__oylPose = measurement;
  },
  (error: unknown) => {
    window.__oylPose = {
      errors: [String(error)],
      rider: undefined,
      blank: undefined,
      noise: undefined,
      firstMilliseconds: undefined,
      pacedMilliseconds: [],
      closed: false,
    };
  },
);
