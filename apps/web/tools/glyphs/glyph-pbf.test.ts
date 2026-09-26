// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The glyph range file, against bytes worked out by hand from the schema
 * (#578).
 *
 * A round trip through this module's own writer and reader proves only that
 * the two agree. The byte vector below was written from the three-message
 * schema in `glyph-pbf.ts`'s header, field by field, so a field the writer
 * numbers wrongly fails here even if the reader shares the mistake. MapLibre
 * itself — the reader that matters — is the browser gate's.
 */

import { describe, expect, it } from 'vitest';

import { decodeGlyphRanges, encodeGlyphRange, type GlyphRange } from './glyph-pbf';

const TINY: GlyphRange = {
  name: 'F',
  range: '0-255',
  glyphs: [
    // One-by-one box, so a 7×7 bitmap; left −1 and top −2 exercise zigzag.
    {
      id: 65,
      bitmap: new Uint8Array(49).fill(7),
      width: 1,
      height: 1,
      left: -1,
      top: -2,
      advance: 3,
    },
    // A space: no bitmap field at all.
    { id: 32, bitmap: new Uint8Array(), width: 0, height: 0, left: 0, top: -20, advance: 5 },
  ],
};

describe('encodeGlyphRange', () => {
  it('writes the schema’s fields, numbered and typed as MapLibre reads them', () => {
    const glyphA = [
      0x08,
      65, // id = 65
      0x12,
      49,
      ...new Array<number>(49).fill(7), // bitmap
      0x18,
      1, // width
      0x20,
      1, // height
      0x28,
      1, // left, zigzag(−1) = 1
      0x30,
      3, // top, zigzag(−2) = 3
      0x38,
      3, // advance
    ];
    const space = [0x08, 32, 0x18, 0, 0x20, 0, 0x28, 0, 0x30, 39, 0x38, 5];
    const stack = [
      0x0a,
      1,
      0x46, // name = "F"
      0x12,
      5,
      ...[...'0-255'].map((c) => c.charCodeAt(0)), // range
      0x1a,
      glyphA.length,
      ...glyphA,
      0x1a,
      space.length,
      ...space,
    ];
    expect([...encodeGlyphRange(TINY)]).toEqual([0x0a, stack.length, ...stack]);
  });

  it('writes a length over 127 as a multi-byte varint', () => {
    const big = encodeGlyphRange({
      name: 'F',
      range: '0-255',
      glyphs: [
        { id: 300, bitmap: new Uint8Array(200), width: 0, height: 0, left: 0, top: 0, advance: 0 },
      ],
    });
    const [decoded] = decodeGlyphRanges(big);
    expect(decoded?.glyphs[0]?.id).toBe(300);
    expect(decoded?.glyphs[0]?.bitmap.length).toBe(200);
  });

  it('refuses a name that is not ASCII, rather than writing it wrongly', () => {
    expect(() => encodeGlyphRange({ ...TINY, name: 'Rōboto' })).toThrow(/not ASCII/);
  });

  it('refuses a negative varint', () => {
    expect(() =>
      encodeGlyphRange({ ...TINY, glyphs: [{ ...TINY.glyphs[1]!, advance: -1 }] }),
    ).toThrow(RangeError);
  });
});

describe('decodeGlyphRanges', () => {
  it('reads back what was written', () => {
    expect(decodeGlyphRanges(encodeGlyphRange(TINY))).toEqual([TINY]);
  });

  it('refuses a field that runs past the end of its message', () => {
    const truncated = encodeGlyphRange(TINY).slice(0, 20);
    expect(() => decodeGlyphRanges(truncated)).toThrow(RangeError);
  });
});
