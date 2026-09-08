// SPDX-License-Identifier: Apache-2.0

/**
 * #92's bot: the same physics as the rider, and no rider anywhere in it.
 *
 * The two criteria that decide whether this feature is worth having are both
 * here, and neither can be discharged by a comment:
 *
 * - *"The bot's speed comes from the same physics model as the rider's (#88) at
 *   a fixed 75 kg — **a test asserts both go through the same code path**."*
 *   Three assertions together make that literal rather than rhetorical: the
 *   bot's answer is identical to a rider's tick with the same inputs; the real
 *   `advance` is observed being called with the bot's 75 kg; and **replacing
 *   `advance` changes the bot's answer**, which a bot with its own arithmetic
 *   would survive untouched.
 * - *"A test asserts the bot completes the route without the rider present,
 *   i.e. it is not driven by rider state."* Taken at its word below: the bot
 *   rides a route to its end with no rider constructed anywhere in the test.
 *
 * ## Why this file mocks a module, when nothing else in this package does
 *
 * Every other test here compares numbers, and a number cannot tell you which
 * function produced it. "Same code path" is a claim about the call graph, so it
 * needs an observation of the call — a bot that had quietly grown its own
 * `speed = k · power` would agree with `advance` on the flat, which is exactly
 * where a numbers-only test would be written.
 */

import { describe, expect, it, vi } from 'vitest';

import type {
  GeographicPosition,
  RouteProfile,
  RoutePoint,
  Seconds,
  UnixSeconds,
} from '@onyourleft/domain';
import {
  altitudeMetres,
  botPacerPlan,
  degreesCelsius,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  gradeAt,
  kilograms,
  metres,
  metresPerSecond,
  pacedPowerWatts,
  routeProfile,
  seconds,
  unixSeconds,
} from '@onyourleft/domain';

import { airDensityKilogramsPerCubicMetre } from './air';
import * as botPacerModule from './pacer';
import { advanceBot, BOT_AT_START_LINE, botDemand, createBotPacer, type BotCourse } from './pacer';
import { advance, START_OF_RIDE, type RideState } from './simulate';

// Wraps the REAL `advance` in a spy: every assertion below runs the genuine
// physics, and the spy exists so that the call can be *observed*. A mock that
// replaced the implementation wholesale would make the rest of this file
// meaningless — the one test that does replace it does so for a single call and
// says why.
vi.mock('./simulate', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./simulate')>();
  return { ...actual, advance: vi.fn(actual.advance) };
});

const AIR = airDensityKilogramsPerCubicMetre(altitudeMetres(0), degreesCelsius(15));

const METRES_PER_DEGREE_LATITUDE = 111_194.9;
const ORIGIN = geographicPosition(degreesLatitude(51.5), degreesLongitude(-0.12));

function eastOf(from: GeographicPosition, eastMetres: number): GeographicPosition {
  const perDegreeLongitude = METRES_PER_DEGREE_LATITUDE * Math.cos((from.latitude * Math.PI) / 180);
  return geographicPosition(
    degreesLatitude(from.latitude),
    degreesLongitude(from.longitude + eastMetres / perDegreeLongitude),
  );
}

/**
 * A straight eastward road of constant gradient.
 *
 * ⚠️ **It reads its nominal gradient in the middle and about HALF of it at
 * either end**, which caught this file's first draft and is #89's behaviour
 * rather than a fault here. `route/profile.ts` §`slopes` fits its least-squares
 * window over `clamped` indices, so at grid point 0 the left half of the 100 m
 * window re-reads the first elevation and the fit sees a road that is flat for
 * 50 m and then climbs — half the slope. That is the right call for a route
 * (extrapolating a trend off the end of a file is worse), and it means an
 * assertion about a *nominal* gradient has to be taken at least half a window
 * inside the route. {@link MID_ROUTE} is where these take it.
 */
function road(lengthMetres: number, gradePercentValue: number): RouteProfile {
  const points: RoutePoint[] = [];
  for (let distance = 0; distance <= lengthMetres; distance += 10) {
    points.push({
      position: eastOf(ORIGIN, distance),
      elevation: altitudeMetres(500 + (distance * gradePercentValue) / 100),
    });
  }
  return routeProfile(points);
}

const FLAT = road(2000, 0);
const CLIMB = road(2000, 5);
const DESCENT = road(2000, -5);

const PLAN = botPacerPlan(2.5);

/**
 * A kilometre in, where the gradient window is entirely inside the route and a
 * fixture therefore reads its nominal gradient. Stationary, because these
 * assertions are about the demand and not about the tick.
 */
const MID_ROUTE: RideState = { speed: metresPerSecond(0), distance: metres(1000) };

function courseOn(profile: RouteProfile): BotCourse {
  return { profile, plan: PLAN, airDensityKilogramsPerCubicMetre: AIR };
}

