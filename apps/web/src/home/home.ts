// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What the home screen reads, and the bound on it — #428.
 *
 * ## One store read, and not one sample decoded
 *
 * The app opens here, so this is the read EVERY launch pays for. It is one
 * `listActivitySummaries` — the same bounded read `analysis/history.ts` makes
 * for the fitness chart, with the same {@link HISTORY_ACTIVITY_LIMIT} — plus
 * the athlete row the thresholds come from, and then arithmetic. Every block
 * on the screen is derived from those rows:
 *
 * | block | from |
 * |---|---|
 * | the last ride | the newest summary |
 * | this week | the summaries started in the last seven days |
 * | fitness, fatigue, freshness | `fitnessSeries` over every summary's load, carried to today |
 *
 * ⚠️ **No stream is read, and `home.test.ts` counts that with the analysis
 * screens' own call-counting double.** A ride's load is stored half-computed
 * on its row (`analysis/summary.ts`), which is what makes this affordable; a
 * ride imported before #77 has no summary and contributes nothing here, and
 * the Analysis screen is where a rider pays to backfill it — never a render,
 * and never the launch.
 *
 * ⚠️ **The names.** The load metrics' familiar names are registered
 * trademarks (CLAUDE.md §6). The code says `rideLoad`, `base`, `recent` and
 * `freshness`; the screen says "load", "fitness", "fatigue" and "freshness",
 * which `analysis/trend.ts` already says on the Analysis screen.
 */

import {
  dailyLoads,
  fitnessSeries,
  type FitnessPoint,
  type LoadEntry,
  type Metres,
  type Seconds,
  type UnixSeconds,
} from '@onyourleft/domain';
import type { ActivitySummary } from '@onyourleft/store';

import { HISTORY_ACTIVITY_LIMIT } from '../analysis/history';
import type { AnalysisPort } from '../analysis/store-port';
import { loadFromSummary } from '../analysis/summary';
import { thresholdsFor } from '../analysis/thresholds';

/** How far back "this week" reaches: seven days to the second, not a calendar week. */
export const WEEK_SECONDS = 7 * 24 * 60 * 60;

export interface HomeLastRide {
  readonly name: string;
  readonly startedAt: UnixSeconds;
  readonly timeZone: string;
  readonly movingTime: Seconds;
  readonly distance: Metres;
  /** The ride's `rideLoad`, or `undefined` when it carries no load summary. */
  readonly load: number | undefined;
}

export interface HomeWeek {
  readonly rides: number;
  /** Summed moving time, in seconds. */
  readonly movingTime: number;
  /** Summed `rideLoad` over the rides that have one. */
  readonly load: number;
  /** How many of {@link rides} carried a load — so "load 0" is never a guess. */
  readonly ridesWithLoad: number;
}

export interface HomeData {
  /** `undefined` for a rider with no rides: the empty state. */
  readonly lastRide: HomeLastRide | undefined;
  readonly week: HomeWeek;
  /** The fitness series carried to today; empty when no ride has a load. */
  readonly fitness: readonly FitnessPoint[];
  /** True when {@link HISTORY_ACTIVITY_LIMIT} cut the history short. */
  readonly truncated: boolean;
}

/**
 * Everything the home screen shows, from one list read.
 *
 * @param now the instant "this week" and "today" are measured from. A
 * parameter, so a test can hold the clock.
 */
export async function loadHome(
  port: AnalysisPort,
  now: UnixSeconds,
  limit: number = HISTORY_ACTIVITY_LIMIT,
): Promise<HomeData> {
  const summaries: ActivitySummary[] = await port.store.listActivitySummaries(port.athleteId, {
    orderBy: 'startedAt',
    direction: 'ascending',
    limit: limit + 1,
  });
  const considered = summaries.slice(0, limit);
  const thresholds = thresholdsFor(await port.store.getAthlete(port.athleteId));

  const entries: LoadEntry[] = [];
  let week: HomeWeek = { rides: 0, movingTime: 0, load: 0, ridesWithLoad: 0 };
  let lastRide: HomeLastRide | undefined;
  for (const summary of considered) {
    const load = loadFromSummary(summary, thresholds)?.load;
    if (load !== undefined) {
      entries.push({ startedAt: summary.startedAt, timeZone: summary.startedAtTimeZone, load });
    }
    if (summary.startedAt > now - WEEK_SECONDS && summary.startedAt <= now) {
      week = {
        rides: week.rides + 1,
        movingTime: week.movingTime + summary.movingTime,
        load: week.load + (load ?? 0),
        ridesWithLoad: week.ridesWithLoad + (load === undefined ? 0 : 1),
      };
    }
    // Ascending, so the last one seen is the newest.
    lastRide = {
      name: summary.name,
      startedAt: summary.startedAt,
      timeZone: summary.startedAtTimeZone,
      movingTime: summary.movingTime,
      distance: summary.distance,
      load,
    };
  }

  // ⚠️ Carried to TODAY with a zero-load day, in the newest ride's zone: the
  // series walks the calendar from the first ride to the last, so without it
  // a rider who stopped a fortnight ago would be shown the freshness of the
  // day they stopped. A rest day is a real value here (`fitness.ts`).
  if (entries.length > 0) {
    entries.push({ startedAt: now, timeZone: lastRide?.timeZone ?? 'UTC', load: 0 });
  }

  return {
    lastRide,
    week,
    fitness: fitnessSeries(dailyLoads(entries)),
    truncated: summaries.length > limit,
  };
}
