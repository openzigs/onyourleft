// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **Which ride a side-camera snapshot joins, and keeping it with that ride** —
 * [#1063](https://github.com/openzigs/onyourleft/issues/1063),
 * [ADR 0044](../../../../docs/adr/0044-side-camera-live-view-and-snapshot.md)
 * D-3, D-4 and D-5.
 *
 * One per tab, made by `main.tsx` beside `side-report-keeper.ts`, whose rule
 * for "which ride" this widens the way D-3 says.
 *
 * ## The rule, D-3's five, as this file holds them
 *
 * 1. **A snapshot taken while a ride is under way** — recording, paused, or
 *    stopped and being saved — is held in this tab's memory, owned by that
 *    ride, and written **after that ride's save has committed**, never before.
 *    So a snapshot never names a ride the store does not hold, and
 *    `putCameraFrame` refuses one that would.
 * 2. **A snapshot taken during setup**, with no ride under way, is held in
 *    memory and joins **the next ride started in this tab after it was
 *    taken**, written with that ride's save.
 * 3. **Only a save consumes a setup snapshot.** A ride that comes back
 *    `empty` or `failed` hands its setup snapshots back to wait for the next
 *    ride; the snapshots taken DURING that ride are dropped with it, and
 *    nothing of either was written.
 * 4. **If no ride is saved, a setup snapshot is discarded**, having only ever
 *    been in memory: when the tab closes or reloads (nothing here crosses
 *    one), and when the erase runs ({@link SideSnapshotPort.forget}). The
 *    third case D-3 names, the local athlete changing, cannot happen in this
 *    client: there is one athlete, `local-athlete.ts` §`LOCAL_ATHLETE`.
 * 5. **A recovered ride never collects a snapshot.** A ride adopted from an
 *    earlier visit (`ride/controller.ts` §`continueRecovered`) comes back
 *    PAUSED from idle, never through `recording`, and that is how it is told
 *    apart: it claims no setup snapshot, and a press during it is refused in
 *    words. A ride saved from the leftover list is never under way here at
 *    all, so its save consumes nothing.
 *
 * ## The one place a snapshot record is made, and what it refuses (D-4)
 *
 * On ADR 0044 D-2's branch A — the one built — the strip point is unchanged:
 * the PHONE re-encodes each picture from pixels (`frame.ts`, ADR 0029 D-9),
 * and *"the tablet stores them as received and never re-encodes them"*. So
 * this file does not strip, and must not: a filter here would be a second
 * producer of image bytes, the thing `frame.ts` says there must not be. What
 * it does is refuse — {@link snapshotProblem} — bytes that are not a whole
 * JPEG or that carry a metadata segment or marker (`frame.ts`
 * §`carriesNoMetadata`: a walk of every segment before the scan, and the
 * signature scan), so
 * a picture that reaches here carrying an Exif block, from a phone that is not
 * running this client, is never kept. `side-link-pictures.ts` refuses the
 * same picture at the link; this is the tripwire on the save path itself.
 *
 * ## What it does not do
 *
 * - **No reading, no offset, no lap.** A record names its ride and nothing
 *   finer; `capturedAt` is the press, for the export's file name, and nothing
 *   reads it against the ride's streams (D-3).
 * - **No retry and no queue.** A put that fails is dropped without a word in
 *   any log: a storage error can name the key it could not write (ADR 0029
 *   D-8).
 * - **No network.** Nothing here reaches one (D-11).
 */

import type { UnixSeconds } from '@onyourleft/domain';
import {
  cameraFrameId,
  type ActivityId,
  type AthleteId,
  type CameraFrameId,
  type CameraFrameRecord,
} from '@onyourleft/store';

import { carriesNoMetadata, FRAME_MEDIA_TYPE } from './frame';
import type { RideProgressSource } from './side-report-keeper';
import { wholeJpeg } from './side-link-pictures';
import {
  MAXIMUM_HELD_SNAPSHOTS,
  type SideSnapshotPort,
  type SideSnapshotTaken,
  type SnapshotHeld,
} from './side-snapshot-port';

/** What the keeper writes into: one method, the camera's own. */
export interface SnapshotStore {
  putCameraFrame(record: CameraFrameRecord): Promise<CameraFrameId>;
}

export interface SnapshotKeeperOptions {
  readonly rides: RideProgressSource;
  readonly store: SnapshotStore;
  readonly athleteId: AthleteId;
  /** A fresh id per snapshot. `crypto.randomUUID()` in production. */
  newFrameId(): string;
  /** The press's instant. `Date.now()` in seconds in production. */
  now(): UnixSeconds;
}

/** One snapshot waiting in memory for its ride. */
interface Held {
  readonly taken: SideSnapshotTaken;
  readonly capturedAt: UnixSeconds;
}

/**
 * Why these bytes are not kept as a snapshot, or `undefined` when they may be.
 *
 * The tripwire on the save path (see the module note): a refusal, never a
 * filter, and it names no marker and no offset (ADR 0029 D-8).
 */
export function snapshotProblem(bytes: Uint8Array): 'not-clean' | undefined {
  return wholeJpeg(bytes) && carriesNoMetadata(bytes) ? undefined : 'not-clean';
}

/** Where a ride has got to, as far as a snapshot is concerned. @see side-report-keeper.ts */
type RideStage = 'none' | 'riding' | 'saving';

/** The keeper: one per tab, made by `main.tsx`. */
export function sideSnapshotKeeper(options: SnapshotKeeperOptions): SideSnapshotPort {
  const { rides } = options;
  let stage: RideStage = 'none';
  /** Whether the ride under way was adopted from an earlier visit (rule 5). */
  let recovered = false;
  let lastPhase = rides.getSnapshot().phase;
  /** Setup snapshots no ride has claimed yet (rule 2). */
  let setup: Held[] = [];
  /** Setup snapshots the ride under way claimed when it started (rule 3 hands them back). */
  let claimed: Held[] = [];
  /** Snapshots taken during the ride under way (rule 1). */
  let during: Held[] = [];

  const finish = (savedAs: ActivityId | undefined): void => {
    const joining = [...claimed, ...during];
    if (savedAs === undefined) {
      // Rule 3: the setup snapshots wait for the next ride; the ride's own go.
      setup = [...claimed, ...setup];
    }
    claimed = [];
    during = [];
    stage = 'none';
    recovered = false;
    if (savedAs !== undefined) {
      void write(joining, savedAs);
    }
  };

  const write = async (joining: readonly Held[], ride: ActivityId): Promise<void> => {
    for (const held of joining) {
      try {
        await options.store.putCameraFrame(recordOf(held, ride));
      } catch {
        // Nothing of the error is read (ADR 0029 D-8). The ride is saved; this
        // one snapshot is not, and nothing retries it.
      }
    }
  };

  const recordOf = (held: Held, ride: ActivityId): CameraFrameRecord => ({
    id: cameraFrameId(options.newFrameId()),
    athleteId: options.athleteId,
    capturedAt: held.capturedAt,
    mediaType: FRAME_MEDIA_TYPE,
    width: held.taken.width,
    height: held.taken.height,
    // ⚠️ The bytes as the phone sent them, never re-encoded (D-2's table).
    bytes: held.taken.bytes,
    source: 'snapshot',
    activityId: ride,
    // Fields, not the object: the outline is landmarks and the picture's
    // shape, and whatever a later producer adds is not stored until this
    // says so.
    outline:
      held.taken.outline === undefined
        ? null
        : {
            aspect: held.taken.outline.aspect,
            landmarks: held.taken.outline.landmarks.map((landmark) => ({
              name: landmark.name,
              x: landmark.x,
              y: landmark.y,
            })),
          },
  });

  const observe = (): void => {
    const now = rides.getSnapshot();
    const before = lastPhase;
    lastPhase = now.phase;
    if (now.phase === 'recording' || now.phase === 'paused') {
      if (stage === 'none') {
        stage = 'riding';
        // Rule 5: `continueRecovered` goes from idle straight to paused; a
        // ride the rider starts goes through `recording`.
        recovered = before === 'idle' && now.phase === 'paused';
        if (!recovered) {
          // Rule 2: this is the next ride started after them.
          claimed = setup;
          setup = [];
        }
      }
      return;
    }
    if (stage === 'riding' && now.saveState === 'saving') {
      stage = 'saving';
      return;
    }
    if (stage === 'saving' && now.saveState !== 'saving') {
      finish(
        now.saveState === 'saved' && now.savedActivityId !== undefined && !recovered
          ? now.savedActivityId
          : undefined,
      );
      return;
    }
    if (stage === 'riding' && now.phase === 'idle') {
      // #548's reset of a ride that was stopped and never saved.
      finish(undefined);
    }
  };

  rides.subscribe(observe);
  observe();

  return {
    holdSideSnapshot(taken: SideSnapshotTaken | undefined): SnapshotHeld {
      if (taken === undefined) {
        return { kind: 'refused', reason: 'none-on-screen' };
      }
      if (snapshotProblem(taken.bytes) !== undefined) {
        return { kind: 'refused', reason: 'not-clean' };
      }
      if (stage !== 'none' && recovered) {
        return { kind: 'refused', reason: 'recovered-ride' };
      }
      const held = setup.length + claimed.length + during.length;
      if (held >= MAXIMUM_HELD_SNAPSHOTS) {
        return { kind: 'refused', reason: 'full' };
      }
      // A copy that is this keeper's own, whoever else holds the original.
      const kept: Held = {
        taken: { ...taken, bytes: taken.bytes.slice() },
        capturedAt: options.now(),
      };
      if (stage === 'none') {
        setup.push(kept);
        return { kind: 'held', joins: 'next-ride', held: held + 1 };
      }
      during.push(kept);
      return { kind: 'held', joins: 'this-ride', held: held + 1 };
    },
    forget(): void {
      setup = [];
      claimed = [];
      during = [];
    },
  };
}
