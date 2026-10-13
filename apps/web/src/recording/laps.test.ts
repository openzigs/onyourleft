// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  beatsPerMinute,
  metres,
  revolutionsPerMinute,
  seconds,
  unixSeconds,
  watts,
} from '@onyourleft/domain';
import { activityId, lapId } from '@onyourleft/store';
import { describe, expect, it } from 'vitest';

import {
  bestLapIndex,
  courseLap,
  lapAverageSpeed,
  lapsToSave,
  type LapFigures,
  type LapSeries,
} from './laps';

const START = 1_700_000_000;

/** Ten seconds of ride at 1 Hz: power climbs 100..190, the strap joins at slot 4. */
const SERIES: LapSeries = {
  startedAt: unixSeconds(START),
  sampleInterval: seconds(1),
  sampleCount: 10,
  channels: {
    power: [100, 110, 120, 130, 140, 150, 160, 170, 180, 190].map(watts),
    heartRate: [undefined, undefined, undefined, undefined, 140, 142, 150, 152, 160, 161].map(
      (value) => (value === undefined ? undefined : beatsPerMinute(value)),
    ),
    cadence: [80, 80, 80, 80, 90, 90, 90, 90, 0, 0].map(revolutionsPerMinute),
  },
};

const mark = (offset: number, moving: number) => ({
  at: unixSeconds(START + offset),
  movingTime: seconds(moving),
});

const WHOLE = { distance: metres(1_000), ascent: metres(12), partial: false };

describe('courseLap — #1312', () => {
  it('states the lap from the samples between its two crossings and nothing outside them', () => {
    const lap = courseLap(SERIES, mark(4, 4), mark(8, 8), WHOLE);

    expect(lap).toEqual({
      startedAt: unixSeconds(START + 4),
      elapsedTime: seconds(4),
      movingTime: seconds(4),
      distance: metres(1_000),
      // Slots 4..7: 140, 150, 160, 170.
      averagePower: watts(155),
      maxPower: watts(170),
      averageHeartRate: beatsPerMinute(146),
      maxHeartRate: beatsPerMinute(152),
      averageCadence: revolutionsPerMinute(90),
      ascent: metres(12),
    });
  });

  it('two laps in a row share no sample and leave none out', () => {
    const first = courseLap(SERIES, mark(0, 0), mark(4, 4), WHOLE);
    const second = courseLap(SERIES, mark(4, 4), mark(10, 10), WHOLE);

    // 100..130, then 140..190: every sample is in exactly one of them.
    expect(first.averagePower).toBe(watts(115));
    expect(first.maxPower).toBe(watts(130));
    expect(second.averagePower).toBe(watts(165));
    expect(second.maxPower).toBe(watts(190));
  });

  it('a pause inside a lap is in its elapsed time and not in its moving time', () => {
    // Six seconds on the clock, of which the recorder counted four.
    const lap = courseLap(SERIES, mark(2, 2), mark(8, 6), WHOLE);

    expect(lap.elapsedTime).toBe(seconds(6));
    expect(lap.movingTime).toBe(seconds(4));
  });

  it('averages over the readings that exist: a channel with a gap is not averaged with noughts', () => {
    // Slots 2..5: the strap reports only at 4 and 5.
    const lap = courseLap(SERIES, mark(2, 2), mark(6, 6), WHOLE);

    expect(lap.averageHeartRate).toBe(beatsPerMinute(141));
  });

  it('states no figure for a channel with no reading in the lap, rather than a nought', () => {
    const lap = courseLap(SERIES, mark(0, 0), mark(4, 4), WHOLE);

    expect(lap).not.toHaveProperty('averageHeartRate');
    expect(lap).not.toHaveProperty('maxHeartRate');
    expect(lap.averagePower).toBe(watts(115));
  });

  it('states no figure for a channel the ride never had', () => {
    const lap = courseLap({ ...SERIES, channels: {} }, mark(0, 0), mark(4, 4), WHOLE);

    expect(lap).not.toHaveProperty('averagePower');
    expect(lap).not.toHaveProperty('maxPower');
    expect(lap).not.toHaveProperty('averageCadence');
  });

  it('marks a part lap, carries how far it got, and leaves a whole lap unmarked', () => {
    const part = courseLap(SERIES, mark(4, 4), mark(8, 8), {
      distance: metres(350),
      ascent: undefined,
      partial: true,
    });

    expect(part.partial).toBe(true);
    expect(part.distance).toBe(metres(350));
    expect(part).not.toHaveProperty('ascent');
    expect(courseLap(SERIES, mark(4, 4), mark(8, 8), WHOLE)).not.toHaveProperty('partial');
  });

  it('a crossing before the recording began or after its last sample reads what there is', () => {
    const lap = courseLap(SERIES, mark(-5, 0), mark(30, 10), WHOLE);

    expect(lap.averagePower).toBe(watts(145));
    expect(lap.maxPower).toBe(watts(190));
  });
});

const timed = (distance: number, moving: number, partial = false): LapFigures => ({
  startedAt: unixSeconds(START),
  elapsedTime: seconds(moving),
  movingTime: seconds(moving),
  distance: metres(distance),
  ...(partial ? { partial: true as const } : {}),
});

describe('lapAverageSpeed — #1312', () => {
  it('is the distance over the MOVING time', () => {
    const paused: LapFigures = { ...timed(1_000, 100), elapsedTime: seconds(400) };
    expect(lapAverageSpeed(paused)).toBe(10);
  });

  it('is nothing for a lap with no moving time', () => {
    expect(lapAverageSpeed(timed(1_000, 0))).toBeUndefined();
  });
});

describe('bestLapIndex — #1312', () => {
  it('is the fastest whole lap', () => {
    expect(bestLapIndex([timed(1_000, 120), timed(1_000, 100), timed(1_000, 110)])).toBe(1);
  });

  it('never a part lap, however quick it reads', () => {
    expect(bestLapIndex([timed(1_000, 120), timed(1_000, 110), timed(990, 10, true)])).toBe(1);
  });

  it('is the earlier lap on a tie', () => {
    expect(bestLapIndex([timed(1_000, 100), timed(1_000, 100)])).toBe(0);
  });

  it('says nothing with fewer than two whole laps', () => {
    expect(bestLapIndex([])).toBeUndefined();
    expect(bestLapIndex([timed(1_000, 100)])).toBeUndefined();
    expect(bestLapIndex([timed(1_000, 100), timed(400, 30, true)])).toBeUndefined();
  });
});

describe('lapsToSave — #1312', () => {
  const ride = activityId('ride-1');
  const ids = (): (() => ReturnType<typeof lapId>) => {
    let next = 0;
    return () => lapId(`lap-${String((next += 1))}`);
  };

  it('numbers the laps in the order they were ridden, under the ride', () => {
    const rows = lapsToSave(
      [timed(1_000, 100), timed(1_000, 90), timed(300, 40, true)],
      ride,
      ids(),
    );

    expect(rows.map((row) => [row.id, row.ordinal, row.activityId, row.partial])).toEqual([
      ['lap-1', 0, ride, undefined],
      ['lap-2', 1, ride, undefined],
      ['lap-3', 2, ride, true],
    ]);
    expect(rows[1]?.movingTime).toBe(seconds(90));
  });

  it('writes nothing for a ride that never completed the course', () => {
    expect(lapsToSave([timed(300, 40, true)], ride, ids())).toEqual([]);
    expect(lapsToSave([], ride, ids())).toEqual([]);
  });
});
