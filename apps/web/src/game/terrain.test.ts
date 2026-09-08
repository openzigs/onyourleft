// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The corridor's geometry, and the two bounds that keep a rebuild cheap.
 *
 * Everything here is pure arithmetic over #89's profile, so it is all testable
 * in jsdom — which matters, because the *rendering* of this geometry is not
 * (jsdom implements no WebGL, §4f). The split is deliberate: as much of the
 * renderer as possible is arithmetic that can be asserted here, and what is left
 * for the browser gate is only what genuinely needs a GL context.
 */

import { describe, expect, it } from 'vitest';

import { MAXIMUM_CORRIDOR_QUADS, ROAD_WIDTH_METRES, corridorOrigin, roadCorridor } from './terrain';
import {
  altitudeMetres,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  routeProfile,
  type RoutePoint,
} from '@onyourleft/domain';

/** A straight kilometre running due north, climbing steadily. */
function straightClimb(resolutionMetres = 10): ReturnType<typeof routeProfile> {
  const points: RoutePoint[] = [];
  for (let index = 0; index <= 100; index += 1) {
    const northMetres = index * 10;
    points.push({
      position: geographicPosition(
        degreesLatitude(51.5 + northMetres / 111_320),
        degreesLongitude(-0.12),
      ),
      elevation: altitudeMetres(index * 0.5),
    });
  }
  return routeProfile(points, { resolutionMetres });
}

/** A square loop, so the corridor has real corners and a wrap to cross. */
function squareLoop(): ReturnType<typeof routeProfile> {
  const side = 400;
  const spacing = 10;
  const corners: [number, number][] = [
    [0, 0],
    [0, side],
    [side, side],
    [side, 0],
  ];
  const perDegreeLongitude = 111_320 * Math.cos((51.5 * Math.PI) / 180);
  const points: RoutePoint[] = [];
  for (let leg = 0; leg < corners.length; leg += 1) {
    const from = corners[leg] as [number, number];
    const to = corners[(leg + 1) % corners.length] as [number, number];
    const steps = side / spacing;
    for (let step = 0; step < steps; step += 1) {
      const north = from[0] + ((to[0] - from[0]) * step) / steps;
      const east = from[1] + ((to[1] - from[1]) * step) / steps;
      points.push({
        position: geographicPosition(
          degreesLatitude(51.5 + north / 111_320),
          degreesLongitude(-0.12 + east / perDegreeLongitude),
        ),
        elevation: altitudeMetres(0),
      });
    }
  }
  return routeProfile(points, { loop: true });
}

describe('the corridor follows the route it was built from', () => {
  it('rises with the road', () => {
    const profile = straightClimb();
    const corridor = roadCorridor(profile, corridorOrigin(profile), 200);

    const first = corridor.centre[0];
    const last = corridor.centre[corridor.centre.length - 1];
    // A 5% climb over the corridor's span.
    expect(last?.y).toBeGreaterThan(first?.y ?? 0);
  });

  it('starts at the origin’s own height, so the road is not floating', () => {
    const profile = straightClimb();
    const corridor = roadCorridor(profile, corridorOrigin(profile), 0, {
      behindMetres: 0,
      aheadMetres: 100,
    });

    expect(corridor.centre[0]?.y).toBeCloseTo(0, 6);
  });

  it('runs due north for a route that runs due north', () => {
    const profile = straightClimb();
    const corridor = roadCorridor(profile, corridorOrigin(profile), 200);

    // Every centreline point sits on the same meridian, so x never moves.
    for (const point of corridor.centre) {
      expect(Math.abs(point.x)).toBeLessThan(0.5);
    }
    // And z increases.
    const zs = corridor.centre.map((point) => point.z);
    expect(zs[zs.length - 1]).toBeGreaterThan(zs[0] ?? 0);
  });

  it('keeps the road the width it says it is', () => {
    const profile = straightClimb();
    const corridor = roadCorridor(profile, corridorOrigin(profile), 200);

    // The first pair of edge vertices, six floats in.
    const leftX = corridor.vertices[0] as number;
    const leftZ = corridor.vertices[2] as number;
    const rightX = corridor.vertices[3] as number;
    const rightZ = corridor.vertices[5] as number;

    expect(Math.hypot(leftX - rightX, leftZ - rightZ)).toBeCloseTo(ROAD_WIDTH_METRES, 6);
  });

  it('does not bank the road across its width on a climb', () => {
    const profile = straightClimb();
    const corridor = roadCorridor(profile, corridorOrigin(profile), 200);

    // Both edge vertices of a pair share a height: a 5% climb is still flat
    // across the carriageway, and banking it would lift one wheel off the road.
    expect(corridor.vertices[1]).toBe(corridor.vertices[4]);
  });
});

