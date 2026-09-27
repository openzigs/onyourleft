// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The WHOLE drawn road as segments in a grid of cells — what a placer asks
 * "how close is this to ANY stretch of the road?" of.
 *
 * It lived in `settlements.ts` from #468 to #613, where only the structures
 * asked it. #613 is the scenery asking too: at a corner a planner exported in
 * one sample and sharper than about 110°, `scatter.ts` §`bandsAt` reads the
 * corner through a 30 m curvature window as a wider bend than the ~10 m radius
 * `terrain.ts` §`BEND_SMOOTHING_METRES` draws it at, so a band folded across
 * the other leg and stood a post 0.14 m from the drawn centreline. It is its
 * own module because `settlements.ts` imports `scatter.ts`, and the grid could
 * not be imported the other way round.
 *
 * Pure, cached per route, and names no rendering library.
 */

import type { RouteProfile } from '@onyourleft/domain';

import { CORRIDOR_STEP_METRES, drawnRoadPosition, type CorridorOrigin } from './terrain';

/**
 * The most points {@link roadGrid} samples the drawn road at: **200 000** — a
 * 400 km route at two metres, 3.2 MB of doubles, built once a route.
 */
const ROAD_GRID_MAXIMUM_POINTS = 200_000;

/** The side of one cell of {@link roadGrid}, in metres. */
const ROAD_CELL_METRES = 32;

/** The whole route's centreline in local metres, bucketed by cell. */
interface RoadGrid {
  readonly origin: CorridorOrigin;
  /** Two floats a point: the drawn road every two metres, in plan. */
  readonly points: Float64Array;
  /** Segment `s` runs from point `s` to point `s + 1`. */
  readonly cells: ReadonlyMap<number, readonly number[]>;
}

const roadGrids = new WeakMap<RouteProfile, RoadGrid>();

/** The key of one cell of {@link roadGrid}, by its column and row. */
function roadCellKey(column: number, row: number): number {
  return column * 100_003 + row;
}

/**
 * The whole route as segments in a grid of cells, built once a route.
 *
 * ⚠️ **The WHOLE route and not the frame's corridor**, which is the point of
 * #468's review finding B1: a field's boundary runs `settlements.ts` §`FIELD_DEPTH_METRES`
 * straight out from the road, and on a hairpin that reaches the other leg — a
 * stretch of road that may be hundreds of metres of route away and outside any
 * window a frame would think to look in. `scatter.ts` fixed its own form of
 * this in #348, and `landform.ts` §`clearReach` its own in #458; each placer
 * that stands things along the road's normal has shipped without the check at
 * first — and `scatter.ts` itself shipped without it at corners sharper
 * than about 110° until #613, because `bandsAt` could not read them.
 *
 * ⚠️ **The DRAWN centreline, sampled every `terrain.ts`
 * §`CORRIDOR_STEP_METRES` — #571.** It was the route's own points until then,
 * on the reasoning that `terrain.ts` §`pointAt` interpolated the road between
 * them; since #543 it averages them, and at a planner's 90° corner the road a
 * rider sees runs 3.5 m inside the route's vertex, which is most of
 * `landform.ts` §`ROAD_CLEARANCE_METRES`. Two metres rather than the route's own grid
 * because a chord lies inside the arc it cuts: at the ~13 m radius a 90°
 * corner is drawn at, a 10 m chord is a metre inside the drawn road there and
 * a 2 m one four centimetres.
 */
function roadGrid(profile: RouteProfile, origin: CorridorOrigin): RoadGrid {
  const cached = roadGrids.get(profile);
  if (
    cached !== undefined &&
    cached.origin.latitude === origin.latitude &&
    cached.origin.longitude === origin.longitude
  ) {
    return cached;
  }
  // Every CORRIDOR_STEP_METRES of the route, and never more than
  // ROAD_GRID_MAXIMUM_POINTS of them: a route is an imported file, and the
  // step widens on one long enough to reach the bound rather than the table
  // growing without one.
  //
  // ⚠️ On a loop the last sample is `totalDistance`, which `drawnRoadPosition`
  // wraps onto the start — so the closing stretch is a segment here, as it is
  // on the screen (#440 made a loop's closing gap part of the lap).
  const total: number = profile.totalDistance;
  const step = Math.max(CORRIDOR_STEP_METRES, total / (ROAD_GRID_MAXIMUM_POINTS - 1));
  // The last point is `total` itself, however short the last step.
  const count = Math.ceil(total / step - 1e-9) + 1;
  const points = new Float64Array(count * 2);
  for (let index = 0; index < count; index += 1) {
    const local = drawnRoadPosition(profile, origin, Math.min(total, index * step));
    points[index * 2] = local.x;
    points[index * 2 + 1] = local.z;
  }
  const cells = new Map<number, number[]>();
  const cellOf = (value: number): number => Math.floor(value / ROAD_CELL_METRES);
  for (let segment = 0; segment + 1 < count; segment += 1) {
    const ax = points[segment * 2] as number;
    const az = points[segment * 2 + 1] as number;
    const bx = points[segment * 2 + 2] as number;
    const bz = points[segment * 2 + 3] as number;
    for (let column = cellOf(Math.min(ax, bx)); column <= cellOf(Math.max(ax, bx)); column += 1) {
      for (let row = cellOf(Math.min(az, bz)); row <= cellOf(Math.max(az, bz)); row += 1) {
        const key = roadCellKey(column, row);
        const list = cells.get(key);
        if (list === undefined) cells.set(key, [segment]);
        else list.push(segment);
      }
    }
  }
  const grid = { origin, points, cells };
  roadGrids.set(profile, grid);
  return grid;
}

