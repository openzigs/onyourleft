// SPDX-License-Identifier: Apache-2.0

/**
 * The tick: power in, speed and distance out, over a stated interval.
 *
 * This is the loop the whole product rests on — you push, the number moves, the
 * world moves, the hill arrives, the resistance changes. `power.ts` answers what
 * a steady state costs; this answers what happens next, which is the question a
 * ride asks 1 to 60 times a second.
 *
 * ## Deterministic and time-step independent, which is an acceptance criterion
 *
 * #88 requires the same power trace at two different tick rates to produce the
 * same distance, because "a physics model coupled to frame rate corrupts
 * silently when the renderer stalls". Two properties get that:
 *
 * 1. **The caller's tick is not the integration step.** `advance` divides the
 *    interval it is given into equal sub-steps of at most
 *    {@link DEFAULT_INTEGRATION_STEP_SECONDS} and integrates those. A 1 Hz
 *    recording tick and a 60 Hz render tick therefore run the same physics at
 *    the same resolution, and the render tick is not more accurate for being
 *    more frequent.
 * 2. **The drive is integrated in energy and the resistance in force**, in
 *    Strang's arrangement. `subStep` below records why at length; the short
 *    version is that the two halves of the problem have singular points in
 *    different places, so neither form alone is well behaved everywhere.
 *
 * Nothing here reads a clock or a random number — the inputs are the whole of
 * the state. `Date` and `Math.random` are ECMAScript built-ins that survive this
 * package's `lib: ["ES2024"]` narrowing, so that is enforced by
 * `eslint.config.js` rather than by the typechecker; `tsconfig.json` says so at
 * the point someone would otherwise assume the narrowing covered it.
 *
 * ## What it is not
 *
 * The obvious form is `a = (P/v − F)/m`, and it has a singularity at `v = 0`
 * that every implementation has to paper over — a speed floor, a force cap, a
 * special case for the first tick. Each of those is a fudge whose size depends on
 * the tick rate, which is the thing being promised not to matter. There is no
 * such fudge anywhere in this file.
 *
 * ## What it deliberately does not model
 *
 * - **Reverse.** Speed is clamped at zero, so a rider who runs out of power on a
 *   climb stops rather than rolling back. `terms.ts` records why: rolling
 *   backwards down a hill is a worse wrong answer than standing still, and
 *   nothing in Phase 1 needs the right one.
 * - **Braking, cornering, drafting, gears and cadence.** None of them is in
 *   Martin's model and none is in #88's scope.
 */

import type {
  GradePercent,
  Kilograms,
  Metres,
  MetresPerSecond,
  Seconds,
  Watts,
} from '@onyourleft/domain';
import { metres, metresPerSecond } from '@onyourleft/domain';

import type { PhysicsCoefficients } from './coefficients';
import { drivetrainEfficiency, withDefaultCoefficients } from './coefficients';
import { PhysicsError } from './physics-error';
import { effectiveMassKilograms, resistiveForces } from './terms';

/**
 * The integration sub-step, in seconds: 10 ms.
 *
 * Chosen as the coarsest step whose disagreement with a step ten times finer is
 * below what any consumer of this package can represent — `simulate.test.ts`
 * pins it at under a millimetre over a minute of hard acceleration. Finer buys
 * nothing; coarser starts to show at the moment a sprint begins, which is
 * exactly where a rider would notice.
 */
export const DEFAULT_INTEGRATION_STEP_SECONDS = 0.01;

/**
 * The most sub-steps one call to {@link advance} will take: a million, which at
 * the default step is 10 000 seconds — nearly three hours of riding asked for in
 * a single tick.
 *
 * A bound rather than a comment, because the work this function does is
 * `duration / integrationStepSeconds` and **`duration` is not always the
 * caller's own number**. `Seconds` admits any finite non-negative value, and a
 * duration differenced out of two timestamps in a user-supplied FIT, GPX or TCX
 * file is untrusted input by `SECURITY.md`'s reckoning: a file claiming a
 * two-year gap between consecutive records would otherwise put this loop on
 * about six billion iterations and hang whatever thread it is on. Malformed
 * input has to produce an error rather than resource exhaustion.
 *
 * It is not a limit on ride length. A ride is many calls, and nothing here
 * accumulates across them.
 */
