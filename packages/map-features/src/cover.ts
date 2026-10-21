// SPDX-License-Identifier: Apache-2.0

import type { GeographicPosition } from '@onyourleft/domain';

import {
  columnAtLongitude,
  localMetres,
  METRES_PER_DEGREE_LATITUDE,
  rowAtLatitude,
  tileBounds,
  TILES_AT_Z15,
} from './projection';
import type { Box, CorridorFrame, TileId } from './types';

/**
 * The z15 tiles a route's corridor touches, in route order (#1544).
 *
 * The corridor is every point within `halfWidthMetres` of the route's line, and
 * a tile is in the cover when any of it lies in the corridor. Distances are
 * measured in the corridor frame the world is drawn in (`projection.ts`), with
 * the route's first position as its origin — which is the game's
 * `corridorOrigin`. In that frame a tile is an axis-aligned rectangle exactly,
 * because its edges are a meridian and a parallel, so "touches" is an exact
 * rectangle-to-segment distance rather than a sampled one.
 *
 * **Route order** is the order the corridor first reaches each tile: the
 * smallest distance along the route at which a point of the route lies within
 * `halfWidthMetres` of it. Ties go north to south, then west to east. The cap
 * keeps the first `maxTiles` in that order, so a corridor past the cap is the
 * route's beginning, never an arbitrary subset (#1538's P-3: past the cap, the
 * world is procedural).
 */
export function corridorTileCover(
  positions: readonly GeographicPosition[],
  halfWidthMetres: number,
  maxTiles: number,
): readonly TileId[] {
  const first = positions[0];
  if (first === undefined || maxTiles <= 0) return [];
  const frame: CorridorFrame = { latitude: first.latitude, longitude: first.longitude };
  const metresPerDegreeLongitude =
    METRES_PER_DEGREE_LATITUDE * Math.cos((frame.latitude * Math.PI) / 180);
  const points = positions.map((position) =>
    localMetres(frame, position.longitude, position.latitude),
  );

  const cover: TileId[] = [];
  const seen = new Set<number>();
  let along = 0;
  const segmentCount = Math.max(1, points.length - 1);
  for (let i = 0; i < segmentCount; i++) {
    const a = points[i] as { x: number; z: number };
    const b = (points[i + 1] ?? a) as { x: number; z: number };
    const length = Math.hypot(b.x - a.x, b.z - a.z);

    // The rows the segment's box, widened by the half-width, overlaps. Within a
    // row only the columns the widened segment can reach are tried, so the work
    // follows the line (rows plus tiles touched), not the box's area: a segment
    // across a continent is a thin diagonal, not millions of candidates.
    const northZ = Math.max(a.z, b.z) + halfWidthMetres;
    const southZ = Math.min(a.z, b.z) - halfWidthMetres;
    const lowRow = clampTile(rowAtLatitude(frame.latitude + northZ / METRES_PER_DEGREE_LATITUDE));
    const highRow = clampTile(rowAtLatitude(frame.latitude + southZ / METRES_PER_DEGREE_LATITUDE));

    const touched: { tile: TileId; key: number }[] = [];
    for (let y = lowRow; y <= highRow; y++) {
      const band = tileBox(frame, { z: 15, x: 0, y });
      const reach = xReach(a, b, band.minZ - halfWidthMetres, band.maxZ + halfWidthMetres);
      if (reach === null) continue;
      const lowColumn = clampTile(
        columnAtLongitude(
          frame.longitude - (reach.max + halfWidthMetres) / metresPerDegreeLongitude,
        ),
      );
      const highColumn = clampTile(
        columnAtLongitude(
          frame.longitude - (reach.min - halfWidthMetres) / metresPerDegreeLongitude,
        ),
      );
      for (let x = lowColumn; x <= highColumn; x++) {
        const id = y * TILES_AT_Z15 + x;
        if (seen.has(id)) continue;
        const tile: TileId = { z: 15, x, y };
        const box = tileBox(frame, tile);
        const t = firstTouch(a, b, box, halfWidthMetres);
        if (t === null) continue;
        seen.add(id);
        touched.push({ tile, key: along + t * length });
      }
    }
    touched.sort((p, q) => p.key - q.key || p.tile.y - q.tile.y || p.tile.x - q.tile.x);
    for (const { tile } of touched) cover.push(tile);
    if (cover.length >= maxTiles) return cover.slice(0, maxTiles);
    along += length;
  }
  return cover;
}

/** The `x` extent of the part of segment `ab` with `z` in `[lowZ, highZ]`, or `null`. */
function xReach(
  a: Point,
  b: Point,
  lowZ: number,
  highZ: number,
): { min: number; max: number } | null {
  const dz = b.z - a.z;
  let t0 = 0;
  let t1 = 1;
  if (dz === 0) {
    if (a.z < lowZ || a.z > highZ) return null;
  } else {
    const p = (lowZ - a.z) / dz;
    const q = (highZ - a.z) / dz;
    t0 = Math.max(0, Math.min(p, q));
    t1 = Math.min(1, Math.max(p, q));
    if (t0 > t1) return null;
  }
  const x0 = a.x + t0 * (b.x - a.x);
  const x1 = a.x + t1 * (b.x - a.x);
  return { min: Math.min(x0, x1), max: Math.max(x0, x1) };
}

function clampTile(fractional: number): number {
  return Math.min(TILES_AT_Z15 - 1, Math.max(0, Math.floor(fractional)));
}

/** A tile's rectangle in the frame's local metres (`x` west, `z` north). */
export function tileBox(frame: CorridorFrame, tile: TileId): Box {
  const bounds = tileBounds(tile);
  const northWest = localMetres(frame, bounds.west, bounds.north);
  const southEast = localMetres(frame, bounds.east, bounds.south);
  return { minX: southEast.x, maxX: northWest.x, minZ: southEast.z, maxZ: northWest.z };
}

type Point = { readonly x: number; readonly z: number };

function pointBoxDistance(x: number, z: number, box: Box): number {
  const dx = Math.max(box.minX - x, 0, x - box.maxX);
  const dz = Math.max(box.minZ - z, 0, z - box.maxZ);
  return Math.hypot(dx, dz);
}

/**
 * The smallest `t` in `[0, 1]` at which `a + t(b − a)` is within `reach` of the
 * box, or `null` when no point of the segment is. The distance to a convex set
 * is convex along a line, so the minimum is found by a ternary search and the
 * first point inside the reach by bisection before it.
 */
function firstTouch(a: Point, b: Point, box: Box, reach: number): number | null {
  const at = (t: number): number =>
    pointBoxDistance(a.x + t * (b.x - a.x), a.z + t * (b.z - a.z), box);
  if (at(0) <= reach) return 0;
  let low = 0;
  let high = 1;
  for (let i = 0; i < 60; i++) {
    const m1 = low + (high - low) / 3;
    const m2 = high - (high - low) / 3;
    if (at(m1) <= at(m2)) high = m2;
    else low = m1;
  }
  let best = (low + high) / 2;
  if (at(best) > reach) {
    if (at(1) > reach) return null;
    best = 1;
  }
  let outside = 0;
  let inside = best;
  for (let i = 0; i < 60; i++) {
    const mid = (outside + inside) / 2;
    if (at(mid) <= reach) inside = mid;
    else outside = mid;
  }
  return inside;
}
