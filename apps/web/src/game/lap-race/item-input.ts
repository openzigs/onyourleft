// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * How a rider asks to use the lap race's held item — #1901, ADR 0060 D-5.4
 * and D-13.
 *
 * ## One intent, and it is an input to the race only
 *
 * A key, a press on the HUD's item control (`hud/ItemControl.tsx`) or a
 * gamepad's button asks for {@link ITEM_INTENT}: use the item the rider
 * holds. That is all it can ask for. What the item does is the race's
 * (`@onyourleft/domain` §`stepRace`, from the inputs a tick takes: D-5.4,
 * "clients send inputs, never outcomes"), and none of it reaches the trainer
 * (ADR 0060 D-2.1): this is `delivery/throw-input-port.ts`' precedent, and
 * `lap-race-cannot-reach-trainer.test.ts` walks this module.
 *
 * ## The key: proposed for the owner
 *
 * {@link ITEM_KEYS}: **W**, the key above the lane keys A and D, so a
 * keyboard rider's left hand has all three; by its physical key too
 * ({@link ITEM_CODES}), for a layout where it types something else. It is
 * not a lane key (`lanes.ts` §`STEER_KEYS`), not one of Delivery's throw keys
 * (`delivery/throw-input.ts` §`THROW_KEYS`), and not Enter or Space, for
 * `throw-input.ts`' reason: a tap on a HUD button usually leaves it focused,
 * and Enter or Space then presses it. ⚠️ **Which keys a given bar remote
 * sends is unmeasured**: the tablet step for #733 is where it is written
 * down.
 *
 * The key is read with `lanes.ts` §`intentOfKeyIn`, the lane keys' own
 * discipline: never from a form field, never with Ctrl, Alt or Meta held,
 * never one a handler already took, and never a held key's repeats — a held
 * key uses one item.
 *
 * ⚠️ **It imports only `lanes.ts`, which imports nothing**, for
 * `throw-input.ts`' reason: the HUD imports this module for its key.
 *
 * ## The touch lock is not this module's
 *
 * Keys are never stopped by the #1432 lock, and a tap on the item control is
 * refused like any other: no item control carries `TOUCH_LOCK_EXEMPT` (ADR
 * 0060 D-13). That is the HUD's, and `HudPanel.items.test.tsx`'s.
 */

import { intentOfKeyIn, type SteerKeyEvent } from '../lanes';

/** The one thing an item input asks for. */
export const ITEM_INTENT = 'use-item';

/** Use the item the rider holds. */
export type ItemIntent = typeof ITEM_INTENT;

/** The item key, by `KeyboardEvent.key`, both cases. Proposed in #1901's pull request. */
export const ITEM_KEYS: Readonly<Record<string, ItemIntent>> = Object.freeze({
  w: ITEM_INTENT,
  W: ITEM_INTENT,
});

/** The item key by `KeyboardEvent.code`, read only when {@link ITEM_KEYS} has no entry for the `key`. */
export const ITEM_CODES: Readonly<Record<string, ItemIntent>> = Object.freeze({
  KeyW: ITEM_INTENT,
});

/** Whether a key asks to use the held item: {@link intentOfKeyIn} over the item key. */
export function asksForItem(event: SteerKeyEvent): boolean {
  return intentOfKeyIn(event, ITEM_KEYS, ITEM_CODES) !== undefined;
}
