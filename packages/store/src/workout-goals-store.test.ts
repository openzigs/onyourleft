// SPDX-License-Identifier: Apache-2.0

/**
 * Typed workout goals (#1236, ADR 0048 D-10): the rider's own choices that
 * bound a heart-rate hold or a re-plan during the ride, kept one row per
 * athlete (`records.ts` §`WorkoutGoalsRecord`).
 */

import { unixSeconds } from '@onyourleft/domain';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { deleteActivityStore, openActivityStore } from './activity-store';
import { StoreReferentialError, StoreValidationError } from './errors';
import { athleteId } from './ids';
import type { NewActivity, WorkoutGoalsRecord } from './records';
import { SCHEMA_VERSION, SCHEMA_VERSIONS, TABLE } from './schema';
import {
  assertWorkoutGoalsRoundTrip,
  ATHLETE_A,
  ATHLETE_B,
  athleteRecord,
  createStoreHarness,
  memoryWriteStoreFactory,
  resetFixtureIds,
  rideFor,
  RoundTripFailure,
  seedAthletes,
  workoutGoalsFor,
} from './testing';
import type { StoreHarness } from './testing';

let harness: StoreHarness;

beforeEach(async () => {
  resetFixtureIds();
  harness = createStoreHarness();
  await seedAthletes(harness);
});

afterEach(async () => {
  await harness.destroy();
});

/** Writes a row straight to disk, past the store's own check — a hand edit. */
async function handEdit(row: unknown): Promise<void> {
  await harness.discard();
  const raw = new Dexie(harness.databaseName);
  SCHEMA_VERSIONS.forEach((stores, index) => {
    raw.version(index + 1).stores(stores);
  });
  await raw.table(TABLE.workoutGoals).put(row);
  raw.close();
}

describe('typed workout goals — #1236', () => {
  it('reads saved goals back whole on a fresh connection', async () => {
    const goals = workoutGoalsFor(ATHLETE_A);
    await expect(assertWorkoutGoalsRoundTrip(harness, goals)).resolves.toStrictEqual(goals);
  });

  it('goes red against a store that answers the write and keeps nothing', async () => {
    const broken = createStoreHarness({ factory: memoryWriteStoreFactory() });
    try {
      await seedAthletes(broken);
      await expect(
        assertWorkoutGoalsRoundTrip(broken, workoutGoalsFor(ATHLETE_A)),
      ).rejects.toBeInstanceOf(RoundTripFailure);
    } finally {
      await broken.destroy();
    }
  });

  it('reads none for a rider who saved none', async () => {
    await expect(harness.read((store) => store.getWorkoutGoals(ATHLETE_A))).resolves.toStrictEqual({
      status: 'none',
    });
  });

  it('replaces the goals whole: a field cleared is gone, not kept from before', async () => {
    const first = workoutGoalsFor(ATHLETE_A);
    await harness.write((store) => store.putWorkoutGoals(first));
    const second: WorkoutGoalsRecord = {
      athleteId: ATHLETE_A,
      goals: { sessionType: 'recovery' },
      savedAt: unixSeconds(first.savedAt + 60),
    };
    await harness.write((store) => store.putWorkoutGoals(second));
    await expect(harness.read((store) => store.getWorkoutGoals(ATHLETE_A))).resolves.toStrictEqual({
      status: 'kept',
      record: second,
    });
  });

  it('writes only the fields it knows, whatever the caller spread in', async () => {
    const goals = workoutGoalsFor(ATHLETE_A);
    const written = await harness.write((store) =>
      store.putWorkoutGoals({ ...goals, extra: 'carried' } as WorkoutGoalsRecord),
    );
    expect(written).toStrictEqual(goals);
    await expect(harness.read((store) => store.getWorkoutGoals(ATHLETE_A))).resolves.toStrictEqual({
      status: 'kept',
      record: goals,
    });
  });

  it.each([
    ['an unknown key', { target: 220 }, 'workoutGoals:'],
    ['a range under 6 bpm wide', { holdRange: { low: 130, high: 134 } }, 'workoutGoals.holdRange:'],
    [
      'a range whose low is not below its high',
      { holdRange: { low: 140, high: 130 } },
      'workoutGoals.holdRange:',
    ],
    ['a ceiling over the ruled maximum', { powerCeiling: 0.9 }, 'workoutGoals.powerCeiling:'],
    ['a non-integer duration', { durationMinutes: 61.5 }, 'workoutGoals.durationMinutes:'],
    ['an out-of-range duration', { durationMinutes: 5 }, 'workoutGoals.durationMinutes:'],
  ])('refuses %s, naming the field and the constraint', async (_name, goals, field) => {
    const attempt = harness.write((store) =>
      store.putWorkoutGoals({
        athleteId: ATHLETE_A,
        goals: goals as WorkoutGoalsRecord['goals'],
        savedAt: unixSeconds(1),
      }),
    );
    await expect(attempt).rejects.toBeInstanceOf(StoreValidationError);
    await expect(attempt).rejects.toThrow(field);
    await expect(harness.read((store) => store.getWorkoutGoals(ATHLETE_A))).resolves.toStrictEqual({
      status: 'none',
    });
  });

  it('refuses a save time that is not whole Unix seconds, and an empty athlete id', async () => {
    const goals = workoutGoalsFor(ATHLETE_A);
    await expect(
      harness.write((store) => store.putWorkoutGoals({ ...goals, savedAt: unixSeconds(1.5) })),
    ).rejects.toThrow('workoutGoals.savedAt');
    await expect(
      harness.write((store) =>
        store.putWorkoutGoals({ ...goals, athleteId: '' } as unknown as WorkoutGoalsRecord),
      ),
    ).rejects.toThrow('workoutGoals.athleteId');
  });

  it('refuses goals for an athlete who does not exist', async () => {
    await expect(
      harness.write((store) => store.putWorkoutGoals(workoutGoalsFor(athleteId('nobody-here')))),
    ).rejects.toBeInstanceOf(StoreReferentialError);
  });

  it.each([
    ['an unknown key', { holdRange: { low: 130, high: 140 }, target: 250 }, 'workoutGoals:'],
    ['a range too narrow', { holdRange: { low: 130, high: 132 } }, 'workoutGoals.holdRange:'],
    [
      'a ceiling over the maximum',
      { sessionType: 'tempo', powerCeiling: 1.2 },
      'workoutGoals.powerCeiling:',
    ],
    ['goals that are not an object', 'go hard', 'workoutGoals:'],
  ])(
    'reads a row hand-edited to %s as no goals with a fault, never part of one',
    async (_name, goals, fault) => {
      await handEdit({ athleteId: ATHLETE_B, goals, savedAt: 1 });
      const read = await harness.read((store) => store.getWorkoutGoals(ATHLETE_B));
      expect(read.status).toBe('fault');
      expect(read).not.toHaveProperty('record');
      expect(read.status === 'fault' ? read.fault : '').toContain(fault);
    },
  );

  it('clears the goals, and says whether there were any', async () => {
    await harness.write((store) => store.putWorkoutGoals(workoutGoalsFor(ATHLETE_A)));
    await expect(harness.write((store) => store.deleteWorkoutGoals(ATHLETE_A))).resolves.toBe(true);
    await expect(harness.write((store) => store.deleteWorkoutGoals(ATHLETE_A))).resolves.toBe(
      false,
    );
    await expect(harness.read((store) => store.getWorkoutGoals(ATHLETE_A))).resolves.toStrictEqual({
      status: 'none',
    });
  });

  it('goes with the athlete, and only theirs', async () => {
    await harness.write((store) => store.putWorkoutGoals(workoutGoalsFor(ATHLETE_A)));
    await harness.write((store) => store.putWorkoutGoals(workoutGoalsFor(ATHLETE_B)));
    const counts = await harness.write((store) => store.deleteAthlete(ATHLETE_A));
    expect(counts.workoutGoals).toBe(1);
    await expect(harness.read((store) => store.getWorkoutGoals(ATHLETE_B))).resolves.toStrictEqual({
      status: 'kept',
      record: workoutGoalsFor(ATHLETE_B),
    });
  });
});

