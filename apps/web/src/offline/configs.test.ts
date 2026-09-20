// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The harness build carries no service worker, and the product build does
 * (#406).
 *
 * ⚠️ **This is not a tidiness check.** A worker registered on the harness
 * origin would answer `map.browser.spec.ts`'s assertions from a cache — the
 * `pmtiles://` protocol test, the `styleOrigins` host check, and the
 * `appType: 'mpa'` 404 test, which would start returning a cached `200`. Every
 * one of those would go **green** while measuring nothing, which is the exact
 * shape this repository keeps shipping.
 *
 * Adding the plugin to `vite.config.ts` leaves `vite.browser.config.ts`
 * untouched, which is correct — and #406's criterion is that the absence is
 * *asserted* rather than relied on. This is the static half; the half a real
 * browser makes is `offline.browser.spec.ts`'s assertion that the harness
 * origin has zero registrations.
 */

import type { Plugin, PluginOption } from 'vite';

import { describe, expect, it } from 'vitest';

import browserConfig from '../../vite.browser.config';
import productConfig from '../../vite.config';

/** The plugin the worker is built by, named once. */
const WORKER_PLUGIN = 'oyl-service-worker';

function pluginNames(option: PluginOption | PluginOption[] | undefined): string[] {
  // Vite's plugin type is a deep, possibly-promised tree. Flatten it rather
  // than indexing, so a plugin nested inside an array cannot hide.
  const names: string[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const child of node) {
        walk(child);
      }
      return;
    }
    if (typeof node === 'object' && node !== null && typeof (node as Plugin).name === 'string') {
      names.push((node as Plugin).name);
    }
  };
  walk(option);
  return names;
}

describe('which build gets a service worker', () => {
  it('builds one for the product', () => {
    expect(pluginNames(productConfig.plugins)).toContain(WORKER_PLUGIN);
  });

  it('builds none for the harness, whose gate a cache would poison', () => {
    expect(pluginNames(browserConfig.plugins)).not.toContain(WORKER_PLUGIN);
  });

  it('keeps the harness on its own root, which is what makes them two builds', () => {
    expect(browserConfig.root).toBe('browser');
    expect(productConfig.root).toBeUndefined();
  });
});
