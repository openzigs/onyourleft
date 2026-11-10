// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The HUD's 3 s power — #2420: a time-weighted mean over the ride's clock, a
 * gap left out rather than counted as nought, and no number while the meter is
 * not live. `fields.test.ts` §"#2420" holds the field it feeds;
 * `power-shown-wiring.test.tsx` holds that the ride itself is untouched.
 */

import { describe, expect, it } from 'vitest';

import { POWER_AVERAGE_SECONDS, createPowerAverage } from './power-average';

/** Feed `readings` one a frame, `frame` seconds apart from `from`; return each frame's average. */
function feed(
  readings: readonly (number | undefined)[],
  frame: number,
  from = 0,
  average = createPowerAverage(),
): (number | undefined)[] {
  return readings.map((watts, index) => {
    average.observe(from + index * frame, watts);
    return average.average;
  });
}

describe('the HUD’s 3 s power — #2420', () => {
  it('is three seconds', () => {
    expect(POWER_AVERAGE_SECONDS).toBe(3);
  });

  it('varies much less than the readings under a steady but noisy effort', () => {
    // A steady 250 W ridden as the pedal stroke delivers it: a reading a
    // second, 200 and 300 by turns, drawn at four frames a second.
    const readings = Array.from({ length: 40 }, (_, frame) =>
      Math.floor(frame / 4) % 2 === 0 ? 200 : 300,
    );
    const shown = feed(readings, 0.25);
    // Once three seconds are in the window, every frame's average.
    const settled = shown.slice(12) as number[];
    const spread = (values: readonly number[]) => Math.max(...values) - Math.min(...values);
    expect(spread(readings.slice(12))).toBe(100);
    expect(spread(settled)).toBeLessThanOrEqual(34);
    for (const value of settled) {
      expect(value).toBeGreaterThanOrEqual(232);
      expect(value).toBeLessThanOrEqual(268);
    }
    // The known values. A frame's reading covers the quarter second since the
    // frame before, so 200 W holds 0–0.75 s, 300 W 0.75–1.75 s, and so on: at
    // 3 s the window is 0.75 s of 200, 1 of 300, 1 of 200 and 0.25 of 300.
    expect(shown[12]).toBeCloseTo((200 * 0.75 + 300 + 200 + 300 * 0.25) / 3, 6);
    expect(shown[13]).toBeCloseTo(250, 6);
    expect(shown[16]).toBeCloseTo((300 * 0.75 + 200 + 300 + 200 * 0.25) / 3, 6);
  });

  it('weighs each reading by how long it held, not by how many frames drew it', () => {
    const average = createPowerAverage();
    // 100 W held two seconds, drawn on ten frames; 400 W held one, on one.
    for (let frame = 0; frame <= 10; frame += 1) average.observe(frame * 0.2, 100);
    average.observe(3, 400);
    expect(average.average).toBeCloseTo((100 * 2 + 400 * 1) / 3, 6);
  });

  it('forgets a reading once it is older than the window', () => {
    const shown = feed([100, 100, 100, 300, 300, 300, 300], 1);
    expect(shown[3]).toBeCloseTo((100 + 100 + 300) / 3, 6);
    expect(shown[5]).toBe(300);
    expect(shown[6]).toBe(300);
  });

  it('is the first live reading, with nothing before it to average', () => {
    expect(feed([240], 1)).toEqual([240]);
  });

  it('says nothing while the meter is not live, and counts the gap as no time, never as nought', () => {
    const shown = feed([200, 200, 200, undefined, undefined, 200], 0.5);
    expect(shown.slice(3, 5)).toEqual([undefined, undefined]);
    // 200 W either side of a second with no reading: 200, not less.
    expect(shown[5]).toBe(200);
  });

  it('holds still while the ride’s clock does', () => {
    const average = createPowerAverage();
    average.observe(0, 200);
    average.observe(1, 300);
    const before = average.average;
    average.observe(1, 300);
    average.observe(1, 300);
    expect(average.average).toBe(before);
  });

  it('starts again when the clock goes back, so no watt of another ride is in it', () => {
    const average = createPowerAverage();
    feed([400, 400, 400, 400], 1, 0, average);
    average.observe(0.5, 150);
    expect(average.average).toBe(150);
  });

  it('ignores a frame whose clock is not a number', () => {
    const average = createPowerAverage();
    average.observe(0, 200);
    average.observe(1, 200);
    average.observe(Number.NaN, 900);
    expect(average.average).toBe(200);
  });
});
