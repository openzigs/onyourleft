// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A lossless WebP (VP8L) reader for the brand gate's picture checks — #972.
 * Test support only.
 *
 * `derive_brand.py` writes the full logo as lossless WebP since #972, and
 * `provenance.test.ts` reads it back the way it reads the PNGs — no green
 * fringe, the sticker's edge — so CI checks the pixels a rider is shipped, not
 * a copy of them. Node has no WebP decoder and none is installed, so this is
 * one, written from Google's "WebP Lossless Bitstream Specification"
 * (RFC 9649), and held to Pillow's own decoding of the committed files pixel
 * for pixel (`webp-testing.test.ts`).
 *
 * It reads what Pillow's lossless encoder writes: a RIFF `WEBP` file whose
 * picture is one `VP8L` chunk (a `VP8X` header before it is allowed), with any
 * of the four transforms, a colour cache and meta prefix codes. A LOSSY picture
 * (`VP8 `, `ALPH`) or an animation is refused rather than misread, because the
 * whole point of the logo's format is that it decodes to exactly the pixels
 * `derive_brand.py` made.
 */

import type { DecodedPng } from './png-testing';

/** The same shape `decodePng` returns, so a check reads either. */
export type DecodedWebp = DecodedPng;

/** Reads bits least significant first, as VP8L packs them. */
class BitReader {
  readonly #bytes: Uint8Array;
  #position = 0;

  constructor(bytes: Uint8Array) {
    this.#bytes = bytes;
  }

