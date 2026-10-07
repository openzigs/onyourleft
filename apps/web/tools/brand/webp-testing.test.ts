// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The lossless WebP reader is held to Pillow — #972.
 *
 * `provenance.test.ts` reads the full logo through `webp-testing.ts`, so a
 * reader that misread a transform would turn every check of the logo into a
 * check of the wrong pixels. These digests are of the RGBA bytes Pillow 12.3.0
 * (libwebp 1.6.0, the version `derive_brand.py` pins) decodes each committed
 * logo to — `Image.open(path).convert('RGBA').tobytes()` — and they are the
 * same pixels the PNGs held before #972 (compared on 2026-10-05). A new logo
 * from `derive_brand.py` moves them: re-take them with Pillow, never from this
 * reader.
 *
 * The logos reach only part of the reader, so since #1167 it is also held to
 * Pillow over `fixtures/`, pictures drawn from arithmetic by
 * `make_webp_fixtures.py` for the branches the logos never take: a colour
 * palette packed 8, 4, 2 and 1 pixels to a byte and unpacked at an odd width, a
 * one-symbol prefix code, a subtract-green transform, a translucent palette,
 * and a `VP8X` header with an `EXIF` chunk to step over. Their digests come
 * from `make_webp_fixtures.py --digests`, which is Pillow's decoding, never
 * this reader's.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { decodeWebp, webpDimensions } from './webp-testing';

const REPOSITORY = fileURLToPath(new URL('../../../../', import.meta.url));

const PILLOW_DECODES = [
  {
    path: 'apps/web/src/brand/logo-light.webp',
    width: 512,
    height: 412,
    rgba: 'b965617faeddf8b6af29304c6cf74ec88cb0e507cc95944507c5a53d1ce65f71',
  },
  {
    path: 'apps/web/src/brand/logo-dark.webp',
    width: 512,
    height: 408,
    rgba: 'f86f6ec3983d8f485d375cfeba3302426a339d2d468644d4946bdc0952e0e2e2',
  },
  {
    path: 'apps/web/tools/brand/fixtures/one-pixel.webp',
    width: 1,
    height: 1,
    rgba: 'ba4729ab2f9d2eb605e2bc435ce5c55c2d83a222c22b5570a5d4930d44477aac',
  },
  {
    path: 'apps/web/tools/brand/fixtures/two-colours.webp',
    width: 37,
    height: 23,
    rgba: '118c13ea30401b771f11da707b5c8369daae971c8d534fd266bb163514bda779',
  },
  {
    path: 'apps/web/tools/brand/fixtures/four-colours.webp',
    width: 29,
    height: 17,
    rgba: '1e3de1c7e6025fe162598b8cbba533879f32115ca6b61e0debbf5cddf6bcf4e1',
  },
  {
    path: 'apps/web/tools/brand/fixtures/sixteen-colours-alpha.webp',
    width: 31,
    height: 19,
    rgba: '0f0a5798c8c4372694645c85b06662c36b29fa1328ef81a17adecc1163260be3',
  },
  {
    path: 'apps/web/tools/brand/fixtures/many-colours.webp',
    width: 41,
    height: 27,
    rgba: '42dfa3594ec872dee3b8c3dc2bc2d14972de9c19be3e213081b2c1796e2ebba3',
  },
  {
    path: 'apps/web/tools/brand/fixtures/gradient.webp',
    width: 67,
    height: 45,
    rgba: '21c03f68d53a880c109e774c93b64d783ae613983ce54629f6db72a4c3c499d5',
  },
  {
    path: 'apps/web/tools/brand/fixtures/with-exif.webp',
    width: 9,
    height: 7,
    rgba: '24b6aaf130fc661b93f451bfb4ad05286cf12a17478bf826727ee67aec013971',
  },
] as const;

/** Pillow's lossy encodings, which the reader must refuse rather than misread. */
const LOSSY = [
  { path: 'apps/web/tools/brand/fixtures/lossy.webp', chunk: 'VP8' },
  { path: 'apps/web/tools/brand/fixtures/lossy-alpha.webp', chunk: 'ALPH' },
] as const;

const bytesOf = (path: string): Uint8Array => new Uint8Array(readFileSync(join(REPOSITORY, path)));

describe('the lossless WebP reader — #972', () => {
  it.each(PILLOW_DECODES)('decodes $path to exactly the pixels Pillow does', (expected) => {
    const image = decodeWebp(bytesOf(expected.path));
    expect([image.width, image.height]).toEqual([expected.width, expected.height]);
    expect(webpDimensions(bytesOf(expected.path))).toEqual({
      width: expected.width,
      height: expected.height,
    });
    expect(createHash('sha256').update(image.rgba).digest('hex')).toBe(expected.rgba);
  });

  it.each(LOSSY)('refuses $path, a lossy picture Pillow wrote, at its $chunk chunk', (lossy) => {
    expect(() => decodeWebp(bytesOf(lossy.path))).toThrow(
      new RegExp(`a ${lossy.chunk} chunk: only a lossless still picture is read here`),
    );
  });

  it('refuses a lossy picture rather than misreading it', () => {
    // A RIFF/WEBP container holding a `VP8 ` (lossy) chunk: the reader must
    // not hand back any pixels for it.
    const lossy = new Uint8Array([
      ...[0x52, 0x49, 0x46, 0x46, 12, 0, 0, 0],
      ...[0x57, 0x45, 0x42, 0x50],
      ...[0x56, 0x50, 0x38, 0x20, 0, 0, 0, 0],
    ]);
    expect(() => decodeWebp(lossy)).toThrow(/lossless still picture/);
  });

  it('refuses a file that is not a WebP', () => {
    expect(() =>
      decodeWebp(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0, 0, 0])),
    ).toThrow(/not a WebP/);
  });
});
