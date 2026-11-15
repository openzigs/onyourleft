// SPDX-License-Identifier: Apache-2.0

/**
 * #2431's calorie estimator, read through the package barrel as a consumer
 * reaches it (see `quantities.test.ts`'s header).
 */

import { describe, expect, it } from 'vitest';

import type { BeatsPerMinute, CalorieRider } from '../index';
import {
  ASSUMED_GROSS_EFFICIENCY,
  beatsPerMinute,
  caloriesFromHeartRate,
  caloriesFromWork,
  joules,
  JOULES_PER_KILOCALORIE,
  kilograms,
  rideCalories,
  UnitError,
} from '../index';

/** `seconds` samples at 1 Hz, every one the same heart rate. */
function steady(bpm: number, seconds: number): BeatsPerMinute[] {
  return Array.from({ length: seconds }, () => beatsPerMinute(bpm));
}

const HALF_HOUR = 30 * 60;
const HOUR = 60 * 60;

const MAN: CalorieRider = { sex: 'male', ageYears: 35, mass: kilograms(81.6) };
const WOMAN: CalorieRider = { sex: 'female', ageYears: 35, mass: kilograms(68) };

describe('caloriesFromWork', () => {
  it('divides the work by 4184 J/kcal and by the efficiency', () => {
    // 1500 kJ / 4.184 / 0.25 = 1434.03; / 0.20 = 1792.54.
    expect(caloriesFromWork(joules(1_500_000), 0.25)).toBeCloseTo(1434.0, 1);
    expect(caloriesFromWork(joules(1_500_000), 0.2)).toBeCloseTo(1792.5, 1);
  });

  it('pins the default efficiency at 0.20, the owner ruling on #2430: 1000 kJ is 1195 kcal', () => {
    // A change to the constant is a red test here, and so a visible decision.
    // 1000 kJ / 4.184 / 0.20 = 1195.03 kcal. (The issue body's 1 kJ = 1 kcal
    // was #2430's recommendation, which the owner's ruling of 2026-11-09 replaced.)
    expect(ASSUMED_GROSS_EFFICIENCY).toBe(0.2);
    expect(JOULES_PER_KILOCALORIE).toBe(4184);
    expect(Math.abs(caloriesFromWork(joules(1_000_000)) - 1195)).toBeLessThanOrEqual(1);
  });

  it('gives nought for no work', () => {
    expect(caloriesFromWork(joules(0))).toBe(0);
  });
});

