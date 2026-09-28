// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The realistic world's renderer path, in jsdom — ADR 0026, #425, #474, #369.
 *
 * Everything here is arithmetic over objects that need no GL context: which
 * material a loaded model ends up wearing (D-11), which trees are drawn as
 * meshes and which as impostors (#474's budget), which kinds the realistic
 * world's primitives belt leaves to the vegetation belt (D-3), and what
 * `loadRealisticWorld` does when a file will not load (D-7). What needs a GPU —
 * that it reaches a drawing buffer, that the road's gradient survives the light
 * and the tone mapping, that the rider's legs move with the cranks — is
 * `game.browser.spec.ts` §"the realistic world".
 *
 * ⚠️ **No `three` is imported here**, for `three-seam.test.ts`: the geometry a
 * fixture needs is taken off a belt `three-renderer.ts` builds, and a loaded
 * glTF scene is a plain object with the handful of fields the code reads — the
 * same posture `three-renderer.test.ts` takes for `prepareSceneryGeometry`.
 */

import { readFileSync } from 'node:fs';

import ts from 'typescript';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { isBuiltKind } from './buildings';
import { REALISTIC_LADDER, type QualitySettings } from './quality';
import {
  blobCasters,
  GROUND_BLOB_CORE,
  GROUND_BLOB_DARKNESS,
  GROUND_BLOB_LIFT_METRES,
  GROUND_BLOB_TRIANGLES,
  groundUnder,
  roadClip,
  type BlobCasters,
} from './ground-blob';
import { terrainCorridor } from './landform';
import { hillRoute } from './route-fixtures-testing';
import { scatterSeed } from './scatter';
import { corridorOrigin, roadCorridor } from './terrain';
import { worldStyle } from './world';
import {
  HARD_SWAP_TREE_LEVELS,
  REALISTIC_BICYCLE_TRIANGLES,
  REALISTIC_GROUND_BLOBS,
  REALISTIC_NEAR_MESHES,
  REALISTIC_TREE_LEVELS,
} from './realistic-budget';
import { bandFade, treeSlots, type TreeLevels } from './tree-levels';
import {
  FOLIAGE_TINT,
  MASONRY_TINT,
  NO_TINT,
  TINT_CODEC_RANGE,
  TINT_CODEC_STEPS,
  TINT_CODEC_ZERO,
  packedInstanceTint,
} from './instance-tint';
import {
  CAMERA_BEHIND_METRES,
  FRUSTUM_SPREAD,
  NEAR_PLANE_METRES,
  WORST_CASE_ASPECT,
  cameraRig,
  verticalHalfTangent,
} from './camera';
import {
  PHOTOGRAPHIC_STRUCTURE_SURFACES,
  REALISTIC_BICYCLE_MAPS,
  REALISTIC_BICYCLE_MAP_NAMES,
  REALISTIC_SKY,
  REALISTIC_BOUNDARY_PARTS,
  REALISTIC_BUILDING_SURFACES,
  REALISTIC_STRUCTURE_SURFACES,
  REALISTIC_VEGETATION,
  REALISTIC_VEGETATION_KINDS,
  realisticUrl,
  type StructureSurface,
} from './realistic-assets';
import { HORIZON_AZIMUTH_BINS } from './realistic-light';
import type { CameraPose } from './port';
import { STRUCTURE_KINDS, type ScatterItem, type SceneryKind } from './scatter';
import {
  ATMOSPHERE_BIN_OFFSET,
  ATMOSPHERE_BIN_WRAP,
  breathesTheAir,
  ContactShadowBelt,
  isConstructedMaterial,
  loadRealisticWorld,
  materialLayers,
  mergeShapeMaterials,
  photographicGroundMaterial,
  photographicRoadMaterial,
  prepareMiddleLevel,
  prepareRealisticShape,
  readsInstanceTint,
  readsTextureLodBias,
  realisticBicycleMeshes,
  realisticBicycleTriangles,
  SCATTER_INSTANCE_CAPACITY,
  setRealisticTints,
  treeCanBeSeen,
  GroundBlobBelt,
  sceneryFitMetres,
  structureCasters,
  REALISTIC_PRIMITIVE_SKIP,
  realisticResourceUrl,
  RealisticStructureBelts,
  realisticStructureGeometry,
  realisticStructureSurfaces,
  RealisticVegetationBelt,
  realisticWorldLoaded,
  ScatterBelt,
  WaterBelt,
  type RealisticBicycleMaps,
  type RealisticLoaders,
  type RealisticShape,
} from './three-renderer';
import { CRANK_AXIS_Z, RIDER_BICYCLE_PARTS, RIDER_CRANK_PARTS } from './bicycle';
import {
  bandV,
  CASSETTE_BAND,
  CHAINRING_BAND,
  PLAIN_METAL_UV,
  PLAIN_RUBBER_UV,
  TAPE_BAND,
  TYRE_BAND,
} from './bicycle-surfaces';

/** A mesh's one material's three `type`. */
function typeOf(mesh: { readonly material: unknown } | undefined): string | undefined {
  const material = mesh?.material;
  const one: unknown = Array.isArray(material) ? (material as readonly unknown[])[0] : material;
  return (one as { readonly type?: string } | undefined)?.type;
}

/** A geometry three built, taken off a belt so this file names no `three` type. */
function aGeometry(): NonNullable<ReturnType<ScatterBelt['meshesOf']>[number]>['geometry'] {
  const belt = new ScatterBelt(new Map());
  const mesh = belt.meshesOf('rock')[0];
  if (mesh === undefined) throw new Error('no rock primitive');
  return mesh.geometry.clone();
}

/** What `GLTFLoader` leaves on a mesh: the fields `prepareRealisticShape` reads. */
function loaderMaterial(overrides: Record<string, unknown> = {}): {
  disposed: boolean;
} & Record<string, unknown> {
  const material = {
    disposed: false,
    transparent: false,
    alphaTest: 0,
    alphaHash: false,
    map: { image: { width: 512, height: 512 }, dispose: () => undefined },
    normalMap: null,
    dispose(): void {
      material.disposed = true;
    },
    ...overrides,
  };
  return material;
}

const IDENTITY = { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] };

/** A loaded glTF scene: one node carrying the pipeline's extras, then its meshes. */
function aScene(
  meshes: readonly { material: unknown }[],
  extras: Record<string, unknown> = { oyl_scan_height: 8, oyl_scan_width: 4 },
): Parameters<typeof prepareRealisticShape>[0] {
  return {
    updateWorldMatrix: () => undefined,
    traverse: (visit: (node: unknown) => void) => {
      visit({ isMesh: false, userData: extras });
      for (const mesh of meshes) {
        visit({
          isMesh: true,
          geometry: aGeometry(),
          material: mesh.material,
          matrixWorld: IDENTITY,
          userData: {},
        });
      }
    },
  } as unknown as Parameters<typeof prepareRealisticShape>[0];
}

describe('a loaded model wears only materials this repository constructs — ADR 0026 D-11', () => {
  it('replaces every loader-built material, and disposes the loader’s', () => {
    const bark = loaderMaterial();
    const leaves = loaderMaterial({ transparent: true });
    const shape = prepareRealisticShape(aScene([{ material: bark }, { material: leaves }]), 'tree');

    expect(shape.parts).toHaveLength(2);
    for (const part of shape.parts) {
      expect(part.material.type).toBe('MeshStandardMaterial');
      expect(isConstructedMaterial(part.material)).toBe(true);
      expect(part.material).not.toBe(bark);
      expect(part.material).not.toBe(leaves);
    }
    expect(bark.disposed).toBe(true);
    expect(leaves.disposed).toBe(true);
  });

  it('carries the file’s own colour map across, so the file still decides how it looks', () => {
    const bark = loaderMaterial();
    const shape = prepareRealisticShape(aScene([{ material: bark }]), 'tree');
    expect(shape.parts[0]?.material.map).toBe(bark['map']);
  });

  it('cuts foliage by alpha TEST rather than blending, on both faces', () => {
    // A blended leaf would need depth sorting, which instancing cannot give it.
    const shape = prepareRealisticShape(
      aScene([{ material: loaderMaterial() }, { material: loaderMaterial({ transparent: true }) }]),
      'tree',
    );
    const [bark, leaves] = shape.parts;
    expect(bark?.material.alphaTest).toBe(0);
    expect(leaves?.material.alphaTest).toBeGreaterThan(0);
    expect(leaves?.material.transparent).toBe(false);
    expect(leaves?.material.side).toBe(bark?.material.side);
  });

  it('sizes the shape by the scan the pipeline recorded, and refuses a file that recorded none', () => {
    const shape = prepareRealisticShape(aScene([{ material: loaderMaterial() }]), 'tree');
    expect(shape.extent).toBe(8);
    expect(shape.triangles).toBeGreaterThan(0);
    expect(() =>
      prepareRealisticShape(aScene([{ material: loaderMaterial() }], {}), 'tree'),
    ).toThrow(/records no scan size/);
  });

  it('constructs the impostor’s material too', () => {
    const strip = { image: { width: 2048, height: 512 }, colorSpace: '' };
    const shape = prepareRealisticShape(
      aScene([{ material: loaderMaterial() }], {
        oyl_scan_height: 8,
        oyl_scan_width: 4,
        oyl_impostor_scale: 8.2,
        oyl_impostor_frames: 8,
      }),
      'tree',
      strip as unknown as Parameters<typeof prepareRealisticShape>[2],
    );
    expect(shape.impostor?.material.type).toBe('ShaderMaterial');
    expect(isConstructedMaterial(shape.impostor?.material as never)).toBe(true);
  });
});

/** A pose at the origin looking up +Z, as `scene.ts` would hand a belt. */
const POSE: CameraPose = {
  x: 0,
  y: 0,
  z: 0,
  headingX: 0,
  headingZ: 1,
  eyeRoadY: 0,
  targetRoadY: 0,
};

function item(kind: SceneryKind, z: number, x = 12): ScatterItem {
  return { kind, x, y: 0, z, rotation: 0, scale: 1, variant: 0 };
}

function aTreeShape(): RealisticShape {
  return prepareRealisticShape(
    aScene([{ material: loaderMaterial() }, { material: loaderMaterial({ transparent: true }) }], {
      oyl_scan_height: 8,
      oyl_scan_width: 4,
      oyl_impostor_scale: 8.2,
      oyl_impostor_frames: 8,
    }),
    'tree',
    { image: { width: 2048, height: 512 } } as unknown as Parameters<
      typeof prepareRealisticShape
    >[2],
  );
}

function aBelt(): RealisticVegetationBelt {
  const tree = aTreeShape();
  const small = prepareRealisticShape(aScene([{ material: loaderMaterial() }]), 'small');
  return new RealisticVegetationBelt(
    new Map([
      ['tree-broadleaf', [tree]],
      ['tree-conifer', [tree]],
      ['shrub', [small]],
      ['rock', [small]],
    ] as const),
  );
}

/** How many instances the belt submitted to its mesh and to its impostor, for one kind. */
function drawn(belt: RealisticVegetationBelt): { readonly near: number; readonly far: number } {
  let near = 0;
  let far = 0;
  for (const mesh of belt.meshes) {
    if (typeOf(mesh) === 'ShaderMaterial') far += mesh.count;
    else near += mesh.count;
  }
  return { near, far };
}

describe('the vegetation belt — #474', () => {
  it('draws the nearest trees as meshes, and every other as its impostor', () => {
    const belt = aBelt();
    // Far ones FIRST in the frame's order, so a belt that took the first N
    // rather than the nearest N is caught. The fixture tree has no middle
    // level, so the middle ranks are drawn as the impostor (#617).
    const items = [150, 120, 90, 60, 40, 30, 20, 10].map((z) => item('tree-broadleaf', z));
    belt.update(items, POSE);
    const cap = treeSlots(REALISTIC_TREE_LEVELS).full;
    // Each tree mesh is drawn once per part, and the fixture tree has two.
    const meshes = belt.meshes.filter((mesh) => typeOf(mesh) !== 'ShaderMaterial');
    const drawnNear = Math.max(...meshes.map((mesh) => mesh.count));
    expect(drawnNear).toBe(cap);
    // Every tree but the nearest is an impostor — the band's included, whose
    // other half is its impostor where a middle level would be.
    expect(drawn(belt).far).toBe(items.length - 1);
    // …and the near ones ARE the nearest: every near instance is within 20 m.
    for (const mesh of meshes) {
      for (let slot = 0; slot < mesh.count; slot += 1) {
        // The z of the translation, read straight out of the instance buffer.
        expect(mesh.instanceMatrix.array[slot * 16 + 14]).toBeLessThanOrEqual(20);
      }
    }
  });

  it('draws only the nearest shrubs and rocks, and no impostor for either', () => {
    const belt = aBelt();
    const items = Array.from({ length: 30 }, (_, index) => item('shrub', 5 + index * 4));
    belt.update(items, POSE);
    expect(drawn(belt)).toEqual({ near: REALISTIC_NEAR_MESHES.shrub, far: 0 });
  });

  it('leaves every kind it has no shape for to the other belt', () => {
    const belt = aBelt();
    belt.update([item('post', 10), item('building', 20), item('wall', 30)], POSE);
    expect(drawn(belt)).toEqual({ near: 0, far: 0 });
  });

  it('culls what the camera cannot see exactly as the stylised belt does', () => {
    const belt = aBelt();
    // Behind the corridor, and far out to the side of it.
    belt.update([item('tree-conifer', -400), item('tree-conifer', 30, 900)], POSE);
    expect(drawn(belt)).toEqual({ near: 0, far: 0 });
  });

  it('draws nothing while the stylised world is drawn', () => {
    const belt = aBelt();
    belt.setShown(false);
    belt.update([item('tree-broadleaf', 10)], POSE);
    expect(drawn(belt)).toEqual({ near: 0, far: 0 });
    for (const mesh of belt.meshes) expect(mesh.visible).toBe(false);
  });

  it('wears only constructed materials, on every mesh — ADR 0026 D-11', () => {
    const belt = aBelt();
    expect(belt.meshes.length).toBeGreaterThan(0);
    for (const mesh of belt.meshes) {
      expect(isConstructedMaterial(mesh.material as never), typeOf(mesh)).toBe(true);
    }
  });
});

/** A tree with a middle level, as the loader would hand both files over. */
function aTreeWithMiddle(): RealisticShape {
  const extras = {
    oyl_scan_height: 8,
    oyl_scan_width: 4,
    oyl_impostor_scale: 8.2,
    oyl_impostor_frames: 8,
  };
  const near = prepareRealisticShape(
    aScene(
      [
        { material: loaderMaterial({ name: 'bark' }) },
        { material: loaderMaterial({ name: 'leaves', transparent: true }) },
      ],
      extras,
    ),
    'tree',
    { image: { width: 2048, height: 512 } } as unknown as Parameters<
      typeof prepareRealisticShape
    >[2],
  );
  return prepareMiddleLevel(
    near,
    aScene(
      [
        { material: loaderMaterial({ name: 'leaves', map: null }) },
        { material: loaderMaterial({ name: 'bark', map: null }) },
      ],
      { oyl_scan_height: 8, oyl_scan_width: 4 },
    ),
    'tree',
  );
}

/** Where each level of one kind was submitted: the z of every instance, and its keep. */
function submitted(
  belt: RealisticVegetationBelt,
  kind: 'tree-broadleaf' | 'tree-conifer',
): Record<'full' | 'middle' | 'impostor', { z: number; low: number; high: number; m: number[] }[]> {
  const levels = belt.levelsOf(kind);
  const read = (mesh: RealisticVegetationBelt['meshes'][number] | undefined) => {
    const out: { z: number; low: number; high: number; m: number[] }[] = [];
    if (mesh === undefined) return out;
    for (let slot = 0; slot < mesh.count; slot += 1) {
      const keep = mesh.instanceColor?.array;
      out.push({
        z: mesh.instanceMatrix.array[slot * 16 + 14] ?? Number.NaN,
        low: keep?.[slot * 3] ?? Number.NaN,
        high: keep?.[slot * 3 + 1] ?? Number.NaN,
        m: Array.from(mesh.instanceMatrix.array.slice(slot * 16, slot * 16 + 16)),
      });
    }
    return out;
  };
  // One part is enough: every part of a level carries the same instances.
  return {
    full: read(levels.full[0]?.[0]),
    middle: read(levels.middle[0]?.[0]),
    impostor: read(levels.impostor[0]),
  };
}

