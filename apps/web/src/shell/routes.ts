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
export type RouteId =
  | 'ride'
  | 'activities'
  | 'activity-detail'
  | 'analysis'
  | 'segments'
  | 'segment-detail'
  | 'routes'
  | 'route-builder'
  | 'workouts'
  | 'game'
  | 'devices'
  | 'transfer'
  | 'settings'
  | 'about'
  | 'credits'
  | 'not-found';

/**
 * Whether a route is something to READ or something to OPERATE — #422.
 *
 * `theme.css` bounds `.oyl-main` with `max-width: var(--oyl-measure)`, a
 * typographic reading measure of about 68 characters. That is the right rule
 * for a list of rides, a settings form and a page of prose, and it was applied
 * to **every** route — including the one a rider operates with a trainer in
 * front of them, on a tablet clamped to the bars in landscape. Measured on a
 * Pixel Tablet on 2026-09-20: a portrait-width column beside a display that was
 * about 53 % blank, cut off at the ride controls, with `WorkoutPanel` entirely
 * below the fold. A rider who set out to test whether ERG releases cleanly
 * (#372) started a plain recording instead, because the control that starts a
 * workout was not on the screen — and the wire showed Request Control, 103
 * seconds of nothing, and Stop. **A layout rule produced a false answer to a
 * safety question.**
 *
 * - `prose` keeps the measure. Every route but one.
 * - `instruments` drops it and lets the view use the width it is given.
 *
 * ## Why a field on the route table, which #422 asks to have decided
 *
 * - **Not a media query alone.** A query knows the viewport and not the route;
 *   a wide viewport is exactly where the Activities list most needs its measure.
 * - **Not a class the view adds.** `main` is the shell's element, so a view
 *   would be reaching up out of itself to restyle its own container.
 * - **Required, not optional with a default.** A route added to this table
 *   fails to compile until somebody has said which it is. The cheap mistake
 *   this prevents is the one that was made: nobody decided the Ride screen was
 *   prose, it simply inherited it.
 *
 * ⚠️ **The measure is NOT removed globally and must not be.** It is correct for
 * every other route here.
 *
 * ⚠️ The trainer game is `prose` and that is not an oversight: its *picker* is
 * a form and wants the measure, and its *ride* is a fixed full-bleed stage
 * (#423) which no `max-width` on an ancestor can bound.
 */
export type RouteLayout = 'prose' | 'instruments';

/**
 * Which of the primary destinations a route belongs to — #427.
 *
 * ## The grouping, and where it was decided
 *
 * Eleven text links in a row became **four groups**, the proposal on #427,
 * adopted as it stood:
 *
 * | group | holds |
 * |---|---|
 * | **Ride** | Ride, Trainer game, Workouts |
 * | **History** | Activities, Analysis, Segments |
 * | **Routes** | Routes (and the builder) |
 * | **More** | Devices, Files, Settings, About |
 *
 * Material 3's adaptive guidance — read for #427 on 2026-09-20 — puts three to
 * five destinations in primary navigation and the rest in a secondary layer:
 * a bar on a compact width and a rail on a medium or expanded one. So a group
 * is a destination: its link goes to the FIRST route listed in it, and on any
 * route of a group with more than one member the shell draws the group's own
 * pages as a second row of links. Every route is therefore at most two
 * activations away — the group, then the page — which `routes.a11y.test.tsx`
 * walks rather than asserts.
 *
 * ⚠️ **A field on each route, not a second table.** The accessibility gate
 * renders every entry of {@link ROUTES} (#48), and a grouping kept beside it
 * could name a route that is not there or miss one that is. {@link NAV_GROUPS}
 * holds only what a group IS — its label and its icon — and membership is
 * read off this table, in this table's order.
 */
export type NavGroupId = 'ride' | 'history' | 'routes' | 'more';

/** The icons the navigation draws. Inline SVG authored here — `NavIcon.tsx`. */
export type NavIconName = 'ride' | 'history' | 'routes' | 'more';

