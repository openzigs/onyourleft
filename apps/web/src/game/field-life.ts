// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Life in the fields — #3286: small herds of cows and sheep grazing on a
 * mapped `meadow` or `grassland`, and round bales on mapped `farmland` in late
 * summer and autumn. Until #3286 the corridor's fields were ground with
 * hedges, walls and fences round them and nothing standing in them.
 *
 * ⚠️ **Scenery, never an obstacle.** Nothing here is read by a simulation, a
 * score or the trainer: a piece is a place, a heading, a pose and a level of
 * detail, handed to the view (`port.ts` §`SceneFrame.fieldLife`) and drawn in
 * ONE call of its own (`three-renderer.ts` §`FieldLifeBelt`).
 *
 * ## Where a piece stands — mapped fields only
 *
 * The ground is cut into cells of a fixed size in the corridor's own metres
 * ({@link FIELD_HERD_CELL_METRES} for the herds, {@link FIELD_BALE_CELL_METRES}
 * for the bales), and each cell is hashed from the ride's seed and the cell:
 * whether it holds a herd (or a field of bales), where its middle is, which
 * animal, how many, and each one's place, heading and pose. So a place is the
 * same on every ask and every lap, whatever the window asked about.
 *
 * A cell's herd belongs to the mapped polygon its middle is in, and a member
 * stands only where all of these hold:
 *
 * - it and the four points {@link FIELD_LIFE_EDGE_METRES} from it along each
 *   axis are inside that same polygon — so it stands inside the field's
 *   boundary, never on the hedge or the wall that runs along its edge;
 * - the land mask says `farmland` there (`land-class.ts`), so a wood, a pond
 *   or a building mapped over the field outranks it;
 * - it is at least {@link FIELD_LIFE_ROAD_CLEAR_METRES} from the middle of
 *   any stretch of the ridden road, and {@link FIELD_LIFE_STREET_CLEAR_METRES}
 *   from every mapped street and path: never on a road or a verge;
 * - it keeps {@link FIELD_LIFE_SPACING_METRES} from every other piece of its
 *   cell.
 *
 * A corridor with no meadow, grassland or farmland has none, and a ride with
 * no corridor is never asked.
 *
 * ## Still, by the issue
 *
 * No walk cycle: an animal is grazing (head down), head up or lying, chosen
 * by its hash.
 *
 * ## The season is the view's
 *
 * Bales are planned whatever the date; the view draws them only while
 * {@link balesInSeason} says the route's own season (`season.ts`, told
 * through `port.ts` §`GameView.setSeason`) is late summer or autumn.
 */

import type { LandUseFeature, PathFeature, StreetFeature } from '@onyourleft/map-features';

import type { LandClassMask } from './land-class';
import type { Season } from './season';
import { mixInto, uniformFrom } from './seeded';

/** What stands in a field. */
export type FieldLifeKind = 'cow' | 'sheep' | 'bale';

/** How an animal stands: head down in the grass, head up, or lying. A bale is `lying`. */
export type FieldLifePose = 'grazing' | 'head-up' | 'lying';

/** Which of a piece's two shapes it is drawn as. A bale has one, at both. */
export type FieldLifeLevel = 'near' | 'far';

/** One piece of field life, in the corridor's local metres. */
export interface FieldLife {
  readonly kind: FieldLifeKind;
  readonly pose: FieldLifePose;
  readonly x: number;
  /** The drawn ground under its middle. */
  readonly y: number;
  readonly z: number;
  /** three's yaw: its nose points along `(sin heading, cos heading)` in `x, z`. */
  readonly heading: number;
  readonly level: FieldLifeLevel;
  /** Its hash: which coat it wears. @see fieldLifeLook */
  readonly look: number;
}

/** The field life a frame carries: the animals, nearest the rider first, then the bales. */
export interface FieldLifeInView {
  readonly pieces: readonly FieldLife[];
}

/** No field life: a corridor with no field in reach. */
export const NO_FIELD_LIFE: FieldLifeInView = Object.freeze({ pieces: Object.freeze([]) });

/** The mapped kinds a herd grazes on: **`meadow`** and **`grassland`**. */
export const GRAZING_KINDS: ReadonlySet<string> = new Set(['meadow', 'grassland']);

