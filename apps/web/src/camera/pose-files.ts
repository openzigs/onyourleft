// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **Where the side camera's pose model and its runtime are served** — #530.
 *
 * Names only, in a module that imports nothing, because the build reads them
 * too (`tools/pose/pose-runtime-plugin.ts` and `vite.config.ts`), and a
 * config that imported the client's modules would load half the camera to
 * learn a directory name. `pose-runtime.ts` says why each file is where it is.
 */

/** Where the model, its runtime and its worker are served, under the app's base. */
export const POSE_DIRECTORY = 'pose/';

/**
 * The weights: MediaPipe Pose Landmarker **lite**, float16, the bytes spike
 * 0010 measured (SHA-256 `59929e1d…690d574a`, recorded in `ASSETS.toml`).
 */
export const POSE_MODEL_FILE = 'pose_landmarker_lite.task';

/**
 * The runtime. The **module** build, because the worker imports its loader
 * statically (`pose-worker.ts` says why); only the `.wasm` is fetched at run
 * time.
 */
export const POSE_RUNTIME_WASM_FILE = 'vision_wasm_module_internal.wasm';

/**
 * The name Vite gives the pose worker's chunk — `pose-worker.ts`'s file
 * name — which `vite.config.ts` routes into {@link POSE_DIRECTORY}.
 */
export const POSE_WORKER_CHUNK = 'pose-worker';
