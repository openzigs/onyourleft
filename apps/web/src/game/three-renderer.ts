// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The one file in this repository that names `three`.
 *
 * The same rule `map/maplibre.ts` follows for `maplibre-gl`, and for the same
 * reason: a rendering library that leaks past its adapter is a rendering library
 * that cannot be replaced, and ADR 0008's own fallback (D-2) is a stack change
 * that would keep every leaf package and replace exactly this layer.
 *
 * ⚠️ **Nothing here is derived from another product.** #19 and ADR 0009 forbid
 * taking a world asset, course geometry, texture or model from anywhere, and
 * this file loads none: every vertex comes from `terrain.ts`, which computes
 * them from the rider's own imported GPX, and the three markers are primitives
 * three.js generates from numbers. There is no texture, no model file and no
 * asset directory in this epic — which #91 records as the reason it can ship
 * without an art budget rather than as a shortcut.
 *
 * ## The world is three objects, and still no illumination
 *
 * #241 gives the scene a ground plane, a sky and exponential fog, all three
 * coloured from `world.ts`'s `WorldStyle` and therefore from the rider's own
 * route. **No lamp of any kind was added and none is wanted**: a
 * `MeshBasicMaterial` is unlit by definition, so the ground costs one draw call
 * and no shading pass, and the statement below about a flat-shaded road still
 * holds for everything in this file. A case-sensitive grep for three's
 * illumination classes over this file returns nothing, and `three-seam.test.ts`
 * is what keeps it that way rather than leaving it to review.
 *
 * ## The road's colour is now its own vertices'
 *
 * ⚠️ **`ROAD_COLOUR` used to be a constant in this file and is now in
 * `terrain.ts`**, beside the two gradient tints and the marking colour it is
 * blended with. A reviewer who remembers a single road colour here is reading
 * the old file. #242 gave the road two edge lines, a broken centre line and a
 * surface tinted by gradient, and all four are vertex data in one buffer — so
 * the road's material names **no colour at all**. three's default is white,
 * and white multiplied by a vertex colour is the vertex colour.
 *
 * That is what keeps the whole road one mesh and one draw call, which #240's
 * NFR-2 says is the budget that matters here. It is also still flat-shaded:
 * an edge line that reads as an edge line costs a vertex rather than a lamp.
 *
 * ## The scenery is instanced, and it is the first thing here that is culled
 *
 * #244 draws what `scatter.ts` placed. **One `InstancedMesh` per kind**, six of
 * them, built once and reused — five hundred trees is six draw calls rather
 * than five hundred, which is the budget #240's NFR-2 says actually matters.
 * Every shape is a three primitive built from numbers in {@link SCATTER_STYLE};
 * as with the markers and the road, no model, texture or asset file is loaded
 * and nothing is derived from any other product.
 *
 * ⚠️ **And it is the first object in this file that three is allowed to cull.**
 * `frustumCulled = false` is right for the road and for the ground — one
 * ribbon and one backdrop, both always in front of the camera — and copying it
 * across to a belt that stands beside the road is the mistake #244's fifth
 * criterion exists to catch. {@link ScatterBelt} says what it does instead.
 *
 * ## Why it is written against a lost context rather than assuming one
 *
 * `canvas.getContext('webgl2')` returns `null` for ordinary reasons — WebGL
 * disabled, GPU memory exhausted, a context lost on a phone that just came back
 * from the background. `three` throws on construction when that happens. So
 * construction is guarded and {@link GameView.hasContext} reports the result:
 * the ride screen keeps its HUD and loses its scenery, rather than losing the
 * ride. A rider mid-effort should not be handed a blank page because the GPU
 * blinked.
 */

import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  DynamicDrawUsage,
  FogExp2,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
  PerspectiveCamera,
  PlaneGeometry,
  Quaternion,
  Scene,
  SphereGeometry,
  Vector3,
  WebGLRenderer,
  type Material,
} from 'three';

import type { QualitySettings } from './quality';
import { CAMERA_BEHIND_METRES } from './port';
import type { CameraPose, GameRenderer, GameView, RiderMarker, SceneFrame } from './port';
import {
  SCATTER_BAND_METRES,
  SCATTER_KINDS,
  SCATTER_MAX_ITEMS,
  SCATTER_VERGE_METRES,
  type ScatterItem,
  type ScatterKind,
} from './scatter';
import { ROAD_WIDTH_METRES, VIEW_AHEAD_METRES, VIEW_BEHIND_METRES } from './terrain';
import type { WorldStyle } from './world';

