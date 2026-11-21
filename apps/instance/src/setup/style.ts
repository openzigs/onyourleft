// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **`/setup/setup.css`** (#2784): the admin pages' stylesheet
 * (`admin/style.ts`), and after it the few rules only the setup wizard's
 * pages need. Every colour here is a token `admin/style.ts` already draws on
 * the same background, so its contrast pairs (`ADMIN_CONTRAST_PAIRS`) cover
 * this sheet too: no rule here names a colour of its own.
 *
 * - **The progress bar** across the header: one row of steps, each the same
 *   height whether it is a link or not. A done step carries a tick, the
 *   current one is filled, bold and underlined, and a step not reached yet
 *   carries its number: never colour alone. On a narrow screen only the marks
 *   show, and each name stays for a screen reader.
 * - **The six digits** to compare, large, in two groups of three.
 * - A block of text or a command to copy (`pre.copy`, #2817, #2858): wrapped,
 *   never scrolled sideways, so it needs no focus to be read with a keyboard,
 *   and selected whole by one click, since the pages carry no script.
 * - Spacing: a gap after a button before the next paragraph, a radio button
 *   level with its label, and no extra space above a card's first field.
 */

import { ADMIN_STYLE } from '../admin/style.ts';

const SETUP_RULES = `
.visually-hidden { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }

.steps ol { list-style: none; display: flex; flex-wrap: wrap; gap: 0 var(--oyl-space-xs); margin: var(--oyl-space-xs) 0 0; padding: 0; }
.steps li { margin: 0; }
.step { display: flex; align-items: center; gap: var(--oyl-space-sm); min-height: var(--admin-target); min-width: var(--admin-target); padding: 0 var(--oyl-space-sm); color: var(--oyl-color-ink-muted); text-decoration: none; border-bottom: 4px solid transparent; }
a.step { color: var(--oyl-color-ink); }
a.step:hover { color: var(--oyl-color-ink); background: var(--oyl-color-surface-raised); }
.step-mark { display: inline-flex; align-items: center; justify-content: center; flex: none; width: 1.75rem; height: 1.75rem; border: 2px solid var(--oyl-color-border); border-radius: 50%; font-size: var(--oyl-font-size-sm); font-weight: 700; font-variant-numeric: tabular-nums; }
.step[aria-current=step] { font-weight: 700; border-bottom-color: var(--oyl-color-accent-text); }
.step[aria-current=step] .step-mark { color: var(--oyl-color-accent-ink); background: var(--oyl-color-accent); border-color: var(--oyl-color-accent-text); }
@media (max-width: 47.99rem) {
  .steps ol { gap: 0 2px; }
  .step { justify-content: center; padding: 0; }
  .step .step-name { position: absolute; width: 1px; height: 1px; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
}

main > p, main > ul, main > ol { max-width: 68ch; }
form + p, form + .hint, form + form + p { margin-top: var(--oyl-space-lg); }
.panel > form:first-child, .panel > form:first-child > fieldset:first-of-type { margin-top: 0; }
.panel > form:first-child > label:first-of-type { margin-top: 0; }
.narrow { max-width: 36rem; }

.choice { display: flex; align-items: center; gap: var(--oyl-space-sm); min-height: var(--admin-target); }
.choice + .hint { margin: 0 0 var(--oyl-space-sm); padding-left: calc(1.5rem + var(--oyl-space-sm)); }
fieldset legend { padding: 0 var(--oyl-space-xs); }

.compare { display: flex; flex-wrap: wrap; gap: var(--oyl-space-lg); margin: var(--oyl-space-md) 0; font-family: var(--oyl-font-family-display); font-size: 3.5rem; font-weight: 800; line-height: 1; letter-spacing: 0.12em; font-variant-numeric: tabular-nums; }
.summary li { margin: var(--oyl-space-sm) 0; }
pre.copy { max-width: 68ch; margin: var(--oyl-space-sm) 0; padding: var(--oyl-space-sm); white-space: pre-wrap; overflow-wrap: anywhere; border-radius: 0.2em; background: var(--oyl-color-surface-raised); user-select: all; }
pre.copy code { padding: 0; background: transparent; }
`;

/** The whole of `/setup/setup.css`. */
export const SETUP_STYLE = `${ADMIN_STYLE}${SETUP_RULES}`;
