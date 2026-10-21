// SPDX-License-Identifier: Apache-2.0

/**
 * Tiles no honest encoder writes (#1544's third criterion), each with the
 * refusal it must produce. Built by hand on top of `../testing/mvt-encoder.ts`,
 * which will write any version, extent or geometry integer it is given.
 */

import {
  MAX_RINGS_PER_POLYGON,
  MAX_TILE_BYTES,
  MAX_FEATURES_PER_LAYER,
  MAX_VERTICES_PER_FEATURE,
  MAX_VERTICES_PER_TILE,
} from '../limits';
import { command, encodeTile, outerRing, polygon, rectangle, zigzag } from '../testing/mvt-encoder';
import type { DecodeRefusal } from '../types';
import { tileOverLimit } from './limits';
import { EARTH } from './tiles';

export interface HostileFixture {
  readonly name: string;
  readonly bytes: () => Uint8Array;
  readonly refusal: DecodeRefusal;
}

/** A feature in `buildings` whose geometry is the given command integers. */
function buildingWithGeometry(geometry: readonly number[], extent?: number): Uint8Array {
  return encodeTile([
    EARTH,
    {
      name: 'buildings',
      ...(extent === undefined ? {} : { extent }),
      features: [{ type: 3, tags: { kind: 'building' }, geometry }],
    },
  ]);
}

const square = polygon([outerRing(rectangle(100, 100, 300, 300))]);

/** 10^6 `LineTo` commands of one vertex each, in one footway. */
export function millionLineToTile(): Uint8Array {
  const geometry: number[] = [command(1, 1), zigzag(100), zigzag(100)];
  for (let i = 0; i < 1_000_000; i++)
    geometry.push(command(2, 1), zigzag(i % 2 === 0 ? 1 : -1), zigzag(0));
  return encodeTile([
    EARTH,
    { name: 'roads', features: [{ type: 2, tags: { kind: 'path' }, geometry }] },
  ]);
}

