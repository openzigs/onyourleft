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
 * initialisation, so a rider who denies them gets a rejection here.
 *
 * ⚠️ **It is also a hard precondition for every other method on this port**, and
 * that used to be written down nowhere: the plugin's own `assertBluetoothAdapter`
 * rejects each of them with `Bluetooth LE not initialized.` until the stack is
 * up. This paragraph used to end *"which is why `availability()` calls it rather
 * than assuming it has run"* — and `availability()` was the ONLY caller while
 * nothing in `apps/web` called `availability()`, so on a device every pairing
 * attempt reached `requestDevice()` with the stack down and no sensor could be
 * paired at all (#230). `transport.ts`'s `ensureInitialized` is where it is
 * called from now: once per transport, on every path that reaches the plugin.
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
 * The eleven plugin calls this adapter makes.
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

  /**
   * One **acknowledged** characteristic write — the plugin's `write`.
   *
   * ⚠️ This is the one that drives a trainer's control point, and the
   * acknowledgement is the whole point.
   * `packages/sensors/protocol`'s `FitnessMachineChannel.writeControlPoint`
   * states the rule for every platform: *"an implementation must use an
   * acknowledged write — `writeValueWithResponse()` on Web Bluetooth, `write`
   * rather than `writeWithoutResponse` on a native stack"*, because an
   * unacknowledged write *"compiles, satisfies every test in this file, and
   * reintroduces exactly the fire-and-forget failure the client exists to
   * prevent"*.
   */
  write(deviceId: string, service: string, characteristic: string, value: DataView): Promise<void>;

  /**
   * The unacknowledged sibling. **Declared, implemented, and never called.**
   *
   * ⚠️ It is here on purpose and it is not dead weight. `packages/sensors/
   * web-bluetooth/src/gatt.ts` does exactly this for the same reason, and
   * CLAUDE.md §4b records why: with the unsafe call *absent* from the port,
   * swapping the safe write for it would be a one-word edit that no test could
   * see, because the port would have to grow the method in the same commit and
   * a reviewer would read that as ordinary. With it present and provably
   * unused, the swap is a **red test** —
   * `fitness-machine-channel.test.ts` asserts the control point write goes
   * through `write` and that `writeWithoutResponse` is never called at all.
   *
   * Nothing in this repository calls it. If something ever needs to, that is a
   * decision to take in an issue rather than at a call site.
   */
  writeWithoutResponse(
    deviceId: string,
    service: string,
    characteristic: string,
    value: DataView,
  ): Promise<void>;
}
