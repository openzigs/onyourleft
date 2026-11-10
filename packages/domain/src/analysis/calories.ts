// SPDX-License-Identifier: Apache-2.0

/**
 * A ride's calorie estimate: the energy the rider spent, in kilocalories, and
 * what it was worked out from (#2431, epic #2430).
 *
 * **An estimate, and always labelled as one.** Neither method measures what a
 * rider burned; each predicts it from something the ride did record. So the
 * result carries its {@link CaloriesBasis}, and a screen that shows the figure
 * names the basis beside it.
 *
 * ## The two methods, and the order they are tried in
 *
 * 1. **Power.** The work a ride did at the pedals is measured, so the only
 *    assumption is how much of the energy the rider spent became that work:
 *    the gross efficiency. `kcal = work_J / 4184 / efficiency`.
 * 2. **Heart rate**, only when there is no power reading at all. Keytel et al.
 *    2005, which needs the rider's sex, age and body mass.
 *
 * {@link rideCalories} uses power whenever there is a work figure — nought
 * included, because a meter that read zero throughout measured a ride that did
 * no work — and never blends the two: a figure with two bases is a figure no
 * screen can describe in one phrase.
 *
 * ## The efficiency
 *
 * {@link ASSUMED_GROSS_EFFICIENCY} is **0.20**, the owner's ruling of
 * 2026-11-09 on #2430's question 2. Moseley and Jeukendrup measured a mean gross
 * efficiency of 19.8 ± 0.6 % in trained men, with a within-subject coefficient
 * of variation of about 4 % (*The reliability of cycling efficiency*, Med Sci
 * Sports Exerc 2001; 33(4): 621-627), and studies of recreational cyclists
 * report similar or lower values (Ettema and Lorås, *Efficiency in cycling: a
 * review*, Eur J Appl Physiol 2009; 106: 1-14). The rule of thumb that 1 kJ of
 * work is 1 kcal assumes 1/4.184 ≈ 23.9 %, above what was measured, so it reads
 * low. **0.20 is a population mean**: a rider's own efficiency can sit a few
 * points either side of it, which moves the estimate by about ±10-15 %.
 *
 * ## The heart-rate equation
 *
 * Keytel LR, Goedecke JH, Noakes TD, Hiiloskorpi H, Laukkanen R, van der Merwe
 * L, Lambert EV. *Prediction of energy expenditure from heart rate monitoring
 * during submaximal exercise.* J Sports Sci 2005; 23(3): 289-297 (PubMed
 * 15966347). The model without VO2max, in kJ per minute, with g = 1 for a man
 * and 0 for a woman, HR in beats per minute, m in kilograms and a in years:
 *
 * ```
 * EE = g (−55.0969 + 0.6309 HR + 0.1988 m + 0.2017 a)
 *    + (1 − g) (−20.4022 + 0.4472 HR − 0.1263 m + 0.074 a)
 * ```
 *
 * It was fitted on n = 115 people aged 18-45 and weighing 47-120 kg, in steady
 * state at 57-90 % of maximal heart rate, with r = 0.857 for this model.
 * Outside that range of people and intensity it is less reliable. **This file
 * does not refuse a rider outside it**: the range is a statement about the
 * fit's evidence, not a boundary past which the arithmetic stops, and refusing
 * a 46-year-old a figure the 45-year-old gets would be a cliff with no reason.
 *
 * Two rules over the samples, both refusals to invent energy:
 *
 * - **A sample with no reading adds nothing**, as `rideEnergy` in the client
 *   treats a power dropout: carrying the last heart rate across a hole invents
 *   effort nobody measured.
 * - **A sample whose predicted rate is negative adds nothing.** The female
 *   equation's intercept is −20.4 kJ/min and its mass coefficient negative, so
 *   a low heart rate in a heavy rider predicts a negative rate — female, 30 y,
 *   90 kg, 60 bpm gives about −2.7 kJ/min. That is the line extrapolated below
 *   the range it was fitted on, not a rider giving energy back, so it is
 *   clamped at nought per sample rather than allowed to cancel the samples
 *   either side of it.
 *
 * ## Missing inputs give no figure
 *
 * The heart-rate method needs sex, age and mass, and with any one missing it
 * returns `undefined` — a dash on screen — rather than a guess. In particular
 * `mass` is the rider's **entered** weight only, never the client's 71 kg
 * default (#2430's question 3): an assumed weight times a 0.2 kJ/min/kg
 * coefficient is a confident number about somebody else.
 *
 * A formula is not copyrightable (docs/agents/scope-and-ip.md §6); every
 * expression below is written from the published papers.
 */

