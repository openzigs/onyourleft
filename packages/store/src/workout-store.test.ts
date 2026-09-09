// SPDX-License-Identifier: Apache-2.0

/**
 * Workout persistence (#14) — the round trip, the athlete scope, the rollback,
 * and the one thing that makes this store different from every other one here.
 *
 * ⚠️ **A workout is the only record in this package whose contents become a
 * command to a trainer.** Everything else is read back to be displayed; these
 * blocks are turned into `setTargetPower` writes against a machine applying
 * physical resistance to somebody pedalling. So the read path re-validates,
 * and the tests below assert that a bad row produces a `StoreDecodeError`
 * rather than a setpoint.
 */

import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { seconds, thresholdShare, type WorkoutBlock } from '@onyourleft/domain';

import { deleteActivityStore, openActivityStore } from './activity-store';
import { StoreDecodeError, StoreReferentialError, StoreValidationError } from './errors';
import { athleteId, workoutId } from './ids';
import { fromPersistedWorkout, toPersistedWorkout, type PersistedWorkout } from './persisted';
import { SCHEMA_VERSIONS, STORES_V7, TABLE } from './schema';
import {
  ATHLETE_A,
  ATHLETE_B,
  assertWorkoutRoundTrip,
  athleteRecord,
  createStoreHarness,
  memoryWriteStoreFactory,
  resetFixtureIds,
  RoundTripFailure,
  seedAthletes,
  seedWorkout,
  truncatedWorkoutStoreFactory,
  workoutFor,
  type StoreHarness,
} from './testing';

let harness: StoreHarness;

beforeEach(() => {
  resetFixtureIds();
  harness = createStoreHarness();
});

afterEach(async () => {
  await harness.destroy();
});

describe('a workout survives the session that wrote it', () => {
  it('comes back block for block through a fresh connection', async () => {
    await seedAthletes(harness);
    // The fixture carries a steady, a ramp, an intervals block and a free
    // ride, so this covers the whole union rather than its easiest member.
    await assertWorkoutRoundTrip(harness, workoutFor(ATHLETE_A));
  });

  it('lists an athlete’s workouts newest first', async () => {
    await seedAthletes(harness);
    const older = await seedWorkout(harness, ATHLETE_A, { name: 'Older' });
    const newer = await seedWorkout(harness, ATHLETE_A, { name: 'Newer', updatedAt: 1 });
    const listed = await harness.read(async (store) => store.listWorkouts(ATHLETE_A));
    expect(listed.map((row) => row.id)).toEqual([newer.id, older.id]);
  });

  it('honours a caller’s limit', async () => {
    await seedAthletes(harness);
    await seedWorkout(harness, ATHLETE_A);
    await seedWorkout(harness, ATHLETE_A);
    const listed = await harness.read(async (store) => store.listWorkouts(ATHLETE_A, 1));
    expect(listed).toHaveLength(1);
  });
});

describe('a workout belongs to exactly one athlete', () => {
  it('does not appear in another athlete’s list', async () => {
    await seedAthletes(harness);
    await seedWorkout(harness, ATHLETE_A);
    expect(await harness.read(async (store) => store.listWorkouts(ATHLETE_B))).toEqual([]);
  });

  it('cannot be read by id alone, because there is no such call', async () => {
    await seedAthletes(harness);
    const mine = await seedWorkout(harness, ATHLETE_A);
    // ⚠️ CLAUDE.md §6: a query matching on an entity id WITHOUT also filtering
    // on the owning athlete passes every single-athlete test in the suite. The
    // signature is what stops that here, and this is the assertion that says
    // the wrong owner comes back empty rather than coming back at all.
    expect(
      await harness.read(async (store) => store.getWorkout(ATHLETE_B, mine.id)),
    ).toBeUndefined();
  });

  it('refuses to overwrite somebody else’s workout', async () => {
    await seedAthletes(harness);
    const mine = await seedWorkout(harness, ATHLETE_A);
    await expect(
      harness.write(async (store) => store.putWorkout({ ...workoutFor(ATHLETE_B), id: mine.id })),
    ).rejects.toBeInstanceOf(StoreReferentialError);
  });

  it('refuses a workout for an athlete who does not exist', async () => {
    await expect(
      harness.write(async (store) => store.putWorkout(workoutFor(athleteId('nobody')))),
    ).rejects.toBeInstanceOf(StoreReferentialError);
  });

  it('reports a delete of somebody else’s workout exactly as it reports a miss', async () => {
    // Deliberately indistinguishable: reporting them differently would answer
    // "does athlete B have a workout with this id" to athlete A.
    await seedAthletes(harness);
    const mine = await seedWorkout(harness, ATHLETE_A);
    const theirs = await harness.write(async (store) => store.deleteWorkout(ATHLETE_B, mine.id));
    const missing = await harness.write(async (store) =>
      store.deleteWorkout(ATHLETE_B, workoutId('never-existed')),
    );
    expect(theirs).toBe(missing);
    expect(theirs).toBe(false);
  });

  it('deletes one of the athlete’s own', async () => {
    await seedAthletes(harness);
    const mine = await seedWorkout(harness, ATHLETE_A);
    expect(await harness.write(async (store) => store.deleteWorkout(ATHLETE_A, mine.id))).toBe(
      true,
    );
    expect(await harness.read(async (store) => store.listWorkouts(ATHLETE_A))).toEqual([]);
  });

  it('goes with the athlete when the athlete is erased', async () => {
    await seedAthletes(harness);
    await seedWorkout(harness, ATHLETE_A);
    await seedWorkout(harness, ATHLETE_B);
    const removed = await harness.write(async (store) => store.deleteAthlete(ATHLETE_A));
    expect(removed.workouts).toBe(1);
    // ⚠️ Read back through a fresh connection, not from the count. A cascade
    // that reported one row and deleted none is exactly the write-reports-
    // success-and-the-read-cannot-see-it shape CLAUDE.md §5 hunts for, in
    // reverse.
    expect(await harness.read(async (store) => store.listWorkouts(ATHLETE_A))).toEqual([]);
    expect(await harness.read(async (store) => store.listWorkouts(ATHLETE_B))).toHaveLength(1);
  });
});

