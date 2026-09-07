// SPDX-License-Identifier: Apache-2.0

/**
 * Per-ride load: how hard a ride was, in three numbers.
 *
 * These are what turn a list of rides into a training history — #76 — and they
 * are the file where the *names* needed more care than the arithmetic.
 *
 * ## ⚠️ The names are somebody's trademarks. The formulae are not.
 *
 * #76 flagged that the common names for these three metrics are *"widely
 * reported to be registered trademarks"* and that this **had not been
 * verified**. It has been now, and the answer is yes:
 *
 * - **NORMALIZED POWER** — USPTO registration **4450848**, serial **85913880**,
 *   owner TRAININGPEAKS, LLC, filed 2013-04-24, registered 2013-12-17.
 * - **"Training Stress Score"** and **"Intensity Factor"** are reported
 *   registered to the same owner (Peaksware / TrainingPeaks).
 * - All of them passed to Garmin with its acquisition of TrainingPeaks on
 *   2026-07-22.
 * - ⚠️ **`CTL`, `ATL` and `TSB` are reported registered too**, which #76 did
 *   **not** flag and which lands on #77's chart rather than on this file.
 * - "Functional Threshold Power" / "FTP" could **not** be established either
 *   way. `packages/store` already calls the setting `thresholdPower`, which is
 *   plainly descriptive, so nothing turns on it.
 *
 * So this file coins its own plainly descriptive names, which is the
 * "trivially avoidable" path #76 asks for. **Do not rename these to the
 * familiar ones**, in code, in a UI label, in a metric key or in a column
 * header — using someone's mark as your own feature name is the exact thing
 * trademark law exists to stop.
 *
 * | Here | The name you already know |
 * |---|---|
 * | {@link effortWeightedPower} | the fourth-power-weighted one |
 * | {@link thresholdFraction} | the ratio-to-threshold one |
 * | {@link rideLoad} | the single-number-per-ride one |
 *
 * **The formulae themselves are unaffected and are used freely.** They are
 * published — Allen & Coggan, *Training and Racing with a Power Meter* (2006) —
 * and a trademark protects a name, not arithmetic. A mathematical formula is
 * not copyrightable either (CLAUDE.md §6). GoldenCheetah implements the same
 * three and is **GPL-2.0**: reading it to check the arithmetic is permitted and
 * copying from it is fatal inside `packages/` (§3). Nothing here is derived
 * from it — every expression below is written from the published description.
 *
 * ## The gap rule, again, and it is the same one
 *
 * `power-duration.ts` chose it and `zones.ts` restated it: **a gap is
 * `undefined`, never zero.** #76 names the cost of getting it wrong out loud —
 * *"treating a 30-minute gap as 30 minutes at zero watts halves the number and
 * nobody notices for a season"* — and that is worse here than anywhere else in
 * the program, because a load number is compared against last week's rather
 * than re-derived.
 *
 * The rule this file takes: **a gap contributes no sample to the mean, and the
 * ride reports how much of itself was covered.** Not "exclude and say nothing",
 * because a ride that lost half its power trace is not comparable to one that
 * did not, and not "score it as zero", because that is the defect. The caller
 * gets a number *and* the coverage it rests on — the same shape `zones.ts`
 * settled on, for the same reason.
 */

import {
  beatsPerMinute,
  seconds,
  watts,
  type BeatsPerMinute,
  type Seconds,
  type Watts,
} from '../quantities';

/**
 * The rolling window, in seconds.
 *
 * Thirty seconds because that is roughly how long the cardiovascular system
 * takes to respond fully to a change in effort, so a 30 s mean is the shortest
 * window that reflects what the body actually experienced rather than what the
 * cranks did. Published with the formula in the source above.
 *
 * Configurable per call — #76's fourth criterion — because it is a modelling
 * choice rather than a constant of nature, and because a stream stored at
 * another interval needs a different sample count for the same duration.
 */
export const DEFAULT_SMOOTHING_WINDOW_SECONDS = 30;

