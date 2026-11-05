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

import { createContext, type ViewTransitionClassPerType } from 'react';

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
 * Whether a ride has the screen (`AppShell.tsx` §`immersive`), for a view to
 * read where it decides about motion of its own — #1072's review (N5).
 * `AppShell` provides its own state; `false` outside a shell.
 */
export const RideHasTheScreen = createContext(false);

/**
 * Whether a card may be carried into its detail on `routeId` — #1072, ADR
 * 0041 D-3: never on a ride route, and never while a ride has the screen.
 * A list–detail route is never rendered under the stage today (only the game
 * makes the shell immersive), so `immersive` is the shell's real state
 * ({@link RideHasTheScreen}) for the rule's sake: a future list on a
 * ride-time screen is refused here rather than by luck.
 */
export function mayCarryOn(routeId: RouteId, immersive: boolean): boolean {
  return !immersive && !isRideRoute(routeId);
}

/**
 * Whether the navigation from `from` to `to` may animate: never while a ride
 * has the screen, and never when either route is a ride route.
 */
export function mayAnimateBetween(from: RouteMatch, to: RouteMatch, immersive: boolean): boolean {
  return !immersive && !isRideRoute(from.route.id) && !isRideRoute(to.route.id);
}

/**
 * Which way a navigation goes — #2054, so a rider can tell where they went:
 *
 * - `'deeper'`, into a page below the one on screen: Segments to one segment,
 *   About to its credits, Settings to the instance;
 * - `'back'`, out of one to a page above it;
 * - `'across'`, anything else: one tab to another, or between pages neither of
 *   which is above the other.
 *
 * "Below" is read off the route table's paths, segment by segment, so a new
 * page under an existing one needs no entry here: `/segments/:segment` is
 * below `/segments`, `/settings/instance/moderation` below `/settings` and
 * `/settings/instance`. Home's `/` has no segment and is above nothing, or
 * every navigation from it would be "deeper".
 */
export type NavigationKind = 'deeper' | 'back' | 'across';

/** The React transition type each kind is announced as (`addTransitionType`). */
export const NAVIGATION_TRANSITION_TYPE: Readonly<Record<NavigationKind, string>> = {
  deeper: 'oyl-deeper',
  back: 'oyl-back',
  across: 'oyl-across',
};

function segments(path: string): readonly string[] {
  return path.split('/').filter((segment) => segment !== '');
}

/** Whether `upper`'s path is a proper prefix of `lower`'s, by whole segments. */
function isAbove(upper: RouteMatch, lower: RouteMatch): boolean {
  const top = segments(upper.route.path);
  const bottom = segments(lower.route.path);
  return (
    top.length > 0 &&
    top.length < bottom.length &&
    top.every((segment, index) => bottom[index] === segment)
  );
}

/**
 * The `view-transition-class` a route's view enters and leaves with, by
 * {@link NAVIGATION_TRANSITION_TYPE}: a short slide into a page below and back
 * out of it (`theme.css` §"THE ROUTE SLIDE"), and the cross-fade (#945) for
 * everything else. `AppShell`'s `<ViewTransition>` takes it as `enter` and
 * `exit`.
 */
export const ROUTE_TRANSITION_CLASS = {
  [NAVIGATION_TRANSITION_TYPE.deeper]: 'oyl-route-deeper',
  [NAVIGATION_TRANSITION_TYPE.back]: 'oyl-route-back',
  default: 'oyl-route',
} as const satisfies ViewTransitionClassPerType;

/** Which way the navigation from `from` to `to` goes. @see NavigationKind */
export function navigationKind(from: RouteMatch, to: RouteMatch): NavigationKind {
  if (isAbove(from, to)) return 'deeper';
  if (isAbove(to, from)) return 'back';
  return 'across';
}