/** A cell with no road in it. Shared, so a miss allocates nothing. */
const NO_SEGMENTS: readonly number[] = [];

/**
 * A measure of one segment of the drawn road, from `(ax, az)` to `(bx, bz)`,
 * as a SQUARED distance — what {@link leastSquaredNearRoad} takes the least of.
 *
 * ⚠️ **A module-level function handed its query, never a closure** (#469): the
 * search runs for every scatter item and every structure in view, every frame,
 * on the thread GATT notifications arrive on, so a caller keeps one query
 * object and rewrites it rather than building a function per call.
 */
export type SegmentMeasure<Query> = (
  ax: number,
  az: number,
  bx: number,
  bz: number,
  query: Query,
) => number;

/**
 * The least of `measure` over every stretch of the drawn road that may lie
 * within `reach` of `(x, z)` — the ONE cell search, which
 * {@link distanceToDrawnRoad} and `settlements.ts` §`structureClearance` both
 * ask. They were two copies of it from #613 until #602's fold-in of that
 * review, and had already drifted: #613's squared distances went into one.
 *
 * Squared, because a caller takes one root at the end rather than one a
 * segment: `Math.hypot` per segment doubled the time `three-renderer.test.ts`'s
 * cull sweep takes, measured in CI. `+Infinity` when no segment is in reach.
 *
 * A segment in two of the cells searched is measured twice, which costs a few
 * multiplications and no allocation.
 */
export function leastSquaredNearRoad<Query>(
  profile: RouteProfile,
  origin: CorridorOrigin,
  x: number,
  z: number,
  reach: number,
  measure: SegmentMeasure<Query>,
  query: Query,
): number {
  const road = roadGrid(profile, origin);
  const points = road.points;
  const lastColumn = Math.floor((x + reach) / ROAD_CELL_METRES);
  const lastRow = Math.floor((z + reach) / ROAD_CELL_METRES);
  const firstRow = Math.floor((z - reach) / ROAD_CELL_METRES);
  let least = Number.POSITIVE_INFINITY;
  for (let column = Math.floor((x - reach) / ROAD_CELL_METRES); column <= lastColumn; column += 1) {
    for (let row = firstRow; row <= lastRow; row += 1) {
      for (const segment of road.cells.get(roadCellKey(column, row)) ?? NO_SEGMENTS) {
        least = Math.min(
          least,
          measure(
            points[segment * 2] as number,
            points[segment * 2 + 1] as number,
            points[segment * 2 + 2] as number,
            points[segment * 2 + 3] as number,
            query,
          ),
        );
      }
    }
  }
  return least;
}

/**
 * The squared distance from `(x, z)` to the segment from `(ax, az)` along
 * `(dx, dz)`, whose squared length is `span`.
 *
 * ⚠️ **A zero-length segment is its one point**, and the guard that says so is
 * not decoration: without it `0 / 0` is `NaN`, `Math.min(least, NaN)` is `NaN`
 * for the rest of a search, and a clearance compared against `NaN` is false —
 * a check that switches itself off with no signal (#613's review).
 */
export function squaredToSegment(
  x: number,
  z: number,
  ax: number,
  az: number,
  dx: number,
  dz: number,
  span: number,
): number {
  const t = span > 0 ? Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / span)) : 0;
  const ox = x - (ax + dx * t);
  const oz = z - (az + dz * t);
  return ox * ox + oz * oz;
}

/** The point {@link distanceToDrawnRoad} measures from, reused between calls. */
const pointQuery = { x: 0, z: 0 };

/** {@link SegmentMeasure} from {@link pointQuery}'s point. */
function pointToSegmentSquared(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  query: typeof pointQuery,
): number {
  const dx = bx - ax;
  const dz = bz - az;
  return squaredToSegment(query.x, query.z, ax, az, dx, dz, dx * dx + dz * dz);
}

/**
 * How close the point `(x, z)` comes to the centreline of ANY stretch of the
 * drawn road, in metres — exact wherever the answer is within `reach`, and
 * otherwise `+Infinity` or an upper bound, because the grid is only searched
 * that far. `settlements.ts` §`structureClearance` is the same question asked
 * of a footprint rather than a point.
 *
 * ⚠️ **To two-metre chords of the drawn road, not the road itself.** A chord
 * lies inside the arc it cuts, so a point on the INSIDE of a bend reads a
 * little nearer than it is: 4 cm at the ~10 m radius a sharp corner is drawn
 * at, and nothing measurable on a bend a rider takes at speed.
 */
export function distanceToDrawnRoad(
  profile: RouteProfile,
  origin: CorridorOrigin,
  x: number,
  z: number,
  reach: number,
): number {
  pointQuery.x = x;
  pointQuery.z = z;
  return Math.sqrt(
    leastSquaredNearRoad(profile, origin, x, z, reach, pointToSegmentSquared, pointQuery),
  );
}
