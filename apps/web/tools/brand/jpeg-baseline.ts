// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A baseline JPEG decoder — #966, so the game's wordmark is made from the
 * owner's committed source by arithmetic on the pinned Node and nothing else.
 *
 * ## Why one is written here rather than installed
 *
 * The wordmark's source is a JPEG, and nothing in this workspace decodes one:
 * a dependency would be a licence check, a notices entry and a closure change
 * (§4g) for one authoring-time read, and a native tool (a libjpeg build, an
 * image editor) would decode differently from one version to the next. A
 * decoder this repository owns decodes the same bytes to the same pixels on
 * every machine that runs the pinned Node, which is what lets
 * `game-wordmark.test.ts` re-make the committed texture inside `pnpm run test`
 * — the move `tools/glyphs/` makes with its own TrueType reader.
 *
 * ## What it reads, and what it refuses
 *
 * ITU-T T.81 (the JPEG standard), **baseline sequential only** — `SOF0`,
 * eight-bit samples, Huffman coding — with any sampling factors, one or three
 * components, and restart intervals. Progressive, arithmetic-coded,
 * lossless and twelve-bit files are refused by name, never misread: this file
 * reads exactly the one encoding the source uses, and a source that changed
 * encoding is a source somebody has to look at.
 *
 * Its choices, each the simplest the standard permits, are part of what the
 * committed texture IS — changing one changes the pixels and turns
 * `game-wordmark.test.ts` red:
 *
 * - the inverse DCT is the separable floating-point one of T.81 §A.3.3,
 *   computed in doubles from a table of cosines;
 * - subsampled chroma is replicated (nearest neighbour), not interpolated;
 * - YCbCr becomes RGB by JFIF's equations, rounded half up and clamped.
 *
 * Authoring-time code: in the typecheck and the test run, never in the
 * product, the shape `tools/icons/` and `tools/glyphs/` have.
 */

/** A decoded picture: `width × height` pixels of RGB, row-major from the top. */
export interface DecodedJpeg {
  readonly width: number;
  readonly height: number;
  readonly rgb: Uint8Array;
}

/** One Huffman table, as a lookup from (length, code) to symbol. */
interface HuffmanTable {
  /** For each code length 1–16: the first code of that length, or −1 if none. */
  readonly first: Int32Array;
  /** For each code length: the index into `symbols` of its first code. */
  readonly offset: Int32Array;
  /** For each code length: how many codes have it. */
  readonly count: Int32Array;
  readonly symbols: Uint8Array;
}

interface Component {
  readonly id: number;
  readonly h: number;
  readonly v: number;
  readonly quantisation: number;
  dcTable: number;
  acTable: number;
  /** Blocks across and down, padded to whole MCUs. */
  blocksAcross: number;
  blocksDown: number;
  /** Decoded samples, `blocksAcross·8 × blocksDown·8`. */
  samples: Uint8Array;
  predictor: number;
}

/** The order T.81 Figure A.6 stores a block's 64 coefficients in. */
const ZIGZAG = Uint8Array.from([
  0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20,
  13, 6, 7, 14, 21, 28, 35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59, 52,
  45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63,
]);

/** `C(u)·cos((2x+1)uπ/16) / 2`, by `[x·8 + u]` — T.81 §A.3.3's kernel. */
const IDCT = (() => {
  const table = new Float64Array(64);
  for (let x = 0; x < 8; x += 1) {
    for (let u = 0; u < 8; u += 1) {
      const c = u === 0 ? Math.SQRT1_2 : 1;
      table[x * 8 + u] = (c * Math.cos(((2 * x + 1) * u * Math.PI) / 16)) / 2;
    }
  }
  return table;
})();

