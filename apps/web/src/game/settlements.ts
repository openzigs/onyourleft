// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Places, not houses — #460. Villages and farmsteads beside the road, and the
 * walls, hedges and fences that divide the fields.
 *
 * ## What was wrong
 *
 * Every building was one scatter kind drawn by the same field as the trees
 * (`scatter.ts`), so a house stood wherever a tree could: alone, at any angle,
 * anywhere in the band. Nothing divided the land. Owner, 2026-09-21: *"we have
 * more than just houses."*
 *
 * ## ⚠️ Where a settlement goes — the rule, from the route and a seed only
 *
 * ADR 0009 and ADR 0022's procedural placement: no map, no place data, no
 * names. The route is divided into sites {@link SETTLEMENT_SPACING_METRES}
 * apart (stretched to divide it evenly, as `scatter.ts` §`cellSpanMetres`
 * stretches its cells, so a loop's seam is an ordinary boundary). Each site
 * hashes a kind — a **village** with {@link VILLAGE_CHANCE}, a **farmstead**
 * with {@link FARMSTEAD_CHANCE}, otherwise nothing — and a place along the
 * site. It is then built only if the ground there would be built on:
 *
 * - **level** — no steeper than `scatter.ts` §`SETTLEMENT_GRADE_PERCENT` along
 *   its whole length (people build on the valley floor, not on the pitch);
 * - **low** — within `scatter.ts` §`SETTLEMENT_TREE_LINE_FRACTION` of the local
 *   tree line;
 * - **dry** — no part of it in water or on a bank (`waterways.ts` §`inWater`).
 *
 * ## How a place is laid out
 *
 * A village is plots {@link PLOT_METRES} apart along the road, both sides, each
 * building's front turned to face the road at one setback — a row of houses
 * with a **row of shops** at its middle and a **church** at one end, and a
 * **signpost** at each way in. A farmstead is a farmhouse with a **barn** and a
 * **shed** grouped on one side, set further back. Five kinds of building, each
 * with its own silhouette (`buildings.ts`, since #500 with its doors and
 * windows facing the road).
 *
 * ⚠️ **A signpost carries no words.** No real name, no brand, no copied
 * signage: a white board on a post says "a place" and nothing more.
 *
 * ## Fields, and what divides them
 *
 * The land beside the road is divided into fields `landform.ts`
 * §`FIELD_SPAN_METRES` long, each side, stretched to divide the route evenly —
 * the grid the ground's own patchwork is drawn on (#425), so a wall stands
 * where one field's colour meets the next. A field is enclosed
 * with {@link ENCLOSED_SHARE}, on ground that is below the trees and no steeper
 * than {@link FIELD_GRADE_PERCENT}: along the verge at
 * {@link FIELD_EDGE_LATERAL_METRES} from the centreline, and out from the road
 * along its first edge to {@link FIELD_DEPTH_METRES}. What encloses it is
 * where it is: **stone walls** on higher or steeper ground, and **hedges** or
 * **fences** on the low flat land, hashed per field. Each is one instanced
 * draw, whatever the count (`three-renderer.ts` §`ScatterBelt`).
 *
 * Every item is a {@link ScatterItem}, admitted on its own unwrapped `along`
 * half-open exactly as `scatter.ts` admits one, so two adjacent spans are a
 * partition and lap two is the same place as lap one.
 *
 * ## ⚠️ Nothing stands on ANY stretch of the road
 *
 * Every structure's whole footprint ({@link STRUCTURE_FOOTPRINTS}) is held
 * {@link ROAD_CLEARANCE_METRES} from every segment of the WHOLE route, not
 * only from the road it was placed beside — {@link structureClearance}. #468's
 * first head had no such rule, and its review found a wall 1.61 m from the
 * centreline of a 20 m hairpin: a field boundary runs
 * {@link FIELD_DEPTH_METRES} straight out and reached the other leg. The same
 * rule is what keeps a house off the inside of its own tight bend, which
 * {@link buildable} does not look at. This is the third placer here to need it
 * (`scatter.ts` in #348, `landform.ts` §`clearReach` in #458), and
 * `settlements.test.ts` §"nothing stands on the road" is its hairpin fixture.
 *
 * Pure, and names no rendering library.
 */

import {
  distanceOnRoute,
  elevationAt,
  gradeAt,
  positionAt,
  type GeographicPosition,
  type RouteProfile,
} from '@onyourleft/domain';

import { ROAD_CLEARANCE_METRES, fieldSpanMetres, terrainHeightAt } from './landform';
import {
  SETTLEMENT_GRADE_PERCENT,
  SETTLEMENT_TREE_LINE_FRACTION,
  type ScatterItem,
  type StructureKind,
} from './scatter';
import { slotHash, uniformFrom } from './seeded';
import { localGroundPosition, type CorridorOrigin } from './terrain';
import { inWater, waterways } from './waterways';
import { treeLineMetres } from './world';

/**
 * How far apart the places a settlement may stand are, along the route, in
 * metres: **700**. Nominal — stretched so the route holds a whole number.
 * About one village or farmstead every one to two kilometres of level valley
 * road, once the chances and the ground have had their say.
 */
export const SETTLEMENT_SPACING_METRES = 700;

/** The share of sites that are villages: **0.3**. */
export const VILLAGE_CHANCE = 0.3;

/** The share of sites that are farmsteads: **0.35**. The rest are open country. */
export const FARMSTEAD_CHANCE = 0.35;

/** How long a village is along the road, in metres: **180**. */
export const VILLAGE_METRES = 180;

/** How far apart a village's plots are along the road, in metres: **18**. */
export const PLOT_METRES = 18;

/** The share of a village's plots that are built on: **0.8**. */
export const PLOT_BUILT_SHARE = 0.8;

/**
 * How far from the centreline a village's buildings stand, in metres: **15** —
 * one setback for the whole street, which is what makes it a street. Past the
 * 3.5 m road, the verge and its wall, and a front garden.
 */
export const SETBACK_METRES = 15;

/** How far back the church stands, in metres: **20** — it has a churchyard. */
export const CHURCH_SETBACK_METRES = 20;

/** How far back a farmstead's buildings stand, in metres: **24** to **30**. */
export const FARM_SETBACK_METRES = [24, 30] as const;

/** How far from the centreline a signpost stands, in metres: **5.5** — on the verge. */
export const SIGNPOST_LATERAL_METRES = 5.5;

/** The share of fields that are enclosed: **0.55**. */
export const ENCLOSED_SHARE = 0.55;

/** The steepest ground a field is enclosed on, in percent: **6**. */
export const FIELD_GRADE_PERCENT = 6;

/**
 * How far from the centreline a field's roadside boundary runs, in metres:
 * **5.6** — inside the 3 m verge `scatter.ts` keeps bare (3.5 m to 6.5 m), so
 * the wall and the first trees behind it do not stand in each other.
 */
export const FIELD_EDGE_LATERAL_METRES = 5.6;

/** How far out from the road a field's side boundary runs, in metres: **48**. */
export const FIELD_DEPTH_METRES = 48;

/**
 * How long one piece of wall, hedge or fence is, in metres: **8** — the length
 * `three-renderer.ts` §`BOUNDARY_STYLE` builds each of them.
 */
export const BOUNDARY_PIECE_METRES = 8;

/**
 * The share of the tree line above which a boundary is a stone wall whatever
 * the hash says: **0.12**. Higher ground is walled.
 */
export const WALL_TREE_LINE_FRACTION = 0.12;

/** The gradient above which a boundary is a stone wall, in percent: **4**. */
export const WALL_GRADE_PERCENT = 4;

/** The share of low, flat boundaries that are hedges rather than fences: **0.6**. */
export const HEDGE_SHARE = 0.6;

/** The most structures one frame may carry, at the target rung. @see QualitySettings.structureItems */
export const STRUCTURE_MAX_ITEMS = 240;

/** The keys the sites and fields are hashed under, outside anything else's. */
const SITE_KEY = 0x4_0000;
const FIELD_KEY = 0x5_0000;

/** One uniform per quantity a site draws, one stream each. */
const STREAM_KIND = 0;
const STREAM_PLACE = 1;
const STREAM_SIDE = 2;
const STREAM_PLOT = 3;
const STREAM_VARIANT = 4;

/**
 * Every structure beside the road between two odometer readings — buildings,
 * signposts and field boundaries.
 *
 * ⚠️ **Buildings and signposts first, then the boundaries nearest the rider**,
 * and the budget cuts from the end: a rung that takes structures away takes
 * the far walls and hedges before it takes a house.
 */
export function structuresAt(
  profile: RouteProfile,
  origin: CorridorOrigin,
  seed: number,
  fromMetres: number,
  toMetres: number,
  budget: { readonly maxItems: number; readonly riderMetres: number },
): readonly ScatterItem[] {
  const found: ScatterItem[] = [];
  const villages: (readonly [number, number])[] = [];
  settlementsAt(profile, origin, seed, fromMetres, toMetres, found, villages);
  const edges: { readonly item: ScatterItem; readonly along: number }[] = [];
  fieldEdgesAt(profile, origin, seed, fromMetres, toMetres, villages, edges);
  edges.sort(
    (first, second) =>
      Math.abs(first.along - budget.riderMetres) - Math.abs(second.along - budget.riderMetres),
  );
  for (const edge of edges) {
    found.push(edge.item);
  }
  // ⚠️ **One of every place.** A loop shorter than the view comes round again
  // inside it, and the second lap's field or site is the same one standing in
  // the same place — `scatter.ts` §`scatterAt` makes the same promise for the
  // scenery. Two copies of one wall at one place would be two instances drawn
  // into the same pixels.
  const once = distinctPlaces(found).filter(
    // ⚠️ Off EVERY stretch of the road, not only the one it was placed beside.
    // @see structureClearance
    (item) => structureClearance(profile, origin, item) >= ROAD_CLEARANCE_METRES,
  );
  return once.slice(0, Math.max(0, budget.maxItems));
}

/**
 * `items` with every repeat of a place dropped, the first kept, in order.
 *
 * ⚠️ **A number, not a string — #469.** The key used to be
 * `${kind} ${x.toFixed(3)} ${z.toFixed(3)}`: three strings built and one
 * concatenated for every structure in view, every frame, on the thread GATT
 * notifications arrive on. The place is now the millimetre grid point hashed to
 * a number ({@link placeKey}), and a number two different places share is told
 * apart by {@link samePlace} rather than trusted.
 */
export function distinctPlaces(items: readonly ScatterItem[]): ScatterItem[] {
  placesSeen.clear();
  const distinct = items.filter((item, index) => {
    const key = placeKey(item);
    const earlier = placesSeen.get(key);
    if (earlier === undefined) {
      placesSeen.set(key, item);
      return true;
    }
    if (samePlace(earlier, item)) return false;
    // A collision: two different places, one key. Rare enough to settle by
    // walking everything before this item, which is exact.
    return !seenBefore(items, index, item);
  });
  // Emptied again on the way out, so the map holds no structure between frames.
  placesSeen.clear();
  return distinct;
}

/**
 * The first structure seen at each key: reused, and emptied as each
 * {@link distinctPlaces} begins and ends, so one call's places never drop the
 * next's and no frame's structures are held on to after it.
 */
const placesSeen = new Map<number, ScatterItem>();

/** Whether any of the first `count` items stands where `item` does. */
function seenBefore(items: readonly ScatterItem[], count: number, item: ScatterItem): boolean {
  for (let index = 0; index < count; index += 1) {
    if (samePlace(items[index] as ScatterItem, item)) return true;
  }
  return false;
}

/** A place to the millimetre, as the two grid numbers {@link samePlace} compares. */
function millimetres(metres: number): number {
  return Math.round(metres * 1_000);
}

/**
 * Where a structure stands, as a number: its millimetre grid point, hashed.
 *
 * ⚠️ **A hash, not a pairing**: two places a whole number of 92 821 mm apart
 * in one axis and the right amount in the other share a key, and so do two
 * kinds at one place. {@link samePlace} is what decides; the key only says
 * where to look. Every term is an integer well inside 2⁵³, so the arithmetic
 * itself is exact.
 *
 * ⚠️ **"The same kind at the same millimetre" means {@link millimetres}'
 * rounding, which is NOT the `toFixed(3)` key this replaced — #473.**
 * `toFixed` rounds the exact decimal half AWAY from zero; `Math.round` rounds
 * the float product half towards +∞. So the two disagree only at a
 * half-millimetre boundary: `-0.0001` and `0.0001` m were two places and are
 * now one (both round to 0 mm), and `-0.0005` rounds to 0 here where `toFixed`
 * gave `-0.001`. No real case reaches it — a repeat is an exact recomputation
 * of one item, bit for bit, so it lands on the same grid point under either
 * rule — and #472's review forced every key to collide with `settlements` and
 * `arrangement-unchanged` staying green. Change {@link millimetres} and this is
 * the equivalence that changes.
 */
function placeKey(item: ScatterItem): number {
  return millimetres(item.x) * 92_821 + millimetres(item.z);
}

/** The same kind at the same millimetre: what "the same structure" means here. */
function samePlace(first: ScatterItem, second: ScatterItem): boolean {
  return (
    first.kind === second.kind &&
    millimetres(first.x) === millimetres(second.x) &&
    millimetres(first.z) === millimetres(second.z)
  );
}

/**
 * How much ground each structure covers, in its own frame, in metres: half its
 * width across (`x`) and how far it reaches behind (`back`, negative) and in
 * front (`front`) of where it stands, along the way it faces (`z`).
 *
 * Read off the shapes those kinds are built from — `buildings.ts` for a
 * building since #500, `three-renderer.ts` §`BOUNDARY_STYLE` for the rest —
 * the roof, the eaves and a door's step included, because they stand out;
 * `buildings.test.ts` holds every vertex of every shape inside these. And,
 * for `building`, off the 9 m that `sceneryFitMetres` fits a model's largest
 * extent to, taken as a square because a model's proportions are the pack's.
 * A wall, hedge or fence is one {@link BOUNDARY_PIECE_METRES} piece along `z`.
 *
 * ⚠️ **Generous rather than exact, on purpose**: an overstated footprint
 * drops a house from a hairpin's inside, which nobody misses; an understated
 * one stands its eaves over the carriageway.
 */
export const STRUCTURE_FOOTPRINTS: Readonly<
  Record<StructureKind, { readonly x: number; readonly back: number; readonly front: number }>
> = {
  building: { x: 4.5, back: -4.5, front: 4.5 },
  barn: { x: 7.3, back: -4.3, front: 4.3 },
  church: { x: 3.8, back: -9.3, front: 9.5 },
  'shop-row': { x: 10.2, back: -3.7, front: 3.7 },
  shed: { x: 5.2, back: -4.4, front: 4.4 },
  wall: { x: 0.3, back: -BOUNDARY_PIECE_METRES / 2, front: BOUNDARY_PIECE_METRES / 2 },
  hedge: { x: 0.55, back: -BOUNDARY_PIECE_METRES / 2, front: BOUNDARY_PIECE_METRES / 2 },
  fence: { x: 0.1, back: -BOUNDARY_PIECE_METRES / 2, front: BOUNDARY_PIECE_METRES / 2 },
  signpost: { x: 0.1, back: -0.95, front: 0.95 },
};

/** The side of one cell of {@link roadGrid}, in metres. */
const ROAD_CELL_METRES = 32;

/** The whole route's centreline in local metres, bucketed by cell. */
interface RoadGrid {
  readonly origin: CorridorOrigin;
  /** Two floats a point: the route's own grid, in plan. */
  readonly points: Float64Array;
  /** Segment `s` runs from point `s` to point `s + 1`. */
  readonly cells: ReadonlyMap<number, readonly number[]>;
}

const roadGrids = new WeakMap<RouteProfile, RoadGrid>();

function cellKey(column: number, row: number): number {
  return column * 100_003 + row;
}

/**
 * The whole route as segments in a grid of cells, built once a route.
 *
 * ⚠️ **The WHOLE route and not the frame's corridor**, which is the point of
 * #468's review finding B1: a field's boundary runs {@link FIELD_DEPTH_METRES}
 * straight out from the road, and on a hairpin that reaches the other leg — a
 * stretch of road that may be hundreds of metres of route away and outside any
 * window a frame would think to look in. `scatter.ts` fixed its own form of
 * this in #348, and `landform.ts` §`clearReach` its own in #458; each placer
 * that stands things along the road's normal has shipped without the check at
 * first. The route's own points are what `terrain.ts` §`pointAt` interpolates
 * the road between, so a segment here is the drawn centreline.
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
  // ⚠️ No segment from the last point back to the first on a loop:
  // `positionAt` interpolates between neighbours only, and a loop's grid ends
  // on its own closing point, so no such stretch is ever drawn.
  const positions = profile.positions;
  const count = positions.length;
  const points = new Float64Array(count * 2);
  for (let index = 0; index < count; index += 1) {
    const local = localGroundPosition(origin, positions[index] as GeographicPosition);
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
        const key = cellKey(column, row);
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

/**
 * How close a structure's whole {@link STRUCTURE_FOOTPRINTS footprint} comes
 * to the road's centreline, in metres, over EVERY stretch of the road. Exact
 * wherever the answer is within {@link ROAD_CLEARANCE_METRES} of the
 * footprint, which is all a caller asks; further out it is `+Infinity` or an
 * upper bound, because the grid is only searched that far.
 *
 * {@link structuresAt} keeps a structure only when this is at least
 * {@link ROAD_CLEARANCE_METRES}: the carriageway's half-width and its verge,
 * the same clearance `landform.ts` §`clearReach` holds the ground to.
 */
export function structureClearance(
  profile: RouteProfile,
  origin: CorridorOrigin,
  item: ScatterItem,
): number {
  const road = roadGrid(profile, origin);
  const footprint = STRUCTURE_FOOTPRINTS[item.kind as StructureKind];
  const reach =
    Math.hypot(footprint.x, Math.max(-footprint.back, footprint.front)) + ROAD_CLEARANCE_METRES;
  const cellOf = (value: number): number => Math.floor(value / ROAD_CELL_METRES);
  const cos = Math.cos(item.rotation);
  const sin = Math.sin(item.rotation);
  // Into the structure's own frame: the inverse of a yaw of `rotation`.
  const localX = (x: number, z: number): number => (x - item.x) * cos - (z - item.z) * sin;
  const localZ = (x: number, z: number): number => (x - item.x) * sin + (z - item.z) * cos;
  // A segment in two of the cells searched is measured twice, which costs a
  // few multiplications and no allocation — the frame's thread is the one
  // GATT notifications arrive on (#240's NFR-2).
  let least = Number.POSITIVE_INFINITY;
  for (let column = cellOf(item.x - reach); column <= cellOf(item.x + reach); column += 1) {
    for (let row = cellOf(item.z - reach); row <= cellOf(item.z + reach); row += 1) {
      for (const segment of road.cells.get(cellKey(column, row)) ?? NO_SEGMENTS) {
        const ax = road.points[segment * 2] as number;
        const az = road.points[segment * 2 + 1] as number;
        const bx = road.points[segment * 2 + 2] as number;
        const bz = road.points[segment * 2 + 3] as number;
        least = Math.min(
          least,
          segmentToBox(
            localX(ax, az),
            localZ(ax, az),
            localX(bx, bz),
            localZ(bx, bz),
            footprint.x,
            footprint.back,
            footprint.front,
          ),
        );
      }
    }
  }
  return least;
}

/**
 * The distance from segment `(ax, az)–(bx, bz)` to the box `|x| ≤ half`,
 * `back ≤ z ≤ front`: nought when they meet, and otherwise the least of each
 * end to the box and each corner to the segment — which is where two convex
 * shapes that do not meet are closest.
 */
function segmentToBox(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  half: number,
  back: number,
  front: number,
): number {
  // Liang–Barsky: does any of the segment lie inside the box? Four clips,
  // written out rather than looped over `[p, q]` pairs — the loop built five
  // arrays a call, and this runs for every road segment near every structure
  // in view, every frame: about 600 KiB a frame of garbage on a village route
  // before #469, measured, which was more than the rest of the frame together.
  const dx = bx - ax;
  const dz = bz - az;
  clip.enter = 0;
  clip.leave = 1;
  clipAgainst(-dx, ax + half);
  clipAgainst(dx, half - ax);
  clipAgainst(-dz, az - back);
  clipAgainst(dz, front - az);
  if (clip.enter <= clip.leave) return 0;
  const span = dx * dx + dz * dz;
  return Math.min(
    pointToBox(ax, az, half, back, front),
    pointToBox(bx, bz, half, back, front),
    pointToSegment(-half, back, ax, az, dx, dz, span),
    pointToSegment(half, back, ax, az, dx, dz, span),
    pointToSegment(-half, front, ax, az, dx, dz, span),
    pointToSegment(half, front, ax, az, dx, dz, span),
  );
}

/** The parameter interval {@link segmentToBox} narrows, reused between calls. */
const clip = { enter: 0, leave: 1 };

/** One Liang–Barsky clip, against the edge where `p·t ≤ q`. */
function clipAgainst(p: number, q: number): void {
  if (p === 0) {
    if (q < 0) {
      clip.enter = 1;
      clip.leave = 0;
    }
    return;
  }
  const t = q / p;
  if (p < 0) clip.enter = Math.max(clip.enter, t);
  else clip.leave = Math.min(clip.leave, t);
}

/** From a point to the box `|x| ≤ half`, `back ≤ z ≤ front`. */
function pointToBox(x: number, z: number, half: number, back: number, front: number): number {
  return Math.hypot(Math.max(0, Math.abs(x) - half), Math.max(0, back - z, z - front));
}

/** From a point to the segment from `(ax, az)` along `(dx, dz)`, whose squared length is `span`. */
function pointToSegment(
  x: number,
  z: number,
  ax: number,
  az: number,
  dx: number,
  dz: number,
  span: number,
): number {
  const t = span > 0 ? Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / span)) : 0;
  return Math.hypot(x - (ax + dx * t), z - (az + dz * t));
}

