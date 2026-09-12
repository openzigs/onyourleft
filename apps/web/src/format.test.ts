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

import { formatDuration, POWER_UNIT } from './format';

describe('what is left here is not a unit a rider chooses', () => {
  it('renders a duration the same way whichever units the rider reads in', () => {
    expect(formatDuration(3725)).toBe('1:02:05');
    expect(formatDuration(125)).toBe('2:05');
  });

  it('names power in watts, which is the same word in both systems', () => {
    expect(POWER_UNIT).toBe('W');
  });
});
