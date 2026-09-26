// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The pose model's WebAssembly runtime, served from this app's own origin**
 * — [#530](https://github.com/openzigs/onyourleft/issues/530).
 *
 * `@mediapipe/tasks-vision` ships its runtime as an 11 MB `.wasm` beside its
 * JavaScript, and MediaPipe's own guide points `FilesetResolver` at a CDN for
 * it. Spike 0010 §7 forbids that: the runtime is served from the app's own
 * origin or not at all. So this plugin copies the ONE file the pose worker
 * fetches — `src/camera/pose-runtime.ts` §`POSE_RUNTIME_WASM_FILE`, the module
 * build — out of the pinned, installed package:
 *
 * - **in a build**, into `dist/pose/`, beside the model Vite copies there out
 *   of `public/pose/`; and `tools/precache/precache.ts` excludes `pose/`, so
 *   neither is precached for a rider who never pairs a side camera;
 * - **in development**, by answering the same path from the package.
 *
 * ⚠️ **Copied, never committed.** It is a dependency's own file, so its licence
 * is the one `check:licences` already reads for `@mediapipe/tasks-vision`
 * (Apache-2.0) and a committed copy would be a second, unpinned record of the
 * same bytes. The model is different: it is not in any package, so it is
 * committed with an `ASSETS.toml` row (ADR 0031 D-1).
 *
 * Used by both `vite.config.ts` and `vite.browser.config.ts`, so the browser
 * gate runs the runtime the product ships.
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

import type { Plugin } from 'vite';

import { POSE_DIRECTORY, POSE_RUNTIME_WASM_FILE } from '../../src/camera/pose-files';

/**
 * Where the runtime is on disk: the installed package's own file, resolved
 * from `root` as Node would resolve it from a module there.
 */
export function poseRuntimeSource(root: string): string {
  return createRequire(join(root, 'package.json')).resolve(
    `@mediapipe/tasks-vision/${POSE_RUNTIME_WASM_FILE}`,
  );
}

/** The plugin. */
export function poseRuntime(): Plugin {
  let base = '/';
  let root = '.';
  return {
    name: 'oyl-pose-runtime',
    configResolved(config) {
      base = config.base;
      root = config.root;
    },
    configureServer(server) {
      const path = `${base}${POSE_DIRECTORY}${POSE_RUNTIME_WASM_FILE}`;
      server.middlewares.use((request, response, next) => {
        if (request.url?.split('?')[0] !== path) {
          next();
          return;
        }
        response.setHeader('Content-Type', 'application/wasm');
        response.end(readFileSync(poseRuntimeSource(root)));
      });
    },
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: `${POSE_DIRECTORY}${POSE_RUNTIME_WASM_FILE}`,
        source: readFileSync(poseRuntimeSource(root)),
      });
    },
  };
}
