// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The Android shell's ride controller — the one that keeps the process
 * alive** ([#524](https://github.com/openzigs/onyourleft/issues/524)).
 *
 * ## Why this is a module and not four lines in `main.tsx`
 *
 * `keepAlive` and `notificationPermission` are OPTIONAL options on
 * `createRideController`, because a browser has neither. An optional option
 * nobody supplies is the third entry in `check-wiring.mjs` §Limits, and
 * `main.tsx` has no test harness: until this module, a `main.tsx` that stopped
 * handing the Android controller its foreground service was green in
 * `check:wiring` and in every test — which is #524's own defect, one line
 * further up. So the shell's controller is built HERE, where both halves are
 * held:
 *
 * - **`check:wiring`** watches `ride/`, so a `main.tsx` that stopped calling
 *   {@link createShellRideController} is a red `WIRE001` on this file (measured).
 * - **`shell-ride-controller.test.ts`** drives the controller this builds,
 *   through the REAL `@onyourleft/mobile` adapters, down to a scripted
 *   `RecordingServicePlugin`, and reads that a ride's start and stop reach the
 *   plugin's `start` and `stop`.
 *
 * What neither can see is `main.tsx` calling this on the browser path instead
 * of the shell's, or not at all behind a branch that is never taken; the shell
 * branch is `isNativeShell`, which the browser gate cannot enter. That residue
 * is validation 0002 A5, on a phone.
 *
 * ## Why the mobile module is a parameter
 *
 * `main.tsx` reaches `@onyourleft/mobile` only through an `import()` behind
 * `isNativeShell`, so a browser downloads no line of Capacitor
 * (`camera/shell-camera.test.ts` §"a browser downloads no line of Capacitor").
 * A static import here would undo that for every visitor. The TYPE is named,
 * which the compiler erases; the functions arrive as the loaded module.
 */

import type * as Mobile from '@onyourleft/mobile';

import {
  createRideController,
  type RideController,
  type RideControllerOptions,
} from './controller';

/** The three things the shell's controller needs from `@onyourleft/mobile`. */
export type ShellRecordingService = Pick<
  typeof Mobile,
  | 'capacitorRecordingServicePlugin'
  | 'recordingServiceKeepAlive'
  | 'recordingServiceNotificationPermission'
>;

/**
 * The ride controller inside the Android shell: `options` plus the
 * `connectedDevice` foreground service (#524) and the notification permission
 * its notification needs (#526), both over ONE `RecordingService` plugin.
 *
 * The two are set after the spread, so nothing in `options` can replace them.
 */
export function createShellRideController(
  mobile: ShellRecordingService,
  options: Omit<RideControllerOptions, 'keepAlive' | 'notificationPermission'>,
): RideController {
  const recordingService = mobile.capacitorRecordingServicePlugin();
  return createRideController({
    ...options,
    keepAlive: mobile.recordingServiceKeepAlive(recordingService),
    notificationPermission: mobile.recordingServiceNotificationPermission(recordingService),
  });
}