describe('the bot goes through the same physics as the rider', () => {
  it('produces exactly what a rider tick with the same inputs produces', () => {
    // The rider's path, written out longhand and independently of the bot: read
    // the gradient, take a power, call `advance`. The bot must agree to the
    // last bit — not "closely", which is what a second model fitted on the flat
    // would manage.
    const grade = gradeAt(FLAT, 0);
    const asARider = advance(
      START_OF_RIDE,
      { power: pacedPowerWatts(PLAN, grade), grade, duration: seconds(1) },
      { totalMass: kilograms(75), airDensityKilogramsPerCubicMetre: AIR },
    );

    const asABot = advanceBot(BOT_AT_START_LINE, seconds(1), courseOn(FLAT));

    expect(asABot.state.speed).toBe(asARider.speed);
    expect(asABot.state.distance).toBe(asARider.distance);
  });

  it('is observed calling that same tick, at the fixed 75 kg', () => {
    vi.mocked(advance).mockClear();

    advanceBot(MID_ROUTE, seconds(1), courseOn(CLIMB));

    expect(vi.mocked(advance)).toHaveBeenCalledTimes(1);
    const [state, step, conditions] = vi.mocked(advance).mock.calls[0] ?? [];
    expect(state).toBe(MID_ROUTE);
    expect(step?.duration).toBe(1);
    expect(step?.grade).toBeCloseTo(5, 4);
    expect(step?.power).toBe(pacedPowerWatts(PLAN, gradeAt(CLIMB, 1000)));
    expect(conditions?.totalMass).toBe(75);
  });

  it('rides on whatever that tick returns, so it cannot be on separate maths', () => {
    // The strongest form of the criterion. If the bot computed its own speed,
    // this sentinel would be ignored and the assertion would fail — which is
    // the whole point: the test can tell the difference between "calls
    // `advance`" and "is moved by `advance`".
    const sentinel: RideState = { speed: metresPerSecond(42), distance: metres(1234) };
    vi.mocked(advance).mockReturnValueOnce(sentinel);

    const tick = advanceBot(BOT_AT_START_LINE, seconds(1), courseOn(FLAT));

    expect(tick.state).toBe(sentinel);
  });

  it('weighs 75 kg however hard it is pacing', () => {
    vi.mocked(advance).mockClear();
    advanceBot(MID_ROUTE, seconds(1), {
      ...courseOn(CLIMB),
      plan: botPacerPlan(4.5),
    });
    expect(vi.mocked(advance).mock.calls[0]?.[2]?.totalMass).toBe(75);
  });
});

describe('dynamic pacing, through the physics rather than beside it', () => {
  it('asks for more power up a +5 % gradient and less down a −5 % one', () => {
    const flat = botDemand(MID_ROUTE, courseOn(FLAT)).power;
    expect(botDemand(MID_ROUTE, courseOn(CLIMB)).power).toBeGreaterThan(flat);
    expect(botDemand(MID_ROUTE, courseOn(DESCENT)).power).toBeLessThan(flat);

    // And inside the envelope, measured here rather than only in the pacing
    // rule's own tests: this is the number that reaches the physics.
    expect(botDemand(MID_ROUTE, courseOn(CLIMB)).power).toBeLessThanOrEqual(flat * 1.1);
    expect(botDemand(MID_ROUTE, courseOn(DESCENT)).power).toBeGreaterThanOrEqual(flat * 0.8);
  });

  it('still climbs slower than it descends, because +10 % of power is not a hill', () => {
    // The sanity check on the whole idea: dynamic pacing moves the *power*
    // inside a narrow envelope, and gravity moves the *speed* far more than
    // that. A bot that held its speed up a 5 % climb would be the tell that
    // something other than the physics was driving it.
    const uphill = rideFor(CLIMB, 120);
    const downhill = rideFor(DESCENT, 120);
    const level = rideFor(FLAT, 120);
    expect(uphill.distance).toBeLessThan(level.distance);
    expect(downhill.distance).toBeGreaterThan(level.distance);
  });

  it('reads the gradient under it rather than the one it started on', () => {
    // The bot is 500 m up a 5 % climb; the demand is taken where it *is*.
    const partWay: RideState = { speed: metresPerSecond(5), distance: metres(1000) };
    const demand = botDemand(partWay, courseOn(CLIMB));
    expect(demand.distanceOnRoute).toBeCloseTo(1000, 6);
    expect(demand.grade).toBeCloseTo(5, 4);
    // And at the start line it is the profile's edge-clamped gradient, not this
    // one — the fixture comment above says why.
    expect(botDemand(BOT_AT_START_LINE, courseOn(CLIMB)).grade).toBeLessThan(demand.grade);
  });
});

