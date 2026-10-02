// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The #547 start-of-ride timing rule, held in the fast suite — #997.
 * `vitest.config.ts` includes `browser/**` tests, as for `hosted-archive.test.ts`.
 */

import { describe, expect, it } from 'vitest';

import { firstFrameExcess, median, prepareTookTheStall } from './ride-start';

const steady = [9, 8, 10, 9, 11, 9, 8, 10, 9];

describe('median', () => {
  it('takes the middle value of an odd count, whatever the order', () => {
    expect(median([5, 1, 3])).toBe(3);
  });

  it('takes the mean of the two middle values of an even count', () => {
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });

  it('refuses no values', () => {
    expect(() => median([])).toThrow(RangeError);
  });
});

describe('firstFrameExcess', () => {
  it('is the first frame less the median of the rest', () => {
    expect(firstFrameExcess([540, ...steady])).toBe(531);
  });

  it('is not moved by one slow LATER frame', () => {
    expect(firstFrameExcess([9, 120, ...steady.slice(1)])).toBe(0);
  });

  it('is never below nought', () => {
    expect(firstFrameExcess([2, ...steady])).toBe(0);
  });

  it('needs at least two frames', () => {
    expect(() => firstFrameExcess([540])).toThrow(RangeError);
    expect(() => firstFrameExcess([])).toThrow(RangeError);
  });
});

describe('prepareTookTheStall', () => {
  it('holds for a healthy prepare (≈ 9 ms against ≈ 540, measured while #547 was written)', () => {
    expect(prepareTookTheStall([9, ...steady], [540, ...steady])).toBe(true);
  });

  it('holds on the runs #997 was filed from: a 120 ms prepared frame against a 362 ms control', () => {
    // The 120 ms frame was somewhere in ten; the old rule failed it wherever it was.
    expect(prepareTookTheStall([9, 120, ...steady.slice(1)], [362, ...steady])).toBe(true);
    expect(prepareTookTheStall([120, ...steady], [362, ...steady])).toBe(true);
  });

  it('fails a prepare that did not stage the ride’s first frame (≈ 600 ms against ≈ 610)', () => {
    expect(prepareTookTheStall([600, ...steady], [610, ...steady])).toBe(false);
  });

  it('fails a prepare that did not wait for the GPU (≈ 560 ms against ≈ 540)', () => {
    expect(prepareTookTheStall([560, ...steady], [540, ...steady])).toBe(false);
  });

  it('fails when the control paid nothing to take away', () => {
    expect(prepareTookTheStall([9, ...steady], [9, ...steady])).toBe(false);
  });
});
