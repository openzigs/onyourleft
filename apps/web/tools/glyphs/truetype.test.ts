// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The TrueType reader, against the committed font and against what it must
 * refuse (#578).
 *
 * The figures for Roboto v2.138 were read independently with `fontTools`'
 * `ttx` dump on 2026-09-26 rather than taken from this reader, so the reader is
 * checked against something that is not itself.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { characterMaps, FontError, parseTrueType } from './truetype';

const BYTES = new Uint8Array(
  readFileSync(fileURLToPath(new URL('./Roboto-Regular.ttf', import.meta.url))),
);
const FONT = parseTrueType(BYTES);

function glyphFor(character: string): ReturnType<typeof FONT.outline> {
  return FONT.outline(FONT.glyphIndexOf(character.codePointAt(0) ?? 0));
}

describe('Roboto v2.138 Regular', () => {
  it('has the em, the ascender and the descender its hhea and head tables record', () => {
    expect(FONT.unitsPerEm).toBe(2048);
    expect(FONT.ascender).toBe(1900);
    expect(FONT.descender).toBe(-500);
  });

  it('reads a simple glyph’s box, advance and contours', () => {
    const h = glyphFor('H');
    expect([h.xMin, h.yMin, h.xMax, h.yMax, h.advance]).toEqual([169, 0, 1288, 1456, 1461]);
    // Every point, as `ttx` reads them.
    expect(h.contours.map((contour) => contour.map((p) => [p.x, p.y, p.onCurve ? 1 : 0]))).toEqual([
      [
        [1096, 0, 1],
        [1096, 673, 1],
        [362, 673, 1],
        [362, 0, 1],
        [169, 0, 1],
        [169, 1456, 1],
        [362, 1456, 1],
        [362, 830, 1],
        [1096, 830, 1],
        [1096, 1456, 1],
        [1288, 1456, 1],
        [1288, 0, 1],
      ],
    ]);
  });

  it('reads a glyph whose flags are run-length encoded', () => {
    // `X` is one of the 53 glyphs whose flag stream uses REPEAT: twelve
    // identical flags written as one and a count. Misread the count as the
    // next flag and every coordinate after it shifts.
    const x = glyphFor('X');
    expect(x.contours.map((contour) => contour.map((p) => [p.x, p.y]))).toEqual([
      [
        [294, 1456],
        [644, 898],
        [994, 1456],
        [1219, 1456],
        [759, 735],
        [1230, 0],
        [1003, 0],
        [644, 569],
        [285, 0],
        [58, 0],
        [529, 735],
        [69, 1456],
      ],
    ]);
  });

  it('reads a curved glyph’s points and which of them are off the curve', () => {
    // `a` has 42 points in two contours, ending at 31 and 41, and mixes
    // on- and off-curve points — which is what exercises the flag repeats and
    // the short, same and long coordinate forms together.
    const a = glyphFor('a');
    expect(a.contours.map((contour) => contour.length)).toEqual([32, 10]);
    expect((a.contours[0] ?? []).slice(0, 8).map((p) => [p.x, p.y, p.onCurve ? 1 : 0])).toEqual([
      [809, 0, 1],
      [791, 39, 0],
      [783, 114, 1],
      [731, 59, 0],
      [575, -20, 0],
      [475, -20, 1],
      [309, -20, 0],
      [109, 166, 0],
    ]);
    expect((a.contours[1] ?? []).map((p) => [p.x, p.y, p.onCurve ? 1 : 0])).toEqual([
      [502, 142, 1],
      [602, 142, 0],
      [749, 242, 0],
      [779, 303, 1],
      [779, 526, 1],
      [626, 526, 1],
      [295, 526, 0],
      [295, 326, 1],
      [295, 249, 0],
      [399, 142, 0],
    ]);
  });

  it('assembles a composite from its components, offset into place', () => {
    // é is `e` at (0, 0) and `acute` at (340, 0). Its contours are the e's
    // two plus the accent's, and together they reach the box the composite's
    // own header records — a component dropped, or placed without its offset,
    // misses one edge of it.
    const e = glyphFor('e');
    const acute = glyphFor('é');
    expect([acute.xMin, acute.yMin, acute.xMax, acute.yMax]).toEqual([93, -20, 1011, 1536]);
    expect(acute.contours.length).toBe(e.contours.length + 1);
    const points = acute.contours.flat();
    expect(Math.max(...points.map((point) => point.y))).toBe(1536);
    expect(Math.min(...points.map((point) => point.x))).toBe(93);
    // The accent's own points are shifted right by the component offset.
    const accent = glyphFor('\u00b4');
    const shifted = Math.max(...(acute.contours.at(-1) ?? []).map((point) => point.x));
    expect(shifted).toBe(Math.max(...(accent.contours.at(-1) ?? []).map((point) => point.x)) + 340);
  });

  it('maps no code point to .notdef, and reads the supplementary cmap', () => {
    expect(FONT.codePoints.length).toBe(2772);
    expect(FONT.codePoints.every((code) => FONT.glyphIndexOf(code) !== 0)).toBe(true);
    expect(FONT.glyphIndexOf(0x4e00)).toBe(0);
    // Sorted ascending, which is what the range files are written in.
    expect([...FONT.codePoints].sort((a, b) => a - b)).toEqual(FONT.codePoints);
  });

  it('reads the same Basic Multilingual Plane from its format 4 table as from its format 12', () => {
    // Roboto carries both, and the reader prefers 12 — so without this the
    // format 4 reader is code no font here ever runs.
    const { format4, format12 } = characterMaps(BYTES);
    expect(format4?.size).toBeGreaterThan(2000);
    for (const [code, glyph] of format4 ?? new Map<number, number>()) {
      expect(format12?.get(code), `U+${code.toString(16)}`).toBe(glyph);
    }
    const bmp = [...(format12 ?? new Map<number, number>()).keys()].filter(
      (code) => code <= 0xffff,
    );
    expect(bmp.length).toBe(format4?.size);
  });

  it('reads the ʻokina and a macron, which a Hawaiian name needs', () => {
    expect(FONT.glyphIndexOf(0x02bb)).not.toBe(0);
    expect(FONT.glyphIndexOf(0x0101)).not.toBe(0);
  });
});

describe('what it refuses', () => {
  it('refuses a CFF font by name rather than reading it as empty', () => {
    const cff = new Uint8Array(12);
    cff.set([0x4f, 0x54, 0x54, 0x4f]);
    expect(() => parseTrueType(cff)).toThrow(FontError);
    expect(() => parseTrueType(cff)).toThrow(/CFF/);
  });

  it('refuses a file too short to hold a directory', () => {
    expect(() => parseTrueType(new Uint8Array(4))).toThrow(FontError);
  });

  it('refuses a directory whose table runs off the end of the file', () => {
    const bytes = new Uint8Array(28);
    const view = new DataView(bytes.buffer);
    view.setUint32(0, 0x00010000);
    view.setUint16(4, 1);
    bytes.set([0x68, 0x65, 0x61, 0x64], 12); // 'head'
    view.setUint32(20, 16);
    view.setUint32(24, 1000);
    expect(() => parseTrueType(bytes)).toThrow(/runs past the end/);
  });

  it('refuses a font with a table missing', () => {
    const bytes = new Uint8Array(12);
    new DataView(bytes.buffer).setUint32(0, 0x00010000);
    expect(() => parseTrueType(bytes)).toThrow(/no head table/);
  });
});
