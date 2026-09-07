// SPDX-License-Identifier: Apache-2.0

import { beatsPerMinute, seconds, watts, type BeatsPerMinute, type Watts } from '../quantities';
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_SMOOTHING_WINDOW_SECONDS,
  EFFORT_WEIGHTING_EXPONENT,
  effortWeightedPower,
  heartRateLoad,
  LOAD_AT_THRESHOLD_FOR_ONE_HOUR,
  powerRideLoad,
  rollingMeans,
  thresholdFraction,
} from './load';

const ONE_SECOND = seconds(1);

/** A series of one repeated wattage. */
function steady(value: number, length: number): readonly Watts[] {
  return Array.from({ length }, () => watts(value));
}

function gap(length: number): readonly undefined[] {
  return Array.from<undefined>({ length }).fill(undefined);
}

describe('rollingMeans', () => {
  it('reports a mean only where a whole window of present samples ends', () => {
    // Window of 2 over four samples: the first index has no complete window.
    expect(rollingMeans([100, 200, 300, 400], 2)).toEqual([undefined, 150, 250, 350]);
  });

  it('never bridges a window across a gap', () => {
    // The rule `power-duration.ts` chose and this file inherits. The two
    // samples either side of the hole are not two consecutive seconds of
    // riding, and a mean over them would be a measurement of nothing.
    expect(rollingMeans([100, 200, undefined, 300, 400], 2)).toEqual([
      undefined,
      150,
      undefined,
      undefined,
      350,
    ]);
  });

  it('is empty of means when no window fits', () => {
    expect(rollingMeans([100, 200], 5)).toEqual([undefined, undefined]);
  });

  it('refuses a window that is not a positive whole number of samples', () => {
    expect(rollingMeans([100, 200], 0)).toEqual([undefined, undefined]);
    expect(rollingMeans([100, 200], -1)).toEqual([undefined, undefined]);
    expect(rollingMeans([100, 200], 1.5)).toEqual([undefined, undefined]);
  });
});

describe('effortWeightedPower — the hand-computed fixture', () => {
  it('matches arithmetic stated here rather than pasted from a run', () => {
    // Four samples, a two-second window. The rolling means are 150, 250 and
    // 350 — checkable by eye from the series, and asserted above.
    //
    //   150^4 =        506_250_000
    //   250^4 =      3_906_250_000
    //   350^4 =     15_006_250_000
    //               --------------
    //   sum   =     19_418_750_000   over three windows
    //
    // and the answer is the fourth root of the mean of those.
    const series = [watts(100), watts(200), watts(300), watts(400)];

    const result = effortWeightedPower(series, ONE_SECOND, 2);

    expect(result?.windows).toBe(3);
    expect(result?.power).toBeCloseTo(((150 ** 4 + 250 ** 4 + 350 ** 4) / 3) ** (1 / 4), 9);
    // And the value that arithmetic comes to, written out, so a reader who
    // does not want to run it can still check the order of magnitude.
    expect(result?.power).toBeCloseTo(283.6, 1);
  });

  it('is the plain average at a steady effort — the case that catches a wrong exponent or window', () => {
    // #76's second criterion, verbatim. For a constant series the weighting
    // and its inverse root cancel exactly, so this must be an equality and not
    // an approximation.
    expect(effortWeightedPower(steady(200, 600), ONE_SECOND)?.power).toBe(200);
    expect(effortWeightedPower(steady(317, 3600), ONE_SECOND, 60)?.power).toBe(317);
  });

  it('weights a variable ride above its plain average', () => {
    // The whole point of the exponent. Ten minutes alternating 100 and 300 W
    // averages 200, and costs more than ten minutes at a flat 200.
    const alternating: Watts[] = [];
    for (let index = 0; index < 600; index += 1) {
      alternating.push(watts(index % 120 < 60 ? 100 : 300));
    }

    const weighted = effortWeightedPower(alternating, ONE_SECOND);

    const mean = alternating.reduce((sum, value) => sum + value, 0) / alternating.length;
    expect(mean).toBeCloseTo(200, 9);
    expect(weighted?.power).toBeGreaterThan(mean);
  });

  it('is exactly the average whatever the exponent, which is why the other fixtures pin it', () => {
    // Stated so nobody reads the steady-state test as proof of the exponent:
    // it holds for any exponent at all, and the hand-computed case above is
    // what actually fixes the value.
    expect(EFFORT_WEIGHTING_EXPONENT).toBe(4);
    expect(DEFAULT_SMOOTHING_WINDOW_SECONDS).toBe(30);
  });
});

