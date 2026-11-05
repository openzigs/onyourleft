// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * One basis's time in zone: the bar chart (#2069) and the table under it.
 *
 * Moved out of `views/AnalysisView.tsx` by #2069 so the ride's own page draws
 * the same thing (`views/ActivityDetailView.tsx`). The chart and the table are
 * built from one {@link zoneRows} call, so they cannot disagree.
 *
 * ⚠️ **A chart that throws leaves the table.** The chart is inside a
 * `RenderBoundary` whose fallback is nothing, and the table is outside it:
 * the table is the accessible equivalent and holds the exact values, so it is
 * never the thing a failed drawing takes with it (`a11y/degradation.a11y.test.tsx`).
 */

import type { JSX } from 'react';

import { RenderBoundary } from '../design/ChartSlot';
import { ScrollTable } from '../design/ScrollTable';
import { StatusMessage } from '../design/StatusMessage';
import type { ZoneBasis } from '../design/ZoneKey';
import { formatDuration } from '../format';

import type { ZoneBreakdown } from './load';
import { coverageNote, ZONE_BOUNDARY_NOTE, zoneRows } from './present';
import { ZoneChart } from './ZoneChart';

export interface ZoneTableProps {
  readonly breakdown: ZoneBreakdown;
  readonly movingTime: number;
  readonly unit: string;
  readonly heading: string;
  /** "threshold power" or "threshold heart rate" — the words, not the number. */
  readonly thresholdNoun: string;
  readonly assumed: boolean;
  /** Which zones: power's seven or heart rate's five, for the chart's colours and names. */
  readonly basis: ZoneBasis;
  /** The heading's level: 3 on Analysis, 4 under the ride page's own "Time in zone". */
  readonly headingLevel?: 3 | 4;
}

export function ZoneTable({
  breakdown,
  movingTime,
  unit,
  heading,
  thresholdNoun,
  assumed,
  basis,
  headingLevel = 3,
}: ZoneTableProps): JSX.Element {
  const rows = zoneRows(breakdown.zones, breakdown.time, unit);
  const coverage = coverageNote(breakdown.time.covered, movingTime);
  // The number the boundaries came from, shown so a rider can check the table
  // against it rather than take the rows on trust.
  const thresholdLabel = `${thresholdNoun} ${String(Math.round(breakdown.threshold))} ${unit}`;
  const Heading = headingLevel === 3 ? 'h3' : 'h4';
  return (
    <>
      <Heading>{heading}</Heading>
      {assumed ? (
        <StatusMessage tone="info">
          These zones use an assumed {thresholdLabel}, because none is set on this device. They are
          the right shape and almost certainly the wrong numbers — set your own threshold to make
          them mean anything about you.
        </StatusMessage>
      ) : undefined}
      <RenderBoundary fallback={null}>
        <ZoneChart rows={rows} basis={basis} />
      </RenderBoundary>
      <ScrollTable
        className="oyl-table"
        caption={
          <>
            {heading}, from {thresholdLabel}. {ZONE_BOUNDARY_NOTE}
          </>
        }
      >
        <thead>
          <tr>
            <th scope="col">Zone</th>
            <th scope="col">Range</th>
            <th scope="col">Time</th>
            <th scope="col">Share</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.index}>
              <th scope="row">
                {String(row.index)}. {row.name}
              </th>
              <td>{row.range}</td>
              <td>{row.time}</td>
              <td>{row.share}</td>
            </tr>
          ))}
        </tbody>
      </ScrollTable>
      <p className="oyl-muted">
        Shares are of the {formatDuration(breakdown.time.covered)} the sensor actually reported.
        {coverage === undefined ? '' : ` ${coverage}`}
      </p>
    </>
  );
}
