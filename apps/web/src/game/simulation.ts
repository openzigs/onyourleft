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
  headwindOnRoute,
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
  type Wind,
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
  /**
   * The air the ride happens in, if the rider set one — #326.
   *
   * ⚠️ **A wind vector, not a headwind**, and the difference is the whole of
   * why this field exists rather than a number on {@link RideConditions}.
   * `RideConditions.headwindMetresPerSecond` is *"everything about the ride
   * that does not change from tick to tick"* — and a headwind is not that: it
   * is the wind resolved against the direction the rider is pointing, and the
   * rider turns. A route with a single bend has a headwind on one leg and a
   * tailwind on the other from one unchanging wind, which is exactly what a
   * rider recognises from outdoors. So the *vector* is what does not change,
   * and the headwind is derived per step by {@link GameSimulation.advanceTo}.
   *
   * Absent means still air, which is what every ride in this program had
   * before #326: the conditions are then passed to `advance` byte for byte as
   * they arrive, so nothing about a windless ride's trajectory moves.
   *
   * ⚠️ **This does NOT reach the trainer, and that is deliberate.** FTMS's
   * Set Indoor Bike Simulation Parameters carries a wind speed of its own —
   * `packages/sensors/protocol/src/fitness-machine-control.ts` §`windSpeed` —
   * and sending one would change the physical resistance applied to somebody
   * who is pedalling, which CLAUDE.md §6 makes a safety question rather than a
   * feature. #326 asks for a wind in the *model*; it asks for nothing about
   * the brake. Two further things would have to be settled first: the field is
   * a `MetresPerSecond` and so cannot carry a tailwind at all, and a trainer
   * given both a gradient and a wind applies its own drag model on top of the
   * one this simulation has already applied.
   *
   * ## It cannot be changed mid-ride, and that is a decision — #335
   *
   * ⚠️ **The answer is no, and it is written here because this is the
   * declaration that would have to change for it to be yes.** #335 asks the
   * question explicitly and asks for it to be settled either way; this is the
   * settlement, and the reasons are not about effort:
   *
   * - This whole interface is *"everything the simulation needs that does not
   *   change during a ride"*, and it is read once, in the constructor. The
   *   rider's mass is held for the ride's length for the same reason
   *   (`GameView.start`): a rider who is climbing when a number changes does
   *   not have the hill they are on get heavier under them.
   * - The ride is a fixed-tick simulation whose step count is derived from the
   *   origin, and `simulation.test.ts`'s determinism cases rest on the
   *   conditions being constant. A wind that moved mid-ride would make "the
   *   same two instants produce the same distance" a claim about a history of
   *   edits rather than about two numbers.
   * - The only place a mid-ride control could go is the HUD, and #94 sizes
   *   those at 72 px for a gloved, sweating rider at threshold. A speed box
   *   and a bearing box are not that.
   *
   * So a rider who wants different air ends the ride and sets it on the
   * picker. What #335 *does* deliver is that they can see the wind they set —
   * `hud/fields.ts` §`windReading`, from {@link GameState.headwindMetresPerSecond}.
   */
  readonly wind?: Wind | undefined;
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
 * Where the moving things are drawn on **this frame** — #323.
 *
 * ## The defect this exists for
 *
 * {@link SIMULATION_STEP_SECONDS} is 0.05, so the world advances twenty times a
 * second. A phone renders at sixty. Nothing interpolated between the two, so
 * **each simulated position was drawn three times and then jumped**, and what
 * the owner saw on a Pixel Tablet was a world that stepped rather than moved.
 * The `dumpsys gfxinfo` capture in #323 is the shape of it: 63 fps presented, 0
 * missed vsyncs, 6 ms of GPU work against a 16.7 ms budget — and 94 % of frames
 * over 16 ms of wall time, because the loop was waiting on a simulation that
 * had nothing new to say for two frames out of every three. Drawing faster
 * would have changed nothing; three quarters of the frames were duplicates.
 *
 * ## Why it cannot be done in the renderer
 *
 * The standard fixed-timestep answer renders **between** the last two
 * simulation states, with the leftover accumulator as the blend. The simulation
 * already holds the fixed step, the step count derived from the origin and the
 * leftover ({@link GameSimulation.pendingSecondsAt}). What it did not hold is
 * the **previous** state, and nothing downstream can reconstruct it: the
 * renderer sees one `GameState` per frame and has no way to know whether the
 * one before it was a step earlier or a stall earlier.
 *
 * ## What it deliberately is not
 *
 * ⚠️ **It is not a higher tick rate.** Raising {@link SIMULATION_STEP_SECONDS}
 * to 60 Hz triples the physics work to hide a display problem and moves a
 * number the determinism tests are written against — the step is load-bearing,
 * and `simulation.test.ts` pins it for that reason.
 *
 * ⚠️ **It is not extrapolation.** The frame is drawn at one whole step *behind*
 * the newest simulated state, never ahead of it, so a rider is never projected
 * onto road the physics has not integrated. That is what makes it safe after a
 * catch-up burst or a backgrounded phone, where the wall clock outruns the
 * simulation by minutes — {@link GameSimulation.drawnAt} clamps the blend and
 * `simulation.test.ts` drives that case. The cost is a constant 50 ms of
 * display latency, which is a third of what a rider's own reaction time is and
 * is invisible beside the stepping it removes.
 *
 * ⚠️ **It carries distances and nothing else.** The HUD reads numbers off
 * {@link GameState} and those are fine at 20 Hz — text that changed sixty times
 * a second would be unreadable. What steps visibly is *position*, so position
 * is what is blended: the rider, the bot, and the camera through the rider.
 */
