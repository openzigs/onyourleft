// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The one module that asks the terrain archive for a height tile** — #2013,
 * ADR 0087 D-2.3.
 *
 * `world-data/corridor-source.ts` is its model, and the reasons are the same.
 *
 * ⚠️ **Its own `fetch`, never `pmtiles`' `FetchSource`.** A `fetch` inside a
 * dependency is invisible to `privacy/no-network.test.ts`, so the range
 * requests are made by {@link terrainRangeSource} here, and that test pins
 * this module to exactly one `fetch` (`PERMITTED_NETWORK_CALLS`). `PMTiles` is
 * handed that source, so it parses the header and directories and asks for
 * bytes only through it.
 *
 * **What a request carries**: a `Range` header on the one archive URL
 * `terrain/config.ts` §`readTerrainConfig` resolves — no coordinate, no route
 * id, no athlete id, no credential and no cookie (`credentials: 'omit'`), and
 * **never a `z/x/y` URL**, so the tile host's retained record names the same
 * file for every request. ⚠️ The byte ranges ARE a function of location: the
 * host can tell which z12 tiles were read, each about 7.5 to 9 km across. That
 * is why `privacy/boundaries.test.ts` declares this module `departing`. It is
 * not instance traffic: ADR 0036 D-3 (a)'s one instance module is untouched,
 * and a rider with no instance reads heights.
 *
 * **Untrusted bytes.** A response that is not the range asked for is refused
 * rather than read (a host that ignores `Range` would otherwise send the whole
 * 14 GB file); a directory is decompressed inside {@link MAX_TILE_BYTES}; and
 * an archive that is not WebP tiles reaching zoom 12, stored uncompressed, is
 * not read at all. A tile's own bytes are checked and decoded by
 * `terrain/decode.ts`.
 *
 * ⚠️ **No failure names a tile, a coordinate or the URL** (ADR 0004 D,
 * ADR 0090 R-2): {@link describeTerrainFailure} is the one place a failure
 * becomes detailed words, a `TerrainError`'s own message for a developer. The
 * rider is told one of two plain sentences instead (`heights.ts`
 * §`elevationFailureText`, the owner's ruling of 2026-11-24).
 */

import { HEIGHT_TILE_ZOOM, MAX_TILE_BYTES, type HeightTileId } from '@onyourleft/map-features';
import { Compression, PMTiles, TileType, type Source } from 'pmtiles';

import type { TerrainConfig } from './config';

/** Why a read of the archive failed. Never a tile id, a coordinate or a URL. */
export type TerrainFailure =
  | { readonly kind: 'aborted' }
  | { readonly kind: 'network' }
  | { readonly kind: 'http'; readonly status: number }
  | { readonly kind: 'not-a-range' }
  | { readonly kind: 'changed' }
  | { readonly kind: 'too-large'; readonly limit: number }
  | { readonly kind: 'compression' }
  | { readonly kind: 'wrong-archive' };

/** A failed read, carrying its {@link TerrainFailure}. */
export class TerrainError extends Error {
  readonly failure: TerrainFailure;

  constructor(failure: TerrainFailure) {
    super(describeTerrainFailure(failure));
    this.name = 'TerrainError';
    this.failure = failure;
  }
}

/** A failure, in words (ADR 0004 D: the constraint, never a place). */
export function describeTerrainFailure(failure: TerrainFailure): string {
  switch (failure.kind) {
    case 'aborted':
      return 'The terrain read was stopped before it finished.';
    case 'network':
      return 'The terrain archive could not be reached.';
    case 'http':
      return `The terrain archive’s host answered with HTTP ${String(failure.status)}.`;
    case 'not-a-range':
      return 'The terrain archive’s host did not answer with the byte range asked for.';
    case 'changed':
      return 'The terrain archive changed while it was being read.';
    case 'too-large':
      return `A part of the terrain archive is larger than the limit of ${String(failure.limit)} bytes.`;
    case 'compression':
      return 'The terrain archive is compressed in a way this app does not read.';
    case 'wrong-archive':
      return 'The configured terrain archive is not an archive of WebP height tiles that reaches zoom 12.';
  }
}

/** The failure an unknown thrown value stands for: its own, or a network failure. */
export function terrainFailureOf(error: unknown): TerrainFailure {
  return error instanceof TerrainError ? error.failure : { kind: 'network' };
}

/**
 * Decompresses a directory of the archive, refusing at {@link MAX_TILE_BYTES}.
 * A tile is stored uncompressed (the header says so, and {@link terrainArchiveFrom}
 * refuses an archive whose header says otherwise), so only directories and the
 * metadata come through the gzip branch.
 */
export async function boundedTerrainDecompress(
  buffer: ArrayBuffer,
  compression: Compression,
  limit = MAX_TILE_BYTES,
): Promise<ArrayBuffer> {
  if (compression === Compression.None || compression === Compression.Unknown) {
    if (buffer.byteLength > limit) throw new TerrainError({ kind: 'too-large', limit });
    return buffer;
  }
  if (compression !== Compression.Gzip) throw new TerrainError({ kind: 'compression' });
  const reader = new Blob([buffer])
    .stream()
    .pipeThrough(new DecompressionStream('gzip'))
    .getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      throw new TerrainError({ kind: 'too-large', limit });
    }
    parts.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.byteLength;
  }
  return out.buffer;
}

