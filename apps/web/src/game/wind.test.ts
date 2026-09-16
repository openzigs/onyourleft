// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #326: a ride that actually has a wind in it.
 *
 * `packages/physics` has had a complete, justified and tested wind model since
 * #88 and **no caller ever supplied a value**, so every assertion here is
 * about a code path that was unreachable from a ride until this change. Two of
 * the criteria are pinned by the shape of the comparison rather than by a
 * number:
 *
 * - *"the same power on the same gradient yields a different speed into a
 *   headwind than with a tailwind"* — asserted as an ordering of three runs
 *   that differ in nothing but the wind.
 * - *"a tailwind exceeding ground speed"* — the case `terms.ts`'s
 *   `V_a · |V_a|` form exists for. The assertion is **monotonic**: a stronger
 *   tailwind must push a slow rider *further*. A naive `V_a²` reverses that
 *   ordering, so this is one of the few tests here that a wrong implementation
 *   fails in the opposite direction rather than merely by a margin.
 */

import { describe, expect, it } from 'vitest';

import { GameSimulation, SIMULATION_STEP_SECONDS, type SimulationSetup } from './simulation';
import { airDensityKilogramsPerCubicMetre } from '@onyourleft/physics';
import {
  altitudeMetres,
  botPacerPlan,
  degreesCelsius,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  kilograms,
  routeProfile,
  watts,
  wind,
  type RoutePoint,
  type Wind,
} from '@onyourleft/domain';

const METRES_PER_DEGREE_LATITUDE = 111_320;

/** Still air at sea level, 15 °C — the conditions every ride had before #326. */
const CONDITIONS = {
  totalMass: kilograms(80),
  airDensityKilogramsPerCubicMetre: airDensityKilogramsPerCubicMetre(
    altitudeMetres(0),
    degreesCelsius(15),
  ),
};

/** A flat road running due **north**, so the heading is 0° all the way along. */
function northRoad(lengthMetres: number): SimulationSetup {
  const points: RoutePoint[] = [];
  for (let along = 0; along <= lengthMetres; along += 10) {
    points.push({
      position: geographicPosition(
        degreesLatitude(51.5 + along / METRES_PER_DEGREE_LATITUDE),
        degreesLongitude(-0.12),
      ),
      elevation: altitudeMetres(20),
    });
  }
  return { profile: routeProfile(points), conditions: CONDITIONS };
}

/**
 * Out along a northward road and back down it — flat, so the **only** thing
 * that changes at the turn is which way the rider is pointing.
 */
function outAndBack(legMetres: number): SimulationSetup {
  const points: RoutePoint[] = [];
  const at = (along: number): RoutePoint => ({
    position: geographicPosition(
      degreesLatitude(51.5 + along / METRES_PER_DEGREE_LATITUDE),
      degreesLongitude(-0.12),
    ),
    elevation: altitudeMetres(20),
  });
  for (let along = 0; along <= legMetres; along += 10) {
    points.push(at(along));
  }
  for (let along = legMetres - 10; along >= 0; along -= 10) {
    points.push(at(along));
  }
  return { profile: routeProfile(points), conditions: CONDITIONS };
}

/** Rides `setup` for `durationSeconds` at `powerWatts`, and returns the state. */
function ride(setup: SimulationSetup, powerWatts: number, durationSeconds: number): GameSimulation {
  const simulation = new GameSimulation(setup);
  const startMs = 1_000_000;
  const input = { power: watts(powerWatts), live: true };
  simulation.advanceTo(startMs, input);
  const frames = Math.round(durationSeconds / SIMULATION_STEP_SECONDS);
  for (let frame = 1; frame <= frames; frame += 1) {
    simulation.advanceTo(startMs + frame * SIMULATION_STEP_SECONDS * 1000, input);
  }
  return simulation;
}

/** A northerly: the wind blows **from** the north, so it is a headwind riding north. */
function northerly(speedMetresPerSecond: number): Wind {
  return wind(speedMetresPerSecond, 0);
}

/** A southerly: a tailwind riding north. */
function southerly(speedMetresPerSecond: number): Wind {
  return wind(speedMetresPerSecond, 180);
}

