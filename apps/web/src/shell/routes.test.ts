// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import {
  ACTIVITY_DETAIL_ROUTE,
  ALL_ROUTES,
  CREDITS_ROUTE,
  hrefFor,
  hrefForActivity,
  matchHash,
  normaliseHash,
  NOT_FOUND_ROUTE,
  routeById,
  routeForHash,
  ROUTES,
} from './routes';

describe('normaliseHash', () => {
  it.each([
    ['', '/'],
    ['#', '/'],
    ['#/', '/'],
    ['#/activities', '/activities'],
    ['/activities', '/activities'],
    ['#/activities/', '/activities'],
    ['#/activities?from=nav', '/activities'],
    ['#/activities#section', '/activities'],
  ])('%s → %s', (hash, expected) => {
    expect(normaliseHash(hash)).toBe(expected);
  });
});

describe('routeForHash', () => {
  it('resolves an empty hash to the home screen, which is the first thing anyone sees — #428', () => {
    // ⚠️ It was the Ride screen until #428, and a reviewer who remembers this
    // test saying so is reading the old file.
    expect(routeForHash('').id).toBe('home');
    expect(routeForHash('#/ride').id).toBe('ride');
  });

  it.each(ROUTES)('round-trips $id through its own href', (route) => {
    expect(routeForHash(hrefFor(route))).toEqual(route);
  });

  it('is total — an unknown fragment is a real page, not undefined', () => {
    // A router that can return nothing renders a blank document on a typo, and
    // a blank document has no navigation to get out of.
    expect(routeForHash('#/nope')).toEqual(NOT_FOUND_ROUTE);
    expect(routeForHash('#oyl-main')).toEqual(NOT_FOUND_ROUTE);
  });
});

describe('matchHash — the route parameter #50 introduced', () => {
  it('opens a ride from its own link, and hands back the id', () => {
    const match = matchHash(hrefForActivity('ride-7'));
    expect(match.route).toEqual(ACTIVITY_DETAIL_ROUTE);
    expect(match.parameter).toBe('ride-7');
  });

  it('keeps the list route and the detail route apart', () => {
    // Both begin `/activities`. A matcher comparing prefixes rather than
    // segments would send the list to the detail view with no id.
    expect(matchHash('#/activities').route.id).toBe('activities');
    expect(matchHash('#/activities').parameter).toBeUndefined();
    expect(matchHash('#/activities/ride-7').route.id).toBe('activity-detail');
  });

  it('treats a trailing slash as the list rather than as a ride with no id', () => {
    // `#/activities/` normalises to `/activities`, so this lands on the list.
    // The alternative — an empty parameter reaching the detail view — renders a
    // "no such ride" page for a link that is really just untidy.
    expect(matchHash('#/activities/').route.id).toBe('activities');
  });

  it('round-trips an id that needs encoding', () => {
    // A UUID needs none of this, but an id from an imported file might carry a
    // slash, a hash or a space. The encoding and the decoding are one pair and
    // neither is spelled out anywhere else.
    for (const id of ['a/b', 'a#b', 'a b', 'a%b', 'ünïcode']) {
      expect(matchHash(hrefForActivity(id)).parameter).toBe(id);
    }
  });

  it('does not let a slash in an id invent a route', () => {
    // The failure the encoding prevents: an unencoded `a/b` would make
    // `#/activities/a/b`, which is four segments and matches nothing.
    expect(matchHash(hrefForActivity('a/b')).route.id).toBe('activity-detail');
  });

  it('falls through to the not-found page on an undecodable parameter', () => {
    // A lone `%` is reachable by typing in the address bar, and
    // `decodeURIComponent` throws on it. Letting that escape would replace the
    // whole app with an unhandled exception.
    expect(matchHash('#/activities/%').route).toEqual(NOT_FOUND_ROUTE);
    expect(() => matchHash('#/activities/%E0%A4%A')).not.toThrow();
  });

  it('does not match the not-found route by its own path', () => {
    // `/not-found` reaches the not-found page because it matches nothing, not
    // because it matched an entry — so the page is reachable by accident and
    // never by a link.
    expect(matchHash('#/not-found').route).toEqual(NOT_FOUND_ROUTE);
    expect(ROUTES.map((route) => route.id)).not.toContain('activity-detail');
  });
});

