// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A `DetailPort` backed by plain objects, for tests and for the accessibility
 * suite.
 *
 * Not a mock of the store: it is the narrowest thing that satisfies the port,
 * so a test using it exercises the view's own reading and reducing rather than
 * a rehearsal of them. The tests that need the *real* store use the #28 harness
 * instead — `views/ActivityDetailView.test.tsx` does both and says why at each.
 *
 * ⚠️ **It counts its reads**, and that is the point rather than a convenience.
 * #50's fourth acceptance criterion is a read budget, and the only way to
 * assert a budget is to be able to say "this render issued exactly these
 * reads". {@link StubDetail.channelReads} is what
 * `detail/load.test.ts` and the view's tests assert on.
 */

import { metres, seconds, unixSeconds } from '@onyourleft/domain';
import {
  activityId as toActivityId,
  DEFAULT_VISIBILITY,
  lapId,
  type ActivityId,
  type ActivityRecord,
  type AthleteId,
  type LapRecord,
  type PrivacyZoneRecord,
  type Samples,
  type StreamChannel,
  type StreamSetSummary,
} from '@onyourleft/store';

import type { DetailPort, DetailStore } from './store-port';

/** The channels a stub ride carries, as a partial map of full-resolution series. */
export type StubChannels = {
  readonly [C in StreamChannel]?: Samples<C>;
};

export interface StubRide {
  readonly activity: ActivityRecord;
  readonly channels: StubChannels;
  readonly laps: readonly LapRecord[];
  readonly sampleInterval?: number;
}

export interface StubDetail extends DetailPort {
  /** Every channel read, in order. The read budget, observable. */
  readonly channelReads: StreamChannel[];
  /** Every `getStreamSetSummary` call. One per view open, never per series. */
  readonly summaryReads: number[];
  /**
   * How many times the athlete's privacy zones were read.
   *
   * Counted since #63: the rider's own map is drawn from the untrimmed track
   * and reads no zones at all, so "did this render consult the zones" is the
   * observable that separates the owner's view from the shared preview.
   */
  readonly zoneReads: number[];
}

/**
 * A complete, ordinary activity record.
 *
 * Every field supplied, so a test that cares about one of them overrides just
 * that one and nothing is silently defaulted into a shape the store would
 * never produce.
 */
export function stubActivity(overrides: Partial<ActivityRecord> = {}): ActivityRecord {
  return {
    id: toActivityId('ride-1'),
    athleteId: 'athlete-a' as AthleteId,
    name: 'Tuesday morning',
    startedAt: unixSeconds(1_760_000_000),
    startedAtTimeZone: 'Europe/London',
    elapsedTime: seconds(3600),
    movingTime: seconds(3500),
    distance: metres(42_195),
    visibility: DEFAULT_VISIBILITY,
    hasPosition: false,
    createdAt: unixSeconds(1_760_003_600),
    ...overrides,
  };
}

/** One lap, for the lap table. */
export function stubLap(ordinal: number, overrides: Partial<LapRecord> = {}): LapRecord {
  return {
    id: lapId(`lap-${String(ordinal)}`),
    activityId: toActivityId('ride-1'),
    athleteId: 'athlete-a' as AthleteId,
    ordinal,
    startedAt: unixSeconds(1_760_000_000 + ordinal * 600),
    elapsedTime: seconds(600),
    movingTime: seconds(590),
    distance: metres(7000),
    ...overrides,
  };
}

/**
 * A port over one ride.
 *
 * `zones` are the athlete's, not the ride's — that is how the store holds them,
 * and it is what makes the shared view's answer change when a rider adds a zone
 * rather than when they edit a ride.
 */
export function stubDetail(
  owner: AthleteId,
  ride: StubRide,
  zones: readonly PrivacyZoneRecord[] = [],
): StubDetail {
  const channelReads: StreamChannel[] = [];
  const summaryReads: number[] = [];
  const zoneReads: number[] = [];
  const present = Object.keys(ride.channels) as StreamChannel[];
  const sampleCount = Math.max(0, ...present.map((channel) => ride.channels[channel]?.length ?? 0));

  const summary: StreamSetSummary | undefined =
    present.length === 0
      ? undefined
      : {
          activityId: ride.activity.id,
          athleteId: owner,
          startedAt: ride.activity.startedAt,
          sampleInterval: seconds(ride.sampleInterval ?? 1),
          sampleCount,
          channels: present,
          // A plausible packed size rather than a measured one: nothing in the
          // view does arithmetic on it, and inventing a measurement would be
          // the fixture claiming to know something it cannot.
          encodedBytes: sampleCount * present.length * 2,
        };

  const store: DetailStore = {
    getActivity: (_owner: AthleteId, id: ActivityId) =>
      Promise.resolve(id === ride.activity.id ? ride.activity : undefined),
    getStreamSetSummary: (_owner: AthleteId, id: ActivityId) => {
      summaryReads.push(summaryReads.length);
      return Promise.resolve(id === ride.activity.id ? summary : undefined);
    },
    getStreamChannel: <C extends StreamChannel>(
      _owner: AthleteId,
      id: ActivityId,
      channel: C,
    ): Promise<Samples<C> | undefined> => {
      channelReads.push(channel);
      if (id !== ride.activity.id) {
        return Promise.resolve(undefined);
      }
      return Promise.resolve(ride.channels[channel]);
    },
    listLaps: (_owner: AthleteId, id: ActivityId) =>
      Promise.resolve(id === ride.activity.id ? [...ride.laps] : []),
    listPrivacyZones: () => {
      zoneReads.push(zoneReads.length);
      return Promise.resolve([...zones]);
    },
  };

  return { athleteId: owner, store, channelReads, summaryReads, zoneReads };
}
