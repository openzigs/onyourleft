// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The glyph range file MapLibre asks a `glyphs` URL for (#578) — written, and
 * read back.
 *
 * ## The format
 *
 * A protocol-buffer message, one file per 256 code points, named for its range
 * (`0-255.pbf`). The schema is three messages, and MapLibre's own parser
 * (`maplibre-gl/src/style/parse_glyph_pbf.ts`, BSD-3-Clause, read to confirm
 * the field numbers rather than copied) is the authority on what it accepts:
 *
 * ```text
 * glyphs    { repeated fontstack stacks = 1; }
 * fontstack { string name = 1; string range = 2; repeated glyph glyphs = 3; }
 * glyph     { uint32 id = 1; bytes bitmap = 2; uint32 width = 3;
 *             uint32 height = 4; sint32 left = 5; sint32 top = 6;
 *             uint32 advance = 7; }
 * ```
 *
 * `width` and `height` are the glyph's own box; the `bitmap` is that box plus
 * a {@link GLYPH_BORDER}-pixel border on every side, one byte per pixel, row by
 * row from the top.
 *
 * ## Why the reader exists
 *
 * Only the writer ships anything. The reader is what the tests use to say the
 * committed files hold the glyphs they should, and it is written from the same
 * schema rather than from the writer, so a field the writer numbered wrongly
 * reads back wrongly rather than agreeing with itself.
 *
 * Pure: bytes in, bytes out.
 */

/** Pixels of signed-distance field around a glyph's box. MapLibre's `border`. */
export const GLYPH_BORDER = 3;

/** One glyph, as the file carries it. */
export interface EncodedGlyph {
  readonly id: number;
  /** `(width + 2·border) × (height + 2·border)` bytes; empty for a blank glyph. */
  readonly bitmap: Uint8Array;
  readonly width: number;
  readonly height: number;
  readonly left: number;
  readonly top: number;
  readonly advance: number;
}

/** One range file: a font stack's name, the range, and its glyphs in code-point order. */
export interface GlyphRange {
  readonly name: string;
  readonly range: string;
  readonly glyphs: readonly EncodedGlyph[];
}

const VARINT = 0;
const LENGTH_DELIMITED = 2;

function writeVarint(out: number[], value: number): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`a varint must be a non-negative integer, not ${String(value)}`);
  }
  let rest = value;
  while (rest >= 0x80) {
    out.push((rest % 0x80) | 0x80);
    rest = Math.floor(rest / 0x80);
  }
  out.push(rest);
}

function zigzag(value: number): number {
  return value >= 0 ? value * 2 : -value * 2 - 1;
}

function unzigzag(value: number): number {
  return value % 2 === 0 ? value / 2 : -(value + 1) / 2;
}

function key(out: number[], field: number, wireType: number): void {
  writeVarint(out, field * 8 + wireType);
}

function bytesField(out: number[], field: number, bytes: ArrayLike<number>): void {
  key(out, field, LENGTH_DELIMITED);
  writeVarint(out, bytes.length);
  for (let index = 0; index < bytes.length; index += 1) {
    out.push(bytes[index] ?? 0);
  }
}

function varintField(out: number[], field: number, value: number): void {
  key(out, field, VARINT);
  writeVarint(out, value);
}

/** ASCII only: a font stack name and a range string are both. */
function ascii(text: string): number[] {
  const out: number[] = [];
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code > 0x7f) {
      throw new RangeError(`${JSON.stringify(text)} is not ASCII`);
    }
    out.push(code);
  }
  return out;
}

/** The bytes of one range file. */
export function encodeGlyphRange(range: GlyphRange): Uint8Array {
  const stack: number[] = [];
  bytesField(stack, 1, ascii(range.name));
  bytesField(stack, 2, ascii(range.range));
  for (const glyph of range.glyphs) {
    const body: number[] = [];
    varintField(body, 1, glyph.id);
    if (glyph.bitmap.length > 0) {
      bytesField(body, 2, glyph.bitmap);
    }
    varintField(body, 3, glyph.width);
    varintField(body, 4, glyph.height);
    varintField(body, 5, zigzag(glyph.left));
    varintField(body, 6, zigzag(glyph.top));
    varintField(body, 7, glyph.advance);
    bytesField(stack, 3, body);
  }
  const file: number[] = [];
  bytesField(file, 1, stack);
  return Uint8Array.from(file);
}

