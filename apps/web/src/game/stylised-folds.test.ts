// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #3287: the stylised belt draws several shapes with one mesh — the files a
 * load keeps beside each model, the `BatchedMesh` a belt builds of them, the
 * one shape and the tint it writes each instance, and what a belt draws where
 * the driver has no multi-draw.
 *
 * Read through the belt a view builds (`new ScatterBelt(undefined, …)`, after
 * `loadSceneryModels`), which is the path a ride takes. What this cannot say
 * is what a driver is asked to draw: `game.browser.spec.ts` §"#3287" counts
 * the triangles and the calls, and reads the pixels.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { BUILDING_VARIANTS, isBuiltKind } from './buildings';
import { CAMERA_TARGET_AHEAD_METRES } from './camera';
import { GlslProgram } from './glsl-program-testing';
import type { CameraPose } from './port';
import { SCENERY_KINDS, type ScatterItem, type SceneryKind } from './scatter';
import { SCENERY_MODELS, STYLISED_FOLD_MODELS, type SceneryModel } from './scenery-models';
import { stylisedFoldOf, writeStylisedTint } from './stylised-shapes';
import {
  STYLISED_INSTANCE_ATTRIBUTE,
  STYLISED_INSTANCE_GLSL,
  ScatterBelt,
  readsStylisedInstances,
  loadSceneryModels,
  prepareSceneryGeometry,
  setStylisedFolds,
} from './three-renderer';

const POSE: CameraPose = {
  x: 0,
  y: 0,
  z: 0,
  headingX: 0,
  headingZ: 1,
  eyeRoadY: 0,
  targetRoadY: 0,
  targetAheadMetres: CAMERA_TARGET_AHEAD_METRES,
};

function item(overrides: Partial<ScatterItem> = {}): ScatterItem {
  return { kind: 'shrub', x: 3, y: 0, z: 10, rotation: 0, scale: 1, variant: 0, ...overrides };
}

type Mesh = ReturnType<ScatterBelt['meshesOf']>[number];
type Batch = ReturnType<ScatterBelt['batchesOf']>[number];
type Geometry = Mesh['geometry'];
type Scene = Parameters<typeof prepareSceneryGeometry>[0];

/** A belt as a view builds one where the driver has `WEBGL_multi_draw`. */
function batchedBelt(): ScatterBelt {
  return new ScatterBelt(undefined, { batched: true });
}

function meshFor(belt: ScatterBelt, kind: SceneryKind, variant = 0): Mesh {
  const mesh = belt.meshesOf(kind)[variant];
  if (mesh === undefined) throw new Error(`no mesh for ${kind} ${String(variant)}`);
  return mesh;
}

function batchFor(belt: ScatterBelt, kind: SceneryKind, variant = 0): Batch {
  const batch = belt.batchesOf(kind)[variant];
  if (batch === undefined) throw new Error(`no batch for ${kind} ${String(variant)}`);
  return batch;
}

function trianglesOf(geometry: Geometry): number {
  return (geometry.index?.count ?? geometry.getAttribute('position').count) / 3;
}

/** The triangles ONE shape of a batch submits when an instance is drawn as it. */
function shapeTriangles(batch: Batch, shape: number): number {
  return rangeOf(batch, shape).count / 3;
}

/** Where one shape of a batch is in its vertices and its draws. Throws for a shape it does not hold. */
function rangeOf(
  batch: Batch,
  shape: number,
): NonNullable<ReturnType<Batch['getGeometryRangeAt']>> {
  const range = batch.getGeometryRangeAt(shape);
  if (range === null) throw new Error(`no shape ${String(shape)}`);
  return range;
}

/** The triangles the instances a batch drew last submit: each its own shape's. */
function submittedBy(belt: ScatterBelt, batch: Batch): number {
  let submitted = 0;
  for (let at = 0; at < belt.batchedCount(batch); at += 1) {
    submitted += shapeTriangles(batch, batch.getGeometryIdAt(at));
  }
  return submitted;
}