describe('the trees’ three levels and the dithered hand-over — #617', () => {
  const beltWith = (levels = REALISTIC_TREE_LEVELS): RealisticVegetationBelt => {
    const tree = aTreeWithMiddle();
    return new RealisticVegetationBelt(
      new Map([
        ['tree-broadleaf', [tree]],
        ['tree-conifer', [tree]],
      ] as const),
      levels,
    );
  };
  // Far first, both kinds interleaved: the ranking is over the trees together.
  const zs = [95, 85, 75, 65, 55, 45, 35, 25, 18, 10];
  const trees = zs.map((z, index) =>
    item(index % 2 === 0 ? 'tree-broadleaf' : 'tree-conifer', z, 0),
  );
  const levelsOfZ = (belt: RealisticVegetationBelt, z: number): string[] => {
    const found: string[] = [];
    for (const kind of ['tree-broadleaf', 'tree-conifer'] as const) {
      const each = submitted(belt, kind);
      for (const level of ['full', 'middle', 'impostor'] as const) {
        if (each[level].some((one) => Math.abs(one.z - z) < 1e-6)) found.push(level);
      }
    }
    return found;
  };

  it('submits a band tree at BOTH levels, and every other tree at one', () => {
    const belt = beltWith();
    belt.update(trees, POSE);
    // Nearest first: 10 full; 18 the band; 25–55 middle; 65 the band; beyond, impostors.
    expect(levelsOfZ(belt, 10)).toEqual(['full']);
    expect(levelsOfZ(belt, 18)).toEqual(['full', 'middle']);
    for (const z of [25, 35, 45, 55]) expect(levelsOfZ(belt, z), String(z)).toEqual(['middle']);
    expect(levelsOfZ(belt, 65)).toEqual(['middle', 'impostor']);
    for (const z of [75, 85, 95]) expect(levelsOfZ(belt, z), String(z)).toEqual(['impostor']);
    // Every tree counted once, however many levels it was submitted at.
    expect(belt.drawnItems).toBe(trees.length);
  });

  it('draws a band tree’s levels with ONE matrix and complementary keeps', () => {
    const belt = beltWith();
    belt.update(trees, POSE);
    const kindOf18 = 'tree-broadleaf';
    const at = submitted(belt, kindOf18);
    const full = at.full.find((one) => one.z === 18);
    const middle = at.middle.find((one) => one.z === 18);
    expect(full?.m).toEqual(middle?.m);
    // Its fade is where 18 sits between 10 and 25.
    const fade = bandFade(1, [10, 18, 25], 3);
    expect(fade).toBeCloseTo(8 / 15, 6);
    expect([full?.low, full?.high]).toEqual([Math.fround(fade), 2]);
    expect([middle?.low, middle?.high]).toEqual([-1, Math.fround(fade)]);
    // And a tree at one level keeps everything.
    const nearest = submitted(belt, 'tree-conifer').full.find((one) => one.z === 10);
    expect([nearest?.low, nearest?.high]).toEqual([0, 0]);
    // Band B, the other way round: 65 sits half-way between 55 and 75, so the
    // middle level keeps the upper half and the impostor the lower.
    const outer = submitted(belt, 'tree-conifer');
    const outerMiddle = outer.middle.find((one) => one.z === 65);
    const outerImpostor = outer.impostor.find((one) => one.z === 65);
    expect([outerMiddle?.low, outerMiddle?.high]).toEqual([0.5, 2]);
    expect([outerImpostor?.low, outerImpostor?.high]).toEqual([-1, 0.5]);
    expect(outerMiddle?.m).toEqual(outerImpostor?.m);
  });

  it('never submits more than the slots allow, however wooded the road', () => {
    const belt = beltWith();
    const forest = Array.from({ length: 60 }, (_, index) =>
      item(index % 2 === 0 ? 'tree-broadleaf' : 'tree-conifer', 5 + index * 2, 0),
    );
    belt.update(forest, POSE);
    const slots = treeSlots(REALISTIC_TREE_LEVELS);
    let full = 0;
    let middle = 0;
    for (const kind of ['tree-broadleaf', 'tree-conifer'] as const) {
      full += submitted(belt, kind).full.length;
      middle += submitted(belt, kind).middle.length;
    }
    expect(full).toBe(slots.full);
    expect(middle).toBe(slots.middle);
  });

  it('wears the near parts’ own materials at the middle level — no second map', () => {
    const tree = aTreeWithMiddle();
    const nearMaterials = tree.parts.map((part) => part.material);
    expect(tree.middle?.parts).toHaveLength(2);
    for (const part of tree.middle?.parts ?? []) expect(nearMaterials).toContain(part.material);
    // Paired by NAME, not by order: the middle file lists them the other way round.
    expect(tree.middle?.parts[0]?.material.name).toBe('leaves');
    expect(tree.middle?.parts[0]?.material.map).not.toBeNull();
  });

  it('refuses a middle level that wears a material the near file has not, or is another scan', () => {
    const near = aTreeShape();
    expect(() =>
      prepareMiddleLevel(near, aScene([{ material: loaderMaterial({ name: 'moss' }) }]), 'tree'),
    ).toThrow(/does not/);
    const named = aTreeWithMiddle();
    expect(() =>
      prepareMiddleLevel(
        named,
        aScene([{ material: loaderMaterial({ name: 'bark' }) }], {
          oyl_scan_height: 9,
          oyl_scan_width: 4,
        }),
        'tree',
      ),
    ).toThrow(/different scan size/);
  });

  it('hard-swaps with no band and no middle level in the control', () => {
    const belt = beltWith(HARD_SWAP_TREE_LEVELS);
    belt.update(trees, POSE);
    for (const z of zs) {
      expect(levelsOfZ(belt, z), String(z)).toHaveLength(1);
    }
    expect(levelsOfZ(belt, 55)).toEqual(['full']);
    expect(levelsOfZ(belt, 65)).toEqual(['impostor']);
  });

  it('ranks only the trees the camera can see — #617’s review', () => {
    // Two trees BEHIND the camera, which is 4.5 m behind the rider, and one
    // ahead: the one ahead is the nearest tree in the picture.
    const passed = [item('tree-broadleaf', -8, 0), item('tree-conifer', -12, 0)];
    const ahead = item('tree-broadleaf', 15, 2);
    const belt = beltWith();
    belt.update([...passed, ahead], POSE);
    expect(levelsOfZ(belt, 15)).toEqual(['full']);
    // Still drawn, as the impostor nothing sees — the cull is `inView`'s.
    expect(levelsOfZ(belt, -8)).toEqual(['impostor']);
    expect(belt.drawnItems).toBe(3);
    // The control is the ranking before the review: the two passed trees take
    // the full slot and the band, and the tree in the picture is middle.
    const before = beltWith({ ...REALISTIC_TREE_LEVELS, rankOnly: 'in-view' });
    before.update([...passed, ahead], POSE);
    expect(levelsOfZ(before, 15)).toEqual(['middle']);
    expect(levelsOfZ(before, -8)).toEqual(['full']);
  });

  it('changes no tree’s shape in one frame as the rider passes trees — #617’s review', () => {
    // Every tree the rider passes leaves the ranked set, and every tree
    // behind it moves up a rank. A rider at 6 m/s and 60 frames a second.
    const road = [5, 8, 12, 17, 23, 30, 38, 47, 57, 68, 80].map((z, index) =>
      item(index % 2 === 0 ? 'tree-broadleaf' : 'tree-conifer', z, 2),
    );
    const largestStep = (levels: TreeLevels): number => {
      const belt = beltWith(levels);
      let last = new Map<number, readonly [number, number]>();
      let largest = 0;
      for (let at = 0; at <= 140; at += 1) {
        const riderZ = at * 0.1;
        belt.update(road, { ...POSE, z: riderZ });
        const now = new Map<number, readonly [number, number]>();
        // Only trees still well ahead of the camera: one that has left the
        // picture may go to its impostor at once.
        for (const tree of road) {
          if (tree.z - riderZ > -CAMERA_BEHIND_METRES + 1.5)
            now.set(tree.z, splitOfZ(belt, tree.z));
        }
        for (const [z, [low, high]] of now) {
          const was = last.get(z);
          if (was !== undefined) {
            largest = Math.max(largest, Math.abs(low - was[0]), Math.abs(high - was[1]));
          }
        }
        last = now;
      }
      return largest;
    };
    const paced = largestStep(REALISTIC_TREE_LEVELS);
    const unpaced = largestStep({ ...REALISTIC_TREE_LEVELS, handOverFrames: 1 });
    // A step a frame, plus what the rider's own motion moves a band's fade.
    expect(paced).toBeLessThanOrEqual(1 / REALISTIC_TREE_LEVELS.handOverFrames + 0.02);
    expect(unpaced).toBeGreaterThan(0.3);
  });
});

/**
 * Where a tree at `z` splits the screen between its levels, `[low, high]`, read
 * back off the keeps the belt wrote: the impostor keeps `[0, low)`, the middle
 * level `[low, high)`, the full mesh `[high, 1)`.
 */
function splitOfZ(belt: RealisticVegetationBelt, z: number): readonly [number, number] {
  const decode = (one: { low: number; high: number }): readonly [number, number] =>
    one.low === 0 && one.high === 0 ? [0, 1] : [Math.max(0, one.low), Math.min(1, one.high)];
  let low = 0;
  let high = 1;
  for (const kind of ['tree-broadleaf', 'tree-conifer'] as const) {
    const each = submitted(belt, kind);
    const full = each.full.find((one) => Math.abs(one.z - z) < 1e-6);
    const impostor = each.impostor.find((one) => Math.abs(one.z - z) < 1e-6);
    if (full !== undefined) high = decode(full)[0];
    if (impostor !== undefined) low = decode(impostor)[1];
  }
  return [low, high];
}

/**
 * Whether the camera can see any of a tree, sampled — the frustum itself, at
 * the widest frame there is, for `treeCanBeSeen` to be held to. A trunk of
 * `radius` and `height` sampled at three radii, sixteen bearings and eight
 * heights.
 */
function frustumSees(tree: ScatterItem, pose: CameraPose, radius: number, height: number): boolean {
  const { eye, target } = cameraRig(pose);
  const f = { x: target.x - eye.x, y: target.y - eye.y, z: target.z - eye.z };
  const length = Math.hypot(f.x, f.y, f.z);
  f.x /= length;
  f.y /= length;
  f.z /= length;
  // three's lookAt with +Y up: right = forward × up, up' = right × forward.
  const across = Math.hypot(f.z, f.x);
  const right = { x: -f.z / across, y: 0, z: f.x / across };
  const up = {
    x: right.y * f.z - right.z * f.y,
    y: right.z * f.x - right.x * f.z,
    z: right.x * f.y - right.y * f.x,
  };
  const spread = FRUSTUM_SPREAD;
  const tall = verticalHalfTangent(WORST_CASE_ASPECT);
  for (const share of [0, 0.5, 1]) {
    for (let bearing = 0; bearing < 16; bearing += 1) {
      const angle = (bearing / 16) * 2 * Math.PI;
      for (let step = 0; step <= 7; step += 1) {
        const px = tree.x + share * radius * Math.cos(angle) - eye.x;
        const py = tree.y + (step / 7) * height - eye.y;
        const pz = tree.z + share * radius * Math.sin(angle) - eye.z;
        const depth = px * f.x + py * f.y + pz * f.z;
        if (depth <= NEAR_PLANE_METRES) continue;
        const x = px * right.x + py * right.y + pz * right.z;
        const y = px * up.x + py * up.y + pz * up.z;
        if (Math.abs(x) <= spread * depth && Math.abs(y) <= tall * depth) return true;
      }
    }
  }
  return false;
}

/** A pose at the origin looking up +Z whose camera looks at a road `rise` metres up 29.5 m on. */
const pitched = (rise: number): CameraPose => ({ ...POSE, eyeRoadY: 0, targetRoadY: rise });

/**
 * A map as `GLTFLoader` leaves one: an image, a transform and the coordinate
 * set it reads, and a `clone` over the same `source` — #639's merge reads all
 * of it, and the fixtures above carry none of it.
 */
interface FakeMap {
  readonly image: { width: number; height: number };
  source: object;
  channel: number;
  matrixAutoUpdate: boolean;
  readonly matrix: { elements: number[]; identity: () => unknown };
  readonly updateMatrix: () => void;
  disposed: boolean;
  dispose: () => void;
  clone: () => FakeMap;
  cloneOf?: FakeMap;
}

function aMap(elements: readonly number[] = [1, 0, 0, 0, 1, 0, 0, 0, 1], channel = 0): FakeMap {
  const matrix = {
    elements: [...elements],
    identity: () => {
      matrix.elements = [1, 0, 0, 0, 1, 0, 0, 0, 1];
      return matrix;
    },
  };
  const map: FakeMap = {
    image: { width: 512, height: 512 },
    source: {},
    channel,
    matrixAutoUpdate: false,
    matrix,
    updateMatrix: () => undefined,
    disposed: false,
    dispose: () => {
      map.disposed = true;
    },
    clone: () => {
      const copy = aMap(elements, channel);
      copy.source = map.source;
      copy.cloneOf = map;
      return copy;
    },
  };
  return map;
}

/** Bark's tiling, as `KHR_texture_transform` gives it: ×3 across, ×0.5 up, 0.25 along. */
const BARK_TILING = [3, 0, 0, 0, 0.5, 0, 0.25, 0.1, 1] as const;

/** A tree of two materials — tiled bark and cut leaves — with a middle level. */
function aTreeOfTwoMaterials(): {
  shape: RealisticShape;
  bark: { map: FakeMap; normalMap: FakeMap };
  leaves: { map: FakeMap; normalMap: FakeMap };
} {
  const bark = { map: aMap(BARK_TILING), normalMap: aMap(BARK_TILING) };
  const leaves = { map: aMap(), normalMap: aMap() };
  const extras = {
    oyl_scan_height: 8,
    oyl_scan_width: 4,
    oyl_impostor_scale: 8.2,
    oyl_impostor_frames: 8,
  };
  const near = prepareRealisticShape(
    aScene(
      [
        { material: loaderMaterial({ name: 'bark', ...bark }) },
        { material: loaderMaterial({ name: 'leaves', transparent: true, ...leaves }) },
      ],
      extras,
    ),
    'tree',
    { image: { width: 2048, height: 512 } } as unknown as Parameters<
      typeof prepareRealisticShape
    >[2],
  );
  const shape = prepareMiddleLevel(
    near,
    aScene(
      [
        { material: loaderMaterial({ name: 'leaves', map: null }) },
        { material: loaderMaterial({ name: 'bark', map: null }) },
      ],
      { oyl_scan_height: 8, oyl_scan_width: 4 },
    ),
    'tree',
  );
  return { shape, bark, leaves };
}

/** A fragment and a vertex shader holding every include #639 splices at. */
function compiledLayers(material: unknown): {
  vertex: string;
  fragment: string;
  uniforms: Record<string, { value: unknown }>;
} {
  const shader = {
    uniforms: {} as Record<string, { value: unknown }>,
    vertexShader:
      '#include <common>\n#include <begin_vertex>\n#include <color_vertex>\n#include <fog_pars_vertex>\n#include <fog_vertex>',
    fragmentShader: [
      '#include <common>',
      '#include <map_pars_fragment>',
      '#include <normalmap_pars_fragment>',
      '#include <fog_pars_fragment>',
      '#include <clipping_planes_fragment>',
      '#include <map_fragment>',
      '#include <color_fragment>',
      '#include <normal_fragment_maps>',
      '#include <fog_fragment>',
    ].join('\n'),
  };
  (material as { onBeforeCompile: (shader: unknown, renderer: unknown) => void }).onBeforeCompile(
    shader,
    undefined,
  );
  return {
    vertex: shader.vertexShader,
    fragment: shader.fragmentShader,
    uniforms: shader.uniforms,
  };
}

