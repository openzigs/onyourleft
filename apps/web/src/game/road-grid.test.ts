// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * `road-grid.ts` §`distanceToDrawnRoad` — the point form of the whole-road
 * question, which `scatter.ts` asks of every item since #613.
 *
 * `corner-placement.test.ts` is where the corner it was written for is held;
 * this is the arithmetic on a road whose answer is known without it.
 */

import { describe, expect, it } from 'vitest';

import type { RouteProfile } from '@onyourleft/domain';

import {
  distanceToDrawnRoad,
  drawnRoadPoints,
  nearestOnRoadSegments,
  nearestOnWholeRoad,
  otherRoadWithin,
  roadSegmentsNear,
  squaredToSegment,
  type BesideTheRoad,
} from './road-grid';
import {
  circuitRoute,
  hairpinRoute,
  northRoute,
  plannerCornerRoute,
  sBendRoute,
} from './route-fixtures-testing';
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

describe('where beside the drawn road a point is — #1540', () => {
  const profile = northRoute(1_000, () => 0);
  const origin = corridorOrigin(profile);

  it('reads the route distance and the signed offset the road’s own frame gives', () => {
    for (const [along, lateral] of [
      [300, 12],
      [300, -40],
      [742.5, 150],
    ] as const) {
      const frame = drawnRoadFrame(profile, origin, along);
      if (frame === undefined) throw new Error('a straight road has a direction');
      const x = frame.x + frame.normalX * lateral;
      const z = frame.z + frame.normalZ * lateral;
      const segments: number[] = [];
      const road = roadSegmentsNear(profile, origin, x, z, 200, segments);
      expect(segments.length).toBeGreaterThan(0);
      const beside: BesideTheRoad = { along: 0, lateral: 0, distance: 0 };
      expect(nearestOnRoadSegments(road, segments, x, z, beside)).toBe(true);
      expect(beside.along).toBeCloseTo(along, 1);
      expect(beside.lateral).toBeCloseTo(lateral, 2);
      expect(beside.distance).toBeCloseTo(Math.abs(lateral), 2);
    }
  });

  it('finds nothing where no segment is near, and leaves its answer alone', () => {
    const segments: number[] = [];
    const road = roadSegmentsNear(profile, origin, 5_000, 5_000, 50, segments);
    expect(segments).toHaveLength(0);
    const beside: BesideTheRoad = { along: 7, lateral: 7, distance: 7 };
    expect(nearestOnRoadSegments(road, segments, 5_000, 5_000, beside)).toBe(false);
    expect(beside).toStrictEqual({ along: 7, lateral: 7, distance: 7 });
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

/**
 * Every sample `urban-class.ts`' sweep takes of `profile`: each road point at
 * its five-metre stride, out along the road's normal every five metres to
 * 250 m either side.
 */
function sweepSamples(profile: RouteProfile): { x: number; z: number; reach: number }[] {
  const road = drawnRoadPoints(profile, corridorOrigin(profile));
  const points = road.points;
  const count = points.length / 2;
  const stride = Math.max(1, Math.round(5 / road.step));
  const out: { x: number; z: number; reach: number }[] = [];
  for (let point = 0; point < count; point += stride) {
    const from = point + 1 < count ? point : point - 1;
    const dx = (points[from * 2 + 2] as number) - (points[from * 2] as number);
    const dz = (points[from * 2 + 3] as number) - (points[from * 2 + 1] as number);
    const length = Math.hypot(dx, dz);
    for (let step = -50; step <= 50; step += 1) {
      if (step === 0) continue;
      const lateral = step * 5;
      out.push({
        x: (points[point * 2] as number) + (-dz / length) * lateral,
        z: (points[point * 2 + 1] as number) + (dx / length) * lateral,
        reach: Math.abs(lateral) + 1,
      });
    }
  }
  return out;
}

describe('the whole road from its tree of boxes — #1696', () => {
  // The mirrored hairpin and the circuits are where the cells' scan order decides a tie: a loop's
  // closing segment and its first share a point, and a hairpin's legs are 200 m apart.
  it.each([
    ['a hairpin of radius 100 m, to the left', hairpinRoute(100, 'left')],
    ['a hairpin of radius 6 m', hairpinRoute(6)],
    ['a circuit of radius 100 m', circuitRoute(100)],
    ['an S-bend of radius 50 m', sBendRoute(50)],
    ['a 90° planner corner', plannerCornerRoute(90)],
  ])('answers every sweep sample of %s as the cells do, ties included', (_, profile) => {
    const origin = corridorOrigin(profile);
    const road = drawnRoadPoints(profile, origin);
    const segments: number[] = [];
    const cells: BesideTheRoad = { along: 0, lateral: 0, distance: 0 };
    const tree: BesideTheRoad = { along: 0, lateral: 0, distance: 0 };
    let differ = 0;
    for (const { x, z, reach } of sweepSamples(profile)) {
      const near = roadSegmentsNear(profile, origin, x, z, reach, segments);
      const fromCells = nearestOnRoadSegments(near, segments, x, z, cells);
      const fromTree = nearestOnWholeRoad(road, x, z, reach, tree);
      if (fromCells !== fromTree || (fromTree && cells.along !== tree.along)) differ += 1;
      else if (fromTree && (cells.lateral !== tree.lateral || cells.distance !== tree.distance)) {
        differ += 1;
      }
    }
    expect(differ).toBe(0);
  });

  it('finds nothing nearer than its reach, and leaves its answer alone', () => {
    const profile = northRoute(1_000, () => 0);
    const road = drawnRoadPoints(profile, corridorOrigin(profile));
    const beside: BesideTheRoad = { along: 7, lateral: 7, distance: 7 };
    expect(nearestOnWholeRoad(road, 5_000, 5_000, 50, beside)).toBe(false);
    expect(beside).toStrictEqual({ along: 7, lateral: 7, distance: 7 });
  });

  it.each([
    ['a hairpin of radius 6 m', hairpinRoute(6)],
    ['a circuit of radius 100 m', circuitRoute(100)],
    ['an S-bend of radius 50 m', sBendRoute(50)],
  ])(
    'says whether another stretch of %s comes within a disc, as every segment does',
    (_, profile) => {
      const road = drawnRoadPoints(profile, corridorOrigin(profile));
      const points = road.points;
      const segments = points.length / 2 - 1;
      let differ = 0;
      let within = 0;
      for (const [index, { x, z }] of sweepSamples(profile).entries()) {
        if (index % 7 !== 0) continue;
        const radius = 10 + (index % 240);
        const along = ((index * 13) % segments) * road.step + (index % 5) * 0.7;
        const tolerance = 2 + (index % 9);
        let brute = false;
        for (let segment = 0; segment < segments && !brute; segment += 1) {
          // Its own stretch: both ends strictly within the tolerance.
          if (
            segment * road.step > along - tolerance &&
            (segment + 1) * road.step < along + tolerance
          ) {
            continue;
          }
          const ax = points[segment * 2] as number;
          const az = points[segment * 2 + 1] as number;
          const dx = (points[segment * 2 + 2] as number) - ax;
          const dz = (points[segment * 2 + 3] as number) - az;
          brute = squaredToSegment(x, z, ax, az, dx, dz, dx * dx + dz * dz) < radius * radius;
        }
        if (brute) within += 1;
        if (otherRoadWithin(road, x, z, radius, along, tolerance) !== brute) differ += 1;
      }
      expect(differ).toBe(0);
      // Both answers are asked: the fixture is not all one or the other.
      expect(within).toBeGreaterThan(0);
    },
  );

  it('is clear beside a straight road but for its own stretch, which the disc touches', () => {
    const profile = northRoute(2_000, () => 0);
    const road = drawnRoadPoints(profile, corridorOrigin(profile));
    const frame = drawnRoadFrame(profile, corridorOrigin(profile), 1_000);
    if (frame === undefined) throw new Error('a straight road has a direction');
    const x = frame.x + frame.normalX * 250;
    const z = frame.z + frame.normalZ * 250;
    expect(otherRoadWithin(road, x, z, 250.001, 1_000, 6)).toBe(false);
    // With no stretch its own, the road at the disc's edge is inside its millimetre of slack.
    expect(otherRoadWithin(road, x, z, 250.001, 1_000, 0)).toBe(true);
  });

  it('counts a segment ending exactly at the tolerance as another stretch', () => {
    const profile = northRoute(2_000, () => 0);
    const road = drawnRoadPoints(profile, corridorOrigin(profile));
    // Half a metre beside the segment from 994 m to 996 m, and nearer no other.
    const frame = drawnRoadFrame(profile, corridorOrigin(profile), 995);
    if (frame === undefined) throw new Error('a straight road has a direction');
    const x = frame.x + frame.normalX * 0.5;
    const z = frame.z + frame.normalZ * 0.5;
    // 994 m is exactly 6 m from 1 000 m: not strictly within, so not its own.
    expect(otherRoadWithin(road, x, z, 0.6, 1_000, 6)).toBe(true);
    expect(otherRoadWithin(road, x, z, 0.6, 1_000, 6.5)).toBe(false);
  });
});