/** The mapped kind bales lie on: **`farmland`**, the arable field. */
export const BALE_KINDS: ReadonlySet<string> = new Set(['farmland']);

/**
 * How near the middle of the ridden road no piece stands, in metres: **25** —
 * "well back from the road": the 3.5 m half-road, the verge, the roadside
 * hedge at 5.6 m (`settlements.ts` §`FIELD_EDGE_LATERAL_METRES`) and a
 * headland inside it.
 */
export const FIELD_LIFE_ROAD_CLEAR_METRES = 25;

/** How near a mapped street's or path's line no piece stands, in metres: **10**. */
export const FIELD_LIFE_STREET_CLEAR_METRES = 10;

/**
 * How far inside its field's mapped edge a piece stands at least, in metres:
 * **4** — clear of the hedge or wall on the edge, a cow's length.
 */
export const FIELD_LIFE_EDGE_METRES = 4;

/** How far apart two pieces of one cell stand at least, in metres: **2.5**. */
export const FIELD_LIFE_SPACING_METRES = 2.5;

/** The side of a herd's cell, metres: **60**. One herd a cell at most. */
export const FIELD_HERD_CELL_METRES = 60;

/** The share of grazing cells that hold a herd: **0.4**. */
export const FIELD_HERD_SHARE = 0.4;

/** The side of a field of bales' cell, metres: **70**. */
export const FIELD_BALE_CELL_METRES = 70;

/** The share of arable cells whose field has been baled: **0.3**. */
export const FIELD_BALE_SHARE = 0.3;

/** The share of herds that are sheep rather than cows: **0.45**. */
export const SHEEP_SHARE = 0.45;

/** How many cows a herd is, and how far from its middle they spread, metres. */
const COW_HERD = { least: 3, most: 6, spread: 14 } as const;

/** How many sheep a flock is, and how far from its middle they spread, metres. */
const SHEEP_FLOCK = { least: 5, most: 10, spread: 11 } as const;

/** How many bales a baled field's cell holds, and how far from its middle they lie, metres. */
const BALE_FIELD = { least: 4, most: 9, spread: 24 } as const;

/** The shares of an animal's poses: grazing, then head up; the rest lie down. */
const GRAZING_SHARE = 0.55;
const HEAD_UP_SHARE = 0.3;

/** How far round the place asked about a piece is planned, metres: **200**. */
export const FIELD_LIFE_REACH_METRES = 200;

/** How near the rider an animal is drawn at its near level at most, metres: **60**. */
export const FIELD_LIFE_NEAR_METRES = 60;

/**
 * How many animals a frame draws at their near level at most: **6**. The rest
 * of {@link FIELD_ANIMALS_MAX} are the far level, a few boxes each.
 */
export const FIELD_ANIMALS_NEAR_MAX = 6;

/** How many animals a frame carries at most: **30**, the nearest the place asked about. */
export const FIELD_ANIMALS_MAX = 30;

/** How many bales a frame carries at most: **18**, the nearest the place asked about. */
export const FIELD_BALES_MAX = 18;

/** How far up the road from the rider the place asked about is, metres: **40**. */
export const FIELD_LIFE_AHEAD_METRES = 40;

/** The cell the place asked about is held to between asks, metres: **16**. @see FIELD_LIFE_AHEAD_METRES */
export const FIELD_LIFE_CELL_METRES = 16;

/** The key field life is hashed under, outside anything else's. */
const FIELD_LIFE_KEY = 0x3286_0000;

/** What {@link fieldLifeAt} is planned from. */
export interface FieldLifeSite {
  readonly seed: number;
  /** The corridor's land use; only its grazing and arable kinds are read. */
  readonly landUse: readonly LandUseFeature[];
  /** The land mask: a piece stands only where it says `farmland`. */
  readonly land: Pick<LandClassMask, 'classAt'>;
  /** Every mapped street and path, which no piece stands on. */
  readonly streets: readonly StreetFeature[];
  readonly paths: readonly PathFeature[];
  /**
   * How far `(x, z)` is from the middle of any stretch of the ridden road,
   * searching no further than `reach`; past it, anything at least `reach`.
   */
  readonly road: (x: number, z: number, reach: number) => number;
}