describe('a tree is one material a level, its scan’s materials its layers — #639', () => {
  it('draws each level as ONE part wearing ONE constructed material, the same at both levels', () => {
    const { shape } = aTreeOfTwoMaterials();
    expect(shape.parts).toHaveLength(2);
    const merged = mergeShapeMaterials(shape, 'tree');
    expect(merged.parts).toHaveLength(1);
    expect(merged.middle?.parts).toHaveLength(1);
    const material = merged.parts[0]?.material;
    expect(merged.middle?.parts[0]?.material).toBe(material);
    expect(isConstructedMaterial(material as never)).toBe(true);
    expect(materialLayers(material as never)).toBe(2);
    // Every lever the materials it replaces were taught.
    expect(readsTextureLodBias(material as never)).toBe(true);
    expect(breathesTheAir(material as never)).toBe(true);
    // Cut, because one of its layers is leaves.
    expect(material?.alphaTest).toBeGreaterThan(0);
    expect(material?.transparent).toBe(false);
  });

  it('keeps every triangle, each layer one run of the index, every vertex naming its layer', () => {
    const { shape } = aTreeOfTwoMaterials();
    const triangles = (parts: RealisticShape['parts']): number =>
      parts.reduce(
        (sum, part) =>
          sum + (part.geometry.getIndex()?.count ?? part.geometry.getAttribute('position').count),
        0,
      ) / 3;
    const nearTriangles = triangles(shape.parts);
    const middleTriangles = triangles(shape.middle?.parts ?? []);
    const barkVertices = shape.parts[0]?.geometry.getAttribute('position').count ?? 0;
    const merged = mergeShapeMaterials(shape, 'tree');
    expect(triangles(merged.parts)).toBe(nearTriangles);
    expect(triangles(merged.middle?.parts ?? [])).toBe(middleTriangles);
    expect(merged.triangles).toBe(shape.triangles);
    /** The layer of every triangle's first vertex, in index order. */
    const layersOf = (part: RealisticShape['parts'][number] | undefined): number[] => {
      const layer = part?.geometry.getAttribute('oylLayer');
      const index = part?.geometry.getIndex();
      const out: number[] = [];
      for (let slot = 0; slot < (index?.count ?? 0); slot += 3) {
        const corners = [0, 1, 2].map((corner) => layer?.getX(index?.getX(slot + corner) ?? -1));
        // A triangle is in ONE layer, which is what a flat varying needs.
        expect(new Set(corners).size).toBe(1);
        out.push(corners[0] ?? -1);
      }
      return out;
    };
    const runs = (layers: number[]): number[] =>
      layers.filter((layer, at) => at === 0 || layers[at - 1] !== layer);
    // Bark (0) then leaves (1), each one run — and the middle file, which
    // lists leaves first, comes out in the same order.
    const near = layersOf(merged.parts[0]);
    expect(runs(near)).toEqual([0, 1]);
    expect(near.filter((layer) => layer === 0)).toHaveLength(nearTriangles / 2);
    expect(runs(layersOf(merged.middle?.parts[0]))).toEqual([0, 1]);
    // Every vertex of the first part is bark's, every later one the leaves'.
    const layer = merged.parts[0]?.geometry.getAttribute('oylLayer');
    expect(layer?.getX(0)).toBe(0);
    expect(layer?.getX(barkVertices - 1)).toBe(0);
    expect(layer?.getX(barkVertices)).toBe(1);
  });

  it('bakes each layer’s texture transform into its coordinates, and wears maps with none', () => {
    const { shape, bark } = aTreeOfTwoMaterials();
    const source = aGeometry().getAttribute('uv');
    const merged = mergeShapeMaterials(shape, 'tree');
    const uv = merged.parts[0]?.geometry.getAttribute('uv');
    const [a, b, , c, d, , e, f] = BARK_TILING;
    // Vertex 0 is bark's: tiled. The first vertex of the leaves' group is not.
    expect(uv?.getX(0)).toBeCloseTo(a * source.getX(0) + c * source.getY(0) + e, 6);
    expect(uv?.getY(0)).toBeCloseTo(b * source.getX(0) + d * source.getY(0) + f, 6);
    const leavesAt = source.count;
    expect(uv?.getX(leavesAt)).toBeCloseTo(source.getX(0), 6);
    expect(uv?.getY(leavesAt)).toBeCloseTo(source.getY(0), 6);
    // So the maps it wears carry no transform — a second transform on top of
    // the baked one would tile the bark twice — over the SAME image.
    const map = merged.parts[0]?.material.map as unknown as FakeMap;
    expect(map.cloneOf).toBe(bark.map);
    expect(map.source).toBe(bark.map.source);
    expect(map.matrixAutoUpdate).toBe(false);
    expect(map.matrix.elements).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    expect(map.channel).toBe(0);
  });

  it('reads each fragment’s own layer in the shader, with the rung’s bias kept', () => {
    const { shape, leaves } = aTreeOfTwoMaterials();
    const material = mergeShapeMaterials(shape, 'tree').parts[0]?.material;
    const { vertex, fragment, uniforms } = compiledLayers(material);
    expect(vertex).toContain('attribute float oylLayer;');
    expect(vertex).toContain('flat varying float vOylLayer;');
    expect(vertex).toContain('vOylLayer = oylLayer;');
    expect(fragment).toContain('flat varying float vOylLayer;');
    // Layer 1 reads its own maps; layer 0 reads the material's.
    expect(fragment).toContain(
      'if (oylAt == 1) return textureGrad(oylLayerMap1, uv, oylDx, oylDy);',
    );
    expect(fragment).toContain('return textureGrad(map, uv, oylDx, oylDy);');
    expect(fragment).toContain(
      'if (oylAt == 1) return textureGrad(oylLayerNormalMap1, uv, oylDx, oylDy);',
    );
    expect(fragment).toContain('return textureGrad(normalMap, uv, oylDx, oylDy);');
    // Three's own reads are gone, and the normal scale is the layer's.
    expect(fragment).not.toContain('texture2D( map, vMapUv )');
    expect(fragment).not.toContain('texture2D( normalMap, vNormalMapUv )');
    expect(fragment).toContain('mapN.xy *= oylLayerNormalScale[ oylLayerOf() ];');
    expect(fragment).not.toContain('mapN.xy *= normalScale;');
    // #619's bias, as a gradient scale: 2^bias moves the level by exactly bias.
    expect(fragment).toContain('float oylGrow = exp2(oylTextureLodBias);');
    // In BOTH helpers — the colour read's and the normal read's.
    expect(fragment.split('vec2 oylDx = dFdx(uv) * oylGrow;')).toHaveLength(3);
    expect(fragment.split('vec2 oylDy = dFdy(uv) * oylGrow;')).toHaveLength(3);
    // Bark keeps every fragment; the leaves are cut.
    expect(fragment).toContain('if ( oylLayerCut[ oylLayerOf() ] < 0.5 ) diffuseColor.a = 1.0;');
    expect(uniforms['oylLayerCut']?.value).toEqual([0, 1]);
    expect((uniforms['oylLayerMap1']?.value as FakeMap | undefined)?.cloneOf).toBe(leaves.map);
    expect((uniforms['oylLayerNormalMap1']?.value as FakeMap | undefined)?.cloneOf).toBe(
      leaves.normalMap,
    );
    // The normal helper reads `normalMap`, so it follows three's declaration of it.
    expect(fragment.indexOf('vec4 oylLayerNormalTexel')).toBeGreaterThan(
      fragment.indexOf('#include <normalmap_pars_fragment>'),
    );
    const key = (material as unknown as { customProgramCacheKey: () => string })
      .customProgramCacheKey;
    expect(key()).toContain('|oyl-layers-2');
  });

  it('throws, naming #639, where three’s program no longer holds an include it splices at', () => {
    const material = mergeShapeMaterials(aTreeOfTwoMaterials().shape, 'tree').parts[0]?.material;
    // The #619 skeleton holds no `map_pars_fragment`.
    expect(() => compiledFragment(material)).toThrow(/#639/);
  });

  it('returns a shape of one material as it is', () => {
    const single = prepareRealisticShape(aScene([{ material: loaderMaterial() }]), 'rock');
    expect(mergeShapeMaterials(single, 'rock')).toBe(single);
  });

  it('refuses a layer whose colour and normal maps are read differently, or with no normal map', () => {
    const skewed = prepareRealisticShape(
      aScene([
        { material: loaderMaterial({ name: 'bark', map: aMap(BARK_TILING), normalMap: aMap() }) },
        { material: loaderMaterial({ name: 'leaves', map: aMap(), normalMap: aMap() }) },
      ]),
      'tree',
    );
    expect(() => mergeShapeMaterials(skewed, 'tree')).toThrow(/read differently/);
    const bare = prepareRealisticShape(
      aScene([
        { material: loaderMaterial({ name: 'bark', map: aMap(), normalMap: null }) },
        { material: loaderMaterial({ name: 'leaves', map: aMap(), normalMap: aMap() }) },
      ]),
      'tree',
    );
    expect(() => mergeShapeMaterials(bare, 'tree')).toThrow(/no normal map/);
  });

  it('refuses more layers than one draw can sample', () => {
    const many = prepareRealisticShape(
      aScene(
        ['a', 'b', 'c', 'd', 'e'].map((name) => ({
          material: loaderMaterial({ name, map: aMap(), normalMap: aMap() }),
        })),
      ),
      'tree',
    );
    expect(() => mergeShapeMaterials(many, 'tree')).toThrow(/more than one draw can layer/);
  });

  it('draws a merged tree in one mesh a level, in the canopy’s place in the order', () => {
    const merged = mergeShapeMaterials(aTreeOfTwoMaterials().shape, 'tree');
    const belt = new RealisticVegetationBelt(
      new Map([
        ['tree-broadleaf', [merged]],
        ['tree-conifer', [merged]],
      ] as const),
    );
    const levels = belt.levelsOf('tree-broadleaf');
    expect(levels.full[0]).toHaveLength(1);
    expect(levels.middle[0]).toHaveLength(1);
    // Its bark is in the one cut material now, so the whole tree is drawn
    // after the opaque world (#619 lever 1).
    for (const mesh of [...(levels.full[0] ?? []), ...(levels.middle[0] ?? [])]) {
      expect(mesh.renderOrder).toBeGreaterThan(0);
    }
  });
});

describe('treeCanBeSeen — #617’s review', () => {
  const at = (along: number, across: number, y: number): ScatterItem => ({
    ...item('tree-broadleaf', along, across),
    y,
  });

  it('never ranks out a tree the widest frame sees, climbing or descending', () => {
    let seed = 617;
    const random = (): number => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed / 2_147_483_648;
    };
    let seen = 0;
    let refused = 0;
    for (let sample = 0; sample < 6000; sample += 1) {
      // Pitch from about −17° (a steep descent) to about +11° (a steep climb).
      const pose = pitched(-8 + 16 * random());
      const radius = 0.3 + 3.7 * random();
      const height = 1 + 11 * random();
      const along = -12 + 40 * random();
      const edge = FRUSTUM_SPREAD * Math.max(0, along + CAMERA_BEHIND_METRES);
      const tree = at(along, edge - 10 + 25 * random(), -14 + 28 * random());
      if (!frustumSees(tree, pose, radius, height)) continue;
      seen += 1;
      if (!treeCanBeSeen(tree, pose, radius, height)) refused += 1;
    }
    // Non-vacuity: most of these stand near the cone's edge, and many are seen.
    expect(seen).toBeGreaterThan(1000);
    expect(refused).toBe(0);
  });

  it('ranks a tree whose trunk is outside the cone and whose crown reaches in', () => {
    // At eye level, 1 m in front of the camera: the cone is 4.2 m wide there.
    const tree = at(1 - CAMERA_BEHIND_METRES, FRUSTUM_SPREAD + 0.4, 2);
    expect(frustumSees(tree, POSE, 0.6, 0.1)).toBe(true);
    expect(treeCanBeSeen(tree, POSE, 0.6, 0.1)).toBe(true);
  });

  it('ranks a tree far below the eye on a descent, near the frame’s edge', () => {
    const pose = pitched(-8);
    const tree = at(10 - CAMERA_BEHIND_METRES, 50, -12);
    expect(frustumSees(tree, pose, 0.3, 3)).toBe(true);
    expect(treeCanBeSeen(tree, pose, 0.3, 3)).toBe(true);
  });

  it('ranks a tree whose crown stands above the eye on a steep climb', () => {
    // The camera pitched up about 4.7° — a climb of about 15 % — and a 14 m
    // tree standing at the eye's height 20 m ahead of it, a metre further out
    // than the cone and its crown's slack reach at the trunk's own depth. Its
    // top is deeper in the view than its trunk, by 14 m × sin 4.7°, and
    // that is where it shows.
    const pose = pitched(2 + 29.5 * Math.tan((4.7 * Math.PI) / 180));
    const across = FRUSTUM_SPREAD * 20 + Math.hypot(1, FRUSTUM_SPREAD) + 1;
    const tree = at(20 - CAMERA_BEHIND_METRES, across, 2);
    expect(frustumSees(tree, pose, 1, 14)).toBe(true);
    expect(treeCanBeSeen(tree, pose, 1, 14)).toBe(true);
  });

  it('ranks out a tree wholly behind the camera, and one far outside the cone', () => {
    expect(treeCanBeSeen(at(-8, 0, 0), POSE, 2, 8)).toBe(false);
    expect(treeCanBeSeen(at(10, 200, 0), POSE, 2, 8)).toBe(false);
  });
});

describe('the realistic world’s primitives belt — ADR 0026 D-3', () => {
  it('builds no mesh for a kind the vegetation or the structure belts draw', () => {
    const belt = new ScatterBelt(new Map(), { skip: REALISTIC_PRIMITIVE_SKIP, physical: true });
    for (const kind of REALISTIC_VEGETATION_KINDS) expect(belt.meshesOf(kind)).toEqual([]);
    // #475, layer 3: every structure is the structure belts' now.
    for (const kind of STRUCTURE_KINDS) expect(belt.meshesOf(kind), kind).toEqual([]);
    // ADR 0022 D-3's post stays procedural in both worlds, and is all that is left.
    expect(belt.meshesOf('post').length).toBe(1);
  });

  it('lights what it does draw physically, with a constructed material', () => {
    const belt = new ScatterBelt(new Map(), { physical: true });
    const mesh = belt.meshesOf('post')[0];
    expect(mesh === undefined ? undefined : typeOf(mesh)).toBe('MeshStandardMaterial');
    expect(isConstructedMaterial(mesh?.material as never)).toBe(true);
    // And the stylised belt still wears Lambert, which the environment does not reach.
    expect(typeOf(new ScatterBelt(new Map()).meshesOf('post')[0])).toBe('MeshLambertMaterial');
  });

  it('can be hidden, and then submits nothing', () => {
    const belt = new ScatterBelt(new Map());
    belt.setShown(false);
    belt.update([item('post', 10, 4)], POSE);
    expect(belt.meshesOf('post')[0]?.count).toBe(0);
  });
});

describe('what a realistic model may fetch besides itself — #478', () => {
  const own = realisticUrl('trees/oak_01.glb');
  const answer = realisticResourceUrl(own);

  it('answers the model’s own URL, and the blob and data URLs three makes for embedded images', () => {
    expect(answer(own)).toBe(own);
    expect(answer('blob:https://localhost/0f3c')).toBe('blob:https://localhost/0f3c');
    expect(answer('data:image/png;base64,iVBORw0KGgo=')).toBe('data:image/png;base64,iVBORw0KGgo=');
  });

  it('never answers with the network — whatever a file declares, it gets an empty buffer', () => {
    // The claim over the function's RANGE, as `scenery-models.test.ts` states
    // it for the stylised pack: nothing a glTF asks for comes back as a URL
    // that leaves this device.
    const hostile = [
      'https://example.invalid/anything.png',
      'http://127.0.0.1:9/probe',
      '//example.invalid/protocol-relative.png',
      'file:///etc/passwd',
      '../../../secret.png',
      'oak_01_bark.png',
      realisticUrl('trees/oak_01_bark.png'),
      `${own}.png`,
      own.toUpperCase(),
    ];
    for (const asked of hostile) {
      const answered = answer(asked);
      expect(answered, asked).not.toBe(asked);
      expect(answered, asked).toMatch(/^data:application\/octet-stream;base64,$/);
    }
  });
});

describe('the rung’s scenery budget, spent by both realistic belts together — #478', () => {
  /** Both belts the realistic world draws scenery with, given one budget as a view gives it. */
  function belts(budget?: number): {
    readonly vegetation: RealisticVegetationBelt;
    readonly primitives: ScatterBelt;
    readonly structures: RealisticStructureBelts;
  } {
    const vegetation = aBelt();
    const primitives = new ScatterBelt(new Map(), {
      skip: REALISTIC_PRIMITIVE_SKIP,
      physical: true,
    });
    const structures = aStructureBelt();
    if (budget !== undefined) {
      vegetation.setBudget(budget);
      primitives.setBudget(budget);
      structures.setBudget(budget);
    }
    return { vegetation, primitives, structures };
  }

  /**
   * A frame's worth of trees and posts, every one in view, alternating so that
   * the budget runs out in the middle of both kinds. Trees because every tree
   * the vegetation belt admits is DRAWN — the near ones as meshes, the rest as
   * impostors — so what it draws is a count of what it admitted.
   */
  function frame(count: number): ScatterItem[] {
    return Array.from({ length: count }, (_, index) =>
      item(index % 2 === 0 ? 'tree-broadleaf' : 'post', 5 + index * 0.5, index % 4 < 2 ? 3 : -3),
    );
  }

  /** The z of every tree the vegetation belt drew, one per item whatever its parts. */
  function drawnDepths(vegetation: RealisticVegetationBelt): number[] {
    const found: number[] = [];
    const firstPart = vegetation.meshes[0]?.material;
    for (const mesh of vegetation.meshes) {
      if (typeOf(mesh) !== 'ShaderMaterial' && mesh.material !== firstPart) continue;
      for (let slot = 0; slot < mesh.count; slot += 1) {
        found.push(mesh.instanceMatrix.array[slot * 16 + 14] as number);
      }
    }
    // #617: a band tree is submitted at two levels and is still one tree.
    return [...new Set(found)];
  }

  const rungBudget = (rung: QualitySettings): number => rung.scatterItems + rung.structureItems;

  it('draws no more than the second realistic rung allows, trees and posts together', () => {
    const reduced = rungBudget(REALISTIC_LADDER[1] as QualitySettings);
    const top = rungBudget(REALISTIC_LADDER[0] as QualitySettings);
    expect(reduced).toBeLessThan(top);
    const items = frame(top);
    const { vegetation, primitives } = belts(reduced);
    vegetation.update(items, POSE);
    primitives.update(items, POSE);
    // Exactly the rung's budget: half the admitted items are trees, which the
    // vegetation belt draws every one of, and half are posts.
    expect(vegetation.drawnItems + primitives.drawnItems).toBe(reduced);
    expect(vegetation.drawnItems).toBe(reduced / 2);
    expect(primitives.drawnItems).toBe(reduced / 2);
  });

  it('draws the whole frame at the top rung — the control, so the cut above is the budget', () => {
    const top = rungBudget(REALISTIC_LADDER[0] as QualitySettings);
    const items = frame(top);
    const { vegetation, primitives } = belts(top);
    vegetation.update(items, POSE);
    primitives.update(items, POSE);
    expect(vegetation.drawnItems + primitives.drawnItems).toBe(items.length);
  });

  it('admits the FIRST items in view in the frame’s order, as the stylised belt does', () => {
    // The budget four: the first four in view are two trees and two posts, and
    // an item out of view does not spend it.
    const items = [item('tree-broadleaf', -400), ...frame(10)];
    const { vegetation, primitives } = belts(4);
    vegetation.update(items, POSE);
    primitives.update(items, POSE);
    expect(vegetation.drawnItems).toBe(2);
    expect(primitives.drawnItems).toBe(2);
    // …and the trees drawn are the first two in the frame.
    expect(drawnDepths(vegetation).sort((a, b) => a - b)).toEqual([5, 6]);
  });

  it('spends one budget across trees, posts AND structures — #475', () => {
    // Thirds: a tree, a post and a house, all in view, so the cut lands in the
    // middle of all three.
    const kinds: readonly SceneryKind[] = ['tree-broadleaf', 'post', 'building'];
    const items = Array.from({ length: 60 }, (_, index) =>
      item(kinds[index % 3] as SceneryKind, 5 + index * 0.5, index % 2 === 0 ? 4 : -4),
    );
    const { vegetation, primitives, structures } = belts(30);
    vegetation.update(items, POSE);
    primitives.update(items, POSE);
    structures.update(items, POSE);
    expect(vegetation.drawnItems + primitives.drawnItems + structures.drawnItems).toBe(30);
    expect(structures.drawnItems).toBe(10);
    // And never a house's walls without its roof: both surfaces admit the
    // same houses.
    const walls = structures.beltOf('brick')?.meshesOf('building')[0]?.count;
    const roof = structures.beltOf('roof-tiles')?.meshesOf('building')[0]?.count;
    expect(walls).toBe(10);
    expect(roof).toBe(10);
  });

  it('draws nothing at a budget of nought, in either belt', () => {
    const { vegetation, primitives } = belts(0);
    vegetation.update(frame(20), POSE);
    primitives.update(frame(20), POSE);
    expect(vegetation.drawnItems + primitives.drawnItems).toBe(0);
  });

  it('is unbounded until a rung says otherwise, for ScatterBelt’s reason', () => {
    const { vegetation, primitives } = belts();
    vegetation.update(frame(40), POSE);
    primitives.update(frame(40), POSE);
    expect(vegetation.drawnItems + primitives.drawnItems).toBe(40);
  });

  it('reports nothing drawn while the stylised world is drawn', () => {
    const { vegetation } = belts();
    vegetation.update(frame(10), POSE);
    expect(vegetation.drawnItems).toBe(5);
    vegetation.setShown(false);
    vegetation.update(frame(10), POSE);
    expect(vegetation.drawnItems).toBe(0);
  });
});

