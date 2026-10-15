// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Whether a rider has asked to see and hear their draft in a room — #787,
 * binding [ADR 0038](../../../../docs/adr/0038-drafting-in-the-first-multiplayer-release.md)
 * D-5 to #327's indicator criteria.
 *
 * ## Two switches, and they are not the same one
 *
 * The ROOM's switch (the owner's ruling of 2026-09-30 on #787) decides the
 * physics: whether anybody in that room is drafted at all, chosen by the
 * room's maker and the same for every rider. THIS switch decides only what
 * one rider is shown and told about a draft that is happening either way. A
 * rider who turns it off is drafted exactly as before; a rider who turns it on
 * in a room with drafting off is told *Off*.
 *
 * ## Off by default — ADR 0038 D-5, from #327
 *
 * *"Off by default, one rider setting, like every announcement"*, and *"not a
 * ninth HUD field by default"*. So the HUD's draft field, its gauge and its
 * spoken cue are all absent until the rider turns this on. ⚠️ The cue is ALSO
 * behind the announcements switch (`hud/announce.ts` keeps `room-draft` out of
 * its always-spoken kinds): this decides whether there is a draft indicator,
 * that one decides whether anything optional is spoken.
 *
 * ## On the DEVICE, like the realistic world and the announcements
 *
 * `world-preference.ts`'s shape exactly: `localStorage`, wrapped, and anything
 * this module cannot read is "no".
 */

import type { PreferenceStorage } from './hud/announce-preference';

/** Namespaced, because the origin is shared. The `v1` is the value's. */
export const DRAFT_READING_STORAGE_KEY = 'oyl.game.draftReading.v1';

/** The one stored value that means "yes". Anything else, including nothing, is "no". */
const SHOWN = 'on';

/** Whether this device has asked for the draft indicator. Never throws; any doubt is "no". */
export function readDraftReadingChoice(storage: PreferenceStorage | undefined): boolean {
  try {
    return storage?.getItem(DRAFT_READING_STORAGE_KEY) === SHOWN;
  } catch {
    return false;
  }
}

/**
 * Keep it. `false` when the device refused — a full or blocked store — so the
 * screen can say the choice will not survive a reload rather than pretend.
 */
export function writeDraftReadingChoice(
  storage: PreferenceStorage | undefined,
  shown: boolean,
): boolean {
  if (storage === undefined) return false;
  try {
    storage.setItem(DRAFT_READING_STORAGE_KEY, shown ? SHOWN : 'off');
    return true;
  } catch {
    return false;
  }
}
