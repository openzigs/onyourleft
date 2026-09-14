// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The fixed-tick simulation, and the seam that keeps the renderer out of it.
 *
 * ## Why this file exists at all
 *
 * #91's second acceptance criterion, and one of #85's epic-level ones:
 *
 * > *"**The simulation is decoupled from the render loop**: a test drives the
 * > physics tick at a fixed rate while stalling the renderer and asserts final
 * > position is identical to an unstalled run. This names the failure — a
 * > physics model coupled to frame rate corrupts silently under exactly the
 * > thermal conditions this ride will produce."*
 *
 * That last clause is the whole design. The naive loop — advance the ride by one
 * frame's worth of time, every frame — is correct on a cold phone and wrong on a
 * hot one, and #91's own context section explains that the phone **will** get
 * hot: screen on at high brightness for 45 to 120 minutes, bar-mounted, usually
 * charging. A rider whose phone throttles from 30 fps to 12 would, under a
 * frame-coupled model, quietly cover less ground for the same effort. They would
 * have no way to see it and no reason to suspect it.
 *
 * ## How the decoupling actually works
 *
 * {@link GameSimulation.advanceTo} takes **wall-clock time**, not a frame count,
 * and derives how many steps *should* have run by that instant directly from the
 * origin:
 *
 * ```
 * stepsOwedBy(now) = floor((now - origin) / step)
 * ```
 *
 * then runs however many of those have not run yet. So the step count between
 * two instants is a pure function of those two instants — never of how many
 * times the renderer got round to asking. Called sixty times a second or twice a
 * second, the rider arrives at the same metre, **exactly**, not nearly.
 *
 * ⚠️ **This is deliberately not the textbook accumulator, and the difference is
 * not stylistic.** The usual form — add each frame's delta to a running float,
 * spend whole steps out of it, keep the remainder — was written first here and
 * was measurably wrong: summing 1 800 deltas of 33.333… ms accumulates floating-
 * point error, so a 60-second ride ran 1 199 steps at one frame rate and 1 200 at
 * another, and the two runs finished 0.23 m apart. That is small, but it is the
 * exact defect #91's criterion asks about, only quieter — and "quieter" is worse,
 * because it survives review. Deriving the count from the origin has no running
 * sum to drift: the subtraction is done once, against a number that never
 * changes.
 *
 * ⚠️ **Nothing here reads a clock.** `now` is a parameter, exactly as it is in
 * `packages/domain`'s recording engine and workout player, and for the same
 * reason: a simulation that reads `Date.now()` cannot be tested at two frame
 * rates and compared, which is precisely the test the criterion asks for.
 *
 * ## What the renderer may and may not do
 *
 * The renderer **reads** {@link GameSimulation.state} and never advances it.
 * That is stated here because the inverse — a renderer that ticks the physics
 * because it happens to be the thing with a frame loop — is the natural shape to
 * reach for and is the defect. `port.ts` is the seam that keeps the two apart.
 */

import {
  BOT_AT_START_LINE,
  advance,
  advanceBot,
  botDemand,
  START_OF_RIDE,
  type BotCourse,
  type BotTick,
  type RideConditions,
  type RideState,
} from '@onyourleft/physics';
import {
  gradeAt,
  metres,
  metresPerSecond,
  seconds,
  watts,
  type BotPacerPlan,
  type GradePercent,
  type Metres,
  type RouteProfile,
  type Seconds,
  type Watts,
} from '@onyourleft/domain';

/**
 * The simulation's fixed step, in seconds.
 *
 * 20 Hz. Chosen against the two things it has to sit between rather than picked
 * for roundness: it must be **faster than the render** so a frame never waits on
 * a tick that has not happened, and **slower than the integrator's own sub-step**
 * so `advance` is not asked to divide an already-small interval. #91's target is
 * 30 fps, so 20 Hz ticks and 30 Hz frames interleave without either being a
 * multiple of the other — which is the case the accumulator exists for and the
 * reason the tests use frame rates that do not divide evenly into it.
 *
 * ⚠️ Changing this changes the *trajectory*, not just the cost: the integrator
 * is deterministic per step, so a different step size gives a slightly different
 * distance for the same power trace. `simulation.test.ts` asserts the two frame
 * rates agree with each other, not that either matches a magic number, for
 * exactly that reason.
 */
export const SIMULATION_STEP_SECONDS = 0.05;

