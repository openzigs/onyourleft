// SPDX-License-Identifier: Apache-2.0

/**
 * The force balance, one exported function per term.
 *
 * #88's first acceptance criterion is that the terms are **separate and
 * individually testable**, and the reason is in its own text: most
 * implementations fold bearing friction and drivetrain loss into the rolling
 * resistance coefficient, and then get low-speed behaviour wrong in a way riders
 * notice before they can name. Separate functions are what make a wrong term
 * visible as a wrong term rather than as a wrong speed.
 *
 * ## Sign convention
 *
 * Every function here returns a force in **newtons opposing forward motion**.
 * Positive resists, negative assists. Only two terms can go negative:
 * {@link gravityForceNewtons} on a descent, and
 * {@link aerodynamicDragForceNewtons} in a tailwind stronger than the rider's
 * ground speed. That is why these return plain `number` and not a branded
 * quantity — `@onyourleft/domain` has no signed force type, and every
 * non-negative type it does have would throw on exactly the two cases that
 * matter most.
 *
 * ## Forward motion only
 *
 * Rolling resistance and bearing friction are written as though the bicycle is
 * moving forwards, because in this model it always is: the tick in
 * `simulate.ts` clamps speed at zero and there is no reverse. A rider who stops
 * on a climb stays stopped rather than rolling back down. That is a documented
 * limitation and a deliberately safe one — a game that rolls a stationary rider
 * backwards down a hill is a worse wrong answer than one that does not.
 */

import type { GradePercent, Kilograms, MetresPerSecond } from '@onyourleft/domain';

import type { PhysicsCoefficients } from './coefficients';
import { dragAreaSquareMetres, withDefaultCoefficients } from './coefficients';
import { GRAVITY_METRES_PER_SECOND_SQUARED, gradeRatio } from './constants';

/**
 * The air velocity `V_a` the aerodynamic term is evaluated at, in metres per
 * second — Martin's `V_a = V_G + V_WTAN`.
 *
 * `headwind` is the **tangential** component of the wind: the part along the
 * direction of travel, positive into the rider's face. Resolving a wind
 * direction and a heading into that component is the caller's job, because it
 * needs a course and a compass and this package has neither.
 *
 * Signed, and it can exceed the ground speed in either direction: a 5 m/s
 * tailwind on a rider doing 3 m/s gives −2 m/s, which is air moving past the
 * rider from behind.
 */
export function airSpeedMetresPerSecond(
  groundSpeed: MetresPerSecond,
  headwindMetresPerSecond = 0,
): number {
  return groundSpeed + headwindMetresPerSecond;
}

/**
 * Aerodynamic drag, in newtons — the force behind Martin's Equation 4,
 * `P_AT = ½ ρ (C_D A + F_w) V_a² V_G`, divided through by `V_G`.
 *
 * Both drag areas are in it: the body's `C_D A` measured on a wind-tunnel
 * balance, and `F_w`, the incremental area of the spokes, which the balance
 * cannot see because the wheels turn.
 *
 * ⚠️ **`V_a · |V_a|` rather than `V_a²`.** Martin writes `V_a²` because every
 * trial in the paper had air moving towards the rider, and squaring an air
 * velocity that has gone negative would turn a strong tailwind into a strong
 * headwind — the same force, pointing the wrong way. This form is identical to
 * Equation 4 for every non-negative `V_a`, which includes the whole of the
 * paper's data and the whole of `martin-1998.test.ts`, and correct beyond it.
 */
export function aerodynamicDragForceNewtons(input: {
  readonly airSpeedMetresPerSecond: number;
  readonly airDensityKilogramsPerCubicMetre: number;
  readonly coefficients?: Partial<PhysicsCoefficients>;
}): number {
  const coefficients = withDefaultCoefficients(input.coefficients);
  const area = dragAreaSquareMetres(coefficients) + coefficients.spokeDragAreaSquareMetres;
  const speed = input.airSpeedMetresPerSecond;
  return 0.5 * input.airDensityKilogramsPerCubicMetre * area * speed * Math.abs(speed);
}

/**
 * Rolling resistance, in newtons — Martin's Equation 5,
 * `F_RR = COS[TAN⁻¹(G_R)] C_RR m_T g`.
 *
 * The cosine is there because rolling resistance acts on the force **normal to
 * the road**, which on a slope is less than the weight. The paper offers a
 * simplification (Equation 6a) that drops it, noting that for grades up to 10 %
 * the cosine is between 0.995 and 1.0; this uses the full form, because the
 * cosine costs nothing and the simplification's error grows without limit on the
 * kind of gradient a virtual world will happily contain.
 *
 * Independent of speed, and that is the point of keeping it apart from
 * {@link bearingFrictionForceNewtons}: this one scales with weight and that one
 * does not.
 */
export function rollingResistanceForceNewtons(input: {
  readonly totalMass: Kilograms;
  readonly grade: GradePercent;
  readonly coefficients?: Partial<PhysicsCoefficients>;
}): number {
  const coefficients = withDefaultCoefficients(input.coefficients);
  const slopeAngle = Math.atan(gradeRatio(input.grade));
  return (
    Math.cos(slopeAngle) *
    coefficients.rollingResistanceCoefficient *
    input.totalMass *
    GRAVITY_METRES_PER_SECOND_SQUARED
  );
}