/** A cell with no road in it. Shared, so a miss allocates nothing. */
const NO_SEGMENTS: readonly number[] = [];

/** Where on the route something is, and which way the road runs there. */
interface Frame {
  readonly x: number;
  readonly z: number;
  /** The left normal, `terrain.ts`'s convention. */
  readonly normalX: number;
  readonly normalZ: number;
}

function frameAt(
  profile: RouteProfile,
  origin: CorridorOrigin,
  wrapped: number,
): Frame | undefined {
  const here = localGroundPosition(origin, positionAt(profile, wrapped));
  const ahead = localGroundPosition(
    origin,
    positionAt(profile, distanceOnRoute(profile, wrapped + 5)),
  );
  const behind = localGroundPosition(
    origin,
    positionAt(profile, distanceOnRoute(profile, wrapped - 5)),
  );
  const dx = ahead.x - behind.x;
  const dz = ahead.z - behind.z;
  const length = Math.hypot(dx, dz);
  if (!(length > 0)) {
    return undefined;
  }
  return { x: here.x, z: here.z, normalX: -dz / length, normalZ: dx / length };
}

/** Whether a stretch of the route would be built on: level, low and dry. */
function buildable(
  profile: RouteProfile,
  seed: number,
  from: number,
  to: number,
  lateral: number,
): boolean {
  const ways = waterways(profile, seed);
  for (let at = from; at <= to + 1e-9; at += 10) {
    const wrapped = distanceOnRoute(profile, at);
    if (Math.abs(gradeAt(profile, wrapped)) > SETTLEMENT_GRADE_PERCENT) return false;
    const latitude = Math.abs(positionAt(profile, wrapped).latitude);
    if (elevationAt(profile, wrapped) > treeLineMetres(latitude) * SETTLEMENT_TREE_LINE_FRACTION) {
      return false;
    }
    if (inWater(ways, profile, wrapped, lateral) || inWater(ways, profile, wrapped, -lateral)) {
      return false;
    }
  }
  return true;
}

