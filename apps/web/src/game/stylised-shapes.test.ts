// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #3287: `stylised-shapes.ts` — the setting a class is, the shapes built from
 * numbers, which shape an item is drawn as, and its tint. Everything here is
 * arithmetic; that the renderer draws what these say is
 * `stylised-folds.test.ts`' and the browser gate's.
 */

import { describe, expect, it } from 'vitest';

import { readGlb } from './model-bytes-testing';
import { SCENERY_KINDS, type BuildingSetting, type SceneryKind } from './scatter';
import { SCENERY_MODELS } from './scenery-models';
import { MAXIMUM_LIT_CHANNEL } from './scenery-palette';
import {
  FOLDED_TRIANGLES_A_MESH,
  GENERATED_TRIANGLE_CEILINGS,
  STYLISED_FOLDS,
  STYLISED_TINT_FLOOR,
  buildingSettingOf,
  stylisedFoldOf,
  stylisedShapeNameOf,
  writeStylisedTint,
  type GeneratedShape,
} from './stylised-shapes';
import type { UrbanClass } from './urban-class';

/** Every generated shape, with the kind it is drawn as. */
const GENERATED: readonly (readonly [SceneryKind, GeneratedShape])[] = (
  Object.entries(STYLISED_FOLDS) as [SceneryKind, readonly (readonly GeneratedShape[])[]][]
).flatMap(([kind, meshes]) =>
  meshes.flatMap((folds) => folds.map((shape) => [kind, shape] as const)),
);

function trianglesOf(shape: GeneratedShape): number {
  return shape.positions.length / 9;
}

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

