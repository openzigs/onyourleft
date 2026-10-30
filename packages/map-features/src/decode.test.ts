// SPDX-License-Identifier: Apache-2.0

import { cpus } from 'node:os';

import { describe, expect, it } from 'vitest';

import { decodeTile } from './decode';
import {
  buildingPartTile,
  DROPPED_PLACE_FIXTURES,
  FIXTURE_EXTENT,
  FIXTURE_FRAME,
  FIXTURE_TILE,
  footprintTile,
  footwayTile,
  HOSTILE_FIXTURES,
  KEPT_PLACE,
  LIMIT_NAMES,
  lakeTile,
  millionLineToTile,
  NAMED_FIXTURES,
  PLACE_FIXTURE_POINTS,
  PLACE_SENTINEL,
  placesTile,
  placesTileOf,
  POISON,
  RESIDENTIAL_FOOTPRINTS,
  residentialBlockTile,
  SIDEWALK_LINE,
  sidewalkTile,
  STREET_FIXTURE_ROADS,
  streetsTile,
  tileAtLimit,
  WOOD_HOLE,
  WOOD_OUTER,
  woodWithHoleTile,
} from './testing';
import {
  DEFAULT_DECODE_LIMITS,
  MAX_FEATURES_PER_LAYER,
  MAX_PLACES_PER_TILE,
  MAX_VERTICES_PER_TILE,
} from './limits';
import type { DecodedTile, DecodeRefusal } from './types';

function decoded(bytes: Uint8Array): DecodedTile {
  const result = decodeTile(bytes, FIXTURE_TILE, FIXTURE_FRAME);
  if ('reason' in result) throw new Error(`refused: ${result.reason}`);
  return result;
}

/**
 * The game's projection for a tile pixel, written out independently of
 * `projection.ts`: Web Mercator to degrees, then `terrain.ts`
 * §localGroundPosition (x WEST, z north).
 */
function expectedMetres(px: number, py: number): { x: number; z: number } {
  const n = 2 ** 15;
  const longitude = ((FIXTURE_TILE.x + px / FIXTURE_EXTENT) / n) * 360 - 180;
  const latitude =
    (Math.atan(Math.sinh(Math.PI * (1 - (2 * (FIXTURE_TILE.y + py / FIXTURE_EXTENT)) / n))) * 180) /
    Math.PI;
  const k = 111_320 * Math.cos((FIXTURE_FRAME.latitude * Math.PI) / 180);
  return {
    x: (FIXTURE_FRAME.longitude - longitude) * k,
    z: (latitude - FIXTURE_FRAME.latitude) * 111_320,
  };
}

function vertices(ring: Float32Array): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < ring.length; i += 2) out.push([ring[i] as number, ring[i + 1] as number]);
  return out;
}

/** Each expected pixel vertex appears in the ring, to 1 cm, in some rotation and direction. */
function expectRingAt(ring: Float32Array, pixels: readonly (readonly [number, number])[]): void {
  const got = vertices(ring);
  expect(got).toHaveLength(pixels.length);
  for (const [px, py] of pixels) {
    const want = expectedMetres(px, py);
    const match = got.some(([x, z]) => Math.abs(x - want.x) < 0.01 && Math.abs(z - want.z) < 0.01);
    expect(match, `vertex at pixel ${String(px)},${String(py)}`).toBe(true);
  }
}

