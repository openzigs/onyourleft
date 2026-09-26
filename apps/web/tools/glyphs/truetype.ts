// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Just enough of a TrueType reader to draw a label font's outlines (#578).
 *
 * ## Why a reader of our own rather than a dependency
 *
 * The map's labels need one font's outlines, turned into signed-distance
 * glyphs once, at authoring time. A general font library would be a new
 * dependency — a licence check, a supply-chain surface and a lockfile entry —
 * for the six tables below, and every one of them is specified in public
 * documentation: the OpenType specification's chapters on `head`, `hhea`,
 * `maxp`, `hmtx`, `cmap`, `loca` and `glyf` (learn.microsoft.com/typography/
 * opentype/spec). Nothing here was copied from an implementation; CLAUDE.md
 * §6's rule about prior art applies here as everywhere. `packages/fit` carries
 * its own UTF-8 and XML readers for the same kind of reason.
 *
 * ## What it reads, and what it refuses
 *
 * - **TrueType outlines only** (`glyf`), which is what the committed input is.
 *   A CFF font has no `glyf` table and is refused by name rather than read as
 *   empty.
 * - **`cmap` formats 4 and 12**, the two a Unicode font carries.
 * - **Composite glyphs** whose components are placed by offset, with the
 *   three transform shapes the format allows. Placement by *point matching*
 *   is refused: nothing in the input uses it, and a guessed implementation
 *   would draw a wrong accent silently, which is worse than a thrown error at
 *   authoring time.
 * - **No hinting.** Instructions are skipped. The input is Roboto's *unhinted*
 *   release, and a signed-distance glyph is resampled by the GPU at every
 *   size anyway, so a hinted outline would buy nothing.
 *
 * Pure: bytes in, numbers out, no file and no platform API.
 */

/** A point of a contour, in font units, and whether the outline passes through it. */
export interface OutlinePoint {
  readonly x: number;
  readonly y: number;
  readonly onCurve: boolean;
}

/** One glyph, as the font describes it. */
export interface GlyphOutline {
  /** Closed contours; each is quadratic B-spline control points. */
  readonly contours: readonly (readonly OutlinePoint[])[];
  /** The bounding box the `glyf` header records, font units. Zeros for an empty glyph. */
  readonly xMin: number;
  readonly yMin: number;
  readonly xMax: number;
  readonly yMax: number;
  /** Advance width, font units. */
  readonly advance: number;
}

/** A parsed font: its metrics, its character map, and a way to read a glyph. */
export interface TrueTypeFont {
  readonly unitsPerEm: number;
  readonly ascender: number;
  readonly descender: number;
  /** Every Unicode code point the font maps to a glyph other than `.notdef`, ascending. */
  readonly codePoints: readonly number[];
  glyphIndexOf(codePoint: number): number;
  outline(glyphIndex: number): GlyphOutline;
  /** A `name` table string by name id (0 = copyright), Windows Unicode records only. */
  name(nameId: number): string | undefined;
}

/** A malformed or unsupported font. Thrown at authoring time, never at run time. */
export class FontError extends Error {
  override readonly name = 'FontError';
}

interface TableRecord {
  readonly offset: number;
  readonly length: number;
}

const ON_CURVE = 0x01;
const X_SHORT = 0x02;
const Y_SHORT = 0x04;
const REPEAT = 0x08;
const X_SAME_OR_POSITIVE = 0x10;
const Y_SAME_OR_POSITIVE = 0x20;

const ARG_1_AND_2_ARE_WORDS = 0x0001;
const ARGS_ARE_XY_VALUES = 0x0002;
const WE_HAVE_A_SCALE = 0x0008;
const MORE_COMPONENTS = 0x0020;
const WE_HAVE_AN_X_AND_Y_SCALE = 0x0040;
const WE_HAVE_A_TWO_BY_TWO = 0x0080;

/** How deep a composite may nest before it is treated as a cycle. */
const MAXIMUM_COMPOSITE_DEPTH = 8;