/** One instance's tint, as the batch carries it. `undefined` where it carries none. */
function tintOf(batch: Batch, at: number): number[] | undefined {
  const read: number[] = [];
  const target = {
    fromArray(values: ArrayLike<number>, from: number) {
      read.push(values[from] as number, values[from + 1] as number, values[from + 2] as number);
      return target;
    },
    // What three calls instead where a batch carries no colours at all.
    setRGB: () => target,
  };
  batch.getColorAt(at, target as never);
  return read.length === 0 ? undefined : read;
}

/** A stand-in for a loaded glTF scene of one part. @see three-renderer.test.ts §sceneOf */
function sceneOf(geometry: Geometry, matrixWorld: unknown): Scene {
  return {
    updateWorldMatrix: () => undefined,
    traverse: (visit: (node: unknown) => void) => {
      visit({ isMesh: true, geometry, matrixWorld });
    },
  } as unknown as Scene;
}

/**
 * `donor`'s primitive as a scene — and, with `leaning`, with its highest
 * corners pushed toward +z, so which way a loaded shape faces can be read back.
 */
function sceneAs(donor: SceneryKind, leaning = false): Scene {
  const belt = new ScatterBelt();
  const mesh = meshFor(belt, donor);
  const geometry = mesh.geometry.clone();
  if (leaning) {
    const position = geometry.getAttribute('position');
    let top = Number.NEGATIVE_INFINITY;
    for (let at = 0; at < position.count; at += 1) top = Math.max(top, position.getY(at));
    for (let at = 0; at < position.count; at += 1) {
      if (position.getY(at) > top - 1e-6) position.setZ(at, position.getZ(at) + 5);
    }
  }
  const scene = sceneOf(geometry, mesh.matrixWorld);
  belt.dispose();
  return scene;
}

/** The triangles `donor`'s primitive has, which a fit does not change. */
function donorTriangles(donor: SceneryKind): number {
  const belt = new ScatterBelt();
  const triangles = trianglesOf(meshFor(belt, donor).geometry);
  belt.dispose();
  return triangles;
}

/** Every file folded into a mesh, with its kind, its mesh and which fold it is (1 and up). */
const FOLDED: readonly {
  readonly kind: SceneryKind;
  readonly mesh: number;
  readonly fold: number;
  readonly model: SceneryModel;
}[] = (
  Object.entries(STYLISED_FOLD_MODELS) as [SceneryKind, readonly (readonly SceneryModel[])[]][]
).flatMap(([kind, meshes]) =>
  meshes.flatMap((folds, mesh) => folds.map((model, at) => ({ kind, mesh, fold: at + 1, model }))),
);

/**
 * The primitive each file is loaded as, by which of its mesh's shapes it is:
 * the model, the first file beside it, the second. Three shapes of three
 * triangle counts, one of them indexed, so a shape read back is THAT shape.
 */
const DONORS: readonly SceneryKind[] = ['rock', 'tree-broadleaf', 'tree-conifer'];
const SHAPE_TRIANGLES = DONORS.map(donorTriangles);

/** Which of its mesh's shapes the file at `url` is: 0 for a mesh's own model. */
function shapeOfUrl(url: string): number {
  return FOLDED.find((each) => each.model.url === url)?.fold ?? 0;
}

/** Loads every file as its shape's donor ({@link DONORS}). */
async function loadByShape(
  options: {
    readonly leaning?: boolean;
    readonly missing?: string;
    readonly asked?: string[];
  } = {},
): Promise<void> {
  await loadSceneryModels((url) => {
    options.asked?.push(url);
    return url === options.missing
      ? Promise.reject(new Error('404'))
      : Promise.resolve(sceneAs(DONORS[shapeOfUrl(url)] ?? 'rock', options.leaning));
  });
}

