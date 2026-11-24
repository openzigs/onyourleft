// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A height tile's decode and its bounds — #2013, ADR 0087 D-3. Each hostile
 * tile is a synthetic fixture; none is refused by a crash.
 */

import { isHeightTileRefusal, MAX_TILE_BYTES } from '@onyourleft/map-features';
import {
  decodeFixtureWebp,
  FLAT_HEIGHT_METRES,
  flatHeightTile,
  lossyHeightTile,
  outOfRangeHeightTile,
  oversizeHeightTile,
  truncatedHeightTile,
} from '@onyourleft/map-features/testing';
import { describe, expect, it, vi } from 'vitest';

import { decodeHeightTile, type WebpPixels } from './decode';
import { fixtureDecode } from './terrain-testing';

const fixturePixels: WebpPixels = (bytes) => Promise.resolve(decodeFixtureWebp(bytes));

describe('decodeHeightTile', () => {
  it('reads a flat block as its one height everywhere', async () => {
    const tile = await fixtureDecode(flatHeightTile());
    if (isHeightTileRefusal(tile)) throw new Error('refused');
    expect(tile.heights).toHaveLength(512 * 512);
    expect(tile.heights[0]).toBe(FLAT_HEIGHT_METRES);
    expect(tile.heights[512 * 512 - 1]).toBe(FLAT_HEIGHT_METRES);
  });

  it('refuses an oversize image without handing it to the decoder', async () => {
    const pixels = vi.fn(fixturePixels);
    expect(await decodeHeightTile(oversizeHeightTile(), pixels)).toStrictEqual({
      reason: 'wrong-size',
      pixels: 512,
    });
    expect(pixels).not.toHaveBeenCalled();
  });

  it('refuses a tile over 4 MiB and a lossy one without handing either to the decoder', async () => {
    const pixels = vi.fn(fixturePixels);
    expect(await decodeHeightTile(new Uint8Array(MAX_TILE_BYTES + 1), pixels)).toStrictEqual({
      reason: 'too-large',
      limit: MAX_TILE_BYTES,
    });
    expect(await decodeHeightTile(lossyHeightTile(), pixels)).toStrictEqual({
      reason: 'not-lossless-webp',
    });
    expect(pixels).not.toHaveBeenCalled();
  });

  it('refuses a malformed tile the decoder throws for, and does not throw itself', async () => {
    // A true header and a body cut short: only the decoder can tell.
    expect(await fixtureDecode(truncatedHeightTile())).toStrictEqual({ reason: 'undecodable' });
  });

  it('abandons a decode that does not finish in time', async () => {
    const never: WebpPixels = () => new Promise(() => undefined);
    expect(await decodeHeightTile(flatHeightTile(), never, 5)).toStrictEqual({
      reason: 'timed-out',
      limit: 5,
    });
  });

  it('refuses pixels that are not the size the header stated', async () => {
    const small: WebpPixels = () => Promise.resolve(new Uint8Array(16));
    expect(await decodeHeightTile(flatHeightTile(), small)).toStrictEqual({
      reason: 'wrong-size',
      pixels: 512,
    });
  });

  it('refuses a tile whose every height is outside the range', async () => {
    expect(await fixtureDecode(outOfRangeHeightTile())).toStrictEqual({ reason: 'no-heights' });
  });
});
