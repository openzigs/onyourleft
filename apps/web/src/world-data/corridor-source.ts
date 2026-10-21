// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The one module that asks the basemap archive for a route's corridor** —
 * #1539, ADR 0054 D-2.5.
 *
 * Outside `game/` on purpose (ADR 0054 D-1.1: `game/` names no network
 * primitive), and the only file under `apps/web/src/` besides `map/maplibre.ts`
 * that imports `pmtiles` — `game/world-data/corridor-origin.test.ts` fails if
 * a second appears.
 *
 * ⚠️ **Its own `fetch`, never `pmtiles`' `FetchSource`.** A `fetch` inside a
 * dependency is invisible to `privacy/no-network.test.ts`, so the range
 * requests are made by {@link archiveSource} here, and that test pins this
 * module to exactly one `fetch` (`PERMITTED_NETWORK_CALLS`). `PMTiles` is
 * handed that source, so it parses the header and directories and asks for
 * bytes only through it.
 *
 * **What a request carries** (ADR 0054 D-6.1): a `Range` header on the one
 * archive URL `map/basemap.ts` §`readBasemapConfig` resolves — no coordinate,
 * no route id, no athlete id, no credential and no cookie (`credentials:
 * 'omit'`), and **never a `z/x/y` URL**, so the tile host's retained record
 * names the same file for every request, as `apps/mobile/src/android/data-safety.ts`
 * says. ⚠️ The byte ranges ARE a function of location — the host can tell
 * which tiles were read — which is why `privacy/boundaries.ts` declares this
 * module `departing` and the read never asks for a tile near a privacy zone.
 *
 * **Untrusted bytes.** A response that is not the range asked for is refused
 * rather than read (a host that ignores `Range` would otherwise send the whole
 * 19 GB file), and {@link boundedDecompress} stops a gzip stream the moment it
 * passes {@link MAX_TILE_BYTES} — #1544's 4 MiB, the same bound its decoder
 * holds a decompressed tile to.
 */

import { MAX_TILE_BYTES, type TileId } from '@onyourleft/map-features';
import { Compression, PMTiles, TileType, type Source } from 'pmtiles';

import {
  corridorError,
  type ArchiveOpening,
  type CorridorArchive,
} from '../game/world-data/corridor';
import type { BasemapConfig } from '../map/basemap';

/**
 * Decompresses a part of the archive, refusing at {@link MAX_TILE_BYTES}.
 *
 * `PMTiles` calls this for tiles and for directories alike; a directory over
 * 4 MiB would be some 400 000 entries, which no archive builder writes, so the
 * one bound serves both.
 */
export async function boundedDecompress(
  buffer: ArrayBuffer,
  compression: Compression,
  limit = MAX_TILE_BYTES,
): Promise<ArrayBuffer> {
  if (compression === Compression.None || compression === Compression.Unknown) {
    if (buffer.byteLength > limit) throw corridorError({ kind: 'too-large', limit });
    return buffer;
  }
  if (compression !== Compression.Gzip) throw corridorError({ kind: 'compression' });
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
      throw corridorError({ kind: 'too-large', limit });
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
export function archiveSource(url: string): Source {
  return {
    getKey: () => url,
    getBytes: async (offset, length, signal, etag) => {
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
      } catch (error) {
        if (signal?.aborted === true) throw corridorError({ kind: 'aborted' });
        void error;
        throw corridorError({ kind: 'network' });
      }
      if (response.status !== 206 && response.status !== 200) {
        throw corridorError({ kind: 'http', status: response.status });
      }
      // A 200 is the whole file. Accepted only when the whole file is no
      // longer than the range — a small archive — and refused unread otherwise.
      const declared = Number(response.headers.get('content-length') ?? Number.NaN);
      if (response.status === 200 && !(declared <= length)) {
        await response.body?.cancel();
        throw corridorError({ kind: 'not-a-range' });
      }
      const data = await response.arrayBuffer();
      if (data.byteLength > length) throw corridorError({ kind: 'not-a-range' });
      // A weak etag says nothing about bytes, so it is not passed on (as
      // `pmtiles`' own source does not). A strong one that differs from the
      // header's is a file replaced mid-read: refused, never spliced.
      const raw = response.headers.get('etag');
      const tag = raw === null || raw.startsWith('W/') ? undefined : raw;
      if (etag !== undefined && tag !== undefined && tag !== etag) {
        throw corridorError({ kind: 'changed' });
      }
      return tag === undefined ? { data } : { data, etag: tag };
    },
  };
}

/** Whether the archive's metadata declares the Protomaps basemap v4 schema (ADR 0054 D-2). */
export function isProtomapsV4(metadata: unknown): boolean {
  if (typeof metadata !== 'object' || metadata === null) return false;
  const { name, version } = metadata as { name?: unknown; version?: unknown };
  return name === 'Protomaps Basemap' && typeof version === 'string' && /^4\./.test(version);
}

/** Rejects when `signal` aborts, so a header read that ignores it still stops being waited for. */
function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(corridorError({ kind: 'aborted' }));
  return new Promise<T>((resolve, reject) => {
    const stop = (): void => {
      reject(corridorError({ kind: 'aborted' }));
    };
    signal.addEventListener('abort', stop, { once: true });
    work.then(
      (value) => {
        signal.removeEventListener('abort', stop);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', stop);
        reject(error instanceof Error ? error : corridorError({ kind: 'network' }));
      },
    );
  });
}

/** A short digest of the header, for an archive whose host sends no etag. */
async function headerIdentity(source: Source): Promise<string> {
  const head = await source.getBytes(0, 127);
  if (head.etag !== undefined) return head.etag;
  const digest = await globalThis.crypto.subtle.digest('SHA-256', head.data);
  return `sha256:${Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * The read's view of an archive, over any `pmtiles` source — the product's is
 * {@link archiveSource}; a test hands one that counts.
 */
export function corridorArchiveFrom(source: Source): CorridorArchive {
  // One reader per archive, so its header and directory cache serve every
  // tile of a read and are dropped with it.
  const reader = new PMTiles(source, undefined, (buffer, compression) =>
    boundedDecompress(buffer, compression),
  );
  return {
    open: async (signal): Promise<ArchiveOpening> => {
      const header = await abortable(reader.getHeader(), signal);
      if (header.tileType !== TileType.Mvt || header.maxZoom < 15) return { kind: 'wrong-schema' };
      const metadata = await abortable(reader.getMetadata(), signal);
      if (!isProtomapsV4(metadata)) return { kind: 'wrong-schema' };
      const identity = header.etag ?? (await abortable(headerIdentity(source), signal));
      return {
        kind: 'open',
        identity,
        bounds: {
          west: header.minLon,
          south: header.minLat,
          east: header.maxLon,
          north: header.maxLat,
        },
      };
    },
    tile: async (tile: TileId, signal): Promise<Uint8Array | undefined> => {
      const answer = await abortable(reader.getZxy(tile.z, tile.x, tile.y, signal), signal);
      return answer === undefined ? undefined : new Uint8Array(answer.data);
    },
  };
}

/** The product's archive: the configured basemap's URL, and nothing else. */
export function corridorArchive(config: BasemapConfig): CorridorArchive {
  return corridorArchiveFrom(archiveSource(config.archiveUrl));
}
