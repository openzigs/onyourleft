// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The ride's running totals — #2076. That the saved ride and the HUD read them
 * from one place is `ride/controller.test.ts` §"#2076"; this is the rule.
 */

import { describe, expect, it } from 'vitest';

import {
  altitudeMetres,
  beatsPerMinute,
  createRecordingSession,
  kilograms,
  metres,
  metresPerSecond,
  powerZones,
  recordedAscent,
  rideCalories,
  seconds,
  timeInZones,
  unixSeconds,
  watts,
  type CalorieRider,
  type ChannelReading,
  type RecordedSeries,
  type RecordingSession,
  type UnixSeconds,
} from '@onyourleft/domain';
import type { RecordedCourseLap, StreamChannelValue } from '@onyourleft/store';

import {
  rideAveragePower,
  rideAverageSpeed,
  rideClimbed,
  rideDistance,
  rideEnergy,
  rideTotals,
  recordedRideCalories,
  RunningPowerZoneTime,
  RunningRideTotals,
  type RunningSource,
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
      recordedHeartRate: false,
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

  it('says whether the recording has heart rate, from the series and not a live strap', () => {
    expect(rideTotals(strap, []).recordedHeartRate).toBe(true);
    // A strap that dropped after one reading still recorded heart rate.
    expect(
      rideTotals(series({ heartRate: [beatsPerMinute(140), undefined, undefined] }, 3), [])
        .recordedHeartRate,
    ).toBe(true);
    expect(rideTotals(series({ heartRate: [undefined, undefined] }, 2), []).recordedHeartRate).toBe(
      false,
    );
    expect(rideTotals(series({ power: [watts(200)] }, 1), []).recordedHeartRate).toBe(false);
  });

  it('walks the power channel once a recompute, for the average, the work and the estimate', () => {
    let walks = 0;
    const readings = [watts(200), undefined, watts(300)];
    const power = new Proxy(readings, {
      get(target, key, receiver) {
        if (key === Symbol.iterator) walks += 1;
        return Reflect.get(target, key, receiver) as unknown;
      },
    });
    const totals = rideTotals(series({ power }, 3), []);
    expect(walks).toBe(1);
    // And the figures are the ones each function works out on its own.
    const plain = series({ power: readings }, 3);
    expect(totals.averagePower).toBe(rideAveragePower(readings));
    expect(totals.energy).toBe(rideEnergy(plain));
    expect(totals.calories).toEqual(recordedRideCalories(plain, {}));
  });
});

