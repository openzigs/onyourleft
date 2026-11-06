// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * This week's moving time, a bar per day — #2049.
 *
 * Seven bars, oldest day on the left and today on the right, each as tall as
 * that day's share of the week's longest day, with that day's moving time
 * written over it (the owner's screenshot review of 2026-11-05), across the
 * card's whole width. Drawn from `home/home.ts`'s
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

/**
 * The geometry, in percent of the plot — there is no `viewBox`, so the
 * drawing is the card's whole width (the owner's screenshot review of
 * 2026-11-05: it was ~135 px wide). Each day is a seventh of the width, its
 * bar the middle {@link BAR_SHARE} of that; the bars take the lowest
 * {@link PLOT} percent of the height, and the top is left for each bar's
 * value. The values are HTML laid over the plot, not SVG text: a drawing on
 * Home holds no words (`HomeView.a11y.test.tsx` §"from the kit").
 */
const COLUMN = 100 / 7;
const BAR_SHARE = 0.6;
const PLOT = 70;

/** Three decimals: enough for a pixel at any width, and stable in a test. */
const pct = (value: number): string => `${String(Math.round(value * 1000) / 1000)}%`;

/** The weekday letter a column is labelled with — the table says the full name. */
function shortDay(day: string): string {
  return new Intl.DateTimeFormat('en-GB', { weekday: 'narrow', timeZone: 'UTC' }).format(
    new Date(`${day}T12:00:00Z`),
  );
}

/**
 * A day's moving time over its bar: hours and minutes, `1:05` — short enough
 * for a seventh of a phone. The table under the chart says it to the second.
 */
export function barValue(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  return `${String(Math.floor(minutes / 60))}:${String(minutes % 60).padStart(2, '0')}`;
}

export interface WeekChartProps {
  /** Seven days, oldest first. */
  readonly days: readonly HomeWeekDay[];
}

export function WeekChart({ days }: WeekChartProps): JSX.Element {
  const longest = Math.max(0, ...days.map((day) => day.movingTime));
  return (
    <div aria-hidden="true" className="oyl-week-chart">
      <div className="oyl-week-chart__plot">
        <svg className="oyl-week-chart__bars" focusable="false">
          <line className="oyl-week-chart__base" x1="0" x2="100%" y1="100%" y2="100%" />
          {days.map((day, index) => {
            const share = longest === 0 ? 0 : day.movingTime / longest;
            return share === 0 ? null : (
              <rect
                key={day.day}
                className="oyl-week-chart__bar"
                data-oyl-week-day={day.day}
                x={pct(index * COLUMN + (COLUMN * (1 - BAR_SHARE)) / 2)}
                y={pct(100 - PLOT * share)}
                width={pct(COLUMN * BAR_SHARE)}
                height={pct(PLOT * share)}
              />
            );
          })}
        </svg>
        <ol className="oyl-week-chart__values">
          {days.map((day, index) => {
            const share = longest === 0 ? 0 : day.movingTime / longest;
            return share === 0 ? null : (
              <li
                key={day.day}
                className="oyl-week-chart__value"
                data-oyl-week-day={day.day}
                style={{ left: pct((index + 0.5) * COLUMN), bottom: pct(PLOT * share) }}
              >
                {barValue(day.movingTime)}
              </li>
            );
          })}
        </ol>
      </div>
      <ol className="oyl-week-chart__days">
        {days.map((day) => (
          <li key={day.day}>{shortDay(day.day)}</li>
        ))}
      </ol>
    </div>
  );
}
