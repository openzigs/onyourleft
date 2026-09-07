// SPDX-License-Identifier: Apache-2.0

/**
 * Fitness and fatigue over a whole history: two exponentially weighted averages
 * of daily training load, and the gap between them.
 *
 * #77 says the hard parts are **not the maths** — they are the calendar. Days
 * with no ride, days with three, time zones, and what the series does before
 * the first ride ever recorded. Every one of those is a place where two
 * implementations of the "same" chart diverge, and where a chart looks
 * plausible while being wrong. So this file is mostly about dates.
 *
 * ## ⚠️ The names, again
 *
 * `CTL`, `ATL` and `TSB` are **reported registered trademarks** of Peaksware /
 * TrainingPeaks, passed to Garmin on 2026-07-22 — established while checking
 * #76's metrics, and recorded in CLAUDE.md §6. #77 does not flag this; #76 did
 * not flag it either, since it names *its* metrics rather than these.
 *
 * The same limitation applies as there: the primary registers are unreachable
 * from the agent environment, so that is a report rather than a record read
 * directly. It is enough to pick our own names, which are:
 *
 * | Here | What it is |
 * |---|---|
 * | {@link FitnessPoint.base} | the slow average — what the athlete is trained for |
 * | {@link FitnessPoint.recent} | the fast average — what they have just done |
 * | {@link FitnessPoint.freshness} | `base - recent`; positive means rested |
 *
 * Plain English, no initialisms. **Do not rename them to the ones you know.**
 * The recurrence below is ordinary exponential smoothing and is not anyone's
 * property.
 *
 * ## ⚠️ Reading a clock versus being given an instant
 *
 * This file names `Date` and `Intl`, which `packages/domain` permits: both are
 * ECMAScript built-ins, like the `DataView` a GATT decoder uses in
 * `packages/sensors`, and neither is a DOM, Node or network global. What the
 * package forbids is **reading the clock** — `Date.now()` — and nothing here
 * does. Every instant arrives as a parameter, which is the same rule the
 * recording engine is held to and for the same reason: a function that reads
 * the time is a function a test cannot pin.
 *
 * One honest caveat, since it cannot be tested away: {@link localDay} resolves a
 * time zone through the runtime's own ICU data, so two runtimes with different
 * ICU versions can disagree about a historical zone rule. That is inherent to
 * naming a zone rather than storing an offset, and storing an offset is worse —
 * `records.ts` explains why on `ActivityRecord.startedAtTimeZone`.
 */

import { seconds, type Seconds, type UnixSeconds } from '../quantities';

/** Seconds in a day, on the civil calendar this file counts in. */
const SECONDS_PER_DAY = 86_400;

/**
 * The slow average's time constant, in days.
 *
 * Six weeks. Long enough that a single hard week does not move it much, which
 * is the whole point of having a slow one.
 */
export const DEFAULT_BASE_DAYS = 42;

/**
 * The fast average's time constant, in days.
 *
 * One week, so it tracks what the athlete did rather than what they are trained
 * for. The *ratio* of the two is what makes {@link FitnessPoint.freshness}
 * informative; two averages with similar constants would track each other and
 * their difference would be noise.
 */
export const DEFAULT_RECENT_DAYS = 7;

/**
 * A local calendar day, as `YYYY-MM-DD`.
 *
 * A string rather than a `Date` deliberately: it is a **civil date**, not an
 * instant, and giving it an instant's type is how a chart comes to shift by a
 * day when the reader travels. Sorting it lexicographically sorts it
 * chronologically, which is the other half of why this shape is convenient.
 */
export type CalendarDay = string;

/**
 * The civil date an instant falls on, **in the zone it happened in**.
 *
 * #77's first criterion: an activity recorded at 23:30 in one zone and viewed
 * from another must land on the intended day. `ActivityRecord` stores the
 * absolute instant beside the IANA zone precisely so this is possible, and #26
 * records that conflating the two breaks both.
 *
 * ⚠️ Built from `formatToParts` rather than by picking a locale whose short
 * date format happens to look like ISO. `en-CA` is the usual trick and it is a
 * trick: a locale's format is a presentation choice that can change, and the
 * day this one does, every stored key silently changes shape. Reading the parts
 * by name asks for what is actually wanted.
 *
 * An unusable zone falls back to UTC rather than throwing, matching
 * `apps/web/src/format.ts`: a chart that refused to plot a ride because of its
 * time zone would be worse than one that plots it against the wrong day.
 */
