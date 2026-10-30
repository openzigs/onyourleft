// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What the activity library needs from the local store, and nothing more.
 *
 * The same shape as `transfer/store-port.ts` and for the same reason: the view
 * is rendered by the accessibility suite on a machine with no IndexedDB worth
 * the name, so it cannot open a database itself. `main.tsx` is the one caller
 * that reaches the real store.
 *
 * A port that exposed the whole store would let a later edit reach for
 * `getStreamSet` from a list row, which is the one thing #62's read budget
 * forbids — see {@link PAGE_SIZE}.
 *
 * ## Delete moves a ride to Recently deleted — #1431
 *
 * ⚠️ There is no `deleteActivity` here, on purpose. The store's is a delete
 * for good, and `ActivityStore` would satisfy a port method of that name
 * structurally — so a *Delete* press would destroy a ride the screen says can
 * be brought back. The rider's *Delete* is
 * {@link LibraryStore.moveActivityToRecentlyDeleted}; the only deletes for good
 * a rider can reach are from Recently deleted itself.
 */

import type { UnixSeconds } from '@onyourleft/domain';
import type {
  ActivityId,
  ActivitySummary,
  AthleteId,
  ListActivitiesOptions,
  RecentlyDeletedRide,
  RestoreOutcome,
} from '@onyourleft/store';

export interface LibraryStore {
  listActivitySummaries(
    owner: AthleteId,
    options?: ListActivitiesOptions,
  ): Promise<ActivitySummary[]>;
  /** A rider's *Delete*: the ride goes to Recently deleted for thirty days — #1431. */
  moveActivityToRecentlyDeleted(
    owner: AthleteId,
    id: ActivityId,
    deletedAt: UnixSeconds,
  ): Promise<boolean>;
  listRecentlyDeleted(owner: AthleteId, now: UnixSeconds): Promise<RecentlyDeletedRide[]>;
  restoreRecentlyDeleted(
    owner: AthleteId,
    id: ActivityId,
    now: UnixSeconds,
  ): Promise<RestoreOutcome>;
  deleteRecentlyDeletedForGood(owner: AthleteId, id: ActivityId): Promise<boolean>;
  emptyRecentlyDeleted(owner: AthleteId): Promise<number>;
  /** Removes for good what has been in Recently deleted thirty days — run when it is shown. */
  purgeRecentlyDeleted(owner: AthleteId, now: UnixSeconds): Promise<number>;
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
  /** The clock a delete is stamped with and Recently deleted is read at. Default: the device's. */
  readonly now?: (() => UnixSeconds) | undefined;
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
 *
 * Told when the ride goes to Recently deleted (#1431), not only when it goes
 * for good: a job about a ride the rider deleted is not followed, and a ride
 * brought back can be asked about again.
 */
export function forgettingOnDelete(
  store: LibraryStore,
  notes: readonly RideDeletionNote[],
): LibraryStore {
  return {
    listActivitySummaries: (owner, options) => store.listActivitySummaries(owner, options),
    getActivity: (owner, id) => store.getActivity(owner, id),
    moveActivityToRecentlyDeleted: async (owner, id, deletedAt) => {
      const deleted = await store.moveActivityToRecentlyDeleted(owner, id, deletedAt);
      for (const note of notes) note.forgetRide(id);
      return deleted;
    },
    listRecentlyDeleted: (owner, now) => store.listRecentlyDeleted(owner, now),
    restoreRecentlyDeleted: (owner, id, now) => store.restoreRecentlyDeleted(owner, id, now),
    deleteRecentlyDeletedForGood: (owner, id) => store.deleteRecentlyDeletedForGood(owner, id),
    emptyRecentlyDeleted: (owner) => store.emptyRecentlyDeleted(owner),
    purgeRecentlyDeleted: (owner, now) => store.purgeRecentlyDeleted(owner, now),
  };
}
