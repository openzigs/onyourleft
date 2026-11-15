// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The menus' music file, as committed and as `ASSETS.toml` records it — #2057.
 *
 * `encode-menu-music.sh` needs the original WAV, which is not committed
 * (Freesound serves it only to a signed-in account), and a pinned FFmpeg, which
 * CI does not install. So CI does not re-encode: `--check` is run by hand and
 * quoted in the pull request that changes the file, the shape
 * `tools/brand/provenance.test.ts` has for its pipeline. What runs here, on
 * every pull request, reads the committed bytes:
 *
 * 1. **The seam.** The loop is an exact 16 bars at 123 bpm, and `<audio
 *    loop>` replays what the file decodes to, so a single sample of padding at
 *    either end is a gap in every repeat. An Ogg Opus decoder gives back the
 *    last page's granule position less the header's pre-skip: that number,
 *    read out of the file, must be the resampled source's length.
 * 2. **The budget.** Everything under `public/audio/` together stays under
 *    3 MB, the budget #2057 states for all menu music.
 * 3. **The record.** The `ASSETS.toml` row names the input, its digest, the
 *    script and the tool the script itself pins, so the two cannot drift.
 * 4. **The wiring.** The URL the app plays is that file, under the app's own
 *    base on its own origin.
 */

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { parseAssetManifest } from '../../src/credits/manifest';
import { MENU_MUSIC_FILE, MENU_MUSIC_TRACK } from '../../src/shell/menu-music';

const WEB = fileURLToPath(new URL('../../', import.meta.url));
const REPOSITORY = join(WEB, '..', '..');
const PUBLIC = join(WEB, 'public');
const AUDIO = join(PUBLIC, 'audio');
const SCRIPT = 'apps/web/tools/audio/encode-menu-music.sh';
const FILE = join(PUBLIC, MENU_MUSIC_FILE);
const ROW_PATH = `apps/web/public/${MENU_MUSIC_FILE}`;

/** #2057's budget for all menu music, in bytes. */
const MENU_MUSIC_BUDGET_BYTES = 3_000_000;

/** The original WAV's length in frames at 44.1 kHz (5 507 198 bytes, a 44-byte header). */
const SOURCE_FRAMES = 1_376_780;
const SOURCE_RATE = 44_100;
/** Opus decodes at 48 kHz, whatever the input was. */
const OPUS_RATE = 48_000;
/** libopus's own look-ahead at 48 kHz: what a pre-skip should be, and no more. */
const LIBOPUS_PRE_SKIP = 312;
/** 16 bars of 4/4 at 123 bpm, in seconds. */
const SIXTEEN_BARS_S = (16 * 4 * 60) / 123;

/** One pin out of the encoding script, so the row is held to what the script says. */
function pin(name: string): string {
  const script = readFileSync(join(REPOSITORY, SCRIPT), 'utf8');
  const found = new RegExp(`^${name}="([^"]+)"$`, 'm').exec(script);
  if (found?.[1] === undefined) throw new Error(`${SCRIPT} pins no ${name}`);
  return found[1];
}

interface OggPage {
  readonly headerType: number;
  readonly granule: bigint;
  readonly serial: number;
  readonly body: Uint8Array;
}

/** The CRC Ogg puts in every page: polynomial 0x04c11db7, unreflected, from 0. */
function oggCrc(bytes: Uint8Array): number {
  let crc = 0;
  for (const byte of bytes) {
    crc ^= byte << 24;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 0x80000000 ? (crc << 1) ^ 0x04c11db7 : crc << 1;
    }
  }
  return crc >>> 0;
}

/** Every page of an Ogg stream, each checked against its own CRC. */
function oggPages(bytes: Uint8Array): readonly OggPage[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const pages: OggPage[] = [];
  let at = 0;
  while (at < bytes.length) {
    const capture = String.fromCharCode(...bytes.subarray(at, at + 4));
    if (capture !== 'OggS') throw new Error(`no Ogg page at byte ${String(at)}`);
    const segments = bytes[at + 26] ?? 0;
    let size = 0;
    for (let index = 0; index < segments; index += 1) size += bytes[at + 27 + index] ?? 0;
    const end = at + 27 + segments + size;
    if (end > bytes.length) throw new Error(`the page at byte ${String(at)} is cut short`);
    const page = bytes.slice(at, end);
    const stored = view.getUint32(at + 22, true);
    page.fill(0, 22, 26);
    if (oggCrc(page) !== stored) throw new Error(`the page at byte ${String(at)} fails its CRC`);
    pages.push({
      headerType: bytes[at + 5] ?? 0,
      granule: view.getBigInt64(at + 6, true),
      serial: view.getUint32(at + 14, true),
      body: bytes.subarray(at + 27 + segments, end),
    });
    at = end;
  }
  return pages;
}