function tableDirectory(view: DataView): ReadonlyMap<string, TableRecord> {
  if (view.byteLength < 12) {
    throw new FontError('the file is too short to hold a table directory');
  }
  const version = view.getUint32(0);
  if (version !== 0x00010000 && version !== 0x74727565) {
    throw new FontError('not a TrueType-outline font (a CFF font has no glyf table to read)');
  }
  const count = view.getUint16(4);
  const tables = new Map<string, TableRecord>();
  for (let index = 0; index < count; index += 1) {
    const at = 12 + index * 16;
    if (at + 16 > view.byteLength) {
      throw new FontError('the table directory runs past the end of the file');
    }
    const tag = String.fromCharCode(
      view.getUint8(at),
      view.getUint8(at + 1),
      view.getUint8(at + 2),
      view.getUint8(at + 3),
    );
    const offset = view.getUint32(at + 8);
    const length = view.getUint32(at + 12);
    if (offset + length > view.byteLength) {
      throw new FontError(`the ${tag} table runs past the end of the file`);
    }
    tables.set(tag, { offset, length });
  }
  return tables;
}

function required(tables: ReadonlyMap<string, TableRecord>, tag: string): TableRecord {
  const table = tables.get(tag);
  if (table === undefined) {
    throw new FontError(`the font has no ${tag} table`);
  }
  return table;
}

/** Map a code point to a glyph index through a format 4 subtable. */
function format4Map(view: DataView, at: number): Map<number, number> {
  const map = new Map<number, number>();
  const segments = view.getUint16(at + 6) / 2;
  const ends = at + 14;
  const starts = ends + segments * 2 + 2;
  const deltas = starts + segments * 2;
  const rangeOffsets = deltas + segments * 2;
  for (let segment = 0; segment < segments; segment += 1) {
    const end = view.getUint16(ends + segment * 2);
    const start = view.getUint16(starts + segment * 2);
    const delta = view.getInt16(deltas + segment * 2);
    const rangeOffsetAt = rangeOffsets + segment * 2;
    const rangeOffset = view.getUint16(rangeOffsetAt);
    for (let code = start; code <= end && code !== 0xffff; code += 1) {
      let glyph: number;
      if (rangeOffset === 0) {
        glyph = (code + delta) & 0xffff;
      } else {
        // The spec's own pointer arithmetic: the offset is relative to the
        // idRangeOffset entry itself.
        const glyphAt = rangeOffsetAt + rangeOffset + (code - start) * 2;
        const raw = view.getUint16(glyphAt);
        glyph = raw === 0 ? 0 : (raw + delta) & 0xffff;
      }
      if (glyph !== 0) {
        map.set(code, glyph);
      }
    }
  }
  return map;
}

/** Map a code point to a glyph index through a format 12 subtable. */
function format12Map(view: DataView, at: number): Map<number, number> {
  const map = new Map<number, number>();
  const groups = view.getUint32(at + 12);
  for (let group = 0; group < groups; group += 1) {
    const g = at + 16 + group * 12;
    const start = view.getUint32(g);
    const end = view.getUint32(g + 4);
    const first = view.getUint32(g + 8);
    for (let code = start; code <= end; code += 1) {
      const glyph = first + (code - start);
      if (glyph !== 0) {
        map.set(code, glyph);
      }
    }
  }
  return map;
}

/** The Unicode subtables a font's `cmap` carries, by format, each as code point → glyph. */
export interface CharacterMaps {
  /** Format 12, the full repertoire: Windows (3, 10) or the Unicode platform. */
  readonly format12?: ReadonlyMap<number, number>;
  /** Format 4, the Basic Multilingual Plane: Windows (3, 1) or the Unicode platform. */
  readonly format4?: ReadonlyMap<number, number>;
}

function characterMapsIn(view: DataView, cmap: TableRecord): CharacterMaps {
  const count = view.getUint16(cmap.offset + 2);
  let format12: Map<number, number> | undefined;
  let format4: Map<number, number> | undefined;
  for (let index = 0; index < count; index += 1) {
    const record = cmap.offset + 4 + index * 8;
    const platform = view.getUint16(record);
    const encoding = view.getUint16(record + 2);
    const unicode = platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10));
    if (!unicode) {
      continue;
    }
    const at = cmap.offset + view.getUint32(record + 4);
    const format = view.getUint16(at);
    if (format === 12 && format12 === undefined) {
      format12 = format12Map(view, at);
    } else if (format === 4 && format4 === undefined) {
      format4 = format4Map(view, at);
    }
  }
  return {
    ...(format12 === undefined ? {} : { format12 }),
    ...(format4 === undefined ? {} : { format4 }),
  };
}

