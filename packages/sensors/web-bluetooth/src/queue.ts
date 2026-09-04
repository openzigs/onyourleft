// SPDX-License-Identifier: Apache-2.0

/**
 * One GATT operation at a time, across every connected device, and a way to
 * settle what is outstanding when a device goes away.
 *
 * ## Why the queue is global rather than per device
 *
 * Two independent reasons, and a per-device queue satisfies neither:
 *
 * 1. **The browser cannot run some GATT operations in parallel at all.**
 *    WebBluetoothCG records it as an implementation limitation
 *    (`web-bluetooth#188`), and in practice a second `getPrimaryService` or
 *    `startNotifications` issued while the first is outstanding rejects with
 *    `NetworkError` or `InvalidStateError` — including when the two are on
 *    different devices, because the constraint is in the browser's GATT
 *    blocklist and connection machinery rather than in the peripheral.
 * 2. **FTMS §4.16.3 permits one control-point procedure at a time.** That one
 *    is per device, so a per-device queue would satisfy it — but a trainer and
 *    a power meter being set up concurrently still hits (1).
 *
 * So: one chain, and everything joins it. The cost is real — pairing three
 * sensors is serial rather than parallel — and it is the cost of the operations
 * completing at all.
 *
 * ## Why `abandon` exists
 *
 * #40's second acceptance criterion: *"a mid-operation disconnect rejects or
 * resolves every pending operation rather than leaving a promise permanently
 * unsettled. A hung await here freezes the ride screen with no error and no
 * recovery."*
 *
 * Two shapes of hang are possible and `abandon` closes both:
 *
 * - An operation **still queued** when its device drops would otherwise run
 *   against a dead link, reject with a platform error minutes later, or —
 *   worst — sit behind an operation that never settles.
 * - An operation **already in flight** may never settle at all. Chrome usually
 *   rejects a pending GATT promise on disconnect, but "usually" is not a
 *   contract, and a promise nobody settles is indistinguishable from a slow
 *   trainer.
 *
 * ## Why there is a timeout as well as an `abandon`
 *
 * `abandon` is driven by `gattserverdisconnected`, and that event **only fires
 * for a link that was up**. A device that is switched off while
 * `gatt.connect()` is outstanding never connected, so no disconnect event is
 * coming — and Web Bluetooth specifies no timeout for any of its operations. The
 * result is a promise that is neither resolved nor rejected nor abandoned, which
 * is precisely the *"hung await [that] freezes the ride screen with no error and
 * no recovery"* the acceptance criterion names. This was found by writing that
 * test: the first version of this queue hung on it.
 *
 * So every operation that takes the slot is given a deadline, and missing it is
 * an abandonment like any other. The clock starts when the slot is taken rather
 * than when the operation is queued, because waiting behind other work is
 * legitimate and only the operation's own time is bounded.
 *
 * ⚠️ **Abandoning an in-flight operation releases the queue slot without
 * waiting for the underlying promise.** That is deliberate and it is the whole
 * point: the alternative is a chain wedged behind an operation on a link that
 * no longer exists, which stops every *other* device's sensors from ever being
 * set up. The abandoned operation may still be running in the browser; after a
 * disconnect it is running against nothing.
 */

import { seconds, type Seconds } from '@onyourleft/domain';

import type { DeviceId } from '../../src/device';
import { SensorError } from '../../src/errors';

/** An operation waiting for, or holding, the single slot. */
interface Outstanding {
  abandon(error: SensorError): void;
}

export interface GattQueue {
  /**
   * Join the chain, run when it is this operation's turn, and settle.
   *
   * `owner` is what `abandon` matches on. It is a plain `DeviceId` rather than
   * a device record because the queue must be able to settle an operation for a
   * device whose record is already being torn down.
   */
  run<T>(owner: DeviceId, operation: () => Promise<T>): Promise<T>;
  /**
   * Reject every operation this device owns — queued and in flight alike — and
   * release the slot if one is held.
   *
   * Idempotent, and safe to call for a device with nothing outstanding.
   */
  abandon(owner: DeviceId, error: SensorError): void;
  /** How many operations are queued or in flight. Diagnostics and tests. */
  readonly outstanding: number;
}

/**
 * How long one GATT operation may take before it is abandoned.
 *
 * Generous, because a first connection to a trainer across a garage genuinely
 * takes seconds and a rider who is told "no" after five would simply press the
 * button again. It is a bound on a hang, not a performance target.
 */
export const DEFAULT_GATT_OPERATION_TIMEOUT: Seconds = seconds(30);

