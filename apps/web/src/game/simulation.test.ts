// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #91's second acceptance criterion, in its literal form, plus the accumulator
 * behaviour that makes it true.
 *
 * > *"a test drives the physics tick at a fixed rate while stalling the renderer
 * > and asserts final position is identical to an unstalled run"*
 *
 * Every assertion here compares **two runs of the same wall-clock interval at
 * different call rates**, rather than comparing one run against a hard-coded
 * distance. That is deliberate: a hard-coded number would pin the integrator's
 * output, so tuning `SIMULATION_STEP_SECONDS` would turn this file red for a
 * reason that has nothing to do with the property under test. The property is
 * *agreement*, not any particular distance.
 */

import { describe, expect, it } from 'vitest';

import {
  GameSimulation,
  MAXIMUM_STEPS_PER_ADVANCE,
  SIMULATION_STEP_SECONDS,
  atStartLine,
  type RiderInput,
  type SimulationSetup,
} from './simulation';
import { airDensityKilogramsPerCubicMetre } from '@onyourleft/physics';
import {
  altitudeMetres,
  degreesCelsius,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  kilograms,
  routeProfile,
  watts,
  type RoutePoint,
} from '@onyourleft/domain';

/** A kilometre of road with a hill in the middle, so the grade is not constant. */
function hillyRoute(): SimulationSetup {
  const points: RoutePoint[] = [];
  for (let index = 0; index <= 100; index += 1) {
    const alongMetres = index * 10;
    // Up for the first half, down for the second.
    const elevation = index <= 50 ? index * 0.6 : (100 - index) * 0.6;
    points.push({
      position: geographicPosition(
        degreesLatitude(51.5 + alongMetres / 111_320),
        degreesLongitude(-0.12),
      ),
      elevation: altitudeMetres(elevation),
    });
  }
  return {
    profile: routeProfile(points),
    conditions: {
      totalMass: kilograms(80),
      // From the ISO 2533 model rather than a literal 1.225: `packages/physics`
      // owns the constant, and a second copy of it here would be the kind of
      // number that drifts silently when the model is corrected.
      airDensityKilogramsPerCubicMetre: airDensityKilogramsPerCubicMetre(
        altitudeMetres(0),
        degreesCelsius(15),
      ),
    },
  };
}

const PEDALLING: RiderInput = { power: watts(250), live: true };

/**
 * Runs `durationSeconds` of wall-clock time through a simulation, calling
 * `advanceTo` every `framePeriodMs`.
 *
 * The frame period is what varies between an unstalled run and a stalled one.
 * Nothing else does.
 */
function runAt(framePeriodMs: number, durationSeconds: number): GameSimulation {
  const simulation = new GameSimulation(hillyRoute());
  const startMs = 1_000_000;
  simulation.advanceTo(startMs, PEDALLING);
  const endMs = startMs + durationSeconds * 1000;
  for (let nowMs = startMs + framePeriodMs; nowMs <= endMs; nowMs += framePeriodMs) {
    simulation.advanceTo(nowMs, PEDALLING);
  }
  // Land exactly on the end instant, so both runs cover the same interval even
  // when the frame period does not divide it evenly.
  simulation.advanceTo(endMs, PEDALLING);
  return simulation;
}

describe('the simulation does not depend on the render loop', () => {
  it('reaches the same position at 30 fps and at a stalled 4 fps', () => {
    const smooth = runAt(1000 / 30, 60);
    const stalled = runAt(250, 60);

    // `toBe`, not `toBeCloseTo`: the step count is derived from the two
    // instants, so the two runs are bit-identical rather than merely close.
    expect(stalled.state.ride.distance).toBe(smooth.state.ride.distance);
    expect(stalled.state.ride.speed).toBe(smooth.state.ride.speed);
    expect(stalled.state.elapsed).toBe(smooth.state.elapsed);
  });

  it('reaches the same position at 60 fps and at 30 fps', () => {
    const fast = runAt(1000 / 60, 60);
    const slow = runAt(1000 / 30, 60);

    expect(slow.state.ride.distance).toBe(fast.state.ride.distance);
  });

  it('survives a frame rate that shares no factor with the step', () => {
    // 7 ms is deliberately awkward against a 50 ms step: no call ever lands on a
    // step boundary, so every one leaves a different remainder. This is the case
    // the accumulator exists for.
    const awkward = runAt(7, 60);
    const smooth = runAt(1000 / 30, 60);

    expect(awkward.state.ride.distance).toBe(smooth.state.ride.distance);
  });

  it('reaches the same position in one enormous frame as in six hundred small ones', () => {
    // The pathological stall: the renderer produced exactly one frame in ten
    // seconds. Ten seconds is 200 steps, which is MAXIMUM_STEPS_PER_ADVANCE
    // exactly, so nothing is dropped and the two must still agree.
    const oneFrame = runAt(10_000, 10);
    const manyFrames = runAt(1000 / 60, 10);

    expect(oneFrame.state.ride.distance).toBe(manyFrames.state.ride.distance);
  });

  it('moves the rider at all, so the agreement above is not agreement on zero', () => {
    // Without this, every assertion in this file would pass against a simulation
    // that never advanced. It is the assertion that makes the others mean
    // something.
    const ridden = runAt(1000 / 30, 60);

    expect(ridden.state.ride.distance).toBeGreaterThan(100);
    expect(ridden.state.ride.speed).toBeGreaterThan(1);
  });
});

