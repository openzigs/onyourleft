// SPDX-License-Identifier: Apache-2.0

/**
 * **A group ride is kept with its ride** — #3303, epic #3296, ADR 0101.
 * `RideFacts.groupRide` through the real store on a fresh connection, written
 * by `putActivity` and read by `getActivity` (the ride's page, where #3310's
 * debrief reads it), by its rider only.
 *
 * A fact that does not read is dropped whole — never the ride — because an
 * entry missing from the middle of the log would be a different ride. A ride
 * saved before the field existed reads back with it absent.
 */

import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';

import { GROUP_RIDE_LOG_MOST, type GroupRideFact } from './records';
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

async function behindTheStore<T>(
  databaseName: string,
  use: (raw: Dexie) => Promise<T>,
): Promise<T> {
  const raw = new Dexie(databaseName);
  SCHEMA_VERSIONS.forEach((stores, index) => {
    raw.version(index + 1).stores(stores);
  });
  try {
    return await use(raw);
  } finally {
    raw.close();
  }
}

const FACT: GroupRideFact = {
  version: 1,
  seed: 4_021_337,
  startedAt: 2.5,
  targetSpeed: 30 / 3.6,
  bots: 5,
  log: [
    { at: 0, phase: 'forming', role: 'last-wheel', groupSpeed: 0 },
    { at: 14, phase: 'steady', role: 'last-wheel', groupSpeed: 8.3 },
    { at: 14, phase: 'steady', role: 'in-line', groupSpeed: 8.3 },
    { at: 96.5, phase: 'waiting', role: 'off-the-back', groupSpeed: 4.1 },
  ],
};

const first = FACT.log[0];
const second = FACT.log[1];

/** Facts that do not read: each is {@link FACT} with one thing wrong. */
const BAD: readonly unknown[] = [
  null,
  'a group ride',
  { ...FACT, version: 0 },
  { ...FACT, version: 1.5 },
  { ...FACT, seed: -1 },
  { ...FACT, seed: 'seven' },
  // The review of PR #3364: a fact with no start offset cannot be lined up with its recording.
  Object.fromEntries(Object.entries(FACT).filter(([key]) => key !== 'startedAt')),
  { ...FACT, startedAt: Number.NaN },
  { ...FACT, startedAt: Number.POSITIVE_INFINITY },
  { ...FACT, startedAt: '2.5' },
  { ...FACT, targetSpeed: 0 },
  { ...FACT, targetSpeed: Number.NaN },
  { ...FACT, bots: 0 },
  { ...FACT, bots: 8 },
  { ...FACT, bots: 4.5 },
  { ...FACT, log: [] },
  { ...FACT, log: 'a log' },
  { ...FACT, log: [first, null] },
  { ...FACT, log: [first, { ...second, at: -1 }] },
  { ...FACT, log: [second, first] },
  { ...FACT, log: [first, { ...second, phase: 'sprinting' }] },
  { ...FACT, log: [first, { ...second, role: 'leader' }] },
  { ...FACT, log: [first, { ...second, groupSpeed: -1 }] },
  { ...FACT, log: [first, { ...second, groupSpeed: '8.3' }] },
  { ...FACT, log: Array.from({ length: GROUP_RIDE_LOG_MOST + 1 }, () => first) },
];

/** What is wrong with `bad`, short enough to read in a failure. */
const said = (bad: unknown): string => JSON.stringify(bad)?.slice(0, 200) ?? String(bad);

