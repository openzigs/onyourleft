// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What Android's back does on a screen with a ride on it — #2349.
 *
 * `android-back.ts` consumes a back press while a ride is on, and until #2349
 * did nothing else with it: what back should do there was left for the owner
 * (#1512's lane scope). #2349 is that ruling — *"leaving mid-ride … never ends
 * the ride on one press. It asks"*, and *"Escape or Back means keep riding"*.
 * So on the two screens a ride is ended from, the Ride screen and the game's
 * stage, back is the end-of-ride question's own key: it OPENS the question
 * when it is closed, and is *Keep riding* when it is open. It never answers
 * *Save ride* or *Discard ride*, and never leaves the ride.
 *
 * Elsewhere mid-ride (Activities while a recording runs, say) no surface has
 * registered, and back is consumed as before: it never ends, pauses or leaves
 * a ride.
 *
 * A context rather than a module-level variable, so each `AppShell` — and
 * each test's — has its own, and a screen that is not under a shell (a test
 * rendering `RideView` alone) registers with nothing.
 */

import { createContext, useContext, useEffect, useEffectEvent } from 'react';

/** Where the ride screen on show hands its back press. */
export interface RideBack {
  /**
   * Take back presses until the returned call. The latest registration wins,
   * and the one before it is answered again once that goes.
   */
  register(handler: () => void): () => void;
  /** Hand one press to the latest registration. @returns whether one took it. */
  press(): boolean;
}

/** A fresh one, for one shell. */
export function rideBack(): RideBack {
  const handlers: (() => void)[] = [];
  return {
    register(handler) {
      const mine = (): void => {
        handler();
      };
      handlers.push(mine);
      return () => {
        const at = handlers.lastIndexOf(mine);
        if (at >= 0) handlers.splice(at, 1);
      };
    },
    press() {
      const handler = handlers.at(-1);
      if (handler === undefined) return false;
      handler();
      return true;
    },
  };
}

/** The shell's, or `undefined` outside one. */
export const RideBackContext = createContext<RideBack | undefined>(undefined);

/**
 * Take the shell's back presses while `active` — a ride on this screen. The
 * handler is read at each press, so it always sees the question as it is.
 */
export function useRideBack(active: boolean, onBack: () => void): void {
  const back = useContext(RideBackContext);
  const handle = useEffectEvent(() => {
    onBack();
  });
  useEffect(() => {
    if (!active || back === undefined) return undefined;
    return back.register(() => {
      handle();
    });
  }, [active, back]);
}
