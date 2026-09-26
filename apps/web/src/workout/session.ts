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
  type PlayerState,
  type Seconds,
  type Watts,
  type WorkoutPlayer,
  type WorkoutTimeline,
} from '@onyourleft/domain';
import { createErgWriter, type ErgWriter, type TrainerControl } from '@onyourleft/sensors/protocol';

/** How long a cadence history is kept for the ERG rule. */
export const CADENCE_HISTORY_SECONDS = 30;

/**
 * What the session needs from a trainer.
 *
 * `setTargetPower`, `stop` and `letGo` and nothing else — in particular
 * **not** the bare `reset`, and not `requestControl`, which the ride screen has
 * already done by the time a workout starts. Narrowed for the same reason
 * `ErgSink` is: a method that is not on the type cannot be called by a later
 * edit. `letGo` is here since #372 and is called from exactly one place,
 * {@link createWorkoutSession}'s `finish`, which runs once per session.
 */
export type WorkoutTrainer = Pick<TrainerControl, 'setTargetPower' | 'stop' | 'letGo'>;

export interface WorkoutSessionOptions {
  readonly timeline: WorkoutTimeline;
  readonly thresholdPower: Watts;
  readonly control: WorkoutTrainer;
  /**
   * The lowest ERG target this trainer accepts — the minimum of the Supported
   * Power Range **the machine itself reported** (#441). What an ease writes.
   *
   * ⚠️ Required, with no default: a default would be the hard-coded floor
   * #43's criteria forbid, and a floor below the machine's minimum would be
   * refused as out of range — an ease that rescues nobody.
   */
  readonly powerFloor: Watts;
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
  /** Resolves once no write is outstanding. For tests and for a clean teardown. */
  settled(): Promise<void>;
}

export function createWorkoutSession(options: WorkoutSessionOptions): WorkoutSession {
  const { timeline, thresholdPower, control, powerFloor, onChange } = options;

  const player: WorkoutPlayer = createWorkoutPlayer({ timeline, thresholdPower });
  const writer: ErgWriter = createErgWriter(control);

  let cadence: CadenceReading[] = [];
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

  const snapshot = (): WorkoutSessionState => ({
    player: player.state(),
    holding: writer.lastWritten(),
    writing: writer.busy(),
    cadenceRetained: cadence.length,
    lastFault,
  });

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
    if (released) {
      return;
    }
    released = true;
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
   * player.
   */
  let asks = 0;

  const offer = (target: Watts): void => {
    released = false;
    asks += 1;
    const ask = asks;
    void writer.offer(target).then((outcome) => {
      const current = ask === asks;
      switch (outcome.kind) {
        case 'written':
          lastFault = undefined;
          player.acknowledge(outcome.quantised);
          break;
        case 'failed':
          lastFault = faultText(outcome.error);
          if (current) {
            player.writeFailed();
          }
          break;
        case 'superseded':
        case 'closed':
          // Neither is an answer to the player's ask, and neither is a fault.
          // A superseded target was replaced by a newer one, whose own outcome
          // clears the pending state; a closed one means the session is over.
          if (current) {
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
      changed();
    },

    tick(now: Seconds): void {
      // ⚠️ Prune before the assessment, not after. The ERG rule filters its own
      // window, so a history that only ever grows would be correct and would
      // also grow without bound for the length of a workout — an hour at 1 Hz
      // is 3 600 readings scanned every tick to look at eight of them.
      const floor = now - CADENCE_HISTORY_SECONDS;
      cadence = cadence.filter((reading) => reading.at >= floor);

      const state = player.tick(now, { cadence });

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
        case 'write-target':
          // An eased target is raised to the floor if the relief would take
          // it under — the machine refuses an out-of-range target outright,
          // and a refused ease rescues nobody. An un-eased one is the
          // workout's own number and is written as it is.
          offer(
            state.intent.eased
              ? watts(Math.max(state.intent.watts, powerFloor))
              : state.intent.watts,
          );
          break;
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
 * What a rider is told about a refused write.
 *
 * Deliberately not the raw error: a `SensorError` message names a GATT
 * characteristic, which means nothing on a screen. The two the rider can act on
 * are told apart; everything else is one sentence that does not pretend to know
 * more than it does.
 */
function faultText(error: unknown): string {
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
