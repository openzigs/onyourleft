// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A `LibraryPort` backed by an array, for tests and for the accessibility suite.
 *
 * Not a mock of the store: it is the narrowest thing that satisfies the port,
 * so a test using it exercises the view's own reading, sorting and deleting
 * rather than a rehearsal of them. The tests that need the *real* store use the
 * #28 harness instead — see `views/ActivitiesView.test.tsx`, which does both and
 * says why at each.
 */

import { unixSeconds } from '@onyourleft/domain';
import {
  RECENTLY_DELETED_SECONDS,
  type ActivityId,
  type ActivitySummary,
  type AthleteId,
  type ListActivitiesOptions,
  type RecentlyDeletedRide,
} from '@onyourleft/store';

import type { LibraryPort, LibraryStore } from './store-port';

export interface StubLibrary extends LibraryPort {
  /** Every `listActivitySummaries` call, so a test can assert the read budget. */
  readonly reads: ListActivitiesOptions[];
  /** Every id a *Delete* moved to Recently deleted, in order. */
  readonly deleted: string[];
  /** Every id `getActivity` was asked for — #670's single read. */
  readonly gets: string[];
  /** What is in Recently deleted now — #1431. */
  readonly bin: RecentlyDeletedRide[];
}

/**
 * A library store that holds nothing and answers every call — for a test that
 * needs one method to behave and the rest only to exist. Each override
 * replaces its method.
 */
export function emptyLibraryStore(overrides: Partial<LibraryStore> = {}): LibraryStore {
  return {
    listActivitySummaries: () => Promise.resolve([]),
    getActivity: () => Promise.resolve(undefined),
    moveActivityToRecentlyDeleted: () => Promise.resolve(false),
    listRecentlyDeleted: () => Promise.resolve([]),
    restoreRecentlyDeleted: () => Promise.resolve('missing'),
    deleteRecentlyDeletedForGood: () => Promise.resolve(false),
    emptyRecentlyDeleted: () => Promise.resolve(0),
    purgeRecentlyDeleted: () => Promise.resolve(0),
    ...overrides,
  };
}

export function stubLibrary(owner: AthleteId, summaries: readonly ActivitySummary[]): StubLibrary {
  const held = [...summaries];
  const reads: ListActivitiesOptions[] = [];
  const deleted: string[] = [];
  const gets: string[] = [];
  const bin: RecentlyDeletedRide[] = [];
  const binIndex = (requester: AthleteId, id: ActivityId): number =>
    bin.findIndex((ride) => ride.id === id && ride.athleteId === requester);

  const store: LibraryStore = {
    listActivitySummaries: (requester: AthleteId, options: ListActivitiesOptions = {}) => {
      reads.push(options);
      const { orderBy = 'startedAt', direction = 'descending', offset = 0, limit } = options;
      const key = (summary: ActivitySummary): number =>
        orderBy === 'distance' ? summary.distance : summary.startedAt;
      // Scoped, like `getActivity` below — #670's review: unscoped, the page
      // itself handed another athlete's ride to the screen.
      const sorted = held
        .filter((summary) => summary.athleteId === requester)
        .sort((left, right) =>
          direction === 'descending' ? key(right) - key(left) : key(left) - key(right),
        );
      const from = sorted.slice(offset);
      return Promise.resolve(limit === undefined ? from : from.slice(0, limit));
    },
    getActivity: (owner: AthleteId, id: ActivityId) => {
      gets.push(id);
      // Scoped, even in a stub: a stub that ignored the owner would make every
      // scoping assertion over it vacuous.
      return Promise.resolve(
        held.find((summary) => summary.id === id && summary.athleteId === owner),
      );
    },
    moveActivityToRecentlyDeleted: (requester, id, deletedAt) => {
      deleted.push(id);
      const at = held.findIndex((summary) => summary.id === id && summary.athleteId === requester);
      const summary = held[at];
      if (summary === undefined) {
        return Promise.resolve(false);
      }
      held.splice(at, 1);
      bin.unshift({
        id,
        athleteId: requester,
        deletedAt,
        removedAt: unixSeconds(deletedAt + RECENTLY_DELETED_SECONDS),
        summary,
      });
      return Promise.resolve(true);
    },
    listRecentlyDeleted: (requester, now) =>
      Promise.resolve(bin.filter((ride) => ride.athleteId === requester && ride.removedAt > now)),
    restoreRecentlyDeleted: (requester, id) => {
      const at = binIndex(requester, id);
      const ride = bin[at];
      if (ride === undefined) {
        return Promise.resolve('missing' as const);
      }
      bin.splice(at, 1);
      held.push(ride.summary);
      return Promise.resolve('restored' as const);
    },
    deleteRecentlyDeletedForGood: (requester, id) => {
      const at = binIndex(requester, id);
      if (at < 0) {
        return Promise.resolve(false);
      }
      bin.splice(at, 1);
      return Promise.resolve(true);
    },
    emptyRecentlyDeleted: (requester) => {
      const mine = bin.filter((ride) => ride.athleteId === requester);
      for (const ride of mine) bin.splice(bin.indexOf(ride), 1);
      return Promise.resolve(mine.length);
    },
    purgeRecentlyDeleted: (requester, now) => {
      const expired = bin.filter((ride) => ride.athleteId === requester && ride.removedAt <= now);
      for (const ride of expired) bin.splice(bin.indexOf(ride), 1);
      return Promise.resolve(expired.length);
    },
  };

  return { athleteId: owner, store, reads, deleted, gets, bin };
}
