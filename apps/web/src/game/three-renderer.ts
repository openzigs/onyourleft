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
 * nothing here is: every road vertex comes from `terrain.ts`, which computes
 * them from the rider's own imported GPX, and the three markers are primitives
 * three.js generates from numbers.
 *
 * ⚠️ **This section used to go on to say "there is no texture, no model file
 * and no asset directory in this epic". A reviewer who remembers that sentence
 * is reading the old file.** #341 loads five, from the CC0 pack
 * [ADR 0022](../../../../docs/adr/0022-game-scenery-model-pack.md) names, and that ADR
 * exists because the sentence was #240's founding premise rather than an
 * incidental fact. What replaces it is narrower and stronger: every model is a
 * general-purpose CC0 asset, committed byte for byte from the archive its
 * author publishes, with its pack, its URL, its licence, the date its terms
 * were read and a SHA-256 in `ASSETS.toml` — ADR 0022 D-5 and D-6, and
 * `scenery-models.ts` is where the table lives.
 *
 * ## The world is three objects, and since #286 it has a sun
 *
 * #241 gives the scene a ground plane, a sky and exponential fog, all three
 * coloured from `world.ts`'s `WorldStyle` and therefore from the rider's own
 * route.
 *
 * ⚠️ **This section used to say "and still no illumination", and that no lamp
 * "is wanted". A reviewer who remembers that is reading the old file.** #286
 * added exactly two — an `AmbientLight` and a `DirectionalLight`, pointed by
 * {@link WorldLamps} from `world.ts`'s own `SunStyle` — because the
 * sentence it replaced was a **performance claim with no number behind it**:
 * *"no lighting means no light budget"*. ADR 0008 D-2's rendering gate was
 * waived rather than passed, so nothing had measured what a shading pass
 * costs, and nothing had measured what leaving it out cost either. What is
 * there now is a measurement, in `game.browser.spec.ts`, and a rung of
 * `QUALITY_LADDER` that takes the shading back off on a device that cannot
 * afford it.
 *
 * **What is lit, and what deliberately is not.** The scenery and the three
 * markers wear a `MeshLambertMaterial`, because a cone, a sphere, a box and an
 * octahedron all have a form for a light to find. The **ground** and the
 * **road** stay `MeshBasicMaterial`:
 *
 * - The ground is one horizontal quad, and `world.ts` solves the two
 *   intensities so that a horizontal surface receives **exactly** 1. Putting
 *   a lamp on it is therefore a provable no-op that costs a shading pass
 *   over the whole backdrop — the largest fill in the frame.
 * - The road is within a few degrees of horizontal everywhere a bicycle goes,
 *   and it carries **no normal attribute**: `terrain.ts` emits positions,
 *   colours and indices, and computing normals for a ribbon that is rebuilt
 *   every frame is the per-frame allocation #240's NFR-3 forbids. ⚠️ The cost
 *   is stated rather than hidden: a climb and a descent are told apart by
 *   #242's gradient tint and not by the light, and on a 15 % ramp the light
 *   the surface *would* have received differs from the light it is drawn with
 *   by about 8 %.
 *
 * `three-seam.test.ts` no longer greps for the absence of a lamp — it now
 * requires the file to name **exactly** these two illumination classes and no
 * third, which fails just as closed and says what was decided.
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
 * NFR-2 says is the budget that matters here. It is also still flat-shaded,
 * and since #286 that is a stated exception rather than the house rule: an
 * edge line that reads as an edge line costs a vertex rather than a lamp, and
 * the section above says what the road gives up by staying unlit.
 *
 * ## The scenery is instanced, and it is the first thing here that is culled
 *
 * #244 draws what `scatter.ts` placed. **One `InstancedMesh` per kind**, six of
 * them, built once and reused — five hundred trees is six draw calls rather
 * than five hundred, which is the budget #240's NFR-2 says actually matters.
 *
 * ⚠️ **Five of the six shapes are models since #341, and the sixth is not.**
 * {@link SCATTER_STYLE} still builds a primitive for every kind, because that
 * is what `post` is drawn with (ADR 0022 D-3), what a kind whose model failed
 * to load falls back to, and — through {@link sceneryFitMetres} — what decides
 * how big a model is allowed to be. What a model supplies is the **geometry**
 * and nothing else: the colour on the next line is this file's, not the pack's.
 * {@link loadSceneryModels} is the whole of the loading, and
 * `scenery-models.ts` is what a model is allowed to reach for.
 *
 * ⚠️ **And it is the first object in this file that three is allowed to cull.**
 * `frustumCulled = false` is right for the road and for the ground — one
 * ribbon and one backdrop, both always in front of the camera — and copying it
 * across to a belt that stands beside the road is the mistake #244's fifth
 * criterion exists to catch. {@link ScatterBelt} says what it does instead.
 *
 * ⚠️ **The belt's own cull is a cone rather than a box, and it was a box until
 * #269** — a reviewer who remembers a constant 42 m half-width here is reading
 * the old file. {@link lateralReachMetres} is the bound, the property it is
 * derived from, and what it still gets wrong.
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
  AmbientLight,
  Box3,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  DynamicDrawUsage,
  FogExp2,
  InstancedBufferAttribute,
  InstancedMesh,
  LoadingManager,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  OctahedronGeometry,
  PerspectiveCamera,
  PlaneGeometry,
  Quaternion,
  Scene,
  SphereGeometry,
  Vector3,
  WebGLRenderer,
  type Material,
  type Object3D,
} from 'three';
// ⚠️ **Both of these ship inside `three@0.185.1` itself** — MIT, zero runtime
// dependencies — reached through the package's own `./addons/*` export. ADR
// 0022 §Consequences turns on that: #341 adds no npm dependency, so `DEP001` is
// not engaged and the lockfile does not move. And the specifier still matches
// `three-seam.test.ts`'s `['"]three(?:\/[^'"]*)?['"]`, so a loader imported
// anywhere but here is a red test with no change to that rule.
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

