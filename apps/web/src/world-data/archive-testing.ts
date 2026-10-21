// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A PMTiles v3 archive of synthetic z15 tiles, and a `pmtiles` source over it
 * that counts what is asked of it — #1539's test support.
 *
 * ⚠️ **A `-testing.ts` file** (`check-wiring.mjs` §`isTestSupport`): imported
 * by Vitest suites and by `browser/corridor-fixture.ts`, never by anything
 * that ships. It contains **no OpenStreetMap data**: every tile is one of
 * #1544's hand-written fixtures (`@onyourleft/map-features/testing`), placed
 * at whatever tile ids a test's route covers.
 *
 * Written from the PMTiles v3 specification rather than with the `pmtiles`
 * package, which only `world-data/corridor-source.ts` and `map/maplibre.ts`
 * may import (`game/world-data/corridor-origin.test.ts`).
 */

import type { TileId } from '@onyourleft/map-features';

import { streamBytes } from '../game/world-data/corridor';
import type { RangeResponse, Source } from 'pmtiles';

/** One tile of the archive. */
export interface ArchiveTile {
  readonly x: number;
  readonly y: number;
  /** The tile's MVT bytes, uncompressed; the archive gzips them when asked to. */
  readonly bytes: Uint8Array;
}

export interface ArchiveOptions {
  readonly tiles: readonly ArchiveTile[];
  /** Header bounds in degrees. The whole world when absent. */
  readonly bounds?: { west: number; south: number; east: number; north: number } | undefined;
  /** The JSON metadata. Protomaps basemap v4's name and version when absent. */
  readonly metadata?: Record<string, unknown> | undefined;
  /** Whether tiles are stored gzipped (Compression 2) or plain (1). */
  readonly gzip?: boolean | undefined;
  /** The header's max zoom: 15 when absent. */
  readonly maxZoom?: number | undefined;
}

/** What a synthetic archive declares itself to be, so the reader's schema check passes. */
export const SYNTHETIC_V4_METADATA: Record<string, unknown> = {
  name: 'Protomaps Basemap',
  version: '4.15.2',
  description:
    'Synthetic geometry in the Protomaps basemap v4 schema, for tests. Contains no OpenStreetMap data.',
  vector_layers: [],
};

const HEADER_BYTES = 127;

function writeVarint(out: number[], value: number): void {
  let rest = value;
  while (rest >= 0x80) {
    out.push((rest % 0x80) | 0x80);
    rest = Math.floor(rest / 0x80);
  }
  out.push(rest);
}

/** PMTiles v3 §"Tile ID": tiles counted by zoom, then along a Hilbert curve. */
export function pmtilesTileId(z: number, x: number, y: number): number {
  // Bitwise throughout: z15 fits in 32 bits, and the rotation's arithmetic
  // relies on two's complement for the bits above the current level.
  let id = (4 ** z - 1) / 3;
  let tx = x;
  let ty = y;
  for (let s = 1 << (z - 1); s > 0; s >>= 1) {
    const rx = tx & s;
    const ry = ty & s;
    id += ((3 * rx) ^ ry) * s;
    if (ry === 0) {
      [tx, ty] = rx !== 0 ? [s - 1 - ty, s - 1 - tx] : [ty, tx];
    }
  }
  return id;
}

async function gzipped(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream('gzip'));
  return streamBytes(stream);
}

