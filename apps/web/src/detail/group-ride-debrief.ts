// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **What a group ride's page says happened** — #3310, epic #3296, ADR 0101
 * D-5.8: counts and durations only, read from the ride's saved
 * `rideFacts.groupRide` (#3303) and its own totals, and nothing else. No
 * model writes any of it, so a rider with no instance sees all of it.
 *
 * ## Read on the group's own clock
 *
 * A log entry lasts from its `at` until the next entry's, and the last until
 * {@link GroupRideFact.ridden}: every duration here is the group's own
 * seconds, never the recording's. The two clocks part after a HUD pause or a
 * long stall (PR #3364's delta review), and a ride ridden on alone past the
 * group's finish would otherwise give its last role all of that time. A fact
 * kept before #3310 has no `ridden`, and its last entry is read to the
 * recording's end instead: the best there is for it, and said here so a
 * reader does not mistake it for the rule. A log that was cut short
 * (`logCut`) kept only its first entries, and its last kept entry is counted
 * as nothing: what came after it is not known.
 *
 * ## What each line counts
 *
 * - **Pulls taken**: each time the rider's role became `on-front`.
 * - **Time on the front**: the seconds in that role; the average pull is that
 *   over the pulls.
 * - **Time in the draft**: the seconds on a wheel in the line — second wheel,
 *   in the line, last wheel, or sitting in. Not a rider gapped, latching or
 *   drifting back, who may have some draft and may not.
 * - **Time with the group**: the seconds in any of the line's own roles
 *   (`@onyourleft/domain` §`isLineRole`), the front included.
 * - **Gaps opened and closed**: each time the rider went from the line to
 *   gapped or off the back, and each time they came back to it.
 * - **The target average beside the average ridden** (ADR 0101 D-2.6, Q1):
 *   the average the rider chose, and the ride's distance over its moving
 *   time, as a lap's average is (`recording/laps.ts`). Time the group spent
 *   waiting is not made up, so the two may differ, and both are shown.
 *
 * Corrections are not here: the saved fact keeps none (#3303), and a count
 * this page cannot read is not made up either.
 */

import {
  isLineRole,
  metresPerSecond,
  type MetresPerSecond,
  type RiderRole,
} from '@onyourleft/domain';
import type { ActivityRecord, GroupRideFact } from '@onyourleft/store';

/** What the debrief shows, as numbers: the section words them. */
export interface GroupRideDebrief {
  /** Times the rider's role became `on-front`. */
  readonly pulls: number;
  /** Seconds on the front, in all. */
  readonly frontSeconds: number;
  /** {@link frontSeconds} over {@link pulls}, or `undefined` with no pull. */
  readonly averagePullSeconds: number | undefined;
  /** Seconds on a wheel in the line. */
  readonly draftSeconds: number;
  /** Seconds in any of the line's own roles. */
  readonly withGroupSeconds: number;
  /** Times the rider went from the line to gapped or off the back. */
  readonly gapsOpened: number;
  /** Times the rider came back to the line from a gap. */
  readonly gapsClosed: number;
  /** The average the rider chose for the ride. */
  readonly targetSpeed: MetresPerSecond;
  /** The ride's distance over its moving time, or `undefined` with neither. */
  readonly riddenSpeed: MetresPerSecond | undefined;
  /** Whether the ride changed more often than the log keeps (`GroupRideFact.logCut`). */
  readonly logCut: boolean;
}

/** The roles on a wheel in the line: "in the draft" here. */
function onAWheel(role: RiderRole): boolean {
  return (
    role === 'second-wheel' || role === 'in-line' || role === 'last-wheel' || role === 'sitting-in'
  );
}

/** A role that is a gap behind the line. */
function aGap(role: RiderRole): boolean {
  return role === 'gapped' || role === 'off-the-back';
}

/**
 * The debrief of one group ride, from its saved fact and its ride's totals.
 * Pure: the same fact and totals always give the same lines.
 */
export function groupRideDebrief(
  fact: GroupRideFact,
  ride: Pick<ActivityRecord, 'distance' | 'movingTime' | 'elapsedTime'>,
): GroupRideDebrief {
  const lastAt = fact.log.at(-1)?.at ?? 0;
  // The group's clock where the log ends; a fact from before #3310 has none.
  // A log that was cut kept its first entries only, so its last kept one
  // ends where the next, which was not kept, began: unknown, and counted as
  // nothing rather than as the rest of the ride.
  // A recording that ends before the last entry began gives it nothing.
  const end = fact.logCut === true ? lastAt : (fact.ridden ?? ride.elapsedTime - fact.startedAt);
  let pulls = 0;
  let frontSeconds = 0;
  let draftSeconds = 0;
  let withGroupSeconds = 0;
  let gapsOpened = 0;
  let gapsClosed = 0;
  fact.log.forEach((entry, index) => {
    const before = fact.log[index - 1];
    const span = Math.max(0, (fact.log[index + 1]?.at ?? end) - entry.at);
    if (entry.role === 'on-front' && before?.role !== 'on-front') pulls += 1;
    if (entry.role === 'on-front') frontSeconds += span;
    if (onAWheel(entry.role)) draftSeconds += span;
    if (isLineRole(entry.role)) withGroupSeconds += span;
    if (before !== undefined) {
      if (aGap(entry.role) && isLineRole(before.role)) gapsOpened += 1;
      if (isLineRole(entry.role) && aGap(before.role)) gapsClosed += 1;
    }
  });
  return {
    pulls,
    frontSeconds,
    averagePullSeconds: pulls === 0 ? undefined : frontSeconds / pulls,
    draftSeconds,
    withGroupSeconds,
    gapsOpened,
    gapsClosed,
    targetSpeed: metresPerSecond(fact.targetSpeed),
    riddenSpeed:
      ride.movingTime > 0 && ride.distance > 0
        ? metresPerSecond(ride.distance / ride.movingTime)
        : undefined,
    logCut: fact.logCut === true,
  };
}