  read(count: number): number {
    let value = 0;
    for (let bit = 0; bit < count; bit += 1) {
      const byte = this.#bytes[this.#position >> 3];
      if (byte === undefined) {
        throw new Error('VP8L bitstream ends early');
      }
      value |= ((byte >> (this.#position & 7)) & 1) << bit;
      this.#position += 1;
    }
    return value >>> 0;
  }
}

/** A canonical prefix code, decoded a bit at a time (zlib's `puff` shape). */
interface PrefixCode {
  /** The one symbol of a code that reads no bits, or -1. */
  readonly single: number;
  readonly counts: readonly number[];
  readonly symbols: readonly number[];
}

function prefixCodeFrom(lengths: readonly number[]): PrefixCode {
  const used = lengths.flatMap((length, symbol) => (length > 0 ? [symbol] : []));
  if (used.length === 0) {
    return { single: 0, counts: [], symbols: [] };
  }
  if (used.length === 1) {
    return { single: used[0] ?? 0, counts: [], symbols: [] };
  }
  const maximum = Math.max(...lengths);
  const counts = new Array<number>(maximum + 1).fill(0);
  for (const length of lengths) {
    if (length > 0) counts[length] = (counts[length] ?? 0) + 1;
  }
  const symbols: number[] = [];
  for (let length = 1; length <= maximum; length += 1) {
    lengths.forEach((own, symbol) => {
      if (own === length) symbols.push(symbol);
    });
  }
  return { single: -1, counts, symbols };
}

function readSymbol(reader: BitReader, code: PrefixCode): number {
  if (code.single >= 0) return code.single;
  let value = 0;
  let first = 0;
  let index = 0;
  for (let length = 1; length < code.counts.length; length += 1) {
    value |= reader.read(1);
    const count = code.counts[length] ?? 0;
    if (value - count < first) {
      return code.symbols[index + value - first] ?? 0;
    }
    index += count;
    first = (first + count) << 1;
    value <<= 1;
  }
  throw new Error('VP8L prefix code read past its longest code');
}

const CODE_LENGTH_ORDER = [17, 18, 0, 1, 2, 3, 4, 5, 16, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];

function readPrefixCode(reader: BitReader, alphabet: number): PrefixCode {
  const lengths = new Array<number>(alphabet).fill(0);
  if (reader.read(1) === 1) {
    // A simple code: one or two symbols.
    const symbolCount = reader.read(1) + 1;
    const firstWide = reader.read(1);
    const first = reader.read(firstWide === 1 ? 8 : 1);
    if (symbolCount === 1) {
      return { single: first, counts: [], symbols: [] };
    }
    lengths[first] = 1;
    lengths[reader.read(8)] = 1;
    return prefixCodeFrom(lengths);
  }
  const codeLengthCount = 4 + reader.read(4);
  const codeLengthLengths = new Array<number>(19).fill(0);
  for (let index = 0; index < codeLengthCount; index += 1) {
    codeLengthLengths[CODE_LENGTH_ORDER[index] ?? 0] = reader.read(3);
  }
  const codeLengthCode = prefixCodeFrom(codeLengthLengths);
  let budget = alphabet;
  if (reader.read(1) === 1) {
    const width = 2 + 2 * reader.read(3);
    budget = 2 + reader.read(width);
  }
  let previous = 8;
  let symbol = 0;
  while (symbol < alphabet) {
    if (budget === 0) break;
    budget -= 1;
    const length = readSymbol(reader, codeLengthCode);
    if (length < 16) {
      lengths[symbol] = length;
      symbol += 1;
      if (length !== 0) previous = length;
      continue;
    }
    const [extraBits, offset, value] =
      length === 16 ? [2, 3, previous] : length === 17 ? [3, 3, 0] : [7, 11, 0];
    const repeat = offset + reader.read(extraBits);
    if (symbol + repeat > alphabet) {
      throw new Error('VP8L code lengths run past the alphabet');
    }
    for (let copy = 0; copy < repeat; copy += 1) {
      lengths[symbol] = value;
      symbol += 1;
    }
  }
  return prefixCodeFrom(lengths);
}

/** The 120 short distances of RFC 9649 §4.2.2, as (dx, dy). */
const DISTANCE_MAP: readonly (readonly [number, number])[] = [
  [0, 1],
  [1, 0],
  [1, 1],
  [-1, 1],
  [0, 2],
  [2, 0],
  [1, 2],
  [-1, 2],
  [2, 1],
  [-2, 1],
  [2, 2],
  [-2, 2],
  [0, 3],
  [3, 0],
  [1, 3],
  [-1, 3],
  [3, 1],
  [-3, 1],
  [2, 3],
  [-2, 3],
  [3, 2],
  [-3, 2],
  [0, 4],
  [4, 0],
  [1, 4],
  [-1, 4],
  [4, 1],
  [-4, 1],
  [3, 3],
  [-3, 3],
  [2, 4],
  [-2, 4],
  [4, 2],
  [-4, 2],
  [0, 5],
  [3, 4],
  [-3, 4],
  [4, 3],
  [-4, 3],
  [5, 0],
  [1, 5],
  [-1, 5],
  [5, 1],
  [-5, 1],
  [2, 5],
  [-2, 5],
  [5, 2],
  [-5, 2],
  [4, 4],
  [-4, 4],
  [3, 5],
  [-3, 5],
  [5, 3],
  [-5, 3],
  [0, 6],
  [6, 0],
  [1, 6],
  [-1, 6],
  [6, 1],
  [-6, 1],
  [2, 6],
  [-2, 6],
  [6, 2],
  [-6, 2],
  [4, 5],
  [-4, 5],
  [5, 4],
  [-5, 4],
  [3, 6],
  [-3, 6],
  [6, 3],
  [-6, 3],
  [0, 7],
  [7, 0],
  [1, 7],
  [-1, 7],
  [5, 5],
  [-5, 5],
  [7, 1],
  [-7, 1],
  [4, 6],
  [-4, 6],
  [6, 4],
  [-6, 4],
  [2, 7],
  [-2, 7],
  [7, 2],
  [-7, 2],
  [3, 7],
  [-3, 7],
  [7, 3],
  [-7, 3],
  [5, 6],
  [-5, 6],
  [6, 5],
  [-6, 5],
  [8, 0],
  [4, 7],
  [-4, 7],
  [7, 4],
  [-7, 4],
  [8, 1],
  [8, 2],
  [6, 6],
  [-6, 6],
  [8, 3],
  [5, 7],
  [-5, 7],
  [7, 5],
  [-7, 5],
  [8, 4],
  [6, 7],
  [-6, 7],
  [7, 6],
  [-7, 6],
  [8, 5],
  [7, 7],
  [-7, 7],
  [8, 6],
  [8, 7],
];

function prefixValue(reader: BitReader, prefix: number): number {
  if (prefix < 4) return prefix + 1;
  const extraBits = (prefix - 2) >> 1;
  const offset = (2 + (prefix & 1)) << extraBits;
  return offset + reader.read(extraBits) + 1;
}

const subsampled = (size: number, bits: number): number => (size + (1 << bits) - 1) >> bits;

interface PrefixGroup {
  readonly green: PrefixCode;
  readonly red: PrefixCode;
  readonly blue: PrefixCode;
  readonly alpha: PrefixCode;
  readonly distance: PrefixCode;
}

/** An entropy-coded image of ARGB words; `main` allows meta prefix codes. */
function readEntropyImage(
  reader: BitReader,
  width: number,
  height: number,
  main: boolean,
): Uint32Array {
  const cacheBits = reader.read(1) === 1 ? reader.read(4) : 0;
  if (cacheBits > 11) {
    throw new Error(`VP8L colour cache of ${String(cacheBits)} bits`);
  }
  const cacheSize = cacheBits > 0 ? 1 << cacheBits : 0;
  let metaBits = 0;
  let meta: Uint32Array | undefined;
  let metaWidth = 0;
  let groupCount = 1;
  if (main && reader.read(1) === 1) {
    metaBits = reader.read(3) + 2;
    metaWidth = subsampled(width, metaBits);
    meta = readEntropyImage(reader, metaWidth, subsampled(height, metaBits), false);
    for (const word of meta) {
      groupCount = Math.max(groupCount, ((word >> 8) & 0xffff) + 1);
    }
  }
  const groups: PrefixGroup[] = [];
  for (let group = 0; group < groupCount; group += 1) {
    groups.push({
      green: readPrefixCode(reader, 256 + 24 + cacheSize),
      red: readPrefixCode(reader, 256),
      blue: readPrefixCode(reader, 256),
      alpha: readPrefixCode(reader, 256),
      distance: readPrefixCode(reader, 40),
    });
  }
  const pixels = new Uint32Array(width * height);
  const cache = new Uint32Array(cacheSize);
  const remember = (argb: number): void => {
    if (cacheSize > 0) cache[Math.imul(0x1e35a7bd, argb) >>> (32 - cacheBits)] = argb;
  };
  let at = 0;
  while (at < pixels.length) {
    const x = at % width;
    const y = Math.floor(at / width);
    const index =
      meta === undefined
        ? 0
        : ((meta[(y >> metaBits) * metaWidth + (x >> metaBits)] ?? 0) >> 8) & 0xffff;
    const group = groups[index];
    if (group === undefined) throw new Error('VP8L names a prefix group it did not send');
    const green = readSymbol(reader, group.green);
    if (green < 256) {
      const red = readSymbol(reader, group.red);
      const blue = readSymbol(reader, group.blue);
      const alpha = readSymbol(reader, group.alpha);
      const argb = ((alpha << 24) | (red << 16) | (green << 8) | blue) >>> 0;
      pixels[at] = argb;
      remember(argb);
      at += 1;
    } else if (green < 256 + 24) {
      const length = prefixValue(reader, green - 256);
      const distanceCode = prefixValue(reader, readSymbol(reader, group.distance));
      let distance: number;
      if (distanceCode > 120) {
        distance = distanceCode - 120;
      } else {
        const [dx, dy] = DISTANCE_MAP[distanceCode - 1] ?? [0, 0];
        distance = Math.max(1, dx + dy * width);
      }
      if (distance > at || at + length > pixels.length) {
        throw new Error('VP8L backward reference reaches outside the picture');
      }
      for (let copy = 0; copy < length; copy += 1) {
        const argb = pixels[at - distance] ?? 0;
        pixels[at] = argb;
        remember(argb);
        at += 1;
      }
    } else {
      const key = green - 256 - 24;
      if (key >= cacheSize) throw new Error('VP8L colour cache index out of range');
      const argb = cache[key] ?? 0;
      pixels[at] = argb;
      remember(argb);
      at += 1;
    }
  }
  return pixels;
}

// --- The inverse transforms ------------------------------------------------------

const channel = (argb: number, shift: number): number => (argb >>> shift) & 0xff;

function perChannel(a: number, b: number, combine: (x: number, y: number) => number): number {
  let out = 0;
  for (const shift of [24, 16, 8, 0]) {
    out |= (combine(channel(a, shift), channel(b, shift)) & 0xff) << shift;
  }
  return out >>> 0;
}

const average2 = (a: number, b: number): number => perChannel(a, b, (x, y) => (x + y) >> 1);
const add = (a: number, b: number): number => perChannel(a, b, (x, y) => x + y);
const clamp = (value: number): number => Math.min(255, Math.max(0, value));

function select(left: number, top: number, topLeft: number): number {
  let towardsTop = 0;
  let towardsLeft = 0;
  for (const shift of [24, 16, 8, 0]) {
    const estimate = channel(left, shift) + channel(top, shift) - channel(topLeft, shift);
    towardsLeft += Math.abs(estimate - channel(left, shift));
    towardsTop += Math.abs(estimate - channel(top, shift));
  }
  return towardsLeft < towardsTop ? left : top;
}

function clampAddSubtractFull(a: number, b: number, c: number): number {
  let out = 0;
  for (const shift of [24, 16, 8, 0]) {
    out |= clamp(channel(a, shift) + channel(b, shift) - channel(c, shift)) << shift;
  }
  return out >>> 0;
}

function clampAddSubtractHalf(a: number, b: number): number {
  let out = 0;
  for (const shift of [24, 16, 8, 0]) {
    const x = channel(a, shift);
    out |= clamp(x + Math.trunc((x - channel(b, shift)) / 2)) << shift;
  }
  return out >>> 0;
}

function predict(mode: number, left: number, top: number, topRight: number, topLeft: number) {
  switch (mode) {
    case 1:
      return left;
    case 2:
      return top;
    case 3:
      return topRight;
    case 4:
      return topLeft;
    case 5:
      return average2(average2(left, topRight), top);
    case 6:
      return average2(left, topLeft);
    case 7:
      return average2(left, top);
    case 8:
      return average2(topLeft, top);
    case 9:
      return average2(top, topRight);
    case 10:
      return average2(average2(left, topLeft), average2(top, topRight));
    case 11:
      return select(left, top, topLeft);
    case 12:
      return clampAddSubtractFull(left, top, topLeft);
    case 13:
      return clampAddSubtractHalf(average2(left, top), topLeft);
    default:
      return 0xff000000;
  }
}

function undoPredictor(pixels: Uint32Array, width: number, bits: number, modes: Uint32Array) {
  const blocksWide = subsampled(width, bits);
  for (let at = 0; at < pixels.length; at += 1) {
    const x = at % width;
    const y = Math.floor(at / width);
    let prediction: number;
    if (at === 0) {
      prediction = 0xff000000;
    } else if (y === 0) {
      prediction = pixels[at - 1] ?? 0;
    } else if (x === 0) {
      prediction = pixels[at - width] ?? 0;
    } else {
      const mode = ((modes[(y >> bits) * blocksWide + (x >> bits)] ?? 0) >> 8) & 0xf;
      // The top-right of the last column is, in memory order, the first pixel
      // of this row — which is what the specification asks for.
      prediction = predict(
        mode,
        pixels[at - 1] ?? 0,
        pixels[at - width] ?? 0,
        pixels[at - width + 1] ?? 0,
        pixels[at - width - 1] ?? 0,
      );
    }
    pixels[at] = add(pixels[at] ?? 0, prediction);
  }
}

const signed8 = (value: number): number => (value << 24) >> 24;
const colourDelta = (transform: number, colour: number): number =>
  (signed8(transform) * signed8(colour)) >> 5;

function undoColourTransform(pixels: Uint32Array, width: number, bits: number, codes: Uint32Array) {
  const blocksWide = subsampled(width, bits);
  for (let at = 0; at < pixels.length; at += 1) {
    const x = at % width;
    const y = Math.floor(at / width);
    const code = codes[(y >> bits) * blocksWide + (x >> bits)] ?? 0;
    const greenToRed = channel(code, 0);
    const greenToBlue = channel(code, 8);
    const redToBlue = channel(code, 16);
    const argb = pixels[at] ?? 0;
    const green = channel(argb, 8);
    const red = (channel(argb, 16) + colourDelta(greenToRed, green)) & 0xff;
    const blue =
      (channel(argb, 0) + colourDelta(greenToBlue, green) + colourDelta(redToBlue, red)) & 0xff;
    pixels[at] = ((argb & 0xff00ff00) | (red << 16) | blue) >>> 0;
  }
}

function undoSubtractGreen(pixels: Uint32Array): void {
  for (let at = 0; at < pixels.length; at += 1) {
    const argb = pixels[at] ?? 0;
    const green = channel(argb, 8);
    const red = (channel(argb, 16) + green) & 0xff;
    const blue = (channel(argb, 0) + green) & 0xff;
    pixels[at] = ((argb & 0xff00ff00) | (red << 16) | blue) >>> 0;
  }
}

function undoColourIndexing(
  packed: Uint32Array,
  packedWidth: number,
  width: number,
  height: number,
  bits: number,
  palette: Uint32Array,
): Uint32Array {
  const out = new Uint32Array(width * height);
  const perByte = 1 << bits;
  const symbolBits = 8 >> bits;
  const mask = (1 << symbolBits) - 1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const word = packed[y * packedWidth + (x >> bits)] ?? 0;
      const index = (channel(word, 8) >> ((x & (perByte - 1)) * symbolBits)) & mask;
      out[y * width + x] = palette[index] ?? 0;
    }
  }
  return out;
}

type Transform =
  | { readonly kind: 'predictor' | 'colour'; readonly bits: number; readonly data: Uint32Array }
  | { readonly kind: 'subtract-green' }
  | {
      readonly kind: 'indexing';
      readonly bits: number;
      readonly palette: Uint32Array;
      readonly width: number;
    };

function vp8lChunk(bytes: Uint8Array): Uint8Array {
  const ascii = (from: number, to: number): string =>
    String.fromCharCode(...bytes.subarray(from, to));
  if (ascii(0, 4) !== 'RIFF' || ascii(8, 12) !== 'WEBP') {
    throw new Error('not a WebP');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const type = ascii(offset, offset + 4);
    const length = view.getUint32(offset + 4, true);
    if (type === 'VP8L') {
      return bytes.subarray(offset + 8, offset + 8 + length);
    }
    if (type === 'VP8 ' || type === 'ALPH' || type === 'ANIM' || type === 'ANMF') {
      throw new Error(`a ${type.trim()} chunk: only a lossless still picture is read here`);
    }
    offset += 8 + length + (length & 1);
  }
  throw new Error('a WebP with no VP8L chunk');
}

/** The picture's size, read from its VP8L header alone. */
export function webpDimensions(bytes: Uint8Array): { width: number; height: number } {
  const reader = new BitReader(vp8lChunk(bytes));
  if (reader.read(8) !== 0x2f) throw new Error('not a VP8L bitstream');
  return { width: reader.read(14) + 1, height: reader.read(14) + 1 };
}

export function decodeWebp(bytes: Uint8Array): DecodedWebp {
  const reader = new BitReader(vp8lChunk(bytes));
  if (reader.read(8) !== 0x2f) throw new Error('not a VP8L bitstream');
  const width = reader.read(14) + 1;
  const height = reader.read(14) + 1;
  const hasAlpha = reader.read(1) === 1;
  if (reader.read(3) !== 0) throw new Error('an unknown VP8L version');
  const transforms: Transform[] = [];
  const seen = new Set<number>();
  let codedWidth = width;
  while (reader.read(1) === 1) {
    const type = reader.read(2);
    if (seen.has(type)) throw new Error('a VP8L transform sent twice');
    seen.add(type);
    if (type === 0 || type === 1) {
      const bits = reader.read(3) + 2;
      const data = readEntropyImage(
        reader,
        subsampled(codedWidth, bits),
        subsampled(height, bits),
        false,
      );
      transforms.push({ kind: type === 0 ? 'predictor' : 'colour', bits, data });
    } else if (type === 2) {
      transforms.push({ kind: 'subtract-green' });
    } else {
      const size = reader.read(8) + 1;
      const palette = readEntropyImage(reader, size, 1, false);
      for (let index = 1; index < size; index += 1) {
        palette[index] = add(palette[index] ?? 0, palette[index - 1] ?? 0);
      }
      const bits = size <= 2 ? 3 : size <= 4 ? 2 : size <= 16 ? 1 : 0;
      transforms.push({ kind: 'indexing', bits, palette, width: codedWidth });
      codedWidth = subsampled(codedWidth, bits);
    }
  }
  let pixels = readEntropyImage(reader, codedWidth, height, true);
  for (const transform of [...transforms].reverse()) {
    switch (transform.kind) {
      case 'predictor':
        undoPredictor(pixels, codedWidth, transform.bits, transform.data);
        break;
      case 'colour':
        undoColourTransform(pixels, codedWidth, transform.bits, transform.data);
        break;
      case 'subtract-green':
        undoSubtractGreen(pixels);
        break;
      case 'indexing':
        pixels = undoColourIndexing(
          pixels,
          codedWidth,
          transform.width,
          height,
          transform.bits,
          transform.palette,
        );
        codedWidth = transform.width;
        break;
    }
  }
  const rgba = new Uint8Array(width * height * 4);
  pixels.forEach((argb, at) => {
    rgba[at * 4] = channel(argb, 16);
    rgba[at * 4 + 1] = channel(argb, 8);
    rgba[at * 4 + 2] = channel(argb, 0);
    rgba[at * 4 + 3] = channel(argb, 24);
  });
  return { width, height, rgba, hasAlpha };
}
