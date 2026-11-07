// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The dev-only in-browser Valhalla measurement page (#2320), and nothing else.
 *
 * A config of its own, rooted in `tools/valhalla/measure/`, for the reason
 * `vite.browser.config.ts` gives for the harness: `vite.config.ts` builds
 * from `index.html` and never sees this directory, so the router cannot end
 * up in a rider's bundle by accident. `tools/valhalla/stays-out.test.ts`
 * holds the other half: nothing under `src/` imports the package.
 *
 * ```sh
 * pnpm --filter @onyourleft/web valhalla:measure          # dev server on :5180
 * pnpm --filter @onyourleft/web valhalla:measure:build    # static build in tools/valhalla/measure/dist
 * ```
 *
 * No React and no Tailwind: the page is a table. The worker and the
 * WebAssembly are `?url` imports, so both are served from this origin.
 */

import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vite';

import { valhallaNotices } from './tools/valhalla/measure/notices-plugin';

export const MEASURE_PORT = 5180;

export default defineConfig({
  root: fileURLToPath(new URL('./tools/valhalla/measure', import.meta.url)),
  publicDir: false,
  plugins: [valhallaNotices()],
  server: { port: MEASURE_PORT, strictPort: true },
  preview: { port: MEASURE_PORT, strictPort: true },
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2024' },
});
