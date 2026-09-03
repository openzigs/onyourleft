// SPDX-License-Identifier: Apache-2.0

/**
 * Device identity, and the one rule about it that is easy to get wrong.
 *
 * ## A device id is meaningless outside the transport that issued it
 *
 * Web Bluetooth hands back an opaque id that is scoped to the origin and is not
 * the hardware address. CoreBluetooth hands back a `CBPeripheral` UUID that is
 * scoped to the installation and differs between two iPhones looking at the
 * same trainer. Android hands back the MAC. **There is no identifier the three
 * agree on**, so "remember my trainer" cannot be implemented as a single stored
 * string, and a stored string from one platform must never be allowed to match
 * a device on another.
 *
 * That is why `DeviceIdentity` pairs the id with the `TransportId` that issued
 * it, and why `sameDevice` compares **both**. Comparing on the id alone is the
 * defect CLAUDE.md §5 describes in its other form — a query matching on an
 * entity id without the column that scopes it. It passes every single-platform
 * test in the suite, because within one platform the transport is always the
 * same.
 *
 * ## What this deliberately does not do
 *
 * It does not attempt cross-platform re-identification. Matching an advertised
 * name, or a service-data payload, across two stacks is a real problem with a
 * real answer, and the answer involves a stored profile and a re-pair
 * confirmation from the athlete — which is #15's and #40's work, not an
 * interface decision. The interface's job is to make the wrong version
 * (comparing ids) impossible to write by accident.
 */

import type { SensorCapability } from './capability';
import { SensorError } from './errors';

declare const deviceIdBrand: unique symbol;
declare const transportIdBrand: unique symbol;

/**
 * A device handle, opaque and scoped to one transport.
 *
 * Branded so that a bare `string` — a name typed by a user, an id read out of
 * storage without checking which platform wrote it — cannot be passed where a
 * device id is required. The brand erases at runtime; a `DeviceId` is a plain
 * string with no wrapper, which matters because it is the key of every map in
 * every adapter.
 */
export type DeviceId = string & { readonly [deviceIdBrand]: 'device id' };

/**
 * The name of a BLE stack. `'web-bluetooth'`, `'core-bluetooth'`,
 * `'android-ble'` — or anything else, because a simulator (#44) is a transport
 * too and its ids must not collide with a real one's.
 */
export type TransportId = string & { readonly [transportIdBrand]: 'transport id' };

/**
 * Label a string as a device id.
 *
 * @throws {SensorError} with code `invalid-device-id` if the string is empty or
 * only whitespace. A blank id aliases every device to every other in the flat,
 * `deviceId`-keyed interface, and the failure surfaces as a measurement
 * attributed to the wrong trainer rather than as an error.
 */
export function deviceId(value: string): DeviceId {
  if (value.trim() === '') {
    throw new SensorError('invalid-device-id', 'a device id must not be empty or blank');
  }
  // Trimmed, not the raw string. Validating with `.trim()` while returning the
  // original made `deviceId(' abc')` and `deviceId('abc')` two distinct ids that
  // `sameDevice` would never match — a stray newline out of storage becomes a
  // device this program cannot recognise. The doc above already reasons about
  // aliasing; normalising here is what makes that reasoning true.
  return value.trim() as DeviceId;
}

/**
 * Label a string as a transport id.
 *
 * @throws {SensorError} with code `invalid-device-id` if the string is empty or
 * only whitespace — a blank transport id defeats the scoping in `sameDevice`,
 * which is the same failure by a different route.
 */
export function transportId(value: string): TransportId {
  if (value.trim() === '') {
    throw new SensorError('invalid-device-id', 'a transport id must not be empty or blank');
  }
  return value as TransportId;
}

/**
 * The transports this program has issues open for.
 *
 * Names only. Nothing here implements or imports anything — a `TransportId` is
 * a string, and this package is forbidden a platform API. They live here so
 * that #40, #15 and #44 spell them the same way, because `sameDevice` compares
 * them and two spellings of "web bluetooth" would silently make every remembered
 * device unrecognisable.
 */
export const WEB_BLUETOOTH: TransportId = transportId('web-bluetooth');
/** CoreBluetooth, via the Capacitor shell on iOS (#15, #85). */
export const CORE_BLUETOOTH: TransportId = transportId('core-bluetooth');
/** The Android BLE APIs, via the Capacitor shell (#15, #85). */
export const ANDROID_BLE: TransportId = transportId('android-ble');
/** The device simulator (#44), so its ids can never be mistaken for real ones. */
export const SIMULATED: TransportId = transportId('simulated');

/**
 * Which device, on which stack.
 *
 * Both halves, always together. A `DeviceId` on its own is not an identity, and
 * the type is arranged so that saying so takes no discipline.
 */
export interface DeviceIdentity {
  readonly transport: TransportId;
  readonly id: DeviceId;
}

/**
 * A device as this program sees it: one physical thing, with everything it can
 * do gathered into a single capability set.
 *
 * **One entry per device, never one per capability.** A trainer that reports
 * power, cadence and speed and accepts an ERG target is one `SensorDevice` with
 * four capabilities, so a device list renders it once. The alternative — a
 * device per capability — is what a GATT-shaped abstraction produces, and it is
 * the version an athlete recognises immediately as broken.
 */
export interface SensorDevice {
  readonly identity: DeviceIdentity;
  /**
   * The advertised name, when the stack gives one. Absent rather than a
   * placeholder: several stacks return nothing until a connection is
   * established, and a synthesised "Unknown device" here would be rendered as
   * though the device had said it.
   */
  readonly name?: string;
  /**
   * Everything this device provides.
   *
   * A `ReadonlySet` rather than an array: membership is the only question ever
   * asked of it, duplicates are meaningless, and a set cannot be accidentally
   * ordered into a priority.
   */
  readonly capabilities: ReadonlySet<SensorCapability>;
}

/**
 * Whether two identities name the same device.
 *
 * Compares the transport **and** the id. The transport comparison is not
 * defensive noise — a remembered CoreBluetooth UUID and a Web Bluetooth id are
 * both opaque strings, and nothing but this stops one satisfying a check meant
 * for the other.
 */
export function sameDevice(a: DeviceIdentity, b: DeviceIdentity): boolean {
  return a.transport === b.transport && a.id === b.id;
}

/** Whether a device provides a capability. */
export function deviceProvides(device: SensorDevice, capability: SensorCapability): boolean {
  return device.capabilities.has(capability);
}
