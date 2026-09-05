// SPDX-License-Identifier: Apache-2.0

/**
 * The production `FitnessMachineChannel`: `../../protocol`'s trainer-control
 * client, over real GATT characteristics.
 *
 * ## Why this file exists, and why it did not until now
 *
 * `../../protocol/src/fitness-machine-control.ts` landed in #43 with **no
 * production implementation of its channel** — `createTrainerControl` was
 * constructed from a scripted machine and from the #44 simulator, and from
 * nothing else. This is the file that connects it to a device that applies
 * physical resistance to a person who is pedalling, which CLAUDE.md §6 and
 * SECURITY.md both classify as a safety problem rather than only a security
 * one.
 *
 * Everything below is arranged around three facts about the control point that
 * a straightforward implementation gets wrong:
 *
 * 1. **The write must be acknowledged.** `writeValueWithResponse`, never
 *    `writeValueWithoutResponse`. `gatt.ts` records why both are declared and
 *    only one is called; `fitness-machine-channel.test.ts` is what holds it.
 * 2. **`0x2AD9` is indications, not notifications**, and Web Bluetooth has no
 *    separate call for them: `startNotifications()` writes CCCD `0x0002` for a
 *    characteristic whose properties say indicate and `0x0001` for one that
 *    says notify, so the client asks for the subscription and the browser
 *    picks the descriptor value. There is no way to ask for the wrong one and
 *    no way to check which was written.
 * 3. **Every handle dies with the link.** Chrome invalidates the whole
 *    service/characteristic graph on disconnect, so this channel resolves
 *    characteristics *per link* through the injected {@link
 *    FitnessMachineChannelPorts.characteristics} and re-attaches its handlers
 *    when the link token changes. It never accumulates a second handler: a
 *    doubled indication would settle a procedure with the answer to a
 *    different one.
 */

import type { FitnessMachineChannel } from '../../protocol/src/fitness-machine-control';
import type { Unsubscribe } from '../../src/subscription';

import type { GattCharacteristicPort, GattServicePort } from './gatt';

/** What `FitnessMachineChannel` hands a control point or status payload to. */
type ControlPointListener = (value: DataView) => void;

/**
 * The two characteristics, and a token identifying the link they came from.
 *
 * The token is compared by identity and is never dereferenced. It exists
 * because a `BluetoothRemoteGATTCharacteristic` for the same UUID on a *new*
 * link is a different object in Chrome and the same object in at least one
 * shim — so "have the characteristics changed" cannot be answered by comparing
 * them, and answering it wrongly means either a lost subscription or two
 * handlers on one characteristic.
 */
export interface FitnessMachineCharacteristics {
  /** The Fitness Machine Service these came from, on this link. */
  readonly service: GattServicePort;
  readonly controlPoint: GattCharacteristicPort;
  /**
   * Fitness Machine Status, `0x2ADA`. Optional because it is optional in FTMS:
   * a machine that serves the control point and no status characteristic is
   * conformant, and the client copes — it simply never hears about a control
   * permission withdrawn out of band.
   */
  readonly status: GattCharacteristicPort | undefined;
  /** Identity of the link. A new link yields a token that is not `===` the old. */
  readonly link: object;
}

/** What the transport supplies so that this file names no device and no queue. */
export interface FitnessMachineChannelPorts {
  /**
   * The control point and status characteristics on the link that is up **now**.
   *
   * @throws when there is no link, so a setpoint written after a drop rejects
   * rather than resolving against a dead handle.
   */
  characteristics(): Promise<FitnessMachineCharacteristics>;
  /**
   * Run one GATT operation through the owning device's operation queue.
   *
   * Through the queue rather than directly, because a control point write and a
   * `startNotifications` for a power subscription are the same scarce resource:
   * Web Bluetooth serialises GATT operations per device and a concurrent pair
   * is how `Procedure Already In Progress` is provoked from the client side.
   */
  run<T>(operation: () => Promise<T>): Promise<T>;
}

/** What this channel has attached to one link. */
interface Attachment {
  readonly link: object;
  readonly controlPoint: GattCharacteristicPort;
  readonly status: GattCharacteristicPort | undefined;
  readonly onIndication: () => void;
  readonly onStatus: () => void;
}

