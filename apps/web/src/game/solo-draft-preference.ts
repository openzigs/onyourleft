// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Whether a solo ride drafts the rider behind the bot pacer and their own
 * ghost — #2425, the switch of
 * [ADR 0066](../../../../docs/adr/0066-the-bot-pacer-and-the-riders-own-ghost-give-a-draft-in-a-solo-ride.md)
 * D-6 and the owner's ruling of 2026-11-09: *"The rider must be able to turn
 * the draft off. Add a setting, held on the device … With it off, the rider is
 * at k = 1, as today."*
 *
 * ⚠️ **The PHYSICS, and not `draft-preference.ts`.** That one decides only
 * what a rider is shown about a draft; this one decides whether a solo ride
 * drafts at all. With it off the simulation is handed no solo draft and is
 * byte-identical to the ride before #2425. It has no effect in a room (D-6).
 * Since #2461 it reaches the solo lap race (ADR 0067 D-3.4, superseding D-6's
 * last bullet): on, every racer drafts, the rider included; off, none does.
 *
 * **On by default** (D-6, R-10): only a stored "off" is off, and anything this
 * module cannot read is the default — `draft-preference.ts`'s shape exactly.
 */

import type { PreferenceStorage } from './hud/announce-preference';

/** Namespaced, because the origin is shared. The `v1` is the value's. */
export const SOLO_DRAFT_STORAGE_KEY = 'oyl.game.soloDraft.v1';

/** The one stored value that turns it off. Anything else, including nothing, is "yes". */
const TURNED_OFF = 'off';

/** Whether this device drafts a solo ride. Never throws; any doubt is the default, "yes". */
export function readSoloDraftChoice(storage: PreferenceStorage | undefined): boolean {
  try {
    return storage?.getItem(SOLO_DRAFT_STORAGE_KEY) !== TURNED_OFF;
  } catch {
    return true;
  }
}

/**
 * Keep it. `false` when the device refused — a full or blocked store — so the
 * screen can say the choice will not survive a reload rather than pretend.
 */
export function writeSoloDraftChoice(
  storage: PreferenceStorage | undefined,
  drafted: boolean,
): boolean {
  if (storage === undefined) return false;
  try {
    storage.setItem(SOLO_DRAFT_STORAGE_KEY, drafted ? 'on' : TURNED_OFF);
    return true;
  } catch {
    return false;
  }
}