export function localDay(instant: UnixSeconds, timeZone: string): CalendarDay {
  const at = new Date(instant * 1000);
  const parts = partsIn(at, timeZone) ?? partsIn(at, 'UTC');
  if (parts === undefined) {
    // Neither the ride's zone nor UTC resolved, which means the runtime has no
    // usable time-zone data at all. There is nothing honest left to return.
    throw new RangeError('this runtime cannot resolve a time zone, not even UTC');
  }
  return parts;
}

function partsIn(at: Date, timeZone: string): CalendarDay | undefined {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(at);
    const year = parts.find((part) => part.type === 'year')?.value;
    const month = parts.find((part) => part.type === 'month')?.value;
    const day = parts.find((part) => part.type === 'day')?.value;
    if (year === undefined || month === undefined || day === undefined) {
      return undefined;
    }
    return `${year}-${month}-${day}`;
  } catch {
    return undefined;
  }
}

/** One ride's contribution: when it happened, where, and how hard it was. */
export interface LoadEntry {
  readonly startedAt: UnixSeconds;
  /** The IANA zone the ride *started* in. @see localDay */
  readonly timeZone: string;
  readonly load: number;
}

/** A day's total load. */
export interface DailyLoad {
  readonly day: CalendarDay;
  readonly load: number;
}

/**
 * Total the loads onto local calendar days, ascending.
 *
 * #77's third criterion: **multiple activities on one day are summed**. Two
 * rides on a Saturday are one Saturday, and a series that kept them apart would
 * decay twice for a day that happened once.
 *
 * Only days that carry a ride appear here — the gaps are filled by
 * {@link fitnessSeries}, which is where filling them means something.
 */
export function dailyLoads(entries: readonly LoadEntry[]): readonly DailyLoad[] {
  const totals = new Map<CalendarDay, number>();
  for (const entry of entries) {
    const day = localDay(entry.startedAt, entry.timeZone);
    totals.set(day, (totals.get(day) ?? 0) + entry.load);
  }
  return [...totals.entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([day, load]) => ({ day, load }));
}

/** One day of the chart. */
export interface FitnessPoint {
  readonly day: CalendarDay;
  /** That day's total load. Zero on a rest day, which is a real value here. */
  readonly load: number;
  /** The slow average. @see DEFAULT_BASE_DAYS */
  readonly base: number;
  /** The fast average. @see DEFAULT_RECENT_DAYS */
  readonly recent: number;
  /** `base - recent`. Positive means rested; negative means recently loaded. */
  readonly freshness: number;
  /**
   * Whether this point is still inside the warm-up and does not yet mean
   * anything.
   *
   * ⚠️ #77's fourth criterion asks that the **seeding** be stated and tested,
   * because *"starting from zero makes the first eight weeks of every athlete's
   * chart meaningless"*. Both averages here **do** start from zero — and this
   * flag is the answer to that, rather than a seeding rule that invents a
   * history.
   *
   * The alternative would be to seed from the athlete's early average, which
   * makes the curve look right and is a claim about training nobody recorded.
   * A rider who imported a ten-year archive has real history; a rider who
   * started yesterday does not, and the chart should not pretend otherwise.
   * So: start at zero, and say for how long that is not yet meaningful.
   *
   * True for the first {@link FitnessOptions.baseDays} days of the series.
   */
  readonly warmingUp: boolean;
}

export interface FitnessOptions {
  readonly baseDays?: number;
  readonly recentDays?: number;
}

/**
 * The two averages over every day from the first ride to the last.
 *
 * ⚠️ **Every day, including the ones with no ride.** #77's second criterion
 * names this as *"the most common way this chart is wrong"*: a series that only
 * iterates over days that have rides does not decay at all, so a fortnight off
 * leaves the athlete's fitness exactly where they left it. The loop below walks
 * the calendar, not the rides.
 *
 * The recurrence is ordinary exponential smoothing, one step per day:
 *
 *     next = current + (today − current) × α,   α = 1 − exp(−1 / days)
 *
 * `α` from the exponential rather than the more common `2 / (n + 1)` because
 * the time constant is then literally *days*: after `days` days of a constant
 * load the average has closed `1 − 1/e` ≈ 63% of the gap, which is what "a
 * 42-day constant" is usually taken to mean.
 *
 * An empty history produces an empty series rather than a flat line at zero: a
 * rider with no rides has no chart, and drawing one would be a claim about
 * nothing.
 */
