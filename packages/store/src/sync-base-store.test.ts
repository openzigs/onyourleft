// SPDX-License-Identifier: Apache-2.0

/**
 * The sync base (#776, after #893's review): what this device and its
 * instance agreed on at the last sync, one row per ride and per item.
 *
 * The property everything else rests on is that a ride's base row
 * **outlives the ride** — it is the device's only memory that a synced ride
 * was deleted here, which is what stops the next sync pulling it back (#893's
 * B1). So the round trip deletes the ride between the write and the read, and
 * the two broken stores are required to go red on it.
 */

import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { StoreDecodeError, StoreReferentialError, StoreValidationError } from './errors';
import { activityId, athleteId } from './ids';
import type { SyncBaseRecord } from './records';
import { SCHEMA_VERSIONS, TABLE } from './schema';
import {
  assertSyncBaseRoundTrip,
  ATHLETE_A,
  ATHLETE_B,
  cascadingSyncBaseStoreFactory,
  createStoreHarness,
  memoryWriteStoreFactory,
  resetFixtureIds,
  RoundTripFailure,
  seedAthletes,
  seedRide,
  syncBaseFor,
} from './testing';
import type { StoreFactory, StoreHarness } from './testing';

let harness: StoreHarness;

async function harnessWith(factory?: StoreFactory): Promise<StoreHarness> {
  const made = createStoreHarness(factory === undefined ? {} : { factory });
  await seedAthletes(made);
  return made;
}

beforeEach(async () => {
  resetFixtureIds();
  harness = await harnessWith();
});

afterEach(async () => {
  await harness.destroy();
});

describe('the sync base', () => {
  it('outlives the ride it names, and reads back whole on a fresh connection', async () => {
    const ride = await seedRide(harness, ATHLETE_A);
    for (const kind of ['activity', 'write-up', 'side-camera-report'] as const) {
      const base = syncBaseFor(ATHLETE_A, ride.id, kind);
      await expect(assertSyncBaseRoundTrip(harness, base)).resolves.toStrictEqual(base);
    }
  });

  it('is red against a store whose ride delete takes the base with it', async () => {
    const broken = await harnessWith(cascadingSyncBaseStoreFactory());
    try {
      const ride = await seedRide(broken, ATHLETE_A);
      await expect(
        assertSyncBaseRoundTrip(broken, syncBaseFor(ATHLETE_A, ride.id)),
      ).rejects.toBeInstanceOf(RoundTripFailure);
    } finally {
      await broken.destroy();
    }
  });

  it('is red against a store that never writes it', async () => {
    const broken = await harnessWith(memoryWriteStoreFactory());
    try {
      // Every write is diverted, so no ride is needed: the base alone is lost.
      await expect(
        assertSyncBaseRoundTrip(broken, syncBaseFor(ATHLETE_A, activityId('ride-anywhere'))),
      ).rejects.toBeInstanceOf(RoundTripFailure);
    } finally {
      await broken.destroy();
    }
  });

  it('replaces the row for the same kind and key, and forgets it on request', async () => {
    const ride = await seedRide(harness, ATHLETE_A);
    const first = syncBaseFor(ATHLETE_A, ride.id, 'write-up');
    const second = { ...first, localDigest: 'a'.repeat(64), remoteDigest: 'b'.repeat(64) };
    await harness.write(async (store) => {
      await store.putSyncBase(first);
      await store.putSyncBase(second);
    });
    await expect(
      harness.read(async (store) => store.listSyncBase(ATHLETE_A)),
    ).resolves.toStrictEqual([second]);
    const forgotten = await harness.write(async (store) =>
      store.deleteSyncBase(ATHLETE_A, 'write-up', ride.id),
    );
    expect(forgotten).toBe(true);
    await expect(
      harness.read(async (store) => store.listSyncBase(ATHLETE_A)),
    ).resolves.toStrictEqual([]);
    await expect(
      harness.write(async (store) => store.deleteSyncBase(ATHLETE_A, 'write-up', ride.id)),
    ).resolves.toBe(false);
  });

  it('goes with the athlete', async () => {
    const ride = await seedRide(harness, ATHLETE_A);
    const other = await seedRide(harness, ATHLETE_B);
    await harness.write(async (store) => {
      await store.putSyncBase(syncBaseFor(ATHLETE_A, ride.id));
      await store.putSyncBase(syncBaseFor(ATHLETE_B, other.id));
    });
    const counts = await harness.write(async (store) => store.deleteAthlete(ATHLETE_A));
    expect(counts.syncBases).toBe(1);
    const [mine, theirs] = await harness.read(async (store) =>
      Promise.all([store.listSyncBase(ATHLETE_A), store.listSyncBase(ATHLETE_B)]),
    );
    expect(mine).toStrictEqual([]);
    expect(theirs).toStrictEqual([syncBaseFor(ATHLETE_B, other.id)]);
  });

  it('refuses a row for an athlete who does not exist', async () => {
    const ride = await seedRide(harness, ATHLETE_A);
    await expect(
      harness.write(async (store) =>
        store.putSyncBase({ ...syncBaseFor(ATHLETE_A, ride.id), athleteId: athleteId('nobody') }),
      ),
    ).rejects.toBeInstanceOf(StoreReferentialError);
  });

  it.each([
    ['kind', { kind: 'route' }],
    ['key', { key: 'NOT-HEX' }],
    ['localDigest', { localDigest: 'f'.repeat(63) }],
    ['remoteDigest', { remoteDigest: 'F'.repeat(64) }],
    ['activityId', { activityId: '' }],
  ] as const)('refuses a row whose %s is wrong, naming the field', async (field, change) => {
    const ride = await seedRide(harness, ATHLETE_A);
    const bad = { ...syncBaseFor(ATHLETE_A, ride.id), ...change } as unknown as SyncBaseRecord;
    await expect(harness.write(async (store) => store.putSyncBase(bad))).rejects.toThrow(
      new RegExp(`^syncBase\\.${field}:`),
    );
    await expect(harness.write(async (store) => store.putSyncBase(bad))).rejects.toBeInstanceOf(
      StoreValidationError,
    );
  });

  it('refuses an item row whose key is not its ride', async () => {
    const ride = await seedRide(harness, ATHLETE_A);
    const bad = { ...syncBaseFor(ATHLETE_A, ride.id, 'write-up'), key: 'another-ride' };
    await expect(harness.write(async (store) => store.putSyncBase(bad))).rejects.toThrow(
      /^syncBase\.key:/,
    );
  });

  it('refuses a hand-edited row on the way out', async () => {
    const ride = await seedRide(harness, ATHLETE_A);
    await harness.discard();
    const raw = new Dexie(harness.databaseName);
    SCHEMA_VERSIONS.forEach((stores, index) => {
      raw.version(index + 1).stores(stores);
    });
    await raw
      .table(TABLE.syncBases)
      .put({ ...syncBaseFor(ATHLETE_A, ride.id), localDigest: 'edited' });
    raw.close();
    await expect(
      harness.read(async (store) => store.listSyncBase(ATHLETE_A)),
    ).rejects.toBeInstanceOf(StoreDecodeError);
  });
});
