// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The library's row model: what a stored summary looks like as a table row, and
 * in what order rows arrive.
 *
 * Pure, and separate from the view, so the ordering and formatting decisions
 * below are testable without rendering anything — and so the view has no
 * arithmetic in it to disagree with `format.ts`.
 */

import type { ActivityOrder, ActivitySummary, SortDirection } from '@onyourleft/store';

import { formatDistanceValue, formatDuration, formatPowerValue, formatStartedAt } from '../format';

/**
 * How many summaries one read asks for.
 *
 * This is the number #62's read budget is stated in: rendering a page issues
 * **one** `listActivitySummaries` call, never one per row, however many rides
 * are stored. `activities.test.tsx` seeds a thousand and asserts exactly that,
 * because "bounded" that nothing counts is a claim rather than a budget.
 *
 * Fifty rather than everything, because `ActivitySummary` is a row per ride and
 * an athlete with ten years of history has thousands. Fifty rather than ten,
 * because each page costs a round trip to IndexedDB and a rider scanning for
 * last Tuesday should not pay for six of them.
 */
export const PAGE_SIZE = 50;

/** One row of the library table, already formatted. */
export interface LibraryRow {
  readonly id: string;
  readonly name: string;
  /** In the ride's own time zone. @see formatStartedAt */
  readonly startedAt: string;
  readonly duration: string;
  /** Kilometres, one decimal, no unit — the unit is the column heading. */
  readonly distance: string;
  /**
   * Whole watts, or `undefined` when the ride carried no power at all.
   *
   * `undefined` is rendered as an em dash rather than a zero. A ride with no
   * power meter and a ride that averaged 0 W are different facts, and 0 is a
   * plausible-looking number for the first one.
   */
  readonly averagePower: string | undefined;
  /**
   * Whether the ride has any position samples.
   *
   * Carried so the row can say "indoor" in words. #62 requires an indoor ride
   * to render a complete row with no broken map thumbnail and no empty
   * location field — which this view achieves by having no map column at all,
   * so the flag is here to *state* the fact rather than to hide a gap. The map
   * arrives with #63, and this is the bit it will switch on.
   */
  readonly hasPosition: boolean;
}

export function rowFor(summary: ActivitySummary): LibraryRow {
  return {
    id: summary.id,
    name: summary.name,
    startedAt: formatStartedAt(summary.startedAt, summary.startedAtTimeZone),
    duration: formatDuration(summary.elapsedTime),
    distance: formatDistanceValue(summary.distance),
    averagePower:
      summary.averagePower === undefined ? undefined : formatPowerValue(summary.averagePower),
    hasPosition: summary.hasPosition,
  };
}

/**
 * The page the store returned, with ties broken so the order is deterministic.
 *
 * The store orders by an index — `startedAt` or `distance` — and two rides with
 * the same value are returned in whatever order the index yields, which is not
 * a documented property of Dexie and not one worth depending on. #62 asks for a
 * sort that is "stable and deterministic under ties", so the tie is broken here
 * on `id`, which is unique by construction.
 *
 * ⚠️ **Within the page, not across pages.** Two tied rides that straddle a page
 * boundary are ordered by the store's index and this cannot see them. That is a
 * real limit rather than a hidden one: it is invisible at any realistic page
 * size, and fixing it properly means a keyset cursor over `[value, id]`, which
 * is a change to `packages/store` that #62 does not need and should not smuggle
 * in.
 */
export function orderedRows(
  summaries: readonly ActivitySummary[],
  orderBy: ActivityOrder,
  direction: SortDirection,
): readonly LibraryRow[] {
  const keyOf = (summary: ActivitySummary): number =>
    orderBy === 'distance' ? summary.distance : summary.startedAt;
  const sign = direction === 'descending' ? -1 : 1;

  return [...summaries]
    .sort((left, right) => {
      const byKey = keyOf(left) - keyOf(right);
      if (byKey !== 0) {
        return sign * byKey;
      }
      // Ties ascend by id in **both** directions, deliberately. Mirroring the
      // sort would make the tie order flip when a rider toggles the arrow,
      // which reads as the rows shuffling for no reason; what the criterion
      // asks for is that the order be the same every time, not that it be
      // symmetrical.
      return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
    })
    .map(rowFor);
}
