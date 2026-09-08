// SPDX-License-Identifier: Apache-2.0

/**
 * The bot pacer's rider — #92.
 *
 * `@onyourleft/domain`'s `pacer/pacing.ts` decides **how hard the bot is
 * pedalling**; this decides **where that gets it**. It is four lines of
 * composition and one of them is the acceptance criterion:
 *
 * 1. wrap the bot's odometer onto the route (`distanceOnRoute`),
 * 2. read the gradient there (`gradeAt`),
 * 3. ask the pacing rule for a power (`pacedPowerWatts`),
 * 4. hand power, gradient and elapsed time to **{@link advance}** — the same
 *    tick the rider's own ride runs through, with no second implementation and
 *    no shortcut for a bot.
 *
 * ## Why step 4 is a criterion rather than an implementation detail
 *
 * #92: *"The bot's speed comes from the same physics model as the rider's (#88)
 * at a fixed 75 kg — a test asserts both go through the same code path. A bot
 * on separate maths will diverge visibly on gradients and destroy the
 * illusion."*
 *
 * The failure it is guarding against is specific and it is not a rounding
 * error. A bot moved by `speed = k · power` looks fine on the flat and is
 * wrong on every hill, because the flat is where the two models are fitted to
 * each other and gravity is where they part. A rider who can hold a bot's wheel
 * on the flat and watches it ride away up every rise learns that the bot is
 * fake, and the feature is finished.
 *
 * So `advanceBot` does not compute a speed. It calls {@link advance}, which is
 * the only tick in this package, and `pacer.test.ts` asserts that literally: it
 * replaces the module's `advance` with a sentinel and requires the bot's answer
 * to change. A bot that had its own maths would sail through that test with the
 * sentinel ignored.
 *
 * ## Why the bot lives here and the pacing rule lives in `packages/domain`
 *
 * The dependency direction decides it, and there is no taste in it.
 * `packages/physics` depends on `@onyourleft/domain`; the reverse would be a
 * cycle. The pacing rule needs the route profile, which is in `domain`; the bot
 * needs the tick, which is here. So the rule goes there and the rider goes
 * here, and the two meet in exactly one place — this file.
 *
 * ## Nothing here reads a clock, and nothing here reads the rider
 *
 * Both matter and they are different claims.
 *
 * **No clock**: elapsed time arrives as a `Seconds`, on the recording engine's
 * terms and #90's. This package may not name `Date` at all — `eslint.config.js`
 * enforces it, because `Date` survives the `lib: ["ES2024"]` narrowing.
 *
 * **No rider**: there is no rider anywhere in {@link BotCourse}, in
 * {@link advanceBot}'s parameters or in {@link BotPacerDriver}'s. That is #92's
 * sixth criterion — *"a test asserts the bot completes the route without the
 * rider present, i.e. it is not driven by rider state"* — and here it is a
 * property of the signatures rather than of the tests: there is no parameter
 * through which rider state could arrive. `pacer.test.ts` rides a whole route
 * with nothing else constructed, which is the criterion's own wording.
 *
 * ⚠️ **And no recorded ride, which is the patent-posture criterion.** ADR 0007
 * D4 and `pacer/pacing.ts`'s header carry the argument in full; the part that
 * belongs here is that this file adds no input to the three that file lists.
 * The whole of {@link BotCourse} is a plan of two numbers, a `RouteProfile`
 * (elevation as a function of distance, from a GPX — no time axis, no athlete)
 * and the same environmental conditions the rider's own physics takes.
 */

import type {
  BotPacerPlan,
  GradePercent,
  Metres,
  RouteProfile,
  Seconds,
  UnixSeconds,
  Watts,
} from '@onyourleft/domain';
import {
  distanceOnRoute,
  gradeAt,
  kilograms,
  metres,
  pacedPowerWatts,
  seconds,
} from '@onyourleft/domain';

import type { PhysicsCoefficients } from './coefficients';
import { PhysicsError } from './physics-error';
import type { RideConditions, RideState } from './simulate';
import { advance, START_OF_RIDE } from './simulate';

/**
 * Everything the bot rides on, and everything it rides with.
 *
 * The environmental half is {@link RideConditions} minus `totalMass`, which is
 * the bot's own and comes from the plan. Omitting it rather than accepting and
 * ignoring it is deliberate: a caller who could pass a mass here would
 * reasonably expect it to be used, and the one thing #92 fixes about the bot is
 * that its mass is 75 kg and not the rider's.
 */
export interface BotCourse {
  /** The route, as a function of distance. Built by #89 from a route file. */
  readonly profile: RouteProfile;
  /** The pace to ride, and the mass to ride it at. */
  readonly plan: BotPacerPlan;
  /** As the rider's own ride: see `air.ts`. */
  readonly airDensityKilogramsPerCubicMetre: number;
  /** Headwind positive, along the direction of travel. */
  readonly headwindMetresPerSecond?: number;
  readonly coefficients?: Partial<PhysicsCoefficients>;
  /** See {@link RideConditions.integrationStepSeconds}. */
  readonly integrationStepSeconds?: number;
}

/** What the bot is doing at one instant, for a HUD to render. */
export interface BotTick {
  /** Speed and odometer, in the **same** type the rider's own ride reports. */
  readonly state: RideState;
  /** Where on the route that odometer lands — wrapped for a loop, clamped otherwise. */
  readonly distanceOnRoute: Metres;
  /** The gradient the bot is on, interpolated from the profile. Signed. */
  readonly grade: GradePercent;
  /** What the pacing rule asked for there. */
  readonly power: Watts;
}

