// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * `road-grid.ts` §`distanceToDrawnRoad` — the point form of the whole-road
 * question, which `scatter.ts` asks of every item since #613.
 *
 * `corner-placement.test.ts` is where the corner it was written for is held;
 * this is the arithmetic on a road whose answer is known without it.
 */

import { describe, expect, it } from 'vitest';

import { distanceToDrawnRoad, squaredToSegment } from './road-grid';
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

describe("a segment with no length — #613's review, folded into #602", () => {
  it('is measured as its one point, never as NaN', () => {
    // Without the guard `0 / 0` is NaN, `Math.min(least, NaN)` stays NaN for
    // the rest of a search, and every clearance compared against it is false:
    // the check would keep an item standing on the road, silently.
    expect(squaredToSegment(3, 4, 0, 0, 0, 0, 0)).toBe(25);
    expect(squaredToSegment(-1, 2, -1, 2, 0, 0, 0)).toBe(0);
  });

  it('still clamps a real segment to its ends', () => {
    // The control that the guard is what the first case reads: a segment
    // from the origin along +x, from a point beyond its far end.
    expect(squaredToSegment(5, 0, 0, 0, 2, 0, 4)).toBe(9);
    expect(squaredToSegment(1, 3, 0, 0, 2, 0, 4)).toBe(9);
  });
});
