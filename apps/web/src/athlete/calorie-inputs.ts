// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The two optional inputs a heart-rate calorie estimate needs beyond the
 * rider's weight — the sex whose coefficients Keytel et al. 2005 uses, and the
 * year of birth (#2432, epic #2430) — and the one place the athlete row becomes
 * the estimator's rider.
 *
 * ## Missing means no figure, never a default
 *
 * Unlike the weight (`mass.ts` §`riderMassFor`), **nothing here substitutes a
 * default**. A heart-rate estimate made with an assumed sex, age or weight is
 * a confident number about somebody else (#2430's open question 3), so
 * {@link calorieRiderFor} passes each input through only when the rider
 * entered it, and `rideCalories` gives no heart-rate figure without all three.
 * In particular the mass is the **entered** one, never
 * `DEFAULT_RIDER_MASS_KILOGRAMS`.
 *
 * ## On this device only
 *
 * ## The sex is the rider's one choice
 *
 * The owner's ruling of 2026-11-20: Settings asks Female or Male once, under
 * *Your rider*, and that choice is both the rider drawn and this estimate's
 * sex. {@link calorieRiderFor} reads it through `riderChoiceOf`, the same rule
 * Settings shows and the game draws.
 *
 * Both are kept on the athlete row and leave it only in the rider's own account
 * export. Nothing sent to an instance or a model reads them;
 * `privacy/calorie-inputs-stay-here.test.ts` holds that.
 */

import type { CalorieRider, UnixSeconds } from '@onyourleft/domain';
import { riderChoiceOf, type AthleteRecord } from '@onyourleft/store';

/** How far back a year of birth may be: 120 years before this one. */
export const BIRTH_YEAR_SPAN_YEARS = 120;

/**
 * The refusal for a year of birth, naming the field and the constraint — for
 * the year it is now, since the range moves with it.
 */
export function birthYearRefusal(currentYear: number): string {
  return (
    `Year of birth must be a whole year from ${String(currentYear - BIRTH_YEAR_SPAN_YEARS)} ` +
    `to ${String(currentYear)}, or blank.`
  );
}

/** What the panel's year of birth comes to: a write, or a refusal and no write. */
export type BirthYearSave =
  | { readonly kind: 'save'; readonly birthYear: number | undefined }
  | { readonly kind: 'refused'; readonly reason: string };

/**
 * Turn the typed year into a write or a refusal.
 *
 * Since the owner's ruling of 2026-11-20 the sex is not on this panel: it is
 * the rider's one Female / Male choice under *Your rider*, saved on change by
 * `setAthleteRider`, so only the year is left here.
 *
 * A pure function rather than a branch in the click handler, for the reason
 * `mass.ts` §`massToSave` gives. Blank clears the year. A year that is not a
 * whole number, is after `currentYear`, or is more than
 * {@link BIRTH_YEAR_SPAN_YEARS} before it is refused and nothing is written.
 */
export function birthYearToSave(typedYear: string, currentYear: number): BirthYearSave {
  const trimmed = typedYear.trim();
  if (trimmed === '') {
    return { kind: 'save', birthYear: undefined };
  }
  const year = /^\d+$/.test(trimmed) ? Number(trimmed) : Number.NaN;
  if (
    !Number.isSafeInteger(year) ||
    year > currentYear ||
    year < currentYear - BIRTH_YEAR_SPAN_YEARS
  ) {
    return { kind: 'refused', reason: birthYearRefusal(currentYear) };
  }
  return { kind: 'save', birthYear: year };
}

/**
 * The estimator's rider for a ride that started at `rideStartedAt`, from the
 * athlete row — each input only where the rider entered it.
 *
 * The age is the ride's start year minus the birth year, both in UTC. A year
 * is the resolution the rider gave, so a ride in the weeks either side of a
 * birthday or of New Year may be a year out, which moves Keytel's figure by
 * under 1 % (#2432's design note).
 *
 * An age below one year — a ride dated before the rider was born, as an
 * imported file from a head unit with no clock set is (1970) — is not passed
 * through: it is an unknown age, so the ride gets no figure rather than one
 * made from a negative age.
 */
export function calorieRiderFor(
  athlete: AthleteRecord | undefined,
  rideStartedAt: UnixSeconds,
): CalorieRider {
  const rideYear = new Date(rideStartedAt * 1000).getUTCFullYear();
  const ageYears = athlete?.birthYear === undefined ? undefined : rideYear - athlete.birthYear;
  // The rider's one Female / Male choice (2026-11-20): `calorieSex`, else a
  // `riderBody` written before the ruling. Never a default.
  const sex = riderChoiceOf(athlete);
  return {
    ...(sex === undefined ? {} : { sex }),
    ...(ageYears === undefined || ageYears < 1 ? {} : { ageYears }),
    ...(athlete?.mass === undefined ? {} : { mass: athlete.mass }),
  };
}