export const MAXIMUM_SUB_STEPS_PER_TICK = 1_000_000;

/**
 * Everything about the ride that does not change from tick to tick.
 *
 * Separated from {@link RideStep} so that the two cannot be confused at a call
 * site, and so that a caller re-deriving air density every tick is visibly doing
 * something odd.
 */
export interface RideConditions {
  readonly totalMass: Kilograms;
  readonly airDensityKilogramsPerCubicMetre: number;
  /** Headwind positive, along the direction of travel. */
  readonly headwindMetresPerSecond?: number;
  readonly coefficients?: Partial<PhysicsCoefficients>;
  /**
   * The longest sub-step the integrator will take, in seconds. Defaults to
   * {@link DEFAULT_INTEGRATION_STEP_SECONDS}.
   *
   * A tunable rather than a constant because the trade is a real one — a mobile
   * client replaying an hour of recorded power has a different budget from a
   * live ride — but changing it changes the answer in the fifth significant
   * figure, not the second, and a caller who does not know why they are changing
   * it should not.
   */
  readonly integrationStepSeconds?: number;
}

/** One interval of the trace: a power, the road under it, and how long it lasted. */
export interface RideStep {
  /**
   * Power at the pedals, as a power meter or a trainer reports it — hence
   * `Watts` and hence non-negative. A rider producing nothing produces zero.
   */
  readonly power: Watts;
  readonly grade: GradePercent;
  readonly duration: Seconds;
}

/**
 * Where the rider is and how fast, after some number of ticks.
 *
 * Both fields are branded, unlike everything in `power.ts`, because both are
 * genuinely non-negative: this model has no reverse and distance only
 * accumulates. Returning a new state rather than mutating one is what lets a
 * caller replay a trace, checkpoint it, or run the same trace at two tick rates
 * and compare — which `simulate.test.ts` does.
 */
export interface RideState {
  readonly speed: MetresPerSecond;
  readonly distance: Metres;
}

/** A rider at rest at the start line. */
export const START_OF_RIDE: RideState = {
  speed: metresPerSecond(0),
  distance: metres(0),
};

/**
 * Advance the ride by one step of the trace.
 *
 * @throws {PhysicsError} if `integrationStepSeconds` is not strictly positive,
 * which would divide the interval into an infinite number of pieces.
 */