export interface DrawnRide {
  /** Where to draw the rider, in the same odometer metres as `RideState`. */
  readonly riderDistance: number;
  /** Where to draw the bot, when there is one. @see GameState.bot */
  readonly botDistance?: number | undefined;
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
  /**
   * The headwind the rider is riding into **at this point on the route**, in
   * metres per second, signed the way `packages/physics` signs it — positive
   * is a headwind, negative is a tailwind (#335).
   *
   * ⚠️ **The number the physics actually used, not a second one computed for
   * the screen.** `advanceTo` resolves the wind against the heading at the
   * rider's distance on every step and hands the result to `advance`; this
   * field is that same resolution at the distance the ride finished the call
   * on. #94's fourth criterion is that the HUD read from the simulation state
   * and never compute its own, and a HUD that called `headwindOnRoute` itself
   * would be the separately-computed value that criterion forbids — reachable
   * only because the profile and the wind are both on hand.
   *
   * ⚠️ **`undefined` means no wind was set, and it is not a zero.** A ride in
   * still air has no wind reading at all rather than one reading nought —
   * `hud/fields.ts` §`windReading` is where that distinction is rendered and
   * `NO_READING` is the precedent it follows. A plain `number` rather than a
   * `MetresPerSecond` for the reason `RideConditions.headwindMetresPerSecond`
   * is one: the brand is a non-negative magnitude and a tailwind is negative.
   *
   * It moves as the road bends, which is the whole of what makes it worth
   * showing: one unchanging wind is a headwind on the way out and a tailwind
   * on the way back. @see SimulationSetup.wind, which cannot change mid-ride.
   */
  readonly headwindMetresPerSecond?: number | undefined;
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
  /**
   * Where the rider and the bot were one fixed step before {@link #state} —
   * the other end of the blend {@link drawnAt} draws between (#323).
   *
   * `undefined` until a step has actually run, which is the whole of the first
   * frame of a ride and every frame of a ride nobody is pedalling: with one
   * state there is nothing to interpolate and {@link drawnAt} says so by
   * returning that state.
   */
  #previous:
    { readonly riderDistance: number; readonly botDistance: number | undefined } | undefined;

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
      // ⚠️ On the start line from the first frame, for the reason the bot is:
      // `GameView` renders the HUD from `simulation.state` before the loop has
      // run once, and a wind that appeared a tick late would show a rider a
      // dash for the field they had just set — indistinguishable from the
      // still-air ride they did not choose.
      ...headwindField(this.#headwindAt(START_OF_RIDE.distance)),
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
   * Where to draw the rider and the bot at `nowMs` — #323. @see DrawnRide
   *
   * Reads and advances nothing: it is a blend of the two states the simulation
   * already holds, so a caller may ask for one frame or a hundred between two
   * ticks and get a different answer each time without moving the ride by a
   * millimetre. `advanceTo` is still the only thing that simulates.
   *
   * ⚠️ **The blend is clamped to `[0, 1]`, and that clamp is the acceptance
   * criterion rather than a tidiness.** It is `pendingSecondsAt / step`, which
   * is below one on any frame that follows an `advanceTo` — but a caller that
   * draws without advancing, and a phone that was backgrounded between the two,
   * both hand this a `nowMs` seconds past the newest step. Unclamped that
   * projects the rider hundreds of metres up a road nothing has integrated,
   * through whatever scenery is there. Clamped, the worst case is the newest
   * simulated position, which is exactly where the old code always drew.
   */
  drawnAt(nowMs: number): DrawnRide {
    const current = this.#state;
    const currentBot = current.bot?.state.distance;
    const previous = this.#previous;
    if (previous === undefined) {
      return {
        riderDistance: current.ride.distance,
        ...(currentBot === undefined ? {} : { botDistance: currentBot }),
      };
    }
    const blend = Math.min(1, Math.max(0, this.pendingSecondsAt(nowMs) / SIMULATION_STEP_SECONDS));
    // A ride either has a bot for all of it or for none of it — the course is
    // built once, in the constructor — so the two are absent together.
    const botDistance =
      currentBot === undefined || previous.botDistance === undefined
        ? currentBot
        : between(previous.botDistance, currentBot, blend);
    return {
      riderDistance: between(previous.riderDistance, current.ride.distance, blend),
      ...(botDistance === undefined ? {} : { botDistance }),
    };
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
    // ⚠️ **One step back, not one `advanceTo` back** — #323. A catch-up burst
    // runs up to {@link MAXIMUM_STEPS_PER_ADVANCE} steps in one call, and
    // blending from where the rider was before all of them would draw them
    // gliding through ten seconds of road they had already covered. Captured at
    // the top of each iteration, so after the loop it holds the step before the
    // one the next frames blend towards.
    let previousRide = ride;
    let previousBot = bot;
    for (let step = 0; step < toRun; step += 1) {
      previousRide = ride;
      previousBot = bot;
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
        // ⚠️ **Re-resolved per step, for the reason the grade above is.** The
        // wind is fixed; the rider's heading is not, so the *headwind* changes
        // every time the road bends. Holding one headwind for a whole ride
        // would give a rider a tailwind all the way out and all the way back.
        this.#conditionsAt(ride.distance),
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
        //
        // ⚠️ **The bot rides the SAME WIND as the rider, resolved at the bot's
        // own heading** — #326's fourth criterion, which asks for this to be
        // decided rather than left to happen. One wind vector reaches both, so
        // a pacer can never be sheltered from a headwind the rider is fighting;
        // and each resolves it where it actually is, so on a bend the one
        // already round the corner feels what that corner does, which is what
        // riding beside somebody outdoors is like. Handing the bot the rider's
        // *headwind* instead would be the cheaper code and a different race: it
        // would put the bot in air that depends on where the rider is.
        bot = advanceBot(
          bot.state,
          seconds(SIMULATION_STEP_SECONDS),
          this.#courseAt(course, bot.state.distance),
        );
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
    this.#previous = {
      riderDistance: previousRide.distance,
      botDistance: previousBot?.state.distance,
    };

    this.#state = {
      ride,
      // An exact multiple of the step, so this cannot drift from the step count.
      elapsed: seconds(this.#stepsCredited * SIMULATION_STEP_SECONDS),
      ridden: seconds(this.#stepsRun * SIMULATION_STEP_SECONDS),
      grade: gradeAtDistance(this.#setup.profile, ride.distance),
      input,
      ...(bot === undefined ? {} : { bot }),
      // ⚠️ At the distance the ride ENDED this call on, which is the same
      // distance `grade` above is read at and the one the rider is drawn at.
      // Reporting the headwind the last step was *integrated* with would be a
      // step behind the gradient beside it, and on a bend the two would
      // describe different pieces of road.
      ...headwindField(this.#headwindAt(ride.distance)),
    };
    return { steps: toRun, skippedSeconds: skippedSteps * SIMULATION_STEP_SECONDS };
  }

  /**
   * The rider's conditions at one point on the route — #326.
   *
   * Everything in {@link SimulationSetup.conditions}, with the headwind
   * replaced by the wind resolved against the heading at `distance`.
   *
   * ⚠️ **The object identity is preserved when there is no wind**, and that is
   * load-bearing rather than a micro-optimisation: a windless ride must be
   * *exactly* the ride it was before this change, down to the last bit of the
   * odometer, and `simulation.test.ts`'s determinism cases are written against
   * that. Returning a fresh spread would still be correct; returning the same
   * object is what makes "nothing moved" obvious.
   */
  #conditionsAt(distance: number): RideConditions {
    const headwind = this.#headwindAt(distance);
    if (headwind === undefined) {
      return this.#setup.conditions;
    }
    return { ...this.#setup.conditions, headwindMetresPerSecond: headwind };
  }

  /**
   * The rider's headwind at one point on the route, or `undefined` when no
   * wind was set — #335.
   *
   * ⚠️ **One function feeding both the physics and the screen, deliberately.**
   * {@link #conditionsAt} hands its answer to `advance` and
   * {@link GameState.headwindMetresPerSecond} shows the same answer to the
   * rider, so there is no second resolution of the same wind for the two to
   * disagree about. #94's third criterion asks for exactly that about the
   * elevation marker — *"rather than a separately-computed value that can
   * drift"* — and the wind is the same shape of number.
   */
  #headwindAt(distance: number): number | undefined {
    const wind = this.#setup.wind;
    if (wind === undefined) {
      return undefined;
    }
    return headwindOnRoute(this.#setup.profile, distance, wind);
  }

  /** The bot's course at one point on the route. @see #conditionsAt */
  #courseAt(course: BotCourse, distance: number): BotCourse {
    const wind = this.#setup.wind;
    if (wind === undefined) {
      return course;
    }
    return {
      ...course,
      headwindMetresPerSecond: headwindOnRoute(course.profile, distance, wind),
    };
  }
}

/**
 * The headwind as a {@link GameState} field, present only when there is one.
 *
 * ⚠️ **A helper rather than the inline ternary the fields beside it use**, for
 * one reason: the two call sites are a constructor and a hot loop, and the
 * property name is the thing that must not drift between them. A field spelled
 * one way on the first frame and another on every frame after it would show a
 * rider a wind that vanished the moment they started pedalling, and both sites
 * would typecheck.
 */
function headwindField(headwind: number | undefined): {
  readonly headwindMetresPerSecond?: number;
} {
  return headwind === undefined ? {} : { headwindMetresPerSecond: headwind };
}

/** Linear blend between two odometer readings. @see DrawnRide */
function between(from: number, to: number, blend: number): number {
  return from + (to - from) * blend;
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
 *
 * ⚠️ The headwind copied here is a **constant** one, from
 * {@link RideConditions}. When {@link SimulationSetup.wind} is set,
 * {@link GameSimulation.advanceTo} overrides it every step with the wind
 * resolved at the bot's own heading — this course is the base it overrides.
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
