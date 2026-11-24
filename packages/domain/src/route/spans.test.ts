// SPDX-License-Identifier: Apache-2.0

/** A road's heights across a bridge or a tunnel — #2013, ADR 0087 D-4.3. */

import { describe, expect, it } from 'vitest';

import { altitudeMetres, metres, type AltitudeMetres } from '../quantities';
import { heightsAcrossSpans } from './spans';

const ground = (...values: (number | undefined)[]): (AltitudeMetres | undefined)[] =>
  values.map((value) => (value === undefined ? undefined : altitudeMetres(value)));

/** A plateau at 300 m with a valley to 240 m between 40 m and 80 m, sampled every 10 m. */
const VALLEY = ground(300, 300, 300, 300, 300, 270, 240, 270, 300, 300, 300);

describe('heightsAcrossSpans', () => {
  it('carries a bridge level across a valley, where the terrain dips 60 m', () => {
    const deck = heightsAcrossSpans(VALLEY, metres(10), [{ from: metres(40), to: metres(80) }]);
    expect(deck).toStrictEqual(ground(300, 300, 300, 300, 300, 300, 300, 300, 300, 300, 300));
    // Without the span the road is on the valley floor.
    expect(heightsAcrossSpans(VALLEY, metres(10), [])).toStrictEqual(VALLEY);
  });

  it('is a straight line between two ends at different heights', () => {
    const heights = ground(100, 100, 40, 10, 40, 120, 120);
    const deck = heightsAcrossSpans(heights, metres(10), [{ from: metres(10), to: metres(50) }]);
    expect(deck).toStrictEqual(ground(100, 100, 105, 110, 115, 120, 120));
  });

  it('carries a tunnel under a ridge the same way', () => {
    const ridge = ground(50, 50, 90, 140, 90, 50, 50);
    expect(
      heightsAcrossSpans(ridge, metres(10), [{ from: metres(10), to: metres(50) }]),
    ).toStrictEqual(ground(50, 50, 50, 50, 50, 50, 50));
  });

  it('widens a span whose ends fall between samples to the samples that enclose it', () => {
    // The span runs 15 m to 45 m. The ground "at 15 m", read between 10 m and
    // 20 m, would be 100 m: half the valley's. The line runs 10 m to 50 m.
    const heights = ground(100, 200, 0, 0, 200, 300);
    const deck = heightsAcrossSpans(heights, metres(10), [{ from: metres(15), to: metres(45) }]);
    expect(deck).toStrictEqual(ground(100, 200, 225, 250, 275, 300));
  });

  it('leaves the samples at a span’s own ends as the ground has them', () => {
    const deck = heightsAcrossSpans(VALLEY, metres(10), [{ from: metres(50), to: metres(70) }]);
    // 50 m and 70 m are on the valley's sides at 270 m; only 60 m is inside.
    expect(deck).toStrictEqual(ground(300, 300, 300, 300, 300, 270, 270, 270, 300, 300, 300));
  });

  it('joins spans that overlap or touch, in any order', () => {
    const deck = heightsAcrossSpans(VALLEY, metres(10), [
      { from: metres(60), to: metres(80) },
      { from: metres(40), to: metres(60) },
    ]);
    expect(deck).toStrictEqual(ground(300, 300, 300, 300, 300, 300, 300, 300, 300, 300, 300));
  });

  it('clips a span that runs past the road’s end to its last sample', () => {
    const off = heightsAcrossSpans(ground(300, 240, 240, 270), metres(10), [
      { from: metres(0), to: metres(500) },
    ]);
    expect(off[0]).toBe(300);
    expect(off[1]).toBeCloseTo(290, 9);
    expect(off[2]).toBeCloseTo(280, 9);
    expect(off[3]).toBe(270);
  });

  it('leaves a span unknown when the terrain has no height at one of its ends', () => {
    const heights = ground(300, undefined, 250, 240, 300, 300);
    const deck = heightsAcrossSpans(heights, metres(10), [{ from: metres(10), to: metres(40) }]);
    // Not the valley floor's 250 and 240: the road is known not to be there.
    expect(deck).toStrictEqual(ground(300, undefined, undefined, undefined, 300, 300));
  });

  it('ignores a span that is empty, reversed or past the road, and a road too short to have one', () => {
    for (const span of [
      { from: metres(40), to: metres(40) },
      { from: metres(80), to: metres(40) },
      { from: metres(200), to: metres(300) },
    ]) {
      expect(heightsAcrossSpans(VALLEY, metres(10), [span])).toStrictEqual(VALLEY);
    }
    const span = { from: metres(0), to: metres(9) };
    expect(heightsAcrossSpans(ground(5), metres(10), [span])).toStrictEqual(ground(5));
    // No spacing: there is no distance to place a span at.
    expect(
      heightsAcrossSpans(VALLEY, metres(0), [{ from: metres(40), to: metres(80) }]),
    ).toStrictEqual(VALLEY);
  });

  it('does not change the array it was handed', () => {
    const before = [...VALLEY];
    heightsAcrossSpans(VALLEY, metres(10), [{ from: metres(40), to: metres(80) }]);
    expect(VALLEY).toStrictEqual(before);
  });
});