import type { QualitySettings } from './quality';
import { SCENERY_MODEL_FILES, sceneryResourceUrl } from './scenery-models';
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
import type { SunStyle, WorldStyle } from './world';

/**
 * How far above the rider the chase camera sits, in metres.
 *
 * Its sibling {@link CAMERA_BEHIND_METRES} is in `port.ts` rather than here,
 * because `world.test.ts` needs it and must not import `three`; that is where
 * the rest of this note lives. ADR 0008 **D-5** fixes the camera, so the two
 * together are the whole of its configuration — there is no free-look, and
 * adding one is a change to that ADR.
 *
 * ⚠️ Exported since #269, with {@link CAMERA_TARGET_AHEAD_METRES} and
 * {@link CAMERA_FIELD_OF_VIEW_DEGREES}, because the scenery cull is now derived
 * from the camera's own geometry and `three-renderer.test.ts` re-derives the
 * frustum from these three numbers independently. A test that read the camera
 * back off this file's own `PerspectiveCamera` would be checking the code
 * against itself; a test that typed `3` would stop meaning anything the day
 * this moves.
 */
export const CAMERA_ABOVE_METRES = 3;

/** How far ahead of the rider the camera looks. */
export const CAMERA_TARGET_AHEAD_METRES = 25;

/**
 * The camera's **vertical** field of view, in degrees — three's own convention.
 *
 * The horizontal one is not a second number: three derives it per frame as
 * `atan(aspect · tan(fov / 2))`, so the width of what a rider can see is this
 * number and the shape of the canvas, and nothing else. {@link FRUSTUM_SPREAD}
 * is where that becomes the scenery cull's bound.
 */
export const CAMERA_FIELD_OF_VIEW_DEGREES = 60;

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
 * How far from the road's centreline `scatter.ts` can put anything: **39.5 m**.
 *
 * Derived from that file's own three numbers rather than restated here, so the
 * cull below cannot go on describing a band that has moved. ⚠️ **It was 21 m
 * until #348**, which pushed the verge back and deepened the band; the
 * derivation is what made that a one-line consequence here rather than a second
 * number to remember.
 */
const SCATTER_BAND_REACH_METRES =
  ROAD_WIDTH_METRES / 2 + SCATTER_VERGE_METRES + SCATTER_BAND_METRES;

/**
 * The widest the world canvas can be for its height: **6 : 1**.
 *
 * ⚠️ **Read out of `design/theme.css`, not chosen for roundness**, because
 * {@link FRUSTUM_SPREAD} is only ever as safe as this number is pessimistic.
 * `.oyl-game__world` is `aspect-ratio: 16 / 9` inside `.oyl-main`'s
 * `max-width: 68ch`, with `max-height: 60vh`. The aspect ratio therefore *is*
 * 16 : 9 — about 1.78 — until the `max-height` clamp bites, and past that point
 * it is `width / (0.6 · viewportHeight)`. Taking 68ch at the default 16 px root
 * as ≈ 544 px of border box and 512 px of content, that reaches:
 *
 * | aspect | viewport height it needs |
 * |---|--:|
 * | 16 : 9 | 512 CSS px and up |
 * | 3 : 1 | 285 CSS px |
 * | 4 : 1 | 213 CSS px |
 * | **6 : 1** | **142 CSS px** |
 *
 * A phone in landscape is 320–450 CSS px tall and a desktop window cannot
 * usefully be dragged under about 200, so 6 : 1 is past anything a rider can
 * produce — including the awkward case, which is a **text**-only zoom: that
 * widens 68ch without shortening the viewport, but only until the column stops
 * being the narrower of the two, and on a 844 × 390 landscape phone at 200 %
 * text the canvas is 812 × 234, which is 3.5 : 1. A whole-page zoom scales both
 * axes and moves the ratio not at all.
 *
 * **Being generous here is nearly free**, which is why it is 6 rather than the
 * 4 the measurements would also have supported: past about 95 m ahead the cone
 * is wider than {@link FOGGED_OUT_METRES} and the cap is what binds, so
 * widening this only affects the near field at all. The
 * measured cost of 6 over 4 is that a 150 m bend keeps 98.8 % of its scenery
 * instead of 95.0 % — and those extra items are ones that are *on screen* at
 * 6 : 1, so the wider bound is the more correct one rather than the more
 * wasteful one.
 */
export const WORST_CASE_ASPECT = 6;

/**
 * The tangent of the camera's horizontal half-angle, at {@link WORST_CASE_ASPECT}.
 *
 * three builds a perspective projection from a **vertical** field of view and
 * an aspect ratio, so the horizontal half-angle is `atan(aspect · tan(fov / 2))`
 * and this is its tangent: how many metres wider the visible cone gets per
 * metre of depth, on each side. 6 × tan 30° ≈ 3.464.
 */
export const FRUSTUM_SPREAD =
  WORST_CASE_ASPECT * Math.tan((CAMERA_FIELD_OF_VIEW_DEGREES / 2) * (Math.PI / 180));

/**
 * The depth past which everything is at least three-quarters fogged: **400 m**.
 *
 * ⚠️ **Derived from `world.ts`, not from the corridor it happens to equal.**
 * `MINIMUM_VIEW_END_OCCLUSION` is the *floor* on how much the fog has taken at
 * {@link VIEW_AHEAD_METRES} — 0.75, binding only on the thinnest air a route
 * can be ridden in — and `FogExp2`'s occlusion rises with depth at every
 * density. So nothing beyond this depth is less than 75 % faded into the
 * horizon, on any route, whatever the altitude. `three-renderer.test.ts`
 * §"rests the far cap on a premise `world.ts` still holds" asserts that floor
 * through the real `worldStyle` rather than trusting this paragraph, because
 * the day somebody lowers it this bound starts hiding scenery a rider could
 * still make out.
 *
 * It is what stops {@link lateralReachMetres} growing without limit: the cone
 * alone would permit an item 950 m to the side of a rider at the far end of the
 * corridor, which is on screen and invisible.
 */
