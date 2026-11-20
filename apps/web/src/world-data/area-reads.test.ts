// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The open-world read over the product's own archive source — #2890, ADR 0090
 * R-1 and R-2. `game/world-data/area.ts` reads through
 * `corridor-source.ts` §`corridorArchiveFrom(archiveSource(url))`, the one
 * module with the one request (D-3), and `fetch` is stubbed with a host that
 * serves a synthetic PMTiles archive by byte range. What the host is asked is
 * what these tests read back: the `Range` headers, in order.
 */

import { MAX_TILE_BYTES, type TileId } from '@onyourleft/map-features';
import { residentialBlockTile, tileOverLimit } from '@onyourleft/map-features/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  blockOf,
  blocksAround,
  createAreaReader,
  tilesOfBlock,
  type AreaPosition,
  type BlockId,
} from '../game/world-data/area';
import { describeCorridorFailure } from '../game/world-data/corridor';
import { buildArchive, pmtilesTileId, type ArchiveTile } from './archive-testing';
import { archiveSource, corridorArchiveFrom } from './corridor-source';
import { HOSTILE_TILES } from './hostile-tiles-testing';

const URL_ = 'https://tiles.example.org/basemap-us.pmtiles';

/** The block `FIXTURE_TILE` (#1544's) is in: z14 (4685, 6269). */
const BLOCK: BlockId = { x: 4685, y: 6269 };

const latitudeAt = (row: number): number =>
  (Math.atan(Math.sinh(Math.PI * (1 - (2 * row) / 2 ** 14))) * 180) / Math.PI;

/** A point `(fx, fy)` of the way across `block`. */
const inside = (block: BlockId, fx: number, fy: number): AreaPosition => ({
  longitude: -180 + ((block.x + fx) / 2 ** 14) * 360,
  latitude: latitudeAt(block.y + fy),
});

const START = inside(BLOCK, 0.5, 0.5);

/** What the stubbed host does with a request for tile data, instead of answering it. */
type Tamper = (range: { offset: number; length: number }, body: Uint8Array) => Response | undefined;

/** A host serving `archive` by byte range; every request's `Range`, in order. */
function serve(archive: Uint8Array, tamper?: Tamper): { ranges: string[]; lengths: number[] } {
  const dataOffset = new DataView(archive.buffer, archive.byteOffset).getUint32(56, true);
  const ranges: string[] = [];
  const lengths: number[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init: RequestInit) => {
      expect(url).toBe(URL_);
      const range = new Headers(init.headers).get('range') ?? '';
      ranges.push(range);
      const [from, to] = range.replace('bytes=', '').split('-').map(Number) as [number, number];
      lengths.push(to - from + 1);
      const body = archive.slice(from, to + 1);
      const tampered =
        from >= dataOffset ? tamper?.({ offset: from, length: to - from + 1 }, body) : undefined;
      return Promise.resolve(
        tampered ?? new Response(body as BodyInit, { status: 206, headers: { etag: '"a1"' } }),
      );
    }),
  );
  return { ranges, lengths };
}

/** Every z15 tile of the 3 × 3 round `block`, each `bytes` — `centre` overriding the centre block's. */
function tilesAround(
  block: BlockId,
  bytes: () => Uint8Array,
  centre?: (tile: TileId, index: number) => Uint8Array,
): ArchiveTile[] {
  return blocksAround(block).flatMap((b, blockIndex) =>
    tilesOfBlock(b).map((tile, index) => ({
      x: tile.x,
      y: tile.y,
      bytes: blockIndex === 0 && centre !== undefined ? centre(tile, index) : bytes(),
    })),
  );
}

function areaReader(log: string[] = []) {
  return createAreaReader({
    archive: corridorArchiveFrom(archiveSource(URL_)),
    mapTilesOn: () => true,
    random: () => 0,
    yieldToIdle: () => Promise.resolve(),
    log: (line) => log.push(line),
  });
}

/**
 * Every spelling of the place a failure must not name (R-2): the start's
 * coordinates at every precision, each z15 tile's `x`, `y`, `z/x/y` and PMTiles
 * id, and each block's `x`, `y` and `z/x/y`.
 */
function placesOf(blocks: readonly BlockId[]): string[] {
  const out: string[] = [];
  for (const value of [START.latitude, START.longitude]) {
    out.push(String(Math.trunc(value)));
    for (let digits = 1; digits <= 6; digits++) out.push(value.toFixed(digits));
  }
  for (const block of blocks) {
    out.push(String(block.x), String(block.y), `14/${String(block.x)}/${String(block.y)}`);
    for (const tile of tilesOfBlock(block)) {
      out.push(String(tile.x), String(tile.y), `15/${String(tile.x)}/${String(tile.y)}`);
      out.push(String(pmtilesTileId(15, tile.x, tile.y)));
    }
  }
  return out;
}

