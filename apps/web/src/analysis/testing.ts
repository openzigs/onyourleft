// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * An `AnalysisPort` backed by plain objects, for tests and for the
 * accessibility suite.
 *
 * The same shape as `detail/testing.ts` and for the same reasons — including
 * the one that matters most here: **it counts its reads**. The library curve is
 * the most expensive read in this client, and the only way to assert a bound on
 * it is to be able to say exactly which rides were decoded. {@link StubAnalysis.channelReads}
 * is what `load.test.ts` asserts on.
 *
 * The tests that need the *real* store use the #28 round-trip harness instead;
 * `views/AnalysisView.test.tsx` does both and says why at each. A stub cannot
 * answer #78's fifth criterion — *"re-reads through a fresh store handle"* — by
 * construction, because it has no handle to be fresh.
 */

import { seconds, type BeatsPerMinute, type Watts } from '@onyourleft/domain';
import {
  type ActivityId,
  type ActivityRecord,
  type ActivitySummary,
  type AthleteId,
  type AthleteRecord,
  type ListActivitiesOptions,
  type Samples,
  type StreamChannel,
  type StreamSetSummary,
} from '@onyourleft/store';

import type { AnalysisPort, AnalysisStore } from './store-port';

/** One ride in a stub library: its record and whichever channels it carries. */
export interface StubAnalysisRide {
  readonly activity: ActivityRecord;
  readonly power?: readonly (Watts | undefined)[];
  readonly heartRate?: readonly (BeatsPerMinute | undefined)[];
  /** Seconds one sample is worth. Default 1 — ADR 0011's 1 Hz grid. */
  readonly sampleInterval?: number;
}

export interface StubAnalysis extends AnalysisPort {
  /** Every channel decode, as `activityId:channel`. The read budget, observable. */
  readonly channelReads: string[];
  /** Every cheap summary read, by activity id. */
  readonly summaryReads: string[];
  /** Every `listActivitySummaries` call's options, so a limit can be asserted. */
  readonly listReads: ListActivitiesOptions[];
  /** Every load-summary write, in order, so a backfill's work is countable. */
  readonly summaryWrites: ActivityId[];
  /** Every threshold save, so a test can assert what the form sent. */
  readonly thresholdWrites: {
    readonly thresholdPower?: Watts;
    readonly thresholdHeartRate?: BeatsPerMinute;
  }[];
}

/**
 * A port over a library of rides and one athlete.
 *
 * `athlete` may be `undefined`, which is the state of a browser that has never
 * recorded anything and is exactly what `thresholdsFor` has to handle.
 */
