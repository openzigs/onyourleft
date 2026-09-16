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
  ghostClock,
  type RiderInput,
  type SimulationSetup,
} from './simulation';
import {
  BOT_AT_START_LINE,
  advanceBot,
  airDensityKilogramsPerCubicMetre,
  type BotCourse,
} from '@onyourleft/physics';
import {
  altitudeMetres,
  botPacerPlan,
  degreesCelsius,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  kilograms,
  routeProfile,
  seconds,
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
    // The ridden clock agrees too, which is what #254 needs of it: it is a
    // function of the steps integrated, and the two runs integrated the same
    // ones. Only a stall can move it away from `elapsed`.
    expect(stalled.state.ridden).toBe(smooth.state.ridden);
    expect(stalled.state.ridden).toBe(stalled.state.elapsed);
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

  it('keeps the wall clock and the ridden clock apart, by exactly what it dropped', () => {
    // #254. `elapsed` is what the ride lasted and `ridden` is what it covered,
    // and a stall is the only thing that separates them. Asserting the
    // arithmetic rather than two independent numbers is what stops a future
    // `ridden` that quietly tracks `elapsed` again.
    const simulation = new GameSimulation(hillyRoute());
    simulation.advanceTo(0, PEDALLING);
    const tick = simulation.advanceTo(300_000, PEDALLING);

    const bound = MAXIMUM_STEPS_PER_ADVANCE * SIMULATION_STEP_SECONDS;
    expect(simulation.state.ridden).toBe(bound);
    expect(simulation.state.elapsed).toBeCloseTo(bound + tick.skippedSeconds, 9);
    expect(simulation.state.elapsed).toBeGreaterThan(simulation.state.ridden);
  });

  it('is the ridden clock that every racer is read against, never the wall one', () => {
    const simulation = new GameSimulation(hillyRoute());
    simulation.advanceTo(0, PEDALLING);
    simulation.advanceTo(300_000, PEDALLING);

    expect(ghostClock(simulation.state)).toBe(simulation.state.ridden);
    expect(ghostClock(simulation.state)).not.toBe(simulation.state.elapsed);
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

/**
 * The bot pacer, once the simulation is the thing that advances it — #237.
 *
 * ⚠️ **These are wiring assertions, not arithmetic ones.** `packages/physics`'s
 * own `pacer.test.ts` already proves `advanceBot` is right and that it goes
 * through `advance`; every one of those tests passed against a product with no
 * pacer in it, which is #237's own complaint. What is missing is a test that
 * fails when the *client* stops calling it, and that is what this block is.
 *
 * The central assertion is {@link advanceBot}-for-`advanceBot` equality against
 * a course this file builds itself. It is strong in three separate directions
 * at once: a second integrator in the client diverges, a bot advanced at the
 * wrong step size diverges, and a bot ridden at the rider's own mass diverges.
 */
describe('the bot pacer', () => {
  /** The plan a rider choosing 2.5 w/kg gets. */
  const PLAN = botPacerPlan(2.5);

  /** The course the bot should be riding, assembled here and not imported. */
  function course(setup: SimulationSetup): BotCourse {
    return {
      profile: setup.profile,
      plan: PLAN,
      airDensityKilogramsPerCubicMetre: setup.conditions.airDensityKilogramsPerCubicMetre,
    };
  }

  /** `advanceBot` run directly, one fixed step at a time. */
  function reference(setup: SimulationSetup, steps: number, using: BotCourse = course(setup)) {
    let state = BOT_AT_START_LINE;
    for (let step = 0; step < steps; step += 1) {
      state = advanceBot(state, seconds(SIMULATION_STEP_SECONDS), using).state;
    }
    return state;
  }

  it('is absent when the rider did not choose one', () => {
    const simulation = new GameSimulation(hillyRoute());
    simulation.advanceTo(0, PEDALLING);
    simulation.advanceTo(10_000, PEDALLING);

    expect(simulation.state.bot).toBeUndefined();
  });

  it('is on the start line before the first tick, so a frame has it to draw', () => {
    const setup = { ...hillyRoute(), pacer: PLAN };
    const simulation = new GameSimulation(setup);

    expect(simulation.state.bot?.state.distance).toBe(0);
    expect(simulation.state.bot?.power).toBeGreaterThan(0);
  });

  it('rides the route the rider is on', () => {
    const setup = { ...hillyRoute(), pacer: PLAN };
    const simulation = new GameSimulation(setup);
    simulation.advanceTo(0, PEDALLING);
    simulation.advanceTo(30_000, PEDALLING);

    expect(simulation.state.bot?.state.distance).toBeGreaterThan(0);
  });

  it('goes through advanceBot, step for step, and through nothing else', () => {
    const setup = { ...hillyRoute(), pacer: PLAN };
    const simulation = new GameSimulation(setup);
    simulation.advanceTo(0, PEDALLING);
    // Exactly 100 fixed steps of wall clock.
    simulation.advanceTo(100 * SIMULATION_STEP_SECONDS * 1000, PEDALLING);

    const expected = reference(setup, 100);
    // Exact, not close: this is the same arithmetic or it is not the same
    // arithmetic. A tolerance here would admit the second integrator the
    // criterion exists to forbid.
    expect(simulation.state.bot?.state.distance).toBe(expected.distance);
    expect(simulation.state.bot?.state.speed).toBe(expected.speed);
  });

  it('rides at the bot’s mass and not the rider’s', () => {
    const setup = { ...hillyRoute(), pacer: PLAN };
    const simulation = new GameSimulation(setup);
    simulation.advanceTo(0, PEDALLING);
    simulation.advanceTo(100 * SIMULATION_STEP_SECONDS * 1000, PEDALLING);

    const atRidersMass = reference(setup, 100, {
      ...course(setup),
      plan: botPacerPlan(PLAN.intensityWattsPerKilogram, setup.conditions.totalMass),
    });

    // The rider is 80 kg and the bot is 75; a bot handed the rider's conditions
    // wholesale would match this instead of the reference above.
    expect(setup.conditions.totalMass).not.toBe(PLAN.massKilograms);
    expect(simulation.state.bot?.state.distance).not.toBe(atRidersMass.distance);
  });

  it('rides on whether or not the rider is pedalling', () => {
    const setup = { ...hillyRoute(), pacer: PLAN };
    const simulation = new GameSimulation(setup);
    const stopped: RiderInput = { power: watts(0), live: true };
    simulation.advanceTo(0, stopped);
    simulation.advanceTo(100 * SIMULATION_STEP_SECONDS * 1000, stopped);

    expect(simulation.state.ride.distance).toBe(0);
    expect(simulation.state.bot?.state.distance).toBe(reference(setup, 100).distance);
  });

  it('skips the same time the rider skips, so a backgrounded phone does not hand it a lead', () => {
    const setup = { ...hillyRoute(), pacer: PLAN };
    const simulation = new GameSimulation(setup);
    simulation.advanceTo(0, PEDALLING);
    // Five minutes away from the app: far more than MAXIMUM_STEPS_PER_ADVANCE.
    const tick = simulation.advanceTo(300_000, PEDALLING);

    expect(tick.skippedSeconds).toBeGreaterThan(0);
    expect(simulation.state.bot?.state.distance).toBe(
      reference(setup, MAXIMUM_STEPS_PER_ADVANCE).distance,
    );
  });

  it('reports the gradient under the bot, which is not the rider’s', () => {
    const setup = { ...hillyRoute(), pacer: PLAN };
    const simulation = new GameSimulation(setup);
    const coasting: RiderInput = { power: watts(0), live: true };
    simulation.advanceTo(0, coasting);
    for (let nowMs = 1_000; nowMs <= 120_000; nowMs += 1_000) {
      simulation.advanceTo(nowMs, coasting);
    }

    // The rider never left the start line, so the bot is somewhere else on a
    // route whose gradient changes — a single shared grade would be equal.
    expect(simulation.state.bot?.grade).not.toBe(simulation.state.grade);
  });
});

/**
 * The world is drawn **between** the last two steps, rather than snapped to the
 * newest one — #323.
 *
 * ⚠️ **Every assertion here is about two answers being DIFFERENT**, which is
 * unusual in this file and is the point: the defect is duplicate frames. A
 * simulation that never interpolates is correct about where the rider is at
 * every tick and wrong about every frame in between, so an assertion that the
 * position is right cannot see it. Three quarters of the frames the phone drew
 * were copies of the one before, and only distinctness says so.
 */
describe('the world is drawn between the two most recent steps — #323', () => {
  /** A frame period that is not a factor of the step, as a real one is not. */
  const FRAME_MS = 1000 / 60;

  it('keeps the simulation on its 20 Hz step rather than raising it', () => {
    // #323's second acceptance criterion, in its literal form. The tempting
    // non-fix is to tick at 60 Hz so that every frame has a new state: that
    // triples the physics work to hide a display problem, and it moves a
    // number `MAXIMUM_STEPS_PER_ADVANCE` counts in and the 0.23 m drift
    // measurement in this file's header is stated against.
    expect(SIMULATION_STEP_SECONDS).toBe(0.05);
  });

  it('draws a different position on every frame inside one step', () => {
    const simulation = new GameSimulation(hillyRoute());
    simulation.advanceTo(0, PEDALLING);
    // A second of riding, so the rider is moving and there is a previous step.
    simulation.advanceTo(1_000, PEDALLING);

    const drawn = [0, FRAME_MS, FRAME_MS * 2].map(
      (offset) => simulation.drawnAt(1_000 + offset).riderDistance,
    );

    expect(drawn[1]).toBeGreaterThan(drawn[0] as number);
    expect(drawn[2]).toBeGreaterThan(drawn[1] as number);
    // Non-vacuity: the three are inside ONE step, so nothing was simulated
    // between them. Without interpolation all three are the same number.
    expect(simulation.advanceTo(1_000 + FRAME_MS * 2, PEDALLING).steps).toBe(0);
  });

  it('draws the bot on the same blend as the rider', () => {
    const simulation = new GameSimulation({ ...hillyRoute(), pacer: botPacerPlan(2.5) });
    simulation.advanceTo(0, PEDALLING);
    simulation.advanceTo(1_000, PEDALLING);

    const early = simulation.drawnAt(1_000);
    const late = simulation.drawnAt(1_000 + FRAME_MS * 2);

    expect(late.botDistance).toBeGreaterThan(early.botDistance ?? Number.POSITIVE_INFINITY);
    expect(late.riderDistance).toBeGreaterThan(early.riderDistance);
  });

  it('has no bot to draw when the rider chose none', () => {
    const simulation = new GameSimulation(hillyRoute());
    simulation.advanceTo(0, PEDALLING);
    simulation.advanceTo(1_000, PEDALLING);

    expect(simulation.drawnAt(1_000).botDistance).toBeUndefined();
  });

  it('never draws the rider past the newest step that was simulated', () => {
    const simulation = new GameSimulation(hillyRoute());
    simulation.advanceTo(0, PEDALLING);
    simulation.advanceTo(1_000, PEDALLING);

    // Late in the step, which is where an off-by-one would show.
    const drawn = simulation.drawnAt(1_000 + SIMULATION_STEP_SECONDS * 1000 * 0.999);

    expect(drawn.riderDistance).toBeLessThanOrEqual(simulation.state.ride.distance);
    // And within one step of it, so it is not lagging by a whole ride.
    expect(drawn.riderDistance).toBeGreaterThan(simulation.state.ride.distance - 1);
  });

  it('draws the start line before any step has run, rather than nothing', () => {
    const simulation = new GameSimulation({ ...hillyRoute(), pacer: botPacerPlan(2.5) });

    // `GameView` renders a scene before the loop has run once.
    const drawn = simulation.drawnAt(0);

    expect(drawn.riderDistance).toBe(0);
    expect(drawn.botDistance).toBe(0);
  });

  /**
   * ⚠️ #323's third acceptance criterion: *"after a catch-up burst, or a
   * backgrounded phone where `MAXIMUM_STEPS_PER_ADVANCE` has thrown wall-clock
   * away, it must not extrapolate a rider through scenery"*.
   *
   * Both halves are here because they are different arithmetic. The burst is
   * about which state is blended **from** — one step back, not two hundred.
   * The unlocked phone is about the blend itself, which is a ratio of
   * wall-clock seconds the stall makes enormous.
   */
  describe('a stall does not project the rider up the road', () => {
    /** Five minutes backgrounded, from one `advanceTo` to the next. */
    function stalled(): GameSimulation {
      const simulation = new GameSimulation(hillyRoute());
      simulation.advanceTo(0, PEDALLING);
      simulation.advanceTo(300_000, PEDALLING);
      return simulation;
    }

    it('blends from one step back rather than from before the whole burst', () => {
      const simulation = stalled();

      const drawn = simulation.drawnAt(300_000);

      // Ten seconds of road were integrated in that one call — 38 m from a
      // standing start on this hill. Blending from where the rider was before
      // it would draw them all of that back down the road, and then glide them
      // forward through the next second of frames.
      expect(simulation.state.ride.distance).toBeGreaterThan(30);
      expect(drawn.riderDistance).toBeGreaterThan(simulation.state.ride.distance - 1);
    });

    it('never draws past the newest step, however late the frame is', () => {
      const simulation = stalled();

      // A frame that arrives five seconds after the last `advanceTo` — a
      // hundred steps' worth of wall clock, with nothing simulated for it.
      const late = simulation.drawnAt(305_000);

      // Clamped to the newest state exactly, never beyond it. Unclamped this
      // is the rider a hundred blends up the road, through the scenery.
      expect(late.riderDistance).toBe(simulation.state.ride.distance);
    });

    it('does not draw the rider backwards when the clock goes back', () => {
      const simulation = stalled();

      const backwards = simulation.drawnAt(299_000);

      expect(backwards.riderDistance).toBeLessThanOrEqual(simulation.state.ride.distance);
      expect(backwards.riderDistance).toBeGreaterThan(simulation.state.ride.distance - 1);
    });
  });
});
