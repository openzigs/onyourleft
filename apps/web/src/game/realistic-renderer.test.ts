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

import { REALISTIC_BICYCLE_TRIANGLES, REALISTIC_NEAR_MESHES } from './realistic-budget';
import { REALISTIC_VEGETATION_KINDS, realisticUrl, REALISTIC_SKY } from './realistic-assets';
import type { CameraPose } from './port';
import type { ScatterItem, SceneryKind } from './scatter';
import {
  isConstructedMaterial,
  loadRealisticWorld,
  prepareRealisticShape,
  realisticBicycleTriangles,
  RealisticVegetationBelt,
  realisticWorldLoaded,
  ScatterBelt,
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
  it('builds no mesh for a kind the vegetation belt draws', () => {
    const belt = new ScatterBelt(new Map(), {
      skip: new Set<SceneryKind>(REALISTIC_VEGETATION_KINDS),
      physical: true,
    });
    for (const kind of REALISTIC_VEGETATION_KINDS) expect(belt.meshesOf(kind)).toEqual([]);
    expect(belt.meshesOf('post').length).toBe(1);
    expect(belt.meshesOf('building').length).toBe(1);
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

  it('says it was offline when the browser says so, which is the fallback D-7 names', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    const outcome = await loadRealisticWorld(loaders('farm_field'));
    expect(outcome).toMatchObject({ loaded: false, offline: true });
  });
});

describe('the realistic bicycle — #369', () => {
  it('is built from bicycle.ts’s own parts inside its budget', () => {
    const triangles = realisticBicycleTriangles();
    expect(triangles).toBeGreaterThan(1_000);
    expect(triangles).toBeLessThanOrEqual(REALISTIC_BICYCLE_TRIANGLES);
  });
});
