// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The one-primary rule, as something a test can count — #668.
 *
 * A view has three kinds of button (`design/Button.tsx` §`ButtonVariant`):
 * **primary** for the one action the view exists for, **secondary** for every
 * other action, **tertiary** (#992) for the lowest of them, drawn as text, and
 * **toggle** for a control that changes how something is
 * shown rather than what happens. A rider tells the action from the setting by
 * weight, and weight only means something if there is one heaviest control —
 * so a `main` may hold **at most one** primary.
 *
 * A primary is anything drawn as `.oyl-button` without a lighter modifier. That
 * is a selector rather than a React prop on purpose: a link drawn as a button
 * (`a.oyl-button`) and a hand-written `<button className="oyl-button">` are
 * primaries to a rider exactly as `<Button>` is, and a rule that read props
 * would not see them.
 *
 * ## Per pane, on a list–detail route — #670
 *
 * A `main` laid out as a list beside its detail (`.oyl-main--list-detail`,
 * `shell/ListDetail.tsx`) is two views side by side, and each pane may hold
 * one primary: the Activities list's *Start a ride* and the selected ride's
 * *Open ride details* are on one screen at a landscape tablet. So on such a
 * `main` the rule counts each `[data-oyl-pane]` apart, and everything in the
 * `main` outside the panes as one more unit. **Only there**: a pane marker in
 * any other `main` is ignored and that `main` is still one view, so the rule
 * is not loosened by an attribute a view could add to itself.
 *
 * ## …and only at TWO panes — #723
 *
 * Below the breakpoint `ListDetail` stacks the panes and a phone scrolls them
 * as ONE view: the list's primary and the detail's primary are two heavy
 * controls on one page, which is exactly what the rule exists to stop. So the
 * panes are counted apart only while the layout says it has two
 * (`[data-oyl-panes="2"]`, written by `ListDetail`). At one pane — or where no
 * layout says how many it has, which fails closed — the `main` is one unit
 * again, and a pane the layout has `hidden` is left out of it, because it is
 * not on the page a rider scrolls: at one pane with an item chosen the list is
 * hidden and its *Build a workout* is not a second primary beside the item's.
 */

/** Every element drawn as a primary button. */
export const PRIMARY_BUTTON_SELECTOR =
  '.oyl-button:not(.oyl-button--secondary):not(.oyl-button--tertiary):not(.oyl-button--toggle)';

/** Every element drawn as a button of any kind. */
export const ANY_BUTTON_SELECTOR = '.oyl-button';

/** The most primaries a `main` may hold. */
export const MAXIMUM_PRIMARIES_PER_VIEW = 1;

/** One `main`, and what it holds. */
export interface ViewButtons {
  readonly main: Element;
  readonly primaries: readonly Element[];
  readonly buttons: number;
}

/** The buttons in every `main` under `root`. */
export function buttonsByView(root: ParentNode): ViewButtons[] {
  return [...root.querySelectorAll('main')].map((main) => ({
    main,
    primaries: [...main.querySelectorAll(PRIMARY_BUTTON_SELECTOR)],
    buttons: main.querySelectorAll(ANY_BUTTON_SELECTOR).length,
  }));
}

/** The class a `list-detail` route's `main` carries — `AppShell` writes `oyl-main--<layout>`. */
export const LIST_DETAIL_MAIN_CLASS = 'oyl-main--list-detail';

/** A pane of a list–detail layout — `shell/ListDetail.tsx`. */
export const PANE_SELECTOR = '[data-oyl-pane]';

/** A list–detail layout that has decided it shows two panes side by side — `shell/ListDetail.tsx`. */
export const TWO_PANES_SELECTOR = '[data-oyl-panes="2"]';

/** One unit the rule counts: a whole `main`, or one pane of a list–detail `main`. */
export interface PrimaryUnit {
  /** `main`, or `main, list pane` and the like, for a failure message. */
  readonly where: string;
  readonly primaries: readonly Element[];
}

/** The units the one-primary rule counts under `root`. @see LIST_DETAIL_MAIN_CLASS */
export function primaryUnits(root: ParentNode): PrimaryUnit[] {
  return [...root.querySelectorAll('main')].flatMap((main) => {
    const all = [...main.querySelectorAll(PRIMARY_BUTTON_SELECTOR)];
    if (!main.classList.contains(LIST_DETAIL_MAIN_CLASS)) {
      return [{ where: 'main', primaries: all }];
    }
    const panes = [...main.querySelectorAll(PANE_SELECTOR)];
    if (main.querySelector(TWO_PANES_SELECTOR) === null) {
      // One pane: one page, scrolled as one. A hidden pane is not on it.
      const hidden = panes.filter((pane) => pane.closest('[hidden]') !== null);
      return [
        {
          where: 'main',
          primaries: all.filter((element) => !hidden.some((pane) => pane.contains(element))),
        },
      ];
    }
    const inPane = (element: Element): boolean => panes.some((pane) => pane.contains(element));
    return [
      { where: 'main, outside its panes', primaries: all.filter((element) => !inPane(element)) },
      ...panes.map((pane) => ({
        where: `main, ${pane.getAttribute('data-oyl-pane') ?? ''} pane`,
        primaries: all.filter((element) => pane.contains(element)),
      })),
    ];
  });
}

/**
 * A sentence per unit — a `main`, or a pane of a list–detail `main` — holding
 * more primaries than {@link MAXIMUM_PRIMARIES_PER_VIEW}, naming each by its
 * text; empty when none does.
 */
export function onePrimaryViolations(root: ParentNode): string[] {
  return primaryUnits(root)
    .filter((unit) => unit.primaries.length > MAXIMUM_PRIMARIES_PER_VIEW)
    .map(
      (unit) =>
        `${String(unit.primaries.length)} primary buttons in one view` +
        (unit.where === 'main' ? '' : ` (${unit.where})`) +
        ': ' +
        unit.primaries
          .map((element) => `“${(element.textContent ?? '').replace(/\s+/g, ' ').trim()}”`)
          .join(', '),
    );
}
