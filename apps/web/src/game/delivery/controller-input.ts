// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A steering controller's events, as Delivery's intents — #1827, resting on
 * the owner's rulings DL5, DL7 and DL12 (epic #1803). Pure: the HUD's
 * `ControllerIntents` feeds it what `controller-port.ts` delivers and hands
 * what it drains to the round's ports, one frame at a time.
 *
 * ## What maps to what (proposed in #1827's pull request)
 *
 * - **Steer left / steer right** (`0x18`, `0x19`): one lane to the left or the
 *   right per press, the same intents as the lane keys (`steer.ts`). A
 *   release asks for nothing, so a held button is one lane.
 * - **The handlebar angle** (`0x1B`): the lane the bars point at.
 *   {@link SIDE_LANE_DEGREES} or more to a side is that side's lane, and
 *   {@link CENTRE_LANE_DEGREES} or less is the centre lane; between the two
 *   the lane does not change, so bars held near a threshold cannot flick the
 *   rider between lanes. ⚠️ **Discrete lanes, not a proportional offset.**
 *   `lanes.ts` and ADR 0060 D-6.3 hold that a continuous steer needs spike
 *   0030's patent reading (US 11,071,911) re-run first, so the angle selects a
 *   lane and the rider moves to it at the lanes' own pace.
 * - **Power-up 1 / Power-up 2** (`0x50`, `0x51`): throw left, throw right.
 *   The specification's names for a game's action slots; a controller maps
 *   its own buttons to them. One press, one throw.
 * - Everything else is ignored.
 *
 * ## The angle is preferred
 *
 * While the controller reports an angle, its discrete steer buttons ask for
 * nothing: a device may send both for one turn of the bars, and the
 * specification asks an app with the angle to use it. A steer marked
 * `superseded` by the codec, sent beside an angle in one notification, is
 * dropped too. When the device says the angle is gone, the buttons steer
 * again.
 *
 * ## A flood is bounded
 *
 * A device may notify far faster than a frame. Each event is a constant
 * amount of work and the state is a constant size: at most
 * {@link MAX_PENDING} lane steps and {@link MAX_PENDING} throws wait, the
 * rest are dropped, and only the newest angle's lane is kept. A drain hands
 * on at most one lane step, one lane and one throw, so a frame asks the round
 * for no more than a rider's two hands could.
 *
 * ## Nothing here can reach the trainer
 *
 * It imports types only, and its intents are lanes and throws: inside #1807's
 * walk (`delivery-cannot-reach-trainer.test.ts`).
 */

import type { OpenBikeControlEvent } from '@onyourleft/sensors/protocol';

import type { SteerIntent } from './steer';
import type { ThrowIntent } from './throw-input';

/** The buttons that throw: the specification's Power-up 1 and Power-up 2. */
export const CONTROLLER_THROW_BUTTONS: Readonly<Record<number, ThrowIntent>> = Object.freeze({
  0x50: 'left',
  0x51: 'right',
});

/** At or past this many degrees to a side, the bars point at that side's lane. */
export const SIDE_LANE_DEGREES = 10;

/** At or within this many degrees of straight ahead, the bars point at the centre lane. */
export const CENTRE_LANE_DEGREES = 5;

/** The most lane steps, and the most throws, that wait for a frame. */
export const MAX_PENDING = 2;

/** Lane indices into `LANE_OFFSETS_METRES`: left, centre, right. */
const LEFT_LANE = 0;
const CENTRE_LANE = 1;
const RIGHT_LANE = 2;

export interface ControllerInputState {
  /** The lane the bars point at, or `undefined` while the controller reports no angle. */
  readonly angleLane: number | undefined;
  /** A lane the angle asked for that no frame has handed on yet. */
  readonly lane: number | undefined;
  readonly steers: readonly SteerIntent[];
  readonly throws: readonly ThrowIntent[];
}

export const NO_CONTROLLER_INPUT: ControllerInputState = Object.freeze({
  angleLane: undefined,
  lane: undefined,
  steers: Object.freeze([]),
  throws: Object.freeze([]),
});

/**
 * The lane bars at `degrees` point at, given the lane they pointed at before
 * (`undefined` with no angle before). See the module header.
 */
export function laneForAngle(degrees: number, before: number | undefined): number {
  if (degrees <= -SIDE_LANE_DEGREES) return LEFT_LANE;
  if (degrees >= SIDE_LANE_DEGREES) return RIGHT_LANE;
  if (Math.abs(degrees) <= CENTRE_LANE_DEGREES) return CENTRE_LANE;
  return before ?? CENTRE_LANE;
}

const capped = <T>(queue: readonly T[], next: T): readonly T[] =>
  queue.length >= MAX_PENDING ? queue : [...queue, next];

/** Take one notification's events. Constant work per event; the state stays bounded. */
export function takeControllerEvents(
  state: ControllerInputState,
  events: readonly OpenBikeControlEvent[],
): ControllerInputState {
  let { angleLane, lane, steers, throws } = state;
  for (const event of events) {
    switch (event.kind) {
      case 'steering-angle': {
        const next = laneForAngle(event.degrees, angleLane);
        if (next !== angleLane) lane = next;
        angleLane = next;
        break;
      }
      case 'steering-angle-unavailable':
        angleLane = undefined;
        lane = undefined;
        break;
      case 'steer':
        if (event.pressed && !event.superseded && angleLane === undefined) {
          steers = capped(steers, event.direction === 'left' ? 'lane-left' : 'lane-right');
        }
        break;
      case 'button': {
        const intent = Object.hasOwn(CONTROLLER_THROW_BUTTONS, event.button)
          ? CONTROLLER_THROW_BUTTONS[event.button]
          : undefined;
        if (event.pressed && intent !== undefined) throws = capped(throws, intent);
        break;
      }
    }
  }
  return { angleLane, lane, steers, throws };
}

/** What one frame hands the round: at most one of each. */
export interface ControllerIntents {
  readonly steer: SteerIntent | undefined;
  readonly lane: number | undefined;
  readonly parcel: ThrowIntent | undefined;
}

/** Hand on at most one lane step, one lane and one throw; keep the rest for the next frame. */
export function drainControllerIntents(state: ControllerInputState): {
  readonly state: ControllerInputState;
  readonly intents: ControllerIntents;
} {
  const [steer, ...steers] = state.steers;
  const [thrown, ...throws] = state.throws;
  return {
    state: { angleLane: state.angleLane, lane: undefined, steers, throws },
    intents: { steer, lane: state.lane, parcel: thrown },
  };
}

/** Whether anything waits for a frame. */
export function controllerInputWaiting(state: ControllerInputState): boolean {
  return state.lane !== undefined || state.steers.length > 0 || state.throws.length > 0;
}
