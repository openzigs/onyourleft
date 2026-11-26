// SPDX-License-Identifier: Apache-2.0

/**
 * One height tile of the terrain archive, from untrusted bytes to a height in
 * metres (#2013, ADR 0087 D-3).
 *
 * The archive is a Mapterhorn extract: terrain RGB in **Terrarium** encoding,
 * **512 px lossless WebP** tiles, read at **z12** only (ADR 0087 D-2.1). This
 * module holds everything about a tile that needs no platform: the bounds it
 * is checked against before it is decoded, the arithmetic that turns decoded
 * pixels into heights, and the sampling. It decodes no image — a WebP decoder
 * is the platform's, and `apps/web/src/terrain/decode.ts` is the one caller
 * that hands the pixels back here.
 *
 * ## A tile is untrusted input
 *
 * It may come from an archive a self-hoster configured, or from a host that
 * was not what it claimed. Each bound below turns "anything" into a refusal:
 *
 * | Bound | Value | Where |
 * |---|---|---|
 * | compressed bytes | {@link MAX_TILE_BYTES}, 4 MiB | {@link checkHeightTileBytes}, before anything is read |
 * | container | simple lossless WebP (`VP8L`) only | {@link checkHeightTileBytes} |
 * | pixels | exactly 512 × 512, **read from the header** | {@link checkHeightTileBytes}, so a decode allocates 1 MiB and no more |
 * | decoded pixels | exactly 512 × 512 × 4 bytes | {@link heightTileFromRgba} |
 * | heights | −200 m to 4,600 m, else no-data | {@link heightTileFromRgba} |
 * | no-data | the nearest valid pixel within 2 pixels, else no height | {@link sampleHeightTile} |
 *
 * ⚠️ **Lossless only, and that is a bound and not a preference.** Terrarium
 * packs a height into the red and green bytes, so a lossy tile (`VP8 `) decodes
 * to heights hundreds of metres wrong that are all inside the valid range. An
 * extended container (`VP8X`) can carry animation, which is more work than one
 * frame. Mapterhorn writes plain `VP8L`, read first-hand on 2026-11-23.
 *
 * ⚠️ **No message names a tile or a coordinate** (ADR 0004 D, ADR 0090 R-2).
 * A refusal carries a reason and, at most, a limit this module chose.
 */

import { MAX_TILE_BYTES } from './limits';

/** The one zoom heights are read at (ADR 0087 D-2.1). */
export const HEIGHT_TILE_ZOOM = 12;

/** A height tile's side, in pixels. */
export const HEIGHT_TILE_PIXELS = 512;

/** Below this a decoded value is no-data: the lower 48's lowest ground is −86 m. */
export const MIN_HEIGHT_METRES = -200;

/** Above this a decoded value is no-data: the lower 48's highest ground is 4,421 m. */
export const MAX_HEIGHT_METRES = 4_600;

/** How far a no-data sample looks for a valid pixel, in pixels (ADR 0087 D-3). */
export const NO_DATA_REACH_PIXELS = 2;

/** How long a platform decode is waited for before it is abandoned (ADR 0087 D-3). */
export const HEIGHT_DECODE_TIMEOUT_MS = 2_000;

/** A z12 tile of the archive's grid. */
export interface HeightTileId {
  readonly z: typeof HEIGHT_TILE_ZOOM;
  readonly x: number;
  readonly y: number;
}

/** Why a tile was not read. Never a tile id and never a coordinate. */
export type HeightTileRefusal =
  | { readonly reason: 'too-large'; readonly limit: number }
  | { readonly reason: 'not-lossless-webp' }
  | { readonly reason: 'wrong-size'; readonly pixels: number }
  | { readonly reason: 'undecodable' }
  | { readonly reason: 'timed-out'; readonly limit: number }
  | { readonly reason: 'no-heights' };

/** A refusal, in words, for a log line or a rider (ADR 0004 D: the constraint, never a place). */
export function describeHeightTileRefusal(refusal: HeightTileRefusal): string {
  switch (refusal.reason) {
    case 'too-large':
      return `Height tile refused: it is larger than the limit of ${String(refusal.limit)} bytes.`;
    case 'not-lossless-webp':
      return 'Height tile refused: it is not a lossless WebP image.';
    case 'wrong-size':
      return `Height tile refused: it is not ${String(refusal.pixels)} pixels square.`;
    case 'undecodable':
      return 'Height tile refused: its image could not be decoded.';
    case 'timed-out':
      return `Height tile refused: its image was not decoded within ${String(refusal.limit)} ms.`;
    case 'no-heights':
      return 'Height tile refused: it holds no height inside the range a height may take.';
  }
}

