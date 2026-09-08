// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What the effort-history screen needs from the local store (#67), and nothing
 * more.
 *
 * The same shape as every other port in this app and for the same reason: the
 * view is rendered by the accessibility suite on a machine with no IndexedDB
 * worth the name, so it cannot open a database itself. `main.tsx` is the one
 * caller that reaches the real store.
 *
 * ⚠️ **`getStreamSet` is absent.** The overlay needs latitude, longitude and
 * the time base for **two** activities. A port offering the whole set would
 * decode power, heart rate, cadence, speed and temperature for both of them to
 * draw one comparison — and `load.ts` states the read budget this shape makes
 * checkable.
 *
 * ⚠️ **Every method takes the owning athlete first**, so there is no read here
 * that could answer "the segment with this id" without being told whose it is.
 * The cross-athlete shape CLAUDE.md §6 names, refused at the type level.
 */

import type {
  ActivityId,
  ActivityRecord,
  AthleteId,
  Samples,
  SegmentEffortRecord,
  SegmentId,
  SegmentRecord,
  StreamChannel,
  StreamSetSummary,
} from '@onyourleft/store';

export interface EffortStore {
  /** The segment the screen is about. Athlete-scoped, so a stranger's id misses. */
  getSegment(owner: AthleteId, id: SegmentId): Promise<SegmentRecord | undefined>;
  /**
   * Every effort this athlete has on it.
   *
   * Returns `private-match` efforts and drops `excluded` ones — #67's first
   * criterion, enforced in `packages/store` rather than here so that a second
   * caller cannot get it wrong.
   */
  listEfforts(owner: AthleteId, segment: SegmentId, limit?: number): Promise<SegmentEffortRecord[]>;
  /** The ride an effort was found in, for its name and its date. */
  getActivity(owner: AthleteId, id: ActivityId): Promise<ActivityRecord | undefined>;
  /** The time base. Sample `i` is at `startedAt + i * sampleInterval`. */
  getStreamSetSummary(owner: AthleteId, id: ActivityId): Promise<StreamSetSummary | undefined>;
  getStreamChannel<C extends StreamChannel>(
    owner: AthleteId,
    id: ActivityId,
    channel: C,
  ): Promise<Samples<C> | undefined>;
}

export interface EffortPort {
  readonly athleteId: AthleteId;
  readonly store: EffortStore;
}
