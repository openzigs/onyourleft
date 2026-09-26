// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **Read the camera for a pairing code a few times a second, while asked
 * to** — #529.
 *
 * Both devices scan: the phone reads the tablet's offer and the tablet reads
 * the phone's answer (ADR 0033 D-1). Each read goes through
 * `session.ts` §`readPairingCode`, which opens nothing and keeps nothing; this
 * hook only decides WHEN, and stops the moment it is not asked to.
 */

import { useEffect, useRef } from 'react';

import type { CameraController } from './session';

/**
 * How often a code is looked for: about three times a second. A rider moving
 * a phone into view of a screen is found within a third of a second, and each
 * read is a 640-pixel draw on the thread that draws the screen.
 */
export const SCAN_INTERVAL_MILLISECONDS = 300;

/**
 * While `active`, read `controller`'s camera every
 * {@link SCAN_INTERVAL_MILLISECONDS} and hand each code found to `onCode`.
 *
 * One read at a time: a read still in flight when the next tick comes is not
 * joined by a second. `onCode` is read through a ref, so a new function each
 * render does not restart the timer.
 */
export function usePairingScan(
  controller: CameraController,
  active: boolean,
  onCode: (code: string) => void,
  every: (tick: () => void, milliseconds: number) => () => void = defaultEvery,
): void {
  const latest = useRef(onCode);
  latest.current = onCode;
  useEffect(() => {
    if (!active) {
      return;
    }
    let reading = false;
    let stopped = false;
    const cancel = every(() => {
      if (reading) {
        return;
      }
      reading = true;
      void controller.readPairingCode().then((code) => {
        reading = false;
        if (!stopped && code !== undefined) {
          latest.current(code);
        }
      });
    }, SCAN_INTERVAL_MILLISECONDS);
    return () => {
      stopped = true;
      cancel();
    };
  }, [active, controller, every]);
}

function defaultEvery(tick: () => void, milliseconds: number): () => void {
  const handle = setInterval(tick, milliseconds);
  return () => {
    clearInterval(handle);
  };
}
