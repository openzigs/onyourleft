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
 * Not for a table cell, a sentence, or the ride's own live metrics: a table is
 * read across a row at one size, a sentence is prose, and the ride screen's
 * numbers are `ride/MetricGrid.tsx`'s, at the size #49 states.
 */
export function Reading({
  value,
  unit,
}: {
  /** The digits, formatted — `formatDuration`, `formatDistance(…).value`. */
  readonly value: string;
  /** The unit label beside them, if the reading has one. */
  readonly unit?: string | undefined;
}): JSX.Element {
  return (
    <span className="oyl-reading">
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
