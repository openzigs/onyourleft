// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The one module that asks the archive for bytes — #1539, ADR 0054 D-2.5:
 * what a request carries, what a response must be to be read, and the bound
 * on decompression. Read back through `PMTiles`, the reader the product uses.
 */

import { decodeTile, MAX_TILE_BYTES, type DecodedTile } from '@onyourleft/map-features';
import {
  FIXTURE_FRAME,
  FIXTURE_TILE,
  RESIDENTIAL_FOOTPRINTS,
  residentialBlockTile,
} from '@onyourleft/map-features/testing';
import { Compression, zxyToTileId } from 'pmtiles';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { failureOf } from '../game/world-data/corridor';
import {
  buildArchive,
  countingSource,
  pmtilesTileId,
  SYNTHETIC_V4_METADATA,
} from './archive-testing';
import {
  archiveSource,
  boundedDecompress,
  corridorArchive,
  corridorArchiveFrom,
  isProtomapsV4,
} from './corridor-source';

const signal = (): AbortSignal => new AbortController().signal;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the synthetic archive is a PMTiles v3 archive', () => {
  it('numbers tiles as the pmtiles package does', () => {
    for (const [x, y] of [
      [0, 0],
      [FIXTURE_TILE.x, FIXTURE_TILE.y],
      [32_767, 32_767],
      [16_383, 10_000],
      [1, 32_766],
    ] as const) {
      expect(pmtilesTileId(15, x, y)).toBe(zxyToTileId(15, x, y));
    }
  });
});