/** Which way each of a batch's shapes leans: the z of its highest corner, by shape. */
function leanOf(batch: Batch, shapes: number): number[] {
  const position = batch.geometry.getAttribute('position');
  const lean: number[] = [];
  for (let shape = 0; shape < shapes; shape += 1) {
    const { vertexStart, vertexCount } = rangeOf(batch, shape);
    let highest = Number.NEGATIVE_INFINITY;
    for (let at = vertexStart; at < vertexStart + vertexCount; at += 1) {
      if (position.getY(at) > highest) {
        highest = position.getY(at);
        lean[shape] = position.getZ(at);
      }
    }
  }
  return lean;
}

/** The meshes a belt holds when every model in the table loads: 24, the browser gate's ceiling. */
const MESHES_WITH_EVERY_MODEL = SCENERY_KINDS.reduce(
  (sum, kind) =>
    sum + (SCENERY_MODELS[kind]?.length ?? (isBuiltKind(kind) ? BUILDING_VARIANTS : 1)),
  0,
);

afterEach(async () => {
  // `loadSceneryModels` writes module state, and so does the control's switch.
  // @see three-renderer.test.ts
  setStylisedFolds(true);
  await loadSceneryModels(() => Promise.reject(new Error('no models in this test')));
});

describe('#3287 the files a load keeps beside each model', () => {
  it('uses three shapes this file can tell apart', () => {
    expect(new Set(SHAPE_TRIANGLES).size).toBe(3);
    for (const triangles of SHAPE_TRIANGLES) expect(triangles).toBeGreaterThan(0);
  });

  it('reads every model and every folded file once, through the loader a ride uses', async () => {
    const asked: string[] = [];
    await loadByShape({ asked });

    const models = Object.values(SCENERY_MODELS).flat();
    expect(FOLDED).toHaveLength(15);
    expect([...asked].sort()).toEqual(
      [...models, ...FOLDED.map((each) => each.model)].map((model) => model.url).sort(),
    );
  });

  it('turns a folded building to the road, and nothing else', async () => {
    // A City Kit building's front is its −z, and a lot's house is stood with
    // its +z to the road: a folded building is turned half a turn, about its
    // own middle. The mesh's own model stands as it always has.
    await loadByShape({ leaning: true });
    const belt = batchedBelt();

    for (const mesh of [0, 1, 2]) {
      const [own, suburban, commercial] = leanOf(batchFor(belt, 'building', mesh), 3);
      expect(own, `building ${String(mesh)}`).toBeGreaterThan(0.5);
      expect(suburban, `building ${String(mesh)}`).toBeLessThan(-0.5);
      expect(commercial, `building ${String(mesh)}`).toBeLessThan(-0.5);
    }
    // CONTROL: a tree and a stone have no front, and are kept as they come.
    for (const kind of ['tree-broadleaf', 'tree-conifer', 'rock'] as const) {
      const lean = leanOf(batchFor(belt, kind, 0), 3);
      expect(lean).toHaveLength(3);
      for (const each of lean) expect(each, kind).toBeGreaterThan(0);
    }
    belt.dispose();
  });

  it('keeps a mesh’s model alone when one of its folds cannot be read', async () => {
    // A building's fold is its setting's by INDEX: a list with a hole in it
    // would draw a suburban lot as the commercial building. All or none.
    const missing = STYLISED_FOLD_MODELS.building?.[0]?.[1]?.url;
    expect(missing).toBeDefined();
    await loadByShape({ ...(missing === undefined ? {} : { missing }) });
    const belt = batchedBelt();

    // The first mesh is its model, instanced; the other two lose nothing.
    expect(belt.meshesOf('building')).toHaveLength(1);
    expect(trianglesOf(meshFor(belt, 'building').geometry)).toBe(SHAPE_TRIANGLES[0]);
    expect(belt.batchesOf('building')).toHaveLength(2);
    expect(belt.batchesOf('rock')).toHaveLength(2);
    // And a commercial lot on that mesh is drawn, as the one shape it has.
    belt.update([item({ kind: 'building', lotSetting: 'commercial', variant: 0 })], POSE);
    expect(meshFor(belt, 'building').count).toBe(1);
    expect(belt.drawnItems).toBe(1);
    belt.dispose();
  });

  it('CONTROL: with the folds switched off, reads the models alone', async () => {
    setStylisedFolds(false);
    const asked: string[] = [];
    await loadByShape({ asked });
    const belt = batchedBelt();

    expect(asked).toHaveLength(Object.values(SCENERY_MODELS).flat().length);
    for (const each of FOLDED) expect(asked).not.toContain(each.model.url);
    for (const kind of SCENERY_KINDS) expect(belt.batchesOf(kind), kind).toHaveLength(0);
    belt.dispose();
  });
});

