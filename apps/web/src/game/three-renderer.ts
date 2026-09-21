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
  Group,
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
  TorusGeometry,
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

import {
  BICYCLE_COLOURS,
  CRANK_AXIS_Y,
  CRANK_AXIS_Z,
  LEG_BONE_COUNT,
  LIMB_RADIUS_METRES,
  RIDER_BODY_PARTS,
  RIDER_CRANK_PARTS,
  RIDER_PALETTE,
  legBones,
  type RiderPart,
} from './bicycle';
import type { QualitySettings } from './quality';
import {
  MAXIMUM_SCENERY_VARIANTS,
  SCENERY_MODELS,
  sceneryResourceUrl,
  type SceneryModel,
} from './scenery-models';
import { atlasColourAt, tonedForTheSun, type AtlasImage, type LinearRgb } from './scenery-palette';
import type { CameraPose, GameRenderer, GameView, RiderMarker, SceneFrame } from './port';
import {
  SCATTER_BAND_METRES,
  SCATTER_KINDS,
  SCATTER_MAX_ITEMS,
  SCATTER_VERGE_METRES,
  type ScatterItem,
  type ScatterKind,
} from './scatter';
import {
  CAMERA_BEHIND_METRES,
  CAMERA_FIELD_OF_VIEW_DEGREES,
  FRUSTUM_SPREAD,
  cameraRig,
  verticalFieldOfViewDegrees,
} from './camera';
import { ROAD_WIDTH_METRES, VIEW_AHEAD_METRES, VIEW_BEHIND_METRES } from './terrain';
import type { SunStyle, WorldStyle } from './world';

/*
 * ⚠️ **The camera's four numbers lived here until #424 and do not any more** —
 * `CAMERA_ABOVE_METRES`, `CAMERA_TARGET_AHEAD_METRES` and
 * `CAMERA_FIELD_OF_VIEW_DEGREES`, with `CAMERA_BEHIND_METRES` beside them in
 * `port.ts`. A reviewer who remembers them exported from this file is reading
 * the old one. They are one composition and `camera.ts` holds all four, with
 * the law that ties them together and the two aspect bounds that used to sit
 * further down this file. This file is still the only one that names `three`;
 * what moved is arithmetic that never needed to.
 */

/**
 * What tells the three riders apart — #368.
 *
 * ⚠️ **All three are bicycles now, and a reviewer who remembers this table
 * carrying a `radius` and a solid apiece is reading the old file.** #349 gave
 * the rider a bicycle and left the bot a cone and the ghost an octahedron, on
 * the ground that *"three silhouettes beat three bicycles in three colours"* for
 * #93's third criterion. #368 reverses that half: the owner's judgement on
 * 2026-09-18 is that the trade came out wrong, because *a solid is not
 * something you race*. `bicycle.ts` carries the replaced note.
 *
 * ## What is left to tell them apart, since the shape no longer does
 *
 * A **multiplier** on the rider's own four colours, applied per instance. The
 * bot's orange and the ghost's grey are the hues #93 already settled on and
 * they are unchanged; what changed is that they now tint a whole bicycle
 * instead of filling a solid, so the bot reads as an orange machine and the
 * ghost as a colourless one against the rider's blue-and-silver.
 *
 * ⚠️ **The rider's entry is white, which is no tint at all**, and that is what
 * keeps `bicycle.ts`'s palette the literal thing a rider sees. It is written
 * down rather than special-cased so that {@link RiderBelt} has one code path
 * for three riders.
 *
 * ⚠️ **A tint rather than a second geometry, because a geometry is a draw
 * call.** The rider's colours are baked into its vertices, so three bicycles in
 * three palettes would be three geometries, three materials and nine draw
 * calls. Multiplying per instance keeps all three riders inside **one**
 * `InstancedMesh` per moving part — three calls for the lot, which is fewer
 * than the five #349 left behind. `game.browser.spec.ts` measures it.
 *
 * ⚠️ **Translucency was considered for the ghost and rejected**, which #368
 * raises directly: a transparent mesh needs depth sorting, cannot share an
 * opaque material, and would therefore cost the ghost a draw call of its own
 * and put a sorted object into a scene that has none. A desaturated grey reads
 * as a ghost at every distance measured and costs nothing.
 */
const RIDER_TINTS: Record<RiderMarker['kind'], number> = {
  rider: 0xffffff,
  bot: 0xc2410c,
  ghost: 0x64748b,
};

/**
 * The three, in the order {@link RiderBelt} reserves instance slots for.
 *
 * ⚠️ **Derived from the tints rather than typed out**, so a fourth marker kind
 * added to `port.ts` lands here automatically and gets a tint or a compile
 * error rather than being silently undrawn.
 */
const RIDDEN_KINDS = Object.keys(RIDER_TINTS) as readonly RiderMarker['kind'][];

/**
 * Everything one rider's leg pose depends on, in the order {@link RiderBelt}
 * stores it — five numbers a slot.
 *
 * ⚠️ **The four before the angle are the rider's own world transform**, and
 * leaving them out is the defect #366–#368's review found: a leg segment's
 * matrix is composed in world space, so it goes stale when the rider moves as
 * readily as when the cranks turn. Written out rather than left implicit
 * because the reason the position belongs in an *animation* cache is not
 * obvious from the call site. The scale is not here: every rider is drawn at 1.
 */
const POSE_KEY = ['x', 'y', 'z', 'yaw', 'crankAngle'] as const;

/**
 * The tints that are not white: the bot's and the ghost's.
 *
 * Only these go into {@link LIT_COLOURS}. The rider's is white and would fail
 * the brightness bound on its own, which is correct and says nothing: white
 * multiplied by a palette is that palette, and every colour of it is already in
 * the list through `BICYCLE_COLOURS`.
 */
const TINTED_KINDS: readonly RiderMarker['kind'][] = ['bot', 'ghost'];

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
 * How far from the road's centreline `scatter.ts` can put anything: **21.5 m**.
 *
 * Derived from that file's own three numbers rather than restated here, so the
 * cull below cannot go on describing a band that has moved. ⚠️ **21 m before
 * #348, 44.5 m after it, 34.5 m in #351, 24.5 m in #353 and 21.5 m since
 * #355**, each of which brought the scenery in because the one before it left
 * the median item too far out; the derivation is what made all four a one-line
 * consequence here rather than a number to remember separately.
 *
 * ⚠️ **#355 is the first of the four to move the VERGE rather than the band**,
 * and it lands here identically because this sum reads all three of them. What
 * is not identical is why: the band was narrowed to bring the median item in,
 * and the verge because a 6 m one puts the near band outside the camera's own
 * cone — `scatter.ts` §`SCATTER_VERGE_METRES` carries that arithmetic.
 */
const SCATTER_BAND_REACH_METRES =
  ROAD_WIDTH_METRES / 2 + SCATTER_VERGE_METRES + SCATTER_BAND_METRES;

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
 * alone would permit an item 1 700 m to the side of a rider at the far end of
 * the corridor, which is on screen and invisible.
 *
 * ⚠️ **What #424's lower camera does and does not do to this, since the issue
 * asks.** Nothing to the *solve*: `world.ts` fades the corridor's cut end by
 * solving a density against `VIEW_AHEAD_METRES`, which is a distance from the
 * RIDER, while three fogs by depth from the CAMERA along its axis — and the
 * camera is behind the rider, so the cut end is always a little deeper than
 * the solve assumed and a little more faded. That was true at 8 m back and
 * 5.2° of pitch (406.6 m) and is true at 4.5 m and 3.9° (403.7 m);
 * `camera.test.ts` §"the fog solve's premise" asserts it rather than leaving
 * it to this sentence. What a lower camera does change is the *ground*: from
 * 2 m up the plane is seen at a shallower angle, so more of the frame's lower
 * half is ground that is far away and therefore fogged, and the near, unfogged
 * band under the rider is a thinner strip than it was from 3 m. That is a
 * change to how the frame looks and to no bound — the ground plane still ends
 * 1 200 m out, where the thinnest air this client models has faded it by more
 * than 99.999 %.
 *
 * ⚠️ **And the cap is a statement about lateral distance, where three's fog is
 * a function of depth.** An item 400 m to the side and 100 m deep is NOT
 * three-quarters fogged — it is between a twelfth and a sixth fogged, depending
 * on the altitude. The cap never drops such
 * an item for a reason that has nothing to do with fog: the corridor is
 * `VIEW_AHEAD_METRES` of road, so nothing `scatter.ts` places is further from
 * the rider than that road is long, and an item that far to the side has used
 * the whole of it getting there. `three-renderer.test.ts` §"never drops an
 * item that is on screen and not yet fogged out" is what carries the claim, at
 * ten radii, with the depth three really uses.
 */
