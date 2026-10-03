// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Which navigations may animate — #945.
 *
 * The menus cross-fade between routes with React 19.3's `<ViewTransition>`
 * (`AppShell.tsx`), and this is the one rule that decides when they may not.
 *
 * ## Never to or from a ride
 *
 * While a view transition runs the browser draws the `::view-transition`
 * pseudo-element tree over the page: the rider sees snapshots, and **a press
 * lands on the snapshot rather than on the control under it**. A rider pressing
 * *Start recording* on the Ride screen, or the game's *Ride*, must never press
 * into a picture of the page they just left. So a navigation whose route on
 * screen or route asked for is a ride route — {@link RIDE_ROUTE_IDS} — never
 * animates, and nor does any navigation while a ride has the screen
 * (`AppShell.tsx` §`immersive`), whatever the two routes are.
 *
 * ⚠️ **What enforces it is the update, not a class name.** A navigation this
 * refuses is applied outside `startTransition` (`useRoute.ts`), which is not a
 * lane React animates. The one other update React animates is a Suspense
 * reveal — a ride view's chunk arriving after the navigation — and
 * `AppShell`'s `<ViewTransition>` carries `update="none"` so that animates
 * nothing either. `motion.browser.spec.ts` counts the transitions the page
 * starts, and goes red when either is removed.
 */

import type { RouteId, RouteMatch } from './routes';

/**
 * The routes a rider rides on: the Ride screen and the trainer game. Every
 * control a rider presses while riding is on one of these.
 */
export const RIDE_ROUTE_IDS: ReadonlySet<RouteId> = new Set<RouteId>(['ride', 'game']);

/** Whether `id` is a route a rider rides on. */
export function isRideRoute(id: RouteId): boolean {
  return RIDE_ROUTE_IDS.has(id);
}

/**
 * Whether the navigation from `from` to `to` may animate: never while a ride
 * has the screen, and never when either route is a ride route.
 */
export function mayAnimateBetween(from: RouteMatch, to: RouteMatch, immersive: boolean): boolean {
  return !immersive && !isRideRoute(from.route.id) && !isRideRoute(to.route.id);
}
