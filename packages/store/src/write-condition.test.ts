// SPDX-License-Identifier: Apache-2.0

/**
 * A conditional write (#1263, `activity-store.ts` §`WriteCondition`): a
 * replacing write that lands only over the row its caller read. A sync reads
 * a row, waits on the network, and writes; the rider can change or delete the
 * row in that wait, and the write must not undo it.
 *
 * Every assertion reads back on a fresh connection: a write that throws and
 * a write that never reached the disk look the same from the handle that made
 * them, and only the read tells them apart.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { StoreConflictError } from './errors';
import {
  ATHLETE_A,
  createStoreHarness,
  resetFixtureIds,
  riderTextFor,
  seedAthletes,
  workoutFor,
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

describe('a rider text written only over what was read (#1263)', () => {
  const goal = () => riderTextFor(ATHLETE_A, 'goal');
  const readGoal = () => harness.read((store) => store.getRiderText(ATHLETE_A, 'goal', goal().key));

  it('writes when the row is still the one read', async () => {
    await harness.write((store) => store.putRiderText({ ...goal(), text: 'Read.' }));
    await harness.write((store) =>
      store.putRiderText(
        { ...goal(), text: 'Pulled.' },
        { onlyIf: (held) => held?.text === 'Read.' },
      ),
    );
    expect((await readGoal())?.text).toBe('Pulled.');
  });

  it('writes when the row is still absent', async () => {
    await harness.write((store) =>
      store.putRiderText({ ...goal(), text: 'Pulled.' }, { onlyIf: (held) => held === undefined }),
    );
    expect((await readGoal())?.text).toBe('Pulled.');
  });

  it('writes nothing, and throws, when the row changed since it was read', async () => {
    await harness.write((store) => store.putRiderText({ ...goal(), text: 'Edited here.' }));
    await expect(
      harness.write((store) =>
        store.putRiderText(
          { ...goal(), text: 'Pulled.' },
          { onlyIf: (held) => held?.text === 'Read.' },
        ),
      ),
    ).rejects.toBeInstanceOf(StoreConflictError);
    expect((await readGoal())?.text).toBe('Edited here.');
  });

  it('writes nothing over a row deleted since it was read', async () => {
    await expect(
      harness.write((store) =>
        store.putRiderText(
          { ...goal(), text: 'Pulled.' },
          { onlyIf: (held) => held?.text === 'Read.' },
        ),
      ),
    ).rejects.toBeInstanceOf(StoreConflictError);
    expect(await readGoal()).toBeUndefined();
  });
});

describe('a saved workout written only over what was read (#1263)', () => {
  it('writes when the row is still the one read, and not when it changed', async () => {
    const workout = workoutFor(ATHLETE_A, { name: 'Read' });
    await harness.write((store) => store.putWorkout(workout));
    const pulled = { ...workout, name: 'Pulled', workout: { ...workout.workout, name: 'Pulled' } };
    await harness.write((store) =>
      store.putWorkout(pulled, { onlyIf: (held) => held?.name === 'Read' }),
    );
    expect((await harness.read((store) => store.getWorkout(ATHLETE_A, workout.id)))?.name).toBe(
      'Pulled',
    );

    await expect(
      harness.write((store) =>
        store.putWorkout(
          { ...pulled, name: 'Again', workout: { ...pulled.workout, name: 'Again' } },
          { onlyIf: (held) => held?.name === 'Read' },
        ),
      ),
    ).rejects.toBeInstanceOf(StoreConflictError);
    expect((await harness.read((store) => store.getWorkout(ATHLETE_A, workout.id)))?.name).toBe(
      'Pulled',
    );
  });

  it('writes nothing over a workout deleted since it was read', async () => {
    const workout = workoutFor(ATHLETE_A, { name: 'Read' });
    await expect(
      harness.write((store) =>
        store.putWorkout(workout, { onlyIf: (held) => held?.name === 'Read' }),
      ),
    ).rejects.toBeInstanceOf(StoreConflictError);
    expect(await harness.read((store) => store.listWorkouts(ATHLETE_A))).toStrictEqual([]);
  });
});

describe('the typed workout goals written only over what was read (#1263)', () => {
  const read = workoutGoalsFor(ATHLETE_A, 0);
  const pulled = workoutGoalsFor(ATHLETE_A, 1);
  const goalsHere = () => harness.read((store) => store.getWorkoutGoals(ATHLETE_A));

  it('writes when the goals are still the ones read, or still absent', async () => {
    await harness.write((store) =>
      store.putWorkoutGoals(read, { onlyIf: (held) => held === undefined }),
    );
    expect(await goalsHere()).toStrictEqual({ status: 'kept', record: read });
    await harness.write((store) =>
      store.putWorkoutGoals(pulled, {
        onlyIf: (held) => held?.goals.durationMinutes === read.goals.durationMinutes,
      }),
    );
    expect(await goalsHere()).toStrictEqual({ status: 'kept', record: pulled });
  });

  it('writes nothing over goals changed, or cleared, since they were read', async () => {
    const edited = workoutGoalsFor(ATHLETE_A, 2);
    await harness.write((store) => store.putWorkoutGoals(edited));
    const asRead = {
      onlyIf: (held: typeof read | undefined) =>
        held?.goals.durationMinutes === read.goals.durationMinutes,
    };
    await expect(
      harness.write((store) => store.putWorkoutGoals(pulled, asRead)),
    ).rejects.toBeInstanceOf(StoreConflictError);
    expect(await goalsHere()).toStrictEqual({ status: 'kept', record: edited });

    await harness.write((store) => store.deleteWorkoutGoals(ATHLETE_A));
    await expect(
      harness.write((store) => store.putWorkoutGoals(pulled, asRead)),
    ).rejects.toBeInstanceOf(StoreConflictError);
    expect(await goalsHere()).toStrictEqual({ status: 'none' });
  });
});
