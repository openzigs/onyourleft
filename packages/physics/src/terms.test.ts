// SPDX-License-Identifier: Apache-2.0

/**
 * Each term of the force balance, on its own.
 *
 * #88's first acceptance criterion is that the terms are **individually
 * testable**, and this file is what that buys: when the model is wrong, the
 * failure names the term.
 *
 * Two kinds of assertion, deliberately mixed. **Anchors** compare against a
 * number computed by hand from Martin's constants — `0.0032 × 90 × 9.81`, which
 * is arithmetic anyone can redo on paper. **Identities** compare two calls to
 * the same function against each other — doubling the air speed quadruples the
 * drag, the sum of the parts is the whole. Anchors catch a wrong constant;
 * identities catch a wrong shape, and survive a change of defaults. Neither
 * alone is enough: an anchor that re-derives the expected value with the same
 * expression the implementation uses is circular, and identities alone are
 * satisfied by any model with the right exponents and the wrong physics.
 */

import { describe, expect, it } from 'vitest';

import { gradePercent, kilograms, metresPerSecond } from '@onyourleft/domain';

import {
  aerodynamicDragForceNewtons,
  airSpeedMetresPerSecond,
  bearingFrictionForceNewtons,
  DEFAULT_COEFFICIENTS,
  effectiveMassKilograms,
  gradeRatio,
  gravityForceNewtons,
  resistiveForces,
  rollingResistanceForceNewtons,
  withDragArea,
} from './index';

const RIDER_AND_BIKE = kilograms(90);
const APPENDIX_AIR_DENSITY = 1.2234;

describe('the grade conversion, which is a hundred-fold error waiting to happen', () => {
  it('reads a percent as a rise-over-run ratio', () => {
    // Appendix I's grade is 0.003 rise over run. `packages/domain` carries it as
    // 0.3, because percent is what the wire format, the course file and the
    // rider all use. Everything downstream depends on this one divide.
    expect(gradeRatio(0.3)).toBeCloseTo(0.003, 12);
    expect(gradeRatio(7)).toBeCloseTo(0.07, 12);
    expect(gradeRatio(-7)).toBeCloseTo(-0.07, 12);
  });
});

describe('air velocity', () => {
  it('adds a headwind to the ground speed, as Martin does', () => {
    // `V_a = V_G + V_WTAN = 8.36 + 2.55 = 10.91`, Appendix I.
    expect(airSpeedMetresPerSecond(metresPerSecond(8.36), 2.55)).toBeCloseTo(10.91, 10);
  });

  it('subtracts a tailwind, and lets it exceed the ground speed', () => {
    expect(airSpeedMetresPerSecond(metresPerSecond(3), -5)).toBeCloseTo(-2, 10);
  });

  it('is the ground speed in still air', () => {
    expect(airSpeedMetresPerSecond(metresPerSecond(8.36))).toBe(8.36);
  });
});

describe('aerodynamic drag (Equations 1, 3 and 4)', () => {
  const drag = (speed: number, density = APPENDIX_AIR_DENSITY): number =>
    aerodynamicDragForceNewtons({
      airSpeedMetresPerSecond: speed,
      airDensityKilogramsPerCubicMetre: density,
      coefficients: withDragArea(0.2565),
    });

  it('anchors on the Appendix: the force times the ground speed is 158.8 W', () => {
    // `P_AT = ½ ρ (C_D A + F_w) V_a² V_G`, so the force is that divided by V_G.
    expect(drag(10.91) * 8.36).toBeCloseTo(158.8, 1);
  });

  it('quadruples when the air speed doubles', () => {
    expect(drag(20)).toBeCloseTo(4 * drag(10), 8);
  });

  it('is proportional to air density', () => {
    expect(drag(10, 2 * APPENDIX_AIR_DENSITY)).toBeCloseTo(2 * drag(10), 8);
  });

  it('counts the spokes as well as the body (Equation 3)', () => {
    // `F_w` is a second drag area, not a rounding of the first. Zeroing it has
    // to move the answer, or Equation 3 is present and unused.
    const withoutSpokes = aerodynamicDragForceNewtons({
      airSpeedMetresPerSecond: 10.91,
      airDensityKilogramsPerCubicMetre: APPENDIX_AIR_DENSITY,
      coefficients: { ...withDragArea(0.2565), spokeDragAreaSquareMetres: 0 },
    });
    expect(withoutSpokes).toBeLessThan(drag(10.91));
    // 0.0044 of 0.2609 is 1.7 % of the term, which at 158.8 W is 2.7 W — the
    // same magnitude as the whole model's standard error against the SRM.
    expect(drag(10.91) / withoutSpokes).toBeCloseTo(0.2609 / 0.2565, 6);
  });

  it('pushes rather than resists in a tailwind faster than the rider', () => {
    // Squaring a negative air velocity would return the same magnitude with the
    // wrong sign: a strong tailwind modelled as a strong headwind.
    expect(drag(-5)).toBeLessThan(0);
    expect(drag(-5)).toBeCloseTo(-drag(5), 10);
  });

  it('is zero in air moving exactly with the rider', () => {
    expect(drag(0)).toBe(0);
  });
});

