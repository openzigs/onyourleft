// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #2882's spike page, built on its own and never by the product's or the
 * browser gate's config: `run-page.mjs` builds it into `page/dist` (ignored)
 * and serves that with `vite preview`. The realistic world's assets are the
 * product's own `public/`, and its KTX2 textures need the product's Basis
 * transcoder, as the browser gate's build does.
 */

import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vite';

import { basisTranscoder } from '../basis/transcoder-plugin';

export default defineConfig({
  plugins: [basisTranscoder()],
  root: fileURLToPath(new URL('./page', import.meta.url)),
  publicDir: fileURLToPath(new URL('../../public', import.meta.url)),
  build: {
    outDir: fileURLToPath(new URL('./page/dist', import.meta.url)),
    emptyOutDir: true,
    sourcemap: false,
  },
  worker: { format: 'es' },
});