/** Markers this decoder refuses, by name. */
const REFUSED_FRAMES: Readonly<Record<number, string>> = {
  0xc1: 'extended sequential',
  0xc2: 'progressive',
  0xc3: 'lossless',
  0xc5: 'differential sequential',
  0xc6: 'differential progressive',
  0xc7: 'differential lossless',
  0xc9: 'arithmetic-coded',
  0xca: 'arithmetic-coded progressive',
  0xcb: 'arithmetic-coded lossless',
  0xcd: 'arithmetic-coded differential',
  0xce: 'arithmetic-coded differential progressive',
  0xcf: 'arithmetic-coded differential lossless',
};

/** Decodes a baseline JPEG. Throws, naming what it found, on anything else. */
export function decodeBaselineJpeg(bytes: Uint8Array): DecodedJpeg {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error('not a JPEG: no start-of-image');
  const quantisation: (Uint16Array | undefined)[] = [];
  const dcTables: (HuffmanTable | undefined)[] = [];
  const acTables: (HuffmanTable | undefined)[] = [];
  let components: Component[] = [];
  let width = 0;
  let height = 0;
  let restartInterval = 0;
  let at = 2;
  const u16 = (offset: number): number => ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0);
  while (at < bytes.length) {
    if (bytes[at] !== 0xff) throw new Error(`a JPEG marker was expected at byte ${String(at)}`);
    const marker = bytes[at + 1] as number;
    at += 2;
    if (marker === 0xd9) break;
    if (marker === 0xff) {
      at -= 1;
      continue;
    }
    const length = u16(at);
    if (at + length > bytes.length) throw new Error('a JPEG segment runs past the end of the file');
    const body = at + 2;
    const end = at + length;
    const refused = REFUSED_FRAMES[marker];
    if (refused !== undefined) throw new Error(`a ${refused} JPEG; only baseline is decoded`);
    if (marker === 0xdb) {
      let read = body;
      while (read < end) {
        const precision = (bytes[read] as number) >> 4;
        const id = (bytes[read] as number) & 15;
        read += 1;
        const table = new Uint16Array(64);
        for (let index = 0; index < 64; index += 1) {
          table[ZIGZAG[index] as number] = precision === 0 ? (bytes[read] as number) : u16(read);
          read += precision === 0 ? 1 : 2;
        }
        quantisation[id] = table;
      }
    } else if (marker === 0xc4) {
      let read = body;
      while (read < end) {
        const kind = (bytes[read] as number) >> 4;
        const id = (bytes[read] as number) & 15;
        read += 1;
        const count = new Int32Array(17);
        let total = 0;
        for (let length = 1; length <= 16; length += 1) {
          count[length] = bytes[read + length - 1] as number;
          total += count[length] as number;
        }
        read += 16;
        const symbols = bytes.slice(read, read + total);
        read += total;
        (kind === 0 ? dcTables : acTables)[id] = huffmanTable(count, symbols);
      }
    } else if (marker === 0xc0) {
      if (bytes[body] !== 8) throw new Error('a JPEG of other than eight-bit samples');
      height = u16(body + 1);
      width = u16(body + 3);
      const count = bytes[body + 5] as number;
      if (count !== 1 && count !== 3) throw new Error(`a JPEG of ${String(count)} components`);
      components = [];
      for (let index = 0; index < count; index += 1) {
        const offset = body + 6 + index * 3;
        components.push({
          id: bytes[offset] as number,
          h: (bytes[offset + 1] as number) >> 4,
          v: (bytes[offset + 1] as number) & 15,
          quantisation: bytes[offset + 2] as number,
          dcTable: 0,
          acTable: 0,
          blocksAcross: 0,
          blocksDown: 0,
          samples: new Uint8Array(),
          predictor: 0,
        });
      }
    } else if (marker === 0xdd) {
      restartInterval = u16(body);
    } else if (marker === 0xda) {
      if (components.length === 0) throw new Error('a JPEG scan before its frame header');
      const inScan = bytes[body] as number;
      if (inScan !== components.length) throw new Error('a JPEG whose scans are not interleaved');
      for (let index = 0; index < inScan; index += 1) {
        const id = bytes[body + 1 + index * 2] as number;
        const tables = bytes[body + 2 + index * 2] as number;
        const component = components.find((each) => each.id === id);
        if (component === undefined) throw new Error(`a JPEG scan names component ${String(id)}`);
        component.dcTable = tables >> 4;
        component.acTable = tables & 15;
      }
      at = decodeScan(
        bytes,
        end,
        components,
        width,
        height,
        restartInterval,
        quantisation,
        dcTables,
        acTables,
      );
      continue;
    }
    at = end;
  }
  if (width === 0 || components.length === 0) throw new Error('a JPEG with no frame');
  return { width, height, rgb: toRgb(components, width, height) };
}

