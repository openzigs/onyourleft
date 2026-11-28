// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The slopes on a route, and the whole percent a rider is told — #399, #2291.
 *
 * Split out of `climb-ahead.ts` by #3279 so that the road signs
 * (`../road-signs.ts`) can read the same slopes the announcer reads without
 * importing the announcer: `climb-ahead.ts` reaches `announce.ts`, which
 * reaches `fields.ts` and the recording's totals, and `game/port.ts` names
 * the road signs, so every module that reads the port — the Delivery round's
 * planner among them — would reach a recording (#1808,
 * `delivery/targets.test.ts`). This module imports nothing but the domain's
 * profile. `climb-ahead.ts` re-exports every name here, and its header says
 * what counts as a slope and why.
 */

import { GRADIENT_WINDOW_METRES, type RouteProfile } from '@onyourleft/domain';

/** The grade, either way, at which the road stops being flat. */
export const SLOPE_GRADE_PERCENT = 3;
/** The shortest stretch at that grade worth a sentence. */
export const MINIMUM_SLOPE_METRES = 100;
/**
 * How much of each end of a slope its mean leaves out — #2291: half the
 * gradient window, the reach of a sample's window past the slope's edge
 * ({@link slopesOf}).
 */
export const BODY_TRIM_METRES = GRADIENT_WINDOW_METRES / 2;

export type SlopeKind = 'climb' | 'descent';

/** One stretch of road worth announcing. Distances are along the route. */
export interface Slope {
  readonly kind: SlopeKind;
  /** Where it starts, in metres from the start of the route. */
  readonly start: number;
  /** How long it is. On a loop it may run past the line into the next lap. */
  readonly length: number;
  /**
   * Its mean grade, in percent, signed as the profile signs it — over the
   * slope's BODY, not its ramps (#2291, {@link slopesOf}).
   */
  readonly grade: number;
}

/**
 * A slope's grade as the rider is told it, in whole percent — #2291. Rounded
 * first to the tenth the HUD's gradient field shows (`fields.ts`
 * §`gradientReading`), then half up, so the number is the big gradient
 * number rounded: a 4.5 % climb is "5", whatever float the mean lands on.
 * The announcer and the strip's caption both say this one.
 */
export function wholePercent(grade: number): number {
  return Math.round(Math.round(Math.abs(grade) * 10) / 10);
}

type Band = SlopeKind | 'flat';

function bandOf(grade: number): Band {
  if (grade >= SLOPE_GRADE_PERCENT) return 'climb';
  if (grade <= -SLOPE_GRADE_PERCENT) return 'descent';
  return 'flat';
}

interface Run {
  readonly band: Band;
  first: number;
  last: number;
}

/**
 * Every slope on the route, in order. Pure; call it once per route.
 *
 * A run of grid samples in one band spans `samples × resolution` metres — each
 * sample stands for the cell it starts. Runs of flat shorter than the minimum
 * between two runs of the same kind are absorbed, then any climb or descent
 * still shorter than the minimum is dropped.
 *
 * ⚠️ **The mean leaves out the ramps — #2291.** A grade is a least-squares
 * slope over `GRADIENT_WINDOW_METRES` (`@onyourleft/domain` §profile), so at
 * a change of slope it ramps across the window from one grade to the other,
 * and a slope's run starts and ends partway up those ramps, where the grade
 * crosses {@link SLOPE_GRADE_PERCENT}. Averaged in, they pulled a steady 10 %
 * climb to 9.4 % and a 4.5 % one to 4.44 %, and the caption said "9 %" and
 * "4 %". A sample within half the window of the run's edge is measured over a
 * window that reaches the road beyond it, so the mean is taken without those
 * samples ({@link BODY_TRIM_METRES}); a slope too short to have a body keeps
 * the mean over all of it. ⚠️ **However short the body**: a short real climb
 * is mostly ramp, and its middle samples are the nearest to its grade, so a
 * body of one sample is kept rather than the ramps averaged back in.
 */
export function slopesOf(profile: RouteProfile): readonly Slope[] {
  const resolution = profile.resolution as number;
  const grades = profile.grades as readonly number[];
  if (!(resolution > 0) || grades.length === 0) return [];
  const minimumSamples = Math.ceil(MINIMUM_SLOPE_METRES / resolution);

  const runs: Run[] = [];
  grades.forEach((grade, index) => {
    const band = bandOf(grade);
    const open = runs.at(-1);
    if (open !== undefined && open.band === band) open.last = index;
    else runs.push({ band, first: index, last: index });
  });

  // A short flat between two slopes of the same kind is part of the slope.
  for (let index = 1; index < runs.length - 1; index += 1) {
    const gap = runs[index] as Run;
    const before = runs[index - 1] as Run;
    const after = runs[index + 1] as Run;
    if (
      gap.band === 'flat' &&
      before.band === after.band &&
      gap.last - gap.first + 1 < minimumSamples
    ) {
      before.last = after.last;
      runs.splice(index, 2);
      index -= 1;
    }
  }

  const trim = Math.round(BODY_TRIM_METRES / resolution);
  const samplesOf = (run: Run): number[] => grades.slice(run.first, run.last + 1);
  const slopeOf = (run: Run, across?: Run): Slope => {
    // Across the line on a loop, the head's samples follow the tail's.
    const samples = [...samplesOf(run), ...(across === undefined ? [] : samplesOf(across))];
    const body = samples.length > 2 * trim ? samples.slice(trim, samples.length - trim) : samples;
    const mean = body.reduce((sum, value) => sum + value, 0) / body.length;
    return {
      kind: run.band as SlopeKind,
      start: run.first * resolution,
      length: samples.length * resolution,
      grade: mean,
    };
  };

  const kept = runs.filter(
    (run) => run.band !== 'flat' && run.last - run.first + 1 >= minimumSamples,
  );
  const slopes = kept.map((run) => slopeOf(run));

  // On a loop, a slope that runs across the line is ONE slope, starting where
  // the last one does — the one at the very start of the route is its tail,
  // not a new hill.
  const head = runs[0];
  const tail = runs.at(-1);
  if (
    profile.loop &&
    slopes.length > 1 &&
    head !== undefined &&
    tail !== undefined &&
    head !== tail &&
    head.band !== 'flat' &&
    head.band === tail.band &&
    kept[0] === head &&
    kept.at(-1) === tail
  ) {
    const joined = slopeOf(tail, head);
    return [...slopes.slice(1, -1), joined];
  }
  return slopes;
}