describe('decodeTile on the named fixtures', () => {
  it('residential block: the land use and three footprints, at their heights', () => {
    const tile = decoded(residentialBlockTile());
    expect(tile.landUse.map((f) => [f.layer, f.kind])).toEqual([['landuse', 'residential']]);
    expect(tile.buildings).toHaveLength(3);
    RESIDENTIAL_FOOTPRINTS.forEach(([x0, y0, x1, y1, height], i) => {
      const building = tile.buildings[i];
      expect(building?.kind).toBe('building');
      expect(building?.heightMetres).toBe(height);
      expect(building?.minHeightMetres).toBeNull();
      expect(building?.rings).toHaveLength(1);
      expectRingAt(building?.rings[0] as Float32Array, [
        [x0, y0],
        [x1, y0],
        [x1, y1],
        [x0, y1],
      ]);
    });
    expect(tile.paths).toEqual([]);
  });

  it('a missing height is null, never 0', () => {
    const tile = decoded(residentialBlockTile());
    expect(tile.buildings[2]?.heightMetres).toBeNull();
  });

  it('wood with a hole: one polygon of two rings, the hole kept as a hole', () => {
    const tile = decoded(woodWithHoleTile());
    expect(tile.landUse).toHaveLength(1);
    const wood = tile.landUse[0];
    expect(wood?.kind).toBe('wood');
    expect(wood?.rings).toHaveLength(2);
    expectRingAt(wood?.rings[0] as Float32Array, WOOD_OUTER);
    expectRingAt(wood?.rings[1] as Float32Array, WOOD_HOLE);
  });

  it('lake: the water polygon only; its stream and label point are not kept', () => {
    const tile = decoded(lakeTile());
    expect(tile.landUse.map((f) => [f.layer, f.kind, f.rings.length])).toEqual([
      ['water', 'lake', 1],
    ]);
    expect(tile.paths).toEqual([]);
  });

  it('sidewalk: the footway is kept along its line; the street beside it is a street, not a path', () => {
    const tile = decoded(sidewalkTile());
    expect(tile.paths).toHaveLength(1);
    // #1565: the residential street is kept, in `streets`, never in `paths`.
    expect(tile.streets.map((street) => [street.kind, street.kindDetail])).toEqual([
      ['minor_road', 'residential'],
    ]);
    const path = tile.paths[0];
    expect(path?.kind).toBe('path');
    expect(path?.kindDetail).toBe('sidewalk');
    const got = vertices(path?.line as Float32Array);
    expect(got).toHaveLength(SIDEWALK_LINE.length);
    SIDEWALK_LINE.forEach(([px, py], i) => {
      const want = expectedMetres(px, py);
      expect(Math.abs((got[i] as [number, number])[0] - want.x)).toBeLessThan(0.01);
      expect(Math.abs((got[i] as [number, number])[1] - want.z)).toBeLessThan(0.01);
    });
  });

  it('streets — #1565: highway, major and minor roads, and `other` where it is a street; never rail, ferry or a footway', () => {
    const tile = decoded(streetsTile());
    const sinkOf = (kind: string, detail: string): string | null => {
      if (tile.streets.some((f) => f.kind === kind && f.kindDetail === detail)) return 'streets';
      if (tile.paths.some((f) => f.kind === kind && f.kindDetail === detail)) return 'paths';
      return null;
    };
    for (const road of STREET_FIXTURE_ROADS) {
      expect([road.kind, road.kindDetail, sinkOf(road.kind, road.kindDetail ?? '')]).toEqual([
        road.kind,
        road.kindDetail,
        road.sink,
      ]);
    }
    expect(tile.streets).toHaveLength(
      STREET_FIXTURE_ROADS.filter((r) => r.sink === 'streets').length,
    );
    // Grade separation (#1565): `is_bridge` and `is_tunnel` as booleans; absent or `false` is at grade.
    for (const road of STREET_FIXTURE_ROADS.filter((r) => r.sink === 'streets')) {
      const street = tile.streets.find(
        (f) => f.kind === road.kind && f.kindDetail === (road.kindDetail ?? ''),
      );
      expect([road.kind, road.kindDetail, street?.grade]).toEqual([
        road.kind,
        road.kindDetail,
        road.grade ?? 'ground',
      ]);
    }
    // Along its line, in the corridor frame: the minor road's two ends.
    const minor = tile.streets.find((f) => f.kind === 'minor_road');
    const got = vertices(minor?.line as Float32Array);
    const want = [expectedMetres(100, 1400), expectedMetres(4000, 1400)];
    want.forEach((point, i) => {
      expect(Math.abs((got[i] as [number, number])[0] - point.x)).toBeLessThan(0.01);
      expect(Math.abs((got[i] as [number, number])[1] - point.z)).toBeLessThan(0.01);
    });
  });

  it('building_part: its height and its min_height; the address point is dropped', () => {
    const tile = decoded(buildingPartTile());
    expect(tile.buildings.map((b) => [b.kind, b.heightMetres, b.minHeightMetres])).toEqual([
      ['building_part', 30, 12],
    ]);
  });

  it('the projection is the game’s: x is WEST, so a point east of the origin is negative x', () => {
    // The sidewalk runs west to east across the tile, so x must fall along it.
    const line = decoded(sidewalkTile()).paths[0]?.line as Float32Array;
    expect(line[0] as number).toBeGreaterThan(line[line.length - 2] as number);
    // And a footprint south of the origin has negative z.
    const footprint = decoded(residentialBlockTile()).buildings[0]?.rings[0] as Float32Array;
    expect(footprint[1] as number).toBeLessThan(0);
  });
});