/**
 * The bot's starting state: at the start line, stationary.
 *
 * An alias for the rider's {@link START_OF_RIDE} rather than a second literal,
 * for the same reason `DEFAULT_COEFFICIENTS` aliases `MARTIN_1998_COEFFICIENTS`
 * — and because a bot that started from a different state from the rider's
 * would be the first crack in "the same physics model".
 *
 * ⚠️ There is deliberately **no pedal-assist burst** here. #92's Context names
 * one as a documented Zwift mechanic ("a short pedal-assist burst on joining,
 * so you are not instantly dropped"), and it is not one of #92's acceptance
 * criteria — for a reason that becomes obvious once written down: a joining
 * burst is a response to *the rider joining*, so implementing it in this layer
 * would put rider state into bot behaviour, which #92's sixth criterion
 * forbids. It belongs to whichever screen knows a rider has just joined, and it
 * is left open. See the PR for #92.
 */
export const BOT_AT_START_LINE: RideState = START_OF_RIDE;

/** The conditions the bot's tick runs under, with the plan's mass in them. */
function conditionsFor(course: BotCourse): RideConditions {
  return {
    totalMass: kilograms(course.plan.massKilograms),
    airDensityKilogramsPerCubicMetre: course.airDensityKilogramsPerCubicMetre,
    ...(course.headwindMetresPerSecond === undefined
      ? {}
      : { headwindMetresPerSecond: course.headwindMetresPerSecond }),
    ...(course.coefficients === undefined ? {} : { coefficients: course.coefficients }),
    ...(course.integrationStepSeconds === undefined
      ? {}
      : { integrationStepSeconds: course.integrationStepSeconds }),
  };
}

/**
 * Read the road under the bot and ask the pacing rule what to do about it.
 *
 * Split out from {@link advanceBot} so that a caller can render what the bot is
 * about to do without advancing it, and so that the pacing rule and the tick
 * are separately testable — the envelope assertions in #92's third criterion
 * are about this function's answer, not about the resulting speed.
 */
export function botDemand(
  state: RideState,
  course: BotCourse,
): Pick<BotTick, 'distanceOnRoute' | 'grade' | 'power'> {
  const on = distanceOnRoute(course.profile, state.distance);
  const grade = gradeAt(course.profile, on);
  return {
    distanceOnRoute: metres(on),
    grade,
    power: pacedPowerWatts(course.plan, grade),
  };
}

/**
 * Advance the bot by one interval.
 *
 * Pure: the returned state is a function of the state passed in, the course and
 * the elapsed time, and of nothing else. Calling it twice with the same
 * arguments gives the same answer, which is what makes a bot testable at all.
 *
 * @param elapsed - how much time this tick covers. Supplied, never read.
 * @throws {PhysicsError} through {@link advance} if the integration step is not
 * strictly positive, and directly if `elapsed` is not a finite duration — a
 * `NaN` here would put a `NaN` into the odometer and the bot would silently
 * stop reporting a position for the rest of the ride.
 */
export function advanceBot(state: RideState, elapsed: Seconds, course: BotCourse): BotTick {
  if (!Number.isFinite(elapsed)) {
    throw new PhysicsError(
      `a bot tick must cover a finite number of seconds, received ${String(elapsed)}`,
    );
  }
  const demand = botDemand(state, course);
  const next = advance(
    state,
    { power: demand.power, grade: demand.grade, duration: elapsed },
    conditionsFor(course),
  );
  return { state: next, ...demand };
}

/**
 * A bot that keeps its own place, fed instants rather than intervals.
 *
 * Written on #90's `createSimulationDriver` pattern, deliberately and to the
 * letter: **time arrives as a parameter**, the driver differences it against
 * the last one it was given, and nothing inside reads a clock. A client's
 * animation frame or recording tick hands it `at`; the driver does the
 * subtraction so that no caller has to remember to.
 *
 * The stateless {@link advanceBot} is still the primitive, and a caller that
 * already has an interval should use it. This exists because a caller that has
 * a timestamp would otherwise write the subtraction itself, and the case it
 * gets wrong is the first tick — where there is no previous instant, and the
 * obvious code advances the bot by the whole Unix epoch.
 */
export interface BotPacerDriver {
  /**
   * Advance to this instant and report what the bot is doing.
   *
   * The first call establishes the clock and advances nothing, which is why it
   * reports a stationary bot at the start line rather than `undefined`: a HUD
   * has something to draw from the first frame.
   *
   * An instant that is not after the last one advances nothing either, and
   * reports the state unchanged — a clock that went backwards must not wind the
   * bot back, and a repeated instant covers no time.
   */
  sample(at: UnixSeconds): BotTick;
  /** What the bot is doing, without advancing it. */
  current(): BotTick;
  /**
   * Forget the clock, so the next {@link sample} establishes it afresh without
   * advancing.
   *
   * For a client that was backgrounded, or paused, and whose next timestamp is
   * an hour after its last. The alternative is a bot that rides an hour of
   * route in one tick while the rider was away — which is arithmetically
   * correct and is not what anybody wants to come back to.
   */
  restart(): void;
}

/** Build a {@link BotPacerDriver} at the start line. @see BotPacerDriver */
export function createBotPacer(course: BotCourse): BotPacerDriver {
  let state: RideState = BOT_AT_START_LINE;
  let last: UnixSeconds | undefined;
  let tick: BotTick = { state, ...botDemand(state, course) };

  return {
    sample(at: UnixSeconds): BotTick {
      if (!Number.isFinite(at)) return tick;
      const previous = last;
      last = at;
      if (previous === undefined || at <= previous) {
        return tick;
      }
      tick = advanceBot(state, seconds(at - previous), course);
      state = tick.state;
      return tick;
    },

    current: () => tick,

    restart(): void {
      last = undefined;
    },
  };
}
