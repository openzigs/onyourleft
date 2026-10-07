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
 * should have said so could not: docs/agents/wiring-gate.md §4j's watched set is the client's
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
 * **Two: ending a ride releases the trainer — and ⚠️ ON THE TRAINER MEASURED,
 * NOTHING THIS CLIENT CAN SEND REMOVES THE RESISTANCE.** This paragraph has
 * been wrong twice, and a reviewer who remembers either earlier version is
 * reading an old file: first it said `stop()` was "the deliberate way to end
 * resistance"; then PR #442 made the release an FTMS Reset because FTMS says a
 * Reset returns the machine to its defaults.
 *
 * The hazard is real: FTMS simulation parameters persist on the machine until
 * they are changed, so a rider who ends a ride on a 9 % wall and walks away
 * leaves the flywheel loaded against whoever gets on next. What the machine
 * does about it was measured ([#372](https://github.com/openzigs/onyourleft/issues/372)):
 *
 * - **Stop, 2026-09-19.** End a ride on a steep climb and turn the cranks by
 *   hand, then again on a steep descent: **climb heavy, descent easy**, so the
 *   grade was still applied after an acknowledged `0x08`. (A single hand-turn
 *   cannot show this — a direct-drive trainer always has drag, and simulation
 *   resistance nearly vanishes at zero speed — which is why validation 0002 L5
 *   now uses the pedal-through test and reads the trainer's own power.)
 * - **Reset, 2026-09-21**, PR #442's build, ERG: acknowledged `80 01 01`, and
 *   the trainer held 198–202 W across 64–81 rpm, then raised power as cadence
 *   fell. It cleared nothing a Stop did not, and it revoked control, so every
 *   ride ended with the rider asking for control again.
 *
 * The owner accepted the retention on 2026-09-21, on the condition that the app
 * can take control again — which it can. So {@link GradientSession.stop} calls
 * `control.letGo()`, which is the ride controller's ONE release and sends a
 * Stop. The value of it being one method is that the next time hardware says
 * what a release should send, it changes in one place.
 *
 * ⚠️ If the machine refuses or does not answer the Stop, the rider is told the
 * trainer may still be holding resistance — by the ride controller, on the Ride
 * screen and on this game's route picker. An acknowledged Stop says nothing of
 * the kind, because on the measured trainer it would be saying it every time.
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
  distanceOnRoute,
  gradeAt,
  gradePercent,
  MAX_SIMULATED_GRADE_PERCENT,
  metres,
  SIMULATION_GRADE_DEADBAND_PERCENT,
  SIMULATION_SETPOINT_INTERVAL_SECONDS,
  unixSeconds,
  type GradePercent,
  type RouteProfile,
  type Seconds,
  type SimulationDriver,
} from '@onyourleft/domain';
import {
  createSimulationWriter,
  type SimulationSink,
  type SimulationWriter,
} from '@onyourleft/sensors/protocol';

import type { GradientTrainer } from './trainer-port';
import { TargetHeldBack } from '../ride/held-back';
import { CORRECTION_GRADE_STEP_PERCENT_PER_SECOND } from '../net/correction';

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
   * @param bounded that the rider is being moved toward a room's position
   * (#782, `net/correction.ts`), so the gradient written may change by at most
   * `CORRECTION_GRADE_STEP_PERCENT_PER_SECOND` a second. ⚠️ A write that falls
   * short of the road is OWED: the next samples keep walking toward the road
   * at the same rate after the correction ends, and only when the trainer is
   * on the road's own grade does the driver take over again — so a bounded
   * write never leaves the trainer holding a grade the road does not have.
   */
  sample(at: Seconds, distance: number, bounded?: boolean): void;
  /**
   * End the ride and let the trainer go — `control.letGo()`, an FTMS Stop
   * (#372). @see the module note, "Two", for what that does not do.
   *
   * Idempotent: `GameView` tears down from the "End ride" button and from the
   * effect's cleanup, and a rider who navigates away has ended the ride just as
   * surely as one who pressed the button — validation 0002 L7 checks the second.
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
  /** The grade last handed to the writer, and the ride second it was. */
  let sent: { readonly grade: number; readonly at: number } | undefined;
  /** A bounded write left the trainer short of the road. @see GradientSession.sample */
  let owed = false;
  /**
   * The grade the trainer last CONFIRMED (#932), apart from {@link sent}, which
   * is only what it was last asked for. After a refused or unanswered write it
   * is the one grade this client knows the machine is on, so a correction
   * walks on from here rather than from nothing.
   */
  let acknowledged: number | undefined;
  /** Every offer made, so the writer's waiting slot can be told apart. */
  let offers = 0;

  // Writes are one at a time (the writer keeps one in flight), so the last to
  // resolve is the newest the trainer holds.
  const sink: SimulationSink = {
    setSimulationParameters: async (parameters) => {
      await control.setSimulationParameters(parameters);
      acknowledged = parameters.grade;
    },
  };

  const offer = (grade: GradePercent): void => {
    offers += 1;
    writer.offer({ grade });
  };

  const writer: SimulationWriter = createSimulationWriter(sink, {
    onError: (error: unknown) => {
      fault = faultText(error);
      // ⚠️ **The half that is easy to leave out, and the one that matters.**
      // The driver believes it wrote the gradient it was refused, so its
      // deadband would suppress the identical value for as long as the road
      // stays similar — leaving the trainer on the hill from before the
      // failure, with this code thinking it had already corrected it. That is
      // `SimulationDriver.restart`'s stated purpose, word for word.
      driver.restart();
      // #782: and the bounded path's own memory of what was written, for the
      // same reason — the next write is a fresh one.
      //
      // ⚠️ #932: but NOT its bound. Until #932 this cleared `sent` and `owed`
      // outright, so the write after a fault went through the driver and put
      // the road's own grade on the trainer at once — up to the whole ±8 %
      // swing a room correction (#782) is bounded to walk. The trainer is on
      // the grade it last confirmed, so the walk goes on from THAT, at the
      // same rate, whether or not a correction was owed when the fault came.
      if (acknowledged === undefined || stopped) {
        // Nothing confirmed: nothing known to walk from, as before #932.
        sent = undefined;
        owed = false;
      } else {
        const at = sent?.at ?? Number.NEGATIVE_INFINITY;
        sent = { grade: acknowledged, at };
        // A write already waiting behind the refused one was walked from the
        // REFUSED grade, so it may be a step and more from the trainer's. While
        // a correction is owed it is replaced with the confirmed grade itself:
        // the trainer is asked for nothing it does not already hold, and the
        // walk resumes from there on the next sample.
        const waiting = offers > writer.attempted() + writer.coalesced();
        if (owed && waiting) offer(gradePercent(acknowledged));
      }
      changed();
    },
  });

  const snapshot = (): GradientSessionState => ({
    // ⚠️ What was last handed to the writer — the driver's setpoint, or since
    // #782 a bounded one. Until #782 this read `driver.last()`, which is right
    // only while the driver is the one writer: a bounded write restarts it, and
    // it would have reported nothing asked while the trainer was being walked
    // up a hill. Both writers set it, and a refused write clears it with the
    // driver's own `restart`, so the two cannot disagree about a fault.
    asked: sent === undefined ? undefined : gradePercent(sent.grade),
    writes: writer.attempted(),
    coalesced: writer.coalesced(),
    fault,
  });

  const changed = (): void => {
    onChange?.(snapshot());
  };

  return {
    state: snapshot,

    sample(at: Seconds, distance: number, bounded = false): void {
      if (stopped) {
        return;
      }
      // A correction's whole walk is owed from its first sample to the moment
      // the trainer is on the road's own grade again — which is usually AFTER
      // the correction: the rider is moved before the road under them turns.
      if (bounded) owed = true;
      if (owed && sent !== undefined) {
        // #782: toward the road at a bounded rate, on the driver's own clock.
        if (!(at - sent.at >= SIMULATION_SETPOINT_INTERVAL_SECONDS)) return;
        const raw = gradeAt(profile, distanceOnRoute(profile, metres(distance)));
        const road = Number.isFinite(raw)
          ? Math.max(-MAX_SIMULATED_GRADE_PERCENT, Math.min(MAX_SIMULATED_GRADE_PERCENT, raw))
          : 0;
        // ⚠️ The time since the last write is capped at one write interval
        // (#928's review): on a steady climb the driver writes nothing for
        // minutes (its deadband), and a correction's first step measured from
        // that old write would carry the whole change in one — 8 % at once
        // after 81 s on the 4 % hill `trainer-wiring.test.tsx` §"#782" rides.
        const elapsed = Math.min(at - sent.at, SIMULATION_SETPOINT_INTERVAL_SECONDS);
        const step = CORRECTION_GRADE_STEP_PERCENT_PER_SECOND * elapsed;
        const grade = Math.max(sent.grade - step, Math.min(sent.grade + step, road));
        if (!bounded && grade === road) owed = false;
        // The driver is told nothing it would believe it wrote, so when this
        // hands back it writes the road afresh rather than trusting a deadband.
        driver.restart();
        if (Math.abs(grade - sent.grade) < SIMULATION_GRADE_DEADBAND_PERCENT) return;
        sent = { grade, at };
        fault = undefined;
        offer(gradePercent(grade));
        changed();
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
      sent = { grade: setpoint.grade, at };
      offer(setpoint.grade);
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
      void control.letGo().then(
        (outcome) => {
          if (outcome.kind === 'incomplete') {
            fault = RELEASE_INCOMPLETE_ROAD;
            changed();
          }
        },
        (error: unknown) => {
          fault = faultText(error);
          changed();
        },
      );
      changed();
    },

    settled: () => writer.idle(),
  };
}

/**
 * What a rider is told when the machine refused or did not answer the release's
 * Stop.
 */
const RELEASE_INCOMPLETE_ROAD =
  'The trainer did not confirm it let go of the road. It may still be holding resistance — ease off before you get off.';

/** A forget is running (`ride/controller.ts` §`mustWaitForForget`), and lifts by itself. */
const HELD_FOR_A_FORGET =
  'The hills are not being sent yet: Bluetooth is still finishing forgetting a trainer. The next gradient will be sent again.';

/**
 * This trainer is being let go so it can be forgotten — #728. Promises nothing
 * about the next gradient: once the forget goes through the trainer is gone.
 *
 * ⚠️ Claims only what the app did — held THIS gradient back and ASKED for the
 * release — because the fault outlives the hold (#729's review). The hold is
 * thrown only while the Stop is on the wire, but the sentence stays on screen
 * until the next sample replaces it, and by then the Stop may have landed or
 * been refused. "The trainer is being let go" was false in the second case,
 * where the machine may still be holding resistance and
 * `ride/controller.ts` §`unpair` tells the rider so.
 */
const HELD_WHILE_LETTING_GO =
  'That gradient was held back: this app asked the trainer to let go so it can be forgotten.';

/**
 * The ride controller was disposed and will write nothing again — #728, #695.
 * Permanent, so it promises nothing either. ⚠️ Nothing in production disposes
 * the controller today (it lives as long as the page), so a rider is not
 * expected to read this; it is worded truthfully all the same, because the
 * fallback said the trainer refused a gradient it never received.
 *
 * ⚠️ **It says nothing about resistance, on purpose** (#729's review). The
 * hold is thrown from the moment `dispose()` is called, while its Stop is
 * still on the wire, and the Stop can be refused — so "this app has let the
 * trainer go" would tell a rider on a machine that may still be holding
 * resistance that it had been released, which is the one thing
 * {@link RELEASE_INCOMPLETE_ROAD} exists to warn about. What is true in every
 * one of those states is that this app has stopped driving the trainer.
 */
const HELD_AFTER_LETTING_GO =
  'The hills are no longer being sent: this app has stopped driving the trainer.';

/**
 * The trainer this ride was driving has been detached — forgotten, or its
 * pairing undone — and is not connected to this app any more (#732). Promises
 * nothing about the next gradient, and says nothing about resistance: whether
 * the machine let go is what `ride/controller.ts` §`unpair` tells the rider.
 */
const HELD_AFTER_DISCONNECT =
  'The hills are no longer being sent: this trainer is not connected to this app any more.';

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
  // `ride/controller.ts` §`mustWaitForForget` (#718's second review, #721):
  // the app, not the machine, held the gradient back, so this does not say the
  // trainer refused anything. By class and first, never by the reason's words
  // (#724): until then this matched the substring "still being forgotten", so
  // rewording the controller's reason would have told the rider "The trainer
  // refused that gradient" with nothing going red.
  //
  // #728: the controller's other two holds are the app too, and each is worded
  // for what it is. Only a forget that is running lifts by itself, so only it
  // promises the next gradient: a trainer being let go to be forgotten is
  // usually gone once it has been, and a disposed controller writes nothing
  // again.
  if (error instanceof TargetHeldBack) {
    switch (error.hold) {
      case 'forget-running':
        return HELD_FOR_A_FORGET;
      case 'letting-go-to-forget':
        return HELD_WHILE_LETTING_GO;
      case 'let-go':
        return HELD_AFTER_LETTING_GO;
      case 'disconnected':
        return HELD_AFTER_DISCONNECT;
    }
  }
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
