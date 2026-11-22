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

/** What one block holds for planning its tiles: what `area.ts` §`HeldBlock` decoded. */
export interface TileBlockFeatures {
  /** Every footprint the block's tiles carried, copies across their edges included. */
  readonly buildings: readonly BuildingFeature[];
  readonly landUse: readonly LandUseFeature[];
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

/** One tile, planned. See the file's header. */
export interface TilePlan {
  readonly tile: TileId;
  readonly detail: TilePlanDetail;
  /** The tile's rectangle in the session's frame. */
  readonly box: Box;
  readonly buildings: TileBuildings;
  readonly land: TileLand;
  readonly streets: TileStreetLines;
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

function planBuildings(buildings: readonly BuildingFeature[], box: Box): TileBuildings {
  const source: number[] = [];
  const centroids: number[] = [];
  const heights: number[] = [];
  const ringStarts: number[] = [0];
  let floats = 0;
  for (const [index, building] of buildings.entries()) {
    const outer = building.rings[0];
    if (outer === undefined || outer.length < 6) continue;
    const centroid = ringCentroid(outer);
    if (!inTileBox(box, centroid.x, centroid.z)) continue;
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
): TileLand {
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
  for (let r = 0; r < rows; r += 1) {
    const z = (row0 + r + 0.5) * cellMetres;
    for (let c = 0; c < columns; c += 1) {
      const x = (column0 + c + 0.5) * cellMetres;
      classes[r * columns + c] = Math.max(0, TILE_LAND_CLASSES.indexOf(mask.classAt(x, z)));
    }
  }
  return { cellMetres, column0, row0, columns, rows, classes };
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
  return {
    tile: { z: 15, x: tile.x, y: tile.y },
    detail,
    box: { minX: box.minX, minZ: box.minZ, maxX: box.maxX, maxZ: box.maxZ },
    buildings: planBuildings(block.buildings, box),
    land: planLand(frame, block, box, detail),
    streets: planStreets(own?.streets ?? []),
  };
}

/** Every buffer a plan holds: what a worker transfers rather than copies. */
export function tilePlanBuffers(plan: TilePlan): ArrayBuffer[] {
  const { buildings, land, streets } = plan;
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
  ].map((array) => array.buffer as ArrayBuffer);
}
