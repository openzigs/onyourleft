// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Which navigations may animate — #945. The browser gate
 * (`browser/motion.browser.spec.ts`) counts what the page starts; this is the
 * rule it rests on, including the immersive half no harness page can reach
 * without a renderer.
 */

import { describe, expect, it } from 'vitest';

import {
  mayAnimateBetween,
  mayCarryOn,
  NAVIGATION_TRANSITION_TYPE,
  navigationKind,
  RIDE_ROUTE_IDS,
  ROUTE_TRANSITION_CLASS,
} from './route-motion';
import { carriedFrom } from './ListDetail';
import { ALL_ROUTES, matchHash, routeById, type RouteId } from './routes';

function at(id: RouteId): ReturnType<typeof matchHash> {
  return { route: routeById(id) };
}

describe('which navigations may animate (#945)', () => {
  it('animates a navigation between two menu routes', () => {
    expect(mayAnimateBetween(at('home'), at('activities'), false)).toBe(true);
    expect(mayAnimateBetween(matchHash('#/'), matchHash('#/routes'), false)).toBe(true);
  });

  it('never animates to or from the Ride screen or the game', () => {
    for (const ride of ['ride', 'game'] as const) {
      expect(mayAnimateBetween(at('home'), at(ride), false)).toBe(false);
      expect(mayAnimateBetween(at(ride), at('home'), false)).toBe(false);
      expect(mayAnimateBetween(at(ride), at(ride), false)).toBe(false);
    }
  });

  it('never animates anything while a ride has the screen', () => {
    expect(mayAnimateBetween(at('home'), at('activities'), true)).toBe(false);
  });

  it('names exactly the two routes a rider rides on, and both exist', () => {
    expect([...RIDE_ROUTE_IDS].sort()).toEqual(['game', 'ride']);
    const ids = new Set(ALL_ROUTES.map((route) => route.id));
    for (const id of RIDE_ROUTE_IDS) {
      expect(ids.has(id)).toBe(true);
    }
  });
});

describe('which way a navigation goes (#2054)', () => {
  const by = (hash: string): ReturnType<typeof matchHash> => matchHash(hash);

  it('goes deeper into a page below, and back out of it', () => {
    expect(navigationKind(by('#/segments'), by('#/segments/s-1'))).toBe('deeper');
    expect(navigationKind(by('#/segments/s-1'), by('#/segments'))).toBe('back');
    expect(navigationKind(by('#/about'), by('#/about/credits'))).toBe('deeper');
    expect(navigationKind(by('#/about/credits'), by('#/about'))).toBe('back');
    expect(navigationKind(by('#/routes'), by('#/routes/new'))).toBe('deeper');
    // More than one level, either way.
    expect(navigationKind(by('#/settings'), by('#/settings/instance/moderation'))).toBe('deeper');
    expect(navigationKind(by('#/settings/instance/moderation'), by('#/settings'))).toBe('back');
  });

  it('goes across between tabs, and between pages neither of which is above the other', () => {
    expect(navigationKind(at('home'), at('activities'))).toBe('across');
    expect(navigationKind(at('activities'), at('routes'))).toBe('across');
    expect(navigationKind(by('#/segments/s-1'), by('#/activities/a-1'))).toBe('across');
    expect(navigationKind(by('#/settings'), by('#/segments/s-1'))).toBe('across');
  });

  it('compares whole segments, never a character prefix', () => {
    // `/about` is a character prefix of `/about-x/y` but not a segment of it.
    const page = (path: string): ReturnType<typeof matchHash> => ({
      route: { ...routeById('about'), path },
    });
    expect(navigationKind(page('/about'), page('/about-x/y'))).toBe('across');
    expect(navigationKind(page('/about-x/y'), page('/about'))).toBe('across');
    expect(navigationKind(page('/about'), page('/about/y'))).toBe('deeper');
  });

  it('never counts Home as above anything, or every navigation from it would be deeper', () => {
    expect(navigationKind(at('home'), by('#/activities/a-1'))).toBe('across');
    expect(navigationKind(by('#/activities/a-1'), at('home'))).toBe('across');
  });

  it('names a slide class for deeper and back, and the cross-fade for the rest', () => {
    expect(ROUTE_TRANSITION_CLASS[NAVIGATION_TRANSITION_TYPE.deeper]).toBe('oyl-route-deeper');
    expect(ROUTE_TRANSITION_CLASS[NAVIGATION_TRANSITION_TYPE.back]).toBe('oyl-route-back');
    expect(ROUTE_TRANSITION_CLASS.default).toBe('oyl-route');
    // `across` falls to the default, the cross-fade #945 shipped.
    expect(NAVIGATION_TRANSITION_TYPE.across in ROUTE_TRANSITION_CLASS).toBe(false);
  });
});

describe('where a card may be carried into its detail (#1072, ADR 0041 D-3)', () => {
  it('on a menu route, never on a ride route, and never while a ride has the screen', () => {
    expect(mayCarryOn('activities', false)).toBe(true);
    expect(mayCarryOn('routes', false)).toBe(true);
    expect(mayCarryOn('workouts', false)).toBe(true);
    expect(mayCarryOn('ride', false)).toBe(false);
    expect(mayCarryOn('game', false)).toBe(false);
    expect(mayCarryOn('activities', true)).toBe(false);
  });

  it('draws the detail over the card and carries it to rest, and refuses a box with no size', () => {
    const card = { left: 10, top: 300, width: 200, height: 50 };
    const pane = { left: 400, top: 100, width: 800, height: 500 };
    expect(carriedFrom(card, pane)).toEqual({
      x: [-390, 0],
      y: [200, 0],
      scaleX: [0.25, 1],
      scaleY: [0.1, 1],
      opacity: [0.4, 1],
    });
    expect(carriedFrom(card, { ...pane, width: 0 })).toBeUndefined();
    expect(carriedFrom({ ...card, height: 0 }, pane)).toBeUndefined();
  });
});
