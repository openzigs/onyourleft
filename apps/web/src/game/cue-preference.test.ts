// SPDX-License-Identifier: AGPL-3.0-or-later

/** The sound preference — #400. Written through one handle, read through another. */

import { describe, expect, it } from 'vitest';

import type { PreferenceStorage } from './hud/announce-preference';
import {
  CUES_STORAGE_KEY,
  DEFAULT_CUES,
  readCuePreference,
  steppedVolume,
  writeCuePreference,
} from './cue-preference';

function disk(): Map<string, string> {
  return new Map<string, string>();
}

function handleOver(values: Map<string, string>): PreferenceStorage {
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

describe('the sound preference — #400', () => {
  it('is OFF when nothing has been chosen', () => {
    expect(readCuePreference(handleOver(disk()))).toEqual(DEFAULT_CUES);
    expect(DEFAULT_CUES.enabled).toBe(false);
    expect(readCuePreference(undefined)).toEqual(DEFAULT_CUES);
  });

  it('survives a reload: written through one handle, read through a fresh one', () => {
    const values = disk();
    const chosen = { enabled: true, volume: 0.3, muted: true };
    expect(writeCuePreference(handleOver(values), chosen)).toBe(true);
    expect(readCuePreference(handleOver(values))).toEqual(chosen);
    expect(values.has(CUES_STORAGE_KEY)).toBe(true);
  });

  it('renders the defaults when the store refuses to be read, and says when it will not keep one', () => {
    const refusing: PreferenceStorage = {
      getItem: () => {
        throw new DOMException('blocked', 'SecurityError');
      },
      setItem: () => {
        throw new DOMException('full', 'QuotaExceededError');
      },
    };
    expect(readCuePreference(refusing)).toEqual(DEFAULT_CUES);
    expect(writeCuePreference(refusing, DEFAULT_CUES)).toBe(false);
    expect(writeCuePreference(undefined, DEFAULT_CUES)).toBe(false);
  });

  it('treats a volume this build does not accept as the default, one field at a time', () => {
    const values = disk();
    values.set(CUES_STORAGE_KEY, JSON.stringify({ enabled: true, volume: 7, muted: 'yes' }));
    expect(readCuePreference(handleOver(values))).toEqual({
      enabled: true,
      volume: DEFAULT_CUES.volume,
      muted: false,
    });
    values.set(CUES_STORAGE_KEY, '{not json');
    expect(readCuePreference(handleOver(values))).toEqual(DEFAULT_CUES);
  });

  it('steps a volume to tenths, and refuses one outside 0 to 1', () => {
    expect(steppedVolume(0.34)).toBe(0.3);
    expect(steppedVolume(0)).toBe(0);
    expect(steppedVolume(1)).toBe(1);
    expect(steppedVolume(-0.1)).toBeUndefined();
    expect(steppedVolume(1.1)).toBeUndefined();
    expect(steppedVolume('0.5')).toBeUndefined();
  });
});
