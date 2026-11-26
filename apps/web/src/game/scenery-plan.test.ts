// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The scenery plan — #3252: which tree and bush a setting grows, how big and
 * how built each stands, how a rock sits and which boundary a setting gets.
 * The settings here are synthetic: a word handed to the plan, and
 * `footprint-fixtures-testing.ts` §`countrysideFixture`'s rectangles of
 * arithmetic read back through `scatterAt`, the path a frame takes.
 */

import { describe, expect, it } from 'vitest';

import { countrysideFixture } from './footprint-fixtures-testing';
import { GROWN_SPECIES } from './grown-trees';
import { FOLIAGE_TINT, instanceTint } from './instance-tint';
import { landClassMask } from './land-class';
import { realisticVegetation } from './realistic-assets';
import { northRoute } from './route-fixtures-testing';
import { scatterAt, scatterSeed, SCATTER_VARIANT_SLOTS, type ScatterItem } from './scatter';
import {
  AGE_SCALE,
  AGE_SCALE_HIGHEST,
  ageScale,
  BOUNDARY_PLAN,
  boundaryFor,
  BUILD_BOUND,
  DRAWN_SCALE_HIGHEST,
  drawnScale,
  FENCE_VARIANTS,
  fenceFoldOf,
  fenceVariantOf,
  instanceBuild,
  PLAN_SLOTS,
  ROCK_SEAT,
  rockSeat,
  SCENERY_PLAN,
  SCENERY_SETTINGS,
  SCENERY_SPECIES,
  shapeNameFor,
  slotTable,
  speciesIn,
  speciesOfShape,
  type PlannedKind,
  type ScenerySetting,
} from './scenery-plan';
import { corridorOrigin } from './terrain';

const PLANTED = ['tree-broadleaf', 'tree-conifer', 'shrub'] as const;
const TREES = ['tree-broadleaf', 'tree-conifer'] as const;

/** Every species a list of settings grows of some kinds, each once. */
function grownIn(
  settings: readonly ScenerySetting[],
  kinds: readonly (typeof PLANTED)[number][],
): readonly string[] {
  return [
    ...new Set(
      settings.flatMap((setting) =>
        kinds.flatMap((kind) => speciesIn(setting, kind).map((species) => species.id)),
      ),
    ),
  ].sort();
}

