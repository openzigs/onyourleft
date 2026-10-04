// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * ⚠️ **The speed cases that used to be here are in `units/format.test.ts`
 * now.** #238 moved `formatSpeedValue` and the compile-time guarantee under it
 * out of this module, because a speed's unit is a preference and nothing in
 * this file is. A reviewer looking for them here is reading the old file.
 *
 * What remains has no test of its own yet beyond the views that render it —
 * `formatDuration` is asserted in `library/rows.test.ts` and `RideView.test.tsx`,
 * `formatStartedAt` in `library/rows.test.ts`. This file is kept as the record
 * of where the guarantee went rather than deleted, so the move is visible in
 * the one place somebody would look for it.
 */

import { describe, expect, it } from 'vitest';

import { watts } from '@onyourleft/domain';

import { formatDuration, POWER_UNIT, shownAveragePower } from './format';

describe('what is left here is not a unit a rider chooses', () => {
  it('renders a duration the same way whichever units the rider reads in', () => {
    expect(formatDuration(3725)).toBe('1:02:05');
    expect(formatDuration(125)).toBe('2:05');
  });

  it('writes the hour when there is none only when asked to, for the ride HUD — #1111', () => {
    expect(formatDuration(0, 'always')).toBe('0:00:00');
    expect(formatDuration(125, 'always')).toBe('0:02:05');
    expect(formatDuration(3725, 'always')).toBe('1:02:05');
    // The same seconds, the same floor: a fraction is not a second yet.
    expect(formatDuration(59.9, 'always')).toBe('0:00:59');
    // And everything that does not ask is unchanged.
    expect(formatDuration(125, 'when-some')).toBe('2:05');
  });

  it('names power in watts, which is the same word in both systems', () => {
    expect(POWER_UNIT).toBe('W');
  });
});

describe('which stored average power is shown at all — #1054', () => {
  it('shows none for a ride with no power, or one whose average shows as 0 W', () => {
    expect(shownAveragePower(undefined)).toBeUndefined();
    expect(shownAveragePower(watts(0))).toBeUndefined();
    expect(shownAveragePower(watts(0.49))).toBeUndefined();
  });

  it('shows every average that reads as a watt or more, unchanged', () => {
    expect(shownAveragePower(watts(0.5))).toBe(0.5);
    expect(shownAveragePower(watts(1))).toBe(1);
    expect(shownAveragePower(watts(212))).toBe(212);
  });
});
