// SPDX-License-Identifier: Apache-2.0

import type { CorridorFrame, TileId } from './types';

/**
 * The game's projection, restated (#1544).
 *
 * `apps/web/src/game/terrain.ts` §`localGroundPosition` is the one projection
 * the world is drawn in: equirectangular about the route's first point, `x`
 * metres **WEST** of it and `z` metres north. This package may not import it
 * (CLAUDE.md §3: nothing under `packages/` imports from `apps/`), so the formula
 * is written out again here, and
 * `apps/web/src/game/map-features-projection.test.ts` holds the two equal over
 * a grid from 70° S to 70° N. A sign flipped here would put every footprint in
 * the mirror image of its town — #583's defect.
 */

/** The same constant as `terrain.ts`: metres in one degree of latitude. */
export const METRES_PER_DEGREE_LATITUDE = 111_320;

/** Tiles along one side of the world at z15. */
export const TILES_AT_Z15 = 2 ** 15;

/** A longitude and latitude in the corridor frame's local metres. */
export function localMetres(
  frame: CorridorFrame,
  longitude: number,
  latitude: number,
): { readonly x: number; readonly z: number } {
  const metresPerDegreeLongitude =
    METRES_PER_DEGREE_LATITUDE * Math.cos((frame.latitude * Math.PI) / 180);
  return {
    x: (frame.longitude - longitude) * metresPerDegreeLongitude,
    z: (latitude - frame.latitude) * METRES_PER_DEGREE_LATITUDE,
  };
}

/** The longitude at a fractional z15 tile column. */
export function longitudeAtColumn(column: number): number {
  return (column / TILES_AT_Z15) * 360 - 180;
}

/** The latitude at a fractional z15 tile row (Web Mercator, row 0 at the north). */
export function latitudeAtRow(row: number): number {
  return (Math.atan(Math.sinh(Math.PI * (1 - (2 * row) / TILES_AT_Z15))) * 180) / Math.PI;
}

/** The fractional z15 column a longitude falls in. */
export function columnAtLongitude(longitude: number): number {
  return ((longitude + 180) / 360) * TILES_AT_Z15;
}

/** The fractional z15 row a latitude falls in. */
export function rowAtLatitude(latitude: number): number {
  const radians = (latitude * Math.PI) / 180;
  return ((1 - Math.asinh(Math.tan(radians)) / Math.PI) / 2) * TILES_AT_Z15;
}

/** A tile's edges in degrees. */
export function tileBounds(tile: TileId): {
  readonly west: number;
  readonly east: number;
  readonly north: number;
  readonly south: number;
} {
  return {
    west: longitudeAtColumn(tile.x),
    east: longitudeAtColumn(tile.x + 1),
    north: latitudeAtRow(tile.y),
    south: latitudeAtRow(tile.y + 1),
  };
}
