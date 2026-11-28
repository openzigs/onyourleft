// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The HUD's group-ride controls — #3307, epic #3296, ADR 0101 D-3.7: the
 * **pull-off** press and the **sit-in** choice.
 *
 * ## Pull off: one button, one key
 *
 * A ride-time button, and the page's pull-off key while it is mounted: the
 * lane key toward the pull-off side (`group-ride/rider-input.ts`
 * §`asksToPullOff`: **A**), from a keyboard or from a Bluetooth remote the
 * system pairs as one. Either calls the ride's
 * {@link GroupRideRiderInput.pullOff}; a pad's button reaches the same press
 * through `GamepadIntents.tsx` and {@link pullOffPadPorts}. The button says
 * which side, because the side is fixed and stated on the ride (D-3.7).
 *
 * ## Unavailable off the front
 *
 * A press is taken only while the rider is on the front, and there the button
 * is lit: a 4 px edge in the HUD's ink (#3371, `theme.css`
 * §`.oyl-hud__pull-off`). Anywhere else the button is `aria-disabled`, drawn
 * in the HUD's muted ink with a dashed edge, and described by
 * {@link PULL_OFF_NOT_ON_FRONT_SENTENCE}, a sentence off the screen; a press
 * then asks nothing. `aria-disabled` and not `disabled`, for
 * `ItemControl.tsx`'s reason: it stays in the tab order and says why. The key
 * and a pad are not gated here: the ride refuses a press off the front
 * (`group-ride/ride-group.ts` §`pressGroupPullOff`), and a key pressed as the
 * rider reaches the front reaches a ride the HUD has not drawn yet.
 *
 * ## Sit in: a toggle
 *
 * The design system's toggle (`aria-pressed`, and a fill a sighted rider
 * sees), at the ride-time size. On, the rider is never given the front; off,
 * they take their turn as it comes round. Available at any time in the ride.
 *
 * ## The touch lock stays whole
 *
 * Rendered inside the HUD's locked region and **none of it carries
 * `TOUCH_LOCK_EXEMPT`**: while the lock is on a tap on either is refused like
 * a tap on *Pause*, and the key or a gamepad still pulls off, because the
 * lock stops neither. So while it is on the control says so, in words: plain
 * text in the panel, never a live region (#445).
 *
 * ## Neither can reach the trainer
 *
 * This file imports no trainer, port or transport, and hands the press to a
 * function of the ride's (ADR 0101 D-6.5).
 *
 * Mounted only on a ride that hands the HUD a group ride's input: `GameView`
 * does, on a group ride (`group-ride/group-ride-wiring.test.tsx`).
 */

import { useEffect, useRef, type JSX } from 'react';

import { Button, RIDE_SIZE_CLASS } from '../../design/Button';
import {
  asksToPullOff,
  GROUP_RIDE_PULL_OFF_SIDE,
  type GroupRideRiderInput,
} from '../group-ride/rider-input';
import type { ItemInputPort } from '../lap-race/item-input-port';
import type { SteerInputPort } from '../steer-port';
import { HIDES_ATTRIBUTE } from './controls-reveal';
import { CONTROL_MINIMUM_PIXELS } from './HudCore';

/**
 * What the pull-off button says, and so its accessible name: the press and
 * the side. New rider-facing wording, for the owner's approval in #3307's
 * pull request.
 */
export const PULL_OFF_BUTTON_LABEL = 'Pull off left';

/**
 * Why the button is unavailable, for a screen reader. New rider-facing
 * wording, for the owner's approval in #3307's pull request.
 */
export const PULL_OFF_NOT_ON_FRONT_SENTENCE = 'You are not on the front.';

/**
 * What the control says while the touch lock is on. New rider-facing
 * wording, for the owner's approval in #3307's pull request.
 */
export const PULL_OFF_BY_KEY_SENTENCE =
  'Screen locked: pull off with the A key, a remote or a gamepad.';

/**
 * What the sit-in toggle says, and so its accessible name. New rider-facing
 * wording, for the owner's approval in #3307's pull request.
 */
export const SIT_IN_BUTTON_LABEL = 'Sit in';

/** The id the button's `aria-describedby` names while the lock is on. One HUD per page. */
const NOTE_ID = 'oyl-hud-pull-off-note';

/** The id it names while the rider is not on the front. One HUD per page. */
const NOT_ON_FRONT_ID = 'oyl-hud-pull-off-off-front';

/**
 * A group ride's press as the ports a gamepad reaches (`GamepadIntents.tsx`):
 * a lane change toward the pull-off side, and every button a lap race reads
 * as "use the item", pull off. A lane change the other way asks nothing.
 */
export function pullOffPadPorts(input: Pick<GroupRideRiderInput, 'pullOff'>): {
  readonly steering: SteerInputPort;
  readonly items: ItemInputPort;
} {
  return {
    steering: {
      steer: (intent) => {
        if (intent === GROUP_RIDE_PULL_OFF_SIDE) input.pullOff();
      },
    },
    items: { useItem: input.pullOff },
  };
}

export interface GroupRideControlsProps {
  readonly input: GroupRideRiderInput;
  /** The HUD's touch lock is on. */
  readonly touchLocked: boolean;
}

/** @see the module header */
export function GroupRideControls(props: GroupRideControlsProps): JSX.Element {
  const { input } = props;
  // Through a ref: the ride hands a new input on every frame, and the key's
  // listener is added once.
  const pullOff = useRef(input.pullOff);
  useEffect(() => {
    pullOff.current = input.pullOff;
  });
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (!asksToPullOff(event)) return;
      // The key is the pull-off's now, so no later handler takes it too.
      event.preventDefault();
      pullOff.current();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  const describedBy =
    [input.onFront ? undefined : NOT_ON_FRONT_ID, props.touchLocked ? NOTE_ID : undefined]
      .filter((id) => id !== undefined)
      .join(' ') || undefined;

  return (
    // #2600: both hide with Pause and End ride until touched (`controls-reveal.ts`);
    // `HudCore.tsx` §`controlsHeld` holds them drawn while the rider is on the front.
    <div className="oyl-hud__item" {...{ [HIDES_ATTRIBUTE]: '' }}>
      <button
        type="button"
        className={`oyl-hud__control oyl-hud__pull-off ${RIDE_SIZE_CLASS}`}
        onClick={() => {
          // `aria-disabled` stops no click: the refusal is here.
          if (!input.onFront) return;
          input.pullOff();
        }}
        aria-disabled={input.onFront ? undefined : true}
        aria-describedby={describedBy}
        style={{ minWidth: CONTROL_MINIMUM_PIXELS, minHeight: CONTROL_MINIMUM_PIXELS }}
      >
        {PULL_OFF_BUTTON_LABEL}
      </button>
      {input.onFront ? null : (
        <p id={NOT_ON_FRONT_ID} className="oyl-visually-hidden">
          {PULL_OFF_NOT_ON_FRONT_SENTENCE}
        </p>
      )}
      {props.touchLocked ? (
        <p id={NOTE_ID} className="oyl-hud__item-note">
          {PULL_OFF_BY_KEY_SENTENCE}
        </p>
      ) : null}
      <Button
        variant="toggle"
        size="ride"
        pressed={input.sittingIn}
        onClick={() => {
          input.sitIn(!input.sittingIn);
        }}
      >
        {SIT_IN_BUTTON_LABEL}
      </Button>
    </div>
  );
}