describe('effortWeightedPower — a ride the window does not fit in', () => {
  it('returns undefined rather than NaN for a ride shorter than the window', () => {
    // #76's fourth criterion. There is no number that honestly means "no such
    // window exists", so the answer is the absence of one.
    expect(effortWeightedPower(steady(200, 10), ONE_SECOND)).toBeUndefined();
  });

  it('returns undefined for a ride with no power at all', () => {
    expect(effortWeightedPower(gap(3600), ONE_SECOND)).toBeUndefined();
  });

  it('returns undefined for an empty series', () => {
    expect(effortWeightedPower([], ONE_SECOND)).toBeUndefined();
  });

  it('refuses a non-positive interval or window rather than dividing by zero', () => {
    expect(effortWeightedPower(steady(200, 600), seconds(0))).toBeUndefined();
    expect(effortWeightedPower(steady(200, 600), ONE_SECOND, 0)).toBeUndefined();
  });

  it('honours the sample interval, so the window is a duration and not a sample count', () => {
    // Sixty samples at five seconds each is five minutes of riding. A 30 s
    // window is six of those samples, not thirty — a stream stored at another
    // rate would otherwise smooth over two and a half minutes.
    const atFiveSeconds = steady(200, 60);

    expect(effortWeightedPower(atFiveSeconds, seconds(5))?.windows).toBe(60 - 6 + 1);
    expect(effortWeightedPower(atFiveSeconds, ONE_SECOND)?.windows).toBe(60 - 30 + 1);
  });

  it('honours a caller-supplied window', () => {
    expect(effortWeightedPower(steady(200, 600), ONE_SECOND, 60)?.windows).toBe(600 - 60 + 1);
  });
});

describe('the gap rule — #76 names the cost of getting this wrong', () => {
  /** Thirty minutes at 250 W, thirty minutes of dropout. */
  function halfLost(): readonly (Watts | undefined)[] {
    return [...steady(250, 1800), ...gap(1800)];
  }

  /** The same ride with the defect: the dropout scored as zero watts. */
  function gapAsZeros(): readonly Watts[] {
    return [...steady(250, 1800), ...steady(0, 1800)];
  }

  it('does not let a dropout drag the weighted power down', () => {
    // The rider held 250 W for every second the meter reported. Scoring the
    // silence as zero says they held about 210, and nobody re-derives it.
    expect(effortWeightedPower(halfLost(), ONE_SECOND)?.power).toBe(250);

    const withDefect = effortWeightedPower(gapAsZeros(), ONE_SECOND)?.power ?? 0;
    expect(withDefect).toBeLessThan(250);
  });

  it('reports the load of the half that was recorded, and says how much that was', () => {
    // Half an hour at threshold is half of an hour at threshold. The ride is
    // not claimed to be harder than it was, and it is not claimed to be a
    // whole hour either.
    const load = powerRideLoad(halfLost(), ONE_SECOND, watts(250));

    expect(load?.load).toBeCloseTo(LOAD_AT_THRESHOLD_FOR_ONE_HOUR / 2, 9);
    expect(load?.coveredSeconds).toBe(1800);
  });

  it('is a different number from the one the defect produces', () => {
    // The assertion that would go red if a future edit filled gaps with zeros:
    // both are defined, both look plausible, and only this comparison notices.
    const honest = powerRideLoad(halfLost(), ONE_SECOND, watts(250))?.load ?? 0;
    const defective = powerRideLoad(gapAsZeros(), ONE_SECOND, watts(250))?.load ?? 0;

    expect(honest).not.toBeCloseTo(defective, 3);
  });
});

describe('thresholdFraction', () => {
  it('is one at threshold, and scales with the ratio', () => {
    expect(thresholdFraction(watts(250), watts(250))).toBe(1);
    expect(thresholdFraction(watts(125), watts(250))).toBe(0.5);
    expect(thresholdFraction(watts(300), watts(250))).toBeCloseTo(1.2, 9);
  });

  it('is undefined rather than Infinity for a threshold of zero', () => {
    // `Infinity` renders as a number on a screen, which is worse than nothing.
    expect(thresholdFraction(watts(250), watts(0))).toBeUndefined();
  });
});

