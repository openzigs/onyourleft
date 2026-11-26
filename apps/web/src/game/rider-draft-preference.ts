// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Whether the rider takes a draft on the ride about to be ridden — #2967, the
 * owner's request after the AI pacer ride of 2026-11-20: *"It would be nice to
 * switch off the draft."* The chooser's *Your ride* holds it, beside *Ride
 * against a pacer*, and this device remembers it for the next ride.
 *
 * ⚠️ **The rider's own draft, and nobody else's.** Off, the rider is ridden at
 * `k = 1` behind the pacer, their own ghost and the lap race's bots alike, so
 * the speed shown and felt is the rider's own effort. The bots of a lap race
 * still draft each other (#2967's third criterion): the race is ridden as
 * before, and only the rider's `k` is held at 1 (`lap-race/ride-race.ts`
 * §`LapRaceRideStart.riderDrafts`).
 *
 * It is **not** `solo-draft-preference.ts`, ADR 0066 D-6's switch in Settings,
 * which decides whether a solo ride or a lap race drafts at all, for every
 * racer. With that one off there is no draft for this choice to take away, and
 * the chooser says so instead of offering it. Nor is it `draft-preference.ts`,
 * which decides only what a rider is shown.
 *
 * Like every draft here, it is a multiplier on the rider's drag in the
 * simulation and nothing else (ADR 0066 D-7): it sets no trainer resistance
 * and no ERG target. Off, the trainer is sent what an undrafted ride sends.
 *
 * **On by default**, today's behaviour: only a stored "off" is off, and
 * anything this module cannot read is the default — `solo-draft-preference.ts`'s
 * shape exactly.
 */

import type { PreferenceStorage } from './hud/announce-preference';

/** Namespaced, because the origin is shared. The `v1` is the value's. */
export const RIDER_DRAFT_STORAGE_KEY = 'oyl.game.riderDraft.v1';

/** The one stored value that turns it off. Anything else, including nothing, is "yes". */
const TURNED_OFF = 'off';

/** Whether the rider takes a draft on this device's next ride. Never throws; any doubt is the default, "yes". */
export function readRiderDraftChoice(storage: PreferenceStorage | undefined): boolean {
  try {
    return storage?.getItem(RIDER_DRAFT_STORAGE_KEY) !== TURNED_OFF;
  } catch {
    return true;
  }
}

/**
 * Keep it. `false` when the device refused — a full or blocked store — so the
 * caller knows the choice holds for this ride only.
 */
export function writeRiderDraftChoice(
  storage: PreferenceStorage | undefined,
  drafted: boolean,
): boolean {
  if (storage === undefined) return false;
  try {
    storage.setItem(RIDER_DRAFT_STORAGE_KEY, drafted ? 'on' : TURNED_OFF);
    return true;
  } catch {
    return false;
  }
}