function huffmanTable(count: Int32Array, symbols: Uint8Array): HuffmanTable {
  const first = new Int32Array(17).fill(-1);
  const offset = new Int32Array(17);
  let code = 0;
  let index = 0;
  for (let length = 1; length <= 16; length += 1) {
    const many = count[length] as number;
    if (many > 0) {
      first[length] = code;
      offset[length] = index;
    }
    code = (code + many) << 1;
    index += many;
  }
  return { first, offset, count, symbols };
}

/** Decodes one interleaved scan into each component's samples; returns where it ended. */
function decodeScan(
  bytes: Uint8Array,
  start: number,
  components: Component[],
  width: number,
  height: number,
  restartInterval: number,
  quantisation: readonly (Uint16Array | undefined)[],
  dcTables: readonly (HuffmanTable | undefined)[],
  acTables: readonly (HuffmanTable | undefined)[],
): number {
  const hMax = Math.max(...components.map((each) => each.h));
  const vMax = Math.max(...components.map((each) => each.v));
  const mcusAcross = Math.ceil(width / (8 * hMax));
  const mcusDown = Math.ceil(height / (8 * vMax));
  for (const component of components) {
    component.blocksAcross = mcusAcross * component.h;
    component.blocksDown = mcusDown * component.v;
    component.samples = new Uint8Array(component.blocksAcross * component.blocksDown * 64);
    component.predictor = 0;
  }
  let at = start;
  let bitBuffer = 0;
  let bitCount = 0;
  const bit = (): number => {
    if (bitCount === 0) {
      if (at >= bytes.length) throw new Error('a JPEG scan runs past the end of the file');
      const byte = bytes[at] as number;
      at += 1;
      if (byte === 0xff) {
        const next = bytes[at] as number;
        if (next === 0) at += 1;
        else throw new Error(`a JPEG marker 0xff${next.toString(16)} inside entropy-coded data`);
      }
      bitBuffer = byte;
      bitCount = 8;
    }
    bitCount -= 1;
    return (bitBuffer >> bitCount) & 1;
  };
  const bits = (count: number): number => {
    let value = 0;
    for (let index = 0; index < count; index += 1) value = (value << 1) | bit();
    return value;
  };
  const decodeSymbol = (table: HuffmanTable): number => {
    let code = 0;
    for (let length = 1; length <= 16; length += 1) {
      code = (code << 1) | bit();
      const first = table.first[length] as number;
      if (first >= 0 && code - first < (table.count[length] as number)) {
        return table.symbols[(table.offset[length] as number) + code - first] as number;
      }
    }
    throw new Error('a JPEG Huffman code longer than sixteen bits');
  };
  /** T.81 F.2.2.1's EXTEND. */
  const extend = (value: number, size: number): number =>
    size === 0 ? 0 : value < 1 << (size - 1) ? value - (1 << size) + 1 : value;
  const coefficients = new Float64Array(64);
  const rows = new Float64Array(64);
  const total = mcusAcross * mcusDown;
  for (let mcu = 0; mcu < total; mcu += 1) {
    if (restartInterval > 0 && mcu > 0 && mcu % restartInterval === 0) {
      bitCount = 0;
      if (bytes[at] !== 0xff || ((bytes[at + 1] as number) & 0xf8) !== 0xd0) {
        throw new Error('a JPEG restart marker was expected');
      }
      at += 2;
      for (const component of components) component.predictor = 0;
    }
    const mcuX = mcu % mcusAcross;
    const mcuY = Math.floor(mcu / mcusAcross);
    for (const component of components) {
      const table = quantisation[component.quantisation];
      const dc = dcTables[component.dcTable];
      const ac = acTables[component.acTable];
      if (table === undefined || dc === undefined || ac === undefined) {
        throw new Error('a JPEG scan names a table it never defined');
      }
      for (let blockY = 0; blockY < component.v; blockY += 1) {
        for (let blockX = 0; blockX < component.h; blockX += 1) {
          coefficients.fill(0);
          const size = decodeSymbol(dc);
          component.predictor += extend(bits(size), size);
          coefficients[0] = component.predictor * (table[0] as number);
          for (let index = 1; index < 64;) {
            const symbol = decodeSymbol(ac);
            const run = symbol >> 4;
            const magnitude = symbol & 15;
            if (magnitude === 0) {
              if (run === 15) {
                index += 16;
                continue;
              }
              break;
            }
            index += run;
            if (index > 63) throw new Error('a JPEG block holds more than 64 coefficients');
            const position = ZIGZAG[index] as number;
            coefficients[position] =
              extend(bits(magnitude), magnitude) * (table[position] as number);
            index += 1;
          }
          inverseDct(
            coefficients,
            rows,
            component,
            (mcuX * component.h + blockX) * 8,
            (mcuY * component.v + blockY) * 8,
          );
        }
      }
    }
  }
  // Past the scan's last byte and any padding, to the next marker.
  while (at < bytes.length && !(bytes[at] === 0xff && bytes[at + 1] !== 0)) at += 1;
  return at;
}