/**
 * The weighting exponent.
 *
 * Fourth power, because the metabolic cost of producing power rises
 * disproportionately with wattage, so a mean that weights hard efforts as
 * heavily as easy ones understates a variable ride. Raise each smoothed value
 * to this power, take the mean, take the same root back.
 *
 * ⚠️ **A test asserts that a steady ride gives exactly the average power.**
 * That is the case that catches a wrong exponent *or* a wrong window, and #76
 * names it as the simplest and most valuable fixture for that reason: for a
 * constant series the fourth-power mean and its fourth root cancel exactly,
 * whatever this number is — so the test also holds if someone changes it, and
 * the *other* fixtures are what pin the value.
 */
export const EFFORT_WEIGHTING_EXPONENT = 4;

/** Seconds in an hour. Named because {@link rideLoad}'s denominator is one. */
const SECONDS_PER_HOUR = 3600;

/**
 * The load of one hour ridden exactly at threshold.
 *
 * A scale, not a measurement: it fixes "an hour at threshold" at 100 so the
 * numbers land in a range a person can hold in their head. Everything else is
 * relative to it.
 */
export const LOAD_AT_THRESHOLD_FOR_ONE_HOUR = 100;

/** Which channel a load was derived from. @see RideLoad.basis */
export type LoadBasis = 'power' | 'heartRate';

/**
 * The best average power over a rolling window, sample by sample.
 *
 * Returns one entry per input sample, `undefined` where no complete window of
 * present samples ends at that sample. **A window is never bridged across a
 * gap** — the same rule, and the same implementation shape, as
 * `power-duration.ts`'s `bestMeanPower`.
 *
 * Exported because it is the intermediate a reviewer needs to check the
 * arithmetic of {@link effortWeightedPower} against a hand-computed fixture,
 * and #76's first criterion is that the arithmetic be checkable rather than
 * trusted.
 */
export function rollingMeans(
  series: readonly (number | undefined)[],
  windowSamples: number,
): readonly (number | undefined)[] {
  const means = new Array<number | undefined>(series.length).fill(undefined);
  if (!Number.isInteger(windowSamples) || windowSamples < 1) {
    return means;
  }

  // One pass, carrying the sum of the current unbroken run's trailing window.
  let runStart = 0;
  let sum = 0;
  for (const [index, sample] of series.entries()) {
    if (sample === undefined) {
      runStart = index + 1;
      sum = 0;
      continue;
    }
    sum += sample;
    const covered = index - runStart + 1;
    if (covered > windowSamples) {
      // Present by construction: it is inside the same unbroken run.
      sum -= series[index - windowSamples] ?? 0;
    }
    if (covered >= windowSamples) {
      means[index] = sum / windowSamples;
    }
  }
  return means;
}

/** What {@link effortWeightedPower} answers, and what it rests on. */
export interface EffortWeightedPower {
  readonly power: Watts;
  /**
   * How many rolling windows the mean was taken over.
   *
   * The honest denominator. A ride whose power dropped out for half its
   * duration produces a number from the half that reported, and this says so.
   */
  readonly windows: number;
}

/**
 * Power weighted towards the hard parts of the ride.
 *
 * `undefined` when no complete window exists at all — a ride shorter than the
 * window, or one whose every run of present samples is shorter than it. That is
 * #76's fourth criterion: *"a ride shorter than the window returns a defined
 * result rather than `NaN` or a crash"*, and the defined result is the absence
 * of one, for `power-duration.ts`'s reason — there is no number that honestly
 * means "no such window exists".
 *
 * @param sampleInterval seconds per sample, taken from the stream rather than
 * assumed, so a set stored at anything other than 1 Hz smooths over the
 * intended *duration* rather than the intended sample count.
 */
export function effortWeightedPower(
  series: readonly (Watts | undefined)[],
  sampleInterval: Seconds,
  windowSeconds: number = DEFAULT_SMOOTHING_WINDOW_SECONDS,
): EffortWeightedPower | undefined {
  const weighted = effortWeightedMean(series, sampleInterval, windowSeconds);
  return weighted === undefined
    ? undefined
    : { power: watts(weighted.value), windows: weighted.windows };
}

