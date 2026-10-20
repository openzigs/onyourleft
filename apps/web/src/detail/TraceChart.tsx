// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * One trace, drawn as an SVG line — the first chart in this shell.
 *
 * ## Why it is hand-drawn rather than a charting library
 *
 * A line, an axis label and a gap are about eighty lines of SVG. The libraries
 * that would replace them each bring a licence to check against `apps/`'s
 * AGPL-3.0 boundary, a lockfile entry, a bundle several times the size of this
 * whole client, and — the part that actually decides it — a canvas or a
 * `<div>`-based renderer that is a single unlabelled blob to a screen reader.
 * #48's sixth criterion would then need the chart to be described in words
 * anyway, so the library would be paying for the half of the job that is
 * already done here.
 *
 * ADR 0005's runtime list does not name a charting library, and adding one is a
 * decision for an issue rather than a convenience taken here.
 *
 * ## The default export is for `React.lazy`
 *
 * `design/ChartSlot.tsx` records that #48's seventh criterion has a half only
 * #50 can meet: a chart loaded eagerly takes the page down before the render
 * boundary can catch it, so the chart has to arrive through a dynamic import.
 * `views/ActivityDetailView.tsx` does that, and this module is the target — so
 * it has a default export, which is the shape `React.lazy` requires.
 *
 * ## Gaps
 *
 * **One `<path>` per unbroken run**, never one path with the missing points
 * left out. #50's second criterion is that a gap renders as a visible
 * discontinuity, and a single path simply skips to the next coordinate, drawing
 * a straight line across the hole. That line is indistinguishable from a steady
 * effort, which is the reading a rider would take from it.
 */

import type { JSX } from 'react';

import { formatDuration } from '../format';

import { traceExtent, traceMean, traceSegments } from './series';

/**
 * The drawing's coordinate space.
 *
 * A `viewBox` rather than pixels: the SVG scales to whatever width the
 * stylesheet gives it, and nothing here has to measure a DOM node — which jsdom
 * could not answer anyway. The width matches `CHART_POINTS` so that one point
 * is one unit and no point is drawn on top of another.
 */
export const CHART_WIDTH = 600;
export const CHART_HEIGHT = 160;

export interface TraceChartProps {
  /** "Power", "Heart rate". Names the trace in the accessible description. */
  readonly label: string;
  /** The displayed unit — "W", "bpm", "km/h". */
  readonly unit: string;
  /** Display-unit values, gaps as `undefined`. */
  readonly points: readonly (number | undefined)[];
  /** How much ride time one point covers, for the description's duration. */
  readonly secondsPerPoint: number;
  /** Digits without a unit, from the series definition. */
  readonly format: (value: number) => string;
  /** Missing samples in the **stored** series, which is more than the drawing shows. */
  readonly missingSamples: number;
}

/**
 * The chart in one sentence, for a reader who is not looking at it.
 *
 * #50's sixth criterion asks for a non-visual equivalent, and the table beside
 * the chart is the detailed half of that. This is the other half: the shape of
 * the trace stated outright, so a screen-reader user gets the summary a sighted
 * reader takes from the picture in a second rather than only the numbers a
 * table gives them in twenty.
 *
 * Exported so `detail.a11y.test.tsx` can assert on the sentence rather than on
 * a rendered attribute — a description that stops mentioning the gaps should
 * fail a test that reads it, not one that greps the DOM.
 */
export function describeTrace(props: TraceChartProps): string {
  const { label, unit, points, secondsPerPoint, format, missingSamples } = props;
  const extent = traceExtent(points);
  const mean = traceMean(points);
  const duration = formatDuration(points.length * secondsPerPoint);
  if (extent === undefined || mean === undefined) {
    return `${label}: no readings in this ride.`;
  }
  const segments = traceSegments(points);
  const breaks =
    segments.length <= 1
      ? ''
      : ` The trace is broken into ${String(segments.length)} parts where the sensor gave nothing.`;
  const missing =
    missingSamples === 0
      ? ''
      : ` ${String(missingSamples)} seconds of the ride have no ${label.toLowerCase()} reading.`;
  return (
    `${label} over ${duration}. Average ${format(mean)} ${unit}, ` +
    `from ${format(extent.low)} to ${format(extent.high)} ${unit}.${breaks}${missing}`
  );
}

