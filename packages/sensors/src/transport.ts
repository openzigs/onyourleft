// SPDX-License-Identifier: Apache-2.0

/**
 * The interface every BLE transport implements.
 *
 * ## The shape, and why it is flat
 *
 * Web Bluetooth is an **object graph**: `requestDevice()` returns a
 * `BluetoothDevice`, `device.gatt.connect()` returns a server,
 * `getPrimaryService()` returns a service, `getCharacteristic()` returns a
 * characteristic, and `startNotifications()` is called on that characteristic.
 * CoreBluetooth and the Android GATT APIs are **flat and keyed by a device
 * handle**: you connect a peripheral, then read and write against it by service
 * and characteristic UUID. So does the Capacitor plugin that wraps both —
 * `connect(deviceId)`, `startNotifications(deviceId, service, characteristic,
 * cb)`, `write(deviceId, service, characteristic, value)`.
 *
 * **This interface is flat and `deviceId`-keyed, because the flat form is the
 * target.** A flat interface maps onto the object graph by keeping a map; an
 * object-graph interface does not map onto CoreBluetooth at all, because there
 * is no object to hold. Choosing the graph here would mean #15 rewrites the
 * protocol clients rather than adding an adapter, which is the outcome this
 * issue exists to prevent.
 *
 * ⚠️ **#40 owns the flattening.** The Web Bluetooth adapter keeps a
 * `deviceId → { device, server, service, characteristic }` handle map and is
 * the only place in this program where a `BluetoothDevice` exists. That is
 * stated here rather than left implicit because it is the single largest piece
 * of work in #40 and it is easy to mistake for incidental plumbing.
 *
 * ⚠️ **#40 also owns the Android reconnect asymmetry.** The Capacitor plugin
 * documents that on some Android devices `connect()` fails for a device that was
 * connected before, and that the caller must call `disconnect()` first. That
 * workaround belongs **inside** the adapter. An interface that exposed it —
 * whether as a flag, a documented calling order, or a `forceDisconnect` option —
 * would have failed, because every other transport would then carry a parameter
 * describing one vendor's firmware bug.
 *
 * ## What is not here
 *
 * No service UUID, no characteristic UUID, no `DataView`, no payload. Those
 * belong to #40–#43, below this boundary. If a change to this file needs one of
 * them, the change is in the wrong file.
 *
 * No `write` and no control commands either: trainer control is #43, and
 * SECURITY.md treats setting resistance on a person who is pedalling as a
 * safety problem that gets its own review rather than a parameter added here.
 *
 * ## One contract clause that is easy to break and hard to see
 *
 * ⚠️ **Every method that returns a `Promise` must *reject*. None of them may
 * throw synchronously.** This was found by writing the first implementation of
 * this interface, and it is not pedantry: the obvious `connect(id)` looks the
 * device up in its handle map and throws `device-not-found` before it has
 * created a promise at all. A caller written the ordinary way —
 * `transport.connect(id).catch(showError)` or `await` inside a `try` — then
 * never sees it; the error escapes as an exception in a click handler, and the
 * UI shows nothing while the device silently fails to connect. It is the same
 * shape as a write that reports success while the read cannot see it, and a
 * test that only asserts "it threw" passes over both.
 */

import type { MeasurementCapability, SensorCapability } from './capability';
import type { ConnectionState } from './connection';
import type { DeviceId, SensorDevice, TransportId } from './device';
import type { MeasurementFor } from './measurement';
import type { Listener, Unsubscribe } from './subscription';

/**
 * Whether this transport can be used at all, and if not, why not.
 *
 * Four outcomes rather than a boolean, because #39 requires that *"'no device
 * found' and 'not permitted' are distinct states the interface must be able to
 * express"*. Each one implies a different thing for the athlete to do, and a
 * boolean implies the same thing for all of them.
 */
export type TransportAvailability =
  /** Usable now. */
  | { readonly kind: 'available' }
  /**
   * No BLE stack this transport can drive. Safari and Firefox, permanently —
   * neither implements Web Bluetooth and neither intends to (CLAUDE.md §8). The
   * honest UI here offers the native app, not a retry.
   */
  | { readonly kind: 'unsupported' }
  /**
   * A stack exists but the athlete has not granted permission. Recoverable, and
   * the recovery is a system prompt or a settings screen.
   */
  | { readonly kind: 'not-permitted' }
  /**
   * Permission is granted and the adapter is off or otherwise unusable.
   * Recoverable, and the recovery is switching Bluetooth on.
   */
  | { readonly kind: 'adapter-unavailable' };

/**
 * What this transport can and cannot do, declared rather than inferred.
 *
 * A caller must not branch on which platform it thinks it is running on — that
 * is a user-agent sniff by another name, and it is wrong the first time a
 * Chromium fork or a Capacitor shell reports something unexpected. It branches
 * on these instead.
 */
