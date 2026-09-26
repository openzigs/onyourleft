// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A hand-set ERG target, with the stall rescue a workout has — #567.
 *
 * ## What was missing
 *
 * #441 put a stall rescue on the workout: `assessErgCadence` watches cadence,
 * and a rider losing the fight is eased to two thirds of the target, or to the
 * machine's own floor once they have stopped. It lived in the workout player,
 * so a target typed into the Ride screen's ERG form had none. Validation 0002
 * Part S, 2026-09-25, on the owner's KICKR CORE: a manual 150 W target, cadence
 * from 68 to 37 rpm over eight seconds while the trainer held about 135 W, and
 * **the app sent nothing**. The release came from the trainer's own firmware
 * after about 9 s below 40 rpm. A trainer without that firmware would have kept
 * loading a stalled rider.
 *
 * ## One rule, not a second copy
 *
 * The rescue here is `packages/domain`'s `createErgRescue` — the SAME latch the
 * workout player holds since #567 — so "the same stall detection as a workout"
 * is one object used twice rather than one decision written twice. The ease
 * is the same too: a `0x05` Set Target Power, **never a Stop** (#441, #372) —
 * relief is {@link RELIEF_SHARE} of the rider's target, raised to the floor if
 * it would fall under it; a stopped rider gets the floor.
 *
 * ## After the rider recovers, the target goes back on — decided (#567)
 *
 * #567 asked for one of two answers: restore the rider's target, or leave it
 * eased and say so. **It is restored**, by the latch's own rule — only once the
 * verdict has been `holding` for a whole {@link TREND_WINDOW}, and stepped: a
 * stalled rider who starts pedalling again is on the relief target first. That
 * is what a workout does, and a second answer for the same trainer, the same
 * rider and the same spiral would be the two ERG paths disagreeing about what
 * is safe. The Ride screen says so while it is eased — the rider's own number,
 * why it is not on the machine, and that it comes back by itself
 * (`TrainerPanel.tsx` §`rescueSentence`) — and *End ERG* is on the same form for
 * a rider who would rather it did not.
 *
 * ⚠️ A silent cadence sensor is not recovery: `createErgRescue` restarts its
 * steady clock on a window with nothing in it, so a rider whose sensor went
 * quiet after a stall is never handed the full target back on no evidence.
 *
 * ## Every write through one ERG writer
 *
 * The rider's target and every ease go through ONE `ErgWriter`, so an ease
 * cannot overtake a target still in flight and be overwritten by it on the
 * machine, and every write is acknowledged (`setTargetPower` is the
 * with-response write; the writer's sink cannot name anything else).
 *
 * ⚠️ **No test here can prove a real trainer eases.** Every assertion is about
 * what is SENT. Validation 0002 Part S's manual-ERG row is the pedal-through.
 */

import {
  createErgRescue,
  watts,
  type CadenceReading,
  type ErgRescueStep,
  type Seconds,
  type Watts,
} from '@onyourleft/domain';
import {
  createErgWriter,
  type ErgSink,
  type ErgWriteOutcome,
  type ErgWriter,
} from '@onyourleft/sensors/protocol';

/** How long a cadence history is kept — the workout session's own figure. */
const CADENCE_HISTORY_SECONDS = 30;

/** What the Ride screen may say about a rescue in progress. */
export interface ManualErgRescue {
  /** The target the rider set, which is NOT what the machine is holding. */
  readonly target: Watts;
  /** `relief` is a share of {@link target}; `floor` is the machine's lowest. */
  readonly holding: 'relief' | 'floor';
  readonly reason: string;
}

export interface ManualErg {
  /**
   * The rider set a target. Forgets any rescue: this is the rider's own act,
   * and if they are still in trouble the next tick eases it again.
   *
   * Resolves with the writer's outcome for THIS target — never rejects.
   */
  set(target: Watts): Promise<ErgWriteOutcome>;
  observeCadence(reading: CadenceReading): void;
  /** Judge the rider at `now`, and write only if what should be held changed. */
  tick(now: Seconds): void;
  /** `undefined` while the rider's own target is what is being held. */
  rescue(): ManualErgRescue | undefined;
  /**
   * Stop writing, for good. ⚠️ Does not touch the trainer — the release is
   * the ride controller's one release, and a workout or the game may be about
   * to write on this same control point.
   */
  close(): void;
  /** Resolves once no write is outstanding. For tests. */
  settled(): Promise<void>;
}

export function createManualErg(options: {
  readonly control: ErgSink;
  /** The minimum of the Supported Power Range the machine itself reported. */
  readonly powerFloor: Watts;
  /** A rescue write the machine refused — the rider's own refusal is the caller's. */
  readonly onFault: (error: unknown) => void;
  readonly onChange: () => void;
}): ManualErg {
  const { control, powerFloor, onFault, onChange } = options;
  const writer: ErgWriter = createErgWriter(control);
  const latch = createErgRescue();

  let cadence: CadenceReading[] = [];
  /** The rider's target — the last one the machine accepted, or the one in flight. */
  let target: Watts | undefined;
  /** The last target the machine accepted from the rider. What a refusal reverts to. */
  let accepted: Watts | undefined;
  /** What was last asked of the machine, in the watts put on the wire. */
  let lastAsked: Watts | undefined;
  /** What the machine last acknowledged, in the same terms. */
  let onMachine: Watts | undefined;
  let step: ErgRescueStep = { kind: 'full' };
  let asks = 0;

  /**
   * Offer `value` through the writer.
   *
   * ⚠️ A refused write sets {@link lastAsked} back to what the machine last
   * acknowledged — so a refused ease is tried again on the next tick (an ease
   * that did not land is not an ease), and a refused rider's target is not
   * re-sent behind the rider's back. Only for the CURRENT ask: an older
   * outcome describes a target nobody is waiting for any more.
   */
  const ask = (value: Watts, fromRider: boolean): Promise<ErgWriteOutcome> => {
    lastAsked = value;
    asks += 1;
    const mine = asks;
    const outcome = writer.offer(value);
    void outcome.then((settled) => {
      if (settled.kind === 'written') {
        onMachine = settled.target;
        if (fromRider) {
          accepted = settled.target;
        }
      } else if (settled.kind === 'failed') {
        if (mine === asks) {
          lastAsked = onMachine;
          if (fromRider) {
            target = accepted;
          }
        }
        if (!fromRider) {
          onFault(settled.error);
        }
      }
      onChange();
    });
    return outcome;
  };

  const wanted = (rider: Watts): Watts => {
    switch (step.kind) {
      case 'full':
        return rider;
      case 'relief':
        // Raised to the floor: the machine refuses an out-of-range target
        // outright, and a refused ease rescues nobody (#441).
        return watts(Math.max(Math.round(rider * step.share), powerFloor));
      case 'floor':
        return powerFloor;
    }
  };

  return {
    set(value: Watts): Promise<ErgWriteOutcome> {
      target = value;
      latch.reset();
      step = { kind: 'full' };
      return ask(value, true);
    },

    observeCadence(reading: CadenceReading): void {
      cadence.push(reading);
    },

    tick(now: Seconds): void {
      const keepFrom = now - CADENCE_HISTORY_SECONDS;
      cadence = cadence.filter((reading) => reading.at >= keepFrom);
      if (target === undefined) {
        return;
      }
      const before = step.kind;
      step = latch.judge(cadence, now);
      const value = wanted(target);
      if (value !== lastAsked) {
        void ask(value, false);
      } else if (step.kind !== before) {
        onChange();
      }
    },

    rescue(): ManualErgRescue | undefined {
      if (target === undefined || step.kind === 'full') {
        return undefined;
      }
      return {
        target,
        holding: step.kind,
        reason: step.reason,
      };
    },

    close(): void {
      writer.close();
      target = undefined;
    },

    settled: () => writer.idle(),
  };
}
