// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What the matcher's sweep needs from the local store, and nothing more (#66).
 *
 * The same shape as `segments/store-port.ts` and for the same reason: the sweep
 * is exercised by tests that have no IndexedDB worth the name, so it cannot open
 * a database itself. `main.tsx` is the one caller that reaches the real store.
 *
 * ⚠️ **`getStreamSet` is absent**, as it is in every other port in this app.
 * Matching needs latitude, longitude and the set's time base; a port offering
 * the whole set would decode power, heart rate, cadence, speed and temperature
 * to find out whether a rider went up a hill.
 *
 * ⚠️ **Every method takes the owning athlete first.** There is no read here
 * that could answer "the activity with this id" without being told whose it is
 * — the cross-athlete shape CLAUDE.md §6 names, refused at the type level.
 */

import type {
  ActivityId,
  ActivitySummary,
  AthleteId,
  AthleteRecord,
  ListActivitiesOptions,
  MatchCheckpointRecord,
  PrivacyZoneRecord,
  Samples,
  SegmentEffortRecord,
  SegmentId,
  SegmentRecord,
  StreamChannel,
  StreamSetSummary,
} from '@onyourleft/store';

export interface MatchStore {
  /**
   * The library, a page at a time.
   *
   * Ordered by `startedAt` ascending and bounded by `startedAfter`, which is
   * what makes a sweep resumable — see `backfill.ts` for why that is a cursor
   * rather than an offset.
   */
  listActivitySummaries(
    owner: AthleteId,
    options?: ListActivitiesOptions,
  ): Promise<ActivitySummary[]>;
  /** The time base. Sample `i` is at `startedAt + i * sampleInterval`. */
  getStreamSetSummary(owner: AthleteId, id: ActivityId): Promise<StreamSetSummary | undefined>;
  getStreamChannel<C extends StreamChannel>(
    owner: AthleteId,
    id: ActivityId,
    channel: C,
  ): Promise<Samples<C> | undefined>;
  /** The corpus to match against. */
  listSegments(owner: AthleteId, limit?: number): Promise<SegmentRecord[]>;
  /**
   * The athlete's zones, which decide whether an effort is `private-match`.
   *
   * ⚠️ Not a preview, unlike `detail/`'s use of the same read: this one changes
   * what gets written, and getting it wrong publishes an address.
   */
  listPrivacyZones(owner: AthleteId): Promise<PrivacyZoneRecord[]>;
  /**
   * The athlete, for the attributes an effort freezes.
   *
   * ⚠️ Read **once per sweep and copied onto each effort**, never joined at
   * ranking time. #66's eighth criterion: editing a profile must not rewrite
   * last year's board.
   */
  getAthlete(owner: AthleteId): Promise<AthleteRecord | undefined>;
  /** Replaces this activity's efforts. The replace is what makes a re-sweep idempotent. */
  putActivityEfforts(
    owner: AthleteId,
    activityId: ActivityId,
    efforts: readonly SegmentEffortRecord[],
  ): Promise<number>;
  listEfforts(owner: AthleteId, segment: SegmentId, limit?: number): Promise<SegmentEffortRecord[]>;
  getMatchCheckpoint(owner: AthleteId): Promise<MatchCheckpointRecord | undefined>;
  putMatchCheckpoint(record: MatchCheckpointRecord): Promise<void>;
  clearMatchCheckpoint(owner: AthleteId): Promise<void>;
}

export interface MatchPort {
  readonly athleteId: AthleteId;
  readonly store: MatchStore;
}