/**
 * The most steps one `advanceTo` will run before it gives up catching up.
 *
 * The "spiral of death" of fixed-timestep loops, and it is a real risk here
 * rather than a textbook one: a backgrounded WebView gets no frames at all, so
 * the first call after the rider unlocks the phone can carry minutes of
 * unconsumed wall-clock time. Simulating all of it in one synchronous burst
 * would block the JavaScript thread that GATT notifications also arrive on
 * (#87 counts the samples that would be dropped), and the ride would appear to
 * teleport.
 *
 * 200 steps is 10 seconds of simulation per call. Beyond that the surplus is
 * **discarded and reported** through {@link SimulationTick.skippedSeconds}
 * rather than silently swallowed, because a ride that lost time is a fact the
 * rider is entitled to and #94 has somewhere to put it.
 */
export const MAXIMUM_STEPS_PER_ADVANCE = 200;

/**
 * The clock everything that *races* the rider is read against — #254.
 *
 * ## The rule, stated next to the bound it belongs to
 *
 * > **A stall is time nobody rode.** The rider does not cover the road they were
 * > away for, because {@link MAXIMUM_STEPS_PER_ADVANCE} bounds the steps one
 * > `advanceTo` will integrate. The bot does not, because #237 put it inside
 * > that same loop. **And neither does the ghost**, because every "where is it
 * > now" question is asked at {@link GameState.ridden} — the seconds actually
 * > integrated — and never at {@link GameState.elapsed}, which is wall clock
 * > and carries the stall.
 *
 * ⚠️ **This is the seam #254 was, and the two constants have to be read
 * together for the same reason.** Each piece was right on its own:
 * `ghostDistanceAt` replays a recording against recorded time,
 * {@link MAXIMUM_STEPS_PER_ADVANCE} bounds a catch-up burst, and crediting the
 * whole outstanding amount to `elapsed` is right for a clock. Only the join was
 * wrong: five minutes backgrounded advanced the rider and the bot by ten
 * seconds of road and the ghost by five minutes of it, so a rider who picked
 * the phone back up found the pacer where they left it and the ghost gone.
 *
 * ## What this rule deliberately is not
 *
 * - **It does not re-simulate the ghost.** Nothing about a recording is
 *   recomputed: `ghostDistanceAt` is called unchanged, with a time in the
 *   recording's own base, and `packages/domain/src/ghost/replay.ts`'s promise —
 *   *"a replay of recorded distance against recorded time, never a
 *   re-simulation"* — is untouched. What changed is **which** clock is handed
 *   to it, not what it does with one.
 * - **It does not rebase the ghost's clock.** The attempt's own samples are
 *   never shifted or scaled, so the previous ride is never made to look slower
 *   than it was. Both riders are compared at *T seconds of riding*, which is
 *   the same basis the bot is already compared on and the only one under which
 *   a stall favours neither.
 *
 * The cost, stated plainly: after a stall the ride's wall clock and its racing
 * clock diverge, so a ride that says it lasted five minutes may have raced ten
 * seconds of it. That divergence is the ride genuinely having lost time, and it
 * is already reported to the rider through {@link SimulationTick.skippedSeconds}
 * rather than being invented here.
 *
 * Every caller that places or measures a ghost goes through this function, so
 * the marker on the road and the gap in the HUD cannot be read against two
 * different clocks.
 */
export function ghostClock(state: GameState): Seconds {
  // Clamped because `ghostDistanceAt` is documented at both ends and a negative
  // time is neither of them. `ridden` cannot go negative today — it only ever
  // accumulates — and the clamp is here rather than at three call sites so that
  // it cannot be right at two of them and forgotten at the third.
  return seconds(Math.max(0, state.ridden));
}

/** What the rider's sensors are currently reporting. */
export interface RiderInput {
  /** Power at the pedals, as the trainer or meter reports it. */
  readonly power: Watts;
  /**
   * Whether that reading is **live**.
   *
   * ⚠️ Not a nicety: #94's second criterion is that a dropped sensor must be
   * visually distinct from a genuine zero, and this is the bit that carries the
   * difference all the way from the transport to the screen. A disconnected
   * trainer reports `power: 0, live: false`; a rider freewheeling reports
   * `power: 0, live: true`. Collapsing them into one number is exactly the
   * failure that criterion names.
   */
  readonly live: boolean;
  /**
   * Whether a power sensor is paired at all.
   *
   * ⚠️ **The simulation never reads this** — it is carried on the input so the
   * HUD can tell "no trainer paired" from "the trainer dropped", which
   * `hud/fields.ts` §`SensorReading.paired` explains is the difference between
   * a warning and a false alarm on every ride. It rides here rather than
   * beside the state because #94's fourth criterion is that the HUD read from
   * the simulation state and compute nothing of its own, and a second channel
   * for one boolean is exactly the second source of truth that criterion is
   * about.
   */
  readonly paired?: boolean | undefined;
}

