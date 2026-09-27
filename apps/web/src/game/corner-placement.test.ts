// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What stands beside a SHARP corner stands beside the road that is drawn there
 * — #571.
 *
 * Since #543 the road is drawn as the route's centreline averaged over
 * `terrain.ts` §`BEND_SMOOTHING_METRES` either side, so at a corner a planner
 * exported in one sample the ribbon runs `5·sin(θ/2)` metres inside the
 * route's vertex: 3.5 m at 90°. Every other placement test here uses a straight
 * route, where the drawn road and the route are the same line and a part
 * placed from the wrong one stands in the right place anyway — which is how,
 * at a 90° corner, a conifer placed beside the ROUTE stood 0.18 m from the
 * centre of the road a rider sees and the end of a hedge 0.3 m into it, and
 * nothing said so.
 *
 * ⚠️ **The distance is measured to the RIBBON** — `roadCorridor(...).centre`,
 * the polyline the road's own vertices are built on — and never to the route,
 * because measuring to the route is the mistake this file exists to catch.
 *
 * ⚠️ **Up to 150° since #613, and 110° was a measured limit until then.**
 * Against the placement before #571 the nearest item at a 90° corner was
 * 0.18 m from the drawn centreline, at 110° 1.87 m and at 120° 0.27 m. #571
 * cleared everything up to 110°, but beyond it a scatter item still stood in
 * the road — 2.73 m from the centreline at 120°, 0.14 m at 135° and 150° —
 * because `scatter.ts` guarded the inside of a bend only through `bandsAt`'s
 * 30 m curvature window, which reads a corner that sharp as a wider bend than
 * the one drawn, and a band folded across the other leg. #613 gave scatter the
 * whole-road check structures already had (`road-grid.ts`
 * §`distanceToDrawnRoad`), and its block at the end of this file holds every
 * scatter item the full verge off the drawn road, not only off the carriageway.
 */

import { describe, expect, it } from 'vitest';

import { positionAt, type RouteProfile } from '@onyourleft/domain';

import { plannerCornerRoute } from './route-fixtures-testing';
import { SCATTER_VERGE_METRES, scatterAt, scatterSeed, type ScatterItem } from './scatter';
import { BOUNDARY_PIECE_METRES, FIELD_EDGE_LATERAL_METRES, structuresAt } from './settlements';
import {
  ROAD_WIDTH_METRES,
  corridorOrigin,
  localGroundPosition,
  roadCorridor,
  type CorridorPoint,
} from './terrain';

/** Where {@link plannerCornerRoute} turns, in route metres. */
const CORNER_METRES = 1_500;

/** How far either side of the corner, in route metres, is asked about. */
const REACH_METRES = 120;

/** How close to the corner's vertex, in metres, an item has to be to count. */
const NEAR_CORNER_METRES = 40;

/** Half the carriageway: what "in the road" means. */
const HALF_CARRIAGEWAY = ROAD_WIDTH_METRES / 2;

/**
 * How far inside the verge a scatter item may be measured, in metres: the
 * chord a two-metre sample cuts off a ~10 m radius (4 cm), rounded up.
 */
const VERGE_TOLERANCE_METRES = 0.05;

const BOUNDARIES = new Set(['wall', 'hedge', 'fence']);

interface Point {
  readonly x: number;
  readonly z: number;
}

function segmentDistance(point: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const lengthSquared = dx * dx + dz * dz;
  const t =
    lengthSquared > 0
      ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.z - a.z) * dz) / lengthSquared))
      : 0;
  return Math.hypot(point.x - (a.x + dx * t), point.z - (a.z + dz * t));
}

/** The nearest the drawn road's centreline comes to a point, in metres. */
function toRibbon(centre: readonly CorridorPoint[], point: Point): number {
  let best = Number.POSITIVE_INFINITY;
  for (let index = 0; index + 1 < centre.length; index += 1) {
    best = Math.min(
      best,
      segmentDistance(point, centre[index] as CorridorPoint, centre[index + 1] as CorridorPoint),
    );
  }
  return best;
}

/**
 * The points of an item that must stay out of the road: its own for a tree or
 * a post, and for a wall, hedge or fence every metre of the eight-metre piece
 * `three-renderer.ts` §`BOUNDARY_STYLE` draws along its own `z` — a piece whose
 * middle is clear can still put an end in the road.
 */