const bytes = new Uint8Array(readFileSync(FILE));
const pages = oggPages(bytes);
const head = pages[0]?.body ?? new Uint8Array();
const headView = new DataView(head.buffer, head.byteOffset, head.byteLength);

describe('the menus’ loop — the seam', () => {
  it('is one Ogg Opus stream, stereo, ending on its last page', () => {
    expect(String.fromCharCode(...head.subarray(0, 8))).toBe('OpusHead');
    expect(head[9]).toBe(2);
    expect(new Set(pages.map((page) => page.serial)).size).toBe(1);
    // The end-of-stream flag: a truncated file has no such page.
    expect((pages.at(-1)?.headerType ?? 0) & 0x04).toBe(0x04);
  });

  it('asks a decoder to drop the encoder’s look-ahead and nothing more', () => {
    // A larger pre-skip would cut the downbeat; a smaller one would play the
    // encoder's warm-up before it.
    expect(headView.getUint16(10, true)).toBe(LIBOPUS_PRE_SKIP);
  });

  it('decodes to exactly the source’s 16 bars at 123 bpm: no padding at either end', () => {
    const decoded = Number(pages.at(-1)?.granule ?? 0n) - headView.getUint16(10, true);
    // Less than one sample from the source resampled, so not one frame of
    // padding (20 ms is 960 samples) and not one sample of the loop cut.
    expect(Math.abs(decoded - (SOURCE_FRAMES * OPUS_RATE) / SOURCE_RATE)).toBeLessThan(1);
    expect(Math.abs(decoded / OPUS_RATE - SIXTEEN_BARS_S)).toBeLessThan(0.001);
  });
});

describe('the menus’ music — the budget', () => {
  it('keeps every file under public/audio/ within 3 MB together', () => {
    const sizes = (directory: string): readonly number[] =>
      readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const path = join(directory, entry.name);
        return entry.isDirectory() ? sizes(path) : [statSync(path).size];
      });
    const all = sizes(AUDIO);
    expect(all.length).toBeGreaterThan(0);
    expect(all.reduce((total, size) => total + size, 0)).toBeLessThanOrEqual(
      MENU_MUSIC_BUDGET_BYTES,
    );
  });
});

describe('the menus’ loop — its ASSETS.toml row', () => {
  const manifest = parseAssetManifest(readFileSync(join(REPOSITORY, 'ASSETS.toml'), 'utf8'));
  const row = manifest.entries.find((entry) => entry.path === ROW_PATH);

  it('records the original, the script that encoded it and the tool that script pins', () => {
    expect(manifest.problems).toEqual([]);
    expect(row).toMatchObject({
      licence: 'CC0-1.0',
      creator: 'Venus17',
      url: pin('SOURCE_URL'),
      input: pin('SOURCE_URL'),
      inputsha256: pin('SOURCE_SHA256'),
      script: SCRIPT,
      tool: pin('PINNED_TOOL'),
      sha256: createHash('sha256').update(bytes).digest('hex'),
    });
    // Re-encoding is a modification, said in words, with the work's title.
    expect(row?.modified).toContain('Upbeat Game Loop - Aurora Ride');
    expect(row?.modified).toMatch(/re-encoded/);
  });

  it('is the file the script writes', () => {
    const script = readFileSync(join(REPOSITORY, SCRIPT), 'utf8');
    expect(script).toContain(`/public/${MENU_MUSIC_FILE}"`);
  });
});

describe('the menus’ loop — what the app plays', () => {
  it('is that file, under the app’s own base, on its own origin', () => {
    expect(existsSync(FILE)).toBe(true);
    expect(MENU_MUSIC_TRACK).toBe(`${import.meta.env.BASE_URL}${MENU_MUSIC_FILE}`);
    expect(MENU_MUSIC_TRACK).not.toMatch(/^[a-z][a-z0-9+.-]*:/i);
  });
});
