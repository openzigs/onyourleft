// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What the Devices screen asks **inside the Android shell** (#284).
 *
 * ## Why there is a second question at all
 *
 * `bluetooth-support.ts` answers *"can this browser pair a sensor"* by reading
 * `navigator.bluetooth` and `isSecureContext`. Inside the shell those globals
 * describe a stack the app does not use: `main.tsx` §`isNativeShell` puts the
 * client on `apps/mobile`'s Capacitor transport, so the WebView's own Web
 * Bluetooth answer is about the wrong thing whichever way it comes out. Either
 * the WebView exposes no `navigator.bluetooth` and the screen says *"Sensors
 * cannot be paired in this browser"* while the ride screen pairs a trainer
 * perfectly well, or it exposes one and the screen reports the WebView's
 * answer rather than the plugin's. **Neither is the plugin's answer**, and #48's
 * first criterion — no control or claim that looks like the way in and is not —
 * is broken in prose either way.
 *
 * ## Why the port returns wording rather than an availability
 *
 * The rider-facing wording for each state is `apps/mobile`'s
 * `permission/notice.ts`, written for #87 criterion 8 and tested there. Calling
 * it from a component would mean a **static** import of `@onyourleft/mobile`
 * from a module the browser build renders, and `main.tsx` is careful to reach
 * that package only through an `import()` behind `isNativeShell` so a browser
 * never downloads a line of Capacitor. So the strings are computed on the
 * native side of that dynamic import and travel as data: what this file
 * declares is a screen's worth of already-decided text.
 *
 * ⚠️ **Measured rather than asserted, in `pnpm run build`'s own output.**
 * `permissionNotice`'s wording — "Android asks before an app can talk to
 * sensors…" — appears in the `@onyourleft/mobile` chunk and **not** in the
 * entry chunk. What does reach the entry chunk is `shell-support.ts`'s
 * `INSTRUCTION` map, about 300 bytes of this client's own prose, because the
 * module holding it is what `main.tsx` calls to build the port. That is the
 * honest shape of the split and it is written down here so the next person
 * checks it rather than trusting this paragraph.
 *
 * ⚠️ **This is a `*-port.ts` on purpose, and the cover it buys was measured
 * rather than assumed.** #284 exists because a correct, tested unit had no
 * production caller and the #278 wiring gate could not see it —
 * `availability()` is declared in `packages/sensors`, outside the watched set,
 * and `permission/notice.ts` is in neither watched directory nor named
 * `*-port.ts` (CLAUDE.md §4j). The suffix puts **half** of the new wiring
 * inside the gate, and it is worth knowing which half:
 *
 * - **Caught.** Delete the `ShellDevices` branch from `DevicesView`, so the
 *   screen stops reading this port, and `check:wiring` fails with
 *   `WIRE003 … ShellSupportPort.readShellSupport`. That is the defect #284 is,
 *   and it is now a red gate rather than a review finding.
 * - **Not caught.** Have `main.tsx` return `shell: undefined` from the native
 *   branch, so the screen is handed nothing and silently falls back to the
 *   browser probe: the gate stays **green**. It is the limit that file's
 *   §Limits states third — *"a prop threaded through JSX it does not follow"*,
 *   which is #252's shape — and no suffix here can close it. What stands in its
 *   place is `DevicesView.shell.test.tsx`, which drives the branch, and this
 *   paragraph.
 */

import type { TransportAvailability } from '@onyourleft/sensors';

/** What the shell says about one unusable state. Already worded; just render it. */
export interface ShellNotice {
  /** What happened, not what the rider did wrong. From `permissionNotice`. */
  readonly title: string;
  /** Why, in one sentence, in the rider's terms rather than Android's. */
  readonly explanation: string;
  /**
   * The one thing to do **outside this app**, or `null` when there is none.
   *
   * `null` covers two different cases and both are right: a stack that cannot
   * do Bluetooth at all, where nothing helps; and a state whose only action is
   * to ask again, which the notice's own button already is. Prose telling a
   * rider to press the button beside it is noise.
   */
  readonly instruction: string | null;
  /**
   * Whether asking the plugin again could change the answer.
   *
   * `false` only for a stack with no Bluetooth Low Energy support, where
   * `permissionNotice` deliberately offers no action: *"a retry button here
   * would be an invitation to keep pressing something that cannot work"*.
   */
  readonly recoverable: boolean;
}

