// SPDX-License-Identifier: Apache-2.0

/**
 * The tick: determinism, time-step independence, and the two terms #88 says
 * naive implementations get wrong.
 *
 * The assertions here are properties rather than published figures — the paper
 * has no worked example of an integration — so each one is written to be a
 * property that a plausible-looking wrong implementation fails. The step-rate
 * test in particular is the one that a single explicit Euler step per tick
 * cannot pass, which is precisely the implementation someone would reach for.
 */

import { describe, expect, it } from 'vitest';

import {
  gradePercent,
  kilograms,
  seconds,
  watts,
  type GradePercent,
  type Watts,
} from '@onyourleft/domain';

import {
  advance,
  effectiveMassKilograms,
  PhysicsError,
  START_OF_RIDE,
  steadyStateSpeedMetresPerSecond,
  withDragArea,
  type RideConditions,
  type RideState,
} from './index';

const TOTAL_MASS = kilograms(82);
const AIR_DENSITY = 1.2234;

const conditions: RideConditions = {
  totalMass: TOTAL_MASS,
  airDensityKilogramsPerCubicMetre: AIR_DENSITY,
  coefficients: withDragArea(0.264),
};

/**
 * Run a constant power on a constant gradient for `totalSeconds`, in ticks of
 * `tickSeconds`.
 *
 * The trace is constant so that two tick rates are being handed the *same
 * signal* rather than two different samplings of a varying one — otherwise the
 * test would be measuring the sampling and not the integrator.
 */
function ride(options: {
  readonly powerWatts: number;
  readonly gradientPercent?: number;
  readonly totalSeconds: number;
  readonly tickSeconds: number;
  readonly from?: RideState;
  readonly conditions?: RideConditions;
}): RideState {
  const power: Watts = watts(options.powerWatts);
  const grade: GradePercent = gradePercent(options.gradientPercent ?? 0);
  const duration = seconds(options.tickSeconds);
  const tickCount = Math.round(options.totalSeconds / options.tickSeconds);

  let state = options.from ?? START_OF_RIDE;
  for (let tick = 0; tick < tickCount; tick += 1) {
    state = advance(state, { power, grade, duration }, options.conditions ?? conditions);
  }
  return state;
}

describe('time-step independence, which is an acceptance criterion', () => {
  it('covers the same distance at 1 Hz, 3 Hz and 60 Hz', () => {
    // "A physics model coupled to frame rate corrupts silently when the renderer
    // stalls." 3 Hz is in the list because its tick does not divide evenly into
    // the integrator's 10 ms sub-step, so the three runs are genuinely three
    // different discretisations rather than the same one three times.
    const atOneHertz = ride({ powerWatts: 300, totalSeconds: 60, tickSeconds: 1 });
    const atThreeHertz = ride({ powerWatts: 300, totalSeconds: 60, tickSeconds: 1 / 3 });
    const atSixtyHertz = ride({ powerWatts: 300, totalSeconds: 60, tickSeconds: 1 / 60 });

    // A millimetre over 700-odd metres. The tolerance is absolute rather than
    // relative because a millimetre is the unit a consumer of this package would
    // notice, and because a relative tolerance grows with the ride.
    expect(Math.abs(atOneHertz.distance - atThreeHertz.distance)).toBeLessThan(0.001);
    expect(Math.abs(atOneHertz.distance - atSixtyHertz.distance)).toBeLessThan(0.001);
    expect(Math.abs(atOneHertz.speed - atSixtyHertz.speed)).toBeLessThan(0.0001);
  });

  it('holds through the hardest part, the first second from a standing start', () => {
    // The singularity: at rest, `P/v` is infinite, and every implementation that
    // divides by speed has to fudge it. The fudge is what makes a tick rate
    // matter, so the first second is where a step-dependent model shows first.
    const atOneHertz = ride({ powerWatts: 600, totalSeconds: 1, tickSeconds: 1 });
    const atSixtyHertz = ride({ powerWatts: 600, totalSeconds: 1, tickSeconds: 1 / 60 });
    expect(Math.abs(atOneHertz.speed - atSixtyHertz.speed)).toBeLessThan(0.0001);
  });

  it('is exact from rest with the resistances switched off', () => {
    // With no resistance, the energy form has a closed solution: all of `P Δt`
    // becomes kinetic energy, so `v = √(2 P t / m_eff)` for any way of chopping
    // up `t`. Asserting against it pins the integrator against arithmetic rather
    // than against itself.
    const frictionless: RideConditions = {
      totalMass: TOTAL_MASS,
      airDensityKilogramsPerCubicMetre: 0,
      coefficients: {
        ...withDragArea(0),
        spokeDragAreaSquareMetres: 0,
        rollingResistanceCoefficient: 0,
        bearingFrictionConstantNewtons: 0,
        bearingFrictionPerMetrePerSecondNewtonSeconds: 0,
        drivetrainLossFraction: 0,
      },
    };
    const effectiveMass = effectiveMassKilograms({ totalMass: TOTAL_MASS });
    const expected = Math.sqrt((2 * 400 * 30) / effectiveMass);

    for (const tickSeconds of [1, 1 / 3, 1 / 60, 5]) {
      const state = ride({
        powerWatts: 400,
        totalSeconds: 30,
        tickSeconds,
        conditions: frictionless,
      });
      expect(state.speed).toBeCloseTo(expected, 9);
    }
  });
});

