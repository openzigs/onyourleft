// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The calorie inputs' two pure halves (#2432): what the panel's controls come
 * to, and the estimator's rider made from the athlete row — with no default
 * for anything the rider did not enter.
 */

import { kilograms, unixSeconds } from '@onyourleft/domain';
import { athleteId } from '@onyourleft/store';
import { describe, expect, it } from 'vitest';

import { DEFAULT_RIDER_MASS_KILOGRAMS } from './mass';
import { birthYearRefusal, calorieInputsToSave, calorieRiderFor } from './calorie-inputs';

/** 2026-06-01T08:00:00Z. */
const A_RIDE_IN_2026 = unixSeconds(Date.UTC(2026, 5, 1, 8) / 1000);

const ROW = { id: athleteId('athlete-a'), displayName: 'Rider', createdAt: unixSeconds(1) };

describe('calorieRiderFor', () => {
  it('gives the age at the ride: born 1990, a ride in 2026, is 36', () => {
    expect(calorieRiderFor({ ...ROW, birthYear: 1990 }, A_RIDE_IN_2026).ageYears).toBe(36);
  });

  it('takes the ride’s year, not today’s: the same rider on a ride in 2020 was 30', () => {
    const in2020 = unixSeconds(Date.UTC(2020, 2, 1) / 1000);
    expect(calorieRiderFor({ ...ROW, birthYear: 1990 }, in2020).ageYears).toBe(30);
  });

  it('gives no age with no birth year', () => {
    expect(calorieRiderFor(ROW, A_RIDE_IN_2026)).not.toHaveProperty('ageYears');
  });

  it('passes an entered mass through, and gives none — not 71 — for an unset one', () => {
    expect(calorieRiderFor({ ...ROW, mass: kilograms(64.5) }, A_RIDE_IN_2026).mass).toBe(64.5);
    const unset = calorieRiderFor(ROW, A_RIDE_IN_2026);
    expect(unset.mass).toBeUndefined();
    expect(Object.values(unset)).not.toContain(DEFAULT_RIDER_MASS_KILOGRAMS);
  });

  it('passes the sex through, and gives none for an unset one', () => {
    expect(calorieRiderFor({ ...ROW, calorieSex: 'female' }, A_RIDE_IN_2026).sex).toBe('female');
    expect(calorieRiderFor(ROW, A_RIDE_IN_2026)).not.toHaveProperty('sex');
  });

  it('gives an empty rider with no athlete row', () => {
    expect(calorieRiderFor(undefined, A_RIDE_IN_2026)).toStrictEqual({});
  });
});

describe('calorieInputsToSave', () => {
  it('saves a choice and a year', () => {
    expect(calorieInputsToSave('female', '1985', 2026)).toStrictEqual({
      kind: 'save',
      calorieSex: 'female',
      birthYear: 1985,
    });
  });

  it('clears both with Not set and a blank year', () => {
    expect(calorieInputsToSave('', '  ', 2026)).toStrictEqual({
      kind: 'save',
      calorieSex: undefined,
      birthYear: undefined,
    });
  });

  it('accepts this year and the year 120 years back, the two ends of the range', () => {
    expect(calorieInputsToSave('male', '2026', 2026)).toMatchObject({ birthYear: 2026 });
    expect(calorieInputsToSave('male', '1906', 2026)).toMatchObject({ birthYear: 1906 });
  });

  it.each([
    ['a year after this one', '2027'],
    ['more than 120 years back', '1905'],
    ['a non-number', 'nineteen'],
    ['a decimal', '1985.5'],
    ['a negative', '-1985'],
    ['an exponent', '2e3'],
  ])('refuses %s, naming the field and the constraint', (_, typed) => {
    const decision = calorieInputsToSave('female', typed, 2026);
    expect(decision).toStrictEqual({ kind: 'refused', reason: birthYearRefusal(2026) });
    expect(birthYearRefusal(2026)).toBe(
      'Year of birth must be a whole year from 1906 to 2026, or blank.',
    );
  });
});
