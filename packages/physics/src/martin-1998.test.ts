// SPDX-License-Identifier: Apache-2.0

/**
 * The model against the paper it is taken from.
 *
 * **This is the file that makes the model right rather than merely plausible.**
 * Every other test in this package asserts internal consistency — that a term is
 * wired in, that a tick is step-independent, that a coast comes to rest — and an
 * implementation that is self-consistently wrong passes all of them. The
 * assertions here compare against numbers **published by Martin, Milliken, Cobb,
 * McFadden & Coggan (1998)**, *Validation of a Mathematical Model for Road
 * Cycling Power*, J Appl Biomech 14(3):276–291, which this package's author did
 * not choose and cannot adjust.
 *
 * #88 is explicit about why the target is the paper and not a game: Zwift does
 * not publish its constants, and Zwift Insider's validation against two
 * independent outdoor calculators found it 1–4 km/h optimistic. A model
 * validated against Zwift inherits Zwift's optimism.
 *
 * ## What is asserted, and where each number is printed
 *
 * 1. **Appendix I, "Sample Calculation of Power"** (pp. 290–291) — a single road
 *    trial with a crosswind, a 0.3 % grade and a slight acceleration, worked
 *    through term by term to `P_TOT = 213.3 W`. Every intermediate value the
 *    Appendix prints is asserted too, so a failure names the term that moved
 *    rather than only the total.
 * 2. **Model Application** (pp. 286–287) — "The power required for such a
 *    hypothetical subject to ride at 11 m/s on a flat surface in calm wind
 *    conditions was found to be 255 W", for a subject with drag area 0.264 m²
 *    and mass 71.9 kg. An **independent** check of the same code: different
 *    inputs, a different section, and a figure the Appendix's arithmetic does
 *    not feed.
 * 3. **Figure 4** (p. 288) — the paper's own linear fit of cycling velocity
 *    against road gradient at 255 W, over −6 % to +6 %. That exercises the
 *    inverse direction, power → speed, across a range that spans zero. See the
 *    note there about what its tolerance can and cannot mean.
 *
 * ## The inputs, transcribed
 *
 * Appendix I's raw data, verbatim: rider mass 80 kg, bicycle mass 10 kg, wind
 * direction 310°, wind velocity 2.94 m/s, time to cover 471.8 m 56.42 s, initial
 * velocity 8.28 m/s, final velocity 8.45 m/s, ride direction 340, grade 0.003.
 * Its derived values, also verbatim: `V_G = 471.8/56.42 = 8.36 m/s`,
 * `V_WTAN = 2.94 COS(340 − 310) = 2.55 m/s`, `V_a = 8.36 + 2.55 = 10.91 m/s`,
 * yaw 7.7°, and a drag area interpolated to that yaw of 0.2565 m².
 *
 * The **rounded** derived values are used rather than recomputed from the raw
 * data, because they are what the Appendix's own arithmetic uses: carrying
 * `471.8/56.42 = 8.3624…` forward instead reproduces a slightly different total
 * than the one printed, and the printed total is what this file exists to check.
 * Decomposing the wind vector is not this package's job either — a course, a
 * heading and a weather reading are a consumer's inputs, and the model takes
 * the tangential component that falls out of them.
 */

import { describe, expect, it } from 'vitest';

import {
  gradePercent,
  kilograms,
  metresPerSecond,
  seconds,
  type GradePercent,
  type Kilograms,
  type MetresPerSecond,
} from '@onyourleft/domain';

import { powerRequired, steadyStateSpeedMetresPerSecond, withDragArea } from './index';

/**
 * The tolerance every watt figure below is asserted to.
 *
 * The paper prints each figure to one decimal place, so ±0.05 W is inherent in
 * the comparison before any arithmetic happens, and the Appendix's own total is
 * assembled from figures it has already rounded. 0.1 W covers both. It is a
 * thirty-seventh of the model's 2.7 W standard error against the SRM, so what
 * this asserts is that the arithmetic is the paper's — not that the paper is
 * right about the bicycle.
 *
 * It is also a fourteenth of the *smallest* term in the Appendix (bearing
 * friction, 1.4 W), which is the property that matters: dropping any single
 * term of the model fails this tolerance by an order of magnitude.
 */
const WATT_TOLERANCE = 0.1;

const expectWatts = (actual: number, published: number): void => {
  expect(Math.abs(actual - published)).toBeLessThan(WATT_TOLERANCE);
};