/**
 * How far above the rider the chase camera sits, in metres.
 *
 * Its sibling {@link CAMERA_BEHIND_METRES} is in `port.ts` rather than here,
 * because `world.test.ts` needs it and must not import `three`; that is where
 * the rest of this note lives. ADR 0008 **D-5** fixes the camera, so the two
 * together are the whole of its configuration — there is no free-look, and
 * adding one is a change to that ADR.
 */
const CAMERA_ABOVE_METRES = 3;

/** How far ahead of the rider the camera looks. */
const CAMERA_TARGET_AHEAD_METRES = 25;

/**
 * Colours, and the shapes that carry the same distinction without them.
 *
 * ⚠️ Each marker differs in **shape as well as colour**, which is #93's third
 * criterion taken seriously rather than satisfied with three hues. A rider
 * glancing at a bar-mounted phone in sunlight, possibly with a colour-vision
 * deficiency, has to tell these apart in about a second — and colour alone is
 * exactly what fails in both of those conditions. `views/AnalysisView.tsx` makes
 * the same argument for the same reason.
 */
const MARKER_STYLE: Record<RiderMarker['kind'], { colour: number; radius: number }> = {
  rider: { colour: 0x2f6fed, radius: 0.9 },
  bot: { colour: 0xc2410c, radius: 0.8 },
  ghost: { colour: 0x64748b, radius: 0.8 },
};

/**
 * How far the ground plane reaches from the camera, in metres.
 *
 * Far enough that its edge is past where {@link WorldStyle.fogDensity} has
 * faded everything to the horizon colour, and inside the camera's own far plane
 * so a driver never clips it: the corner of a 2 × 1 200 m square is 1 697 m
 * away, against a far plane of 2 000.
 *
 * ⚠️ **It is one quad.** #240's NFR-2 is explicit that the budget here is draw
 * calls, overdraw and fill rate rather than triangles, and a ground made of a
 * grid would buy nothing — there is nothing shading it and no displacement on
 * it. Two triangles is the whole cost.
 */
const GROUND_RADIUS_METRES = 1200;

/** How far under the road the ground sits, so the road reads as a raised surface. */
const GROUND_BELOW_ROAD_METRES = 0.25;

/**
 * What the sky and the ground are before a frame has said what they are.
 *
 * ⚠️ **Black, and chosen to be black deliberately.** No rider ever sees it —
 * `#updateWorld` runs before every draw — but a renderer that stopped reading
 * `SceneFrame.world` would then draw the *default* colours, and three's own
 * default for both a `Color` and a `MeshBasicMaterial` is **white**. A browser
 * gate asserting "the sky is no longer the clear colour" would pass over a
 * white sky and a white ground, and #240's named defect for this epic would
 * ship. Black is the clear colour, so that assertion goes red instead. It was
 * white here first, and the mutation run for #241 is what found it.
 */
const UNSET_COLOUR = 0x000000;

/**
 * How far from the road's centreline `scatter.ts` can put anything: **21 m**.
 *
 * Derived from that file's own three numbers rather than restated here, so the
 * cull below cannot go on describing a band that has moved.
 */
const SCATTER_BAND_REACH_METRES =
  ROAD_WIDTH_METRES / 2 + SCATTER_VERGE_METRES + SCATTER_BAND_METRES;

/**
 * How far to the side of the rider a scatter item may stand and still be drawn.
 *
 * ⚠️ **The bound nothing in this repository had until #244.** The corridor has
 * been bounded *along* the road since #91 — {@link VIEW_AHEAD_METRES} and
 * {@link VIEW_BEHIND_METRES} — and `terrain.ts` could say *"there is no fog and
 * nothing to cull, because there is nothing outside the corridor to draw"*
 * because a road ribbon is the one shape that is always in front of you.
 * Scenery is not: it stands beside the road, it survives a bend, and a belt
 * drawn however far off the heading it has wandered is fill rate spent on
 * pixels nobody sees. ADR 0008 D-5's *decision* — a fixed camera — is untouched
 * by this; its stated *consequence*, that there is nothing to cull, is what
 * stops being true, and #246 is the appended amendment that records it.
 *
 * **Derived, not chosen.** One {@link SCATTER_BAND_REACH_METRES} is the scenery
 * itself; the second is room for the *road* to bend away from the rider's own
 * heading inside the view, because the cull is measured in the rider's frame
 * and the road is not straight.
 *
 * ⚠️ **What this gets wrong, measured rather than reasoned — and it is worse
 * than a first reading suggests.** The bound is a *constant* half-width; what a
 * camera can see is a **cone** that widens with distance. Beyond roughly
 * `SCATTER_LATERAL_METRES / tan(half the horizontal field of view)` — about
 * 37 m ahead — this box is therefore **narrower than the frustum**, so on a
 * bend the far end of the belt leaves it while it is still on screen and barely
 * fogged, and pops back in as the bend straightens.
 *
 * The onset is not one distance. It is `R · acos(1 − SCATTER_LATERAL_METRES / R)`
 * and it scales with the bend's radius: about 190 m at R = 450 m, about 95 m at
 * R = 100 m. At the shorter of those the fog has taken well under half of what
 * is being dropped, so *"beyond where the fog has taken most of it"* is true at
 * one radius and not in general.
 *
 * Driving the real `sceneFrame` through this belt on constant-radius routes —
 * 240 items placed every frame, worst frame of a 1.5 km sweep — the fraction
 * submitted is **98.3 % straight, 80.0 % at R = 1 000 m, 56.7 % at R = 450 m,
 * 41.3 % at R = 200 m and 29.6 % at R = 100 m**. `three-renderer.test.ts`
 * §"the cull against what `scene.ts` actually hands it" pins those numbers at
 * a stated radius rather than leaving them here to age.
 *
 * So on an ordinary road corner this throws away scenery a rider can see. That
 * is a real cost of shipping the cull as a box, it is
 * {@link https://github.com/openzigs/onyourleft/issues/269 | #269}, and the two
 * ways out are recorded there: a frustum-shaped lateral test, or a cull against
 * `SceneFrame.corridor.centre` instead of the rider's straight-line frame.
 */
