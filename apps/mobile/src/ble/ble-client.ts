// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The one file in this repository that names `BleClient`.
 *
 * ⚠️ **#87 built the seam and never built this side of it.** `plugin-port.ts`
 * declares `CapacitorBlePort` and `transport.ts` implements #39's
 * `SensorTransport` over it — both tested against a scripted double — and
 * nothing ever constructed the real plugin. The consequence was not a failing
 * test; it was that `apps/mobile` had **no importers at all**, so the Android
 * shell shipped a web build that could not reach a native transport and the app
 * could not pair with anything. A seam with one side is a seam that ships
 * nothing, which is the same shape as a renderer that is tree-shaken out.
 *
 * ## Why the seam is still worth having
 *
 * `BleClient` is a module-level singleton with about thirty methods, and it
 * throws on import outside a Capacitor WebView. `plugin-port.ts` names the nine
 * calls this project actually makes; this file is the only place the other
 * twenty-one are reachable, and it is deliberately thin enough that reading it
 * is faster than reading the plugin's docs.
 *
 * ## What is NOT verified here
 *
 * ⚠️ Everything below runs only on a device. There is no Android SDK in this
 * environment, `dl.google.com` is refused by the egress proxy, and jsdom has no
 * Capacitor bridge — so `capacitorBlePort()` is **type-checked and never
 * executed**. `apps/mobile/README.md` §4 is the table of what that limitation
 * covers, and this file belongs in it. What *is* tested is everything above the
 * seam: `transport.test.ts` drives `createCapacitorTransport` against a scripted
 * `CapacitorBlePort` and asserts #39's contract, and none of that changes here.
 */

import { BleClient } from '@capacitor-community/bluetooth-le';

import type { CapacitorBlePort, PluginDevice, PluginDeviceRequest } from './plugin-port';

/**
 * The real plugin, behind {@link CapacitorBlePort}.
 *
 * Constructed rather than exported as a constant so that importing this module
 * has no side effect: `BleClient`'s own initialisation happens on the first
 * call, and a module that reached for the bridge at import time would break the
 * web build that also loads it.
 */
export function capacitorBlePort(): CapacitorBlePort {
  return {
    initialize: async (): Promise<void> => {
      // `androidNeverForLocation` is the runtime half of the manifest claim #87
      // makes and #95's Data Safety form rests on. Setting it here as well as in
      // the manifest is not redundant: the manifest attribute tells the OS what
      // the app promises, and this tells the plugin not to ask for location
      // permission on the rider's behalf — a plugin that asked anyway would make
      // the "no location collection" declaration false in the only way that
      // matters, which is what the rider is actually prompted for.
      await BleClient.initialize({ androidNeverForLocation: true });
    },

    isEnabled: async (): Promise<boolean> => BleClient.isEnabled(),

    requestDevice: async (request: PluginDeviceRequest): Promise<PluginDevice> => {
      const device = await BleClient.requestDevice({
        services: [...request.services],
        optionalServices: [...request.optionalServices],
        ...(request.namePrefix === undefined ? {} : { namePrefix: request.namePrefix }),
      });
      return { deviceId: device.deviceId, name: device.name };
    },

    getDevices: async (ids: readonly string[]): Promise<readonly PluginDevice[]> => {
      const found = await BleClient.getDevices([...ids]);
      return found.map((device) => ({ deviceId: device.deviceId, name: device.name }));
    },

    connect: async (deviceId: string, onDisconnect: (deviceId: string) => void): Promise<void> => {
      await BleClient.connect(deviceId, onDisconnect);
    },

    disconnect: async (deviceId: string): Promise<void> => {
      await BleClient.disconnect(deviceId);
    },

    read: async (deviceId: string, service: string, characteristic: string): Promise<DataView> =>
      BleClient.read(deviceId, service, characteristic),

    startNotifications: async (
      deviceId: string,
      service: string,
      characteristic: string,
      onValue: (value: DataView) => void,
    ): Promise<void> => {
      await BleClient.startNotifications(deviceId, service, characteristic, onValue);
    },

    stopNotifications: async (
      deviceId: string,
      service: string,
      characteristic: string,
    ): Promise<void> => {
      await BleClient.stopNotifications(deviceId, service, characteristic);
    },
  };
}
