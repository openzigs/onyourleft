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

const CHUNK_METRES = LAND_CLASS_CELL_METRES * LAND_CLASS_CHUNK_CELLS;
const CHUNK_BYTES = LAND_CLASS_CHUNK_CELLS * LAND_CLASS_CHUNK_CELLS;

/**
 * Chunk columns and rows either side of the origin a key can name: 8 192
 * chunks, 2 621 km. Past it is `unknown`. Small enough that every key is a
 * small integer, which a `Map` looks up without boxing a number.
 */
const CHUNK_RANGE = 2 ** 13;
const CHUNK_STRIDE = 2 * CHUNK_RANGE;

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

/** Answers "what is the ground here?" in the corridor's local metres. */
export interface LandClassMask {
  /** O(1), no allocation. `'unknown'` outside every covered chunk. */
  classAt(x: number, z: number): LandClass;
  /** True where the corridor is covered (P-8), whatever the class. */
  covered(x: number, z: number): boolean;
  /** What the mask holds, for the budget. */
  readonly bytes: number;
}

/** Everything `unknown`: today's world, and what the scene takes with no corridor. */
export const NO_LAND_CLASS: LandClassMask = Object.freeze({
  classAt: (): LandClass => 'unknown',
  covered: (): boolean => false,
  bytes: 0,
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
  for (const feature of corridor.landUse) {
    const code = CLASS_OF_CODE.indexOf(landClassOfKind(feature.layer, feature.kind));
    paint(chunks, feature, code);
  }

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
  return {
    classAt,
    covered: (x, z) => classAt(x, z) !== 'unknown',
    bytes: chunks.size * CHUNK_BYTES,
  };
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
      const key = chunkKey(column, row);
      let chunk = chunks.get(key);
      if (chunk === undefined) {
        if (chunks.size >= maxChunks) return false;
        chunk = new Uint8Array(CHUNK_BYTES);
        chunks.set(key, chunk);
      }
      const [x0, x1] = cellSpan(box.minX, box.maxX, column * CHUNK_METRES);
      const [z0, z1] = cellSpan(box.minZ, box.maxZ, row * CHUNK_METRES);
      if (x0 > x1) continue;
      for (let cellZ = z0; cellZ <= z1; cellZ += 1) {
        const start = cellZ * LAND_CLASS_CHUNK_CELLS;
        // `other` is the least class, so writing it over a cell that holds it is nothing.
        chunk.fill(CODE_OTHER, start + x0, start + x1 + 1);
      }
    }
  }
  return true;
}

/** Writes `code` into every covered cell of every existing chunk the polygon covers, where it outranks. */
function paint(chunks: Map<number, Uint8Array>, feature: LandUseFeature, code: number): void {
  const outer = feature.rings[0];
  if (outer === undefined || outer.length < 6) return;
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
      rasterise(feature, grid, (cell) => {
        const held = chunk[cell] as number;
        // An uncovered cell stays `unknown`: a tile's buffer reaches past it.
        if (held !== 0 && held < code) chunk[cell] = code;
      });
    }
  }
}
