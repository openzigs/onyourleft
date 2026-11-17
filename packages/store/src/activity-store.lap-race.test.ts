// SPDX-License-Identifier: Apache-2.0

/**
 * **A race with AI bots is kept with the ride on the device** — #2710, ADR
 * 0071 D-4.4. `RideFacts.lapRaces` through the real store, on a fresh
 * connection: written by `putActivity` (the ride controller's save), read by
 * `getActivity`. And, as for a room race, a record that does not read is
 * dropped — on the way in and on the way out — never the ride.
 */

import Dexie from 'dexie';
import type { LapRaceModelRecord } from '@onyourleft/domain';
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
  type StoreHarness,
} from './testing';

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

const RACE: LapRaceModelRecord = {
  version: 1,
  seed: 2_718_281_828,
  log: [
    {
      askedAtMs: 4_000,
      arrivedAtMs: 6_600,
      outcome: 'decision',
      moves: [{ bot: 2, move: 'chase' }],
    },
    { askedAtMs: 8_000, arrivedAtMs: 13_100, outcome: 'late', reason: 'no-answer' },
  ],
  rider: {
    effortDistances: [0.42, 0.84, 1.26],
    wattsPerKilogram: [3.2, 3.3, null],
    lanes: [1, 1, 0],
    uses: [1],
  },
};

/** One ride's `rideFacts` as they were WRITTEN, read behind the store's back. */
async function writtenFacts(databaseName: string, id: string): Promise<unknown> {
  const raw = new Dexie(databaseName);
  SCHEMA_VERSIONS.forEach((stores, index) => {
    raw.version(index + 1).stores(stores);
  });
  try {
    return (await raw.table<PersistedActivity, string>(TABLE.activities).get(id))?.rideFacts;
  } finally {
    raw.close();
  }
}

describe('the races with AI bots kept with their ride — #2710', () => {
  it('are written by putActivity and read back whole on a fresh connection, by their rider only', async () => {
    const open = await opened();
    const ride: NewActivity = rideFor(ATHLETE_A, { rideFacts: { lapRaces: [RACE, RACE] } });
    const read = await open.roundTrip(
      async (store) => store.putActivity(ride),
      async (store) => ({
        mine: await store.getActivity(ATHLETE_A, ride.id),
        theirs: await store.getActivity(ATHLETE_B, ride.id),
      }),
    );
    expect(read.mine?.rideFacts?.lapRaces).toStrictEqual([RACE, RACE]);
    expect(read.theirs).toBeUndefined();
  });

  it('drops a record that does not read on the way in, and keeps the ride and the rest', async () => {
    const open = await opened();
    const facts = {
      ghostRaced: true,
      lapRaces: [{ ...RACE, model: 'a name' }, RACE, { ...RACE, version: 0 }],
    } as unknown as RideFacts;
    const ride: NewActivity = rideFor(ATHLETE_A, { rideFacts: facts });
    const read = await open.roundTrip(
      async (store) => store.putActivity(ride),
      async (store) => store.getActivity(ATHLETE_A, ride.id),
    );
    expect(read?.rideFacts).toStrictEqual({ ghostRaced: true, lapRaces: [RACE] });
    expect(await writtenFacts(open.databaseName, ride.id)).toStrictEqual({
      ghostRaced: true,
      lapRaces: [RACE],
    });
  });

  it('writes no list at all when none reads, and reads a ride whose list was edited by hand', async () => {
    const open = await opened();
    const ride: NewActivity = rideFor(ATHLETE_A, {
      rideFacts: { lapRaces: [{ seed: 1 }] } as unknown as RideFacts,
    });
    await open.write((store) => store.putActivity(ride));
    expect(await writtenFacts(open.databaseName, ride.id)).toStrictEqual({});
    const edited = new Dexie(open.databaseName);
    SCHEMA_VERSIONS.forEach((stores, index) => {
      edited.version(index + 1).stores(stores);
    });
    const table = edited.table<PersistedActivity, string>(TABLE.activities);
    const row = await table.get(ride.id);
    await table.put({ ...row!, rideFacts: { lapRaces: 'a race' as unknown as unknown[] } });
    edited.close();
    const read = await open.read((store) => store.getActivity(ATHLETE_A, ride.id));
    expect(read?.rideFacts).toStrictEqual({});
  });
});
