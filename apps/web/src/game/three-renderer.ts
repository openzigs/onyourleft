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
 * route. ⚠️ Since #458 the ground is not a plane: it is the route's own
 * landform, {@link TerrainBelt}, with the hills of {@link HorizonRing} beyond.
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
 * octahedron all have a form for a light to find. The **road** stays
 * `MeshBasicMaterial`:
 *
 * - ⚠️ **The ground used to be on this list and is not since #458**, and a
 *   reviewer who remembers "the ground is one horizontal quad, and a lamp on
 *   it is a provable no-op" is reading the old file. That was true of a
 *   horizontal quad; the ground is a landform now, and an unlit slope reads
 *   flat, which is the defect #458 is. {@link TerrainBelt} says what it
 *   costs and why it also writes depth.
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
 * ## The riders stand on the road — #426
 *
 * Nothing the sun lit cast anything until #426, so the three bicycles floated.
 * Two ways to ground them, both from the ONE sun above — no second light
 * direction:
 *
 * - {@link ContactShadowBelt}: a soft blob under the rider and the pacer, drawn
 *   ON the unlit road because the road cannot receive a shadow. One
 *   transparent instanced draw, on every rung of the ladder. The ghost casts
 *   none (`contact-shadow.ts` §`CASTS_CONTACT_SHADOW`).
 * - A shadow map for the riders only, caught by a `ShadowMaterial` plane under
 *   them — `quality.ts` §`RIDER_SHADOW_MAP_RUNG`, above the ladder, off unless
 *   a device asks for it, and unmeasured on a phone. The scenery neither casts
 *   nor receives on any rung, and `three-seam.test.ts` counts every
 *   `castShadow` and `receiveShadow` write in this file to keep it so.
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
  AgXToneMapping,
  AmbientLight,
  BackSide,
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
  EquirectangularReflectionMapping,
  FogExp2,
  Group,
  HalfFloatType,
  InstancedBufferAttribute,
  InstancedMesh,
  LinearMipmapLinearFilter,
  LoadingManager,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshStandardMaterial,
  NoToneMapping,
  OctahedronGeometry,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  Quaternion,
  RepeatWrapping,
  Scene,
  ShaderMaterial,
  ShadowMaterial,
  SphereGeometry,
  SRGBColorSpace,
  TextureLoader,
  TorusGeometry,
  ShaderChunk,
  UniformsLib,
  UniformsUtils,
  Vector2,
  Vector3,
  WebGLRenderer,
  type Bone,
  type DataTexture,
  type Material,
  type Object3D,
  type SkinnedMesh,
  type Texture,
} from 'three';
// ⚠️ **Both of these ship inside `three@0.185.1` itself** — MIT, zero runtime
// dependencies — reached through the package's own `./addons/*` export. ADR
// 0022 §Consequences turns on that: #341 adds no npm dependency, so `DEP001` is
// not engaged and the lockfile does not move. And the specifier still matches
// `three-seam.test.ts`'s `['"]three(?:\/[^'"]*)?['"]`, so a loader imported
// anywhere but here is a red test with no change to that rule.
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
// ⚠️ **The realistic world's two addons ship in `three@0.185.1` too** (ADR 0026
// D-2: *"three 0.185.1 already ships PMREMGenerator, the HDR loader, GLTFLoader
// and KTX2Loader"*), so this adds no dependency and `DEP001` is not engaged.
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';

import {
  BUILDING_ROLES,
  BUILDING_VARIANTS,
  buildingPlan,
  isBuiltKind,
  type BuildingPlan,
  type BuildingRole,
  type BuiltKind,
} from './buildings';
import {
  BICYCLE_COLOURS,
  CRANK_AXIS_Y,
  CRANK_AXIS_Z,
  LEG_BONE_COUNT,
  LIMB_RADIUS_METRES,
  RIDER_BODY_PARTS,
  RIDER_CRANK_PARTS,
  RIDER_PALETTE,
  emptyRiderJoints,
  legBones,
  riderJoints,
  type JointPoint,
  type RiderPart,
} from './bicycle';
import {
  CONTACT_SHADOW_DARKNESS,
  CONTACT_SHADOW_LIFT_METRES,
  placeContactShadow,
  type ContactShadow,
} from './contact-shadow';
import {
  HORIZON_RADIUS_METRES,
  HORIZON_SEGMENTS,
  TERRAIN_BANDS,
  terrainMeshIsCurrent,
  type HorizonRelief,
  type TerrainMesh,
} from './landform';
import type { QualitySettings } from './quality';
import {
  isRealisticVegetation,
  PHOTOGRAPHIC_STRUCTURE_SURFACES,
  REALISTIC_RIDER,
  REALISTIC_SKY,
  REALISTIC_BOUNDARY_PARTS,
  REALISTIC_BUILDING_SURFACES,
  isPhotographic,
  REALISTIC_STRUCTURE_SURFACES,
  REALISTIC_SURFACES,
  REALISTIC_VEGETATION,
  REALISTIC_VEGETATION_KINDS,
  realisticUrl,
  type RealisticVegetationKind,
  type RealisticWorldOutcome,
  type StructureSurface,
} from './realistic-assets';
import { REALISTIC_NEAR_MESHES } from './realistic-budget';
import {
  environmentIntensity,
  halfToFloat,
  PHOTOGRAPHIC_ROAD_GRAIN,
  REALISTIC_EXPOSURE,
  reflectedSkyColour,
  skyBandRadiance,
  skyRotation,
  WATER_HORIZON_BAND,
  WATER_ZENITH_BAND,
  skySunU,
  upwardRadiance,
  type LinearColour,
  type SkyPixels,
} from './realistic-light';
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
  SCENERY_KINDS,
  SCATTER_MAX_ITEMS,
  SCATTER_VERGE_METRES,
  STRUCTURE_KINDS,
  type SceneryKind,
  type ScatterItem,
  type StructureKind,
} from './scatter';
import {
  CAMERA_BEHIND_METRES,
  CAMERA_FIELD_OF_VIEW_DEGREES,
  FRUSTUM_SPREAD,
  cameraRig,
  verticalFieldOfViewDegrees,
} from './camera';
import {
  ROAD_SURFACE_GRAIN,
  ROAD_WIDTH_METRES,
  VIEW_AHEAD_METRES,
  VIEW_BEHIND_METRES,
} from './terrain';
import { FIELD_DEPTH_METRES, FIELD_EDGE_LATERAL_METRES } from './settlements';
import {
  MAXIMUM_BRIDGE_PARTS,
  waterSurfaceIsCurrent,
  type BridgePart,
  type WaterSurface,
} from './waterways';
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

/*
 * ⚠️ **`GROUND_RADIUS_METRES` and `GROUND_BELOW_ROAD_METRES` lived here until
 * #458 and do not any more** — a reviewer who remembers "the ground is one
 * quad, 2 × 1 200 m, 0.25 m under the road at the rider" is reading the old
 * file. That quad moved with the rider and stayed level with them, so a 10 %
 * climb lifted the road off a flat world and a descent dived through it: the
 * gradient could not be seen. {@link TerrainBelt} draws `landform.ts`'s ground
 * instead, and {@link HorizonRing} the hills beyond it.
 */

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
 * change to how the frame looks and to no bound. ⚠️ This sentence went on to
 * say the ground plane ended 1 200 m out; since #458 the corridor's own ground
 * ends 420 m out, where it is at least three-quarters fogged, and the horizon
 * ring's foot — in the horizon colour itself — stands behind it.
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
/** One coloured solid of a shape built from several — #460. */
interface ShapePart {
  readonly colour: number;
  readonly geometry: () => BufferGeometry;
}

/**
 * How a kind is drawn when no model stands in for it: one solid in one colour,
 * or — since #460 — several solids in several colours merged into one shape.
 */
interface SceneryStyle {
  /** The kind's main colour: its only one, or its walls'. */
  readonly colour: number;
  /** The whole shape, uncoloured: what a model is sized against. */
  readonly geometry: () => BufferGeometry;
  /** The coloured solids the shape is made of, where it is more than one. */
  readonly parts?: readonly ShapePart[];
  /**
   * Which building `buildings.ts` builds this kind as — #500 — painted by
   * {@link STRUCTURE_STYLE}, in {@link BUILDING_VARIANTS} shapes.
   */
  readonly built?: StylisedBuiltKind;
}

/** A box with its base at `bottom` and centred on `(x, z)`. */
function block(
  width: number,
  height: number,
  depth: number,
  x = 0,
  bottom = 0,
  z = 0,
): BufferGeometry {
  return new BoxGeometry(width, height, depth).translate(x, bottom + height / 2, z);
}

/** The {@link BuiltKind}s the stylised world draws from numbers — every one but `building`. */
type StylisedBuiltKind = Exclude<BuiltKind, 'building'>;

/**
 * What colour each part of a stylised building is, by what it is made of —
 * #460's colours for the walls and the roofs, and #500's for everything it
 * added: the plinth, the ridge, the chimney, the joinery, the doors and the
 * glass. `buildings.ts` decides the shapes; this decides the paint.
 *
 * ⚠️ **Provenance, per #240's BR-1 and ADR 0009 L2**: plain building colours
 * chosen here, derived from nothing. Every one lands in {@link LIT_COLOURS}
 * through {@link sceneryColours}, so `three-renderer.test.ts` §"lights no
 * colour past white" holds each against the sun with no edit there.
 */
const STRUCTURE_STYLE: Readonly<Record<StylisedBuiltKind, Readonly<Record<BuildingRole, number>>>> =
  {
    barn: {
      wall: 0x8a3b2e,
      plinth: 0x5e5a53,
      roof: 0x4a4038,
      ridge: 0x3a322c,
      chimney: 0x7a3a2e,
      joinery: 0xcfc8b8,
      door: 0x5b2a22,
      glass: 0x28323a,
    },
    church: {
      wall: 0xb8b2a4,
      plinth: 0x8e897d,
      roof: 0x55595e,
      ridge: 0x44484d,
      chimney: 0xa9a394,
      joinery: 0x6b5238,
      door: 0x4a3524,
      glass: 0x28323a,
    },
    'shop-row': {
      wall: 0xb58a68,
      plinth: 0x7a6b5c,
      roof: 0x5e6166,
      ridge: 0x4b4e53,
      chimney: 0x9a6d52,
      joinery: 0x2f4a3f,
      door: 0x3a3f4a,
      glass: 0x28323a,
    },
    shed: {
      wall: 0x8c9296,
      plinth: 0x6c6f70,
      roof: 0x6f7478,
      ridge: 0x5f6468,
      chimney: 0x6f7478,
      joinery: 0x7b8185,
      door: 0x5f6468,
      glass: 0x28323a,
    },
  };

/**
 * The field boundaries and the signpost #460 adds, each built from numbers
 * typed here — nothing is downloaded and nothing traced, ADR 0009. The
 * buildings are `buildings.ts`'s since #500, painted by {@link STRUCTURE_STYLE}.
 *
 * ⚠️ Every field boundary runs along +z, because a run is turned to follow the
 * road or to leave it, and every one is set half a metre into the ground.
 */
const BOUNDARY_STYLE = {
  wall: [{ colour: 0x9b9486, geometry: () => block(0.55, 1.1 + 0.5, 8, 0, -0.5) }],
  hedge: [{ colour: 0x3e5e2e, geometry: () => block(1.1, 1.3 + 0.5, 8, 0, -0.5) }],
  fence: [
    {
      colour: 0x8a6f4f,
      geometry: () =>
        merged([
          ...[-4, -2, 0, 2, 4].map((z) => block(0.12, 1.3 + 0.4, 0.12, 0, -0.4, z)),
          block(0.06, 0.1, 8, 0, 0.5),
          block(0.06, 0.1, 8, 0, 0.95),
        ]),
    },
  ],
  signpost: [
    {
      colour: 0x5a5a5a,
      geometry: () => new CylinderGeometry(0.06, 0.06, 3, 6).translate(0, 1.1, 0),
    },
    {
      colour: 0xe0dccf,
      geometry: () =>
        merged([block(0.05, 0.28, 1, 0, 2.15, 0.45), block(0.05, 0.28, 1, 0, 1.8, -0.45)]),
    },
  ],
} as const satisfies Record<BoundaryKind, readonly ShapePart[]>;

/** The structures that are not buildings: the field boundaries and the signpost. */
type BoundaryKind = Exclude<StructureKind, BuiltKind>;

/**
 * Whether #500's openings are cut — the browser gate's control, and nothing
 * else's. @see setBuildingOpenings
 */
let openingsCut = true;

/**
 * Builds every view created after this call with its buildings' openings cut,
 * or with the same shapes and none — #500's browser-gate control: the probe
 * that reads a window's glass must read brick where there is no window, or it
 * was reading something other than the window.
 *
 * @test-facing `apps/web/browser/game-harness.ts` §`realisticProbe` builds a
 * view with none, for the control; the product never switches them off
 */
export function setBuildingOpenings(on: boolean): void {
  openingsCut = on;
}

/** One kind's shape in one variant, remembered: {@link buildingPlan} is pure. */
const plans = new Map<string, BuildingPlan>();

function planOf(kind: BuiltKind, variant: number): BuildingPlan {
  const key = `${kind}:${String(variant)}:${String(openingsCut)}`;
  const known = plans.get(key);
  if (known !== undefined) return known;
  const plan = buildingPlan(kind, variant, { openings: openingsCut });
  plans.set(key, plan);
  return plan;
}

/** One role of a plan, as a geometry with flat normals — or `undefined` if it has none. */
function roleGeometry(plan: BuildingPlan, role: BuildingRole): BufferGeometry | undefined {
  const triangles = plan.triangles[role];
  if (triangles.length === 0) return undefined;
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(triangles), 3));
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * How much of the light a building's surface keeps, by how high it is — #500's
 * *"grounding: a darker band where the wall meets the ground"*, which is #426's
 * contact-shadow argument applied to a wall: without it a building looks
 * placed rather than built. **0.55** at the ground and below, rising in a
 * straight line to all of it at {@link GROUNDING_METRES}. Baked into the
 * vertex colour in both worlds, so it costs no texture and no draw call.
 */
export const GROUNDED_SHADE = 0.55;

/** How high the grounding band reaches: **0.8 m**. @see GROUNDED_SHADE */
export const GROUNDING_METRES = 0.8;

/**
 * The share of the light a vertex at height `y` keeps. @see GROUNDED_SHADE
 */
export function groundingShade(y: number): number {
  const rise = Math.min(1, Math.max(0, y / GROUNDING_METRES));
  return GROUNDED_SHADE + (1 - GROUNDED_SHADE) * rise;
}

/**
 * Colours every vertex `colour` × its {@link groundingShade}, × `shade` — or,
 * with `grounded` false, `colour` × `shade` at every height.
 */
function paintGrounded(geometry: BufferGeometry, colour: number, shade = 1, grounded = true): void {
  const found = new Color(colour);
  const position = geometry.getAttribute('position');
  const channels = new Float32Array(position.count * 3);
  for (let at = 0; at < position.count; at += 1) {
    const light = (grounded ? groundingShade(position.getY(at)) : 1) * shade;
    channels[at * 3] = found.r * light;
    channels[at * 3 + 1] = found.g * light;
    channels[at * 3 + 2] = found.b * light;
  }
  geometry.setAttribute('color', new BufferAttribute(channels, 3));
}

/** A stylised building, every role painted and merged into one geometry: one mesh, one draw call. */
function paintedBuilding(kind: StylisedBuiltKind, variant: number): BufferGeometry {
  const plan = planOf(kind, variant);
  const painted: BufferGeometry[] = [];
  for (const role of BUILDING_ROLES) {
    const geometry = roleGeometry(plan, role);
    if (geometry === undefined) continue;
    paintGrounded(geometry, STRUCTURE_STYLE[kind][role]);
    painted.push(geometry);
  }
  const joined = mergeGeometries(painted);
  for (const each of painted) each.dispose();
  if (joined === null) throw new Error(`${kind}: its parts could not be merged into one geometry`);
  return joined;
}

/** Several solids as one geometry: position and normal only, flat-shaded. */
function merged(parts: readonly BufferGeometry[]): BufferGeometry {
  const flat = parts.map((part) => {
    const each = part.index === null ? part : part.toNonIndexed();
    for (const name of Object.keys(each.attributes)) {
      if (name !== 'position' && name !== 'normal') {
        each.deleteAttribute(name);
      }
    }
    return each;
  });
  const joined = mergeGeometries(flat);
  for (const part of new Set([...parts, ...flat])) {
    part.dispose();
  }
  if (joined === null) {
    throw new Error('a built shape could not be merged into one geometry');
  }
  return joined;
}

/** A building's style — #500: its walls' colour, its whole shape, and which building it is. */
function buildingStyle(kind: StylisedBuiltKind): SceneryStyle {
  return {
    colour: STRUCTURE_STYLE[kind].wall,
    geometry: () => paintedBuilding(kind, 0),
    built: kind,
  };
}

/** A style from coloured parts: its first part's colour, all of its solids. */
function builtStyle(parts: readonly ShapePart[]): SceneryStyle {
  return {
    colour: (parts[0] as ShapePart).colour,
    geometry: () => merged(parts.map((part) => part.geometry())),
    parts,
  };
}