/** One field polygon and its box, for the first test. */
interface Field {
  readonly feature: LandUseFeature;
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

/** One line and its box. */
interface Line {
  readonly line: Float32Array;
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

/** The grazing and the arable fields of a corridor's land use, each with its box. */
const fieldsOf = new WeakMap<
  readonly LandUseFeature[],
  { readonly grazing: readonly Field[]; readonly arable: readonly Field[] }
>();

/** The boxes of a corridor's streets and paths. */
const linesOf = new WeakMap<readonly unknown[], readonly Line[]>();

function fieldsIn(landUse: readonly LandUseFeature[]): {
  readonly grazing: readonly Field[];
  readonly arable: readonly Field[];
} {
  let held = fieldsOf.get(landUse);
  if (held === undefined) {
    const grazing: Field[] = [];
    const arable: Field[] = [];
    for (const feature of landUse) {
      if (feature.layer !== 'landuse') continue;
      const into = GRAZING_KINDS.has(feature.kind)
        ? grazing
        : BALE_KINDS.has(feature.kind)
          ? arable
          : undefined;
      if (into === undefined) continue;
      const box = boxOf(feature.rings);
      if (box !== undefined) into.push({ feature, ...box });
    }
    held = { grazing, arable };
    fieldsOf.set(landUse, held);
  }
  return held;
}

function linesIn(features: readonly { readonly line: Float32Array }[]): readonly Line[] {
  let held = linesOf.get(features);
  if (held === undefined) {
    held = features.flatMap(({ line }) => {
      const box = boxOf([line]);
      return box === undefined ? [] : [{ line, ...box }];
    });
    linesOf.set(features, held);
  }
  return held;
}

function boxOf(
  rings: readonly Float32Array[],
): { minX: number; maxX: number; minZ: number; maxZ: number } | undefined {
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  for (const ring of rings) {
    for (let at = 0; at + 1 < ring.length; at += 2) {
      const x = ring[at] as number;
      const z = ring[at + 1] as number;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minZ = Math.min(minZ, z);
      maxZ = Math.max(maxZ, z);
    }
  }
  return minX <= maxX ? { minX, maxX, minZ, maxZ } : undefined;
}

/** Even-odd: inside the outer ring and outside every hole. */
function insideRings(rings: readonly Float32Array[], x: number, z: number): boolean {
  let inside = false;
  for (const ring of rings) {
    const count = ring.length / 2;
    for (let i = 0, j = count - 1; i < count; j = i, i += 1) {
      const xi = ring[i * 2] as number;
      const zi = ring[i * 2 + 1] as number;
      const xj = ring[j * 2] as number;
      const zj = ring[j * 2 + 1] as number;
      if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
    }
  }
  return inside;
}

/** Whether `(x, z)` and the four points `margin` from it along each axis are all inside `field`. */
function wellInside(field: Field, x: number, z: number, margin: number): boolean {
  if (
    x - margin < field.minX ||
    x + margin > field.maxX ||
    z - margin < field.minZ ||
    z + margin > field.maxZ
  ) {
    return false;
  }
  const rings = field.feature.rings;
  return (
    insideRings(rings, x, z) &&
    insideRings(rings, x - margin, z) &&
    insideRings(rings, x + margin, z) &&
    insideRings(rings, x, z - margin) &&
    insideRings(rings, x, z + margin)
  );
}

/** Whether `(x, z)` is within `clear` of any of `lines`. */
function nearALine(lines: readonly Line[], x: number, z: number, clear: number): boolean {
  const squared = clear * clear;
  for (const each of lines) {
    if (
      x < each.minX - clear ||
      x > each.maxX + clear ||
      z < each.minZ - clear ||
      z > each.maxZ + clear
    ) {
      continue;
    }
    const line = each.line;
    for (let at = 0; at + 3 < line.length; at += 2) {
      const ax = line[at] as number;
      const az = line[at + 1] as number;
      const dx = (line[at + 2] as number) - ax;
      const dz = (line[at + 3] as number) - az;
      const length = dx * dx + dz * dz;
      const t =
        length === 0 ? 0 : Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / length));
      const ox = x - (ax + dx * t);
      const oz = z - (az + dz * t);
      if (ox * ox + oz * oz < squared) return true;
    }
  }
  return false;
}