/** The archive's bytes: header, root directory, metadata, tile data. No leaf directories. */
export async function buildArchive(options: ArchiveOptions): Promise<Uint8Array> {
  const gzip = options.gzip ?? true;
  const bounds = options.bounds ?? { west: -180, south: -85, east: 180, north: 85 };
  const entries = await Promise.all(
    options.tiles.map(async (tile) => ({
      id: pmtilesTileId(15, tile.x, tile.y),
      data: gzip ? await gzipped(tile.bytes) : tile.bytes,
    })),
  );
  entries.sort((a, b) => a.id - b.id);

  const directory: number[] = [];
  writeVarint(directory, entries.length);
  let previous = 0;
  for (const entry of entries) {
    writeVarint(directory, entry.id - previous);
    previous = entry.id;
  }
  for (let index = 0; index < entries.length; index++) writeVarint(directory, 1);
  for (const entry of entries) writeVarint(directory, entry.data.length);
  let offset = 0;
  for (const entry of entries) {
    // Offset + 1: a stored 0 means "straight after the previous entry".
    writeVarint(directory, offset + 1);
    offset += entry.data.length;
  }
  const metadata = new TextEncoder().encode(
    JSON.stringify(options.metadata ?? SYNTHETIC_V4_METADATA),
  );

  const rootOffset = HEADER_BYTES;
  const metadataOffset = rootOffset + directory.length;
  const dataOffset = metadataOffset + metadata.length;
  const bytes = new Uint8Array(dataOffset + offset);
  const view = new DataView(bytes.buffer);
  const setUint64 = (at: number, value: number): void => {
    view.setUint32(at, value % 0x1_0000_0000, true);
    view.setUint32(at + 4, Math.floor(value / 0x1_0000_0000), true);
  };
  bytes.set(new TextEncoder().encode('PMTiles'), 0);
  view.setUint8(7, 3);
  setUint64(8, rootOffset);
  setUint64(16, directory.length);
  setUint64(24, metadataOffset);
  setUint64(32, metadata.length);
  setUint64(40, dataOffset);
  setUint64(48, 0);
  setUint64(56, dataOffset);
  setUint64(64, offset);
  setUint64(72, entries.length);
  setUint64(80, entries.length);
  setUint64(88, entries.length);
  view.setUint8(96, 1);
  view.setUint8(97, 1);
  view.setUint8(98, gzip ? 2 : 1);
  view.setUint8(99, 1);
  view.setUint8(100, 0);
  view.setUint8(101, options.maxZoom ?? 15);
  view.setInt32(102, Math.round(bounds.west * 1e7), true);
  view.setInt32(106, Math.round(bounds.south * 1e7), true);
  view.setInt32(110, Math.round(bounds.east * 1e7), true);
  view.setInt32(114, Math.round(bounds.north * 1e7), true);
  bytes.set(Uint8Array.from(directory), rootOffset);
  bytes.set(metadata, metadataOffset);
  let at = dataOffset;
  for (const entry of entries) {
    bytes.set(entry.data, at);
    at += entry.data.length;
  }
  return bytes;
}

/** A `pmtiles` source over an archive in memory, which counts and can be told to fail. */
export interface CountingSource extends Source {
  /** Every `getBytes` call, in order. */
  readonly calls: { readonly offset: number; readonly length: number }[];
  /** Replace the bytes (a new archive) and the etag. */
  replace(bytes: Uint8Array, etag: string | undefined): void;
  /** `true`: every call rejects, as a refused network does. */
  offline: boolean;
}

/** `etag` `null`: the host sends none. */
export function countingSource(
  bytes: Uint8Array,
  etag: string | null = '"fixture-1"',
): CountingSource {
  let archive = bytes;
  let tag: string | undefined = etag ?? undefined;
  const calls: { offset: number; length: number }[] = [];
  const source: CountingSource = {
    calls,
    offline: false,
    replace(next, nextTag) {
      archive = next;
      tag = nextTag;
    },
    getKey: () => 'https://tiles.example.invalid/fixture.pmtiles',
    getBytes: (offset, length, signal) => {
      calls.push({ offset, length });
      if (source.offline) return Promise.reject(new TypeError('Failed to fetch'));
      if (signal?.aborted === true)
        return Promise.reject(new DOMException('aborted', 'AbortError'));
      const data = archive.slice(offset, offset + length).buffer;
      const now = tag;
      const response: RangeResponse = now === undefined ? { data } : { data, etag: now };
      return Promise.resolve(response);
    },
  };
  return source;
}

/** Every distinct z15 tile a list of `getBytes` calls reached, read back through the archive's directory. */
export function tilesRequested(
  tiles: readonly ArchiveTile[],
  archiveBytes: Uint8Array,
  calls: readonly { offset: number; length: number }[],
): TileId[] {
  const view = new DataView(archiveBytes.buffer, archiveBytes.byteOffset);
  const dataOffset = view.getUint32(56, true);
  // Recompute each tile's byte span in the order `buildArchive` wrote them.
  const sorted = [...tiles].sort(
    (a, b) => pmtilesTileId(15, a.x, a.y) - pmtilesTileId(15, b.x, b.y),
  );
  const directoryLength = view.getUint32(16, true);
  const spans = readSpans(archiveBytes.subarray(HEADER_BYTES, HEADER_BYTES + directoryLength));
  const found: TileId[] = [];
  for (const call of calls) {
    spans.forEach((span, index) => {
      if (call.offset === dataOffset + span.offset && call.length === span.length) {
        const tile = sorted[index] as ArchiveTile;
        found.push({ z: 15, x: tile.x, y: tile.y });
      }
    });
  }
  return found;
}

function readSpans(directory: Uint8Array): { offset: number; length: number }[] {
  let at = 0;
  const read = (): number => {
    let value = 0;
    let scale = 1;
    for (;;) {
      const byte = directory[at] as number;
      at += 1;
      value += (byte & 0x7f) * scale;
      if (byte < 0x80) return value;
      scale *= 0x80;
    }
  };
  const count = read();
  for (let i = 0; i < count * 2; i++) read();
  const lengths = Array.from({ length: count }, read);
  const offsets = Array.from({ length: count }, () => read() - 1);
  return lengths.map((length, index) => ({ offset: offsets[index] as number, length }));
}