describe('caloriesFromHeartRate, Keytel 2005 without VO2max', () => {
  it('matches the male worked example: 35 y, 81.6 kg, 135 bpm for 30 minutes is 383 kcal', () => {
    // −55.0969 + 0.6309 × 135 + 0.1988 × 81.6 + 0.2017 × 35
    //   = −55.0969 + 85.1715 + 16.22208 + 7.0595 = 53.35618 kJ/min;
    // × 30 min = 1600.685 kJ; / 4.184 = 382.57 kcal.
    const energy = caloriesFromHeartRate(steady(135, HALF_HOUR), 1, MAN);
    expect(energy).toBeDefined();
    expect(Math.abs((energy ?? Number.NaN) - 383)).toBeLessThanOrEqual(1);
  });

  it('matches the female worked example: 35 y, 68.0 kg, 145 bpm for 30 minutes is 276 kcal', () => {
    // −20.4022 + 0.4472 × 145 − 0.1263 × 68 + 0.074 × 35
    //   = −20.4022 + 64.844 − 8.5884 + 2.59 = 38.4434 kJ/min;
    // × 30 min = 1153.302 kJ; / 4.184 = 275.65 kcal.
    const energy = caloriesFromHeartRate(steady(145, HALF_HOUR), 1, WOMAN);
    expect(energy).toBeDefined();
    expect(Math.abs((energy ?? Number.NaN) - 276)).toBeLessThanOrEqual(1);
  });

  it('weights each sample by the sample interval: 900 samples at 2 s is the 1 Hz half hour', () => {
    const atOneHertz = caloriesFromHeartRate(steady(135, HALF_HOUR), 1, MAN);
    const atHalfHertz = caloriesFromHeartRate(steady(135, HALF_HOUR / 2), 2, MAN);
    expect(atHalfHertz).toBeCloseTo(atOneHertz ?? Number.NaN, 6);
  });

  it('integrates only the samples present: half the samples missing is half the energy', () => {
    const full = caloriesFromHeartRate(steady(135, HALF_HOUR), 1, MAN);
    const holed = steady(135, HALF_HOUR).map((sample, index) =>
      index % 2 === 0 ? sample : undefined,
    );
    const half = caloriesFromHeartRate(holed, 1, MAN);
    expect(half).toBeCloseTo((full ?? Number.NaN) / 2, 6);
  });

  it('clamps a negative predicted rate at nought: female, 30 y, 90 kg, 60 bpm gives 0', () => {
    // −20.4022 + 0.4472 × 60 − 0.1263 × 90 + 0.074 × 30 = −2.7172 kJ/min.
    const rider: CalorieRider = { sex: 'female', ageYears: 30, mass: kilograms(90) };
    expect(caloriesFromHeartRate(steady(60, HOUR), 1, rider)).toBe(0);
  });

  it('does not let a negative sample cancel a positive one', () => {
    const rider: CalorieRider = { sex: 'female', ageYears: 30, mass: kilograms(90) };
    const positiveOnly = caloriesFromHeartRate(steady(150, 600), 1, rider);
    const mixed = caloriesFromHeartRate([...steady(150, 600), ...steady(60, 600)], 1, rider);
    expect(mixed).toBeCloseTo(positiveOnly ?? Number.NaN, 6);
  });

  it.each([
    ['sex', { ageYears: 35, mass: kilograms(81.6) }],
    ['age', { sex: 'male', mass: kilograms(81.6) }],
    ['mass', { sex: 'male', ageYears: 35 }],
  ] as const)('gives no figure with no %s', (_, rider: CalorieRider) => {
    expect(caloriesFromHeartRate(steady(135, HALF_HOUR), 1, rider)).toBeUndefined();
  });

  it('gives no figure for a channel with no reading at all', () => {
    expect(caloriesFromHeartRate([undefined, undefined], 1, MAN)).toBeUndefined();
    expect(caloriesFromHeartRate([], 1, MAN)).toBeUndefined();
  });
});

describe('rideCalories', () => {
  it('uses power when the ride has both channels: 200 W and 150 bpm for an hour', () => {
    const work = joules(200 * HOUR);
    const estimate = rideCalories({
      work,
      heartRate: steady(150, HOUR),
      sampleInterval: 1,
      rider: MAN,
    });
    expect(estimate).toEqual({ energy: caloriesFromWork(work), basis: 'power' });
  });

  it('gives nought kilocalories on the power basis for a zero work, not a heart-rate figure', () => {
    const estimate = rideCalories({
      work: joules(0),
      heartRate: steady(150, HOUR),
      sampleInterval: 1,
      rider: MAN,
    });
    expect(estimate).toEqual({ energy: 0, basis: 'power' });
  });

  it('falls back to heart rate with no power reading', () => {
    const heartRate = steady(135, HALF_HOUR);
    const estimate = rideCalories({ work: undefined, heartRate, sampleInterval: 1, rider: MAN });
    expect(estimate).toEqual({
      energy: caloriesFromHeartRate(heartRate, 1, MAN),
      basis: 'heart-rate',
    });
  });

  it.each([
    ['sex', { ageYears: 35, mass: kilograms(81.6) }],
    ['age', { sex: 'male', mass: kilograms(81.6) }],
    ['mass', { sex: 'male', ageYears: 35 }],
  ] as const)('gives no figure for a heart-rate ride with no %s', (_, rider: CalorieRider) => {
    expect(
      rideCalories({ work: undefined, heartRate: steady(135, 60), sampleInterval: 1, rider }),
    ).toBeUndefined();
  });

  it('still gives the power figure with no rider input at all', () => {
    const work = joules(720_000);
    expect(rideCalories({ work, heartRate: undefined, sampleInterval: 1, rider: {} })).toEqual({
      energy: caloriesFromWork(work),
      basis: 'power',
    });
  });

  it('gives no figure with neither channel', () => {
    expect(
      rideCalories({ work: undefined, heartRate: undefined, sampleInterval: 1, rider: MAN }),
    ).toBeUndefined();
  });
});

describe('the kilocalorie quantity', () => {
  it('refuses what is not an energy, through the efficiency', () => {
    expect(() => caloriesFromWork(joules(1000), 0)).toThrow(UnitError);
    expect(() => caloriesFromWork(joules(1000), -0.2)).toThrow(UnitError);
  });
});
