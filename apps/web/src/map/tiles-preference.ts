// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Whether this device draws map tiles under a ride — the owner's decision of
 * 2026-09-25 on #534's review.
 *
 * ## On by default, with a switch to turn it off
 *
 * Since #534 a build with nothing configured draws the archive #53 published
 * (`basemap.ts` §`PUBLISHED_BASEMAP_URL`), so opening a ride with GPS asks the
 * tile host for the map around where it was ridden, and that request carries
 * the rider's IP address. #535's review pointed out that no rider could turn
 * that off — only a build could — while every other feature here that sends
 * something off the device has a rider switch. The owner kept the map ON by
 * default and asked for this switch, on the Settings screen.
 *
 * ⚠️ **So this is the one device preference here whose default is ON**, and
 * its storage rule is the mirror of `world-preference.ts`'s: the one stored
 * value that changes anything is "off", and anything else — nothing stored, a
 * value this build does not recognise — is the default. A store that throws
 * reads as the default too, because an unreadable store is the default state
 * of a private window, and the Settings panel says when a choice will not
 * survive a reload rather than pretending it will.
 *
 * ## Off means no request, not a hidden map
 *
 * With tiles off `basemap.ts` §`basemapStyle` builds a style with **no
 * source at all** — the background layer and nothing else — so MapLibre has no
 * URL to ask for and the tile host is contacted by nothing. The ride's own line
 * and the OpenStreetMap credit still render: the line is the rider's own data
 * and the credit is a licence obligation that follows the map panel rather than
 * the tiles. `map.browser.spec.ts` §"with map tiles turned off" intercepts the
 * network to prove the first half.
 *
 * ## On the DEVICE, like the realistic world and the sounds
 *
 * What a device may send over its own network is a property of that device,
 * and `localStorage` needs no schema change. The cost, as
 * `game/hud/announce-preference.ts` states it for the announcer: it does not
 * travel with the account export.
 */

import type { PreferenceStorage } from '../game/hud/announce-preference';

/** Namespaced, because the origin is shared. The `v1` is the value's. */
export const MAP_TILES_STORAGE_KEY = 'oyl.map.tiles.v1';

/** The one stored value that turns tiles off. Anything else, including nothing, is "on". */
const TURNED_OFF = 'off';

/** Whether this device draws map tiles. Never throws; nothing stored, or anything unreadable, is "yes". */
export function readMapTilesChoice(storage: PreferenceStorage | undefined): boolean {
  try {
    return storage?.getItem(MAP_TILES_STORAGE_KEY) !== TURNED_OFF;
  } catch {
    return true;
  }
}

/**
 * Keep it. `false` when the device refused — a full or blocked store — so the
 * screen can say the choice will not survive a reload rather than pretend.
 */
export function writeMapTilesChoice(
  storage: PreferenceStorage | undefined,
  drawn: boolean,
): boolean {
  if (storage === undefined) return false;
  try {
    storage.setItem(MAP_TILES_STORAGE_KEY, drawn ? 'on' : TURNED_OFF);
    return true;
  } catch {
    return false;
  }
}
