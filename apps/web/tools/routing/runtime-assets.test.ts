// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { PRECACHE_EXCLUSIONS } from '../precache/precache';

import {
  assetFileName,
  chunkFileName,
  isRoutingRuntimeAsset,
  ROUTING_RUNTIME_DIRECTORY,
} from './runtime-assets';

const SDK = '/repo/node_modules/.pnpm/valhalla-browser@0.2.1/node_modules/valhalla-browser/dist/';

describe('where the build puts the in-browser routing engine — #2734', () => {
  it('puts the SDK’s worker and WebAssembly under routing/, and every other asset where Vite does', () => {
    expect(assetFileName({ originalFileNames: [`${SDK}valhalla-browser.wasm`] })).toBe(
      'routing/[name]-[hash][extname]',
    );
    expect(assetFileName({ originalFileNames: [`${SDK}worker.js`] })).toBe(
      'routing/[name]-[hash][extname]',
    );
    expect(assetFileName({ originalFileNames: ['/repo/apps/web/src/design/fonts/a.woff2'] })).toBe(
      'assets/[name]-[hash][extname]',
    );
    expect(assetFileName({ originalFileNames: [] })).toBe('assets/[name]-[hash][extname]');
  });

  it('reads the package by its own directory name, not by a word in a path', () => {
    expect(isRoutingRuntimeAsset(['/repo/node_modules/valhalla-browser/dist/worker.js'])).toBe(
      true,
    );
    expect(isRoutingRuntimeAsset(['/repo/apps/web/src/valhalla-browser/x.wasm'])).toBe(false);
    expect(isRoutingRuntimeAsset(['/repo/node_modules/not-valhalla-browser/x.wasm'])).toBe(false);
  });

  it('puts the chunk of the engine’s licence texts under routing/, and every other chunk where Vite does', () => {
    expect(
      chunkFileName({ moduleIds: ['/repo/apps/web/public/routing/third-party.txt?raw'] }),
    ).toBe('routing/[name]-[hash].js');
    expect(
      chunkFileName({ moduleIds: ['/repo/apps/web/public/licences/third-party.txt?raw'] }),
    ).toBe('assets/[name]-[hash].js');
    expect(chunkFileName({ moduleIds: ['/repo/apps/web/src/routing/draft.ts'] })).toBe(
      'assets/[name]-[hash].js',
    );
  });

  it('is a directory the precache leaves out', () => {
    expect(
      PRECACHE_EXCLUSIONS.some((pattern) => pattern.test(`${ROUTING_RUNTIME_DIRECTORY}x.wasm`)),
    ).toBe(true);
  });
});
