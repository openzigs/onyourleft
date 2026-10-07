// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Android's secure window flag, set and cleared through the shell's own
 * plugin — [#1061](https://github.com/openzigs/onyourleft/issues/1061),
 * [ADR 0044](../../../../docs/adr/0044-side-camera-live-view-and-snapshot.md)
 * D-12.
 *
 * `apps/web/src/camera/secure-window-port.ts` declares what the client asks;
 * this is the Android answer. It does not implement that interface by name,
 * for `thermal/thermal.ts`' reason: `apps/web` already depends on this package
 * and an import back would be a workspace cycle. `main.tsx` composes the port
 * from {@link setCapacitorSecureWindow} behind `isNativeShell`.
 *
 * `SecureWindowPlugin.java` adds `WindowManager.LayoutParams.FLAG_SECURE` to
 * `MainActivity`'s window (`secure`) or clears it (`clear`), on the UI thread.
 * It takes no argument and reads nothing.
 *
 * ## What is NOT verified here
 *
 * ⚠️ `capacitorSecureWindowPlugin()` and `SecureWindowPlugin.java` run only on
 * a device. CI does not build Android, so what is tested in CI is the mapping
 * below against a scripted plugin and, by reading the Java source
 * (`android/secure-window-source.test.ts`), that the plugin sets and clears the
 * flag on the UI thread and is registered. Whether the recents thumbnail is
 * blank on a real device is a check on the owner's list,
 * [#733](https://github.com/openzigs/onyourleft/issues/733).
 */

import { registerPlugin } from '@capacitor/core';

/** The two calls this project makes of the plugin. */
export interface SecureWindowPlugin {
  /** Add `FLAG_SECURE` to the activity's window. */
  secure(): Promise<void>;
  /** Clear it. */
  clear(): Promise<void>;
}

/**
 * The real plugin, registered under the name `SecureWindowPlugin.java`
 * declares. Constructed rather than exported as a constant, for
 * `ble-client.ts`'s reason: importing this module must have no side effect on
 * the web build.
 */
export function capacitorSecureWindowPlugin(): SecureWindowPlugin {
  return registerPlugin<SecureWindowPlugin>('SecureWindow');
}

/**
 * Set the flag when `secure`, and clear it otherwise — the web port's one
 * method in the plugin's two. A rejection (a plugin missing from
 * `MainActivity`'s registration answers "not implemented") is passed on for
 * the web side's owner to swallow, which it does.
 */
export async function setCapacitorSecureWindow(
  plugin: SecureWindowPlugin,
  secure: boolean,
): Promise<void> {
  await (secure ? plugin.secure() : plugin.clear());
}
