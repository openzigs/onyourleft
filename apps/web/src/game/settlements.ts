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
  type RouteProfile,
} from '@onyourleft/domain';

import { builtUpOrWater, fieldGround, NO_LAND_CLASS, type LandClassMask } from './land-class';
import { ROAD_CLEARANCE_METRES, fieldSpanMetres, terrainHeightAt } from './landform';
import {
  SETTLEMENT_GRADE_PERCENT,
  SETTLEMENT_TREE_LINE_FRACTION,
  type ScatterItem,
  type StructureKind,
} from './scatter';
import { slotHash, uniformFrom } from './seeded';
import { leastSquaredNearRoad, squaredToSegment } from './road-grid';
import { drawnRoadFrame, type CorridorOrigin } from './terrain';
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
 *
 * `footprints`, when given, is filled with the ground of every settlement whose
 * sites this call visits — #1534, {@link SettlementFootprint} — whatever the
 * budget keeps: a rung that drops a house does not plant its garden.
 *
 * `land` is the ride's land-class mask (#1546): no procedural site stands
 * where map data was read ({@link siteOnMappedLand}), and no field boundary
 * runs across mapped built-up land, water, wood or park (`land-class.ts`
 * §`fieldGround`). {@link NO_LAND_CLASS}, the default, is
 * today's world.
 */
export function structuresAt(
  profile: RouteProfile,
  origin: CorridorOrigin,
  seed: number,
  fromMetres: number,
  toMetres: number,
  budget: { readonly maxItems: number; readonly riderMetres: number },
  footprints?: SettlementFootprint[],
  land: LandClassMask = NO_LAND_CLASS,
): readonly ScatterItem[] {
  const found: ScatterItem[] = [];
  const villages: (readonly [number, number])[] = [];
  settlementsAt(profile, origin, seed, fromMetres, toMetres, found, villages, footprints, land);
  const edges: { readonly item: ScatterItem; readonly along: number }[] = [];
  fieldEdgesAt(profile, origin, seed, fromMetres, toMetres, villages, edges, land);
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
  return footprintClearance(
    profile,
    origin,
    item,
    STRUCTURE_FOOTPRINTS[item.kind as StructureKind],
  );
}

/** A footprint in its owner's frame, as {@link STRUCTURE_FOOTPRINTS} gives one. */
export interface Footprint {
  readonly x: number;
  readonly back: number;
  readonly front: number;
}

/**
 * {@link structureClearance} for any footprint standing anywhere — #966: the
 * billboards (`billboards.ts`) are held off every stretch of the road by the
 * same measure as a house, and are not a structure kind.
 */
export function footprintClearance(
  profile: RouteProfile,
  origin: CorridorOrigin,
  at: { readonly x: number; readonly z: number; readonly rotation: number },
  footprint: Footprint,
): number {
  const reach =
    Math.hypot(footprint.x, Math.max(-footprint.back, footprint.front)) + ROAD_CLEARANCE_METRES;
  boxQuery.x = at.x;
  boxQuery.z = at.z;
  boxQuery.cos = Math.cos(at.rotation);
  boxQuery.sin = Math.sin(at.rotation);
  boxQuery.half = footprint.x;
  boxQuery.back = footprint.back;
  boxQuery.front = footprint.front;
  // `road-grid.ts`' one cell search, the same `scatter.ts` asks of a point:
  // no closure and no allocation, because this runs for every structure in
  // view, every frame, on the thread GATT notifications arrive on (#240's
  // NFR-2, #469).
  return Math.sqrt(leastSquaredNearRoad(profile, origin, reach, segmentToFootprint, boxQuery));
}

/** The footprint {@link structureClearance} measures, reused between calls. */
const boxQuery = { x: 0, z: 0, cos: 1, sin: 0, half: 0, back: 0, front: 0 };

/**
 * `road-grid.ts` §`SegmentMeasure` from {@link boxQuery}'s footprint: the
 * segment turned into the structure's own frame — the inverse of a yaw of
 * `rotation` — and measured against its box.
 */
function segmentToFootprint(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  query: typeof boxQuery,
): number {
  const { x, z, cos, sin } = query;
  return segmentToBoxSquared(
    (ax - x) * cos - (az - z) * sin,
    (ax - x) * sin + (az - z) * cos,
    (bx - x) * cos - (bz - z) * sin,
    (bx - x) * sin + (bz - z) * cos,
    query.half,
    query.back,
    query.front,
  );
}

