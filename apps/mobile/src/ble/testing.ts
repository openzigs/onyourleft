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
}

const DEFAULT_DEVICE: PluginDevice = { deviceId: 'AA:BB:CC:DD:EE:FF', name: 'Scripted Trainer' };

export function scriptedPort(stack: ScriptedStack = {}): ScriptedPort {
  const calls: string[] = [];
  const listeners = new Map<string, (value: DataView) => void>();
  let onDisconnect: ((deviceId: string) => void) | undefined;
  let lastRequest: PluginDeviceRequest | undefined;

  const reject = async (value: unknown): Promise<never> => {
    // `Promise.reject` rather than `throw`, so this double cannot accidentally
    // make an adapter's synchronous throw look like a rejection.
    return Promise.reject(value instanceof Error ? value : new Error(String(value)));
  };

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
    },

    async isEnabled() {
      calls.push('isEnabled');
      if (stack.isEnabledRejectsWith !== undefined) {
        return reject(stack.isEnabledRejectsWith);
      }
      return stack.enabled ?? true;
    },

    async requestDevice(request) {
      calls.push('requestDevice');
      lastRequest = request;
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
      return Promise.resolve(
        ids.map((id) => ({ deviceId: id, name: (stack.chooses ?? DEFAULT_DEVICE).name })),
      );
    },

    async connect(deviceId, disconnected) {
      calls.push(`connect:${deviceId}`);
      if (stack.connectRejectsWith !== undefined) {
        return reject(stack.connectRejectsWith);
      }
      onDisconnect = disconnected;
    },

    disconnect(deviceId) {
      calls.push(`disconnect:${deviceId}`);
      return Promise.resolve();
    },

    async read(_deviceId, service, characteristic) {
      calls.push(`read:${service}|${characteristic}`);
      const value = stack.reads?.[`${service}|${characteristic}`];
      if (value === undefined) {
        return reject(new Error('characteristic not readable'));
      }
      return value;
    },

    startNotifications(_deviceId, service, characteristic, onValue) {
      calls.push(`startNotifications:${service}|${characteristic}`);
      listeners.set(`${service}|${characteristic}`, onValue);
      return Promise.resolve();
    },

    stopNotifications(_deviceId, service, characteristic) {
      calls.push(`stopNotifications:${service}|${characteristic}`);
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
  };
}

/** The scripted device the port hands back when a test says nothing else. */
export const SCRIPTED_DEVICE = DEFAULT_DEVICE;
