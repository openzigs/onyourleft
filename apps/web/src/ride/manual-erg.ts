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
 * steady clock on a window with nothing in it and HOLDS the step it was on, so
 * a rider whose sensor went quiet after a stall stays at the floor rather than
 * being stepped up, or handed the full target back, on no evidence.
 *
 * ## One writer at a time: during a rescue, ONLY the rescue writes
 *
 * PR #582 went through three reviews, and every one found a new race between
 * the rider's writes and the rescue's writes sharing one single-slot ERG
 * writer: an ease derived from a target the machine later refused, an ease
 * superseding a rider target waiting behind another write, and an ease starved
 * by a rider pressing *Set* faster than the machine answered. Each patch fixed
 * one interleaving and left the next. So the ownership is now a rule rather
 * than a set of guards:
 *
 * 1. **Outside a rescue** (the latch says `full`) the rider's *Set* writes
 *    immediately, exactly as before #567.
 * 2. **During a rescue** (the latch says `relief` or `floor`) the rescue is the
 *    ONLY writer. A *Set* is recorded as the rider's PENDING target and is NOT
 *    written; the panel says it will be set once they are pedalling steadily
 *    again. A newer *Set* replaces the pending one. A rider target that was
 *    still WAITING in the writer's slot when the rescue began (not yet on the
 *    wire) is superseded by the ease and becomes the pending target.
 * 3. **An ease is only ever derived from the last target the machine
 *    ACCEPTED** from the rider — never from one in flight, waiting, pending or
 *    refused. A rider write already ON THE WIRE when the rescue begins cannot
 *    be recalled, so the ease is queued behind it: it reaches the wire the
 *    moment that write settles (accepted or refused), which is the earliest
 *    anything could, and it was computed without it. If it was accepted, the
 *    next tick re-derives the ease from it.
 * 4. **When the latch hands back to `full`**, a pending target is written as
 *    an ordinary rider write — acknowledged, and if refused, reported through
 *    `onFault` and reverted to the last accepted target, which is what the
 *    next tick puts back. With no pending target, the last accepted one is
 *    put back.
 * 5. **A refused target is never written again** unless the rider sets it
 *    again, and nothing is derived from it: it never became the accepted target.
 * 6. **Only a trainer holding an ACCEPTED rider target is rescued** (PR #582's
 *    fourth review). Until the machine has accepted one, the latch is not even
 *    consulted: a rider whose first target was refused has a trainer that
 *    nothing put into ERG, and a floor `0x05` to it would put it into ERG at a
 *    value nobody set — and leave it there, because nothing is restored after.
 *    A first target still on the wire when a stall is judged is rescued on the
 *    tick after it is accepted, which is rule 3's one-write bound.
 * 7. **A refused restore backs off, then stops** (PR #582's fourth review).
 *    Putting the accepted target back is the one write the rider did not just
 *    ask for, so a machine that refuses it is not asked every tick: it is
 *    retried at most {@link RESTORE_RETRIES} more times, after
 *    {@link RESTORE_FIRST_GAP_SECONDS} s and then twice as long each time,
 *    and then not again until the rider sets a target. The refusal is
 *    reported through `onFault` ONCE — on the first — not once per attempt.
 *    The machine then holds whatever it last accepted, which is an ease: a
 *    target lower than the rider's own.
 *
 * What that buys, as properties `manual-erg.test.ts` loops over held and
 * refused writes in every order: no Stop or Reset; a refused target never
 * re-sent and never eased from; a stalled rider eased within one tick of the
 * stall being judged plus at most the one write already on the wire, however
 * often they press *Set* and however slowly the machine answers;
 * {@link ManualErg.rescue} never naming an unaccepted target; nothing written
 * or changed after {@link ManualErg.close}; an ease only ever derived from the
 * target accepted at the tick that decided it, and never above it; and —
 * liveness, which a module that never wrote would fail — a rider's *Set*
 * outside a rescue written at once, and a pending target written at hand-back.
 *
 * ⚠️ **What it costs**: a rider who changes their target mid-rescue waits for
 * the recovery window before it goes on — including a LOWER target. That is
 * deliberate: the rescue already holds relief or the floor under the accepted
 * target, and a second writer is the thing three reviews could not make safe.
 * *End ERG* is on the same form and is never deferred.
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
  type ErgRescue,
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

/** How many more times a refused restore is tried before it is given up (rule 7). */
export const RESTORE_RETRIES = 3;

/** The wait before the first retry of a refused restore; each later one doubles it. */
export const RESTORE_FIRST_GAP_SECONDS = 2;

/** What the Ride screen may say about a rescue in progress. */
export interface ManualErgRescue {
  /**
   * The last target the machine ACCEPTED from the rider — never one in flight,
   * waiting, pending or refused (PR #582's third review). Always a number: a
   * trainer that has accepted no rider target is never rescued (rule 6).
   */
  readonly target: Watts;
  /** `relief` is a share of {@link target}; `floor` is the machine's lowest. */
  readonly holding: 'relief' | 'floor';
  readonly reason: string;
  /**
   * A target the rider set DURING this rescue. Not written: the rescue is the
   * only writer while it lasts, and this goes on once it hands back.
   */
  readonly pending: Watts | undefined;
}

/**
 * What became of a rider's *Set*: the writer's own outcome, or `deferred` —
 * kept as the pending target because a rescue owns the machine.
 *
 * `beforeTheRescue` is true when the *Set* was already WAITING on the wire
 * when the rescue began (PR #582's third review, probe C): the rescue then
 * starts with it as its pending target, so its first notice already names it
 * — *"Your new target of N W will be set once …"*. @see answersHeld
 */
export type ManualErgSetOutcome =
  | ErgWriteOutcome
  | { readonly kind: 'deferred'; readonly target: Watts; readonly beforeTheRescue: boolean };

/**
 * Whether a *Set* is answered with #655's *Held* line — deferred by a rescue
 * that was ALREADY holding when the rider pressed. ⚠️ #740 (#655's review,
 * N4): a *Set* waiting on the wire when the rescue began is deferred too, but
 * the rescue's own notice, said as it began, already carries its pending
 * clause; answering it as well said that clause twice.
 */
export function answersHeld(outcome: ManualErgSetOutcome): boolean {
  return outcome.kind === 'deferred' && !outcome.beforeTheRescue;
}

export interface ManualErg {
  /**
   * The rider set a target. Outside a rescue it is written now; during one it
   * is DEFERRED — kept as the pending target and written, as a rider write,
   * once the rescue hands back. A refused target is never written again unless
   * the rider sets it again.
   *
   * Resolves with what became of THIS target — never rejects. A deferred
   * target's eventual refusal is reported through `onFault`, because the
   * caller's promise has long since resolved.
   */
  set(target: Watts): Promise<ManualErgSetOutcome>;
  observeCadence(reading: CadenceReading): void;
  /** Judge the rider at `now`, and write only if what should be held changed. */
  tick(now: Seconds): void;
  /** `undefined` while no rescue is in progress, and after {@link close}. */
  rescue(): ManualErgRescue | undefined;
  /**
   * Stop writing, for good, and forget any pending target — nothing is written
   * or changed after this, whatever settles late. ⚠️ Does not touch the
   * trainer — the release is the ride controller's one release, and a workout
   * or the game may be about to write on this same control point.
   */
  close(): void;
  /** Resolves once no write is outstanding. For tests. */
  settled(): Promise<void>;
}

/** One offer to the writer, until its outcome is in. */
interface Ask {
  readonly id: number;
  readonly value: Watts;
  /** The rider's own target, rather than an ease or a restore. */
  readonly fromRider: boolean;
  /** Putting the accepted target back after a rescue (rule 7). */
  readonly restore: boolean;
  /**
   * Whose refusal it is to report: `caller` when a `set()` promise carries the
   * outcome, `fault` for every rescue write and for a pending target written
   * when the rescue hands back.
   */
  readonly reportTo: 'caller' | 'fault';
  /** Replaced in the writer's waiting slot — marked in the same turn. */
  superseded: boolean;
  /** A rider target an ease superseded, kept as the pending one. */
  deferred: boolean;
}

export function createManualErg(options: {
  readonly control: ErgSink;
  /** The minimum of the Supported Power Range the machine itself reported. */
  readonly powerFloor: Watts;
  /**
   * A write the machine refused that no `set()` promise reports: a rescue
   * write, or a pending target written when the rescue handed back.
   */
  readonly onFault: (error: unknown) => void;
  readonly onChange: () => void;
}): ManualErg {
  const { control, powerFloor, onFault, onChange } = options;
  const writer: ErgWriter = createErgWriter(control);
  const latch: ErgRescue = createErgRescue();

  let cadence: CadenceReading[] = [];
  let closed = false;
  /** The last target the machine ACCEPTED from the rider — the only base an ease has. */
  let accepted: Watts | undefined;
  /** A target the rider set during a rescue, not written. */
  let pending: Watts | undefined;
  /** What was last offered to the writer, in the watts put on the wire. */
  let lastAsked: Watts | undefined;
  /** What the machine last acknowledged, in the same terms. */
  let onMachine: Watts | undefined;
  let step: ErgRescueStep = { kind: 'full' };
  let asks = 0;
  /** Offers not yet settled, in the order offered. */
  let unsettled: Ask[] = [];
  /** The last tick's clock — what a refused restore's back-off is measured from. */
  let lastTick: Seconds | undefined;
  /** Refusals of the restore since the rider last set a target, or it was accepted (rule 7). */
  let restoreRefusals = 0;
  /** When the last refused restore was refused, on {@link lastTick}'s clock. */
  let restoreRefusedAt: Seconds | undefined;

  /** Whether a refused restore may be tried again at `now` (rule 7). */
  const restoreAllowed = (now: Seconds): boolean => {
    if (restoreRefusals === 0 || restoreRefusedAt === undefined) {
      return true;
    }
    if (restoreRefusals > RESTORE_RETRIES) {
      return false;
    }
    const gap = RESTORE_FIRST_GAP_SECONDS * 2 ** (restoreRefusals - 1);
    // A clock that went backwards is not a reason to wait for ever.
    return now - restoreRefusedAt >= gap || now < restoreRefusedAt;
  };

  /** The rider set a target: a given-up restore may be tried again (rule 7). */
  const forgetRestoreRefusals = (): void => {
    restoreRefusals = 0;
    restoreRefusedAt = undefined;
  };

  /** Offers still headed for the machine: the first is on the wire, a second waits. */
  const live = (): Ask[] => unsettled.filter((entry) => !entry.superseded);

  /** The offer in the writer's waiting slot, if any. */
  const waitingAsk = (): Ask | undefined => {
    const queue = live();
    return writer.busy() && queue.length >= 2 ? queue[queue.length - 1] : undefined;
  };

  const ask = (
    value: Watts,
    fromRider: boolean,
    reportTo: 'caller' | 'fault',
    restore = false,
  ): { readonly entry: Ask; readonly outcome: Promise<ErgWriteOutcome> } => {
    // A busy writer puts this offer in its waiting slot, superseding whatever
    // was there — marked NOW, so a tick in the same turn does not mistake the
    // displaced offer for a live one.
    const displaced = waitingAsk();
    if (displaced !== undefined) {
      displaced.superseded = true;
    }
    lastAsked = value;
    asks += 1;
    const entry: Ask = {
      id: asks,
      value,
      fromRider,
      restore,
      reportTo,
      superseded: false,
      deferred: false,
    };
    unsettled.push(entry);
    const outcome = writer.offer(value);
    void outcome.then((settled) => {
      unsettled = unsettled.filter((other) => other.id !== entry.id);
      if (closed) {
        // PR #582's third review: a late answer after close() changes nothing.
        return;
      }
      if (settled.kind === 'written') {
        onMachine = settled.target;
        if (fromRider) {
          accepted = settled.target;
        }
        if (fromRider || restore) {
          forgetRestoreRefusals();
        }
      } else if (settled.kind === 'failed') {
        // Not on the machine. Whatever is next judged against `lastAsked` must
        // see what the machine actually holds: a refused ease is retried, and
        // a refused rider target reverts to the accepted one on the next tick.
        // Only for the CURRENT offer — an older outcome describes an offer
        // nobody is waiting for any more.
        if (entry.id === asks) {
          lastAsked = onMachine;
        }
        // A refused rider target never became `accepted`, so nothing is ever
        // derived from it, and nothing here writes it again.
        let report = reportTo === 'fault';
        if (restore) {
          // Rule 7: back off, then stop; said once, on the first refusal.
          restoreRefusals += 1;
          restoreRefusedAt = lastTick;
          report = restoreRefusals === 1;
        }
        if (report) {
          onFault(settled.error);
        }
      }
      onChange();
    });
    return { entry, outcome };
  };

  /** What a rescue step holds — derived from the ACCEPTED target and nothing else. */
  const easeFor = (rescuing: Exclude<ErgRescueStep, { kind: 'full' }>, base: Watts): Watts => {
    if (rescuing.kind === 'floor') {
      return powerFloor;
    }
    // Raised to the floor: the machine refuses an out-of-range target
    // outright, and a refused ease rescues nobody (#441).
    return watts(Math.max(Math.round(base * rescuing.share), powerFloor));
  };

  return {
    set(value: Watts): Promise<ManualErgSetOutcome> {
      if (closed) {
        return Promise.resolve({ kind: 'closed', target: value });
      }
      forgetRestoreRefusals();
      if (step.kind !== 'full') {
        // The rescue owns the machine: recorded, not written.
        pending = value;
        onChange();
        return Promise.resolve({ kind: 'deferred', target: value, beforeTheRescue: false });
      }
      const { entry, outcome } = ask(value, true, 'caller');
      // Superseded by an ease and kept as the pending target: say so, rather
      // than "superseded", which reads as though a newer target replaced it.
      return outcome.then((settled): ManualErgSetOutcome =>
        settled.kind === 'superseded' && entry.deferred
          ? { kind: 'deferred', target: value, beforeTheRescue: true }
          : settled,
      );
    },

    observeCadence(reading: CadenceReading): void {
      cadence.push(reading);
    },

    tick(now: Seconds): void {
      const keepFrom = now - CADENCE_HISTORY_SECONDS;
      cadence = cadence.filter((reading) => reading.at >= keepFrom);
      lastTick = now;
      // Rule 6: nothing to rescue until the machine holds a rider's target.
      if (closed || accepted === undefined) {
        return;
      }
      const before = step.kind;
      step = latch.judge(cadence, now);

      if (step.kind === 'full') {
        if (pending !== undefined) {
          // The rescue hands back: the rider's pending target goes on as their
          // own write, and a refusal of it is reported rather than retried.
          const value = pending;
          pending = undefined;
          ask(value, true, 'fault');
          onChange();
          return;
        }
        // Put the accepted target back — unless a rider target is on its way,
        // which is newer than it.
        const riderOnItsWay = live().some((entry) => entry.fromRider);
        if (accepted !== lastAsked && !riderOnItsWay && restoreAllowed(now)) {
          ask(accepted, false, 'fault', true);
        } else if (before !== 'full') {
          onChange();
        }
        return;
      }

      // A rescue, and the only writer. A rider target still WAITING in the
      // slot is superseded by the ease and kept as the pending one. A rider
      // target already ON the wire cannot be recalled: the ease queues behind
      // it, computed without it.
      const waiting = waitingAsk();
      const riderWaiting = waiting?.fromRider === true ? waiting : undefined;
      if (riderWaiting !== undefined) {
        riderWaiting.deferred = true;
        pending = riderWaiting.value;
      }
      const value = easeFor(step, accepted);
      if (value !== lastAsked || riderWaiting !== undefined) {
        ask(value, false, 'fault');
      }
      if (step.kind !== before || riderWaiting !== undefined) {
        onChange();
      }
    },

    rescue(): ManualErgRescue | undefined {
      if (closed || step.kind === 'full') {
        return undefined;
      }
      if (accepted === undefined) {
        // Unreachable by rule 6 — a rescue needs an accepted target to begin.
        return undefined;
      }
      return {
        target: accepted,
        holding: step.kind,
        reason: step.reason,
        pending,
      };
    },

    close(): void {
      closed = true;
      pending = undefined;
      writer.close();
    },

    settled: () => writer.idle(),
  };
}
