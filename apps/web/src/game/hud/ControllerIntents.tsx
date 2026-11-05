// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A paired steering controller's lane changes, lanes and throws, handed to a
 * Delivery round's ports — #1827. Draws nothing.
 *
 * It listens on the game's `controller-port.ts` while it is mounted, which
 * `HudCore` does only on a ride that hands the HUD a round's ports and a
 * controller: never in a room, where no round runs (DL9). Each notification
 * is taken by `delivery/controller-input.ts`, and what waits is handed on
 * once an animation frame, at most one lane step, one lane and one throw a
 * frame. So a controller that floods the link cannot ask the round for more
 * than a frame's worth, and the frame is the HUD's own, not the ride's tick.
 *
 * The ports are the same ones the keys and a gamepad reach: a throw goes
 * through `throw-input-port.ts`, a lane step through `steer-port.ts`, and the
 * angle's lane through `delivery/lane-input-port.ts`. None of them, nor this,
 * can reach the trainer.
 */

import { useEffect, useRef } from 'react';

import type { ControllerPort } from '../delivery/controller-port';
import {
  controllerInputWaiting,
  drainControllerIntents,
  NO_CONTROLLER_INPUT,
  takeControllerEvents,
} from '../delivery/controller-input';
import type { LaneInputPort } from '../delivery/lane-input-port';
import type { ThrowInputPort } from '../delivery/throw-input-port';
import type { SteerInputPort } from '../steer-port';

export interface ControllerIntentsProps {
  readonly controller: ControllerPort;
  readonly throwing?: ThrowInputPort | undefined;
  readonly steering?: SteerInputPort | undefined;
  readonly lanes?: LaneInputPort | undefined;
}

/** @see the module header */
export function ControllerIntents(props: ControllerIntentsProps): null {
  const { controller, throwing, steering, lanes } = props;
  const ports = useRef({ throwing, steering, lanes });
  useEffect(() => {
    ports.current = { throwing, steering, lanes };
  });
  useEffect(() => {
    let state = NO_CONTROLLER_INPUT;
    let frame: number | undefined;
    const handOn = (): void => {
      frame = undefined;
      const drained = drainControllerIntents(state);
      state = drained.state;
      const { intents } = drained;
      if (intents.lane !== undefined) ports.current.lanes?.steerToLane(intents.lane);
      if (intents.steer !== undefined) ports.current.steering?.steer(intents.steer);
      if (intents.parcel !== undefined) ports.current.throwing?.throwParcel(intents.parcel);
      if (controllerInputWaiting(state)) frame = window.requestAnimationFrame(handOn);
    };
    const stop = controller.onControllerEvents((events) => {
      state = takeControllerEvents(state, events);
      if (frame === undefined && controllerInputWaiting(state)) {
        frame = window.requestAnimationFrame(handOn);
      }
    });
    return () => {
      stop();
      if (frame !== undefined) window.cancelAnimationFrame(frame);
    };
  }, [controller]);
  return null;
}
