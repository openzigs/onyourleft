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
  heartRateZones,
  mergeCurves,
  powerDurationCurve,
  powerZones,
  timeInZones,
  type PowerDurationCurve,
  type Seconds,
  type TimeInZones,
  type Zone,
  type ZoneBasis,
} from '@onyourleft/domain';
import type { ActivityId, ActivitySummary, StreamSetSummary } from '@onyourleft/store';

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

  return {
    activityId: id,
    movingTime: activity.movingTime,
    power: await breakdownFor(port, id, streams, 'power', thresholds),
    heartRate: await breakdownFor(port, id, streams, 'heartRate', thresholds),
    thresholds,
  };
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
 * Duration personal bests over the whole library.
 *
 * ⚠️ **Every ride is read on its own and the curves are merged**, never
 * concatenated into one series. `power-duration.ts` records why that is a
 * correctness rule and not a style: concatenating two twenty-minute rides at
 * 300 W would report a forty-minute effort at 300 W that nobody rode.
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

  const curves: PowerDurationCurve[] = [];
  for (const summary of considered) {
    const streams = await port.store.getStreamSetSummary(port.athleteId, summary.id);
    if (streams === undefined || !streams.channels.includes('power')) {
      continue;
    }
    const samples = await port.store.getStreamChannel(port.athleteId, summary.id, 'power');
    if (samples === undefined) {
      continue;
    }
    curves.push(powerDurationCurve(samples));
  }

  return {
    curve: mergeCurves(...curves),
    activitiesRead: considered.length,
    activitiesWithPower: curves.length,
    truncated: summaries.length > limit,
  };
}
