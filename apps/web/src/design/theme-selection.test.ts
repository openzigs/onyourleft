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

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_THEME_CHOICE,
  DEVICE_DARK_QUERY,
  THEME_META_ATTRIBUTE,
  THEME_OVERRIDE_ATTRIBUTE,
  THEME_SELECTION_SCRIPT,
  THEME_STORAGE_KEY,
  applyThemeChoice,
  chooseTheme,
  currentThemeChoice,
  documentTheme,
  readThemeChoice,
  themeEraser,
  resolveTheme,
  watchDocumentTheme,
  writeThemeChoice,
  type ThemeStorage,
  type ThemeWindow,
} from './theme-selection';

/** What a device's storage holds, or that it throws when read. */
type Stored = 'absent' | 'device' | 'light' | 'dark' | 'garbage' | 'throws';
/** What the device prefers, or that asking it fails. */
type Device = 'dark' | 'light' | 'throws' | 'absent';

class MemoryStorage implements ThemeStorage {
  readonly values = new Map<string, string>();
  throws = false;
  /** Reads, and refuses every write — a full quota with an older value kept. */
  refusesWrites = false;
  getItem(key: string): string | null {
    if (this.throws) throw new Error('SecurityError');
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    if (this.throws || this.refusesWrites) throw new Error('QuotaExceededError');
    this.values.set(key, value);
  }
  removeItem(key: string): void {
    if (this.throws || this.refusesWrites) throw new Error('SecurityError');
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
  /** What the script registered for `storage` events on the window. */
  readonly storageListeners: ((event: { key: string | null }) => void)[];
}

/** A choice this page holds because the device would not keep it, or none. */
type Held = 'none' | 'device' | 'light' | 'dark';

/** Another tab's write reaching this one. */
function storageEvent(page: Page, key: string | null): void {
  for (const listener of page.storageListeners) listener({ key });
}

/** The device changing its preference under the page. */
function deviceBecomesDark(page: Page, dark: boolean): void {
  page.query.matches = dark;
  for (const listener of page.query.listeners) listener();
}

/** A fresh document with the two metas `index.html` carries. */
function freshPage(stored: Stored, device: Device, held: Held = 'none'): Page {
  document.documentElement.removeAttribute('data-theme');
  if (held === 'none') document.documentElement.removeAttribute(THEME_OVERRIDE_ATTRIBUTE);
  else document.documentElement.setAttribute(THEME_OVERRIDE_ATTRIBUTE, held);
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
  const storageListeners: ((event: { key: string | null }) => void)[] = [];
  const win: ThemeWindow & {
    addEventListener(type: string, listener: (event: { key: string | null }) => void): void;
  } = {
    addEventListener(type, listener) {
      if (type === 'storage') storageListeners.push(listener);
    },
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
  return { window: win, storage, query, storageListeners };
}

afterEach(() => {
  document.documentElement.removeAttribute(THEME_OVERRIDE_ATTRIBUTE);
});

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

const STORED: readonly Stored[] = ['absent', 'device', 'light', 'dark', 'garbage', 'throws'];
const DEVICES: readonly Device[] = ['dark', 'light', 'throws', 'absent'];
const HELD: readonly Held[] = ['none', 'device', 'light', 'dark'];

describe('the inline script and the module leave the page in the same state', () => {
  for (const held of HELD) {
    for (const stored of STORED) {
      for (const device of DEVICES) {
        it(`held ${held}, stored ${stored}, device ${device}`, () => {
          runScript(freshPage(stored, device, held));
          const byScript = state();
          applyThemeChoice(freshPage(stored, device, held).window);
          expect(state()).toEqual(byScript);
        });
      }
    }
  }

  it('reads a choice the page holds before the stored one', () => {
    // Agreement alone passes over two copies that both ignore the held choice.
    runScript(freshPage('light', 'light', 'dark'));
    expect(state().theme).toBe('dark');
    runScript(freshPage('dark', 'light', 'device'));
    expect(state().theme).toBe('light');
    applyThemeChoice(freshPage('light', 'light', 'dark').window);
    expect(state().theme).toBe('dark');
    applyThemeChoice(freshPage('dark', 'light', 'device').window);
    expect(state().theme).toBe('light');
  });

  it('comes to the palette the rules say, not merely the same one twice', () => {
    // Agreement alone passes over two copies that are wrong together. #992:
    // nothing stored, something unreadable, and storage that throws are all
    // DARK whatever the device says; only a stored `device` follows it.
    const expected: Record<Stored, Record<Device, string>> = {
      absent: { dark: 'dark', light: 'dark', throws: 'dark', absent: 'dark' },
      device: { dark: 'dark', light: 'light', throws: 'light', absent: 'light' },
      light: { dark: 'light', light: 'light', throws: 'light', absent: 'light' },
      dark: { dark: 'dark', light: 'dark', throws: 'dark', absent: 'dark' },
      garbage: { dark: 'dark', light: 'dark', throws: 'dark', absent: 'dark' },
      throws: { dark: 'dark', light: 'dark', throws: 'dark', absent: 'dark' },
    };
    for (const stored of STORED) {
      for (const device of DEVICES) {
        runScript(freshPage(stored, device));
        expect(state().theme, `stored ${stored}, device ${device}`).toBe(expected[stored][device]);
      }
    }
  });

  it('points the metas at the palette in force', () => {
    runScript(freshPage('device', 'dark'));
    expect(state().media).toEqual([
      '(prefers-color-scheme: light)',
      '(prefers-color-scheme: dark)',
    ]);
    // #992: nothing chosen is the dark palette on every device.
    runScript(freshPage('absent', 'light'));
    expect(state().media).toEqual(['not all', 'all']);
    runScript(freshPage('light', 'dark'));
    expect(state().media).toEqual(['all', 'not all']);
    runScript(freshPage('dark', 'light'));
    expect(state().media).toEqual(['not all', 'all']);
  });
});

describe('the inline script follows the device, and only while that is the choice', () => {
  let page: Page;
  beforeEach(() => {
    page = freshPage('device', 'light');
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

describe('a device that has never chosen is dark — #992', () => {
  it('is dark under a light device, and a device change does not move it', () => {
    const page = freshPage('absent', 'light');
    runScript(page);
    expect(state().theme).toBe('dark');
    deviceBecomesDark(page, true);
    deviceBecomesDark(page, false);
    expect(state().theme).toBe('dark');
    expect(DEFAULT_THEME_CHOICE).toBe('dark');
    expect(currentThemeChoice(document, page.storage)).toBe('dark');
  });

  it('keeps "Match this device" as a word, so it is not read back as the default', () => {
    const page = freshPage('absent', 'light');
    runScript(page);
    expect(chooseTheme(page.window, 'device')).toBe(true);
    expect(page.storage.values.get(THEME_STORAGE_KEY)).toBe('device');
    expect(state().theme).toBe('light');
    runScript(freshPage('device', 'light'));
    expect(state().theme).toBe('light');
  });
});

describe('another tab’s choice reaches this one (#744’s review)', () => {
  it('applies a choice another tab kept, with no reload and no device change', () => {
    const page = freshPage('device', 'light');
    runScript(page);
    expect(state().theme).toBe('light');
    page.storage.values.set(THEME_STORAGE_KEY, 'dark');
    storageEvent(page, THEME_STORAGE_KEY);
    expect(state().theme).toBe('dark');
    expect(state().media).toEqual(['not all', 'all']);
  });

  it('goes back to the default when another tab clears storage', () => {
    const page = freshPage('light', 'light');
    runScript(page);
    expect(state().theme).toBe('light');
    page.storage.values.clear();
    storageEvent(page, null);
    expect(state().theme).toBe('dark');
  });

  it('ignores a write to any other key', () => {
    const page = freshPage('device', 'light');
    runScript(page);
    page.storage.values.set(THEME_STORAGE_KEY, 'dark');
    storageEvent(page, 'oyl.something.else');
    expect(state().theme).toBe('light');
  });

  it('replaces a choice this page held, because the newest choice wins', () => {
    const page = freshPage('absent', 'light', 'light');
    runScript(page);
    page.storage.values.set(THEME_STORAGE_KEY, 'dark');
    storageEvent(page, THEME_STORAGE_KEY);
    expect(state().theme).toBe('dark');
    expect(document.documentElement.hasAttribute(THEME_OVERRIDE_ATTRIBUTE)).toBe(false);
  });
});

describe('a choice the device refuses to keep holds for the page’s life (#744’s review)', () => {
  it('in a private window, a device change later does not undo it', () => {
    const page = freshPage('throws', 'light');
    runScript(page);
    expect(chooseTheme(page.window, 'dark')).toBe(false);
    expect(state().theme).toBe('dark');
    deviceBecomesDark(page, true);
    deviceBecomesDark(page, false);
    expect(state().theme).toBe('dark');
    expect(currentThemeChoice(document, page.storage)).toBe('dark');
  });

  it('with a full quota, a device change does not bring back the OLDER stored choice', () => {
    const page = freshPage('light', 'light');
    page.storage.refusesWrites = true;
    runScript(page);
    expect(chooseTheme(page.window, 'dark')).toBe(false);
    expect(page.storage.values.get(THEME_STORAGE_KEY)).toBe('light');
    deviceBecomesDark(page, true);
    deviceBecomesDark(page, false);
    expect(state().theme).toBe('dark');
  });

  it('holds "Match this device" too, over an older stored palette', () => {
    const page = freshPage('dark', 'light');
    page.storage.refusesWrites = true;
    runScript(page);
    expect(chooseTheme(page.window, 'device')).toBe(false);
    expect(state().theme).toBe('light');
    deviceBecomesDark(page, true);
    expect(state().theme).toBe('dark');
    deviceBecomesDark(page, false);
    expect(state().theme).toBe('light');
  });

  it('holds nothing once the device keeps a choice', () => {
    const page = freshPage('absent', 'light', 'dark');
    runScript(page);
    expect(chooseTheme(page.window, 'light')).toBe(true);
    expect(document.documentElement.hasAttribute(THEME_OVERRIDE_ATTRIBUTE)).toBe(false);
    expect(page.storage.values.get(THEME_STORAGE_KEY)).toBe('light');
    expect(state().theme).toBe('light');
  });
});

describe('the stored choice', () => {
  it('reads anything but the three words as the default, dark, and never throws (#992)', () => {
    const storage = new MemoryStorage();
    expect(readThemeChoice(undefined)).toBe('dark');
    expect(readThemeChoice(storage)).toBe('dark');
    storage.values.set(THEME_STORAGE_KEY, 'sepia');
    expect(readThemeChoice(storage)).toBe('dark');
    storage.values.set(THEME_STORAGE_KEY, 'light');
    expect(readThemeChoice(storage)).toBe('light');
    storage.values.set(THEME_STORAGE_KEY, 'device');
    expect(readThemeChoice(storage)).toBe('device');
    storage.throws = true;
    expect(readThemeChoice(storage)).toBe('dark');
  });

  it('keeps every choice as its own word, "Match this device" included (#992)', () => {
    const storage = new MemoryStorage();
    expect(writeThemeChoice(storage, 'dark')).toBe(true);
    expect(storage.values.get(THEME_STORAGE_KEY)).toBe('dark');
    expect(writeThemeChoice(storage, 'device')).toBe(true);
    expect(storage.values.get(THEME_STORAGE_KEY)).toBe('device');
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
    expect(THEME_SELECTION_SCRIPT).toContain(JSON.stringify(THEME_OVERRIDE_ATTRIBUTE));
    expect([...THEME_SELECTION_SCRIPT.matchAll(/oyl\.[a-z.0-9]+/gi)].map(([key]) => key)).toEqual([
      THEME_STORAGE_KEY,
    ]);
  });

  it('cannot end the script element it is inlined in, and uses no module syntax', () => {
    expect(THEME_SELECTION_SCRIPT).not.toMatch(/<\/script/i);
    expect(THEME_SELECTION_SCRIPT).not.toMatch(/\b(?:import|export)\b/);
  });
});

describe('an erase forgets the choice and puts the page back on the default (#672, #992)', () => {
  it('removes the key and goes back to dark at once, with no reload', () => {
    const page = freshPage('light', 'light');
    runScript(page);
    expect(state().theme).toBe('light');
    themeEraser(page.window).forget();
    expect(page.storage.values.has(THEME_STORAGE_KEY)).toBe(false);
    expect(state().theme).toBe('dark');
    expect(state().media).toEqual(['not all', 'all']);
  });

  it('lets go of a choice the page held, too', () => {
    const page = freshPage('throws', 'light', 'light');
    runScript(page);
    expect(state().theme).toBe('light');
    themeEraser(page.window).forget();
    expect(document.documentElement.hasAttribute(THEME_OVERRIDE_ATTRIBUTE)).toBe(false);
    expect(state().theme).toBe('dark');
  });

  it('does not throw where the device refuses', () => {
    const page = freshPage('throws', 'dark');
    expect(() => {
      themeEraser(page.window).forget();
    }).not.toThrow();
  });
});

describe('what a map reads and watches — #672 part b', () => {
  afterEach(() => {
    document.documentElement.removeAttribute('data-theme');
  });

  it.each([
    ['dark', 'dark'],
    ['light', 'light'],
    [null, 'light'],
    ['sepia', 'light'],
  ] as const)('reads data-theme %s as the %s palette, as theme.css paints it', (value, theme) => {
    if (value === null) document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', value);
    expect(documentTheme(document)).toBe(theme);
  });

  it('hears every change of palette, whoever writes it, until it is stopped', async () => {
    const page = freshPage('device', 'light');
    runScript(page);
    const heard: string[] = [];
    const stop = watchDocumentTheme(document, (theme) => heard.push(theme));

    // The device, through the inline script's own listener.
    deviceBecomesDark(page, true);
    await Promise.resolve();
    // Settings.
    chooseTheme(page.window, 'light');
    await Promise.resolve();
    // Another tab, through the script's `storage` listener.
    page.storage.values.set(THEME_STORAGE_KEY, 'dark');
    storageEvent(page, THEME_STORAGE_KEY);
    await Promise.resolve();
    // An erase, back to the default — which is dark: no change, nothing heard.
    themeEraser(page.window).forget();
    await Promise.resolve();
    expect(heard).toEqual(['dark', 'light', 'dark']);

    stop();
    chooseTheme(page.window, 'light');
    await Promise.resolve();
    expect(heard).toEqual(['dark', 'light', 'dark']);
  });
});
