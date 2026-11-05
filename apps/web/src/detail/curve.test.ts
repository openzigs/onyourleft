// SPDX-License-Identifier: AGPL-3.0-or-later

import { seconds, watts, type PowerDurationCurve } from '@onyourleft/domain';
import { describe, expect, it } from 'vitest';

import {
  curveRows,
  describeCurve,
  NO_EFFORT,
  onRideDurations,
  RIDE_CURVE_DURATIONS,
  ridePowerCurve,
} from './curve';

const curve = (entries: readonly (readonly [number, number])[]): PowerDurationCurve =>
  entries.map(([duration, power]) => ({ duration: seconds(duration), power: watts(power) }));

describe('the ride’s power curve — #2081', () => {
  it('spans five seconds to an hour, shortest first', () => {
    expect(RIDE_CURVE_DURATIONS[0]).toBe(5);
    expect(RIDE_CURVE_DURATIONS.at(-1)).toBe(3600);
    expect([...RIDE_CURVE_DURATIONS].sort((a, b) => a - b)).toStrictEqual(RIDE_CURVE_DURATIONS);
    expect(RIDE_CURVE_DURATIONS).not.toContain(1);
    expect(RIDE_CURVE_DURATIONS).not.toContain(5400);
  });

  it('holds the best average over each duration the ride is long enough for', () => {
    // A minute at 400 W, then nine at 200 W.
    const samples = [
      ...Array.from({ length: 60 }, () => watts(400)),
      ...Array.from({ length: 540 }, () => watts(200)),
    ];
    const ride = ridePowerCurve(samples);
    expect(ride.map((effort) => effort.duration)).toStrictEqual([
      5, 10, 15, 30, 60, 120, 180, 300, 480, 600,
    ]);
    expect(ride.find((effort) => effort.duration === 60)?.power).toBe(400);
    expect(ride.find((effort) => effort.duration === 600)?.power).toBe(220);
  });

  it('cuts a library curve to the same durations', () => {
    const library = curve([
      [1, 900],
      [5, 800],
      [3600, 250],
      [7200, 200],
    ]);
    expect(onRideDurations(library).map((effort) => effort.duration)).toStrictEqual([5, 3600]);
  });
});

describe('the curve’s table — #2081', () => {
  const ride = curve([
    [5, 812.4],
    [60, 401],
  ]);
  const allTime = curve([
    [5, 900],
    [60, 410],
    [300, 330],
  ]);

  it('lists every duration either curve has, labelled as Analysis’ bests table labels them', () => {
    expect(curveRows(ride, allTime)).toStrictEqual([
      ['5s', '812', '900'],
      ['1min', '401', '410'],
      ['5min', NO_EFFORT, '330'],
    ]);
  });

  it('has no all-time column with no all-time curve', () => {
    expect(curveRows(ride, undefined)).toStrictEqual([
      ['5s', '812'],
      ['1min', '401'],
    ]);
  });
});

describe('the curve in words — #2081', () => {
  it('names the sprint, the minute and where the ride’s curve stops, then the all-time best', () => {
    expect(
      describeCurve(
        curve([
          [5, 800],
          [60, 400],
          [300, 300],
        ]),
        curve([
          [5, 900],
          [3600, 250],
        ]),
      ),
    ).toBe(
      "Power curve. This ride's best: 5s 800 W, 1min 400 W, 5min 300 W. The ride's curve stops at 5min. All-time best: 5s 900 W, 1h 250 W.",
    );
  });

  it('says a ride with no measurable stretch has none, rather than describing nothing', () => {
    expect(describeCurve([], undefined)).toBe(
      'Power curve: this ride has no stretch of power long enough to measure.',
    );
  });
});
