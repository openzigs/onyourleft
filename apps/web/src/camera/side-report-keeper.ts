// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **Which ride a side-camera session filmed, and saving its report with it** —
 * [#388](https://github.com/openzigs/onyourleft/issues/388), the owner's
 * retention ruling of 2026-09-26.
 *
 * ## The problem this solves
 *
 * A side-camera pairing and a ride are two things with two lifetimes. The
 * pairing ends when the phone stops or the link goes; the ride becomes an
 * activity only when the rider stops it AND the save succeeds
 * (`recording/finish.ts`). Either can end first. And an `ActivityRecord` does
 * not exist while the rider is on the bike, so there is nothing to write a
 * report against until it does — the gap `packages/store` §`CameraFrameRecord`
 * records for a kept picture.
 *
 * ## The rule
 *
 * A session's report is saved with **the last ride saved while the session
 * was open, or after it ended while that ride was still under way**:
 *
 * 1. The session ends while a ride is recording, paused or being saved — the
 *    report waits, in this tab's memory only, and is saved with that ride the
 *    moment it is saved. If that ride's save comes back `empty` or `failed`,
 *    the report is dropped there and then, and nothing was ever written.
 * 2. The session ends after a ride was saved during it — the report is saved
 *    with that ride at once.
 * 3. No ride was under way at any point during the session — the report is
 *    dropped. There is no ride to put it with, and the owner's ruling keeps
 *    reports *with rides*, not beside them.
 *
 * ⚠️ **A ride must have been seen under way during the session** before its
 * save counts. Without that, a recovered ride saved from the Ride screen's
 * leftover list — ridden on another day, with no camera — would collect the
 * report of whatever session happened to be open.
 *
 * ## What this reads of the ride, and why not more
 *
 * {@link RideProgressSource} is three fields of `ride/controller.ts`'s
 * snapshot, spelled out here rather than imported: this module is on the path
 * from the camera to the store and `side-report-safety.test.ts` holds that no
 * module on it imports anything that can reach a trainer. The ride controller
 * satisfies the shape structurally, and `main.tsx` hands it over.
 *
 * ## Where a report is dropped, and the one case it waits for ever (#561's review)
 *
 * ⚠️ **The drop happens on the save's outcome, not on the ride going back to
 * `idle`.** `ride/controller.ts` never returns `phase` to `idle` after
 * `stopped` today (#548 is the issue that will), so a keeper that waited for
 * `idle` would never drop anything. Every stop in production is followed by
 * `saving` — `main.tsx` always wires `rideSave` — and the `saving` →
 * `empty`/`failed` step is what drops the report; `side-report-keeper.test.ts`
 * holds both outcomes to it.
 *
 * The `idle` branch below is for **#548's reset** and nothing today: a ride
 * that was stopped and never saved, then reset to `idle`, must not leave the
 * report waiting for a save that is not coming. It is tested against the
 * reset #548 will add, so it is not a guard that cannot fire.
 *
 * What still waits: a build with no save port at all (`saveState` stays
 * `unavailable` after the stop). There is no snapshot that tells "about to
 * save" from "never will" — the stop notifies before `saving` with the same
 * `unavailable` — so the report stays in memory until the tab goes. Nothing is
 * written, which is the rule's outcome; only the memory is held longer.
 *
 * ## What it does not do
 *
 * - **No retry and no queue.** A put that fails is dropped: the report is a
 *   few sentences about one ride, and a queue of them is a second store.
 * - **Nothing crosses a reload.** A report waiting for its ride is in memory
 *   only, like the pose numbers it came from.
 */

import type { ActivityId, AthleteId, SideCameraReportRecord } from '@onyourleft/store';

import type { SideReport } from './side-report';
import type { SideReportKeepingPort, SideReportSession } from './side-report-port';

/** The part of the ride controller's snapshot this reads. */
export interface RideProgress {
  readonly phase: 'idle' | 'recording' | 'paused' | 'stopped';
  readonly saveState: 'unavailable' | 'saving' | 'saved' | 'empty' | 'failed';
  readonly savedActivityId: ActivityId | undefined;
}

/** Where ride progress comes from — `ride/controller.ts` §`RideController`, structurally. */
export interface RideProgressSource {
  getSnapshot(): RideProgress;
  subscribe(listener: () => void): () => void;
}

/** What the keeper saves into. */
export interface SideReportStore {
  putSideCameraReport(record: SideCameraReportRecord): Promise<void>;
}

export interface SideReportKeeperOptions {
  readonly rides: RideProgressSource;
  readonly store: SideReportStore;
  readonly athleteId: AthleteId;
}

/**
 * Where one ride has got to, as far as a report is concerned.
 *
 * - `none` — no ride under way.
 * - `riding` — recording or paused, or stopped and not yet saving.
 * - `saving` — the save is in flight; its outcome is the next change.
 */
type RideStage = 'none' | 'riding' | 'saving';

/** The keeper: one per tab, made by `main.tsx`. */
export function sideReportKeeper(options: SideReportKeeperOptions): SideReportKeepingPort {
  return {
    beginSideReportSession(): SideReportSession {
      return openSession(options);
    },
  };
}

function openSession(options: SideReportKeeperOptions): SideReportSession {
  const { rides } = options;
  let stage: RideStage = 'none';
  /** A ride saved after it was seen under way during this session. */
  let candidate: ActivityId | undefined;
  let ended = false;
  let report: SideReport | undefined;
  let unsubscribe: (() => void) | undefined;

  const observe = (): void => {
    const now = rides.getSnapshot();
    if (now.phase === 'recording' || now.phase === 'paused') {
      stage = 'riding';
    } else if (stage !== 'none' && now.saveState === 'saving') {
      stage = 'saving';
    } else if (stage === 'saving') {
      // The save's outcome. Only a saved ride carries the report.
      if (now.saveState === 'saved' && now.savedActivityId !== undefined) {
        candidate = now.savedActivityId;
      }
      stage = 'none';
    } else if (stage === 'riding' && now.phase === 'idle') {
      // #548's reset of a ride that was stopped and never saved — nothing to
      // put a report with. Not reachable until #548 lands; see the header.
      stage = 'none';
    }
    if (ended && stage === 'none') {
      settle();
    }
  };

  const settle = (): void => {
    unsubscribe?.();
    unsubscribe = undefined;
    const ride = candidate;
    const said = report;
    report = undefined;
    if (ride === undefined || said === undefined) {
      return;
    }
    options.store
      .putSideCameraReport({
        athleteId: options.athleteId,
        activityId: ride,
        summary: said.summary,
        observations: said.observations,
      })
      .catch(() => {
        // Nothing of the error is read: a storage error can name the key it
        // could not write, and the report is sentences about a body (ADR 0029
        // D-8). The ride is saved; only its side-camera section is missing.
      });
  };

  unsubscribe = rides.subscribe(observe);
  observe();

  return {
    endSideReportSession(said: SideReport | undefined): void {
      if (ended) {
        return;
      }
      ended = true;
      report = said;
      if (said === undefined) {
        unsubscribe?.();
        unsubscribe = undefined;
        return;
      }
      if (stage === 'none') {
        settle();
      }
      // Otherwise a ride is under way: `observe` settles when it finishes.
    },
  };
}
