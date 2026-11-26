// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The terrain archive's two checks (#2013), against a fixture archive: what
 * an extract holds, and whether an uploaded object is the local file.
 */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { flatHeightTile, residentialBlockTile } from '@onyourleft/map-features/testing';
import { PMTiles } from 'pmtiles';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { buildTerrainArchive } from '../../src/terrain/terrain-testing';
import { buildArchive, countingSource } from '../../src/world-data/archive-testing';
import {
  main,
  planExtract,
  sampleRanges,
  TERRAIN_EXTRACT_BOX,
  terrainHeaderFault,
  tileRange,
  verifyUpload,
  VERIFY_RANGE_BYTES,
  type RangeReader,
} from './archive-check';

const INSIDE = { z: 12 as const, x: 850, y: 1550 };
const ALSO_INSIDE = { z: 12 as const, x: 851, y: 1550 };
/** A z12 tile over the Atlantic, east of the box. */
const OUTSIDE = { z: 12 as const, x: 1500, y: 1550 };

const memory = (bytes: Uint8Array): RangeReader => ({
  length: bytes.length,
  read: (offset, length) => Promise.resolve(bytes.subarray(offset, offset + length)),
});

describe('tileRange', () => {
  it('is the whole world’s one tile at zoom 0, and the lower 48’s columns at zoom 12', () => {
    expect(tileRange(0, TERRAIN_EXTRACT_BOX)).toStrictEqual({ x0: 0, x1: 0, y0: 0, y1: 0 });
    const z12 = tileRange(12, TERRAIN_EXTRACT_BOX);
    // (−125 + 180) / 360 × 4096 = 625.7, and (−66 + 180) / 360 × 4096 = 1297.07.
    expect(z12.x0).toBe(625);
    expect(z12.x1).toBe(1297);
    // North is the smaller row.
    expect(z12.y0).toBeLessThan(z12.y1);
    // 673 columns by 407 rows: the 231,203 zoom-12 tiles the upstream walk counted, less the absent ones.
    expect((z12.x1 - z12.x0 + 1) * (z12.y1 - z12.y0 + 1)).toBeGreaterThanOrEqual(231_203);
  });
});

describe('planExtract', () => {
  it('counts the tiles inside the box and their bytes, and leaves out the ones outside it', async () => {
    const tile = flatHeightTile();
    const archive = await buildTerrainArchive([
      { tile: INSIDE, bytes: tile },
      { tile: ALSO_INSIDE, bytes: tile.slice(0, 5_000) },
      { tile: OUTSIDE, bytes: tile },
    ]);
    const plan = await planExtract(countingSource(archive));
    expect(plan.tiles).toBe(2);
    expect(plan.contents).toBe(2);
    expect(plan.bytes).toBe(tile.length + 5_000);
    expect(plan.largestTile).toBe(tile.length);
    expect(plan.perZoom).toHaveLength(13);
    expect(plan.perZoom[12]).toStrictEqual({ tiles: 2, bytes: tile.length + 5_000 });
    expect(plan.perZoom[11]).toStrictEqual({ tiles: 0, bytes: 0 });
  });

  it('reads directories only: no tile’s bytes are asked for', async () => {
    const tile = flatHeightTile();
    const archive = await buildTerrainArchive([{ tile: INSIDE, bytes: tile }]);
    const source = countingSource(archive);
    await planExtract(source);
    const view = new DataView(archive.buffer);
    const tileDataOffset = view.getUint32(56, true);
    // The package's first read is a fixed 16 KiB from the start; nothing begins in the tile data.
    expect(source.calls.every((call) => call.offset < tileDataOffset)).toBe(true);
  });

  it('counts zoom 12 only: upstream’s lower zooms are not in the hosted extract', async () => {
    // A z11 tile inside the box, in an archive that, as upstream's does, holds zoom 0 to 12.
    const archive = await buildTerrainArchive(
      [{ tile: { z: 12, x: 425, y: 775 }, bytes: flatHeightTile() }],
      {
        zoom: 11,
        minZoom: 0,
        maxZoom: 12,
      },
    );
    const plan = await planExtract(countingSource(archive));
    expect(plan.tiles).toBe(0);
    expect(plan.perZoom[11]).toStrictEqual({ tiles: 0, bytes: 0 });
  });

  it('counts nothing below the zoom it was asked for', async () => {
    const archive = await buildTerrainArchive([{ tile: INSIDE, bytes: flatHeightTile() }]);
    expect((await planExtract(countingSource(archive), TERRAIN_EXTRACT_BOX, 11)).tiles).toBe(0);
  });
});

