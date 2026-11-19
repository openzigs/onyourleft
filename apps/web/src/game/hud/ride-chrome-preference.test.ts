// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #2600: the controls' auto-hide and the collapsed panels, kept on this device.
 * Through a real `Storage` (jsdom's `localStorage`, the one `deviceStorage()`
 * hands the HUD), so a choice is asserted as the next ride reads it back.
 *
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_RIDE_CHROME,
  RIDE_CHROME_STORAGE_KEY,
  readRideChrome,
  toggleCollapsed,
  writeRideChrome,
} from './ride-chrome-preference';

afterEach(() => {
  localStorage.removeItem(RIDE_CHROME_STORAGE_KEY);
});

describe('the ride chrome preference — #2600', () => {
  it('hides the controls and collapses nothing until the rider chooses', () => {
    expect(readRideChrome(localStorage)).toEqual({ autoHide: true, collapsed: [] });
    expect(readRideChrome(undefined)).toEqual(DEFAULT_RIDE_CHROME);
  });

  it('keeps a choice on the device and reads it back', () => {
    expect(
      writeRideChrome(localStorage, { autoHide: false, collapsed: ['route', 'trainer'] }),
    ).toBe(true);
    expect(readRideChrome(localStorage)).toEqual({
      autoHide: false,
      collapsed: ['route', 'trainer'],
    });
  });

  it('collapses a panel, and opens it again, one press each', () => {
    const once = toggleCollapsed(DEFAULT_RIDE_CHROME, 'standings');
    expect(once.collapsed).toEqual(['standings']);
    const twice = toggleCollapsed(toggleCollapsed(once, 'primary'), 'standings');
    expect(twice).toEqual({ autoHide: true, collapsed: ['primary'] });
  });

  it('reads what it does not know as the defaults, field by field', () => {
    localStorage.setItem(
      RIDE_CHROME_STORAGE_KEY,
      JSON.stringify({ autoHide: 'no', collapsed: ['route', 'notices', 'actions', 'route', 3] }),
    );
    // Only a stored `false` turns the auto-hide off, and no name here can
    // collapse the notices or the controls.
    expect(readRideChrome(localStorage)).toEqual({ autoHide: true, collapsed: ['route'] });
    localStorage.setItem(RIDE_CHROME_STORAGE_KEY, '{not json');
    expect(readRideChrome(localStorage)).toEqual(DEFAULT_RIDE_CHROME);
    localStorage.setItem(RIDE_CHROME_STORAGE_KEY, '7');
    expect(readRideChrome(localStorage)).toEqual(DEFAULT_RIDE_CHROME);
  });

  it('says so when the device refuses the write, and never throws', () => {
    const full = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    expect(writeRideChrome(full, DEFAULT_RIDE_CHROME)).toBe(false);
    expect(writeRideChrome(undefined, DEFAULT_RIDE_CHROME)).toBe(false);
    const unreadable = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => undefined,
    };
    expect(readRideChrome(unreadable)).toEqual(DEFAULT_RIDE_CHROME);
  });
});
