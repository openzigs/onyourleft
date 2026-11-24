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

/** The columns of {@link OPEN_WORLD_GRID_STREETS}' north–south streets. */
export const GRID_COLUMNS: readonly number[] = [-4000, -2000, -1000, 0, 1000, 2000, 3500];

/** The rows of {@link OPEN_WORLD_GRID_STREETS}' east–west streets: Main street's among them. */
export const GRID_ROWS: readonly number[] = [
  300,
  948,
  MAIN_STREET_ROW,
  3148,
  4248,
  5348,
  6448,
  7548,
  7900,
];

/**
 * #3052: each street of {@link GRID_ROWS} and {@link GRID_COLUMNS}' name, in
 * their order, as a map would carry it. **The column at 0 has none**, and
 * neither has the row at 3148: a street the map does not name.
 */
export const GRID_ROW_NAMES: readonly (string | undefined)[] = [
  'North Ring Road',
  'First Avenue',
  'Main Street',
  undefined,
  'Third Avenue',
  'Fourth Avenue',
  'Fifth Avenue',
  'Sixth Avenue',
  'South Ring Road',
];
export const GRID_COLUMN_NAMES: readonly (string | undefined)[] = [
  'West Ring Road',
  'Oak Street',
  'Elm Street',
  undefined,
  'Pine Street',
  'Cedar Street',
  'East Ring Road',
];

/**
 * #3051: a town of crossroads — every street of {@link GRID_ROWS} and
 * {@link GRID_COLUMNS} running the block's width, so a ride from the start
 * pin meets a four-way junction every 230–260 m and can turn left and right
 * at three in a row without reaching a dead end. Residential streets, with
 * Main street a secondary road. #3052: named by {@link GRID_ROW_NAMES} and
 * {@link GRID_COLUMN_NAMES}, two of them not at all.
 */
