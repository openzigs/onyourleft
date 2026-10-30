// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What the ride controller needs from outside itself for re-plans during
 * the ride — #1244, ADR 0048 D-7 and D-10.
 *
 * A port, so `ride/controller.ts` names neither `localStorage`, a store, nor
 * the instance: `main.tsx` builds the one production port, and a test hands
 * in a double. `check:wiring` watches every method here (`WIRE003`), so a
 * controller that stops asking for the goals, the library or the session is a
 * red run.
 *
 * ⚠️ **Absent, there are no re-plans**, and nothing else changes: a rider
 * with no instance rides the workout they loaded, with the heart-rate hold
 * running (ADR 0036 D-3 (a)).
 */

import type { SavedWorkout, WorkoutGoals } from '@onyourleft/domain';
import type { AthleteId, WorkoutGoalsRead, WorkoutRecord } from '@onyourleft/store';

import type { JobSession } from '../ride-analysis/instance-job';
import { WORKOUT_LIST_LIMIT } from '../workouts/store-port';

export interface ReplanPort {
  /**
   * Whether this device is signed in to an instance now, read every time it
   * is asked. `false`, the per-ride switch is not offered and a workout
   * started with it on asks for nothing.
   */
  replanConnected(): boolean;
  /**
   * The sealed session a re-plan job runs under now, or the reason there is
   * none. Asked for each job, so a disconnect is seen at the next one.
   */
  replanSession(): Promise<JobSession>;
  /**
   * The rider's typed goals as this device holds them (ADR 0048 D-10: the
   * device's copy is canonical). `{}` for a rider who saved none.
   * `'unreadable'` for a row that is not goals: nothing may be bounded by
   * half a goal, so that workout has no re-plans.
   */
  replanGoals(): Promise<WorkoutGoals | 'unreadable'>;
  /** The rider's own saved workouts, by their sync key: the only source of a swap. */
  replanLibrary(): Promise<readonly SavedWorkout[]>;
}

/** What {@link createReplanPort} is built over: this device's store, and its sign-in. */
export interface ReplanPortDependencies {
  readonly store: {
    getWorkoutGoals(owner: AthleteId): Promise<WorkoutGoalsRead>;
    listWorkouts(owner: AthleteId, limit?: number): Promise<WorkoutRecord[]>;
  };
  readonly athleteId: AthleteId;
  /** Whether this device holds a sign-in to an instance now. */
  readonly connected: () => boolean;
  /** The sealed session it holds, as a job runs under it. */
  readonly session: () => Promise<JobSession>;
}

/**
 * The production {@link ReplanPort}: the rider's goals and saved workouts
 * from THIS device's store, every read naming the athlete, and the sealed
 * session the Connect screen keeps.
 *
 * A saved workout's id here is its own record id, which is the key it is
 * synced under (`instance/sync.ts`, rule 9) and so the id the instance's
 * `saved_workouts` tool shows a model. The library is the first
 * {@link WORKOUT_LIST_LIMIT} workouts, as the Ride screen lists them: a swap
 * naming one past that is refused under P1, as any workout the device does
 * not hold is.
 */
export function createReplanPort(dependencies: ReplanPortDependencies): ReplanPort {
  const { store, athleteId } = dependencies;
  return {
    replanConnected: () => dependencies.connected(),
    replanSession: () => dependencies.session(),
    replanGoals: async () => {
      const read = await store.getWorkoutGoals(athleteId);
      switch (read.status) {
        case 'none':
          return {};
        case 'kept':
          return read.record.goals;
        case 'fault':
          return 'unreadable';
      }
    },
    replanLibrary: async () =>
      (await store.listWorkouts(athleteId, WORKOUT_LIST_LIMIT)).map((record) => ({
        id: record.id,
        workout: record.workout,
      })),
  };
}
