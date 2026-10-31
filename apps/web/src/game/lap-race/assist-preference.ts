// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The lap race's assisted setting — #1905 (epic #1894), on Delivery's
 * precedent (#1813, `delivery/assist-preference.ts`): **items off**,
 * **auto-use**, **no knock-back on me** and **gentler bots**.
 *
 * ## Four parts, each applied by `assist.ts`
 *
 * - {@link LapRaceAssist.itemsOff}: the race is started with items off
 *   (`@onyourleft/domain` §`ItemRaceSetup.itemsOn`), so there is nothing to
 *   pick up and nothing to be hit by.
 * - {@link LapRaceAssist.autoUse}: an item the rider picks up is used on the
 *   next tick with no press (`assist.ts` §`assistedTick`).
 * - {@link LapRaceAssist.noKnockBack}: the rider is named in the race's
 *   `shieldedIds`, so no hit moves the rider's offset.
 * - {@link LapRaceAssist.gentlerBots}: every bot rides one tier below the one
 *   chosen (`assist.ts` §`assistedBotTier`).
 *
 * ## On the device, like the other game preferences
 *
 * `localStorage`, wrapped, on `delivery/assist-preference.ts`' pattern and
 * with `hud/announce-preference.ts`' storage port. It is not in the ride
 * record, and it changes nothing on any other ride: only the Settings screen
 * and the lap race's own modules read it. A stored value this build cannot
 * read reads as {@link LAP_RACE_ASSIST_DEFAULTS} as a whole, never a setting
 * stitched together from the parts that happened to parse.
 *
 * ⚠️ **Nothing imported from the modules it describes, not even a type**,
 * for Delivery's reason: the Settings screen imports this file, and the
 * wiring gate counts a type import as reaching a module.
 */

import type { PreferenceStorage } from '../hud/announce-preference';

/** Namespaced, because the origin is shared. The `v1` is the shape's. */
export const LAP_RACE_ASSIST_STORAGE_KEY = 'oyl.game.lap-race.assist.v1';

/** The assisted lap race setting, kept on this device. */
export interface LapRaceAssist {
  /** A race with no items at all. */
  readonly itemsOff: boolean;
  /** An item picked up is used at once, with no press. */
  readonly autoUse: boolean;
  /** No hit moves the rider back. */
  readonly noKnockBack: boolean;
  /** Every bot one tier easier than the one chosen. */
  readonly gentlerBots: boolean;
}

/** Nothing assisted: the lap race as it is played by default. */
export const LAP_RACE_ASSIST_DEFAULTS: LapRaceAssist = Object.freeze({
  itemsOff: false,
  autoUse: false,
  noKnockBack: false,
  gentlerBots: false,
});

/** The parts, in the order the Settings screen offers them. */
export const LAP_RACE_ASSIST_PARTS = [
  'itemsOff',
  'autoUse',
  'noKnockBack',
  'gentlerBots',
] as const satisfies readonly (keyof LapRaceAssist)[];

/** The setting this device has kept, or the defaults. The one reader: the race and Settings both read it here. Never throws. */
export function readLapRaceAssist(storage: PreferenceStorage | undefined): LapRaceAssist {
  let raw: unknown;
  try {
    const text = storage?.getItem(LAP_RACE_ASSIST_STORAGE_KEY) ?? null;
    if (text === null) return LAP_RACE_ASSIST_DEFAULTS;
    raw = JSON.parse(text) as unknown;
  } catch {
    return LAP_RACE_ASSIST_DEFAULTS;
  }
  if (typeof raw !== 'object' || raw === null) return LAP_RACE_ASSIST_DEFAULTS;
  const row = raw as Record<string, unknown>;
  const { itemsOff, autoUse, noKnockBack, gentlerBots } = row;
  if (
    typeof itemsOff !== 'boolean' ||
    typeof autoUse !== 'boolean' ||
    typeof noKnockBack !== 'boolean' ||
    typeof gentlerBots !== 'boolean'
  ) {
    return LAP_RACE_ASSIST_DEFAULTS;
  }
  return { itemsOff, autoUse, noKnockBack, gentlerBots };
}

/**
 * Keep it. `false` when the device refused — a full or blocked store — so the
 * screen can say the choice will not survive a reload rather than pretend.
 */
export function writeLapRaceAssist(
  storage: PreferenceStorage | undefined,
  assist: LapRaceAssist,
): boolean {
  if (storage === undefined) return false;
  const kept: LapRaceAssist = {
    itemsOff: assist.itemsOff,
    autoUse: assist.autoUse,
    noKnockBack: assist.noKnockBack,
    gentlerBots: assist.gentlerBots,
  };
  try {
    storage.setItem(LAP_RACE_ASSIST_STORAGE_KEY, JSON.stringify(kept));
    return true;
  } catch {
    return false;
  }
}
