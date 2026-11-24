// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The one module that asks the terrain archive for bytes — #2013, ADR 0087
 * D-2.3: what a request carries, what a response must be to be read, which
 * archives are read at all, and that no failure names a place. Read back
 * through `PMTiles`, the reader the product uses.
 */

import { MAX_TILE_BYTES } from '@onyourleft/map-features';
import { flatHeightTile, residentialBlockTile } from '@onyourleft/map-features/testing';
import { Compression } from 'pmtiles';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildArchive, countingSource } from '../world-data/archive-testing';
import {
  boundedTerrainDecompress,
  describeTerrainFailure,
  terrainArchive,
  terrainArchiveFrom,
  terrainFailureOf,
  terrainRangeSource,
  type TerrainFailure,
} from './terrain-source';
import { buildTerrainArchive, FIXTURE_HEIGHT_TILE, NEXT_HEIGHT_TILE } from './terrain-testing';

afterEach(() => {
  vi.unstubAllGlobals();
});

const failureOf = async (work: Promise<unknown>): Promise<TerrainFailure | 'resolved'> =>
  work.then(
    () => 'resolved' as const,
    (error: unknown) => terrainFailureOf(error),
  );

/**
 * Whether two byte arrays are the same bytes. A tile is 786 KB, and
 * `toStrictEqual` walks it an element at a time: under the nightly coverage
 * run that alone ran two cases here past Vitest's limit.
 */
const sameBytes = (read: Uint8Array | undefined, expected: Uint8Array): boolean =>
  read !== undefined && read.length === expected.length && Buffer.from(read).equals(expected);

describe('terrainArchiveFrom reads a height tile through PMTiles', () => {
  it('hands back a tile’s bytes exactly as stored', async () => {
    const tile = flatHeightTile();
    const bytes = await buildTerrainArchive([{ tile: FIXTURE_HEIGHT_TILE, bytes: tile }]);
    const read = await terrainArchiveFrom(countingSource(bytes)).tile(FIXTURE_HEIGHT_TILE);
    expect(sameBytes(read, tile)).toBe(true);
  });

  it('has no tile where the archive holds none', async () => {
    const bytes = await buildTerrainArchive([
      { tile: FIXTURE_HEIGHT_TILE, bytes: flatHeightTile() },
    ]);
    expect(await terrainArchiveFrom(countingSource(bytes)).tile(NEXT_HEIGHT_TILE)).toBeUndefined();
  });

  it('refuses an archive of vector tiles, and one whose tiles are compressed', async () => {
    const vector = await buildArchive({
      tiles: [
        { x: FIXTURE_HEIGHT_TILE.x, y: FIXTURE_HEIGHT_TILE.y, bytes: residentialBlockTile() },
      ],
      zoom: 12,
      maxZoom: 12,
      gzip: false,
    });
    expect(
      await failureOf(terrainArchiveFrom(countingSource(vector)).tile(FIXTURE_HEIGHT_TILE)),
    ).toStrictEqual({ kind: 'wrong-archive' });

    const gzipped = await buildTerrainArchive(
      [{ tile: FIXTURE_HEIGHT_TILE, bytes: flatHeightTile() }],
      { gzip: true },
    );
    expect(
      await failureOf(terrainArchiveFrom(countingSource(gzipped)).tile(FIXTURE_HEIGHT_TILE)),
    ).toStrictEqual({ kind: 'wrong-archive' });
  });

  it('refuses an archive that stops short of zoom 12, and one that starts past it', async () => {
    const tiles = [{ tile: FIXTURE_HEIGHT_TILE, bytes: flatHeightTile() }];
    const shallow = await buildTerrainArchive(tiles, { maxZoom: 11 });
    expect(
      await failureOf(terrainArchiveFrom(countingSource(shallow)).tile(FIXTURE_HEIGHT_TILE)),
    ).toStrictEqual({ kind: 'wrong-archive' });
    const deep = await buildTerrainArchive(tiles, { minZoom: 13, maxZoom: 14 });
    expect(
      await failureOf(terrainArchiveFrom(countingSource(deep)).tile(FIXTURE_HEIGHT_TILE)),
    ).toStrictEqual({ kind: 'wrong-archive' });
  });

  it('asks an archive of the wrong kind only once', async () => {
    const vector = await buildArchive({
      tiles: [
        { x: FIXTURE_HEIGHT_TILE.x, y: FIXTURE_HEIGHT_TILE.y, bytes: residentialBlockTile() },
      ],
      zoom: 12,
      maxZoom: 12,
      gzip: false,
    });
    const source = countingSource(vector);
    const archive = terrainArchiveFrom(source);
    await failureOf(archive.tile(FIXTURE_HEIGHT_TILE));
    const asked = source.calls.length;
    await failureOf(archive.tile(FIXTURE_HEIGHT_TILE));
    expect(source.calls).toHaveLength(asked);
  });

  it('reads again after a read that failed: an offline moment does not last the session', async () => {
    const tile = flatHeightTile();
    const source = countingSource(
      await buildTerrainArchive([{ tile: FIXTURE_HEIGHT_TILE, bytes: tile }]),
    );
    const archive = terrainArchiveFrom(source);
    source.offline = true;
    expect(await failureOf(archive.tile(FIXTURE_HEIGHT_TILE))).toStrictEqual({ kind: 'network' });
    source.offline = false;
    expect(sameBytes(await archive.tile(FIXTURE_HEIGHT_TILE), tile)).toBe(true);
  });

  it('says a read that was stopped was stopped', async () => {
    const source = countingSource(
      await buildTerrainArchive([{ tile: FIXTURE_HEIGHT_TILE, bytes: flatHeightTile() }]),
    );
    const stop = new AbortController();
    stop.abort();
    expect(
      await failureOf(terrainArchiveFrom(source).tile(FIXTURE_HEIGHT_TILE, stop.signal)),
    ).toStrictEqual({ kind: 'aborted' });
  });
});

