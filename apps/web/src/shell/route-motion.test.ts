// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Which navigations may animate — #945. The browser gate
 * (`browser/motion.browser.spec.ts`) counts what the page starts; this is the
 * rule it rests on, including the immersive half no harness page can reach
 * without a renderer.
 */

import { describe, expect, it } from 'vitest';

import { mayAnimateBetween, mayCarryOn, RIDE_ROUTE_IDS } from './route-motion';
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