/** Air density, kg/m³, measured in the wind tunnel for these trials (Appendix I). */
const APPENDIX_AIR_DENSITY = 1.2234;

/** `V_G`, the ground velocity the Appendix carries forward. */
const APPENDIX_GROUND_SPEED: MetresPerSecond = metresPerSecond(8.36);

/** `V_WTAN`, the tangential wind component. Positive is a headwind. */
const APPENDIX_HEADWIND = 2.55;

/** Rider 80 kg plus bicycle 10 kg. */
const APPENDIX_TOTAL_MASS: Kilograms = kilograms(90);

/** Grade 0.003 rise over run, which is 0.3 % in this program's unit. */
const APPENDIX_GRADE: GradePercent = gradePercent(0.3);

/** `C_D A` interpolated to the trial's 7.7° yaw angle. */
const APPENDIX_DRAG_AREA = 0.2565;

const appendixTrial = {
  groundSpeed: APPENDIX_GROUND_SPEED,
  headwindMetresPerSecond: APPENDIX_HEADWIND,
  totalMass: APPENDIX_TOTAL_MASS,
  grade: APPENDIX_GRADE,
  airDensityKilogramsPerCubicMetre: APPENDIX_AIR_DENSITY,
  velocityChange: {
    initialSpeed: metresPerSecond(8.28),
    finalSpeed: metresPerSecond(8.45),
    duration: seconds(56.42),
  },
  coefficients: withDragArea(APPENDIX_DRAG_AREA),
} as const;

describe('Appendix I, the paper worked term by term to 213.3 W', () => {
  it('reproduces the air velocity the Appendix derives', () => {
    // `V_a = V_G + V_WTAN = 8.36 + 2.55 = 10.91 m/s`.
    expect(powerRequired(appendixTrial).airSpeedMetresPerSecond).toBeCloseTo(10.91, 10);
  });

  it('reproduces the aerodynamic power, 158.8 W (Equation 4)', () => {
    // `P_AT = 10.91² × 8.36 × 0.5 × 1.2234 × (0.2565 + 0.0044) = 158.8 W`.
    expectWatts(powerRequired(appendixTrial).aerodynamicWatts, 158.8);
  });

  it('reproduces the rolling resistance power, 23.6 W (Equation 6)', () => {
    // `P_RR = 8.36 × COS[TAN⁻¹(0.003)] × 0.0032 × 90 × 9.81 = 23.6 W`.
    expectWatts(powerRequired(appendixTrial).rollingResistanceWatts, 23.6);
  });

  it('reproduces the wheel bearing friction power, 1.4 W (Equation 7)', () => {
    // `P_WB = 8.36 × (91 + 8.7 × 8.36) 10⁻³ = 1.4 W`.
    expectWatts(powerRequired(appendixTrial).bearingFrictionWatts, 1.4);
  });

  it('reproduces the potential energy power, 22.1 W (Equation 9)', () => {
    // `P_PE = 8.36 × 90 × 9.81 × SIN[TAN⁻¹(0.003)] = 22.1 W`.
    expectWatts(powerRequired(appendixTrial).potentialEnergyWatts, 22.1);
  });

  it('reproduces the kinetic energy power, 2.3 W (Equation 12)', () => {
    // `P_KE = 1/2 (90 + 0.14/0.311²)(8.45² − 8.28²)/56.42 = 2.3 W`.
    expectWatts(powerRequired(appendixTrial).kineticEnergyWatts, 2.3);
  });

  it('reproduces the net power, 208.2 W (Equation 13)', () => {
    expectWatts(powerRequired(appendixTrial).netWatts, 208.2);
  });

  it('reproduces the total power, 213.3 W (Equation 15)', () => {
    // `P_TOT = P_NET/E_C = 208.2/0.976 = 213.3 W`.
    expectWatts(powerRequired(appendixTrial).totalWatts, 213.3);
  });

  it('has a tolerance no dropped term could hide inside', () => {
    // A guard on the guard. If `WATT_TOLERANCE` were ever widened past the
    // smallest term the Appendix prints, every mutation in this package's PR
    // body would have been performed against a test that could not fail.
    expect(WATT_TOLERANCE).toBeLessThan(1.4);
  });
});

