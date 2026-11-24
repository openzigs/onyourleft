// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **An open-world ride's real water, as the scene reads a land mask** — #3105.
 *
 * Until now an open-world ride drew no real water: its scene was handed no
 * land mask at all (`GameView.tsx` builds one from a route's corridor, and an
 * open-world ride has none), so a river the rider crossed was grass, and the
 * only water was invented from the view's own heights (`waterways.ts`
 * §`findWaterways`). Everything that draws the map's water already reads it
 * off a `LandClassMask` (`waterways.ts` §`besideTheMap`: the lakes and the
 * coast beside the road, the crossings the road is bridged over, the channels
 * beside it), so {@link WaterMaskKeeper}'s is that mask for an open world,
 * put together from the tiles the planner holds (`tile-plan.ts`
 * §`TilePlan.land` and §`TileWater`) and in their frame, the session's, which
 * is the one the whole ride is drawn in.
 *
 * ## Water, and nothing else
 *
 * ⚠️ **Every class but `water` reads `unknown` here**, whatever the tile's
 * land holds. The scene's placement rules read a mask's other classes (no tree
 * on built-up land, a lot where the land is built-up, planting by wood and
 * farmland), and an open-world ride's land use is not this issue's: handing
 * them over would change every open-world ride's scenery. So this is the water
 * and its wetland alone, and with no water held it is no mask at all
 * (`undefined`): an open-world ride away from water is drawn exactly as it was.
 *
 * ## `covered` is the water's buffer
 *
 * A route's mask is covered wherever its corridor was read, and `waterways.ts`
 * reads that as "the map says where water is and is not here", dropping every
 * invented stream and lake on covered road. Here {@link LandClassMask.covered}
 * is true within {@link REAL_WATER_BUFFER_METRES} of the real water and nowhere
 * else, so no invented water is placed over or beside a real water body, and
 * away from one the invented water is the ride's as before.
 *
 * ## One object while the water is the same
 *
 * The scene keeps what it builds against the mask object (`waterways.ts`
 * §`computed`, `nearby-streets.ts` §`built`), so {@link WaterMaskKeeper}
 * hands back the same mask until a tile that holds water is planned or let
 * go. A tile with none changes nothing.
 *
 * ⚠️ **Nothing here names a coordinate, a tile or a block in words** (ADR
 * 0004 D): a mask is numbers.
 */

import type { WaterLineFeature } from '@onyourleft/map-features';

import { NO_LAND_CLASS, type LandClass, type LandClassMask } from '../land-class';
import { TILE_LAND_CLASSES, TILE_WATER_LINE_KINDS, type TilePlan } from './tile-plan';

/**
 * How far from real water no invented water is placed, in metres: **200**.
 * *#3105's choice*: a little more than twice how far along the road a
 * stream's channel shapes the ground either side of it (96 m,
 * `waterways.ts` §`STREAM_ALONG_REACH_METRES`), so an invented stream's banks
 * never meet a real river's, and well past an invented lake's own reach from
 * its middle (61 m).
 */
export const REAL_WATER_BUFFER_METRES = 200;

/**
 * The side of a cell of the buffer's grid, in metres: **50**. The buffer is
 * measured in whole cells, square, so it reaches between
 * {@link REAL_WATER_BUFFER_METRES} and that plus a cell and a half.
 */
export const WATER_BUFFER_CELL_METRES = 50;

const WATER_CODE = TILE_LAND_CLASSES.indexOf('water');

const holds = new WeakMap<TilePlan, boolean>();

/** Whether a tile's plan holds any real water: a water line through it, or a `water` cell. */
export function tileHoldsWater(plan: TilePlan): boolean {
  let known = holds.get(plan);
  if (known === undefined) {
    known = plan.water.count > 0 || plan.land.classes.includes(WATER_CODE);
    holds.set(plan, known);
  }
  return known;
}

/** `tile-plan.ts` §`inTileBox`: half-open, so a point on an edge is in one tile. */
function inBox(plan: TilePlan, x: number, z: number): boolean {
  const { box } = plan;
  return x >= box.minX && x < box.maxX && z >= box.minZ && z < box.maxZ;
}