export interface NavGroup {
  readonly id: NavGroupId;
  /** Shown under the icon, always — an icon-only rail would need its name elsewhere. */
  readonly label: string;
  readonly icon: NavIconName;
}

/** The primary destinations, in the order the bar and the rail draw them. @see NavGroupId */
export const NAV_GROUPS: readonly NavGroup[] = [
  { id: 'ride', label: 'Ride', icon: 'ride' },
  { id: 'history', label: 'History', icon: 'history' },
  { id: 'routes', label: 'Routes', icon: 'routes' },
  { id: 'more', label: 'More', icon: 'more' },
];

export interface RouteDefinition {
  readonly id: RouteId;
  /**
   * The part after the `#`, always starting with `/`.
   *
   * A segment beginning with `:` is a **parameter**: `/activities/:activity`
   * matches `/activities/ride-7` and captures `ride-7`. Exactly one route uses
   * one today. See {@link matchHash}.
   */
  readonly path: string;
  /** The link text in the header. Short. */
  readonly navLabel: string;
  /** The `h1` and the document title. Sentence-shaped. */
  readonly title: string;
  /** One line under the heading, so a view is never a bare title. */
  readonly summary: string;
  /** @see RouteLayout */
  readonly layout: RouteLayout;
  /**
   * Which primary destination this route belongs to. @see NavGroupId
   *
   * Absent only on the not-found page, which belongs to nothing.
   */
  readonly group?: NavGroupId;
}

/**
 * Every navigable route, grouped and in group order — #427. A group's link
 * goes to its first entry here, and its pages are listed in this order.
 */
export const ROUTES: readonly RouteDefinition[] = [
  {
    id: 'ride',
    group: 'ride',
    layout: 'instruments',
    path: '/',
    navLabel: 'Ride',
    title: 'Ride',
    summary:
      'Record a ride from the sensors paired on this device. Everything stays on this device.',
  },
  {
    id: 'game',
    group: 'ride',
    layout: 'prose',
    path: '/game',
    navLabel: 'Trainer game',
    title: 'Trainer game',
    summary:
      'Ride a saved route against a pacer that will not wait for you, or against your own ' +
      'previous attempt. Solo, offline, and no leaderboard of any kind.',
  },
  {
    id: 'workouts',
    group: 'ride',
    layout: 'prose',
    path: '/workouts',
    navLabel: 'Workouts',
    title: 'Workouts',
    summary:
      'Structured sessions built from blocks. Targets are a share of your own threshold, so the ' +
      'same workout works whatever shape you are in.',
  },
  {
    id: 'activities',
    group: 'history',
    layout: 'prose',
    path: '/activities',
    navLabel: 'Activities',
    title: 'Activities',
    summary: 'Rides recorded on this device, newest first.',
  },
  {
    id: 'analysis',
    group: 'history',
    layout: 'prose',
    path: '/analysis',
    navLabel: 'Analysis',
    title: 'Analysis',
    summary:
      'Time in zone for a ride, and the best average power you have held for each length of time.',
  },
  {
    id: 'segments',
    group: 'history',
    layout: 'prose',
    path: '/segments',
    navLabel: 'Segments',
    title: 'Segments',
    summary:
      'Stretches of road you have named, cut from your own rides. A climb and its descent are ' +
      'two different segments.',
  },
  {
    id: 'routes',
    group: 'routes',
    layout: 'prose',
    path: '/routes',
    navLabel: 'Routes',
    title: 'Routes',
    summary:
      'Rides you plan to do, imported from a GPX file. A route is private until you say ' +
      'otherwise, and one that starts inside a privacy zone cannot be shared at all.',
  },
  {
    id: 'devices',
    group: 'more',
    layout: 'prose',
    path: '/devices',
    navLabel: 'Devices',
    title: 'Devices',
    summary: 'Heart rate straps, power meters, cadence sensors and smart trainers, over Bluetooth.',
  },
  {
    id: 'transfer',
    group: 'more',
    layout: 'prose',
    path: '/transfer',
    // "Files", not "Import", because the page is both directions and because
    // ADR 0009 R3 forbids naming one of our features after somebody else's
    // mark — "Strava import" is not a label this product may carry.
    navLabel: 'Files',
    title: 'Import and export',
    summary:
      'Bring rides in from a FIT, GPX or TCX file, and take your own rides out in any of the three.',
  },
  {
    id: 'settings',
    group: 'more',
    layout: 'prose',
    path: '/settings',
    navLabel: 'Settings',
    title: 'Settings',
    summary:
      'How this device shows your numbers. Nothing here is sent anywhere, and nothing here ' +
      'changes what a ride recorded.',
  },
  {
    id: 'about',
    group: 'more',
    layout: 'prose',
    path: '/about',
    navLabel: 'About',
    title: 'About On Your Left',
    summary: 'What this is, what it does not do, and where your data lives.',
  },
];