export interface TransportTraits {
  /** Which stack this is, and the scope of every `DeviceId` it issues. */
  readonly id: TransportId;
  /**
   * `discover()` must be called from a user gesture.
   *
   * True for Web Bluetooth, where `requestDevice()` throws outside a user
   * activation and there is no way to request one. A caller that respects this
   * does not offer "scan automatically on page load" on a transport that cannot
   * do it.
   */
  readonly requiresUserGestureToDiscover: boolean;
  /**
   * A previously permitted device can be reconnected without another gesture.
   *
   * False for Web Bluetooth: there is no silent reconnect, so a page reload
   * costs a button press. True for the native stacks, which is the difference
   * that makes `reconnecting` a state a transport can actually reach.
   */
  readonly canReconnectWithoutUserGesture: boolean;
  /**
   * Connections survive the app being backgrounded.
   *
   * False in the browser — Web Bluetooth has no background operation and is not
   * available in a worker. True on iOS and Android with the right entitlements.
   * A recorder uses this to decide whether "your ride will pause if you switch
   * apps" needs saying.
   */
  readonly canRestoreConnectionsInBackground: boolean;
  /**
   * How many devices this transport will hold at once.
   *
   * See `MAX_RECOMMENDED_CONCURRENT_CONNECTIONS` in `plan.ts`. The number is a
   * platform property with no specified value, it is OS-wide rather than
   * per-application, and it is shared with whatever else the athlete has
   * paired.
   */
  readonly maxConcurrentConnections: number;
}

/**
 * What to look for.
 *
 * By capability, never by service UUID — the caller above this boundary wants
 * power, and which GATT service supplies it is the adapter's business. An empty
 * `capabilities` means "anything this program can use".
 */
export interface DiscoveryRequest {
  readonly capabilities: readonly SensorCapability[];
  /**
   * Narrow the chooser to devices whose advertised name starts with this.
   *
   * Optional and advisory. Some stacks filter in the OS chooser, some filter
   * the results, and a device that advertises no name is not excluded by a
   * prefix it cannot match.
   */
  readonly namePrefix?: string;
}

/**
 * A BLE stack, as the rest of this program sees it.
 *
 * Implemented by #40 (Web Bluetooth), #44 (the simulator) and, in #15, by the
 * Capacitor plugin over CoreBluetooth and Android BLE.
 */
export interface SensorTransport {
  readonly traits: TransportTraits;

  /**
   * Whether this transport can be used, checked now rather than assumed.
   *
   * Asynchronous because every stack answers asynchronously: Web Bluetooth's
   * `getAvailability()` returns a promise, and the Capacitor plugin's
   * `initialize()` and `isEnabled()` both do.
   */
  availability(): Promise<TransportAvailability>;

  /**
   * Ask the athlete to choose a device.
   *
   * Returns **one** device, because that is what every stack's chooser returns
   * and pretending otherwise would mean the Web Bluetooth adapter synthesising
   * a list it does not have.
   *
   * @throws {SensorError} `user-gesture-required` when
   * `traits.requiresUserGestureToDiscover` holds and there was no gesture;
   * `no-device-selected` when the chooser closed without a choice, which is the
   * ordinary result of pressing cancel and must not be rendered as a fault;
   * `not-permitted` or `adapter-unavailable` when the stack refuses.
   */
  discover(request: DiscoveryRequest): Promise<SensorDevice>;

  /**
   * Devices this transport can reach again without another gesture.
   *
   * Empty on Web Bluetooth today, and that is the honest answer rather than a
   * missing feature: permitted devices are not enumerable there without a
   * permissions API this program does not rely on. Native stacks return the
   * peripherals they can restore. A "remember my trainer" feature is built on
   * this, and `device.ts` explains why the stored identity cannot be a bare id.
   */
  knownDevices(): Promise<readonly SensorDevice[]>;

  /**
   * Establish a link.
   *
   * Idempotent from the caller's point of view: calling it for a device that is
   * already connected resolves. Any platform quirk needed to make that true —
   * including Android's disconnect-before-reconnect — is the adapter's, and
   * must not appear in this signature.
   *
   * @throws {SensorError} `device-not-found` for an id this transport did not
   * issue; `connection-budget-exceeded` when the platform will hold no more.
   */
  connect(id: DeviceId): Promise<void>;

  /** Drop a link. Resolves for a device that is already disconnected. */
  disconnect(id: DeviceId): Promise<void>;

  /**
   * Where a device's connection is now.
   *
   * Synchronous: a caller rendering a device list asks for every device on
   * every frame, and a promise per row would be a promise per row.
   *
   * @throws {SensorError} `device-not-found` for an id this transport did not
   * issue.
   */
  connectionState(id: DeviceId): ConnectionState;

  /** Watch a device's connection state. */
  observeConnectionState(id: DeviceId, listener: Listener<ConnectionState>): Unsubscribe;

  /**
   * Receive a device's measurements for one capability.
   *
   * The listener is typed by the capability, so subscribing to `'power'` hands
   * back a `PowerMeasurement` with no narrowing and no cast.
   *
   * Asynchronous because enabling notifications is a GATT write on every stack.
   * The returned `Unsubscribe` is synchronous, because a caller unsubscribing
   * during teardown has nothing useful to do with a promise.
   *
   * **No measurement is delivered unless the device is `connected`** — that is
   * `createDeviceSession`'s guarantee in `session.ts`, and it is the rule every
   * transport composes rather than re-implements.
   *
   * @throws {SensorError} `not-connected` if the device is not connected;
   * `capability-unsupported` if the device does not provide it.
   */
  subscribe<Capability extends MeasurementCapability>(
    id: DeviceId,
    capability: Capability,
    listener: Listener<MeasurementFor<Capability>>,
  ): Promise<Unsubscribe>;
}