/**
 * The same weighting over a heart-rate trace.
 *
 * Exported because a caller that wants to **store** the threshold-independent
 * half of a load needs this number for a ride with no power meter, and the only
 * alternative is inverting {@link heartRateLoad}'s own arithmetic back out of
 * its answer — which works right up until that arithmetic changes, and then
 * produces a plausible wrong number instead of a compile error.
 */
export function effortWeightedHeartRate(
  series: readonly (BeatsPerMinute | undefined)[],
  sampleInterval: Seconds,
  windowSeconds: number = DEFAULT_SMOOTHING_WINDOW_SECONDS,
): { readonly rate: BeatsPerMinute; readonly windows: number } | undefined {
  const weighted = effortWeightedMean(series, sampleInterval, windowSeconds);
  return weighted === undefined
    ? undefined
    : { rate: beatsPerMinute(weighted.value), windows: weighted.windows };
}

/**
 * The weighting itself, unit-free.
 *
 * One implementation for both bases. It was two, copied, until #77 needed the
 * heart-rate half as a value rather than only inside a load — and two copies of
 * a weighting is two places for an exponent to drift.
 */
function effortWeightedMean(
  series: readonly (number | undefined)[],
  sampleInterval: Seconds,
  windowSeconds: number,
): { readonly value: number; readonly windows: number } | undefined {
  if (!(sampleInterval > 0) || !(windowSeconds > 0)) {
    return undefined;
  }
  // Rounded rather than truncated: at a 4 s interval a 30 s window is 7.5
  // samples, and 8 is nearer the intended duration than 7. Stated because
  // whichever way it goes it is a decision, not an accident.
  const windowSamples = Math.round(windowSeconds / sampleInterval);
  if (windowSamples < 1) {
    return undefined;
  }

  const means = rollingMeans(series, windowSamples);
  let total = 0;
  let windows = 0;
  for (const mean of means) {
    if (mean === undefined) {
      continue;
    }
    total += mean ** EFFORT_WEIGHTING_EXPONENT;
    windows += 1;
  }
  if (windows === 0) {
    return undefined;
  }
  return { value: (total / windows) ** (1 / EFFORT_WEIGHTING_EXPONENT), windows };
}

/**
 * How hard the ride was relative to this athlete's threshold.
 *
 * 1 is an hour at threshold. Below 1 is endurance riding, above 1 is a ride
 * harder than the athlete could hold for an hour — which is normal for a short
 * one and impossible for a long one, and that is the whole information content.
 *
 * `undefined` for a non-positive threshold rather than a division by zero: an
 * athlete with no usable threshold has no intensity, and `Infinity` would
 * render as a number.
 */
export function thresholdFraction(power: Watts, threshold: Watts): number | undefined {
  if (!(threshold > 0)) {
    return undefined;
  }
  return power / threshold;
}

/** One ride's load, and what it was derived from. */
export interface RideLoad {
  /** {@link LOAD_AT_THRESHOLD_FOR_ONE_HOUR} for an hour at threshold. */
  readonly load: number;
  /**
   * Which channel it came from.
   *
   * #76's fifth criterion: *"mixing power-derived and HR-derived loads in one
   * chart without labelling them makes the chart meaningless"*. It is carried
   * on the value rather than left to the caller to remember, so a chart cannot
   * plot the two together without having had it in its hand.
   */
  readonly basis: LoadBasis;
  /**
   * The seconds the basis channel actually reported.
   *
   * Not the ride's duration. `zones.ts` records why the two differ in both
   * directions, and the consequence here is sharper: load is proportional to
   * duration, so a ride that lost a third of its trace produces a load a third
   * light. Reported rather than corrected, because inventing the missing third
   * is exactly the fabrication the gap rule exists to prevent.
   */
  readonly coveredSeconds: Seconds;
}

