// SPDX-License-Identifier: AGPL-3.0-or-later

import { useId, type JSX, type ReactNode } from 'react';

/**
 * A data table inside its own keyboard-reachable scroll region — #660.
 *
 * WCAG 2.2 SC 1.4.10 (Reflow) requires that nothing make the PAGE scroll
 * sideways at 320 CSS px, and exempts content that needs a two-dimensional
 * layout — a data table is the standard example. The exemption is not a pass
 * for the page: the table may keep its columns only inside a box of its own
 * that scrolls, and a box that scrolls is a box a keyboard user must be able to
 * reach, which means it takes focus, has a role and has a name (#654's
 * re-review). This is that box, and it is the only way a table is rendered in
 * this client — `a11y/audit.ts` §`table-in-scroll-region` fails a route whose
 * table is not a direct child of one.
 *
 * ## Why the region is named BY the caption
 *
 * `aria-labelledby` points at the table's own `<caption>`, so a screen reader
 * tabbing onto the region hears the same words that name the table, and a
 * caption cannot be edited without the region's name following it. Every table
 * here already had a caption; this makes it required.
 *
 * ## What it costs
 *
 * One tab stop per table, including a table that happens to fit. Adding the
 * `tabindex` only once the table overflows would need a measurement in every
 * render and would make the tab order depend on the window's width, which is
 * the more surprising of the two.
 *
 * And one `region` landmark per table, which is the other half of that cost
 * (#683's review, kept as a trade-off rather than changed): a page with two
 * tables whose captions read the same would be two landmarks of one role and
 * one name, which a landmark list cannot tell apart. Give each table its own
 * caption. Since #690 `a11y/audit.ts` §`landmarks-are-distinguishable`
 * enforces it: it reads a declared `role="region"` as well as the tags, so two
 * identical captions on one page fail the accessibility gate.
 *
 * ⚠️ `browser/reflow.browser.spec.ts` is what measures that a box which DOES
 * scroll sideways is one of these; this component is what makes that true.
 */
export interface ScrollTableProps {
  /** The table's caption, which also names the region around it. Required. */
  readonly caption: ReactNode;
  /** The table's own class — `oyl-table`, `oyl-data-table`, or none. */
  readonly className?: string;
  /** `thead`, `tbody` and `tfoot`. */
  readonly children: ReactNode;
}

export function ScrollTable({ caption, className, children }: ScrollTableProps): JSX.Element {
  const captionId = useId();
  return (
    <div className="oyl-scroll-region" role="region" aria-labelledby={captionId} tabIndex={0}>
      <table {...(className === undefined ? {} : { className })}>
        <caption id={captionId}>{caption}</caption>
        {children}
      </table>
    </div>
  );
}