describe('#3287 the belt a view builds where the driver has multi-draw', () => {
  it('holds every shape in the meshes it had: no mesh, so no draw call, is added', async () => {
    await loadByShape();
    const belt = batchedBelt();

    expect(MESHES_WITH_EVERY_MODEL).toBe(4 * 2 + 3 + 1 + 4 * 2 + 4);
    let batches = 0;
    for (const kind of SCENERY_KINDS) {
      const meshes = belt.meshesOf(kind).length + belt.batchesOf(kind).length;
      expect(meshes, kind).toBe(
        SCENERY_MODELS[kind]?.length ?? (isBuiltKind(kind) ? BUILDING_VARIANTS : 1),
      );
      batches += belt.batchesOf(kind).length;
    }
    // Nine of the twenty-four hold several shapes: three buildings, and two
    // each of broadleaf, conifer and stone.
    expect(batches).toBe(9);
    expect(belt.meshes.size + batches).toBe(MESHES_WITH_EVERY_MODEL);
    belt.dispose();
  });

  it('holds each mesh’s model and the files beside it as shapes of their own', async () => {
    await loadByShape();
    const belt = batchedBelt();

    for (const [kind, meshes] of Object.entries(STYLISED_FOLD_MODELS) as [
      SceneryKind,
      readonly (readonly SceneryModel[])[],
    ][]) {
      meshes.forEach((folds, mesh) => {
        const batch = batchFor(belt, kind, mesh);
        for (let shape = 0; shape <= folds.length; shape += 1) {
          expect(shapeTriangles(batch, shape), `${kind} ${String(mesh)} ${String(shape)}`).toBe(
            SHAPE_TRIANGLES[shape],
          );
        }
        // And no shape past the last file.
        expect(() => rangeOf(batch, folds.length + 1)).toThrow();
      });
    }
    // A kind with nothing beside its model is instanced, as it was.
    for (const kind of ['shrub', 'post', 'barn'] as const) {
      expect(belt.batchesOf(kind), kind).toHaveLength(0);
      expect(belt.meshesOf(kind).length, kind).toBeGreaterThan(0);
    }
    belt.dispose();
  });

  it('writes each building the shape its setting names, and no tint', async () => {
    await loadByShape();
    const belt = batchedBelt();
    const houses = [
      item({ kind: 'building', x: -6 }),
      item({ kind: 'building', x: -2, lotSetting: 'suburban' }),
      item({ kind: 'building', x: 2, lotSetting: 'commercial' }),
      item({ kind: 'building', x: 6, lotSetting: 'rural' }),
    ];
    belt.update(houses, POSE);

    const batch = batchFor(belt, 'building', 0);
    expect(belt.batchedCount(batch)).toBe(4);
    expect(belt.drawnItems).toBe(4);
    expect(batch.visible).toBe(true);
    expect([0, 1, 2, 3].map((at) => batch.getGeometryIdAt(at))).toEqual([0, 1, 2, 0]);
    expect([0, 1, 2, 3].map((at) => batch.getVisibleAt(at))).toEqual([true, true, true, true]);
    // A building is not tinted: its batch's colours are all white.
    for (const at of [0, 1, 2, 3]) expect(tintOf(batch, at)).toEqual([1, 1, 1]);
    belt.dispose();
  });

  it('submits one shape’s triangles an instance, and never its mesh’s three', async () => {
    // What the fold this replaced got wrong: every instance submitted every
    // shape its mesh held, so a house cost three houses.
    await loadByShape();
    const belt = batchedBelt();
    const [rural, suburban, commercial] = SHAPE_TRIANGLES as [number, number, number];
    const batch = batchFor(belt, 'building', 0);

    belt.update([item({ kind: 'building', x: -6 })], POSE);
    expect(submittedBy(belt, batch)).toBe(rural);
    belt.update([item({ kind: 'building', x: -6, lotSetting: 'commercial' })], POSE);
    expect(submittedBy(belt, batch)).toBe(commercial);
    belt.update(
      [
        item({ kind: 'building', x: -6 }),
        item({ kind: 'building', x: -2, lotSetting: 'suburban' }),
        item({ kind: 'building', x: 2, lotSetting: 'suburban' }),
        item({ kind: 'building', x: 6, lotSetting: 'commercial' }),
      ],
      POSE,
    );
    expect(submittedBy(belt, batch)).toBe(rural + 2 * suburban + commercial);
    expect(submittedBy(belt, batch)).toBeLessThan(4 * (rural + suburban + commercial));
    belt.dispose();
  });

  it('writes each tree the shape and the tint of where it stands', async () => {
    await loadByShape();
    const belt = batchedBelt();
    const trees = Array.from({ length: 40 }, (_, at) =>
      item({ kind: 'tree-broadleaf', x: -8 + (at % 5) * 4, z: 10 + at * 3, variant: 0 }),
    );
    belt.update(trees, POSE);

    const batch = batchFor(belt, 'tree-broadleaf', 0);
    expect(belt.batchedCount(batch)).toBe(40);
    const expected = new Float32Array(3);
    const drawn = new Set<number>();
    const tints = new Set<string>();
    trees.forEach((tree, at) => {
      const shape = batch.getGeometryIdAt(at);
      expect(shape).toBe(stylisedFoldOf(tree, 3));
      drawn.add(shape);
      writeStylisedTint(tree.kind, tree.x, tree.z, expected, 0);
      const tint = tintOf(batch, at) ?? [];
      expect(tint).toHaveLength(3);
      tint.forEach((channel, each) => {
        expect(channel).toBeCloseTo(expected[each] as number, 6);
      });
      expect(Math.min(...tint)).toBeLessThan(1);
      tints.add(tint.map((channel) => channel.toFixed(5)).join());
    });
    // All three shapes of the mesh stand in the row, and no two trees are one colour.
    expect(drawn).toEqual(new Set([0, 1, 2]));
    expect(tints.size).toBe(40);
    belt.dispose();
  });

  it('draws this frame’s items and none of the last frame’s', async () => {
    await loadByShape();
    const belt = batchedBelt();
    const rocks = Array.from({ length: 5 }, (_, at) => item({ kind: 'rock', x: at - 2, z: 12 }));
    const batch = batchFor(belt, 'rock', 0);

    belt.update(rocks, POSE);
    expect(belt.batchedCount(batch)).toBe(5);
    belt.update(rocks.slice(0, 2), POSE);
    expect(belt.batchedCount(batch)).toBe(2);
    expect(belt.drawnItems).toBe(2);
    // The pool is the five the first frame needed, not seven: a count that is
    // not rewound each frame grows the pool without end.
    expect(batch.instanceCount).toBe(5);
    expect([0, 1, 2, 3, 4].map((at) => batch.getVisibleAt(at))).toEqual([
      true,
      true,
      false,
      false,
      false,
    ]);
    // And a frame with none of the kind hides the mesh, so it is no draw call.
    belt.update([], POSE);
    expect(belt.batchedCount(batch)).toBe(0);
    expect(batch.visible).toBe(false);
    belt.update(rocks.slice(0, 2), POSE);
    expect(batch.instanceCount).toBe(5);
    belt.dispose();
  });

  it('never lets three cull a batch whole: its sphere is taken once, at the first frame', async () => {
    await loadByShape();
    const belt = batchedBelt();
    const batches = SCENERY_KINDS.flatMap((kind) => belt.batchesOf(kind));
    expect(batches).toHaveLength(9);
    for (const batch of batches) expect(batch.frustumCulled).toBe(false);
    belt.dispose();
  });

  it('keeps room for every instance when a frame outgrows the belt', async () => {
    await loadByShape();
    const belt = batchedBelt();
    const batch = batchFor(belt, 'tree-conifer', 0);
    const many = batch.maxInstanceCount + 50;
    belt.update(
      Array.from({ length: many }, (_, at) =>
        item({ kind: 'tree-conifer', x: (at % 9) - 4, z: 5 + at * 0.4 }),
      ),
      { ...POSE },
    );
    const drawn = belt.batchedCount(batch);
    expect(drawn).toBeGreaterThan(0);
    expect(batch.maxInstanceCount).toBeGreaterThanOrEqual(drawn);
    // The last instance drawn was written, past where the first belt ended.
    expect(batch.getVisibleAt(drawn - 1)).toBe(true);
    expect([0, 1, 2]).toContain(batch.getGeometryIdAt(drawn - 1));
    const tint = tintOf(batch, drawn - 1) ?? [];
    expect(Math.max(...tint)).toBeLessThanOrEqual(1);
    expect(Math.min(...tint)).toBeGreaterThan(0.5);
    belt.dispose();
  });

  it('can be shown before it draws anything, so its program is linked before a ride', async () => {
    await loadByShape();
    const belt = batchedBelt();
    const batches = SCENERY_KINDS.flatMap((kind) => belt.batchesOf(kind));
    expect(batches).toHaveLength(9);
    for (const batch of batches) expect(batch.visible).toBe(false);

    belt.warm();
    for (const batch of batches) {
      expect(batch.visible).toBe(true);
      // Shown, and still nothing of it drawn — and with a colour table already.
      expect(belt.batchedCount(batch)).toBe(0);
      expect(batch.getVisibleAt(0)).toBe(false);
      expect(tintOf(batch, 0)).toEqual([1, 1, 1]);
    }
    // The next frame decides again.
    belt.update([item({ kind: 'rock', x: 1, z: 12 })], POSE);
    expect(batches.filter((batch) => batch.visible)).toHaveLength(1);
    // And a belt that is not shown at all stays hidden.
    belt.setShown(false);
    belt.warm();
    for (const batch of batches) expect(batch.visible).toBe(false);
    belt.dispose();
  });

  it('wears the shading the belt is set to, with every other mesh', async () => {
    await loadByShape();
    const belt = batchedBelt();
    const batch = batchFor(belt, 'building', 1);
    const worn = new Set<unknown>();
    for (const shading of ['lit', 'flat'] as const) {
      belt.setShading(shading);
      expect(batch.material).toBe(meshFor(belt, 'shrub').material);
      expect(readsStylisedInstances(batch.material as never)).toBe(true);
      worn.add(batch.material);
    }
    expect(worn.size).toBe(2);
    belt.dispose();
  });

  it('gives each belt its own copy, so a teardown does not empty the next ride', async () => {
    await loadByShape();
    const first = batchedBelt();
    first.dispose();
    const second = batchedBelt();

    const batch = batchFor(second, 'building', 2);
    expect([0, 1, 2].map((shape) => shapeTriangles(batch, shape))).toEqual(SHAPE_TRIANGLES);
    second.update([item({ kind: 'building', variant: 2, lotSetting: 'suburban' })], POSE);
    expect(submittedBy(second, batch)).toBe(SHAPE_TRIANGLES[1]);
    second.dispose();
  });
});

