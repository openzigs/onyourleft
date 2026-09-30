// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The gantries' banner lettering, rasterised from the app's own glyphs — #679.
 *
 * ## From the glyphs the app already ships, and nothing else
 *
 * The map's labels are set in Roboto v2.138 (Apache-2.0), rasterised by
 * `tools/glyphs/` into signed-distance glyph ranges committed under
 * `public/glyphs/` and precached with the app (#578). A banner is lettered
 * from the SAME range file, `0-255.pbf`, at load: no new font, no new licence,
 * no new binary and no ASSETS.toml row — the range file's own row
 * (`creator`, `url`, `modified`, `input`, `inputsha256`, `script`, `tool`)
 * already records the provenance of every pixel here, and
 * `tools/glyphs/generate-glyphs.test.ts` already regenerates it byte for byte
 * from the committed TrueType. What this file adds is arithmetic: lay the
 * glyphs of {@link BannerCell}'s lines out on their advances and threshold
 * their distance fields at a larger size, which is what a distance field is
 * for.
 *
 * ## One list
 *
 * The atlas is built from `gantry-wording.ts` §`bannerTexts` and records every
 * string it rasterised ({@link BannerAtlas.rasterised});
 * `banner-atlas.test.ts` holds that set EQUAL to the wording module's.
 *
 * Pure: bytes in, bytes out; names no rendering library.
 */

/** One glyph, as the range file carries it. @see `tools/glyphs/glyph-pbf.ts` */
export interface BannerGlyph {
  readonly id: number;
  /** `(width + 2·border) × (height + 2·border)` bytes, row by row from the top. */
  readonly bitmap: Uint8Array;
  readonly width: number;
  readonly height: number;
  readonly left: number;
  readonly top: number;
  readonly advance: number;
}

/** Pixels of distance field around a glyph's box: MapLibre's, and `tools/glyphs/`'. */
export const GLYPH_FIELD_BORDER = 3;

/**
 * Where a distance field's edge is, 0–255: `255 · (1 − 0.25)` — the cutoff
 * `tools/glyphs/sdf.ts` writes with (`SDF_CUTOFF`), over its reach of 8 px.
 */
export const GLYPH_EDGE = 191.25;

/** How much the field changes over one of its own pixels: `255 / 8`. */
const FIELD_PER_PIXEL = 255 / 8;

/** The atlas: {@link BANNER_CELLS} cells of {@link BANNER_CELL_WIDTH} × {@link BANNER_CELL_HEIGHT}, one byte of coverage a texel. */
export const BANNER_CELL_WIDTH = 512;
export const BANNER_CELL_HEIGHT = 128;
export const BANNER_CELLS = 8;

/** A cell's lettering: a main line and, under it, a smaller one or none. */
export interface BannerCell {
  readonly main: string;
  readonly subline?: string;
}

/** A built atlas. */
export interface BannerAtlas {
  readonly width: number;
  readonly height: number;
  /**
   * One byte of lettering coverage a texel, row 0 the BOTTOM — the order a
   * texture coordinate's `v` runs in, so the atlas is uploaded as it is.
   */
  readonly coverage: Uint8Array;
  /** Which cell holds which main line. */
  readonly cells: ReadonlyMap<string, number>;
  /** Every string drawn into the atlas, main lines and sublines, once each. */
  readonly rasterised: readonly string[];
}

/**
 * The glyphs of a range file, by code point. A protocol-buffer reader for the
 * three messages `tools/glyphs/glyph-pbf.ts` writes, written from the same
 * schema: `glyphs { repeated fontstack = 1 }`, `fontstack { name = 1; range =
 * 2; repeated glyph = 3 }`, `glyph { id = 1; bitmap = 2; width = 3; height =
 * 4; left = 5 (sint); top = 6 (sint); advance = 7 }`.
 *
 * ⚠️ **Bounded by the buffer, not by what the file says** (#879's review):
 * every read stops at the bytes there are, every declared length is refused
 * when it runs past the message holding it, and a number longer than ten
 * bytes is refused — so a truncated or corrupted range throws at once, where
 * it used to walk off the end of the buffer until it reached a length the
 * file had made up (2³⁵ bytes did not return in a minute).
 */
export function readGlyphRange(bytes: Uint8Array): ReadonlyMap<number, BannerGlyph> {
  const glyphs = new Map<number, BannerGlyph>();
  const end = bytes.length;
  let at = 0;
  const varint = (limit: number): number => {
    let value = 0;
    let scale = 1;
    for (let read = 0; read < 10; read += 1) {
      if (at >= Math.min(limit, end)) throw new Error('a glyph range ends inside a number');
      const byte = bytes[at] as number;
      at += 1;
      value += (byte & 0x7f) * scale;
      if (byte < 0x80) return value;
      scale *= 0x80;
    }
    throw new Error('a glyph range holds a number longer than ten bytes');
  };
  /** Refuses a length that runs past the message holding it. */
  const within = (length: number, limit: number): number => {
    if (length > Math.min(limit, end) - at) {
      throw new Error('a glyph range declares a length past the end of what holds it');
    }
    return length;
  };
  const skip = (wire: number, limit: number): void => {
    if (wire === 0) varint(limit);
    else if (wire === 2) {
      // Read the length FIRST: `at += varint(…)` would add it to the offset
      // from before the length was read.
      const length = within(varint(limit), limit);
      at += length;
    } else if (wire === 1) at += within(8, limit);
    else if (wire === 5) at += within(4, limit);
    else throw new Error(`a glyph range holds a field of wire type ${String(wire)}`);
  };
  while (at < end) {
    const header = varint(end);
    if (header !== 1 * 8 + 2) {
      skip(header % 8, end);
      continue;
    }
    const stackLength = within(varint(end), end);
    const stackEnd = at + stackLength;
    while (at < stackEnd) {
      const inner = varint(stackEnd);
      if (inner !== 3 * 8 + 2) {
        skip(inner % 8, stackEnd);
        continue;
      }
      const glyphLength = within(varint(stackEnd), stackEnd);
      const glyphEnd = at + glyphLength;
      const glyph = {
        id: 0,
        bitmap: new Uint8Array(),
        width: 0,
        height: 0,
        left: 0,
        top: 0,
        advance: 0,
      };
      while (at < glyphEnd) {
        const key = varint(glyphEnd);
        const field = Math.floor(key / 8);
        if (key % 8 === 2) {
          const length = within(varint(glyphEnd), glyphEnd);
          if (field === 2) glyph.bitmap = bytes.slice(at, at + length);
          at += length;
        } else if (key % 8 === 0) {
          const value = varint(glyphEnd);
          const signed = value % 2 === 0 ? value / 2 : -(value + 1) / 2;
          if (field === 1) glyph.id = value;
          else if (field === 3) glyph.width = value;
          else if (field === 4) glyph.height = value;
          else if (field === 5) glyph.left = signed;
          else if (field === 6) glyph.top = signed;
          else if (field === 7) glyph.advance = value;
        } else {
          skip(key % 8, glyphEnd);
        }
      }
      glyphs.set(glyph.id, glyph);
    }
  }
  return glyphs;
}

/** A line of lettering at a size: atlas pixels per glyph-field pixel. */
interface SetLine {
  readonly text: string;
  readonly scale: number;
  /** Where its ink's middle is, from the cell's bottom, in atlas pixels. */
  readonly middle: number;
}

/** The main line's size and height in its cell, and the subline's. */
const MAIN_SCALE = 3;
const SUBLINE_SCALE = 1.2;

/** One field value at a point of a glyph's bitmap, bilinear; outside is empty. */
function fieldAt(glyph: BannerGlyph, column: number, row: number): number {
  const columns = glyph.width + 2 * GLYPH_FIELD_BORDER;
  const rows = glyph.height + 2 * GLYPH_FIELD_BORDER;
  const c = column - 0.5;
  const r = row - 0.5;
  const c0 = Math.floor(c);
  const r0 = Math.floor(r);
  const at = (cc: number, rr: number): number =>
    cc < 0 || rr < 0 || cc >= columns || rr >= rows ? 0 : (glyph.bitmap[rr * columns + cc] ?? 0);
  const fc = c - c0;
  const fr = r - r0;
  return (
    (at(c0, r0) * (1 - fc) + at(c0 + 1, r0) * fc) * (1 - fr) +
    (at(c0, r0 + 1) * (1 - fc) + at(c0 + 1, r0 + 1) * fc) * fr
  );
}

/** A GLSL `smoothstep`. */
function smooth(low: number, high: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - low) / (high - low)));
  return t * t * (3 - 2 * t);
}

