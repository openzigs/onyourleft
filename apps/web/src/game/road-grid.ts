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
  /**
   * How far apart the points are along the route, in metres: two, or more on a
   * very long one. Point `s` is `s` times this along, up to the route's length.
   */
  readonly step: number;
  /** Segment `s` runs from point `s` to point `s + 1`. */
  readonly cells: ReadonlyMap<number, readonly number[]>;
  /** The route's length, which the last point is at. */
  readonly total: number;
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
  const grid = { origin, points, cells, step, total };
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
 * within `reach` of `query`'s own `(x, z)` — the ONE cell search, which
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
 *
 * ⚠️ **The point is read from `query`, and only from there** (#602's review).
 * It used to be passed twice — as `x, z` to choose the cells and inside
 * `query` for `measure` — and a caller that set one and not the other would
 * search the right cells and measure from the wrong point, with every test
 * green unless its fixture happened to separate the two. One source cannot
 * disagree with itself, and it costs no closure and no allocation (#469).
 */
export function leastSquaredNearRoad<Query extends { readonly x: number; readonly z: number }>(
  profile: RouteProfile,
  origin: CorridorOrigin,
  reach: number,
  measure: SegmentMeasure<Query>,
  query: Query,
): number {
  const road = roadGrid(profile, origin);
  const points = road.points;
  const x = query.x;
  const z = query.z;
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

/** Where on the drawn road a point is nearest, and how far off it — #1565. */
export interface NearestOnRoad {
  /** How far from the drawn centreline, in metres. */
  readonly distance: number;
  /** The route distance of the nearest point, on the first lap. */
  readonly along: number;
  /** Signed: positive on the road's normal side, its RIGHT (`terrain.ts` §`drawnRoadFrame`). */
  readonly lateral: number;
}

/**
 * Where on ANY stretch of the drawn road `(x, z)` is nearest, if within
 * `reach` — #1565: what a cross street's junction is placed at, and what the
 * ground under its side road is read from (`landform.ts` §`terrainHeightAt`
 * takes a route distance and a signed lateral). {@link distanceToDrawnRoad}
 * asks the same cells for the distance alone; this one keeps which segment it
 * was, so it allocates one answer.
 */
export function nearestOnDrawnRoad(
  profile: RouteProfile,
  origin: CorridorOrigin,
  x: number,
  z: number,
  reach: number,
): NearestOnRoad | undefined {
  const road = roadGrid(profile, origin);
  const points = road.points;
  let least = reach * reach;
  let best = -1;
  let bestT = 0;
  const lastColumn = Math.floor((x + reach) / ROAD_CELL_METRES);
  const lastRow = Math.floor((z + reach) / ROAD_CELL_METRES);
  const firstRow = Math.floor((z - reach) / ROAD_CELL_METRES);
  for (let column = Math.floor((x - reach) / ROAD_CELL_METRES); column <= lastColumn; column += 1) {
    for (let row = firstRow; row <= lastRow; row += 1) {
      for (const segment of road.cells.get(roadCellKey(column, row)) ?? NO_SEGMENTS) {
        const ax = points[segment * 2] as number;
        const az = points[segment * 2 + 1] as number;
        const dx = (points[segment * 2 + 2] as number) - ax;
        const dz = (points[segment * 2 + 3] as number) - az;
        const span = dx * dx + dz * dz;
        const squared = squaredToSegment(x, z, ax, az, dx, dz, span);
        if (squared < least || (squared === least && best < 0)) {
          least = squared;
          best = segment;
          bestT = span > 0 ? Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / span)) : 0;
        }
      }
    }
  }
  if (best < 0) return undefined;
  const ax = points[best * 2] as number;
  const az = points[best * 2 + 1] as number;
  const dx = (points[best * 2 + 2] as number) - ax;
  const dz = (points[best * 2 + 3] as number) - az;
  const length = Math.hypot(dx, dz);
  const distance = Math.sqrt(least);
  // The normal is the forward direction turned a quarter: (−dz, dx), the rider's right.
  const across = length > 0 ? ((x - ax) * -dz + (z - az) * dx) / length : 0;
  return {
    distance,
    along: Math.min(profile.totalDistance, (best + bestT) * road.step),
    lateral: across >= 0 ? distance : -distance,
  };
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
  return Math.sqrt(leastSquaredNearRoad(profile, origin, reach, pointToSegmentSquared, pointQuery));
}

/**
 * The drawn road as {@link roadSegmentsNear} hands it out: its points, and how far apart they are.
 */
export interface DrawnRoadPoints {
  /** Two floats a point; segment `s` runs from point `s` to point `s + 1`. */
  readonly points: Float64Array;
  /** How far along the route point `s` is: `s` times this, up to {@link total}. */
  readonly step: number;
  readonly total: number;
}

/**
 * The whole drawn road, every two metres — #1633: `urban-class.ts` sweeps the
 * corridor across it, window by window. The same cached grid
 * {@link roadSegmentsNear} hands out.
 */
export function drawnRoadPoints(profile: RouteProfile, origin: CorridorOrigin): DrawnRoadPoints {
  return roadGrid(profile, origin);
}

/**
 * Every segment of the drawn road that may lie within `reach` of `(x, z)`,
 * written into `into` (cleared first; a segment in two cells is there twice),
 * and the road they index — #1540: a mapped footprint asks once, for its
 * centroid, and then measures each of its vertices against this short list
 * rather than searching the grid again for each.
 */
export function roadSegmentsNear(
  profile: RouteProfile,
  origin: CorridorOrigin,
  x: number,
  z: number,
  reach: number,
  into: number[],
): DrawnRoadPoints {
  const road = roadGrid(profile, origin);
  into.length = 0;
  const lastColumn = Math.floor((x + reach) / ROAD_CELL_METRES);
  const lastRow = Math.floor((z + reach) / ROAD_CELL_METRES);
  const firstRow = Math.floor((z - reach) / ROAD_CELL_METRES);
  for (let column = Math.floor((x - reach) / ROAD_CELL_METRES); column <= lastColumn; column += 1) {
    for (let row = firstRow; row <= lastRow; row += 1) {
      for (const segment of road.cells.get(roadCellKey(column, row)) ?? NO_SEGMENTS) {
        into.push(segment);
      }
    }
  }
  return road;
}

/**
 * Where on the drawn road a point is beside — #1540. @see nearestOnRoadSegments
 */
export interface BesideTheRoad {
  /** The route distance of the nearest point of the drawn road. */
  along: number;
  /** How far out from it, positive on its normal's side — the right, as `terrain.ts`'s. */
  lateral: number;
  /** How far from it: `|lateral|`, but for a point past either end of the road. */
  distance: number;
}

/**
 * The nearest point to `(x, z)` on the segments {@link roadSegmentsNear}
 * found, written into `into` — `false`, and `into` untouched, when there are
 * none. The route distance and the side are the ones `landform.ts`
 * §`terrainHeightAt` reads the ground at, so a thing placed from them stands
 * on the ground beside the stretch of road it is nearest.
 */
export function nearestOnRoadSegments(
  road: DrawnRoadPoints,
  segments: readonly number[],
  x: number,
  z: number,
  into: BesideTheRoad,
): boolean {
  const points = road.points;
  let best = Number.POSITIVE_INFINITY;
  for (const segment of segments) {
    const ax = points[segment * 2] as number;
    const az = points[segment * 2 + 1] as number;
    const dx = (points[segment * 2 + 2] as number) - ax;
    const dz = (points[segment * 2 + 3] as number) - az;
    const span = dx * dx + dz * dz;
    const t = span > 0 ? Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / span)) : 0;
    const ox = x - (ax + dx * t);
    const oz = z - (az + dz * t);
    const squared = ox * ox + oz * oz;
    if (squared >= best) continue;
    best = squared;
    const length = Math.sqrt(span);
    into.along = Math.min(road.total, (segment + t) * road.step);
    into.distance = Math.sqrt(squared);
    // The segment's normal is `(-dz, dx)` of its heading: `terrain.ts`'s.
    into.lateral = length > 0 ? (oz * dx - ox * dz) / length : into.distance;
  }
  return best < Number.POSITIVE_INFINITY;
}

