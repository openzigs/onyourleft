// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Writes `design/theme-selection.ts` §`THEME_SELECTION_SCRIPT` into the
 * `<head>` of every page Vite builds — #672.
 *
 * ## Why a plugin, and not the script typed into `index.html`
 *
 * The script reads a storage key and two values the Settings screen writes,
 * and a copy typed into an HTML file is a second place for the key to be
 * spelled. From here there is one: the string is interpolated from the
 * module's own constants. And it reaches the browser-gate harness pages as
 * well as the product's, because the dark-palette walks (§4f) have to run the
 * same selection the product does — a harness that set `data-theme` itself
 * would be measuring a page no rider sees.
 *
 * ## Where it goes
 *
 * Straight after the `<meta charset>` — which has to stay inside the first
 * 1024 bytes — and so ahead of every stylesheet Vite injects, which in a build
 * are `<link>`s at the end of the `<head>`. A synchronous script before the
 * first stylesheet is what makes the first paint the right palette. A page
 * with no `<meta charset>` or no `<head>` fails the build rather than getting
 * a script somewhere it cannot keep that promise.
 */

import type { Plugin } from 'vite';

import { THEME_SELECTION_SCRIPT } from '../../src/design/theme-selection';

/** The marker the inlined script opens with, so a gate can find it in `dist`. */
export const THEME_SELECTION_MARKER = 'oyl-theme-selection';

/** `html` with the selection script after its charset declaration. */
export function withThemeSelection(html: string, page: string): string {
  const charset = /<meta\s+charset=["']?[\w-]+["']?\s*\/?>/i.exec(html);
  if (charset === null || !/<head[\s>]/i.test(html.slice(0, charset.index))) {
    throw new Error(
      `oyl-theme-selection: ${page} has no <meta charset> inside its <head>, so there is nowhere ` +
        'to put the theme script ahead of every stylesheet — see tools/theme/theme-selection-plugin.ts',
    );
  }
  const end = charset.index + charset[0].length;
  const script = `\n    <script id="${THEME_SELECTION_MARKER}">\n${THEME_SELECTION_SCRIPT}\n    </script>`;
  return html.slice(0, end) + script + html.slice(end);
}

/** The plugin, for `vite.config.ts` and `vite.browser.config.ts` alike. */
export function themeSelection(): Plugin {
  return {
    name: 'oyl-theme-selection',
    transformIndexHtml: {
      order: 'pre',
      handler: (html, context) => withThemeSelection(html, context.path),
    },
  };
}
