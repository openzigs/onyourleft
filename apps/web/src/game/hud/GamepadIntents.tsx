// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The HUD's Delivery gamepad — #1821.
 *
 * Nothing drawn: while it is mounted it polls the pads once per animation
 * frame through a {@link GamepadPort}, reads each poll with
 * `delivery/gamepad-input.ts` §`readGamepads`, and hands every throw to the
 * ride's {@link ThrowInputPort} and every lane change to its
 * {@link SteerInputPort}, the ports a key reaches (`ThrowControl.tsx`,
 * `SteerKeys.tsx`). There is no new control for the accessibility gate and
 * no new wording.
 *
 * ⚠️ **It polls only while a pad is there.** The first poll is at mount, and
 * a poll that finds no connected pad schedules no next one; a connect or
 * disconnect wakes it (`gamepad-port.ts` §`onConnectionChange`). A ride with
 * no pad pays for one `getGamepads()` call, not one a frame.
 *
 * Mounted only on a ride that hands the HUD a throw or a steer port, which
 * until #1816 is none.
 */

import { useEffect } from 'react';

import { NO_PADS_HELD, readGamepads } from '../delivery/gamepad-input';
import type { SteerInputPort } from '../delivery/steer-port';
import { THROW_INTENTS, type ThrowIntent } from '../delivery/throw-input';
import type { ThrowInputPort } from '../delivery/throw-input-port';
import { navigatorGamepads, type GamepadPort } from '../gamepad-port';

export interface GamepadIntentsProps {
  readonly throwing?: ThrowInputPort | undefined;
  readonly steering?: SteerInputPort | undefined;
  /** The pads to poll. Absent is the platform's, through `window`. */
  readonly pads?: GamepadPort | undefined;
}

const isThrow = (intent: string): intent is ThrowIntent =>
  (THROW_INTENTS as readonly string[]).includes(intent);

/** @see the module header */
export function GamepadIntents(props: GamepadIntentsProps): null {
  const { throwing, steering, pads } = props;
  useEffect(() => {
    const port = pads ?? navigatorGamepads(window);
    let state = NO_PADS_HELD;
    let frame: number | undefined;
    const poll = (): void => {
      frame = undefined;
      const now = port.pads();
      const read = readGamepads(state, now);
      state = read.state;
      for (const intent of read.intents) {
        if (isThrow(intent)) throwing?.throwParcel(intent);
        else steering?.steer(intent);
      }
      if (now.some((pad) => pad?.connected === true)) frame = window.requestAnimationFrame(poll);
    };
    const wake = (): void => {
      if (frame === undefined) frame = window.requestAnimationFrame(poll);
    };
    wake();
    const stop = port.onConnectionChange(wake);
    return () => {
      stop();
      if (frame !== undefined) window.cancelAnimationFrame(frame);
    };
  }, [throwing, steering, pads]);
  return null;
}
