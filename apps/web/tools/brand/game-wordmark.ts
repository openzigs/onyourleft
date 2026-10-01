// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The trainer game's wordmark texture, made from the owner's committed source
 * — #966.
 *
 * ## The source
 *
 * `sources/gemini-assets-v2.jpeg` beside this file — committed at the same path,
 * with the same `ASSETS.toml` row, as #965's brand pipeline commits it: the owner's artwork, made with
 * Google Gemini and licensed by the owner as CC-BY-4.0 (#965's rulings; the
 * Gemini terms' *Use of Generated Content* leave the output to the person who
 * asked for it). Its bottom band is the in-game wordmark — "ON YOUR LEFT", the
 * arrow through the O — painted on a grey and white checkerboard that Gemini
 * baked into the pixels, so nothing in the file is actually transparent.
 *
 * ## What is done to it, in order — every number below
 *
 * 1. **Decoded** by `jpeg-baseline.ts`, this repository's own decoder, so the
 *    same bytes give the same pixels on every machine that runs the pinned
 *    Node.
 * 2. **Cropped** to {@link WORDMARK_CROP}: the wordmark's bounds as read off
 *    the source (x 608–2222, y 1221–1371) with eight or nine pixels of margin.
 * 3. **Keyed by colour.** The lettering is navy and blue; the checkerboard is
 *    a neutral grey and white. {@link keyOf} adds how blue a pixel is to how
 *    dark it is: the checkerboard reads at most about 60, the lettering at
 *    least about 200, and {@link KEY_FROM} to {@link KEY_TO} ramps alpha over
 *    the antialiased edge between them. An edge pixel's colour is unmixed
 *    from {@link CHECKER_GREY}, the checkerboard's own mean, so the edge does
 *    not carry a grey fringe onto the board it is drawn on.
 * 4. **Resampled** by area (a box filter over each output pixel's footprint,
 *    in premultiplied colour) to fit {@link WORDMARK_FIT} inside the
 *    {@link WORDMARK_WIDTH} × {@link WORDMARK_HEIGHT} texture, centred. A
 *    power of two each way, so the realistic world's KTX2 can carry a full
 *    mipmap chain.
 * 5. **Written** as an RGBA PNG with straight alpha; a fully transparent
 *    pixel's colour is white, the board's own, so a filtered edge bleeds
 *    toward the board and not toward black.
 *
 * Run it with `pnpm --filter @onyourleft/web run wordmark:generate`; it writes
 * the stylised world's PNG. The realistic world's KTX2 is the same pixels,
 * encoded by the realistic pipeline (`tools/realistic/sources.ts`, the
 * `wordmark` recipe), because only that pipeline may write into
 * `public/realistic/`. `game-wordmark.test.ts` re-makes the pixels from the
 * committed JPEG on every `pnpm run test` and compares them with the
 * committed PNG's own, pixel for pixel — never its bytes, which pin zlib
 * (`tools/icons/generate-icons.ts` gives the reason).
 *
 * Authoring-time code: never in the product.
 */

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { deflateSync, inflateSync } from 'node:zlib';

import { decodeBaselineJpeg, type DecodedJpeg } from './jpeg-baseline';

/** The committed source, repository-relative. */
export const WORDMARK_SOURCE = 'apps/web/tools/brand/sources/gemini-assets-v2.jpeg';

/** Its SHA-256, as the owner's copy was read on 2026-10-01. */
export const WORDMARK_SOURCE_SHA256 =
  'bbaa0b5e46b67fa81873ba91034bea3c3022d162e29f62183e2d163b18c398d6';

/** The stylised world's texture, repository-relative: precached with the app. */
export const WORDMARK_PNG = 'apps/web/src/game/brand/game-wordmark.png';

/** This script, repository-relative — what an `ASSETS.toml` row's `script` names. */
export const WORDMARK_SCRIPT = 'apps/web/tools/brand/game-wordmark.ts';

/**
 * Who the wordmark is credited to: the project's owner — CC BY 4.0
 * §3(a)(1)(A)(i), and #965's ruling — by the name #965's rows give.
 */
export const WORDMARK_CREATOR = 'Matthew Cronin';

/** A link to the material: the brand directory, as #965's rows give it — §3(a)(1)(A)(v). */
export const WORDMARK_URL = 'https://github.com/openzigs/onyourleft/tree/main/apps/web/tools/brand';

/** The date the source and its licence were read: the owner's ruling on #965. */
export const WORDMARK_READ = '2026-10-01';

/** Where the wordmark came from, as every row that holds it says. */
export const WORDMARK_SOURCE_WORDS =
  "The On Your Left brand artwork (gemini-assets-v2.jpeg), by the project's owner, generated with Google Gemini — whose terms (ai.google.dev/gemini-api/terms, Use of Generated Content) claim no ownership of generated content — and licensed by the owner as CC-BY-4.0 (#965, #966)";

