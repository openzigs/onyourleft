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

import type {
  ActivityId,
  ActivitySummary,
  AthleteId,
  ListActivitiesOptions,
} from '@onyourleft/store';

import type { LibraryPort, LibraryStore } from './store-port';

export interface StubLibrary extends LibraryPort {
  /** Every `listActivitySummaries` call, so a test can assert the read budget. */
  readonly reads: ListActivitiesOptions[];
  readonly deleted: string[];
  /** Every id `getActivity` was asked for — #670's single read. */
  readonly gets: string[];
}

export function stubLibrary(owner: AthleteId, summaries: readonly ActivitySummary[]): StubLibrary {
  const held = [...summaries];
  const reads: ListActivitiesOptions[] = [];
  const deleted: string[] = [];
  const gets: string[] = [];

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
    deleteActivity: (_owner: AthleteId, id: ActivityId) => {
      deleted.push(id);
      const at = held.findIndex((summary) => summary.id === id);
      if (at < 0) {
        return Promise.resolve(false);
      }
      held.splice(at, 1);
      return Promise.resolve(true);
    },
  };

  return { athleteId: owner, store, reads, deleted, gets };
}
