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
  focusArrangement,
  panelShown,
  readHudLayout,
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
    // #2383: a choice written with no arrangement reads back as the full HUD.
    expect(read).toEqual({ hidden: ['route', 'graph'], textSize: 'large', arrangement: 'full' });
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
    expect(read).toEqual({ hidden: ['graph'], textSize: 'large', arrangement: 'focus' });
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
