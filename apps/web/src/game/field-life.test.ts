// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The field life planner — #3286 (`field-life.ts` §`fieldLifeAt`), on fields
 * written as arithmetic: a straight road up `z` at `x = 0`, and rectangles
 * beside it. No real place; no profile — the road is the distance `|x|`, as
 * the site's own `road` is asked for it. `field-life-scene.test.ts` reads the
 * same rules back off a frame.
 */

import { describe, expect, it } from 'vitest';

import type { LandUseFeature, StreetFeature } from '@onyourleft/map-features';

import {
  FIELD_ANIMALS_MAX,
  FIELD_ANIMALS_NEAR_MAX,
  FIELD_BALES_MAX,
  FIELD_LIFE_EDGE_METRES,
  FIELD_LIFE_NEAR_METRES,
  FIELD_LIFE_REACH_METRES,
  FIELD_LIFE_ROAD_CLEAR_METRES,
  FIELD_LIFE_SPACING_METRES,
  FIELD_LIFE_STREET_CLEAR_METRES,
  NO_FIELD_LIFE,
  fieldLifeAt,
  fieldLifeLook,
  type FieldLife,
  type FieldLifeSite,
} from './field-life';
import type { LandClass } from './land-class';

/** A rectangle of `kind`, `x` from `x0` to `x1` and `z` from `z0` to `z1`. */
function rectangle(kind: string, x0: number, x1: number, z0: number, z1: number): LandUseFeature {
  return {
    layer: 'landuse',
    kind,
    rings: [Float32Array.from([x0, z0, x1, z0, x1, z1, x0, z1])],
  };
}

/** A meadow from 8 m off the road to 300 m, the first kilometre, on the `+x` side. */
const MEADOW = rectangle('meadow', 8, 300, 0, 1_000);

/** The same, arable, on the `−x` side. */
const ARABLE = rectangle('farmland', -300, -8, 0, 1_000);

/** A site of `landUse`, the mask `farmland` everywhere but where `other` says. */
function site(
  landUse: readonly LandUseFeature[],
  more: Partial<FieldLifeSite> = {},
  other: (x: number, z: number) => LandClass | undefined = () => undefined,
): FieldLifeSite {
  return {
    seed: 3_286,
    landUse,
    land: { classAt: (x, z) => other(x, z) ?? 'farmland' },
    streets: [],
    paths: [],
    road: (x) => Math.abs(x),
    ...more,
  };
}

/** Every piece asked for about the road every 50 m, each once. */
function along(on: FieldLifeSite): readonly FieldLife[] {
  const seen = new Map<string, FieldLife>();
  for (let z = 0; z <= 1_000; z += 50) {
    for (const piece of fieldLifeAt(on, 0, z, 0, z - 40).pieces) {
      seen.set(`${piece.kind},${String(piece.x)},${String(piece.z)}`, piece);
    }
  }
  return [...seen.values()];
}

const inside = (piece: FieldLife, x0: number, x1: number): boolean =>
  piece.x - FIELD_LIFE_EDGE_METRES >= x0 &&
  piece.x + FIELD_LIFE_EDGE_METRES <= x1 &&
  piece.z - FIELD_LIFE_EDGE_METRES >= 0 &&
  piece.z + FIELD_LIFE_EDGE_METRES <= 1_000;

describe('#3286 where field life stands', () => {
  const pieces = along(site([MEADOW, ARABLE]));
  const animals = pieces.filter((piece) => piece.kind !== 'bale');
  const bales = pieces.filter((piece) => piece.kind === 'bale');

  it('grazes animals well inside the meadow and lays bales well inside the farmland', () => {
    expect(animals.length).toBeGreaterThan(40);
    expect(bales.length).toBeGreaterThan(10);
    for (const animal of animals) expect(inside(animal, 8, 300)).toBe(true);
    for (const bale of bales) expect(inside(bale, -300, -8)).toBe(true);
  });

  it('stands every piece its edge distance inside narrow fields, never on the hedge between them', () => {
    // Four 30 m strips of meadow 30 m apart: a herd spreads past a strip's edge.
    const strips = [30, 90, 150, 210].map((x0) => rectangle('meadow', x0, x0 + 30, 0, 1_000));
    const grazed = along(site(strips));
    expect(grazed.length).toBeGreaterThan(10);
    for (const piece of grazed) {
      const strip = strips.findIndex((_, at) => {
        const x0 = 30 + at * 60;
        return piece.x > x0 && piece.x < x0 + 30;
      });
      expect(strip, `${String(piece.x)}`).toBeGreaterThanOrEqual(0);
      const x0 = 30 + strip * 60;
      expect(piece.x - x0).toBeGreaterThanOrEqual(FIELD_LIFE_EDGE_METRES);
      expect(x0 + 30 - piece.x).toBeGreaterThanOrEqual(FIELD_LIFE_EDGE_METRES);
    }
  });

  it('keeps every piece back from the road, the clearance and not the field doing it', () => {
    for (const piece of pieces)
      expect(Math.abs(piece.x)).toBeGreaterThanOrEqual(FIELD_LIFE_ROAD_CLEAR_METRES);
    // Non-vacuity: the fields reach 8 m from the road, and pieces stand near the line.
    expect(Math.min(...pieces.map((piece) => Math.abs(piece.x)))).toBeLessThan(
      FIELD_LIFE_ROAD_CLEAR_METRES + 5,
    );
  });

  it('spaces the pieces of a cell apart', () => {
    for (const [index, piece] of pieces.entries()) {
      for (const other of pieces.slice(index + 1)) {
        if (other.kind !== piece.kind) continue;
        expect(Math.hypot(other.x - piece.x, other.z - piece.z)).toBeGreaterThanOrEqual(
          FIELD_LIFE_SPACING_METRES - 1e-9,
        );
      }
    }
  });

  it('stands none where the mask says another class — a wood mapped over the meadow', () => {
    const wooded = along(
      site([MEADOW], {}, (x, z) => (x > 0 && z >= 200 && z <= 600 ? 'wood' : undefined)),
    );
    expect(wooded.length).toBeGreaterThan(5);
    for (const piece of wooded) expect(piece.z < 200 || piece.z > 600).toBe(true);
  });

  it('stands none on or beside a mapped street or path across the field', () => {
    // The track runs through where an animal stands with no track there.
    const open = along(site([MEADOW]));
    const through = open.find((piece) => piece.z > 100 && piece.z < 900);
    if (through === undefined) throw new Error('the open meadow has no animal');
    const track: StreetFeature = {
      kind: 'other',
      kindDetail: 'track',
      grade: 'ground',
      line: Float32Array.from([0, through.z, 300, through.z]),
    };
    for (const on of [
      site([MEADOW], { streets: [track] }),
      site([MEADOW], { paths: [{ ...track }] }),
    ]) {
      const crossed = along(on);
      expect(crossed.length).toBeGreaterThan(20);
      for (const piece of crossed) {
        expect(Math.abs(piece.z - through.z)).toBeGreaterThanOrEqual(
          FIELD_LIFE_STREET_CLEAR_METRES,
        );
      }
    }
  });

  it('grazes nothing on any other mapped kind, and lays no bale on a meadow', () => {
    for (const kind of ['residential', 'forest', 'park', 'heath', 'orchard']) {
      expect(fieldLifeAt(site([rectangle(kind, 8, 300, 0, 1_000)]), 0, 500, 0, 460)).toBe(
        NO_FIELD_LIFE,
      );
    }
    expect(fieldLifeAt(site([]), 0, 500, 0, 460)).toBe(NO_FIELD_LIFE);
    expect(along(site([MEADOW])).every((piece) => piece.kind !== 'bale')).toBe(true);
    expect(along(site([ARABLE])).every((piece) => piece.kind === 'bale')).toBe(true);
    // Grassland grazes as a meadow does.
    expect(along(site([rectangle('grassland', 8, 300, 0, 1_000)])).length).toBeGreaterThan(20);
  });
});