describe('boundedTerrainDecompress', () => {
  const gzip = async (bytes: Uint8Array): Promise<ArrayBuffer> =>
    new Response(
      new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream('gzip')),
    ).arrayBuffer();

  it('inflates a directory inside the limit and refuses one past it', async () => {
    const plain = new Uint8Array(4_000).fill(7);
    const packed = await gzip(plain);
    expect(new Uint8Array(await boundedTerrainDecompress(packed, Compression.Gzip))).toStrictEqual(
      plain,
    );
    expect(
      await failureOf(boundedTerrainDecompress(packed, Compression.Gzip, 3_999)),
    ).toStrictEqual({ kind: 'too-large', limit: 3_999 });
  });

  it('holds uncompressed bytes to the same limit, and refuses another compression', async () => {
    const plain = new Uint8Array(100).buffer;
    expect(await boundedTerrainDecompress(plain, Compression.None)).toBe(plain);
    expect(await failureOf(boundedTerrainDecompress(plain, Compression.None, 99))).toStrictEqual({
      kind: 'too-large',
      limit: 99,
    });
    expect(await failureOf(boundedTerrainDecompress(plain, Compression.Brotli))).toStrictEqual({
      kind: 'compression',
    });
  });
});

describe('terrainRangeSource: the one fetch', () => {
  const URL_ = 'https://tiles.example.org/terrain-us.pmtiles';

  function respond(status: number, body: Uint8Array, headers: Record<string, string> = {}) {
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init: RequestInit) => {
        calls.push({ url, init });
        return Promise.resolve(new Response(body as BodyInit, { status, headers }));
      }),
    );
    return calls;
  }

  it('asks for a byte range of the configured URL, with no credential and nothing else', async () => {
    const calls = respond(206, new Uint8Array(10), { etag: '"e"' });
    const answer = await terrainRangeSource(URL_).getBytes(100, 10);
    expect(calls).toHaveLength(1);
    // The one file, never a `z/x/y` URL and never a query.
    expect(calls[0]?.url).toBe(URL_);
    expect(calls[0]?.init.credentials).toBe('omit');
    const headers = new Headers(calls[0]?.init.headers);
    expect([...headers.keys()]).toStrictEqual(['range']);
    expect(headers.get('range')).toBe('bytes=100-109');
    expect(answer.etag).toBe('"e"');
  });

  it('is pointed at the configured archive and no other', async () => {
    const calls = respond(206, new Uint8Array(127));
    await terrainArchive({ archiveUrl: URL_ })
      .tile({ z: 12, x: 850, y: 1550 })
      .catch(() => undefined);
    expect(calls.length).toBeGreaterThan(0);
    expect(new Set(calls.map((call) => call.url))).toStrictEqual(new Set([URL_]));
  });

  it('refuses a whole-file 200 larger than the range, and does not read its body', async () => {
    let pulled = 0;
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        controller.enqueue(new Uint8Array(1024));
        if (pulled > 200) controller.close();
      },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(endless, { status: 200, headers: { 'content-length': '19250356936' } }),
        ),
      ),
    );
    expect(await failureOf(terrainRangeSource(URL_).getBytes(0, 10))).toStrictEqual({
      kind: 'not-a-range',
    });
    expect(pulled).toBeLessThan(5);
  });

  it('reads a small archive sent whole', async () => {
    respond(200, new Uint8Array(8), { 'content-length': '8' });
    const answer = await terrainRangeSource(URL_).getBytes(0, 10);
    expect(answer.data.byteLength).toBe(8);
  });

  it('refuses a body longer than the range it asked for', async () => {
    respond(206, new Uint8Array(11));
    expect(await failureOf(terrainRangeSource(URL_).getBytes(0, 10))).toStrictEqual({
      kind: 'not-a-range',
    });
  });

  it('never asks for more than a tile may be, whatever a directory says', async () => {
    const calls = respond(206, new Uint8Array(1));
    expect(await failureOf(terrainRangeSource(URL_).getBytes(0, MAX_TILE_BYTES + 1))).toStrictEqual(
      { kind: 'not-a-range' },
    );
    expect(calls).toHaveLength(0);
  });

  it('reports the host’s status, a refused connection and a stopped read', async () => {
    respond(503, new Uint8Array(0));
    expect(await failureOf(terrainRangeSource(URL_).getBytes(0, 10))).toStrictEqual({
      kind: 'http',
      status: 503,
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
    );
    expect(await failureOf(terrainRangeSource(URL_).getBytes(0, 10))).toStrictEqual({
      kind: 'network',
    });
    const stop = new AbortController();
    stop.abort();
    expect(await failureOf(terrainRangeSource(URL_).getBytes(0, 10, stop.signal))).toStrictEqual({
      kind: 'aborted',
    });
  });

  it('refuses a file replaced mid-read, and ignores a weak etag', async () => {
    respond(206, new Uint8Array(10), { etag: '"second"' });
    expect(
      await failureOf(terrainRangeSource(URL_).getBytes(0, 10, undefined, '"first"')),
    ).toStrictEqual({ kind: 'changed' });
    respond(206, new Uint8Array(10), { etag: 'W/"second"' });
    const answer = await terrainRangeSource(URL_).getBytes(0, 10, undefined, '"first"');
    expect(answer.etag).toBeUndefined();
  });
});

describe('a failure’s words', () => {
  const failures: TerrainFailure[] = [
    { kind: 'aborted' },
    { kind: 'network' },
    { kind: 'http', status: 503 },
    { kind: 'not-a-range' },
    { kind: 'changed' },
    { kind: 'too-large', limit: MAX_TILE_BYTES },
    { kind: 'compression' },
    { kind: 'wrong-archive' },
  ];

  it('says each one differently, and names no tile, no coordinate and no address', () => {
    const words = failures.map(describeTerrainFailure);
    expect(new Set(words).size).toBe(failures.length);
    for (const sentence of words) {
      expect(sentence).not.toMatch(/https?:|\d+\/\d+|\d+\.\d+/);
      // The only numbers are a status, a limit and the zoom this reads at.
      expect(sentence.replace(/HTTP 503|4194304|zoom 12/g, '')).not.toMatch(/\d/);
    }
  });

  it('carries its failure, and anything else thrown reads as the network', () => {
    expect(terrainFailureOf(new Error('boom'))).toStrictEqual({ kind: 'network' });
  });
});
