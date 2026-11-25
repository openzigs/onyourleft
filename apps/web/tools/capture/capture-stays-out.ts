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
 * ⚠️ The names are mirrored rather than imported, as the demo's are:
 * `vite.config.ts` loads this file in Node, and `capture-scene.ts` imports
 * the domain package. `capture-stays-out.test.ts` holds the mirror.
 */

import type { Plugin } from 'vite';

/** `capture-scene.ts` §`CAPTURE_MODE`: the mode `pnpm run capture` builds in. */
export const CAPTURE_BUILD_MODE = 'capture';

/** `capture-scene.ts` §`CAPTURE_SCENES`' names. */
export const CAPTURE_SCENE_NAMES: readonly string[] = ['route-hud'];

/** The chunks whose code names a capture scene; empty when none does. */
export function captureInProduct(
  chunks: readonly { readonly fileName: string; readonly code: string }[],
): string[] {
  return chunks
    .filter((chunk) => CAPTURE_SCENE_NAMES.some((name) => chunk.code.includes(name)))
    .map((chunk) => chunk.fileName);
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
