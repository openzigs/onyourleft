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
 *   WAS selected (`data-oyl-select`), so a keyboard user is where they left —
 *   unless it was a link carrying {@link CREATE_ATTRIBUTE} that let it go
 *   ("Import a route", "Build a workout"), in which case focus moves to the
 *   element with id {@link CREATE_HEADING_ID}: the rider asked for the form,
 *   not for the item they had been looking at.
 * - Rotating from two panes to one with an item chosen hides the list. If
 *   focus was in it — on a list link, say — it would otherwise fall to
 *   `<body>`, so it moves to the chosen item's heading, which is what the one
 *   pane now shows. With nothing chosen the list stays, and so does focus.
 * - At two panes a skip link at the head of the list pane moves focus to the
 *   detail pane, so a keyboard user need not tab through forty rides. It goes
 *   ONE way: from the detail, the list is where Shift+Tab already leads, and
 *   at one pane there is only one pane to be in. Each pane is also a region
 *   with its own name.
 *
 * ## History
 *
 * Every selection is a link, so at BOTH widths choosing an item pushes a
 * history entry and back steps through the items chosen before it. That is
 * deliberate, not a side effect: each selection is an address a rider can
 * reload or share, a middle-click on a list link opens that item in a new tab,
 * and a window that rotates from two panes to one keeps a history whose back
 * button means the same thing either way. `replace` at two panes would need
 * every list link to intercept its own click, and back would then leave the
 * screen from a tablet but return to the list from a phone.
 */

import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type JSX,
  type MouseEvent,
  type ReactNode,
} from 'react';

import { ButtonLink } from '../design/Button';
import { ScreenNotes } from '../design/ScreenHelp';
import { SectionHeading } from '../design/SectionHelp';

import { hrefFor, hrefForSelection, type RouteDefinition } from './routes';

/** The custom property `theme.css` declares the two-pane width in. */
export const LIST_DETAIL_FROM_PROPERTY = '--oyl-list-detail-from';

/**
 * The id of the element focus moves to when an item is chosen. One per page:
 * a page holds one list–detail layout.
 */
export const SELECTED_HEADING_ID = 'oyl-selected-heading';

/** The attribute a list link carries, naming the item it selects. */
export const SELECT_ATTRIBUTE = 'data-oyl-select';

/**
 * The attribute a link carries when following it lets go of the selection in
 * order to show what the detail pane holds with nothing chosen — a builder or
 * an import form. Focus then moves to {@link CREATE_HEADING_ID}.
 */
export const CREATE_ATTRIBUTE = 'data-oyl-create';

