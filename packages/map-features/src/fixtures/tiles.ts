// SPDX-License-Identifier: Apache-2.0

/**
 * The synthetic tiles every criterion of #1544 runs on, built by
 * `../testing/mvt-encoder.ts` from arithmetic only. **No OpenStreetMap data of
 * any kind**: every shape below is a rectangle, a regular polygon or a line of
 * evenly spaced points, and every name is made up.
 *
 * Committed as code, not as binary tiles. A binary in the tree would need an
 * `.spdx-exempt` entry it does not qualify for (docs/agents/licence-boundary.md
 * §3a) and could not be read in review, which is the reasoning
 * `apps/web/browser/pmtiles-fixture.ts` records; and the encoder is
 * deterministic, so the code is the fixture. `fixtures.test.ts` pins each
 * one's SHA-256, so that a change to the encoder that moves a byte is a red test.
 */

import { latitudeAtRow, longitudeAtColumn } from '../projection';
import {
  encodeTile,
  holeRing,
  line,
  outerRing,
  points,
  polygon,
  rectangle,
  type LayerSpec,
} from '../testing/mvt-encoder';
import type { CorridorFrame, TileId } from '../types';

/** The tile every fixture is decoded as. Its digits collide with no limit. */
export const FIXTURE_TILE: TileId = { z: 15, x: 9371, y: 12538 };

/** The fixtures' extent, Protomaps' own. */
export const FIXTURE_EXTENT = 4096;

/** The projection origin: an eighth of the way into the tile from its north-west corner. */
export const FIXTURE_FRAME: CorridorFrame = {
  latitude: latitudeAtRow(FIXTURE_TILE.y + 0.125),
  longitude: longitudeAtColumn(FIXTURE_TILE.x + 0.125),
};

/**
 * Fields the decoder must never carry into its result (ADR 0012 D-3's trap):
 * a name, the `pmap:*` fields, an address, and a feature id.
 */
export const POISON = {
  name: 'Fixture Lane Recreation Ground',
  nameEn: 'Fixture Lane Recreation Ground (en)',
  pmapKind: 'fixture_pmap_kind',
  pmapMinZoom: 13,
  address: '742',
  id: 9_007_199_254_740,
} as const;

const poisonTags = {
  name: POISON.name,
  'name:en': POISON.nameEn,
  'pmap:kind': POISON.pmapKind,
  'pmap:min_zoom': POISON.pmapMinZoom,
} as const;

/** Land, so the tile carries the schema's signature (`schema.ts` §`EARTH_LAYER`). */
export const EARTH: LayerSpec = {
  name: 'earth',
  features: [
    {
      type: 3,
      tags: { kind: 'earth' },
      geometry: polygon([outerRing(rectangle(-64, -64, 4160, 4160))]),
    },
  ],
};

/** Layers that are never read: they carry names. */
const UNREAD_NAMED_LAYERS: readonly LayerSpec[] = [
  {
    name: 'pois',
    features: [
      {
        id: POISON.id,
        type: 1,
        tags: { ...poisonTags, kind: 'park' },
        geometry: points([[1000, 1000]]),
      },
    ],
  },
  {
    name: 'places',
    features: [
      {
        id: POISON.id,
        type: 1,
        tags: { ...poisonTags, kind: 'locality' },
        geometry: points([[1200, 1200]]),
      },
    ],
  },
];

/** The residential block's three footprints, in tile pixels: [x0, y0, x1, y1, height]. */
export const RESIDENTIAL_FOOTPRINTS: readonly (readonly [
  number,
  number,
  number,
  number,
  number | null,
])[] = [
  [700, 700, 900, 860, 6],
  [1000, 700, 1180, 900, 9.5],
  [700, 1000, 940, 1180, null],
];

/**
 * A residential block with three footprints. Every feature also carries a
 * name, `pmap:*` fields, an address and an id, and the tile carries the
 * `pois` and `places` layers, all of which the decoder must leave behind.
 */
