// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';

import {
  checkHeightTileBytes,
  describeHeightTileRefusal,
  HEIGHT_TILE_PIXELS,
  heightPixelMetres,
  heightTileFromRgba,
  heightTilePosition,
  isHeightTileRefusal,
  losslessWebpSize,
  MAX_HEIGHT_METRES,
  MIN_HEIGHT_METRES,
  sampleHeightTile,
  terrariumMetres,
  type HeightTile,
  type HeightTileRefusal,
} from './height-tile';
import { MAX_TILE_BYTES } from './limits';
import {
  decodeFixtureWebp,
  FLAT_HEIGHT_METRES,
  flatHeightTile,
  heightRgba,
  lossyHeightTile,
  outOfRangeHeightTile,
  oversizeHeightTile,
  SLOPE_BASE_METRES,
  slopeHeightTile,
  terrariumBytes,
  truncatedHeightTile,
} from './testing';

function tileOf(height: (column: number, row: number) => number): HeightTile {
  const tile = heightTileFromRgba(heightRgba(height));
  if (isHeightTileRefusal(tile)) throw new Error('the fixture was refused');
  return tile;
}

describe('Terrarium heights', () => {
  it('reads R × 256 + G + B / 256 − 32768', () => {
    expect(terrariumMetres(128, 0, 0)).toBe(0);
    expect(terrariumMetres(128, 100, 128)).toBe(100.5);
    expect(terrariumMetres(127, 170, 0)).toBe(-86);
  });

  it('round-trips the fixture encoder to within its 1/256 m step', () => {
    for (const metres of [-86, 0, 0.25, 120, 1609.34, 4421]) {
      expect(terrariumMetres(...terrariumBytes(metres))).toBeCloseTo(metres, 2);
    }
  });
});

describe('the header check made before a tile is decoded', () => {
  it('reads 512 × 512 from a real lossless header', () => {
    expect(losslessWebpSize(flatHeightTile())).toStrictEqual({ width: 512, height: 512 });
    expect(checkHeightTileBytes(flatHeightTile())).toBeUndefined();
  });

  it('refuses an oversize image unread, from its header alone', () => {
    const tile = oversizeHeightTile();
    // The whole file is a few dozen bytes: nothing 4,096 px wide was built.
    expect(tile.length).toBeLessThan(2_000);
    expect(losslessWebpSize(tile)).toStrictEqual({ width: 4_096, height: 4_096 });
    expect(checkHeightTileBytes(tile)).toStrictEqual({ reason: 'wrong-size', pixels: 512 });
  });

  it('refuses a tile over the byte limit before reading its header', () => {
    const tile = flatHeightTile();
    expect(checkHeightTileBytes(tile, tile.length - 1)).toStrictEqual({
      reason: 'too-large',
      limit: tile.length - 1,
    });
    // The real limit is the one a map tile is held to.
    expect(tile.length).toBeLessThan(MAX_TILE_BYTES);
  });

  it('refuses a lossy container, whose heights would be wrong and in range', () => {
    expect(checkHeightTileBytes(lossyHeightTile())).toStrictEqual({ reason: 'not-lossless-webp' });
  });

  it('refuses bytes that are not a WebP file, a wrong signature and a non-zero version', () => {
    expect(checkHeightTileBytes(new Uint8Array(0))).toStrictEqual({ reason: 'not-lossless-webp' });
    expect(checkHeightTileBytes(new Uint8Array(4_096))).toStrictEqual({
      reason: 'not-lossless-webp',
    });
    const signature = flatHeightTile();
    signature[20] = 0x2e;
    expect(losslessWebpSize(signature)).toBeUndefined();
    const version = flatHeightTile();
    version[24] = (version[24] ?? 0) | 0x20;
    expect(losslessWebpSize(version)).toBeUndefined();
  });

  it('refuses a chunk that states more bytes than the file has', () => {
    const tile = flatHeightTile().slice(0, 100);
    expect(losslessWebpSize(tile)).toBeUndefined();
  });

  it('lets a truncated body through: only a decoder can tell', () => {
    expect(checkHeightTileBytes(truncatedHeightTile())).toBeUndefined();
    expect(() => decodeFixtureWebp(truncatedHeightTile())).toThrow();
  });
});

