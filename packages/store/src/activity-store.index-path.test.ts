// SPDX-License-Identifier: Apache-2.0

/**
 * #26's last acceptance criterion asks for "a test [that] asserts the
 * activity-list query uses an index rather than a sequential scan".
 *
 * On a SQL database that is `EXPLAIN`. **IndexedDB has no query planner, no
 * `EXPLAIN` and no statistics**, so there is no plan to inspect — an index is
 * used when the code asks for it by name and is not used otherwise. The honest
 * mechanical equivalent is one level down, at the IndexedDB API itself:
 *
 * - An **index read** reaches records through `IDBObjectStore.index(name)` and
 *   then `IDBIndex.getAll` / `IDBIndex.openCursor`.
 * - A **full object-store scan** — which is what `toArray()` followed by a
 *   JavaScript `.filter()` compiles to — reads through `IDBObjectStore.getAll`
 *   or `IDBObjectStore.openCursor`.
 *
 * So the assertion is: the query reads through `IDBIndex` and never through
 * `IDBObjectStore`'s own bulk readers. That is a real, observable distinction
 * on this engine, and it is the one that matters — a declared index that
 * nothing routes through is decoration.
 *
 * **The control test in the first block is not optional.** "`IDBObjectStore`
 * was not read from" is a vacuous assertion unless something in the same file
 * proves the counters fire when a scan does happen, so the control performs the
 * scan this package exists to avoid and asserts the counters catch it. Without
 * it, a rename in a future Dexie or fake-indexeddb would silently turn every
 * assertion below into a tautology.
 *
 * `IDBObjectStore.get` is deliberately **not** counted as a scan: a primary-key
 * point read is not a sequential scan. It is counted separately so the
 * `getActivity` test can distinguish "used the compound index" from "read by
 * primary key and checked the owner in JavaScript" — the latter works and is
 * exactly the shape that goes wrong when someone later forgets the check.
 */

import Dexie from 'dexie';
import { beatsPerMinute, metres, seconds, unixSeconds, watts } from '@onyourleft/domain';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { deleteActivityStore, openActivityStore, type ActivityStore } from './index';
import { activityId, athleteId, lapId } from './ids';
import type { PersistedActivity } from './persisted';
import { SCHEMA_VERSIONS, TABLE } from './schema';

const ATHLETE_A = athleteId('athlete-a');
const ATHLETE_B = athleteId('athlete-b');

/** Bulk readers. Reaching records through these on the object store is a scan. */
const BULK_READERS = ['getAll', 'getAllKeys', 'openCursor', 'openKeyCursor'] as const;

interface AccessCounts {
  /** Reads that went through an index. */
  index: number;
  /** Bulk reads that went straight at the object store — a sequential scan. */
  objectStoreScan: number;
  /** Primary-key point reads. Not a scan; counted so it can be told apart. */
  objectStorePointRead: number;
}

/**
 * Counts IndexedDB reads by path for the duration of `run`.
 *
 * Patches the prototypes rather than using `vi.spyOn`, because the two shapes
 * that have to be told apart live on two different prototypes and the
 * assertion is about their ratio rather than about any one call.
 */
async function countAccess<T>(run: () => Promise<T>): Promise<[T, AccessCounts]> {
  const counts: AccessCounts = { index: 0, objectStoreScan: 0, objectStorePointRead: 0 };
  const restore: (() => void)[] = [];

  const patch = (proto: object, method: string, tally: (counts: AccessCounts) => void): void => {
    const descriptor = Object.getOwnPropertyDescriptor(proto, method);
    if (descriptor === undefined || typeof descriptor.value !== 'function') {
      return;
    }
    const original = descriptor.value as (...args: unknown[]) => unknown;
    Object.defineProperty(proto, method, {
      ...descriptor,
      value: function (this: unknown, ...args: unknown[]): unknown {
        tally(counts);
        return original.apply(this, args);
      },
    });
    restore.push(() => {
      Object.defineProperty(proto, method, descriptor);
    });
  };

  for (const method of BULK_READERS) {
    patch(IDBIndex.prototype, method, (c) => (c.index += 1));
    patch(IDBObjectStore.prototype, method, (c) => (c.objectStoreScan += 1));
  }
  patch(IDBIndex.prototype, 'get', (c) => (c.index += 1));
  patch(IDBObjectStore.prototype, 'get', (c) => (c.objectStorePointRead += 1));

  try {
    return [await run(), counts];
  } finally {
    for (const undo of restore.reverse()) {
      undo();
    }
  }
}

let databaseName: string;
let store: ActivityStore;

beforeEach(async () => {
  databaseName = `oyl-index-${String(Date.now())}-${String(Math.random()).slice(2)}`;
  store = openActivityStore(databaseName);
  await store.putAthlete({ id: ATHLETE_A, displayName: 'A', createdAt: unixSeconds(0) });
  await store.putAthlete({ id: ATHLETE_B, displayName: 'B', createdAt: unixSeconds(0) });
  for (let index = 0; index < 20; index += 1) {
    await store.putActivity({
      id: activityId(`a-${String(index).padStart(2, '0')}`),
      athleteId: index % 2 === 0 ? ATHLETE_A : ATHLETE_B,
      name: `ride ${String(index)}`,
      startedAt: unixSeconds(1_000 + index),
      startedAtTimeZone: 'UTC',
      elapsedTime: seconds(60),
      movingTime: seconds(50),
      distance: metres(1_000 + index),
      hasPosition: false,
      createdAt: unixSeconds(1_000 + index),
    });
  }
});

afterEach(async () => {
  store.close();
  await deleteActivityStore(databaseName);
});

