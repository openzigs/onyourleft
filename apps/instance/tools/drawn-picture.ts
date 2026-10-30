// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **A picture of nobody that a real model can open** (#1106): coloured shapes
 * on a plain ground, drawn here and encoded here as a baseline JPEG.
 *
 * `side-picture-round-trip-run.ts` §`syntheticPicture` is a JPEG's opening
 * and filler: right for a scripted model, which never decodes it, and wrong
 * for a real one, which refuses bytes it cannot decode — and a refusal that
 * says *"image"* is what `src/analysis/model.ts` once read as *"takes no
 * pictures"*. So a run against a real model sends this instead.
 *
 * - **It is of nobody and of nowhere.** A disc, a rectangle and a triangle.
 *   No photograph is read, and no image file is committed: the picture is
 *   made when it is asked for.
 * - **It carries no metadata.** The segments written are SOI, APP0/JFIF, DQT,
 *   SOF0, DHT, SOS and EOI, and nothing else: no APP1, so no Exif and no XMP,
 *   and no comment.
 * - **The encoder is this file's own**, written from the JPEG standard's
 *   baseline process (ITU-T T.81): 8x8 DCT, the standard's example
 *   quantisation table (Annex K.1) and Huffman tables (Annex K.3), no
 *   subsampling, and one table of each kind shared by the three components.
 *   The repository has no JPEG dependency and this adds none.
 *
 * ⚠️ **Not an encoder for anything else.** It is slow, it does not subsample,
 * and its only test of correctness beyond its segments is that a decoder
 * opened what it made (spike 0025 §8).
 */

/** The picture's size: a multiple of 8 each way, so no block is padded. */
export const DRAWN_PICTURE_WIDTH = 320;
export const DRAWN_PICTURE_HEIGHT = 240;

/** Annex K.1's luminance table, in the order a block is stored (row by row). */
const QUANTISATION: readonly number[] = [
  16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56,
  14, 17, 22, 29, 51, 87, 80, 62, 18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113,
  92, 49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99,
];

/** For each place in zigzag order, which place of the block it is. */
const ZIGZAG: readonly number[] = [
  0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20,
  13, 6, 7, 14, 21, 28, 35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59, 52,
  45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63,
];

/** Annex K.3.1: how many DC codes there are of each length, then their values. */
const DC_COUNTS: readonly number[] = [0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0];
const DC_VALUES: readonly number[] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

/** Annex K.3.2: the same for the AC codes. */
const AC_COUNTS: readonly number[] = [0, 2, 1, 3, 3, 2, 4, 3, 5, 5, 4, 4, 0, 0, 1, 0x7d];
const AC_VALUES: readonly number[] = [
  0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06, 0x13, 0x51, 0x61, 0x07,
  0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xa1, 0x08, 0x23, 0x42, 0xb1, 0xc1, 0x15, 0x52, 0xd1, 0xf0,
  0x24, 0x33, 0x62, 0x72, 0x82, 0x09, 0x0a, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x25, 0x26, 0x27, 0x28,
  0x29, 0x2a, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49,
  0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69,
  0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89,
  0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7,
  0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5,
  0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe1, 0xe2,
  0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8,
  0xf9, 0xfa,
];

interface Code {
  readonly bits: number;
  readonly length: number;
}

/** The code of each value, built the way the standard's Annex C does. */
function codesOf(counts: readonly number[], values: readonly number[]): Map<number, Code> {
  const codes = new Map<number, Code>();
  let code = 0;
  let next = 0;
  counts.forEach((count, index) => {
    for (let each = 0; each < count; each += 1) {
      codes.set(values[next] ?? 0, { bits: code, length: index + 1 });
      next += 1;
      code += 1;
    }
    code <<= 1;
  });
  return codes;
}

/** The scan's bits, with a zero byte stuffed after every 0xff as the standard asks. */
class BitWriter {
  readonly bytes: number[] = [];
  #held = 0;
  #count = 0;