export function advance(state: RideState, step: RideStep, conditions: RideConditions): RideState {
  const coefficients = withDefaultCoefficients(conditions.coefficients);
  const longestSubStep = conditions.integrationStepSeconds ?? DEFAULT_INTEGRATION_STEP_SECONDS;
  if (!(longestSubStep > 0)) {
    throw new PhysicsError('the integration step must be a strictly positive number of seconds');
  }

  const effectiveMass = effectiveMassKilograms({
    totalMass: conditions.totalMass,
    coefficients,
  });
  const wheelPowerWatts = step.power * drivetrainEfficiency(coefficients);

  // The interval is split into equal sub-steps rather than into whole sub-steps
  // plus a remainder: equal ones make the integration error uniform across the
  // interval, and a remainder would have to be carried in the state, which would
  // make the result depend on how the caller had chopped up the past.
  const subStepCount = Math.max(1, Math.ceil(step.duration / longestSubStep));
  if (subStepCount > MAXIMUM_SUB_STEPS_PER_TICK) {
    throw new PhysicsError(
      `a tick of ${String(step.duration)} s at an integration step of ` +
        `${String(longestSubStep)} s is ${String(subStepCount)} sub-steps, over the ` +
        `${String(MAXIMUM_SUB_STEPS_PER_TICK)} this function will take in one call`,
    );
  }
  const subStepSeconds = step.duration / subStepCount;

  let speed: number = state.speed;
  let distance: number = state.distance;

  for (let index = 0; index < subStepCount; index += 1) {
    const nextSpeed = subStep(speed, subStepSeconds);
    distance += ((speed + nextSpeed) / 2) * subStepSeconds;
    speed = nextSpeed;
  }

  return { speed: metresPerSecond(speed), distance: metres(distance) };

  /**
   * One sub-step.
   *
   * ## The drive is integrated in energy and the resistance in force
   *
   * They are split because each form has a singular point and the two points are
   * different, so neither form alone is well behaved everywhere.
   *
   * **The drive** is `P/v`, which is infinite at rest. In energy it is `P Δt`,
   * finite everywhere and exact: `v = √(2 P t / m_eff)` from a standing start.
   *
   * **The resistance** is a force, and putting it in the energy equation means
   * multiplying it by the speed — which sends it to zero exactly where it
   * matters. That is not a rounding problem, it is a fixed point: at `v = 0` no
   * force does any work, so a bicycle standing on a descent stays there forever
   * and a coasting rider approaches rest asymptotically without ever arriving.
   * Both were observed in this package before the split, and both are now tests
   * in `simulate.test.ts` — the coast settled at 0.00027 m/s and never reached
   * zero, and a stationary rider on an 8 % descent never moved. In force,
   * `Δv = −F Δt / m_eff` is finite and non-zero at rest, which is what lets
   * gravity start the bicycle rolling and lets friction finish stopping it.
   *
   * ## Why the drive is applied in two halves around the resistance
   *
   * Splitting an evolution into two parts and applying them one after the other
   * is accurate to first order in the step; applying the first for half a step,
   * the second for a whole one and the first again for the remaining half —
   * Strang's arrangement — is accurate to second. The difference is not
   * academic here. With the naive ordering, a minute at 300 W integrated at 1 Hz
   * and at 60 Hz disagreed by 4.6 mm and the tick converged on a steady speed
   * 1.7 × 10⁻⁴ m/s from the one `steadyStateSpeedMetresPerSecond` returns; both
   * are inside this arrangement's tolerances by two orders of magnitude, and
   * both are assertions in `simulate.test.ts` rather than claims here.
   *
   * The extra half-step costs no force evaluation at all — the expensive part is
   * {@link resistiveForces}, and it is still called twice, once for the midpoint
   * estimate and once for the step itself.
   */
  function subStep(from: number, elapsed: number): number {
    const half = driven(from, elapsed / 2);
    const midpoint = resisted(half, elapsed / 2, half);
    return driven(resisted(half, elapsed, midpoint), elapsed / 2);
  }

  /** The drive alone, in energy: `v² += 2 P Δt / m_eff`. */
  function driven(from: number, elapsed: number): number {
    const squared = from * from + (2 * wheelPowerWatts * elapsed) / effectiveMass;
    return squared <= 0 ? 0 : Math.sqrt(squared);
  }

  /** The resistance alone, in force: `v −= F(evaluateAt) Δt / m_eff`. */
  function resisted(from: number, elapsed: number, evaluateAt: number): number {
    const resistiveNewtons = resistiveForces({
      groundSpeed: metresPerSecond(evaluateAt),
      headwindMetresPerSecond: conditions.headwindMetresPerSecond,
      totalMass: conditions.totalMass,
      grade: step.grade,
      airDensityKilogramsPerCubicMetre: conditions.airDensityKilogramsPerCubicMetre,
      coefficients,
    }).totalNewtons;

    const next = from - (resistiveNewtons * elapsed) / effectiveMass;

    // Clamped at zero rather than allowed to go negative. Two things depend on
    // it: a negative speed reaches `Math.sqrt` of a negative on the next drive
    // half-step, and a `NaN` speed is the quietest failure this package could
    // ship — it propagates through every later tick, every comparison against it
    // is false, and the ride simply stops reporting. And the clamp is the
    // model's statement that there is no reverse, which `metresPerSecond` would
    // otherwise enforce by throwing.
    return next <= 0 ? 0 : next;
  }
}