/** Everything the simulation needs that does not change during a ride. */
export interface SimulationSetup {
  readonly profile: RouteProfile;
  readonly conditions: RideConditions;
  /**
   * The bot pacer the rider chose to ride against, if any (#92, wired in #237).
   *
   * ⚠️ **A plan, not a mass and not a power.** The plan carries the bot's own
   * mass — `BOT_MASS_KILOGRAMS`, never the rider's — and `pacing.ts`
   * turns it into a power against the gradient the bot is on. Passing the
   * rider's {@link RideConditions} to the bot instead is the one mistake this
   * field exists to make impossible, and `simulation.test.ts` asserts the two
   * trajectories differ.
   *
   * Absent means there is no bot: {@link GameState.bot} is then `undefined`,
   * `sceneFrame` places no marker and the HUD's gap field shows a dash.
   */
  readonly pacer?: BotPacerPlan | undefined;
}

/** What one call to {@link GameSimulation.advanceTo} did. */
export interface SimulationTick {
  /** How many fixed steps were consumed. Zero is normal and not an error. */
  readonly steps: number;
  /**
   * Wall-clock seconds thrown away because {@link MAXIMUM_STEPS_PER_ADVANCE}
   * was reached. Zero on every ordinary frame.
   */
  readonly skippedSeconds: number;
}

/**
 * A ride in progress: where the rider is, how fast, and how long they have been
 * riding.
 *
 * Deliberately one object the renderer and the HUD both read, rather than each
 * deriving its own. #94's fourth criterion is that the HUD reads from the
 * simulation state and never computes its own, and the cheapest way to make that
 * true is to leave it nothing to compute from.
 */
export interface GameState {
  readonly ride: RideState;
  /**
   * How long the ride has lasted, in seconds — **wall clock, stall included**.
   *
   * An exact multiple of {@link SIMULATION_STEP_SECONDS} derived from the
   * origin, so it cannot drift. A ride that was backgrounded for five minutes
   * really did last five minutes and this says so.
   *
   * ⚠️ **Not the clock to race anything against.** See {@link ridden} and
   * {@link ghostClock}.
   */
  readonly elapsed: Seconds;
  /**
   * How much of that was actually ridden — {@link elapsed} minus every second a
   * stall discarded (#254).
   *
   * Equal to {@link elapsed} on every ordinary ride, and the two separate only
   * once a single `advanceTo` has more than {@link MAXIMUM_STEPS_PER_ADVANCE}
   * steps owed to it. This is the road the rider and the bot actually covered,
   * so it is the clock the ghost is placed and measured against —
   * {@link ghostClock} states the rule and is how every caller reads it.
   */
  readonly ridden: Seconds;
  /** The gradient at the rider's current position on the route. */
  readonly grade: GradePercent;
  /** The last input the simulation was advanced with. @see RiderInput */
  readonly input: RiderInput;
  /**
   * The bot pacer's own ride, when the rider chose one — #237.
   *
   * ⚠️ **It lives on the game state rather than beside it**, for the reason
   * #94's fourth criterion gives about the HUD: the renderer and the HUD both
   * read one object, so there is no second odometer for the bot's position on
   * the road to disagree with the bot's gap in the HUD. `GameView` reads
   * `bot.state.distance` for both.
   *
   * `undefined` when no pacer was chosen, which is what makes the bot's absence
   * a fact the scene and the HUD can both see rather than a zero they would
   * both draw.
   */
  readonly bot?: BotTick | undefined;
}

/**
 * A ride being simulated on a fixed clock.
 *
 * Created once per ride and advanced from whatever loop the host has — a
 * `requestAnimationFrame` in the app, a plain loop in a test. It holds mutable
 * state deliberately: the alternative is threading a growing tuple through every
 * frame, and the state is genuinely per-ride and genuinely mutable.
 */