/** The separable inverse DCT of one block, level-shifted and clamped into `component.samples`. */
function inverseDct(
  coefficients: Float64Array,
  rows: Float64Array,
  component: Component,
  left: number,
  top: number,
): void {
  // Columns first: rows[y·8 + u] = Σv C(v)cos(…)·F[v·8 + u].
  for (let u = 0; u < 8; u += 1) {
    for (let y = 0; y < 8; y += 1) {
      let sum = 0;
      for (let v = 0; v < 8; v += 1) {
        sum += (IDCT[y * 8 + v] as number) * (coefficients[v * 8 + u] as number);
      }
      rows[y * 8 + u] = sum;
    }
  }
  const stride = component.blocksAcross * 8;
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      let sum = 0;
      for (let u = 0; u < 8; u += 1) {
        sum += (IDCT[x * 8 + u] as number) * (rows[y * 8 + u] as number);
      }
      component.samples[(top + y) * stride + left + x] = clampByte(Math.round(sum + 128));
    }
  }
}

function clampByte(value: number): number {
  return value < 0 ? 0 : value > 255 ? 255 : value;
}

/** The components, upsampled by replication, as RGB by JFIF's equations. */
function toRgb(components: readonly Component[], width: number, height: number): Uint8Array {
  const hMax = Math.max(...components.map((each) => each.h));
  const vMax = Math.max(...components.map((each) => each.v));
  const rgb = new Uint8Array(width * height * 3);
  const sample = (component: Component, x: number, y: number): number => {
    const sx = Math.floor((x * component.h) / hMax);
    const sy = Math.floor((y * component.v) / vMax);
    return component.samples[sy * component.blocksAcross * 8 + sx] as number;
  };
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const out = (y * width + x) * 3;
      const luma = sample(components[0] as Component, x, y);
      if (components.length === 1) {
        rgb[out] = luma;
        rgb[out + 1] = luma;
        rgb[out + 2] = luma;
        continue;
      }
      const cb = sample(components[1] as Component, x, y) - 128;
      const cr = sample(components[2] as Component, x, y) - 128;
      rgb[out] = clampByte(Math.round(luma + 1.402 * cr));
      rgb[out + 1] = clampByte(Math.round(luma - 0.344136 * cb - 0.714136 * cr));
      rgb[out + 2] = clampByte(Math.round(luma + 1.772 * cb));
    }
  }
  return rgb;
}
