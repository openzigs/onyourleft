// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #3245's rollback: a row this build keeps, met by the build before it.
 *
 * #3245 moved `CORRIDOR_READER_VERSION` from 9 to 10 and changed no Dexie
 * schema, so checking out the previous build leaves version-10 rows in a store
 * whose code reads only version 9. This runs the port `main.tsx` builds as
 * that code would: the corridor module is the real one but for its reader
 * version, which is 9. The row is written by the real version-10 pack, with
 * the streets' names a version-9 reader never kept. It must be read again,
 * never handed to the ride and never thrown into it.
 */

import { corridorTileCover, decodeTile } from '@onyourleft/map-features';
import {
  EARTH,
  encodeTile,
  FIXTURE_FRAME,
  FIXTURE_TILE,
  line,
} from '@onyourleft/map-features/testing';
import { openActivityStore, type ActivityStore } from '@onyourleft/store';
import {
  ATHLETE_A,
  createStoreHarness,
  resetFixtureIds,
  routeFor,
  seedAthletes,
} from '@onyourleft/store/testing';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import {
  CORRIDOR_HALF_WIDTH_METRES,
  CORRIDOR_READER_VERSION,
  packCorridorFeatures,
  type CorridorFeatures,
} from '../game/world-data/corridor';
import { buildArchive, countingSource } from './archive-testing';
import { createWorldCorridorPort, routeDigestOf } from './corridor-port';
import { corridorArchiveFrom } from './corridor-source';

/** The build before #3245 read only version 9. */
const PREVIOUS_READER_VERSION = 9;

/** A tile of one street, named with an invented name. */
function namedTile(): Uint8Array {
  return encodeTile([
    EARTH,
    {
      name: 'roads',
      features: [
        {
          type: 2,
          tags: { kind: 'minor_road', name: 'Testroll Road' },
          geometry: line([
            [
              [100, 600],
              [4000, 600],
            ],
          ]),
        },
      ],
    },
  ]);
}

vi.mock('../game/world-data/corridor', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../game/world-data/corridor')>()),
  CORRIDOR_READER_VERSION: 9,
}));

const ARCHIVE_URL = 'https://tiles.example.org/basemap-us-test.pmtiles';

let harness: ReturnType<typeof createStoreHarness>;
let store: ActivityStore | undefined;

beforeEach(async () => {
  resetFixtureIds();
  harness = createStoreHarness();
  await seedAthletes(harness, [ATHLETE_A]);
});

afterEach(async () => {
  store?.close();
  await harness.destroy();
});

it('the previous build reads a version-10 row, with streets’ names, again, and hands the ride a corridor rather than an error', async () => {
  // The mock is the previous build: the port sees version 9.
  expect(CORRIDOR_READER_VERSION).toBe(PREVIOUS_READER_VERSION);
  const route = routeFor(ATHLETE_A);
  await harness.write((s) => s.putRoute(route));
  const tiles = corridorTileCover(
    route.profile.positions,
    CORRIDOR_HALF_WIDTH_METRES + 2_000,
    2_000,
  ).map((tile) => ({ x: tile.x, y: tile.y, bytes: namedTile() }));
  const source = countingSource(await buildArchive({ tiles }));

  // This build's row: reader version 10, and a blob the real pack wrote at
  // packed version 9, with the names a version-9 reader never kept.
  const decoded = decodeTile(namedTile(), FIXTURE_TILE, FIXTURE_FRAME, undefined, {
    streetNames: true,
  });
  if ('reason' in decoded) throw new Error(decoded.reason);
  expect(decoded.streets.some((f) => f.name !== undefined)).toBe(true);
  const features: CorridorFeatures = {
    landUse: [],
    buildings: [],
    paths: [],
    streets: decoded.streets,
    places: [],
  };
  const covered = corridorTileCover(route.profile.positions, CORRIDOR_HALF_WIDTH_METRES, 600);
  await harness.write(async (s) =>
    s.putWorldCorridor({
      owner: ATHLETE_A,
      routeId: route.id,
      routeDigest: await routeDigestOf(route.profile.positions),
      archive: { url: ARCHIVE_URL, identity: '"fixture-1"' },
      readerVersion: 10,
      halfWidthMetres: CORRIDOR_HALF_WIDTH_METRES,
      readAt: '2026-11-02T12:00:00.000Z',
      tiles: covered.map((tile) => ({ x: tile.x, y: tile.y, state: 'covered' as const })),
      features: await packCorridorFeatures(features),
      licence: 'ODbL-1.0',
    }),
  );

  store = openActivityStore(harness.databaseName);
  const state = await createWorldCorridorPort({
    store,
    owner: ATHLETE_A,
    basemap: () => ({ archiveUrl: ARCHIVE_URL, attribution: '' }),
    archive: () => corridorArchiveFrom(source),
    mapTilesOn: () => true,
    realisticOn: () => true,
    recording: () => false,
    now: () => new Date('2026-11-02T12:00:00Z'),
    yieldToIdle: () => Promise.resolve(),
  }).load({ id: route.id, profile: route.profile }, new AbortController().signal, () => undefined);

  // Read again: the archive was asked, and the ride got the corridor read now.
  expect(source.calls.length).toBeGreaterThan(0);
  expect(state.kind).toBe('ready');
  if (state.kind === 'ready') expect(state.corridor.streets.length).toBeGreaterThan(0);
  // And the row is now the previous build's own.
  const kept = await harness.read((s) => s.getWorldCorridor(ATHLETE_A, route.id));
  expect(kept?.readerVersion).toBe(PREVIOUS_READER_VERSION);
});
