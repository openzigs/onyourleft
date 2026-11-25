// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A planned route's elevation, drawn — #3185.
 *
 * The planner said its profile only as a table of two dozen rows, each about
 * a twelfth of a long route and named from its steepest point, so a rider
 * could not see where the climbing was. This is the picture: height against
 * distance along the drawn line, under the map.
 *
 * ## Hand-drawn, and hidden from assistive technology
 *
 * One SVG and no charting library, for `detail/TraceChart.tsx`'s reasons, in
 * that chart's own classes (`theme.css` §`.oyl-trace-chart`), so the two
 * charts in this client look like one. The drawing is `aria-hidden`, as
 * `home/WeekChart.tsx`'s is: the elevation sentence beside it says the
 * distance, the climbing and the dataset in words, and the gradient table
 * under it (`views/RouteBuilderView.tsx`) says the gradient along the route
 * row by row with each row's band named, so a screen reader reading the line
 * as well would hear the route twice. Nothing is carried by colour: the line
 * is one colour, and a band is a name in the table.
 *
 * ## A hole in the dataset is a hole in the line
 *
 * `elevation.ts` interpolates across ground the dataset has no height for, so
 * that the totals have numbers to sum, and records where it did
 * (`ElevationCoverage.gaps`). The chart breaks its line there — one `<path>`
 * per unbroken run, as `TraceChart` does for a sensor's gap — so a guessed
 * ramp is never drawn as if it were measured (#72).
 */

import { metres } from '@onyourleft/domain';
import type { UnitSystem } from '@onyourleft/store';
import type { JSX } from 'react';

import {
  distanceUnit,
  formatDistance,
  formatSmallDistance,
  measurementText,
  smallDistanceUnit,
} from '../units/format';
import type { PlannedElevation } from './elevation';

/** The drawing's coordinate space: a `viewBox` the stylesheet stretches, as `TraceChart`'s. */
export const PROFILE_CHART_WIDTH = 600;
export const PROFILE_CHART_HEIGHT = 160;

/**
 * At most this many points are drawn: one per unit of the width.
 *
 * A 200 km route on the profile's 10 m grid is 20 000 heights, and a path of
 * 20 000 points draws no more than 600 of them on a 600-unit-wide drawing.
 */
export const PROFILE_CHART_POINTS = PROFILE_CHART_WIDTH;

/** What the chart draws, worked out without React so a test reads it as numbers. */
export interface ProfileChartModel {
  /** One `d` per unbroken run of measured ground, in the drawing's coordinates. */
  readonly lines: readonly string[];
  /** "Elevation (m)". */
  readonly elevationTitle: string;
  /** The highest, middle and lowest heights, top to bottom, with their unit. */
  readonly heights: readonly string[];
  /** "Distance (km)". */
  readonly distanceTitle: string;
  /** The start, the middle and the end of the route along the bottom. */
  readonly distances: readonly string[];
}

/**
 * The chart's lines and its axes' labels.
 *
 * Each drawn point stands for a stretch of the route; a stretch that overlaps
 * a gap in the dataset draws nothing, so even a hole narrower than one point's
 * stretch breaks the line.
 */
export function profileChart(planned: PlannedElevation, units: UnitSystem): ProfileChartModel {
  const { elevations, resolution, totalDistance } = planned.profile;
  const count = Math.min(elevations.length, PROFILE_CHART_POINTS);
  const stretch = count === 0 ? 0 : totalDistance / count;
  const points: (number | undefined)[] = [];
  for (let index = 0; index < count; index += 1) {
    const from = index * stretch;
    const to = from + stretch;
    const hole = planned.coverage.gaps.some((gap) => gap.from < to && gap.to > from);
    const sample = Math.min(elevations.length - 1, Math.round((from + to) / 2 / resolution));
    points.push(hole ? undefined : elevations[sample]);
  }
  const measured = points.filter((point): point is number => point !== undefined);
  const low = measured.length === 0 ? 0 : Math.min(...measured);
  const high = measured.length === 0 ? 0 : Math.max(...measured);
  const span = high - low;
  const xOf = (index: number): number =>
    count <= 1 ? PROFILE_CHART_WIDTH / 2 : (index / (count - 1)) * PROFILE_CHART_WIDTH;
  // A flat route is drawn down the middle rather than along an edge, which
  // would read as a maximum or a minimum — `TraceChart`'s rule.
  const yOf = (value: number): number =>
    span === 0
      ? PROFILE_CHART_HEIGHT / 2
      : PROFILE_CHART_HEIGHT - ((value - low) / span) * PROFILE_CHART_HEIGHT;
  const lines: string[] = [];
  let run: string[] = [];
  points.forEach((point, index) => {
    if (point === undefined) {
      if (run.length > 0) lines.push(run.join(' '));
      run = [];
      return;
    }
    run.push(`${run.length === 0 ? 'M' : 'L'}${xOf(index).toFixed(2)} ${yOf(point).toFixed(2)}`);
  });
  if (run.length > 0) lines.push(run.join(' '));
  const height = (value: number): string => measurementText(formatSmallDistance(value, units));
  const along = (value: number): string => formatDistance(metres(value), units).value;
  return {
    lines,
    elevationTitle: `Elevation (${smallDistanceUnit(units)})`,
    heights:
      measured.length === 0
        ? []
        : span === 0
          ? ['', height(low), '']
          : [height(high), height((high + low) / 2), height(low)],
    distanceTitle: `Distance (${distanceUnit(units)})`,
    distances: [along(0), along(totalDistance / 2), along(totalDistance)],
  };
}

export interface ProfileChartProps {
  readonly planned: PlannedElevation;
  readonly units: UnitSystem;
}

/** The chart, in `TraceChart`'s grid: heights down the left, distance along the bottom. */
export function ProfileChart({ planned, units }: ProfileChartProps): JSX.Element {
  const chart = profileChart(planned, units);
  return (
    <div className="oyl-trace-chart oyl-planner__profile" aria-hidden="true">
      <div className="oyl-trace-chart__value-title">{chart.elevationTitle}</div>
      <div className="oyl-trace-chart__values">
        {chart.heights.map((value, index) => (
          <div key={index}>{value}</div>
        ))}
      </div>
      <svg
        className="oyl-trace"
        viewBox={`0 0 ${String(PROFILE_CHART_WIDTH)} ${String(PROFILE_CHART_HEIGHT)}`}
        preserveAspectRatio="none"
        focusable="false"
      >
        {chart.lines.map((d, index) => (
          <path
            key={index}
            className="oyl-trace__line"
            // Round caps, so a measured stretch between two holes is a dot
            // rather than nothing — `TraceChart`'s reason.
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
            d={d}
          />
        ))}
      </svg>
      <div className="oyl-trace-chart__times">
        {chart.distances.map((value, index) => (
          <div key={index}>{value}</div>
        ))}
      </div>
      <div className="oyl-trace-chart__time-title">{chart.distanceTitle}</div>
    </div>
  );
}
