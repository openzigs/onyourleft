// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The HUD's Delivery throw control — #1810, ADR 0059 D-5.
 *
 * Three ride-time buttons, one for each of `throw-input.ts`
 * §`THROW_INTENTS`, and the page's keys while it is mounted: a key from a
 * keyboard, or from a Bluetooth remote or ring the system pairs as one, asks
 * for the throw `throw-input.ts` §`THROW_KEYS` maps it to. Either hands the
 * intent to the ride's {@link ThrowInputPort}.
 *
 * ## The touch lock stays whole
 *
 * Rendered inside the HUD's locked region, and **none of it carries
 * `TOUCH_LOCK_EXEMPT`** (DL4): while the lock is on, a tap on a throw button
 * is refused like a tap on *Pause*, and a key still throws, because the lock
 * stops no key. So while it is on the control says, in words, that throws
 * come by key or remote. That sentence is plain text in the panel, never a
 * live region: the HUD's one region is the announcer's (#445).
 *
 * ⚠️ The buttons are not `disabled` while locked: a disabled button cannot be
 * focused or pressed with Enter either, and the lock lets keys through on
 * purpose (WCAG 2.2 SC 2.1.1).
 *
 * Mounted only on a ride that hands the HUD a port, which until #1816 is none.
 */

import { useEffect, type JSX } from 'react';

import { RIDE_SIZE_CLASS } from '../../design/Button';
import type { ThrowInputPort } from '../delivery/throw-input-port';
import { intentOfKey, type ThrowIntent } from '../delivery/throw-input';
import { CONTROL_MINIMUM_PIXELS } from './HudCore';

/** The throw control's accessible name, as a group. */
export const THROW_CONTROL_NAME = 'Throw a parcel';

/** What each button says, in the order they stand: left, toward the next house, right. */
export const THROW_BUTTONS: readonly { readonly intent: ThrowIntent; readonly label: string }[] = [
  { intent: 'left', label: 'Left' },
  { intent: 'next-house', label: 'Next house' },
  { intent: 'right', label: 'Right' },
];

/**
 * What the control says while the touch lock is on. New rider-facing wording,
 * for the owner's approval in #1810's pull request.
 */
export const THROW_BY_KEY_SENTENCE = 'Screen locked: throw with a key or a remote.';

/** The id the buttons' `aria-describedby` names while the lock is on. One HUD per page. */
const NOTE_ID = 'oyl-hud-throw-note';

export interface ThrowControlProps {
  readonly port: ThrowInputPort;
  /** The HUD's touch lock is on. */
  readonly touchLocked: boolean;
}

/** @see the module header */
export function ThrowControl(props: ThrowControlProps): JSX.Element {
  const { port } = props;
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const intent = intentOfKey(event);
      if (intent === undefined) return;
      // The key is the throw's now: the arrows and Page Up or Down would
      // otherwise also scroll the ride screen.
      event.preventDefault();
      port.throwParcel(intent);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [port]);

  return (
    <div className="oyl-hud__throws">
      <div role="group" aria-label={THROW_CONTROL_NAME} className="oyl-hud__throw-buttons">
        {THROW_BUTTONS.map((each) => (
          <button
            key={each.intent}
            type="button"
            className={`oyl-hud__control ${RIDE_SIZE_CLASS}`}
            onClick={() => {
              port.throwParcel(each.intent);
            }}
            aria-describedby={props.touchLocked ? NOTE_ID : undefined}
            style={{ minWidth: CONTROL_MINIMUM_PIXELS, minHeight: CONTROL_MINIMUM_PIXELS }}
          >
            {each.label}
          </button>
        ))}
      </div>
      {props.touchLocked ? (
        <p id={NOTE_ID} className="oyl-hud__throw-note">
          {THROW_BY_KEY_SENTENCE}
        </p>
      ) : null}
    </div>
  );
}