describe('the bot completes the route with no rider present', () => {
  it('rides a flat 2 km to the end, driven by nothing but time', () => {
    // #92's sixth criterion, at its word. Nothing in this test is a rider:
    // there is no rider state, no rider speed and no rider distance, and there
    // is no parameter on `advanceBot` through which one could be passed.
    const course = courseOn(FLAT);
    let state = BOT_AT_START_LINE;
    let ticks = 0;

    while (state.distance < FLAT.totalDistance && ticks < 600) {
      state = advanceBot(state, seconds(1), course).state;
      ticks += 1;
    }

    expect(state.distance).toBeGreaterThanOrEqual(FLAT.totalDistance);
    expect(ticks).toBeLessThan(600);
  });

  it('keeps going past the end of a point-to-point route rather than stopping', () => {
    // `distanceOnRoute` clamps a non-loop, so the gradient past the end is the
    // last one on the route. The bot does not stop, because nothing told it to
    // — which is the honest behaviour for a pacer whose route has run out and
    // is a decision for #94's screen rather than for the physics.
    const state = rideFor(FLAT, 400);
    expect(state.distance).toBeGreaterThan(FLAT.totalDistance);
    expect(state.speed).toBeGreaterThan(0);
  });

  it('rides the same route twice to the same place, because nothing varies', () => {
    expect(rideFor(CLIMB, 200)).toEqual(rideFor(CLIMB, 200));
  });
});

describe('the driver, which takes instants and never a clock', () => {
  it('advances nothing on the first sample and reports a bot at the start line', () => {
    const bot = createBotPacer(courseOn(FLAT));
    const first = bot.sample(unixSeconds(1_800_000_000));
    expect(first.state).toEqual(START_OF_RIDE);
    expect(first.power).toBe(pacedPowerWatts(PLAN, gradeAt(FLAT, 0)));
  });

  it('advances by the difference between two instants, not by the instant', () => {
    const bot = createBotPacer(courseOn(FLAT));
    bot.sample(unixSeconds(1_800_000_000));
    const after = bot.sample(unixSeconds(1_800_000_010));
    expect(after.state.distance).toBeCloseTo(rideFor(FLAT, 10).distance, 6);
  });

  it('does not wind backwards when a clock does', () => {
    const bot = createBotPacer(courseOn(FLAT));
    bot.sample(unixSeconds(1_800_000_000));
    const forward = bot.sample(unixSeconds(1_800_000_005));
    const backward = bot.sample(unixSeconds(1_800_000_001));
    expect(backward.state).toBe(forward.state);
    expect(bot.current().state).toBe(forward.state);
  });

  it('ignores an instant that is not a number at all', () => {
    const bot = createBotPacer(courseOn(FLAT));
    bot.sample(unixSeconds(1_800_000_000));
    const moved = bot.sample(unixSeconds(1_800_000_005));
    expect(bot.sample(Number.NaN as UnixSeconds).state).toBe(moved.state);
  });

  it('does not ride the gap after a restart', () => {
    // A client that was backgrounded for an hour comes back to a bot where it
    // left it, not to one an hour up the road.
    const bot = createBotPacer(courseOn(FLAT));
    bot.sample(unixSeconds(1_800_000_000));
    const before = bot.sample(unixSeconds(1_800_000_010));
    bot.restart();
    const resumed = bot.sample(unixSeconds(1_800_003_600));
    expect(resumed.state).toBe(before.state);
    const afterResume = bot.sample(unixSeconds(1_800_003_601));
    expect(afterResume.state.distance).toBeGreaterThan(before.state.distance);
    expect(afterResume.state.distance - before.state.distance).toBeLessThan(20);
  });

  it('refuses a tick that covers a non-finite number of seconds', () => {
    expect(() => advanceBot(BOT_AT_START_LINE, Number.NaN as Seconds, courseOn(FLAT))).toThrow(
      /finite number of seconds/,
    );
  });
});

describe('nothing here is a recorded ride, and nothing here is another person', () => {
  it('takes a course of a route, a plan and the weather, and nothing else', () => {
    // The runtime half of #92's fifth criterion, over the object a bot is
    // actually handed. Adding a field to `BotCourse` fails this until somebody
    // has looked at the name — which is the review step the criterion asks for.
    expect(Object.keys(courseOn(FLAT)).sort()).toEqual([
      'airDensityKilogramsPerCubicMetre',
      'plan',
      'profile',
    ]);
  });

  it('carries no timeline in the route it rides', () => {
    // A `RouteProfile` is the one non-scalar input the bot has, so it is the
    // one place a recorded performance could hide. It is elevation as a
    // function of DISTANCE: there is no time, no power, no heart rate and no
    // athlete in it. ADR 0007 D4's limitations all need one of those.
    expect(Object.keys(FLAT).sort()).toEqual([
      'elevations',
      'grades',
      'loop',
      'positions',
      'resolution',
      'totalAscent',
      'totalDescent',
      'totalDistance',
    ]);
  });

  it('exports nothing named for a person, a ranking or a stored ride', () => {
    // #92's last criterion, checked over the surface rather than asserted in a
    // comment. A `rankBotAgainstAthletes` added here fails this test.
    const forbidden =
      /leaderboard|ranking|\brank\b|athlete|activity|effort|ghost|opponent|competitor|replay/i;
    for (const name of Object.keys(botPacerModule)) {
      expect(name).not.toMatch(forbidden);
    }
  });
});

/** Ride a bot from the start line for `duration` seconds of 1 Hz ticks. */
function rideFor(profile: RouteProfile, duration: number): RideState {
  const course = courseOn(profile);
  let state = BOT_AT_START_LINE;
  for (let tick = 0; tick < duration; tick += 1) {
    state = advanceBot(state, seconds(1), course).state;
  }
  return state;
}