export function fitnessSeries(
  daily: readonly DailyLoad[],
  options: FitnessOptions = {},
): readonly FitnessPoint[] {
  const baseDays = options.baseDays ?? DEFAULT_BASE_DAYS;
  const recentDays = options.recentDays ?? DEFAULT_RECENT_DAYS;
  if (daily.length === 0 || !(baseDays > 0) || !(recentDays > 0)) {
    return [];
  }

  const byDay = new Map(daily.map((entry) => [entry.day, entry.load]));
  const days = [...byDay.keys()].sort();
  const first = days[0];
  const last = days.at(-1);
  if (first === undefined || last === undefined) {
    return [];
  }

  // ⚠️ **The loop is counted, not terminated by reaching the last day**, and
  // that is what makes a malformed key survivable. It used to walk forward
  // until `day === last`, which is an infinite loop for any key that does not
  // parse: `nextDay` returns something derived from `NaN`, never equals `last`,
  // and the tab hangs. Reachable from a hand-edited row or a caller that builds
  // a key itself — `DailyLoad` types `day` as a string — and a hang is the
  // worst failure available, being neither an error nor a result. Found by a
  // fixture that generated month 15.
  //
  // ⚠️ The `undefined` below is **documentation, not the defence**: a mutation
  // deleting it left the suite green, because a `NaN` span makes `elapsed <=
  // span` false on the first test and the loop runs zero times regardless. The
  // guard says what is meant; the counted loop is what holds.
  const span = dayCount(first, last);
  if (span === undefined) {
    return [];
  }

  const baseAlpha = 1 - Math.exp(-1 / baseDays);
  const recentAlpha = 1 - Math.exp(-1 / recentDays);

  const points: FitnessPoint[] = [];
  let base = 0;
  let recent = 0;
  let day = first;
  for (let elapsed = 0; elapsed <= span; elapsed += 1) {
    const load = byDay.get(day) ?? 0;
    base += (load - base) * baseAlpha;
    recent += (load - recent) * recentAlpha;
    points.push({
      day,
      load,
      base,
      recent,
      freshness: base - recent,
      warmingUp: elapsed < baseDays,
    });
    day = nextDay(day);
  }
  return points;
}

/**
 * Whole days from `first` to `last`, or `undefined` if either is not a date.
 *
 * The bound the walk above counts to. Returning `undefined` rather than
 * throwing keeps a malformed key from taking down a chart that has good data
 * either side of it: the caller draws nothing, and the screen says there is
 * nothing to draw — recoverable in a way a hang is not.
 *
 * `first` cannot exceed `last`: the caller sorts. So there is no
 * reversed-range branch here, because one would be unreachable and an
 * unreachable branch is a branch no test can hold.
 */
function dayCount(first: CalendarDay, last: CalendarDay): number | undefined {
  const from = Date.parse(`${first}T00:00:00Z`);
  const to = Date.parse(`${last}T00:00:00Z`);
  if (!Number.isFinite(from) || !Number.isFinite(to)) {
    return undefined;
  }
  return Math.round((to - from) / (SECONDS_PER_DAY * 1000));
}

/**
 * The civil day after this one.
 *
 * Done in UTC on purpose, and it is not a contradiction of {@link localDay}.
 * The *labelling* of a ride needs its own zone, because that is which day the
 * rider had. Stepping from one label to the next is arithmetic on the civil
 * calendar and has no zone at all — doing it in a zone with daylight saving
 * would produce a day that repeats or one that is skipped, in a series where
 * every entry must appear exactly once.
 */
function nextDay(day: CalendarDay): CalendarDay {
  const at = Date.parse(`${day}T00:00:00Z`);
  return localDay(unixDay(at / 1000 + SECONDS_PER_DAY), 'UTC');
}

/** A civil-day boundary as an instant. Not a measurement; a cursor. */
function unixDay(value: number): UnixSeconds {
  return value as UnixSeconds;
}

/** How long the series covers, for a caller that wants to state it. */
export function seriesSpan(points: readonly FitnessPoint[]): Seconds {
  return seconds(points.length === 0 ? 0 : (points.length - 1) * SECONDS_PER_DAY);
}