export const HOSTILE_FIXTURES: readonly HostileFixture[] = [
  {
    name: 'a truncated varint at the top level',
    bytes: () => Uint8Array.of(0x1a, 0x80),
    refusal: { reason: 'malformed', layer: null },
  },
  {
    name: 'a truncated varint inside a geometry',
    bytes: () =>
      encodeTile([
        EARTH,
        {
          name: 'buildings',
          features: [
            {
              type: 3,
              tags: { kind: 'building' },
              geometryBytes: Uint8Array.of(command(1, 1), 0xc8, 0x81),
            },
          ],
        },
      ]),
    refusal: { reason: 'malformed', layer: 'buildings' },
  },
  {
    name: 'a layer length past the end of the buffer',
    bytes: () => {
      const tile = encodeTile([EARTH]);
      return tile.subarray(0, tile.length - 3);
    },
    refusal: { reason: 'malformed', layer: null },
  },
  {
    name: 'a geometry command count past the end of the buffer',
    bytes: () =>
      buildingWithGeometry([command(1, 1), zigzag(100), zigzag(100), command(2, 1000), 2, 2, 4, 4]),
    refusal: { reason: 'malformed', layer: 'buildings' },
  },
  {
    name: 'a ClosePath with no ring',
    bytes: () => buildingWithGeometry([command(7, 1)]),
    refusal: { reason: 'malformed', layer: 'buildings' },
  },
  {
    name: 'a LineTo with no MoveTo',
    bytes: () => buildingWithGeometry([command(2, 2), 2, 2, 4, 4, command(7, 1)]),
    refusal: { reason: 'malformed', layer: 'buildings' },
  },
  {
    name: 'a ring left open',
    bytes: () =>
      buildingWithGeometry([
        command(1, 1),
        zigzag(100),
        zigzag(100),
        command(2, 2),
        zigzag(50),
        0,
        0,
        zigzag(50),
      ]),
    refusal: { reason: 'malformed', layer: 'buildings' },
  },
  {
    name: 'a hole before any outer ring',
    bytes: () =>
      buildingWithGeometry([
        command(1, 1),
        zigzag(100),
        zigzag(100),
        command(2, 2),
        0,
        zigzag(50),
        zigzag(50),
        0,
        command(7, 1),
      ]),
    refusal: { reason: 'malformed', layer: 'buildings' },
  },
  {
    name: 'a layer extent of 0',
    bytes: () => buildingWithGeometry(square, 0),
    refusal: { reason: 'malformed', layer: 'buildings' },
  },
  {
    name: 'a layer extent of 2^31',
    bytes: () => buildingWithGeometry(square, 2 ** 31),
    refusal: { reason: 'malformed', layer: 'buildings' },
  },
  {
    name: 'coordinates that run to 2^31 (where a projection makes NaN and Infinity)',
    bytes: () =>
      buildingWithGeometry([
        command(1, 1),
        zigzag(2 ** 30),
        zigzag(2 ** 30),
        command(2, 2),
        zigzag(2 ** 30),
        0,
        0,
        zigzag(2 ** 30),
        command(7, 1),
      ]),
    refusal: { reason: 'malformed', layer: 'buildings' },
  },
  {
    name: 'a tag pointing past the end of the value table',
    bytes: () => {
      // `buildings` first, so its feature's tags (`0, 0`) are the first such
      // run in the tile; the earth layer's feature has the same tags.
      const tile = encodeTile([
        {
          name: 'buildings',
          features: [{ type: 3, tags: { kind: 'building' }, geometry: square }],
        },
        EARTH,
      ]);
      // The value index is the second varint of the tags. Rewrite it to 9:
      // the layer has one value.
      const at = indexOfSequence(tile, Uint8Array.of(0x12, 0x02, 0x00, 0x00));
      const copy = tile.slice();
      copy[at + 3] = 9;
      return copy;
    },
    refusal: { reason: 'malformed', layer: 'buildings' },
  },
  {
    name: 'a tag pointing past the end of the value table, under a key that is never read',
    bytes: () => {
      const tile = encodeTile([
        {
          name: 'buildings',
          features: [{ type: 3, tags: { name: 'x', kind: 'building' }, geometry: square }],
        },
        EARTH,
      ]);
      // Tags `0, 0, 1, 1`: rewrite `name`'s value index to 9. The decoder never
      // reads `name`, and must refuse the tile anyway: the table is malformed.
      const at = indexOfSequence(tile, Uint8Array.of(0x12, 0x04, 0x00, 0x00, 0x01, 0x01));
      const copy = tile.slice();
      copy[at + 3] = 9;
      return copy;
    },
    refusal: { reason: 'malformed', layer: 'buildings' },
  },
  {
    name: 'a footway geometry one parameter short, with more of the feature after it',
    bytes: () =>
      encodeTile([
        EARTH,
        {
          name: 'roads',
          // The layer's keys and values follow the feature, so a reader that
          // ran past the geometry's end would take the next field's tag as
          // the missing parameter and return a line.
          features: [
            {
              type: 2,
              tags: { kind: 'path' },
              geometry: [
                command(1, 1),
                zigzag(100),
                zigzag(100),
                command(2, 2),
                zigzag(10),
                0,
                zigzag(10),
              ],
            },
          ],
        },
      ]),
    refusal: { reason: 'malformed', layer: 'roads' },
  },
  {
    name: 'a group wire type',
    bytes: () => Uint8Array.of(0x0b),
    refusal: { reason: 'malformed', layer: null },
  },
  {
    name: 'a read layer of MVT version 1',
    bytes: () => encodeTile([EARTH, { name: 'landuse', version: 1, features: [] }]),
    refusal: { reason: 'wrong-schema' },
  },
  {
    name: 'a polygon in roads',
    bytes: () =>
      encodeTile([
        EARTH,
        { name: 'roads', features: [{ type: 3, tags: { kind: 'path' }, geometry: square }] },
      ]),
    refusal: { reason: 'wrong-schema' },
  },
  {
    name: 'neither earth nor water',
    bytes: () =>
      encodeTile([
        {
          name: 'buildings',
          features: [{ type: 3, tags: { kind: 'building' }, geometry: square }],
        },
      ]),
    refusal: { reason: 'wrong-schema' },
  },
  {
    name: 'a feature with 10^6 LineTo commands',
    bytes: millionLineToTile,
    refusal: { reason: 'too-many-vertices', layer: 'roads', limit: MAX_VERTICES_PER_FEATURE },
  },
  {
    name: 'a tile over the byte limit',
    bytes: () => tileOverLimit('bytes'),
    refusal: { reason: 'too-large', bytes: MAX_TILE_BYTES + 1, limit: MAX_TILE_BYTES },
  },
  {
    name: 'a layer over the feature limit',
    bytes: () => tileOverLimit('featuresPerLayer'),
    refusal: {
      reason: 'too-many-features',
      layer: 'buildings',
      count: MAX_FEATURES_PER_LAYER + 1,
      limit: MAX_FEATURES_PER_LAYER,
    },
  },
  {
    name: 'a feature over the vertex limit',
    bytes: () => tileOverLimit('verticesPerFeature'),
    refusal: { reason: 'too-many-vertices', layer: 'roads', limit: MAX_VERTICES_PER_FEATURE },
  },
  {
    name: 'a tile over the vertex limit',
    bytes: () => tileOverLimit('verticesPerTile'),
    refusal: { reason: 'too-many-vertices', layer: 'roads', limit: MAX_VERTICES_PER_TILE },
  },
  {
    name: 'a polygon over the ring limit',
    bytes: () => tileOverLimit('ringsPerPolygon'),
    refusal: { reason: 'too-many-rings', layer: 'landuse', limit: MAX_RINGS_PER_POLYGON },
  },
];

function indexOfSequence(haystack: Uint8Array, needle: Uint8Array): number {
  outer: for (let i = 0; i + needle.length <= haystack.length; i++) {
    for (let j = 0; j < needle.length; j++) if (haystack[i + j] !== needle[j]) continue outer;
    return i;
  }
  throw new RangeError('indexOfSequence: not found');
}