/**
 * The SQUARED distance from segment `(ax, az)–(bx, bz)` to the box
 * `|x| ≤ half`, `back ≤ z ≤ front`: nought when they meet, and otherwise the
 * least of each end to the box and each corner to the segment — which is where
 * two convex shapes that do not meet are closest.
 */
function segmentToBoxSquared(
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
    pointToBoxSquared(ax, az, half, back, front),
    pointToBoxSquared(bx, bz, half, back, front),
    squaredToSegment(-half, back, ax, az, dx, dz, span),
    squaredToSegment(half, back, ax, az, dx, dz, span),
    squaredToSegment(-half, front, ax, az, dx, dz, span),
    squaredToSegment(half, front, ax, az, dx, dz, span),
  );
}

/** The parameter interval {@link segmentToBoxSquared} narrows, reused between calls. */
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

/** From a point to the box `|x| ≤ half`, `back ≤ z ≤ front`, squared. */
function pointToBoxSquared(
  x: number,
  z: number,
  half: number,
  back: number,
  front: number,
): number {
  const ox = Math.max(0, Math.abs(x) - half);
  const oz = Math.max(0, back - z, z - front);
  return ox * ox + oz * oz;
}

/** Where on the route something is, and which way the road runs there. */
interface Frame {
  readonly x: number;
  readonly z: number;
  /** The normal, `terrain.ts`'s convention — the road's RIGHT since #583, called its left before. */
  readonly normalX: number;
  readonly normalZ: number;
}

