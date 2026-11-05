// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Releasing the launch splash, through `@capacitor/splash-screen` — #2051.
 *
 * #2050 configures the plugin to hold the splash until the page calls `hide()`
 * or 3 s pass (`capacitor.config.ts` §`plugins.SplashScreen`).
 * `apps/web/src/shell/launch-port.ts` declares what the page asks; this is the
 * Android answer. It does not implement that interface by name, because
 * `apps/web` already depends on this package and an import back would be a
 * workspace cycle (the reason `thermal/thermal.ts` gives). `main.tsx` composes
 * the port from {@link hideCapacitorSplashScreen} behind `isNativeShell`.
 *
 * ⚠️ **The plugin's own JavaScript is not imported**, only its types. Its
 * entry point calls `registerPlugin` when it is evaluated, and importing this
 * module must have no side effect on the web build (`ble/ble-client.ts`'s
 * reason). The plugin is registered here under the name its Java declares,
 * `@CapacitorPlugin(name = "SplashScreen")`, and `splash-screen.test.ts`
 * holds the two names together.
 *
 * ## What is NOT verified here
 *
 * ⚠️ The plugin runs only on a device and CI builds no Android: what is tested
 * is that the page asks once and that a refusal is swallowed, against a
 * scripted plugin. Whether the splash goes when asked is an owner device check.
 */

import { registerPlugin } from '@capacitor/core';
import type { SplashScreenPlugin } from '@capacitor/splash-screen';

/** The one call this project makes of the plugin. */
export type LaunchSplashPlugin = Pick<SplashScreenPlugin, 'hide'>;

/**
 * The real plugin, registered under the name its Java declares. Constructed
 * rather than exported as a constant, so importing this module registers
 * nothing.
 */
export function capacitorSplashScreenPlugin(): LaunchSplashPlugin {
  return registerPlugin<SplashScreenPlugin>('SplashScreen');
}

/**
 * Ask the plugin to release the splash. Resolves on every path: a refusal
 * (a plugin missing from the build answers "not implemented") changes
 * nothing, because the plugin's own timeout releases the splash anyway.
 */
export async function hideCapacitorSplashScreen(plugin: LaunchSplashPlugin): Promise<void> {
  try {
    await plugin.hide();
  } catch {
    // The 3 s launch timeout is the fallback; see above.
  }
}
