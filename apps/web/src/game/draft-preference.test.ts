// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import {
  DRAFT_READING_STORAGE_KEY,
  readDraftReadingChoice,
  writeDraftReadingChoice,
} from './draft-preference';
import type { PreferenceStorage } from './hud/announce-preference';

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

describe('whether this device asked to see its draft — #787', () => {
  it('reads back what was written, both ways, under its own key', () => {
    const store = disk();
    expect(writeDraftReadingChoice(store, true)).toBe(true);
    expect(readDraftReadingChoice(store)).toBe(true);
    expect([...store.values.keys()]).toEqual([DRAFT_READING_STORAGE_KEY]);
    expect(writeDraftReadingChoice(store, false)).toBe(true);
    expect(readDraftReadingChoice(store)).toBe(false);
  });

  it('reports a device with no storage, or one that refuses, as not keeping it', () => {
    expect(writeDraftReadingChoice(undefined, true)).toBe(false);
    const refusing: PreferenceStorage = {
      getItem: () => null,
      setItem: () => {
        throw new DOMException('full', 'QuotaExceededError');
      },
    };
    expect(writeDraftReadingChoice(refusing, true)).toBe(false);
    expect(readDraftReadingChoice(refusing)).toBe(false);
  });

  it('is off until a rider asks: an empty, unreadable or unrecognised store reads as off — ADR 0038 D-5', () => {
    expect(readDraftReadingChoice(disk())).toBe(false);
    expect(readDraftReadingChoice(undefined)).toBe(false);
    const throwing: PreferenceStorage = {
      getItem: () => {
        throw new DOMException('blocked', 'SecurityError');
      },
      setItem: () => undefined,
    };
    expect(readDraftReadingChoice(throwing)).toBe(false);
    const odd = disk();
    odd.values.set(DRAFT_READING_STORAGE_KEY, 'true');
    expect(readDraftReadingChoice(odd)).toBe(false);
  });
});
