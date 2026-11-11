// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The ride's running totals — #2076. That the saved ride and the HUD read them
 * from one place is `ride/controller.test.ts` §"#2076"; this is the rule.
 */

import { describe, expect, it } from 'vitest';

import {
  altitudeMetres,
  beatsPerMinute,
  kilograms,
  metres,
  metresPerSecond,
  recordedAscent,
  rideCalories,
  seconds,
  unixSeconds,
  watts,
  type RecordedSeries,
} from '@onyourleft/domain';
import type { StreamChannelValue } from '@onyourleft/store';

import {
  rideAveragePower,
  rideAverageSpeed,
  rideClimbed,
  rideDistance,
  rideEnergy,
  rideTotals,
  recordedRideCalories,
} from './totals';

function series(
  channels: RecordedSeries<StreamChannelValue>['channels'],
  sampleCount: number,
): RecordedSeries<StreamChannelValue> {
  return {
    startedAt: unixSeconds(1_800_000_000),
    sampleInterval: seconds(1),
    sampleCount,
    channels,
    pauses: [],
  };
}

describe('the ride so far (#2076)', () => {
  it('integrates the speed it has, and adds nothing for a dropout', () => {
    const ridden = series({ speed: [metresPerSecond(10), undefined, metresPerSecond(8)] }, 3);
    expect(rideDistance(ridden)).toBe(18);
    expect(rideDistance(series({}, 3))).toBe(0);
  });

  it('averages the power readings that exist, rounded, and has none with none', () => {
    expect(rideAveragePower([watts(200), undefined, watts(251)])).toBe(226);
    expect(rideAveragePower([undefined, undefined])).toBeUndefined();
    expect(rideAveragePower(undefined)).toBeUndefined();
  });

  it('climbs what the altitude readings climbed, by the saved ride’s own rule', () => {
    const altitude = [100, 104, 112, 109, 130, undefined, 131].map((each) =>
      each === undefined ? undefined : altitudeMetres(each),
    );
    const ridden = series({ altitude }, altitude.length);
    expect(rideClimbed(ridden, [{ ascent: metres(999) }])).toBe(recordedAscent(altitude));
  });

  it('with no altitude, climbs what its laps state, the lap in progress included', () => {
    const indoor = series({ power: [watts(200)] }, 1);
    expect(
      rideClimbed(indoor, [{ ascent: metres(14) }, { ascent: undefined }, { ascent: metres(4) }]),
    ).toBe(18);
  });

  it('climbs nothing anybody measured as undefined, never as nought', () => {
    const indoor = series({ power: [watts(200)] }, 1);
    expect(rideClimbed(indoor, [])).toBeUndefined();
    expect(rideClimbed(indoor, [{ ascent: undefined }])).toBeUndefined();
  });

  it('#2387: adds the work of each power reading that exists, for its sample’s length', () => {
    const ridden: RecordedSeries<StreamChannelValue> = {
      ...series({ power: [watts(200), undefined, watts(300)] }, 3),
      sampleInterval: seconds(2),
    };
    // 200 W for 2 s and 300 W for 2 s; the dropout adds nothing.
    expect(rideEnergy(ridden)).toBe(1000);
  });

  it('#2387: has no energy with no power reading, never nought', () => {
    expect(rideEnergy(series({}, 3))).toBeUndefined();
    expect(rideEnergy(series({ power: [undefined, undefined] }, 2))).toBeUndefined();
    // A rider who stopped pedalling did do nought: that is a reading.
    expect(rideEnergy(series({ power: [watts(0)] }, 1))).toBe(0);
  });

  it('#2387: the average speed is the distance over the moving time, and none with none', () => {
    expect(rideAverageSpeed(metres(9000), 1800)).toBe(5);
    expect(rideAverageSpeed(metres(9000), 0)).toBeUndefined();
    expect(rideAverageSpeed(metres(9000), Number.NaN)).toBeUndefined();
  });

  it('puts them together', () => {
    const ridden = series(
      { speed: [metresPerSecond(5), metresPerSecond(5)], power: [watts(150), watts(250)] },
      2,
    );
    expect(rideTotals(ridden, [{ ascent: metres(3) }])).toEqual({
      distance: 10,
      climbed: 3,
      averagePower: 200,
      energy: 400,
      // #2434: 400 J of work at the assumed 20 % efficiency.
      calories: { energy: 400 / 4184 / 0.2, basis: 'power' },
    });
  });
});

describe('the ride’s calorie estimate so far (#2434)', () => {
  const RIDER = { sex: 'male', ageYears: 40, mass: kilograms(80) } as const;
  const strap = series(
    { heartRate: [beatsPerMinute(140), undefined, beatsPerMinute(150), beatsPerMinute(160)] },
    4,
  );

  it('is the saved ride’s function: the domain’s estimate over the series’ work and heart rate', () => {
    const ridden = series({ power: [watts(200), undefined, watts(300)] }, 3);
    expect(recordedRideCalories(ridden, {})).toEqual(
      rideCalories({
        work: rideEnergy(ridden),
        heartRate: undefined,
        sampleInterval: 1,
        rider: {},
      }),
    );
    expect(rideTotals(ridden, []).calories).toEqual(recordedRideCalories(ridden, {}));
    expect(rideTotals(ridden, []).calories?.basis).toBe('power');
  });

  it('estimates a heart-rate ride with the rider it is given, and none without one', () => {
    const withRider = rideTotals(strap, [], RIDER).calories;
    expect(withRider?.basis).toBe('heart-rate');
    expect(withRider).toEqual(recordedRideCalories(strap, RIDER));
    expect(withRider?.energy).toBeGreaterThan(0);
    // No rider is no figure, never nought.
    expect(rideTotals(strap, []).calories).toBeUndefined();
    expect(rideTotals(strap, [], { sex: 'male', ageYears: 40 }).calories).toBeUndefined();
  });

  it('has none with neither power nor heart rate', () => {
    const bare = series({ speed: [metresPerSecond(5)] }, 1);
    expect(rideTotals(bare, [], RIDER).calories).toBeUndefined();
    expect(rideTotals(series({ power: [undefined, undefined] }, 2), []).calories).toBeUndefined();
  });

  it('rises with the work: 600 s at 200 W is 120 kJ, about 143 kcal at the assumed 20 %', () => {
    const at = (count: number) =>
      rideTotals(series({ power: Array.from({ length: count }, () => watts(200)) }, count), [])
        .calories?.energy;
    expect(at(600)).toBeCloseTo(120_000 / 4184 / 0.2, 6);
    expect(Math.round(at(600) ?? Number.NaN)).toBe(143);
    expect(at(300) ?? 0).toBeLessThan(at(600) ?? 0);
  });
});
