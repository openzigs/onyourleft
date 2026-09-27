// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Whether the activity library is a table or a list of cards — #660.
 *
 * #654 measured the library laying out 447 px wide inside a 320 px phone with
 * no rides in it at all: six columns have a minimum width, and the header row
 * alone is wider than a phone. WCAG 2.2 SC 1.4.10 would let a table keep its
 * columns inside a scroll box of its own, but a ride list is not a
 * two-dimensional thing a rider reads across — it is a list of rides, and
 * Material 3's list–detail layout collapses to exactly that on a compact
 * width. So on a narrow width it IS a list, and where the columns fit it stays
 * a table.
 *
 * ## Decided by the width the library is GIVEN, not by the window
 *
 * A media query knows the viewport. What decides whether six columns fit is
 * the box they are laid out in, which is the window less the navigation rail
 * (a rail appears at 37.5 rem, #427), less `.oyl-main`'s padding, capped by
 * the reading measure — so the same window can hold the table beside a bar
 * and not beside a rail. `ActivitiesView` measures its own container with a
 * `ResizeObserver` and hands the width here.
 *
 * ## The threshold, and where it came from
 *
 * The empty table's own minimum was measured at **447 px** in the pinned
 * Chromium (#654) — the header row, before any ride. A populated row with an
 * unbreakable name is wider still until the name is allowed to break, which
 * `theme.css` §`.oyl-library__name` allows. {@link TABLE_FROM_REM} is 32 rem,
 * 512 px at the default text size: 65 px clear of the measured minimum, and in
 * rem so that a rider who has raised their text size gets the list sooner,
 * which is when the columns stop fitting. `reflow.browser.spec.ts` is what
 * checks the answer at 320, 390 and 844 px — this constant is not the gate.
 *
 * ## Where there is nothing to measure
 *
 * `undefined` — no `ResizeObserver`, which is jsdom and the accessibility
 * suite — is a table, the layout every test before #660 was written against.
 * The list is exercised there by handing the view a width.
 */

export type LibraryLayout = 'table' | 'cards';

/** The container width, in rem, from which the six columns are drawn as a table. */
export const TABLE_FROM_REM = 32;

/**
 * @param containerWidth the library container's content width, in CSS px, or
 *   `undefined` where nothing measured it
 * @param remPixels the root font size in CSS px
 */
export function libraryLayout(
  containerWidth: number | undefined,
  remPixels: number,
): LibraryLayout {
  if (containerWidth === undefined || !(remPixels > 0)) {
    return 'table';
  }
  return containerWidth < TABLE_FROM_REM * remPixels ? 'cards' : 'table';
}