/**
 * A ride's load from its power trace.
 *
 * `undefined` when there is no usable power at all, or no usable threshold —
 * the caller then falls back to {@link heartRateLoad} or reports no load, and
 * either way says which, because {@link RideLoad.basis} makes it impossible to
 * lose track.
 *
 *     load = covered hours × fraction² × 100
 *
 * The square is not decoration: load has to grow with duration *and* with
 * intensity, and one factor of the fraction comes from the work done while the
 * other comes from how hard that work was. An hour at threshold is 100 by
 * construction; two hours at threshold is 200; an hour at half threshold is 25
 * rather than 50, which is the claim that a very easy hour costs much less than
 * half of a hard one.
 */
export function powerRideLoad(
  series: readonly (Watts | undefined)[],
  sampleInterval: Seconds,
  threshold: Watts,
  windowSeconds: number = DEFAULT_SMOOTHING_WINDOW_SECONDS,
): RideLoad | undefined {
  const weighted = effortWeightedPower(series, sampleInterval, windowSeconds);
  if (weighted === undefined) {
    return undefined;
  }
  const fraction = thresholdFraction(weighted.power, threshold);
  if (fraction === undefined) {
    return undefined;
  }
  // Counted from the samples that were present, not from the series length.
  const covered = presentSamples(series) * sampleInterval;
  return {
    load: (covered / SECONDS_PER_HOUR) * fraction ** 2 * LOAD_AT_THRESHOLD_FOR_ONE_HOUR,
    basis: 'power',
    coveredSeconds: seconds(covered),
  };
}

/**
 * A ride's load from its heart-rate trace — the stated fallback for a ride
 * recorded without a power meter.
 *
 * #76's fifth criterion asks for *"a stated fallback (heart-rate-based or none
 * at all)"*, and this is the statement: the same shape as the power form, with
 * the fraction taken against threshold heart rate instead of threshold power.
 *
 * ⚠️ **It is not the same quantity and must never be presented as one.** Heart
 * rate lags an effort by tens of seconds and saturates, so a sprint and a
 * threshold effort produce similar traces — the reason `zones.ts` gives five
 * heart-rate zones and seven power zones. A load from it is a rougher estimate
 * of the same idea, which is why {@link RideLoad.basis} exists and why the
 * screen says which it used.
 *
 * The window defaults to the same thirty seconds, and it matters less here:
 * heart rate is already a smoothed signal physiologically.
 */
export function heartRateLoad(
  series: readonly (BeatsPerMinute | undefined)[],
  sampleInterval: Seconds,
  threshold: BeatsPerMinute,
  windowSeconds: number = DEFAULT_SMOOTHING_WINDOW_SECONDS,
): RideLoad | undefined {
  if (!(threshold > 0)) {
    return undefined;
  }
  const weighted = effortWeightedHeartRate(series, sampleInterval, windowSeconds);
  if (weighted === undefined) {
    return undefined;
  }
  const fraction = weighted.rate / threshold;
  const covered = presentSamples(series) * sampleInterval;
  return {
    load: (covered / SECONDS_PER_HOUR) * fraction ** 2 * LOAD_AT_THRESHOLD_FOR_ONE_HOUR,
    basis: 'heartRate',
    coveredSeconds: seconds(covered),
  };
}

/**
 * How long the sensor actually reported, in seconds.
 *
 * Exported because it is the other half of a **threshold-independent** load
 * summary (#77): a caller storing one needs the covered time and the weighted
 * value, and neither depends on an athlete's threshold. Getting it out of
 * {@link powerRideLoad} instead would mean supplying a threshold in order to
 * compute something that does not use one.
 */
export function coveredTime(
  series: readonly (number | undefined)[],
  sampleInterval: Seconds,
): Seconds {
  return seconds(presentSamples(series) * sampleInterval);
}

/** How many samples the sensor actually reported. */
function presentSamples(series: readonly (number | undefined)[]): number {
  let present = 0;
  for (const sample of series) {
    if (sample !== undefined) {
      present += 1;
    }
  }
  return present;
}
