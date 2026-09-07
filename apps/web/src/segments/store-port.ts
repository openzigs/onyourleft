// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What segment creation needs from the local store, and nothing more.
 *
 * The same shape as `detail/store-port.ts` and `analysis/store-port.ts`, for
 * the same reason: the view is rendered by the accessibility suite on a machine
 * with no IndexedDB worth the name, so it cannot open a database itself.
 * `main.tsx` is the one caller that reaches the real store.
 *
 * ⚠️ **`getStreamSet` is deliberately absent here too**, and for a sharper
 * reason than #50's. Creating a segment needs the ride's *positions* and its
 * *altitudes* — three of the eight channels at most — and a port offering the
 * whole set would decode power, heart rate, cadence, speed and temperature to
 * cut a stretch of road out of a map.
 */

import type {
  ActivityId,
  ActivityRecord,
  ActivitySummary,
  AthleteId,
  ListActivitiesOptions,
  PrivacyZoneRecord,
  Samples,
  SegmentId,
  SegmentRecord,
  StreamChannel,
} from '@onyourleft/store';

export interface SegmentStore {
  /**
   * The rides a segment could be cut from.
   *
   * The same read `library/store-port.ts` declares, and deliberately the same
   * signature: the screen offers a rider a choice of their own rides, which is
   * a *list* rather than a creation input, and a second spelling of it would be
   * a second place to get the bound wrong. It is here rather than passed down
   * from the shell because the shell renders synchronously and this read is
   * not, and threading a promise through the route switch to save one method on
   * a port is the wrong trade.
   */
  listActivitySummaries(
    owner: AthleteId,
    options?: ListActivitiesOptions,
  ): Promise<ActivitySummary[]>;
  /**
   * The activity a segment is being cut from.
   *
   * **Athlete-scoped, and that is criterion 1.** #64: *"A segment can be
   * created only from an activity the creating athlete owns."* This signature
   * is where that is enforced — there is no `getActivity(id)` to reach for, so
   * a creation path cannot read somebody else's ride even by mistake, and
   * `create.ts` turns the resulting `undefined` into a refusal rather than a
   * crash.
   */
  getActivity(owner: AthleteId, id: ActivityId): Promise<ActivityRecord | undefined>;
  getStreamChannel<C extends StreamChannel>(
    owner: AthleteId,
    id: ActivityId,
    channel: C,
  ): Promise<Samples<C> | undefined>;
  /**
   * The athlete's own zones, for criterion 4.
   *
   * #64: *"A segment whose endpoints fall inside a privacy zone (#21) cannot be
   * created public … because a public segment start is a published address."*
   * Unlike `detail/`'s use of the same read, this one is not a preview: it
   * changes what gets written.
   */
  listPrivacyZones(owner: AthleteId): Promise<PrivacyZoneRecord[]>;
  /** The athlete's existing segments, newest first, for criterion 3. */
  listSegments(owner: AthleteId, limit?: number): Promise<SegmentRecord[]>;
  putSegment(record: SegmentRecord): Promise<SegmentId>;
}

export interface SegmentPort {
  readonly athleteId: AthleteId;
  readonly store: SegmentStore;
}
