// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #3287: the stylised belt draws several shapes with one mesh — the geometry
 * `three-renderer.ts` folds them into, the shape and the tint it writes each
 * instance, and the vertex rule that draws the one an instance is.
 *
 * Read through the belt a view builds (`new ScatterBelt()`, after
 * `loadSceneryModels`), which is the path a ride takes. What this cannot say
 * is that a driver compiles the rule and draws one shape and not three:
 * `game.browser.spec.ts` §"#3287" reads that back off the pixels.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { BUILDING_VARIANTS, isBuiltKind } from './buildings';
import { CAMERA_TARGET_AHEAD_METRES } from './camera';
import { GlslProgram } from './glsl-program-testing';
import type { CameraPose } from './port';
import { SCENERY_KINDS, type ScatterItem, type SceneryKind } from './scatter';
import { SCENERY_MODELS } from './scenery-models';
import {
  STYLISED_FOLDS,
  stylisedFoldOf,
  writeStylisedTint,
  type GeneratedShape,
} from './stylised-shapes';
import {
  STYLISED_INSTANCE_ATTRIBUTE,
  STYLISED_INSTANCE_GLSL,
  STYLISED_SHAPE_ATTRIBUTE,
  ScatterBelt,
  foldedSceneryGeometry,
  readsStylisedInstances,
  generatedSceneryGeometry,
  loadSceneryModels,
  prepareSceneryGeometry,
  sceneryFitMetres,
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
type Geometry = Mesh['geometry'];

function meshFor(belt: ScatterBelt, kind: SceneryKind, variant = 0): Mesh {
  const mesh = belt.meshesOf(kind)[variant];
  if (mesh === undefined) throw new Error(`no mesh for ${kind} ${String(variant)}`);
  return mesh;
}

function verticesOf(geometry: Geometry): number {
  return geometry.getAttribute('position').count;
}

function trianglesOf(geometry: Geometry): number {
  return (geometry.index?.count ?? verticesOf(geometry)) / 3;
}

/** How many vertices carry each shape's mark, by mark. */
function marksOf(geometry: Geometry): number[] {
  const marks = geometry.getAttribute(STYLISED_SHAPE_ATTRIBUTE) as
    ReturnType<Geometry['getAttribute']> | undefined;
  // No marks at all is the one shape a driver reads nought for.
  if (marks === undefined) return [verticesOf(geometry)];
  const counts: number[] = [];
  for (let at = 0; at < marks.count; at += 1) {
    const mark = marks.getX(at);
    counts[mark] = (counts[mark] ?? 0) + 1;
  }
  return counts;
}

/** What one instance carries, read back as the shape it is and the tint it wears. */
function instanceOf(mesh: Mesh, at: number): { shape: number; tint: number[] } {
  const carried = mesh.geometry.getAttribute(STYLISED_INSTANCE_ATTRIBUTE);
  return {
    shape: carried.getW(at) - 1,
    tint: [1 - carried.getX(at), 1 - carried.getY(at), 1 - carried.getZ(at)],
  };
}

/** A stand-in for a loaded glTF scene of one part. @see three-renderer.test.ts §sceneOf */
function sceneOf(
  geometry: Geometry,
  matrixWorld: unknown,
): Parameters<typeof prepareSceneryGeometry>[0] {
  return {
    updateWorldMatrix: () => undefined,
    traverse: (visit: (node: unknown) => void) => {
      visit({ isMesh: true, geometry, matrixWorld });
    },
  } as unknown as Parameters<typeof prepareSceneryGeometry>[0];
}

/** A "model" of a kind: a primitive of another, prepared as a file's shape is. */
function modelOf(kind: SceneryKind, donor: SceneryKind): Geometry {
  const belt = new ScatterBelt();
  const mesh = meshFor(belt, donor);
  const prepared = prepareSceneryGeometry(sceneOf(mesh.geometry.clone(), mesh.matrixWorld), kind);
  belt.dispose();
  return prepared;
}

/** Loads every model in the table as `donor`'s primitive. */
async function loadEveryModelAs(donor: SceneryKind): Promise<void> {
  const belt = new ScatterBelt();
  const mesh = meshFor(belt, donor);
  await loadSceneryModels(() => Promise.resolve(sceneOf(mesh.geometry.clone(), mesh.matrixWorld)));
  belt.dispose();
}

/** A shape of two triangles, for a fold of the test's own. */
const SLIVER: GeneratedShape = {
  name: 'sliver',
  positions: Float32Array.of(0, 0, 0, 1, 0, 0, 0, 2, 0, 0, 0, 0, 0, 2, 0, 0, 0, 1),
  colours: new Float32Array(18).fill(0.5),
};

/** The meshes a belt holds when every model in the table loads: 24, the browser gate's ceiling. */
const MESHES_WITH_EVERY_MODEL = SCENERY_KINDS.reduce(
  (sum, kind) =>
    sum + (SCENERY_MODELS[kind]?.length ?? (isBuiltKind(kind) ? BUILDING_VARIANTS : 1)),
  0,
);

afterEach(async () => {
  // `loadSceneryModels` writes module state. @see three-renderer.test.ts
  await loadSceneryModels(() => Promise.reject(new Error('no models in this test')));
});

describe('#3287 several shapes in one geometry', () => {
  it('marks every vertex with the shape it belongs to, the model first', () => {
    for (const donor of ['tree-broadleaf', 'rock'] as const) {
      // A sphere is indexed and an octahedron is not: both ways a file may come.
      const model = modelOf('building', donor);
      const own = verticesOf(model);
      const ownTriangles = trianglesOf(model);
      const indexed = model.index !== null;
      const folded = foldedSceneryGeometry(model, [SLIVER, SLIVER], 'building');

      expect(marksOf(folded)).toEqual([own, 6, 6]);
      expect(trianglesOf(folded)).toBe(ownTriangles + 4);
      // A model's index is kept: its shared corners are not shaded twice.
      expect(folded.index !== null).toBe(indexed);
      expect(folded.getAttribute('color').count).toBe(own + 12);
      expect(folded.getAttribute('normal').count).toBe(own + 12);
      folded.dispose();
    }
  });

  it('CONTROL: with nothing to fold, the model is returned as it came', () => {
    const model = modelOf('rock', 'shrub');
    expect(foldedSceneryGeometry(model, [], 'rock')).toBe(model);
    expect(model.getAttribute(STYLISED_SHAPE_ATTRIBUTE)).toBeUndefined();
    model.dispose();
  });

  it('fits a shape from numbers into the room a model of its kind takes', () => {
    for (const [kind, meshes] of Object.entries(STYLISED_FOLDS) as [
      SceneryKind,
      readonly (readonly GeneratedShape[])[],
    ][]) {
      for (const shape of meshes.flat()) {
        const geometry = generatedSceneryGeometry(shape, kind);
        geometry.computeBoundingBox();
        const box = geometry.boundingBox;
        if (box === null) throw new Error('no box');
        const extents = [box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z];
        expect(Math.max(...extents), shape.name).toBeCloseTo(sceneryFitMetres(kind), 4);
        // On the ground, and centred on its place.
        expect(box.min.y, shape.name).toBeCloseTo(0, 5);
        expect(box.min.x + box.max.x, shape.name).toBeCloseTo(0, 4);
        expect(box.min.z + box.max.z, shape.name).toBeCloseTo(0, 4);
        expect(trianglesOf(geometry)).toBe(shape.positions.length / 9);
        geometry.dispose();
      }
    }
  });
});

describe('#3287 the belt a view builds', () => {
  it('holds every shape in the meshes it had: no mesh, so no draw call, is added', async () => {
    await loadEveryModelAs('tree-conifer');
    const belt = new ScatterBelt();

    expect(MESHES_WITH_EVERY_MODEL).toBe(4 * 2 + 3 + 1 + 4 * 2 + 4);
    expect(belt.meshes.size).toBe(MESHES_WITH_EVERY_MODEL);
    for (const kind of SCENERY_KINDS) {
      expect(belt.meshesOf(kind), kind).toHaveLength(
        SCENERY_MODELS[kind]?.length ?? (isBuiltKind(kind) ? BUILDING_VARIANTS : 1),
      );
    }
    belt.dispose();
  });

  it('draws each mesh with its model and the shapes folded in beside it', async () => {
    const donor = new ScatterBelt();
    const model = verticesOf(meshFor(donor, 'tree-conifer').geometry);
    donor.dispose();
    await loadEveryModelAs('tree-conifer');
    const belt = new ScatterBelt();

    for (const [kind, meshes] of Object.entries(STYLISED_FOLDS) as [
      SceneryKind,
      readonly (readonly GeneratedShape[])[],
    ][]) {
      meshes.forEach((folds, mesh) => {
        expect(marksOf(meshFor(belt, kind, mesh).geometry), `${kind} ${String(mesh)}`).toEqual([
          model,
          ...folds.map((shape) => shape.positions.length / 3),
        ]);
      });
    }
    // A kind with nothing folded in is its model alone, and carries no marks.
    for (const kind of ['shrub', 'post', 'barn'] as const) {
      expect(
        meshFor(belt, kind).geometry.getAttribute(STYLISED_SHAPE_ATTRIBUTE),
        kind,
      ).toBeUndefined();
    }
    expect(marksOf(meshFor(belt, 'shrub').geometry)).toEqual([model]);
    belt.dispose();
  });

  it('writes each building the shape its setting names, and no tint', async () => {
    await loadEveryModelAs('tree-conifer');
    const belt = new ScatterBelt();
    const houses = [
      item({ kind: 'building', x: -6 }),
      item({ kind: 'building', x: -2, setting: 'suburban' }),
      item({ kind: 'building', x: 2, setting: 'commercial' }),
      item({ kind: 'building', x: 6, setting: 'rural' }),
    ];
    belt.update(houses, POSE);

    const mesh = meshFor(belt, 'building', 0);
    expect(mesh.count).toBe(4);
    expect([0, 1, 2, 3].map((at) => instanceOf(mesh, at))).toEqual([
      { shape: 0, tint: [1, 1, 1] },
      { shape: 1, tint: [1, 1, 1] },
      { shape: 2, tint: [1, 1, 1] },
      { shape: 0, tint: [1, 1, 1] },
    ]);
    // And it is the instance attribute the frame uploads.
    const carried = mesh.geometry.getAttribute(STYLISED_INSTANCE_ATTRIBUTE);
    expect((carried as unknown as { readonly version: number }).version).toBeGreaterThan(0);
    belt.dispose();
  });

  it('writes each tree the shape and the tint of where it stands', async () => {
    await loadEveryModelAs('rock');
    const belt = new ScatterBelt();
    const trees = Array.from({ length: 40 }, (_, at) =>
      item({ kind: 'tree-broadleaf', x: -8 + (at % 5) * 4, z: 10 + at * 3, variant: 0 }),
    );
    belt.update(trees, POSE);

    const mesh = meshFor(belt, 'tree-broadleaf', 0);
    expect(mesh.count).toBe(40);
    const expected = new Float32Array(3);
    const drawn = new Set<number>();
    const tints = new Set<string>();
    trees.forEach((tree, at) => {
      const { shape, tint } = instanceOf(mesh, at);
      expect(shape).toBe(stylisedFoldOf(tree, 2));
      drawn.add(shape);
      writeStylisedTint(tree.kind, tree.x, tree.z, expected, 0);
      tint.forEach((channel, each) => {
        // Carried as what it takes off, in single precision.
        expect(channel).toBeCloseTo(expected[each] as number, 6);
      });
      tints.add(tint.map((channel) => channel.toFixed(5)).join());
    });
    // Both shapes of the mesh stand in the row, and no two trees are one colour.
    expect(drawn).toEqual(new Set([0, 1]));
    expect(tints.size).toBe(40);
    belt.dispose();
  });

  it('tints a shrub, which has one shape, and gives a barn no buffer at all', async () => {
    await loadEveryModelAs('rock');
    const belt = new ScatterBelt();
    belt.update([item({ kind: 'shrub', x: 2, z: 30 }), item({ kind: 'barn', x: -4 })], POSE);

    const expected = new Float32Array(3);
    writeStylisedTint('shrub', 2, 30, expected, 0);
    const shrub = instanceOf(meshFor(belt, 'shrub'), 0);
    expect(shrub.shape).toBe(0);
    shrub.tint.forEach((channel, each) => {
      expect(channel).toBeCloseTo(expected[each] as number, 6);
    });
    expect(Math.min(...shrub.tint)).toBeLessThan(1);
    // One shape and no tint: drawn from the attribute's default, with no buffer for it.
    for (const kind of ['barn', 'post', 'wall', 'church'] as const) {
      const mesh = meshFor(belt, kind);
      expect(mesh.geometry.getAttribute(STYLISED_INSTANCE_ATTRIBUTE), kind).toBeUndefined();
      expect(mesh.instanceColor, kind).toBeNull();
    }
    expect(meshFor(belt, 'barn').count).toBe(1);
    belt.dispose();
  });

  it('draws the one shape a mesh has when no model loaded, whatever the setting', () => {
    // No model: every kind is its primitive, one shape a mesh. A commercial
    // lot told to be a third shape there would be folded away — an item the
    // plan placed and the screen never showed.
    const belt = new ScatterBelt();
    belt.update(
      [item({ kind: 'building', setting: 'commercial' }), item({ kind: 'tree-broadleaf', x: -3 })],
      POSE,
    );
    const house = meshFor(belt, 'building');
    expect(house.count).toBe(1);
    expect(marksOf(house.geometry)).toHaveLength(1);
    // A building of one shape carries nothing, and is drawn from the default: the first shape.
    expect(house.geometry.getAttribute(STYLISED_INSTANCE_ATTRIBUTE)).toBeUndefined();
    const tree = meshFor(belt, 'tree-broadleaf');
    expect(tree.count).toBe(1);
    expect(marksOf(tree.geometry)).toHaveLength(1);
    expect(instanceOf(tree, 0).shape).toBe(0);
    belt.dispose();
  });

  it('keeps room for every instance’s shape and tint when a frame outgrows the belt', async () => {
    await loadEveryModelAs('rock');
    const belt = new ScatterBelt();
    const mesh = meshFor(belt, 'tree-conifer', 0);
    const many = mesh.instanceMatrix.count + 50;
    belt.update(
      Array.from({ length: many }, (_, at) =>
        item({ kind: 'tree-conifer', x: (at % 9) - 4, z: 5 + at * 0.4 }),
      ),
      { ...POSE },
    );
    expect(mesh.count).toBeGreaterThan(0);
    const carried = mesh.geometry.getAttribute(STYLISED_INSTANCE_ATTRIBUTE);
    expect(carried.itemSize).toBe(4);
    expect(carried.count).toBeGreaterThanOrEqual(mesh.count);
    // The last instance drawn was written, past where the first buffer ended.
    const last = instanceOf(mesh, mesh.count - 1);
    expect(last.shape === 0 || last.shape === 1).toBe(true);
    expect(Math.max(...last.tint)).toBeLessThanOrEqual(1);
    expect(Math.min(...last.tint)).toBeGreaterThan(0.5);
    belt.dispose();
  });

  it('wears the rule lit and unlit, and the realistic belt neither', () => {
    const belt = new ScatterBelt();
    for (const shading of ['lit', 'flat'] as const) {
      belt.setShading(shading);
      for (const mesh of belt.meshes.values()) {
        expect(readsStylisedInstances(mesh.material as never), shading).toBe(true);
      }
    }
    belt.dispose();
    // CONTROL: the realistic world's primitives belt is untaught and carries nothing.
    const physical = new ScatterBelt(new Map(), { physical: true });
    for (const mesh of physical.meshes.values()) {
      expect(readsStylisedInstances(mesh.material as never)).toBe(false);
      expect(mesh.geometry.getAttribute(STYLISED_SHAPE_ATTRIBUTE)).toBeUndefined();
      expect(mesh.geometry.getAttribute(STYLISED_INSTANCE_ATTRIBUTE)).toBeUndefined();
    }
    physical.dispose();
  });
});

describe('#3287 the vertex rule', () => {
  const program = new GlslProgram(STYLISED_INSTANCE_GLSL);

  it('folds away the shapes an instance is not, and keeps the one it is', () => {
    for (const shape of [0, 1, 2]) {
      for (const instance of [0, 1, 2]) {
        // The instance carries one more than its shape.
        expect(
          program.call('oylShapeIs', shape, 1 + instance),
          `${String(shape)} ${String(instance)}`,
        ).toBe(shape === instance ? 1 : 0);
      }
    }
  });

  it('takes the tint off the vertex’s own colour', () => {
    const colour = [0.2, 0.8, 0.6];
    const tinted = program.call('oylTinted', colour, [0.1, 0.25, 0]) as number[];
    expect(tinted[0]).toBeCloseTo(0.18, 9);
    expect(tinted[1]).toBeCloseTo(0.6, 9);
    expect(tinted[2]).toBeCloseTo(0.6, 9);
  });

  it('draws a mesh that carries nothing as its first shape, untinted', () => {
    // What a driver reads for an attribute a geometry does not carry:
    // (0, 0, 0, 1), and nought for the vertex's mark.
    expect(program.call('oylShapeIs', 0, 1)).toBe(1);
    expect(program.call('oylTinted', [0.2, 0.8, 0.6], [0, 0, 0])).toEqual([0.2, 0.8, 0.6]);
  });

  it('is spliced into the program of both materials, at the colour and at the position', () => {
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
      expect(shader.vertexShader).toContain(`attribute float ${STYLISED_SHAPE_ATTRIBUTE};`);
      expect(shader.vertexShader).toContain(`attribute vec4 ${STYLISED_INSTANCE_ATTRIBUTE};`);
      expect(shader.vertexShader).toContain(STYLISED_INSTANCE_GLSL);
      expect(shader.vertexShader).toContain(
        `#include <color_vertex>\nvColor.rgb = oylTinted(vColor.rgb, ${STYLISED_INSTANCE_ATTRIBUTE}.xyz);`,
      );
      expect(shader.vertexShader).toContain(
        `#include <begin_vertex>\ntransformed *= oylShapeIs(${STYLISED_SHAPE_ATTRIBUTE}, ${STYLISED_INSTANCE_ATTRIBUTE}.w);`,
      );
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
