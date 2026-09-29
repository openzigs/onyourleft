// SPDX-License-Identifier: AGPL-3.0-or-later

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  BANNER_CELL_HEIGHT,
  BANNER_CELL_WIDTH,
  BANNER_CELLS,
  bannerAtlas,
  readGlyphRange,
} from './banner-atlas';
import { bannerCells, bannerTexts, toGoText } from './gantry-wording';

const PUBLIC = fileURLToPath(new URL('../../public/', import.meta.url));
const RANGE = join(PUBLIC, 'glyphs', 'Roboto-Regular', '0-255.pbf');

const glyphs = readGlyphRange(new Uint8Array(readFileSync(RANGE)));

describe('the banners’ lettering — #679', () => {
  it('reads the app’s own glyph range: every Latin-1 code point, with its field', () => {
    expect(glyphs.size).toBeGreaterThan(150);
    const capitalA = glyphs.get('A'.codePointAt(0) ?? 0);
    expect(capitalA?.width).toBeGreaterThan(0);
    expect(capitalA?.bitmap.length).toBe(
      ((capitalA?.width ?? 0) + 6) * ((capitalA?.height ?? 0) + 6),
    );
  });

  it('rasterises exactly the wording module’s list, and nothing it does not name', () => {
    const atlas = bannerAtlas(glyphs, bannerCells());
    expect(new Set(atlas.rasterised)).toEqual(new Set(bannerTexts()));
    expect(atlas.rasterised).toHaveLength(bannerTexts().length);
    // The control: a string the wording module does not name, added to the
    // atlas's cells, makes the two lists differ.
    const extra = bannerAtlas(glyphs, [...bannerCells(), { main: 'ANY OTHER WORDS' }]);
    expect(new Set(extra.rasterised)).not.toEqual(new Set(bannerTexts()));
  });

  it('carries the board before a line in both systems, from units/format.ts', () => {
    expect(toGoText('metric')).not.toBe(toGoText('imperial'));
    const atlas = bannerAtlas(glyphs, bannerCells());
    expect(atlas.cells.has(toGoText('metric'))).toBe(true);
    expect(atlas.cells.has(toGoText('imperial'))).toBe(true);
  });

  it('letters every cell, and leaves the rest of each cell the banner’s ground', () => {
    const atlas = bannerAtlas(glyphs, bannerCells());
    expect(atlas.width).toBe(BANNER_CELL_WIDTH);
    expect(atlas.height).toBe(BANNER_CELL_HEIGHT * BANNER_CELLS);
    for (const [text, cell] of atlas.cells) {
      let inked = 0;
      let full = 0;
      for (let row = cell * BANNER_CELL_HEIGHT; row < (cell + 1) * BANNER_CELL_HEIGHT; row += 1) {
        for (let column = 0; column < atlas.width; column += 1) {
          const value = atlas.coverage[row * atlas.width + column] ?? 0;
          if (value > 0) inked += 1;
          if (value === 255) full += 1;
        }
      }
      const share = inked / (BANNER_CELL_HEIGHT * atlas.width);
      expect(share, text).toBeGreaterThan(0.02);
      expect(share, text).toBeLessThan(0.4);
      expect(full, text).toBeGreaterThan(100);
    }
    // An empty cell is empty.
    const unused = BANNER_CELLS - 1;
    const rows = atlas.coverage.subarray(unused * BANNER_CELL_HEIGHT * atlas.width);
    expect(rows.every((value) => value === 0)).toBe(true);
  });

  it('makes the same bytes every time, from the same glyphs', () => {
    const digest = (): string =>
      createHash('sha256').update(bannerAtlas(glyphs, bannerCells()).coverage).digest('hex');
    expect(digest()).toBe(digest());
  });

  it('refuses a character the range cannot draw, rather than leaving a hole', () => {
    expect(() => bannerAtlas(glyphs, [{ main: 'ĀĒ' }])).toThrow(/no/);
  });

  it('ships the glyphs, and not the font they were made from', () => {
    const shipped = (directory: string): string[] =>
      readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory() ? shipped(join(directory, entry.name)) : [join(directory, entry.name)],
      );
    expect(existsSync(RANGE)).toBe(true);
    expect(shipped(PUBLIC).filter((file) => /\.(ttf|otf|woff2?)$/.test(file))).toEqual([]);
  });
});
