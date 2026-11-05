// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * This week's moving time, a bar per day — #2049.
 *
 * Seven bars, oldest day on the left and today on the right, each as tall as
 * that day's share of the week's longest day. Drawn from `home/home.ts`'s
 * {@link HomeWeekDay}s, the same rows as the table beside it, so the two
 * cannot disagree.
 *
 * ## Hand-drawn, and hidden from assistive technology
 *
 * One SVG, no charting library (ADR 0063 D-6), as `analysis/ZoneChart.tsx`.
 * The chart is `aria-hidden`: the table `views/HomeView.tsx` §`ThisWeek`
 * puts beside it says every day's rides and moving time in words, and the
 * module's facts say the totals, so a screen reader reading the bars as well
 * would hear each day twice. A bar carries nothing the table does not — its
 * height is the moving time the table states — and every bar is the one
 * accent colour, so colour says nothing at all (WCAG 2.2 SC 1.4.1). A day with
 * no riding draws no bar, only the baseline every day has.
 *
 * Loaded through `design/ChartSlot.tsx`, so a chart that throws leaves the
 * table in its place and the rest of Home standing
 * (`a11y/degradation.a11y.test.tsx` §"#2049").
 */

import type { JSX } from 'react';

import type { HomeWeekDay } from './home';

/** The drawing's own units: seven columns of ten, forty tall. */
const COLUMN = 10;
const BAR = 6;
const HEIGHT = 40;

/** The weekday letter a column is labelled with — the table says the full name. */
function shortDay(day: string): string {
  return new Intl.DateTimeFormat('en-GB', { weekday: 'narrow', timeZone: 'UTC' }).format(
    new Date(`${day}T12:00:00Z`),
  );
}

export interface WeekChartProps {
  /** Seven days, oldest first. */
  readonly days: readonly HomeWeekDay[];
}

export function WeekChart({ days }: WeekChartProps): JSX.Element {
  const longest = Math.max(0, ...days.map((day) => day.movingTime));
  return (
    <div aria-hidden="true" className="oyl-week-chart">
      <svg
        className="oyl-week-chart__bars"
        viewBox={`0 0 ${String(COLUMN * days.length)} ${String(HEIGHT)}`}
        preserveAspectRatio="none"
        focusable="false"
      >
        <line
          className="oyl-week-chart__base"
          x1="0"
          x2={COLUMN * days.length}
          y1={HEIGHT}
          y2={HEIGHT}
        />
        {days.map((day, index) => {
          const height = longest === 0 ? 0 : (HEIGHT * day.movingTime) / longest;
          return height === 0 ? null : (
            <rect
              key={day.day}
              className="oyl-week-chart__bar"
              data-oyl-week-day={day.day}
              x={index * COLUMN + (COLUMN - BAR) / 2}
              y={HEIGHT - height}
              width={BAR}
              height={height}
            />
          );
        })}
      </svg>
      <ol className="oyl-week-chart__days">
        {days.map((day) => (
          <li key={day.day}>{shortDay(day.day)}</li>
        ))}
      </ol>
    </div>
  );
}