describe('the counters can tell the two access paths apart', () => {
  it('a deliberate full object-store scan is counted as a scan and not as an index read', async () => {
    // The implementation #26 forbids, written out so that every "did not scan"
    // assertion below is known to be capable of failing.
    const raw = new Dexie(databaseName);
    // Every version, not only the newest: Dexie drops any object store a
    // declared version does not mention, so a handle declaring version 2 with
    // version 1's four stores would delete #27's two.
    SCHEMA_VERSIONS.forEach((stores, index) => {
      raw.version(index + 1).stores(stores);
    });

    const [scanned, counts] = await countAccess(async () => {
      const all = await raw.table<PersistedActivity, string>(TABLE.activities).toArray();
      return all.filter((row) => row.athleteId === ATHLETE_A);
    });
    raw.close();

    expect(scanned).toHaveLength(10);
    expect(counts.objectStoreScan).toBeGreaterThan(0);
    expect(counts.index).toBe(0);
  });
});

describe('listActivitySummaries reads through an index, not a scan', () => {
  it('ordered by start time', async () => {
    const [rows, counts] = await countAccess(() => store.listActivitySummaries(ATHLETE_A));

    expect(rows).toHaveLength(10);
    expect(counts.index).toBeGreaterThan(0);
    expect(counts.objectStoreScan).toBe(0);
  });

  it('ordered by distance', async () => {
    const [rows, counts] = await countAccess(() =>
      store.listActivitySummaries(ATHLETE_A, { orderBy: 'distance' }),
    );

    expect(rows).toHaveLength(10);
    expect(counts.index).toBeGreaterThan(0);
    expect(counts.objectStoreScan).toBe(0);
  });

  it('a limited first page still reads through the index', async () => {
    const [rows, counts] = await countAccess(() =>
      store.listActivitySummaries(ATHLETE_A, { limit: 3 }),
    );

    expect(rows).toHaveLength(3);
    expect(counts.index).toBeGreaterThan(0);
    expect(counts.objectStoreScan).toBe(0);
  });
});

describe('the athlete-scoped lookups read through their compound indexes', () => {
  it('getActivity uses [athleteId+id] rather than a primary-key read plus a check in JavaScript', async () => {
    const [found, counts] = await countAccess(() =>
      store.getActivity(ATHLETE_A, activityId('a-04')),
    );

    expect(found?.id).toBe('a-04');
    expect(counts.index).toBeGreaterThan(0);
    expect(counts.objectStoreScan).toBe(0);
    expect(counts.objectStorePointRead).toBe(0);
  });

  it('listLaps uses [athleteId+activityId+ordinal]', async () => {
    await store.putLap({
      id: lapId('lap-1'),
      activityId: activityId('a-04'),
      ordinal: 0,
      startedAt: unixSeconds(1_004),
      elapsedTime: seconds(10),
      movingTime: seconds(10),
      distance: metres(100),
    });

    const [laps, counts] = await countAccess(() => store.listLaps(ATHLETE_A, activityId('a-04')));

    expect(laps).toHaveLength(1);
    expect(counts.index).toBeGreaterThan(0);
    expect(counts.objectStoreScan).toBe(0);
  });

  it('findActivityByOriginalFileHash uses [athleteId+originalFileSha256]', async () => {
    const sha256 = 'e'.repeat(64);
    await store.putActivity({
      id: activityId('a-00'),
      athleteId: ATHLETE_A,
      name: 'imported',
      startedAt: unixSeconds(1_000),
      startedAtTimeZone: 'UTC',
      elapsedTime: seconds(60),
      movingTime: seconds(50),
      distance: metres(1_000),
      hasPosition: false,
      createdAt: unixSeconds(1_000),
      originalFile: { key: 'k', sha256 },
    });

    const [found, counts] = await countAccess(() =>
      store.findActivityByOriginalFileHash(ATHLETE_A, sha256),
    );

    expect(found?.id).toBe('a-00');
    expect(counts.index).toBeGreaterThan(0);
    expect(counts.objectStoreScan).toBe(0);
  });
});

describe('the stream reads route through their compound indexes too', () => {
  it('getStreamSet reads the summary and the blobs through [athleteId+activityId...]', async () => {
    await store.putStreamSet({
      activityId: activityId('a-04'),
      athleteId: ATHLETE_A,
      startedAt: unixSeconds(1_004),
      sampleInterval: seconds(1),
      sampleCount: 3,
      channels: { power: [watts(100), watts(110), watts(120)] },
    });

    const [read, counts] = await countAccess(() =>
      store.getStreamSet(ATHLETE_A, activityId('a-04')),
    );

    expect(read?.channels.power).toHaveLength(3);
    expect(counts.index).toBeGreaterThan(0);
    expect(counts.objectStoreScan).toBe(0);
    // Not a primary-key read followed by an owner check in JavaScript: the
    // stream set's primary key *is* the activity id, so that shape is the easy
    // mistake here and it is the one that returns another athlete's ride.
    expect(counts.objectStorePointRead).toBe(0);
  });

  it('getStreamChannel uses [athleteId+activityId+channel] rather than reading the whole set', async () => {
    await store.putStreamSet({
      activityId: activityId('a-06'),
      athleteId: ATHLETE_A,
      startedAt: unixSeconds(1_006),
      sampleInterval: seconds(1),
      sampleCount: 2,
      channels: {
        power: [watts(100), watts(110)],
        heartRate: [beatsPerMinute(120), beatsPerMinute(121)],
      },
    });

    const [power, counts] = await countAccess(() =>
      store.getStreamChannel(ATHLETE_A, activityId('a-06'), 'power'),
    );

    expect(power).toEqual([100, 110]);
    expect(counts.index).toBeGreaterThan(0);
    expect(counts.objectStoreScan).toBe(0);
    expect(counts.objectStorePointRead).toBe(0);
  });
});