describe('decodeTile returns only the fields P-4 names', () => {
  /** Every key and every primitive value anywhere in the result. */
  function walk(value: unknown, keys: Set<string>, values: unknown[]): void {
    if (value instanceof Float32Array) {
      values.push(...value);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) walk(item, keys, values);
      return;
    }
    if (value !== null && typeof value === 'object') {
      for (const [key, inner] of Object.entries(value)) {
        keys.add(key);
        walk(inner, keys, values);
      }
      return;
    }
    values.push(value);
  }

  for (const [name, build] of Object.entries(NAMED_FIXTURES)) {
    it(`${name}: no name, pmap:*, address or id survives, as a key or as a value`, () => {
      const keys = new Set<string>();
      const values: unknown[] = [];
      walk(decoded(build()), keys, values);
      const allowed = [
        'tile',
        'z',
        'x',
        'y',
        'landUse',
        'buildings',
        'paths',
        'streets',
        'layer',
        'kind',
        'rings',
        'heightMetres',
        'minHeightMetres',
        'kindDetail',
        'grade',
        'line',
        'places',
        'populationRank',
      ];
      for (const key of keys) expect(allowed).toContain(key);
      const poisonValues: unknown[] = Object.values(POISON);
      for (const value of values) {
        expect(poisonValues).not.toContain(value);
        if (typeof value === 'number') {
          // Ids are POISON.id and the next few; nothing near them is a coordinate.
          expect(Math.abs(value - POISON.id)).toBeGreaterThan(1000);
        }
      }
      const text = JSON.stringify(decoded(build()));
      expect(text).not.toContain('Fixture Lane');
      expect(text).not.toContain(POISON.pmapKind);
    });
  }
});

describe('decodeTile reads places: the kind and the rank, never the name (#1632, ADR 0055)', () => {
  it('keeps every kind and detail ADR 0055 D-2 lists, with its rank, at its point', () => {
    const tile = decoded(placesTile());
    expect(tile.places.map((p) => [p.kind, p.kindDetail, p.populationRank])).toStrictEqual(
      PLACE_FIXTURE_POINTS.map((p) => [p.kind, p.kindDetail, p.populationRank]),
    );
    PLACE_FIXTURE_POINTS.forEach((place, index) => {
      const want = expectedMetres(place.at[0], place.at[1]);
      const got = tile.places[index];
      expect(Math.abs((got?.x ?? Number.NaN) - want.x)).toBeLessThan(0.01);
      expect(Math.abs((got?.z ?? Number.NaN) - want.z)).toBeLessThan(0.01);
    });
  });

  it('carries no name, wikidata or population: the sentinel is nowhere in the result', () => {
    const tile = decoded(placesTile());
    // Not vacuous: the sentinel's places were decoded.
    expect(tile.places).toHaveLength(PLACE_FIXTURE_POINTS.length);
    const text = JSON.stringify(tile);
    expect(text).not.toContain(PLACE_SENTINEL);
    expect(text).not.toContain('271828');
    expect(text).not.toContain('yes');
    expect(Object.keys(tile.places[0] ?? {}).sort()).toStrictEqual([
      'kind',
      'kindDetail',
      'populationRank',
      'x',
      'z',
    ]);
  });

  it('a tile with no places layer has none, and #1544’s residential block’s detail-less place is dropped', () => {
    expect(decoded(sidewalkTile()).places).toStrictEqual([]);
    expect(decoded(residentialBlockTile()).places).toStrictEqual([]);
  });

  for (const fixture of DROPPED_PLACE_FIXTURES) {
    it(`${fixture.name}: dropped without throwing; the tile and the other place stand`, () => {
      const result = decodeTile(fixture.bytes(), FIXTURE_TILE, FIXTURE_FRAME);
      if ('reason' in result) throw new Error(`refused: ${result.reason}`);
      expect(result.buildings).toHaveLength(1);
      expect(result.places.map((p) => [p.kind, p.kindDetail, p.populationRank])).toStrictEqual([
        [KEPT_PLACE.kind, KEPT_PLACE.kindDetail, KEPT_PLACE.populationRank],
      ]);
    });
  }

  it(`stops at ${String(MAX_PLACES_PER_TILE)} places a tile, and the tile is not refused`, () => {
    const over = decoded(placesTileOf(MAX_PLACES_PER_TILE + 5));
    expect(over.places).toHaveLength(MAX_PLACES_PER_TILE);
    // The kept ones are the first: every place past the bound has rank 11.
    expect(over.places.every((p) => p.populationRank === 10)).toBe(true);
    expect(over.buildings).toHaveLength(1);
    expect(decoded(placesTileOf(MAX_PLACES_PER_TILE)).places).toHaveLength(MAX_PLACES_PER_TILE);
  });
});

