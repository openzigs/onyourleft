// SPDX-License-Identifier: Apache-2.0

import {
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  type GeographicPosition,
} from '@onyourleft/domain';
import { describe, expect, it } from 'vitest';

import { corridorTileCover } from './cover';
import type { TileId } from './types';

const START = { latitude: 40.0153, longitude: -105.2705 };
const HALF_WIDTH = 250;
const K = 111_320 * Math.cos((START.latitude * Math.PI) / 180);

/** A point `x` metres WEST and `z` metres north of the start, in the game's frame. */
function at(x: number, z: number): GeographicPosition {
  return geographicPosition(
    degreesLatitude(START.latitude + z / 111_320),
    degreesLongitude(START.longitude - x / K),
  );
}

/**
 * A synthetic 50 km zig-zag heading east: ten 5 km legs alternating north-east
 * and south-east, a point every 250 m. Arithmetic only.
 */
function zigZagRoute(): { positions: GeographicPosition[]; local: { x: number; z: number }[] } {
  const local: { x: number; z: number }[] = [{ x: 0, z: 0 }];
  for (let leg = 0; leg < 10; leg++) {
    const bearing = leg % 2 === 0 ? Math.PI / 4 : (3 * Math.PI) / 4; // from north, clockwise
    for (let step = 1; step <= 20; step++) {
      const last = local[local.length - 1] as { x: number; z: number };
      // East is −x in this frame.
      local.push({ x: last.x - 250 * Math.sin(bearing), z: last.z + 250 * Math.cos(bearing) });
    }
  }
  return { positions: local.map((p) => at(p.x, p.z)), local };
}

/** A tile's box in the frame, from the tile scheme directly (not through `cover.ts`). */
function box(tile: TileId): { minX: number; maxX: number; minZ: number; maxZ: number } {
  const n = 2 ** 15;
  const lon = (x: number): number => (x / n) * 360 - 180;
  const lat = (y: number): number =>
    (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI;
  const xOf = (longitude: number): number => (START.longitude - longitude) * K;
  const zOf = (latitude: number): number => (latitude - START.latitude) * 111_320;
  return {
    minX: xOf(lon(tile.x + 1)),
    maxX: xOf(lon(tile.x)),
    minZ: zOf(lat(tile.y + 1)),
    maxZ: zOf(lat(tile.y)),
  };
}

function distanceToBox(x: number, z: number, b: ReturnType<typeof box>): number {
  return Math.hypot(Math.max(b.minX - x, 0, x - b.maxX), Math.max(b.minZ - z, 0, z - b.maxZ));
}

/**
 * The brute-force cover: the route sampled every metre, and for each sample
 * every tile of the 5 × 5 block around it measured. Returns each tile's
 * smallest distance and the route distance at which it was first within reach.
 */
function bruteForce(
  local: readonly { x: number; z: number }[],
): Map<string, { tile: TileId; nearest: number; first: number }> {
  const out = new Map<string, { tile: TileId; nearest: number; first: number }>();
  const n = 2 ** 15;
  let along = 0;
  for (let i = 0; i + 1 < local.length; i++) {
    const a = local[i] as { x: number; z: number };
    const b = local[i + 1] as { x: number; z: number };
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    for (let s = 0; s <= length; s += 1) {
      const x = a.x + ((b.x - a.x) * s) / length;
      const z = a.z + ((b.z - a.z) * s) / length;
      const longitude = START.longitude - x / K;
      const latitude = START.latitude + z / 111_320;
      const cx = Math.floor(((longitude + 180) / 360) * n);
      const cy = Math.floor(
        ((1 - Math.asinh(Math.tan((latitude * Math.PI) / 180)) / Math.PI) / 2) * n,
      );
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const tile: TileId = { z: 15, x: cx + dx, y: cy + dy };
          const d = distanceToBox(x, z, box(tile));
          const key = `${String(tile.x)}/${String(tile.y)}`;
          const seen = out.get(key);
          if (seen === undefined)
            out.set(key, {
              tile,
              nearest: d,
              first: d <= HALF_WIDTH ? along + s : Number.POSITIVE_INFINITY,
            });
          else {
            seen.nearest = Math.min(seen.nearest, d);
            if (d <= HALF_WIDTH && seen.first === Number.POSITIVE_INFINITY) seen.first = along + s;
          }
        }
      }
    }
    along += length;
  }
  return out;
}

