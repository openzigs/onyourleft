// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What the analysis view needs from the local store, and nothing more.
 *
 * The fourth port of this shape, after `library/`, `detail/` and `transfer/`,
 * and for the same reason: the view is rendered by the accessibility suite on a
 * machine with no IndexedDB worth the name, so it cannot open a database
 * itself. `main.tsx` is the one caller that reaches the real store.
 *
 * ⚠️ **This is the one port that reads a channel across many rides**, which
 * makes its read budget the interesting thing about it rather than an
 * afterthought. `detail/store-port.ts` bars `getStreamSet` because a summary
 * panel needs no samples; this view genuinely does need samples, from every
 * ride the library holds. So the same discipline is applied one level up: the
 * cheap indexed summary decides which rides are worth a decode, and only the
 * channels a zone chart or a curve actually reads are inflated. `load.ts`
 * states the bound and `load.test.ts` counts the calls.
 *
 * {@link AnalysisStore.getAthlete} is here and nowhere else in `apps/web`: the
 * thresholds every zone boundary is derived from live on the athlete record,
 * and #78's first criterion is that there is **a single athlete threshold
 * setting**. One reader is how that stays true.
 */

import type { BeatsPerMinute, Seconds, Watts } from '@onyourleft/domain';
import type {
  ActivityId,
  ActivityRecord,
  ActivitySummary,
  AthleteId,
  AthleteRecord,
  ListActivitiesOptions,
  Samples,
  StreamChannel,
  StreamSetSummary,
} from '@onyourleft/store';

export interface AnalysisStore {
  getAthlete(id: AthleteId): Promise<AthleteRecord | undefined>;
  /**
   * The one write this screen performs (#76).
   *
   * Narrow on purpose: it replaces the two thresholds and nothing else, so a
   * saved setting cannot destroy the display name or the creation instant the
   * way a `putAthlete` from here would. `packages/store` records why that is
   * the store's job rather than this screen's — the read and the write are in
   * one transaction, so two tabs cannot race.
   */
  setAthleteThresholds(
    id: AthleteId,
    thresholds: {
      readonly thresholdPower?: Watts | undefined;
      readonly thresholdHeartRate?: BeatsPerMinute | undefined;
    },
  ): Promise<AthleteRecord | undefined>;
  /**
   * Write one ride's load summary (#77) — the backfill's only write.
   *
   * Athlete-scoped and narrow, so a derived number cannot destroy a ride's
   * name or its visibility. `packages/store` records why that is its job.
   */
  setActivityLoadSummary(
    owner: AthleteId,
    id: ActivityId,
    summary: {
      readonly effortWeightedPower?: Watts | undefined;
      readonly effortWeightedHeartRate?: BeatsPerMinute | undefined;
      readonly loadCoveredTime: Seconds;
    },
  ): Promise<boolean>;
  getActivity(owner: AthleteId, id: ActivityId): Promise<ActivityRecord | undefined>;
  listActivitySummaries(
    owner: AthleteId,
    options?: ListActivitiesOptions,
  ): Promise<ActivitySummary[]>;
  getStreamSetSummary(owner: AthleteId, id: ActivityId): Promise<StreamSetSummary | undefined>;
  getStreamChannel<C extends StreamChannel>(
    owner: AthleteId,
    id: ActivityId,
    channel: C,
  ): Promise<Samples<C> | undefined>;
}

export interface AnalysisPort {
  readonly athleteId: AthleteId;
  readonly store: AnalysisStore;
}
