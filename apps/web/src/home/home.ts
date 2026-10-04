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
 * | this week | the summaries started today or on the six calendar days before it |
 * | fitness, fatigue, freshness | `fitnessSeries` over every summary's load, carried to today |
 * | streaks and badges (#947) | `deriveProgress` over every summary and its `rideFacts` |
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
  localDay,
  type CalendarDay,
  type FitnessPoint,
  type LoadEntry,
  type Metres,
  type RouteProfile,
  type Seconds,
  type UnixSeconds,
} from '@onyourleft/domain';
import type { ActivitySummary, RouteId } from '@onyourleft/store';

import { HISTORY_ACTIVITY_LIMIT } from '../analysis/history';
import type { AnalysisPort } from '../analysis/store-port';
import { loadFromSummary } from '../analysis/summary';
import { thresholdsFor } from '../analysis/thresholds';
import { deriveProgress, type Progress } from '../progress/progress';
import type { RoutePort } from '../routes/store-port';

/**
 * How far back "this week" reaches: today and the six CALENDAR days before
 * it, each ride on its own local day — #939's review.
 *
 * ⚠️ **One window for every figure in the panel, and it is this one.** Until
 * #939's second review the ride count, moving time and load counted the last
 * 7 × 24 h while the days ring counted these seven calendar days, so a ride
 * 157 h ago (inside 168 h, on the seventh calendar day back) read
 * "You rode on 0 of the last seven days." above "Rides 1". Deriving the days
 * from the 168 h rows instead would not do: a 168 h window touches EIGHT
 * calendar days whenever `now` is not midnight, so the sentence could read
 * "8 of the last seven days". The calendar window is what the heading and the
 * sentence already say, and it costs no read: the same rows, a different
 * test on each.
 */
export const WEEK_DAYS = 7;

/** Whole calendar days from `earlier` to `later`, both `YYYY-MM-DD`. */
function calendarDaysBetween(earlier: CalendarDay, later: CalendarDay): number {
  return Math.round(
    (Date.parse(`${later}T00:00:00Z`) - Date.parse(`${earlier}T00:00:00Z`)) / (24 * 60 * 60 * 1000),
  );
}

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
  /**
   * On how many of the last seven CALENDAR days — today and the six before it,
   * {@link WEEK_DAYS} — at least one ride started: #939's progress ring. A day is the ride's own
   * local day, in the zone it started in, the key the fitness series already
   * uses (`localDay`), and "today" is `now` in that same zone; so two rides at
   * 22:00 and 08:00 the next morning are two days, which 24-hour slices
   * counted back from `now` called one. Arithmetic over the rows already
   * read: no read of its own.
   *
   * Counted from exactly the rides {@link rides} counts, and by how many days
   * BACK each one is rather than by its date string: two rides in zones a day
   * apart can carry eight distinct dates inside one seven-day window, and the
   * offset cannot. So `rides > 0` implies `daysRidden >= 1`, and
   * `daysRidden <= min(rides, 7)`, by construction (`home.test.ts` §"one
   * window").
   */
  readonly daysRidden: number;
}

/** The seven calendar days before {@link HomeWeek}'s, counted the same way — #1010. */
export interface HomePreviousWeek {
  readonly rides: number;
  readonly movingTime: number;
  readonly load: number;
  readonly ridesWithLoad: number;
}