export const FOGGED_OUT_METRES = VIEW_AHEAD_METRES;

/**
 * How far to the side of the *camera itself* a scatter item may stand: 79 m.
 *
 * ⚠️ **42 m until #348**, for the reason {@link SCATTER_BAND_REACH_METRES}
 * gives. Widening the floor can only make the cull keep *more*, so every
 * property below still holds; what it changed is the measurements, and those
 * were re-taken rather than left standing.
 *
 * ⚠️ **This is now the near-field floor of {@link lateralReachMetres} rather
 * than the whole bound, and that is the substance of #269.** Until then it was
 * a constant half-width applied at every distance, which is the one shape a
 * perspective camera never has: what a camera can see is a **cone** that widens
 * with depth, so past about 37 m ahead a 42 m box was *narrower than the
 * frustum* and a bend threw away scenery that was on screen and barely fogged
 * — 56.7 % kept on a 450 m corner, 41.3 % on a 200 m one, measured. The cone
 * term is what fixed that; this constant is what the cone is added to.
 *
 * **Derived, not chosen, and now for two reasons rather than one.** One
 * {@link SCATTER_BAND_REACH_METRES} is the scenery's own placement band, so
 * nothing `scatter.ts` can put beside the rider is ever culled from beside the
 * rider. The second one is the margin the two approximations in
 * {@link lateralReachMetres} need:
 *
 * - **The camera is pitched down** by `atan(3 / 33) ≈ 5.2°`, so an item's depth
 *   along the view axis is `0.996 · d − 0.090 · (itemHeight − cameraHeight)`
 *   rather than `d`. Ignoring that overstates depth for anything *below* the
 *   camera, and the margin covers it for a drop of `79 / (FRUSTUM_SPREAD ·
 *   0.090) ≈ 253 m` inside the 400 m view — a sustained 63 % descent, which no
 *   road is.
 * - **An instance is placed at a point and drawn with a size**: the tallest
 *   kind is about 7 m and the widest a little over 3 m across, so an item whose
 *   centre is just outside the cone can still have a branch inside it.
 */
export const SCATTER_LATERAL_METRES = 2 * SCATTER_BAND_REACH_METRES;

/**
 * How far to the side of the rider an item at `alongMetres` may stand and still
 * be drawn — the camera's cone, floored near it and capped far from it.
 *
 * ⚠️ **The property this is derived from, and the one thing it must never do:**
 * *no item that is inside the camera's frustum at {@link WORST_CASE_ASPECT},
 * and less than `MINIMUM_VIEW_END_OCCLUSION` fogged at its depth, is
 * culled.* A cull that drops something on screen is a visible defect; one that
 * keeps something off screen costs a handful of instances in a buffer that was
 * allocated anyway. Every approximation below therefore errs **wide**.
 *
 * Three terms, each with its own derivation on its own constant:
 *
 * 1. {@link SCATTER_LATERAL_METRES}, the floor — the placement band, plus the
 *    margin the pitch and the items' own size need.
 * 2. {@link FRUSTUM_SPREAD} × how far the item is ahead of **the camera**,
 *    which sits {@link CAMERA_BEHIND_METRES} behind the rider. Clamped at zero
 *    rather than allowed to go negative: behind the camera the cone has no
 *    width, and the floor is what keeps the near band whole there.
 * 3. {@link FOGGED_OUT_METRES}, the cap.
 *
 * ⚠️ **What this gets wrong, measured the same way the box was, and
 * re-measured for #348** — a reviewer who remembers 98.3 / 98.8 / 99.2 / 79.6
 * here is reading the old file. Driving the real `sceneFrame` through the real
 * belt on constant-radius routes — worst frame of a 1.5 km sweep — it submits
 * **100 %** on a straight route, **98.7 %** at R = 450 m, **98.7 %** at
 * R = 200 m, **98.3 %** at R = 150 m and **43.9 %** at R = 100 m. On the same
 * sweep the box kept 98.3 %, 56.7 % and 41.3 % of the first three.
 *
 * ⚠️ **The share dropped at R = 100 m roughly doubled, and that is the wider
 * band rather than a worse cull.** #348 took the placement band from 21 m to
 * 39.5 m from the centreline, and on a hairpin the far half of that band folds
 * behind the rider. **None of it is inside the frustum**: that is asserted over
 * every item of every frame at ten radii rather than argued for, in
 * `three-renderer.test.ts` §"never drops an item that is on screen and not yet
 * fogged out".
 *
 * What it still gets wrong is the aspect ratio, and it is a cliff rather than a
 * slope: at 8 : 1 — a viewport about 107 CSS px tall, which nothing produces —
 * a 100 m hairpin starts culling items that are on screen and only 59 % faded
 * into the horizon. ⚠️ **That figure was measured at the 42 m floor and has not
 * been re-taken**, because the probe that would take it hard-codes
 * {@link WORST_CASE_ASPECT}; the floor has since nearly doubled, so the cliff
 * is further out than 8 : 1 rather than nearer, and the number quoted is
 * pessimistic rather than wrong in the direction that matters. Past that point
 * the constant is simply the wrong instrument, and the fix would be to pass the
 * camera's live aspect in rather than to widen it again.
 */
