// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A list beside its detail — #670.
 *
 * Material 3's list–detail canonical layout, taken as a PATTERN (ADR 0009: no
 * other product's screens): at an expanded window the list sits in a pane of
 * fixed width and the detail takes the rest; below that there is one pane, and
 * choosing an item replaces the list with its detail, which is its own history
 * entry, so the back button returns to the list.
 *
 * ## One breakpoint, and it is in `theme.css`
 *
 * {@link LIST_DETAIL_FROM_PROPERTY} is declared once, in `theme.css`'s `:root`,
 * and read from there at run time — so the stylesheet is the one place the
 * width is written, not three literals and not a TypeScript copy of it.
 * `browser/list-detail.browser.spec.ts` is what proves the read works: with
 * the property gone, a landscape tablet gets one pane and the spec fails.
 *
 * ## Why the pane that is not shown is `hidden` rather than styled away
 *
 * `a11y/audit.ts` loads no stylesheet (CLAUDE.md §4e), so a pane hidden by a
 * media query alone would look present and focusable to the audit and to
 * `tabbableElements`. Deciding the panes here and writing the `hidden`
 * attribute keeps what the audit sees and what a rider sees the same — and
 * lets `routes.a11y.test.tsx` render both widths by answering `matchMedia`.
 * A hidden pane stays MOUNTED, so a list's scroll-free state (its sort, its
 * loaded rows) is still there when back shows it again.
 *
 * ## Focus
 *
 * - Choosing an item — Enter on its link, or a click — moves focus to the
 *   element with id {@link SELECTED_HEADING_ID} inside the detail pane, which
 *   the view gives to the selected item's heading or to its "not found"
 *   heading. Not on first render: a reload or a shared link leaves focus where
 *   the browser put it, `AppShell`'s own rule.
 * - Going back to no selection moves focus to the list link of the item that
 *   WAS selected (`data-oyl-select`), so a keyboard user is where they left.
 * - A skip link at the head of the list pane moves focus to the detail pane
 *   when both are on screen, so a keyboard user need not tab through forty
 *   rides. Each pane is also a region with its own name.
 */

import {
  useEffect,
  useId,
  useRef,
  useState,
  type JSX,
  type MouseEvent,
  type ReactNode,
} from 'react';

import { hrefFor, type RouteDefinition } from './routes';

/** The custom property `theme.css` declares the two-pane width in. */
export const LIST_DETAIL_FROM_PROPERTY = '--oyl-list-detail-from';

/**
 * The id of the element focus moves to when an item is chosen. One per page:
 * a page holds one list–detail layout.
 */
export const SELECTED_HEADING_ID = 'oyl-selected-heading';

/** The attribute a list link carries, naming the item it selects. */
export const SELECT_ATTRIBUTE = 'data-oyl-select';

/** The media query two panes need, or `undefined` where it cannot be read. */
function twoPaneQuery(): string | undefined {
  if (typeof window.matchMedia !== 'function') {
    return undefined;
  }
  const from = getComputedStyle(document.documentElement)
    .getPropertyValue(LIST_DETAIL_FROM_PROPERTY)
    .trim();
  return from === '' ? undefined : `(min-width: ${from})`;
}

function twoPanesNow(): boolean {
  const query = twoPaneQuery();
  return query !== undefined && window.matchMedia(query).matches;
}

/**
 * Whether this window is wide enough for two panes, kept current.
 *
 * `false` where there is no `matchMedia` or the breakpoint cannot be read —
 * one pane is the layout that works at every width.
 */
export function useTwoPanes(): boolean {
  const [two, setTwo] = useState(twoPanesNow);
  useEffect(() => {
    const query = twoPaneQuery();
    if (query === undefined) {
      return undefined;
    }
    const list = window.matchMedia(query);
    const changed = (): void => {
      setTwo(list.matches);
    };
    changed();
    list.addEventListener('change', changed);
    return () => {
      list.removeEventListener('change', changed);
    };
  }, []);
  return two;
}

export interface ListDetailProps {
  /** The list route, which the back link goes to. */
  readonly route: RouteDefinition;
  /** The selected item's id, from the URL, or `undefined`. */
  readonly selection: string | undefined;
  /** The list pane's heading, and so its region's name. */
  readonly listLabel: string;
  /** The detail pane's region name. */
  readonly detailLabel: string;
  /** What the one-pane back link says, e.g. "All rides". */
  readonly backLabel: string;
  readonly list: ReactNode;
  readonly detail: ReactNode;
  /**
   * Whether the detail pane is worth a pane of its own on a narrow window
   * with nothing selected — true where it holds a builder or an import form,
   * false where it would only say "choose one".
   */
  readonly detailWithoutSelection: boolean;
}

export function ListDetail({
  route,
  selection,
  listLabel,
  detailLabel,
  backLabel,
  list,
  detail,
  detailWithoutSelection,
}: ListDetailProps): JSX.Element {
  const two = useTwoPanes();
  const listHeadingId = useId();
  const listRef = useRef<HTMLElement>(null);
  const detailRef = useRef<HTMLElement>(null);
  const previous = useRef<string | undefined>(selection);
  const started = useRef(false);
  const focusDetail = useRef(false);
  const focusItem = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!started.current) {
      started.current = true;
      previous.current = selection;
      return;
    }
    if (previous.current === selection) {
      return;
    }
    if (selection === undefined) {
      focusItem.current = previous.current;
      focusDetail.current = false;
    } else {
      focusDetail.current = true;
      focusItem.current = undefined;
    }
    previous.current = selection;
  }, [selection]);

  // Every render: the detail may arrive after a read, and the list after a load.
  useEffect(() => {
    if (focusDetail.current) {
      const heading = detailRef.current?.querySelector(`#${SELECTED_HEADING_ID}`);
      if (heading instanceof HTMLElement) {
        focusDetail.current = false;
        heading.focus();
      }
    }
    const item = focusItem.current;
    if (item !== undefined) {
      const link = [...(listRef.current?.querySelectorAll(`[${SELECT_ATTRIBUTE}]`) ?? [])].find(
        (candidate) => candidate.getAttribute(SELECT_ATTRIBUTE) === item,
      );
      if (link instanceof HTMLElement) {
        focusItem.current = undefined;
        link.focus();
      }
    }
  });

  const showList = two || selection === undefined;
  const showDetail = two || selection !== undefined || detailWithoutSelection;

  function skipToDetail(event: MouseEvent<HTMLAnchorElement>): void {
    event.preventDefault();
    detailRef.current?.focus();
  }

  const detailId = `${listHeadingId}-detail`;
  return (
    <div
      className={two ? 'oyl-list-detail oyl-list-detail--two' : 'oyl-list-detail'}
      data-oyl-panes={two ? '2' : '1'}
    >
      <section
        className="oyl-list-detail__list"
        aria-labelledby={listHeadingId}
        data-oyl-pane="list"
        hidden={!showList}
        ref={listRef}
      >
        {two ? (
          <a className="oyl-pane-skip" href={`#${detailId}`} onClick={skipToDetail}>
            Skip to {detailLabel.toLowerCase()}
          </a>
        ) : null}
        <h2 id={listHeadingId}>{listLabel}</h2>
        {list}
      </section>
      <section
        className="oyl-list-detail__detail"
        id={detailId}
        aria-label={detailLabel}
        data-oyl-pane="detail"
        tabIndex={-1}
        hidden={!showDetail}
        ref={detailRef}
      >
        {!two && selection !== undefined ? (
          <p>
            <a href={hrefFor(route)}>{backLabel}</a>
          </p>
        ) : null}
        {detail}
      </section>
    </div>
  );
}
