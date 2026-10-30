// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The demo build — `demo/index.html` into `demo/dist/` (#1645, epic #1643).
 *
 * A **third** config rather than a second entry in the product's, for the
 * reason `vite.browser.config.ts` gives about the harness: `vite.config.ts`
 * builds from `apps/web/index.html` and never sees this page, so the demo
 * cannot end up in the build the APK and the service worker ship.
 * `tools/demo/demo-stays-out.ts` holds that from the product's side.
 *
 * What makes the demo's guarantees structural rather than promised:
 *
 * - `tools/demo/forbidden-modules.ts` fails this build if a trainer, Bluetooth,
 *   network or storage module is in its bundle;
 * - `demo/index.html`'s Content-Security-Policy refuses every other origin, and
 *   `tools/demo/content-security.ts` allows the one inline script by its hash;
 * - `tools/demo/demo-output.ts` copies only `public/realistic/` and
 *   `public/licences/`, and fails the build if a service worker or a web app
 *   manifest is in the output;
 * - `tools/demo/demo-routes.ts` keeps the routes `demo:bake` wrote into
 *   `dist/routes/` across the build, and fails it for a route over the
 *   per-route ceiling or one without its ODbL notice beside it (#1651).
 *
 * `base: './'`, so the output works from whatever path the embedding site
 * serves it at: the realistic world's files are fetched from `realistic/`
 * relative to the page (`realistic-assets.ts` §`REALISTIC_DIRECTORY`).
 */

import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

import { basisTranscoder } from './tools/basis/transcoder-plugin';
import { inlineScriptHashes } from './tools/demo/content-security';
import { demoOutput } from './tools/demo/demo-output';
import { demoRoutes } from './tools/demo/demo-routes';
import { demoForbiddenModules } from './tools/demo/forbidden-modules';
import { copiedIntoBuild } from './tools/notices/copied-into-build';
import { themeSelection } from './tools/theme/theme-selection-plugin';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const REPOSITORY = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig({
  plugins: [
    react(),
    themeSelection(),
    inlineScriptHashes(),
    // The realistic world's KTX2 transcoder, into `realistic/basis/`, exactly
    // as the product ships it.
    basisTranscoder(),
    // Every file copied out of a package is named in the notices; the list is
    // the product's, so a file the demo does not write is not stale here.
    copiedIntoBuild(ROOT, { reportStale: false }),
    demoForbiddenModules(REPOSITORY),
    demoOutput(fileURLToPath(new URL('./public', import.meta.url))),
    demoRoutes(),
  ],
  // Absolute, so the config builds the same from any working directory —
  // `demo-build.test.ts` runs it from the repository root.
  root: fileURLToPath(new URL('./demo', import.meta.url)),
  base: './',
  // ⚠️ None of the app's `public/`: it holds the manifest and its icons. The
  // three directories the demo ships are copied by `demoOutput`.
  publicDir: false,
  build: {
    // `demo/dist`: already ignored by `.gitignore`'s `dist/` and pruned by
    // `scripts/check-repo-rules.sh`, as `browser/dist` is.
    outDir: 'dist',
    emptyOutDir: true,
  },
});