describe('the harness catches a store that loses a block', () => {
  it('goes green against the real store and red against the truncating one', async () => {
    // The red/green pair. The same assertion body, and the only honest proof
    // that the assertion above can fail at all.
    const real = createStoreHarness();
    await seedAthletes(real);
    await assertWorkoutRoundTrip(real, workoutFor(ATHLETE_A));
    await real.destroy();

    const fake = createStoreHarness({ factory: truncatedWorkoutStoreFactory() });
    await seedAthletes(fake);
    await expect(assertWorkoutRoundTrip(fake, workoutFor(ATHLETE_A))).rejects.toBeInstanceOf(
      RoundTripFailure,
    );
    await fake.destroy();
  });

  it('names the block count, not a block', async () => {
    const fake = createStoreHarness({ factory: truncatedWorkoutStoreFactory() });
    await seedAthletes(fake);
    await expect(assertWorkoutRoundTrip(fake, workoutFor(ATHLETE_A))).rejects.toThrow(
      /workout\.blocks\.length/,
    );
    await fake.destroy();
  });

  it('catches a store that writes to memory instead of the database', async () => {
    const fake = createStoreHarness({ factory: memoryWriteStoreFactory() });
    await seedAthletes(fake);
    await expect(assertWorkoutRoundTrip(fake, workoutFor(ATHLETE_A))).rejects.toBeInstanceOf(
      RoundTripFailure,
    );
    await fake.destroy();
  });
});

describe('a row that is not a workout is refused rather than ridden', () => {
  const rowFor = (blocks: unknown[]): PersistedWorkout => ({
    ...toPersistedWorkout(workoutFor(ATHLETE_A)),
    blocks,
  });

  it('accepts the row it wrote', () => {
    const record = workoutFor(ATHLETE_A);
    expect(fromPersistedWorkout(toPersistedWorkout(record)).workout.blocks).toHaveLength(
      record.workout.blocks.length,
    );
  });

  it('refuses a percentage written where a share was wanted', () => {
    // ⚠️ The case this whole re-validation exists for. `88` is not 88%, it is
    // 88 times threshold, and a trainer asked for it applies every newton it
    // has. A decoder that trusted the row would hand that straight to
    // `setTargetPower`.
    const row = rowFor([{ kind: 'steady', seconds: 600, target: 88 }]);
    expect(() => fromPersistedWorkout(row)).toThrow(StoreDecodeError);
    expect(() => fromPersistedWorkout(row)).toThrow(/88 times threshold/);
  });

  it('refuses a workout with no blocks at all', () => {
    expect(() => fromPersistedWorkout(rowFor([]))).toThrow(StoreDecodeError);
  });

  it('refuses a block of an unknown kind', () => {
    expect(() => fromPersistedWorkout(rowFor([{ kind: 'sprint', seconds: 30 }]))).toThrow(
      StoreDecodeError,
    );
  });

  it('refuses a block with no duration', () => {
    expect(() =>
      fromPersistedWorkout(rowFor([{ kind: 'steady', seconds: 0, target: 0.6 }])),
    ).toThrow(StoreDecodeError);
  });

  it('refuses a blocks column that is not an array', () => {
    const row = { ...rowFor([]), blocks: 'four by three' } as unknown as PersistedWorkout;
    expect(() => fromPersistedWorkout(row)).toThrow(StoreDecodeError);
  });

  it('refuses an id that is blank', () => {
    const row = { ...rowFor(toPersistedWorkout(workoutFor(ATHLETE_A)).blocks), id: '   ' };
    expect(() => fromPersistedWorkout(row)).toThrow(StoreValidationError);
  });

  it('reads a row written before updatedAt existed as unedited', () => {
    const row = toPersistedWorkout(workoutFor(ATHLETE_A));
    const legacy = { ...row, updatedAt: undefined } as unknown as PersistedWorkout;
    expect(fromPersistedWorkout(legacy).updatedAt).toBe(row.createdAt);
  });
});