/** The segments in one leaf of {@link RoadHierarchy}: **8**, 16 m of road at the two-metre step. */
const HIERARCHY_LEAF_SEGMENTS = 8;

/**
 * The drawn road's segments as a tree of boxes over runs of consecutive
 * segments — #1696. A run of road is a thin box, so a point beside a straight
 * stretch rules out all but the few runs next to its nearest point, where
 * {@link roadSegmentsNear}'s cells hand it every segment in a square as wide
 * as the reach.
 *
 * Node `n`'s children are `2n + 1` and `2n + 2`; it covers segments
 * `[first[n], last[n])`, inside the box `boxes[4n .. 4n + 3]` (minX, minZ, maxX, maxZ).
 */
interface RoadHierarchy {
  readonly boxes: Float64Array;
  readonly first: Int32Array;
  readonly last: Int32Array;
  /** How many nodes the tree has; a node at or past this has no children. */
  readonly nodes: number;
  /** The search's own stack of nodes, reused between calls: deep enough for the tree. */
  readonly stack: Int32Array;
}

const roadHierarchies = new WeakMap<DrawnRoadPoints, RoadHierarchy>();

/** {@link RoadHierarchy} of `road`, built once a road. */
function roadHierarchy(road: DrawnRoadPoints): RoadHierarchy {
  const cached = roadHierarchies.get(road);
  if (cached !== undefined) return cached;
  const points = road.points;
  const segments = Math.max(0, points.length / 2 - 1);
  // A complete tree deep enough that every leaf holds at most HIERARCHY_LEAF_SEGMENTS.
  let depth = 0;
  while (segments > HIERARCHY_LEAF_SEGMENTS * 2 ** depth) depth += 1;
  const nodes = 2 ** (depth + 1) - 1;
  const boxes = new Float64Array(nodes * 4);
  const first = new Int32Array(nodes);
  const last = new Int32Array(nodes);
  const leaves = 2 ** depth;
  const firstLeaf = leaves - 1;
  for (let leaf = 0; leaf < leaves; leaf += 1) {
    const node = firstLeaf + leaf;
    const from = Math.min(segments, Math.floor((leaf * segments) / leaves));
    const to = Math.min(segments, Math.floor(((leaf + 1) * segments) / leaves));
    first[node] = from;
    last[node] = to;
    let minX = Number.POSITIVE_INFINITY;
    let minZ = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxZ = Number.NEGATIVE_INFINITY;
    // A segment's box is its two points' box: every point from `from` to `to` inclusive.
    for (let point = from; point < to + 1 && from < to; point += 1) {
      const x = points[point * 2] as number;
      const z = points[point * 2 + 1] as number;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minZ = Math.min(minZ, z);
      maxZ = Math.max(maxZ, z);
    }
    boxes[node * 4] = minX;
    boxes[node * 4 + 1] = minZ;
    boxes[node * 4 + 2] = maxX;
    boxes[node * 4 + 3] = maxZ;
  }
  for (let node = firstLeaf - 1; node >= 0; node -= 1) {
    const left = node * 2 + 1;
    const right = node * 2 + 2;
    first[node] = first[left] as number;
    last[node] = last[right] as number;
    boxes[node * 4] = Math.min(boxes[left * 4] as number, boxes[right * 4] as number);
    boxes[node * 4 + 1] = Math.min(boxes[left * 4 + 1] as number, boxes[right * 4 + 1] as number);
    boxes[node * 4 + 2] = Math.max(boxes[left * 4 + 2] as number, boxes[right * 4 + 2] as number);
    boxes[node * 4 + 3] = Math.max(boxes[left * 4 + 3] as number, boxes[right * 4 + 3] as number);
  }
  // A depth-first search holds at most one sibling a level, and the node it is in.
  const hierarchy = { boxes, first, last, nodes, stack: new Int32Array(depth + 2) };
  roadHierarchies.set(road, hierarchy);
  return hierarchy;
}

