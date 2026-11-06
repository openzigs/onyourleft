// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **A loop's lap splits on the HUD** — #2080: the lap in progress, the last
 * lap and the best, each with its lap number, its time and its average power.
 * `lap-splits.ts` works the rows out; this draws them.
 *
 * ⚠️ **Only on a loop.** A point-to-point route has one lap, its whole
 * length, and the elevation strip already says how far along it the rider is
 * (`fields.ts` §`profileReading`), so `HudPanel` draws this only where
 * `plan.ts` §`planLap` gives a lap at all.
 *
 * ⚠️ **Where a race's standings are**, and in their place (`theme.css`
 * §"A RACE'S STANDINGS"): a panel of its own at the end edge under the
 * secondary readings on a tablet, and visually hidden on a phone, whose
 * corners are taken. In a race the two share that place, and the rider
 * swaps between them with {@link LapSplitsProps.swap}.
 *
 * ⚠️ **Not a live region**, as the standings are not (`RaceStandings.tsx`):
 * the lap in progress changes every second, and the lap's notice already
 * says each lap as it ends (`lap-text.ts` §`lapSummary`).
 */

import type { JSX, ReactNode } from 'react';

import { LAP_SPLITS_TEXT, type LapSplitRow, type LapSplitsView } from './lap-splits';

export interface LapSplitsProps {
  readonly splits: LapSplitsView;
  /** The control that swaps this panel with a race's standings, in a race. */
  readonly swap?: ReactNode;
}

function Row(props: { readonly row: LapSplitRow }): JSX.Element {
  const { row } = props;
  return (
    <tr className="oyl-hud__laps-row">
      <th scope="row" className="oyl-hud__laps-label">
        {row.label}
      </th>
      <td>{row.lap}</td>
      <td>{row.time}</td>
      <td>{row.power}</td>
    </tr>
  );
}

export function LapSplits(props: LapSplitsProps): JSX.Element {
  const { now, last, best } = props.splits;
  return (
    <section className="oyl-hud__panel oyl-hud__laps" aria-label={LAP_SPLITS_TEXT.name}>
      <table className="oyl-hud__laps-table">
        <thead>
          <tr>
            {/* The row's label column has no heading of its own to say. */}
            <td />
            <th scope="col">{LAP_SPLITS_TEXT.lap}</th>
            <th scope="col">{LAP_SPLITS_TEXT.time}</th>
            <th scope="col">{LAP_SPLITS_TEXT.power}</th>
          </tr>
        </thead>
        <tbody>
          <Row row={now} />
          <Row row={last} />
          <Row row={best} />
        </tbody>
      </table>
      {props.swap}
    </section>
  );
}