export const FOGGED_OUT_METRES = VIEW_AHEAD_METRES;

/**
 * How far to the side of the *camera itself* a scatter item may stand: 43 m.
 *
 * ⚠️ **42 m before #348, 89 m after it, 69 m in #351, 49 m in #353 and 43 m
 * since #355**, for the reason {@link SCATTER_BAND_REACH_METRES} gives. Widening the floor can
 * only make the cull keep *more*; narrowing it can only make it keep less, and
 * what bounds that is the property below rather than this number — which is why
 * #351 and #353 each re-took every measurement here rather than reasoning that
 * a narrower band is safe because a wider one was.
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
 * - **The camera is pitched**, so an item's depth along the view axis is
 *   `cos p · d − sin p · (itemHeight − cameraHeight)` rather than the `d`
 *   {@link lateralReachMetres} uses. Where that is *more* than `d` the true
 *   frustum is wider than the bound assumes, and this margin is what absorbs
 *   it: the bound stays safe while `depth − d ≤ 43 / FRUSTUM_SPREAD` ≈
 *   **10.2 m**.
 *
 *   ⚠️ **Re-derived for #424, which changed both halves of that.** The lens
 *   went from 60° to 70°, so `FRUSTUM_SPREAD` is 4.20 where it was 3.46 and the
 *   same 43 m buys 10.2 m of depth error where it bought 12.4. And the pitch is
 *   no longer a constant `atan(3 / 33) ≈ 5.2°`: `camera.ts` §`cameraRig` aims
 *   the camera at the ROAD, so `p` is `atan(2 / 29.5) ≈ 3.9°` plus the slope of
 *   the road between the eye and the look-ahead. Worked at the far end of the
 *   view, 404.5 m from the camera:
 *
 *   | the road | `p` | item below the eye | `depth − d` |
 *   |---|--:|--:|--:|
 *   | level | 3.9° | 2 m | −0.8 m |
 *   | a sustained 8 % descent | 8.4° | 34 m | +0.7 m |
 *   | a sustained 15 % descent | 12.3° | 63 m | +4.1 m |
 *   | a sustained 25 % descent | 17.6° | 103 m | **+12.2 m** |
 *   | a sustained 8 % climb | −0.7° | −30 m (above it) | +0.3 m |
 *   | a sustained 15 % climb | −4.7° | −59 m | +3.4 m |
 *   | a sustained 22 % climb | −8.7° | −87 m | +8.5 m |
 *   | a sustained 25 % climb | −10.3° | −99 m | **+11.2 m** |
 *
 *   So the margin holds to a sustained grade of about 22 % down, or about 24 %
 *   up, over the whole 400 m view, which no road is; the paragraph this
 *   replaces claimed 35 % on the old lens and a level gaze.
 *
 *   ⚠️ **On EITHER sign of grade the bound errs narrow, and this paragraph
 *   used to say a climb erred wide.** That was true of the level gaze — a
 *   fixed 5.2° down-pitch looking at a road that rises — and a reviewer who
 *   remembers it is reading the old file. Under `cameraRig` the axis follows
 *   the road, so `p` goes negative on a climb while the item goes ABOVE the
 *   eye, both factors of `− sin p · (itemHeight − cameraHeight)` change sign
 *   together, and the term stays positive: depth along the axis is roughly the
 *   road's path length whichever way it tilts. #436's review found it by
 *   extending the table; the four climb rows are that arithmetic.
 *   ⚠️ **220 m of drop until #353, 157 m until #355 and 138 m until #424**:
 *   the margin is smaller every time and the claim it supports is the same
 *   one, re-derived rather than carried over.
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
 * re-measured for #351, #353, #355 and #424** — a reviewer who remembers
 * 100 / 98.7 / 98.7 / 98.3 / 43.9 here is reading the #348 file, and
 * 98.3 / 98.8 / 99.2 / 79.6 the one before that. Driving the real `sceneFrame`
 * through the real belt on constant-radius routes — worst frame of a 1.5 km
 * sweep — it submits **99.6 %** on a straight route, **98.8 %** at R = 450 m,
 * **99.2 %** at R = 200 m, **98.8 %** at R = 150 m and **55.7 %** at
 * R = 100 m. On the same sweep the box kept 98.3 %, 56.7 % and 41.3 % of the
 * first three.
 *
 * ⚠️ **#424 moved only the last of those, and upwards** — 52.4 % before it.
 * The camera is 3.5 m nearer the rider and the lens 10° wider, so the cone is
 * wider at every depth and a little more of a hairpin's fold is inside it. The
 * four figures above it are set by the floor rather than by the cone and did
 * not move in the second decimal place.
 *
 * ⚠️ **The share dropped on a bend tracks the band's depth, and is not a
 * property of the cull.** #348 took the placement band from 21 m to 44.5 m from
 * the centreline and the share dropped at R = 100 m roughly doubled; #351
 * brought it to 34.5 m and it fell back from 56.1 % to 44.9 %. On a hairpin the
 * far part of that band folds behind the rider, so a deeper band is more of it.
 *
 * ⚠️ **#353 took it to 24.5 m and the figure at R = 100 m did NOT move**, which
 * is worth stating because the sentence above predicts it should have. Measured
 * either side of that change: 44.9 % dropped at R = 100 m both times. What did
 * move is **tighter** than that — 35.8 % dropped at R = 75 m against 64.2 %
 * kept before, and 30.4 % at R = 50 m against 75.2 % kept — and it moved
 * *upwards*, because `scatter.ts`'s `bandsAt` fits whole bands into the reach a
 * bend leaves and a three-metre band fits where a five-metre one did not. So a
 * narrower band places **more** on a hairpin, not less, and more of that is
 * behind the fold.
 *
 * ⚠️ **#355 moved all three of those, and by the same mechanism** — a 6.5 m
 * verge leaves reach on a bend where a 9.5 m one left none, so `bandsAt` admits
 * radii down to about 16 m rather than about 22 m. Re-measured: **47.6 %**
 * dropped at R = 100 m against 44.9 % before, **40.0 %** at R = 75 m against
 * 35.8 %, and **32.1 %** at R = 50 m against 30.4 %. The direction is the one
 * the paragraph above describes, so this change is the first in the chain whose
 * effect on a hairpin matches the model of it.
 *
 * **None of it is inside the frustum**: that is asserted over
 * every item of every frame at ten radii rather than argued for, in
 * `three-renderer.test.ts` §"never drops an item that is on screen and not yet
 * fogged out", and that assertion is what carries the claim through all five
 * of these re-measurements.
 *
 * What it still gets wrong is the aspect ratio, and it is a cliff rather than a
 * slope: at 8 : 1 — a viewport about 107 CSS px tall, which nothing produces —
 * a 100 m hairpin starts culling items that are on screen and only 59 % faded
 * into the horizon.
 *
 * ⚠️ **#355 is the further narrowing this paragraph said would oblige somebody
 * to re-run the probe, and it has been re-run rather than reasoned about** — a
 * reviewer who remembers this paragraph carrying a figure it called
 * "pessimistic rather than wrong" is reading the old file. The three sentences
 * it used to carry rested on the floor being comfortably above the 42 m the
 * cliff was measured at; at 43 m that ratio is 1.02 and the argument had
 * nothing left in it.
 *
 * Measured on the current constants, by sweeping the aspect ratio through the
 * same 1.5 km sweep and counting items that are on screen at that aspect, less
 * than {@link MINIMUM_VIEW_END_OCCLUSION} faded, and dropped:
 *
 * | aspect | R = 100 m | R = 75 m | R = 50 m |
 * |---|--:|--:|--:|
 * | 6 : 1 (`WORST_CASE_ASPECT`) | 0 | 0 | 0 |
 * | 7 : 1 | 0 | 0 | 0 |
 * | 8 : 1 | **14** | 0 | 0 |
 * | 9 : 1 | 60 | **9** | 0 |
 * | 10 : 1 | 107 | 37 | **1** |
 *
 * ⚠️ **Re-measured for #424, with the new camera and the new lens**: 8 / 69 /
 * 111, 17 / 46 and 2 before it. So the cliff is still at **8 : 1** on a 100 m
 * hairpin, and further out on tighter ones, and the two rungs of margin above
 * `WORST_CASE_ASPECT` are a measurement rather than an inference.
 *
 * ⚠️ **Two things about that table changed in #423 and #424, and neither is
 * the numbers.** First, the aspect ratio it is safe up to is no longer an
 * argument about what a rider would plausibly do with a window: the world is
 * full-bleed now, so `theme.css` caps the canvas at 6 : 1 outright and
 * `camera.ts` §`WORST_CASE_ASPECT` says where that is measured. Second, "less
 * than `MINIMUM_VIEW_END_OCCLUSION` faded" is now judged at the depth three
 * actually fogs by — along the view axis, `fog_vertex.glsl`'s
 * `-mvPosition.z` — where the probe used to use the straight-line distance,
 * which is larger off-axis and so excused culls it should not have.
 * `three-renderer.test.ts` §`asTheCameraSeesIt` records it. The property held
 * under the honest depth at every radius, so the cull was right and its proof
 * was generous.
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
 * One loaded model, as the single geometry the belt instances — #341, #366.
 *
 * ## What is taken from the file, and what is dropped on the floor
 *
 * **Taken:** positions and normals, in world space, from every mesh in the
 * file, and — since #366 — each part's own **colour**, baked into a `COLOR_0`
 * attribute. **Dropped:** the materials themselves, the texture coordinates,
 * the tangents and any texture.
 *
 * ⚠️ **The colour used to be dropped too, and a reviewer who remembers this
 * comment saying so is reading the old file.** It said that keeping it would
 * cost `LIT_COLOURS` its completeness, and it stated the price of not keeping
 * it: *"a Kenney tree is authored with a separate trunk material, and one
 * colour per kind spends that — the trunk is drawn in the canopy's green"*. It
 * also drew every building in one flat beige, because a building's whole colour
 * lives in an atlas. #366 keeps the colour and replaces the completeness claim
 * with a gate — `scenery-palette.ts` §`SCENERY_PALETTE`, reproduced from the
 * committed bytes by a reader that shares no code with this file.
 *
 * ⚠️ **Dropping the materials is still the requirement, and it is a different
 * requirement.** ADR 0022 D-7: a `MeshStandardMaterial` a loader built from a
 * binary appears in no source file, so `three-seam.test.ts` could not see one,
 * and it would change how the **whole scene** is shaded. What survives here is
 * three numbers a vertex carries; the material every mesh wears is still
 * constructed in this file and is still the one D-7 asked for.
 *
 * ## Where a colour comes from, and the two cases
 *
 * - **A `baseColorFactor`.** Four of the committed models carry their colour
 *   this way, one constant per material, and three's `GLTFLoader` has already
 *   put it on `material.color` in the linear working space. Every vertex of the
 *   part gets it.
 * - **A texture atlas.** The buildings carry theirs in one, so each vertex is
 *   sampled at its own `TEXCOORD_0` — **once, here, at load** — and the image
 *   is then thrown away. `scenery-palette.ts` §`atlasColourAt` owns the
 *   sampling rule and the orientation trap inside it.
 *
 * ⚠️ **No texture ever reaches the GPU.** The atlas is decoded into bytes with
 * a 2D canvas and dropped; nothing downstream of this function holds a
 * `Texture`, the material the belt wears has no `map`, and the `TEXCOORD_0` the
 * sampling needed is deleted before the merge. That is #366's fourth criterion,
 * and `game.browser.spec.ts` counts the textures the renderer actually holds
 * rather than taking this paragraph's word for it.
 *
 * ⚠️ Every colour goes through `tonedForTheSun` on the way in. Thirteen of the
 * hundred and ten values the pack carries clip under `world.ts`'s peak
 * irradiance — seven of the eleven models hold at least one — and there is
 * nobody to ask for a darker one; `scenery-palette.ts` §`tonedForTheSun` is
 * where that is argued and where the measurement is recorded, and it is in that
 * file because this one must never name a sun constant.
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
export function prepareSceneryGeometry(
  source: Object3D,
  kind: ScatterKind,
  readImage: (image: unknown) => AtlasImage | undefined = readImagePixels,
): BufferGeometry {
  source.updateWorldMatrix(false, true);
  const parts: BufferGeometry[] = [];
  source.traverse((node) => {
    const mesh = node as Partial<Mesh>;
    if (mesh.isMesh !== true || mesh.geometry === undefined) {
      return;
    }
    const part = mesh.geometry.clone().applyMatrix4(node.matrixWorld);
    // ⚠️ **Read before the attributes are stripped**, because the sampling
    // needs the `TEXCOORD_0` that is about to go.
    paintFromMaterial(part, mesh.material, readImage);
    // Everything but position, normal and the colour just baked, gone before
    // the merge rather than after it: `mergeGeometries` refuses a set of parts
    // whose attributes disagree, and a UV kept for a texture that is never
    // uploaded is a third of a vertex buffer uploaded to a phone for nothing.
    for (const name of Object.keys(part.attributes)) {
      if (name !== 'position' && name !== 'normal' && name !== 'color') {
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
 * Bakes one model part's own colour into its vertices — #366.
 *
 * ⚠️ **Called before the attributes are stripped**, because the atlas case
 * needs the `uv` the strip is about to delete. Both cases write the same
 * attribute, so the merge downstream sees one shape whichever a part took.
 *
 * ⚠️ **A part with more than one material throws rather than painting its
 * first.** three's `GLTFLoader` splits a multi-primitive glTF mesh into one
 * `Mesh` per material, so it cannot happen for the committed files — which is
 * exactly why it has to be loud: a future pack that did it would otherwise
 * paint a whole building in its door's colour, and
 * {@link loadSceneryModels}'s own fallback would leave the primitive in place
 * where `game.browser.spec.ts` can see it.
 */