/**
 * Where on the WHOLE drawn road `(x, z)` is nearest, if nearer than `reach`,
 * written into `into` — `false`, and `into` untouched, when nothing is — #1696.
 * The same answer as {@link roadSegmentsNear} with `reach` and then
 * {@link nearestOnRoadSegments}, wherever that one's is within `reach`, from a
 * tree of boxes rather than a square of cells: `urban-class.ts`' sweep asks it
 * for each of four million samples on a 250 km route, and the square at its
 * 250 m reach held a few hundred segments each.
 *
 * ⚠️ **Ties included.** Where two segments are exactly as near — a loop's
 * closing segment and its first, which share a point, or a point midway
 * between two legs of a hairpin — the cells' answer is the segment their scan
 * reaches first, and so is this one's ({@link scannedFirst}); without it the
 * mirrored hairpin and every circuit fixture read a different pass at a few
 * dozen samples.
 *
 * `road` is {@link drawnRoadPoints}' answer, whose tree is built at the first call.
 */
export function nearestOnWholeRoad(
  road: DrawnRoadPoints,
  x: number,
  z: number,
  reach: number,
  into: BesideTheRoad,
): boolean {
  const { boxes, first, last, nodes, stack } = roadHierarchy(road);
  const points = road.points;
  let best = reach * reach;
  let bestSegment = -1;
  // The first cell of the square `roadSegmentsNear` would scan: its column and row.
  const column = Math.floor((x - reach) / ROAD_CELL_METRES);
  const row = Math.floor((z - reach) / ROAD_CELL_METRES);
  let depth = 0;
  stack[depth++] = 0;
  while (depth > 0) {
    const node = stack[--depth] as number;
    const from = first[node] as number;
    const to = last[node] as number;
    if (from >= to) continue;
    const ox = Math.max((boxes[node * 4] as number) - x, 0, x - (boxes[node * 4 + 2] as number));
    const oz = Math.max(
      (boxes[node * 4 + 1] as number) - z,
      0,
      z - (boxes[node * 4 + 3] as number),
    );
    // Not `>=`: a box exactly as far as the best may hold a tie the scan reaches first.
    if (ox * ox + oz * oz > best) continue;
    const left = node * 2 + 1;
    if (left >= nodes) {
      for (let segment = from; segment < to; segment += 1) {
        const ax = points[segment * 2] as number;
        const az = points[segment * 2 + 1] as number;
        const dx = (points[segment * 2 + 2] as number) - ax;
        const dz = (points[segment * 2 + 3] as number) - az;
        const span = dx * dx + dz * dz;
        const t = span > 0 ? Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / span)) : 0;
        const sx = x - (ax + dx * t);
        const sz = z - (az + dz * t);
        const squared = sx * sx + sz * sz;
        if (squared > best) continue;
        if (
          squared === best &&
          (bestSegment < 0 || !scannedFirst(points, segment, bestSegment, column, row))
        ) {
          continue;
        }
        best = squared;
        bestSegment = segment;
        const length = Math.sqrt(span);
        into.along = Math.min(road.total, (segment + t) * road.step);
        into.distance = Math.sqrt(squared);
        into.lateral = length > 0 ? (sz * dx - sx * dz) / length : into.distance;
      }
      continue;
    }
    // The nearer child is searched first, so that `best` tightens before the other is measured.
    const right = left + 1;
    if (nearerBox(boxes, left, right, x, z)) {
      stack[depth++] = right;
      stack[depth++] = left;
    } else {
      stack[depth++] = left;
      stack[depth++] = right;
    }
  }
  return bestSegment >= 0;
}

