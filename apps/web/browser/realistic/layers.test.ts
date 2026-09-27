// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it } from 'vitest';

import type { RealisticShape } from '../../src/game/three-renderer';
import {
  BridgeBelt,
  ContactShadowBelt,
  HorizonRing,
  RealisticStructureBelts,
  RealisticVegetationBelt,
  REALISTIC_PRIMITIVE_SKIP,
  RiderBelt,
  ScatterBelt,
  SkyDome,
  TerrainBelt,
  WaterBelt,
  WorldLamps,
} from '../../src/game/three-renderer';
import { LAYERS, type Layer } from './config';
import {
  installLayerSwitch,
  type LayerSwitch,
  type RendererLike,
  type SceneLike,
  type SceneNode,
} from './layers';

/**
 * A stand-in for three's `Scene`: what the belts' `addTo` calls (`add`) and
 * what the switch reads. ⚠️ Not a real `Scene`, because this file may not
 * import `three` either — `three-seam.test.ts` holds `three-renderer.ts` to
 * being the only file under `apps/` that does.
 */
class FakeScene implements SceneLike {
  readonly children: SceneNode[] = [];
  background: unknown = { colour: 0x88aacc };
  environment: unknown = { texture: 'sky' };
  add(object: SceneNode): void {
    this.children.push(object);
  }
  /** A no-op, as three's own default is. */
  onBeforeRender: (renderer: RendererLike) => void = () => undefined;
}

/** A plain mesh, as the view's road is: three's `isMesh`, and a material with no flag. */
function plainMesh(material: object = {}): SceneNode {
  return { visible: true, type: 'Mesh', isMesh: true, material };
}

/**
 * One realistic tree, with a near mesh and an impostor, as the loader makes
 * one — its parts borrowed from belts, so that no `three` class is named here:
 * a stylised rock's geometry and material for the near mesh, and the water's
 * `ShaderMaterial` for the billboard.
 */
function tree(): RealisticShape {
  const scratch = new FakeScene();
  const rocks = new ScatterBelt();
  const [rock] = rocks.meshesOf('rock');
  new WaterBelt().addTo(scratch as never);
  const [water] = scratch.children;
  if (rock === undefined || water === undefined) throw new Error('no parts to borrow');
  expect((water.material as { isShaderMaterial?: boolean }).isShaderMaterial).toBe(true);
  return {
    name: 'fake-tree',
    parts: [{ geometry: rock.geometry, material: rock.material as never }],
    extent: 1,
    triangles: 12,
    impostor: { material: water.material as never, texture: {} as never },
  };
}

/**
 * A scene built the way `ThreeGameView` builds one — every belt through its own
 * `addTo`, and the road and the shadow catcher with `scene.add` — then the
 * realistic belts, as the first realistic rung adds them.
 */
function viewLikeScene(): {
  scene: FakeScene;
  road: SceneNode;
  catcher: SceneNode;
  stylised: ScatterBelt;
  vegetation: RealisticVegetationBelt;
  primitives: ScatterBelt;
} {
  const scene = new FakeScene();
  const into = scene as never;
  new SkyDome().addTo(into);
  new HorizonRing().addTo(into);
  new TerrainBelt().addTo(into);
  new WaterBelt().addTo(into);
  new BridgeBelt().addTo(into);
  const road = plainMesh();
  scene.add(road);
  const stylised = new ScatterBelt();
  stylised.addTo(into);
  new RiderBelt().addTo(into);
  new ContactShadowBelt().addTo(into);
  const catcher = plainMesh({ isShadowMaterial: true });
  scene.add(catcher);
  new WorldLamps().addTo(into);
  // The realistic world's belts, as `RealisticDrawing.addTo` adds them.
  const vegetation = new RealisticVegetationBelt(new Map([['tree-broadleaf', [tree()]]]));
  vegetation.addTo(into);
  new RealisticStructureBelts(new Map()).addTo(into);
  const primitives = new ScatterBelt(new Map(), { skip: REALISTIC_PRIMITIVE_SKIP, physical: true });
  primitives.addTo(into);
  return { scene, road, catcher, stylised, vegetation, primitives };
}

/** Draws one frame as `WebGLRenderer.render` does: everything shown, then `onBeforeRender`. */
function frame(
  scene: FakeScene,
  renderer: RendererLike = { info: { render: { triangles: 0 } } },
): void {
  for (const child of scene.children) child.visible = true;
  scene.onBeforeRender(renderer);
}

let installed: LayerSwitch | undefined;
afterEach(() => {
  installed?.uninstall();
  installed = undefined;
});

function install(off: readonly Layer[]): LayerSwitch {
  installed = installLayerSwitch(off);
  return installed;
}