/**
 * A `pmtiles` source over this module's one `fetch`: a byte range of the one
 * archive file, and nothing else.
 */
export function terrainRangeSource(url: string): Source {
  return {
    getKey: () => url,
    getBytes: async (offset, length, signal, etag) => {
      // The length comes from the archive's own directory, which is untrusted:
      // no body longer than a tile may be is ever asked for, or read.
      if (length > MAX_TILE_BYTES) throw new TerrainError({ kind: 'not-a-range' });
      const headers = new Headers({
        Range: `bytes=${String(offset)}-${String(offset + length - 1)}`,
      });
      let response: Response;
      try {
        response = await fetch(url, {
          headers,
          credentials: 'omit',
          ...(signal === undefined ? {} : { signal }),
        });
      } catch {
        throw new TerrainError(
          signal?.aborted === true ? { kind: 'aborted' } : { kind: 'network' },
        );
      }
      if (response.status !== 206 && response.status !== 200) {
        throw new TerrainError({ kind: 'http', status: response.status });
      }
      // A 200 is the whole file. Accepted only when the whole file is no
      // longer than the range — a small archive — and refused unread otherwise.
      const declared = Number(response.headers.get('content-length') ?? Number.NaN);
      if (response.status === 200 && !(declared <= length)) {
        await response.body?.cancel();
        throw new TerrainError({ kind: 'not-a-range' });
      }
      const data = await response.arrayBuffer();
      if (data.byteLength > length) throw new TerrainError({ kind: 'not-a-range' });
      // A strong etag that differs from the header's is a file replaced
      // mid-read: refused, never spliced. A weak one says nothing about bytes.
      const raw = response.headers.get('etag');
      const tag = raw === null || raw.startsWith('W/') ? undefined : raw;
      if (etag !== undefined && tag !== undefined && tag !== etag) {
        throw new TerrainError({ kind: 'changed' });
      }
      return tag === undefined ? { data } : { data, etag: tag };
    },
  };
}

/** The archive, as the heights read sees it. */
export interface TerrainArchive {
  /**
   * One z12 tile's bytes, exactly as stored; `undefined` where the archive
   * holds none (outside its extract).
   *
   * @throws {TerrainError} when the archive could not be read.
   */
  tile(tile: HeightTileId, signal?: AbortSignal): Promise<Uint8Array | undefined>;
}

/**
 * The read's view of an archive, over any `pmtiles` source — the product's is
 * {@link terrainRangeSource}; a test hands one that counts.
 */
export function terrainArchiveFrom(source: Source): TerrainArchive {
  // One reader for as long as it works, so its header and directory cache
  // serve every tile read through it.
  let opened: Promise<PMTiles> | undefined;
  const open = async (): Promise<PMTiles> => {
    const reader = new PMTiles(source, undefined, (buffer, compression) =>
      boundedTerrainDecompress(buffer, compression),
    );
    const header = await reader.getHeader();
    const uncompressed =
      header.tileCompression === Compression.None || header.tileCompression === Compression.Unknown;
    if (
      header.tileType !== TileType.Webp ||
      !uncompressed ||
      header.minZoom > HEIGHT_TILE_ZOOM ||
      header.maxZoom < HEIGHT_TILE_ZOOM
    ) {
      throw new TerrainError({ kind: 'wrong-archive' });
    }
    return reader;
  };
  return {
    tile: async (tile, signal) => {
      try {
        opened ??= open();
        const reader = await opened;
        const answer = await reader.getZxy(tile.z, tile.x, tile.y, signal);
        return answer === undefined ? undefined : new Uint8Array(answer.data);
      } catch (error) {
        const failure: TerrainFailure =
          signal?.aborted === true ? { kind: 'aborted' } : terrainFailureOf(error);
        // ⚠️ `pmtiles` keeps a failed header or directory read as a rejected
        // promise in its cache, so a reader that failed once would fail for
        // good: a rider who was offline for one read would have no heights
        // for the rest of the session. The reader is dropped, and the next
        // read opens a new one. An archive of the wrong kind stays refused:
        // asking again cannot change what it is.
        if (failure.kind !== 'wrong-archive') opened = undefined;
        throw new TerrainError(failure);
      }
    },
  };
}

/** The product's archive: the configured terrain URL, and nothing else. */
export function terrainArchive(config: TerrainConfig): TerrainArchive {
  return terrainArchiveFrom(terrainRangeSource(config.archiveUrl));
}
