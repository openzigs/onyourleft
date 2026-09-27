// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The one-primary rule, as something a test can count — #668.
 *
 * A view has three kinds of button (`design/Button.tsx` §`ButtonVariant`):
 * **primary** for the one action the view exists for, **secondary** for every
 * other action, and **toggle** for a control that changes how something is
 * shown rather than what happens. A rider tells the action from the setting by
 * weight, and weight only means something if there is one heaviest control —
 * so a `main` may hold **at most one** primary.
 *
 * A primary is anything drawn as `.oyl-button` without a lighter modifier. That
 * is a selector rather than a React prop on purpose: a link drawn as a button
 * (`a.oyl-button`) and a hand-written `<button className="oyl-button">` are
 * primaries to a rider exactly as `<Button>` is, and a rule that read props
 * would not see them.
 */

/** Every element drawn as a primary button. */
export const PRIMARY_BUTTON_SELECTOR =
  '.oyl-button:not(.oyl-button--secondary):not(.oyl-button--toggle)';

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

/**
 * A sentence per `main` holding more primaries than {@link
 * MAXIMUM_PRIMARIES_PER_VIEW}, naming each by its text; empty when none does.
 */
export function onePrimaryViolations(root: ParentNode): string[] {
  return buttonsByView(root)
    .filter((view) => view.primaries.length > MAXIMUM_PRIMARIES_PER_VIEW)
    .map(
      (view) =>
        `${String(view.primaries.length)} primary buttons in one view: ` +
        view.primaries
          .map((element) => `“${(element.textContent ?? '').replace(/\s+/g, ' ').trim()}”`)
          .join(', '),
    );
}
