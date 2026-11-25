// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The device settings a capture starts from — #3175, epic #3151.
 *
 * The capture's browser profile is fresh, so a device setting nobody wrote
 * reads as its default. Three defaults are not the video the owner asked for:
 *
 * - **The realistic world** is off by default on every device (ADR 0026 D-3),
 *   so every scene but a built-in level rode the stylised world. The owner,
 *   2026-11-25: *"Ensure it only has the realistic world"*.
 * - **The ride controls** fade after five seconds with no input
 *   (`controls-reveal.ts`), and **a Delivery round** draws its game strip,
 *   power and the round alone (`hud-layout-preference.ts` §`deliveryGame`).
 *   The owner, the same day: *"make sure the video shows all of the hud"*.
 *
 * Each is written as the rider's Settings writes it — through the module's
 * own `write…` function, so under its own key and in its own value — into the
 * profile's `localStorage` before the app's first page loads
 * ({@link captureStorageState}). The app then reads them as it reads any
 * rider's: there is no capture-only branch in the game or the HUD for any of
 * the three.
 */

import type { PreferenceStorage } from '../../src/game/hud/announce-preference';
import { DEFAULT_HUD_LAYOUT, writeHudLayout } from '../../src/game/hud/hud-layout-preference';
import { DEFAULT_RIDE_CHROME, writeRideChrome } from '../../src/game/hud/ride-chrome-preference';
import { writeRealisticWorldChoice } from '../../src/game/world-preference';

/** One `localStorage` entry, as Playwright's `storageState` takes it. */
export interface StoredSetting {
  readonly name: string;
  readonly value: string;
}

/**
 * What the capture's device has chosen, entry by entry, each written by the
 * function Settings writes it with:
 *
 * - the realistic world, on (`world-preference.ts`);
 * - the ride controls always drawn: auto-hide off, no panel collapsed
 *   (`ride-chrome-preference.ts`);
 * - every reading on a Delivery round: `delivery: 'everything'`, every other
 *   HUD choice its default (`hud-layout-preference.ts`).
 */
export function captureDeviceSettings(): readonly StoredSetting[] {
  const kept: StoredSetting[] = [];
  const storage: PreferenceStorage = {
    getItem: () => null,
    setItem: (name, value) => {
      kept.push({ name, value });
    },
  };
  writeRealisticWorldChoice(storage, true);
  writeRideChrome(storage, { ...DEFAULT_RIDE_CHROME, autoHide: false });
  writeHudLayout(storage, { ...DEFAULT_HUD_LAYOUT, delivery: 'everything' });
  return kept;
}

/**
 * The capture's browser profile: {@link captureDeviceSettings} in `origin`'s
 * `localStorage`, and nothing else — no cookie, no other origin.
 */
export function captureStorageState(origin: string): {
  readonly cookies: [];
  readonly origins: { readonly origin: string; readonly localStorage: StoredSetting[] }[];
} {
  return { cookies: [], origins: [{ origin, localStorage: [...captureDeviceSettings()] }] };
}
