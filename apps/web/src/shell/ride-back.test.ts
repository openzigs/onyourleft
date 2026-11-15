// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * `ride-back.ts` — #2349: where a back press consumed by a ride goes. The
 * shell-level wiring (Android's back reaching the Ride screen and the game's
 * stage) is `android-back.test.tsx`'s; this is the registry alone.
 */

import { describe, expect, it } from 'vitest';

import { rideBack } from './ride-back';

describe('rideBack (#2349)', () => {
  it('takes nothing with nothing registered', () => {
    expect(rideBack().press()).toBe(false);
  });

  it('hands a press to the latest registration, and to the one before once that goes', () => {
    const back = rideBack();
    const heard: string[] = [];
    const first = back.register(() => heard.push('first'));
    const second = back.register(() => heard.push('second'));
    expect(back.press()).toBe(true);
    second();
    expect(back.press()).toBe(true);
    first();
    expect(back.press()).toBe(false);
    expect(heard).toEqual(['second', 'first']);
  });

  it('lets a registration go only once, and never takes another with it', () => {
    const back = rideBack();
    const heard: string[] = [];
    back.register(() => heard.push('kept'));
    const gone = back.register(() => heard.push('gone'));
    gone();
    gone();
    expect(back.press()).toBe(true);
    expect(heard).toEqual(['kept']);
  });
});
