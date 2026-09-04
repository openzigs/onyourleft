// SPDX-License-Identifier: Apache-2.0

/**
 * The slice of Web Bluetooth this adapter actually drives, written out as a
 * port rather than imported as a global.
 *
 * ## Why declare it instead of using `@types/web-bluetooth` directly
 *
 * Three reasons, and the third is the one that pays for the file:
 *
 * 1. **It is the injection seam.** `createWebBluetoothTransport` takes a
 *    `BluetoothPort`; a test supplies a scripted stack, a browser supplies
 *    `navigator.bluetooth`. Nothing else in the adapter reads a global, so the
 *    whole lifecycle — including a mid-operation disconnect, which no real
 *    device produces on cue — is reachable from a test.
 * 2. **It is the smallest surface that does the job.** `BluetoothDevice` and
 *    `BluetoothRemoteGATTCharacteristic` are `EventTarget` subclasses with
 *    dozens of inherited members. A fake that satisfies them is a fake nobody
 *    writes; a fake that satisfies these six interfaces is twenty lines.
 * 3. **A narrow port is checkable against the wide one, and the wide one is
 *    not checkable against anything.** `gatt-conformance.test.ts` asserts that
 *    the real `Bluetooth`, `BluetoothDevice`, `BluetoothRemoteGATTServer`,
 *    `BluetoothRemoteGATTService` and `BluetoothRemoteGATTCharacteristic` from
 *    `@types/web-bluetooth` are each assignable to the port below. So a port
 *    that drifts from the browser API is a compile error rather than a bug that
 *    shows up on somebody's trainer.
 *
 * ⚠️ **None of the port interfaces below may be re-exported above the transport
 * boundary.** `docs/architecture.md` requires that no Web Bluetooth type
 * escape, and `packages/sensors/tsconfig.platform-free.json` is what makes that
 * true for `../../src` and `../../protocol`: those programs have no DOM lib and
 * no `@types` at all, so a `BluetoothDevicePort`, a `BluetoothRemoteGATT…` or
 * any other name from outside ES2024 is a compile error there.
 *
 * ⚠️ **`DataView` is not one of them, and this file used to say it was.** The
 * paragraph above previously claimed that "a `DataView` of GATT payload cannot
 * even be named" in the platform-free program. That is false and always was:
 * `DataView` is an ECMAScript built-in, present in `lib: ["ES2024"]`, and #41
 * depends on the fact — it is the whole reason a payload decoder can live in
 * `../../protocol` and be shared, unchanged, with the native stacks (#15). The
 * thing that keeps GATT payload out of `../../src` is that directory's own
 * documented rule and review, not the typechecker; do not read the narrowing as
 * enforcing it.
 */

import type { GattUuid } from '../../protocol/src/uuid';

/**
 * A GATT UUID, in the canonical lowercase 128-bit form the browser normalises
 * to.
 *
 * **Declared in `packages/sensors/protocol/src/uuid.ts` since #41** and
 * re-exported here so every import in this directory is unchanged. A UUID is a
 * Bluetooth SIG assigned number rather than a Web Bluetooth type —
 * CoreBluetooth's `CBUUID` and Android's `java.util.UUID` carry the same value —
 * and the protocol clients that name one have to compile without this directory
 * in scope at all. See that file's header.
 */
export type { GattUuid };

/**
 * One characteristic on one link.
 *
 * ⚠️ **A characteristic object does not survive a disconnect.** Chrome
 * invalidates the whole service/characteristic graph when the GATT server
 * drops, and calling `startNotifications()` on a stale one rejects with
 * `InvalidStateError`. The adapter therefore holds these only for the life of a
 * link and re-resolves them on every connect — which is also why the
 * notification handler is installed and removed with the link rather than with
 * the subscription.
 */
export interface GattCharacteristicPort {
  readonly uuid: GattUuid;
  /**
   * The most recent notification's payload.
   *
   * Read from the characteristic rather than from the event, deliberately: the
   * handler then closes over the characteristic and never touches the `Event`,
   * so the hot path performs no property lookup on a DOM object it does not
   * own and allocates nothing per notification.
   */
  readonly value?: DataView | undefined;
  startNotifications(): Promise<unknown>;
  stopNotifications(): Promise<unknown>;
  addEventListener(type: 'characteristicvaluechanged', listener: () => void): void;
  removeEventListener(type: 'characteristicvaluechanged', listener: () => void): void;
}

