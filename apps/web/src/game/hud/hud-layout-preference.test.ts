// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The HUD's panels and text size, kept on this device — #2079. Through a real
 * `Storage` (jsdom's `localStorage`, the one `deviceStorage()` hands the game),
 * so a choice is asserted as the next ride reads it back.
 *
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_HUD_LAYOUT,
  HUD_ARRANGEMENTS,
  HUD_LAYOUT_STORAGE_KEY,
  HUD_PANELS,
  HUD_POWER_VIEWS,
  HUD_ROUTE_VIEWS,
  compactRoute,
  focusArrangement,
  panelShown,
  powerView,
  readHudLayout,
  totalsStripChosen,
  writeHudLayout,
} from './hud-layout-preference';

afterEach(() => {
  localStorage.removeItem(HUD_LAYOUT_STORAGE_KEY);
});

describe('the HUD layout preference (#2079)', () => {
  it('shows every panel at the normal size until the rider chooses', () => {
    expect(readHudLayout(localStorage)).toEqual(DEFAULT_HUD_LAYOUT);
    for (const panel of HUD_PANELS) expect(panelShown(DEFAULT_HUD_LAYOUT, panel)).toBe(true);
  });

  it('keeps a choice on the device and reads it back', () => {
    expect(writeHudLayout(localStorage, { hidden: ['route', 'graph'], textSize: 'large' })).toBe(
      true,
    );
    const read = readHudLayout(localStorage);
    // #2383, #2385, #2387, #2420: a choice written with no arrangement, no
    // route view, no strip and no power view reads back as the full HUD, the
    // full route panel, no strip and the 3 s power.
    expect(read).toEqual({
      hidden: ['route', 'graph'],
      textSize: 'large',
      arrangement: 'full',
      totalsStrip: false,
      route: 'full',
      power: 'average',
      delivery: 'game',
    });
    expect(panelShown(read, 'route')).toBe(false);
    expect(panelShown(read, 'readings')).toBe(true);
  });

  it('offers no way to hide the notices, the controls or the primary readings', () => {
    expect(HUD_PANELS).toEqual(['readings', 'route', 'graph', 'standings']);
    // A stored name it does not know hides nothing.
    localStorage.setItem(
      HUD_LAYOUT_STORAGE_KEY,
      JSON.stringify({ hidden: ['notices', 'actions', 'primary', 'route', 'route'] }),
    );
    expect(readHudLayout(localStorage).hidden).toEqual(['route']);
  });

  it('reads anything unreadable as the defaults, field by field, and never throws', () => {
    localStorage.setItem(HUD_LAYOUT_STORAGE_KEY, '{not json');
    expect(readHudLayout(localStorage)).toEqual(DEFAULT_HUD_LAYOUT);
    localStorage.setItem(HUD_LAYOUT_STORAGE_KEY, JSON.stringify({ textSize: 'enormous' }));
    expect(readHudLayout(localStorage)).toEqual(DEFAULT_HUD_LAYOUT);
    expect(readHudLayout(undefined)).toEqual(DEFAULT_HUD_LAYOUT);
  });

  it('says when the device refused the write', () => {
    const full: Pick<Storage, 'getItem' | 'setItem'> = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    expect(writeHudLayout(full, DEFAULT_HUD_LAYOUT)).toBe(false);
    expect(writeHudLayout(undefined, DEFAULT_HUD_LAYOUT)).toBe(false);
  });
});

describe('the focus arrangement (#2383)', () => {
  it('is full until the rider chooses, and full is the default', () => {
    expect(HUD_ARRANGEMENTS).toEqual(['full', 'focus']);
    expect(readHudLayout(localStorage).arrangement).toBe('full');
    expect(focusArrangement(DEFAULT_HUD_LAYOUT)).toBe(false);
  });

  it('keeps focus on the device and reads it back, beside the other choices', () => {
    expect(
      writeHudLayout(localStorage, { hidden: ['graph'], textSize: 'large', arrangement: 'focus' }),
    ).toBe(true);
    const read = readHudLayout(localStorage);
    expect(read).toEqual({
      hidden: ['graph'],
      textSize: 'large',
      arrangement: 'focus',
      totalsStrip: false,
      route: 'full',
      power: 'average',
      delivery: 'game',
    });
    expect(focusArrangement(read)).toBe(true);
  });

  it('reads a preference kept before #2383, or an arrangement it does not know, as full', () => {
    localStorage.setItem(
      HUD_LAYOUT_STORAGE_KEY,
      JSON.stringify({ hidden: [], textSize: 'normal' }),
    );
    expect(readHudLayout(localStorage).arrangement).toBe('full');
    localStorage.setItem(HUD_LAYOUT_STORAGE_KEY, JSON.stringify({ arrangement: 'minimal' }));
    expect(focusArrangement(readHudLayout(localStorage))).toBe(false);
  });
});

