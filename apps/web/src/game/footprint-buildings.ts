// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A mapped building, planned from its footprint — #1540, ADR 0054 D-5 and D-7.
 *
 * For every footprint in the ride's corridor (`world-data/corridor.ts`, #1539)
 * that passes the placement rules, a plan: walls extruded from the footprint,
 * a plinth that meets the drawn ground, a roof, a door on the wall nearest the
 * road, and the surfaces they wear — triangles by role, the same kind of thing
 * `buildings.ts` §`BuildingPlan` is, naming no rendering library. A footprint
 * is unique, so unlike `buildings.ts`' kinds it cannot be instanced: #1549
 * merges these plans per surface and draws them, and this file only makes them.
 *
 * Plans are built **once, at ride start**, never per frame.
 *
 * @unwired #1549 draws these plans; until it lands no module of the ride reads them, and #1549 removes this tag.
 *
 * ## The placement rules (#1538's P-9), in order
 *
 * The first a footprint fails is its verdict, and every verdict is counted
 * ({@link FootprintVerdicts}) so a review sees what the rules drop:
 *
 * 1. **Kind.** `building` and `building_part`; a `building_part` with a
 *    `min_height` stands on that height and has no plinth.
 * 2. **Land** (#1546): any of the centroid and the footprint's vertices on a
 *    mapped wood, water or park, and it is dropped — `on-excluded-land`. A
 *    building inside a mapped park is dropped deliberately: the owner's rule
 *    (ADR 0054 D-5.2) is categorical, and D-5.2's one possible exception is
 *    not taken.
 * 3. **The road** (D-5.4): any edge within `landform.ts`
 *    §`ROAD_CLEARANCE_METRES` of ANY stretch of the drawn road, and it is
 *    dropped — `on-road`. The `settlements.ts` §`footprintClearance` measure,
 *    generalised to a polygon: on a hairpin a footprint beside one leg may
 *    reach the other, which is #468's defect.
 * 4. **The ground**: the plinth runs from the lowest drawn ground under the
 *    footprint (`landform.ts` §`terrainHeightAt` at every vertex and the
 *    centroid, the surface the renderer's ground is built from) less
 *    `buildings.ts` §`FOUNDATION_METRES`. Ground that varies by more than
 *    {@link FOOTPRINT_MAX_GROUND_RANGE_METRES} under it — after #1547 has
 *    levelled built-up land — and it is dropped: `too-steep`.
 * 5. **Size**: under {@link FOOTPRINT_MIN_AREA} m², a shed the map drew, is
 *    `too-small`; over {@link FOOTPRINT_MAX_AREA} m² is `too-large`.
 * 6. **Simplified** to at most {@link FOOTPRINT_MAX_VERTICES} outer vertices
 *    (`simplifyRing`, {@link FOOTPRINT_SIMPLIFY_METRES} and raised until it
 *    fits). Its holes are kept if the plan still fits its budget, and filled
 *    otherwise. ⚠️ The simplified ring is what rules 3 and 4 measure, since it
 *    is what is drawn; rule 2 reads every vertex of the ring as mapped.
 *
 * ## The shape (P-10, P-11; the owner's ruling of 2026-10-21 on #1540)
 *
 * Storeys are the mapped `height` over {@link STOREY_METRES}, rounded, and at
 * least one; two where the height is missing. The eaves stand at the mapped
 * height where there is one and at the storeys' where there is not. The roof
 * is a gable along the long axis of the footprint's minimum-area rectangle
 * where the footprint is small, rectangular, low and residential or farmland
 * ({@link FOOTPRINT_GABLE_MAX_AREA}, {@link FOOTPRINT_GABLE_MIN_RECTANGULARITY},
 * {@link FOOTPRINT_GABLE_MAX_EAVES_METRES}), and flat behind a
 * {@link PARAPET_METRES} parapet otherwise. **No windows are cut**: a
 * footprint can have forty walls, and the openings `buildings.ts` cuts would
 * not fit in {@link FOOTPRINT_MAX_TRIANGLES}. The facade wears a storey-high
 * window texture instead, laid one repeat a storey by one a bay
 * ({@link BAY_METRES}).
 *
 * ## The surfaces
 *
 * By the land use under the centroid ({@link FootprintUse}, from `land-class.ts`
 * §`kindAt`), with #1548's town surfaces (`render`, `concrete`, `flat-roof`) in
 * the places #1548 named: {@link wallSurfaceOf}, {@link roofSurfaceOf}.
 *
 * ## Bounded
 *
 * The plans are bounded by the corridor's buildings, which #1544 bounds at
 * 60 000 a corridor, and each plan by {@link FOOTPRINT_MAX_TRIANGLES}. No
 * coordinate is formatted into any string here.
 */

import type { RouteProfile } from '@onyourleft/domain';
import {
  simplifyRing,
  triangulate,
  type BuildingFeature,
  type Ring,
} from '@onyourleft/map-features';

import { DOOR, FOUNDATION_METRES, PLINTH_TOP_METRES } from './buildings';
import { MASONRY_TINT, packedInstanceTint } from './instance-tint';
import { kindAt, type LandClass, type LandClassMask } from './land-class';
import { ROAD_CLEARANCE_METRES, terrainHeightAt } from './landform';
import { REALISTIC_TRIANGLES } from './realistic-budget';
import type { StructureSurface } from './realistic-assets';
import {
  nearestOnRoadSegments,
  roadSegmentsNear,
  squaredToSegment,
  type BesideTheRoad,
  type DrawnRoadPoints,
} from './road-grid';
import { scatterSeed } from './scatter';
import { slotHash, uniformFrom } from './seeded';
import type { CorridorOrigin } from './terrain';
import type { WorldCorridor } from './world-data/corridor';

/** What became of a footprint: planned, or the rule that dropped it. */
export type FootprintVerdict =
  'kept' | 'on-excluded-land' | 'on-road' | 'too-steep' | 'too-small' | 'too-large';

/** Every verdict, in the rules' order. */
export const FOOTPRINT_VERDICTS: readonly FootprintVerdict[] = [
  'kept',
  'on-excluded-land',
  'on-road',
  'too-steep',
  'too-small',
  'too-large',
];

/** How many footprints came to each verdict. */
export type FootprintVerdicts = Readonly<Record<FootprintVerdict, number>>;

/** The parts a plan's triangles are made of — #1549 dresses each by its surface. */
export type FootprintRole = 'wall' | 'plinth' | 'roof' | 'parapet' | 'door';

/** Every {@link FootprintRole}, in a fixed order. */
export const FOOTPRINT_ROLES: readonly FootprintRole[] = [
  'wall',
  'plinth',
  'roof',
  'parapet',
  'door',
];

/**
 * How many floats one vertex of a plan's triangles is: **8** — position
 * (three), normal (three) and texture coordinate (two), in that order. Three
 * vertices a triangle and no index: the triangles are appended into #1549's
 * merged buffers, whose indices are theirs to write.
 */
export const FOOTPRINT_VERTEX_FLOATS = 8;

/** One mapped building, planned. */
export interface FootprintPlan {
  /** The footprint's centroid, in local metres: what #1549's index is keyed by. */
  readonly centroid: { readonly x: number; readonly z: number };
  /** Metres, local: the plinth's foot — or, for a part on a `min_height`, its base. */
  readonly base: number;
  readonly storeys: number;
  readonly roof: 'gable' | 'flat';
  readonly surfaces: { readonly wall: StructureSurface; readonly roof: StructureSurface };
  /** `instance-tint.ts`' seeded tint, packed, keyed by the centroid (#621). */
  readonly tint: number;
  /**
   * Each role's triangles, {@link FOOTPRINT_VERTEX_FLOATS} floats a vertex in
   * local metres, wound counter-clockwise seen from the side the normal faces.
   */
  readonly triangles: Readonly<Record<FootprintRole, Float32Array>>;
  /** ≤ {@link FOOTPRINT_MAX_TRIANGLES}. */
  readonly triangleCount: number;
  /** Walls and roof only — #1549's far level, ≤ {@link FOOTPRINT_MAX_FAR_TRIANGLES}. */
  readonly farTriangleCount: number;
}

/** A storey, in metres: **3.0** (P-10, the owner's ruling of 2026-10-21). */
export const STOREY_METRES = 3;

/**
 * One bay of the facade texture, in metres: **3.6** — one repeat across.
 * Written as a fraction because `3.6` is also the m/s-to-km/h factor that
 * `units/no-inline-units.ts` keeps out of the client, and this is a length.
 */
export const BAY_METRES = 36 / 10;

/** The storeys a building with no mapped height has: **2**. */
export const DEFAULT_STOREYS = 2;

/** The most outer vertices a planned footprint keeps: **48**. */
export const FOOTPRINT_MAX_VERTICES = 48;

/** `simplifyRing`'s tolerance before it is raised to fit: **0.5 m**. */
export const FOOTPRINT_SIMPLIFY_METRES = 0.5;

/** Below this many square metres a footprint is `too-small`: **12**. */
export const FOOTPRINT_MIN_AREA = 12;

/** Above this many square metres it is `too-large`: **20 000**, out of frame anyway. */
export const FOOTPRINT_MAX_AREA = 20_000;

/** The most the drawn ground may vary under a footprint: **2.5 m**. */
export const FOOTPRINT_MAX_GROUND_RANGE_METRES = 2.5;

/** The most triangles a plan is: `realistic-budget.ts` §`REALISTIC_TRIANGLES.structure`, **640**. */
export const FOOTPRINT_MAX_TRIANGLES = REALISTIC_TRIANGLES.structure;

/** The most triangles a plan's far level is — its walls and roof: **200**. */
export const FOOTPRINT_MAX_FAR_TRIANGLES = 200;

/** A flat roof's parapet, above the eaves: **0.5 m**. */
export const PARAPET_METRES = 0.5;

/** A gable only on a footprint of at most this many square metres: **300**. */
export const FOOTPRINT_GABLE_MAX_AREA = 300;

/** A gable only on a footprint at least this much of its minimum-area rectangle: **0.85**. */
export const FOOTPRINT_GABLE_MIN_RECTANGULARITY = 0.85;

/** A gable only under eaves at most this high: **12 m**. */
export const FOOTPRINT_GABLE_MAX_EAVES_METRES = 12;

/** A gable's pitch: **35°**, this repository's own, near `buildings.ts`' houses. */
export const GABLE_PITCH_DEGREES = 35;

/** Over this many storeys a building wears `concrete`: **5** (#1548, was `stone`). */
export const TOWER_STOREYS = 5;

/** The share of residential buildings in `brick` rather than `render`: **0.6**. */
export const BRICK_SHARE = 0.6;

/** How far a door stands proud of its wall: **2 cm**, so it never fights the facade's depth. */
const DOOR_PROUD_METRES = 0.02;

/** What a footprint's land is used for, as its surfaces and its roof read it. */
export type FootprintUse = 'residential' | 'commercial' | 'industrial' | 'farmland';

/** The kinds that are industrial — #1540's table: industrial and railway, and military land. */
const INDUSTRIAL_KINDS = new Set(['industrial', 'railway', 'military']);

/** The kinds that are residential; every other built-up kind is commercial. */
const RESIDENTIAL_KINDS = new Set(['residential', 'neighbourhood']);

/**
 * What the land under a footprint is used for. Farmland by class; built-up by
 * its `kind` — residential and neighbourhood land residential, industrial,
 * railway and military land industrial, and every other built-up kind (retail,
 * a school, a hospital) commercial. ⚠️ A footprint on land the map classes as
 * neither — `other`, or `unknown` where no tile was read — is residential:
 * most buildings are houses, and a mapped house on unmapped land is still one.
 */
export function footprintUse(landClass: LandClass, kind: string | undefined): FootprintUse {
  if (landClass === 'farmland') return 'farmland';
  if (landClass !== 'built-up' || kind === undefined) return 'residential';
  if (RESIDENTIAL_KINDS.has(kind)) return 'residential';
  if (INDUSTRIAL_KINDS.has(kind)) return 'industrial';
  return 'commercial';
}

/**
 * A plan's walls' surface — #1540's table with #1548's swap. Over
 * {@link TOWER_STOREYS} `concrete`; residential `brick` or `render` by a
 * seeded {@link BRICK_SHARE}; commercial `render`; industrial `corrugated`;
 * farmland `planks` under a flat roof (a barn) and `brick` under a gable.
 * `share` is the footprint's seeded draw in `[0, 1)`.
 */
export function wallSurfaceOf(
  use: FootprintUse,
  storeys: number,
  roof: 'gable' | 'flat',
  share: number,
): StructureSurface {
  if (storeys > TOWER_STOREYS) return 'concrete';
  switch (use) {
    case 'residential':
      return share < BRICK_SHARE ? 'brick' : 'render';
    case 'commercial':
      return 'render';
    case 'industrial':
      return 'corrugated';
    case 'farmland':
      return roof === 'flat' ? 'planks' : 'brick';
  }
}

/** A plan's roof's surface: `roof-tiles` or `slate` on a gable, by a seeded half; `flat-roof` (#1548) on a flat one. */
export function roofSurfaceOf(roof: 'gable' | 'flat', share: number): StructureSurface {
  if (roof === 'flat') return 'flat-roof';
  return share < 0.5 ? 'roof-tiles' : 'slate';
}

/**
 * Every surface a plan can wear — the range of {@link wallSurfaceOf} and
 * {@link roofSurfaceOf}.
 *
 * @test-facing held by `realistic-renderer.test.ts` §"has no surface nothing wears", where #1548's town surfaces are worn by these plans and so need no exception.
 */
export const FOOTPRINT_SURFACES: readonly StructureSurface[] = [
  'brick',
  'render',
  'concrete',
  'corrugated',
  'planks',
  'roof-tiles',
  'slate',
  'flat-roof',
];

/** The seeded streams a footprint draws from. */
const STREAM_WALL = 0;
const STREAM_ROOF = 1;

/** The key under which {@link slotHash} hashes footprints, apart from every other placement. */
const FOOTPRINT_KEY = 0x15_40;

/** A seeded draw in `[0, 1)` for a footprint, keyed by its centroid to the decimetre. */
function footprintShare(seed: number, x: number, z: number, stream: number): number {
  const cell = Math.imul(Math.round(x * 10), 0x9e37_79b1) ^ Math.round(z * 10);
  return uniformFrom(slotHash(seed, cell, FOOTPRINT_KEY), stream);
}

/** The signed area of a ring, positive counter-clockwise in `(x, z)`. */
function signedArea(ring: Ring): number {
  const n = ring.length / 2;
  let twice = 0;
  for (let i = 0, j = n - 1; i < n; j = i, i += 1) {
    twice +=
      (ring[j * 2] as number) * (ring[i * 2 + 1] as number) -
      (ring[i * 2] as number) * (ring[j * 2 + 1] as number);
  }
  return twice / 2;
}

/** The area centroid of a ring; its vertices' mean where it has no area. */
function centroidOf(ring: Ring): { readonly x: number; readonly z: number } {
  const n = ring.length / 2;
  let twice = 0;
  let cx = 0;
  let cz = 0;
  let mx = 0;
  let mz = 0;
  for (let i = 0, j = n - 1; i < n; j = i, i += 1) {
    const xj = ring[j * 2] as number;
    const zj = ring[j * 2 + 1] as number;
    const xi = ring[i * 2] as number;
    const zi = ring[i * 2 + 1] as number;
    const cross = xj * zi - xi * zj;
    twice += cross;
    cx += (xj + xi) * cross;
    cz += (zj + zi) * cross;
    mx += xi;
    mz += zi;
  }
  if (Math.abs(twice) < 1e-9) return { x: mx / n, z: mz / n };
  return { x: cx / (3 * twice), z: cz / (3 * twice) };
}

/** The footprint's area: its outer ring less its holes. */
function footprintArea(rings: readonly Ring[]): number {
  let area = 0;
  rings.forEach((ring, index) => {
    area += index === 0 ? Math.abs(signedArea(ring)) : -Math.abs(signedArea(ring));
  });
  return Math.max(0, area);
}

/** Whether `(x, z)` is inside a ring, by crossings. */
function insideRing(ring: Ring, x: number, z: number): boolean {
  const n = ring.length / 2;
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i, i += 1) {
    const xi = ring[i * 2] as number;
    const zi = ring[i * 2 + 1] as number;
    const xj = ring[j * 2] as number;
    const zj = ring[j * 2 + 1] as number;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** Whether two segments cross or touch. */
function segmentsMeet(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  cx: number,
  cz: number,
  dx: number,
  dz: number,
): boolean {
  const side = (px: number, pz: number, qx: number, qz: number, rx: number, rz: number): number =>
    Math.sign((qx - px) * (rz - pz) - (qz - pz) * (rx - px));
  return (
    side(ax, az, bx, bz, cx, cz) * side(ax, az, bx, bz, dx, dz) <= 0 &&
    side(cx, cz, dx, dz, ax, az) * side(cx, cz, dx, dz, bx, bz) <= 0
  );
}

/** The squared distance between two segments. */
function segmentToSegmentSquared(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  cx: number,
  cz: number,
  dx: number,
  dz: number,
): number {
  if (segmentsMeet(ax, az, bx, bz, cx, cz, dx, dz)) return 0;
  const abx = bx - ax;
  const abz = bz - az;
  const cdx = dx - cx;
  const cdz = dz - cz;
  return Math.min(
    squaredToSegment(cx, cz, ax, az, abx, abz, abx * abx + abz * abz),
    squaredToSegment(dx, dz, ax, az, abx, abz, abx * abx + abz * abz),
    squaredToSegment(ax, az, cx, cz, cdx, cdz, cdx * cdx + cdz * cdz),
    squaredToSegment(bx, bz, cx, cz, cdx, cdz, cdx * cdx + cdz * cdz),
  );
}

/**
 * How near the ring comes to any of the road's `segments`, in metres: 0 where
 * a segment crosses it or lies inside it.
 */
function ringToRoad(ring: Ring, road: DrawnRoadPoints, segments: readonly number[]): number {
  const n = ring.length / 2;
  const points = road.points;
  let least = Number.POSITIVE_INFINITY;
  for (const segment of segments) {
    const ax = points[segment * 2] as number;
    const az = points[segment * 2 + 1] as number;
    const bx = points[segment * 2 + 2] as number;
    const bz = points[segment * 2 + 3] as number;
    if (insideRing(ring, ax, az)) return 0;
    for (let i = 0, j = n - 1; i < n; j = i, i += 1) {
      least = Math.min(
        least,
        segmentToSegmentSquared(
          ring[j * 2] as number,
          ring[j * 2 + 1] as number,
          ring[i * 2] as number,
          ring[i * 2 + 1] as number,
          ax,
          az,
          bx,
          bz,
        ),
      );
    }
  }
  return Math.sqrt(least);
}

/** The farthest any vertex of `ring` is from `(x, z)`. */
function radiusAbout(ring: Ring, x: number, z: number): number {
  let most = 0;
  for (let i = 0; i + 1 < ring.length; i += 2) {
    most = Math.max(most, Math.hypot((ring[i] as number) - x, (ring[i + 1] as number) - z));
  }
  return most;
}

/** The convex hull of a ring's vertices, counter-clockwise, as pairs. */
function convexHull(ring: Ring): [number, number][] {
  const points: [number, number][] = [];
  for (let i = 0; i + 1 < ring.length; i += 2) {
    points.push([ring[i] as number, ring[i + 1] as number]);
  }
  points.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: [number, number], a: [number, number], b: [number, number]): number =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: [number, number][] = [];
  for (const point of points) {
    while (
      lower.length >= 2 &&
      cross(
        lower[lower.length - 2] as [number, number],
        lower[lower.length - 1] as [number, number],
        point,
      ) <= 0
    ) {
      lower.pop();
    }
    lower.push(point);
  }
  const upper: [number, number][] = [];
  for (let i = points.length - 1; i >= 0; i -= 1) {
    const point = points[i] as [number, number];
    while (
      upper.length >= 2 &&
      cross(
        upper[upper.length - 2] as [number, number],
        upper[upper.length - 1] as [number, number],
        point,
      ) <= 0
    ) {
      upper.pop();
    }
    upper.push(point);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/** A rectangle: its centre, its long axis (unit) and its half-lengths along and across it. */
interface Rectangle {
  readonly cx: number;
  readonly cz: number;
  readonly ux: number;
  readonly uz: number;
  readonly halfLong: number;
  readonly halfShort: number;
}

/**
 * The minimum-area rectangle around a ring — by its hull's edges, one of
 * which a minimum-area rectangle always has a side along — with its long axis
 * named. #1540's roof rule reads its area and its long side.
 */
export function minimumAreaRectangle(ring: Ring): Rectangle & { readonly area: number } {
  const hull = convexHull(ring);
  let best: (Rectangle & { readonly area: number }) | undefined;
  for (let i = 0; i < hull.length; i += 1) {
    const [ax, az] = hull[i] as [number, number];
    const [bx, bz] = hull[(i + 1) % hull.length] as [number, number];
    const length = Math.hypot(bx - ax, bz - az);
    if (!(length > 0)) continue;
    const ex = (bx - ax) / length;
    const ez = (bz - az) / length;
    let minE = Number.POSITIVE_INFINITY;
    let maxE = Number.NEGATIVE_INFINITY;
    let minN = Number.POSITIVE_INFINITY;
    let maxN = Number.NEGATIVE_INFINITY;
    for (const [x, z] of hull) {
      const e = (x - ax) * ex + (z - az) * ez;
      const n = -(x - ax) * ez + (z - az) * ex;
      minE = Math.min(minE, e);
      maxE = Math.max(maxE, e);
      minN = Math.min(minN, n);
      maxN = Math.max(maxN, n);
    }
    const area = (maxE - minE) * (maxN - minN);
    if (best !== undefined && area >= best.area) continue;
    const midE = (minE + maxE) / 2;
    const midN = (minN + maxN) / 2;
    const cx = ax + ex * midE - ez * midN;
    const cz = az + ez * midE + ex * midN;
    const alongE = (maxE - minE) / 2;
    const alongN = (maxN - minN) / 2;
    best =
      alongE >= alongN
        ? { cx, cz, ux: ex, uz: ez, halfLong: alongE, halfShort: alongN, area }
        : { cx, cz, ux: -ez, uz: ex, halfLong: alongN, halfShort: alongE, area };
  }
  return best ?? { cx: 0, cz: 0, ux: 1, uz: 0, halfLong: 0, halfShort: 0, area: 0 };
}

/** The storeys for a mapped height, or {@link DEFAULT_STOREYS} for none: never 0. */
export function storeysFor(heightMetres: number | null): number {
  if (heightMetres === null || !Number.isFinite(heightMetres)) return DEFAULT_STOREYS;
  return Math.max(1, Math.round(heightMetres / STOREY_METRES));
}

/** A role's triangles while a plan is built: eight numbers a vertex. */
type Writing = Record<FootprintRole, number[]>;

type Vec = readonly [number, number, number];

/** One triangle into `into`, wound counter-clockwise seen from `normal`'s side. */
function triangle(
  into: number[],
  a: Vec,
  b: Vec,
  c: Vec,
  normal: Vec,
  uvA: readonly [number, number],
  uvB: readonly [number, number],
  uvC: readonly [number, number],
): void {
  const ux = b[0] - a[0];
  const uy = b[1] - a[1];
  const uz = b[2] - a[2];
  const vx = c[0] - a[0];
  const vy = c[1] - a[1];
  const vz = c[2] - a[2];
  const facing =
    (uy * vz - uz * vy) * normal[0] +
    (uz * vx - ux * vz) * normal[1] +
    (ux * vy - uy * vx) * normal[2];
  const corners = facing >= 0 ? [a, b, c] : [a, c, b];
  const uvs = facing >= 0 ? [uvA, uvB, uvC] : [uvA, uvC, uvB];
  for (let corner = 0; corner < 3; corner += 1) {
    const p = corners[corner] as Vec;
    const uv = uvs[corner] as readonly [number, number];
    into.push(p[0], p[1], p[2], normal[0], normal[1], normal[2], uv[0], uv[1]);
  }
}

/** A quad `a b c d` (in order round it) as two triangles facing `normal`. */
function quad(
  into: number[],
  a: Vec,
  b: Vec,
  c: Vec,
  d: Vec,
  normal: Vec,
  uv: readonly (readonly [number, number])[],
): void {
  triangle(
    into,
    a,
    b,
    c,
    normal,
    uv[0] as [number, number],
    uv[1] as [number, number],
    uv[2] as [number, number],
  );
  triangle(
    into,
    a,
    c,
    d,
    normal,
    uv[0] as [number, number],
    uv[2] as [number, number],
    uv[3] as [number, number],
  );
}

/**
 * Upright quads round each ring from `bottom` to `top`, facing away from the
 * building's material — out of the outer ring, into each hole — and, with
 * `inside`, a second face the other way (a parapet's back). `u` runs round
 * the ring in bays and `v` up it in storeys from `from`.
 */
function ringWalls(
  into: number[],
  rings: readonly Ring[],
  bottom: number,
  top: number,
  from: number,
  inside = false,
): void {
  rings.forEach((ring, index) => {
    const n = ring.length / 2;
    const counter = signedArea(ring) > 0;
    // Out of the outer ring is `(dz, −dx)` of a counter-clockwise edge; a
    // hole's walls face into the hole, which is the other way round it.
    const outward = (index === 0) === counter ? 1 : -1;
    let round = 0;
    for (let i = 0; i < n; i += 1) {
      const j = (i + 1) % n;
      const ax = ring[i * 2] as number;
      const az = ring[i * 2 + 1] as number;
      const bx = ring[j * 2] as number;
      const bz = ring[j * 2 + 1] as number;
      const length = Math.hypot(bx - ax, bz - az);
      if (!(length > 1e-6)) continue;
      const normal: Vec = [((bz - az) / length) * outward, 0, (-(bx - ax) / length) * outward];
      const u0 = round / BAY_METRES;
      const u1 = (round + length) / BAY_METRES;
      const v0 = (bottom - from) / STOREY_METRES;
      const v1 = (top - from) / STOREY_METRES;
      const corners: Vec[] = [
        [ax, bottom, az],
        [bx, bottom, bz],
        [bx, top, bz],
        [ax, top, az],
      ];
      const uv: [number, number][] = [
        [u0, v0],
        [u1, v0],
        [u1, v1],
        [u0, v1],
      ];
      quad(
        into,
        corners[0] as Vec,
        corners[1] as Vec,
        corners[2] as Vec,
        corners[3] as Vec,
        normal,
        uv,
      );
      if (inside) {
        const back: Vec = [-normal[0], 0, -normal[2]];
        quad(
          into,
          corners[0] as Vec,
          corners[1] as Vec,
          corners[2] as Vec,
          corners[3] as Vec,
          back,
          uv,
        );
      }
      round += length;
    }
  });
}

/** A flat roof over the rings at `height`, facing up, `u, v` in storeys of plan. */
function flatRoof(into: number[], rings: readonly Ring[], height: number): void {
  const indices = triangulate({ rings });
  const flat: number[] = [];
  for (const ring of rings) for (const each of ring) flat.push(each);
  const up: Vec = [0, 1, 0];
  const at = (index: number): Vec => [
    flat[index * 2] as number,
    height,
    flat[index * 2 + 1] as number,
  ];
  const uv = (index: number): [number, number] => [
    (flat[index * 2] as number) / STOREY_METRES,
    (flat[index * 2 + 1] as number) / STOREY_METRES,
  ];
  for (let i = 0; i + 2 < indices.length; i += 3) {
    const a = indices[i] as number;
    const b = indices[i + 1] as number;
    const c = indices[i + 2] as number;
    triangle(into, at(a), at(b), at(c), up, uv(a), uv(b), uv(c));
  }
}

/**
 * A gable over the minimum-area rectangle, its ridge along the long axis: two
 * slopes (`roof`) and two gable ends (`wall`), from the eaves at `eaves`.
 */
function gableRoof(writing: Writing, rectangle: Rectangle, eaves: number, floor: number): void {
  const { cx, cz, ux, uz, halfLong, halfShort } = rectangle;
  const vx = -uz;
  const vz = ux;
  const rise = halfShort * Math.tan((GABLE_PITCH_DEGREES * Math.PI) / 180);
  const corner = (along: number, across: number, y: number): Vec => [
    cx + ux * along + vx * across,
    y,
    cz + uz * along + vz * across,
  ];
  const ridgeTop = eaves + rise;
  const slope = Math.hypot(halfShort, rise);
  for (const side of [1, -1]) {
    // Out and up: across the slope, `rise` over `halfShort`.
    const normal: Vec = [(vx * side * rise) / slope, halfShort / slope, (vz * side * rise) / slope];
    quad(
      writing.roof,
      corner(-halfLong, halfShort * side, eaves),
      corner(halfLong, halfShort * side, eaves),
      corner(halfLong, 0, ridgeTop),
      corner(-halfLong, 0, ridgeTop),
      normal,
      [
        [-halfLong / STOREY_METRES, 0],
        [halfLong / STOREY_METRES, 0],
        [halfLong / STOREY_METRES, slope / STOREY_METRES],
        [-halfLong / STOREY_METRES, slope / STOREY_METRES],
      ],
    );
  }
  for (const end of [1, -1]) {
    const normal: Vec = [ux * end, 0, uz * end];
    triangle(
      writing.wall,
      corner(halfLong * end, halfShort, eaves),
      corner(halfLong * end, -halfShort, eaves),
      corner(halfLong * end, 0, ridgeTop),
      normal,
      [halfShort / BAY_METRES, (eaves - floor) / STOREY_METRES],
      [-halfShort / BAY_METRES, (eaves - floor) / STOREY_METRES],
      [0, (ridgeTop - floor) / STOREY_METRES],
    );
  }
}

/**
 * A door, `buildings.ts` §`DOOR`'s size, on the middle of the outer ring's
 * edge whose middle is nearest the road, standing on `floor`; none where no
 * edge is wide enough.
 */
function door(
  into: number[],
  ring: Ring,
  floor: number,
  road: DrawnRoadPoints,
  segments: readonly number[],
): void {
  const n = ring.length / 2;
  const outward = signedArea(ring) > 0 ? 1 : -1;
  const beside: BesideTheRoad = { along: 0, lateral: 0, distance: 0 };
  let best = -1;
  let nearest = Number.POSITIVE_INFINITY;
  for (let i = 0; i < n; i += 1) {
    const j = (i + 1) % n;
    const ax = ring[i * 2] as number;
    const az = ring[i * 2 + 1] as number;
    const bx = ring[j * 2] as number;
    const bz = ring[j * 2 + 1] as number;
    if (Math.hypot(bx - ax, bz - az) < DOOR.width + 0.4) continue;
    if (!nearestOnRoadSegments(road, segments, (ax + bx) / 2, (az + bz) / 2, beside)) continue;
    if (beside.distance < nearest) {
      nearest = beside.distance;
      best = i;
    }
  }
  if (best < 0) return;
  const j = (best + 1) % n;
  const ax = ring[best * 2] as number;
  const az = ring[best * 2 + 1] as number;
  const bx = ring[j * 2] as number;
  const bz = ring[j * 2 + 1] as number;
  const length = Math.hypot(bx - ax, bz - az);
  const ex = (bx - ax) / length;
  const ez = (bz - az) / length;
  const nx = ez * outward;
  const nz = -ex * outward;
  const mx = (ax + bx) / 2 + nx * DOOR_PROUD_METRES;
  const mz = (az + bz) / 2 + nz * DOOR_PROUD_METRES;
  const half = DOOR.width / 2;
  quad(
    into,
    [mx - ex * half, floor, mz - ez * half],
    [mx + ex * half, floor, mz + ez * half],
    [mx + ex * half, floor + DOOR.height, mz + ez * half],
    [mx - ex * half, floor + DOOR.height, mz - ez * half],
    [nx, 0, nz],
    [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ],
  );
}

/** How many triangles a role's floats are. */
function trianglesOf(floats: readonly number[]): number {
  return floats.length / (3 * FOOTPRINT_VERTEX_FLOATS);
}

/**
 * The reaches the nearest stretch of road is looked for within, doubling from
 * a cell of `road-grid.ts`' grid to past a tile's far corner: a search costs
 * its reach squared, and most footprints are near the road.
 */
const GROUND_REACHES = [32, 64, 128, 256, 512, 1_024, 2_560] as const;

/** Scratch: the road segments near the footprint being planned. */
const nearSegments: number[] = [];

/**
 * Every mapped footprint in the corridor, planned or dropped — #1540.
 *
 * `land` is the ride's land-class mask (#1546), built from the same corridor;
 * `NO_LAND_CLASS` reads every footprint as on unmapped land, which is rule 2
 * switched off. `maxVertices` is rule 6's cap, a parameter so the triangle
 * budget's control can lift it.
 */
export function footprintPlans(
  corridor: WorldCorridor,
  land: LandClassMask,
  profile: RouteProfile,
  origin: CorridorOrigin,
  maxVertices: number = FOOTPRINT_MAX_VERTICES,
): { readonly plans: readonly FootprintPlan[]; readonly verdicts: FootprintVerdicts } {
  const seed = scatterSeed(profile);
  const counts: Record<FootprintVerdict, number> = {
    kept: 0,
    'on-excluded-land': 0,
    'on-road': 0,
    'too-steep': 0,
    'too-small': 0,
    'too-large': 0,
  };
  const plans: FootprintPlan[] = [];
  for (const building of corridor.buildings) {
    const planned = planFootprint(building, corridor, land, profile, origin, seed, maxVertices);
    if (typeof planned === 'string') {
      counts[planned] += 1;
    } else {
      counts.kept += 1;
      plans.push(planned);
    }
  }
  return { plans, verdicts: counts };
}

/** One footprint: its plan, or the verdict that dropped it. */
function planFootprint(
  building: BuildingFeature,
  corridor: WorldCorridor,
  land: LandClassMask,
  profile: RouteProfile,
  origin: CorridorOrigin,
  seed: number,
  maxVertices: number,
): FootprintPlan | Exclude<FootprintVerdict, 'kept'> {
  const outer = building.rings[0];
  if (outer === undefined || outer.length < 6) return 'too-small';
  const centroid = centroidOf(outer);

  // 2. The land: the centroid and every vertex the map drew.
  const excluded = (x: number, z: number): boolean => {
    const here = land.classAt(x, z);
    return here === 'wood' || here === 'water' || here === 'park';
  };
  if (excluded(centroid.x, centroid.z)) return 'on-excluded-land';
  for (let i = 0; i + 1 < outer.length; i += 2) {
    if (excluded(outer[i] as number, outer[i + 1] as number)) return 'on-excluded-land';
  }

  // 6, ahead of its turn: the ring the rules below measure is the one drawn.
  const drawn = simplifyRing(outer, FOOTPRINT_SIMPLIFY_METRES, maxVertices);
  const radius = radiusAbout(drawn, centroid.x, centroid.z);

  // 3. The road: every stretch of it near enough to matter.
  let road = roadSegmentsNear(
    profile,
    origin,
    centroid.x,
    centroid.z,
    radius + ROAD_CLEARANCE_METRES,
    nearSegments,
  );
  if (nearSegments.length > 0 && ringToRoad(drawn, road, nearSegments) < ROAD_CLEARANCE_METRES) {
    return 'on-road';
  }

  // 4. The ground, beside the stretch of road each point is nearest. The
  // nearest stretch to any vertex is within the centroid's distance and twice
  // the radius of the centroid, so one list serves them all.
  const beside: BesideTheRoad = { along: 0, lateral: 0, distance: 0 };
  let found = false;
  for (const reach of GROUND_REACHES) {
    road = roadSegmentsNear(profile, origin, centroid.x, centroid.z, reach, nearSegments);
    // Every segment within `reach` was searched, so a nearest within it is the nearest.
    if (!nearestOnRoadSegments(road, nearSegments, centroid.x, centroid.z, beside)) continue;
    if (beside.distance > reach) continue;
    road = roadSegmentsNear(
      profile,
      origin,
      centroid.x,
      centroid.z,
      beside.distance + 2 * radius + 1,
      nearSegments,
    );
    found = true;
    break;
  }
  // Farther from the road than any tile of a corridor can be: no ground to stand on.
  if (!found) return 'too-steep';
  const groundAt = (x: number, z: number): number => {
    nearestOnRoadSegments(road, nearSegments, x, z, beside);
    return terrainHeightAt(profile, origin, seed, beside.along, beside.lateral, land);
  };
  let lowest = groundAt(centroid.x, centroid.z);
  let highest = lowest;
  for (let i = 0; i + 1 < drawn.length; i += 2) {
    const height = groundAt(drawn[i] as number, drawn[i + 1] as number);
    lowest = Math.min(lowest, height);
    highest = Math.max(highest, height);
  }
  if (highest - lowest > FOOTPRINT_MAX_GROUND_RANGE_METRES) return 'too-steep';

  // 5. The size, as mapped.
  const area = footprintArea(building.rings);
  if (area < FOOTPRINT_MIN_AREA) return 'too-small';
  if (area > FOOTPRINT_MAX_AREA) return 'too-large';

  // The shape.
  // Rule 1: only a `building_part` stands on its `min_height`.
  const raised = building.kind === 'building_part' ? building.minHeightMetres : null;
  const part = raised !== null;
  const minHeight = raised ?? 0;
  const span =
    building.heightMetres === null ? null : Math.max(0, building.heightMetres - minHeight);
  const storeys = storeysFor(span);
  const wallHeight = span !== null && span > 0 ? span : storeys * STOREY_METRES;
  const base = part ? lowest + minHeight : lowest - FOUNDATION_METRES;
  const floor = part ? base : highest + PLINTH_TOP_METRES;
  const eaves = floor + wallHeight;

  const landClass = land.classAt(centroid.x, centroid.z);
  const use = footprintUse(landClass, kindAt(corridor, centroid.x, centroid.z));
  const rectangle = minimumAreaRectangle(drawn);
  const rectangularity = rectangle.area > 0 ? Math.abs(signedArea(drawn)) / rectangle.area : 0;
  const roof: 'gable' | 'flat' =
    area <= FOOTPRINT_GABLE_MAX_AREA &&
    rectangularity >= FOOTPRINT_GABLE_MIN_RECTANGULARITY &&
    wallHeight <= FOOTPRINT_GABLE_MAX_EAVES_METRES &&
    (use === 'residential' || use === 'farmland')
      ? 'gable'
      : 'flat';

  const holes = building.rings
    .slice(1)
    .filter((hole) => hole.length >= 6)
    .map((hole) => simplifyRing(hole, FOOTPRINT_SIMPLIFY_METRES, maxVertices));
  const build = (withHoles: boolean): Writing => {
    const rings = withHoles ? [drawn, ...holes] : [drawn];
    const writing: Writing = { wall: [], plinth: [], roof: [], parapet: [], door: [] };
    if (!part) ringWalls(writing.plinth, rings, base, floor, floor);
    ringWalls(writing.wall, rings, floor, eaves, floor);
    if (roof === 'gable') {
      gableRoof(writing, rectangle, eaves, floor);
    } else {
      flatRoof(writing.roof, rings, eaves);
      ringWalls(writing.parapet, rings, eaves, eaves + PARAPET_METRES, floor, true);
    }
    if (!part) door(writing.door, drawn, floor, road, nearSegments);
    return writing;
  };
  const fits = (writing: Writing): boolean =>
    FOOTPRINT_ROLES.reduce((sum, role) => sum + trianglesOf(writing[role]), 0) <=
      FOOTPRINT_MAX_TRIANGLES &&
    trianglesOf(writing.wall) + trianglesOf(writing.roof) <= FOOTPRINT_MAX_FAR_TRIANGLES;
  let writing = build(holes.length > 0);
  if (holes.length > 0 && !fits(writing)) writing = build(false);

  const triangles = {
    wall: Float32Array.from(writing.wall),
    plinth: Float32Array.from(writing.plinth),
    roof: Float32Array.from(writing.roof),
    parapet: Float32Array.from(writing.parapet),
    door: Float32Array.from(writing.door),
  };
  const triangleCount = FOOTPRINT_ROLES.reduce((sum, role) => sum + trianglesOf(writing[role]), 0);
  return {
    centroid,
    base,
    storeys,
    roof,
    surfaces: {
      wall: wallSurfaceOf(
        use,
        storeys,
        roof,
        footprintShare(seed, centroid.x, centroid.z, STREAM_WALL),
      ),
      roof: roofSurfaceOf(roof, footprintShare(seed, centroid.x, centroid.z, STREAM_ROOF)),
    },
    tint: packedInstanceTint(centroid.x, centroid.z, MASONRY_TINT),
    triangles,
    triangleCount,
    farTriangleCount: trianglesOf(writing.wall) + trianglesOf(writing.roof),
  };
}