describe('rolling resistance (Equations 5 and 6)', () => {
  const rolling = (gradientPercent: number, mass = RIDER_AND_BIKE): number =>
    rollingResistanceForceNewtons({ totalMass: mass, grade: gradePercent(gradientPercent) });

  it('anchors on the flat: C_RR m g is 0.0032 × 90 × 9.81 = 2.82528 N', () => {
    expect(rolling(0)).toBeCloseTo(2.82528, 8);
  });

  it('carries the cosine of the slope angle, not the small-grade simplification', () => {
    // At a 100 % grade the road is at 45°, where COS[TAN⁻¹(1)] is 1/√2. The
    // paper's Equation 6a drops the cosine because it is within 0.5 % of 1 for
    // road grades; a virtual world is not limited to road grades.
    expect(rolling(100)).toBeCloseTo(rolling(0) / Math.SQRT2, 8);
    expect(rolling(10)).toBeLessThan(rolling(0));
  });

  it('scales with mass, which is what keeps it distinct from bearing friction', () => {
    expect(rolling(0, kilograms(180))).toBeCloseTo(2 * rolling(0), 8);
  });

  it('does not care which way the hill runs', () => {
    expect(rolling(-8)).toBeCloseTo(rolling(8), 12);
  });
});

describe('gravity (Equations 8 and 9)', () => {
  const gravity = (gradientPercent: number): number =>
    gravityForceNewtons({ totalMass: RIDER_AND_BIKE, grade: gradePercent(gradientPercent) });

  it('is nothing on the flat', () => {
    expect(gravity(0)).toBe(0);
  });

  it('anchors at a 100 % grade: m g SIN(45°) = 90 × 9.81 / √2 = 624.4 N', () => {
    expect(gravity(100)).toBeCloseTo((90 * 9.81) / Math.SQRT2, 6);
  });

  it('reverses sign on a descent, and only reverses sign', () => {
    // The one failure `packages/domain` names for this quantity: drop the sign
    // and every descent becomes a climb, which a rider feels in their legs
    // rather than reading in a log.
    expect(gravity(-6)).toBeCloseTo(-gravity(6), 10);
    expect(gravity(-6)).toBeLessThan(0);
    expect(gravity(6)).toBeGreaterThan(0);
  });

  it('uses the sine of the slope angle, not the small-grade simplification', () => {
    // Equation 9a substitutes `G_R` for `SIN[TAN⁻¹(G_R)]`. They agree to 0.5 %
    // at 10 % grade and diverge without limit: at 100 % the simplification is
    // 41 % high.
    const simplified = gradeRatio(100) * 90 * 9.81;
    expect(gravity(100)).toBeLessThan(simplified);
    expect(gravity(100) / simplified).toBeCloseTo(1 / Math.SQRT2, 6);
  });
});