function footprint(item: ScatterItem): readonly Point[] {
  if (!BOUNDARIES.has(item.kind)) {
    return [{ x: item.x, z: item.z }];
  }
  const alongX = Math.sin(item.rotation);
  const alongZ = Math.cos(item.rotation);
  const points: Point[] = [];
  for (let step = -4; step <= 4; step += 1) {
    const offset = (step / 8) * BOUNDARY_PIECE_METRES;
    points.push({ x: item.x + alongX * offset, z: item.z + alongZ * offset });
  }
  return points;
}

interface Measured {
  /** How many items stood within {@link NEAR_CORNER_METRES} of the vertex. */
  readonly near: number;
  readonly nearBoundaries: number;
  /** The closest any of them came to the ribbon's centreline. */
  readonly closest: number;
  readonly closestBoundary: number;
  /**
   * How far from the ribbon's centreline the MIDDLE of each roadside piece of
   * wall, hedge or fence stands — every boundary piece within two metres of
   * {@link FIELD_EDGE_LATERAL_METRES}, which the pieces running out from the
   * road (8 m on) never are.
   */
  readonly roadside: readonly number[];
}

function measure(profile: RouteProfile): Measured {
  const origin = corridorOrigin(profile);
  const seed = scatterSeed(profile);
  const from = CORNER_METRES - REACH_METRES;
  const to = CORNER_METRES + REACH_METRES;
  // The ribbon exactly as the renderer is handed it, with the rider just
  // before the corner so the dense two-metre stretch spans all of it.
  const corridor = roadCorridor(profile, origin, CORNER_METRES, {
    behindMetres: REACH_METRES + 20,
    aheadMetres: REACH_METRES + 20,
  });
  const vertex = localGroundPosition(origin, positionAt(profile, CORNER_METRES));
  const budget = { maxItems: 1_000_000, riderMetres: CORNER_METRES };
  const items = [
    ...scatterAt(profile, origin, seed, from, to, budget),
    ...structuresAt(profile, origin, seed, from, to, budget),
  ].filter((item) => Math.hypot(item.x - vertex.x, item.z - vertex.z) < NEAR_CORNER_METRES);

  let closest = Number.POSITIVE_INFINITY;
  let closestBoundary = Number.POSITIVE_INFINITY;
  const roadside: number[] = [];
  for (const item of items) {
    const middle = toRibbon(corridor.centre, item);
    if (BOUNDARIES.has(item.kind) && Math.abs(middle - FIELD_EDGE_LATERAL_METRES) < 2) {
      roadside.push(middle);
    }
    const distance = Math.min(...footprint(item).map((point) => toRibbon(corridor.centre, point)));
    closest = Math.min(closest, distance);
    if (BOUNDARIES.has(item.kind)) closestBoundary = Math.min(closestBoundary, distance);
  }
  return {
    near: items.length,
    nearBoundaries: items.filter((item) => BOUNDARIES.has(item.kind)).length,
    closest,
    closestBoundary,
    roadside,
  };
}

/**
 * The nearest any SCATTER item — a tree, a shrub, a rock or a post, nothing
 * `settlements.ts` stands — comes to the drawn road's centreline near the
 * corner, and how many there are.
 */
function scatterNearCorner(profile: RouteProfile): {
  readonly near: number;
  readonly closest: number;
} {
  const origin = corridorOrigin(profile);
  const corridor = roadCorridor(profile, origin, CORNER_METRES, {
    behindMetres: REACH_METRES + 20,
    aheadMetres: REACH_METRES + 20,
  });
  const vertex = localGroundPosition(origin, positionAt(profile, CORNER_METRES));
  const items = scatterAt(
    profile,
    origin,
    scatterSeed(profile),
    CORNER_METRES - REACH_METRES,
    CORNER_METRES + REACH_METRES,
    { maxItems: 1_000_000, riderMetres: CORNER_METRES },
  ).filter((item) => Math.hypot(item.x - vertex.x, item.z - vertex.z) < NEAR_CORNER_METRES);
  return {
    near: items.length,
    closest: Math.min(...items.map((item) => toRibbon(corridor.centre, item))),
  };
}