function expectNoPlace(lines: readonly string[]): void {
  const places = placesOf(blocksAround(BLOCK));
  for (const line of lines) {
    expect(line.startsWith('Towns from map data: ')).toBe(true);
    for (const place of places) expect(line, `"${line}" names ${place}`).not.toContain(place);
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('R-1: the host sees the same byte ranges from any start inside one block', () => {
  it('two starts at opposite corners of a block send an identical sequence of ranges', async () => {
    const archive = await buildArchive({ tiles: tilesAround(BLOCK, residentialBlockTile) });
    const one = serve(archive);
    expect(await areaReader().start(inside(BLOCK, 0.02, 0.03))).toStrictEqual({ kind: 'ready' });
    const two = serve(archive);
    expect(await areaReader().start(inside(BLOCK, 0.97, 0.98))).toStrictEqual({ kind: 'ready' });
    expect(one.ranges.length).toBeGreaterThan(36);
    expect(two.ranges).toStrictEqual(one.ranges);
  });

  it('a start in the next block sends a different sequence — the comparison can tell', async () => {
    const east = { x: BLOCK.x + 1, y: BLOCK.y };
    const archive = await buildArchive({
      tiles: [
        ...tilesAround(BLOCK, residentialBlockTile),
        ...[-1, 0, 1].flatMap((dy) =>
          tilesOfBlock({ x: BLOCK.x + 2, y: BLOCK.y + dy }).map((t) => ({
            x: t.x,
            y: t.y,
            bytes: residentialBlockTile(),
          })),
        ),
      ],
    });
    const one = serve(archive);
    await areaReader().start(START);
    const two = serve(archive);
    expect(blockOf(inside(east, 0.5, 0.5))).toStrictEqual(east);
    await areaReader().start(inside(east, 0.5, 0.5));
    expect(two.ranges).not.toStrictEqual(one.ranges);
  });
});

describe('R-2: every failure is said without a coordinate, a tile id or a block id', () => {
  const cases: {
    name: string;
    tiles: () => ArchiveTile[];
    tamper?: Tamper;
  }[] = [
    {
      name: 'an HTTP error for a tile',
      tiles: () => tilesAround(BLOCK, residentialBlockTile),
      tamper: () => new Response(null, { status: 503 }),
    },
    {
      name: 'a short range: the tile’s bytes cut off',
      tiles: () => tilesAround(BLOCK, residentialBlockTile),
      tamper: (_range, body) =>
        new Response(body.slice(0, Math.max(1, body.length >> 1)) as BodyInit, {
          status: 206,
          headers: { etag: '"a1"' },
        }),
    },
    {
      name: 'a tile over limits.ts',
      tiles: () =>
        tilesAround(BLOCK, residentialBlockTile, (_tile, index) =>
          index === 0 ? tileOverLimit('verticesPerTile') : residentialBlockTile(),
        ),
    },
    {
      name: 'a decode error',
      tiles: () =>
        tilesAround(BLOCK, residentialBlockTile, (_tile, index) =>
          index === 0 ? Uint8Array.of(0x0a, 0x05, 0x08) : residentialBlockTile(),
        ),
    },
  ];

  it.each(cases)('$name', async ({ tiles, tamper }) => {
    const archive = await buildArchive({ tiles: tiles() });
    serve(archive, tamper);
    const log: string[] = [];
    const area = areaReader(log);
    const outcome = await area.start(START);
    expect(['ready', 'unavailable']).toContain(outcome.kind);
    expect(log.length).toBeGreaterThan(0);
    expectNoPlace(log);
  });
});

describe('hostile tiles are refused with memory bounded and no crash', () => {
  it.each(HOSTILE_TILES)('$name', async (fixture) => {
    const archive = await buildArchive({
      gzip: fixture.gzip,
      tiles: tilesAround(BLOCK, residentialBlockTile, (_tile, index) =>
        index === 0 ? fixture.bytes() : residentialBlockTile(),
      ),
    });
    const host = serve(archive);
    // Every byte a decompression hands on, counted, so a bomb's bound is read
    // off what was produced and not off the error alone.
    let produced = 0;
    const Real = globalThis.DecompressionStream;
    vi.stubGlobal(
      'DecompressionStream',
      class {
        readonly writable: WritableStream<BufferSource>;
        readonly readable: ReadableStream<Uint8Array>;
        constructor(format: CompressionFormat) {
          const inner = new Real(format);
          this.writable = inner.writable;
          this.readable = inner.readable.pipeThrough(
            new TransformStream<Uint8Array, Uint8Array>({
              transform(chunk, controller) {
                produced += chunk.byteLength;
                controller.enqueue(chunk);
              },
            }),
          );
        }
      },
    );
    const log: string[] = [];
    const area = areaReader(log);
    expect(await area.start(START)).toStrictEqual({ kind: 'ready' });
    expect(log).toContain(describeCorridorFailure(fixture.refusedAs));
    expectNoPlace(log);
    // The rest of the centre block, and the other eight, are held all the same.
    const centre = area.held().find((h) => h.block.x === BLOCK.x && h.block.y === BLOCK.y);
    expect(centre?.tiles.filter((t) => t.state === 'covered')).toHaveLength(3);
    expect(centre?.tiles.filter((t) => t.state === 'refused')).toHaveLength(1);
    expect(area.held()).toHaveLength(9);
    // Memory: nothing longer than a tile may be was ever asked of the host,
    // and no decompression produced more than the limit and one chunk past it.
    expect(Math.max(...host.lengths)).toBeLessThanOrEqual(MAX_TILE_BYTES);
    expect(produced).toBeLessThanOrEqual(MAX_TILE_BYTES + 1024 * 1024);
  });
});
