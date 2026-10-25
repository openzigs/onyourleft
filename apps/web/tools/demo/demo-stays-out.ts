// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The rider app carries none of the demo — held at build time, #1645.
 *
 * `apps/mobile/capacitor.config.ts` ships all of `dist` into the APK, and the
 * service worker precaches from the same bundle, so a byte of the demo in the
 * product build is a byte every rider downloads. The demo's code and data live
 * in {@link DEMO_SOURCE_DIRECTORIES} and nowhere else, and this plugin, in
 * `vite.config.ts`, fails the product build if any module from them is in a
 * chunk or any file it emits is under `demo/`. The precache is derived from
 * that bundle and from `public/` (`vite.config.ts` §`serviceWorker`), and the
 * demo adds nothing to `public/`, so an empty answer here is an empty answer
 * for the precache too.
 *
 * ⚠️ **Tailwind is the other way in, and it is closed in the stylesheet.**
 * `src/design/tailwind.css` scans `src/**` for class names, so a class used
 * only by the demo would be generated into the product's CSS. Its
 * `@source not '../demo/**'` excludes the directory, and `demo-stays-out.test.ts`
 * holds that Tailwind's own scanner reads no file there.
 */

import { relative } from 'node:path';

import type { Plugin } from 'vite';

/** Where the demo's code and data are, relative to `apps/web`. */
export const DEMO_SOURCE_DIRECTORIES = ['src/demo/', 'demo/'] as const;

/** Every bundled module or emitted file that belongs to the demo; empty when none does. */
export function demoInProduct(
  root: string,
  moduleIds: readonly string[],
  fileNames: readonly string[],
): string[] {
  const modules = moduleIds
    .map((id) => relative(root, id.replace(/\?.*$/, '')).replace(/\\/g, '/'))
    .filter((rel) => DEMO_SOURCE_DIRECTORIES.some((directory) => rel.startsWith(directory)));
  // #1651: a baked route is the demo's data wherever it lands — under `demo/`,
  // in a `routes/` directory, or as a `.bin` anywhere — and the precache is
  // derived from these names, so none may reach it.
  const files = fileNames.filter((name) => {
    const path = name.replace(/\\/g, '/');
    return path.startsWith('demo/') || path.startsWith('routes/') || path.endsWith('.bin');
  });
  return [...modules, ...files];
}

/** The plugin, for `vite.config.ts`. */
export function demoStaysOut(root: string): Plugin {
  return {
    name: 'oyl-demo-stays-out',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const outputs = Object.values(bundle);
      const found = demoInProduct(
        root,
        outputs.flatMap((output) => (output.type === 'chunk' ? Object.keys(output.modules) : [])),
        outputs.map((output) => output.fileName),
      );
      if (found.length > 0) {
        this.error(
          `oyl-demo-stays-out: the product build carries demo code or data, which every rider ` +
            `would download (#1645).\n  - ${found.join('\n  - ')}\nThe demo is built by ` +
            `vite.demo.config.ts; nothing under apps/web/src/demo or apps/web/demo ` +
            `may be imported by the app.`,
        );
      }
    },
  };
}