export function lateralReachMetres(alongMetres: number): number {
  const aheadOfCamera = Math.max(0, alongMetres + CAMERA_BEHIND_METRES);
  return Math.min(SCATTER_LATERAL_METRES + FRUSTUM_SPREAD * aheadOfCamera, FOGGED_OUT_METRES);
}

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
 * three's own geometry classes out of numbers typed here, and none of it was
 * derived from another product, including "for reference". The dimensions are
 * ordinary roadside sizes — a conifer about 7 m tall, a marker post a little
 * over a metre, a building a few metres on a side — and the colours are plain
 * vegetation, stone and paint. `scatter.ts` §"Provenance" makes the same
 * declaration for the placement.
 *
 * ⚠️ **Since #341 the `geometry` half of five of these entries is a fallback
 * and a ruler rather than what a rider sees.** A model from ADR 0022's pack is
 * drawn instead where one loaded, and this table is then read for two things:
 * the **colour**, which stays this repository's own because #341 buys geometry
 * and nothing else, and the **size** — {@link sceneryFitMetres} makes a model
 * occupy the same space the solid did, so the world's scale is unchanged. The
 * primitive is still what `post` is drawn with and what a kind whose model
 * failed to load falls back to.
 *
 * The geometry is translated so that its **base sits at y = 0**, because a
 * {@link ScatterItem}'s `y` is the ground under it: three centres every
 * primitive on its own origin, so a cone left alone is half buried.
 * {@link prepareSceneryGeometry} puts a model on the same footing.
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
 * How much room a kind's shape may take up, in metres: the primitive's own.
 *
 * ⚠️ **Derived from {@link SCATTER_STYLE} rather than a table of sizes typed
 * beside it, and that is what makes #341's *"only the mesh changes"* claim
 * mechanical.** A pack's models are authored in kit tiles, not metres — a
 * Kenney tree is 1.71 units tall — so something has to say how big one is, and
 * anything written down twice is something that can disagree. This reads the
 * solid the kind used to be drawn as and returns its **largest** extent.
 *
 * Largest rather than height, because height alone is right for a tree and
 * badly wrong for a boulder: the stone model is 0.26 units tall and 1.02
 * across, so matching its height to the octahedron's 1.4 m would have made it
 * 5.5 m wide. Matching the largest extent makes the model occupy the box the
 * solid occupied, whichever way round it is.
 */
export function sceneryFitMetres(kind: ScatterKind): number {
  const solid = SCATTER_STYLE[kind].geometry();
  solid.computeBoundingBox();
  const size = solid.boundingBox?.getSize(new Vector3()) ?? new Vector3(1, 1, 1);
  solid.dispose();
  return Math.max(size.x, size.y, size.z);
}

/**
 * One loaded model, as the single geometry the belt instances — #341.
 *
 * ## What is taken from the file, and what is dropped on the floor
 *
 * **Taken:** positions and normals, in world space, from every mesh in the
 * file. **Dropped:** the materials, the texture coordinates and the tangents.
 *
 * ⚠️ Dropping the materials is not a simplification, it is the requirement.
 * #341 replaces *"the **geometry** and nothing else"*, so every kind keeps the
 * colour {@link SCATTER_STYLE} gives it — which is what keeps
 * {@link LIT_COLOURS} a complete statement of the scene's palette, and what
 * stops a pack's house style deciding what this world looks like. ADR 0022 D-7
 * is the other half: a `MeshStandardMaterial` a loader built from a binary
 * appears in no source file, so `three-seam.test.ts` could not see one, and it
 * would change how the whole scene is shaded. Nothing survives to be seen.
 *
 * The cost is stated rather than discovered: a Kenney tree is authored with a
 * separate trunk material, and one colour per kind spends that — the trunk is
 * drawn in the canopy's green. It buys the silhouette, which is what #302
 * asked for.
 *
 * ## One geometry, because one draw call
 *
 * A model is a small scene: a tree is one mesh of two primitives, because its
 * trunk and its canopy were different materials. Instancing **each part** would
 * multiply draw calls by the number of parts, and drawing each *item* as a
 * loaded scene would multiply them by the item count — #240's NFR-2 is the
 * budget that actually matters here, and it is the one thing a model is most
 * likely to spend without anybody noticing. So the parts are merged, once, at
 * load, into a single indexed geometry.
 *
 * ## And then it is made to fit
 *
 * Scaled so its largest extent is {@link sceneryFitMetres}, centred on x and z,
 * and translated so its **base sits at y = 0** — a {@link ScatterItem}'s `y` is
 * the ground under it, so a model left on its own origin is half buried exactly
 * as a cone would be. The order matters: the box is recomputed after the scale,
 * because scaling a geometry does not move the box it already cached.
 */
export function prepareSceneryGeometry(source: Object3D, kind: ScatterKind): BufferGeometry {
  source.updateWorldMatrix(false, true);
  const parts: BufferGeometry[] = [];
  source.traverse((node) => {
    const mesh = node as Partial<Mesh>;
    if (mesh.isMesh !== true || mesh.geometry === undefined) {
      return;
    }
    const part = mesh.geometry.clone().applyMatrix4(node.matrixWorld);
    // Everything but position and normal, gone before the merge rather than
    // after it: `mergeGeometries` refuses a set of parts whose attributes
    // disagree, and a UV kept for a texture that is never loaded is a third of
    // a vertex buffer uploaded to a phone for nothing.
    for (const name of Object.keys(part.attributes)) {
      if (name !== 'position' && name !== 'normal') {
        part.deleteAttribute(name);
      }
    }
    if (part.getAttribute('normal') === undefined) {
      part.computeVertexNormals();
    }
    parts.push(part);
  });
  if (parts.length === 0) {
    throw new Error(`${kind}: the model holds no mesh`);
  }
  // `mergeGeometries` needs every part to agree about being indexed, and a
  // file is free to mix the two. Levelling down rather than up: generating an
  // index is a de-duplication pass over a vertex buffer, and this runs on a
  // phone.
  const indexed = parts.every((part) => part.index !== null);
  const ready = indexed
    ? parts
    : parts.map((part) => (part.index === null ? part : part.toNonIndexed()));
  const merged = parts.length === 1 ? (ready[0] ?? null) : mergeGeometries(ready);
  if (merged === null) {
    throw new Error(`${kind}: the model's parts could not be merged into one geometry`);
  }
  for (const part of new Set([...parts, ...ready])) {
    if (part !== merged) {
      part.dispose();
    }
  }

  // One helper rather than the same guard written three times: `boundingBox`
  // is nullable because a geometry may have no positions, and the box has to be
  // read twice — before the scale to size it, and after, because scaling a
  // geometry does not move the box it already cached.
  const boundsOf = (geometry: BufferGeometry): Box3 => {
    geometry.computeBoundingBox();
    const box = geometry.boundingBox;
    if (box === null) {
      throw new Error(`${kind}: the model has no extent`);
    }
    return box;
  };

  const size = boundsOf(merged).getSize(new Vector3());
  const largest = Math.max(size.x, size.y, size.z);
  if (!(largest > 0)) {
    throw new Error(`${kind}: the model has no extent`);
  }
  const factor = sceneryFitMetres(kind) / largest;
  merged.scale(factor, factor, factor);
  const fitted = boundsOf(merged);
  const centre = fitted.getCenter(new Vector3());
  merged.translate(-centre.x, -fitted.min.y, -centre.z);
  return merged;
}