/** A texture three would have loaded: the fields a material and a release read. */
function aTexture(): never {
  return { image: { width: 512, height: 512 }, dispose: () => undefined } as never;
}

/** The structure belts over fake textures, one colour and one normal map a surface. */
function aStructureBelt(): RealisticStructureBelts {
  return new RealisticStructureBelts(
    new Map(
      PHOTOGRAPHIC_STRUCTURE_SURFACES.map((surface) => [
        surface,
        { colour: aTexture(), normal: aTexture() },
      ]),
    ),
  );
}

describe('the realistic structures — ADR 0026 D-12 layer 3, #475', () => {
  it('dresses every structure only in surfaces its table names', () => {
    for (const kind of STRUCTURE_KINDS) {
      const worn = realisticStructureSurfaces(kind);
      expect(worn.length, kind).toBeGreaterThan(0);
      const named: readonly StructureSurface[] = isBuiltKind(kind)
        ? Object.values(REALISTIC_BUILDING_SURFACES[kind])
        : REALISTIC_BOUNDARY_PARTS[kind];
      for (const surface of worn) expect(named, `${kind} wears ${surface}`).toContain(surface);
    }
  });

  it('draws a house as brick walls, a tiled roof, timber frames and glass, placed by one item — #500', () => {
    const belt = aStructureBelt();
    belt.update([item('building', 20, 9)], POSE);
    const walls = belt.beltOf('brick')?.meshesOf('building')[0];
    const roof = belt.beltOf('roof-tiles')?.meshesOf('building')[0];
    expect(walls?.count).toBe(1);
    expect(roof?.count).toBe(1);
    // The same matrix: one house, not two things near each other.
    expect(Array.from(walls?.instanceMatrix.array.slice(0, 16) ?? [])).toEqual(
      Array.from(roof?.instanceMatrix.array.slice(0, 16) ?? []),
    );
    // Counted once.
    expect(belt.drawnItems).toBe(1);
    // #500: its frames and its door are timber, its panes glass, on the same matrix.
    for (const surface of ['planks', 'glass'] as const) {
      const mesh = belt.beltOf(surface)?.meshesOf('building')[0];
      expect(mesh?.count, surface).toBe(1);
      expect(Array.from(mesh?.instanceMatrix.array.slice(0, 16) ?? []), surface).toEqual(
        Array.from(walls?.instanceMatrix.array.slice(0, 16) ?? []),
      );
    }
    // And no other surface draws a house.
    for (const surface of ['slate', 'stone', 'corrugated', 'hedge', 'painted'] as const) {
      expect(belt.beltOf(surface)?.meshesOf('building') ?? [], surface).toEqual([]);
    }
  });

  it('draws every kind it is handed, each counted once', () => {
    const belt = aStructureBelt();
    belt.update(
      STRUCTURE_KINDS.map((kind, index) => item(kind, 10 + index * 5, 9)),
      POSE,
    );
    expect(belt.drawnItems).toBe(STRUCTURE_KINDS.length);
  });

  it('wears only constructed, physically based materials carrying the world’s photographs — D-10, D-11', () => {
    const textures = new Map(
      PHOTOGRAPHIC_STRUCTURE_SURFACES.map((surface) => [
        surface,
        { colour: aTexture(), normal: aTexture() },
      ]),
    );
    const belt = new RealisticStructureBelts(textures);
    for (const surface of [...PHOTOGRAPHIC_STRUCTURE_SURFACES, 'painted', 'glass'] as const) {
      const meshes = STRUCTURE_KINDS.flatMap((kind) => belt.beltOf(surface)?.meshesOf(kind) ?? []);
      expect(meshes.length, surface).toBeGreaterThan(0);
      for (const mesh of meshes) {
        expect(typeOf(mesh), surface).toBe('MeshStandardMaterial');
        expect(isConstructedMaterial(mesh.material as never), surface).toBe(true);
        const material = mesh.material as unknown as {
          map: unknown;
          normalMap: unknown;
          vertexColors: boolean;
        };
        // #500: the grounding and each part's shade are in the vertex colour,
        // which a material that does not read it would silently drop.
        expect(material.vertexColors, surface).toBe(true);
        // #500: glass is a material and no photograph — it adds no texture.
        if (surface === 'painted' || surface === 'glass') {
          expect(material.map).toBeNull();
        } else {
          expect(material.map, surface).toBe(textures.get(surface)?.colour);
          expect(material.normalMap, surface).toBe(textures.get(surface)?.normal);
        }
      }
    }
  });

  it('lays a photograph out in metres, so a brick is the same size on every wall', () => {
    const tile = REALISTIC_STRUCTURE_SURFACES.brick.tileMetres;
    const walls = realisticStructureGeometry('building', 'brick');
    const position = walls?.getAttribute('position');
    const uv = walls?.getAttribute('uv');
    expect(position).toBeDefined();
    expect(uv?.count).toBe(position?.count);
    let checked = 0;
    for (let at = 0; at < (position?.count ?? 0); at += 1) {
      const u = (uv?.getX(at) ?? 0) * tile;
      const v = (uv?.getY(at) ?? 0) * tile;
      // Every coordinate is one of the vertex's own positions, in metres.
      const own = [position?.getX(at), position?.getY(at), position?.getZ(at)];
      expect(
        own.some((each) => Math.abs((each ?? NaN) - u) < 1e-4),
        `u at ${String(at)}`,
      ).toBe(true);
      expect(
        own.some((each) => Math.abs((each ?? NaN) - v) < 1e-4),
        `v at ${String(at)}`,
      ).toBe(true);
      checked += 1;
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('has no surface nothing wears, and wears no surface it has no maps for', () => {
    const worn = new Set<StructureSurface>(STRUCTURE_KINDS.flatMap(realisticStructureSurfaces));
    expect([...worn].sort()).toEqual(
      [...PHOTOGRAPHIC_STRUCTURE_SURFACES, 'painted', 'glass'].sort(),
    );
  });
});

describe('the water on the realistic rungs — #475', () => {
  const STYLE = { skyColour: 0x87b5e0, horizonColour: 0xc9dbe6 } as never;
  const uniform = (water: WaterBelt, name: string): readonly number[] => {
    const material = water.mesh.material as unknown as {
      uniforms: Record<string, { value: { r: number; g: number; b: number } }>;
    };
    const colour = material.uniforms[name]?.value;
    return [colour?.r ?? NaN, colour?.g ?? NaN, colour?.b ?? NaN];
  };
  const luminance = ([r, g, b]: readonly number[]): number =>
    0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
  const surface = {
    vertices: new Float32Array(0),
    shore: new Float32Array(0),
    indices: new Uint32Array(0),
  } as never;

  it('reflects the realistic sky’s hue at the brightness the stylised water was tuned to', () => {
    const water = new WaterBelt();
    // Grey above, warm at the horizon: nothing like the stylised blue.
    const reflection = { zenith: [2, 2, 2], horizon: [3, 2, 1] } as const;
    water.update(surface, STYLE, 0);
    const stylisedSky = uniform(water, 'skyColour');
    const stylisedHorizon = uniform(water, 'horizonColour');
    water.update(surface, STYLE, 0, reflection);
    const sky = uniform(water, 'skyColour');
    const horizon = uniform(water, 'horizonColour');
    // The same brightness…
    expect(luminance(sky)).toBeCloseTo(luminance(stylisedSky), 6);
    expect(luminance(horizon)).toBeCloseTo(luminance(stylisedHorizon), 6);
    // …in the photograph's colour: grey is grey, and the horizon is warm.
    expect(sky[0]).toBeCloseTo(sky[2] ?? NaN, 6);
    expect(horizon[0] ?? 0).toBeGreaterThan(horizon[2] ?? 0);
    expect(stylisedSky[2] ?? 0).toBeGreaterThan(stylisedSky[0] ?? 0);
  });

  it('reflects the stylised sky when no realistic one is handed it', () => {
    const water = new WaterBelt();
    water.update(surface, STYLE, 0, { zenith: [2, 2, 2], horizon: [3, 2, 1] });
    water.update(surface, STYLE, 0);
    expect(uniform(water, 'skyColour')[2] ?? 0).toBeGreaterThan(
      uniform(water, 'skyColour')[0] ?? 0,
    );
  });
});

describe('loading the realistic world — ADR 0026 D-7', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** Loaders that answer from memory, and remember what they were asked for. */
  function loaders(fail?: string): RealisticLoaders & { asked: string[] } {
    const asked: string[] = [];
    const texture = (): unknown => ({
      image: { width: 1024, height: 1024 },
      dispose: () => undefined,
    });
    const scene = (extras: Record<string, unknown>): unknown => ({
      userData: extras,
      updateWorldMatrix: () => undefined,
      traverse: (visit: (node: unknown) => void) => {
        visit({ isMesh: false, userData: extras });
        visit({
          isMesh: true,
          geometry: aGeometry(),
          material: loaderMaterial(),
          matrixWorld: IDENTITY,
          userData: {},
        });
      },
    });
    const sky = (): unknown => {
      const data = new Float32Array(16 * 8 * 4).fill(1);
      // A sun: one bright texel high in the picture.
      data[(1 * 16 + 5) * 4] = 50;
      data[(1 * 16 + 5) * 4 + 1] = 50;
      data[(1 * 16 + 5) * 4 + 2] = 50;
      return { image: { width: 16, height: 8, data }, type: 'float', dispose: () => undefined };
    };
    const refuse = (url: string): Promise<never> =>
      Promise.reject(new Error(`${url}: Failed to fetch`));
    return {
      asked,
      sky: (url) => {
        asked.push(url);
        return url.includes(fail ?? ' ') ? refuse(url) : Promise.resolve(sky() as never);
      },
      texture: (url) => {
        asked.push(url);
        return url.includes(fail ?? ' ') ? refuse(url) : Promise.resolve(texture() as never);
      },
      model: (url) => {
        asked.push(url);
        return url.includes(fail ?? ' ')
          ? refuse(url)
          : Promise.resolve(
              scene({
                oyl_scan_height: 8,
                oyl_scan_width: 4,
                oyl_impostor_scale: 8.2,
                oyl_impostor_frames: 8,
              }) as never,
            );
      },
    };
  }

  it('loads the whole world from the realistic directory, and says it did', async () => {
    const reading = loaders();
    await expect(loadRealisticWorld(reading)).resolves.toEqual({ loaded: true });
    expect(realisticWorldLoaded()).toBe(true);
    expect(reading.asked).toContain(realisticUrl(REALISTIC_SKY));
    // #475: and every structure surface's two maps.
    for (const surface of PHOTOGRAPHIC_STRUCTURE_SURFACES) {
      expect(reading.asked).toContain(realisticUrl(REALISTIC_STRUCTURE_SURFACES[surface].colour));
      expect(reading.asked).toContain(realisticUrl(REALISTIC_STRUCTURE_SURFACES[surface].normal));
    }
    for (const url of reading.asked) expect(url).toMatch(/^\/realistic\//);
  });

  it('loads none of it when one file fails, and says why — never half a world', async () => {
    await expect(loadRealisticWorld(loaders())).resolves.toEqual({ loaded: true });
    // A second whole load replaces the first, releasing it after the swap.
    await expect(loadRealisticWorld(loaders())).resolves.toEqual({ loaded: true });
    const outcome = await loadRealisticWorld(loaders('shrub_02_c'));
    expect(outcome).toMatchObject({ loaded: false, offline: false });
    expect(outcome.loaded ? '' : outcome.detail).toMatch(/shrub_02_c/);
    // ⚠️ The earlier load is still the one a view would draw: a failed reload
    // must not leave a half-built world behind it, and must not discard a
    // whole one either.
    expect(realisticWorldLoaded()).toBe(true);
  });

  it('swaps a new world in before it releases the old one, so a release that fails loses neither', async () => {
    // ⚠️ The first version released the old world first, inside the load, and
    // a release that threw left NO world and reported the load as failed —
    // found by this file's own fixtures, whose textures had no `dispose`.
    const brittle = loaders();
    const texture = brittle.texture;
    await loadRealisticWorld({
      ...brittle,
      texture: (url) =>
        texture(url).then((loaded) =>
          Object.assign(loaded, {
            dispose: () => {
              throw new Error('a texture that will not let go');
            },
          }),
        ),
    });
    await expect(loadRealisticWorld(loaders())).resolves.toEqual({ loaded: true });
    expect(realisticWorldLoaded()).toBe(true);
  });

  it('loads none of it when a structure’s surface fails — a world without its buildings is half a world (#475)', async () => {
    await expect(loadRealisticWorld(loaders())).resolves.toEqual({ loaded: true });
    const outcome = await loadRealisticWorld(loaders('old_stone_wall_nor_gl'));
    expect(outcome).toMatchObject({ loaded: false });
    expect(outcome.loaded ? '' : outcome.detail).toMatch(/old_stone_wall_nor_gl/);
  });

  it('loads the bicycle’s four drawn maps with everything else, and none of it without them — #624', async () => {
    const reading = loaders();
    await expect(loadRealisticWorld(reading)).resolves.toEqual({ loaded: true });
    for (const map of REALISTIC_BICYCLE_MAP_NAMES) {
      expect(reading.asked).toContain(realisticUrl(REALISTIC_BICYCLE_MAPS[map]));
    }
    const outcome = await loadRealisticWorld(loaders('bicycle_rubber_nor_gl'));
    expect(outcome).toMatchObject({ loaded: false });
    expect(outcome.loaded ? '' : outcome.detail).toMatch(/bicycle_rubber_nor_gl/);
  });

  it('says it was offline when the browser says so, which is the fallback D-7 names', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    const outcome = await loadRealisticWorld(loaders('farm_field'));
    expect(outcome).toMatchObject({ loaded: false, offline: true });
  });
});

describe('a failed load releases everything it loaded, including what arrives late — #478', () => {
  /** Something the loader made, and whether anything let go of it. */
  interface Held {
    readonly url: string;
    released: boolean;
  }

  /**
   * Loaders whose every file answers LATE — a few milliseconds after the call —
   * except the one whose URL contains `fail`, which is refused at once. That is
   * the order a flaky network produces, and it is the one `Promise.all` lost:
   * it rejected on the refusal and returned while everything else was still in
   * flight, so what arrived afterwards was held by nobody.
   */
  function lateLoaders(options: {
    readonly fail?: string;
    readonly unsized?: string;
    /** A URL part whose files answer LATER than every other — #475. */
    readonly slowest?: string;
  }): {
    readonly loaders: RealisticLoaders;
    readonly held: Held[];
  } {
    const held: Held[] = [];
    const late = <T>(make: () => T, ms: number): Promise<T> =>
      new Promise((resolve) => {
        setTimeout(() => {
          resolve(make());
        }, ms);
      });
    const answer = <T>(url: string, make: (one: Held) => T): Promise<T> => {
      if (options.fail !== undefined && url.includes(options.fail)) {
        return Promise.reject(new Error(`${url}: Failed to fetch`));
      }
      const slow = options.slowest !== undefined && url.includes(options.slowest);
      return late(
        () => {
          const one: Held = { url, released: false };
          held.push(one);
          return make(one);
        },
        slow ? 20 : 5,
      );
    };
    const texture = (one: Held): unknown => ({
      image: { width: 64, height: 64 },
      dispose: () => {
        one.released = true;
      },
    });
    const scene = (one: Held): unknown => {
      const extras: Record<string, unknown> =
        options.unsized !== undefined && one.url.includes(options.unsized)
          ? {}
          : {
              oyl_scan_height: 8,
              oyl_scan_width: 4,
              oyl_impostor_scale: 8,
              oyl_impostor_frames: 8,
            };
      const geometry = aGeometry();
      const dispose = geometry.dispose.bind(geometry);
      // `releaseLoadedScene` is what disposes a loaded scene's own geometry —
      // `prepareRealisticShape` works on a clone of it — so this is "released".
      geometry.dispose = () => {
        one.released = true;
        dispose();
      };
      const node = {
        isMesh: true,
        geometry,
        material: loaderMaterial(),
        matrixWorld: IDENTITY,
        userData: {},
      };
      return {
        userData: extras,
        updateWorldMatrix: () => undefined,
        traverse: (visit: (node: unknown) => void) => {
          visit({ isMesh: false, userData: extras });
          visit(node);
        },
      };
    };
    const sky = (one: Held): unknown => ({
      image: { width: 16, height: 8, data: new Float32Array(16 * 8 * 4).fill(1) },
      type: 'float',
      dispose: () => {
        one.released = true;
      },
    });
    return {
      held,
      loaders: {
        sky: (url) => answer(url, sky) as never,
        texture: (url) => answer(url, texture) as never,
        model: (url) => answer(url, scene) as never,
      },
    };
  }

  it('waits for the loads still in flight, and releases every one of them', async () => {
    const { loaders, held } = lateLoaders({ fail: REALISTIC_SKY });
    const outcome = await loadRealisticWorld(loaders);
    expect(outcome.loaded).toBe(false);
    // Past the last late answer, so that a load which returned early is judged
    // on what arrived after it rather than on what had not arrived yet.
    await new Promise((resolve) => setTimeout(resolve, 30));
    // Every other file was asked for and answered…
    expect(held.length).toBeGreaterThan(10);
    // …and not one of them is still held.
    expect(held.filter((one) => !one.released).map((one) => one.url)).toEqual([]);
  });

  it('waits for the structures’ surfaces too, however late they answer — #475', async () => {
    // Every structure map answers after every other file. A load that did not
    // settle them before deciding would have released everything else and
    // left these held by nobody.
    const { loaders, held } = lateLoaders({ fail: REALISTIC_SKY, slowest: '_512.ktx2' });
    const outcome = await loadRealisticWorld(loaders);
    expect(outcome.loaded).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 50));
    const surfaces = held.filter((one) => one.url.includes('_512.ktx2'));
    expect(surfaces.length).toBe(2 * PHOTOGRAPHIC_STRUCTURE_SURFACES.length);
    expect(surfaces.filter((one) => !one.released).map((one) => one.url)).toEqual([]);
  });

  it('releases the materials it had built for the trees before a later model failed', async () => {
    const disposed: unknown[] = [];
    const standard = Object.getPrototypeOf(
      new ScatterBelt(new Map(), { physical: true }).meshesOf('post')[0]?.material,
    ) as { dispose: () => void };
    const spy = vi.spyOn(standard, 'dispose').mockImplementation(function (this: unknown) {
      disposed.push(this);
    });
    try {
      // Every file loads; the LAST vegetation model records no scan size, so
      // `prepareRealisticShape` throws after every model before it was built.
      const lastKind = REALISTIC_VEGETATION_KINDS[REALISTIC_VEGETATION_KINDS.length - 1];
      const models = REALISTIC_VEGETATION[lastKind as (typeof REALISTIC_VEGETATION_KINDS)[number]];
      const last = models[models.length - 1];
      const { loaders } = lateLoaders({ unsized: last?.file ?? 'none' });
      const outcome = await loadRealisticWorld(loaders);
      expect(outcome).toMatchObject({ loaded: false });
      expect(outcome.loaded ? '' : outcome.detail).toMatch(/records no scan size/);
      const built = REALISTIC_VEGETATION_KINDS.reduce(
        (sum, kind) => sum + REALISTIC_VEGETATION[kind].length,
        0,
      );
      // One constructed material per model built (each fixture has one part),
      // and every one of them let go of.
      const constructedDisposed = disposed.filter((each) =>
        isConstructedMaterial(each as never),
      ).length;
      expect(constructedDisposed).toBe(built - 1);
    } finally {
      spy.mockRestore();
    }
  });
});

