// SPDX-License-Identifier: AGPL-3.0-or-later

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { parseAssetManifest } from '../../src/credits/manifest';

import {
  committedWordmark,
  decodeRgbaPng,
  encodeRgbaPng,
  keyOf,
  REPOSITORY,
  WORDMARK_CREATOR,
  WORDMARK_HEIGHT,
  WORDMARK_MODIFIED_WORDS,
  WORDMARK_PNG,
  WORDMARK_READ,
  WORDMARK_SCRIPT,
  WORDMARK_SOURCE,
  WORDMARK_SOURCE_SHA256,
  WORDMARK_SOURCE_WORDS,
  WORDMARK_URL,
  WORDMARK_WIDTH,
  wordmarkFrom,
} from './game-wordmark';

/**
 * #966: the committed wordmark texture is what the committed script makes of
 * the committed source — re-made here, on every `pnpm run test`, and compared
 * pixel for pixel with the PNG the stylised world loads.
 */
describe('the game wordmark — #966', () => {
  const made = committedWordmark();

  it('is made from the source the owner supplied, byte for byte', () => {
    const digest = createHash('sha256')
      .update(readFileSync(`${REPOSITORY}${WORDMARK_SOURCE}`))
      .digest('hex');
    expect(digest).toBe(WORDMARK_SOURCE_SHA256);
  });

  it('commits exactly the pixels the script makes', () => {
    const committed = decodeRgbaPng(new Uint8Array(readFileSync(`${REPOSITORY}${WORDMARK_PNG}`)));
    expect([committed.width, committed.height]).toEqual([WORDMARK_WIDTH, WORDMARK_HEIGHT]);
    // Compared whole rather than with `toEqual`, which prints half a megabyte.
    const first = committed.pixels.findIndex((value, at) => value !== made.pixels[at]);
    expect(first).toBe(-1);
  }, 20_000);

  it('keys the checkerboard out and keeps the lettering', () => {
    // The checkerboard's two squares, and the two colours of the lettering,
    // as read off the source.
    expect(keyOf(255, 255, 255)).toBeLessThan(64);
    expect(keyOf(207, 207, 205)).toBeLessThan(64);
    expect(keyOf(25, 45, 75)).toBeGreaterThan(192);
    expect(keyOf(38, 132, 186)).toBeGreaterThan(192);
    let opaque = 0;
    let clear = 0;
    for (let at = 3; at < made.pixels.length; at += 4) {
      if (made.pixels[at] === 255) opaque += 1;
      if (made.pixels[at] === 0) clear += 1;
    }
    const all = WORDMARK_WIDTH * WORDMARK_HEIGHT;
    // Lettering covers about a third of the texture and the board most of the
    // rest; an edge is a thin share. A key that let the checkerboard through
    // would leave almost nothing clear, and one that ate the lettering almost
    // nothing opaque.
    expect(opaque / all).toBeGreaterThan(0.2);
    expect(clear / all).toBeGreaterThan(0.45);
    expect((all - opaque - clear) / all).toBeLessThan(0.1);
  });

  it('leaves a clear margin round the lettering, and the board white under it', () => {
    for (let y = 0; y < WORDMARK_HEIGHT; y += 1) {
      for (const x of [0, 1, 2, WORDMARK_WIDTH - 3, WORDMARK_WIDTH - 2, WORDMARK_WIDTH - 1]) {
        const at = (y * WORDMARK_WIDTH + x) * 4;
        expect(made.pixels[at + 3]).toBe(0);
        expect([made.pixels[at], made.pixels[at + 1], made.pixels[at + 2]]).toEqual([
          255, 255, 255,
        ]);
      }
    }
  });

  it('is a function of the pixels: a checkerboard alone keys to nothing', () => {
    const width = 2816;
    const height = 1536;
    const rgb = new Uint8Array(width * height * 3);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const grey = (Math.floor(x / 32) + Math.floor(y / 32)) % 2 === 0 ? 255 : 207;
        rgb.fill(grey, (y * width + x) * 3, (y * width + x) * 3 + 3);
      }
    }
    const keyed = wordmarkFrom({ width, height, rgb });
    for (let at = 3; at < keyed.pixels.length; at += 4) {
      if (keyed.pixels[at] !== 0) throw new Error(`a checkerboard kept alpha at ${String(at)}`);
    }
  });

  it('reads back what it writes', () => {
    const back = decodeRgbaPng(encodeRgbaPng(made));
    expect(back.pixels.findIndex((value, at) => value !== made.pixels[at])).toBe(-1);
  });

  it('is recorded in ASSETS.toml as the owner’s CC-BY-4.0 work, source and texture alike', () => {
    const manifest = parseAssetManifest(readFileSync(`${REPOSITORY}ASSETS.toml`, 'utf8'));
    const rowOf = (path: string): Readonly<Record<string, string | undefined>> =>
      (manifest.entries.find((each) => each.path === path) ?? {}) as Readonly<
        Record<string, string | undefined>
      >;
    const source = rowOf(WORDMARK_SOURCE);
    const texture = rowOf(WORDMARK_PNG);
    for (const row of [source, texture]) {
      expect(row['licence']).toBe('CC-BY-4.0');
      expect(row['creator']).toBe(WORDMARK_CREATOR);
      expect(row['url']).toBe(WORDMARK_URL);
      expect(row['read']).toBe(WORDMARK_READ);
      expect(row['source']).toContain(WORDMARK_SOURCE_WORDS);
    }
    expect(source['sha256']).toBe(WORDMARK_SOURCE_SHA256);
    expect(source['modified']).toBe('no');
    // The texture is derived: its input is the source, its script this one.
    expect(texture['modified']).toBe(WORDMARK_MODIFIED_WORDS);
    expect(texture['input']).toBe(WORDMARK_SOURCE);
    expect(texture['inputsha256']).toBe(WORDMARK_SOURCE_SHA256);
    expect(texture['script']).toBe(WORDMARK_SCRIPT);
  });
});
