// SPDX-License-Identifier: Apache-2.0

/**
 * The forward model — Martin's Equations 13 and 15 — and its inverse at
 * equilibrium.
 *
 * `powerRequired` answers "what did this trial cost?", which is the question the
 * paper validates against an SRM and therefore the question
 * `martin-1998.test.ts` can check against published numbers.
 * `steadyStateSpeedMetresPerSecond` answers "how fast does this rider go?",
 * which is what the product needs, and it is implemented by solving the first
 * one so that the two cannot drift apart.
 */

import type { GradePercent, Kilograms, MetresPerSecond, Seconds } from '@onyourleft/domain';
import { metresPerSecond } from '@onyourleft/domain';

import type { PhysicsCoefficients } from './coefficients';
import { drivetrainEfficiency, withDefaultCoefficients } from './coefficients';
import { PhysicsError } from './physics-error';
import {
  airSpeedMetresPerSecond,
  effectiveMassKilograms,
  resistiveForces,
  type ResistiveForces,
} from './terms';

/**
 * A change of speed over an interval, for Martin's Equation 12.
 *
 * Present as an interval rather than as an acceleration because that is the form
 * the paper's data comes in and the form a 1 Hz record loop produces: two
 * samples and the time between them. An acceleration would have to be
 * differenced out of exactly this and then integrated back.
 */
export interface VelocityChange {
  readonly initialSpeed: MetresPerSecond;
  readonly finalSpeed: MetresPerSecond;
  readonly duration: Seconds;
}

/** One trial: a speed, a road, an atmosphere, and optionally an acceleration. */
export interface PowerRequirementInput {
  /** `V_G`. Where an interval is given, this is its mean ground speed. */
  readonly groundSpeed: MetresPerSecond;
  /** `V_WTAN` — the wind component along the direction of travel, headwind positive. */
  readonly headwindMetresPerSecond?: number;
  /** `m_T` — rider plus bicycle plus anything either is carrying. */
  readonly totalMass: Kilograms;
  readonly grade: GradePercent;
  /** `ρ`. {@link airDensityKilogramsPerCubicMetre} in `air.ts` computes one. */
  readonly airDensityKilogramsPerCubicMetre: number;
  /** Omitted for a steady speed, where Equation 12 contributes nothing. */
  readonly velocityChange?: VelocityChange;
  readonly coefficients?: Partial<PhysicsCoefficients>;
}

/**
 * The power a trial required, broken into the terms of Equation 13.
 *
 * Every field is watts and every field is **signed**: a descent puts power into
 * the system and a deceleration returns it, so `potentialEnergyWatts` and
 * `kineticEnergyWatts` both go negative and `totalWatts` can. That is why none
 * of them is a `Watts` — `packages/domain`'s power type is a non-negative
 * magnitude, and constructing one here would throw on the first descent.
 *
 * The breakdown is returned rather than only the total because #88 requires the
 * terms to be individually testable, and because a term is far easier to
 * recognise as wrong beside its siblings than inside a sum.
 */
export interface PowerRequirement {
  /** `V_a`, echoed back: it is derived here and it is the input most often wrong. */
  readonly airSpeedMetresPerSecond: number;
  /** `P_AT` — Equation 4. */
  readonly aerodynamicWatts: number;
  /** `P_RR` — Equation 6. */
  readonly rollingResistanceWatts: number;
  /** `P_WB` — Equation 7. */
  readonly bearingFrictionWatts: number;
  /** `P_PE` — Equation 9. Negative descending. */
  readonly potentialEnergyWatts: number;
  /** `P_KE` — Equation 12. Negative when slowing. Zero without a velocity change. */
  readonly kineticEnergyWatts: number;
  /** `P_NET` — Equation 13, the power at the wheel. */
  readonly netWatts: number;
  /** `P_TOT` — Equation 15, the power at the pedals: `P_NET / E_C`. */
  readonly totalWatts: number;
  /** The same balance as forces, for a caller that wants newtons. */
  readonly forces: ResistiveForces;
}

/**
 * Power at the pedals for one trial — Martin Equations 13 and 15.
 *
 * @throws {PhysicsError} if a velocity change is given with a zero duration,
 * which is a division by zero producing `±Infinity` or `NaN` — a value that
 * would then travel through a whole ride looking like a number.
 */
export function powerRequired(input: PowerRequirementInput): PowerRequirement {
  const coefficients = withDefaultCoefficients(input.coefficients);
  const forces = resistiveForces(input);
  const speed = input.groundSpeed;

  const aerodynamicWatts = forces.aerodynamicNewtons * speed;
  const rollingResistanceWatts = forces.rollingResistanceNewtons * speed;
  const bearingFrictionWatts = forces.bearingFrictionNewtons * speed;
  const potentialEnergyWatts = forces.gravityNewtons * speed;
  const kineticEnergyWatts = kineticEnergyPowerWatts(input, coefficients);

  const netWatts =
    aerodynamicWatts +
    rollingResistanceWatts +
    bearingFrictionWatts +
    potentialEnergyWatts +
    kineticEnergyWatts;

  return {
    airSpeedMetresPerSecond: airSpeedMetresPerSecond(speed, input.headwindMetresPerSecond),
    aerodynamicWatts,
    rollingResistanceWatts,
    bearingFrictionWatts,
    potentialEnergyWatts,
    kineticEnergyWatts,
    netWatts,
    totalWatts: netWatts / drivetrainEfficiency(coefficients),
    forces,
  };
}

