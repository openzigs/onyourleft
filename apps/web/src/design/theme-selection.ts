// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Which palette paints — #672, the owner's ruling of 2026-09-27: the page
 * follows the device (`prefers-color-scheme`), with an override in Settings.
 *
 * ## Decided before the first paint, by a script that cannot import this file
 *
 * A module runs after the stylesheet has been applied and a frame may already
 * have been drawn, so a rider in a dark room would see one frame of white. The
 * choice is therefore made by {@link THEME_SELECTION_SCRIPT}: a few lines of
 * classic, synchronous script that `tools/theme/theme-selection-plugin.ts`
 * writes into the `<head>` of every page Vite builds — the product's and every
 * browser-gate harness's — ahead of any stylesheet. It sets `data-theme` on
 * the root element, which is what `theme.css`'s dark block keys on, and points
 * the two `theme-color` metas at the palette in force.
 *
 * The script is a string written HERE, beside the key and the values it reads,
 * so the key is written once (§`THEME_STORAGE_KEY`). The same rules are
 * implemented a second time below, as functions the Settings screen calls; a
 * string cannot be called and the page cannot import a module before it paints.
 * `theme-selection.test.ts` runs the script and the functions over every
 * combination of stored choice, device preference and failure, and requires
 * them to leave the page in the same state — which is what stops the two
 * copies drifting.
 *
 * ## `localStorage`, not the athlete row
 *
 * IndexedDB is asynchronous, so a choice kept on the athlete row (where the
 * unit preference lives, ADR 0020 D-2) could never be read before a paint. A
 * display preference of THIS device goes where `game/world-preference.ts` and
 * the sound and announcement choices already go, and an erase removes it
 * (`transfer/erase-device.ts`). A private window or blocked site data reads as
 * "follow the device", and never takes the page down.
 */

import type { Theme } from './tokens';

/** Namespaced, because the origin is shared. The `v1` is the value's. */
export const THEME_STORAGE_KEY = 'oyl.theme.v1';

/**
 * The three things a rider can choose. `device` is kept as NO stored value,
 * so a rider who never opens Settings and one who chose "Match this device"
 * are the same device.
 */
export const THEME_CHOICES = ['device', 'light', 'dark'] as const;

/** A rider's choice. */
export type ThemeChoice = (typeof THEME_CHOICES)[number];

/** The media query a device's own preference is read from. */
export const DEVICE_DARK_QUERY = '(prefers-color-scheme: dark)';

/**
 * The attribute on each `theme-color` meta naming the palette its colour is
 * for. `index.html` carries two, and `offline/manifest.test.ts` holds each to
 * `tokens.ts` §`themeColour`.
 */
export const THEME_META_ATTRIBUTE = 'data-oyl-theme';

/** What this module needs of `localStorage`. */
export interface ThemeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** The stored choice. Never throws; anything unreadable is `device`. */
export function readThemeChoice(storage: ThemeStorage | undefined): ThemeChoice {
  try {
    const stored = storage?.getItem(THEME_STORAGE_KEY);
    return stored === 'light' || stored === 'dark' ? stored : 'device';
  } catch {
    return 'device';
  }
}

/**
 * Keep the choice. `device` removes the key rather than storing a word, for
 * {@link THEME_CHOICES}' reason. `false` when the device refused, so the screen
 * can say the choice will not survive a reload rather than pretend.
 */
export function writeThemeChoice(storage: ThemeStorage | undefined, choice: ThemeChoice): boolean {
  if (storage === undefined) return false;
  try {
    if (choice === 'device') {
      storage.removeItem(THEME_STORAGE_KEY);
    } else {
      storage.setItem(THEME_STORAGE_KEY, choice);
    }
    return true;
  } catch {
    return false;
  }
}

/** The palette a choice comes to on a device that does or does not prefer dark. */
export function resolveTheme(choice: ThemeChoice, devicePrefersDark: boolean): Theme {
  if (choice !== 'device') return choice;
  return devicePrefersDark ? 'dark' : 'light';
}

/** What {@link applyThemeChoice} needs of `window`. */
export interface ThemeWindow {
  readonly document: Document;
  readonly localStorage?: ThemeStorage | undefined;
  matchMedia?: ((query: string) => { readonly matches: boolean }) | undefined;
}

/** Whether the device prefers dark. Never throws; no answer is "no". */
function devicePrefersDark(win: ThemeWindow): boolean {
  try {
    return win.matchMedia?.(DEVICE_DARK_QUERY).matches === true;
  } catch {
    return false;
  }
}

/** `window.localStorage`, which itself throws where site data is blocked. */
function storageOf(win: ThemeWindow): ThemeStorage | undefined {
  try {
    return win.localStorage;
  } catch {
    return undefined;
  }
}

/**
 * Put the page in the palette the stored choice comes to — the Settings
 * screen's half of {@link THEME_SELECTION_SCRIPT}, and the same rules.
 *
 * Sets `data-theme` on the root element, and points the `theme-color` metas:
 * while following the device each keeps its own `prefers-color-scheme` media
 * query, so the browser switches them itself; under an override the chosen
 * palette's meta applies to `all` and the other to `not all`.
 */
export function applyThemeChoice(win: ThemeWindow): Theme {
  const choice = readThemeChoice(storageOf(win));
  const theme = resolveTheme(choice, devicePrefersDark(win));
  const root = win.document.documentElement;
  root.setAttribute('data-theme', theme);
  for (const meta of win.document.querySelectorAll(
    `meta[name="theme-color"][${THEME_META_ATTRIBUTE}]`,
  )) {
    const palette = meta.getAttribute(THEME_META_ATTRIBUTE);
    meta.setAttribute(
      'media',
      choice === 'device'
        ? `(prefers-color-scheme: ${String(palette)})`
        : palette === theme
          ? 'all'
          : 'not all',
    );
  }
  return theme;
}

/**
 * The script that runs before the first paint. ES5 and no module syntax,
 * because it is inlined as a classic `<script>`; every name it reads is one of
 * the constants above, interpolated, so none is typed twice.
 *
 * It re-reads the stored choice on every device change, so a rider who chose
 * a palette in Settings is not moved by the device afterwards, and one who
 * went back to "Match this device" is followed again with no reload. It runs
 * once more when the document has been parsed, because it runs ahead of the
 * `theme-color` metas it points.
 */
export const THEME_SELECTION_SCRIPT = `(function () {
  var key = ${JSON.stringify(THEME_STORAGE_KEY)};
  var attribute = ${JSON.stringify(THEME_META_ATTRIBUTE)};
  var query = null;
  try { query = window.matchMedia(${JSON.stringify(DEVICE_DARK_QUERY)}); } catch (error) {}
  function stored() {
    try {
      var value = window.localStorage.getItem(key);
      return value === 'light' || value === 'dark' ? value : null;
    } catch (error) {
      return null;
    }
  }
  function apply() {
    var choice = stored();
    var theme = choice || (query && query.matches ? 'dark' : 'light');
    document.documentElement.setAttribute('data-theme', theme);
    var metas = document.querySelectorAll('meta[name="theme-color"][' + attribute + ']');
    for (var index = 0; index < metas.length; index += 1) {
      var palette = metas[index].getAttribute(attribute);
      metas[index].setAttribute(
        'media',
        choice ? (palette === theme ? 'all' : 'not all') : '(prefers-color-scheme: ' + palette + ')'
      );
    }
  }
  apply();
  if (query && query.addEventListener) query.addEventListener('change', apply);
  document.addEventListener('DOMContentLoaded', apply);
})();`;