export const OPEN_WORLD_GRID_STREETS: readonly GraphFixtureStreet[] = [
  ...GRID_ROWS.map((row, index) => ({
    tags: {
      kind: row === MAIN_STREET_ROW ? 'major_road' : 'minor_road',
      kind_detail: row === MAIN_STREET_ROW ? 'secondary' : 'residential',
      ...(GRID_ROW_NAMES[index] === undefined ? {} : { name: GRID_ROW_NAMES[index] }),
    },
    line: [
      [-4000, row],
      [3500, row],
    ] as const,
  })),
  ...GRID_COLUMNS.map((column, index) => ({
    tags: {
      kind: 'minor_road',
      kind_detail: 'residential',
      ...(GRID_COLUMN_NAMES[index] === undefined ? {} : { name: GRID_COLUMN_NAMES[index] }),
    },
    line: [
      [column, 300],
      [column, 7900],
    ] as const,
  })),
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
 * outside it is not in the tile at all, as a street a real tile's box does
 * not touch is not. (Until #3107 such a street was held onto the buffer's
 * edge: a street the map never had, along every tile's seam, once a tile.)
 */
function cutTo(streets: readonly GraphFixtureStreet[], tile: TileId): GraphFixtureStreet[] {
  const west = (tile.x - FIXTURE_TILE.x) * FIXTURE_EXTENT - 256;
  const east = west + FIXTURE_EXTENT + 512;
  return streets
    .filter((street) => {
      const columns = street.line.map(([x]) => x);
      return Math.max(...columns) >= west && Math.min(...columns) <= east;
    })
    .map((street) => ({
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

/** #3106: where {@link OPEN_WORLD_AWKWARD_STREETS}' four side streets leave Main street, west to east. */
export const AWKWARD_FORK_COLUMN = -2000;
export const AWKWARD_BRIDGE_COLUMN = -1000;
export const AWKWARD_SPLIT_COLUMN = 0;
export const AWKWARD_CROSSROADS_COLUMN = 1000;

/**
 * #3106: **a town of the junctions a town of crossroads has none of** — each
 * a way the street graph offers that the scene's own reading of the streets
 * (`cross-streets.ts`, `nearby-streets.ts`) does not draw from its junction:
 *
 * - at {@link AWKWARD_FORK_COLUMN}, a **fork**: a street leaving Main street
 *   to the right at 20°, under the 30° a junction's arm is taken at;
 * - at {@link AWKWARD_BRIDGE_COLUMN}, a street to the left **mapped on a
 *   bridge** from the junction itself, as a street over a stream beside the
 *   main road is;
 * - at {@link AWKWARD_SPLIT_COLUMN}, a street to the left whose first 9 m is
 *   a way of its own, as a mapped street is where its attributes change:
 *   too short to be an arm, and too far out for the rest to touch the road;
 * - at {@link AWKWARD_CROSSROADS_COLUMN}, an ordinary crossroads: the control.
 *
 * Main street carries a vertex at each, as a mapped street does at a node.
 * A ring road north and east closes the streets that would otherwise end.
 * Ridden east along Main street from the start pin, the junctions are 232 m
 * apart, so each one's prompt appears as the one before is passed.
 */
export const OPEN_WORLD_AWKWARD_STREETS: readonly GraphFixtureStreet[] = [
  {
    tags: { kind: 'major_road', kind_detail: 'secondary' },
    line: [
      [-4000, MAIN_STREET_ROW],
      [AWKWARD_FORK_COLUMN, MAIN_STREET_ROW],
      [AWKWARD_BRIDGE_COLUMN, MAIN_STREET_ROW],
      [AWKWARD_SPLIT_COLUMN, MAIN_STREET_ROW],
      [AWKWARD_CROSSROADS_COLUMN, MAIN_STREET_ROW],
      [4000, MAIN_STREET_ROW],
    ],
  },
  {
    tags: { kind: 'minor_road', kind_detail: 'residential' },
    line: [
      [AWKWARD_FORK_COLUMN, MAIN_STREET_ROW],
      [AWKWARD_FORK_COLUMN + 2200, MAIN_STREET_ROW + 800],
    ],
  },
  {
    tags: { kind: 'minor_road', kind_detail: 'residential', is_bridge: true },
    line: [
      [AWKWARD_BRIDGE_COLUMN, MAIN_STREET_ROW],
      [AWKWARD_BRIDGE_COLUMN, 300],
    ],
  },
  {
    tags: { kind: 'minor_road', kind_detail: 'residential' },
    line: [
      [AWKWARD_SPLIT_COLUMN, MAIN_STREET_ROW],
      [AWKWARD_SPLIT_COLUMN, MAIN_STREET_ROW - 40],
    ],
  },
  {
    tags: { kind: 'minor_road', kind_detail: 'residential' },
    line: [
      [AWKWARD_SPLIT_COLUMN, MAIN_STREET_ROW - 40],
      [AWKWARD_SPLIT_COLUMN, 300],
    ],
  },
  {
    tags: { kind: 'minor_road', kind_detail: 'residential' },
    line: [
      [AWKWARD_CROSSROADS_COLUMN, 300],
      [AWKWARD_CROSSROADS_COLUMN, 7900],
    ],
  },
  {
    tags: { kind: 'minor_road', kind_detail: 'residential' },
    line: [
      [-4000, 300],
      [4000, 300],
    ],
  },
  {
    tags: { kind: 'minor_road', kind_detail: 'residential' },
    line: [
      [4000, 300],
      [4000, 7900],
    ],
  },
];

/**
 * #3106: **more street than a corridor's bound, nowhere near the ride** —
 * 220 service roads the block's width, each 1.86 km, some 700 m to 1.4 km
 * south of Main street: 409 km, past `cross-streets.ts` §`STREET_MAX_METRES`
 * (400 km). The street graph leaves a service road out (ADR 0091 D-3), so
 * they cost the graph nothing; the scene reads every one. Put BEFORE a
 * town's streets in a tile, they are what an open-world ride's far blocks
 * are to the block the rider is in: read first, and none of it in view.
 */
export const OPEN_WORLD_FAR_SERVICE_ROADS: readonly GraphFixtureStreet[] = Array.from(
  { length: 220 },
  (_, index) => ({
    tags: { kind: 'minor_road', kind_detail: 'service' },
    line: [
      [-4000, 5000 + index * 13],
      [4000, 5000 + index * 13],
    ] as const,
  }),
);

/** #3107: the rows of {@link OPEN_WORLD_DENSE_STREETS}' east–west streets, Main street's among them: 100 m apart. */
export const DENSE_ROWS: readonly number[] = Array.from(
  { length: 18 },
  (_, index) => MAIN_STREET_ROW - 4 * 430 + index * 430,
);

/** #3107: the columns of {@link OPEN_WORLD_DENSE_STREETS}' north–south streets, across three blocks: 100 m apart. */
export const DENSE_COLUMNS: readonly number[] = Array.from(
  { length: 57 },
  (_, index) => -4000 + index * 430,
);

/**
 * #3107: **a dense town three blocks long** — a street every 100 m each way,
 * some 20 km of street a square kilometre, across the fixture's block and the
 * two east of it ({@link openWorldFixtureArchive} with `blocksEast` 2). Ridden
 * east along Main street from the start pin, a junction comes every 100 m, the
 * road's view is replaced at 1 km, and the block the rider is in changes
 * 1.65 km on: each a moment an open-world ride reads its streets again.
 */
export const OPEN_WORLD_DENSE_STREETS: readonly GraphFixtureStreet[] = [
  ...DENSE_ROWS.map((row) => ({
    tags: { kind: 'minor_road', kind_detail: 'residential' },
    line: [
      [-4000, row],
      [20000, row],
    ] as const,
  })),
  ...DENSE_COLUMNS.map((column) => ({
    tags: { kind: 'minor_road', kind_detail: 'residential' },
    line: [
      [column, 300],
      [column, 7900],
    ] as const,
  })),
];

/**
 * #3107: {@link OPEN_WORLD_DENSE_STREETS} with **names that begin a kilometre
 * on**: every north–south street from the fifteenth east of the block's edge
 * is named, and none before it, nor any east–west street. A ride east from
 * the start pin meets its first named street some 700 m on, so whatever the
 * renderer builds for a street's name it builds mid-ride, unless it was made
 * ready before the first frame.
 */
export const OPEN_WORLD_NEW_AREA_STREETS: readonly GraphFixtureStreet[] = [
  ...DENSE_ROWS.map((row) => ({
    tags: { kind: 'minor_road', kind_detail: 'residential' },
    line: [
      [-4000, row],
      [20000, row],
    ] as const,
  })),
  ...DENSE_COLUMNS.map((column, index) => ({
    tags: {
      kind: 'minor_road',
      kind_detail: 'residential',
      ...(index >= 14 ? { name: `Street ${String(index)}` } : {}),
    },
    line: [
      [column, 300],
      [column, 7900],
    ] as const,
  })),
];
