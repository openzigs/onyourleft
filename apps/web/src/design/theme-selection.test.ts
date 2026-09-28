// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The inline script and the module agree — #672.
 *
 * `THEME_SELECTION_SCRIPT` is a string, so no typechecker and no import can
 * tie it to the functions the Settings screen calls. This runs it: over every
 * combination of what is stored, what the device prefers and what fails, the
 * script and {@link applyThemeChoice} must leave the page in the same state —
 * the root's `data-theme` and both `theme-color` metas' media.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import {
  DEVICE_DARK_QUERY,
  THEME_META_ATTRIBUTE,
  THEME_SELECTION_SCRIPT,
  THEME_STORAGE_KEY,
  applyThemeChoice,
  readThemeChoice,
  themeEraser,
  resolveTheme,
  writeThemeChoice,
  type ThemeStorage,
  type ThemeWindow,
} from './theme-selection';

/** What a device's storage holds, or that it throws when read. */
type Stored = 'absent' | 'light' | 'dark' | 'garbage' | 'throws';
/** What the device prefers, or that asking it fails. */
type Device = 'dark' | 'light' | 'throws' | 'absent';

class MemoryStorage implements ThemeStorage {
  readonly values = new Map<string, string>();
  throws = false;
  getItem(key: string): string | null {
    if (this.throws) throw new Error('SecurityError');
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    if (this.throws) throw new Error('QuotaExceededError');
    this.values.set(key, value);
  }
  removeItem(key: string): void {
    if (this.throws) throw new Error('SecurityError');
    this.values.delete(key);
  }
}

interface FakeQuery {
  matches: boolean;
  readonly listeners: (() => void)[];
  addEventListener(type: string, listener: () => void): void;
}

interface Page {
  readonly window: ThemeWindow;
  readonly storage: MemoryStorage;
  readonly query: FakeQuery;
}

/** A fresh document with the two metas `index.html` carries. */
function freshPage(stored: Stored, device: Device): Page {
  document.documentElement.removeAttribute('data-theme');
  document.head.innerHTML =
    `<meta name="theme-color" content="#0b5c55" media="(prefers-color-scheme: light)" ${THEME_META_ATTRIBUTE}="light" />` +
    `<meta name="theme-color" content="#2b3433" media="(prefers-color-scheme: dark)" ${THEME_META_ATTRIBUTE}="dark" />`;
  const storage = new MemoryStorage();
  if (stored === 'throws') storage.throws = true;
  else if (stored !== 'absent') storage.values.set(THEME_STORAGE_KEY, stored);
  const query: FakeQuery = {
    matches: device === 'dark',
    listeners: [],
    addEventListener(type, listener) {
      if (type === 'change') this.listeners.push(listener);
    },
  };
  const win: ThemeWindow = {
    document,
    localStorage: storage,
    matchMedia:
      device === 'absent'
        ? undefined
        : (text: string) => {
            if (device === 'throws') throw new Error('matchMedia');
            expect(text).toBe(DEVICE_DARK_QUERY);
            return query;
          },
  };
  return { window: win, storage, query };
}

/** Run the inline script against `page`, as the browser would. */
function runScript(page: Page): void {
  // eslint-disable-next-line @typescript-eslint/no-implied-eval -- the script, as a page's `<script>` would run it
  const run = new Function('window', 'document', THEME_SELECTION_SCRIPT) as (
    win: unknown,
    doc: Document,
  ) => void;
  run(page.window, document);
}

/** What the page says after a run. */
function state(): { theme: string | null; media: (string | null)[] } {
  return {
    theme: document.documentElement.getAttribute('data-theme'),
    media: [...document.querySelectorAll('meta[name="theme-color"]')].map((meta) =>
      meta.getAttribute('media'),
    ),
  };
}

const STORED: readonly Stored[] = ['absent', 'light', 'dark', 'garbage', 'throws'];
const DEVICES: readonly Device[] = ['dark', 'light', 'throws', 'absent'];

describe('the inline script and the module leave the page in the same state', () => {
  for (const stored of STORED) {
    for (const device of DEVICES) {
      it(`stored ${stored}, device ${device}`, () => {
        runScript(freshPage(stored, device));
        const byScript = state();
        applyThemeChoice(freshPage(stored, device).window);
        expect(state()).toEqual(byScript);
      });
    }
  }

  it('comes to the palette the rules say, not merely the same one twice', () => {
    // Agreement alone passes over two copies that are wrong together.
    const expected: Record<Stored, Record<Device, string>> = {
      absent: { dark: 'dark', light: 'light', throws: 'light', absent: 'light' },
      light: { dark: 'light', light: 'light', throws: 'light', absent: 'light' },
      dark: { dark: 'dark', light: 'dark', throws: 'dark', absent: 'dark' },
      garbage: { dark: 'dark', light: 'light', throws: 'light', absent: 'light' },
      throws: { dark: 'dark', light: 'light', throws: 'light', absent: 'light' },
    };
    for (const stored of STORED) {
      for (const device of DEVICES) {
        runScript(freshPage(stored, device));
        expect(state().theme, `stored ${stored}, device ${device}`).toBe(expected[stored][device]);
      }
    }
  });

  it('points the metas at the palette in force', () => {
    runScript(freshPage('absent', 'dark'));
    expect(state().media).toEqual([
      '(prefers-color-scheme: light)',
      '(prefers-color-scheme: dark)',
    ]);
    runScript(freshPage('light', 'dark'));
    expect(state().media).toEqual(['all', 'not all']);
    runScript(freshPage('dark', 'light'));
    expect(state().media).toEqual(['not all', 'all']);
  });
});

