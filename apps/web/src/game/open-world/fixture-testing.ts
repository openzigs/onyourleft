// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The open-world session's synthetic fixture archive** — #2896's test
 * support: one block of streets, encoded as real z15 tiles and packed into a
 * real PMTiles v3 archive, so a session is tested through the product's own
 * archive reader, decoder, graph and rolling route.
 *
 * ⚠️ **A `-testing.ts` file** (`check-wiring.mjs` §`isTestSupport`): imported
 * by tests and never by anything that ships. It contains **no OpenStreetMap
 * data**: every street below is a straight line of whole pixels, written here.
 * The archive is built from these lines on each run rather than kept as bytes,
 * so what is committed is what a reviewer can read.
 *
 * The block is {@link FIXTURE_TILE}'s: the z14 tile whose four z15 tiles are
 * columns 9370 and 9371 and rows 12538 and 12539, about 1.9 km across, in the
 * eastern United States (inside `start.ts` §`US_BASEMAP_COVERAGE`). Pixels
 * are counted from the north-west corner of {@link FIXTURE_TILE}, as
 * `@onyourleft/map-features`' graph fixtures count them, so the block's
 * columns run from −4096 to 4095 and its rows from 0 to 8191. A pixel is about
 * 0.23 m.
 *
 * ```
 *        x −2000            x 1500
 *          │                  │
 *  ────────┼──────────────────┼────────  Main street, row 2048, west to east
 *    ·S    │                  │
 *          │                  │          S: the start pin, ~12 m south of it
 *          │                  │
 *    ·F    │                  │          F: a pin with no street in 200 m
 * ```
 */

import { geographicPosition, degreesLatitude, degreesLongitude } from '@onyourleft/domain';
import type { GeographicPosition } from '@onyourleft/domain';
import { FIXTURE_EXTENT, FIXTURE_TILE, graphFixtureTile } from '@onyourleft/map-features/testing';
import type { GraphFixtureStreet } from '@onyourleft/map-features/testing';
import type { TileId } from '@onyourleft/map-features';

import { buildArchive } from '../../world-data/archive-testing';
import { openWorldStart, type OpenWorldStart } from './start';

const TILES_AT_Z15 = 2 ** 15;

/** The row Main street runs along, west to east. */
export const MAIN_STREET_ROW = 2048;

/** The column of the start pin. */
export const START_COLUMN = -3000;

/** The block's streets: Main street, and two cross streets that meet it. */
export const OPEN_WORLD_FIXTURE_STREETS: readonly GraphFixtureStreet[] = [
  {
    tags: { kind: 'minor_road', kind_detail: 'residential' },
    line: [
      [-4000, MAIN_STREET_ROW],
      [4000, MAIN_STREET_ROW],
    ],
  },
  {
    tags: { kind: 'minor_road', kind_detail: 'residential' },
    line: [
      [-2000, 300],
      [-2000, 7900],
    ],
  },
  {
    tags: { kind: 'major_road', kind_detail: 'primary' },
    line: [
      [1500, 300],
      [1500, 7900],
    ],
  },
];

/** The block's four z15 tiles. */
export const OPEN_WORLD_FIXTURE_TILES: readonly TileId[] = [
  { z: 15, x: FIXTURE_TILE.x - 1, y: FIXTURE_TILE.y },
  { z: 15, x: FIXTURE_TILE.x, y: FIXTURE_TILE.y },
  { z: 15, x: FIXTURE_TILE.x - 1, y: FIXTURE_TILE.y + 1 },
  { z: 15, x: FIXTURE_TILE.x, y: FIXTURE_TILE.y + 1 },
];

/** A fixture pixel as a position, by the Web Mercator tiling the archive is cut on. */
export function fixturePosition(column: number, row: number): GeographicPosition {
  const x = FIXTURE_TILE.x + column / FIXTURE_EXTENT;
  const y = FIXTURE_TILE.y + row / FIXTURE_EXTENT;
  const longitude = (x / TILES_AT_Z15) * 360 - 180;
  const latitude = (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / TILES_AT_Z15))) * 180) / Math.PI;
  return geographicPosition(degreesLatitude(latitude), degreesLongitude(longitude));
}

/** The tiles of the block `east` blocks east of the fixture's: the fixture's own at 0. */
export function fixtureBlockTiles(east: number): readonly TileId[] {
  return OPEN_WORLD_FIXTURE_TILES.map((tile) => ({ ...tile, x: tile.x + 2 * east }));
}

/**
 * `streets` as `tile` is cut: every vertex's column held to the tile's own
 * columns and a buffer of 256 either side, as a real tile's geometry is. Only
 * for streets drawn along a row or a column, which is every street here: a
 * line along a row is cut where it leaves the buffer, and one along a column
 * outside it lies in the buffer, which the graph clips away.
 */
function cutTo(streets: readonly GraphFixtureStreet[], tile: TileId): GraphFixtureStreet[] {
  const west = (tile.x - FIXTURE_TILE.x) * FIXTURE_EXTENT - 256;
  const east = west + FIXTURE_EXTENT + 512;
  return streets.map((street) => ({
    ...street,
    line: street.line.map(([x, y]) => [Math.min(east, Math.max(west, x)), y] as const),
  }));
}

/**
 * The archive's bytes: the block's four tiles of `streets`, and nothing round
 * them — or, with `blocksEast` (#2990), the tiles of that many blocks east of
 * it too, so a street drawn on past the block runs on into them.
 */
export function openWorldFixtureArchive(
  streets: readonly GraphFixtureStreet[] = OPEN_WORLD_FIXTURE_STREETS,
  blocksEast = 0,
): Promise<Uint8Array> {
  const tiles: TileId[] = [];
  for (let east = 0; east <= blocksEast; east += 1) tiles.push(...fixtureBlockTiles(east));
  return buildArchive({
    tiles: tiles.map((tile) => ({
      x: tile.x,
      y: tile.y,
      bytes: graphFixtureTile(blocksEast === 0 ? streets : cutTo(streets, tile), tile),
    })),
  });
}

/** The node where {@link TURNING_CIRCLE_STREETS}' stem meets its ring. */
export const RING_NODE = [-3000, 2600] as const;

/** The ring's last corner before it closes at {@link RING_NODE}: the way round it nearest straight on. */
export const RING_LAST = [-3050, 2200] as const;

/**
 * A second, smaller block of streets: a stem ridden north into a turning
 * circle, a ring that leaves and closes at one node, so the graph makes it
 * one loop edge. Ridden one way round it turns about 84° right; the other way
 * about 7° left, the default.
 */
export const TURNING_CIRCLE_STREETS: readonly GraphFixtureStreet[] = [
  {
    tags: { kind: 'minor_road', kind_detail: 'residential' },
    line: [[-3000, 3400], RING_NODE],
  },
  {
    tags: { kind: 'minor_road', kind_detail: 'residential' },
    line: [RING_NODE, [-2600, 2560], [-2700, 2200], RING_LAST, RING_NODE],
  },
];

/** A start, as the picker makes one: from a pin at a fixture pixel. */
export function fixtureStart(column: number, row: number): OpenWorldStart {
  const outcome = openWorldStart(fixturePosition(column, row), 'pin');
  if (outcome.kind !== 'start') throw new Error('the fixture pin is outside the map');
  return outcome.start;
}

/** The start pin: about 12 m south of Main street. */
export const START_ROW = MAIN_STREET_ROW + 52;

/** A pin over 250 m from every street: the nearest is the western cross street. */
export const FAR_COLUMN = -3100;
export const FAR_ROW = 6500;
