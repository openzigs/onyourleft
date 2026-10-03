// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A workout as a block chart — #1043: width is time, height is the share of
 * threshold each stretch asks for, and each block is filled by the intensity
 * band that share falls in.
 *
 * Pure geometry, apart from the component that draws it (`BlockChart.tsx`), for
 * `library.ts`'s reason: what the chart says is a decision worth testing on its
 * own, and the bound on what it costs the DOM is a number a test can count.
 *
 * ## Our own drawing
 *
 * ADR 0009: nothing here is derived from another product's chart, and no
 * reference image was consulted. The bands are the seven power zones this
 * program already computes (`@onyourleft/domain` §`POWER_ZONE_LOWER_FRACTIONS`,
 * published fractions), and their colours are this palette's own
 * (`tokens.ts` §`BAND_TOKENS`) — a teal ramp that darkens toward threshold and
 * then turns to brick and plum, chosen against the contrast pairs and for no
 * other reason.
 *
 * ## Heights are shares of threshold, and the scale is fixed
 *
 * A block's top is its target's share of threshold on ONE scale whose top is
 * {@link CHART_TOP_SHARE} — or the workout's hardest target, if that is higher
 * — so 100 % of threshold is drawn at the same height on every workout that
 * stays under it, and the dashed rule at 100 % ({@link BlockChartPaths.rule})
 * is a reference a rider can read a block against. No number is drawn: the
 * shares are in the words beside the chart, and no watt figure is computed at
 * all (`library.ts` §`WorkoutRow`'s rule — a threshold is not an input here).
 *
 * ## Colour is never the only cue (WCAG 2.2 SC 1.4.1)
 *
 * The band a block is filled with is a function of its HEIGHT, which is drawn,
 * against the threshold rule, which is drawn; the band ramp is also monotonic
 * in lightness (`tokens.test.ts` holds each step), so it reads in greyscale. A
 * free ride, which has no target, is not filled at all: it is an outline with
 * diagonal hatching, which is a texture rather than a colour. And the chart is
 * `aria-hidden` beside the workout's own words — every block's percentage in
 * the builder's list, the shape sentence on a saved workout.
 *
 * ## Bounded: the DOM does not grow with the workout
 *
 * Every block of one band is a subpath of ONE `<path>`, so the chart is at most
 * {@link BLOCK_CHART_MAX_SHAPES} shapes whatever it draws. The path data is
 * bounded too: a workout of more than {@link BLOCK_CHART_MAX_BARS} segments —
 * `MAXIMUM_SEGMENTS` is ten thousand, and a block narrower than a pixel draws
 * nothing a rider can see — is cut into that many equal columns of time,
 * each as high as the mean target across it (`WorkoutShape`'s rule for a card).
 */

import { POWER_ZONE_LOWER_FRACTIONS, type WorkoutSegment } from '@onyourleft/domain';

/** The drawing's size, in its own units. Stretched to its box (`preserveAspectRatio="none"`). */
export const CHART_WIDTH = 1000;
export const CHART_HEIGHT = 100;

/**
 * The share of threshold the top of the chart stands for, unless a target is
 * higher. 1.25 leaves room above the threshold rule for the efforts that go
 * past it, and puts the rule at 80 % of the height on every such workout.
 */
export const CHART_TOP_SHARE = 1.25;

/**
 * How high a free ride is drawn, as a share of threshold. It has no target —
 * `FreeRideBlock` lets the trainer go — so this is a nominal height for the
 * outline, low and the same on every workout, not a target anybody rides.
 */
export const FREE_RIDE_DRAWN_SHARE = 0.4;

/** The most segments drawn one for one; past this the timeline is cut into columns. */
export const BLOCK_CHART_MAX_BARS = 240;

/** How many intensity bands there are: the domain's power zones, one fill each. */
export const BAND_COUNT = POWER_ZONE_LOWER_FRACTIONS.length;

/** Band paths, the free-ride path and the threshold rule: the most shapes drawn. */
export const BLOCK_CHART_MAX_SHAPES = BAND_COUNT + 2;

/** How far apart a free ride's hatching is, and how far each line leans, in drawing units. */
const HATCH_SPACING = 16;
const HATCH_SLANT = 10;

/** What the chart is drawn from: an expanded timeline's segments (`expandWorkout`). */
export type BlockChartSegment = Pick<WorkoutSegment, 'startsAt' | 'endsAt' | 'from' | 'to'>;

/** The chart, as path data. An empty string is a shape with nothing to draw. */
export interface BlockChartPaths {
  /** One path per band, lowest first, {@link BAND_COUNT} long. */
  readonly bands: readonly string[];
  /** Every free ride's outline and hatching, as strokes. */
  readonly freeRide: string;
  /** The dashed line at 100 % of threshold. Empty when nothing is drawn. */
  readonly rule: string;
}

const EMPTY: BlockChartPaths = {
  bands: new Array<string>(BAND_COUNT).fill(''),
  freeRide: '',
  rule: '',
};

/**
 * The band a share of threshold falls in, 0-based — the domain's zone rule:
 * inclusive below, exclusive above, the top band unbounded.
 */
export function bandOf(share: number): number {
  let band = 0;
  POWER_ZONE_LOWER_FRACTIONS.forEach((lower, index) => {
    if (share >= lower) band = index;
  });
  return band;
}

/** A number for a path, to two decimal places and no more. */
function coordinate(value: number): string {
  return String(Math.round(value * 100) / 100);
}

/** A stretch of the chart: a slope from `from` to `to`, or a free ride (`undefined`). */
interface Bar {
  readonly startsAt: number;
  readonly endsAt: number;
  readonly from: number | undefined;
  readonly to: number | undefined;
}

/**
 * The timeline as at most {@link BLOCK_CHART_MAX_BARS} bars. Segments that are
 * not finite, or have no length, are dropped (`WorkoutShape`'s #967 rule: one
 * `NaN` would make every coordinate `NaN`).
 */
function barsOf(input: readonly BlockChartSegment[]): readonly Bar[] {
  const finite = (value: number | undefined): boolean =>
    value === undefined || Number.isFinite(value);
  const segments = input.filter(
    (segment) =>
      Number.isFinite(segment.startsAt) &&
      Number.isFinite(segment.endsAt) &&
      segment.endsAt > segment.startsAt &&
      finite(segment.from) &&
      finite(segment.to),
  );
  if (segments.length <= BLOCK_CHART_MAX_BARS) {
    return segments;
  }
  // Columns of equal time. A column is a free ride when free riding covers at
  // least half of it; otherwise it is as high as the time-weighted mean of the
  // targets in it. A column no segment covers is not drawn.
  const end = segments.reduce((latest, segment) => Math.max(latest, segment.endsAt), 0);
  const width = end / BLOCK_CHART_MAX_BARS;
  const targeted = new Array<number>(BLOCK_CHART_MAX_BARS).fill(0);
  const weighted = new Array<number>(BLOCK_CHART_MAX_BARS).fill(0);
  const free = new Array<number>(BLOCK_CHART_MAX_BARS).fill(0);
  for (const segment of segments) {
    const first = Math.max(0, Math.floor(segment.startsAt / width));
    const last = Math.min(BLOCK_CHART_MAX_BARS - 1, Math.floor(segment.endsAt / width));
    for (let column = first; column <= last; column += 1) {
      const overlap =
        Math.min(segment.endsAt, (column + 1) * width) - Math.max(segment.startsAt, column * width);
      if (overlap <= 0) continue;
      if (segment.from === undefined || segment.to === undefined) {
        free[column] = (free[column] ?? 0) + overlap;
      } else {
        targeted[column] = (targeted[column] ?? 0) + overlap;
        weighted[column] = (weighted[column] ?? 0) + (overlap * (segment.from + segment.to)) / 2;
      }
    }
  }
  const bars: Bar[] = [];
  for (let column = 0; column < BLOCK_CHART_MAX_BARS; column += 1) {
    const time = targeted[column] ?? 0;
    const loose = free[column] ?? 0;
    if (time + loose <= 0) continue;
    const share = loose >= time ? undefined : (weighted[column] ?? 0) / time;
    bars.push({ startsAt: column * width, endsAt: (column + 1) * width, from: share, to: share });
  }
  return bars;
}

/**
 * The chart's path data — #1043.
 *
 * A ramp is a slope, and a ramp that crosses a band's boundary is cut there,
 * each piece filled by its own band, so a ramp from 50 % to 120 % reads as the
 * climb through the bands it is.
 */
export function blockChartPaths(segments: readonly BlockChartSegment[]): BlockChartPaths {
  const bars = barsOf(segments);
  const end = bars.reduce((latest, bar) => Math.max(latest, bar.endsAt), 0);
  if (bars.length === 0 || end <= 0) {
    return EMPTY;
  }
  const hardest = bars.reduce(
    (most, bar) => Math.max(most, bar.from ?? 0, bar.to ?? 0),
    CHART_TOP_SHARE,
  );
  const x = (time: number): number => (time / end) * CHART_WIDTH;
  const y = (share: number): number => CHART_HEIGHT - (share / hardest) * CHART_HEIGHT;
  const ground = coordinate(CHART_HEIGHT);
  const bands: string[][] = Array.from({ length: BAND_COUNT }, () => []);
  const freeRide: string[] = [];

  const slope = (x0: number, x1: number, from: number, to: number): string =>
    `M${coordinate(x0)} ${ground}L${coordinate(x0)} ${coordinate(y(from))}L${coordinate(
      x1,
    )} ${coordinate(y(to))}L${coordinate(x1)} ${ground}Z`;

  for (const bar of bars) {
    const x0 = x(bar.startsAt);
    const x1 = x(bar.endsAt);
    if (bar.from === undefined || bar.to === undefined) {
      freeRide.push(hatched(x0, x1, y(FREE_RIDE_DRAWN_SHARE)));
      continue;
    }
    const { from, to } = bar;
    // Where the slope crosses a band boundary, in order along it.
    const low = Math.min(from, to);
    const high = Math.max(from, to);
    const cuts = POWER_ZONE_LOWER_FRACTIONS.filter((lower) => lower > low && lower < high)
      .map((lower) => (lower - from) / (to - from))
      .sort((a, b) => a - b);
    const stops = [0, ...cuts, 1];
    for (let piece = 0; piece + 1 < stops.length; piece += 1) {
      const t0 = stops[piece] ?? 0;
      const t1 = stops[piece + 1] ?? 1;
      const at = (t: number): number => from + (to - from) * t;
      const band = bandOf(at((t0 + t1) / 2));
      bands[band]?.push(slope(x0 + (x1 - x0) * t0, x0 + (x1 - x0) * t1, at(t0), at(t1)));
    }
  }

  return {
    bands: bands.map((pieces) => pieces.join('')),
    freeRide: freeRide.join(''),
    rule: `M0 ${coordinate(y(1))}L${coordinate(CHART_WIDTH)} ${coordinate(y(1))}`,
  };
}

/**
 * A free ride's outline and its hatching, clipped to the bar: the outline's
 * three sides, then lines leaning right at {@link HATCH_SPACING}.
 */
function hatched(x0: number, x1: number, top: number): string {
  const ground = CHART_HEIGHT;
  const parts = [
    `M${coordinate(x0)} ${coordinate(ground)}L${coordinate(x0)} ${coordinate(top)}L${coordinate(
      x1,
    )} ${coordinate(top)}L${coordinate(x1)} ${coordinate(ground)}`,
  ];
  // A line from (s, ground) to (s + slant, top), clipped to [x0, x1].
  for (let s = x0 - HATCH_SLANT + HATCH_SPACING / 2; s < x1; s += HATCH_SPACING) {
    const t0 = Math.max(0, (x0 - s) / HATCH_SLANT);
    const t1 = Math.min(1, (x1 - s) / HATCH_SLANT);
    if (t1 <= t0) continue;
    const along = (t: number): string =>
      `${coordinate(s + HATCH_SLANT * t)} ${coordinate(ground + (top - ground) * t)}`;
    parts.push(`M${along(t0)}L${along(t1)}`);
  }
  return parts.join('');
}
