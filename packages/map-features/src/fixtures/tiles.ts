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
  type TagValue,
} from '../testing/mvt-encoder';
import type { CorridorFrame, StreetRoadFields, TileId } from '../types';

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

/**
 * A `pois` point of a kind no class names (a park), so it is dropped unread
 * (#2975), and a `places` point that carries no `kind_detail` or
 * `population_rank`, so it is dropped (#1632).
 */
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

/** A sidewalk beside a residential street; the street is not a footway, and since #1565 is a street. */
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

/**
 * The roads a cross street is read from (#1565), each a straight line of two
 * points in tile pixels, with the sink it must land in: `streets`, `paths` or
 * `null` (dropped).
 */
export const STREET_FIXTURE_ROADS: readonly {
  readonly kind: string;
  readonly kindDetail?: string;
  readonly sink: 'streets' | 'paths' | 'rails' | null;
  /** `is_bridge` and `is_tunnel`, where the feature carries them, and the grade a street gets. */
  readonly isBridge?: boolean;
  readonly isTunnel?: boolean;
  readonly grade?: 'ground' | 'bridge' | 'tunnel';
  readonly line: readonly (readonly [number, number])[];
}[] = [
  {
    kind: 'highway',
    kindDetail: 'motorway',
    sink: 'streets',
    line: [
      [100, 400],
      [4000, 400],
    ],
  },
  {
    kind: 'major_road',
    kindDetail: 'primary',
    sink: 'streets',
    line: [
      [100, 900],
      [4000, 900],
    ],
  },
  {
    kind: 'minor_road',
    sink: 'streets',
    line: [
      [100, 1400],
      [4000, 1400],
    ],
  },
  {
    kind: 'other',
    kindDetail: 'residential',
    sink: 'streets',
    line: [
      [100, 1900],
      [4000, 1900],
    ],
  },
  {
    kind: 'other',
    kindDetail: 'platform',
    sink: null,
    line: [
      [100, 2400],
      [4000, 2400],
    ],
  },
  {
    kind: 'minor_road',
    kindDetail: 'sidewalk',
    sink: 'paths',
    line: [
      [100, 2900],
      [4000, 2900],
    ],
  },
  // #2660: a railway kept as track, and the details that are not.
  {
    kind: 'rail',
    kindDetail: 'rail',
    sink: 'rails',
    line: [
      [100, 3300],
      [4000, 3300],
    ],
  },
  {
    kind: 'rail',
    kindDetail: 'light_rail',
    sink: 'rails',
    isBridge: true,
    grade: 'bridge',
    line: [
      [100, 3350],
      [4000, 3350],
    ],
  },
  {
    kind: 'rail',
    kindDetail: 'subway',
    sink: null,
    line: [
      [100, 3400],
      [4000, 3400],
    ],
  },
  {
    kind: 'rail',
    kindDetail: 'tram',
    sink: null,
    line: [
      [100, 3450],
      [4000, 3450],
    ],
  },
  {
    kind: 'rail',
    sink: null,
    line: [
      [100, 3500],
      [4000, 3500],
    ],
  },
  {
    kind: 'ferry',
    sink: null,
    line: [
      [100, 3700],
      [4000, 3700],
    ],
  },
  // A street's detail on a kind that is not a street: still not one.
  {
    kind: 'aeroway',
    kindDetail: 'road',
    sink: null,
    line: [
      [100, 3950],
      [4000, 3950],
    ],
  },
  // Grade separation: a bridge, a tunnel, and a flag that is `false`.
  {
    kind: 'major_road',
    kindDetail: 'secondary',
    sink: 'streets',
    isBridge: true,
    grade: 'bridge',
    line: [
      [100, 4000],
      [4000, 4000],
    ],
  },
  {
    kind: 'minor_road',
    kindDetail: 'tertiary',
    sink: 'streets',
    isTunnel: true,
    grade: 'tunnel',
    line: [
      [100, 4040],
      [4000, 4040],
    ],
  },
  {
    kind: 'minor_road',
    kindDetail: 'unclassified',
    sink: 'streets',
    isBridge: false,
    isTunnel: false,
    grade: 'ground',
    line: [
      [100, 4080],
      [4000, 4080],
    ],
  },
];

/** {@link STREET_FIXTURE_ROADS} as one `roads` layer, every feature carrying a name and an id. */
export function streetsTile(): Uint8Array {
  return encodeTile([
    EARTH,
    {
      name: 'roads',
      features: STREET_FIXTURE_ROADS.map((road, index) => ({
        id: POISON.id + index,
        type: 2,
        tags: {
          ...poisonTags,
          kind: road.kind,
          ...(road.kindDetail === undefined ? {} : { kind_detail: road.kindDetail }),
          ...(road.isBridge === undefined ? {} : { is_bridge: road.isBridge }),
          ...(road.isTunnel === undefined ? {} : { is_tunnel: road.isTunnel }),
        },
        geometry: line([road.line]),
      })),
    },
  ]);
}

