// SPDX-License-Identifier: Apache-2.0

/**
 * Writing ERG targets to a trainer — #14's control loop.
 *
 * The sibling of `simulation-writer.ts`, and the differences are the whole of
 * why it is a second file rather than a parameter on the first.
 *
 * ## Same problem, same answer: coalesce onto the newest
 *
 * #14's revision block records an FTMS host sending target power **at roughly
 * 1 Hz, continuously** — not once per interval — while the Control Point runs
 * one procedure at a time, each answered by an indication. Those are not the
 * same rate, so a backlog forms on any machine slower than the caller, and
 * `simulation-writer.ts`'s header sets out at length why the right response is
 * to keep the newest and drop what it supersedes. A target, like a gradient, is
 * a statement about **now**.
 *
 * ⚠️ #14 calls queue depth *"a live design constraint, not a detail"*. It is
 * bounded here at two — one in flight, one waiting — exactly as it is there.
 *
 * ## What is different: an interval boundary must be ACKNOWLEDGED
 *
 * > *"A test proves each interval's target is sent **and acknowledged** before
 * > the interval is treated as begun."*
 *
 * That is in tension with coalescing, and the tension is real: a target that
 * gets superseded never lands, so a player that simply fired and forgot could
 * not tell the difference between "the trainer is holding 250 W" and "the
 * write for 250 W was dropped in favour of the next one".
 *
 * So {@link ErgWriter.offer} **returns an outcome** rather than nothing. A
 * player awaits the one it cares about — the target at an interval boundary —
 * and ignores the ones from the 1 Hz refresh. One code path, no second method,
 * and "acknowledged" becomes something a test can assert instead of a claim in
 * a comment.
 *
 * ⚠️ **It resolves and never rejects.** A caller offering at 1 Hz has nowhere
 * to catch a rejection that arrives four seconds later, and an unhandled
 * rejection out of a fire-and-forget write would take the ride screen down —
 * `simulation-writer.ts` reaches the same conclusion by routing failures to a
 * callback. Here the failure is *in* the outcome, so a caller that awaits sees
 * it and a caller that does not is safe.
 *
 * ## The Reset trap is closed by the TYPE, not by a comment
 *
 * FTMS §4.16.2.1: **a client-initiated Reset revokes the client's own control
 * permission.** #14's revision block names it as the trap for exactly this
 * component — *"a workout player that resets between intervals and keeps
 * sending targets will be silently ignored"* — and `fitness-machine-control.ts`
 * carries the same warning on `reset()`.
 *
 * ⚠️ **{@link ErgSink} is `Pick<TrainerControl, 'setTargetPower'>`.** Not a
 * narrowing for tidiness: it means this module *cannot* call `reset`, because
 * the method is not on the type it holds. A future edit that reaches for one
 * does not compile. That is the difference between a documented trap and a
 * closed one, and `erg-writer.test.ts` pins it with a `@ts-expect-error`.
 */

import type { Watts } from '@onyourleft/domain';

import type { TrainerControl } from './fitness-machine-control';

/**
 * The one method this writer needs — and, by omission, every method it cannot
 * reach. See the Reset note in this module's header.
 */
export type ErgSink = Pick<TrainerControl, 'setTargetPower'>;

/** What became of one offered target. */
export type ErgWriteOutcome =
  /**
   * The machine confirmed it.
   *
   * `quantised` is what it actually holds, which is **not always what was
   * asked for**: `setTargetPower` returns the value after quantisation to the
   * device's minimum increment. A screen showing the asked-for number when the
   * trainer is holding a different one is the small lie this field exists to
   * prevent.
   */
  | { readonly kind: 'written'; readonly target: Watts; readonly quantised: Watts }
  /**
   * A newer target replaced it before it reached the wire.
   *
   * Not a failure. It means the caller changed its mind while the machine was
   * busy, and the newer target is the one that describes the ride.
   */
  | { readonly kind: 'superseded'; readonly target: Watts }
  /** The write was attempted and the machine refused or never answered. */
  | { readonly kind: 'failed'; readonly target: Watts; readonly error: unknown }
  /** Offered after {@link ErgWriter.close}. */
  | { readonly kind: 'closed'; readonly target: Watts };

