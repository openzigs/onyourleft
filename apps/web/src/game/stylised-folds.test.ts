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
import { SCENERY_MODELS, STYLISED_FOLD_MODELS, type SceneryModel } from './scenery-models';
import { stylisedFoldOf, writeStylisedTint } from './stylised-shapes';
import {
  STYLISED_INSTANCE_ATTRIBUTE,
  STYLISED_INSTANCE_GLSL,
  STYLISED_SHAPE_ATTRIBUTE,
  ScatterBelt,
  foldedSceneryGeometry,
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
 * A scene whose shape has a front: `donor`'s primitive with its highest
 * corners pushed toward +z, so which way a loaded shape faces can be read
 * back off it. @see leanOf
 */
function leaningSceneOf(donor: SceneryKind): Parameters<typeof prepareSceneryGeometry>[0] {
  const belt = new ScatterBelt();
  const mesh = meshFor(belt, donor);
  const geometry = mesh.geometry.clone();
  const position = geometry.getAttribute('position');
  let top = Number.NEGATIVE_INFINITY;
  for (let at = 0; at < position.count; at += 1) top = Math.max(top, position.getY(at));
  for (let at = 0; at < position.count; at += 1) {
    if (position.getY(at) > top - 1e-6) position.setZ(at, position.getZ(at) + 5);
  }
  const scene = sceneOf(geometry, mesh.matrixWorld);
  belt.dispose();
  return scene;
}

/** Which way each of a geometry's shapes leans: the z of its highest corner, by mark. */
function leanOf(geometry: Geometry): number[] {
  const position = geometry.getAttribute('position');
  const marks = geometry.getAttribute(STYLISED_SHAPE_ATTRIBUTE) as
    ReturnType<Geometry['getAttribute']> | undefined;
  const highest: number[] = [];
  const lean: number[] = [];
  for (let at = 0; at < position.count; at += 1) {
    const mark = marks === undefined ? 0 : marks.getX(at);
    if (position.getY(at) > (highest[mark] ?? Number.NEGATIVE_INFINITY)) {
      highest[mark] = position.getY(at);
      lean[mark] = position.getZ(at);
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

describe('#3287 several shapes in one geometry', () => {
  it('marks every vertex with the shape it belongs to, the model first', () => {
    for (const donor of ['tree-broadleaf', 'rock'] as const) {
      // A sphere is indexed and an octahedron is not: both ways a file may come.
      const model = modelOf('building', donor);
      const first = modelOf('building', donor);
      const second = modelOf('building', donor);
      const own = verticesOf(model);
      const ownTriangles = trianglesOf(model);
      const indexed = model.index !== null;
      const folded = foldedSceneryGeometry(model, [first, second]);

      expect(marksOf(folded)).toEqual([own, own, own]);
      expect(trianglesOf(folded)).toBe(ownTriangles * 3);
      // An index every part has is kept: shared corners are not shaded twice.
      expect(folded.index !== null).toBe(indexed);
      expect(folded.getAttribute('color').count).toBe(own * 3);
      expect(folded.getAttribute('normal').count).toBe(own * 3);
      folded.dispose();
    }
  });

  it('folds a file with an index beside one without, and loses no triangle', () => {
    // One kit's files need not agree with another's about being indexed.
    const indexed = modelOf('building', 'tree-broadleaf');
    const plain = modelOf('building', 'rock');
    expect(indexed.index).not.toBeNull();
    expect(plain.index).toBeNull();
    const triangles = trianglesOf(indexed) + trianglesOf(plain);
    const plainVertices = verticesOf(plain);
    const folded = foldedSceneryGeometry(indexed, [plain]);

    expect(folded.index).toBeNull();
    expect(trianglesOf(folded)).toBe(triangles);
    expect(marksOf(folded)).toEqual([verticesOf(folded) - plainVertices, plainVertices]);
    folded.dispose();
  });

  it('CONTROL: with nothing to fold, the model is returned as it came', () => {
    const model = modelOf('rock', 'shrub');
    expect(foldedSceneryGeometry(model, [])).toBe(model);
    expect(model.getAttribute(STYLISED_SHAPE_ATTRIBUTE)).toBeUndefined();
    model.dispose();
  });
});

describe('#3287 the files a load folds in', () => {
  it('reads every model and every folded file once, through the loader a ride uses', async () => {
    const asked: string[] = [];
    const donor = new ScatterBelt();
    const mesh = meshFor(donor, 'rock');
    await loadSceneryModels((url) => {
      asked.push(url);
      return Promise.resolve(sceneOf(mesh.geometry.clone(), mesh.matrixWorld));
    });
    donor.dispose();

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
    await loadSceneryModels(() => Promise.resolve(leaningSceneOf('rock')));
    const belt = new ScatterBelt();

    for (const mesh of [0, 1, 2]) {
      const [own, suburban, commercial] = leanOf(meshFor(belt, 'building', mesh).geometry);
      expect(own, `building ${String(mesh)}`).toBeGreaterThan(0.5);
      expect(suburban, `building ${String(mesh)}`).toBeCloseTo(-(own as number), 4);
      expect(commercial, `building ${String(mesh)}`).toBeCloseTo(-(own as number), 4);
    }
    // CONTROL: a tree and a stone have no front, and are folded in as they come.
    for (const kind of ['tree-broadleaf', 'tree-conifer', 'rock'] as const) {
      const lean = leanOf(meshFor(belt, kind, 0).geometry);
      expect(lean).toHaveLength(3);
      for (const each of lean) expect(each, kind).toBeCloseTo(lean[0] as number, 4);
      expect(lean[0], kind).toBeGreaterThan(0);
    }
    belt.dispose();
  });

  it('keeps a mesh’s model alone when one of its folds cannot be read', async () => {
    // A building's fold is its setting's by INDEX: a list with a hole in it
    // would draw a suburban lot as the commercial building. All or none.
    const missing = STYLISED_FOLD_MODELS.building?.[0]?.[1]?.url;
    expect(missing).toBeDefined();
    const donor = new ScatterBelt();
    const mesh = meshFor(donor, 'rock');
    const own = verticesOf(mesh.geometry);
    await loadSceneryModels((url) =>
      url === missing
        ? Promise.reject(new Error('404'))
        : Promise.resolve(sceneOf(mesh.geometry.clone(), mesh.matrixWorld)),
    );
    donor.dispose();
    const belt = new ScatterBelt();

    expect(marksOf(meshFor(belt, 'building', 0).geometry)).toEqual([own]);
    expect(
      meshFor(belt, 'building', 0).geometry.getAttribute(STYLISED_SHAPE_ATTRIBUTE),
    ).toBeUndefined();
    // The other two meshes, and every other kind, lose nothing.
    expect(marksOf(meshFor(belt, 'building', 1).geometry)).toEqual([own, own, own]);
    expect(marksOf(meshFor(belt, 'building', 2).geometry)).toEqual([own, own, own]);
    expect(marksOf(meshFor(belt, 'rock', 0).geometry)).toEqual([own, own, own]);
    // And a commercial lot on that mesh is drawn, as the one shape it has.
    belt.update([item({ kind: 'building', setting: 'commercial', variant: 0 })], POSE);
    expect(meshFor(belt, 'building', 0).count).toBe(1);
    expect(
      meshFor(belt, 'building', 0).geometry.getAttribute(STYLISED_INSTANCE_ATTRIBUTE),
    ).toBeUndefined();
    belt.dispose();
  });

  it('CONTROL: with the folds switched off, reads the models alone', async () => {
    setStylisedFolds(false);
    const asked: string[] = [];
    const donor = new ScatterBelt();
    const mesh = meshFor(donor, 'rock');
    await loadSceneryModels((url) => {
      asked.push(url);
      return Promise.resolve(sceneOf(mesh.geometry.clone(), mesh.matrixWorld));
    });
    donor.dispose();
    const belt = new ScatterBelt();

    expect(asked).toHaveLength(Object.values(SCENERY_MODELS).flat().length);
    for (const each of FOLDED) {
      expect(asked).not.toContain(each.model.url);
      expect(
        meshFor(belt, each.kind, each.mesh).geometry.getAttribute(STYLISED_SHAPE_ATTRIBUTE),
      ).toBeUndefined();
    }
    belt.dispose();
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

    for (const [kind, meshes] of Object.entries(STYLISED_FOLD_MODELS) as [
      SceneryKind,
      readonly (readonly SceneryModel[])[],
    ][]) {
      meshes.forEach((folds, mesh) => {
        // Every file was read as the donor's shape: the model, then one a fold.
        expect(marksOf(meshFor(belt, kind, mesh).geometry), `${kind} ${String(mesh)}`).toEqual([
          model,
          ...folds.map(() => model),
        ]);
      });
    }
    // A building's mesh holds three shapes; a tree's first three and its second two.
    expect(marksOf(meshFor(belt, 'building', 2).geometry)).toHaveLength(3);
    expect(marksOf(meshFor(belt, 'tree-broadleaf', 0).geometry)).toHaveLength(3);
    expect(marksOf(meshFor(belt, 'tree-broadleaf', 1).geometry)).toHaveLength(2);
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
      expect(shape).toBe(stylisedFoldOf(tree, 3));
      drawn.add(shape);
      writeStylisedTint(tree.kind, tree.x, tree.z, expected, 0);
      tint.forEach((channel, each) => {
        // Carried as what it takes off, in single precision.
        expect(channel).toBeCloseTo(expected[each] as number, 6);
      });
      tints.add(tint.map((channel) => channel.toFixed(5)).join());
    });
    // All three shapes of the mesh stand in the row, and no two trees are one colour.
    expect(drawn).toEqual(new Set([0, 1, 2]));
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
    expect([0, 1, 2]).toContain(last.shape);
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