describe('Model Application: 255 W at 11 m/s, flat and calm', () => {
  /**
   * "For all of the following modeling, we used a hypothetical subject who had
   * the average characteristics of our subjects (drag area = 0.264 m², mass =
   * 71.9 kg). The power required for such a hypothetical subject to ride at
   * 11 m/s on a flat surface in calm wind conditions was found to be 255 W."
   *
   * 71.9 kg is the **subject** mass — "Six healthy male cyclists (height 1.77 ±
   * 0.05 m, mass 71.9 ± 6.3 kg)" — so the mass the model accelerates is that
   * plus the Appendix's 10 kg bicycle. Reading it as the total instead gives
   * 251.4 W, and the 0.5 W tolerance below is what makes this test able to tell
   * the two readings apart.
   */
  const hypotheticalSubject = {
    groundSpeed: metresPerSecond(11),
    totalMass: kilograms(71.9 + 10),
    grade: gradePercent(0),
    airDensityKilogramsPerCubicMetre: APPENDIX_AIR_DENSITY,
    coefficients: withDragArea(0.264),
  } as const;

  it('reproduces the published 255 W to within 0.5 W', () => {
    expect(Math.abs(powerRequired(hypotheticalSubject).totalWatts - 255)).toBeLessThan(0.5);
  });

  it('inverts: 255 W on that bicycle gives back 11 m/s', () => {
    // #88's first acceptance criterion is "computes speed from power", so the
    // inverse direction is checked against the paper as well as the forward one.
    const speed = steadyStateSpeedMetresPerSecond({
      powerWatts: 255,
      totalMass: hypotheticalSubject.totalMass,
      grade: hypotheticalSubject.grade,
      airDensityKilogramsPerCubicMetre: APPENDIX_AIR_DENSITY,
      coefficients: hypotheticalSubject.coefficients,
    });
    expect(speed).toBeCloseTo(11, 2);
  });
});

describe('Figure 4: velocity against gradient at 255 W', () => {
  /**
   * "cycling velocity [m/s] = 11.26 − 1.25 road gradient [%], R² > .99", fitted
   * over road gradients of −6 % to +6 % at 255 W.
   *
   * ⚠️ **This is the paper's straight-line fit to its model, not the model**,
   * and the difference is visible in the fit's own intercept: it says 11.26 m/s
   * on the flat where the same paper's Model Application says exactly 11. So a
   * tight tolerance here would assert that this package reproduces a regression
   * residual, which is not a thing worth pinning. The relation is convex — a
   * straight line through it undershoots in the middle and overshoots at the
   * ends — and 1.0 m/s bounds that over the fitted range.
   *
   * What the loose tolerance still catches is everything that actually goes
   * wrong with a gradient: a sign error (which puts the answer 8 m/s out at
   * ±6 %), the percent-versus-ratio confusion (a factor of 100, so the model
   * would return 11 m/s at every grade), and applying the grade to the wrong
   * term. The sharp assertion of direction is the test below this one.
   */
  const fittedVelocity = (gradientPercent: number): number => 11.26 - 1.25 * gradientPercent;

  const modelledVelocity = (gradientPercent: number): number =>
    steadyStateSpeedMetresPerSecond({
      powerWatts: 255,
      totalMass: kilograms(71.9 + 10),
      grade: gradePercent(gradientPercent),
      airDensityKilogramsPerCubicMetre: APPENDIX_AIR_DENSITY,
      coefficients: withDragArea(0.264),
    });

  it.each([-6, -4, -2, 0, 2, 4, 6])(
    'is within 1 m/s of the published fit at %i per cent grade',
    (gradientPercent) => {
      expect(
        Math.abs(modelledVelocity(gradientPercent) - fittedVelocity(gradientPercent)),
      ).toBeLessThan(1);
    },
  );

  it('climbs slower than it descends, in the direction gravity actually acts', () => {
    // Stated bluntly so that a failure reads as "the hill is the wrong way
    // round" rather than as a tolerance being missed. A 100-fold grade error
    // fails this too, by making all three equal.
    expect(modelledVelocity(6)).toBeLessThan(modelledVelocity(0));
    expect(modelledVelocity(-6)).toBeGreaterThan(modelledVelocity(0));
  });

  it('moves cycling velocity by about 1.24 m/s per per-cent of grade near flat', () => {
    // "each 1 % of grade increases or decreases cycling velocity by about
    // 1.24 m/s (approximately 11 %)". A central difference across the flat,
    // where the convexity that spoils the fit at the ends is smallest.
    const gradient = (modelledVelocity(-1) - modelledVelocity(1)) / 2;
    expect(gradient).toBeGreaterThan(1);
    expect(gradient).toBeLessThan(1.5);
  });
});