/**
 * The along-slope component of gravity, in newtons — the force behind Martin's
 * Equation 9, `P_PE = V_G m_T g SIN[TAN⁻¹(G_R)]`.
 *
 * **Signed.** Positive on a climb, where it resists; negative on a descent,
 * where it drives. `GradePercent` is signed for exactly this reason, and
 * `packages/domain` records what dropping the sign does: every descent becomes a
 * climb, and the rider feels it in their legs rather than reading it in a log.
 *
 * As with rolling resistance, the exact `SIN[TAN⁻¹(G_R)]` is used rather than
 * the paper's small-grade simplification `G_R` (Equation 9a). The two differ by
 * 0.5 % at 10 % grade and by 11 % at 50 %.
 */
export function gravityForceNewtons(input: {
  readonly totalMass: Kilograms;
  readonly grade: GradePercent;
}): number {
  const slopeAngle = Math.atan(gradeRatio(input.grade));
  return Math.sin(slopeAngle) * input.totalMass * GRAVITY_METRES_PER_SECOND_SQUARED;
}

/**
 * Wheel-bearing friction, in newtons — `β₀ + β₁ v`.
 *
 * Martin states it as a power, Equation 7: `P_WB = V_G (91 + 8.7 V_G) 10⁻³`
 * watts, from Dahn, Mai, Poland & Jenkins' (1991) measured bearing torque.
 * Dividing by `V_G` gives the force, which is the `β₀ + β₁ v` pair of the Dahmen
 * & Saupe balance #88 quotes. `terms.test.ts` multiplies it back by speed and
 * checks it against Equation 7, so the rearrangement is asserted rather than
 * asserted-in-a-comment.
 *
 * Small — 1.4 W of 213 in the paper's worked example, about 1 % — and kept
 * separate anyway, because it is the term that does *not* vanish as the road
 * levels and the weight comes off, and folding it into `C_RR` is how a model
 * ends up wrong at walking pace.
 */
export function bearingFrictionForceNewtons(input: {
  readonly groundSpeed: MetresPerSecond;
  readonly coefficients?: Partial<PhysicsCoefficients>;
}): number {
  const coefficients = withDefaultCoefficients(input.coefficients);
  return (
    coefficients.bearingFrictionConstantNewtons +
    coefficients.bearingFrictionPerMetrePerSecondNewtonSeconds * input.groundSpeed
  );
}

/**
 * The mass an acceleration actually has to overcome, in kilograms:
 * `m_T + I/r²`, from Martin's Equation 12.
 *
 * The wheels store kinetic energy twice — once moving down the road and once
 * spinning — so accelerating them costs more than their mass suggests. With the
 * paper's numbers, `0.14 / 0.311² = 1.45 kg` on top of the system mass: about
 * 1.6 % of a 90 kg rider and bike, and 100 % of the difference between a sprint
 * that feels like a bicycle and one that does not. #88's third acceptance
 * criterion is a test that removing this changes the answer, and
 * `simulate.test.ts` holds it.
 */
export function effectiveMassKilograms(input: {
  readonly totalMass: Kilograms;
  readonly coefficients?: Partial<PhysicsCoefficients>;
}): number {
  const coefficients = withDefaultCoefficients(input.coefficients);
  const radius = coefficients.wheelRadiusMetres;
  return (
    input.totalMass + coefficients.wheelMomentOfInertiaKilogramSquareMetres / (radius * radius)
  );
}

/**
 * Every resistive force at once, in newtons, named rather than positional.
 *
 * Named fields for the reason `packages/domain`'s `GeographicPosition` uses
 * them: four numbers of the same unit and similar magnitude in a tuple is a
 * transposition nothing would catch, and here a transposed pair would produce a
 * ride that is merely a bit wrong.
 */
export interface ResistiveForces {
  readonly aerodynamicNewtons: number;
  readonly rollingResistanceNewtons: number;
  readonly gravityNewtons: number;
  readonly bearingFrictionNewtons: number;
  /** The sum of the four above — the `F` in `P_wheel = F v`. */
  readonly totalNewtons: number;
}

/** Every term of the balance, evaluated at one speed on one gradient. */
export function resistiveForces(input: {
  readonly groundSpeed: MetresPerSecond;
  readonly headwindMetresPerSecond?: number;
  readonly totalMass: Kilograms;
  readonly grade: GradePercent;
  readonly airDensityKilogramsPerCubicMetre: number;
  readonly coefficients?: Partial<PhysicsCoefficients>;
}): ResistiveForces {
  const aerodynamicNewtons = aerodynamicDragForceNewtons({
    airSpeedMetresPerSecond: airSpeedMetresPerSecond(
      input.groundSpeed,
      input.headwindMetresPerSecond,
    ),
    airDensityKilogramsPerCubicMetre: input.airDensityKilogramsPerCubicMetre,
    coefficients: input.coefficients,
  });
  const rollingResistanceNewtons = rollingResistanceForceNewtons(input);
  const gravityNewtons = gravityForceNewtons(input);
  const bearingFrictionNewtons = bearingFrictionForceNewtons(input);
  return {
    aerodynamicNewtons,
    rollingResistanceNewtons,
    gravityNewtons,
    bearingFrictionNewtons,
    totalNewtons:
      aerodynamicNewtons + rollingResistanceNewtons + gravityNewtons + bearingFrictionNewtons,
  };
}
