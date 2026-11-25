// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The ridden-block cache, end to end — #2891, ADR 0090 D-6 and D-7.2. A ride
 * reads its blocks through the product's archive source over a synthetic
 * archive, and keeps them in a real store; every handle is closed; a second
 * ride reads them back through the reader's own path (`held()`, what the
 * open-world session reads), and the archive's request counter says what was
 * asked. Two athletes on one device, erasure, map tiles off, and a block kept
 * from another archive or reader version are each a case.
 *
 * Since main's open-world session builds the whole ride in one frame, the
 * ride's start (#2896), the reader decodes into that frame and the cache keeps
 * each block in its own ({@link blockFrame}): a block kept on a ride that
 * started in one place must land where a fresh read puts it on a ride that
 * started in another, its streets must reach the street graph, and a block
 * read in part must never be kept (the maintainer decision of 2026-11-25 on
 * PR #2966).
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

import { inlineGraphWorker, workerGraphBuilder } from '../game/open-world/graph-build';
import {
  fixtureStart,
  GRID_COLUMN_NAMES,
  GRID_ROW_NAMES,
  OPEN_WORLD_GRID_STREETS,
  openWorldFixtureArchive,
  START_COLUMN,
  START_ROW,
} from '../game/open-world/fixture-testing';
import {
  blockFrame,
  blockKey,
  blockOf,
  blocksAround,
  createAreaReader,
  tilesOfBlock,
  type AreaCache,
  type AreaPosition,
  type BlockId,
  type HeldBlock,
  type KeptBlock,
} from '../game/world-data/area';
import {
  CORRIDOR_READER_VERSION,
  gunzipBytes,
  gzipBytes,
  unpackTileStreets,
} from '../game/world-data/corridor';
import {
  buildArchive,
  countingSource,
  tilesRequested,
  type ArchiveTile,
  type CountingSource,
} from './archive-testing';
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

/**
 * A counting source whose answer for any tile in {@link failing} is a refused
 * request, as a dropped connection's is: that tile is read as `refused`.
 */
function flakySource(bytes: Uint8Array, failing: Set<string>): CountingSource {
  const inner = countingSource(bytes);
  return {
    ...inner,
    calls: inner.calls,
    getBytes: (offset, length, signal) => {
      const [tile] = tilesRequested(tiles(), bytes, [{ offset, length }]);
      if (tile !== undefined && failing.has(`${String(tile.x)}/${String(tile.y)}`)) {
        inner.calls.push({ offset, length });
        return Promise.reject(new TypeError('Failed to fetch'));
      }
      return inner.getBytes(offset, length, signal);
    },
  };
}

/** One ride: a reader over a fresh store handle and a counting archive. */
async function ride(
  owner: AthleteId,
  options: {
    tilesOn?: boolean;
    store?: RiddenBlockStore;
    at?: string;
    url?: string;
    /** Where the ride starts, and so its frame: {@link START} when absent. */
    start?: AreaPosition;
    /** No cache at all: a fresh read, every block from the archive. */
    noCache?: boolean;
    source?: CountingSource;
    onChange?: () => void;
  } = {},
) {
  const source = options.source ?? countingSource(archive);
  const store = options.store ?? fresh();
  const start = options.start ?? START;
  const log: string[] = [];
  const area = createAreaReader({
    archive: corridorArchiveFrom(source),
    frame: { latitude: start.latitude, longitude: start.longitude },
    cache:
      options.noCache === true
        ? undefined
        : riddenBlockCache({
            store,
            owner,
            archiveUrl: options.url ?? ARCHIVE_URL,
            now: () => new Date(options.at ?? '2026-11-20T09:00:00Z'),
          }),
    mapTilesOn: () => options.tilesOn ?? true,
    random: () => 0,
    // A crossing's request runs at once, so a test can cross and settle.
    schedule: (run) => {
      run();
      return () => undefined;
    },
    yieldToIdle: () => Promise.resolve(),
    log: (line) => log.push(line),
    onChange: options.onChange,
  });
  const started = await area.start(start);
  await area.settled();
  return { started, area, calls: source.calls, log };
}

/** What a ride holds, in a form two rides started at the same place can be compared by. */
const summary = (held: readonly HeldBlock[]) =>
  held
    .map((h) => ({
      key: blockKey(h.block),
      tiles: h.tiles,
      streets: h.features.streets.length,
      tileStreets: h.streets.map((each) => [each.tile, each.streets.length]),
      buildings: h.features.buildings.length,
      landUse: h.features.landUse.length,
    }))
    .sort((a, b) => a.key - b.key);

const heldBlock = (held: readonly HeldBlock[], block: BlockId): HeldBlock | undefined =>
  held.find((h) => blockKey(h.block) === blockKey(block));

/**
 * The largest distance in metres between two values' coordinates, walking
 * both alike: every `Float32Array` element and every number. A difference of
 * shape — a key, a length, a string — throws, so only positions are measured.
 * A street's name is a string like any other: kept (ADR 0098), it must match.
 */
function farthest(actual: unknown, expected: unknown, path = 'value'): number {
  if (actual instanceof Float32Array && expected instanceof Float32Array) {
    if (actual.length !== expected.length) throw new Error(`${path}: lengths differ`);
    let most = 0;
    for (let i = 0; i < actual.length; i++) {
      most = Math.max(most, Math.abs((actual[i] as number) - (expected[i] as number)));
    }
    return most;
  }
  if (typeof actual === 'number' && typeof expected === 'number') {
    return Math.abs(actual - expected);
  }
  if (Array.isArray(actual) && Array.isArray(expected)) {
    if (actual.length !== expected.length) throw new Error(`${path}: lengths differ`);
    return actual.reduce<number>(
      (most, each, i) => Math.max(most, farthest(each, expected[i], `${path}[${String(i)}]`)),
      0,
    );
  }
  if (
    typeof actual === 'object' &&
    actual !== null &&
    typeof expected === 'object' &&
    expected !== null
  ) {
    const keys = (o: object) => Object.keys(o).sort();
    expect(keys(actual), path).toStrictEqual(keys(expected));
    return keys(actual).reduce(
      (most, key) =>
        Math.max(
          most,
          farthest(
            (actual as Record<string, unknown>)[key],
            (expected as Record<string, unknown>)[key],
            `${path}.${key}`,
          ),
        ),
      0,
    );
  }
  expect(actual, path).toStrictEqual(expected);
  return 0;
}

/** A held block's streets as a corridor packs them: the street graph reads its road fields from `HeldBlock.streets`. */
const asCorridorStreets = (block: HeldBlock) => ({
  ...block.features,
  streets: block.features.streets.map((f) => ({
    kind: f.kind,
    kindDetail: f.kindDetail,
    grade: f.grade,
    line: f.line,
  })),
});

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

describe('a kept block lands where a fresh read puts it, on a ride that started elsewhere', () => {
  // Ride B starts a block south-east of ride A's start, so the two frames'
  // origins differ in latitude as well as longitude: a plain shift between
  // them is off by decimetres at the far side of a block.
  const ELSEWHERE = inside({ x: BLOCK.x + 1, y: BLOCK.y + 1 }, 0.3, 0.7);
  /** The blocks both rides' 3 × 3s hold, which ride B gets from the cache. */
  const SHARED = blocksAround(BLOCK).filter((block) => block.x >= BLOCK.x && block.y >= BLOCK.y);

  it('matches a fresh read of each kept block on ride B within 1 cm, features and streets', async () => {
    await ride(ATHLETE_A);
    for (const store of open.splice(0)) store.close();

    const kept = await ride(ATHLETE_A, { start: ELSEWHERE });
    expect(kept.started).toStrictEqual({ kind: 'ready' });
    const freshRead = await ride(ATHLETE_B, { start: ELSEWHERE, noCache: true });
    expect(freshRead.started).toStrictEqual({ kind: 'ready' });
    // Ride B asked the archive for no tile of a kept block.
    const askedOnB = tilesRequested(tiles(), archive, kept.calls).map(
      (t) => `${String(t.x)}/${String(t.y)}`,
    );
    for (const block of SHARED) {
      for (const tile of tilesOfBlock(block)) {
        expect(askedOnB).not.toContain(`${String(tile.x)}/${String(tile.y)}`);
      }
    }

    expect(SHARED).toHaveLength(4);
    let streets = 0;
    let buildings = 0;
    for (const block of SHARED) {
      const fromCache = heldBlock(kept.area.held(), block);
      const fromArchive = heldBlock(freshRead.area.held(), block);
      expect(fromCache, 'held on ride B from the cache').toBeDefined();
      expect(fromArchive, 'held on the fresh ride').toBeDefined();
      if (fromCache === undefined || fromArchive === undefined) return;
      expect(fromCache.tiles).toStrictEqual(fromArchive.tiles);
      expect(
        farthest(asCorridorStreets(fromCache), asCorridorStreets(fromArchive)),
      ).toBeLessThanOrEqual(0.01);
      expect(farthest(fromCache.streets, fromArchive.streets)).toBeLessThanOrEqual(0.01);
      streets += fromCache.streets.reduce((n, each) => n + each.streets.length, 0);
      buildings += fromCache.features.buildings.length;
    }
    // Something was compared: the centre block's streets and the houses round it.
    expect(streets).toBeGreaterThan(0);
    expect(buildings).toBeGreaterThan(0);
  });

  it('keeps each block in its own frame, the block’s corner, whichever ride read it', async () => {
    await ride(ATHLETE_A);
    await ride(ATHLETE_B, { start: ELSEWHERE });
    const store = fresh();
    const a = await store.getRiddenBlock(ATHLETE_A, blockKey(BLOCK));
    const b = await store.getRiddenBlock(ATHLETE_B, blockKey(BLOCK));
    if (a === undefined || b === undefined) throw new Error('both rides keep the block');
    // Two rides from two starts kept the same block alike, to the centimetre.
    expect(
      farthest(await unpackTileStreets(a.streets), await unpackTileStreets(b.streets)),
    ).toBeLessThanOrEqual(0.01);
    // And about its north-west corner: every point of its streets is east of
    // it (x, metres west, at most 0) and south of it (z, metres north, at
    // most 0), as it is in no ride's frame. The corner is the block's own.
    const corner = blockFrame(BLOCK);
    expect(
      blockOf({ latitude: corner.latitude - 1e-6, longitude: corner.longitude + 1e-6 }),
    ).toStrictEqual(BLOCK);
    const points = (await unpackTileStreets(a.streets)).flatMap((each) =>
      each.streets.flatMap((f) => [...f.line]),
    );
    expect(points.length).toBeGreaterThan(0);
    expect(Math.max(...points)).toBeLessThanOrEqual(0.01);
  });
});

describe('a kept block’s streets reach the street graph', () => {
  it('tells the session each time a kept block is handed out, as it does for a read one', async () => {
    let fromArchive = 0;
    await ride(ATHLETE_A, { onChange: () => (fromArchive += 1) });
    let fromCache = 0;
    const second = await ride(ATHLETE_A, { onChange: () => (fromCache += 1) });
    expect(second.calls).toStrictEqual([]);
    expect(fromArchive).toBe(9);
    expect(fromCache).toBe(9);
  });

  it('builds the same graph from a kept block’s streets as from a fresh read’s', async () => {
    const first = await ride(ATHLETE_A);
    for (const store of open.splice(0)) store.close();
    const second = await ride(ATHLETE_A);
    expect(second.calls).toStrictEqual([]);

    const graphOf = async (held: readonly HeldBlock[]) => {
      const builder = workerGraphBuilder(
        { latitude: START.latitude, longitude: START.longitude },
        inlineGraphWorker,
      );
      try {
        return await builder.apply({ add: held.flatMap((h) => h.streets), remove: [] });
      } finally {
        builder.stop();
      }
    };
    const fromArchive = await graphOf(first.area.held());
    const fromCache = await graphOf(second.area.held());
    expect(fromArchive?.edges.length ?? 0).toBeGreaterThan(0);
    expect(fromCache?.edges.length).toBe(fromArchive?.edges.length);
    expect(fromCache?.nodes.length).toBe(fromArchive?.nodes.length);
    expect(fromCache?.refusals).toStrictEqual([]);
  });
});

describe('only a block read whole is kept', () => {
  /** One tile of the centre block, the one with the streets. */
  const [BROKEN] = tilesOfBlock(BLOCK);
  const brokenKey = `${String(BROKEN?.x)}/${String(BROKEN?.y)}`;
  const EAST = inside({ x: BLOCK.x + 1, y: BLOCK.y }, 0.5, 0.5);

  it('never keeps a block with a tile still refused after its re-reads, and the next ride reads it again', async () => {
    const failing = new Set([brokenKey]);
    const first = await ride(ATHLETE_A, { source: flakySource(archive, failing) });
    expect(first.started).toStrictEqual({ kind: 'ready' });
    const partly = heldBlock(first.area.held(), BLOCK);
    expect(partly?.tiles.filter((t) => t.state === 'refused')).toHaveLength(1);
    // Both its re-reads, at two crossings that still hold it, fail too.
    first.area.moveTo(EAST);
    await first.area.settled();
    first.area.moveTo(START);
    await first.area.settled();
    expect(
      heldBlock(first.area.held(), BLOCK)?.tiles.filter((t) => t.state === 'refused'),
    ).toHaveLength(1);

    const store = fresh();
    await expect(store.getRiddenBlock(ATHLETE_A, blockKey(BLOCK))).resolves.toBeUndefined();
    // The eight read whole are kept.
    for (const block of blocksAround(BLOCK).slice(1)) {
      expect((await store.getRiddenBlock(ATHLETE_A, blockKey(block)))?.owner).toBe(ATHLETE_A);
    }

    // The next ride asks for the part-read block, and for nothing else.
    failing.clear();
    const next = await ride(ATHLETE_A);
    const asked = tilesRequested(tiles(), archive, next.calls).map(
      (t) => `${String(t.x)}/${String(t.y)}`,
    );
    expect(asked.sort()).toStrictEqual(
      tilesOfBlock(BLOCK)
        .map((t) => `${String(t.x)}/${String(t.y)}`)
        .sort(),
    );
    const now = await fresh().getRiddenBlock(ATHLETE_A, blockKey(BLOCK));
    expect(now?.tiles.every((t) => t.state === 'covered')).toBe(true);
  });

  it('keeps a block once a re-read completes it, with what both reads brought', async () => {
    const failing = new Set([brokenKey]);
    const first = await ride(ATHLETE_A, { source: flakySource(archive, failing) });
    await expect(fresh().getRiddenBlock(ATHLETE_A, blockKey(BLOCK))).resolves.toBeUndefined();
    failing.clear();
    first.area.moveTo(EAST);
    await first.area.settled();
    const whole = heldBlock(first.area.held(), BLOCK);
    expect(whole?.tiles.every((t) => t.state === 'covered')).toBe(true);

    const kept = await fresh().getRiddenBlock(ATHLETE_A, blockKey(BLOCK));
    expect(kept?.tiles.every((t) => t.state === 'covered')).toBe(true);
    expect(kept && (await unpackTileStreets(kept.streets)).map((each) => each.tile)).toStrictEqual(
      whole?.streets.map((each) => each.tile),
    );
  });
});

describe('a kept street carries its road fields and its name, and nothing else does (ADR 0098)', () => {
  it('keeps the road fields and the name in the streets blob alone, and reads both back', async () => {
    const NAME = 'Third Avenue';
    const store = fresh();
    const cache = riddenBlockCache({
      store,
      owner: ATHLETE_A,
      archiveUrl: ARCHIVE_URL,
      now: () => new Date('2026-11-20T09:00:00Z'),
    });
    const tile = tilesOfBlock(BLOCK)[0] as ReturnType<typeof tilesOfBlock>[number];
    const street = {
      kind: 'minor_road',
      kindDetail: 'residential',
      grade: 'bridge',
      oneway: 'against-line',
      access: 'private',
      isLink: true,
      name: NAME,
      line: Float32Array.of(-10, -20, -30.5, -40.25),
    } as const;
    await cache.put(
      BLOCK,
      {
        tiles: tilesOfBlock(BLOCK).map((t) => ({ x: t.x, y: t.y, state: 'covered' })),
        features: { landUse: [], buildings: [], paths: [], streets: [street], places: [] },
        streets: [{ tile, streets: [street] }],
      },
      '"etag"',
    );
    const record = await fresh().getRiddenBlock(ATHLETE_A, blockKey(BLOCK));
    if (record === undefined) throw new Error('the block is kept');
    const textOf = async (blob: Blob) =>
      new TextDecoder().decode(await gunzipBytes(new Uint8Array(await blob.arrayBuffer())));
    // The name is in the streets blob, and only there: the features carry none.
    expect(await textOf(record.streets)).toContain(NAME);
    expect(await textOf(record.features)).not.toContain(NAME);
    const kept = await cache.get(BLOCK);
    expect(kept?.streets).toStrictEqual([
      {
        tile,
        streets: [
          {
            kind: street.kind,
            kindDetail: street.kindDetail,
            grade: street.grade,
            oneway: street.oneway,
            access: street.access,
            isLink: street.isLink,
            name: NAME,
            line: street.line,
          },
        ],
      },
    ]);
  });

  it('holds each road field to the decoder’s own values when the blob says another', async () => {
    const json = JSON.stringify({
      v: 1,
      tiles: [
        {
          x: 1,
          y: 2,
          streets: [
            { kind: 7, detail: null, g: 'sky', o: 'sideways', a: 'maybe', l: 'yes', line: [100] },
            // A name is held to the decoder's own rules (ADR 0096 D-1.3).
            {
              kind: 'minor_road',
              detail: '',
              g: 'ground',
              o: 'no',
              a: 'open',
              l: false,
              n: 'Main\u0000 Street\u202e',
              line: [],
            },
            {
              kind: 'minor_road',
              detail: '',
              g: 'ground',
              o: 'no',
              a: 'open',
              l: false,
              n: 7,
              line: [],
            },
            {
              kind: 'minor_road',
              detail: '',
              g: 'ground',
              o: 'no',
              a: 'open',
              l: false,
              n: '   ',
              line: [],
            },
          ],
        },
      ],
    });
    const blob = new Blob([await gzipBytes(new TextEncoder().encode(json))]);
    expect(await unpackTileStreets(blob)).toStrictEqual([
      {
        tile: { z: 15, x: 1, y: 2 },
        streets: [
          {
            kind: '',
            kindDetail: '',
            grade: 'ground',
            oneway: 'no',
            access: 'open',
            isLink: false,
            line: Float32Array.of(1),
          },
          {
            kind: 'minor_road',
            kindDetail: '',
            grade: 'ground',
            oneway: 'no',
            access: 'open',
            isLink: false,
            name: 'Main Street',
            line: new Float32Array(0),
          },
          ...[0, 1].map(() => ({
            kind: 'minor_road',
            kindDetail: '',
            grade: 'ground',
            oneway: 'no',
            access: 'open',
            isLink: false,
            line: new Float32Array(0),
          })),
        ],
      },
    ]);
    const other = new Blob([await gzipBytes(new TextEncoder().encode('{"v":2,"tiles":[]}'))]);
    await expect(unpackTileStreets(other)).rejects.toThrow('not a version this reads');
  });
});

describe('a cache answer that comes too late is not held (#2891 review)', () => {
  /** A cache whose every answer waits until the test gives it, and which keeps nothing. */
  function slowCache() {
    const answers: (() => void)[] = [];
    const cache: AreaCache = {
      get: () =>
        new Promise<KeptBlock>((resolve) => {
          answers.push(() =>
            resolve({
              tiles: [],
              features: { landUse: [], buildings: [], paths: [], streets: [], places: [] },
              streets: [],
            }),
          );
        }),
      put: () => Promise.resolve(),
    };
    return { cache, answers };
  }

  function slowReader(cache: AreaCache, changes: { count: number }) {
    return createAreaReader({
      archive: undefined,
      frame: { latitude: START.latitude, longitude: START.longitude },
      cache,
      mapTilesOn: () => true,
      random: () => 0,
      schedule: (run) => {
        run();
        return () => undefined;
      },
      yieldToIdle: () => Promise.resolve(),
      onChange: () => (changes.count += 1),
    });
  }

  /** Lets every pending promise settle. */
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  it('holds nothing, and says nothing, when the hit comes after the ride stopped', async () => {
    const { cache, answers } = slowCache();
    const changes = { count: 0 };
    const area = slowReader(cache, changes);
    const started = area.start(START);
    await flush();
    expect(answers).toHaveLength(1);
    area.stop();
    answers.shift()?.();
    expect((await started).kind).not.toBe('ready');
    await flush();
    expect(area.held()).toStrictEqual([]);
    expect(changes.count).toBe(0);
  });

  it('holds nothing, and says nothing, when the hit is for a block the rider has left', async () => {
    const { cache, answers } = slowCache();
    const changes = { count: 0 };
    const area = slowReader(cache, changes);
    const started = area.start(START);
    await flush();
    expect(answers).toHaveLength(1);
    // Five blocks east: the start's block is no longer in the 3 × 3.
    area.moveTo(inside({ x: BLOCK.x + 5, y: BLOCK.y }, 0.5, 0.5));
    answers.shift()?.();
    await flush();
    expect(area.held().some((h) => blockKey(h.block) === blockKey(BLOCK))).toBe(false);
    expect(changes.count).toBe(0);
    area.stop();
    for (const answer of answers.splice(0)) answer();
    await started;
  });
});

describe('a kept street’s name is never logged (ADR 0098)', () => {
  it('says a store’s failure, and a kept block’s read, without one name, over streets that all have one', async () => {
    const named = await openWorldFixtureArchive(OPEN_WORLD_GRID_STREETS);
    const start = fixtureStart(START_COLUMN, START_ROW).position;
    const names = [...GRID_ROW_NAMES, ...GRID_COLUMN_NAMES].filter(
      (name): name is string => name !== undefined,
    );
    expect(names.length).toBeGreaterThan(5);
    const rideOver = async (store: RiddenBlockStore) => {
      const log: string[] = [];
      const area = createAreaReader({
        archive: corridorArchiveFrom(countingSource(named)),
        frame: { latitude: start.latitude, longitude: start.longitude },
        cache: riddenBlockCache({
          store,
          owner: ATHLETE_A,
          archiveUrl: ARCHIVE_URL,
          now: () => new Date('2026-11-25T09:00:00Z'),
        }),
        mapTilesOn: () => true,
        random: () => 0,
        yieldToIdle: () => Promise.resolve(),
        log: (line) => log.push(line),
      });
      expect(await area.start(start)).toStrictEqual({ kind: 'ready' });
      await area.settled();
      const held = area.held().flatMap((h) => h.streets.flatMap((each) => each.streets));
      area.stop();
      return { log, held };
    };
    // Kept, then read back from the cache: the names are held, and logged nowhere.
    const first = await rideOver(fresh());
    const second = await rideOver(fresh());
    expect(second.held.some((street) => street.name === 'Main Street')).toBe(true);
    // A store that refuses every write and every read: its failures are said.
    const broken = await rideOver({
      getRiddenBlock: () => Promise.reject(new DOMException('gone', 'InvalidStateError')),
      putRiddenBlock: () => Promise.reject(new DOMException('full', 'QuotaExceededError')),
      markRiddenBlock: () => Promise.resolve(false),
    });
    expect(broken.log.length).toBeGreaterThan(0);
    for (const line of [...first.log, ...second.log, ...broken.log]) {
      for (const name of names) expect(line).not.toContain(name);
    }
  });
});

describe('keeping a block never holds up the ride (#2891 review)', () => {
  it('starts while every cache write is still waiting, and settles once they are written', async () => {
    const release: (() => void)[] = [];
    const puts: number[] = [];
    const cache: AreaCache = {
      get: () => Promise.resolve(undefined),
      put: (block) =>
        new Promise<void>((resolve) => {
          release.push(() => {
            puts.push(blockKey(block));
            resolve();
          });
        }),
    };
    const area = createAreaReader({
      archive: corridorArchiveFrom(countingSource(archive)),
      frame: { latitude: START.latitude, longitude: START.longitude },
      cache,
      mapTilesOn: () => true,
      random: () => 0,
      yieldToIdle: () => Promise.resolve(),
    });
    // The start answers with no write done: the pump waits on no store.
    expect(await area.start(START)).toStrictEqual({ kind: 'ready' });
    expect(puts).toStrictEqual([]);
    let settled = false;
    const done = area.settled().then(() => (settled = true));
    for (let turn = 0; turn < 50 && release.length < 9; turn += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(release).toHaveLength(9);
    expect(settled).toBe(false);
    for (const write of release.splice(0)) write();
    await done;
    expect(puts).toHaveLength(9);
    area.stop();
  });

  it('yields to idle after a block is read, before it converts and packs it to keep', async () => {
    const waiting: (() => void)[] = [];
    let gated = false;
    const puts: number[] = [];
    const area = createAreaReader({
      archive: corridorArchiveFrom(countingSource(archive)),
      frame: { latitude: START.latitude, longitude: START.longitude },
      cache: {
        get: () => Promise.resolve(undefined),
        put: (block) => {
          puts.push(blockKey(block));
          return Promise.resolve();
        },
      },
      mapTilesOn: () => true,
      random: () => 0,
      // Idle never comes once the first block is held, until the test says.
      yieldToIdle: () =>
        gated ? new Promise<void>((resolve) => waiting.push(resolve)) : Promise.resolve(),
      onChange: () => (gated = true),
    });
    void area.start(START);
    for (let turn = 0; turn < 50 && waiting.length === 0; turn += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(waiting.length).toBeGreaterThan(0);
    await new Promise((resolve) => setTimeout(resolve, 0));
    // The first block is held and announced, and nothing of it is kept yet.
    expect(area.held().length).toBeGreaterThan(0);
    expect(puts).toStrictEqual([]);
    // Idle comes: the reads go on and every block is kept.
    gated = false;
    for (let turn = 0; turn < 200 && puts.length < 9; turn += 1) {
      for (const resolve of waiting.splice(0)) resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(puts).toHaveLength(9);
    area.stop();
  });
});