/**
 * The shapes the belt draws, or an empty map before anything has been loaded.
 *
 * ⚠️ **Module state, because what has to outlive a view is not the view's.**
 * `GameRenderer.create` is synchronous — `port.ts` fixes that, and a renderer
 * that could not be built without awaiting something would push a `Promise`
 * into every caller of it — while reading a file is not. So the loading is a
 * separate step the caller runs once, before it creates anything, and what it
 * produces is held here. The same shape `segments/sweep.ts` uses, for the same
 * reason.
 *
 * ⚠️ **This is the write half of this program's named defect shape**, one layer
 * below a store: a `loadSceneryModels` that resolved without filling this, or a
 * belt built before it resolved, is a world of primitives that every gate here
 * calls a success. So the read is asserted through the belt a real view builds
 * — `three-renderer.test.ts` §"the shapes the models bring" — and the browser
 * gate counts the vertices that actually reached a driver.
 */
let sceneryGeometries: ReadonlyMap<ScatterKind, BufferGeometry> = new Map();

/** Reads one model's scene out of its file. Replaced in tests; @see loadSceneryModels. */
async function readModelScene(url: string): Promise<Object3D> {
  // ⚠️ The manager is what makes `sceneryResourceUrl` binding rather than
  // advisory: `GLTFLoader` resolves every external URI a file declares through
  // it, so this is the one place a model could reach the network and the one
  // place that is refused. `scenery-models.ts` says what it answers with.
  const manager = new LoadingManager();
  manager.setURLModifier(sceneryResourceUrl);
  return (await new GLTFLoader(manager).loadAsync(url)).scene;
}

/**
 * Loads the scenery models. Called once, before the first view is created.
 *
 * ⚠️ **A kind whose model cannot be read keeps its primitive, and says nothing
 * about it.** That is a deliberate trade and it is the risky half of this
 * change: a rider mid-ride should lose a tree's shape rather than the ride, and
 * #240's FR-5 already says the same about losing the GL context entirely. What
 * it costs is that a model this repository stopped shipping would look exactly
 * like the world did before #341 — so the gate that says every one of them
 * actually loaded is `game.browser.spec.ts`, where a real engine fetches real
 * bytes, and not anything in the fast suite.
 *
 * `load` is a seam and not a convenience: jsdom can neither construct a GL
 * context nor serve a file, so the only way to assert what this does with a
 * scene is to hand it one.
 */
export async function loadSceneryModels(
  load: (url: string) => Promise<Object3D> = readModelScene,
): Promise<void> {
  const loaded = new Map<ScatterKind, BufferGeometry>();
  await Promise.all(
    SCATTER_KINDS.map(async (kind) => {
      const url = SCENERY_MODEL_FILES[kind];
      if (url === undefined) {
        return;
      }
      try {
        loaded.set(kind, prepareSceneryGeometry(await load(url), kind));
      } catch {
        // Keep the primitive. @see the note above.
      }
    }),
  );
  for (const geometry of sceneryGeometries.values()) {
    geometry.dispose();
  }
  sceneryGeometries = loaded;
}

/**
 * Every colour in this file that a lit material carries — #286.
 *
 * ⚠️ **Derived from the two style tables rather than written out**, so a
 * scenery kind or a marker added without a thought for the light budget lands
 * in it automatically. `three-renderer.test.ts` §"lights no colour past white"
 * multiplies each through `world.ts`'s {@link PEAK_IRRADIANCE} in the linear
 * space the shader works in and requires the result to stay under white. That
 * is the check that keeps `SUN_ELEVATION_AT_POLE_DEGREES` honest, and the two
 * halves of it are deliberately in different files: the elevation band cannot
 * see a colour, and this file must never see a sun constant.
 *
 * @unwired a bound `three-renderer.test.ts` asserts against; nothing in the
 * client reads it, because every material already holds its own colour.
 */
export const LIT_COLOURS: readonly number[] = [
  ...SCATTER_KINDS.map((kind) => SCATTER_STYLE[kind].colour),
  ...(['rider', 'bot', 'ghost'] as const).map((kind) => MARKER_STYLE[kind].colour),
];