/** The `d` of one unbroken run, in the chart's coordinate space. */
function pathFor(
  values: readonly number[],
  from: number,
  totalPoints: number,
  low: number,
  high: number,
): string {
  // A flat trace — every reading identical, which a stopped trainer produces —
  // would divide by zero. Drawn down the middle instead of at the top, because
  // "constant" is a shape and pinning it to an edge reads as a maximum.
  const span = high - low;
  const xOf = (index: number): number =>
    totalPoints <= 1 ? CHART_WIDTH / 2 : ((from + index) / (totalPoints - 1)) * CHART_WIDTH;
  const yOf = (value: number): number =>
    span === 0 ? CHART_HEIGHT / 2 : CHART_HEIGHT - ((value - low) / span) * CHART_HEIGHT;

  return values
    .map((value, index) => {
      const command = index === 0 ? 'M' : 'L';
      return `${command}${xOf(index).toFixed(2)} ${yOf(value).toFixed(2)}`;
    })
    .join(' ');
}

/** What the chart's two axes say: the value at the top, middle and bottom, and the time at the start, middle and end. */
export interface TraceAxes {
  /** "Power (W)" — the value axis' title. */
  readonly valueTitle: string;
  /** Top to bottom, each with its unit; empty with no reading. */
  readonly values: readonly string[];
  /** The time axis' title. */
  readonly timeTitle: string;
  /** Left to right: the start, the middle and the end of the ride. */
  readonly times: readonly string[];
}

/** The time axis' title. Ride time, as the table's "From" column counts it. */
export const TIME_AXIS_TITLE = 'Time into the ride';

/**
 * The axes' labels — #1439: the chart had no scale at all, so a rider could
 * not read a watt or a minute off it. The value labels are the ends of the
 * drawing's own scale (`pathFor` maps `low` to the bottom edge and `high` to
 * the top) and their middle, so a label sits where its value is drawn; a flat
 * trace, drawn down the middle, has its one value there.
 */
export function traceAxes(props: TraceChartProps): TraceAxes {
  const { label, unit, points, secondsPerPoint, format } = props;
  const extent = traceExtent(points);
  const total = points.length * secondsPerPoint;
  const withUnit = (value: number): string => `${format(value)} ${unit}`;
  const values =
    extent === undefined
      ? []
      : extent.high === extent.low
        ? ['', withUnit(extent.low), '']
        : [withUnit(extent.high), withUnit((extent.high + extent.low) / 2), withUnit(extent.low)];
  return {
    valueTitle: `${label} (${unit})`,
    values,
    timeTitle: TIME_AXIS_TITLE,
    times: [formatDuration(0), formatDuration(total / 2), formatDuration(total)],
  };
}

/**
 * A trace, with a value axis and a time axis — #1439.
 *
 * `role="img"` with a description rather than a bare `<svg>`: without a role an
 * SVG is announced as a group full of unlabelled paths, and #48's audit would
 * be satisfied by that while a reader got nothing. The paths themselves are
 * `aria-hidden` for the same reason — they carry no information a reader can
 * use, and announcing sixteen of them is worse than announcing none.
 *
 * ⚠️ **The axes are HTML beside the drawing, not SVG text inside it.** The SVG
 * stretches horizontally (`preserveAspectRatio="none"`, `theme.css`
 * §`.oyl-trace`), which would stretch its text too. They are `aria-hidden`:
 * the drawing's description already says the range and the duration, and the
 * table under the chart says every reading, so a screen reader is not read
 * nine bare numbers between them.
 */
export default function TraceChart(props: TraceChartProps): JSX.Element {
  const { points } = props;
  const extent = traceExtent(points);
  const segments = traceSegments(points);
  const description = describeTrace(props);
  const axes = traceAxes(props);

  return (
    <div className="oyl-trace-chart">
      <div className="oyl-trace-chart__value-title" aria-hidden="true">
        {axes.valueTitle}
      </div>
      <div className="oyl-trace-chart__values" aria-hidden="true">
        {axes.values.map((value, index) => (
          <div key={index}>{value}</div>
        ))}
      </div>
      <svg
        className="oyl-trace"
        viewBox={`0 0 ${String(CHART_WIDTH)} ${String(CHART_HEIGHT)}`}
        role="img"
        aria-label={description}
        preserveAspectRatio="none"
      >
        <g aria-hidden="true">
          {segments.map((segment) => (
            <path
              key={segment.from}
              className="oyl-trace__line"
              // `round` on both, so an isolated reading between two gaps renders
              // as a dot rather than as nothing at all. A zero-length path with a
              // butt cap draws no pixels, which would silently delete a real
              // sample from the picture.
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
              d={pathFor(
                segment.values,
                segment.from,
                points.length,
                extent?.low ?? 0,
                extent?.high ?? 0,
              )}
            />
          ))}
        </g>
      </svg>
      <div className="oyl-trace-chart__times" aria-hidden="true">
        {axes.times.map((time, index) => (
          <div key={index}>{time}</div>
        ))}
      </div>
      <div className="oyl-trace-chart__time-title" aria-hidden="true">
        {axes.timeTitle}
      </div>
    </div>
  );
}
