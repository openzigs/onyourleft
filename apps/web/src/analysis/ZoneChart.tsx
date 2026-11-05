// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Time in zone as a bar per zone — #2069.
 *
 * One horizontal bar per zone, in the zone's own colour (#2039, ADR 0063 D-4),
 * with the zone's number and name before it and its share after it, as text.
 * Drawn from the same {@link ZoneRow}s as the table under it, so the two
 * cannot disagree: a bar is `row.width` long and says `row.share`, which is a
 * share of the time the sensor COVERED (`present.ts` §"A percentage of what").
 *
 * ## Hand-drawn, and HTML around SVG
 *
 * Each bar is a one-rectangle SVG stretched to its column, as `TraceChart`'s
 * line is (ADR 0063 D-6: no charting library). The words are HTML beside it,
 * not SVG text, which the stretch would distort.
 *
 * ## Hidden from assistive technology, on purpose
 *
 * The table under the chart says every zone's name, range, time and share; a
 * screen reader reading the chart as well would read each share twice. So the
 * chart is `aria-hidden`, as the bar it replaces in the table's Share column
 * was. Colour is still never the only signal for a sighted reader (WCAG 2.2
 * SC 1.4.1): every bar has its number and name beside a swatch of its colour,
 * which is what `a11y/zones.a11y.test.tsx` reads.
 */

import type { JSX } from 'react';

import { BAND_TOKENS, HEART_RATE_BAND_TOKENS, type BandToken } from '../design/tokens';
import { zoneLabel, zoneSwatchClass, type ZoneBasis } from '../design/ZoneKey';

import type { ZoneRow } from './present';

/** `bandVo2` → `oyl-zone-chart__fill--band-vo2`: the rule in `theme.css` §"THE ZONE CHART". */
export function zoneFillClass(token: BandToken): string {
  return `oyl-zone-chart__fill--${token.replaceAll(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;
}

export interface ZoneChartProps {
  /** The table's rows, in zone order. */
  readonly rows: readonly ZoneRow[];
  /** Which zones these are: power's seven or heart rate's five. */
  readonly basis: ZoneBasis;
}

export function ZoneChart({ rows, basis }: ZoneChartProps): JSX.Element {
  const tokens = basis === 'power' ? BAND_TOKENS : HEART_RATE_BAND_TOKENS;
  return (
    <ol aria-hidden="true" className="oyl-zone-chart" data-oyl-zone-key={basis}>
      {rows.map((row) => {
        const token = tokens[row.index - 1] ?? 'bandRecovery';
        return (
          <li key={row.index} className="oyl-zone-chart__row" data-oyl-zone-bar={row.index}>
            <span className="oyl-zone-chart__label" data-oyl-zone={String(row.index)}>
              <span className={`oyl-zone-key__swatch ${zoneSwatchClass(token)}`} />
              {zoneLabel(basis, row.index - 1)}
            </span>
            <svg
              className="oyl-zone-chart__bar"
              viewBox="0 0 100 10"
              preserveAspectRatio="none"
              focusable="false"
            >
              {/* A percentage of the viewBox's 100: the row's own share of covered time. */}
              <rect
                className={`oyl-zone-chart__fill ${zoneFillClass(token)}`}
                x="0"
                y="0"
                height="10"
                width={row.width}
              />
            </svg>
            <span className="oyl-zone-chart__share">{row.share}</span>
          </li>
        );
      })}
    </ol>
  );
}