export const SCATTER_LATERAL_METRES = 2 * SCATTER_BAND_REACH_METRES;

/**
 * How many instances of one kind the belt has room for before it has to grow.
 *
 * ⚠️ **Allocated for every kind in the constructor, before a frame arrives, and
 * that is the point rather than a shortcut.** three creates a GPU buffer the
 * first time it draws an object; a belt that allocated a kind's matrices the
 * frame that kind first appeared would allocate at 400 m into a ride, which is
 * exactly the per-frame-allocation shape #240's NFR-3 forbids showing up late
 * enough that no gate would see it. Six kinds at {@link SCATTER_MAX_ITEMS}
 * matrices is 6 × 240 × 64 bytes ≈ 92 kB, once, on a device floor ADR 0008 D-4
 * puts at 3 GB.
 *
 * It is {@link SCATTER_MAX_ITEMS} per kind rather than shared between them
 * because the split cannot be known ahead of a frame: a stretch through a
 * forest is very nearly all conifer, and a belt that had reserved a sixth of
 * the budget for each kind would draw a sixth of the forest.
 */
export const SCATTER_INSTANCE_CAPACITY = SCATTER_MAX_ITEMS;

/**
 * What each kind is made of, and what colour it is.
 *
 * ⚠️ **Provenance, per #240's BR-1 and ADR 0009 L2.** Every entry is built from
 * three's own geometry classes out of numbers typed here; **no model, texture,
 * asset file or course geometry is loaded, and none of it was derived from
 * another product, including "for reference"**. The dimensions are ordinary
 * roadside sizes — a conifer about 7 m tall, a marker post a little over a
 * metre, a building a few metres on a side — and the colours are plain
 * vegetation, stone and paint. `scatter.ts` §"Provenance" makes the same
 * declaration for the placement.
 *
 * The geometry is translated so that its **base sits at y = 0**, because a
 * {@link ScatterItem}'s `y` is the ground under it: three centres every
 * primitive on its own origin, so a cone left alone is half buried.
 */
const SCATTER_STYLE: Record<ScatterKind, { colour: number; geometry: () => BufferGeometry }> = {
  'tree-broadleaf': {
    colour: 0x3f6b33,
    // A canopy, coarse on purpose: at the distances fog leaves visible, a
    // six-segment sphere and a smooth one are the same handful of pixels.
    geometry: () => new SphereGeometry(2.2, 6, 4).translate(0, 2.6, 0),
  },
  'tree-conifer': {
    colour: 0x2b4a30,
    geometry: () => new ConeGeometry(1.3, 7, 6).translate(0, 3.5, 0),
  },
  shrub: {
    colour: 0x5c7a3f,
    geometry: () => new SphereGeometry(0.8, 5, 3).translate(0, 0.6, 0),
  },
  rock: {
    colour: 0x8a8579,
    geometry: () => new OctahedronGeometry(0.9, 0).translate(0, 0.5, 0),
  },
  post: {
    colour: 0xd8d5cc,
    geometry: () => new CylinderGeometry(0.07, 0.07, 1.1, 5).translate(0, 0.55, 0),
  },
  building: {
    colour: 0xa8968a,
    geometry: () => new BoxGeometry(7, 6, 9).translate(0, 3, 0),
  },
};