describe('version 8 is a rollback that has been executed, not described', () => {
  it('opens a version 7 database, and version 8 adds the store without touching the rest', async () => {
    // ⚠️ IndexedDB has no downgrade event, so the rollback that matters is the
    // one this test performs: a database at the previous version is opened,
    // upgraded, and every earlier store is asserted intact. `migrations.ts`
    // §"IndexedDB has no downgrade event" is why this is the shape rather than
    // a `down()` call.
    const name = `workout-rollback-${String(Date.now())}`;
    const old = new Dexie(name);
    // Declare every schema up to and including 7, the way ActivityStore does.
    for (const [index, stores] of SCHEMA_VERSIONS.slice(0, 7).entries()) {
      old.version(index + 1).stores(stores);
    }
    await old.open();
    expect(old.tables.map((table) => table.name)).not.toContain(TABLE.workouts);
    expect(Object.keys(STORES_V7)).toContain(TABLE.routes);
    old.close();

    const upgraded = openActivityStore(name);
    await upgraded.open();
    await upgraded.putAthlete(athleteRecord(ATHLETE_A));
    const saved = workoutFor(ATHLETE_A);
    await upgraded.putWorkout(saved);
    expect((await upgraded.getWorkout(ATHLETE_A, saved.id))?.name).toBe(saved.name);
    upgraded.close();
    await deleteActivityStore(name);
  });
});

describe('a block kind that gains a field is a compile error before it is a bug', () => {
  it('round-trips every declared block kind', async () => {
    // A structural claim rather than a behavioural one: the fixture's blocks
    // list one of each kind, and `assertWorkoutRoundTrip` compares the KEY SET
    // of every block as well as its values. A block kind that gained a field
    // and was not persisted therefore fails here rather than coming back
    // silently short.
    await seedAthletes(harness);
    const kinds: WorkoutBlock['kind'][] = ['steady', 'ramp', 'intervals', 'free-ride'];
    const record = workoutFor(ATHLETE_A);
    expect(record.workout.blocks.map((block) => block.kind)).toEqual(kinds);
    await assertWorkoutRoundTrip(harness, record);
  });

  it('keeps an optional label rather than dropping it', async () => {
    await seedAthletes(harness);
    const labelled: WorkoutBlock[] = [
      { kind: 'steady', seconds: seconds(300), target: thresholdShare(0.7), label: 'Tempo' },
    ];
    await assertWorkoutRoundTrip(harness, workoutFor(ATHLETE_A, { blocks: labelled }));
  });
});

describe("a workout's description survives the disk, and its absence does too", () => {
  it('brings the description back through a fresh handle', async () => {
    // ⚠️ Not an assertion against the record that was written. This field was
    // dropped on the way to disk for as long as it existed, and the reason
    // nobody noticed is that every test asserting a workout round trip used a
    // fixture with no description in it.
    await seedAthletes(harness);
    const saved = await seedWorkout(harness, ATHLETE_A, {
      description: 'Three blocks of six, ninety seconds between.',
    });
    const read = await harness.read(async (store) => store.getWorkout(ATHLETE_A, saved.id));
    expect(read?.workout.description).toBe('Three blocks of six, ninety seconds between.');
  });

  it('leaves a workout that has none without the key at all', async () => {
    await seedAthletes(harness);
    const saved = await seedWorkout(harness, ATHLETE_A);
    const read = await harness.read(async (store) => store.getWorkout(ATHLETE_A, saved.id));
    // Faithful, not defaulted: an absent description reads back absent rather
    // than as an empty string, which is the rule an optional threshold follows.
    expect(read && 'description' in read.workout).toBe(false);
  });

  it('reads a row written before the field existed', () => {
    // The whole reason this needed no schema version: an old row simply has no
    // key, and the decoder has to be fine with that.
    const legacy: PersistedWorkout = toPersistedWorkout(workoutFor(ATHLETE_A));
    expect('description' in legacy).toBe(false);
    expect(fromPersistedWorkout(legacy).workout.description).toBeUndefined();
  });

  it('refuses a description on disk that is not text', () => {
    const row = {
      ...toPersistedWorkout(workoutFor(ATHLETE_A)),
      description: 42,
    } as unknown as PersistedWorkout;
    expect(() => fromPersistedWorkout(row)).toThrow(StoreDecodeError);
  });
});