const keyOf = (tile: TileId): string => `${String(tile.x)}/${String(tile.y)}`;

describe('corridorTileCover on a 50 km zig-zag at ±250 m', () => {
  const route = zigZagRoute();
  const cover = corridorTileCover(route.positions, HALF_WIDTH, 10_000);
  const brute = bruteForce(route.local);

  it('is deduplicated and all z15', () => {
    expect(new Set(cover.map(keyOf)).size).toBe(cover.length);
    expect(cover.every((t) => t.z === 15)).toBe(true);
    expect(cover.length).toBeGreaterThan(100);
  });

  it('holds every tile the corridor touches', () => {
    const got = new Set(cover.map(keyOf));
    const missing = [...brute.values()].filter(
      (t) => t.nearest <= HALF_WIDTH && !got.has(keyOf(t.tile)),
    );
    expect(missing).toEqual([]);
  });

  it('holds no tile the corridor does not touch (to the 1 m the brute force samples at)', () => {
    for (const tile of cover) {
      const measured = brute.get(keyOf(tile));
      expect(measured, keyOf(tile)).toBeDefined();
      expect((measured as { nearest: number }).nearest).toBeLessThanOrEqual(HALF_WIDTH + 1);
    }
  });

  it('is in route order: the order the corridor first reaches each tile', () => {
    const firsts = cover.map((tile) => (brute.get(keyOf(tile)) as { first: number }).first);
    for (let i = 1; i < firsts.length; i++) {
      // The brute force finds a first touch up to a metre late.
      expect(firsts[i] as number).toBeGreaterThanOrEqual((firsts[i - 1] as number) - 1);
    }
  });

  it('keeps the first maxTiles along the route, not an arbitrary subset', () => {
    for (const cap of [1, 7, 50, cover.length - 3]) {
      const capped = corridorTileCover(route.positions, HALF_WIDTH, cap);
      expect(capped).toEqual(cover.slice(0, cap));
      // Every tile kept is reached no later than every tile dropped.
      const kept = capped.map((t) => (brute.get(keyOf(t)) as { first: number }).first);
      const dropped = cover.slice(cap).map((t) => (brute.get(keyOf(t)) as { first: number }).first);
      expect(Math.max(...kept)).toBeLessThanOrEqual(Math.min(...dropped) + 1);
    }
  });
});

describe('corridorTileCover at the edges', () => {
  it('no positions, or a cap of 0, is no tiles', () => {
    expect(corridorTileCover([], 250, 600)).toEqual([]);
    expect(corridorTileCover([at(0, 0)], 250, 0)).toEqual([]);
  });

  it('one position is the tiles within reach of that point', () => {
    const cover = corridorTileCover([at(0, 0)], 250, 600);
    expect(cover.length).toBeGreaterThanOrEqual(1);
    expect(cover.length).toBeLessThanOrEqual(4);
  });

  it('stays fast on a hostile continent-long segment and a glitch to (0,0)', () => {
    const glitch = geographicPosition(degreesLatitude(0), degreesLongitude(0));
    const started = performance.now();
    const cover = corridorTileCover([at(0, 0), glitch, at(0, 0)], HALF_WIDTH, 600);
    const long = corridorTileCover([at(0, 0), at(0, 1_000_000)], HALF_WIDTH, 1_000_000);
    expect(cover).toHaveLength(600);
    expect(long.length).toBeGreaterThan(700);
    expect(long.length).toBeLessThan(3_000);
    expect(performance.now() - started).toBeLessThan(1_000);
  });
});
