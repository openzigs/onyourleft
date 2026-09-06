// SPDX-License-Identifier: Apache-2.0

/**
 * A whole ride, through the public entry point only.
 *
 * **This file is the package's first consumer**, and it exists because building
 * one is when an interface's defects surface. Everything else in this suite
 * calls one function and checks one property; this drives a varied profile the
 * way `apps/web` will — a second at a time, keeping the state it is handed back,
 * reading only what `@onyourleft/physics` exports — and then asks questions of
 * the result that no single call could answer.
 *
 * ⚠️ It is **not** a substitute for the real consumer. #88's revision block
 * scopes this issue to `packages/physics` alone and says `apps/web` (#51) is
 * running in parallel, so this package ships with no production caller. What
 * this file can and does establish is that the exported surface is sufficient to
 * run a ride, and that the two numbers it hands back agree with each other and
 * with an independent recomputation. What it cannot establish is that the shape
 * suits the screen.
 *
 * ## The defect shape it is written against
 *
 * "A write that reports success while the read cannot see it" has a form here
 * that line coverage cannot see: `advance` returns a speed **and** a distance,
 * and the distance is the one nothing else checks. A distance accumulated into a
 * local and not returned, accumulated before the speed update rather than across
 * it, or reset each tick, leaves every speed assertion in this package green.
 * So the distance is read back and cross-checked against the speeds that were
 * reported alongside it, and against the energy that went in.
 */

import { describe, expect, it } from 'vitest';

import {
  altitudeMetres,
  degreesCelsius,
  gradePercent,
  kilograms,
  metresPerSecond,
  seconds,
  watts,
} from '@onyourleft/domain';

import {
  advance,
  airDensityKilogramsPerCubicMetre,
  powerRequired,
  resistiveForces,
  START_OF_RIDE,
  withDragArea,
  type RideConditions,
  type RideState,
} from './index';

const TOTAL_MASS = kilograms(82);
const DRAG_AREA = 0.264;

/** Sea level on a mild day, computed rather than assumed — as a consumer would. */
const AIR_DENSITY = airDensityKilogramsPerCubicMetre(altitudeMetres(0), degreesCelsius(15));

const conditions: RideConditions = {
  totalMass: TOTAL_MASS,
  airDensityKilogramsPerCubicMetre: AIR_DENSITY,
  coefficients: withDragArea(DRAG_AREA),
};

/**
 * A ride with a shape to it: settle on the flat, climb, crest, descend, then a
 * sprint on the way home. Each entry is `[power in watts, gradient in per cent,
 * seconds]`.
 */
const PROFILE: readonly (readonly [number, number, number])[] = [
  [200, 0, 300],
  [280, 5, 600],
  [180, 0, 60],
  [90, -5, 400],
  [220, 0, 200],
  [550, 0, 20],
  [0, 0, 400],
];

interface Sample {
  readonly secondsIn: number;
  readonly state: RideState;
  readonly powerWatts: number;
  readonly gradientPercent: number;
}

/** Replay the profile at `hertz`, keeping every intermediate state. */
function replay(hertz: number): readonly Sample[] {
  const tickSeconds = 1 / hertz;
  const duration = seconds(tickSeconds);
  const samples: Sample[] = [
    { secondsIn: 0, state: START_OF_RIDE, powerWatts: 0, gradientPercent: 0 },
  ];

  let state = START_OF_RIDE;
  let secondsIn = 0;
  for (const [powerWatts, gradientPercent, segmentSeconds] of PROFILE) {
    const grade = gradePercent(gradientPercent);
    const power = watts(powerWatts);
    for (let tick = 0; tick < segmentSeconds * hertz; tick += 1) {
      state = advance(state, { power, grade, duration }, conditions);
      secondsIn += tickSeconds;
      samples.push({ secondsIn, state, powerWatts, gradientPercent });
    }
  }
  return samples;
}

const atOneHertz = replay(1);
const finish = atOneHertz[atOneHertz.length - 1];

/** Narrowing for `noUncheckedIndexedAccess`, which is on across this workspace. */
function required<T>(value: T | undefined, what: string): T {
  if (value === undefined) {
    throw new Error(`the replay produced no ${what}`);
  }
  return value;
}

const finished = required(finish, 'finishing sample');

