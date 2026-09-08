// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The narrow seam over `@capacitor-community/bluetooth-le` (#87).
 *
 * `BleClient` is a module-level singleton with about thirty methods. This is
 * the nine the transport actually uses, as an interface, for the reason
 * `packages/sensors/web-bluetooth` keeps a scripted stack: a transport that
 * reaches a singleton directly can only be tested on a device, and #87's
 * seventh criterion — that #39's interface is satisfied **unchanged** — is a
 * claim about types and behaviour that a test should be able to make without
 * one.
 *
 * ⚠️ **The shapes here are the plugin's, not ours.** `deviceId` is the plugin's
 * opaque string (a MAC address on Android, a CoreBluetooth UUID on iOS), the
 * UUIDs are lowercase 128-bit strings, and a notification hands back a
 * `DataView` over a buffer the plugin owns. Translating any of that into this
 * program's vocabulary is `transport.ts`'s job and happens in exactly one
 * place, so `@onyourleft/sensors`' types never meet the plugin's.
 *
 * ⚠️ **`initialize()` is where a permission denial surfaces on Android**, not
 * `requestDevice()`. The plugin asks for the runtime permissions during
 * initialisation, so a rider who denies them gets a rejection here — which is
 * why `availability()` calls it rather than assuming it has run.
 */

/** A device as the plugin describes it. */
export interface PluginDevice {
  readonly deviceId: string;
  readonly name?: string | undefined;
}

/** What `requestDevice` is told to look for. */
export interface PluginDeviceRequest {
  /** Services the chooser filters on. Empty means "show everything". */
  readonly services: readonly string[];
  /**
   * Services the connection is permitted to use once made.
   *
   * Separate from `services` for the same reason Web Bluetooth separates them:
   * a device is chosen by what it advertises and used by what it serves, and
   * those are not the same list. A service missing here is unreachable after
   * the link comes up, with no error at connect time.
   */
  readonly optionalServices: readonly string[];
  readonly namePrefix?: string | undefined;
}

/**
 * The nine plugin calls this adapter makes.
 *
 * Every one returns a promise, including the ones the plugin documents as
 * fire-and-forget, because `SensorTransport`'s contract is that nothing throws
 * synchronously and a mixed port would make that impossible to honour here.
 */
export interface CapacitorBlePort {
  /** Ask for the runtime permissions and bring the stack up. */
  initialize(): Promise<void>;

  /** Whether the adapter is switched on. Distinct from being permitted. */
  isEnabled(): Promise<boolean>;

  /**
   * Show the system chooser.
   *
   * Rejects when the rider cancels, which the transport translates into
   * `no-device-selected` rather than a fault.
   */
  requestDevice(request: PluginDeviceRequest): Promise<PluginDevice>;

  /**
   * Devices this stack can reach again without another chooser.
   *
   * The plugin's `getDevices(ids)` takes the ids to look up, so the caller has
   * to have kept them. That is the adapter's business, not this seam's.
   */
  getDevices(ids: readonly string[]): Promise<readonly PluginDevice[]>;

  connect(deviceId: string, onDisconnect: (deviceId: string) => void): Promise<void>;

  disconnect(deviceId: string): Promise<void>;

  /** One characteristic read. Used for the profiles' `describe` characteristic. */
  read(deviceId: string, service: string, characteristic: string): Promise<DataView>;

  startNotifications(
    deviceId: string,
    service: string,
    characteristic: string,
    onValue: (value: DataView) => void,
  ): Promise<void>;

  stopNotifications(deviceId: string, service: string, characteristic: string): Promise<void>;
}
