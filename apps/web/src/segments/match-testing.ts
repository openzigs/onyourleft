// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A `MatchPort` backed by plain objects, for the sweep's tests (#66).
 *
 * The same shape as `segments/testing.ts`, and it counts its reads and its
 * writes for the same reason: the claims worth pinning about a backfill are how
 * much it reads per activity, and that stopping it part-way and resuming does
 * not double-count.
 *
 * ⚠️ **Answers a read only when the requester matches the ROW's own athlete**,
 * as the store's compound indexes do. A stub that keyed on the port's owner
 * would answer a request for another athlete's ride whenever the port happened
 * to belong to whoever asked, which is a scope that checks nothing —
 * `segments/testing.ts` records that the first version of it did exactly that.
 *
 * ⚠️ **`putActivityEfforts` REPLACES this activity's efforts**, because that is
 * what the real store does and it is the mechanism #66's idempotence rests on.
 * A stub that appended would make every idempotence test here pass against a
 * store that could not deliver it.
 */

import type { GeographicPosition } from '@onyourleft/domain';
import type {
  ActivityId,
  ActivityRecord,
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

import type { MatchPort, MatchStore } from './match-port';

/** One ride in a stub library. */
export interface StubMatchRide {
  readonly activity: ActivityRecord;
  /**
   * The recorded track, one entry per sample slot.
   *
   * ⚠️ **A gap is an `undefined` entry, never an interpolation** — which is
   * exactly how a gap reaches the store, and the only shape from which
   * `backfill.ts` can reconstruct the time jump the matcher needs to see.
   */
  readonly track?: readonly (GeographicPosition | undefined)[];
  readonly sampleIntervalSeconds?: number;
}

export interface StubMatch extends Omit<MatchPort, 'store'> {
  store: MatchStore;
  readonly reads: string[];
  /** Every `putActivityEfforts` call, as it was made. */
  readonly writes: { activityId: ActivityId; efforts: readonly SegmentEffortRecord[] }[];
  /** What is actually stored, after replacement. */
  readonly stored: Map<string, SegmentEffortRecord>;
  /** Set to make the next `putActivityEfforts` throw — how a kill is modelled. */
  failNextWrite: boolean;
}

export interface StubMatchOptions {
  readonly athleteId: AthleteId;
  readonly athlete?: AthleteRecord;
  readonly rides: readonly StubMatchRide[];
  readonly segments?: readonly SegmentRecord[];
  readonly zones?: readonly PrivacyZoneRecord[];
}

export function stubMatchPort(options: StubMatchOptions): StubMatch {
  const reads: string[] = [];
  const writes: { activityId: ActivityId; efforts: readonly SegmentEffortRecord[] }[] = [];
  const stored = new Map<string, SegmentEffortRecord>();
  let checkpoint: MatchCheckpointRecord | undefined;

  // ⚠️ Built once and mutated, never spread into a copy at the end. The store's
  // closure reads `port.failNextWrite`, and returning `{ ...port, store }`
  // would hand the caller a DIFFERENT object — so setting the flag on it would
  // do nothing and the interruption test would silently pass by never
  // interrupting. It did exactly that once.
  const port: StubMatch = {
    athleteId: options.athleteId,
    reads,
    writes,
    stored,
    failNextWrite: false,
    store: undefined as unknown as MatchStore,
  };

  const rideOf = (owner: AthleteId, id: ActivityId): StubMatchRide | undefined =>
    options.rides.find((ride) => ride.activity.id === id && ride.activity.athleteId === owner);

  const store: MatchStore = {
    listActivitySummaries: (
      owner: AthleteId,
      listOptions: ListActivitiesOptions = {},
    ): Promise<ActivitySummary[]> => {
      reads.push(`list:${owner}`);
      let rows = options.rides
        .filter((ride) => ride.activity.athleteId === owner)
        .map((ride) => ride.activity)
        .sort((a, b) => a.startedAt - b.startedAt);
      const after = listOptions.startedAfter;
      if (after !== undefined) {
        rows = rows.filter((row) => row.startedAt > after);
      }
      if (listOptions.limit !== undefined) {
        rows = rows.slice(0, listOptions.limit);
      }
      return Promise.resolve(rows.map((row) => ({ ...row })));
    },

    getStreamSetSummary: (
      owner: AthleteId,
      id: ActivityId,
    ): Promise<StreamSetSummary | undefined> => {
      reads.push(`summary:${id}`);
      const ride = rideOf(owner, id);
      if (ride?.track === undefined) {
        return Promise.resolve(undefined);
      }
      return Promise.resolve({
        activityId: id,
        athleteId: owner,
        startedAt: ride.activity.startedAt,
        sampleInterval: (ride.sampleIntervalSeconds ?? 1) as StreamSetSummary['sampleInterval'],
        sampleCount: ride.track.length,
        channels: ['latitude', 'longitude'],
        encodedBytes: ride.track.length * 8,
      });
    },

    getStreamChannel: <C extends StreamChannel>(
      owner: AthleteId,
      id: ActivityId,
      channel: C,
    ): Promise<Samples<C> | undefined> => {
      reads.push(`channel:${channel}:${id}`);
      const ride = rideOf(owner, id);
      if (ride?.track === undefined) {
        return Promise.resolve(undefined);
      }
      if (channel === 'latitude') {
        return Promise.resolve(ride.track.map((point) => point?.latitude) as Samples<C>);
      }
      if (channel === 'longitude') {
        return Promise.resolve(ride.track.map((point) => point?.longitude) as Samples<C>);
      }
      // Every other channel is absent, which is the point: a sweep that read
      // one would show up here as an unexpected entry in `reads`.
      return Promise.resolve(undefined);
    },

    listSegments: (owner: AthleteId): Promise<SegmentRecord[]> => {
      reads.push(`segments:${owner}`);
      return Promise.resolve((options.segments ?? []).filter((s) => s.createdBy === owner));
    },

    listPrivacyZones: (owner: AthleteId): Promise<PrivacyZoneRecord[]> => {
      reads.push(`zones:${owner}`);
      return Promise.resolve((options.zones ?? []).filter((zone) => zone.athleteId === owner));
    },

    getAthlete: (owner: AthleteId): Promise<AthleteRecord | undefined> => {
      reads.push(`athlete:${owner}`);
      return Promise.resolve(options.athlete?.id === owner ? options.athlete : undefined);
    },

    putActivityEfforts: (
      owner: AthleteId,
      activityId: ActivityId,
      efforts: readonly SegmentEffortRecord[],
    ): Promise<number> => {
      if (port.failNextWrite) {
        port.failNextWrite = false;
        return Promise.reject(new Error('the tab was closed mid-sweep'));
      }
      writes.push({ activityId, efforts: [...efforts] });
      // Replace, exactly as the real store does.
      for (const [key, value] of [...stored.entries()]) {
        if (value.activityId === activityId && value.athleteId === owner) {
          stored.delete(key);
        }
      }
      for (const effort of efforts) {
        stored.set(effort.id, effort);
      }
      return Promise.resolve(efforts.length);
    },

    listEfforts: (owner: AthleteId, segment: SegmentId): Promise<SegmentEffortRecord[]> => {
      reads.push(`efforts:${segment}`);
      const found = [...stored.values()]
        .filter(
          (effort) =>
            effort.athleteId === owner &&
            effort.segmentId === segment &&
            effort.visibility !== 'excluded',
        )
        .sort((a, b) => a.elapsed - b.elapsed);
      return Promise.resolve(found);
    },

    getMatchCheckpoint: (): Promise<MatchCheckpointRecord | undefined> =>
      Promise.resolve(checkpoint),
    putMatchCheckpoint: (record: MatchCheckpointRecord): Promise<void> => {
      checkpoint = record;
      return Promise.resolve();
    },
    clearMatchCheckpoint: (): Promise<void> => {
      checkpoint = undefined;
      return Promise.resolve();
    },
  };

  port.store = store;
  return port;
}
