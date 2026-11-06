// SPDX-License-Identifier: Apache-2.0

/**
 * Tiles no honest encoder writes (#1544's third criterion), each with the
 * refusal it must produce. Built by hand on top of `../testing/mvt-encoder.ts`,
 * which will write any version, extent or geometry integer it is given.
 */

import {
  MAX_PLACES_PER_TILE,
  MAX_RINGS_PER_POLYGON,
  MAX_TILE_BYTES,
  MAX_FEATURES_PER_LAYER,
  MAX_VERTICES_PER_FEATURE,
  MAX_VERTICES_PER_TILE,
} from '../limits';
import {
  command,
  encodeTile,
  line,
  outerRing,
  points,
  polygon,
  rectangle,
  zigzag,
  type FeatureSpec,
  type TagValue,
} from '../testing/mvt-encoder';
import {
  BUILDING_FIELD_NAMES,
  BUILDING_FIELD_RULES,
  MAX_START_YEAR,
  MIN_START_YEAR,
  type BuildingFieldName,
} from '../schema';
import type { DecodeRefusal, PlaceFeature } from '../types';
import { tileOverLimit } from './limits';
import { BUILDING_FIELDS_SET, EARTH, SIDEWALK_LINE } from './tiles';

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

/** A `places` point, with the given tags, at a pixel. */
function placeAt(
  tags: Readonly<Record<string, TagValue>>,
  at: readonly [number, number] = [2000, 2000],
): FeatureSpec {
  return { type: 1, tags, geometry: points([at]) };
}

/** A place every edge fixture also carries, which must be kept: the drop is not the whole layer's. */
export const KEPT_PLACE_TAGS = { kind: 'locality', kind_detail: 'city', population_rank: 10 };

/** {@link KEPT_PLACE_TAGS}' point as the decoder hands it back, less its position. */
export const KEPT_PLACE: Pick<PlaceFeature, 'kind' | 'kindDetail' | 'populationRank'> = {
  kind: 'locality',
  kindDetail: 'city',
  populationRank: 10,
};

/** A tile of a building and a `places` layer of the kept place and then `edge`. */
function placesWith(edge: FeatureSpec): Uint8Array {
  return encodeTile([
    EARTH,
    {
      name: 'buildings',
      features: [{ type: 3, tags: { kind: 'building' }, geometry: square }],
    },
    { name: 'places', features: [placeAt(KEPT_PLACE_TAGS, [1000, 1000]), edge] },
  ]);
}

export interface DroppedPlaceFixture {
  readonly name: string;
  readonly bytes: () => Uint8Array;
}

/**
 * Places ADR 0055 D-2 does not admit (#1632): each tile decodes, keeps its
 * building and {@link KEPT_PLACE}, and drops the other point without throwing.
 */
