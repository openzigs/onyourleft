// SPDX-License-Identifier: Apache-2.0

/**
 * Writing gradients to a trainer without letting them pile up — #90 criterion 4.
 *
 * A gradient driver produces a setpoint about once a second
 * (`@onyourleft/domain` §`createSimulationDriver`). The Fitness Machine Control
 * Point runs **one procedure at a time** (FTMS §4.16.3), each answered by an
 * indication, and `createTrainerControl` serialises them for that reason. So
 * the two are not the same rate, and on a machine that is slow to answer — or
 * has stopped answering, which is what the five-second procedure timeout exists
 * for — they diverge without limit.
 *
 * What that costs if nothing bounds it is specific and bad. A rider whose
 * trainer stalls for thirty seconds accumulates thirty queued gradients; the
 * machine then answers, and the client spends the next thirty seconds writing
 * hills the rider has already ridden past, each one arriving as a resistance
 * change that matches nothing on the screen. The queue never drains, because it
 * is filled at the rate it empties.
 *
 * ## The choice: **coalesce onto the newest**, and drop what it supersedes
 *
 * The two ways to bound it are to refuse new offers while one is in flight, or
 * to keep only the newest and discard what it replaces. This writer does the
 * second, and the reason is that a gradient is **a statement about where the
 * rider is now**:
 *
 * - Dropping the *newest* — refusing offers while busy — leaves the trainer
 *   simulating the oldest hill in the backlog, and it stays there until the
 *   queue clears. The rider crests a climb and the resistance does not.
 * - Dropping the *superseded* leaves the trainer at most one write behind the
 *   rider, always, however slow the machine is. A gradient that was never
 *   written is a gradient nobody needed: it described a metre of road the rider
 *   has already left.
 *
 * So at most **one write is in flight and at most one is waiting**, and an
 * offer arriving against a full waiting slot replaces its occupant. The depth
 * is two regardless of how fast a caller offers or how slowly the machine
 * answers, and {@link SimulationWriter.coalesced} counts what that cost so a
 * test — and a bug report — can see it happening rather than infer it.
 *
 * ## Errors are reported, never thrown
 *
 * A caller offering a setpoint every second has nowhere to catch a rejection
 * that arrives four seconds later, and an unhandled rejection out of a fire and
 * forget write would take the ride screen down. So every failure goes to
 * {@link SimulationWriterOptions.onError} with the setpoint that caused it.
 * `control-not-held` is the one to act on: `fitness-machine-control.ts` gives
 * it a message naming the likely cause.
 */

import type { SimulationParameters, TrainerControl } from './fitness-machine-control';

/** The one method of {@link TrainerControl} this writer needs. */
export type SimulationSink = Pick<TrainerControl, 'setSimulationParameters'>;

export interface SimulationWriterOptions {
  /**
   * Told about every failed write, with the parameters that failed.
   *
   * Omitted, failures are swallowed — which is the right default for a
   * fire-and-forget writer and the wrong thing to ship a ride screen with.
   */
  readonly onError?: ((error: unknown, parameters: SimulationParameters) => void) | undefined;
}

export interface SimulationWriter {
  /**
   * Offer a setpoint. Returns immediately, always.
   *
   * Written now if the machine is idle; otherwise it takes the single waiting
   * slot, **replacing** whatever was in it.
   */
  offer(parameters: SimulationParameters): void;
  /** How many offers were superseded before they reached the wire. */
  coalesced(): number;
  /** How many writes were actually attempted. */
  attempted(): number;
  /** Whether a write is in flight or waiting. */
  busy(): boolean;
  /**
   * Resolves once nothing is in flight and nothing is waiting.
   *
   * For a test, and for a caller shutting a ride down that wants the last
   * gradient to have landed before it drops the link.
   */
  idle(): Promise<void>;
  /**
   * Refuse everything after this, and empty the waiting slot.
   *
   * A write already in flight cannot be recalled — it is on the wire — so
   * {@link idle} still waits for it.
   */
  close(): void;
}

export function createSimulationWriter(
  sink: SimulationSink,
  options: SimulationWriterOptions = {},
): SimulationWriter {
  const { onError } = options;

  let inFlight = false;
  let waiting: SimulationParameters | undefined;
  let coalesced = 0;
  let attempted = 0;
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

  const start = (parameters: SimulationParameters): void => {
    inFlight = true;
    attempted += 1;
    void sink
      .setSimulationParameters(parameters)
      .then(
        () => undefined,
        (error: unknown) => {
          // Reported and then forgotten. A failed gradient is not retried: by
          // the time this settles the rider has moved, and the next offer
          // carries the gradient they are actually on.
          onError?.(error, parameters);
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

  let closed = false;

  return {
    offer(parameters: SimulationParameters): void {
      if (closed) {
        return;
      }
      if (!inFlight) {
        start(parameters);
        return;
      }
      if (waiting !== undefined) {
        // The one that will never be written. Counted rather than logged: it
        // is the ordinary consequence of a machine slower than the driver, and
        // a ride that coalesces a few hundred setpoints is working correctly.
        coalesced += 1;
      }
      waiting = parameters;
    },

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
      waiting = undefined;
      releaseIdle();
    },
  };
}