describe('decoded pixels into heights', () => {
  it('reads the fixture encoder’s file back to the heights that were written', () => {
    const tile = heightTileFromRgba(decodeFixtureWebp(slopeHeightTile(0.5)));
    if (isHeightTileRefusal(tile)) throw new Error('refused');
    expect(tile.heights[0]).toBe(SLOPE_BASE_METRES);
    expect(tile.heights[511]).toBe(SLOPE_BASE_METRES + 511 * 0.5);
    expect(tile.heights[512 * 511 + 100]).toBe(SLOPE_BASE_METRES + 50);
  });

  it('refuses pixels that are not 512 × 512', () => {
    expect(heightTileFromRgba(new Uint8Array(256 * 256 * 4))).toStrictEqual({
      reason: 'wrong-size',
      pixels: 512,
    });
  });

  it('makes a height outside the range no-data, and refuses a tile with none inside it', () => {
    const rgba = heightRgba((column) => (column === 7 ? MAX_HEIGHT_METRES + 1 : 50));
    const tile = heightTileFromRgba(rgba);
    if (isHeightTileRefusal(tile)) throw new Error('refused');
    expect(Number.isNaN(tile.heights[7])).toBe(true);
    expect(tile.heights[8]).toBe(50);

    const low = heightTileFromRgba(heightRgba(() => MIN_HEIGHT_METRES - 1));
    expect(low).toStrictEqual({ reason: 'no-heights' });
    expect(heightTileFromRgba(decodeFixtureWebp(outOfRangeHeightTile()))).toStrictEqual({
      reason: 'no-heights',
    });
  });

  it('keeps both ends of the range', () => {
    const tile = tileOf((column) => (column % 2 === 0 ? MIN_HEIGHT_METRES : MAX_HEIGHT_METRES));
    expect(tile.heights[0]).toBe(MIN_HEIGHT_METRES);
    expect(tile.heights[1]).toBe(MAX_HEIGHT_METRES);
  });

  it('makes a pixel that is not opaque no-data', () => {
    const rgba = heightRgba(() => 50);
    rgba[3] = 254;
    const tile = heightTileFromRgba(rgba);
    if (isHeightTileRefusal(tile)) throw new Error('refused');
    expect(Number.isNaN(tile.heights[0])).toBe(true);
  });
});

describe('sampling a tile', () => {
  it('is the pixel’s own height at its centre and bilinear between centres', () => {
    const tile = tileOf((column, row) => column * 2 + row * 10);
    expect(sampleHeightTile(tile, 10.5, 20.5)).toBeCloseTo(10 * 2 + 20 * 10, 6);
    expect(sampleHeightTile(tile, 11, 20.5)).toBeCloseTo(10.5 * 2 + 20 * 10, 6);
    expect(sampleHeightTile(tile, 10.5, 21.25)).toBeCloseTo(10 * 2 + 20.75 * 10, 6);
  });

  it('takes the edge pixel in the half pixel outside the outermost centres', () => {
    const tile = tileOf((column, row) => column + row * 5);
    expect(sampleHeightTile(tile, 0, 0)).toBe(0);
    expect(sampleHeightTile(tile, 512, 0.5)).toBe(511);
    expect(sampleHeightTile(tile, 0.5, 512)).toBe(511 * 5);
  });

  it('reads a flat block flat everywhere', () => {
    const tile = tileOf(() => FLAT_HEIGHT_METRES);
    for (const at of [0, 0.3, 100.7, 255.5, 511.9, 512]) {
      expect(sampleHeightTile(tile, at, 512 - at)).toBe(FLAT_HEIGHT_METRES);
    }
  });

  it('takes the nearest valid pixel within 2 pixels of a no-data one, and nothing beyond', () => {
    // No-data in columns 100..109; valid ground of the column's own number elsewhere.
    const tile = tileOf((column) => (column >= 100 && column < 110 ? 9_999 : column));
    // One pixel into the hole from the west: the nearest valid centre is column 99.
    expect(sampleHeightTile(tile, 100.5, 50.5)).toBe(99);
    // Two pixels in: column 99's centre is exactly 2 away.
    expect(sampleHeightTile(tile, 101.5, 50.5)).toBe(99);
    // Three in: nothing valid within reach.
    expect(sampleHeightTile(tile, 102.5, 50.5)).toBeUndefined();
    // From the east side the nearest is column 110.
    expect(sampleHeightTile(tile, 109.5, 50.5)).toBe(110);
    // A sample between a valid and a no-data centre is not blended with the hole.
    expect(sampleHeightTile(tile, 100, 50.5)).toBe(99);
  });

  it('has no height at a place that is not a number', () => {
    const tile = tileOf(() => 1);
    expect(sampleHeightTile(tile, Number.NaN, 1)).toBeUndefined();
    expect(sampleHeightTile(tile, 1, Number.POSITIVE_INFINITY)).toBeUndefined();
  });
});

