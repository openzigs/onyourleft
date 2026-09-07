// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';

import { watts, type Watts } from '../quantities';
import {
  bestMeanPower,
  CURVE_DURATIONS,
  effortAt,
  mergeCurves,
  powerDurationCurve,
  type PowerSeries,
} from './power-duration';

/**
 * The hand-computed fixture #75 asks for, and the reason it is written this
 * way: *"testing a curve against itself proves nothing"*. Every expected value
 * below is arrived at with arithmetic stated in the test, not by running the
 * implementation and pasting the answer.
 *
 * 600 seconds at 100 W, with two blocks laid into it:
 *
 * - seconds 100..159 — sixty seconds at **200 W**
 * - seconds 300..304 — five seconds at **400 W**
 */
function fixture(): PowerSeries {
  const series: Watts[] = [];
  for (let second = 0; second < 600; second += 1) {
    if (second >= 100 && second < 160) {
      series.push(watts(200));
    } else if (second >= 300 && second < 305) {
      series.push(watts(400));
    } else {
      series.push(watts(100));
    }
  }
  return series;
}

/** A series of one repeated value, for the steady-state cases. */
function steady(value: number, length: number): PowerSeries {
  return Array.from({ length }, () => watts(value));
}

describe('bestMeanPower — the hand-computed fixture', () => {
  it('finds the five-second block', () => {
    // The only five consecutive seconds above 100 W are the 400 W block.
    expect(bestMeanPower(fixture(), 5)).toBe(400);
  });

  it('finds the sixty-second block', () => {
    // Sixty consecutive seconds at 200 W. Any window overlapping the 400 W
    // block is at most (5×400 + 55×100) / 60 = 7500/60 = 125 W, which is less.
    expect(bestMeanPower(fixture(), 60)).toBe(200);
  });

  it('finds the three-hundred-second window that spans both blocks', () => {
    // A 300 s window starting anywhere in 5..100 contains BOTH blocks whole:
    //   235 s at 100 W = 23 500
    //    60 s at 200 W = 12 000
    //     5 s at 400 W =  2 000
    //                    ------
    //                    37 500 over 300 s = 125 W
    expect(bestMeanPower(fixture(), 300)).toBe(125);
  });

  it('is the plain average at a steady effort — the case that catches a wrong window', () => {
    // #75: "a steady-state ride at constant power must produce a smoothed
    // power equal to the average power — the simplest case, and the one that
    // catches a wrong exponent or a wrong window."
    expect(bestMeanPower(steady(180, 3600), 1200)).toBe(180);
    expect(bestMeanPower(steady(180, 3600), 1)).toBe(180);
    expect(bestMeanPower(steady(180, 3600), 3600)).toBe(180);
  });
});

describe('bestMeanPower — a window the data cannot fill', () => {
  it('returns undefined rather than NaN when the series is shorter than the window', () => {
    // The defined result #75 requires. There is no number that honestly means
    // "no such window exists", so the answer is the absence of one.
    expect(bestMeanPower(steady(200, 100), 300)).toBeUndefined();
  });

  it('returns undefined for an empty series', () => {
    expect(bestMeanPower([], 5)).toBeUndefined();
  });

  it('returns undefined for a series with no power at all', () => {
    expect(bestMeanPower([undefined, undefined, undefined], 1)).toBeUndefined();
  });

  it('refuses a window that is not a positive whole number of seconds', () => {
    expect(bestMeanPower(steady(200, 100), 0)).toBeUndefined();
    expect(bestMeanPower(steady(200, 100), -60)).toBeUndefined();
    expect(bestMeanPower(steady(200, 100), 2.5)).toBeUndefined();
  });
});

describe('bestMeanPower — the gap rule', () => {
  /**
   * Twenty minutes at 300 W, a five-minute dropout, then twenty minutes at
   * 300 W. The rider held 300 W for the whole of two separate twenty-minute
   * efforts; the sensor said nothing in between.
   */
  function withDropout(): PowerSeries {
    return [
      ...steady(300, 1200),
      ...Array.from<undefined>({ length: 300 }).fill(undefined),
      ...steady(300, 1200),
    ];
  }

  it('does not let a gap depress the twenty-minute best', () => {
    // The defect this exists to stop: scoring the 300 s dropout as 300 s at
    // zero watts. That would make the best 1200 s window straddle the gap and
    // report something in the low 200s, and nobody would re-derive it.
    expect(bestMeanPower(withDropout(), 1200)).toBe(300);
  });

  it('reports no effort for a window no unbroken run can hold', () => {
    // 2700 s is longer than either side of the dropout (1200 s each), and the
    // rule is that a window is never bridged across a gap. So there is no
    // 45-minute effort here — not a weak one, none.
    expect(bestMeanPower(withDropout(), 2700)).toBeUndefined();
    // And the whole series IS 2700 samples long, so this is the gap rule
    // talking and not the length check above.
    expect(withDropout()).toHaveLength(2700);
  });

  it('a gap at the very start or end does not shift the window', () => {
    const leading: PowerSeries = [undefined, undefined, ...steady(250, 60)];
    const trailing: PowerSeries = [...steady(250, 60), undefined, undefined];
    expect(bestMeanPower(leading, 60)).toBe(250);
    expect(bestMeanPower(trailing, 60)).toBe(250);
  });

  it('takes the better of two runs either side of a gap', () => {
    const series: PowerSeries = [...steady(200, 60), undefined, ...steady(260, 60)];
    expect(bestMeanPower(series, 60)).toBe(260);
  });
});