/**
 * What one normalised unit of `world.ts`'s light is, in three's own units: π.
 *
 * ⚠️ **Read out of three's shader, not chosen.** `BRDF_Lambert` in
 * `common.glsl.js` is `RECIPROCAL_PI * diffuseColor`, and both the ambient
 * irradiance in `lights_pars_begin.glsl.js` and `RE_Direct_Lambert` in
 * `lights_lambert_pars_fragment.glsl.js` feed their irradiance straight into
 * it — so a lamp of intensity `i` lands on a square-on surface as `i / π` of
 * its colour. `world.ts` states its two intensities as shares of what a
 * horizontal surface receives and knows nothing about that, which is the whole
 * point of the seam; this is the one line that converts.
 *
 * ⚠️ It is **version-specific**, and three moved it once already: before r155
 * the ambient path multiplied by π in the shader and this factor would have
 * been 1 for one of the two lamps and not the other. `three` is pinned at
 * 0.185.1 (CLAUDE.md §4b) and the browser gate reads the result back off a
 * real drawing buffer, which is what would catch a bump that moved it again.
 */
const LAMBERT_IRRADIANCE_SCALE = Math.PI;

/** A material and its unlit twin, built once. @see QualitySettings.shading */
interface ShadedMaterials {
  readonly lit: MeshLambertMaterial;
  readonly flat: MeshBasicMaterial;
}

/**
 * One colour, as the two materials a quality rung chooses between.
 *
 * ⚠️ **Both are built up front and neither is ever replaced**, which is what
 * makes {@link QualitySettings.shading} free to change mid-ride: swapping
 * `mesh.material` costs a program compile the first time each is drawn and
 * nothing thereafter, where building a material on the way down the ladder
 * would allocate on the frame a phone is already struggling with. #240's
 * NFR-3, applied to the one path that only runs on a hot device.
 */
function shadedMaterials(colour: number): ShadedMaterials {
  return {
    lit: new MeshLambertMaterial({ color: colour }),
    flat: new MeshBasicMaterial({ color: colour }),
  };
}

/**
 * The world's one light direction, as the two lamps that carry it — #286.
 *
 * ## Why two lamps and not one
 *
 * A single directional light leaves every face turned away from the sun at
 * black, which reads as silhouettes rather than as objects — and on a phone in
 * sunlight a black tree against a dark verge is less legible than the flat
 * scene it replaced. The ambient is the shaded side's whole illumination, and
 * `world.ts`'s {@link SunStyle.ambient} is the number that says how much.
 *
 * ## Why it is a class, and why it is exported
 *
 * The same two reasons {@link ScatterBelt} is: `three-renderer.ts` is the one
 * file allowed to name `three`, so a lamp in a file of its own is not
 * available; and something reachable only through {@link ThreeGameView} cannot
 * be driven at all in jsdom, where a `WebGLRenderer` cannot be constructed.
 * Everything below is arithmetic over two objects that need no GL context.
 *
 * ⚠️ **The conversion into three's units is the whole of what this adds**, and
 * it is the one thing a jsdom test can get wrong in a way a rider would see.
 * @see LAMBERT_IRRADIANCE_SCALE
 */
export class WorldLamps {
  readonly #ambient = new AmbientLight(0xffffff, 0);
  readonly #sun = new DirectionalLight(0xffffff, 0);