/** One primary service on one link. */
export interface GattServicePort {
  readonly uuid: GattUuid;
  getCharacteristic(uuid: GattUuid): Promise<GattCharacteristicPort>;
}

/** The GATT server behind one device. */
export interface GattServerPort {
  /**
   * Whether the link is up **right now**.
   *
   * ⚠️ Not the same question as "is this device present". A `BluetoothDevice`
   * can be a perfectly good object with `gatt.connected === false`, which is
   * the state a page is in after every reload and after every drop.
   */
  readonly connected: boolean;
  connect(): Promise<unknown>;
  /**
   * Synchronous, and it does **not** fire `gattserverdisconnected`
   * synchronously — the event arrives in a later task. The adapter therefore
   * drives the session from its own call site as well as from the event, and
   * `transitionTo` treats the second announcement as a no-op.
   */
  disconnect(): void;
  getPrimaryService(uuid: GattUuid): Promise<GattServicePort>;
}

/** A device the athlete has granted this origin permission to use. */
export interface BluetoothDevicePort {
  /**
   * Opaque, origin-scoped, and **not** the hardware address. `device.ts`
   * explains why a string like this cannot be stored and matched on another
   * platform.
   */
  readonly id: string;
  readonly name?: string | undefined;
  /** Absent when the device exposes no GATT server at all. */
  readonly gatt?: GattServerPort | undefined;
  addEventListener(type: 'gattserverdisconnected', listener: () => void): void;
  removeEventListener(type: 'gattserverdisconnected', listener: () => void): void;
}

/** `navigator.bluetooth`, as this adapter uses it. */
export interface BluetoothPort {
  getAvailability(): Promise<boolean>;
  requestDevice(options?: RequestDevicePortOptions): Promise<BluetoothDevicePort>;
  /**
   * Optional because it is optional in the wild: the event exists in Chrome but
   * a partial implementation, a polyfill or a Capacitor shim may expose the
   * object without it. The adapter feature-detects rather than assuming.
   */
  addEventListener?(type: 'availabilitychanged', listener: () => void): void;
  removeEventListener?(type: 'availabilitychanged', listener: () => void): void;
}

/**
 * One entry in the chooser's filter list.
 *
 * ⚠️ **The entries within one filter are an AND, and the filters are an OR.**
 * `{ services: [a, b] }` means "advertises both"; two filters mean "either".
 * Getting that backwards produces a chooser that is empty on every device the
 * athlete owns, and the adapter builds one filter per service for exactly this
 * reason.
 *
 * `services` admits a number as well as a string because the browser's own
 * `BluetoothServiceUUID` does — `0x180d` is a legal service filter — and a port
 * that narrowed it to `string` would not describe the API it stands in for.
 * `gatt-conformance.test.ts` is what caught that.
 */
export interface BluetoothScanFilterPort {
  readonly services?: readonly (GattUuid | number)[];
  readonly namePrefix?: string;
}

/**
 * What `requestDevice` is given.
 *
 * ⚠️ **A union, not a bag of optional fields.** `requestDevice` requires
 * *either* `filters` *or* `acceptAllDevices: true`, and raises a `TypeError` for
 * an object carrying neither. The first version of this port was a flat
 * interface with both optional, which made `requestDevice({})` a legal call and
 * a runtime failure — caught by `gatt-conformance.test.ts` refusing to compile
 * against the real declarations, which is the whole reason that file exists.
 *
 * ⚠️ **`optionalServices` must name every service the adapter will ever ask
 * for.** `getPrimaryService` on a service that was in neither `filters` nor
 * `optionalServices` rejects with `SecurityError`, whatever the device actually
 * offers — so the adapter passes its whole registry here rather than only the
 * services the request implies.
 */
export type RequestDevicePortOptions =
  | {
      readonly filters: readonly BluetoothScanFilterPort[];
      readonly optionalServices?: readonly (GattUuid | number)[];
    }
  | {
      readonly acceptAllDevices: boolean;
      readonly optionalServices?: readonly (GattUuid | number)[];
    };
