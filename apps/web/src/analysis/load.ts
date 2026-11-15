// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The reads the analysis view performs, and the bound on them.
 *
 * Two answers are wanted on this screen and they cost very different things:
 *
 * 1. **Time in zone for one ride** — {@link loadRideZones}. One cheap summary
 *    read decides which of the two channels exist, then at most two channel
 *    decodes. A ride with no power meter costs one decode; a ride with neither
 *    costs none, which is what makes #78's *"a ride with only one of the two
 *    shows only that one rather than an empty chart"* a property of the data
 *    layer rather than a condition in the renderer.
 * 2. **Duration personal bests across the whole library** — {@link loadLibraryBests}.
 *    This one genuinely has to read a channel from **every** ride, because a
 *    personal best is a claim about all of them. It is the most expensive read
 *    in this client and it is bounded, stated and counted rather than hoped
 *    about — see {@link BESTS_ACTIVITY_LIMIT}.
 *
 * ## Why the library curve is recomputed rather than stored
 *
 * A derived table of per-ride curves would make this read cheap and would need
 * its own schema version, its own invalidation and its own answer to "what
 * happens when the threshold or the duration list changes". #75 already
 * established the property that makes recomputation safe — the library curve is
 * a **pointwise maximum**, so folding one ride in and recomputing everything
 * are the same computation — which means a cache here could only ever be a
 * performance decision, never a correctness one. Phase 1 has one device and a
 * library measured in hundreds of rides; the cache is not worth a schema
 * version yet. When it is, `mergeCurves` is already the fold it would use.
 *
 * ⚠️ **Reading a ride's power channel is not the same as reading its samples
 * into the view.** Nothing here returns a series: {@link loadLibraryBests}
 * returns eighteen numbers and {@link loadRideZones} returns one total per
 * zone. The samples exist inside these functions and nowhere above them, which
 * is the same shape `detail/load.ts` uses for a privacy trim and is what keeps
 * a four-hour ride from reaching a component tree.
 */

import {
  effortWeightedPower,
  heartRateLoad,
  heartRateZones,
  mergeCurves,
  powerRideLoad,
  powerDurationCurve,
  powerZones,
  timeInZones,
  type BeatsPerMinute,
  type PowerDurationCurve,
  type RideLoad,
  type Seconds,
  type TimeInZones,
  type Watts,
  type Zone,
  type ZoneBasis,
} from '@onyourleft/domain';
import type { ActivityId, ActivitySummary, StreamSetSummary } from '@onyourleft/store';

import { isPowerBasis } from './summary';
import { thresholdsFor, type AthleteThresholds } from './thresholds';
import type { AnalysisPort } from './store-port';

/**
 * How many rides a personal-best read will decode a power channel from.
 *
 * A stated bound rather than "all of them", for the reason #62 states one on
 * its page size: an unbounded read is fine on the library the author has and
 * unusable on the library somebody has after three years, and the failure is
 * silent until it is severe. Two hundred four-hour rides is about 2.9 million
 * samples, which the O(n) rolling sum in `power-duration.ts` handles in
 * well under a second — the same measurement `power-duration.test.ts` pins.
 *
 * The rides are read newest first, so the bound truncates the oldest history
 * rather than the recent form. {@link LibraryBests.truncated} says so out loud
 * rather than letting the number quietly mean something narrower than "your
 * best ever", which is exactly the kind of claim a rider would not re-derive.
 */
export const BESTS_ACTIVITY_LIMIT = 200;

/**
 * How many rides the zone panel's ride picker offers.
 *
 * Small on purpose. The picker is "which ride's zones am I looking at", not a
 * second activity library — #62's list is the place to find an old ride, and
 * this view links to it. A `<select>` of a thousand options is a control nobody
 * can use with a keyboard in under a minute.
 */
export const RIDE_CHOICE_LIMIT = 20;