  /**
   * The two lamps, ambient first.
   *
   * Exposed as a plain array so `three-renderer.test.ts` can state what is in
   * the scene without naming a `three` type — it reads `type` and `intensity`,
   * which are structural.
   */
  get lamps(): readonly [AmbientLight, DirectionalLight] {
    return [this.#ambient, this.#sun];
  }

  /** Puts both lamps in a scene. Called once, by the view that owns them. */
  addTo(scene: Scene): void {
    scene.add(this.#ambient);
    // ⚠️ A `DirectionalLight`'s direction is `position − target`, and its
    // `target` is an `Object3D` that is **not** in the scene by default. It is
    // added here so that its world matrix is updated with everything else's;
    // three leaves it at the origin, which is what `apply` writes against.
    scene.add(this.#sun);
    scene.add(this.#sun.target);
  }

  /**
   * Points the lamps where the route's own sun is, at its own two intensities.
   *
   * ⚠️ **`position` and not a direction vector.** three has no setter for a
   * directional light's direction: the shader takes `position − target`,
   * normalised, so a unit vector written into `position` with the target left
   * at the origin *is* the direction. The distance is irrelevant — nothing
   * here casts a shadow, so there is no shadow camera to frame — which is why
   * the unit vector is written straight in rather than scaled out to some
   * arbitrary radius.
   */
  apply(sun: SunStyle): void {
    this.#ambient.intensity = sun.ambient * LAMBERT_IRRADIANCE_SCALE;
    this.#sun.intensity = sun.direct * LAMBERT_IRRADIANCE_SCALE;
    this.#sun.position.set(sun.x, sun.y, sun.z);
  }

  /** Releases both lamps. Neither owns a GPU resource; three asks for this anyway. */
  dispose(): void {
    this.#ambient.dispose();
    this.#sun.dispose();
  }
}

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
  /**
   * Each kind's lit material and its unlit twin, built once — #286.
   *
   * ⚠️ **Both, from the constructor, for the reason every other buffer here is
   * allocated up front:** the rung that turns the shading off is reached only
   * on a device that is already too hot, and building a material there is an
   * allocation on the worst frame of the ride. @see shadedMaterials
   */
  readonly #materials = new Map<ScatterKind, ShadedMaterials>();
  /** Survivors of the cull, per kind, for the frame being built. */
  readonly #counts = new Map<ScatterKind, number>();
  /** Reused every instance of every frame — see the header's first point. */
  readonly #matrix = new Matrix4();
  readonly #position = new Vector3();
  readonly #quaternion = new Quaternion();
  readonly #scale = new Vector3();
  readonly #up = new Vector3(0, 1, 0);
  /**
   * The most instances one frame may submit, from the quality rung — #245.
   *
   * ⚠️ **Unbounded until a rung says otherwise, and that is not laziness.** A
   * belt is a mechanism and a rung is a policy; `ThreeGameView`'s constructor
   * calls {@link ThreeGameView.setQuality} before it draws anything, so nothing
   * in the shipped client is ever unbudgeted. What the default protects is the
   * *other* caller — the one that exceeds {@link SCATTER_INSTANCE_CAPACITY} and
   * is grown for rather than truncated, because scenery a caller placed and the
   * screen never showed is #240's named defect shape for this epic. Defaulting
   * this to `SCATTER_MAX_ITEMS` would silently convert that decision into a
   * truncation.
   */
  #budget = Number.POSITIVE_INFINITY;

  /**
   * @param models the shapes to draw, by kind. Defaults to whatever
   * {@link loadSceneryModels} has loaded, which is what the shipped client
   * gets; a kind with no entry is drawn as {@link SCATTER_STYLE}'s primitive,
   * which is `post` always and any other kind whose file could not be read.
   */
  constructor(models: ReadonlyMap<ScatterKind, BufferGeometry> = sceneryGeometries) {
    for (const kind of SCATTER_KINDS) {
      const materials = shadedMaterials(SCATTER_STYLE[kind].colour);
      this.#materials.set(kind, materials);
      const model = models.get(kind);
      const mesh = new InstancedMesh(
        // ⚠️ **A copy of the model, not the model.** {@link dispose} releases
        // every geometry the belt is wearing, and the loaded ones are shared
        // by every belt this tab ever builds — a view that released them on
        // teardown would leave the next ride's world made of primitives, with
        // nothing to say why. A copy costs about 30 kB for the largest kind,
        // once per view.
        model === undefined ? SCATTER_STYLE[kind].geometry() : model.clone(),
        // ⚠️ **Lit since #286, and this is the file's biggest change of mind.**
        // It used to say *"no lighting means no light budget"* here, which was
        // a performance claim with no measurement behind it — #286's own
        // framing. It is a `MeshLambertMaterial` now, so a conifer has a
        // sunward face and a shaded one; the `flat` twin beside it is exactly
        // the material that used to be here, and the bottom rung of
        // `QUALITY_LADDER` puts it back. The cost is measured in
        // `game.browser.spec.ts` rather than argued about here.
        materials.lit,
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

  /**
   * Shades the belt, or stops shading it — #286.
   *
   * Swaps a material that already exists; allocates nothing, touches no
   * geometry and no matrix. @see QualitySettings.shading
   */
  setShading(shading: QualitySettings['shading']): void {
    for (const [kind, mesh] of this.#meshes) {
      const materials = this.#materials.get(kind);
      if (materials !== undefined) {
        mesh.material = materials[shading];
      }
    }
  }

  /**
   * How much of the belt this rung is willing to draw — #245.
   *
   * ⚠️ **Applies a budget; never decides one.** The figure is
   * `QualitySettings.scatterItems` and the reasoning for it is beside
   * `QUALITY_LADDER`, where a reviewer can read it without a GL context.
   * Nothing here ranks, sorts or weighs an item — {@link ScatterBelt.update}
   * takes the frame's own order and stops — because a scenery decision taken in
   * the render loop is one that runs for the first time on a rider's phone at
   * minute fifty, which is the whole reason `quality.ts` is a pure function in
   * a file of its own.
   *
   * ⚠️ **In the shipped client this binds on almost no frame, and it is still
   * the half that makes the rung real.** `scene.ts` asks `scatter.ts` for the
   * same number, so a frame arrives already thinned — by a *distance-biased*
   * thinning this method deliberately does not reimplement. What is left for
   * this to catch is the frame built at the rung before last, and the caller
   * that did not ask: `update`'s own note says a renderer is handed a
   * `SceneFrame` and does not know who built it, and that is as true of the
   * budget as it is of the cull.
   *
   * ⚠️ **What no gate here can see, measured rather than assumed.** Deleting
   * the `setBudget` call in {@link ThreeGameView.setQuality} leaves the whole
   * suite green, and that is a property of the two applications rather than of
   * the tests: `scene.ts` has already thinned the frame to this same figure, so
   * an unbudgeted belt submits exactly what a budgeted one would and the
   * shipped client is unchanged. jsdom cannot construct a `ThreeGameView` with
   * a context, so there is nowhere to observe the line at all —
   * `#applyShading`'s call has had the same hole since #286. What the tests do
   * prove is that a belt *spends* a budget; what nothing proves is the line
   * that hands it one.
   *
   * Allocates nothing, and cannot: it only ever lowers a count.
   */
  setBudget(items: number): void {
    this.#budget = items;
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
   * ⚠️ **The frame is the rider's, not the camera's**, and since #269 the two
   * bounds use it differently on purpose. {@link VIEW_AHEAD_METRES} and
   * {@link VIEW_BEHIND_METRES} are the corridor's own bounds, the corridor is
   * built around the rider's odometer, and measuring *those* from anywhere else
   * would cull scenery the road under it is still being drawn for — which is
   * mutation M17 in #268 and is a red test. The lateral bound is a cone, and a
   * cone has an apex: {@link lateralReachMetres} therefore adds
   * {@link CAMERA_BEHIND_METRES} back on, because the eye it is describing is
   * that far behind the rider. Neither is the other's convention borrowed.
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
   *
   * ⚠️ **The two passes carry identical guards, in the same order, and that is
   * load-bearing since #245.** The first counts what will be submitted so that
   * {@link reserve} sizes for it; the second writes it. A budget that stopped
   * the second pass earlier than the first would reserve room for instances
   * that are never written and leave `mesh.count` disagreeing with the matrices
   * behind it, which is this program's named defect shape — a write that
   * reports success where the read cannot see it — one layer below a frame.
   * That is why the counting pass looks up a mesh it does not otherwise need:
   * a guard the two passes do not share is a guard that can disagree.
   */
  update(items: readonly ScatterItem[], pose: CameraPose): void {
    for (const kind of SCATTER_KINDS) {
      this.#counts.set(kind, 0);
    }
    let admitted = 0;
    for (const item of items) {
      const mesh = this.#meshes.get(item.kind);
      if (mesh === undefined || !this.#inView(item, pose)) {
        continue;
      }
      if (admitted >= this.#budget) {
        break;
      }
      admitted += 1;
      this.#counts.set(item.kind, (this.#counts.get(item.kind) ?? 0) + 1);
    }
    for (const [kind, mesh] of this.#meshes) {
      reserve(mesh, this.#counts.get(kind) ?? 0);
      // Rewound here rather than tracked in a second map: the next loop uses
      // `mesh.count` as its write cursor and this is where it starts.
      mesh.count = 0;
    }
    admitted = 0;
    for (const item of items) {
      const mesh = this.#meshes.get(item.kind);
      if (mesh === undefined || !this.#inView(item, pose)) {
        continue;
      }
      if (admitted >= this.#budget) {
        break;
      }
      admitted += 1;
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
      mesh.dispose();
    }
    // ⚠️ **Both materials, not `mesh.material`** — since #286 each kind holds
    // a lit one and an unlit one and only one of them is mounted, so disposing
    // what the mesh happens to be wearing leaks the other's program for the
    // life of the context. The belt owns the pair, so the belt releases it.
    for (const materials of this.#materials.values()) {
      materials.lit.dispose();
      materials.flat.dispose();
    }
  }

  /**
   * Whether an item is inside what the rider can see.
   *
   * `along` is the item's distance up the rider's heading and `across` is its
   * distance to the side of it — the two components of the same offset in the
   * rider's own frame, which is the frame {@link VIEW_AHEAD_METRES} and
   * {@link lateralReachMetres} are both stated in.
   *
   * ⚠️ **Two bounds of different shapes, and they are not interchangeable.**
   * Along the road it is a pair of constants, because the corridor itself is
   * built between them and nothing outside them is drawn at all. To the side it
   * is a **cone**, because that is what a perspective camera can see — #269,
   * and {@link lateralReachMetres} carries the derivation and the measurement.
   */
  #inView(item: ScatterItem, pose: CameraPose): boolean {
    const dx = item.x - pose.x;
    const dz = item.z - pose.z;
    const along = dx * pose.headingX + dz * pose.headingZ;
    if (along > VIEW_AHEAD_METRES || along < -VIEW_BEHIND_METRES) {
      return false;
    }
    const across = dx * pose.headingZ - dz * pose.headingX;
    return Math.abs(across) <= lateralReachMetres(along);
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
  readonly #camera = new PerspectiveCamera(CAMERA_FIELD_OF_VIEW_DEGREES, 1, 0.5, 2_000);
  readonly #roadGeometry = new BufferGeometry();
  readonly #road: Mesh;
  readonly #markers = new Map<RiderMarker['kind'], Mesh>();
  /** Each marker's lit material and its unlit twin — #286. @see shadedMaterials */
  readonly #markerMaterials = new Map<RiderMarker['kind'], ShadedMaterials>();
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
  /**
   * The sun and the sky it is in — #286. Two lamps, built once and pointed
   * every frame by `#updateWorld`, exactly as the fog is coloured every frame.
   */
  readonly #lighting = new WorldLamps();
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
      const materials = shadedMaterials(MARKER_STYLE[kind].colour);
      this.#markerMaterials.set(kind, materials);
      // Lit since #286, like the scenery and for the same reason: a sphere, a
      // cone and an octahedron all have a form, and an unlit one is a flat
      // disc of colour at any distance. @see shadedMaterials
      const marker = new Mesh(markerGeometry(kind), materials.lit);
      marker.frustumCulled = false;
      marker.visible = false;
      this.#markers.set(kind, marker);
      this.#scene.add(marker);
    }

    this.#lighting.addTo(this.#scene);

    // ⚠️ **No longer inside a `renderer !== undefined` guard, since #286.**
    // The guard was redundant before — `#applySize` returns early without a
    // renderer — and it stopped being harmless when `setQuality` also became
    // the one place the shading is chosen: a view constructed at a rung whose
    // shading is `'flat'` would have been built wearing the lit material and
    // never told otherwise. Nothing creates one at that rung today (`GameView`
    // starts at `INITIAL_QUALITY`), which is exactly why it is worth closing
    // rather than leaving for the first caller who does.
    this.setQuality(settings);
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
    this.#applyShading();
    // #245. Applied here rather than read in `render`, so that the rung is a
    // property of the belt between frames and the render loop takes no scenery
    // decision at all. @see ScatterBelt.setBudget
    this.#scatter.setBudget(settings.scatterItems);
    this.#applySize();
  }

  /**
   * Mounts the lit or the unlit material on everything that has both — #286.
   *
   * Nothing is created here: both materials of every pair were built in the
   * constructor, and this chooses between them. @see QualitySettings.shading
   */
  #applyShading(): void {
    const { shading } = this.#quality;
    this.#scatter.setShading(shading);
    for (const [kind, marker] of this.#markers) {
      const materials = this.#markerMaterials.get(kind);
      if (materials !== undefined) {
        marker.material = materials[shading];
      }
    }
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
    this.#lighting.dispose();
    for (const marker of this.#markers.values()) {
      marker.geometry.dispose();
    }
    // Both of each pair, for the reason `ScatterBelt.dispose` gives: only one
    // of the two is mounted, and `marker.material` would leak the other.
    for (const materials of this.#markerMaterials.values()) {
      materials.lit.dispose();
      materials.flat.dispose();
    }
    this.#markers.clear();
    this.#markerMaterials.clear();
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
    // ⚠️ Every frame, like the fog and for the same reason: the world is a
    // function of the route and a renderer is handed a frame, not a route. A
    // sun pointed once in the constructor would be the previous route's sun
    // for the whole of the next ride.
    this.#lighting.apply(world.sun);
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
