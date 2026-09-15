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
 *
 * ⚠️ **This file carried a wiring exemption until #282, and it was a defect
 * rather than a decision**: `main.tsx` built no `MatchPort`, nothing called
 * `sweepLibrary`, and `putActivityEfforts` had no production caller at all, so
 * no segment effort had ever been written and the effort screens read a table
 * only a test filled. #278's gate found it. `segments/sweep.ts` is the driver
 * that now runs this, from a control on the segments screen, and `main.tsx`
 * §`buildMatchPort` is the one caller that reaches the real store.
 *
 * ⚠️ **That exemption was an `@unwired` tag, and naming it here is now safe**
 * — a reviewer who remembers this paragraph saying the tag must not be spelled
 * in this comment is reading the old file. It had to be true: `unwiredReason`
 * matched the tag *anywhere* in the stripped comment, so a backticked mention
 * parsed as a live exemption with the rest of the sentence as its reason, and
 * in a file's own doc comment that silences `WIRE001` for the whole module.
 * The gate whose first finding was this file could no longer report it.
 * [#292](https://github.com/openzigs/onyourleft/issues/292) anchored the match
 * to the start of a stripped line, so a tag is a tag and a sentence is a
 * sentence; the constraint a wording rule was standing in for is in the
 * checker now, where it cannot be forgotten.
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
   * Ordered by `startedAt` ascending and bounded by the pair
   * `startedAfter` + `afterActivityId`, which is what makes a sweep resumable —
   * see `backfill.ts` for why that is a cursor rather than an offset, and why
   * it takes an id as well as an instant.
   *
   * ⚠️ **A stub implementing this must break ties on the id the way the store
   * does.** `match-testing.ts` does; one that sorted on the instant alone and
   * honoured `startedAfter` alone would agree with a store that skips a ride.
   * #293.
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
