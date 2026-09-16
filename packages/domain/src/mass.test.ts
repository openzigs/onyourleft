// SPDX-License-Identifier: Apache-2.0

/**
 * The 1959 agreement's pound, and the two ways a mass constant goes wrong.
 *
 * The first is the one `length.test.ts` pins for the foot: a truncated
 * definition. 0.4536 is what a calculator hands you and it is 0.8 parts per
 * million short, which is nothing on one rider and is still a constant that is
 * not the definition it claims to be.
 *
 * The second is the one that actually costs a rider something: the **troy**
 * pound, which is 18 % lighter and is what a search for "pound in kilograms"
 * can return. A weight entered as 154 lb and stored through the troy figure is
 * 57.5 kg rather than 69.9 kg — a 12 kg error on a climb, which is the whole of
 * what #325 is about.
 */

import { describe, expect, it } from 'vitest';

import { KILOGRAMS_PER_POUND } from './mass';

describe('the imperial mass definition', () => {
  it('fixes the pound at exactly 0.45359237 kg', () => {
    expect(KILOGRAMS_PER_POUND).toBe(0.45359237);
  });

  it('is the avoirdupois pound and not the troy pound', () => {
    expect(KILOGRAMS_PER_POUND).not.toBe(0.3732417216);
  });

  it('is the full definition rather than a four-figure rounding', () => {
    // ⚠️ `not.toBe`, and the gap is deliberately asserted as well: a future
    // edit to 0.4536 would pass the first assertion alone if somebody also
    // changed it there, and would not pass this one.
    expect(KILOGRAMS_PER_POUND).not.toBe(0.4536);
    expect(Math.abs(KILOGRAMS_PER_POUND - 0.4536)).toBeGreaterThan(0);
  });

  it('round-trips a rider-scale weight to within a gram', () => {
    // 154 lb is the weight this repository's own test fixtures use for an
    // imperial rider, and 69.85 kg is what it must store as.
    const kilograms = 154 * KILOGRAMS_PER_POUND;
    expect(kilograms).toBeCloseTo(69.853, 3);
    expect(kilograms / KILOGRAMS_PER_POUND).toBeCloseTo(154, 9);
  });
});
