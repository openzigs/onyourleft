// SPDX-License-Identifier: Apache-2.0

/**
 * Two builds, the same inputs, the same position — #465's second criterion.
 *
 * ## What this is for, and why `simulate.test.ts`'s determinism case is not it
 *
 * That case runs the same trace twice **in one process** and requires
 * bit-identical results. It is worth having: it is what says nothing here reads
 * a clock or a random number. It says nothing at all about **two different
 * builds** agreeing, because both halves of it move together whenever this
 * package changes.
 *
 * [ADR 0028](../../../docs/adr/0028-racing-fairness.md) D-2 puts a race's
 * authority in a **re-simulation**: a room recomputes every rider's position
 * from their reported power and declared mass and its answer is the one that
 * counts. That is only meaningful if the room's arithmetic and the client's
 * arithmetic are the same arithmetic. Every rider's client is a build, the room
 * is a build, and they are not guaranteed to be the same build — a rider on a
 * stale tab, an old APK, or a client that simply has not updated yet. So the
 * property this file pins is:
 *
 * > **Given identical declared inputs, the position this package computes is a
 * > fixed number, and changing it is a visible event rather than a silent one.**
 *
 * ## ⚠️ How to read a failure here. It is probably NOT a bug
 *
 * A red assertion below means **the model's answer has moved**. That is a
 * perfectly legitimate thing to do — a better coefficient, a better integrator,
 * a corrected default. What it is not is a thing that can be done **silently**
 * once a race exists, because a client on the old number and a room on the new
 * one will disagree about who won.
 *
 * So the repair is a decision, not an edit:
 *
 * 1. If nothing races yet — which is true today; ADR 0028 D-0 and owner
 *    decision D6 mean there is no room — update the vectors below **in the same
 *    commit as the change**, and say in the pull request that the model's
 *    answer moved.
 * 2. If anything races, the change needs a **physics version on the wire**, so
 *    a room can refuse a client whose arithmetic it does not share. ADR 0028
 *    D-2 §"What a room checks" states that rule; this test is where it becomes
 *    visible.
 *
 * ⚠️ **Do not "fix" a failure by loosening the comparison.** `toBeCloseTo`
 * here would be a test that cannot fail for the thing it exists to catch: a
 * coefficient change in the fourth significant figure is exactly the change
 * that moves a sprint finish by a wheel and passes a tolerance.
 *
 * ## What it deliberately does NOT establish
 *
 * - **Nothing about racing.** No room, no transport, no client: #466 and
 *   ADR 0028 D-0 both hold, and this file is arithmetic over a package that has
 *   shipped since #88.
 * - **Nothing about floating-point reproducibility across CPU architectures.**
 *   IEEE 754 double arithmetic is exactly specified for `+ - * /` and
 *   `Math.sqrt`, and this model uses those; `Math.pow` and the transcendentals
 *   are **not** exactly specified across implementations, and `terms.ts` uses
 *   none. That is an argument, not a measurement — this suite has only ever run
 *   on one architecture. ADR 0028 §"What would make this ADR wrong" carries it.
 */

import { describe, expect, it } from 'vitest';

import {
  gradePercent,
  kilograms,
  seconds,
  watts,
  type GradePercent,
  type Seconds,
  type Watts,
} from '@onyourleft/domain';

import { advance, START_OF_RIDE, type RideConditions, type RideState } from './simulate';

/**
 * Every input written out, so a vector below depends on no default.
 *
 * ⚠️ The **coefficients are deliberately left to the package's own defaults**,
 * which is the opposite choice and is the point: a race's clients and its room
 * would use the defaults, so the defaults are what has to be pinned. Mass, air
 * density and the integration step are spelled out because a vector that
 * depended on a *caller's* choice would be pinning the caller instead.
 */
const CONDITIONS: RideConditions = {
  totalMass: kilograms(83),
  airDensityKilogramsPerCubicMetre: 1.225,
  integrationStepSeconds: 0.01,
};