/**
 * The road fields (#2892, ADR 0091 D-2): one straight street a row, each with
 * the tags it carries besides its kind and the fields it must decode to. Row
 * `i` runs along tile row `300 + 300·i`, so the streets come back in this
 * order.
 */
export const ROAD_FIELD_FIXTURE_STREETS: readonly {
  readonly label: string;
  readonly tags: Readonly<Record<string, TagValue>>;
  readonly expected: StreetRoadFields;
}[] = [
  {
    label: 'none of the three: every default',
    tags: { kind: 'minor_road' },
    expected: { oneway: 'no', access: 'open', isLink: false },
  },
  {
    label: 'oneway yes: along the line',
    tags: { kind: 'minor_road', oneway: 'yes' },
    expected: { oneway: 'with-line', access: 'open', isLink: false },
  },
  {
    label: 'oneway -1: against the line',
    tags: { kind: 'minor_road', oneway: '-1' },
    expected: { oneway: 'against-line', access: 'open', isLink: false },
  },
  {
    label: 'oneway no',
    tags: { kind: 'major_road', kind_detail: 'primary', oneway: 'no' },
    expected: { oneway: 'no', access: 'open', isLink: false },
  },
  {
    label: 'access private',
    tags: { kind: 'other', kind_detail: 'service', access: 'private' },
    expected: { oneway: 'no', access: 'private', isLink: false },
  },
  {
    label: 'access no',
    tags: { kind: 'minor_road', access: 'no' },
    expected: { oneway: 'no', access: 'no', isLink: false },
  },
  {
    label: 'access destination: open',
    tags: { kind: 'minor_road', access: 'destination' },
    expected: { oneway: 'no', access: 'open', isLink: false },
  },
  {
    label: 'access yes: open',
    tags: { kind: 'minor_road', access: 'yes' },
    expected: { oneway: 'no', access: 'open', isLink: false },
  },
  {
    label: 'is_link true',
    tags: { kind: 'major_road', kind_detail: 'primary', is_link: true },
    expected: { oneway: 'no', access: 'open', isLink: true },
  },
  {
    label: 'is_link false',
    tags: { kind: 'major_road', kind_detail: 'secondary', is_link: false },
    expected: { oneway: 'no', access: 'open', isLink: false },
  },
  {
    label: 'all three, on a bridge',
    tags: {
      kind: 'major_road',
      kind_detail: 'trunk',
      oneway: '-1',
      access: 'customers',
      is_link: true,
      is_bridge: true,
    },
    expected: { oneway: 'against-line', access: 'open', isLink: true },
  },
];

/**
 * {@link ROAD_FIELD_FIXTURE_STREETS} as one `roads` layer, every feature
 * carrying a name, the `pmap:*` fields, an address and an id, so that the walk
 * over the named fixtures runs with the road fields present (#2892). Two roads
 * that are not streets — a footway and a railway — carry values the lists do
 * not name: they are not streets, so nothing of theirs is read or counted.
 */
