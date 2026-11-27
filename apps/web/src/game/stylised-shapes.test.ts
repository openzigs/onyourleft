// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #3287: `stylised-shapes.ts` — the setting a class is, what the files folded
 * into a mesh cost, which shape an item is drawn as, and its tint. Everything
 * here is arithmetic and committed bytes; that the renderer draws what these
 * say is `stylised-folds.test.ts`' and the browser gate's.
 */

import { describe, expect, it } from 'vitest';

import { readGlb } from './model-bytes-testing';
import { type BuildingSetting, type SceneryKind } from './scatter';
import { SCENERY_MODELS, STYLISED_FOLD_MODELS, stylisedShapeNameOf } from './scenery-models';
import {
  FOLDED_TRIANGLES_A_MESH,
  STYLISED_TINT_FLOOR,
  buildingSettingOf,
  stylisedFoldOf,
  writeStylisedTint,
} from './stylised-shapes';
import type { UrbanClass } from './urban-class';

/** A committed model's triangles, read off its bytes. */
function modelTriangles(name: string): number {
  const { json } = readGlb(new URL(`./models/${name}.glb`, import.meta.url).pathname);
  let triangles = 0;
  for (const mesh of json.meshes ?? []) {
    for (const primitive of mesh.primitives) {
      const accessor = primitive.indices ?? primitive.attributes.POSITION;
      if (accessor === undefined) throw new Error(`${name}: a primitive with no positions`);
      triangles += (json.accessors?.[accessor]?.count ?? 0) / 3;
    }
  }
  return triangles;
}

/** What the files folded into each of a kind's meshes come to together, off their bytes. */
function foldedTriangles(): Record<string, number[]> {
  return Object.fromEntries(
    Object.entries(STYLISED_FOLD_MODELS).map(([kind, meshes]) => [
      kind,
      meshes.map((folds) => folds.reduce((sum, model) => sum + modelTriangles(model.name), 0)),
    ]),
  );
}

describe('#3287 the setting a class is', () => {
  it('reads each urban class as one of three settings', () => {
    const table: Readonly<Record<UrbanClass, BuildingSetting>> = {
      unknown: 'rural',
      rural: 'rural',
      village: 'suburban',
      town: 'commercial',
      'city-centre': 'commercial',
    };
    for (const [urban, setting] of Object.entries(table)) {
      expect(buildingSettingOf(urban as UrbanClass), urban).toBe(setting);
    }
  });
});

describe('#3287 what the files folded into a mesh cost', () => {
  it('adds three broadleaves, three conifers, three stones and six buildings', () => {
    expect((STYLISED_FOLD_MODELS['tree-broadleaf'] ?? []).flat()).toHaveLength(3);
    expect((STYLISED_FOLD_MODELS['tree-conifer'] ?? []).flat()).toHaveLength(3);
    expect((STYLISED_FOLD_MODELS.rock ?? []).flat()).toHaveLength(3);
    expect((STYLISED_FOLD_MODELS.building ?? []).flat()).toHaveLength(6);
    // A building's mesh holds a suburban house and a commercial building: one a setting.
    for (const folds of STYLISED_FOLD_MODELS.building ?? []) expect(folds).toHaveLength(2);
  });

  it('names every folded file once, and never as a mesh’s own model is named', () => {
    const names = Object.values(STYLISED_FOLD_MODELS)
      .flat(2)
      .map((model) => model.name);
    expect(new Set(names).size).toBe(names.length);
    const models = new Set(
      Object.values(SCENERY_MODELS).flatMap((list) => list.map((model) => model.name)),
    );
    for (const name of names) expect(models.has(name), name).toBe(false);
  });

  it('states what each mesh’s folds add to every one of its items, off the bytes', () => {
    // An instance submits every shape its mesh holds, so the cost of a fold is
    // the sum, not the heaviest. Written out, so a heavier file or one more
    // is a number that moves in review.
    expect(foldedTriangles()).toEqual({
      'tree-broadleaf': [50 + 62, 72],
      'tree-conifer': [54 + 86, 54],
      rock: [85 + 80, 73],
      building: [1_310 + 1_509, 1_282 + 1_252, 1_140 + 1_100],
    });
  });

  it('holds each kind to the ceiling of its heaviest mesh, and no looser', () => {
    const sums = foldedTriangles();
    expect(Object.keys(FOLDED_TRIANGLES_A_MESH).sort()).toEqual(Object.keys(sums).sort());
    for (const [kind, each] of Object.entries(sums)) {
      const ceiling = FOLDED_TRIANGLES_A_MESH[kind as SceneryKind];
      for (const sum of each) expect(sum, kind).toBeLessThanOrEqual(ceiling as number);
      // A ratchet: the ceiling is the heaviest mesh as committed, with no slack.
      expect(ceiling, kind).toBe(Math.max(...each));
    }
    expect(FOLDED_TRIANGLES_A_MESH.building).toBe(2_819);
  });

  it('pairs the heaviest house with the lightest model, so no mesh carries two heavy ones', () => {
    // A building item costs its mesh's model and both folds: 3 589, 3 334 and
    // 3 264 triangles, where the three models alone are 770, 800 and 1 024.
    const own = (SCENERY_MODELS.building ?? []).map((model) => modelTriangles(model.name));
    const folded = foldedTriangles()['building'] ?? [];
    expect(own.map((triangles, mesh) => triangles + (folded[mesh] ?? 0))).toEqual([
      3_589, 3_334, 3_264,
    ]);
  });
});

