// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Spike 0024 (#1273). NEVER MERGED. Builds `browser/webgpu.html` alone, with
 * `three` aliased to `browser/webgpu/three-shim.ts`.
 *
 * W7's JavaScript size is the difference between two builds of this one page:
 * `OYL_SPIKE_ONLY=webgpu` leaves the classic build out (a page that has moved),
 * and `OYL_SPIKE_ONLY=classic` leaves `three/webgpu`, TSL and the ports out (the
 * same page on `WebGLRenderer`, as the product is today).
 */

import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vite';

import { basisTranscoder } from './tools/basis/transcoder-plugin';

const here = (path: string): string => fileURLToPath(new URL(path, import.meta.url));
const only = process.env['OYL_SPIKE_ONLY'];

export default defineConfig({
  plugins: [basisTranscoder()],
  root: 'browser',
  publicDir: '../public',
  appType: 'mpa',
  resolve: {
    alias: only === 'classic' ? [
      { find: /^\.\/three-shim$/, replacement: here('./browser/webgpu/classic-only/three-shim.ts') },
      { find: /^\.\/layers$/, replacement: here('./browser/webgpu/classic-only/layers.ts') },
      { find: /^\.\/spike-0024-nodes$/, replacement: here('./browser/webgpu/classic-only/nodes.ts') },
    ] : [
      { find: /^three$/, replacement: here('./browser/webgpu/three-shim.ts') },
      {
        find: /^oyl-three-classic$/,
        replacement:
          only === 'webgpu'
            ? here('./browser/webgpu/classic-stub.ts')
            : here('./node_modules/three/build/three.module.js'),
      },
    ],
  },
  build: {
    outDir: only === undefined ? 'dist-webgpu' : `dist-webgpu-${only}`,
    emptyOutDir: true,
    rollupOptions: { input: { webgpu: 'browser/webgpu.html' } },
    sourcemap: false,
    minify: process.env['OYL_SPIKE_DEBUG'] !== '1',
  },
});