  write(bits: number, length: number): void {
    for (let shift = length - 1; shift >= 0; shift -= 1) {
      this.#held = (this.#held << 1) | ((bits >> shift) & 1);
      this.#count += 1;
      if (this.#count === 8) this.#flush();
    }
  }

  /** Pad the last byte with ones. */
  end(): void {
    while (this.#count !== 0) this.write(1, 1);
  }

  #flush(): void {
    this.bytes.push(this.#held);
    if (this.#held === 0xff) this.bytes.push(0x00);
    this.#held = 0;
    this.#count = 0;
  }
}

/** How many bits `value`'s magnitude takes, and the bits that follow its code. */
function magnitude(value: number): Code {
  const size = value === 0 ? 0 : 32 - Math.clz32(Math.abs(value));
  return { bits: value < 0 ? value + (1 << size) - 1 : value, length: size };
}

/** One 8x8 block of samples (already level-shifted), transformed and quantised, in zigzag order. */
function quantised(block: readonly number[], cosines: readonly number[]): number[] {
  const transformed = new Array<number>(64).fill(0);
  for (let v = 0; v < 8; v += 1) {
    for (let u = 0; u < 8; u += 1) {
      let sum = 0;
      for (let y = 0; y < 8; y += 1) {
        for (let x = 0; x < 8; x += 1) {
          sum += (block[y * 8 + x] ?? 0) * (cosines[x * 8 + u] ?? 0) * (cosines[y * 8 + v] ?? 0);
        }
      }
      const scale = (u === 0 ? Math.SQRT1_2 : 1) * (v === 0 ? Math.SQRT1_2 : 1) * 0.25;
      transformed[v * 8 + u] = Math.round((sum * scale) / (QUANTISATION[v * 8 + u] ?? 1));
    }
  }
  return ZIGZAG.map((place) => transformed[place] ?? 0);
}

type Colour = readonly [number, number, number];

const GROUND: Colour = [214, 222, 230];
const DISC: Colour = [200, 40, 40];
const RECTANGLE: Colour = [40, 70, 190];
const TRIANGLE: Colour = [30, 150, 70];

/**
 * The colour at one point: a red disc, a blue rectangle and a green triangle
 * on a pale ground. `variant` moves the disc, so no two variants are the same
 * bytes while every one is the same scene.
 */
function colourAt(x: number, y: number, variant: number): Colour {
  const discX = 70 + (variant % 16) * 2;
  if ((x - discX) ** 2 + (y - 80) ** 2 <= 45 ** 2) return DISC;
  if (x >= 170 && x < 280 && y >= 40 && y < 110) return RECTANGLE;
  // A triangle with its point up: (160, 130), (100, 215), (220, 215).
  if (y >= 130 && y < 215 && Math.abs(x - 160) <= ((y - 130) * 60) / 85) return TRIANGLE;
  return GROUND;
}

function segment(marker: number, body: readonly number[]): number[] {
  const length = body.length + 2;
  return [0xff, marker, length >> 8, length & 0xff, ...body];
}

/**
 * The drawn picture as a JPEG: {@link DRAWN_PICTURE_WIDTH} by
 * {@link DRAWN_PICTURE_HEIGHT}, a few kilobytes, the same bytes for the same
 * `variant`.
 */
export function drawnPicture(variant: number): Uint8Array {
  const width = DRAWN_PICTURE_WIDTH;
  const height = DRAWN_PICTURE_HEIGHT;
  const cosines = Array.from({ length: 64 }, (_, index) =>
    Math.cos(((2 * Math.floor(index / 8) + 1) * (index % 8) * Math.PI) / 16),
  );
  const dc = codesOf(DC_COUNTS, DC_VALUES);
  const ac = codesOf(AC_COUNTS, AC_VALUES);
  const scan = new BitWriter();
  const previous = [0, 0, 0];

  const put = (codes: Map<number, Code>, value: number): void => {
    const code = codes.get(value);
    if (code === undefined) throw new Error('A value with no code: the tables are wrong.');
    scan.write(code.bits, code.length);
  };

  for (let blockY = 0; blockY < height; blockY += 8) {
    for (let blockX = 0; blockX < width; blockX += 8) {
      const samples: number[][] = [[], [], []];
      for (let y = 0; y < 8; y += 1) {
        for (let x = 0; x < 8; x += 1) {
          const [red, green, blue] = colourAt(blockX + x, blockY + y, variant);
          // JFIF's conversion, level-shifted by 128 as the transform expects.
          samples[0]?.push(0.299 * red + 0.587 * green + 0.114 * blue - 128);
          samples[1]?.push(-0.168736 * red - 0.331264 * green + 0.5 * blue);
          samples[2]?.push(0.5 * red - 0.418688 * green - 0.081312 * blue);
        }
      }
      samples.forEach((component, index) => {
        const block = quantised(component, cosines);
        const difference = (block[0] ?? 0) - (previous[index] ?? 0);
        previous[index] = block[0] ?? 0;
        const size = magnitude(difference);
        put(dc, size.length);
        scan.write(size.bits, size.length);
        let zeros = 0;
        for (let place = 1; place < 64; place += 1) {
          const value = block[place] ?? 0;
          if (value === 0) {
            zeros += 1;
            continue;
          }
          for (; zeros > 15; zeros -= 16) put(ac, 0xf0);
          const bits = magnitude(value);
          put(ac, (zeros << 4) | bits.length);
          scan.write(bits.bits, bits.length);
          zeros = 0;
        }
        if (zeros > 0) put(ac, 0x00);
      });
    }
  }
  scan.end();

  const component = (id: number): number[] => [id, 0x11, 0];
  return Uint8Array.from([
    0xff,
    0xd8,
    // APP0: "JFIF\0", version 1.1, no density unit, 1:1, no thumbnail.
    ...segment(
      0xe0,
      [0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0, 0],
    ),
    ...segment(0xdb, [0x00, ...ZIGZAG.map((place) => QUANTISATION[place] ?? 1)]),
    ...segment(0xc0, [
      8,
      height >> 8,
      height & 0xff,
      width >> 8,
      width & 0xff,
      3,
      ...component(1),
      ...component(2),
      ...component(3),
    ]),
    ...segment(0xc4, [0x00, ...DC_COUNTS, ...DC_VALUES]),
    ...segment(0xc4, [0x10, ...AC_COUNTS, ...AC_VALUES]),
    ...segment(0xda, [3, 1, 0x00, 2, 0x00, 3, 0x00, 0, 63, 0]),
    ...scan.bytes,
    0xff,
    0xd9,
  ]);
}