describe('where a place falls in the z12 grid', () => {
  it('finds the tile and the pixel, north-west first', () => {
    // The north-west corner of tile 850/1550 at z12.
    const west = (850 / 4096) * 360 - 180;
    const north = (Math.atan(Math.sinh(Math.PI * (1 - (2 * 1550) / 4096))) * 180) / Math.PI;
    const corner = heightTilePosition(west + 1e-9, north - 1e-9);
    expect(corner?.tile).toStrictEqual({ z: 12, x: 850, y: 1550 });
    expect(corner?.column).toBeCloseTo(0, 3);
    expect(corner?.row).toBeCloseTo(0, 3);

    const east = (851 / 4096) * 360 - 180;
    const middle = heightTilePosition((west + east) / 2, north - 1e-9);
    expect(middle?.tile.x).toBe(850);
    expect(middle?.column).toBeCloseTo(HEIGHT_TILE_PIXELS / 2, 3);
  });

  it('puts a point further south in a later row, and further east in a later column', () => {
    const a = heightTilePosition(-105.25, 40.02);
    const b = heightTilePosition(-105.24, 40.01);
    expect(a?.tile).toStrictEqual(b?.tile);
    expect(b!.row).toBeGreaterThan(a!.row);
    expect(b!.column).toBeGreaterThan(a!.column);
  });

  it('has no tile past the projection’s edge or for a place that is not a number', () => {
    expect(heightTilePosition(0, 86)).toBeUndefined();
    expect(heightTilePosition(181, 0)).toBeUndefined();
    expect(heightTilePosition(Number.NaN, 0)).toBeUndefined();
    expect(heightTilePosition(180, -85)?.tile.x).toBe(4095);
  });

  it('states a pixel’s ground size: about 14.6 m at 40° N', () => {
    expect(heightPixelMetres(40)).toBeCloseTo(14.64, 1);
    expect(heightPixelMetres(24)).toBeCloseTo(17.46, 1);
    expect(heightPixelMetres(50)).toBeCloseTo(12.28, 1);
  });
});

describe('a refusal’s words', () => {
  const refusals: HeightTileRefusal[] = [
    { reason: 'too-large', limit: MAX_TILE_BYTES },
    { reason: 'not-lossless-webp' },
    { reason: 'wrong-size', pixels: 512 },
    { reason: 'undecodable' },
    { reason: 'timed-out', limit: 2_000 },
    { reason: 'no-heights' },
  ];

  it('says each one differently, and names no tile and no place', () => {
    const words = refusals.map(describeHeightTileRefusal);
    expect(new Set(words).size).toBe(refusals.length);
    for (const sentence of words) {
      expect(sentence).toMatch(/^Height tile refused: /);
      // The only numbers are limits this package chose.
      expect(sentence.replace(/4194304|512|2000/g, '')).not.toMatch(/\d/);
    }
  });
});
