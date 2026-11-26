// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #3175: the device a capture rides on chose the realistic world and the whole
 * HUD, written as Settings writes each, and read back as the game reads each.
 */

import { describe, expect, it } from 'vitest';

import type { PreferenceStorage } from '../../src/game/hud/announce-preference';
import {
  DEFAULT_HUD_LAYOUT,
  deliveryGame,
  readHudLayout,
} from '../../src/game/hud/hud-layout-preference';
import { readRideChrome } from '../../src/game/hud/ride-chrome-preference';
import {
  readRealisticWorldChoice,
  REALISTIC_WORLD_STORAGE_KEY,
} from '../../src/game/world-preference';
import { captureDeviceSettings, captureStorageState } from './capture-device';
import { CAPTURE_ORIGIN } from './render-capture';

/** The profile's `localStorage`, as the app reads it. */
function storageOf(settings: readonly { name: string; value: string }[]): PreferenceStorage {
  const kept = new Map(settings.map((each) => [each.name, each.value]));
  return { getItem: (key) => kept.get(key) ?? null, setItem: () => undefined };
}

describe('the capture’s device settings — #3175', () => {
  it('chooses the realistic world under world-preference.ts’s own key, which the game reads as on', () => {
    const settings = captureDeviceSettings();
    expect(settings.map((each) => each.name)).toContain(REALISTIC_WORLD_STORAGE_KEY);
    expect(readRealisticWorldChoice(storageOf(settings))).toBe(true);
    // The control: a fresh profile, which is what the capture had before.
    expect(readRealisticWorldChoice(storageOf([]))).toBe(false);
  });

  it('keeps the ride controls drawn, collapses no panel, and draws every reading on a round', () => {
    const storage = storageOf(captureDeviceSettings());
    expect(readRideChrome(storage)).toEqual({ autoHide: false, collapsed: [] });
    const layout = readHudLayout(storage);
    expect(layout).toEqual({ ...DEFAULT_HUD_LAYOUT, delivery: 'everything' });
    expect(deliveryGame(layout, {})).toBe(false);
    // The control: a fresh profile fades the controls and draws a round's game strip.
    expect(readRideChrome(storageOf([])).autoHide).toBe(true);
    expect(deliveryGame(readHudLayout(storageOf([])), {})).toBe(true);
  });

  it('puts them in the app’s own origin’s localStorage, and nothing else in the profile', () => {
    expect(captureStorageState(CAPTURE_ORIGIN)).toEqual({
      cookies: [],
      origins: [{ origin: CAPTURE_ORIGIN, localStorage: [...captureDeviceSettings()] }],
    });
  });
});
