// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  EARTH,
  FIXTURE_TILE,
  encodeTile,
  holeRing,
  line,
  outerRing,
  polygon,
  rectangle,
  type FeatureSpec,
  type LayerSpec,
  type TagValue,
} from '@onyourleft/map-features/testing';
import { describe, expect, it } from 'vitest';
import { compareTile, emptySummary, strictPasses } from './compare';
import { readTile } from './mvt';

const YEAR = 2026;
const Z14 = { z: 14, x: FIXTURE_TILE.x >> 1, y: FIXTURE_TILE.y >> 1 };

function building(x: number, tags: Readonly<Record<string, TagValue>> = {}): FeatureSpec {
  return {
    id: 100 + x,
    type: 3,
    tags: { kind: 'building', sort_rank: 400, height: 9, ...tags },
    geometry: polygon([outerRing(rectangle(x, 100, x + 200, 300))]),
  };
}

const ROADS: LayerSpec = {
  name: 'roads',
  features: [
    {
      type: 2,
      tags: { kind: 'minor_road', kind_detail: 'residential' },
      geometry: line([
        [
          [0, 2000],
          [4096, 2000],
        ],
      ]),
    },
  ],
};

function tile(buildings: readonly FeatureSpec[], roads: LayerSpec = ROADS): Uint8Array {
  return encodeTile([EARTH, { name: 'buildings', features: buildings }, roads]);
}

const FIELDS = {
  building_type: 'church',
  levels: 2,
  roof_shape: 'gabled',
  roof_direction: 45,
  wall_colour: 0,
  start_year: 1887,
  landmark: 'worship',
} as const;

