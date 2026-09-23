// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import type { PreferenceStorage } from './hud/announce-preference';
import {
  readRealisticWorldChoice,
  REALISTIC_WORLD_STORAGE_KEY,
  writeRealisticWorldChoice,
} from './world-preference';

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

describe('whether this device chose the realistic world — #475', () => {
  it('reads back what was written, both ways, under its own key', () => {
    const store = disk();
    expect(writeRealisticWorldChoice(store, true)).toBe(true);
    expect(readRealisticWorldChoice(store)).toBe(true);
    expect([...store.values.keys()]).toEqual([REALISTIC_WORLD_STORAGE_KEY]);
    expect(writeRealisticWorldChoice(store, false)).toBe(true);
    expect(readRealisticWorldChoice(store)).toBe(false);
  });

  it('reports a device with no storage, or one that refuses, as not keeping it', () => {
    expect(writeRealisticWorldChoice(undefined, true)).toBe(false);
    const refusing: PreferenceStorage = {
      getItem: () => null,
      setItem: () => {
        throw new DOMException('full', 'QuotaExceededError');
      },
    };
    expect(writeRealisticWorldChoice(refusing, true)).toBe(false);
    // …and a refused write is not a choice made.
    expect(readRealisticWorldChoice(refusing)).toBe(false);
  });
});
