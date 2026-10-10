// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What the workout goals screen may do to the rider's typed workout goals
 * (#1237, ADR 0048 D-10): read, save and clear them — `packages/store`
 * §`WorkoutGoalsRecord` — and nothing else of the store.
 *
 * A port of its own for the reason `athlete/masked-words-port.ts` gives: a
 * screen offered one narrow write is not thereby entitled to another.
 *
 * ⚠️ **The read is the store's, every time.** These goals bound a heart-rate
 * hold, so the screen shows what the store holds now — never a copy the shell
 * kept since start-up that a save on another screen, or a sync, could have
 * left behind.
 *
 * ⚠️ **It is a `*-port.ts`, so `check:wiring` watches it** (§4j): `WIRE003`
 * fails if a method here has no production caller.
 */

import type { UnixSeconds } from '@onyourleft/domain';
import type { ActivityStore, AthleteId } from '@onyourleft/store';

export type WorkoutGoalsStore = Pick<
  ActivityStore,
  'getWorkoutGoals' | 'putWorkoutGoals' | 'deleteWorkoutGoals'
>;

export interface WorkoutGoalsPort {
  readonly store: WorkoutGoalsStore;
  /** Whose goals these are. Every read and write is scoped by it. */
  readonly athleteId: AthleteId;
  /** The instant goals are saved at. */
  readonly now: () => UnixSeconds;
}