export function stubAnalysis(
  owner: AthleteId,
  rides: readonly StubAnalysisRide[],
  athlete?: AthleteRecord,
): StubAnalysis {
  const channelReads: string[] = [];
  const summaryReads: string[] = [];
  const listReads: ListActivitiesOptions[] = [];
  const summaryWrites: ActivityId[] = [];
  const overrides = new Map<ActivityId, ActivityRecord>();
  const thresholdWrites: {
    readonly thresholdPower?: Watts;
    readonly thresholdHeartRate?: BeatsPerMinute;
  }[] = [];

  function rideFor(id: ActivityId): StubAnalysisRide | undefined {
    const found = rides.find((ride) => ride.activity.id === id);
    if (found === undefined) {
      return undefined;
    }
    const written = overrides.get(id);
    return written === undefined ? found : { ...found, activity: written };
  }

  function channelsOf(ride: StubAnalysisRide): StreamChannel[] {
    const present: StreamChannel[] = [];
    if (ride.power !== undefined) {
      present.push('power');
    }
    if (ride.heartRate !== undefined) {
      present.push('heartRate');
    }
    return present;
  }

  // Mutable, because the threshold editor's whole point is that a save is
  // visible on the next read. A stub whose athlete never changed would make
  // "the boundaries moved" an assertion about the component's own state.
  let stored = athlete;

  const store: AnalysisStore = {
    getAthlete: (id: AthleteId) =>
      Promise.resolve(stored !== undefined && stored.id === id ? stored : undefined),

    setAthleteThresholds: (id: AthleteId, next) => {
      if (stored === undefined || stored.id !== id) {
        return Promise.resolve(undefined);
      }
      // Replaces both, like the real store: `undefined` means "not set".
      stored = {
        id: stored.id,
        displayName: stored.displayName,
        createdAt: stored.createdAt,
        ...(next.thresholdPower === undefined ? {} : { thresholdPower: next.thresholdPower }),
        ...(next.thresholdHeartRate === undefined
          ? {}
          : { thresholdHeartRate: next.thresholdHeartRate }),
      };
      thresholdWrites.push(next);
      return Promise.resolve(stored);
    },

    getActivity: (_owner: AthleteId, id: ActivityId) => Promise.resolve(rideFor(id)?.activity),

    setActivityLoadSummary: (_owner: AthleteId, id: ActivityId, summary) => {
      const ride = rideFor(id);
      if (ride === undefined) {
        return Promise.resolve(false);
      }
      // Written onto the stub's own record, so the next `listActivitySummaries`
      // sees it — a stub that accepted the write and answered the old record
      // would make a backfill test assert nothing.
      summaryWrites.push(id);
      overrides.set(id, {
        ...ride.activity,
        ...(summary.effortWeightedPower === undefined
          ? {}
          : { effortWeightedPower: summary.effortWeightedPower }),
        ...(summary.effortWeightedHeartRate === undefined
          ? {}
          : { effortWeightedHeartRate: summary.effortWeightedHeartRate }),
        loadCoveredTime: summary.loadCoveredTime,
      });
      return Promise.resolve(true);
    },

    listActivitySummaries: (_owner: AthleteId, options: ListActivitiesOptions = {}) => {
      listReads.push(options);
      // ⚠️ The ordering options are **honoured**, not ignored. A stub that
      // always answered newest-first would make "the loader reads newest
      // first" an assertion about the stub — which is how a mutation that
      // flips `direction` to ascending survives. It did, until this was
      // written; `stubLibrary` had the same shape and for the same reason.
      const { orderBy = 'startedAt', direction = 'descending' } = options;
      const key = (ride: StubAnalysisRide): number =>
        orderBy === 'distance' ? ride.activity.distance : ride.activity.startedAt;
      const sorted = [...rides].sort((left, right) =>
        direction === 'descending' ? key(right) - key(left) : key(left) - key(right),
      );
      // `ActivitySummary` is `ActivityRecord` minus the original-file
      // reference — the projection #62's list reads — so a record satisfies it
      // structurally and no field is copied by hand. The stub rides carry no
      // `originalFile` anyway; a stub that did would hand the caller one extra
      // property, which nothing in this view reads.
      const summaries: ActivitySummary[] = sorted.map(
        ({ activity }) => overrides.get(activity.id) ?? activity,
      );
      const { offset = 0, limit } = options;
      const from = summaries.slice(offset);
      return Promise.resolve(limit === undefined ? from : from.slice(0, limit));
    },

    getStreamSetSummary: (_owner: AthleteId, id: ActivityId) => {
      summaryReads.push(id);
      const ride = rideFor(id);
      if (ride === undefined) {
        return Promise.resolve(undefined);
      }
      const channels = channelsOf(ride);
      if (channels.length === 0) {
        return Promise.resolve(undefined);
      }
      const sampleCount = Math.max(ride.power?.length ?? 0, ride.heartRate?.length ?? 0);
      const summary: StreamSetSummary = {
        activityId: id,
        athleteId: owner,
        startedAt: ride.activity.startedAt,
        sampleInterval: seconds(ride.sampleInterval ?? 1),
        sampleCount,
        channels,
        // Plausible rather than measured, for `detail/testing.ts`'s reason:
        // nothing here does arithmetic on it.
        encodedBytes: sampleCount * channels.length * 2,
      };
      return Promise.resolve(summary);
    },

    getStreamChannel: <C extends StreamChannel>(
      _owner: AthleteId,
      id: ActivityId,
      channel: C,
    ): Promise<Samples<C> | undefined> => {
      channelReads.push(`${id}:${channel}`);
      const ride = rideFor(id);
      if (ride === undefined) {
        return Promise.resolve(undefined);
      }
      const series =
        channel === 'power' ? ride.power : channel === 'heartRate' ? ride.heartRate : undefined;
      return Promise.resolve(series as Samples<C> | undefined);
    },
  };

  return {
    athleteId: owner,
    store,
    channelReads,
    summaryReads,
    listReads,
    summaryWrites,
    thresholdWrites,
  };
}
