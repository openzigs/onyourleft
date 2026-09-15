// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The Android shell's own Bluetooth answer, as the Devices screen needs it
 * (#284).
 *
 * Three units #87 built and nothing shipped are joined here, which is the whole
 * of this module: the plugin's `availability()`, the wording `permissionNotice`
 * already carries for each of its outcomes, and `mayShowDeviceList`'s rule
 * about when a list may be rendered at all.
 *
 * ## Why the three arrive as parameters
 *
 * The same reason `ride/trainer.ts` §`openCapacitorTrainer` takes its plugin
 * calls as parameters: `main.tsx` reaches `@onyourleft/mobile` through an
 * `import()` behind `isNativeShell`, so a browser downloads no Capacitor — and
 * a module that named the package statically would undo that for every visitor.
 * Injection also makes every state below reachable from a test on a machine
 * that is not a phone, which is the only way #87's four outcomes were ever
 * going to be checked.
 *
 * ## Why this is not a second shape of `BluetoothSupportNotice`
 *
 * #284 leaves that open and this is the answer. Every branch of the browser
 * notice is *about browsers* — Safari and Firefox's published positions,
 * `chrome://flags`, "open this app in Chrome" — and none of it is true on a
 * phone running the shell, where the browser is not the thing that decides.
 * Its working-path list is wrong there too: it promises "one press per device",
 * which is Web Bluetooth's user-activation rule and not Android's
 * (`ANDROID_TRAITS.requiresUserGestureToDiscover` is `false`). Reusing the
 * component would mean widening every branch with a platform conditional, so
 * the shell gets a component of its own and shares the *screen*, not the copy.
 */

import type { PermissionAction, PermissionNotice } from '@onyourleft/mobile';
import type { TransportAvailability } from '@onyourleft/sensors';

import type { ShellNotice, ShellSupport, ShellSupportPort } from './shell-support-port';

/**
 * What {@link capacitorShellSupport} needs from the Android shell.
 *
 * All three are `apps/mobile`'s, passed rather than imported. `availability` is
 * the transport's own method — the **same** transport the ride screen pairs
 * through, so the plugin is initialised once per app rather than once per
 * screen, and a permission granted from here is granted for pairing too.
 */
export interface ShellSupportSource {
  readonly availability: () => Promise<TransportAvailability>;
  readonly notice: (availability: TransportAvailability) => PermissionNotice | null;
  readonly mayShowDeviceList: (availability: TransportAvailability) => boolean;
}

/**
 * What to do **outside this app** for each action a notice can carry.
 *
 * `null` where the answer is "press the button beside this sentence": prose
 * repeating a control is noise, and the control is the honest form of it.
 *
 * ⚠️ Total over `PermissionAction['kind']` rather than defaulting, and `retry`
 * is the branch no notice produces today. `bluetooth-support.ts` §`supportFor`
 * keeps its own unreachable branch for the same reason and says it plainly: a
 * mapping that is wrong in a state nobody can currently reach is a mapping that
 * is wrong the day somebody reaches it, and `undefined` rendered at a rider is
 * what a partial one produces.
 *
 * ⚠️ These sentences name **Android's** settings, and are ours rather than the
 * plugin's: a platform's own error text can carry a device address or a
 * neighbour's advertised name, which `SensorError` bars from reaching an
 * athlete.
 */
const INSTRUCTION: Record<PermissionAction['kind'], string | null> = {
  'open-settings':
    'Open Settings on this phone, find On Your Left in the app list, and allow Nearby devices. Then check again.',
  'open-bluetooth-settings':
    'Switch Bluetooth on — in Android’s quick settings, or in Settings under Connected devices. Then check again.',
  retry: null,
};

/**
 * One availability, as a screen's worth of already-decided text.
 *
 * ⚠️ **Deliberately not exported**, and it was exported until #284's review —
 * a reader who remembers reaching it from outside is reading the old file. The
 * reason given was "so that the mapping is reachable without a port", and
 * nothing reached it that way: not a caller, not a test. That is an export
 * whose only caller is its own file, which is the shape #284 exists to remove
 * one of. `check-wiring.mjs` watches ports rather than modules and is silent
 * here, so the answer is to stop declaring a seam nobody uses rather than to
 * widen the gate. {@link capacitorShellSupport} is the way in, and
 * `shell-support.test.ts` goes through it.
 */
function shellSupportFrom(
  availability: TransportAvailability,
  notice: PermissionNotice | null,
  canPair: boolean,
): ShellSupport {
  return { kind: availability.kind, canPair, notice: shellNotice(notice) };
}

function shellNotice(notice: PermissionNotice | null): ShellNotice | null {
  if (notice === null) {
    return null;
  }
  return {
    title: notice.title,
    explanation: notice.explanation,
    instruction: notice.action === null ? null : INSTRUCTION[notice.action.kind],
    // ⚠️ Derived from the action rather than from the kind, deliberately.
    // `permissionNotice` already decides this and says why: an absent action
    // means *"nothing the rider does changes this, and a retry button here
    // would be an invitation to keep pressing something that cannot work"*. A
    // second list of recoverable kinds here could disagree with that one, and
    // the disagreement would be a button on a screen it was removed from.
    recoverable: notice.action !== null,
  };
}

/** {@link ShellSupportPort}, over the Capacitor transport. */
export function capacitorShellSupport(source: ShellSupportSource): ShellSupportPort {
  return {
    async readShellSupport(): Promise<ShellSupport> {
      // ⚠️ Read every time rather than memoised. The two states a rider can fix
      // are fixed **outside this app** — a permission granted in Settings, a
      // radio switched on — so there is no event to wait for and a cached
      // answer would survive the fix. `ensureInitialized` in the transport
      // already makes the expensive half of this idempotent.
      const availability = await source.availability();
      return shellSupportFrom(
        availability,
        source.notice(availability),
        source.mayShowDeviceList(availability),
      );
    },
  };
}