export const DROPPED_PLACE_FIXTURES: readonly DroppedPlaceFixture[] = [
  {
    name: 'an unknown kind (country)',
    bytes: () => placesWith(placeAt({ kind: 'country', kind_detail: 'city', population_rank: 12 })),
  },
  {
    name: 'an unknown kind (one no archive writes)',
    bytes: () =>
      placesWith(placeAt({ kind: 'metropolis', kind_detail: 'city', population_rank: 12 })),
  },
  {
    name: 'an unknown kind_detail (neighbourhood)',
    bytes: () =>
      placesWith(
        placeAt({ kind: 'neighbourhood', kind_detail: 'neighbourhood', population_rank: 4 }),
      ),
  },
  {
    name: 'an unknown kind_detail (isolated_dwelling)',
    bytes: () =>
      placesWith(
        placeAt({ kind: 'locality', kind_detail: 'isolated_dwelling', population_rank: 1 }),
      ),
  },
  {
    name: 'no kind_detail',
    bytes: () => placesWith(placeAt({ kind: 'locality', population_rank: 9 })),
  },
  {
    name: 'a negative population_rank',
    bytes: () =>
      placesWith(placeAt({ kind: 'locality', kind_detail: 'city', population_rank: -3 })),
  },
  {
    name: 'a population_rank of 0',
    bytes: () => placesWith(placeAt({ kind: 'locality', kind_detail: 'city', population_rank: 0 })),
  },
  {
    name: 'a population_rank above the bound (19)',
    bytes: () =>
      placesWith(placeAt({ kind: 'locality', kind_detail: 'city', population_rank: 19 })),
  },
  {
    name: 'a population_rank that is not an integer (9.5)',
    bytes: () =>
      placesWith(placeAt({ kind: 'locality', kind_detail: 'city', population_rank: 9.5 })),
  },
  {
    name: 'a population_rank that is a string',
    bytes: () =>
      placesWith(placeAt({ kind: 'locality', kind_detail: 'city', population_rank: '12' })),
  },
  {
    name: 'no population_rank',
    bytes: () => placesWith(placeAt({ kind: 'locality', kind_detail: 'city' })),
  },
  {
    name: 'a polygon instead of a point',
    bytes: () =>
      placesWith({
        type: 3,
        tags: KEPT_PLACE_TAGS,
        geometry: polygon([outerRing(rectangle(1500, 1500, 1700, 1700))]),
      }),
  },
  {
    name: 'a line instead of a point',
    bytes: () =>
      placesWith({
        type: 2,
        tags: KEPT_PLACE_TAGS,
        geometry: line([
          [
            [1500, 1500],
            [1700, 1700],
          ],
        ]),
      }),
  },
  {
    name: 'a multipoint',
    bytes: () =>
      placesWith({
        type: 1,
        tags: KEPT_PLACE_TAGS,
        geometry: points([
          [1500, 1500],
          [1700, 1700],
        ]),
      }),
  },
];

/**
 * A building, then `count` places on a grid, the first `MAX_PLACES_PER_TILE`
 * of rank 10 and every one after it of rank 11, so a decoder that read past
 * the bound shows it in the ranks it hands back.
 */