describe('the inline script follows the device, and only while nothing is chosen', () => {
  let page: Page;
  beforeEach(() => {
    page = freshPage('absent', 'light');
    runScript(page);
  });

  it('switches to dark when the device does, with no reload', () => {
    expect(state().theme).toBe('light');
    page.query.matches = true;
    for (const listener of page.query.listeners) listener();
    expect(state().theme).toBe('dark');
  });

  it('stays where a rider put it when the device changes afterwards', () => {
    page.storage.values.set(THEME_STORAGE_KEY, 'light');
    page.query.matches = true;
    for (const listener of page.query.listeners) listener();
    expect(state().theme).toBe('light');
  });

  it('points the metas again once the document has been parsed', () => {
    // The script runs ahead of the metas it points; this is its second pass.
    page.storage.values.set(THEME_STORAGE_KEY, 'dark');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    expect(state().media).toEqual(['not all', 'all']);
  });
});

describe('the stored choice', () => {
  it('reads anything but light or dark as following the device, and never throws', () => {
    const storage = new MemoryStorage();
    expect(readThemeChoice(undefined)).toBe('device');
    expect(readThemeChoice(storage)).toBe('device');
    storage.values.set(THEME_STORAGE_KEY, 'sepia');
    expect(readThemeChoice(storage)).toBe('device');
    storage.values.set(THEME_STORAGE_KEY, 'dark');
    expect(readThemeChoice(storage)).toBe('dark');
    storage.throws = true;
    expect(readThemeChoice(storage)).toBe('device');
  });

  it('keeps following the device as NO stored value', () => {
    const storage = new MemoryStorage();
    expect(writeThemeChoice(storage, 'dark')).toBe(true);
    expect(storage.values.get(THEME_STORAGE_KEY)).toBe('dark');
    expect(writeThemeChoice(storage, 'device')).toBe(true);
    expect(storage.values.has(THEME_STORAGE_KEY)).toBe(false);
  });

  it('says so when the device refuses to keep it', () => {
    const storage = new MemoryStorage();
    storage.throws = true;
    expect(writeThemeChoice(storage, 'light')).toBe(false);
    expect(writeThemeChoice(undefined, 'light')).toBe(false);
  });

  it('resolves a choice against the device', () => {
    expect(resolveTheme('device', true)).toBe('dark');
    expect(resolveTheme('device', false)).toBe('light');
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });
});

describe('the script is one a page can inline', () => {
  it('names the key, the query and the attribute this module exports, and no other', () => {
    expect(THEME_SELECTION_SCRIPT).toContain(JSON.stringify(THEME_STORAGE_KEY));
    expect(THEME_SELECTION_SCRIPT).toContain(JSON.stringify(DEVICE_DARK_QUERY));
    expect(THEME_SELECTION_SCRIPT).toContain(JSON.stringify(THEME_META_ATTRIBUTE));
    expect([...THEME_SELECTION_SCRIPT.matchAll(/oyl\.[a-z.0-9]+/gi)].map(([key]) => key)).toEqual([
      THEME_STORAGE_KEY,
    ]);
  });

  it('cannot end the script element it is inlined in, and uses no module syntax', () => {
    expect(THEME_SELECTION_SCRIPT).not.toMatch(/<\/script/i);
    expect(THEME_SELECTION_SCRIPT).not.toMatch(/\b(?:import|export)\b/);
  });
});

describe('an erase forgets the choice and puts the page back on the device (#672)', () => {
  it('removes the key and follows the device at once, with no reload', () => {
    const page = freshPage('light', 'dark');
    runScript(page);
    expect(state().theme).toBe('light');
    themeEraser(page.window).forget();
    expect(page.storage.values.has(THEME_STORAGE_KEY)).toBe(false);
    expect(state().theme).toBe('dark');
    expect(state().media).toEqual([
      '(prefers-color-scheme: light)',
      '(prefers-color-scheme: dark)',
    ]);
  });

  it('does not throw where the device refuses', () => {
    const page = freshPage('throws', 'dark');
    expect(() => {
      themeEraser(page.window).forget();
    }).not.toThrow();
  });
});
