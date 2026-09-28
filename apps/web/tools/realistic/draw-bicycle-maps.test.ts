// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The realistic bicycle's drawn maps say what `bicycle-surfaces.ts` says they
 * say — #624.
 *
 * `provenance.test.ts` holds the committed maps to what this script draws
 * today. This holds what it draws to the contract the geometry samples it by:
 * that a band's rows are where `bandV` puts them, that what the saddle and the
 * plain metal sample is flat, that the crown of the tyre is tread, and that a
 * map closes on itself where its part does — round a section and along a tile.
 */

import { describe, expect, it } from 'vitest';

import {
  bandV,
  BICYCLE_ATLAS_PIXELS,
  CASSETTE_BAND,
  CHAINRING_BAND,
  PLAIN_METAL_BAND,
  PLAIN_METAL_UV,
  PLAIN_RUBBER_UV,
  TAPE_BAND,
  TYRE_BAND,
  type AtlasBand,
  type Uv,
} from '../../src/game/bicycle-surfaces';
import { REALISTIC_BICYCLE_MAP_NAMES } from '../../src/game/realistic-assets';

import { acrossFraction, drawBicycleMap, pixelDigest, type DrawnMap } from './draw-bicycle-maps';

const texel = (map: DrawnMap, column: number, row: number): readonly number[] => {
  const at = (row * map.size + column) * 3;
  return [map.pixels[at] ?? 0, map.pixels[at + 1] ?? 0, map.pixels[at + 2] ?? 0];
};

/** The texel a coordinate samples nearest, on a map that is not flipped. */
const texelAt = (map: DrawnMap, [u, v]: Uv): readonly number[] =>
  texel(map, Math.floor((u - Math.floor(u)) * map.size), Math.floor(v * map.size));

/** A flat tangent-space normal, as bytes. */
const FLAT = [128, 128, 255];

/** How much one row of a map varies along itself, summed over its channels. */
function rowVariance(map: DrawnMap, row: number): number {
  let sum = 0;
  let sumSquares = 0;
  for (let column = 0; column < map.size; column += 1) {
    const value = texel(map, column, row).reduce((total, channel) => total + channel, 0);
    sum += value;
    sumSquares += value * value;
  }
  const mean = sum / map.size;
  return sumSquares / map.size - mean * mean;
}

const rubber = drawBicycleMap('rubberNormal');
const metal = drawBicycleMap('metalNormal');
const roughness = drawBicycleMap('metalRoughness');
const paint = drawBicycleMap('paintRoughness');