const SCATTER_STYLE: Record<SceneryKind, SceneryStyle> = {
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
  // #460, #500. Built from numbers — `buildings.ts` says how, and why they
  // face +z; `STRUCTURE_STYLE` says what colour each part is.
  barn: buildingStyle('barn'),
  church: buildingStyle('church'),
  'shop-row': buildingStyle('shop-row'),
  shed: buildingStyle('shed'),
  wall: builtStyle(BOUNDARY_STYLE.wall),
  hedge: builtStyle(BOUNDARY_STYLE.hedge),
  fence: builtStyle(BOUNDARY_STYLE.fence),
  signpost: builtStyle(BOUNDARY_STYLE.signpost),
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
export function sceneryFitMetres(kind: SceneryKind): number {
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
  kind: SceneryKind,
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
let sceneryGeometries: ReadonlyMap<SceneryKind, readonly BufferGeometry[]> = new Map();

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
  const loaded = new Map<SceneryKind, readonly BufferGeometry[]>();
  await Promise.all(
    SCENERY_KINDS.map(async (kind) => {
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

/** The bridges' stone. This repository's own: a weathered grey. */
export const BRIDGE_COLOUR = 0x8f8a80;

/**
 * Every colour a kind is drawn in when no model stands in for it: its own, and
 * — since #460 — each part of a built shape's. {@link LIT_COLOURS} is built
 * from it, and `three-renderer.test.ts` holds the list to it.
 */
export function sceneryColours(kind: SceneryKind): readonly number[] {
  const style = SCATTER_STYLE[kind];
  return [
    style.colour,
    ...(style.parts ?? []).map((part) => part.colour),
    // #500: every part of a building, from the plinth to the glass.
    ...(style.built === undefined
      ? []
      : BUILDING_ROLES.map((role) => STRUCTURE_STYLE[style.built as StylisedBuiltKind][role])),
  ];
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
  // Every colour of every kind, the built shapes' parts included (#460), once.
  ...new Set(SCENERY_KINDS.flatMap(sceneryColours)),
  // #368. The bot's and the ghost's, which are **tints** on the rider's own
  // palette rather than colours of their own since they became bicycles. Each
  // is a conservative bound on what it produces: a tint multiplies, and both
  // factors are at most one, so a product can only be darker than either.
  ...TINTED_KINDS.map((kind) => RIDER_TINTS[kind]),
  // #349. The rider's own four, from the file that decides them, for the reason
  // the two lines above read their tables rather than restating them.
  ...BICYCLE_COLOURS,
  // #459. The bridges' stone, which is lit like the scenery.
  BRIDGE_COLOUR,
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
  /**
   * `MeshLambertMaterial` in the stylised world; since ADR 0026 a
   * `MeshStandardMaterial` in the realistic one, which the environment map
   * lights — {@link physicalMaterials}.
   */
  readonly lit: MeshLambertMaterial | MeshStandardMaterial;
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
   * at the origin *is* the direction. The distance is irrelevant to the
   * lighting — which is why the unit vector is written straight in rather than
   * scaled out to some arbitrary radius. ⚠️ Since #426 the distance matters to
   * the shadow MAP's frame, on the one rung that has one, and
   * {@link aimShadowAt} moves both ends for that rung after this has run.
   */
  apply(sun: SunStyle, ambientShare = 1): void {
    this.#sun.target.position.set(0, 0, 0);
    // ⚠️ `ambientShare` is 0 in the realistic world (ADR 0026 D-9): the
    // environment map IS the ambient term there, solved to give a horizontal
    // surface exactly `sun.ambient` (`realistic-light.ts`), and an ambient lamp
    // on top of it would light every surface twice.
    this.#ambient.intensity = sun.ambient * LAMBERT_IRRADIANCE_SCALE * ambientShare;
    this.#sun.intensity = sun.direct * LAMBERT_IRRADIANCE_SCALE;
    this.#sun.position.set(sun.x, sun.y, sun.z);
  }

  /**
   * Whether the sun casts a shadow map — #426, the `'map'` rung only.
   *
   * ⚠️ **The only place in this file a lamp is told to cast**, and the one
   * light that may: `three-seam.test.ts` counts the `castShadow` writes. The
   * shadow camera is framed on {@link SHADOW_FRAME_METRES} either side of the
   * rider and no further, because what is being bought is the riders' shadow
   * and nothing else — the scenery neither casts nor receives.
   */
  setCasting(on: boolean): void {
    this.#sun.castShadow = on;
    if (!on) {
      return;
    }
    const { shadow } = this.#sun;
    shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
    const frame = shadow.camera;
    frame.left = -SHADOW_FRAME_METRES;
    frame.right = SHADOW_FRAME_METRES;
    frame.top = SHADOW_FRAME_METRES;
    frame.bottom = -SHADOW_FRAME_METRES;
    frame.near = 0.5;
    frame.far = SHADOW_SUN_DISTANCE_METRES * 2;
    frame.updateProjectionMatrix();
  }

  /**
   * Moves the sun to {@link SHADOW_SUN_DISTANCE_METRES} up its own direction
   * from the rider, looking at them — the shadow map's frame. ⚠️ The direction
   * is exactly {@link apply}'s: `position − target` is the same unit vector,
   * scaled. Called after `apply` on a `'map'` frame and never otherwise, so the
   * other rungs keep the target at the origin that `apply` documents.
   */
  aimShadowAt(x: number, y: number, z: number, sun: SunStyle): void {
    this.#sun.target.position.set(x, y, z);
    this.#sun.position.set(
      x + sun.x * SHADOW_SUN_DISTANCE_METRES,
      y + sun.y * SHADOW_SUN_DISTANCE_METRES,
      z + sun.z * SHADOW_SUN_DISTANCE_METRES,
    );
  }

  /** Releases both lamps. Neither owns a GPU resource; three asks for this anyway. */
  dispose(): void {
    this.#ambient.dispose();
    this.#sun.dispose();
  }
}

/**
 * The shadow map's resolution on the `'map'` rung: **512** texels square.
 *
 * #426 quotes 512–1024 for a phone; the bottom of that range, because it is
 * a measurement's starting position and the riders are small in the frame. At
 * {@link SHADOW_FRAME_METRES} that is 2.3 cm a texel.
 */
const SHADOW_MAP_SIZE = 512;

/**
 * How far either side of the rider the shadow map reaches: **6 m**. The rider
 * and a pacer riding with them. A pacer further off is not shadowed on this
 * rung at all — stated, because the contact blobs are OFF on it.
 */
const SHADOW_FRAME_METRES = 6;

/** How far up the sun's direction the shadow camera stands. Only its frame depends on it. */
const SHADOW_SUN_DISTANCE_METRES = 20;

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
function beltKey(kind: SceneryKind, variant: number): string {
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
function paintedPrimitive(kind: SceneryKind, variant = 0): BufferGeometry {
  const style = SCATTER_STYLE[kind];
  // #500: a building is `buildings.ts`'s shape in one of its variants.
  if (style.built !== undefined) return paintedBuilding(style.built, variant);
  if (style.parts !== undefined) {
    // #460: each part painted in its own colour, then merged — one geometry,
    // so still one mesh and one draw call however many colours it has.
    const painted = style.parts.map((part) => {
      const geometry = merged([part.geometry()]);
      paintEveryVertex(geometry, part.colour);
      return geometry;
    });
    const joined = mergeGeometries(painted);
    for (const each of painted) {
      each.dispose();
    }
    if (joined === null) {
      throw new Error(`${kind}: its parts could not be merged into one geometry`);
    }
    return joined;
  }
  const geometry = style.geometry();
  paintEveryVertex(geometry, style.colour);
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
  readonly #shapes = new Map<SceneryKind, number>();
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
  readonly #materials: ShadedMaterials;
  /** Whether the belt draws at all — false while the other world is drawn. @see setShown */
  #shown = true;
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
   * The kinds another belt draws — ADR 0026 D-3, and the realistic world's
   * primitives belt only; the stylised belt skips nothing.
   *
   * ⚠️ **A skipped kind in view still SPENDS this belt's budget** (#478). The
   * budget is the rung's for the whole frame, and the realistic world splits
   * the frame's scenery between this belt and
   * {@link RealisticVegetationBelt}. Counted only here, the trees would be
   * free: the second realistic rung's `scatterItems: 160` would have cut the
   * posts and the buildings and drawn all 240 items' worth of trees — which the
   * spike found to be the realistic world's cost. So both belts walk the list
   * in the same order, count the same items against the same number, and
   * between them admit exactly the items the stylised belt would.
   */
  readonly #skip: ReadonlySet<SceneryKind>;

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
   * @param options how the realistic world uses a second belt — ADR 0026
   * D-3. `skip` names kinds this belt never draws, because another belt draws
   * them; `physical` lights it as the realistic world lights everything, by the
   * environment and the sun rather than by the ambient lamp. The realistic
   * world's belt is handed an EMPTY `models` so that every kind it draws is its
   * procedural primitive: no Kenney model beside a photoscan (D-3). Since
   * layer 3 (#475) that is `post` alone, and the structures are
   * {@link RealisticStructureBelts}', each of which builds this belt with the
   * `models` and the `materials` of one photographic surface.
   */
  constructor(
    models: ReadonlyMap<SceneryKind, readonly BufferGeometry[]> = sceneryGeometries,
    options: {
      readonly skip?: ReadonlySet<SceneryKind>;
      readonly physical?: boolean;
      /**
       * The pair to wear instead — #475: one realistic structure surface's
       * textured pair, which the belt then owns and releases.
       */
      readonly materials?: ShadedMaterials;
    } = {},
  ) {
    this.#materials =
      options.materials ??
      (options.physical === true ? physicalMaterials() : vertexColouredMaterials());
    this.#skip = options.skip ?? new Set();
    for (const kind of SCENERY_KINDS) {
      if (options.skip?.has(kind) === true) {
        continue;
      }
      const shapes = models.get(kind) ?? [];
      // ⚠️ #500: a building drawn from numbers has shapes of its own — two
      // proportions — so its primitive fallback is one mesh a variant too.
      const primitives = SCATTER_STYLE[kind].built === undefined ? 1 : BUILDING_VARIANTS;
      this.#shapes.set(
        kind,
        Math.max(1, Math.min(MAXIMUM_SCENERY_VARIANTS, shapes.length || primitives)),
      );
      for (let variant = 0; variant < (this.#shapes.get(kind) ?? 1); variant += 1) {
        const model = shapes[variant];
        const mesh = new InstancedMesh(
          // ⚠️ **A copy of the model, not the model.** {@link dispose} releases
          // every geometry the belt is wearing, and the loaded ones are shared
          // by every belt this tab ever builds — a view that released them on
          // teardown would leave the next ride's world made of primitives, with
          // nothing to say why. A copy costs about 30 kB for the largest kind,
          // once per view.
          model === undefined ? paintedPrimitive(kind, variant) : model.clone(),
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

  /**
   * How many items the last frame drew — one instance each, across every mesh.
   *
   * @test-facing held by `realistic-renderer.test.ts` and, through
   * `sceneryDrawnOf`, by the browser gate: what a rung's budget is checked
   * against (#478)
   */
  get drawnItems(): number {
    let drawn = 0;
    for (const mesh of this.#meshes.values()) drawn += mesh.count;
    return drawn;
  }

  /** Every mesh one kind is drawn across. @see ScatterBelt.meshes */
  meshesOf(kind: SceneryKind): readonly InstancedMesh[] {
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
   * Whether the belt draws at all — ADR 0026 D-3. A view holds one belt for
   * each world and draws one of them; the other is hidden rather than emptied,
   * so switching costs one flag and no buffer.
   */
  setShown(on: boolean): void {
    this.#shown = on;
    if (!on) {
      for (const mesh of this.#meshes.values()) {
        mesh.visible = false;
      }
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
    if (!this.#shown) {
      return;
    }
    for (const key of this.#meshes.keys()) {
      this.#counts.set(key, 0);
    }
    let admitted = 0;
    for (const item of items) {
      const key = this.#keyFor(item);
      const mesh = this.#meshes.get(key);
      if ((mesh === undefined && !this.#skip.has(item.kind)) || !inView(item, pose)) {
        continue;
      }
      if (admitted >= this.#budget) {
        break;
      }
      admitted += 1;
      if (mesh === undefined) {
        // Another belt draws it; it has spent this frame's budget all the same.
        continue;
      }
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
      if ((mesh === undefined && !this.#skip.has(item.kind)) || !inView(item, pose)) {
        continue;
      }
      if (admitted >= this.#budget) {
        break;
      }
      admitted += 1;
      if (mesh === undefined) {
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
  /** Whether this belt draws at all. @see setShown */
  #shown = true;

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
    if (!this.#shown) {
      return;
    }
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

  /** Whether the stylised riders draw at all — false while the realistic ones do (ADR 0026 D-3). */
  setShown(on: boolean): void {
    this.#shown = on;
    if (!on) {
      this.#group.visible = false;
    }
  }

  /** @see QualitySettings.shading */
  setShading(shading: QualitySettings['shading']): void {
    const material = this.#materials[shading];
    this.#bodies.material = material;
    this.#cranksets.material = material;
    this.#limbs.material = material;
  }

  /**
   * Whether the riders cast into the sun's shadow map — #426, the `'map'` rung.
   * They do not RECEIVE one: what grounds a rider is its shadow on the road,
   * and self-shadowing is a second shadow pass over the same three meshes.
   */
  setCasting(on: boolean): void {
    for (const mesh of [this.#bodies, this.#cranksets, this.#limbs]) {
      mesh.castShadow = on;
    }
  }

  /** Asks three to rebuild both materials' programs. @see ThreeGameView.#applyRiderShadows */
  recompile(): void {
    this.#materials.lit.needsUpdate = true;
    this.#materials.flat.needsUpdate = true;
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
 * The riders' contact shadows — #426: a soft dark ellipse on the road under
 * the rider and the pacer, **one instanced transparent draw for all of them**.
 *
 * `contact-shadow.ts` decides where each goes, from `world.ts`'s own sun, and
 * who casts one at all (the ghost does not). This draws them.
 *
 * ## Why it reaches the screen over an unlit road
 *
 * It is drawn ON the road rather than received by it — the road is a
 * `MeshBasicMaterial` with no shadow lookup at all. Three things make that
 * work, and each was the obvious thing to get wrong:
 *
 * - **Transparent, with no depth write**, so three draws it after every opaque
 *   thing — the road, the ground and the riders are already in the depth
 *   buffer — and it neither hides the wheel standing on it nor is hidden by the
 *   road it lies on.
 * - **Depth-TESTED**, so the road over a crest, or the rider's own wheels, in
 *   front of it still hide it. A blob drawn without the test would show through
 *   a hill a pacer has gone over.
 * - **Lifted {@link CONTACT_SHADOW_LIFT_METRES} and polygon-offset toward the
 *   camera**, so it does not fight the road's own triangles for the same depth.
 *   ⚠️ Since #458 the ground beside the road writes depth too, a quarter of a
 *   metre under the road — so a blob that spills off the tarmac is lifted
 *   clear of it by the same margin.
 *
 * ⚠️ **Black with a per-vertex ALPHA, not a texture.** A soft edge is usually
 * a radial texture; `game.browser.spec.ts` §"uploads no texture to the GPU"
 * holds this scene to none, so the fade is a colour attribute of four
 * components — alpha {@link CONTACT_SHADOW_DARKNESS} at the middle, nothing at
 * the rim — which three turns into vertex alphas by itself.
 *
 * Exported for `three-renderer.test.ts`, for {@link RiderBelt}'s reasons.
 */
export class ContactShadowBelt {
  readonly #material = new MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -4,
  });
  readonly #mesh: InstancedMesh;
  /** Reused for every rider on every frame. @see placeContactShadow */
  readonly #shadow: ContactShadow = { x: 0, y: 0, z: 0, yaw: 0, halfAlong: 0, halfAcross: 0 };
  readonly #position = new Vector3();
  readonly #turn = new Quaternion();
  readonly #stretch = new Vector3();
  readonly #matrix = new Matrix4();
  readonly #up = new Vector3(0, 1, 0);
  #shown = true;

  constructor() {
    this.#mesh = new InstancedMesh(contactShadowGeometry(), this.#material, RIDDEN_KINDS.length);
    this.#mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.#mesh.count = 0;
    // For `RiderBelt`'s reason: every rider is within metres of the camera.
    this.#mesh.frustumCulled = false;
    this.#mesh.visible = false;
  }

  addTo(scene: Scene): void {
    scene.add(this.#mesh);
  }

  /** The one mesh. For `three-renderer.test.ts`. */
  get mesh(): InstancedMesh {
    return this.#mesh;
  }

  /**
   * Whether the blobs are drawn at all — `'contact'` rungs only. On the
   * `'map'` rung the shadow map draws the real shape instead, and a blob under
   * it would darken the same road twice. @see QualitySettings.riderShadows
   */
  setShown(on: boolean): void {
    this.#shown = on;
    if (!on) {
      this.#mesh.count = 0;
      this.#mesh.visible = false;
    }
  }

  /** One blob per rider who casts one, under this frame's sun. Allocates nothing. */
  place(markers: readonly RiderMarker[], sun: SunStyle): void {
    if (!this.#shown) {
      return;
    }
    let slot = 0;
    for (const marker of markers) {
      if (slot >= RIDDEN_KINDS.length) {
        break;
      }
      if (!placeContactShadow(marker, sun, this.#shadow)) {
        continue;
      }
      const shadow = this.#shadow;
      this.#position.set(shadow.x, shadow.y, shadow.z);
      this.#turn.setFromAxisAngle(this.#up, shadow.yaw);
      this.#stretch.set(shadow.halfAcross, 1, shadow.halfAlong);
      this.#mesh.setMatrixAt(slot, this.#matrix.compose(this.#position, this.#turn, this.#stretch));
      slot += 1;
    }
    this.#mesh.count = slot;
    this.#mesh.instanceMatrix.needsUpdate = true;
    this.#mesh.visible = slot > 0;
  }

  dispose(): void {
    this.#mesh.geometry.dispose();
    this.#mesh.dispose();
    this.#material.dispose();
  }
}

/** How many points round the blob's rim: enough that 24 edges read as an ellipse. */
const CONTACT_SHADOW_SEGMENTS = 24;

/** How far out, as a share of the rim, the blob keeps most of its darkness. */
const CONTACT_SHADOW_CORE = 0.45;

/**
 * A unit disc lying in the ground plane, facing up: black, alpha
 * {@link CONTACT_SHADOW_DARKNESS} at the middle, 80 % of that at
 * {@link CONTACT_SHADOW_CORE} of the way out, and nothing at the rim.
 *
 * ⚠️ **Wound to face +Y**, because the material culls back faces and a disc
 * wound the other way is invisible from above — which is every camera this
 * program has. `three-renderer.test.ts` computes the normal rather than
 * trusting this sentence.
 */
function contactShadowGeometry(): BufferGeometry {
  const rings = [
    { radius: CONTACT_SHADOW_CORE, alpha: CONTACT_SHADOW_DARKNESS * 0.8 },
    { radius: 1, alpha: 0 },
  ];
  const vertexCount = 1 + rings.length * CONTACT_SHADOW_SEGMENTS;
  const positions = new Float32Array(vertexCount * 3);
  const colours = new Float32Array(vertexCount * 4);
  colours[3] = CONTACT_SHADOW_DARKNESS;
  rings.forEach((ring, index) => {
    for (let step = 0; step < CONTACT_SHADOW_SEGMENTS; step += 1) {
      const angle = (step / CONTACT_SHADOW_SEGMENTS) * Math.PI * 2;
      const at = 1 + index * CONTACT_SHADOW_SEGMENTS + step;
      positions[at * 3] = Math.cos(angle) * ring.radius;
      positions[at * 3 + 2] = Math.sin(angle) * ring.radius;
      colours[at * 4 + 3] = ring.alpha;
    }
  });
  const indices: number[] = [];
  const ringAt = (ring: number, step: number): number =>
    1 + ring * CONTACT_SHADOW_SEGMENTS + (step % CONTACT_SHADOW_SEGMENTS);
  for (let step = 0; step < CONTACT_SHADOW_SEGMENTS; step += 1) {
    // (centre, next, this) faces +Y — see the note above.
    indices.push(0, ringAt(0, step + 1), ringAt(0, step));
    indices.push(ringAt(0, step), ringAt(0, step + 1), ringAt(1, step + 1));
    indices.push(ringAt(0, step), ringAt(1, step + 1), ringAt(1, step));
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('color', new BufferAttribute(colours, 4));
  geometry.setIndex(indices);
  return geometry;
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
    case 'bend':
      // ⚠️ `rotateZ(start)` is applied to the geometry HERE, before the part's
      // own X→Y→Z rotations — which is exactly what `RiderSolid.bend` says it
      // is for. Folding it into the part's `roll` would apply it last, after
      // the yaw that stands the arc up, and spin the bar out of the bicycle's
      // plane entirely.
      return new TorusGeometry(solid.radius, solid.thickness, 5, 12, solid.sweep).rotateZ(
        solid.start,
      );
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
 * The realistic world's pair — ADR 0026 D-10: a physically based material the
 * environment map lights, on everything the realistic world still draws as a
 * primitive (the posts and the bridges; the structures are
 * {@link RealisticStructureBelts}' since layer 3, #475). The same
 * vertex colours; matte, as painted wood, render and stone are.
 *
 * ⚠️ Constructed here and registered, so D-11's assertion covers it.
 */
function physicalMaterials(): ShadedMaterials {
  return {
    lit: constructed(
      new MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 }),
    ),
    flat: constructed(new MeshBasicMaterial({ vertexColors: true })),
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

/**
 * The ground beside the road — #458. One mesh, one draw call, rebuilt from
 * `landform.ts` every frame the way the road is.
 *
 * ## ⚠️ Lit, and writing depth — the two decisions #458 asks to be recorded
 *
 * The flat quad this replaces was a `MeshBasicMaterial` that wrote no depth
 * and drew first: a **backdrop**. Both halves were right for a horizontal
 * plane and both are wrong for a landform.
 *
 * - **Lit**, because an unlit slope reads flat — which is the defect itself.
 *   `world.ts` solves its two intensities so a horizontal surface receives
 *   exactly 1, so a level field is drawn at exactly the colour the quad was,
 *   and only a hillside changes: its sunward face brighter, its far face
 *   darker. `landform.ts` supplies the normals, from the grid.
 * - **Writing depth**, because a hillside must hide what is behind it: a
 *   pacer over the crest, a tree beyond a rise. A backdrop that is drawn under
 *   everything whatever its height cannot. What that costs is the reason the
 *   quad did not: the road now depth-tests against the ground, so the two are
 *   built to share their edge exactly (`landform.ts` §"The innermost column IS
 *   the road's edge") rather than one sitting a quarter of a metre under the
 *   other everywhere.
 *
 * The contact shadows and the shadow catcher are unaffected: both are drawn
 * on the road, over it, with no depth write of their own.
 *
 * ## What a quality rung takes from it
 *
 * Bands of ground, outermost first — {@link setBands}. The vertices are
 * uploaded whole whatever the rung and the draw range stops short, because a
 * rung that moved vertices would move the ground under the scenery; what the
 * rung saves is the fill of the far ground, which is most of this mesh's
 * fragments and is already fogged by the time a rider could see it.
 *
 * Exported for `three-renderer.test.ts`, for {@link ScatterBelt}'s reasons.
 */
export class TerrainBelt {
  readonly #geometry = new BufferGeometry();
  /** How long this route's fields are, for the patchwork — #425. @see TerrainMesh.fieldSpan */
  readonly #fieldSpan = { value: 90 };
  /** How many fields a lap has, which the patchwork wraps by — #468 review B3. @see TerrainMesh.fieldCount */
  readonly #fieldCount = { value: 1 };
  readonly #materials = {
    lit: withSurfaceDetail(
      new MeshLambertMaterial({ color: UNSET_COLOUR, vertexColors: true }),
      'ground',
      this.#fieldSpan,
      this.#fieldCount,
    ),
    flat: withSurfaceDetail(
      new MeshBasicMaterial({ color: UNSET_COLOUR, vertexColors: true }),
      'ground',
      this.#fieldSpan,
      this.#fieldCount,
    ),
  };
  readonly #mesh: Mesh;
  #shading: QualitySettings['shading'] = 'lit';
  #photographic: MeshStandardMaterial | undefined;
  #vertexCapacity = 0;
  #indexCapacity = 0;
  #bands = TERRAIN_BANDS;
  #indicesPerBand = 0;
  #indexCount = 0;
  /**
   * The index list last uploaded. `landform.ts` §`terrainIndices` lends the
   * SAME array for every frame of one row count, so a frame that hands it
   * back again needs no upload — 6 624 indices sent to the GPU sixty times a
   * second for nothing, which #468's review noted.
   */
  #uploadedIndices: Uint32Array | undefined;

  constructor() {
    this.#mesh = new Mesh(this.#geometry, this.#materials.lit);
    // For the road's reason: rebuilt in world coordinates every frame, always
    // under the camera, and one mesh — a cull could only ever lose it.
    this.#mesh.frustumCulled = false;
  }

  addTo(scene: Scene): void {
    scene.add(this.#mesh);
  }

  /** The one mesh. For `three-renderer.test.ts`. */
  get mesh(): Mesh {
    return this.#mesh;
  }

  /** @see QualitySettings.shading */
  setShading(shading: QualitySettings['shading']): void {
    this.#shading = shading;
    this.#mount();
  }

  /**
   * The realistic world's photographic ground, or back to the stylised pair —
   * ADR 0026 D-10. The same mesh and the same buffers either way, so the ground
   * under a tree is the same ground in both worlds; only the material changes.
   */
  setPhotographic(material: MeshStandardMaterial | undefined): void {
    this.#photographic = material;
    this.#mount();
  }

  /** The field span and count the photographic ground's patchwork reads. */
  get fields(): { readonly span: { value: number }; readonly count: { value: number } } {
    return { span: this.#fieldSpan, count: this.#fieldCount };
  }

  /** The surface detail, on or off — #425. @see QualitySettings.surfaceDetail */
  setSurfaceDetail(on: boolean): void {
    setSurfaceDetail(this.#materials.lit, on);
    setSurfaceDetail(this.#materials.flat, on);
  }

  #mount(): void {
    this.#mesh.material = this.#photographic ?? this.#materials[this.#shading];
  }

  /** How many bands of ground this rung draws, innermost first. @see QualitySettings.terrainBands */
  setBands(bands: number): void {
    this.#bands = Math.max(1, Math.min(TERRAIN_BANDS, Math.floor(bands)));
    this.#applyRange();
  }

  /**
   * This frame's ground, in the world's ground colour. Grows its buffers and
   * never shrinks them, for the road's reason (#240's NFR-3).
   */
  update(ground: TerrainMesh, groundColour: number): void {
    // ⚠️ #469: the mesh's arrays are lent, and a later build has written over
    // them. Drawing it would draw that build's ground under this frame's road
    // — silently, and only in a caller that holds two frames, which is every
    // test that compares a lap with the next. A throw is what makes that a
    // finding rather than a wrong picture. @see TerrainMesh.lease
    if (!terrainMeshIsCurrent(ground)) {
      throw new Error(
        'this terrain mesh was built before the latest terrainCorridor, which has reused its buffers; take a retainedFrame to hold two frames at once',
      );
    }
    this.#materials.lit.color.setHex(groundColour);
    this.#materials.flat.color.setHex(groundColour);
    this.#photographic?.color.setHex(groundColour);
    if (ground.vertices.length > this.#vertexCapacity) {
      this.#vertexCapacity = ground.vertices.length;
      for (const [name, size] of [
        ['position', 3],
        ['normal', 3],
        ['color', 3],
        // #425: where on the route each vertex stands, for the patchwork.
        ['fields', 2],
      ] as const) {
        this.#geometry.setAttribute(
          name,
          new BufferAttribute(new Float32Array((this.#vertexCapacity / 3) * size), size),
        );
      }
    }
    if (ground.indices.length > this.#indexCapacity) {
      this.#indexCapacity = ground.indices.length;
      this.#geometry.setIndex(new BufferAttribute(new Uint32Array(this.#indexCapacity), 1));
      this.#uploadedIndices = undefined;
    }
    upload(this.#geometry.getAttribute('position') as BufferAttribute, ground.vertices);
    upload(this.#geometry.getAttribute('normal') as BufferAttribute, ground.normals);
    upload(this.#geometry.getAttribute('color') as BufferAttribute, ground.colours);
    upload(this.#geometry.getAttribute('fields') as BufferAttribute, ground.fields);
    if (ground.indices !== this.#uploadedIndices) {
      upload(this.#geometry.getIndex() as BufferAttribute, ground.indices);
      this.#uploadedIndices = ground.indices;
    }
    this.#fieldSpan.value = ground.fieldSpan;
    this.#fieldCount.value = ground.fieldCount;
    this.#indicesPerBand = ground.indicesPerBand;
    this.#indexCount = ground.indices.length;
    this.#applyRange();
  }

  dispose(): void {
    this.#geometry.dispose();
    this.#materials.lit.dispose();
    this.#materials.flat.dispose();
  }

  /** Draw only the bands this rung allows, and only triangles this frame has. */
  #applyRange(): void {
    this.#geometry.setDrawRange(0, Math.min(this.#indexCount, this.#bands * this.#indicesPerBand));
  }
}

/**
 * The hills on the horizon — #458's "distant relief silhouette". One ring of
 * {@link HORIZON_SEGMENTS} quads round the camera, one draw call.
 *
 * ⚠️ **Unfogged, and hazed by its own vertex colours instead.** At
 * {@link HORIZON_RADIUS_METRES} `FogExp2` would take the whole ring into the
 * horizon colour and it would be invisible, which is a draw call for nothing.
 * So its FOOT is the horizon colour exactly — where the corridor's own ground
 * ends it is already that colour, fogged, and the two meet without a seam —
 * and its ridge is a little of the ground colour, which is what distance
 * leaves of a hill.
 *
 * ⚠️ **A backdrop, and it is the only one left**: no depth write, drawn first,
 * so everything nearer is drawn over it whatever its height. It reaches down to
 * {@link HorizonRelief.base}, far below the route, so a ray that passes over
 * the edge of the corridor's ground meets hazed hillside rather than sky.
 */
export class HorizonRing {
  readonly #geometry = new BufferGeometry();
  readonly #material = new MeshBasicMaterial({
    vertexColors: true,
    fog: false,
    depthWrite: false,
    side: DoubleSide,
  });
  readonly #mesh: Mesh;
  readonly #positions = new Float32Array((HORIZON_SEGMENTS + 1) * 3 * 3);
  readonly #colours = new Float32Array((HORIZON_SEGMENTS + 1) * 3 * 3);
  readonly #haze = new Color();
  readonly #horizon = new Color();
  /** The relief the positions were last built for, so a frame that did not change it costs nothing. */
  #built: HorizonRelief | undefined;

  constructor() {
    this.#geometry.setAttribute('position', new BufferAttribute(this.#positions, 3));
    this.#geometry.setAttribute('color', new BufferAttribute(this.#colours, 3));
    const indices: number[] = [];
    for (let segment = 0; segment < HORIZON_SEGMENTS; segment += 1) {
      for (let band = 0; band < 2; band += 1) {
        const a = segment * 3 + band;
        const b = a + 3;
        indices.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
    this.#geometry.setIndex(indices);
    this.#mesh = new Mesh(this.#geometry, this.#material);
    this.#mesh.frustumCulled = false;
    this.#mesh.renderOrder = -2;
  }

  addTo(scene: Scene): void {
    scene.add(this.#mesh);
  }

  /** The one mesh. For `three-renderer.test.ts`. */
  get mesh(): Mesh {
    return this.#mesh;
  }

  /** Centres the ring on the camera, and colours it from this frame's world. */
  update(relief: HorizonRelief, world: WorldStyle, pose: CameraPose): void {
    if (this.#built !== relief) {
      this.#built = relief;
      for (let segment = 0; segment <= HORIZON_SEGMENTS; segment += 1) {
        const angle = (segment / HORIZON_SEGMENTS) * Math.PI * 2;
        const x = Math.cos(angle) * HORIZON_RADIUS_METRES;
        const z = Math.sin(angle) * HORIZON_RADIUS_METRES;
        const top = relief.tops[segment % HORIZON_SEGMENTS] as number;
        const heights = [relief.base, relief.foot, top];
        for (let row = 0; row < 3; row += 1) {
          const at = (segment * 3 + row) * 3;
          this.#positions[at] = x;
          this.#positions[at + 1] = heights[row] as number;
          this.#positions[at + 2] = z;
        }
      }
      (this.#geometry.getAttribute('position') as BufferAttribute).needsUpdate = true;
    }
    this.#horizon.setHex(world.horizonColour);
    this.#haze.setHex(world.groundColour).lerp(this.#horizon, HORIZON_HAZE_SHARE);
    for (let segment = 0; segment <= HORIZON_SEGMENTS; segment += 1) {
      for (let row = 0; row < 3; row += 1) {
        const colour = row === 2 ? this.#haze : this.#horizon;
        const at = (segment * 3 + row) * 3;
        this.#colours[at] = colour.r;
        this.#colours[at + 1] = colour.g;
        this.#colours[at + 2] = colour.b;
      }
    }
    (this.#geometry.getAttribute('color') as BufferAttribute).needsUpdate = true;
    // Only the ground plane's position follows the camera; the heights are the
    // route's, so a rider who climbs rises past the hills rather than with them.
    this.#mesh.position.set(pose.x, 0, pose.z);
  }

  dispose(): void {
    this.#geometry.dispose();
    this.#material.dispose();
  }
}

/**
 * How much of the horizon colour the distant ridge carries: **0.7** — so 30 %
 * of the ground colour is what is left of a hill 1.1 km away. This
 * repository's own choice, by eye, against the 95 % `world.ts` fogs the
 * corridor's own far end by.
 */
const HORIZON_HAZE_SHARE = 0.7;

/**
 * The procedural surface detail — #425's half that needs no asset.
 *
 * ## What it is, and what it is not
 *
 * A grain on the tarmac and a mottle on the ground, from two octaves of value
 * noise over the fragment's own WORLD position, and on the ground a patchwork
 * of fields on the grid the walls stand on (`landform.ts` §`fieldSpanMetres`,
 * `settlements.ts` §`fieldEdgesAt`). Computed in the fragment shader from
 * numbers: **no texture is sampled**, so #366's "no texture reaches the GPU"
 * holds, ADR 0022's posture is unchanged and no amendment is owed. The
 * photographic surfaces #425 also asks for wait for
 * [#431](https://github.com/openzigs/onyourleft/issues/431).
 *
 * ⚠️ **It fades out with distance**, 12 m to 45 m on the road and 20 m to 90 m
 * on the ground, because noise sampled at a grazing angle aliases — the
 * shimmer #425 warns #424's low camera makes worse. A texture would have
 * mipmaps to do this; arithmetic has to do it by hand.
 *
 * ⚠️ **The road's grain is bounded by `terrain.ts` §`ROAD_SURFACE_GRAIN`** and
 * multiplies the gradient tint rather than replacing it: the colour is how a
 * rider reads the climb ahead, and `terrain.test.ts` holds the worst case of
 * the two together to `MINIMUM_TINT_CONTRAST_RATIO`.
 *
 * Injected into three's own materials with `onBeforeCompile`, behind a define
 * a quality rung switches (`QualitySettings.surfaceDetail`), so the road is
 * still one material and one draw call.
 */
const DETAIL_COMMON = /* glsl */ `
float oylHash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float oylNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(oylHash(i), oylHash(i + vec2(1.0, 0.0)), u.x),
    mix(oylHash(i + vec2(0.0, 1.0)), oylHash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}
`;

/** What the road's fragment does with the grain, behind the define. */
const ROAD_DETAIL = /* glsl */ `
#ifdef SURFACE_DETAIL
{
  float fade = 1.0 - smoothstep(12.0, 45.0, distance(cameraPosition, vDetailWorld));
  float grain = (oylNoise(vDetailWorld.xz * 5.3) - 0.5) * 1.4
    + (oylNoise(vDetailWorld.xz * 1.1) - 0.5) * 1.0
    + (oylNoise(vDetailWorld.xz * 0.21) - 0.5) * 0.8;
  diffuseColor.rgb *= 1.0 + ${String(ROAD_SURFACE_GRAIN)} * clamp(grain, -1.0, 1.0) * fade;
}
#endif
`;

/**
 * What the ground's fragment does: the mottle, and the patchwork of fields
 * beyond the verge — some cropped and yellower, some pasture, some darker —
 * one colour a field, hashed from which field it is.
 */
const GROUND_DETAIL = /* glsl */ `
#ifdef SURFACE_DETAIL
{
  float fade = 1.0 - smoothstep(20.0, 90.0, distance(cameraPosition, vDetailWorld));
  float mottle = (oylNoise(vDetailWorld.xz * 0.9) - 0.5) * 0.12
    + (oylNoise(vDetailWorld.xz * 0.11) - 0.5) * 0.16;
  // Wrapped by the lap's own field count, so lap two's field is lap one's —
  // #468 review B3. Not mod(): its division is not exact on every GPU, and a
  // whole multiple landing a hair under an integer would pick the neighbour.
  float fieldOnLap = floor(vFields.x / fieldSpan);
  float fieldIndex = fieldOnLap - fieldCount * floor((fieldOnLap + 0.5) / fieldCount);
  float fieldSide = vFields.y >= 0.0 ? 1.0 : -1.0;
  float fieldBand = floor(abs(vFields.y) / ${String(FIELD_DEPTH_METRES.toFixed(1))});
  float fieldKind = oylHash(vec2(fieldIndex * 1.37 + fieldSide * 17.0, fieldBand * 3.1 + 7.0));
  vec3 crop = vec3(1.18, 1.08, 0.72);
  vec3 pasture = vec3(1.0);
  vec3 fallow = vec3(0.86, 0.9, 0.84);
  vec3 fieldTone = fieldKind < 0.35 ? crop : (fieldKind < 0.75 ? pasture : fallow);
  float farmland = smoothstep(${String(FIELD_EDGE_LATERAL_METRES.toFixed(1))}, ${String((FIELD_EDGE_LATERAL_METRES + 1.5).toFixed(1))}, abs(vFields.y));
  diffuseColor.rgb *= mix(vec3(1.0), fieldTone, farmland);
  diffuseColor.rgb *= 1.0 + mottle * fade;
}
#endif
`;

/**
 * Teaches one of three's materials the surface detail, behind the
 * `SURFACE_DETAIL` define. @see DETAIL_COMMON
 *
 * ⚠️ `customProgramCacheKey` is what stops three handing a detailed road the
 * program it compiled for a plain material of the same class — the cache key
 * otherwise ignores `onBeforeCompile` entirely.
 */
function withSurfaceDetail<
  M extends MeshBasicMaterial | MeshLambertMaterial | MeshStandardMaterial,
>(
  material: M,
  surface: 'road' | 'ground',
  fieldSpan: { value: number },
  fieldCount: { value: number },
): M {
  material.defines = { ...material.defines };
  // ⚠️ Chained after whatever the material already did before it compiles —
  // since ADR 0026 the photographic ground has its own injection, and this one
  // must add to it rather than replace it.
  const earlier = material.onBeforeCompile.bind(material);
  const earlierKey = material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    earlier(shader, renderer);
    shader.uniforms['fieldSpan'] = fieldSpan;
    shader.uniforms['fieldCount'] = fieldCount;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>\nvarying vec3 vDetailWorld;\n${
          surface === 'ground' ? 'attribute vec2 fields;\nvarying vec2 vFields;\n' : ''
        }`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>\nvDetailWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;\n${
          surface === 'ground' ? 'vFields = fields;\n' : ''
        }`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>\nvarying vec3 vDetailWorld;\n${
          surface === 'ground'
            ? 'varying vec2 vFields;\nuniform float fieldSpan;\nuniform float fieldCount;\n'
            : ''
        }${DETAIL_COMMON}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>\n${surface === 'ground' ? GROUND_DETAIL : ROAD_DETAIL}`,
      );
  };
  material.customProgramCacheKey = () => `${earlierKey}|oyl-surface-detail-${surface}`;
  return material;
}

/** Switches a material's surface detail on or off, compiling it again once. */
function setSurfaceDetail(material: Material, on: boolean): void {
  const defines = { ...(material.defines ?? {}) };
  if (on === Object.hasOwn(defines, 'SURFACE_DETAIL')) {
    return;
  }
  if (on) {
    defines['SURFACE_DETAIL'] = '';
  } else {
    delete defines['SURFACE_DETAIL'];
  }
  material.defines = defines;
  material.needsUpdate = true;
}

/**
 * The sky — #425: a vertical gradient from the route's own sky colour
 * overhead to its haze at the horizon, where it used to be one flat colour.
 *
 * A sphere round the camera, unfogged, drawn first and writing no depth, whose
 * vertex colours are worked out from the height of each vertex. **No HDRI and
 * no texture**: the two colours are `world.ts`'s, so the sky is still a
 * function of the route. The expensive version — an HDRI skybox — waits for
 * [#431](https://github.com/openzigs/onyourleft/issues/431).
 *
 * Exported for `three-renderer.test.ts`, for {@link ScatterBelt}'s reasons.
 */
export class SkyDome {
  readonly #geometry = new SphereGeometry(SKY_DOME_RADIUS_METRES, 24, 16);
  readonly #material = new MeshBasicMaterial({
    vertexColors: true,
    fog: false,
    depthWrite: false,
    side: BackSide,
  });
  readonly #mesh: Mesh;
  readonly #sky = new Color();
  readonly #haze = new Color();
  readonly #mixed = new Color();
  /** The two colours last painted, so a frame whose world has not changed costs nothing. */
  #painted = '';

  constructor() {
    const count = this.#geometry.getAttribute('position').count;
    this.#geometry.setAttribute('color', new BufferAttribute(new Float32Array(count * 3), 3));
    this.#mesh = new Mesh(this.#geometry, this.#material);
    this.#mesh.frustumCulled = false;
    this.#mesh.renderOrder = -3;
  }

  addTo(scene: Scene): void {
    scene.add(this.#mesh);
  }

  /** The one mesh. For `three-renderer.test.ts`. */
  get mesh(): Mesh {
    return this.#mesh;
  }

  /** Paints the gradient from this frame's world, and centres it on the eye. */
  update(
    world: WorldStyle,
    eye: { readonly x: number; readonly y: number; readonly z: number },
  ): void {
    this.#mesh.position.set(eye.x, eye.y, eye.z);
    const key = `${String(world.skyColour)}/${String(world.horizonColour)}`;
    if (key === this.#painted) {
      return;
    }
    this.#painted = key;
    this.#sky.setHex(world.skyColour);
    this.#haze.setHex(world.horizonColour);
    const positions = this.#geometry.getAttribute('position') as BufferAttribute;
    const colours = this.#geometry.getAttribute('color') as BufferAttribute;
    for (let vertex = 0; vertex < positions.count; vertex += 1) {
      this.#mixed
        .copy(this.#haze)
        .lerp(this.#sky, skyShare(positions.getY(vertex) / SKY_DOME_RADIUS_METRES));
      colours.setXYZ(vertex, this.#mixed.r, this.#mixed.g, this.#mixed.b);
    }
    colours.needsUpdate = true;
  }

  dispose(): void {
    this.#geometry.dispose();
    this.#material.dispose();
  }
}

/** How far out the sky is drawn, in metres: inside the camera's 2 000 m far plane. */
const SKY_DOME_RADIUS_METRES = 1_800;

/**
 * How much of the sky's own colour, rather than the haze, a direction at
 * height `rise` (the sine of its elevation) is painted: none at and below the
 * horizon, all of it by about 30° up, easing between.
 */
export function skyShare(rise: number): number {
  const t = Math.min(1, Math.max(0, rise / SKY_GRADIENT_RISE));
  return Math.pow(t * t * (3 - 2 * t), SKY_GRADIENT_EASE);
}

/**
 * The sine of the elevation by which the sky has reached its own colour:
 * **0.5**, which is 30° up — the top of a chase camera's frame.
 */
export const SKY_GRADIENT_RISE = 0.5;

/** How quickly the haze gives way near the horizon: **0.7**, a little faster than even. */
const SKY_GRADIENT_EASE = 0.7;

/**
 * The water shader — #459. Vertex half: world position and the shore weight,
 * and three's own fog chunk.
 */
const WATER_VERTEX = /* glsl */ `
attribute float shore;
varying vec3 vWorld;
varying float vShore;
#include <fog_pars_vertex>
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  vShore = shore;
  vec4 mvPosition = viewMatrix * world;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

/**
 * Over what change of a ripple's phase between neighbouring pixels its normal
 * fades out, in radians a pixel: from **0.5** to **1.5** — #501.
 *
 * ⚠️ **The ripples are band-limited, by hand.** An analytic normal has no
 * mipmaps: at a grazing angle one pixel spans several ripples, the normal
 * sampled at each pixel's centre is effectively random, and on the owner's
 * tablet at 2560×1600 the stream read as *"fine horizontal banding … a stripe
 * pattern parallel to the road"* (validation 0002 Z10). `fwidth` of the phase
 * is how far a ripple turns across one pixel; past about π it is aliasing
 * rather than a ripple (Nyquist), and `fwidth` sums two axes, so the fade is
 * complete by 1.5 and starts at a third of that. The water there is its
 * Fresnel reflection of the sky and nothing else, which is what a lake a
 * hundred metres off looks like anyway. `game.browser.spec.ts` §"the water's
 * ripples are band-limited" reads the banding back with the fade off.
 */
export const RIPPLE_FADE_RADIANS_PER_PIXEL: readonly [number, number] = [0.5, 1.5];

/**
 * The water shader's fragment half: the sky reflected with a Fresnel term,
 * ripples as an analytic normal that scrolls with the ride's clock, and the
 * edges tinted shallow by the geometry's own shore weight.
 *
 * ⚠️ **No texture, and no second pass.** The ripple normal is two travelling
 * waves differentiated by hand, so there is no normal map to fetch — #366's
 * "no texture reaches the GPU" holds — and the reflection is the sky's own two
 * colours along the reflected ray, so there is no planar reflection render.
 * The fog and colour-space chunks are three's, in the order its own
 * `meshbasic` shader uses them.
 */
const WATER_FRAGMENT = /* glsl */ `
uniform vec3 skyColour;
uniform vec3 horizonColour;
uniform vec3 deepColour;
uniform vec3 shallowColour;
uniform float time;
uniform float rippleFilter;
varying vec3 vWorld;
varying float vShore;
#include <fog_pars_fragment>
float oylRippleWeight(float phase) {
  float fade = 1.0 - smoothstep(${RIPPLE_FADE_RADIANS_PER_PIXEL[0].toFixed(2)}, ${RIPPLE_FADE_RADIANS_PER_PIXEL[1].toFixed(2)}, fwidth(phase));
  return mix(1.0, fade, rippleFilter);
}
void main() {
  vec2 p = vWorld.xz;
  vec2 d1 = vec2(0.83, 0.56);
  vec2 d2 = vec2(-0.47, 0.88);
  float a1 = dot(p, d1) * 1.7 + time * 1.3;
  float a2 = dot(p, d2) * 2.9 - time * 1.9;
  vec2 slope = 0.06 * oylRippleWeight(a1) * cos(a1) * d1
    + 0.058 * oylRippleWeight(a2) * cos(a2) * d2;
  vec3 n = normalize(vec3(-slope.x, 1.0, -slope.y));
  vec3 v = normalize(cameraPosition - vWorld);
  float facing = clamp(dot(n, v), 0.0, 1.0);
  float fresnel = 0.02 + 0.98 * pow(1.0 - facing, 5.0);
  vec3 r = reflect(-v, n);
  vec3 sky = mix(horizonColour, skyColour, smoothstep(0.0, 0.4, r.y));
  vec3 body = mix(shallowColour, deepColour, smoothstep(0.0, 1.0, vShore));
  gl_FragColor = vec4(mix(body, sky, fresnel), 1.0);
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

/** Relative luminance of a colour in the linear working space, Rec. 709. */
function linearLuminance(colour: Color): number {
  return 0.2126 * colour.r + 0.7152 * colour.g + 0.0722 * colour.b;
}

/** Open water, where it is deep. This repository's own, a dark blue-green. */
const WATER_DEEP_COLOUR = 0x1d4a55;

/** Water at its edge, over the bed: lighter, and greener. This repository's own. */
const WATER_SHALLOW_COLOUR = 0x557a68;

/**
 * The water — #459. One mesh for every stream and lake in view, one draw call,
 * rebuilt from `waterways.ts` every frame the way the road is.
 *
 * Exported for `three-renderer.test.ts`, for {@link ScatterBelt}'s reasons.
 */
export class WaterBelt {
  readonly #geometry = new BufferGeometry();
  readonly #shaded = new ShaderMaterial({
    vertexShader: WATER_VERTEX,
    fragmentShader: WATER_FRAGMENT,
    fog: true,
    // ⚠️ **Both faces.** A stream's strip is laid out across the road and a
    // lake's along it, on either side, so their windings disagree; one-sided,
    // half of them faced the ground and were culled. The first browser run of
    // #459 drew a bridge over a dry trench for exactly that reason.
    side: DoubleSide,
    uniforms: UniformsUtils.merge([
      UniformsLib.fog,
      {
        skyColour: { value: new Color(UNSET_COLOUR) },
        horizonColour: { value: new Color(UNSET_COLOUR) },
        deepColour: { value: new Color(WATER_DEEP_COLOUR) },
        shallowColour: { value: new Color(WATER_SHALLOW_COLOUR) },
        time: { value: 0 },
        rippleFilter: { value: 1 },
      },
    ]),
  });
  readonly #flat = new MeshBasicMaterial({ color: WATER_DEEP_COLOUR, side: DoubleSide });
  readonly #mesh: Mesh;
  #vertexCapacity = 0;
  #indexCapacity = 0;

  constructor() {
    this.#mesh = new Mesh(this.#geometry, this.#shaded);
    // Rebuilt in world coordinates every frame, like the road.
    this.#mesh.frustumCulled = false;
    this.#mesh.visible = false;
  }

  addTo(scene: Scene): void {
    scene.add(this.#mesh);
  }

  /** The one mesh. For `three-renderer.test.ts`. */
  get mesh(): Mesh {
    return this.#mesh;
  }

  /** The sky colour the shaded water reflects, linear RGB. @see waterSkyOf */
  get reflectedSky(): readonly [number, number, number] {
    const sky = (this.#shaded.uniforms as Record<string, { value: Color } | undefined>)['skyColour']
      ?.value;
    return [sky?.r ?? Number.NaN, sky?.g ?? Number.NaN, sky?.b ?? Number.NaN];
  }

  /**
   * Whether the ripples are band-limited — #501. On, always, in the product;
   * off only for the browser gate's control, which has to read the banding
   * back to show that the fade is what removed it. @see filterWaterRipplesOf
   */
  setRippleFilter(on: boolean): void {
    const uniform = (this.#shaded.uniforms as Record<string, { value: number } | undefined>)[
      'rippleFilter'
    ];
    if (uniform !== undefined) uniform.value = on ? 1 : 0;
  }

  /** @see QualitySettings.water */
  setDrawn(drawn: QualitySettings['water']): void {
    this.#mesh.material = drawn === 'shaded' ? this.#shaded : this.#flat;
  }

  /**
   * This frame's water, under this frame's sky, at this frame's time.
   *
   * @param reflection the realistic sky's two bands, when the realistic world
   * is drawn — #475. ⚠️ **The water stays #459's procedural shader on the
   * realistic rungs, and that is argued rather than defaulted**: no source in
   * ADR 0026 D-4's list publishes a water surface (Poly Haven and ambientCG
   * publish none, read 2026-09-22 — ambientCG's nearest is ice), a
   * photograph of water tiled across a lake is a frozen picture of ripples,
   * and every real-time engine draws water as a shader. What was NOT
   * realistic is what it reflected: the stylised sky's two colours, under a
   * photographed one. With a reflection it takes the HDRI's own hue at the
   * brightness #459 was tuned to — `realistic-light.ts` §`reflectedSkyColour`.
   */
  update(
    surface: WaterSurface,
    world: WorldStyle,
    seconds: number,
    reflection?: { readonly zenith: LinearColour; readonly horizon: LinearColour },
  ): void {
    // ⚠️ #469, for {@link TerrainBelt.update}'s reason. @see WaterSurface.lease
    if (!waterSurfaceIsCurrent(surface)) {
      throw new Error(
        'this water surface was built before the latest waterSurface, which has reused its buffers; take a retainedFrame to hold two frames at once',
      );
    }
    const uniforms = this.#shaded.uniforms as Record<string, { value: unknown } | undefined>;
    const sky = uniforms['skyColour']?.value as Color;
    const horizon = uniforms['horizonColour']?.value as Color;
    sky.setHex(world.skyColour);
    horizon.setHex(world.horizonColour);
    if (reflection !== undefined) {
      // In the working (linear) space, where `setHex` has just put the two
      // stylised colours whose brightness the water was tuned against.
      sky.setRGB(...reflectedSkyColour(reflection.zenith, linearLuminance(sky)));
      horizon.setRGB(...reflectedSkyColour(reflection.horizon, linearLuminance(horizon)));
    }
    (uniforms['time'] as { value: number }).value = seconds;
    if (surface.vertices.length > this.#vertexCapacity) {
      this.#vertexCapacity = Math.max(surface.vertices.length, this.#vertexCapacity * 2);
      this.#geometry.setAttribute(
        'position',
        new BufferAttribute(new Float32Array(this.#vertexCapacity), 3),
      );
      this.#geometry.setAttribute(
        'shore',
        new BufferAttribute(new Float32Array(this.#vertexCapacity / 3), 1),
      );
    }
    if (surface.indices.length > this.#indexCapacity) {
      this.#indexCapacity = Math.max(surface.indices.length, this.#indexCapacity * 2);
      this.#geometry.setIndex(new BufferAttribute(new Uint32Array(this.#indexCapacity), 1));
    }
    if (surface.indices.length > 0) {
      upload(this.#geometry.getAttribute('position') as BufferAttribute, surface.vertices);
      upload(this.#geometry.getAttribute('shore') as BufferAttribute, surface.shore);
      upload(this.#geometry.getIndex() as BufferAttribute, surface.indices);
    }
    this.#geometry.setDrawRange(0, surface.indices.length);
    // No water in view is no draw call, not an empty one.
    this.#mesh.visible = surface.indices.length > 0;
  }

  dispose(): void {
    this.#geometry.dispose();
    this.#shaded.dispose();
    this.#flat.dispose();
  }
}

/**
 * The bridges — #459. Every parapet, deck slab and abutment in view is one
 * instance of one box: one draw call however many bridges there are.
 *
 * Exported for `three-renderer.test.ts`, for {@link ScatterBelt}'s reasons.
 */
export class BridgeBelt {
  readonly #materials = vertexColouredMaterials();
  /**
   * The realistic world's bridge when it has no photograph to wear — ADR 0026
   * D-10, and a world a test built without textures. @see physicalMaterials
   */
  readonly #physical = constructed(
    new MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 }),
  );
  /** The realistic world's photographed stone, once it has been handed one — #501. */
  #stone: { readonly maps: StoneMaps; readonly material: MeshStandardMaterial } | undefined;
  #stoneMaps: StoneMaps | undefined;
  #shading: QualitySettings['shading'] = 'lit';
  #world: QualitySettings['world'] = 'stylised';
  readonly #mesh: InstancedMesh;
  readonly #matrix = new Matrix4();
  readonly #along = new Vector3();
  readonly #across = new Vector3();
  readonly #up = new Vector3();
  readonly #vertical = new Vector3(0, 1, 0);

  constructor() {
    const box = new BoxGeometry(1, 1, 1);
    paintEveryVertex(box, BRIDGE_COLOUR);
    this.#mesh = new InstancedMesh(box, this.#materials.lit, MAXIMUM_BRIDGE_PARTS);
    this.#mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.#mesh.count = 0;
    this.#mesh.frustumCulled = false;
    this.#mesh.visible = false;
  }

  addTo(scene: Scene): void {
    scene.add(this.#mesh);
  }

  /** The one mesh. For `three-renderer.test.ts`. */
  get mesh(): InstancedMesh {
    return this.#mesh;
  }

  /** @see QualitySettings.shading */
  setShading(shading: QualitySettings['shading']): void {
    this.#shading = shading;
    this.#mount();
  }

  /**
   * Which world's stone the bridges are — ADR 0026 D-10.
   *
   * @param stone the realistic world's photographed stone — #501. Validation
   * 0002 Z10 found the parapets *"plain grey blocks"* on the tablet: the
   * structures wore `old_stone_wall` and the bridge beside them wore nothing.
   * Given it, a realistic rung dresses every block of the bridge in it — the
   * parapets and their copings included — through {@link stoneBridgeMaterial}.
   */
  setWorld(world: QualitySettings['world'], stone?: StoneMaps): void {
    this.#world = world;
    this.#stoneMaps = stone;
    this.#mount();
  }

  #mount(): void {
    if (this.#world !== 'realistic') {
      this.#mesh.material = this.#materials[this.#shading];
      return;
    }
    const maps = this.#stoneMaps;
    if (maps === undefined) {
      this.#mesh.material = this.#physical;
      return;
    }
    if (this.#stone?.maps !== maps) {
      this.#stone?.material.dispose();
      this.#stone = { maps, material: stoneBridgeMaterial(maps) };
    }
    this.#mesh.material = this.#stone.material;
  }

  /**
   * One box a part: `length` along its axis, `width` across it level, and
   * `height` up. Allocates nothing.
   */
  update(parts: readonly BridgePart[]): void {
    const count = Math.min(parts.length, MAXIMUM_BRIDGE_PARTS);
    for (let index = 0; index < count; index += 1) {
      const part = parts[index] as BridgePart;
      this.#along.set(part.axisX, part.axisY, part.axisZ).normalize();
      this.#across.crossVectors(this.#vertical, this.#along).normalize();
      this.#up.crossVectors(this.#along, this.#across).normalize();
      this.#across.multiplyScalar(part.width);
      this.#up.multiplyScalar(part.height);
      this.#along.multiplyScalar(part.length);
      this.#matrix.makeBasis(this.#across, this.#up, this.#along);
      this.#matrix.setPosition(part.x, part.y, part.z);
      this.#mesh.setMatrixAt(index, this.#matrix);
    }
    this.#mesh.count = count;
    this.#mesh.instanceMatrix.needsUpdate = count > 0;
    this.#mesh.visible = count > 0;
  }

  dispose(): void {
    this.#mesh.geometry.dispose();
    this.#mesh.dispose();
    this.#materials.lit.dispose();
    this.#materials.flat.dispose();
    this.#physical.dispose();
    this.#stone?.material.dispose();
  }
}

/** A photographed surface's two maps. @see RealisticWorld.structures */
interface StoneMaps {
  readonly colour: Texture;
  readonly normal: Texture;
}

/**
 * Texture coordinates in metres of the WORLD, projected along the axis each
 * face of an instanced box most nearly faces — #501. `projectedInMetres`'s
 * rule, moved into the vertex shader, because a bridge block is one unit cube
 * stretched by its instance matrix: its own 0-to-1 coordinates would stretch
 * one photograph along a whole parapet, and different blocks by different
 * amounts. In the world's metres a stone is the same size on every block and a
 * course runs on from one block to the next.
 */
const STONE_UV = /* glsl */ `
{
  vec4 oylWorld = vec4(transformed, 1.0);
  vec3 oylFacing = objectNormal;
#ifdef USE_INSTANCING
  oylWorld = instanceMatrix * oylWorld;
  oylFacing = mat3(instanceMatrix) * oylFacing;
#endif
  oylWorld = modelMatrix * oylWorld;
  vec3 oylAxis = abs(oylFacing);
  vec2 oylStone = oylAxis.x >= oylAxis.y && oylAxis.x >= oylAxis.z
    ? oylWorld.zy
    : (oylAxis.y >= oylAxis.z ? oylWorld.xz : oylWorld.xy);
  oylStone /= tileMetres;
#ifdef USE_MAP
  vMapUv = oylStone;
#endif
#ifdef USE_NORMALMAP
  vNormalMapUv = oylStone;
#endif
}
`;

/**
 * The realistic bridge's material: `old_stone_wall`, as the field walls and a
 * church wear it — #501. Constructed here (ADR 0026 D-11), from the world's own
 * textures, with the structures' own finish for stone.
 */
function stoneBridgeMaterial(maps: StoneMaps): MeshStandardMaterial {
  const finish = STRUCTURE_SURFACE_FINISH.stone;
  const material = constructed(
    new MeshStandardMaterial({
      color: finish.tint,
      roughness: finish.roughness,
      metalness: finish.metalness,
      map: maps.colour,
      normalMap: maps.normal,
    }),
  );
  material.onBeforeCompile = (shader) => {
    shader.uniforms['tileMetres'] = { value: REALISTIC_STRUCTURE_SURFACES.stone.tileMetres };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float tileMetres;')
      .replace('#include <project_vertex>', `#include <project_vertex>\n${STONE_UV}`);
  };
  material.customProgramCacheKey = () => 'oyl-stone-bridge';
  return material;
}

/* ============================================================================
 * THE REALISTIC WORLD — ADR 0026, #425, #474, #369
 * ========================================================================== */

/**
 * Every material the realistic path constructs — [ADR 0026](../../../../docs/adr/0026-realistic-game-world.md) D-11.
 *
 * ADR 0022 D-7's end survives its means: *"a `MeshStandardMaterial`
 * constructed by `GLTFLoader` from a glTF's own material block is not in any
 * source file … and would change how the whole scene is shaded without a
 * single gate going red."* The realistic world needs physically based
 * materials and textures, so what it may not have is a LOADER-built one: every
 * material a realistic mesh wears is made by {@link constructed} below, from
 * the textures and factors the file supplies, and the loader's own is disposed
 * at load. Membership here is what `three-renderer.test.ts` and
 * `game.browser.spec.ts` assert on every realistic mesh — a material a future
 * change let through from a loader is not in this set, whatever its class.
 */
const CONSTRUCTED_MATERIALS = new WeakSet<Material>();

/** Registers a material this file made. @see CONSTRUCTED_MATERIALS */
function constructed<M extends Material>(material: M): M {
  CONSTRUCTED_MATERIALS.add(material);
  return material;
}

/**
 * Whether this file constructed a material — ADR 0026 D-11's assertion.
 *
 * @test-facing held by `realistic-renderer.test.ts`, and by the browser gate
 * through `sceneMaterialsOf`; nothing in the render path needs to ask
 */
export function isConstructedMaterial(material: Material): boolean {
  return CONSTRUCTED_MATERIALS.has(material);
}

/** One drawable piece of a realistic shape: a geometry and the material it wears. */
export interface RealisticPart {
  readonly geometry: BufferGeometry;
  readonly material: MeshStandardMaterial;
}

/** A realistic model, ready to instance. */
export interface RealisticShape {
  readonly name: string;
  readonly parts: readonly RealisticPart[];
  /**
   * The full scan's largest extent, in the model's own units — what
   * `sceneryFitMetres` is divided by, so a realistic tree occupies the space
   * its stylised twin did. Read from the file's extras, where the pipeline
   * recorded it before thinning grew any card past it.
   */
  readonly extent: number;
  readonly triangles: number;
  /** The far band's billboard, for a tree. */
  readonly impostor?: { readonly material: ShaderMaterial; readonly texture: Texture };
}

/** The sky: the HDR itself, and what was read off it. @see realistic-light.ts */
interface RealisticSky {
  readonly texture: DataTexture;
  /** The cosine-weighted mean radiance of its upper hemisphere. */
  readonly upward: number;
  /** Where its sun is in the picture, as a horizontal texture coordinate. */
  readonly sunU: number;
  /**
   * The mean radiance of the sky well above the horizon and at it — what the
   * water reflects on the realistic rungs (#475). @see skyBandRadiance
   */
  readonly zenith: LinearColour;
  readonly horizon: LinearColour;
}

/** Everything the realistic world is drawn from, loaded once per tab. */
interface RealisticWorld {
  readonly sky: RealisticSky;
  readonly road: { readonly colour: Texture; readonly normal: Texture };
  readonly ground: { readonly colour: Texture; readonly normal: Texture };
  readonly vegetation: ReadonlyMap<RealisticVegetationKind, readonly RealisticShape[]>;
  /** The structures' photographic surfaces — ADR 0026 D-12 layer 3, #475. */
  readonly structures: ReadonlyMap<
    Exclude<StructureSurface, 'painted'>,
    { readonly colour: Texture; readonly normal: Texture }
  >;
  /** The rider's body, as the loader left it: a scene holding one skinned mesh. */
  readonly body: Object3D;
}

/**
 * The realistic world, or nothing.
 *
 * ⚠️ **Module state, for `sceneryGeometries`' reason**: `GameRenderer.create`
 * is synchronous and loading is not, so the loading is a step a caller runs
 * first and the result is held here. Unlike the stylised models it is loaded
 * ONLY when a caller asks — ADR 0026 D-7: the realistic set is fetched when the
 * rider chooses the realistic world, never on a first visit — and today the
 * callers are the owner's harness page and, since #475, `GameView` for a rider
 * who chose the realistic world (`world-preference.ts`).
 */
let realisticWorld: RealisticWorld | undefined;

/** How the realistic world's files are read. Replaced in tests. */
export interface RealisticLoaders {
  readonly model: (url: string) => Promise<Object3D>;
  readonly texture: (url: string) => Promise<Texture>;
  readonly sky: (url: string) => Promise<DataTexture>;
}

/**
 * What a realistic model file may fetch besides itself: nothing. Every
 * committed realistic GLB embeds its images, which three reads through `blob:`
 * URLs of its own making, so any other URL a file declared would be the
 * network — the posture `scenery-models.ts` §`sceneryResourceUrl` takes for the
 * stylised pack.
 *
 * ⚠️ **No committed file exercises the refusal**, because every realistic GLB
 * embeds its images — so the browser gate cannot see it, and a pipeline change
 * that wrote an external `.png` URI would reach the network with every gate
 * green. That is why it is tested as a function (#478).
 */
export function realisticResourceUrl(own: string): (url: string) => string {
  return (url) =>
    url === own || url.startsWith('blob:') || url.startsWith('data:')
      ? url
      : 'data:application/octet-stream;base64,';
}

const THREE_LOADERS: RealisticLoaders = {
  model: async (url) => {
    const manager = new LoadingManager();
    manager.setURLModifier(realisticResourceUrl(url));
    return (await new GLTFLoader(manager).loadAsync(url)).scene;
  },
  texture: (url) => new TextureLoader().loadAsync(url),
  sky: (url) => new HDRLoader().loadAsync(url),
};

/**
 * Loads the realistic world, all of it or none of it — ADR 0026 D-3, D-7.
 *
 * ⚠️ **All or none.** A world whose trees loaded and whose sky did not would
 * be a half-replaced world, which D-3 exists to refuse; so any failure releases
 * whatever did load and leaves the view drawing the stylised world, and the
 * outcome says why — D-7: *"offline with the realistic world chosen, the game
 * falls back to the stylised world and says so"*. `realistic-assets.ts`
 * §`realisticWorldNotice` is the sentence.
 */
export async function loadRealisticWorld(
  loaders: RealisticLoaders = THREE_LOADERS,
): Promise<RealisticWorldOutcome> {
  // Everything that has been loaded or built so far, so that a failure can
  // release all of it. @see the ⚠️ on settling below
  const loaded: { textures: Texture[]; objects: Object3D[]; shapes: RealisticShape[] } = {
    textures: [],
    objects: [],
    shapes: [],
  };
  const texture = <T extends Texture>(load: () => Promise<T>): Promise<T> =>
    started(load).then((each) => {
      loaded.textures.push(each);
      return each;
    });
  const model = (load: () => Promise<Object3D>): Promise<Object3D> =>
    started(load).then((each) => {
      loaded.objects.push(each);
      return each;
    });
  try {
    const sky = texture(() => loaders.sky(realisticUrl(REALISTIC_SKY)));
    const road = {
      colour: texture(() => loaders.texture(realisticUrl(REALISTIC_SURFACES.road.colour))),
      normal: texture(() => loaders.texture(realisticUrl(REALISTIC_SURFACES.road.normal))),
    };
    const ground = {
      colour: texture(() => loaders.texture(realisticUrl(REALISTIC_SURFACES.ground.colour))),
      normal: texture(() => loaders.texture(realisticUrl(REALISTIC_SURFACES.ground.normal))),
    };
    const rider = model(() => loaders.model(realisticUrl(REALISTIC_RIDER)));
    // #475: the structures' surfaces, loaded with everything else and settled
    // with it — a world whose buildings could not load is half a world.
    const structureMaps = PHOTOGRAPHIC_STRUCTURE_SURFACES.map((surface) => ({
      surface,
      colour: texture(() =>
        loaders.texture(realisticUrl(REALISTIC_STRUCTURE_SURFACES[surface].colour)),
      ),
      normal: texture(() =>
        loaders.texture(realisticUrl(REALISTIC_STRUCTURE_SURFACES[surface].normal)),
      ),
    }));
    const shapes = REALISTIC_VEGETATION_KINDS.map((kind) => ({
      kind,
      models: REALISTIC_VEGETATION[kind].map(({ name, file, impostor }) => ({
        name,
        scene: model(() => loaders.model(realisticUrl(file))),
        strip:
          impostor === undefined
            ? Promise.resolve(undefined)
            : texture(() => loaders.texture(realisticUrl(impostor))),
      })),
    }));
    // ⚠️ **Every load is SETTLED before anything is decided — #478.** This was
    // a `Promise.all`, which rejects on the first failure while every other
    // load carries on: a texture that arrived after the `catch` below had run
    // was kept by nobody and released by nobody, and on a flaky network (#475
    // makes this a rider's path) that is most of the set. So a failure waits
    // for the loads still in flight, and then releases all of them.
    const settled = await Promise.allSettled([
      sky,
      road.colour,
      road.normal,
      ground.colour,
      ground.normal,
      rider,
      ...structureMaps.flatMap((each) => [each.colour, each.normal]),
      ...shapes.flatMap((each) => each.models.flatMap((one) => [one.scene, one.strip])),
    ]);
    for (const outcome of settled) {
      if (outcome.status === 'rejected') throw outcome.reason;
    }
    const vegetation = new Map<RealisticVegetationKind, readonly RealisticShape[]>();
    for (const each of shapes) {
      const prepared: RealisticShape[] = [];
      for (const one of each.models) {
        const shape = prepareRealisticShape(await one.scene, one.name, await one.strip);
        loaded.shapes.push(shape);
        prepared.push(shape);
      }
      vegetation.set(each.kind, prepared);
    }
    const [skyTexture, roadColour, roadNormal, groundColour, groundNormal, body] =
      await Promise.all([sky, road.colour, road.normal, ground.colour, ground.normal, rider]);
    for (const surface of [roadColour, roadNormal, groundColour, groundNormal]) {
      surface.wrapS = RepeatWrapping;
      surface.wrapT = RepeatWrapping;
      surface.minFilter = LinearMipmapLinearFilter;
    }
    roadColour.colorSpace = SRGBColorSpace;
    groundColour.colorSpace = SRGBColorSpace;
    const structures = new Map<
      Exclude<StructureSurface, 'painted'>,
      { readonly colour: Texture; readonly normal: Texture }
    >();
    for (const each of structureMaps) {
      const colour = await each.colour;
      const normal = await each.normal;
      for (const map of [colour, normal]) {
        map.wrapS = RepeatWrapping;
        map.wrapT = RepeatWrapping;
        map.minFilter = LinearMipmapLinearFilter;
      }
      colour.colorSpace = SRGBColorSpace;
      structures.set(each.surface, { colour, normal });
    }
    skyTexture.mapping = EquirectangularReflectionMapping;
    const pixels = skyPixelsOf(skyTexture);
    const skyRead = {
      texture: skyTexture,
      upward: upwardRadiance(pixels),
      sunU: skySunU(pixels),
      // #475. @see WaterBelt.update
      zenith: skyBandRadiance(pixels, WATER_ZENITH_BAND[0], WATER_ZENITH_BAND[1]),
      horizon: skyBandRadiance(pixels, WATER_HORIZON_BAND[0], WATER_HORIZON_BAND[1]),
    };
    // ⚠️ Swapped in only once the new world is whole, and the old one released
    // only after the swap: a reload that failed half-way, or whose release
    // threw, must leave the world a view draws intact — the first version of
    // this released first and lost both, which `realistic-renderer.test.ts`
    // §"never half a world" caught.
    const previous = realisticWorld;
    realisticWorld = {
      sky: skyRead,
      road: { colour: roadColour, normal: roadNormal },
      ground: { colour: groundColour, normal: groundNormal },
      vegetation,
      structures,
      body,
    };
    if (previous !== undefined) {
      try {
        releaseRealisticWorld(previous);
      } catch {
        // A release that fails leaks the old world's memory; it does not make
        // the new world any less loaded, and must not be reported as though it
        // did.
      }
    }
    return { loaded: true };
  } catch (error: unknown) {
    // Each release on its own, so that one that throws does not keep the rest
    // held — the same fixtures that found the swap-order defect have textures
    // that refuse to let go.
    for (const shape of loaded.shapes) attempt(() => releaseRealisticShape(shape));
    for (const each of loaded.textures) attempt(() => each.dispose());
    for (const scene of loaded.objects) attempt(() => releaseLoadedScene(scene));
    return {
      loaded: false,
      offline: typeof navigator !== 'undefined' && navigator.onLine === false,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

/** The load a ride is waiting on, if one is in flight. @see loadRealisticWorldOnce */
let realisticLoading: Promise<RealisticWorldOutcome> | undefined;

/**
 * The realistic world for a RIDE: the one already loaded, or the load already
 * in flight, or a new one — never a second copy. #475's review.
 *
 * ⚠️ **`loadRealisticWorld` REPLACES a loaded world and releases the old one**,
 * which is right for the owner's harness and wrong for a rider: the world is
 * module state that outlives a view, so a second realistic ride in one visit
 * builds a view that is already drawing the loaded world (`#applyWorld`), and a
 * reload would then fetch and decode ~33 MB again, hold two copies while it
 * did, and release the textures, geometries and materials that view was still
 * drawing — and offline it would fail and tell the rider the world is not kept
 * on the device while it sat in memory. So a ride asks through here, and a
 * world that is loaded is answered at once.
 *
 * ⚠️ **A load in flight is JOINED rather than repeated**: a rider who ends a
 * ride and starts another before ~33 MB have arrived would otherwise start a
 * second load whose swap releases the first world under whichever view drew it.
 * A load that FAILED leaves nothing loaded and nothing in flight, so the next
 * ride tries again — which is D-7's fallback being per ride, not per visit.
 *
 * @param loaders the same seam `loadRealisticWorld` takes; only the call that
 *   starts a load uses it, and a call that joins or finds a world ignores it.
 */
export function loadRealisticWorldOnce(
  loaders: RealisticLoaders = THREE_LOADERS,
): Promise<RealisticWorldOutcome> {
  if (realisticWorld !== undefined) {
    return Promise.resolve({ loaded: true });
  }
  realisticLoading ??= loadRealisticWorld(loaders).finally(() => {
    realisticLoading = undefined;
  });
  return realisticLoading;
}

/** A load started, with a loader that throws rather than rejecting turned into a rejection. */
function started<T>(load: () => Promise<T>): Promise<T> {
  try {
    return load();
  } catch (error: unknown) {
    return Promise.reject(error instanceof Error ? error : new Error(String(error)));
  }
}

/** Runs a release, and carries on if it throws: a leak is not a reason to leak more. */
function attempt(release: () => void): void {
  try {
    release();
  } catch {
    // Nothing to do: the object is held by nothing now, and the rest still go.
  }
}

/**
 * Releases one prepared realistic shape: the geometry it cloned, the material
 * it constructed, the textures that material holds, and its impostor's.
 */
function releaseRealisticShape(shape: RealisticShape): void {
  for (const part of shape.parts) {
    part.geometry.dispose();
    part.material.map?.dispose();
    part.material.normalMap?.dispose();
    part.material.dispose();
  }
  shape.impostor?.texture.dispose();
  shape.impostor?.material.dispose();
}

/**
 * Whether a realistic world is loaded and a view could draw it.
 *
 * @test-facing held by `realistic-renderer.test.ts`, which is where "all of it
 * or none of it" is asserted against the module state a view reads
 */
export function realisticWorldLoaded(): boolean {
  return realisticWorld !== undefined;
}

/** Releases a realistic world that another has replaced. */
function releaseRealisticWorld(world: RealisticWorld): void {
  world.sky.texture.dispose();
  for (const texture of [
    world.road.colour,
    world.road.normal,
    world.ground.colour,
    world.ground.normal,
  ]) {
    texture.dispose();
  }
  for (const shapes of world.vegetation.values()) {
    for (const shape of shapes) releaseRealisticShape(shape);
  }
  for (const maps of world.structures.values()) {
    maps.colour.dispose();
    maps.normal.dispose();
  }
  releaseLoadedScene(world.body);
}

/** An HDR texture's texels, as `realistic-light.ts` reads them. */
function skyPixelsOf(texture: DataTexture): SkyPixels {
  const image = texture.image as { width: number; height: number; data: ArrayLike<number> };
  const data = image.data;
  const half = texture.type === HalfFloatType;
  return {
    width: image.width,
    height: image.height,
    channel: (index) => {
      const value = data[index] ?? 0;
      return half ? halfToFloat(value) : value;
    },
  };
}

/**
 * One realistic model, as parts to instance — ADR 0026 D-11.
 *
 * Every mesh's geometry is taken into the model's own frame, and its material
 * is REPLACED: a `MeshStandardMaterial` this file constructs, carrying only the
 * loader's colour factor, colour map and normal map (with the normal scale
 * three's loader chose for a file with no tangents), a constant roughness —
 * the pipeline dropped the roughness maps — and the vertex colours the pipeline
 * baked the ambient occlusion into. Foliage becomes alpha-TESTED rather than
 * blended, so it sorts and instances like anything else; both faces are drawn,
 * because a leaf card has two.
 *
 * The loader's material is disposed here, and its textures survive only
 * because the new material holds them.
 */
export function prepareRealisticShape(
  source: Object3D,
  name: string,
  impostorStrip?: Texture,
): RealisticShape {
  source.updateWorldMatrix(false, true);
  const parts: RealisticPart[] = [];
  let triangles = 0;
  let extras: Readonly<Record<string, unknown>> = {};
  source.traverse((node) => {
    const extra = (node as Partial<{ userData: Record<string, unknown> }>).userData;
    if (extra !== undefined && typeof extra['oyl_scan_height'] === 'number') extras = extra;
    const mesh = node as Partial<Mesh>;
    if (mesh.isMesh !== true || mesh.geometry === undefined) return;
    const loaded = mesh.material;
    if (loaded === undefined || Array.isArray(loaded)) {
      throw new Error(`${name}: a part declares no material, or more than one`);
    }
    const geometry = mesh.geometry.clone().applyMatrix4(node.matrixWorld);
    const factor = loaded as Partial<MeshStandardMaterial>;
    const foliage = loaded.transparent || loaded.alphaTest > 0 || loaded.alphaHash;
    const material = constructed(
      new MeshStandardMaterial({
        color: factor.color?.clone() ?? new Color(0xffffff),
        map: factor.map ?? null,
        normalMap: factor.normalMap ?? null,
        normalScale: factor.normalScale?.clone() ?? new Vector2(1, 1),
        vertexColors: geometry.getAttribute('color') !== undefined,
        roughness: REALISTIC_ROUGHNESS,
        metalness: 0,
        side: DoubleSide,
        alphaTest: foliage ? REALISTIC_ALPHA_CUTOFF : 0,
        transparent: false,
      }),
    );
    loaded.dispose();
    const index = geometry.getIndex();
    triangles += (index?.count ?? geometry.getAttribute('position').count) / 3;
    parts.push({ geometry, material });
  });
  if (parts.length === 0) throw new Error(`${name}: the model holds no mesh`);
  const height = Number(extras['oyl_scan_height']);
  const width = Number(extras['oyl_scan_width']);
  const extent = Math.max(height, width);
  if (!(extent > 0)) throw new Error(`${name}: the file records no scan size`);
  const impostor =
    impostorStrip === undefined
      ? undefined
      : { texture: impostorStrip, material: impostorMaterial(impostorStrip, extras) };
  return { name, parts, extent, triangles, ...(impostor === undefined ? {} : { impostor }) };
}

/**
 * The roughness every realistic surface wears: **0.85**. The pipeline drops
 * the scans' roughness maps (a third of their texture memory, for a term a
 * chase camera barely resolves on foliage and bark), so one figure stands in —
 * matte, as bark, leaves, grass and stone are.
 */
const REALISTIC_ROUGHNESS = 0.85;

/** Where an alpha-tested leaf card is cut: half coverage, glTF's own default for MASK. */
const REALISTIC_ALPHA_CUTOFF = 0.5;

/** A unit quad standing on its bottom edge: x in [−0.5, 0.5], y in [0, 1]. */
function impostorQuad(): BufferGeometry {
  return new PlaneGeometry(1, 1).translate(0, 0.5, 0);
}

/**
 * The far band's material: a billboard that turns about the vertical to face
 * the camera, drawn with whichever of the strip's eight views faces it, sized
 * from the scan the strip was rendered from. Constructed here — D-11 — and
 * alpha-tested so it depth-sorts with the near meshes.
 *
 * ⚠️ **Unlit**: the strip was rendered lit, by the pipeline's own sun. It is
 * fogged, tone mapped and colour-managed exactly as a lit material is, so it
 * fades into the horizon with everything else.
 */
function impostorMaterial(
  strip: Texture,
  extras: Readonly<Record<string, unknown>>,
): ShaderMaterial {
  const frames = Number(extras['oyl_impostor_frames']);
  const ortho = Number(extras['oyl_impostor_scale']);
  const height = Number(extras['oyl_scan_height']);
  if (!(frames > 0) || !(ortho > 0) || !(height > 0)) {
    throw new Error('an impostor strip whose file records no frame count, scale or height');
  }
  strip.colorSpace = SRGBColorSpace;
  const image = strip.image as { width?: number; height?: number } | undefined;
  const frameAspect =
    image?.width !== undefined && image.height !== undefined && image.height > 0
      ? image.width / frames / image.height
      : 0.5;
  const material = new ShaderMaterial({
    uniforms: UniformsUtils.merge([UniformsLib.fog, { strip: { value: null } }]),
    fog: true,
    side: DoubleSide,
    defines: {
      FRAMES: frames.toFixed(1),
      QUAD_W: (ortho * frameAspect).toFixed(5),
      QUAD_H: ortho.toFixed(5),
      // The strip is centred on half the scan's height, so the quad's bottom
      // edge is below the ground by the difference.
      QUAD_BOTTOM: (height / 2 - ortho / 2).toFixed(5),
    },
    vertexShader: /* glsl */ `
      #include <common>
      #include <fog_pars_vertex>
      varying vec2 vStripUv;
      void main() {
        vec3 centre = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        vec3 across = (instanceMatrix * vec4(1.0, 0.0, 0.0, 0.0)).xyz;
        vec3 along = (instanceMatrix * vec4(0.0, 0.0, 1.0, 0.0)).xyz;
        float size = length(across);
        vec3 toCamera = cameraPosition - centre;
        vec2 facing = normalize(toCamera.xz + vec2(1e-5));
        float localX = dot(toCamera.xz, across.xz / size);
        float localZ = dot(toCamera.xz, along.xz / size);
        float frame = mod(floor(atan(localX, localZ) / (2.0 * PI) * FRAMES + 0.5), FRAMES);
        vec3 right = vec3(facing.y, 0.0, -facing.x);
        vec3 world = centre
          + right * position.x * QUAD_W * size
          + vec3(0.0, QUAD_BOTTOM + position.y * QUAD_H, 0.0) * size;
        vStripUv = vec2((frame + uv.x) / FRAMES, uv.y);
        vec4 mvPosition = viewMatrix * vec4(world, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <fog_pars_fragment>
      uniform sampler2D strip;
      varying vec2 vStripUv;
      void main() {
        vec4 texel = texture2D(strip, vStripUv);
        if (texel.a < ${REALISTIC_ALPHA_CUTOFF.toFixed(2)}) discard;
        gl_FragColor = vec4(texel.rgb, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }
    `,
  });
  (material.uniforms['strip'] as { value: Texture | null }).value = strip;
  return constructed(material);
}

/**
 * Whether a scatter item is inside what the rider can see — one test for both
 * worlds' belts, so the realistic world culls exactly what the stylised one
 * does. It was `ScatterBelt`'s private method until ADR 0026 gave it a second
 * caller.
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
function inView(item: ScatterItem, pose: CameraPose): boolean {
  const dx = item.x - pose.x;
  const dz = item.z - pose.z;
  const along = dx * pose.headingX + dz * pose.headingZ;
  if (along > VIEW_AHEAD_METRES || along < -VIEW_BEHIND_METRES) {
    return false;
  }
  const across = dx * pose.headingZ - dz * pose.headingX;
  return Math.abs(across) <= lateralReachMetres(along);
}

/**
 * The realistic world's trees, shrubs and rocks — ADR 0026 D-12 layer 2, #474.
 *
 * ## Where they stand is `scatter.ts`'s, unchanged
 *
 * It is handed the same `SceneFrame.scatter` the stylised belt is, draws the
 * four kinds `realistic-assets.ts` has shapes for, and leaves every other
 * item to the primitives belt beside it. So D-2's *"only what is drawn at a
 * place changes, never the place"* holds by construction, and
 * `arrangement-unchanged.test.ts`' digest cannot move.
 *
 * ## Near meshes by COUNT, far impostors, and what is not drawn
 *
 * For each kind, the `realistic-budget.ts` §`REALISTIC_NEAR_MESHES` items
 * nearest the rider are drawn as meshes — the whole of the frame's triangle
 * budget, whatever the road. Every other TREE is its impostor, a quad drawn
 * from the eight views the pipeline rendered of the full scan; every other
 * shrub and rock is not drawn at all, because a 1.5 m shrub beyond the nearest
 * eight is a handful of pixels the fog is already taking.
 *
 * ⚠️ **Nothing is allocated per frame.** The nearest-N selection is written
 * into typed arrays sized once, and every instanced mesh is built with its
 * capacity in the constructor, as #240's NFR-3 requires of every belt here.
 *
 * Exported for `three-renderer.test.ts`, for {@link ScatterBelt}'s reasons.
 */
export class RealisticVegetationBelt {
  readonly #kinds: VegetationSlot[] = [];
  readonly #quad = impostorQuad();
  readonly #matrix = new Matrix4();
  readonly #position = new Vector3();
  readonly #quaternion = new Quaternion();
  readonly #scale = new Vector3();
  readonly #up = new Vector3(0, 1, 0);
  #shown = true;
  /**
   * The rung's scenery budget — #245's, shared with the primitives belt (#478).
   *
   * Unbounded until a rung says otherwise, for {@link ScatterBelt}'s reason: a
   * belt is a mechanism and a rung is a policy.
   */
  #budget = Number.POSITIVE_INFINITY;
  /** How many items the last frame drew, as meshes or impostors. @see drawnItems */
  #drawn = 0;

  constructor(vegetation: ReadonlyMap<RealisticVegetationKind, readonly RealisticShape[]>) {
    for (const kind of REALISTIC_VEGETATION_KINDS) {
      const shapes = vegetation.get(kind) ?? [];
      const cap = REALISTIC_NEAR_MESHES[kind];
      this.#kinds.push({
        kind,
        shapes,
        near: shapes.map((shape) =>
          shape.parts.map((part) => instanced(part.geometry, part.material, cap)),
        ),
        far: shapes.map((shape) =>
          shape.impostor === undefined
            ? undefined
            : instanced(this.#quad, shape.impostor.material, SCATTER_INSTANCE_CAPACITY),
        ),
        chosen: new Int32Array(cap),
        distances: new Float64Array(cap),
        count: 0,
        fit: sceneryFitMetres(kind),
      });
    }
  }

  /** Every mesh the belt draws with. For the tests and the harness. */
  get meshes(): readonly InstancedMesh[] {
    return this.#kinds.flatMap((each) => [
      ...each.near.flat(),
      ...each.far.filter((mesh): mesh is InstancedMesh => mesh !== undefined),
    ]);
  }

  addTo(scene: Scene): void {
    for (const mesh of this.meshes) scene.add(mesh);
  }

  /** Hides every mesh, for a frame drawn in the stylised world. */
  setShown(on: boolean): void {
    this.#shown = on;
    if (!on) for (const mesh of this.meshes) mesh.visible = false;
  }

  /**
   * The most scenery items one frame may draw, from the quality rung — #478.
   *
   * ⚠️ **It is the SAME number the primitives belt beside it is given, and it
   * counts every kind, not only the four this belt draws.** The rung's budget
   * is for the frame's scenery, and the stylised belt spends it on the first
   * items in the frame's order that are in view, whatever their kind. This belt
   * admits exactly those items too — it stops at the item the budget runs out
   * on, posts and buildings included — and the primitives belt counts the trees
   * it skips, so the two together admit what the stylised belt would, and no
   * more. Until #478 this belt had no budget at all, and the second realistic
   * rung's reduction landed on the posts and never on the trees.
   *
   * What it admits is then drawn by this belt's own rule: the nearest of each
   * kind as meshes, the rest of the trees as impostors, the rest of the shrubs
   * and rocks not at all. So it is a ceiling on what is drawn, never a count of
   * it. Allocates nothing.
   */
  setBudget(items: number): void {
    this.#budget = items;
  }

  /**
   * How many scenery items the last frame drew — as a mesh or as an impostor,
   * one per item however many parts its shape has.
   *
   * @test-facing held by `realistic-renderer.test.ts` and, through
   * `sceneryDrawnOf`, by the browser gate: what a rung's budget is checked
   * against
   */
  get drawnItems(): number {
    return this.#drawn;
  }

  /** This frame's vegetation: the nearest of each kind as meshes, the rest of the trees as impostors. */
  update(items: readonly ScatterItem[], pose: CameraPose): void {
    this.#drawn = 0;
    if (!this.#shown) return;
    for (const each of this.#kinds) {
      each.count = 0;
      for (const meshes of each.near) for (const mesh of meshes) mesh.count = 0;
      for (const mesh of each.far) if (mesh !== undefined) mesh.count = 0;
    }
    // Pass 0: where the budget runs out — the first item in the frame's order,
    // of ANY kind, that the budget has no room for. @see setBudget
    let end = items.length;
    if (Number.isFinite(this.#budget)) {
      let admitted = 0;
      for (let index = 0; index < items.length; index += 1) {
        if (!inView(items[index] as ScatterItem, pose)) continue;
        if (admitted >= this.#budget) {
          end = index;
          break;
        }
        admitted += 1;
      }
    }
    // Pass 1: the nearest N of each kind, by distance from the rider.
    for (let index = 0; index < end; index += 1) {
      const item = items[index] as ScatterItem;
      const each = this.#slotFor(item);
      if (each === undefined || !inView(item, pose)) continue;
      const distance = Math.hypot(item.x - pose.x, item.z - pose.z);
      const cap = each.chosen.length;
      if (each.count === cap && distance >= (each.distances[cap - 1] ?? Infinity)) continue;
      // Insertion into a sorted list of at most `cap`, dropping the worst.
      let at = Math.min(each.count, cap - 1);
      while (at > 0 && (each.distances[at - 1] ?? 0) > distance) {
        each.distances[at] = each.distances[at - 1] ?? 0;
        each.chosen[at] = each.chosen[at - 1] ?? 0;
        at -= 1;
      }
      each.distances[at] = distance;
      each.chosen[at] = index;
      each.count = Math.min(cap, each.count + 1);
    }
    // Pass 2: every item into the mesh or the impostor it is drawn with.
    for (let index = 0; index < end; index += 1) {
      const item = items[index] as ScatterItem;
      const each = this.#slotFor(item);
      if (each === undefined || each.shapes.length === 0 || !inView(item, pose)) continue;
      const variant = variantOf(item.variant, each.shapes.length);
      const shape = each.shapes[variant] as RealisticShape;
      let near = false;
      for (let slot = 0; slot < each.count; slot += 1) {
        if (each.chosen[slot] === index) {
          near = true;
          break;
        }
      }
      const target = near ? undefined : each.far[variant];
      if (!near && target === undefined) continue;
      const size = (each.fit * item.scale) / shape.extent;
      this.#position.set(item.x, item.y, item.z);
      this.#quaternion.setFromAxisAngle(this.#up, item.rotation);
      this.#scale.setScalar(size);
      this.#matrix.compose(this.#position, this.#quaternion, this.#scale);
      if (near) {
        for (const mesh of each.near[variant] ?? []) {
          mesh.setMatrixAt(mesh.count, this.#matrix);
          mesh.count += 1;
        }
        this.#drawn += 1;
      } else if (target !== undefined && target.count < SCATTER_INSTANCE_CAPACITY) {
        target.setMatrixAt(target.count, this.#matrix);
        target.count += 1;
        this.#drawn += 1;
      }
    }
    for (const mesh of this.meshes) {
      if (mesh.count > 0) mesh.instanceMatrix.needsUpdate = true;
      mesh.visible = mesh.count > 0;
    }
  }

  /** Releases the belt's own buffers. The shapes are the loaded world's and outlive it. */
  dispose(): void {
    for (const mesh of this.meshes) mesh.dispose();
    this.#quad.dispose();
  }

  #slotFor(item: ScatterItem): VegetationSlot | undefined {
    if (!isRealisticVegetation(item.kind)) return undefined;
    return this.#kinds.find((each) => each.kind === item.kind);
  }
}

/** One realistic kind's meshes and its nearest-N selection. @see RealisticVegetationBelt */
interface VegetationSlot {
  readonly kind: RealisticVegetationKind;
  readonly shapes: readonly RealisticShape[];
  /** Per shape, one instanced mesh per part. */
  readonly near: readonly (readonly InstancedMesh[])[];
  /** Per shape, its impostor, for a tree. */
  readonly far: readonly (InstancedMesh | undefined)[];
  /** The nearest items' indices and distances, best first. */
  readonly chosen: Int32Array;
  readonly distances: Float64Array;
  count: number;
  readonly fit: number;
}

/** An instanced mesh of a fixed capacity, empty, never frustum-culled. */
function instanced(geometry: BufferGeometry, material: Material, capacity: number): InstancedMesh {
  const mesh = new InstancedMesh(geometry, material, capacity);
  mesh.instanceMatrix.setUsage(DynamicDrawUsage);
  mesh.count = 0;
  mesh.visible = false;
  // For the rider's reason: every near mesh is within metres of the camera,
  // and the impostors' instances are culled by `inView` before they are here.
  mesh.frustumCulled = false;
  return mesh;
}

/** An item's variant folded into however many shapes there are. @see ScatterBelt */
function variantOf(variant: number, shapes: number): number {
  const wanted = Number.isInteger(variant) ? variant : 0;
  return ((wanted % shapes) + shapes) % shapes;
}

/**
 * The road's photographic material — #425, ADR 0026 D-2 and D-10.
 *
 * ## The photograph is a grain, never a colour
 *
 * `terrain.ts` tints the road by signed gradient, with a luminance step
 * `MINIMUM_TINT_CONTRAST_RATIO` holds, and paints its lines in the same
 * vertex buffer (#242): **the road's colour is how a rider reads the climb
 * ahead.** So the asphalt photograph does not colour it. The texel's
 * luminance, divided by the texture's own mean — its smallest mip, one texel
 * that IS the mean — is a grain the vertex tint is multiplied by, clamped to
 * `realistic-light.ts` §`PHOTOGRAPHIC_ROAD_GRAIN`: the procedural grain's own
 * bound, which `terrain.test.ts` already holds against the contrast ratio.
 * The normal map is kept, so the surface has the photograph's relief under the
 * light; the colour map's hue is not.
 *
 * ## Still one mesh and one draw call
 *
 * The same `Mesh` and the same buffers as the stylised road — this material
 * is swapped onto it — so #240's one-call road is one call in both worlds, and
 * `game.browser.spec.ts` counts it. The texture coordinates are the world's own
 * `x` and `z` over a tile size, computed in the vertex shader, so there is no
 * attribute to upload and a road rebuilt every frame cannot swim.
 *
 * ⚠️ **Mipmapped and anisotropic** — `ThreeGameView` sets the anisotropy from
 * the device, capped at {@link REALISTIC_ANISOTROPY} — because #424's low
 * camera looks along the road at a grazing angle, which is exactly where an
 * unfiltered texture shimmers (#425). Whether it does on the tablet is the
 * owner's check, in validation 0002 Part Z; nothing in CI can see shimmer.
 */
function photographicRoadMaterial(colour: Texture, normal: Texture): MeshStandardMaterial {
  const material = constructed(
    new MeshStandardMaterial({
      vertexColors: true,
      map: colour,
      normalMap: normal,
      normalScale: new Vector2(0.6, 0.6),
      roughness: 0.9,
      metalness: 0,
      side: DoubleSide,
    }),
  );
  material.onBeforeCompile = (shader) => {
    shader.uniforms['tileMetres'] = { value: REALISTIC_SURFACES.road.tileMetres };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float tileMetres;')
      .replace('#include <uv_vertex>', `#include <uv_vertex>\n${PLANAR_UV}`);
    shader.fragmentShader = shader.fragmentShader
      // ⚠️ **Every face is lit as facing UP, whichever way it is wound.**
      // `terrain.ts` §`roadIndices` keeps the winding consistent within a lane
      // and says it is not relied on — the stylised road is unlit, so it never
      // was. A lit double-sided material turns a face's normal round when its
      // back is to the camera, so a lane wound the other way drew black: the
      // first photographic road read 0.004 in the browser gate. The normal is
      // the corridor's own up, and the face it is on does not change it.
      .replace(
        '#include <normal_fragment_begin>',
        ShaderChunk.normal_fragment_begin.replace('gl_FrontFacing ? 1.0 : - 1.0', '1.0'),
      )
      // The sheen, scaled at its source: the Fresnel term's reflectance at
      // normal incidence and at grazing, which every specular term three
      // computes is built from. @see ROAD_SHEEN
      .replace(
        '#include <lights_physical_fragment>',
        `#include <lights_physical_fragment>
material.specularColor *= ${ROAD_SHEEN.toFixed(3)};
material.specularColorBlended *= ${ROAD_SHEEN.toFixed(3)};
material.specularF90 *= ${ROAD_SHEEN.toFixed(3)};`,
      )
      .replace(
        '#include <map_fragment>',
        /* glsl */ `
#ifdef USE_MAP
{
  const vec3 oylLuma = vec3(0.2126, 0.7152, 0.0722);
  float oylTexel = dot(texture2D(map, vMapUv).rgb, oylLuma);
  float oylMean = max(dot(textureLod(map, vec2(0.5), 16.0).rgb, oylLuma), 1e-3);
  diffuseColor.rgb *= clamp(oylTexel / oylMean, ${String(1 - PHOTOGRAPHIC_ROAD_GRAIN)}, ${String(1 + PHOTOGRAPHIC_ROAD_GRAIN)});
}
#endif
`,
      );
  };
  material.customProgramCacheKey = () => 'oyl-photographic-road';
  return material;
}

/**
 * How much of its specular reflection the photographic road keeps: **0.25** —
 * set by the measurement below, and the owner's to look at in validation 0002
 * Part Z.
 *
 * ⚠️ **The sheen is what compresses the gradient cue, measured.** A chase
 * camera looks along the road at a grazing angle, where Fresnel reflection
 * tends to one: the sky's reflection is ADDED to every lane, which lifts the
 * dark climb tint far more than the pale descent tint. With the full
 * physically based specular, the steepest climb and the steepest descent read
 * 2.68 : 1 off the browser gate's drawing buffer, under
 * `MINIMUM_TINT_CONTRAST_RATIO`'s 3 — so the photographic road passed every
 * gate here except the one about information. The colour is information and
 * the sheen is not (ADR 0026 D-2), so most of the sheen goes: measured the same
 * way, **4.74 : 1 with none and 3.97 : 1 at a quarter**, which keeps a wet-ish
 * glint at a grazing angle and a margin of about a third over the criterion.
 */
const ROAD_SHEEN = 0.25;

/** World-planar texture coordinates for the colour and normal maps, from `tileMetres`. */
const PLANAR_UV = /* glsl */ `
{
  vec2 oylPlanar = (modelMatrix * vec4(position, 1.0)).xz / tileMetres;
#ifdef USE_MAP
  vMapUv = oylPlanar;
#endif
#ifdef USE_NORMALMAP
  vNormalMapUv = oylPlanar;
#endif
}
`;

/**
 * The ground's photographic material — #425.
 *
 * The grass photograph brings grain, clumps and light; the hue stays
 * `world.ts`'s ground colour, chosen per route, and the landform's own vertex
 * colours. Every grass on Poly Haven is the colour of the field it was
 * photographed in, and unmodified it made #457's world look dead — so the map
 * is divided by its own mean and multiplied by the world's colour. It is
 * sampled at two scales and blended by distance, which is the cheapest cure
 * for a tiling that reads as a grid at 150 m, and it keeps #460's field
 * patchwork (`withSurfaceDetail`) on top.
 */
function photographicGroundMaterial(
  colour: Texture,
  normal: Texture,
  fieldSpan: { value: number },
  fieldCount: { value: number },
): MeshStandardMaterial {
  const material = constructed(
    new MeshStandardMaterial({
      color: UNSET_COLOUR,
      vertexColors: true,
      map: colour,
      normalMap: normal,
      normalScale: new Vector2(0.8, 0.8),
      roughness: 0.95,
      metalness: 0,
    }),
  );
  material.onBeforeCompile = (shader) => {
    shader.uniforms['tileMetres'] = { value: REALISTIC_SURFACES.ground.tileMetres };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float tileMetres;')
      .replace('#include <uv_vertex>', `#include <uv_vertex>\n${PLANAR_UV}`);
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      /* glsl */ `
#ifdef USE_MAP
{
  vec3 oylNear = texture2D(map, vMapUv).rgb;
  vec3 oylFar = texture2D(map, vMapUv * 0.111 + vec2(0.37, 0.61)).rgb;
  float oylFarShare = smoothstep(8.0, 120.0, -vViewPosition.z);
  vec3 oylTexel = mix(oylNear, mix(oylNear, oylFar, 0.5) * 0.55 + oylFar * 0.45, oylFarShare);
  vec3 oylMean = max(textureLod(map, vec2(0.5), 16.0).rgb, vec3(1e-3));
  diffuseColor.rgb *= oylTexel / oylMean;
}
#endif
`,
    );
  };
  material.customProgramCacheKey = () => 'oyl-photographic-ground';
  // #460's patchwork, chained after the photograph rather than replacing it.
  return withSurfaceDetail(material, 'ground', fieldSpan, fieldCount);
}

/**
 * The most anisotropic filtering a realistic surface asks for: **8**, or the
 * device's own maximum where that is less. #425's grazing-angle shimmer is what
 * it is for; 8 is the common ceiling of mobile GPUs that offer the extension,
 * and more than a chase camera's angle needs.
 */
const REALISTIC_ANISOTROPY = 8;

/**
 * The realistic riders — ADR 0026 D-12 layer 4, #369.
 *
 * ## A real body on a bicycle built from numbers
 *
 * The body is MakeHuman's CC0 base mesh, rigged with its own default skeleton
 * and cut to 24 bones by `tools/realistic/blender/process_rider.py`. The
 * bicycle under it is **not downloaded**: on 2026-09-22 neither of the two
 * sources ADR 0026 D-4 names that state a licence per asset — Poly Haven's 521
 * models and ambientCG's — offered a bicycle at all, and a marketplace's label
 * is not a grant (#369). So it is `bicycle.ts`'s own parts drawn round and
 * spoked: tubes at the stylised radii, wheels with rims, tyres and spokes, drops,
 * a saddle, a crankset at the same angle. It is this repository's geometry, so
 * it has no licence surface and no `ASSETS.toml` row, and it is already right
 * about where the crank is — which #369 says a downloaded frame would have had
 * to be re-fitted to.
 *
 * ## Posed from `bicycle.ts`, every frame — #349's rule survives
 *
 * Nothing is baked. Each rider's bones are aimed, every frame, at
 * `bicycle.ts` §`riderJoints`: the hips on the saddle, the back to the
 * shoulders, the hands on the hoods, and each knee and foot from the same
 * two-bone solve the stylised legs use. The crank angle is the marker's own,
 * which `GameView` turns from the trainer's cadence and holds when the cadence
 * drops — so the realistic legs turn **exactly when the HUD shows a cadence**,
 * at exactly that cadence, and stop when it goes, as #349 requires of whatever
 * replaces the geometry.
 *
 * ## Three of them, told apart as #368 tells them apart
 *
 * The pacer and the ghost wear the same body on the same bicycle, tinted by
 * {@link RIDER_TINTS} — the body through its own material's colour, the bicycle
 * and the helmet per instance. Eight draw calls for all three: three bodies
 * (a skinned mesh is not instanceable), the frame, the rubber and the metal,
 * the cranksets and the helmets.
 *
 * ⚠️ **One allocation a rider a frame, and it is `legBones`'**: the knee solve
 * returns a two-number object, as it already does for the stylised rider.
 * Everything else is written into objects made in the constructor.
 */
export class RealisticRiderBelt {
  readonly #group = new Group();
  readonly #riders: RealisticRiderSlot[] = [];
  readonly #frame: InstancedMesh;
  readonly #rubber: InstancedMesh;
  readonly #metal: InstancedMesh;
  readonly #cranks: InstancedMesh;
  readonly #helmets: InstancedMesh;
  readonly #materials: readonly MeshStandardMaterial[];
  /** The body's scale: its rest leg, stretched to `bicycle.ts`'s thigh and shin. */
  readonly #scale: number;
  readonly #joints = emptyRiderJoints();
  readonly #tint = new Color();
  readonly #matrix = new Matrix4();
  readonly #local = new Matrix4();
  readonly #helmetLocal = new Matrix4();
  readonly #turn = new Quaternion();
  readonly #world = new Quaternion();
  readonly #parent = new Quaternion();
  readonly #a = new Vector3();
  readonly #b = new Vector3();
  readonly #c = new Vector3();
  readonly #d = new Vector3();
  readonly #e = new Vector3();
  readonly #up = new Vector3(0, 1, 0);
  readonly #acrossTheBicycle = new Vector3(1, 0, 0);
  readonly #unit = new Vector3(1, 1, 1);
  #shown = true;

  constructor(body: Object3D) {
    const bike = realisticBicycle();
    const frameMaterial = constructed(
      new MeshStandardMaterial({ color: RIDER_PALETTE.frame, roughness: 0.35, metalness: 0.3 }),
    );
    const rubberMaterial = constructed(
      new MeshStandardMaterial({ color: RIDER_PALETTE.tyre, roughness: 0.85, metalness: 0 }),
    );
    const metalMaterial = constructed(
      new MeshStandardMaterial({ color: 0xb8b8bc, roughness: 0.3, metalness: 0.9 }),
    );
    const helmetMaterial = constructed(
      new MeshStandardMaterial({ color: 0xf0f0f0, roughness: 0.4, metalness: 0 }),
    );
    const riders = RIDDEN_KINDS.length;
    this.#frame = tintable(bike.frame, frameMaterial, riders);
    this.#rubber = tintable(bike.rubber, rubberMaterial, riders);
    this.#metal = tintable(bike.metal, metalMaterial, riders);
    this.#cranks = tintable(realisticCrankset(), metalMaterial, riders);
    this.#helmets = tintable(
      new SphereGeometry(0.13, 16, 10, 0, Math.PI * 2, 0, Math.PI / 1.8),
      helmetMaterial,
      riders,
    );
    this.#materials = [frameMaterial, rubberMaterial, metalMaterial, helmetMaterial];
    for (const mesh of [this.#frame, this.#rubber, this.#metal, this.#cranks, this.#helmets]) {
      this.#group.add(mesh);
    }

    let scale = 1;
    for (let slot = 0; slot < riders; slot += 1) {
      const holder = cloneSkinned(body);
      let skinned: SkinnedMesh | undefined;
      holder.traverse((node) => {
        if ((node as Partial<SkinnedMesh>).isSkinnedMesh === true) skinned = node as SkinnedMesh;
      });
      if (skinned === undefined) throw new Error('the rider model holds no skinned mesh');
      const source = skinned.material as Material;
      const material = constructed(
        new MeshStandardMaterial({ vertexColors: true, roughness: 0.65, metalness: 0 }),
      );
      if (slot === 0) source.dispose();
      skinned.material = material;
      skinned.frustumCulled = false;
      const bones = new Map<string, Bone>();
      for (const bone of skinned.skeleton.bones) bones.set(bone.name, bone);
      if (slot === 0) {
        holder.updateMatrixWorld(true);
        const at = (name: string, into: Vector3): Vector3 =>
          boneOf(bones, name).getWorldPosition(into);
        const restLeg =
          at('upperleg01.L', this.#a).distanceTo(at('lowerleg01.L', this.#b)) +
          this.#b.distanceTo(at('foot.L', this.#c));
        const bikeLeg = legBones(0)
          .slice(0, 2)
          .reduce((sum, bone) => sum + bone.length, 0);
        scale = bikeLeg / restLeg;
      }
      holder.scale.setScalar(scale);
      const root = new Group();
      root.add(holder);
      root.visible = false;
      this.#group.add(root);
      const ordered = skinned.skeleton.bones;
      this.#riders.push({
        root,
        body: skinned,
        material,
        bones,
        ordered,
        restQuaternions: ordered.map((bone) => bone.quaternion.clone()),
        restPositions: ordered.map((bone) => bone.position.clone()),
        angle: 0,
      });
    }
    this.#scale = scale;
    // The helmet sits on the head bone, a little up and forward of its joint.
    this.#helmetLocal.makeTranslation(0, 0.06 / scale, 0.01 / scale);
    this.#helmetLocal.scale(this.#unit.setScalar(1 / scale));
    this.#unit.set(1, 1, 1);
    this.#group.visible = false;
  }

  addTo(scene: Scene): void {
    scene.add(this.#group);
  }

  /** The group every realistic rider hangs under. For the tests and the harness. */
  get group(): Group {
    return this.#group;
  }

  /** Every material the riders wear. For the D-11 assertion. */
  get materials(): readonly Material[] {
    return [...this.#materials, ...this.#riders.map((rider) => rider.material)];
  }

  /** Whether the realistic riders draw at all — false while the stylised ones do. */
  setShown(on: boolean): void {
    this.#shown = on;
    if (!on) this.#group.visible = false;
  }

  /** This frame's riders, posed from their own crank angles. @see RiderBelt.place */
  place(markers: readonly RiderMarker[]): void {
    if (!this.#shown) return;
    let slot = 0;
    for (const marker of markers) {
      if (slot >= this.#riders.length) break;
      if (!Object.hasOwn(RIDER_TINTS, marker.kind)) continue;
      this.#placeOne(slot, marker);
      slot += 1;
    }
    for (let rest = slot; rest < this.#riders.length; rest += 1) {
      (this.#riders[rest] as RealisticRiderSlot).root.visible = false;
    }
    for (const mesh of [this.#frame, this.#rubber, this.#metal, this.#cranks, this.#helmets]) {
      mesh.count = slot;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor !== null) mesh.instanceColor.needsUpdate = true;
    }
    this.#group.visible = slot > 0;
  }

  dispose(): void {
    for (const mesh of [this.#frame, this.#rubber, this.#metal, this.#cranks, this.#helmets]) {
      mesh.geometry.dispose();
      mesh.dispose();
    }
    for (const material of this.#materials) material.dispose();
    for (const rider of this.#riders) {
      rider.material.dispose();
      rider.body.skeleton.dispose();
    }
  }

  #placeOne(slot: number, marker: RiderMarker): void {
    const rider = this.#riders[slot] as RealisticRiderSlot;
    rider.root.visible = true;
    rider.root.position.set(marker.x, marker.y, marker.z);
    rider.root.quaternion.setFromAxisAngle(this.#up, Math.atan2(marker.headingX, marker.headingZ));
    // ⚠️ A frame that carries no angle HOLDS the one this rider had: no
    // cadence is no rotation, which is #349's rule and `advanceCrank`'s.
    rider.angle = marker.crankAngle ?? rider.angle;
    const tint = this.#tint.setHex(RIDER_TINTS[marker.kind]);
    rider.material.color.copy(tint);
    rider.root.updateMatrixWorld(true);
    this.#pose(rider, rider.angle);
    const world = rider.root.matrixWorld;
    for (const mesh of [this.#frame, this.#rubber, this.#metal]) {
      mesh.setMatrixAt(slot, world);
      mesh.setColorAt(slot, tint);
    }
    this.#a.set(0, CRANK_AXIS_Y, CRANK_AXIS_Z);
    this.#turn.setFromAxisAngle(this.#acrossTheBicycle, rider.angle);
    this.#local.compose(this.#a, this.#turn, this.#unit);
    this.#cranks.setMatrixAt(slot, this.#matrix.multiplyMatrices(world, this.#local));
    this.#cranks.setColorAt(slot, tint);
    const head = boneOf(rider.bones, 'head');
    this.#helmets.setMatrixAt(
      slot,
      this.#matrix.multiplyMatrices(head.matrixWorld, this.#helmetLocal),
    );
    this.#helmets.setColorAt(slot, tint);
  }

  /** Aims one rider's bones at `bicycle.ts`'s joints for a crank angle. */
  #pose(rider: RealisticRiderSlot, crankAngle: number): void {
    for (let index = 0; index < rider.ordered.length; index += 1) {
      const bone = rider.ordered[index] as Bone;
      bone.quaternion.copy(rider.restQuaternions[index] as Quaternion);
      bone.position.copy(rider.restPositions[index] as Vector3);
    }
    rider.root.updateMatrixWorld(true);
    const joints = riderJoints(crankAngle, this.#joints);
    const toWorld = (point: JointPoint, into: Vector3): Vector3 =>
      into.set(point.x, point.y, point.z).applyMatrix4(rider.root.matrixWorld);
    // The whole body, moved so its hips sit on the saddle.
    const hips = boneOf(rider.bones, 'upperleg01.L')
      .getWorldPosition(this.#a)
      .add(boneOf(rider.bones, 'upperleg01.R').getWorldPosition(this.#b))
      .multiplyScalar(0.5);
    const shift = toWorld(joints.hips, this.#b).sub(hips);
    const skeletonRoot = boneOf(rider.bones, 'root');
    skeletonRoot.parent?.getWorldQuaternion(this.#parent);
    shift.applyQuaternion(this.#parent.invert()).divideScalar(this.#scale);
    skeletonRoot.position.add(shift);
    rider.root.updateMatrixWorld(true);
    // The back, from the hips towards the shoulders.
    toWorld(joints.shoulders, this.#c).sub(toWorld(joints.hips, this.#d));
    this.#aim(rider, 'spine05', 'neck01', this.#c);
    const forward = this.#e.set(0, 0, 1).transformDirection(rider.root.matrixWorld);
    for (const index of [0, 1] as const) {
      const suffix = index === 0 ? 'L' : 'R';
      // The arm: shoulder to the grip, the elbow out and down.
      const shoulder = boneOf(rider.bones, `upperarm01.${suffix}`).getWorldPosition(this.#a);
      const grip = toWorld(joints.grip[index], this.#b);
      const upper = this.#length(rider, `upperarm01.${suffix}`, `lowerarm01.${suffix}`);
      const fore = this.#length(rider, `lowerarm01.${suffix}`, `wrist.${suffix}`);
      const pole = this.#c
        .set(index === 0 ? 1 : -1, -1, 0)
        .transformDirection(rider.root.matrixWorld);
      const elbow = twoBoneJoint(shoulder, grip, upper, fore, pole, this.#d);
      this.#aim(
        rider,
        `upperarm01.${suffix}`,
        `lowerarm01.${suffix}`,
        this.#c.copy(elbow).sub(shoulder),
      );
      this.#aim(rider, `lowerarm01.${suffix}`, `wrist.${suffix}`, this.#c.copy(grip).sub(elbow));
      // The leg: hip to the pedal, the knee forward — `bicycle.ts`'s own rule.
      const hip = boneOf(rider.bones, `upperleg01.${suffix}`).getWorldPosition(this.#a);
      const foot = toWorld(joints.foot[index], this.#b);
      const thigh = this.#length(rider, `upperleg01.${suffix}`, `lowerleg01.${suffix}`);
      const shin = this.#length(rider, `lowerleg01.${suffix}`, `foot.${suffix}`);
      const knee = twoBoneJoint(hip, foot, thigh, shin, forward, this.#d);
      this.#aim(rider, `upperleg01.${suffix}`, `lowerleg01.${suffix}`, this.#c.copy(knee).sub(hip));
      this.#aim(rider, `lowerleg01.${suffix}`, `foot.${suffix}`, this.#c.copy(foot).sub(knee));
    }
  }

  #length(rider: RealisticRiderSlot, from: string, to: string): number {
    const start = boneOf(rider.bones, from).getWorldPosition(this.#scratchLength);
    return start.distanceTo(boneOf(rider.bones, to).getWorldPosition(this.#scratchLengthTo));
  }

  readonly #scratchLength = new Vector3();
  readonly #scratchLengthTo = new Vector3();
  readonly #aimHead = new Vector3();
  readonly #aimCurrent = new Vector3();
  readonly #aimWanted = new Vector3();

  /** Turns `bone` so the direction to `child`'s head is `direction`, in world space. */
  #aim(rider: RealisticRiderSlot, boneName: string, childName: string, direction: Vector3): void {
    const bone = boneOf(rider.bones, boneName);
    const child = boneOf(rider.bones, childName);
    bone.getWorldPosition(this.#aimHead);
    child.getWorldPosition(this.#aimCurrent).sub(this.#aimHead).normalize();
    this.#aimWanted.copy(direction).normalize();
    this.#turn.setFromUnitVectors(this.#aimCurrent, this.#aimWanted);
    bone.getWorldQuaternion(this.#world);
    this.#parent.identity();
    bone.parent?.getWorldQuaternion(this.#parent);
    bone.quaternion.copy(this.#parent.invert().multiply(this.#turn.multiply(this.#world)));
    bone.updateMatrixWorld(true);
  }
}

/** One realistic rider: its body, its bones at rest, and its held crank angle. */
interface RealisticRiderSlot {
  readonly root: Group;
  readonly body: SkinnedMesh;
  readonly material: MeshStandardMaterial;
  readonly bones: ReadonlyMap<string, Bone>;
  readonly restQuaternions: readonly Quaternion[];
  readonly restPositions: readonly Vector3[];
  readonly ordered: readonly Bone[];
  angle: number;
}

/**
 * A bone by its MakeHuman name. three's loader strips the `.` from a node name
 * (`PropertyBinding.sanitizeNodeName`), so `upperleg01.L` arrives as
 * `upperleg01L` — spike 0005, "What these taught #430", 8.
 */
function boneOf(bones: ReadonlyMap<string, Bone>, name: string): Bone {
  const bone = bones.get(name.replace(/\./g, ''));
  if (bone === undefined) throw new Error(`the rider model has no bone ${name}`);
  return bone;
}

/**
 * The elbow or knee of a two-bone limb from `root` to `target`, bent towards
 * `pole` — the law `bicycle.ts` §`kneeBetween` uses, in three dimensions.
 * Written into `into`.
 */
function twoBoneJoint(
  root: Vector3,
  target: Vector3,
  upper: number,
  lower: number,
  pole: Vector3,
  into: Vector3,
): Vector3 {
  const reachX = target.x - root.x;
  const reachY = target.y - root.y;
  const reachZ = target.z - root.z;
  const full = Math.max(Math.hypot(reachX, reachY, reachZ), 1e-6);
  const distance = Math.min(full, upper + lower - 1e-4);
  const ax = reachX / full;
  const ay = reachY / full;
  const az = reachZ / full;
  const cosine = Math.min(
    1,
    Math.max(-1, (upper * upper + distance * distance - lower * lower) / (2 * upper * distance)),
  );
  const along = pole.x * ax + pole.y * ay + pole.z * az;
  let bx = pole.x - along * ax;
  let by = pole.y - along * ay;
  let bz = pole.z - along * az;
  const bend = Math.hypot(bx, by, bz);
  if (bend < 1e-9) {
    bx = 0;
    by = 0;
    bz = 1;
  } else {
    bx /= bend;
    by /= bend;
    bz /= bend;
  }
  const sine = Math.sqrt(1 - cosine * cosine);
  return into.set(
    root.x + upper * (cosine * ax + sine * bx),
    root.y + upper * (cosine * ay + sine * by),
    root.z + upper * (cosine * az + sine * bz),
  );
}

/** An instanced mesh with a per-instance tint, empty. @see RiderBelt */
function tintable(geometry: BufferGeometry, material: Material, capacity: number): InstancedMesh {
  const mesh = new InstancedMesh(geometry, material, capacity);
  mesh.instanceMatrix.setUsage(DynamicDrawUsage);
  const white = new Color(0xffffff);
  // ⚠️ `instanceColor` is sized from `count` when first written, so this runs
  // while `count` is still the capacity — `RiderBelt`'s own note.
  for (let slot = 0; slot < capacity; slot += 1) mesh.setColorAt(slot, white);
  mesh.count = 0;
  mesh.frustumCulled = false;
  return mesh;
}

/**
 * Which of the two merges a part drawn in one piece belongs in — #369.
 *
 * Bar tape, a saddle and a tyre are rubber; a frame tube is not. The test is
 * the part's own **colour**, which is the one place `bicycle.ts` already states
 * that difference: `RIDER_PALETTE.tyre` is documented there as *"tyres, saddle
 * and cranks"*, and the bar joined it when #369 taped it.
 *
 * ⚠️ **It was `part.name === 'handlebar'`, then briefly
 * `part.name.startsWith('bar ')`, and both were the wrong kind of test.** The
 * first was a whole-bar match that matched nothing the moment the bar became
 * four parts; the second was stringly-typed dispatch on a field `RiderPart`
 * documents as being for failure messages, and it left the `bend` branch
 * stating "the bar is rubber" a *second* time, unconditionally — two
 * statements of one fact in the change whose thesis was that there should be
 * one. `bicycle.test.ts` §"tapes the bar, which is what puts it in the
 * renderer's rubber" holds the bar to that colour, so the dispatch and its
 * premise now fail together.
 *
 * ⚠️ **Which geometry gets which material is still NOT asserted in a
 * browser**, and #369 measured that rather than assuming it: sorting every
 * part into `frame` leaves all 1 221 tests in `src/game` green. The browser
 * gate's ADR 0026 D-11 assertion covers the material *class* on each mesh and
 * says nothing about which parts landed in which merge. It is a look, and this
 * repository has no look gate (ADR 0009 forbids deriving one from another
 * product).
 */
function softly(
  part: RiderPart,
  frame: BufferGeometry[],
  rubber: BufferGeometry[],
): BufferGeometry[] {
  return part.colour === RIDER_PALETTE.tyre ? rubber : frame;
}

/** A tube part's two ends, in the bicycle's own frame. */
function placedPart(geometry: BufferGeometry, part: RiderPart): BufferGeometry {
  return geometry
    .rotateX(part.pitch)
    .rotateY(part.yaw)
    .rotateZ(part.roll)
    .translate(part.x, part.y, part.z);
}

/**
 * The realistic bicycle: `bicycle.ts`'s parts, drawn round — frame, rubber
 * and metal, one merged geometry each.
 */
function realisticBicycle(): {
  readonly frame: BufferGeometry;
  readonly rubber: BufferGeometry;
  readonly metal: BufferGeometry;
} {
  const frame: BufferGeometry[] = [];
  const rubber: BufferGeometry[] = [];
  const metal: BufferGeometry[] = [];
  for (const part of RIDER_BODY_PARTS) {
    if (part.name.startsWith('arm') || part.name === 'torso' || part.name === 'helmet') continue;
    const solid = part.solid;
    if (solid.shape === 'ring') {
      // A wheel in the bicycle's YZ plane at its hub: tyre, rim, hub, spokes.
      const radius = solid.radius + solid.thickness;
      const tyre = solid.thickness;
      rubber.push(
        new TorusGeometry(radius - tyre, tyre, 10, 48)
          .rotateY(Math.PI / 2)
          .translate(0, part.y, part.z),
      );
      metal.push(
        new TorusGeometry(radius - tyre * 2.2, tyre * 0.45, 6, 48)
          .rotateY(Math.PI / 2)
          .translate(0, part.y, part.z),
        new CylinderGeometry(0.02, 0.02, 0.1, 10).rotateZ(Math.PI / 2).translate(0, part.y, part.z),
      );
      const spokes = 20;
      const length = radius - tyre * 2.2;
      for (let spoke = 0; spoke < spokes; spoke += 1) {
        metal.push(
          new CylinderGeometry(0.0015, 0.0015, length, 3)
            .translate(0, length / 2, 0)
            .rotateX((spoke / spokes) * Math.PI * 2)
            .translate(spoke % 2 === 0 ? 0.02 : -0.02, part.y, part.z),
        );
      }
    } else if (solid.shape === 'tube') {
      softly(part, frame, rubber).push(
        placedPart(new CylinderGeometry(solid.radius, solid.radius, solid.length, 12), part),
      );
    } else if (solid.shape === 'bend') {
      // ⚠️ **The drops come from `bicycle.ts` since #369, and a reviewer who
      // remembers a `TorusGeometry(0.07, 0.012, 8, 16, Math.PI)` written out
      // here is reading the old file.** They were four literals in this
      // function while the hands were placed from two more in `bicycle.ts`,
      // which is why the two never met.
      softly(part, frame, rubber).push(
        placedPart(
          new TorusGeometry(solid.radius, solid.thickness, 8, 16, solid.sweep).rotateZ(solid.start),
          part,
        ),
      );
    } else if (solid.shape === 'box') {
      softly(part, frame, rubber).push(
        placedPart(new BoxGeometry(solid.width * 0.8, solid.height, solid.depth), part),
      );
    } else if (solid.shape === 'ball') {
      // Only the helmet is a ball and the filter above dropped it, so this is
      // unreachable — and it is spelled out rather than left to the `else`
      // below, which is what makes that `else` a `never`.
      throw new Error('the realistic bicycle has no ball to draw');
    } else {
      // ⚠️ **A shape this chain does not know is a COMPILE error, since #369's
      // review.** It used to fall out of an `if`/`else if` chain in silence, so
      // #369's `bend` would have left the realistic bicycle with no drops at
      // all and every gate green — the defect shape this repository keeps
      // finding. A `throw` alone moves that to run time, where `solidGeometry`
      // §`switch` catches the same mistake at the typechecker; the narrowing
      // above is what buys the same answer here. A sixth `RiderSolid` fails to
      // assign on the line below, before any test runs.
      const unreachable: never = solid;
      throw new Error(`the realistic bicycle cannot draw a ${JSON.stringify(unreachable)}`);
    }
  }
  return { frame: merged(frame), rubber: merged(rubber), metal: merged(metal) };
}

/** The realistic crankset, in the bottom bracket's own frame. */
function realisticCrankset(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  for (const part of RIDER_CRANK_PARTS) {
    const solid = part.solid;
    if (solid.shape === 'ring') {
      parts.push(
        new TorusGeometry(solid.radius, solid.thickness / 2, 6, 40)
          .rotateY(Math.PI / 2)
          .translate(part.x, part.y, part.z),
      );
    } else if (solid.shape === 'box') {
      parts.push(placedPart(new BoxGeometry(solid.width, solid.height, solid.depth), part));
    } else {
      // ⚠️ **The same refusal as `realisticBicycle` above, for the same
      // reason.** This chain kept the silent skip after #369 fixed its
      // neighbour, in the very change that added a fifth shape to the
      // vocabulary both of them read — so a `bend` or a `tube` added to
      // `RIDER_CRANK_PARTS` would have drawn nothing here, with every gate
      // green, which is the defect that had just been fixed one function up.
      // Measured: a `tube` crank part is `Error: the realistic crankset cannot
      // draw a tube` with this branch and a silently missing spider without it.
      // There is no `never` to take — `ring` and `box` are two of five, and the
      // other three are legitimately not crank parts.
      throw new Error(`the realistic crankset cannot draw a ${solid.shape}`);
    }
  }
  return merged(parts);
}

/**
 * How many triangles the realistic bicycle and crankset have — what
 * `realistic-budget.ts` §`REALISTIC_BICYCLE_TRIANGLES` holds them to.
 *
 * ⚠️ **This tag said `three-renderer.test.ts` until #369's review and the
 * reader has always been `realistic-renderer.test.ts`** — a reviewer who
 * remembers the old filename is reading the old file, and one who remembers
 * #369's first pass claiming *"NOTHING DID"* is reading a **retracted** one.
 * That claim was false and it was measured false: the assertion has been in
 * `realistic-renderer.test.ts` §"the realistic bicycle — #369" since
 * `fcc4a67`, the very commit that created this export, and it is *stronger*
 * than the duplicate #369 briefly added beside it. Applying #369's own M9
 * (`spokes = 20` → `900`) to `b4f789a`, with no part of #369 present, is red:
 * `expected 26332 to be less than or equal to 12000` at
 * `realistic-renderer.test.ts:923`.
 *
 * ⚠️ **The real defect is the misdirection, and it is worth keeping.** A
 * `@test-facing` tag is trusted twice over and only one of the two is
 * mechanical: `check:wiring` holds the exemption on any gate file *naming the
 * identifier* (`WIRE004`, §`identifiersIn`) and never reads the filename in
 * the tag at all — so a tag pointing at the wrong file costs nothing there and
 * costs a **human** the answer to "is this asserted anywhere?". Grep the
 * symbol across the tree and mutate on the base commit before writing a
 * `⚠️ nothing held this` here; the check is two minutes and the claim, once
 * committed, is read as settled fact for years.
 *
 * @test-facing: `realistic-renderer.test.ts` §"the realistic bicycle — #369"
 * holds the geometry this file builds to the budget, since it is built here
 * rather than read off a file.
 */
export function realisticBicycleTriangles(): number {
  const bike = realisticBicycle();
  const crank = realisticCrankset();
  const count = (geometry: BufferGeometry): number =>
    (geometry.getIndex()?.count ?? geometry.getAttribute('position').count) / 3;
  const total = count(bike.frame) + count(bike.rubber) + count(bike.metal) + count(crank);
  for (const geometry of [bike.frame, bike.rubber, bike.metal, crank]) geometry.dispose();
  return total;
}

/**
 * How much darker than its neighbour a part of a realistic building is drawn,
 * by what it is made of — #500. A plinth, a ridge and a door wear the same
 * photograph as the wall, the roof or the frame beside them
 * (`realistic-assets.ts` §`REALISTIC_BUILDING_SURFACES`), so what sets them
 * apart is this, multiplied into the vertex colour with the grounding. **No
 * texture**, and no mesh: a darker course of brick is the same brick.
 */
const REALISTIC_ROLE_SHADE: Readonly<Record<BuildingRole, number>> = {
  wall: 1,
  plinth: 0.62,
  roof: 1,
  ridge: 0.72,
  chimney: 0.9,
  joinery: 1,
  door: 0.62,
  glass: 1,
};

/** One part of a realistic structure: the surface it wears, how dark, and its triangles. */
interface StructurePart {
  readonly surface: StructureSurface;
  readonly shade: number;
  /**
   * Whether its foot is darkened by {@link groundingShade}: a building's parts
   * are, and a field boundary's or a signpost's are NOT — #500 grounds a
   * building, and the stylised world paints a boundary one colour top to
   * bottom (§`builtStyle`), so a hedge is the same in both worlds.
   */
  readonly grounded: boolean;
  readonly geometry: BufferGeometry;
}

/**
 * One structure's parts in one variant — #475, and since #500 a building's are
 * `buildings.ts`' roles, each wearing its surface from
 * `realistic-assets.ts` §`REALISTIC_BUILDING_SURFACES`.
 *
 * ⚠️ **The realistic house is `buildings.ts`' too**, where it used to be a
 * brick block under a gable built here. The stylised world still draws a
 * Kenney model for a house (ADR 0022); every other building is the SAME
 * triangles in both worlds, dressed differently.
 *
 * A field boundary or a signpost is {@link BOUNDARY_STYLE}'s own parts, so the
 * realistic shape is the stylised one with a photograph on it.
 */
function realisticStructureParts(kind: StructureKind, variant = 0): StructurePart[] {
  if (isBuiltKind(kind)) {
    const plan = planOf(kind, variant);
    const parts: StructurePart[] = [];
    for (const role of BUILDING_ROLES) {
      const geometry = roleGeometry(plan, role);
      if (geometry === undefined) continue;
      parts.push({
        surface: REALISTIC_BUILDING_SURFACES[kind][role],
        shade: REALISTIC_ROLE_SHADE[role],
        grounded: true,
        geometry,
      });
    }
    return parts;
  }
  const surfaces = REALISTIC_BOUNDARY_PARTS[kind];
  return BOUNDARY_STYLE[kind].map((part, index) => ({
    surface: surfaces[index] ?? 'painted',
    shade: 1,
    grounded: false,
    geometry: part.geometry(),
  }));
}

/**
 * Every surface one structure wears, in the order its parts first wear them —
 * #475, #500. The first is the belt a structure is counted off.
 */
export function realisticStructureSurfaces(kind: StructureKind): readonly StructureSurface[] {
  const parts = realisticStructureParts(kind);
  const surfaces = [...new Set(parts.map((part) => part.surface))];
  for (const part of parts) part.geometry.dispose();
  return surfaces;
}

/**
 * A geometry with texture coordinates in metres of its surface — #475.
 *
 * Each triangle is projected along the axis its own face is most nearly
 * facing: a wall facing ±x reads (z, y), one facing ±z reads (x, y), a roof or
 * a top reads (x, z). So a brick is the same size on every wall of every
 * building and a course of them runs level, which a box's own 0-to-1
 * coordinates would not give — they stretch one photograph across a whole
 * wall, whatever its size. Position and normal are kept; nothing else is.
 */
function projectedInMetres(
  geometry: BufferGeometry,
  tileMetres: number,
  shade = 1,
  grounded = true,
): BufferGeometry {
  const flat = geometry.index === null ? geometry : geometry.toNonIndexed();
  if (flat !== geometry) geometry.dispose();
  for (const name of Object.keys(flat.attributes)) {
    if (name !== 'position' && name !== 'normal') flat.deleteAttribute(name);
  }
  if (flat.getAttribute('normal') === undefined) flat.computeVertexNormals();
  const position = flat.getAttribute('position');
  const uv = new Float32Array(position.count * 2);
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  const across = new Vector3();
  for (let first = 0; first + 2 < position.count; first += 3) {
    a.fromBufferAttribute(position, first);
    b.fromBufferAttribute(position, first + 1);
    c.fromBufferAttribute(position, first + 2);
    const normal = across.subVectors(c, b).cross(b.clone().sub(a));
    const x = Math.abs(normal.x);
    const y = Math.abs(normal.y);
    const z = Math.abs(normal.z);
    for (let corner = 0; corner < 3; corner += 1) {
      const at = first + corner;
      const px = position.getX(at);
      const py = position.getY(at);
      const pz = position.getZ(at);
      const [u, v] = x >= y && x >= z ? [pz, py] : y >= z ? [px, pz] : [px, py];
      uv[at * 2] = u / tileMetres;
      uv[at * 2 + 1] = v / tileMetres;
    }
  }
  flat.setAttribute('uv', new BufferAttribute(uv, 2));
  // #500: the grounding and the part's own shade, as a vertex colour the
  // structure materials multiply in. @see groundingShade
  paintGrounded(flat, 0xffffff, shade, grounded);
  return flat;
}

/**
 * The parts of one structure that wear one surface, in one variant, as one
 * geometry, or `undefined` when none do — #475, #500.
 */
export function realisticStructureGeometry(
  kind: StructureKind,
  surface: StructureSurface,
  variant = 0,
): BufferGeometry | undefined {
  const tile = isPhotographic(surface) ? REALISTIC_STRUCTURE_SURFACES[surface].tileMetres : 1;
  const mine: BufferGeometry[] = [];
  for (const part of realisticStructureParts(kind, variant)) {
    if (part.surface === surface)
      mine.push(projectedInMetres(part.geometry, tile, part.shade, part.grounded));
    else part.geometry.dispose();
  }
  if (mine.length === 0) return undefined;
  const joined = mergeGeometries(mine);
  for (const each of mine) each.dispose();
  if (joined === null) throw new Error(`${kind}: its ${surface} parts could not be merged`);
  return joined;
}

/**
 * How each structure surface takes the light — #475. The photographs carry the
 * colour; these are the two physically based numbers three needs besides, and
 * a tint where one is argued:
 *
 * - `hedge` is tinted greener, because the nearest photograph any source in
 *   D-4 publishes is leaf litter seen from above (`tools/realistic/sources.ts`
 *   §`STRUCTURE_TEXTURES`), and a hedge is a living one;
 * - `painted` — a signpost's pole — has no photograph, so its colour is the
 *   stylised pole's own;
 * - `corrugated` is the one metal: galvanised sheet, half metallic and fairly
 *   smooth, so it catches the sky the environment map puts in it.
 *
 * Every other figure is matte, as brick, stone, tile and boards are.
 */
const STRUCTURE_SURFACE_FINISH: Readonly<
  Record<
    StructureSurface,
    { readonly roughness: number; readonly metalness: number; readonly tint: number }
  >
> = {
  brick: { roughness: 0.9, metalness: 0, tint: 0xffffff },
  'roof-tiles': { roughness: 0.8, metalness: 0, tint: 0xffffff },
  slate: { roughness: 0.7, metalness: 0, tint: 0xffffff },
  stone: { roughness: 0.95, metalness: 0, tint: 0xffffff },
  planks: { roughness: 0.85, metalness: 0, tint: 0xffffff },
  corrugated: { roughness: 0.5, metalness: 0.5, tint: 0xffffff },
  hedge: { roughness: 0.95, metalness: 0, tint: 0x8fcf66 },
  painted: { roughness: 0.6, metalness: 0.2, tint: 0x5a5a5a },
  // #500: a pane. Smooth and a little metallic, so it gives back the sky the
  // environment map already holds — the look of glass for no texture at all —
  // over a dark base, which is what a window reads as from the road by day.
  glass: { roughness: 0.08, metalness: 0.35, tint: 0x2a3640 },
};

/**
 * The kinds the realistic world's primitives belt leaves to the others: the
 * vegetation belt's four, and — since #475, layer 3 — every structure. What is
 * left for it is `post`, which ADR 0022 D-3 keeps procedural in both worlds.
 */
export const REALISTIC_PRIMITIVE_SKIP: ReadonlySet<SceneryKind> = new Set<SceneryKind>([
  ...REALISTIC_VEGETATION_KINDS,
  ...STRUCTURE_KINDS,
]);

/**
 * How many triangles one realistic structure of a kind is drawn with, every
 * surface together — what `realistic-budget.ts` §`REALISTIC_TRIANGLES` holds a
 * structure to, since it is built here rather than read off a file.
 *
 * @test-facing held by `realistic-budget.test.ts`
 */
export function realisticStructureTriangles(kind: StructureKind): number {
  let heaviest = 0;
  for (let variant = 0; variant < (isBuiltKind(kind) ? BUILDING_VARIANTS : 1); variant += 1) {
    heaviest = Math.max(heaviest, realisticStructureTrianglesOf(kind, variant));
  }
  return heaviest;
}

/**
 * How many triangles one shape of a realistic structure is drawn with — #500.
 *
 * @test-facing held by `realistic-budget.test.ts` §"the SAME triangles in both
 * worlds", shape by shape against the stylised belt's mesh
 */
export function realisticStructureTrianglesOf(kind: StructureKind, variant: number): number {
  let total = 0;
  for (const { geometry } of realisticStructureParts(kind, variant)) {
    const flat = geometry.index === null ? geometry : geometry.toNonIndexed();
    total += flat.getAttribute('position').count / 3;
    flat.dispose();
    geometry.dispose();
  }
  return total;
}

/** Every surface a structure can wear, the photographic ones first. */
const STRUCTURE_SURFACES: readonly StructureSurface[] = [
  ...PHOTOGRAPHIC_STRUCTURE_SURFACES,
  'painted',
  'glass',
];

/**
 * The pair one surface's belt wears — ADR 0026 D-10 and D-11: constructed
 * here, from the world's own textures, never by a loader.
 */
function structureMaterials(
  surface: StructureSurface,
  textures: RealisticWorld['structures'],
): ShadedMaterials {
  const finish = STRUCTURE_SURFACE_FINISH[surface];
  const maps = isPhotographic(surface) ? textures.get(surface) : undefined;
  // ⚠️ `vertexColors` since #500: every structure geometry carries its part's
  // shade in its vertex colour, and a building's the grounding as well (a
  // boundary's does not). @see projectedInMetres
  return {
    lit: constructed(
      new MeshStandardMaterial({
        color: finish.tint,
        roughness: finish.roughness,
        metalness: finish.metalness,
        vertexColors: true,
        ...(maps === undefined ? {} : { map: maps.colour, normalMap: maps.normal }),
      }),
    ),
    flat: constructed(
      new MeshBasicMaterial({
        color: finish.tint,
        vertexColors: true,
        ...(maps === undefined ? {} : { map: maps.colour }),
      }),
    ),
  };
}

/**
 * The realistic world's structures, one {@link ScatterBelt} per surface — #475.
 *
 * ## Why a belt a surface, and why every belt counts every item
 *
 * A structure wears more than one surface — a house is brick, tile, timber
 * and, since #500, glass — so it cannot be one mesh with one material the way
 * the stylised world's vertex-coloured structures are. Each surface's belt
 * holds, for each kind and shape that wears it, that kind's parts in it; so a
 * house is four instances, one in each of those belts, placed by the SAME
 * matrix because every belt places it from the same item. Every other kind is on the belt's
 * `skip` list, which is what makes it spend the budget without being drawn
 * (#478): each belt admits exactly the items the stylised belt would, so a
 * house can never be drawn with its walls and without its roof.
 */
export class RealisticStructureBelts {
  readonly #belts: readonly { readonly surface: StructureSurface; readonly belt: ScatterBelt }[];
  /** The belt each kind is counted off: the first surface it wears. @see drawnItems */
  readonly #first = new Map<StructureKind, StructureSurface>();

  /** @param textures the world's structure surfaces. @see RealisticWorld.structures */
  constructor(textures: RealisticWorld['structures']) {
    for (const kind of STRUCTURE_KINDS) {
      const [first] = realisticStructureSurfaces(kind);
      if (first !== undefined) this.#first.set(kind, first);
    }
    this.#belts = STRUCTURE_SURFACES.map((surface) => {
      const models = new Map<SceneryKind, readonly BufferGeometry[]>();
      for (const kind of STRUCTURE_KINDS) {
        // #500: a building has one shape a variant, and each is a mesh here.
        const variants = isBuiltKind(kind) ? BUILDING_VARIANTS : 1;
        const shapes: BufferGeometry[] = [];
        for (let variant = 0; variant < variants; variant += 1) {
          const geometry = realisticStructureGeometry(kind, surface, variant);
          if (geometry !== undefined) shapes.push(geometry);
        }
        if (shapes.length === 0) continue;
        // ⚠️ A variant without a surface its sibling wears would leave a hole
        // the belt fills with the stylised primitive — a painted barn in a
        // photographed village. Every variant wears the same surfaces, and
        // this is where that stops being an assumption.
        if (shapes.length !== variants) {
          for (const shape of shapes) shape.dispose();
          throw new Error(`${kind}: its variants do not all wear ${surface}`);
        }
        models.set(kind, shapes);
      }
      const belt = new ScatterBelt(models, {
        skip: new Set(SCENERY_KINDS.filter((kind) => !models.has(kind))),
        materials: structureMaterials(surface, textures),
      });
      // The belt wears copies. @see ScatterBelt's constructor
      for (const shapes of models.values()) for (const geometry of shapes) geometry.dispose();
      return { surface, belt };
    });
  }

  /** The belt one surface is drawn by. */
  beltOf(surface: StructureSurface): ScatterBelt | undefined {
    return this.#belts.find((each) => each.surface === surface)?.belt;
  }

  addTo(scene: Scene): void {
    for (const { belt } of this.#belts) belt.addTo(scene);
  }

  setShown(on: boolean): void {
    for (const { belt } of this.#belts) belt.setShown(on);
  }

  setBudget(items: number): void {
    for (const { belt } of this.#belts) belt.setBudget(items);
  }

  update(items: readonly ScatterItem[], pose: CameraPose): void {
    for (const { belt } of this.#belts) belt.update(items, pose);
  }

  /**
   * How many structures the last frame drew — each counted once, off the belt
   * of the first surface it wears, so a house is one item and not two.
   */
  get drawnItems(): number {
    let drawn = 0;
    for (const kind of STRUCTURE_KINDS) {
      const first = this.#first.get(kind);
      for (const mesh of first === undefined ? [] : (this.beltOf(first)?.meshesOf(kind) ?? [])) {
        drawn += mesh.count;
      }
    }
    return drawn;
  }

  dispose(): void {
    for (const { belt } of this.#belts) belt.dispose();
  }
}

/**
 * What one view builds to draw the realistic world — ADR 0026 D-10's second
 * path, beside the stylised one in this same file.
 *
 * - {@link RealisticVegetationBelt}: the trees, shrubs and rocks (#474).
 * - {@link RealisticStructureBelts}: the structures, in photographic
 *   surfaces (#475, layer 3).
 * - A second {@link ScatterBelt}, **with no models** and physically based
 *   materials, for the one kind left: `post`, which ADR 0022 D-3 keeps
 *   procedural in both worlds. No Kenney model is drawn beside a photoscan on
 *   any rung — D-3.
 * - {@link RealisticRiderBelt}: the MakeHuman riders on their bicycles (#369).
 * - The road's and the ground's photographic materials, swapped onto the
 *   stylised meshes, so the road stays one mesh and one draw call (#425).
 * - The environment map, prefiltered from the sky with this view's own
 *   renderer — a `PMREMGenerator` needs one, which is why this is built in the
 *   view and not at load. The generator is disposed as soon as the map exists,
 *   releasing its ping-pong target (`realistic-budget.ts`
 *   §`environmentMapBytes`).
 */
class RealisticDrawing {
  readonly vegetation: RealisticVegetationBelt;
  readonly structures: RealisticStructureBelts;
  readonly primitives: ScatterBelt;
  readonly riders: RealisticRiderBelt;
  readonly road: MeshStandardMaterial;
  readonly ground: MeshStandardMaterial;
  readonly environment: Texture;

  constructor(
    world: RealisticWorld,
    renderer: WebGLRenderer,
    fields: { readonly span: { value: number }; readonly count: { value: number } },
  ) {
    const anisotropy = Math.min(REALISTIC_ANISOTROPY, renderer.capabilities.getMaxAnisotropy());
    for (const texture of [
      world.road.colour,
      world.road.normal,
      world.ground.colour,
      world.ground.normal,
    ]) {
      texture.anisotropy = anisotropy;
    }
    this.vegetation = new RealisticVegetationBelt(world.vegetation);
    this.structures = new RealisticStructureBelts(world.structures);
    this.primitives = new ScatterBelt(new Map(), {
      skip: REALISTIC_PRIMITIVE_SKIP,
      physical: true,
    });
    this.riders = new RealisticRiderBelt(world.body);
    this.road = photographicRoadMaterial(world.road.colour, world.road.normal);
    this.ground = photographicGroundMaterial(
      world.ground.colour,
      world.ground.normal,
      fields.span,
      fields.count,
    );
    const generator = new PMREMGenerator(renderer);
    this.environment = generator.fromEquirectangular(world.sky.texture).texture;
    generator.dispose();
  }

  addTo(scene: Scene): void {
    this.vegetation.addTo(scene);
    this.structures.addTo(scene);
    this.primitives.addTo(scene);
    this.riders.addTo(scene);
  }

  setShown(on: boolean): void {
    this.vegetation.setShown(on);
    this.structures.setShown(on);
    this.primitives.setShown(on);
    this.riders.setShown(on);
  }

  /** Every scenery belt, handed the same frame. */
  updateScenery(items: readonly ScatterItem[], pose: CameraPose): void {
    this.vegetation.update(items, pose);
    this.structures.update(items, pose);
    this.primitives.update(items, pose);
  }

  /**
   * The rung's scenery budget, handed to BOTH belts that draw scenery — #478.
   *
   * One method so that the two cannot be given different numbers, and so that
   * a view has one line to call: until #478 the view budgeted the primitives
   * belt alone, and the trees — the realistic world's cost — were free.
   * @see RealisticVegetationBelt.setBudget
   */
  setBudget(items: number): void {
    this.vegetation.setBudget(items);
    this.structures.setBudget(items);
    this.primitives.setBudget(items);
  }

  /** How many scenery items the last frame drew, every belt together. */
  get sceneryDrawn(): number {
    return this.vegetation.drawnItems + this.structures.drawnItems + this.primitives.drawnItems;
  }

  dispose(): void {
    this.vegetation.dispose();
    this.structures.dispose();
    this.primitives.dispose();
    this.riders.dispose();
    this.road.dispose();
    this.ground.dispose();
    this.environment.dispose();
  }
}

/**
 * Frees the realistic world's textures and geometry from the GPU, keeping the
 * objects: three uploads a disposed texture again if anything draws it, so a
 * later view that asks for realism still can, while a phone that stepped down
 * holds none of it meanwhile.
 */
function evictRealisticWorldFromGpu(): void {
  const world = realisticWorld;
  if (world === undefined) return;
  world.sky.texture.dispose();
  for (const texture of [
    world.road.colour,
    world.road.normal,
    world.ground.colour,
    world.ground.normal,
  ]) {
    texture.dispose();
  }
  for (const shapes of world.vegetation.values()) {
    for (const shape of shapes) {
      for (const part of shape.parts) {
        part.geometry.dispose();
        part.material.map?.dispose();
        part.material.normalMap?.dispose();
      }
      shape.impostor?.texture.dispose();
    }
  }
  for (const maps of world.structures.values()) {
    maps.colour.dispose();
    maps.normal.dispose();
  }
}

/**
 * One mesh's material, as the harness reports it.
 *
 * @unwired the shape of what `sceneMaterialsOf` hands the browser gate's harness
 */
export interface SceneMaterial {
  /** Whether the mesh and every ancestor is visible — whether it can be drawn. */
  readonly visible: boolean;
  /** three's own `type`: `MeshStandardMaterial`, `ShaderMaterial` and so on. */
  readonly type: string;
  /** ADR 0026 D-11: whether this file constructed it. */
  readonly constructed: boolean;
}

/**
 * Which world a view is drawing — for the owner's harness page, which says so
 * on screen (D-7's "and says so"), and for the browser gate.
 *
 * @unwired reached only from the harness pages under `apps/web/browser/`. The
 * shipped app does not need to ask: `GameView` decides the world a ride is on
 * and says so itself when a load fails or a hot device leaves realism (#475).
 */
export function drawnWorldOf(view: GameView): QualitySettings['world'] {
  return view instanceof ThreeGameView ? view.drawnWorld : 'stylised';
}

/**
 * How many scenery items a view's last frame drew, in whichever world it drew —
 * what the browser gate holds a rung's budget against (#478).
 *
 * @unwired reached only from the browser gate's harness; nothing in the render
 * path needs to ask.
 */
export function sceneryDrawnOf(view: GameView): number {
  return view instanceof ThreeGameView ? view.sceneryDrawn : 0;
}

/**
 * The sky colour a view's water reflected in its last frame, linear RGB — what
 * the browser gate holds the realistic rungs' water to (#475): the line in
 * `render` that hands the water the realistic sky is one jsdom cannot reach,
 * because it has no view without a GL context.
 *
 * @unwired reached only from the browser gate's harness; nothing in the render
 * path needs to ask.
 */
export function waterSkyOf(view: GameView): readonly [number, number, number] {
  return view instanceof ThreeGameView ? view.waterSky : [Number.NaN, Number.NaN, Number.NaN];
}

/**
 * Turns the water's ripple band-limit off or on in a view — #501. The browser
 * gate's control: with it off the grazing-angle banding validation 0002 Z10
 * found must read back, or the measurement with it on proves nothing.
 *
 * @unwired reached only from the browser gate's harness; the product never
 * turns the band-limit off.
 */
export function filterWaterRipplesOf(view: GameView, on: boolean): void {
  if (view instanceof ThreeGameView) view.filterWaterRipples(on);
}

/**
 * Every mesh a view's scene holds and the material on it — ADR 0026 D-11's
 * assertion, made by the browser gate over a real scene.
 *
 * @unwired reached only from the browser gate's harness; nothing in the render
 * path needs to ask.
 */
export function sceneMaterialsOf(view: GameView): readonly SceneMaterial[] {
  return view instanceof ThreeGameView ? view.sceneMaterials() : [];
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
  /** The riders' contact shadows — #426. One draw for all of them. */
  readonly #contactShadows = new ContactShadowBelt();
  /**
   * What catches the riders' shadow MAP on the `'map'` rung — #426.
   *
   * ⚠️ **A plane of its own, because the road cannot**: the road and the
   * ground are unlit and have no shadow lookup at all. A `ShadowMaterial` draws
   * nothing but the shadow falling on it, so a flat square at the road's height
   * under the rider shows the riders' shadow over the road and nothing else.
   * It shares {@link ContactShadowBelt}'s limit — flat on a road that climbs —
   * and its depth handling: transparent, no depth write, tested, offset.
   */
  readonly #shadowCatcher = new Mesh(
    new PlaneGeometry(SHADOW_FRAME_METRES * 2, SHADOW_FRAME_METRES * 2),
    new ShadowMaterial({
      opacity: CONTACT_SHADOW_DARKNESS,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -4,
    }),
  );
  /** The `riderShadows` the view is drawing with, so a change is seen once. */
  #riderShadows: QualitySettings['riderShadows'] | undefined;
  /**
   * The world, as three objects built once and mutated thereafter — #240's
   * NFR-3. Every one of them is a fixed instance: the sky is the `Color` the
   * scene's background *is*, the fog is the `FogExp2` the scene holds, and the
   * ground is one `Mesh` that follows the camera. `#updateWorld` sets numbers
   * on these and never replaces them.
   */
  readonly #sky = new Color(UNSET_COLOUR);
  readonly #fog = new FogExp2(UNSET_COLOUR, 0);
  /** The ground beside the road — #458. @see TerrainBelt */
  readonly #terrain = new TerrainBelt();
  /** The hills on the horizon — #458. @see HorizonRing */
  readonly #horizon = new HorizonRing();
  /** The sky's gradient — #425. @see SkyDome */
  readonly #skyDome = new SkyDome();
  /** The streams and lakes — #459. @see WaterBelt */
  readonly #water = new WaterBelt();
  /** The bridges over them — #459. @see BridgeBelt */
  readonly #bridges = new BridgeBelt();
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
  /**
   * The stylised road's material — the one `#road` wears unless the realistic
   * world is drawn, and the one the surface-detail rung switches.
   */
  readonly #roadMaterial: MeshBasicMaterial;
  /**
   * What this view builds to draw the realistic world, on the first realistic
   * rung it is given while one is loaded — ADR 0026. `undefined` in every view
   * the shipped app makes, because nothing it ships asks for that rung (D-12).
   */
  #realistic: RealisticDrawing | undefined;
  /** Which world the last frame was drawn in. Never `'realistic'` without {@link #realistic}. */
  #drawing: QualitySettings['world'] = 'stylised';
  #quality: QualitySettings;
  /** This frame's world, for the sky dome, which is placed with the camera. */
  #world: WorldStyle = {
    skyColour: UNSET_COLOUR,
    groundColour: UNSET_COLOUR,
    horizonColour: UNSET_COLOUR,
    fogDensity: 0,
    sun: { x: 0, y: 1, z: 0, ambient: 0, direct: 0 },
  };
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

    // #458. The ring first, as the backdrop it is; the ground after it writes
    // depth like everything else.
    this.#skyDome.addTo(this.#scene);
    this.#horizon.addTo(this.#scene);
    this.#terrain.addTo(this.#scene);
    this.#water.addTo(this.#scene);
    this.#bridges.addTo(this.#scene);

    // `vertexColors` is what makes the surface, the two edge lines and the
    // broken centre line **one mesh and one draw call** (#242). Without it
    // each would need a material of its own, and a material is a draw call.
    // #425: the road's grain, behind the rung's define. Still ONE material.
    this.#roadMaterial = withSurfaceDetail(
      new MeshBasicMaterial({ side: DoubleSide, vertexColors: true }),
      'road',
      { value: 0 },
      { value: 1 },
    );
    this.#road = new Mesh(this.#roadGeometry, this.#roadMaterial);
    // The corridor is rebuilt in world coordinates every time, so three's own
    // frustum culling has nothing useful to test against and would occasionally
    // cull the road we just built. There is one mesh; culling it saves nothing.
    this.#road.frustumCulled = false;
    this.#scene.add(this.#road);

    this.#scatter.addTo(this.#scene);

    // #349, #368. Added here rather than in `render`, so that a frame carrying
    // no rider draws nothing rather than adding one on the frame it appears.
    this.#riders.addTo(this.#scene);

    // #426. Both are built and added once; the rung decides which one draws.
    this.#contactShadows.addTo(this.#scene);
    this.#shadowCatcher.rotation.x = -Math.PI / 2;
    this.#shadowCatcher.receiveShadow = true;
    this.#shadowCatcher.frustumCulled = false;
    this.#shadowCatcher.visible = false;
    this.#scene.add(this.#shadowCatcher);

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
    this.#updateWorld(frame.world);
    this.#world = frame.world;
    this.#terrain.update(frame.terrain.mesh, frame.world.groundColour);
    this.#horizon.update(frame.terrain.horizon, frame.world, frame.camera);
    this.#water.update(
      frame.water.surface,
      frame.world,
      frame.water.seconds,
      // #475: on the realistic rungs the water reflects the realistic sky.
      this.#drawing === 'realistic' ? realisticWorld?.sky : undefined,
    );
    this.#bridges.update(frame.water.bridges);
    this.#updateRoad(frame);
    // ⚠️ Both worlds' belts are handed the frame, and the hidden world's
    // return at once (ADR 0026 D-3): one frame, one arrangement, whichever
    // world draws it — so the two can never disagree about where a tree is.
    this.#scatter.update(frame.scatter, frame.camera);
    this.#realistic?.updateScenery(frame.scatter, frame.camera);
    this.#realistic?.riders.place(frame.markers);
    this.#updateMarkers(frame.markers);
    this.#updateShadows(frame);
    this.#placeCamera(frame.camera);
    this.#renderer.render(this.#scene, this.#camera);
  }

  setQuality(settings: QualitySettings): void {
    this.#quality = settings;
    this.#applyShading();
    this.#applyRiderShadows();
    // #245. Applied here rather than read in `render`, so that the rung is a
    // property of the belt between frames and the render loop takes no scenery
    // decision at all. @see ScatterBelt.setBudget
    // ⚠️ Since #460 the frame carries the structures before the scenery, each
    // with a budget of its own, so the belt's is the two together.
    this.#scatter.setBudget(settings.scatterItems + settings.structureItems);
    this.#realistic?.setBudget(settings.scatterItems + settings.structureItems);
    // #367, and the same argument one line up: a rung is a property of the belt
    // between frames, so the render loop takes no decision about how many
    // distinct shapes it may draw. @see ScatterBelt.setVariants
    this.#scatter.setVariants(settings.sceneryVariants);
    // #458. How much ground beyond the road this rung draws.
    this.#terrain.setBands(settings.terrainBands);
    // #459. The water shader, or one flat colour.
    this.#water.setDrawn(settings.water);
    // #425. The grain and the patchwork, on the target rung only.
    this.#terrain.setSurfaceDetail(settings.surfaceDetail);
    setSurfaceDetail(this.#roadMaterial, settings.surfaceDetail);
    // ADR 0026. Which world this rung draws — after everything above, so the
    // realistic belts it may build are budgeted by the same rung.
    this.#applyWorld(settings.world);
    this.#applySize();
  }

  /**
   * Draws the world a rung asks for — ADR 0026 D-3 and D-10.
   *
   * ⚠️ **A realistic rung draws the realistic world only when one is loaded.**
   * Without one — nobody asked `loadRealisticWorld`, or it failed — the view
   * draws the stylised world, whole, and `drawnWorldOf` says so: D-7's
   * fallback, and the reason the harness's notice can be true.
   *
   * ⚠️ **Leaving the realistic world frees it**, from this view and from the
   * GPU: the textures are disposed, so a phone that stepped down because it was
   * hot is not left holding a hundred mebibytes it will not draw again this
   * ride — `quality.ts` §`nextWorldQuality` never climbs back.
   */
  #applyWorld(wanted: QualitySettings['world']): void {
    const loaded = realisticWorld;
    const world =
      wanted === 'realistic' && loaded !== undefined && this.#renderer !== undefined
        ? 'realistic'
        : 'stylised';
    if (world === this.#drawing) {
      return;
    }
    this.#drawing = world;
    const realistic = world === 'realistic';
    if (realistic && loaded !== undefined && this.#renderer !== undefined) {
      if (this.#realistic === undefined) {
        this.#realistic = new RealisticDrawing(loaded, this.#renderer, this.#terrain.fields);
        this.#realistic.addTo(this.#scene);
        this.#realistic.setBudget(this.#quality.scatterItems + this.#quality.structureItems);
      }
    }
    const drawing = realistic ? this.#realistic : undefined;
    this.#scatter.setShown(!realistic);
    this.#riders.setShown(!realistic);
    this.#skyDome.mesh.visible = !realistic;
    this.#realistic?.setShown(realistic);
    this.#road.material = drawing?.road ?? this.#roadMaterial;
    this.#terrain.setPhotographic(drawing?.ground);
    this.#bridges.setWorld(world, realistic ? loaded?.structures.get('stone') : undefined);
    this.#scene.background =
      drawing === undefined || loaded === undefined ? this.#sky : loaded.sky.texture;
    this.#scene.environment = drawing?.environment ?? null;
    if (this.#renderer !== undefined) {
      this.#renderer.toneMapping = realistic ? AgXToneMapping : NoToneMapping;
      this.#renderer.toneMappingExposure = REALISTIC_EXPOSURE;
    }
    if (!realistic && this.#realistic !== undefined) {
      this.#realistic.dispose();
      this.#realistic = undefined;
      evictRealisticWorldFromGpu();
    }
  }

  /** How many scenery items the last frame drew, in the world it drew. @see sceneryDrawnOf */
  get sceneryDrawn(): number {
    return this.#realistic?.sceneryDrawn ?? this.#scatter.drawnItems;
  }

  /** Which world the last rung this view was given is drawn in. @see drawnWorldOf */
  get drawnWorld(): QualitySettings['world'] {
    return this.#drawing;
  }

  /** @see filterWaterRipplesOf */
  filterWaterRipples(on: boolean): void {
    this.#water.setRippleFilter(on);
  }

  /** The sky the water reflected in the last frame. @see waterSkyOf */
  get waterSky(): readonly [number, number, number] {
    return this.#water.reflectedSky;
  }

  /** Every mesh in the scene and what it wears — for the harness's D-11 check. @see sceneMaterialsOf */
  sceneMaterials(): readonly SceneMaterial[] {
    const found: SceneMaterial[] = [];
    this.#scene.traverse((node) => {
      const mesh = node as Partial<Mesh>;
      if (mesh.isMesh !== true || mesh.material === undefined) return;
      let visible = true;
      for (let at: Object3D | null = node; at !== null; at = at.parent) {
        if (!at.visible) visible = false;
      }
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        found.push({ visible, type: material.type, constructed: isConstructedMaterial(material) });
      }
    });
    return found;
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
    this.#terrain.setShading(shading);
    this.#bridges.setShading(shading);
  }

  /**
   * The rung's way of grounding the riders — #426. @see QualitySettings.riderShadows
   *
   * ⚠️ **`shadowMap.enabled` is renderer state that three bakes into every lit
   * material's program**, so turning it on or off after the first frame needs
   * those programs rebuilt — the rider's two materials and the catcher. Done
   * only when the value CHANGES. The map is turned on at most once a ride and
   * off at most once: the map rung is above the ladder, the first step down
   * leaves it, and `quality.ts` §`keepsShadowMap` is the latch that stops a
   * climb back to level 0 re-entering it. Without that latch this rebuild ran
   * on every 0 → 1 → 0 round trip, and the stall it causes is itself a
   * frame-time spike that can push the ladder down again.
   */
  #applyRiderShadows(): void {
    const { riderShadows } = this.#quality;
    if (riderShadows === this.#riderShadows) {
      return;
    }
    this.#riderShadows = riderShadows;
    const map = riderShadows === 'map';
    if (this.#renderer !== undefined) {
      this.#renderer.shadowMap.enabled = map;
    }
    this.#lighting.setCasting(map);
    this.#riders.setCasting(map);
    this.#riders.recompile();
    this.#shadowCatcher.visible = map;
    this.#shadowCatcher.material.needsUpdate = true;
    this.#contactShadows.setShown(riderShadows === 'contact');
  }

  /** Where this frame's shadows fall — #426. */
  #updateShadows(frame: SceneFrame): void {
    this.#contactShadows.place(frame.markers, frame.world.sun);
    if (this.#riderShadows === 'map') {
      const pose = frame.camera;
      this.#lighting.aimShadowAt(pose.x, pose.y, pose.z, frame.world.sun);
      this.#shadowCatcher.position.set(pose.x, pose.y + CONTACT_SHADOW_LIFT_METRES, pose.z);
    }
  }

  resize(widthCssPixels: number, heightCssPixels: number): void {
    this.#widthCssPixels = Math.max(1, widthCssPixels);
    this.#heightCssPixels = Math.max(1, heightCssPixels);
    this.#applySize();
  }

  destroy(): void {
    this.#realistic?.dispose();
    this.#roadGeometry.dispose();
    this.#terrain.dispose();
    this.#horizon.dispose();
    this.#skyDome.dispose();
    this.#water.dispose();
    this.#bridges.dispose();
    this.#roadMaterial.dispose();
    this.#scatter.dispose();
    this.#lighting.dispose();
    this.#riders.dispose();
    this.#contactShadows.dispose();
    this.#shadowCatcher.geometry.dispose();
    this.#shadowCatcher.material.dispose();
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
   * is the landform's own colour, near the camera where the fog has not
   * reached — {@link TerrainBelt.update} takes it, since #458.
   *
   * ⚠️ **This method used to place a flat ground plane under the rider**, and a
   * reviewer who remembers it following the camera 0.25 m under the road is
   * reading the old file. The ground is the route's own landform since #458.
   */
  #updateWorld(world: WorldStyle): void {
    this.#sky.setHex(world.skyColour);
    this.#fog.color.setHex(world.horizonColour);
    this.#fog.density = world.fogDensity;
    // ⚠️ Every frame, like the fog and for the same reason: the world is a
    // function of the route and a renderer is handed a frame, not a route. A
    // sun pointed once in the constructor would be the previous route's sun
    // for the whole of the next ride.
    const loaded = realisticWorld;
    if (this.#drawing === 'realistic' && loaded !== undefined) {
      // ADR 0026 D-9: the sky is the ambient term, solved to give a horizontal
      // surface exactly `world.ts`'s ambient share, and turned so its sun
      // stands where `world.ts`'s does. `realistic-light.ts` has the arithmetic.
      this.#lighting.apply(world.sun, 0);
      const intensity = environmentIntensity(world.sun.ambient, loaded.sky.upward);
      this.#scene.environmentIntensity = intensity;
      this.#scene.backgroundIntensity = intensity;
      const turn = skyRotation(loaded.sky.sunU, world.sun.x, world.sun.z);
      this.#scene.backgroundRotation.set(0, turn, 0);
      this.#scene.environmentRotation.set(0, turn, 0);
    } else {
      this.#lighting.apply(world.sun);
    }
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
      // ADR 0026: the photographic road is lit, and a lit surface needs a
      // normal. Straight up, written once when the buffer grows and never per
      // frame: the road is within a few degrees of level, and the stylised
      // road's own note on that (the header) applies — the normal MAP is what
      // gives the asphalt its relief.
      const up = new Float32Array(this.#vertexCapacity);
      for (let at = 1; at < up.length; at += 3) up[at] = 1;
      this.#roadGeometry.setAttribute('normal', new BufferAttribute(up, 3));
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
    // #425. The sky is centred on the eye, so it is always the same distance
    // away in every direction and only its colours carry any information.
    this.#skyDome.update(this.#world, eye);
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

/** The renderer this app ships. @see GameRenderer */
export const threeGameRenderer: GameRenderer = {
  create(canvas, settings) {
    return new ThreeGameView(canvas, settings);
  },
  // #475: the one way the shipped app reaches the realistic world, and only
  // for a rider who chose it. @see GameRenderer.loadRealisticWorld
  // ⚠️ Through `loadRealisticWorldOnce`, never the raw loader: a second
  // realistic ride in one visit must reuse the world, not replace it under a
  // view that is drawing it — #475's review.
  loadRealisticWorld: () => loadRealisticWorldOnce(),
};
