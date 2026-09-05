// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The ride's clock and its unload guard, mounted **above the router**.
 *
 * ## Why this is not part of the ride screen
 *
 * It was, and that was a defect. A recording is a property of the *app*, not of
 * whichever page is on screen: an athlete who taps Activities mid-ride is still
 * riding. With the interval and the `beforeunload` listener owned by
 * `RideView`'s `LiveRide`, a route change unmounted both — the recorder stopped
 * being ticked, so it stopped checkpointing, and the eight-second data-loss
 * bound `recording/recorder.ts` and `README.md` state as a product promise
 * became "everything since you last looked at the ride screen". With no server
 * there is no other copy of it (owner decision D6).
 *
 * So `AppShell` mounts this next to `main` rather than inside it, where nothing
 * a route does can unmount it. It renders nothing: the screen is still a
 * projection of {@link RideSnapshot} and still lives in `views/RideView.tsx`.
 *
 * ## It renders `null`, and it re-renders almost never
 *
 * The guard needs one bit — whether a ride is in progress — and reading that as
 * a boolean through `useSyncExternalStore` means React compares booleans and
 * bails out. A component that took the whole snapshot instead would re-render
 * on every measurement, four times a second for four hours, to produce `null`
 * each time.
 */

import type { JSX } from 'react';

import type { RideController } from './controller';
import { useRecordingGuard, useRideClock, useRideInProgress } from './useRideController';

export interface RideSessionProps {
  /** `undefined` in a browser that cannot pair; then nothing is mounted at all. */
  readonly controller: RideController;
}

/** The ride's clock and unload guard. Renders nothing. */
export function RideSession({ controller }: RideSessionProps): JSX.Element | null {
  const inProgress = useRideInProgress(controller);
  useRideClock(controller);
  useRecordingGuard(inProgress);
  return null;
}