/** Six times a shape's signed volume: positive when its faces look outward. */
function signedVolume(shape: GeneratedShape): number {
  const p = shape.positions;
  let volume = 0;
  for (let at = 0; at < p.length; at += 9) {
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = p.subarray(at, at + 9) as unknown as number[];
    volume +=
      (ax as number) * ((by as number) * (cz as number) - (bz as number) * (cy as number)) -
      (ay as number) * ((bx as number) * (cz as number) - (bz as number) * (cx as number)) +
      (az as number) * ((bx as number) * (cy as number) - (by as number) * (cx as number));
  }
  return volume;
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

describe('#3287 the shapes built from numbers', () => {
  it('folds shapes only into meshes a kind already has', () => {
    for (const [kind, meshes] of Object.entries(STYLISED_FOLDS) as [
      SceneryKind,
      readonly (readonly GeneratedShape[])[],
    ][]) {
      expect(SCENERY_KINDS).toContain(kind);
      // One list a mesh: a kind gains no mesh, so no draw call.
      expect(meshes.length, kind).toBe(SCENERY_MODELS[kind]?.length);
    }
    // A building's mesh holds a suburban house and a commercial front.
    for (const folds of STYLISED_FOLDS.building ?? []) expect(folds).toHaveLength(2);
  });

  it('adds two broadleaves, two conifers and two rocks', () => {
    expect((STYLISED_FOLDS['tree-broadleaf'] ?? []).flat()).toHaveLength(2);
    expect((STYLISED_FOLDS['tree-conifer'] ?? []).flat()).toHaveLength(2);
    expect((STYLISED_FOLDS.rock ?? []).flat()).toHaveLength(2);
    expect((STYLISED_FOLDS.building ?? []).flat()).toHaveLength(6);
  });

  it('names every shape once, and never as a committed model is named', () => {
    const names = GENERATED.map(([, shape]) => shape.name);
    expect(new Set(names).size).toBe(names.length);
    const models = new Set(
      Object.values(SCENERY_MODELS).flatMap((list) => list.map((model) => model.name)),
    );
    for (const name of names) expect(models.has(name), name).toBe(false);
  });

  it('holds each shape to the heaviest committed model of its kind', () => {
    for (const [kind, shape] of GENERATED) {
      const ceiling = GENERATED_TRIANGLE_CEILINGS[kind];
      expect(ceiling, kind).toBeDefined();
      expect(trianglesOf(shape), shape.name).toBeGreaterThan(0);
      expect(trianglesOf(shape), shape.name).toBeLessThanOrEqual(ceiling as number);
    }
  });

  it('adds at most a hundred triangles to any one item', () => {
    // An instance submits every shape its mesh holds, so the cost of a fold is
    // the sum, not the heaviest: each mesh's shapes together, bounded.
    expect(FOLDED_TRIANGLES_A_MESH).toBe(100);
    const sums: Record<string, number[]> = {};
    for (const [kind, meshes] of Object.entries(STYLISED_FOLDS)) {
      const each = meshes.map((folds) => folds.reduce((sum, shape) => sum + trianglesOf(shape), 0));
      for (const sum of each) expect(sum, kind).toBeLessThanOrEqual(FOLDED_TRIANGLES_A_MESH);
      sums[kind] = each;
    }
    // Written out, so a shape that grows is a number that moves in review.
    expect(sums).toEqual({
      'tree-broadleaf': [72, 52],
      'tree-conifer': [46, 30],
      rock: [20, 20],
      building: [70, 82, 86],
    });
  });

  it('takes each ceiling from the committed files, read back off their bytes', () => {
    // #3287's fourth criterion: a building at most 1 024, a tree at most 196.
    expect(GENERATED_TRIANGLE_CEILINGS.building).toBe(1_024);
    expect(GENERATED_TRIANGLE_CEILINGS['tree-broadleaf']).toBe(196);
    for (const [kind, ceiling] of Object.entries(GENERATED_TRIANGLE_CEILINGS)) {
      const heaviest = Math.max(
        ...(SCENERY_MODELS[kind as SceneryKind] ?? []).map((model) => modelTriangles(model.name)),
      );
      expect(ceiling, kind).toBe(heaviest);
    }
  });

  it('builds whole triangles of finite corners, none with no area', () => {
    for (const [, shape] of GENERATED) {
      expect(shape.positions.length % 9, shape.name).toBe(0);
      expect(shape.colours.length, shape.name).toBe(shape.positions.length);
      const p = shape.positions;
      for (let at = 0; at < p.length; at += 9) {
        const ux = (p[at + 3] as number) - (p[at] as number);
        const uy = (p[at + 4] as number) - (p[at + 1] as number);
        const uz = (p[at + 5] as number) - (p[at + 2] as number);
        const vx = (p[at + 6] as number) - (p[at] as number);
        const vy = (p[at + 7] as number) - (p[at + 1] as number);
        const vz = (p[at + 8] as number) - (p[at + 2] as number);
        const area = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
        expect(Number.isFinite(area), shape.name).toBe(true);
        expect(area, `${shape.name} triangle ${String(at / 9)}`).toBeGreaterThan(1e-4);
      }
    }
  });

  it('winds its faces outward', () => {
    // A face wound inward is culled, and the shape drawn inside out. The
    // signed volume of a solid whose faces look outward is positive.
    for (const [, shape] of GENERATED) expect(signedVolume(shape), shape.name).toBeGreaterThan(0);
  });

  it('stands on the ground, its front toward +z for a building', () => {
    for (const [kind, shape] of GENERATED) {
      let lowest = Number.POSITIVE_INFINITY;
      let front = Number.NEGATIVE_INFINITY;
      let back = Number.POSITIVE_INFINITY;
      for (let at = 0; at < shape.positions.length; at += 3) {
        lowest = Math.min(lowest, shape.positions[at + 1] as number);
        front = Math.max(front, shape.positions[at + 2] as number);
        back = Math.min(back, shape.positions[at + 2] as number);
      }
      expect(lowest, shape.name).toBeCloseTo(0, 6);
      // A building's door is on its +z wall, which is its furthest from the middle.
      if (kind === 'building') expect(front, shape.name).toBeGreaterThanOrEqual(-back);
    }
  });

  it('paints nothing brighter than the sun leaves unclipped', () => {
    for (const [, shape] of GENERATED) {
      for (const channel of shape.colours) {
        expect(channel, shape.name).toBeGreaterThanOrEqual(0);
        expect(channel, shape.name).toBeLessThanOrEqual(MAXIMUM_LIT_CHANNEL + 1e-6);
      }
    }
  });

  it('builds the same shape every time', () => {
    // No clock and no random number: a shape is the same on every device.
    for (const [, shape] of GENERATED) {
      expect(shape.positions.every((value) => Number.isFinite(value))).toBe(true);
    }
    const tree = STYLISED_FOLDS['tree-broadleaf']?.[0]?.[0];
    expect(Array.from(tree?.positions.subarray(0, 3) ?? [])).toMatchInlineSnapshot(`
      [
        0.17000000178813934,
        0,
        0,
      ]
    `);
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

  it('ignores a setting on anything but a building', () => {
    const at = { x: 40, z: 900 } as const;
    expect(stylisedFoldOf({ kind: 'rock', ...at, setting: 'commercial' }, 2)).toBe(
      stylisedFoldOf({ kind: 'rock', ...at }, 2),
    );
  });

  it('names the shape an item is drawn as', () => {
    const models = SCENERY_MODELS.building ?? [];
    const item = (variant: number, setting?: BuildingSetting) => ({ ...house(setting), variant });
    expect(stylisedShapeNameOf(item(0), models)).toBe('building-type-h');
    expect(stylisedShapeNameOf(item(4), models)).toBe('building-type-i');
    expect(stylisedShapeNameOf(item(0, 'suburban'), models)).toBe('house_flat_roof');
    expect(stylisedShapeNameOf(item(1, 'suburban'), models)).toBe('house_single_pitch');
    expect(stylisedShapeNameOf(item(2, 'commercial'), models)).toBe('office_low');
    // At a rung of one shape a kind, every house is the first mesh's.
    expect(stylisedShapeNameOf(item(2, 'commercial'), models, 1)).toBe('shop_front');
    // A kind drawn from no table has no name.
    expect(stylisedShapeNameOf({ kind: 'post', x: 0, z: 0, variant: 0 }, [])).toBeUndefined();
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
