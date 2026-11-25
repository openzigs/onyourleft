// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **An open-world ride's world, planned one map tile at a time** — #2901.
 *
 * A route ride plans its world once, at the press, along its one route
 * (`footprint-buildings.ts`, `land-class.ts`, `cross-streets.ts`). An
 * open-world ride has no route in advance, and the spike #2882
 * (`docs/spikes/0041-rolling-route-and-a-turning-ride.md`, recommendation 3)
 * measured what re-planning against each new view costs: 0.3 to 2.4 s on the
 * main thread at every turn. So this module plans **per tile, from the tile
 * alone**: a tile's plan depends on its own features and the session's fixed
 * frame and on nothing about the route, so it is planned once, when the tile
 * is first wanted, and never again.
 *
 * ## What a plan holds
 *
 * Every part of a {@link TilePlan} is a typed array, so a plan crosses from the
 * worker that builds it (`tile-plan-worker.ts`) as transferred buffers
 * ({@link tilePlanBuffers}), never as a copy:
 *
 * - **Buildings** ({@link TileBuildings}): every footprint of the tile's
 *   block whose centroid lies in this tile, so a footprint two tiles both
 *   carry (a tile's buffer reaches past its edge) is planned by exactly one of
 *   them; its outer ring, centroid and mapped height, and its index in the
 *   block's list, which is where its tags are read back.
 * - **Land class** ({@link TileLand}): the class of every cell of the tile, on
 *   the same 5 m lattice `land-class.ts` §`landClassMask` builds, sampled from
 *   that mask built over the tile alone. The mask is an object with methods
 *   and cannot cross a thread (the spike's finding); its cells can.
 * - **Street geometry inputs** ({@link TileStreetLines}): the tile's own
 *   streets, each line with its width class (`cross-streets.ts`
 *   §`widthClassOf`) and its grade.
 * - **Water** ({@link TileWater}, #3105): the rivers, streams, canals,
 *   ditches and drains that pass through the tile, each line with its kind, and which of
 *   the land's `water` cells are a wetland. With the land's own `water` cells
 *   it is what `water-mask.ts` reads the ride's real water from.
 *
 * ## Detail
 *
 * {@link TilePlanDetail} `full` is what the worker plans. `reduced` is the
 * main thread's when no worker can be made (`tile-planner.ts`): the land class
 * on a 20 m lattice rather than 5 m, with no built-up land inferred from the
 * streets (`land-class.ts` §`LAND_CLASS_MAX_INFERENCE_WORK` at 0), so a plan
 * made on the page costs a fraction of one made in a worker.
 *
 * ⚠️ **Nothing here names a coordinate, a tile or a block in words** (ADR
 * 0004 D, the epic's hard rules): a plan is numbers, and a failure is said by
 * `tile-planner.ts` §`describeTilePlanFailure` alone.
 */

import {
  tileBox,
  type Box,
  type BuildingFeature,
  type CorridorFrame,
  type DecodedStreetFeature,
  type LandUseFeature,
  type StreetFeature,
  type TileId,
  type WaterLineFeature,
  WATER_LINE_KINDS,
} from '@onyourleft/map-features';

import { widthClassOf, type WidthClass } from '../cross-streets';
import {
  LAND_CLASS_CELL_METRES,
  LAND_CLASS_MAX_BYTES,
  LAND_CLASS_MAX_INFERENCE_WORK,
  LEVELLING_MAX_CHUNKS,
  landClassMask,
  landClassWork,
  type LandClass,
} from '../land-class';
import type { WorldCorridor } from '../world-data/corridor';

/** How much a plan holds: the worker's `full`, or the page's `reduced`. @see TILE_LAND_CELL_METRES */
export type TilePlanDetail = 'full' | 'reduced';

/**
 * The side of a land-class cell at each detail: **5 m** in full, the mask's own
 * cell, and **20 m** reduced — a sixteenth of the cells. *#2901's choice*.
 */
export const TILE_LAND_CELL_METRES: Readonly<Record<TilePlanDetail, number>> = {
  full: LAND_CLASS_CELL_METRES,
  reduced: 4 * LAND_CLASS_CELL_METRES,
};

/** Every land class, by its code in {@link TileLand.classes}: the code is the index. */
export const TILE_LAND_CLASSES: readonly LandClass[] = [
  'unknown',
  'water',
  'wood',
  'park',
  'built-up',
  'bare',
  'farmland',
  'other',
];

/** Every width class, by its code in {@link TileStreetLines.widthClasses}. */
export const TILE_WIDTH_CLASSES: readonly WidthClass[] = [
  'highway',
  'major',
  'minor',
  'service',
  'rail',
  'track',
  'bridleway',
];

/** Every street grade, by its code in {@link TileStreetLines.grades}. */
export const TILE_STREET_GRADES: readonly StreetFeature['grade'][] = ['ground', 'bridge', 'tunnel'];

/** Every water line kind, by its code in {@link TileWater.kinds}. */
export const TILE_WATER_LINE_KINDS: readonly WaterLineFeature['kind'][] = WATER_LINE_KINDS;

/** What one block holds for planning its tiles: what `area.ts` §`HeldBlock` decoded. */
export interface TileBlockFeatures {
  /** Every footprint the block's tiles carried, copies across their edges included. */
  readonly buildings: readonly BuildingFeature[];
  readonly landUse: readonly LandUseFeature[];
  /**
   * #3105: the block's rivers, streams, canals, ditches and drains
   * (`area.ts` §`HeldBlock.features.waterLines`). Absent is none.
   */
  readonly waterLines?: readonly WaterLineFeature[] | undefined;
  /** Each decoded tile's own streets (`area.ts` §`HeldBlock.streets`). */
  readonly tiles: readonly {
    readonly tile: TileId;
    readonly streets: readonly DecodedStreetFeature[];
  }[];
}

/** The footprints a tile plans. Footprint `i`'s ring is `rings[ringStarts[i]…ringStarts[i + 1]]`. */
export interface TileBuildings {
  readonly count: number;
  /** Each footprint's index in its block's {@link TileBlockFeatures.buildings}. */
  readonly source: Uint32Array;
  /** `x, z` a footprint: its outer ring's centroid. */
  readonly centroids: Float32Array;
  /** `count + 1` offsets into {@link rings}, in floats. */
  readonly ringStarts: Uint32Array;
  /** Every outer ring, `x, z` pairs, one after another. */
  readonly rings: Float32Array;
  /** Mapped height in metres, or `NaN` where the tile carries none. */
  readonly heights: Float32Array;
}

/**
 * A tile's land class on a grid: cell `(c, r)` is `[(column0 + c)·cellMetres,
 * (column0 + c + 1)·cellMetres)` in `x` and likewise in `z` from `row0`, and
 * its code is `classes[r · columns + c]`.
 */
export interface TileLand {
  readonly cellMetres: number;
  readonly column0: number;
  readonly row0: number;
  readonly columns: number;
  readonly rows: number;
  /** Indices into {@link TILE_LAND_CLASSES}. */
  readonly classes: Uint8Array;
}

/** A tile's streets. Street `i`'s line is `lines[lineStarts[i]…lineStarts[i + 1]]`. */
export interface TileStreetLines {
  readonly count: number;
  /** Indices into {@link TILE_WIDTH_CLASSES}. */
  readonly widthClasses: Uint8Array;
  /** Indices into {@link TILE_STREET_GRADES}. */
  readonly grades: Uint8Array;
  readonly lineStarts: Uint32Array;
  readonly lines: Float32Array;
}

/**
 * A tile's water lines and wetland — #3105. Line `i` is
 * `lines[lineStarts[i]…lineStarts[i + 1]]`. A line is the tile's when any
 * stretch of it passes through the tile's rectangle, so a line that crosses
 * two tiles is held by both, whole, and `water-mask.ts` §`waterLinesOf` reads
 * it once. A tile holds its water whichever of its neighbours is planned: only
 * the tiles the route crosses are (`tiles-ahead.ts`).
 */
export interface TileWater {
  readonly count: number;
  /** Indices into {@link TILE_WATER_LINE_KINDS}. */
  readonly kinds: Uint8Array;
  readonly lineStarts: Uint32Array;
  readonly lines: Float32Array;
  /**
   * One byte a cell of {@link TilePlan.land}, `1` where its `water` is a mapped
   * wetland (`land-class.ts` §`wetlandAt`); **empty** where the tile holds no
   * wetland, which is nearly every tile.
   */
  readonly wetland: Uint8Array;
}

/** One tile, planned. See the file's header. */
export interface TilePlan {
  readonly tile: TileId;
  readonly detail: TilePlanDetail;
  /** The tile's rectangle in the session's frame. */
  readonly box: Box;
  readonly buildings: TileBuildings;
  readonly land: TileLand;
  readonly streets: TileStreetLines;
  /** #3105: the tile's water lines and wetland. */
  readonly water: TileWater;
}

/** The centroid of a ring (`x, z` pairs, closed implicitly); its vertices' mean where it has no area. */
function ringCentroid(ring: Float32Array): { readonly x: number; readonly z: number } {
  const count = Math.floor(ring.length / 2);
  let area = 0;
  let cx = 0;
  let cz = 0;
  let mx = 0;
  let mz = 0;
  for (let i = 0; i < count; i += 1) {
    const ax = ring[i * 2] as number;
    const az = ring[i * 2 + 1] as number;
    const next = (i + 1) % count;
    const bx = ring[next * 2] as number;
    const bz = ring[next * 2 + 1] as number;
    const cross = ax * bz - bx * az;
    area += cross;
    cx += (ax + bx) * cross;
    cz += (az + bz) * cross;
    mx += ax;
    mz += az;
  }
  if (count === 0) return { x: Number.NaN, z: Number.NaN };
  if (Math.abs(area) < 1e-9) return { x: mx / count, z: mz / count };
  return { x: cx / (3 * area), z: cz / (3 * area) };
}

/**
 * Whether `(x, z)` is in `box`, half-open: the edge a tile shares with its
 * neighbour to the east (`minX`, since `x` is metres west) and to the south
 * (`minZ`) is its own, the other two its neighbours', so a point on an edge is
 * in exactly one tile. The two tiles compute the edge from one longitude or
 * latitude, so it is the same number in both.
 */
function inTileBox(box: Box, x: number, z: number): boolean {
  return x >= box.minX && x < box.maxX && z >= box.minZ && z < box.maxZ;
}

/**
 * How near two footprints' centroids are for one to be a copy of the other:
 * **1 m** — #2902, after #3060's rule. A tile carries a buffer past its edges,
 * so a footprint near an edge is in both tiles' features; each tile puts its
 * vertices on its own grid, about 0.3 m apart at z15, so the two copies'
 * centroids differ by less than that.
 */
export const TILE_COPY_METRES = 1;

/** The share of the larger's area the smaller must have to be its copy: **0.8**. */
export const TILE_COPY_AREA_SHARE = 0.8;

function ringArea(ring: Float32Array): number {
  const count = Math.floor(ring.length / 2);
  let twice = 0;
  for (let i = 0; i < count; i += 1) {
    const next = (i + 1) % count;
    twice +=
      (ring[i * 2] as number) * (ring[next * 2 + 1] as number) -
      (ring[next * 2] as number) * (ring[i * 2 + 1] as number);
  }
  return Math.abs(twice) / 2;
}

/** Whether two footprints carry the same tags: a part over its building is not its copy. */
function sameTags(a: BuildingFeature, b: BuildingFeature): boolean {
  return (
    a.kind === b.kind &&
    a.heightMetres === b.heightMetres &&
    a.minHeightMetres === b.minHeightMetres &&
    a.levels === b.levels &&
    a.buildingType === b.buildingType &&
    a.roofShape === b.roofShape &&
    a.landmark === b.landmark
  );
}

/**
 * The footprints `box` owns, each once. A footprint is the tile's when its
 * centroid is in the tile; a copy of one already taken — the same tags, its
 * centroid within {@link TILE_COPY_METRES} and its area within
 * {@link TILE_COPY_AREA_SHARE} — is not taken again, and of two copies the
 * larger is kept, the first read where they are the same size (#3060's rule).
 */
function ownedFootprints(
  buildings: readonly BuildingFeature[],
  box: Box,
): { readonly index: number; readonly x: number; readonly z: number }[] {
  const kept: { index: number; x: number; z: number; area: number }[] = [];
  const cells = new Map<string, number[]>();
  const cellOf = (x: number, z: number): [number, number] => [
    Math.floor(x / TILE_COPY_METRES),
    Math.floor(z / TILE_COPY_METRES),
  ];
  for (const [index, building] of buildings.entries()) {
    const outer = building.rings[0];
    if (outer === undefined || outer.length < 6) continue;
    const centroid = ringCentroid(outer);
    if (!inTileBox(box, centroid.x, centroid.z)) continue;
    const area = ringArea(outer);
    const [cx, cz] = cellOf(centroid.x, centroid.z);
    let copyOf: number | undefined;
    for (let dx = -1; dx <= 1 && copyOf === undefined; dx += 1) {
      for (let dz = -1; dz <= 1 && copyOf === undefined; dz += 1) {
        for (const at of cells.get(`${String(cx + dx)},${String(cz + dz)}`) ?? []) {
          const other = kept[at] as (typeof kept)[number];
          const larger = Math.max(area, other.area);
          if (
            Math.hypot(other.x - centroid.x, other.z - centroid.z) <= TILE_COPY_METRES &&
            larger > 0 &&
            Math.min(area, other.area) / larger >= TILE_COPY_AREA_SHARE &&
            sameTags(building, buildings[other.index] as BuildingFeature)
          ) {
            copyOf = at;
            break;
          }
        }
      }
    }
    if (copyOf === undefined) {
      const key = `${String(cx)},${String(cz)}`;
      const list = cells.get(key) ?? [];
      list.push(kept.length);
      cells.set(key, list);
      kept.push({ index, x: centroid.x, z: centroid.z, area });
    } else if (area > (kept[copyOf] as (typeof kept)[number]).area) {
      // The larger copy is kept, in the place the first was taken.
      kept[copyOf] = { index, x: centroid.x, z: centroid.z, area };
    }
  }
  return kept;
}

function planBuildings(buildings: readonly BuildingFeature[], box: Box): TileBuildings {
  const source: number[] = [];
  const centroids: number[] = [];
  const heights: number[] = [];
  const ringStarts: number[] = [0];
  let floats = 0;
  for (const { index, x, z } of ownedFootprints(buildings, box)) {
    const building = buildings[index] as BuildingFeature;
    const outer = building.rings[0] as Float32Array;
    const centroid = { x, z };
    source.push(index);
    centroids.push(centroid.x, centroid.z);
    heights.push(building.heightMetres ?? Number.NaN);
    floats += outer.length - (outer.length % 2);
    ringStarts.push(floats);
  }
  const rings = new Float32Array(floats);
  let at = 0;
  for (const index of source) {
    const outer = (buildings[index] as BuildingFeature).rings[0] as Float32Array;
    const even = outer.length - (outer.length % 2);
    rings.set(outer.subarray(0, even), at);
    at += even;
  }
  return {
    count: source.length,
    source: Uint32Array.from(source),
    centroids: Float32Array.from(centroids),
    ringStarts: Uint32Array.from(ringStarts),
    rings,
    heights: Float32Array.from(heights),
  };
}

function planLand(
  frame: CorridorFrame,
  block: TileBlockFeatures,
  box: Box,
  detail: TilePlanDetail,
): { readonly land: TileLand; readonly wetland: Uint8Array } {
  const cellMetres = TILE_LAND_CELL_METRES[detail];
  const streets = block.tiles.flatMap((each) => each.streets);
  // The tile alone, as a corridor of one covered box: the mask paints only the
  // chunks over it, and infers built-up land from the block's streets.
  const corridor: WorldCorridor = {
    routeId: 'open-world-tile',
    origin: { latitude: frame.latitude, longitude: frame.longitude, elevation: 0 },
    covered: (x, z) => inTileBox(box, x, z),
    coveredBoxes: [box],
    landUse: block.landUse,
    buildings: block.buildings,
    paths: [],
    streets,
  };
  const mask = landClassMask(
    corridor,
    LAND_CLASS_MAX_BYTES,
    landClassWork(corridor),
    detail === 'full' ? LEVELLING_MAX_CHUNKS : 0,
    detail === 'full' ? LAND_CLASS_MAX_INFERENCE_WORK : 0,
  );
  const column0 = Math.floor(box.minX / cellMetres);
  const row0 = Math.floor(box.minZ / cellMetres);
  const columns = Math.max(0, Math.floor(box.maxX / cellMetres) - column0 + 1);
  const rows = Math.max(0, Math.floor(box.maxZ / cellMetres) - row0 + 1);
  const classes = new Uint8Array(columns * rows);
  // #3105: which water cells are wetland, allocated only once one is.
  let wetland: Uint8Array | undefined;
  for (let r = 0; r < rows; r += 1) {
    const z = (row0 + r + 0.5) * cellMetres;
    for (let c = 0; c < columns; c += 1) {
      const x = (column0 + c + 0.5) * cellMetres;
      const land = mask.classAt(x, z);
      classes[r * columns + c] = Math.max(0, TILE_LAND_CLASSES.indexOf(land));
      if (land === 'water' && mask.wetlandAt(x, z)) {
        wetland ??= new Uint8Array(columns * rows);
        wetland[r * columns + c] = 1;
      }
    }
  }
  return {
    land: { cellMetres, column0, row0, columns, rows, classes },
    wetland: wetland ?? new Uint8Array(0),
  };
}

/**
 * Whether the segment from `(ax, az)` to `(bx, bz)` passes through `box`: the
 * stretch of it inside the box's four edges is not empty (Liang–Barsky). A
 * segment with a coordinate that is not finite passes through nothing.
 */
function segmentInBox(box: Box, ax: number, az: number, bx: number, bz: number): boolean {
  if (![ax, az, bx, bz].every(Number.isFinite)) return false;
  let from = 0;
  let to = 1;
  const edges: [number, number][] = [
    [ax - bx, ax - box.minX],
    [bx - ax, box.maxX - ax],
    [az - bz, az - box.minZ],
    [bz - az, box.maxZ - az],
  ];
  for (const [step, room] of edges) {
    if (step === 0) {
      if (room < 0) return false;
    } else if (step < 0) {
      from = Math.max(from, room / step);
    } else {
      to = Math.min(to, room / step);
    }
    if (from > to) return false;
  }
  return true;
}

/**
 * The water lines of its block that pass through `box` — #3105: each line
 * with a stretch inside the tile's rectangle, whole. A block's lines are each
 * of its tiles' own copy, clipped a buffer past that tile, so a copy's
 * vertices can all lie in the tiles beside the one it crosses; and only the
 * tiles the route crosses are planned (`tiles-ahead.ts`), so a line handed to
 * one tile alone would be lost whenever that tile is not planned. A line two
 * tiles both hold is read once (`water-mask.ts` §`waterLinesOf`).
 */
function planWater(block: TileBlockFeatures, box: Box, wetland: Uint8Array): TileWater {
  const owned: WaterLineFeature[] = [];
  for (const water of block.waterLines ?? []) {
    const line = water.line;
    for (let at = 0; at + 3 < line.length; at += 2) {
      if (
        segmentInBox(
          box,
          line[at] as number,
          line[at + 1] as number,
          line[at + 2] as number,
          line[at + 3] as number,
        )
      ) {
        owned.push(water);
        break;
      }
    }
  }
  const kinds = new Uint8Array(owned.length);
  const lineStarts = new Uint32Array(owned.length + 1);
  let floats = 0;
  for (const [index, water] of owned.entries()) {
    kinds[index] = Math.max(0, TILE_WATER_LINE_KINDS.indexOf(water.kind));
    floats += water.line.length - (water.line.length % 2);
    lineStarts[index + 1] = floats;
  }
  const lines = new Float32Array(floats);
  for (const [index, water] of owned.entries()) {
    const even = water.line.length - (water.line.length % 2);
    lines.set(water.line.subarray(0, even), lineStarts[index]);
  }
  return { count: owned.length, kinds, lineStarts, lines, wetland };
}

function planStreets(streets: readonly DecodedStreetFeature[]): TileStreetLines {
  const widthClasses = new Uint8Array(streets.length);
  const grades = new Uint8Array(streets.length);
  const lineStarts = new Uint32Array(streets.length + 1);
  let floats = 0;
  for (const [index, street] of streets.entries()) {
    widthClasses[index] = Math.max(0, TILE_WIDTH_CLASSES.indexOf(widthClassOf(street)));
    grades[index] = Math.max(0, TILE_STREET_GRADES.indexOf(street.grade));
    floats += street.line.length - (street.line.length % 2);
    lineStarts[index + 1] = floats;
  }
  const lines = new Float32Array(floats);
  for (const [index, street] of streets.entries()) {
    const even = street.line.length - (street.line.length % 2);
    lines.set(street.line.subarray(0, even), lineStarts[index]);
  }
  return { count: streets.length, widthClasses, grades, lineStarts, lines };
}

/**
 * `tile` of `block`, planned in `frame` at `detail`. Pure: the same tile, block
 * and frame give the same buffers, byte for byte, on any thread.
 */
export function planTile(
  frame: CorridorFrame,
  block: TileBlockFeatures,
  tile: TileId,
  detail: TilePlanDetail,
): TilePlan {
  const box = tileBox(frame, tile);
  const own = block.tiles.find((each) => each.tile.x === tile.x && each.tile.y === tile.y);
  const { land, wetland } = planLand(frame, block, box, detail);
  return {
    tile: { z: 15, x: tile.x, y: tile.y },
    detail,
    box: { minX: box.minX, minZ: box.minZ, maxX: box.maxX, maxZ: box.maxZ },
    buildings: planBuildings(block.buildings, box),
    land,
    streets: planStreets(own?.streets ?? []),
    water: planWater(block, box, wetland),
  };
}

/** Every buffer a plan holds: what a worker transfers rather than copies. */
export function tilePlanBuffers(plan: TilePlan): ArrayBuffer[] {
  const { buildings, land, streets, water } = plan;
  return [
    buildings.source,
    buildings.centroids,
    buildings.ringStarts,
    buildings.rings,
    buildings.heights,
    land.classes,
    streets.widthClasses,
    streets.grades,
    streets.lineStarts,
    streets.lines,
    water.kinds,
    water.lineStarts,
    water.lines,
    water.wetland,
  ].map((array) => array.buffer as ArrayBuffer);
}