describe('powerRideLoad — the scale, stated in cases anyone can check', () => {
  it('is a hundred for an hour at threshold, by construction', () => {
    const load = powerRideLoad(steady(250, 3600), ONE_SECOND, watts(250));

    expect(load?.load).toBeCloseTo(LOAD_AT_THRESHOLD_FOR_ONE_HOUR, 9);
    expect(load?.basis).toBe('power');
    expect(load?.coveredSeconds).toBe(3600);
  });

  it('doubles with duration at the same intensity', () => {
    const load = powerRideLoad(steady(250, 7200), ONE_SECOND, watts(250));
    expect(load?.load).toBeCloseTo(2 * LOAD_AT_THRESHOLD_FOR_ONE_HOUR, 9);
  });

  it('is a quarter, not a half, for an hour at half threshold', () => {
    // The claim the square makes: a very easy hour costs much less than half
    // of a hard one. Asserted rather than left implied, because it is the one
    // arithmetic choice in this file a reader is likely to disagree with.
    const load = powerRideLoad(steady(125, 3600), ONE_SECOND, watts(250));
    expect(load?.load).toBeCloseTo(LOAD_AT_THRESHOLD_FOR_ONE_HOUR / 4, 9);
  });

  it('moves when the athlete’s threshold moves', () => {
    // #76's sixth criterion at this layer: a fixed ride, two thresholds, and
    // every dependent number changes.
    const ride = steady(250, 3600);

    const atThreshold = powerRideLoad(ride, ONE_SECOND, watts(250))?.load ?? 0;
    const atHigherThreshold = powerRideLoad(ride, ONE_SECOND, watts(300))?.load ?? 0;

    // The same ride is easier for a stronger athlete, so it costs them less.
    expect(atHigherThreshold).toBeLessThan(atThreshold);
    expect(atHigherThreshold).toBeCloseTo(100 * (250 / 300) ** 2, 9);
  });

  it('has no load for a ride with no power, or no usable threshold', () => {
    expect(powerRideLoad(gap(3600), ONE_SECOND, watts(250))).toBeUndefined();
    expect(powerRideLoad(steady(250, 3600), ONE_SECOND, watts(0))).toBeUndefined();
  });
});

describe('heartRateLoad — the stated fallback, and it says it is one', () => {
  function steadyBpm(value: number, length: number): readonly BeatsPerMinute[] {
    return Array.from({ length }, () => beatsPerMinute(value));
  }

  it('is a hundred for an hour at threshold heart rate, on the same scale', () => {
    const load = heartRateLoad(steadyBpm(160, 3600), ONE_SECOND, beatsPerMinute(160));

    expect(load?.load).toBeCloseTo(LOAD_AT_THRESHOLD_FOR_ONE_HOUR, 9);
    expect(load?.coveredSeconds).toBe(3600);
  });

  it('labels itself, so a chart cannot mix the two bases without knowing', () => {
    // #76's fifth criterion. The basis is on the value rather than left to the
    // caller to remember it asked for the fallback.
    expect(heartRateLoad(steadyBpm(160, 3600), ONE_SECOND, beatsPerMinute(160))?.basis).toBe(
      'heartRate',
    );
    expect(powerRideLoad(steady(250, 3600), ONE_SECOND, watts(250))?.basis).toBe('power');
  });

  it('excludes a strap dropout rather than scoring it as no heartbeat', () => {
    const dropped = [...steadyBpm(160, 1800), ...gap(1800)];

    const load = heartRateLoad(dropped, ONE_SECOND, beatsPerMinute(160));

    expect(load?.load).toBeCloseTo(LOAD_AT_THRESHOLD_FOR_ONE_HOUR / 2, 9);
    expect(load?.coveredSeconds).toBe(1800);
  });

  it('has no load without a trace or a usable threshold', () => {
    expect(heartRateLoad(gap(3600), ONE_SECOND, beatsPerMinute(160))).toBeUndefined();
    expect(heartRateLoad(steadyBpm(160, 3600), ONE_SECOND, beatsPerMinute(0))).toBeUndefined();
    expect(heartRateLoad(steadyBpm(160, 10), ONE_SECOND, beatsPerMinute(160))).toBeUndefined();
  });
});
