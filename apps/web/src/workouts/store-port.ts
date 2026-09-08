// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What the workouts screen needs from the local store, and nothing more.
 *
 * The same shape as `routes/store-port.ts`, for the same reason: the view is
 * rendered by the accessibility suite on a machine with no IndexedDB worth the
 * name, so it cannot open a database itself. `main.tsx` is the one caller that
 * reaches the real store.
 *
 * ⚠️ **Every method takes the owner**, and there is no `getWorkout(id)` to
 * reach for — `packages/store` declares no index that could answer one. See
 * CLAUDE.md §6 for the shape that closes.
 */

import type { AthleteId, WorkoutId, WorkoutRecord } from '@onyourleft/store';

export interface WorkoutStore {
  listWorkouts(owner: AthleteId, limit?: number): Promise<WorkoutRecord[]>;
  getWorkout(owner: AthleteId, id: WorkoutId): Promise<WorkoutRecord | undefined>;
  putWorkout(record: WorkoutRecord): Promise<WorkoutId>;
  deleteWorkout(owner: AthleteId, id: WorkoutId): Promise<boolean>;
}

export interface WorkoutPort {
  readonly athleteId: AthleteId;
  readonly store: WorkoutStore;
}

/**
 * How many saved workouts the list decodes: **100**.
 *
 * Twice `ROUTE_LIST_LIMIT`, deliberately, and the difference is what a row
 * costs. A route row carries a profile grid — four numbers per ten metres — so
 * fifty of them is tens of thousands of numbers. A workout row is a handful of
 * blocks, so a hundred of them is a few hundred objects, and a rider
 * accumulates workouts faster than routes because a workout is a plan rather
 * than a place.
 *
 * A bound at all, rather than none, for `ROUTE_LIST_LIMIT`'s reason: an
 * unbounded read on a growing library is a screen that gets slower every month
 * until somebody notices.
 */
export const WORKOUT_LIST_LIMIT = 100;