/**
 * The scenery belt: one {@link InstancedMesh} per {@link ScatterKind}, reused.
 *
 * ## Why this is a class of its own, and why it is exported
 *
 * ⚠️ **Exported so the jsdom suite can drive it, and for no other reason.**
 * `three-renderer.ts` is the one file allowed to name `three` (§4h,
 * `three-seam.test.ts`), so a belt in a file of its own is not available; and a
 * belt reachable only through {@link ThreeGameView} is not testable at all,
 * because jsdom implements no WebGL and a `WebGLRenderer` cannot be constructed
 * there. Every claim #244 makes about instancing — one mesh per kind, the same
 * mesh at frame 100 as at frame 1, the count actually submitted — is arithmetic
 * over three objects that need no context, so it is asserted where the rest of
 * `game/` is asserted. What is left for the browser gate is the half jsdom
 * genuinely cannot see: that the belt is **in the scene** and reaches the
 * drawing buffer.
 *
 * ## One draw call per kind, which is the whole budget argument
 *
 * #240's NFR-2 is that the budget here is draw calls, overdraw and fill rate
 * rather than triangles. Five hundred `Mesh` objects is five hundred draw calls
 * and is invisible until a phone is in hand; five hundred instances of six
 * meshes is six. That is the entire reason this class exists.
 *
 * ## Three things it is careful about
 *
 * 1. **Nothing is allocated per frame.** The meshes, their geometry, their
 *    materials and their matrix buffers are built once — see
 *    {@link SCATTER_INSTANCE_CAPACITY} — and {@link ScatterBelt.update} writes
 *    into them. #240's NFR-3, and the rebuild runs on the same JavaScript
 *    thread GATT notifications arrive on, so an allocation here is a dropped
 *    sensor sample rather than only a stutter.
 * 2. **`instanceMatrix.needsUpdate` is set whenever a matrix is written**, and
 *    that is the half that is invisible when it is missing: three uploads an
 *    instance buffer the first time it binds it and thereafter only when the
 *    flag says to, so without it the matrices are written, every test asserting
 *    the matrices passes, and the scenery stays where it was on frame one.
 * 3. **`frustumCulled` is left alone.** The road sets it to `false` and is
 *    right to — it is one ribbon, rebuilt in world coordinates every frame,
 *    always in front of the camera. Copying that across to a scatter belt is
 *    the specific mistake #244's fifth criterion exists to catch. The belt is
 *    beside the road rather than on it, so three's own culling is worth having;
 *    what it needs in exchange is a bounding sphere that is recomputed after
 *    the matrices move, which {@link ScatterBelt.update} does.
 */
export class ScatterBelt {
  readonly #meshes = new Map<ScatterKind, InstancedMesh>();
  /** Survivors of the cull, per kind, for the frame being built. */
  readonly #counts = new Map<ScatterKind, number>();
  /** Reused every instance of every frame — see the header's first point. */
  readonly #matrix = new Matrix4();
  readonly #position = new Vector3();
  readonly #quaternion = new Quaternion();
  readonly #scale = new Vector3();
  readonly #up = new Vector3(0, 1, 0);

  constructor() {
    for (const kind of SCATTER_KINDS) {
      const mesh = new InstancedMesh(
        SCATTER_STYLE[kind].geometry(),
        // Unlit, like everything else in this file: a `MeshBasicMaterial` costs
        // no shading pass, and "no lighting means no light budget" is the whole
        // reason this renderer can ship without one.
        new MeshBasicMaterial({ color: SCATTER_STYLE[kind].colour }),
        SCATTER_INSTANCE_CAPACITY,
      );
      // The buffer is rewritten every frame, so tell the driver that rather
      // than letting it hint STATIC_DRAW for something that never is.
      mesh.instanceMatrix.setUsage(DynamicDrawUsage);
      // three's constructor fills every slot with the identity matrix and sets
      // `count` to the capacity. A belt that drew before its first frame would
      // draw the whole capacity stacked at the origin.
      mesh.count = 0;
      mesh.visible = false;
      this.#meshes.set(kind, mesh);
      this.#counts.set(kind, 0);
    }
  }

  /** The meshes, by kind. Six of them, whatever the frame holds. */
  get meshes(): ReadonlyMap<ScatterKind, InstancedMesh> {
    return this.#meshes;
  }

  /** Puts the belt in a scene. Called once, by the view that owns it. */
  addTo(scene: Scene): void {
    for (const mesh of this.#meshes.values()) {
      scene.add(mesh);
    }
  }