function frameAt(
  profile: RouteProfile,
  origin: CorridorOrigin,
  wrapped: number,
): Frame | undefined {
  // ⚠️ The DRAWN road — #571. This was the route's own centreline, 5 m either
  // side, until then: at a planner's 90° corner the ribbon runs 3.5 m inside
  // the route's vertex (`terrain.ts` §`BEND_SMOOTHING_METRES`), and a hedge
  // {@link FIELD_EDGE_LATERAL_METRES} from the route stood in the road.
  return drawnRoadFrame(profile, origin, wrapped);
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

/**
 * One site's settlement, as the route and the seed decide it — #460. Shared
 * since #1535 with `streets.ts`, so a pavement is laid beside exactly the
 * village the houses stand in, from the same decision rather than a copy.
 */
export interface Site {
  readonly kind: 'village' | 'farm';
  /** The site's index along the route, unwrapped: a loop's second lap counts on. */
  readonly site: number;
  /** The same site on the route's first lap — what its hashes are drawn from. */
  readonly wrappedSite: number;
  /** Its middle, on the odometer (unwrapped). */
  readonly centre: number;
  /** Half its length along the road, in metres. */
  readonly half: number;
  /** The side its church (a village) or its buildings (a farmstead) stand on. */
  readonly side: 1 | -1;
}

/** How many sites the route is divided into, and how long each is. */
export function siteSpacing(profile: RouteProfile): {
  readonly sites: number;
  readonly span: number;
} {
  const sites = Math.max(1, Math.round(profile.totalDistance / SETTLEMENT_SPACING_METRES));
  return { sites, span: profile.totalDistance / sites };
}

/**
 * The settlement at one site, or `undefined` where there is none: open
 * country, or ground that would not be built on. @see buildable
 */
export function siteAt(profile: RouteProfile, seed: number, site: number): Site | undefined {
  const { sites, span } = siteSpacing(profile);
  if (!profile.loop && (site < 0 || site >= sites)) return undefined;
  const wrappedSite = ((site % sites) + sites) % sites;
  const base = slotHash(seed, wrappedSite, SITE_KEY);
  const roll = uniformFrom(base, STREAM_KIND);
  const kind =
    roll < VILLAGE_CHANCE
      ? 'village'
      : roll < VILLAGE_CHANCE + FARMSTEAD_CHANCE
        ? 'farm'
        : undefined;
  if (kind === undefined) return undefined;
  // Where in its site, clear of the site's ends so two neighbours' plots
  // never overlap.
  const centre = site * span + span * (0.3 + 0.4 * uniformFrom(base, STREAM_PLACE));
  const half = kind === 'village' ? VILLAGE_METRES / 2 : 20;
  if (!buildable(profile, seed, centre - half, centre + half, SETBACK_METRES)) return undefined;
  const side = uniformFrom(base, STREAM_SIDE) < 0.5 ? 1 : -1;
  return { kind, site, wrappedSite, centre, half, side };
}

/**
 * How far either side of the road's centreline a site's ground is sampled for
 * map data, in metres: **42** — a farmstead's barn
 * ({@link FARM_SETBACK_METRES} far, plus its depth) and
 * {@link SETTLEMENT_MARGIN_METRES} behind it, the furthest any site reaches.
 */
export const SITE_LAND_REACH_METRES = 42;

/** The sampling step along a site's ground, and across it, in metres. */
const SITE_LAND_STEP_ALONG_METRES = 10;
const SITE_LAND_STEP_ACROSS_METRES = 6;

/**
 * Whether any of a procedural site's ground is where map data was read —
 * #1546, ADR 0054 D-4.2 and D-5.3. Such a site is not built at all: a
 * stretch with data is what the data says, and #1540 puts the buildings back
 * where it says people built.
 *
 * The ground is the site's length and {@link PLOT_METRES} either end (where
 * its signposts stand), {@link SITE_LAND_REACH_METRES} either side, sampled
 * every {@link SITE_LAND_STEP_ALONG_METRES} along and
 * {@link SITE_LAND_STEP_ACROSS_METRES} across. Covered land comes in whole
 * z15 tiles and 320 m chunks, far wider than a step, so the sampling cannot
 * step over it.
 */
export function siteOnMappedLand(
  profile: RouteProfile,
  origin: CorridorOrigin,
  site: Site,
  land: LandClassMask,
): boolean {
  // Nothing was read: today's world, at no cost.
  if (land.bytes === 0) return false;
  const start = site.centre - site.half - PLOT_METRES;
  const length = 2 * (site.half + PLOT_METRES);
  const steps = Math.ceil(length / SITE_LAND_STEP_ALONG_METRES);
  for (let step = 0; step <= steps; step += 1) {
    const along = start + Math.min(length, step * SITE_LAND_STEP_ALONG_METRES);
    const frame = frameAt(profile, origin, distanceOnRoute(profile, along));
    if (frame !== undefined) {
      for (
        let lateral = -SITE_LAND_REACH_METRES;
        lateral <= SITE_LAND_REACH_METRES + 1e-9;
        lateral += SITE_LAND_STEP_ACROSS_METRES
      ) {
        if (land.covered(frame.x + frame.normalX * lateral, frame.z + frame.normalZ * lateral)) {
          return true;
        }
      }
    }
  }
  return false;
}

/** One built plot of a village: what stands on it, where, and how far back. */
export interface Plot {
  readonly along: number;
  readonly side: 1 | -1;
  readonly kind: StructureKind;
  readonly lateral: number;
  readonly variant: number;
}

/**
 * Every plot of a village, built or not, in plot order and the right side
 * before the left — #460's layout. #1534 clears the trees off every one of
 * them (an empty plot is a garden or a green, not a wood); #1535 lays a
 * pavement only along the built ones, {@link villagePlots}.
 */
function everyVillagePlot(
  seed: number,
  village: Site,
): readonly (Plot & { readonly built: boolean })[] {
  const plots = Math.floor(VILLAGE_METRES / PLOT_METRES) + 1;
  const middle = Math.floor(plots / 2);
  const every: (Plot & { readonly built: boolean })[] = [];
  for (let plot = 0; plot < plots; plot += 1) {
    const along = village.centre - village.half + plot * PLOT_METRES;
    for (const plotSide of [1, -1] as const) {
      const hash = slotHash(
        seed,
        village.wrappedSite * 64 + plot,
        SITE_KEY + (plotSide === 1 ? 1 : 2),
      );
      // The church at the far end on the site's own side, the shops at the
      // middle on the other, houses on every other plot.
      const [kind, lateral]: readonly [StructureKind, number] =
        plot === plots - 1 && plotSide === village.side
          ? ['church', CHURCH_SETBACK_METRES]
          : plot === middle && plotSide === -village.side
            ? ['shop-row', SETBACK_METRES - 1]
            : ['building', SETBACK_METRES];
      const built = uniformFrom(hash, STREAM_PLOT) < PLOT_BUILT_SHARE;
      const variant = Math.min(5, Math.floor(uniformFrom(hash, STREAM_VARIANT) * 6));
      every.push({ along, side: plotSide, kind, lateral, variant, built });
    }
  }
  return every;
}

/**
 * Every BUILT plot of a village, in plot order and the right side before the
 * left — #460's layout, and since #1535 what `streets.ts` lays a pavement
 * along: a side of the street with no house on it has none.
 */
export function villagePlots(seed: number, village: Site): readonly Plot[] {
  return everyVillagePlot(seed, village)
    .filter((plot) => plot.built)
    .map(({ along, side, kind, lateral, variant }) => ({ along, side, kind, lateral, variant }));
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
  footprints: SettlementFootprint[] | undefined,
  land: LandClassMask,
): void {
  const { sites, span } = siteSpacing(profile);
  const reach = VILLAGE_METRES / 2 + PLOT_METRES;
  const first = Math.floor((fromMetres - reach) / span);
  // ⚠️ **Never more sites than the route has** — `scatter.ts` §`scatterAt`'s
  // own bound, for its reason: a loop a few metres round, imported from a
  // hostile file, has a site span to match, and a 460 m view over it would be
  // tens of thousands of sites a frame — every one of them the same few,
  // placed again on top of themselves.
  const last = Math.min(Math.floor((toMetres + reach) / span), first + sites + 1);
  for (let index = first; index <= last; index += 1) {
    const site = siteAt(profile, seed, index);
    // #1546: where map data was read, the data decides, not the seed.
    if (site === undefined || siteOnMappedLand(profile, origin, site, land)) continue;
    const { centre, half, side } = site;
    const admit = (item: ScatterItem | undefined, along: number): void => {
      if (item !== undefined && along >= fromMetres && along < toMetres) found.push(item);
    };
    if (site.kind === 'village') {
      villages.push([centre - half - PLOT_METRES, centre + half + PLOT_METRES]);
      for (const plot of everyVillagePlot(seed, site)) {
        // #1534: the plot is the village's ground whether or not it is built
        // on — an empty plot is a garden or a green, not a wood.
        pushFootprint(
          profile,
          origin,
          footprints,
          plot.kind,
          plot.along,
          plot.lateral,
          plot.side,
          PLOT_METRES / 2,
        );
        if (!plot.built) continue;
        admit(
          standing(
            profile,
            origin,
            seed,
            plot.kind,
            plot.along,
            plot.lateral * plot.side,
            plot.variant,
            'road',
          ),
          plot.along,
        );
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
      const base = slotHash(seed, site.wrappedSite, SITE_KEY);
      const [near, far] = FARM_SETBACK_METRES;
      const layout: readonly (readonly [StructureKind, number, number])[] = [
        ['building', 0, near],
        ['barn', 17, far],
        ['shed', -15, far - 2],
      ];
      for (const [building, offset, lateral] of layout) {
        const along = centre + offset;
        pushFootprint(profile, origin, footprints, building, along, lateral, side, 0);
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
  land: LandClassMask,
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
        // #1546: no boundary across built-up land, water, a wood or a park.
        if (item !== undefined && fieldGround(land, item.x, item.z)) found.push({ item, along });
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
        const x = frame.x + frame.normalX * lateral * side;
        const z = frame.z + frame.normalZ * lateral * side;
        if (!fieldGround(land, x, z)) continue;
        found.push({
          item: {
            kind,
            x,
            y: terrainHeightAt(profile, origin, seed, wrapped, lateral * side),
            z,
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

/**
 * How far past a settlement's buildings its cleared ground reaches, in metres:
 * **6** — a back garden, and a broadleaf's crown kept off the eaves. #1534.
 */
export const SETTLEMENT_MARGIN_METRES = 6;

/**
 * One piece of a settlement's ground, cleared of trees, shrubs and rocks —
 * #1534. A rectangle in plan, square to the drawn road at {@link along}: from
 * the road's centreline out to {@link depth} on one side, and {@link half}
 * either way along it.
 *
 * A village is one piece per plot per side, built on or not, each reaching
 * {@link SETTLEMENT_MARGIN_METRES} past the back of the building that plot
 * holds or would hold and overlapping its neighbours by the same, so a gentle
 * bend leaves no wedge between two; a farmstead is one piece per building. So
 * a settlement's footprint is its buildings, their gardens, and the ground
 * between them and the road — the front gardens and, once #1535 lays them,
 * the pavements.
 *
 * ⚠️ **Until #1534 nothing cleared this ground**: {@link clearOfBuildings}
 * holds a tree {@link BUILDING_CLEARANCE_METRES} from a building's middle, and
 * that left the front gardens, the empty plots and a church's or a row of
 * shops' far end free to stand in.
 */
export interface SettlementFootprint {
  /** The odometer reading, unwrapped, the piece is square to. */
  readonly along: number;
  /** The drawn road's centreline there, local metres. */
  readonly x: number;
  readonly z: number;
  /** Unit, the way the road runs there. */
  readonly alongX: number;
  readonly alongZ: number;
  /** Unit, across the road towards the piece's side. */
  readonly acrossX: number;
  readonly acrossZ: number;
  /** How far either way along the road it reaches, metres. */
  readonly half: number;
  /** How far out from the centreline it reaches, metres. */
  readonly depth: number;
}

/** The piece of ground one plot or building takes. @see SettlementFootprint */
function pushFootprint(
  profile: RouteProfile,
  origin: CorridorOrigin,
  footprints: SettlementFootprint[] | undefined,
  kind: StructureKind,
  along: number,
  lateral: number,
  side: number,
  leastHalf: number,
): void {
  if (footprints === undefined) return;
  const frame = frameAt(profile, origin, distanceOnRoute(profile, along));
  if (frame === undefined) return;
  // A building faces the road, so its own `x` runs along it and its `back`
  // reaches away from it.
  const shape = STRUCTURE_FOOTPRINTS[kind];
  footprints.push({
    along,
    x: frame.x,
    z: frame.z,
    alongX: frame.normalZ,
    alongZ: -frame.normalX,
    acrossX: frame.normalX * side,
    acrossZ: frame.normalZ * side,
    half: Math.max(shape.x, leastHalf) + SETTLEMENT_MARGIN_METRES,
    depth: lateral - shape.back + SETTLEMENT_MARGIN_METRES,
  });
}

/** Whether a point in plan stands on a piece of a settlement's ground. */
export function onSettlementGround(
  point: { readonly x: number; readonly z: number },
  footprint: SettlementFootprint,
): boolean {
  const dx = point.x - footprint.x;
  const dz = point.z - footprint.z;
  const along = dx * footprint.alongX + dz * footprint.alongZ;
  const across = dx * footprint.acrossX + dz * footprint.acrossZ;
  return Math.abs(along) <= footprint.half && across >= 0 && across <= footprint.depth;
}

/**
 * The kinds a settlement's ground is cleared of — #1534: everything the
 * realistic world's vegetation belt draws. A post marks a tight bend, which a
 * village may stand on, so it stays.
 */
const CLEARED: ReadonlySet<string> = new Set(['tree-broadleaf', 'tree-conifer', 'shrub', 'rock']);

/**
 * The natural scenery, less every tree, shrub and rock standing on a
 * settlement's ground — #1534 — or, since #1546, on mapped built-up land or
 * water. Pure, and a function of positions only.
 */
export function clearOfSettlements(
  natural: readonly ScatterItem[],
  footprints: readonly SettlementFootprint[],
  land: LandClassMask = NO_LAND_CLASS,
): readonly ScatterItem[] {
  if (footprints.length === 0 && land.bytes === 0) return natural;
  return natural.filter(
    (item) =>
      !CLEARED.has(item.kind) ||
      !(
        builtUpOrWater(land, item.x, item.z) ||
        footprints.some((piece) => onSettlementGround(item, piece))
      ),
  );
}

/**
 * Every piece of settlement ground {@link structuresAt} visits between two
 * odometer readings — for the browser gate's probe, which holds what the
 * realistic world drew against it. @see SettlementFootprint
 *
 * @unwired reached only from the browser gate's harness and the tests; the
 * scene takes the same pieces from `structuresAt`'s `footprints`, in the one
 * pass that places the buildings.
 */
export function settlementFootprintsAt(
  profile: RouteProfile,
  origin: CorridorOrigin,
  seed: number,
  fromMetres: number,
  toMetres: number,
): readonly SettlementFootprint[] {
  const footprints: SettlementFootprint[] = [];
  settlementsAt(profile, origin, seed, fromMetres, toMetres, [], [], footprints, NO_LAND_CLASS);
  return footprints;
}
