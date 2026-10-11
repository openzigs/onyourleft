// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What the activity library needs from the local store, and nothing more.
 *
 * The same shape as `transfer/store-port.ts` and for the same reason: the view
 * is rendered by the accessibility suite on a machine with no IndexedDB worth
 * the name, so it cannot open a database itself. `main.tsx` is the one caller
 * that reaches the real store.
 *
 * Three methods. A port that exposed the whole store would let a later edit reach
 * for `getStreamSet` from a list row, which is the one thing #62's read budget
 * forbids — see {@link PAGE_SIZE}.
 */

import type {
  ActivityId,
  ActivitySummary,
  AthleteId,
  ListActivitiesOptions,
} from '@onyourleft/store';

export interface LibraryStore {
  listActivitySummaries(
    owner: AthleteId,
    options?: ListActivitiesOptions,
  ): Promise<ActivitySummary[]>;
  deleteActivity(owner: AthleteId, id: ActivityId): Promise<boolean>;
  /**
   * One ride, by id, scoped to its owner — #670's selection, for a ride that
   * is not in the page {@link listActivitySummaries} returned: a shared or
   * reloaded `#/activities/selected/<id>` for ride fifty-one would otherwise
   * be called "not found".
   *
   * ⚠️ Typed as a summary, and the store's `getActivity` is what satisfies it
   * — which returns the whole record, **original file bytes included**. There
   * is no single-summary read in `packages/store`; this is read only when the
   * selection is outside the page, once per selection, never per row.
   */
  getActivity(owner: AthleteId, id: ActivityId): Promise<ActivitySummary | undefined>;
}

export interface LibraryPort {
  readonly athleteId: AthleteId;
  readonly store: LibraryStore;
}

/**
 * Something noted on this device about a ride, outside the store, that goes
 * when the ride is deleted — the pending-job note of an analysis asked of an
 * instance (#1102, `ride-analysis/instance-analysis.ts` §`pendingJobForgetter`).
 */
export interface RideDeletionNote {
  forgetRide(id: ActivityId): void;
}

/**
 * The library store, with each of `notes` told once a ride's delete has gone
 * through. Not when the delete throws: the ride may still be there, and a job
 * about it may still be followed. `main.tsx` is the one caller.
 */
export function forgettingOnDelete(
  store: LibraryStore,
  notes: readonly RideDeletionNote[],
): LibraryStore {
  return {
    listActivitySummaries: (owner, options) => store.listActivitySummaries(owner, options),
    getActivity: (owner, id) => store.getActivity(owner, id),
    deleteActivity: async (owner, id) => {
      const deleted = await store.deleteActivity(owner, id);
      for (const note of notes) note.forgetRide(id);
      return deleted;
    },
  };
}