describe('the same power on the same gradient, in three different winds', () => {
  it('is slower into a headwind and faster with a tailwind', () => {
    // #326's first acceptance criterion, in its literal form. The route is
    // flat and the power identical, so the gradient term and the drive term
    // are the same in all three runs and the wind is the only difference.
    const into = ride({ ...northRoad(4000), wind: northerly(6) }, 220, 60);
    const still = ride(northRoad(4000), 220, 60);
    const behind = ride({ ...northRoad(4000), wind: southerly(6) }, 220, 60);

    expect(into.state.ride.speed).toBeLessThan(still.state.ride.speed);
    expect(still.state.ride.speed).toBeLessThan(behind.state.ride.speed);
    // Not a rounding difference: a 6 m/s wind is worth several km/h either way.
    expect(behind.state.ride.speed - into.state.ride.speed).toBeGreaterThan(2);
    expect(into.state.ride.distance).toBeLessThan(behind.state.ride.distance);
  });

  it('is exactly the ride it always was when no wind is given', () => {
    // The conditions object is passed through unchanged, so a windless ride
    // must be bit-identical rather than merely close — `simulation.ts`
    // §`#conditionsAt` says why the identity is preserved.
    const before = ride(northRoad(4000), 220, 30);
    const zero = ride({ ...northRoad(4000), wind: wind(0, 0) }, 220, 30);
    expect(zero.state.ride.distance).toBe(before.state.ride.distance);
    expect(zero.state.ride.speed).toBe(before.state.ride.speed);
  });
});

describe('a tailwind stronger than the rider', () => {
  /**
   * **A coasting rider.** Zero at the pedals, so the only forward force in the
   * model is the air itself and the only backward one is rolling resistance —
   * which means the ground speed *cannot* reach the wind speed, by the force
   * balance rather than by a number being tuned until it did not.
   *
   * ⚠️ That is the reason for a zero here rather than a soft pedal. At 40 W a
   * 7 m/s tailwind settles the rider at **8.4 m/s**, past the wind and back
   * into an ordinary headwind, and the case under test would only have existed
   * for the first few seconds of the ride. Measured, not assumed.
   */
  const COASTING_WATTS = 0;

  it('is a case a ride can actually reach, which it could not before #326', () => {
    const pushed = ride({ ...northRoad(4000), wind: southerly(7) }, COASTING_WATTS, 120);
    // The guard that stops every assertion below being vacuous: if the rider
    // were quicker than the wind this would be an ordinary tailwind case and
    // the `V_a · |V_a|` branch would never run.
    expect(pushed.state.ride.speed).toBeGreaterThan(0);
    expect(pushed.state.ride.speed).toBeLessThan(7);
  });

  it('pushes the rider along rather than holding them back', () => {
    // Coasting in still air from the start line goes nowhere at all, which is
    // the starkest form this assertion takes: every metre here is the wind's.
    const still = ride(northRoad(4000), COASTING_WATTS, 120);
    const pushed = ride({ ...northRoad(4000), wind: southerly(7) }, COASTING_WATTS, 120);
    expect(still.state.ride.distance).toBe(0);
    expect(pushed.state.ride.distance).toBeGreaterThan(100);
  });

  it('pushes HARDER the stronger it blows — the assertion a `V_a²` form fails', () => {
    // ⚠️ This is the ordering that distinguishes the two forms. With
    // `V_a · |V_a|` a bigger tailwind is a bigger forward force, so the rider
    // goes further. With Martin's literal `V_a²` the sign is lost, a bigger
    // tailwind is a bigger *retarding* force, and this comparison comes out
    // backwards — not merely off by a few metres.
    const gentle = ride({ ...northRoad(6000), wind: southerly(7) }, COASTING_WATTS, 120);
    const strong = ride({ ...northRoad(6000), wind: southerly(12) }, COASTING_WATTS, 120);
    expect(strong.state.ride.speed).toBeLessThan(12);
    expect(strong.state.ride.distance).toBeGreaterThan(gentle.state.ride.distance);
  });
});