describe('what a setting grows — #3252', () => {
  it('draws at least six kinds of tree and three kinds of bush over the settings', () => {
    expect(grownIn(SCENERY_SETTINGS, TREES)).toEqual([
      'field-maple',
      'fir',
      'hornbeam',
      'lime',
      'oak',
      'poplar',
      'spruce',
    ]);
    expect(grownIn(SCENERY_SETTINGS, ['shrub'])).toEqual(['laurel', 'scrub', 'thorn']);
  });

  it('chooses them BY the setting: a park is not a hedgerow and neither is the forest', () => {
    const trees = (setting: ScenerySetting): readonly string[] => grownIn([setting], TREES);
    expect(trees('wild')).toEqual(['fir', 'hornbeam', 'oak']);
    expect(trees('wood')).toEqual(trees('wild'));
    expect(trees('park')).toEqual(['fir', 'hornbeam', 'lime', 'oak', 'poplar', 'spruce']);
    expect(trees('hedgerow')).toEqual(['field-maple', 'fir', 'oak', 'spruce']);
    expect(trees('pasture')).toEqual(['field-maple', 'fir', 'oak', 'poplar', 'spruce']);
    expect(trees('wood-edge')).toEqual(['field-maple', 'fir', 'hornbeam', 'oak', 'spruce']);
    // What stands most in each: a slot in two or more is its setting's tree.
    const most = (setting: ScenerySetting, kind: (typeof PLANTED)[number]): string => {
      const counts = new Map<string, number>();
      for (const shape of SCENERY_PLAN[setting][kind]) {
        const id = speciesOfShape(shape)?.id ?? '';
        counts.set(id, (counts.get(id) ?? 0) + 1);
      }
      return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
    };
    expect(most('park', 'tree-broadleaf')).toBe('lime');
    expect(most('hedgerow', 'tree-broadleaf')).toBe('field-maple');
    expect(most('pasture', 'tree-broadleaf')).toBe('oak');
    expect(most('park', 'shrub')).toBe('laurel');
    expect(most('hedgerow', 'shrub')).toBe('thorn');
    expect(most('wild', 'shrub')).toBe('scrub');
  });

  it('leaves the world with no map exactly as it was: each slot the shape variant % count drew', () => {
    const committed = realisticVegetation('generated');
    for (const kind of [...PLANTED, 'rock'] as const) {
      const models = committed[kind];
      for (let slot = 0; slot < SCATTER_VARIANT_SLOTS; slot += 1) {
        const before = models[slot % models.length]?.name;
        expect(shapeNameFor(kind, undefined, slot), `${kind} ${String(slot)}`).toBe(before);
        expect(shapeNameFor(kind, 'wild', slot)).toBe(before);
      }
    }
    expect(PLAN_SLOTS).toBe(SCATTER_VARIANT_SLOTS);
  });

  it('names no more shapes of a kind in any setting than the world with no map draws', () => {
    for (const kind of PLANTED) {
      const wild = new Set(SCENERY_PLAN.wild[kind]).size;
      for (const setting of SCENERY_SETTINGS) {
        expect(new Set(SCENERY_PLAN[setting][kind]).size, `${setting} ${kind}`).toBeLessThanOrEqual(
          wild,
        );
      }
    }
  });

  it('names only shapes that exist: a committed model, or a species grown in code', () => {
    const committed = new Set(
      Object.values(realisticVegetation('generated')).flatMap((models) =>
        models.map((model) => model.name),
      ),
    );
    const grown = new Set(GROWN_SPECIES.map((species) => species.id));
    const named = new Set<string>();
    for (const setting of SCENERY_SETTINGS) {
      for (const kind of PLANTED) {
        for (const shape of SCENERY_PLAN[setting][kind]) {
          named.add(shape);
          const species = speciesOfShape(shape);
          expect(species?.kind, shape).toBe(kind);
          expect(species?.making === 'grown' ? grown.has(shape) : committed.has(shape), shape).toBe(
            true,
          );
        }
      }
    }
    // And nothing is grown or listed that no setting draws.
    for (const shape of grown) expect(named.has(shape), shape).toBe(true);
    for (const species of SCENERY_SPECIES) {
      for (const shape of species.shapes) expect(named.has(shape), shape).toBe(true);
    }
    // A grown TREE is hosted by a committed tree of its own kind: its far band is that tree's mesh.
    for (const species of GROWN_SPECIES) {
      if (species.kind === 'shrub') continue;
      expect(
        committed.has(species.host) && speciesOfShape(species.host)?.kind === species.kind,
        species.id,
      ).toBe(true);
    }
  });

  it('folds a variant into the slots, and a variant that is no integer into the first', () => {
    expect(shapeNameFor('tree-broadleaf', 'park', 6)).toBe(
      shapeNameFor('tree-broadleaf', 'park', 0),
    );
    expect(shapeNameFor('tree-broadleaf', 'park', -1)).toBe(
      shapeNameFor('tree-broadleaf', 'park', 5),
    );
    expect(shapeNameFor('tree-broadleaf', 'park', Number.NaN)).toBe(
      shapeNameFor('tree-broadleaf', 'park', 0),
    );
    expect(shapeNameFor('rock', 'park', 3)).toBe('boulder_01');
  });
});

describe('a setting’s table over the shapes a world holds — #3252', () => {
  const names = (kind: PlannedKind, trees: 'generated' | 'scanned'): string[] => [
    ...realisticVegetation(trees)[kind].map((model) => model.name),
    ...GROWN_SPECIES.filter((species) => species.kind === kind).map((species) => species.id),
  ];

  it('is each slot’s index among the world’s shapes', () => {
    const shapes = names('tree-broadleaf', 'generated');
    const table = slotTable('tree-broadleaf', 'park', shapes) ?? [];
    expect(table).toHaveLength(PLAN_SLOTS);
    expect(table.map((index) => shapes[index])).toEqual([...SCENERY_PLAN.park['tree-broadleaf']]);
    expect(slotTable('tree-broadleaf', 'wild', shapes)).toEqual([0, 1, 2, 3, 0, 1]);
  });

  it('is nothing for a world without a shape it names, which then folds the variant as before', () => {
    // The scans host no grown species: every table names a shape they lack.
    const scans = realisticVegetation('scanned')['tree-broadleaf'].map((model) => model.name);
    for (const setting of SCENERY_SETTINGS) {
      expect(slotTable('tree-broadleaf', setting, scans), setting).toBeUndefined();
    }
    const without = names('tree-broadleaf', 'generated').filter((name) => name !== 'grown_lime');
    expect(slotTable('tree-broadleaf', 'park', without)).toBeUndefined();
    expect(slotTable('tree-broadleaf', 'hedgerow', without)).toBeDefined();
  });
});