  /**
   * Places this frame's scenery, culled to what the rider can see.
   *
   * ⚠️ **Measured from the rider rather than from the camera**, which sits
   * {@link CAMERA_BEHIND_METRES} further back. {@link VIEW_AHEAD_METRES} and
   * {@link VIEW_BEHIND_METRES} are the corridor's own bounds and the corridor
   * is built around the rider's odometer, so measuring from anywhere else would
   * cull scenery the road under it is still being drawn for.
   *
   * ⚠️ **The cull is here rather than left to the caller**, even though
   * `scene.ts` already asks `scatter.ts` for exactly the corridor's span. A
   * renderer is handed a {@link SceneFrame} and does not know who built it —
   * `roadCorridor`'s options already let a caller override the span — and a
   * belt that trusted the list would submit whatever it was given. It also
   * could not cull *laterally* at all, which nothing upstream does.
   *
   * Two passes over the items rather than one, so that a mesh grows at most
   * once for a frame instead of once per item that overflows it.
   */
  update(items: readonly ScatterItem[], pose: CameraPose): void {
    for (const kind of SCATTER_KINDS) {
      this.#counts.set(kind, 0);
    }
    for (const item of items) {
      if (this.#inView(item, pose)) {
        this.#counts.set(item.kind, (this.#counts.get(item.kind) ?? 0) + 1);
      }
    }
    for (const [kind, mesh] of this.#meshes) {
      reserve(mesh, this.#counts.get(kind) ?? 0);
      // Rewound here rather than tracked in a second map: the next loop uses
      // `mesh.count` as its write cursor and this is where it starts.
      mesh.count = 0;
    }
    for (const item of items) {
      const mesh = this.#meshes.get(item.kind);
      if (mesh === undefined || !this.#inView(item, pose)) {
        continue;
      }
      this.#position.set(item.x, item.y, item.z);
      this.#quaternion.setFromAxisAngle(this.#up, item.rotation);
      this.#scale.setScalar(item.scale);
      this.#matrix.compose(this.#position, this.#quaternion, this.#scale);
      mesh.setMatrixAt(mesh.count, this.#matrix);
      mesh.count += 1;
    }
    for (const mesh of this.#meshes.values()) {
      if (mesh.count > 0) {
        // ⚠️ Every live matrix was just rewritten, so there is always something
        // to upload when there is anything to draw. Comparing sixteen floats an
        // instance to sometimes skip this would cost more than the upload.
        mesh.instanceMatrix.needsUpdate = true;
        // three caches a bounding sphere until it is asked to recompute one,
        // and the instances move every frame. Without this the belt is culled
        // against where it stood when the sphere was first needed, and the
        // scenery vanishes as the rider rides out of it. @see the header's
        // third point.
        mesh.computeBoundingSphere();
      }
      // A mesh with `count === 0` issues no draw call in any case — three's own
      // `renderInstances` returns early on it — but an invisible object is not
      // projected, sorted or bound at all.
      mesh.visible = mesh.count > 0;
    }
  }

  /** Releases every GPU resource the belt owns. */
  dispose(): void {
    for (const mesh of this.#meshes.values()) {
      mesh.geometry.dispose();
      disposeMaterial(mesh.material);
      mesh.dispose();
    }
  }

  /**
   * Whether an item is inside the box the rider can see.
   *
   * `along` is the item's distance up the rider's heading and `across` is its
   * distance to the side of it — the two components of the same offset in the
   * rider's own frame, which is the frame {@link VIEW_AHEAD_METRES} and
   * {@link SCATTER_LATERAL_METRES} are both stated in.
   */
  #inView(item: ScatterItem, pose: CameraPose): boolean {
    const dx = item.x - pose.x;
    const dz = item.z - pose.z;
    const along = dx * pose.headingX + dz * pose.headingZ;
    if (along > VIEW_AHEAD_METRES || along < -VIEW_BEHIND_METRES) {
      return false;
    }
    const across = dx * pose.headingZ - dz * pose.headingX;
    return Math.abs(across) <= SCATTER_LATERAL_METRES;
  }
}

/**
 * Makes room for `needed` instances, growing the matrix buffer if it has to.
 *
 * ⚠️ **The mesh is never replaced, and in practice nor is its buffer**:
 * {@link SCATTER_INSTANCE_CAPACITY} is reserved for every kind before the first
 * frame, so this is a no-op for any caller inside `scatter.ts`'s own budget.
 * The growth path is what stops a caller who ignores that budget being silently
 * truncated, which would be scenery that a test placed and the screen never
 * showed — #240's named defect shape for this epic.
 *
 * Nothing is copied out of the old buffer: every live matrix is written after
 * this returns, so a copy would be copying data about to be overwritten.
 *
 * ⚠️ **Replacing `instanceMatrix` strands the previous GL buffer, and the
 * doubling is what bounds how many can be stranded.** three frees an instance
 * buffer only in its `onInstancedMeshDispose`, which removes the attribute the
 * mesh holds *at that moment* — so the one this discards stays in the driver
 * for the life of the context. Sizing the replacement to exactly `needed` would
 * mean a caller one item over budget reallocating, and stranding a buffer,
 * **every frame**, which is precisely the per-frame-allocation shape #240's
 * NFR-3 forbids. Doubling makes the number of strandings logarithmic in the
 * count instead of linear in the frame number.
 */
function reserve(mesh: InstancedMesh, needed: number): void {
  const held = mesh.instanceMatrix.count;
  if (needed <= held) {
    return;
  }
  const grown = new InstancedBufferAttribute(new Float32Array(Math.max(needed, held * 2) * 16), 16);
  grown.setUsage(DynamicDrawUsage);
  mesh.instanceMatrix = grown;
}

class ThreeGameView implements GameView {
  readonly hasContext: boolean;
  readonly #renderer: WebGLRenderer | undefined;
  readonly #scene = new Scene();
  readonly #camera = new PerspectiveCamera(60, 1, 0.5, 2_000);
  readonly #roadGeometry = new BufferGeometry();
  readonly #road: Mesh;
  readonly #markers = new Map<RiderMarker['kind'], Mesh>();
  /**
   * The world, as three objects built once and mutated thereafter — #240's
   * NFR-3. Every one of them is a fixed instance: the sky is the `Color` the
   * scene's background *is*, the fog is the `FogExp2` the scene holds, and the
   * ground is one `Mesh` that follows the camera. `#updateWorld` sets numbers
   * on these and never replaces them.
   */
  readonly #sky = new Color(UNSET_COLOUR);
  readonly #fog = new FogExp2(UNSET_COLOUR, 0);
  readonly #ground: Mesh;
  /**
   * What stands beside the road — #244. One mesh per kind, built once.
   *
   * ⚠️ A belt that is built and never added to the scene, or added and left
   * with `count === 0`, passes every test in the jsdom suite and draws nothing.
   * That is #240's named defect shape for this epic arriving one layer down
   * from `SceneFrame.scatter` being unread, and `game.browser.spec.ts` reads
   * the drawing buffer back beside the road for exactly that reason.
   */
  readonly #scatter = new ScatterBelt();
  readonly #groundMaterial = new MeshBasicMaterial({
    color: UNSET_COLOUR,
    // ⚠️ **Writes no depth, and draws first.** That is what lets a flat plane
    // stand under a road that climbs and descends: the road, the markers and
    // anything a later sub-issue adds are drawn over it whatever their height,
    // so a rider descending never watches the road they are on disappear
    // beneath a plane pinned to where they were. It is a backdrop, and a
    // backdrop that occludes is a bug rather than a depth cue.
    depthWrite: false,
  });
  #quality: QualitySettings;
  #widthCssPixels = 1;
  #heightCssPixels = 1;
  #vertexCapacity = 0;
  #indexCapacity = 0;

  constructor(canvas: HTMLCanvasElement, settings: QualitySettings) {
    this.#quality = settings;
    let renderer: WebGLRenderer | undefined;
    try {
      renderer = new WebGLRenderer({ canvas, antialias: false, alpha: false });
    } catch {
      // See the header: a missing context is an ordinary condition, not a bug.
      renderer = undefined;
    }
    this.#renderer = renderer;
    this.hasContext = renderer !== undefined;

    this.#scene.background = this.#sky;
    this.#scene.fog = this.#fog;

    this.#ground = new Mesh(
      new PlaneGeometry(GROUND_RADIUS_METRES * 2, GROUND_RADIUS_METRES * 2),
      this.#groundMaterial,
    );
    // A `PlaneGeometry` stands up in the XY plane; this lays it down.
    this.#ground.rotation.x = -Math.PI / 2;
    this.#ground.frustumCulled = false;
    this.#ground.renderOrder = -1;
    this.#scene.add(this.#ground);

    this.#road = new Mesh(
      this.#roadGeometry,
      // `vertexColors` is what makes the surface, the two edge lines and the
      // broken centre line **one mesh and one draw call** (#242). Without it
      // each would need a material of its own, and a material is a draw call.
      new MeshBasicMaterial({ side: DoubleSide, vertexColors: true }),
    );
    // The corridor is rebuilt in world coordinates every time, so three's own
    // frustum culling has nothing useful to test against and would occasionally
    // cull the road we just built. There is one mesh; culling it saves nothing.
    this.#road.frustumCulled = false;
    this.#scene.add(this.#road);

    this.#scatter.addTo(this.#scene);

    for (const kind of ['ghost', 'bot', 'rider'] as const) {
      const marker = new Mesh(
        markerGeometry(kind),
        new MeshBasicMaterial({
          color: MARKER_STYLE[kind].colour,
        }),
      );
      marker.frustumCulled = false;
      marker.visible = false;
      this.#markers.set(kind, marker);
      this.#scene.add(marker);
    }

    if (renderer !== undefined) {
      this.setQuality(settings);
    }
  }

  render(frame: SceneFrame): void {
    if (this.#renderer === undefined) {
      return;
    }
    this.#updateWorld(frame.world, frame.camera);
    this.#updateRoad(frame);
    this.#scatter.update(frame.scatter, frame.camera);
    this.#updateMarkers(frame.markers);
    this.#placeCamera(frame.camera);
    this.#renderer.render(this.#scene, this.#camera);
  }

  setQuality(settings: QualitySettings): void {
    this.#quality = settings;
    this.#applySize();
  }

  resize(widthCssPixels: number, heightCssPixels: number): void {
    this.#widthCssPixels = Math.max(1, widthCssPixels);
    this.#heightCssPixels = Math.max(1, heightCssPixels);
    this.#applySize();
  }

  destroy(): void {
    this.#roadGeometry.dispose();
    this.#ground.geometry.dispose();
    this.#groundMaterial.dispose();
    disposeMaterial(this.#road.material);
    this.#scatter.dispose();
    for (const marker of this.#markers.values()) {
      marker.geometry.dispose();
      disposeMaterial(marker.material);
    }
    this.#markers.clear();
    // `forceContextLoss` before `dispose` because a WebGL context is not
    // garbage-collected promptly and a browser allows only a handful at once —
    // a rider starting five rides in a session would otherwise run out.
    this.#renderer?.forceContextLoss();
    this.#renderer?.dispose();
  }

  /**
   * Applies the world `world.ts` derived from the route — #241.
   *
   * ⚠️ **This method is the whole of what makes `SceneFrame.world` real.** A
   * field added to the frame and never read here passes every test in the jsdom
   * suite and changes nothing on the screen, which is #240's named defect shape
   * for this epic. `game.browser.spec.ts` reads the drawing buffer back above
   * the horizon and beside the road for that reason.
   *
   * The three colours land in three different places and each is deliberate:
   * the **sky** is the scene's background, which nothing fogs, so it stays the
   * one flat reference the eye reads depth against; the **horizon** is the fog
   * colour, so every distant surface converges on it and the line where the
   * fogged ground meets the unfogged sky *is* the horizon; and the **ground**
   * is the plane's own colour, near the camera where the fog has not reached.
   *
   * The plane follows the camera in the ground plane so it always reaches the
   * horizon, and sits {@link GROUND_BELOW_ROAD_METRES} under the road at the
   * rider rather than at a fixed height, so a climb does not leave the road
   * hanging over a distant floor.
   */
  #updateWorld(world: WorldStyle, pose: CameraPose): void {
    this.#sky.setHex(world.skyColour);
    this.#fog.color.setHex(world.horizonColour);
    this.#fog.density = world.fogDensity;
    this.#groundMaterial.color.setHex(world.groundColour);
    this.#ground.position.set(pose.x, pose.y - GROUND_BELOW_ROAD_METRES, pose.z);
  }

  /**
   * Uploads the corridor: its positions, its colours and its triangles.
   *
   * The buffers are **reused and only grown**, never reallocated per frame: the
   * corridor is rebuilt as the rider moves, and allocating a new
   * `Float32Array` plus a new `BufferAttribute` thirty times a second is the
   * allocation pattern that produces a garbage-collection pause — which on this
   * device shows up as the stutter #91's criterion is about. #240's NFR-3.
   *
   * ⚠️ **Three attributes now, and the index list comes from `terrain.ts`.**
   * Until #242 the road was one lane of one colour, so a strip index could be
   * generated here from a quad count. It is three lanes and a run of
   * centre-line marks now, and the shape of that list is a property of the
   * geometry rather than of the renderer — so this method uploads what it is
   * given and decides nothing.
   *
   * ⚠️ **A colour attribute added here that `terrain.ts` never fills, or filled
   * there and never uploaded here, is #240's named defect shape for this epic**:
   * every jsdom test passes and the screen is unchanged. `game.browser.spec.ts`
   * reads the drawing buffer back on the centre line for exactly that reason.
   */
  #updateRoad(frame: SceneFrame): void {
    const { vertices, colours, indices } = frame.corridor;
    if (vertices.length > this.#vertexCapacity) {
      this.#vertexCapacity = vertices.length;
      this.#roadGeometry.setAttribute(
        'position',
        new BufferAttribute(new Float32Array(this.#vertexCapacity), 3),
      );
      this.#roadGeometry.setAttribute(
        'color',
        new BufferAttribute(new Float32Array(this.#vertexCapacity), 3),
      );
    }
    if (indices.length > this.#indexCapacity) {
      this.#indexCapacity = indices.length;
      this.#roadGeometry.setIndex(new BufferAttribute(new Uint32Array(this.#indexCapacity), 1));
    }
    upload(this.#roadGeometry.getAttribute('position') as BufferAttribute, vertices);
    upload(this.#roadGeometry.getAttribute('color') as BufferAttribute, colours);
    // ⚠️ `getIndex()` is `BufferAttribute | null`, and this cast rests on an
    // invariant that lives in another file: `terrain.ts` §`markSlotCount`
    // returns `floor(...) + 2`, so every corridor carries at least two mark
    // slots, so `indices.length` is at least 12 and the branch above has always
    // run by the time we get here. `terrain.test.ts` §"always has room for at
    // least one whole mark and one clipped one" is what pins it, because a
    // guard here would be a branch no test could take — the shape #242's own
    // review removed from `roadTint`.
    upload(this.#roadGeometry.getIndex() as BufferAttribute, indices);
    // Draw only the triangles this frame actually has, so a shorter corridor
    // does not draw stale ones left in the buffer from a longer one.
    this.#roadGeometry.setDrawRange(0, indices.length);
  }

  #updateMarkers(markers: readonly RiderMarker[]): void {
    for (const marker of this.#markers.values()) {
      marker.visible = false;
    }
    for (const wanted of markers) {
      const mesh = this.#markers.get(wanted.kind);
      if (mesh === undefined) {
        continue;
      }
      mesh.visible = true;
      mesh.position.set(wanted.x, wanted.y + MARKER_STYLE[wanted.kind].radius, wanted.z);
    }
  }

  #placeCamera(pose: CameraPose): void {
    this.#camera.position.set(
      pose.x - pose.headingX * CAMERA_BEHIND_METRES,
      pose.y + CAMERA_ABOVE_METRES,
      pose.z - pose.headingZ * CAMERA_BEHIND_METRES,
    );
    this.#camera.lookAt(
      new Vector3(
        pose.x + pose.headingX * CAMERA_TARGET_AHEAD_METRES,
        pose.y,
        pose.z + pose.headingZ * CAMERA_TARGET_AHEAD_METRES,
      ),
    );
  }

  /**
   * Applies the size and the quality level together.
   *
   * ⚠️ The render scale multiplies the **drawing buffer**, not the CSS size, so
   * a reduction makes the world softer without moving anything — the canvas
   * stays where it is and the HUD above it stays crisp, because the HUD is DOM
   * and is not scaled at all. That is the whole reason `quality.ts` reduces
   * resolution before frame rate.
   */
  #applySize(): void {
    if (this.#renderer === undefined) {
      return;
    }
    const devicePixels = typeof devicePixelRatio === 'number' ? devicePixelRatio : 1;
    this.#renderer.setPixelRatio(Math.max(0.1, devicePixels * this.#quality.renderScale));
    this.#renderer.setSize(this.#widthCssPixels, this.#heightCssPixels, false);
    this.#camera.aspect = this.#widthCssPixels / this.#heightCssPixels;
    this.#camera.updateProjectionMatrix();
  }
}

