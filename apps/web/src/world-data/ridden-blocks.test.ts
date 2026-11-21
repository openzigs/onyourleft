// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The ridden-block cache, end to end — #2891, ADR 0090 D-6 and D-7.2. A ride
 * reads its blocks through the product's archive source over a synthetic
 * archive, and keeps them in a real store; every handle is closed; a second
 * ride reads them back through the reader's own path (`held()`, what the
 * open-world session reads), and the archive's request counter says what was
 * asked. Two athletes on one device, erasure, map tiles off, and a block kept
 * from another archive or reader version are each a case.
 */

import { residentialBlockTile, streetsTile } from '@onyourleft/map-features/testing';
import { openActivityStore, type ActivityStore, type AthleteId } from '@onyourleft/store';
import {
  ATHLETE_A,
  ATHLETE_B,
  createStoreHarness,
  resetFixtureIds,
  seedAthletes,
} from '@onyourleft/store/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  blockKey,
  blocksAround,
  createAreaReader,
  tilesOfBlock,
  type AreaPosition,
  type BlockId,
} from '../game/world-data/area';
import { CORRIDOR_READER_VERSION } from '../game/world-data/corridor';
import { buildArchive, countingSource, type ArchiveTile } from './archive-testing';
import { corridorArchiveFrom } from './corridor-source';
import { riddenBlockCache, type RiddenBlockStore } from './ridden-blocks';

const ARCHIVE_URL = 'https://tiles.example.org/basemap-us.pmtiles';
const BLOCK: BlockId = { x: 4685, y: 6269 };

const latitudeAt = (row: number): number =>
  (Math.atan(Math.sinh(Math.PI * (1 - (2 * row) / 2 ** 14))) * 180) / Math.PI;
const inside = (block: BlockId, fx: number, fy: number): AreaPosition => ({
  longitude: -180 + ((block.x + fx) / 2 ** 14) * 360,
  latitude: latitudeAt(block.y + fy),
});
const START = inside(BLOCK, 0.5, 0.5);

/** The 3 × 3 round {@link BLOCK}, streets in the centre block and houses round it. */
function tiles(): ArchiveTile[] {
  return blocksAround(BLOCK).flatMap((block, index) =>
    tilesOfBlock(block).map((tile) => ({
      x: tile.x,
      y: tile.y,
      bytes: index === 0 ? streetsTile() : residentialBlockTile(),
    })),
  );
}

let harness: ReturnType<typeof createStoreHarness>;
let archive: Uint8Array;
const open: ActivityStore[] = [];

beforeEach(async () => {
  resetFixtureIds();
  harness = createStoreHarness();
  await seedAthletes(harness);
  await harness.discard();
  archive = await buildArchive({ tiles: tiles() });
});

afterEach(async () => {
  for (const store of open.splice(0)) store.close();
  await harness.destroy();
});

/** A fresh handle on the database, closed after the test. */
function fresh(): ActivityStore {
  const store = openActivityStore(harness.databaseName);
  open.push(store);
  return store;
}

/** One ride: a reader over a fresh store handle and a counting archive. */
async function ride(
  owner: AthleteId,
  options: { tilesOn?: boolean; store?: RiddenBlockStore; at?: string; url?: string } = {},
) {
  const source = countingSource(archive);
  const store = options.store ?? fresh();
  const log: string[] = [];
  const area = createAreaReader({
    archive: corridorArchiveFrom(source),
    cache: riddenBlockCache({
      store,
      owner,
      archiveUrl: options.url ?? ARCHIVE_URL,
      now: () => new Date(options.at ?? '2026-11-20T09:00:00Z'),
    }),
    mapTilesOn: () => options.tilesOn ?? true,
    random: () => 0,
    yieldToIdle: () => Promise.resolve(),
    log: (line) => log.push(line),
  });
  const started = await area.start(START);
  await area.settled();
  return { started, area, calls: source.calls, log };
}

/** What a ride holds, in a form two rides can be compared by. */
const summary = (held: ReturnType<ReturnType<typeof createAreaReader>['held']>) =>
  held
    .map((h) => ({
      key: blockKey(h.block),
      frame: h.frame,
      tiles: h.tiles,
      streets: h.features.streets.length,
      buildings: h.features.buildings.length,
      landUse: h.features.landUse.length,
    }))
    .sort((a, b) => a.key - b.key);

