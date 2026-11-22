// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The open-world ride's card id** — #2896, on its own so the pre-ride
 * chooser can tell the card apart (#2990) without reaching `start.ts` and the
 * map through `ride.ts` (`stage-chooser-imports.test.ts`, #940). `ride.ts`
 * re-exports both names.
 */

/**
 * The open-world ride's card on the picker. Never a saved route's id: those
 * are the store's, and nothing is stored under this one.
 */
export const OPEN_WORLD_ROUTE_ID = 'open-world';

/** Whether `id` is the open-world ride's card rather than a route, a circuit or a level. */
export function isOpenWorldRouteId(id: string): boolean {
  return id === OPEN_WORLD_ROUTE_ID;
}
