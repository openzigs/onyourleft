// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **Opening the Android settings page that fixes a Bluetooth problem** —
 * [#1436](https://github.com/openzigs/onyourleft/issues/1436).
 *
 * After a permanent denial Android stops showing its permission dialog, so
 * *Check again* can no longer ask, and until #1436 the Devices screen could
 * only say where the page was. Inside the shell this is
 * `apps/mobile/src/permission/settings.ts` over the plugin's own
 * `openAppSettings` and `openBluetoothSettings`. In a browser there is no such
 * page to open and no port.
 *
 * ## Why this is a `*-port.ts`
 *
 * docs/agents/wiring-gate.md §4j: `WIRE003` holds the method to a production
 * caller (`views/DevicesView.tsx`). ⚠️ The provider half is the §Limits case:
 * `main.tsx` passes it as an optional prop, and dropping that line is green in
 * the gate — the notice then keeps its written instruction and shows no
 * button, which is the screen as it was before #1436.
 */

/** The pages a notice can send a rider to. */
export type SettingsPage = 'app' | 'bluetooth';

export interface SystemSettingsPort {
  /** Open `page`. Resolves `false` when it could not; never rejects. */
  openSystemSettings(page: SettingsPage): Promise<boolean>;
}
