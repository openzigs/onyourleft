// SPDX-License-Identifier: Apache-2.0

/**
 * A `BluetoothPort` over the #1823 simulated OpenBikeControl controller
 * (#1826), so the real Web Bluetooth client (#1824) can pair the simulated
 * controller and a test can read a scripted press back where the app reads it.
 *
 * `createFakeBluetooth` scripts the browser and holds operations open; this
 * puts the simulator's own device underneath instead, with its clock, its
 * connection budget and the other devices on the same bench. The two do
 * different jobs, and neither replaces the other.
 */

import type { SimulatedControllerGatt } from '../../../protocol/src/simulator-bridge';
import type {
  BluetoothDevicePort,
  BluetoothPort,
  GattCharacteristicPort,
  GattServicePort,
  GattUuid,
  RequestDevicePortOptions,
} from '../gatt';
import { canonicalUuid } from '../profile';

import { domError } from './fake-bluetooth';

/** Copy what a client wrote, because it owns the buffer it handed in. */
function bytesOf(value: BufferSource): Uint8Array {
  return value instanceof ArrayBuffer
    ? new Uint8Array(value.slice(0))
    : new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
}

function asks(options: RequestDevicePortOptions | undefined, service: GattUuid): boolean {
  if (options === undefined || !('filters' in options)) return false;
  return options.filters.some((filter) =>
    (filter.services ?? []).some((each) => canonicalUuid(each) === service),
  );
}

/** The simulated controller, as `navigator.bluetooth` would hand it over. */
export function bluetoothOverSimulatedController(
  gatt: SimulatedControllerGatt,
  id = 'simulated-controller',
): BluetoothPort {
  const disconnectListeners = new Map<() => void, () => void>();

  const characteristic = (uuid: GattUuid): GattCharacteristicPort => {
    let value: DataView | undefined;
    let stop: (() => void) | undefined;
    const listeners = new Set<() => void>();
    return {
      uuid,
      get value() {
        return value;
      },
      startNotifications() {
        stop = gatt.startNotifications(uuid, (next) => {
          value = next;
          for (const listener of [...listeners]) listener();
        });
        return Promise.resolve();
      },
      stopNotifications() {
        stop?.();
        stop = undefined;
        return Promise.resolve();
      },
      readValue: () => Promise.reject(domError('NotSupportedError', 'not readable')),
      writeValueWithResponse(written) {
        gatt.write(uuid, bytesOf(written));
        return Promise.resolve();
      },
      writeValueWithoutResponse(written) {
        gatt.write(uuid, bytesOf(written));
        return Promise.resolve();
      },
      addEventListener(_type, listener) {
        listeners.add(listener);
      },
      removeEventListener(_type, listener) {
        listeners.delete(listener);
      },
    };
  };

  const service = (uuid: GattUuid): GattServicePort => {
    const resolved = new Map<GattUuid, GattCharacteristicPort>();
    const lookup = (wanted: GattUuid): GattCharacteristicPort | undefined => {
      if (!gatt.characteristics.has(wanted)) return undefined;
      let found = resolved.get(wanted);
      if (found === undefined) {
        found = characteristic(wanted);
        resolved.set(wanted, found);
      }
      return found;
    };
    return {
      uuid,
      getCharacteristic(wanted) {
        const found = lookup(canonicalUuid(wanted));
        return found === undefined
          ? Promise.reject(domError('NotFoundError', 'no such characteristic'))
          : Promise.resolve(found);
      },
      getCharacteristics: () =>
        Promise.resolve(
          [...gatt.characteristics.keys()].flatMap((each) => {
            const found = lookup(each);
            return found === undefined ? [] : [found];
          }),
        ),
    };
  };

  const device: BluetoothDevicePort = {
    id,
    name: gatt.name,
    gatt: {
      get connected() {
        return gatt.isConnected();
      },
      connect: () => gatt.connect(),
      disconnect() {
        void gatt.disconnect();
      },
      getPrimaryService(uuid) {
        const wanted = canonicalUuid(uuid);
        return gatt.advertisedServices.includes(wanted)
          ? Promise.resolve(service(wanted))
          : Promise.reject(domError('NotFoundError', 'no such service'));
      },
    },
    addEventListener(_type, listener) {
      disconnectListeners.set(listener, gatt.onDisconnect(listener));
    },
    removeEventListener(_type, listener) {
      disconnectListeners.get(listener)?.();
      disconnectListeners.delete(listener);
    },
  };

  return {
    getAvailability: () => Promise.resolve(true),
    requestDevice(options) {
      return gatt.advertisedServices.some((each) => asks(options, each))
        ? Promise.resolve(device)
        : Promise.reject(domError('NotFoundError', 'nothing matched'));
    },
  };
}
