// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The house kit's two-chevron mark, drawn from arithmetic (#405, #623).
 *
 * ⚠️ **This file used to draw the web app manifest's icons, and since #965 it
 * does not.** A reviewer who remembers `icons:generate` writing
 * `public/icon-*.png` is reading the old file. The owner supplied the
 * project's own logo and icon (CC-BY-4.0, `ASSETS.toml`), and every app icon is
 * now cut from those sheets by `tools/brand/derive_brand.py`. The two
 * constraints this file was written against both changed: ADR 0024 D-5
 * dedicated the drawn icons `CC0-1.0` because `ASSET004` admitted nothing else
 * for a picture this repository made, and ADR 0023 has since admitted
 * `CC-BY-4.0` under `apps/`; and ADR 0009's worry — an appearance derived from
 * another product — does not arise for art the owner made for this one. ADR
 * 0024 carries a dated amendment saying so.
 *
 * What is left is the MARK: two chevrons pointing left, the call a rider makes
 * passing somebody. The realistic rider's jersey wears it (#623,
 * `tools/realistic/process-assets.ts` hands {@link drawMark}'s pixels to
 * `process_rider.py`), and whether the kit moves to the owner's new mark is the
 * owner's call (#968), so the drawing stays exactly as it was: the kit's bytes,
 * which `realistic:process --check` reproduces, depend on it, and
 * `generate-icons.test.ts` pins its pixels to `main`'s before #965.
 */

import { deflateSync, inflateSync } from 'node:zlib';

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

/**
 * How much of a pixel the mark covers, 0 to 1, at a point in unit coordinates
 * (y running down), for a pixel `pixel` units wide — the coverage
 * {@link drawMark} writes.
 */
function markCoverage(ux: number, uy: number, pixel: number): number {
  return Math.max(0, Math.min(1, (STROKE_HALF_WIDTH - distanceToMark(ux, uy)) / pixel + 0.5));
}

/**
 * The mark alone, as a square of 8-bit RGB whose every channel is its
 * coverage: white where the chevrons are, black where they are not, top row
 * first.
 *
 * #623: the house kit's one mark. `tools/realistic/process-assets.ts` writes
 * this for `process_rider.py`, which lays it on the jersey's back — so the
 * kit's chevrons are these chevrons, from this arithmetic, and never a second
 * drawing of them that could drift.
 */
export function drawMark(size: number): Uint8Array {
  const pixel = 1 / size;
  const pixels = new Uint8Array(size * size * 3);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const value = Math.round(markCoverage((x + 0.5) * pixel, (y + 0.5) * pixel, pixel) * 255);
      pixels.fill(value, (y * size + x) * 3, (y * size + x) * 3 + 3);
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