describe('#3287 which of its mesh’s shapes an item is', () => {
  const house = (setting?: BuildingSetting) =>
    ({ kind: 'building', x: 12, z: 340, ...(setting === undefined ? {} : { setting }) }) as const;

  it('draws a building as its setting’s', () => {
    expect(stylisedFoldOf(house(), 3)).toBe(0);
    expect(stylisedFoldOf(house('rural'), 3)).toBe(0);
    expect(stylisedFoldOf(house('suburban'), 3)).toBe(1);
    expect(stylisedFoldOf(house('commercial'), 3)).toBe(2);
  });

  it('never names a shape a mesh does not hold', () => {
    // A mesh whose model is all it has draws the model, whatever the setting:
    // an instance told to be a shape that is not there would draw nothing.
    expect(stylisedFoldOf(house('commercial'), 1)).toBe(0);
    expect(stylisedFoldOf(house('commercial'), 2)).toBe(1);
    expect(stylisedFoldOf(house('suburban'), 0)).toBe(0);
    for (let step = 0; step < 500; step += 1) {
      const tree = { kind: 'tree-broadleaf', x: step * 3.7, z: step * 11.3 } as const;
      expect(stylisedFoldOf(tree, 1)).toBe(0);
      const fold = stylisedFoldOf(tree, 2);
      expect(fold === 0 || fold === 1).toBe(true);
    }
  });

  it('picks a tree’s by where it stands: the same every time, and evenly', () => {
    let second = 0;
    const count = 4_000;
    for (let step = 0; step < count; step += 1) {
      const tree = { kind: 'tree-conifer', x: (step % 61) * 4.3 - 90, z: step * 7.1 } as const;
      const fold = stylisedFoldOf(tree, 2);
      expect(stylisedFoldOf(tree, 2)).toBe(fold);
      second += fold;
    }
    expect(second / count).toBeGreaterThan(0.45);
    expect(second / count).toBeLessThan(0.55);
  });

  it('spreads a mesh of three shapes over all three, a third each', () => {
    const drawn = [0, 0, 0];
    const count = 6_000;
    for (let step = 0; step < count; step += 1) {
      const tree = { kind: 'tree-broadleaf', x: (step % 53) * 3.9 - 80, z: step * 6.7 } as const;
      const fold = stylisedFoldOf(tree, 3);
      drawn[fold] = (drawn[fold] ?? 0) + 1;
    }
    expect(drawn).toHaveLength(3);
    for (const share of drawn) {
      expect(share / count).toBeGreaterThan(0.3);
      expect(share / count).toBeLessThan(0.37);
    }
  });

  it('ignores a setting on anything but a building', () => {
    const at = { x: 40, z: 900 } as const;
    expect(stylisedFoldOf({ kind: 'rock', ...at, setting: 'commercial' }, 2)).toBe(
      stylisedFoldOf({ kind: 'rock', ...at }, 2),
    );
  });

  it('names the shape an item is drawn as', () => {
    const item = (variant: number, setting?: BuildingSetting) => ({ ...house(setting), variant });
    expect(stylisedShapeNameOf(item(0))).toBe('building-type-h');
    expect(stylisedShapeNameOf(item(4))).toBe('building-type-i');
    expect(stylisedShapeNameOf(item(0, 'suburban'))).toBe('building-type-l');
    expect(stylisedShapeNameOf(item(1, 'suburban'))).toBe('building-type-p');
    expect(stylisedShapeNameOf(item(2, 'suburban'))).toBe('building-type-q');
    expect(stylisedShapeNameOf(item(0, 'commercial'))).toBe('building-e');
    expect(stylisedShapeNameOf(item(1, 'commercial'))).toBe('building-a');
    expect(stylisedShapeNameOf(item(2, 'commercial'))).toBe('building-d');
    // At a rung of one shape a kind, every house is the first mesh's.
    expect(stylisedShapeNameOf(item(2, 'commercial'), 1)).toBe('building-e');
    // A tree's is its mesh's model or one of the files beside it, by where it stands.
    const named = new Set<string | undefined>();
    for (let step = 0; step < 60; step += 1) {
      named.add(stylisedShapeNameOf({ kind: 'tree-broadleaf', x: 5, z: step * 8, variant: 0 }));
    }
    expect(named).toEqual(new Set(['tree_default', 'tree_fat', 'tree_simple']));
    // A kind drawn from no table has no name.
    expect(stylisedShapeNameOf({ kind: 'post', x: 0, z: 0, variant: 0 })).toBeUndefined();
  });
});

