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

import { seconds, type Seconds } from '@onyourleft/domain';
import type { PermissionAction, PermissionNotice } from '@onyourleft/mobile';
import type { TransportAvailability } from '@onyourleft/sensors';

import type { ShellNotice, ShellSupport, ShellSupportPort } from './shell-support-port';

/**
 * How long the Devices screen waits for the plugin before it says so (#322).
 *
 * ⚠️ **A bound on a hang, not a performance target** — the same posture
 * `DEFAULT_GATT_OPERATION_TIMEOUT` states in `packages/sensors/web-bluetooth`,
 * and it is the same rule: *"Web Bluetooth also specifies no timeout for any
 * operation"*, so every operation is bounded by the caller. Nothing in the
 * Capacitor plugin's contract bounds `initialize()` either, and #322 is what
 * that costs when the plugin dies without answering.
 *
 * **Why ten and not five or thirty.** The device measurements in #322 are the
 * whole of the justification and they point both ways. A cold start answers
 * effectively immediately, and the hung case was still hung at 45 s — so there
 * is no value of this constant that separates "slow" from "dead" by waiting
 * longer, which is the argument against thirty. Against five: Android's own
 * input-ANR threshold is five seconds, and a first initialisation on a cold
 * adapter is allowed to be slower than the point at which the OS would call an
 * app unresponsive.
 *
 * ⚠️ **Being early costs nothing, and that is what makes ten defensible rather
 * than arbitrary.** {@link useShellSupport} keeps the read alive past the
 * deadline and adopts a late answer, so a rider who spends half a minute
 * reading Android's permission dialog sees this message and then watches it be
 * replaced by the real one. A deadline that could only ever be wrong in the
 * "too slow" direction would have to be generous; this one cannot be wrong in
 * the other direction at all.
 *
 * ⚠️ **It must stay LONGER than `apps/mobile`'s `INITIALIZE_ANSWER_WINDOW`**,
 * which is what makes the re-check offered below a control that can work: the
 * transport has to have stopped sharing the hung `initialize()` before a rider
 * can press the button. `shell-support.test.ts` asserts the ordering, because
 * the two constants are in different packages and nothing else would notice
 * them crossing.
 */
export const SHELL_ANSWER_TIMEOUT: Seconds = seconds(10);

/**
 * What a rider is told when the plugin has not answered (#322).
 *
 * ⚠️ **This wording is HERE and not in `apps/mobile`'s `permissionNotice`**,
 * which is where every other sentence on this screen comes from. That function
 * is total over `TransportAvailability`, and this state is not one of its
 * members — it is the absence of an answer rather than an answer, and it is
 * produced by a deadline this module owns. Putting it there would mean widening
 * a union shared with two transports that cannot produce it; `shell-support-port.ts`
 * §`ShellSupportKind` records that decision in full.
 *
 * The distinction the text has to carry is #322's fourth criterion: *"this
 * phone said no"* and *"this phone did not answer"* are different problems and
 * a rider can act on the second. So the first sentence refuses the accusation
 * — nothing has been refused — before it says what happened.
 *
 * ⚠️ The instruction is **measured rather than plausible.** #322's device run
 * establishes that a cold start resolves and that backgrounding, returning and
 * reloading the page all do not: the one path out is a genuinely new process.
 * "Swipe it away" is the recent-apps gesture, named because "force stop" is a
 * Settings screen and a rider in a garage is not going to find it.
 */
export const UNANSWERED_SHELL_SUPPORT: ShellSupport = {
  kind: 'unanswered',
  // The same rule as every other unusable state: no device list, and no
  // pairing control anywhere near it. `mayShowDeviceList` is not consulted
  // because there is no availability to consult it with.
  canPair: false,
  notice: {
    title: 'This phone has not answered about Bluetooth',
    explanation: `Nothing has been refused. The question went to Android’s Bluetooth service and no reply came back within ${String(SHELL_ANSWER_TIMEOUT)} seconds, which is what happens when the phone has been asleep.`,
    instruction:
      'If checking again does not help, close On Your Left completely — swipe it out of the recent apps list — and open it again. A fresh start answers.',
    // A retry is exactly the right offer here, and it is the one state on this
    // screen where that is true because the rider has changed nothing outside
    // the app: the thing that failed was the asking.
    recoverable: true,
  },
};

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