import type { BeatsPerMinute, Joules, Kilocalories, Kilograms } from '../quantities';
import { kilocalories } from '../quantities';

/** The thermochemical calorie: 4.184 J, so a kilocalorie is 4184 J, exactly. */
export const JOULES_PER_KILOCALORIE = 4184;

/**
 * The assumed gross efficiency: the share of the energy a rider spends that
 * reaches the pedals as work. 0.20, from Moseley and Jeukendrup 2001's measured
 * mean of 19.8 % — the owner's ruling on #2430's question 2, and a population
 * mean, so a rider's own can differ by a few points. See the module note.
 */
export const ASSUMED_GROSS_EFFICIENCY = 0.2;

/** What a calorie estimate was worked out from. Never a blend of the two. */
export type CaloriesBasis = 'power' | 'heart-rate';

/** What the heart-rate method needs to know about the rider. */
export interface CalorieRider {
  /** The sex Keytel's coefficients are for. */
  readonly sex?: 'female' | 'male';
  /** The rider's age in years at the ride. */
  readonly ageYears?: number;
  /** The rider's entered mass only; never the client's 71 kg default. */
  readonly mass?: Kilograms;
}

/** A ride's calorie estimate and the basis it rests on. */
export interface CalorieEstimate {
  readonly energy: Kilocalories;
  readonly basis: CaloriesBasis;
}

/**
 * The energy spent to do `work`, at the given gross efficiency.
 *
 * @throws {UnitError} if the efficiency is zero or negative, through
 *   {@link kilocalories}: the quotient is then infinite or negative.
 */
export function caloriesFromWork(
  work: Joules,
  efficiency: number = ASSUMED_GROSS_EFFICIENCY,
): Kilocalories {
  return kilocalories(work / JOULES_PER_KILOCALORIE / efficiency);
}

/** Keytel 2005's predicted rate for one heart rate, in kJ per minute. */
function keytelKilojoulesPerMinute(
  heartRate: number,
  sex: 'female' | 'male',
  mass: number,
  ageYears: number,
): number {
  return sex === 'male'
    ? -55.0969 + 0.6309 * heartRate + 0.1988 * mass + 0.2017 * ageYears
    : -20.4022 + 0.4472 * heartRate - 0.1263 * mass + 0.074 * ageYears;
}

/**
 * The energy a ride spent, from its heart-rate channel, by Keytel 2005.
 *
 * `sampleInterval` is the seconds each sample stands for, as a recorded
 * series states it. `undefined` when sex, age or mass is missing, or when the
 * channel holds no reading at all. See the module note for the two per-sample
 * rules: a missing reading and a negative predicted rate each add nothing.
 */
export function caloriesFromHeartRate(
  heartRate: readonly (BeatsPerMinute | undefined)[],
  sampleInterval: number,
  rider: CalorieRider,
): Kilocalories | undefined {
  const { sex, ageYears, mass } = rider;
  if (sex === undefined || ageYears === undefined || mass === undefined) {
    return undefined;
  }
  let kilojoules = 0;
  let readings = 0;
  for (const sample of heartRate) {
    if (sample === undefined) {
      continue;
    }
    readings += 1;
    const rate = keytelKilojoulesPerMinute(sample, sex, mass, ageYears);
    if (rate > 0) {
      kilojoules += (rate * sampleInterval) / 60;
    }
  }
  if (readings === 0) {
    return undefined;
  }
  return kilocalories((kilojoules * 1000) / JOULES_PER_KILOCALORIE);
}

/**
 * A ride's calorie estimate: from its work when there is a work figure, else
 * from its heart rate, else none.
 *
 * `work` is the ride's work as `rideEnergy` in the client gives it, which is
 * `undefined` exactly when the power channel holds no reading. A defined work
 * of nought is a power basis of nought kilocalories and does not fall through
 * to heart rate.
 */
export function rideCalories(input: {
  readonly work: Joules | undefined;
  readonly heartRate: readonly (BeatsPerMinute | undefined)[] | undefined;
  readonly sampleInterval: number;
  readonly rider: CalorieRider;
}): CalorieEstimate | undefined {
  if (input.work !== undefined) {
    return { energy: caloriesFromWork(input.work), basis: 'power' };
  }
  if (input.heartRate === undefined) {
    return undefined;
  }
  const energy = caloriesFromHeartRate(input.heartRate, input.sampleInterval, input.rider);
  return energy === undefined ? undefined : { energy, basis: 'heart-rate' };
}