describe('inertia, which #88 requires to be wired in rather than present', () => {
  it('accelerates faster with the rotating mass of the wheels removed', () => {
    // The acceptance criterion, stated as a test: "removing the inertia term
    // changes the result". Removing it here means setting the wheels' moment of
    // inertia to zero, which drops `I/r² = 1.45 kg` off the mass the drive has
    // to accelerate — 1.7 % of the system, and all of it in the first seconds.
    const withInertia = ride({ powerWatts: 700, totalSeconds: 8, tickSeconds: 1 });
    const withoutInertia = ride({
      powerWatts: 700,
      totalSeconds: 8,
      tickSeconds: 1,
      conditions: {
        ...conditions,
        coefficients: {
          ...withDragArea(0.264),
          wheelMomentOfInertiaKilogramSquareMetres: 0,
        },
      },
    });

    expect(withoutInertia.speed).toBeGreaterThan(withInertia.speed);
    expect(withoutInertia.distance).toBeGreaterThan(withInertia.distance);
    // Big enough to be the term and not a rounding: centimetres over eight
    // seconds, against a millimetre tolerance on the step-rate test above.
    expect(withoutInertia.distance - withInertia.distance).toBeGreaterThan(0.05);
  });

  it('leaves a steady speed alone, because nothing is accelerating', () => {
    // The other half of "wired in": inertia must affect an acceleration and
    // must not affect an equilibrium. A model that folded `I/r²` into the mass
    // everywhere would change the rolling resistance too, and would fail this.
    const settled = steadyStateSpeedMetresPerSecond({
      powerWatts: 250,
      totalMass: TOTAL_MASS,
      grade: gradePercent(0),
      airDensityKilogramsPerCubicMetre: AIR_DENSITY,
      coefficients: withDragArea(0.264),
    });
    const heavyWheels = steadyStateSpeedMetresPerSecond({
      powerWatts: 250,
      totalMass: TOTAL_MASS,
      grade: gradePercent(0),
      airDensityKilogramsPerCubicMetre: AIR_DENSITY,
      coefficients: { ...withDragArea(0.264), wheelMomentOfInertiaKilogramSquareMetres: 5 },
    });
    expect(heavyWheels).toBeCloseTo(settled, 10);
  });
});

describe('the tick agrees with the steady state it is heading for', () => {
  it('converges on the speed the closed question returns', () => {
    // Two entry points, one model. If the drivetrain loss were applied twice in
    // one of them, or the grade converted in only one, this is where it shows —
    // and it would show nowhere else, because each function is self-consistent.
    for (const gradientPercent of [-3, 0, 4]) {
      const settled = ride({
        powerWatts: 250,
        gradientPercent,
        totalSeconds: 900,
        tickSeconds: 1,
      });
      const closedForm = steadyStateSpeedMetresPerSecond({
        powerWatts: 250,
        totalMass: TOTAL_MASS,
        grade: gradePercent(gradientPercent),
        airDensityKilogramsPerCubicMetre: AIR_DENSITY,
        coefficients: withDragArea(0.264),
      });
      expect(settled.speed).toBeCloseTo(closedForm, 5);
    }
  });
});

describe('determinism', () => {
  it('returns bit-identical results for identical inputs', () => {
    // Nothing in this package reads a clock or a random number. `Date` and
    // `Math.random` survive the `lib: ["ES2024"]` narrowing that keeps every
    // platform API out, so this is asserted here and enforced in
    // eslint.config.js rather than by the typechecker.
    const first = ride({ powerWatts: 275, gradientPercent: 3, totalSeconds: 120, tickSeconds: 1 });
    const second = ride({ powerWatts: 275, gradientPercent: 3, totalSeconds: 120, tickSeconds: 1 });
    expect(first.speed).toBe(second.speed);
    expect(first.distance).toBe(second.distance);
  });
});

