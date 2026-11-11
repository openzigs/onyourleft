// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #2387's first criterion, as data: each figure on the totals strip is the
 * one the HUD computes today, in the rider's units. The rendering half — that
 * the strip draws these, and only where it is chosen — is
 * `HudPanel.test.tsx` §"#2387".
 */

import { describe, expect, it } from 'vitest';

import {
  altitudeMetres,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  joules,
  kilocalories,
  metres,
  metresPerSecond,
  routeProfile,
  watts,
  type RoutePoint,
} from '@onyourleft/domain';

import { rideAverageSpeed, type RideTotals } from '../../recording/totals';
import { formatSpeed } from '../../units/format';
import { atStartLine } from '../simulation';

import { NO_READING, hudReadings, profileReading, type HudInput } from './fields';
import { totalsStripReadings } from './totals-strip';

/** The strip's keys, in their order. */
const KEYS = [
  'totals-lap',
  'totals-route',
  'totals-remaining',
  'totals-average-speed',
  'totals-energy',
  'totals-calories',
  'totals-climbed',
];

/**
 * A straight 2 km of 201 points climbing 0.4 m a step — or, as a loop, 1 km
 * out and the same 1 km back, so its two ends meet.
 */
function road(loop = false): ReturnType<typeof routeProfile> {
  const points: RoutePoint[] = [];
  const count = 200;
  for (let index = 0; index <= count; index += 1) {
    // A loop's last point is its first, so its two ends meet.
    const step = loop && index > count / 2 ? count - index : index;
    points.push({
      position: geographicPosition(
        degreesLatitude(51.5 + (step * 10) / 111_320),
        degreesLongitude(-0.12),
      ),
      elevation: altitudeMetres(step * 0.4),
    });
  }
  return routeProfile(points, { loop });
}

const TOTALS: RideTotals = {
  distance: metres(12_345),
  climbed: metres(212.6),
  averagePower: watts(187),
  energy: joules(612_400),
  calories: { energy: kilocalories(731.8), basis: 'power' },
};

function input(overrides: Partial<HudInput> = {}, loop = false): HudInput {
  const profile = road(loop);
  const state = atStartLine(profile);
  return {
    profile,
    state: { ...state, ride: { speed: metresPerSecond(8), distance: metres(2_500) } },
    cadence: { value: 88, live: true },
    heartRate: { value: 152, live: true },
    rideTotals: TOTALS,
    movingSeconds: 1_800,
    ...overrides,
  };
}

function strip(hud: HudInput) {
  return totalsStripReadings(hud, hudReadings(hud));
}

function value(hud: HudInput, key: string): readonly [string, string] {
  const found = strip(hud).find((each) => each.key === key);
  if (found === undefined) throw new Error(`no ${key} on the strip`);
  return [found.value, found.unit];
}