describe('the accumulator', () => {
  it('banks time too small to make a step rather than discarding it', () => {
    const simulation = new GameSimulation(hillyRoute());
    simulation.advanceTo(0, PEDALLING);

    // A third of a step. Nothing should run, and nothing should be lost.
    const tick = simulation.advanceTo(SIMULATION_STEP_SECONDS * 1000 * 0.33, PEDALLING);

    expect(tick.steps).toBe(0);
    expect(simulation.pendingSecondsAt(SIMULATION_STEP_SECONDS * 1000 * 0.33)).toBeGreaterThan(0);
    expect(simulation.state.ride.distance).toBe(0);
  });

  it('spends the banked time on a later call', () => {
    const simulation = new GameSimulation(hillyRoute());
    simulation.advanceTo(0, PEDALLING);
    // Three calls of a third of a step each: the third must produce a step.
    const third = SIMULATION_STEP_SECONDS * 1000 * 0.34;
    simulation.advanceTo(third, PEDALLING);
    simulation.advanceTo(third * 2, PEDALLING);
    const tick = simulation.advanceTo(third * 3, PEDALLING);

    expect(tick.steps).toBe(1);
  });

  it('simulates nothing on the very first call, which only sets the origin', () => {
    const simulation = new GameSimulation(hillyRoute());

    // A large `nowMs` is the normal case — `performance.now()` at ride start is
    // however long the page has been open. Treating it as elapsed time would
    // advance the ride by that much.
    const tick = simulation.advanceTo(9_999_999, PEDALLING);

    expect(tick.steps).toBe(0);
    expect(simulation.state.ride.distance).toBe(0);
  });

  it('ignores a clock that runs backwards rather than rewinding the ride', () => {
    const simulation = new GameSimulation(hillyRoute());
    simulation.advanceTo(10_000, PEDALLING);
    simulation.advanceTo(20_000, PEDALLING);
    const forward = simulation.state.ride.distance;

    const tick = simulation.advanceTo(15_000, PEDALLING);

    expect(tick.steps).toBe(0);
    expect(simulation.state.ride.distance).toBe(forward);
  });
});

describe('a stall longer than the catch-up bound', () => {
  it('reports the time it dropped instead of swallowing it', () => {
    const simulation = new GameSimulation(hillyRoute());
    simulation.advanceTo(0, PEDALLING);

    // Five minutes backgrounded. The bound is 10 s of simulation per call.
    const tick = simulation.advanceTo(300_000, PEDALLING);

    expect(tick.steps).toBe(MAXIMUM_STEPS_PER_ADVANCE);
    expect(tick.skippedSeconds).toBeGreaterThan(280);
  });

  it('does not block on a stall, which is the point of the bound', () => {
    const simulation = new GameSimulation(hillyRoute());
    simulation.advanceTo(0, PEDALLING);

    // An hour. Without the bound this is 72 000 steps in one synchronous burst,
    // on the same thread GATT notifications arrive on.
    const tick = simulation.advanceTo(3_600_000, PEDALLING);

    expect(tick.steps).toBe(MAXIMUM_STEPS_PER_ADVANCE);
  });
});

describe('a dropped sensor is not a rider who stopped pedalling', () => {
  it('contributes no power when the link is down', () => {
    const live = new GameSimulation(hillyRoute());
    const dropped = new GameSimulation(hillyRoute());
    const start = 0;
    live.advanceTo(start, PEDALLING);
    dropped.advanceTo(start, { power: watts(250), live: false });
    for (let nowMs = 100; nowMs <= 10_000; nowMs += 100) {
      live.advanceTo(nowMs, PEDALLING);
      // The same 250 W reading, but stale.
      dropped.advanceTo(nowMs, { power: watts(250), live: false });
    }

    expect(dropped.state.ride.distance).toBeLessThan(live.state.ride.distance);
  });

  it('keeps the liveness bit on the state, so the HUD can render the difference', () => {
    const simulation = new GameSimulation(hillyRoute());
    simulation.advanceTo(0, { power: watts(0), live: false });

    expect(simulation.state.input.live).toBe(false);

    simulation.advanceTo(100, { power: watts(0), live: true });

    // Same zero watts, different meaning — #94's second criterion.
    expect(simulation.state.input.live).toBe(true);
    expect(simulation.state.input.power).toBe(0);
  });
});

describe('the gradient comes from the route', () => {
  it('starts at the start line with the route’s own grade', () => {
    const setup = hillyRoute();
    const state = atStartLine(setup.profile);

    expect(state.ride.distance).toBe(0);
    expect(state.elapsed).toBe(0);
    expect(Number.isFinite(state.grade)).toBe(true);
  });

  it('changes as the rider climbs and descends', () => {
    const simulation = new GameSimulation(hillyRoute());
    simulation.advanceTo(0, PEDALLING);
    simulation.advanceTo(1_000, PEDALLING);
    const climbing = simulation.state.grade;

    // Far enough to be over the top and heading down.
    for (let nowMs = 2_000; nowMs <= 200_000; nowMs += 1_000) {
      simulation.advanceTo(nowMs, PEDALLING);
    }

    expect(simulation.state.grade).not.toBe(climbing);
  });
});
