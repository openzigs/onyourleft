// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The reads the detail view performs, in the order that keeps them cheap.
 *
 * #50's fourth acceptance criterion, as revised by owner decision D6: *a
 * summary view must not load a full 1 Hz stream*. There is no network in Phase
 * 1, so "transferred size" is the size of what crosses from the store into the
 * component tree, and the boundary is this file. It divides the work in two:
 *
 * 1. {@link loadOverview} — the activity record, the **stream summary** and the
 *    laps. Everything the panel at the top of the view shows. It decodes **not
 *    one sample**: `getStreamSetSummary` reads the small indexed row that ADR
 *    0011 split out for exactly this, so "how long, how far, which channels,
 *    how many bytes" costs a point lookup rather than a quarter of a megabyte
 *    of inflate.
 * 2. {@link loadTrace} — one channel, reduced to chart resolution before it is
 *    returned. Called once per series the rider has switched on, and never for
 *    one they have not.
 *
 * `load.test.ts` counts the calls and the points rather than trusting this
 * comment: an overview that decoded a channel, or a chart handed 14 400 points,
 * fails there.
 */

import type {
  ActivityId,
  ActivityRecord,
  LapRecord,
  StreamSetSummary,
  Samples,
} from '@onyourleft/store';

import { sharedTrack, type SharedTrack } from './privacy';
import { CHART_POINTS, downsample, gapSamples, seriesFor, type TraceChannel } from './series';
import type { DetailPort } from './store-port';

/** Everything the view shows before a single sample is decoded. */
export interface RideOverview {
  readonly activity: ActivityRecord;
  /** `undefined` for a ride with no stored streams at all — an imported summary, say. */
  readonly streams: StreamSetSummary | undefined;
  readonly laps: readonly LapRecord[];
}

/**
 * The overview, or `undefined` when this athlete has no such ride.
 *
 * `undefined` covers both "no such id" and "that ride belongs to somebody
 * else", and deliberately does not distinguish them: the store's reads are
 * athlete-scoped, and a view that said "that ride is not yours" would confirm
 * the id names a real ride.
 */
export async function loadOverview(
  port: DetailPort,
  id: ActivityId,
): Promise<RideOverview | undefined> {
  const activity = await port.store.getActivity(port.athleteId, id);
  if (activity === undefined) {
    return undefined;
  }
  // Sequential rather than `Promise.all`, because the two below are pointless
  // if the activity is not there — and because IndexedDB serialises them
  // anyway, so the parallel spelling buys nothing but a wider failure surface.
  const streams = await port.store.getStreamSetSummary(port.athleteId, id);
  const laps = await port.store.listLaps(port.athleteId, id);
  return { activity, streams, laps };
}

/** One channel, at chart resolution, in the unit it is read in. */
export interface Trace {
  readonly channel: TraceChannel;
  /**
   * The points a chart draws, already in display units, gaps preserved.
   *
   * At most {@link CHART_POINTS} of them however long the ride is — which is
   * the assertion #50's fourth criterion asks for.
   */
  readonly points: readonly (number | undefined)[];
  /** How much ride time one point covers. The x axis, without a per-point array. */
  readonly secondsPerPoint: number;
  /** The stored series' length, so the view can state the reduction it applied. */
  readonly sampleCount: number;
  /**
   * How many stored samples are missing.
   *
   * Counted on the **full** series before the reduction, because a gap shorter
   * than one bucket does not survive downsampling — `series.ts` records why
   * that is the right trade for the drawing and the wrong one for the total.
   */
  readonly missingSamples: number;
}

/**
 * Read one channel and reduce it to chart resolution.
 *
 * `undefined` when the ride has no such channel — which is the ordinary case,
 * not a failure: an indoor ride has no altitude and a ride without a strap has
 * no heart rate.
 *
 * ⚠️ **The display conversion is applied after the reduction, and that is
 * sound only because every conversion in {@link seriesFor} is linear.** Speed's
 * is a multiplication by 3.6, so the mean of the converted values equals the
 * converted mean exactly. A future series with a non-linear reading — a
 * logarithmic axis, a percentage of a threshold — must convert first, and this
 * comment is here so that whoever adds one sees the constraint rather than
 * discovers it as a wrong average.
 */
export async function loadTrace(
  port: DetailPort,
  id: ActivityId,
  channel: TraceChannel,
  targetPoints: number = CHART_POINTS,
): Promise<Trace | undefined> {
  const samples = await port.store.getStreamChannel(port.athleteId, id, channel);
  if (samples === undefined) {
    return undefined;
  }
  const series = seriesFor(channel);
  const reduced = downsample(samples, targetPoints);
  return {
    channel,
    points: reduced.map((value) => (value === undefined ? undefined : series.display(value))),
    secondsPerPoint: reduced.length === 0 ? 0 : samples.length / reduced.length,
    sampleCount: samples.length,
    missingSamples: gapSamples(samples),
  };
}

/**
 * The track a shared copy of this ride would carry — the *preview*, not what
 * the rider's own view draws.
 *
 * Reads the two position channels and the athlete's zones, and hands both to
 * {@link sharedTrack}, which is where every decision lives. `undefined` when
 * the ride has no position at all, which is the indoor case and half of what
 * this product will hold.
 *
 * ⚠️ **The withheld coordinates exist in this function's locals and nowhere
 * above it.** That is the whole shape of ADR 0004 decision C: the trimming is
 * applied to the payload, not by the renderer, so no component ever holds a
 * point inside a zone and no amount of poking at the DOM can recover one.
 */
export async function loadSharedTrack(
  port: DetailPort,
  id: ActivityId,
): Promise<SharedTrack | undefined> {
  const latitude: Samples<'latitude'> | undefined = await port.store.getStreamChannel(
    port.athleteId,
    id,
    'latitude',
  );
  const longitude: Samples<'longitude'> | undefined = await port.store.getStreamChannel(
    port.athleteId,
    id,
    'longitude',
  );
  if (latitude === undefined && longitude === undefined) {
    return undefined;
  }
  const zones = await port.store.listPrivacyZones(port.athleteId);
  return sharedTrack({ activityId: id, latitude, longitude, zones });
}