describe('hrefFor with a parameter', () => {
  it('substitutes the segment rather than appending to the path', () => {
    expect(hrefForActivity('ride-7')).toBe('#/activities/ride-7');
  });

  it('leaves the placeholder alone when no parameter is given', () => {
    // Which is what the accessibility suite navigates to when it walks
    // `ALL_ROUTES`. It has to be a page rather than a crash.
    expect(hrefFor(ACTIVITY_DETAIL_ROUTE)).toBe('#/activities/:activity');
    expect(matchHash(hrefFor(ACTIVITY_DETAIL_ROUTE)).route).toEqual(ACTIVITY_DETAIL_ROUTE);
  });

  it('ignores a parameter given to a route that has no placeholder', () => {
    expect(hrefFor(routeById('about'), 'ignored')).toBe('#/about');
  });
});

describe('routeById', () => {
  it.each(ALL_ROUTES)('finds $id', (route) => {
    expect(routeById(route.id)).toEqual(route);
  });
});

describe('the table itself', () => {
  it('gives every route a distinct path and a distinct title', () => {
    expect(new Set(ALL_ROUTES.map((route) => route.path)).size).toBe(ALL_ROUTES.length);
    expect(new Set(ALL_ROUTES.map((route) => route.title)).size).toBe(ALL_ROUTES.length);
  });

  it('gives every route a summary, so no view is a bare heading', () => {
    for (const route of ALL_ROUTES) {
      expect(route.summary.length, `${route.id} has no summary`).toBeGreaterThan(20);
    }
  });

  it('keeps the parameterised detail route out of the navigation', () => {
    // There is no such thing as "the" activity, so there is nothing for a
    // navigation entry to point at — and an entry reading `#/activities/:activity`
    // in the header would be a link to a page about a ride called ":activity".
    expect(ROUTES).not.toContain(ACTIVITY_DETAIL_ROUTE);
    expect(ALL_ROUTES).toContain(ACTIVITY_DETAIL_ROUTE);
  });

  it('keeps the credits route reachable but out of the navigation', () => {
    // ⚠️ **The reachable half is a licence requirement**, not a preference:
    // ADR 0023 D-3 puts the attribution inside the app because CC BY 4.0
    // §3(a)(2) judges "a reasonable manner" by the medium, and the medium is an
    // APK. It is out of the header because it hangs off the About page, where
    // the licence statement already is — and it is in `ALL_ROUTES` so the
    // accessibility suite audits it with nobody editing a test.
    //
    // The `routeById` half is what stops the About page's own assertion going
    // vacuous: `routeById` falls back to the not-found route, so a test that
    // compares one `hrefFor(routeById('credits'))` against another would pass
    // just as happily after this entry had been deleted.
    expect(ROUTES).not.toContain(CREDITS_ROUTE);
    expect(ALL_ROUTES).toContain(CREDITS_ROUTE);
    expect(routeById('credits')).toEqual(CREDITS_ROUTE);
    expect(matchHash('#/about/credits').route).toEqual(CREDITS_ROUTE);
  });

  it('keeps the not-found route out of the navigation', () => {
    // It has no link to it by design; including it would put a permanent "Not
    // found" entry in the header.
    expect(ROUTES.map((route) => route.id)).not.toContain('not-found');
    expect(ALL_ROUTES).toContain(NOT_FOUND_ROUTE);
  });
});

describe('which routes are read and which are operated (#422)', () => {
  it('drops the reading measure for the Ride screen and for nothing else', () => {
    // ⚠️ Both directions. `--oyl-measure` hid `WorkoutPanel` below the fold on
    // a landscape tablet, which is why the Ride screen escapes it — and it is
    // correct for every other route here, which is why nothing else does. A
    // second `instruments` route is a decision, and this is where it is seen.
    const operated = ALL_ROUTES.filter((route) => route.layout === 'instruments');

    expect(operated.map((route) => route.id)).toEqual(['ride']);
    expect(ALL_ROUTES.length - operated.length).toBeGreaterThan(10);
  });

  it('gives every route one of the three, so the shell never writes a class naming no rule', () => {
    for (const route of ALL_ROUTES) {
      expect(['prose', 'instruments', 'dashboard'], route.id).toContain(route.layout);
    }
  });

  it('lays out the home screen as cards, and nothing else — #428', () => {
    expect(ALL_ROUTES.filter((route) => route.layout === 'dashboard').map((r) => r.id)).toEqual([
      'home',
    ]);
  });
});