/**
 * The rides the picker offers, newest first.
 *
 * Summaries, not records: this is the projection #62's list reads and it
 * decodes no samples at all.
 */
export async function loadRideChoices(
  port: AnalysisPort,
  limit: number = RIDE_CHOICE_LIMIT,
): Promise<readonly ActivitySummary[]> {
  return port.store.listActivitySummaries(port.athleteId, {
    orderBy: 'startedAt',
    direction: 'descending',
    limit,
  });
}

/** One basis's zones and the time spent in them. */
export interface ZoneBreakdown {
  readonly basis: ZoneBasis;
  /** The boundaries, so the view can label each bar with the range it covers. */
  readonly zones: readonly Zone[];
  /** The threshold they were derived from — displayed, so the numbers are checkable. */
  readonly threshold: number;
  readonly time: TimeInZones;
  /**
   * This basis's load for the ride (#76), computed where the samples are.
   *
   * Per basis rather than once, so {@link loadFrom} can prefer power without
   * either function holding a sample. `undefined` when the trace is shorter
   * than the smoothing window, or when the threshold is unusable.
   */
  readonly load: RideLoad | undefined;
}

/** What the zone panel shows for one ride. */
export interface RideZoneAnalysis {
  readonly activityId: ActivityId;
  /**
   * The ride's moving time, from the activity record.
   *
   * Carried beside the breakdowns so the view can state the **coverage**: the
   * per-zone totals sum to {@link TimeInZones.covered}, which is how long the
   * channel reported, and that is not always the moving time. `zones.ts`
   * records both reasons it can differ, in both directions.
   */
  readonly movingTime: Seconds;
  /** Absent when the ride has no power channel — not an empty breakdown. */
  readonly power: ZoneBreakdown | undefined;
  /** Absent when the ride has no heart-rate channel. */
  readonly heartRate: ZoneBreakdown | undefined;
  /**
   * How hard the ride was, in one number, and **which channel it came from**.
   *
   * Power when the ride has it, heart rate when it does not, and `undefined`
   * when it has neither. #76's fifth criterion is that the screen show the
   * basis rather than blend the two silently, and `RideLoad` carries it on the
   * value so a renderer cannot lose track of which it was handed.
   *
   * Computed from the samples the zone read already decoded, so it costs **no
   * extra read** — which is why it lives here rather than in a second loader.
   */
  readonly load: RideLoad | undefined;
  readonly thresholds: AthleteThresholds;
}

/**
 * Time in zone for one ride, on whichever of the two bases it has data for.
 *
 * `undefined` when this athlete has no such ride — which covers "no such id"
 * and "that ride belongs to somebody else" without distinguishing them, for the
 * reason `detail/load.ts` gives.
 */
export async function loadRideZones(
  port: AnalysisPort,
  id: ActivityId,
): Promise<RideZoneAnalysis | undefined> {
  const activity = await port.store.getActivity(port.athleteId, id);
  if (activity === undefined) {
    return undefined;
  }

  const athlete = await port.store.getAthlete(port.athleteId);
  const thresholds = thresholdsFor(athlete);

  // The cheap read first: which channels exist, and at what interval. Deciding
  // from this rather than from a failed decode is what makes "no heart-rate
  // strap" cost nothing at all.
  const streams = await port.store.getStreamSetSummary(port.athleteId, id);

  const power = await breakdownFor(port, id, streams, 'power', thresholds);
  const heartRate = await breakdownFor(port, id, streams, 'heartRate', thresholds);

  return {
    activityId: id,
    movingTime: activity.movingTime,
    power,
    heartRate,
    load: loadFrom(power, heartRate),
    thresholds,
  };
}

