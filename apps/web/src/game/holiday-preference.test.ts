// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import type { PreferenceStorage } from './hud/announce-preference';
import {
  HOLIDAY_DECORATIONS_STORAGE_KEY,
  readHolidayDecorations,
  writeHolidayDecorations,
} from './holiday-preference';

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

describe('whether this device wants holiday decorations — #1622, on by default', () => {
  it('is on with nothing stored, with no storage, with garbage, and when storage throws', () => {
    expect(readHolidayDecorations(disk())).toBe(true);
    expect(readHolidayDecorations(undefined)).toBe(true);
    const garbage = disk();
    garbage.setItem(HOLIDAY_DECORATIONS_STORAGE_KEY, 'OFF?');
    expect(readHolidayDecorations(garbage)).toBe(true);
    const throwing: PreferenceStorage = {
      getItem: () => {
        throw new DOMException('blocked', 'SecurityError');
      },
      setItem: () => undefined,
    };
    expect(readHolidayDecorations(throwing)).toBe(true);
  });

  it('is off only after it is switched off, and on again after it is switched on', () => {
    const store = disk();
    expect(writeHolidayDecorations(store, false)).toBe(true);
    expect(readHolidayDecorations(store)).toBe(false);
    expect([...store.values.keys()]).toEqual([HOLIDAY_DECORATIONS_STORAGE_KEY]);
    expect(writeHolidayDecorations(store, true)).toBe(true);
    expect(readHolidayDecorations(store)).toBe(true);
  });

  it('reports a device with no storage, or one that refuses, as not keeping it', () => {
    expect(writeHolidayDecorations(undefined, false)).toBe(false);
    const refusing: PreferenceStorage = {
      getItem: () => null,
      setItem: () => {
        throw new DOMException('full', 'QuotaExceededError');
      },
    };
    expect(writeHolidayDecorations(refusing, false)).toBe(false);
    // …and a refused "off" is not a choice made.
    expect(readHolidayDecorations(refusing)).toBe(true);
  });
});
