// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A `SegmentPort` backed by plain objects, for tests and for the accessibility
 * suite.
 *
 * The same shape as `analysis/testing.ts` and `detail/testing.ts`, and it counts
 * its reads for the same reason: the interesting claim about creation is the
 * *order* of the reads — the activity is read first, athlete-scoped, so a
 * request naming somebody else's ride costs one indexed miss rather than three
 * channel decodes. {@link StubSegments.reads} is what pins that.
 *
 * ⚠️ **This stub answers a read only when the requester matches the ROW's own
 * `athleteId`**, which is what the store's `[athleteId+id]` index does. That is
 * not a convenience: it is the stand-in for criterion 1's enforcement, and a
 * stub that keyed on the port's owner instead would answer a request for
 * another athlete's ride whenever the port happened to belong to whoever asked
 * — which is a scope that checks nothing. The first version of this file did
 * exactly that and `create.test.ts` caught it.
 */

import type { GeographicPosition } from '@onyourleft/domain';
import type {
  ActivityId,
  ActivityRecord,
  AthleteId,
  PrivacyZoneRecord,
  Samples,
  SegmentRecord,
  StreamChannel,
} from '@onyourleft/store';

import type { SegmentPort, SegmentStore } from './store-port';

/** One ride in a stub library: its record and whichever track it carries. */
export interface StubSegmentRide {
  readonly activity: ActivityRecord;
  /** The recorded track. A gap is an `undefined` entry, never an interpolation. */
  readonly track?: readonly (GeographicPosition | undefined)[];
  /** Matching `track` index for index. A gap is `undefined`. */
  readonly altitudes?: readonly (number | undefined)[];
}

export interface StubSegments extends SegmentPort {
  /** Every read, in order, as `kind:argument`. The read order, observable. */
  readonly reads: string[];
  /** Every segment written, in order. */
  readonly written: SegmentRecord[];
}

export function stubSegments(
  owner: AthleteId,
  rides: readonly StubSegmentRide[],
  options: {
    readonly privacyZones?: readonly PrivacyZoneRecord[];
    readonly existing?: readonly SegmentRecord[];
  } = {},
): StubSegments {
  const reads: string[] = [];
  const written: SegmentRecord[] = [];
  const existing = [...(options.existing ?? [])];

  function rideFor(id: ActivityId): StubSegmentRide | undefined {
    return rides.find((ride) => ride.activity.id === id);
  }

  const store: SegmentStore = {
    listActivitySummaries: (requester, listOptions) => {
      reads.push(`activities:${String(listOptions?.limit ?? 'all')}`);
      const mine = rides
        .filter((ride) => ride.activity.athleteId === requester)
        // `ActivitySummary` is `Omit<ActivityRecord, 'originalFile'>`, so a
        // record satisfies it structurally with no projection at all.
        .map(({ activity }) => activity);
      return Promise.resolve(
        listOptions?.limit === undefined ? mine : mine.slice(0, listOptions.limit),
      );
    },
    getActivity: (requester, id) => {
      reads.push(`activity:${id}`);
      // The `[athleteId+id]` index, stood in for. See the file comment.
      const found = rideFor(id);
      return Promise.resolve(found?.activity.athleteId === requester ? found.activity : undefined);
    },
    getStreamChannel: <C extends StreamChannel>(
      requester: AthleteId,
      id: ActivityId,
      channel: C,
    ): Promise<Samples<C> | undefined> => {
      reads.push(`channel:${id}:${channel}`);
      const ride = rideFor(id);
      if (ride === undefined || ride.activity.athleteId !== requester || ride.track === undefined) {
        return Promise.resolve(undefined);
      }
      if (channel === 'latitude') {
        return Promise.resolve(ride.track.map((point) => point?.latitude) as unknown as Samples<C>);
      }
      if (channel === 'longitude') {
        return Promise.resolve(
          ride.track.map((point) => point?.longitude) as unknown as Samples<C>,
        );
      }
      if (channel === 'altitude') {
        return Promise.resolve(ride.altitudes as unknown as Samples<C> | undefined);
      }
      return Promise.resolve(undefined);
    },
    listPrivacyZones: (requester) => {
      reads.push('privacyZones');
      return Promise.resolve(requester === owner ? [...(options.privacyZones ?? [])] : []);
    },
    listSegments: (requester, limit) => {
      reads.push(`segments:${String(limit ?? 'all')}`);
      if (requester !== owner) {
        return Promise.resolve([]);
      }
      return Promise.resolve(limit === undefined ? [...existing] : existing.slice(0, limit));
    },
    putSegment: (record) => {
      written.push(record);
      existing.unshift(record);
      return Promise.resolve(record.id);
    },
  };

  return { athleteId: owner, store, reads, written };
}