/**
 * The ride's load, from power if it has any and from heart rate if not.
 *
 * **Power wins whenever it exists**, and that ordering is a decision rather
 * than a fallback chain's accident: heart rate lags an effort by tens of
 * seconds and saturates, so on a ride carrying both, the power-derived number
 * is the better measurement of the same idea. `packages/domain`'s
 * `analysis/load.ts` records why, and it is the same reasoning that gives heart
 * rate five zones and power seven in `zones.ts`.
 *
 * ⚠️ It picks between two numbers that {@link breakdownFor} already computed,
 * rather than taking the samples. That is not a detail: this file's header
 * states that a ride's samples exist inside these functions and nowhere above
 * them, and hanging a 14 400-sample array off {@link ZoneBreakdown} so that
 * this function could reach it would break exactly that.
 */
function loadFrom(
  power: ZoneBreakdown | undefined,
  heartRate: ZoneBreakdown | undefined,
): RideLoad | undefined {
  return power?.load ?? heartRate?.load;
}

/**
 * One basis's breakdown, or `undefined` if the ride has no such channel.
 *
 * The `undefined` is returned **before** the decode rather than after it: the
 * summary already said whether the channel is there, so a ride without one
 * never inflates a blob to discover that.
 */
async function breakdownFor(
  port: AnalysisPort,
  id: ActivityId,
  streams: StreamSetSummary | undefined,
  basis: ZoneBasis,
  thresholds: AthleteThresholds,
): Promise<ZoneBreakdown | undefined> {
  if (streams === undefined || !streams.channels.includes(basis)) {
    return undefined;
  }
  const samples = await port.store.getStreamChannel(port.athleteId, id, basis);
  if (samples === undefined) {
    return undefined;
  }
  const threshold = basis === 'power' ? thresholds.thresholdPower : thresholds.thresholdHeartRate;
  const zones =
    basis === 'power'
      ? powerZones(thresholds.thresholdPower)
      : heartRateZones(thresholds.thresholdHeartRate);
  return {
    basis,
    zones,
    threshold,
    // The interval comes from the stored set, not from an assumption that a
    // stream is 1 Hz. ADR 0011 stores it per set precisely so that a set
    // written at another rate reports real durations rather than sample counts
    // wearing the word "seconds".
    time: timeInZones(zones, samples, streams.sampleInterval),
    // Computed here, where the samples are local, and returned as one number.
    // Reading this channel a second time to derive it would double the cost of
    // opening this screen for nothing.
    //
    // ⚠️ #1070: a power channel that read nought throughout is no basis, so
    // its load is `undefined` and {@link loadFrom} falls to heart rate — the
    // rule `summary.ts` §`isPowerBasis` applies to the stored half, so this
    // screen and Home agree on a ride's load. The weighting is taken once more
    // over the samples already in memory to ask it; that is arithmetic, not a
    // second read of the channel.
    load:
      basis === 'power'
        ? isPowerBasis(
            effortWeightedPower(samples as readonly (Watts | undefined)[], streams.sampleInterval)
              ?.power,
          )
          ? powerRideLoad(
              samples as readonly (Watts | undefined)[],
              streams.sampleInterval,
              thresholds.thresholdPower,
            )
          : undefined
        : heartRateLoad(
            samples as readonly (BeatsPerMinute | undefined)[],
            streams.sampleInterval,
            thresholds.thresholdHeartRate,
          ),
  };
}

/** The library's duration personal bests, and what they rest on. */
export interface LibraryBests {
  /**
   * The pointwise maximum over every ride's curve — #75's library curve.
   *
   * Empty when no ride in the library has a power channel, which is the
   * ordinary state of a library recorded without a power meter rather than a
   * failure. A curve of zeros would be indistinguishable from a library of
   * genuine zero-watt coasting, so there isn't one.
   */
  readonly curve: PowerDurationCurve;
  /** How many rides were considered. */
  readonly activitiesRead: number;
  /** How many of them actually carried power — the denominator a rider needs. */
  readonly activitiesWithPower: number;
  /**
   * Whether {@link BESTS_ACTIVITY_LIMIT} cut the history short.
   *
   * Surfaced rather than swallowed: "your best twenty minutes" and "your best
   * twenty minutes in your last two hundred rides" are different claims and
   * only one of them is true here.
   */
  readonly truncated: boolean;
}

