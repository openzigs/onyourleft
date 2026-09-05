// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The route table, as data.
 *
 * Separate from the router that reads it and from the components it names, so
 * that the accessibility suite can enumerate every route and audit each one —
 * #48's fourth criterion is "on every route", and a route list that only exists
 * as JSX would leave that promise resting on somebody remembering to add a test.
 * `routes.a11y.test.tsx` iterates {@link ROUTES}, so a route added here is
 * audited whether or not anyone remembers.
 *
 * ## Hash routing, and why it is the right answer here rather than a compromise
 *
 * Path routing (`/activities`) needs a server that rewrites every unknown path
 * to `index.html`. Phase 1 has **no server** — owner decision D6 — and the
 * product is a static bundle an athlete may well open from a file. A deep link
 * or a page refresh under path routing would 404 against whatever static host
 * happens to be serving the files, which is a bug reachable by pressing reload.
 *
 * Hash routing has none of that: the fragment never reaches a server, deep
 * links and refreshes work from any host and from `file://`, and — the reason
 * that matters most here — **navigation is a plain `<a href="#/activities">`**.
 * The browser's own activation handles Enter, middle-click, "open in new tab"
 * and every assistive technology's link affordance, with no key handler of ours
 * in the path. #48's third criterion asks that every control be operable by
 * keyboard; the cheapest way to pass it is to not take the behaviour away.
 *
 * The cost is a `#` in the URL, and, on Phase 4's instance, that a fragment is
 * not sent to a server that might one day want to render a page. Revisit it
 * with [#7](https://github.com/openzigs/onyourleft/issues/7), not before.
 */

/** The identity of a view. Stable; the path is not. */
export type RouteId = 'ride' | 'activities' | 'devices' | 'about' | 'not-found';

export interface RouteDefinition {
  readonly id: RouteId;
  /** The part after the `#`, always starting with `/`. */
  readonly path: string;
  /** The link text in the header. Short. */
  readonly navLabel: string;
  /** The `h1` and the document title. Sentence-shaped. */
  readonly title: string;
  /** One line under the heading, so a view is never a bare title. */
  readonly summary: string;
}

/** Every navigable route, in the order they appear in the header. */
export const ROUTES: readonly RouteDefinition[] = [
  {
    id: 'ride',
    path: '/',
    navLabel: 'Ride',
    title: 'Ride',
    summary:
      'Record a ride from the sensors paired on this device. Everything stays on this device.',
  },
  {
    id: 'activities',
    path: '/activities',
    navLabel: 'Activities',
    title: 'Activities',
    summary: 'Rides recorded on this device, newest first.',
  },
  {
    id: 'devices',
    path: '/devices',
    navLabel: 'Devices',
    title: 'Devices',
    summary: 'Heart rate straps, power meters, cadence sensors and smart trainers, over Bluetooth.',
  },
  {
    id: 'about',
    path: '/about',
    navLabel: 'About',
    title: 'About On Your Left',
    summary: 'What this is, what it does not do, and where your data lives.',
  },
];

/**
 * Where an unrecognised fragment lands.
 *
 * Not in {@link ROUTES}, because it is not navigable *to* — it has no
 * navigation entry and nothing links to it. It still gets a title, a summary
 * and a heading, so the accessibility rules hold on it exactly as they do
 * everywhere else; `routes.a11y.test.tsx` audits it alongside the rest for
 * that reason. An unhandled route is where a shell usually renders nothing at
 * all, which is the one page a keyboard user cannot get out of.
 */
export const NOT_FOUND_ROUTE: RouteDefinition = {
  id: 'not-found',
  path: '/not-found',
  navLabel: 'Not found',
  title: 'That page does not exist',
  summary: 'The address in the bar does not match any page in this app.',
};

/** Every route the audit must cover, navigable or not. */
export const ALL_ROUTES: readonly RouteDefinition[] = [...ROUTES, NOT_FOUND_ROUTE];

/**
 * The route a `location.hash` selects.
 *
 * Total: anything unrecognised — including an empty hash, a bare `#`, and a
 * fragment left over from an in-page anchor — resolves to a real route rather
 * than to `undefined`. A router that can return nothing is a router that renders
 * a blank page on a typo.
 */
export function routeForHash(hash: string): RouteDefinition {
  const path = normaliseHash(hash);
  return ROUTES.find((route) => route.path === path) ?? NOT_FOUND_ROUTE;
}

/**
 * `'#/activities?x=1'` → `'/activities'`, `''` → `'/'`.
 *
 * The query and any nested fragment are dropped: this shell has no route
 * parameters yet, and silently matching `'/activities?x=1'` against nothing
 * would send a perfectly good deep link to the not-found page.
 */
export function normaliseHash(hash: string): string {
  const withoutHash = hash.startsWith('#') ? hash.slice(1) : hash;
  const withoutQuery = withoutHash.split(/[?#]/)[0] ?? '';
  if (withoutQuery === '' || withoutQuery === '/') {
    return '/';
  }
  return withoutQuery.endsWith('/') ? withoutQuery.slice(0, -1) : withoutQuery;
}

/**
 * A route by its id, for the places one view links to another by name.
 *
 * Total, so a link never has to carry a non-null assertion: an id that has been
 * removed from the table lands on the not-found route, which is a page with a
 * heading and a way out, rather than crashing the render that was trying to
 * offer a link.
 */
export function routeById(id: RouteId): RouteDefinition {
  return ALL_ROUTES.find((route) => route.id === id) ?? NOT_FOUND_ROUTE;
}

/** The `href` for a route. Always relative, always a fragment. */
export function hrefFor(route: RouteDefinition): string {
  return `#${route.path}`;
}
