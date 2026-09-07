// SPDX-License-Identifier: Apache-2.0

/**
 * The power-duration curve: the best average power an athlete held over every
 * duration of interest.
 *
 * This is the foundation the rest of #11 sits on — load metrics (#76), the
 * fitness chart (#77) and zones (#78) all read from it — so its two easy
 * mistakes are worth naming before the code.
 *
 * ## The gap rule, decided rather than defaulted
 *
 * `recording/channels.ts` already states the invariant this rests on: **a gap
 * is `undefined`, never a sentinel and never zero. Zero power is a rider
 * coasting; absent power is a sensor that is gone.** #75's criteria call
 * conflating the two "the most common defect in this whole area", and it is
 * the kind that is invisible: a thirty-minute dropout scored as thirty minutes
 * at zero watts halves a number nobody re-derives.
 *
 * There are two defensible rules and this file takes the first:
 *
 * 1. **A window that is not entirely covered by real samples yields no
 *    effort.** ← chosen
 * 2. Bridge the gap by interpolating across it.
 *
 * Rule 1 is chosen because this metric is a **claim about a ride that
 * happened**. Bridging invents watts the athlete may not have produced and
 * then reports them as a personal best; excluding says only "there is no
 * twenty-minute window here we can vouch for", which is true. The cost is that
 * a ride with a dropout in the middle contributes no long efforts at all, and
 * that cost is the honest one — an absent best is recoverable, a fabricated
 * one is believed.
 *
 * It falls out of the implementation rather than being bolted on: the series
 * is split into maximal runs of present samples and each window lives inside
 * one run, so a window can never span a gap by construction.
 *
 * ## The complexity, which is a requirement and not a nicety
 *
 * The naive form recomputes each window's mean and is O(n·d) per duration —
 * on a library of a thousand four-hour rides it does not finish, and #75 says
 * so. A rolling sum makes each duration O(n): one addition and one subtraction
 * per step, regardless of window length. The whole curve is therefore
 * O(n · number of durations), and the durations are a fixed list.
 *
 * ## Sampling interval
 *
 * **One sample per second**, so an index is a second and a window of `d`
 * seconds is `d` samples. That is what [ADR 0011](../../../../docs/adr/0011-stream-storage.md)
 * stores — a dense 1 Hz grid with holes — and this module is fed from it. A
 * series at any other rate would produce silently wrong durations, so
 * {@link powerDurationCurve} is documented as taking a 1 Hz series and nothing
 * here tries to infer a rate it cannot see.
 *
 * ## Provenance
 *
 * The maximal-mean-value computation is elementary and is not taken from
 * anywhere. GoldenCheetah has a mature implementation and is **GPL-2.0**:
 * CLAUDE.md §6 permits reading it to check a formula and forbids copying from
 * it, which under §3 would be fatal to this package. Nothing here is derived
 * from that source.
 */

import { watts, type Seconds, type Watts } from '../quantities';

/**
 * A 1 Hz power series, with `undefined` where the sensor said nothing.
 *
 * Deliberately not `Watts[]` with zeros: see the gap rule above.
 */
export type PowerSeries = readonly (Watts | undefined)[];

/** The best average power held over one duration. */
export interface BestEffort {
  readonly duration: Seconds;
  readonly power: Watts;
}

/**
 * Best efforts, ascending by duration.
 *
 * A duration the data cannot support is **absent** rather than present with a
 * zero or a `NaN`. A consumer asking "what is the twenty-minute best" gets
 * `undefined` and has to decide what that means, which is the point: there is
 * no value that honestly represents "no such window exists".
 */
export type PowerDurationCurve = readonly BestEffort[];

/**
 * The durations the curve is reported over, in seconds.
 *
 * Chosen to span what the physiology actually distinguishes — a neuromuscular
 * sprint, an anaerobic effort, the aerobic band a critical-power fit needs
 * (see `critical-power.ts`), and the long steady efforts that characterise a
 * ride rather than a moment. It is a **list rather than every integer** because
 * the curve is read by humans and plotted on a log axis; a value for every
 * second between 1 and 14 400 would be 14 400 numbers to store per ride and
 * would tell a reader nothing the decade spacing does not.
 */