/**
 * The route drawing canvas (#71).
 *
 * **Not in {@link ROUTES}**, so it carries no navigation entry: drawing a route
 * is reached from the routes screen, and a top-level link beside "Routes" reads
 * as a second, different feature. It is in {@link ALL_ROUTES}, so the
 * accessibility suite audits it without anyone editing a test — which is the
 * property #48 built the table for, and the reason a route with no nav entry
 * still needs a title and a summary.
 *
 * ⚠️ Its path is `/routes/new`, a **literal** third segment rather than a
 * parameter. {@link matchHash} compares literals before it captures, so if a
 * `/routes/:route` detail route is ever added this one still wins — worth
 * knowing before somebody adds it and assumes the order in
 * {@link MATCHABLE_ROUTES} decides.
 */
export const ROUTE_BUILDER_ROUTE: RouteDefinition = {
  id: 'route-builder',
  group: 'routes',
  layout: 'prose',
  path: '/routes/new',
  navLabel: 'Draw a route',
  title: 'Draw a route',
  summary:
    'Place waypoints and have the roads between them worked out. Every control works from the ' +
    'keyboard, and a half-drawn route survives closing the tab.',
};

/**
 * Who made the artwork this app ships (#358).
 *
 * **Not in {@link ROUTES}**, for {@link ROUTE_BUILDER_ROUTE}'s reason: it is
 * reached from the About page, where the licence statement already is, and a
 * twelfth top-level link would read as a twelfth feature. It is in
 * {@link ALL_ROUTES}, so the accessibility suite audits it without anyone
 * editing a test.
 *
 * ⚠️ **It is reachable from inside the application on purpose, and that is a
 * licence requirement rather than a courtesy** — [ADR 0023](../../../../docs/adr/0023-cc-by-assets-and-attribution.md)
 * D-3. CC BY 4.0 §3(a)(2) lets attribution be given *"in any reasonable manner
 * based on the medium"*, and the medium is an APK: somebody who installs this
 * app never sees the repository, so a file in git is not reasonably
 * discoverable by them. Deleting the link from `AboutView` would leave this
 * page unreachable and the obligation unmet.
 */
export const CREDITS_ROUTE: RouteDefinition = {
  id: 'credits',
  group: 'more',
  layout: 'prose',
  path: '/about/credits',
  navLabel: 'Credits',
  title: 'Credits',
  summary: 'Who made the models and artwork this app ships, and the terms they are used under.',
};

/**
 * One stored ride, in full (#50).
 *
 * **Not in {@link ROUTES}**, for the reason {@link NOT_FOUND_ROUTE} is not:
 * there is no such thing as "the" activity, so there is nothing for a
 * navigation entry to point at. It is reached from a row of the activities
 * table, which is where the id comes from.
 *
 * The `:activity` segment is the first route parameter in this shell. The
 * comment at the top of this file said there were none and that a query string
 * would therefore be dropped; that is still true of query strings, and a path
 * segment is now matched instead — see {@link matchHash}.
 */
