// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Taking a rider to the Android settings page that fixes their problem —
 * [#1436](https://github.com/openzigs/onyourleft/issues/1436).
 *
 * After a **permanent** denial Android stops showing its own permission dialog,
 * so "Check again" can no longer ask: the app's own page in Settings is the
 * only place Nearby devices can be granted again. Until #1436 the Devices
 * screen said where that page was and offered no way to it. A radio that is
 * switched off has the same shape, with Bluetooth settings as the page.
 *
 * Which page a notice offers is `notice.ts`'s decision (`PermissionAction`);
 * this only opens it.
 */

import type { CapacitorBlePort } from '../ble/plugin-port';

/** The settings pages a notice can send a rider to. */
export type SettingsPage = 'app' | 'bluetooth';

/**
 * Open `page`. Resolves `false` when the plugin could not — the page did not
 * open, and the screen's own instruction is still there to follow by hand.
 * Never rejects: a button that throws into a click handler reaches no one.
 */
export async function openCapacitorSettings(
  port: CapacitorBlePort,
  page: SettingsPage,
): Promise<boolean> {
  try {
    await (page === 'app' ? port.openAppSettings() : port.openBluetoothSettings());
    return true;
  } catch {
    return false;
  }
}
