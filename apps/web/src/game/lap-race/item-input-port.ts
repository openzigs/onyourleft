// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What the HUD's item control, its item key and a gamepad hand a lap race —
 * #1901, ADR 0060 D-5.4.
 *
 * ⚠️ **A `*-port.ts` on purpose**, as `delivery/throw-input-port.ts` is:
 * `check:wiring` then requires its one method to have a production caller
 * (§4j, `WIRE003`). `hud/ItemControl.tsx` calls it for a press and for the
 * item key, and `hud/GamepadIntents.tsx` for a pad's button. A ride running a
 * lap race implements it with `race-input.ts` §`askToUseItem`, and the race
 * takes the use on its next tick (#1906).
 *
 * ⚠️ **One method, taking nothing, and it asks to use the held item and
 * nothing else.** No game event may change what the trainer is sent (ADR
 * 0060 D-2.1), so nothing a rider presses to use an item has a way to ask
 * for anything more. Which item, and what it does, are the race's.
 * `race-input.test.ts` holds the interface to this one method.
 */

export interface ItemInputPort {
  /** The rider asked to use the item they hold, by a press on the HUD, a key or a gamepad. */
  useItem(): void;
}
