// SPDX-License-Identifier: Apache-2.0

/**
 * **A ride is never lost, and never unreadable, for its re-plan audit trail**
 * — #1244's review, ADR 0048 D-6 P9.
 *
 * `RideFacts.replans` is a record of what was decided about a workout. A
 * record no build can read is dropped and counted; the ride is saved, and
 * read, all the same. `records.test.ts` holds that at the row; this file
 * holds it **through the real store, on a fresh connection**, which is the
 * path a ride takes: the ride controller's save is `putActivity`, the ride's
 * page and the export read `getActivity`, and the rides list reads
 * `listActivitySummaries`.
 *
 * ⚠️ The read half plants its bad record with a raw Dexie handle on the same
 * database, because the store's own write path will not write one: that is
 * the other half of the rule. It is a row as a later build, or a hand, could
 * have left it.
 */

import Dexie from 'dexie';
import { seconds } from '@onyourleft/domain';
import { afterEach, describe, expect, it } from 'vitest';

import type { PersistedActivity } from './persisted';
import type { NewActivity, RideFacts } from './records';
import { SCHEMA_VERSIONS, TABLE } from './schema';
import {
  ATHLETE_A,
  createStoreHarness,
  rideFor,
  seedAthletes,
  seedRide,
  type StoreHarness,
} from './testing';

const ACCEPTED = {
  decision: 'accepted',
  move: { kind: 'shorten-block', block: 2, minutes: 2 },
  reason: 'heart-rate-high',
  revision: 1,
  at: seconds(1_700_000_300),
} as const;
const KEPT = {
  decision: 'not-applied',
  why: 'kept',
  revision: 1,
  at: seconds(1_700_000_320),
} as const;

/** A record from a build that knew a move this one does not, with a string no screen may show. */
const FROM_A_LATER_BUILD = {
  decision: 'accepted',
  move: { kind: 'set-watts', watts: 400 },
  reason: 'SECRET-WORDS',
  revision: 2,
  at: 1_700_000_900,
};

const facts = (replans: readonly unknown[]): RideFacts => ({ replans }) as unknown as RideFacts;

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
  // Every version: Dexie drops a store a declared version does not mention.
  SCHEMA_VERSIONS.forEach((stores, index) => {
    raw.version(index + 1).stores(stores);
  });
  const table = raw.table<PersistedActivity, string>(TABLE.activities);
  const row = await table.get(id);
  if (row === undefined) throw new Error('no such ride to edit');
  await table.put({ ...row, rideFacts } as PersistedActivity);
  raw.close();
}

describe('a ride whose re-plan record does not read — through the real store', () => {
  it('is SAVED by putActivity with the record dropped and counted, and read back whole', async () => {
    const open = await opened();
    const ride: NewActivity = rideFor(ATHLETE_A, {
      rideFacts: facts([ACCEPTED, FROM_A_LATER_BUILD, KEPT]),
    });

    const read = await open.roundTrip(
      async (store) => store.putActivity(ride),
      async (store) => store.getActivity(ATHLETE_A, ride.id),
    );

    // The ride is there, with everything else it was saved with.
    expect(read).toMatchObject({ id: ride.id, athleteId: ATHLETE_A, startedAt: ride.startedAt });
    expect(read?.rideFacts).toEqual({ replans: [ACCEPTED, KEPT], replansDropped: 1 });
    expect(JSON.stringify(read)).not.toContain('SECRET-WORDS');
  });

  it('is saved by setActivityRideFacts the same way', async () => {
    const open = await opened();
    const ride = await seedRide(open, ATHLETE_A);

    const read = await open.roundTrip(
      async (store) =>
        store.setActivityRideFacts(ATHLETE_A, ride.id, facts(['nonsense', ACCEPTED])),
      async (store) => store.getActivity(ATHLETE_A, ride.id),
    );

    expect(read?.rideFacts).toEqual({ replans: [ACCEPTED], replansDropped: 1 });
  });

  it('is READ by getActivity and listed by listActivitySummaries, with the record skipped', async () => {
    const open = await opened();
    const ride = await seedRide(open, ATHLETE_A, { rideFacts: facts([ACCEPTED]) });
    await open.discard();
    await plant(open.databaseName, ride.id, { replans: [FROM_A_LATER_BUILD, ACCEPTED, 7] });

    const read = await open.read(async (store) => ({
      one: await store.getActivity(ATHLETE_A, ride.id),
      listed: await store.listActivitySummaries(ATHLETE_A),
    }));

    expect(read.one?.id).toBe(ride.id);
    expect(read.one?.rideFacts).toEqual({ replans: [ACCEPTED], replansDropped: 2 });
    expect(read.listed.map((each) => each.id)).toEqual([ride.id]);
    expect(JSON.stringify(read)).not.toContain('SECRET-WORDS');
  });

  it('reads a ride whose replans is not a list at all', async () => {
    const open = await opened();
    const ride = await seedRide(open, ATHLETE_A);
    await open.discard();
    await plant(open.databaseName, ride.id, { replans: 'none', workoutFinished: true });

    const read = await open.read(async (store) => store.getActivity(ATHLETE_A, ride.id));

    expect(read?.rideFacts).toEqual({ workoutFinished: true, replans: [], replansDropped: 1 });
  });
});