/**
 * A `FitnessMachineChannel` over real characteristics.
 *
 * The returned channel outlives any one link: listeners registered through it
 * stay registered across a disconnect and a reconnect, because
 * `createTrainerControl` subscribes once at construction and would otherwise
 * be deaf for the rest of the ride after the first dropout.
 */
export function createFitnessMachineChannel(
  ports: FitnessMachineChannelPorts,
): FitnessMachineChannel {
  const indicationListeners: ControlPointListener[] = [];
  const statusListeners: ControlPointListener[] = [];
  let attached: Attachment | undefined;

  const emit = (listeners: readonly ControlPointListener[], value: DataView | undefined): void => {
    if (value === undefined) {
      // A `characteristicvaluechanged` with no value is what a shim produces
      // for a zero-length payload. There is nothing to decode and passing
      // `undefined` on would put the check in every listener instead of here.
      return;
    }
    for (const listener of [...listeners]) {
      listener(value);
    }
  };

  const detach = (): void => {
    if (attached === undefined) {
      return;
    }
    attached.controlPoint.removeEventListener('characteristicvaluechanged', attached.onIndication);
    attached.status?.removeEventListener('characteristicvaluechanged', attached.onStatus);
    attached = undefined;
  };

  /**
   * Bind the handlers to this link's characteristics, exactly once per link.
   *
   * The early return is the whole of the "no second handler" guarantee: every
   * operation on this channel calls `attach`, and a ride writes a setpoint
   * every few seconds.
   */
  const attach = (characteristics: FitnessMachineCharacteristics): void => {
    if (attached?.link === characteristics.link) {
      return;
    }
    detach();
    const { controlPoint, status } = characteristics;
    const onIndication = (): void => {
      emit(indicationListeners, controlPoint.value);
    };
    const onStatus = (): void => {
      emit(statusListeners, status?.value);
    };
    controlPoint.addEventListener('characteristicvaluechanged', onIndication);
    status?.addEventListener('characteristicvaluechanged', onStatus);
    attached = { link: characteristics.link, controlPoint, status, onIndication, onStatus };
  };

  const listen = (
    listeners: ControlPointListener[],
    listener: ControlPointListener,
  ): Unsubscribe => {
    listeners.push(listener);
    return () => {
      const index = listeners.indexOf(listener);
      if (index !== -1) {
        listeners.splice(index, 1);
      }
    };
  };

  return {
    async enableControlPointIndications(): Promise<void> {
      const characteristics = await ports.characteristics();
      attach(characteristics);
      // The CCCD is per-connection, so this runs again after every reconnection
      // — `TrainerControl.linkRestored` clears the client's own flag for that
      // reason. `startNotifications()` on a characteristic that is already
      // notifying is specified to be a no-op, so the repeat costs a queued
      // round trip and nothing else.
      await ports.run(async () => characteristics.controlPoint.startNotifications());
      const status = characteristics.status;
      if (status !== undefined) {
        // Subscribed here rather than in a method of its own: the client calls
        // this one method before its first procedure and never asks for the
        // status characteristic by name, and a status subscription that had to
        // be requested separately is one a caller can forget — leaving a
        // withdrawn control permission unheard until the next setpoint fails.
        await ports.run(async () => status.startNotifications());
      }
    },

    onControlPointIndication(listener): Unsubscribe {
      return listen(indicationListeners, listener);
    },

    onStatus(listener): Unsubscribe {
      return listen(statusListeners, listener);
    },

    async writeControlPoint(value: Uint8Array): Promise<void> {
      const characteristics = await ports.characteristics();
      // Before the write, not after: a reconnection between the last procedure
      // and this one replaced the characteristic, and a handler still bound to
      // the old one means the answer to this write never arrives.
      attach(characteristics);
      // Copied into a buffer this call owns. `BufferSource` is
      // `ArrayBufferView<ArrayBuffer>`, and a `Uint8Array` over an
      // `ArrayBufferLike` — which is what an encoder hands back — is not one:
      // it may be backed by a `SharedArrayBuffer`, which a GATT write may not
      // be given. Seven bytes, once per procedure, and never on the
      // notification hot path.
      const owned = new Uint8Array(value);
      // ⚠️ ACKNOWLEDGED. See `gatt.ts` — the unacknowledged sibling is declared
      // there and never called, and `fitness-machine-channel.test.ts` fails if
      // this line becomes `writeValueWithoutResponse`.
      await ports.run(async () => characteristics.controlPoint.writeValueWithResponse(owned));
    },
  };
}