export const CURVE_DURATIONS: readonly number[] = [
  1, 5, 10, 15, 30, 60, 120, 180, 300, 480, 600, 900, 1200, 1800, 2700, 3600, 5400, 7200,
];

/**
 * The best average power over any fully-covered window of `windowSeconds`.
 *
 * `undefined` when no such window exists — the series is shorter than the
 * window, or every window long enough spans a gap. That is the "defined result
 * rather than `NaN` or a crash" #75 asks for on a series shorter than the
 * window.
 *
 * O(n) in the length of the series, by rolling sum.
 */
export function bestMeanPower(series: PowerSeries, windowSeconds: number): Watts | undefined {
  if (!Number.isInteger(windowSeconds) || windowSeconds < 1) {
    return undefined;
  }

  let best: number | undefined;

  // One pass. `runStart` is the index the current unbroken run of present
  // samples began at; `sum` is the total of the last `windowSeconds` samples
  // once the run is long enough to hold one.
  let runStart = 0;
  let sum = 0;
  for (let index = 0; index <= series.length; index += 1) {
    const sample = index < series.length ? series[index] : undefined;
    if (sample === undefined) {
      // The run ends here. Nothing to carry: the next window must start after
      // the gap, which is the whole of the gap rule.
      runStart = index + 1;
      sum = 0;
      continue;
    }

    sum += sample;
    const covered = index - runStart + 1;
    if (covered > windowSeconds) {
      // Drop the sample that has fallen out of the window. It is present by
      // construction — it is inside the same run.
      sum -= series[index - windowSeconds] ?? 0;
    }
    if (covered >= windowSeconds) {
      const mean = sum / windowSeconds;
      if (best === undefined || mean > best) {
        best = mean;
      }
    }
  }

  return best === undefined ? undefined : watts(best);
}

/**
 * The curve for one activity.
 *
 * An activity with **no power at all** — every sample absent — produces an
 * empty curve rather than a curve of zeros, so it contributes nothing to a
 * library merge. That is #75's "excluded rather than contributing zeros",
 * satisfied by the same mechanism as the gap rule rather than by a special
 * case that could disagree with it.
 */
export function powerDurationCurve(
  series: PowerSeries,
  durations: readonly number[] = CURVE_DURATIONS,
): PowerDurationCurve {
  const efforts: BestEffort[] = [];
  for (const duration of [...durations].sort((left, right) => left - right)) {
    const power = bestMeanPower(series, duration);
    if (power !== undefined) {
      efforts.push({ duration: duration as Seconds, power });
    }
  }
  return efforts;
}

/**
 * The best of several curves, duration by duration.
 *
 * **This is what makes the curve incrementally updatable**, and it is why #75's
 * "incremental equals full recomputation" criterion is a property rather than
 * a hope. A library's curve is the pointwise maximum over its activities'
 * curves, and pointwise maximum is associative and commutative — so folding
 * one new activity into an existing library curve and recomputing the whole
 * library from scratch are the same computation in a different order, for any
 * data whatsoever.
 *
 * The alternative shape — recomputing from the concatenated samples of every
 * ride — would be both slower and *wrong*, because it would let a window span
 * the boundary between two rides and report an effort nobody rode.
 */
export function mergeCurves(...curves: readonly PowerDurationCurve[]): PowerDurationCurve {
  const best = new Map<number, number>();
  for (const curve of curves) {
    for (const effort of curve) {
      const current = best.get(effort.duration);
      if (current === undefined || effort.power > current) {
        best.set(effort.duration, effort.power);
      }
    }
  }
  return [...best.entries()]
    .sort(([left], [right]) => left - right)
    .map(([duration, power]) => ({ duration: duration as Seconds, power: watts(power) }));
}

/** The best effort at one duration, or `undefined` if the curve has none. */
export function effortAt(curve: PowerDurationCurve, duration: number): Watts | undefined {
  return curve.find((effort) => effort.duration === duration)?.power;
}
