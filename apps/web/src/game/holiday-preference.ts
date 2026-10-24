// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Whether a rider wants holiday decorations in the game — #1622, epic #1621.
 *
 * `world-preference.ts`'s pattern — device-scoped `localStorage`, wrapped so a
 * private window or blocked site data reads as the default rather than taking
 * a screen down — with **one deliberate difference**: this one is ON by
 * default (owner ruling (a) of 2026-10-24). Only an explicit stored "off"
 * turns it off; absent, unreadable or unknown values read as on.
 *
 * It governs holidays only. The route's seasonal nature (`season.ts`
 * §`natureOn`) is drawn whatever it says.
 *
 * ⚠️ **On the device and nowhere else.** Nothing syncs, exports or sends it.
 */

import type { PreferenceStorage } from './hud/announce-preference';

/** Namespaced, because the origin is shared. The `v1` is the value's. */
export const HOLIDAY_DECORATIONS_STORAGE_KEY = 'oyl.game.holidayDecorations.v1';

/** The one stored value that means "no". Anything else, including nothing, is "yes". */
const SWITCHED_OFF = 'off';

/** Whether this device wants holiday decorations. Never throws; any doubt is "yes". */
export function readHolidayDecorations(storage: PreferenceStorage | undefined): boolean {
  try {
    return storage?.getItem(HOLIDAY_DECORATIONS_STORAGE_KEY) !== SWITCHED_OFF;
  } catch {
    return true;
  }
}

/**
 * Keep it. `false` when the device refused — a full or blocked store — so the
 * screen can say the choice will not survive a reload rather than pretend.
 */
export function writeHolidayDecorations(
  storage: PreferenceStorage | undefined,
  on: boolean,
): boolean {
  if (storage === undefined) return false;
  try {
    storage.setItem(HOLIDAY_DECORATIONS_STORAGE_KEY, on ? 'on' : SWITCHED_OFF);
    return true;
  } catch {
    return false;
  }
}
