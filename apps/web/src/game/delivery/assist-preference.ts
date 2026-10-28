// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The assisted Delivery setting — #1813, resting on the owner's ruling DL10 of
 * 2026-10-27 (epic #1803): wider throw windows, fewer or no obstacles, and no
 * fail.
 *
 * ## Three parts, each the module's own
 *
 * - {@link DeliveryAssist.widerWindows} is `throw.ts` §`ThrowInput.widerWindows`.
 * - {@link DeliveryAssist.obstacles} is `obstacles.ts` §`placeObstacles`'
 *   `setting`.
 * - {@link DeliveryAssist.noFail} is `round.ts` §`RoundOptions.assisted`: a
 *   missed house stays on the next round.
 *
 * The names are the modules' own so that #1816, which runs a round inside a
 * game ride, hands each part to its module as it is read here. Nothing in
 * this file decides what a part does.
 *
 * ## On the device, like the other game preferences
 *
 * `localStorage`, wrapped, on `world-preference.ts`' pattern and with
 * `hud/announce-preference.ts`' storage port. It is not in the ride record,
 * and it changes nothing on any other ride: only the Settings screen and
 * Delivery's own modules read it, and a test derives that from the tree.
 *
 * A stored value this build cannot read — unparseable, the wrong shape, or a
 * part it does not know — reads as {@link DELIVERY_ASSIST_DEFAULTS} as a
 * whole, as `delivery-progress.ts` reads a week, rather than a setting
 * stitched together from the parts that happened to parse.
 *
 * ⚠️ **Nothing imported from the modules it describes, not even a type.**
 * The Settings screen imports this file, and the wiring gate counts a type
 * import as reaching a module: `obstacles.ts` would then be "shipped" with
 * none of its exports named until #1816 calls them. So the obstacle setting's
 * type is declared here and `obstacles.ts` takes it from this file.
 */

import type { PreferenceStorage } from '../hud/announce-preference';

/** How many obstacles a round has: as usual, fewer, or none. `obstacles.ts` §`placeObstacles` applies it. */
export type ObstacleSetting = 'normal' | 'fewer' | 'none';

/** Namespaced, because the origin is shared. The `v1` is the shape's. */
export const DELIVERY_ASSIST_STORAGE_KEY = 'oyl.game.delivery.assist.v1';

/** The assisted Delivery setting, kept on this device. */
export interface DeliveryAssist {
  /** A throw counts from farther along the road: `throw.ts` §`ASSISTED_THROW_SCALE`. */
  readonly widerWindows: boolean;
  /** As usual, fewer, or none: {@link ObstacleSetting}. */
  readonly obstacles: ObstacleSetting;
  /** A missed house stays on the next round: `round.ts` §`RoundOptions.assisted`. */
  readonly noFail: boolean;
}

/** Every obstacle setting, in the order the Settings screen offers them. */
export const OBSTACLE_SETTINGS = [
  'normal',
  'fewer',
  'none',
] as const satisfies readonly ObstacleSetting[];

/** Nothing assisted: Delivery as it is played by default. */
export const DELIVERY_ASSIST_DEFAULTS: DeliveryAssist = Object.freeze({
  widerWindows: false,
  obstacles: 'normal',
  noFail: false,
});

function isObstacleSetting(value: unknown): value is ObstacleSetting {
  return (OBSTACLE_SETTINGS as readonly unknown[]).includes(value);
}

/** The setting this device has kept, or the defaults. Never throws. */
export function readDeliveryAssist(storage: PreferenceStorage | undefined): DeliveryAssist {
  let raw: unknown;
  try {
    const text = storage?.getItem(DELIVERY_ASSIST_STORAGE_KEY) ?? null;
    if (text === null) return DELIVERY_ASSIST_DEFAULTS;
    raw = JSON.parse(text) as unknown;
  } catch {
    return DELIVERY_ASSIST_DEFAULTS;
  }
  if (typeof raw !== 'object' || raw === null) return DELIVERY_ASSIST_DEFAULTS;
  const row = raw as Record<string, unknown>;
  const { widerWindows, obstacles, noFail } = row;
  if (
    typeof widerWindows !== 'boolean' ||
    typeof noFail !== 'boolean' ||
    !isObstacleSetting(obstacles)
  ) {
    return DELIVERY_ASSIST_DEFAULTS;
  }
  return { widerWindows, obstacles, noFail };
}

/**
 * Keep it. `false` when the device refused — a full or blocked store — so the
 * screen can say the choice will not survive a reload rather than pretend.
 */
export function writeDeliveryAssist(
  storage: PreferenceStorage | undefined,
  assist: DeliveryAssist,
): boolean {
  if (storage === undefined) return false;
  const kept: DeliveryAssist = {
    widerWindows: assist.widerWindows,
    obstacles: assist.obstacles,
    noFail: assist.noFail,
  };
  try {
    storage.setItem(DELIVERY_ASSIST_STORAGE_KEY, JSON.stringify(kept));
    return true;
  } catch {
    return false;
  }
}