/** A material's fragment shader after its `onBeforeCompile`, from a stand-in three would hand it. */
function compiledFragment(material: unknown): {
  fragment: string;
  uniforms: Record<string, unknown>;
} {
  const shader = {
    uniforms: {} as Record<string, unknown>,
    vertexShader:
      '#include <common>\n#include <begin_vertex>\n#include <color_vertex>\n#include <fog_pars_vertex>\n#include <fog_vertex>',
    fragmentShader:
      '#include <common>\n#include <clipping_planes_fragment>\n#include <map_fragment>\n#include <color_fragment>\n#include <fog_pars_fragment>\n#include <fog_fragment>',
  };
  (material as { onBeforeCompile: (shader: unknown, renderer: unknown) => void }).onBeforeCompile(
    shader,
    undefined,
  );
  return { fragment: shader.fragmentShader, uniforms: shader.uniforms };
}

describe('what the realistic world costs the GPU, lever by lever — #619', () => {
  const beltWithMiddle = (): RealisticVegetationBelt => {
    const tree = aTreeWithMiddle();
    const rock = prepareRealisticShape(aScene([{ material: loaderMaterial() }]), 'rock');
    const shrub = prepareRealisticShape(
      aScene([{ material: loaderMaterial({ transparent: true }) }]),
      'shrub',
    );
    return new RealisticVegetationBelt(
      new Map([
        ['tree-broadleaf', [tree]],
        ['tree-conifer', [tree]],
        ['shrub', [shrub]],
        ['rock', [rock]],
      ] as const),
    );
  };
  const alphaTested = (mesh: RealisticVegetationBelt['meshes'][number]): boolean =>
    typeOf(mesh) === 'ShaderMaterial' ||
    (mesh.material as unknown as { alphaTest: number }).alphaTest > 0;

  it('draws every alpha-tested leaf after the opaque world, nearest level first — lever 1', () => {
    const belt = beltWithMiddle();
    const levels = belt.levelsOf('tree-broadleaf');
    const orderOf = (meshes: readonly (RealisticVegetationBelt['meshes'][number] | undefined)[]) =>
      meshes
        .filter((mesh) => mesh !== undefined && alphaTested(mesh))
        .map((mesh) => mesh?.renderOrder);
    const near = orderOf(levels.full.flat());
    const middle = orderOf((levels.middle[0] ?? []).slice());
    const impostor = orderOf(levels.impostor);
    // Non-vacuity: each level has a cut mesh to order.
    expect(near.length).toBeGreaterThan(0);
    expect(middle.length).toBeGreaterThan(0);
    expect(impostor.length).toBeGreaterThan(0);
    // After everything opaque, which three draws at 0…
    for (const order of [...near, ...middle, ...impostor]) expect(order).toBeGreaterThan(0);
    // …and near before middle before the far band.
    expect(Math.max(...(near as number[]))).toBeLessThan(Math.min(...(middle as number[])));
    expect(Math.max(...(middle as number[]))).toBeLessThan(Math.min(...(impostor as number[])));
    // A shrub's cut leaves are foliage too.
    const shrubs = belt.meshes.filter(
      (mesh) => alphaTested(mesh) && !belt.levelsOf('tree-broadleaf').full.flat().includes(mesh),
    );
    expect(shrubs.length).toBeGreaterThan(0);
  });

  it('puts every mesh back where three draws it unasked for the control, and restores the order — lever 1', () => {
    const belt = beltWithMiddle();
    const product = belt.meshes.map((mesh) => mesh.renderOrder);
    // Non-vacuity: the product order is not already all nought.
    expect(product.some((order) => order > 0)).toBe(true);
    belt.setFoliageOrdered(false);
    for (const mesh of belt.meshes) expect(mesh.renderOrder).toBe(0);
    belt.setFoliageOrdered(true);
    expect(belt.meshes.map((mesh) => mesh.renderOrder)).toEqual(product);
  });

  it('leaves bark and rock with the opaque world, where three sorts them by material and depth', () => {
    const belt = beltWithMiddle();
    const opaque = belt.meshes.filter((mesh) => !alphaTested(mesh));
    // Bark at two levels of two kinds, and the rock.
    expect(opaque.length).toBeGreaterThanOrEqual(3);
    for (const mesh of opaque) expect(mesh.renderOrder).toBe(0);
  });

  it('teaches every photograph the realistic world samples the rung’s texture bias — lever 2', () => {
    const belt = beltWithMiddle();
    for (const mesh of belt.meshes) {
      expect(readsTextureLodBias(mesh.material as never), typeOf(mesh)).toBe(true);
    }
    const structures = aStructureBelt();
    for (const surface of [...PHOTOGRAPHIC_STRUCTURE_SURFACES, 'painted', 'glass'] as const) {
      for (const mesh of STRUCTURE_KINDS.flatMap(
        (kind) => structures.beltOf(surface)?.meshesOf(kind) ?? [],
      )) {
        // Painted and glass sample no photograph, so they are left alone.
        const photographic = surface !== 'painted' && surface !== 'glass';
        expect(readsTextureLodBias(mesh.material as never), surface).toBe(photographic);
      }
    }
  });

  it('turns every texture read the bias’s way in the fragment, with the one shared uniform', () => {
    const tree = aTreeWithMiddle();
    const bark = tree.parts[0]?.material;
    const impostor = tree.impostor?.material;
    const barkShader = compiledFragment(bark);
    const impostorShader = compiledFragment(impostor);
    for (const { fragment } of [barkShader, impostorShader]) {
      expect(fragment).toContain('uniform float oylTextureLodBias;');
      expect(fragment).toContain('#undef texture2D');
      expect(fragment).toContain(
        '#define texture2D(oylSampler, oylUv) texture(oylSampler, oylUv, oylTextureLodBias)',
      );
    }
    // One object, so a view setting the rung's value once reaches every program.
    expect(barkShader.uniforms['oylTextureLodBias']).toBeDefined();
    expect(barkShader.uniforms['oylTextureLodBias']).toBe(
      impostorShader.uniforms['oylTextureLodBias'],
    );
  });

  it('biases nothing the stylised world draws', () => {
    const stylised = new ScatterBelt(new Map());
    const meshes = STRUCTURE_KINDS.flatMap((kind) => stylised.meshesOf(kind)).concat(
      stylised.meshesOf('rock'),
    );
    expect(meshes.length).toBeGreaterThan(0);
    for (const mesh of meshes) expect(readsTextureLodBias(mesh.material as never)).toBe(false);
  });

  it('biases the photographic road and ground, the largest photographs in the world — lever 2', () => {
    // A stand-in photograph: neither builder reads a texture before it compiles.
    const photograph = { isTexture: true } as never;
    const road = photographicRoadMaterial(photograph, photograph);
    const ground = photographicGroundMaterial(photograph, photograph, { value: 1 }, { value: 1 });
    for (const [name, material] of [
      ['road', road],
      ['ground', ground],
    ] as const) {
      expect(readsTextureLodBias(material), name).toBe(true);
      // Taught in the shader too, not only recorded: the bias is the last
      // thing the fragment is given, after the road's sheen and the ground's
      // patchwork.
      const { fragment, uniforms } = compiledFragment(material);
      expect(fragment, name).toContain(
        '#define texture2D(oylSampler, oylUv) texture(oylSampler, oylUv, oylTextureLodBias)',
      );
      expect(uniforms['oylTextureLodBias'], name).toBeDefined();
    }
  });
});

/** The realistic bicycle as built when #624 gave it surfaces: 5 308 triangles. */
const BICYCLE_TRIANGLES_BEFORE_SURFACES = 5_308;

describe('the realistic bicycle — #369', () => {
  it('is built from bicycle.ts’s own parts inside its budget', () => {
    // ⚠️ **This is the only reader of `realisticBicycleTriangles`, and it has
    // been since the commit that created the export.** #369 proposed a second
    // copy of it in `realistic-budget.test.ts` on the strength of a claim that
    // nothing read the export; that claim was measured false against `b4f789a`
    // — this assertion goes red there under `spokes = 20` → `900` with
    // `expected 26332 to be less than or equal to 12000` — and the copy is
    // gone. The tag on the export named the wrong file, which is a different
    // and much smaller thing than no test existing.
    //
    // Measured across #369's drop bar: **5 212** triangles with one straight
    // tube across, **5 308** with the bend and the drops. The bar costs 96.
    const triangles = realisticBicycleTriangles();
    expect(triangles).toBeGreaterThan(1_000);
    expect(triangles).toBeLessThanOrEqual(REALISTIC_BICYCLE_TRIANGLES);
    // #624: surfaces as maps, not triangles — the bicycle as built stays at
    // the 5 308 #506's frame sum counts, or under it. The ceiling above is
    // 12 000 and would let 6 000 more through, every one of them out of the
    // frame's 1 350 spare.
    expect(triangles).toBeLessThanOrEqual(BICYCLE_TRIANGLES_BEFORE_SURFACES);
  });
});

describe('the realistic bicycle’s surfaces — #624', () => {
  /** Stand-in textures: what matters is which one each material wears. */
  const maps: RealisticBicycleMaps = {
    rubberNormal: { name: 'rubberNormal' } as never,
    metalNormal: { name: 'metalNormal' } as never,
    metalRoughness: { name: 'metalRoughness' } as never,
    paintRoughness: { name: 'paintRoughness' } as never,
  };
  const built = realisticBicycleMeshes(maps, 3);
  type Built = typeof built.frame;
  /** A mesh's one material, as the fields this reads. */
  const materialOf = (mesh: Built): Record<string, unknown> =>
    mesh.material as unknown as Record<string, unknown>;
  /** Every vertex of a mesh's geometry: where it is and where it samples. */
  const verticesOf = (
    mesh: Built,
  ): readonly { x: number; y: number; z: number; u: number; v: number }[] => {
    const position = mesh.geometry.getAttribute('position');
    const uv = mesh.geometry.getAttribute('uv');
    expect(uv, 'a uv attribute').toBeDefined();
    expect(uv.count).toBe(position.count);
    return Array.from({ length: position.count }, (_, at) => ({
      x: position.getX(at),
      y: position.getY(at),
      z: position.getZ(at),
      u: uv.getX(at),
      v: uv.getY(at),
    }));
  };
  const close = (a: number, b: number): boolean => Math.abs(a - b) < 1e-6;

  it('wears only materials this file constructs, on the three meshes the bicycle already was — D-11', () => {
    for (const mesh of [built.frame, built.rubber, built.metal, built.cranks]) {
      expect(typeOf(mesh)).toBe('MeshStandardMaterial');
      expect(isConstructedMaterial(mesh.material as never)).toBe(true);
      // No colour map: the per-instance tint (#368) multiplies the colour alone.
      expect(materialOf(mesh)['map'] ?? null).toBeNull();
    }
    // The cranks share the metal's material, as they did: no new draw state.
    expect(built.cranks.material).toBe(built.metal.material);
  });

  it('puts each map on the material it was drawn for', () => {
    expect(materialOf(built.rubber)['normalMap']).toBe(maps.rubberNormal);
    expect(materialOf(built.metal)['normalMap']).toBe(maps.metalNormal);
    expect(materialOf(built.metal)['roughnessMap']).toBe(maps.metalRoughness);
    expect(materialOf(built.frame)['roughnessMap']).toBe(maps.paintRoughness);
    // The paint is roughness ALONE — no normal map, and not a clear-coat lobe.
    expect(materialOf(built.frame)['normalMap'] ?? null).toBeNull();
    expect(typeOf(built.frame)).not.toBe('MeshPhysicalMaterial');
  });

  it('samples the tread at the crown of each tyre, and a whole number of tread tiles round it', () => {
    const wheels = RIDER_BICYCLE_PARTS.filter((part) => part.solid.shape === 'ring');
    expect(wheels).toHaveLength(2);
    const rubber = verticesOf(built.rubber);
    for (const wheel of wheels) {
      if (wheel.solid.shape !== 'ring') continue;
      const outer = wheel.solid.radius + wheel.solid.thickness;
      const crown = rubber.filter((vertex) =>
        close(Math.hypot(vertex.y - wheel.y, vertex.z - wheel.z), outer),
      );
      // Non-vacuity: the crown ring of the torus, 49 vertices a side of each seam.
      expect(crown.length, wheel.name).toBeGreaterThan(40);
      for (const vertex of crown) {
        expect(
          close(vertex.v, bandV(TYRE_BAND, 0)) || close(vertex.v, bandV(TYRE_BAND, 1)),
          `${wheel.name} ${String(vertex.v)}`,
        ).toBe(true);
      }
      const tiles = Math.max(...crown.map((vertex) => vertex.u));
      expect(tiles, wheel.name).toBeGreaterThan(5);
      expect(Number.isInteger(Math.round(tiles * 1e6) / 1e6), wheel.name).toBe(true);
    }
  });

  it('tapes the bar along its length, and puts the saddle on the flat bead', () => {
    const rubber = verticesOf(built.rubber);
    const tape = rubber.filter(
      (vertex) => vertex.v >= bandV(TAPE_BAND, 0) - 1e-6 && vertex.v <= bandV(TAPE_BAND, 1) + 1e-6,
    );
    expect(tape.length).toBeGreaterThan(100);
    // Along the bar the tape repeats: a coordinate that ran 0 to 1 would
    // stretch one tile over every part.
    expect(Math.max(...tape.map((vertex) => vertex.u))).toBeGreaterThan(2);
    const saddle = RIDER_BICYCLE_PARTS.find((part) => part.solid.shape === 'box');
    const onSaddle = rubber.filter(
      (vertex) =>
        saddle !== undefined &&
        close(vertex.u, PLAIN_RUBBER_UV[0]) &&
        close(vertex.v, PLAIN_RUBBER_UV[1]),
    );
    expect(onSaddle.length).toBe(36);
  });

  it('puts the chainring’s teeth at its crown and the cassette across the REAR hub only, drive side out', () => {
    const chainring = RIDER_CRANK_PARTS.find((part) => part.solid.shape === 'ring');
    if (chainring === undefined || chainring.solid.shape !== 'ring')
      throw new Error('no chainring');
    const crownRadius = chainring.solid.radius + chainring.solid.thickness / 2;
    const cranks = verticesOf(built.cranks);
    const crown = cranks.filter((vertex) => close(Math.hypot(vertex.y, vertex.z), crownRadius));
    expect(crown.length).toBeGreaterThan(30);
    for (const vertex of crown) {
      expect(
        close(vertex.v, bandV(CHAINRING_BAND, 0)) || close(vertex.v, bandV(CHAINRING_BAND, 1)),
      ).toBe(true);
    }
    // 48 teeth, eight to a tile: six tiles round the ring, so it closes.
    expect(Math.max(...crown.map((vertex) => vertex.u))).toBeCloseTo(6, 6);
    const metal = verticesOf(built.metal);
    const cassette = metal.filter(
      (vertex) =>
        vertex.v >= bandV(CASSETTE_BAND, 0) - 1e-6 && vertex.v <= bandV(CASSETTE_BAND, 1) + 1e-6,
    );
    expect(cassette.length).toBeGreaterThan(20);
    const rear = RIDER_BICYCLE_PARTS.filter(
      (part) => part.solid.shape === 'ring' && part.z < CRANK_AXIS_Z,
    );
    expect(rear).toHaveLength(1);
    for (const vertex of cassette) {
      // On the rear hub — the wheel behind the bottom bracket — and nowhere else.
      expect(Math.hypot(vertex.y - (rear[0]?.y ?? 0), vertex.z - (rear[0]?.z ?? 0))).toBeLessThan(
        0.021,
      );
      // The drive side, +x, is the band's far end; the other side its near end.
      const across =
        (vertex.v - bandV(CASSETTE_BAND, 0)) / (bandV(CASSETTE_BAND, 1) - bandV(CASSETTE_BAND, 0));
      expect(across).toBeCloseTo(0.5 + vertex.x / 0.1, 6);
    }
    // Everything else metal is plain.
    const plain = metal.filter((vertex) => close(vertex.v, PLAIN_METAL_UV[1]));
    expect(plain.length + cassette.length).toBe(metal.length);
  });

  it('paints the frame by the metre, round each tube and along it', () => {
    const frame = verticesOf(built.frame);
    expect(Math.min(...frame.map((vertex) => vertex.u))).toBeGreaterThanOrEqual(0);
    expect(Math.max(...frame.map((vertex) => vertex.u))).toBeLessThanOrEqual(1);
    // The longest tube is over two paint tiles long.
    expect(Math.max(...frame.map((vertex) => vertex.v))).toBeGreaterThan(2);
  });
});