/** What was done to it for the game, in words — a derived row's `modified` begins with this. */
export const WORDMARK_MODIFIED_WORDS =
  "the bottom band (the in-game wordmark) cropped from the source, the painted checkerboard keyed out by colour into an alpha channel, the edge unmixed from the checkerboard's grey, and resampled by area to 1008 px wide inside a 1024 × 128 RGBA texture, by apps/web/tools/brand/game-wordmark.ts with its own baseline JPEG decoder";

/** The texture's size: **1024 × 128**. */
export const WORDMARK_WIDTH = 1024;
export const WORDMARK_HEIGHT = 128;

/** The source rectangle the wordmark is cut from, in source pixels, half-open. */
export const WORDMARK_CROP = { left: 600, top: 1212, right: 2232, bottom: 1380 } as const;

/**
 * The box the crop is fitted into, inside the texture: **1008** wide, so eight
 * pixels of clear board either side; the height follows the crop's own
 * proportion (168 / 1632 × 1008 ≈ 103.8).
 */
export const WORDMARK_FIT = 1008;

/** Below this key a pixel is checkerboard: alpha 0. */
export const KEY_FROM = 64;
/** At or above it, lettering: alpha 1. */
export const KEY_TO = 192;

/** The checkerboard's mean, one neutral channel: its grey squares read 205–213, its white 255. */
export const CHECKER_GREY = 230;

/** How blue a pixel is plus how dark it is: 0 for white, about 45 for the grey squares, 200+ for the lettering. */
export function keyOf(r: number, g: number, b: number): number {
  return b - Math.min(r, g) + (255 - Math.max(r, g, b));
}

/** A picture: `width × height` pixels of RGBA, straight alpha, row-major from the top. */
export interface Rgba {
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8Array;
}

/**
 * The wordmark, keyed and resampled, from the decoded source.
 *
 * Pure: the decoded picture in, the texture's pixels out.
 */
export function wordmarkFrom(source: DecodedJpeg): Rgba {
  const crop = WORDMARK_CROP;
  const cropWidth = crop.right - crop.left;
  const cropHeight = crop.bottom - crop.top;
  if (source.width < crop.right || source.height < crop.bottom) {
    throw new Error(
      `the source is ${String(source.width)}×${String(source.height)}, smaller than the crop`,
    );
  }
  // Steps 2 and 3, at the source's resolution: premultiplied colour and alpha.
  const keyed = new Float64Array(cropWidth * cropHeight * 4);
  for (let y = 0; y < cropHeight; y += 1) {
    for (let x = 0; x < cropWidth; x += 1) {
      const from = ((crop.top + y) * source.width + crop.left + x) * 3;
      const r = source.rgb[from] as number;
      const g = source.rgb[from + 1] as number;
      const b = source.rgb[from + 2] as number;
      const alpha = Math.min(1, Math.max(0, (keyOf(r, g, b) - KEY_FROM) / (KEY_TO - KEY_FROM)));
      const to = (y * cropWidth + x) * 4;
      // Premultiplied: the pixel less what of the checkerboard showed through.
      keyed[to] = clampUnit(r - (1 - alpha) * CHECKER_GREY, alpha);
      keyed[to + 1] = clampUnit(g - (1 - alpha) * CHECKER_GREY, alpha);
      keyed[to + 2] = clampUnit(b - (1 - alpha) * CHECKER_GREY, alpha);
      keyed[to + 3] = alpha;
    }
  }
  // Step 4: the output box, and each output pixel's footprint in the crop.
  const scale = cropWidth / WORDMARK_FIT;
  const fitHeight = cropHeight / scale;
  const boxLeft = (WORDMARK_WIDTH - WORDMARK_FIT) / 2;
  const boxTop = (WORDMARK_HEIGHT - fitHeight) / 2;
  const pixels = new Uint8Array(WORDMARK_WIDTH * WORDMARK_HEIGHT * 4);
  for (let y = 0; y < WORDMARK_HEIGHT; y += 1) {
    const y0 = (y - boxTop) * scale;
    const y1 = (y + 1 - boxTop) * scale;
    for (let x = 0; x < WORDMARK_WIDTH; x += 1) {
      const x0 = (x - boxLeft) * scale;
      const x1 = (x + 1 - boxLeft) * scale;
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      const area = (x1 - x0) * (y1 - y0);
      for (
        let sy = Math.max(0, Math.floor(y0));
        sy < Math.min(cropHeight, Math.ceil(y1));
        sy += 1
      ) {
        const wy = Math.min(y1, sy + 1) - Math.max(y0, sy);
        for (
          let sx = Math.max(0, Math.floor(x0));
          sx < Math.min(cropWidth, Math.ceil(x1));
          sx += 1
        ) {
          const weight = (wy * (Math.min(x1, sx + 1) - Math.max(x0, sx))) / area;
          const at = (sy * cropWidth + sx) * 4;
          r += (keyed[at] as number) * weight;
          g += (keyed[at + 1] as number) * weight;
          b += (keyed[at + 2] as number) * weight;
          a += (keyed[at + 3] as number) * weight;
        }
      }
      // Step 5: straight alpha, and a transparent pixel is the board's white.
      const out = (y * WORDMARK_WIDTH + x) * 4;
      const alpha = Math.round(a * 255);
      pixels[out] = alpha === 0 ? 255 : byte(r / a);
      pixels[out + 1] = alpha === 0 ? 255 : byte(g / a);
      pixels[out + 2] = alpha === 0 ? 255 : byte(b / a);
      pixels[out + 3] = alpha;
    }
  }
  return { width: WORDMARK_WIDTH, height: WORDMARK_HEIGHT, pixels };
}

