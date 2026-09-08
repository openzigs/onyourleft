// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * An `EffortPort` backed by plain objects (#67).
 *
 * The same shape as `segments/testing.ts`, and it counts its reads for the same
 * reason: the claim worth pinning about this screen is that the **list** costs
 * no sample decode and the **overlay** costs six reads — and a comment cannot
 * assert that.
 *
 * ⚠️ **Answers a read only when the requester matches the ROW's own athlete**,
 * as the store's compound indexes do. `segments/testing.ts` records that the
 * first version of it keyed on the port's owner instead, which is a scope that
 * checks nothing.
 *
 * ⚠️ **`listEfforts` drops `excluded` and keeps `private-match`**, because the
 * real store does. A stub that returned everything would make #67's
 * private-match assertions pass against a store that could not deliver them.
 */

import type { GeographicPosition } from '@onyourleft/domain';
import type {
  ActivityId,
  ActivityRecord,
  AthleteId,
  Samples,
  SegmentEffortRecord,
  SegmentRecord,
  StreamChannel,
  StreamSetSummary,
} from '@onyourleft/store';

import type { EffortPort, EffortStore } from './store-port';

/** One ride in a stub library, and whatever track it carries. */
export interface StubEffortRide {
  readonly activity: ActivityRecord;
  /** A gap is an `undefined` entry, never an interpolation. */
  readonly track?: readonly (GeographicPosition | undefined)[];
  readonly sampleIntervalSeconds?: number;
}

export interface StubEfforts extends Omit<EffortPort, 'store'> {
  store: EffortStore;
  /** Every read, in order, as `kind:argument`. The read cost, observable. */
  readonly reads: string[];
  /** Set to make the next store read reject — how #67's criterion 7 is exercised. */
  failNextRead: boolean;
}

export interface StubEffortOptions {
  readonly athleteId: AthleteId;
  readonly segments: readonly SegmentRecord[];
  readonly efforts: readonly SegmentEffortRecord[];
  readonly rides?: readonly StubEffortRide[];
}

export function stubEffortPort(options: StubEffortOptions): StubEfforts {
  const reads: string[] = [];
  const port: StubEfforts = {
    athleteId: options.athleteId,
    reads,
    failNextRead: false,
    store: undefined as unknown as EffortStore,
  };

  /** Every read goes through this, so the failure switch cannot be forgotten. */
  const read = <T>(label: string, value: T): Promise<T> => {
    reads.push(label);
    if (port.failNextRead) {
      port.failNextRead = false;
      return Promise.reject(new Error('the store is unavailable'));
    }
    return Promise.resolve(value);
  };

  const rideOf = (owner: AthleteId, id: ActivityId): StubEffortRide | undefined =>
    (options.rides ?? []).find(
      (ride) => ride.activity.id === id && ride.activity.athleteId === owner,
    );

  port.store = {
    getSegment: (owner, id) =>
      read(
        `segment:${id}`,
        options.segments.find((one) => one.id === id && one.createdBy === owner),
      ),

    listEfforts: (owner, segment, limit) => {
      const found = options.efforts
        .filter(
          (effort) =>
            effort.athleteId === owner &&
            effort.segmentId === segment &&
            effort.visibility !== 'excluded',
        )
        .sort((a, b) => a.elapsed - b.elapsed);
      return read(`efforts:${segment}`, limit === undefined ? found : found.slice(0, limit));
    },

    getActivity: (owner, id) => read(`activity:${id}`, rideOf(owner, id)?.activity),

    getStreamSetSummary: (owner, id) => {
      const ride = rideOf(owner, id);
      const summary: StreamSetSummary | undefined =
        ride?.track === undefined
          ? undefined
          : {
              activityId: id,
              athleteId: owner,
              startedAt: ride.activity.startedAt,
              sampleInterval: (ride.sampleIntervalSeconds ??
                1) as StreamSetSummary['sampleInterval'],
              sampleCount: ride.track.length,
              channels: ['latitude', 'longitude'],
              encodedBytes: ride.track.length * 8,
            };
      return read(`summary:${id}`, summary);
    },

    getStreamChannel: <C extends StreamChannel>(
      owner: AthleteId,
      id: ActivityId,
      channel: C,
    ): Promise<Samples<C> | undefined> => {
      const ride = rideOf(owner, id);
      if (ride?.track === undefined) {
        return read(`channel:${channel}:${id}`, undefined);
      }
      if (channel === 'latitude') {
        return read(
          `channel:${channel}:${id}`,
          ride.track.map((point) => point?.latitude) as Samples<C>,
        );
      }
      if (channel === 'longitude') {
        return read(
          `channel:${channel}:${id}`,
          ride.track.map((point) => point?.longitude) as Samples<C>,
        );
      }
      // Every other channel is absent, which is the point: a screen that read
      // one shows up here as an unexpected entry in `reads`.
      return read(`channel:${channel}:${id}`, undefined);
    },
  };

  return port;
}