describe('corridorArchiveFrom reads through PMTiles', () => {
  const tiles = [
    { x: FIXTURE_TILE.x, y: FIXTURE_TILE.y, bytes: residentialBlockTile() },
    { x: FIXTURE_TILE.x + 1, y: FIXTURE_TILE.y, bytes: residentialBlockTile() },
  ];

  it('opens with the header etag as its identity and the header bounds', async () => {
    const bytes = await buildArchive({
      tiles,
      bounds: { west: -125, south: 24, east: -66, north: 50 },
    });
    const opening = await corridorArchiveFrom(countingSource(bytes, '"etag-a"')).open(signal());
    expect(opening).toStrictEqual({
      kind: 'open',
      identity: '"etag-a"',
      bounds: { west: -125, south: 24, east: -66, north: 50 },
    });
  });

  it('identifies an archive whose host sends no etag by a digest of its header', async () => {
    const bytes = await buildArchive({ tiles });
    const opening = await corridorArchiveFrom(countingSource(bytes, null)).open(signal());
    expect(opening.kind === 'open' && opening.identity).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('hands back a gzipped tile decompressed, and it decodes to the fixture', async () => {
    const archive = corridorArchiveFrom(countingSource(await buildArchive({ tiles })));
    await archive.open(signal());
    const raw = await archive.tile(FIXTURE_TILE, signal());
    expect(raw).toBeDefined();
    const decoded = decodeTile(raw as Uint8Array, FIXTURE_TILE, FIXTURE_FRAME) as DecodedTile;
    expect(decoded.buildings).toHaveLength(RESIDENTIAL_FOOTPRINTS.length);
  });

  it('answers undefined for a tile the archive does not hold', async () => {
    const archive = corridorArchiveFrom(countingSource(await buildArchive({ tiles })));
    expect(await archive.tile({ z: 15, x: 5, y: 5 }, signal())).toBeUndefined();
  });

  it('reads nothing from an archive that is not Protomaps basemap v4', async () => {
    for (const metadata of [
      { name: 'Protomaps Basemap', version: '3.7.0' },
      { name: 'OpenMapTiles', version: '4.0.0' },
      {},
    ]) {
      const bytes = await buildArchive({ tiles, metadata });
      const opening = await corridorArchiveFrom(countingSource(bytes)).open(signal());
      expect(opening).toStrictEqual({ kind: 'wrong-schema' });
    }
    const shallow = await buildArchive({ tiles, maxZoom: 14 });
    expect(await corridorArchiveFrom(countingSource(shallow)).open(signal())).toStrictEqual({
      kind: 'wrong-schema',
    });
  });

  it('accepts the schema by name and major version', () => {
    expect(isProtomapsV4(SYNTHETIC_V4_METADATA)).toBe(true);
    expect(isProtomapsV4({ name: 'Protomaps Basemap', version: '4.0.0' })).toBe(true);
    expect(isProtomapsV4({ name: 'Protomaps Basemap', version: '40.0' })).toBe(false);
    expect(isProtomapsV4(null)).toBe(false);
  });

  it('stops waiting when its signal aborts', async () => {
    const controller = new AbortController();
    controller.abort();
    const archive = corridorArchiveFrom(countingSource(await buildArchive({ tiles })));
    await expect(archive.open(controller.signal)).rejects.toThrow();
  });
});

describe('boundedDecompress', () => {
  const gzip = async (bytes: Uint8Array): Promise<ArrayBuffer> =>
    new Response(
      new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream('gzip')),
    ).arrayBuffer();

  it('inflates a tile under the bound', async () => {
    const out = await boundedDecompress(await gzip(new Uint8Array(1000).fill(7)), Compression.Gzip);
    expect(new Uint8Array(out)).toStrictEqual(new Uint8Array(1000).fill(7));
  });

  it('refuses a gzip bomb the moment it passes the bound, as too-large', async () => {
    // 64 KiB of zeros compresses to a few dozen bytes; a 4 KiB bound refuses it.
    const bomb = await gzip(new Uint8Array(64 * 1024));
    expect(bomb.byteLength).toBeLessThan(1024);
    const refused = await boundedDecompress(bomb, Compression.Gzip, 4096).catch((e: unknown) => e);
    expect(failureOf(refused)).toStrictEqual({ kind: 'too-large', limit: 4096 });
  });

  it('refuses an uncompressed part over the bound, and a compression it does not read', async () => {
    const big = await boundedDecompress(new ArrayBuffer(10), Compression.None, 5).catch(
      (e: unknown) => e,
    );
    expect(failureOf(big)).toStrictEqual({ kind: 'too-large', limit: 5 });
    const brotli = await boundedDecompress(new ArrayBuffer(1), Compression.Brotli).catch(
      (e: unknown) => e,
    );
    expect(failureOf(brotli)).toStrictEqual({ kind: 'compression' });
  });
});

describe('archiveSource: the one fetch', () => {
  const URL_ = 'https://tiles.example.org/basemap-us.pmtiles';

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
    const answer = await archiveSource(URL_).getBytes(100, 10);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(URL_);
    expect(calls[0]?.init.credentials).toBe('omit');
    const headers = new Headers(calls[0]?.init.headers);
    expect([...headers.keys()]).toStrictEqual(['range']);
    expect(headers.get('range')).toBe('bytes=100-109');
    expect(answer.etag).toBe('"e"');
  });

  it('is pointed at readBasemapConfig’s archiveUrl and no other', async () => {
    const calls = respond(206, new Uint8Array(127));
    await corridorArchive({ archiveUrl: URL_, attribution: '' })
      .open(signal())
      .catch(() => undefined);
    expect(calls.length).toBeGreaterThan(0);
    expect(new Set(calls.map((call) => call.url))).toStrictEqual(new Set([URL_]));
  });

  it('refuses a whole-file 200 larger than the range, unread', async () => {
    respond(200, new Uint8Array(50), { 'content-length': '50' });
    const refused = await archiveSource(URL_)
      .getBytes(0, 10)
      .catch((e: unknown) => e);
    expect(failureOf(refused)).toStrictEqual({ kind: 'not-a-range' });
  });

  it('does not read the body of a whole-file 200 — the 19 GB archive a host ignoring Range would send', async () => {
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
          new Response(endless, { status: 200, headers: { 'content-length': '19155814749' } }),
        ),
      ),
    );
    const refused = await archiveSource(URL_)
      .getBytes(0, 16_384)
      .catch((e: unknown) => e);
    expect(failureOf(refused)).toStrictEqual({ kind: 'not-a-range' });
    expect(pulled).toBeLessThan(5);
  });

  it('accepts a 200 for a file no longer than the range', async () => {
    respond(200, new Uint8Array(8), { 'content-length': '8' });
    expect((await archiveSource(URL_).getBytes(0, 16)).data.byteLength).toBe(8);
  });

  it('refuses a range answered with more bytes than were asked for', async () => {
    respond(206, new Uint8Array(20));
    const refused = await archiveSource(URL_)
      .getBytes(0, 10)
      .catch((e: unknown) => e);
    expect(failureOf(refused)).toStrictEqual({ kind: 'not-a-range' });
  });

  it('asks for no range longer than a tile may be, so no body that size is ever read', async () => {
    const calls = respond(206, new Uint8Array(10));
    const refused = await archiveSource(URL_)
      .getBytes(0, MAX_TILE_BYTES + 1)
      .catch((e: unknown) => e);
    expect(failureOf(refused)).toStrictEqual({ kind: 'not-a-range' });
    expect(calls).toHaveLength(0);
  });

  it('says an HTTP error, and a file that changed under the read', async () => {
    respond(404, new Uint8Array(0));
    expect(
      failureOf(
        await archiveSource(URL_)
          .getBytes(0, 10)
          .catch((e: unknown) => e),
      ),
    ).toStrictEqual({
      kind: 'http',
      status: 404,
    });
    respond(206, new Uint8Array(10), { etag: '"new"' });
    const changed = await archiveSource(URL_)
      .getBytes(0, 10, undefined, '"old"')
      .catch((e: unknown) => e);
    expect(failureOf(changed)).toStrictEqual({ kind: 'changed' });
  });

  it('says a refused network as network, and an abort as aborted', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
    );
    expect(
      failureOf(
        await archiveSource(URL_)
          .getBytes(0, 10)
          .catch((e: unknown) => e),
      ),
    ).toStrictEqual({
      kind: 'network',
    });
    const controller = new AbortController();
    controller.abort();
    expect(
      failureOf(
        await archiveSource(URL_)
          .getBytes(0, 10, controller.signal)
          .catch((e: unknown) => e),
      ),
    ).toStrictEqual({ kind: 'aborted' });
  });
});