describe('a ridden block is kept, and a second ride asks nothing for it (D-6.7)', () => {
  it('reads back after every handle is closed, through the reader, with no request', async () => {
    const first = await ride(ATHLETE_A);
    expect(first.started).toStrictEqual({ kind: 'ready' });
    expect(first.calls.length).toBeGreaterThan(36);
    const firstHeld = summary(first.area.held());
    expect(firstHeld).toHaveLength(9);
    const centre = firstHeld.find((h) => h.key === blockKey(BLOCK));
    expect(centre?.streets ?? 0).toBeGreaterThan(0);
    expect(firstHeld.every((h) => h.key === blockKey(BLOCK) || h.buildings > 0)).toBe(true);
    for (const store of open.splice(0)) store.close();

    const second = await ride(ATHLETE_A);
    expect(second.started).toStrictEqual({ kind: 'ready' });
    // Not one range: not a tile, and not even the archive's header.
    expect(second.calls).toStrictEqual([]);
    expect(summary(second.area.held())).toStrictEqual(firstHeld);
  });

  it('marks each block handed to a ride as ridden then', async () => {
    await ride(ATHLETE_A, { at: '2026-11-20T09:00:00Z' });
    await ride(ATHLETE_A, { at: '2026-11-21T07:30:00Z' });
    const kept = await fresh().getRiddenBlock(ATHLETE_A, blockKey(BLOCK));
    expect(kept?.readAt).toBe('2026-11-20T09:00:00.000Z');
    expect(kept?.riddenAt).toBe('2026-11-21T07:30:00.000Z');
    expect(kept?.licence).toBe('ODbL-1.0');
  });

  it('with map tiles off, rides what is kept and asks nothing (D-7.2)', async () => {
    await ride(ATHLETE_A);
    const off = await ride(ATHLETE_A, { tilesOn: false });
    expect(off.started).toStrictEqual({ kind: 'ready' });
    expect(off.calls).toStrictEqual([]);
    expect(off.area.held()).toHaveLength(9);
  });

  it('with map tiles off and nothing kept, says so and asks nothing', async () => {
    const off = await ride(ATHLETE_A, { tilesOn: false });
    expect(off.started).toStrictEqual({ kind: 'off', why: 'map-tiles-off' });
    expect(off.calls).toStrictEqual([]);
  });

  it('reads again a block kept from another archive, or by another reader version', async () => {
    await ride(ATHLETE_A, { url: 'https://tiles.example.org/an-older-basemap.pmtiles' });
    const moved = await ride(ATHLETE_A);
    expect(moved.calls.length).toBeGreaterThan(36);
    const store = fresh();
    const kept = await store.getRiddenBlock(ATHLETE_A, blockKey(BLOCK));
    expect(kept?.archive.url).toBe(ARCHIVE_URL);
    if (kept === undefined) return;
    await store.putRiddenBlock({ ...kept, readerVersion: CORRIDOR_READER_VERSION - 1 });
    const older = await ride(ATHLETE_A);
    expect(older.calls.length).toBeGreaterThan(0);
  });
});

describe('scoped to the athlete who rode (D-6.2)', () => {
  it('athlete B’s ride on the same device does not get athlete A’s blocks', async () => {
    await ride(ATHLETE_A);
    const b = await ride(ATHLETE_B);
    expect(b.started).toStrictEqual({ kind: 'ready' });
    // B asked the archive for all nine blocks: none of A's was handed over.
    expect(b.calls.length).toBeGreaterThan(36);
    // And A's are still A's, and B's own are now B's.
    const store = fresh();
    for (const block of blocksAround(BLOCK)) {
      expect((await store.getRiddenBlock(ATHLETE_A, blockKey(block)))?.owner).toBe(ATHLETE_A);
      expect((await store.getRiddenBlock(ATHLETE_B, blockKey(block)))?.owner).toBe(ATHLETE_B);
    }
  });
});

describe('erased with the rider (D-6.6)', () => {
  it('finds nothing after the rider is erased, and the next ride asks again', async () => {
    await ride(ATHLETE_A);
    const store = fresh();
    await store.deleteAthlete(ATHLETE_A);
    for (const block of blocksAround(BLOCK)) {
      await expect(store.getRiddenBlock(ATHLETE_A, blockKey(block))).resolves.toBeUndefined();
    }
    const after = await ride(ATHLETE_A);
    expect(after.calls.length).toBeGreaterThan(36);
  });
});

describe('a store that fails costs a re-read, never the ride', () => {
  it('reads from the archive when the cache cannot be read, and says so without a place', async () => {
    const broken: RiddenBlockStore = {
      getRiddenBlock: () => Promise.reject(new DOMException('gone', 'InvalidStateError')),
      putRiddenBlock: () => Promise.reject(new DOMException('full', 'QuotaExceededError')),
      markRiddenBlock: () => Promise.resolve(false),
    };
    const run = await ride(ATHLETE_A, { store: broken });
    expect(run.started).toStrictEqual({ kind: 'ready' });
    expect(run.calls.length).toBeGreaterThan(36);
    expect(run.log).toContain(
      'Towns from map data: the corridor could not be kept (InvalidStateError).',
    );
    expect(run.log).toContain(
      'Towns from map data: the corridor could not be kept (QuotaExceededError).',
    );
    for (const line of run.log) {
      expect(line).not.toContain(String(BLOCK.x));
      expect(line).not.toContain(String(blockKey(BLOCK)));
    }
  });
});