/** An item standing on the ground at `along` (odometer), `signedLateral` out, facing the road. */
function standing(
  profile: RouteProfile,
  origin: CorridorOrigin,
  seed: number,
  kind: StructureKind,
  along: number,
  signedLateral: number,
  variant: number,
  facing: 'road' | 'along',
): ScatterItem | undefined {
  const wrapped = distanceOnRoute(profile, along);
  const frame = frameAt(profile, origin, wrapped);
  if (frame === undefined) return undefined;
  // Facing the road is facing back along the normal from its side; facing
  // along is the road's own direction, (normalZ, −normalX).
  const [fx, fz] =
    facing === 'road'
      ? [-frame.normalX * Math.sign(signedLateral), -frame.normalZ * Math.sign(signedLateral)]
      : [frame.normalZ, -frame.normalX];
  return {
    kind,
    x: frame.x + frame.normalX * signedLateral,
    y: terrainHeightAt(profile, origin, seed, wrapped, signedLateral),
    z: frame.z + frame.normalZ * signedLateral,
    rotation: Math.atan2(fx, fz),
    scale: 1,
    variant,
  };
}

/** The villages and farmsteads, and their signposts. */
function settlementsAt(
  profile: RouteProfile,
  origin: CorridorOrigin,
  seed: number,
  fromMetres: number,
  toMetres: number,
  found: ScatterItem[],
  villages: (readonly [number, number])[],
): void {
  const total = profile.totalDistance;
  const sites = Math.max(1, Math.round(total / SETTLEMENT_SPACING_METRES));
  const span = total / sites;
  const reach = VILLAGE_METRES / 2 + PLOT_METRES;
  const first = Math.floor((fromMetres - reach) / span);
  // ⚠️ **Never more sites than the route has** — `scatter.ts` §`scatterAt`'s
  // own bound, for its reason: a loop a few metres round, imported from a
  // hostile file, has a site span to match, and a 460 m view over it would be
  // tens of thousands of sites a frame — every one of them the same few,
  // placed again on top of themselves.
  const last = Math.min(Math.floor((toMetres + reach) / span), first + sites + 1);
  for (let site = first; site <= last; site += 1) {
    if (!profile.loop && (site < 0 || site >= sites)) continue;
    const wrappedSite = ((site % sites) + sites) % sites;
    const base = slotHash(seed, wrappedSite, SITE_KEY);
    const roll = uniformFrom(base, STREAM_KIND);
    const kind =
      roll < VILLAGE_CHANCE
        ? 'village'
        : roll < VILLAGE_CHANCE + FARMSTEAD_CHANCE
          ? 'farm'
          : undefined;
    if (kind === undefined) continue;
    // Where in its site, clear of the site's ends so two neighbours' plots
    // never overlap.
    const centre = site * span + span * (0.3 + 0.4 * uniformFrom(base, STREAM_PLACE));
    const half = kind === 'village' ? VILLAGE_METRES / 2 : 20;
    if (!buildable(profile, seed, centre - half, centre + half, SETBACK_METRES)) continue;
    const side = uniformFrom(base, STREAM_SIDE) < 0.5 ? 1 : -1;
    const admit = (item: ScatterItem | undefined, along: number): void => {
      if (item !== undefined && along >= fromMetres && along < toMetres) found.push(item);
    };
    if (kind === 'village') {
      villages.push([centre - half - PLOT_METRES, centre + half + PLOT_METRES]);
      const plots = Math.floor(VILLAGE_METRES / PLOT_METRES) + 1;
      const middle = Math.floor(plots / 2);
      for (let plot = 0; plot < plots; plot += 1) {
        const along = centre - half + plot * PLOT_METRES;
        for (const plotSide of [1, -1] as const) {
          const hash = slotHash(seed, wrappedSite * 64 + plot, SITE_KEY + (plotSide === 1 ? 1 : 2));
          if (uniformFrom(hash, STREAM_PLOT) >= PLOT_BUILT_SHARE) continue;
          // The church at the far end on the site's own side, the shops at the
          // middle on the other, houses on every other plot.
          const [building, lateral]: readonly [StructureKind, number] =
            plot === plots - 1 && plotSide === side
              ? ['church', CHURCH_SETBACK_METRES]
              : plot === middle && plotSide === -side
                ? ['shop-row', SETBACK_METRES - 1]
                : ['building', SETBACK_METRES];
          const variant = Math.min(5, Math.floor(uniformFrom(hash, STREAM_VARIANT) * 6));
          admit(
            standing(profile, origin, seed, building, along, lateral * plotSide, variant, 'road'),
            along,
          );
        }
      }
      // A signpost at each way in, on the verge, turned along the road.
      for (const [along, verge] of [
        [centre - half - PLOT_METRES / 2, -1],
        [centre + half + PLOT_METRES / 2, 1],
      ] as const) {
        admit(
          standing(
            profile,
            origin,
            seed,
            'signpost',
            along,
            SIGNPOST_LATERAL_METRES * verge,
            0,
            'along',
          ),
          along,
        );
      }
    } else {
      // A farmstead: a farmhouse, a barn and a shed, grouped on one side.
      const [near, far] = FARM_SETBACK_METRES;
      const layout: readonly (readonly [StructureKind, number, number])[] = [
        ['building', 0, near],
        ['barn', 17, far],
        ['shed', -15, far - 2],
      ];
      for (const [building, offset, lateral] of layout) {
        const along = centre + offset;
        const variant = Math.min(5, Math.floor(uniformFrom(base, STREAM_VARIANT) * 6));
        admit(
          standing(profile, origin, seed, building, along, lateral * side, variant, 'road'),
          along,
        );
      }
    }
  }
}