describe('scenery and field boundaries at a sharp corner — #571', () => {
  const corners = [
    [45, 'right'],
    [45, 'left'],
    [90, 'right'],
    [90, 'left'],
    [110, 'right'],
    [110, 'left'],
  ] as const;

  it('is a fixture on which the drawn road and the route are different lines', () => {
    const profile = plannerCornerRoute(90);
    const origin = corridorOrigin(profile);
    const corridor = roadCorridor(profile, origin, CORNER_METRES, {
      behindMetres: REACH_METRES + 20,
      aheadMetres: REACH_METRES + 20,
    });
    // ⚠️ Without this every case below could pass on a fixture whose ribbon
    // ran along the route, which is the straight-road blindness #571 names.
    // The ribbon passes 2.25 m inside the route at the corner rather than
    // #543's 3.5 m, measured: the profile's own 10 m grid already takes a
    // little off a vertex sampled at 25 m.
    let apart = 0;
    for (let at = CORNER_METRES - 20; at <= CORNER_METRES + 20; at += 1) {
      apart = Math.max(
        apart,
        toRibbon(corridor.centre, localGroundPosition(origin, positionAt(profile, at))),
      );
    }
    expect(apart).toBeGreaterThan(2);
  });

  for (const [degrees, hand] of corners) {
    it(`keeps everything out of the drawn carriageway at a ${degrees}° ${hand}-hand corner`, () => {
      const measured = measure(plannerCornerRoute(degrees, hand));
      // Not vacuous: the corner is planted and enclosed on this fixture.
      expect(measured.near).toBeGreaterThan(5);
      expect(measured.nearBoundaries).toBeGreaterThan(0);
      expect(measured.closest).toBeGreaterThan(HALF_CARRIAGEWAY);
      expect(measured.closestBoundary).toBeGreaterThan(HALF_CARRIAGEWAY);
    });

    it(`runs the roadside boundary its own distance from the drawn road at a ${degrees}° ${hand}-hand corner`, () => {
      // ⚠️ **The half that says the boundary FOLLOWS the drawn road**, rather
      // than being dropped where it would have stood in it: `structuresAt`
      // also refuses any structure within `ROAD_CLEARANCE_METRES` of the
      // drawn road, so the carriageway case above stays green if the frame
      // goes back to the route — the offending pieces are removed, not moved.
      const { roadside } = measure(plannerCornerRoute(degrees, hand));
      expect(roadside.length).toBeGreaterThan(3);
      for (const distance of roadside) {
        expect(distance).toBeCloseTo(FIELD_EDGE_LATERAL_METRES, 1);
      }
    });
  }
});

describe('scenery at a corner sharper than 110° — #613', () => {
  // ⚠️ **The corners #571 could not hold.** Before #613 a band folded across
  // the other leg here — 2.73 m from the drawn centreline at 120° right-hand,
  // 0.14 m at 135° and 0.45 m at 150° — because `scatter.ts` §`bandsAt` reads
  // a corner drawn over 20 m through a 30 m curvature window, as a wider bend
  // than the one a rider sees.
  const corners = [
    [120, 'right'],
    [120, 'left'],
    [135, 'right'],
    [135, 'left'],
    [150, 'right'],
    [150, 'left'],
  ] as const;

  for (const [degrees, hand] of corners) {
    it(`keeps everything out of the drawn carriageway at a ${degrees}° ${hand}-hand corner`, () => {
      const measured = measure(plannerCornerRoute(degrees, hand));
      // Not vacuous: the corner still carries scenery after the refusal.
      expect(measured.near).toBeGreaterThan(5);
      expect(measured.closest).toBeGreaterThan(HALF_CARRIAGEWAY);
      expect(measured.closestBoundary).toBeGreaterThan(HALF_CARRIAGEWAY);
    });

    it(`holds every scatter item the full verge off the drawn road at a ${degrees}° ${hand}-hand corner`, () => {
      // ⚠️ **The verge, not only the carriageway** — the clearance a straight
      // road gives (`scatter.ts` §`SCATTER_VERGE_METRES`), which is what the
      // whole-road check promises. Less a centimetre: the check measures to
      // the drawn road in two-metre chords, and a chord lies up to 4 cm inside
      // the arc it cuts at the ~10 m radius these corners are drawn at.
      const { near, closest } = scatterNearCorner(plannerCornerRoute(degrees, hand));
      expect(near).toBeGreaterThan(5);
      expect(closest).toBeGreaterThan(
        HALF_CARRIAGEWAY + SCATTER_VERGE_METRES - VERGE_TOLERANCE_METRES,
      );
    });
  }
});