/**
 * What the shell can report, which is the plugin's four answers **and one it
 * cannot give** (#322).
 *
 * ⚠️ `unanswered` is not a `TransportAvailability` and deliberately is not one.
 * `availability()` is total over that union — every one of its four members is
 * a thing the stack *said* — and the state this adds is the absence of anything
 * being said at all. It is produced by {@link useShellSupport}'s deadline, not
 * by the plugin, and it exists because the screen it feeds must be able to tell
 * *"this phone said no"* from *"this phone did not answer"*: the first is a
 * verdict and the second is a hang, and only the second is worth retrying for
 * the reason a retry exists.
 *
 * ⚠️ **Widening `TransportAvailability` instead was considered and rejected.**
 * That union is shared with the Web Bluetooth transport and the simulator, and
 * a fifth member there would force a branch through `supportFor`,
 * `BluetoothSupportNotice` and `simulator.ts` for a state none of the three can
 * reach, because nothing in `packages/sensors/web-bluetooth` is bounded either.
 * The hang this fixes is the shell's, so the vocabulary for it is the shell's.
 */
export type ShellSupportKind = TransportAvailability['kind'] | 'unanswered';

/** The plugin's answer, and what to tell the rider about it. */
export interface ShellSupport {
  readonly kind: ShellSupportKind;
  /**
   * Whether a device list may be shown at all — `mayShowDeviceList`.
   *
   * The same rule `BluetoothSupport.canPair` states for a browser: `false`
   * means render no pairing control, not a disabled one.
   */
  readonly canPair: boolean;
  /** `null` when everything works, which is the only state with nothing to say. */
  readonly notice: ShellNotice | null;
}

/** The Devices screen's one native read. */
export interface ShellSupportPort {
  /**
   * Ask the plugin, now.
   *
   * ⚠️ On Android this is the call that **prompts for the runtime permission**:
   * `availability()` initialises the plugin first, and `plugin-port.ts` records
   * that initialisation is where a denial surfaces. That is deliberate — the
   * Devices screen is where a rider goes to find out whether their sensors can
   * work, and a screen that reported "not permitted" without ever having asked
   * would be describing a state it created.
   *
   * Never rejects. `SensorTransport.availability` is total over
   * `TransportAvailability` — the Capacitor implementation catches an
   * initialisation failure and an `isEnabled()` rejection and returns a kind
   * for each — so a caller has no error path to render.
   *
   * ⚠️ **And it may never SETTLE, which is a different thing and is
   * [#322](https://github.com/openzigs/onyourleft/issues/322).** On a device
   * that had slept, `@capacitor-community/bluetooth-le` ran `runInitialization`
   * with a null `PluginCall`, threw, and therefore resolved nothing: the
   * outbound bridge call was the last line in logcat mentioning its callback
   * id. A promise nobody settles is indistinguishable from a slow one, so
   * *"never rejects"* is no comfort at all to the screen — it sat on "Checking:
   * Asking this phone about Bluetooth" at 0 s, 5 s, 15 s, 30 s and 45 s with no
   * timeout, no error state and no way forward.
   *
   * **Nothing here is bounded, on purpose.** The deadline belongs to
   * {@link useShellSupport} rather than to this method, for two reasons that
   * are both about the rider: a late answer must still be adopted when it
   * finally arrives — the first `initialize()` on Android is the one that
   * raises the permission dialog, and a rider reading that dialog is not a hang
   * — and the bound has to be re-evaluated when the screen comes back, which is
   * a lifecycle event a promise cannot see. `shell-support.ts`
   * §`SHELL_ANSWER_TIMEOUT` is the number and the reasoning.
   */
  readShellSupport(): Promise<ShellSupport>;
}
