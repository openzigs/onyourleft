// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What a ride's traces are, and how many points of each one reaches the screen.
 *
 * Pure. Nothing here reads a store, renders anything or knows what a pixel is —
 * which is what lets #50's fourth and second acceptance criteria be tested as
 * arithmetic rather than by measuring a rendered chart.
 *
 * ## The two rules a downsampler for *this* data has to get right
 *
 * 1. **A gap must survive.** `packages/store`'s streams encode a missing sample
 *    as `undefined`, never as zero (ADR 0011, and `streams.ts` says why at
 *    length). A bucket average that treats absence as zero draws a heart rate
 *    dropping to nothing and climbing back, which is a cardiac event rendered
 *    from a loose strap. So absence is carried through, and a bucket with no
 *    readings at all is itself absent.
 * 2. **The reduction must be cheap and one-pass.** A four-hour ride is 14 400
 *    samples per channel, and #50's seventh criterion puts a budget on
 *    rendering one. Every function here visits each sample once.
 *
 * ⚠️ **A gap shorter than one bucket is absorbed, and that is a deliberate
 * limit rather than an oversight.** At {@link CHART_POINTS} points a four-hour
 * ride buckets 24 samples together, so a three-second dropout inside a bucket
 * with twenty-one good readings is averaged away. Preserving it would mean
 * marking a bucket absent when *any* sample in it is absent, which turns one
 * lost packet into a 24-second hole in the trace — a far more misleading
 * picture. The rule chosen here is the one that only ever reports data that
 * exists; {@link gapSamples} is what lets the view state the total honestly
 * from the full series rather than from the drawn one.
 */

import type { MetresPerSecond } from '@onyourleft/domain';
import type { StreamChannel, UnitSystem } from '@onyourleft/store';

import { POWER_UNIT } from '../format';
import {
  smallDistanceIn,
  smallDistanceUnit,
  speedIn,
  speedUnit,
  formatSpeed,
  formatSmallDistance,
} from '../units/format';

/**
 * A channel that is drawn as a trace against time.
 *
 * Latitude and longitude are excluded by type rather than by convention: they
 * are a *track*, and plotting either one against time produces a line that
 * looks like data and means nothing. They are read by `privacy.ts` instead,
 * which is the only file that touches them.
 */
export type TraceChannel = Exclude<StreamChannel, 'latitude' | 'longitude'>;

export interface TraceSeriesDefinition {
  readonly channel: TraceChannel;
  /** The name a rider reads. Also the chart's caption and the table's. */
  readonly label: string;
  /** The unit the *displayed* number is in, which is not always the stored one. */
  readonly unit: string;
  /**
   * Stored canonical value → the number shown.
   *
   * The identity for every channel but speed and altitude, which are stored
   * canonically — metres per second, metres — and read in whichever units the
   * rider has chosen. The conversion goes through `units/format.ts`, which is
   * the one place in this client that decides a unit (#238).
   */
  readonly display: (value: number) => number;
  /** The displayed number as digits, without its unit. */
  readonly format: (value: number) => string;
}

const whole = (value: number): string => String(Math.round(value));

/**
 * Every trace, in the order a rider reads them.
 *
 * Power first because it is the number an indoor ride is about, heart rate
 * second because it is the one an outdoor ride is about, and altitude near the
 * end because it is absent from half the rides this product will hold.
 */
export function traceSeries(units: UnitSystem): readonly TraceSeriesDefinition[] {
  return [
    {
      channel: 'power',
      label: 'Power',
      unit: POWER_UNIT,
      display: (value) => value,
      format: whole,
    },
    {
      channel: 'heartRate',
      label: 'Heart rate',
      unit: 'bpm',
      display: (value) => value,
      format: whole,
    },
    {
      channel: 'cadence',
      label: 'Cadence',
      unit: 'rpm',
      display: (value) => value,
      format: whole,
    },
    {
      channel: 'speed',
      label: 'Speed',
      unit: speedUnit(units),
      display: (value) => speedIn(value as MetresPerSecond, units),
      format: (value) => formatSpeed(value as MetresPerSecond, units).value,
    },
    {
      channel: 'altitude',
      label: 'Altitude',
      // ⚠️ `display` and `format` do **not** compose here, and that is why the
      // two are separate fields: `display` converts a stored value for the
      // chart's geometry, `format` converts a stored value for the table's
      // text. Both take the canonical metres. Feeding one the other's output
      // would convert twice, which is a 3.3× error in the direction nobody
      // checks.
      unit: smallDistanceUnit(units),
      display: (value) => smallDistanceIn(value, units),
      format: (value) => formatSmallDistance(value, units).value,
    },
    {
      channel: 'temperature',
      label: 'Temperature',
      // ⚠️ **Celsius in both systems, deliberately.** ADR 0020 D-1's single
      // switch covers distance, speed, elevation and weight; temperature is
      // not in that list and this client has never rendered a Fahrenheit
      // reading. Adding one is additive and is not this issue's.
      unit: '°C',
      display: (value) => value,
      format: whole,
    },
  ];
}

/** A series by channel. Total over {@link TraceChannel}, so no caller needs a fallback. */
export function seriesFor(channel: TraceChannel, units: UnitSystem): TraceSeriesDefinition {
  const found = traceSeries(units).find((series) => series.channel === channel);
  if (found === undefined) {
    // Unreachable while `traceSeries` covers `TraceChannel`, which the test
    // `series.test.ts` asserts directly rather than trusting this line.
    throw new Error(`no trace series is defined for the ${channel} channel`);
  }
  return found;
}