/**
 * Whether {@link roadSegmentsNear}'s scan of the square whose first cell is
 * `(column, row)` reaches segment `a` before segment `b` — what
 * {@link nearestOnRoadSegments}' strict `<` keeps of a tie. The scan runs
 * column by column, each row by row, and within a cell by segment; a segment
 * is first met in the first cell of its box inside the square.
 */
function scannedFirst(
  points: Float64Array,
  a: number,
  b: number,
  column: number,
  row: number,
): boolean {
  const cellOf = (value: number): number => Math.floor(value / ROAD_CELL_METRES);
  const columnOf = (segment: number): number =>
    Math.max(
      column,
      cellOf(Math.min(points[segment * 2] as number, points[segment * 2 + 2] as number)),
    );
  const rowOf = (segment: number): number =>
    Math.max(
      row,
      cellOf(Math.min(points[segment * 2 + 1] as number, points[segment * 2 + 3] as number)),
    );
  const columnA = columnOf(a);
  const columnB = columnOf(b);
  if (columnA !== columnB) return columnA < columnB;
  const rowA = rowOf(a);
  const rowB = rowOf(b);
  if (rowA !== rowB) return rowA < rowB;
  return a < b;
}

/**
 * Whether any segment of the drawn road passes strictly within `radius` of
 * `(x, z)`, but for the stretch around `along` — the segments `s` whose ends,
 * `s × step` and `(s + 1) × step`, are both strictly within `tolerance` of it,
 * so that no point of it is read as more than `tolerance` away — #1696.
 * `urban-class.ts`' sweep asks it once for the far end of each half of a
 * normal: where no other stretch of road comes into that disc, no sample
 * nearer the road on that normal can be nearer another stretch of it. The same
 * tree as {@link nearestOnWholeRoad}; it stops at the first segment that does.
 */