describe('powerDurationCurve', () => {
  it('reports every duration the data supports and no others', () => {
    const curve = powerDurationCurve(steady(200, 700));

    // 700 seconds of data: every curve duration up to 600 is achievable, and
    // nothing longer is.
    const achieved = curve.map((effort) => effort.duration);
    expect(achieved).toEqual(CURVE_DURATIONS.filter((duration) => duration <= 700));
    expect(achieved).toContain(600);
    expect(achieved).not.toContain(900);
  });

  it('is ascending by duration', () => {
    const curve = powerDurationCurve(fixture());
    const durations = curve.map((effort) => effort.duration);
    expect([...durations].sort((left, right) => left - right)).toEqual(durations);
  });

  it('is empty for a ride with no power at all, rather than a curve of zeros', () => {
    // #75: activities with no power are "excluded rather than contributing
    // zeros". A curve of zeros would drag nothing down on a merge — max
    // ignores it — but it would be indistinguishable from a ride of genuine
    // zero-watt coasting, which is a different claim.
    const noPower: PowerSeries = Array.from<undefined>({ length: 3600 }).fill(undefined);
    expect(powerDurationCurve(noPower)).toEqual([]);
  });

  it('honours a caller-supplied duration list, sorted', () => {
    const curve = powerDurationCurve(steady(200, 100), [60, 5, 30]);
    expect(curve.map((effort) => effort.duration)).toEqual([5, 30, 60]);
  });
});

describe('mergeCurves — the library curve, and why it is incrementally updatable', () => {
  it('takes the best of each duration across activities', () => {
    const sprinter = powerDurationCurve([...steady(600, 30), ...steady(100, 3600)]);
    const rouleur = powerDurationCurve(steady(280, 3600));

    const library = mergeCurves(sprinter, rouleur);

    // The sprint is the sprinter's; the long effort is the rouleur's.
    expect(effortAt(library, 30)).toBe(600);
    expect(effortAt(library, 1800)).toBe(280);
  });

  it('adding one activity equals recomputing the whole library', () => {
    // #75's criterion, and the bug it names: the incremental and full results
    // "diverging is a silent correctness bug that surfaces months later".
    //
    // It holds here as a property rather than a coincidence — the library
    // curve is a pointwise maximum, which is associative and commutative — so
    // this test is a check on the implementation of an argument, not evidence
    // for the argument itself.
    const rides = [
      powerDurationCurve([...steady(500, 20), ...steady(150, 2000)]),
      powerDurationCurve(steady(260, 3600)),
      powerDurationCurve([...steady(320, 900), undefined, ...steady(200, 900)]),
    ];

    const full = mergeCurves(...rides);
    const incremental = rides.reduce<ReturnType<typeof mergeCurves>>(
      (soFar, ride) => mergeCurves(soFar, ride),
      [],
    );

    expect(incremental).toEqual(full);
  });

  it('is unchanged by adding a ride with no power', () => {
    // The mixed-library case #75 asks for, stated as an equality rather than
    // as "roughly the same".
    const withPower = powerDurationCurve(steady(240, 3600));
    const noPower = powerDurationCurve(Array.from<undefined>({ length: 3600 }).fill(undefined));

    expect(mergeCurves(withPower, noPower)).toEqual(withPower);
  });

  it('merging nothing is empty, and merging one curve is that curve', () => {
    expect(mergeCurves()).toEqual([]);
    const one = powerDurationCurve(steady(200, 100));
    expect(mergeCurves(one)).toEqual(one);
  });

  it('does not let a window span two rides', () => {
    // The failure the pointwise-maximum shape rules out by construction. Two
    // twenty-minute rides at 300 W do not make a forty-minute effort at 300 W;
    // concatenating their samples before computing would say they do.
    const first = powerDurationCurve(steady(300, 1200));
    const second = powerDurationCurve(steady(300, 1200));

    expect(effortAt(mergeCurves(first, second), 1800)).toBeUndefined();
  });
});

describe('powerDurationCurve — the stated time budget', () => {
  /**
   * #75: *"a test asserts a 4-hour 1 Hz activity is processed within a stated
   * time budget on a stated machine. An analysis feature that takes ninety
   * seconds is one nobody opens twice."*
   *
   * ⚠️ **The budget is the runner's timeout, not a clock this package reads.**
   * The first version of this test called `performance.now()` and the
   * platform-isolation closure rejected it — `packages/domain` compiles with
   * `lib: ["ES2024"]` and `types: []`, so `performance` is simply not a name
   * that exists here (CLAUDE.md §4d). That is the rule working, and the
   * replacement is better than what it rejected: Vitest fails the test if it
   * exceeds the timeout, so the budget is enforced by the harness while the
   * code under test still cannot tell the time.
   *
   * **Two seconds for the whole curve over a four-hour ride**, measured at
   * roughly 15 ms in this container. The headroom is deliberate — a wall-clock
   * assertion tuned close to the observed value is a flake on a loaded runner
   * (the lesson #165 recorded) — and what the number really pins is the
   * COMPLEXITY. The rolling sum is O(n) per duration; the naive form that
   * recomputes each window's mean is O(n·d), which for the 7200 s duration
   * alone is about 10^8 additions and takes minutes rather than milliseconds.
   * This fails by orders of magnitude if that regression is ever made, which
   * is the only way a timing test is worth having.
   */
  it('processes a four-hour 1 Hz activity across the whole curve', { timeout: 2000 }, () => {
    const fourHours = steady(220, 4 * 3600);

    const curve = powerDurationCurve(fourHours);

    // Every duration in the list is inside four hours, so all of them are
    // achieved — which also says the loop really did run over all of them
    // rather than exiting early.
    expect(curve).toHaveLength(CURVE_DURATIONS.length);
    expect(effortAt(curve, 7200)).toBe(220);
  });
});
