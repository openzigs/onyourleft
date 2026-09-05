// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The two effects that connect {@link RideController} to a browser: a clock,
 * and the guard on closing the tab.
 *
 * ## The tick is an interval and not a frame loop
 *
 * The grid is 1 Hz and the recorder's flush schedule is in whole seconds, so
 * sixty ticks a second would be fifty-nine wasted renders and a checkpoint
 * decision made sixty times a second for four hours. `requestAnimationFrame`
 * also stops entirely in a backgrounded tab, which is the one situation where
 * the ride must keep advancing — the athlete has switched to a music app and
 * the recorder still owes them the seconds.
 *
 * ⚠️ **`setInterval` is throttled in a background tab too** (to about once a
 * minute in Chrome), and that is survivable here and would not be for a design
 * that counted ticks: `tick(now)` takes the wall clock, and the recording
 * engine fills the whole interval from it. A controller that incremented a
 * counter per tick would lose the difference silently.
 */

import { useEffect, useSyncExternalStore } from 'react';

import type { RideController, RideSnapshot } from './controller';

/** How often the screen advances its clock. The 1 Hz grid FIT expects. */
export const TICK_INTERVAL_MILLISECONDS = 1000;

/** Re-renders whenever the controller changes. */
export function useRideSnapshot(controller: RideController): RideSnapshot {
  return useSyncExternalStore(
    (onChange) => controller.subscribe(onChange),
    () => controller.getSnapshot(),
    () => controller.getSnapshot(),
  );
}

/**
 * Whether a ride is under way — recording or paused, and in either case not yet
 * finished.
 *
 * A **boolean** rather than the snapshot, so React's own bail-out applies:
 * `RideSession` renders `null` and must not re-render four times a second for
 * four hours to keep doing so.
 *
 * A paused ride counts. It is unsaved in exactly the way a recording one is,
 * and the athlete gets no second chance to say "not yet" once the tab is gone.
 */
export function useRideInProgress(controller: RideController): boolean {
  const read = (): boolean => {
    const { phase } = controller.getSnapshot();
    return phase === 'recording' || phase === 'paused';
  };
  return useSyncExternalStore((onChange) => controller.subscribe(onChange), read, read);
}

/** Drive the controller's clock while the component is mounted. */
export function useRideClock(controller: RideController): void {
  useEffect(() => {
    const handle = globalThis.setInterval(() => {
      // A rejection here would be an unhandled rejection in a timer callback,
      // where nothing can catch it. `tick` is documented not to throw for a
      // storage failure — that becomes `storageState` — so what is left is a
      // programming error, and it is logged nowhere useful because there is no
      // server to send it to (owner decision D6).
      void controller.tickNow();
    }, TICK_INTERVAL_MILLISECONDS);
    return () => {
      globalThis.clearInterval(handle);
    };
  }, [controller]);
}

/**
 * Warn before the tab is closed while a ride is in progress.
 *
 * #49's fifth acceptance criterion. The recorder checkpoints continuously, so
 * closing the tab does not lose the ride — but it does end it, and the athlete
 * gets no second chance to say "not yet" once the tab is gone.
 *
 * ⚠️ **`preventDefault()` is the whole mechanism, and `returnValue` is not.**
 * Setting `event.returnValue` to a string was the old way and browsers now
 * ignore the string entirely; the dialogue is not customisable and its text is
 * the browser's. What still decides whether it appears at all is
 * `preventDefault()` on a cancelable `beforeunload`.
 *
 * ⚠️ **It also requires that the page has been interacted with** — Chrome
 * suppresses the dialogue on a page with no user activation, which is not a
 * problem here because starting a ride is a click.
 */
export function useRecordingGuard(active: boolean): void {
  useEffect(() => {
    if (!active) {
      return undefined;
    }
    const guard = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
    };
    globalThis.addEventListener('beforeunload', guard);
    return () => {
      globalThis.removeEventListener('beforeunload', guard);
    };
  }, [active]);
}
