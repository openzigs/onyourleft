// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * An in-memory {@link WorkoutStore} for the workouts screen's tests.
 *
 * The same shape as `routes/testing.ts`: enough store to render the screen, and
 * one lever per failure the screen is supposed to handle.
 *
 * ⚠️ **This is not a substitute for the round-trip harness.** Persistence is
 * asserted in `packages/store/src/workout-store.test.ts` against a real
 * IndexedDB, where a write that reports success and cannot be read back goes
 * red — and where the re-validation on the way out is asserted, which this stub
 * deliberately does not perform. What this is for is the *screen's* decisions:
 * what it refuses, what it says, and what it writes.
 */

import type { AthleteId, WorkoutId, WorkoutRecord } from '@onyourleft/store';

import type { WorkoutPort, WorkoutStore } from './store-port';

export interface WorkoutStub extends WorkoutPort {
  readonly store: WorkoutStore;
  /** Every workout currently held, newest first, as the real store lists them. */
  rows(): readonly WorkoutRecord[];
  /** Make the next `listWorkouts` throw, for the offline case. */
  failNextList(): void;
  /** The limit the screen asked for on its last list, or `undefined`. */
  lastLimit(): number | undefined;
}

export function workoutStub(owner: AthleteId, seed: readonly WorkoutRecord[] = []): WorkoutStub {
  const rows = new Map<string, WorkoutRecord>(seed.map((record) => [record.id, record]));
  let failList = false;
  let lastLimit: number | undefined;

  const listed = (): WorkoutRecord[] =>
    [...rows.values()].sort((left, right) => right.createdAt - left.createdAt);

  const store: WorkoutStore = {
    listWorkouts: (requester, limit) => {
      lastLimit = limit;
      if (failList) {
        failList = false;
        return Promise.reject(new Error('the local store is unavailable'));
      }
      // ⚠️ Scoped, even in a stub. A stub that ignored the owner would make
      // every scoping assertion in the screen's tests vacuous — which is the
      // shape CLAUDE.md §6 names: a query on an entity id that passes every
      // single-athlete test in the suite.
      return Promise.resolve(listed().filter((record) => record.createdBy === requester));
    },
    getWorkout: (requester, id) => {
      const row = rows.get(id);
      return Promise.resolve(row?.createdBy === requester ? row : undefined);
    },
    putWorkout: (record) => {
      rows.set(record.id, record);
      return Promise.resolve(record.id);
    },
    deleteWorkout: (requester, id: WorkoutId) => {
      const row = rows.get(id);
      if (row === undefined || row.createdBy !== requester) {
        return Promise.resolve(false);
      }
      rows.delete(id);
      return Promise.resolve(true);
    },
  };

  return {
    athleteId: owner,
    store,
    rows: listed,
    failNextList: () => {
      failList = true;
    },
    lastLimit: () => lastLimit,
  };
}