/** Equation 12: `½ (m_T + I/r²)(V_Gf² − V_Gi²)/(t_f − t_i)`. */
function kineticEnergyPowerWatts(
  input: PowerRequirementInput,
  coefficients: PhysicsCoefficients,
): number {
  const change = input.velocityChange;
  if (change === undefined) {
    return 0;
  }
  if (change.duration <= 0) {
    throw new PhysicsError('a velocity change over zero seconds is not a rate of change');
  }
  const effectiveMass = effectiveMassKilograms({ totalMass: input.totalMass, coefficients });
  const squaredSpeedChange =
    change.finalSpeed * change.finalSpeed - change.initialSpeed * change.initialSpeed;
  return (0.5 * effectiveMass * squaredSpeedChange) / change.duration;
}

/** The steady-state problem: a power and a road, with no acceleration in it. */
export interface SteadyStateInput {
  /**
   * Power at the pedals. A plain number rather than a `Watts`, for symmetry with
   * {@link PowerRequirement} — though unlike those it must be strictly positive.
   */
  readonly powerWatts: number;
  readonly totalMass: Kilograms;
  readonly grade: GradePercent;
  readonly airDensityKilogramsPerCubicMetre: number;
  readonly headwindMetresPerSecond?: number;
  readonly coefficients?: Partial<PhysicsCoefficients>;
}

/**
 * The fastest speed at which a rider is nowhere to be found. No bicycle reaches
 * it; it exists so that the bracket search below terminates.
 */
const SEARCH_CEILING_METRES_PER_SECOND = 200;

/**
 * Bisection steps. A fixed count rather than a convergence tolerance,
 * deliberately: a fixed count is the same work and the same answer for every
 * input, and #88 requires the model to be deterministic. Eighty halvings of a
 * 200 m/s bracket is 1.7 × 10⁻²², far below what a double can represent at these
 * magnitudes, so the loop is exact to machine precision and could not be made
 * more accurate by running longer.
 */
const BISECTION_STEPS = 80;

/**
 * The speed at which a rider holding `powerWatts` stops accelerating — the
 * inverse of {@link powerRequired} with the kinetic term set to zero.
 *
 * This is the "power in, speed out" of #88's title, for the steady case. The
 * unsteady case is `advance` in `simulate.ts`, which is what a ride actually
 * uses; this is for the questions that have a single answer — what does 250 W
 * get me on this gradient, where does a rider settle after the hill.
 *
 * Solved numerically rather than in closed form. The equation is a cubic in
 * speed with a linear term and a `cos(atan)` in its coefficients, and the paper
 * itself calls it "a complex, third-order, polynomial equation"; a bisection
 * over a bracketed root is fifteen lines and cannot pick the wrong root of the
 * three or fail on a discriminant.
 *
 * @throws {PhysicsError} if `powerWatts` is not strictly positive — at or below
 * zero the root is not unique and "the speed a coasting rider holds" is a
 * different question, asked of `advance`.
 * @throws {PhysicsError} if no speed below 200 m/s costs that much power, which
 * takes a power in the megawatts.
 */
export function steadyStateSpeedMetresPerSecond(input: SteadyStateInput): number {
  if (!(input.powerWatts > 0)) {
    throw new PhysicsError(
      'a steady-state speed is only defined for a strictly positive power; ' +
        'for a coast or a soft-pedal down a hill, integrate with advance()',
    );
  }

  const costAt = (speed: number): number =>
    powerRequired({
      groundSpeed: metresPerSecond(speed),
      headwindMetresPerSecond: input.headwindMetresPerSecond,
      totalMass: input.totalMass,
      grade: input.grade,
      airDensityKilogramsPerCubicMetre: input.airDensityKilogramsPerCubicMetre,
      coefficients: input.coefficients,
    }).totalWatts;

  // At zero speed every term of the balance is multiplied by zero, so the cost
  // is zero and the lower end of the bracket is below any positive target.
  let low = 0;
  let high = 1;
  // #164: the doubling is clamped to the ceiling rather than allowed to step
  // past it. It used to go 1, 2, 4 … 128, 256 and throw once `high` exceeded
  // 200 — so the real bracket top was 128 and the message named a limit the
  // search never reached. Clamping makes the sentence it throws true: the
  // ceiling is tried before the refusal, so "no speed below 200 m/s" is a
  // statement about a speed that was actually costed.
  while (costAt(high) < input.powerWatts) {
    if (high >= SEARCH_CEILING_METRES_PER_SECOND) {
      throw new PhysicsError(
        `no speed below ${String(SEARCH_CEILING_METRES_PER_SECOND)} m/s costs ` +
          `${String(input.powerWatts)} W on this road`,
      );
    }
    high = Math.min(high * 2, SEARCH_CEILING_METRES_PER_SECOND);
  }

  for (let step = 0; step < BISECTION_STEPS; step += 1) {
    const middle = (low + high) / 2;
    if (costAt(middle) < input.powerWatts) {
      low = middle;
    } else {
      high = middle;
    }
  }
  return (low + high) / 2;
}