describe('the totals strip (#2387)', () => {
  it('is off until the rider chooses it', () => {
    expect(totalsStripChosen(DEFAULT_HUD_LAYOUT)).toBe(false);
    expect(totalsStripChosen(readHudLayout(localStorage))).toBe(false);
  });

  it('keeps the strip on the device and reads it back, beside the other choices', () => {
    expect(
      writeHudLayout(localStorage, {
        hidden: [],
        textSize: 'normal',
        arrangement: 'focus',
        totalsStrip: true,
      }),
    ).toBe(true);
    const read = readHudLayout(localStorage);
    expect(totalsStripChosen(read)).toBe(true);
    expect(focusArrangement(read)).toBe(true);
  });

  it('reads a preference kept before #2387, or anything but true, as off', () => {
    localStorage.setItem(HUD_LAYOUT_STORAGE_KEY, JSON.stringify({ hidden: [], textSize: 'large' }));
    expect(totalsStripChosen(readHudLayout(localStorage))).toBe(false);
    localStorage.setItem(HUD_LAYOUT_STORAGE_KEY, JSON.stringify({ totalsStrip: 'yes' }));
    expect(totalsStripChosen(readHudLayout(localStorage))).toBe(false);
  });
});

describe('the compact route panel (#2385)', () => {
  it('is full until the rider chooses, and full is the default', () => {
    expect(HUD_ROUTE_VIEWS).toEqual(['full', 'compact']);
    expect(readHudLayout(localStorage).route).toBe('full');
    expect(compactRoute(DEFAULT_HUD_LAYOUT)).toBe(false);
  });

  it('keeps compact on the device and reads it back, beside the other choices', () => {
    expect(
      writeHudLayout(localStorage, {
        hidden: ['graph'],
        textSize: 'large',
        arrangement: 'focus',
        route: 'compact',
      }),
    ).toBe(true);
    const read = readHudLayout(localStorage);
    expect(read).toEqual({
      hidden: ['graph'],
      textSize: 'large',
      arrangement: 'focus',
      totalsStrip: false,
      route: 'compact',
      power: 'average',
      delivery: 'game',
    });
    expect(compactRoute(read)).toBe(true);
    // Compact says how the route panel is drawn, never whether.
    expect(panelShown(read, 'route')).toBe(true);
  });

  it('keeps the route hidden beside compact: the two are separate choices', () => {
    writeHudLayout(localStorage, { hidden: ['route'], textSize: 'normal', route: 'compact' });
    const read = readHudLayout(localStorage);
    expect(compactRoute(read)).toBe(true);
    expect(panelShown(read, 'route')).toBe(false);
  });

  it('reads a preference kept before #2385, or a view it does not know, as full', () => {
    localStorage.setItem(
      HUD_LAYOUT_STORAGE_KEY,
      JSON.stringify({ hidden: ['route'], textSize: 'normal', arrangement: 'focus' }),
    );
    expect(readHudLayout(localStorage).route).toBe('full');
    // And the owner's hidden route panel is still hidden.
    expect(panelShown(readHudLayout(localStorage), 'route')).toBe(false);
    localStorage.setItem(HUD_LAYOUT_STORAGE_KEY, JSON.stringify({ route: 'tiny' }));
    expect(compactRoute(readHudLayout(localStorage))).toBe(false);
  });
});

describe('power as a 3 s average or instant (#2420)', () => {
  it('is the 3 s average until the rider chooses, and the average is the default', () => {
    expect(HUD_POWER_VIEWS).toEqual(['average', 'instant']);
    expect(DEFAULT_HUD_LAYOUT.power).toBe('average');
    expect(readHudLayout(localStorage).power).toBe('average');
    expect(powerView(DEFAULT_HUD_LAYOUT)).toBe('average');
  });

  it('keeps instant on the device and reads it back, beside the other choices', () => {
    expect(
      writeHudLayout(localStorage, {
        hidden: ['graph'],
        textSize: 'large',
        arrangement: 'focus',
        power: 'instant',
        delivery: 'game',
      }),
    ).toBe(true);
    const read = readHudLayout(localStorage);
    expect(read).toEqual({
      hidden: ['graph'],
      textSize: 'large',
      arrangement: 'focus',
      totalsStrip: false,
      route: 'full',
      power: 'instant',
      delivery: 'game',
    });
    expect(powerView(read)).toBe('instant');
  });

  it('reads a preference kept before #2420, or a view it does not know, as the average', () => {
    localStorage.setItem(
      HUD_LAYOUT_STORAGE_KEY,
      JSON.stringify({ hidden: ['route'], textSize: 'normal', route: 'compact' }),
    );
    expect(readHudLayout(localStorage).power).toBe('average');
    // And every other choice kept before it is kept.
    expect(compactRoute(readHudLayout(localStorage))).toBe(true);
    localStorage.setItem(HUD_LAYOUT_STORAGE_KEY, JSON.stringify({ power: 'smoothed' }));
    expect(powerView(readHudLayout(localStorage))).toBe('average');
    localStorage.setItem(HUD_LAYOUT_STORAGE_KEY, JSON.stringify({ power: 1 }));
    expect(powerView(readHudLayout(localStorage))).toBe('average');
    // A preference built by hand with no power view says the average too.
    expect(powerView({ hidden: [], textSize: 'normal' })).toBe('average');
  });
});