/**
 * Copies one of `terrain.ts`'s arrays into the buffer three already holds.
 *
 * `set` into the existing array rather than replacing it, because replacing it
 * is the per-frame allocation #240's NFR-3 forbids. `needsUpdate` is the half
 * that is easy to forget and impossible to see: without it the copy happens,
 * nothing is re-uploaded, and the road stays wherever it was on the frame the
 * buffer was created.
 */
function upload(attribute: BufferAttribute, values: Float32Array | Uint32Array): void {
  (attribute.array as Float32Array | Uint32Array).set(values);
  attribute.needsUpdate = true;
}

/** A different solid per kind — see {@link MARKER_STYLE}. */
function markerGeometry(kind: RiderMarker['kind']): BufferGeometry {
  const { radius } = MARKER_STYLE[kind];
  switch (kind) {
    case 'rider':
      return new SphereGeometry(radius, 12, 8);
    case 'bot':
      // A cone, which reads as an arrow at a glance and is not a ball.
      return new ConeGeometry(radius, radius * 2.2, 8);
    case 'ghost':
      // Faceted and angular, so it is not a smooth ball at any distance.
      return new OctahedronGeometry(radius, 0);
  }
}

function disposeMaterial(material: Material | Material[]): void {
  if (Array.isArray(material)) {
    for (const each of material) {
      each.dispose();
    }
    return;
  }
  material.dispose();
}

/** The renderer this app ships. @see GameRenderer */
export const threeGameRenderer: GameRenderer = {
  create(canvas, settings) {
    return new ThreeGameView(canvas, settings);
  },
};
