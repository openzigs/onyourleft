// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The road sign kit's plates and its one atlas's layout — #3279. Split from
 * `road-signs.ts` so that `tools/realistic/draw-sign-atlas.ts`, which draws
 * the atlas to this layout under plain Node, imports these numbers and
 * nothing of the world's.
 *
 * An eight by eight grid of 64 px cells in a 512 px square, rows from the
 * top: each face's plate two by two ({@link FACE_CELLS}), each plate shape's
 * back two by two ({@link BACK_CELLS}), and the numerals, the percent sign,
 * the post's grey and a blank cell one each. `three-renderer.ts`
 * §`RoadSignBelt` reads each instance's cells ({@link signCells}).
 *
 * Pure, imports nothing.
 */

/** The four plates of the kit. */
export type PlateShape = 'triangle' | 'diamond' | 'rectangle' | 'round';

/** Every face the atlas holds: each kind's, a chevron each way, and the kit's two blank plates. */
export type SignFace =
  'climb' | 'descent' | 'chevron-left' | 'chevron-right' | 'summit' | 'diamond' | 'round';

/** Each face's plate. */
export const FACE_SHAPES: Readonly<Record<SignFace, PlateShape>> = {
  climb: 'triangle',
  descent: 'triangle',
  'chevron-left': 'rectangle',
  'chevron-right': 'rectangle',
  summit: 'rectangle',
  diamond: 'diamond',
  round: 'round',
};

/* ============================================================================
 * The atlas — `tools/realistic/draw-sign-atlas.ts` draws it to this layout
 * ========================================================================== */

/**
 * The atlas's side, in texels: **512**, the issue's most.
 *
 * @unwired the product reads the atlas by its cells, whatever its size:
 * `tools/realistic/draw-sign-atlas.ts` draws it at this size, and
 * `provenance.test.ts` holds the committed KTX2 to it
 */
export const SIGN_ATLAS_PIXELS = 512;

/** Cells along each side of the atlas: **8**, of 64 texels. A plate is two by two. */
export const SIGN_ATLAS_CELLS = 8;

/** A cell as its index: `row × 8 + column`, rows from the top. */
const cellAt = (column: number, row: number): number => row * SIGN_ATLAS_CELLS + column;

/** Where each face's plate is: the top-left cell of its two by two. */
export const FACE_CELLS: Readonly<Record<SignFace, number>> = {
  climb: cellAt(0, 0),
  descent: cellAt(2, 0),
  'chevron-left': cellAt(4, 0),
  'chevron-right': cellAt(6, 0),
  summit: cellAt(0, 2),
  diamond: cellAt(2, 2),
  round: cellAt(4, 2),
};

/** Where each plate's back is — its outline in galvanised grey, two by two. */
export const BACK_CELLS: Readonly<Record<PlateShape, number>> = {
  triangle: cellAt(0, 4),
  rectangle: cellAt(2, 4),
  diamond: cellAt(4, 4),
  round: cellAt(6, 4),
};

/** Where each numeral is, one cell each: 0 to 7 along row 6, 8 and 9 to start row 7. */
export const DIGIT_CELLS: readonly number[] = Array.from({ length: 10 }, (_, digit) =>
  digit < 8 ? cellAt(digit, 6) : cellAt(digit - 8, 7),
);

/** The percent sign's cell. */
export const PERCENT_CELL = cellAt(2, 7);

/** A cell of plain galvanised grey: the post. */
export const METAL_CELL = cellAt(3, 7);

/** A cell with nothing in it, which the plate's alpha test draws nothing of. */
export const BLANK_CELL = cellAt(4, 7);

/**
 * The cells one sign wears: its face, its plate's back, and the three
 * numerals' places left to right, blank where there is no number. A one-digit
 * percent is its digit and the percent sign, moved right by half a numeral so
 * that it is centred under the pictogram as a two-digit one is.
 */
export interface SignCells {
  readonly face: number;
  readonly back: number;
  readonly glyphs: readonly [number, number, number];
  /** How far right the numerals are moved, in numerals' widths: 0 or a half. */
  readonly shift: number;
}

/** The most a percent may read: **99**, two numerals. Past it a sign shows none. */
export const SIGN_PERCENT_MAX = 99;

/** The cells `sign` wears. @see SignCells */
export function signCells(sign: {
  readonly face: SignFace;
  readonly percent?: number | undefined;
}): SignCells {
  const face = FACE_CELLS[sign.face];
  const back = BACK_CELLS[FACE_SHAPES[sign.face]];
  const percent = sign.percent;
  if (percent === undefined || percent < 0 || percent > SIGN_PERCENT_MAX) {
    return { face, back, glyphs: [BLANK_CELL, BLANK_CELL, BLANK_CELL], shift: 0 };
  }
  const whole = Math.round(percent);
  if (whole < 10) {
    return {
      face,
      back,
      glyphs: [DIGIT_CELLS[whole] as number, PERCENT_CELL, BLANK_CELL],
      shift: 0.5,
    };
  }
  return {
    face,
    back,
    glyphs: [
      DIGIT_CELLS[Math.floor(whole / 10)] as number,
      DIGIT_CELLS[whole % 10] as number,
      PERCENT_CELL,
    ],
    shift: 0,
  };
}

/* ============================================================================
 * Where a sign's numerals stand on its plate
 * ========================================================================== */

/** How far down its plate the numerals' row is centred, as a share of the plate: 88 of 128 texels. */
export const SIGN_NUMERAL_ROW = 88 / 128;

/** The side of one numeral's square, metres: **0.27**, its ink about 0.2 m high on a 1.2 m plate. */
export const SIGN_NUMERAL_METRES = 0.27;

/** How far apart two numerals' middles stand, metres: **0.16**. */
export const SIGN_NUMERAL_ADVANCE_METRES = 0.16;