export function placesTileOf(count: number): Uint8Array {
  const features: FeatureSpec[] = [];
  for (let k = 0; k < count; k++) {
    features.push(
      placeAt(
        {
          kind: 'locality',
          kind_detail: 'town',
          population_rank: k < MAX_PLACES_PER_TILE ? 10 : 11,
        },
        [100 + (k % 60) * 60, 100 + Math.floor(k / 60) * 60],
      ),
    );
  }
  return encodeTile([
    EARTH,
    {
      name: 'buildings',
      features: [{ type: 3, tags: { kind: 'building' }, geometry: square }],
    },
    { name: 'places', features },
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
    name: 'a place point far outside the tile',
    bytes: () =>
      encodeTile([
        EARTH,
        {
          name: 'places',
          features: [
            {
              type: 1,
              tags: KEPT_PLACE_TAGS,
              geometry: [command(1, 1), zigzag(3 * 4096), zigzag(100)],
            },
          ],
        },
      ]),
    refusal: { reason: 'malformed', layer: 'places' },
  },
  {
    name: 'a place point with a LineTo after it',
    bytes: () =>
      encodeTile([
        EARTH,
        {
          name: 'places',
          features: [
            {
              type: 1,
              tags: KEPT_PLACE_TAGS,
              geometry: [command(1, 1), zigzag(100), zigzag(100), command(2, 1), 2, 2],
            },
          ],
        },
      ]),
    refusal: { reason: 'malformed', layer: 'places' },
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

/**
 * One hostile value under one building field's key (#1789), and what the
 * decoder must make of it: `null`, or the value its rule clamps it to.
 */
export interface BuildingFieldCase {
  /** Names the field and the value's shape; never a 64 KiB value itself. */
  readonly name: string;
  readonly field: BuildingFieldName;
  readonly value: TagValue;
  readonly expected: string | number | null;
}

/** 64 KiB of one letter: a value no whitelist entry or number is. */
const LONG_STRING = 'w'.repeat(64 * 1024);
const MARKUP = '<img src=x onerror="alert(1)">';
const URL_SHAPED = 'https://example.invalid/building.png?colour=red';

/** What every field gets: values of no field's shape, all `null`. */
function commonCases(field: BuildingFieldName): BuildingFieldCase[] {
  return [
    { name: `${field}: a 64 KiB string`, field, value: LONG_STRING, expected: null },
    { name: `${field}: a value shaped like markup`, field, value: MARKUP, expected: null },
    { name: `${field}: a value shaped like a URL`, field, value: URL_SHAPED, expected: null },
    { name: `${field}: an empty string`, field, value: '', expected: null },
    { name: `${field}: a bool`, field, value: true, expected: null },
  ];
}

/** Each field's own cases: outside its whitelist or range, and the wrong type. */
function fieldCases(field: BuildingFieldName): BuildingFieldCase[] {
  const rule = BUILDING_FIELD_RULES[field];
  const at = (label: string, value: TagValue, expected: string | number | null) => ({
    name: `${field}: ${label}`,
    field,
    value,
    expected,
  });
  switch (rule.kind) {
    case 'enum': {
      const first = rule.values[0] as string;
      return [
        at('a value outside the whitelist', 'zz_not_listed', null),
        at('a whitelisted word in capitals (no case folding)', first.toUpperCase(), null),
        at('a whitelisted word with a space after it', `${first} `, null),
        at('a number where a string is expected', 3, null),
        at('a fraction where a string is expected', 2.5, null),
      ];
    }
    case 'clamped':
      return [
        at('below its range, clamped to the least', rule.min - 3, rule.min),
        at('far above its range, clamped to the most', 1e9, rule.max),
        at('a fraction, rounded down', rule.min + 1.7, rule.min + 1),
        at('a number as a string (the reverse: never parsed)', String(rule.min + 1), null),
        at('a negative fraction far below', -1e12 - 0.5, rule.min),
      ];
    case 'index':
      return [
        at('an index one past the palette', rule.size, null),
        at('an index far outside the palette', 255, null),
        at('a negative index', -1, null),
        at('a fraction', 2.5, null),
        at('a colour as a string where an index is expected', '#ff0000', null),
        at('a colour word', 'red', null),
      ];
    case 'direction':
      return [
        at('400, wrapped', 400, 45),
        at('-15, wrapped', -15, 345),
        at('a compass word (never parsed)', 'NNE', null),
        at('a number as a string (never parsed)', '90', null),
        at('7, rounded to the step below', 7, 0),
        at('8, rounded to the step above', 8, 15),
        at('360, a whole turn', 360, 0),
        at('1e15, wrapped in whole steps', 1e15, 285),
      ];
  }
}

/**
 * The values #1789's criteria name for one key in particular. `start_year`'s
 * dates are strings: a string where a number belongs is `null` **on purpose**
 * (`schema.ts` §`BuildingFieldRule`), so `"2999"` is refused, not clamped —
 * the decoder never parses a tile's string. The same year as a number is
 * clamped to {@link MAX_START_YEAR}, as the revision of 2026-11-01 asks.
 */
const NAMED_CASES: readonly BuildingFieldCase[] = [
  { name: 'levels: -3', field: 'levels', value: -3, expected: 1 },
  { name: 'levels: 0', field: 'levels', value: 0, expected: 1 },
  { name: 'levels: 1e9', field: 'levels', value: 1e9, expected: 100 },
  { name: 'levels: "two"', field: 'levels', value: 'two', expected: null },
  { name: 'levels: "2;3"', field: 'levels', value: '2;3', expected: null },
  { name: 'roofLevels: 9', field: 'roofLevels', value: 9, expected: 5 },
  { name: 'roofDirectionDegrees: 400', field: 'roofDirectionDegrees', value: 400, expected: 45 },
  { name: 'roofDirectionDegrees: -15', field: 'roofDirectionDegrees', value: -15, expected: 345 },
  {
    name: 'roofDirectionDegrees: "NNE"',
    field: 'roofDirectionDegrees',
    value: 'NNE',
    expected: null,
  },
  ...['c. 1890', '1890s', '~1890', '2999', '0', ''].map((value) => ({
    name: `startYear: "${value}" (a string: refused, never parsed)`,
    field: 'startYear' as const,
    value,
    expected: null,
  })),
  { name: 'startYear: 2999, clamped', field: 'startYear', value: 2999, expected: MAX_START_YEAR },
  { name: 'startYear: 0, clamped', field: 'startYear', value: 0, expected: MIN_START_YEAR },
  { name: 'startYear: 1066, clamped', field: 'startYear', value: 1066, expected: MIN_START_YEAR },
  { name: 'startYear: 1890, kept', field: 'startYear', value: 1890, expected: 1890 },
  { name: 'wallColour: 20, outside the palette', field: 'wallColour', value: 20, expected: null },
  { name: 'roofColour: 20, outside the palette', field: 'roofColour', value: 20, expected: null },
  { name: 'wallColour: 0, kept', field: 'wallColour', value: 0, expected: 0 },
  { name: 'roofColour: 19, kept', field: 'roofColour', value: 19, expected: 19 },
];

/** Every hostile building-field case: each field's own, the ones every field gets, and the named. */
export const HOSTILE_BUILDING_FIELD_CASES: readonly BuildingFieldCase[] = [
  ...BUILDING_FIELD_NAMES.flatMap((field) => [...fieldCases(field), ...commonCases(field)]),
  ...NAMED_CASES,
];

/** The land use, the footway and the control footprint every case's tile carries. */
function buildingFieldTileWith(hostile: FeatureSpec | undefined): Uint8Array {
  return encodeTile([
    EARTH,
    {
      name: 'landuse',
      features: [
        {
          type: 3,
          tags: { kind: 'residential' },
          geometry: polygon([outerRing(rectangle(600, 600, 3000, 3000))]),
        },
      ],
    },
    {
      name: 'buildings',
      features: [
        {
          type: 3,
          tags: { kind: 'building', height: 9, ...BUILDING_FIELDS_SET },
          geometry: polygon([outerRing(rectangle(800, 800, 1000, 1000))]),
        },
        ...(hostile === undefined ? [] : [hostile]),
        {
          type: 3,
          tags: { kind: 'building', height: 6 },
          geometry: polygon([outerRing(rectangle(2000, 800, 2200, 1000))]),
        },
      ],
    },
    {
      name: 'roads',
      features: [
        {
          type: 2,
          tags: { kind: 'path', kind_detail: 'sidewalk' },
          geometry: line([SIDEWALK_LINE]),
        },
      ],
    },
  ]);
}

/**
 * The tile a case is decoded from: a control footprint with every field set,
 * the case's footprint carrying only the hostile value under its key, a plain
 * footprint, a land-use polygon and a footway. The case's footprint is the
 * second building.
 */
export function buildingFieldCaseTile(fieldCase: BuildingFieldCase): Uint8Array {
  return buildingFieldTileWith({
    type: 3,
    tags: { kind: 'building', [BUILDING_FIELD_RULES[fieldCase.field].key]: fieldCase.value },
    geometry: polygon([outerRing(rectangle(1400, 800, 1600, 1000))]),
  });
}

/** {@link buildingFieldCaseTile}'s tile without the case's footprint: what the rest must decode to. */
export function buildingFieldControlTile(): Uint8Array {
  return buildingFieldTileWith(undefined);
}

function indexOfSequence(haystack: Uint8Array, needle: Uint8Array): number {
  outer: for (let i = 0; i + needle.length <= haystack.length; i++) {
    for (let j = 0; j < needle.length; j++) if (haystack[i + j] !== needle[j]) continue outer;
    return i;
  }
  throw new RangeError('indexOfSequence: not found');
}
