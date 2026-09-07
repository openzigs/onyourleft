// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';

import { watts, type Seconds } from '../quantities';
import {
  CRITICAL_POWER_MAXIMUM_SECONDS,
  CRITICAL_POWER_MINIMUM_EFFORTS,
  CRITICAL_POWER_MINIMUM_SECONDS,
  fitCriticalPower,
  predictedPower,
} from './critical-power';
import type { BestEffort, PowerDurationCurve } from './power-duration';

/** A curve from an explicit list of (duration, power) pairs. */
function curveOf(pairs: readonly (readonly [number, number])[]): PowerDurationCurve {
  return pairs.map(([duration, power]): BestEffort => ({
    duration: duration as Seconds,
    power: watts(power),
  }));
}

/**
 * A curve generated **from the model itself** with parameters chosen in
 * advance, so the fit is checked against arithmetic rather than against its
 * own output.
 *
 * CP = 250 W, W′ = 20 000 J. Then P(t) = 20000/t + 250:
 *
 *   t = 120 s → 20000/120 + 250 = 166.66… + 250 = 416.66…
 *   t = 300 s → 20000/300 + 250 =  66.66… + 250 = 316.66…
 *   t = 600 s → 20000/600 + 250 =  33.33… + 250 = 283.33…
 *   t = 1200 s → 20000/1200 + 250 = 16.66… + 250 = 266.66…
 *
 * Recovering 250 and 20 000 from those four points is the test.
 */
const KNOWN_CRITICAL_POWER = 250;
const KNOWN_WORK_CAPACITY = 20_000;

function modelCurve(durations: readonly number[] = [120, 300, 600, 1200]): PowerDurationCurve {
  return curveOf(
    durations.map((duration) => [duration, KNOWN_WORK_CAPACITY / duration + KNOWN_CRITICAL_POWER]),
  );
}

describe('fitCriticalPower — recovering known parameters', () => {
  it('recovers the critical power and work capacity it was generated from', () => {
    const result = fitCriticalPower(modelCurve());

    expect(result.fitted).toBe(true);
    if (!result.fitted) return;
    expect(result.fit.criticalPower).toBeCloseTo(KNOWN_CRITICAL_POWER, 6);
    expect(result.fit.workCapacity).toBeCloseTo(KNOWN_WORK_CAPACITY, 3);
  });

  it('reports a perfect fit for points that lie exactly on the model', () => {
    const result = fitCriticalPower(modelCurve());

    expect(result.fitted).toBe(true);
    if (!result.fitted) return;
    expect(result.fit.rSquared).toBeCloseTo(1, 9);
    expect(result.fit.effortsUsed).toBe(4);
  });

  it('reports a worse fit for points that do not lie on any hyperbola', () => {
    // The goodness-of-fit has to be able to be bad, or it is decoration. These
    // four points are deliberately not model-shaped: power RISES with duration
    // over part of the band, which no hyperbola with a positive reserve does.
    const result = fitCriticalPower(
      curveOf([
        [120, 300],
        [300, 290],
        [600, 320],
        [1200, 280],
      ]),
    );

    if (result.fitted) {
      expect(result.fit.rSquared).toBeLessThan(0.9);
    } else {
      // Also an acceptable outcome for this data, and the assertion says so
      // rather than pretending only one branch can happen.
      expect(result.refusal).toBe('implausible-fit');
    }
  });

  it('predicts the power it was fitted from', () => {
    const result = fitCriticalPower(modelCurve());
    expect(result.fitted).toBe(true);
    if (!result.fitted) return;

    // 20000/300 + 250 = 316.66…, from the table above.
    expect(predictedPower(result.fit, 300 as Seconds)).toBeCloseTo(316.6667, 3);
  });
});