describe('version 18 rolls back — export → downgrade → re-import', () => {
  /**
   * Version 18 adds a store and rewrites no record, so `SCHEMA_MIGRATIONS`
   * holds no pair for it: a `down` over records `up` never changed would be
   * the identity, and a test of it would pass whatever `down` did
   * (`migrations.ts` §"The registry"; `identity-rollback.test.ts` makes the
   * same call for version 4). What a rollback means on this engine is the
   * runtime path ADR 0005 F names, so that is what is executed here, against
   * a database with rides in it.
   */
  let databaseName: string;

  beforeEach(() => {
    databaseName = `oyl-goals-rollback-${String(Date.now())}-${String(Math.random()).slice(2)}`;
  });

  afterEach(async () => {
    await deleteActivityStore(databaseName);
  });

  it('brings the rides and the goals back on a database the version-17 build made', async () => {
    expect(SCHEMA_VERSION).toBe(18);
    const owner = ATHLETE_A;
    const current = openActivityStore(databaseName);
    await current.putAthlete(athleteRecord(owner));
    const rides = [rideFor(owner), rideFor(owner)];
    for (const ride of rides) {
      await current.putActivity(ride);
    }
    const goals = workoutGoalsFor(owner);
    await current.putWorkoutGoals(goals);
    const read = await current.getWorkoutGoals(owner);
    const file = JSON.stringify({
      athlete: await current.getAthlete(owner),
      activities: await Promise.all(
        rides.map(async (ride) => (await current.getActivity(owner, ride.id)) as NewActivity),
      ),
      goals: read.status === 'kept' ? read.record : undefined,
    });
    current.close();

    // Downgrade: the version-17 build's database, with the rides re-imported
    // and nowhere to put goals.
    await deleteActivityStore(databaseName);
    const older = new Dexie(databaseName);
    SCHEMA_VERSIONS.slice(0, 17).forEach((stores, index) => {
      older.version(index + 1).stores(stores);
    });
    await older.open();
    expect(older.verno).toBe(17);
    expect(older.tables.map((table) => table.name)).not.toContain(TABLE.workoutGoals);
    const exported = JSON.parse(file) as {
      athlete: unknown;
      activities: unknown[];
      goals: unknown;
    };
    await older.table(TABLE.athletes).put(exported.athlete);
    for (const activity of exported.activities) {
      await older.table(TABLE.activities).put(activity);
    }
    older.close();

    // Upgrade again, and re-import the goals through the public write.
    const back = openActivityStore(databaseName);
    await expect(back.getWorkoutGoals(owner)).resolves.toStrictEqual({ status: 'none' });
    await back.putWorkoutGoals(exported.goals as WorkoutGoalsRecord);
    back.close();

    const reopened = openActivityStore(databaseName);
    const summaries = await reopened.listActivitySummaries(owner);
    const goalsBack = await reopened.getWorkoutGoals(owner);
    reopened.close();

    expect(summaries.map((ride) => ride.id).sort()).toStrictEqual(
      rides.map((ride) => ride.id).sort(),
    );
    expect(goalsBack).toStrictEqual({ status: 'kept', record: goals });
  });
});
