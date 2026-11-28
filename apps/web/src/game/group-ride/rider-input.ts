// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **What the rider can tell the group, as the HUD reads it** — #3307, epic
 * #3296, ADR 0101 D-3.7 and D-6.5: the pull-off press and the sit-in choice,
 * the side a rider pulls off to, and the lane key that asks for it.
 *
 * Apart from `ride-group.ts`, which holds what a press does to the session,
 * so the HUD takes this and brings none of the group's rules, physics or
 * store with it. It imports `lanes.ts` alone, which imports nothing.
 *
 * ## The three inputs are one press
 *
 * The lane key toward {@link GROUP_RIDE_PULL_OFF_SIDE}, the HUD's *Pull off*
 * button and a gamepad's button all call {@link GroupRideRiderInput.pullOff}
 * (`hud/GroupRideControls.tsx`). `GameView` hands the HUD one on a group ride
 * and no other: the press goes to `ride-group.ts` §`pressGroupPullOff`, which
 * takes it only while the rider is on the front.
 *
 * ## Neither can reach the trainer
 *
 * A press is an input to the rotation and to a drawing. Nothing here, and
 * nothing it is handed to, imports a trainer, a port or a transport
 * (ADR 0101 D-6.5, in the manner of ADR 0088 D-5);
 * `group-ride-cannot-reach-trainer.test.tsx` presses both through a ride and
 * holds every write to the unpressed ride's.
 */

import { steerIntentOfKey, type SteerIntent, type SteerKeyEvent } from '../lanes';

/**
 * The side the rider pulls off to: **their left**, one fixed side for the
 * whole of Phase 1 (ADR 0101 D-3.7, Q6), so the lane key is `lanes.ts`
 * §`STEER_KEYS`' **A**. Proposed in #3307's pull request, for the owner.
 */
export const GROUP_RIDE_PULL_OFF_SIDE: SteerIntent = 'lane-left';

/** A group ride's two inputs and what the HUD shows of them, as the ride stands on this frame. */
export interface GroupRideRiderInput {
  /** The rider is on the front, where a pull-off press is taken. */
  readonly onFront: boolean;
  /** The rider has chosen to sit in. */
  readonly sittingIn: boolean;
  /** The rider pressed pull off: a key, the HUD's button or a gamepad. */
  readonly pullOff: () => void;
  /** The rider chose to sit in, or to take their turns again. */
  readonly sitIn: (sittingIn: boolean) => void;
}

/**
 * Whether a key asks to pull off: the lane key toward
 * {@link GROUP_RIDE_PULL_OFF_SIDE}, under `lanes.ts`' discipline for every
 * ride-time key, so never from a form field, never a shortcut, and **never a
 * held key's repeats**.
 */
export function asksToPullOff(event: SteerKeyEvent): boolean {
  return steerIntentOfKey(event) === GROUP_RIDE_PULL_OFF_SIDE;
}