const FOURCC = (bytes: Uint8Array, at: number): string =>
  String.fromCharCode(bytes[at] ?? 0, bytes[at + 1] ?? 0, bytes[at + 2] ?? 0, bytes[at + 3] ?? 0);

/** The signature byte that opens a `VP8L` bitstream. */
const VP8L_SIGNATURE = 0x2f;

/**
 * A simple lossless WebP's width and height, read from its first 25 bytes and
 * from nothing else; `undefined` for anything that is not one.
 *
 * The RIFF header, the `WEBP` form type, one `VP8L` chunk whose stated length
 * fits inside the bytes handed in, the signature byte, then 14 bits of
 * `width − 1`, 14 bits of `height − 1`, one alpha bit and a 3-bit version that
 * must be 0 (the WebP lossless bitstream specification, §"RIFF header").
 */
export function losslessWebpSize(
  bytes: Uint8Array,
): { readonly width: number; readonly height: number } | undefined {
  if (bytes.length < 25) return undefined;
  if (FOURCC(bytes, 0) !== 'RIFF' || FOURCC(bytes, 8) !== 'WEBP') return undefined;
  if (FOURCC(bytes, 12) !== 'VP8L') return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const riffLength = view.getUint32(4, true);
  const chunkLength = view.getUint32(16, true);
  if (riffLength + 8 > bytes.length || 20 + chunkLength > bytes.length) return undefined;
  if (bytes[20] !== VP8L_SIGNATURE) return undefined;
  const packed = view.getUint32(21, true);
  if (packed >>> 29 !== 0) return undefined;
  return { width: (packed & 0x3fff) + 1, height: ((packed >>> 14) & 0x3fff) + 1 };
}

/**
 * The checks made on a tile's bytes **before** any decoder sees them.
 * `undefined` when the tile may be decoded.
 */
export function checkHeightTileBytes(
  bytes: Uint8Array,
  limit = MAX_TILE_BYTES,
): HeightTileRefusal | undefined {
  if (bytes.length > limit) return { reason: 'too-large', limit };
  const size = losslessWebpSize(bytes);
  if (size === undefined) return { reason: 'not-lossless-webp' };
  if (size.width !== HEIGHT_TILE_PIXELS || size.height !== HEIGHT_TILE_PIXELS) {
    return { reason: 'wrong-size', pixels: HEIGHT_TILE_PIXELS };
  }
  return undefined;
}

/** A decoded tile: 512 × 512 heights in metres, row by row from the north-west, `NaN` for no-data. */
export interface HeightTile {
  readonly heights: Float32Array;
}

/** Terrarium: `R × 256 + G + B / 256 − 32768` metres. */
export function terrariumMetres(red: number, green: number, blue: number): number {
  return red * 256 + green + blue / 256 - 32_768;
}

/**
 * Decoded RGBA pixels into heights.
 *
 * A pixel outside {@link MIN_HEIGHT_METRES}..{@link MAX_HEIGHT_METRES} is
 * no-data, and so is one that is not opaque: a decoder that premultiplied a
 * translucent pixel has already changed its colour bytes, and Mapterhorn's
 * tiles carry no alpha. A tile with no valid pixel at all is refused.
 */
export function heightTileFromRgba(
  rgba: Uint8Array | Uint8ClampedArray,
): HeightTile | HeightTileRefusal {
  const pixels = HEIGHT_TILE_PIXELS * HEIGHT_TILE_PIXELS;
  if (rgba.length !== pixels * 4) return { reason: 'wrong-size', pixels: HEIGHT_TILE_PIXELS };
  const heights = new Float32Array(pixels);
  let valid = 0;
  for (let index = 0; index < pixels; index += 1) {
    const at = index * 4;
    const metres = terrariumMetres(rgba[at]!, rgba[at + 1]!, rgba[at + 2]!);
    if (rgba[at + 3] !== 255 || metres < MIN_HEIGHT_METRES || metres > MAX_HEIGHT_METRES) {
      heights[index] = Number.NaN;
    } else {
      heights[index] = metres;
      valid += 1;
    }
  }
  return valid === 0 ? { reason: 'no-heights' } : { heights };
}

/** Whether {@link heightTileFromRgba} answered with a refusal. */
export function isHeightTileRefusal(
  value: HeightTile | HeightTileRefusal,
): value is HeightTileRefusal {
  return 'reason' in value;
}

const pixelAt = (tile: HeightTile, column: number, row: number): number =>
  tile.heights[row * HEIGHT_TILE_PIXELS + column]!;

/**
 * The height at a point of a tile, in metres; `undefined` where the tile has
 * none.
 *
 * `column` and `row` are in pixels from the tile's north-west corner, 0 to
 * 512, with a pixel's own height at its centre (`+ 0.5`). The height is
 * bilinear between the four pixel centres round the point, clamped at the
 * tile's edge: the half pixel beyond the outermost centres takes the edge
 * pixel's height, so a sample never needs the neighbouring tile.
 *
 * Where any of the four is no-data the sample takes the nearest valid pixel
 * within {@link NO_DATA_REACH_PIXELS}; with none, there is no height there
 * (ADR 0087 D-3's no-data row).
 */