describe('seeded size and build: the same seed is the same scene — #3252, #621', () => {
  /** A row of a park's limes, 8 m apart, all one variant at one scale. */
  const row = Array.from({ length: 16 }, (_, index) => ({ x: 6.5, z: 100 + index * 8 }));

  it('gives the same place the same size, build and tint every time it is asked', () => {
    for (const { x, z } of row) {
      const again = ageScale('park', 'grown_lime', x, z);
      expect(ageScale('park', 'grown_lime', x, z)).toBe(again);
      expect(instanceBuild('park', x, z, { height: 0, girth: 0 })).toEqual(
        instanceBuild('park', x, z, { height: 0, girth: 0 }),
      );
      expect(instanceTint(x, z, FOLIAGE_TINT)).toEqual(instanceTint(x, z, FOLIAGE_TINT));
    }
  });

  it('makes a row of one tree a row of different trees: no two alike in size, build and tint', () => {
    const drawn = row.map(({ x, z }) => {
      const build = instanceBuild('park', x, z, { height: 0, girth: 0 });
      const tint = instanceTint(x, z, FOLIAGE_TINT);
      return [
        ageScale('park', 'grown_lime', x, z).toFixed(4),
        build.height.toFixed(4),
        build.girth.toFixed(4),
        tint.hueDegrees.toFixed(3),
        tint.brightness.toFixed(3),
      ].join(' ');
    });
    expect(new Set(drawn).size).toBe(row.length);
    // And each part varies on its own: sizes, heights and girths all spread.
    for (const part of [0, 1, 2]) {
      expect(new Set(drawn.map((each) => each.split(' ')[part])).size).toBeGreaterThan(12);
    }
  });

  it('keeps a size inside its species’ range for the setting, and uses the range', () => {
    const range = AGE_SCALE.park?.['lime'] ?? [0, 0];
    const sizes = Array.from({ length: 400 }, (_, index) =>
      ageScale('park', 'grown_lime', index * 3.7, index * 11.3),
    );
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(range[0]);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(range[1]);
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeGreaterThan(0.9 * (range[1] - range[0]));
    // A lone field oak is bigger than a hedgerow's maple, whatever the place.
    expect(AGE_SCALE.pasture?.['oak']?.[0]).toBeGreaterThan(
      AGE_SCALE.hedgerow?.['field-maple']?.[1] ?? 9,
    );
  });

  it('never sizes a tree past the figure the clearances were judged at', () => {
    for (const ranges of Object.values(AGE_SCALE)) {
      for (const [lowest, highest] of Object.values(ranges)) {
        expect(lowest).toBeGreaterThan(0.5);
        expect(lowest).toBeLessThanOrEqual(highest);
        expect(highest).toBeLessThanOrEqual(AGE_SCALE_HIGHEST);
      }
    }
  });

  it('leaves the world with no map its size and build: 1, exactly', () => {
    for (const { x, z } of row) {
      expect(ageScale(undefined, 'generated_oak_a', x, z)).toBe(1);
      expect(ageScale('wild', 'generated_oak_a', x, z)).toBe(1);
      expect(ageScale('wood', 'generated_oak_a', x, z)).toBe(1);
      expect(instanceBuild(undefined, x, z, { height: 0, girth: 0 })).toEqual({
        height: 1,
        girth: 1,
      });
      expect(instanceBuild('wild', x, z, { height: 0, girth: 0 })).toEqual({ height: 1, girth: 1 });
    }
  });

  it('keeps a build inside its bound, each part from a stream of its own', () => {
    const builds = Array.from({ length: 400 }, (_, index) =>
      instanceBuild('hedgerow', index * 5.1, index * 2.3, { height: 0, girth: 0 }),
    );
    for (const { height, girth } of builds) {
      expect(Math.abs(height - 1)).toBeLessThanOrEqual(BUILD_BOUND.height);
      expect(Math.abs(girth - 1)).toBeLessThanOrEqual(BUILD_BOUND.girth);
    }
    const heights = builds.map((build) => build.height);
    expect(Math.max(...heights) - Math.min(...heights)).toBeGreaterThan(1.8 * BUILD_BOUND.height);
    // Not one number used twice: a tall one is not always a stout one.
    const together = builds.filter((build) => build.height > 1 === build.girth > 1).length;
    expect(together).toBeGreaterThan(120);
    expect(together).toBeLessThan(280);
  });
});

