// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The trainer's control point, on Android.
 *
 * The Android counterpart of `packages/sensors/web-bluetooth`'s
 * `fitness-machine-channel.ts`, satisfying the **same** platform-free interface
 * — `packages/sensors/protocol`'s {@link FitnessMachineChannel} — so
 * `createTrainerControl` and everything above it is byte-for-byte the same code
 * on both platforms. #39's promise is that one interface is satisfied unchanged
 * by Web Bluetooth and by the Android stack; this is that promise being kept for
 * the one operation that **writes**.
 *
 * ⚠️ **This is the file that applies physical resistance to a person who is
 * pedalling.** CLAUDE.md §6 classes trainer control as a safety issue rather
 * than only a security one. Two things follow and neither is negotiable:
 *
 * 1. **The write is acknowledged.** `port.write`, never
 *    `port.writeWithoutResponse`. `plugin-port.ts` records why the unsafe
 *    sibling is declared and never called, and `fitness-machine-channel.test.ts`
 *    asserts it stays uncalled — so a swap is a red test rather than a silent
 *    regression that only shows up as a setpoint the trainer never took.
 * 2. **Nothing here bounds a setpoint.** Bounding happens in
 *    `packages/sensors/protocol`'s client, from ranges read off the device,
 *    *before* the bytes reach this file. A second bound here would be a second
 *    source of truth about what a machine will accept, and the wrong one would
 *    win silently.
 *
 * ## The one shape the plugin forces
 *
 * {@link FitnessMachineChannel} separates *enabling* indications from
 * *listening* to them; the Capacitor plugin's `startNotifications` takes the
 * callback at the same moment it writes the CCCD. So this keeps its own fan-out:
 * `enableControlPointIndications` starts one plugin subscription into an
 * internal dispatcher, and `onControlPointIndication` registers into that. It is
 * a few lines, and the alternative — reordering the interface to suit one
 * platform — would make the browser adapter the odd one out for no reason.
 */

import {
  FITNESS_MACHINE_CONTROL_POINT,
  FITNESS_MACHINE_SERVICE,
  FITNESS_MACHINE_STATUS,
  type FitnessMachineChannel,
} from '@onyourleft/sensors/protocol';
import type { Unsubscribe } from '@onyourleft/sensors';

import type { CapacitorBlePort } from './plugin-port';

/** A set of listeners with a stable unsubscribe. */
function fanOut(): {
  readonly add: (listener: (value: DataView) => void) => Unsubscribe;
  readonly emit: (value: DataView) => void;
  readonly size: () => number;
} {
  const listeners = new Set<(value: DataView) => void>();
  return {
    add: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    emit: (value) => {
      // ⚠️ A copy, and the reason is narrower than it first looks — worth
      // stating because the obvious reason is wrong. Deleting the **current**
      // element of a `Set` during `for...of` is well defined in JavaScript and
      // does not skip the next one, so a listener that unsubscribes *itself*
      // is safe either way; a test asserting that passes against both spellings
      // and proves nothing. (One was written here first, and the mutation that
      // removed this copy came back green.)
      //
      // What the copy actually prevents is a listener **added** during dispatch
      // being called for the event that was already in flight: `Set` iteration
      // does visit entries inserted while it runs. On this channel that is a
      // real hazard rather than a theoretical one — a control point indication
      // is how the client learns a procedure finished, and `createTrainerControl`
      // subscribes from inside that handler when it chains a procedure. Live
      // iteration would deliver the same indication to the new subscriber and
      // complete a procedure that had not happened.
      for (const listener of [...listeners]) {
        listener(value);
      }
    },
    size: () => listeners.size,
  };
}

/**
 * A {@link FitnessMachineChannel} over the Capacitor plugin.
 *
 * @param deviceId the plugin's own device id — the string
 * `CapacitorBlePort.requestDevice` handed back, not this program's `DeviceId`.
 * The transport owns that mapping and passes the plugin's string in.
 */
export function createCapacitorFitnessMachineChannel(
  port: CapacitorBlePort,
  deviceId: string,
): FitnessMachineChannel {
  const indications = fanOut();
  const statuses = fanOut();
  let controlPointStarted = false;
  let statusStarted = false;

  return {
    enableControlPointIndications: async (): Promise<void> => {
      if (controlPointStarted) {
        // Idempotent, as the interface requires: it is called before the first
        // write and again after a reconnection, and the plugin rejects a second
        // `startNotifications` on a characteristic already subscribed.
        return;
      }
      await port.startNotifications(
        deviceId,
        FITNESS_MACHINE_SERVICE,
        FITNESS_MACHINE_CONTROL_POINT,
        (value) => {
          indications.emit(value);
        },
      );
      controlPointStarted = true;
    },

    onControlPointIndication: (listener): Unsubscribe => indications.add(listener),

    onStatus: (listener): Unsubscribe => {
      const off = statuses.add(listener);
      if (!statusStarted) {
        statusStarted = true;
        // ⚠️ Started lazily and **not awaited**, because the interface's
        // `onStatus` is synchronous — it returns an `Unsubscribe`, not a
        // promise. A failure here is not fatal: Fitness Machine Status is how a
        // machine volunteers that control was taken away, so losing it costs the
        // client its early warning and nothing else. The control point
        // indication path, which is what actually confirms a setpoint, is
        // separate and is awaited where it is enabled.
        void port
          .startNotifications(
            deviceId,
            FITNESS_MACHINE_SERVICE,
            FITNESS_MACHINE_STATUS,
            (value) => {
              statuses.emit(value);
            },
          )
          .catch(() => {
            // A machine that serves no status characteristic at all is ordinary
            // — FTMS makes it optional. Retrying would be a loop against a
            // device that will never have one.
            statusStarted = false;
          });
      }
      return off;
    },

    writeControlPoint: async (value: Uint8Array): Promise<void> => {
      // ⚠️ `write`, the ACKNOWLEDGED one. Never `writeWithoutResponse`. See the
      // header, and `plugin-port.ts` for why the wrong one is even reachable.
      await port.write(
        deviceId,
        FITNESS_MACHINE_SERVICE,
        FITNESS_MACHINE_CONTROL_POINT,
        // A fresh view over the exact bytes: `value.buffer` may be a slice of a
        // larger buffer, and handing the whole buffer to the plugin would write
        // whatever else is in it.
        new DataView(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength)),
      );
    },
  };
}