/** A cell's hash: the ride's seed, which grid, and the cell. */
function cellHash(seed: number, grid: number, cellX: number, cellZ: number): number {
  return mixInto(mixInto(mixInto(seed ^ FIELD_LIFE_KEY, grid), cellX), cellZ);
}

/** A piece before it is stood on the ground or given its level. */
interface Candidate {
  readonly kind: FieldLifeKind;
  readonly pose: FieldLifePose;
  readonly x: number;
  readonly z: number;
  readonly heading: number;
  readonly look: number;
}

/** Whether a member may stand at `(x, z)`, by the rules in the header. */
function standsAt(
  site: FieldLifeSite,
  field: Field,
  lines: readonly Line[],
  placed: readonly Candidate[],
  x: number,
  z: number,
): boolean {
  if (!wellInside(field, x, z, FIELD_LIFE_EDGE_METRES)) return false;
  if (site.land.classAt(x, z) !== 'farmland') return false;
  if (site.road(x, z, FIELD_LIFE_ROAD_CLEAR_METRES) < FIELD_LIFE_ROAD_CLEAR_METRES) return false;
  if (nearALine(lines, x, z, FIELD_LIFE_STREET_CLEAR_METRES)) return false;
  for (const other of placed) {
    if (Math.hypot(other.x - x, other.z - z) < FIELD_LIFE_SPACING_METRES) return false;
  }
  return true;
}

/** The first of `fields` whose polygon holds `(x, z)`, in the corridor's order. */
function fieldAt(fields: readonly Field[], x: number, z: number): Field | undefined {
  for (const field of fields) {
    if (x < field.minX || x > field.maxX || z < field.minZ || z > field.maxZ) continue;
    if (insideRings(field.feature.rings, x, z)) return field;
  }
  return undefined;
}

/** One cell's members, appended to `found`. */
function cellMembers(
  site: FieldLifeSite,
  fields: readonly Field[],
  lines: readonly Line[],
  grid: 1 | 2,
  cellX: number,
  cellZ: number,
  found: Candidate[],
): void {
  const side = grid === 1 ? FIELD_HERD_CELL_METRES : FIELD_BALE_CELL_METRES;
  const hash = cellHash(site.seed, grid, cellX, cellZ);
  if (uniformFrom(hash, 0) >= (grid === 1 ? FIELD_HERD_SHARE : FIELD_BALE_SHARE)) return;
  const middleX = (cellX + uniformFrom(hash, 1)) * side;
  const middleZ = (cellZ + uniformFrom(hash, 2)) * side;
  const field = fieldAt(fields, middleX, middleZ);
  if (field === undefined) return;
  const kind: FieldLifeKind =
    grid === 2 ? 'bale' : uniformFrom(hash, 3) < SHEEP_SHARE ? 'sheep' : 'cow';
  const group = kind === 'bale' ? BALE_FIELD : kind === 'sheep' ? SHEEP_FLOCK : COW_HERD;
  const count = group.least + Math.floor(uniformFrom(hash, 4) * (group.most - group.least + 1));
  // A herd wears one coat, as a farm's stock does.
  const look = Math.floor(uniformFrom(hash, 5) * 0x1_0000);
  const placed: Candidate[] = [];
  for (let member = 0; member < count; member += 1) {
    const each = mixInto(hash, member + 1);
    // Uniform over the disc about the middle.
    const reach = group.spread * Math.sqrt(uniformFrom(each, 0));
    const turn = uniformFrom(each, 1) * 2 * Math.PI;
    const x = middleX + reach * Math.cos(turn);
    const z = middleZ + reach * Math.sin(turn);
    if (!standsAt(site, field, lines, placed, x, z)) continue;
    const posed = uniformFrom(each, 3);
    placed.push({
      kind,
      pose:
        kind === 'bale'
          ? 'lying'
          : posed < GRAZING_SHARE
            ? 'grazing'
            : posed < GRAZING_SHARE + HEAD_UP_SHARE
              ? 'head-up'
              : 'lying',
      x,
      z,
      heading: uniformFrom(each, 2) * 2 * Math.PI,
      look,
    });
  }
  for (const each of placed) found.push(each);
}

