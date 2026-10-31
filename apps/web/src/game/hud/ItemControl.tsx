// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The HUD's lap-race item control — #1901, ADR 0060 D-13.
 *
 * One ride-time button, and the page's item key while it is mounted: a key
 * from a keyboard, or from a Bluetooth remote the system pairs as one, asks
 * to use the held item (`lap-race/item-input.ts` §`ITEM_KEYS`). Either hands
 * the ask to the race's {@link ItemInputPort}; a pad's button reaches the same
 * port through `GamepadIntents.tsx`. Which item is held, and what it does, are
 * the race's: the button says the same thing with or without one, and #1904
 * shows the held item.
 *
 * ## The touch lock stays whole (ADR 0060 D-13)
 *
 * Rendered inside the HUD's locked region, as Delivery's throw control is,
 * and **none of it carries `TOUCH_LOCK_EXEMPT`**: while the lock is on, a tap
 * on the button is refused like a tap on *Pause*, and the item key or a
 * gamepad still uses the item, because the lock stops neither. So while it is
 * on the control says, in words, that items come by key, remote or gamepad.
 * That sentence is plain text in the panel, never a live region: the HUD's one
 * region is the announcer's (#445).
 *
 * ⚠️ The button is not `disabled` while locked: a disabled button cannot be
 * focused or pressed with Enter either, and the lock lets keys through on
 * purpose (WCAG 2.2 SC 2.1.1).
 *
 * **Item use is its own control, apart from steering** (D-13.3): there is no
 * drag that both steers and aims, and the lanes have no button here.
 *
 * Mounted only on a ride that hands the HUD an item port: one running a lap
 * race (#1906).
 */

import { useEffect, type JSX } from 'react';

import { RIDE_SIZE_CLASS } from '../../design/Button';
import { asksForItem } from '../lap-race/item-input';
import type { ItemInputPort } from '../lap-race/item-input-port';
import { CONTROL_MINIMUM_PIXELS } from './HudCore';

/**
 * What the button says, and so its accessible name. New rider-facing
 * wording, for the owner's approval in #1901's pull request.
 */
export const ITEM_BUTTON_LABEL = 'Use item';

/**
 * What the control says while the touch lock is on. New rider-facing
 * wording, for the owner's approval in #1901's pull request.
 */
export const ITEM_BY_KEY_SENTENCE = 'Screen locked: use items with a key, a remote or a gamepad.';

/** The id the button's `aria-describedby` names while the lock is on. One HUD per page. */
const NOTE_ID = 'oyl-hud-item-note';

export interface ItemControlProps {
  readonly port: ItemInputPort;
  /** The HUD's touch lock is on. */
  readonly touchLocked: boolean;
}

/** @see the module header */
export function ItemControl(props: ItemControlProps): JSX.Element {
  const { port } = props;
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (!asksForItem(event)) return;
      // The key is the item's now, so no later handler takes it too.
      event.preventDefault();
      port.useItem();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [port]);

  return (
    <div className="oyl-hud__item">
      <button
        type="button"
        className={`oyl-hud__control ${RIDE_SIZE_CLASS}`}
        onClick={() => {
          port.useItem();
        }}
        aria-describedby={props.touchLocked ? NOTE_ID : undefined}
        style={{ minWidth: CONTROL_MINIMUM_PIXELS, minHeight: CONTROL_MINIMUM_PIXELS }}
      >
        {ITEM_BUTTON_LABEL}
      </button>
      {props.touchLocked ? (
        <p id={NOTE_ID} className="oyl-hud__item-note">
          {ITEM_BY_KEY_SENTENCE}
        </p>
      ) : null}
    </div>
  );
}