/**
 * Draws one line into a cell, centred across it, its ink's middle at
 * `line.middle`. Throws on a character the range has no glyph for, rather than
 * drawing a banner with a hole in it.
 */
function drawLine(
  glyphs: ReadonlyMap<number, BannerGlyph>,
  line: SetLine,
  into: Uint8Array,
  width: number,
  cellBottom: number,
): void {
  const placed = [...line.text].map((character) => {
    const glyph = glyphs.get(character.codePointAt(0) ?? -1);
    if (glyph === undefined) {
      throw new Error(`the glyph range has no ${JSON.stringify(character)} for "${line.text}"`);
    }
    return glyph;
  });
  const advance = placed.reduce((sum, glyph) => sum + glyph.advance, 0) * line.scale;
  const inked = placed.filter((glyph) => glyph.width > 0);
  const inkTop = Math.max(...inked.map((glyph) => glyph.top));
  const inkBottom = Math.min(...inked.map((glyph) => glyph.top - glyph.height));
  // Font units upward from the "ascender line" every glyph's `top` is from.
  const shift = line.middle - ((inkTop + inkBottom) / 2) * line.scale;
  let pen = (width - advance) / 2;
  const softness = FIELD_PER_PIXEL / line.scale / 2;
  for (const glyph of placed) {
    if (glyph.width > 0) {
      const columns = glyph.width + 2 * GLYPH_FIELD_BORDER;
      const rows = glyph.height + 2 * GLYPH_FIELD_BORDER;
      // The bitmap's left and top edges, in atlas pixels (y up from the cell's bottom).
      const x0 = pen + (glyph.left - GLYPH_FIELD_BORDER) * line.scale;
      const yTop = shift + (glyph.top + GLYPH_FIELD_BORDER) * line.scale;
      const fromX = Math.max(0, Math.floor(x0));
      const toX = Math.min(width, Math.ceil(x0 + columns * line.scale));
      const fromY = Math.max(0, Math.floor(yTop - rows * line.scale));
      const toY = Math.min(BANNER_CELL_HEIGHT, Math.ceil(yTop));
      for (let y = fromY; y < toY; y += 1) {
        for (let x = fromX; x < toX; x += 1) {
          const column = (x + 0.5 - x0) / line.scale;
          const row = (yTop - (y + 0.5)) / line.scale;
          const value = fieldAt(glyph, column, row);
          const cover = smooth(GLYPH_EDGE - softness, GLYPH_EDGE + softness, value);
          const at = (cellBottom + y) * width + x;
          into[at] = Math.max(into[at] ?? 0, Math.round(cover * 255));
        }
      }
    }
    pen += glyph.advance * line.scale;
  }
}

