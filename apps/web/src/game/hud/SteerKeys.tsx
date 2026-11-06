// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The HUD's steering keys — #1820, for a Delivery round and, since #1901, a
 * lap race.
 *
 * Nothing drawn: while it is mounted, a key from a keyboard, or from a
 * Bluetooth remote the system pairs as one, asks for the lane change
 * `lanes.ts` §`STEER_KEYS` maps it to, and the intent goes to the ride's
 * {@link SteerInputPort}. There is no lane button, so there is no new
 * control for the accessibility gate and no new wording.
 *
 * Keys are never stopped by the #1432 touch lock, as the throw keys are not
 * (`ThrowControl.tsx`).
 *
 * Mounted only on a ride that hands the HUD a port: one running a Delivery
 * round (#1853), or a lap race (#1906).
 */

import { useEffect } from 'react';

import { steerIntentOfKey } from '../lanes';
import type { SteerInputPort } from '../steer-port';

export interface SteerKeysProps {
  readonly port: SteerInputPort;
}

/** @see the module header */
export function SteerKeys(props: SteerKeysProps): null {
  const { port } = props;
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const intent = steerIntentOfKey(event);
      if (intent === undefined) return;
      // The key is the steer's now, so no later handler takes it too.
      event.preventDefault();
      port.steer(intent);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [port]);
  return null;
}
