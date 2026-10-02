// SPDX-License-Identifier: AGPL-3.0-or-later

import type { JSX } from 'react';

/**
 * A reading — #992, the owner's ruling of 2026-10-02 on epic #935: every
 * time, distance, power, climb and count a menu states as a fact is drawn
 * here, and only here, as LARGE TABULAR numerals with a SMALL unit label.
 *
 * ⚠️ **One component, so the type scale is one decision.** A view that sets
 * its own size for a number has made a second scale nobody declared; the
 * value's size is `theme.css` §`.oyl-reading__value` (`--oyl-font-size-xxl`)
 * and the unit's is `--oyl-font-size-sm`, in `inkMuted` — a declared pair on
 * the canvas and on every surface a tile is drawn in.
 *
 * ⚠️ **The text is the sentence it replaced.** The value and the unit are two
 * spans with a plain space between them, so the element's text — what a
 * screen reader reads and what `a11y/route-sentences.a11y.test.tsx` records —
 * is `'42.2 km'` exactly as before. A reading with no unit (a time, a count)
 * is its value alone.
 *
 * Not for a table cell or a sentence: a table is read across a row at one
 * size, and a sentence is prose.
 *
 * ⚠️ **The ride screen's live numbers ARE readings since #1012**, and a
 * reviewer who remembers this comment saying they were not is reading the old
 * file. They are drawn `size="metric"`: the same tabular numerals and small
 * unit, at #49's two-metre size (`--oyl-font-size-metric`, held to
 * `ride/MetricGrid.tsx` §`MINIMUM_PRIMARY_METRIC_REM` by
 * `a11y/ride-legibility.a11y.test.ts`) rather than a menu fact's `xxl`. Still
 * one component, so still one scale: the two sizes are two declared steps.
 */
export function Reading({
  value,
  unit,
  size = 'fact',
}: {
  /** The digits, formatted — `formatDuration`, `formatDistance(…).value`. */
  readonly value: string;
  /** The unit label beside them, if the reading has one. */
  readonly unit?: string | undefined;
  /**
   * `fact`, a menu's fact at `xxl`; or `metric`, a live ride number read from
   * two metres (#49, #1012).
   */
  readonly size?: 'fact' | 'metric';
}): JSX.Element {
  return (
    <span className={size === 'metric' ? 'oyl-reading oyl-reading--metric' : 'oyl-reading'}>
      <span className="oyl-reading__value">{value}</span>
      {unit === undefined ? null : (
        <>
          {' '}
          <span className="oyl-reading__unit">{unit}</span>
        </>
      )}
    </span>
  );
}
