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
