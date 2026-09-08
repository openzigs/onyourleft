// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What the Android shell offers the client that runs inside it.
 *
 * ⚠️ **This file is why `apps/mobile` is no longer an island.** Until it
 * existed the package declared no `exports` at all, so nothing could import it —
 * and since `capacitor.config.ts` sets `webDir: '../web/dist'`, the shell
 * shipped a web build that had no way to reach the native transport #87 wrote.
 * The app could not pair with anything on Android. `apps/web` now depends on
 * this package and reaches for it **only when it detects it is running inside
 * the shell** (`support/capacitor.ts`), so the browser build never loads a line
 * of it.
 *
 * The dependency direction — an app depending on another app — is unusual and is
 * permitted deliberately: `eslint.config.js`'s boundary rule allows
 * `app → app | package` and forbids only `package → app`. What would be wrong is
 * the reverse of what happens here, and it is worth saying why this way round is
 * right. `apps/mobile` holds the **Android platform code**: the Gradle project,
 * the foreground service, the permission wording, and the BLE adapter. It builds
 * no bundle of its own. `apps/web` is the one client, and on Android it needs a
 * platform adapter — exactly as it needs `packages/sensors/web-bluetooth` in a
 * browser. Naming this package from there is the same relationship #40's
 * transport already has, with a different platform on the other end.
 */

export { createCapacitorTransport, systemClock } from './ble/transport';
export type { CapacitorTransportOptions } from './ble/transport';
export { capacitorBlePort } from './ble/ble-client';
export { createCapacitorFitnessMachineChannel } from './ble/fitness-machine-channel';
export { readCapacitorFitnessMachine } from './ble/fitness-machine';
export type { CapacitorFitnessMachine } from './ble/fitness-machine';
export type { CapacitorBlePort, PluginDevice, PluginDeviceRequest } from './ble/plugin-port';
export { mayShowDeviceList, permissionNotice } from './permission/notice';
export type { PermissionAction, PermissionNotice } from './permission/notice';
