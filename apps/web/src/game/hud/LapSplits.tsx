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
 *
 * ⚠️ **A list, not a table** — PR #2248's review. A table on this client is
 * the child of a focusable, named scroll region (`design/ScrollTable.tsx`,
 * the a11y gate's `table-in-scroll-region`), and a HUD panel must not add a
 * tab stop to a ride. So the three rows are a list, as the standings' lines
 * are: the column headings are drawn once over them for the eye and hidden
 * from a screen reader, which hears each figure with its own heading instead
 * ("Now, Lap 3, Time 1:15, Avg power —").
 */

import type { JSX, ReactNode } from 'react';

import { LAP_SPLITS_TEXT, type LapSplitRow, type LapSplitsView } from './lap-splits';

export interface LapSplitsProps {
  readonly splits: LapSplitsView;
  /** The control that swaps this panel with a race's standings, in a race. */
  readonly swap?: ReactNode;
}

/** A figure, with its column's heading said before it and not drawn. */
function Figure(props: { readonly heading: string; readonly value: string }): JSX.Element {
  return (
    <span className="oyl-hud__laps-figure">
      <span className="oyl-visually-hidden">{props.heading} </span>
      <span className="oyl-hud__laps-value">{props.value}</span>
    </span>
  );
}

function Row(props: { readonly row: LapSplitRow }): JSX.Element {
  const { row } = props;
  // The spaces are the words' own: a screen reader reads a row as one run of
  // text, as it reads a standings line. The grid drops them visually.
  return (
    <li className="oyl-hud__laps-row">
      <span className="oyl-hud__laps-label">{row.label}</span>{' '}
      <Figure heading={LAP_SPLITS_TEXT.lap} value={row.lap} />{' '}
      <Figure heading={LAP_SPLITS_TEXT.time} value={row.time} />{' '}
      <Figure heading={LAP_SPLITS_TEXT.power} value={row.power} />
    </li>
  );
}

export function LapSplits(props: LapSplitsProps): JSX.Element {
  const { now, last, best } = props.splits;
  return (
    <section className="oyl-hud__panel oyl-hud__laps" aria-label={LAP_SPLITS_TEXT.name}>
      {/* The column headings, for the eye: each figure says its own. */}
      <div className="oyl-hud__laps-head" aria-hidden="true">
        <span />
        <span>{LAP_SPLITS_TEXT.lap}</span>
        <span>{LAP_SPLITS_TEXT.time}</span>
        <span>{LAP_SPLITS_TEXT.power}</span>
      </div>
      {/* `role="list"` because list-style none makes WebKit drop the semantics. */}
      <ul className="oyl-hud__laps-list" role="list">
        <Row row={now} />
        <Row row={last} />
        <Row row={best} />
      </ul>
      {props.swap}
    </section>
  );
}
