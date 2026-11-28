// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The road signs' atlas, drawn — #3279 (`draw-sign-atlas.ts`): the same
 * pixels every time, every cell the layout `road-sign-atlas.ts` names drawn
 * where it says, and nothing anywhere else.
 */

import { describe, expect, it } from 'vitest';

import {
  BACK_CELLS,
  BLANK_CELL,
  DIGIT_CELLS,
  FACE_CELLS,
  METAL_CELL,
  PERCENT_CELL,
  SIGN_ATLAS_CELLS,
  SIGN_ATLAS_PIXELS,
  type PlateShape,
  type SignFace,
} from '../../src/game/road-sign-atlas';

import { drawSignAtlas, signAtlasDigest, type SignAtlas } from './draw-sign-atlas';

const atlas = drawSignAtlas();
const SIGN_CELL_PIXELS = SIGN_ATLAS_PIXELS / SIGN_ATLAS_CELLS;
const SIGN_FACES = Object.keys(FACE_CELLS) as SignFace[];
const PLATE_SHAPES = Object.keys(BACK_CELLS) as PlateShape[];

/** Every texel of a square of cells: its alpha, and its colour. */
function texels(at: SignAtlas, cell: number, span: number) {
  const left = (cell % SIGN_ATLAS_CELLS) * SIGN_CELL_PIXELS;
  const top = Math.floor(cell / SIGN_ATLAS_CELLS) * SIGN_CELL_PIXELS;
  const out: { alpha: number; rgb: [number, number, number] }[] = [];
  for (let y = top; y < top + span * SIGN_CELL_PIXELS; y += 1) {
    for (let x = left; x < left + span * SIGN_CELL_PIXELS; x += 1) {
      const i = (y * SIGN_ATLAS_PIXELS + x) * 4;
      const p = at.pixels;
      out.push({
        alpha: p[i + 3] as number,
        rgb: [p[i] as number, p[i + 1] as number, p[i + 2] as number],
      });
    }
  }
  return out;
}

const covered = (cell: number, span: number): number =>
  texels(atlas, cell, span).filter((texel) => texel.alpha >= 128).length /
  (span * span * SIGN_CELL_PIXELS * SIGN_CELL_PIXELS);

describe('the road signs’ atlas — #3279', () => {
  it('is a 512 px RGBA square, the same pixels every time it is drawn', () => {
    expect(atlas.width).toBe(512);
    expect(atlas.height).toBe(512);
    expect(atlas.pixels.length).toBe(512 * 512 * 4);
    expect(signAtlasDigest(drawSignAtlas())).toBe(signAtlasDigest(atlas));
  });

  it('draws every plate in its two by two, and every plate’s edge clear of its square’s', () => {
    for (const face of SIGN_FACES) {
      const share = covered(FACE_CELLS[face], 2);
      expect(share, face).toBeGreaterThan(0.25);
      expect(share, face).toBeLessThan(0.95);
      // The square's corner texel is clear, so a mipmap does not bleed a neighbour in.
      expect(texels(atlas, FACE_CELLS[face], 2)[0]?.alpha, face).toBe(0);
    }
    for (const shape of PLATE_SHAPES) {
      expect(covered(BACK_CELLS[shape], 2), shape).toBeGreaterThan(0.25);
    }
    // No two faces are the same picture.
    const pictures = SIGN_FACES.map((face) =>
      JSON.stringify(texels(atlas, FACE_CELLS[face], 2).map((texel) => texel.alpha)),
    );
    const colours = SIGN_FACES.map((face) =>
      JSON.stringify(texels(atlas, FACE_CELLS[face], 2).map((texel) => texel.rgb)),
    );
    expect(new Set(colours).size).toBe(SIGN_FACES.length);
    expect(new Set(pictures).size).toBeGreaterThan(3);
  });

  it('draws ten different numerals and a percent sign, a post’s solid grey, and leaves the blank cell empty', () => {
    const numerals = DIGIT_CELLS.map((cell) =>
      JSON.stringify(texels(atlas, cell, 1).map((texel) => texel.alpha)),
    );
    expect(new Set(numerals).size).toBe(10);
    for (const cell of [...DIGIT_CELLS, PERCENT_CELL]) {
      expect(covered(cell, 1)).toBeGreaterThan(0.05);
    }
    expect(covered(METAL_CELL, 1)).toBe(1);
    expect(covered(BLANK_CELL, 1)).toBe(0);
  });

  it('carries a numeral’s ink colour into its transparent texels, so a filtered edge is not darkened', () => {
    const one = texels(atlas, DIGIT_CELLS[1] as number, 1);
    const clear = one.filter((texel) => texel.alpha === 0);
    expect(clear.length).toBeGreaterThan(0);
    const ink = one.find((texel) => texel.alpha === 255)?.rgb;
    for (const texel of clear) expect(texel.rgb).toEqual(ink);
  });
});