/**
 * Builds the atlas: one cell per {@link BannerCell}, bottom up, in the order
 * given. Deterministic: the same glyphs and cells make the same bytes.
 */
export function bannerAtlas(
  glyphs: ReadonlyMap<number, BannerGlyph>,
  cells: readonly BannerCell[],
): BannerAtlas {
  if (cells.length > BANNER_CELLS) {
    throw new Error(
      `${String(cells.length)} banners, more than the atlas's ${String(BANNER_CELLS)} cells`,
    );
  }
  const width = BANNER_CELL_WIDTH;
  const height = BANNER_CELL_HEIGHT * BANNER_CELLS;
  const coverage = new Uint8Array(width * height);
  const index = new Map<string, number>();
  const rasterised: string[] = [];
  cells.forEach((cell, at) => {
    const bottom = at * BANNER_CELL_HEIGHT;
    const lines: SetLine[] =
      cell.subline === undefined
        ? [{ text: cell.main, scale: MAIN_SCALE, middle: BANNER_CELL_HEIGHT / 2 }]
        : [
            { text: cell.main, scale: MAIN_SCALE, middle: BANNER_CELL_HEIGHT * 0.62 },
            { text: cell.subline, scale: SUBLINE_SCALE, middle: BANNER_CELL_HEIGHT * 0.2 },
          ];
    for (const line of lines) {
      drawLine(glyphs, line, coverage, width, bottom);
      if (!rasterised.includes(line.text)) rasterised.push(line.text);
    }
    index.set(cell.main, at);
  });
  return { width, height, coverage, cells: index, rasterised };
}