describe('#3287 the belt a view builds where the driver has NO multi-draw', () => {
  it('draws each mesh’s own model alone, instanced, whatever the setting', async () => {
    // three draws a `BatchedMesh` one call an INSTANCE without the extension.
    // So such a belt builds none: a rider loses variety, never an item, and
    // the draw calls are what they were.
    await loadByShape();
    for (const belt of [new ScatterBelt(), new ScatterBelt(undefined, { batched: false })]) {
      expect(belt.meshes.size).toBe(MESHES_WITH_EVERY_MODEL);
      for (const kind of SCENERY_KINDS) expect(belt.batchesOf(kind), kind).toHaveLength(0);
      for (const kind of Object.keys(STYLISED_FOLD_MODELS) as SceneryKind[]) {
        for (const mesh of belt.meshesOf(kind)) {
          expect(trianglesOf(mesh.geometry), kind).toBe(SHAPE_TRIANGLES[0]);
        }
      }
      belt.update(
        [
          item({ kind: 'building', x: -4, lotSetting: 'commercial' }),
          item({ kind: 'building', x: 4, lotSetting: 'suburban' }),
          item({ kind: 'tree-broadleaf', x: -3 }),
        ],
        POSE,
      );
      expect(meshFor(belt, 'building').count).toBe(2);
      expect(meshFor(belt, 'tree-broadleaf').count).toBe(1);
      expect(belt.drawnItems).toBe(3);
      belt.dispose();
    }
  });

  it('still tints a tree, through the instance attribute', async () => {
    await loadByShape();
    const belt = new ScatterBelt();
    belt.update([item({ kind: 'tree-conifer', x: 2, z: 30 })], POSE);

    const expected = new Float32Array(3);
    writeStylisedTint('tree-conifer', 2, 30, expected, 0);
    const carried = meshFor(belt, 'tree-conifer').geometry.getAttribute(
      STYLISED_INSTANCE_ATTRIBUTE,
    );
    expect(carried.itemSize).toBe(3);
    [carried.getX(0), carried.getY(0), carried.getZ(0)].forEach((off, each) => {
      expect(1 - off).toBeCloseTo(expected[each] as number, 6);
    });
    belt.dispose();
  });

  it('builds no batch for the realistic world, whatever the driver has', async () => {
    await loadByShape();
    const physical = new ScatterBelt(new Map(), { physical: true, batched: true });
    for (const kind of SCENERY_KINDS) expect(physical.batchesOf(kind), kind).toHaveLength(0);
    for (const mesh of physical.meshes.values()) {
      expect(readsStylisedInstances(mesh.material as never)).toBe(false);
      expect(mesh.geometry.getAttribute(STYLISED_INSTANCE_ATTRIBUTE)).toBeUndefined();
    }
    physical.dispose();
  });
});