describe('a rock sits in the ground — #3252', () => {
  it('is sunk by a share of its height and tipped, the same every time, and no two alike', () => {
    const seats = Array.from({ length: 200 }, (_, index) =>
      rockSeat(index * 4.3, index * 9.1, { sink: 0, tilt: 0, azimuth: 0 }),
    );
    for (const seat of seats) {
      expect(seat.sink).toBeGreaterThanOrEqual(ROCK_SEAT.sink[0]);
      expect(seat.sink).toBeLessThanOrEqual(ROCK_SEAT.sink[1]);
      expect(seat.tilt).toBeGreaterThanOrEqual(0);
      expect(seat.tilt).toBeLessThanOrEqual(ROCK_SEAT.tiltRadians);
      expect(seat.azimuth).toBeGreaterThanOrEqual(0);
      expect(seat.azimuth).toBeLessThan(Math.PI * 2);
    }
    expect(ROCK_SEAT.sink[0]).toBeGreaterThan(0);
    expect(new Set(seats.map((seat) => seat.sink.toFixed(5))).size).toBeGreaterThan(190);
    expect(rockSeat(12, 34, { sink: 0, tilt: 0, azimuth: 0 })).toEqual(
      rockSeat(12, 34, { sink: 0, tilt: 0, azimuth: 0 }),
    );
  });
});

describe('which boundary a setting gets — #3252', () => {
  it('walls high fields in stone, fences gardens in timber and screens a highway', () => {
    expect(boundaryFor('upland-field')).toBe('stone-wall');
    expect(boundaryFor('field')).toBe('hedge');
    expect(boundaryFor('field-by-wood')).toBe('post-and-rail');
    expect(boundaryFor('garden')).toBe('timber-fence');
    expect(boundaryFor('works')).toBe('chain-link');
    expect(boundaryFor('highway')).toBe('noise-barrier');
    expect(new Set(Object.values(BOUNDARY_PLAN)).size).toBe(6);
  });

  it('gives the built fences the fence’s second variant, and the chain-link the field fence’s', () => {
    expect([...FENCE_VARIANTS]).toEqual(['field', 'built']);
    expect(fenceVariantOf('post-and-rail')).toBe(0);
    expect(fenceVariantOf('chain-link')).toBe(0);
    expect(fenceVariantOf('timber-fence')).toBe(1);
    expect(fenceVariantOf('noise-barrier')).toBe(1);
    expect(fenceVariantOf('hedge')).toBe(0);
  });

  it('draws the chain-link and the barrier in their own vertices’ colours, and the others in planks', () => {
    expect(fenceFoldOf({})).toBe(0);
    expect(fenceFoldOf({ chainLink: true })).toBe(1);
    expect(fenceFoldOf({ boundary: 'timber-fence' })).toBe(0);
    expect(fenceFoldOf({ boundary: 'noise-barrier' })).toBe(1);
  });
});

