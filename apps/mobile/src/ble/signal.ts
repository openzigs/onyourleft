// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * How strongly a connected device is heard, on Android — #1435.
 *
 * The one platform here that gives a number after pairing: Web Bluetooth has
 * no RSSI for a connected device (its chooser shows one, and hands the page
 * nothing), and the plugin's own Android chooser lists names alone. So the
 * Devices screen shows signal strength inside the shell and nowhere else.
 *
 * ⚠️ **A read of the phone's own radio, not of the trainer.** See
 * `plugin-port.ts` §`readRssi`: nothing is sent to the device.
 */

import type { CapacitorBlePort } from './plugin-port';

/**
 * HCI's range for a measured RSSI. The specification reserves `127` for "not
 * available", so a reading outside this is no reading rather than a figure.
 */
const LOWEST_DBM = -127;
const HIGHEST_DBM = 20;

/**
 * The link's signal strength in dBm, or `undefined` when the plugin cannot say
 * — not connected, timed out, or an answer outside what a radio can measure.
 * Never rejects: a signal meter that fails must cost the rider nothing else.
 */
export async function readCapacitorSignal(
  port: CapacitorBlePort,
  deviceId: string,
): Promise<number | undefined> {
  let value: number;
  try {
    value = await port.readRssi(deviceId);
  } catch {
    return undefined;
  }
  return Number.isFinite(value) && value >= LOWEST_DBM && value <= HIGHEST_DBM ? value : undefined;
}
