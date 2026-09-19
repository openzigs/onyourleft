// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The gradient control loop — where #90's driver meets a real trainer (#362).
 *
 * `packages/domain`'s `createSimulationDriver` decides **what gradient to ask
 * for and when**, and writes nothing; `packages/sensors/protocol`'s
 * `createSimulationWriter` writes and decides nothing. This file is the third
 * piece, and it is in `apps/web` for the reason `workout/session.ts` is: the
 * driver lives in a package that may not name a GATT characteristic, the writer
 * lives in one that may not name a route, and neither may import the other's
 * concern. Joining them is a product decision and this is where product
 * decisions go.
 *
 * ⚠️ **It is the whole of #362, and the defect was that nobody had written
 * it.** Both halves shipped in #90, both were unit-tested, both were green, and
 * `grep -rn createSimulationWriter apps/` returned nothing. The gate that
 * should have said so could not: CLAUDE.md §4j's watched set is the client's
 * own seams, and these two live in `packages/`. #363 is that gate.
 *
 * ## What a sample does
 *
 * One call, at most one write offered, **never awaited**. The driver's own rate
 * limit (once a second), deadband (0.1 %) and clamp (±40 %) decide whether
 * there is anything to say at all, so this file adds no policy of its own about
 * what may be written — which is deliberate: bounding a setpoint is
 * `packages/domain`'s job precisely so that one implementation binds every
 * caller, and a second opinion here would be a second source of truth for how
 * steep a hill a rider may be given.
 *
 * ## Three things this owns that neither package can
 *
 * **One: a failed write makes the trainer's held parameters a guess, so the
 * driver is restarted.** Without that the driver still believes it wrote the
 * gradient it was refused, its deadband suppresses the identical value on the
 * next sample, and the trainer is left holding the hill from *before* the
 * failure for as long as the road stays similar. `SimulationDriver.restart`
 * exists for exactly this and says so; this is its production caller.
 *
 * **Two: ending a ride sends a Stop — and ⚠️ THAT DOES NOT REMOVE THE
 * RESISTANCE.** This paragraph used to claim it did, and a reviewer who
 * remembers it saying `stop()` is "the deliberate way to end resistance" is
 * reading the old file. [#372](https://github.com/openzigs/onyourleft/issues/372)
 * is why.
 *
 * The hazard the old wording described is real and is unchanged: FTMS
 * simulation parameters persist on the machine until they are changed, so a
 * rider who ends a ride on a 9 % wall and walks away leaves the flywheel loaded
 * against whoever gets on next. What was wrong was the remedy. `stop()` was
 * assumed to end resistance; it ends the training **session**. Nothing in FTMS
 * requires a machine to discard its target setting values on `0x08`, and on the
 * trainer validation 0002 Part L was run against, it does not.
 *
 * Measured on hardware 2026-09-19, by the one test that can tell a cleared
 * setpoint from a trainer's own baseline drag — end a ride on a steep climb and
 * turn the cranks by hand, then do it again on a steep descent. **Climb heavy,
 * descent easy: the grade is still applied.** A single hand-turn cannot show
 * this, because a direct-drive trainer always has drag and because simulation
 * resistance nearly vanishes at zero speed anyway.
 *
 * ⚠️ No gate here can catch it. Every test asserts that `stop()` was called,
 * and it is: 402 control-point writes over that ride, 402 acknowledged, the
 * Stop among them. The defect is in what the machine does next.
 *
 * ⚠️ `workout/session.ts` §`release` makes the same choice on the same
 * reasoning, so a finished workout may likewise leave a target applied. That is
 * **not established** and must not be assumed either way — #372 carries it as a
 * separate hardware question.
 *
 * **Three: a rider is told when a write is refused.** A caller offering a
 * gradient every second has nowhere to catch a rejection that arrives four
 * seconds later, so the writer reports to a callback and this turns it into a
 * sentence. `control-not-permitted` is the one a rider can act on.
 *
 * ## What is deliberately NOT sent
 *
 * `SimulationParameters` carries a wind speed, a rolling resistance coefficient
 * and a wind resistance coefficient as well as the grade. **Only the grade is
 * written**, and the protocol client's documented defaults stand for the rest.
 *
 * - **Wind** is out of #362's scope by that issue's own words. The rider's
 *   chosen wind is a vector on `SimulationSetup` (#326, #335) and sending it
 *   would change what the resistance *means* — the trainer would add a headwind
 *   the game's own physics has already charged the rider for, twice.
 * - **The drag area** the rider picks in #365 is likewise not forwarded. FTMS's
 *   wind resistance coefficient is `0.5 · ρ · c_d·A` in kg/m, so the protocol
 *   client's 0.51 default is a `c_d·A` of about 0.83 m² — larger than any
 *   position `rider.ts` offers. Making the two agree is a real improvement and
 *   a real change to what a rider feels, which is its own issue rather than a
 *   rider-visible side effect of wiring the gradient up.
 */

import {
  createSimulationDriver,
  metres,
  unixSeconds,
  type GradePercent,
  type RouteProfile,
  type Seconds,
  type SimulationDriver,
} from '@onyourleft/domain';
import { createSimulationWriter, type SimulationWriter } from '@onyourleft/sensors/protocol';

import type { GradientTrainer } from './trainer-port';

export interface GradientSessionOptions {
  /** The route being ridden. The driver reads its grade at the rider's distance. */
  readonly profile: RouteProfile;
  readonly control: GradientTrainer;
  /** Told after anything that changes {@link GradientSessionState}. */
  readonly onChange?: ((state: GradientSessionState) => void) | undefined;
}

/** What the screen may say about the road the trainer is simulating. */
export interface GradientSessionState {
  /**
   * The gradient the trainer was last **asked** for, or `undefined` before the
   * first write.
   *
   * ⚠️ Asked for, not confirmed. `setSimulationParameters` resolves on the
   * machine's indication, so a value here with no {@link fault} beside it did
   * land — but the two move at different instants and a screen that read this
   * as "holding" would be one write ahead of the trainer for about a second.
   */
  readonly asked: GradePercent | undefined;
  /** How many writes were attempted. The number that was zero for the whole of #362. */
  readonly writes: number;
  /**
   * How many offers were superseded before they reached the wire.
   *
   * A diagnostic rather than a fault: a machine slower than the driver coalesces
   * setpoints and that is the writer working correctly. It is here for the
   * reason `WorkoutSessionState.cadenceRetained` is there — it is the only
   * place the coalescing is observable at all, and a bound nothing can see is a
   * guard nobody is keeping.
   */
  readonly coalesced: number;
  /** The last write that could not be made, in words a rider can act on. */
  readonly fault: string | undefined;
}

export interface GradientSession {
  state(): GradientSessionState;
  /**
   * Offer where the rider has got to. Returns immediately; never rejects.
   *
   * @param at the ride's own elapsed clock. ⚠️ **Monotonic ride seconds rather
   * than a wall clock**, and the conversion to the driver's `UnixSeconds` is the
   * one line below that does it. The driver compares instants only by
   * *difference* — its rate limit and its "not after the last write" guard are
   * both subtractions — so any monotonic basis in seconds is correct, and this
   * one is strictly better than `Date.now()`: it is derived from the
   * simulation's origin (`simulation.ts` §`GameState.elapsed`), so it cannot
   * step backwards over a clock correction and strand the driver refusing every
   * later sample.
   * @param distance the rider's own odometer in metres, **not** wrapped onto
   * the route. `distanceOnRoute` does the wrap inside the driver, so a second
   * lap re-rides the same hills.
   */
  sample(at: Seconds, distance: number): void;
  /**
   * End the ride and let the trainer go.
   *
   * Idempotent: `GameView` tears down from the "End ride" button and from the
   * effect's cleanup, and a rider who navigates away has ended the ride just as
   * surely as one who pressed the button.
   */
  stop(): void;
  /** Resolves once no write is outstanding. For a test, and for a clean teardown. */
  settled(): Promise<void>;
}

export function createGradientSession(options: GradientSessionOptions): GradientSession {
  const { profile, control, onChange } = options;

  const driver: SimulationDriver = createSimulationDriver({ profile });
  let fault: string | undefined;
  let stopped = false;

  const writer: SimulationWriter = createSimulationWriter(control, {
    onError: (error: unknown) => {
      fault = faultText(error);
      // ⚠️ **The half that is easy to leave out, and the one that matters.**
      // The driver believes it wrote the gradient it was refused, so its
      // deadband would suppress the identical value for as long as the road
      // stays similar — leaving the trainer on the hill from before the
      // failure, with this code thinking it had already corrected it. That is
      // `SimulationDriver.restart`'s stated purpose, word for word.
      driver.restart();
      changed();
    },
  });

  const snapshot = (): GradientSessionState => ({
    // ⚠️ Read off the driver rather than tracked here. A second copy would
    // disagree with the deadband the moment `restart` cleared one and not the
    // other, and `SimulationDriver.last` exists so that a UI does not need one.
    asked: driver.last()?.grade,
    writes: writer.attempted(),
    coalesced: writer.coalesced(),
    fault,
  });

  const changed = (): void => {
    onChange?.(snapshot());
  };

  return {
    state: snapshot,

    sample(at: Seconds, distance: number): void {
      if (stopped) {
        return;
      }
      const setpoint = driver.sample({
        // The one conversion, and the whole of it. @see GradientSession.sample.
        at: unixSeconds(at),
        distance: metres(distance),
      });
      if (setpoint === undefined) {
        // Too soon, unmoved, or the clock did not advance. The ordinary case on
        // a flat road and on fifty-nine of every sixty frames.
        return;
      }
      fault = undefined;
      writer.offer({ grade: setpoint.grade });
      changed();
    },

    stop(): void {
      if (stopped) {
        return;
      }
      stopped = true;
      // Empties the waiting slot so nothing new reaches the wire; a write
      // already in flight is on the wire and cannot be recalled.
      writer.close();
      void control.stop().catch((error: unknown) => {
        fault = faultText(error);
        changed();
      });
      changed();
    },

    settled: () => writer.idle(),
  };
}

/**
 * What a rider is told about a refused gradient.
 *
 * Deliberately not the raw error: a `SensorError` message names a GATT
 * characteristic, which means nothing on a screen. The same three cases
 * `workout/session.ts` §`faultText` tells apart, worded for the road rather
 * than for a target — a rider reading "the trainer refused that target" while
 * looking at a hill would go looking for a workout they are not riding.
 */
function faultText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('control-not-permitted') || message.includes('Control Not Permitted')) {
    return 'The trainer stopped accepting the road. Take control again on the Ride screen.';
  }
  if (message.includes('control-not-held')) {
    return 'The trainer has not granted control, so the hills are not reaching it.';
  }
  if (message.includes('timed out') || message.includes('timeout')) {
    return 'The trainer did not answer. The next gradient will be sent again.';
  }
  return 'The trainer refused that gradient. The next one will be sent again.';
}
