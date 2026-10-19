// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The workout control loop — where #14's player meets a real trainer.
 *
 * `packages/domain`'s player decides and writes nothing;
 * `packages/sensors/protocol`'s `ErgWriter` writes and decides nothing. This
 * file is the third piece, and it is deliberately in `apps/web`: the player
 * lives in a package that may not name a GATT characteristic, the writer lives
 * in one that may not name a workout, and neither may import the other's
 * concern. Joining them is a product decision and this is where product
 * decisions go.
 *
 * ## What a tick does
 *
 * One call, one intent, at most one write offered. The loop does **not** await
 * the write inside the tick: a `setTargetPower` that takes four seconds must
 * not hold up the next second of the ride, and the player already refuses to
 * ask again while one is outstanding. The acknowledgement comes back
 * asynchronously and calls {@link WorkoutPlayer.acknowledge}, which is what
 * releases the next ask.
 *
 * ⚠️ **That is the whole of "sent and acknowledged before the interval is
 * treated as begun"** (#14's second criterion). It is a property of two objects
 * agreeing, not of one of them, which is why it is asserted here against a
 * simulated trainer rather than in either package alone.
 *
 * ## Easing the trainer, and letting it go — two different commands (#372, #441)
 *
 * ⚠️ **This section has been rewritten twice, and a reviewer who remembers
 * either earlier version is reading an old file** — first `stop()` was "the op
 * code that means what a rider means by *let me ride*", then PR #442 made the
 * end of a workout an FTMS Reset. On the trainer #372 was measured on, an
 * acknowledged `0x08` Stop left a 200 W ERG target applied — as cadence fell
 * from 55 to 46 rpm the power ROSE from 99 W to 175 W — and an acknowledged
 * `0x01` Reset did exactly the same. What that trainer DID obey, to within
 * ±2 W, is a new `0x05` target. So:
 *
 * - **Easing the trainer inside the workout** — a free-ride block, a stalled
 *   rider, the ride paused — writes the machine's **lowest target**:
 *   {@link WorkoutSessionOptions.powerFloor}, the minimum of the Supported
 *   Power Range the trainer itself reported, through the same ERG writer as
 *   every target. Never a hard-coded floor, and never a Stop (#441). ⚠️ The
 *   three are one decision for one reason: in each of them the player has
 *   stopped judging the rider's cadence — a free ride has no target to relieve,
 *   a stalled rider is past relief, a paused player does not tick — so a target
 *   left on the machine there is an ERG loop with **no spiral protection at
 *   all**. The owner's acceptance of a Stop that does not release (#372) is
 *   about the moment after a ride; these are during one.
 * - **The end of the workout** — it finished, or the rider ended it, or the
 *   ride stopped — is {@link TrainerControl.letGo}, the ride controller's one
 *   release, which sends a Stop and keeps control. The owner accepted that the
 *   machine may keep its last target after a workout (#372, 2026-09-21).
 *
 * ⚠️ **The floor is still a target**, and that is the trade #441 names: FTMS
 * treats 0 W as a target too, and a trainer holding its floor still has the
 * flywheel loaded at that floor. It is the least an ERG machine can be asked to
 * hold — which on the measured trainer is a great deal less than what a Stop
 * left behind. A spiralling rider who is still pedalling is eased to
 * `RELIEF_SHARE` of the target instead (`packages/domain/src/workout/erg-safety.ts`),
 * raised to the floor if that would fall under it — an ease the machine would
 * refuse as out of range would rescue nobody.
 *
 * ⚠️ **No test here can prove a real trainer eases.** Every assertion is about
 * what is SENT. Validation 0002 Part S is the pedal-through that says whether
 * power falls.
 *
 * ⚠️ **The release is reached through {@link WorkoutSessionOptions.control},
 * not through the writer; the ease goes through the writer.** `ErgWriter`'s
 * sink is deliberately narrowed to `setTargetPower` so it cannot send a Reset
 * by mistake (FTMS §4.16.2.1), and `erg-writer.test.ts` pins that with a
 * `@ts-expect-error`. #441's ease needs nothing more than that one method —
 * which is why it did not widen the sink.
 */

import {
  createWorkoutPlayer,
  seconds,
  watts,
  type CadenceReading,
  type HeartRateHoldContext,
  type HeartRateSample,
  type PlayerPlan,
  type PlayerState,
  type Seconds,
  type Watts,
  type WorkoutPlayer,
  type WorkoutRescue,
  type WorkoutTimeline,
} from '@onyourleft/domain';
import { createErgWriter, type ErgWriter, type TrainerControl } from '@onyourleft/sensors/protocol';
import { TargetHeldBack } from '../ride/held-back';
import { reliefAtFloorReason } from './rescue-text';

/** How long a cadence history is kept for the ERG rule. */
export const CADENCE_HISTORY_SECONDS = 30;

/**
 * How long a heart-rate history is kept for the hold (#1240). The hold reads
 * at most the last 15 s (H7's fallback), so 30 s is that with room to spare.
 */
export const HEART_RATE_HISTORY_SECONDS = 30;

/**
 * The most a workout's own target is raised to reach the trainer's reported
 * minimum, in watts, when writing that minimum could RAISE what the trainer
 * holds (#1305). Past it the session writes nothing for that target and tells
 * the rider. A minimum at or below a target the trainer may already be
 * holding is written whatever the gap: it can only ease.
 *
 * ⚠️ **A pick, not a measurement** (owner ruling, 2026-10-12). The minimum is
 * what the machine reported at pairing, which is untrusted input (CLAUDE.md
 * §6): a machine that reports a 300 W minimum would otherwise have every
 * block under it written at 300 W. Nothing was measured to arrive at 50.
 */
export const LARGEST_RAISE_WATTS = 50;

/**
 * What the session needs from a trainer.
 *
 * `setTargetPower`, `stop` and `letGo` and nothing else that COMMANDS — in
 * particular **not** the bare `reset`, and not `requestControl`, which the
 * ride screen has already done by the time a workout starts. Narrowed for the
 * same reason `ErgSink` is: a method that is not on the type cannot be called
 * by a later edit. `letGo` is here since #372 and is called from exactly one
 * place, {@link createWorkoutSession}'s `finish`, which runs once per session.
 *
 * `targetPower` is a read and sends nothing (#1305): what the control client
 * believes the trainer's ERG target to be, which is how the session knows of
 * a target set BEFORE it existed (a hand-set one on the Ride screen).
 * ⚠️ Required, not optional: left out, every raise would be judged as if the
 * trainer held nothing.
 */
export type WorkoutTrainer = Pick<
  TrainerControl,
  'setTargetPower' | 'stop' | 'letGo' | 'targetPower'
>;

export interface WorkoutSessionOptions {
  readonly timeline: WorkoutTimeline;
  readonly thresholdPower: Watts;
  readonly control: WorkoutTrainer;
  /**
   * The lowest ERG target this trainer accepts — the minimum of the Supported
   * Power Range **the machine itself reported** (#441). What an ease writes,
   * and what a workout target under it is raised to (#1297), unless that
   * could raise what the trainer holds and is a raise of more than
   * {@link LARGEST_RAISE_WATTS} (#1305).
   *
   * ⚠️ Required, with no default: a default would be the hard-coded floor
   * #43's criteria forbid, and a floor below the machine's minimum would be
   * refused as out of range — an ease that rescues nobody.
   */
  readonly powerFloor: Watts;
  /**
   * The top of the machine's own Supported Power Range, which H3 puts over a
   * heart-rate hold's ceiling (#1240). Absent, the hold is bounded by its own
   * shares and the ERG writer by the range as always.
   */
  readonly powerCeiling?: Watts | undefined;
  /**
   * What a heart-rate hold needs to know about the rider (#1240). Absent — the
   * rider has not set their own threshold heart rate, or a threshold is
   * assumed — every hold block rides steady at its start share (H1).
   */
  readonly heartRateHold?: HeartRateHoldContext | undefined;
  /**
   * Whether a heart-rate strap is paired, asked on every tick. `false` (or
   * absent) hands the player NO history at all, which is "no strap"; a strap
   * that is paired and quiet hands it an empty or stale one, which is
   * silence — never a zero (ADR 0048 H7).
   */
  readonly heartRateStrap?: (() => boolean) | undefined;
  /** Told what happened, so a screen can re-render. */
  readonly onChange?: ((state: WorkoutSessionState) => void) | undefined;
}

export interface WorkoutSessionState {
  readonly player: PlayerState;
  /** What the trainer last confirmed it holds, after quantisation. */
  readonly holding: Watts | undefined;
  /** True between an offered target and its answer. */
  readonly writing: boolean;
  /**
   * What the workout asked for, when the target the trainer holds is that ask
   * raised to the trainer's minimum (#1297). `undefined` whenever the
   * workout's own number was offered, after an ease, a lost link and the end
   * of the workout, and **until the raised target has landed**: while
   * {@link holding} is still some other number this says nothing, so a
   * screen cannot put "this block asks for 75 W" beside "Holding 250 W".
   *
   * So a screen can say why the trainer holds more than the block asks
   * (#1305).
   */
  readonly raisedFrom: Watts | undefined;
  /**
   * Whether the block's own target is NOT being sent, because sending it
   * would be a large raise (#1305) — the fact behind the sentence
   * {@link lastFault} carries then, for a screen that draws rather than says
   * (#1307's graph: no target the trainer was not sent is drawn as confirmed).
   */
  readonly raiseRefused: boolean;
  /**
   * The stall rescue in force, as the rider is told it — #585, and #1305's
   * second pass. The player's own (`player.rescue`), except for a relief that
   * cannot lower anything: the block was itself at or under the trainer's
   * minimum, the relief asks for less, and the trainer has acknowledged the
   * minimum. Then the rescue's "it has been eased" would be untrue (the
   * trainer holds the same number it held before), and the reason is
   * {@link reliefAtFloorReason} instead. Screens read this, not the player's.
   */
  readonly rescue: WorkoutRescue | undefined;
  /**
   * How many cadence readings are being kept for the ERG rule.
   *
   * A diagnostic, and the one number that says whether the spiral rule has
   * anything to judge on at all: a trainer with no cadence leaves this at zero
   * for the whole ride, and #14's rule is correctly silent rather than broken.
   * It is also the only place {@link CADENCE_HISTORY_SECONDS} is observable —
   * the retention window cannot change any verdict, because `assessErgCadence`
   * filters its own eight-second window regardless, so without this the bound
   * would be a guard nothing could see.
   */
  readonly cadenceRetained: number;
  /**
   * The last write this session could not complete.
   *
   * Kept rather than thrown: a workout does not end because one setpoint was
   * refused, and the next tick asks again. A screen shows it so a rider is not
   * left wondering why the resistance did not change.
   *
   * ⚠️ Also where a raise the session REFUSED to make is told (#1305): while
   * the block's target is not being sent this is that sentence, in place of
   * an older fault.
   */
  readonly lastFault: string | undefined;
}

export interface WorkoutSession {
  state(): WorkoutSessionState;
  start(now: Seconds): void;
  /** Advance the clock and act. Never rejects. */
  tick(now: Seconds): void;
  /** One cadence reading, for the ERG spiral rule. */
  observeCadence(reading: CadenceReading): void;
  /**
   * One heart-rate reading, for the hold (#1240). A dropped reading is NOT
   * passed — there is no reading to pass — so a strap that goes quiet leaves
   * a history that goes stale, which the hold reads as silence.
   */
  observeHeartRate(reading: HeartRateSample): void;
  pause(now: Seconds): void;
  resume(now: Seconds): void;
  /** The trainer link dropped. Pauses; loses nothing. */
  linkLost(now: Seconds): void;
  /** End the workout and release the trainer — see the module note. */
  stop(): void;
  /**
   * End the workout **without** releasing the trainer, because another workout
   * is taking it over on this same control.
   *
   * ⚠️ Not `stop()`. A release is the ride controller's, joined with any other
   * and marking the trainer as let go — which is not true of a trainer the next
   * workout is about to drive. The outgoing session sends a bare Stop and its
   * writer is closed, so a target of its own still in flight cannot land on
   * top of the replacement.
   */
  supersede(): void;
  /**
   * Hand the player a revised plan to read from the end of the block being
   * ridden (#1244, ADR 0048 D-2). It writes nothing: the player asks for the
   * revised block's target at the boundary, through the same writer as every
   * other target. `false` when the player will not take it
   * (`player.ts` §`revise`), and then nothing has changed.
   */
  revise(timeline: WorkoutTimeline): boolean;
  /** Drop a revision still waiting for its boundary: the rider's *Keep the plan*. */
  keepPlan(): boolean;
  /** The plan being ridden and the revision waiting, if any. Sends nothing. */
  plan(): PlayerPlan;
  /** Resolves once no write is outstanding. For tests and for a clean teardown. */
  settled(): Promise<void>;
}

export function createWorkoutSession(options: WorkoutSessionOptions): WorkoutSession {
  const { thresholdPower, control, powerFloor, onChange } = options;

  const player: WorkoutPlayer = createWorkoutPlayer({
    timeline: options.timeline,
    thresholdPower,
    heartRateHold: options.heartRateHold,
    trainerRange:
      options.powerCeiling === undefined
        ? undefined
        : { minimum: powerFloor, maximum: options.powerCeiling },
  });
  const writer: ErgWriter = createErgWriter(control);

  let cadence: CadenceReading[] = [];
  let heartRate: HeartRateSample[] = [];
  let lastFault: string | undefined;
  /**
   * Whether the trainer has been eased to its floor since this session last
   * set a target.
   *
   * ⚠️ **Starts `false`, meaning "assume it is holding something".** The
   * session does not know what the ride screen did before it — #49's own ERG
   * control may have left a target on the machine — so a workout that opens
   * with a free-ride block must release rather than assume there is nothing to
   * release. Getting this the optimistic way round leaves a rider pedalling
   * against somebody else's setpoint for the length of the block, and trainer
   * control is a safety question before it is a feature (CLAUDE.md §6).
   */
  let released = false;
  /** Whether {@link finish} has run. A release is sent once per session, ever. */
  let finished = false;

  /**
   * Whether the target the workout asks for now was NOT written, because
   * the floor is more than {@link LARGEST_RAISE_WATTS} above it and writing
   * the floor could raise what the trainer holds (#1305). Decided again on
   * every tick that asks, and dropped by anything else the session does to
   * the trainer.
   */
  let raiseRefused = false;
  /** @see WorkoutSessionState.raisedFrom */
  let raisedFrom: Watts | undefined;
  /**
   * Whether the block's own target, before any stall relief, is at or under
   * the floor (#1305's second pass). A relief asks for less than the block,
   * so on such a block it is raised to the same floor and lowers nothing.
   * Decided on every write the player asks for, and read only while a relief
   * is in force, which always begins with such a write.
   * @see WorkoutSessionState.rescue
   */
  let blockAtFloor = false;

  /** @see WorkoutSessionState.rescue */
  const rescueAsTold = (rescue: WorkoutRescue | undefined): WorkoutRescue | undefined =>
    rescue?.kind === 'relief' && blockAtFloor && writer.lastWritten() === powerFloor
      ? { ...rescue, reason: reliefAtFloorReason(powerFloor) }
      : rescue;

  const snapshot = (): WorkoutSessionState => ({
    player: player.state(),
    rescue: rescueAsTold(player.state().rescue),
    holding: writer.lastWritten(),
    writing: writer.busy(),
    // #1305's review: only once the raise is what the trainer acknowledged.
    raisedFrom: writer.lastWritten() === powerFloor ? raisedFrom : undefined,
    raiseRefused,
    cadenceRetained: cadence.length,
    lastFault: raiseRefused ? raiseRefusedText(powerFloor) : lastFault,
  });

  /**
   * The ERG target the trainer may be holding, as far as this app can say,
   * or `undefined` when it knows of none (#1305). From the control client:
   *
   * - `confirmed`: the last target the trainer acknowledged, with nothing
   *   since to put it in doubt. That includes one set by hand on the Ride
   *   screen before this session existed: it went through the same client.
   * - `unknown`: a target the client had acknowledged and can no longer vouch
   *   for (a lost link, a Stop, a gradient), or one it attempted and got no
   *   answer to.
   * - `none`: the client has set no ERG target, or the machine took control
   *   away and the client forgot. Then the last write the trainer
   *   acknowledged to THIS session stands in, if there was one. ⚠️ A target
   *   from before this session is not this function's to know: the ride
   *   controller remembers it and hands it over as `unknown`
   *   (`ride/controller.ts` §`workoutsViewOfTheTarget`).
   *
   * ⚠️ **Only `confirmed` is known to be on the machine. The rest are
   * counted on purpose.** The trainer may still hold them, and this file
   * assumes throughout that a machine keeps a target until it is written
   * another (`released` starts `false` for the same reason). If it does,
   * writing the floor lowers what the rider is pedalling against and not
   * writing leaves it there. If it does not, the floor is still no more than
   * this app last asked of the same machine.
   */
  const mayBeHolding = (): Watts | undefined => {
    const target = control.targetPower();
    switch (target.kind) {
      case 'confirmed':
        return target.target;
      case 'unknown':
        return target.attempted;
      case 'none':
        return writer.lastWritten();
    }
  };

  const changed = (): void => {
    onChange?.(snapshot());
  };

  /**
   * Ease the trainer to its lowest target for now — the workout will write
   * again (#441). @see the module note for why this is a `0x05` and not a Stop.
   *
   * Guarded by `released` so a free-ride block does not write the floor once a
   * second for its whole length — each of those writes would occupy the
   * control point a real setpoint might need. A write the machine refused, or
   * that a newer target superseded, clears the guard so the next tick tries
   * again: an ease that did not land is not an ease.
   *
   * ⚠️ Through the writer, never `control` directly: the writer serialises
   * with the targets, so an ease cannot overtake a target still in flight and
   * be overwritten by it on the machine.
   */
  const ease = (): void => {
    // ⚠️ Before the guard: an ease that is skipped because the trainer was
    // already eased still ends the block a refusal was about, and the
    // sentence (and "raised from") must not outlive it (#1305).
    raiseRefused = false;
    raisedFrom = undefined;
    if (released) {
      return;
    }
    released = true;
    lastOffered = undefined;
    void writer.offer(powerFloor).then((outcome) => {
      if (outcome.kind === 'written') {
        return;
      }
      released = false;
      if (outcome.kind === 'failed') {
        lastFault = faultText(outcome.error);
        changed();
      }
    });
  };

  /**
   * Let the trainer go at the end of the workout, through `control.letGo()`.
   *
   * ⚠️ **Deliberately NOT guarded by `released`.** A workout whose last block
   * was a free ride has already been eased, and skipping the release because
   * "the trainer is already stopped" left the end of that workout unreleased —
   * no `letGo`, so no *Not released* notice if the machine refused it either.
   * #442 found it; it is kept through the re-scope.
   */
  const finish = (): void => {
    if (finished) {
      return;
    }
    finished = true;
    released = true;
    raiseRefused = false;
    // The workout is over: no block is asking for anything (#1305's review).
    raisedFrom = undefined;
    void control.letGo().then(
      (outcome) => {
        if (outcome.kind === 'incomplete') {
          lastFault = RELEASE_INCOMPLETE;
          changed();
        }
      },
      (error: unknown) => {
        lastFault = faultText(error);
        changed();
      },
    );
  };

  /**
   * How many targets the player has asked for — so an outcome can tell whether
   * it answers the player's CURRENT ask or an older one.
   *
   * ⚠️ PR #574's review. A pause, a stall or a free ride forgets the write on
   * the wire, and the next ask can be queued behind it. When the older write
   * then fails, or is superseded, its outcome is about a target the player has
   * stopped waiting for; handing it to `writeFailed` forgot the NEWER ask while
   * that one still had its own answer coming, and the next tick wrote the same
   * target again. An older outcome still reports its fault, because the rider
   * should hear that the machine refused something; it does not move the
   * player. ⚠️ Since #579 that includes an older write that SUCCEEDED: it is
   * not handed to `acknowledge` either.
   */
  let asks = 0;

  /**
   * The last target this session offered the writer, after the raise to the
   * floor — #1297 review. The player's unchanged-target check (#542) compares
   * what it ASKED for, before the clamp, so a ramp under the machine's minimum
   * asks for a new wattage every tick and every one of them clamps to the same
   * number: without this, the same `0x05` once a second. Forgotten whenever the
   * wire is forgotten (an ease, a refused or superseded write, a lost link),
   * so a target that did not land is written again.
   *
   * ⚠️ `landed` is what the trainer answered it with, once it has (#1305).
   * The player marks every ask pending and asks for nothing more until it is
   * answered, so an ask this swallows must still be answered: left alone, a
   * ramp that started under the minimum waited for ever at the minimum, long
   * after the ramp had climbed past it.
   */
  let lastOffered: { readonly target: Watts; landed: Watts | undefined } | undefined;
  // Invariant: `released === true` implies `lastOffered === undefined`, which is
  // why `resume()` need not forget it (`ease()` clears it when it releases).

  const offer = (target: Watts): void => {
    released = false;
    if (lastOffered?.target === target) {
      // Still on the wire: its own answer acknowledges the player's ask, which
      // is the current one (`asks` has not moved). Already landed: nothing
      // else will, so the ask is answered here with what the trainer said.
      if (lastOffered.landed !== undefined) {
        player.acknowledge(lastOffered.landed);
      }
      return;
    }
    const offered: { readonly target: Watts; landed: Watts | undefined } = {
      target,
      landed: undefined,
    };
    lastOffered = offered;
    asks += 1;
    const ask = asks;
    void writer.offer(target).then((outcome) => {
      const current = ask === asks;
      switch (outcome.kind) {
        case 'written':
          lastFault = undefined;
          offered.landed = outcome.quantised;
          // ⚠️ #579. An older write answered late is not an answer to the
          // player's current ask: acknowledging it cleared the newer target
          // while that one was still on the wire, and reported the older
          // wattage as held. What the trainer confirmed is still recorded —
          // `holding` is the writer's, and is true of the wire.
          if (current) {
            player.acknowledge(outcome.quantised);
          }
          break;
        case 'failed':
          lastFault = faultText(outcome.error);
          if (current) {
            lastOffered = undefined;
            player.writeFailed();
          }
          break;
        case 'superseded':
        case 'closed':
          // Neither is an answer to the player's ask, and neither is a fault.
          // A superseded target was replaced by a newer one, whose own outcome
          // clears the pending state; a closed one means the session is over.
          if (current) {
            lastOffered = undefined;
            player.writeFailed();
          }
          break;
      }
      changed();
    });
  };

  return {
    state: snapshot,

    start(now: Seconds): void {
      player.start(now);
      lastOffered = undefined;
      changed();
    },

    tick(now: Seconds): void {
      // ⚠️ Prune before the assessment, not after. The ERG rule filters its own
      // window, so a history that only ever grows would be correct and would
      // also grow without bound for the length of a workout — an hour at 1 Hz
      // is 3 600 readings scanned every tick to look at eight of them.
      const floor = now - CADENCE_HISTORY_SECONDS;
      cadence = cadence.filter((reading) => reading.at >= floor);
      heartRate = heartRate.filter((reading) => reading.at >= now - HEART_RATE_HISTORY_SECONDS);

      const state = player.tick(now, {
        cadence,
        // #1240: no strap is NO history; a quiet strap is a stale one.
        heartRate: options.heartRateStrap?.() === true ? heartRate : undefined,
      });

      // ⚠️ Act on the intent only when the player is actually playing. A
      // paused or idle player returns its LAST intent unchanged — that is what
      // lets a screen keep showing "Paused." — so a tick arriving after
      // `linkLost` would otherwise re-issue that release and write to a trainer
      // that is not there. Found by the disconnect test, which counts octets.
      if (state.status !== 'running' && state.status !== 'finished') {
        changed();
        return;
      }

      switch (state.intent.kind) {
        case 'write-target': {
          // ⚠️ #1297: a target under the floor is raised to the floor, the
          // workout's own as well as an eased one. The machine refuses a
          // target under its reported minimum outright (it does not clamp),
          // and a refusal leaves the target it had: a 0.3 block after a hard
          // one kept the hard one on the trainer, and a refused ease rescues
          // nobody. The floor is the least this machine can be asked to hold,
          // so it is the nearest thing to the number asked for. The player is
          // told what was written (`acknowledge`), and the screen reads
          // `holding`.
          const asked = state.intent.watts;
          const raised = asked < powerFloor;
          // ⚠️ #1305, the owner's rulings of 2026-10-12 (refuse a large
          // raise; then "yes" to this narrower rule, both on the issue): the
          // workout's OWN target is not raised by more than
          // `LARGEST_RAISE_WATTS` when the raise could raise what the trainer
          // holds. Nothing is written for it, so the trainer keeps whatever
          // it has, and the rider is told (`lastFault`). The player is told
          // its ask did not land, so it asks again next tick and a ramp that
          // climbs to within reach is written then.
          //
          // A floor at or below a target the trainer may already hold is
          // written whatever the gap: it only eases. Refusing it left a hard
          // block's 250 W on the machine through a 75 W recovery.
          //
          // An EASED target (the stall relief) is not covered by the ruling
          // and is raised as before: it exists to lower what the trainer
          // holds, and withholding it would rescue nobody.
          const held = mayBeHolding();
          const onlyEases = held !== undefined && powerFloor <= held;
          if (!state.intent.eased && !onlyEases && powerFloor - asked > LARGEST_RAISE_WATTS) {
            raiseRefused = true;
            player.writeFailed();
            break;
          }
          raiseRefused = false;
          raisedFrom = raised && !state.intent.eased ? asked : undefined;
          // #1305's second pass. `share` is the block's own ask, before
          // any relief (`player.ts` §`write-target`).
          blockAtFloor = Math.round(thresholdPower * state.intent.share) <= powerFloor;
          offer(raised ? powerFloor : asked);
          break;
        }
        case 'release':
          ease();
          break;
        case 'finished':
          finish();
          break;
        case 'hold':
          break;
      }
      changed();
    },

    observeCadence(reading: CadenceReading): void {
      cadence.push(reading);
    },

    observeHeartRate(reading: HeartRateSample): void {
      heartRate.push(reading);
    },

    pause(now: Seconds): void {
      player.pause(now);
      ease();
      changed();
    },

    resume(now: Seconds): void {
      player.resume(now);
      changed();
    },

    linkLost(now: Seconds): void {
      player.linkLost(now);
      lastOffered = undefined;
      raiseRefused = false;
      // What the machine holds is no longer known to be this block's raise.
      raisedFrom = undefined;
      // ⚠️ No `stop()`, no release, and — the one that was wrong first — **no
      // `writer.close()`**. The link is down, so a write would only queue
      // against a machine that is not there; but closing the writer is
      // permanent, and this is the one path that is expected to be reversed. A
      // session whose trainer dropped and came back would have had a writer
      // that refused every later target, which is losing the session in the
      // one place #14 asks for it to be preserved. `released` is deliberately
      // left as it was, so a reconnection that finds the trainer still holding
      // the old target writes over it on the first tick.
      changed();
    },

    stop(): void {
      player.stop();
      writer.close();
      finish();
      changed();
    },

    supersede(): void {
      player.stop();
      writer.close();
      // A bare Stop, as ever. Not `ease`: the writer is closed, and the
      // replacement's first target follows at once.
      void control.stop().catch(() => undefined);
      changed();
    },

    // #1244. Neither tells `onChange`: the re-plan session that calls them
    // tells its own listener once it has taken the answer in.
    revise: (next) => player.revise(next),
    keepPlan: () => player.keepPlan(),
    plan: () => player.plan(),

    settled: () => writer.idle(),
  };
}

/**
 * What a rider is told when the end of a workout could not be confirmed — the
 * trainer refused or did not answer the release's Stop.
 */
export const RELEASE_INCOMPLETE =
  'The trainer did not confirm it let go. It may still be holding resistance — ease off and check before you get off.';

/**
 * What a rider is told while a block's target is not being sent, because it
 * is more than {@link LARGEST_RAISE_WATTS} under the trainer's minimum and
 * the minimum is not known to be at or below what the trainer holds (#1305).
 *
 * ⚠️ Says nothing about what the trainer holds. On the ride screen it is
 * shown only when neither the control client nor the ride controller knows
 * of a target this app had acknowledged by this trainer since the page
 * loaded, or in the last 30 minutes across a reload (#1305's second pass,
 * `ride/trainer-target-memory.ts`): any such target is at or above the floor
 * (the client sends nothing under the machine's minimum), and then the floor
 * is written, not refused. ⚠️ That is not "the trainer holds nothing". An
 * older target, one from another app or from the machine's own buttons is
 * not known here, and the trainer keeps it.
 */
export function raiseRefusedText(minimum: Watts): string {
  return `This trainer's lowest target is ${String(minimum)} W, more than ${String(LARGEST_RAISE_WATTS)} W above what this block asks for, so no target was sent for it.`;
}

/** A target held back while the trainer is let go so it can be forgotten (#729). */
const HELD_WHILE_LETTING_GO =
  'That target was held back: this app asked the trainer to let go so it can be forgotten.';

/** A target held back once the ride controller was disposed (#729). Says nothing about resistance. */
const HELD_AFTER_LETTING_GO =
  'No more targets are being sent: this app has stopped driving the trainer.';

/** A target held back once the trainer was detached (#732). Says nothing about resistance. */
const HELD_AFTER_DISCONNECT =
  'No more targets are being sent: this trainer is not connected to this app any more.';

/**
 * What a rider is told about a refused write.
 *
 * Deliberately not the raw error: a `SensorError` message names a GATT
 * characteristic, which means nothing on a screen. The two the rider can act on
 * are told apart; everything else is one sentence that does not pretend to know
 * more than it does.
 */
function faultText(error: unknown): string {
  // #721: the ride controller, not the machine, held the target back while a
  // trainer is being forgotten (`ride/controller.ts` §`mustWaitForForget`),
  // so this does not say the trainer refused anything. Its own sentence says
  // why and what ends it. By class, not by wording — #722's review — and
  // FIRST since #724: checked after the substrings below, a reworded reason
  // that happened to say "timed out" would have been told as a machine that
  // did not answer.
  //
  // #729's review: only `'forget-running'` reaches this today — the workout's
  // targets go through `ride/controller.ts` §`gatedTargets`, which throws no
  // other kind. The other three are the game handle's, and their messages are
  // log sentences ("the ride controller was disposed…"), so a
  // session that ever received one says its own words rather than the reason,
  // and neither claims the release completed: both are thrown while its Stop
  // may still be in flight, and it may be refused.
  if (error instanceof TargetHeldBack) {
    switch (error.hold) {
      case 'forget-running':
        return error.message;
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
    return 'The trainer stopped accepting targets. Take control again to carry on.';
  }
  if (message.includes('timed out') || message.includes('timeout')) {
    return 'The trainer did not answer. The next target will be sent again.';
  }
  return 'The trainer refused that target. The next one will be sent again.';
}

/** Re-exported so a caller needs one import for the whole loop. */
export { seconds, watts };