export const ACTIVITY_DETAIL_ROUTE: RouteDefinition = {
  id: 'activity-detail',
  group: 'history',
  layout: 'prose',
  path: '/activities/:activity',
  navLabel: 'Ride details',
  // The `h1` the shell renders, and therefore the same for every ride. The
  // ride's own name is an `h2` inside the view, which keeps the heading order
  // honest and keeps `routes.a11y.test.tsx`'s "the h1 is the route title"
  // assertion true of a route whose subject is only known at run time.
  title: 'Ride details',
  summary: 'Everything this device holds about one ride.',
};

/**
 * One segment, its effort history and the overlay (#67).
 *
 * Not in {@link ROUTES}, for {@link ACTIVITY_DETAIL_ROUTE}'s reason: there is
 * no such thing as "the" segment, so there is nothing for a navigation entry to
 * point at. It is reached from a row of the segments list, which is where the
 * id comes from.
 *
 * ⚠️ Its path has the same **shape** as the activity route — three segments,
 * one of them a parameter — and they are told apart by the literal in the
 * middle. {@link matchHash} compares literals before it captures, so the order
 * of the two in {@link ALL_ROUTES} does not matter; that is worth knowing
 * before somebody adds a third and assumes it does.
 */
export const SEGMENT_DETAIL_ROUTE: RouteDefinition = {
  id: 'segment-detail',
  group: 'history',
  layout: 'prose',
  path: '/segments/:segment',
  navLabel: 'Segment',
  // The shell's `h1`, and therefore the same for every segment — the segment's
  // own name is an `h2` inside the view. Same reasoning as the activity route:
  // it keeps the heading order honest and keeps `routes.a11y.test.tsx`'s "the
  // h1 is the route title" assertion true of a route whose subject is only
  // known at run time.
  title: 'Segment',
  summary: 'Every time you have ridden this stretch of road, and how two of those efforts compare.',
};

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
  layout: 'prose',
  path: '/not-found',
  navLabel: 'Not found',
  title: 'That page does not exist',
  summary: 'The address in the bar does not match any page in this app.',
};

/** Every route the audit must cover, navigable or not. */
export const ALL_ROUTES: readonly RouteDefinition[] = [
  ...ROUTES,
  CREDITS_ROUTE,
  ROUTE_BUILDER_ROUTE,
  ACTIVITY_DETAIL_ROUTE,
  SEGMENT_DETAIL_ROUTE,
  NOT_FOUND_ROUTE,
];

/**
 * The routes {@link matchHash} tries, in order.
 *
 * Derived from {@link ALL_ROUTES} by removing the one route nothing navigates
 * *to* — a fragment reading `/not-found` should land on the not-found page
 * because it matches nothing, not because it matched an entry. Subtracting it
 * rather than restating the list is what stops a route added above from being
 * navigable in the audit and unreachable in the browser.
 */
const MATCHABLE_ROUTES: readonly RouteDefinition[] = ALL_ROUTES.filter(
  (route) => route.id !== 'not-found',
);

/**
 * A route, and whatever its parameter segment captured.
 *
 * A separate type from {@link RouteDefinition} because the definition is a
 * constant and the capture is not: the route is the same object for every
 * ride, and the id is the part that differs. Merging them would mean a route
 * table whose entries are rebuilt per navigation.
 */
export interface RouteMatch {
  readonly route: RouteDefinition;
  /**
   * The value of the route's single `:` segment, already percent-decoded.
   *
   * `undefined` for every route that has no parameter — which is all of them
   * but {@link ACTIVITY_DETAIL_ROUTE}. Never the empty string: `#/activities/`
   * normalises to `/activities`, so the list route matches and this one does
   * not, rather than opening a detail view for a ride with no id.
   */
  readonly parameter?: string;
}