describe('#3287 a kind of one shape', () => {
  it('tints a shrub, and gives a barn no buffer at all', async () => {
    await loadByShape();
    const belt = batchedBelt();
    belt.update([item({ kind: 'shrub', x: 2, z: 30 }), item({ kind: 'barn', x: -4 })], POSE);

    const expected = new Float32Array(3);
    writeStylisedTint('shrub', 2, 30, expected, 0);
    const carried = meshFor(belt, 'shrub').geometry.getAttribute(STYLISED_INSTANCE_ATTRIBUTE);
    const tint = [1 - carried.getX(0), 1 - carried.getY(0), 1 - carried.getZ(0)];
    tint.forEach((channel, each) => {
      expect(channel).toBeCloseTo(expected[each] as number, 6);
    });
    expect(Math.min(...tint)).toBeLessThan(1);
    expect((carried as unknown as { readonly version: number }).version).toBeGreaterThan(0);
    // No tint: drawn from the attribute's default, with no buffer for it.
    for (const kind of ['barn', 'post', 'wall', 'church'] as const) {
      const mesh = meshFor(belt, kind);
      expect(mesh.geometry.getAttribute(STYLISED_INSTANCE_ATTRIBUTE), kind).toBeUndefined();
      expect(mesh.instanceColor, kind).toBeNull();
    }
    expect(meshFor(belt, 'barn').count).toBe(1);
    belt.dispose();
  });

  it('draws a kind’s primitive when no model loaded, whatever the setting', () => {
    const belt = batchedBelt();
    belt.update(
      [
        item({ kind: 'building', lotSetting: 'commercial' }),
        item({ kind: 'tree-broadleaf', x: -3 }),
      ],
      POSE,
    );
    expect(belt.batchesOf('building')).toHaveLength(0);
    expect(meshFor(belt, 'building').count).toBe(1);
    expect(
      meshFor(belt, 'building').geometry.getAttribute(STYLISED_INSTANCE_ATTRIBUTE),
    ).toBeUndefined();
    expect(meshFor(belt, 'tree-broadleaf').count).toBe(1);
    belt.dispose();
  });

  it('keeps room for every instance’s tint when a frame outgrows the belt', async () => {
    await loadByShape();
    const belt = batchedBelt();
    const mesh = meshFor(belt, 'shrub', 0);
    const many = mesh.instanceMatrix.count + 50;
    belt.update(
      Array.from({ length: many }, (_, at) =>
        item({ kind: 'shrub', x: (at % 9) - 4, z: 5 + at * 0.4 }),
      ),
      { ...POSE },
    );
    expect(mesh.count).toBeGreaterThan(0);
    const carried = mesh.geometry.getAttribute(STYLISED_INSTANCE_ATTRIBUTE);
    expect(carried.itemSize).toBe(3);
    expect(carried.count).toBeGreaterThanOrEqual(mesh.count);
    const last = 1 - carried.getY(mesh.count - 1);
    expect(last).toBeLessThanOrEqual(1);
    expect(last).toBeGreaterThan(0.5);
    belt.dispose();
  });

  it('wears the rule lit and unlit', () => {
    const belt = new ScatterBelt();
    for (const shading of ['lit', 'flat'] as const) {
      belt.setShading(shading);
      for (const mesh of belt.meshes.values()) {
        expect(readsStylisedInstances(mesh.material as never), shading).toBe(true);
      }
    }
    belt.dispose();
  });
});

