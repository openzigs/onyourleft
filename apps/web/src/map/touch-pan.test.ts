// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The guard on `maplibre-gl`'s private touch-pan check — #2985. What a real
 * finger does on the real engine is the browser gate's
 * (`browser/controls-first.browser.spec.ts` §"#2889"); this holds the guard.
 */

import { describe, expect, it } from 'vitest';

import { preventOneFingerPan, type TouchPanPrivate } from './touch-pan';

describe('preventOneFingerPan — #2985', () => {
  it('leaves one finger to the page and pans under two, when the member is a function', () => {
    const touchPan: TouchPanPrivate = { _shouldBePrevented: (): boolean => false };
    expect(preventOneFingerPan(touchPan)).toBe(true);
    const check = touchPan._shouldBePrevented as (touches: number) => boolean;
    expect(check(1), 'one finger').toBe(true);
    expect(check(2), 'two fingers').toBe(false);
    expect(check(3), 'three fingers').toBe(false);
  });

  it('touches nothing when a bump has renamed the member or the handler', () => {
    const renamed: TouchPanPrivate = { _shouldBePrevented: undefined };
    expect(preventOneFingerPan(renamed)).toBe(false);
    expect(renamed._shouldBePrevented).toBeUndefined();
    const notAFunction: TouchPanPrivate = { _shouldBePrevented: true };
    expect(preventOneFingerPan(notAFunction)).toBe(false);
    expect(notAFunction._shouldBePrevented).toBe(true);
    expect(preventOneFingerPan(undefined)).toBe(false);
  });
});