describe('wheel bearing friction (Equation 7)', () => {
  it('reproduces Equation 7 when multiplied back by speed', () => {
    // The paper states this as a power, `P_WB = V_G (91 + 8.7 V_G) 10⁻³`. The
    // package stores it as the force `β₀ + β₁ v` of the Dahmen & Saupe balance.
    // This asserts the rearrangement rather than trusting the comment that
    // records it, and it does so against the paper's own integers.
    for (const speed of [0, 1, 5, 8.36, 15]) {
      const equation7 = speed * (91 + 8.7 * speed) * 1e-3;
      expect(
        bearingFrictionForceNewtons({ groundSpeed: metresPerSecond(speed) }) * speed,
      ).toBeCloseTo(equation7, 10);
    }
  });

  it('does not vanish when the bicycle is unloaded, unlike rolling resistance', () => {
    // The whole reason it is a separate term. A model that folds bearing
    // friction into C_RR makes it proportional to weight, and then gets a light
    // rider on a flat road wrong in a way no coefficient can repair.
    expect(bearingFrictionForceNewtons({ groundSpeed: metresPerSecond(0) })).toBeCloseTo(0.091, 10);
  });

  it('grows linearly with speed, not quadratically', () => {
    const at5 = bearingFrictionForceNewtons({ groundSpeed: metresPerSecond(5) });
    const at10 = bearingFrictionForceNewtons({ groundSpeed: metresPerSecond(10) });
    const at15 = bearingFrictionForceNewtons({ groundSpeed: metresPerSecond(15) });
    expect(at10 - at5).toBeCloseTo(at15 - at10, 10);
  });
});

describe('effective mass (Equation 12)', () => {
  it('anchors on the Appendix: 90 + 0.14/0.311² = 91.4475 kg', () => {
    expect(effectiveMassKilograms({ totalMass: RIDER_AND_BIKE })).toBeCloseTo(91.4475, 4);
  });

  it('is the system mass alone once the wheels have no inertia', () => {
    expect(
      effectiveMassKilograms({
        totalMass: RIDER_AND_BIKE,
        coefficients: { wheelMomentOfInertiaKilogramSquareMetres: 0 },
      }),
    ).toBe(90);
  });

  it('divides by the square of the radius, so the radius matters twice over', () => {
    const halfRadius = effectiveMassKilograms({
      totalMass: RIDER_AND_BIKE,
      coefficients: { wheelRadiusMetres: DEFAULT_COEFFICIENTS.wheelRadiusMetres / 2 },
    });
    expect(halfRadius - 90).toBeCloseTo(
      4 * (effectiveMassKilograms({ totalMass: RIDER_AND_BIKE }) - 90),
      8,
    );
  });
});

describe('the assembled balance', () => {
  const forces = resistiveForces({
    groundSpeed: metresPerSecond(8.36),
    headwindMetresPerSecond: 2.55,
    totalMass: RIDER_AND_BIKE,
    grade: gradePercent(0.3),
    airDensityKilogramsPerCubicMetre: APPENDIX_AIR_DENSITY,
    coefficients: withDragArea(0.2565),
  });

  it('totals exactly the four terms it reports', () => {
    // The sum is what `powerRequired` and `advance` both multiply by speed, so a
    // term reported but not summed would be a term that is documented and
    // inert — the shape #88 warns about for inertia.
    expect(forces.totalNewtons).toBeCloseTo(
      forces.aerodynamicNewtons +
        forces.rollingResistanceNewtons +
        forces.gravityNewtons +
        forces.bearingFrictionNewtons,
      12,
    );
  });

  it('reports each term as the standalone function does', () => {
    expect(forces.rollingResistanceNewtons).toBeCloseTo(
      rollingResistanceForceNewtons({ totalMass: RIDER_AND_BIKE, grade: gradePercent(0.3) }),
      12,
    );
    expect(forces.gravityNewtons).toBeCloseTo(
      gravityForceNewtons({ totalMass: RIDER_AND_BIKE, grade: gradePercent(0.3) }),
      12,
    );
    expect(forces.bearingFrictionNewtons).toBeCloseTo(
      bearingFrictionForceNewtons({ groundSpeed: metresPerSecond(8.36) }),
      12,
    );
  });

  it('evaluates drag at the air speed and not the ground speed', () => {
    // The trap this one exists for: with a 2.55 m/s headwind the two differ by
    // 30 %, and drag goes as the square, so using the ground speed here would
    // lose 41 % of the largest term in the model.
    const stillAir = resistiveForces({
      groundSpeed: metresPerSecond(8.36),
      totalMass: RIDER_AND_BIKE,
      grade: gradePercent(0.3),
      airDensityKilogramsPerCubicMetre: APPENDIX_AIR_DENSITY,
      coefficients: withDragArea(0.2565),
    });
    expect(forces.aerodynamicNewtons / stillAir.aerodynamicNewtons).toBeCloseTo(
      (10.91 * 10.91) / (8.36 * 8.36),
      6,
    );
  });
});
