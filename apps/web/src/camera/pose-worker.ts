// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The pose model, in a worker** — [#530](https://github.com/openzigs/onyourleft/issues/530).
 *
 * MediaPipe Pose Landmarker **lite**, on its CPU delegate, in a Web Worker:
 * spike 0010 §7's candidate, and the configuration that cost the ride no
 * frames beside the renderer (§5.4: 65.8 / 80.9 ms p50 / p95 per picture over
 * ten minutes at 5 a second on the Pixel Tablet; §5.5: 68.0 / 83.0 ms in the
 * app's own WebView). On the page's main thread it cost 191–203 missed frames
 * in 40 s, which is why it is here.
 *
 * ⚠️ **Nothing here is reachable from jsdom.** Every rule it runs under is in
 * `pose-runtime.ts`, which is; this file wires them to MediaPipe, and
 * `browser/pose.browser.spec.ts` is its gate, in the pinned Chromium, against
 * a CC0 photograph of a rider side-on.
 *
 * ## Why the loader is imported, and not fetched
 *
 * MediaPipe normally fetches a loader script for its WebAssembly and runs it
 * with `importScripts` — which throws in a module worker, where it falls back
 * to `import()` of a DIFFERENT build of the loader (the `_module_` one), with
 * a different `.wasm` beside it. Vite serves this worker as a module in
 * development and builds it as a classic script, so the two would need two
 * runtimes of 11 MB each. Instead the module loader is imported here, which
 * sets `ModuleFactory` on the worker's global, and MediaPipe is given no
 * loader path at all — so it skips the load and uses the factory it finds
 * (`vision_bundle.mjs`: *"if(e&&await $h(e),!self.ModuleFactory)throw"*).
 * One runtime, in both.
 *
 * ## The order of the first three lines is load-bearing
 *
 * {@link fenceWorkerNetwork} runs BEFORE MediaPipe is evaluated, and imports
 * are evaluated before a module's own statements — so the fence is its own
 * module (`pose-fence.ts`), imported first, and the two MediaPipe imports
 * come after it. `pose-runtime.ts` says why there is a fence at all.
 */

import './pose-fence';
import '@mediapipe/tasks-vision/vision_wasm_module_internal.js';
import { PoseLandmarker } from '@mediapipe/tasks-vision';

import {
  poseAssetUrl,
  POSE_MODEL_FILE,
  POSE_RUNTIME_WASM_FILE,
  type PoseReply,
  type PoseRequest,
} from './pose-runtime';

/** The slice of a dedicated worker's scope this file uses. */
interface PoseWorkerScope {
  onmessage: ((event: { readonly data: unknown }) => void) | null;
  postMessage(message: PoseReply): void;
  readonly location: { readonly origin: string };
}

const scope = globalThis as unknown as PoseWorkerScope;
const origin = scope.location.origin;

let model: Promise<PoseLandmarker | undefined> | undefined;

/** The model, loaded once. `undefined` for good once it has failed to load. */
async function load(): Promise<PoseLandmarker | undefined> {
  model ??= PoseLandmarker.createFromOptions(
    {
      // Empty: the factory is already on the global (see the header).
      wasmLoaderPath: '',
      wasmBinaryPath: poseAssetUrl(POSE_RUNTIME_WASM_FILE, import.meta.env.BASE_URL, origin),
    },
    {
      baseOptions: {
        modelAssetPath: poseAssetUrl(POSE_MODEL_FILE, import.meta.env.BASE_URL, origin),
        delegate: 'CPU',
      },
      runningMode: 'IMAGE',
      numPoses: 1,
      outputSegmentationMasks: false,
    },
  ).catch(() => undefined);
  return model;
}

/** One picture: decode it, look at it, drop it. */
async function answer(request: PoseRequest): Promise<PoseReply> {
  const landmarker = await load();
  if (landmarker === undefined) {
    return { id: request.id, kind: 'unavailable' };
  }
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(new Blob([request.picture], { type: 'image/jpeg' }));
  } catch {
    return { id: request.id, kind: 'unreadable' };
  }
  try {
    const found = landmarker.detect(bitmap).landmarks[0] ?? [];
    return {
      id: request.id,
      kind: 'landmarks',
      width: bitmap.width,
      height: bitmap.height,
      values: found.flatMap((point) => [point.x, point.y, point.visibility]),
    };
  } catch {
    return { id: request.id, kind: 'unreadable' };
  } finally {
    // The decoded picture goes now, not when the collector gets to it (D-6).
    bitmap.close();
  }
}

/** `close` from the page: let the model go, which is also when MediaPipe flushes its log. */
function close(): void {
  void model?.then((landmarker) => {
    landmarker?.close();
  });
  model = undefined;
}

scope.onmessage = (event) => {
  const data = event.data as Partial<PoseRequest> & { readonly close?: true };
  if (data.close === true) {
    close();
    return;
  }
  if (typeof data.id !== 'number' || !(data.picture instanceof ArrayBuffer)) {
    return;
  }
  void answer({ id: data.id, picture: data.picture }).then((reply) => {
    scope.postMessage(reply);
  });
};
