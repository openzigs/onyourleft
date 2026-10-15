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
 * ## On by default — the owner, 2026-10-15, superseding #327 for this reading
 *
 * ADR 0038 D-5 bound #327's *"off by default"* to this indicator; the owner
 * ruled on 2026-10-15 on #787's pull request that it starts ON, and ADR 0038's
 * amendment of that date records it. So the HUD's draft field and its gauge
 * are there in a room until the rider turns this off, and only a stored "off"
 * is off: a rider who turned it off keeps it off. ⚠️ The spoken cue is ALSO
 * behind the announcements switch (`hud/announce.ts` keeps `room-draft` out of
 * its always-spoken kinds), which is still off by default: this decides
 * whether there is a draft indicator, that one decides whether anything
 * optional is spoken.
 *
 * ## On the DEVICE, like the realistic world and the announcements
 *
 * `map/tiles-preference.ts`'s shape exactly, the other switch that starts on:
 * `localStorage`, wrapped, and anything this module cannot read is the
 * default, "yes".
 */

import type { PreferenceStorage } from './hud/announce-preference';

/** Namespaced, because the origin is shared. The `v1` is the value's. */
export const DRAFT_READING_STORAGE_KEY = 'oyl.game.draftReading.v1';

/** The one stored value that turns it off. Anything else, including nothing, is "yes". */
const TURNED_OFF = 'off';

/** Whether this device shows the draft indicator. Never throws; any doubt is the default, "yes". */
export function readDraftReadingChoice(storage: PreferenceStorage | undefined): boolean {
  try {
    return storage?.getItem(DRAFT_READING_STORAGE_KEY) !== TURNED_OFF;
  } catch {
    return true;
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
    storage.setItem(DRAFT_READING_STORAGE_KEY, shown ? 'on' : TURNED_OFF);
    return true;
  } catch {
    return false;
  }
}
