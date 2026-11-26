// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import type { PreferenceStorage } from './hud/announce-preference';
import {
  readRiderDraftChoice,
  RIDER_DRAFT_STORAGE_KEY,
  writeRiderDraftChoice,
} from './rider-draft-preference';
import { SOLO_DRAFT_STORAGE_KEY } from './solo-draft-preference';

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

describe('whether the rider takes a draft on the next ride — #2967', () => {
  it('reads back what was written, both ways, under its own key and not the Settings switch’s', () => {
    const store = disk();
    expect(writeRiderDraftChoice(store, false)).toBe(true);
    expect(readRiderDraftChoice(store)).toBe(false);
    expect([...store.values.keys()]).toEqual([RIDER_DRAFT_STORAGE_KEY]);
    expect(RIDER_DRAFT_STORAGE_KEY).not.toBe(SOLO_DRAFT_STORAGE_KEY);
    expect(writeRiderDraftChoice(store, true)).toBe(true);
    expect(readRiderDraftChoice(store)).toBe(true);
  });

  it('is on until the rider turns it off: an empty, unreadable or unrecognised store reads as on', () => {
    expect(readRiderDraftChoice(disk())).toBe(true);
    expect(readRiderDraftChoice(undefined)).toBe(true);
    const throwing: PreferenceStorage = {
      getItem: () => {
        throw new DOMException('blocked', 'SecurityError');
      },
      setItem: () => undefined,
    };
    expect(readRiderDraftChoice(throwing)).toBe(true);
    const odd = disk();
    odd.values.set(RIDER_DRAFT_STORAGE_KEY, 'false');
    expect(readRiderDraftChoice(odd)).toBe(true);
  });

  it('reports a device with no storage, or one that refuses, as not keeping it', () => {
    expect(writeRiderDraftChoice(undefined, false)).toBe(false);
    const refusing: PreferenceStorage = {
      getItem: () => null,
      setItem: () => {
        throw new DOMException('full', 'QuotaExceededError');
      },
    };
    expect(writeRiderDraftChoice(refusing, false)).toBe(false);
    expect(readRiderDraftChoice(refusing)).toBe(true);
  });
});
