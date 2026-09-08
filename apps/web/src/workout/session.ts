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
 * ## A release is not a target of zero
 *
 * When the player asks to release — a free ride, a stalled rider, a pause —
 * this calls `stop()` on the control rather than writing 0 W. FTMS treats a
 * target of zero as a target, and a trainer holding 0 W still has the flywheel
 * loaded against the rider at whatever its floor is. `stop()` is the op code
 * that means what a rider means by "let me ride".
 *
 * ⚠️ **`stop()` is reached through {@link WorkoutSessionOptions.control}, not
 * through the writer.** `ErgWriter`'s sink is deliberately narrowed to
 * `setTargetPower` so it cannot send a Reset by mistake (FTMS §4.16.2.1), and
 * that narrowing takes `stop` with it. Releasing is this file's job precisely
 * because it is the one command the writer must not be able to reach for.
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
 * `setTargetPower` and `stop` and nothing else — in particular **not**
 * `reset`, and not `requestControl`, which the ride screen has already done by
 * the time a workout starts. Narrowed for the same reason `ErgSink` is: a
 * method that is not on the type cannot be called by a later edit.
 */
export type WorkoutTrainer = Pick<TrainerControl, 'setTargetPower' | 'stop'>;

export interface WorkoutSessionOptions {
  readonly timeline: WorkoutTimeline;
  readonly thresholdPower: Watts;
  readonly control: WorkoutTrainer;
  /** Told what happened, so a screen can re-render. */
  readonly onChange?: ((state: WorkoutSessionState) => void) | undefined;
  readonly refreshSeconds?: number | undefined;
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
  /** End the workout and release the trainer. */
  stop(): void;
  /** Resolves once no write is outstanding. For tests and for a clean teardown. */
  settled(): Promise<void>;
}

export function createWorkoutSession(options: WorkoutSessionOptions): WorkoutSession {
  const { timeline, thresholdPower, control, onChange } = options;

  const player: WorkoutPlayer = createWorkoutPlayer({
    timeline,
    thresholdPower,
    ...(options.refreshSeconds === undefined ? {} : { refreshSeconds: options.refreshSeconds }),
  });
  const writer: ErgWriter = createErgWriter(control);

  let cadence: CadenceReading[] = [];
  let lastFault: string | undefined;
  /**
   * Whether the trainer has been told to stop since this session last set a
   * target.
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
   * Let the trainer go.
   *
   * Guarded by `released` so a free-ride block does not send `stop` once a
   * second for its whole length — the machine is already stopped, and each of
   * those writes would occupy the control point a real setpoint might need.
   */
  const release = (): void => {
    if (released) {
      return;
    }
    released = true;
    void control.stop().catch((error: unknown) => {
      lastFault = faultText(error);
      changed();
    });
  };

  const offer = (target: Watts): void => {
    released = false;
    void writer.offer(target).then((outcome) => {
      switch (outcome.kind) {
        case 'written':
          lastFault = undefined;
          player.acknowledge(outcome.quantised);
          break;
        case 'failed':
          lastFault = faultText(outcome.error);
          player.writeFailed();
          break;
        case 'superseded':
        case 'closed':
          // Neither is an answer to the player's ask, and neither is a fault.
          // A superseded target was replaced by a newer one, whose own outcome
          // clears the pending state; a closed one means the session is over.
          player.writeFailed();
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
          offer(state.intent.watts);
          break;
        case 'release':
          release();
          break;
        case 'finished':
          release();
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
      release();
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
      release();
      writer.close();
      changed();
    },

    settled: () => writer.idle(),
  };
}

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