/** A lit material's vertex and fragment shaders after its `onBeforeCompile`. */
function compiledBoth(material: unknown): { vertex: string; fragment: string } {
  const shader = {
    uniforms: {} as Record<string, unknown>,
    vertexShader:
      '#include <common>\n#include <begin_vertex>\n#include <color_vertex>\n#include <fog_pars_vertex>\n#include <fog_vertex>',
    fragmentShader:
      '#include <common>\n#include <clipping_planes_fragment>\n#include <map_fragment>\n#include <color_fragment>\n#include <fog_pars_fragment>\n#include <fog_fragment>',
  };
  (material as { onBeforeCompile: (shader: unknown, renderer: unknown) => void }).onBeforeCompile(
    shader,
    undefined,
  );
  return { vertex: shader.vertexShader, fragment: shader.fragmentShader };
}

describe('every realistic tree, shrub, rock and building wears a seeded tint — #621', () => {
  afterEach(() => {
    setRealisticTints(FOLIAGE_TINT, MASONRY_TINT);
  });

  const everyKind = (): RealisticVegetationBelt => {
    const tree = aTreeWithMiddle();
    const rock = prepareRealisticShape(aScene([{ material: loaderMaterial() }]), 'rock');
    const shrub = prepareRealisticShape(
      aScene([{ material: loaderMaterial({ transparent: true }) }]),
      'shrub',
    );
    return new RealisticVegetationBelt(
      new Map([
        ['tree-broadleaf', [tree]],
        ['tree-conifer', [tree]],
        ['shrub', [shrub]],
        ['rock', [rock]],
      ] as const),
    );
  };
  // Far first; the nearest is full, 18 band A, 25–55 middle, 65 band B, beyond impostors.
  const zs = [95, 85, 75, 65, 55, 45, 35, 25, 18, 10];
  const trees = zs.map((z) => item('tree-broadleaf', z, 0));

  /** The tint each instance of `mesh` was written, by the z it stands at. */
  const tintsByZ = (
    mesh: RealisticVegetationBelt['meshes'][number] | undefined,
  ): Map<number, number> => {
    const found = new Map<number, number>();
    if (mesh === undefined) return found;
    for (let slot = 0; slot < mesh.count; slot += 1) {
      found.set(
        mesh.instanceMatrix.array[slot * 16 + 14] ?? Number.NaN,
        mesh.instanceColor?.array[slot * 3 + 2] ?? Number.NaN,
      );
    }
    return found;
  };

  it('writes each tree the tint of where it stands, at every level it is drawn at', () => {
    const belt = everyKind();
    belt.update(trees, POSE);
    const levels = belt.levelsOf('tree-broadleaf');
    const full = levels.full[0]?.flatMap((mesh) => [...tintsByZ(mesh)]) ?? [];
    const middle = (levels.middle[0] ?? []).flatMap((mesh) => [...tintsByZ(mesh)]);
    const impostor = [...tintsByZ(levels.impostor[0])];
    const written = [...full, ...middle, ...impostor];
    // Every tree, at every level and every part of it, carries its own place's tint.
    expect(written.length).toBeGreaterThan(zs.length);
    for (const [z, tint] of written) {
      expect(tint, String(z)).toBe(Math.fround(packedInstanceTint(0, z, FOLIAGE_TINT)));
    }
    // The band trees are the hand-overs: one tint on both sides of each.
    const at = (entries: readonly (readonly [number, number])[], z: number): number[] =>
      entries.filter(([one]) => one === z).map(([, tint]) => tint);
    expect(new Set([...at(full, 18), ...at(middle, 18)]).size).toBe(1);
    expect(at(full, 18).length).toBeGreaterThan(0);
    expect(at(middle, 18).length).toBeGreaterThan(0);
    expect(new Set([...at(middle, 65), ...at(impostor, 65)]).size).toBe(1);
    expect(at(impostor, 65).length).toBeGreaterThan(0);
    // Non-vacuity: the trees do not all wear one tint, and none is untinted.
    expect(new Set(written.map(([, tint]) => tint)).size).toBeGreaterThan(5);
    for (const [, tint] of written) expect(tint).not.toBe(0);
  });

  it('writes a tree the same tint on a later frame, whatever else moved', () => {
    const belt = everyKind();
    belt.update(trees, POSE);
    const before = tintsByZ(belt.levelsOf('tree-broadleaf').impostor[0]).get(85);
    // The frame's order reversed and two trees gone: 85 is the same item.
    belt.update(
      [...trees].reverse().filter((one) => one.z !== 10 && one.z !== 18),
      POSE,
    );
    const after = tintsByZ(belt.levelsOf('tree-broadleaf').impostor[0]).get(85);
    expect(before).toBeDefined();
    expect(after).toBe(before);
  });

  it('keeps each tree’s hand-over keep beside its tint, so neither overwrites the other', () => {
    const belt = everyKind();
    belt.update(trees, POSE);
    const full = belt.levelsOf('tree-broadleaf').full[0]?.[0];
    let band = -1;
    for (let slot = 0; slot < (full?.count ?? 0); slot += 1) {
      if (full?.instanceMatrix.array[slot * 16 + 14] === 18) band = slot;
    }
    expect(band).toBeGreaterThanOrEqual(0);
    const fade = bandFade(1, [10, 18, 25], 3);
    expect(full?.instanceColor?.array[band * 3]).toBe(Math.fround(fade));
    expect(full?.instanceColor?.array[band * 3 + 1]).toBe(2);
  });

  it('draws a shrub inside foliage’s bound and a rock inside masonry’s', () => {
    const belt = everyKind();
    belt.update([item('shrub', 20, 3), item('rock', 30, -4)], POSE);
    const [shrubMesh] = belt.meshes.filter(
      (mesh) =>
        mesh.count > 0 &&
        typeOf(mesh) !== 'ShaderMaterial' &&
        (mesh.instanceMatrix.array[14] ?? 0) === 20,
    );
    const [rockMesh] = belt.meshes.filter(
      (mesh) => mesh.count > 0 && (mesh.instanceMatrix.array[14] ?? 0) === 30,
    );
    expect(shrubMesh?.instanceColor?.array[2]).toBe(
      Math.fround(packedInstanceTint(3, 20, FOLIAGE_TINT)),
    );
    expect(rockMesh?.instanceColor?.array[2]).toBe(
      Math.fround(packedInstanceTint(-4, 30, MASONRY_TINT)),
    );
    expect(packedInstanceTint(-4, 30, MASONRY_TINT)).not.toBe(
      packedInstanceTint(-4, 30, FOLIAGE_TINT),
    );
    // And neither keeps a dither interval: nought and nought keeps every fragment.
    expect([shrubMesh?.instanceColor?.array[0], shrubMesh?.instanceColor?.array[1]]).toEqual([
      0, 0,
    ]);
  });

  it('writes a structure the same tint on every surface it wears, inside masonry’s bound', () => {
    const belt = aStructureBelt();
    belt.update([item('building', 20, 9)], POSE);
    const surfaces = ['brick', 'roof-tiles', 'planks', 'glass'] as const;
    const expected = Math.fround(packedInstanceTint(9, 20, MASONRY_TINT));
    expect(expected).not.toBe(0);
    for (const surface of surfaces) {
      const mesh = belt.beltOf(surface)?.meshesOf('building')[0];
      expect(mesh?.count, surface).toBe(1);
      expect(Array.from(mesh?.instanceColor?.array.slice(0, 3) ?? []), surface).toEqual([
        0,
        0,
        expected,
      ]);
      // Flagged for upload: three bumps `version` when `needsUpdate` is set.
      expect(mesh?.instanceColor?.version, surface).toBeGreaterThan(0);
    }
  });

  it('grows a structure’s tints with its matrices, so a crowded frame is tinted to the last item', () => {
    const belt = aStructureBelt();
    const count = SCATTER_INSTANCE_CAPACITY + 40;
    const walls = Array.from({ length: count }, (_, index) => item('wall', 5 + index * 0.25, 3));
    belt.update(walls, POSE);
    const surface = realisticStructureSurfaces('wall')[0];
    const mesh = surface === undefined ? undefined : belt.beltOf(surface)?.meshesOf('wall')[0];
    expect(mesh?.count).toBe(count);
    expect(mesh?.instanceColor?.count).toBeGreaterThanOrEqual(count);
    const last = walls[count - 1];
    expect(mesh?.instanceColor?.array[(count - 1) * 3 + 2]).toBe(
      Math.fround(packedInstanceTint(last?.x ?? 0, last?.z ?? 0, MASONRY_TINT)),
    );
  });

  it('draws every item untinted at a bound of nothing — the browser gate’s control — and back', () => {
    const belt = everyKind();
    const structures = aStructureBelt();
    setRealisticTints(NO_TINT, NO_TINT);
    belt.update([...trees, item('rock', 30, -4)], POSE);
    structures.update([item('building', 20, 9)], POSE);
    const tints = [
      ...belt.meshes,
      ...(structures.beltOf('brick')?.meshesOf('building') ?? []),
    ].flatMap((mesh) =>
      Array.from({ length: mesh.count }, (_, slot) => mesh.instanceColor?.array[slot * 3 + 2]),
    );
    expect(tints.length).toBeGreaterThan(zs.length);
    for (const tint of tints) expect(tint).toBe(0);
    setRealisticTints(FOLIAGE_TINT, MASONRY_TINT);
    structures.update([item('building', 20, 9)], POSE);
    expect(structures.beltOf('brick')?.meshesOf('building')[0]?.instanceColor?.array[2]).toBe(
      Math.fround(packedInstanceTint(9, 20, MASONRY_TINT)),
    );
  });

  it('teaches every realistic material to read it, and no stylised one', () => {
    const belt = everyKind();
    expect(belt.meshes.length).toBeGreaterThan(0);
    for (const mesh of belt.meshes) {
      if (typeOf(mesh) === 'ShaderMaterial') continue;
      expect(readsInstanceTint(mesh.material as never), typeOf(mesh)).toBe(true);
    }
    const structures = aStructureBelt();
    const structureMeshes = STRUCTURE_KINDS.flatMap((kind) =>
      [...PHOTOGRAPHIC_STRUCTURE_SURFACES, 'painted', 'glass'].flatMap(
        (surface) => structures.beltOf(surface as StructureSurface)?.meshesOf(kind) ?? [],
      ),
    );
    expect(structureMeshes.length).toBeGreaterThan(0);
    for (const mesh of structureMeshes) {
      expect(readsInstanceTint(mesh.material as never)).toBe(true);
    }
    // The stylised world: untouched — no material taught, no instance colour.
    const stylised = new ScatterBelt();
    const stylisedMeshes = [...stylised.meshes.values()];
    expect(stylisedMeshes.length).toBeGreaterThan(0);
    for (const mesh of stylisedMeshes) {
      expect(readsInstanceTint(mesh.material as never)).toBe(false);
      expect(mesh.instanceColor).toBeNull();
    }
    stylised.update([item('rock', 20, 3), item('building', 30, 9)], POSE);
    for (const mesh of stylisedMeshes) expect(mesh.instanceColor).toBeNull();
  });

  it('applies the tint in the shader after the surface’s colour, with three’s own tint taken out', () => {
    const tree = aTreeWithMiddle();
    // Before a belt teaches it, the bark compiles as three wrote it.
    expect(compiledBoth(tree.parts[0]?.material).vertex).toContain('#include <color_vertex>');
    new RealisticVegetationBelt(new Map([['tree-broadleaf', [tree]]]));
    const { vertex, fragment } = compiledBoth(tree.parts[0]?.material);
    expect(vertex).not.toContain('vColor.rgb *= instanceColor.rgb;');
    expect(vertex).toContain('vOylTint = oylTintOf(instanceColor.z);');
    expect(vertex).toContain('vOylKeep = instanceColor.xy;');
    expect(fragment).toContain(
      '#include <color_fragment>\ndiffuseColor.rgb = oylTinted(diffuseColor.rgb, vOylTint);',
    );
    const impostor = tree.impostor?.material as unknown as {
      vertexShader: string;
      fragmentShader: string;
    };
    expect(impostor.vertexShader).toContain('vOylTint = oylTintOf(instanceColor.z);');
    expect(impostor.fragmentShader).toContain('oylTinted(texel.rgb, vOylTint)');
  });

  it('teaches a shrub’s material the tint without the tree’s dither', () => {
    const shrub = prepareRealisticShape(
      aScene([{ material: loaderMaterial({ transparent: true }) }]),
      'shrub',
    );
    new RealisticVegetationBelt(new Map([['shrub', [shrub]]]));
    const { vertex, fragment } = compiledBoth(shrub.parts[0]?.material);
    expect(vertex).toContain('vOylTint = oylTintOf(instanceColor.z);');
    expect(vertex).not.toContain('vOylKeep');
    expect(fragment).toContain('oylTinted(diffuseColor.rgb, vOylTint)');
    expect(fragment).not.toContain('oylDither');
    // Its own program: three caches a program by this key, and a shrub's must
    // not be served a tree's or an untaught one.
    const key = (
      shrub.parts[0]?.material as unknown as { customProgramCacheKey: () => string }
    ).customProgramCacheKey();
    expect(key).toMatch(/\|oyl-instance-tint$/);
    const tree = aTreeWithMiddle();
    new RealisticVegetationBelt(new Map([['tree-broadleaf', [tree]]]));
    const treeKey = (
      tree.parts[0]?.material as unknown as { customProgramCacheKey: () => string }
    ).customProgramCacheKey();
    expect(treeKey).toMatch(/\|oyl-tree-dither$/);
  });

  it('refuses to teach one material as a tree and as something else', () => {
    const shape = prepareRealisticShape(aScene([{ material: loaderMaterial() }]), 'both');
    new RealisticVegetationBelt(new Map([['shrub', [shape]]]));
    expect(() => new RealisticVegetationBelt(new Map([['tree-conifer', [shape]]]))).toThrow(
      /two ways/,
    );
  });

  // #621's review: the shader's decode was held by nothing but the browser
  // gate's floors, so the hue scale written in degrees where the shader turns
  // radians passed every test. These are the codec's own ranges, read back out
  // of the program three is handed.
  it('decodes the tint in the shader with the codec’s own ranges, the hue in radians', () => {
    const shrub = prepareRealisticShape(aScene([{ material: loaderMaterial() }]), 'shrub');
    new RealisticVegetationBelt(new Map([['shrub', [shrub]]]));
    const { vertex } = compiledBoth(shrub.parts[0]?.material);
    const decode = /vec3 oylTintOf\(float stored\) \{([\s\S]*?)\n {2}\}/.exec(vertex)?.[1] ?? '';
    const zero = /stored \+ ([-\d.]+);/.exec(decode);
    expect(Number(zero?.[1])).toBe(TINT_CODEC_ZERO);
    const steps = TINT_CODEC_STEPS.toFixed(1);
    expect(decode).toContain(`(vec3(hue, saturation, brightness) - ${steps})`);
    const scale = /\/ ([-\d.]+)\s*\* vec3\(\s*([-\d.]+),\s*([-\d.]+),\s*([-\d.]+)\s*\)/.exec(
      decode,
    );
    expect(scale, decode).not.toBeNull();
    expect(Number(scale?.[1])).toBe(TINT_CODEC_STEPS);
    expect(Number(scale?.[2])).toBeCloseTo((TINT_CODEC_RANGE.hueDegrees * Math.PI) / 180, 7);
    expect(Number(scale?.[3])).toBeCloseTo(TINT_CODEC_RANGE.saturation, 7);
    expect(Number(scale?.[4])).toBeCloseTo(TINT_CODEC_RANGE.brightness, 7);
  });

  it('throws, naming #621, where three’s program no longer holds an include the tint is spliced at', () => {
    const shrub = prepareRealisticShape(aScene([{ material: loaderMaterial() }]), 'shrub');
    new RealisticVegetationBelt(new Map([['shrub', [shrub]]]));
    const compile = shrub.parts[0]?.material as unknown as {
      onBeforeCompile: (shader: unknown, renderer: unknown) => void;
    };
    const vertex =
      '#include <common>\n#include <begin_vertex>\n#include <color_vertex>\n#include <fog_pars_vertex>\n#include <fog_vertex>';
    const fragment =
      '#include <common>\n#include <map_fragment>\n#include <color_fragment>\n#include <fog_pars_fragment>\n#include <fog_fragment>';
    const cases = [
      ['vertex', '#include <common>'],
      ['vertex', '#include <color_vertex>'],
      ['fragment', '#include <common>'],
      ['fragment', '#include <color_fragment>'],
    ] as const;
    for (const [stage, include] of cases) {
      const shader = {
        uniforms: {},
        vertexShader: stage === 'vertex' ? vertex.replace(include, '') : vertex,
        fragmentShader: stage === 'fragment' ? fragment.replace(include, '') : fragment,
      };
      expect(() => compile.onBeforeCompile(shader, undefined), `${stage} ${include}`).toThrow(
        `three's ${stage} shader no longer holds ${include}, where #621's seeded tint is spliced in`,
      );
    }
    // And with all four present it compiles.
    const whole = { uniforms: {}, vertexShader: vertex, fragmentShader: fragment };
    expect(() => compile.onBeforeCompile(whole, undefined)).not.toThrow();
  });
});

