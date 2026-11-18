// SPDX-License-Identifier: Apache-2.0

/**
 * **The course ahead, in a few numbers a model can read** — #2794.
 *
 * The AI bots (`lap-race/model-tactics.ts`) and the AI pacer
 * (`pacer/model-pacer.ts`) were each shown the grade a few metres up the
 * road and nothing beyond it, so neither could plan for a climb coming, a
 * descent, or how the finish lies. This module reads the route profile the
 * app already has and gives both of them the same short summary:
 *
 * - **the next climb and the next descent** ({@link courseHillsAhead}): the
 *   metres to its start, its length, its average grade and its steepest;
 * - **the climbing in a stretch** ({@link courseClimbing}): what is left of a
 *   lap or a ride;
 * - **the average grade of a stretch** ({@link courseAverageGrade}): the last
 *   500 m to a lap race's line.
 *
 * ## The thresholds, stated
 *
 * A **climb** is road at {@link COURSE_HILL_GRADE_PERCENT} or steeper for at
 * least {@link COURSE_HILL_LEAST_METRES} without a break, and a **descent**
 * the same downhill. Only the road ahead counts: a bot 150 m from the top of
 * a long climb has no significant climb ahead, and is told the next one. The
 * search reaches {@link COURSE_AHEAD_MOST_METRES} up the road at most, and
 * never past the end of a route that is not a loop; nothing found is `null`.
 *
 * ## Small, on purpose
 *
 * Every number is rounded for the model (#2767's late answers, #2776): metres
 * to the nearest {@link COURSE_ROUNDING_METRES} and grades to a whole
 * percent, because each digit is a token it reads and none moves a decision.
 * **No coordinate and no name** is read or returned: the route enters as
 * grades and heights along its length, and leaves as distances and grades.
 */

import {
  distanceOnRoute,
  elevationAt,
  gradeAt,
  recordedAscent,
  type RouteProfile,
} from './profile';

/** The grade a climb, or a descent downhill, is at least: **3 %**, a club rider's "it goes up here". */
export const COURSE_HILL_GRADE_PERCENT = 3;

/** How long a climb or a descent is at least, metres: **200**. Shorter is a ramp, not a hill. */
export const COURSE_HILL_LEAST_METRES = 200;

/**
 * How far up the road the next climb or descent is looked for, metres:
 * **5 000**. A hill further than that is minutes away, past anything a
 * decision every few seconds would ride differently for.
 */
export const COURSE_AHEAD_MOST_METRES = 5_000;

/** What every distance here is rounded to, metres: **10**, a profile's own spacing. */
export const COURSE_ROUNDING_METRES = 10;

/** A climb or a descent ahead, as a model is shown it. */
export interface CourseHill {
  /** Metres to where it starts, 0 when the road is already on it. */
  readonly inM: number;
  /** Its length from there, metres: cut short where the search ends. */
  readonly lengthM: number;
  /** Its average grade, whole percent: below 0 for a descent. */
  readonly avgPct: number;
  /** Its steepest grade, whole percent: the most negative for a descent. */
  readonly maxPct: number;
}

/** The next climb and the next descent ahead, each `null` when there is none in reach. */
export interface CourseHills {
  readonly climb: CourseHill | null;
  readonly descent: CourseHill | null;
}

/** `metres` to the nearest {@link COURSE_ROUNDING_METRES}. */
const roundedMetres = (value: number): number =>
  Math.round(value / COURSE_ROUNDING_METRES) * COURSE_ROUNDING_METRES;

/** A grade to a whole percent, inside ±100, with no `-0`. */
const wholePercent = (value: number): number =>
  Math.round(Math.min(100, Math.max(-100, value))) + 0;

/**
 * How far from `from` the summary may look: `metres`, held to
 * {@link COURSE_AHEAD_MOST_METRES} and, on a route that is not a loop, to its
 * end.
 */
