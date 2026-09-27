// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The owner's page's layer switch — #616: `?layers=-vegetation` turns the
 * vegetation off, and nothing else, so its share of the tablet's GPU clock can
 * be read as the difference between two runs at the same rung.
 *
 * ## How it finds a layer without the renderer's help
 *
 * #616 changes nothing the product ships — no export from `three-renderer.ts`,
 * no `@test-facing` exemption, no byte of the bundle. So this cannot ask the
 * view for its belts: they are private fields. What it can do is watch them
 * arrive. Every belt the view builds joins the scene through its own exported
 * class's `addTo(scene)`, so the switch wraps that one method on each class's
 * prototype before the view is built, and whatever a call adds to the scene is
 * owned by that class's layer ({@link LAYER_OWNERS}). Two objects the view adds
 * with `scene.add` itself are placed by what they are: the shadow catcher is
 * the one `ShadowMaterial` mesh left over, and the road is the one other mesh.
 *
 * Then, on every frame, it hides what is switched off in `scene.onBeforeRender`
 * — which three calls inside `render`, AFTER the view has staged the frame and
 * before anything is projected or drawn, shadow passes included. So the view
 * places everything exactly as it would, the rung's budgets are spent exactly
 * as they would be, and only the switched-off layer's draws are missing.
 *
 * ## What each layer is, in both worlds
 *
 * "A layer that is off is drawn by neither world" (#616): no rung mixes the
 * worlds (ADR 0026 D-3), so an absent layer is never replaced by its stylised
 * counterpart. Each layer therefore names what BOTH worlds draw it with.
 *
 * | layer | stylised | realistic |
 * |---|---|---|
 * | `sky` | the sky dome and the background colour | the photographed sky as background AND as the environment map that lights every PBR material |
 * | `surfaces` | the road, the ground, the hills on the horizon | the same meshes, in their photographed materials |
 * | `vegetation` | the trees, shrubs and rocks | their near meshes |
 * | `impostors` | — (there are none) | the far trees' billboards |
 * | `structures` | buildings, walls, hedges, fences, signposts | the same, photographed |
 * | `water` | streams, lakes, bridges | the same |
 * | `riders` | the three riders, their contact shadows and the shadow map's catcher | the MakeHuman riders, and the same shadows |
 *
 * The posts beside the road and the two lamps belong to no layer and stay on.
 * A bridge is `water`, because `waterways.ts` places it with the water it
 * crosses and without the water there is none.
 *
 * ⚠️ **It names no `three` type, and must not.** `three-seam.test.ts` holds
 * `three-renderer.ts` to being the ONLY file under `apps/` that imports
 * `three` — a type-only import included — and a harness is no exception. So
 * what this reads of a scene is structural ({@link SceneNode}), and a mesh, a
 * billboard's `ShaderMaterial` and the catcher's `ShadowMaterial` are told by
 * the `isMesh`, `isShaderMaterial` and `isShadowMaterial` flags three sets on
 * every instance of each for exactly this kind of duck-typing.
 *
 * ⚠️ **What it cannot place, it says so.** An object in the scene this file
 * cannot give an owner — a belt a later change adds without passing through a
 * class here — is listed in {@link LayerCensus.unplaced}, the page fails when
 * asked for a layer while anything is unplaced, and the browser gate holds the
 * list empty. A switch that quietly left a new belt on would report a share
 * for a layer that was never wholly off.
 */

import { isRealisticVegetation } from '../../src/game/realistic-assets';
import { SCENERY_KINDS, type SceneryKind } from '../../src/game/scatter';
import {
  BridgeBelt,
  ContactShadowBelt,
  GroundBlobBelt,
  HorizonRing,
  RealisticRiderBelt,
  RealisticStructureBelts,
  RealisticVegetationBelt,
  RiderBelt,
  ScatterBelt,
  SkyDome,
  TerrainBelt,
  WaterBelt,
  WorldLamps,
} from '../../src/game/three-renderer';
import { LAYERS, type Layer } from './config';

/** What this reads of an object in the scene: three's `Object3D`, structurally. */
export interface SceneNode {
  visible: boolean;
  /** three's own class name for the object: `Mesh`, `Group`, `DirectionalLight`… */
  readonly type: string;
  /** Set by three on every `Mesh`, `InstancedMesh` included. */
  readonly isMesh?: boolean;
  readonly material?: unknown;
}

/** What this reads and writes of the view's scene: three's `Scene`, structurally. */
export interface SceneLike {
  readonly children: readonly SceneNode[];
  background: unknown;
  environment: unknown;
  // A method, as three declares it, so a `Scene` is assignable here.
  onBeforeRender(renderer: RendererLike, ...rest: never[]): void;
}

/** What this reads of the renderer three hands `onBeforeRender`. */
export interface RendererLike {
  readonly info: { readonly render: { readonly triangles: number } };
}

/** Whether a material carries one of three's `is…Material` flags. */
function materialIs(node: SceneNode, flag: 'isShaderMaterial' | 'isShadowMaterial'): boolean {
  const material = node.material as Record<string, unknown> | null | undefined;
  return material?.[flag] === true;
}

/** Who owns an object in the scene: a layer, or nothing that can be switched off. */
export type Owner = Layer | 'always';

/**
 * How a belt's objects are owned: one owner for all of them, or a rule for
 * each, which answers `undefined` for an object it cannot place.
 */
type Ownership = Owner | ((belt: never) => (object: SceneNode) => Owner | undefined);

/** A scenery kind's layer, in either world's scatter belt. */
function kindLayer(kind: SceneryKind): Owner {
  if (isRealisticVegetation(kind)) return 'vegetation';
  if (kind === 'post') return 'always';
  return 'structures';
}

/**
 * Every class whose `addTo` puts something in the view's scene, and whose
 * layer that is. @see the header's table
 */
export const LAYER_OWNERS: ReadonlyMap<{ prototype: object }, Ownership> = new Map<
  { prototype: object },
  Ownership
>([
  [SkyDome, 'sky'],
  [HorizonRing, 'surfaces'],
  [TerrainBelt, 'surfaces'],
  [WaterBelt, 'water'],
  [BridgeBelt, 'water'],
  [RiderBelt, 'riders'],
  [RealisticRiderBelt, 'riders'],
  [ContactShadowBelt, 'riders'],
  [GroundBlobBelt, 'grounding'],
  [WorldLamps, 'always'],
  // Its four inner belts are `ScatterBelt`s; this, the outer call, owns them.
  [RealisticStructureBelts, 'structures'],
  [
    RealisticVegetationBelt,
    // A near mesh wears its scan's `MeshStandardMaterial`; a far tree's
    // billboard wears the impostor's `ShaderMaterial` (`RealisticShape`).
    () => (object) =>
      object.isMesh === true && materialIs(object, 'isShaderMaterial') ? 'impostors' : 'vegetation',
  ],
  [
    ScatterBelt,
    (belt: ScatterBelt) => {
      const byMesh = new Map<SceneNode, Owner>();
      for (const kind of SCENERY_KINDS) {
        for (const mesh of belt.meshesOf(kind)) byMesh.set(mesh, kindLayer(kind));
      }
      return (object) => byMesh.get(object);
    },
  ],
]);

/** What the switch has found in the scene. */
export interface LayerCensus {
  /** How many of the scene's top-level objects each layer owns. */
  readonly objects: Readonly<Record<Layer, number>>;
  /** Objects no rule here could place, by their three `type`. Empty, or the page is not to be trusted. */
  readonly unplaced: readonly string[];
}

/** The switch, installed. */
export interface LayerSwitch {
  /** What is in the scene now, by layer. */
  census(): LayerCensus;
  /** The renderer the view drew its last frame with, which `render` hands `onBeforeRender`. */
  renderer(): RendererLike | undefined;
  /** Puts every wrapped `addTo` back — for a test; the page never uninstalls. */
  uninstall(): void;
}

/**
 * Wraps every {@link LAYER_OWNERS} class's `addTo`, and hides `off` on every
 * frame drawn. Install it BEFORE the view is created: a belt added before is a
 * belt it never saw, and is reported unplaced rather than guessed at.
 */
export function installLayerSwitch(off: readonly Layer[]): LayerSwitch {
  /** What each class's `addTo` added, and whose it is. */
  const owners = new Map<SceneNode, Owner>();
  let scene: SceneLike | undefined;
  let lastRenderer: RendererLike | undefined;
  /** Every top-level object's owner, `undefined` for one nothing could place. */
  let placed = new Map<SceneNode, Owner | undefined>();
  /** The children count `placed` was worked out for; -1 when it is stale. */
  let placedFor = -1;
  let hidden: SceneNode[] = [];
  const skyOff = off.includes('sky');

  const place = (from: SceneLike): void => {
    // The two meshes the view adds with `scene.add` itself: the riders'
    // shadow-map catcher and the road, each the only one of its kind left over.
    const leftOver = from.children.filter((child) => !owners.has(child) && child.isMesh === true);
    const catchers = leftOver.filter((mesh) => materialIs(mesh, 'isShadowMaterial'));
    const roads = leftOver.filter((mesh) => !materialIs(mesh, 'isShadowMaterial'));
    placed = new Map(
      from.children.map((child) => [
        child,
        owners.get(child) ??
          (catchers.length === 1 && catchers[0] === child
            ? 'riders'
            : roads.length === 1 && roads[0] === child
              ? 'surfaces'
              : undefined),
      ]),
    );
    hidden = from.children.filter((child) => {
      const owner = placed.get(child);
      return owner !== undefined && owner !== 'always' && off.includes(owner);
    });
    placedFor = from.children.length;
  };

  const beforeRender = (on: SceneLike, renderer: RendererLike): void => {
    lastRenderer = renderer;
    if (placedFor !== on.children.length) place(on);
    for (const object of hidden) object.visible = false;
    if (skyOff) {
      on.background = null;
      on.environment = null;
    }
  };

  const attach = (to: SceneLike): void => {
    if (scene === to) return;
    scene = to;
    // eslint-disable-next-line @typescript-eslint/unbound-method -- called with its own `this` below
    const previous = to.onBeforeRender;
    to.onBeforeRender = function (
      this: SceneLike,
      ...args: Parameters<SceneLike['onBeforeRender']>
    ) {
      previous.apply(this, args);
      beforeRender(to, args[0]);
    };
  };

  const restores: (() => void)[] = [];
  for (const [owner, ownership] of LAYER_OWNERS) {
    const prototype = owner.prototype as { addTo: (scene: SceneLike) => void };
    const original = prototype.addTo;
    prototype.addTo = function wrapped(this: never, to: SceneLike): void {
      const before = new Set(to.children);
      original.call(this, to);
      // A belt inside a belt (`RealisticStructureBelts` adds four
      // `ScatterBelt`s): the outer call returns last, so its owner is the one
      // that stands for everything either added.
      const added = to.children.filter((child) => !before.has(child));
      const ownerOf = typeof ownership === 'string' ? () => ownership : ownership(this);
      for (const child of added) {
        const each = ownerOf(child);
        if (each !== undefined) owners.set(child, each);
      }
      attach(to);
      placedFor = -1;
    };
    restores.push(() => {
      prototype.addTo = original;
    });
  }

  return {
    census: () => {
      if (scene !== undefined && placedFor !== scene.children.length) place(scene);
      const objects = Object.fromEntries(LAYERS.map((layer) => [layer, 0])) as Record<
        Layer,
        number
      >;
      const unplaced: string[] = [];
      for (const [child, owner] of placed) {
        if (owner === undefined) unplaced.push(child.type);
        else if (owner !== 'always') objects[owner] += 1;
      }
      return { objects, unplaced };
    },
    renderer: () => lastRenderer,
    uninstall: () => {
      for (const restore of restores) restore();
    },
  };
}
