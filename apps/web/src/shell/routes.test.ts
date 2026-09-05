// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import {
  ALL_ROUTES,
  hrefFor,
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

  it('keeps the not-found route out of the navigation', () => {
    // It has no link to it by design; including it would put a permanent "Not
    // found" entry in the header.
    expect(ROUTES.map((route) => route.id)).not.toContain('not-found');
    expect(ALL_ROUTES).toContain(NOT_FOUND_ROUTE);
  });
});
