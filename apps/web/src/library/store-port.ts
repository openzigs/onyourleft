// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What the activity library needs from the local store, and nothing more.
 *
 * The same shape as `transfer/store-port.ts` and for the same reason: the view
 * is rendered by the accessibility suite on a machine with no IndexedDB worth
 * the name, so it cannot open a database itself. `main.tsx` is the one caller
 * that reaches the real store.
 *
 * Two methods. A port that exposed the whole store would let a later edit reach
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
}

export interface LibraryPort {
  readonly athleteId: AthleteId;
  readonly store: LibraryStore;
}