/**
 * The traces switched on when the view opens.
 *
 * Two rather than six, and this is the read budget rather than a taste
 * decision: each enabled series costs one `getStreamChannel`, which inflates
 * and decodes that channel's blob. Opening every series by default would
 * decode the whole set, which is the read the port exists to make impossible.
 *
 * Power and heart rate because between them they cover the indoor and the
 * outdoor case. Everything else is one press away.
 */
export const DEFAULT_SERIES: readonly TraceChannel[] = ['power', 'heartRate'];

/**
 * How many points a trace is reduced to before it is drawn.
 *
 * "Appropriate to the chart width" in #50's fourth criterion, made concrete:
 * the chart's viewBox is 600 units wide, so 600 points is one per unit and
 * anything beyond it is drawn on top of itself. A four-hour ride is 14 400
 * samples, so this is a 24-fold reduction on the read that reaches the DOM.
 *
 * Not a measured `clientWidth`: jsdom performs no layout, so a width read from
 * the DOM is 0 in every test in this repository and the budget would be
 * unassertable — which is the shape of criterion that gets deleted later. A
 * declared width the stylesheet and the chart agree on is checkable.
 */
export const CHART_POINTS = 600;

/**
 * How many rows the numbers table beside a chart carries.
 *
 * Small deliberately. The table is #50's sixth criterion — the non-visual
 * equivalent — and six hundred rows is not an equivalent of anything: a screen
 * reader user would be reading for twenty minutes. Twenty-four rows is a ride
 * summarised at roughly ten-minute resolution for a four-hour ride and
 * two-and-a-half-minute resolution for an hour, which is the granularity a
 * person actually asks a chart for.
 */
export const TABLE_ROWS = 24;

/**
 * Reduce a sample series to at most `targetPoints` points, preserving gaps.
 *
 * Buckets of equal width in *samples*, each averaged over the readings it
 * actually has. A bucket with no readings at all comes back `undefined`, which
 * is what makes {@link traceSegments} able to break the line there.
 *
 * A series already at or below the target is returned unchanged rather than
 * re-bucketed: re-averaging a short ride would move every point for no reason.
 *
 * @throws {RangeError} if `targetPoints` is not a positive integer. A zero
 * would divide by zero and return an empty chart, which renders as a blank
 * panel and looks like a ride with no data.
 */
export function downsample(
  samples: readonly (number | undefined)[],
  targetPoints: number,
): readonly (number | undefined)[] {
  if (!Number.isInteger(targetPoints) || targetPoints <= 0) {
    throw new RangeError(
      `a chart needs a positive whole number of points, not ${String(targetPoints)}`,
    );
  }
  if (samples.length <= targetPoints) {
    return [...samples];
  }

  const width = samples.length / targetPoints;
  const points: (number | undefined)[] = [];
  for (let bucket = 0; bucket < targetPoints; bucket += 1) {
    const start = Math.floor(bucket * width);
    const end = Math.min(samples.length, Math.floor((bucket + 1) * width));
    let total = 0;
    let count = 0;
    for (let index = start; index < end; index += 1) {
      const value = samples[index];
      if (value !== undefined) {
        total += value;
        count += 1;
      }
    }
    points.push(count === 0 ? undefined : total / count);
  }
  return points;
}

/** One unbroken run of a trace: where it starts, and the values in it. */
export interface TraceSegment {
  /** The index of the first point, in the downsampled series. */
  readonly from: number;
  readonly values: readonly number[];
}

/**
 * Split a downsampled series into the runs that can be drawn as one line.
 *
 * This is the whole of #50's second acceptance criterion on the data side: a
 * gap ends a segment, so a renderer drawing one path per segment cannot join
 * across it. The alternative — one path with the gap's points omitted — draws a
 * straight line between the two sides, which reads as a steady effort and is
 * indistinguishable from real data.
 *
 * A single isolated reading between two gaps is its own segment of length one.
 * It is kept rather than dropped: a renderer shows it as a point, and dropping
 * it would be this function deciding a real reading is noise.
 */
export function traceSegments(points: readonly (number | undefined)[]): readonly TraceSegment[] {
  const segments: TraceSegment[] = [];
  let from = -1;
  let values: number[] = [];
  points.forEach((value, index) => {
    if (value === undefined) {
      if (values.length > 0) {
        segments.push({ from, values });
        values = [];
      }
      from = -1;
      return;
    }
    if (values.length === 0) {
      from = index;
    }
    values.push(value);
  });
  if (values.length > 0) {
    segments.push({ from, values });
  }
  return segments;
}

/** How many samples of a full series are missing. Counted on the stored series, not the drawn one. */
export function gapSamples(samples: readonly (number | undefined)[]): number {
  let missing = 0;
  for (const value of samples) {
    if (value === undefined) {
      missing += 1;
    }
  }
  return missing;
}

/** The smallest and largest reading in a series, or `undefined` for a series with none. */
export function traceExtent(
  points: readonly (number | undefined)[],
): { readonly low: number; readonly high: number } | undefined {
  let low = Number.POSITIVE_INFINITY;
  let high = Number.NEGATIVE_INFINITY;
  let seen = false;
  for (const value of points) {
    if (value === undefined) {
      continue;
    }
    seen = true;
    low = Math.min(low, value);
    high = Math.max(high, value);
  }
  return seen ? { low, high } : undefined;
}

/** The mean of the readings a series has, ignoring its gaps. `undefined` when it has none. */
export function traceMean(points: readonly (number | undefined)[]): number | undefined {
  let total = 0;
  let count = 0;
  for (const value of points) {
    if (value !== undefined) {
      total += value;
      count += 1;
    }
  }
  return count === 0 ? undefined : total / count;
}