/** A loaded scene whose one mesh's geometry does, or does not, carry a colour. */
function aSceneColoured(coloured: boolean): Parameters<typeof prepareRealisticShape>[0] {
  const geometry = aGeometry();
  if (coloured) geometry.setAttribute('color', geometry.getAttribute('position').clone());
  else geometry.deleteAttribute('color');
  return {
    updateWorldMatrix: () => undefined,
    traverse: (visit: (node: unknown) => void) => {
      visit({ isMesh: false, userData: { oyl_scan_height: 1, oyl_scan_width: 1.8 } });
      visit({
        isMesh: true,
        geometry,
        material: loaderMaterial(),
        matrixWorld: IDENTITY,
        userData: {},
      });
    },
  } as unknown as Parameters<typeof prepareRealisticShape>[0];
}

describe('the rock’s baked occlusion is drawn — #620', () => {
  it('multiplies a part by its vertex colours exactly when the file carries them', () => {
    // `process_rock.py` bakes the occlusion into COLOR_0 since #620, which
    // `GLTFLoader` hands over as the geometry's `color`; the committed file is
    // held to carrying it by `realistic-budget.test.ts` §"#620".
    const rock = prepareRealisticShape(aSceneColoured(true), 'rock');
    expect(rock.parts[0]?.material.vertexColors).toBe(true);
    const bare = prepareRealisticShape(aSceneColoured(false), 'rock');
    expect(bare.parts[0]?.material.vertexColors).toBe(false);
  });
});

/** Which z every caster in a list stands at, nearest first. */
const castersAt = (list: BlobCasters): number[] =>
  list.casters
    .slice(0, list.count)
    .map((caster) => caster.z)
    .sort((a, b) => a - b);

describe('the vegetation belt names what it drew as meshes, for the ground blobs — #620', () => {
  const small = (): RealisticShape =>
    prepareRealisticShape(aScene([{ material: loaderMaterial() }]), 'small');

  it('names the six nearest trees, the eight nearest shrubs and the twelve nearest rocks', () => {
    const tree = aTreeWithMiddle();
    const belt = new RealisticVegetationBelt(
      new Map([
        ['tree-broadleaf', [tree]],
        ['shrub', [small()]],
        ['rock', [small()]],
      ] as const),
    );
    // Far first, so a belt naming the first items rather than the nearest is caught.
    const trees = [95, 85, 75, 65, 55, 45, 35, 25, 18, 10].map((z) => item('tree-broadleaf', z, 0));
    const shrubs = Array.from({ length: 12 }, (_, at) => item('shrub', 100 - at * 7, 6));
    const rocks = Array.from({ length: 16 }, (_, at) => item('rock', 100 - at * 6, -6));
    belt.update([...trees, ...shrubs, ...rocks], POSE);
    const list = belt.grounded;
    const byKind = (x: number): number[] =>
      list.casters
        .slice(0, list.count)
        .filter((caster) => caster.x === x)
        .map((caster) => caster.z)
        .sort((a, b) => a - b);
    // The full, the band and the four middle ranks: never the middle-to-impostor band.
    expect(byKind(0)).toEqual([10, 18, 25, 35, 45, 55]);
    expect(byKind(6)).toEqual([23, 30, 37, 44, 51, 58, 65, 72]);
    expect(byKind(-6)).toEqual([10, 16, 22, 28, 34, 40, 46, 52, 58, 64, 70, 76]);
    expect(list.count).toBe(REALISTIC_GROUND_BLOBS - 36);
    for (const caster of list.casters.slice(0, list.count)) {
      expect(caster.round).toBe(true);
      expect(caster.halfAlong).toBe(caster.halfAcross);
      expect(caster.halfAcross).toBeGreaterThan(0);
      expect(caster.height).toBeGreaterThan(0);
    }
  });

  it('fades the furthest tree’s blob as it nears the next tree back, so none appears in one frame', () => {
    const tree = aTreeWithMiddle();
    const belt = new RealisticVegetationBelt(new Map([['tree-broadleaf', [tree]]] as const));
    const strengthAt = (z: number): number | undefined =>
      belt.grounded.casters.slice(0, belt.grounded.count).find((caster) => caster.z === z)
        ?.strength;
    // Ranks 0 to 4 full; the sixth tree half-way between the fifth and the
    // seventh, so half its blob.
    belt.update(
      [10, 18, 25, 35, 45, 55, 65, 75].map((z) => item('tree-broadleaf', z, 0)),
      POSE,
    );
    for (const z of [10, 18, 25, 35, 45]) expect(strengthAt(z)).toBe(1);
    expect(strengthAt(55)).toBeCloseTo(0.5, 9);
    // Level with the seventh — the moment the two swap ranks — it has none,
    // and so the one about to take its rank starts from none too.
    belt.update(
      [10, 18, 25, 35, 45, 65, 65.0001, 75].map((z) => item('tree-broadleaf', z, 0)),
      POSE,
    );
    expect(strengthAt(65) ?? 0).toBeLessThan(1e-3);
  });

  it('names no tree drawn only as its impostor', () => {
    // `aBelt`'s tree has no middle level, so every rank past the band is an
    // impostor: the full tree and the band tree are the only meshes.
    const belt = aBelt();
    belt.update(
      [150, 120, 90, 60, 40, 30, 20, 10].map((z) => item('tree-broadleaf', z)),
      POSE,
    );
    expect(castersAt(belt.grounded)).toEqual([10, 20]);
  });

  it('sizes a caster by the item it stands for', () => {
    const belt = aBelt();
    belt.update([{ ...item('rock', 20), y: 3.25, scale: 1 }], POSE);
    const one = belt.grounded.casters[0];
    // Its foot's height: which sheet of ground its blob lies on (@see groundUnderBlob).
    expect(one?.y).toBe(3.25);
    // The crown's radius is the MEAN of the shape's two horizontal
    // half-extents — not the bounding box's corner, which a cull wants — at
    // the size the belt draws it: `sceneryFitMetres` over the scan's extent.
    const shape = prepareRealisticShape(aScene([{ material: loaderMaterial() }]), 'small');
    const geometry = shape.parts[0]?.geometry;
    geometry?.computeBoundingBox();
    const box = geometry?.boundingBox;
    const size = sceneryFitMetres('rock') / shape.extent;
    const half = (low: number, high: number): number => Math.max(Math.abs(low), Math.abs(high));
    expect(one?.halfAcross).toBeCloseTo(
      ((half(box?.min.x ?? 0, box?.max.x ?? 0) + half(box?.min.z ?? 0, box?.max.z ?? 0)) / 2) *
        size,
      9,
    );
    expect(one?.height).toBeCloseTo((box?.max.y ?? 0) * size, 9);
    const [radius, height] = [one?.halfAcross ?? 0, one?.height ?? 0];
    belt.update([{ ...item('rock', 20), scale: 1.4 }], POSE);
    expect(belt.grounded.casters[0]?.halfAcross).toBeCloseTo(radius * 1.4, 9);
    expect(belt.grounded.casters[0]?.height).toBeCloseTo(height * 1.4, 9);
  });

  it('names nothing while the stylised world is drawn', () => {
    const belt = aBelt();
    belt.update([item('rock', 20)], POSE);
    expect(belt.grounded.count).toBe(1);
    belt.setShown(false);
    belt.update([item('rock', 20)], POSE);
    expect(belt.grounded.count).toBe(0);
  });
});

describe('the structures the ground blobs go under — #620', () => {
  it('takes the structures the structure belts admit, with their footprints and heights', () => {
    const into = blobCasters(4);
    const house = { ...item('building', 20, 12), y: 2.5, rotation: 0.5, scale: 1.2 };
    structureCasters(
      [
        item('building', -400), // behind the corridor: never admitted
        house,
        item('tree-broadleaf', 30), // admitted, and spends the budget, but no structure
        item('wall', 40),
        item('church', 50), // past the budget of three
      ],
      POSE,
      3,
      (kind) => (kind === 'building' ? 8 : 1),
      into,
    );
    expect(into.count).toBe(2);
    const [first, second] = into.casters;
    expect(first).toMatchObject({ x: 12, y: 2.5, z: 20, yaw: 0.5, round: false });
    // `settlements.ts`' house: ±4.5 m square, scaled.
    expect(first?.halfAlong).toBeCloseTo(4.5 * 1.2, 9);
    expect(first?.halfAcross).toBeCloseTo(4.5 * 1.2, 9);
    expect(first?.height).toBeCloseTo(8 * 1.2, 9);
    expect(second?.z).toBe(40);
    // A wall: one 8 m piece along it, 0.3 m either side across it.
    expect(second?.halfAlong).toBeCloseTo(4, 9);
    expect(second?.halfAcross).toBeCloseTo(0.3, 9);
    expect(second?.centreAlong).toBeCloseTo(0, 9);
    expect(second?.height).toBe(1);
  });

  it('puts a church’s footprint where it stands, which is not its middle', () => {
    const into = blobCasters(1);
    structureCasters([item('church', 20)], POSE, Infinity, () => 12, into);
    // `settlements.ts`' church: 3.8 m either side, −9.3 m behind to 9.5 m in front.
    expect(into.casters[0]?.halfAcross).toBeCloseTo(3.8, 9);
    expect(into.casters[0]?.halfAlong).toBeCloseTo(9.4, 9);
    expect(into.casters[0]?.centreAlong).toBeCloseTo(0.1, 9);
  });

  it('builds a church taller than a house, and a house taller than a wall', () => {
    const belts = aStructureBelt();
    expect(belts.heightOf('church')).toBeGreaterThan(belts.heightOf('building'));
    expect(belts.heightOf('building')).toBeGreaterThan(belts.heightOf('wall'));
    expect(belts.heightOf('wall')).toBeGreaterThan(0);
  });
});

describe('the ground blob belt — #620', () => {
  const profile = hillRoute();
  const origin = corridorOrigin(profile);
  const corridor = roadCorridor(profile, origin, 900);
  const terrain = terrainCorridor(profile, origin, corridor, scatterSeed(profile));
  const sun = worldStyle(profile).sun;
  /** Three trees beside the road, 7, 20 and 30 m out: the first a verge's width off the edge. */
  const casters = (): BlobCasters => {
    const list = blobCasters(3);
    const point = corridor.centre[60];
    const next = corridor.centre[61];
    if (point === undefined || next === undefined) throw new Error('a short corridor');
    const length = Math.hypot(next.x - point.x, next.z - point.z);
    [7, 20, 30].forEach((out, at) => {
      const caster = list.casters[at];
      if (caster === undefined) return;
      const x = point.x - ((next.z - point.z) / length) * out;
      const z = point.z + ((next.x - point.x) / length) * out;
      const foot = { y: 0, nx: 0, ny: 1, nz: 0 };
      groundUnder(terrain, corridor.centre, x, z, foot);
      Object.assign(caster, {
        x,
        y: foot.y,
        z,
        yaw: 0,
        round: true,
        halfAlong: 3,
        halfAcross: 3,
        centreAlong: 0,
        height: 9,
        strength: 1,
      });
    });
    list.count = 3;
    return list;
  };

  it('is one quad of two triangles, facing up, and draws no texture', () => {
    const belt = new GroundBlobBelt();
    const geometry = belt.mesh.geometry;
    const index = Array.from(geometry.getIndex()?.array ?? []);
    expect(index.length / 3).toBe(GROUND_BLOB_TRIANGLES);
    const position = geometry.getAttribute('position');
    for (let at = 0; at < index.length; at += 3) {
      const [a, b, c] = [index[at], index[at + 1], index[at + 2]].map((vertex) => [
        position.getX(vertex ?? 0),
        position.getY(vertex ?? 0),
        position.getZ(vertex ?? 0),
      ]) as [number[], number[], number[]];
      const u = [0, 1, 2].map((k) => (b[k] as number) - (a[k] as number));
      const v = [0, 1, 2].map((k) => (c[k] as number) - (a[k] as number));
      const up = (u[2] as number) * (v[0] as number) - (u[0] as number) * (v[2] as number);
      expect(up).toBeGreaterThan(0);
    }
    const material = belt.mesh.material as unknown as Record<string, unknown>;
    expect(material['transparent']).toBe(true);
    expect(material['depthWrite']).toBe(false);
    expect(material['depthTest']).toBe(true);
    expect(material['map']).toBeNull();
    expect(belt.mesh.instanceMatrix.count).toBe(REALISTIC_GROUND_BLOBS);
  });

  it('puts one blob per caster on the landform’s own triangle, clipped off the road', () => {
    const belt = new GroundBlobBelt();
    const list = casters();
    belt.update([list], corridor, terrain, sun);
    expect(belt.mesh.count).toBe(3);
    expect(belt.mesh.visible).toBe(true);
    const planes = new Float32Array(6);
    const matrix = belt.mesh.instanceMatrix.array;
    const first = belt.mesh.geometry.getAttribute('blobClipFirst').array;
    const second = belt.mesh.geometry.getAttribute('blobClipSecond').array;
    for (let slot = 0; slot < 3; slot += 1) {
      const x = matrix[slot * 16 + 12] as number;
      const y = matrix[slot * 16 + 13] as number;
      const z = matrix[slot * 16 + 14] as number;
      const under = { y: 0, nx: 0, ny: 1, nz: 0 };
      // The middle, lifted along the ground's normal: take the lift off again.
      expect(groundUnder(terrain, corridor.centre, x, z, under)).toBe(true);
      expect(y - under.y).toBeCloseTo(GROUND_BLOB_LIFT_METRES * under.ny, 2);
      // The clip planes written are the ones `roadClip` gives for that blob.
      const reach = Math.max(
        Math.hypot(matrix[slot * 16] as number, matrix[slot * 16 + 2] as number),
        Math.hypot(matrix[slot * 16 + 8] as number, matrix[slot * 16 + 10] as number),
      );
      roadClip(
        corridor.centre,
        x - under.nx * GROUND_BLOB_LIFT_METRES,
        z - under.nz * GROUND_BLOB_LIFT_METRES,
        reach,
        planes,
      );
      for (let at = 0; at < 3; at += 1) {
        expect(first[slot * 3 + at]).toBeCloseTo(planes[at] as number, 2);
        expect(second[slot * 3 + at]).toBeCloseTo(planes[3 + at] as number, 2);
      }
    }
    // Each instance's strength is its caster's.
    const strengths = belt.mesh.geometry.getAttribute('blobStrength').array;
    expect(Array.from(strengths.slice(0, 3))).toEqual([1, 1, 1]);
    list.casters[1]!.strength = 0.25;
    belt.update([list], corridor, terrain, sun);
    expect(strengths[1]).toBe(0.25);
    // Non-vacuity: the nearest blob, 7 m out with a 3 m crown, reaches the
    // road and IS clipped; the one 30 m out is not.
    expect(Math.hypot(first[0] as number, first[1] as number)).toBeCloseTo(1, 5);
    expect(Array.from(first.slice(6, 9))).toEqual([0, 0, -1]);
  });

  it('draws the blob of a tree whose middle the sun throws onto the road, clipped, rather than dropping it', () => {
    // `ground-blob.ts` §`groundUnderBlob`: the landform starts at the road's
    // edge, so a middle over the tarmac has no triangle under it. The belt
    // used to `continue` there, and the blob vanished in one frame as its
    // middle crossed the edge — #686's review.
    const point = corridor.centre[60];
    const next = corridor.centre[61];
    if (point === undefined || next === undefined) throw new Error('a short corridor');
    const length = Math.hypot(next.x - point.x, next.z - point.z);
    const rightX = -(next.z - point.z) / length;
    const rightZ = (next.x - point.x) / length;
    // A tree a metre off the LEFT edge, under a 55° sun from its left.
    const x = point.x - rightX * 4.5;
    const z = point.z - rightZ * 4.5;
    const foot = { y: 0, nx: 0, ny: 1, nz: 0 };
    expect(groundUnder(terrain, corridor.centre, x, z, foot)).toBe(true);
    const list = blobCasters(1);
    Object.assign(list.casters[0] ?? {}, {
      x,
      y: foot.y,
      z,
      yaw: 0,
      round: true,
      halfAlong: 3,
      halfAcross: 3,
      centreAlong: 0,
      height: 9,
      strength: 1,
    });
    list.count = 1;
    const up = (55 * Math.PI) / 180;
    const across = {
      ...sun,
      x: -rightX * Math.cos(up),
      y: Math.sin(up),
      z: -rightZ * Math.cos(up),
    };
    const belt = new GroundBlobBelt();
    belt.update([list], corridor, terrain, across);
    expect(belt.mesh.count).toBe(1);
    const matrix = belt.mesh.instanceMatrix.array;
    const middleX = (matrix[12] as number) - foot.nx * GROUND_BLOB_LIFT_METRES;
    const middleZ = (matrix[14] as number) - foot.nz * GROUND_BLOB_LIFT_METRES;
    // Non-vacuity: its middle IS over the road, where no ground is.
    expect(groundUnder(terrain, corridor.centre, middleX, middleZ, { ...foot })).toBe(false);
    // And the road clip is a real one, through the blob.
    const first = belt.mesh.geometry.getAttribute('blobClipFirst').array;
    expect(Math.hypot(first[0] as number, first[1] as number)).toBeCloseTo(1, 5);
    expect(first[2] as number).toBeGreaterThan(0);
  });

  it('stops at its capacity, and draws nothing hidden or under a sun that throws no shadow', () => {
    const small = new GroundBlobBelt(2);
    small.update([casters()], corridor, terrain, sun);
    expect(small.mesh.count).toBe(2);
    const belt = new GroundBlobBelt();
    belt.update([casters()], corridor, terrain, { ...sun, y: 0 });
    expect(belt.mesh.count).toBe(0);
    expect(belt.mesh.visible).toBe(false);
    belt.update([casters()], corridor, terrain, sun);
    belt.setShown(false);
    expect(belt.mesh.visible).toBe(false);
    belt.update([casters()], corridor, terrain, sun);
    expect(belt.mesh.count).toBe(0);
  });

  it('draws its darkness and its clip in the shader — the constants `ground-blob.ts` states', () => {
    const belt = new GroundBlobBelt();
    const compile = belt.mesh.material as unknown as {
      onBeforeCompile: (shader: unknown, renderer: unknown) => void;
    };
    const vertex =
      '#include <common>\n#include <begin_vertex>\n#include <fog_pars_vertex>\n#include <fog_vertex>';
    const fragment =
      '#include <common>\n#include <color_fragment>\n#include <fog_pars_fragment>\n#include <fog_fragment>';
    const shader = { uniforms: {}, vertexShader: vertex, fragmentShader: fragment };
    compile.onBeforeCompile(shader, undefined);
    expect(shader.fragmentShader).toContain(`${String(GROUND_BLOB_DARKNESS)} * vBlobStrength *`);
    expect(shader.vertexShader).toContain('vBlobStrength = blobStrength;');
    expect(shader.fragmentShader).toContain(`smoothstep(${String(GROUND_BLOB_CORE)}, 1.0`);
    expect(shader.fragmentShader).toContain(
      'dot(vBlobClipFirst.xy, vBlobOffset) < vBlobClipFirst.z',
    );
    expect(shader.fragmentShader).toContain(
      'dot(vBlobClipSecond.xy, vBlobOffset) < vBlobClipSecond.z',
    );
    expect(shader.vertexShader).toContain('attribute vec3 blobClipFirst;');
    for (const [stage, include] of [
      ['vertex', '#include <begin_vertex>'],
      ['fragment', '#include <color_fragment>'],
    ] as const) {
      const broken = {
        uniforms: {},
        vertexShader: stage === 'vertex' ? vertex.replace(include, '') : vertex,
        fragmentShader: stage === 'fragment' ? fragment.replace(include, '') : fragment,
      };
      expect(() => compile.onBeforeCompile(broken, undefined)).toThrow(
        `three's ${stage} shader no longer holds ${include}, where #620's ground blob is spliced in`,
      );
    }
  });
});

