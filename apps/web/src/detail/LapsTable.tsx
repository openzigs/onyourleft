// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A ride's laps, as its page lists them — one row per lap (#62), and since
 * #1312 everything a course lap states: its time, its distance, its power,
 * its speed, its heart rate, its cadence and its climb.
 *
 * ## What is marked, and how
 *
 * - **The best lap** — `recording/laps.ts` §`bestLapIndex`, the rule the HUD
 *   uses as each lap ends, so the page and the ride agree about which it was.
 * - **A part lap** — the rider stopped part-way round. It is shown as one, so
 *   it never reads as a slow lap, and it is never the best.
 *
 * Both are WORDS in the lap's own row header, never a colour or a weight
 * alone (SC 1.4.1): a screen reader reading across a row hears "2, best lap"
 * before any figure of it.
 *
 * ## A column only when some lap has the figure
 *
 * A lap written before #1312, or by an import, states a time and a distance
 * and perhaps an average power. A column of dashes for every other figure
 * would be six columns saying nothing, on a table that already scrolls
 * sideways on a phone — so a figure's column is drawn when at least one lap of
 * THIS ride has it, and a lap without it shows a dash there.
 *
 * ⚠️ **Which time the averages use is said under the table**, because #1312
 * asks for it and a column header cannot hold the sentence: a lap's figures
 * are over its moving time.
 */

import type { JSX, ReactNode } from 'react';

import type { LapRecord, UnitSystem } from '@onyourleft/store';

import { ScrollTable } from '../design/ScrollTable';
import {
  ELAPSED_TIME_LABEL,
  formatDuration,
  formatPowerValue,
  MOVING_TIME_LABEL,
  POWER_UNIT,
} from '../format';
import { bestLapIndex, lapAverageSpeed } from '../recording/laps';
import {
  distanceUnit,
  formatDistance,
  formatSmallDistance,
  formatSpeed,
  smallDistanceUnit,
  speedUnit,
} from '../units/format';

/** What a cell shows for a figure this lap does not have. */
const NO_FIGURE = '—';

/**
 * Said under the table whenever it has a row — #1312. One line, and under
 * `a11y/section-lines.ts` §`SECTION_LINE_CHARACTERS`: it is the section's one
 * line of explanation.
 */
export const LAP_TIMES_NOTE = `Averages and average speed are over a lap’s moving time. Paused time is in ${ELAPSED_TIME_LABEL}, not in ${MOVING_TIME_LABEL}.`;

/** One optional column: its heading, and what a lap shows in it. */
interface FigureColumn {
  readonly key: string;
  readonly heading: string;
  readonly cell: (lap: LapRecord) => string | undefined;
}

function figureColumns(units: UnitSystem): readonly FigureColumn[] {
  const whole = (value: number | undefined): string | undefined =>
    value === undefined ? undefined : String(Math.round(value));
  return [
    {
      key: 'averagePower',
      heading: `Avg power (${POWER_UNIT})`,
      cell: (lap) =>
        lap.averagePower === undefined ? undefined : formatPowerValue(lap.averagePower),
    },
    {
      key: 'maxPower',
      heading: `Best power (${POWER_UNIT})`,
      cell: (lap) => (lap.maxPower === undefined ? undefined : formatPowerValue(lap.maxPower)),
    },
    {
      key: 'averageSpeed',
      heading: `Avg speed (${speedUnit(units)})`,
      cell: (lap) => {
        const speed = lapAverageSpeed(lap);
        return speed === undefined ? undefined : formatSpeed(speed, units).value;
      },
    },
    {
      key: 'averageHeartRate',
      heading: 'Avg heart rate (bpm)',
      cell: (lap) => whole(lap.averageHeartRate),
    },
    {
      key: 'maxHeartRate',
      heading: 'Highest heart rate (bpm)',
      cell: (lap) => whole(lap.maxHeartRate),
    },
    {
      key: 'averageCadence',
      heading: 'Avg cadence (rpm)',
      cell: (lap) => whole(lap.averageCadence),
    },
    {
      key: 'ascent',
      heading: `Climb (${smallDistanceUnit(units)})`,
      cell: (lap) =>
        lap.ascent === undefined ? undefined : formatSmallDistance(lap.ascent, units).value,
    },
  ];
}

/** The lap's row header: its number, and in words what marks it. */
function lapName(lap: LapRecord, best: boolean): ReactNode {
  const number = String(lap.ordinal + 1);
  if (lap.partial === true) {
    return `${number} · Part lap`;
  }
  return best ? `${number} · Best lap` : number;
}

export interface LapsTableProps {
  /** The ride's laps, in `ordinal` order, as `listLaps` returns them. */
  readonly laps: readonly LapRecord[];
  readonly units: UnitSystem;
}

export function LapsTable({ laps, units }: LapsTableProps): JSX.Element {
  if (laps.length === 0) {
    return <p className="oyl-muted">This ride has no laps recorded.</p>;
  }
  const best = bestLapIndex(laps);
  // Average power keeps its column on every ride, as it always had; the rest
  // are drawn only where some lap states them.
  const columns = figureColumns(units).filter(
    (column) => column.key === 'averagePower' || laps.some((lap) => column.cell(lap) !== undefined),
  );
  return (
    <>
      {/* `oyl-table--laps`: the Lap column stays put while the figures scroll
          under it (`theme.css`), so a figure can be tied to its lap by eye. */}
      <ScrollTable
        className="oyl-table oyl-table--laps"
        caption="Laps, in the order they were ridden"
      >
        <thead>
          <tr>
            <th scope="col">Lap</th>
            {/* #1437's review: the ride page's own names, moving first. */}
            <th scope="col">{MOVING_TIME_LABEL}</th>
            <th scope="col">{ELAPSED_TIME_LABEL}</th>
            <th scope="col">Distance ({distanceUnit(units)})</th>
            {columns.map((column) => (
              <th key={column.key} scope="col">
                {column.heading}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {laps.map((lap, index) => (
            <tr key={lap.id}>
              <th scope="row">{lapName(lap, index === best)}</th>
              <td>{formatDuration(lap.movingTime)}</td>
              <td>{formatDuration(lap.elapsedTime)}</td>
              <td>{formatDistance(lap.distance, units).value}</td>
              {columns.map((column) => (
                <td key={column.key}>{column.cell(lap) ?? NO_FIGURE}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </ScrollTable>
      <p className="oyl-muted">{LAP_TIMES_NOTE}</p>
    </>
  );
}