describe('the cases that would put a NaN into a ride', () => {
  it('coasts to a stop rather than to a NaN', () => {
    // Zero power on the flat: the energy form drives `v²` negative at the moment
    // the rider stops, and `Math.sqrt` of a negative is NaN. A NaN speed
    // propagates through every later tick, every comparison against it is false,
    // and the ride simply stops reporting — the quietest failure this package
    // could ship.
    const rolling = ride({ powerWatts: 250, totalSeconds: 300, tickSeconds: 1 });
    expect(rolling.speed).toBeGreaterThan(5);

    const stopped = ride({
      powerWatts: 0,
      totalSeconds: 3600,
      tickSeconds: 1,
      from: rolling,
    });
    expect(Number.isNaN(stopped.speed)).toBe(false);
    expect(stopped.speed).toBe(0);
    expect(Number.isFinite(stopped.distance)).toBe(true);
    expect(stopped.distance).toBeGreaterThan(rolling.distance);
  });

  it('stays at the start line rather than rolling backwards up a climb', () => {
    // No reverse, deliberately: rolling a stationary rider backwards down a hill
    // is a worse wrong answer than standing still, and `Metres` and
    // `MetresPerSecond` are both non-negative in `packages/domain`, so a model
    // with reverse could not report its state through them at all.
    const stalled = ride({
      powerWatts: 0,
      gradientPercent: 8,
      totalSeconds: 60,
      tickSeconds: 1,
    });
    expect(stalled.speed).toBe(0);
    expect(stalled.distance).toBe(0);
  });

  it('holds a descent at a terminal speed rather than accelerating forever', () => {
    const descending = ride({
      powerWatts: 0,
      gradientPercent: -8,
      totalSeconds: 1800,
      tickSeconds: 1,
    });
    expect(descending.speed).toBeGreaterThan(10);
    expect(descending.speed).toBeLessThan(35);
  });
});

describe('inputs the integrator cannot honour', () => {
  it('refuses a zero or negative integration step', () => {
    for (const integrationStepSeconds of [0, -1]) {
      expect(() =>
        advance(
          START_OF_RIDE,
          { power: watts(200), grade: gradePercent(0), duration: seconds(1) },
          { ...conditions, integrationStepSeconds },
        ),
      ).toThrow(PhysicsError);
    }
  });

  it('takes at least one sub-step, however short the tick', () => {
    // `Math.ceil(0)` is 0, so a zero-length tick would divide by zero without
    // the floor of one. A zero-length tick is what a paused ride produces.
    const unchanged = advance(
      START_OF_RIDE,
      { power: watts(200), grade: gradePercent(0), duration: seconds(0) },
      conditions,
    );
    expect(unchanged.speed).toBe(0);
    expect(unchanged.distance).toBe(0);
  });

  it('refuses a tick so long that integrating it would be a denial of service', () => {
    // `duration` is not always the caller's own number: a duration differenced
    // out of two timestamps in a user-supplied activity file is untrusted input,
    // and a file claiming a two-year gap between consecutive records would put
    // this loop on six billion iterations. SECURITY.md requires malformed input
    // to produce an error rather than resource exhaustion.
    //
    // ⚠️ The duration here is 20 000 s — twice the bound, and no more. That is
    // deliberate. Feeding it the two-year figure makes this test *hang for
    // minutes* rather than fail when the guard is removed, because the loop it
    // then enters is synchronous and no test timeout can interrupt it. A
    // mutation has to make a test go red quickly, or nobody runs the mutation.
    expect(() =>
      advance(
        START_OF_RIDE,
        { power: watts(200), grade: gradePercent(0), duration: seconds(20_000) },
        conditions,
      ),
    ).toThrow(PhysicsError);
  });

  it('still accepts the longest tick that is under the bound', () => {
    // The bound has to be above anything legitimate, or it is a bug rather than
    // a guard. Ten thousand seconds is nearly three hours asked for in one call.
    const marathon = advance(
      START_OF_RIDE,
      { power: watts(200), grade: gradePercent(0), duration: seconds(10_000) },
      conditions,
    );
    expect(marathon.distance).toBeGreaterThan(0);
    expect(Number.isFinite(marathon.distance)).toBe(true);
  });

  it('integrates a tick longer than one sub-step by subdividing it', () => {
    // A 10-second tick is 1 000 sub-steps, not one. Without the subdivision this
    // agrees with neither the 1 Hz run nor arithmetic.
    const inOneGo = ride({ powerWatts: 300, totalSeconds: 60, tickSeconds: 10 });
    const atOneHertz = ride({ powerWatts: 300, totalSeconds: 60, tickSeconds: 1 });
    expect(Math.abs(inOneGo.distance - atOneHertz.distance)).toBeLessThan(0.001);
  });
});