/** A minute of riding with a hill in it, one second at a time. */
const TRACE: readonly { readonly power: Watts; readonly grade: GradePercent }[] = [
  ...Array.from({ length: 20 }, () => ({ power: watts(240), grade: gradePercent(0) })),
  ...Array.from({ length: 20 }, () => ({ power: watts(310), grade: gradePercent(6.5) })),
  ...Array.from({ length: 20 }, () => ({ power: watts(150), grade: gradePercent(-3.25) })),
];

const ONE_SECOND: Seconds = seconds(1);

function rideTheTrace(conditions: RideConditions = CONDITIONS): RideState {
  let state = START_OF_RIDE;
  for (const { power, grade } of TRACE) {
    state = advance(state, { power, grade, duration: ONE_SECOND }, conditions);
  }
  return state;
}

/**
 * The vectors, as the **exact decimal a double prints**.
 *
 * Strings rather than numbers so that a mismatch's failure message shows every
 * digit: `expected 18.9 to be 18.900000000000002` is a message somebody can act
 * on, and `toBe` over two numbers prints the same thing less clearly.
 */
const EXPECTED = {
  speed: '11.605527975586563',
  distance: '437.13957276200534',
} as const;

describe('one physics for everyone — #465 criterion 2, ADR 0028 D-1', () => {
  it('computes a fixed position from a fixed trace, digit for digit', () => {
    const settled = rideTheTrace();
    expect(String(settled.speed)).toBe(EXPECTED.speed);
    expect(String(settled.distance)).toBe(EXPECTED.distance);
  });

  it('gets there from inputs built separately, so nothing is carried between the two', () => {
    // ⚠️ The "two clients" half. Object identity is what a single-process
    // determinism test accidentally shares: two runs over the SAME frozen
    // objects would pass even for a model that cached on its input's identity.
    // These are two independently constructed condition objects with equal
    // values.
    const a = rideTheTrace({
      totalMass: kilograms(83),
      airDensityKilogramsPerCubicMetre: 1.225,
      integrationStepSeconds: 0.01,
    });
    const b = rideTheTrace({
      totalMass: kilograms(83),
      airDensityKilogramsPerCubicMetre: 1.225,
      integrationStepSeconds: 0.01,
    });
    expect(Object.is(a.speed, b.speed)).toBe(true);
    expect(Object.is(a.distance, b.distance)).toBe(true);
    expect(String(a.distance)).toBe(EXPECTED.distance);
  });

  it('moves the moment any declared input differs, which is what makes the pin worth having', () => {
    // Non-vacuity. Without this, a model that ignored its conditions entirely
    // would satisfy every assertion above — it would be beautifully
    // deterministic and would compute the same position for a 60 kg climber and
    // a 95 kg sprinter, which is the one thing a race may not do.
    const heavier = rideTheTrace({ ...CONDITIONS, totalMass: kilograms(95) });
    expect(String(heavier.distance)).not.toBe(EXPECTED.distance);

    const thinnerAir = rideTheTrace({ ...CONDITIONS, airDensityKilogramsPerCubicMetre: 1.0 });
    expect(String(thinnerAir.distance)).not.toBe(EXPECTED.distance);

    // And the mass must move it in the direction physics requires: the trace is
    // dominated by a 6.5 % climb, so the heavier rider covers less ground.
    expect(heavier.distance).toBeLessThan(Number(EXPECTED.distance));
  });

  it('does not depend on the caller’s tick rate, which two clients need not share', () => {
    // ⚠️ A room samples at whatever rate it receives reports; a client ticks at
    // its own. `simulate.ts` divides any interval into sub-steps of at most
    // `integrationStepSeconds`, so the two agree to the integrator's accuracy
    // rather than exactly — which is why this one is `toBeCloseTo` where the
    // vectors above are `toBe`, and the distinction is the whole reason both
    // assertions exist.
    let state = START_OF_RIDE;
    for (const { power, grade } of TRACE) {
      for (let half = 0; half < 2; half += 1) {
        state = advance(state, { power, grade, duration: seconds(0.5) }, CONDITIONS);
      }
    }
    expect(state.distance).toBeCloseTo(Number(EXPECTED.distance), 6);
    expect(state.speed).toBeCloseTo(Number(EXPECTED.speed), 6);
  });
});
