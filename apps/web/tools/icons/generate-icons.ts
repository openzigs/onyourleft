// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The web app manifest's icons, drawn from arithmetic (#405).
 *
 * ## Why a generator rather than an artwork file somebody drew
 *
 * Three constraints meet here and only one shape satisfies all of them.
 *
 * 1. **`ASSET004` fails closed and `AGPL-3.0-or-later` is on none of its three
 *    lists.** A PNG this repository authors, committed under `apps/`, is a red
 *    build unless it is declared as something the gate admits — so
 *    [ADR 0024](../../../../docs/adr/0024-offline-and-caching-posture.md) D-5
 *    dedicates these to `CC0-1.0`, which is already admitted under `apps/` and
 *    is a dedication this project is entitled to make of its own work.
 * 2. **ADR 0009 forbids deriving an appearance from another product**, so
 *    nothing here may be traced, downloaded or recalled from a competitor's
 *    launcher. A mark defined by four numbers cannot accidentally be.
 * 3. **The bytes have to be committed rather than generated at build time.**
 *    #405 records why: a file generated into the tree under `apps/` would need
 *    an `.spdx-exempt` entry, and §3a permits exactly one reason for one —
 *    *"verbatim output of a third-party generator, whose own licence notice we
 *    reproduce instead"* — which artwork this project chose is not.
 *
 * So the bytes are committed and this file is their **provenance**, named in
 * `ASSETS.toml`'s `source` column. `generate-icons.test.ts` is what keeps the
 * two from drifting: it redraws each icon and compares the result with the
 * committed file's own decoded pixels.
 *
 * ⚠️ **It compares PIXELS rather than bytes, and that is deliberate.** A
 * byte comparison would pin zlib's output as well as the drawing, and zlib's
 * compressed form is not guaranteed stable across versions of the library — so
 * a contributor on a different Node 24 patch could see a red build about an
 * image that is identical. Inflating the committed `IDAT` and comparing
 * scanlines asks the question actually worth asking.
 *
 * ## The mark
 *
 * Two chevrons pointing left, in `accent` on `accentInk` — the call a rider
 * makes passing somebody, which is this project's name. Every number below is
 * in unit coordinates so the same drawing produces every size, and the maskable
 * variant is the same drawing scaled to 80% about the centre, which is the safe
 * zone Android's adaptive icons mask to.
 *
 * Run it with `pnpm --filter @onyourleft/web run icons:generate`.
 */

