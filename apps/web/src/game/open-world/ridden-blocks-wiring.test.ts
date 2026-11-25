// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The ridden-block cache is live in the open-world ride** — #2891, ADR 0090
 * D-6.7.
 *
 * ⚠️ **Why this file exists.** `riddenBlocks` is an optional member at every
 * step: of `main.tsx`'s `lazyOpenWorldSessions` options, of the session's
 * options, and of the reader's (`cache`). Dropping any of them leaves
 * `check:wiring` green and every ride asking the archive again, and the
 * owner's tablet measurement of the cache with nothing to measure. So this
 * rides the **real session** twice over one store, on fresh handles: the first
 * ride keeps its blocks, and the second asks the archive for none of their
 * tiles. It then holds the lazy port to handing the session the store and
 * athlete it is given, and `main.tsx` to giving it the store the ride uses and
 * the local athlete.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { openActivityStore, type ActivityStore } from '@onyourleft/store';
import {
  ATHLETE_A,
  createStoreHarness,
  resetFixtureIds,
  seedAthletes,
} from '@onyourleft/store/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BASEMAP_ATTRIBUTION } from '../../map/basemap';
import { stripComments } from '../../units/no-inline-units';
import { countingSource, type CountingSource } from '../../world-data/archive-testing';
import { corridorArchiveFrom } from '../../world-data/corridor-source';
import { blockKey, blockOf, blocksAround } from '../world-data/area';
import { createOpenWorldEntry } from './entry';
import { fixtureStart, openWorldFixtureArchive, START_COLUMN, START_ROW } from './fixture-testing';
import { createOpenWorldSession } from './session';
import { lazyOpenWorldSessions } from './session-lazy';

const ARCHIVE_URL = 'https://tiles.example.org/basemap-us.pmtiles';
const START = fixtureStart(START_COLUMN, START_ROW);

let harness: ReturnType<typeof createStoreHarness>;
let archive: Uint8Array;
const open: ActivityStore[] = [];

beforeEach(async () => {
  resetFixtureIds();
  harness = createStoreHarness();
  await seedAthletes(harness);
  await harness.discard();
  archive = await openWorldFixtureArchive();
});

afterEach(async () => {
  vi.unstubAllGlobals();
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
 * Waits, a task at a time, until the athlete keeps `count` blocks: a ride
 * writes its blocks after it is ready, never before (`area.ts` §`keepLater`).
 * Bounded by turns, not by a timeout.
 */
async function untilKept(count: number): Promise<void> {
  const store = fresh();
  const block = blockOf(START.position);
  if (block === undefined) throw new Error('the start is a position');
  for (let turn = 0; turn < 2_000; turn += 1) {
    let kept = 0;
    for (const each of blocksAround(block)) {
      if ((await store.getRiddenBlock(ATHLETE_A, blockKey(each))) !== undefined) kept += 1;
    }
    if (kept >= count) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(`the ride kept fewer than ${String(count)} blocks`);
}

/** One ride through the real session over a counting archive and a fresh store handle. */
async function ride(source: CountingSource) {
  const session = createOpenWorldSession({
    start: START,
    archive: corridorArchiveFrom(source),
    mapTilesOn: () => true,
    yieldToIdle: () => Promise.resolve(),
    riddenBlocks: {
      store: fresh(),
      owner: ATHLETE_A,
      archiveUrl: ARCHIVE_URL,
      now: () => new Date('2026-11-25T09:00:00Z'),
    },
  });
  try {
    return await session.ready;
  } finally {
    session.stop();
  }
}

describe('the open-world session keeps its blocks, and the next ride asks nothing for them', () => {
  it('ride 1 keeps the start’s 3 × 3; ride 2, on a fresh handle, makes no request at all', async () => {
    const first = countingSource(archive);
    expect((await ride(first)).kind).toBe('ready');
    expect(first.calls.length).toBeGreaterThan(0);

    // The writes are not awaited by the ride (`area.ts` §`keepLater`): wait
    // for them, then close every handle and read back on a fresh one.
    const block = blockOf(START.position);
    if (block === undefined) throw new Error('the start is a position');
    await untilKept(blocksAround(block).length);
    for (const store of open.splice(0)) store.close();
    const store = fresh();
    for (const each of blocksAround(block)) {
      expect((await store.getRiddenBlock(ATHLETE_A, blockKey(each)))?.owner).toBe(ATHLETE_A);
    }

    const second = countingSource(archive);
    expect((await ride(second)).kind).toBe('ready');
    // Not a tile, and not even the archive's header.
    expect(second.calls).toStrictEqual([]);
  });
});

describe('the lazy port hands the session the store and athlete it is given', () => {
  it('rides what ride 1 kept with map tiles off and no network, and only when it is given them', async () => {
    expect((await ride(countingSource(archive))).kind).toBe('ready');
    await untilKept(9);
    const fetches = vi.fn(() => Promise.reject(new TypeError('Failed to fetch')));
    vi.stubGlobal('fetch', fetches);
    const basemap = () => ({ archiveUrl: ARCHIVE_URL, attribution: BASEMAP_ATTRIBUTION });

    const keeping = lazyOpenWorldSessions({
      entry: createOpenWorldEntry(),
      basemap,
      mapTilesOn: () => false,
      riddenBlocks: { store: fresh(), owner: ATHLETE_A },
    });
    const kept = keeping.open(START);
    expect((await kept.ready).kind).toBe('ready');
    kept.stop();
    expect(fetches).not.toHaveBeenCalled();

    // No store and no athlete: as before the cache, nothing to ride with tiles off.
    const none = lazyOpenWorldSessions({
      entry: createOpenWorldEntry(),
      basemap,
      mapTilesOn: () => false,
    });
    expect(await none.open(START).ready).toStrictEqual({
      kind: 'refused',
      refusal: 'map-tiles-off',
    });
  });
});

describe('main.tsx gives the open world the store the ride uses, and the local athlete', () => {
  const SOURCE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const main = stripComments(readFileSync(join(SOURCE_ROOT, 'main.tsx'), 'utf8'));
  const gamePort = main.slice(
    main.indexOf('function buildGamePort('),
    main.indexOf('function buildGameTrainerPort('),
  );

  it('passes riddenBlocks over the game port’s own store and LOCAL_ATHLETE', () => {
    expect(gamePort).toMatch(/const store = localStore\(\);/);
    expect(gamePort).toMatch(
      /openWorld: lazyOpenWorldSessions\(\{[^}]*riddenBlocks: \{ store, owner: LOCAL_ATHLETE \},\s*\}\)/,
    );
  });
});