describe('terrainHeaderFault', () => {
  const headerOf = async (bytes: Uint8Array) => new PMTiles(countingSource(bytes)).getHeader();

  it('passes a WebP archive that reaches zoom 12, stored uncompressed', async () => {
    const archive = await buildTerrainArchive([{ tile: INSIDE, bytes: flatHeightTile() }]);
    expect(terrainHeaderFault(await headerOf(archive))).toBeUndefined();
  });

  it('passes the hosted shape: zoom 12 only, min zoom and max zoom both 12', async () => {
    const archive = await buildTerrainArchive([{ tile: INSIDE, bytes: flatHeightTile() }], {
      minZoom: 12,
      maxZoom: 12,
    });
    const header = await headerOf(archive);
    expect(header.minZoom).toBe(12);
    expect(terrainHeaderFault(header)).toBeUndefined();
  });

  it('names what is wrong with a vector archive, a compressed one and a shallow one', async () => {
    const vector = await buildArchive({
      tiles: [{ x: INSIDE.x, y: INSIDE.y, bytes: residentialBlockTile() }],
      zoom: 12,
      maxZoom: 12,
      gzip: false,
    });
    expect(terrainHeaderFault(await headerOf(vector))).toBe('its tiles are not WebP');
    const tiles = [{ tile: INSIDE, bytes: flatHeightTile() }];
    expect(
      terrainHeaderFault(await headerOf(await buildTerrainArchive(tiles, { gzip: true }))),
    ).toBe('its tiles are stored compressed');
    expect(
      terrainHeaderFault(await headerOf(await buildTerrainArchive(tiles, { maxZoom: 11 }))),
    ).toBe('it does not reach zoom 12');
  });
});

describe('sampleRanges', () => {
  it('spreads eight 64 KiB ranges from the first byte to the last', () => {
    const length = 14_438_629_218;
    const ranges = sampleRanges(length);
    expect(ranges).toHaveLength(8);
    expect(ranges[0]).toStrictEqual({ offset: 0, length: VERIFY_RANGE_BYTES });
    expect(ranges.at(-1)!.offset + VERIFY_RANGE_BYTES).toBe(length);
    for (let index = 1; index < ranges.length; index += 1) {
      expect(ranges[index]!.offset).toBeGreaterThan(ranges[index - 1]!.offset);
    }
  });

  it('is the whole file for one shorter than a range, and never the same range twice', () => {
    expect(sampleRanges(1_000)).toStrictEqual([{ offset: 0, length: 1_000 }]);
    const short = sampleRanges(VERIFY_RANGE_BYTES + 3);
    expect(new Set(short.map((range) => range.offset)).size).toBe(short.length);
    expect(short.at(-1)!.offset + VERIFY_RANGE_BYTES).toBe(VERIFY_RANGE_BYTES + 3);
  });
});

describe('verifyUpload', () => {
  const file = Uint8Array.from({ length: 900_000 }, (_, index) => (index * 31) % 251);

  it('passes an object that is the file', async () => {
    const result = await verifyUpload(memory(file), memory(file.slice()));
    expect(result.ok).toBe(true);
    expect(result.lines[0]).toBe('length: 900000 bytes, both');
    expect(result.lines).toHaveLength(9);
    expect(result.lines.every((line) => !line.includes('DIFFERS'))).toBe(true);
  });

  it('fails an object of another length without reading a range', async () => {
    let read = 0;
    const counting: RangeReader = {
      length: file.length - 1,
      read: (offset, length) => {
        read += 1;
        return Promise.resolve(file.subarray(offset, offset + length));
      },
    };
    const result = await verifyUpload(memory(file), counting);
    expect(result.ok).toBe(false);
    expect(result.lines).toStrictEqual([
      'length: local 900000 bytes, uploaded 899999 bytes — they differ',
    ]);
    expect(read).toBe(0);
  });

  it('fails an object with one byte changed inside a sampled range, and says which range', async () => {
    const changed = file.slice();
    changed[file.length - 10] = (changed[file.length - 10] ?? 0) ^ 0xff;
    const result = await verifyUpload(memory(file), memory(changed));
    expect(result.ok).toBe(false);
    expect(result.lines.filter((line) => line.includes('DIFFERS'))).toHaveLength(1);
    expect(result.lines.at(-1)).toContain('DIFFERS');
  });
});