describe('the group ride kept with its ride — #3303', () => {
  it('is written by putActivity and read back on a fresh connection, by its rider only', async () => {
    const open = await opened();
    const ride = rideFor(ATHLETE_A, { rideFacts: { drafted: true, groupRide: FACT } });
    const read = await open.roundTrip(
      async (store) => store.putActivity(ride),
      async (store) => ({
        mine: await store.getActivity(ATHLETE_A, ride.id),
        theirs: await store.getActivity(ATHLETE_B, ride.id),
        listed: await store.listActivitySummaries(ATHLETE_A),
      }),
    );
    expect(read.mine?.rideFacts).toStrictEqual({ drafted: true, groupRide: FACT });
    expect(read.theirs).toBeUndefined();
    // The history's "Drafted" mark reads this, for a group ride as for any other.
    expect(read.listed.find((each) => each.id === ride.id)?.rideFacts?.drafted).toBe(true);
  });

  it('keeps where the group began on the recording, below nought too — the review of PR #3364', async () => {
    const open = await opened();
    // A recording begun 40 s into the group ride: its log begins before the recording does.
    const late: GroupRideFact = { ...FACT, startedAt: -40.25 };
    const ride = rideFor(ATHLETE_A, { rideFacts: { groupRide: late } });
    const read = await open.roundTrip(
      async (store) => store.putActivity(ride),
      async (store) => store.getActivity(ATHLETE_A, ride.id),
    );
    expect(read?.rideFacts?.groupRide?.startedAt).toBe(-40.25);
    expect(read?.rideFacts?.groupRide).toStrictEqual(late);
  });

  it('keeps a log that was cut short, and says so', async () => {
    const open = await opened();
    const cut: GroupRideFact = { ...FACT, logCut: true };
    const ride = rideFor(ATHLETE_A, { rideFacts: { groupRide: cut } });
    const read = await open.roundTrip(
      async (store) => store.putActivity(ride),
      async (store) => store.getActivity(ATHLETE_A, ride.id),
    );
    expect(read?.rideFacts?.groupRide).toStrictEqual(cut);
  });

  it('reads a ride saved before the field existed, with the field absent', async () => {
    const open = await opened();
    const ride = rideFor(ATHLETE_A, { rideFacts: { drafted: true, groupRide: FACT } });
    await open.write(async (store) => store.putActivity(ride));
    await open.discard();
    // The row as a build before #3303 wrote it: the same ride, with no such key.
    await behindTheStore(open.databaseName, async (raw) => {
      const table = raw.table<Record<string, unknown>, string>(TABLE.activities);
      const row = await table.get(ride.id);
      await table.put({ ...row, rideFacts: { drafted: true } });
    });
    const read = await open.read((store) => store.getActivity(ATHLETE_A, ride.id));
    expect(read?.id).toBe(ride.id);
    expect(read?.rideFacts).toStrictEqual({ drafted: true });
    expect(read?.rideFacts).not.toHaveProperty('groupRide');
  });

  it('leaves a fact that does not read out on the way IN, and keeps the ride', async () => {
    const open = await opened();
    for (const bad of BAD) {
      const ride = rideFor(ATHLETE_A, { rideFacts: { drafted: true, groupRide: bad as never } });
      await open.write(async (store) => store.putActivity(ride));
      const read = await open.read((store) => store.getActivity(ATHLETE_A, ride.id));
      expect(read?.id, said(bad)).toBe(ride.id);
      expect(read?.rideFacts, said(bad)).toStrictEqual({ drafted: true });
    }
  });

  it('drops a planted fact that does not read on the way OUT, never the ride', async () => {
    const open = await opened();
    for (const planted of BAD) {
      const ride = rideFor(ATHLETE_A, { rideFacts: { drafted: true, groupRide: FACT } });
      await open.write(async (store) => store.putActivity(ride));
      await open.discard();
      await behindTheStore(open.databaseName, async (raw) => {
        const table = raw.table<Record<string, unknown>, string>(TABLE.activities);
        const row = await table.get(ride.id);
        await table.put({ ...row, rideFacts: { drafted: true, groupRide: planted } });
      });
      const read = await open.read((store) => store.getActivity(ATHLETE_A, ride.id));
      expect(read?.id, said(planted)).toBe(ride.id);
      expect(read?.rideFacts, said(planted)).toStrictEqual({ drafted: true });
    }
  });

  it('keeps only the fact’s own fields', async () => {
    const open = await opened();
    const planted = {
      ...FACT,
      planted: 'x',
      log: FACT.log.map((entry) => ({ ...entry, planted: 'x' })),
    };
    const ride = rideFor(ATHLETE_A, { rideFacts: { groupRide: planted } });
    await open.write(async (store) => store.putActivity(ride));
    const read = await open.read((store) => store.getActivity(ATHLETE_A, ride.id));
    expect(read?.rideFacts?.groupRide).toStrictEqual(FACT);
  });
});
