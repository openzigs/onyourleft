// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What the activity detail view needs from the local store, and nothing more.
 *
 * The same shape as `library/store-port.ts` and `transfer/store-port.ts`, for
 * the same reason: the view is rendered by the accessibility suite on a machine
 * with no IndexedDB worth the name, so it cannot open a database itself.
 * `main.tsx` is the one caller that reaches the real store.
 *
 * ⚠️ **`getStreamSet` is deliberately absent.** It decodes every channel of
 * the whole ride, which is the read #50's fourth acceptance criterion exists to
 * forbid — a four-hour ride is 14 400 samples across eight channels, and a
 * summary panel needs none of them. A port that offered it would make the
 * expensive read the convenient one. The two reads that *are* here divide the
 * work the way ADR 0011 divided the storage: {@link DetailStore.getStreamSetSummary}
 * answers "what is in this ride" without inflating a byte, and
 * {@link DetailStore.getStreamChannel} inflates exactly one channel, only for a
 * series the rider has switched on.
 */

import type {
  ActivityId,
  ActivityRecord,
  AthleteId,
  LapRecord,
  PrivacyZoneRecord,
  Samples,
  StreamChannel,
  StreamSetSummary,
} from '@onyourleft/store';

export interface DetailStore {
  getActivity(owner: AthleteId, id: ActivityId): Promise<ActivityRecord | undefined>;
  getStreamSetSummary(owner: AthleteId, id: ActivityId): Promise<StreamSetSummary | undefined>;
  getStreamChannel<C extends StreamChannel>(
    owner: AthleteId,
    id: ActivityId,
    channel: C,
  ): Promise<Samples<C> | undefined>;
  listLaps(owner: AthleteId, id: ActivityId): Promise<LapRecord[]>;
  /**
   * The athlete's own zones.
   *
   * Read by the *shared view* alone — the preview of what a published copy of
   * this ride would contain (ADR 0004 decision C: "the UI must explain the
   * difference on the athlete's own activity rather than let them discover
   * it"). The athlete's own view of their own ride is never trimmed; see
   * `privacy.ts`.
   */
  listPrivacyZones(owner: AthleteId): Promise<PrivacyZoneRecord[]>;
}

export interface DetailPort {
  readonly athleteId: AthleteId;
  readonly store: DetailStore;
}
