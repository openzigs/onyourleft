// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A scripted `CapacitorBlePort`, so the transport can be tested without a phone.
 *
 * The same posture as `@onyourleft/sensors/web-bluetooth/testing`: the plugin's
 * behaviour is data, so a test says what the stack does and then asserts what
 * the adapter did about it. **It records the ORDER of every call**, which is
 * not decoration — #87's Android workaround is entirely a claim about order (a
 * `disconnect` before every `connect`), and a double that only recorded which
 * calls happened could not tell a working workaround from an absent one.
 *
 * ⚠️ **And until #230 it recorded the order without ENFORCING the one ordering
 * rule the plugin actually has.** `initialize()` brings the Android adapter up,
 * and every other plugin method rejects with `Bluetooth LE not initialized.`
 * until it has — the plugin's own `assertBluetoothAdapter` guards all thirteen
 * of them. This double allowed `requestDevice` first, so the whole suite was
 * green against a build that could not pair with anything on a real device: the
 * bug was reported by installing the APK and pressing the button, not by any
 * gate here. A fixture that is more permissive than the thing it stands in for
 * is not a convenience; it is the false pass.
 *
 * So every method below except `initialize` refuses until the stack is up. A
 * test that needs a bare port for something further down the stack — a control
 * point write, say — calls `await port.initialize()` first, which is what the
 * transport does for it in production.
 */

import type { CapacitorBlePort, PluginDevice, PluginDeviceRequest } from './plugin-port';

/** What the scripted stack should do. Every field has a working default. */
export interface ScriptedStack {
  /** Rejects `initialize()` with this. A permission denial is the usual one. */
  readonly initializeRejectsWith?: unknown;
  readonly enabled?: boolean;
  readonly isEnabledRejectsWith?: unknown;
  /** What the chooser returns, or a rejection for a cancel. */
  readonly chooses?: PluginDevice;
  readonly chooserRejectsWith?: unknown;
  readonly connectRejectsWith?: unknown;
  /** Characteristic reads, keyed `service|characteristic`. */
  readonly reads?: Readonly<Record<string, DataView>>;
}

export interface ScriptedPort extends CapacitorBlePort {
  /** Every call this port received, in order, as `method` or `method:argument`. */
  readonly calls: readonly string[];
  /** The last `requestDevice` argument, for asserting what the chooser filtered on. */
  readonly lastRequest: PluginDeviceRequest | undefined;
  /** Push a notification onto a started subscription. Throws if none started. */
  notify(service: string, characteristic: string, value: DataView): void;
  /** Fire the plugin's disconnect callback, as a device going out of range does. */
  dropLink(): void;
  /** Every characteristic write, in order — used to assert what reached the trainer. */
  readonly writes: readonly ScriptedWrite[];
}

/** One recorded write. @see ScriptedPort.writes */
export interface ScriptedWrite {
  readonly service: string;
  readonly characteristic: string;
  readonly value: DataView;
}

const DEFAULT_DEVICE: PluginDevice = { deviceId: 'AA:BB:CC:DD:EE:FF', name: 'Scripted Trainer' };

/**
 * What the plugin says when it is asked to do anything before `initialize()`.
 *
 * ⚠️ **Byte-for-byte the plugin's own string**, read from
 * `@capacitor-community/bluetooth-le` 8.3.0 — `assertBluetoothAdapter` in
 * `android/.../BluetoothLe.kt` and the matching guard in
 * `ios/Sources/BluetoothLe/Plugin.swift`. It is the line that appeared in
 * logcat on the device in #230, and it is exported so a test can pin it rather
 * than paraphrase it.
 */
export const NOT_INITIALIZED_MESSAGE = 'Bluetooth LE not initialized.';