export function roadFieldsTile(): Uint8Array {
  const poisoned = { ...poisonTags, addr_housenumber: POISON.address };
  return encodeTile([
    EARTH,
    {
      name: 'roads',
      features: [
        ...ROAD_FIELD_FIXTURE_STREETS.map((street, index) => ({
          id: POISON.id + index,
          type: 2,
          tags: { ...poisoned, ...street.tags },
          geometry: line([
            [
              [100, 300 + 300 * index],
              [4000, 300 + 300 * index],
            ],
          ]),
        })),
        {
          type: 2,
          tags: { ...poisoned, kind: 'path', kind_detail: 'footway', oneway: 'reversible' },
          geometry: line([
            [
              [100, 3800],
              [4000, 3800],
            ],
          ]),
        },
        {
          type: 2,
          tags: { ...poisoned, kind: 'rail', kind_detail: 'rail', is_link: 'yes', access: 7 },
          geometry: line([
            [
              [100, 3900],
              [4000, 3900],
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

/**
 * The value every place in {@link placesTile} carries under `name`, `name:en`
 * and `wikidata` (#1632, ADR 0055 D-3). Shaped as a Protomaps identifier —
 * lower-case letters and `_` — on purpose: the decoder's identifier reader
 * would admit it, so a decoder that looked `name` up at all would carry it
 * into its result, and the test that it never appears could go red.
 */
export const PLACE_SENTINEL = 'zz_sentinel_name';

/**
 * The places of {@link placesTile}: every kind and detail ADR 0055 D-2 keeps,
 * in tile pixels. Made up; nothing here is a real place.
 */
export const PLACE_FIXTURE_POINTS: readonly {
  readonly kind: 'locality' | 'neighbourhood' | 'macrohood';
  readonly kindDetail: 'city' | 'town' | 'village' | 'hamlet' | 'suburb' | 'quarter';
  readonly populationRank: number;
  readonly at: readonly [number, number];
}[] = [
  { kind: 'locality', kindDetail: 'city', populationRank: 11, at: [1200, 1200] },
  { kind: 'locality', kindDetail: 'town', populationRank: 7, at: [2800, 900] },
  { kind: 'locality', kindDetail: 'village', populationRank: 4, at: [600, 3100] },
  { kind: 'locality', kindDetail: 'hamlet', populationRank: 1, at: [3500, 3500] },
  { kind: 'neighbourhood', kindDetail: 'suburb', populationRank: 3, at: [2100, 2500] },
  { kind: 'macrohood', kindDetail: 'quarter', populationRank: 18, at: [1700, 400] },
];

/**
 * A `places` layer of {@link PLACE_FIXTURE_POINTS} (#1632), each point also
 * carrying {@link PLACE_SENTINEL} as its name, `name:en` and `wikidata`, a
 * `population`, a `capital`, the `pmap:*` fields and an id — none of which
 * the decoder may read.
 */
export function placesTile(): Uint8Array {
  return encodeTile([
    EARTH,
    {
      name: 'places',
      features: PLACE_FIXTURE_POINTS.map((place, index) => ({
        id: POISON.id + index,
        type: 1,
        tags: {
          ...poisonTags,
          name: PLACE_SENTINEL,
          'name:en': PLACE_SENTINEL,
          wikidata: PLACE_SENTINEL,
          population: 271_828 + index,
          capital: 'yes',
          kind: place.kind,
          kind_detail: place.kindDetail,
          population_rank: place.populationRank,
        },
        geometry: points([place.at]),
      })),
    },
  ]);
}

/**
 * #1789: every building field set, to a value its rule admits, as #1557's
 * profile writes them: an enum as a string, a number as a number. Made up;
 * the combination describes no real building.
 */
export const BUILDING_FIELDS_SET = {
  building_type: 'church',
  levels: 3,
  roof_levels: 1,
  roof_shape: 'gabled',
  roof_orientation: 'across',
  roof_direction: 135,
  wall_colour: 4,
  roof_colour: 11,
  wall_material: 'stone',
  roof_material: 'slate',
  start_year: 1887,
  landmark: 'worship',
} as const;

/** {@link BUILDING_FIELDS_SET} as the decoder hands it back, by `BuildingFeature`'s names. */
export const BUILDING_FIELDS_DECODED = {
  buildingType: 'church',
  levels: 3,
  roofLevels: 1,
  roofShape: 'gabled',
  roofOrientation: 'across',
  roofDirectionDegrees: 135,
  wallColour: 4,
  roofColour: 11,
  wallMaterial: 'stone',
  roofMaterial: 'slate',
  startYear: 1887,
  landmark: 'worship',
} as const;

/**
 * #1789: a second set, every value another, on a `building_part`, so a field
 * swapped for its neighbour in a round trip shows.
 */
export const BUILDING_PART_FIELDS_SET = {
  building_type: 'retail',
  levels: 12,
  roof_levels: 0,
  roof_shape: 'flat',
  roof_orientation: 'along',
  roof_direction: 345,
  wall_colour: 19,
  roof_colour: 0,
  wall_material: 'glass',
  roof_material: 'concrete',
  start_year: 1972,
  landmark: 'school',
} as const;

export const BUILDING_PART_FIELDS_DECODED = {
  buildingType: 'retail',
  levels: 12,
  roofLevels: 0,
  roofShape: 'flat',
  roofOrientation: 'along',
  roofDirectionDegrees: 345,
  wallColour: 19,
  roofColour: 0,
  wallMaterial: 'glass',
  roofMaterial: 'concrete',
  startYear: 1972,
  landmark: 'school',
} as const;

/**
 * #1789: three footprints from an archive #1557's profile built — one with
 * {@link BUILDING_FIELDS_SET}, a `building_part` with
 * {@link BUILDING_PART_FIELDS_SET}, and one with none of the fields — each
 * also carrying a name, the `pmap:*` fields, an address and an id.
 */
export function buildingFieldsTile(): Uint8Array {
  return encodeTile([
    EARTH,
    {
      name: 'buildings',
      features: [
        {
          id: POISON.id,
          type: 3,
          tags: { ...poisonTags, kind: 'building', height: 14, ...BUILDING_FIELDS_SET },
          geometry: polygon([outerRing(rectangle(1500, 1500, 1700, 1760))]),
        },
        {
          id: POISON.id + 1,
          type: 3,
          tags: {
            ...poisonTags,
            kind: 'building_part',
            height: 40,
            min_height: 3,
            ...BUILDING_PART_FIELDS_SET,
          },
          geometry: polygon([outerRing(rectangle(2000, 1500, 2200, 1700))]),
        },
        {
          id: POISON.id + 2,
          type: 3,
          tags: { ...poisonTags, kind: 'building', addr_housenumber: POISON.address },
          geometry: polygon([outerRing(rectangle(2400, 1500, 2560, 1640))]),
        },
      ],
    },
  ]);
}

/**
 * #2659's water lines, each a straight line across the tile with a name and
 * an id: every `kind` Protomaps v4 writes on a waterway line (`Water.java`),
 * one it does not, and one with none. Only {@link WATER_LINE_FIXTURE_KEPT}
 * survive the decode.
 */
export const WATER_LINE_FIXTURE_LINES: readonly {
  readonly kind: string | undefined;
  readonly line: readonly (readonly [number, number])[];
}[] = [
  {
    kind: 'river',
    line: [
      [200, 300],
      [3900, 400],
    ],
  },
  {
    kind: 'stream',
    line: [
      [200, 900],
      [2000, 1000],
      [3900, 1100],
    ],
  },
  {
    kind: 'canal',
    line: [
      [200, 1600],
      [3900, 1600],
    ],
  },
  {
    kind: 'ditch',
    line: [
      [200, 2200],
      [3900, 2200],
    ],
  },
  {
    kind: 'drain',
    line: [
      [200, 2800],
      [3900, 2800],
    ],
  },
  {
    kind: 'riverbank',
    line: [
      [200, 3300],
      [3900, 3300],
    ],
  },
  {
    kind: undefined,
    line: [
      [200, 3800],
      [3900, 3800],
    ],
  },
];

/** The kinds of {@link WATER_LINE_FIXTURE_LINES} the decoder keeps, in order. */
export const WATER_LINE_FIXTURE_KEPT = ['river', 'stream', 'canal', 'ditch', 'drain'] as const;

/** {@link WATER_LINE_FIXTURE_LINES} as one `water` layer, beside a lake polygon. */
export function waterLinesTile(): Uint8Array {
  return encodeTile([
    EARTH,
    {
      name: 'water',
      features: [
        {
          type: 3,
          tags: { kind: 'lake' },
          geometry: polygon([outerRing(regularPolygon(3000, 3000, 300, 12))]),
        },
        ...WATER_LINE_FIXTURE_LINES.map((each, index) => ({
          id: POISON.id + index,
          type: 2,
          tags: { ...poisonTags, ...(each.kind === undefined ? {} : { kind: each.kind }) },
          geometry: line([each.line]),
        })),
      ],
    },
  ]);
}

/**
 * The value every POI in {@link poisTile} carries under `name`, `brand`,
 * `kind_detail` and `wikidata` (#2975). Shaped as a Protomaps identifier, as
 * {@link PLACE_SENTINEL} is, so that a decoder that looked any of them up
 * would carry it into its result.
 */
export const POI_SENTINEL = 'zz_sentinel_brand';

/**
 * The footprints of {@link poisTile}, in tile pixels, and the class each is
 * to decode with (#2975). At this tile's latitude a pixel is about 0.23 m, so
 * a shop's 3 m reach is about 13 pixels and a fuel station's 30 m about 129.
 * Made up; nothing here is a real shop.
 */
export const POI_FIXTURE_BUILDINGS: readonly {
  readonly name: string;
  readonly kind: 'building' | 'building_part';
  readonly rings: readonly (readonly [number, number])[][];
  readonly poi: 'shop' | 'cafe' | 'fuel' | undefined;
}[] = [
  {
    name: 'a bakery inside',
    kind: 'building',
    rings: [rectangle(400, 400, 500, 480)],
    poi: 'shop',
  },
  {
    name: 'a clothes shop and a restaurant inside: the café wins',
    kind: 'building',
    rings: [rectangle(700, 400, 800, 480)],
    poi: 'cafe',
  },
  {
    name: 'a fuel forecourt 80 px (19 m) south of it',
    kind: 'building',
    rings: [rectangle(1000, 400, 1060, 440)],
    poi: 'fuel',
  },
  {
    name: 'a tree and a `constructor` inside: neither is a class',
    kind: 'building',
    rings: [rectangle(1300, 400, 1400, 480)],
    poi: undefined,
  },
  {
    name: 'a bakery 60 px (14 m) south: past a shop’s reach',
    kind: 'building',
    rings: [rectangle(1600, 400, 1700, 480)],
    poi: undefined,
  },
  {
    name: 'a café 8 px (1.9 m) south: within its reach',
    kind: 'building',
    rings: [rectangle(1900, 400, 2000, 480)],
    poi: 'cafe',
  },
  {
    name: 'a bakery in its courtyard, 100 px from every wall',
    kind: 'building',
    rings: [rectangle(400, 1000, 800, 1400), rectangle(500, 1100, 700, 1300)],
    poi: undefined,
  },
  {
    name: 'a bookshop inside, and inside its part',
    kind: 'building',
    rings: [rectangle(1000, 1000, 1100, 1100)],
    poi: 'shop',
  },
  {
    name: 'the part: never given one',
    kind: 'building_part',
    rings: [rectangle(1020, 1020, 1080, 1080)],
    poi: undefined,
  },
  {
    name: 'a café polygon and a café multipoint over it: neither is a point',
    kind: 'building',
    rings: [rectangle(1300, 1000, 1400, 1100)],
    poi: undefined,
  },
];

/** The POIs of {@link poisTile}: a kind, and a point, a multipoint or a polygon in tile pixels. */
const POI_FIXTURE_POINTS: readonly {
  readonly kind: string;
  readonly type: 1 | 3;
  readonly geometry: number[];
}[] = [
  { kind: 'bakery', type: 1, geometry: points([[450, 440]]) },
  { kind: 'clothes', type: 1, geometry: points([[720, 420]]) },
  { kind: 'restaurant', type: 1, geometry: points([[760, 440]]) },
  { kind: 'fuel', type: 1, geometry: points([[1030, 520]]) },
  { kind: 'tree', type: 1, geometry: points([[1320, 420]]) },
  { kind: 'constructor', type: 1, geometry: points([[1350, 440]]) },
  { kind: 'bakery', type: 1, geometry: points([[1650, 540]]) },
  { kind: 'cafe', type: 1, geometry: points([[1950, 488]]) },
  { kind: 'bakery', type: 1, geometry: points([[600, 1200]]) },
  { kind: 'books', type: 1, geometry: points([[1050, 1050]]) },
  { kind: 'cafe', type: 3, geometry: polygon([outerRing(rectangle(1310, 1010, 1390, 1090))]) },
  {
    kind: 'cafe',
    type: 1,
    geometry: points([
      [1330, 1030],
      [1370, 1070],
    ]),
  },
];

/**
 * #2975: {@link POI_FIXTURE_BUILDINGS} and a `pois` layer — written ahead of
 * `buildings`, so a match cannot lean on the tile's layer order — whose every
 * point also carries {@link POI_SENTINEL} as its name, brand, `kind_detail`
 * and `wikidata`, the `pmap:*` fields, a `min_zoom` and an id, none of which
 * the decoder may read.
 */
export function poisTile(): Uint8Array {
  return encodeTile([
    EARTH,
    {
      name: 'pois',
      features: POI_FIXTURE_POINTS.map((poi, index) => ({
        id: POISON.id + index,
        type: poi.type,
        tags: {
          ...poisonTags,
          name: POI_SENTINEL,
          brand: POI_SENTINEL,
          kind_detail: POI_SENTINEL,
          wikidata: POI_SENTINEL,
          min_zoom: 16,
          kind: poi.kind,
        },
        geometry: poi.geometry,
      })),
    },
    {
      name: 'buildings',
      features: POI_FIXTURE_BUILDINGS.map((building) => ({
        type: 3,
        tags: { ...poisonTags, kind: building.kind, height: 6 },
        geometry: polygon(
          building.rings.map((ring, index) => (index === 0 ? outerRing(ring) : holeRing(ring))),
        ),
      })),
    },
  ]);
}

/** The eleven named fixtures, for the walks that run over all of them. */
export const NAMED_FIXTURES: Readonly<Record<string, () => Uint8Array>> = {
  residentialBlock: residentialBlockTile,
  woodWithHole: woodWithHoleTile,
  lake: lakeTile,
  sidewalk: sidewalkTile,
  buildingPart: buildingPartTile,
  streets: streetsTile,
  places: placesTile,
  buildingFields: buildingFieldsTile,
  waterLines: waterLinesTile,
  roadFields: roadFieldsTile,
  pois: poisTile,
};
