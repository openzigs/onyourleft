// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Streaks and badges, from what a rider has actually ridden — #947, epic #935
 * D-6, and the owner's rulings on #947 of 2026-10-04.
 *
 * ## Pure, and derived — nothing here is stored
 *
 * {@link deriveProgress} is a function of the ride summaries Home already
 * reads (`home/home.ts`, ONE `listActivitySummaries` — two past the read
 * budget, {@link deriveProgressAcross}, #1107) and a clock. No badge,
 * no "earned at" and no streak is written anywhere: delete a ride and what it
 * earned goes with it, and nothing can go stale. What a badge needs that the
 * row did not already say — a ride's ascent, its best powers, whether a
 * workout was finished or a ghost raced — is the row's `rideFacts`
 * (`packages/store` §`RideFacts`), written by the ride that knew it.
 *
 * It is computed on the device with no network, and it is not synced (ADR
 * 0036 D-3): a badge is derived data, and the rides it is derived from are
 * what the device keeps.
 *
 * ## What counts as a ride
 *
 * A ride with at least {@link RIDE_MINIMUM_MOVING_SECONDS} of moving time.
 * Below that it is a recording that was started and not ridden — a test of a
 * sensor, a press on *Start* by mistake — and it earns nothing and keeps no
 * streak alive. The owner rules on the number; the pull request states it.
 *
 * ## The streak is WEEKS, and it is never shown as lost
 *
 * Consecutive calendar weeks, Monday to Sunday in the zone each ride started
 * in, with at least one ride each. Weeks, not days, because days punish rest
 * and illness (#947). A week not yet over cannot break a streak: until Sunday
 * ends, last week's streak is still the current one. When a week passes with
 * no ride the current streak is simply nought again and the next ride starts
 * a new one — the screen says so in those words and never says anything was
 * lost (the owner's ruling).
 *
 * ## The badges
 *
 * - **Distance**: {@link DISTANCE_MILESTONES_METRES}, summed over counted
 *   rides, earned on the ride that crossed each one.
 * - **Climbing**: {@link CLIMBING_MILESTONES_METRES}, summed over the counted
 *   rides that RECORDED elevation; a ride with none adds nothing, rather than
 *   nought (`recordedAscent`).
 * - **Firsts**: the first counted ride, the first with a workout finished, the
 *   first on a saved route, and the first against the rider's own ghost.
 * - **New personal bests** at {@link BEST_POWER_DURATIONS}: a ride whose best
 *   average power beats every earlier counted ride's at that duration —
 *   `packages/domain` §`bestMeanPower`, the Analysis screen's own bests. The
 *   first ride with power sets the mark and earns nothing: there was nothing
 *   to beat.
 *
 * ⚠️ **A best is never claimed over a ride nobody has read.** A counted ride
 * that had a power meter (`averagePower`) but carries no `rideFacts` — one
 * saved before #947 and not yet looked at — might hold a higher best, so no
 * later ride is called a new best at any duration until it has been looked at
 * ({@link Progress.unread}, and Home's *Look at older rides*).
 */

import {
  localDay,
  type Metres,
  type Seconds,
  type UnixSeconds,
  type Watts,
} from '@onyourleft/domain';
import type { ActivityId, ActivitySummary } from '@onyourleft/store';

/**
 * A recording counts as a ride from this much moving time — five minutes. A
 * proposal for the owner to confirm (#947's ruling asked the implementer to
 * propose it).
 */
export const RIDE_MINIMUM_MOVING_SECONDS = 300;

/** 100, 500, 1 000, 5 000 and 10 000 km — the owner's list. */
export const DISTANCE_MILESTONES_METRES: readonly number[] = [
  100_000, 500_000, 1_000_000, 5_000_000, 10_000_000,
];

/** 1 000, 5 000, 10 000 and 50 000 m — the owner's list. */
export const CLIMBING_MILESTONES_METRES: readonly number[] = [1_000, 5_000, 10_000, 50_000];

/** 5 s, 1 min, 5 min and 20 min — the owner's list. */
export const BEST_POWER_DURATIONS: readonly number[] = [5, 60, 300, 1_200];

export type FirstKind = 'ride' | 'workout' | 'route' | 'ghost';

interface Earned {
  /** When the ride that earned it started. */
  readonly earnedAt: UnixSeconds;
  readonly timeZone: string;
  readonly activityId: ActivityId;
}

export type Badge =
  | (Earned & { readonly kind: 'distance'; readonly metres: number })
  | (Earned & { readonly kind: 'climbing'; readonly metres: number })
  | (Earned & { readonly kind: 'first'; readonly first: FirstKind })
  | (Earned & { readonly kind: 'best'; readonly duration: number; readonly power: Watts });

export interface Streak {
  /** Weeks in the run still alive — this week's, or last week's until this one ends. */
  readonly current: number;
  /** The longest run there has ever been. */
  readonly longest: number;
}

export interface Progress {
  readonly streak: Streak;
  /** Every badge earned, newest first. */
  readonly badges: readonly Badge[];
  /** How many recordings counted as rides. */
  readonly rides: number;
  /**
   * Counted rides nobody has read for their facts yet — saved before #947.
   * Their climbing and best power are not counted until they are.
   */
  readonly unread: number;
}

/** Whether a recording counts as a ride. @see RIDE_MINIMUM_MOVING_SECONDS */
export function countsAsRide(summary: Pick<ActivitySummary, 'movingTime'>): boolean {
  return summary.movingTime >= RIDE_MINIMUM_MOVING_SECONDS;
}

/** Whole days since 1970-01-01 of a `YYYY-MM-DD`. */
function dayNumber(day: string): number {
  return Math.round(Date.parse(`${day}T00:00:00Z`) / 86_400_000);
}

/**
 * The calendar week an instant falls in, in `timeZone`: weeks run Monday to
 * Sunday, numbered from the one holding 1970-01-01 (a Thursday).
 */
export function weekOf(at: UnixSeconds, timeZone: string): number {
  return Math.floor((dayNumber(localDay(at, timeZone)) + 3) / 7);
}

function streakOf(weeks: ReadonlySet<number>, thisWeek: number): Streak {
  const sorted = [...weeks].sort((left, right) => left - right);
  let longest = 0;
  let run = 0;
  let previous: number | undefined;
  for (const week of sorted) {
    run = previous !== undefined && week === previous + 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
    previous = week;
  }
  // Alive while this week is ridden, or last week was and this one is not over.
  let current = 0;
  let week = weeks.has(thisWeek) ? thisWeek : thisWeek - 1;
  while (weeks.has(week)) {
    current += 1;
    week -= 1;
  }
  return { current, longest };
}

/**
 * Streaks and badges from a rider's ride summaries, as of `now`.
 *
 * The summaries need not be in order; they are put in start order here.
 */
export function deriveProgress(summaries: readonly ActivitySummary[], now: UnixSeconds): Progress {
  const rides = summaries
    .filter((summary) => countsAsRide(summary))
    .sort((left, right) => left.startedAt - right.startedAt || (left.id < right.id ? -1 : 1));

  const badges: Badge[] = [];
  const weeks = new Set<number>();
  let distance = 0;
  let climbed = 0;
  const firsts = new Set<FirstKind>();
  const bests = new Map<number, number>();
  let unreadPower = false;
  let unread = 0;

  for (const ride of rides) {
    const earned: Earned = {
      earnedAt: ride.startedAt,
      timeZone: ride.startedAtTimeZone,
      activityId: ride.id,
    };
    weeks.add(weekOf(ride.startedAt, ride.startedAtTimeZone));

    const before = distance;
    distance += ride.distance;
    for (const milestone of DISTANCE_MILESTONES_METRES) {
      if (before < milestone && distance >= milestone) {
        badges.push({ ...earned, kind: 'distance', metres: milestone });
      }
    }

    const facts = ride.rideFacts;
    if (facts === undefined) unread += 1;
    const ascent: Metres | undefined = facts?.ascent;
    if (ascent !== undefined) {
      const was = climbed;
      climbed += ascent;
      for (const milestone of CLIMBING_MILESTONES_METRES) {
        if (was < milestone && climbed >= milestone) {
          badges.push({ ...earned, kind: 'climbing', metres: milestone });
        }
      }
    }

    const first = (kind: FirstKind, applies: boolean): void => {
      if (applies && !firsts.has(kind)) {
        firsts.add(kind);
        badges.push({ ...earned, kind: 'first', first: kind });
      }
    };
    first('ride', true);
    first('workout', facts?.workoutFinished === true);
    first('route', ride.routeId !== undefined);
    first('ghost', facts?.ghostRaced === true);

    if (facts === undefined) {
      // A power meter nobody has read: no later best can be claimed over it.
      if (ride.averagePower !== undefined) unreadPower = true;
    } else {
      for (const duration of BEST_POWER_DURATIONS) {
        const power = facts.bestPower?.find((each) => each.duration === duration)?.power;
        if (power === undefined) continue;
        const best = bests.get(duration);
        if (best !== undefined && power > best && !unreadPower) {
          badges.push({ ...earned, kind: 'best', duration, power });
        }
        if (best === undefined || power > best) bests.set(duration, power);
      }
    }
  }

  const newest = rides.at(-1);
  const thisWeek = newest === undefined ? 0 : weekOf(now, newest.startedAtTimeZone);
  return {
    streak: newest === undefined ? { current: 0, longest: 0 } : streakOf(weeks, thisWeek),
    badges: badges.reverse(),
    rides: rides.length,
    unread,
  };
}

/**
 * Streaks and badges for a rider with more rides than one read holds — #1107.
 *
 * Home reads at most `HISTORY_ACTIVITY_LIMIT` summaries at a time, so past
 * that bound it has two windows: the `oldest` and the `newest`, with rides
 * between them it has not read.
 *
 * - **The current streak comes from the newest window.** It is about now.
 *   It is short only if one run of weeks is longer than the whole window,
 *   which at the bound is 5,000 counted rides.
 * - **The badges, and what holds a best back, come from the oldest window**,
 *   exactly as they did before #1107. Every badge is a claim about the whole
 *   history: worked out from the newest window alone, its first ride would be
 *   called the first and every total would start from nought. From the
 *   oldest window each one is true; badges earned in the rides between the
 *   windows are not shown, which is the bound biting rather than a false claim.
 * - **The longest streak is the longer of the two windows'.** A run that
 *   spans the gap is not seen, so it is never more than the truth.
 */
export function deriveProgressAcross(
  oldest: readonly ActivitySummary[],
  newest: readonly ActivitySummary[],
  now: UnixSeconds,
): Progress {
  const early = deriveProgress(oldest, now);
  const recent = deriveProgress(newest, now);
  const counted = new Set(
    [...oldest, ...newest].filter((summary) => countsAsRide(summary)).map((summary) => summary.id),
  );
  return {
    streak: {
      current: recent.streak.current,
      longest: Math.max(early.streak.longest, recent.streak.longest),
    },
    badges: early.badges,
    rides: counted.size,
    unread: early.unread,
  };
}

/** The duration a best is for, as a rider says it: "5 s", "1 min", "20 min". */
export function durationWords(duration: Seconds | number): string {
  return duration < 60 ? `${String(duration)} s` : `${String(duration / 60)} min`;
}
