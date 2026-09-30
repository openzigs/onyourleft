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
  RideWriteUpRecord,
  RouteId,
  RouteRecord,
  Samples,
  SideCameraReportRecord,
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
  /**
   * What the side camera's post-ride report said about this ride, or
   * `undefined` for a ride that was not filmed — #388. One point lookup of a
   * few sentences: no picture and no pose number is ever on the row, so this
   * read costs the budget nothing it could not afford.
   */
  getSideCameraReport(
    owner: AthleteId,
    id: ActivityId,
  ): Promise<SideCameraReportRecord | undefined>;
  /**
   * The model's write-up saved with this ride, or `undefined` for a ride
   * nobody asked a model about — #805. One point lookup of a bounded text
   * (`MAXIMUM_WRITE_UP_CHARACTERS`). It is shown only after the page screens
   * it again (`detail/write-up.ts` §`shownWriteUp`).
   */
  getRideWriteUp(owner: AthleteId, id: ActivityId): Promise<RideWriteUpRecord | undefined>;
  /**
   * Set or revoke this ride's "may be raced" consent (#793) — the narrow write
   * behind `RaceConsentSection`. `false` when the athlete holds no such ride.
   */
  setActivityMayBeRaced(owner: AthleteId, id: ActivityId, mayBeRaced: boolean): Promise<boolean>;
  /**
   * The saved route a ride was ridden on (#793), read only for a ride that
   * names one, so the page can say whether a privacy zone touches it
   * (ADR 0021 D-5.2). One point lookup.
   */
  getRoute(owner: AthleteId, id: RouteId): Promise<RouteRecord | undefined>;
}

export interface DetailPort {
  readonly athleteId: AthleteId;
  readonly store: DetailStore;
}
