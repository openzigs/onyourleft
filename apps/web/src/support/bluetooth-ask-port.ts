// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **Whether this rider has already been told why Android asks for Bluetooth**
 * — [#1436](https://github.com/openzigs/onyourleft/issues/1436).
 *
 * Inside the Android shell the Devices screen's first read is the call that
 * raises Android's permission dialog (`shell-support-port.ts`
 * §`readShellSupport`). Until #1436 that read ran the moment the screen opened,
 * so a rider who tapped *Devices* met Android's Nearby devices dialog with no
 * word from this app first. Now the screen says why, once, and asks when the
 * rider presses to look for their devices. This remembers that they have, so a
 * rider who has answered is not walked through it again on every visit.
 *
 * ## Why this is a `*-port.ts`
 *
 * docs/agents/wiring-gate.md §4j: `WIRE003` holds both methods to a production
 * caller (`views/DevicesView.tsx`). ⚠️ The provider half is the §Limits case:
 * `main.tsx` passes it as an optional prop, and dropping that line is green in
 * the gate — the screen then reads on open, as it did before #1436.
 */

export interface BluetoothAskPort {
  /** The rider has pressed through the explanation before, on this device. */
  askedBefore(): boolean;
  /** Remember that they have. Never throws. */
  noteAsked(): void;
}