function paintFromMaterial(
  geometry: BufferGeometry,
  material: Material | Material[] | undefined,
  readImage: (image: unknown) => AtlasImage | undefined,
): void {
  if (Array.isArray(material)) {
    throw new Error('a model part declares more than one material');
  }
  const position = geometry.getAttribute('position') as BufferAttribute | undefined;
  const vertices = position?.count ?? 0;
  const surface = material as
    Partial<{ color: Color; map: { image?: unknown } | null }> | undefined;
  const map = surface?.map ?? undefined;
  // ⚠️ `readImage` is a seam and not a convenience: jsdom implements no 2D
  // context, so the only way to assert what this does with an atlas is to hand
  // it one. The same shape {@link loadSceneryModels}'s `load` takes.
  const atlas = map === undefined ? undefined : readImage(map.image);
  const uv = geometry.getAttribute('uv') as BufferAttribute | undefined;
  const channels = new Float32Array(vertices * 3);
  if (atlas !== undefined && uv !== undefined) {
    for (let at = 0; at < vertices; at += 1) {
      writeChannels(channels, at, tonedForTheSun(atlasColourAt(atlas, uv.getX(at), uv.getY(at))));
    }
  } else {
    // ⚠️ **White when there is no material at all, which is glTF's own default
    // rather than a guess** — §3.7.2.1 gives a primitive with no `material` a
    // base colour factor of `[1, 1, 1, 1]`. It is also what a **textured** part
    // falls back to when the image could not be read on a platform with no 2D
    // context, because `GLTFLoader` leaves such a material white: the building
    // is drawn in one pale grey rather than not at all, which is the same trade
    // {@link loadSceneryModels} makes for a model that will not load — lose the
    // detail, keep the ride. Pale rather than white because the toning brings
    // it under the ceiling.
    const found = surface?.color;
    // ⚠️ **Straight off the material with no conversion**, because three's
    // `GLTFLoader` has already read `baseColorFactor` as linear and a `COLOR_0`
    // is consumed as linear. `scenery-palette.ts` §`LinearRgb` is where that is
    // argued, and `bicycle.ts`'s hand-typed hex triples take the other path for
    // the opposite reason.
    //
    const flat = tonedForTheSun(found === undefined ? [1, 1, 1] : [found.r, found.g, found.b]);
    for (let at = 0; at < vertices; at += 1) {
      writeChannels(channels, at, flat);
    }
  }
  geometry.setAttribute('color', new BufferAttribute(channels, 3));
}

