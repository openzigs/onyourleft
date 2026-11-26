// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A synthetic terrain archive, and places inside its tiles — #2013's test
 * support.
 *
 * ⚠️ **A `-testing.ts` file**: imported by Vitest suites and by
 * `browser/terrain-harness.ts`, never by anything that ships. It contains
 * **no terrain data**: every tile is one of `@onyourleft/map-features/testing`'s
 * invented grounds, placed at whatever z12 tile a test's line crosses.
 */

import {
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  type GeographicPosition,
} from '@onyourleft/domain';
import { HEIGHT_TILE_PIXELS, type HeightTileId } from '@onyourleft/map-features';
import { decodeFixtureWebp } from '@onyourleft/map-features/testing';

import { buildArchive, type ArchiveOptions } from '../world-data/archive-testing';
import { decodeHeightTile, type DecodeHeightTile } from './decode';

/** A z12 tile the fixtures are placed at: a cell of the grid near 40° N, and nobody's address. */
export const FIXTURE_HEIGHT_TILE: HeightTileId = { z: 12, x: 850, y: 1550 };

/** The tile east of {@link FIXTURE_HEIGHT_TILE}. */
export const NEXT_HEIGHT_TILE: HeightTileId = { z: 12, x: 851, y: 1550 };

/** The archive's own metadata, as Mapterhorn writes it. */
export const SYNTHETIC_TERRAIN_METADATA: Record<string, unknown> = {
  attribution: 'Synthetic heights for tests. Contains no terrain data.',
};

/** A terrain archive of `tiles`: WebP tiles at z12, stored uncompressed, as upstream's is. */
export function buildTerrainArchive(
  tiles: readonly { readonly tile: HeightTileId; readonly bytes: Uint8Array }[],
  overrides: Partial<ArchiveOptions> = {},
): Promise<Uint8Array> {
  return buildArchive({
    tiles: tiles.map(({ tile, bytes }) => ({ x: tile.x, y: tile.y, bytes })),
    zoom: 12,
    maxZoom: 12,
    tileType: 4,
    gzip: false,
    metadata: SYNTHETIC_TERRAIN_METADATA,
    ...overrides,
  });
}

/** The place at a pixel of a z12 tile: `column` east of its west edge, `row` south of its north edge. */
export function placeInTile(tile: HeightTileId, column: number, row: number): GeographicPosition {
  const across = tile.x + column / HEIGHT_TILE_PIXELS;
  const down = tile.y + row / HEIGHT_TILE_PIXELS;
  const longitude = (across / 4096) * 360 - 180;
  const latitude = (Math.atan(Math.sinh(Math.PI * (1 - (2 * down) / 4096))) * 180) / Math.PI;
  return geographicPosition(degreesLatitude(latitude), degreesLongitude(longitude));
}

/**
 * The platform's decoder, stood in for under Node: the bounds are
 * `terrain/decode.ts`'s own, and only the WebP read is the fixture encoder's.
 * `browser/terrain.browser.spec.ts` reads the same tiles through the real one.
 */
export const fixtureDecode: DecodeHeightTile = (bytes) =>
  decodeHeightTile(bytes, (webp) => Promise.resolve(decodeFixtureWebp(webp)));
