// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What a link resolved on Android, in this program's vocabulary — #370.
 *
 * The counterpart of `packages/sensors/web-bluetooth`'s
 * `transport.resolvedUuids`, and it exists for the same one reason: a trainer
 * that serves only its manufacturer's control point is a trainer, and until
 * something could say what a machine offers, this program told that rider
 * *"no controllable trainer"*.
 *
 * ⚠️ **It is a read of a table the Android stack already holds**, not a round
 * trip to the device: the plugin's `getServices` returns the services and
 * characteristics discovered when the link came up. So the cost of asking is a
 * bridge call, and the answer is available the moment a device is connected.
 *
 * ⚠️ **Nothing here names a vendor, and that is the boundary this file keeps.**
 * It flattens services and characteristics into one list because that is what
 * `packages/sensors/protocol`'s `chooseTrainerControl` takes — *"a flat
 * iterable of service and characteristic UUIDs together"* — and deciding which
 * of them means anything is the protocol's business, platform-free and
 * identical on both platforms. A shell that recognised a control point would be
 * a second opinion about trainer safety in the one place it must not be
 * (CLAUDE.md §6).
 */

import type { GattUuid } from '@onyourleft/sensors/protocol';

import type { CapacitorBlePort } from './plugin-port';

/**
 * Every service and characteristic UUID the link to `deviceId` resolved.
 *
 * @returns the empty list when the plugin cannot answer — the device is not
 * connected, or the platform has no discovered table for it. Empty is *"nothing
 * known about this machine"*, which `chooseTrainerControl` turns into `none`
 * and the screen turns into the sentence it would have shown anyway. A
 * rejection here must never cost a rider a trainer that works.
 */
export async function readCapacitorResolvedUuids(
  port: CapacitorBlePort,
  deviceId: string,
): Promise<readonly GattUuid[]> {
  let services;
  try {
    services = await port.getServices(deviceId);
  } catch {
    return [];
  }
  const found = new Set<GattUuid>();
  for (const service of services) {
    found.add(service.uuid);
    for (const characteristic of service.characteristics) {
      found.add(characteristic.uuid);
    }
  }
  return [...found];
}
