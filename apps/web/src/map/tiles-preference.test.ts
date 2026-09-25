// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import type { PreferenceStorage } from '../game/hud/announce-preference';
import { MAP_TILES_STORAGE_KEY, readMapTilesChoice, writeMapTilesChoice } from './tiles-preference';

/** A `localStorage` stand-in, so a write can be read back through the same reader a ride uses. */
function disk(): PreferenceStorage & { readonly values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

describe('whether this device draws map tiles — the owner’s decision of 2026-09-25', () => {
  it('is on for a device that has never chosen, and for one with no storage at all', () => {
    expect(readMapTilesChoice(disk())).toBe(true);
    expect(readMapTilesChoice(undefined)).toBe(true);
  });

  it('reads back what was written, both ways, under its own key', () => {
    const store = disk();
    expect(writeMapTilesChoice(store, false)).toBe(true);
    expect(readMapTilesChoice(store)).toBe(false);
    expect([...store.values.keys()]).toEqual([MAP_TILES_STORAGE_KEY]);
    expect(writeMapTilesChoice(store, true)).toBe(true);
    expect(readMapTilesChoice(store)).toBe(true);
  });

  it('reads a value this build does not recognise, or a store that throws, as the default', () => {
    const store = disk();
    store.setItem(MAP_TILES_STORAGE_KEY, 'maybe');
    expect(readMapTilesChoice(store)).toBe(true);
    const throwing: PreferenceStorage = {
      getItem: () => {
        throw new DOMException('blocked', 'SecurityError');
      },
      setItem: () => undefined,
    };
    expect(readMapTilesChoice(throwing)).toBe(true);
  });

  it('reports a device with no storage, or one that refuses, as not keeping it', () => {
    expect(writeMapTilesChoice(undefined, false)).toBe(false);
    const refusing: PreferenceStorage = {
      getItem: () => null,
      setItem: () => {
        throw new DOMException('full', 'QuotaExceededError');
      },
    };
    expect(writeMapTilesChoice(refusing, false)).toBe(false);
  });
});
