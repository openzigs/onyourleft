// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Android's thermal forecast, read through the shell's own plugin — #247.
 *
 * `apps/web/src/game/thermal-port.ts` declares what the game asks; this is the
 * Android answer. It does not implement that interface by name, because
 * `apps/web` already depends on this package and an import back would be a
 * workspace cycle — the reason `camera/camera.ts` gives. `main.tsx` composes the
 * port from {@link readCapacitorThermalHeadroom} behind `isNativeShell`.
 *
 * ## The wire format, and why NaN is not a number on it
 *
 * `ThermalPlugin.java` answers `{ supported, headroom? }`. **`NaN` cannot travel
 * as a number**: Capacitor's `JSObject` is an `org.json.JSONObject`, whose
 * `put` throws on a non-finite double, and JSON has no spelling for NaN. So the
 * Java side omits `headroom` when the platform returned NaN, and this file puts
 * the NaN back. The web side's contract is that a NaN from the platform arrives
 * unchanged, and `thermal.test.ts` holds it to that.
 *
 * ## What is NOT verified here
 *
 * ⚠️ `capacitorThermalPlugin()` and `ThermalPlugin.java` run only on a device.
 * There is no Android SDK in the environment this was written in, so the Java
 * is **uncompiled** and the plugin is **type-checked and never executed**, the
 * same limit `ble/ble-client.ts` states. What is tested is the mapping below,
 * against a scripted plugin. Validation 0002 Part E is where a device reads it.
 */

import { registerPlugin } from '@capacitor/core';

/** What `ThermalPlugin.java` answers. */
export interface ThermalReply {
  /** `false` below API 30, where `getThermalHeadroom` does not exist. */
  readonly supported: boolean;
  /** Absent when the platform returned NaN, which JSON cannot carry. */
  readonly headroom?: number;
}

/** The one call this project makes of the plugin. */
export interface ThermalPlugin {
  headroom(options: { readonly forecastSeconds: number }): Promise<ThermalReply>;
}

/**
 * The real plugin, registered under the name `ThermalPlugin.java` declares.
 *
 * Constructed rather than exported as a constant, for `ble-client.ts`'s reason:
 * importing this module must have no side effect on the web build.
 */
export function capacitorThermalPlugin(): ThermalPlugin {
  return registerPlugin<ThermalPlugin>('Thermal');
}

/**
 * The forecast, in the web port's terms.
 *
 * - `undefined` when the device is below API 30, **or when the call fails**: a
 *   plugin missing from `MainActivity`'s registration rejects with "not
 *   implemented", and that is a platform with no forecast, not a cool one.
 * - `NaN` when the platform has the API and gave no number.
 * - Otherwise the number, unclamped.
 */
export async function readCapacitorThermalHeadroom(
  plugin: ThermalPlugin,
  forecastSeconds: number,
): Promise<number | undefined> {
  let reply: ThermalReply;
  try {
    reply = await plugin.headroom({ forecastSeconds });
  } catch {
    return undefined;
  }
  if (!reply.supported) {
    return undefined;
  }
  return typeof reply.headroom === 'number' ? reply.headroom : Number.NaN;
}