export interface ErgWriter {
  /**
   * Offer a target. Returns immediately with a promise that always resolves.
   *
   * Written now if the machine is idle; otherwise it takes the single waiting
   * slot, replacing whatever was there — whose promise resolves `superseded`.
   */
  offer(target: Watts): Promise<ErgWriteOutcome>;
  /**
   * What the machine last confirmed, after quantisation.
   *
   * `undefined` until one write has landed. This is the number a screen shows,
   * because it is the only one the trainer has agreed to.
   */
  lastWritten(): Watts | undefined;
  /** How many offers were superseded before they reached the wire. */
  coalesced(): number;
  /** How many writes were actually attempted. */
  attempted(): number;
  busy(): boolean;
  /** Resolves once nothing is in flight and nothing is waiting. */
  idle(): Promise<void>;
  /**
   * Refuse everything after this, and empty the waiting slot.
   *
   * ⚠️ **Does not stop the trainer.** Closing a writer ends this client's
   * stream of targets; the machine keeps holding the last one it was given
   * until somebody calls `stop()` on the control — which is
   * `TrainerControl`'s job and deliberately not reachable from here. A rider
   * left pedalling against a target because a screen unmounted is the failure
   * that would follow from conflating the two.
   */
  close(): void;
}

export function createErgWriter(sink: ErgSink): ErgWriter {
  interface Pending {
    readonly target: Watts;
    readonly settle: (outcome: ErgWriteOutcome) => void;
  }

  let inFlight = false;
  let waiting: Pending | undefined;
  let coalesced = 0;
  let attempted = 0;
  let lastWritten: Watts | undefined;
  let closed = false;
  let idleWaiters: Array<() => void> = [];

  const releaseIdle = (): void => {
    if (inFlight || waiting !== undefined) {
      return;
    }
    const waiters = idleWaiters;
    idleWaiters = [];
    for (const resolve of waiters) {
      resolve();
    }
  };

  const start = (pending: Pending): void => {
    inFlight = true;
    attempted += 1;
    void sink
      .setTargetPower(pending.target)
      .then(
        (quantised: Watts) => {
          lastWritten = quantised;
          pending.settle({ kind: 'written', target: pending.target, quantised });
        },
        (error: unknown) => {
          // Reported through the outcome and not retried. By the time this
          // settles the workout has moved on, and the next offer carries the
          // target the rider is actually meant to be holding.
          pending.settle({ kind: 'failed', target: pending.target, error });
        },
      )
      .then(() => {
        inFlight = false;
        const next = waiting;
        waiting = undefined;
        if (next !== undefined) {
          start(next);
          return;
        }
        releaseIdle();
      });
  };

  return {
    offer(target: Watts): Promise<ErgWriteOutcome> {
      if (closed) {
        return Promise.resolve({ kind: 'closed', target });
      }
      return new Promise<ErgWriteOutcome>((resolve) => {
        const pending: Pending = { target, settle: resolve };
        if (!inFlight) {
          start(pending);
          return;
        }
        if (waiting !== undefined) {
          coalesced += 1;
          // Settled before it is replaced, so a caller awaiting it is not left
          // hanging for a write that will never happen. This is the half a
          // fire-and-forget writer does not have to think about.
          waiting.settle({ kind: 'superseded', target: waiting.target });
        }
        waiting = pending;
      });
    },

    lastWritten: () => lastWritten,
    coalesced: () => coalesced,
    attempted: () => attempted,
    busy: () => inFlight || waiting !== undefined,

    idle(): Promise<void> {
      if (!inFlight && waiting === undefined) {
        return Promise.resolve();
      }
      return new Promise<void>((resolve) => {
        idleWaiters.push(resolve);
      });
    },

    close(): void {
      closed = true;
      const dropped = waiting;
      waiting = undefined;
      dropped?.settle({ kind: 'closed', target: dropped.target });
      releaseIdle();
    },
  };
}
