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
 * ⚠️ **What is held survives a re-render.** The held buttons live in a ref,
 * and the ports are read through refs, so a ride that hands the HUD a new
 * port object on each render neither restarts the polling nor forgets a
 * held button and throws it again.
 *
 * ⚠️ **In the Android shell it also reads the numbered buttons
 * `MainActivity` forwards** (#1858): the platform port is built with
 * `support/capacitor.ts` §`isNativeShell`, so a generic pad, whose buttons
 * the WebView drops, can throw as well as steer (`gamepad-port.ts`). In a
 * browser nothing changes.
 *
 * Gamepad input deliberately bypasses the #1432 touch lock, as keys do,
 * under ADR 0059 D-5.
 *
 * Mounted only on a ride that hands the HUD a throw or a steer port, which
 * until #1816 is none.
 */

import { useEffect, useRef } from 'react';

import { NO_PADS_HELD, readGamepads } from '../delivery/gamepad-input';
import type { SteerInputPort } from '../delivery/steer-port';
import { THROW_INTENTS, type ThrowIntent } from '../delivery/throw-input';
import type { ThrowInputPort } from '../delivery/throw-input-port';
import { isNativeShell, platformCapacitor } from '../../support/capacitor';
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
  const held = useRef(NO_PADS_HELD);
  const throwingRef = useRef(throwing);
  const steeringRef = useRef(steering);
  const padsRef = useRef(pads);
  useEffect(() => {
    throwingRef.current = throwing;
    steeringRef.current = steering;
    padsRef.current = pads;
  });
  useEffect(() => {
    const platform = navigatorGamepads(window, isNativeShell(platformCapacitor()));
    let frame: number | undefined;
    const poll = (): void => {
      frame = undefined;
      const now = (padsRef.current ?? platform).pads();
      const read = readGamepads(held.current, now);
      held.current = read.state;
      for (const intent of read.intents) {
        if (isThrow(intent)) throwingRef.current?.throwParcel(intent);
        else steeringRef.current?.steer(intent);
      }
      if (now.some((pad) => pad?.connected === true)) frame = window.requestAnimationFrame(poll);
    };
    const wake = (): void => {
      if (frame === undefined) frame = window.requestAnimationFrame(poll);
    };
    wake();
    const stop = (padsRef.current ?? platform).onConnectionChange(wake);
    return () => {
      stop();
      if (frame !== undefined) window.cancelAnimationFrame(frame);
    };
  }, []);
  return null;
}