describe('the wind is resolved where the rider is, not once at the start line', () => {
  it('turns from a headwind into a tailwind when the rider turns round', () => {
    // An out-and-back in a steady northerly: a headwind for the first leg and
    // a tailwind for the second. A ride given one headwind for its whole
    // length — which is what `RideConditions.headwindMetresPerSecond` alone
    // can express — fights the wind all the way home and finishes well short.
    const route = outAndBack(600);
    const resolved = ride({ ...route, wind: northerly(6) }, 220, 150);
    const heldConstant = ride(
      {
        ...route,
        conditions: { ...CONDITIONS, headwindMetresPerSecond: 6 },
      },
      220,
      150,
    );
    const still = ride(route, 220, 150);

    // Far enough to have turned round, or the two are the same ride.
    expect(resolved.state.ride.distance).toBeGreaterThan(700);
    expect(resolved.state.ride.distance).toBeGreaterThan(heldConstant.state.ride.distance + 100);
    // And it is still a wind: the out leg was into it, so the lap is slower
    // than it would have been in still air.
    expect(resolved.state.ride.distance).toBeLessThan(still.state.ride.distance);
  });
});

describe('the bot pacer rides the same wind as the rider', () => {
  it('is slowed by a headwind the rider is also fighting', () => {
    const setup = { ...northRoad(6000), pacer: botPacerPlan(2.5) };
    const still = ride(setup, 220, 90);
    const into = ride({ ...setup, wind: northerly(6) }, 220, 90);

    const stillBot = still.state.bot?.state.distance;
    const intoBot = into.state.bot?.state.distance;
    expect(stillBot).toBeDefined();
    expect(intoBot).toBeDefined();
    expect(intoBot as number).toBeLessThan(stillBot as number);
  });

  it('is pushed by a tailwind, so the race is not quietly one-sided', () => {
    // The criterion is that the bot rides the *same* wind, and this is the half
    // that a "give the bot still air" implementation fails: a sheltered pacer
    // would cover the same ground with the wind behind the rider as without it.
    const setup = { ...northRoad(6000), pacer: botPacerPlan(2.5) };
    const still = ride(setup, 220, 90);
    const behind = ride({ ...setup, wind: southerly(6) }, 220, 90);
    expect(behind.state.bot?.state.distance as number).toBeGreaterThan(
      still.state.bot?.state.distance as number,
    );
  });

  it('gives the bot the wind at the BOT’s heading, not at the rider’s', () => {
    // ⚠️ **The case that separates "the bot rides the same wind" from "the bot
    // rides the rider's headwind"** — two implementations that agree on every
    // straight road and disagree here.
    //
    // The rider is given nothing at the pedals, so they never leave the start
    // line and are pointing due north for the whole ride: into the northerly.
    // The bot rides out, turns at 800 m and comes back south with the wind
    // behind it. So at the end the two are in one wind facing opposite ways.
    //
    // Resolved at its own heading the bot is FASTER than it would be in still
    // air. Fed the rider's headwind it would be slower. The sign of this
    // comparison is the whole assertion, and no margin is being trusted: the
    // two answers are 15.3 m/s and something under 11.7.
    const setup = { ...outAndBack(800), pacer: botPacerPlan(4) };
    const still = ride(setup, 0, 150);
    const resolved = ride({ ...setup, wind: northerly(6) }, 0, 150);

    // The situation the assertion rests on really did occur, or there is
    // nothing in it: the bot past the turn, the rider still on the start line.
    expect(resolved.state.bot?.state.distance as number).toBeGreaterThan(800);
    expect(resolved.state.ride.distance).toBe(0);

    expect(resolved.state.bot?.state.speed as number).toBeGreaterThan(
      still.state.bot?.state.speed as number,
    );
  });

  it('does not blow a stationary rider backwards down the road', () => {
    // `RideState.distance` is a non-negative magnitude and this model has no
    // reverse, so a headwind on a rider producing nothing has to come out as a
    // rider who stays put rather than as an odometer that unwinds.
    const blown = ride({ ...northRoad(4000), wind: northerly(12) }, 0, 60);
    expect(blown.state.ride.distance).toBe(0);
    expect(blown.state.ride.speed).toBe(0);
  });
});