export interface HomeData {
  /** `undefined` for a rider with no rides: the empty state. */
  readonly lastRide: HomeLastRide | undefined;
  readonly week: HomeWeek;
  /**
   * The seven calendar days before {@link week}'s — days seven to thirteen
   * back, each ride on its own local day as {@link WEEK_DAYS} says — so the
   * "this week" card can set each figure against the week before (#1010).
   * The same rows, a different test on each: no read of its own.
   */
  readonly previousWeek: HomePreviousWeek;
  /**
   * The saved route the NEWEST ride ridden on one was ridden on, or
   * `undefined` when no ride in the read carries a route — #1010's "next up".
   * Read off the summaries' own `routeId`, so finding it costs nothing; the
   * route itself is {@link loadNextUp}'s one record read.
   */
  readonly lastRouteId: RouteId | undefined;
  /** The fitness series carried to today; empty when no ride has a load. */
  readonly fitness: readonly FitnessPoint[];
  /** True when {@link HISTORY_ACTIVITY_LIMIT} cut the history short. */
  readonly truncated: boolean;
  /**
   * Streaks and badges — #947, `progress/progress.ts` — derived from the same
   * rows, as of `now`. No read of its own.
   */
  readonly progress: Progress;
  /** The rows everything above was derived from, for *Look at older rides* (#947). */
  readonly summaries: readonly ActivitySummary[];
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
  let week: Omit<HomeWeek, 'daysRidden'> = { rides: 0, movingTime: 0, load: 0, ridesWithLoad: 0 };
  let previousWeek: HomePreviousWeek = { rides: 0, movingTime: 0, load: 0, ridesWithLoad: 0 };
  const daysBack = new Set<number>();
  let lastRide: HomeLastRide | undefined;
  let lastRouteId: RouteId | undefined;
  for (const summary of considered) {
    const load = loadFromSummary(summary, thresholds)?.load;
    if (load !== undefined) {
      entries.push({ startedAt: summary.startedAt, timeZone: summary.startedAtTimeZone, load });
    }
    if (summary.startedAt <= now) {
      // Days back from "today", both read in the zone the ride started in.
      const back = calendarDaysBetween(
        localDay(summary.startedAt, summary.startedAtTimeZone),
        localDay(now, summary.startedAtTimeZone),
      );
      if (back >= 0 && back < WEEK_DAYS) {
        week = {
          rides: week.rides + 1,
          movingTime: week.movingTime + summary.movingTime,
          load: week.load + (load ?? 0),
          ridesWithLoad: week.ridesWithLoad + (load === undefined ? 0 : 1),
        };
        daysBack.add(back);
      } else if (back >= WEEK_DAYS && back < 2 * WEEK_DAYS) {
        previousWeek = {
          rides: previousWeek.rides + 1,
          movingTime: previousWeek.movingTime + summary.movingTime,
          load: previousWeek.load + (load ?? 0),
          ridesWithLoad: previousWeek.ridesWithLoad + (load === undefined ? 0 : 1),
        };
      }
    }
    if (summary.routeId !== undefined) {
      lastRouteId = summary.routeId;
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
    week: { ...week, daysRidden: daysBack.size },
    previousWeek,
    lastRouteId,
    fitness: fitnessSeries(dailyLoads(entries)),
    truncated: summaries.length > limit,
    progress: deriveProgress(considered, now),
    summaries: considered,
  };
}

/**
 * The one ride Home offers first — #1010's "next up".
 *
 * | kind | when |
 * |---|---|
 * | `route` | a ride in the read was ridden on a saved route, and that route is still saved: the newest such |
 * | `free` | there are rides, and none of them is on a route this device still holds |
 * | `first` | there is no ride at all |
 *
 * ⚠️ **"The last workout used" is not offered, because the store cannot say
 * which one it was.** A ride is NAMED after the workout it followed
 * (`recording/finish.ts` §`rideName`), and a name is not a link: a rider can
 * rename a ride, and two workouts can share a name. Matching on it would offer
 * the wrong workout with confidence. Recording the link is a store change
 * of its own, not a read Home can make: #1016.
 *
 * ⚠️ **The read budget.** {@link loadHome}'s summaries already carry each
 * ride's `routeId`, so the route is found for nothing; drawing its shape needs
 * its profile, which is ONE `getRoute` by id — one record, made only when
 * there is a route to draw, and never a list. `HomeView.reads.test.tsx`
 * counts it. A route the rider deleted since resolves to nothing and falls
 * back to `free`, as a ghost lookup does (`records.ts` §`routeId`); so does a
 * read that fails, because a picture is not worth an error on the screen
 * every launch opens.
 */
export type HomeNextUp =
  | { readonly kind: 'first' }
  | { readonly kind: 'free' }
  | {
      readonly kind: 'route';
      readonly id: RouteId;
      readonly name: string;
      readonly profile: RouteProfile;
    };

export async function loadNextUp(
  data: Pick<HomeData, 'lastRide' | 'lastRouteId'>,
  routes: RoutePort | undefined,
): Promise<HomeNextUp> {
  if (data.lastRide === undefined) {
    return { kind: 'first' };
  }
  if (data.lastRouteId === undefined || routes === undefined) {
    return { kind: 'free' };
  }
  try {
    const route = await routes.store.getRoute(routes.athleteId, data.lastRouteId);
    return route === undefined
      ? { kind: 'free' }
      : { kind: 'route', id: route.id, name: route.name, profile: route.profile };
  } catch {
    return { kind: 'free' };
  }
}
