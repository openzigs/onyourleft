// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Whether a rider has asked for the realistic world — #475,
 * [ADR 0026](../../../../docs/adr/0026-realistic-game-world.md) D-3 and D-12.
 *
 * ## Off by default, on every device
 *
 * D-3: *"The default is the stylised world on every device, until a
 * measurement taken with #457's procedure shows a device class holding the
 * realistic top rung for twenty minutes with the headroom #457 states."* One
 * such measurement exists — validation 0002 Part Z, the owner's Pixel Tablet on
 * 2026-09-23 — and it is ONE device on charge in a cool room, not a class, so
 * nothing here defaults anybody to realism. ADR 0008 D-4's floor device never
 * is. A rider has to ask, and anything this module cannot read is "no".
 *
 * ## On the DEVICE, like the shadow map and the sounds
 *
 * Whether a GPU can hold a world is a property of the machine, not of the
 * athlete — `quality.ts` §`RIDER_SHADOW_MAP_STORAGE_KEY` and
 * `cue-preference.ts` take the same position. `localStorage`, wrapped: a
 * private window or blocked site data reads as the default rather than taking
 * a screen down.
 *
 * ⚠️ **A module of its own rather than a line in `quality.ts`**, because the
 * Settings screen writes it and `quality.ts` imports the scenery, the landform
 * and the settlements for its constants — none of which the Settings screen's
 * chunk has any business carrying.
 */

import type { PreferenceStorage } from './hud/announce-preference';

/** Namespaced, because the origin is shared. The `v1` is the value's. */
export const REALISTIC_WORLD_STORAGE_KEY = 'oyl.game.realisticWorld.v1';

/** The one stored value that means "yes". Anything else, including nothing, is "no". */
const CHOSEN = 'on';

/** Whether this device has asked for the realistic world. Never throws; any doubt is "no". */
export function readRealisticWorldChoice(storage: PreferenceStorage | undefined): boolean {
  try {
    return storage?.getItem(REALISTIC_WORLD_STORAGE_KEY) === CHOSEN;
  } catch {
    return false;
  }
}

/**
 * Keep it. `false` when the device refused — a full or blocked store — so the
 * screen can say the choice will not survive a reload rather than pretend.
 */
export function writeRealisticWorldChoice(
  storage: PreferenceStorage | undefined,
  chosen: boolean,
): boolean {
  if (storage === undefined) return false;
  try {
    storage.setItem(REALISTIC_WORLD_STORAGE_KEY, chosen ? CHOSEN : 'off');
    return true;
  } catch {
    return false;
  }
}
