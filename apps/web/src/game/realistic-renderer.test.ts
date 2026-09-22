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

import { afterEach, describe, expect, it, vi } from 'vitest';

import { REALISTIC_LADDER, type QualitySettings } from './quality';
import { REALISTIC_BICYCLE_TRIANGLES, REALISTIC_NEAR_MESHES } from './realistic-budget';
import {
  PHOTOGRAPHIC_STRUCTURE_SURFACES,
  REALISTIC_SKY,
  REALISTIC_STRUCTURE_PARTS,
  REALISTIC_STRUCTURE_SURFACES,
  REALISTIC_VEGETATION,
  REALISTIC_VEGETATION_KINDS,
  realisticUrl,
  type StructureSurface,
} from './realistic-assets';
import type { CameraPose } from './port';
import { STRUCTURE_KINDS, type ScatterItem, type SceneryKind } from './scatter';
import {
  isConstructedMaterial,
  loadRealisticWorld,
  prepareRealisticShape,
  realisticBicycleTriangles,
  REALISTIC_PRIMITIVE_SKIP,
  realisticResourceUrl,
  RealisticStructureBelts,
  realisticStructureGeometry,
  realisticStructureParts,
  RealisticVegetationBelt,
  realisticWorldLoaded,
  ScatterBelt,
  WaterBelt,
  type RealisticLoaders,
  type RealisticShape,
} from './three-renderer';

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
  it('draws the nearest trees of a kind as meshes, and every other as its impostor', () => {
    const belt = aBelt();
    // Far ones FIRST in the frame's order, so a belt that took the first N
    // rather than the nearest N is caught.
    const items = [150, 120, 90, 60, 40, 30, 20, 10].map((z) => item('tree-broadleaf', z));
    belt.update(items, POSE);
    const cap = REALISTIC_NEAR_MESHES['tree-broadleaf'];
    // Each tree mesh is drawn once per part, and the fixture tree has two.
    const meshes = belt.meshes.filter((mesh) => typeOf(mesh) !== 'ShaderMaterial');
    const drawnNear = Math.max(...meshes.map((mesh) => mesh.count));
    expect(drawnNear).toBe(cap);
    expect(drawn(belt).far).toBe(items.length - cap);
    // …and the near ones ARE the nearest: every near instance is within 30 m.
    for (const mesh of meshes) {
      for (let slot = 0; slot < mesh.count; slot += 1) {
        // The z of the translation, read straight out of the instance buffer.
        expect(mesh.instanceMatrix.array[slot * 16 + 14]).toBeLessThanOrEqual(30);
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
    return found;
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
  it('pairs every part of every structure with a surface to wear', () => {
    for (const kind of STRUCTURE_KINDS) {
      const parts = realisticStructureParts(kind);
      expect(parts.length, kind).toBe(REALISTIC_STRUCTURE_PARTS[kind].length);
      for (const part of parts) part.dispose();
    }
  });

  it('draws a house as brick walls and a tiled roof, placed by one item', () => {
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
    // And no other surface draws a house.
    for (const surface of ['slate', 'stone', 'planks', 'corrugated', 'hedge', 'painted'] as const) {
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
    for (const surface of [...PHOTOGRAPHIC_STRUCTURE_SURFACES, 'painted'] as const) {
      const meshes = STRUCTURE_KINDS.flatMap((kind) => belt.beltOf(surface)?.meshesOf(kind) ?? []);
      expect(meshes.length, surface).toBeGreaterThan(0);
      for (const mesh of meshes) {
        expect(typeOf(mesh), surface).toBe('MeshStandardMaterial');
        expect(isConstructedMaterial(mesh.material as never), surface).toBe(true);
        const material = mesh.material as unknown as { map: unknown; normalMap: unknown };
        if (surface === 'painted') {
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
    const worn = new Set<StructureSurface>(Object.values(REALISTIC_STRUCTURE_PARTS).flat());
    expect([...worn].sort()).toEqual([...PHOTOGRAPHIC_STRUCTURE_SURFACES, 'painted'].sort());
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
    const { loaders, held } = lateLoaders({ fail: REALISTIC_SKY, slowest: '_512.jpg' });
    const outcome = await loadRealisticWorld(loaders);
    expect(outcome.loaded).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 50));
    const surfaces = held.filter((one) => one.url.includes('_512.jpg'));
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
  });
});