export function otherRoadWithin(
  road: DrawnRoadPoints,
  x: number,
  z: number,
  radius: number,
  along: number,
  tolerance: number,
): boolean {
  const step = road.step;
  // The own stretch, by the same products the doc names, so rounding cannot widen it.
  let ownFirst = Math.floor((along - tolerance) / step);
  while (ownFirst * step <= along - tolerance) ownFirst += 1;
  let ownLast = Math.ceil((along + tolerance) / step) - 1;
  while ((ownLast + 1) * step >= along + tolerance) ownLast -= 1;
  const { boxes, first, last, nodes, stack } = roadHierarchy(road);
  const points = road.points;
  const limit = radius * radius;
  let depth = 0;
  stack[depth++] = 0;
  while (depth > 0) {
    const node = stack[--depth] as number;
    const from = first[node] as number;
    const to = last[node] as number;
    // Empty, or every segment of it is the caller's own.
    if (from >= to || (from >= ownFirst && to - 1 <= ownLast)) continue;
    const ox = Math.max((boxes[node * 4] as number) - x, 0, x - (boxes[node * 4 + 2] as number));
    const oz = Math.max(
      (boxes[node * 4 + 1] as number) - z,
      0,
      z - (boxes[node * 4 + 3] as number),
    );
    if (ox * ox + oz * oz >= limit) continue;
    const left = node * 2 + 1;
    if (left < nodes) {
      stack[depth++] = left + 1;
      stack[depth++] = left;
      continue;
    }
    for (let segment = from; segment < to; segment += 1) {
      if (segment >= ownFirst && segment <= ownLast) continue;
      const ax = points[segment * 2] as number;
      const az = points[segment * 2 + 1] as number;
      const dx = (points[segment * 2 + 2] as number) - ax;
      const dz = (points[segment * 2 + 3] as number) - az;
      if (squaredToSegment(x, z, ax, az, dx, dz, dx * dx + dz * dz) < limit) return true;
    }
  }
  return false;
}

/** Whether box `a`'s centre is nearer `(x, z)` than box `b`'s. */
function nearerBox(boxes: Float64Array, a: number, b: number, x: number, z: number): boolean {
  const ax = ((boxes[a * 4] as number) + (boxes[a * 4 + 2] as number)) / 2 - x;
  const az = ((boxes[a * 4 + 1] as number) + (boxes[a * 4 + 3] as number)) / 2 - z;
  const bx = ((boxes[b * 4] as number) + (boxes[b * 4 + 2] as number)) / 2 - x;
  const bz = ((boxes[b * 4 + 1] as number) + (boxes[b * 4 + 3] as number)) / 2 - z;
  return ax * ax + az * az <= bx * bx + bz * bz;
}