describe('the realistic world breathes one air, and the stylised world none of it — #622', () => {
  const vegetation = (): RealisticVegetationBelt => {
    const tree = aTreeWithMiddle();
    const rock = prepareRealisticShape(aScene([{ material: loaderMaterial() }]), 'rock');
    const shrub = prepareRealisticShape(
      aScene([{ material: loaderMaterial({ transparent: true }) }]),
      'shrub',
    );
    return new RealisticVegetationBelt(
      new Map([
        ['tree-broadleaf', [tree]],
        ['shrub', [shrub]],
        ['rock', [rock]],
      ] as const),
    );
  };
  const fogged = {
    vertex:
      '#include <common>\n#include <begin_vertex>\n#include <color_vertex>\n#include <fog_pars_vertex>\n#include <fog_vertex>',
    fragment:
      '#include <common>\n#include <clipping_planes_fragment>\n#include <map_fragment>\n#include <color_fragment>\n#include <fog_pars_fragment>\n#include <fog_fragment>',
  };
  const compile = (
    material: unknown,
    shader = { uniforms: {}, vertexShader: fogged.vertex, fragmentShader: fogged.fragment },
  ): { uniforms: Record<string, unknown>; vertexShader: string; fragmentShader: string } => {
    (material as { onBeforeCompile: (shader: unknown, renderer: unknown) => void }).onBeforeCompile(
      shader,
      undefined,
    );
    return shader;
  };

  it('teaches every material the realistic world fogs', () => {
    const belt = vegetation();
    expect(belt.meshes.length).toBeGreaterThan(0);
    for (const mesh of belt.meshes) {
      expect(breathesTheAir(mesh.material as never), typeOf(mesh)).toBe(true);
    }
    const structures = aStructureBelt();
    for (const surface of [...PHOTOGRAPHIC_STRUCTURE_SURFACES, 'painted', 'glass'] as const) {
      for (const mesh of STRUCTURE_KINDS.flatMap(
        (kind) => structures.beltOf(surface)?.meshesOf(kind) ?? [],
      )) {
        expect(breathesTheAir(mesh.material as never), surface).toBe(true);
      }
    }
    const photograph = { isTexture: true } as never;
    expect(breathesTheAir(photographicRoadMaterial(photograph, photograph))).toBe(true);
    expect(
      breathesTheAir(
        photographicGroundMaterial(photograph, photograph, { value: 1 }, { value: 1 }),
      ),
    ).toBe(true);
    expect(breathesTheAir(new GroundBlobBelt().mesh.material as never)).toBe(true);
    const primitives = new ScatterBelt(new Map(), { physical: true });
    for (const mesh of primitives.meshesOf('rock')) {
      expect(breathesTheAir(mesh.material as never)).toBe(true);
    }
  });

  it('teaches nothing the stylised world draws, so its fog is three’s own', () => {
    const stylised = new ScatterBelt(new Map());
    const meshes = STRUCTURE_KINDS.flatMap((kind) => stylised.meshesOf(kind)).concat(
      stylised.meshesOf('rock'),
    );
    expect(meshes.length).toBeGreaterThan(0);
    for (const mesh of meshes) expect(breathesTheAir(mesh.material as never)).toBe(false);
    // The water and the riders' contact shadows are drawn in both worlds, so
    // they are never taught: #629, and the fog has nothing to take under a rider.
    expect(breathesTheAir(new WaterBelt().mesh.material as never)).toBe(false);
    expect(breathesTheAir(new ContactShadowBelt().mesh.material as never)).toBe(false);
  });

  it('puts the air in place of three’s fog, from the world ray and ONE set of uniforms', () => {
    const tree = aTreeWithMiddle();
    new RealisticVegetationBelt(new Map([['tree-broadleaf', [tree]]]));
    const photograph = { isTexture: true } as never;
    const bark = compile(tree.parts[0]?.material);
    const road = compile(photographicRoadMaterial(photograph, photograph));
    for (const shader of [bark, road]) {
      expect(shader.vertexShader).toContain(
        '#include <fog_vertex>\n#ifdef USE_FOG\n  vOylFogRay = (vec4(mvPosition.xyz, 0.0) * viewMatrix).xyz;',
      );
      expect(shader.fragmentShader).not.toContain('#include <fog_fragment>');
      expect(shader.fragmentShader).toContain('uniform vec3 oylFogTable[16];');
      expect(shader.fragmentShader).toContain(
        'float oylAzimuth = atan(vOylFogRay.z, vOylFogRay.x) + oylSkyTurn;',
      );
      expect(shader.fragmentShader).toContain('int oylFrom = (int(oylLower) + 64) % 16;');
      expect(shader.fragmentShader).toContain(`int oylFrom = ${ATMOSPHERE_BIN_WRAP};`);
      expect(shader.fragmentShader).toContain(
        'vec3 oylFogColour = mix(fogColor, oylToward, oylFogShare);',
      );
      expect(shader.fragmentShader).toContain(
        'float oylDensity = fogDensity * (1.0 + (oylValleyHaze - 1.0) * oylBelow);',
      );
      expect(shader.fragmentShader).toContain(
        'gl_FragColor.rgb = mix(gl_FragColor.rgb, oylFogColour, fogFactor);',
      );
    }
    // One object each, so a view writing its air once reaches every program.
    for (const name of [
      'oylFogTable',
      'oylFogShare',
      'oylSkyTurn',
      'oylValleyMiddle',
      'oylValleyHaze',
      'oylValleyDepth',
    ]) {
      expect(bark.uniforms[name], name).toBeDefined();
      expect(bark.uniforms[name], name).toBe(road.uniforms[name]);
    }
    const key = (
      tree.parts[0]?.material as unknown as { customProgramCacheKey: () => string }
    ).customProgramCacheKey();
    expect(key).toContain('|oyl-atmosphere');
  });

  it('wraps a bin index at ANY bin count, because its offset is derived from the count — #703', () => {
    // The wrap as spliced, read back rather than restated: an offset typed as
    // a literal would pass the line above at 16 bins and read the wrong
    // direction at 12 or 24.
    const wrap = /^\(int\(oylLower\) \+ (\d+)\) % (\d+)$/u.exec(ATMOSPHERE_BIN_WRAP);
    expect(wrap, ATMOSPHERE_BIN_WRAP).not.toBeNull();
    const offset = Number(wrap?.[1]);
    const bins = Number(wrap?.[2]);
    expect(bins).toBe(HORIZON_AZIMUTH_BINS);
    expect(offset).toBe(ATMOSPHERE_BIN_OFFSET);
    expect(offset % bins).toBe(0);
    // `skyRotation` lies in (−2π, 2π), so `oylAt` lies in (−N − 0.5, 2N − 0.5)
    // and its floor in [−N − 1, 2N − 1]: every one of those must land on the
    // bin a true modulo gives, and never on a negative operand of `%`.
    for (let lower = -bins - 1; lower <= 2 * bins - 1; lower += 1) {
      expect(lower + offset, String(lower)).toBeGreaterThanOrEqual(0);
      expect((lower + offset) % bins, String(lower)).toBe(((lower % bins) + bins) % bins);
    }
  });

  it('draws nothing into a render target, which is what keeps the table in the fog’s colour space — #703', () => {
    // `three-renderer.ts` §`ATMOSPHERE`: the table is converted to the OUTPUT
    // colour space once, while three converts `fogColor` to the LINEAR working
    // space whenever a render target is bound. The two agree only while the
    // renderer never binds or builds one — so the first that does (#629's
    // reflections, #701's post pass) is a red build here, not a fog that
    // quietly stops matching its own flat table.
    const renderer = readFileSync(new URL('./three-renderer.ts', import.meta.url), 'utf8');
    expect(
      renderTargetsIn(renderer),
      'a render target in three-renderer.ts: convert #622’s fog table with the space three ' +
        'converts fogColor with (getUnlitUniformColorSpace), per pass — see §ATMOSPHERE',
    ).toEqual([]);
  });

  it('reads the tripwire above off the parsed code: a comment is not a target, and transmission is — #708', () => {
    // #708: the tripwire used to match the file's TEXT, so a sentence naming
    // the call was a red build and a `transmission` material — whose hidden
    // pass three renders into a target of its own — was green.
    expect(
      renderTargetsIn(
        [
          '// renderer.setRenderTarget(target) would bind one',
          '/** new WebGLRenderTarget(1, 1), new EffectComposer(renderer), m.transmission = 1 */',
          "const note = 'renderer.setRenderTarget(target); new WebGLRenderTarget(1, 1)';",
          'const transmissionless = { transmissive: 1 };',
        ].join('\n'),
      ),
    ).toEqual([]);
    expect(renderTargetsIn('renderer.setRenderTarget(target);')).toEqual(['.setRenderTarget']);
    expect(renderTargetsIn('this.#renderer?.setRenderTarget(null);')).toEqual(['.setRenderTarget']);
    expect(renderTargetsIn('const t = new WebGLRenderTarget(1, 1);')).toEqual([
      'new WebGLRenderTarget',
    ]);
    expect(renderTargetsIn('const t = new THREE.WebGLCubeRenderTarget(8);')).toEqual([
      'new WebGLCubeRenderTarget',
    ]);
    expect(renderTargetsIn('const c = new EffectComposer(renderer);')).toEqual([
      'new EffectComposer',
    ]);
    expect(renderTargetsIn('new MeshPhysicalMaterial({ transmission: 0.5 });')).toEqual([
      'transmission',
    ]);
    expect(renderTargetsIn('const transmission = 1; make({ transmission });')).toEqual([
      'transmission',
    ]);
    expect(renderTargetsIn('material.transmission = 1;')).toEqual(['transmission']);
    // #711's review: the spellings the first parsed version let through.
    expect(renderTargetsIn("renderer['setRenderTarget'](target);")).toEqual(['.setRenderTarget']);
    expect(renderTargetsIn('renderer[`setRenderTarget`](target);')).toEqual(['.setRenderTarget']);
    expect(renderTargetsIn('const { setRenderTarget } = renderer;')).toEqual(['.setRenderTarget']);
    expect(renderTargetsIn('const { setRenderTarget: bind } = renderer;')).toEqual([
      '.setRenderTarget',
    ]);
    expect(renderTargetsIn("material['transmission'] = 1;")).toEqual(['transmission']);
    expect(renderTargetsIn("make({ ['transmission']: 1 });")).toEqual(['transmission']);
    expect(renderTargetsIn("make({ 'transmission': 1 });")).toEqual(['transmission']);
    expect(renderTargetsIn('const r = new Reflector(geometry);')).toEqual(['new Reflector']);
    expect(renderTargetsIn('const r = new Refractor(geometry);')).toEqual(['new Refractor']);
    expect(renderTargetsIn('const c = new THREE.CubeCamera(1, 100, target);')).toEqual([
      'new CubeCamera',
    ]);
    // What it deliberately does not claim to follow: a name held in a value.
    expect(renderTargetsIn('renderer[method](target);')).toEqual([]);
    // #639: a member the table INHERITS is not in it. `array.constructor` read
    // as `Object`, a render target, and turned #639's geometry merge red.
    expect(
      renderTargetsIn('new (array.constructor as never)(8); map.toString(); x.hasOwnProperty;'),
    ).toEqual([]);
  });

  it('throws, naming #622, where three’s program no longer holds a fog include', () => {
    const material = photographicRoadMaterial(
      { isTexture: true } as never,
      {
        isTexture: true,
      } as never,
    );
    for (const [stage, include] of [
      ['vertex', '#include <fog_pars_vertex>'],
      ['vertex', '#include <fog_vertex>'],
      ['fragment', '#include <fog_pars_fragment>'],
      ['fragment', '#include <fog_fragment>'],
    ] as const) {
      const broken = {
        uniforms: {},
        vertexShader: stage === 'vertex' ? fogged.vertex.replace(include, '') : fogged.vertex,
        fragmentShader:
          stage === 'fragment' ? fogged.fragment.replace(include, '') : fogged.fragment,
      };
      expect(() => compile(material, broken)).toThrow(
        `three's ${stage} shader no longer holds ${include}, where #622's air is spliced in`,
      );
    }
  });
});

/**
 * What in `source` binds or builds a render target — #703, read off the parsed
 * code since #708. The parser's tree holds no comment and no string contents,
 * so a sentence naming a call is not the call.
 *
 * Three shapes:
 *
 * - `setRenderTarget` reached as a member however it is spelled — `.name`,
 *   `?.name`, `['name']`, or pulled out by destructuring
 *   (`const { setRenderTarget } = renderer`, renamed or not);
 * - a `new` of anything ending `RenderTarget`, an `EffectComposer`, or one of
 *   the three objects in `examples/jsm` and core that render the scene into a
 *   target of their own: `Reflector`, `Refractor` and `CubeCamera`;
 * - a `transmission` property, spelled any of those ways or as an object
 *   literal's key (plain, quoted, shorthand or `['transmission']`), because
 *   three renders a material with `transmission` above nought through a hidden
 *   pass into a render target of its own (`WebGLRenderer.js`
 *   §`renderTransmissionPass`).
 *
 * ⚠️ What it cannot see, stated rather than chased: a name reached through a
 * value rather than a literal (`renderer[method]`, a template with a
 * substitution), and a constructor under another name
 * (`const RT = WebGLRenderTarget; new RT(1, 1)`) — the parser knows the text of
 * the `new`, not what the identifier was bound to.
 *
 * ⚠️ It reads ONE file. A target bound by another module, or by a three
 * feature named nowhere here, is not seen; `three-renderer.ts` §`ATMOSPHERE`
 * names the two three already binds internally and why neither draws the air.
 */
function renderTargetsIn(source: string): readonly string[] {
  const file = ts.createSourceFile('source.ts', source, ts.ScriptTarget.Latest, true);
  const found: string[] = [];
  const MEMBERS: Readonly<Record<string, string>> = {
    setRenderTarget: '.setRenderTarget',
    transmission: 'transmission',
  };
  /** The literal text a name is spelled with, or nothing when it is computed. */
  const literalName = (name: ts.Node | undefined): string | undefined => {
    if (name === undefined) return undefined;
    if (ts.isComputedPropertyName(name)) return literalName(name.expression);
    if (
      ts.isIdentifier(name) ||
      ts.isStringLiteral(name) ||
      ts.isNoSubstitutionTemplateLiteral(name)
    ) {
      return name.text;
    }
    return undefined;
  };
  const member = (name: string | undefined): void => {
    // #639: OWN keys only — `MEMBERS['constructor']` is `Object`, inherited, and
    // a `.constructor` anywhere in the file used to read as a render target.
    const label = name === undefined || !Object.hasOwn(MEMBERS, name) ? undefined : MEMBERS[name];
    if (label !== undefined) found.push(label);
  };
  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAccessExpression(node)) {
      member(node.name.text);
    } else if (ts.isElementAccessExpression(node)) {
      member(literalName(node.argumentExpression));
    } else if (ts.isBindingElement(node) && ts.isObjectBindingPattern(node.parent)) {
      member(literalName(node.propertyName ?? node.name));
    } else if (ts.isNewExpression(node)) {
      const callee = node.expression;
      const name = ts.isPropertyAccessExpression(callee)
        ? callee.name.text
        : ts.isIdentifier(callee)
          ? callee.text
          : '';
      if (/RenderTarget$|^(?:EffectComposer|Reflector|Refractor|CubeCamera)$/u.test(name)) {
        found.push(`new ${name}`);
      }
    } else if (
      (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) &&
      literalName(node.name) === 'transmission'
    ) {
      found.push('transmission');
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}
