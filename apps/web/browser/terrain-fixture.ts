// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The terrain archive the browser gate's planner reads (#2013): four
 * synthetic height tiles at four neighbouring z12 cells. **No terrain data
 * from any source is in it.** Emitted into `browser/dist` by
 * `vite.browser.config.ts`, never committed.
 *
 * | Tile | Ground |
 * |---|---|
 * | {@link FIXTURE_HEIGHT_TILE} | rolling hills, {@link hillHeight}: what the planner's screenshots draw |
 * | east of it | a steady slope, {@link SLOPE_RISE_PER_PIXEL} a pixel: the decode's exactness check |
 * | south of it | a malformed tile: a true header and a body cut short |
 * | south-east of it | an oversize tile: a header stating 4,096 × 4,096 |
 */

import type { GeographicPosition } from '@onyourleft/domain';
import type { HeightTileId } from '@onyourleft/map-features';
import {
  heightTileWebp,
  oversizeHeightTile,
  slopeHeightTile,
  truncatedHeightTile,
} from '@onyourleft/map-features/testing';

import {
  buildTerrainArchive,
  FIXTURE_HEIGHT_TILE,
  NEXT_HEIGHT_TILE,
  placeInTile,
} from '../src/terrain/terrain-testing';

/** The archive's file name under the harness origin. */
export const TERRAIN_ARCHIVE_FILE = 'terrain-fixture.pmtiles';

/** The slope tile's rise, in metres a pixel eastward. */
export const SLOPE_RISE_PER_PIXEL = 0.73;

/** The tile south of the hills: malformed. */
export const MALFORMED_HEIGHT_TILE: HeightTileId = { z: 12, x: 850, y: 1551 };

/** The tile south-east of the hills: oversize. */
export const OVERSIZE_HEIGHT_TILE: HeightTileId = { z: 12, x: 851, y: 1551 };

/** Invented rolling ground: a long climb with two rises on it, level north to south. */
export function hillHeight(column: number): number {
  return 1_600 + column * 0.35 + 30 * Math.sin(column / 70) + 8 * Math.sin(column / 23);
}

/** The archive's bytes. */
export function buildTerrainFixtureArchive(): Promise<Uint8Array> {
  return buildTerrainArchive([
    { tile: FIXTURE_HEIGHT_TILE, bytes: heightTileWebp((column) => hillHeight(column)) },
    { tile: NEXT_HEIGHT_TILE, bytes: slopeHeightTile(SLOPE_RISE_PER_PIXEL) },
    { tile: MALFORMED_HEIGHT_TILE, bytes: truncatedHeightTile() },
    { tile: OVERSIZE_HEIGHT_TILE, bytes: oversizeHeightTile() },
  ]);
}

/** The waypoints the planner's screenshots are drawn through: west to east over the hills. */
export function terrainFixtureWaypoints(): readonly GeographicPosition[] {
  return [
    placeInTile(FIXTURE_HEIGHT_TILE, 40, 250),
    placeInTile(FIXTURE_HEIGHT_TILE, 190, 262),
    placeInTile(FIXTURE_HEIGHT_TILE, 330, 248),
    placeInTile(FIXTURE_HEIGHT_TILE, 470, 256),
  ];
}
