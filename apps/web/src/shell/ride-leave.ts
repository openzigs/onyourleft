// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What the browser's own Back, or an address typed into the bar, does on the
 * game's stage — #2349's review, B2.
 *
 * #2349 item 1: *"leaving mid-ride … never ends the ride on one press. It
 * asks."* Android's back is handed to the stage by `ride-back.ts`. A desktop
 * browser's Back, and a fragment typed into the address bar, are not presses
 * the app sees: they are a `hashchange`, and `useRoute.ts` applying it would
 * unmount the game, whose cleanup ends the game ride and releases the
 * gradient (`GameView.tsx` §`teardown`). So the router asks here first.
 *
 * - **A registered surface takes the navigation**, and the router does not
 *   apply it: the address is put back to the stage's own with
 *   `history.pushState` (which fires no `hashchange`, so nothing re-renders),
 *   and the surface opens the end-of-ride question. A second Back with the
 *   question open is taken the same way, and the question stays open.
 * - **Only a change of route.** A fragment that stays on the game's route
 *   unmounts nothing, so it is not asked about.
 * - **Nothing is released here.** The ride, its gradient and its recording are
 *   exactly as they were until the rider answers *Save ride* or *Discard
 *   ride*. *Keep riding* is the stage, where it already is.
 *
 * ⚠️ **A real page unload is not this.** A closed tab, a reload or an address
 * outside this page never reaches `hashchange`, and the browser allows only
 * its own generic prompt there: `beforeunload`, which the stage asks for with
 * `ride/useRideController.ts` §`useRecordingGuard`.
 *
 * A context rather than a module-level variable, for `ride-back.ts`'s reason.
 */

import { createContext, useContext, useEffect, useEffectEvent } from 'react';

/** Where the ride screen on show is asked before the route changes under it. */
export interface RideLeave {
  /** Take attempts to leave until the returned call. The latest registration wins. */
  register(handler: () => void): () => void;
  /**
   * An attempt to leave the route on show. @returns whether a surface took it,
   * so the router must NOT apply the navigation.
   */
  attempt(): boolean;
}

/** A fresh one, for one shell. */
export function rideLeave(): RideLeave {
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
    attempt() {
      const handler = handlers.at(-1);
      if (handler === undefined) return false;
      handler();
      return true;
    },
  };
}

/** The shell's, or `undefined` outside one. */
export const RideLeaveContext = createContext<RideLeave | undefined>(undefined);

/**
 * Take the shell's attempts to leave while `active` — a ride on this screen.
 * The handler is read at each attempt, so it always sees the question as it is.
 */
export function useRideLeave(active: boolean, onLeave: () => void): void {
  const leave = useContext(RideLeaveContext);
  const handle = useEffectEvent(() => {
    onLeave();
  });
  useEffect(() => {
    if (!active || leave === undefined) return undefined;
    return leave.register(() => {
      handle();
    });
  }, [active, leave]);
}
