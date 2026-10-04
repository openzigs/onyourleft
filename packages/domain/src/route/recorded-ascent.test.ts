// SPDX-License-Identifier: Apache-2.0

/** A recorded ride's ascent — #947's climbing badges. */

import { describe, expect, it } from 'vitest';

import { ASCENT_THRESHOLD_METRES, recordedAscent } from './profile';

describe('recordedAscent', () => {
  it('sums each climb at its full height, and skips a gap rather than reading it as nought', () => {
    // Up 50, down 20, up 30: 80 m of climbing. The gap is not sea level.
    expect(recordedAscent([100, 125, undefined, 150, 140, 130, 145, 160])).toBe(80);
  });

  it('counts no wobble under the threshold as a climb', () => {
    const wobble = ASCENT_THRESHOLD_METRES / 2;
    expect(recordedAscent([100, 100 + wobble, 100, 100 + wobble, 100])).toBe(0);
  });

  it('is absent — never zero — where nothing was measured', () => {
    expect(recordedAscent([])).toBeUndefined();
    expect(recordedAscent([undefined, undefined])).toBeUndefined();
    expect(recordedAscent([120])).toBeUndefined();
  });
});