describe('compareTile on a strict pair (the same extract through upstream’s profile)', () => {
  it('finds no difference when only the z15 buildings carry the fields, and counts each field', () => {
    const summary = emptySummary();
    const ours = tile([building(100, FIELDS), building(600)]);
    const theirs = tile([building(100), building(600)]);

    compareTile(summary, FIXTURE_TILE, ours, theirs, YEAR);

    expect(strictPasses(summary)).toBe(true);
    expect(summary.layers.get('buildings')?.differingTiles).toBe(0);
    expect(summary.layers.get('buildings')?.keysOurs.has('building_type')).toBe(true);
    expect(summary.layers.get('buildings')?.keysTheirs.has('building_type')).toBe(false);
    expect(summary.z15Buildings).toBe(2);
    expect(Object.fromEntries(summary.fieldFill)).toEqual({
      building_type: 1,
      levels: 1,
      roof_shape: 1,
      roof_direction: 1,
      wall_colour: 1,
      start_year: 1,
      landmark: 1,
    });
    expect(summary.z15RawBytesOurs).toBeGreaterThan(summary.z15RawBytesTheirs);
  });

  it('reads both through the client’s decoder, which sees the same buildings and heights', () => {
    const summary = emptySummary();
    compareTile(summary, FIXTURE_TILE, tile([building(100, FIELDS)]), tile([building(100)]), YEAR);

    expect(summary.decoder).toEqual({
      tiles: 1,
      refusedOurs: 0,
      refusedTheirs: 0,
      buildingsOurs: 1,
      buildingsTheirs: 1,
      disagreeingTiles: 0,
    });
  });

  it('counts a height the two decode differently as a disagreement', () => {
    const summary = emptySummary();
    compareTile(
      summary,
      FIXTURE_TILE,
      tile([building(100, { height: 12 })]),
      tile([building(100)]),
      YEAR,
    );

    expect(summary.decoder.disagreeingTiles).toBe(1);
    expect(strictPasses(summary)).toBe(false);
  });

  it('fails a strict pair on a decoder disagreement alone', () => {
    const summary = emptySummary();
    expect(strictPasses(summary)).toBe(true);
    summary.decoder.disagreeingTiles = 1;
    expect(strictPasses(summary)).toBe(false);
  });

  it('fails a strict pair when the decoder refuses more tiles of one archive than the other', () => {
    const summary = emptySummary();
    summary.decoder.refusedOurs = 1;
    expect(strictPasses(summary)).toBe(false);

    summary.decoder.refusedOurs = 0;
    summary.decoder.refusedTheirs = 1;
    expect(strictPasses(summary)).toBe(false);

    // The same refusals on both sides are upstream's own, not this profile's.
    summary.decoder.refusedOurs = 1;
    expect(strictPasses(summary)).toBe(true);
  });

  it('counts a tile the client’s decoder refuses, for the archive it came from', () => {
    // One outer ring and 256 holes is one ring over the decoder's per-polygon limit, so it
    // refuses the tile.
    const holes = Array.from({ length: 256 }, (_, i) =>
      holeRing(
        rectangle(
          10 + (i % 16) * 20,
          10 + Math.floor(i / 16) * 20,
          20 + (i % 16) * 20,
          20 + Math.floor(i / 16) * 20,
        ),
      ),
    );
    const rings = [outerRing(rectangle(0, 0, 400, 400)), ...holes];
    const refused = tile([{ ...building(100), geometry: polygon(rings) }]);
    const accepted = tile([building(100)]);

    const oursRefused = emptySummary();
    compareTile(oursRefused, FIXTURE_TILE, refused, accepted, YEAR);
    expect(oursRefused.decoder).toMatchObject({ tiles: 1, refusedOurs: 1, refusedTheirs: 0 });

    const theirsRefused = emptySummary();
    compareTile(theirsRefused, FIXTURE_TILE, accepted, refused, YEAR);
    expect(theirsRefused.decoder).toMatchObject({ tiles: 1, refusedOurs: 0, refusedTheirs: 1 });
  });

  it('counts a changed road as a differing tile in that layer, not in buildings', () => {
    const summary = emptySummary();
    const moved: LayerSpec = {
      name: 'roads',
      features: [
        {
          type: 2,
          tags: { kind: 'minor_road', kind_detail: 'residential' },
          geometry: line([
            [
              [0, 2001],
              [4096, 2000],
            ],
          ]),
        },
      ],
    };

    compareTile(summary, FIXTURE_TILE, tile([building(100)], moved), tile([building(100)]), YEAR);

    expect(summary.layers.get('roads')?.differingTiles).toBe(1);
    expect(summary.layers.get('buildings')?.differingTiles).toBe(0);
    expect(strictPasses(summary)).toBe(false);
  });

  it('counts a layer one archive’s tile lacks as a differing tile in that layer', () => {
    const summary = emptySummary();
    const noRoads = encodeTile([EARTH, { name: 'buildings', features: [building(100)] }]);

    compareTile(summary, FIXTURE_TILE, noRoads, tile([building(100)]), YEAR);

    expect(summary.layers.get('roads')).toMatchObject({ tiles: 1, differingTiles: 1 });
    expect(summary.layers.get('buildings')?.differingTiles).toBe(0);
    expect(strictPasses(summary)).toBe(false);

    const theirsLack = emptySummary();
    compareTile(theirsLack, FIXTURE_TILE, tile([building(100)]), noRoads, YEAR);
    expect(theirsLack.layers.get('roads')?.differingTiles).toBe(1);
  });

  it('counts a layer encoded at another extent as differing, though its features match', () => {
    const summary = emptySummary();

    compareTile(
      summary,
      FIXTURE_TILE,
      tile([building(100)], { ...ROADS, extent: 8192 }),
      tile([building(100)]),
      YEAR,
    );

    expect(summary.layers.get('roads')?.differingTiles).toBe(1);
    expect(strictPasses(summary)).toBe(false);
  });

  it('counts a building whose feature id differs, though the decoder sees the same building', () => {
    const summary = emptySummary();

    compareTile(
      summary,
      FIXTURE_TILE,
      tile([{ ...building(100, FIELDS), id: 999 }]),
      tile([building(100)]),
      YEAR,
    );

    expect(summary.layers.get('buildings')?.differingTiles).toBe(1);
    expect(summary.decoder.disagreeingTiles).toBe(0);
    expect(strictPasses(summary)).toBe(false);
  });

  it('does not set aside a building field below z15: there, it is a difference and a violation', () => {
    const summary = emptySummary();
    compareTile(summary, Z14, tile([building(100, { levels: 2 })]), tile([building(100)]), YEAR);

    expect(summary.layers.get('buildings')?.differingTiles).toBe(1);
    expect(summary.fieldViolations).toBe(1);
    expect(summary.decoder.tiles).toBe(0);
    expect(strictPasses(summary)).toBe(false);
  });

  it('counts a field outside the buildings layer as a violation', () => {
    const summary = emptySummary();
    const roads: LayerSpec = {
      name: 'roads',
      features: [{ ...ROADS.features[0]!, tags: { kind: 'minor_road', levels: 3 } }],
    };
    compareTile(summary, FIXTURE_TILE, tile([], roads), tile([], roads), YEAR);

    expect(summary.fieldViolations).toBe(1);
  });

  it.each<[string, TagValue]>([
    ['building_type', 'yes'],
    ['building_type', 'Somebody’s House'],
    ['levels', 0],
    ['levels', 101],
    ['levels', 2.5],
    ['roof_levels', 6],
    ['roof_shape', 'dome'],
    ['roof_direction', 50],
    ['roof_direction', 360],
    ['wall_colour', 20],
    ['roof_colour', -1],
    ['wall_material', 'timber_framing'],
    ['roof_material', 'brick'],
    ['start_year', 1599],
    ['start_year', YEAR + 1],
    ['landmark', 'church'],
    ['levels', '2'],
    ['building_type', 3],
  ])('refuses %s = %j', (key, value) => {
    const summary = emptySummary();
    compareTile(
      summary,
      FIXTURE_TILE,
      tile([building(100, { [key]: value })]),
      tile([building(100)]),
      YEAR,
    );

    expect(summary.fieldViolations).toBe(1);
    expect(summary.fieldFill.size).toBe(0);
    expect(strictPasses(summary)).toBe(false);
  });

  it('counts a tile only one archive has', () => {
    const summary = emptySummary();
    compareTile(summary, FIXTURE_TILE, tile([building(100)]), null, YEAR);
    compareTile(summary, Z14, null, tile([building(100)]), YEAR);
    compareTile(summary, Z14, null, null, YEAR);

    expect(summary.tiles).toBe(2);
    expect(summary.tilesOnlyOurs).toBe(1);
    expect(summary.tilesOnlyTheirs).toBe(1);
    expect(strictPasses(summary)).toBe(false);
  });

  it('counts a malformed tile rather than throwing', () => {
    const summary = emptySummary();
    compareTile(summary, FIXTURE_TILE, new Uint8Array([0x1a, 0x7f]), tile([building(100)]), YEAR);

    expect(summary.malformedOurs).toBe(1);
    expect(strictPasses(summary)).toBe(false);
  });
});

describe('readTile', () => {
  it('reads every layer, key, value type and the geometry bytes', () => {
    const geometry = polygon([outerRing(rectangle(1, 2, 30, 40))]);
    const bytes = encodeTile([
      {
        name: 'buildings',
        extent: 4096,
        features: [
          {
            id: 7,
            type: 3,
            tags: { kind: 'building', height: 9.5, levels: 3, below: -2, flag: true },
            geometry,
          },
        ],
      },
      { name: 'water', features: [] },
    ]);

    const layers = readTile(bytes);

    expect(layers.map((layer) => layer.name)).toEqual(['buildings', 'water']);
    const feature = layers[0]!.features[0]!;
    expect(feature.id).toBe(7);
    expect(feature.type).toBe(3);
    expect(Object.fromEntries(feature.tags)).toEqual({
      kind: 'building',
      height: 9.5,
      levels: 3,
      below: -2,
      flag: true,
    });
    expect(feature.geometry.length).toBeGreaterThan(0);
    expect(layers[0]!.extent).toBe(4096);
  });

  it('throws a RangeError on a truncated tile', () => {
    expect(() => readTile(new Uint8Array([0x1a, 0x05, 0x0a]))).toThrow(RangeError);
  });
});