/**
 * A cursor over one message. No parameter properties: the generator runs under
 * Node's type stripping, which refuses them.
 */
class Reader {
  readonly bytes: Uint8Array;
  #at: number;
  readonly #end: number;
  constructor(bytes: Uint8Array, start = 0, end = bytes.length) {
    this.bytes = bytes;
    this.#at = start;
    this.#end = end;
  }
  get done(): boolean {
    return this.#at >= this.#end;
  }
  varint(): number {
    let value = 0;
    let scale = 1;
    for (;;) {
      if (this.#at >= this.#end) {
        throw new RangeError('a varint runs past the end of its message');
      }
      const byte = this.bytes[this.#at] ?? 0;
      this.#at += 1;
      value += (byte & 0x7f) * scale;
      if ((byte & 0x80) === 0) {
        return value;
      }
      scale *= 0x80;
    }
  }
  slice(): Reader {
    const length = this.varint();
    const start = this.#at;
    this.#at += length;
    if (this.#at > this.#end) {
      throw new RangeError('a length-delimited field runs past the end of its message');
    }
    return new Reader(this.bytes, start, this.#at);
  }
  rest(): Uint8Array {
    return this.bytes.slice(this.#at, this.#end);
  }
  skip(wireType: number): void {
    if (wireType === VARINT) this.varint();
    else if (wireType === LENGTH_DELIMITED) this.slice();
    else throw new RangeError(`wire type ${String(wireType)} is not in this schema`);
  }
}

function text(reader: Reader): string {
  return String.fromCharCode(...reader.rest());
}

function readGlyph(reader: Reader): EncodedGlyph {
  const glyph: { -readonly [K in keyof EncodedGlyph]: EncodedGlyph[K] } = {
    id: 0,
    bitmap: new Uint8Array(),
    width: 0,
    height: 0,
    left: 0,
    top: 0,
    advance: 0,
  };
  while (!reader.done) {
    const header = reader.varint();
    const field = Math.floor(header / 8);
    const wireType = header % 8;
    if (field === 2 && wireType === LENGTH_DELIMITED) glyph.bitmap = reader.slice().rest();
    else if (wireType !== VARINT) reader.skip(wireType);
    else {
      const value = reader.varint();
      if (field === 1) glyph.id = value;
      else if (field === 3) glyph.width = value;
      else if (field === 4) glyph.height = value;
      else if (field === 5) glyph.left = unzigzag(value);
      else if (field === 6) glyph.top = unzigzag(value);
      else if (field === 7) glyph.advance = value;
    }
  }
  return glyph;
}

/** Every font stack in a range file. The files this repository writes hold exactly one. */
export function decodeGlyphRanges(bytes: Uint8Array): readonly GlyphRange[] {
  const file = new Reader(bytes);
  const stacks: GlyphRange[] = [];
  while (!file.done) {
    const header = file.varint();
    if (header !== 1 * 8 + LENGTH_DELIMITED) {
      file.skip(header % 8);
      continue;
    }
    const stack = file.slice();
    let name = '';
    let range = '';
    const glyphs: EncodedGlyph[] = [];
    while (!stack.done) {
      const inner = stack.varint();
      const field = Math.floor(inner / 8);
      if (inner % 8 !== LENGTH_DELIMITED) {
        stack.skip(inner % 8);
      } else if (field === 1) {
        name = text(stack.slice());
      } else if (field === 2) {
        range = text(stack.slice());
      } else if (field === 3) {
        glyphs.push(readGlyph(stack.slice()));
      } else {
        stack.slice();
      }
    }
    stacks.push({ name, range, glyphs });
  }
  return stacks;
}