/** The index of the land cell of `plan` at `(x, z)`, or −1 off its lattice. */
function cellAt(plan: TilePlan, x: number, z: number): number {
  const { cellMetres, column0, row0, columns, rows } = plan.land;
  const column = Math.floor(x / cellMetres) - column0;
  const row = Math.floor(z / cellMetres) - row0;
  if (!(column >= 0 && column < columns && row >= 0 && row < rows)) return -1;
  return row * columns + column;
}

/** Whether two lines are the same line, float for float. */
function sameLine(a: Float32Array, b: Float32Array): boolean {
  if (a.length !== b.length) return false;
  for (let at = 0; at < a.length; at += 1) {
    if (!Object.is(a[at], b[at])) return false;
  }
  return true;
}

/**
 * The water lines the tiles hold, as the features they were decoded as, **each
 * once**: a line that crosses two tiles is held by both
 * (`tile-plan.ts` §`TileWater`), and a line read twice would be crossed and
 * filed twice by everything that reads the mask's lines.
 */
function waterLinesOf(tiles: readonly TilePlan[]): WaterLineFeature[] {
  const lines: WaterLineFeature[] = [];
  /** The lines kept so far, by kind, length and first vertex: the few a copy can be. */
  const kept = new Map<string, WaterLineFeature[]>();
  for (const { water } of tiles) {
    for (let index = 0; index < water.count; index += 1) {
      const kind = TILE_WATER_LINE_KINDS[water.kinds[index] as number];
      if (kind === undefined) continue;
      const line = water.lines.subarray(water.lineStarts[index], water.lineStarts[index + 1]);
      const key = `${kind}:${String(line.length)}:${String(line[0])}:${String(line[1])}`;
      const alike = kept.get(key);
      if (alike?.some((other) => sameLine(other.line, line)) === true) continue;
      const feature: WaterLineFeature = { kind, line };
      if (alike === undefined) kept.set(key, [feature]);
      else alike.push(feature);
      lines.push(feature);
    }
  }
  return lines;
}

/** Where the real water's buffer reaches: a bitmap of {@link WATER_BUFFER_CELL_METRES} cells. */
interface Buffer {
  readonly column0: number;
  readonly row0: number;
  readonly columns: number;
  readonly rows: number;
  readonly near: Uint8Array;
}

/**
 * The buffer round every water cell and water line of `tiles`: each marked in
 * a grid over the tiles' own rectangles and the buffer past them, then spread
 * {@link REAL_WATER_BUFFER_METRES} every way, a row pass and a column pass.
 * Bounded by the tiles held (36 at most): a line's vertex off the grid marks
 * nothing, and a segment is walked at most the grid's own size in steps.
 */
function bufferOf(tiles: readonly TilePlan[], lines: readonly WaterLineFeature[]): Buffer {
  const cell = WATER_BUFFER_CELL_METRES;
  const reach = Math.ceil(REAL_WATER_BUFFER_METRES / cell);
  let minX = Number.POSITIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  for (const { box } of tiles) {
    minX = Math.min(minX, box.minX);
    minZ = Math.min(minZ, box.minZ);
    maxX = Math.max(maxX, box.maxX);
    maxZ = Math.max(maxZ, box.maxZ);
  }
  const column0 = Math.floor(minX / cell) - reach;
  const row0 = Math.floor(minZ / cell) - reach;
  const columns = Math.floor(maxX / cell) + reach - column0 + 1;
  const rows = Math.floor(maxZ / cell) + reach - row0 + 1;
  const wet = new Uint8Array(columns * rows);
  const mark = (x: number, z: number): void => {
    const column = Math.floor(x / cell) - column0;
    const row = Math.floor(z / cell) - row0;
    if (column >= 0 && column < columns && row >= 0 && row < rows) wet[row * columns + column] = 1;
  };
  for (const { land } of tiles) {
    for (let r = 0; r < land.rows; r += 1) {
      for (let c = 0; c < land.columns; c += 1) {
        if (land.classes[r * land.columns + c] !== WATER_CODE) continue;
        mark((land.column0 + c + 0.5) * land.cellMetres, (land.row0 + r + 0.5) * land.cellMetres);
      }
    }
  }
  const mostSteps = 2 * (columns + rows);
  for (const { line } of lines) {
    for (let at = 0; at + 3 < line.length; at += 2) {
      const ax = line[at] as number;
      const az = line[at + 1] as number;
      const bx = line[at + 2] as number;
      const bz = line[at + 3] as number;
      if (![ax, az, bx, bz].every(Number.isFinite)) continue;
      const steps = Math.min(mostSteps, Math.ceil(Math.hypot(bx - ax, bz - az) / (cell / 2)));
      for (let step = 0; step <= steps; step += 1) {
        const share = steps === 0 ? 0 : step / steps;
        mark(ax + (bx - ax) * share, az + (bz - az) * share);
      }
    }
  }
  // Spread along each row, then along each column: a square of `reach` cells.
  const along = new Uint8Array(columns * rows);
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < columns; c += 1) {
      if (wet[r * columns + c] !== 1) continue;
      const from = Math.max(0, c - reach);
      const to = Math.min(columns - 1, c + reach);
      along.fill(1, r * columns + from, r * columns + to + 1);
    }
  }
  const near = new Uint8Array(columns * rows);
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < columns; c += 1) {
      if (along[r * columns + c] !== 1) continue;
      const from = Math.max(0, r - reach);
      const to = Math.min(rows - 1, r + reach);
      for (let row = from; row <= to; row += 1) near[row * columns + c] = 1;
    }
  }
  return { column0, row0, columns, rows, near };
}

