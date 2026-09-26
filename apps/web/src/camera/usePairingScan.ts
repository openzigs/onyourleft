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

import { PAIRING_READER_UNAVAILABLE, type CameraController } from './session';

/**
 * How often a code is looked for: about three times a second. A rider moving
 * a phone into view of a screen is found within a third of a second, and each
 * read is a 640-pixel draw on the thread that draws the screen.
 */
export const SCAN_INTERVAL_MILLISECONDS = 300;

/**
 * What a rider is told when the code reader would not load — #550's second
 * review. A fixed sentence: nothing of the failure is read (ADR 0029 D-8).
 *
 * ⚠️ **"Reload", not "try again".** A browser may keep a failed module fetch
 * for the life of the page (whatwg/html#6768; Chromium's change to stop doing
 * so was not confirmed for the pinned engine or the Android WebView), so a
 * second press on the same page could fail without asking the network again.
 * A reload, or closing and reopening the app, starts a new page in every case.
 */
export const PAIRING_READER_UNLOADED =
  'This device could not load what reads the pairing code, so it has stopped looking. Reload ' +
  'the page, or close the app and open it again, then try again.';

/**
 * While `active`, read `controller`'s camera every
 * {@link SCAN_INTERVAL_MILLISECONDS} and hand each code found to `onCode`.
 *
 * One read at a time: a read still in flight when the next tick comes is not
 * joined by a second. `onCode` is read through a ref, so a new function each
 * render does not restart the timer.
 *
 * ⚠️ **A reader that will not load stops the scan** (#550's second review):
 * the timer is cancelled at once and `onUnavailable` is called, once, so the
 * caller can say {@link PAIRING_READER_UNLOADED} and turn off a camera it
 * turned on for the scan. Before, it counted as a read that found nothing,
 * and the screen said "Looking…" for ever with the camera running.
 */
export function usePairingScan(
  controller: CameraController,
  active: boolean,
  onCode: (code: string) => void,
  onUnavailable: () => void,
  every: (tick: () => void, milliseconds: number) => () => void = defaultEvery,
): void {
  const latest = useRef(onCode);
  latest.current = onCode;
  const unavailable = useRef(onUnavailable);
  unavailable.current = onUnavailable;
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
        if (stopped) {
          return;
        }
        if (code === PAIRING_READER_UNAVAILABLE) {
          stopped = true;
          cancel();
          unavailable.current();
        } else if (code !== undefined) {
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