describe('the realistic page’s layer switch — #616', () => {
  it('places every object a view-like scene holds, and every layer holds something', () => {
    const layers = install([]);
    viewLikeScene();
    const census = layers.census();
    expect(census.unplaced).toEqual([]);
    for (const layer of LAYERS) {
      expect(census.objects[layer], layer).toBeGreaterThan(0);
    }
    // The two the view adds itself.
    expect(census.objects.surfaces).toBe(3);
  });

  it('hides a switched-off layer on a drawn frame, and nothing else', () => {
    install(['vegetation']);
    const { scene, stylised, vegetation, primitives } = viewLikeScene();
    frame(scene);
    const near = vegetation.meshes.filter(
      (mesh) => !((mesh.material as { isShaderMaterial?: boolean }).isShaderMaterial === true),
    );
    const far = vegetation.meshes.filter(
      (mesh) => (mesh.material as { isShaderMaterial?: boolean }).isShaderMaterial === true,
    );
    expect(near.length).toBeGreaterThan(0);
    expect(far.length).toBeGreaterThan(0);
    for (const mesh of near) expect(mesh.visible).toBe(false);
    // Both worlds: the stylised trees go too — no rung mixes the worlds.
    for (const mesh of stylised.meshesOf('tree-conifer')) expect(mesh.visible).toBe(false);
    // …and what is not vegetation stays.
    for (const mesh of far) expect(mesh.visible).toBe(true);
    for (const mesh of stylised.meshesOf('post')) expect(mesh.visible).toBe(true);
    for (const mesh of stylised.meshesOf('barn')) expect(mesh.visible).toBe(true);
    for (const mesh of primitives.meshesOf('post')) expect(mesh.visible).toBe(true);
    const hidden = scene.children.filter((child) => !child.visible);
    expect(hidden.length).toBe(
      near.length + SCENERY_VEGETATION.flatMap((kind) => stylised.meshesOf(kind)).length,
    );
  });

  it('switches each layer off on its own, leaving the rest drawn', () => {
    for (const layer of LAYERS) {
      const layers = install([layer]);
      const { scene } = viewLikeScene();
      const expected = layers.census().objects[layer];
      frame(scene);
      const hidden = scene.children.filter((child) => !child.visible).length;
      expect(hidden, layer).toBe(expected);
      installed?.uninstall();
      installed = undefined;
    }
  });

  it('switches the structures off in both worlds, and leaves the posts beside the road', () => {
    install(['structures']);
    const { scene, stylised, primitives } = viewLikeScene();
    frame(scene);
    for (const mesh of stylised.meshesOf('barn')) expect(mesh.visible).toBe(false);
    for (const mesh of stylised.meshesOf('hedge')) expect(mesh.visible).toBe(false);
    // The posts belong to no layer: every switch leaves them drawn.
    expect(stylised.meshesOf('post').length).toBeGreaterThan(0);
    for (const mesh of stylised.meshesOf('post')) expect(mesh.visible).toBe(true);
    for (const mesh of primitives.meshesOf('post')) expect(mesh.visible).toBe(true);
  });

  it('takes the road and the shadow catcher by what they are', () => {
    install(['surfaces']);
    const { scene, road, catcher } = viewLikeScene();
    frame(scene);
    expect(road.visible).toBe(false);
    expect(catcher.visible).toBe(true);
    installed?.uninstall();
    install(['riders']);
    const next = viewLikeScene();
    frame(next.scene);
    expect(next.road.visible).toBe(true);
    expect(next.catcher.visible).toBe(false);
  });

  it('turns the sky off as the background AND the environment that lights the world', () => {
    install(['sky']);
    const { scene } = viewLikeScene();
    frame(scene);
    expect(scene.background).toBeNull();
    expect(scene.environment).toBeNull();
    installed?.uninstall();
    install(['water']);
    const kept = viewLikeScene();
    frame(kept.scene);
    expect(kept.scene.background).not.toBeNull();
    expect(kept.scene.environment).not.toBeNull();
  });

  it('says what it could not place, rather than leaving it drawn in silence', () => {
    const layers = install(['vegetation']);
    const { scene } = viewLikeScene();
    // A belt a later change adds without passing through a class the switch knows.
    const stranger = plainMesh();
    scene.add(stranger);
    frame(scene);
    // Two plain meshes are left over now, so neither is taken for the road.
    expect(layers.census().unplaced).toEqual(['Mesh', 'Mesh']);
    expect(stranger.visible).toBe(true);
  });

  it('hands back the renderer the frame was drawn with', () => {
    const layers = install([]);
    const { scene } = viewLikeScene();
    const renderer: RendererLike = { info: { render: { triangles: 7 } } };
    expect(layers.renderer()).toBeUndefined();
    frame(scene, renderer);
    expect(layers.renderer()).toBe(renderer);
  });

  it('puts every addTo back when uninstalled', () => {
    const addToOf = (): unknown =>
      Object.getOwnPropertyDescriptor(SkyDome.prototype, 'addTo')?.value;
    const before = addToOf();
    install(['sky']).uninstall();
    installed = undefined;
    expect(addToOf()).toBe(before);
  });
});

const SCENERY_VEGETATION = ['tree-broadleaf', 'tree-conifer', 'shrub', 'rock'] as const;