describe('#3287 the vertex rule', () => {
  const program = new GlslProgram(STYLISED_INSTANCE_GLSL);

  it('takes the tint off the vertex’s own colour', () => {
    const colour = [0.2, 0.8, 0.6];
    const tinted = program.call('oylTinted', colour, [0.1, 0.25, 0]) as number[];
    expect(tinted[0]).toBeCloseTo(0.18, 9);
    expect(tinted[1]).toBeCloseTo(0.6, 9);
    expect(tinted[2]).toBeCloseTo(0.6, 9);
  });

  it('draws a mesh that carries nothing untinted', () => {
    // What a driver reads for an attribute a geometry does not carry: nought.
    expect(program.call('oylTinted', [0.2, 0.8, 0.6], [0, 0, 0])).toEqual([0.2, 0.8, 0.6]);
  });

  it('is spliced into the program of both materials, at the colour', () => {
    const belt = new ScatterBelt();
    for (const shading of ['lit', 'flat'] as const) {
      belt.setShading(shading);
      const material = meshFor(belt, 'rock').material as unknown as {
        onBeforeCompile(shader: unknown, renderer: unknown): void;
        customProgramCacheKey(): string;
      };
      const shader = {
        uniforms: {},
        vertexShader:
          '#include <common>\nvoid main() {\n#include <color_vertex>\n#include <begin_vertex>\n}',
        fragmentShader: '',
      };
      material.onBeforeCompile(shader, undefined);
      expect(shader.vertexShader).toContain(`attribute vec3 ${STYLISED_INSTANCE_ATTRIBUTE};`);
      expect(shader.vertexShader).toContain(STYLISED_INSTANCE_GLSL);
      expect(shader.vertexShader).toContain(
        `#include <color_vertex>\nvColor.rgb = oylTinted(vColor.rgb, ${STYLISED_INSTANCE_ATTRIBUTE});`,
      );
      // The position is three's own: no shape is folded away in the shader now.
      expect(shader.vertexShader).toContain('#include <begin_vertex>\n}');
      // A program of its own: three must not hand it a stock one compiled without the rule.
      expect(material.customProgramCacheKey()).toContain('oyl-stylised-instances');
      // And loudly, if three's program ever loses a place it is spliced at.
      expect(() =>
        material.onBeforeCompile(
          { uniforms: {}, vertexShader: 'void main() {}', fragmentShader: '' },
          undefined,
        ),
      ).toThrow(/#3287/);
    }
    belt.dispose();
  });
});