describe('fitCriticalPower — refusing rather than guessing', () => {
  it('refuses when the library has too few efforts in the band', () => {
    // #75: "refuses to report a fit at all when the library lacks efforts in
    // the durations the model needs. A confident critical-power number derived
    // from three rides is worse than no number."
    const result = fitCriticalPower(modelCurve([300, 600]));

    expect(result.fitted).toBe(false);
    if (result.fitted) return;
    expect(result.refusal).toBe('not-enough-efforts');
  });

  it('refuses when every effort is outside the band, however many there are', () => {
    // A sprinter's library: lots of efforts, none of them in the two-to-twenty
    // minute band the model describes. Counting efforts without checking their
    // durations is the obvious wrong implementation, so this is the test for
    // it.
    const result = fitCriticalPower(
      curveOf([
        [5, 900],
        [10, 800],
        [30, 600],
        [60, 480],
        [1800, 240],
        [3600, 225],
      ]),
    );

    expect(result.fitted).toBe(false);
    if (result.fitted) return;
    expect(result.refusal).toBe('not-enough-efforts');
  });

  it('fits on exactly the minimum number of efforts, and not one fewer', () => {
    const durations = [120, 300, 600];
    expect(durations).toHaveLength(CRITICAL_POWER_MINIMUM_EFFORTS);

    expect(fitCriticalPower(modelCurve(durations)).fitted).toBe(true);
    expect(fitCriticalPower(modelCurve(durations.slice(1))).fitted).toBe(false);
  });

  it('refuses a flat curve, which fits no hyperbola with a positive reserve', () => {
    // Equal power at every duration means a slope of zero: W′ = 0, which is
    // not a reserve. An athlete this describes does not exist, and the number
    // it would otherwise report — CP equal to their steady power — is a
    // coincidence rather than a measurement.
    const result = fitCriticalPower(
      curveOf([
        [120, 260],
        [300, 260],
        [600, 260],
        [1200, 260],
      ]),
    );

    expect(result.fitted).toBe(false);
    if (result.fitted) return;
    expect(result.refusal).toBe('implausible-fit');
  });

  it('refuses when power rises with duration, which inverts the model', () => {
    // A negative reserve. Physically it says the rider gets stronger the
    // longer they go, and arithmetically it makes W′ negative — which
    // `joules()` would throw on, so the refusal has to come first.
    const result = fitCriticalPower(
      curveOf([
        [120, 240],
        [300, 260],
        [600, 280],
        [1200, 300],
      ]),
    );

    expect(result.fitted).toBe(false);
    if (result.fitted) return;
    expect(result.refusal).toBe('implausible-fit');
  });
});

describe('fitCriticalPower — the band', () => {
  it('uses only efforts inside the band, ignoring the rest', () => {
    // The same model efforts, with a sprint and a long ride added. Both are
    // outside the band and neither should move the answer — a fit that used
    // them would be dragged by the 5 s point badly.
    const inBand = modelCurve();
    const withOutliers = curveOf([
      [5, 1200],
      ...inBand.map((effort): readonly [number, number] => [effort.duration, effort.power]),
      [3600, 200],
    ]);

    const plain = fitCriticalPower(inBand);
    const padded = fitCriticalPower(withOutliers);

    expect(plain.fitted && padded.fitted).toBe(true);
    if (!plain.fitted || !padded.fitted) return;
    expect(padded.fit.criticalPower).toBeCloseTo(plain.fit.criticalPower, 9);
    expect(padded.fit.workCapacity).toBeCloseTo(plain.fit.workCapacity, 9);
    expect(padded.fit.effortsUsed).toBe(plain.fit.effortsUsed);
  });

  it('includes the band boundaries themselves', () => {
    // Inclusive on both ends, asserted rather than left to a reader to infer
    // from a `>=` in the source.
    const result = fitCriticalPower(
      modelCurve([CRITICAL_POWER_MINIMUM_SECONDS, 600, CRITICAL_POWER_MAXIMUM_SECONDS]),
    );

    expect(result.fitted).toBe(true);
    if (!result.fitted) return;
    expect(result.fit.effortsUsed).toBe(3);
  });

  it('refuses an empty curve', () => {
    const result = fitCriticalPower([]);
    expect(result.fitted).toBe(false);
  });
});
