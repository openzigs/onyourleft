// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The signed-distance glyph, against outlines whose answer is known by hand
 * (#578).
 *
 * The committed ranges are held to the generator by `generate-glyphs.test.ts`,
 * which says nothing about whether the generator is *right* — a field encoded
 * inside-out would be regenerated faithfully for ever. These are the cases
 * that pin it: a square whose distances are arithmetic, a square with a hole
 * wound the other way, a contour made only of off-curve points, and a glyph
 * with no ink at all.
 */

import { describe, expect, it } from 'vitest';

import {
  flatten,
  GLYPH_BORDER,
  GLYPH_SIZE,
  SDF_CUTOFF,
  SDF_RADIUS,
  signedDistanceGlyph,
} from './sdf';
import type { GlyphOutline, OutlinePoint } from './truetype';

/** 24 units per em, so one unit is one pixel and every distance is arithmetic. */
const UNITS_PER_EM = GLYPH_SIZE;

function on(x: number, y: number): OutlinePoint {
  return { x, y, onCurve: true };
}

function square(x0: number, y0: number, x1: number, y1: number): OutlinePoint[] {
  // Clockwise in y-up coordinates, which is TrueType's outer-contour direction.
  return [on(x0, y0), on(x0, y1), on(x1, y1), on(x1, y0)];
}

function outline(contours: OutlinePoint[][], box: [number, number, number, number]): GlyphOutline {
  return { contours, xMin: box[0], yMin: box[1], xMax: box[2], yMax: box[3], advance: 13.7 };
}

/** What the field encodes a signed distance as. */
function encoded(distance: number): number {
  return Math.max(0, Math.min(255, Math.round(255 - 255 * (distance / SDF_RADIUS + SDF_CUTOFF))));
}

describe('a 12-pixel square on the baseline', () => {
  const glyph = signedDistanceGlyph(
    65,
    outline([square(2, 0, 14, 12)], [2, 0, 14, 12]),
    UNITS_PER_EM,
    20,
  );
  const columns = glyph.width + 2 * GLYPH_BORDER;
  const at = (column: number, row: number): number => glyph.bitmap[row * columns + column] ?? -1;

  it('has the box, the offset and the advance MapLibre reads', () => {
    expect(glyph.id).toBe(65);
    expect([glyph.width, glyph.height, glyph.left]).toEqual([12, 12, 2]);
    // The box's top, 12, less the ascender floored to a pixel.
    expect(glyph.top).toBe(12 - 20);
    // Floored, as published glyph servers do: 13.7 advances 13.
    expect(glyph.advance).toBe(13);
    expect(glyph.bitmap.length).toBe((12 + 6) * (12 + 6));
  });

  it('is solid in the middle and empty in the far corner', () => {
    expect(at(9, 9)).toBe(255);
    // The corner pixel's centre is 2.5 px out on both axes.
    expect(at(0, 0)).toBe(encoded(Math.hypot(2.5, 2.5)));
  });

  it('encodes a distance the way MapLibre’s shader reads it, in literal numbers', () => {
    // Worked by hand rather than through `encoded`, so a changed radius or
    // cutoff cannot move the expectation along with the implementation:
    // 255 − 255·(−0.5/8 + 0.25) = 207.19, and 255 − 255·(0.5/8 + 0.25) = 175.31.
    expect(at(3, 9)).toBe(207);
    expect(at(2, 9)).toBe(175);
    // The corner, 2.5·√2 px out: 255 − 255·(0.4419 + 0.25) = 78.57.
    expect(at(0, 0)).toBe(79);
  });

  it('puts the edge between the last pixel inside and the first outside', () => {
    // Row 9 runs through the middle; column 3 is the first pixel inside the
    // square (its centre 0.5 px in) and column 2 the last outside.
    expect(at(3, 9)).toBe(encoded(-0.5));
    expect(at(2, 9)).toBe(encoded(0.5));
    expect(at(3, 9)).toBeGreaterThan(192);
    expect(at(2, 9)).toBeLessThan(192);
  });

  it('falls away with distance, on every side', () => {
    for (let column = 0; column < 3; column += 1) {
      expect(at(column, 9)).toBeLessThan(at(column + 1, 9));
    }
    // Top and bottom borders mirror each other, which is rows running down.
    expect(at(9, 0)).toBe(at(9, columns - 1));
  });
});

describe('rows run down from the top', () => {
  it('draws ink near the top of the box as the first rows, not the last', () => {
    // A bar across the top of a box that reaches down to the baseline: the
    // ink is in the box's top third, so it has to be in the bitmap's top rows.
    const glyph = signedDistanceGlyph(
      45,
      outline([square(2, 8, 14, 12)], [2, 0, 14, 12]),
      UNITS_PER_EM,
      20,
    );
    const columns = glyph.width + 2 * GLYPH_BORDER;
    // y = 10.5 is row 12 + 3 − 10.5 − 0.5 = 4, 1.5 px inside the bar's top
    // edge: 255 − 255·(−1.5/8 + 0.25) = 239.06. y = 1.5 is row 13.
    expect(glyph.bitmap[4 * columns + 9]).toBe(239);
    expect(glyph.bitmap[13 * columns + 9]).toBeLessThan(192);
  });
});

describe('a counter wound the other way', () => {
  it('is outside the ink, which is what makes an O hollow', () => {
    const hole = square(6, 4, 10, 8).reverse();
    const glyph = signedDistanceGlyph(
      79,
      outline([square(2, 0, 14, 12), hole], [2, 0, 14, 12]),
      UNITS_PER_EM,
      20,
    );
    const columns = glyph.width + 2 * GLYPH_BORDER;
    // The hole's centre, (8, 6) in font space, is column 9 and row 9.
    expect(glyph.bitmap[9 * columns + 9]).toBe(encoded(1.5));
    expect(glyph.bitmap[9 * columns + 9]).toBeLessThan(192);
  });
});

describe('flatten', () => {
  it('closes a contour made only of off-curve points, from the point implied between two', () => {
    const diamond = [
      { x: 0, y: 10, onCurve: false },
      { x: 10, y: 0, onCurve: false },
      { x: 0, y: -10, onCurve: false },
      { x: -10, y: 0, onCurve: false },
    ];
    const segments = flatten(diamond, 1);
    expect(segments[0]?.ax).toBe(5);
    expect(segments[0]?.ay).toBe(5);
    const last = segments[segments.length - 1];
    expect([last?.bx, last?.by]).toEqual([5, 5]);
    // Four curves of eight chords each: nothing dropped, nothing doubled.
    expect(segments.length).toBe(32);
  });

  it('starts at the first on-curve point when the contour opens off the curve', () => {
    const segments = flatten([{ x: 5, y: 10, onCurve: false }, on(10, 0), on(0, 0)], 2);
    expect([segments[0]?.ax, segments[0]?.ay]).toEqual([20, 0]);
    const last = segments[segments.length - 1];
    expect([last?.bx, last?.by]).toEqual([20, 0]);
  });
});

describe('a glyph with no ink', () => {
  it('has an advance and nothing else', () => {
    const space = signedDistanceGlyph(32, outline([], [0, 0, 0, 0]), UNITS_PER_EM, 20);
    expect(space).toEqual({
      id: 32,
      bitmap: new Uint8Array(),
      width: 0,
      height: 0,
      left: 0,
      top: -20,
      advance: 13,
    });
  });
});