function maskOf(tiles: readonly TilePlan[]): LandClassMask {
  const waterLines = waterLinesOf(tiles);
  const buffer = bufferOf(tiles, waterLines);
  /** The tile the last lookup fell in: a reader walks along a road, tile by tile. */
  let last: TilePlan | undefined;
  const tileAt = (x: number, z: number): TilePlan | undefined => {
    if (last !== undefined && inBox(last, x, z)) return last;
    for (const tile of tiles) {
      if (inBox(tile, x, z)) {
        last = tile;
        return tile;
      }
    }
    return undefined;
  };
  const waterAt = (x: number, z: number): { tile: TilePlan; cell: number } | undefined => {
    const tile = tileAt(x, z);
    if (tile === undefined) return undefined;
    const cell = cellAt(tile, x, z);
    return cell >= 0 && tile.land.classes[cell] === WATER_CODE ? { tile, cell } : undefined;
  };
  let bytes = buffer.near.byteLength;
  for (const tile of tiles) bytes += tile.land.classes.byteLength;
  return {
    ...NO_LAND_CLASS,
    classAt: (x, z): LandClass => (waterAt(x, z) === undefined ? 'unknown' : 'water'),
    wetlandAt: (x, z) => {
      const found = waterAt(x, z);
      return found !== undefined && found.tile.water.wetland[found.cell] === 1;
    },
    covered: (x, z) => {
      const column = Math.floor(x / WATER_BUFFER_CELL_METRES) - buffer.column0;
      const row = Math.floor(z / WATER_BUFFER_CELL_METRES) - buffer.row0;
      return (
        column >= 0 &&
        column < buffer.columns &&
        row >= 0 &&
        row < buffer.rows &&
        buffer.near[row * buffer.columns + column] === 1
      );
    },
    waterLines,
    bytes,
  };
}

/**
 * A ride's real water as a land mask, or `undefined` where no tile planned
 * holds any — the same object while the tiles that hold water are the same
 * plans, a new one only when one is planned or let go. See the file's header
 * for what the mask answers and what it does not.
 */
export class WaterMaskKeeper {
  #tiles = new Set<TilePlan>();
  #mask: LandClassMask | undefined;

  /** The mask of `plans`' water: the last one handed out where their water tiles are unchanged. */
  of(plans: Iterable<TilePlan>): LandClassMask | undefined {
    const tiles = [...plans].filter(tileHoldsWater);
    if (tiles.length === this.#tiles.size && tiles.every((tile) => this.#tiles.has(tile))) {
      return this.#mask;
    }
    this.#tiles = new Set(tiles);
    this.#mask = tiles.length === 0 ? undefined : maskOf(tiles);
    return this.#mask;
  }
}
