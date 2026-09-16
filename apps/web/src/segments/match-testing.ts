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
      // ⚠️ **Ties broken on the id, as the store breaks them.** IndexedDB
      // orders index entries with equal keys by primary key, so two rides that
      // started in the same second come back in id order — and a stub sorting
      // on the instant alone would put them in insertion order and make the
      // cursor below untestable. #293.
      let rows = options.rides
        .filter((ride) => ride.activity.athleteId === owner)
        .map((ride) => ride.activity)
        .sort((a, b) => a.startedAt - b.startedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      const after = listOptions.startedAfter;
      const afterId = listOptions.afterActivityId;
      if (after !== undefined) {
        // ⚠️ **The cursor is a PAIR, and half of one is refused rather than
        // interpreted.** `startedAfter` on its own is strictly after the
        // instant, which cannot separate two rides that started in the same
        // second — so a stub that quietly accepted it would agree with a store
        // that skips a ride, which is the #293 defect reintroduced inside the
        // double that is supposed to catch it. The store is free to take the
        // instant alone; no caller in this client now does, and #306 was the
        // last one — `export-everything.ts` carried the instant by itself until
        // then and lost exactly the ride this refusal describes.
        if (afterId === undefined) {
          throw new Error(
            'the sweep cursor is a pair: startedAfter was given without afterActivityId',
          );
        }
        rows = rows.filter(
          (row) => row.startedAt > after || (row.startedAt === after && row.id > afterId),
        );
      }
      if (listOptions.limit !== undefined) {
        // After the cursor, never before it — a page budget spent on rides
        // already covered is an empty page that reads as an exhausted library.
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

/**
 * A sweep held at its first library page, so a second call to `matchLibrary`
 * is genuinely concurrent with the first (#294).
 *
 * ⚠️ **Without a hold there is no test.** Every read this stub answers
 * resolves on the next microtask, so a sweep started and not awaited is
 * finished before anything a test does next — and a second call that "cannot
 * start a second loop" would be asserted against a first loop that had already
 * ended. That test passes with no guard in the code at all, which is CLAUDE.md
 * §5's test that cannot fail.
 */
export interface HeldPage {
  /** Resolves once the sweep has asked for its first page and is waiting. */
  readonly reached: Promise<void>;
  /** Lets it go. */
  release: () => void;
}

/**
 * Hold this port's **first** library page until {@link HeldPage.release}.
 *
 * Only the first: a sweep that is released has to be able to run its remaining
 * pages, and a hold that fired on every page would deadlock the release.
 *
 * ⚠️ **Wraps the store rather than mutating the method in place**, because the
 * closures `stubMatchPort` built read `port.failNextWrite` off the port object
 * and a copy of the port would silently stop the kill switch working — the
 * trap that file's own comment records. Spreading the *store* keeps every one
 * of those closures, and the wrapper delegates to the original rather than to
 * itself.
 */
export function holdFirstLibraryPage(port: StubMatch): HeldPage {
  const inner = port.store;
  const reached = deferred();
  const released = deferred();
  let held = false;

  port.store = {
    ...inner,
    listActivitySummaries: async (owner, listOptions) => {
      if (!held) {
        held = true;
        reached.settle();
        await released.promise;
      }
      return inner.listActivitySummaries(owner, listOptions);
    },
  };

  return { reached: reached.promise, release: released.settle };
}

/** A promise and the handle that settles it. */
function deferred(): { readonly promise: Promise<void>; readonly settle: () => void } {
  // Assigned by the executor, which runs synchronously — there is no window in
  // which `settle` is the uninitialised binding.
  let settle!: () => void;
  const promise = new Promise<void>((resolve) => {
    settle = resolve;
  });
  return { promise, settle };
}