function writeChannels(into: Float32Array, at: number, colour: LinearRgb): void {
  into[at * 3] = colour[0];
  into[at * 3 + 1] = colour[1];
  into[at * 3 + 2] = colour[2];
}

/**
 * An image three loaded, as the bytes {@link atlasColourAt} needs.
 *
 * ⚠️ **The one place a `Texture`'s pixels are read, and the one moment they
 * exist at all.** The image is drawn into a throwaway 2D canvas, copied out,
 * and dropped; nothing keeps the canvas, nothing keeps the image, and the
 * `Texture` the loader built is disposed by {@link loadSceneryModels} before a
 * frame is ever drawn. So the atlas is **fetched** — one request, 11 784 bytes,
 * shared by three buildings — and never uploaded.
 *
 * `undefined` for anything that cannot be read: a platform with no 2D context,
 * an image that has not decoded, a canvas the browser refuses to read back.
 * {@link paintFromMaterial} answers that with the material's own flat colour
 * rather than failing the model.
 */
function readImagePixels(image: unknown): AtlasImage | undefined {
  const source = image as { width?: number; height?: number } | null | undefined;
  const width = source?.width ?? 0;
  const height = source?.height ?? 0;
  if (!(width > 0) || !(height > 0)) {
    return undefined;
  }
  try {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (context === null) {
      return undefined;
    }
    context.drawImage(image as CanvasImageSource, 0, 0);
    return { width, height, data: context.getImageData(0, 0, width, height).data };
  } catch {
    // A tainted canvas throws on read-back. The atlas is same-origin and
    // bundled, so it cannot be tainted here; this is the guard that keeps a
    // future asset from taking the ride down with it.
    return undefined;
  }
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
let sceneryGeometries: ReadonlyMap<ScatterKind, readonly BufferGeometry[]> = new Map();

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
  readImage: (image: unknown) => AtlasImage | undefined = readImagePixels,
): Promise<void> {
  const loaded = new Map<ScatterKind, readonly BufferGeometry[]>();
  await Promise.all(
    SCATTER_KINDS.map(async (kind) => {
      const models: readonly SceneryModel[] = SCENERY_MODELS[kind] ?? [];
      // ⚠️ **Bounded here as well as asserted in `scenery-models.test.ts`.**
      // The test is what fails a pull request that adds a fourth shape without
      // measuring what it costs; this is what stops a table that got past it
      // spending draw calls on a rider's phone. One is a gate and one is a
      // guard, and #367's own framing is that the budget must be somewhere the
      // ladder can see.
      const wanted = models.slice(0, MAXIMUM_SCENERY_VARIANTS);
      const shapes = await Promise.all(
        wanted.map(async (model) => {
          try {
            const scene = await load(model.url);
            try {
              return prepareSceneryGeometry(scene, kind, readImage);
            } finally {
              // ⚠️ **What makes "no texture reaches the GPU" structural rather
              // than a claim about timing.** The loader built a
              // `MeshStandardMaterial` and, for a building, a `Texture` holding
              // the atlas; three allocates nothing on the device until the
              // first draw, so neither has cost anything yet — and neither
              // exists by the time anything could. ADR 0022 D-7 is about the
              // material specifically, and this is where it stops being
              // reachable at all.
              releaseLoadedScene(scene);
            }
          } catch {
            // Keep the primitive for this variant. @see the note above.
            return undefined;
          }
        }),
      );
      // ⚠️ **Holes are dropped rather than left**, so a kind whose second file
      // failed draws its first shape everywhere instead of drawing nothing at
      // every other place — `ScatterBelt` takes a variant modulo this list's
      // length, and a `[geometry, undefined]` would make every other item
      // vanish. Losing variety is the documented trade; losing items is not.
      const kept = shapes.filter((shape): shape is BufferGeometry => shape !== undefined);
      if (kept.length > 0) {
        loaded.set(kind, kept);
      }
    }),
  );
  for (const shapes of sceneryGeometries.values()) {
    for (const geometry of shapes) {
      geometry.dispose();
    }
  }
  sceneryGeometries = loaded;
}

/**
 * Releases everything a loaded glTF scene holds, once its colours are baked.
 *
 * The geometries are clones by the time {@link prepareSceneryGeometry} is done
 * with them, so the originals are ours to drop; the materials and the atlas are
 * the loader's and are what ADR 0022 D-7 forbids reaching the scene.
 */
function releaseLoadedScene(source: Object3D): void {
  source.traverse((node) => {
    const mesh = node as Partial<Mesh>;
    mesh.geometry?.dispose();
    const material = mesh.material;
    if (material === undefined) {
      return;
    }
    for (const each of Array.isArray(material) ? material : [material]) {
      (each as Partial<{ map: { dispose?: () => void } | null }>).map?.dispose?.();
      each.dispose();
    }
  });
}

/**
 * Every colour **this file** decides that a lit material carries — #286.
 *
 * ⚠️ **It is no longer the whole of the scene's palette, and that sentence used
 * to be its entire point.** Until #366 it was, because every scenery kind was
 * drawn in one colour from {@link SCATTER_STYLE}; a reviewer who remembers this
 * comment claiming completeness is reading the old file. The scenery's colours
 * come out of the models now, and what enumerates and bounds *those* is
 * `scenery-palette.ts` §`SCENERY_PALETTE` — reproduced from the committed bytes
 * by a reader that shares no code with this file, which is #366's fifth
 * criterion. The two together are what D-7 protected; neither is on its own.
 *
 * What is left here is everything a **source file** still chooses: the
 * primitive fallbacks, which is what `post` is always drawn as and what any
 * kind whose model failed to load falls back to; the rider's palette; and the
 * two tints the bot and the ghost wear.
 *
 * ⚠️ **Derived from the tables rather than written out**, so a scenery kind, a
 * marker or a rider colour added without a thought for the light budget lands
 * in it automatically. `three-renderer.test.ts` §"lights no colour past white"
 * multiplies each through `world.ts`'s {@link PEAK_IRRADIANCE} in the linear
 * space the shader works in and requires the result to stay under white. That
 * is the check that keeps `SUN_ELEVATION_AT_POLE_DEGREES` honest, and the two
 * halves of it are deliberately in different files: the elevation band cannot
 * see a colour, and this file must never see a sun constant.
 *
 * @test-facing a bound `three-renderer.test.ts` asserts against; nothing in the
 * client reads it, because every material already holds its own colour.
 */