export function sampleHeightTile(
  tile: HeightTile,
  column: number,
  row: number,
): number | undefined {
  if (!Number.isFinite(column) || !Number.isFinite(row)) return undefined;
  const last = HEIGHT_TILE_PIXELS - 1;
  const u = Math.min(last, Math.max(0, column - 0.5));
  const v = Math.min(last, Math.max(0, row - 0.5));
  const left = Math.floor(u);
  const top = Math.floor(v);
  const right = Math.min(last, left + 1);
  const bottom = Math.min(last, top + 1);
  const northWest = pixelAt(tile, left, top);
  const northEast = pixelAt(tile, right, top);
  const southWest = pixelAt(tile, left, bottom);
  const southEast = pixelAt(tile, right, bottom);
  if (
    Number.isNaN(northWest) ||
    Number.isNaN(northEast) ||
    Number.isNaN(southWest) ||
    Number.isNaN(southEast)
  ) {
    return nearestValid(tile, u, v);
  }
  const fx = u - left;
  const fy = v - top;
  const north = northWest + (northEast - northWest) * fx;
  const south = southWest + (southEast - southWest) * fx;
  return north + (south - north) * fy;
}

/** The nearest valid pixel to (`u`, `v`), in pixel-centre units, within the reach. */
function nearestValid(tile: HeightTile, u: number, v: number): number | undefined {
  const last = HEIGHT_TILE_PIXELS - 1;
  let best: number | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  const reach = NO_DATA_REACH_PIXELS;
  for (
    let row = Math.max(0, Math.floor(v) - reach);
    row <= Math.min(last, Math.ceil(v) + reach);
    row += 1
  ) {
    for (
      let column = Math.max(0, Math.floor(u) - reach);
      column <= Math.min(last, Math.ceil(u) + reach);
      column += 1
    ) {
      const height = pixelAt(tile, column, row);
      if (Number.isNaN(height)) continue;
      const distance = Math.hypot(column - u, row - v);
      if (distance <= reach && distance < bestDistance) {
        bestDistance = distance;
        best = height;
      }
    }
  }
  return best;
}

/** Tiles along one side of the world at z12. */
const TILES_AT_Z12 = 2 ** HEIGHT_TILE_ZOOM;

/** The latitude Web Mercator stops at. */
const MERCATOR_LIMIT_DEGREES = 85.051_128_779_806_6;

/** The earth's circumference at the equator in Web Mercator's sphere, in metres. */
const EQUATOR_METRES = 40_075_016.686;

/** Where a place falls in the archive's z12 grid: its tile, and the pixel inside it. */
export interface HeightTilePosition {
  readonly tile: HeightTileId;
  /** Pixels east of the tile's west edge, 0 up to 512. */
  readonly column: number;
  /** Pixels south of the tile's north edge, 0 up to 512. */
  readonly row: number;
}

/**
 * The z12 tile a longitude and latitude fall in, and the pixel inside it.
 * `undefined` for a place Web Mercator has no tile for.
 */
export function heightTilePosition(
  longitude: number,
  latitude: number,
): HeightTilePosition | undefined {
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return undefined;
  if (Math.abs(latitude) > MERCATOR_LIMIT_DEGREES || Math.abs(longitude) > 180) return undefined;
  const radians = (latitude * Math.PI) / 180;
  const across = Math.min(TILES_AT_Z12 - 1e-9, ((longitude + 180) / 360) * TILES_AT_Z12);
  const down = Math.min(
    TILES_AT_Z12 - 1e-9,
    Math.max(0, ((1 - Math.asinh(Math.tan(radians)) / Math.PI) / 2) * TILES_AT_Z12),
  );
  const x = Math.floor(across);
  const y = Math.floor(down);
  return {
    tile: { z: HEIGHT_TILE_ZOOM, x, y },
    column: (across - x) * HEIGHT_TILE_PIXELS,
    row: (down - y) * HEIGHT_TILE_PIXELS,
  };
}

/**
 * The ground distance one pixel of a z12 tile covers at a latitude, in metres:
 * about 14.6 m at 40° N, 17.5 m at 24° N and 12.3 m at 50° N. This is the
 * dataset's grid spacing a route stores beside its heights.
 */
export function heightPixelMetres(latitude: number): number {
  return (
    (EQUATOR_METRES * Math.cos((latitude * Math.PI) / 180)) / (TILES_AT_Z12 * HEIGHT_TILE_PIXELS)
  );
}