function reach(profile: RouteProfile, from: number, metres: number): number {
  const most = Math.min(Math.max(0, metres), COURSE_AHEAD_MOST_METRES);
  return profile.loop
    ? most
    : Math.min(most, profile.totalDistance - distanceOnRoute(profile, from));
}

/**
 * The first stretch from `from`, within `span`, whose grade times `sign` is
 * at least {@link COURSE_HILL_GRADE_PERCENT} for at least
 * {@link COURSE_HILL_LEAST_METRES}: read at the profile's own spacing.
 */
function firstHill(
  profile: RouteProfile,
  from: number,
  span: number,
  sign: 1 | -1,
): CourseHill | null {
  const step = profile.resolution as number;
  const samples = Math.floor(span / step);
  let start: number | undefined;
  let steepest = 0;
  for (let at = 0; at <= samples + 1; at += 1) {
    // One sample past the end closes a run the search ends inside.
    const grade = at > samples ? Number.NaN : (gradeAt(profile, from + at * step) as number);
    if (grade * sign >= COURSE_HILL_GRADE_PERCENT) {
      start ??= at;
      steepest = Math.max(steepest, grade * sign);
      continue;
    }
    if (start === undefined) continue;
    const begins = start * step;
    const ends = Math.min(at * step, span);
    const length = ends - begins;
    if (length >= COURSE_HILL_LEAST_METRES) {
      const rise =
        (elevationAt(profile, from + ends) as number) -
        (elevationAt(profile, from + begins) as number);
      return {
        inM: roundedMetres(begins),
        lengthM: roundedMetres(length),
        avgPct: wholePercent((rise / length) * 100),
        maxPct: wholePercent(steepest * sign),
      };
    }
    start = undefined;
    steepest = 0;
  }
  return null;
}

/**
 * The next climb and the next descent from `from` (a distance on `profile`,
 * wrapped on a loop), looking `metres` up the road at most. See the file
 * comment for what counts as either.
 */
export function courseHillsAhead(
  profile: RouteProfile,
  from: number,
  metres: number = COURSE_AHEAD_MOST_METRES,
): CourseHills {
  const span = reach(profile, from, metres);
  return { climb: firstHill(profile, from, span, 1), descent: firstHill(profile, from, span, -1) };
}

/**
 * The climbing in the `metres` of road from `from`, whole metres: counted by
 * the rule a route's own ascent is (`profile.ts` §`recordedAscent`), so a
 * wobble under its threshold is no climbing. Past the end of a route that is
 * not a loop the road is level, so nothing there counts.
 */
export function courseClimbing(profile: RouteProfile, from: number, metres: number): number {
  const step = profile.resolution as number;
  const span = Math.max(0, metres);
  const heights: number[] = [];
  for (let along = 0; along < span; along += step) {
    heights.push(elevationAt(profile, from + along));
  }
  heights.push(elevationAt(profile, from + span));
  return Math.round(recordedAscent(heights) ?? 0);
}

/**
 * The average grade from `from` to `to` on `profile`, whole percent: the rise
 * over the run. `0` for a stretch with no length.
 */
export function courseAverageGrade(profile: RouteProfile, from: number, to: number): number {
  const run = to - from;
  if (!(run > 0)) return 0;
  const rise = (elevationAt(profile, to) as number) - (elevationAt(profile, from) as number);
  return wholePercent((rise / run) * 100);
}

/** Whether `value` is exactly a {@link CourseHill}, every number in range: for a reader of what a device sent. */
export function isCourseHill(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const hill = value as Readonly<Record<string, unknown>>;
  const keys = Object.keys(hill).sort().join();
  if (keys !== 'avgPct,inM,lengthM,maxPct') return false;
  const within = (field: unknown, least: number, most: number): boolean =>
    typeof field === 'number' && Number.isFinite(field) && field >= least && field <= most;
  return (
    within(hill.inM, 0, COURSE_AHEAD_MOST_METRES) &&
    within(hill.lengthM, 0, COURSE_AHEAD_MOST_METRES) &&
    within(hill.avgPct, -100, 100) &&
    within(hill.maxPct, -100, 100)
  );
}