describe('decodeTile refuses hostile input, and never throws', () => {
  for (const fixture of HOSTILE_FIXTURES) {
    it(`${fixture.name}: refused as ${fixture.refusal.reason}, inside 50 ms`, () => {
      const bytes = fixture.bytes();
      decodeTile(bytes, FIXTURE_TILE, FIXTURE_FRAME); // warm the JIT, as a long-lived page would be
      const started = performance.now();
      const result = decodeTile(bytes, FIXTURE_TILE, FIXTURE_FRAME);
      const elapsed = performance.now() - started;
      expect(result).toEqual(fixture.refusal);
      expect(elapsed).toBeLessThan(50);
    });
  }

  it('control: with the vertex limits removed, the 10^6-LineTo feature is decoded whole, far past the memory the limit allows', () => {
    const unlimited = {
      ...DEFAULT_DECODE_LIMITS,
      maxVerticesPerFeature: Number.POSITIVE_INFINITY,
      maxVerticesPerTile: Number.POSITIVE_INFINITY,
    };
    const started = performance.now();
    const result = decodeTile(millionLineToTile(), FIXTURE_TILE, FIXTURE_FRAME, unlimited);
    const elapsed = performance.now() - started;
    if ('reason' in result) throw new Error(`refused: ${result.reason}`);
    const bytes = result.paths.reduce((sum, path) => sum + path.line.byteLength, 0);
    // The whole tile's output under the limit is at most 8 bytes a vertex.
    const budget = MAX_VERTICES_PER_TILE * 8;
    expect(elapsed > 50 || bytes > budget).toBe(true);
    expect(bytes).toBeGreaterThan(budget);
  });

  it('a seeded storm of corrupted fixtures: every one decodes or is refused, none throws', () => {
    let seed = 0x1544;
    const random = (): number => {
      seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31;
      return seed / 2 ** 31;
    };
    const sources = Object.values(NAMED_FIXTURES).map((build) => build());
    let refused = 0;
    for (let i = 0; i < 3000; i++) {
      const source = sources[i % sources.length] as Uint8Array;
      const bytes = source.slice(0, Math.max(1, Math.floor(source.length * (0.5 + random() / 2))));
      const flips = 1 + Math.floor(random() * 4);
      for (let f = 0; f < flips; f++)
        bytes[Math.floor(random() * bytes.length)] = Math.floor(random() * 256);
      let result: DecodedTile | DecodeRefusal | undefined;
      expect(() => {
        result = decodeTile(bytes, FIXTURE_TILE, FIXTURE_FRAME);
      }).not.toThrow();
      if (result !== undefined && 'reason' in result) refused++;
    }
    // Most corruptions break the framing; the storm is not vacuous.
    expect(refused).toBeGreaterThan(1500);
  });
});

describe('decodeTile at each limit', () => {
  for (const limit of LIMIT_NAMES) {
    it(`a tile exactly at the ${limit} limit decodes`, () => {
      const result = decodeTile(tileAtLimit(limit), FIXTURE_TILE, FIXTURE_FRAME);
      expect('reason' in result ? result : 'decoded').toBe('decoded');
    });
  }

  /**
   * #1544's performance budget is 20 ms for the densest fixture in Node on CI,
   * **stated in the pull request as measured**, and this case prints that
   * figure with the CPU it ran on. It does not assert it in milliseconds: the
   * nightly job runs this file again under V8's coverage, which made the same
   * decode take 33–38 ms on a Mac against 4–11 ms without it, and a bound
   * that passes only uninstrumented is the timeout-tuned-too-close that
   * docs/agents/ci.md §4c warns about. What it asserts instead is the shape
   * `racing-line.test.ts` asserts since #734: the cost is LINEAR in the tile
   * — the densest fixture against one a tenth its size, in the same process
   * under the same instrumentation — so the runner divides out. Linear is 10;
   * a decoder gone quadratic would read about 100. The bound is 25.
   */
  const best = (bytes: Uint8Array): number => {
    decodeTile(bytes, FIXTURE_TILE, FIXTURE_FRAME);
    let fastest = Number.POSITIVE_INFINITY;
    for (let i = 0; i < 5; i++) {
      const started = performance.now();
      decodeTile(bytes, FIXTURE_TILE, FIXTURE_FRAME);
      fastest = Math.min(fastest, performance.now() - started);
    }
    return fastest;
  };
  for (const [limit, build, full] of [
    ['featuresPerLayer', footprintTile, MAX_FEATURES_PER_LAYER],
    ['verticesPerTile', footwayTile, MAX_VERTICES_PER_TILE],
  ] as const) {
    it(`the ${limit} fixture, one of the two densest, decodes at a cost linear in its size`, () => {
      const dense = best(build(full));
      const tenth = best(build(full / 10));
      console.info(
        `map-features: ${limit} at its limit decoded in ${dense.toFixed(2)} ms (best of 5); ` +
          `a tenth of it in ${tenth.toFixed(2)} ms; ${cpus()[0]?.model ?? 'unknown CPU'}`,
      );
      expect(dense / tenth).toBeLessThan(25);
    });
  }
});

describe('decodeTile on a caller error', () => {
  it('throws on a tile id that is not z15, naming no coordinate', () => {
    expect(() =>
      decodeTile(residentialBlockTile(), { z: 15, x: -1, y: 12 }, FIXTURE_FRAME),
    ).toThrow(/^decodeTile: the tile id is not a z15 tile$/);
  });
});