describe('the command', () => {
  let directory = '';
  let archivePath = '';
  let vectorPath = '';

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'oyl-terrain-check-'));
    archivePath = join(directory, 'terrain.pmtiles');
    vectorPath = join(directory, 'vector.pmtiles');
    await writeFile(
      archivePath,
      await buildTerrainArchive([{ tile: INSIDE, bytes: flatHeightTile() }]),
    );
    await writeFile(
      vectorPath,
      await buildArchive({
        tiles: [{ x: INSIDE.x, y: INSIDE.y, bytes: residentialBlockTile() }],
        zoom: 12,
        maxZoom: 12,
        gzip: false,
      }),
    );
  });

  afterAll(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('plans a local archive and prints its tiles and bytes', async () => {
    const lines: string[] = [];
    expect(await main(['plan', archivePath], (line) => lines.push(line))).toBe(0);
    expect(lines[0]).toBe('box -125,24,-66,50, zoom 12');
    // One line per zoom counted, and that is zoom 12 alone.
    expect(lines.filter((line) => /^z\d+:/.test(line))).toStrictEqual([
      expect.stringMatching(/^z12: 1 tiles, \d+ bytes$/),
    ]);
    expect(lines[1]).toBe('tiles: 1 (1 distinct contents)');
    expect(lines[2]).toMatch(/^tile bytes: \d+ \(0\.00 GB\)$/);
  });

  it('verifies an upload and prints each check as one line, and only that line', async () => {
    // The host, as R2 answers: 206 and a Content-Range carrying the total length.
    const bytes = await readFile(archivePath);
    vi.stubGlobal('fetch', (_url: string, init: { headers: Record<string, string> }) => {
      const [, from, to] = /bytes=(\d+)-(\d+)/.exec(init.headers.Range ?? '') ?? [];
      const start = Number(from);
      const end = Math.min(Number(to), bytes.length - 1);
      return Promise.resolve(
        new Response(bytes.subarray(start, end + 1), {
          status: 206,
          headers: {
            'content-range': `bytes ${String(start)}-${String(end)}/${String(bytes.length)}`,
          },
        }),
      );
    });
    // Every argument `out` is handed, as `console.log` would print them all.
    const calls: unknown[][] = [];
    const code = await main(
      ['verify', archivePath, 'https://tiles.example.invalid/terrain.pmtiles'],
      (...args: unknown[]) => calls.push(args),
    );
    expect(code).toBe(0);
    expect(calls.every((args) => args.length === 1)).toBe(true);
    expect(calls[0]).toStrictEqual([`length: ${String(bytes.length)} bytes, both`]);
    expect(calls.at(-1)).toStrictEqual(['verified: the uploaded object is the local file']);
  });

  it('refuses to verify a local file that is not a terrain archive, before asking any host', async () => {
    const lines: string[] = [];
    const code = await main(
      ['verify', vectorPath, 'https://tiles.example.invalid/terrain.pmtiles'],
      (line) => lines.push(line),
    );
    expect(code).toBe(1);
    expect(lines).toStrictEqual([
      'the local file is not a terrain archive the app reads: its tiles are not WebP',
    ]);
  });

  it('prints its usage for anything else, and for an upload target that is not https', async () => {
    for (const args of [[], ['plan'], ['verify', archivePath, 'http://tiles.example.invalid/t']]) {
      const lines: string[] = [];
      expect(await main(args, (line) => lines.push(line))).toBe(2);
      expect(lines[0]).toContain('usage: terrain:check');
    }
  });
});