describe('every vertex is a real number', () => {
  /**
   * NaN in a vertex buffer does not throw — it silently drops the triangle. So
   * this is asserted rather than assumed, and it is asserted at the far end,
   * which is where the naive `points[i + 1] - points[i]` walks off the array.
   */
  it('produces no NaN, including at the last point', () => {
    for (const profile of [straightClimb(), squareLoop()]) {
      const corridor = roadCorridor(profile, corridorOrigin(profile), 150);
      for (const value of corridor.vertices) {
        expect(Number.isFinite(value)).toBe(true);
      }
      for (const point of corridor.centre) {
        expect(Number.isFinite(point.x)).toBe(true);
        expect(Number.isFinite(point.y)).toBe(true);
        expect(Number.isFinite(point.z)).toBe(true);
      }
    }
  });

  it('produces a drawable ribbon even for a very short corridor', () => {
    const profile = straightClimb();
    const corridor = roadCorridor(profile, corridorOrigin(profile), 0, {
      aheadMetres: 1,
      behindMetres: 0,
    });

    expect(corridor.centre.length).toBeGreaterThanOrEqual(2);
    expect(corridor.quadCount).toBeGreaterThanOrEqual(1);
    for (const value of corridor.vertices) {
      expect(Number.isFinite(value)).toBe(true);
    }
  });
});

describe('the rebuild is bounded', () => {
  it('never exceeds the quad budget, however fine the profile’s grid', () => {
    // A 1 m grid over the same corridor is ten times the samples.
    const fine = straightClimb(1);
    const corridor = roadCorridor(fine, corridorOrigin(fine), 200);

    expect(corridor.quadCount).toBeLessThanOrEqual(MAXIMUM_CORRIDOR_QUADS);
    expect(corridor.vertices.length).toBe(corridor.centre.length * 6);
  });

  it('still spans the whole view distance when it strides', () => {
    const fine = straightClimb(1);
    const corridor = roadCorridor(fine, corridorOrigin(fine), 300, {
      aheadMetres: 400,
      behindMetres: 60,
    });

    const first = corridor.centre[0];
    const last = corridor.centre[corridor.centre.length - 1];
    // Striding must lose resolution, never reach.
    expect((last?.z ?? 0) - (first?.z ?? 0)).toBeGreaterThan(400);
  });

  it('does not stride at all when the grid is already coarse enough', () => {
    const profile = straightClimb(10);
    const corridor = roadCorridor(profile, corridorOrigin(profile), 200, {
      aheadMetres: 400,
      behindMetres: 60,
    });

    // 460 m at 10 m is 46 quads, comfortably inside the budget.
    expect(corridor.quadCount).toBe(46);
  });
});

describe('a loop', () => {
  it('carries the corridor across the wrap rather than stopping at it', () => {
    const profile = squareLoop();
    const total: number = profile.totalDistance;
    // Sitting 30 m from the end, looking 400 m ahead: most of the corridor is
    // past the wrap.
    const corridor = roadCorridor(profile, corridorOrigin(profile), total - 30, {
      aheadMetres: 400,
      behindMetres: 0,
    });

    const distances = corridor.centre.map((point) => point.distance);
    // Some points before the wrap, some after — and none outside the route.
    expect(distances.some((distance) => distance > total - 40)).toBe(true);
    expect(distances.some((distance) => distance < 100)).toBe(true);
    for (const distance of distances) {
      expect(distance).toBeGreaterThanOrEqual(0);
      expect(distance).toBeLessThanOrEqual(total + 1e-6);
    }
  });

  it('turns corners, so a square loop is not rendered as a straight line', () => {
    const profile = squareLoop();
    const corridor = roadCorridor(profile, corridorOrigin(profile), 0, {
      aheadMetres: 800,
      behindMetres: 0,
    });

    const xs = corridor.centre.map((point) => point.x);
    const zs = corridor.centre.map((point) => point.z);
    // Both axes have to move on a square loop; a projection bug that dropped one
    // would leave a perfectly straight road.
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(100);
    expect(Math.max(...zs) - Math.min(...zs)).toBeGreaterThan(100);
  });
});
