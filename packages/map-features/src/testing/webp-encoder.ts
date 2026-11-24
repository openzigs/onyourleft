// SPDX-License-Identifier: Apache-2.0

/**
 * Test support: a lossless WebP encoder small enough to read, and the reader
 * of exactly what it writes (#2013).
 *
 * Node has no WebP decoder and the repository carries none, so a height
 * tile's decode is the platform's (`apps/web/src/terrain/decode.ts`). The
 * synthetic tiles the suites read still have to be **real** lossless WebP:
 * `checkHeightTileBytes` reads their header, and `browser/terrain.browser.spec.ts`
 * hands the same bytes to Chromium's decoder and reads the same heights back,
 * which is what shows this encoder writes a file a real decoder accepts.
 *
 * ## The one shape it writes
 *
 * A `VP8L` bitstream with no transform, no colour cache and one prefix-code
 * group (the WebP lossless bitstream specification). Green, red and blue each
 * use a complete code of 256 eight-bit symbols; alpha is one symbol, 255, and
 * costs no bits; so does the distance code, which is never used. Every pixel
 * is three literal bytes: 786,432 bytes for a 512 px tile, well under the
 * 4 MiB a tile may be. Nothing here is compressed, on purpose: there is no
 * back-reference for a reader to get wrong.
 *
 * {@link decodeFixtureWebp} is **not a WebP decoder**. It reads that one
 * layout, and throws for anything else, so a Vitest suite can stand in for
 * the platform over tiles this file wrote.
 */

class BitWriter {
  private readonly bytes: number[] = [];
  private current = 0;
  private filled = 0;

  /** `count` bits of `value`, least significant first, as VP8L packs every field. */
  bits(value: number, count: number): void {
    for (let bit = 0; bit < count; bit += 1) {
      this.current |= ((value >>> bit) & 1) << this.filled;
      this.filled += 1;
      if (this.filled === 8) this.flush();
    }
  }

  /** An eight-bit prefix code: its bits go out most significant first. */
  code(symbol: number): void {
    for (let bit = 7; bit >= 0; bit -= 1) this.bits((symbol >>> bit) & 1, 1);
  }

  finish(): Uint8Array {
    if (this.filled > 0) this.flush();
    return Uint8Array.from(this.bytes);
  }

  private flush(): void {
    this.bytes.push(this.current);
    this.current = 0;
    this.filled = 0;
  }
}

/** The order code-length code lengths are stored in (the specification's `kCodeLengthCodeOrder`). */
const CODE_LENGTH_ORDER = [17, 18, 0, 1, 2, 3, 4, 5, 16, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];

/**
 * A normal prefix code in which symbols `0..255` are eight bits long and every
 * later symbol of the alphabet is unused. The code-length code has two
 * symbols, 0 and 8, of one bit each.
 */
function fixedEightBitCode(out: BitWriter, alphabet: number): void {
  out.bits(0, 1); // a normal code, not a simple one
  const stored = CODE_LENGTH_ORDER.indexOf(8) + 1;
  out.bits(stored - 4, 4);
  for (let index = 0; index < stored; index += 1) {
    const symbol = CODE_LENGTH_ORDER[index]!;
    out.bits(symbol === 0 || symbol === 8 ? 1 : 0, 3);
  }
  out.bits(0, 1); // every symbol of the alphabet has a length that follows
  for (let symbol = 0; symbol < alphabet; symbol += 1) out.bits(symbol < 256 ? 1 : 0, 1);
}

/** A simple prefix code of one symbol, which then costs no bits to write. */
function oneSymbolCode(out: BitWriter, symbol: number): void {
  out.bits(1, 1); // a simple code
  out.bits(0, 1); // of one symbol
  if (symbol < 2) {
    out.bits(0, 1);
    out.bits(symbol, 1);
  } else {
    out.bits(1, 1);
    out.bits(symbol, 8);
  }
}

/** What {@link encodeLosslessWebp} may be asked to lie about, for a hostile fixture. */
export interface WebpEncodeOptions {
  /** The width and height the header states, when not the pixels' own. */
  readonly statedSize?: { readonly width: number; readonly height: number } | undefined;
}

/** `rgba` (opaque, row by row) as a lossless WebP file. */
export function encodeLosslessWebp(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  options: WebpEncodeOptions = {},
): Uint8Array {
  if (rgba.length !== width * height * 4) throw new Error('rgba is not width × height × 4 bytes');
  const stated = options.statedSize ?? { width, height };
  const out = new BitWriter();
  out.bits(0x2f, 8);
  out.bits(stated.width - 1, 14);
  out.bits(stated.height - 1, 14);
  out.bits(0, 1); // no alpha
  out.bits(0, 3); // version 0
  out.bits(0, 1); // no transform
  out.bits(0, 1); // no colour cache
  out.bits(0, 1); // one prefix-code group
  fixedEightBitCode(out, 256 + 24); // green, and the 24 unused length prefixes
  fixedEightBitCode(out, 256); // red
  fixedEightBitCode(out, 256); // blue
  oneSymbolCode(out, 255); // alpha
  oneSymbolCode(out, 0); // distance
  for (let at = 0; at < rgba.length; at += 4) {
    out.code(rgba[at + 1]!);
    out.code(rgba[at]!);
    out.code(rgba[at + 2]!);
  }
  return riff(out.finish());
}

function riff(stream: Uint8Array): Uint8Array {
  const padded = stream.length + (stream.length % 2);
  const bytes = new Uint8Array(20 + padded);
  const view = new DataView(bytes.buffer);
  bytes.set([0x52, 0x49, 0x46, 0x46], 0); // RIFF
  view.setUint32(4, 12 + padded, true);
  bytes.set([0x57, 0x45, 0x42, 0x50], 8); // WEBP
  bytes.set([0x56, 0x50, 0x38, 0x4c], 12); // VP8L
  view.setUint32(16, stream.length, true);
  bytes.set(stream, 20);
  return bytes;
}

/** How many bits {@link encodeLosslessWebp} writes before the first pixel. */
const PREAMBLE_BITS =
  8 + 14 + 14 + 1 + 3 + 3 + (1 + 4 + 12 * 3 + 1 + 280) + 2 * (1 + 4 + 12 * 3 + 1 + 256) + 11 + 4;

/**
 * The pixels of a file {@link encodeLosslessWebp} wrote, as opaque RGBA.
 *
 * @throws for anything else: a file that is too short for the size its header
 * states, or whose preamble is not the one this encoder writes.
 */
export function decodeFixtureWebp(bytes: Uint8Array): Uint8Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 25 || bytes[20] !== 0x2f) throw new Error('not a fixture WebP');
  const packed = view.getUint32(21, true);
  const width = (packed & 0x3fff) + 1;
  const height = ((packed >>> 14) & 0x3fff) + 1;
  const stream = bytes.subarray(20, 20 + view.getUint32(16, true));
  if (stream.length * 8 < PREAMBLE_BITS + width * height * 24) {
    throw new Error('the fixture WebP is shorter than the size its header states');
  }
  let bit = PREAMBLE_BITS;
  const symbol = (): number => {
    let value = 0;
    for (let index = 0; index < 8; index += 1) {
      value = (value << 1) | ((stream[bit >>> 3]! >>> (bit & 7)) & 1);
      bit += 1;
    }
    return value;
  };
  const rgba = new Uint8Array(width * height * 4);
  for (let at = 0; at < rgba.length; at += 4) {
    const green = symbol();
    rgba[at] = symbol();
    rgba[at + 1] = green;
    rgba[at + 2] = symbol();
    rgba[at + 3] = 255;
  }
  return rgba;
}