/**
 * One ride's power curve as {@link loadLibraryBests} last computed it, and the
 * stream summary it was computed from — #2194.
 */
interface HeldCurve {
  /** {@link streamKey} of the summary the curve was read from. */
  readonly key: string;
  readonly curve: PowerDurationCurve;
}

/**
 * Each ride's power curve, held per analysis port — #2194.
 *
 * Every ride page opened asks for the all-time line, and before this each
 * ask decoded up to {@link BESTS_ACTIVITY_LIMIT} power channels and ran a full
 * curve over each. A ride's samples do not change once written, so a curve is
 * kept against the ride's id and reused while the ride's stream summary is
 * the one it was read from.
 *
 * ⚠️ **Invalidated by the write, whichever port made it.** Rides are written
 * by recording, import and sync, none of them through this port, so there is
 * no write here to hook. Instead every ask still lists the rides and reads
 * each one's stream summary, which are the cheap indexed reads: a ride added
 * or deleted changes the list, and a stream written, replaced or deleted
 * changes (or removes) its summary, so its curve is read again. Only the
 * decode and the curve are skipped. A `WeakMap`, so a port nobody holds takes
 * its curves with it.
 */
const HELD_CURVES = new WeakMap<AnalysisPort, Map<ActivityId, HeldCurve>>();

/** What a held curve is checked against: everything a stream summary says about its samples. */
function streamKey(streams: StreamSetSummary): string {
  return [
    String(streams.startedAt),
    String(streams.sampleInterval),
    String(streams.sampleCount),
    String(streams.encodedBytes),
    streams.channels.join(','),
  ].join('|');
}

/**
 * Duration personal bests over the whole library.
 *
 * ⚠️ **Every ride is read on its own and the curves are merged**, never
 * concatenated into one series. `power-duration.ts` records why that is a
 * correctness rule and not a style: concatenating two twenty-minute rides at
 * 300 W would report a forty-minute effort at 300 W that nobody rode.
 *
 * Since #2194 each ride's curve is held on the port and read again only when
 * its stream summary changes ({@link HELD_CURVES}).
 */
export async function loadLibraryBests(
  port: AnalysisPort,
  limit: number = BESTS_ACTIVITY_LIMIT,
): Promise<LibraryBests> {
  // One over the limit, so "there is more history than we read" is answered by
  // the same query rather than by a second count.
  const summaries: ActivitySummary[] = await port.store.listActivitySummaries(port.athleteId, {
    orderBy: 'startedAt',
    direction: 'descending',
    limit: limit + 1,
  });
  const considered = summaries.slice(0, limit);

  const held = HELD_CURVES.get(port);
  // Only the rides listed now are kept: a deleted ride's curve goes with it.
  const kept = new Map<ActivityId, HeldCurve>();
  const curves: PowerDurationCurve[] = [];
  for (const summary of considered) {
    const streams = await port.store.getStreamSetSummary(port.athleteId, summary.id);
    if (streams === undefined || !streams.channels.includes('power')) {
      continue;
    }
    const key = streamKey(streams);
    const before = held?.get(summary.id);
    if (before !== undefined && before.key === key) {
      kept.set(summary.id, before);
      curves.push(before.curve);
      continue;
    }
    const samples = await port.store.getStreamChannel(port.athleteId, summary.id, 'power');
    if (samples === undefined) {
      continue;
    }
    const curve = powerDurationCurve(samples);
    kept.set(summary.id, { key, curve });
    curves.push(curve);
  }
  HELD_CURVES.set(port, kept);

  return {
    curve: mergeCurves(...curves),
    activitiesRead: considered.length,
    activitiesWithPower: curves.length,
    truncated: summaries.length > limit,
  };
}
