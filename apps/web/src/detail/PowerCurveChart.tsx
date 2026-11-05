// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A ride's power curve as two SVG lines — #2081: this ride's best average
 * power for each length of time from five seconds to an hour, and the
 * all-time best on this device as the second line.
 *
 * Hand-drawn for `TraceChart.tsx`'s reasons (no charting library: a licence
 * to check against `apps/`' AGPL-3.0, a bundle, and a renderer that is one
 * unlabelled blob to a screen reader). The default export is for
 * `React.lazy`, as that chart's is.
 *
 * ## The x axis is the durations, evenly spaced
 *
 * One step per duration in `curve.ts` §`RIDE_CURVE_DURATIONS`, which already
 * runs roughly a factor of two apart — the spacing a curve is read at — so
 * five seconds is at the left edge, five minutes in the middle and an hour at
 * the right, and every duration the table lists is a vertex of the line.
 *
 * ⚠️ **Colour is not the only carrier**: the all-time line is dashed as well as
 * a different tone, the legend under the drawing says which is which in
 * words, and the table under it holds every number.
 */

import type { JSX } from 'react';

import type { PowerDurationCurve } from '@onyourleft/domain';

import { durationLabel } from '../analysis/present';
import { POWER_UNIT } from '../format';

import { describeCurve, RIDE_CURVE_DURATIONS } from './curve';

/** The drawing's coordinate space, stretched to its box by CSS (`theme.css` §`.oyl-curve`). */
export const CURVE_WIDTH = 600;
export const CURVE_HEIGHT = 160;

/** The legend's words, also the table's column headings. */
export const RIDE_CURVE_LABEL = 'This ride';
export const ALL_TIME_CURVE_LABEL = 'All-time best';

export interface PowerCurveChartProps {
  readonly ride: PowerDurationCurve;
  /** The library's curve, or `undefined` where the page has no analysis port to read it from. */
  readonly allTime?: PowerDurationCurve | undefined;
}

/** The highest watts either curve reaches: the top of the value axis. */
export function curvePeak(
  ride: PowerDurationCurve,
  allTime: PowerDurationCurve | undefined,
): number {
  return Math.max(0, ...ride.map((effort) => effort.power), ...(allTime ?? []).map((e) => e.power));
}

/** Where `duration` is drawn across: its place in the duration list. */
function xOf(duration: number): number {
  const index = RIDE_CURVE_DURATIONS.indexOf(duration);
  const last = RIDE_CURVE_DURATIONS.length - 1;
  return last <= 0 ? CURVE_WIDTH / 2 : (index / last) * CURVE_WIDTH;
}

/** The `d` of one curve, from nought watts at the bottom edge to `peak` at the top. */
export function curvePath(curve: PowerDurationCurve, peak: number): string {
  return curve
    .filter((effort) => RIDE_CURVE_DURATIONS.includes(effort.duration))
    .map((effort, index) => {
      const y = peak <= 0 ? CURVE_HEIGHT : CURVE_HEIGHT - (effort.power / peak) * CURVE_HEIGHT;
      return `${index === 0 ? 'M' : 'L'}${xOf(effort.duration).toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(' ');
}

export default function PowerCurveChart({ ride, allTime }: PowerCurveChartProps): JSX.Element {
  const peak = curvePeak(ride, allTime);
  const values =
    peak <= 0
      ? ['', '', '']
      : [
          `${String(Math.round(peak))} ${POWER_UNIT}`,
          `${String(Math.round(peak / 2))} ${POWER_UNIT}`,
          `0 ${POWER_UNIT}`,
        ];
  const first = RIDE_CURVE_DURATIONS[0] ?? 0;
  const middle = RIDE_CURVE_DURATIONS[Math.floor((RIDE_CURVE_DURATIONS.length - 1) / 2)] ?? 0;
  const last = RIDE_CURVE_DURATIONS.at(-1) ?? 0;
  const showAllTime = allTime !== undefined && allTime.length > 0;

  return (
    <div className="oyl-curve-chart">
      <div className="oyl-curve-chart__value-title" aria-hidden="true">
        Best average power ({POWER_UNIT})
      </div>
      <div className="oyl-curve-chart__values" aria-hidden="true">
        {values.map((value, index) => (
          <div key={index}>{value}</div>
        ))}
      </div>
      <svg
        className="oyl-curve"
        viewBox={`0 0 ${String(CURVE_WIDTH)} ${String(CURVE_HEIGHT)}`}
        role="img"
        aria-label={describeCurve(ride, allTime)}
        preserveAspectRatio="none"
      >
        <g aria-hidden="true">
          {/* The all-time line over the ride's, so where the two are the same
              line — this ride is the best — its dashes still show. */}
          <path
            className="oyl-curve__ride"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
            d={curvePath(ride, peak)}
          />
          {showAllTime ? (
            <path
              className="oyl-curve__all-time"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
              d={curvePath(allTime, peak)}
            />
          ) : null}
        </g>
      </svg>
      <div className="oyl-curve-chart__times" aria-hidden="true">
        <div>{durationLabel(first)}</div>
        <div>{durationLabel(middle)}</div>
        <div>{durationLabel(last)}</div>
      </div>
      <div className="oyl-curve-chart__time-title" aria-hidden="true">
        How long the effort lasted
      </div>
      <ul className="oyl-curve-chart__legend" aria-hidden="true">
        <li>
          <span className="oyl-curve-chart__key oyl-curve-chart__key--ride" />
          {RIDE_CURVE_LABEL}
        </li>
        {showAllTime ? (
          <li>
            <span className="oyl-curve-chart__key oyl-curve-chart__key--all-time" />
            {ALL_TIME_CURVE_LABEL}
          </li>
        ) : null}
      </ul>
    </div>
  );
}
