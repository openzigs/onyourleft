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
  HUD_LAYOUT_STORAGE_KEY,
  HUD_PANELS,
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
    expect(read).toEqual({ hidden: ['route', 'graph'], textSize: 'large' });
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