/**
 * The route a `location.hash` selects, and what its parameter captured.
 *
 * Total, for {@link routeForHash}'s reason. A parameter segment matches any
 * single segment, so a percent-encoded id containing a slash round-trips: the
 * encoding is applied by {@link hrefFor} and undone here, and neither half is
 * spelled out anywhere else.
 *
 * ⚠️ **An undecodable parameter is not a match.** `decodeURIComponent` throws
 * on a lone `%` — reachable by typing in the address bar — and a router that
 * let that escape would replace the whole app with an unhandled exception. It
 * falls through to the not-found page instead, which is a page with a heading
 * and a way out.
 */
export function matchHash(hash: string): RouteMatch {
  const segments = normaliseHash(hash).split('/');
  for (const route of MATCHABLE_ROUTES) {
    const pattern = route.path.split('/');
    if (pattern.length !== segments.length) {
      continue;
    }
    let parameter: string | undefined;
    let matched = true;
    for (const [index, expected] of pattern.entries()) {
      const actual = segments[index] ?? '';
      if (expected.startsWith(':')) {
        if (actual === '') {
          matched = false;
          break;
        }
        try {
          parameter = decodeURIComponent(actual);
        } catch {
          matched = false;
          break;
        }
      } else if (expected !== actual) {
        matched = false;
        break;
      }
    }
    if (matched) {
      return parameter === undefined ? { route } : { route, parameter };
    }
  }
  return { route: NOT_FOUND_ROUTE };
}

/**
 * The route a `location.hash` selects.
 *
 * Total: anything unrecognised — including an empty hash, a bare `#`, and a
 * fragment left over from an in-page anchor — resolves to a real route rather
 * than to `undefined`. A router that can return nothing is a router that renders
 * a blank page on a typo.
 */
export function routeForHash(hash: string): RouteDefinition {
  return matchHash(hash).route;
}

/**
 * `'#/activities?x=1'` → `'/activities'`, `''` → `'/'`.
 *
 * The query and any nested fragment are dropped: this shell has no query
 * parameters, and silently matching `'/activities?x=1'` against nothing would
 * send a perfectly good deep link to the not-found page. A **path** parameter
 * is a different thing and is matched — see {@link matchHash}.
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

/**
 * The `href` for a route. Always relative, always a fragment.
 *
 * @param parameter the value for the route's `:` segment, percent-encoded here
 * so that an id containing a slash, a `#` or a space produces a link that
 * {@link matchHash} reads back unchanged. Ignored by a route with no parameter,
 * and a parameterised route asked for a link without one keeps its placeholder
 * — which is what {@link ALL_ROUTES}'s accessibility audit navigates to, and is
 * a page rather than a crash.
 */
export function hrefFor(route: RouteDefinition, parameter?: string): string {
  if (parameter === undefined) {
    return `#${route.path}`;
  }
  const path = route.path
    .split('/')
    .map((segment) => (segment.startsWith(':') ? encodeURIComponent(parameter) : segment))
    .join('/');
  return `#${path}`;
}

/** The link to one ride's detail view. */
export function hrefForActivity(id: string): string {
  return hrefFor(ACTIVITY_DETAIL_ROUTE, id);
}

/** The link to one segment's effort history (#67). */
export function hrefForSegment(id: string): string {
  return hrefFor(SEGMENT_DETAIL_ROUTE, id);
}

/** The navigable routes of one group, in {@link ROUTES} order. */
export function routesInGroup(group: NavGroupId): readonly RouteDefinition[] {
  return ROUTES.filter((route) => route.group === group);
}

/**
 * Where a group's link goes: its first route. Total, for the reason
 * {@link routeById} is — a group nothing belongs to lands on not-found.
 */
export function groupDestination(group: NavGroupId): RouteDefinition {
  return routesInGroup(group)[0] ?? NOT_FOUND_ROUTE;
}
