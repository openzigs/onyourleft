// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A height tile's bytes into heights, inside ADR 0087 D-3's bounds — #2013.
 *
 * The WebP decoder is the platform's: Node has none and the repository
 * carries none, and a browser's is the one that has met hostile images
 * before. What is checked here is everything round it, in this order:
 *
 * 1. **Before any decoder sees the bytes**, `@onyourleft/map-features`
 *    §`checkHeightTileBytes`: at most 4 MiB, a simple lossless WebP, and
 *    exactly 512 × 512 **read from the header**, so a decode never allocates
 *    more than 512 × 512 × 4 bytes. An oversize image is refused unread.
 * 2. **The decode is given {@link HEIGHT_DECODE_TIMEOUT_MS}** and is abandoned
 *    after it. `createImageBitmap` decodes off the main thread, so a tile
 *    that makes it slow does not hold a frame; what is abandoned is the wait.
 * 3. **The pixels that come back** are checked again for size and turned into
 *    heights, with anything outside the valid range as no-data
 *    (§`heightTileFromRgba`).
 *
 * A tile that fails any of these is a {@link HeightTileRefusal}, never a
 * throw: the read carries on with no heights for that tile.
 */

import {
  checkHeightTileBytes,
  HEIGHT_DECODE_TIMEOUT_MS,
  HEIGHT_TILE_PIXELS,
  heightTileFromRgba,
  type HeightTile,
  type HeightTileRefusal,
} from '@onyourleft/map-features';

/** A WebP file's pixels as RGBA, row by row. Rejects for a file it cannot decode. */
export type WebpPixels = (bytes: Uint8Array) => Promise<Uint8Array | Uint8ClampedArray>;

/** What turns a tile's bytes into heights. */
export type DecodeHeightTile = (bytes: Uint8Array) => Promise<HeightTile | HeightTileRefusal>;

/**
 * The platform's decoder: `createImageBitmap`, drawn once to a 512 px canvas
 * and read back.
 *
 * A height is packed into the colour bytes, so a decoder that changed them
 * would hand back a different height. `browser/terrain.browser.spec.ts` reads
 * a fixture tile through this function in Chromium and holds every height to
 * the one that was written.
 *
 * ⚠️ **`premultiplyAlpha: 'none'` and `colorSpaceConversion: 'none'` are a
 * guard that the gate cannot show.** For the tile the archive holds — opaque,
 * with no colour profile — Chromium's defaults hand back the same bytes:
 * taking both options out left that spec green (#2013's mutation list). They
 * are asked for so that a tile which did carry alpha or a profile is not
 * silently converted; and a pixel that is not opaque is no-data whatever the
 * decoder did to it (`heightTileFromRgba`).
 */
export const platformWebpPixels: WebpPixels = async (bytes) => {
  const bitmap = await createImageBitmap(new Blob([bytes as BlobPart], { type: 'image/webp' }), {
    premultiplyAlpha: 'none',
    colorSpaceConversion: 'none',
  });
  try {
    if (bitmap.width !== HEIGHT_TILE_PIXELS || bitmap.height !== HEIGHT_TILE_PIXELS) {
      throw new Error('the decoded image is not the size its header stated');
    }
    const canvas = new OffscreenCanvas(HEIGHT_TILE_PIXELS, HEIGHT_TILE_PIXELS);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (context === null) throw new Error('no canvas to read the image back from');
    context.drawImage(bitmap, 0, 0);
    return context.getImageData(0, 0, HEIGHT_TILE_PIXELS, HEIGHT_TILE_PIXELS).data;
  } finally {
    bitmap.close();
  }
};

/**
 * A tile's bytes into heights, or the reason it was refused.
 *
 * `pixels` is the platform's decoder unless a test hands in another;
 * `timeoutMs` is how long it is waited for.
 */
export async function decodeHeightTile(
  bytes: Uint8Array,
  pixels: WebpPixels = platformWebpPixels,
  timeoutMs: number = HEIGHT_DECODE_TIMEOUT_MS,
): Promise<HeightTile | HeightTileRefusal> {
  const refusal = checkHeightTileBytes(bytes);
  if (refusal !== undefined) return refusal;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<'late'>((resolve) => {
    timer = setTimeout(() => {
      resolve('late');
    }, timeoutMs);
  });
  try {
    const decoded = await Promise.race([pixels(bytes), late]);
    if (decoded === 'late') return { reason: 'timed-out', limit: timeoutMs };
    return heightTileFromRgba(decoded);
  } catch {
    return { reason: 'undecodable' };
  } finally {
    clearTimeout(timer);
  }
}