describe('the drawn maps — #624', () => {
  it('draws the same pixels every time, from nothing but their names', () => {
    for (const map of REALISTIC_BICYCLE_MAP_NAMES) {
      expect(pixelDigest(drawBicycleMap(map)), map).toBe(pixelDigest(drawBicycleMap(map)));
    }
    // Four different pictures, not one drawn four times.
    expect(
      new Set(REALISTIC_BICYCLE_MAP_NAMES.map((map) => pixelDigest(drawBicycleMap(map)))).size,
    ).toBe(4);
  });

  it('puts a band’s rows exactly where the geometry’s coordinates sample them', () => {
    for (const band of [TYRE_BAND, TAPE_BAND, CHAINRING_BAND, CASSETTE_BAND, PLAIN_METAL_BAND]) {
      for (let row = band.first; row < band.first + band.rows; row += 1) {
        expect(bandV(band, acrossFraction(band, row))).toBeCloseTo(
          (row + 0.5) / BICYCLE_ATLAS_PIXELS,
          12,
        );
      }
    }
    // And the bands tile each atlas with no gap and no overlap.
    const cover = (bands: readonly AtlasBand[]): number[] =>
      bands.flatMap((band) => Array.from({ length: band.rows }, (_, at) => band.first + at));
    const all = Array.from({ length: BICYCLE_ATLAS_PIXELS }, (_, at) => at);
    expect(cover([TYRE_BAND, TAPE_BAND])).toEqual(all);
    expect(cover([CHAINRING_BAND, CASSETTE_BAND, PLAIN_METAL_BAND])).toEqual(all);
  });

  it('stores every normal as a unit vector facing out of the surface', () => {
    for (const map of [rubber, metal]) {
      for (let at = 0; at < map.pixels.length; at += 3) {
        const [x, y, z] = [0, 1, 2].map(
          (channel) => ((map.pixels[at + channel] ?? 0) / 255) * 2 - 1,
        );
        expect(Math.hypot(x ?? 0, y ?? 0, z ?? 0)).toBeGreaterThan(0.98);
        expect(Math.hypot(x ?? 0, y ?? 0, z ?? 0)).toBeLessThan(1.02);
        expect(z).toBeGreaterThan(0.3);
      }
    }
  });

  it('draws tread at the tyre’s crown and nothing on its bead, where the saddle samples', () => {
    // The crown is the band's first and last rows, the chevrons across it out
    // to 50° either side — about 18 rows each way; the bead is the middle.
    const edge = TYRE_BAND.first + TYRE_BAND.rows - 1;
    for (let at = 0; at < 15; at += 1) {
      expect(rowVariance(rubber, TYRE_BAND.first + at), `row ${String(at)}`).toBeGreaterThan(30);
      expect(rowVariance(rubber, edge - at), `row ${String(edge - at)}`).toBeGreaterThan(30);
    }
    expect(texelAt(rubber, PLAIN_RUBBER_UV)).toEqual(FLAT);
    for (const row of [63, 64]) expect(rowVariance(rubber, row)).toBe(0);
  });

  it('draws the teeth at the chainring’s crown, and plain metal where plain metal samples', () => {
    expect(rowVariance(metal, CHAINRING_BAND.first)).toBeGreaterThan(100);
    expect(texelAt(metal, PLAIN_METAL_UV)).toEqual(FLAT);
    // Plain metal keeps the roughness the metal had before #624: 0.3.
    expect(texelAt(roughness, PLAIN_METAL_UV)).toEqual([77, 77, 77]);
    for (let row = PLAIN_METAL_BAND.first; row < BICYCLE_ATLAS_PIXELS; row += 1) {
      expect(rowVariance(metal, row)).toBe(0);
      expect(rowVariance(roughness, row)).toBe(0);
    }
    // The cassette is on the drive side of the hub only: the band's near half is plain.
    const nearHalf = CASSETTE_BAND.first + Math.floor(CASSETTE_BAND.rows / 2) - 2;
    expect(texel(metal, 10, nearHalf)).toEqual(FLAT);
    const driveSide = CASSETTE_BAND.first + CASSETTE_BAND.rows - 12;
    expect(
      Array.from({ length: 10 }, (_, at) => texel(metal, 10, driveSide + at)).some(
        (value) => value.join() !== FLAT.join(),
      ),
    ).toBe(true);
  });

  it('closes each closed band on itself: its first and last rows are one line on the part', () => {
    for (const [map, band] of [
      [rubber, TYRE_BAND],
      [rubber, TAPE_BAND],
      [metal, CHAINRING_BAND],
      [roughness, CHAINRING_BAND],
    ] as const) {
      for (let column = 0; column < map.size; column += 1) {
        expect(texel(map, column, band.first)).toEqual(
          texel(map, column, band.first + band.rows - 1),
        );
      }
    }
  });

  it('tiles along: the last column runs into the first as any column runs into the next', () => {
    for (const map of [rubber, metal, roughness, paint]) {
      let seam = 0;
      let widest = 0;
      for (let row = 0; row < map.size; row += 1) {
        for (let column = 0; column < map.size; column += 1) {
          const next = (column + 1) % map.size;
          const step = texel(map, column, row).reduce(
            (sum, channel, at) => sum + Math.abs(channel - (texel(map, next, row)[at] ?? 0)),
            0,
          );
          if (next === 0) seam = Math.max(seam, step);
          else widest = Math.max(widest, step);
        }
      }
      expect(seam).toBeLessThanOrEqual(widest);
    }
  });

  it('gives the frame a clear coat: low roughness with a faint mottle, never flat', () => {
    const values = Array.from(
      { length: paint.size * paint.size },
      (_, at) => (paint.pixels[at * 3] ?? 0) / 255,
    );
    expect(Math.min(...values)).toBeGreaterThan(0.12);
    expect(Math.max(...values)).toBeLessThan(0.28);
    expect(Math.max(...values) - Math.min(...values)).toBeGreaterThan(0.03);
  });
});