/**
 * Both Unicode subtables of a font, read separately.
 *
 * {@link parseTrueType} uses the full-repertoire one where there is one; this
 * exists so a test can hold the two against each other, which is what proves
 * the format 4 reader on a font whose format 12 table shadows it.
 */
export function characterMaps(bytes: Uint8Array): CharacterMaps {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return characterMapsIn(view, required(tableDirectory(view), 'cmap'));
}

/** Parse a TrueType font. Throws {@link FontError} on anything it cannot read faithfully. */
export function parseTrueType(bytes: Uint8Array): TrueTypeFont {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tables = tableDirectory(view);
  const head = required(tables, 'head');
  const hhea = required(tables, 'hhea');
  const maxp = required(tables, 'maxp');
  const hmtx = required(tables, 'hmtx');
  const loca = required(tables, 'loca');
  const glyf = required(tables, 'glyf');
  const cmap = required(tables, 'cmap');

  const unitsPerEm = view.getUint16(head.offset + 18);
  const longOffsets = view.getInt16(head.offset + 50) === 1;
  const ascender = view.getInt16(hhea.offset + 4);
  const descender = view.getInt16(hhea.offset + 6);
  const horizontalMetrics = view.getUint16(hhea.offset + 34);
  const glyphCount = view.getUint16(maxp.offset + 4);
  const maps = characterMapsIn(view, cmap);
  const map = maps.format12 ?? maps.format4;
  if (map === undefined) {
    throw new FontError('the font has no Unicode cmap subtable of format 4 or 12');
  }

  const glyphOffset = (index: number): { start: number; end: number } => {
    if (index < 0 || index >= glyphCount) {
      throw new FontError(`glyph ${String(index)} is outside the font's ${String(glyphCount)}`);
    }
    const start = longOffsets
      ? view.getUint32(loca.offset + index * 4)
      : view.getUint16(loca.offset + index * 2) * 2;
    const end = longOffsets
      ? view.getUint32(loca.offset + (index + 1) * 4)
      : view.getUint16(loca.offset + (index + 1) * 2) * 2;
    if (end < start || glyf.offset + end > glyf.offset + glyf.length) {
      throw new FontError(`glyph ${String(index)}'s loca entry is malformed`);
    }
    return { start: glyf.offset + start, end: glyf.offset + end };
  };

  const advanceOf = (index: number): number => {
    const metric = Math.min(index, horizontalMetrics - 1);
    return view.getUint16(hmtx.offset + metric * 4);
  };

  const simple = (at: number, contourCount: number): OutlinePoint[][] => {
    const ends: number[] = [];
    for (let contour = 0; contour < contourCount; contour += 1) {
      ends.push(view.getUint16(at + 10 + contour * 2));
    }
    const pointCount = (ends[ends.length - 1] ?? -1) + 1;
    let cursor = at + 10 + contourCount * 2;
    const instructions = view.getUint16(cursor);
    cursor += 2 + instructions;
    const flags: number[] = [];
    while (flags.length < pointCount) {
      const flag = view.getUint8(cursor);
      cursor += 1;
      flags.push(flag);
      if ((flag & REPEAT) !== 0) {
        const repeats = view.getUint8(cursor);
        cursor += 1;
        for (let r = 0; r < repeats; r += 1) {
          flags.push(flag);
        }
      }
    }
    const coordinates = (short: number, sameOrPositive: number): number[] => {
      const values: number[] = [];
      let value = 0;
      for (let point = 0; point < pointCount; point += 1) {
        const flag = flags[point] ?? 0;
        if ((flag & short) !== 0) {
          const step = view.getUint8(cursor);
          cursor += 1;
          value += (flag & sameOrPositive) !== 0 ? step : -step;
        } else if ((flag & sameOrPositive) === 0) {
          value += view.getInt16(cursor);
          cursor += 2;
        }
        values.push(value);
      }
      return values;
    };
    const xs = coordinates(X_SHORT, X_SAME_OR_POSITIVE);
    const ys = coordinates(Y_SHORT, Y_SAME_OR_POSITIVE);
    const contours: OutlinePoint[][] = [];
    let first = 0;
    for (const end of ends) {
      const contour: OutlinePoint[] = [];
      for (let point = first; point <= end; point += 1) {
        contour.push({
          x: xs[point] ?? 0,
          y: ys[point] ?? 0,
          onCurve: ((flags[point] ?? 0) & ON_CURVE) !== 0,
        });
      }
      contours.push(contour);
      first = end + 1;
    }
    return contours;
  };

  const f2dot14 = (at: number): number => view.getInt16(at) / 16384;

  const contoursOf = (index: number, depth: number): OutlinePoint[][] => {
    if (depth > MAXIMUM_COMPOSITE_DEPTH) {
      throw new FontError(`glyph ${String(index)} nests composites too deeply to be acyclic`);
    }
    const { start, end } = glyphOffset(index);
    if (end === start) {
      return [];
    }
    const contourCount = view.getInt16(start);
    if (contourCount >= 0) {
      return simple(start, contourCount);
    }
    const contours: OutlinePoint[][] = [];
    let cursor = start + 10;
    let flags: number;
    do {
      flags = view.getUint16(cursor);
      const component = view.getUint16(cursor + 2);
      cursor += 4;
      if ((flags & ARGS_ARE_XY_VALUES) === 0) {
        throw new FontError(
          `glyph ${String(index)} places a component by point matching, which this reader refuses`,
        );
      }
      let dx: number;
      let dy: number;
      if ((flags & ARG_1_AND_2_ARE_WORDS) !== 0) {
        dx = view.getInt16(cursor);
        dy = view.getInt16(cursor + 2);
        cursor += 4;
      } else {
        dx = view.getInt8(cursor);
        dy = view.getInt8(cursor + 1);
        cursor += 2;
      }
      let a = 1;
      let b = 0;
      let c = 0;
      let d = 1;
      if ((flags & WE_HAVE_A_SCALE) !== 0) {
        a = d = f2dot14(cursor);
        cursor += 2;
      } else if ((flags & WE_HAVE_AN_X_AND_Y_SCALE) !== 0) {
        a = f2dot14(cursor);
        d = f2dot14(cursor + 2);
        cursor += 4;
      } else if ((flags & WE_HAVE_A_TWO_BY_TWO) !== 0) {
        a = f2dot14(cursor);
        b = f2dot14(cursor + 2);
        c = f2dot14(cursor + 4);
        d = f2dot14(cursor + 6);
        cursor += 8;
      }
      for (const contour of contoursOf(component, depth + 1)) {
        contours.push(
          contour.map((point) => ({
            x: a * point.x + c * point.y + dx,
            y: b * point.x + d * point.y + dy,
            onCurve: point.onCurve,
          })),
        );
      }
    } while ((flags & MORE_COMPONENTS) !== 0);
    return contours;
  };

  const nameTable = tables.get('name');

  return {
    unitsPerEm,
    ascender,
    descender,
    codePoints: [...map.keys()].sort((left, right) => left - right),
    glyphIndexOf: (codePoint) => map.get(codePoint) ?? 0,
    outline(index: number): GlyphOutline {
      const { start, end } = glyphOffset(index);
      const empty = end === start;
      return {
        contours: contoursOf(index, 0),
        xMin: empty ? 0 : view.getInt16(start + 2),
        yMin: empty ? 0 : view.getInt16(start + 4),
        xMax: empty ? 0 : view.getInt16(start + 6),
        yMax: empty ? 0 : view.getInt16(start + 8),
        advance: advanceOf(index),
      };
    },
    name(nameId: number): string | undefined {
      if (nameTable === undefined) {
        return undefined;
      }
      const count = view.getUint16(nameTable.offset + 2);
      const storage = nameTable.offset + view.getUint16(nameTable.offset + 4);
      for (let record = 0; record < count; record += 1) {
        const at = nameTable.offset + 6 + record * 12;
        if (view.getUint16(at) !== 3 || view.getUint16(at + 6) !== nameId) {
          continue;
        }
        const length = view.getUint16(at + 8);
        const offset = view.getUint16(at + 10);
        let text = '';
        for (let unit = 0; unit < length; unit += 2) {
          text += String.fromCharCode(view.getUint16(storage + offset + unit));
        }
        return text;
      }
      return undefined;
    },
  };
}
