// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **A discarded ride takes the pictures kept during it** —
 * [#2349](https://github.com/openzigs/onyourleft/issues/2349) item 2:
 * *"Discarding must also drop the ride's kept pictures, snapshots and any
 * queued upload."*
 *
 * Snapshots (#1063) and side-camera reports (#388) are held in memory for the
 * ride and dropped by their keepers (`snapshot-keeper.ts`,
 * `side-report-keeper.ts`). A picture kept under *"Keep the pictures from this
 * ride"* (#384, `keep.ts`) is different: it is written the moment it is taken,
 * and it names no ride — its `activityId` is `null`, because the ride is not an
 * activity until it is saved. So the link is the ride's own time: from the
 * moment it was seen under way to the moment it was discarded.
 *
 * ## The rules
 *
 * 1. **Only a discard deletes.** A save, an empty ride, a failed save and a
 *    reset delete nothing: the pictures stay where `keep.ts` put them, until
 *    the rider deletes them on the Camera screen.
 * 2. **Only a discard that went through.** A delete that did not go through
 *    leaves the ride on this device, offered back (`leftover`), and its
 *    pictures stay with it.
 * 3. **Only this athlete's kept pictures, only in this ride's time.** The
 *    store's `deleteKeptCameraFramesCapturedBetween` is scoped by owner and by
 *    `capturedAt`, and never takes a snapshot (it names its own ride). A
 *    picture kept before the ride started, or by the next ride, stays.
 * 4. **A ride recovered from an earlier visit starts where it started**, not
 *    where this tab first saw it: the window opens at the session's own
 *    `startedAt` (#2356). Not at `now - elapsedSeconds`: after a crash the
 *    elapsed time reaches only the last slot recorded, so that window opened
 *    as late as the tab was gone, and a picture kept before the crash
 *    survived the discard.
 *
 * ⚠️ **No log, and no retry.** A delete that fails says nothing: a storage
 * error can name the key it could not reach (ADR 0029 D-8), and the pictures
 * stay countable on the Camera screen, where *Delete every picture on this
 * device* still removes them.
 *
 * What this reads of the ride is spelled out here rather than imported, for
 * `side-report-keeper.ts`'s reason: nothing on the path from the camera to the
 * store may import a module that can reach a trainer. The ride controller
 * satisfies the shape structurally, and `main.tsx` hands it over.
 */

import type { UnixSeconds } from '@onyourleft/domain';
import type { AthleteId } from '@onyourleft/store';

import type { RideProgress } from './side-report-keeper';

/** The part of the ride controller's snapshot this reads. */
export interface DiscardableRideProgress extends RideProgress {
  /** The session's own start: `undefined` only with no recording under way. */
  readonly startedAt: UnixSeconds | undefined;
  readonly leftover: boolean;
}

/** Where ride progress comes from — `ride/controller.ts` §`RideController`, structurally. */
export interface DiscardableRideSource {
  getSnapshot(): DiscardableRideProgress;
  subscribe(listener: () => void): () => void;
}

/** The one store call this makes. */
export interface KeptFrameDiscardStore {
  deleteKeptCameraFramesCapturedBetween(
    owner: AthleteId,
    from: UnixSeconds,
    to: UnixSeconds,
  ): Promise<number>;
}

export interface KeptFrameDiscardOptions {
  readonly rides: DiscardableRideSource;
  readonly store: KeptFrameDiscardStore;
  readonly athleteId: AthleteId;
  /** The same clock `keep.ts` stamps a picture with. `browserClock` in production. */
  now(): UnixSeconds;
}

/** What a caller holds: the delete under way, for a test to wait on, and the unsubscribe. */
export interface KeptFrameDiscard {
  /** The last delete started, settled. Resolves at once when none was. */
  settled(): Promise<void>;
  dispose(): void;
}

/** One per tab, made by `main.tsx` beside the snapshot and report keepers. */
export function discardKeptFramesWithTheRide(options: KeptFrameDiscardOptions): KeptFrameDiscard {
  const { rides } = options;
  /** When the ride under way started, or `undefined` with none under way. */
  let from: UnixSeconds | undefined;
  let pending: Promise<void> = Promise.resolve();

  const observe = (): void => {
    const now = rides.getSnapshot();
    if (now.phase === 'recording' || now.phase === 'paused') {
      // Rule 4: the session's own start, so a recovered ride's window opens
      // where the ride did.
      from = now.startedAt ?? from;
      return;
    }
    if (from === undefined) {
      return;
    }
    if (now.saveState === 'discarded') {
      const start = from;
      from = undefined;
      if (now.leftover) {
        // Rule 2: the ride is still here, and so are its pictures.
        return;
      }
      pending = options.store
        .deleteKeptCameraFramesCapturedBetween(options.athleteId, start, options.now())
        .then(
          () => undefined,
          // No log: the pictures stay countable on the Camera screen.
          () => undefined,
        );
      return;
    }
    // Rule 1: a save began, failed or the ride was reset. `confirmDiscard`
    // stops the ride before it says `discarded`, with the save state still
    // `unavailable`, so that one step is not an ending of its own.
    if (now.saveState !== 'unavailable' || now.phase === 'idle') {
      from = undefined;
    }
  };

  const unsubscribe = rides.subscribe(observe);
  observe();
  return {
    settled: async () => pending,
    dispose: unsubscribe,
  };
}