describe('#2283 — the ride so far, folded as the recording grows', () => {
  const START = 1_800_000_000;
  const RIDER = { sex: 'female', ageYears: 37, mass: kilograms(61) } as const;
  const THRESHOLD = watts(230);
  const HOURS_3 = 3 * 60 * 60;

  /** A deterministic stand-in for a rider's readings: the same ride every run. */
  const prng = (seed: number) => {
    let state = seed;
    return (): number => {
      state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
      return state / 2_147_483_648;
    };
  };

  /** A session as the recorder makes one, and a source that counts the slots it hands out. */
  const recording = () => {
    const session = createRecordingSession<StreamChannelValue>({
      id: 'ride-2283',
      sampleInterval: seconds(1),
      lateToleranceSeconds: 2,
    });
    session.start(unixSeconds(START));
    let sliced = 0;
    const source: RunningSource = {
      get sampleCount() {
        return session.sampleCount;
      },
      get sealedCount() {
        return session.sealedCount;
      },
      slice(from, to) {
        const slice = session.slice(from, to);
        sliced += slice.sampleCount;
        return slice;
      },
    };
    return { session, source, sliced: () => sliced };
  };

  type Channel = 'power' | 'speed' | 'heartRate' | 'altitude';

  /**
   * Rides `secondsLong`: a reading of each of `channels` most seconds, at an
   * odd instant within it, and every seventh second a second power reading
   * into a slot the last answer already counted, which is not sealed yet and
   * so takes it. `each` is called after every second, and again after that
   * reading, as the HUD asks.
   */
  const ride = (
    session: RecordingSession<StreamChannelValue>,
    secondsLong: number,
    channels: readonly Channel[],
    each: (second: number) => void,
  ): void => {
    const random = prng(2283);
    let altitude = 120;
    const reading = (channel: Channel, at: UnixSeconds): ChannelReading<StreamChannelValue> => {
      switch (channel) {
        case 'power':
          return { channel, value: watts(150 + Math.round(random() * 220)), at };
        case 'speed':
          return { channel, value: metresPerSecond(6 + random() * 7.3), at };
        case 'heartRate':
          return { channel, value: beatsPerMinute(105 + Math.round(random() * 60)), at };
        case 'altitude':
          return { channel, value: altitudeMetres(altitude), at };
      }
    };
    for (let second = 0; second < secondsLong; second += 1) {
      const at = unixSeconds(START + second + 0.1 + random() * 0.8);
      // A long climb and descent, with noise inside the run rule's threshold.
      altitude += Math.sin(second / 900) * 0.4 + (random() - 0.5) * 0.6;
      for (const channel of channels) {
        // A dropout now and then: a slot with nothing in it.
        if (random() < 0.03) continue;
        session.observe(reading(channel, at));
      }
      session.advanceTo(unixSeconds(START + second + 1));
      each(second);
      if (second % 7 === 3 && channels.includes('power')) {
        expect(
          session.observe({
            channel: 'power',
            value: watts(400),
            at: unixSeconds(START + second + 0.95),
          }),
        ).toBe('recorded');
        each(second);
      }
    }
  };

  /** The answers over the whole series, as the HUD worked them out before #2283. */
  const batch = (
    session: RecordingSession<StreamChannelValue>,
    laps: readonly Pick<RecordedCourseLap, 'ascent'>[],
    rider: CalorieRider,
  ) => {
    const whole = session.series();
    return {
      totals: rideTotals(whole, laps, rider),
      zones: timeInZones(powerZones(THRESHOLD), whole.channels.power ?? [], whole.sampleInterval),
    };
  };

  it('gives a three-hour ride’s totals and time in zones exactly as the whole series does', () => {
    const { session, source, sliced } = recording();
    const totals = new RunningRideTotals(source, seconds(1), RIDER);
    const zones = new RunningPowerZoneTime(source, powerZones(THRESHOLD), seconds(1));
    let asked = 0;
    let compared = 0;
    ride(session, HOURS_3, ['power', 'speed', 'heartRate', 'altitude'], (second) => {
      asked += 1;
      const running = { totals: totals.totals([]), zones: zones.time() };
      // Every answer is folded. The whole series is copied to check it for the
      // first ten minutes and every 61st second after, which keeps this test
      // from being the cost it removes.
      if (second < 600 || second % 61 === 0) {
        expect(running, `at ${String(second)} s`).toStrictEqual(batch(session, [], RIDER));
        compared += 1;
      }
    });
    session.stop(unixSeconds(START + HOURS_3 + 5));
    const atTheEnd = { totals: totals.totals([]), zones: zones.time() };
    expect(atTheEnd).toStrictEqual(batch(session, [], RIDER));
    // Non-vacuity: every figure is one, and the ride climbed.
    expect(atTheEnd.totals.distance).toBeGreaterThan(50_000);
    expect(atTheEnd.totals.climbed).toBeGreaterThan(100);
    expect(atTheEnd.totals.averagePower).toBeGreaterThan(150);
    expect(atTheEnd.totals.calories?.basis).toBe('power');
    expect(atTheEnd.zones.covered).toBeGreaterThan(HOURS_3 * 0.9);
    expect(compared).toBeGreaterThan(700);
    // What it cost: each sealed slot is handed out once to be held, and only
    // the few still open again on each call, for each of the two folds.
    // Copying the whole ride on each call, as before, is about
    // HOURS_3 × asked slots: some seventy million.
    expect(sliced()).toBeLessThan(2 * (HOURS_3 + 4 * asked));
  });

  it('estimates a ride with heart rate and no power from the heart rate, as the whole series does', () => {
    const { session, source } = recording();
    const totals = new RunningRideTotals(source, seconds(1), RIDER);
    const unknown = new RunningRideTotals(source, seconds(1));
    ride(session, 1_200, ['heartRate', 'speed'], () => {
      expect(totals.totals([])).toStrictEqual(batch(session, [], RIDER).totals);
      expect(unknown.totals([])).toStrictEqual(batch(session, [], {}).totals);
    });
    const atTheEnd = totals.totals([]);
    expect(atTheEnd.calories?.basis).toBe('heart-rate');
    expect(atTheEnd.calories?.energy).toBeGreaterThan(0);
    expect(atTheEnd.recordedHeartRate).toBe(true);
    // And none without a rider to estimate it for.
    expect(unknown.totals([]).calories).toBeUndefined();
  });

  it('climbs what the laps state on a ride with no altitude, and nothing before any reading', () => {
    const { session, source } = recording();
    const totals = new RunningRideTotals(source, seconds(1));
    expect(totals.totals([])).toStrictEqual(batch(session, [], {}).totals);
    const laps = [{ ascent: metres(14) }, { ascent: undefined }, { ascent: metres(4) }];
    ride(session, 90, ['power', 'speed'], () => {
      expect(totals.totals(laps)).toStrictEqual(batch(session, laps, {}).totals);
    });
    expect(totals.totals(laps).climbed).toBe(18);
  });
});