describe('the totals strip — #2387', () => {
  it('holds the seven in a fixed order on a loop, and leaves the lap out on a road that is not one', () => {
    expect(strip(input({}, true)).map((each) => each.key)).toEqual(KEYS);
    expect(strip(input()).map((each) => each.key)).toEqual(KEYS.slice(1));
    expect(strip(input({}, true)).map((each) => each.label)).toEqual([
      'Lap',
      'Route',
      'To go',
      'Avg speed',
      'Energy',
      'Calories',
      'Climbed',
    ]);
    // #2434: the order holds with nothing to estimate from — a dash, not a gap.
    expect(strip(input({ rideTotals: undefined }, true)).map((each) => each.key)).toEqual(KEYS);
  });

  it('says the lap the elevation strip’s sentence names', () => {
    const hud = input({}, true);
    const lap = value(hud, 'totals-lap')[0];
    // The loop is 2 km out and back; 2.5 km ridden is its second lap.
    expect(lap).toBe('2');
    expect(profileReading(hud.state, hud.profile).text).toContain(`of lap ${lap}`);
  });

  it('shows To go and Climbed exactly as the HUD’s own fields do, in either unit', () => {
    for (const units of ['metric', 'imperial'] as const) {
      const hud = input({ units }, true);
      const readings = hudReadings(hud);
      const of = (key: string) => readings.find((each) => each.key === key);
      for (const [mine, theirs] of [
        ['totals-remaining', 'remaining'],
        ['totals-climbed', 'climbed'],
      ] as const) {
        const field = of(theirs);
        expect(field, theirs).toBeDefined();
        expect(value(hud, mine), `${units} ${mine}`).toEqual([field?.value, field?.unit]);
      }
    }
  });

  it('states the route’s own length in the rider’s distance unit', () => {
    const length = (input().profile.totalDistance as number) / 1000;
    expect(value(input(), 'totals-route')).toEqual([length.toFixed(1), 'km']);
    expect(value(input({ units: 'imperial' }), 'totals-route')).toEqual([
      (length / 1.609344).toFixed(1),
      'mi',
    ]);
  });

  it('works the average speed out of the HUD’s Distance over its Moving, in the rider’s unit', () => {
    // 12 345 m in 1 800 s is 6.858 m/s: 24.7 km/h and 15.3 mph.
    expect(value(input(), 'totals-average-speed')).toEqual(['24.7', 'km/h']);
    expect(value(input({ units: 'imperial' }), 'totals-average-speed')).toEqual(['15.3', 'mph']);
    const speed = rideAverageSpeed(TOTALS.distance, 1_800);
    expect(speed).toBeDefined();
    if (speed !== undefined) {
      expect(value(input(), 'totals-average-speed')[0]).toBe(formatSpeed(speed, 'metric').value);
    }
  });

  it('shows the recorder’s work in whole kilojoules, under no load metric’s name', () => {
    expect(value(input(), 'totals-energy')).toEqual(['612', 'kJ']);
    for (const reading of strip(input({}, true))) {
      expect(reading.label).not.toMatch(/\b(NP|TSS|IF|CTL|ATL|TSB)\b/);
      expect(reading.stale).toBe(false);
    }
  });

  it('#2434: shows the calorie estimate as the result card does — ≈, whole kcal, and its basis', () => {
    expect(value(input(), 'totals-calories')).toEqual(['≈ 732', 'kcal']);
    const found = (hud: HudInput) => strip(hud).find((each) => each.key === 'totals-calories');
    expect(found(input())?.detail).toBe('estimate from power');
    const strap = input({
      rideTotals: { ...TOTALS, calories: { energy: kilocalories(402.4), basis: 'heart-rate' } },
    });
    expect(value(strap, 'totals-calories')).toEqual(['≈ 402', 'kcal']);
    expect(found(strap)?.detail).toBe('estimate from heart rate');
  });

  it('#2434: never says Sensor lost for the estimate, whatever the sensors are doing', () => {
    const dropped = input({
      heartRate: { value: undefined, live: false },
      cadence: { value: undefined, live: false },
    });
    for (const hud of [dropped, input({ rideTotals: undefined })]) {
      const calories = strip(hud).find((each) => each.key === 'totals-calories');
      expect(calories?.stale).toBe(false);
    }
  });

  it('shows a dash, never a zero, for each figure nothing recorded', () => {
    const bare = input({ rideTotals: undefined, movingSeconds: undefined });
    expect(value(bare, 'totals-average-speed')[0]).toBe(NO_READING);
    expect(value(bare, 'totals-energy')[0]).toBe(NO_READING);
    expect(value(bare, 'totals-calories')).toEqual([NO_READING, 'kcal']);
    // #2434: and the result card's reason for the dash, on the basis' line.
    const reason = (hud: HudInput) =>
      strip(hud).find((each) => each.key === 'totals-calories')?.detail;
    expect(reason(bare)).toBe('set your details in Settings');
    expect(reason({ ...bare, heartRate: { value: undefined, live: false } })).toBe(
      'no power or heart rate',
    );
    expect(value(bare, 'totals-climbed')[0]).toBe(NO_READING);
    // No moving time yet, and no power reading: dashes too.
    expect(value(input({ movingSeconds: 0 }), 'totals-average-speed')[0]).toBe(NO_READING);
    expect(value(input({ rideTotals: { ...TOTALS, energy: undefined } }), 'totals-energy')[0]).toBe(
      NO_READING,
    );
    // #2434: a ride with neither power nor a heart-rate estimate has no figure.
    expect(
      value(input({ rideTotals: { ...TOTALS, calories: undefined } }), 'totals-calories')[0],
    ).toBe(NO_READING);
    // The route and the distance to go are the course's, never the recorder's.
    expect(value(bare, 'totals-route')[0]).not.toBe(NO_READING);
    expect(value(bare, 'totals-remaining')[0]).not.toBe(NO_READING);
  });
});