import { deflateSync, inflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * The mark, in unit coordinates with y running down.
 *
 * Two chevrons: each is a polyline from its back at the top, to its tip at the
 * vertical centre, to its back at the bottom, stroked with round joins. The
 * numbers are chosen so the drawn extent is symmetric about (0.5, 0.5) — x runs
 * 0.220 to 0.780 and y runs 0.225 to 0.775 — which is what stops the mark
 * looking off-centre once a launcher crops it to a circle.
 */
const CHEVRON_TIP_X = [0.275, 0.525] as const;
const CHEVRON_DEPTH = 0.2;
const CHEVRON_TOP_Y = 0.28;
const CHEVRON_BOTTOM_Y = 0.72;
const STROKE_HALF_WIDTH = 0.055;

/** The fraction of the box the maskable variant's drawing occupies. */
const MASKABLE_SCALE = 0.8;

/** A colour as three 0–255 channels. */
export interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

/**
 * The two colours, as the design tokens spell them.
 *
 * ⚠️ **Written out rather than imported from `design/tokens.ts`.** This file is
 * authoring-time code under `tools/` and the tokens module is client source; an
 * import would put a build-time generator in the shipped module graph's
 * neighbourhood for no benefit. `generate-icons.test.ts` asserts the two agree,
 * which is the `theme.a11y.test.ts` precedent applied to a second artefact.
 */
export const ICON_FOREGROUND = '#ffffff';
export const ICON_BACKGROUND = '#0b5c55';

export function parseHex(hex: string): Rgb {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/.exec(hex);
  if (match === null) {
    throw new Error(`a colour must be six-digit hex, and this is ${hex}`);
  }
  return {
    r: Number.parseInt(match[1] ?? '', 16),
    g: Number.parseInt(match[2] ?? '', 16),
    b: Number.parseInt(match[3] ?? '', 16),
  };
}

/** The shortest distance from a point to a line segment, all in unit coordinates. */
function distanceToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  // A degenerate segment is a point, and the distance to a point is well
  // defined — so this is a guard against dividing by zero rather than a case.
  const t =
    lengthSquared === 0
      ? 0
      : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

/** The shortest distance from a point to the mark's stroked centre lines. */
function distanceToMark(px: number, py: number): number {
  let best = Number.POSITIVE_INFINITY;
  for (const tip of CHEVRON_TIP_X) {
    const back = tip + CHEVRON_DEPTH;
    best = Math.min(best, distanceToSegment(px, py, back, CHEVRON_TOP_Y, tip, 0.5));
    best = Math.min(best, distanceToSegment(px, py, tip, 0.5, back, CHEVRON_BOTTOM_Y));
  }
  return best;
}

export interface IconSpec {
  /** The file, relative to `apps/web/public/`. */
  readonly file: string;
  readonly size: number;
  /** `true` for the variant a launcher may crop to any shape. */
  readonly maskable: boolean;
}

/**
 * Every icon this repository commits.
 *
 * 192 and 512 because Chrome's install criteria name exactly those two sizes,
 * and a third at 512 with `purpose: "maskable"` because Android crops an
 * adaptive icon and a mark drawn to the edge loses its corners. A single entry
 * carrying both purposes would have to satisfy both, and the safe zone is
 * enough smaller that the result reads as a small mark in a large field
 * everywhere it is not cropped.
 */
export const ICON_SPECS: readonly IconSpec[] = [
  { file: 'icon-192.png', size: 192, maskable: false },
  { file: 'icon-512.png', size: 512, maskable: false },
  { file: 'icon-maskable-512.png', size: 512, maskable: true },
];

/**
 * Draw one icon as raw 8-bit RGB, row-major, with no filter bytes.
 *
 * Antialiased by coverage rather than by supersampling: the distance to the
 * stroke's centre line is known exactly, so the fraction of a pixel the stroke
 * covers is a smooth function of it and needs no samples. That also makes the
 * output a pure function of the size, which is what the reproduction test
 * rests on.
 */
export function drawIcon(spec: IconSpec): Uint8Array {
  const foreground = parseHex(ICON_FOREGROUND);
  const background = parseHex(ICON_BACKGROUND);
  const scale = spec.maskable ? MASKABLE_SCALE : 1;
  const pixel = 1 / spec.size;
  const pixels = new Uint8Array(spec.size * spec.size * 3);
  for (let y = 0; y < spec.size; y += 1) {
    for (let x = 0; x < spec.size; x += 1) {
      // The pixel's centre, mapped back through the maskable scale so one
      // drawing serves both variants.
      const ux = ((x + 0.5) * pixel - 0.5) / scale + 0.5;
      const uy = ((y + 0.5) * pixel - 0.5) / scale + 0.5;
      const distance = distanceToMark(ux, uy);
      const coverage = Math.max(
        0,
        Math.min(1, (STROKE_HALF_WIDTH - distance) / (pixel / scale) + 0.5),
      );
      const offset = (y * spec.size + x) * 3;
      pixels[offset] = Math.round(background.r + (foreground.r - background.r) * coverage);
      pixels[offset + 1] = Math.round(background.g + (foreground.g - background.g) * coverage);
      pixels[offset + 2] = Math.round(background.b + (foreground.b - background.b) * coverage);
    }
  }
  return pixels;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) === 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) {
    c = (CRC_TABLE[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const body = new Uint8Array(4 + data.length);
  for (let i = 0; i < 4; i += 1) {
    body[i] = type.charCodeAt(i);
  }
  body.set(data, 4);
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(body, 4);
  view.setUint32(8 + data.length, crc32(body));
  return out;
}

/** The eight bytes every PNG opens with. */
const PNG_SIGNATURE = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);

/**
 * Wrap raw RGB in a PNG.
 *
 * Colour type 2 (truecolour), bit depth 8, no interlacing, and filter type 0 on
 * every scanline — the simplest encoding the format has, because these images
 * are a few flat colours and a filter would buy almost nothing.
 */
export function encodePng(size: number, pixels: Uint8Array): Uint8Array {
  const header = new Uint8Array(13);
  const headerView = new DataView(header.buffer);
  headerView.setUint32(0, size);
  headerView.setUint32(4, size);
  header[8] = 8; // bit depth
  header[9] = 2; // colour type: truecolour
  header[10] = 0; // compression: deflate
  header[11] = 0; // filter: adaptive
  header[12] = 0; // interlace: none

  const stride = size * 3;
  const raw = new Uint8Array(size * (stride + 1));
  for (let y = 0; y < size; y += 1) {
    raw[y * (stride + 1)] = 0;
    raw.set(pixels.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }

  const idat = new Uint8Array(deflateSync(raw, { level: 9 }));
  const chunks = [
    PNG_SIGNATURE,
    chunk('IHDR', header),
    chunk('IDAT', idat),
    chunk('IEND', new Uint8Array(0)),
  ];
  const total = chunks.reduce((sum, part) => sum + part.length, 0);
  const png = new Uint8Array(total);
  let at = 0;
  for (const part of chunks) {
    png.set(part, at);
    at += part.length;
  }
  return png;
}

/**
 * Pull the raw scanlines back out of a PNG this module wrote.
 *
 * Only what the reproduction test needs, and it refuses anything else: a file
 * with a different bit depth, colour type or interlace is a file this module
 * did not produce, and reading it as though it had is how a comparison passes
 * over the wrong thing.
 */
export function decodePng(png: Uint8Array): { size: number; pixels: Uint8Array } {
  for (const [index, byte] of PNG_SIGNATURE.entries()) {
    if (png[index] !== byte) {
      throw new Error('not a PNG: the eight-byte signature does not match');
    }
  }
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let at = PNG_SIGNATURE.length;
  let size = 0;
  const idat: Uint8Array[] = [];
  while (at + 8 <= png.length) {
    const length = view.getUint32(at);
    const type = String.fromCharCode(...png.subarray(at + 4, at + 8));
    const data = png.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') {
      const width = view.getUint32(at + 8);
      const height = view.getUint32(at + 12);
      if (width !== height) {
        throw new Error(`expected a square icon, and this is ${width}x${height}`);
      }
      if (data[8] !== 8 || data[9] !== 2 || data[12] !== 0) {
        throw new Error('expected 8-bit truecolour with no interlacing');
      }
      size = width;
    }
    if (type === 'IDAT') {
      idat.push(Uint8Array.from(data));
    }
    at += 12 + length;
  }
  if (size === 0) {
    throw new Error('the PNG carries no IHDR');
  }
  const joined = new Uint8Array(idat.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of idat) {
    joined.set(part, offset);
    offset += part.length;
  }
  const raw = new Uint8Array(inflateSync(joined));
  const stride = size * 3;
  const pixels = new Uint8Array(size * stride);
  for (let y = 0; y < size; y += 1) {
    if (raw[y * (stride + 1)] !== 0) {
      throw new Error(`scanline ${String(y)} uses a filter this decoder does not implement`);
    }
    pixels.set(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), y * stride);
  }
  return { size, pixels };
}

/** Where the committed icons live. */
export const PUBLIC_DIRECTORY = new URL('../../public/', import.meta.url);

function main(): void {
  for (const spec of ICON_SPECS) {
    const png = encodePng(spec.size, drawIcon(spec));
    const path = fileURLToPath(new URL(spec.file, PUBLIC_DIRECTORY));
    writeFileSync(path, png);
    console.log(`${spec.file}: ${String(png.length)} bytes`);
  }
}

// Run only when this file is the program, never when a test imports it.
if (process.argv[1]?.endsWith('generate-icons.ts') === true) {
  main();
}