export interface GattQueueOptions {
  /** Defaults to `DEFAULT_GATT_OPERATION_TIMEOUT`. */
  readonly timeout?: Seconds | undefined;
  /**
   * Run `callback` after `after` seconds, and return a way to cancel it.
   *
   * Injected so a test can bound an operation in milliseconds rather than
   * waiting half a minute for the real bound, and so this file names no timer
   * of its own beyond one default.
   */
  readonly schedule?: ((callback: () => void, after: Seconds) => () => void) | undefined;
}

function defaultSchedule(callback: () => void, after: Seconds): () => void {
  const handle = setTimeout(callback, after * 1000);
  return () => {
    clearTimeout(handle);
  };
}

export function createGattQueue(options: GattQueueOptions = {}): GattQueue {
  const timeout = options.timeout ?? DEFAULT_GATT_OPERATION_TIMEOUT;
  const schedule = options.schedule ?? defaultSchedule;
  /**
   * The tail of the single chain. It resolves and never rejects: an operation's
   * failure is delivered to *its* caller, and a rejected tail would skip every
   * operation queued behind it — a queue that fails permanently the first time
   * a trainer refuses a write.
   */
  let tail: Promise<void> = Promise.resolve();
  const byOwner = new Map<DeviceId, Set<Outstanding>>();
  let outstanding = 0;

  const remember = (owner: DeviceId, entry: Outstanding): void => {
    const existing = byOwner.get(owner);
    if (existing === undefined) {
      byOwner.set(owner, new Set([entry]));
    } else {
      existing.add(entry);
    }
    outstanding += 1;
  };

  /**
   * Drop an operation from the register. Called from `settle` and nowhere else,
   * which is why it does not guard against being called twice: `settle`'s
   * once-only check is what makes that true, and `outstanding` going negative is
   * what makes a broken `settle` visible rather than merely wrong.
   */
  const forget = (owner: DeviceId, entry: Outstanding): void => {
    const existing = byOwner.get(owner);
    if (existing === undefined) {
      return;
    }
    existing.delete(entry);
    outstanding -= 1;
    if (existing.size === 0) {
      byOwner.delete(owner);
    }
  };

  return {
    get outstanding() {
      return outstanding;
    },

    run<T>(owner: DeviceId, operation: () => Promise<T>): Promise<T> {
      let resolveCaller!: (value: T) => void;
      let rejectCaller!: (reason: unknown) => void;
      const caller = new Promise<T>((resolve, reject) => {
        resolveCaller = resolve;
        rejectCaller = reject;
      });

      /** Hands the single slot back to the chain. Reassigned when the slot is taken. */
      let releaseSlot: () => void = () => undefined;
      /** Cancels the deadline. Reassigned when the slot is taken. */
      let cancelDeadline: () => void = () => undefined;
      let settled = false;

      /**
       * Settle the caller exactly once and release the slot.
       *
       * Three call sites race here — the operation resolving, the operation
       * rejecting, and `abandon` — and whichever arrives first wins. That is
       * what makes "every pending operation is settled, and settled once" a
       * property of this function rather than of each call site's discipline.
       */
      const settle = (outcome: () => void): void => {
        if (settled) {
          return;
        }
        settled = true;
        cancelDeadline();
        forget(owner, entry);
        outcome();
        releaseSlot();
      };

      const entry: Outstanding = {
        abandon(error) {
          settle(() => {
            rejectCaller(error);
          });
        },
      };

      remember(owner, entry);

      tail = tail.then(
        () =>
          new Promise<void>((release) => {
            releaseSlot = release;
            if (settled) {
              // Abandoned while it was still queued. The slot goes straight
              // back and the operation never runs, which is the point: a
              // `startNotifications` issued against a link that dropped while
              // it waited is a rejection several seconds later at best.
              release();
              return;
            }
            cancelDeadline = schedule(() => {
              settle(() => {
                rejectCaller(
                  new SensorError('not-connected', 'a GATT operation did not complete in time', {
                    deviceId: owner,
                  }),
                );
              });
            }, timeout);
            let running: Promise<T>;
            try {
              running = operation();
            } catch (error) {
              // `../../src/transport.ts`: every method returning a promise must
              // reject rather than throw. A synchronous throw out of a platform
              // call would otherwise escape into a `.then` callback with no
              // caller to catch it, and wedge the chain.
              settle(() => {
                rejectCaller(error);
              });
              return;
            }
            running.then(
              (value) => {
                settle(() => {
                  resolveCaller(value);
                });
              },
              (error: unknown) => {
                settle(() => {
                  rejectCaller(error);
                });
              },
            );
          }),
      );

      return caller;
    },

    abandon(owner, error) {
      const existing = byOwner.get(owner);
      if (existing === undefined) {
        return;
      }
      // A copy, because `abandon` removes each entry from this very set as it
      // settles it. Not a hot path — this runs once per disconnect, not once
      // per notification.
      for (const entry of [...existing]) {
        entry.abandon(error);
      }
    },
  };
}
