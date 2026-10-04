// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Which navigations may animate — #945. The browser gate
 * (`browser/motion.browser.spec.ts`) counts what the page starts; this is the
 * rule it rests on, including the immersive half no harness page can reach
 * without a renderer.
 */

import { describe, expect, it } from 'vitest';

import { mayAnimateBetween, RIDE_ROUTE_IDS } from './route-motion';
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