/** The id of the heading of what the detail pane holds with nothing chosen. */
export const CREATE_HEADING_ID = 'oyl-create-heading';

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
  /**
   * What the list's ⓘ holds, beside its heading — #1013. Absent where the
   * list explains nothing beyond its one line.
   */
  readonly listHelp?: ReactNode;
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
  listHelp,
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
  const createPressed = useRef(false);
  const focusCreate = useRef(false);
  const wasTwo = useRef(two);

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
      focusCreate.current = createPressed.current;
      focusItem.current = createPressed.current ? undefined : previous.current;
      focusDetail.current = false;
    } else {
      focusDetail.current = true;
      focusItem.current = undefined;
      focusCreate.current = false;
    }
    createPressed.current = false;
    previous.current = selection;
  }, [selection]);

  // Two panes to one: a list that has just been hidden takes focus with it.
  // A layout effect, so focus is read before the browser's own fix-up moves
  // it to `<body>`.
  useLayoutEffect(() => {
    const rotatedToOne = wasTwo.current && !two;
    wasTwo.current = two;
    if (!rotatedToOne || selection === undefined) {
      return;
    }
    // Only focus that WAS in the list: a rider who had focused nothing is
    // not handed a focused heading by turning the tablet.
    const active = document.activeElement;
    if (active === null || listRef.current?.contains(active) !== true) {
      return;
    }
    const heading = detailRef.current?.querySelector(`#${SELECTED_HEADING_ID}`);
    if (heading instanceof HTMLElement) {
      heading.focus();
    } else {
      // The heading has not arrived yet; the every-render effect waits for it.
      focusDetail.current = true;
    }
  }, [two, selection]);

  // Every render: the detail may arrive after a read, and the list after a load.
  useEffect(() => {
    if (focusDetail.current) {
      const heading = detailRef.current?.querySelector(`#${SELECTED_HEADING_ID}`);
      if (heading instanceof HTMLElement) {
        focusDetail.current = false;
        heading.focus();
      }
    }
    if (focusCreate.current) {
      const heading = detailRef.current?.querySelector(`#${CREATE_HEADING_ID}`);
      if (heading instanceof HTMLElement) {
        focusCreate.current = false;
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

  function noteCreate(event: MouseEvent<HTMLDivElement>): void {
    // A click that opens the link somewhere else — a new tab or window, with
    // a modifier or a button other than the primary — leaves THIS tab's
    // selection alone, so it must not decide where this tab's focus goes on
    // the next way back to the list. #670's second review.
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) {
      return;
    }
    if (event.target instanceof Element && event.target.closest(`[${CREATE_ATTRIBUTE}]`) !== null) {
      createPressed.current = true;
    }
  }

  /*
   * The skip link's href is this page's OWN address, not a fragment naming the
   * pane: the shell routes on the hash (`AppShell` §"The skip link cannot be an
   * ordinary fragment link"), so `#<pane id>` opened in a new tab — a middle
   * click — was the not-found page. A plain click is prevented and moves focus
   * itself, as the shell's own skip link does; any other way of following it
   * opens this same list and item.
   */
  const here = selection === undefined ? hrefFor(route) : hrefForSelection(route, selection);
  /*
   * The route's safety and privacy notes (#993), which the shell renders below
   * every other view and leaves to this one. At one pane they are below the
   * view as everywhere else. At two panes they go at the END of the list pane:
   * below the view they were a row of the shell's column under both panes, and
   * the 48 px they took came off the detail pane's height, putting Routes'
   * *Import route* 42 px from its pane's bottom on the CI runner where the
   * floor is 50 (`list-detail.browser.spec.ts` §"#670 — each primary action's
   * place"). The list pane is in its place on arrival and with an item chosen,
   * and the notes still follow the pane's first control.
   */
  const notes = route.notes === undefined ? null : <ScreenNotes notes={route.notes} />;
  return (
    <>
      {/*
        The capture listener is not an interaction: it only NOTES that a create
        link was followed. Enter on a link fires `click`, so a keyboard counts.
      */}
      <div
        className={two ? 'oyl-list-detail oyl-list-detail--two' : 'oyl-list-detail'}
        data-oyl-panes={two ? '2' : '1'}
        onClickCapture={noteCreate}
      >
        <section
          className="oyl-list-detail__list"
          aria-labelledby={listHeadingId}
          data-oyl-pane="list"
          hidden={!showList}
          ref={listRef}
        >
          {two ? (
            <a className="oyl-pane-skip" href={here} onClick={skipToDetail}>
              Skip to {detailLabel.toLowerCase()}
            </a>
          ) : null}
          {listHelp === undefined ? (
            <h2 id={listHeadingId}>{listLabel}</h2>
          ) : (
            <SectionHeading level={2} id={listHeadingId} help={listHelp}>
              {listLabel}
            </SectionHeading>
          )}
          {list}
          {two ? notes : null}
        </section>
        <section
          className="oyl-list-detail__detail"
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
      {two ? null : notes}
    </>
  );
}

export interface CreateLinkProps {
  /** The list route: following the link lets go of the selection. */
  readonly route: RouteDefinition;
  readonly selection: string | undefined;
  /** What the link says, e.g. "Import a route". */
  readonly children: ReactNode;
}

/**
 * The way to what the detail pane holds with nothing chosen — a builder or an
 * import form — from the head of the list pane. #670's review (N1).
 *
 * With an item chosen that form is not on screen, and this is the pane's one
 * primary: following it lets go of the selection and {@link ListDetail} moves
 * focus to the form's heading ({@link CREATE_HEADING_ID}). With nothing
 * chosen the form IS on screen and its own submit is the primary, so this is
 * secondary and moves focus to the form without changing the route — on a
 * phone's one pane the form is under the whole list.
 *
 * Rendered in both states, so choosing an item does not move the list under
 * the pointer that chose it: only the emphasis changes.
 */
export function CreateLink({ route, selection, children }: CreateLinkProps): JSX.Element {
  const chosen = selection !== undefined;
  function jumpToForm(event: MouseEvent<HTMLAnchorElement>): void {
    const heading = document.getElementById(CREATE_HEADING_ID);
    if (heading !== null) {
      event.preventDefault();
      heading.focus();
    }
  }
  return (
    <ButtonLink
      href={hrefFor(route)}
      variant={chosen ? 'primary' : 'secondary'}
      create
      {...(chosen ? {} : { onClick: jumpToForm })}
    >
      {children}
    </ButtonLink>
  );
}