export function residentialBlockTile(): Uint8Array {
  return encodeTile([
    EARTH,
    {
      name: 'landuse',
      features: [
        {
          id: POISON.id,
          type: 3,
          tags: { ...poisonTags, kind: 'residential' },
          geometry: polygon([outerRing(rectangle(600, 600, 1400, 1400))]),
        },
      ],
    },
    {
      name: 'buildings',
      features: RESIDENTIAL_FOOTPRINTS.map(([x0, y0, x1, y1, height], i) => ({
        id: POISON.id + i,
        type: 3,
        tags: {
          ...poisonTags,
          kind: 'building',
          addr_housenumber: POISON.address,
          ...(height === null ? {} : { height }),
        },
        geometry: polygon([outerRing(rectangle(x0, y0, x1, y1))]),
      })),
    },
    ...UNREAD_NAMED_LAYERS,
  ]);
}

/** A regular polygon of `sides` vertices about `(cx, cy)`, in whole tile pixels. */
export function regularPolygon(
  cx: number,
  cy: number,
  radius: number,
  sides: number,
): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < sides; i++) {
    const angle = (2 * Math.PI * i) / sides + 0.1;
    out.push([
      Math.round(cx + radius * Math.cos(angle)),
      Math.round(cy + radius * Math.sin(angle)),
    ]);
  }
  return out;
}

/** The wood's outer ring and its hole, in tile pixels. */
export const WOOD_OUTER = regularPolygon(1500, 1500, 900, 24);
export const WOOD_HOLE = regularPolygon(1450, 1550, 320, 9);

/** A wood with a clearing in it: one polygon, one hole. */
export function woodWithHoleTile(): Uint8Array {
  return encodeTile([
    EARTH,
    {
      name: 'landuse',
      features: [
        {
          id: POISON.id,
          type: 3,
          tags: { ...poisonTags, kind: 'wood' },
          geometry: polygon([outerRing(WOOD_OUTER), holeRing(WOOD_HOLE)]),
        },
      ],
    },
  ]);
}

/** A lake, with a stream and a label point beside it that are not kept. */
export function lakeTile(): Uint8Array {
  return encodeTile([
    {
      name: 'water',
      features: [
        {
          id: POISON.id,
          type: 3,
          tags: { ...poisonTags, kind: 'lake' },
          geometry: polygon([outerRing(regularPolygon(2600, 2400, 500, 16))]),
        },
        {
          type: 2,
          tags: { kind: 'stream' },
          geometry: line([
            [
              [2000, 2000],
              [1500, 1700],
              [1100, 1300],
            ],
          ]),
        },
        { type: 1, tags: { ...poisonTags, kind: 'lake' }, geometry: points([[2600, 2400]]) },
      ],
    },
  ]);
}

/** The sidewalk's line, in tile pixels. */
export const SIDEWALK_LINE: readonly (readonly [number, number])[] = [
  [300, 2000],
  [1300, 2010],
  [2300, 2030],
  [3300, 2060],
];

/** A sidewalk beside a residential street; the street is not a footway and is dropped. */
export function sidewalkTile(): Uint8Array {
  return encodeTile([
    EARTH,
    {
      name: 'roads',
      features: [
        {
          id: POISON.id,
          type: 2,
          tags: { ...poisonTags, kind: 'path', kind_detail: 'sidewalk' },
          geometry: line([SIDEWALK_LINE]),
        },
        {
          id: POISON.id + 1,
          type: 2,
          tags: { ...poisonTags, kind: 'minor_road', kind_detail: 'residential' },
          geometry: line([
            [
              [300, 1980],
              [3300, 2040],
            ],
          ]),
        },
      ],
    },
  ]);
}

/** A `building_part` on a raised base, and an address point that is dropped. */
export function buildingPartTile(): Uint8Array {
  return encodeTile([
    EARTH,
    {
      name: 'buildings',
      features: [
        {
          id: POISON.id,
          type: 3,
          tags: { ...poisonTags, kind: 'building_part', height: 30, min_height: 12 },
          geometry: polygon([outerRing(rectangle(2000, 600, 2200, 820))]),
        },
        {
          type: 1,
          tags: { kind: 'address', addr_housenumber: POISON.address },
          geometry: points([[2100, 700]]),
        },
      ],
    },
  ]);
}

/** The five named fixtures, for the walks that run over all of them. */
export const NAMED_FIXTURES: Readonly<Record<string, () => Uint8Array>> = {
  residentialBlock: residentialBlockTile,
  woodWithHole: woodWithHoleTile,
  lake: lakeTile,
  sidewalk: sidewalkTile,
  buildingPart: buildingPartTile,
};
