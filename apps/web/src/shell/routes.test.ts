// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import {
  ACTIVITY_DETAIL_ROUTE,
  ALL_ROUTES,
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
  it('resolves an empty hash to the ride view, which is the first thing anyone sees', () => {
    expect(routeForHash('').id).toBe('ride');
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

  it('keeps the not-found route out of the navigation', () => {
    // It has no link to it by design; including it would put a permanent "Not
    // found" entry in the header.
    expect(ROUTES.map((route) => route.id)).not.toContain('not-found');
    expect(ALL_ROUTES).toContain(NOT_FOUND_ROUTE);
  });
});
