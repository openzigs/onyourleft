// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The HUD's gamepad — #1821, for a Delivery round and, since #1901, a lap
 * race.
 *
 * Nothing drawn: while it is mounted it polls the pads once per animation
 * frame through a {@link GamepadPort}, reads each poll with
 * `delivery/gamepad-input.ts` §`readGamepads`, and hands every throw to the
 * ride's {@link ThrowInputPort} and every lane change to its
 * {@link SteerInputPort}, the ports a key reaches (`ThrowControl.tsx`,
 * `SteerKeys.tsx`). There is no new control for the accessibility gate and
 * no new wording.
 *
 * ## In a lap race, a throw button uses the item (#1901)
 *
 * A lap race has no throws, and its one press is "use the held item"
 * (`lap-race/item-input-port.ts`). So on a ride that hands the HUD an
 * {@link ItemInputPort}, every button `gamepad-input.ts` reads as a throw —
 * a standard pad's A, B and X, and the shell's numbered 2, 3 and 4 — asks
 * to use the item instead, and the lanes are the same d-pad and stick as a
 * round's. Every face button rather than one, because the numbering of a
 * generic pad is its maker's (#1892), and a rider reaching for any of them
 * means the one press the race has. Proposed in #1901's pull request, for the
 * owner. No ride hands the HUD both a throw and an item port: a Delivery
 * round is not a lap race.
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
 * Mounted only on a ride that hands the HUD a throw, a steer or an item
 * port: `GameView` hands the first two on a Delivery round (#1816, #1853),
 * and `delivery-wiring.test.tsx` rides one with a pad; a lap race hands the
 * last two (#1906).
 */

import { useEffect, useRef } from 'react';

import { NO_PADS_HELD, readGamepads } from '../delivery/gamepad-input';
import { THROW_INTENTS, type ThrowIntent } from '../delivery/throw-input';
import type { ThrowInputPort } from '../delivery/throw-input-port';
import { isNativeShell, platformCapacitor } from '../../support/capacitor';
import { navigatorGamepads, type GamepadPort } from '../gamepad-port';
import type { ItemInputPort } from '../lap-race/item-input-port';
import type { SteerInputPort } from '../steer-port';

export interface GamepadIntentsProps {
  readonly throwing?: ThrowInputPort | undefined;
  readonly steering?: SteerInputPort | undefined;
  /** A lap race's item use: a throw button asks for it. @see the module header */
  readonly items?: ItemInputPort | undefined;
  /** The pads to poll. Absent is the platform's, through `window`. */
  readonly pads?: GamepadPort | undefined;
}

const isThrow = (intent: string): intent is ThrowIntent =>
  (THROW_INTENTS as readonly string[]).includes(intent);

/** @see the module header */
export function GamepadIntents(props: GamepadIntentsProps): null {
  const { throwing, steering, items, pads } = props;
  const held = useRef(NO_PADS_HELD);
  const throwingRef = useRef(throwing);
  const steeringRef = useRef(steering);
  const itemsRef = useRef(items);
  const padsRef = useRef(pads);
  useEffect(() => {
    throwingRef.current = throwing;
    steeringRef.current = steering;
    itemsRef.current = items;
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
        if (isThrow(intent)) {
          throwingRef.current?.throwParcel(intent);
          itemsRef.current?.useItem();
        } else steeringRef.current?.steer(intent);
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
