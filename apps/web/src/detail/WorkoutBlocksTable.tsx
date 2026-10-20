// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A ride's workout blocks, as its page lists them — #1319: one row per block
 * of each structured workout ridden, with the block's target, its time, and
 * what was ridden in it.
 *
 * ## Beside the laps, never in them
 *
 * A ride on a course with a workout running has both, and they are two tables
 * under two headings: **Laps** first (the course's), then **Workout blocks**
 * (the workout's). A lap and a block measure different things — the road
 * once round, a section of the plan — and their boundaries do not line up, so
 * one table holding both would put rows side by side that have nothing to
 * compare (the owner's ruling on #1312: laps are by course only).
 *
 * ## What is said of a block, in words
 *
 * The row header says what became of it — **Cut short**, **Skipped**,
 * **Eased** — never a colour alone (SC 1.4.1), so a block the rider never
 * reached or the stall rescue eased does not read as a block ridden badly. A
 * skipped block has a dash for every figure.
 *
 * The target is `workoutBlockText`'s, the sentence the Workouts screen and
 * the ride screen use: a share of threshold, never watts.
 *
 * ## A column only when some block has the figure
 *
 * As `LapsTable` does: a ride with no strap has no heart-rate column.
 */

import type { JSX } from 'react';

import { workoutBlockText } from '@onyourleft/domain';
import type { WorkoutBlockFact } from '@onyourleft/store';

import { ScrollTable } from '../design/ScrollTable';
import {
  ELAPSED_TIME_LABEL,
  formatDuration,
  formatPowerValue,
  MOVING_TIME_LABEL,
  POWER_UNIT,
} from '../format';

/** What a cell shows for a figure this block does not have. */
const NO_FIGURE = '—';

/**
 * Said under the table whenever it has a row. One line, under
 * `a11y/section-lines.ts` §`SECTION_LINE_CHARACTERS`.
 */
export const BLOCK_TIMES_NOTE = `Averages are over a block’s moving time. Eased: the trainer was eased when your cadence fell.`;

/** One optional column: its heading, and what a block shows in it. */
interface FigureColumn {
  readonly key: string;
  readonly heading: string;
  readonly cell: (block: WorkoutBlockFact) => string | undefined;
}

const whole = (value: number | undefined): string | undefined =>
  value === undefined ? undefined : String(Math.round(value));

/** A figure of a block that was ridden; a skipped block has none. */
function ridden<T>(
  block: WorkoutBlockFact,
  read: (each: Exclude<WorkoutBlockFact, { outcome: 'skipped' }>) => T | undefined,
): T | undefined {
  return block.outcome === 'skipped' ? undefined : read(block);
}

const FIGURE_COLUMNS: readonly FigureColumn[] = [
  {
    key: 'averagePower',
    heading: `Avg power (${POWER_UNIT})`,
    cell: (block) =>
      ridden(block, (each) =>
        each.averagePower === undefined ? undefined : formatPowerValue(each.averagePower),
      ),
  },
  {
    key: 'maxPower',
    heading: `Best power (${POWER_UNIT})`,
    cell: (block) =>
      ridden(block, (each) =>
        each.maxPower === undefined ? undefined : formatPowerValue(each.maxPower),
      ),
  },
  {
    key: 'averageHeartRate',
    heading: 'Avg heart rate (bpm)',
    cell: (block) => ridden(block, (each) => whole(each.averageHeartRate)),
  },
  {
    key: 'maxHeartRate',
    heading: 'Highest heart rate (bpm)',
    cell: (block) => ridden(block, (each) => whole(each.maxHeartRate)),
  },
  {
    key: 'averageCadence',
    heading: 'Avg cadence (rpm)',
    cell: (block) => ridden(block, (each) => whole(each.averageCadence)),
  },
];

/** The block's row header: its number, and in words what became of it. */
export function blockName(block: WorkoutBlockFact, index: number): string {
  const number = String(index + 1);
  switch (block.outcome) {
    case 'skipped':
      return `${number} · Skipped`;
    case 'cut-short':
      return block.eased === true ? `${number} · Cut short, eased` : `${number} · Cut short`;
    case 'ridden':
      return block.eased === true ? `${number} · Eased` : number;
  }
}

export interface WorkoutBlocksTableProps {
  /** The ride's workout blocks, in the order they came up (`RideFacts.workoutBlocks`). */
  readonly blocks: readonly WorkoutBlockFact[];
}

export function WorkoutBlocksTable({ blocks }: WorkoutBlocksTableProps): JSX.Element {
  // Average power keeps its column, as on the laps table; the rest are drawn
  // only where some block states them.
  const columns = FIGURE_COLUMNS.filter(
    (column) =>
      column.key === 'averagePower' || blocks.some((block) => column.cell(block) !== undefined),
  );
  return (
    <>
      <ScrollTable
        className="oyl-table oyl-table--laps"
        caption="Workout blocks, in the order they came up"
      >
        <thead>
          <tr>
            <th scope="col">Block</th>
            <th scope="col">Target</th>
            <th scope="col">{MOVING_TIME_LABEL}</th>
            <th scope="col">{ELAPSED_TIME_LABEL}</th>
            {columns.map((column) => (
              <th key={column.key} scope="col">
                {column.heading}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {blocks.map((block, index) => (
            // Blocks have no id: their place in the ride is what they are.
            <tr key={index}>
              <th scope="row">{blockName(block, index)}</th>
              <td>{workoutBlockText(block.block)}</td>
              <td>{ridden(block, (each) => formatDuration(each.movingTime)) ?? NO_FIGURE}</td>
              <td>{ridden(block, (each) => formatDuration(each.elapsedTime)) ?? NO_FIGURE}</td>
              {columns.map((column) => (
                <td key={column.key}>{column.cell(block) ?? NO_FIGURE}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </ScrollTable>
      <p className="oyl-muted">{BLOCK_TIMES_NOTE}</p>
    </>
  );
}