export class GameSimulation {
  readonly #setup: SimulationSetup;
  /** The bot's course, built once. `undefined` when no pacer was chosen. */
  readonly #course: BotCourse | undefined;
  #state: GameState;
  #originMs: number | undefined;
  /**
   * How many steps the clock has credited since the origin — **not** how many
   * were integrated.
   *
   * The two differ only after a stall longer than
   * {@link MAXIMUM_STEPS_PER_ADVANCE}, and keeping the credited count on the
   * clock is what stops the simulation trying to catch up forever after the
   * rider unlocks their phone. The ride really did last that long; the steps we
   * declined to integrate are reported through
   * {@link SimulationTick.skippedSeconds} instead of being pretended away.
   */
  #stepsCredited = 0;
  /**
   * How many steps were **integrated** — the other half of the pair
   * {@link #stepsCredited} names, and the one every racer is read against.
   *
   * Kept as a count rather than derived by subtracting the skipped seconds from
   * the elapsed ones, so it is an exact multiple of the step for the same
   * reason `elapsed` is: a running sum of floating-point durations drifts, and
   * `simulation.ts`'s header records the 0.23 m that cost the first time.
   */
  #stepsRun = 0;

  constructor(setup: SimulationSetup) {
    this.#setup = setup;
    this.#course = botCourseFor(setup);
    this.#state = {
      ride: START_OF_RIDE,
      elapsed: seconds(0),
      ridden: seconds(0),
      grade: gradeAtDistance(setup.profile, START_OF_RIDE.distance),
      input: { power: watts(0), live: false },
      // On the start line from the first frame rather than from the first tick:
      // `GameView` renders a scene before the loop has run once, and a bot that
      // appeared a frame late would pop onto the road in front of the rider.
      // `botDemand` reads the road without advancing anything.
      ...(this.#course === undefined
        ? {}
        : { bot: { state: BOT_AT_START_LINE, ...botDemand(BOT_AT_START_LINE, this.#course) } }),
    };
  }

  /** The current state. Read by the renderer and the HUD; written by nobody else. */
  get state(): GameState {
    return this.#state;
  }

  /**
   * Wall-clock seconds that have passed since the last completed step — the
   * sliver a frame lands inside. Always less than one step. For tests.
   */
  pendingSecondsAt(nowMs: number): number {
    if (this.#originMs === undefined) {
      return 0;
    }
    return (nowMs - this.#originMs) / 1000 - this.#stepsCredited * SIMULATION_STEP_SECONDS;
  }

  /**
   * Advances the ride to `nowMs`, running every fixed step owed since the origin.
   *
   * The first call establishes that origin and simulates nothing: there is no
   * previous instant to measure from, and treating `nowMs` as an elapsed duration
   * would advance the ride by however long the page had been open.
   *
   * Time that runs backwards — a clock adjustment, or a caller passing a stale
   * timestamp — owes no new steps, so it does nothing. It cannot rewind the ride:
   * this model has no reverse and `RideState.distance` is a non-negative
   * magnitude.
   */
  advanceTo(nowMs: number, input: RiderInput): SimulationTick {
    if (this.#originMs === undefined) {
      this.#originMs = nowMs;
      this.#state = { ...this.#state, input };
      return { steps: 0, skippedSeconds: 0 };
    }

    const owed = Math.floor((nowMs - this.#originMs) / 1000 / SIMULATION_STEP_SECONDS);
    const outstanding = owed - this.#stepsCredited;
    if (outstanding <= 0) {
      this.#state = { ...this.#state, input };
      return { steps: 0, skippedSeconds: 0 };
    }

    const toRun = Math.min(outstanding, MAXIMUM_STEPS_PER_ADVANCE);
    let ride = this.#state.ride;
    const course = this.#course;
    let bot = this.#state.bot;
    for (let step = 0; step < toRun; step += 1) {
      // Re-read per step rather than once per call: over a long stall the rider
      // crosses real terrain, and holding one grade for 200 steps would flatten
      // a hill they actually climbed.
      const grade = gradeAtDistance(this.#setup.profile, ride.distance);
      ride = advance(
        ride,
        {
          // A dropped sensor contributes no power, which is the physically
          // honest reading: we do not know what the rider is doing, so we do not
          // invent a number. The HUD says the link is down; the simulation does
          // not pretend the rider stopped *or* that they kept going.
          power: input.live ? input.power : watts(0),
          grade,
          duration: seconds(SIMULATION_STEP_SECONDS),
        },
        this.#setup.conditions,
      );
      if (course !== undefined && bot !== undefined) {
        // ⚠️ **In the same loop as the rider, at the same step, and through
        // `advanceBot` rather than through `advance` directly.** Both halves are
        // #237's second acceptance criterion. The same loop is what makes the
        // bot skip exactly the time the rider skips, so a backgrounded phone
        // cannot hand it a lead; `advanceBot` is what makes "the bot and the
        // rider go through the same tick" a fact about the call graph, which is
        // what `packages/physics/src/pacer.ts` exists for and what a second
        // integrator here would quietly make false.
        bot = advanceBot(bot.state, seconds(SIMULATION_STEP_SECONDS), course);
      }
    }

    // Credit the whole outstanding amount even when only part of it was
    // integrated, so a stall is absorbed once rather than chased forever.
    this.#stepsCredited = owed;
    // ⚠️ `toRun`, not `outstanding` — this is the counter that must NOT absorb
    // the stall. It is what {@link ghostClock} reads, and crediting it the whole
    // amount here would put #254 straight back: the rider and the bot would
    // cover ten seconds of road and the ghost five minutes of it.
    this.#stepsRun += toRun;
    const skippedSteps = outstanding - toRun;

    this.#state = {
      ride,
      // An exact multiple of the step, so this cannot drift from the step count.
      elapsed: seconds(this.#stepsCredited * SIMULATION_STEP_SECONDS),
      ridden: seconds(this.#stepsRun * SIMULATION_STEP_SECONDS),
      grade: gradeAtDistance(this.#setup.profile, ride.distance),
      input,
      ...(bot === undefined ? {} : { bot }),
    };
    return { steps: toRun, skippedSeconds: skippedSteps * SIMULATION_STEP_SECONDS };
  }
}

/**
 * The gradient under the rider, wrapped for a loop.
 *
 * Delegates to `packages/domain`'s `gradeAt`, which is also what #90's trainer
 * driver uses — so the resistance the rider feels and the hill they see are the
 * same number by construction rather than by two implementations agreeing.
 */
function gradeAtDistance(profile: RouteProfile, distance: Metres): GradePercent {
  return gradeAt(profile, distance);
}

/**
 * The bot's course, or `undefined` when no pacer was chosen.
 *
 * ⚠️ **The rider's `totalMass` is dropped rather than passed through**, and
 * `BotCourse` omits the field for exactly this reason: *"a caller who could
 * pass a mass here would reasonably expect it to be used, and the one thing #92
 * fixes about the bot is that its mass is 75 kg and not the rider's."* The
 * environmental half — air density, headwind, coefficients, integration step —
 * is shared on purpose: the bot and the rider are on the same road in the same
 * air, and it is only the mass and the power that are the bot's own.
 */
function botCourseFor(setup: SimulationSetup): BotCourse | undefined {
  if (setup.pacer === undefined) {
    return undefined;
  }
  const conditions = setup.conditions;
  return {
    profile: setup.profile,
    plan: setup.pacer,
    airDensityKilogramsPerCubicMetre: conditions.airDensityKilogramsPerCubicMetre,
    ...(conditions.headwindMetresPerSecond === undefined
      ? {}
      : { headwindMetresPerSecond: conditions.headwindMetresPerSecond }),
    ...(conditions.coefficients === undefined ? {} : { coefficients: conditions.coefficients }),
    ...(conditions.integrationStepSeconds === undefined
      ? {}
      : { integrationStepSeconds: conditions.integrationStepSeconds }),
  };
}

/**
 * A stationary rider, for a caller that needs a state before the first tick.
 *
 * ⚠️ **The ride screen no longer uses this, and #237 is why.** It takes a
 * profile and knows nothing about a pacer, so the state it returns has no bot
 * in it — a paced ride seeded from here would draw no bot and show a dash for
 * the gap until the first tick landed. `GameView` reads `simulation.state`
 * instead, which is the object that has the answer. What still calls it is
 * `browser/game-harness.ts`, which builds a scene with no simulation at all.
 *
 * @unwired the browser harness is its only caller, and a harness is a gate
 * rather than a page the product loads — #236 is what happens when the two are
 * confused, so `check-wiring.mjs` does not treat `browser/` as an entry point.
 */
export function atStartLine(profile: RouteProfile): GameState {
  return {
    ride: { speed: metresPerSecond(0), distance: metres(0) },
    elapsed: seconds(0),
    ridden: seconds(0),
    grade: gradeAtDistance(profile, metres(0)),
    input: { power: watts(0), live: false },
  };
}
