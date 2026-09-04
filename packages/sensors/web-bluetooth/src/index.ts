// SPDX-License-Identifier: Apache-2.0

/**
 * `@onyourleft/sensors/web-bluetooth` — the browser transport (#40).
 *
 * A separate entry point from `@onyourleft/sensors`, and a separate directory
 * with its own place in `eslint.config.js`, because this is the one part of the
 * sensor stack that is allowed to name a platform API. `../../src` stays
 * platform-free: `packages/sensors/tsconfig.platform-free.json` compiles it with
 * no DOM library at all, so a Web Bluetooth type cannot be named above this
 * boundary even by accident.
 *
 * ```ts
 * const transport = createWebBluetoothTransport({ profiles: [heartRate] });
 *
 * if ((await transport.availability()).kind !== 'available') { … }   // Safari, Firefox, Linux
 *
 * button.addEventListener('click', async () => {                     // one gesture per device
 *   const strap = await transport.discover({ capabilities: ['heart-rate'] });
 *   await transport.connect(strap.identity.id);
 *   await transport.subscribe(strap.identity.id, 'heart-rate', render);
 * });
 * ```
 *
 * The profiles come from #41–#43. This package supplies none — see
 * `profile.ts`.
 */

export type {
  BluetoothDevicePort,
  BluetoothPort,
  BluetoothScanFilterPort,
  GattCharacteristicPort,
  GattServerPort,
  GattServicePort,
  GattUuid,
  RequestDevicePortOptions,
} from './gatt';

export type { GattProfile, MeasurementSink, MeasurementValueFor } from './profile';

export { canonicalUuid } from './profile';

export type { GattQueue, GattQueueOptions } from './queue';

export { createGattQueue, DEFAULT_GATT_OPERATION_TIMEOUT } from './queue';

export { isUsableBluetooth, readAvailability } from './availability';

export type { WebBluetoothTransportOptions } from './transport';

export { createWebBluetoothTransport } from './transport';