/** The walls, hedges and fences, each with the odometer it stands at. */
function fieldEdgesAt(
  profile: RouteProfile,
  origin: CorridorOrigin,
  seed: number,
  fromMetres: number,
  toMetres: number,
  villages: readonly (readonly [number, number])[],
  found: { item: ScatterItem; along: number }[],
): void {
  const total = profile.totalDistance;
  // The ground's own field grid, so the patchwork and the walls agree (#425).
  const span = fieldSpanMetres(profile);
  const fields = Math.max(1, Math.round(total / span));
  const ways = waterways(profile, seed);
  const first = Math.floor(fromMetres / span) - 1;
  // Never more fields than the route has. @see settlementsAt's bound.
  const last = Math.min(Math.floor(toMetres / span), first + fields + 1);
  const inVillage = (along: number): boolean =>
    villages.some(([from, to]) => along >= from && along <= to);
  for (let field = first; field <= last; field += 1) {
    if (!profile.loop && (field < 0 || field >= fields)) continue;
    const wrappedField = ((field % fields) + fields) % fields;
    const start = field * span;
    const middle = distanceOnRoute(profile, start + span / 2);
    const latitude = Math.abs(positionAt(profile, middle).latitude);
    const treeLine = treeLineMetres(latitude);
    const altitude = elevationAt(profile, middle);
    const steep = Math.abs(gradeAt(profile, middle));
    if (altitude >= treeLine || steep > FIELD_GRADE_PERCENT) continue;
    for (const side of [1, -1] as const) {
      const hash = slotHash(seed, wrappedField, FIELD_KEY + (side === 1 ? 1 : 2));
      if (uniformFrom(hash, 0) >= ENCLOSED_SHARE) continue;
      const kind: StructureKind =
        altitude > treeLine * WALL_TREE_LINE_FRACTION || steep > WALL_GRADE_PERCENT
          ? 'wall'
          : uniformFrom(hash, 1) < HEDGE_SHARE
            ? 'hedge'
            : 'fence';
      // Along the verge, the whole length of the field.
      const pieces = Math.max(1, Math.round(span / BOUNDARY_PIECE_METRES));
      const piece = span / pieces;
      for (let index = 0; index < pieces; index += 1) {
        const along = start + (index + 0.5) * piece;
        if (along < fromMetres || along >= toMetres || inVillage(along)) continue;
        const wrapped = distanceOnRoute(profile, along);
        if (inWater(ways, profile, wrapped, FIELD_EDGE_LATERAL_METRES * side)) continue;
        const item = standing(
          profile,
          origin,
          seed,
          kind,
          along,
          FIELD_EDGE_LATERAL_METRES * side,
          0,
          'along',
        );
        if (item !== undefined) found.push({ item, along });
      }
      // Out from the road along the field's first edge.
      if (start < fromMetres || start >= toMetres || inVillage(start)) continue;
      const frame = frameAt(profile, origin, distanceOnRoute(profile, start));
      if (frame === undefined) continue;
      const outward = Math.round(
        (FIELD_DEPTH_METRES - FIELD_EDGE_LATERAL_METRES) / BOUNDARY_PIECE_METRES,
      );
      for (let index = 0; index < outward; index += 1) {
        const lateral = FIELD_EDGE_LATERAL_METRES + (index + 0.5) * BOUNDARY_PIECE_METRES;
        const wrapped = distanceOnRoute(profile, start);
        if (inWater(ways, profile, wrapped, lateral * side)) continue;
        found.push({
          item: {
            kind,
            x: frame.x + frame.normalX * lateral * side,
            y: terrainHeightAt(profile, origin, seed, wrapped, lateral * side),
            z: frame.z + frame.normalZ * lateral * side,
            // Out from the road: its own length runs along the normal.
            rotation: Math.atan2(frame.normalX * side, frame.normalZ * side),
            scale: 1,
            variant: 0,
          },
          along: start,
        });
      }
    }
  }
}

/**
 * How close to a building nothing scattered may stand, in metres: **9** — a
 * house's half-depth and a little garden. The scenery `scatter.ts` places knows
 * nothing about villages, so a tree could otherwise stand in a kitchen.
 */
export const BUILDING_CLEARANCE_METRES = 9;

/** The kinds that are buildings, which the natural scenery keeps clear of. */
const BUILDINGS: ReadonlySet<StructureKind> = new Set([
  'building',
  'barn',
  'church',
  'shop-row',
  'shed',
]);

/**
 * The natural scenery, less anything standing within
 * {@link BUILDING_CLEARANCE_METRES} of a building. Pure, and a function of
 * positions only, so it is the same on every lap.
 */
export function clearOfBuildings(
  natural: readonly ScatterItem[],
  structures: readonly ScatterItem[],
): readonly ScatterItem[] {
  const buildings = structures.filter((item) => BUILDINGS.has(item.kind as StructureKind));
  if (buildings.length === 0) {
    return natural;
  }
  return natural.filter((item) =>
    buildings.every(
      (building) =>
        Math.hypot(item.x - building.x, item.z - building.z) >= BUILDING_CLEARANCE_METRES,
    ),
  );
}
