// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * `pnpm --filter @onyourleft/web terrain:check -- plan <archive>`
 * `pnpm --filter @onyourleft/web terrain:check -- verify <local.pmtiles> <https url>`
 *
 * The two checks `README.md` asks for round the terrain archive (#2013). An
 * `<archive>` is a local path or an `https:` URL. `run-check.mjs` runs
 * {@link main}.
 *
 * - **`plan`** walks an archive's directories and prints how many tiles, and
 *   how many bytes, lie inside the extract's box at zoom 0 to 12. Run against
 *   upstream it is the size of the extract before anything is downloaded; run
 *   against the extract it is the check that the extract holds what upstream
 *   has there. It reads directories only, never a tile.
 * - **`verify`** checks an uploaded object against the local file it was
 *   uploaded from: the same length, and the same SHA-256 over eight 64 KiB
 *   ranges spread across the file, the first and the last among them. It also
 *   refuses a local file whose header is not the terrain reader's kind
 *   (`src/terrain/terrain-source.ts`): WebP tiles, stored uncompressed,
 *   reaching zoom 12.
 *
 * ⚠️ **This uploads nothing and deletes nothing.** The upload is the owner's
 * act, with the owner's credentials (`README.md`).
 *
 * A build-time tool, outside `src/`: its `fetch` is not the rider app's, and
 * `privacy/no-network.test.ts` scans `src/` only.
 */

import { createHash } from 'node:crypto';
import { open, stat } from 'node:fs/promises';

import {
  Compression,
  PMTiles,
  TileType,
  tileIdToZxy,
  type Header,
  type RangeResponse,
  type Source,
} from 'pmtiles';

/** The extract's box: the contiguous United States, as the route planner's first view is. */
export const TERRAIN_EXTRACT_BOX = { west: -125, south: 24, east: -66, north: 50 } as const;

/** The deepest zoom the extract holds, and the one the app reads. */
export const TERRAIN_EXTRACT_MAX_ZOOM = 12;

/** How many ranges {@link sampleRanges} spreads over a file, and how long each is. */
export const VERIFY_RANGES = 8;
export const VERIFY_RANGE_BYTES = 64 * 1024;

export interface Box {
  readonly west: number;
  readonly south: number;
  readonly east: number;
  readonly north: number;
}

/** The tiles of one zoom that touch `box`, as inclusive column and row ranges. */
export function tileRange(
  z: number,
  box: Box,
): { readonly x0: number; readonly x1: number; readonly y0: number; readonly y1: number } {
  const n = 2 ** z;
  const clamp = (value: number): number => Math.min(n - 1, Math.max(0, Math.floor(value)));
  const x = (longitude: number): number => clamp(((longitude + 180) / 360) * n);
  const y = (latitude: number): number => {
    const radians = (Math.max(-85.0511, Math.min(85.0511, latitude)) * Math.PI) / 180;
    return clamp(((1 - Math.asinh(Math.tan(radians)) / Math.PI) / 2) * n);
  };
  return { x0: x(box.west), x1: x(box.east), y0: y(box.north), y1: y(box.south) };
}

export interface ExtractPlan {
  /** Tiles addressed inside the box, zoom 0 to `maxZoom`. */
  readonly tiles: number;
  /** Distinct tile contents among them: tiles that share bytes are counted once. */
  readonly contents: number;
  /** The bytes of those contents: what an extract's tile data is. */
  readonly bytes: number;
  /** The longest single tile. */
  readonly largestTile: number;
  /** Tiles and bytes by zoom, index 0 to `maxZoom`. */
  readonly perZoom: readonly { readonly tiles: number; readonly bytes: number }[];
}

/**
 * What an extract of `box` at zoom 0 to `maxZoom` holds, read from the
 * archive's directories.
 *
 * `PMTiles`' own cache reads each directory (`cache.getDirectory`), so the
 * header's compression and the varint layout are the package's and not a
 * second parser's. A run of tiles that share one content counts every tile it
 * addresses and its bytes once.
 */
export async function planExtract(
  source: Source,
  box: Box = TERRAIN_EXTRACT_BOX,
  maxZoom: number = TERRAIN_EXTRACT_MAX_ZOOM,
): Promise<ExtractPlan> {
  const reader = new PMTiles(source);
  const header = await reader.getHeader();
  const ranges = Array.from({ length: maxZoom + 1 }, (_, z) => tileRange(z, box));
  const perZoom = ranges.map(() => ({ tiles: 0, bytes: 0 }));
  const seen = new Map<number, number>();
  let tiles = 0;

  const walk = async (offset: number, length: number): Promise<void> => {
    const directory = await reader.cache.getDirectory(source, offset, length, header);
    const leaves: Promise<void>[] = [];
    for (const entry of directory) {
      if (entry.runLength === 0) {
        leaves.push(walk(header.leafDirectoryOffset + entry.offset, entry.length));
        // Eight leaves at a time: upstream's planet has over two thousand.
        if (leaves.length === 8) await Promise.all(leaves.splice(0));
        continue;
      }
      for (let id = entry.tileId; id < entry.tileId + entry.runLength; id += 1) {
        const [z, x, y] = tileIdToZxy(id);
        const range = ranges[z];
        if (range === undefined) continue;
        if (x < range.x0 || x > range.x1 || y < range.y0 || y > range.y1) continue;
        tiles += 1;
        perZoom[z]!.tiles += 1;
        if (!seen.has(entry.offset)) {
          seen.set(entry.offset, entry.length);
          perZoom[z]!.bytes += entry.length;
        }
      }
    }
    await Promise.all(leaves);
  };
  await walk(header.rootDirectoryOffset, header.rootDirectoryLength);

  let bytes = 0;
  let largestTile = 0;
  for (const length of seen.values()) {
    bytes += length;
    largestTile = Math.max(largestTile, length);
  }
  return { tiles, contents: seen.size, bytes, largestTile, perZoom };
}

/** Why a header is not a terrain archive the app reads; `undefined` when it is one. */
export function terrainHeaderFault(header: Header): string | undefined {
  if (header.tileType !== TileType.Webp) return 'its tiles are not WebP';
  if (
    header.tileCompression !== Compression.None &&
    header.tileCompression !== Compression.Unknown
  ) {
    return 'its tiles are stored compressed';
  }
  if (header.minZoom > TERRAIN_EXTRACT_MAX_ZOOM || header.maxZoom < TERRAIN_EXTRACT_MAX_ZOOM) {
    return `it does not reach zoom ${String(TERRAIN_EXTRACT_MAX_ZOOM)}`;
  }
  return undefined;
}

/**
 * `count` ranges of `size` bytes spread evenly over a file of `length` bytes:
 * the first starts at 0 and the last ends at the file's end. A file shorter
 * than one range is one range, the whole file.
 */
export function sampleRanges(
  length: number,
  count: number = VERIFY_RANGES,
  size: number = VERIFY_RANGE_BYTES,
): readonly { readonly offset: number; readonly length: number }[] {
  if (length <= size) return [{ offset: 0, length }];
  const last = length - size;
  const steps = Math.max(1, count - 1);
  const offsets = new Set<number>();
  for (let index = 0; index <= steps; index += 1) {
    offsets.add(Math.floor((last * index) / steps));
  }
  return [...offsets].map((offset) => ({ offset, length: size }));
}

/** Something a range of bytes can be read from, with its whole length. */
export interface RangeReader {
  readonly length: number;
  read(offset: number, length: number): Promise<Uint8Array>;
}

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

export interface Verification {
  readonly ok: boolean;
  /** One line a person reads, per check. */
  readonly lines: readonly string[];
}

/**
 * Whether `remote` is `local`, by length and by the hash of each sampled
 * range. A length that differs is reported and no range is read.
 */
export async function verifyUpload(local: RangeReader, remote: RangeReader): Promise<Verification> {
  if (local.length !== remote.length) {
    return {
      ok: false,
      lines: [
        `length: local ${String(local.length)} bytes, uploaded ${String(remote.length)} bytes — they differ`,
      ],
    };
  }
  const lines = [`length: ${String(local.length)} bytes, both`];
  let ok = true;
  for (const range of sampleRanges(local.length)) {
    const [ours, theirs] = await Promise.all([
      local.read(range.offset, range.length),
      remote.read(range.offset, range.length),
    ]);
    const same = ours.length === range.length && sha256(ours) === sha256(theirs);
    ok &&= same;
    lines.push(
      `range ${String(range.offset)}+${String(range.length)}: sha256 ${sha256(ours).slice(0, 16)}… ${same ? 'matches' : 'DIFFERS'}`,
    );
  }
  return { ok, lines };
}

/** A local file, as a `pmtiles` source and a {@link RangeReader}. */
async function fileReader(
  path: string,
): Promise<RangeReader & Source & { close(): Promise<void> }> {
  const handle = await open(path, 'r');
  const { size } = await stat(path);
  const read = async (offset: number, length: number): Promise<Uint8Array> => {
    const buffer = new Uint8Array(length);
    const { bytesRead } = await handle.read(buffer, 0, length, offset);
    return buffer.subarray(0, bytesRead);
  };
  return {
    length: size,
    read,
    getKey: () => path,
    getBytes: async (offset, length): Promise<RangeResponse> => ({
      data: (await read(offset, length)).slice().buffer,
    }),
    close: () => handle.close(),
  };
}

/** An `https:` object read by byte range, as a `pmtiles` source and a {@link RangeReader}. */
async function httpReader(url: string): Promise<RangeReader & Source> {
  const read = async (offset: number, length: number): Promise<Response> => {
    const response = await fetch(url, {
      headers: { Range: `bytes=${String(offset)}-${String(offset + length - 1)}` },
    });
    if (response.status !== 206) {
      await response.body?.cancel();
      throw new Error(`the host answered a range request with HTTP ${String(response.status)}`);
    }
    return response;
  };
  const first = await read(0, 1);
  const total = Number(
    /\/(\d+)$/.exec(first.headers.get('content-range') ?? '')?.[1] ?? Number.NaN,
  );
  await first.body?.cancel();
  if (!Number.isFinite(total))
    throw new Error('the host sent no Content-Range with a total length');
  return {
    length: total,
    read: async (offset, length) =>
      new Uint8Array(await (await read(offset, length)).arrayBuffer()),
    getKey: () => url,
    getBytes: async (offset, length): Promise<RangeResponse> => ({
      data: await (await read(offset, length)).arrayBuffer(),
    }),
  };
}

const readerOf = (archive: string): Promise<RangeReader & Source & { close?(): Promise<void> }> =>
  archive.startsWith('https://') ? httpReader(archive) : fileReader(archive);

const USAGE =
  'usage: terrain:check -- plan <archive> | verify <local.pmtiles> <https url>\n' +
  '       an <archive> is a local path or an https: URL';

/** The entry point. Returns the exit code; prints to `out`. */
export async function main(
  args: readonly string[],
  out: (line: string) => void = console.log,
): Promise<number> {
  const [command, first, second] = args;
  if (command === 'plan' && first !== undefined && second === undefined) {
    const reader = await readerOf(first);
    try {
      const plan = await planExtract(reader);
      const box = TERRAIN_EXTRACT_BOX;
      out(
        `box ${String(box.west)},${String(box.south)},${String(box.east)},${String(box.north)}, zoom 0 to ${String(TERRAIN_EXTRACT_MAX_ZOOM)}`,
      );
      out(`tiles: ${String(plan.tiles)} (${String(plan.contents)} distinct contents)`);
      out(`tile bytes: ${String(plan.bytes)} (${(plan.bytes / 1e9).toFixed(2)} GB)`);
      out(`largest tile: ${String(plan.largestTile)} bytes`);
      plan.perZoom.forEach((zoom, z) => {
        out(`z${String(z)}: ${String(zoom.tiles)} tiles, ${String(zoom.bytes)} bytes`);
      });
      return 0;
    } finally {
      await reader.close?.();
    }
  }
  if (command === 'verify' && first !== undefined && second?.startsWith('https://') === true) {
    const local = await fileReader(first);
    try {
      const fault = terrainHeaderFault(await new PMTiles(local).getHeader());
      if (fault !== undefined) {
        out(`the local file is not a terrain archive the app reads: ${fault}`);
        return 1;
      }
      const result = await verifyUpload(local, await httpReader(second));
      result.lines.forEach(out);
      out(result.ok ? 'verified: the uploaded object is the local file' : 'NOT verified');
      return result.ok ? 0 : 1;
    } finally {
      await local.close();
    }
  }
  out(USAGE);
  return 2;
}