export function scriptedPort(stack: ScriptedStack = {}): ScriptedPort {
  const calls: string[] = [];
  const writes: ScriptedWrite[] = [];
  const listeners = new Map<string, (value: DataView) => void>();
  let onDisconnect: ((deviceId: string) => void) | undefined;
  let lastRequest: PluginDeviceRequest | undefined;
  /** Whether `initialize()` has RESOLVED. A rejected one leaves this false. */
  let started = false;

  const reject = async (value: unknown): Promise<never> => {
    // `Promise.reject` rather than `throw`, so this double cannot accidentally
    // make an adapter's synchronous throw look like a rejection.
    return Promise.reject(value instanceof Error ? value : new Error(String(value)));
  };

  /**
   * The plugin's ordering rule, as a rejection.
   *
   * ⚠️ The call is recorded **before** this refuses it, deliberately: the real
   * plugin receives the call and answers it, so a test asserting the order of
   * what was attempted sees the attempt. A double that swallowed the call
   * entirely would make an out-of-order adapter look like one that did nothing.
   */
  const notInitialized = (): Promise<never> => reject(new Error(NOT_INITIALIZED_MESSAGE));

  return {
    get calls() {
      return calls;
    },
    get lastRequest() {
      return lastRequest;
    },

    async initialize() {
      calls.push('initialize');
      if (stack.initializeRejectsWith !== undefined) {
        return reject(stack.initializeRejectsWith);
      }
      started = true;
    },

    async isEnabled() {
      calls.push('isEnabled');
      if (!started) {
        return notInitialized();
      }
      if (stack.isEnabledRejectsWith !== undefined) {
        return reject(stack.isEnabledRejectsWith);
      }
      return stack.enabled ?? true;
    },

    async requestDevice(request) {
      calls.push('requestDevice');
      lastRequest = request;
      if (!started) {
        // The exact failure #230 was reported for. Before this line the suite
        // was green against a product that could not open a chooser at all.
        return notInitialized();
      }
      if (stack.chooserRejectsWith !== undefined) {
        return reject(stack.chooserRejectsWith);
      }
      return stack.chooses ?? DEFAULT_DEVICE;
    },

    // Not `async`, deliberately: these have nothing to await, and an `async`
    // method with no `await` is what `@typescript-eslint/require-await` exists
    // to catch. Returning the promise explicitly keeps the port's contract --
    // every call resolves rather than throwing -- without the empty ceremony.
    getDevices(ids) {
      calls.push(`getDevices:${ids.join(',')}`);
      if (!started) {
        return notInitialized();
      }
      return Promise.resolve(
        ids.map((id) => ({ deviceId: id, name: (stack.chooses ?? DEFAULT_DEVICE).name })),
      );
    },

    async connect(deviceId, disconnected) {
      calls.push(`connect:${deviceId}`);
      if (!started) {
        return notInitialized();
      }
      if (stack.connectRejectsWith !== undefined) {
        return reject(stack.connectRejectsWith);
      }
      onDisconnect = disconnected;
    },

    disconnect(deviceId) {
      calls.push(`disconnect:${deviceId}`);
      if (!started) {
        return notInitialized();
      }
      return Promise.resolve();
    },

    async read(_deviceId, service, characteristic) {
      calls.push(`read:${service}|${characteristic}`);
      if (!started) {
        return notInitialized();
      }
      const value = stack.reads?.[`${service}|${characteristic}`];
      if (value === undefined) {
        return reject(new Error('characteristic not readable'));
      }
      return value;
    },

    startNotifications(_deviceId, service, characteristic, onValue) {
      calls.push(`startNotifications:${service}|${characteristic}`);
      if (!started) {
        return notInitialized();
      }
      listeners.set(`${service}|${characteristic}`, onValue);
      return Promise.resolve();
    },

    stopNotifications(_deviceId, service, characteristic) {
      calls.push(`stopNotifications:${service}|${characteristic}`);
      if (!started) {
        return notInitialized();
      }
      // ⚠️ The listener is removed AFTER a microtask, not synchronously, and
      // that is the double modelling the real thing rather than being awkward.
      // A GATT stop is a write the stack acknowledges later, so a notification
      // already in flight is delivered after the stop was requested and before
      // it took effect. A double that deleted the listener on the same tick
      // closed that window, and the transport's own "is this link still
      // connected" guard could not be tested at all -- it survived being
      // deleted with every case still green.
      return Promise.resolve().then(() => {
        listeners.delete(`${service}|${characteristic}`);
      });
    },

    write(_deviceId, service, characteristic, value) {
      calls.push(`write:${service}|${characteristic}`);
      if (!started) {
        return notInitialized();
      }
      writes.push({ service, characteristic, value });
      return Promise.resolve();
    },

    /**
     * ⚠️ Recorded and never expected. `plugin-port.ts` records why this method
     * exists on the port at all; the double implements it so that a test can
     * assert it was **not** called, which is the assertion that makes swapping
     * the acknowledged write for it a red test rather than a silent change.
     */
    writeWithoutResponse(_deviceId, service, characteristic, value) {
      calls.push(`writeWithoutResponse:${service}|${characteristic}`);
      if (!started) {
        return notInitialized();
      }
      writes.push({ service, characteristic, value });
      return Promise.resolve();
    },

    notify(service, characteristic, value) {
      const listener = listeners.get(`${service}|${characteristic}`);
      if (listener === undefined) {
        throw new Error(`nothing is subscribed to ${service}|${characteristic}`);
      }
      listener(value);
    },

    dropLink() {
      onDisconnect?.(DEFAULT_DEVICE.deviceId);
    },

    get writes() {
      return writes;
    },
  };
}

/** The scripted device the port hands back when a test says nothing else. */
export const SCRIPTED_DEVICE = DEFAULT_DEVICE;
