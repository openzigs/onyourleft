// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What the ground is, where map data was read — #1546, ADR 0054 D-4.2 and D-5.
 *
 * One mask per ride, built once at the press from the route's corridor
 * (`world-data/corridor.ts`, #1539): a sparse grid of
 * {@link LAND_CLASS_CELL_METRES} cells in chunks of
 * {@link LAND_CLASS_CHUNK_CELLS}², each chunk one `Uint8Array` in a `Map`
 * keyed by an integer chunk index. Every placement rule of phase B reads it —
 * `settlements.ts` (no procedural site on mapped land, no field boundary off
 * field ground — {@link fieldGround}), `scatter.ts` (no tree, shrub or rock on built-up
 * land or water) and `streets.ts` (no pavement for a site that is not built).
 * Since #1547 it also carries how far each cell is from built-up land
 * ({@link LandClassMask.builtUpDistances}), which `landform.ts` levels a mapped
 * town's ground by.
 *
 * ⚠️ **Read every frame, on the thread GATT notifications arrive on** (#240
 * NFR-2, #469), so {@link LandClassMask.classAt} is one `Map` lookup and one
 * typed-array index, and allocates nothing: the class is one of seven string
 * constants, the key is a small integer.
 *
 * ## The classes
 *
 * From Protomaps v4's `landuse.kind` and `water.kind` —
 * {@link LAND_CLASS_OF_KIND}. Where polygons overlap the class with the higher
 * precedence wins: **water > wood > park > built-up > farmland > other**, so a
 * wood drawn inside a residential block is a wood. A covered cell no polygon
 * reaches is `other`; a cell outside every covered tile is `unknown`, and there
 * the procedural world decides (P-8). An unknown `kind` is `other`, never
 * `built-up`.
 *
 * ## Bounded
 *
 * At most {@link LAND_CLASS_MAX_BYTES} a route. A corridor that would need
 * more is built for its first chunks in route order and the rest is `unknown`,
 * which is the procedural world — never a refusal.
 *
 * Names no rendering library and no coordinate in any string: it formats none.
 */

import { rasterise, type Box, type GridSpec, type LandUseFeature } from '@onyourleft/map-features';

import type { WorldCorridor } from './world-data/corridor';

export type LandClass = 'unknown' | 'water' | 'wood' | 'park' | 'built-up' | 'farmland' | 'other';

/**
 * Every `landuse` kind this reads, and its class — #1546's table. A `water`
 * feature is `water` whatever its kind. Any other kind is `other`
 * ({@link landClassOfKind}).
 */
export const LAND_CLASS_OF_KIND: Readonly<Record<string, Exclude<LandClass, 'unknown'>>> =
  Object.freeze({
    wetland: 'water',
    marina: 'water',
    wood: 'wood',
    forest: 'wood',
    scrub: 'wood',
    park: 'park',
    garden: 'park',
    golf_course: 'park',
    nature_reserve: 'park',
    national_park: 'park',
    protected_area: 'park',
    recreation_ground: 'park',
    cemetery: 'park',
    zoo: 'park',
    dog_park: 'park',
    playground: 'park',
    pitch: 'park',
    grass: 'park',
    residential: 'built-up',
    commercial: 'built-up',
    industrial: 'built-up',
    retail: 'built-up',
    neighbourhood: 'built-up',
    school: 'built-up',
    college: 'built-up',
    university: 'built-up',
    hospital: 'built-up',
    townhall: 'built-up',
    library: 'built-up',
    post_office: 'built-up',
    supermarket: 'built-up',
    grocery: 'built-up',
    hotel: 'built-up',
    pedestrian: 'built-up',
    railway: 'built-up',
    military: 'built-up',
    stadium: 'built-up',
    farmland: 'farmland',
    farmyard: 'farmland',
    orchard: 'farmland',
    meadow: 'farmland',
  });

/** One cell's side, in metres. */
export const LAND_CLASS_CELL_METRES = 5;

/** One chunk's side, in cells: 320 m chunks. */
export const LAND_CLASS_CHUNK_CELLS = 64;

/** The most a route's mask holds: 8 MiB. */
export const LAND_CLASS_MAX_BYTES = 8 * 1024 * 1024;

/**
 * The most edge-by-row steps the polygon pass may take, so a hostile or very
 * dense archive cannot freeze the press: a polygon's cost is its vertices times
 * the rows it crosses on each existing chunk. Past it the rest of the polygons
 * are not painted and their cells keep the class they hold (`other`), the same
 * answer as a tile with no land-use data.
 */
export const LAND_CLASS_MAX_WORK = 20_000_000;

const CHUNK_METRES = LAND_CLASS_CELL_METRES * LAND_CLASS_CHUNK_CELLS;
const CHUNK_BYTES = LAND_CLASS_CHUNK_CELLS * LAND_CLASS_CHUNK_CELLS;

/**
 * Chunk columns and rows either side of the origin a key can name: 8 192
 * chunks, 2 621 km. Past it is `unknown`. Small enough that every key is a
 * small integer, which a `Map` looks up without boxing a number.
 */
const CHUNK_RANGE = 2 ** 13;
const CHUNK_STRIDE = 2 * CHUNK_RANGE;

/** Cells either side of the origin a chunk key can name: past it is far. */
const CELL_RANGE = CHUNK_RANGE * LAND_CLASS_CHUNK_CELLS;

/**
 * The classes by code, the code being the precedence: a cell keeps the
 * highest code written to it. 0 is `unknown`, which nothing writes.
 */
const CLASS_OF_CODE: readonly LandClass[] = [
  'unknown',
  'other',
  'farmland',
  'built-up',
  'park',
  'wood',
  'water',
];
const CODE_OTHER = 1;
const CODE_BUILT_UP = CLASS_OF_CODE.indexOf('built-up');

/**
 * How far the levelling field reaches from mapped built-up land, in metres:
 * **250** — #1547.
 *
 * `landform.ts` holds the ground's invented relief to `RELIEF_SLOPE` times
 * {@link LandClassMask.builtUpDistances}, the rule its clear band already holds
 * beside the road, so a mapped town stands on the road's own height and the
 * hills rise from its edge no faster than they rise from the road. Its relief
 * is at most `RELIEF_MAX_METRES` (45 m) and `RELIEF_SLOPE` is 0.18, so past
 * 45 / 0.18 = 250 m nothing is held and the field need not reach further.
 * `landform.test.ts` holds the two files to that arithmetic.
 */
export const LEVELLING_REACH_METRES = 250;

/**
 * The most chunks the levelling field measures, in route order: **512** — #1547.
 *
 * Measuring a chunk is a chamfer over it and its neighbours' apron, about
 * 0.3 ms in Node on the development machine, and it runs at the press: 512 of
 * them is ~150 ms there, 52 km² of ground beside a town. Past it a town's
 * ground is not levelled — today's ground, never a refusal — the
 * {@link LAND_CLASS_MAX_BYTES} precedent. A chunk that is built-up throughout
 * costs nothing and is not counted.
 */
export const LEVELLING_MAX_CHUNKS = 512;

/** The stored distance past {@link LEVELLING_REACH_METRES}: a byte's most, in metres. */
const LEVEL_FAR = 255;

/** Cells of neighbouring chunk a chunk's distances are measured over: the reach, and one. */
const LEVEL_APRON_CELLS = Math.ceil(LEVELLING_REACH_METRES / LAND_CLASS_CELL_METRES) + 1;

/** The side of the grid one chunk's distances are measured on: the chunk and its apron. */
const LEVEL_SCRATCH_CELLS = LAND_CLASS_CHUNK_CELLS + 2 * LEVEL_APRON_CELLS;

/** Answers "what is the ground here?" in the corridor's local metres. */
export interface LandClassMask {
  /** O(1), no allocation. `'unknown'` outside every covered chunk. */
  classAt(x: number, z: number): LandClass;
  /** True where the corridor is covered (P-8), whatever the class. */
  covered(x: number, z: number): boolean;
  /**
   * Metres to the nearest mapped built-up land at each of `count` points —
   * #1547 — `points` holding them as `x, z` pairs and `into` taking one
   * distance a point. Read off a field built once, with the mask, and
   * interpolated between cell centres, so it is continuous and the ground
   * levelled by it has no step; measured to a built-up cell's edge rather than
   * its centre, so it is 0 anywhere on one. `Infinity` where no built-up land
   * is within {@link LEVELLING_REACH_METRES}, outside every chunk the mask
   * holds, and everywhere in {@link NO_LAND_CLASS}.
   *
   * ⚠️ **Points in and distances out through arrays, never as numbers**: a
   * call that is not inlined boxes every number it is passed or returns, and
   * this is read for every vertex of the ground (#469). `landform-levelling.test.ts`
   * measures the heap a build.
   */
  builtUpDistances(points: Float64Array, count: number, into: Float64Array): void;
  /** What the mask holds, for the budget: the classes. */
  readonly bytes: number;
  /** What the levelling field holds, in bytes: 0 where no built-up land was mapped. */
  readonly levellingBytes: number;
}

/** Everything `unknown`: today's world, and what the scene takes with no corridor. */
export const NO_LAND_CLASS: LandClassMask = Object.freeze({
  classAt: (): LandClass => 'unknown',
  covered: (): boolean => false,
  builtUpDistances: (_points: Float64Array, count: number, into: Float64Array): void => {
    into.fill(Number.POSITIVE_INFINITY, 0, count);
  },
  bytes: 0,
  levellingBytes: 0,
});

/**
 * A `landuse` or `water` feature's class. Own properties only: a tile is
 * untrusted, and a `kind` of `constructor` must not find `Object`'s.
 */
export function landClassOfKind(
  layer: LandUseFeature['layer'],
  kind: string,
): Exclude<LandClass, 'unknown'> {
  if (layer === 'water') return 'water';
  return Object.hasOwn(LAND_CLASS_OF_KIND, kind)
    ? (LAND_CLASS_OF_KIND[kind] as Exclude<LandClass, 'unknown'>)
    : 'other';
}

/** Whether nothing grows at `(x, z)`: mapped built-up land or water. */
export function builtUpOrWater(land: LandClassMask, x: number, z: number): boolean {
  const here = land.classAt(x, z);
  return here === 'built-up' || here === 'water';
}

/**
 * Whether a field boundary may run at `(x, z)`: ground that is not mapped as
 * built-up, water, wood or park — a field's, or the procedural world's.
 */
export function fieldGround(land: LandClassMask, x: number, z: number): boolean {
  const here = land.classAt(x, z);
  return here === 'unknown' || here === 'farmland' || here === 'other';
}

/** One land-use polygon's bounding box, for {@link kindAt}'s first test. */
interface KindIndexEntry {
  readonly feature: LandUseFeature;
  readonly code: number;
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

/** Each corridor's land-use polygons with their boxes, built on first ask. */
const kindIndexes = new WeakMap<WorldCorridor, readonly KindIndexEntry[]>();

function kindIndexOf(corridor: WorldCorridor): readonly KindIndexEntry[] {
  const known = kindIndexes.get(corridor);
  if (known !== undefined) return known;
  const entries: KindIndexEntry[] = [];
  for (const feature of corridor.landUse) {
    const outer = feature.rings[0];
    if (outer === undefined || outer.length < 6) continue;
    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let minZ = Number.POSITIVE_INFINITY;
    let maxZ = Number.NEGATIVE_INFINITY;
    for (let i = 0; i + 1 < outer.length; i += 2) {
      minX = Math.min(minX, outer[i] as number);
      maxX = Math.max(maxX, outer[i] as number);
      minZ = Math.min(minZ, outer[i + 1] as number);
      maxZ = Math.max(maxZ, outer[i + 1] as number);
    }
    const code = CLASS_OF_CODE.indexOf(landClassOfKind(feature.layer, feature.kind));
    entries.push({ feature, code, minX, maxX, minZ, maxZ });
  }
  kindIndexes.set(corridor, entries);
  return entries;
}

/** Even-odd: whether `(x, z)` is inside the polygon, holes and all. */
function insidePolygon(feature: LandUseFeature, x: number, z: number): boolean {
  let inside = false;
  for (const ring of feature.rings) {
    const n = ring.length / 2;
    for (let i = 0, j = n - 1; i < n; j = i, i += 1) {
      const xi = ring[i * 2] as number;
      const zi = ring[i * 2 + 1] as number;
      const xj = ring[j * 2] as number;
      const zj = ring[j * 2 + 1] as number;
      if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
    }
  }
  return inside;
}

/**
 * The `landuse` (or `water`) `kind` at `(x, z)` — #1540: which built-up land a
 * mapped building stands on, `residential`, `commercial` or `industrial`,
 * which the mask's class does not keep. Of the polygons covering the point,
 * the one whose class wins by the mask's precedence (water > wood > park >
 * built-up > farmland > other), so it names the land {@link LandClassMask.classAt}
 * classes; `undefined` where none covers it. Read once a footprint at ride
 * start, never per frame: it tests every polygon's box.
 *
 * @unwired #1540's footprint plans are its one reader, and #1549 draws them.
 */
export function kindAt(corridor: WorldCorridor, x: number, z: number): string | undefined {
  let best: KindIndexEntry | undefined;
  for (const entry of kindIndexOf(corridor)) {
    if (x < entry.minX || x > entry.maxX || z < entry.minZ || z > entry.maxZ) continue;
    if (best !== undefined && entry.code <= best.code) continue;
    if (insidePolygon(entry.feature, x, z)) best = entry;
  }
  return best?.feature.kind;
}

function chunkKey(column: number, row: number): number {
  return (row + CHUNK_RANGE) * CHUNK_STRIDE + (column + CHUNK_RANGE);
}

function inRange(column: number, row: number): boolean {
  return column >= -CHUNK_RANGE && column < CHUNK_RANGE && row >= -CHUNK_RANGE && row < CHUNK_RANGE;
}

/** Cell index `[first, last]` within a chunk whose centres lie in `[min, max)`, from the chunk's own edge. */
function cellSpan(min: number, max: number, edge: number): readonly [number, number] {
  const first = Math.max(0, Math.ceil((min - edge) / LAND_CLASS_CELL_METRES - 0.5));
  const last = Math.min(
    LAND_CLASS_CHUNK_CELLS - 1,
    Math.ceil((max - edge) / LAND_CLASS_CELL_METRES - 0.5) - 1,
  );
  return [first, last];
}

/**
 * The mask for a ready corridor: its covered tiles as `other`, then every
 * land-use polygon over them by precedence. Built once, at the press.
 */
export function landClassMask(
  corridor: WorldCorridor,
  maxBytes: number = LAND_CLASS_MAX_BYTES,
  maxWork: number = LAND_CLASS_MAX_WORK,
  maxLevelledChunks: number = LEVELLING_MAX_CHUNKS,
): LandClassMask {
  const chunks = new Map<number, Uint8Array>();
  const maxChunks = Math.floor(maxBytes / CHUNK_BYTES);
  // 1. The covered tiles, in route order, as `other`; past the cap, nothing.
  let full = false;
  for (const box of corridor.coveredBoxes) {
    if (full) break;
    full = !markCovered(chunks, box, maxChunks);
  }
  // 2. Every polygon, onto the chunks that exist, keeping the higher class.
  let work = maxWork;
  for (const feature of corridor.landUse) {
    if (work <= 0) break;
    const code = CLASS_OF_CODE.indexOf(landClassOfKind(feature.layer, feature.kind));
    work -= paint(chunks, feature, code);
  }
  // 3. #1547: how far every cell near built-up land is from it.
  const { levels, bytes: levellingBytes } = levellingField(chunks, maxLevelledChunks);

  const classAt = (x: number, z: number): LandClass => {
    const column = Math.floor(x / CHUNK_METRES);
    const row = Math.floor(z / CHUNK_METRES);
    // `NaN` fails both comparisons, so it is `unknown` too.
    if (!inRange(column, row)) return 'unknown';
    const chunk = chunks.get(chunkKey(column, row));
    if (chunk === undefined) return 'unknown';
    const cellX = Math.min(
      LAND_CLASS_CHUNK_CELLS - 1,
      Math.floor((x - column * CHUNK_METRES) / LAND_CLASS_CELL_METRES),
    );
    const cellZ = Math.min(
      LAND_CLASS_CHUNK_CELLS - 1,
      Math.floor((z - row * CHUNK_METRES) / LAND_CLASS_CELL_METRES),
    );
    return CLASS_OF_CODE[chunk[cellZ * LAND_CLASS_CHUNK_CELLS + cellX] as number] as LandClass;
  };
  /** The stored distance at a cell, by its index across the whole grid. */
  const levelCell = (cellX: number, cellZ: number): number => {
    const column = Math.floor(cellX / LAND_CLASS_CHUNK_CELLS);
    const row = Math.floor(cellZ / LAND_CLASS_CHUNK_CELLS);
    if (!inRange(column, row)) return LEVEL_FAR;
    const chunk = levels.get(chunkKey(column, row));
    if (chunk === undefined) return LEVEL_FAR;
    const at =
      (cellZ - row * LAND_CLASS_CHUNK_CELLS) * LAND_CLASS_CHUNK_CELLS +
      (cellX - column * LAND_CLASS_CHUNK_CELLS);
    return chunk[at] as number;
  };
  /**
   * Every point's distance, into `into`. The four stored distances around a
   * point come from one chunk where all four are in it — all but one row and
   * one column of it — and cell by cell across a chunk's edge.
   */
  const builtUpDistances = (points: Float64Array, count: number, into: Float64Array): void => {
    for (let point = 0; point < count; point += 1) {
      // Between the four cell centres around the point, so the field is continuous.
      const fx = (points[point * 2] as number) / LAND_CLASS_CELL_METRES - 0.5;
      const fz = (points[point * 2 + 1] as number) / LAND_CLASS_CELL_METRES - 0.5;
      const cellX = Math.floor(fx);
      const cellZ = Math.floor(fz);
      // `NaN` and the infinities: nothing is near.
      if (!(Math.abs(cellX) < CELL_RANGE && Math.abs(cellZ) < CELL_RANGE)) {
        into[point] = Number.POSITIVE_INFINITY;
        continue;
      }
      const column = Math.floor(cellX / LAND_CLASS_CHUNK_CELLS);
      const row = Math.floor(cellZ / LAND_CLASS_CHUNK_CELLS);
      const localX = cellX - column * LAND_CLASS_CHUNK_CELLS;
      const localZ = cellZ - row * LAND_CLASS_CHUNK_CELLS;
      let a: number;
      let b: number;
      let c: number;
      let d: number;
      if (localX < LAND_CLASS_CHUNK_CELLS - 1 && localZ < LAND_CLASS_CHUNK_CELLS - 1) {
        const chunk = inRange(column, row) ? levels.get(chunkKey(column, row)) : undefined;
        if (chunk === undefined) {
          into[point] = Number.POSITIVE_INFINITY;
          continue;
        }
        const at = localZ * LAND_CLASS_CHUNK_CELLS + localX;
        a = chunk[at] as number;
        b = chunk[at + 1] as number;
        c = chunk[at + LAND_CLASS_CHUNK_CELLS] as number;
        d = chunk[at + LAND_CLASS_CHUNK_CELLS + 1] as number;
      } else {
        a = levelCell(cellX, cellZ);
        b = levelCell(cellX + 1, cellZ);
        c = levelCell(cellX, cellZ + 1);
        d = levelCell(cellX + 1, cellZ + 1);
      }
      if (a === LEVEL_FAR && b === LEVEL_FAR && c === LEVEL_FAR && d === LEVEL_FAR) {
        into[point] = Number.POSITIVE_INFINITY;
        continue;
      }
      const tx = fx - cellX;
      const near = a + (b - a) * tx;
      const far = c + (d - c) * tx;
      // From the cells' centres to their edge: a built-up cell is built-up to
      // its edge, so a point inside one, or half a cell off it, is on the town.
      into[point] = Math.max(0, near + (far - near) * (fz - cellZ) - LAND_CLASS_CELL_METRES / 2);
    }
  };
  return {
    classAt,
    covered: (x, z) => classAt(x, z) !== 'unknown',
    builtUpDistances,
    bytes: chunks.size * CHUNK_BYTES,
    levellingBytes,
  };
}

/** The chamfer's step to a side neighbour and to a diagonal one, in metres. */
const SIDE_STEP = LAND_CLASS_CELL_METRES;
const DIAGONAL_STEP = LAND_CLASS_CELL_METRES * Math.SQRT2;

/**
 * Every chunk's distance to the nearest built-up cell, in whole metres up to
 * {@link LEVEL_FAR} — #1547. A chunk with no built-up cell in it or in any of
 * its eight neighbours gets none, and reads as far: a 320 m chunk is wider
 * than the reach, so nothing further away can be within it.
 *
 * Each chunk is measured on its own grid with an apron of its neighbours'
 * cells, by a two-pass chamfer (side and diagonal steps, within 8 % of the
 * straight-line distance), so a town across a chunk's edge is as near as it
 * is. Built once, at the press, with the mask; one scratch grid for all of it.
 * A chunk built-up throughout is 0 throughout, and shares one array; past
 * `maxChunks` measured, in route order, the rest get none.
 */
function levellingField(
  chunks: Map<number, Uint8Array>,
  maxChunks: number,
): { readonly levels: Map<number, Uint8Array>; readonly bytes: number } {
  const levels = new Map<number, Uint8Array>();
  const builtUp = new Set<number>();
  const throughout = new Set<number>();
  for (const [key, chunk] of chunks) {
    if (!chunk.includes(CODE_BUILT_UP)) continue;
    builtUp.add(key);
    let every = true;
    for (let cell = 0; cell < CHUNK_BYTES && every; cell += 1) {
      every = chunk[cell] === CODE_BUILT_UP;
    }
    if (every) throughout.add(key);
  }
  if (builtUp.size === 0) return { levels, bytes: 0 };
  const onTheTown = throughout.size > 0 ? new Uint8Array(CHUNK_BYTES) : undefined;
  const side = LEVEL_SCRATCH_CELLS;
  const scratch = new Float32Array(side * side);
  let measured = 0;
  for (const key of chunks.keys()) {
    if (onTheTown !== undefined && throughout.has(key)) {
      levels.set(key, onTheTown);
      continue;
    }
    if (measured >= maxChunks) continue;
    const column = (key % CHUNK_STRIDE) - CHUNK_RANGE;
    const row = Math.floor(key / CHUNK_STRIDE) - CHUNK_RANGE;
    let near = false;
    for (let dRow = -1; dRow <= 1 && !near; dRow += 1) {
      for (let dColumn = -1; dColumn <= 1 && !near; dColumn += 1) {
        near =
          inRange(column + dColumn, row + dRow) &&
          builtUp.has(chunkKey(column + dColumn, row + dRow));
      }
    }
    if (!near) continue;
    measured += 1;
    scratch.fill(Number.POSITIVE_INFINITY);
    // The seeds: every built-up cell of this chunk and of its neighbours' aprons.
    for (let dRow = -1; dRow <= 1; dRow += 1) {
      for (let dColumn = -1; dColumn <= 1; dColumn += 1) {
        if (!inRange(column + dColumn, row + dRow)) continue;
        const neighbourKey = chunkKey(column + dColumn, row + dRow);
        if (!builtUp.has(neighbourKey)) continue;
        const neighbour = chunks.get(neighbourKey) as Uint8Array;
        const offsetX = dColumn * LAND_CLASS_CHUNK_CELLS + LEVEL_APRON_CELLS;
        const offsetZ = dRow * LAND_CLASS_CHUNK_CELLS + LEVEL_APRON_CELLS;
        const fromX = Math.max(0, -offsetX);
        const toX = Math.min(LAND_CLASS_CHUNK_CELLS, side - offsetX);
        const fromZ = Math.max(0, -offsetZ);
        const toZ = Math.min(LAND_CLASS_CHUNK_CELLS, side - offsetZ);
        for (let cellZ = fromZ; cellZ < toZ; cellZ += 1) {
          for (let cellX = fromX; cellX < toX; cellX += 1) {
            if (neighbour[cellZ * LAND_CLASS_CHUNK_CELLS + cellX] === CODE_BUILT_UP) {
              scratch[(cellZ + offsetZ) * side + cellX + offsetX] = 0;
            }
          }
        }
      }
    }
    chamfer(scratch, side);
    const level = new Uint8Array(CHUNK_BYTES);
    for (let cellZ = 0; cellZ < LAND_CLASS_CHUNK_CELLS; cellZ += 1) {
      const from = (cellZ + LEVEL_APRON_CELLS) * side + LEVEL_APRON_CELLS;
      for (let cellX = 0; cellX < LAND_CLASS_CHUNK_CELLS; cellX += 1) {
        const metres = scratch[from + cellX] as number;
        level[cellZ * LAND_CLASS_CHUNK_CELLS + cellX] =
          metres >= LEVEL_FAR ? LEVEL_FAR : Math.round(metres);
      }
    }
    levels.set(key, level);
  }
  return { levels, bytes: (measured + (onTheTown === undefined ? 0 : 1)) * CHUNK_BYTES };
}

/** A two-pass chamfer distance transform over a square grid, in place. */
function chamfer(grid: Float32Array, side: number): void {
  for (let z = 0; z < side; z += 1) {
    for (let x = 0; x < side; x += 1) {
      const at = z * side + x;
      let best = grid[at] as number;
      if (x > 0) best = Math.min(best, (grid[at - 1] as number) + SIDE_STEP);
      if (z > 0) {
        best = Math.min(best, (grid[at - side] as number) + SIDE_STEP);
        if (x > 0) best = Math.min(best, (grid[at - side - 1] as number) + DIAGONAL_STEP);
        if (x + 1 < side) best = Math.min(best, (grid[at - side + 1] as number) + DIAGONAL_STEP);
      }
      grid[at] = best;
    }
  }
  for (let z = side - 1; z >= 0; z -= 1) {
    for (let x = side - 1; x >= 0; x -= 1) {
      const at = z * side + x;
      let best = grid[at] as number;
      if (x + 1 < side) best = Math.min(best, (grid[at + 1] as number) + SIDE_STEP);
      if (z + 1 < side) {
        best = Math.min(best, (grid[at + side] as number) + SIDE_STEP);
        if (x + 1 < side) best = Math.min(best, (grid[at + side + 1] as number) + DIAGONAL_STEP);
        if (x > 0) best = Math.min(best, (grid[at + side - 1] as number) + DIAGONAL_STEP);
      }
      grid[at] = best;
    }
  }
}

/** Marks a covered box's cells `other`, making chunks as needed. `false` once the cap is reached. */
function markCovered(chunks: Map<number, Uint8Array>, box: Box, maxChunks: number): boolean {
  const firstColumn = Math.floor(box.minX / CHUNK_METRES);
  const lastColumn = Math.floor(box.maxX / CHUNK_METRES);
  const firstRow = Math.floor(box.minZ / CHUNK_METRES);
  const lastRow = Math.floor(box.maxZ / CHUNK_METRES);
  for (let row = firstRow; row <= lastRow; row += 1) {
    for (let column = firstColumn; column <= lastColumn; column += 1) {
      if (!inRange(column, row)) continue;
      const [x0, x1] = cellSpan(box.minX, box.maxX, column * CHUNK_METRES);
      const [z0, z1] = cellSpan(box.minZ, box.maxZ, row * CHUNK_METRES);
      // No cell centre in this chunk: make none, so the cap is not spent on nothing.
      if (x0 > x1 || z0 > z1) continue;
      const key = chunkKey(column, row);
      let chunk = chunks.get(key);
      if (chunk === undefined) {
        if (chunks.size >= maxChunks) return false;
        chunk = new Uint8Array(CHUNK_BYTES);
        chunks.set(key, chunk);
      }
      for (let cellZ = z0; cellZ <= z1; cellZ += 1) {
        const start = cellZ * LAND_CLASS_CHUNK_CELLS;
        // `other` is the least class, so writing it over a cell that holds it is nothing.
        chunk.fill(CODE_OTHER, start + x0, start + x1 + 1);
      }
    }
  }
  return true;
}

/**
 * Writes `code` into every covered cell of every existing chunk the polygon covers, where it outranks.
 * Returns the work it cost: edges times the rows of each chunk it rasterised.
 */
function paint(chunks: Map<number, Uint8Array>, feature: LandUseFeature, code: number): number {
  const outer = feature.rings[0];
  if (outer === undefined || outer.length < 6) return 0;
  let edges = 0;
  for (const ring of feature.rings) edges += ring.length / 2;
  let cost = 0;
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  for (let i = 0; i + 1 < outer.length; i += 2) {
    minX = Math.min(minX, outer[i] as number);
    maxX = Math.max(maxX, outer[i] as number);
    minZ = Math.min(minZ, outer[i + 1] as number);
    maxZ = Math.max(maxZ, outer[i + 1] as number);
  }
  for (let row = Math.floor(minZ / CHUNK_METRES); row <= Math.floor(maxZ / CHUNK_METRES); row++) {
    for (
      let column = Math.floor(minX / CHUNK_METRES);
      column <= Math.floor(maxX / CHUNK_METRES);
      column++
    ) {
      if (!inRange(column, row)) continue;
      const chunk = chunks.get(chunkKey(column, row));
      if (chunk === undefined) continue;
      const grid: GridSpec = {
        originX: column * CHUNK_METRES,
        originZ: row * CHUNK_METRES,
        cellMetres: LAND_CLASS_CELL_METRES,
        columns: LAND_CLASS_CHUNK_CELLS,
        rows: LAND_CLASS_CHUNK_CELLS,
      };
      cost += edges * LAND_CLASS_CHUNK_CELLS;
      rasterise(feature, grid, (cell) => {
        const held = chunk[cell] as number;
        // An uncovered cell stays `unknown`: a tile's buffer reaches past it.
        if (held !== 0 && held < code) chunk[cell] = code;
      });
    }
  }
  return cost;
}
