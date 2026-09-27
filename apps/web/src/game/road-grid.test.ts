// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * `road-grid.ts` §`distanceToDrawnRoad` — the point form of the whole-road
 * question, which `scatter.ts` asks of every item since #613.
 *
 * `corner-placement.test.ts` is where the corner it was written for is held;
 * this is the arithmetic on a road whose answer is known without it.
 */

import { describe, expect, it } from 'vitest';

import { distanceToDrawnRoad } from './road-grid';
import { northRoute, plannerCornerRoute } from './route-fixtures-testing';
import { corridorOrigin, drawnRoadFrame } from './terrain';

describe('the distance to any stretch of the drawn road — #613', () => {
  const profile = northRoute(1_000, () => 0);
  const origin = corridorOrigin(profile);

  it('is the offset off a straight road, to the millimetre, on either side', () => {
    const frame = drawnRoadFrame(profile, origin, 500);
    if (frame === undefined) throw new Error('a straight road has a direction');
    for (const offset of [0, 1.5, 4, -6.5]) {
      const x = frame.x + frame.normalX * offset;
      const z = frame.z + frame.normalZ * offset;
      expect(distanceToDrawnRoad(profile, origin, x, z, 10)).toBeCloseTo(Math.abs(offset), 3);
    }
  });

  it('is no nearer than the reach it was asked for when the road is further away', () => {
    const frame = drawnRoadFrame(profile, origin, 500);
    if (frame === undefined) throw new Error('a straight road has a direction');
    const x = frame.x + frame.normalX * 200;
    const z = frame.z + frame.normalZ * 200;
    expect(distanceToDrawnRoad(profile, origin, x, z, 10)).toBeGreaterThanOrEqual(10);
  });

  it('finds the OTHER leg of a sharp corner, which is nowhere near the place asked from', () => {
    // A point placed 7 m off the incoming leg, 12 m before a 150° corner: the
    // outgoing leg comes back to within a few metres of it, and a check that
    // looked only near the route distance it was placed at would never see it.
    const corner = plannerCornerRoute(150, 'right');
    const cornerOrigin = corridorOrigin(corner);
    const incoming = drawnRoadFrame(corner, cornerOrigin, 1_488);
    if (incoming === undefined) throw new Error('the corner has a direction');
    let nearer = 0;
    for (const side of [-1, 1]) {
      const x = incoming.x + incoming.normalX * 7 * side;
      const z = incoming.z + incoming.normalZ * 7 * side;
      if (distanceToDrawnRoad(corner, cornerOrigin, x, z, 10) < 6.5) nearer += 1;
    }
    expect(nearer).toBe(1);
  });
});
