// SPDX-License-Identifier: Apache-2.0

/**
 * **A race's result is stored with the ride on the device** — #785, the
 * owner's ruling of 2026-10-14. `RideFacts.race` through the real store, on
 * a fresh connection: written by `putActivity` (the ride controller's save),
 * read by `getActivity` (the ride's page and the export). And, as for a
 * re-plan record, a race fact that does not read is dropped, never the ride.
 */

import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';

import type { PersistedActivity } from './persisted';
import type { NewActivity, RideFacts } from './records';
import { SCHEMA_VERSIONS, TABLE } from './schema';
import {
  ATHLETE_A,
  ATHLETE_B,
  createStoreHarness,
  rideFor,
  seedAthletes,
  seedRide,
  type StoreHarness,
} from './testing';

const ROOM = 'ab'.repeat(16);

let harness: StoreHarness | undefined;

afterEach(async () => {
  await harness?.destroy();
  harness = undefined;
});

async function opened(): Promise<StoreHarness> {
  const open = createStoreHarness();
  harness = open;
  await seedAthletes(open);
  return open;
}

/** Overwrite one ride's stored `rideFacts` behind the store's back. */
async function plant(databaseName: string, id: string, rideFacts: unknown): Promise<void> {
  const raw = new Dexie(databaseName);
  SCHEMA_VERSIONS.forEach((stores, index) => {
    raw.version(index + 1).stores(stores);
  });
  const table = raw.table<PersistedActivity, string>(TABLE.activities);
  const row = await table.get(id);
  if (row === undefined) throw new Error('no such ride to edit');
  await table.put({ ...row, rideFacts } as PersistedActivity);
  raw.close();
}

describe('a race kept with its ride — #785', () => {
  it('is written by putActivity and read back whole on a fresh connection, by its rider only', async () => {
    const open = await opened();
    const ride: NewActivity = rideFor(ATHLETE_A, {
      rideFacts: { race: { roomId: ROOM, place: 2, finishers: 5 } },
    });
    const read = await open.roundTrip(
      async (store) => store.putActivity(ride),
      async (store) => ({
        mine: await store.getActivity(ATHLETE_A, ride.id),
        theirs: await store.getActivity(ATHLETE_B, ride.id),
      }),
    );
    expect(read.mine?.rideFacts).toEqual({ race: { roomId: ROOM, place: 2, finishers: 5 } });
    expect(read.theirs).toBeUndefined();
  });

  it('keeps a race the rider did not finish, and one they left before the room said it was over', async () => {
    const open = await opened();
    for (const race of [
      { roomId: ROOM, place: null, finishers: 3 },
      { roomId: ROOM, place: null, finishers: null },
    ]) {
      const ride = rideFor(ATHLETE_A, { rideFacts: { race } });
      const read = await open.roundTrip(
        async (store) => store.putActivity(ride),
        async (store) => store.getActivity(ATHLETE_A, ride.id),
      );
      expect(read?.rideFacts?.race).toEqual(race);
    }
  });

  it('drops a race that does not read, on the way in and on the way out — never the ride', async () => {
    const open = await opened();
    for (const bad of [
      { roomId: 'not a room!', place: 1, finishers: 1 },
      { roomId: 'x'.repeat(129), place: 1, finishers: 1 },
      { roomId: ROOM, place: 3, finishers: 2 },
      { roomId: ROOM, place: 1, finishers: null },
      { roomId: ROOM, place: 0, finishers: 2 },
      { roomId: ROOM, place: 1.5, finishers: 2 },
      'a race',
    ]) {
      const ride = rideFor(ATHLETE_A, {
        rideFacts: { workoutFinished: true, race: bad } as unknown as RideFacts,
      });
      const read = await open.roundTrip(
        async (store) => store.putActivity(ride),
        async (store) => store.getActivity(ATHLETE_A, ride.id),
      );
      expect(read?.id, JSON.stringify(bad)).toBe(ride.id);
      expect(read?.rideFacts, JSON.stringify(bad)).toEqual({ workoutFinished: true });
    }
    const ride = await seedRide(open, ATHLETE_A);
    await open.discard();
    await plant(open.databaseName, ride.id, { race: { roomId: ROOM, place: 9, finishers: 1 } });
    const read = await open.read((store) => store.getActivity(ATHLETE_A, ride.id));
    expect(read?.id).toBe(ride.id);
    expect(read?.rideFacts).toEqual({});
  });
});