describe('the setting a frame’s items carry, read off synthetic land — #3252', () => {
  const { profile, origin, corridor } = countrysideFixture();
  const land = landClassMask(corridor);
  const seed = scatterSeed(profile);
  const placed = (): readonly ScatterItem[] =>
    scatterAt(profile, origin, seed, 0, 3_000, { maxItems: 100_000, riderMetres: 1_500 }, land);
  const items = placed();
  const planted = items.filter((item) => item.kind !== 'post');

  it('says what each tree, shrub and rock stands on, by the land under it', () => {
    const seen = new Map<string, Set<string>>();
    for (const item of planted) {
      const cover = land.classAt(item.x, item.z);
      const settings = seen.get(cover) ?? new Set<string>();
      settings.add(item.setting ?? 'none');
      seen.set(cover, settings);
    }
    expect([...(seen.get('wood') ?? [])].sort()).toEqual(['wood', 'wood-edge']);
    expect([...(seen.get('farmland') ?? [])].sort()).toEqual(['hedgerow', 'pasture']);
    expect([...(seen.get('park') ?? [])]).toEqual(['park']);
    expect([...(seen.get('other') ?? [])]).toEqual(['open']);
  });

  it('so a mapped ride draws every species: the plan read through the items a frame holds', () => {
    const drawn = new Set(
      planted
        .filter((item) => item.kind !== 'rock')
        .map(
          (item) =>
            speciesOfShape(shapeNameFor(item.kind as PlannedKind, item.setting, item.variant))?.id,
        ),
    );
    for (const species of ['oak', 'hornbeam', 'lime', 'field-maple', 'poplar', 'thorn', 'laurel']) {
      expect(drawn.has(species), species).toBe(true);
    }
  });

  it('is the same scene from the same seed, setting for setting', () => {
    expect(placed()).toEqual(items);
  });

  it('CONTROL: with no map there is no setting, and the items are the procedural world’s', () => {
    const road = northRoute(3_000, () => 10);
    const bare = scatterAt(road, corridorOrigin(road), scatterSeed(road), 0, 3_000, {
      maxItems: 100_000,
      riderMetres: 1_500,
    });
    expect(bare.length).toBeGreaterThan(50);
    expect(bare.every((item) => !('setting' in item))).toBe(true);
  });
});

describe('the ONE drawn size every guard and the renderer read — #3252’s review', () => {
  const at = (x: number, z: number, extra: object = {}) => ({
    kind: 'tree-broadleaf',
    x,
    z,
    scale: 1.2,
    variant: 0,
    ...extra,
  });

  it('is the scale, the species’ age there and the instance’s build, across and up', () => {
    const tree = at(6.5, 132, { setting: 'park' as const });
    const { across, up } = drawnScale(tree);
    const age = ageScale('park', 'grown_lime', 6.5, 132);
    const build = instanceBuild('park', 6.5, 132, { height: 0, girth: 0 });
    expect(across).toBeCloseTo(1.2 * age * build.girth, 12);
    expect(up).toBeCloseTo(1.2 * age * build.height, 12);
    expect(across).not.toBeCloseTo(up, 3);
    // The species is the slot's own: a park's fourth slot is a poplar, older still.
    const poplar = drawnScale(at(6.5, 132, { setting: 'park' as const, variant: 3 }));
    expect(poplar.up).toBeCloseTo(
      1.2 * ageScale('park', 'grown_poplar', 6.5, 132) * build.height,
      12,
    );
  });

  it('is the scale alone for an item with no setting, a structure and a post', () => {
    for (const item of [
      at(6.5, 132),
      at(6.5, 132, { kind: 'fence', setting: 'park' as const }),
      at(6.5, 132, { kind: 'post', setting: 'park' as const }),
    ]) {
      const { across, up } = drawnScale(item);
      expect([across, up]).toEqual([1.2, 1.2]);
    }
  });

  it('never passes the most a guard has to allow for', () => {
    expect(DRAWN_SCALE_HIGHEST).toBeCloseTo(1.5 * 1.1, 12);
    for (const setting of SCENERY_SETTINGS) {
      for (let slot = 0; slot < PLAN_SLOTS; slot += 1) {
        for (let place = 0; place < 60; place += 1) {
          for (const kind of ['tree-broadleaf', 'tree-conifer', 'shrub', 'rock']) {
            const { across, up } = drawnScale({
              kind,
              x: place * 7.3,
              z: place * 3.1,
              scale: 1,
              variant: slot,
              setting,
            });
            expect(Math.max(across, up)).toBeLessThanOrEqual(DRAWN_SCALE_HIGHEST);
            expect(Math.min(across, up)).toBeGreaterThan(0.7);
          }
        }
      }
    }
  });
});