describe('a ride that a consumer could actually drive', () => {
  it('produces a plausible ride, not merely a finite one', () => {
    // 1 700 seconds with a five-minute climb in it. The band is wide because
    // this is a sanity check on the order of magnitude, not on the model — the
    // model is pinned against the paper in martin-1998.test.ts.
    expect(finished.state.distance).toBeGreaterThan(8000);
    expect(finished.state.distance).toBeLessThan(20000);
  });

  it('never reports a NaN speed or a NaN distance, anywhere in the ride', () => {
    for (const sample of atOneHertz) {
      expect(Number.isFinite(sample.state.speed)).toBe(true);
      expect(Number.isFinite(sample.state.distance)).toBe(true);
    }
  });

  it('accumulates distance monotonically and never rewinds it', () => {
    // The distance is the field nothing else in this package reads back. An
    // accumulator that was reset per tick, or written before the speed update
    // rather than across it, is invisible to every speed assertion here.
    let previous = -1;
    for (const sample of atOneHertz) {
      expect(sample.state.distance).toBeGreaterThanOrEqual(previous);
      previous = sample.state.distance;
    }
  });

  it('agrees with the speeds it reported alongside it', () => {
    // Recompute the distance by integrating the reported speeds — a different
    // path to the same number. A distance that came from anywhere other than
    // the speed the same call returned shows up here.
    let integrated = 0;
    for (let index = 1; index < atOneHertz.length; index += 1) {
      const before = required(atOneHertz[index - 1], 'preceding sample');
      const after = required(atOneHertz[index], 'sample');
      integrated += ((before.state.speed + after.state.speed) / 2) * 1;
    }
    // A relative tolerance, and a loose-looking one, because the two sides are
    // integrated at different resolutions: this audit sees the reported states
    // once a second, and `advance` integrated the same ride a hundred times a
    // second. 27 parts per million is what that difference is worth over 16 km.
    // A distance that came from anywhere other than the speed the same call
    // returned would be out by orders of magnitude, not by parts per million.
    expect(Math.abs(integrated - finished.state.distance) / finished.state.distance).toBeLessThan(
      1e-4,
    );
  });

  it('slows on the climb and gathers speed on the descent', () => {
    const speedAt = (secondsIn: number): number =>
      required(
        atOneHertz.find((sample) => sample.secondsIn === secondsIn),
        `sample at ${String(secondsIn)} s`,
      ).state.speed;

    const endOfFirstFlat = speedAt(300);
    const endOfClimb = speedAt(900);
    const endOfDescent = speedAt(1360);

    expect(endOfClimb).toBeLessThan(endOfFirstFlat);
    expect(endOfDescent).toBeGreaterThan(endOfFirstFlat);
    // A 5 % climb at 280 W on 82 kg is a genuine climb, not a gentle rise: the
    // rider should be in single figures of metres per second.
    expect(endOfClimb).toBeLessThan(6);
  });

  it('comes to rest during the freewheel at the end', () => {
    // Exactly zero, not merely small. Reaching rest is what the energy audit
    // below depends on — it is what makes the kinetic term zero at both ends and
    // lets the audit drop it — and it is the behaviour that the force-form
    // resistance exists to make possible at all.
    expect(finished.state.speed).toBe(0);
  });
});

describe('the ride is the same ride at a different tick rate', () => {
  it('covers the same ground at 1 Hz and 4 Hz', () => {
    // The whole profile, not a constant power — the segments are aligned on both
    // rates, so this is the same signal sampled twice rather than two signals.
    const atFourHertz = replay(4);
    const other = required(atFourHertz[atFourHertz.length - 1], 'finishing sample');
    expect(Math.abs(other.state.distance - finished.state.distance)).toBeLessThan(0.01);
    expect(other.state.speed).toBe(finished.state.speed);
  });
});

describe('energy in equals energy out, which no single call can check', () => {
  it('balances the drive against kinetic energy, resistance and the hill', () => {
    // The physicist's audit. Over the whole ride the work the drive delivered to
    // the wheel has to equal the change in kinetic energy plus the work done
    // against every resistive force, gravity included. The right-hand side is
    // recomputed here from `resistiveForces` and the reported states — the
    // exported term functions, not `advance`'s internals — so a term applied to
    // the wrong quantity inside the integrator does not cancel out of both
    // sides.
    const efficiency = 1 - 0.024;
    let driveJoules = 0;
    let resistiveJoules = 0;

    for (let index = 1; index < atOneHertz.length; index += 1) {
      const before = required(atOneHertz[index - 1], 'preceding sample');
      const after = required(atOneHertz[index], 'sample');
      driveJoules += after.powerWatts * efficiency * 1;

      const travelled = after.state.distance - before.state.distance;
      const meanSpeed = (before.state.speed + after.state.speed) / 2;
      resistiveJoules +=
        resistiveForces({
          groundSpeed: metresPerSecond(meanSpeed),
          totalMass: TOTAL_MASS,
          grade: gradePercent(after.gradientPercent),
          airDensityKilogramsPerCubicMetre: AIR_DENSITY,
          coefficients: withDragArea(DRAG_AREA),
        }).totalNewtons * travelled;
    }

    // The ride finishes at rest, so the kinetic energy term is zero at both ends
    // and drops out. 0.5 % is the band: the two sides are integrated at
    // different resolutions — the audit at 1 Hz from the reported states, the
    // model at 100 Hz inside `advance` — so they cannot agree exactly, and a
    // term that was missing or doubled would be out by tens of per cent.
    expect(Math.abs(driveJoules - resistiveJoules) / driveJoules).toBeLessThan(0.005);
  });
});

describe('the two entry points describe the same bicycle', () => {
  it('costs what powerRequired says it costs, at the speed advance settles on', () => {
    // `advance` and `powerRequired` share the force terms but not the arithmetic
    // around them — one integrates, the other multiplies. Where they are asked
    // the same question they must give the same answer, and a drivetrain loss
    // applied twice in one of them would show up nowhere else.
    const settled = required(
      atOneHertz.find((sample) => sample.secondsIn === 300),
      'sample at 300 s',
    );
    const cost = powerRequired({
      groundSpeed: settled.state.speed,
      totalMass: TOTAL_MASS,
      grade: gradePercent(0),
      airDensityKilogramsPerCubicMetre: AIR_DENSITY,
      coefficients: withDragArea(DRAG_AREA),
    });
    // Five minutes at 200 W on the flat is close to but not exactly settled, so
    // this is a watt rather than a milliwatt.
    expect(Math.abs(cost.totalWatts - 200)).toBeLessThan(1);
  });
});