export const LIT_COLOURS: readonly number[] = [
  ...SCATTER_KINDS.map((kind) => SCATTER_STYLE[kind].colour),
  // #368. The bot's and the ghost's, which are **tints** on the rider's own
  // palette rather than colours of their own since they became bicycles. Each
  // is a conservative bound on what it produces: a tint multiplies, and both
  // factors are at most one, so a product can only be darker than either.
  ...TINTED_KINDS.map((kind) => RIDER_TINTS[kind]),
  // #349. The rider's own four, from the file that decides them, for the reason
  // the two lines above read their tables rather than restating them.
  ...BICYCLE_COLOURS,
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

/**
 * A material and its unlit twin, built once. @see QualitySettings.shading
 *
 * ⚠️ **There is no longer a `shadedMaterials(colour)` beside this, and a
 * reviewer who remembers one is reading the old file.** Since #366 the scenery
 * takes its colour from its vertices exactly as the rider already did, so no
 * material in the scene holds a colour and there is nothing for a
 * colour-taking constructor to do. {@link vertexColouredMaterials} is what
 * every pair is built by now.
 */
interface ShadedMaterials {
  readonly lit: MeshLambertMaterial;
  readonly flat: MeshBasicMaterial;
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
/**
 * A kind and a variant as one map key — #367.
 *
 * A string rather than a nested map because every read is by exactly that pair,
 * and a map of maps would need a guard at each level for a lookup that can only
 * miss in one way.
 */
function beltKey(kind: ScatterKind, variant: number): string {
  return `${kind}:${String(variant)}`;
}

/**
 * A kind's generated solid, with its own colour baked into its vertices — #366.
 *
 * ⚠️ **This is what lets one material serve the whole belt.** A primitive
 * carries no colour of its own, so before #366 each kind wore a material built
 * from {@link SCATTER_STYLE}'s entry; now that a model's vertices carry theirs,
 * a primitive that did not would have to be the one exception and would cost a
 * material and a draw call to be it. Painting it here puts `post` — and any
 * kind whose model failed to load — on exactly the same footing as a model,
 * which is the same move {@link prepareSceneryGeometry} makes from the other
 * side.
 *
 * ⚠️ Through {@link paintEveryVertex}, so the hex triple goes through three's
 * `Color` and is converted from sRGB. A model's own factor does **not** take
 * that path, because it is linear already — `scenery-palette.ts` §`LinearRgb`.
 */
function paintedPrimitive(kind: ScatterKind): BufferGeometry {
  const geometry = SCATTER_STYLE[kind].geometry();
  paintEveryVertex(geometry, SCATTER_STYLE[kind].colour);
  return geometry;
}

export class ScatterBelt {
  /**
   * One mesh per kind **per variant** — #367.
   *
   * ⚠️ Keyed by {@link beltKey}, which is a string rather than a nested map
   * because every read is by exactly that pair and a map of maps would need a
   * guard at each one.
   */
  readonly #meshes = new Map<string, InstancedMesh>();
  /** Which variants each kind actually has a shape for, in order. */
  readonly #shapes = new Map<ScatterKind, number>();
  /**
   * The belt's lit material and its unlit twin, built once — #286, #366.
   *
   * ⚠️ **One pair for the whole belt, where it used to be one pair per kind.**
   * Since #366 every vertex carries its own colour, so a material no longer
   * holds one and there is nothing left for a kind to have its own of — which
   * is also what keeps twelve meshes down to two materials, and a material
   * swap on the way down the ladder to one assignment per mesh.
   *
   * ⚠️ **Both, from the constructor, for the reason every other buffer here is
   * allocated up front:** the rung that turns the shading off is reached only
   * on a device that is already too hot, and building a material there is an
   * allocation on the worst frame of the ride. @see vertexColouredMaterials
   */
  readonly #materials = vertexColouredMaterials();
  /**
   * Survivors of the cull, per mesh, for the frame being built.
   *
   * ⚠️ Keyed by {@link beltKey} since #367, the same key {@link #meshes} is:
   * the two passes below reserve and write against it, and a count kept per
   * *kind* would size one variant's buffer for every variant's items.
   */
  readonly #counts = new Map<string, number>();
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
   * The most distinct shapes one kind may be drawn as this frame — #367.
   *
   * The quality rung's `sceneryVariants`, applied by
   * {@link ScatterBelt.setVariants}. Starts at the ceiling for the reason
   * {@link ScatterBelt.#budget} starts unbounded: a belt is a mechanism and a
   * rung is a policy, and `ThreeGameView`'s constructor applies one before it
   * draws anything.
   */
  #variants = MAXIMUM_SCENERY_VARIANTS;

  /**
   * @param models the shapes to draw, by kind, in variant order. Defaults to
   * whatever {@link loadSceneryModels} has loaded, which is what the shipped
   * client gets; a kind with no entry is drawn as {@link SCATTER_STYLE}'s
   * primitive, which is `post` always and any other kind whose files could not
   * be read.
   */
  constructor(models: ReadonlyMap<ScatterKind, readonly BufferGeometry[]> = sceneryGeometries) {
    for (const kind of SCATTER_KINDS) {
      const shapes = models.get(kind) ?? [];
      this.#shapes.set(kind, Math.max(1, Math.min(MAXIMUM_SCENERY_VARIANTS, shapes.length)));
      for (let variant = 0; variant < (this.#shapes.get(kind) ?? 1); variant += 1) {
        const model = shapes[variant];
        const mesh = new InstancedMesh(
          // ⚠️ **A copy of the model, not the model.** {@link dispose} releases
          // every geometry the belt is wearing, and the loaded ones are shared
          // by every belt this tab ever builds — a view that released them on
          // teardown would leave the next ride's world made of primitives, with
          // nothing to say why. A copy costs about 30 kB for the largest kind,
          // once per view.
          model === undefined ? paintedPrimitive(kind) : model.clone(),
          // ⚠️ **Lit since #286, and this is the file's biggest change of
          // mind.** It used to say *"no lighting means no light budget"* here,
          // which was a performance claim with no measurement behind it —
          // #286's own framing. It is a `MeshLambertMaterial` now, so a conifer
          // has a sunward face and a shaded one; the `flat` twin beside it is
          // exactly the material that used to be here, and the bottom rung of
          // `QUALITY_LADDER` puts it back. The cost is measured in
          // `game.browser.spec.ts` rather than argued about here.
          //
          // ⚠️ **It takes its colour from the vertices since #366**, which is
          // why it is one material for the whole belt rather than one a kind.
          this.#materials.lit,
          SCATTER_INSTANCE_CAPACITY,
        );
        // The buffer is rewritten every frame, so tell the driver that rather
        // than letting it hint STATIC_DRAW for something that never is.
        mesh.instanceMatrix.setUsage(DynamicDrawUsage);
        // three's constructor fills every slot with the identity matrix and
        // sets `count` to the capacity. A belt that drew before its first frame
        // would draw the whole capacity stacked at the origin.
        mesh.count = 0;
        mesh.visible = false;
        this.#meshes.set(beltKey(kind, variant), mesh);
      }
      this.#counts.set(kind, 0);
    }
  }

  /**
   * The meshes, by kind and variant. Twelve of them, whatever the frame holds.
   *
   * ⚠️ **Keyed by {@link beltKey} since #367, where it used to be keyed by kind
   * alone** — a reviewer who remembers `belt.meshes.get('rock')` is reading the
   * old file. {@link ScatterBelt.meshesOf} is the accessor that still takes a
   * kind.
   */
  get meshes(): ReadonlyMap<string, InstancedMesh> {
    return this.#meshes;
  }

  /** Every mesh one kind is drawn across. @see ScatterBelt.meshes */
  meshesOf(kind: ScatterKind): readonly InstancedMesh[] {
    const found: InstancedMesh[] = [];
    for (let variant = 0; variant < (this.#shapes.get(kind) ?? 0); variant += 1) {
      const mesh = this.#meshes.get(beltKey(kind, variant));
      if (mesh !== undefined) {
        found.push(mesh);
      }
    }
    return found;
  }

  /**
   * How many distinct shapes this rung will draw a kind as — #367.
   *
   * Applies a budget; never decides one, exactly as
   * {@link ScatterBelt.setBudget} does not decide an item count. Allocates
   * nothing: every mesh exists from the constructor and a rung below the
   * ceiling simply leaves some of them at `count === 0`, which three's own
   * `renderInstances` returns early on.
   *
   * ⚠️ **Floored at one.** {@link ScatterBelt.#keyFor} takes an item's variant
   * modulo this, so a zero would be a division by zero and a world with nothing
   * standing beside the road. `quality.ts` states the same floor from the other
   * side.
   *
   * ⚠️ **Unlike {@link ScatterBelt.setBudget}, the LINE THAT CALLS THIS IS
   * COVERED**, and the difference is worth stating because that method's own
   * note records the hole. `scene.ts` thins a frame to the same item count the
   * belt is budgeted with, so an unbudgeted belt submits exactly what a
   * budgeted one would and deleting `setBudget`'s call site leaves the whole
   * suite green. Nothing thins a frame by *variant*, so deleting this one's
   * call site leaves every rung drawing every shape — which
   * `game.browser.spec.ts` §"spends a bounded number of draw calls" counts in a
   * driver. Measured by mutation rather than reasoned about.
   */
  setVariants(variants: number): void {
    this.#variants = Math.max(1, Math.floor(variants));
  }

  /**
   * Shades the belt, or stops shading it — #286.
   *
   * Swaps a material that already exists; allocates nothing, touches no
   * geometry and no matrix. @see QualitySettings.shading
   */
  setShading(shading: QualitySettings['shading']): void {
    for (const mesh of this.#meshes.values()) {
      mesh.material = this.#materials[shading];
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
    for (const key of this.#meshes.keys()) {
      this.#counts.set(key, 0);
    }
    let admitted = 0;
    for (const item of items) {
      const key = this.#keyFor(item);
      const mesh = this.#meshes.get(key);
      if (mesh === undefined || !this.#inView(item, pose)) {
        continue;
      }
      if (admitted >= this.#budget) {
        break;
      }
      admitted += 1;
      this.#counts.set(key, (this.#counts.get(key) ?? 0) + 1);
    }
    for (const [key, mesh] of this.#meshes) {
      reserve(mesh, this.#counts.get(key) ?? 0);
      // Rewound here rather than tracked in a second map: the next loop uses
      // `mesh.count` as its write cursor and this is where it starts.
      mesh.count = 0;
    }
    admitted = 0;
    for (const item of items) {
      const mesh = this.#meshes.get(this.#keyFor(item));
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
    // ⚠️ **Both materials, not `mesh.material`** — since #286 the belt holds a
    // lit one and an unlit one and only one of them is mounted, so disposing
    // what a mesh happens to be wearing leaks the other's program for the life
    // of the context. The belt owns the pair, so the belt releases it.
    this.#materials.lit.dispose();
    this.#materials.flat.dispose();
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
  /**
   * Which mesh an item is drawn by — its kind, and its variant folded into
   * however many shapes that kind has at this rung.
   *
   * ⚠️ **Modulo rather than `min`**, and the difference is visible. Clamping a
   * variant to the last shape a kind has would pile every item above the count
   * onto one shape: at a two-shape kind with six slots that is a third-two-
   * thirds split, and at a rung of one variant it is the same thing again from
   * the other end. The remainder keeps whatever split the slots had — which is
   * why `scatter.ts` §`SCATTER_VARIANT_SLOTS` is six.
   */
  #keyFor(item: ScatterItem): string {
    const shapes = Math.min(this.#shapes.get(item.kind) ?? 1, this.#variants);
    // ⚠️ **A variant that is not an integer falls back to the first shape
    // rather than to no mesh at all.** `NaN % 2` is `NaN`, which names no key,
    // which drops the item — and scenery a caller placed and the screen never
    // showed is #240's named defect shape for this epic. `scatter.ts` cannot
    // produce one; a caller that built a frame some other way can.
    const wanted = Number.isInteger(item.variant) ? item.variant : 0;
    return beltKey(item.kind, ((wanted % shapes) + shapes) % shapes);
  }

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
 * The riders: three bicycles, the people on them, and cranks that turn —
 * #349, #368.
 *
 * ## Three objects for three riders, and why it is three rather than nine
 *
 * `bicycle.ts` describes about two dozen solids. Drawn one mesh at a time that
 * would be two dozen draw calls for the one object in the middle of the frame,
 * against the **twelve** #367 spends on all the scenery — so the parts are
 * merged, exactly as {@link ScatterBelt} merges a model's own parts and
 * `terrain.ts` merges the road's four features into one buffer. The split into
 * three is the minimum the motion requires:
 *
 * | | what it is | why it is not merged into its neighbour |
 * |---|---|---|
 * | {@link #bodies} | the frame, the wheels and the rider | it never moves relative to the marker |
 * | {@link #cranksets} | the chainring, the arms and the pedals | ⚠️ it **rotates**, about its own axis |
 * | {@link #limbs} | four leg segments each | ⚠️ each moves **independently** every time the cranks do |
 *
 * ⚠️ **It is three for one rider and three for all three, and that is #368's
 * whole affordability argument.** Each of those is an `InstancedMesh` now, so
 * the bot and the ghost cost **no draw call at all** — they are two more
 * instances in buffers that already exist. The scene went from five calls for
 * a bicycle and two solids to three for three bicycles.
 *
 * ⚠️ **What tells them apart is {@link RIDER_TINTS}, per instance.** The
 * colours are baked into the vertices, so three palettes would be three
 * geometries and nine calls; `instanceColor` multiplies the shared palette
 * instead — three's own `color_vertex.glsl.js` does `vColor.rgb *=
 * instanceColor.rgb` — which costs three floats an instance and nothing else.
 * `bicycle.ts` carries the replaced note about why they used to be solids.
 *
 * ## What is rebuilt per frame, and what deliberately is not
 *
 * Nothing is allocated in {@link place}: every rider is two matrix composes
 * into buffers that already exist, and its legs are four more — and those four
 * are **skipped when nothing that rider's legs were solved for has changed**,
 * which is {@link POSE_KEY}: its place, its heading and its crank angle. A
 * stationary bot, or a rider on a paused ride, costs nothing. ⚠️ A rider who
 * is *moving* and not pedalling does not: the legs are in world space and have
 * to come with them. #240's NFR-3, with the correction #366–#368's review
 * made to it.
 *
 * ⚠️ **Slots are filled in the order the frame's markers arrive**, so the
 * tints are rewritten each frame rather than once at construction: a frame
 * that carries a ghost and no bot puts the ghost in the slot the bot had.
 * Writing three floats three times is cheaper than the alternative — a fixed
 * slot per kind, with absent riders hidden by a zero scale, which submits
 * instances that exist only to draw nothing and is the shape #240 names as a
 * defect elsewhere in this file.
 *
 * ## Why it is a class, and why it is exported
 *
 * The two reasons {@link ScatterBelt} and {@link WorldLamps} are: `three` may
 * only be named in this file, so a rider in a file of its own is not available;
 * and something reachable only through {@link ThreeGameView} cannot be driven
 * at all in jsdom, where a `WebGLRenderer` cannot be constructed.
 */
export class RiderBelt {
  readonly #group = new Group();
  readonly #materials = vertexColouredMaterials();
  readonly #bodies: InstancedMesh;
  readonly #cranksets: InstancedMesh;
  readonly #limbs: InstancedMesh;

  /**
   * What each occupied slot's legs were last solved *for*: five numbers a slot,
   * laid out as {@link POSE_KEY}.
   *
   * ⚠️ **The crank angle is one of the five and on its own it is not enough**,
   * which is the whole reason this is a key rather than a number. `#poseLegs`
   * writes a **world** matrix — `this.#rider` times the bone's own local
   * transform — so a leg is stale the moment the *rider* moves, whether or not
   * the cranks turned. Keyed on the angle alone, a rider whose cadence sensor
   * reports nothing (`advanceCrank` returns the angle unchanged, which is every
   * frame of every power-only ride) is drawn as a bicycle with its legs left
   * behind at the place the first frame put them. It was keyed on the angle
   * alone until #366–#368's review, and it was sound before that only because
   * the limbs then sat in a `Group` carrying the world transform, so their
   * matrices were in the model's own frame and a move did not touch them.
   *
   * Filled with `NaN`, and `NaN !== NaN`, so a slot that has never been posed
   * always writes — an `InstancedMesh` starts with identity matrices, which
   * would put all four leg segments inside the bottom bracket.
   *
   * ⚠️ **Per slot rather than per kind, and cleared when the layout changes.**
   * A slot that held the bot last frame and the ghost this frame is a different
   * rider at the same index, and a cache that did not clear would leave the
   * ghost's legs wherever the bot's were. The position is now in the key too,
   * so that case is caught twice over — the clear stays because two riders can
   * swap slots at the same place on the same frame.
   */
  readonly #posed = new Float64Array(RIDDEN_KINDS.length * POSE_KEY.length).fill(Number.NaN);
  /** Which kind is in which slot, as one string, so a change is one compare. */
  #layout = '';

  readonly #position = new Vector3();
  readonly #turn = new Quaternion();
  readonly #stretch = new Vector3(1, 1, 1);
  readonly #matrix = new Matrix4();
  readonly #rider = new Matrix4();
  readonly #local = new Matrix4();
  readonly #tint = new Color();
  readonly #up = new Vector3(0, 1, 0);
  readonly #acrossTheBicycle = new Vector3(1, 0, 0);

  constructor() {
    const riders = RIDDEN_KINDS.length;
    this.#bodies = new InstancedMesh(mergedParts(RIDER_BODY_PARTS), this.#materials.lit, riders);
    this.#cranksets = new InstancedMesh(
      mergedParts(RIDER_CRANK_PARTS),
      this.#materials.lit,
      riders,
    );
    this.#limbs = new InstancedMesh(limbGeometry(), this.#materials.lit, riders * LEG_BONE_COUNT);
    for (const mesh of [this.#bodies, this.#cranksets, this.#limbs]) {
      mesh.instanceMatrix.setUsage(DynamicDrawUsage);
      // ⚠️ **Allocates `instanceColor` while `count` is still the capacity**,
      // because three sizes that buffer from `count` at the moment it is first
      // written. Doing it after the rewind below would give every one of them a
      // zero-length colour buffer and silently drop the tints.
      for (let slot = 0; slot < mesh.count; slot += 1) {
        mesh.setColorAt(slot, this.#tint.setHex(0xffffff));
      }
      // three's constructor sets `count` to the capacity and fills every slot
      // with the identity matrix. A belt that drew before its first frame would
      // draw three bicycles stacked at the origin.
      mesh.count = 0;
      // The riders are within a few metres of the camera on every frame of
      // every ride, so there is nothing for a cull to decide. The same reason
      // the road and the ground set it, and the opposite of the scenery belt.
      mesh.frustumCulled = false;
      this.#group.add(mesh);
    }
    this.#group.visible = false;
  }

  addTo(scene: Scene): void {
    scene.add(this.#group);
  }

  /**
   * What the riders are drawn by. For `three-renderer.test.ts`, which cannot
   * construct a `Scene` of its own — `three-seam.test.ts` allows exactly one
   * file in this repository to import the rendering library, and it is this
   * one. The same reason {@link ScatterBelt.meshes} is a getter.
   */
  get group(): Group {
    return this.#group;
  }

  /** The three meshes, in draw order. @see RiderBelt */
  get meshes(): {
    readonly bodies: InstancedMesh;
    readonly cranksets: InstancedMesh;
    readonly limbs: InstancedMesh;
  } {
    return { bodies: this.#bodies, cranksets: this.#cranksets, limbs: this.#limbs };
  }

  /**
   * Puts this frame's riders on the road, each facing along it, with the cranks
   * where its own {@link RiderMarker.crankAngle} has turned them.
   *
   * ⚠️ **Every marker, in the order the frame carries them**, where this used
   * to take one. A marker of a kind {@link RIDER_TINTS} does not name is
   * skipped rather than drawn untinted, which cannot happen for the three
   * `port.ts` declares and is what a fourth would hit.
   */
  place(markers: readonly RiderMarker[]): void {
    // ⚠️ **`Object.hasOwn`, not `in`.** `RIDER_TINTS` is an object literal, so
    // `'toString' in RIDER_TINTS` is true through the prototype — and a marker
    // that got past this with a kind the table does not hold would be handed
    // `setHex(undefined)` and drawn in a `NaN` colour. The three kinds
    // `port.ts` declares cannot reach it; a fourth, or a frame built from
    // parsed data, could.
    const drawn = markers.filter((marker) => Object.hasOwn(RIDER_TINTS, marker.kind));
    const layout = drawn.map((marker) => marker.kind).join(',');
    if (layout !== this.#layout) {
      this.#layout = layout;
      this.#posed.fill(Number.NaN);
    }
    let slot = 0;
    let posed = false;
    for (const marker of drawn) {
      if (slot >= RIDDEN_KINDS.length) {
        break;
      }
      posed = this.#placeOne(slot, marker) || posed;
      slot += 1;
    }
    for (const mesh of [this.#bodies, this.#cranksets]) {
      mesh.count = slot;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor !== null) {
        mesh.instanceColor.needsUpdate = true;
      }
    }
    this.#limbs.count = slot * LEG_BONE_COUNT;
    // ⚠️ **Only when a leg actually moved, which is what makes the skip a
    // saving.** Without the flag the matrices are re-uploaded on every frame of
    // every ride whether or not anybody pedalled, and the `#posed` cache
    // below saves the arithmetic and none of the bandwidth. Without the line at
    // all the matrices are written and never uploaded, and the legs stay
    // wherever the first frame put them — the half of an instanced update that
    // is impossible to see. `ScatterBelt` says the same thing.
    if (posed) {
      this.#limbs.instanceMatrix.needsUpdate = true;
    }
    if (this.#limbs.instanceColor !== null) {
      this.#limbs.instanceColor.needsUpdate = true;
    }
    this.#group.visible = slot > 0;
  }

  /** Draws no rider at all, for a frame that carries none. */
  hide(): void {
    this.place([]);
  }

  /** @see QualitySettings.shading */
  setShading(shading: QualitySettings['shading']): void {
    const material = this.#materials[shading];
    this.#bodies.material = material;
    this.#cranksets.material = material;
    this.#limbs.material = material;
  }

  dispose(): void {
    for (const mesh of [this.#bodies, this.#cranksets, this.#limbs]) {
      mesh.geometry.dispose();
      mesh.dispose();
    }
    // Both of each pair, for the reason `ScatterBelt.dispose` gives: only one
    // of the two is mounted, and the other would leak.
    this.#materials.lit.dispose();
    this.#materials.flat.dispose();
  }

  /**
   * One rider into one slot: its body, its crankset, its tint and its legs.
   *
   * @returns whether its legs were re-posed, so that {@link place} uploads the
   * limb matrices only on a frame where one of them moved.
   */
  #placeOne(slot: number, marker: RiderMarker): boolean {
    // ⚠️ **At the marker's own `y`, not lifted by a radius the way the bot and
    // the ghost used to be.** `bicycle.ts` puts the wheels on zero itself, so a
    // lift here would float every bicycle above the road. #368 is the change
    // that made that true of all three; before it, two of them were solids
    // centred on their own origin and had to be raised.
    this.#position.set(marker.x, marker.y, marker.z);
    // The model's `+Z` is the direction of travel; a rotation about `+Y` by
    // `atan2(headingX, headingZ)` takes `(0, 0, 1)` onto the marker's heading.
    const yaw = Math.atan2(marker.headingX, marker.headingZ);
    this.#turn.setFromAxisAngle(this.#up, yaw);
    this.#stretch.setScalar(1);
    this.#rider.compose(this.#position, this.#turn, this.#stretch);
    this.#bodies.setMatrixAt(slot, this.#rider);
    this.#bodies.setColorAt(slot, this.#tint.setHex(RIDER_TINTS[marker.kind]));

    // ⚠️ The crank geometry is written in the bottom bracket's own frame, so
    // the crankset is *mounted* at the axis and turns about its own origin.
    // Baking the offset into the vertices instead would make the rotation swing
    // the whole crankset round the bicycle.
    // ⚠️ **A frame that carries no angle holds the one this slot already had**,
    // which is what stops a bot's cranks snapping to top dead centre. `NaN` is
    // "never posed", and it has to become `0` rather than being carried into a
    // matrix — a `NaN` angle composes a `NaN` crankset and three loses the
    // whole mesh.
    const held = this.#posed[slot * POSE_KEY.length + 4] ?? Number.NaN;
    const angle = marker.crankAngle ?? (Number.isNaN(held) ? 0 : held);
    this.#position.set(0, CRANK_AXIS_Y, CRANK_AXIS_Z);
    this.#turn.setFromAxisAngle(this.#acrossTheBicycle, angle);
    this.#local.compose(this.#position, this.#turn, this.#stretch);
    this.#cranksets.setMatrixAt(slot, this.#matrix.multiplyMatrices(this.#rider, this.#local));
    this.#cranksets.setColorAt(slot, this.#tint);

    for (let bone = 0; bone < LEG_BONE_COUNT; bone += 1) {
      this.#limbs.setColorAt(slot * LEG_BONE_COUNT + bone, this.#tint);
    }
    // ⚠️ **All five, not the angle alone.** `#poseLegs` writes world matrices,
    // so the rider's own place and heading are part of what a pose was solved
    // for; see {@link POSE_KEY}. A `NaN` in the cache never equals anything,
    // which is how a slot's first frame always writes.
    //
    // ⚠️ **Written out rather than compared through an array**, because a
    // tuple built here would be one allocation per rider per frame and this
    // class's own contract is that {@link place} allocates nothing.
    const at = slot * POSE_KEY.length;
    const posed = this.#posed;
    const unmoved =
      posed[at] === marker.x &&
      posed[at + 1] === marker.y &&
      posed[at + 2] === marker.z &&
      posed[at + 3] === yaw &&
      posed[at + 4] === angle;
    if (unmoved) {
      return false;
    }
    this.#poseLegs(slot, angle);
    posed[at] = marker.x;
    posed[at + 1] = marker.y;
    posed[at + 2] = marker.z;
    posed[at + 3] = yaw;
    posed[at + 4] = angle;
    return true;
  }

  /** Where one rider's four leg segments are, for one crank angle. @see legBones */
  #poseLegs(slot: number, crankAngle: number): void {
    const bones = legBones(crankAngle);
    for (let index = 0; index < LEG_BONE_COUNT; index += 1) {
      const bone = bones[index];
      if (bone === undefined) {
        continue;
      }
      this.#position.set(bone.x, bone.y, bone.z);
      this.#turn.setFromAxisAngle(this.#acrossTheBicycle, bone.pitch);
      // The limb geometry is one metre long, so the bone's own length is the
      // `y` scale and nothing has to be rebuilt when a leg changes shape.
      this.#stretch.set(1, bone.length, 1);
      this.#local.compose(this.#position, this.#turn, this.#stretch);
      this.#limbs.setMatrixAt(
        slot * LEG_BONE_COUNT + index,
        this.#matrix.multiplyMatrices(this.#rider, this.#local),
      );
    }
    this.#stretch.setScalar(1);
  }
}

/**
 * One rider part, as geometry in the model's own frame.
 *
 * ⚠️ **The rotation order is X, then Y, then Z, then the translation**, and
 * `bicycle.ts` states it at {@link RiderPart} so that its numbers can be
 * checked without a renderer. Changing it here without changing it there would
 * leave a test asserting a bicycle the screen does not draw.
 */
function riderPartGeometry(each: RiderPart): BufferGeometry {
  const geometry = solidGeometry(each.solid);
  paintEveryVertex(geometry, each.colour);
  geometry.rotateX(each.pitch).rotateY(each.yaw).rotateZ(each.roll);
  geometry.translate(each.x, each.y, each.z);
  return geometry;
}

/** The solids `bicycle.ts` describes, at the segment counts a phone can afford. */
function solidGeometry(solid: RiderPart['solid']): BufferGeometry {
  switch (solid.shape) {
    case 'box':
      return new BoxGeometry(solid.width, solid.height, solid.depth);
    case 'tube':
      return new CylinderGeometry(solid.radius, solid.radius, solid.length, LIMB_SEGMENTS);
    case 'ring':
      return new TorusGeometry(solid.radius, solid.thickness, 5, 12);
    case 'ball':
      return new SphereGeometry(solid.radius, 8, 6);
  }
}

/** How many sides a tube has. Six reads as round at eight metres and costs four
 * triangles a segment less than eight. */
const LIMB_SEGMENTS = 6;

/** A one-metre leg segment, to be scaled to each bone's own length. */
function limbGeometry(): BufferGeometry {
  const geometry = new CylinderGeometry(LIMB_RADIUS_METRES, LIMB_RADIUS_METRES, 1, LIMB_SEGMENTS);
  paintEveryVertex(geometry, RIDER_PALETTE.limb);
  return geometry;
}

/**
 * Bakes one colour into a geometry's own vertices.
 *
 * ⚠️ **Through `Color`, which converts sRGB to the linear working space the
 * shader multiplies in.** A vertex colour written as the raw `0x22262b` bytes
 * would be the same mistake `terrain.ts` §`RoadCorridor.colours` records for
 * the road: visibly too bright, and wrong by a different amount per channel.
 */
function paintEveryVertex(geometry: BufferGeometry, colour: number): void {
  const found = new Color(colour);
  const vertices = geometry.getAttribute('position').count;
  const channels = new Float32Array(vertices * 3);
  for (let at = 0; at < vertices; at += 1) {
    channels[at * 3] = found.r;
    channels[at * 3 + 1] = found.g;
    channels[at * 3 + 2] = found.b;
  }
  geometry.setAttribute('color', new BufferAttribute(channels, 3));
}

/**
 * Every part of one list, as a single geometry.
 *
 * ⚠️ **`mergeGeometries` returns `null` rather than throwing** when the parts
 * disagree about their attributes, and a `null` here would be a rider that is
 * silently absent from the scene. Every solid above carries position, normal,
 * uv and the colour {@link paintEveryVertex} adds, so it cannot happen from the
 * parts this file builds — which is exactly why the failure has to be loud
 * rather than left to be discovered on a phone.
 */
function mergedParts(parts: readonly RiderPart[]): BufferGeometry {
  const built = parts.map(riderPartGeometry);
  const merged = mergeGeometries(built);
  for (const each of built) {
    each.dispose();
  }
  if (merged === null) {
    throw new Error('the rider parts could not be merged into one geometry');
  }
  return merged;
}

/**
 * The pair of materials the rider wears, taking its colour from its vertices.
 *
 * The sibling of {@link shadedMaterials}, and built the same way and for the
 * same reason: both up front, neither ever replaced, so a quality rung can swap
 * them mid-ride without allocating on the frame a phone is already struggling
 * with.
 */
function vertexColouredMaterials(): ShadedMaterials {
  return {
    lit: new MeshLambertMaterial({ vertexColors: true }),
    flat: new MeshBasicMaterial({ vertexColors: true }),
  };
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
  /** Reused every frame: `#placeCamera` allocated a `Vector3` per frame until #424 (NFR-3). */
  readonly #lookAt = new Vector3();
  readonly #roadGeometry = new BufferGeometry();
  readonly #road: Mesh;
  /**
   * The rider, the bot and the ghost — #349, #368.
   *
   * ⚠️ **One object for all three, where until #368 the rider was a
   * `RiderModel` and the other two were a `Map` of solid `Mesh`es beside it.**
   * A reviewer who remembers `#markers` and `#markerMaterials` is reading the
   * old file: there are no solid markers left, so there is nothing for a
   * second collection to hold.
   */
  readonly #riders = new RiderBelt();
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

    // #349, #368. Added here rather than in `render`, so that a frame carrying
    // no rider draws nothing rather than adding one on the frame it appears.
    this.#riders.addTo(this.#scene);

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
    // #367, and the same argument one line up: a rung is a property of the belt
    // between frames, so the render loop takes no decision about how many
    // distinct shapes it may draw. @see ScatterBelt.setVariants
    this.#scatter.setVariants(settings.sceneryVariants);
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
    this.#riders.setShading(shading);
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
    this.#riders.dispose();
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
    // #368. One call for all three, and a frame that carries none draws none —
    // `RiderBelt.place` sets every mesh's count from what it was handed, so
    // there is no "hide the ones that went" pass left to forget.
    this.#riders.place(markers);
  }

  /**
   * ⚠️ **Where the camera stands and looks is `camera.ts` §`cameraRig`'s, not
   * this method's** — #424. It used to be worked out here from `pose.y`, a
   * level gaze from behind the rider whatever the road did, and `cameraRig`
   * says what that does to a low camera on a hill. This applies the answer.
   */
  #placeCamera(pose: CameraPose): void {
    const { eye, target } = cameraRig(pose);
    this.#camera.position.set(eye.x, eye.y, eye.z);
    this.#camera.lookAt(this.#lookAt.set(target.x, target.y, target.z));
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
    const aspect = this.#widthCssPixels / this.#heightCssPixels;
    this.#camera.aspect = aspect;
    // ⚠️ #423 made the lens a function of the frame. The world was a 16 : 9
    // letterbox, so one vertical angle served every rider; it fills the
    // viewport now, and a fixed 70° on a phone held upright is a 36° horizontal
    // slot with the road's own edges outside it. `camera.ts`
    // §`verticalHalfTangent` has the policy and the table.
    this.#camera.fov = verticalFieldOfViewDegrees(aspect);
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