/** A premultiplied channel, kept between nought and its own alpha's share of 255. */
function clampUnit(value: number, alpha: number): number {
  return Math.min(255 * alpha, Math.max(0, value));
}

function byte(value: number): number {
  return Math.min(255, Math.max(0, Math.round(value)));
}

/** The wordmark from the source file's bytes. */
export function wordmarkFromJpeg(bytes: Uint8Array): Rgba {
  return wordmarkFrom(decodeBaselineJpeg(bytes));
}

/** The digest of a picture's pixels — what the realistic KTX2 row records as its `inputsha256`. */
export function rgbaDigest(picture: Rgba): string {
  return createHash('sha256')
    .update(`${String(picture.width)}x${String(picture.height)}x4\n`)
    .update(picture.pixels)
    .digest('hex');
}

/* ----------------------------------------------------------------------------
 * PNG, RGBA — the one colour type this file writes and the one it reads back
 * ------------------------------------------------------------------------- */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = (c & 1) === 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const value of bytes) c = (CRC_TABLE[(c ^ value) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let index = 0; index < 4; index += 1) out[4 + index] = type.charCodeAt(index);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

const PNG_SIGNATURE = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);

/** An RGBA picture as a PNG: colour type 6, eight bits, no interlace, filter 0 on every row. */
export function encodeRgbaPng(picture: Rgba): Uint8Array {
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, picture.width);
  view.setUint32(4, picture.height);
  header[8] = 8;
  header[9] = 6;
  const stride = picture.width * 4;
  const raw = new Uint8Array(picture.height * (stride + 1));
  for (let y = 0; y < picture.height; y += 1) {
    raw.set(picture.pixels.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  const parts = [
    PNG_SIGNATURE,
    chunk('IHDR', header),
    chunk('IDAT', new Uint8Array(deflateSync(raw, { level: 9 }))),
    chunk('IEND', new Uint8Array(0)),
  ];
  const png = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    png.set(part, at);
    at += part.length;
  }
  return png;
}

/**
 * The pixels of a PNG {@link encodeRgbaPng} wrote. Refuses any other shape —
 * a file this module did not write is not one to compare against.
 */
export function decodeRgbaPng(png: Uint8Array): Rgba {
  for (const [index, value] of PNG_SIGNATURE.entries()) {
    if (png[index] !== value) throw new Error('not a PNG');
  }
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let at = PNG_SIGNATURE.length;
  let width = 0;
  let height = 0;
  const data: Uint8Array[] = [];
  while (at + 8 <= png.length) {
    const length = view.getUint32(at);
    const type = String.fromCharCode(...png.subarray(at + 4, at + 8));
    const body = png.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') {
      width = view.getUint32(at + 8);
      height = view.getUint32(at + 12);
      if (body[8] !== 8 || body[9] !== 6 || body[12] !== 0) {
        throw new Error('expected eight-bit RGBA with no interlacing');
      }
    } else if (type === 'IDAT') {
      data.push(body);
    }
    at += 12 + length;
  }
  const raw = new Uint8Array(inflateSync(Buffer.concat(data)));
  const stride = width * 4;
  const pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    if (raw[y * (stride + 1)] !== 0) throw new Error('expected filter type 0 on every row');
    pixels.set(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), y * stride);
  }
  return { width, height, pixels };
}

/** The repository root, from this file. */
export const REPOSITORY = fileURLToPath(new URL('../../../../', import.meta.url));

/** The wordmark from the committed source. */
export function committedWordmark(): Rgba {
  return wordmarkFromJpeg(new Uint8Array(readFileSync(`${REPOSITORY}${WORDMARK_SOURCE}`)));
}

if (process.argv[1]?.endsWith('game-wordmark.ts') === true) {
  writeFileSync(`${REPOSITORY}${WORDMARK_PNG}`, encodeRgbaPng(committedWordmark()));
  console.log(`wrote ${WORDMARK_PNG}`);
}
