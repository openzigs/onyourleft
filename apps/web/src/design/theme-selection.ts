// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Which palette paints — #672, the owner's ruling of 2026-09-27: a choice in
 * Settings of light, dark or the device's own (`prefers-color-scheme`).
 *
 * ## Dark by default — #992
 *
 * ⚠️ **A device that has never chosen gets the DARK palette**, the owner's
 * ruling of 2026-10-02 on epic #935, and a reviewer who remembers "the page
 * follows the device until a rider chooses otherwise" is reading the old file.
 * So "Match this device" is now a STORED word like the other two — it used to
 * be the absence of one, and absence now means {@link DEFAULT_THEME_CHOICE}.
 * The key keeps its `v1`: every value a v1 key ever held still means what it
 * meant, and only the empty key's meaning moved, which is the ruling itself.
 * The HUD is untouched: `theme.css` §`.oyl-hud` pins it to the light palette
 * whatever the page is in.
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
 * the default (dark, #992), and never takes the page down.
 *
 * ## A choice the device refused, and a choice made in another tab
 *
 * Where the device will not keep a choice (a private window, a full quota
 * with an OLDER choice still stored), the page still takes it, and holds it
 * for the page's life on the root element ({@link THEME_OVERRIDE_ATTRIBUTE}),
 * which the script and {@link applyThemeChoice} both read BEFORE storage — so
 * a later device change does not put the page back on a choice the rider
 * replaced (#744's review). A choice another tab keeps reaches this one
 * through the `storage` event, which clears the held choice and applies the
 * stored one: the newest choice wins, whichever tab made it.
 */

import type { Theme } from './tokens';

/** Namespaced, because the origin is shared. The `v1` is the value's. */
export const THEME_STORAGE_KEY = 'oyl.theme.v1';

/**
 * The three things a rider can choose, each kept as its own word (#992).
 */
export const THEME_CHOICES = ['device', 'light', 'dark'] as const;

/** A rider's choice. */
export type ThemeChoice = (typeof THEME_CHOICES)[number];

/**
 * What a device that has never chosen — or whose storage cannot be read —
 * gets: dark, the owner's ruling of 2026-10-02 (#992). The inline script
 * interpolates this, so the two copies of the rules cannot disagree on it.
 */
export const DEFAULT_THEME_CHOICE: ThemeChoice = 'dark';

/** Whether a stored or held word is one of {@link THEME_CHOICES}. */
function isThemeChoice(value: string | null | undefined): value is ThemeChoice {
  return value === 'device' || value === 'light' || value === 'dark';
}

/** The media query a device's own preference is read from. */
export const DEVICE_DARK_QUERY = '(prefers-color-scheme: dark)';

/**
 * The attribute on each `theme-color` meta naming the palette its colour is
 * for. `index.html` carries two, and `offline/manifest.test.ts` holds each to
 * `tokens.ts` §`themeColour`.
 */
export const THEME_META_ATTRIBUTE = 'data-oyl-theme';

/**
 * The root element's attribute that holds, for this page's life only, a choice
 * the device refused to keep — `device`, `light` or `dark`. Read before
 * storage by the script and by {@link applyThemeChoice}.
 */
export const THEME_OVERRIDE_ATTRIBUTE = 'data-oyl-theme-override';

/** What this module needs of `localStorage`. */
export interface ThemeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * This device's `localStorage`, or `undefined` where reaching for it throws —
 * a private window, or site data blocked.
 */
export function deviceThemeStorage(): ThemeStorage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

/**
 * The stored choice. Never throws; nothing stored, and anything unreadable,
 * is {@link DEFAULT_THEME_CHOICE}.
 */
export function readThemeChoice(storage: ThemeStorage | undefined): ThemeChoice {
  try {
    const stored = storage?.getItem(THEME_STORAGE_KEY);
    return isThemeChoice(stored) ? stored : DEFAULT_THEME_CHOICE;
  } catch {
    return DEFAULT_THEME_CHOICE;
  }
}

/**
 * Keep the choice, as its own word — `device` too since #992, because an empty
 * key is now the default and not the device. `false` when the device refused,
 * so the screen can say the choice will not survive a reload rather than
 * pretend.
 */
export function writeThemeChoice(storage: ThemeStorage | undefined, choice: ThemeChoice): boolean {
  if (storage === undefined) return false;
  try {
    storage.setItem(THEME_STORAGE_KEY, choice);
    return true;
  } catch {
    return false;
  }
}

/**
 * What an erase does to the choice (#672): removes the key, so the page is
 * back on {@link DEFAULT_THEME_CHOICE} (#992). `transfer/erase-device.ts`
 * §`ERASE_REMOVES` names it.
 */
export function forgetThemeChoice(storage: ThemeStorage | undefined): void {
  try {
    storage?.removeItem(THEME_STORAGE_KEY);
  } catch {
    // Nothing kept is nothing to forget, and an erase must not fail on it.
  }
}

/** The palette a choice comes to on a device that does or does not prefer dark. */
export function resolveTheme(choice: ThemeChoice, devicePrefersDark: boolean): Theme {
  if (choice !== 'device') return choice;
  return devicePrefersDark ? 'dark' : 'light';
}

/** The choice this page holds because the device would not keep it, if any. */
function heldThemeChoice(doc: Document): ThemeChoice | undefined {
  const held = doc.documentElement.getAttribute(THEME_OVERRIDE_ATTRIBUTE);
  return isThemeChoice(held) ? held : undefined;
}

/**
 * The choice in force on this page: one it holds because the device refused
 * to keep it, or else the stored one. What Settings shows as chosen.
 */
export function currentThemeChoice(doc: Document, storage: ThemeStorage | undefined): ThemeChoice {
  return heldThemeChoice(doc) ?? readThemeChoice(storage);
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
  const choice = currentThemeChoice(win.document, storageOf(win));
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
 * A rider's choice, from Settings: kept on the device where it will keep it,
 * held on the page for its life where it will not, and applied at once.
 * `false` when the device refused, so the screen can say the choice will not
 * survive a reload.
 */
export function chooseTheme(win: ThemeWindow, choice: ThemeChoice): boolean {
  const kept = writeThemeChoice(storageOf(win), choice);
  const root = win.document.documentElement;
  if (kept) {
    root.removeAttribute(THEME_OVERRIDE_ATTRIBUTE);
  } else {
    root.setAttribute(THEME_OVERRIDE_ATTRIBUTE, choice);
  }
  applyThemeChoice(win);
  return kept;
}

/**
 * The script that runs before the first paint. ES5 and no module syntax,
 * because it is inlined as a classic `<script>`; every name it reads is one of
 * the constants above, interpolated, so none is typed twice.
 *
 * Nothing stored is {@link DEFAULT_THEME_CHOICE} (#992). It re-reads the
 * stored choice on every device change, so a rider who chose a palette is not
 * moved by the device afterwards, and one who chose "Match this device" is
 * followed with no reload. A choice
 * the page holds ({@link THEME_OVERRIDE_ATTRIBUTE}) is read before storage.
 * Another tab's choice arrives as a `storage` event for the key — or with no
 * key, which is a `clear()` — and replaces any held one. It runs once more
 * when the document has been parsed, because it runs ahead of the
 * `theme-color` metas it points.
 */
export const THEME_SELECTION_SCRIPT = `(function () {
  var key = ${JSON.stringify(THEME_STORAGE_KEY)};
  var attribute = ${JSON.stringify(THEME_META_ATTRIBUTE)};
  var held = ${JSON.stringify(THEME_OVERRIDE_ATTRIBUTE)};
  var fallback = ${JSON.stringify(DEFAULT_THEME_CHOICE)};
  var query = null;
  try { query = window.matchMedia(${JSON.stringify(DEVICE_DARK_QUERY)}); } catch (error) {}
  function known(value) {
    return value === 'device' || value === 'light' || value === 'dark';
  }
  function stored() {
    var holding = document.documentElement.getAttribute(held);
    if (known(holding)) return holding;
    try {
      var value = window.localStorage.getItem(key);
      return known(value) ? value : fallback;
    } catch (error) {
      return fallback;
    }
  }
  function apply() {
    var choice = stored();
    var device = choice === 'device';
    var theme = device ? (query && query.matches ? 'dark' : 'light') : choice;
    document.documentElement.setAttribute('data-theme', theme);
    var metas = document.querySelectorAll('meta[name="theme-color"][' + attribute + ']');
    for (var index = 0; index < metas.length; index += 1) {
      var palette = metas[index].getAttribute(attribute);
      metas[index].setAttribute(
        'media',
        device ? '(prefers-color-scheme: ' + palette + ')' : palette === theme ? 'all' : 'not all'
      );
    }
  }
  apply();
  if (query && query.addEventListener) query.addEventListener('change', apply);
  if (window.addEventListener) {
    window.addEventListener('storage', function (event) {
      if (event.key !== key && event.key !== null) return;
      document.documentElement.removeAttribute(held);
      apply();
    });
  }
  document.addEventListener('DOMContentLoaded', apply);
})();`;

/**
 * The erase's half (#672): forget the choice and put THIS page back on the
 * default palette (#992) at once, so an erased device is not left showing the
 * palette a rider chose until the next reload.
 */
export function themeEraser(win: ThemeWindow): { forget(): void } {
  return {
    forget: () => {
      forgetThemeChoice(storageOf(win));
      win.document.documentElement.removeAttribute(THEME_OVERRIDE_ATTRIBUTE);
      applyThemeChoice(win);
    },
  };
}

/**
 * The palette the page is in now, read off the root element: `dark` when
 * `data-theme` says so, and `light` otherwise — which is what `theme.css`
 * paints for any other value, so this and the stylesheet cannot disagree.
 */
export function documentTheme(doc: Document): Theme {
  return doc.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

/**
 * Call `listener` with the new palette each time the page changes palette,
 * until the returned function is called (#672 part b — the map follows).
 *
 * ## Why it watches the attribute rather than offering a subscribe call
 *
 * `data-theme` has four writers: the inline script's device listener and its
 * `storage` listener (another tab), {@link chooseTheme} (Settings) and
 * {@link themeEraser} (erase). Two of them are a classic script that runs
 * before any module exists and cannot call one, so a subscription list here
 * would hear Settings and miss the device and every other tab. The attribute
 * is the one place all four meet, and it is what `theme.css` keys on, so a
 * `MutationObserver` over it follows exactly what the page's own colours
 * follow. It hears a change of VALUE only: a write of the palette already in
 * force calls nothing.
 *
 * One observer per call, disconnected by the returned function, so its owner
 * — `map/themed-map.ts`, one per map — decides its lifetime.
 */
export function watchDocumentTheme(doc: Document, listener: (theme: Theme) => void): () => void {
  let current = documentTheme(doc);
  const observer = new MutationObserver(() => {
    const next = documentTheme(doc);
    if (next === current) return;
    current = next;
    listener(next);
  });
  observer.observe(doc.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return () => {
    observer.disconnect();
  };
}