/** Every candidate of one grid's cells within the window about `(x, z)`. */
function gridCandidates(
  site: FieldLifeSite,
  fields: readonly Field[],
  lines: readonly Line[],
  grid: 1 | 2,
  x: number,
  z: number,
): Candidate[] {
  const found: Candidate[] = [];
  if (fields.length === 0) return found;
  const reach = FIELD_LIFE_REACH_METRES;
  const near = fields.filter(
    (field) =>
      field.maxX >= x - reach &&
      field.minX <= x + reach &&
      field.maxZ >= z - reach &&
      field.minZ <= z + reach,
  );
  if (near.length === 0) return found;
  const side = grid === 1 ? FIELD_HERD_CELL_METRES : FIELD_BALE_CELL_METRES;
  for (
    let cellX = Math.floor((x - reach) / side);
    cellX <= Math.floor((x + reach) / side);
    cellX += 1
  ) {
    for (
      let cellZ = Math.floor((z - reach) / side);
      cellZ <= Math.floor((z + reach) / side);
      cellZ += 1
    ) {
      cellMembers(site, near, lines, grid, cellX, cellZ, found);
    }
  }
  return found.filter((each) => Math.hypot(each.x - x, each.z - z) <= reach);
}

/**
 * The field life about `(x, z)` — #3286: the nearest {@link FIELD_ANIMALS_MAX}
 * animals and {@link FIELD_BALES_MAX} bales within {@link FIELD_LIFE_REACH_METRES}
 * of it, by the rules in this file's header. The animals come first; of them,
 * the {@link FIELD_ANIMALS_NEAR_MAX} nearest `(riderX, riderZ)` within
 * {@link FIELD_LIFE_NEAR_METRES} are `near` and the rest `far`. Every `y` is
 * nought: `scene.ts` stands each on the frame's drawn ground.
 */
export function fieldLifeAt(
  site: FieldLifeSite,
  x: number,
  z: number,
  riderX: number,
  riderZ: number,
): FieldLifeInView {
  const { grazing, arable } = fieldsIn(site.landUse);
  if (grazing.length === 0 && arable.length === 0) return NO_FIELD_LIFE;
  const lines = [...linesIn(site.streets), ...linesIn(site.paths)];
  const off = (each: Candidate): number => Math.hypot(each.x - x, each.z - z);
  const nearest = (found: Candidate[], most: number): Candidate[] =>
    found
      .map((each) => ({ each, off: off(each) }))
      .sort((a, b) => a.off - b.off)
      .slice(0, most)
      .map(({ each }) => each);
  const animals = nearest(gridCandidates(site, grazing, lines, 1, x, z), FIELD_ANIMALS_MAX);
  const bales = nearest(gridCandidates(site, arable, lines, 2, x, z), FIELD_BALES_MAX);
  if (animals.length === 0 && bales.length === 0) return NO_FIELD_LIFE;
  const fromRider = (each: Candidate): number => Math.hypot(each.x - riderX, each.z - riderZ);
  const nearOnes = new Set(
    animals
      .filter((each) => fromRider(each) <= FIELD_LIFE_NEAR_METRES)
      .sort((a, b) => fromRider(a) - fromRider(b))
      .slice(0, FIELD_ANIMALS_NEAR_MAX),
  );
  return {
    pieces: [
      ...animals.map((each) => ({
        ...each,
        y: 0,
        level: nearOnes.has(each) ? ('near' as const) : ('far' as const),
      })),
      ...bales.map((each) => ({ ...each, y: 0, level: 'far' as const })),
    ],
  };
}

/**
 * Whether the route's season has bales in its fields — #3286: the season
 * clock's late summer and autumn (`season.ts` §`natureOn`), which is from the
 * last days of August, as its autumn first rises, until its winter starts in
 * mid-November. Never in winter, spring or high summer, and never where the
 * clock has no season at all — the tropics, a route with no hemisphere, or a
 * view not yet told one (`season.ts` §`NO_SEASON`).
 */
export function balesInSeason(season: Season): boolean {
  return season.nature.autumn > 0 && season.nature.winter === 0;
}

/** Which of `count` coats a piece wears, from its hash. */
export function fieldLifeLook(piece: Pick<FieldLife, 'look'>, count: number): number {
  return count <= 0 ? 0 : piece.look % count;
}