describe('#3286 what a frame is handed', () => {
  const on = site([MEADOW, ARABLE]);

  it('stands a piece in the same place whatever the window it is asked from', () => {
    const key = (piece: FieldLife): string =>
      `${piece.kind} ${piece.pose} ${String(piece.x)} ${String(piece.z)} ${String(piece.heading)}`;
    const here = new Set(fieldLifeAt(on, 0, 400, 0, 360).pieces.map(key));
    const there = fieldLifeAt(on, 0, 480, 0, 440).pieces;
    const shared = there.filter((piece) => Math.hypot(piece.x, piece.z - 400) < 100);
    expect(shared.length).toBeGreaterThan(3);
    for (const piece of shared) expect(here.has(key(piece))).toBe(true);
    // Another seed is another farm.
    const other = fieldLifeAt({ ...on, seed: 3_287 }, 0, 400, 0, 360).pieces.map(key);
    expect(other.filter((each) => here.has(each)).length).toBeLessThan(here.size / 4);
  });

  it('holds a frame to its caps, and the animals nearest the rider to their near level', () => {
    const big = site([rectangle('meadow', -600, 600, -600, 600), ARABLE], {
      road: () => Number.POSITIVE_INFINITY,
    });
    const { pieces } = fieldLifeAt(big, 0, 0, 0, 0);
    const animals = pieces.filter((piece) => piece.kind !== 'bale');
    expect(animals).toHaveLength(FIELD_ANIMALS_MAX);
    expect(pieces.length - animals.length).toBeLessThanOrEqual(FIELD_BALES_MAX);
    for (const piece of pieces) {
      expect(Math.hypot(piece.x, piece.z)).toBeLessThanOrEqual(FIELD_LIFE_REACH_METRES);
    }
    // The animals first, the bales after them.
    const firstBale = pieces.findIndex((piece) => piece.kind === 'bale');
    if (firstBale >= 0)
      expect(pieces.slice(firstBale).every((piece) => piece.kind === 'bale')).toBe(true);
    const near = animals.filter((piece) => piece.level === 'near');
    const within = animals.filter(
      (piece) => Math.hypot(piece.x, piece.z) <= FIELD_LIFE_NEAR_METRES,
    );
    expect(within.length).toBeGreaterThan(FIELD_ANIMALS_NEAR_MAX);
    expect(near).toHaveLength(FIELD_ANIMALS_NEAR_MAX);
    const off = (piece: FieldLife): number => Math.hypot(piece.x, piece.z);
    expect(Math.max(...near.map(off))).toBeLessThanOrEqual(
      Math.min(...animals.filter((piece) => piece.level === 'far').map(off)),
    );
    for (const piece of pieces) expect(piece.y).toBe(0);
  });

  it('gives a herd one coat and every pose, and each piece a heading of its own', () => {
    const animals = along(on).filter((piece) => piece.kind !== 'bale');
    expect(new Set(animals.map((piece) => piece.pose))).toStrictEqual(
      new Set(['grazing', 'head-up', 'lying']),
    );
    expect(new Set(animals.map((piece) => piece.heading)).size).toBe(animals.length);
    expect(new Set(animals.map((piece) => fieldLifeLook(piece, 4))).size).toBeGreaterThan(1);
    expect(fieldLifeLook({ look: 7 }, 4)).toBe(3);
    expect(fieldLifeLook({ look: 7 }, 0)).toBe(0);
  });
});