describe('#3287 the seeded tint', () => {
  const tintOf = (kind: SceneryKind, x: number, z: number): readonly number[] => {
    const out = new Float32Array(5).fill(-1);
    writeStylisedTint(kind, x, z, out, 1);
    // Three numbers, at the place asked, and nothing either side of them.
    expect(out[0]).toBe(-1);
    expect(out[4]).toBe(-1);
    return Array.from(out.subarray(1, 4));
  };

  it('only ever darkens, and never past its floor', () => {
    expect(STYLISED_TINT_FLOOR).toBeCloseTo(0.8 * 0.88, 9);
    for (const kind of ['tree-broadleaf', 'tree-conifer', 'shrub', 'rock'] as const) {
      for (let step = 0; step < 2_000; step += 1) {
        for (const channel of tintOf(kind, step * 1.9 - 300, step * 5.3)) {
          expect(channel).toBeLessThanOrEqual(1);
          expect(channel).toBeGreaterThanOrEqual(STYLISED_TINT_FLOOR - 1e-6);
        }
      }
    }
  });

  it('gives two trees of a row different tints, and one tree the same every time', () => {
    const tints = new Set<string>();
    for (let step = 0; step < 50; step += 1) {
      const tint = tintOf('tree-broadleaf', 6, step * 8);
      expect(tintOf('tree-broadleaf', 6, step * 8)).toEqual(tint);
      tints.add(tint.join());
    }
    expect(tints.size).toBe(50);
  });

  it('spreads the darkening and the lean across their whole bounds', () => {
    let darkest = 1;
    let warmest = 1;
    let coolest = 1;
    for (let step = 0; step < 4_000; step += 1) {
      const [red, green, blue] = tintOf('tree-conifer', step * 2.3, step * 9.1) as [
        number,
        number,
        number,
      ];
      darkest = Math.min(darkest, green);
      warmest = Math.min(warmest, blue / green);
      coolest = Math.min(coolest, red / green);
    }
    // A fifth darker at most, an eighth warmer or cooler at most — and nearly all of each.
    expect(darkest).toBeGreaterThanOrEqual(0.8 - 1e-6);
    expect(darkest).toBeLessThan(0.81);
    expect(warmest).toBeGreaterThanOrEqual(0.88 - 1e-6);
    expect(warmest).toBeLessThan(0.89);
    expect(coolest).toBeGreaterThanOrEqual(0.88 - 1e-6);
    expect(coolest).toBeLessThan(0.89);
  });

  it('leaves a rock nearer its own colour than a leaf, and a building alone', () => {
    let rockDarkest = 1;
    for (let step = 0; step < 2_000; step += 1) {
      rockDarkest = Math.min(rockDarkest, ...tintOf('rock', step * 3.1, step * 4.7));
      for (const kind of ['building', 'post', 'barn', 'wall'] as const) {
        expect(tintOf(kind, step * 3.1, step * 4.7)).toEqual([1, 1, 1]);
      }
    }
    expect(rockDarkest).toBeGreaterThanOrEqual(0.86 * 0.96 - 1e-6);
  });
});
