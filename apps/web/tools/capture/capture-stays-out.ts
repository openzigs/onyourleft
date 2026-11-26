// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * No build but the capture tool's carries capture mode — the review of
 * PR #3160 (#3152).
 *
 * A capture ride hides the *Simulated ride* notice and shows a script's
 * numbers as a rider's, so a release must not be able to enter one from a
 * link. `src/game/capture-scene.ts` §`captureSceneFromHash` answers
 * `undefined` before it reads the address in any build whose Vite mode is
 * not {@link CAPTURE_BUILD_MODE}, and the bundler then drops the scenes as
 * code nothing reaches. This plugin, in `vite.config.ts`, holds that: a
 * build in any other mode fails if a chunk names a scene.
 *
 * #3153, the review of PR #3160: a chunk is found to carry the scene table
 * by {@link CAPTURE_SCENE_MARK}, which begins every scene's id, never by a
 * scene's name — `delivery` and `lap-race` are words the product carries
 * anyway. The capture build is written to a directory of its own
 * ({@link captureOutDir}), so `dist`, Capacitor's `webDir`, is never one.
 *
 * ⚠️ The mode and the mark are mirrored rather than imported, as the demo's
 * names are: `vite.config.ts` loads this file in Node, and `capture-scene.ts`
 * imports the domain package. `capture-stays-out.test.ts` holds the mirror.
 */

import type { Plugin } from 'vite';

/** `capture-scene.ts` §`CAPTURE_MODE`: the mode `pnpm run capture` builds in. */
export const CAPTURE_BUILD_MODE = 'capture';

/** `capture-scene.ts` §`CAPTURE_SCENE_MARK`: what every scene's id begins with. */
export const CAPTURE_SCENE_MARK = 'oyl-capture-scene:';

/** The chunks whose code carries a capture scene; empty when none does. */
export function captureInProduct(
  chunks: readonly { readonly fileName: string; readonly code: string }[],
): string[] {
  return chunks
    .filter((chunk) => chunk.code.includes(CAPTURE_SCENE_MARK))
    .map((chunk) => chunk.fileName);
}

/**
 * #3153: the plugin that writes the capture tool's build to `directory`, and
 * every other build where its config says. Its config hook runs before the
 * config is resolved, so every plugin that reads `build.outDir` reads this.
 */
export function captureOutDir(directory: string): Plugin {
  return {
    name: 'oyl-capture-out-dir',
    apply: 'build',
    config(_config, { mode }) {
      return mode === CAPTURE_BUILD_MODE ? { build: { outDir: directory } } : undefined;
    },
  };
}

/** The plugin, for `vite.config.ts`. */
export function captureStaysOut(): Plugin {
  let mode = '';
  return {
    name: 'oyl-capture-stays-out',
    apply: 'build',
    enforce: 'post',
    configResolved(config) {
      mode = config.mode;
    },
    generateBundle(_options, bundle) {
      if (mode === CAPTURE_BUILD_MODE) return;
      const found = captureInProduct(
        Object.values(bundle).flatMap((output) =>
          output.type === 'chunk' ? [{ fileName: output.fileName, code: output.code }] : [],
        ),
      );
      if (found.length > 0) {
        this.error(
          `oyl-capture-stays-out: a ${mode} build carries a capture scene, which would let a ` +
            `link ride a script with no Simulated ride notice (PR #3160).\n  - ` +
            `${found.join('\n  - ')}\nOnly \`vite build --mode ${CAPTURE_BUILD_MODE}\` ` +
            `(pnpm run capture) may read ?capture=.`,
        );
      }
    },
  };
}
