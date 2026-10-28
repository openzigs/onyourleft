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
 *   them — `quality.ts` §`RIDER_SHADOW_MAP_RUNG`, above the ladder, and since
 *   #547 the rung every STYLISED ride starts on, the owner's ruling after
 *   validation 0002 Part T; the ladder's first step down leaves it for the
 *   ride. ⚠️ A reviewer who remembers "off unless a device asks for it" is
 *   reading the old file. The blob is the fallback on every other rung, and
 *   the realistic world's. `ThreeGameView.prepare` draws the ride's first
 *   frame into one pixel before any frame is shown, which is what moved the
 *   ride's opening stall out of the ride.
 *   The scenery neither casts nor receives on any rung, and
 *   `three-seam.test.ts` counts every `castShadow` and `receiveShadow` write
 *   in this file to keep it so.
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
  type CompressedTexture,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  DataTexture,
  DataUtils,
  DynamicDrawUsage,
  EqualDepth,
  EquirectangularReflectionMapping,
  Euler,
  FileLoader,
  FogExp2,
  Group,
  HalfFloatType,
  InstancedBufferAttribute,
  InstancedMesh,
  LatheGeometry,
  LinearFilter,
  LinearMipmapLinearFilter,
  LoadingManager,
  Matrix3,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshStandardMaterial,
  NearestFilter,
  NoToneMapping,
  OctahedronGeometry,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  Quaternion,
  ClampToEdgeWrapping,
  RepeatWrapping,
  Scene,
  ShaderMaterial,
  ShadowMaterial,
  SphereGeometry,
  RGB_ETC1_Format,
  RGB_ETC2_Format,
  RGBA_ASTC_4x4_Format,
  RGBA_BPTC_Format,
  RGBA_ETC2_EAC_Format,
  RGBA_PVRTC_4BPPV1_Format,
  RGBA_S3TC_DXT1_Format,
  RGBA_S3TC_DXT5_Format,
  RGB_PVRTC_4BPPV1_Format,
  RGBAFormat,
  RGFormat,
  SRGBColorSpace,
  TextureLoader,
  TorusGeometry,
  UnsignedByteType,
  RedFormat,
  ShaderChunk,
  UniformsLib,
  UniformsUtils,
  Vector2,
  Vector3,
  Vector4,
  WebGLRenderer,
  type Bone,
  type DepthModes,
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
// ⚠️ **#618: the realistic textures are KTX2**, and three 0.185.1 ships this
// loader too (ADR 0026 D-2, D-8). Its transcoder is Binomial's Apache-2.0 Basis
// Universal, vendored inside `three`, which `DEP001` cannot see — so it is
// copied into the build by `tools/basis/transcoder-plugin.ts` and noticed by
// hand. @see compressedRealisticLoaders
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';

import type { KitColour } from '@onyourleft/store';

import {
  AWNING_PAINTS,
  AWNING_STRIPE_PAINT,
  DOOR_PAINTS,
  LOT_PAINTS,
  lotModelPaint,
  lotPaintChannel,
  paintChannelOf,
  LOT_CLAD_STEP,
  LOT_PORCH_STEP,
  lotSidingPaints,
  modelPaint,
  paintsOf,
  roofPaintsOf,
  SHINGLE_PAINTS,
  SIGN_PAINTS,
  TRIM_PAINTS,
  type Rgb,
} from './building-paint';
import {
  AWNING_STRIPE_METRES,
  CLAPBOARD,
  COMMERCIAL_WINDOW_IN_BAY,
  DOOR_IN_FACE,
  DORMER_SASH,
  FACADE_AO,
  OVERHANG_SHADOW,
  FOUNDATION,
  GARAGE_DOOR,
  LOT_CLAPBOARD_COURSE_METRES,
  MULLION_METRES,
  PAIR_MIN_BAY_METRES,
  PAVING,
  PICTURE,
  RAILING,
  REVEAL,
  REVEAL_DEPTH_METRES,
  REVEAL_GRAZE,
  SASH,
  SASH_TOP_SHARE,
  SHINGLE,
  SHOP_DOOR,
  CURTAIN_WALL,
  SHOP_FRONT,
  SHUTTER,
  SIGN_MOULDING_METRES,
  SILL,
  streakShareOf,
  WEATHERING,
  WINDOW_IN_BAY,
  WINDOW_SILL_METRES,
} from './facade';
import { settlingBasisWorker } from './basis-worker';
import { FRONT_PORCH } from './porch';
import { HOUSE_MODELS, placedPoint, placeOnPlot, type HousePlacement } from './house-models';
import {
  EAVES_OVERHANG_METRES,
  BAY_METRES,
  CLAD_BLOCK,
  CLAD_BRICK,
  CLAD_CLAPBOARD,
  CLAD_PAVING,
  CLAD_SHINGLE,
  DOOR_FACE,
  DOOR_SURROUND_METRES,
  FACADE_AWNING,
  FACADE_DORMER,
  FACADE_FLOATS,
  FACADE_GARAGE,
  FACADE_OFFSET,
  FACADE_SHOPFRONT,
  FACADE_SIGN,
  FACADE_RAILING,
  FOOTPRINT_SURFACES,
  FOOTPRINT_VERTEX_FLOATS,
  GARAGE,
  minimumAreaRectangle,
  ROOF_ROLES,
  SHINGLE_COURSE_METRES,
  STOREY_METRES,
  STYLE_BRICK_FOUNDATION,
  STYLE_COMMERCIAL,
  STYLE_EAVES,
  STYLE_FLAT_ROOF,
  STYLE_FLOATS,
  STYLE_GLAZED,
  STYLE_OFFSET,
  STYLE_SASH,
  STYLE_SHUTTERS,
  type FootprintPlan,
  type FootprintRole,
} from './footprint-buildings';
import {
  FAR_ROLES,
  MappedSelection,
  NEAR_ROLES,
  NO_RIVALS,
  roleTriangles,
  selectMappedBuildings,
  surfaceOfRole,
  type MappedBuildings,
  type MappedBuildingsInView,
  type RivalStructures,
} from './mapped-buildings';
import {
  BUILDING_ROLES,
  BUILDING_VARIANTS,
  buildingPlan,
  FOUNDATION_METRES,
  isBuiltKind,
  LOT_PORCH,
  PLINTH_TOP_METRES,
  type BuildingPlan,
  type BuildingRole,
  type BuiltKind,
} from './buildings';
import {
  BICYCLE_COLOURS,
  CRANK_AXIS_Y,
  HOUSE_KIT,
  PACER_KIT,
  CRANK_AXIS_Z,
  LEG_BONE_COUNT,
  LIMB_RADIUS_METRES,
  RIDER_BICYCLE_PARTS,
  RIDER_UPPER_BODY_PARTS,
  UPPER_BODY_PIVOT,
  RIDER_CRANK_PARTS,
  RIDER_PALETTE,
  emptyRiderJoints,
  riderKitFor,
  emptyRiderMotion,
  legBones,
  riderJoints,
  riderMotion,
  type RiderMotion,
  type JointPoint,
  type RiderKit,
  type RiderPart,
} from './bicycle';
import {
  cassetteUv,
  chainringUv,
  HUB_RADIUS_METRES,
  HUB_WIDTH_METRES,
  paintUv,
  PLAIN_METAL_UV,
  PLAIN_RUBBER_UV,
  tapeUv,
  tyreUv,
  type Uv,
} from './bicycle-surfaces';
import {
  rasteriseSilhouette,
  silhouetteThrow,
  SILHOUETTE_ALONG_TEXELS,
  SILHOUETTE_EDGE_METRES,
  SILHOUETTE_MARGIN_METRES,
  SILHOUETTE_TAPS,
  SILHOUETTE_UP_TEXELS,
  type RiderSilhouette,
} from './rider-silhouette';
import {
  CASTS_CONTACT_SHADOW,
  CONTACT_SHADOW_DARKNESS,
  CONTACT_SHADOW_LIFT_METRES,
  placeContactShadow,
  sunThrowPerMetre,
  type ContactShadow,
  type SunThrow,
} from './contact-shadow';
import {
  blobCasters,
  GROUND_BLOB_CORE,
  GROUND_BLOB_DARKNESS,
  GROUND_BLOB_LIFT_METRES,
  groundBlobAxes,
  groundUnderBlob,
  placeGroundBlob,
  roadClip,
  type BlobCaster,
  type BlobCasters,
  type GroundBlob,
  type GroundPoint,
} from './ground-blob';
import {
  HORIZON_RADIUS_METRES,
  HORIZON_SEGMENTS,
  TERRAIN_BANDS,
  terrainMeshIsCurrent,
  type HorizonRelief,
  type TerrainMesh,
} from './landform';
import type { QualitySettings } from './quality';
import { GAIT_PHASES, GAITS, gaitPose } from './gait';
import {
  ANIMATION_BYTES_PER_TEXEL,
  ANIMATION_ROWS,
  PERSON_MAX_TRIANGLES,
  PersonRegion,
  animationRow,
  clusterDecimate,
  dressed,
  regionOf,
  vertexNormals,
} from './people-body';
import {
  NO_PEOPLE,
  PEOPLE_FAR_MAX,
  PEOPLE_NEAR_MAX,
  gaitIndex,
  type PeopleInView,
  type Person,
} from './people';
import {
  isRealisticVegetation,
  PHOTOGRAPHIC_STRUCTURE_SURFACES,
  REALISTIC_BICYCLE_MAPS,
  REALISTIC_BICYCLE_MAP_NAMES,
  REALISTIC_RIDER,
  REALISTIC_WORDMARK,
  REALISTIC_HOUSE_ATLAS,
  REALISTIC_HOUSE_MODEL_IDS,
  houseModelFile,
  REALISTIC_RIDER_KIT_MEAN,
  REALISTIC_RIDER_MAPS,
  REALISTIC_RIDER_MAP_NAMES,
  REALISTIC_SKY,
  REALISTIC_BOUNDARY_PARTS,
  REALISTIC_BUILDING_SURFACES,
  isPhotographic,
  REALISTIC_STRUCTURE_SURFACES,
  surfaceRepeat,
  REALISTIC_SURFACES,
  REALISTIC_TREES_DEFAULT,
  REALISTIC_VEGETATION_KINDS,
  realisticVegetation,
  realisticUrl,
  type RealisticBicycleMap,
  type RealisticRiderMap,
  type RealisticTrees,
  type RealisticVegetationKind,
  type PhotographicSurface,
  type RealisticWorldOutcome,
  type StructureSurface,
} from './realistic-assets';
import { REALISTIC_TRANSCODER_DIRECTORY } from './transcoder-files';
import { LABEL_FONT } from '../map/basemap';
import {
  BANNER_CELLS,
  bannerAtlas,
  readGlyphRange,
  type BannerAtlas,
  type BannerCell,
} from './banner-atlas';
import { bannerCells } from './gantry-wording';
import { bannerPlace, boxPoint, standPoint, type PlacedBox, type PlacedStand } from './gantry';
import type { Billboard } from './billboards';
import {
  FURNITURE_DRAW_METRES,
  FURNITURE_KINDS,
  FURNITURE_SURFACES,
  type FurnitureItem,
  type FurnitureKind,
  type FurnitureSurface,
  type PavementMesh,
  type VillageStreet,
} from './streets';
import type { SideRoad } from './cross-streets';
import {
  LOGO_BOARDS_PER_FRAME,
  billboardLogoPlace,
  carriesTheLogo,
  gateLogoPlace,
  logoBoxes,
  type LogoPlace,
} from './logo-board';
import gameWordmarkUrl from './brand/game-wordmark.png?url';
import {
  FOLIAGE_SWAY_METRES,
  FOLIAGE_WAVES,
  foliageWindDirection,
  IMPOSTOR_CROWN_SHARE,
  IMPOSTOR_RELIGHT_RANGE,
  SCRIPT_SKY_SHARE,
  scriptSunToward,
  WOOD_SWAY_SHARE,
} from './foliage-light';
import {
  ROAD_EDGE_METRES,
  ROCK_SLOPE_DEGREES,
  SCREE_BAND_METRES,
  VERGE_BLEND_METRES,
} from './ground-blend';
import {
  CARRIAGEWAY_HALF_METRES,
  DUST_BAND_METRES,
  DUST_LIGHTEN,
  MAXIMUM_ROAD_PATCHES,
  MAXIMUM_WEAR_SHARE,
  PAINT_WEAR,
  ROAD_PATCH_FLOATS,
  roadPatchUniforms,
  WHEEL_TRACK_EDGE_METRES,
  WHEEL_TRACK_HALF_WIDTH_METRES,
  WHEEL_TRACK_LIGHTEN,
  WHEEL_TRACK_OFFSETS_METRES,
  WHEEL_TRACK_RELIEF,
  WHEEL_TRACK_ROUGHNESS,
  writeRoadAcross,
  writeRoadPatchReach,
} from './road-wear';
import {
  MAPPED_BUILDING_DRAW_CALLS,
  MAPPED_BUILDING_MAX,
  MAPPED_BUILDING_TRIANGLES,
  REALISTIC_DECORATION_TRIANGLES,
  REALISTIC_GROUND_BLOBS,
  REALISTIC_NEAR_MESHES,
  REALISTIC_REMOTE_RIDERS,
  REALISTIC_REMOTE_STYLISED_RIDERS,
  REALISTIC_STRUCTURE_ITEMS,
  REALISTIC_TREE_LEVELS,
  REALISTIC_TRIANGLES,
} from './realistic-budget';
import { MAXIMUM_DRAWN_SET } from '../net/interest';
import {
  FOLIAGE_TINT,
  MASONRY_TINT,
  packedInstanceTint,
  TINT_CODEC_RANGE,
  TINT_CODEC_STEPS,
  TINT_CODEC_ZERO,
  type TintBound,
} from './instance-tint';
import {
  bandFade,
  highBound,
  lowBound,
  treeLevelAt,
  treeSlots,
  TreeHandOver,
  writeInterval,
  type TreeLevels,
} from './tree-levels';
import {
  directionalFogColour,
  drawnHorizonColour,
  environmentIntensity,
  flattenedTable,
  halfToFloat,
  HORIZON_AZIMUTH_BINS,
  PHOTOGRAPHIC_ROAD_GRAIN,
  REALISTIC_EXPOSURE,
  REALISTIC_FOG_DIRECTION_SHARE,
  REALISTIC_HORIZON_BAND,
  REALISTIC_HORIZON_HAZE_SHARE,
  REALISTIC_VALLEY_DEPTH_METRES,
  REALISTIC_VALLEY_HAZE,
  reflectedSkyColour,
  skyBandRadiance,
  skyHorizonTable,
  ridgeLift,
  skylineCrestFloor,
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
  CAMERA_ABOVE_METRES,
  CAMERA_BEHIND_METRES,
  CAMERA_FIELD_OF_VIEW_DEGREES,
  FRUSTUM_SPREAD,
  NEAR_PLANE_METRES,
  cameraRig,
  type CameraRig,
  verticalFieldOfViewDegrees,
} from './camera';
import {
  ROAD_SURFACE_GRAIN,
  ROAD_WIDTH_METRES,
  VIEW_AHEAD_METRES,
  VIEW_BEHIND_METRES,
  type RoadCorridor,
} from './terrain';
import {
  clearOfTheCamera,
  prepareShape,
  type DrawnWorld,
  type ShapeTriangles,
  type ShapesOf,
} from './near-field';
import {
  BOUNDARY_PIECE_METRES,
  FIELD_DEPTH_METRES,
  FIELD_EDGE_LATERAL_METRES,
  STRUCTURE_FOOTPRINTS,
} from './settlements';
import {
  MAXIMUM_BRIDGE_PARTS,
  waterSurfaceIsCurrent,
  type BridgePart,
  type WaterSurface,
} from './waterways';
import { groundColourIn, roofSnowIn, type SunStyle, type WorldStyle } from './world';
import { NO_SEASON, type Holiday, type Season } from './season';
import {
  decorationsFor,
  HOLIDAY_DECORATIONS,
  PUMPKIN,
  WREATH_BERRY,
  WREATH_GREEN,
  type DecorationItem,
  type DecorationKind,
  type DecorationShape,
  type ItemTable,
} from './decorations';

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
 * A **multiplier** on a rider's colours, applied per instance. The bot's
 * orange and the ghost's grey are the hues #93 already settled on and they are
 * unchanged; what changed is that they now tint a whole bicycle instead of
 * filling a solid, so the bot reads as an orange machine and the ghost as a
 * colourless one against the rider's teal-and-silver.
 *
 * ⚠️ **Since #623 a tint multiplies the kit its kind WEARS
 * ({@link RIDER_KITS}), not the rider's.** The rider's jersey became the app's
 * teal accent, and orange times teal is near-black with green leading red —
 * #742's review, 7,9,1 against main's 20,11,5. The pacer and the ghost wear
 * `bicycle.ts` §`PACER_KIT`, the blue they were told apart in, so each keeps
 * the colour it had on main.
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
  // #783: another real rider in a room wears the blue kit untinted — a rider
  // in blue, where the pacer is orange over it and the ghost is grey.
  remote: 0xffffff,
};

/**
 * How many riders the stylised belts can draw at once — #783: the rider, the
 * pacer, the ghost, and every other rider a room's interest set can hold
 * (`net/interest.ts` §`MAXIMUM_DRAWN_SET`, K ≤ 100 plus the hysteresis). All
 * of them are instances of the SAME four meshes, so this is a capacity and not
 * a draw call: `game.browser.spec.ts` §"#783" counts the calls with the room
 * full and holds them at `SCENE_DRAW_CALLS`.
 */
export const STYLISED_RIDER_SLOTS = 3 + MAXIMUM_DRAWN_SET;

/**
 * Which remote riders a realistic frame draws, and how — #783, the rule the
 * issue asks to be stated. The rider, the pacer and the ghost are the
 * realistic world's own; of the remote riders, the
 * `realistic-budget.ts` §`REALISTIC_REMOTE_RIDERS` nearest to the rider wear
 * the realistic body too, the next §`REALISTIC_REMOTE_STYLISED_RIDERS` are
 * drawn by the STYLISED belt, and the rest are not drawn in this world at all
 * — which is what keeps the frame inside §`REALISTIC_FRAME_TRIANGLES` (the
 * arithmetic is there). Nearest by straight-line distance from the rider's
 * own marker; internal to the renderer, and never shown as an order.
 *
 * ⚠️ **A realistic frame mixes the two worlds' riders here, and only here**,
 * which ADR 0026 D-3 otherwise forbids: #783 names exactly this ("drawn with
 * the stylised rider or an impostor, per a stated rule") so that #681's pack
 * of realistic riders stays blocked on the tablet's measurement.
 * `three-renderer.test.ts` §"#783" holds the split; the browser gate's
 * realistic load counts the triangles it leaves a frame.
 */
export function realisticRemoteSplit(markers: readonly RiderMarker[]): {
  readonly realistic: readonly RiderMarker[];
  readonly stylised: readonly RiderMarker[];
} {
  const own = markers.find((marker) => marker.kind === 'rider');
  const local = markers.filter((marker) => marker.kind !== 'remote');
  const far = (marker: RiderMarker): number =>
    own === undefined ? 0 : Math.hypot(marker.x - own.x, marker.y - own.y, marker.z - own.z);
  const remote = markers
    .filter((marker) => marker.kind === 'remote')
    .map((marker) => ({ marker, far: far(marker) }))
    .sort((a, b) => a.far - b.far)
    .map((each) => each.marker);
  return {
    realistic: [...local, ...remote.slice(0, REALISTIC_REMOTE_RIDERS)],
    stylised: remote.slice(
      REALISTIC_REMOTE_RIDERS,
      REALISTIC_REMOTE_RIDERS + REALISTIC_REMOTE_STYLISED_RIDERS,
    ),
  };
}

/**
 * The kit each kind wears UNDER its tint — #623. The rider wears the house kit
 * (`bicycle.ts` §`HOUSE_KIT`, the app's accent); the pacer and the ghost wear
 * `bicycle.ts` §`PACER_KIT`, the blue #368 told them apart in, because
 * {@link RIDER_TINTS} multiplies and cannot put back a hue the kit lacks.
 *
 * ⚠️ **Read per rider by both worlds**: {@link RiderBelt} writes it per
 * instance over the jersey and leg vertices (@see withKitPerInstance), and
 * {@link RealisticRiderBelt} into each body's own kit uniform. A rider's own
 * colour choice (#623's second half) replaces the `rider` entry and nothing
 * else, at no draw call.
 */
const RIDER_KITS: Readonly<Record<RiderMarker['kind'], RiderKit>> = {
  rider: HOUSE_KIT,
  bot: PACER_KIT,
  ghost: PACER_KIT,
  remote: PACER_KIT,
};

/**
 * {@link RIDER_KITS} with the rider's own entry replaced by the kit they chose
 * — #623's second half. The pacer's and the ghost's are never replaced: the
 * owner ruled on the rider's kit and on nobody else's, and #368 tells the
 * three apart by the kit their KIND wears.
 */
function kitsWith(riderKit: RiderKit): Readonly<Record<RiderMarker['kind'], RiderKit>> {
  return { ...RIDER_KITS, rider: riderKit };
}

/**
 * Everything one rider's leg pose depends on, in the order {@link RiderBelt}
 * stores it — six numbers a slot since #499 added the lean, which is as much
 * the rider's world transform as the heading is.
 *
 * ⚠️ **The four before the angle are the rider's own world transform**, and
 * leaving them out is the defect #366–#368's review found: a leg segment's
 * matrix is composed in world space, so it goes stale when the rider moves as
 * readily as when the cranks turn. Written out rather than left implicit
 * because the reason the position belongs in an *animation* cache is not
 * obvious from the call site. The scale is not here: every rider is drawn at 1.
 */
const POSE_KEY = ['x', 'y', 'z', 'yaw', 'lean', 'crankAngle'] as const;

/** Where the crank angle is in a slot's {@link POSE_KEY}. */
const POSE_CRANK = POSE_KEY.indexOf('crankAngle');

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
      porch: 0xcfc8b8,
      'porch-roof': 0x4a4038,
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
      porch: 0x6b5238,
      'porch-roof': 0x55595e,
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
      porch: 0x2f4a3f,
      'porch-roof': 0x5e6166,
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
      porch: 0x7b8185,
      'porch-roof': 0x6f7478,
    },
  };

/** The side of a fence post's square section, in metres. */
const FENCE_POST_METRES = 0.12;

/**
 * Where a fence's end posts stand along its run: their OUTER faces on the ends
 * of the {@link BOUNDARY_PIECE_METRES} piece, so the fence stays inside
 * `settlements.ts` §`STRUCTURE_FOOTPRINTS` — #602. They were centred on the
 * ends until then and reached 6 cm past the footprint `structureClearance`
 * holds from the road; moving the posts rather than the footprint leaves the
 * placement, and the arrangement digest, as they were.
 */
const FENCE_END_POST_Z = BOUNDARY_PIECE_METRES / 2 - FENCE_POST_METRES / 2;

/** A hedge's half-width at its widest, in metres: **0.55**, the box's it replaces. */
const HEDGE_HALF_WIDTH_METRES = 0.55;

/** How high a hedge's top stands at its highest, in metres: **1.3**, the box's. */
const HEDGE_TOP_METRES = 1.3;

/** How far into the ground a hedge is set, in metres: **0.5**, as every field boundary is. */
const HEDGE_FOOT_METRES = 0.5;

/** How many rings a hedge is lofted through along its piece: **17**, a ring every 46 cm. */
const HEDGE_RINGS = 17;

/** How many faces each ring has, foot to foot over the top: **8**. */
const HEDGE_PROFILE_FACES = 8;

/** How much a hedge's surface is carved in from its box, at most: **0.14** of its reach. */
const HEDGE_ROUGHNESS = 0.14;

/** How far in from each end a hedge starts to taper, in metres: **1.2**. */
const HEDGE_TAPER_METRES = 1.2;

/** How wide and how high a hedge is at its very end, of its middle's: **0.45** and **0.55**. */
const HEDGE_END_SHARE = { width: 0.45, height: 0.55 } as const;

/**
 * A hedge's shape — #1617: rounded and irregular rather than a box, its ends
 * tapering, so that a short stretch of it (#1542's `hedge-breaks`) reads as
 * planting and not as a box set on the verge. Built from numbers, as the box
 * was (ADR 0009); nothing is downloaded, and it wears the photograph the box
 * wore (`realistic-assets.ts` §`REALISTIC_STRUCTURE_SURFACES`, Poly Haven's
 * `forest_leaves_02`, already admitted).
 *
 * A loft along `+z` through {@link HEDGE_RINGS} rings, each a rounded arch of
 * {@link HEDGE_PROFILE_FACES} faces from its foot on one side, over the top,
 * to its foot on the other — `|cos|`, `|sin|` to the power 0.6, a box with its
 * corners rounded. Every point is carved in from that arch by a fixed sum of
 * sines along the run and round the arch, by up to {@link HEDGE_ROUGHNESS}, so
 * the top is lumpy and the sides bulge; over the last
 * {@link HEDGE_TAPER_METRES} of each end it narrows and falls to
 * {@link HEDGE_END_SHARE}, and closes on a point at the piece's end. The
 * bottom is open: it is {@link HEDGE_FOOT_METRES} under the ground.
 *
 * ⚠️ **Carved IN, never out**: every vertex is inside the box it replaces —
 * 1.1 m by 8 m, its top at 1.3 m — so `settlements.ts`
 * §`STRUCTURE_FOOTPRINTS` and the room `scenery.ts` measures it by hold
 * unchanged (`boundary-footprint.test.ts`). 276 triangles: under a
 * structure's ceiling (`realistic-budget.ts` §`REALISTIC_TRIANGLES`), and the
 * same shape in both worlds. One shape, so still one instanced hedge draw.
 */
function hedgeGeometry(): BufferGeometry {
  const half = BOUNDARY_PIECE_METRES / 2;
  const reach = HEDGE_TOP_METRES + HEDGE_FOOT_METRES;
  const last = half - HEDGE_TAPER_METRES / 4;
  const positions: number[] = [];
  const index: number[] = [];
  const smooth = (t: number): number => {
    const c = Math.min(1, Math.max(0, t));
    return c * c * (3 - 2 * c);
  };
  for (let ring = 0; ring < HEDGE_RINGS; ring += 1) {
    const z = -last + (2 * last * ring) / (HEDGE_RINGS - 1);
    const taper = smooth((half - Math.abs(z)) / HEDGE_TAPER_METRES);
    const width = HEDGE_END_SHARE.width + (1 - HEDGE_END_SHARE.width) * taper;
    const height = HEDGE_END_SHARE.height + (1 - HEDGE_END_SHARE.height) * taper;
    for (let face = 0; face <= HEDGE_PROFILE_FACES; face += 1) {
      const angle = (Math.PI * face) / HEDGE_PROFILE_FACES;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      // 0 to 1: how far this point is carved in.
      const carve =
        0.5 +
        0.25 * Math.sin(2.1 * z + 1.3 * angle + 0.4) +
        0.25 * Math.sin(3.7 * z - 2.2 * angle + 1.9);
      const keep = 1 - HEDGE_ROUGHNESS * carve;
      positions.push(
        Math.sign(cos) * Math.abs(cos) ** 0.6 * HEDGE_HALF_WIDTH_METRES * width * keep,
        -HEDGE_FOOT_METRES + Math.abs(sin) ** 0.6 * reach * height * keep,
        z,
      );
    }
  }
  const row = HEDGE_PROFILE_FACES + 1;
  for (let ring = 0; ring + 1 < HEDGE_RINGS; ring += 1) {
    for (let face = 0; face < HEDGE_PROFILE_FACES; face += 1) {
      const a = ring * row + face;
      const b = a + 1;
      const c = a + row;
      const d = c + 1;
      index.push(a, b, c, b, d, c);
    }
  }
  // Each end closed on a point at the piece's end, about 9 cm above the ground.
  const tipY = -HEDGE_FOOT_METRES + reach * HEDGE_END_SHARE.height * 0.6;
  const back = positions.length / 3;
  positions.push(0, tipY, -half);
  const front = back + 1;
  positions.push(0, tipY, half);
  const end = (HEDGE_RINGS - 1) * row;
  for (let face = 0; face < HEDGE_PROFILE_FACES; face += 1) {
    index.push(face + 1, face, back);
    index.push(end + face, end + face + 1, front);
  }
  // The tip stands above the ground, so one face under each end shuts the
  // opening the open bottom would leave there.
  index.push(0, HEDGE_PROFILE_FACES, back);
  index.push(end + HEDGE_PROFILE_FACES, end, front);
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  return geometry;
}

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
  // #1617: rounded, irregular and tapering, where it was a box.
  hedge: [{ colour: 0x3e5e2e, geometry: hedgeGeometry }],
  fence: [
    {
      colour: 0x8a6f4f,
      geometry: () =>
        merged([
          ...[-FENCE_END_POST_Z, -2, 0, 2, FENCE_END_POST_Z].map((z) =>
            block(FENCE_POST_METRES, 1.3 + 0.4, FENCE_POST_METRES, 0, -0.4, z),
          ),
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

/**
 * Several solids as one geometry: position and normal only, flat-shaded — and
 * any attribute named in `keep`, which the realistic bicycle's texture
 * coordinates are since #624.
 */
function merged(parts: readonly BufferGeometry[], keep: readonly string[] = []): BufferGeometry {
  const flat = parts.map((part) => {
    const each = part.index === null ? part : part.toNonIndexed();
    for (const name of Object.keys(each.attributes)) {
      if (name !== 'position' && name !== 'normal' && !keep.includes(name)) {
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
  // #545: the near-plane cull's shapes, built now rather than on a frame.
  warmNearFieldShapes('stylised');
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
 * The stylised world's pavement — #1535: a light concrete grey. This
 * repository's own, derived from nothing (ADR 0009 L2), and lit like the
 * scenery, so it is in {@link LIT_COLOURS}. @see PavementBelt
 */
export const PAVEMENT_COLOUR = 0xa7a49c;

/** One coloured solid of a piece of street furniture — #1536. */
interface FurniturePart {
  readonly colour: number;
  readonly geometry: () => BufferGeometry;
}

/** The paint on the street furniture's metal: a dark green-grey. This repository's own. */
const STREET_PAINT = 0x34403a;

/** A lamp's lantern and a bollard's band: a pale cream. This repository's own. */
const STREET_CREAM = 0xd9d4c3;

/** A bench's slats: a mid oak. This repository's own; the realistic world wears `planks` instead. */
const BENCH_WOOD = 0x8a6a48;

/** A bin's body: a darker green. This repository's own. */
const BIN_GREEN = 0x2f4a3a;

/**
 * The street furniture — #1536: each piece built from numbers typed here,
 * standing on its base at y = 0 with its front (+z) to the road, and each
 * kind wearing ONE realistic surface, so a kind is one instanced draw in
 * either world. Nothing is downloaded and nothing traced.
 *
 * ⚠️ **From numbers, and that is a finding rather than a shortcut** — #475's,
 * for street furniture. Poly Haven, the CC0 source this world already admits,
 * publishes `street_lamp_01` at 30 610 triangles, `street_lamp_02` at 20 338
 * and `metal_trash_can` at 13 960, and no bollard (its API, read 2026-10-21):
 * one of each is more than a whole village of these. Its `painted_wooden_bench`
 * (630) would fit, but would be the one GLB a street loads and the only kind
 * the stylised world could not draw. So the shapes are this repository's own,
 * and what is photographic is the bench's slats: Poly Haven's `dark_planks`,
 * already committed (`realistic-assets.ts` §`REALISTIC_STRUCTURE_SURFACES`).
 *
 * | kind | triangles | height |
 * |---|--:|--:|
 * | `lamp-post` | 88 | 5.3 m, its lantern over the pavement and never the road |
 * | `bollard` | 64 | 0.95 m |
 * | `bench` | 108 | 0.84 m |
 * | `bin` | 64 | 0.9 m |
 *
 * `realistic-renderer.test.ts` §"the street furniture" re-counts them off the
 * belt's own meshes.
 */
const FURNITURE_STYLE: Readonly<
  Record<
    FurnitureKind,
    { readonly surface: FurnitureSurface; readonly parts: readonly FurniturePart[] }
  >
> = {
  'lamp-post': {
    surface: 'painted',
    parts: [
      {
        colour: STREET_PAINT,
        geometry: () => new CylinderGeometry(0.12, 0.14, 0.4, 8).translate(0, 0.2, 0),
      },
      {
        colour: STREET_PAINT,
        geometry: () => new CylinderGeometry(0.06, 0.07, 4.9, 8).translate(0, 2.85, 0),
      },
      { colour: STREET_PAINT, geometry: () => block(0.06, 0.06, 1.1, 0, 5.2, 0.55) },
      { colour: STREET_CREAM, geometry: () => block(0.3, 0.14, 0.5, 0, 5.08, 1.2) },
    ],
  },
  bollard: {
    surface: 'painted',
    parts: [
      {
        colour: STREET_PAINT,
        geometry: () => new CylinderGeometry(0.1, 0.11, 0.95, 8).translate(0, 0.475, 0),
      },
      {
        colour: STREET_CREAM,
        geometry: () => new CylinderGeometry(0.106, 0.106, 0.08, 8).translate(0, 0.75, 0),
      },
    ],
  },
  bench: {
    surface: 'planks',
    parts: [
      // Three seat slats, the sitter facing the road (+z).
      ...[0.13, -0.01, -0.15].map((z) => ({
        colour: BENCH_WOOD,
        geometry: () => block(1.8, 0.04, 0.12, 0, 0.43, z),
      })),
      // Two back slats, behind the seat.
      ...[0.58, 0.74].map((y) => ({
        colour: BENCH_WOOD,
        geometry: () => block(1.8, 0.1, 0.03, 0, y, -0.24),
      })),
      // Two end frames, each a leg and an upright.
      ...[-0.75, 0.75].flatMap((x) => [
        { colour: STREET_PAINT, geometry: () => block(0.05, 0.43, 0.45, x, 0, -0.02) },
        { colour: STREET_PAINT, geometry: () => block(0.05, 0.42, 0.04, x, 0.43, -0.26) },
      ]),
    ],
  },
  bin: {
    surface: 'painted',
    parts: [
      {
        colour: BIN_GREEN,
        geometry: () => new CylinderGeometry(0.24, 0.22, 0.85, 8).translate(0, 0.425, 0),
      },
      {
        colour: STREET_PAINT,
        geometry: () => new CylinderGeometry(0.26, 0.26, 0.06, 8).translate(0, 0.87, 0),
      },
    ],
  },
};

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
 * The snow a roof wears, packed sRGB: **0xe4e9ee** — #1623. `world.ts`'s
 * ground snow, a little dimmer: that one is 0xe8edf2, whose blue lit
 * square-on by the lowest sun would pass white, and a roof is lit, so this
 * one is inside `three-renderer.test.ts` §"lights no colour past white"'s
 * sweep ({@link LIT_COLOURS}).
 */
export const ROOF_SNOW = 0xe4e9ee;

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
  // #1535. The stylised pavement, lit like the scenery.
  PAVEMENT_COLOUR,
  // #1536. The street furniture's, every part of every kind, once.
  ...new Set(
    Object.values(FURNITURE_STYLE).flatMap((style) => style.parts.map((part) => part.colour)),
  ),
  // #1623. The snow a roof wears.
  ROOF_SNOW,
  // #1626. The winter lights' wreath, on a village door and drawn on a mapped one.
  WREATH_GREEN,
  WREATH_BERRY,
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
 * 0.185.1 (docs/agents/project-state.md §4b) and the browser gate reads the result back off a
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
    // #1588: the facade's inset reveal reads the same direction.
    FACADE_SUN.oylSunWorld.value.set(sun.x, sun.y, sun.z).normalize();
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

  /** #621: which bound this belt's tints are drawn inside, if it tints at all. */
  readonly #tint: RealisticTintClass | undefined;

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
      /**
       * #621: which bound each item's seeded tint is drawn inside — the
       * realistic structures' belts only, whose `materials` are taught to
       * read it. The stylised belt is handed none, and allocates no instance
       * colour at all.
       */
      readonly tint?: RealisticTintClass;
    } = {},
  ) {
    this.#materials =
      options.materials ??
      (options.physical === true ? physicalMaterials() : vertexColouredMaterials());
    this.#skip = options.skip ?? new Set();
    this.#tint = options.tint;
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
        if (this.#tint !== undefined) tintChannels(mesh);
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
      if (this.#tint !== undefined) tintChannels(mesh);
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
      if (this.#tint !== undefined && mesh.instanceColor !== null) {
        // #621: the tint; and since #1581 a lot's paint in the two channels a
        // tree's dither uses and a structure's did not — nought, unpainted,
        // for every item but a lot. @see withInstanceChannels, withLotPaint
        const channels = mesh.instanceColor.array as Float32Array;
        channels[mesh.count * 3] = lotPaintChannel(item.paint, 'wall');
        channels[mesh.count * 3 + 1] = lotPaintChannel(item.paint, 'roof');
        channels[mesh.count * 3 + 2] = packedInstanceTint(
          item.x,
          item.z,
          realisticTints[this.#tint],
        );
      }
      mesh.count += 1;
    }
    for (const mesh of this.#meshes.values()) {
      if (mesh.count > 0) {
        // ⚠️ Every live matrix was just rewritten, so there is always something
        // to upload when there is anything to draw. Comparing sixteen floats an
        // instance to sometimes skip this would cost more than the upload.
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor !== null) mesh.instanceColor.needsUpdate = true;
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
  /** The upper bodies, rolled against the bicycle about the hips — #546. */
  readonly #torsos: InstancedMesh;
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
  readonly #posed = new Float64Array(STYLISED_RIDER_SLOTS * POSE_KEY.length).fill(Number.NaN);
  /** Which kind is in which slot, as one string, so a change is one compare. */
  #layout = '';
  /** The kit each kind wears, the rider's their own choice. @see setRiderKit */
  #kits = RIDER_KITS;
  /**
   * How many of the placed slots cast a shadow — #547. They are the first ones:
   * `place` puts every caster before every rider that does not. @see #castersOnly
   */
  #casters = 0;
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
  readonly #alongTheBicycle = new Vector3(0, 0, 1);
  readonly #roll = new Quaternion();

  constructor() {
    // #783: every rider a room can put on the road, as instances. @see STYLISED_RIDER_SLOTS
    const riders = STYLISED_RIDER_SLOTS;
    // #623: each rider wears its own kind's kit under its tint. @see RIDER_KITS
    withKitPerInstance(this.#materials.lit);
    withKitPerInstance(this.#materials.flat);
    this.#bodies = new InstancedMesh(mergedParts(RIDER_BICYCLE_PARTS), this.#materials.lit, riders);
    this.#torsos = new InstancedMesh(
      mergedParts(RIDER_UPPER_BODY_PARTS),
      this.#materials.lit,
      riders,
    );
    this.#cranksets = new InstancedMesh(
      mergedParts(RIDER_CRANK_PARTS),
      this.#materials.lit,
      riders,
    );
    this.#limbs = new InstancedMesh(limbGeometry(), this.#materials.lit, riders * LEG_BONE_COUNT);
    for (const mesh of [this.#bodies, this.#torsos, this.#cranksets, this.#limbs]) {
      mesh.instanceMatrix.setUsage(DynamicDrawUsage);
      // ⚠️ **Allocates `instanceColor` while `count` is still the capacity**,
      // because three sizes that buffer from `count` at the moment it is first
      // written. Doing it after the rewind below would give every one of them a
      // zero-length colour buffer and silently drop the tints.
      for (let slot = 0; slot < mesh.count; slot += 1) {
        mesh.setColorAt(slot, this.#tint.setHex(0xffffff));
      }
      // The kit per instance, sized from the same capacity, for the same reason.
      kitChannels(mesh);
      // three's constructor sets `count` to the capacity and fills every slot
      // with the identity matrix. A belt that drew before its first frame would
      // draw three bicycles stacked at the origin.
      mesh.count = 0;
      // The riders are within a few metres of the camera on every frame of
      // every ride, so there is nothing for a cull to decide. The same reason
      // the road and the ground set it, and the opposite of the scenery belt.
      mesh.frustumCulled = false;
      this.#castersOnly(mesh, mesh === this.#limbs ? LEG_BONE_COUNT : 1);
      this.#group.add(mesh);
    }
    this.#group.visible = false;
  }

  /**
   * Draws only the riders that cast into the shadow map's pass — #547, and
   * #93's rule on the map rung: **the ghost casts no shadow there either.**
   *
   * ⚠️ **It did until #547**, and nothing noticed, because the map was a rung
   * only a device that asked for it ever drew: the ghost is an instance in the
   * same four meshes as the rider and the pacer, `castShadow` is a property of
   * a MESH, and so the one ghost `contact-shadow.ts` §`CASTS_CONTACT_SHADOW`
   * kept out of the blobs cast a real shadow as soon as the map was on. Making
   * the map the default would have made that every ghost race.
   *
   * three calls `onBeforeShadow` immediately before it submits a caster to the
   * pass and `onAfterShadow` immediately after, and reads `count` at the
   * submission, so the pass draws the first {@link #casters} riders and the
   * picture draws them all.
   */
  #castersOnly(mesh: InstancedMesh, perRider: number): void {
    let drawn = 0;
    mesh.onBeforeShadow = () => {
      drawn = mesh.count;
      mesh.count = this.#casters * perRider;
    };
    mesh.onAfterShadow = () => {
      mesh.count = drawn;
    };
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

  /** The four meshes, in draw order. @see RiderBelt */
  get meshes(): {
    readonly bodies: InstancedMesh;
    readonly torsos: InstancedMesh;
    readonly cranksets: InstancedMesh;
    readonly limbs: InstancedMesh;
  } {
    return {
      bodies: this.#bodies,
      torsos: this.#torsos,
      cranksets: this.#cranksets,
      limbs: this.#limbs,
    };
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
    // #547: the riders that cast a shadow FIRST, so the shadow pass can draw a
    // prefix of each mesh and leave the ghost out. @see #castersOnly
    const drawn = markers
      .filter((marker) => Object.hasOwn(RIDER_TINTS, marker.kind))
      .sort(
        (a, b) => Number(!CASTS_CONTACT_SHADOW[a.kind]) - Number(!CASTS_CONTACT_SHADOW[b.kind]),
      );
    const layout = drawn.map((marker) => marker.kind).join(',');
    if (layout !== this.#layout) {
      this.#layout = layout;
      this.#posed.fill(Number.NaN);
    }
    let slot = 0;
    let casters = 0;
    let posed = false;
    for (const marker of drawn) {
      if (slot >= STYLISED_RIDER_SLOTS) {
        break;
      }
      posed = this.#placeOne(slot, marker) || posed;
      slot += 1;
      if (CASTS_CONTACT_SHADOW[marker.kind]) {
        casters = slot;
      }
    }
    this.#casters = casters;
    for (const mesh of [this.#bodies, this.#torsos, this.#cranksets]) {
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

  /**
   * Dresses the rider — and only the rider — in the kit they chose (#623).
   * Written into each instance's kit on the next {@link place}, which writes
   * every drawn rider's kit every frame, so there is nothing to invalidate.
   */
  setRiderKit(kit: RiderKit): void {
    this.#kits = kitsWith(kit);
  }

  /** The kit the rider is dressed in. @see riderKitsOf */
  get riderKit(): RiderKit {
    return this.#kits.rider;
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
    this.#torsos.material = material;
    this.#cranksets.material = material;
    this.#limbs.material = material;
  }

  /**
   * Whether the riders cast into the sun's shadow map — #426, the `'map'` rung.
   * They do not RECEIVE one: what grounds a rider is its shadow on the road,
   * and self-shadowing is a second shadow pass over the same four meshes.
   */
  setCasting(on: boolean): void {
    for (const mesh of [this.#bodies, this.#torsos, this.#cranksets, this.#limbs]) {
      mesh.castShadow = on;
    }
  }

  /** Asks three to rebuild both materials' programs. @see ThreeGameView.#applyRiderShadows */
  recompile(): void {
    this.#materials.lit.needsUpdate = true;
    this.#materials.flat.needsUpdate = true;
  }

  dispose(): void {
    for (const mesh of [this.#bodies, this.#torsos, this.#cranksets, this.#limbs]) {
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
    // #499: the lean, about the bicycle's own `+Z` — the line between its tyre
    // contacts, because `bicycle.ts` puts the origin on the road between them.
    // Applied in the bicycle's frame, so it rolls about its own length whatever
    // way it faces. A roll of `+θ` about `+Z` takes `+Y` toward `−X`, and the
    // model's `−X` is the road's normal (@see RiderMarker.lean) — so a positive
    // lean tips the rider toward the side the bend turns to.
    this.#turn.multiply(this.#roll.setFromAxisAngle(this.#alongTheBicycle, marker.lean));
    this.#stretch.setScalar(1);
    this.#rider.compose(this.#position, this.#turn, this.#stretch);
    this.#bodies.setMatrixAt(slot, this.#rider);
    // #623: the kit this kind wears, under the tint. Written before the tint,
    // because `writeKit` borrows the same scratch colour.
    const kit = this.#kits[marker.kind];
    for (const mesh of [this.#bodies, this.#torsos]) writeKit(mesh, slot, kit, this.#tint);
    for (let bone = 0; bone < LEG_BONE_COUNT; bone += 1) {
      writeKit(this.#limbs, slot * LEG_BONE_COUNT + bone, kit, this.#tint);
    }
    this.#bodies.setColorAt(slot, this.#tint.setHex(RIDER_TINTS[marker.kind]));

    // #546: the upper body, rolled against the bicycle about the hips — the
    // bicycle's own `+Z` through `UPPER_BODY_PIVOT`, in the bicycle's frame,
    // so that it is held back toward upright whatever way the bicycle faces.
    // Pivot, roll, and back: `T(p)·R·T(−p)`.
    this.#position.set(0, UPPER_BODY_PIVOT.y, UPPER_BODY_PIVOT.z);
    this.#turn.setFromAxisAngle(this.#alongTheBicycle, marker.bodyLean);
    this.#local.compose(this.#position, this.#turn, this.#stretch);
    this.#matrix.makeTranslation(0, -UPPER_BODY_PIVOT.y, -UPPER_BODY_PIVOT.z);
    this.#local.multiply(this.#matrix);
    this.#torsos.setMatrixAt(slot, this.#matrix.multiplyMatrices(this.#rider, this.#local));
    this.#torsos.setColorAt(slot, this.#tint);

    // ⚠️ The crank geometry is written in the bottom bracket's own frame, so
    // the crankset is *mounted* at the axis and turns about its own origin.
    // Baking the offset into the vertices instead would make the rotation swing
    // the whole crankset round the bicycle.
    // ⚠️ **A frame that carries no angle holds the one this slot already had**,
    // which is what stops a bot's cranks snapping to top dead centre. `NaN` is
    // "never posed", and it has to become `0` rather than being carried into a
    // matrix — a `NaN` angle composes a `NaN` crankset and three loses the
    // whole mesh.
    const held = this.#posed[slot * POSE_KEY.length + POSE_CRANK] ?? Number.NaN;
    const angle = marker.crankAngle ?? (Number.isNaN(held) ? 0 : held);
    this.#position.set(0, CRANK_AXIS_Y, CRANK_AXIS_Z);
    this.#turn.setFromAxisAngle(this.#acrossTheBicycle, angle);
    this.#local.compose(this.#position, this.#turn, this.#stretch);
    this.#cranksets.setMatrixAt(slot, this.#matrix.multiplyMatrices(this.#rider, this.#local));
    this.#cranksets.setColorAt(slot, this.#tint);

    for (let bone = 0; bone < LEG_BONE_COUNT; bone += 1) {
      this.#limbs.setColorAt(slot * LEG_BONE_COUNT + bone, this.#tint);
    }
    // ⚠️ **All six, not the angle alone.** `#poseLegs` writes world matrices,
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
      posed[at + 4] === marker.lean &&
      posed[at + 5] === angle;
    if (unmoved) {
      return false;
    }
    this.#poseLegs(slot, angle);
    posed[at] = marker.x;
    posed[at + 1] = marker.y;
    posed[at + 2] = marker.z;
    posed[at + 3] = yaw;
    posed[at + 4] = marker.lean;
    posed[at + 5] = angle;
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
 * a radial texture; `game.browser.spec.ts` §"uploads only the logo texture"
 * holds this scene to one, the wordmark (#966), so the fade is a colour attribute of four
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

  /**
   * Whether a material is this belt's — #622: drawn in both worlds, so the
   * realistic air is not taught it, for {@link WaterBelt.wears}' reason. It
   * lies under a rider, where the fog has taken next to nothing.
   */
  wears(material: Material): boolean {
    return material === this.#material;
  }

  constructor() {
    this.#mesh = new InstancedMesh(contactShadowGeometry(), this.#material, STYLISED_RIDER_SLOTS);
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
      if (slot >= STYLISED_RIDER_SLOTS) {
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
 * The realistic riders' bike-shaped shadow — #626, option 1: the side view
 * `rider-silhouette.ts` makes once, cast along `world.ts`'s one sun by a
 * fragment shader, **one instanced transparent draw for all of them**, in
 * place of the round blob {@link ContactShadowBelt} draws. The stylised world
 * keeps the blob and the map (#547) exactly as it had them.
 *
 * Drawn the way the blob is, and for its reasons: transparent with no depth
 * write, depth-tested, lifted {@link CONTACT_SHADOW_LIFT_METRES} and
 * polygon-offset toward the camera, black with an alpha no darker than
 * {@link CONTACT_SHADOW_DARKNESS}. Not fogged: it lies under a rider, where
 * the fog has taken next to nothing (the blob's own #622 argument).
 *
 * ⚠️ **One texture, 64 KiB, and no depth pass**: the quad a rider is drawn
 * over is its cast silhouette's footprint on the road, and each fragment walks
 * up the heights that could have cast onto it (`rider-silhouette.ts`
 * §`silhouetteCoverage` is the same arithmetic in TypeScript). The ghost
 * casts none (`contact-shadow.ts` §`CASTS_CONTACT_SHADOW`).
 */
export class RiderSilhouetteBelt {
  readonly #texture: DataTexture;
  readonly #material: ShaderMaterial;
  readonly #mesh: InstancedMesh;
  readonly #throws: InstancedBufferAttribute;
  readonly #throw: SunThrow = { x: 0, z: 0 };
  /** The `oylDarkness` uniform itself. @see setDarkness */
  readonly #darkness = { value: CONTACT_SHADOW_DARKNESS };
  readonly #position = new Vector3();
  readonly #turn = new Quaternion();
  readonly #matrix = new Matrix4();
  readonly #up = new Vector3(0, 1, 0);
  readonly #unit = new Vector3(1, 1, 1);
  #shown = false;

  constructor(silhouette: RiderSilhouette) {
    this.#texture = new DataTexture(
      silhouette.texels,
      SILHOUETTE_ALONG_TEXELS,
      SILHOUETTE_UP_TEXELS,
      RGFormat,
      UnsignedByteType,
    );
    this.#texture.magFilter = LinearFilter;
    this.#texture.minFilter = LinearFilter;
    this.#texture.generateMipmaps = false;
    this.#texture.wrapS = ClampToEdgeWrapping;
    this.#texture.wrapT = ClampToEdgeWrapping;
    this.#texture.needsUpdate = true;
    const { zMin, zMax, height, reach } = silhouette.bounds;
    this.#material = constructed(
      new ShaderMaterial({
        uniforms: {
          oylSilhouette: { value: this.#texture },
          oylBounds: { value: new Vector4(zMin, zMax, height, reach) },
          oylDarkness: this.#darkness,
        },
        vertexShader: SILHOUETTE_VERTEX,
        fragmentShader: SILHOUETTE_FRAGMENT,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -4,
      }),
    );
    const geometry = new BufferGeometry();
    // A unit square in (x, z), facing +Y: the vertex shader stretches it over
    // each rider's cast footprint. Wound for +Y — the blob's reason.
    geometry.setAttribute(
      'position',
      new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1]), 3),
    );
    geometry.setIndex([0, 2, 1, 0, 3, 2]);
    this.#throws = new InstancedBufferAttribute(new Float32Array(STYLISED_RIDER_SLOTS * 2), 2);
    this.#throws.setUsage(DynamicDrawUsage);
    geometry.setAttribute('oylThrow', this.#throws);
    this.#mesh = new InstancedMesh(geometry, this.#material, STYLISED_RIDER_SLOTS);
    this.#mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.#mesh.count = 0;
    this.#mesh.frustumCulled = false;
    this.#mesh.visible = false;
  }

  addTo(scene: Scene): void {
    scene.add(this.#mesh);
  }

  /** The one mesh. For the tests and the harness. */
  get mesh(): InstancedMesh {
    return this.#mesh;
  }

  /** Whether a material is this belt's — kept out of the realistic air, as the blob's is. */
  wears(material: Material): boolean {
    return material === this.#material;
  }

  /** Whether the silhouettes are drawn at all. */
  setShown(on: boolean): void {
    this.#shown = on;
    if (!on) {
      this.#mesh.count = 0;
      this.#mesh.visible = false;
    }
  }

  /**
   * How dark a whole silhouette is — {@link CONTACT_SHADOW_DARKNESS} unless the
   * browser gate's control asks otherwise. @see riderSilhouetteDarknessOf
   */
  setDarkness(darkness: number): void {
    this.#darkness.value = darkness;
  }

  /** One silhouette per rider who casts one, under this frame's sun. Allocates nothing. */
  place(markers: readonly RiderMarker[], sun: SunStyle): void {
    if (!this.#shown) {
      return;
    }
    let slot = 0;
    for (const marker of markers) {
      if (slot >= STYLISED_RIDER_SLOTS) {
        break;
      }
      if (!silhouetteThrow(marker, sun, this.#throw)) {
        continue;
      }
      this.#position.set(marker.x, marker.y + CONTACT_SHADOW_LIFT_METRES, marker.z);
      this.#turn.setFromAxisAngle(this.#up, Math.atan2(marker.headingX, marker.headingZ));
      this.#mesh.setMatrixAt(slot, this.#matrix.compose(this.#position, this.#turn, this.#unit));
      this.#throws.setXY(slot, this.#throw.x, this.#throw.z);
      slot += 1;
    }
    this.#mesh.count = slot;
    this.#mesh.instanceMatrix.needsUpdate = true;
    this.#throws.needsUpdate = true;
    this.#mesh.visible = slot > 0;
  }

  dispose(): void {
    this.#mesh.geometry.dispose();
    this.#mesh.dispose();
    this.#material.dispose();
    this.#texture.dispose();
  }
}

/** The silhouette's quad, stretched over one rider's cast footprint. @see RiderSilhouetteBelt */
const SILHOUETTE_VERTEX = /* glsl */ `
attribute vec2 oylThrow;
uniform vec4 oylBounds;
varying vec2 vOylGround;
varying vec2 vOylThrow;
void main() {
  float margin = ${glslFloat(SILHOUETTE_MARGIN_METRES)};
  float topAcross = oylBounds.z * oylThrow.x;
  float topAlong = oylBounds.z * oylThrow.y;
  float edge = oylBounds.w + margin;
  float across = mix(min(0.0, topAcross) - edge, max(0.0, topAcross) + edge, position.x);
  float along = mix(
    oylBounds.x + min(0.0, topAlong) - margin,
    oylBounds.y + max(0.0, topAlong) + margin,
    position.z
  );
  vOylGround = vec2(across, along);
  vOylThrow = oylThrow;
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(across, 0.0, along, 1.0);
}
`;

/**
 * How covered a point on the road is by the cast silhouette — #626.
 * `rider-silhouette.ts` §`silhouetteCoverage` is this, in TypeScript.
 */
const SILHOUETTE_FRAGMENT = /* glsl */ `
uniform sampler2D oylSilhouette;
uniform vec4 oylBounds;
uniform float oylDarkness;
varying vec2 vOylGround;
varying vec2 vOylThrow;
void main() {
  float height = oylBounds.z;
  float reach = oylBounds.w;
  float low = 0.0;
  float high = height;
  if (abs(vOylThrow.x) > 1e-4) {
    float a = (vOylGround.x - reach) / vOylThrow.x;
    float b = (vOylGround.x + reach) / vOylThrow.x;
    low = max(0.0, min(a, b));
    high = min(height, max(a, b));
  }
  if (high < low) discard;
  float cover = 0.0;
  for (int tap = 0; tap < ${String(SILHOUETTE_TAPS)}; tap++) {
    float y = low + (high - low) * (float(tap) + 0.5) / ${glslFloat(SILHOUETTE_TAPS)};
    float z = vOylGround.y - y * vOylThrow.y;
    float x = abs(vOylGround.x - y * vOylThrow.x);
    vec2 uv = vec2((z - oylBounds.x) / (oylBounds.y - oylBounds.x), y / height);
    if (uv.x < 0.0 || uv.x >= 1.0 || uv.y < 0.0 || uv.y >= 1.0) continue;
    vec2 texel = texture2D(oylSilhouette, uv).rg;
    float edge = texel.g * reach;
    float inside = 1.0 - smoothstep(
      edge - ${glslFloat(SILHOUETTE_EDGE_METRES)},
      edge + ${glslFloat(SILHOUETTE_EDGE_METRES)},
      x
    );
    cover = max(cover, texel.r * inside);
  }
  if (cover <= 0.0) discard;
  gl_FragColor = vec4(0.0, 0.0, 0.0, oylDarkness * cover);
}
`;

/**
 * The ground under the realistic scenery — #620: one soft dark ellipse under
 * every tree, shrub and rock the realistic world draws as a mesh and every
 * structure it draws, **one instanced transparent draw for all of them**,
 * realistic world only (ADR 0026 D-3).
 *
 * `ground-blob.ts` decides where each goes — from `world.ts`'s one sun, through
 * the riders' own `contact-shadow.ts` §`sunThrowPerMetre` — what ground it
 * lies on, and where the road clips it. This draws them, the way
 * {@link ContactShadowBelt} draws the riders', with the same three properties
 * and for the same reasons: **transparent with no depth write**, so it is
 * drawn after the ground, the trunks and the walls and hides none of them;
 * **depth-tested**, so a trunk or a wall in front of its own blob still hides
 * it, and so does ground that bends up through a quad; and **lifted and
 * polygon-offset** off the ground's triangle.
 *
 * ## What is different from the riders' blob, and why
 *
 * - **Two triangles, not seventy-two.** #620's ceiling is two a blob, and the
 *   frame's triangles have 1 350 of room (`realistic-budget.ts`
 *   §`REALISTIC_GROUND_BLOBS`). The soft rim is therefore not in the vertices
 *   but in the fragment: {@link GROUND_BLOB_FRAGMENT} computes
 *   `ground-blob.ts` §`groundBlobAlpha` from the quad's own coordinates. Still
 *   no texture.
 * - **Tilted to the ground.** Each instance matrix is `ground-blob.ts`
 *   §`groundBlobAxes`: the quad lies in the plane of the landform triangle
 *   under the blob's middle, on its caster's own sheet
 *   (`ground-blob.ts` §`groundUnderBlob`), or — a middle thrown over the
 *   carriageway — in the plane of the one under the caster's foot.
 * - **Clipped at the road's edge**, per instance: two half-planes as two
 *   instance attributes, tested in the fragment exactly as
 *   `ground-blob.ts` §`keptByRoadClip` tests them.
 *
 * ⚠️ **Nothing here names any shadow state**: no caster, no receiver, no map.
 * `three-seam.test.ts` counts those, and this adds none.
 *
 * Exported for `three-renderer.test.ts`, for {@link RiderBelt}'s reasons.
 */
export class GroundBlobBelt {
  // #622: the realistic world's only belt, so it breathes the realistic air.
  readonly #material = withAtmosphere(
    withGroundBlobShading(
      new MeshBasicMaterial({
        color: 0x000000,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -4,
      }),
    ),
  );
  readonly #mesh: InstancedMesh;
  /** The two clip planes of every instance, three floats each. @see roadClip */
  readonly #clipFirst: InstancedBufferAttribute;
  readonly #clipSecond: InstancedBufferAttribute;
  /** How much of each instance is drawn. @see BlobCaster.strength */
  readonly #strength: InstancedBufferAttribute;
  /** One instance's planes, as `roadClip` writes them. */
  readonly #planes = new Float32Array(6);
  readonly #blob: GroundBlob = { x: 0, z: 0, yaw: 0, halfAlong: 0, halfAcross: 0 };
  readonly #ground: GroundPoint = { y: 0, nx: 0, ny: 1, nz: 0 };
  readonly #throw: SunThrow = { x: 0, z: 0 };
  readonly #axes = new Float64Array(9);
  readonly #matrix = new Matrix4();
  #shown = true;

  constructor(capacity: number = REALISTIC_GROUND_BLOBS) {
    const geometry = groundBlobGeometry();
    this.#clipFirst = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    this.#clipSecond = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    this.#strength = new InstancedBufferAttribute(new Float32Array(capacity), 1);
    this.#clipFirst.setUsage(DynamicDrawUsage);
    this.#clipSecond.setUsage(DynamicDrawUsage);
    this.#strength.setUsage(DynamicDrawUsage);
    geometry.setAttribute('blobClipFirst', this.#clipFirst);
    geometry.setAttribute('blobClipSecond', this.#clipSecond);
    geometry.setAttribute('blobStrength', this.#strength);
    this.#mesh = new InstancedMesh(geometry, this.#material, capacity);
    this.#mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.#mesh.count = 0;
    // The instances move every frame and span the whole near field; one mesh
    // culled against a stale sphere would vanish, and culling it saves nothing.
    this.#mesh.frustumCulled = false;
    this.#mesh.visible = false;
  }

  addTo(scene: Scene): void {
    scene.add(this.#mesh);
  }

  /** The one mesh. For `three-renderer.test.ts` and the harness. */
  get mesh(): InstancedMesh {
    return this.#mesh;
  }

  /** Whether the blobs are drawn at all: the realistic world's, and the browser gate's control. */
  setShown(on: boolean): void {
    this.#shown = on;
    if (!on) {
      this.#mesh.count = 0;
      this.#mesh.visible = false;
    }
  }

  /**
   * One blob per caster in each list, under this frame's sun, on this frame's
   * ground, clipped off this frame's road. Allocates nothing; stops at the
   * belt's capacity.
   */
  update(
    lists: readonly BlobCasters[],
    corridor: RoadCorridor,
    terrain: TerrainMesh,
    sun: SunStyle,
  ): void {
    this.#mesh.count = 0;
    this.#mesh.visible = false;
    if (!this.#shown || !sunThrowPerMetre(sun, this.#throw)) return;
    const capacity = this.#mesh.instanceMatrix.count;
    const first = this.#clipFirst.array as Float32Array;
    const second = this.#clipSecond.array as Float32Array;
    const strength = this.#strength.array as Float32Array;
    const axes = this.#axes;
    let slot = 0;
    for (const list of lists) {
      for (let at = 0; at < list.count && slot < capacity; at += 1) {
        const caster = list.casters[at];
        if (caster === undefined) continue;
        const blob = this.#blob;
        placeGroundBlob(caster, this.#throw, blob);
        const ground = this.#ground;
        if (!groundUnderBlob(terrain, corridor.centre, blob, caster, ground)) {
          // Off the ground this frame built — past its last row. Nothing to lie on.
          continue;
        }
        groundBlobAxes(blob, ground, axes);
        roadClip(
          corridor.centre,
          blob.x,
          blob.z,
          Math.max(blob.halfAlong, blob.halfAcross),
          this.#planes,
        );
        const lift = GROUND_BLOB_LIFT_METRES;
        this.#matrix.set(
          axes[0] as number,
          axes[3] as number,
          axes[6] as number,
          blob.x + ground.nx * lift,
          axes[1] as number,
          axes[4] as number,
          axes[7] as number,
          ground.y + ground.ny * lift,
          axes[2] as number,
          axes[5] as number,
          axes[8] as number,
          blob.z + ground.nz * lift,
          0,
          0,
          0,
          1,
        );
        this.#mesh.setMatrixAt(slot, this.#matrix);
        first.set(this.#planes.subarray(0, 3), slot * 3);
        second.set(this.#planes.subarray(3, 6), slot * 3);
        strength[slot] = caster.strength;
        slot += 1;
      }
    }
    this.#mesh.count = slot;
    this.#mesh.instanceMatrix.needsUpdate = true;
    this.#clipFirst.needsUpdate = true;
    this.#clipSecond.needsUpdate = true;
    this.#strength.needsUpdate = true;
    this.#mesh.visible = slot > 0;
  }

  dispose(): void {
    this.#mesh.geometry.dispose();
    this.#mesh.dispose();
    this.#material.dispose();
  }
}

/**
 * A unit quad lying in the ground plane, facing up: `(±1, 0, ±1)`, two
 * triangles. ⚠️ Wound for +Y, for {@link contactShadowGeometry}'s reason —
 * `three-renderer.test.ts` computes the normal rather than trusting this.
 */
function groundBlobGeometry(): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    'position',
    new BufferAttribute(new Float32Array([-1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, 1]), 3),
  );
  geometry.setIndex([0, 2, 1, 0, 3, 2]);
  return geometry;
}

/**
 * What {@link withGroundBlobShading} adds to the vertex shader: the quad's own
 * coordinates, and where the fragment is from the blob's middle in the
 * horizontal plane — the frame `ground-blob.ts` §`roadClip` states its planes
 * in. The mesh itself stands at the origin, so the instance matrix alone
 * places it.
 */
const GROUND_BLOB_VERTEX = /* glsl */ `
  vBlobLocal = position.xz;
  vBlobOffset = (instanceMatrix * vec4(position, 1.0)).xz - instanceMatrix[3].xz;
  vBlobClipFirst = blobClipFirst;
  vBlobClipSecond = blobClipSecond;
  vBlobStrength = blobStrength;
`;

/**
 * What {@link withGroundBlobShading} adds to the fragment shader, after the
 * colour: `ground-blob.ts` §`groundBlobAlpha` and §`keptByRoadClip`, in GLSL.
 * `realistic-renderer.test.ts` §"#620" holds the constants in it to that
 * file's, as text; `game.browser.spec.ts` §"#620" holds what it DOES with the
 * planes — and {@link GROUND_BLOB_VERTEX}'s offset and varyings with it — off
 * the drawing buffer (`game-harness.ts` §`groundBlobClip`).
 */
const GROUND_BLOB_FRAGMENT = /* glsl */ `
  float blobAlpha = ${glslFloat(GROUND_BLOB_DARKNESS)} * vBlobStrength *
    (1.0 - smoothstep(${glslFloat(GROUND_BLOB_CORE)}, 1.0, length(vBlobLocal)));
  if (dot(vBlobClipFirst.xy, vBlobOffset) < vBlobClipFirst.z ||
      dot(vBlobClipSecond.xy, vBlobOffset) < vBlobClipSecond.z) {
    blobAlpha = 0.0;
  }
  if (blobAlpha <= 0.0) discard;
  diffuseColor.a *= blobAlpha;
`;

/** A number as a GLSL float literal. */
function glslFloat(value: number): string {
  return Number.isInteger(value) ? `${String(value)}.0` : String(value);
}

/** A `vec2` or `vec3` of numbers as a GLSL constructor — #1588. */
function glslVec(values: readonly number[]): string {
  return `vec${String(values.length)}(${values.map(glslFloat).join(', ')})`;
}

/**
 * Teaches a black `MeshBasicMaterial` to be a ground blob — #620. Its fog and
 * its tone mapping are three's own, so a blob far off fades into the same fog
 * as the ground under it, and the tone mapping of black is black.
 */
function withGroundBlobShading(material: MeshBasicMaterial): MeshBasicMaterial {
  const varyings = `
varying vec2 vBlobLocal;
varying vec2 vBlobOffset;
varying vec3 vBlobClipFirst;
varying vec3 vBlobClipSecond;
varying float vBlobStrength;`;
  const spliced = "#620's ground blob";
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = replacedOrThrown(
      replacedOrThrown(
        shader.vertexShader,
        '#include <common>',
        `#include <common>
attribute vec3 blobClipFirst;
attribute vec3 blobClipSecond;
attribute float blobStrength;${varyings}`,
        'vertex',
        spliced,
      ),
      '#include <begin_vertex>',
      `#include <begin_vertex>${GROUND_BLOB_VERTEX}`,
      'vertex',
      spliced,
    );
    shader.fragmentShader = replacedOrThrown(
      replacedOrThrown(
        shader.fragmentShader,
        '#include <common>',
        `#include <common>${varyings}`,
        'fragment',
        spliced,
      ),
      '#include <color_fragment>',
      `#include <color_fragment>${GROUND_BLOB_FRAGMENT}`,
      'fragment',
      spliced,
    );
  };
  return material;
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
  markKit(geometry, kitRoleOf(each.colour));
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
  markKit(geometry, KIT_LIMB);
  return geometry;
}

/** A vertex that is not the kit: it keeps the colour baked into it. @see markKit */
const KIT_NONE = 0;
/** A vertex of the jersey, which a rider's kit colours. @see markKit */
const KIT_JERSEY = 1;
/** A vertex of the legs or the helmet, in the kit's darker colour. @see markKit */
const KIT_LIMB = 2;

/**
 * Which part of the kit a part painted `colour` is — #623. The stylised
 * rider's parts are painted from `bicycle.ts` §`RIDER_PALETTE`, so a part in
 * its jersey or limb colour IS the kit, and every other colour (the frame, the
 * tyres) is the bicycle's own.
 */
function kitRoleOf(colour: number): number {
  if (colour === RIDER_PALETTE.jersey) return KIT_JERSEY;
  if (colour === RIDER_PALETTE.limb) return KIT_LIMB;
  return KIT_NONE;
}

/**
 * Marks every vertex of a rider geometry with its part of the kit — #623, the
 * attribute {@link withKitPerInstance} reads to put each rider's own kit there.
 */
function markKit(geometry: BufferGeometry, role: number): void {
  const vertices = geometry.getAttribute('position').count;
  geometry.setAttribute(
    KIT_ROLE_ATTRIBUTE,
    new BufferAttribute(new Float32Array(vertices).fill(role), 1),
  );
}

/** The vertex attribute {@link markKit} writes. */
const KIT_ROLE_ATTRIBUTE = 'oylKit';
/** The per-instance jersey colour, linear. @see withKitPerInstance */
const KIT_JERSEY_ATTRIBUTE = 'oylKitJersey';
/** The per-instance limb colour, linear. @see withKitPerInstance */
const KIT_LIMB_ATTRIBUTE = 'oylKitLimb';

/**
 * Gives an instanced rider mesh a jersey and a limb colour per instance — #623.
 * Six floats a rider, in the geometry the mesh already has, so no draw call.
 */
function kitChannels(mesh: InstancedMesh): void {
  for (const name of [KIT_JERSEY_ATTRIBUTE, KIT_LIMB_ATTRIBUTE]) {
    const channels = new InstancedBufferAttribute(new Float32Array(mesh.count * 3), 3);
    channels.setUsage(DynamicDrawUsage);
    mesh.geometry.setAttribute(name, channels);
  }
}

/**
 * Writes one instance's kit into {@link kitChannels}' buffers, linear, as a
 * vertex colour is. `into` is scratch, so this allocates nothing.
 */
function writeKit(mesh: InstancedMesh, slot: number, kit: RiderKit, into: Color): void {
  for (const [name, colour] of [
    [KIT_JERSEY_ATTRIBUTE, kit.jersey],
    [KIT_LIMB_ATTRIBUTE, kit.limb],
  ] as const) {
    const channels = mesh.geometry.getAttribute(name) as InstancedBufferAttribute;
    into.setHex(colour);
    channels.setXYZ(slot, into.r, into.g, into.b);
    channels.needsUpdate = true;
  }
}

/**
 * The stylised rider's two materials, taught to put each INSTANCE's own kit
 * where {@link markKit} marked the kit — #623, so that {@link RIDER_TINTS}
 * multiplies the kit its kind wears ({@link RIDER_KITS}) rather than the
 * rider's. Three's `color_vertex` has already done `vColor = color ×
 * instanceColor`; for a kit vertex the line spliced after it replaces the
 * baked colour with the instance's kit, still times its tint. A vertex marked
 * {@link KIT_NONE} — the frame, the tyres, the cranks — is untouched.
 *
 * ⚠️ Rider materials only: they are the belt's own pair, never shared.
 */
function withKitPerInstance(material: Material): void {
  const spliced = "#623's kit per rider";
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = replacedOrThrown(
      replacedOrThrown(
        shader.vertexShader,
        '#include <common>',
        `#include <common>\nattribute float ${KIT_ROLE_ATTRIBUTE};\nattribute vec3 ${KIT_JERSEY_ATTRIBUTE};\nattribute vec3 ${KIT_LIMB_ATTRIBUTE};`,
        'vertex',
        spliced,
      ),
      '#include <color_vertex>',
      /* glsl */ `#include <color_vertex>
#ifdef USE_INSTANCING_COLOR
if (${KIT_ROLE_ATTRIBUTE} > 0.5) {
  vColor.rgb = (${KIT_ROLE_ATTRIBUTE} > 1.5 ? ${KIT_LIMB_ATTRIBUTE} : ${KIT_JERSEY_ATTRIBUTE}) * instanceColor.rgb;
}
#endif`,
      'vertex',
      spliced,
    );
  };
  material.customProgramCacheKey = () => 'oyl-rider-kit-per-instance';
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
    lit: withAtmosphere(
      constructed(new MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 })),
    ),
    flat: withAtmosphere(constructed(new MeshBasicMaterial({ vertexColors: true }))),
  };
}

/**
 * Gives a tinted belt's mesh an instance colour as long as its matrix buffer —
 * #621. At construction, and after {@link reserve} has grown the matrices, so
 * a tint is never written past the end of its buffer.
 */
function tintChannels(mesh: InstancedMesh): void {
  const needed = mesh.instanceMatrix.count;
  if (mesh.instanceColor !== null && mesh.instanceColor.count >= needed) return;
  const channels = new InstancedBufferAttribute(new Float32Array(needed * 3), 3);
  channels.setUsage(DynamicDrawUsage);
  mesh.instanceColor = channels;
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
 *
 * ⚠️ **A tinted belt strands a colour buffer as well (#621)**: its caller then
 * runs {@link tintChannels}, which replaces `instanceColor` with one as long as
 * the grown matrices, so each growth strands one of each. The doubling bounds
 * both alike, since the colour buffer is only ever replaced when this grew.
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
  /** Where the tree line is, for the realistic ground's scree — #627. @see TerrainMesh.treeLine */
  readonly #treeLine = { value: NO_TREE_LINE };
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

  /** The field span and count the photographic ground's patchwork reads, and — #627 — the tree line. */
  get fields(): {
    readonly span: { value: number };
    readonly count: { value: number };
    readonly treeLine: { value: number };
  } {
    return { span: this.#fieldSpan, count: this.#fieldCount, treeLine: this.#treeLine };
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
    this.#treeLine.value = ground.treeLine;
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
 * The realistic world's air in the linear light the horizon ring is coloured
 * in — #622: the sky's horizon table AS DRAWN, how far the fog leans towards
 * it, and the sky's turn. @see ATMOSPHERE
 */
export interface RealisticAir {
  readonly table: readonly LinearColour[];
  readonly share: number;
  readonly turn: number;
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
 * ⚠️ **The horizon colour is HANDED to it, since #544**, and it is the colour
 * the scene's fog is — never `world.horizonColour` read here on its own. In
 * the stylised world the two are the same; in the realistic world the fog and
 * this ring converge on the sky the HDRI actually draws at the horizon
 * (`realistic-light.ts` §`drawnHorizonColour`), and reading the stylised
 * horizon here is what drew these hills as a pale band in front of a darker
 * photographed sky on the owner's tablet.
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
  /** #622: one segment's foot, while its colours are written. */
  readonly #footColour = new Color();
  /** #622: every segment's foot for the last air, three floats each. @see #footsFor */
  readonly #foots = new Float32Array((HORIZON_SEGMENTS + 1) * 3);
  #footKey:
    | { readonly air: RealisticAir; readonly r: number; readonly g: number; readonly b: number }
    | undefined;
  /** The relief the positions were last built for, so a frame that did not change it costs nothing. */
  #built: HorizonRelief | undefined;
  /** The crest floor they were last built for. @see update */
  #floor = Number.NEGATIVE_INFINITY;

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

  /**
   * The colour the foot was last drawn in, linear. @see horizonColoursOf
   *
   * ⚠️ Since #622, in the realistic world, the colour every direction's foot
   * is BLENDED FROM — the fog's own `fogColor` — rather than the colour of
   * any one segment, each of which leans towards the sky in its own direction
   * exactly as the fog does. @see footAt
   */
  get foot(): readonly [number, number, number] {
    return [this.#horizon.r, this.#horizon.g, this.#horizon.b];
  }

  /**
   * The colour a segment's foot was last drawn in, linear — #622, for
   * `terrain-belt.test.ts`: in the realistic world it is the fog's colour in
   * that segment's direction.
   */
  footAt(segment: number): readonly [number, number, number] {
    const at = (segment % (HORIZON_SEGMENTS + 1)) * 3 * 3;
    return [
      this.#colours[at] as number,
      this.#colours[at + 1] as number,
      this.#colours[at + 2] as number,
    ];
  }

  /** Every segment's foot for this air, into {@link #foots}, unless it is the air they were worked out for. */
  #footsFor(air: RealisticAir): void {
    const h = this.#horizon;
    const key = this.#footKey;
    if (
      key !== undefined &&
      key.air.table === air.table &&
      key.air.share === air.share &&
      key.air.turn === air.turn &&
      key.r === h.r &&
      key.g === h.g &&
      key.b === h.b
    ) {
      return;
    }
    this.#footKey = { air: { ...air }, r: h.r, g: h.g, b: h.b };
    const base: LinearColour = [h.r, h.g, h.b];
    for (let segment = 0; segment <= HORIZON_SEGMENTS; segment += 1) {
      const angle = (segment / HORIZON_SEGMENTS) * Math.PI * 2;
      const colour = directionalFogColour(base, air.table, air.share, angle, air.turn);
      this.#foots[segment * 3] = colour[0];
      this.#foots[segment * 3 + 1] = colour[1];
      this.#foots[segment * 3 + 2] = colour[2];
    }
  }

  /**
   * Centres the ring on the camera, and colours it from this frame's world
   * and `horizon` — the colour the view's fog is this frame, in linear light.
   *
   * `crestFloor` is the lowest any crest is drawn, in local metres, reached by
   * lifting the whole ridge so its shape is kept: nothing in
   * the stylised world, and in the realistic world the photograph's own
   * skyline (`realistic-light.ts` §`skylineCrestFloor`, #544) — which follows
   * the eye and binds on practically every realistic frame, so there the
   * lifted ridge moves up and down with the rider. `hazeShare`
   * is how much of `horizon` the ridge carries: {@link HORIZON_HAZE_SHARE},
   * or in the realistic world `realistic-light.ts` §`REALISTIC_HORIZON_HAZE_SHARE`.
   * `air`, since #622, is the realistic world's air: with it each segment's
   * foot is the fog's colour in that segment's direction
   * (`realistic-light.ts` §`directionalFogColour`) and its ridge hazes
   * towards that; without it — the stylised world, and #544's control — every
   * segment is `horizon`, exactly as before.
   */
  update(
    relief: HorizonRelief,
    world: WorldStyle,
    pose: CameraPose,
    horizon: { readonly r: number; readonly g: number; readonly b: number },
    crestFloor = Number.NEGATIVE_INFINITY,
    hazeShare = HORIZON_HAZE_SHARE,
    air?: RealisticAir,
  ): void {
    if (this.#built !== relief || this.#floor !== crestFloor) {
      this.#built = relief;
      this.#floor = crestFloor;
      // #544: the WHOLE ridge is lifted until its lowest crest meets the
      // floor, never each crest clamped to it — clamping flattened every low
      // crest onto one level line, which is a hard straight edge of its own.
      const lift = ridgeLift(relief.tops, crestFloor);
      for (let segment = 0; segment <= HORIZON_SEGMENTS; segment += 1) {
        const angle = (segment / HORIZON_SEGMENTS) * Math.PI * 2;
        const x = Math.cos(angle) * HORIZON_RADIUS_METRES;
        const z = Math.sin(angle) * HORIZON_RADIUS_METRES;
        const top = (relief.tops[segment % HORIZON_SEGMENTS] as number) + lift;
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
    this.#horizon.setRGB(horizon.r, horizon.g, horizon.b);
    if (air === undefined) {
      this.#haze.setHex(world.groundColour).lerp(this.#horizon, hazeShare);
      for (let segment = 0; segment <= HORIZON_SEGMENTS; segment += 1) {
        for (let row = 0; row < 3; row += 1) {
          const colour = row === 2 ? this.#haze : this.#horizon;
          const at = (segment * 3 + row) * 3;
          this.#colours[at] = colour.r;
          this.#colours[at + 1] = colour.g;
          this.#colours[at + 2] = colour.b;
        }
      }
    } else {
      // #622: each segment's foot is the fog's colour in that segment's
      // direction, so where the corridor's fogged ground ends the ring is
      // still the fog's colour, whichever way the rider looks. Worked out only
      // when the air changes, which on a ride is once.
      this.#footsFor(air);
      for (let segment = 0; segment <= HORIZON_SEGMENTS; segment += 1) {
        const foot = segment * 3;
        this.#footColour.setRGB(
          this.#foots[foot] as number,
          this.#foots[foot + 1] as number,
          this.#foots[foot + 2] as number,
        );
        this.#haze.setHex(world.groundColour).lerp(this.#footColour, hazeShare);
        for (let row = 0; row < 3; row += 1) {
          const colour = row === 2 ? this.#haze : this.#footColour;
          const at = (segment * 3 + row) * 3;
          this.#colours[at] = colour.r;
          this.#colours[at + 1] = colour.g;
          this.#colours[at + 2] = colour.b;
        }
      }
    }
    (this.#geometry.getAttribute('color') as BufferAttribute).needsUpdate = true;
    // Only the ground plane's position follows the camera. In the STYLISED
    // world the heights are the route's, so a rider who climbs rises past the
    // hills rather than with them. In the REALISTIC world that is not so
    // (#544): the crest floor follows the eye and binds on practically every
    // frame, so the lifted ridge rises and falls with the rider one for one —
    // `realistic-light.ts` §`skylineCrestFloor` has the arithmetic.
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
 *
 * Exported so `terrain-belt.test.ts` can hold the realistic world's share
 * above it, which is the direction `realistic-light.ts`
 * §`REALISTIC_HORIZON_HAZE_SHARE` argues for.
 */
export const HORIZON_HAZE_SHARE = 0.7;

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

/**
 * The realistic water's fragment — #629: #459's shader with its two-colour
 * sky replaced by the scene's own prefiltered environment map, sampled along
 * the reflection of the view ray about the rippled normal, and a glint of
 * `world.ts`'s one sun.
 *
 * - **The environment, not a second sky.** The same PMREM map the realistic
 *   world's materials are lit by (ADR 0026 D-9), through three's own
 *   `textureCubeUV` at roughness 0 and three's own rotation of it, so a cloud
 *   in the sky is the cloud in the lake. It is scaled by `environmentScale`,
 *   which brings the zenith band down to the brightness #459's water was tuned
 *   against (`realistic-light.ts` §`reflectedSkyColour`'s own target): this
 *   shader is not tone mapped, so the photograph's radiance at its own
 *   brightness would be white.
 * - **Fresnel is Schlick's**, with F0 = 0.02 for water, as #459's was. The
 *   browser gate holds it (`fresnelHeld` ≥ 0 is its control).
 * - **The glint** is a specular lobe toward the sun, of at most
 *   {@link WATER_GLINT_PEAK} added in linear light, and ⚠️ **what it can clip,
 *   stated (ADR 0026 D-10)**: the sum is clamped to 1 per channel, the
 *   output's white, so a glint on a bright sky's reflection saturates to white
 *   rather than overflowing — which is what a glint is.
 *
 * Built by replacing lines of {@link WATER_FRAGMENT}, each asserted, so the
 * stylised water's shader is not touched at all.
 */
function reflectingWaterFragment(): string {
  const swaps: readonly (readonly [string, string])[] = [
    [
      'uniform vec3 skyColour;',
      `uniform vec3 skyColour;
uniform sampler2D envMap;
uniform mat3 envMapRotation;
uniform float environmentScale;
uniform vec3 sunDirection;
uniform vec3 sunGlint;
uniform float fresnelHeld;
#include <cube_uv_reflection_fragment>`,
    ],
    [
      'float fresnel = 0.02 + 0.98 * pow(1.0 - facing, 5.0);',
      'float fresnel = fresnelHeld >= 0.0 ? fresnelHeld : 0.02 + 0.98 * pow(1.0 - facing, 5.0);',
    ],
    [
      'vec3 sky = mix(horizonColour, skyColour, smoothstep(0.0, 0.4, r.y));',
      `vec3 sky = textureCubeUV(envMap, envMapRotation * normalize(vec3(r.x, max(r.y, 0.0), r.z)), 0.0).rgb * environmentScale;
  float glint = pow(max(dot(r, sunDirection), 0.0), ${glslFloat(WATER_GLINT_EXPONENT)});`,
    ],
    [
      'gl_FragColor = vec4(mix(body, sky, fresnel), 1.0);',
      'gl_FragColor = vec4(min(mix(body, sky, fresnel) + sunGlint * glint * fresnel, vec3(1.0)), 1.0);',
    ],
  ];
  let text = WATER_FRAGMENT;
  for (const [from, to] of swaps) {
    if (!text.includes(from)) {
      throw new Error(
        `the water shader no longer holds "${from}", where #629's reflection is spliced in`,
      );
    }
    text = text.replace(from, to);
  }
  return text;
}

/**
 * How sharp the realistic water's sun glint is: a lobe of `cos^600` about the
 * sun's reflection, about 5.5° across at half height — #629. This
 * repository's own figure: tight enough to read as a glint off ripples rather
 * than a sheen, wide enough that the band-limited ripples still scatter it.
 */
const WATER_GLINT_EXPONENT = 600;

/**
 * The most the glint adds, in linear light: **0.6** of the sun's own colour at
 * the lobe's peak, before Fresnel — #629. @see reflectingWaterFragment for what
 * it can clip.
 */
const WATER_GLINT_PEAK = 0.6;

/** The glint's colour at its peak: a warm white, times {@link WATER_GLINT_PEAK}. */
const WATER_GLINT_COLOUR = new Color(1, 0.96, 0.88).multiplyScalar(WATER_GLINT_PEAK);

/**
 * `defines` three writes for a material whose environment is a PMREM cube UV
 * map of this height — #629. The water is a `ShaderMaterial`, which three
 * does not give an environment, so they are written here from three's own
 * arithmetic (`WebGLProgram.js` §`generateCubeUVSize`, 0.185.1), and a test
 * holds this to it.
 */
export function cubeUvDefines(imageHeight: number): Record<string, string> {
  const maxMip = Math.log2(imageHeight) - 2;
  const texelHeight = 1 / imageHeight;
  const texelWidth = 1 / (3 * Math.max(2 ** maxMip, 7 * 16));
  return {
    ENVMAP_TYPE_CUBE_UV: '',
    CUBEUV_TEXEL_WIDTH: String(texelWidth),
    CUBEUV_TEXEL_HEIGHT: String(texelHeight),
    CUBEUV_MAX_MIP: `${String(maxMip)}.0`,
  };
}

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
  /**
   * The realistic water — #629: the same ripples reflecting the scene's own
   * environment map, built for the environment it is handed. @see setEnvironment
   */
  #reflecting: { readonly environment: Texture; readonly material: ShaderMaterial } | undefined;
  /** The environment the realistic rungs reflect. @see setEnvironment */
  #environment: Texture | undefined;
  /** Its turn about the vertical, the scene's `environmentRotation.y`, set every frame. */
  #environmentTurn = 0;
  #drawn: QualitySettings['water'] = 'shaded';
  /** Fresnel as the product computes it (−1), or held at a constant — the browser gate's control. */
  #fresnelHeld = -1;
  readonly #rotation = new Matrix4();
  readonly #turn = new Euler();
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
  /**
   * Whether a material is one of the water's own — #622: the one fogged
   * surface both worlds share, and so the one the realistic air is not taught.
   * @see withAtmosphere
   */
  wears(material: Material): boolean {
    return (
      material === this.#shaded ||
      material === this.#flat ||
      material === this.#reflecting?.material
    );
  }

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
    this.#drawn = drawn;
    this.#mount();
  }

  /**
   * The environment the realistic rungs reflect — #629. `undefined` on every
   * stylised rung, which keeps #459's shader, and on a realistic rung until a
   * world is loaded: `reflectedSkyColour`'s one colour is then the fallback.
   */
  setEnvironment(environment: Texture | undefined): void {
    if (environment === this.#environment) return;
    this.#environment = environment;
    if (environment !== undefined && this.#reflecting?.environment !== environment) {
      this.#reflecting?.material.dispose();
      this.#reflecting = { environment, material: reflectingWaterMaterial(environment) };
    }
    this.#mount();
  }

  /** The environment's turn about the vertical this frame — the scene's `environmentRotation.y`. */
  setEnvironmentTurn(turn: number): void {
    this.#environmentTurn = turn;
  }

  /** Whether the water reflects an environment map now — #629. @see waterReflectsOf */
  get reflects(): boolean {
    return this.#mesh.material === this.#reflecting?.material && this.#environment !== undefined;
  }

  /** Fresnel held at a constant, or (`undefined`) computed — #629's control. @see waterFresnelOf */
  holdFresnel(held: number | undefined): void {
    this.#fresnelHeld = held ?? -1;
  }

  #mount(): void {
    if (this.#drawn !== 'shaded') {
      this.#mesh.material = this.#flat;
      return;
    }
    this.#mesh.material =
      this.#environment !== undefined && this.#reflecting !== undefined
        ? this.#reflecting.material
        : this.#shaded;
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
    // #629: the realistic water's own uniforms, from the same frame.
    const reflecting = this.#reflecting?.material.uniforms as
      Record<string, { value: unknown } | undefined> | undefined;
    if (reflecting !== undefined && this.#environment !== undefined) {
      (reflecting['skyColour']?.value as Color).copy(sky);
      (reflecting['horizonColour']?.value as Color).copy(horizon);
      (reflecting['time'] as { value: number }).value = seconds;
      (reflecting['fresnelHeld'] as { value: number }).value = this.#fresnelHeld;
      (reflecting['sunDirection']?.value as Vector3)
        .set(world.sun.x, world.sun.y, world.sun.z)
        .normalize();
      // three's own rotation of an environment (WebGLMaterials, 0.185.1): the
      // scene's `environmentRotation` as a matrix, transposed.
      this.#turn.set(0, this.#environmentTurn, 0);
      (reflecting['envMapRotation']?.value as Matrix3)
        .setFromMatrix4(this.#rotation.makeRotationFromEuler(this.#turn))
        .transpose();
      (reflecting['environmentScale'] as { value: number }).value =
        reflection === undefined ? 0 : environmentScaleFor(reflection.zenith, linearLuminance(sky));
      (reflecting['rippleFilter'] as { value: number }).value = (
        uniforms['rippleFilter'] as { value: number }
      ).value;
    }
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
    this.#reflecting?.material.dispose();
  }
}

/**
 * The realistic water's material for one environment map — #629.
 * @see reflectingWaterFragment
 */
function reflectingWaterMaterial(environment: Texture): ShaderMaterial {
  const height = (environment.image as { height?: number } | null)?.height ?? 256;
  const material = constructed(
    new ShaderMaterial({
      vertexShader: WATER_VERTEX,
      fragmentShader: reflectingWaterFragment(),
      fog: true,
      side: DoubleSide,
      defines: cubeUvDefines(height),
      uniforms: UniformsUtils.merge([
        UniformsLib.fog,
        {
          skyColour: { value: new Color(UNSET_COLOUR) },
          horizonColour: { value: new Color(UNSET_COLOUR) },
          deepColour: { value: new Color(WATER_DEEP_COLOUR) },
          shallowColour: { value: new Color(WATER_SHALLOW_COLOUR) },
          time: { value: 0 },
          rippleFilter: { value: 1 },
          envMap: { value: null },
          envMapRotation: { value: new Matrix3() },
          environmentScale: { value: 0 },
          sunDirection: { value: new Vector3(0, 1, 0) },
          sunGlint: { value: WATER_GLINT_COLOUR.clone() },
          fresnelHeld: { value: -1 },
        },
      ]),
    }),
  );
  // After the merge, which clones every texture it is handed: the water reads
  // THE environment map, not a copy of it.
  (material.uniforms['envMap'] as { value: Texture | null }).value = environment;
  return material;
}

/**
 * What the environment map is multiplied by in the water — #629: the factor
 * that takes the photograph's zenith band to `target`, the luminance #459's
 * water was tuned against (`realistic-light.ts` §`reflectedSkyColour`'s
 * target), so the brightest part of a reflection is where the stylised
 * water's sky was, and the rest follows the photograph.
 */
function environmentScaleFor(zenith: LinearColour, target: number): number {
  const measured = 0.2126 * zenith[0] + 0.7152 * zenith[1] + 0.0722 * zenith[2];
  return measured > 0 && target > 0 ? target / measured : 0;
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
  readonly #physical = withAtmosphere(
    constructed(new MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 })),
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

  /**
   * Whether the bridges wear the photographed stone now. @see bridgesWearStoneOf
   *
   * ⚠️ #509: the material on the mesh must be the stone one AND carry a colour
   * map. The first half alone is what `#applyWorld`'s second argument buys —
   * without it the mesh wears `#physical` — and the second is what
   * {@link stoneBridgeMaterial}'s `map:` line buys: a stone material built with
   * no map is still "the stone material" to the identity check, and the
   * browser gate reads this on a realistic rung.
   */
  get wearsStone(): boolean {
    return (
      this.#stone !== undefined &&
      this.#mesh.material === this.#stone.material &&
      this.#stone.material.map !== null
    );
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
  // #619 lever 2 and #622's air, chained after the assignment above.
  return withAtmosphere(withTextureLodBias(material));
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
  readonly impostor?: {
    readonly material: ShaderMaterial;
    readonly texture: Texture;
    /** The same views' normals — #630. Absent in a world a test built without them. */
    readonly normals?: Texture;
  };
  /**
   * The middle level of detail, for a tree — #617. Its parts wear the near
   * parts' OWN materials, paired by material name, so it adds no material, no
   * program and no texture. @see prepareMiddleLevel — and since #639 both
   * levels are one part wearing one merged material. @see mergeShapeMaterials
   */
  readonly middle?: { readonly parts: readonly RealisticPart[]; readonly triangles: number };
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
  /**
   * The mean radiance just above the photograph's own skyline — what the fog
   * and the horizon ring converge on in the realistic world (#544).
   * @see REALISTIC_HORIZON_BAND
   */
  readonly skyline: LinearColour;
  /**
   * The same band in `realistic-light.ts` §`HORIZON_AZIMUTH_BINS` directions —
   * what the fog leans towards in each (#622) — and the same table flattened
   * to its mean, the browser gate's control. @see skyHorizonTable
   */
  readonly directions: readonly LinearColour[];
  readonly flatDirections: readonly LinearColour[];
}

/** Everything the realistic world is drawn from, loaded once per tab. */
interface RealisticWorld {
  readonly sky: RealisticSky;
  readonly road: { readonly colour: Texture; readonly normal: Texture };
  readonly ground: { readonly colour: Texture; readonly normal: Texture };
  /** The ground's verge and its rock and scree — #627. */
  readonly verge: { readonly colour: Texture; readonly normal: Texture };
  readonly rock: { readonly colour: Texture; readonly normal: Texture };
  /** The bare rock a steep bank wears — #1274, ambientCG's. */
  readonly crag: { readonly colour: Texture; readonly normal: Texture };
  readonly vegetation: ReadonlyMap<RealisticVegetationKind, readonly RealisticShape[]>;
  /** The structures' photographic surfaces — ADR 0026 D-12 layer 3, #475. */
  readonly structures: ReadonlyMap<
    Exclude<StructureSurface, 'painted'>,
    { readonly colour: Texture; readonly normal: Texture }
  >;
  /**
   * The rider's body, as the loader left it: a scene holding one skinned mesh
   * and, since #623, the helmet and glasses as one mesh beside it.
   */
  readonly body: Object3D;
  /** The rider's kit, skin and relief — #623. */
  readonly rider: RealisticRiderMaps;
  /** The bicycle's four drawn maps — #624. */
  readonly bicycle: RealisticBicycleMaps;
  /**
   * The gantries' lettering — #679: one byte of coverage a texel, from the
   * app's own glyph range. Absent where the loaders read no glyphs.
   */
  readonly banners?: { readonly atlas: BannerAtlas; readonly texture: DataTexture };
  /** The game's wordmark, KTX2 — #966: on the gates (the finish since #978) and the billboards. */
  readonly wordmark: Texture;
  /**
   * The house models and their one atlas — #1585. Absent where a loader gave
   * a scene with no mesh in it (a test's), and then every mapped building is
   * its extrusion.
   */
  readonly houses?: RealisticHouses;
}

/** One house model's triangles, as the belt copies them: not indexed, three floats a vertex. */
export interface HouseGeometry {
  readonly position: Float32Array;
  readonly normal: Float32Array;
  readonly uv: Float32Array;
  readonly triangles: number;
}

/** The house models, by their place in `house-models.ts` §`HOUSE_MODELS`, and their atlas — #1585. */
export interface RealisticHouses {
  readonly models: readonly HouseGeometry[];
  readonly atlas: Texture;
  /** Each model's triangles, as `mapped-buildings.ts` §`selectMappedBuildings` reads them. */
  readonly triangles: readonly number[];
}

/**
 * A house model's GLB as the belt copies it — #1585: its one mesh's triangles,
 * not indexed, or `undefined` where the scene holds no mesh with positions,
 * normals and texture coordinates.
 */
export function houseGeometryOf(scene: Object3D): HouseGeometry | undefined {
  let found: Mesh | undefined;
  scene.traverse((node) => {
    if (found === undefined && (node as Partial<Mesh>).isMesh === true) found = node as Mesh;
  });
  const geometry = found?.geometry;
  if (
    geometry?.getAttribute('position') === undefined ||
    geometry.getAttribute('normal') === undefined ||
    geometry.getAttribute('uv') === undefined
  ) {
    return undefined;
  }
  const flat = geometry.index === null ? geometry : geometry.toNonIndexed();
  const copy = (name: string): Float32Array =>
    Float32Array.from(flat.getAttribute(name).array as ArrayLike<number>);
  const position = copy('position');
  const result = {
    position,
    normal: copy('normal'),
    uv: copy('uv'),
    triangles: position.length / 9,
  };
  if (flat !== geometry) flat.dispose();
  return result;
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
  /**
   * Releases what the loaders hold once a load has settled — #618: the
   * `KTX2Loader`'s worker pool, each worker holding a transcoder instance.
   * {@link loadRealisticWorld} calls it whether the load succeeded or not.
   */
  readonly dispose?: () => void;
  /**
   * Reads a glyph range file's bytes — #679: the gantries' banners are
   * lettered from the map's own glyphs (`banner-atlas.ts`). Optional, for a
   * test's loaders that build a world with no banners; the product's supply
   * it, and the browser gate reads the lettering off the drawing buffer.
   */
  readonly glyphs?: (url: string) => Promise<Uint8Array>;
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

/* ----------------------------------------------------------------------------
 * The textures stay compressed on the GPU — #618
 * ------------------------------------------------------------------------- */

/**
 * The WebGL extensions a KTX2 texture's GPU format is chosen from — what
 * `KTX2Loader.detectSupport` reads off a renderer's `extensions`, and nothing
 * else of it.
 */
export interface CompressionExtensions {
  has(name: string): boolean;
  get(name: string): unknown;
}

/**
 * What this device can sample compressed, read off a throwaway WebGL 2 context
 * and then released.
 *
 * ⚠️ **A probe, because the world is loaded before any view exists** — the
 * reason {@link realisticWorld} is module state at all — and `KTX2Loader`
 * must know the GPU's formats before it transcodes a byte. The same GPU draws
 * the view's context, so it offers the same extensions; `WebGLRenderer`
 * enables each one on its own context as it uploads the first texture in
 * that format. No WebGL 2 at all answers "none", and the world then
 * transcodes to RGBA8 — which no view without a context would draw anyway.
 */
function probedCompressionExtensions(): CompressionExtensions {
  const canvas = typeof document === 'undefined' ? undefined : document.createElement('canvas');
  const gl = canvas?.getContext('webgl2') ?? null;
  const offered = new Set(gl?.getSupportedExtensions() ?? []);
  // `detectSupport` asks the ASTC extension for its profiles, so they are read
  // now, while the context is alive.
  const astc =
    gl !== null && offered.has('WEBGL_compressed_texture_astc')
      ? (gl.getExtension('WEBGL_compressed_texture_astc') as {
          getSupportedProfiles(): string[];
        } | null)
      : null;
  const profiles = astc?.getSupportedProfiles() ?? [];
  (gl?.getExtension('WEBGL_lose_context') as { loseContext(): void } | null)?.loseContext();
  return {
    has: (name) => offered.has(name),
    get: (name) =>
      name === 'WEBGL_compressed_texture_astc' && offered.has(name)
        ? { getSupportedProfiles: () => profiles }
        : null,
  };
}

/**
 * The realistic world's loaders, with every texture kept compressed — #618.
 *
 * - A texture is a KTX2 file, and `KTX2Loader` transcodes it — off the main
 *   thread, in its worker pool — to the best block format `extensions` offers:
 *   on the owner's tablet, **ETC2** for the Basis ETC1S colour maps and
 *   **ASTC 4×4** for the UASTC normal maps; with none of them, RGBA8, which
 *   {@link realisticTextureFormat} labels a fallback rather than letting it
 *   pass for compressed.
 * - A model's embedded maps are KTX2 under `KHR_texture_basisu`, which the
 *   pipeline makes REQUIRED, so `GLTFLoader` is handed the same `KTX2Loader`.
 * - The sky is unchanged: an HDR, at half-float, for `PMREMGenerator`. A
 *   compressed sky is its own issue (#615 §"Deliberately not filed").
 *
 * ⚠️ **One `KTX2Loader` a load, disposed when the load has settled**: its
 * workers each hold a transcoder instance, and three warns when two loaders
 * are alive at once. {@link loadRealisticWorld} calls `dispose`.
 *
 * ⚠️ **The transcoder path is always set**, to
 * {@link REALISTIC_TRANSCODER_DIRECTORY} under the build's base unless a
 * caller says otherwise: the loader's own default is a URL inside `three`,
 * which `tools/basis/transcoder-plugin.ts` takes out of the build.
 *
 * The product reaches it through {@link productRealisticLoaders}, over the
 * device's own extensions; `realistic-textures.test.ts` drives it with a
 * device that does and does not offer ASTC and ETC, and the browser gate's
 * control with none.
 */
export function compressedRealisticLoaders(
  extensions: CompressionExtensions,
  transcoderPath: string = `${import.meta.env.BASE_URL}${REALISTIC_TRANSCODER_DIRECTORY}`,
): RealisticLoaders & { readonly dispose: () => void } {
  // #1683: a transcoder that cannot start fails the load instead of hanging it.
  // `KTX2Loader` reads its worker's source off this static, which three's
  // types do not declare. @see basis-worker.ts
  const withWorker = KTX2Loader as unknown as { BasisWorker: () => void };
  withWorker.BasisWorker = settlingBasisWorker(withWorker.BasisWorker);
  const ktx2 = new KTX2Loader()
    .setTranscoderPath(transcoderPath)
    // `detectSupport` reads `renderer.extensions` and nothing else of it.
    .detectSupport({ extensions } as unknown as WebGLRenderer);
  return {
    model: async (url) => {
      const manager = new LoadingManager();
      manager.setURLModifier(realisticResourceUrl(url));
      return (await new GLTFLoader(manager).setKTX2Loader(ktx2).loadAsync(url)).scene;
    },
    texture: (url) => ktx2.loadAsync(url),
    sky: (url) => new HDRLoader().loadAsync(url),
    dispose: () => {
      ktx2.dispose();
    },
  };
}

/**
 * The product's loaders: {@link compressedRealisticLoaders} over the device's
 * own extensions, built when a load first asks and released by its `dispose`,
 * so a world that is already loaded probes nothing.
 *
 * ⚠️ **One set per LOAD, not one per module** (#618's review): `built` is
 * mutable and `dispose` releases it, so two overlapping loads sharing one set
 * would share one `KTX2Loader`, and whichever settled first would release its
 * workers under the other. {@link loadRealisticWorld} therefore builds a fresh
 * set each time it is called without one — `loadRealisticWorldOnce` serialises
 * a ride's loads anyway, but the owner's page calls the raw loader directly.
 */
function productRealisticLoaders(): RealisticLoaders {
  let built: ReturnType<typeof compressedRealisticLoaders> | undefined;
  const loaders = (): ReturnType<typeof compressedRealisticLoaders> =>
    (built ??= compressedRealisticLoaders(probedCompressionExtensions()));
  return {
    model: (url) => loaders().model(url),
    texture: (url) => loaders().texture(url),
    sky: (url) => loaders().sky(url),
    // Through three's own loader, as every other realistic file is: the one
    // network rule this client keeps names no `fetch` here (`no-network.test.ts`).
    glyphs: async (url) =>
      new Uint8Array(
        (await new FileLoader().setResponseType('arraybuffer').loadAsync(url)) as ArrayBuffer,
      ),
    dispose: () => {
      built?.dispose();
      built = undefined;
    },
  };
}

/**
 * One same-origin file's bytes, through three's own loader as the realistic
 * world's glyphs are read just above: the demo's baked route (#1652,
 * `demo/baked-route.ts`), handed to its page by `demo/main.tsx`. Here because
 * this is the one module that may name `three` (`three-seam.test.ts`), and a
 * loader rather than a `fetch` because the client names no network primitive
 * (`no-network.test.ts`). Nothing is kept: three's `Cache` is off.
 */
export async function readFileBytes(url: string): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(
    (await new FileLoader().setResponseType('arraybuffer').loadAsync(url)) as ArrayBuffer,
  );
}

/**
 * What a realistic texture is held as on the GPU — #618. A block format by
 * name, `RGBA8 (fallback)` for a KTX2 texture the device could not take
 * compressed, `half-float` for the sky and `image` for a picture three
 * decoded, which since #618 no realistic texture but the sky is.
 */
export type RealisticTextureFormat =
  | 'ASTC 4x4'
  | 'ETC2 RGB'
  | 'ETC2 RGBA'
  | 'ETC1'
  | 'BC7'
  | 'BC1'
  | 'BC3'
  | 'PVRTC'
  | 'RGBA8 (fallback)'
  | 'half-float'
  | 'image';

const BLOCK_FORMATS: ReadonlyMap<number, RealisticTextureFormat> = new Map([
  [RGBA_ASTC_4x4_Format, 'ASTC 4x4'],
  [RGB_ETC2_Format, 'ETC2 RGB'],
  [RGBA_ETC2_EAC_Format, 'ETC2 RGBA'],
  [RGB_ETC1_Format, 'ETC1'],
  [RGBA_BPTC_Format, 'BC7'],
  [RGBA_S3TC_DXT1_Format, 'BC1'],
  [RGBA_S3TC_DXT5_Format, 'BC3'],
  [RGBA_PVRTC_4BPPV1_Format, 'PVRTC'],
  [RGB_PVRTC_4BPPV1_Format, 'PVRTC'],
]);

/** One realistic texture, as the GPU is handed it. */
interface RealisticTextureReport {
  readonly role:
    | 'road'
    | 'ground'
    | 'structure'
    | 'model'
    | 'impostor'
    | 'impostor-normals'
    | 'bicycle'
    | 'rider'
    | 'wordmark'
    | 'sky';
  readonly format: RealisticTextureFormat;
  /** Whether the GPU holds it in a block format — never true of a fallback. */
  readonly compressed: boolean;
  readonly width: number;
  readonly height: number;
  /**
   * The bytes three hands the GPU for it, every mip level: the transcoded
   * blocks for a KTX2 texture, the texels for the sky. `NaN` for a decoded
   * picture, whose size three never sees.
   */
  readonly bytes: number;
  /**
   * Which surface a `structure` map is the colour or normal of — #1548, so the
   * browser gate can name the mapped towns' three and not only count them.
   * Absent for every other role.
   */
  readonly surface?: StructureSurface;
}

/**
 * How one texture is held on the GPU. @see RealisticTextureReport
 *
 * @test-facing the browser gate's control labels its RGBA8 texture with it,
 * and `realistic-textures.test.ts` holds its labels; the product reports
 * through {@link realisticTextureReport}
 */
export function realisticTextureFormat(texture: Texture): {
  readonly format: RealisticTextureFormat;
  readonly compressed: boolean;
  readonly bytes: number;
} {
  const compressed = texture as Partial<CompressedTexture>;
  if (compressed.isCompressedTexture === true) {
    const bytes = (compressed.mipmaps ?? []).reduce(
      (sum, level: { data?: ArrayBufferView }) => sum + (level.data?.byteLength ?? 0),
      0,
    );
    const block = BLOCK_FORMATS.get(texture.format);
    if (block !== undefined) return { format: block, compressed: true, bytes };
    if (texture.format === RGBAFormat)
      return { format: 'RGBA8 (fallback)', compressed: false, bytes };
  }
  if (texture.type === HalfFloatType) {
    const image = texture.image as { width: number; height: number };
    return { format: 'half-float', compressed: false, bytes: image.width * image.height * 8 };
  }
  return { format: 'image', compressed: false, bytes: Number.NaN };
}

/**
 * Every texture the loaded realistic world holds, once per image, and how the
 * GPU is handed it — #618. Empty when no world is loaded.
 *
 * @test-facing `realistic-textures.test.ts` holds a load to it, the
 * browser gate publishes it from the one shared `?realistic` load, and the
 * owner's page (`realistic-harness.ts`) logs it for validation 0002 Part AH
 */
export function realisticTextureReport(): readonly RealisticTextureReport[] {
  const world = realisticWorld;
  if (world === undefined) return [];
  // ⚠️ By SOURCE, not by texture: `GLTFLoader` gives two materials that share
  // one image two textures over one `Source` — a fir's live and dead branches
  // do — and three uploads a source once. The browser gate found it: 52
  // textures, 48 uploads.
  const seen = new Set<unknown>();
  const out: RealisticTextureReport[] = [];
  const add = (
    texture: Texture | null | undefined,
    role: RealisticTextureReport['role'],
    surface?: StructureSurface,
  ): void => {
    if (texture === null || texture === undefined || seen.has(texture.source)) return;
    seen.add(texture.source);
    const image = texture.image as { width?: number; height?: number } | undefined;
    out.push({
      role,
      ...realisticTextureFormat(texture),
      width: image?.width ?? 0,
      height: image?.height ?? 0,
      ...(surface === undefined ? {} : { surface }),
    });
  };
  add(world.sky.texture, 'sky');
  // The road's two, and every map the ground blends — the grass, #627's verge
  // and rock, #1274's crag — as the ground's.
  for (const map of surfaceMapsOf(world)) {
    add(map, map === world.road.colour || map === world.road.normal ? 'road' : 'ground');
  }
  for (const [surface, maps] of world.structures) {
    add(maps.colour, 'structure', surface);
    add(maps.normal, 'structure', surface);
  }
  for (const map of REALISTIC_BICYCLE_MAP_NAMES) add(world.bicycle[map], 'bicycle');
  for (const map of REALISTIC_RIDER_MAP_NAMES) add(world.rider[map], 'rider');
  add(world.wordmark, 'wordmark');
  for (const shapes of world.vegetation.values()) {
    for (const shape of shapes) {
      // #639: every layer of a merged material, not only its own two maps.
      for (const part of shape.parts)
        for (const map of texturesOf(part.material)) add(map, 'model');
      add(shape.impostor?.texture, 'impostor');
      add(shape.impostor?.normals, 'impostor-normals');
    }
  }
  return out;
}

/**
 * Hands textures to a view's GPU now, rather than on the first frame that
 * samples them — `WebGLRenderer.initTexture` — so the browser gate can read
 * back what each upload was: the loaded world's, or `textures` for a control.
 *
 * @unwired reached only from the browser gate's harness; the product uploads a
 * texture on the first frame that draws it, as three does unasked
 */
export function uploadRealisticTexturesOf(view: GameView, textures?: readonly Texture[]): number {
  if (!(view instanceof ThreeGameView)) return 0;
  const world = realisticWorld;
  const all =
    textures ??
    (world === undefined
      ? []
      : [
          ...surfaceMapsOf(world),
          ...[...world.structures.values()].flatMap((maps) => [maps.colour, maps.normal]),
          ...REALISTIC_BICYCLE_MAP_NAMES.map((map) => world.bicycle[map]),
          ...REALISTIC_RIDER_MAP_NAMES.map((map) => world.rider[map]),
          world.wordmark,
          ...[...world.vegetation.values()].flatMap((shapes) =>
            shapes.flatMap((shape) => [
              ...shape.parts.flatMap((part) => texturesOf(part.material)),
              shape.impostor?.texture ?? null,
              shape.impostor?.normals ?? null,
            ]),
          ),
        ].filter((texture): texture is Texture => texture !== null));
  const unique = [...new Set(all)];
  for (const texture of unique) view.initTexture(texture);
  // What was uploaded: one per source. @see realisticTextureReport
  return new Set(unique.map((texture) => texture.source)).size;
}

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
  loaders: RealisticLoaders = productRealisticLoaders(),
): Promise<RealisticWorldOutcome> {
  try {
    return await loadEveryRealisticFile(loaders);
  } finally {
    // #618: the transcoder's workers, whether the world loaded or not.
    loaders.dispose?.();
  }
}

/** {@link loadRealisticWorld}, before its loaders are released. */
async function loadEveryRealisticFile(loaders: RealisticLoaders): Promise<RealisticWorldOutcome> {
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
    // #679: the map's own glyph range, for the gantries' banners.
    // ⚠️ A glyph range that cannot be read costs the banners and nothing else
    // (#879's review): it resolves to nothing rather than failing the world.
    const glyphs =
      loaders.glyphs === undefined
        ? Promise.resolve(undefined)
        : started(() =>
            (loaders.glyphs as (url: string) => Promise<Uint8Array>)(BANNER_GLYPHS_URL),
          ).catch(() => undefined);
    const road = {
      colour: texture(() => loaders.texture(realisticUrl(REALISTIC_SURFACES.road.colour))),
      normal: texture(() => loaders.texture(realisticUrl(REALISTIC_SURFACES.road.normal))),
    };
    const ground = {
      colour: texture(() => loaders.texture(realisticUrl(REALISTIC_SURFACES.ground.colour))),
      normal: texture(() => loaders.texture(realisticUrl(REALISTIC_SURFACES.ground.normal))),
    };
    // #627: the ground's verge, rock and scree, loaded and settled with the rest.
    const verge = {
      colour: texture(() => loaders.texture(realisticUrl(REALISTIC_SURFACES.verge.colour))),
      normal: texture(() => loaders.texture(realisticUrl(REALISTIC_SURFACES.verge.normal))),
    };
    const rock = {
      colour: texture(() => loaders.texture(realisticUrl(REALISTIC_SURFACES.rock.colour))),
      normal: texture(() => loaders.texture(realisticUrl(REALISTIC_SURFACES.rock.normal))),
    };
    // #1274: the bare rock of a steep bank, loaded and settled with the rest.
    const crag = {
      colour: texture(() => loaders.texture(realisticUrl(REALISTIC_SURFACES.crag.colour))),
      normal: texture(() => loaders.texture(realisticUrl(REALISTIC_SURFACES.crag.normal))),
    };
    const rider = model(() => loaders.model(realisticUrl(REALISTIC_RIDER)));
    // #966: the wordmark, loaded and settled with everything else.
    const wordmark = texture(() => loaders.texture(realisticUrl(REALISTIC_WORDMARK)));
    // #623: the rider's three maps, loaded and settled with everything else.
    const riderMaps = REALISTIC_RIDER_MAP_NAMES.map((map) => ({
      map,
      texture: texture(() => loaders.texture(realisticUrl(REALISTIC_RIDER_MAPS[map]))),
    }));
    // #624: the bicycle's drawn maps, loaded and settled with everything else.
    const bicycleMaps = REALISTIC_BICYCLE_MAP_NAMES.map((map) => ({
      map,
      texture: texture(() => loaders.texture(realisticUrl(REALISTIC_BICYCLE_MAPS[map]))),
    }));
    // #1585: the house models and their atlas, loaded and settled with everything else.
    const houseScenes = REALISTIC_HOUSE_MODEL_IDS.map((id) =>
      model(() => loaders.model(realisticUrl(houseModelFile(id)))),
    );
    const houseAtlas = texture(() => loaders.texture(realisticUrl(REALISTIC_HOUSE_ATLAS)));
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
      // #1283, #1294: the trees are the generated ones, or — for the owner's
      // page — the scans they replaced. @see setRealisticTrees
      models: realisticVegetation(realisticTrees)[kind].map(
        ({ name, file, impostor, impostorNormals, middle }) => ({
          name,
          scene: model(() => loaders.model(realisticUrl(file))),
          // #617: the tree's middle level, loaded and settled with everything else.
          middle:
            middle === undefined
              ? Promise.resolve(undefined)
              : model(() => loaders.model(realisticUrl(middle))),
          strip:
            impostor === undefined
              ? Promise.resolve(undefined)
              : texture(() => loaders.texture(realisticUrl(impostor))),
          // #630: the strip's normals, loaded and settled with everything else.
          normals:
            impostorNormals === undefined
              ? Promise.resolve(undefined)
              : texture(() => loaders.texture(realisticUrl(impostorNormals))),
        }),
      ),
    }));
    // ⚠️ **Every load is SETTLED before anything is decided — #478.** This was
    // a `Promise.all`, which rejects on the first failure while every other
    // load carries on: a texture that arrived after the `catch` below had run
    // was kept by nobody and released by nobody, and on a flaky network (#475
    // makes this a rider's path) that is most of the set. So a failure waits
    // for the loads still in flight, and then releases all of them.
    const settled = await Promise.allSettled([
      glyphs,
      sky,
      road.colour,
      road.normal,
      ground.colour,
      ground.normal,
      verge.colour,
      verge.normal,
      rock.colour,
      rock.normal,
      crag.colour,
      crag.normal,
      rider,
      wordmark,
      ...riderMaps.map((each) => each.texture),
      ...bicycleMaps.map((each) => each.texture),
      ...houseScenes,
      houseAtlas,
      ...structureMaps.flatMap((each) => [each.colour, each.normal]),
      ...shapes.flatMap((each) =>
        each.models.flatMap((one) => [one.scene, one.strip, one.normals, one.middle]),
      ),
    ]);
    for (const outcome of settled) {
      if (outcome.status === 'rejected') throw outcome.reason;
    }
    const vegetation = new Map<RealisticVegetationKind, readonly RealisticShape[]>();
    for (const each of shapes) {
      const prepared: RealisticShape[] = [];
      for (const one of each.models) {
        const near = prepareRealisticShape(
          await one.scene,
          one.name,
          await one.strip,
          await one.normals,
        );
        loaded.shapes.push(near);
        const middleScene = await one.middle;
        const levelled =
          middleScene === undefined ? near : prepareMiddleLevel(near, middleScene, one.name);
        loaded.shapes[loaded.shapes.length - 1] = levelled;
        // #639: one material a level, so one draw call a level — unless this
        // is the browser gate loading its control. @see setRealisticMaterialsMerged
        const shape = realisticMaterialsMerged ? mergeShapeMaterials(levelled, one.name) : levelled;
        loaded.shapes[loaded.shapes.length - 1] = shape;
        // #630: every plant's foliage sways, and a rock does not.
        if (each.kind !== 'rock') withFoliageSwayOf(shape);
        prepared.push(shape);
      }
      vegetation.set(each.kind, prepared);
    }
    const [skyTexture, roadColour, roadNormal, groundColour, groundNormal, body] =
      await Promise.all([sky, road.colour, road.normal, ground.colour, ground.normal, rider]);
    const [vergeColour, vergeNormal, rockColour, rockNormal] = await Promise.all([
      verge.colour,
      verge.normal,
      rock.colour,
      rock.normal,
    ]);
    const [cragColour, cragNormal] = await Promise.all([crag.colour, crag.normal]);
    for (const surface of [
      roadColour,
      roadNormal,
      groundColour,
      groundNormal,
      vergeColour,
      vergeNormal,
      rockColour,
      rockNormal,
      cragColour,
      cragNormal,
    ]) {
      surface.wrapS = RepeatWrapping;
      surface.wrapT = RepeatWrapping;
      surface.minFilter = LinearMipmapLinearFilter;
    }
    roadColour.colorSpace = SRGBColorSpace;
    groundColour.colorSpace = SRGBColorSpace;
    vergeColour.colorSpace = SRGBColorSpace;
    rockColour.colorSpace = SRGBColorSpace;
    cragColour.colorSpace = SRGBColorSpace;
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
    const riderTextures = {} as Record<RealisticRiderMap, Texture>;
    for (const each of riderMaps) {
      const map = await each.texture;
      // The body's own texture coordinates, which never repeat.
      map.minFilter = LinearMipmapLinearFilter;
      if (each.map === 'colour') map.colorSpace = SRGBColorSpace;
      riderTextures[each.map] = map;
    }
    const bicycle = {} as Record<RealisticBicycleMap, Texture>;
    for (const each of bicycleMaps) {
      const map = await each.texture;
      // Along a part repeats; across a band never does (`bicycle-surfaces.ts`).
      // The paint's map is one tile both ways.
      map.wrapS = RepeatWrapping;
      map.wrapT = each.map === 'paintRoughness' ? RepeatWrapping : ClampToEdgeWrapping;
      map.minFilter = LinearMipmapLinearFilter;
      bicycle[each.map] = map;
    }
    skyTexture.mapping = EquirectangularReflectionMapping;
    const pixels = skyPixelsOf(skyTexture);
    const directions = skyHorizonTable(
      pixels,
      REALISTIC_HORIZON_BAND[0],
      REALISTIC_HORIZON_BAND[1],
    );
    const skyRead = {
      texture: skyTexture,
      upward: upwardRadiance(pixels),
      sunU: skySunU(pixels),
      // #475. @see WaterBelt.update
      zenith: skyBandRadiance(pixels, WATER_ZENITH_BAND[0], WATER_ZENITH_BAND[1]),
      horizon: skyBandRadiance(pixels, WATER_HORIZON_BAND[0], WATER_HORIZON_BAND[1]),
      // #544. @see ThreeGameView.#updateWorld
      skyline: skyBandRadiance(pixels, REALISTIC_HORIZON_BAND[0], REALISTIC_HORIZON_BAND[1]),
      // #622: read once, here, and never per frame.
      directions,
      flatDirections: flattenedTable(directions),
    };
    // ⚠️ Swapped in only once the new world is whole, and the old one released
    // only after the swap: a reload that failed half-way, or whose release
    // threw, must leave the world a view draws intact — the first version of
    // this released first and lost both, which `realistic-renderer.test.ts`
    // §"never half a world" caught.
    const wordmarkTexture = await wordmark;
    wordmarkTexture.colorSpace = SRGBColorSpace;
    wordmarkTexture.minFilter = LinearMipmapLinearFilter;
    wordmarkTexture.wrapS = ClampToEdgeWrapping;
    wordmarkTexture.wrapT = ClampToEdgeWrapping;
    const glyphBytes = await glyphs;
    const banners = bannersOf(glyphBytes);
    if (banners !== undefined) loaded.textures.push(banners.texture);
    // #1585: the models' triangles, copied once; the atlas, never repeated.
    const houseGeometries = await Promise.all(
      houseScenes.map(async (each) => houseGeometryOf(await each)),
    );
    // ⚠️ The loader's scenes are not released: they were never drawn, so they
    // hold nothing on the GPU, and a loader may hand the same scene for two
    // files (a test's does), which a release here would take from the other.
    const atlasTexture = await houseAtlas;
    atlasTexture.colorSpace = SRGBColorSpace;
    atlasTexture.minFilter = LinearMipmapLinearFilter;
    atlasTexture.wrapS = ClampToEdgeWrapping;
    atlasTexture.wrapT = ClampToEdgeWrapping;
    const houses: RealisticHouses | undefined = houseGeometries.every(
      (each): each is HouseGeometry => each !== undefined,
    )
      ? {
          models: houseGeometries,
          atlas: atlasTexture,
          triangles: houseGeometries.map((each) => each.triangles),
        }
      : undefined;
    const previous = realisticWorld;
    realisticWorld = {
      sky: skyRead,
      road: { colour: roadColour, normal: roadNormal },
      ground: { colour: groundColour, normal: groundNormal },
      verge: { colour: vergeColour, normal: vergeNormal },
      rock: { colour: rockColour, normal: rockNormal },
      crag: { colour: cragColour, normal: cragNormal },
      vegetation,
      structures,
      body,
      rider: riderTextures,
      bicycle,
      ...(banners === undefined ? {} : { banners }),
      wordmark: wordmarkTexture,
      ...(houses === undefined ? {} : { houses }),
    };
    // #545: the near-plane cull's shapes, built now rather than on a frame.
    warmNearFieldShapes('realistic');
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

/** Whether the next realistic load merges each shape's materials. @see setRealisticMaterialsMerged */
let realisticMaterialsMerged = true;

/**
 * Makes the NEXT realistic load keep each tree's parts one per material, as
 * every load did before #639 — or, with `true`, merge them, as the product
 * does. The browser gate's control for #639: the same wooded view drawn from
 * a world loaded that way must make more draw calls than
 * `realistic-budget.ts` §`REALISTIC_WOODED_DRAW_CALLS`, over the same
 * triangles, into the same picture.
 *
 * @test-facing `apps/web/browser/game-harness.ts` §`treeLevelRun` loads its
 * control with it; the product always merges
 */
export function setRealisticMaterialsMerged(on: boolean): void {
  realisticMaterialsMerged = on;
}

/** Which trees the next realistic load draws. @see setRealisticTrees */
let realisticTrees: RealisticTrees = REALISTIC_TREES_DEFAULT;

/**
 * Makes the NEXT realistic load draw its trees from the scans, as every load
 * did before #1283 — or, with `'generated'`, from the generated trees, as the
 * product does (`realistic-assets.ts` §`REALISTIC_TREES_DEFAULT`), or with
 * `'scanned-conifers'` the generated broadleaves beside the scanned firs, as
 * every load did between #1283 and #1294. Only the one set asked for is
 * fetched, decoded and held.
 *
 * ADR 0049 D-1 keeps a generated tree only where the tablet measurement says
 * it should, so until that row is in, the scans are one switch away: the
 * owner's page loads them with `?levers=-generated-trees` or, for the firs
 * alone, `?levers=-generated-conifers`, and the browser gate measures the
 * generated set and the scans at the same route positions with the same camera.
 *
 * @test-facing `apps/web/browser/realistic-harness.ts` and
 * `apps/web/browser/game-harness.ts` §`treeLevelRun` load the scans with it; the
 * product never calls it
 */
export function setRealisticTrees(trees: RealisticTrees): void {
  realisticTrees = trees;
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
export function loadRealisticWorldOnce(loaders?: RealisticLoaders): Promise<RealisticWorldOutcome> {
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
    // #639: every layer's maps, which a merged material holds beyond its own two.
    for (const map of texturesOf(part.material)) map.dispose();
    part.material.dispose();
  }
  shape.impostor?.texture.dispose();
  shape.impostor?.normals?.dispose();
  shape.impostor?.material.dispose();
  // #617: the middle level's geometry is its own; its materials are the near parts'.
  for (const part of shape.middle?.parts ?? []) part.geometry.dispose();
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

/**
 * Every map of the road's and the ground's surfaces, the road's two first —
 * #1274. ⚠️ **One list, where five places each typed their own**: what is
 * reported to the browser gate, what is uploaded for it, what is filtered
 * anisotropically, and what is let go of when a world is replaced or evicted.
 * A surface added to one of five and not another was a texture held for ever,
 * or drawn shimmering, with nothing to say so; `crag` was the fifth name to be
 * added to all of them by hand.
 */
function surfaceMapsOf(world: RealisticWorld): readonly Texture[] {
  return [world.road, world.ground, world.verge, world.rock, world.crag].flatMap((maps) => [
    maps.colour,
    maps.normal,
  ]);
}

/** Releases a realistic world that another has replaced. */
function releaseRealisticWorld(world: RealisticWorld): void {
  world.sky.texture.dispose();
  world.banners?.texture.dispose();
  world.wordmark.dispose();
  // #1585: the house models' atlas; their triangles are plain arrays.
  world.houses?.atlas.dispose();
  for (const texture of surfaceMapsOf(world)) texture.dispose();
  for (const shapes of world.vegetation.values()) {
    for (const shape of shapes) releaseRealisticShape(shape);
  }
  for (const maps of world.structures.values()) {
    maps.colour.dispose();
    maps.normal.dispose();
  }
  for (const map of REALISTIC_BICYCLE_MAP_NAMES) world.bicycle[map].dispose();
  for (const map of REALISTIC_RIDER_MAP_NAMES) world.rider[map].dispose();
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
  impostorNormals?: Texture,
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
    // #617: the name the middle level's parts are paired by. @see prepareMiddleLevel
    material.name = typeof loaded.name === 'string' ? loaded.name : '';
    // #619 lever 2. The middle level wears this same material, so it is taught too.
    withTextureLodBias(material);
    // #622, and for the same reason.
    withAtmosphere(material);
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
      : {
          texture: impostorStrip,
          material: impostorMaterial(impostorStrip, extras, impostorNormals),
          ...(impostorNormals === undefined ? {} : { normals: impostorNormals }),
        };
  return { name, parts, extent, triangles, ...(impostor === undefined ? {} : { impostor }) };
}

/**
 * A tree's middle level of detail, added to its prepared near shape — #617.
 *
 * The middle file carries no image (`tools/realistic/sources.ts` §`middle`):
 * each of its meshes is taken into the model's own frame as the near file's
 * are, and paired with the near part whose loaded material had the SAME NAME —
 * the scan's own material names survive both runs of the pipeline — and wears
 * that part's material, maps and all. So the level costs no texture memory,
 * no material and no shader program, and a leaf card is cut at the same alpha
 * in both levels.
 *
 * It is sized by the NEAR shape's recorded extent, so the two levels of one
 * item are drawn with one matrix; a middle file recording a different scan
 * size is refused, because it would be a different scan.
 *
 * The loader's middle materials are disposed here. Throws when a part names a
 * material the near file does not have.
 */
export function prepareMiddleLevel(
  near: RealisticShape,
  source: Object3D,
  name: string,
): RealisticShape {
  source.updateWorldMatrix(false, true);
  const byName = new Map<string, MeshStandardMaterial>();
  for (const part of near.parts) byName.set(part.material.name, part.material);
  const parts: RealisticPart[] = [];
  let triangles = 0;
  let extent = Number.NaN;
  source.traverse((node) => {
    const extra = (node as Partial<{ userData: Record<string, unknown> }>).userData;
    if (extra !== undefined && typeof extra['oyl_scan_height'] === 'number') {
      extent = Math.max(Number(extra['oyl_scan_height']), Number(extra['oyl_scan_width']));
    }
    const mesh = node as Partial<Mesh>;
    if (mesh.isMesh !== true || mesh.geometry === undefined) return;
    const loaded = mesh.material;
    if (loaded === undefined || Array.isArray(loaded)) {
      throw new Error(`${name}: a middle part declares no material, or more than one`);
    }
    const wears = typeof loaded.name === 'string' ? loaded.name : '';
    const material = byName.get(wears);
    if (material === undefined) {
      throw new Error(`${name}: the middle level wears ${wears}, which the near file does not`);
    }
    loaded.dispose();
    const geometry = mesh.geometry.clone().applyMatrix4(node.matrixWorld);
    triangles += (geometry.getIndex()?.count ?? geometry.getAttribute('position').count) / 3;
    parts.push({ geometry, material });
  });
  if (parts.length === 0) throw new Error(`${name}: the middle level holds no mesh`);
  if (!(Math.abs(extent - near.extent) <= 1e-6 * near.extent)) {
    throw new Error(`${name}: the middle level records a different scan size from the near one`);
  }
  return { ...near, middle: { parts, triangles } };
}

/**
 * The most layers one merged realistic material may hold: **4** — #639. Every
 * committed tree has three (its bark, its branches and its leaves, or a fir's
 * live and dead branches and its twigs), and a layer past the first costs two
 * samplers: four layers is six of the sixteen texture units WebGL 2 promises,
 * beside the colour map, the normal map, the environment map and three's own
 * lookup table. A scan with more is refused rather than drawn in fewer calls
 * and more units than a phone may have.
 */
const MAXIMUM_MATERIAL_LAYERS = 4;

/**
 * What a merged material samples beyond its own `map` and `normalMap` — #639:
 * layer 1's colour and normal maps, then layer 2's, and so on. Keyed by the
 * material, so that every place that releases, evicts, uploads or reports a
 * realistic material's textures reaches them ({@link texturesOf}); a reader
 * of `map` and `normalMap` alone would see one layer in three.
 */
const LAYER_TEXTURES = new WeakMap<Material, readonly Texture[]>();

/**
 * Every texture a realistic vegetation material samples: its colour and normal
 * maps and, for a merged one, every other layer's — #639. @see LAYER_TEXTURES
 */
function texturesOf(material: MeshStandardMaterial): readonly Texture[] {
  const out: Texture[] = [];
  if (material.map !== null) out.push(material.map);
  if (material.normalMap !== null) out.push(material.normalMap);
  out.push(...(LAYER_TEXTURES.get(material) ?? []));
  return out;
}

/**
 * How many layers a material was merged from — 1 for one that was not.
 *
 * @test-facing held by `realistic-renderer.test.ts` §"#639", which asserts a
 * merged tree's one material holds every layer its parts wore
 */
export function materialLayers(material: Material): number {
  const extra = LAYER_TEXTURES.get(material);
  return extra === undefined ? 1 : 1 + extra.length / 2;
}

/**
 * A realistic shape whose parts are drawn as ONE part — one geometry and one
 * material per level — rather than one per material the scan carried. #639.
 *
 * ## Why
 *
 * An instanced mesh is a draw call per level per variant per MATERIAL, and
 * every committed tree carries three: so #617's middle level, drawn beside the
 * full meshes and the impostors, took the wooded view from 33 calls to 39
 * where #617 allowed 35. One material a tree makes the full and the middle
 * level one call each, whatever the scan was made of.
 *
 * ## How: layers, not an atlas
 *
 * #639 suggested an atlas — every map of a tree packed into one image — and it
 * is not what this does, for three reasons read off the committed files. The
 * bark is TILED: `KHR_texture_transform` repeats `island_tree_02`'s branches
 * 15 × 3.4 times, `tree_small_02`'s 3 × 0.6, a fir's 1.2 × 0.1, and a tiled
 * map inside an atlas needs the wrap done in the shader anyway, with the seams
 * bleeding across mip levels unless every read names its gradients — which is
 * this function's shader and more. Three 512 px maps do not pack into a
 * power-of-two image without a quarter of it empty (a 1024² atlas holds four),
 * which is texture memory #639 forbids spending, or a smaller copy of each,
 * which is a loss of detail it did not ask for. And an atlas moves every
 * derived model's bytes, where this moves none: the committed files, their
 * `ASSETS.toml` rows and `realistic:process --check` are untouched.
 *
 * So each material the scan carried becomes a LAYER of one material: the
 * geometry carries which layer a vertex belongs to (`oylLayer`, one byte), and
 * the fragment shader reads that layer's colour and normal maps
 * ({@link withMaterialLayers}). The maps are the same textures over the same
 * images — three uploads an image once, whatever reads it — so the GPU holds
 * exactly what it held before.
 *
 * ## What is baked, and what is kept per layer
 *
 * - **The texture transform is baked into the coordinates**, which is exactly
 *   what three did per vertex: `vMapUv = transform · uv`. A layer's colour and
 *   normal maps must share one transform and one coordinate set, as every
 *   committed scan's do; one that does not is refused.
 * - **Per layer, in uniforms**: the colour factor, the normal scale (a scan's
 *   branches may be 0.5), and whether it is cut. A layer that was not
 *   alpha-tested — bark — keeps every fragment, as it did.
 *
 * ## ⚠️ What changes, and it is not the picture
 *
 * A tree with leaves is ONE alpha-tested material now, so its bark is drawn in
 * the canopy's place in the order (`FOLIAGE_RENDER_ORDER`) rather than with the
 * opaque world. Every realistic tree's program already carried #617's dither
 * `discard`, so no bark lost an early depth rejection it had; and the depth
 * test keeps the nearest fragment whatever arrives first.
 *
 * The middle level, which wore the near parts' own materials (#617), wears the
 * one merged material too, and its coordinates are baked with the SAME layers'
 * transforms. A shape with one material is returned as it is. The parts it
 * replaces — their geometries and constructed materials — are released here;
 * their textures are not, because the merged material samples the same images.
 *
 * ## ⚠️ A merged tree must not cast a shadow as things stand
 *
 * The material's own `map` is LAYER 0's colour map, read through the BAKED
 * coordinates, and nothing else of the layers is visible to three outside this
 * shader. Three's shadow depth pass builds its own material from `map` and
 * `alphaTest` alone (`WebGLShadowMap`'s depth material), so a merged tree that
 * cast would cut every layer against layer 0's picture: a bark-first scan
 * would throw solid leaf quads, a leaf-first one would cut its bark into
 * holes. Nothing casts from the vegetation today — `three-seam.test.ts` §"lets
 * only the sun and the riders cast a shadow" counts every `castShadow` write
 * in this file, and a third is a red build — so whoever lifts that rule for
 * the trees owes them a depth material that reads `oylLayer` first.
 */
export function mergeShapeMaterials(shape: RealisticShape, name: string): RealisticShape {
  const layers = [...new Set(shape.parts.map((part) => part.material))];
  if (layers.length < 2) return shape;
  if (layers.length > MAXIMUM_MATERIAL_LAYERS) {
    throw new Error(`${name}: ${String(layers.length)} materials, more than one draw can layer`);
  }
  const vertexColours = layers.map((material) => material.vertexColors);
  if (new Set(vertexColours).size !== 1) {
    throw new Error(`${name}: some of its parts carry vertex colours and some do not`);
  }
  const transforms = layers.map((material) => layerTransform(material, name));
  const plain = (texture: Texture): Texture => {
    // A second texture object over the SAME image — `Source` — so three
    // uploads nothing twice, with the transform it no longer needs taken off.
    const copy = texture.clone();
    copy.matrixAutoUpdate = false;
    copy.matrix.identity();
    copy.channel = 0;
    return copy;
  };
  const maps = layers.map((material) => ({
    colour: plain(material.map as Texture),
    normal: plain(material.normalMap as Texture),
  }));
  const first = maps[0] as (typeof maps)[number];
  const cut = layers.map((material) => material.alphaTest > 0);
  const material = constructed(
    new MeshStandardMaterial({
      color: new Color(0xffffff),
      map: first.colour,
      normalMap: first.normal,
      vertexColors: vertexColours[0] === true,
      roughness: REALISTIC_ROUGHNESS,
      metalness: 0,
      side: DoubleSide,
      alphaTest: cut.some((each) => each) ? REALISTIC_ALPHA_CUTOFF : 0,
      transparent: false,
    }),
  );
  material.name = name;
  LAYER_TEXTURES.set(
    material,
    maps.slice(1).flatMap((each) => [each.colour, each.normal]),
  );
  withTextureLodBias(material);
  withAtmosphere(material);
  // #630: which layers are leaves, for the breeze. @see withFoliageSwayOf
  FOLIAGE_LAYERS.set(material, cut);
  withMaterialLayers(material, {
    colours: layers.map((each) => each.color.clone()),
    normalScales: layers.map((each) => each.normalScale.clone()),
    cut,
  });
  const layerOf = (part: RealisticPart): number => {
    const layer = layers.indexOf(part.material);
    if (layer < 0) throw new Error(`${name}: a part wears a material the shape does not`);
    return layer;
  };
  const near = layeredGeometry(shape.parts, layerOf, transforms, name);
  const middle =
    shape.middle === undefined
      ? undefined
      : {
          parts: [
            {
              geometry: layeredGeometry(shape.middle.parts, layerOf, transforms, name),
              material,
            },
          ],
          triangles: shape.middle.triangles,
        };
  for (const part of [...shape.parts, ...(shape.middle?.parts ?? [])]) part.geometry.dispose();
  for (const each of layers) each.dispose();
  return {
    ...shape,
    parts: [{ geometry: near, material }],
    ...(middle === undefined ? {} : { middle }),
  };
}

/** One layer's texture transform and coordinate set. @see mergeShapeMaterials */
interface LayerTransform {
  /** three's `Matrix3` elements, column-major: `uv' = M · (u, v, 1)`. */
  readonly elements: readonly number[];
  readonly channel: number;
}

/**
 * The transform a layer's maps are read through — which its colour and normal
 * maps must share, or the layer cannot be baked into one set of coordinates.
 */
function layerTransform(material: MeshStandardMaterial, name: string): LayerTransform {
  const { map, normalMap } = material;
  if (map === null || normalMap === null) {
    throw new Error(`${name}: ${material.name} has no colour map or no normal map to layer`);
  }
  if (map.matrixAutoUpdate) map.updateMatrix();
  if (normalMap.matrixAutoUpdate) normalMap.updateMatrix();
  const elements = [...map.matrix.elements];
  const same = normalMap.matrix.elements.every(
    (value, index) => Math.abs(value - (elements[index] ?? Number.NaN)) <= 1e-9,
  );
  if (!same || map.channel !== normalMap.channel) {
    throw new Error(`${name}: ${material.name}'s colour and normal maps are read differently`);
  }
  return { elements, channel: map.channel };
}

/**
 * The parts of one level as ONE geometry — #639: positions, normals, the
 * vertex colours in the files' own type, the coordinates with each layer's
 * transform baked in, and `oylLayer`, a byte a vertex. The parts are put in
 * layer order, so the triangles of a layer are one run of the index.
 */
function layeredGeometry(
  parts: readonly RealisticPart[],
  layerOf: (part: RealisticPart) => number,
  transforms: readonly LayerTransform[],
  name: string,
): BufferGeometry {
  const ordered = parts
    .map((part) => ({ part, layer: layerOf(part) }))
    .sort((a, b) => a.layer - b.layer);
  let vertices = 0;
  let indices = 0;
  for (const { part } of ordered) {
    const count = part.geometry.getAttribute('position').count;
    vertices += count;
    indices += part.geometry.getIndex()?.count ?? count;
  }
  const colour = ordered[0]?.part.geometry.getAttribute('color') as BufferAttribute | undefined;
  const position = new Float32Array(vertices * 3);
  const normal = new Float32Array(vertices * 3);
  const uv = new Float32Array(vertices * 2);
  const layer = new Uint8Array(vertices);
  const colours =
    colour === undefined
      ? undefined
      : new (colour.array.constructor as new (length: number) => BufferAttribute['array'])(
          vertices * colour.itemSize,
        );
  const index = vertices > 0xffff ? new Uint32Array(indices) : new Uint16Array(indices);
  const merged = new BufferGeometry();
  let base = 0;
  let at = 0;
  for (const { part, layer: which } of ordered) {
    const geometry = part.geometry;
    const transform = transforms[which] as LayerTransform;
    const from = {
      position: geometry.getAttribute('position'),
      normal: geometry.getAttribute('normal') as BufferAttribute | undefined,
      uv: geometry.getAttribute(
        transform.channel === 0 ? 'uv' : `uv${String(transform.channel)}`,
      ) as BufferAttribute | undefined,
      colour: geometry.getAttribute('color') as BufferAttribute | undefined,
    };
    if (from.normal === undefined || from.uv === undefined) {
      throw new Error(`${name}: a part has no normals, or no coordinates for its maps`);
    }
    if (
      (from.colour === undefined) !== (colour === undefined) ||
      (colour !== undefined &&
        (from.colour?.itemSize !== colour.itemSize ||
          from.colour.normalized !== colour.normalized ||
          from.colour.array.constructor !== colour.array.constructor))
    ) {
      throw new Error(`${name}: its parts carry vertex colours of different kinds`);
    }
    const [a, b, , c, d, , e, f] = transform.elements as number[];
    const count = from.position.count;
    for (let vertex = 0; vertex < count; vertex += 1) {
      const out = base + vertex;
      position[out * 3] = from.position.getX(vertex);
      position[out * 3 + 1] = from.position.getY(vertex);
      position[out * 3 + 2] = from.position.getZ(vertex);
      normal[out * 3] = from.normal.getX(vertex);
      normal[out * 3 + 1] = from.normal.getY(vertex);
      normal[out * 3 + 2] = from.normal.getZ(vertex);
      const u = from.uv.getX(vertex);
      const v = from.uv.getY(vertex);
      uv[out * 2] = (a ?? 1) * u + (c ?? 0) * v + (e ?? 0);
      uv[out * 2 + 1] = (b ?? 0) * u + (d ?? 1) * v + (f ?? 0);
      layer[out] = which;
    }
    if (colours !== undefined && from.colour !== undefined) {
      // The files' own values, copied as they are: so the colours must be the
      // attribute's whole array, which an interleaved one is not.
      if (from.colour.array.length !== count * from.colour.itemSize) {
        throw new Error(`${name}: a part's vertex colours are not an array of their own`);
      }
      colours.set(from.colour.array, base * from.colour.itemSize);
    }
    const own = geometry.getIndex();
    if (own === null) {
      for (let vertex = 0; vertex < count; vertex += 1) index[at++] = base + vertex;
    } else {
      for (let slot = 0; slot < own.count; slot += 1) index[at++] = base + own.getX(slot);
    }
    base += count;
  }
  merged.setAttribute('position', new BufferAttribute(position, 3));
  merged.setAttribute('normal', new BufferAttribute(normal, 3));
  merged.setAttribute('uv', new BufferAttribute(uv, 2));
  if (colours !== undefined && colour !== undefined) {
    merged.setAttribute('color', new BufferAttribute(colours, colour.itemSize, colour.normalized));
  }
  merged.setAttribute('oylLayer', new BufferAttribute(layer, 1));
  merged.setIndex(new BufferAttribute(index, 1));
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  return merged;
}

/** What {@link withMaterialLayers} hands the shader, per layer. */
interface MaterialLayers {
  readonly colours: readonly Color[];
  readonly normalScales: readonly Vector2[];
  readonly cut: readonly boolean[];
}

/**
 * Teaches a merged material to read each fragment's own layer — #639.
 *
 * The vertex shader hands `oylLayer` on as a FLAT varying: every vertex of a
 * triangle is in one layer, so the value is the triangle's. The fragment shader
 * then reads the colour and the normal map of that layer, times its colour
 * factor and its normal scale, and a layer that was never cut keeps an alpha
 * of 1, so the material's alpha test passes it.
 *
 * ⚠️ **Every read names its gradients** (`textureGrad`), taken once before the
 * layer is chosen: a texture read with implicit derivatives inside a branch is
 * undefined in GLSL ES 3.00 wherever the branch is not uniform, and although a
 * flat varying is uniform across one triangle's pixels the specification does
 * not say so. #619's bias is kept by scaling the gradients by `2^bias`, which
 * moves the level of detail by exactly `bias` — the one lever `texture(s, uv,
 * bias)` pulls. So this is taught AFTER {@link withTextureLodBias}, and throws
 * if the program does not hold its uniform.
 *
 * Every replacement throws where three's program no longer holds the text it
 * replaces, for {@link replacedOrThrown}'s reason. Keyed by the layer count,
 * which is all the program's text depends on.
 */
function withMaterialLayers(material: MeshStandardMaterial, layers: MaterialLayers): void {
  const count = layers.colours.length;
  const extra = LAYER_TEXTURES.get(material) ?? [];
  const earlier = material.onBeforeCompile.bind(material);
  const earlierKey = material.customProgramCacheKey();
  const spliced = "#639's layers";
  const others = Array.from({ length: count - 1 }, (_, index) => index + 1);
  const read = (sampler: (layer: number) => string, own: string): string =>
    `${others
      .map(
        (layer) =>
          `  if (oylAt == ${String(layer)}) return textureGrad(${sampler(layer)}, uv, oylDx, oylDy);\n`,
      )
      .join('')}  return textureGrad(${own}, uv, oylDx, oylDy);`;
  const helpers = /* glsl */ `
flat varying float vOylLayer;
uniform vec3 oylLayerColour[${String(count)}];
uniform vec2 oylLayerNormalScale[${String(count)}];
uniform float oylLayerCut[${String(count)}];
${others
  .map(
    (layer) =>
      `uniform sampler2D oylLayerMap${String(layer)};\nuniform sampler2D oylLayerNormalMap${String(layer)};`,
  )
  .join('\n')}
int oylLayerOf() { return int(vOylLayer + 0.5); }
vec4 oylLayerTexel(vec2 uv) {
  float oylGrow = exp2(oylTextureLodBias);
  vec2 oylDx = dFdx(uv) * oylGrow;
  vec2 oylDy = dFdy(uv) * oylGrow;
  int oylAt = oylLayerOf();
${read((layer) => `oylLayerMap${String(layer)}`, 'map')}
}
`;
  // After three's `normalMap` is declared, which is later than `map` is.
  const normalHelper = /* glsl */ `
vec4 oylLayerNormalTexel(vec2 uv) {
  float oylGrow = exp2(oylTextureLodBias);
  vec2 oylDx = dFdx(uv) * oylGrow;
  vec2 oylDy = dFdy(uv) * oylGrow;
  int oylAt = oylLayerOf();
${read((layer) => `oylLayerNormalMap${String(layer)}`, 'normalMap')}
}
`;
  const mapChunk = `${replacedOrThrown(
    ShaderChunk.map_fragment,
    'texture2D( map, vMapUv )',
    'oylLayerTexel( vMapUv )',
    'fragment',
    spliced,
  )}
diffuseColor.rgb *= oylLayerColour[ oylLayerOf() ];
if ( oylLayerCut[ oylLayerOf() ] < 0.5 ) diffuseColor.a = 1.0;
`;
  const normalChunk = replacedOrThrown(
    replacedOrThrown(
      ShaderChunk.normal_fragment_maps,
      'texture2D( normalMap, vNormalMapUv )',
      'oylLayerNormalTexel( vNormalMapUv )',
      'fragment',
      spliced,
    ).replaceAll('texture2D( normalMap, vNormalMapUv )', 'oylLayerNormalTexel( vNormalMapUv )'),
    'mapN.xy *= normalScale;',
    'mapN.xy *= oylLayerNormalScale[ oylLayerOf() ];',
    'fragment',
    spliced,
  );
  material.onBeforeCompile = (shader, renderer) => {
    earlier(shader, renderer);
    if (!shader.fragmentShader.includes('uniform float oylTextureLodBias;')) {
      throw new Error(`${spliced} are taught after #619's texture bias, which this program lacks`);
    }
    shader.uniforms['oylLayerColour'] = { value: layers.colours };
    shader.uniforms['oylLayerNormalScale'] = { value: layers.normalScales };
    shader.uniforms['oylLayerCut'] = { value: layers.cut.map((each) => (each ? 1 : 0)) };
    for (const layer of others) {
      shader.uniforms[`oylLayerMap${String(layer)}`] = { value: extra[2 * (layer - 1)] ?? null };
      shader.uniforms[`oylLayerNormalMap${String(layer)}`] = {
        value: extra[2 * (layer - 1) + 1] ?? null,
      };
    }
    shader.vertexShader = replacedOrThrown(
      replacedOrThrown(
        shader.vertexShader,
        '#include <common>',
        '#include <common>\nattribute float oylLayer;\nflat varying float vOylLayer;',
        'vertex',
        spliced,
      ),
      '#include <begin_vertex>',
      '#include <begin_vertex>\nvOylLayer = oylLayer;',
      'vertex',
      spliced,
    );
    shader.fragmentShader = replacedOrThrown(
      replacedOrThrown(
        replacedOrThrown(
          shader.fragmentShader,
          '#include <map_pars_fragment>',
          `#include <map_pars_fragment>\n${helpers}`,
          'fragment',
          spliced,
        ),
        '#include <map_fragment>',
        mapChunk,
        'fragment',
        spliced,
      ),
      '#include <normalmap_pars_fragment>',
      `#include <normalmap_pars_fragment>\n${normalHelper}`,
      'fragment',
      spliced,
    );
    shader.fragmentShader = replacedOrThrown(
      shader.fragmentShader,
      '#include <normal_fragment_maps>',
      normalChunk,
      'fragment',
      spliced,
    );
  };
  material.customProgramCacheKey = () => `${earlierKey}|oyl-layers-${String(count)}`;
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

/**
 * When each level of the realistic vegetation's alpha-tested foliage is drawn
 * — #619 lever 1: after everything opaque, and nearest level first.
 *
 * ## Why the order is worth setting
 *
 * A leaf card is cut with `discard` ({@link REALISTIC_ALPHA_CUTOFF}), and on a
 * tile-based GPU — the tablet's Mali-G710 — a fragment shader that may discard
 * cannot have its hidden fragments removed ahead of shading the way an opaque
 * one's are: whatever the depth buffer does not already reject is shaded.
 * three sorts its opaque list by `renderOrder`, then by MATERIAL, then by
 * depth, and the scans' materials are made at load, before the road's, the
 * ground's and the structures' — so until #619 the canopy was drawn FIRST,
 * into an empty depth buffer, and every leaf behind a hill, a house or the
 * ground in front of it was shaded and then overdrawn.
 *
 * Drawn after them, it meets a depth buffer the opaque world has already
 * filled, and the leaves behind it fail the depth test before they are
 * shaded. Near before middle before impostor puts the nearest canopy — which
 * hides the most — into the depth buffer first.
 *
 * ## What it does not change
 *
 * **The picture.** The depth test keeps the nearest fragment whatever order
 * they arrive in, and #617's two levels of one tree keep complementary pixels,
 * so there is no tie for the order to break — `game.browser.spec.ts` §"#619"
 * reads a frame back both ways and requires them identical. Rocks and
 * anything else opaque stay at 0, with the rest of the opaque world.
 * ⚠️ **A tree's bark does not, since #639**, and a reviewer who remembers
 * "bark stays at 0" is reading the old file: a tree is one alpha-tested
 * material a level now (`mergeShapeMaterials`), its bark a layer of it, so the
 * whole tree is drawn in its level's place. Shadow
 * passes do not sort by it. Within one level the instances are in the frame's
 * own order, which is not nearest first; the full level holds only the few
 * nearest trees, and re-sorting instances each frame is left unmeasured.
 *
 * ⚠️ **The realistic world only**: the stylised belt sets none, so no stylised
 * draw moves.
 */
const FOLIAGE_RENDER_ORDER = { near: 1, middle: 2, impostor: 3 } as const;

/**
 * Where a vegetation mesh at a level is drawn: its level's place if it is
 * alpha-tested, and 0 — with the rest of the opaque world — if it is not.
 * @see FOLIAGE_RENDER_ORDER
 */
function foliageRenderOrder(mesh: InstancedMesh, level: keyof typeof FOLIAGE_RENDER_ORDER): number {
  const material = mesh.material as Material;
  const cut = level === 'impostor' || material.alphaTest > 0;
  return cut ? FOLIAGE_RENDER_ORDER[level] : 0;
}

/** Gives a vegetation mesh its place in the draw order. @see foliageRenderOrder */
function drawnInOrder(
  mesh: InstancedMesh,
  level: keyof typeof FOLIAGE_RENDER_ORDER,
): InstancedMesh {
  mesh.renderOrder = foliageRenderOrder(mesh, level);
  return mesh;
}

/**
 * The realistic world's texture level-of-detail bias — #619 lever 2: the ONE
 * uniform every textured realistic material reads, set by the view from its
 * rung (`quality.ts` §`QualitySettings.textureLodBias`) immediately before it
 * draws.
 *
 * ## Why one uniform, set per draw, rather than a define or a texture setting
 *
 * - **A define** would recompile every realistic program when a hot tablet
 *   steps down, in the middle of a ride — the hitch #547 warms programs to
 *   avoid. A uniform's value changes nothing three caches.
 * - **A texture setting** does not exist: WebGL 2 has no `TEXTURE_LOD_BIAS`,
 *   and a smaller base level would be a second upload of every photograph.
 * - **Per view, per draw**: the materials are the loaded world's and several
 *   views share them, so the value is written by whichever view is about to
 *   draw, as three writes every other uniform at draw time. A view drawing the
 *   stylised world writes 0, which no stylised material reads anyway.
 *
 * @see withTextureLodBias
 */
const REALISTIC_TEXTURE_LOD_BIAS = { value: 0 };

/**
 * Teaches a realistic material the rung's texture bias — #619 lever 2.
 *
 * Every `texture2D` its fragment shader makes, three's own chunks included,
 * becomes GLSL ES 3.00's `texture(sampler, uv, bias)`. A bias of 0 is the
 * unbiased read the specification defines it to be, so the top rung's picture
 * is unchanged; and it moves only a MIPMAPPED texture — the environment map's
 * atlas, the shadow map and three's DFG table have no mips, so they are read
 * exactly as before. `textureLod` — the road's and the ground's one-texel
 * mean — names its level outright and is not touched.
 *
 * ⚠️ Chained after whatever the material already does before it compiles,
 * and keyed apart, for {@link withSurfaceDetail}'s reason. Idempotent.
 */
function withTextureLodBias<M extends Material>(material: M): M {
  if (TEXTURE_BIASED.has(material)) return material;
  TEXTURE_BIASED.add(material);
  const earlier = material.onBeforeCompile.bind(material);
  const earlierKey = material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    earlier(shader, renderer);
    shader.uniforms['oylTextureLodBias'] = REALISTIC_TEXTURE_LOD_BIAS;
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      `#include <common>
uniform float oylTextureLodBias;
#undef texture2D
#define texture2D(oylSampler, oylUv) texture(oylSampler, oylUv, oylTextureLodBias)`,
    );
  };
  material.customProgramCacheKey = () => `${earlierKey}|oyl-texture-lod-bias`;
  return material;
}

/** The materials {@link withTextureLodBias} has already taught. */
const TEXTURE_BIASED = new WeakSet<Material>();

/**
 * Whether a material reads the rung's texture bias — #619.
 *
 * @test-facing held by `realistic-renderer.test.ts`, which asserts every
 * textured realistic material is taught it and no stylised one is
 */
export function readsTextureLodBias(material: Material): boolean {
  return TEXTURE_BIASED.has(material);
}

/**
 * The realistic world's air — #622. One set of uniforms every realistic
 * material that fogs reads, written by the view that is about to draw
 * ({@link ThreeGameView.render}), for {@link REALISTIC_TEXTURE_LOD_BIAS}'s
 * reason: several views share these materials.
 *
 * - `oylFogTable`: the sky just above its skyline in
 *   {@link HORIZON_AZIMUTH_BINS} directions, as DRAWN (times the background's
 *   intensity), in the OUTPUT colour space — the one three hands a fog colour
 *   to a shader in (`WebGLMaterials.js` §`refreshFogUniforms`), so that a flat
 *   table is exactly the `fogColor` it is blended from. 16 `vec3`s, 192 bytes.
 *   ⚠️ **Only while nothing fogged by the air draws into a render target.**
 *   three converts `fogColor` with `getUnlitUniformColorSpace`: the output
 *   space with the canvas bound, the LINEAR working space with a target bound.
 *   This table is converted once, to the output space, and every program
 *   shares it — so the day a realistic fogged material draws into a target
 *   (#629's reflections, or a post pass #701 decides on), `fogColor` goes
 *   linear, the table does not, and even a FLAT table stops being the fog it
 *   was blended from. That change owes a table per target space, written per
 *   pass. `realistic-renderer.test.ts` §"#703" fails the build when THIS FILE's
 *   code (parsed, so a comment does not count — #708) reaches
 *   `setRenderTarget` as a member however it is spelled (`.x`, `?.x`,
 *   `['x']`, destructured), constructs a `…RenderTarget`, an `EffectComposer`,
 *   a `Reflector`, a `Refractor` or a `CubeCamera`, or names a material's
 *   `transmission`, whose hidden pass three draws into a target. It does not
 *   follow a name held in a value or a constructor under an alias. ⚠️ That is
 *   a tripwire on this file, not a proof about the frame: a
 *   target bound by another module is not seen, and three already binds two of
 *   its own that it cannot see — `PMREMGenerator` (which draws only the
 *   equirectangular sky, never a fogged material) and the shadow map (drawn
 *   with three's depth materials, which take no fog).
 * - `oylFogShare`: `realistic-light.ts` §`REALISTIC_FOG_DIRECTION_SHARE`, or 0
 *   where the horizon is not the photographed sky's (#544's control).
 * - `oylSkyTurn`: `realistic-light.ts` §`skyRotation`, so a direction in the
 *   world reads the sky DRAWN in that direction.
 * - `oylValleyMiddle`, `oylValleyHaze`, `oylValleyDepth`: the valley haze —
 *   `realistic-light.ts` §`valleyHazeFactor`.
 */
const ATMOSPHERE = {
  oylFogTable: { value: new Float32Array(HORIZON_AZIMUTH_BINS * 3) },
  oylFogShare: { value: 0 },
  oylSkyTurn: { value: 0 },
  oylValleyMiddle: { value: 0 },
  oylValleyHaze: { value: 1 },
  oylValleyDepth: { value: REALISTIC_VALLEY_DEPTH_METRES },
};

/**
 * What the realistic fog adds to three's own, in the vertex shader: the WORLD
 * vector from the camera to the vertex. `mvPosition` times the view matrix as a
 * row vector is the view matrix's transpose applied to it, which for its
 * rotation is its inverse, and a `w` of 0 leaves its translation out. Linear
 * in position, so interpolating it across a triangle is exact.
 */
const ATMOSPHERE_VERTEX = /* glsl */ `
#ifdef USE_FOG
  vOylFogRay = (vec4(mvPosition.xyz, 0.0) * viewMatrix).xyz;
#endif
`;

/**
 * The realistic fog, in place of three's `fog_fragment` — #622. Three's own
 * arithmetic (`fog_fragment.glsl.js` in 0.185.1) with two changes and nothing
 * else:
 *
 * 1. **The colour leans towards the sky in the direction looked**:
 *    `realistic-light.ts` §`directionalFogColour`, the same interpolation
 *    between the two nearest bins, wrapping. ⚠️ The bin index is made
 *    POSITIVE before `%`, because GLSL ES 3.00 leaves the integer `%` of a
 *    negative operand undefined, and `oylAt` is negative whenever the azimuth
 *    plus the turn is under −π: `skyRotation` lies in (−2π, 2π), so the sum
 *    lies in (−3π, 3π) and `oylAt` in (−N − 0.5, 2N − 0.5) for N bins —
 *    (−16.5, 31.5) at 16. The offset added is {@link ATMOSPHERE_BIN_OFFSET},
 *    4N: a MULTIPLE of N, so it moves no bin, and larger than N + 1, so it
 *    clears the lowest. #703's review found the literal `64` it replaced
 *    right only while N divided 64 — at 12 or 24 bins every read would have
 *    shifted. Not the float `mod`: a GPU may divide by a reciprocal, and
 *    `floor(24.0 / 12.0)` coming out 1 would index one past the table.
 * 2. **The density rises below the middle of the route's elevation**:
 *    `realistic-light.ts` §`valleyHazeFactor`, at the fragment's own height.
 *
 * About a dozen ALU on a fragment every realistic material already fogs; no
 * texture, no pass, no draw.
 */
/**
 * What {@link ATMOSPHERE_FRAGMENT} adds to a bin index before it wraps it with
 * `%`: **4 ×** {@link HORIZON_AZIMUTH_BINS}, derived so it stays a multiple of
 * the bin count whatever that becomes — see the fragment's note 1.
 */
export const ATMOSPHERE_BIN_OFFSET = 4 * HORIZON_AZIMUTH_BINS;

/**
 * The GLSL of {@link ATMOSPHERE_FRAGMENT}'s bin wrap, as it is spliced —
 * exported, with {@link ATMOSPHERE_BIN_OFFSET}, so `realistic-renderer.test.ts`
 * can hold the offset to a multiple of the bin count, evaluate the wrap at
 * every index the shader can reach, and find it in a compiled material
 * (#703's review).
 */
export const ATMOSPHERE_BIN_WRAP = `(int(oylLower) + ${String(ATMOSPHERE_BIN_OFFSET)}) % ${String(HORIZON_AZIMUTH_BINS)}`;

const ATMOSPHERE_FRAGMENT = /* glsl */ `
#ifdef USE_FOG
{
  float oylAzimuth = atan(vOylFogRay.z, vOylFogRay.x) + oylSkyTurn;
  float oylAt = (oylAzimuth * RECIPROCAL_PI2 + 0.5) * ${HORIZON_AZIMUTH_BINS.toFixed(1)} - 0.5;
  float oylLower = floor(oylAt);
  int oylFrom = ${ATMOSPHERE_BIN_WRAP};
  int oylTo = (oylFrom + 1) % ${String(HORIZON_AZIMUTH_BINS)};
  vec3 oylToward = mix(oylFogTable[oylFrom], oylFogTable[oylTo], oylAt - oylLower);
  vec3 oylFogColour = mix(fogColor, oylToward, oylFogShare);
  float oylBelow = clamp(
    (oylValleyMiddle - (cameraPosition.y + vOylFogRay.y)) / oylValleyDepth, 0.0, 1.0);
  #ifdef FOG_EXP2
    float oylDensity = fogDensity * (1.0 + (oylValleyHaze - 1.0) * oylBelow);
    float fogFactor = 1.0 - exp(- oylDensity * oylDensity * vFogDepth * vFogDepth);
  #else
    float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
  #endif
  gl_FragColor.rgb = mix(gl_FragColor.rgb, oylFogColour, fogFactor);
}
#endif
`;

/**
 * Teaches a realistic material the air — #622: {@link ATMOSPHERE_FRAGMENT} in
 * place of three's `fog_fragment`, and the world ray it needs.
 *
 * ⚠️ **The realistic world's materials only** — ADR 0026 D-3, no rung mixes
 * the two worlds. The stylised world's materials are never taught, so its fog
 * is three's own, byte for byte; `realistic-renderer.test.ts` and the browser
 * gate both check which materials are. The fogged materials the realistic
 * world draws that are NOT taught are the two it shares with the stylised
 * world, where teaching them would change the stylised world: the WATER's
 * (`WaterBelt`) — #629 is where the water meets the realistic sky — and the
 * riders' CONTACT SHADOWS (`ContactShadowBelt`), which lie under a rider where
 * the fog has taken next to nothing. The horizon ring is not
 * fogged at all and takes the same directional colour on the CPU instead
 * (`HorizonRing.update`).
 *
 * Chained after whatever the material already does before it compiles, and
 * keyed apart, for {@link withSurfaceDetail}'s reason; every replacement
 * throws if three's chunk is not there, so a three bump that moved one is a
 * red build rather than a fog that quietly stopped. Idempotent.
 */
function withAtmosphere<M extends Material>(material: M): M {
  if (ATMOSPHERIC.has(material)) return material;
  ATMOSPHERIC.add(material);
  const earlier = material.onBeforeCompile.bind(material);
  const earlierKey = material.customProgramCacheKey();
  const spliced = "#622's air";
  material.onBeforeCompile = (shader, renderer) => {
    earlier(shader, renderer);
    Object.assign(shader.uniforms, ATMOSPHERE);
    shader.vertexShader = replacedOrThrown(
      replacedOrThrown(
        shader.vertexShader,
        '#include <fog_pars_vertex>',
        '#include <fog_pars_vertex>\n#ifdef USE_FOG\nvarying vec3 vOylFogRay;\n#endif',
        'vertex',
        spliced,
      ),
      '#include <fog_vertex>',
      `#include <fog_vertex>${ATMOSPHERE_VERTEX}`,
      'vertex',
      spliced,
    );
    shader.fragmentShader = replacedOrThrown(
      replacedOrThrown(
        shader.fragmentShader,
        '#include <fog_pars_fragment>',
        `#include <fog_pars_fragment>
#ifdef USE_FOG
varying vec3 vOylFogRay;
uniform vec3 oylFogTable[${String(HORIZON_AZIMUTH_BINS)}];
uniform float oylFogShare;
uniform float oylSkyTurn;
uniform float oylValleyMiddle;
uniform float oylValleyHaze;
uniform float oylValleyDepth;
#endif`,
        'fragment',
        spliced,
      ),
      '#include <fog_fragment>',
      ATMOSPHERE_FRAGMENT,
      'fragment',
      spliced,
    );
  };
  material.customProgramCacheKey = () => `${earlierKey}|oyl-atmosphere`;
  return material;
}

/** Reused by `ThreeGameView.#airFor` to convert a colour, so the conversion allocates nothing. */
const AIR_SCRATCH = new Color();

/** The materials {@link withAtmosphere} has taught. */
const ATMOSPHERIC = new WeakSet<Material>();

/**
 * Whether a material breathes the realistic air — #622.
 *
 * @test-facing held by `realistic-renderer.test.ts`, which asserts every
 * realistic material that fogs is taught and no stylised one is
 */
export function breathesTheAir(material: Material): boolean {
  return ATMOSPHERIC.has(material);
}

/**
 * The hand-over between a tree's levels of detail — #617: a fragment is kept
 * only where a screen-space hash falls inside the `[low, high)` its instance
 * carries in `vOylKeep` (`tree-levels.ts` §`writeKeep`), and `low >= high`
 * keeps every fragment. The two levels of one band tree carry complementary
 * halves, so at every pixel exactly one of them is drawn.
 *
 * The hash is interleaved gradient noise (Jimenez, 2014) — a function of the
 * pixel alone, so both levels read the same value at the same pixel, and one
 * that spreads a fade's pixels evenly rather than in blocks.
 */
const TREE_DITHER_DISCARD = /* glsl */ `
  if (vOylKeep.y > vOylKeep.x) {
    float oylDither = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
    if (oylDither < vOylKeep.x || oylDither >= vOylKeep.y) discard;
  }
`;

/** The line of three's `color_vertex` chunk that tints by the instance colour. */
const INSTANCE_TINT = 'vColor.rgb *= instanceColor.rgb;';

/**
 * A realistic instance's seeded tint, in GLSL — #621. `instance-tint.ts` is
 * the arithmetic's home and says why each step is what it is: `oylTintOf`
 * reads the one float `packedInstanceTint` writes (every value an integer
 * below 2²⁴, so exact in a float), and `oylTinted` is `tintedLinear`, step for
 * step — the hue turned about the grey axis, the saturation scaled about the
 * luminance, the brightness scaled. `.x` is radians.
 *
 * ⚠️ Both functions are EVALUATED from the program three is handed, against
 * `unpackInstanceTint` and `tintedLinear`, by `realistic-renderer.test.ts`
 * §"#678" (`glsl-testing.ts` reads the subset they are written in). A step
 * added here outside that subset is a red test naming what it cannot read.
 */
const TINT_DECODE_GLSL = /* glsl */ `
  vec3 oylTintOf(float stored) {
    float whole = stored + ${TINT_CODEC_ZERO.toFixed(1)};
    float brightness = floor(whole / 65536.0);
    float rest = whole - brightness * 65536.0;
    float saturation = floor(rest / 256.0);
    float hue = rest - saturation * 256.0;
    return (vec3(hue, saturation, brightness) - ${TINT_CODEC_STEPS.toFixed(1)})
      / ${TINT_CODEC_STEPS.toFixed(1)}
      * vec3(
        ${((TINT_CODEC_RANGE.hueDegrees * Math.PI) / 180).toFixed(8)},
        ${TINT_CODEC_RANGE.saturation.toFixed(8)},
        ${TINT_CODEC_RANGE.brightness.toFixed(8)}
      );
  }
`;

/** @see TINT_DECODE_GLSL */
const TINT_APPLY_GLSL = /* glsl */ `
  vec3 oylTinted(vec3 colour, vec3 tint) {
    float turnCos = cos(tint.x);
    float turnSin = sin(tint.x);
    vec3 grey = vec3(0.57735027);
    vec3 turned = colour * turnCos + cross(grey, colour) * turnSin
      + grey * dot(grey, colour) * (1.0 - turnCos);
    float luminance = dot(turned, vec3(0.2126, 0.7152, 0.0722));
    return max((vec3(luminance) + (1.0 + tint.y) * (turned - vec3(luminance))) * (1.0 + tint.z), 0.0);
  }
`;

/**
 * The route's season, as the realistic world's materials read it — #1623:
 * `oylAutumn`, how far into autumn its broadleaves are, and `oylRoofSnow`,
 * how much snow a level roof carries. One pair every such material shares,
 * for `FOLIAGE`'s reason, written by the view that draws: its season on
 * `setSeason` and on every realistic frame, and the roofs' from the frame's
 * world (`world.ts` §`roofSnowIn`). Both 0 is the season-free world, drawn
 * exactly as before #1623: a turn of nothing and a mix of nothing.
 */
const SEASON = {
  oylAutumn: { value: 0 },
  oylRoofSnow: { value: 0 },
  /** #1626: 1 while the ride's holiday is the winter lights — the mapped doors' wreath. */
  oylWreath: { value: 0 },
};

/**
 * How far a full autumn turns a broadleaf's green toward orange, degrees:
 * **75** — #1623. This repository's own: green foliage sits near 100° to 120°
 * of hue, and 75° fewer is the yellows and oranges of a turned beech or maple
 * (25° to 45°). A global season, not variation, which is why it is not
 * `instance-tint.ts` §`TINT_CODEC_RANGE`'s ±16°: each tree's own tint still
 * turns it a little either side of this, so a wood does not turn as one.
 */
export const AUTUMN_HUE_DEGREES = 75;

/**
 * How green a fragment must be to turn, as `(g − max(r, b)) / g`: none at
 * **0.05** and all of it from **0.3** — #1623. Bark, a trunk and a dead leaf
 * are not green-led, so a merged tree material (#639), whose bark and leaves
 * are one program, turns its leaves and leaves its bark brown.
 */
const AUTUMN_LEAFY_SHARE: readonly [number, number] = [0.05, 0.3];

/**
 * A broadleaf in autumn, in GLSL — #1623: its green turned toward orange about
 * the grey axis, as `oylTinted` turns a hue, by `autumn` (0 to 1) of
 * {@link AUTUMN_HUE_DEGREES}, the less the less green it is. Applied after
 * `oylTinted`. At `autumn` 0 the turn is nothing and the colour is returned
 * as it came. `realistic-renderer.test.ts` §"#1623" evaluates it from the
 * program three is handed (`glsl-testing.ts`).
 */
const AUTUMN_GLSL = /* glsl */ `
  vec3 oylAutumnOf(vec3 colour, float autumn) {
    float leafy = smoothstep(${glslFloat(AUTUMN_LEAFY_SHARE[0])}, ${glslFloat(AUTUMN_LEAFY_SHARE[1])}, (colour.g - max(colour.r, colour.b)) / max(colour.g, 0.0001));
    float turn = -autumn * leafy * ${((AUTUMN_HUE_DEGREES * Math.PI) / 180).toFixed(8)};
    float turnCos = cos(turn);
    float turnSin = sin(turn);
    vec3 grey = vec3(0.57735027);
    vec3 turned = colour * turnCos + cross(grey, colour) * turnSin
      + grey * dot(grey, colour) * (1.0 - turnCos);
    return max(turned, vec3(0.0));
  }
`;

/** The materials {@link withAutumn} has taught. */
const AUTUMN_TAUGHT = new WeakSet<Material>();

/**
 * Whether a material turns in autumn — #1623: a realistic broadleaf's, at
 * every level, and nothing else.
 *
 * @test-facing held by `realistic-renderer.test.ts` §"#1623", which asserts
 * the broadleaves are taught it and the conifers, shrubs and rocks are not
 */
export function turnsInAutumn(material: Material): boolean {
  return AUTUMN_TAUGHT.has(material);
}

/**
 * Teaches a broadleaf's material its autumn — #1623: {@link AUTUMN_GLSL}
 * applied after #621's seeded tint, reading {@link SEASON}'s `oylAutumn`.
 * Spliced at compile, as the tint is: a mesh's material must already have
 * been taught its instance channels ({@link withInstanceChannels}), whose
 * tint line this splices after; an impostor's `ShaderMaterial` is spliced at
 * its own tint line. Throws at compile, as the tint does, if the line it is
 * spliced at is not there. Idempotent.
 */
function withAutumn(material: Material): void {
  if (AUTUMN_TAUGHT.has(material)) return;
  AUTUMN_TAUGHT.add(material);
  const spliced = "#1623's autumn";
  const [line, turned] =
    material instanceof ShaderMaterial
      ? [
          IMPOSTOR_TINT_LINE,
          'gl_FragColor = vec4(oylAutumnOf(oylTinted(texel.rgb, vOylTint), oylAutumn), 1.0);',
        ]
      : [
          MESH_TINT_LINE,
          `${MESH_TINT_LINE}\ndiffuseColor.rgb = oylAutumnOf(diffuseColor.rgb, oylAutumn);`,
        ];
  const earlier = material.onBeforeCompile.bind(material);
  const earlierKey = material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    earlier(shader, renderer);
    shader.uniforms['oylAutumn'] = SEASON.oylAutumn;
    shader.fragmentShader = replacedOrThrown(
      replacedOrThrown(
        shader.fragmentShader,
        '#include <common>',
        `#include <common>\nuniform float oylAutumn;\n${AUTUMN_GLSL}`,
        'fragment',
        spliced,
      ),
      line,
      turned,
      'fragment',
      spliced,
    );
  };
  material.customProgramCacheKey = () => `${earlierKey}|oyl-autumn`;
}

/** The line a realistic mesh's fragment applies #621's tint at. @see withInstanceChannels */
const MESH_TINT_LINE = 'diffuseColor.rgb = oylTinted(diffuseColor.rgb, vOylTint);';

/** The line a tree's impostor applies #621's tint at. @see impostorMaterial */
const IMPOSTOR_TINT_LINE = 'gl_FragColor = vec4(oylTinted(texel.rgb, vOylTint), 1.0);';

/**
 * What each material {@link withInstanceChannels} has taught reads: `true`
 * for a tree, which also keeps its half of the hand-over dither.
 */
const INSTANCE_TAUGHT = new WeakMap<Material, boolean>();

/**
 * Whether a material reads a realistic instance's seeded tint — #621.
 *
 * @test-facing held by `realistic-renderer.test.ts` §"#621", which asserts
 * every realistic vegetation and structure material is taught it and no
 * stylised one is
 */
export function readsInstanceTint(material: Material): boolean {
  return INSTANCE_TAUGHT.has(material);
}

/**
 * Teaches a realistic material what its instance colour carries — #617, #621.
 *
 * The instance COLOUR is never a colour here: three's own tint by it is taken
 * out of `color_vertex`, and its channels are handed on instead. The third
 * (`.z`) is the item's seeded tint (`instance-tint.ts`), applied to the
 * surface's colour after its map and its vertex colour and before its light.
 * For a tree (`dither`), the first two are its hand-over keep interval
 * (`tree-levels.ts` §`writeInterval`), and a fragment outside it is discarded.
 *
 * The attribute is the mesh's own rather than its geometry's, so the full and
 * the middle meshes of one part share a material and a geometry's buffers
 * while each carries its own keeps and tints, and nothing is allocated per
 * view.
 *
 * ⚠️ **Throws if three's chunk no longer holds the tint line**, rather than
 * compiling a tree tinted by its keep interval — a three bump that reworded the
 * chunk is a red test, not a tree drawn in a false colour. Likewise, at
 * compile, if the program no longer holds any of the four includes the tint is
 * spliced in at ({@link replacedOrThrown}). And throws if a
 * material is taught twice with and without the dither, which would be one
 * shape drawn by two belts that disagree about it.
 *
 * Idempotent: a material several views share is taught once.
 */
function withInstanceChannels<M extends Material>(material: M, dither: boolean): M {
  const taught = INSTANCE_TAUGHT.get(material);
  if (taught !== undefined) {
    if (taught !== dither) throw new Error('a material taught its instance channels two ways');
    return material;
  }
  INSTANCE_TAUGHT.set(material, dither);
  if (!ShaderChunk.color_vertex.includes(INSTANCE_TINT)) {
    throw new Error('three’s color_vertex no longer tints by instanceColor as the tint expects');
  }
  const earlier = material.onBeforeCompile.bind(material);
  const earlierKey = material.customProgramCacheKey();
  const keep = dither ? 'varying vec2 vOylKeep;\n' : '';
  material.onBeforeCompile = (shader, renderer) => {
    earlier(shader, renderer);
    let vertex = replacedOrThrown(
      shader.vertexShader,
      '#include <common>',
      `#include <common>\n${keep}varying vec3 vOylTint;\n${TINT_DECODE_GLSL}`,
      'vertex',
    );
    vertex = replacedOrThrown(
      vertex,
      '#include <color_vertex>',
      `${dither ? 'vOylKeep = vec2(0.0);\n' : ''}vOylTint = vec3(0.0);\n${ShaderChunk.color_vertex.replace(
        INSTANCE_TINT,
        `${dither ? 'vOylKeep = instanceColor.xy;\n' : ''}vOylTint = oylTintOf(instanceColor.z);`,
      )}`,
      'vertex',
    );
    shader.vertexShader = vertex;
    let fragment = replacedOrThrown(
      shader.fragmentShader,
      '#include <common>',
      `#include <common>\n${keep}varying vec3 vOylTint;\n${TINT_APPLY_GLSL}`,
      'fragment',
    );
    fragment = replacedOrThrown(
      fragment,
      '#include <color_fragment>',
      `#include <color_fragment>\n${MESH_TINT_LINE}`,
      'fragment',
    );
    shader.fragmentShader = fragment;
    if (dither) {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>\n${TREE_DITHER_DISCARD}`,
      );
    }
  };
  material.customProgramCacheKey = () =>
    `${earlierKey}|${dither ? 'oyl-tree-dither' : 'oyl-instance-tint'}`;
  return material;
}

/**
 * `source` with `include` replaced — or a throw naming #621, where three's
 * program no longer holds that include. A `replace` that finds nothing returns
 * its input unchanged, so without this a three bump that moved `<common>` or
 * `<color_fragment>` would compile a program that declares the tint and never
 * applies it — or applies a function it never declared — and the first sign
 * would be a colour, not an error. @see withInstanceChannels
 */
function replacedOrThrown(
  source: string,
  include: string,
  replacement: string,
  stage: 'vertex' | 'fragment',
  spliced = "#621's seeded tint",
): string {
  if (!source.includes(include)) {
    throw new Error(
      `three's ${stage} shader no longer holds ${include}, where ${spliced} is spliced in`,
    );
  }
  return source.replace(include, replacement);
}

/** A tree's material: its seeded tint and its hand-over dither. @see withInstanceChannels */
function withTreeDither(material: MeshStandardMaterial): void {
  withInstanceChannels(material, true);
}

/**
 * How a fir's meshes are drawn — #1523:
 *
 * - `drawn`, the product's: each fir mesh at its full and middle level is
 *   drawn twice. First its depth pre-pass ({@link withDepthPrepass}) lays the
 *   depth of every fragment that survives the cut, writing no colour; then the
 *   mesh itself is drawn with an EQUAL depth test, so the whole lit shader runs
 *   only on the fragment each pixel keeps.
 * - `off`: the mesh alone, as before #1523 — the owner's page's
 *   `levers=-fir-prepass`, and the browser gate's reference picture.
 * - `unprepared`: the EQUAL test with no pre-pass, which draws no fir at all.
 *   The browser gate's control that the full pass really is tested against
 *   the pre-pass's depth; nothing else sets it.
 */
export type DepthPrepassMode = 'drawn' | 'off' | 'unprepared';

/**
 * Where a depth pre-pass stops — #1523: three's own alpha test, as the mesh
 * runs it further down, as soon as the colour's alpha is known (its map, its
 * layer's cut and its vertex colour), and before the seeded tint, which moves
 * only the colour. The test is three's chunk itself, expanded here a second
 * time, so the two passes cut by the same arithmetic.
 */
const DEPTH_ONLY_GLSL = `if ( oylDepthOnly ) {
#include <alphatest_fragment>
  gl_FragColor = vec4( 0.0 );
  return;
}`;

/** Every material {@link withDepthPrepass} has taught. */
const DEPTH_PREPASS_TAUGHT = new WeakSet<Material>();

/**
 * Teaches a tree's material its depth pre-pass — #1523.
 *
 * ## Why
 *
 * A generated fir is about 1 100 sprig cards with under a quarter of each
 * covered by needles (`realistic-budget.ts` §"The generated firs, measured").
 * A card fragment is shaded whenever it passes the depth test, and it passes
 * whenever nothing nearer has been drawn there YET: every transparent part of
 * every card in front of the needle a pixel finally shows, and every card
 * behind it drawn before it. Rasterised on the CPU from the committed
 * `generated_fir_a.glb` and its own decoded sprig, the full level seen from
 * 9 m on three sides passes the depth test in 198 404 2×2 quads to show
 * 58 582 pixels — about eight fragments shaded for each one kept. Laid first
 * by a pass that only cuts, the depth lets the lit pass through in 39 353
 * quads, a fifth. A `LessEqual` test after the pre-pass would still pass 146
 * 265, because the cut-away fragments IN FRONT of the kept one pass it too;
 * only EQUAL removes them.
 *
 * ## How: one program, two materials
 *
 * The pre-pass is the SAME program as the mesh's own: this adds a uniform,
 * `oylDepthOnly`, and when it is set the program cuts and returns as soon as
 * the alpha is known ({@link DEPTH_ONLY_GLSL}), so the pre-pass runs the
 * dither, the layer's colour read and the cut and nothing past them. Its material is a twin of this one
 * ({@link depthPrepassMaterial}) with the same cache key, so three links one
 * program for both. That is what lets the EQUAL test hold: the two passes
 * compute `gl_Position` with the same compiled code from the same inputs, so
 * every kept fragment lands on exactly the depth its pre-pass wrote, and the
 * same alpha decides the cut in both.
 *
 * ⚠️ Throws, at compile, where three's program no longer holds the include it
 * is spliced at, for {@link replacedOrThrown}'s reason. Idempotent.
 */
function withDepthPrepass(material: MeshStandardMaterial): void {
  if (DEPTH_PREPASS_TAUGHT.has(material)) return;
  DEPTH_PREPASS_TAUGHT.add(material);
  const earlier = material.onBeforeCompile.bind(material);
  const earlierKey = material.customProgramCacheKey();
  const spliced = "#1523's depth pre-pass";
  material.onBeforeCompile = (shader, renderer) => {
    earlier(shader, renderer);
    shader.uniforms['oylDepthOnly'] = { value: false };
    shader.fragmentShader = replacedOrThrown(
      replacedOrThrown(
        shader.fragmentShader,
        '#include <common>',
        '#include <common>\nuniform bool oylDepthOnly;',
        'fragment',
        spliced,
      ),
      '#include <color_fragment>',
      `#include <color_fragment>\n${DEPTH_ONLY_GLSL}`,
      'fragment',
      spliced,
    );
  };
  material.customProgramCacheKey = () => `${earlierKey}|oyl-depth-prepass`;
}

/**
 * The material a mesh's depth pre-pass wears — #1523: a copy of the mesh's
 * own, writing no colour, whose program is the mesh's own program with
 * `oylDepthOnly` set. Its compile step and its cache key are the original's,
 * read when three asks, so anything taught to the original later through
 * those two is taught to this too. Its material properties (map, alphaTest,
 * side, opacity) are a snapshot from `clone()`: change one on the original
 * after this and the two passes cut differently, and EQUAL drops needles.
 * @see withDepthPrepass
 */
function depthPrepassMaterial(material: MeshStandardMaterial): MeshStandardMaterial {
  const twin = constructed(material.clone());
  twin.name = `${material.name} depth pre-pass`;
  twin.colorWrite = false;
  twin.onBeforeCompile = (shader, renderer) => {
    material.onBeforeCompile(shader, renderer);
    shader.uniforms['oylDepthOnly'] = { value: true };
  };
  twin.customProgramCacheKey = () => material.customProgramCacheKey();
  // The same program, so taught what the original was: the instance's tint
  // and keeps (#621, #617), #619's texture bias and #622's air — which the
  // browser gate's census of the realistic materials reads.
  INSTANCE_TAUGHT.set(twin, true);
  TEXTURE_BIASED.add(twin);
  ATMOSPHERIC.add(twin);
  DEPTH_PREPASS_TAUGHT.add(twin);
  return twin;
}

/**
 * How far ahead of its mesh in three's draw order a depth pre-pass is drawn:
 * half a place, so it is drawn before the mesh it lays depth for and after
 * everything drawn before that mesh — #1523. @see FOLIAGE_RENDER_ORDER
 */
const DEPTH_PREPASS_LEAD = 0.5;

/** One fir mesh and the pre-pass that lays its depth — #1523. */
interface DepthPrepass {
  readonly full: InstancedMesh;
  readonly prepass: InstancedMesh;
}

/**
 * A depth pre-pass for an instanced tree mesh — #1523. A child of the mesh,
 * so it is drawn only when the mesh is (three skips a hidden object's
 * children), with the mesh's own instance matrices and channels, and its
 * count copied from the mesh's at the moment it is drawn. The mesh is drawn
 * with an EQUAL depth test while `mode` says so, and its material is put back
 * to the test it had as soon as it has been drawn, so nothing else that wears
 * the material is ever drawn with it.
 */
function depthPrepassOf(
  full: InstancedMesh,
  twin: MeshStandardMaterial,
  mode: () => DepthPrepassMode,
): DepthPrepass {
  const prepass = new InstancedMesh(full.geometry, twin, 0);
  prepass.instanceMatrix = full.instanceMatrix;
  prepass.instanceColor = full.instanceColor;
  // Shared buffers: disposing a pre-pass alone would delete the live mesh's
  // GL buffers (three's InstancedMesh dispose). Dispose them only with `full`.
  prepass.frustumCulled = false;
  prepass.renderOrder = full.renderOrder - DEPTH_PREPASS_LEAD;
  prepass.onBeforeRender = () => {
    prepass.count = full.count;
  };
  full.add(prepass);
  const own = full.material as Material;
  let restore: { readonly func: DepthModes; readonly write: boolean } | undefined;
  full.onBeforeRender = () => {
    if (mode() === 'off') return;
    restore = { func: own.depthFunc, write: own.depthWrite };
    own.depthFunc = EqualDepth;
    // Redundant under EQUAL, and a depth write beside `discard` makes some
    // mobile GPUs test depth late, so the lit shader would run on every fragment.
    own.depthWrite = false;
  };
  full.onAfterRender = () => {
    if (restore === undefined) return;
    own.depthFunc = restore.func;
    own.depthWrite = restore.write;
    restore = undefined;
  };
  return { full, prepass };
}

/** A unit quad standing on its bottom edge: x in [−0.5, 0.5], y in [0, 1]. */
/**
 * The uniforms every realistic plant's breeze and every impostor's light read
 * — #630 — written once a frame by the view that draws, for `ATMOSPHERE`'s
 * reason: several views share the loaded world's materials.
 */
const FOLIAGE = {
  oylWindTime: { value: 0 },
  oylWindDirection: { value: new Vector2(...foliageWindDirection()) },
  oylSunToward: { value: new Vector3(0, 1, 0) },
  oylSunAmbient: { value: 0.5 },
  oylSunDirect: { value: 0.5 },
  /** 1 in the product; 0 is the browser gate's control, today's unlit strip. @see impostorsLitOf */
  oylImpostorLit: { value: 1 },
  /** 1 in the product; 0 holds every plant still. @see foliageStillOf */
  oylSwayScale: { value: 1 },
};

/** Which layers of a merged tree material are leaves — #630. @see mergeShapeMaterials */
const FOLIAGE_LAYERS = new WeakMap<Material, readonly boolean[]>();

/** Materials already taught the breeze. */
const SWAYING = new WeakSet<Material>();

/**
 * The breeze, in GLSL: the three waves of `foliage-light.ts`
 * §`FOLIAGE_WAVES`, and a tree's phase hashed from where it stands.
 */
const FOLIAGE_SWAY_COMMON = /* glsl */ `
uniform float oylWindTime;
uniform vec2 oylWindDirection;
uniform float oylSwayScale;
float oylSwayWave(float phase) {
  return oylSwayScale * (${FOLIAGE_WAVES.map(
    ([rate, weight, phases]) =>
      `${glslFloat(weight)} * sin(oylWindTime * ${glslFloat(rate)} + phase * ${glslFloat(phases)})`,
  ).join(' + ')});
}
float oylSwayPhase(vec2 place) {
  return fract(sin(dot(floor(place * 10.0), vec2(12.9898, 78.233))) * 43758.5453) * 6.2831853;
}
`;

/**
 * Teaches every material a realistic plant wears the breeze — #630: a push
 * along `foliage-light.ts` §`foliageWindDirection`, of
 * `FOLIAGE_SWAY_METRES` at the top of the plant, falling off as the square of
 * the height, and a {@link WOOD_SWAY_SHARE} of that for a layer that is not
 * leaves. In the vertex shader before three instances the vertex, turned into
 * the instance's own frame, so a tree of any turn and size is pushed the same
 * way by the same metres. Idempotent.
 */
function withFoliageSwayOf(shape: RealisticShape): void {
  const materials = new Set<Material>(
    [...shape.parts, ...(shape.middle?.parts ?? [])].map((part) => part.material),
  );
  const height = shape.extent;
  for (const material of materials) {
    if (SWAYING.has(material)) continue;
    SWAYING.add(material);
    const layers = FOLIAGE_LAYERS.get(material) ?? [material.alphaTest > 0];
    const weights = layers.map((leaves) => (leaves ? 1 : WOOD_SWAY_SHARE));
    const weight =
      layers.length > 1
        ? `oylSwayLayer[int(oylLayer + 0.5)]`
        : glslFloat(weights[0] ?? WOOD_SWAY_SHARE);
    const earlier = material.onBeforeCompile.bind(material);
    const earlierKey = material.customProgramCacheKey();
    material.onBeforeCompile = (shader, renderer) => {
      earlier(shader, renderer);
      shader.uniforms['oylWindTime'] = FOLIAGE.oylWindTime;
      shader.uniforms['oylWindDirection'] = FOLIAGE.oylWindDirection;
      shader.uniforms['oylSwayScale'] = FOLIAGE.oylSwayScale;
      if (layers.length > 1) shader.uniforms['oylSwayLayer'] = { value: weights };
      shader.vertexShader = replacedOrThrown(
        replacedOrThrown(
          shader.vertexShader,
          '#include <common>',
          `#include <common>\n${FOLIAGE_SWAY_COMMON}${
            layers.length > 1 ? `uniform float oylSwayLayer[${String(layers.length)}];\n` : ''
          }`,
          'vertex',
          "#630's breeze",
        ),
        '#include <begin_vertex>',
        `#include <begin_vertex>
#ifdef USE_INSTANCING
{
  vec3 oylCentre = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  float oylRise = clamp(position.y / ${glslFloat(height)}, 0.0, 1.0);
  vec2 oylPush = oylWindDirection
    * (${glslFloat(FOLIAGE_SWAY_METRES)} * oylSwayWave(oylSwayPhase(oylCentre.xz)) * oylRise * oylRise * ${weight});
  mat3 oylBasis = mat3(instanceMatrix);
  transformed += transpose(oylBasis) * vec3(oylPush.x, 0.0, oylPush.y) / dot(oylBasis[0], oylBasis[0]);
}
#endif`,
        'vertex',
        "#630's breeze",
      );
    };
    material.customProgramCacheKey = () => `${earlierKey}|oyl-breeze-${String(layers.length)}`;
    material.needsUpdate = true;
  }
}

/**
 * The glyph range the gantries' banners are lettered from — #679: the map's
 * own, `0-255`, which holds every character `gantry-wording.ts` uses (Latin
 * capitals, digits, `k`, `m`, `i` and a space). Served from `public/glyphs/`,
 * precached with the app, and fetched here once a load.
 */
const BANNER_GLYPHS_URL = `${import.meta.env.BASE_URL}glyphs/${LABEL_FONT}/0-255.pbf`;

/**
 * The banners' atlas as a texture — #679. One byte of coverage a texel, red
 * only, uploaded as it is (row 0 the bottom, which is `v = 0`), mipmapped
 * because a banner is seen from 375 m (`gantry.ts`
 * §`LINE_DRAW_AHEAD_METRES`). 512 × 1024 bytes: 0.67 MiB with its mips,
 * under #679's 1 MiB. @see banner-atlas.ts
 */
function bannerTextureOf(
  glyphRange: Uint8Array,
  cells: readonly BannerCell[],
): {
  readonly atlas: BannerAtlas;
  readonly texture: DataTexture;
} {
  const atlas = bannerAtlas(readGlyphRange(glyphRange), cells);
  const texture = new DataTexture(
    atlas.coverage,
    atlas.width,
    atlas.height,
    RedFormat,
    UnsignedByteType,
  );
  texture.generateMipmaps = true;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.unpackAlignment = 1;
  texture.needsUpdate = true;
  return { atlas, texture };
}

/**
 * The banners, or none — #679, and #879's review. The banners are decoration:
 * a range that is absent, malformed, or lacks a glyph a word needs costs a
 * gantry its lettering (`GantryBelt` draws no banner without an atlas) and
 * never the realistic world a rider chose, which is what a throw here used to
 * cost. Nothing is logged: the product logs nothing, and the gantry itself is
 * the visible sign. `banner-atlas.test.ts` builds the atlas through it, and
 * holds a malformed range and an undrawable word to no banners.
 */
export function bannersOf(
  glyphRange: Uint8Array | undefined,
  cells: readonly BannerCell[] = bannerCells(),
): { readonly atlas: BannerAtlas; readonly texture: DataTexture } | undefined {
  if (glyphRange === undefined) return undefined;
  try {
    return bannerTextureOf(glyphRange, cells);
  } catch {
    return undefined;
  }
}

/** The gantries' colours: galvanised steel, a white barrier, and the banner. This repository's own. */
const GANTRY_METAL = 0x8c9299;
const GANTRY_BARRIER = 0xe4e6e3;
const BANNER_GROUND = 0x1f3b5c;
const BANNER_LETTERING = 0xf4f4f0;

/** The most boxes and banners the belt draws: two gantries and a board, with room. */
const GANTRY_BOX_CAPACITY = 96;
const GANTRY_BANNER_CAPACITY = 4;

/**
 * The start and finish gantries, their barriers and the boards before them —
 * #679. ⚠️ **In both worlds since #966**, and a reviewer who remembers
 * "realistic rungs only: the stylised world has none" is reading the old file:
 * the gates carry the wordmark in both (the owner's ruling; the finish's too
 * since #978), so the
 * stylised view builds a belt of its own — with no banners, because the
 * lettering is a texture and the stylised world's one allowed texture is the
 * wordmark (`game.browser.spec.ts` §"uploads only the logo texture") — and
 * {@link RealisticDrawing} keeps the lettered one (ADR 0026 D-3: no rung
 * mixes the two).
 *
 * **Two draw calls, and none away from a line**: every box — legs, beam,
 * barrier pieces, board posts — is one instance of one unit box, and every
 * banner one instance of one quad whose instance attribute says which cell of
 * the atlas it wears. A frame whose `lines` are empty hides both meshes.
 *
 * ⚠️ **The banner faces the rider and reads left to right**: its quad's `x`
 * is the road's normal — the rider's RIGHT, `(−headingZ, headingX)`, since
 * #583 the map's right as well as the screen's — its `y` up and its `z`
 * AGAINST the heading, toward a rider riding at it: a proper rotation, so the
 * quad's front face is toward the rider and `u` runs to their right.
 * `gantry.test.ts` holds that from the camera.
 */
export class GantryBelt {
  readonly #boxes: InstancedMesh;
  /**
   * The boxes' lit and unlit materials — #966's review, for {@link LogoBelt}'s
   * reason. One material in the realistic world, which has no flat rung.
   */
  readonly #boxMaterials: { readonly lit: Material; readonly flat: Material };
  readonly #banners: InstancedMesh;
  readonly #cells: InstancedBufferAttribute;
  readonly #atlas: BannerAtlas | undefined;
  readonly #matrix = new Matrix4();
  readonly #colour = new Color();
  #shown = true;
  /** Whether the browser gate has turned the gantries off — its control. */
  #switchedOn = true;

  constructor(
    banners?: { readonly atlas: BannerAtlas; readonly texture: DataTexture },
    world: 'stylised' | 'realistic' = 'realistic',
  ) {
    this.#atlas = banners?.atlas;
    // #966: the stylised world's gantry breathes three's own fog, not the
    // realistic air, whose uniforms only a realistic frame writes; and is
    // Lambert, for `logoMaterial`'s reason — no DFG texture.
    const boxMaterial =
      world === 'realistic'
        ? withAtmosphere(
            constructed(
              new MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, metalness: 0.2 }),
            ),
          )
        : constructed(new MeshLambertMaterial({ color: 0xffffff }));
    this.#boxMaterials = {
      lit: boxMaterial,
      flat:
        world === 'stylised'
          ? constructed(new MeshBasicMaterial({ color: 0xffffff }))
          : boxMaterial,
    };
    this.#boxes = new InstancedMesh(new BoxGeometry(1, 1, 1), boxMaterial, GANTRY_BOX_CAPACITY);
    this.#boxes.instanceMatrix.setUsage(DynamicDrawUsage);
    this.#boxes.count = 0;
    this.#boxes.frustumCulled = false;
    this.#boxes.visible = false;
    const quad = new PlaneGeometry(1, 1);
    this.#cells = new InstancedBufferAttribute(new Float32Array(GANTRY_BANNER_CAPACITY), 1);
    this.#cells.setUsage(DynamicDrawUsage);
    quad.setAttribute('oylCell', this.#cells);
    this.#banners = new InstancedMesh(
      quad,
      bannerMaterial(banners?.texture),
      GANTRY_BANNER_CAPACITY,
    );
    this.#banners.instanceMatrix.setUsage(DynamicDrawUsage);
    this.#banners.count = 0;
    this.#banners.frustumCulled = false;
    this.#banners.visible = false;
  }

  addTo(scene: Scene): void {
    scene.add(this.#boxes);
    scene.add(this.#banners);
  }

  /** The two meshes. For `three-renderer.test.ts` and the browser gate's counts. */
  get meshes(): { readonly boxes: InstancedMesh; readonly banners: InstancedMesh } {
    return { boxes: this.#boxes, banners: this.#banners };
  }

  setShown(on: boolean): void {
    this.#shown = on;
    if (!on) {
      this.#boxes.visible = false;
      this.#banners.visible = false;
    }
  }

  /** @see gantriesShownOf */
  switchOn(on: boolean): void {
    this.#switchedOn = on;
  }

  /**
   * Shades the gantries' boxes, or stops shading them — #286. The banners are
   * the realistic world's alone (the stylised belt has no atlas and draws
   * none), so they keep their one material. @see QualitySettings.shading
   */
  setShading(shading: QualitySettings['shading']): void {
    this.#boxes.material = this.#boxMaterials[shading];
  }

  /** This frame's stands: their boxes and their banners, and nothing where there are none. */
  update(lines: readonly PlacedStand[]): void {
    let boxes = 0;
    let banners = 0;
    if (this.#shown && this.#switchedOn) {
      for (const line of lines) {
        // #966's review: a "to go" board is its lettering on a post. With no
        // atlas (the stylised world, which uploads one texture, the wordmark)
        // there is no lettering, and a bare post before the finish says
        // nothing — so the board is not drawn at all. A gantry is still a
        // gantry unlettered.
        if (this.#atlas === undefined && line.stand.kind === 'board') continue;
        for (const placed of line.boxes) {
          const box = placed.box;
          if (boxes >= GANTRY_BOX_CAPACITY) break;
          this.#placeBox(boxes, placed);
          this.#colour.setHex(box.role === 'barrier' ? GANTRY_BARRIER : GANTRY_METAL);
          this.#boxes.setColorAt(boxes, this.#colour);
          boxes += 1;
        }
        const cell = this.#atlas?.cells.get(line.stand.text);
        if (cell === undefined || banners >= GANTRY_BANNER_CAPACITY) continue;
        const place = bannerPlace(line.stand.kind);
        const at = standPoint(line, place.across, place.up, place.along);
        this.#matrix.set(
          -line.headingZ * place.width,
          0,
          -line.headingX,
          at.x,
          0,
          place.height,
          0,
          at.y,
          line.headingX * place.width,
          0,
          -line.headingZ,
          at.z,
          0,
          0,
          0,
          1,
        );
        this.#banners.setMatrixAt(banners, this.#matrix);
        this.#cells.setX(banners, cell);
        banners += 1;
      }
    }
    this.#boxes.count = boxes;
    this.#banners.count = banners;
    this.#boxes.instanceMatrix.needsUpdate = boxes > 0;
    if (this.#boxes.instanceColor !== null) this.#boxes.instanceColor.needsUpdate = boxes > 0;
    this.#banners.instanceMatrix.needsUpdate = banners > 0;
    this.#cells.needsUpdate = banners > 0;
    this.#boxes.visible = boxes > 0;
    this.#banners.visible = banners > 0;
  }

  /** One box: its axes are the road's at its own distance, scaled by its size. */
  #placeBox(slot: number, line: PlacedBox): void {
    const box = line.box;
    const at = boxPoint(line, box.across, box.up);
    // The same right-handed frame as the banner's — right, up, toward the
    // rider — so no box is drawn inside out.
    this.#matrix.set(
      -line.headingZ * box.width,
      0,
      -line.headingX * box.depth,
      at.x,
      0,
      box.height,
      0,
      at.y,
      line.headingX * box.width,
      0,
      -line.headingZ * box.depth,
      at.z,
      0,
      0,
      0,
      1,
    );
    this.#boxes.setMatrixAt(slot, this.#matrix);
  }

  dispose(): void {
    this.#boxes.geometry.dispose();
    this.#boxMaterials.lit.dispose();
    if (this.#boxMaterials.flat !== this.#boxMaterials.lit) this.#boxMaterials.flat.dispose();
    this.#boxes.dispose();
    this.#banners.geometry.dispose();
    (this.#banners.material as Material).dispose();
    this.#banners.dispose();
  }
}

/**
 * The banner's material — #679: lit like the world round it, its colour the
 * banner's ground where the atlas has no lettering and the lettering's where
 * it has, from the cell the instance names. Constructed here (D-11).
 */
function bannerMaterial(atlas: Texture | undefined): MeshStandardMaterial {
  const material = constructed(
    new MeshStandardMaterial({
      color: 0xffffff,
      map: atlas ?? null,
      roughness: 0.8,
      metalness: 0,
    }),
  );
  const cells = String(BANNER_CELLS);
  material.onBeforeCompile = (shader) => {
    shader.uniforms['bannerGround'] = { value: new Color(BANNER_GROUND) };
    shader.uniforms['bannerLettering'] = { value: new Color(BANNER_LETTERING) };
    shader.vertexShader = replacedOrThrown(
      replacedOrThrown(
        shader.vertexShader,
        '#include <common>',
        '#include <common>\nattribute float oylCell;',
        'vertex',
        "#679's banner",
      ),
      '#include <uv_vertex>',
      `#include <uv_vertex>
#ifdef USE_MAP
vMapUv = vec2(uv.x, (oylCell + uv.y) / ${cells}.0);
#endif`,
      'vertex',
      "#679's banner",
    );
    shader.fragmentShader = replacedOrThrown(
      replacedOrThrown(
        shader.fragmentShader,
        '#include <common>',
        '#include <common>\nuniform vec3 bannerGround;\nuniform vec3 bannerLettering;',
        'fragment',
        "#679's banner",
      ),
      '#include <map_fragment>',
      `#ifdef USE_MAP
diffuseColor.rgb = mix(bannerGround, bannerLettering, texture2D(map, vMapUv).r);
#else
diffuseColor.rgb = bannerGround;
#endif`,
      'fragment',
      "#679's banner",
    );
  };
  material.customProgramCacheKey = () => `oyl-banner-${cells}`;
  return withAtmosphere(material);
}

/* ----------------------------------------------------------------------------
 * The wordmark — #966: on the gates and on the billboards, in both worlds
 * ------------------------------------------------------------------------- */

/** The board's colours: its own white, and galvanised posts. This repository's own. */
const LOGO_BOARD_WHITE = 0xf4f4f0;
const LOGO_POST_GREY = 0x8c9299;

/**
 * The most boards one frame draws — `logo-board.ts` §`LOGO_BOARDS_PER_FRAME`,
 * which `scene.ts` holds every frame inside (the gate's boards and at most
 * `BILLBOARDS_PER_FRAME` billboards), so `LogoBelt.update`'s cut never binds.
 */
export const LOGO_BOARD_CAPACITY = LOGO_BOARDS_PER_FRAME;

/** The board and its posts as one geometry: position, normal, uv, colour and the face flag. */
function logoGeometry(): BufferGeometry {
  const white = new Color(LOGO_BOARD_WHITE);
  const grey = new Color(LOGO_POST_GREY);
  const parts = logoBoxes().map((box) => {
    const part = new BoxGeometry(box.width, box.height, box.depth)
      .toNonIndexed()
      .translate(box.x, box.y, box.z);
    const normal = part.getAttribute('normal');
    const colour = box.role === 'board' ? white : grey;
    const colours = new Float32Array(normal.count * 3);
    const face = new Float32Array(normal.count);
    for (let at = 0; at < normal.count; at += 1) {
      colours[at * 3] = colour.r;
      colours[at * 3 + 1] = colour.g;
      colours[at * 3 + 2] = colour.b;
      // The board's front, out of its face: the one face that reads.
      face[at] = box.role === 'board' && normal.getZ(at) > 0.5 ? 1 : 0;
    }
    part.setAttribute('color', new BufferAttribute(colours, 3));
    part.setAttribute('oylFace', new BufferAttribute(face, 1));
    return part;
  });
  const joined = mergeGeometries(parts);
  for (const part of parts) part.dispose();
  if (joined === null) throw new Error('the logo board could not be merged into one geometry');
  return joined;
}

/**
 * The board's material — #966: lit like the world round it, white where the
 * wordmark is clear and the wordmark where it is not, on the front face only,
 * and with every vertex held at or above the instance's `oylFoot` — which is
 * how the gate's board folds its posts away into the beam. Constructed here
 * (D-11); and in the realistic world breathing the realistic air (#622).
 */
function logoMaterial(
  map: Texture | undefined,
  world: 'stylised' | 'realistic',
  shading: QualitySettings['shading'] = 'lit',
): Material {
  // ⚠️ **Lambert in the stylised world, and that is the allowlist's doing**: a
  // physically based material makes three upload its own DFG look-up texture
  // the first time one is drawn (`lights_physical_pars_fragment`), which the
  // browser gate's allowlist of one would rightly count. The stylised scenery
  // is Lambert already.
  const material = constructed(
    world === 'realistic'
      ? new MeshStandardMaterial({
          color: 0xffffff,
          vertexColors: true,
          map: map ?? null,
          roughness: 0.7,
          metalness: 0,
        })
      : shading === 'flat'
        ? // The floor rung's unlit twin (#286), as every other stylised belt has.
          new MeshBasicMaterial({ color: 0xffffff, vertexColors: true, map: map ?? null })
        : new MeshLambertMaterial({ color: 0xffffff, vertexColors: true, map: map ?? null }),
  );
  const spliced = "#966's wordmark";
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = replacedOrThrown(
      replacedOrThrown(
        shader.vertexShader,
        '#include <common>',
        '#include <common>\nattribute float oylFace;\nattribute float oylFoot;\nvarying float vOylFace;',
        'vertex',
        spliced,
      ),
      '#include <begin_vertex>',
      '#include <begin_vertex>\ntransformed.y = max(transformed.y, oylFoot);\nvOylFace = oylFace;',
      'vertex',
      spliced,
    );
    shader.fragmentShader = replacedOrThrown(
      replacedOrThrown(
        shader.fragmentShader,
        '#include <common>',
        '#include <common>\nvarying float vOylFace;',
        'fragment',
        spliced,
      ),
      '#include <map_fragment>',
      `#ifdef USE_MAP
vec4 oylMark = texture2D(map, vMapUv);
diffuseColor.rgb = mix(diffuseColor.rgb, oylMark.rgb, oylMark.a * vOylFace);
#endif`,
      'fragment',
      spliced,
    );
  };
  material.customProgramCacheKey = () => `oyl-logo-${world}-${shading}`;
  return world === 'realistic' ? withAtmosphere(material) : material;
}

/**
 * The wordmark's boards — #966: the one on each gate's beam — the start's and,
 * since #978, the finish's — and the billboards beside the road. **One draw
 * call** however many there are, one
 * texture, and none at all where a frame holds neither: one instanced mesh of
 * `logo-board.ts`' shape, hidden when its count is nought.
 *
 * A belt per world: the stylised view's wears the precached PNG
 * ({@link loadGameWordmark}), the realistic world's the KTX2 it loaded with
 * the rest of that world (ADR 0026 D-7, D-8). Without its texture a board is
 * drawn plain white, never not at all.
 */
export class LogoBelt {
  readonly #mesh: InstancedMesh;
  /**
   * Lit and unlit — #966's review: the stylised world's floor rung takes the
   * shading off every belt (#286), and a lit board in an unlit world is both
   * the odd one out and a shading pass on the rung meant to save it. The
   * realistic world has no flat rung, so its two are one material.
   */
  readonly #materials: { readonly lit: Material; readonly flat: Material };
  readonly #feet: InstancedBufferAttribute;
  readonly #matrix = new Matrix4();
  #shown = true;
  /** Whether the browser gate has turned the boards off — its control. */
  #switchedOn = true;

  constructor(map: Texture | undefined, world: 'stylised' | 'realistic') {
    const geometry = logoGeometry();
    this.#feet = new InstancedBufferAttribute(new Float32Array(LOGO_BOARD_CAPACITY), 1);
    this.#feet.setUsage(DynamicDrawUsage);
    geometry.setAttribute('oylFoot', this.#feet);
    const lit = logoMaterial(map, world, 'lit');
    this.#materials = {
      lit,
      flat: world === 'stylised' ? logoMaterial(map, world, 'flat') : lit,
    };
    this.#mesh = new InstancedMesh(geometry, lit, LOGO_BOARD_CAPACITY);
    this.#mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.#mesh.count = 0;
    this.#mesh.frustumCulled = false;
    this.#mesh.visible = false;
  }

  addTo(scene: Scene): void {
    scene.add(this.#mesh);
  }

  /** The mesh. For the browser gate's counts and the jsdom suite. */
  get mesh(): InstancedMesh {
    return this.#mesh;
  }

  setShown(on: boolean): void {
    this.#shown = on;
    if (!on) this.#mesh.visible = false;
  }

  /** @see logosShownOf */
  switchOn(on: boolean): void {
    this.#switchedOn = on;
  }

  /** Shades the boards, or stops shading them — #286. @see QualitySettings.shading */
  setShading(shading: QualitySettings['shading']): void {
    this.#mesh.material = this.#materials[shading];
  }

  /**
   * Turns the wordmark the way the browser gate's control asks — #966's
   * review: mirrored or upside down through the texture's own transform, and
   * upright again. The product never calls it. @see wordmarkOrientationOf
   */
  orientWordmark(orientation: WordmarkOrientation): void {
    const map = (this.#materials.lit as { map?: Texture | null }).map;
    if (map === null || map === undefined) return;
    map.repeat.set(orientation === 'mirrored' ? -1 : 1, orientation === 'upside-down' ? -1 : 1);
    map.offset.set(orientation === 'mirrored' ? 1 : 0, orientation === 'upside-down' ? 1 : 0);
    map.updateMatrix();
  }

  /**
   * This frame's boards: every gate's in reach — the start's and, since #978,
   * the finish's — and the billboards in view.
   */
  update(lines: readonly PlacedStand[], billboards: readonly Billboard[]): void {
    let count = 0;
    const place = (at: LogoPlace): void => {
      if (count >= LOGO_BOARD_CAPACITY) return;
      // Its axes: across, up, out of its face — a proper rotation, so the
      // front face is the one `logo-board.ts` puts the wordmark on.
      this.#matrix.set(
        at.acrossX,
        0,
        at.faceX,
        at.x,
        0,
        1,
        0,
        at.y,
        at.acrossZ,
        0,
        at.faceZ,
        at.z,
        0,
        0,
        0,
        1,
      );
      this.#mesh.setMatrixAt(count, this.#matrix);
      this.#feet.setX(count, at.foot);
      count += 1;
    };
    if (this.#shown && this.#switchedOn) {
      for (const line of lines) {
        if (carriesTheLogo(line)) place(gateLogoPlace(line));
      }
      for (const board of billboards) place(billboardLogoPlace(board));
    }
    this.#mesh.count = count;
    this.#mesh.instanceMatrix.needsUpdate = count > 0;
    this.#feet.needsUpdate = count > 0;
    this.#mesh.visible = count > 0;
  }

  dispose(): void {
    this.#mesh.geometry.dispose();
    this.#materials.lit.dispose();
    if (this.#materials.flat !== this.#materials.lit) this.#materials.flat.dispose();
    this.#mesh.dispose();
  }
}

/**
 * Every village street in view, kerbs and pavements — #1535 (`streets.ts`) —
 * and since #1564 the path from the pavement to each front door.
 * **One mesh and one draw call** however many villages are in view, and none
 * where a frame holds no street: the paths are merged into the pavements'
 * geometry, in their material, and add no call. Each path is one geometry
 * GROUP over its own triangles — a single-material mesh draws its whole index
 * in one call whatever its groups — so the browser gate can read every path
 * back off the drawn mesh ({@link doorPathsDrawnOf}).
 *
 * ⚠️ **Rebuilt only when the SET of streets changes**, which is when a village
 * comes into view or leaves it: `streets.ts` hands every frame the same
 * objects for the same villages, so a frame whose streets are the last
 * frame's, in the same order, uploads nothing. A street is fixed in the
 * corridor's frame, so nothing moves in between.
 *
 * A belt per world, as {@link LogoBelt} is: the stylised view's is
 * {@link PAVEMENT_COLOUR}, lit or flat by the rung (#286); the realistic
 * world's wears ambientCG's paving (`realistic-assets.ts`
 * §`REALISTIC_STRUCTURE_SURFACES`' `paving`), its flags the size the
 * photograph's own repeat says, and breathes the realistic air.
 */
export class PavementBelt {
  readonly #mesh: Mesh;
  readonly #materials: { readonly lit: Material; readonly flat: Material };
  /** How many metres one repeat of the photograph covers; 1 where there is none. */
  readonly #tileMetres: number;
  /** The streets the mesh holds, in the order it holds them. */
  #held: readonly VillageStreet[] = [];
  #shown = true;
  /** Whether the browser gate has turned the pavements off — its control. */
  #switchedOn = true;
  /** Whether the browser gate has turned the front paths off — #1564's control. */
  #pathsOn = true;
  /** Whether the mesh holds the front paths of {@link #held}. */
  #heldPaths = true;

  constructor(
    world: 'stylised' | 'realistic',
    paving?: { readonly colour: Texture; readonly normal: Texture },
  ) {
    if (world === 'realistic') {
      this.#tileMetres = REALISTIC_STRUCTURE_SURFACES.paving.tileMetres;
      const finish = STRUCTURE_SURFACE_FINISH.paving;
      const material = withAtmosphere(
        withTextureLodBias(
          constructed(
            new MeshStandardMaterial({
              color: finish.tint,
              roughness: finish.roughness,
              metalness: finish.metalness,
              ...(paving === undefined ? {} : { map: paving.colour, normalMap: paving.normal }),
            }),
          ),
        ),
      );
      // The realistic world has no flat rung, so its two are one material.
      this.#materials = { lit: material, flat: material };
    } else {
      this.#tileMetres = 1;
      this.#materials = {
        lit: constructed(new MeshLambertMaterial({ color: PAVEMENT_COLOUR })),
        flat: constructed(new MeshBasicMaterial({ color: PAVEMENT_COLOUR })),
      };
    }
    this.#mesh = new Mesh(new BufferGeometry(), this.#materials.lit);
    this.#mesh.visible = false;
  }

  addTo(scene: Scene): void {
    scene.add(this.#mesh);
  }

  /** The mesh. For the browser gate's counts and the jsdom suite. */
  get mesh(): Mesh {
    return this.#mesh;
  }

  setShown(on: boolean): void {
    this.#shown = on;
    if (!on) this.#mesh.visible = false;
  }

  /** @see pavementsShownOf */
  switchOn(on: boolean): void {
    this.#switchedOn = on;
  }

  /** @see doorPathsShownOf */
  switchPathsOn(on: boolean): void {
    this.#pathsOn = on;
  }

  /** Shades the pavements, or stops shading them — #286. @see QualitySettings.shading */
  setShading(shading: QualitySettings['shading']): void {
    this.#mesh.material = this.#materials[shading];
  }

  /** This frame's streets. */
  update(streets: readonly VillageStreet[]): void {
    const drawn = this.#shown && this.#switchedOn ? streets : NO_STREETS;
    if (!sameStreets(drawn, this.#held) || this.#pathsOn !== this.#heldPaths) {
      this.#held = drawn;
      this.#heldPaths = this.#pathsOn;
      const geometry = pavementGeometry(drawn, this.#tileMetres, this.#pathsOn);
      this.#mesh.geometry.dispose();
      this.#mesh.geometry = geometry;
    }
    this.#mesh.visible = this.#shown && drawn.length > 0;
  }

  dispose(): void {
    this.#mesh.geometry.dispose();
    this.#materials.lit.dispose();
    if (this.#materials.flat !== this.#materials.lit) this.#materials.flat.dispose();
  }
}

/** No streets: what a belt that is off holds. */
const NO_STREETS: readonly VillageStreet[] = [];

/** Whether two lists hold the same streets, by identity, in the same order. */
function sameStreets(first: readonly VillageStreet[], second: readonly VillageStreet[]): boolean {
  return first.length === second.length && first.every((street, index) => street === second[index]);
}

/**
 * Every street's pavement as one geometry, its texture coordinates turned from
 * metres into repeats of a photograph `tileMetres` across — and, `withPaths`,
 * every street's front paths after them (#1564), one group each.
 */
function pavementGeometry(
  streets: readonly VillageStreet[],
  tileMetres: number,
  withPaths: boolean,
): BufferGeometry {
  const meshes: PavementMesh[] = [];
  for (const { pavement } of streets) meshes.push(pavement);
  const firstPath = meshes.length;
  if (withPaths)
    for (const { doorPaths } of streets) for (const { mesh } of doorPaths) meshes.push(mesh);
  let vertices = 0;
  let indices = 0;
  for (const mesh of meshes) {
    vertices += mesh.positions.length / 3;
    indices += mesh.indices.length;
  }
  const positions = new Float32Array(vertices * 3);
  const normals = new Float32Array(vertices * 3);
  const uvs = new Float32Array(vertices * 2);
  const index = new Uint32Array(indices);
  const geometry = new BufferGeometry();
  let vertex = 0;
  let at = 0;
  meshes.forEach((mesh, which) => {
    positions.set(mesh.positions, vertex * 3);
    normals.set(mesh.normals, vertex * 3);
    for (let each = 0; each < mesh.uvs.length; each += 1) {
      uvs[vertex * 2 + each] = (mesh.uvs[each] as number) / tileMetres;
    }
    for (let each = 0; each < mesh.indices.length; each += 1) {
      index[at + each] = (mesh.indices[each] as number) + vertex;
    }
    if (which >= firstPath) geometry.addGroup(at, mesh.indices.length);
    vertex += mesh.positions.length / 3;
    at += mesh.indices.length;
  });
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new BufferAttribute(uvs, 2));
  geometry.setIndex(new BufferAttribute(index, 1));
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * Every cross street in view — #1565 (`cross-streets.ts`): the side roads a
 * short way off the route at each junction, and their give-way lines. **One
 * mesh and one draw call** however many are in view, and none where a frame
 * holds none.
 *
 * ⚠️ **It wears the ROAD's material, whatever the road wears** —
 * `ThreeGameView` hands it the road mesh's own every frame: the stylised
 * road's grain, or the photograph and #628's wear. So it adds no texture and
 * no material, and its buffers carry what that material reads: a colour, an
 * up normal, #628's across-position, and #1523's patch reach, which is nought
 * — no wear patch is ever on a side road, so the bounded wear runs no patch
 * loop on one.
 *
 * Rebuilt only when the SET of side roads changes, as {@link PavementBelt}
 * is: `cross-streets.ts` hands every frame the same objects for the same
 * junctions.
 */
export class SideRoadBelt {
  readonly #mesh: Mesh;
  /** The side roads the mesh holds, in the order it holds them. */
  #held: readonly SideRoad[] = [];
  /** Whether the browser gate has turned the side roads off — its control. */
  #switchedOn = true;

  constructor(material: Material) {
    this.#mesh = new Mesh(new BufferGeometry(), material);
    this.#mesh.visible = false;
  }

  addTo(scene: Scene): void {
    scene.add(this.#mesh);
  }

  /** The mesh. For the browser gate's counts and the jsdom suite. */
  get mesh(): Mesh {
    return this.#mesh;
  }

  /** The road's material, this frame. Not this belt's to dispose. */
  setMaterial(material: Material): void {
    this.#mesh.material = material;
  }

  /** @see sideRoadsShownOf */
  switchOn(on: boolean): void {
    this.#switchedOn = on;
  }

  /** This frame's side roads. */
  update(roads: readonly SideRoad[]): void {
    const drawn = this.#switchedOn ? roads : NO_SIDE_ROADS;
    if (!sameSideRoads(drawn, this.#held)) {
      this.#held = drawn;
      const geometry = sideRoadGeometry(drawn);
      this.#mesh.geometry.dispose();
      this.#mesh.geometry = geometry;
    }
    this.#mesh.visible = drawn.length > 0;
  }

  dispose(): void {
    this.#mesh.geometry.dispose();
  }
}

/** No side roads: what a belt that is off holds. */
const NO_SIDE_ROADS: readonly SideRoad[] = [];

function sameSideRoads(first: readonly SideRoad[], second: readonly SideRoad[]): boolean {
  return first.length === second.length && first.every((road, index) => road === second[index]);
}

/** Every side road as one geometry, with the attributes the road's material reads. */
function sideRoadGeometry(roads: readonly SideRoad[]): BufferGeometry {
  let vertices = 0;
  let indices = 0;
  for (const { mesh } of roads) {
    vertices += mesh.positions.length / 3;
    indices += mesh.indices.length;
  }
  const positions = new Float32Array(vertices * 3);
  const colours = new Float32Array(vertices * 3);
  const normals = new Float32Array(vertices * 3);
  const across = new Float32Array(vertices);
  const index = new Uint32Array(indices);
  let vertex = 0;
  let at = 0;
  for (const { mesh } of roads) {
    positions.set(mesh.positions, vertex * 3);
    colours.set(mesh.colours, vertex * 3);
    across.set(mesh.across, vertex);
    for (let each = 0; each < mesh.indices.length; each += 1) {
      index[at + each] = (mesh.indices[each] as number) + vertex;
    }
    vertex += mesh.positions.length / 3;
    at += mesh.indices.length;
  }
  for (let up = 1; up < normals.length; up += 3) normals[up] = 1;
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('color', new BufferAttribute(colours, 3));
  geometry.setAttribute('normal', new BufferAttribute(normals, 3));
  geometry.setAttribute(ROAD_ACROSS_ATTRIBUTE, new BufferAttribute(across, 1));
  geometry.setAttribute(ROAD_REACH_ATTRIBUTE, new BufferAttribute(new Float32Array(vertices), 1));
  geometry.setIndex(new BufferAttribute(index, 1));
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * The most pieces of one furniture kind a frame draws: **64**. A village at
 * its fullest has 16 lamp posts and 8 bollards (`streets.ts` §`furnish`), a
 * frame holds two villages at most, and only what is within
 * `streets.ts` §`FURNITURE_DRAW_METRES` of the camera is drawn — so the cut
 * past this never binds on a village the rules built. Since #1637 a city
 * centre's street stands a lamp post every 16 m on each side, about 30 in
 * reach, and its bollards only at side roads' mouths: `city-streetscape.test.ts`
 * holds every kind under this on #1540's dense town read as a city centre,
 * with a side road every 60 m. Not raised.
 */
export const FURNITURE_CAPACITY = 64;

/**
 * One furniture kind as one geometry: its parts merged, coloured by vertex.
 * The realistic world's carries texture coordinates in metres too, for the
 * bench's slats (`projectedInMetres`); the stylised world's needs none.
 */
function furnitureGeometry(kind: FurnitureKind, world: 'stylised' | 'realistic'): BufferGeometry {
  const style = FURNITURE_STYLE[kind];
  if (world === 'stylised') {
    return merged(
      style.parts.map((part) => {
        const geometry = part.geometry();
        paintGrounded(geometry, part.colour, 1, false);
        return geometry;
      }),
      ['color'],
    );
  }
  const tile = style.surface === 'planks' ? REALISTIC_STRUCTURE_SURFACES.planks.tileMetres : 1;
  const parts = style.parts.map((part) => {
    const projected = projectedInMetres(part.geometry(), { across: tile, up: tile }, 1, false);
    // The photographed slats wear the photograph's own colour; every other
    // part its paint, which the planks' map darkens to a frame on a bench.
    paintGrounded(
      projected,
      style.surface === 'planks' && part.colour === BENCH_WOOD ? 0xffffff : part.colour,
      1,
      false,
    );
    return projected;
  });
  const joined = mergeGeometries(parts);
  for (const part of parts) part.dispose();
  if (joined === null) throw new Error(`${kind}: its parts could not be merged`);
  return joined;
}

/**
 * Every piece in `items` as one geometry: `shapes`' own, each piece's turned
 * by its yaw as three's `makeRotationY` turns it and stood where it stands —
 * the transform the instanced draw made on the GPU until #1689, made here
 * once. Every shape carries the same attributes, unindexed.
 */
function furnitureSurfaceGeometry(
  items: readonly FurnitureItem[],
  shapes: ReadonlyMap<FurnitureKind, BufferGeometry>,
): BufferGeometry {
  const [first] = shapes.values();
  const names = first === undefined ? [] : Object.keys(first.attributes);
  let vertices = 0;
  for (const item of items) {
    vertices += (shapes.get(item.kind) as BufferGeometry).getAttribute('position').count;
  }
  const geometry = new BufferGeometry();
  for (const name of names) {
    const size = (first as BufferGeometry).getAttribute(name).itemSize;
    const out = new Float32Array(vertices * size);
    let at = 0;
    for (const item of items) {
      const source = (shapes.get(item.kind) as BufferGeometry).getAttribute(name);
      const values = source.array as Float32Array;
      if (name === 'position' || name === 'normal') {
        const cos = Math.cos(item.rotation);
        const sin = Math.sin(item.rotation);
        const [dx, dy, dz] = name === 'position' ? [item.x, item.y, item.z] : [0, 0, 0];
        for (let each = 0; each < values.length; each += 3) {
          const x = values[each] as number;
          const z = values[each + 2] as number;
          out[at + each] = cos * x + sin * z + dx;
          out[at + each + 1] = (values[each + 1] as number) + dy;
          out[at + each + 2] = -sin * x + cos * z + dz;
        }
      } else {
        out.set(values, at);
      }
      at += values.length;
    }
    geometry.setAttribute(name, new BufferAttribute(out, size));
  }
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * The street furniture on the pavements in view — #1536 (`streets.ts`
 * §`furnish`): **one merged mesh and one draw call a surface**
 * ({@link FURNITURE_SURFACES}), two at most, and none where a frame holds no
 * street. Only what stands within `streets.ts` §`FURNITURE_DRAW_METRES` of the
 * camera is drawn, which is its level of detail: a piece is either drawn whole
 * or not at all.
 *
 * ⚠️ **It was one instanced draw a KIND, four, until #1689**, and a reviewer
 * who remembers four is reading the belt before the village frame was frozen.
 * The lamp post, the bollard and the bin wore three materials made from the
 * same numbers; they now wear one, and every piece of a surface is merged into
 * one geometry, so the frame draws the same triangles in the same places in
 * two calls. Instancing cannot do that — an instanced draw is ONE shape — and
 * three's `BatchedMesh` draws through `WEBGL_multi_draw`, which the owner's
 * page's counter does not see (`browser/realistic/draws.ts`).
 *
 * ⚠️ **Rebuilt only when the pieces in reach change**, as
 * {@link PavementBelt} is when its streets do: `streets.ts` hands every frame
 * the same objects for the same villages, and a piece is fixed in the
 * corridor's frame, so a frame whose pieces in reach are the last frame's
 * uploads nothing — where the instanced draw uploaded every matrix every frame.
 *
 * A belt per world, as {@link PavementBelt} is: the stylised view's is
 * painted by {@link FURNITURE_STYLE}, lit or flat by the rung; the realistic
 * world's is the same triangles, physically based, the bench's slats in
 * Poly Haven's `dark_planks`, breathing the realistic air.
 */
export class FurnitureBelt {
  readonly #meshes = new Map<FurnitureSurface, Mesh>();
  readonly #materials = new Map<
    FurnitureSurface,
    { readonly lit: Material; readonly flat: Material }
  >();
  /** Each surface's kinds' shapes, one piece's, unindexed. */
  readonly #shapes = new Map<FurnitureSurface, Map<FurnitureKind, BufferGeometry>>();
  /** The pieces each surface's mesh holds, in the order it holds them. */
  readonly #held = new Map<FurnitureSurface, readonly FurnitureItem[]>();
  /** This frame's pieces in reach, a surface's — reused, so a frame allocates nothing. */
  readonly #inReach = new Map<FurnitureSurface, FurnitureItem[]>();
  /** How many of each kind the last frame drew. @see drawnOf */
  readonly #drawn = new Map<FurnitureKind, number>();
  #shown = true;
  /** Whether the browser gate has turned the furniture off — its control. */
  #switchedOn = true;

  constructor(
    world: 'stylised' | 'realistic',
    planks?: { readonly colour: Texture; readonly normal: Texture },
  ) {
    for (const surface of FURNITURE_SURFACES) {
      let materials: { readonly lit: Material; readonly flat: Material };
      if (world === 'realistic') {
        const finish = STRUCTURE_SURFACE_FINISH[surface];
        const maps = surface === 'planks' ? planks : undefined;
        const material = withAtmosphere(
          (maps === undefined ? (made: Material): Material => made : withTextureLodBias)(
            constructed(
              new MeshStandardMaterial({
                // The paint is in the vertex colour, so the material is white.
                color: 0xffffff,
                roughness: finish.roughness,
                metalness: finish.metalness,
                vertexColors: true,
                ...(maps === undefined ? {} : { map: maps.colour, normalMap: maps.normal }),
              }),
            ),
          ),
        );
        materials = { lit: material, flat: material };
      } else {
        materials = {
          lit: constructed(new MeshLambertMaterial({ vertexColors: true })),
          flat: constructed(new MeshBasicMaterial({ vertexColors: true })),
        };
      }
      this.#materials.set(surface, materials);
      const shapes = new Map<FurnitureKind, BufferGeometry>();
      for (const kind of FURNITURE_KINDS) {
        if (FURNITURE_STYLE[kind].surface !== surface) continue;
        const built = furnitureGeometry(kind, world);
        shapes.set(kind, built.index === null ? built : built.toNonIndexed());
        if (built.index !== null) built.dispose();
      }
      this.#shapes.set(surface, shapes);
      this.#held.set(surface, []);
      this.#inReach.set(surface, []);
      const mesh = new Mesh(new BufferGeometry(), materials.lit);
      // Spread along a village: a sphere about two villages' pieces culls
      // nothing a rider would miss, and two calls are all it could save.
      mesh.frustumCulled = false;
      mesh.visible = false;
      this.#meshes.set(surface, mesh);
    }
    for (const kind of FURNITURE_KINDS) this.#drawn.set(kind, 0);
  }

  addTo(scene: Scene): void {
    for (const mesh of this.#meshes.values()) scene.add(mesh);
  }

  /** One surface's mesh. For the jsdom suite. */
  meshOf(surface: FurnitureSurface): Mesh {
    return this.#meshes.get(surface) as Mesh;
  }

  /** One piece of `kind`, in its own frame: the shape every piece of it is drawn from. */
  shapeOf(kind: FurnitureKind): BufferGeometry {
    return this.#shapes.get(FURNITURE_STYLE[kind].surface)?.get(kind) as BufferGeometry;
  }

  /** How many pieces of `kind` the last frame drew. @see furnitureCountsOf */
  drawnOf(kind: FurnitureKind): number {
    return this.#drawn.get(kind) ?? 0;
  }

  setShown(on: boolean): void {
    this.#shown = on;
    if (!on) for (const mesh of this.#meshes.values()) mesh.visible = false;
  }

  /** @see furnitureShownOf */
  switchOn(on: boolean): void {
    this.#switchedOn = on;
  }

  /** Shades the furniture, or stops shading it — #286. @see QualitySettings.shading */
  setShading(shading: QualitySettings['shading']): void {
    for (const [surface, mesh] of this.#meshes) {
      mesh.material = (this.#materials.get(surface) as { lit: Material; flat: Material })[shading];
    }
  }

  /** This frame's streets, and where the camera is: what is in reach is drawn. */
  update(
    streets: readonly VillageStreet[],
    camera: { readonly x: number; readonly z: number },
  ): void {
    for (const kind of FURNITURE_KINDS) this.#drawn.set(kind, 0);
    for (const reach of this.#inReach.values()) reach.length = 0;
    if (this.#shown && this.#switchedOn) {
      for (const street of streets) {
        for (const item of street.furniture) {
          if (Math.hypot(item.x - camera.x, item.z - camera.z) > FURNITURE_DRAW_METRES) continue;
          const drawn = this.#drawn.get(item.kind) ?? 0;
          if (drawn >= FURNITURE_CAPACITY) continue;
          this.#drawn.set(item.kind, drawn + 1);
          this.#inReach.get(FURNITURE_STYLE[item.kind].surface)?.push(item);
        }
      }
    }
    for (const [surface, mesh] of this.#meshes) {
      const reach = this.#inReach.get(surface) as FurnitureItem[];
      if (!sameFurniture(reach, this.#held.get(surface) as readonly FurnitureItem[])) {
        this.#held.set(surface, [...reach]);
        mesh.geometry.dispose();
        mesh.geometry = furnitureSurfaceGeometry(
          reach,
          this.#shapes.get(surface) as ReadonlyMap<FurnitureKind, BufferGeometry>,
        );
      }
      mesh.visible = this.#shown && reach.length > 0;
    }
  }

  dispose(): void {
    for (const [surface, mesh] of this.#meshes) {
      mesh.geometry.dispose();
      for (const shape of this.#shapes.get(surface)?.values() ?? []) shape.dispose();
      const materials = this.#materials.get(surface);
      materials?.lit.dispose();
      if (materials !== undefined && materials.flat !== materials.lit) materials.flat.dispose();
    }
  }
}

/** Whether two lists hold the same pieces, by identity, in the same order. */
function sameFurniture(first: readonly FurnitureItem[], second: readonly FurnitureItem[]): boolean {
  return first.length === second.length && first.every((item, index) => item === second[index]);
}

/**
 * The vertex attribute that marks a decoration's vertex as glowing — #1624:
 * 1 drawn its own colour whatever the light, 0 lit as any other surface.
 * @see withDecorationGlow
 */
export const DECORATION_GLOW_ATTRIBUTE = 'oylGlow';

/**
 * Teaches a lit material the decorations' glow — #1624: a vertex whose
 * {@link DECORATION_GLOW_ATTRIBUTE} is 1 leaves the lighting with its own
 * colour, so a lit bulb and the lantern it hangs from share ONE draw call,
 * with no lamp and no second mesh. Spliced in just after three's
 * `opaque_fragment`, which writes the lit colour out, and before the tone
 * mapping and the fog, so a glowing part still goes into the fog as anything
 * else does.
 *
 * ⚠️ **Steady** (WCAG 2.3.1): it adds no uniform at all — nothing here, or
 * anywhere that updates the belt, changes it from frame to frame, so a rider
 * under `prefers-reduced-motion` sees exactly what anyone else does.
 *
 * Chained after whatever the material already does, and keyed apart, for
 * {@link withSurfaceDetail}'s reason; a three bump that moved a chunk throws.
 */
function withDecorationGlow<M extends Material>(material: M): M {
  const earlier = material.onBeforeCompile.bind(material);
  const earlierKey = material.customProgramCacheKey();
  const spliced = "#1624's glow";
  material.onBeforeCompile = (shader, renderer) => {
    earlier(shader, renderer);
    shader.vertexShader = replacedOrThrown(
      replacedOrThrown(
        shader.vertexShader,
        '#include <common>',
        `#include <common>\nattribute float ${DECORATION_GLOW_ATTRIBUTE};\nvarying float vOylGlow;`,
        'vertex',
        spliced,
      ),
      '#include <color_vertex>',
      `#include <color_vertex>\n\tvOylGlow = ${DECORATION_GLOW_ATTRIBUTE};`,
      'vertex',
      spliced,
    );
    shader.fragmentShader = replacedOrThrown(
      replacedOrThrown(
        shader.fragmentShader,
        '#include <common>',
        '#include <common>\nvarying float vOylGlow;',
        'fragment',
        spliced,
      ),
      '#include <opaque_fragment>',
      '#include <opaque_fragment>\n\tgl_FragColor.rgb = mix(gl_FragColor.rgb, diffuseColor.rgb, vOylGlow);',
      'fragment',
      spliced,
    );
  };
  material.customProgramCacheKey = () => `${earlierKey}|oyl-decoration-glow`;
  return material;
}

/**
 * The decorations' two materials in a world — #1624: the stylised world's
 * lit and flat, and the realistic world's one, physically based and
 * breathing its air. White, because the paint is in the vertex colour; the
 * lit ones glow where a vertex says (the flat one draws every vertex its own
 * colour already).
 */
export function decorationMaterials(world: 'stylised' | 'realistic'): {
  readonly lit: Material;
  readonly flat: Material;
} {
  if (world === 'realistic') {
    const material = withAtmosphere(
      withDecorationGlow(
        constructed(
          new MeshStandardMaterial({
            color: 0xffffff,
            roughness: 0.8,
            metalness: 0,
            vertexColors: true,
          }),
        ),
      ),
    );
    return { lit: material, flat: material };
  }
  return {
    lit: withDecorationGlow(constructed(new MeshLambertMaterial({ vertexColors: true }))),
    flat: constructed(new MeshBasicMaterial({ vertexColors: true })),
  };
}

/** One decoration shape in the unit box about the origin: its corners, unindexed, and their normals. */
interface DecorationTemplate {
  readonly positions: Float32Array;
  readonly normals: Float32Array;
}

function decorationTemplate(made: BufferGeometry): DecorationTemplate {
  const flat = made.index === null ? made : made.toNonIndexed();
  const positions = Float32Array.from(flat.getAttribute('position').array);
  const normals = Float32Array.from(flat.getAttribute('normal').array);
  made.dispose();
  flat.dispose();
  return { positions, normals };
}

/**
 * A pumpkin — #1625: `decorations.ts` §`PUMPKIN`'s lathe, its radii ribbed,
 * stood in the unit box (its foot at `y = −0.5`) and smooth-shaded.
 */
function pumpkinGeometry(): BufferGeometry {
  const lathe = new LatheGeometry(
    PUMPKIN.profile.map(([radius, up]) => new Vector2(radius, up - 0.5)),
    PUMPKIN.segments,
  );
  const position = lathe.getAttribute('position');
  for (let at = 0; at < position.count; at += 1) {
    const x = position.getX(at);
    const z = position.getZ(at);
    const rib = 1 + PUMPKIN.ribDepth * Math.cos(PUMPKIN.ribs * Math.atan2(x, z));
    position.setXYZ(at, x * rib, position.getY(at), z * rib);
  }
  lathe.computeVertexNormals();
  return lathe;
}

/** Every {@link DecorationShape}, built once. @see DecorationShape */
const DECORATION_TEMPLATES: Readonly<Record<DecorationShape, DecorationTemplate>> = {
  box: decorationTemplate(new BoxGeometry(1, 1, 1)),
  pumpkin: decorationTemplate(pumpkinGeometry()),
  stalk: decorationTemplate(new CylinderGeometry(0.5, 0.5, 1, 5, 1, true)),
  face: decorationTemplate(new PlaneGeometry(1, 1)),
  // #1626: a bulb, and a wreath's ring — outer radius 0.5, tube 0.1 — in xy.
  bulb: decorationTemplate(new OctahedronGeometry(0.5, 0)),
  wreath: decorationTemplate(new TorusGeometry(0.4, 0.1, 4, 10).scale(1, 1, 5)),
  // #1627: the village-square tree's tiers and its trunk, closed.
  cone: decorationTemplate(new ConeGeometry(0.5, 1, 10, 1, false)),
  trunk: decorationTemplate(new CylinderGeometry(0.5, 0.5, 1, 8, 1, false)),
};

/** The triangles one part of `shape` is — #1625. @see DecorationShape */
export function decorationShapeTriangles(shape: DecorationShape = 'box'): number {
  return DECORATION_TEMPLATES[shape].positions.length / 9;
}

/**
 * The triangles one box part is: **12**.
 *
 * @test-facing `decoration-belt.test.ts` counts its probe's boxes by it; since
 * #1625 the belt counts every shape by {@link decorationKindTriangles}
 */
export const DECORATION_PART_TRIANGLES = decorationShapeTriangles('box');

/** The triangles one item of `kind` is, every part together — #1625. */
export function decorationKindTriangles(kind: DecorationKind): number {
  return kind.parts.reduce((sum, part) => sum + decorationShapeTriangles(part.shape), 0);
}

/** Reused by {@link decorationGeometry}, so a rebuild allocates no colour. */
const DECORATION_SCRATCH = new Color();

/**
 * Every item as one geometry — #1624: each item's boxes, turned by its
 * anchor's yaw and stood on its anchor, coloured by vertex, with the glow in
 * {@link DECORATION_GLOW_ATTRIBUTE}. An item whose kind `kinds` does not
 * name is skipped, and so is any item that would take the geometry past
 * `realistic-budget.ts` §`REALISTIC_DECORATION_TRIANGLES`: whole items only.
 * `counted`, where given, is cleared and left holding how many items of each
 * kind were kept — #1627.
 */
export function decorationGeometry(
  items: readonly DecorationItem[],
  kinds: readonly DecorationKind[],
  counted?: Map<string, number>,
): BufferGeometry {
  counted?.clear();
  const byName = new Map(kinds.map((kind) => [kind.item, kind]));
  const drawn: { readonly item: DecorationItem; readonly kind: DecorationKind }[] = [];
  let triangles = 0;
  for (const item of items) {
    const kind = byName.get(item.item);
    if (kind === undefined) continue;
    const adds = decorationKindTriangles(kind);
    if (triangles + adds > REALISTIC_DECORATION_TRIANGLES) continue;
    triangles += adds;
    drawn.push({ item, kind });
    counted?.set(kind.item, (counted.get(kind.item) ?? 0) + 1);
  }
  const vertices = triangles * 3;
  const positions = new Float32Array(vertices * 3);
  const normals = new Float32Array(vertices * 3);
  const colours = new Float32Array(vertices * 3);
  const glow = new Float32Array(vertices);
  let at = 0;
  for (const { item, kind } of drawn) {
    const { x, z, yaw } = item.anchor;
    // #1625: on its step's top where it stands on one, else on its anchor.
    const y = item.base;
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    for (const part of kind.parts) {
      const box = DECORATION_TEMPLATES[part.shape ?? 'box'];
      DECORATION_SCRATCH.set(part.colour);
      const [width, height, depth] = part.size;
      const [px, py, pz] = part.at;
      for (let corner = 0; corner < box.positions.length; corner += 3) {
        // Item-local, then turned about y as three's `rotation.y` turns.
        const lx = (box.positions[corner] as number) * width + px;
        const ly = (box.positions[corner + 1] as number) * height + py;
        const lz = (box.positions[corner + 2] as number) * depth + pz;
        // A normal goes through the inverse of the part's scale, so a
        // squat pumpkin is shaded as squat (#1625); a flat part keeps its own.
        let nx = box.normals[corner] as number;
        let ny = box.normals[corner + 1] as number;
        let nz = box.normals[corner + 2] as number;
        if (width > 0 && height > 0 && depth > 0) {
          nx /= width;
          ny /= height;
          nz /= depth;
          const length = Math.hypot(nx, ny, nz);
          if (length > 0) {
            nx /= length;
            ny /= length;
            nz /= length;
          }
        }
        positions[at * 3] = x + lx * cos + lz * sin;
        positions[at * 3 + 1] = y + ly;
        positions[at * 3 + 2] = z - lx * sin + lz * cos;
        normals[at * 3] = nx * cos + nz * sin;
        normals[at * 3 + 1] = ny;
        normals[at * 3 + 2] = -nx * sin + nz * cos;
        colours[at * 3] = DECORATION_SCRATCH.r;
        colours[at * 3 + 1] = DECORATION_SCRATCH.g;
        colours[at * 3 + 2] = DECORATION_SCRATCH.b;
        glow[at] = part.glows ? 1 : 0;
        at += 1;
      }
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new BufferAttribute(normals, 3));
  geometry.setAttribute('color', new BufferAttribute(colours, 3));
  geometry.setAttribute(DECORATION_GLOW_ATTRIBUTE, new BufferAttribute(glow, 1));
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * The holiday's decorations on every village in reach — #1624 (epic #1621):
 * **one merged, vertex-coloured mesh and ONE draw call** however many
 * villages and items, and none where there is no item (no holiday, the
 * switch off, or a table that names nothing for the holiday). Owner ruling
 * (c) of 2026-10-24: one call in total, and no downloaded byte.
 *
 * A village is in reach while any of its anchors is within `streets.ts`
 * §`FURNITURE_DRAW_METRES` of the camera, and then ALL of its items are
 * drawn, so riding through a village changes nothing.
 *
 * ⚠️ **Rebuilt only when the SET of villages in reach changes** — one coming
 * into reach or leaving it — or the holiday or the table does, as
 * {@link PavementBelt} is: `streets.ts` hands every frame the same objects
 * for the same villages, and an item is fixed in the corridor's frame, so a
 * frame whose villages are the last frame's uploads nothing.
 * {@link DecorationBelt.rebuilds} counts the rebuilds, for the suite.
 *
 * Lit and glowing parts share the call: {@link withDecorationGlow}. A belt
 * per world, as {@link PavementBelt} is, of the SAME triangles in both
 * (ADR 0026 D-3): the stylised view's lit or flat by the rung (#286), the
 * realistic world's physically based and in its air.
 */
export class DecorationBelt {
  readonly #mesh: Mesh;
  readonly #materials: { readonly lit: Material; readonly flat: Material };
  /** The villages the mesh holds, in the order it holds them. */
  #held: readonly VillageStreet[] = [];
  #heldHoliday: Holiday | undefined;
  #heldKinds: ItemTable | undefined;
  /** This frame's villages in reach — reused, so a frame allocates nothing. */
  readonly #reach: VillageStreet[] = [];
  #shown = true;
  #rebuilds = 0;
  /** How many items of each kind the mesh holds — #1627. */
  readonly #drawn = new Map<string, number>();

  constructor(world: 'stylised' | 'realistic') {
    this.#materials = decorationMaterials(world);
    this.#mesh = new Mesh(new BufferGeometry(), this.#materials.lit);
    this.#mesh.visible = false;
  }

  addTo(scene: Scene): void {
    scene.add(this.#mesh);
  }

  /** The mesh. For the browser gate's counts and the jsdom suite. */
  get mesh(): Mesh {
    return this.#mesh;
  }

  /** How many times the geometry has been built — #1624's "uploads nothing". */
  get rebuilds(): number {
    return this.#rebuilds;
  }

  /** How many triangles the mesh draws: nought where it is not drawn. */
  get triangles(): number {
    if (!this.#mesh.visible) return 0;
    return this.#mesh.geometry.getAttribute('position').count / 3;
  }

  /**
   * How many items of the kind named `item` the mesh draws — #1627: nought
   * where it is not drawn. Counted as {@link decorationGeometry} keeps them,
   * whole items under its ceiling only.
   *
   * @test-facing the owner's page publishes the village-square trees by it
   * (`browser/realistic-harness.ts`)
   */
  itemsDrawn(item: string): number {
    if (!this.#mesh.visible) return 0;
    return this.#drawn.get(item) ?? 0;
  }

  setShown(on: boolean): void {
    this.#shown = on;
    if (!on) this.#mesh.visible = false;
  }

  /** Shades the decorations, or stops shading them — #286. @see QualitySettings.shading */
  setShading(shading: QualitySettings['shading']): void {
    this.#mesh.material = this.#materials[shading];
  }

  /** This frame's streets, where the camera is, the holiday on and what it places. */
  update(
    streets: readonly VillageStreet[],
    camera: { readonly x: number; readonly z: number },
    holiday: Holiday | undefined,
    kinds: ItemTable,
  ): void {
    const reach = this.#reach;
    reach.length = 0;
    if (this.#shown && holiday !== undefined) {
      for (const street of streets) if (inReach(street, camera)) reach.push(street);
    }
    if (
      !sameStreets(reach, this.#held) ||
      holiday !== this.#heldHoliday ||
      kinds !== this.#heldKinds
    ) {
      this.#held = reach.length === 0 ? NO_STREETS : [...reach];
      this.#heldHoliday = holiday;
      this.#heldKinds = kinds;
      const items = decorationsFor(this.#held, holiday, kinds);
      const geometry = decorationGeometry(
        items,
        holiday === undefined ? NO_DECORATION_KINDS : (kinds[holiday] ?? NO_DECORATION_KINDS),
        this.#drawn,
      );
      this.#mesh.geometry.dispose();
      this.#mesh.geometry = geometry;
      this.#rebuilds += 1;
    }
    this.#mesh.visible = this.#mesh.geometry.getAttribute('position').count > 0;
  }

  dispose(): void {
    this.#mesh.geometry.dispose();
    this.#materials.lit.dispose();
    if (this.#materials.flat !== this.#materials.lit) this.#materials.flat.dispose();
  }
}

/**
 * What {@link decorationGlowProbe} read: one box's middle pixel, `[r, g, b]` 0–255.
 *
 * @test-facing read by `browser/decoration-harness.ts` and its spec
 */
export type DecorationPixel = readonly [number, number, number];

/**
 * The decorations' glow in a real context — #1624, for the browser gate,
 * which cannot import three (`three-seam.test.ts`): ONE box of `colour`
 * facing the camera, built by {@link decorationGeometry} and worn in
 * `world`'s lit {@link decorationMaterials}, under one directional light at
 * its face or turned away and no other light, and the pixel at its middle.
 *
 * @test-facing read by `browser/decoration-harness.ts`; the product draws the
 * belt through {@link DecorationBelt} only
 */
export function decorationGlowProbe(
  canvas: HTMLCanvasElement,
  world: 'stylised' | 'realistic',
  light: 'toward' | 'away',
  colour: number,
  glows: boolean,
): DecorationPixel {
  const renderer = new WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(16, 16, false);
  renderer.setClearColor(0x000000, 1);
  const kind: DecorationKind = {
    item: 'box',
    anchors: ['green'],
    chance: 1,
    radius: 0,
    parts: [{ size: [2, 2, 0.2], at: [0, 0, 0], colour, glows }],
  };
  const geometry = decorationGeometry(
    [
      {
        anchor: { kind: 'green', x: 0, y: 0, z: 0, yaw: 0, clear: 1, hash: 0 },
        item: 'box',
        base: 0,
        seed: 0,
      },
    ],
    [kind],
  );
  const { lit } = decorationMaterials(world);
  const scene = new Scene();
  scene.add(new Mesh(geometry, lit));
  const sun = new DirectionalLight(0xffffff, 1);
  sun.position.set(0, 0, light === 'toward' ? 1 : -1);
  scene.add(sun);
  const eye = new PerspectiveCamera(20, 1, 0.1, 20);
  eye.position.set(0, 0, 5);
  eye.lookAt(0, 0, 0);
  renderer.render(scene, eye);
  const gl = renderer.getContext();
  const pixel = new Uint8Array(4);
  gl.readPixels(8, 8, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
  geometry.dispose();
  lit.dispose();
  renderer.dispose();
  return [pixel[0] ?? 0, pixel[1] ?? 0, pixel[2] ?? 0];
}

/**
 * The decoration belt's draw calls in a real context — #1624: a
 * {@link DecorationBelt} holding `streets`' items for Halloween from
 * `kinds`, as a view at `camera` would, alone in a scene and drawn from
 * straight above, then hidden and drawn again. Three's own
 * `renderer.info.render.calls` for each, and the belt's triangles.
 *
 * @test-facing read by `browser/decoration-harness.ts`; the product's belt is
 * drawn in the view's own frame, which `realistic-town.browser.spec.ts` counts
 */
export function decorationCallsProbe(
  canvas: HTMLCanvasElement,
  streets: readonly VillageStreet[],
  camera: { readonly x: number; readonly z: number },
  kinds: ItemTable,
): { readonly shown: number; readonly hidden: number; readonly triangles: number } {
  const renderer = new WebGLRenderer({ canvas, antialias: false });
  renderer.setSize(64, 32, false);
  const belt = new DecorationBelt('stylised');
  const scene = new Scene();
  belt.addTo(scene);
  belt.update(streets, camera, 'halloween', kinds);
  const triangles = belt.triangles;
  const sphere = belt.mesh.geometry.boundingSphere;
  const x = sphere?.center.x ?? camera.x;
  const z = sphere?.center.z ?? camera.z;
  const eye = new PerspectiveCamera(60, 2, 1, 5_000);
  eye.position.set(x, 3 * (sphere?.radius ?? 200), z + 1);
  eye.lookAt(x, 0, z);
  renderer.render(scene, eye);
  const shown = renderer.info.render.calls;
  belt.setShown(false);
  renderer.render(scene, eye);
  const hidden = renderer.info.render.calls;
  belt.dispose();
  renderer.dispose();
  return { shown, hidden, triangles };
}

/** No kinds: what a holiday the table does not name places. */
const NO_DECORATION_KINDS: readonly DecorationKind[] = [];

/** Whether any of a village's anchors is within `FURNITURE_DRAW_METRES` of the camera, in plan. */
function inReach(
  street: VillageStreet,
  camera: { readonly x: number; readonly z: number },
): boolean {
  const reach = FURNITURE_DRAW_METRES * FURNITURE_DRAW_METRES;
  for (const anchor of street.anchors) {
    const dx = anchor.x - camera.x;
    const dz = anchor.z - camera.z;
    if (dx * dx + dz * dz <= reach) return true;
  }
  return false;
}

/**
 * The stylised world's wordmark, once loaded — #966. Module state for
 * {@link sceneryGeometries}' reason: a view is built synchronously, so the
 * texture is loaded first, by {@link loadGameWordmark}.
 */
let gameWordmark: Texture | undefined;

/** Reads the wordmark PNG through three's own loader. Replaced in tests. */
async function readWordmarkTexture(url: string): Promise<Texture> {
  return new TextureLoader().loadAsync(url);
}

/**
 * Loads the stylised world's wordmark — #966. Called once, beside
 * {@link loadSceneryModels}, before the first view is created. A wordmark that
 * cannot be read costs the boards their lettering and nothing else: they are
 * drawn plain white, and the ride goes on.
 */
export async function loadGameWordmark(
  load: (url: string) => Promise<Texture> = readWordmarkTexture,
): Promise<void> {
  try {
    const texture = await load(gameWordmarkUrl);
    texture.colorSpace = SRGBColorSpace;
    texture.anisotropy = 4;
    gameWordmark?.dispose();
    gameWordmark = texture;
  } catch {
    // Plain boards. @see the note above
  }
}

function impostorQuad(): BufferGeometry {
  return new PlaneGeometry(1, 1).translate(0, 0.5, 0);
}

/**
 * The far band's material: a billboard that turns about the vertical to face
 * the camera, drawn with whichever of the strip's eight views faces it, sized
 * from the scan the strip was rendered from. Constructed here — D-11 — and
 * alpha-tested so it depth-sorts with the near meshes.
 *
 * ⚠️ **Lit by the world's sun since #630**, where it was unlit: the strip was
 * rendered lit, by the pipeline's own sun, so each texel is relit from the
 * normal strip the pipeline bakes beside it — the world's shade over the
 * script's (`foliage-light.ts`). It is fogged, tone mapped and colour-managed
 * exactly as a lit material is, so it fades into the horizon with everything
 * else. And it sways with the meshes, as a shear of the quad.
 */
function impostorMaterial(
  strip: Texture,
  extras: Readonly<Record<string, unknown>>,
  normals?: Texture,
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
  const scriptSun = scriptSunToward();
  const material = new ShaderMaterial({
    uniforms: UniformsUtils.merge([
      UniformsLib.fog,
      { strip: { value: null }, stripNormals: { value: null } },
    ]),
    fog: true,
    side: DoubleSide,
    defines: {
      ...(normals === undefined ? {} : { OYL_LIT_IMPOSTOR: '' }),
      TREE_HEIGHT: height.toFixed(5),
      TREE_WIDTH: (Number(extras['oyl_scan_width']) > 0
        ? Number(extras['oyl_scan_width'])
        : height
      ).toFixed(5),
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
      varying vec2 vOylKeep;
      varying vec3 vOylTint;
      varying vec2 vOylAcross;
      varying vec2 vOylAlong;
      varying vec2 vOylFacing;
      varying vec2 vOylCrown;
      ${TINT_DECODE_GLSL}
      ${FOLIAGE_SWAY_COMMON}
      void main() {
        #ifdef USE_INSTANCING_COLOR
          vOylKeep = instanceColor.xy;
          vOylTint = oylTintOf(instanceColor.z);
        #else
          vOylKeep = vec2(0.0);
          vOylTint = vec3(0.0);
        #endif
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
        // #630: the breeze, as a shear of the quad matching the meshes' push.
        float oylRise = clamp((QUAD_BOTTOM + position.y * QUAD_H) / TREE_HEIGHT, 0.0, 1.0);
        world.xz += oylWindDirection
          * (${glslFloat(FOLIAGE_SWAY_METRES)} * oylSwayWave(oylSwayPhase(centre.xz)) * oylRise * oylRise);
        vOylAcross = normalize(across.xz + vec2(1e-6, 0.0));
        vOylFacing = facing;
        // Where on the crown this corner is: across the quad, and up it from
        // the crown's middle (half the scan's height), each in [-1, 1].
        vOylCrown = vec2(
          position.x * 2.0 * QUAD_W / TREE_WIDTH,
          ((QUAD_BOTTOM + position.y * QUAD_H) / TREE_HEIGHT) * 2.0 - 1.0
        );
        vOylAlong = normalize(along.xz + vec2(0.0, 1e-6));
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
      uniform sampler2D stripNormals;
      uniform vec3 oylSunToward;
      uniform float oylSunAmbient;
      uniform float oylSunDirect;
      uniform float oylImpostorLit;
      varying vec2 vStripUv;
      varying vec2 vOylKeep;
      varying vec3 vOylTint;
      varying vec2 vOylAcross;
      varying vec2 vOylAlong;
      varying vec2 vOylFacing;
      varying vec2 vOylCrown;
      ${TINT_APPLY_GLSL}
      void main() {
        ${TREE_DITHER_DISCARD}
        vec4 texel = texture2D(strip, vStripUv);
        if (texel.a < ${REALISTIC_ALPHA_CUTOFF.toFixed(2)}) discard;
        #ifdef OYL_LIT_IMPOSTOR
        {
          // #630: relit by the world's sun, from the strip's own normals.
          vec3 oylLocal = texture2D(stripNormals, vStripUv).xyz * 2.0 - 1.0;
          if (dot(oylLocal, oylLocal) > 0.0025) {
            vec3 oylAcrossW = vec3(vOylAcross.x, 0.0, vOylAcross.y);
            vec3 oylAlongW = vec3(vOylAlong.x, 0.0, vOylAlong.y);
            // The baked normal, turned into the world with the instance.
            vec3 oylBakedW = oylAcrossW * oylLocal.x + vec3(0.0, oylLocal.y, 0.0) + oylAlongW * oylLocal.z;
            // ⚠️ **And the crown's own**, measured: a leaf card's normal in
            // Cycles' pass faces the camera that rendered it whichever way
            // the card is turned, so the strip's normals over a canopy
            // average toward the viewer and carry no left or right — the
            // first version relit a tree 45 m off by 1 % between its sides.
            // So the texel's place on a sphere round the crown carries the
            // shape (${String(Math.round(IMPOSTOR_CROWN_SHARE * 100))} %), and the strip the detail.
            vec3 oylRight = vec3(vOylFacing.y, 0.0, -vOylFacing.x);
            vec3 oylToward = vec3(vOylFacing.x, 0.0, vOylFacing.y);
            vec2 oylOn = clamp(vOylCrown, -1.0, 1.0);
            vec3 oylCrownW = oylRight * oylOn.x + vec3(0.0, oylOn.y, 0.0)
              + oylToward * sqrt(max(1.0 - dot(oylOn, oylOn), 0.0));
            vec3 oylWorld = normalize(
              mix(oylBakedW, oylCrownW, ${glslFloat(IMPOSTOR_CROWN_SHARE)}) + vec3(0.0, 1e-4, 0.0)
            );
            // The same normal in the plant's frame, where the script's sun is.
            vec3 oylInPlant = vec3(dot(oylWorld, oylAcrossW), oylWorld.y, dot(oylWorld, oylAlongW));
            float oylUnder = (oylSunAmbient + oylSunDirect * max(dot(oylWorld, oylSunToward), 0.0))
              / max(oylSunAmbient + oylSunDirect * 0.5, 1e-4);
            float oylBaked = (${glslFloat(SCRIPT_SKY_SHARE)} + max(dot(oylInPlant, vec3(${scriptSun.map((each) => each.toFixed(5)).join(', ')})), 0.0))
              / ${glslFloat(SCRIPT_SKY_SHARE + 0.5)};
            float oylRelit = clamp(oylUnder / oylBaked, ${glslFloat(IMPOSTOR_RELIGHT_RANGE[0])}, ${glslFloat(IMPOSTOR_RELIGHT_RANGE[1])});
            texel.rgb *= mix(1.0, oylRelit, oylImpostorLit);
          }
        }
        #endif
        // #621: the same tint the tree's meshes wear, on the light it was baked with.
        ${IMPOSTOR_TINT_LINE}
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }
    `,
  });
  (material.uniforms['strip'] as { value: Texture | null }).value = strip;
  // #630: the normals, and the world's sun as this frame's view wrote it.
  (material.uniforms['stripNormals'] as { value: Texture | null }).value = normals ?? null;
  material.uniforms['oylSunToward'] = FOLIAGE.oylSunToward;
  material.uniforms['oylSunAmbient'] = FOLIAGE.oylSunAmbient;
  material.uniforms['oylSunDirect'] = FOLIAGE.oylSunDirect;
  material.uniforms['oylImpostorLit'] = FOLIAGE.oylImpostorLit;
  material.uniforms['oylWindTime'] = FOLIAGE.oylWindTime;
  material.uniforms['oylWindDirection'] = FOLIAGE.oylWindDirection;
  material.uniforms['oylSwayScale'] = FOLIAGE.oylSwayScale;
  // #619 lever 2: the strip is mipmapped, so the far band sheds with the rest.
  // #622: its fog is three's chunk like any other, so it breathes the same air.
  return constructed(withAtmosphere(withTextureLodBias(material)));
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

/** How far a point beside a cone's axis may stand from it for a sphere there to reach the cone. */
const FRUSTUM_SLANT = Math.hypot(1, FRUSTUM_SPREAD);

/**
 * Whether any part of a tree — `radius` metres across from its trunk and
 * `height` metres tall from its base — can be in the camera's view: #617's
 * review, and what the trees are RANKED by.
 *
 * {@link inView} is not that: it keeps items down to {@link VIEW_BEHIND_METRES}
 * behind the rider, and a floor of {@link SCATTER_LATERAL_METRES} to the side
 * however near the camera, because it is a cull that must never drop what is
 * on screen. Ranking by it spent the one full slot on a tree the rider had
 * just passed. This is the other side of the same bound: a tree it refuses is
 * never on screen, so it can be ranked out without anything a rider sees
 * changing.
 *
 * - **Ahead of the camera.** `camera.ts` §`cameraRig` puts the eye
 *   {@link CAMERA_BEHIND_METRES} behind the rider, looking along their heading
 *   at the road 29.5 m on — so it never turns aside and never rolls, and it
 *   pitches up on a climb and down on a descent by far less than 90° less the
 *   view's vertical half-angle. So every ray the camera sees has a forward
 *   part along the heading, and a point level with or behind the eye's
 *   vertical plane is never on screen, whichever way it pitches. A tree is
 *   visible only if its crown reaches past that plane: `ahead + radius > 0`.
 * - **Inside the cone.** The horizontal half-tangent is
 *   {@link FRUSTUM_SPREAD}, the WIDEST any frame can produce
 *   (`camera.ts` §`WORST_CASE_ASPECT`), measured at a point's depth along the
 *   view. A pitched camera sees a point deeper than it stands ahead, by up to
 *   its height off the eye's level: BELOW the eye when it pitches down, which
 *   is a descent and the level road, and ABOVE it when it pitches up, which
 *   is a climb steeper than about 2 m in 29.5 m. The larger of the tree's two
 *   — its base under the eye, its crown over it — is added in full, which
 *   errs wide. ⚠️ Until the second review only the first was, and a tree at
 *   a 6 : 1 frame's edge on a steep climb, its crown above the eye, was
 *   ranked out while it showed. A disc of `radius` reaches the cone if its
 *   centre is within `radius` of the cone's side, which is
 *   `radius × √(1 + spread²)` measured across.
 *
 * Both err towards ranking a tree, never towards ranking out one that shows:
 * `realistic-renderer.test.ts` §"treeCanBeSeen" holds it to a sampled
 * frustum at pitches both ways, and that is why it is exported.
 */
export function treeCanBeSeen(
  item: ScatterItem,
  pose: CameraPose,
  radius: number,
  height: number,
): boolean {
  const dx = item.x - pose.x;
  const dz = item.z - pose.z;
  const ahead = dx * pose.headingX + dz * pose.headingZ + CAMERA_BEHIND_METRES;
  if (ahead + radius <= 0) return false;
  const eye = pose.eyeRoadY + CAMERA_ABOVE_METRES;
  const offLevel = Math.max(0, eye - item.y, item.y + height - eye);
  const across = Math.abs(dx * pose.headingZ - dz * pose.headingX);
  return across - radius * FRUSTUM_SLANT <= FRUSTUM_SPREAD * Math.max(0, ahead + offLevel);
}

/**
 * How far a shape reaches from its trunk, and how far above its base, in its
 * own units — the largest of its parts'.
 */
function treeReach(parts: readonly RealisticPart[]): {
  readonly across: number;
  readonly up: number;
} {
  let across = 0;
  let up = 0;
  for (const { geometry } of parts) {
    if (geometry.boundingBox === null) geometry.computeBoundingBox();
    const box = geometry.boundingBox;
    if (box === null) continue;
    across = Math.max(
      across,
      Math.hypot(
        Math.max(Math.abs(box.min.x), Math.abs(box.max.x)),
        Math.max(Math.abs(box.min.z), Math.abs(box.max.z)),
      ),
    );
    up = Math.max(up, box.max.y);
  }
  return { across, up };
}

/**
 * The ground one realistic shape covers, in its own units — #620: the mean of
 * its bounding box's two horizontal half-extents about the trunk, and its
 * height. {@link treeReach} is the bound a CULL needs (the box's corner, so
 * nothing on screen is dropped); a blob wants the crown's radius, which the
 * corner overstates by 41 % on a round crown.
 */
function groundFootprint(parts: readonly RealisticPart[]): {
  readonly radius: number;
  readonly height: number;
} {
  let x = 0;
  let z = 0;
  let height = 0;
  for (const { geometry } of parts) {
    if (geometry.boundingBox === null) geometry.computeBoundingBox();
    const box = geometry.boundingBox;
    if (box === null) continue;
    x = Math.max(x, Math.abs(box.min.x), Math.abs(box.max.x));
    z = Math.max(z, Math.abs(box.min.z), Math.abs(box.max.z));
    height = Math.max(height, box.max.y);
  }
  return { radius: (x + z) / 2, height };
}

/**
 * How many of the nearest trees a ground blob goes under — #620: every rank
 * `tree-levels.ts` §`treeLevelAt` draws at the full or the middle level, and
 * none in the middle-to-impostor band or beyond. @see REALISTIC_GROUND_BLOBS
 */
function groundedTrees(levels: TreeLevels): number {
  return levels.near + levels.middle + (levels.dithered ? 1 : 0);
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
 * For a shrub or a rock, the `realistic-budget.ts` §`REALISTIC_NEAR_MESHES`
 * nearest of its kind are drawn as meshes and every other is not drawn at
 * all, because a 1.5 m shrub beyond the nearest eight is a handful of pixels
 * the fog is already taking.
 *
 * ## Trees: three levels, and a dithered hand-over — #617
 *
 * The trees of both kinds are ranked together, and `tree-levels.ts` says what
 * each rank is drawn as: the full mesh, the middle one, or the impostor, a
 * quad drawn from the eight views the pipeline rendered of the full scan
 * (`realistic-budget.ts` §`REALISTIC_TREE_LEVELS` counts them). At each
 * hand-over ONE tree is submitted at both levels, and each keeps its half of a
 * screen-space dither ({@link withTreeDither}): no alpha blending and no
 * sorting. The three levels of one item are drawn with ONE matrix.
 *
 * Since #617's review only trees the camera can see are ranked
 * ({@link treeCanBeSeen}), and `tree-levels.ts` §`TreeHandOver` paces each
 * tree's move between levels, so a tree does not change shape in one frame
 * when the ranked SET changes — a tree passing out of view, one coming in —
 * as well as when two trees swap. What it still cannot hold is written there.
 *
 * ⚠️ **Nothing is allocated per frame.** The ranking is written into typed
 * arrays sized once, every instanced mesh is built with its capacity in the
 * constructor, as #240's NFR-3 requires of every belt here, and a keep is
 * written straight into its mesh's instance attribute.
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
  readonly #levels: TreeLevels;
  /** Both tree kinds' one ranking. @see REALISTIC_TREE_LEVELS */
  readonly #trees: Ranking;
  /** Where each tree's hand-over is, frame to frame. @see TreeHandOver */
  readonly #handOver: TreeHandOver;
  /** Each ranked tree's entry in the hand-over, by rank. */
  readonly #rankEntry: Int32Array;
  /** Which of this frame's items are trees the camera can see — grown, never per frame. */
  #seen = new Uint8Array(SCATTER_INSTANCE_CAPACITY);
  #shown = true;
  /** #1523: each fir mesh's depth pre-pass, and the materials they wear. @see withDepthPrepass */
  readonly #prepasses: DepthPrepass[] = [];
  readonly #prepassMaterials: MeshStandardMaterial[] = [];
  #prepassMode: DepthPrepassMode = 'drawn';
  /**
   * The rung's scenery budget — #245's, shared with the primitives belt (#478).
   *
   * Unbounded until a rung says otherwise, for {@link ScatterBelt}'s reason: a
   * belt is a mechanism and a rung is a policy.
   */
  #budget = Number.POSITIVE_INFINITY;
  /** How many items the last frame drew, at any level. @see drawnItems */
  #drawn = 0;
  /** The item being placed's packed tint — #621. @see packedInstanceTint */
  #tint = 0;
  /**
   * The items this frame drew as MESHES — each tree at its full or middle
   * level, and each shrub and rock — as the ground blobs' casters (#620).
   * Written in {@link update}'s last pass; `GroundBlobBelt` reads it.
   */
  readonly grounded: BlobCasters;
  /** How many of the nearest trees a blob goes under: the full and middle ranks. */
  readonly #groundedTrees: number;

  /**
   * @param levels how the trees are drawn: the product's, unless a caller is
   *   the browser gate building its hard-swap control
   *   (`realistic-budget.ts` §`HARD_SWAP_TREE_LEVELS`).
   */
  constructor(
    vegetation: ReadonlyMap<RealisticVegetationKind, readonly RealisticShape[]>,
    levels: TreeLevels = REALISTIC_TREE_LEVELS,
  ) {
    this.#levels = levels;
    const slots = treeSlots(levels);
    this.#trees = ranking(slots.ranked);
    this.#handOver = new TreeHandOver(slots, 2 * slots.ranked, levels.handOverFrames);
    this.#rankEntry = new Int32Array(slots.ranked);
    this.#groundedTrees = groundedTrees(levels);
    this.grounded = blobCasters(
      this.#groundedTrees + REALISTIC_NEAR_MESHES.shrub + REALISTIC_NEAR_MESHES.rock,
    );
    for (const kind of REALISTIC_VEGETATION_KINDS) {
      const shapes = vegetation.get(kind) ?? [];
      const tree = kind === 'tree-broadleaf' || kind === 'tree-conifer';
      const nearCap = tree ? slots.full : REALISTIC_NEAR_MESHES[kind];
      // Every level of every kind carries its items' tints (#621); a tree's
      // carries its keeps as well (#617). @see withInstanceChannels
      const keeps = (mesh: InstancedMesh, capacity: number): InstancedMesh => {
        mesh.instanceColor = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
        mesh.instanceColor.setUsage(DynamicDrawUsage);
        return mesh;
      };
      for (const shape of shapes) {
        for (const part of shape.parts) {
          if (tree) withTreeDither(part.material);
          else withInstanceChannels(part.material, false);
          // #1623: a broadleaf turns in autumn; a fir stays green.
          if (kind === 'tree-broadleaf') withAutumn(part.material);
          // #1523: a fir is drawn after a depth pre-pass.
          if (kind === 'tree-conifer') withDepthPrepass(part.material);
        }
      }
      if (kind === 'tree-broadleaf') {
        for (const shape of shapes) {
          if (shape.impostor !== undefined) withAutumn(shape.impostor.material);
        }
      }
      this.#kinds.push({
        kind,
        tree,
        shapes,
        near: shapes.map((shape) =>
          shape.parts.map((part) =>
            drawnInOrder(keeps(instanced(part.geometry, part.material, nearCap), nearCap), 'near'),
          ),
        ),
        middle: shapes.map((shape) =>
          tree && shape.middle !== undefined && slots.middle > 0
            ? shape.middle.parts.map((part) =>
                drawnInOrder(
                  keeps(instanced(part.geometry, part.material, slots.middle), slots.middle),
                  'middle',
                ),
              )
            : undefined,
        ),
        far: shapes.map((shape) =>
          shape.impostor === undefined
            ? undefined
            : drawnInOrder(
                keeps(
                  instanced(this.#quad, shape.impostor.material, SCATTER_INSTANCE_CAPACITY),
                  SCATTER_INSTANCE_CAPACITY,
                ),
                'impostor',
              ),
        ),
        ranking: tree ? this.#trees : ranking(nearCap),
        tint: kind === 'rock' ? 'masonry' : 'foliage',
        fit: sceneryFitMetres(kind),
        reach: shapes.map((shape) => treeReach(shape.parts)),
        footprint: shapes.map((shape) => groundFootprint(shape.parts)),
      });
    }
    this.#prepareFirs();
  }

  /**
   * Gives every fir mesh at its full and middle level a depth pre-pass —
   * #1523. One twin material a material, shared by the two levels as the
   * material is. A fir's merged material is cut, so this is every part of it;
   * drawn apart (`setRealisticMaterialsMerged`, the browser gate's #639
   * control) its bark gets one too, so the two loads still submit the same
   * triangles. @see withDepthPrepass
   */
  #prepareFirs(): void {
    const firs = this.#kinds.find((each) => each.kind === 'tree-conifer');
    if (firs === undefined) return;
    const twins = new Map<Material, MeshStandardMaterial>();
    const mode = (): DepthPrepassMode => this.#prepassMode;
    for (const mesh of [...firs.near.flat(), ...firs.middle.flatMap((meshes) => meshes ?? [])]) {
      const material = mesh.material as MeshStandardMaterial;
      let twin = twins.get(material);
      if (twin === undefined) {
        twin = depthPrepassMaterial(material);
        twins.set(material, twin);
        this.#prepassMaterials.push(twin);
      }
      this.#prepasses.push(depthPrepassOf(mesh, twin, mode));
    }
  }

  /**
   * The firs' depth pre-passes — #1523: drawn (the product), off (the owner's
   * page's `-fir-prepass`, and the browser gate's reference), or the EQUAL
   * test without them (the gate's control). @see DepthPrepassMode
   */
  setDepthPrepass(mode: DepthPrepassMode): void {
    this.#prepassMode = mode;
    for (const { prepass } of this.#prepasses) prepass.visible = mode === 'drawn';
  }

  /**
   * Each fir mesh's depth pre-pass — #1523.
   *
   * @test-facing held by `realistic-textures.test.ts` §"#1523", which reads
   * each pre-pass against its mesh; the renderer draws them as the meshes'
   * children
   */
  get depthPrepasses(): readonly DepthPrepass[] {
    return this.#prepasses;
  }

  /** Every mesh the belt draws with. For the tests and the harness. */
  get meshes(): readonly InstancedMesh[] {
    return this.#kinds.flatMap((each) => [
      ...each.near.flat(),
      ...each.middle.flatMap((meshes) => meshes ?? []),
      ...each.far.filter((mesh): mesh is InstancedMesh => mesh !== undefined),
    ]);
  }

  /**
   * Each tree kind's meshes by level — the full, the middle and the impostor —
   * for `three-renderer.test.ts`, which asserts which level an item was
   * submitted at.
   *
   * @test-facing held by `three-renderer.test.ts` §"#617", which reads which
   * levels one item was submitted at; the renderer draws `meshes`
   */
  levelsOf(kind: RealisticVegetationKind): {
    readonly full: readonly (readonly InstancedMesh[])[];
    readonly middle: readonly (readonly InstancedMesh[] | undefined)[];
    readonly impostor: readonly (InstancedMesh | undefined)[];
  } {
    const each = this.#kinds.find((slot) => slot.kind === kind);
    return { full: each?.near ?? [], middle: each?.middle ?? [], impostor: each?.far ?? [] };
  }

  addTo(scene: Scene): void {
    for (const mesh of this.meshes) scene.add(mesh);
  }

  /**
   * Draws the foliage in its #619 order, or — the browser gate's and the
   * owner's page's control — puts every mesh back at 0, where three draws it
   * in the order its materials were made. @see FOLIAGE_RENDER_ORDER
   */
  setFoliageOrdered(on: boolean): void {
    for (const each of this.#kinds) {
      const levels = [
        ['near', each.near.flat()],
        ['middle', each.middle.flatMap((meshes) => meshes ?? [])],
        ['impostor', each.far.filter((mesh): mesh is InstancedMesh => mesh !== undefined)],
      ] as const;
      for (const [level, meshes] of levels) {
        for (const mesh of meshes) mesh.renderOrder = on ? foliageRenderOrder(mesh, level) : 0;
      }
    }
    // #1523: a pre-pass keeps its place just ahead of its mesh either way.
    for (const { full, prepass } of this.#prepasses) {
      prepass.renderOrder = full.renderOrder - DEPTH_PREPASS_LEAD;
    }
  }

  /** Hides every mesh, for a frame drawn in the stylised world. */
  setShown(on: boolean): void {
    this.#shown = on;
    if (!on) {
      for (const mesh of this.meshes) mesh.visible = false;
      // Nothing is drawn meanwhile, so nothing is mid-way anywhere after.
      this.#handOver.reset();
    }
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
   * What it admits is then drawn by this belt's own rule: the trees at their
   * levels, the nearest shrubs and rocks as meshes and the rest not at all. So
   * it is a ceiling on what is drawn, never a count of it. Allocates nothing.
   */
  setBudget(items: number): void {
    this.#budget = items;
  }

  /**
   * How many scenery items the last frame drew — at any level, one per item
   * however many parts its shape has and whether or not it is in a hand-over.
   *
   * @test-facing held by `realistic-renderer.test.ts` and, through
   * `sceneryDrawnOf`, by the browser gate: what a rung's budget is checked
   * against
   */
  get drawnItems(): number {
    return this.#drawn;
  }

  /**
   * Where, in plan, every instance the last frame submitted stands — at every
   * level, the impostors included, read back out of the instanced meshes.
   *
   * @test-facing reached through `realisticVegetationPlacesOf` by the browser
   * gate, which holds what was drawn off every settlement's ground (#1534)
   */
  places(): readonly { readonly kind: RealisticVegetationKind; x: number; z: number }[] {
    const found: { kind: RealisticVegetationKind; x: number; z: number }[] = [];
    for (const slot of this.#kinds) {
      const meshes = [
        ...slot.near.flat(),
        ...slot.middle.flatMap((each) => each ?? []),
        ...slot.far.filter((mesh): mesh is InstancedMesh => mesh !== undefined),
      ];
      for (const mesh of meshes) {
        if (!mesh.visible) continue;
        mesh.updateMatrixWorld();
        for (let index = 0; index < mesh.count; index += 1) {
          mesh.getMatrixAt(index, this.#matrix);
          this.#matrix.premultiply(mesh.matrixWorld);
          this.#position.setFromMatrixPosition(this.#matrix);
          found.push({ kind: slot.kind, x: this.#position.x, z: this.#position.z });
        }
      }
    }
    return found;
  }

  /** This frame's vegetation: the trees at their levels, the nearest shrubs and rocks as meshes. */
  update(items: readonly ScatterItem[], pose: CameraPose): void {
    this.#drawn = 0;
    this.grounded.count = 0;
    if (!this.#shown) return;
    this.#trees.count = 0;
    for (const each of this.#kinds) {
      each.ranking.count = 0;
      for (const meshes of each.near) for (const mesh of meshes) mesh.count = 0;
      for (const meshes of each.middle) for (const mesh of meshes ?? []) mesh.count = 0;
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
    // Pass 1: the nearest of each ranking, by distance from the rider — a tree
    // only if the camera can see it (#617's review), unless the levels are the
    // control that ranks as before it.
    if (this.#seen.length < end) this.#seen = new Uint8Array(end);
    const visibleOnly = this.#levels.rankOnly === 'visible';
    for (let index = 0; index < end; index += 1) {
      const item = items[index] as ScatterItem;
      const each = this.#slotFor(item);
      this.#seen[index] = 0;
      if (each === undefined || !inView(item, pose)) continue;
      if (each.tree && each.shapes.length > 0 && visibleOnly) {
        const variant = variantOf(item.variant, each.shapes.length);
        const shape = each.shapes[variant] as RealisticShape;
        const reach = each.reach[variant];
        const size = (each.fit * item.scale) / shape.extent;
        const radius = (reach?.across ?? 0) * size;
        if (!treeCanBeSeen(item, pose, radius, (reach?.up ?? 0) * size)) continue;
      }
      this.#seen[index] = 1;
      rankInto(each.ranking, index, Math.hypot(item.x - pose.x, item.z - pose.z));
    }
    // Where each tree is going, and where it is drawn this frame. @see TreeHandOver
    const order = this.#trees;
    const handOver = this.#handOver;
    handOver.begin();
    for (let rank = 0; rank < order.count; rank += 1) {
      const item = items[order.chosen[rank] ?? 0] as ScatterItem;
      const level = treeLevelAt(rank, this.#levels);
      const fade =
        level === 'full-middle' || level === 'middle-impostor'
          ? bandFade(rank, order.distances, order.count)
          : 0;
      this.#rankEntry[rank] = handOver.aim(
        item.x,
        item.z,
        lowBound(level, fade),
        highBound(level, fade),
      );
    }
    for (let index = 0; index < end; index += 1) {
      if (this.#seen[index] !== 1 || rankOf(order, index) < order.count) continue;
      const item = items[index] as ScatterItem;
      if (this.#slotFor(item)?.tree === true) handOver.carry(item.x, item.z);
    }
    handOver.settle();
    // Pass 2: every item into the meshes of the levels it is drawn at.
    for (let index = 0; index < end; index += 1) {
      const item = items[index] as ScatterItem;
      const each = this.#slotFor(item);
      if (each === undefined || each.shapes.length === 0 || !inView(item, pose)) continue;
      const variant = variantOf(item.variant, each.shapes.length);
      const shape = each.shapes[variant] as RealisticShape;
      const rank = rankOf(each.ranking, index);
      const size = (each.fit * item.scale) / shape.extent;
      this.#position.set(item.x, item.y, item.z);
      this.#quaternion.setFromAxisAngle(this.#up, item.rotation);
      this.#scale.setScalar(size);
      this.#matrix.compose(this.#position, this.#quaternion, this.#scale);
      // #621: one tint for every level the item is drawn at this frame.
      this.#tint = packedInstanceTint(item.x, item.z, realisticTints[each.tint]);
      let drawn = false;
      // #620: whether any of it was drawn as a MESH, rather than as its impostor.
      let asMesh: boolean;
      if (!each.tree) {
        if (rank < each.ranking.count) drawn = this.#put(each.near[variant], 0, 1);
        asMesh = drawn;
      } else {
        // A tree with no entry — out of the camera's view, or beyond the ranks
        // and not walking out of them — is its impostor.
        const entry =
          rank < order.count
            ? (this.#rankEntry[rank] ?? -1)
            : this.#seen[index] === 1
              ? handOver.find(item.x, item.z)
              : -1;
        const low = entry < 0 ? 1 : handOver.low(entry);
        const high = entry < 0 ? 1 : handOver.high(entry);
        const middle = each.middle[variant];
        const impostor = each.far[variant];
        // The impostor keeps [0, low), the middle level [low, high) and the
        // full mesh [high, 1). A tree with no middle level — a fixture, or a
        // pack that shipped none — is drawn at its impostor where the middle
        // level would be.
        if (high < 1) drawn = this.#put(each.near[variant], high, 1);
        asMesh = drawn;
        if (middle === undefined) {
          if (high > 0) drawn = this.#putOne(impostor, 0, high) || drawn;
        } else {
          if (high > low) {
            const middleDrawn = this.#put(middle, low, high);
            asMesh = asMesh || middleDrawn;
            drawn = middleDrawn || drawn;
          }
          if (low > 0) drawn = this.#putOne(impostor, 0, low) || drawn;
        }
      }
      if (drawn) this.#drawn += 1;
      // #620: a blob under what was drawn as a mesh — every shrub and rock
      // that was, and a tree ranked full or middle that was. Never under a
      // tree drawn only as its impostor, nor one in the middle-to-impostor
      // band. @see REALISTIC_GROUND_BLOBS
      const grounded = !each.tree || (rank < order.count && rank < this.#groundedTrees);
      // The furthest tree with a blob fades it as it nears the next tree back,
      // and is at nothing when the two stand level — which is where they swap
      // ranks, so no blob appears or vanishes in one frame. #617's hand-over
      // measured it: the blob popping on at that rank was a one-frame change
      // half as large again as the tree's own dithered one.
      const strength =
        each.tree && rank === this.#groundedTrees - 1
          ? 1 - bandFade(rank, order.distances, order.count)
          : 1;
      if (asMesh && grounded && strength > 0) {
        this.#ground(item, each.footprint[variant], size, strength);
      }
    }
    for (const mesh of this.meshes) {
      if (mesh.count > 0) {
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor !== null) mesh.instanceColor.needsUpdate = true;
      }
      mesh.visible = mesh.count > 0;
    }
  }

  /** One caster into {@link grounded}, if it has room. */
  #ground(
    item: ScatterItem,
    footprint: { readonly radius: number; readonly height: number } | undefined,
    size: number,
    strength: number,
  ): void {
    const list = this.grounded;
    const caster = list.casters[list.count];
    if (caster === undefined || footprint === undefined) return;
    caster.x = item.x;
    caster.y = item.y;
    caster.z = item.z;
    caster.yaw = 0;
    caster.round = true;
    caster.halfAlong = footprint.radius * size;
    caster.halfAcross = footprint.radius * size;
    caster.centreAlong = 0;
    caster.height = footprint.height * size;
    caster.strength = strength;
    list.count += 1;
  }

  /** This frame's matrix into every part of one level, keeping `[from, to)` of the dither. */
  #put(meshes: readonly InstancedMesh[] | undefined, from: number, to: number): boolean {
    if (meshes === undefined || meshes.length === 0) return false;
    for (const mesh of meshes) this.#putOne(mesh, from, to);
    return true;
  }

  /** This frame's matrix into one mesh, keeping `[from, to)`, if it has room. */
  #putOne(mesh: InstancedMesh | undefined, from: number, to: number): boolean {
    if (mesh === undefined) return false;
    const capacity = mesh.instanceMatrix.count;
    if (mesh.count >= capacity) return false;
    mesh.setMatrixAt(mesh.count, this.#matrix);
    if (mesh.instanceColor !== null) {
      const channels = mesh.instanceColor.array as Float32Array;
      writeInterval(channels, mesh.count, from, to);
      channels[mesh.count * 3 + 2] = this.#tint;
    }
    mesh.count += 1;
    return true;
  }

  /** Releases the belt's own buffers. The shapes are the loaded world's and outlive it. */
  dispose(): void {
    for (const mesh of this.meshes) mesh.dispose();
    for (const { prepass } of this.#prepasses) prepass.dispose();
    for (const material of this.#prepassMaterials) material.dispose();
    this.#quad.dispose();
  }

  #slotFor(item: ScatterItem): VegetationSlot | undefined {
    if (!isRealisticVegetation(item.kind)) return undefined;
    return this.#kinds.find((each) => each.kind === item.kind);
  }
}

/** The nearest items of one ranking, best first. @see rankInto */
interface Ranking {
  /** The items' indices in the frame, and their distances from the rider. */
  readonly chosen: Int32Array;
  readonly distances: Float64Array;
  count: number;
}

function ranking(capacity: number): Ranking {
  return {
    chosen: new Int32Array(capacity),
    distances: new Float64Array(capacity),
    count: 0,
  };
}

/** Where item `index` is in a ranking, or its count if it is not ranked. */
function rankOf(order: Ranking, index: number): number {
  for (let slot = 0; slot < order.count; slot += 1) {
    if (order.chosen[slot] === index) return slot;
  }
  return order.count;
}

/** Insertion into a sorted list of at most its capacity, dropping the furthest. */
function rankInto(order: Ranking, index: number, distance: number): void {
  const cap = order.chosen.length;
  if (cap === 0) return;
  if (order.count === cap && distance >= (order.distances[cap - 1] ?? Infinity)) return;
  let at = Math.min(order.count, cap - 1);
  while (at > 0 && (order.distances[at - 1] ?? 0) > distance) {
    order.distances[at] = order.distances[at - 1] ?? 0;
    order.chosen[at] = order.chosen[at - 1] ?? 0;
    at -= 1;
  }
  order.distances[at] = distance;
  order.chosen[at] = index;
  order.count = Math.min(cap, order.count + 1);
}

/** One realistic kind's meshes and the ranking it is drawn by. @see RealisticVegetationBelt */
interface VegetationSlot {
  readonly kind: RealisticVegetationKind;
  /** Whether it has levels and an impostor — the two tree kinds. */
  readonly tree: boolean;
  readonly shapes: readonly RealisticShape[];
  /** Per shape, one instanced mesh per part: the full level. */
  readonly near: readonly (readonly InstancedMesh[])[];
  /** Per shape, one instanced mesh per middle part, for a tree with a middle level. */
  readonly middle: readonly (readonly InstancedMesh[] | undefined)[];
  /** Per shape, its impostor, for a tree. */
  readonly far: readonly (InstancedMesh | undefined)[];
  /** Both tree kinds share one; a shrub's and a rock's are their own. */
  readonly ranking: Ranking;
  /** Which of #621's bounds its tints are drawn inside: a rock's is masonry's. */
  readonly tint: RealisticTintClass;
  readonly fit: number;
  /** Per shape, how far it reaches from its trunk and above its base, in its own units. @see treeCanBeSeen */
  readonly reach: readonly { readonly across: number; readonly up: number }[];
  /** Per shape, the ground it covers and how tall it is, in its own units. @see groundFootprint */
  readonly footprint: readonly { readonly radius: number; readonly height: number }[];
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
 *
 * ## `worn` — the tablet's cost pair for the wear, #1523
 *
 * `false` builds the road WITHOUT the wear's shader: no wheel track, no dust,
 * no patch loop, no roughness or relief from the track — and nothing in
 * {@link ROAD_WEAR}, so no frame writes patches for it either. That is the
 * road before #628 and #879. ⚠️ Not {@link roadWearOf}'s switch, which zeroes
 * the wear's uniforms and leaves every fragment running the loop. Only the
 * owner's page passes `false` (`realistic/config.ts` §`LEVERS`, `road-wear`);
 * the product always draws the wear.
 *
 * ## `bounded` — what the wear costs a fragment, #1523
 *
 * `true`, the product: a fragment runs the patch loop only on a triangle a
 * patch can reach (`road-wear.ts` §`writeRoadPatchReach`, read as a `flat`
 * varying), tests only those patches, and draws the paint's fading noise only
 * where there is paint. Every term it skips added exactly nought, so the
 * picture is the one `false` draws. `false` is the wear as #628 and #879 drew
 * it — all eight patches and the noise on every road fragment: the browser
 * gate's reference and the owner's `-surface-bounds` before/after pair.
 */
export function photographicRoadMaterial(
  colour: Texture,
  normal: Texture,
  worn = true,
  bounded = true,
): MeshStandardMaterial {
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
  const wear = {
    patches: new Float32Array(MAXIMUM_ROAD_PATCHES * ROAD_PATCH_FLOATS),
    on: 1,
    colour: 1,
    bounded,
  };
  if (worn) ROAD_WEAR.set(material, wear);
  material.onBeforeCompile = (shader) => {
    shader.uniforms['tileMetres'] = { value: REALISTIC_SURFACES.road.tileMetres };
    if (worn) {
      // #628: the patches lying in this frame's corridor, and the switch the
      // browser gate's control turns off. The SAME objects every compile, so a
      // program compiled again still reads what `#updateRoad` writes.
      shader.uniforms['roadPatches'] = { value: wear.patches };
      shader.uniforms['roadWear'] = {
        get value(): number {
          return wear.on;
        },
      };
      // #879: the colour terms alone, for the browser gate's surface-only read.
      shader.uniforms['roadWearColour'] = {
        get value(): number {
          return wear.colour;
        },
      };
    }
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>\nuniform float tileMetres;\n${worn ? roadWearVertexPars(bounded) : ''}`,
      )
      .replace(
        '#include <uv_vertex>',
        `#include <uv_vertex>\n${PLANAR_UV}\n${worn ? roadWearVertex(bounded) : ''}`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>\n${worn ? `${DETAIL_COMMON}\n${roadWearFragmentPars(bounded)}` : ''}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>\n${worn ? roadWearFragment(bounded) : ''}`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>\n${worn ? `roughnessFactor *= mix(1.0, ${glslFloat(WHEEL_TRACK_ROUGHNESS)}, oylTrackShare);` : ''}`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>\n${worn ? `normal = normalize(mix(normal, nonPerturbedNormal, ${glslFloat(1 - WHEEL_TRACK_RELIEF)} * oylTrackShare));` : ''}`,
      )
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
  material.customProgramCacheKey = () =>
    worn
      ? bounded
        ? 'oyl-photographic-road-worn'
        : 'oyl-photographic-road-worn-unbounded'
      : 'oyl-photographic-road';
  // #619 lever 2 and #622's air, chained after the assignment above.
  return withAtmosphere(withTextureLodBias(material));
}

/**
 * What each photographic road material wears — #628: the patches in this
 * frame's corridor (world-space rectangles, `road-wear.ts`
 * §`roadPatchUniforms`) and whether wear is drawn at all. Keyed by material
 * because a view builds its own road material with its drawing.
 */
const ROAD_WEAR = new WeakMap<
  Material,
  {
    readonly patches: Float32Array;
    on: number;
    colour: number;
    /** #1523: whether the shader reads {@link ROAD_REACH_ATTRIBUTE}. */
    readonly bounded: boolean;
  }
>();

/** The road's across-position attribute's name — #628. @see writeRoadAcross */
const ROAD_ACROSS_ATTRIBUTE = 'oylAcross';

/** Which patches can reach a vertex's triangles — #1523. @see writeRoadPatchReach */
const ROAD_REACH_ATTRIBUTE = 'oylPatchReach';

function roadWearVertexPars(bounded: boolean): string {
  return /* glsl */ `
attribute float ${ROAD_ACROSS_ATTRIBUTE};
varying float vRoadAcross;
varying vec2 vRoadWorld;
${bounded ? `attribute float ${ROAD_REACH_ATTRIBUTE};\nflat varying float vRoadReach;` : ''}
`;
}

function roadWearVertex(bounded: boolean): string {
  return /* glsl */ `
vRoadAcross = ${ROAD_ACROSS_ATTRIBUTE};
vRoadWorld = (modelMatrix * vec4(position, 1.0)).xz;
${bounded ? `vRoadReach = ${ROAD_REACH_ATTRIBUTE};` : ''}
`;
}

function roadWearFragmentPars(bounded: boolean): string {
  return /* glsl */ `
uniform vec4 roadPatches[${String(MAXIMUM_ROAD_PATCHES * 2)}];
uniform float roadWear;
uniform float roadWearColour;
varying float vRoadAcross;
varying vec2 vRoadWorld;
${bounded ? 'flat varying float vRoadReach;' : ''}
`;
}

/**
 * The wear — #628, after `color_fragment`, so the vertex colour is known: a
 * fragment whose vertex colour is paint (`terrain.ts` §`MARKING_COLOUR`, far
 * brighter than any tint) has its paint worn; everything else is carriageway,
 * whose every term together is clamped to `road-wear.ts`
 * §`MAXIMUM_WEAR_SHARE` — the arithmetic that keeps the gradient cue.
 * `oylTrackShare` is read again by the roughness and the normal below it.
 */
function roadWearFragment(bounded: boolean): string {
  // One patch's term — the same text bounded or not, so a patch the bound
  // keeps is added exactly as it was.
  const patch = /* glsl */ `
    vec4 oylPlace = roadPatches[oylAt * 2];
    vec4 oylSize = roadPatches[oylAt * 2 + 1];
    vec2 oylFrom = vRoadWorld - oylPlace.xy;
    float oylAlong = abs(dot(oylFrom, oylPlace.zw));
    float oylAcross = abs(dot(oylFrom, vec2(-oylPlace.w, oylPlace.z)));
    float oylInside = (1.0 - smoothstep(oylSize.x - 0.08, oylSize.x, oylAlong))
      * (1.0 - smoothstep(oylSize.y - 0.08, oylSize.y, oylAcross));
    oylWorn += oylSize.z * oylInside * step(0.0001, oylSize.x) * roadWear;`;
  const loop = bounded
    ? /* glsl */ `
  // #1523: only the patches that can reach this triangle, and on a triangle
  // none can, no loop. @see writeRoadPatchReach
  int oylReach = int(vRoadReach + 0.5);
  if (oylReach != 0) {
    for (int oylAt = 0; oylAt < ${String(MAXIMUM_ROAD_PATCHES)}; oylAt += 1) {
      if ((oylReach & (1 << oylAt)) == 0) continue;
${patch}
    }
  }`
    : /* glsl */ `
  for (int oylAt = 0; oylAt < ${String(MAXIMUM_ROAD_PATCHES)}; oylAt += 1) {
${patch}
  }`;
  const faded = /* glsl */ `1.0 - ${glslFloat(PAINT_WEAR)} * roadWear * roadWearColour
    * smoothstep(0.35, 0.85, oylNoise(vRoadWorld * 0.13) * 0.7 + oylNoise(vRoadWorld * 1.7) * 0.3)`;
  // #1523: the noise only where there is paint — elsewhere `mix` takes none
  // of it, so it is exactly the carriageway either way.
  const fading = bounded
    ? `float oylFaded = 1.0;\n  if (oylPaint > 0.0) oylFaded = ${faded};`
    : `float oylFaded = ${faded};`;
  return /* glsl */ `
float oylTrackShare = 0.0;
{
  float oylTrack = 0.0;
${WHEEL_TRACK_OFFSETS_METRES.map(
  (offset) =>
    `  oylTrack = max(oylTrack, 1.0 - smoothstep(${glslFloat(WHEEL_TRACK_HALF_WIDTH_METRES)}, ${glslFloat(WHEEL_TRACK_HALF_WIDTH_METRES + WHEEL_TRACK_EDGE_METRES)}, abs(vRoadAcross - (${glslFloat(offset)}))));`,
).join('\n')}
  oylTrack *= roadWear;
  float oylWorn = ${glslFloat(WHEEL_TRACK_LIGHTEN)} * oylTrack;
  oylWorn += ${glslFloat(DUST_LIGHTEN)} * roadWear
    * smoothstep(${glslFloat(CARRIAGEWAY_HALF_METRES - DUST_BAND_METRES)}, ${glslFloat(CARRIAGEWAY_HALF_METRES)}, abs(vRoadAcross));
${loop}
  float oylCarriageway = 1.0 + roadWearColour * clamp(oylWorn, ${glslFloat(-MAXIMUM_WEAR_SHARE)}, ${glslFloat(MAXIMUM_WEAR_SHARE)});
  float oylPaint = smoothstep(0.35, 0.55, dot(vColor.rgb, vec3(0.2126, 0.7152, 0.0722)));
  ${fading}
  diffuseColor.rgb *= mix(oylCarriageway, oylFaded, oylPaint);
  oylTrackShare = oylTrack * (1.0 - oylPaint);
}
`;
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
 * The two surfaces the realistic ground blends into, and where the tree line
 * is — #627. Absent in a world a test built without them, which draws the
 * grass everywhere as before. @see photographicGroundMaterial
 */
interface GroundBlendMaps {
  readonly verge?: { readonly colour: Texture; readonly normal: Texture };
  readonly rock?: { readonly colour: Texture; readonly normal: Texture };
  /**
   * The bare rock a steep bank wears — #1274. `rock` wore the banks too until
   * then, and keeps the scree.
   */
  readonly crag?: { readonly colour: Texture; readonly normal: Texture };
  /** `landform.ts` §`TerrainMesh.treeLine`, written by `TerrainBelt.update`. */
  readonly treeLine: { value: number };
}

/**
 * A tree line no ground reaches, until a frame says where it is: finite,
 * because a shader handed an infinity for a `smoothstep` edge divides nothing
 * by nothing.
 */
const NO_TREE_LINE = 1e9;

/**
 * Each ground material's blend switches — #627: verge, rock and scree, each 1
 * in the product and 0 in the browser gate's control; and since #1274 a
 * fourth, how much of a steep bank's rock is the crag's photograph rather than
 * the scree's. @see groundBlendOf
 */
const GROUND_BLEND_SHARES = new WeakMap<Material, Vector4>();

const GROUND_BLEND_VERTEX_PARS = /* glsl */ `
varying vec3 vOylGround;
varying float vOylGroundUp;
`;

/** World position and the ground normal's vertical, before any map perturbs it. */
const GROUND_BLEND_VERTEX = /* glsl */ `
vOylGround = (modelMatrix * vec4(position, 1.0)).xyz;
vOylGroundUp = normalize(mat3(modelMatrix) * normal).y;
`;

/**
 * The blend's shares, its samplers, and the normal map as the blend reads it.
 *
 * ⚠️ **Branched, so the two new surfaces cost nothing where they are not**
 * (#627's cost ceiling): each is sampled only where its share is above zero,
 * with `textureGrad` and derivatives taken OUTSIDE the branch — an implicit
 * derivative inside non-uniform control flow is undefined in GLSL — and scaled
 * by the rung's LOD bias as `withTextureLodBias` would have (#619 lever 2).
 * The grass is sampled everywhere, as before.
 *
 * ⚠️ **#1523: the derivatives are taken ONCE, bounded** — each surface's
 * pair where the shares are, which the normal then reads rather than taking
 * the same three pairs again: six derivatives where there were twelve.
 * Unbounded — the browser gate's reference — is the twelve as #627 and #1274
 * took them. @see groundDerivatives
 */
function groundBlendFragmentPars(bounded: boolean): string {
  return /* glsl */ `
uniform sampler2D vergeMap;
uniform sampler2D vergeNormalMap;
uniform sampler2D rockMap;
uniform sampler2D rockNormalMap;
uniform sampler2D cragMap;
uniform sampler2D cragNormalMap;
uniform float treeLine;
uniform vec4 groundShares;
varying vec3 vOylGround;
varying float vOylGroundUp;
float oylVergeShare = 0.0;
float oylRockShare = 0.0;
float oylCragShare = 0.0;
vec3 oylVergeTexel = vec3(1.0);
vec3 oylRockTexel = vec3(1.0);
vec3 oylCragTexel = vec3(1.0);
vec3 oylGroundWorld = vec3(1.0);
${bounded ? GROUND_DERIVATIVE_GLOBALS : ''}
vec2 oylVergeUv() { return vOylGround.xz / ${glslFloat(REALISTIC_SURFACES.verge.tileMetres)}; }
vec2 oylRockUv() { return vOylGround.xz / ${glslFloat(REALISTIC_SURFACES.rock.tileMetres)}; }
vec2 oylCragUv() { return vOylGround.xz / ${glslFloat(REALISTIC_SURFACES.crag.tileMetres)}; }
vec3 oylGroundNormal(vec2 grassUv) {
  vec3 grass = texture2D(normalMap, grassUv).xyz;
${groundDerivatives(bounded, false)}
  vec3 texel = grass;
  if (oylVergeShare > 0.0) {
    texel = mix(texel, textureGrad(vergeNormalMap, vergeUv, vergeDx, vergeDy).xyz, oylVergeShare);
  }
  // #1274: the stone is the scree's map and the crag's, each by its own share.
  float oylScreeShare = oylRockShare - oylCragShare;
  vec3 stone = vec3(0.0);
  if (oylScreeShare > 0.0) {
    stone += textureGrad(rockNormalMap, rockUv, rockDx, rockDy).xyz * oylScreeShare;
  }
  if (oylCragShare > 0.0) {
    stone += textureGrad(cragNormalMap, cragUv, cragDx, cragDy).xyz * oylCragShare;
  }
  return texel * (1.0 - oylRockShare) + stone;
}
`;
}

/** The surfaces' coordinates' names, and the functions that give them. */
const GROUND_BLEND_SURFACES = [
  ['verge', 'oylVergeUv', 'oylVerge'],
  ['rock', 'oylRockUv', 'oylRock'],
  ['crag', 'oylCragUv', 'oylCrag'],
] as const;

/** Where the shares leave each surface's derivative pair for the normal — #1523. */
const GROUND_DERIVATIVE_GLOBALS = GROUND_BLEND_SURFACES.map(
  ([, , global]) => `vec2 ${global}Dx = vec2(0.0);\nvec2 ${global}Dy = vec2(0.0);`,
).join('\n');

/**
 * Each surface's coordinates and derivatives, for {@link groundBlendFragmentPars}.
 * Bounded, the shares (`first`) take each surface's pair — outside any branch,
 * by the very expression they always used, so the pair is the same to the
 * bit — and leave it in {@link GROUND_DERIVATIVE_GLOBALS}, which the normal
 * reads instead of taking its own. Unbounded, each reader takes its own, as
 * before #1523.
 */
function groundDerivatives(bounded: boolean, first: boolean): string {
  const taken = !bounded || first;
  const lines = taken ? ['float oylBias = exp2(oylTextureLodBias);'] : [];
  for (const [name, uv, global] of GROUND_BLEND_SURFACES) {
    lines.push(`vec2 ${name}Uv = ${uv}();`);
    if (taken) {
      lines.push(`vec2 ${name}Dx = dFdx(${name}Uv) * oylBias;`);
      lines.push(`vec2 ${name}Dy = dFdy(${name}Uv) * oylBias;`);
    }
    if (bounded && first) {
      lines.push(`${global}Dx = ${name}Dx;`);
      lines.push(`${global}Dy = ${name}Dy;`);
    }
    if (bounded && !first) {
      lines.push(`vec2 ${name}Dx = ${global}Dx;`);
      lines.push(`vec2 ${name}Dy = ${global}Dy;`);
    }
  }
  const indent = first ? '    ' : '  ';
  return lines.map((line) => `${indent}${line}`).join('\n');
}

/**
 * The shares, and the two surfaces' colours — inside the ground's map block,
 * before the grass multiplies the world's colour in, so each surface is ITS
 * photograph over its own mean times the world's colour (#627: the world's
 * per-route colour still leads).
 */
function groundBlendShares(bounded: boolean): string {
  return /* glsl */ `
  oylGroundWorld = diffuseColor.rgb;
  float oylFromEdge = abs(vFields.y) - ${glslFloat(ROAD_EDGE_METRES)};
  float oylVerge = (1.0 - smoothstep(${glslFloat(VERGE_BLEND_METRES[0])}, ${glslFloat(VERGE_BLEND_METRES[1])}, oylFromEdge)) * groundShares.x;
  // The slope, as the cosine the normal's vertical already is: steeper is a
  // SMALLER cosine, so the step runs from the steep end's cosine to the gentle one's.
  float oylRock = (1.0 - smoothstep(${glslFloat(Math.cos((ROCK_SLOPE_DEGREES[1] * Math.PI) / 180))}, ${glslFloat(Math.cos((ROCK_SLOPE_DEGREES[0] * Math.PI) / 180))}, vOylGroundUp)) * groundShares.y;
  float oylScree = smoothstep(treeLine - ${glslFloat(SCREE_BAND_METRES)}, treeLine + ${glslFloat(SCREE_BAND_METRES)}, vOylGround.y) * groundShares.z;
  oylRockShare = max(oylRock, oylScree);
  // #1274: of that stone, the slope's part is the crag — a rock face — and
  // what is left is the scree's loose stones. Never more than the stone there
  // is, because the slope's share is one of the two the stone is the larger of.
  oylCragShare = oylRock * groundShares.w;
  oylVergeShare = oylVerge * (1.0 - oylRockShare);
  {
${groundDerivatives(bounded, true)}
    if (oylVergeShare > 0.0) {
      oylVergeTexel = textureGrad(vergeMap, vergeUv, vergeDx, vergeDy).rgb
        / max(textureLod(vergeMap, vec2(0.5), 16.0).rgb, vec3(1e-3));
    }
    if (oylRockShare - oylCragShare > 0.0) {
      oylRockTexel = textureGrad(rockMap, rockUv, rockDx, rockDy).rgb
        / max(textureLod(rockMap, vec2(0.5), 16.0).rgb, vec3(1e-3));
    }
    if (oylCragShare > 0.0) {
      oylCragTexel = textureGrad(cragMap, cragUv, cragDx, cragDy).rgb
        / max(textureLod(cragMap, vec2(0.5), 16.0).rgb, vec3(1e-3));
    }
  }
`;
}

/** Mixed in over the grass and its patchwork, times the landform's own vertex colour. */
const GROUND_BLEND_MIX = /* glsl */ `
{
  float oylOther = oylVergeShare + oylRockShare;
  vec3 oylSurfaces = oylGroundWorld * vColor.rgb
    * (oylVergeTexel * oylVergeShare
      + oylRockTexel * (oylRockShare - oylCragShare)
      + oylCragTexel * oylCragShare);
  diffuseColor.rgb = diffuseColor.rgb * (1.0 - oylOther) + oylSurfaces;
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
export function photographicGroundMaterial(
  colour: Texture,
  normal: Texture,
  fieldSpan: { value: number },
  fieldCount: { value: number },
  blend: GroundBlendMaps = { treeLine: { value: NO_TREE_LINE } },
  /** #1523: the derivatives once (the product) or as before. @see groundBlendFragmentPars */
  bounded = true,
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
  // #627: the switches the browser gate's control turns — verge, rock, scree.
  // #1274: and the crag's share of a steep bank's stone, 1 in the product.
  const shares = new Vector4(1, 1, 1, 1);
  GROUND_BLEND_SHARES.set(material, shares);
  const blended = blend.verge !== undefined && blend.rock !== undefined && blend.crag !== undefined;
  material.onBeforeCompile = (shader) => {
    shader.uniforms['tileMetres'] = { value: REALISTIC_SURFACES.ground.tileMetres };
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>\nuniform float tileMetres;\n${blended ? GROUND_BLEND_VERTEX_PARS : ''}`,
      )
      .replace(
        '#include <uv_vertex>',
        `#include <uv_vertex>\n${PLANAR_UV}\n${blended ? GROUND_BLEND_VERTEX : ''}`,
      );
    if (blended) {
      shader.uniforms['vergeMap'] = { value: blend.verge?.colour };
      shader.uniforms['vergeNormalMap'] = { value: blend.verge?.normal };
      shader.uniforms['rockMap'] = { value: blend.rock?.colour };
      shader.uniforms['rockNormalMap'] = { value: blend.rock?.normal };
      shader.uniforms['cragMap'] = { value: blend.crag?.colour };
      shader.uniforms['cragNormalMap'] = { value: blend.crag?.normal };
      shader.uniforms['treeLine'] = blend.treeLine;
      shader.uniforms['groundShares'] = { value: shares };
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <normalmap_pars_fragment>',
          `#include <normalmap_pars_fragment>\n${groundBlendFragmentPars(bounded)}`,
        )
        .replace(
          '#include <normal_fragment_maps>',
          ShaderChunk.normal_fragment_maps.replace(
            'vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;',
            'vec3 mapN = oylGroundNormal( vNormalMapUv ) * 2.0 - 1.0;',
          ),
        )
        // After `color_fragment` AND #460's patchwork, which the surface detail
        // splices in directly after it: the verge and the rock are mixed in
        // over the patchwork, so the field pattern shows where the grass does.
        .replace(
          '#include <alphamap_fragment>',
          `${GROUND_BLEND_MIX}\n#include <alphamap_fragment>`,
        );
    }
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      /* glsl */ `
#ifdef USE_MAP
{
${blended ? groundBlendShares(bounded) : ''}
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
  material.customProgramCacheKey = () =>
    blended
      ? bounded
        ? 'oyl-photographic-ground-blended'
        : 'oyl-photographic-ground-blended-unbounded'
      : 'oyl-photographic-ground';
  // #460's patchwork, chained after the photograph rather than replacing it,
  // and #619 lever 2's bias after both.
  return withAtmosphere(
    withTextureLodBias(withSurfaceDetail(material, 'ground', fieldSpan, fieldCount)),
  );
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
 * ## Dressed — #623
 *
 * The body wears the On Your Left house kit and a skin: three maps the
 * pipeline draws and bakes onto its own texture coordinates
 * (`tools/realistic/blender/process_rider.py`), in ONE constructed material a
 * rider — {@link riderBodyMaterial}. The jersey's main colour is not in the
 * maps: it is each body's own kit uniform, set every frame from
 * {@link RIDER_KITS} — the rider's is `bicycle.ts` §`HOUSE_KIT`'s jersey, the
 * colour the stylised rider wears too, and the pacer's and the ghost's is
 * `PACER_KIT`'s blue. The tint still multiplies the whole body after it, and
 * it multiplies the kit THAT kind wears, so #368's three stay three: orange
 * times teal was a jersey whose green led its red (#742's review).
 *
 * The helmet and glasses are the file's own mesh since #623 — a plain shell
 * with vents and straps, and glasses, built round the head's own vertices and
 * coloured per vertex — carried on the head bone in the one instanced mesh the
 * sphere cap was, so they cost no draw call.
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
  /** The rubber's normal map, for {@link setTread}. */
  readonly #treadMap: Texture;
  /** The body's scale: its rest leg, stretched to `bicycle.ts`'s thigh and shin. */
  readonly #scale: number;
  readonly #joints = emptyRiderJoints();
  readonly #tint = new Color();
  readonly #matrix = new Matrix4();
  readonly #local = new Matrix4();
  readonly #helmetLocal = new Matrix4();
  /**
   * 1 while the kit is drawn in one colour, its own mean — the browser gate's
   * control. @see setKitPattern
   */
  readonly #kitPlain = { value: 0 };
  /** The kit each kind wears, the rider's their own choice. @see setRiderKit */
  #kits = RIDER_KITS;
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
  readonly #alongTheBicycle = new Vector3(0, 0, 1);
  readonly #roll = new Quaternion();
  readonly #unit = new Vector3(1, 1, 1);
  /** #625's scratch: the motion, the head held level, and a world turn. */
  readonly #motion = emptyRiderMotion();
  readonly #headHeld = new Quaternion();
  readonly #spin = new Quaternion();
  readonly #alongWorld = new Vector3();
  readonly #acrossWorld = new Vector3();
  #shown = true;

  constructor(body: Object3D, maps: RealisticBicycleMaps, dressed: RealisticRiderMaps) {
    // #623: the helmet and glasses are the file's own, coloured per vertex.
    const helmetMaterial = withAtmosphere(
      constructed(new MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0 })),
    );
    const helmetSource = helmetOf(body);
    // The rider, the pacer, the ghost, and #783's nearest remote riders. @see realisticRemoteSplit
    const riders = 3 + REALISTIC_REMOTE_RIDERS;
    const bicycle = realisticBicycleMeshes(maps, riders);
    this.#frame = bicycle.frame;
    this.#rubber = bicycle.rubber;
    this.#metal = bicycle.metal;
    this.#cranks = bicycle.cranks;
    this.#treadMap = maps.rubberNormal;
    const frameMaterial = bicycle.frame.material as MeshStandardMaterial;
    const rubberMaterial = bicycle.rubber.material as MeshStandardMaterial;
    const metalMaterial = bicycle.metal.material as MeshStandardMaterial;
    this.#helmets = tintable(helmetSource.geometry.clone(), helmetMaterial, riders);
    this.#materials = [frameMaterial, rubberMaterial, metalMaterial, helmetMaterial];
    for (const mesh of [this.#frame, this.#rubber, this.#metal, this.#cranks, this.#helmets]) {
      this.#group.add(mesh);
    }

    let scale = 1;
    for (let slot = 0; slot < riders; slot += 1) {
      const holder = cloneSkinned(body);
      // The clone's own helmet is dropped: the instanced one is drawn instead.
      const ownHelmet = helmetOf(holder);
      let skinned: SkinnedMesh | undefined;
      holder.traverse((node) => {
        if ((node as Partial<SkinnedMesh>).isSkinnedMesh === true) skinned = node as SkinnedMesh;
      });
      if (skinned === undefined) throw new Error('the rider model holds no skinned mesh');
      const source = skinned.material as Material;
      const kit = { value: new Color(RIDER_KITS.rider.jersey) };
      const material = riderBodyMaterial(dressed, kit, this.#kitPlain);
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
      if (slot === 0) {
        // Where the helmet sits on the head bone, read off the file's rest
        // pose at the body's scale — never a number typed here.
        root.updateMatrixWorld(true);
        this.#helmetLocal
          .copy(boneOf(bones, 'head').matrixWorld)
          .invert()
          .multiply(ownHelmet.matrixWorld);
      }
      ownHelmet.removeFromParent();
      root.visible = false;
      this.#group.add(root);
      const ordered = skinned.skeleton.bones;
      this.#riders.push({
        root,
        body: skinned,
        material,
        kit,
        bones,
        ordered,
        restQuaternions: ordered.map((bone) => bone.quaternion.clone()),
        restPositions: ordered.map((bone) => bone.position.clone()),
        angle: 0,
      });
    }
    this.#scale = scale;
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

  /**
   * Whether the body wears the kit's pattern, or one colour — the kit's own
   * mean, from `realistic-assets.ts` §`REALISTIC_RIDER_KIT_MEAN` — everywhere.
   * #623's control. @see riderKitOf
   */
  setKitPattern(on: boolean): void {
    this.#kitPlain.value = on ? 0 : 1;
  }

  /** The helmet and glasses' one instanced mesh. For the tests. */
  get helmets(): InstancedMesh {
    return this.#helmets;
  }

  /**
   * The rider and bicycle seen from the side, with the cranks level — #626's
   * silhouette, made from THIS belt's own body, posed by this belt's own
   * `#pose`, and the bicycle's own meshes, so the shadow is the shape that is
   * drawn. Made once, when a view builds its realistic world; it poses slot 0
   * at the origin and leaves it hidden, so it must run before a frame is
   * placed, which `RealisticDrawing`'s constructor is.
   */
  silhouette(): RiderSilhouette {
    const level: RiderMarker = {
      kind: 'rider',
      x: 0,
      y: 0,
      z: 0,
      headingX: 0,
      headingZ: 1,
      lean: 0,
      bodyLean: 0,
      pedalling: 0,
      rideSeconds: 0,
      crankAngle: Math.PI / 2,
    };
    this.#placeOne(0, level);
    const rider = this.#riders[0] as RealisticRiderSlot;
    rider.root.updateMatrixWorld(true);
    const corners: number[] = [];
    const vertex = new Vector3();
    const pushed = (geometry: BufferGeometry, at: (index: number) => Vector3): void => {
      const index = geometry.index;
      const count = index === null ? geometry.getAttribute('position').count : index.count;
      for (let corner = 0; corner < count; corner += 1) {
        const point = at(index === null ? corner : index.getX(corner));
        corners.push(point.x, point.y, point.z);
      }
    };
    // The body, skinned where this pose put it, into the bicycle's frame —
    // which is the world's here: the belt's group has no parent yet.
    const body = rider.body;
    pushed(body.geometry, (index) =>
      body.getVertexPosition(index, vertex).applyMatrix4(body.matrixWorld),
    );
    // The bicycle's meshes, the crankset and the helmet, as slot 0 draws them.
    for (const mesh of [this.#frame, this.#rubber, this.#metal, this.#cranks, this.#helmets]) {
      mesh.getMatrixAt(0, this.#matrix);
      const at = mesh.geometry.getAttribute('position');
      pushed(mesh.geometry, (index) =>
        vertex.fromBufferAttribute(at, index).applyMatrix4(this.#matrix),
      );
    }
    rider.root.visible = false;
    return rasteriseSilhouette(new Float32Array(corners));
  }

  /**
   * The first drawn rider's shoulders — the middle of its two upper arms'
   * heads — in world space, written into `into`; `false` when none is drawn.
   * #625's browser gate. @see realisticShouldersOf
   */
  shouldersOf(into: { x: number; y: number; z: number }): boolean {
    const rider = this.#riders[0];
    if (rider === undefined || !rider.root.visible) return false;
    const left = boneOf(rider.bones, 'upperarm01.L').getWorldPosition(this.#a);
    const right = boneOf(rider.bones, 'upperarm01.R').getWorldPosition(this.#b);
    into.x = (left.x + right.x) / 2;
    into.y = (left.y + right.y) / 2;
    into.z = (left.z + right.z) / 2;
    return true;
  }

  /** Every rider's body. For the tests. */
  get bodies(): readonly SkinnedMesh[] {
    return this.#riders.map((rider) => rider.body);
  }

  /** Each body's kit colour, linear, as its shader reads it — #623. For the tests. */
  get kitColours(): readonly Color[] {
    return this.#riders.map((rider) => rider.kit.value);
  }

  /** Dresses the rider — and only the rider — in the kit they chose (#623). @see RiderBelt.setRiderKit */
  setRiderKit(kit: RiderKit): void {
    this.#kits = kitsWith(kit);
  }

  /** Whether the rubber wears its normal map — #624's control. @see bicycleTreadOf */
  setTread(on: boolean): void {
    const rubber = this.#rubber.material as MeshStandardMaterial;
    const wanted = on ? this.#treadMap : null;
    if (rubber.normalMap === wanted) return;
    rubber.normalMap = wanted;
    rubber.needsUpdate = true;
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
    // #499: the MakeHuman rider and its bicycle lean by the BICYCLE's lean
    // from this root; since #546 the body is then held back toward upright
    // against it through the shoulders (`#pose`). @see RiderBelt, where the
    // axis and sign are argued.
    rider.root.quaternion.multiply(this.#roll.setFromAxisAngle(this.#alongTheBicycle, marker.lean));
    // ⚠️ A frame that carries no angle HOLDS the one this rider had: no
    // cadence is no rotation, which is #349's rule and `advanceCrank`'s.
    rider.angle = marker.crankAngle ?? rider.angle;
    // #623: the kit this kind wears, under its tint. @see RIDER_KITS
    rider.kit.value.setHex(this.#kits[marker.kind].jersey);
    const tint = this.#tint.setHex(RIDER_TINTS[marker.kind]);
    rider.material.color.copy(tint);
    rider.root.updateMatrixWorld(true);
    // #625: how this rider moves on top of the joints — from the crank angle
    // it is drawn at, how much of the stroke is drawn, and the RIDE's clock.
    const motion = riderMotion(rider.angle, marker.pedalling, marker.rideSeconds, this.#motion);
    this.#pose(rider, rider.angle, marker.bodyLean, motion);
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

  /**
   * Aims one rider's bones at `bicycle.ts`'s joints for a crank angle, and
   * moves them by `motion` — #625.
   *
   * The motion is applied in the order that keeps what #369 and #546 fix:
   *
   * 1. The pelvis rolls about the bicycle's long axis BEFORE the hips are
   *    found, so the hips' middle is still put on the saddle and each leg's
   *    two-bone solve starts from the rolled hip — the feet stay on the pedals.
   *    (Each half about its own head; the two meet at the body's middle.)
   * 2. The back is aimed as before, at `bodyLean` (#546), and the head's world
   *    orientation read there. Then it is aimed again at the rocked and
   *    breathing back, and the HEAD is turned back to what it was: the
   *    shoulders move and the head stays level, looking up the road.
   * 3. The arms are solved from wherever the shoulders now are to the grips,
   *    so the hands stay on the bar: the arms absorb the rock.
   * 4. Each foot turns about the bicycle's `+X` at its own ankle, which is the
   *    point the shin is aimed at, so ankling moves no pedal.
   */
  #pose(
    rider: RealisticRiderSlot,
    crankAngle: number,
    bodyLean: number,
    motion: RiderMotion,
  ): void {
    for (let index = 0; index < rider.ordered.length; index += 1) {
      const bone = rider.ordered[index] as Bone;
      bone.quaternion.copy(rider.restQuaternions[index] as Quaternion);
      bone.position.copy(rider.restPositions[index] as Vector3);
    }
    rider.root.updateMatrixWorld(true);
    const along = this.#alongWorld.set(0, 0, 1).transformDirection(rider.root.matrixWorld);
    const across = this.#acrossWorld.set(1, 0, 0).transformDirection(rider.root.matrixWorld);
    const skeletonRoot = boneOf(rider.bones, 'root');
    // 1. #625: the pelvis rolls toward the downstroke — its two halves, and
    // not the skeleton's root, so the back and the head start from where they
    // would have with no motion and the head can be held exactly there (2).
    this.#turnInWorld(boneOf(rider.bones, 'pelvis.L'), along, motion.pelvisRoll);
    this.#turnInWorld(boneOf(rider.bones, 'pelvis.R'), along, motion.pelvisRoll);
    // #546: the shoulders held back toward upright against the bicycle; the
    // back is aimed at them below, so the MakeHuman body rolls about its hips.
    const joints = riderJoints(crankAngle, this.#joints, bodyLean);
    const toWorld = (point: JointPoint, into: Vector3): Vector3 =>
      into.set(point.x, point.y, point.z).applyMatrix4(rider.root.matrixWorld);
    // The whole body, moved so its hips sit on the saddle.
    const hips = boneOf(rider.bones, 'upperleg01.L')
      .getWorldPosition(this.#a)
      .add(boneOf(rider.bones, 'upperleg01.R').getWorldPosition(this.#b))
      .multiplyScalar(0.5);
    const shift = toWorld(joints.hips, this.#b).sub(hips);
    skeletonRoot.parent?.getWorldQuaternion(this.#parent);
    shift.applyQuaternion(this.#parent.invert()).divideScalar(this.#scale);
    skeletonRoot.position.add(shift);
    rider.root.updateMatrixWorld(true);
    // The back, from the hips towards the shoulders.
    toWorld(joints.shoulders, this.#c).sub(toWorld(joints.hips, this.#d));
    this.#aim(rider, 'spine05', 'neck01', this.#c);
    // 2. #625: the head as the unrocked back holds it, then the rock and the
    // breath, then the head put back — level, looking up the road.
    const head = boneOf(rider.bones, 'head');
    head.getWorldQuaternion(this.#headHeld);
    if (motion.trunkRoll !== 0 || motion.trunkPitch !== 0) {
      riderJoints(crankAngle, this.#joints, bodyLean + motion.trunkRoll);
      toWorld(joints.shoulders, this.#c).sub(toWorld(joints.hips, this.#d));
      this.#c.applyQuaternion(this.#spin.setFromAxisAngle(across, motion.trunkPitch));
      this.#aim(rider, 'spine05', 'neck01', this.#c);
      this.#parent.identity();
      head.parent?.getWorldQuaternion(this.#parent);
      head.quaternion.copy(this.#parent.invert().multiply(this.#headHeld));
      head.updateMatrixWorld(true);
    }
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
      // 4. #625: ankling. A toe lifted is a turn of MINUS the dorsiflexion
      // about `+X`, which takes `+Z` toward `−Y`.
      this.#turnInWorld(boneOf(rider.bones, `foot.${suffix}`), across, -motion.ankle[index]);
    }
  }

  /**
   * Turns `bone` by `angle` about `axis`, both in world space, and updates it
   * and everything under it — #625. Nothing at a zero angle. Allocates nothing.
   */
  #turnInWorld(bone: Bone, axis: Vector3, angle: number): void {
    if (angle === 0) return;
    bone.getWorldQuaternion(this.#world);
    this.#spin.setFromAxisAngle(axis, angle);
    this.#parent.identity();
    bone.parent?.getWorldQuaternion(this.#parent);
    bone.quaternion.copy(this.#parent.invert().multiply(this.#spin.multiply(this.#world)));
    bone.updateMatrixWorld(true);
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
  /** This body's kit colour, linear — #623. Set per frame from {@link RIDER_KITS}. */
  readonly kit: { value: Color };
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

/**
 * The realistic bicycle's four maps, as loaded — #624. @see REALISTIC_BICYCLE_MAPS
 */
export type RealisticBicycleMaps = Readonly<Record<RealisticBicycleMap, Texture>>;

/** The realistic rider's three maps, as loaded — #623. @see REALISTIC_RIDER_MAPS */
export type RealisticRiderMaps = Readonly<Record<RealisticRiderMap, Texture>>;

/**
 * The rider's helmet and glasses: the mesh the file carries beside the body,
 * named `helmet` by `process_rider.py` — #623.
 */
function helmetOf(scene: Object3D): Mesh {
  let helmet: Mesh | undefined;
  scene.traverse((node) => {
    if ((node as Partial<Mesh>).isMesh === true && node.name === 'helmet') helmet = node as Mesh;
  });
  if (helmet === undefined) throw new Error('the rider model holds no helmet');
  return helmet;
}

/**
 * The material a realistic rider's body wears — #623, ADR 0026 D-11:
 * constructed here, physically based, and one a rider.
 *
 * - `map` is the kit and the skin; `normalMap` the body's baked relief with
 *   the kit's seams and the riding pose's creases; `orm` is three's own
 *   channel order, so it is BOTH the `aoMap` (red) and the `roughnessMap`
 *   (green), with `roughness` at 1 so the map's value is the roughness.
 * - Its BLUE channel, which three does not read, is how much of the kit's
 *   main colour a texel is — a SHADE, premultiplied: the colour map is black
 *   there. The one line spliced after `map_fragment` ADDS `blue × kit × color`,
 *   where `kit` is the body's own kit uniform ({@link RIDER_KITS}) and `color` the #368
 *   tint, so the albedo is `(map + blue × kit) × tint`. ⚠️ Added rather than
 *   multiplied, because both maps are filtered: a white shade in the colour
 *   map times a 0/1 mask drew a pale halo half-way across every hem and cuff,
 *   which the browser gate's first picture of the kit showed.
 * - `plain` at 1 draws the whole body in one colour, the kit's mean under the
 *   same main colour (`REALISTIC_RIDER_KIT_MEAN`), still tinted — the browser
 *   gate's control for the pattern (#623).
 */
function riderBodyMaterial(
  maps: RealisticRiderMaps,
  kit: { value: Color },
  plain: { value: number },
): MeshStandardMaterial {
  const material = constructed(
    new MeshStandardMaterial({
      map: maps.colour,
      normalMap: maps.normal,
      aoMap: maps.orm,
      roughnessMap: maps.orm,
      roughness: 1,
      metalness: 0,
    }),
  );
  const mean = REALISTIC_RIDER_KIT_MEAN;
  const spliced = "#623's kit colour";
  material.onBeforeCompile = (shader) => {
    shader.uniforms['oylKitColour'] = kit;
    shader.uniforms['oylKitPlain'] = plain;
    shader.fragmentShader = replacedOrThrown(
      replacedOrThrown(
        shader.fragmentShader,
        '#include <common>',
        '#include <common>\nuniform vec3 oylKitColour;\nuniform float oylKitPlain;',
        'fragment',
        spliced,
      ),
      '#include <map_fragment>',
      /* glsl */ `#include <map_fragment>
#ifdef USE_ROUGHNESSMAP
diffuseColor.rgb += diffuse * oylKitColour * texture2D(roughnessMap, vRoughnessMapUv).b;
#endif
diffuseColor.rgb = mix(
  diffuseColor.rgb,
  diffuse * (vec3(${glslFloat(mean.unmasked[0])}, ${glslFloat(mean.unmasked[1])}, ${glslFloat(mean.unmasked[2])}) + ${glslFloat(mean.shade)} * oylKitColour),
  oylKitPlain
);`,
      'fragment',
      spliced,
    );
  };
  material.customProgramCacheKey = () => 'oyl-rider-kit';
  return withAtmosphere(material);
}

/**
 * The realistic vegetation belt, built from the loaded world as a view builds
 * it — #1283. `undefined` when no world is loaded.
 *
 * @test-facing `realistic-textures.test.ts` builds it from a real load of the
 * committed files — the generated trees, and the scans — and reads its
 * levels, materials, tints and ground blobs; a view builds its own in
 * `RealisticDrawing`
 */
export function realisticVegetationOfLoadedWorld(): RealisticVegetationBelt | undefined {
  const world = realisticWorld;
  return world === undefined ? undefined : new RealisticVegetationBelt(world.vegetation);
}

/**
 * The three realistic riders, built from the loaded world as a view builds
 * them — #623. `undefined` when no world is loaded.
 *
 * @test-facing `realistic-textures.test.ts` builds them from a real load of
 * the committed files and reads their meshes, materials and tints; a view
 * builds its own in `RealisticDrawing`
 */
export function realisticRidersOfLoadedWorld(): RealisticRiderBelt | undefined {
  const world = realisticWorld;
  return world === undefined
    ? undefined
    : new RealisticRiderBelt(world.body, world.bicycle, world.rider);
}

/**
 * The people — #1541 (`people.ts` places them, `gait.ts` moves them,
 * `people-body.ts` cuts and dresses their body). Two draw calls, whatever is
 * in view, and none where nobody is.
 *
 * ## The bodies: one instanced draw, animated by a texture
 *
 * The rider's MakeHuman body (already loaded, ADR 0026's admitted CC0 base
 * mesh) is cut to at most `people-body.ts` §`PERSON_MAX_TRIANGLES` by
 * `clusterDecimate` when the realistic world is built, and posed by its own
 * skeleton at `gait.ts` §`GAIT_PHASES` phases of a walk and of a run from
 * `gait.ts` §`gaitPose` — a parametric gait in code, the owner's ruling of
 * 2026-10-24 — with each phase's skinned positions and their normals baked
 * into ONE half-float texture ({@link PeopleBelt.animationBytes}, under
 * `people-body.ts` §`PERSON_ANIMATION_MAX_BYTES`). The vertex shader reads a
 * vertex's column at its instance's gait and phase, blending the two nearest
 * phases, so the GPU does no skinning and the sixteen bodies are one call.
 * Each phase is set on the ground by its lowest vertex, so the standing foot
 * is planted; a run's flight lifts it after.
 *
 * Each instance carries its own look (`people.ts` §`personLook`): skin, top,
 * bottoms, shoes and hair, as packed sRGB, chosen per vertex by the region
 * `people-body.ts` §`regionOf` gave it.
 *
 * ## The impostors: one more instanced draw
 *
 * Beyond `people.ts` §`PEOPLE_NEAR_METRES` a person is a quad turned to the
 * camera about the vertical, on which the fragment shader draws a figure —
 * head, trunk, legs and arms, in the same five colours — whose legs and arms
 * swing by the same `gaitPose` hip angle, read on the CPU, foreshortened by
 * how side-on the person is to the camera. No texture.
 *
 * Both materials are constructed here and breathe the realistic air (ADR
 * 0026 D-11, #622). Neither casts a shadow.
 */
export class PeopleBelt {
  readonly #group = new Group();
  readonly #bodies: InstancedMesh;
  readonly #impostors: InstancedMesh;
  readonly #animation: DataTexture;
  readonly #materials: readonly MeshStandardMaterial[];
  /** Per body: skin, top, bottoms, shoes — packed sRGB. */
  readonly #bodyLooks: InstancedBufferAttribute;
  /** Per body: gait index, phase, hair (packed), unused. */
  readonly #bodyMotion: InstancedBufferAttribute;
  readonly #farLooks: InstancedBufferAttribute;
  /** Per impostor: yaw, left hip, right hip, hair (packed). */
  readonly #farMotion: InstancedBufferAttribute;
  /** The body's triangles, as cut. */
  readonly triangles: number;
  /**
   * How far a body's clothes stand off it, and its skin, as baked — #1618:
   * the mean distance, at a unit height, between each vertex as the
   * animation texture holds it at the walk's first phase and the same vertex
   * posed bare. Skin moves only beside a hem. For the browser gate's read-back.
   */
  readonly standOff: { readonly clothes: number; readonly skin: number };
  readonly #matrix = new Matrix4();
  readonly #position = new Vector3();
  readonly #turn = new Quaternion();
  readonly #scale = new Vector3();
  readonly #up = new Vector3(0, 1, 0);
  #shown = true;
  #switchedOn = true;

  constructor(body: Object3D) {
    const baked = bakedPeople(body);
    this.triangles = baked.geometry.index === null ? 0 : baked.geometry.index.count / 3;
    this.standOff = baked.standOff;
    this.#animation = baked.animation;
    this.#bodyLooks = new InstancedBufferAttribute(new Float32Array(PEOPLE_NEAR_MAX * 4), 4);
    this.#bodyMotion = new InstancedBufferAttribute(new Float32Array(PEOPLE_NEAR_MAX * 4), 4);
    this.#bodyLooks.setUsage(DynamicDrawUsage);
    this.#bodyMotion.setUsage(DynamicDrawUsage);
    baked.geometry.setAttribute('oylLook', this.#bodyLooks);
    baked.geometry.setAttribute('oylMotion', this.#bodyMotion);
    const bodyMaterial = peopleBodyMaterial(this.#animation, baked.vertices);
    this.#bodies = new InstancedMesh(baked.geometry, bodyMaterial, PEOPLE_NEAR_MAX);
    this.#bodies.instanceMatrix.setUsage(DynamicDrawUsage);
    this.#bodies.count = 0;
    this.#bodies.frustumCulled = false;
    this.#bodies.visible = false;

    const quad = new PlaneGeometry(1, 1);
    // Feet at the instance's origin, the crown at its height.
    quad.translate(0, 0.5, 0);
    this.#farLooks = new InstancedBufferAttribute(new Float32Array(PEOPLE_FAR_MAX * 4), 4);
    this.#farMotion = new InstancedBufferAttribute(new Float32Array(PEOPLE_FAR_MAX * 4), 4);
    this.#farLooks.setUsage(DynamicDrawUsage);
    this.#farMotion.setUsage(DynamicDrawUsage);
    quad.setAttribute('oylLook', this.#farLooks);
    quad.setAttribute('oylMotion', this.#farMotion);
    const impostorMaterial = peopleImpostorMaterial();
    this.#impostors = new InstancedMesh(quad, impostorMaterial, PEOPLE_FAR_MAX);
    this.#impostors.instanceMatrix.setUsage(DynamicDrawUsage);
    this.#impostors.count = 0;
    this.#impostors.frustumCulled = false;
    this.#impostors.visible = false;
    this.#materials = [bodyMaterial, impostorMaterial];
    this.#group.add(this.#bodies, this.#impostors);
  }

  addTo(scene: Scene): void {
    scene.add(this.#group);
  }

  /** The bodies' mesh. For the browser gate's read-back. */
  get bodies(): InstancedMesh {
    return this.#bodies;
  }

  /** The impostors' mesh. For the browser gate's read-back. */
  get impostors(): InstancedMesh {
    return this.#impostors;
  }

  /** Every material the people wear. For the D-11 assertion. */
  get materials(): readonly Material[] {
    return this.#materials;
  }

  /** The animation texture's size in bytes: half-float RGBA. */
  get animationBytes(): number {
    return textureBytesOf(this.#animation);
  }

  /** Whether the realistic world draws at all — false while the stylised one does. */
  setShown(on: boolean): void {
    this.#shown = on;
    if (!on) {
      this.#bodies.visible = false;
      this.#impostors.visible = false;
    }
  }

  /** @see peopleShownOf */
  switchOn(on: boolean): void {
    this.#switchedOn = on;
  }

  /** This frame's people. */
  update(people: PeopleInView | undefined): void {
    const drawn = this.#shown && this.#switchedOn ? (people ?? NO_PEOPLE) : NO_PEOPLE;
    drawn.near.forEach((person, index) => {
      this.#place(this.#bodies, index, person, true);
      this.#bodyLooks.setXYZW(
        index,
        person.look.skin,
        person.look.top,
        person.look.bottoms,
        person.look.shoes,
      );
      this.#bodyMotion.setXYZW(index, gaitIndex(person.gait), person.phase, person.look.hair, 0);
    });
    drawn.far.forEach((person, index) => {
      this.#place(this.#impostors, index, person, false);
      this.#farLooks.setXYZW(
        index,
        person.look.skin,
        person.look.top,
        person.look.bottoms,
        person.look.shoes,
      );
      const pose = gaitPose(person.gait, person.phase);
      this.#farMotion.setXYZW(index, person.yaw, pose.left.hip, pose.right.hip, person.look.hair);
    });
    this.#bodies.count = drawn.near.length;
    this.#impostors.count = drawn.far.length;
    for (const attribute of [
      this.#bodies.instanceMatrix,
      this.#impostors.instanceMatrix,
      this.#bodyLooks,
      this.#bodyMotion,
      this.#farLooks,
      this.#farMotion,
    ]) {
      attribute.needsUpdate = true;
    }
    this.#bodies.visible = drawn.near.length > 0;
    this.#impostors.visible = drawn.far.length > 0;
  }

  /** One instance: at the person's feet, turned to face their way (a body only), their height tall. */
  #place(mesh: InstancedMesh, index: number, person: Person, turned: boolean): void {
    this.#position.set(person.x, person.y, person.z);
    this.#turn.setFromAxisAngle(this.#up, turned ? person.yaw : 0);
    this.#scale.setScalar(person.height);
    mesh.setMatrixAt(index, this.#matrix.compose(this.#position, this.#turn, this.#scale));
  }

  dispose(): void {
    this.#bodies.geometry.dispose();
    this.#impostors.geometry.dispose();
    this.#animation.dispose();
    for (const material of this.#materials) material.dispose();
  }
}

/** A half-float RGBA texture's size in bytes. */
function textureBytesOf(texture: DataTexture): number {
  const { width, height } = texture.image;
  return width * height * ANIMATION_BYTES_PER_TEXEL;
}

/** The body cut, dressed and baked: its geometry, its animation texture, and how many vertices. */
interface BakedPeople {
  readonly geometry: BufferGeometry;
  readonly animation: DataTexture;
  readonly vertices: number;
  /** @see PeopleBelt.standOff */
  readonly standOff: { readonly clothes: number; readonly skin: number };
}

/** A bone turned about a WORLD axis through its own joint, by `angle`. */
function turnBoneInWorld(bone: Bone, axis: Vector3, angle: number): void {
  const turn = new Quaternion().setFromAxisAngle(axis, angle);
  const world = bone.getWorldQuaternion(new Quaternion());
  const parent = new Quaternion();
  bone.parent?.getWorldQuaternion(parent);
  bone.quaternion.copy(parent.invert().multiply(turn.multiply(world)));
  bone.updateMatrixWorld(true);
}

/**
 * The rider's body cut to a person's, dressed by region, and posed at every
 * phase of both gaits into the animation texture — #1541. @see PeopleBelt
 */
function bakedPeople(body: Object3D): BakedPeople {
  const holder = cloneSkinned(body);
  let skinned: SkinnedMesh | undefined;
  holder.traverse((node) => {
    if ((node as Partial<SkinnedMesh>).isSkinnedMesh === true) skinned = node as SkinnedMesh;
  });
  if (skinned === undefined) throw new Error('the rider model holds no skinned mesh');
  const mesh: SkinnedMesh = skinned;
  holder.updateMatrixWorld(true);
  const source = mesh.geometry;
  const position = source.getAttribute('position');
  const skinIndex = source.getAttribute('skinIndex');
  const skinWeight = source.getAttribute('skinWeight');
  const index = source.index;
  if (index === null) throw new Error('the rider model’s body is not indexed');
  const vertexCount = position.count;
  const positions = new Float32Array(vertexCount * 3);
  const dominant = new Uint16Array(vertexCount);
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    positions[vertex * 3] = position.getX(vertex);
    positions[vertex * 3 + 1] = position.getY(vertex);
    positions[vertex * 3 + 2] = position.getZ(vertex);
    let best = 0;
    for (let slot = 1; slot < 4; slot += 1) {
      if (skinWeight.getComponent(vertex, slot) > skinWeight.getComponent(vertex, best)) {
        best = slot;
      }
    }
    dominant[vertex] = skinIndex.getComponent(vertex, best);
  }
  const indices = new Uint32Array(index.count);
  for (let at = 0; at < index.count; at += 1) indices[at] = index.getX(at);
  const cut = clusterDecimate(positions, indices, dominant, PERSON_MAX_TRIANGLES);
  const kept = cut.kept.length;

  const bones = new Map<string, Bone>();
  for (const bone of mesh.skeleton.bones) bones.set(bone.name, bone);
  const local = (name: string): Vector3 =>
    mesh.worldToLocal(boneOf(bones, name).getWorldPosition(new Vector3()));
  let lowest = Number.POSITIVE_INFINITY;
  let highest = Number.NEGATIVE_INFINITY;
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    lowest = Math.min(lowest, positions[vertex * 3 + 1] as number);
    highest = Math.max(highest, positions[vertex * 3 + 1] as number);
  }
  const restHeight = highest - lowest;
  const head = local('head');
  const landmarks = {
    waistY: local('spine04').y,
    headY: head.y,
    headZ: head.z,
    crownY: highest,
  };

  // Each kept vertex's region, then the body dressed by face — #1618: a
  // seam's vertex drawn once a region, all its copies one column of the
  // texture, and how far each column's clothes stand off the body.
  const regions = new Uint8Array(kept);
  const plain = new Float32Array(kept * 3);
  for (let vertex = 0; vertex < kept; vertex += 1) {
    const from = cut.kept[vertex] as number;
    const bone = mesh.skeleton.bones[dominant[from] as number];
    regions[vertex] = regionOf(
      bone?.name ?? '',
      positions[from * 3 + 1] as number,
      positions[from * 3 + 2] as number,
      landmarks,
    );
    plain[vertex * 3] = positions[from * 3] as number;
    plain[vertex * 3 + 1] = positions[from * 3 + 1] as number;
    plain[vertex * 3 + 2] = positions[from * 3 + 2] as number;
  }
  const dress = dressed(cut.indices, regions);
  // The clothes stood off along the rest body's own normals, in the body's
  // units, BEFORE it is posed: so they bend with the joint they are on.
  const restNormals = vertexNormals(plain, cut.indices);
  const clothed = new Float32Array(kept * 3);
  for (let vertex = 0; vertex < kept; vertex += 1) {
    const out = (dress.standOff[vertex] as number) * restHeight;
    for (let axis = 0; axis < 3; axis += 1) {
      clothed[vertex * 3 + axis] =
        (plain[vertex * 3 + axis] as number) + (restNormals[vertex * 3 + axis] as number) * out;
    }
  }

  // The geometry the instances share: each drawn vertex's column, its region,
  // and its rest place at unit height (for the bounds only — the shader reads
  // the texture).
  const drawn = dress.column.length;
  const rest = new Float32Array(drawn * 3);
  const normal = new Float32Array(drawn * 3);
  const column = new Float32Array(drawn);
  const region = new Float32Array(drawn);
  for (let vertex = 0; vertex < drawn; vertex += 1) {
    const of = dress.column[vertex] as number;
    rest[vertex * 3] = (clothed[of * 3] as number) / restHeight;
    rest[vertex * 3 + 1] = ((clothed[of * 3 + 1] as number) - lowest) / restHeight;
    rest[vertex * 3 + 2] = (clothed[of * 3 + 2] as number) / restHeight;
    for (let axis = 0; axis < 3; axis += 1) {
      normal[vertex * 3 + axis] = restNormals[of * 3 + axis] as number;
    }
    column[vertex] = of;
    region[vertex] = dress.region[vertex] as number;
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(rest, 3));
  geometry.setAttribute('oylVertex', new BufferAttribute(column, 1));
  geometry.setAttribute('oylRegion', new BufferAttribute(region, 1));
  // ⚠️ A `normal` attribute, though the shader reads the texture's normal
  // rows instead: a standard material over a geometry with none is compiled
  // FLAT_SHADED by three, whose fragment then takes each triangle's own normal
  // from screen derivatives and never reads the smooth one the vertex wrote.
  // That is the faceted face and clothes the owner saw on PR #1615 (#1541).
  geometry.setAttribute('normal', new BufferAttribute(normal, 3));
  geometry.setIndex(new BufferAttribute(dress.indices, 1));
  geometry.computeBoundingSphere();

  // The poses, baked.
  const ordered = mesh.skeleton.bones;
  const restQuaternions = ordered.map((bone) => bone.quaternion.clone());
  const restPositions = ordered.map((bone) => bone.position.clone());
  const across = new Vector3(1, 0, 0);
  const forward = new Vector3(0, 0, 1);
  const up = new Vector3(0, 1, 0);
  // How far the rest pose holds each arm out from the side, measured — never typed.
  const abduction = (side: 'L' | 'R'): number => {
    const shoulder = local(`upperarm01.${side}`);
    const elbow = local(`lowerarm01.${side}`);
    return Math.atan2(Math.abs(elbow.x - shoulder.x), shoulder.y - elbow.y);
  };
  // And how bent the rest pose holds the elbow.
  const restElbow = (side: 'L' | 'R'): number => {
    const shoulder = local(`upperarm01.${side}`);
    const elbow = local(`lowerarm01.${side}`);
    const wrist = local(`wrist.${side}`);
    return elbow.clone().sub(shoulder).angleTo(wrist.clone().sub(elbow));
  };
  const held = { L: abduction('L'), R: abduction('R') };
  const bent = { L: restElbow('L'), R: restElbow('R') };
  // The arms hang this far out from the side when walking.
  const hang = (8 * Math.PI) / 180;
  const width = kept;
  const height = ANIMATION_ROWS;
  const data = new Uint16Array(width * height * 4);
  const scratch = new Vector3();
  const posed = new Float32Array(kept * 3);
  const standOff = { clothes: 0, skin: 0 };
  GAITS.forEach((gait, gaitAt) => {
    for (let phase = 0; phase < GAIT_PHASES; phase += 1) {
      ordered.forEach((bone, at) => {
        bone.quaternion.copy(restQuaternions[at] as Quaternion);
        bone.position.copy(restPositions[at] as Vector3);
      });
      holder.updateMatrixWorld(true);
      const pose = gaitPose(gait, phase / GAIT_PHASES);
      for (const [side, limb, sign] of [
        ['L', pose.left, -1],
        ['R', pose.right, 1],
      ] as const) {
        // The arm down to the side, swung, and its elbow bent.
        turnBoneInWorld(boneOf(bones, `upperarm01.${side}`), forward, sign * (held[side] - hang));
        turnBoneInWorld(boneOf(bones, `upperarm01.${side}`), across, -limb.shoulder);
        turnBoneInWorld(boneOf(bones, `lowerarm01.${side}`), across, bent[side] - limb.elbow);
        // The leg: hip, knee and ankle, in the body's own sagittal plane.
        turnBoneInWorld(boneOf(bones, `upperleg01.${side}`), across, -limb.hip);
        turnBoneInWorld(boneOf(bones, `lowerleg01.${side}`), across, limb.knee);
        turnBoneInWorld(boneOf(bones, `foot.${side}`), across, -limb.ankle);
      }
      // The trunk leans, the head is held level, and the pelvis turns under
      // shoulders that stay square.
      turnBoneInWorld(boneOf(bones, 'spine05'), across, pose.lean);
      turnBoneInWorld(boneOf(bones, 'neck01'), across, -pose.lean);
      turnBoneInWorld(boneOf(bones, 'root'), up, -pose.pelvisTurn);
      turnBoneInWorld(boneOf(bones, 'spine05'), up, pose.pelvisTurn);
      holder.updateMatrixWorld(true);
      let floor = Number.POSITIVE_INFINITY;
      for (let vertex = 0; vertex < kept; vertex += 1) {
        const from = cut.kept[vertex] as number;
        // #1618: the clothed body, posed by the source vertex's own weights.
        scratch.set(
          clothed[vertex * 3] as number,
          clothed[vertex * 3 + 1] as number,
          clothed[vertex * 3 + 2],
        );
        mesh.applyBoneTransform(from, scratch);
        posed[vertex * 3] = scratch.x / restHeight;
        posed[vertex * 3 + 1] = scratch.y / restHeight;
        posed[vertex * 3 + 2] = scratch.z / restHeight;
        floor = Math.min(floor, posed[vertex * 3 + 1] as number);
      }
      // Planted on the ground, and a run's flight above it.
      const lift = pose.lift / 1.75 - floor;
      for (let vertex = 0; vertex < kept; vertex += 1) {
        posed[vertex * 3 + 1] = (posed[vertex * 3 + 1] as number) + lift;
      }
      const normals = vertexNormals(posed, cut.indices);
      const row = animationRow(gaitAt, phase);
      for (let vertex = 0; vertex < kept; vertex += 1) {
        const at = (row * width + vertex) * 4;
        const normalAt = ((row + ANIMATION_ROWS / 2) * width + vertex) * 4;
        for (let axis = 0; axis < 3; axis += 1) {
          data[at + axis] = DataUtils.toHalfFloat(posed[vertex * 3 + axis] as number);
          data[normalAt + axis] = DataUtils.toHalfFloat(normals[vertex * 3 + axis] as number);
        }
        data[at + 3] = DataUtils.toHalfFloat(1);
        data[normalAt + 3] = DataUtils.toHalfFloat(0);
      }
      // #1618: at the walk's first phase, how far the baked clothes stand off
      // the same body posed bare — read back out of the texture's own
      // half floats, by region.
      if (gaitAt === 0 && phase === 0) {
        const at = row * width;
        const sums = { clothes: 0, skin: 0 };
        const counts = { clothes: 0, skin: 0 };
        for (let vertex = 0; vertex < kept; vertex += 1) {
          const kind = regions[vertex] as number;
          const into =
            kind === PersonRegion.skin
              ? 'skin'
              : kind === PersonRegion.hair
                ? undefined
                : 'clothes';
          if (into === undefined) continue;
          scratch.set(
            plain[vertex * 3] as number,
            plain[vertex * 3 + 1] as number,
            plain[vertex * 3 + 2],
          );
          mesh.applyBoneTransform(cut.kept[vertex] as number, scratch);
          const texel = (at + vertex) * 4;
          sums[into] += Math.hypot(
            DataUtils.fromHalfFloat(data[texel] as number) - scratch.x / restHeight,
            DataUtils.fromHalfFloat(data[texel + 1] as number) - lift - scratch.y / restHeight,
            DataUtils.fromHalfFloat(data[texel + 2] as number) - scratch.z / restHeight,
          );
          counts[into] += 1;
        }
        standOff.clothes = counts.clothes === 0 ? 0 : sums.clothes / counts.clothes;
        standOff.skin = counts.skin === 0 ? 0 : sums.skin / counts.skin;
      }
    }
  });
  const animation = new DataTexture(data, width, height, RGBAFormat, HalfFloatType);
  animation.minFilter = NearestFilter;
  animation.magFilter = NearestFilter;
  animation.generateMipmaps = false;
  animation.needsUpdate = true;
  return { geometry, animation, vertices: kept, standOff };
}

/** Packed sRGB `0xRRGGBB` in a float, to linear RGB — the GLSL both people materials share. */
const PEOPLE_UNPACK = /* glsl */ `
vec3 oylUnpack(float packed) {
  float r = floor(packed / 65536.0);
  float g = floor((packed - r * 65536.0) / 256.0);
  float b = packed - r * 65536.0 - g * 256.0;
  vec3 c = vec3(r, g, b) / 255.0;
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c));
}
`;

/**
 * The bodies' material — #1541: physically based, its positions and normals
 * read from the animation texture at the instance's gait and phase, its
 * colour the instance's for the vertex's region. @see PeopleBelt
 */
function peopleBodyMaterial(animation: DataTexture, vertices: number): MeshStandardMaterial {
  const material = constructed(
    new MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0 }),
  );
  const spliced = "#1541's people";
  material.onBeforeCompile = (shader) => {
    shader.uniforms['oylAnimation'] = { value: animation };
    shader.vertexShader = replacedOrThrown(
      replacedOrThrown(
        replacedOrThrown(
          shader.vertexShader,
          '#include <common>',
          /* glsl */ `#include <common>
uniform highp sampler2D oylAnimation;
attribute float oylVertex;
attribute float oylRegion;
attribute vec4 oylLook;
attribute vec4 oylMotion;
varying vec3 vOylColour;
${PEOPLE_UNPACK}`,
          'vertex',
          spliced,
        ),
        '#include <beginnormal_vertex>',
        /* glsl */ `
float oylAt = oylMotion.y * ${glslFloat(GAIT_PHASES)};
float oylLow = floor(oylAt);
float oylBlend = oylAt - oylLow;
int oylBase = int(oylMotion.x + 0.5) * ${String(GAIT_PHASES)};
int oylRowA = oylBase + int(oylLow) % ${String(GAIT_PHASES)};
int oylRowB = oylBase + (int(oylLow) + 1) % ${String(GAIT_PHASES)};
int oylColumn = int(oylVertex + 0.5);
vec3 objectNormal = normalize(mix(
  texelFetch(oylAnimation, ivec2(oylColumn, oylRowA + ${String(ANIMATION_ROWS / 2)}), 0).xyz,
  texelFetch(oylAnimation, ivec2(oylColumn, oylRowB + ${String(ANIMATION_ROWS / 2)}), 0).xyz,
  oylBlend));
#ifdef USE_TANGENT
  vec3 objectTangent = vec3(1.0, 0.0, 0.0);
#endif
vOylColour = oylRegion < 0.5 ? oylUnpack(oylLook.x)
  : oylRegion < 1.5 ? oylUnpack(oylLook.y)
  : oylRegion < 2.5 ? oylUnpack(oylLook.z)
  : oylRegion < 3.5 ? oylUnpack(oylLook.w)
  : oylUnpack(oylMotion.z);`,
        'vertex',
        spliced,
      ),
      '#include <begin_vertex>',
      /* glsl */ `vec3 transformed = mix(
  texelFetch(oylAnimation, ivec2(oylColumn, oylRowA), 0).xyz,
  texelFetch(oylAnimation, ivec2(oylColumn, oylRowB), 0).xyz,
  oylBlend);`,
      'vertex',
      spliced,
    );
    shader.fragmentShader = replacedOrThrown(
      replacedOrThrown(
        shader.fragmentShader,
        '#include <common>',
        '#include <common>\nvarying vec3 vOylColour;',
        'fragment',
        spliced,
      ),
      '#include <color_fragment>',
      '#include <color_fragment>\ndiffuseColor.rgb *= vOylColour;',
      'fragment',
      spliced,
    );
  };
  material.customProgramCacheKey = () => `oyl-people-${String(vertices)}`;
  return withAtmosphere(material);
}

/**
 * The impostors' material — #1541: a quad turned to the camera about the
 * vertical, on which the fragment draws a figure from capsules and a circle
 * in the instance's colours, its legs and arms swung by the instance's hip
 * angles and foreshortened by how side-on it stands. @see PeopleBelt
 */
function peopleImpostorMaterial(): MeshStandardMaterial {
  const material = constructed(
    new MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0 }),
  );
  const spliced = "#1541's people far off";
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = replacedOrThrown(
      replacedOrThrown(
        replacedOrThrown(
          shader.vertexShader,
          '#include <common>',
          /* glsl */ `#include <common>
attribute vec4 oylLook;
attribute vec4 oylMotion;
varying vec2 vOylQuad;
varying float vOylSide;
varying vec2 vOylHips;
varying vec3 vOylSkin;
varying vec3 vOylTop;
varying vec3 vOylBottoms;
varying vec3 vOylShoes;
varying vec3 vOylHair;
${PEOPLE_UNPACK}`,
          'vertex',
          spliced,
        ),
        '#include <beginnormal_vertex>',
        /* glsl */ `
vec3 oylFeet = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
vec3 oylToCamera = cameraPosition - oylFeet;
oylToCamera.y = 0.0;
oylToCamera = length(oylToCamera) > 1e-4 ? normalize(oylToCamera) : vec3(0.0, 0.0, 1.0);
vec3 oylRight = vec3(oylToCamera.z, 0.0, -oylToCamera.x);
vec3 objectNormal = oylToCamera;
#ifdef USE_TANGENT
  vec3 objectTangent = oylRight;
#endif
vec3 oylFacing = vec3(sin(oylMotion.x), 0.0, cos(oylMotion.x));
vOylSide = dot(oylFacing, -oylRight);
vOylHips = oylMotion.yz;
vOylQuad = vec2(position.x, position.y);
vOylSkin = oylUnpack(oylLook.x);
vOylTop = oylUnpack(oylLook.y);
vOylBottoms = oylUnpack(oylLook.z);
vOylShoes = oylUnpack(oylLook.w);
vOylHair = oylUnpack(oylMotion.w);`,
        'vertex',
        spliced,
      ),
      '#include <begin_vertex>',
      'vec3 transformed = oylRight * position.x * 0.5 + vec3(0.0, position.y, 0.0);',
      'vertex',
      spliced,
    );
    shader.fragmentShader = replacedOrThrown(
      replacedOrThrown(
        shader.fragmentShader,
        '#include <common>',
        /* glsl */ `#include <common>
varying vec2 vOylQuad;
varying float vOylSide;
varying vec2 vOylHips;
varying vec3 vOylSkin;
varying vec3 vOylTop;
varying vec3 vOylBottoms;
varying vec3 vOylShoes;
varying vec3 vOylHair;
float oylCapsule(vec2 p, vec2 a, vec2 b, float r) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h) - r;
}`,
        'fragment',
        spliced,
      ),
      '#include <color_fragment>',
      /* glsl */ `#include <color_fragment>
{
  // In heights: the quad is half a height wide, feet at 0, crown at 1.
  vec2 p = vec2(vOylQuad.x * 0.5, vOylQuad.y);
  float side = abs(vOylSide);
  float facing = vOylSide >= 0.0 ? 1.0 : -1.0;
  float apart = 0.05 * (1.0 - side);
  vec2 hipL = vec2(-apart, 0.5);
  vec2 hipR = vec2(apart, 0.5);
  vec2 footL = hipL + 0.47 * vec2(sin(vOylHips.x) * side * facing, -cos(vOylHips.x));
  vec2 footR = hipR + 0.47 * vec2(sin(vOylHips.y) * side * facing, -cos(vOylHips.y));
  float shoulders = 0.13 * (1.0 - 0.5 * side);
  vec2 armL = vec2(-shoulders, 0.8);
  vec2 armR = vec2(shoulders, 0.8);
  vec2 handL = armL + 0.33 * vec2(-sin(vOylHips.x) * 0.6 * side * facing, -1.0);
  vec2 handR = armR + 0.33 * vec2(-sin(vOylHips.y) * 0.6 * side * facing, -1.0);
  float legs = min(oylCapsule(p, hipL, footL, 0.035), oylCapsule(p, hipR, footR, 0.035));
  float arms = min(oylCapsule(p, armL, handL, 0.026), oylCapsule(p, armR, handR, 0.026));
  vec2 trunk = abs(p - vec2(0.0, 0.66)) - vec2(0.11 * (1.0 - 0.35 * side), 0.16);
  float body = length(max(trunk, 0.0)) + min(max(trunk.x, trunk.y), 0.0) - 0.02;
  float head = length(p - vec2(0.0, 0.93)) - 0.06;
  if (min(min(legs, arms), min(body, head)) > 0.0) discard;
  vec3 colour = vOylBottoms;
  if (head <= 0.0) colour = p.y > 0.945 ? vOylHair : vOylSkin;
  else if (body <= 0.0) colour = vOylTop;
  else if (arms <= 0.0) colour = p.y > 0.62 ? vOylTop : vOylSkin;
  else if (p.y < 0.04) colour = vOylShoes;
  diffuseColor.rgb *= colour;
}`,
      'fragment',
      spliced,
    );
  };
  material.customProgramCacheKey = () => 'oyl-people-far';
  return withAtmosphere(material);
}

/**
 * Turns a view's people off, or on again — #1541. The browser gate's switch,
 * for the frame time and draw calls they cost; the product draws them on the
 * rung that asks for them (`quality.ts` §`QualitySettings.people`).
 *
 * @test-facing the browser gate's control switch, read by `game-harness.ts`
 */
export function peopleShownOf(view: GameView, on: boolean): void {
  if (view instanceof ThreeGameView) view.peopleShown(on);
}

/**
 * The fragment shader source the GPU was handed for every program the
 * people's bodies' material made — #1541, the owner's look of PR #1615, so
 * the browser gate can read whether three compiled them FLAT_SHADED: flat, a
 * body lights each triangle as a facet and never reads the baked smooth
 * normals (@see bakedPeople). Empty before any body is drawn.
 *
 * @test-facing read by `game-harness.ts` §`peopleProbe`
 */
export function peopleBodyFragmentsOf(view: GameView): readonly string[] {
  return view instanceof ThreeGameView ? view.peopleBodyFragments() : [];
}

/**
 * Where each person a view drew in its last frame stands — #1541: each
 * instance's feet, read back off the belt's two meshes, the bodies' and the
 * impostors', with its height. `undefined` where no realistic world is built.
 *
 * @test-facing read by `game-harness.ts`, which holds every one of them off
 * the carriageway
 */
export function peopleDrawnOf(view: GameView):
  | {
      readonly near: readonly { readonly x: number; readonly z: number; readonly height: number }[];
      readonly far: readonly { readonly x: number; readonly z: number; readonly height: number }[];
      readonly triangles: number;
      readonly animationBytes: number;
      /**
       * #1618: how many of a body's triangles have corners of two regions —
       * a colour faded across a triangle; nought where each seam is an edge.
       */
      readonly blendedTriangles: number;
      /** #1618: @see PeopleBelt.standOff */
      readonly standOff: { readonly clothes: number; readonly skin: number };
    }
  | undefined {
  const belt = view instanceof ThreeGameView ? view.people : undefined;
  if (belt === undefined) return undefined;
  const read = (mesh: InstancedMesh) => {
    if (!mesh.visible) return [];
    const matrix = new Matrix4();
    const at = new Vector3();
    const turn = new Quaternion();
    const scale = new Vector3();
    return [...Array(mesh.count).keys()].map((index) => {
      mesh.getMatrixAt(index, matrix);
      matrix.decompose(at, turn, scale);
      return { x: at.x, z: at.z, height: scale.y };
    });
  };
  const geometry = belt.bodies.geometry;
  const region = geometry.getAttribute('oylRegion');
  const index = geometry.index;
  let blendedTriangles = 0;
  if (index !== null) {
    for (let at = 0; at + 2 < index.count; at += 3) {
      const a = region.getX(index.getX(at));
      if (region.getX(index.getX(at + 1)) !== a || region.getX(index.getX(at + 2)) !== a) {
        blendedTriangles += 1;
      }
    }
  }
  return {
    near: read(belt.bodies),
    far: read(belt.impostors),
    triangles: belt.triangles,
    animationBytes: belt.animationBytes,
    blendedTriangles,
    standOff: belt.standOff,
  };
}

/**
 * The kit a view holds for the rider, and the one its stylised belt draws the
 * rider in — #623.
 *
 * @test-facing `kit-palette.test.ts` reads it to hold `ThreeGameView.setRiderKit`
 * to its belts in jsdom, where no realistic world can load; the browser gate
 * reads the realistic rider's back off the drawing buffer.
 */
export function riderKitsOf(
  view: GameView,
): { readonly held: RiderKit; readonly stylised: RiderKit } | undefined {
  return view instanceof ThreeGameView ? view.riderKits : undefined;
}

/**
 * The season a view holds — #1622. `season-wiring.test.tsx` reads it to hold
 * `ThreeGameView.setSeason` to what the product's renderer keeps, in jsdom,
 * and the demo's showcase (#1653, `demo/main.tsx`) publishes what it reads.
 */
export function seasonOf(view: GameView): Season | undefined {
  return view instanceof ThreeGameView ? view.season : undefined;
}

/**
 * Draws a view's realistic riders in their kit's pattern, or in one colour —
 * #623. The browser gate's control: with the pattern off, the rider's back
 * must read back flatter than the floor the kit is held above.
 *
 * @test-facing the browser gate's control switch, read by `game-harness.ts`;
 * the product always draws the pattern.
 */
export function riderKitOf(view: GameView, on: boolean): void {
  if (view instanceof ThreeGameView) view.riderKit(on);
}

/**
 * How strongly the bicycle's normal maps bend the light: **1**, as drawn.
 *
 * The maps are drawn from height fields in metres at the parts' own sizes
 * (`tools/realistic/draw-bicycle-maps.ts`), so a groove's walls already lean
 * as a 0.6 mm groove's do and there is nothing to exaggerate. The browser gate
 * holds the tyre's read-back between a floor and a ceiling
 * (`game.browser.spec.ts` §"#624"), so doubling this or halving it is red.
 */
const BICYCLE_NORMAL_SCALE = 1;

/**
 * The realistic bicycle's meshes — the paint, the rubber and the metal, and
 * the cranks in the metal — each wearing a material this file constructs
 * (ADR 0026 D-11), empty and tinted per instance for {@link RIDER_TINTS}.
 *
 * ## #624: surfaces on the same geometry, in the same three materials
 *
 * - **the paint** keeps its colour and metalness and takes its roughness from
 *   `paintRoughness` — a clear coat's gloss with a faint mottle. ⚠️ **Not
 *   `MeshPhysicalMaterial`**, whose clear-coat term is a second specular lobe
 *   on every fragment the frame covers; #616's row has not shown it free.
 * - **the rubber** takes `rubberNormal`: tread and sidewall on the tyres,
 *   tape on the bar, the flat bead under the saddle.
 * - **the metal** takes `metalNormal` and `metalRoughness`: teeth and chain on
 *   the chainring, the cassette on the rear hub, plain metal everywhere else
 *   at the roughness it had before, 0.3.
 *
 * No colour map: a per-instance tint multiplies the material's colour, and a
 * normal or roughness map touches neither, which is what keeps #368's three
 * bicycles apart exactly as before. The meshes are the three they were, so
 * the draw calls are too.
 */
export function realisticBicycleMeshes(
  maps: RealisticBicycleMaps,
  capacity: number,
): {
  readonly frame: InstancedMesh;
  readonly rubber: InstancedMesh;
  readonly metal: InstancedMesh;
  readonly cranks: InstancedMesh;
} {
  const bike = realisticBicycle();
  const bent = new Vector2(BICYCLE_NORMAL_SCALE, BICYCLE_NORMAL_SCALE);
  const frameMaterial = withAtmosphere(
    constructed(
      new MeshStandardMaterial({
        color: RIDER_PALETTE.frame,
        // The map holds the roughness itself; the factor multiplies it.
        roughness: 1,
        roughnessMap: maps.paintRoughness,
        metalness: 0.3,
      }),
    ),
  );
  const rubberMaterial = withAtmosphere(
    constructed(
      new MeshStandardMaterial({
        color: RIDER_PALETTE.tyre,
        roughness: 0.85,
        metalness: 0,
        normalMap: maps.rubberNormal,
        normalScale: bent,
      }),
    ),
  );
  const metalMaterial = withAtmosphere(
    constructed(
      new MeshStandardMaterial({
        color: 0xb8b8bc,
        roughness: 1,
        roughnessMap: maps.metalRoughness,
        metalness: 0.9,
        normalMap: maps.metalNormal,
        normalScale: bent.clone(),
      }),
    ),
  );
  return {
    frame: tintable(bike.frame, frameMaterial, capacity),
    rubber: tintable(bike.rubber, rubberMaterial, capacity),
    metal: tintable(bike.metal, metalMaterial, capacity),
    cranks: tintable(realisticCrankset(), metalMaterial, capacity),
  };
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
 * Rewrites a built part's texture coordinates, vertex by vertex, from what
 * three gave it and where the vertex is — #624. Called BEFORE the part is
 * turned and moved, so `x`, `y` and `z` are the part's own, and on a
 * primitive whose `uv` is three's: `u` along a torus's ring or round a
 * cylinder, `v` round a torus's section or up a cylinder.
 */
function withUvs(
  geometry: BufferGeometry,
  place: (u: number, v: number, x: number, y: number, z: number) => Uv,
): BufferGeometry {
  const uv = geometry.getAttribute('uv');
  const position = geometry.getAttribute('position');
  for (let at = 0; at < uv.count; at += 1) {
    const [u, v] = place(
      uv.getX(at),
      uv.getY(at),
      position.getX(at),
      position.getY(at),
      position.getZ(at),
    );
    uv.setXY(at, u, v);
  }
  return geometry;
}

/** Every vertex of a part at one point of a map: a part with nothing drawn on it. */
function uniformUv(geometry: BufferGeometry, at: Uv): BufferGeometry {
  return withUvs(geometry, () => at);
}

/**
 * The realistic bicycle: `bicycle.ts`'s parts, drawn round — frame, rubber
 * and metal, one merged geometry each.
 *
 * ## Texture coordinates — #624
 *
 * Every part carries a `uv`, made from the same numbers that build it:
 * `bicycle-surfaces.ts` says where on its material's map each kind of part
 * samples, and this gives each vertex its place — along a tyre by the fraction
 * of its circumference and round it by the fraction of its section, along a
 * taped bar or a painted tube in METRES of its own length, across the rear hub
 * by where the vertex is. Texture coordinates add no triangle: the counts
 * `realisticBicycleTriangles` reads are the ones #506 summed.
 */
function realisticBicycle(): {
  readonly frame: BufferGeometry;
  readonly rubber: BufferGeometry;
  readonly metal: BufferGeometry;
} {
  const frame: BufferGeometry[] = [];
  const rubber: BufferGeometry[] = [];
  const metal: BufferGeometry[] = [];
  for (const part of RIDER_BICYCLE_PARTS) {
    const solid = part.solid;
    if (solid.shape === 'ring') {
      // A wheel in the bicycle's YZ plane at its hub: tyre, rim, hub, spokes.
      const radius = solid.radius + solid.thickness;
      const tyre = solid.thickness;
      // #624: the tread's circumference, so the tyre carries a whole number of
      // tread tiles round it.
      const circumference = 2 * Math.PI * radius;
      rubber.push(
        withUvs(new TorusGeometry(radius - tyre, tyre, 10, 48), (u, v) =>
          tyreUv(u, v, circumference),
        )
          .rotateY(Math.PI / 2)
          .translate(0, part.y, part.z),
      );
      // The wheel the chain drives is the one behind the bottom bracket, and
      // its hub carries the cassette on the drive side, `+x`, where the
      // chainring is (`bicycle.ts` §`RIDER_CRANK_PARTS`).
      const driven = part.z < CRANK_AXIS_Z;
      const hub = new CylinderGeometry(HUB_RADIUS_METRES, HUB_RADIUS_METRES, HUB_WIDTH_METRES, 10);
      metal.push(
        uniformUv(new TorusGeometry(radius - tyre * 2.2, tyre * 0.45, 6, 48), PLAIN_METAL_UV)
          .rotateY(Math.PI / 2)
          .translate(0, part.y, part.z),
        (driven
          ? // A quarter turn about `+Z` takes the cylinder's `+y` to `−x`, so
            // across it from the far side to the drive side is `−y`.
            withUvs(hub, (u, _v, _x, y) => cassetteUv(u, 0.5 - y / HUB_WIDTH_METRES))
          : uniformUv(hub, PLAIN_METAL_UV)
        )
          .rotateZ(Math.PI / 2)
          .translate(0, part.y, part.z),
      );
      const spokes = 20;
      const length = radius - tyre * 2.2;
      for (let spoke = 0; spoke < spokes; spoke += 1) {
        metal.push(
          uniformUv(new CylinderGeometry(0.0015, 0.0015, length, 3), PLAIN_METAL_UV)
            .translate(0, length / 2, 0)
            .rotateX((spoke / spokes) * Math.PI * 2)
            .translate(spoke % 2 === 0 ? 0.02 : -0.02, part.y, part.z),
        );
      }
    } else if (solid.shape === 'tube') {
      const into = softly(part, frame, rubber);
      const length = solid.length;
      // three's cylinder: `u` round it, `v` up it from its foot.
      const uvs =
        into === rubber
          ? (u: number, v: number): Uv => tapeUv(v * length, u)
          : (u: number, v: number): Uv => paintUv(u, v * length);
      into.push(
        placedPart(
          withUvs(new CylinderGeometry(solid.radius, solid.radius, solid.length, 12), uvs),
          part,
        ),
      );
    } else if (solid.shape === 'bend') {
      // ⚠️ **The drops come from `bicycle.ts` since #369, and a reviewer who
      // remembers a `TorusGeometry(0.07, 0.012, 8, 16, Math.PI)` written out
      // here is reading the old file.** They were four literals in this
      // function while the hands were placed from two more in `bicycle.ts`,
      // which is why the two never met.
      const into = softly(part, frame, rubber);
      const arc = solid.radius * solid.sweep;
      // three's torus: `u` along the arc, `v` round its section.
      const uvs =
        into === rubber
          ? (u: number, v: number): Uv => tapeUv(u * arc, v)
          : (u: number, v: number): Uv => paintUv(v, u * arc);
      into.push(
        placedPart(
          withUvs(
            new TorusGeometry(solid.radius, solid.thickness, 8, 16, solid.sweep),
            uvs,
          ).rotateZ(solid.start),
          part,
        ),
      );
    } else if (solid.shape === 'box') {
      // The saddle: nothing drawn on it, so the rubber's flat bead.
      const into = softly(part, frame, rubber);
      into.push(
        placedPart(
          uniformUv(
            new BoxGeometry(solid.width * 0.8, solid.height, solid.depth),
            into === rubber ? PLAIN_RUBBER_UV : paintUv(0.5, 0),
          ),
          part,
        ),
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
  return {
    frame: merged(frame, ['uv']),
    rubber: merged(rubber, ['uv']),
    metal: merged(metal, ['uv']),
  };
}

/** The realistic crankset, in the bottom bracket's own frame. */
function realisticCrankset(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  for (const part of RIDER_CRANK_PARTS) {
    const solid = part.solid;
    if (solid.shape === 'ring') {
      // #624: the teeth and the chain, round the ring and round its section.
      parts.push(
        withUvs(new TorusGeometry(solid.radius, solid.thickness / 2, 6, 40), chainringUv)
          .rotateY(Math.PI / 2)
          .translate(part.x, part.y, part.z),
      );
    } else if (solid.shape === 'box') {
      parts.push(
        placedPart(
          uniformUv(new BoxGeometry(solid.width, solid.height, solid.depth), PLAIN_METAL_UV),
          part,
        ),
      );
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
  return merged(parts, ['uv']);
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
 * The triangles ONE stylised rider submits — its bicycle and body, upper body,
 * crankset and four leg segments — #783, for `realistic-budget.ts`
 * §`REALISTIC_REMOTE_STYLISED_RIDERS`' arithmetic, which draws remote riders
 * past the nearest two with the stylised rider in the realistic world.
 *
 * @test-facing held by `realistic-budget.test.ts` §"#783"
 */
export function stylisedRiderTriangles(): number {
  const belt = new RiderBelt();
  const { bodies, torsos, cranksets, limbs } = belt.meshes;
  const count = (geometry: BufferGeometry): number =>
    (geometry.getIndex()?.count ?? geometry.getAttribute('position').count) / 3;
  const total =
    count(bodies.geometry) +
    count(torsos.geometry) +
    count(cranksets.geometry) +
    count(limbs.geometry) * LEG_BONE_COUNT;
  belt.dispose();
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
  // #1589: a lot's porch is the joinery's timber, its roof the roof's; its
  // deck and ceiling are shaded apart (`porchShadedParts`).
  porch: 1,
  'porch-roof': 1,
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
  /** #1588: what a clad lot draws it as. @see LOT_PART */
  readonly part: number;
  readonly geometry: BufferGeometry;
}

/**
 * What a structure's vertex is to a clad lot — #1588, the `oylPart` vertex
 * attribute {@link withLotPaint} reads: a house's walls are clapboard, its
 * plinth a foundation, and everything else — a chimney wears the same brick
 * — keeps its photograph. Every structure geometry carries it, nought where
 * it is none of these, so the belts' merged geometries all share it. Since
 * #1589 `porch`: a farmhouse's front porch and its roof, which only a lot
 * with a porch draws ({@link withLotPorch}).
 */
export const LOT_PART = { other: 0, wall: 1, plinth: 2, porch: 3 } as const;

/**
 * A lot's porch's triangles (`buildings.ts` §`LOT_PORCH`), split by the shade
 * each is in — #1589: its ceiling, facing down, in a soffit's
 * (`facade.ts` §`FACADE_AO`), its deck, facing up at the floor, in the shade
 * of its roof, and the rest in none — as the mapped porch's vertices are.
 */
function porchShadedParts(triangles: readonly number[]): { shade: number; triangles: number[] }[] {
  const ceiling: number[] = [];
  const deck: number[] = [];
  const rest: number[] = [];
  for (let at = 0; at + 8 < triangles.length; at += 9) {
    const t = (k: number): number => triangles[at + k] as number;
    // The normal's up component, from the winding: (b − a) × (c − a).
    const up = (t(5) - t(2)) * (t(6) - t(0)) - (t(3) - t(0)) * (t(8) - t(2));
    const length = Math.hypot(
      (t(4) - t(1)) * (t(8) - t(2)) - (t(5) - t(2)) * (t(7) - t(1)),
      up,
      (t(3) - t(0)) * (t(7) - t(1)) - (t(4) - t(1)) * (t(6) - t(0)),
    );
    const ny = length > 0 ? up / length : 0;
    const floor = Math.min(t(1), t(4), t(7)) >= LOT_PORCH.floor - 1e-6;
    const into = ny < -0.5 ? ceiling : ny > 0.5 && floor ? deck : rest;
    for (let k = 0; k < 9; k += 1) into.push(t(k));
  }
  return [
    { shade: FACADE_AO.soffit, triangles: ceiling },
    { shade: FACADE_AO.porchFloor, triangles: deck },
    { shade: 1, triangles: rest },
  ].filter((part) => part.triangles.length > 0);
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
      if (role === 'porch' && plan.triangles.porch.length > 0) {
        // #1589: a lot's porch, its ceiling and its deck each in its own shade.
        for (const shaded of porchShadedParts(plan.triangles.porch)) {
          const geometry = new BufferGeometry();
          geometry.setAttribute(
            'position',
            new BufferAttribute(new Float32Array(shaded.triangles), 3),
          );
          geometry.computeVertexNormals();
          parts.push({
            surface: REALISTIC_BUILDING_SURFACES[kind][role],
            shade: REALISTIC_ROLE_SHADE[role] * shaded.shade,
            grounded: true,
            part: LOT_PART.porch,
            geometry,
          });
        }
        continue;
      }
      const geometry = roleGeometry(plan, role);
      if (geometry === undefined) continue;
      parts.push({
        surface: REALISTIC_BUILDING_SURFACES[kind][role],
        shade: REALISTIC_ROLE_SHADE[role],
        grounded: true,
        part:
          role === 'wall'
            ? LOT_PART.wall
            : role === 'plinth'
              ? LOT_PART.plinth
              : role === 'porch-roof'
                ? LOT_PART.porch
                : LOT_PART.other,
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
    part: LOT_PART.other,
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
 * wall, whatever its size. Position and normal are kept; nothing else is —
 * and since #1588 every vertex carries its `part` (`oylPart`, {@link LOT_PART}).
 */
function projectedInMetres(
  geometry: BufferGeometry,
  repeat: { readonly across: number; readonly up: number },
  shade = 1,
  grounded = true,
  part: number = LOT_PART.other,
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
      // #1548: across and up apart, for a map that is not square.
      uv[at * 2] = u / repeat.across;
      uv[at * 2 + 1] = v / repeat.up;
    }
  }
  flat.setAttribute('uv', new BufferAttribute(uv, 2));
  // #500: the grounding and the part's own shade, as a vertex colour the
  // structure materials multiply in. @see groundingShade
  paintGrounded(flat, 0xffffff, shade, grounded);
  // #1588: what a clad lot draws each vertex as. @see LOT_PART
  flat.setAttribute('oylPart', new BufferAttribute(new Float32Array(position.count).fill(part), 1));
  return flat;
}

/**
 * A `width` x `height` x `depth` box through {@link projectedInMetres} — #1548,
 * so a test can read each axis's division under a map that is not square.
 *
 * @test-facing `three-renderer.test.ts` reads its UVs; the box is built here
 * because this is the only file that may name `three` (`three-seam.test.ts`)
 */
export function projectedBoxInMetres(
  width: number,
  height: number,
  depth: number,
  repeat: { readonly across: number; readonly up: number },
): BufferGeometry {
  return projectedInMetres(new BoxGeometry(width, height, depth), repeat);
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
  const tile = isPhotographic(surface)
    ? surfaceRepeat(REALISTIC_STRUCTURE_SURFACES[surface])
    : { across: 1, up: 1 };
  const mine: BufferGeometry[] = [];
  for (const part of realisticStructureParts(kind, variant)) {
    if (part.surface === surface)
      mine.push(projectedInMetres(part.geometry, tile, part.shade, part.grounded, part.part));
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
  // #1535: worn by no structure kind — the pavements' finish, which
  // `PavementBelt` reads. Matte, as concrete flags are.
  paving: { roughness: 0.9, metalness: 0, tint: 0xffffff },
  // #1548: the mapped towns' three, matte as masonry is — a gravel roof the
  // most, smooth concrete the least.
  render: { roughness: 0.9, metalness: 0, tint: 0xffffff },
  concrete: { roughness: 0.85, metalness: 0, tint: 0xffffff },
  'flat-roof': { roughness: 0.95, metalness: 0, tint: 0xffffff },
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
 * structure to, since it is built here rather than read off a file — and
 * since #1566 a procedural structure's price in the term the village models
 * share ({@link VillageHouseBelt}). Held by `realistic-budget.test.ts`.
 */
export function realisticStructureTriangles(kind: StructureKind): number {
  let heaviest = 0;
  for (let variant = 0; variant < (isBuiltKind(kind) ? BUILDING_VARIANTS : 1); variant += 1) {
    heaviest = Math.max(heaviest, realisticStructureTrianglesOf(kind, variant));
  }
  return heaviest;
}

/**
 * How many triangles one shape of a realistic structure is drawn with — #500;
 * {@link realisticStructureTriangles}' heaviest. Held by
 * `realistic-budget.test.ts` §"the SAME triangles in both worlds", shape by
 * shape against the stylised belt's mesh.
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
  // #619 lever 2: a photographed surface reads the rung's bias; painted and
  // glass sample no texture and are left as they were.
  // #621: and every one reads its structure's seeded tint — GLASS INCLUDED, and
  // deliberately: #621 tints the structure INSTANCE, so a window shifts with
  // its own walls rather than being the one thing on a house that every house
  // shares; masonry's bound is small enough that glass stays glass, and the
  // browser gate's window-glass assertions are unchanged by it.
  // #1589: and a farmhouse's porch is folded away but on a lot that has one.
  const biased = <M extends Material>(material: M): M =>
    withLotPorch(
      withLotPaint(
        withAtmosphere(
          withInstanceChannels(maps === undefined ? material : withTextureLodBias(material), false),
        ),
        surface,
      ),
    );
  return {
    lit: biased(
      constructed(
        new MeshStandardMaterial({
          color: finish.tint,
          roughness: finish.roughness,
          metalness: finish.metalness,
          vertexColors: true,
          ...(maps === undefined ? {} : { map: maps.colour, normalMap: maps.normal }),
        }),
      ),
    ),
    flat: biased(
      constructed(
        new MeshBasicMaterial({
          color: finish.tint,
          vertexColors: true,
          ...(maps === undefined ? {} : { map: maps.colour }),
        }),
      ),
    ),
  };
}

/** The materials {@link withLotPaint} has taught, and the channel each reads. */
const LOT_PAINT_TAUGHT = new WeakMap<Material, 'wall' | 'roof' | 'trim'>();

/**
 * Which instance channel a structure material reads a lot's paint from, or
 * none: it is not a painted surface.
 *
 * @test-facing held by `three-renderer.test.ts` §"#1581", which asserts the
 * brick, roof-tiles, planks and glass materials
 */
export function readsLotPaint(material: Material): 'wall' | 'roof' | 'trim' | undefined {
  return LOT_PAINT_TAUGHT.get(material);
}

/**
 * A clad lot's walls and roof, drawn in place of the photograph — #1588,
 * after the lot's colour. `vOylLot` is the vertex in the structure's own
 * frame and, in `w`, what it is: nought unclad; on a wall surface one more
 * than its {@link LOT_PART} (so 1 a chimney, which keeps the photograph, 2 a
 * wall, 3 a plinth); on a roof surface 1. A wall is clapboard in its siding
 * paint with a foundation band at its foot, a plinth the band, and a roof
 * shingles, each across the face — along `x` on a face that looks along `z`
 * — and up it, as `facade.ts` §`claddingPartAt` lays them.
 *
 * Exported for `three-renderer.test.ts`, which holds its program text.
 */
export const LOT_CLADDING_GLSL = /* glsl */ `
  float oylLotFlat = 0.0;
  // Derivatives are taken here, out of every branch: GLSL ES leaves them undefined in non-uniform control flow.
  vec3 oylLocalN = normalize(vOylLotNormal);
  vec2 oylL = vec2(abs(oylLocalN.x) > abs(oylLocalN.z) ? vOylLot.z : vOylLot.x, vOylLot.y);
  vec2 oylLw = max(fwidth(oylL), vec2(0.00001));
  if (vOylLot.w > 0.5) {
    if (vOylLotRoof > 0.5) {
      // Shingles: a course's rise is its exposure up the slope times the slope's sine.
      float oylSinP = sqrt(max(1.0 - oylLocalN.y * oylLocalN.y, 0.0));
      float oylRise = oylShingleCourse * max(oylSinP, 0.1);
      float oylRow = floor(oylL.y / oylRise);
      float oylF = fract(oylL.y / oylRise);
      float oylTw = oylLw.y / oylRise;
      float oylTabT = oylL.x / oylTab + 0.5 * mod(oylRow, 2.0);
      float oylTabW = oylLw.x / oylTab;
      float oylKey = oylLine(oylTabT, oylKeyway * 0.5 / oylTab, oylTabW);
      float oylShadow = smoothstep(1.0 - oylShingleShadow - oylTw, 1.0 - oylShingleShadow + oylTw, oylF);
      float oylGrain = oylWindowHash(vec2(oylRow, floor(oylTabT)));
      float oylShade = (1.0 - oylShingleDepth * oylShadow) * (1.0 - oylKeywayDepth * oylKey)
        * (1.0 + oylShingleVary * (oylGrain - 0.5));
      float oylMean = (1.0 - oylShingleDepth * oylShingleShadow) * (1.0 - oylKeywayDepth * oylKeyway / oylTab);
      oylShade = mix(oylShade, oylMean, oylFadeOf(max(oylTw, oylTabW)));
      diffuseColor.rgb = vColor.rgb * vOylPaint * mix(1.0, oylShade, step(0.1, oylSinP));
      oylLotFlat = 1.0;
    } else if (vOylLot.w > 2.5 || (vOylLot.w > 1.5 && vOylLot.y < oylLotBand)) {
      // The foundation: the plinth, and the wall's foot above it.
      diffuseColor.rgb = oylBond(oylL, oylLw, 0.0) * mix(vColor.rgb, vec3(oylBandShade), step(vOylLot.w, 2.5));
      oylLotFlat = 1.0;
    } else if (vOylLot.w > 1.5) {
      float oylT = oylL.y / oylLotCourse;
      float oylTw = oylLw.y / oylLotCourse;
      float oylF = fract(oylT);
      float oylLap = smoothstep(1.0 - oylLapShadow - oylTw, 1.0 - oylLapShadow + oylTw, oylF);
      float oylButtStrip = 1.0 - smoothstep(oylButt - oylTw, oylButt + oylTw, oylF);
      float oylShade = 1.0 - oylLapDepth * oylLap + oylButtBright * oylButtStrip;
      float oylMean = 1.0 - oylLapDepth * oylLapShadow + oylButtBright * oylButt;
      diffuseColor.rgb = vColor.rgb * vOylPaint * oylSidingWhite * mix(oylShade, oylMean, oylFadeOf(oylTw));
      oylLotFlat = 1.0;
    }
  }
`;

/**
 * Teaches a structure surface's material a procedural lot's paint — #1581,
 * #1550's lots. `settlements.ts` §`lotsAt` paints a lot
 * (`building-paint.ts` §`lotPaint`), and the belt writes its wall's entry in
 * the instance colour's first channel and its roof's in the second, each plus
 * one (§`lotPaintChannel`). A wall surface reads the first, a roof surface
 * the second, and each looks its entry up in its own first
 * {@link LOT_PAINTS} multipliers, baked into the program: nought is no paint,
 * so a village house, a barn and a church are drawn as they were. A surface
 * that is not painted (`paintChannelOf`) is returned untaught. Throws, as the
 * tint does, if three's program no longer holds an include it is spliced at.
 *
 * Since #1588 a channel also says whether the lot is clad
 * (`building-paint.ts` §`LOT_CLAD_STEP`): a clad wall's entry is one of the
 * siding's paints (§`lotSidingPaints`) and a clad roof's one of the shingles'
 * (§`SHINGLE_PAINTS`), and {@link LOT_CLADDING_GLSL} draws them, reading each
 * vertex's part ({@link LOT_PART}) so that a clad house's chimney keeps its
 * brick. A lit material's normal map is flattened where it is clad.
 */
function withLotPaint<M extends Material>(material: M, surface: StructureSurface): M {
  // ⚠️ `planks` has a wall list for a mapped barn, but on a lot it is the
  // joinery and the door, which stay timber: a lot's own walls are never
  // planks. Since #1566 that timber is stained, by its `trim` entry — the
  // wall's and the roof's entries summed, modulo the list — from the same
  // list, so a house's window frames and door are not most neighbours' (one diagonal one shares its trim), and
  // never clad: clapboard is the walls', not the joinery's.
  const channel = surface === 'planks' ? 'trim' : paintChannelOf(surface);
  const paints = paintsOf(surface);
  if (channel === undefined || paints === undefined || LOT_PAINT_TAUGHT.has(material)) {
    return material;
  }
  LOT_PAINT_TAUGHT.set(material, channel);
  const listOf = (list: readonly Rgb[]): string =>
    list
      .slice(0, LOT_PAINTS)
      .map((rgb) => `vec3(${rgb.map(glslFloat).join(', ')})`)
      .join(', ');
  const entries = listOf(paints);
  const clad = listOf(channel === 'roof' ? SHINGLE_PAINTS : lotSidingPaints());
  const read = channel === 'roof' ? 'y' : 'x';
  const spliced = "#1581's lot paint";
  const earlier = material.onBeforeCompile.bind(material);
  const earlierKey = material.customProgramCacheKey();
  const count = String(LOT_PAINTS);
  material.onBeforeCompile = (shader, renderer) => {
    earlier(shader, renderer);
    shader.vertexShader = replacedOrThrown(
      replacedOrThrown(
        shader.vertexShader,
        '#include <common>',
        [
          '#include <common>',
          'attribute float oylPart;',
          'varying vec3 vOylPaint;',
          'varying vec4 vOylLot;',
          'varying vec3 vOylLotNormal;',
          `const vec3 oylLotPaints[${count}] = vec3[${count}](${entries});`,
          `const vec3 oylCladPaints[${count}] = vec3[${count}](${clad});`,
        ].join('\n'),
        'vertex',
        spliced,
      ),
      '#include <begin_vertex>',
      [
        '#include <begin_vertex>',
        'vOylPaint = vec3(1.0);',
        'vOylLot = vec4(position, 0.0);',
        'vOylLotNormal = normal;',
        '#ifdef USE_INSTANCING_COLOR',
        `int oylCode = int(instanceColor.${read} + 0.5) - 1;`,
        // #1566: the joinery's stain, from both channels, and never clad.
        ...(channel === 'trim'
          ? [
              'int oylRoofCode = int(instanceColor.y + 0.5) - 1;',
              'if (oylCode >= 0 && oylRoofCode >= 0) {',
              `  int oylTrim = (min(oylCode % ${String(LOT_CLAD_STEP)}, ${String(LOT_PAINTS - 1)}) + min(oylRoofCode % ${String(LOT_CLAD_STEP)}, ${String(LOT_PAINTS - 1)})) % ${count};`,
              '  vOylPaint = oylLotPaints[oylTrim];',
              '}',
              'oylCode = -1;',
            ]
          : []),
        'if (oylCode >= 0) {',
        `  int oylEntry = min(oylCode % ${String(LOT_CLAD_STEP)}, ${String(LOT_PAINTS - 1)});`,
        // #1589: the wall channel carries a porch above the cladding, so the cladding is one bit.
        `  bool oylClad = (oylCode / ${String(LOT_CLAD_STEP)}) % 2 == 1;`,
        // A clad lot's chimney keeps its photograph, unpainted.
        channel === 'wall'
          ? '  vOylPaint = oylClad ? (oylPart > 0.5 ? oylCladPaints[oylEntry] : vec3(1.0)) : oylLotPaints[oylEntry];'
          : '  vOylPaint = oylClad ? oylCladPaints[oylEntry] : oylLotPaints[oylEntry];',
        channel === 'wall'
          ? '  vOylLot.w = oylClad ? 1.0 + oylPart : 0.0;'
          : '  vOylLot.w = oylClad ? 1.0 : 0.0;',
        '}',
        '#endif',
      ].join('\n'),
      'vertex',
      spliced,
    );
    let fragment = replacedOrThrown(
      replacedOrThrown(
        shader.fragmentShader,
        '#include <common>',
        [
          '#include <common>',
          'varying vec3 vOylPaint;',
          'varying vec4 vOylLot;',
          'varying vec3 vOylLotNormal;',
          `const float vOylLotRoof = ${channel === 'roof' ? '1.0' : '0.0'};`,
          CLADDING_HELPERS_GLSL,
        ].join('\n'),
        'fragment',
        spliced,
      ),
      '#include <color_fragment>',
      `#include <color_fragment>\ndiffuseColor.rgb *= vOylPaint;\n${LOT_CLADDING_GLSL}`,
      'fragment',
      spliced,
    );
    // A lit material: a clad face loses the photograph's relief.
    if (fragment.includes('#include <normal_fragment_maps>')) {
      fragment = fragment.replace(
        '#include <normal_fragment_maps>',
        '#include <normal_fragment_maps>\nnormal = normalize(mix(normal, nonPerturbedNormal, oylLotFlat));',
      );
    }
    shader.fragmentShader = fragment;
  };
  material.customProgramCacheKey = () => `${earlierKey}|oyl-lot-paint-${surface}`;
  return material;
}

/** The materials {@link withLotPorch} has taught. */
const LOT_PORCH_TAUGHT = new WeakSet<Material>();

/**
 * Whether a structure material folds a farmhouse's porch away but on a lot
 * that has one — #1589.
 *
 * @test-facing held by `three-renderer.test.ts` §"#1589", which asserts every
 * realistic structure material is taught it
 */
export function foldsLotPorch(material: Material): boolean {
  return LOT_PORCH_TAUGHT.has(material);
}

/**
 * The vertex rule {@link withLotPorch} splices after `begin_vertex`: a porch's
 * vertex ({@link LOT_PART}'s `porch`) is folded to the structure's origin —
 * every corner of its triangles to one point, which draws nothing — unless
 * its instance is a lot whose wall channel carries `building-paint.ts`
 * §`LOT_PORCH_STEP`. Without instance colours no lot is known, so it folds.
 *
 * Exported for `three-renderer.test.ts`, which holds its program text.
 */
export const LOT_PORCH_VERTEX_GLSL = [
  'if (oylPart > 2.5) {',
  '  bool oylPorch = false;',
  '#ifdef USE_INSTANCING_COLOR',
  '  int oylPorchCode = int(instanceColor.x + 0.5) - 1;',
  `  oylPorch = oylPorchCode >= 0 && (oylPorchCode / ${String(LOT_PORCH_STEP)}) % 2 == 1;`,
  '#endif',
  '  if (!oylPorch) transformed = vec3(0.0);',
  '}',
].join('\n');

/**
 * Teaches a structure material to draw a farmhouse's front porch only on a
 * lot that has one — #1589. `buildings.ts` builds the porch into the
 * farmhouse, and every farmhouse of a variant is one instanced mesh, so a
 * village house, which has no room for one before the road, and a lot whose
 * porch would reach the road's clearance (`settlements.ts` §`lotsAt`) fold it
 * away in the vertex shader ({@link LOT_PORCH_VERTEX_GLSL}) and draw nothing
 * of it. Declares `oylPart` unless an earlier splice ({@link withLotPaint})
 * has. Throws, as the tint does, if three's program no longer holds the
 * include it is spliced at. Idempotent.
 */
function withLotPorch<M extends Material>(material: M): M {
  if (LOT_PORCH_TAUGHT.has(material)) return material;
  LOT_PORCH_TAUGHT.add(material);
  const earlier = material.onBeforeCompile.bind(material);
  const earlierKey = material.customProgramCacheKey();
  const spliced = "#1589's lot porch";
  material.onBeforeCompile = (shader, renderer) => {
    earlier(shader, renderer);
    const declared = shader.vertexShader.includes('attribute float oylPart;');
    shader.vertexShader = replacedOrThrown(
      declared
        ? shader.vertexShader
        : replacedOrThrown(
            shader.vertexShader,
            '#include <common>',
            '#include <common>\nattribute float oylPart;',
            'vertex',
            spliced,
          ),
      '#include <begin_vertex>',
      `#include <begin_vertex>\n${LOT_PORCH_VERTEX_GLSL}`,
      'vertex',
      spliced,
    );
  };
  material.customProgramCacheKey = () => `${earlierKey}|oyl-lot-porch`;
  return material;
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
  /** How tall each kind is built, at scale 1, over every surface and shape — #620. */
  readonly #heights = new Map<StructureKind, number>();

  /** @param textures the world's structure surfaces. @see RealisticWorld.structures */
  constructor(textures: RealisticWorld['structures']) {
    for (const kind of STRUCTURE_KINDS) {
      const [first] = realisticStructureSurfaces(kind);
      if (first !== undefined) this.#first.set(kind, first);
    }
    // #1535: `paving` is the pavements' (`PavementBelt`), and no structure
    // kind wears it, so it has no belt here: an empty belt would be a mesh a
    // kind for nothing.
    this.#belts = STRUCTURE_SURFACES.filter((surface) => surface !== 'paving').map((surface) => {
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
        for (const shape of shapes) {
          shape.computeBoundingBox();
          const top = shape.boundingBox?.max.y ?? 0;
          this.#heights.set(kind, Math.max(this.#heights.get(kind) ?? 0, top));
        }
        models.set(kind, shapes);
      }
      const belt = new ScatterBelt(models, {
        skip: new Set(SCENERY_KINDS.filter((kind) => !models.has(kind))),
        materials: structureMaterials(surface, textures),
        tint: 'masonry',
      });
      // The belt wears copies. @see ScatterBelt's constructor
      for (const shapes of models.values()) for (const geometry of shapes) geometry.dispose();
      return { surface, belt };
    });
  }

  /**
   * How tall a kind is built, at scale 1, in its tallest shape and surface —
   * a church's tower, a house's chimney — which is the column its ground blob
   * is thrown from (#620). Nought for a kind this world does not build.
   */
  heightOf(kind: StructureKind): number {
    return this.#heights.get(kind) ?? 0;
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

/** What one {@link MappedBuildingBelt.refill} drew. @see MappedBuildingBelt */
export interface MappedBuildingStats {
  /** The buildings drawn, near and far together. */
  readonly buildings: number;
  readonly near: number;
  readonly far: number;
  readonly triangles: number;
  /**
   * The draw calls: a group a surface, and since #1585 one more for every
   * house model drawn, together at most `MAPPED_BUILDING_DRAW_CALLS`.
   */
  readonly drawCalls: number;
  /** How many are drawn as house models, and their triangles — #1585. */
  readonly modelled: number;
  readonly modelTriangles: number;
  /**
   * In reach and inside the budget, but passed over because its surfaces would
   * have opened a seventh — `mapped-buildings.ts` §`selectMappedBuildings`.
   */
  readonly passed: number;
}

/**
 * A mapped building's role's shade, as {@link REALISTIC_ROLE_SHADE} darkens a
 * procedural one's. Since #1581 the door and the trim are painted
 * (`building-paint.ts`), so neither is darkened: the paint is the colour.
 */
const MAPPED_ROLE_SHADE: Readonly<Record<FootprintRole, number>> = {
  wall: REALISTIC_ROLE_SHADE.wall,
  plinth: REALISTIC_ROLE_SHADE.plinth,
  roof: REALISTIC_ROLE_SHADE.roof,
  parapet: REALISTIC_ROLE_SHADE.wall,
  door: 1,
  chimney: REALISTIC_ROLE_SHADE.chimney,
  trim: 1,
  // #1588: a dormer is shaded as the wall and the roof it is built of; a driveway is painted.
  dormer: REALISTIC_ROLE_SHADE.wall,
  'dormer-roof': REALISTIC_ROLE_SHADE.roof,
  driveway: 1,
  // #1590: a shop's front, sign and awning are painted by the shader.
  shopfront: 1,
  // #1589: a porch is painted, and its roof is shaded as the roof it wears.
  porch: 1,
  'porch-roof': REALISTIC_ROLE_SHADE.roof,
  'porch-trim': 1,
};

/**
 * The colour a role of `plan` is painted, before its shade — #1581: the wall
 * surface's multiplier on the walls, the plinth, the parapet and the chimney;
 * the roof surface's on the roof; the door's paint on the door and the trim's
 * on the trim. Since #1588: a shingled roof's albedo on the roof and a
 * dormer's roof, the walls' paint on a dormer, and none on a driveway or on a
 * clapboard house's plinth, whose colours the shader lays (`facade.ts`
 * §`PAVING`, §`FOUNDATION`) — so their vertex colour is their light alone.
 * Since #1590 none on a shop's front, sign or awning, which it paints too.
 * Since #1589 a porch's roof is the roof's, and the porch the trim's.
 */
export function mappedRolePaint(plan: FootprintPlan, role: FootprintRole): Rgb {
  const unpainted: Rgb = [1, 1, 1];
  switch (role) {
    case 'roof':
    case 'dormer-roof':
    case 'porch-roof':
      return (
        roofPaintsOf(plan.surfaces.roof, plan.cladding.roof === 'shingle')?.[plan.paint.roof] ??
        unpainted
      );
    case 'driveway':
    case 'shopfront':
      return unpainted;
    case 'plinth':
      if (plan.cladding.wall === 'clapboard') return unpainted;
      return paintsOf(plan.surfaces.wall)?.[plan.paint.wall] ?? unpainted;
    case 'door':
      return DOOR_PAINTS[plan.paint.door] ?? unpainted;
    case 'trim':
    case 'porch':
    case 'porch-trim':
      return TRIM_PAINTS[plan.paint.trim] ?? unpainted;
    default:
      return paintsOf(plan.surfaces.wall)?.[plan.paint.wall] ?? unpainted;
  }
}

/** The materials {@link withVertexTint} has taught. */
const VERTEX_TINT_TAUGHT = new WeakSet<Material>();

/**
 * Whether a material reads its seeded tint from a VERTEX attribute — #1549.
 *
 * @test-facing held by `mapped-building-belt.test.ts` §"the mapped buildings’
 * materials", which asserts every mapped building's material is taught it
 */
export function readsVertexTint(material: Material): boolean {
  return VERTEX_TINT_TAUGHT.has(material);
}

/**
 * Teaches a material #621's seeded tint from a vertex attribute, `oylTint` —
 * #1549. A procedural structure carries its tint in its INSTANCE colour's
 * third channel ({@link withInstanceChannels}); a merged mesh has no instance,
 * so each vertex carries its building's tint instead, the same one packed float
 * (`instance-tint.ts` §`packedInstanceTint`), decoded and applied by the same
 * GLSL ({@link TINT_DECODE_GLSL}, {@link TINT_APPLY_GLSL}). Throws, as the
 * instance path does, if three's program no longer holds an include it is
 * spliced at. Idempotent.
 */
function withVertexTint<M extends Material>(material: M): M {
  if (VERTEX_TINT_TAUGHT.has(material)) return material;
  VERTEX_TINT_TAUGHT.add(material);
  const earlier = material.onBeforeCompile.bind(material);
  const earlierKey = material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    earlier(shader, renderer);
    shader.vertexShader = replacedOrThrown(
      replacedOrThrown(
        shader.vertexShader,
        '#include <common>',
        `#include <common>\nattribute float oylTint;\nvarying vec3 vOylTint;\n${TINT_DECODE_GLSL}`,
        'vertex',
      ),
      '#include <color_vertex>',
      '#include <color_vertex>\nvOylTint = oylTintOf(oylTint);',
      'vertex',
    );
    shader.fragmentShader = replacedOrThrown(
      replacedOrThrown(
        shader.fragmentShader,
        '#include <common>',
        `#include <common>\nvarying vec3 vOylTint;\n${TINT_APPLY_GLSL}`,
        'fragment',
      ),
      '#include <color_fragment>',
      '#include <color_fragment>\ndiffuseColor.rgb = oylTinted(diffuseColor.rgb, vOylTint);',
      'fragment',
    );
  };
  material.customProgramCacheKey = () => `${earlierKey}|oyl-vertex-tint`;
  return material;
}

/** The materials {@link withFacade} has taught. */
const FACADE_TAUGHT = new WeakSet<Material>();

/**
 * Whether the facade is drawn: 1 in the product, 0 the browser gate's
 * control. One uniform every mapped building's material shares, for
 * `ATMOSPHERE`'s reason. @see setMappedFacadeShown
 */
const FACADE_SWITCH = { oylFacadeOn: { value: 1 } };

/**
 * Where the sun is, a unit vector toward it in the world — #1588, for the
 * facade's inset reveal, which shades the jamb on the sun's side. One uniform
 * every mapped building's material shares, written by the sun's own `apply`,
 * so the facade reads the very direction the scene is lit from without naming
 * three's lamp uniforms (`three-seam.test.ts`). Module-wide, like
 * `FACADE_SWITCH`: it assumes one live scene, and with two the last `apply`'s
 * sun is the one both read.
 */
const FACADE_SUN = { oylSunWorld: { value: new Vector3(0, 1, 0) } };

/**
 * Draws the mapped buildings' walls with their windows and doors, or — the
 * browser gate's control — with the photograph alone, as #1549 drew them.
 *
 * @test-facing the browser gate's control, read by `game-harness.ts`
 * §`mappedFacadeProbe`; the product always draws the facade
 */
export function setMappedFacadeShown(on: boolean): void {
  FACADE_SWITCH.oylFacadeOn.value = on ? 1 : 0;
}

/**
 * Whether the mapped doors' wreath is drawn while the winter lights are on —
 * #1626: always, in the product. @see facadeWreathOf
 */
let facadeWreathShown = true;

/** The mapped doors' wreath for a ride's season — #1626: 1 in the winter lights, else 0. */
function wreathOf(season: Season): number {
  return facadeWreathShown && season.holiday === 'winter-lights' ? 1 : 0;
}

/**
 * Draws the mapped doors' wreath in the winter lights, or — the browser
 * gate's control — never, for the proof that it costs no call: the wreath is
 * a term on the door's own quad, so a frame draws the same calls without it.
 * Applied to the view's season at once.
 *
 * @test-facing the browser gate's `facade-wreath` lever, read by
 * `realistic-harness.ts`; the product always draws the wreath
 */
export function facadeWreathOf(view: GameView, on: boolean): void {
  facadeWreathShown = on;
  if (view instanceof ThreeGameView) SEASON.oylWreath.value = wreathOf(view.season);
}

/**
 * Whether a material draws #1581's windows and doors from its vertices.
 *
 * @test-facing held by `mapped-building-belt.test.ts` §"the mapped buildings’
 * materials", which asserts every mapped building's material is taught it
 */
export function drawsFacade(material: Material): boolean {
  return FACADE_TAUGHT.has(material);
}

/**
 * Whether the facade's program is built with #1659's window reveals: always,
 * in the product. @see windowRevealsOf
 */
let windowRevealsBuilt = true;

/**
 * Whether the facade's program is built with #1658's overhang shadows:
 * always, in the product. @see overhangShadowsOf
 */
let overhangShadowsBuilt = true;

/**
 * Whether the facade's program is built with #1661's weathering: always, in
 * the product. @see weatheringOf
 */
let weatheringBuilt = true;

/**
 * The define a facade material carries for {@link windowRevealsBuilt} — 1
 * built, 0 not — read by its `onBeforeCompile`. ⚠️ **A define, not the cache
 * key**: `withAtmosphere`, spliced after the facade, captures the key it
 * wraps as a string when the material is made, so a key that changed later
 * never reached three and the program was never compiled again (the browser
 * gate's control read the same pixels both ways). Three keys every program on
 * its material's defines as they are at compile time.
 */
const WINDOW_REVEALS_DEFINE = 'OYL_WINDOW_REVEALS';

/** The define for {@link overhangShadowsBuilt} — #1658, as {@link WINDOW_REVEALS_DEFINE} is #1659's. */
const OVERHANG_SHADOWS_DEFINE = 'OYL_OVERHANG_SHADOWS';

/** The define for {@link weatheringBuilt} — #1661, as {@link WINDOW_REVEALS_DEFINE} is #1659's. */
const WEATHERING_DEFINE = 'OYL_WEATHERING';

/** Whether `material` is built with #1659's window reveals, by its define. */
function revealsBuiltIn(material: Material): boolean {
  return (material as { defines?: Record<string, unknown> }).defines?.[WINDOW_REVEALS_DEFINE] !== 0;
}

/** Whether `material` is built with #1658's overhang shadows, by its define. */
function overhangsBuiltIn(material: Material): boolean {
  return (
    (material as { defines?: Record<string, unknown> }).defines?.[OVERHANG_SHADOWS_DEFINE] !== 0
  );
}

/** Whether `material` is built with #1661's weathering, by its define. */
function weatheringBuiltIn(material: Material): boolean {
  return (material as { defines?: Record<string, unknown> }).defines?.[WEATHERING_DEFINE] !== 0;
}

/**
 * Sets `material`'s {@link WINDOW_REVEALS_DEFINE} to {@link windowRevealsBuilt}
 * and, since #1658, its {@link OVERHANG_SHADOWS_DEFINE} to
 * {@link overhangShadowsBuilt}; since #1661 its {@link WEATHERING_DEFINE} to
 * {@link weatheringBuilt}.
 */
function defineFacadeLevers(material: Material): void {
  const carrier = material as { defines?: Record<string, unknown> };
  carrier.defines = {
    ...carrier.defines,
    [WINDOW_REVEALS_DEFINE]: windowRevealsBuilt ? 1 : 0,
    [OVERHANG_SHADOWS_DEFINE]: overhangShadowsBuilt ? 1 : 0,
    [WEATHERING_DEFINE]: weatheringBuilt ? 1 : 0,
  };
}

/**
 * Builds every mapped building's facade with #1659's window reveals, or —
 * `on` false — without them: the term's two functions built empty
 * (`revealGlsl`), so that the program holds none of it, as `road-wear`'s
 * lever takes its code out rather than a uniform to zero. A setting of the
 * module's, as the facade's uniforms are, taken by every facade material
 * made after it; the materials already in `view`'s scene take it too, and
 * are compiled again.
 *
 * @test-facing the owner's page's `-window-reveals` lever
 * (`realistic-harness.ts`) and the browser gate's read of it
 * (`game-harness.ts` §`windowRevealProbe`); the product always builds them
 */
export function windowRevealsOf(view: GameView, on: boolean): void {
  windowRevealsBuilt = on;
  if (view instanceof ThreeGameView) view.facadesRecompiled();
}

/**
 * Builds every mapped building's facade with #1658's overhang shadows — the
 * sun's own shadow under the eaves, on a wall the sun lights — or, `on`
 * false, without them: the term's function and its splice left out of the
 * program ({@link overhangGlsl}), so every wall under eaves has #1588's
 * symmetric band, as before #1658. As {@link windowRevealsOf} does, a setting
 * of the module's, and the materials already in `view`'s scene are compiled
 * again.
 *
 * @test-facing the owner's page's `-overhang-shadows` lever
 * (`realistic-harness.ts`) and the browser gate's read of it
 * (`game-harness.ts` §`overhangShadowProbe`); the product always builds them
 */
export function overhangShadowsOf(view: GameView, on: boolean): void {
  overhangShadowsBuilt = on;
  if (view instanceof ThreeGameView) view.facadesRecompiled();
}

/**
 * Builds every mapped building's facade with #1661's weathering — the
 * photograph's repeat broken and laid differently on each building, splash
 * grime at a wall's foot, streaks under the sills, a flat roof's drip, a
 * roof's eaves courses and its moss, a parged plinth — or, `on` false,
 * without it: its functions and every splice of it left out of both programs
 * ({@link weatheringGlsl}), as {@link overhangShadowsOf} leaves #1658's. A
 * setting of the module's, and the materials already in `view`'s scene are
 * compiled again.
 *
 * @test-facing the owner's page's `-weathering` lever (`realistic-harness.ts`)
 * and the browser gate's read of it (`game-harness.ts` §`weatheringProbe`);
 * the product always builds it
 */
export function weatheringOf(view: GameView, on: boolean): void {
  weatheringBuilt = on;
  if (view instanceof ThreeGameView) view.facadesRecompiled();
}

/** `facade.ts`' layout, as the GLSL constants {@link facadeFragmentGlsl} reads. */
const FACADE_CONSTANTS_GLSL = /* glsl */ `
  const float oylWinL = ${glslFloat(WINDOW_IN_BAY.left)};
  const float oylWinR = ${glslFloat(WINDOW_IN_BAY.right)};
  const float oylWinB = ${glslFloat(WINDOW_IN_BAY.bottom)};
  const float oylWinT = ${glslFloat(WINDOW_IN_BAY.top)};
  const float oylFrameA = ${glslFloat(WINDOW_IN_BAY.frameAcross)};
  const float oylFrameU = ${glslFloat(WINDOW_IN_BAY.frameUp)};
  const float oylBarA = ${glslFloat(WINDOW_IN_BAY.barAcross)};
  const float oylBarU = ${glslFloat(WINDOW_IN_BAY.barUp)};
  const float oylTransom = ${glslFloat(WINDOW_IN_BAY.transom)};
  const float oylSillA = ${glslFloat(WINDOW_IN_BAY.sillAcross)};
  const float oylSillU = ${glslFloat(WINDOW_IN_BAY.sillUp)};
  const float oylDoorA = ${glslFloat(DOOR_IN_FACE.surroundAcross)};
  const float oylDoorU = ${glslFloat(DOOR_IN_FACE.surroundUp)};
  const float oylFan = ${glslFloat(DOOR_IN_FACE.fanlight)};
  const float oylStoreyM = ${glslFloat(STOREY_METRES)};
  const float oylBayM = ${glslFloat(BAY_METRES)};
  const float oylSashW = ${glslFloat(SASH.width)};
  const float oylSashH = ${glslFloat(SASH.height)};
  const float oylSashFrame = ${glslFloat(SASH.frame)};
  const float oylRail = ${glslFloat(SASH.rail)};
  const float oylSillM = ${glslFloat(WINDOW_SILL_METRES)};
  const float oylSashTop = ${glslFloat(SASH_TOP_SHARE)};
  const float oylPairMin = ${glslFloat(PAIR_MIN_BAY_METRES)};
  const float oylMullion = ${glslFloat(MULLION_METRES)};
  const float oylPicMost = ${glslFloat(PICTURE.most)};
  const float oylPicMargin = ${glslFloat(PICTURE.margin)};
  const float oylShutterShare = ${glslFloat(SHUTTER.share)};
  const float oylShutterGap = ${glslFloat(SHUTTER.gap)};
  const float oylLouvre = ${glslFloat(SHUTTER.louvre)};
  const float oylShutterMargin = ${glslFloat(SHUTTER.margin)};
  const float oylRevealShade = ${glslFloat(REVEAL.shade)};
  const float oylRecess = ${glslFloat(REVEAL_DEPTH_METRES)};
  const float oylGraze = ${glslFloat(REVEAL_GRAZE)};
  const float oylSillOver = ${glslFloat(SILL.overrun)};
  const float oylSillDepth = ${glslFloat(SILL.depth)};
  const float oylDormerW = ${glslFloat(DORMER_SASH.width)};
  const float oylDormerH = ${glslFloat(DORMER_SASH.height)};
  const float oylDormerSill = ${glslFloat(DORMER_SASH.sill)};
  const float oylDormerMargin = ${glslFloat(DORMER_SASH.margin)};
  const float oylLapShadow = ${glslFloat(CLAPBOARD.lapShadow)};
  const float oylLapDepth = ${glslFloat(CLAPBOARD.shadowDepth)};
  const float oylButt = ${glslFloat(CLAPBOARD.butt)};
  const float oylButtBright = ${glslFloat(CLAPBOARD.buttBright)};
  const float oylLapTilt = ${glslFloat(CLAPBOARD.tilt)};
  const float oylButtTilt = ${glslFloat(CLAPBOARD.buttTilt)};
  const float oylSidingWhite = ${glslFloat(CLAPBOARD.white)};
  const float oylTab = ${glslFloat(SHINGLE.tab)};
  const float oylKeyway = ${glslFloat(SHINGLE.keyway)};
  const float oylShingleShadow = ${glslFloat(SHINGLE.buttShadow)};
  const float oylShingleDepth = ${glslFloat(SHINGLE.shadowDepth)};
  const float oylKeywayDepth = ${glslFloat(SHINGLE.keywayDepth)};
  const float oylShingleVary = ${glslFloat(SHINGLE.variation)};
  const vec2 oylBlock = ${glslVec(FOUNDATION.block)};
  const vec2 oylBrick = ${glslVec(FOUNDATION.brick)};
  const float oylMortar = ${glslFloat(FOUNDATION.mortar)};
  const float oylBandM = ${glslFloat(FOUNDATION.onWall)};
  const float oylBandShade = ${glslFloat(FOUNDATION.bandShade)};
  const vec3 oylBlockC = ${glslVec(FOUNDATION.blockColour)};
  const vec3 oylBrickC = ${glslVec(FOUNDATION.brickColour)};
  const vec3 oylMortarC = ${glslVec(FOUNDATION.mortarColour)};
  const float oylSlab = ${glslFloat(PAVING.slab)};
  const float oylSlabJoint = ${glslFloat(PAVING.joint)};
  const vec3 oylPavingC = ${glslVec(PAVING.colour)};
  const float oylAoEaves = ${glslFloat(FACADE_AO.eaves)};
  const float oylAoEavesM = ${glslFloat(FACADE_AO.eavesMetres)};
  const float oylAoBase = ${glslFloat(FACADE_AO.base)};
  const float oylAoBaseM = ${glslFloat(FACADE_AO.baseMetres)};
  const float oylGarageS = ${glslFloat(GARAGE.surround)};
  const float oylGarageSections = ${glslFloat(GARAGE_DOOR.sections)};
  const float oylGaragePanel = ${glslFloat(GARAGE_DOOR.panel)};
  const float oylGarageGroove = ${glslFloat(GARAGE_DOOR.groove)};
  const float oylGarageInset = ${glslFloat(GARAGE_DOOR.inset)};
  const float oylClapboard = ${glslFloat(CLAD_CLAPBOARD)};
  const float oylShingle = ${glslFloat(CLAD_SHINGLE)};
  const float oylBlockCode = ${glslFloat(CLAD_BLOCK)};
  const float oylBrickCode = ${glslFloat(CLAD_BRICK)};
  const float oylPaving = ${glslFloat(CLAD_PAVING)};
  const float oylSashFlag = ${glslFloat(STYLE_SASH)};
  const float oylShuttersFlag = ${glslFloat(STYLE_SHUTTERS)};
  const float oylEavesFlag = ${glslFloat(STYLE_EAVES)};
  const float oylBrickFlag = ${glslFloat(STYLE_BRICK_FOUNDATION)};
  const float oylDormerTop = ${glslFloat(FACADE_DORMER)};
  const float oylGarageTop = ${glslFloat(FACADE_GARAGE)};
  const float oylShopTop = ${glslFloat(FACADE_SHOPFRONT)};
  const float oylSignTop = ${glslFloat(FACADE_SIGN)};
  const float oylAwningTop = ${glslFloat(FACADE_AWNING)};
  const float oylCommercialFlag = ${glslFloat(STYLE_COMMERCIAL)};
  const float oylGlazedFlag = ${glslFloat(STYLE_GLAZED)};
  const float oylCurtainSpandrel = ${glslFloat(CURTAIN_WALL.spandrel)};
  const float oylCurtainMullion = ${glslFloat(CURTAIN_WALL.mullion)};
  const float oylCurtainModule = ${glslFloat(CURTAIN_WALL.module)};
  const vec3 oylCurtainGlassC = ${glslVec(CURTAIN_WALL.glassColour)};
  const vec3 oylCurtainSpandrelC = ${glslVec(CURTAIN_WALL.spandrelColour)};
  const vec3 oylCurtainMullionC = ${glslVec(CURTAIN_WALL.mullionColour)};
  const float oylCwL = ${glslFloat(COMMERCIAL_WINDOW_IN_BAY.left)};
  const float oylCwR = ${glslFloat(COMMERCIAL_WINDOW_IN_BAY.right)};
  const float oylCwB = ${glslFloat(COMMERCIAL_WINDOW_IN_BAY.bottom)};
  const float oylCwT = ${glslFloat(COMMERCIAL_WINDOW_IN_BAY.top)};
  const float oylCwTransom = ${glslFloat(COMMERCIAL_WINDOW_IN_BAY.transom)};
  const float oylShopFrame = ${glslFloat(SHOP_FRONT.frame)};
  const float oylShopRiser = ${glslFloat(SHOP_FRONT.riser)};
  const float oylShopSill = ${glslFloat(SHOP_FRONT.sill)};
  const vec2 oylShopTransom = ${glslVec(SHOP_FRONT.transom)};
  const float oylShopMullion = ${glslFloat(SHOP_FRONT.mullion)};
  const float oylShopPaneMost = ${glslFloat(SHOP_FRONT.light)};
  const float oylDoorW = ${glslFloat(DOOR_FACE.width)};
  const float oylDoorH = ${glslFloat(DOOR_FACE.height)};
  const float oylDoorSurround = ${glslFloat(DOOR_SURROUND_METRES)};
  const float oylShopDoorFrame = ${glslFloat(SHOP_DOOR.frame)};
  const float oylShopDoorRail = ${glslFloat(SHOP_DOOR.rail)};
  const float oylSignMoulding = ${glslFloat(SIGN_MOULDING_METRES)};
  const float oylStripe = ${glslFloat(AWNING_STRIPE_METRES)};
  const vec3 oylStripeC = ${glslVec(AWNING_STRIPE_PAINT)};
  const vec3 oylSignPaints[${String(SIGN_PAINTS.length)}] = vec3[${String(SIGN_PAINTS.length)}](${SIGN_PAINTS.map(glslVec).join(', ')});
  const vec3 oylAwningPaints[${String(AWNING_PAINTS.length)}] = vec3[${String(AWNING_PAINTS.length)}](${AWNING_PAINTS.map(glslVec).join(', ')});
  const float oylRailingTop = ${glslFloat(FACADE_RAILING)};
  const float oylRailDepth = ${glslFloat(FRONT_PORCH.railing.rail)};
  const vec2 oylRailFoot = ${glslVec(FRONT_PORCH.railing.bottom)};
  const float oylBaluster = ${glslFloat(FRONT_PORCH.railing.baluster)};
  const float oylBalusterGap = ${glslFloat(FRONT_PORCH.railing.spacing)};
  const float oylRailingGap = ${glslFloat(RAILING.gapShade)};
  const float oylLotCourse = ${glslFloat(LOT_CLAPBOARD_COURSE_METRES)};
  const float oylLotBand = ${glslFloat(PLINTH_TOP_METRES + FOUNDATION.onWall)};
  const float oylShingleCourse = ${glslFloat(SHINGLE_COURSE_METRES)};
`;

/**
 * The facade's constants and helpers, in GLSL — every one a mapped building's
 * material and, since #1588, a clad lot's reads: a band and a rectangle
 * softened over a pixel's footprint (`fwidth`), so a window's edge never
 * crawls as the rider rides past it; since #1588 a line at every whole
 * number, a pattern's fade to its mean once it is a few pixels across, a
 * style flag and a running bond (`facade.ts` §`FOUNDATION`), each the
 * TypeScript twin's rule (`claddingPartAt`) from the same numbers.
 *
 * ⚠️ Every local is `oyl`-prefixed: GLSL ES reserves `half`, `input`,
 * `output` and `fixed`, and a sash has a half.
 */
const CLADDING_HELPERS_GLSL = /* glsl */ `
  ${FACADE_CONSTANTS_GLSL}
  float oylBand(float x, float lo, float hi, float w) {
    return smoothstep(lo - w, lo + w, x) - smoothstep(hi - w, hi + w, x);
  }
  float oylRect(vec2 p, vec2 lo, vec2 hi, vec2 w) {
    return oylBand(p.x, lo.x, hi.x, w.x) * oylBand(p.y, lo.y, hi.y, w.y);
  }
  float oylWindowHash(vec2 cell) {
    return fract(sin(dot(cell, vec2(12.9898, 78.233))) * 43758.5453);
  }
  float oylLine(float t, float halfWidth, float aa) {
    return 1.0 - smoothstep(halfWidth - aa, halfWidth + aa, abs(t - floor(t + 0.5)));
  }
  float oylFadeOf(float perPixel) {
    return clamp(perPixel * 4.0 - 0.5, 0.0, 1.0);
  }
  float oylFlag(float flags, float bit) {
    return mod(floor(flags / bit + 0.001), 2.0);
  }
  vec3 oylBond(vec2 m, vec2 mw, float brick) {
    vec2 oylUnit = mix(oylBlock, oylBrick, brick);
    float oylRowOf = floor(m.y / oylUnit.y);
    vec2 oylT = vec2(m.x / oylUnit.x + 0.5 * mod(oylRowOf, 2.0), m.y / oylUnit.y);
    vec2 oylTw = max(mw / oylUnit, vec2(0.00001));
    float oylJoint = max(
      oylLine(oylT.x, oylMortar * 0.5 / oylUnit.x, oylTw.x),
      oylLine(oylT.y, oylMortar * 0.5 / oylUnit.y, oylTw.y)
    );
    float oylFade = oylFadeOf(max(oylTw.x, oylTw.y));
    oylJoint = mix(oylJoint, oylMortar / oylUnit.x + oylMortar / oylUnit.y, oylFade);
    float oylVary = mix(0.9 + 0.2 * oylWindowHash(floor(oylT) + vec2(brick * 17.0, 3.0)), 1.0, oylFade);
    return mix(mix(oylBlockC, oylBrickC, brick) * oylVary, oylMortarC, oylJoint);
  }
`;

/**
 * #1659's reveal, in GLSL — `facade.ts` §`revealOf` and its sill's shadow,
 * from the same numbers. `p` is a point of an opening `lo` to `hi`, metres on
 * the face; `e` and `s` the eye and the sun in the face's frame
 * ({@link facadeFragmentGlsl}'s `oylFaceU`, `oylFaceUp`, `oylFaceN`). Out:
 * `q`, the glass seen through `p`; `seen`, how much of `p` shows glass rather
 * than the opening's side; `lit`, whether that side faces the sun; `shade`,
 * the glass at `q` in the shadow of the head and the sun-side jamb.
 *
 * With `window-reveals` off (`realistic/config.ts` §`LEVERS`) the same two
 * functions are built empty, so the program holds none of the term and every
 * window kind is drawn flat, as a decal: the cost pair's "before".
 */
function revealGlsl(built: boolean): string {
  if (!built) {
    return /* glsl */ `
  void oylRevealOf(
    vec2 p, vec2 lo, vec2 hi, vec2 pw, vec3 e, vec3 s,
    out vec2 q, out float seen, out float lit, out float shade
  ) {
    q = p;
    seen = 1.0;
    lit = 1.0;
    shade = 0.0;
  }
  float oylSillShadeOf(vec2 p, vec2 lo, vec2 hi, vec2 pw, vec3 s) {
    return 0.0;
  }
`;
  }
  return /* glsl */ `
  void oylRevealOf(
    vec2 p, vec2 lo, vec2 hi, vec2 pw, vec3 e, vec3 s,
    out vec2 q, out float seen, out float lit, out float shade
  ) {
    vec2 oylShift = oylRecess * e.xy / max(e.z, oylGraze);
    q = p - oylShift;
    seen = oylRect(q, lo, hi, pw);
    // The side the eye's ray met first: the axis it left the opening by at the shallower depth.
    vec2 oylBeyond = max(max(lo - q, q - hi), vec2(0.0)) / max(abs(oylShift), vec2(0.00001));
    float oylJambSide = step(oylBeyond.y, oylBeyond.x);
    float oylFacing = mix(sign(oylShift.y) * s.y, sign(oylShift.x) * s.x, oylJambSide);
    float oylFront = step(0.0001, s.z);
    lit = step(0.0001, oylFacing) * oylFront;
    vec2 oylCast = oylRecess * vec2(abs(s.x), max(s.y, 0.0)) / max(s.z, 0.001);
    float oylUnderHead = smoothstep(hi.y - oylCast.y - pw.y, hi.y - oylCast.y + pw.y, q.y);
    float oylByJamb = s.x > 0.0
      ? smoothstep(hi.x - oylCast.x - pw.x, hi.x - oylCast.x + pw.x, q.x)
      : (s.x < 0.0 ? 1.0 - smoothstep(lo.x + oylCast.x - pw.x, lo.x + oylCast.x + pw.x, q.x) : 0.0);
    shade = oylFront * max(oylUnderHead, oylByJamb);
  }
  float oylSillShadeOf(vec2 p, vec2 lo, vec2 hi, vec2 pw, vec3 s) {
    vec2 oylCast = oylSillDepth * s.xy / max(s.z, 0.001);
    return step(0.0001, s.z)
      * oylBand(p.y, lo.y - max(oylCast.y, 0.0), lo.y, pw.y)
      * oylBand(p.x, lo.x - max(oylCast.x, 0.0), hi.x - min(oylCast.x, 0.0), pw.x);
  }
`;
}

/**
 * #1658's overhang shadow, in GLSL — `facade.ts` §`overhangShadowAt` from
 * the same numbers: how much of a point `below` metres under an edge
 * `projection` metres proud is in the sun's shadow (`s`, the sun in the
 * face's frame), softened over `pw` and at most the wall's height `wall`
 * deep; and {@link OVERHANG_SHADOW}'s constants, which the shade's splice in
 * {@link facadeFragmentGlsl} reads. With `overhang-shadows` off
 * (`realistic/config.ts` §`LEVERS`) none of it is built.
 */
function overhangGlsl(built: boolean): string {
  if (!built) return '';
  return /* glsl */ `
  const float oylOverhangShade = ${glslFloat(OVERHANG_SHADOW.shade)};
  const float oylOverhangSquare = ${glslFloat(OVERHANG_SHADOW.square)};
  const float oylEavesEdge = ${glslFloat(OVERHANG_SHADOW.edge)};
  const float oylEavesOverhang = ${glslFloat(EAVES_OVERHANG_METRES)};
  float oylOverhangShadow(float below, float projection, vec3 s, float pw, float wall) {
    float oylDepth = min(projection * max(s.y, 0.0) / max(s.z, 0.0001), wall);
    return step(0.0001, s.z) * (1.0 - smoothstep(oylDepth - pw, oylDepth + pw, below));
  }
`;
}

/**
 * #1661's hash, in GLSL — `facade.ts` §`weatheringHash`: what the vertex
 * shader lays a building's photograph by and the fragment shader weathers it
 * by, from its seeded tint. Since #1735 in two: `oylWeatherHashFolded` takes
 * its numbers already folded under a thousand, so that the noise folds each
 * lattice coordinate once rather than once a corner.
 */
const WEATHER_HASH_GLSL = /* glsl */ `
  float oylWeatherHashFolded(float a, float b) {
    return fract(sin(a * 127.1 + b * 311.7) * 43758.5453);
  }
  float oylWeatherHash(float a, float b) {
    return oylWeatherHashFolded(mod(a, 1000.0), mod(b, 1000.0));
  }
`;

/**
 * #1661's photograph laid per building, in GLSL — `facade.ts`
 * §`photographShiftOf`, from a building's decoded tint: a half turn or none,
 * and a shift along each texture coordinate, in repeats.
 */
const WEATHER_PHOTO_GLSL = /* glsl */ `
  ${WEATHER_HASH_GLSL}
  float oylPhotoTurnOf(vec3 tint) {
    return oylWeatherHash(tint.y * 1000.0 + 41.0, tint.z * 1000.0) < 0.5 ? -1.0 : 1.0;
  }
  float oylPhotoShiftUOf(vec3 tint) {
    return oylWeatherHash(tint.x * 1000.0 + 13.0, tint.y * 1000.0);
  }
  float oylPhotoShiftVOf(vec3 tint) {
    return oylWeatherHash(tint.z * 1000.0 + 29.0, tint.x * 1000.0);
  }
  float oylWeatherAgeOf(vec3 tint) {
    return oylWeatherHash(tint.x * 1000.0, tint.y * 1000.0 + tint.z * 7000.0);
  }
`;

/**
 * #1661's photograph, laid per building in the vertex shader — `facade.ts`
 * §`photographShiftOf`: the map's and the normal map's coordinates turned a
 * half turn or not, and shifted, by the building's seeded tint, so that
 * neighbours wearing one photograph do not share one brick's phase. Three
 * builds the normal map's frame from its coordinates' derivatives, so the
 * relief turns with the colour. No texture is fetched twice. And the
 * fragment's place in the world, for the weathering's noise; since #1735 the
 * building's age, which is the building's and so is worked out once a vertex
 * rather than once a fragment.
 */
const WEATHER_VERTEX_GLSL = /* glsl */ `
vOylWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
vOylAge = oylWeatherAgeOf(vOylTint);
float oylPhotoTurn = oylPhotoTurnOf(vOylTint);
vec2 oylPhotoShift = vec2(oylPhotoShiftUOf(vOylTint), oylPhotoShiftVOf(vOylTint));
#ifdef USE_MAP
vMapUv = vMapUv * oylPhotoTurn + oylPhotoShift;
#endif
#ifdef USE_NORMALMAP
vNormalMapUv = vNormalMapUv * oylPhotoTurn + oylPhotoShift;
#endif`;

/**
 * #1661's weathering, in GLSL — `facade.ts` §`weatheringAt`, a function an
 * effect, from {@link WEATHERING}'s numbers: the shared hash and value noise,
 * a building's age from its tint, and each effect's share or multiplier,
 * every one with detail fading to its mean over the fragment's footprint
 * `pw`. `surface` bakes in how much of a sill's streak this material's walls
 * show (`streakShareOf`) and whether its plinth is parged. With `weathering`
 * off (`realistic/config.ts` §`LEVERS`) none of it is built.
 */
function weatheringGlsl(built: boolean, surface: StructureSurface): string {
  if (!built) return '';
  const { tile, splash, streak, drip, courses, moss, parging } = WEATHERING;
  const parged = surface === 'render' || surface === 'concrete';
  return /* glsl */ `
  varying vec3 vOylWorld;
  flat varying float vOylAge;
  const float oylYoungest = ${glslFloat(WEATHERING.youngest)};
  const float oylTileNear = ${glslFloat(tile.scales[0])};
  const float oylTileFar = ${glslFloat(tile.scales[1])};
  const float oylTileNearW = ${glslFloat(tile.weights[0])};
  const float oylTileFarW = ${glslFloat(tile.weights[1])};
  const float oylTileStrength = ${glslFloat(tile.strength)};
  const float oylSplashLow = ${glslFloat(splash.top[0])};
  const float oylSplashHigh = ${glslFloat(splash.top[1])};
  const float oylSplashSolid = ${glslFloat(splash.solid)};
  const float oylSplashEdge = ${glslFloat(splash.edge)};
  const float oylSplashStrength = ${glslFloat(splash.strength)};
  const float oylSplashGrey = ${glslFloat(splash.grey)};
  const float oylStreakM = ${glslFloat(streak.metres)};
  const float oylStreakCol = ${glslFloat(streak.column)};
  const float oylStreakStrength = ${glslFloat(streak.strength)};
  const float oylStreakShare = ${glslFloat(streakShareOf(surface))};
  const float oylDripM = ${glslFloat(drip.metres)};
  const float oylDripCol = ${glslFloat(drip.column)};
  const float oylDripStrength = ${glslFloat(drip.strength)};
  const float oylCoursesM = ${glslFloat(courses.metres)};
  const float oylCoursesStrength = ${glslFloat(courses.strength)};
  const float oylMossScale = ${glslFloat(moss.scale)};
  const float oylMossDetail = ${glslFloat(moss.detail)};
  const float oylMossLow = ${glslFloat(moss.cover[0])};
  const float oylMossHigh = ${glslFloat(moss.cover[1])};
  const float oylMossFaceLow = ${glslFloat(moss.facing[0])};
  const float oylMossFaceHigh = ${glslFloat(moss.facing[1])};
  const float oylMossStrength = ${glslFloat(moss.strength)};
  const vec3 oylMossC = ${glslVec(moss.colour)};
  const float oylPargeLift = ${glslFloat(parging.lighten)};
  const float oylPargeRough = ${glslFloat(parging.rough)};
  const float oylParged = ${parged ? '1.0' : '0.0'};
  const float oylFlatRoofFlag = ${glslFloat(STYLE_FLAT_ROOF)};
  ${WEATHER_HASH_GLSL}
  float oylWeatherNoise(float a, float b) {
    float ia = floor(a);
    float ib = floor(b);
    float fa = a - ia;
    float fb = b - ib;
    float ua = fa * fa * (3.0 - 2.0 * fa);
    float ub = fb * fb * (3.0 - 2.0 * fb);
    float ma = mod(ia, 1000.0);
    float mb = mod(ib, 1000.0);
    float na = ma + 1.0 - 1000.0 * step(998.5, ma);
    float nb = mb + 1.0 - 1000.0 * step(998.5, mb);
    float lo = mix(oylWeatherHashFolded(ma, mb), oylWeatherHashFolded(na, mb), ua);
    float hi = mix(oylWeatherHashFolded(ma, nb), oylWeatherHashFolded(na, nb), ua);
    return mix(lo, hi, ub);
  }
  float oylWeatherShare(float age) {
    return oylYoungest + (1.0 - oylYoungest) * age;
  }
  float oylWeatherColumn(float along, float width, float seed, float pw) {
    return mix(0.4 + 1.2 * oylWeatherHash(floor(along / width), seed), 1.0, oylFadeOf(pw / width));
  }
  float oylWeatherTile(float a, float b, float pw) {
    float n1 = mix(oylWeatherNoise(a / oylTileNear, b / oylTileNear), 0.5, oylFadeOf(pw / oylTileNear));
    float n2 = mix(oylWeatherNoise(a / oylTileFar + 31.7, b / oylTileFar + 11.3), 0.5, oylFadeOf(pw / oylTileFar));
    return 1.0 + 2.0 * oylTileStrength * (oylTileNearW * n1 + oylTileFarW * n2 - 0.5);
  }
  float oylWeatherSplash(float up, float a, float age, float pw) {
    float broken = mix(oylWeatherNoise(a / oylSplashEdge, 7.0), 0.5, oylFadeOf(pw / oylSplashEdge));
    float height = mix(oylSplashLow, oylSplashHigh, broken);
    return oylWeatherShare(age) * (1.0 - smoothstep(oylSplashSolid * height, height, up));
  }
  float oylWeatherStreak(float below, float across, float halfWidth, float a, float share, float age, float pw) {
    float under = smoothstep(-pw, pw, below) * (1.0 - smoothstep(0.0, oylStreakM, below));
    float within = 1.0 - smoothstep(halfWidth - pw, halfWidth + pw, abs(across));
    return oylStreakStrength * share * oylWeatherShare(age) * under * within * oylWeatherColumn(a, oylStreakCol, 5.0, pw);
  }
  float oylWeatherDrip(float below, float a, float age, float pw) {
    float under = smoothstep(-pw, pw, below) * (1.0 - smoothstep(0.0, oylDripM, below));
    return oylDripStrength * oylWeatherShare(age) * under * oylWeatherColumn(a, oylDripCol, 9.0, pw);
  }
  float oylWeatherCourses(float upSlope, float age) {
    return oylCoursesStrength * oylWeatherShare(age) * (1.0 - smoothstep(0.0, oylCoursesM, upSlope));
  }
  float oylWeatherUpright(float upFacing) {
    return 1.0 - step(0.3, upFacing);
  }
  float oylWeatherPlaneA(float upFacing, float nx, float nz, float wx, float wz) {
    return upFacing > 0.7 ? wx : (abs(nx) > abs(nz) ? wz : wx);
  }
  float oylWeatherPlaneB(float upFacing, float wy, float wz) {
    return upFacing > 0.7 ? wz : wy;
  }
  float oylWeatherGrime(float upFacing, float faceOn, float up, float a, float age, float pw) {
    return oylWeatherUpright(upFacing) * faceOn * oylWeatherSplash(up, a, age, pw);
  }
  float oylWeatherPlinth(float upFacing, float faceOn, float top, float kind, float up) {
    return oylWeatherUpright(upFacing) * faceOn * (1.0 - step(0.5, top)) * (1.0 - step(0.5, kind)) * (1.0 - step(0.0, up));
  }
  float oylWeatherDripOn(float flags, float below, float a, float age, float pw) {
    return oylFlag(flags, oylFlatRoofFlag) * oylWeatherDrip(below, a, age, pw);
  }
  bool oylStreakNear(float shown, float below, float across, float halfWidth, float pw) {
    return shown > 0.0 && below > -pw && below < oylStreakM && abs(across) < halfWidth + pw;
  }
  bool oylDripNear(float flags, float below, float pw) {
    return oylFlag(flags, oylFlatRoofFlag) > 0.5 && below > -pw && below < oylDripM;
  }
  float oylWeatherMoss(float a, float b, float facing, float age, float pw) {
    float where = smoothstep(oylMossLow, oylMossHigh, oylWeatherNoise(a / oylMossScale + 3.1, b / oylMossScale + 5.7));
    // #1735: out of a patch it is nought, so its thickness is not worked out.
    // Pixels take this together except at a patch's edge.
    if (where <= 0.0) return 0.0;
    float thick = mix(0.4 + 1.2 * oylWeatherNoise(a / oylMossDetail + 8.3, b / oylMossDetail + 1.9), 1.0, oylFadeOf(pw / oylMossDetail));
    float up = smoothstep(oylMossFaceLow, oylMossFaceHigh, facing);
    return oylMossStrength * oylWeatherShare(age) * where * thick * up;
  }
`;
}

/**
 * #1661's splice into the cladding (§1 of {@link facadeFragmentGlsl}), after
 * every cladding branch and under the openings, so that the glass is never
 * grimed: the face's plane in the world and its footprint, its building's
 * age; the photograph's tile broken; a pitched roof's eaves courses and moss
 * on what faces up; splash grime at the foot of every plain or windowed face
 * — a plinth's too — and a render or concrete plinth parged. Its locals
 * (`oylAge`, `oylWpw`) are read by the sills' streaks and the drip after it.
 */
const WEATHER_CLADDING_GLSL = /* glsl */ `
    // #1661: the weathering. Derivatives here, out of every per-fragment branch;
    // since #1735 one pair of them, for the face's normal and its footprint alike
    // (fwidth is |dFdx| + |dFdy|), and the building's age from its vertices.
    vec3 oylWdx = dFdx(vOylWorld);
    vec3 oylWdy = dFdy(vOylWorld);
    vec3 oylWN = normalize(cross(oylWdx, oylWdy));
    vec3 oylWfw = abs(oylWdx) + abs(oylWdy);
    float oylWpw = max(max(max(oylWfw.x, oylWfw.y), oylWfw.z), 0.00001);
    float oylUpFacing = abs(oylWN.y);
    vec2 oylPlane = vec2(
      oylWeatherPlaneA(oylUpFacing, oylWN.x, oylWN.z, vOylWorld.x, vOylWorld.z),
      oylWeatherPlaneB(oylUpFacing, vOylWorld.y, vOylWorld.z)
    );
    float oylAge = vOylAge;
    float oylFaceOn = step(-0.5, oylTop);
    diffuseColor.rgb *= oylWeatherTile(oylPlane.x, oylPlane.y, oylWpw);
    float oylPitched = step(0.3, oylUpFacing) * (1.0 - step(0.97, oylUpFacing));
    diffuseColor.rgb *= 1.0 - oylPitched * oylFaceOn * oylWeatherCourses(vOylFacade.y, oylAge);
    // #1735: moss only where it can be — on a drawn face that faces up past its
    // lowest facing, where oylWeatherMoss is nought — a face's, so a branch its
    // pixels take together. A wall pays none of its two noises.
    if (oylFaceOn > 0.5 && oylUpFacing > oylMossFaceLow) {
      diffuseColor.rgb = mix(diffuseColor.rgb, oylMossC, oylWeatherMoss(oylPlane.x, oylPlane.y, oylUpFacing, oylAge, oylWpw));
    }
    float oylUp = mix(vOylFacade.y, vOylFacade.y * oylStoreyM, oylStoreyed);
    // #1735: the splash only under its highest top, on an upright drawn face,
    // where oylWeatherGrime is nought: a band along the wall's foot.
    if (oylUp < oylSplashHigh && oylFaceOn > 0.5 && oylUpFacing < 0.3) {
      float oylGrime = oylWeatherGrime(oylUpFacing, oylFaceOn, oylUp, oylPlane.x, oylAge, oylWpw);
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722))), oylSplashGrey * oylGrime)
        * (1.0 - oylSplashStrength * oylGrime);
    }
    float oylPlinth = oylWeatherPlinth(oylUpFacing, oylFaceOn, oylTop, oylKind, oylUp);
    float oylParging = oylParged * oylPlinth;
    diffuseColor.rgb *= 1.0 + oylPargeLift * oylParging;
    oylFlat = max(oylFlat, oylParging);
    oylRough = mix(oylRough, oylPargeRough, oylParging);`;

/** #1661's streaks under a sash's sill (§2 of {@link facadeFragmentGlsl}): its span and overrun. */
const WEATHER_SASH_STREAK_GLSL = /* glsl */ `
        float oylSillSpan = mix(oylWinW * 0.5, oylWinW + oylMullion * 0.5, oylPaired) + oylSillOver;
        float oylStreakBelow = oylSillM - oylSillDepth - oylP.y;
        if (oylStreakNear(oylShown, oylStreakBelow, oylP.x, oylSillSpan, oylMw.x)) {
          diffuseColor.rgb *= 1.0 - oylShown * oylWeatherStreak(
            oylStreakBelow, oylP.x, oylSillSpan, oylM.x, oylStreakAt, oylAge, oylMw.x
          );
        }`;

/** #1661's streaks under a casement's sill (§2 of {@link facadeFragmentGlsl}), in metres. */
const WEATHER_CASEMENT_STREAK_GLSL = /* glsl */ `
        float oylStreakBelow = (oylWB - oylSillU - oylAt.y) * oylStoreyM;
        float oylStreakAcross = (oylAt.x - 0.5) * vOylStyle.z;
        float oylStreakHalf = (0.5 - oylWL + oylSillA) * vOylStyle.z;
        if (oylStreakNear(oylShown, oylStreakBelow, oylStreakAcross, oylStreakHalf, oylMw.x)) {
          diffuseColor.rgb *= 1.0 - oylShown * oylWeatherStreak(
            oylStreakBelow, oylStreakAcross, oylStreakHalf, oylM.x, oylStreakAt, oylAge, oylMw.x
          );
        }`;

/** #1661's drip down a flat roof's wall from its parapet (§3 of {@link facadeFragmentGlsl}). */
const WEATHER_DRIP_GLSL = /* glsl */ `
      float oylDripBelow = (oylTop - vOylFacade.y) * oylStoreyM;
      if (oylDripNear(oylFlags, oylDripBelow, oylMw.y)) {
        diffuseColor.rgb *= 1.0 - oylWeatherDripOn(oylFlags, oylDripBelow, oylM.x, oylAge, oylMw.y);
      }`;

/**
 * {@link CLADDING_HELPERS_GLSL}, a mapped building's varyings, #1659's reveal
 * ({@link revealGlsl}) and its sash window, which since #1659 takes the eye
 * and the sun in the face's frame (`e`, `s`) for the reveal, and gives back
 * the opening's `side` seen past the glass, whether it is `sideLit`, and the
 * wall in its sill's shadow (`sillShade`); since #1658 the overhang's
 * shadow ({@link overhangGlsl}).
 */
function facadeCommonGlsl(
  reveals: boolean,
  overhangs: boolean,
  weathering: boolean,
  surface: StructureSurface,
): string {
  return /* glsl */ `
  uniform float oylFacadeOn;
  uniform vec3 oylSunWorld;
  varying vec4 vOylFacade;
  varying vec4 vOylStyle;
  varying vec3 vOylTrim;
  ${CLADDING_HELPERS_GLSL}
  ${revealGlsl(reveals)}
  ${overhangGlsl(overhangs)}
  ${weatheringGlsl(weathering, surface)}
  void oylSash(
    vec2 p, vec2 pw, vec3 win, float bay, float paired, float picture, float shutters, vec3 e, vec3 s,
    out float frame, out float glass, out float reveal, out float shutter, out float sill,
    out float side, out float sideLit, out float sillShade
  ) {
    float oylHalfW = win.x * 0.5;
    float oylHead = win.z + win.y;
    float oylAcross = mix(p.x, abs(p.x) - (oylHalfW + oylMullion * 0.5), paired);
    float oylSpan = mix(oylHalfW, win.x + oylMullion * 0.5, paired);
    float oylOuter = oylRect(p, vec2(-oylSpan, win.z), vec2(oylSpan, oylHead), pw);
    // #1659: across this one window, unfolded, so that its +u jamb is on its +u side.
    vec2 oylLocal = vec2(p.x - paired * sign(p.x) * (oylHalfW + oylMullion * 0.5), p.y);
    vec2 oylLo = vec2(-oylHalfW + oylSashFrame, win.z + oylSashFrame);
    vec2 oylHi = vec2(oylHalfW - oylSashFrame, oylHead - oylSashFrame);
    float oylInner = oylRect(oylLocal, oylLo, oylHi, pw);
    float oylOpen = oylInner * oylOuter;
    // #1735: the reveal only in the opening. Outside it every one of its outs
    // is multiplied by the opening's nought, so the wall round a window, most
    // of a facade, pays none of it.
    vec2 oylQ = oylLocal;
    float oylSeen = 1.0;
    sideLit = 1.0;
    reveal = 0.0;
    if (oylOpen > 0.0) {
      oylRevealOf(oylLocal, oylLo, oylHi, pw, e, s, oylQ, oylSeen, sideLit, reveal);
    }
    // The meeting rail is the sashes', behind the frame: where the glass is seen.
    float oylRailOn = (1.0 - picture)
      * (1.0 - smoothstep(oylRail * 0.5 - pw.y, oylRail * 0.5 + pw.y, abs(oylQ.y - (win.z + win.y * 0.5))));
    glass = oylOpen * oylSeen * (1.0 - oylRailOn);
    side = oylOpen * (1.0 - oylSeen);
    frame = max(oylOuter - glass - side, 0.0);
    float oylShutterW = win.x * oylShutterShare;
    float oylOut = mix(abs(p.x), oylAcross, paired);
    float oylFits = step(2.0 * (oylSpan + oylShutterGap + oylShutterW + oylShutterMargin), bay);
    shutter = shutters * (1.0 - picture) * oylFits
      * oylBand(oylOut, oylHalfW + oylShutterGap, oylHalfW + oylShutterGap + oylShutterW, pw.x)
      * oylBand(p.y, win.z, oylHead, pw.y);
    vec2 oylSillLo = vec2(-oylSpan - oylSillOver, win.z - oylSillDepth);
    vec2 oylSillHi = vec2(oylSpan + oylSillOver, win.z);
    sill = oylRect(p, oylSillLo, oylSillHi, pw) * (1.0 - oylOuter);
    // #1735: the sill's shadow only under the sill, where its band is not nought.
    sillShade = p.y < oylSillLo.y + pw.y
      ? oylSillShadeOf(p, oylSillLo, oylSillHi, pw, s) * (1.0 - sill) * (1.0 - oylOuter)
      : 0.0;
  }
`;
}

/**
 * #1658's splice into the shade (§3 of {@link facadeFragmentGlsl}): on a wall
 * under eaves the sun lights, the darker of #1588's band and the sun's shadow
 * from the eaves' edge, `facade.ts` §`eavesShadeAt` — how dark it is fading
 * as the sun comes round to graze the wall. `oylEavesShade` is the band's.
 */
const OVERHANG_SHADE_GLSL = /* glsl */ `
      // #1735: on a wall with eaves only — the building's flag, so a branch its pixels take together.
      if (oylFlag(oylFlags, oylEavesFlag) > 0.5) {
        float oylBelowTop = (oylTop - vOylFacade.y) * oylStoreyM;
        float oylSunShadow = 1.0 - (1.0 - oylOverhangShade) * clamp(oylSunF.z / oylOverhangSquare, 0.0, 1.0)
          * oylOverhangShadow(oylBelowTop - oylEavesEdge, oylEavesOverhang, oylSunF, oylMw.y, oylTop * oylStoreyM);
        oylEavesShade = min(oylEavesShade, oylSunShadow);
      }`;

/**
 * #1636's curtain wall, in GLSL — `facade.ts` §`curtainWallPartAt` from the
 * same numbers: in every storey up to the eaves, glass over an opaque
 * spandrel with a transom between, and mullions at an even module across
 * each bay; faded far off to the three parts' mean by their shares. The
 * glass is flat — a dark pane that gives back the sky through the finish
 * (`oylGlass`) — until #1662 puts rooms behind it.
 */
const CURTAIN_WALL_GLSL = /* glsl */ `
        float oylBayW = max(vOylStyle.z, 0.1);
        float oylModules = max(1.0, floor(oylBayW / oylCurtainModule + 0.5));
        float oylModW = oylBayW / oylModules;
        vec2 oylP = vec2(oylAt.x * oylBayW, oylAt.y * oylStoreyM);
        float oylOnWall = step(0.0, oylCell.y) * (1.0 - step(vOylFacade.z, vOylFacade.y));
        float oylMull = oylLine(oylP.x / oylModW, oylCurtainMullion * 0.5 / oylModW, oylMw.x / oylModW);
        float oylTransomBar = oylBand(oylP.y, oylCurtainSpandrel - oylCurtainMullion * 0.5, oylCurtainSpandrel + oylCurtainMullion * 0.5, oylMw.y);
        float oylBars = max(oylMull, oylTransomBar);
        float oylSpandrel = (1.0 - smoothstep(oylCurtainSpandrel - oylMw.y, oylCurtainSpandrel + oylMw.y, oylP.y)) * (1.0 - oylBars);
        // As every window kind's since #1659: the glass set back behind its mullions, the
        // transom and the next storey's spandrel, its side seen past it and the sun's shadow on it.
        float oylK = floor(oylP.x / oylModW);
        vec2 oylLo = vec2(oylK * oylModW + oylCurtainMullion * 0.5, oylCurtainSpandrel + oylCurtainMullion * 0.5);
        vec2 oylHi = vec2((oylK + 1.0) * oylModW - oylCurtainMullion * 0.5, oylStoreyM);
        float oylOpen = (1.0 - oylSpandrel) * (1.0 - oylBars);
        // #1735: only where the glass is open, as the sash's.
        vec2 oylQ = oylP;
        float oylSeen = 1.0;
        float oylSideLit = 1.0;
        float oylShadeOn = 0.0;
        if (oylOpen > 0.0) {
          oylRevealOf(oylP, oylLo, oylHi, oylMw, oylEyeF, oylSunF, oylQ, oylSeen, oylSideLit, oylShadeOn);
        }
        float oylPaneOn = oylOpen * oylSeen;
        float oylSide = oylOpen * (1.0 - oylSeen);
        vec3 oylPaneC = oylCurtainGlassC * (1.0 - oylRevealShade * oylShadeOn);
        vec3 oylSideC = oylCurtainMullionC * (1.0 - oylRevealShade * (1.0 - oylSideLit));
        vec3 oylDrawn = mix(
          mix(mix(oylPaneC, oylCurtainSpandrelC, oylSpandrel), oylCurtainMullionC, oylBars),
          oylSideC,
          oylSide
        );
        float oylBarShare = min(1.0, oylCurtainMullion / oylModW + oylCurtainMullion / oylStoreyM);
        float oylSpandrelShare = (oylCurtainSpandrel / oylStoreyM) * (1.0 - oylBarShare);
        vec3 oylMean = oylCurtainMullionC * oylBarShare + oylCurtainSpandrelC * oylSpandrelShare
          + oylCurtainGlassC * max(0.0, 1.0 - oylBarShare - oylSpandrelShare);
        float oylFade = oylFadeOf(max(oylMw.x / oylModW, oylMw.y / oylStoreyM));
        diffuseColor.rgb = mix(diffuseColor.rgb, mix(oylDrawn, oylMean, oylFade), oylOnWall);
        oylGlass = oylPaneOn * (1.0 - oylFade) * oylOnWall;
        oylFlat = max(oylFlat, oylOnWall);
        oylRough = mix(oylRough, 0.3, oylOnWall);
        oylTilt = 0.0;`;

/**
 * Whether a bay has a window at all, as a GLSL expression over `oylCell`,
 * `oylTopShare` (a window's top as a share of its storey: #1581's casement's
 * or, since #1588, a sash's) and `vOylFacade` (`facade.ts` §`facadePartAt`'s
 * eaves and door-bay rules). Split out so a test can run the very text the
 * shader runs.
 *
 * Exported for `three-renderer.test.ts`, which runs it against `facadePartAt`.
 */
export const FACADE_SHOWN_GLSL =
  'step(0.0, oylCell.y) * step(oylCell.y + oylTopShare, vOylFacade.z) * (1.0 - step(oylCell.y, 0.5) * step(abs(oylCell.x - vOylFacade.w), 0.5))';

/**
 * #1581's facade, drawn over the surface's photograph after its colour —
 * `facade.ts` §`facadePartAt`'s layout, from `footprint-buildings.ts`
 * §`FACADE_FLOATS`' four numbers. `oylGlass` and `oylFlat` carry on to the
 * finish: a pane is smooth and a little metallic, so it gives back the sky the
 * environment map holds, and paint is smoother than brick and loses the
 * photograph's relief. Past a few pixels a bay, the layout fades to its mean,
 * so a far street does not shimmer.
 *
 * Since #1588, in three steps:
 *
 * 1. **The cladding** (`STYLE_FLOATS`' `clad`), in place of the photograph:
 *    clapboard courses in the house's paint, with a shadow under each lap
 *    and a normal tilt (`oylTilt`) for the finish; shingles in staggered
 *    tabs; a foundation's bond — on a plinth, and at a clapboard wall's foot
 *    — and a driveway's slabs. Each fades to its mean as #1581's windows do.
 * 2. **The openings**: #1581's casements, or US sash windows (`STYLE_SASH`)
 *    with their meeting rail, a pair in a wide bay, a picture window, the
 *    shutters; a dormer's sash; a garage's panelled door. Since #1659 every
 *    window kind's inset reveal (`oylRevealOf`, {@link revealGlsl}): the
 *    glass shifted by the recess along the eye's slant, the opening's side
 *    it uncovers lit or not by the sun, and the head's, the sun-side jamb's
 *    and the sill's shadows as deep as the sun's slant makes them — the eye
 *    and the sun read in the face's frame (`oylFaceN`, `oylFaceU`,
 *    `oylFaceUp`, from the face's derivatives; the sun {@link FACADE_SUN}'s).
 * 3. **The shade**: a wall darkened under overhanging eaves and at its foot.
 *    Since #1658, on a wall the sun lights, the darker of that band and the
 *    sun's own shadow from the eaves' edge, as deep as the sun's slant makes
 *    it (`oylOverhangShadow`, {@link overhangGlsl}); with `overhangs` false,
 *    the band alone, as before.
 *
 * Since #1661, with `weathering`, each step weathers its own part
 * ({@link weatheringGlsl}): after the cladding and under the openings, the
 * photograph's repeat broken, a roof's eaves courses and moss, a face's
 * splash grime and a plinth's parging ({@link WEATHER_CLADDING_GLSL}); in
 * the openings, the wall under each sill streaked; in the shade, a flat
 * roof's wall dripped on from its parapet. Without it, none of it is built.
 *
 * ⚠️ `vOylTint` is #1549's ({@link withVertexTint}), read here in `main` —
 * after every declaration — so that one window in five is a lit room by
 * where it is on which building, not the same window on every house.
 */
function facadeFragmentGlsl(overhangs: boolean, weathering: boolean): string {
  return /* glsl */ `
  float oylGlass = 0.0;
  float oylFlat = 0.0;
  float oylRough = 0.6;
  float oylTilt = 0.0;
  // The sun's side along the face's u, from the face's own derivatives: outside every branch.
  float oylSun = 0.0;
  // #1659: the face's frame, in view space and every one unit length, outside
  // the block so that the reveal (and #1658) read it: the face's outward
  // normal, along its u, up it toward +v, toward the sun and toward the eye.
  vec3 oylFaceN;
  vec3 oylFaceU;
  vec3 oylFaceUp;
  vec3 oylToSunV;
  vec3 oylToEyeV;
  {
    vec3 oylQx = dFdx(vViewPosition);
    vec3 oylQy = dFdy(vViewPosition);
    vec3 oylN = normalize(cross(oylQx, oylQy));
    vec3 oylAlongU = -(cross(oylQy, oylN) * dFdx(vOylFacade.x) + cross(oylN, oylQx) * dFdy(vOylFacade.x));
    vec3 oylToSun = normalize((viewMatrix * vec4(oylSunWorld, 0.0)).xyz);
    float oylAlongLength = length(oylAlongU);
    float oylSunAcross = oylAlongLength > 1e-8 ? dot(oylAlongU / oylAlongLength, oylToSun) : 0.0;
    oylSun = step(0.0, dot(oylN, oylToSun)) * sign(oylSunAcross) * step(0.15, abs(oylSunAcross));
    oylFaceN = oylN;
    oylFaceU = oylAlongLength > 1e-8 ? oylAlongU / oylAlongLength : vec3(0.0);
    vec3 oylAlongV = -(cross(oylQy, oylN) * dFdx(vOylFacade.y) + cross(oylN, oylQx) * dFdy(vOylFacade.y));
    vec3 oylUpward = cross(oylFaceN, oylFaceU);
    float oylUpLength = length(oylUpward);
    oylFaceUp = oylUpLength > 1e-8
      ? oylUpward / oylUpLength * (dot(oylUpward, oylAlongV) < 0.0 ? -1.0 : 1.0)
      : vec3(0.0);
    oylToSunV = oylToSun;
    // ⚠️ three's vViewPosition is already the NEGATED view position
    // (vViewPosition = - mvPosition.xyz), so it points to the eye as it is.
    oylToEyeV = normalize(vViewPosition);
  }
  vec2 oylFw = max(fwidth(vOylFacade.xy), vec2(0.00001));
  if (oylFacadeOn < 0.5) {
    // The control: the photograph alone, as #1549 drew it.
  } else {
    float oylTop = vOylFacade.z;
    // #1659: the eye and the sun in the face's frame, for every window's reveal.
    vec3 oylEyeF = vec3(dot(oylToEyeV, oylFaceU), dot(oylToEyeV, oylFaceUp), dot(oylToEyeV, oylFaceN));
    vec3 oylSunF = vec3(dot(oylToSunV, oylFaceU), dot(oylToSunV, oylFaceUp), dot(oylToSunV, oylFaceN));
    float oylKind = floor(vOylStyle.x + 0.0001);
    float oylCourse = max(vOylStyle.x - oylKind, 0.001);
    float oylFlags = vOylStyle.y;
    // Metres across and up the face: a wall's bays and storeys, or metres already.
    float oylStoreyed = step(-0.5, oylTop) * (1.0 - step(1.5, oylKind));
    vec2 oylScale = vec2(
      oylTop > 0.0 ? vOylStyle.z : mix(1.0, oylBayM, oylStoreyed),
      mix(1.0, oylStoreyM, oylStoreyed)
    );
    vec2 oylM = vOylFacade.xy * oylScale;
    vec2 oylMw = max(oylFw * oylScale, vec2(0.00001));
    // 1. The cladding.
    if (abs(oylKind - oylClapboard) < 0.5) {
      float oylT = oylM.y / oylCourse;
      float oylTw = oylMw.y / oylCourse;
      float oylF = fract(oylT);
      float oylFade = oylFadeOf(oylTw);
      float oylLap = smoothstep(1.0 - oylLapShadow - oylTw, 1.0 - oylLapShadow + oylTw, oylF);
      float oylButtStrip = 1.0 - smoothstep(oylButt - oylTw, oylButt + oylTw, oylF);
      float oylBoard = 1.0 + 0.05 * (oylWindowHash(vec2(floor(oylT), floor(vOylTint.x * 1000.0))) - 0.5);
      float oylShade = (1.0 - oylLapDepth * oylLap + oylButtBright * oylButtStrip) * oylBoard;
      float oylMean = 1.0 - oylLapDepth * oylLapShadow + oylButtBright * oylButt;
      diffuseColor.rgb = vColor.rgb * oylSidingWhite * mix(oylShade, oylMean, oylFade);
      oylFlat = 1.0;
      oylRough = 0.55;
      oylTilt = (1.0 - oylFade) * mix(oylLapTilt, -oylButtTilt, oylLap);
      // The foundation band at the wall's foot, above the plinth.
      float oylBandOn = oylStoreyed * (1.0 - step(oylBandM, oylM.y));
      diffuseColor.rgb = mix(
        diffuseColor.rgb,
        oylBond(oylM, oylMw, oylFlag(oylFlags, oylBrickFlag)) * oylBandShade,
        oylBandOn
      );
      oylTilt *= 1.0 - oylBandOn;
    } else if (abs(oylKind - oylShingle) < 0.5) {
      float oylRow = floor(oylM.y / oylCourse);
      float oylF = fract(oylM.y / oylCourse);
      float oylTw = oylMw.y / oylCourse;
      float oylTabT = oylM.x / oylTab + 0.5 * mod(oylRow, 2.0);
      float oylTabW = oylMw.x / oylTab;
      float oylKey = oylLine(oylTabT, oylKeyway * 0.5 / oylTab, oylTabW);
      float oylShadow = smoothstep(1.0 - oylShingleShadow - oylTw, 1.0 - oylShingleShadow + oylTw, oylF);
      float oylGrain = oylWindowHash(vec2(oylRow, floor(oylTabT)) + floor(vOylTint.xy * 1000.0));
      float oylShade = (1.0 - oylShingleDepth * oylShadow) * (1.0 - oylKeywayDepth * oylKey)
        * (1.0 + oylShingleVary * (oylGrain - 0.5));
      float oylMean = (1.0 - oylShingleDepth * oylShingleShadow) * (1.0 - oylKeywayDepth * oylKeyway / oylTab);
      diffuseColor.rgb = vColor.rgb * mix(oylShade, oylMean, oylFadeOf(max(oylTw, oylTabW)));
      oylFlat = 1.0;
      oylRough = 0.9;
    } else if (oylKind > oylBlockCode - 0.5 && oylKind < oylBrickCode + 0.5) {
      diffuseColor.rgb = oylBond(oylM, oylMw, step(oylBrickCode - 0.5, oylKind)) * vColor.rgb;
      oylFlat = 1.0;
      oylRough = 0.9;
    } else if (abs(oylKind - oylPaving) < 0.5) {
      float oylSlabW = oylMw.y / oylSlab;
      float oylFade = oylFadeOf(oylSlabW);
      float oylJoint = oylLine(oylM.y / oylSlab, oylSlabJoint * 0.5 / oylSlab, oylSlabW) * (1.0 - oylFade);
      float oylVary = mix(
        0.94 + 0.12 * oylWindowHash(vec2(floor(oylM.y / oylSlab), floor(vOylTint.x * 1000.0))),
        1.0,
        oylFade
      );
      diffuseColor.rgb = oylPavingC * vColor.rgb * oylVary * (1.0 - 0.5 * oylJoint);
      oylFlat = 1.0;
      oylRough = 0.85;
    }
    ${weathering ? WEATHER_CLADDING_GLSL : ''}
    // 2. The openings.
    if (oylTop > 0.0) {
      vec2 oylCell = floor(vOylFacade.xy);
      vec2 oylAt = vOylFacade.xy - oylCell;
      float oylSashOn = oylFlag(oylFlags, oylSashFlag);
      // #1590: a commercial wall's taller window, a sash's own top, or #1581's casement's.
      float oylComOn = oylFlag(oylFlags, oylCommercialFlag);
      float oylTopShare = mix(mix(oylWinT, oylCwT, oylComOn), oylSashTop, oylSashOn);
      float oylShown = ${FACADE_SHOWN_GLSL};
      vec3 oylWall = diffuseColor.rgb;
      float oylLit = step(0.8, oylWindowHash(oylCell + floor(vOylTint.xy * 1000.0)));
      ${weathering ? 'float oylStreakAt = mix(oylStreakShare, 1.0, step(abs(oylKind - oylClapboard), 0.5));' : ''}
      vec3 oylRoom = mix(vec3(0.012, 0.014, 0.018), vec3(0.09, 0.07, 0.045), oylLit);
      if (oylFlag(oylFlags, oylGlazedFlag) > 0.5) {
        ${CURTAIN_WALL_GLSL}
      } else if (oylSashOn > 0.5) {
        float oylBayW = vOylStyle.z;
        vec2 oylP = vec2((oylAt.x - 0.5) * oylBayW, oylAt.y * oylStoreyM);
        float oylPicture = (1.0 - step(0.5, oylCell.y)) * (1.0 - step(0.5, abs(oylCell.x - vOylStyle.w)));
        float oylPaired = step(oylPairMin, oylBayW) * (1.0 - oylPicture);
        float oylWinW = mix(oylSashW, min(oylBayW - oylPicMargin, oylPicMost), oylPicture);
        float oylFrameOn;
        float oylPaneOn;
        float oylRevealOn;
        float oylShutterOn;
        float oylSillOn;
        float oylSideOn;
        float oylSideLit;
        float oylSillShade;
        oylSash(
          oylP, oylMw, vec3(oylWinW, oylSashH, oylSillM), oylBayW, oylPaired, oylPicture,
          oylFlag(oylFlags, oylShuttersFlag), oylEyeF, oylSunF,
          oylFrameOn, oylPaneOn, oylRevealOn, oylShutterOn, oylSillOn,
          oylSideOn, oylSideLit, oylSillShade
        );
        oylFrameOn *= oylShown;
        oylPaneOn *= oylShown;
        oylShutterOn *= oylShown;
        oylSillOn *= oylShown;
        oylSideOn *= oylShown;
        oylSillShade *= oylShown;
        vec3 oylPane = (oylRoom + vec3(0.03, 0.04, 0.05) * smoothstep(oylSillM, oylSillM + oylSashH, oylP.y))
          * (1.0 - oylRevealShade * oylRevealOn);
        float oylSlat = oylLine(oylP.y / oylLouvre, 0.15, oylMw.y / oylLouvre);
        vec3 oylShutterC = vOylTrim * (0.92 - 0.25 * oylSlat);
        // #1659: the opening's side is the wall's, in the sun or out of it.
        vec3 oylSideC = oylWall * (1.0 - oylRevealShade * (1.0 - oylSideLit));
        vec3 oylDrawn = mix(
          mix(
            mix(
              mix(mix(oylWall * (1.0 - oylRevealShade * oylSillShade), oylShutterC, oylShutterOn), vOylTrim, oylFrameOn),
              vOylTrim * 0.85,
              oylSillOn
            ),
            oylSideC,
            oylSideOn
          ),
          oylPane,
          oylPaneOn
        );
        float oylArea = oylShown * oylWinW * (1.0 + oylPaired) * oylSashH / (oylBayW * oylStoreyM);
        vec3 oylMean = mix(oylWall, mix(vOylTrim, oylRoom, 0.75), oylArea);
        float oylFade = oylFadeOf(max(oylMw.x / oylBayW, oylMw.y / oylStoreyM));
        diffuseColor.rgb = mix(oylDrawn, oylMean, oylFade);
        ${weathering ? WEATHER_SASH_STREAK_GLSL : ''}
        float oylParts = max(max(max(oylFrameOn, oylSillOn), oylShutterOn), oylSideOn) * (1.0 - oylFade);
        oylGlass = oylPaneOn * (1.0 - oylFade);
        oylFlat = max(oylFlat, oylParts);
        oylTilt *= 1.0 - min(1.0, oylParts + oylGlass);
      } else {
        vec2 oylW = oylFw * 0.5;
        // #1590: a commercial wall's window is #1581's laid out taller.
        float oylWL = mix(oylWinL, oylCwL, oylComOn);
        float oylWR = mix(oylWinR, oylCwR, oylComOn);
        float oylWB = mix(oylWinB, oylCwB, oylComOn);
        float oylWT = mix(oylWinT, oylCwT, oylComOn);
        float oylWTr = mix(oylTransom, oylCwTransom, oylComOn);
        float oylOuter = oylRect(oylAt, vec2(oylWL, oylWB), vec2(oylWR, oylWT), oylW) * oylShown;
        vec2 oylLo = vec2(oylWL + oylFrameA, oylWB + oylFrameU);
        vec2 oylHi = vec2(oylWR - oylFrameA, oylWT - oylFrameU);
        float oylInner = oylRect(oylAt, oylLo, oylHi, oylW);
        // #1659: the reveal, in metres — the bay as wide as the wall's style lays it.
        vec2 oylToM = vec2(vOylStyle.z, oylStoreyM);
        // #1735: only in the opening, as the sash's: outside it every out is multiplied by nought.
        vec2 oylQ = oylAt * oylToM;
        float oylSeen = 1.0;
        float oylSideLit = 1.0;
        float oylShadeOn = 0.0;
        if (oylInner * oylShown > 0.0) {
          oylRevealOf(oylAt * oylToM, oylLo * oylToM, oylHi * oylToM, oylW * oylToM, oylEyeF, oylSunF, oylQ, oylSeen, oylSideLit, oylShadeOn);
        }
        // The mullion and the transom are the glazing's, behind the frame: where the glass is seen.
        vec2 oylGlassAt = oylQ / oylToM;
        float oylBars = max(
          1.0 - smoothstep(oylBarA - oylW.x, oylBarA + oylW.x, abs(oylGlassAt.x - 0.5)),
          1.0 - smoothstep(oylBarU - oylW.y, oylBarU + oylW.y, abs(oylGlassAt.y - oylWTr))
        );
        float oylPaneShare = oylInner * oylSeen * (1.0 - oylBars) * oylShown;
        float oylSide = oylInner * (1.0 - oylSeen) * oylShown;
        float oylFrame = max(oylOuter - oylPaneShare - oylSide, 0.0);
        vec2 oylSillLo = vec2(oylWL - oylSillA, oylWB - oylSillU);
        vec2 oylSillHi = vec2(oylWR + oylSillA, oylWB);
        float oylSill = oylRect(oylAt, oylSillLo, oylSillHi, oylW) * oylShown;
        float oylSillShade = oylAt.y < oylSillLo.y + oylW.y
          ? oylSillShadeOf(oylAt * oylToM, oylSillLo * oylToM, oylSillHi * oylToM, oylW * oylToM, oylSunF)
            * (1.0 - oylSill) * (1.0 - oylOuter) * oylShown
          : 0.0;
        vec3 oylPane = oylRoom + vec3(0.03, 0.04, 0.05) * smoothstep(oylWB, oylWT, oylAt.y);
        vec3 oylSideC = oylWall * (1.0 - oylRevealShade * (1.0 - oylSideLit));
        vec3 oylDrawn = mix(
          mix(
            mix(mix(oylWall * (1.0 - oylRevealShade * oylSillShade), vOylTrim, oylFrame), vOylTrim * 0.85, oylSill),
            oylSideC,
            oylSide
          ),
          oylPane * (1.0 - oylRevealShade * oylShadeOn),
          oylPaneShare
        );
        float oylArea = (oylWR - oylWL) * (oylWT - oylWB) * oylShown;
        vec3 oylMean = mix(oylWall, mix(vOylTrim, oylPane, 0.75), oylArea);
        float oylFade = clamp(max(oylW.x, oylW.y) * 8.0 - 0.5, 0.0, 1.0);
        diffuseColor.rgb = mix(oylDrawn, oylMean, oylFade);
        ${weathering ? WEATHER_CASEMENT_STREAK_GLSL : ''}
        oylGlass = oylPaneShare * (1.0 - oylFade);
        oylFlat = max(oylFlat, max(oylOuter, oylSill) * (1.0 - oylFade));
      }
      // 3. The shade: under overhanging eaves, and at the wall's foot.
      float oylUnderEaves = oylFlag(oylFlags, oylEavesFlag)
        * (1.0 - smoothstep(0.0, oylAoEavesM, (oylTop - vOylFacade.y) * oylStoreyM));
      float oylAtFoot = 1.0 - smoothstep(0.0, oylAoBaseM, vOylFacade.y * oylStoreyM);
      float oylEavesShade = 1.0 - (1.0 - oylAoEaves) * oylUnderEaves;
      ${overhangs ? OVERHANG_SHADE_GLSL : ''}
      diffuseColor.rgb *= oylEavesShade * (1.0 - (1.0 - oylAoBase) * oylAtFoot);
      ${weathering ? WEATHER_DRIP_GLSL : ''}
    } else if (oylTop < -0.5 && oylTop > -1.5) {
      vec2 oylAt = vOylFacade.xy;
      vec2 oylW = oylFw * 0.5;
      float oylLeaf = oylRect(oylAt, vec2(oylDoorA, -1.0), vec2(1.0 - oylDoorA, 1.0 - oylDoorU), oylW);
      float oylFanlight = oylRect(
        oylAt,
        vec2(oylDoorA + 0.04, oylFan),
        vec2(1.0 - oylDoorA - 0.04, 1.0 - oylDoorU - 0.02),
        oylW
      );
      float oylPanels = oylRect(
        vec2(abs(oylAt.x - 0.5), oylAt.y),
        vec2(0.05, 0.08),
        vec2(0.27, oylFan - 0.06),
        oylW
      );
      vec3 oylDoor = mix(vOylTrim, vColor.rgb * (1.0 - 0.3 * oylPanels), oylLeaf);
      diffuseColor.rgb = mix(oylDoor, vec3(0.02, 0.025, 0.03), oylFanlight);
      oylFlat = 1.0;
      oylGlass = oylFanlight;
      if (oylFlag(vOylStyle.y, oylCommercialFlag) > 0.5) {
        // #1590: a shop's door — a glazed leaf in its frame, set back in a recess.
        vec2 oylD = oylAt * vec2(oylDoorW, oylDoorH);
        vec2 oylDw = oylW * 2.0 * vec2(oylDoorW, oylDoorH);
        float oylIn = oylRect(oylD, vec2(oylDoorSurround, -1.0), vec2(oylDoorW - oylDoorSurround, oylDoorH - oylDoorSurround), oylDw);
        float oylPane = oylRect(
          oylD,
          vec2(oylDoorSurround + oylShopDoorFrame, oylShopDoorRail),
          vec2(oylDoorW - oylDoorSurround - oylShopDoorFrame, oylDoorH - oylDoorSurround - oylShopDoorFrame),
          oylDw
        );
        vec3 oylRecess = vec3(0.035, 0.033, 0.03);
        vec3 oylShopPane = vec3(0.02, 0.025, 0.03) + vec3(0.05, 0.04, 0.025) * step(0.5, oylWindowHash(floor(vOylTint.xy * 1000.0)));
        diffuseColor.rgb = mix(oylRecess, mix(vOylTrim, oylShopPane, oylPane), oylIn);
        oylGlass = oylPane;
      }
      // #1626: the winter lights' wreath, on the door's own quad.
      diffuseColor.rgb = oylWreathed(diffuseColor.rgb, (oylAt.x - 0.5) * oylDoorW, oylAt.y * oylDoorH, oylWreath);
    } else if (oylTop < -1.5 && oylTop > -2.5) {
      diffuseColor.rgb = vColor.rgb;
      oylFlat = 1.0;
    } else if (abs(oylTop - oylDormerTop) < 0.5) {
      // A dormer's front: one sash in the middle of its cladding.
      float oylFaceW = vOylStyle.z;
      float oylFaceH = vOylStyle.w;
      vec2 oylP = vec2(vOylFacade.x - oylFaceW * 0.5, vOylFacade.y);
      vec3 oylWin = vec3(
        min(oylDormerW, oylFaceW - 2.0 * oylDormerMargin),
        min(oylDormerH, oylFaceH - oylDormerSill - oylDormerMargin),
        oylDormerSill
      );
      float oylFrameOn;
      float oylPaneOn;
      float oylRevealOn;
      float oylShutterOn;
      float oylSillOn;
      float oylSideOn;
      float oylSideLit;
      float oylSillShade;
      oylSash(
        oylP, oylMw, oylWin, oylFaceW, 0.0, 0.0, 0.0, oylEyeF, oylSunF,
        oylFrameOn, oylPaneOn, oylRevealOn, oylShutterOn, oylSillOn,
        oylSideOn, oylSideLit, oylSillShade
      );
      vec3 oylPane = vec3(0.012, 0.014, 0.018) * (1.0 - oylRevealShade * oylRevealOn) + vec3(0.03, 0.04, 0.05);
      vec3 oylFront = diffuseColor.rgb;
      vec3 oylSideC = oylFront * (1.0 - oylRevealShade * (1.0 - oylSideLit));
      diffuseColor.rgb = mix(
        mix(
          mix(mix(oylFront * (1.0 - oylRevealShade * oylSillShade), vOylTrim, oylFrameOn), vOylTrim * 0.85, oylSillOn),
          oylSideC,
          oylSideOn
        ),
        oylPane,
        oylPaneOn
      );
      oylGlass = oylPaneOn;
      oylFlat = 1.0;
      oylTilt *= 1.0 - min(1.0, oylFrameOn + oylPaneOn + oylSillOn + oylSideOn);
    } else if (abs(oylTop - oylGarageTop) < 0.5) {
      // A garage door: a panelled leaf in its surround, in the trim's paint.
      float oylFaceW = vOylStyle.z;
      float oylLeafH = vOylStyle.w;
      vec2 oylG = vOylFacade.xy;
      float oylLeaf = oylBand(oylG.x, oylGarageS, oylFaceW - oylGarageS, oylMw.x)
        * (1.0 - smoothstep(oylLeafH - oylMw.y, oylLeafH + oylMw.y, oylG.y));
      float oylLeafW = max(oylFaceW - 2.0 * oylGarageS, 0.1);
      float oylCols = max(2.0, floor(oylLeafW / oylGaragePanel + 0.5));
      vec2 oylPer = vec2(oylCols / oylLeafW, oylGarageSections / oylLeafH);
      vec2 oylCell = vec2(oylG.x - oylGarageS, oylG.y) * oylPer;
      vec2 oylCellW = oylMw * oylPer;
      float oylGroove = oylLine(oylCell.y, oylGarageGroove * 0.5 * oylPer.y, oylCellW.y);
      vec2 oylInset = oylGarageInset * oylPer;
      float oylPanel = oylRect(fract(oylCell), oylInset, vec2(1.0) - oylInset, oylCellW);
      float oylFade = oylFadeOf(max(oylCellW.x, oylCellW.y));
      float oylShade = mix((1.0 - 0.45 * oylGroove) * (0.9 + 0.1 * oylPanel), 0.95, oylFade);
      diffuseColor.rgb = mix(vOylTrim * 0.88, vOylTrim * oylShade, oylLeaf);
      oylFlat = 1.0;
      oylRough = 0.5;
      oylTilt = 0.0;
    } else if (abs(oylTop - oylShopTop) < 0.5) {
      // #1590: a shop front — glass over a stall riser, mullions and a transom, in the trim's paint.
      float oylShopW = vOylStyle.z;
      float oylShopH = vOylStyle.w;
      vec2 oylS = vOylFacade.xy;
      float oylDoorHalf = oylDoorW * 0.5;
      float oylInside = oylRect(oylS, vec2(oylShopFrame), vec2(oylShopW - oylShopFrame, oylShopH - oylShopFrame), oylMw);
      float oylDoorway = 1.0 - smoothstep(oylDoorHalf - oylMw.x, oylDoorHalf + oylMw.x, abs(oylS.x - oylShopW * 0.5));
      float oylRiser = 1.0 - smoothstep(oylShopRiser - oylMw.y, oylShopRiser + oylMw.y, oylS.y);
      float oylSillBar = oylBand(oylS.y, oylShopRiser, oylShopRiser + oylShopSill, oylMw.y);
      float oylTransomBar = oylBand(oylS.y, oylShopTransom.x, oylShopTransom.y, oylMw.y);
      float oylFromX = oylS.x < oylShopW * 0.5 ? oylShopFrame : oylShopW * 0.5 + oylDoorHalf;
      float oylSpan = max(oylShopW * 0.5 - oylDoorHalf - oylShopFrame, 0.1);
      float oylPanes = max(1.0, floor(oylSpan / oylShopPaneMost + 0.5));
      float oylPaneW = oylSpan / oylPanes;
      float oylMull = oylLine((oylS.x - oylFromX) / oylPaneW, oylShopMullion * 0.5 / oylPaneW, oylMw.x / oylPaneW);
      float oylBars = max(max(oylSillBar, oylTransomBar), oylMull);
      float oylPaneOn = oylInside * (1.0 - oylDoorway) * (1.0 - oylRiser) * (1.0 - oylBars);
      float oylLitShop = step(0.5, oylWindowHash(floor(vOylTint.xy * 1000.0) + vec2(7.0, 3.0)));
      vec3 oylShopRoom = mix(vec3(0.015, 0.016, 0.02), vec3(0.11, 0.085, 0.05), oylLitShop);
      vec3 oylShopGlass = oylShopRoom + vec3(0.03, 0.04, 0.05) * smoothstep(oylShopRiser, oylShopH, oylS.y);
      vec3 oylFrameC = mix(vOylTrim, vOylTrim * 0.8, oylRiser * oylInside);
      vec3 oylDrawn = mix(oylFrameC, oylShopGlass, oylPaneOn);
      diffuseColor.rgb = vColor.rgb * mix(oylDrawn, vec3(0.035, 0.033, 0.03), oylDoorway * oylInside);
      oylGlass = oylPaneOn;
      oylFlat = 1.0;
      oylTilt = 0.0;
    } else if (abs(oylTop - oylSignTop) < 0.5) {
      // #1590: a sign band — a plain painted panel in its moulding. No text, no brand, no logo.
      vec2 oylG = vOylFacade.xy;
      float oylPanel = oylRect(oylG, vec2(oylSignMoulding), vec2(vOylStyle.z, vOylStyle.w) - vec2(oylSignMoulding), oylMw);
      vec3 oylSignC = oylSignPaints[int(clamp(vOylStyle.y + 0.5, 0.0, ${String(SIGN_PAINTS.length - 1)}.0))];
      diffuseColor.rgb = vColor.rgb * mix(vOylTrim, oylSignC, oylPanel);
      oylFlat = 1.0;
      oylRough = 0.45;
      oylTilt = 0.0;
    } else if (abs(oylTop - oylAwningTop) < 0.5) {
      // #1590: an awning's canvas, striped along it with cream where its flags say.
      vec3 oylCanvas = oylAwningPaints[int(clamp(vOylStyle.w + 0.5, 0.0, ${String(AWNING_PAINTS.length - 1)}.0))];
      float oylStripeW = oylMw.x / oylStripe;
      float oylStripeOn = step(0.5, vOylStyle.y)
        * mix(step(1.0, mod(vOylFacade.x / oylStripe, 2.0)), 0.5, oylFadeOf(oylStripeW));
      diffuseColor.rgb = vColor.rgb * mix(oylCanvas, oylStripeC, oylStripeOn);
      oylFlat = 1.0;
      oylRough = 0.85;
      oylTilt = 0.0;
    } else if (abs(oylTop - oylRailingTop) < 0.5) {
      // #1589: a porch's railing — a top rail and a bottom rail, a baluster every
      // spacing between them, and the porch's shade through the gaps.
      float oylRailH = vOylStyle.w;
      vec2 oylR = vOylFacade.xy;
      float oylTopRail = smoothstep(oylRailH - oylRailDepth - oylMw.y, oylRailH - oylRailDepth + oylMw.y, oylR.y);
      float oylFootRail = oylBand(oylR.y, oylRailFoot.x, oylRailFoot.y, oylMw.y);
      float oylBalW = oylMw.x / oylBalusterGap;
      float oylBal = oylLine(oylR.x / oylBalusterGap, oylBaluster * 0.5 / oylBalusterGap, oylBalW)
        * step(oylRailFoot.y, oylR.y);
      float oylSolid = max(max(oylTopRail, oylFootRail), oylBal);
      float oylCover = (oylRailDepth + oylRailFoot.y - oylRailFoot.x
        + max(oylRailH - oylRailDepth - oylRailFoot.y, 0.0) * oylBaluster / oylBalusterGap) / max(oylRailH, 0.01);
      float oylOn = mix(oylSolid, oylCover, oylFadeOf(oylBalW));
      diffuseColor.rgb = vColor.rgb * mix(oylRailingGap, 1.0, oylOn);
      oylFlat = 1.0;
      oylTilt = 0.0;
    }
  }
`;
}

/**
 * Where a roof holds snow, as the cosine of its pitch (its normal's
 * vertical): none at **0.5**, steeper than 60°, where it slides, and all of it
 * from **0.766**, 40° and flatter — #1623. This repository's own. A wall's is 0.
 */
const ROOF_SNOW_UP: readonly [number, number] = [0.5, 0.766];

/**
 * A roof under snow, in GLSL — #1623: `colour` mixed toward {@link ROOF_SNOW}
 * by `snow` (0 to 1, `world.ts` §`roofSnowIn`), where the surface faces up
 * (`up`, its normal's vertical). `realistic-renderer.test.ts` §"#1623"
 * evaluates it from the program three is handed.
 */
const ROOF_SNOW_GLSL = (() => {
  const linear = new Color(ROOF_SNOW);
  return /* glsl */ `
  vec3 oylSnowedRoof(vec3 colour, float up, float snow) {
    float lying = snow * smoothstep(${glslFloat(ROOF_SNOW_UP[0])}, ${glslFloat(ROOF_SNOW_UP[1])}, up);
    return mix(colour, vec3(${linear.r.toFixed(6)}, ${linear.g.toFixed(6)}, ${linear.b.toFixed(6)}), lying);
  }
`;
})();

/**
 * A wreath on a mapped building's front door, in metres of the door's face —
 * #1626: its middle {@link WREATH_UP} above the door's foot, an evergreen ring
 * between {@link WREATH_RING}'s radii and a bow below it, in
 * `decorations.ts`' `WREATH_GREEN` and `WREATH_BERRY`.
 */
const WREATH_UP = 1.35;
const WREATH_RING: readonly [number, number] = [0.15, 0.24];
/** The bow's half-width and half-height, metres. */
const WREATH_BOW: readonly [number, number] = [0.055, 0.04];

/**
 * The wreath, in GLSL — #1626: `colour` with the wreath drawn over it where
 * `on` is 1, at `x` across from the door's middle and `y` up from its foot,
 * metres. Squared radii, so it needs no root. ⚠️ **Steady**: no time, no
 * clock and no `sin` — it reads nothing but where it is and `on`, which the
 * view writes from the ride's holiday (`setSeason`). 0 calls and 0 triangles:
 * it is drawn on the door's own quad. `mapped-building-belt.test.ts`
 * §"#1626" evaluates it from the program three is handed.
 */
const WREATH_GLSL = (() => {
  const green = new Color(WREATH_GREEN);
  const berry = new Color(WREATH_BERRY);
  const vec = (c: Color): string => `vec3(${c.r.toFixed(6)}, ${c.g.toFixed(6)}, ${c.b.toFixed(6)})`;
  const [inner, outer] = WREATH_RING;
  const [bowX, bowY] = WREATH_BOW;
  const edge = 0.01;
  return /* glsl */ `
  vec3 oylWreathed(vec3 colour, float x, float y, float on) {
    float up = y - ${glslFloat(WREATH_UP)};
    float r2 = x * x + up * up;
    float ring = smoothstep(${glslFloat((inner - edge) ** 2)}, ${glslFloat((inner + edge) ** 2)}, r2)
      * (1.0 - smoothstep(${glslFloat((outer - edge) ** 2)}, ${glslFloat((outer + edge) ** 2)}, r2));
    float below = up + ${glslFloat(outer)};
    float bow = (1.0 - smoothstep(${glslFloat(bowX - edge)}, ${glslFloat(bowX)}, max(x, -x)))
      * (1.0 - smoothstep(${glslFloat(bowY - edge)}, ${glslFloat(bowY)}, max(below, -below)));
    vec3 drawn = mix(mix(colour, ${vec(green)}, ring), ${vec(berry)}, bow);
    return mix(colour, drawn, on);
  }
`;
})();

/**
 * Teaches a mapped building's material #1581's facade: the windows of every
 * storey, the front door in its surround, and the painted trim — from vertex
 * attributes, `oylFacade` (`footprint-buildings.ts` §`FACADE_FLOATS`),
 * `oylTrim` (the trim's paint) and since #1588 `oylStyle` (§`STYLE_FLOATS`:
 * the cladding and the windows' style), so they cost no triangle, no texture
 * and no draw call. Spliced after #1549's vertex tint ({@link withVertexTint}),
 * whose varying it reads. Throws, as the tint does, if three's program no
 * longer holds an include it is spliced at. Idempotent.
 */
function withFacade<M extends Material>(material: M, surface: StructureSurface): M {
  if (FACADE_TAUGHT.has(material)) return material;
  FACADE_TAUGHT.add(material);
  defineFacadeLevers(material);
  const earlier = material.onBeforeCompile.bind(material);
  const earlierKey = material.customProgramCacheKey();
  const spliced = "#1581's facade";
  material.onBeforeCompile = (shader, renderer) => {
    earlier(shader, renderer);
    shader.uniforms.oylFacadeOn = FACADE_SWITCH.oylFacadeOn;
    shader.uniforms.oylSunWorld = FACADE_SUN.oylSunWorld;
    // #1623: the snow a roof carries, from the route's season.
    shader.uniforms.oylRoofSnow = SEASON.oylRoofSnow;
    // #1661: the photograph laid per building, and the world for the weathering's noise.
    const weathered = weatheringBuiltIn(material);
    // #1626: the winter lights' wreath on the front door.
    shader.uniforms.oylWreath = SEASON.oylWreath;
    shader.vertexShader = replacedOrThrown(
      replacedOrThrown(
        shader.vertexShader,
        '#include <common>',
        `#include <common>\nattribute vec4 oylFacade;\nattribute vec4 oylStyle;\nattribute vec3 oylTrim;\nvarying vec4 vOylFacade;\nvarying vec4 vOylStyle;\nvarying vec3 vOylTrim;${weathered ? `\nvarying vec3 vOylWorld;\nflat varying float vOylAge;\n${WEATHER_PHOTO_GLSL}` : ''}`,
        'vertex',
        spliced,
      ),
      '#include <begin_vertex>',
      `#include <begin_vertex>\nvOylFacade = oylFacade;\nvOylStyle = oylStyle;\nvOylTrim = oylTrim;${weathered ? WEATHER_VERTEX_GLSL : ''}`,
      'vertex',
      spliced,
    );
    let fragment = replacedOrThrown(
      shader.fragmentShader,
      '#include <common>',
      `#include <common>\n${facadeCommonGlsl(revealsBuiltIn(material), overhangsBuiltIn(material), weathered, surface)}\nuniform float oylRoofSnow;\n${ROOF_SNOW_GLSL}\nuniform float oylWreath;\n${WREATH_GLSL}`,
      'fragment',
      spliced,
    );
    fragment = replacedOrThrown(
      fragment,
      '#include <color_fragment>',
      `#include <color_fragment>\n${facadeFragmentGlsl(overhangsBuiltIn(material), weathered)}`,
      'fragment',
      spliced,
    );
    fragment = replacedOrThrown(
      fragment,
      '#include <roughnessmap_fragment>',
      '#include <roughnessmap_fragment>\nroughnessFactor = mix(mix(roughnessFactor, oylRough, oylFlat), 0.08, oylGlass);',
      'fragment',
      spliced,
    );
    fragment = replacedOrThrown(
      fragment,
      '#include <metalnessmap_fragment>',
      '#include <metalnessmap_fragment>\nmetalnessFactor = mix(metalnessFactor, 0.35, oylGlass);',
      'fragment',
      spliced,
    );
    shader.fragmentShader = replacedOrThrown(
      fragment,
      '#include <normal_fragment_maps>',
      // #1623: and snow on what faces up, by the surface's own facing, not its map's.
      '#include <normal_fragment_maps>\nnormal = normalize(mix(normal, nonPerturbedNormal, oylFlat));\nnormal = normalize(normal + oylTilt * normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz));\ndiffuseColor.rgb = oylSnowedRoof(diffuseColor.rgb, dot(normalize(nonPerturbedNormal), normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz)), oylRoofSnow);',
      'fragment',
      spliced,
    );
  };
  // #1661: the weathering bakes in the surface's streak share and parging.
  material.customProgramCacheKey = () => `${earlierKey}|oyl-facade-${surface}`;
  return material;
}

/**
 * One mapped building surface's material — #1549: the structure surface's
 * own photograph and finish ({@link STRUCTURE_SURFACE_FINISH}), constructed
 * here (ADR 0026 D-11) from the world's compressed textures (#618), with its
 * texture bias (#619), the realistic air (#622), its tint from the vertex
 * ({@link withVertexTint}) and, since #1581, its facade ({@link withFacade}).
 */
function mappedBuildingMaterial(
  surface: StructureSurface,
  textures: RealisticWorld['structures'],
): MeshStandardMaterial {
  const finish = STRUCTURE_SURFACE_FINISH[surface];
  const maps = isPhotographic(surface) ? textures.get(surface) : undefined;
  const material = constructed(
    new MeshStandardMaterial({
      color: finish.tint,
      roughness: finish.roughness,
      metalness: finish.metalness,
      vertexColors: true,
      ...(maps === undefined ? {} : { map: maps.colour, normalMap: maps.normal }),
    }),
  );
  return withAtmosphere(
    withFacade(
      withVertexTint(maps === undefined ? material : withTextureLodBias(material)),
      surface,
    ),
  );
}

/**
 * The house models' one material — #1585: the atlas, the plan's paint as a
 * vertex colour, #621's tint, and the atmosphere every structure wears. A
 * belt built without the models carries it with no map and draws nothing in it.
 */
function houseModelMaterial(atlas: Texture | undefined): MeshStandardMaterial {
  const material = constructed(
    new MeshStandardMaterial({
      roughness: 0.85,
      metalness: 0,
      vertexColors: true,
      ...(atlas === undefined ? {} : { map: atlas }),
    }),
  );
  return withAtmosphere(
    withVertexTint(atlas === undefined ? material : withTextureLodBias(material)),
  );
}

/**
 * Whether the mapped buildings are merged, a group a surface — always, but
 * for the browser gate's control. @see setMappedBuildingsMerged
 */
let mappedBuildingsMerged = true;

/**
 * Draws the mapped buildings refilled after this call one group a building and
 * surface — a draw call each, as a belt of one mesh a building would — or
 * merged again — #1549's control: with D-5.6's 36 buildings in reach the merged belt
 * submits at most `MAPPED_BUILDING_DRAW_CALLS` calls, and this submits more.
 *
 * @test-facing the browser gate's control, read by `game-harness.ts`
 * §`mappedTownProbe` and `mapped-building-belt.test.ts` §"at most six draw
 * calls"; the product always merges
 */
export function setMappedBuildingsMerged(merged: boolean): void {
  mappedBuildingsMerged = merged;
}

/** The capacity of {@link MappedBuildingBelt}'s buffer, in vertices. */
const MAPPED_VERTICES = MAPPED_BUILDING_TRIANGLES * 3;

/** One drawn building, where its triangles are. @see MappedBuildingBelt.drawnAt */
export interface DrawnMappedBuilding {
  /** Its plan's place in `MappedBuildings.plans`. */
  readonly plan: number;
  readonly far: boolean;
  /** Its first vertex in its wall surface's range, and in its roof surface's; -1 for a model. */
  readonly wallAt: number;
  readonly roofAt: number;
  /** Its first vertex in the house models' buffer, or -1 for an extrusion — #1585. */
  readonly modelAt: number;
}

/**
 * The realistic world's buildings from map data — #1549, ADR 0054.
 *
 * A footprint is unique, so it cannot be instanced. The plans in reach
 * (`mapped-buildings.ts` §`selectMappedBuildings`) are appended into **one
 * preallocated buffer** of `realistic-budget.ts` §`MAPPED_BUILDING_TRIANGLES`
 * triangles, laid out surface by surface, and drawn by **one mesh with a group
 * a surface**: at most `MAPPED_BUILDING_DRAW_CALLS` draw calls whatever the
 * count, because the selection never opens a seventh surface.
 *
 * ⚠️ **One buffer with a range a surface, not a buffer a surface.** The
 * budget is shared, and one surface can take all of it (a street of brick),
 * so a buffer a surface would each need the whole capacity: eight surfaces,
 * eight times the memory, where one buffer of the budget holds any mix.
 *
 * - **Rebuilt only at a refill**, which the view runs when the rider's chunk
 *   (`MAPPED_CHUNK_METRES`) changes, or the rung does; never per frame. A
 *   frame that is not a refill reads one number and allocates nothing.
 * - **Uploaded in part**: each attribute's update range is what was written.
 * - **The far level**, beyond `MAPPED_BUILDING_NEAR_METRES`, is a plan's walls
 *   and roof (#1540's `farTriangleCount`). The plinth, parapet and door are
 *   left out.
 * - **The texture coordinates** of a plan are in its storeys and bays
 *   (`footprint-buildings.ts` §`BAY_METRES`). They are taken back to metres and
 *   laid at the photograph's own size, as {@link projectedInMetres} lays a
 *   procedural building's, so a brick is a brick's size on both.
 * - **The vertex colour** is the role's shade ({@link MAPPED_ROLE_SHADE}) and
 *   #500's grounding above the ground the plinth stands in. A part raised on a
 *   `min_height` has no plinth and no grounding.
 * - **#621's tint** is a vertex attribute here, not the instance colour's
 *   third channel: there is no instance. @see withVertexTint
 * - **A ground blob under each drawn building** — #1657: its footprint's
 *   minimum-area rectangle, worked out at the refill and read by
 *   `GroundBlobBelt` every frame. @see grounded
 * - **Never culled as a whole** (`frustumCulled` off): the buildings in reach
 *   stand all round the rider, so a sphere about them always holds the camera.
 */
export class MappedBuildingBelt {
  readonly mesh: Mesh;
  readonly buildings: MappedBuildings;
  readonly #materials: ReadonlyMap<StructureSurface, MeshStandardMaterial>;
  /** The mesh's material list: the surface each group draws, by its place. */
  readonly #slots: Material[];
  readonly #position: BufferAttribute;
  readonly #normal: BufferAttribute;
  readonly #uv: BufferAttribute;
  readonly #colour: BufferAttribute;
  readonly #tint: BufferAttribute;
  /** #1581: each vertex's facade, and its building's trim paint. @see withFacade */
  readonly #facade: BufferAttribute;
  readonly #trim: BufferAttribute;
  /** #1588: each vertex's cladding and windows' style. @see withFacade */
  readonly #style: BufferAttribute;
  /**
   * #1585: the house models, one mesh in the atlas's one material — one
   * draw call whatever their count — refilled with the surfaces.
   */
  readonly modelMesh: Mesh;
  readonly #houses: RealisticHouses | undefined;
  readonly #modelPosition: BufferAttribute;
  readonly #modelNormal: BufferAttribute;
  readonly #modelUv: BufferAttribute;
  readonly #modelColour: BufferAttribute;
  readonly #modelTint: BufferAttribute;
  /** Each drawn building's first vertex in the models' buffer, or -1 for an extrusion. */
  readonly #modelAt: Int32Array;
  readonly #selection = new MappedSelection();
  /** The drawn buildings as ground-blob casters, written at a refill. @see grounded */
  readonly #grounded = blobCasters(MAPPED_BUILDING_MAX);
  /** Where each surface's range starts, and where its next triangle goes, in vertices. */
  readonly #starts = new Int32Array(MAPPED_BUILDING_DRAW_CALLS);
  readonly #cursors = new Int32Array(MAPPED_BUILDING_DRAW_CALLS);
  /** Each drawn building's first vertex in its wall surface's range and in its roof's. */
  readonly #wallAt: Int32Array;
  readonly #roofAt: Int32Array;
  #stats: MappedBuildingStats = {
    buildings: 0,
    near: 0,
    far: 0,
    triangles: 0,
    drawCalls: 0,
    passed: 0,
    modelled: 0,
    modelTriangles: 0,
  };
  /** The chunk the last refill was for; `undefined` before the first, or once the rung moved. */
  #chunk: number | undefined;
  #refills = 0;
  #shown = true;
  /** Whether the browser gate has turned the mapped buildings off — its control. */
  #switchedOn = true;
  /** Whether this frame carried the mapped buildings at all. @see setCarried */
  #carried = true;

  /**
   * @param textures the world's structure surfaces. @see RealisticWorld.structures
   * @param houses the house models and their atlas (#1585); without them every
   * plan is its extrusion
   */
  constructor(
    buildings: MappedBuildings,
    textures: RealisticWorld['structures'],
    houses?: RealisticHouses,
  ) {
    this.buildings = buildings;
    this.#houses = houses;
    this.#wallAt = new Int32Array(this.#selection.plans.length);
    this.#roofAt = new Int32Array(this.#selection.plans.length);
    this.#materials = new Map(
      FOOTPRINT_SURFACES.map((surface) => [surface, mappedBuildingMaterial(surface, textures)]),
    );
    const first = this.#materials.get(FOOTPRINT_SURFACES[0] as StructureSurface) as Material;
    this.#slots = Array.from({ length: MAPPED_BUILDING_DRAW_CALLS }, () => first);
    const attribute = (size: number): BufferAttribute =>
      new BufferAttribute(new Float32Array(MAPPED_VERTICES * size), size).setUsage(
        DynamicDrawUsage,
      );
    this.#position = attribute(3);
    this.#normal = attribute(3);
    this.#uv = attribute(2);
    this.#colour = attribute(3);
    this.#tint = attribute(1);
    this.#facade = attribute(FACADE_FLOATS);
    this.#trim = attribute(3);
    this.#style = attribute(STYLE_FLOATS);
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', this.#position);
    geometry.setAttribute('normal', this.#normal);
    geometry.setAttribute('uv', this.#uv);
    geometry.setAttribute('color', this.#colour);
    geometry.setAttribute('oylTint', this.#tint);
    geometry.setAttribute('oylFacade', this.#facade);
    geometry.setAttribute('oylTrim', this.#trim);
    geometry.setAttribute('oylStyle', this.#style);
    geometry.setDrawRange(0, 0);
    this.mesh = new Mesh(geometry, this.#slots);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    // #1585: the house models' own buffer, of the same capacity — the budget
    // is shared, and the models may take all of it.
    this.#modelAt = new Int32Array(this.#selection.plans.length);
    const models = new BufferGeometry();
    this.#modelPosition = attribute(3);
    this.#modelNormal = attribute(3);
    this.#modelUv = attribute(2);
    this.#modelColour = attribute(3);
    this.#modelTint = attribute(1);
    models.setAttribute('position', this.#modelPosition);
    models.setAttribute('normal', this.#modelNormal);
    models.setAttribute('uv', this.#modelUv);
    models.setAttribute('color', this.#modelColour);
    models.setAttribute('oylTint', this.#modelTint);
    models.setDrawRange(0, 0);
    this.modelMesh = new Mesh(models, houseModelMaterial(houses?.atlas));
    this.modelMesh.frustumCulled = false;
    this.modelMesh.visible = false;
  }

  addTo(scene: Scene): void {
    scene.add(this.mesh);
    scene.add(this.modelMesh);
  }

  /** What the last refill drew. */
  get stats(): MappedBuildingStats {
    return this.#stats;
  }

  /** How many refills this belt has run — for the tests' count over a ride. */
  get refills(): number {
    return this.#refills;
  }

  /** The material a surface wears here: one each, constructed with the belt. */
  materialOf(surface: StructureSurface): MeshStandardMaterial | undefined {
    return this.#materials.get(surface);
  }

  /** Whether a frame at `chunk` needs a refill: the rider's chunk changed, or the rung did. */
  needsRefill(chunk: number): boolean {
    return chunk !== this.#chunk;
  }

  /** The rung changed: the next frame refills, whatever its chunk. */
  invalidate(): void {
    this.#chunk = undefined;
  }

  setShown(on: boolean): void {
    this.#shown = on;
    this.#applyVisible();
  }

  /** @see mappedBuildingsShownOf */
  switchOn(on: boolean): void {
    this.#switchedOn = on;
    this.#applyVisible();
  }

  /**
   * Whether the frame carried the mapped buildings — a frame with none (the
   * browser gate's bare frame) draws none, and the next that carries them
   * draws what the last refill wrote.
   */
  setCarried(on: boolean): void {
    this.#carried = on;
    this.#applyVisible();
  }

  /** Whether the mapped buildings are drawn at all: shown, switched on and carried. */
  get drawing(): boolean {
    return this.#shown && this.#switchedOn && this.#carried;
  }

  /**
   * The ground-blob casters under what this belt draws — #1657: one a drawn
   * building, near or far, extrusion or house model, nearest first; none
   * while it draws nothing ({@link drawing}). Written at {@link refill} and
   * only read here, so a frame that is not a refill reads one flag and
   * allocates nothing.
   */
  get grounded(): BlobCasters {
    return this.drawing ? this.#grounded : NO_BLOB_CASTERS;
  }

  #applyVisible(): void {
    this.mesh.visible = this.drawing && this.#stats.triangles - this.#stats.modelTriangles > 0;
    this.modelMesh.visible = this.drawing && this.#stats.modelled > 0;
  }

  /**
   * The buildings nearest `(riderX, riderZ)` that fit `triangleBudget`,
   * ranked with `rivals` (#1586), appended in place, with the draw range and
   * the groups set — #1549. The view calls it when {@link needsRefill};
   * `chunk` is recorded so the next frame in that chunk does not refill again.
   */
  refill(
    riderX: number,
    riderZ: number,
    triangleBudget: number,
    chunk?: number,
    rivals: RivalStructures = NO_RIVALS,
  ): MappedBuildingStats {
    this.#refills += 1;
    this.#chunk = chunk;
    const selection = this.#selection;
    selectMappedBuildings(
      this.buildings,
      riderX,
      riderZ,
      Math.min(triangleBudget, MAPPED_BUILDING_TRIANGLES),
      selection,
      MAPPED_BUILDING_DRAW_CALLS,
      rivals,
      this.#houses?.triangles,
    );
    const surfaces = selection.surfaces;
    let end = 0;
    for (let slot = 0; slot < surfaces.length; slot += 1) {
      this.#starts[slot] = end;
      this.#cursors[slot] = end;
      end += (selection.surfaceTriangles[slot] ?? 0) * 3;
      this.#slots[slot] = this.#materials.get(surfaces[slot] as StructureSurface) as Material;
    }
    let modelEnd = 0;
    for (let at = 0; at < selection.count; at += 1) {
      const plan = this.buildings.plans[selection.plans[at] as number] as FootprintPlan;
      // #1585: a modelled plan's triangles are its model's, in the models' buffer.
      if (selection.modelled[at] === 1 && plan.model !== undefined) {
        this.#modelAt[at] = modelEnd;
        this.#wallAt[at] = -1;
        this.#roofAt[at] = -1;
        modelEnd = this.#appendModel(plan, plan.model, modelEnd);
        continue;
      }
      this.#modelAt[at] = -1;
      const wall = surfaces.indexOf(plan.surfaces.wall);
      const roof = surfaces.indexOf(plan.surfaces.roof);
      this.#wallAt[at] = this.#cursors[wall] as number;
      this.#roofAt[at] = this.#cursors[roof] as number;
      for (const role of selection.far[at] === 1 ? FAR_ROLES : NEAR_ROLES) {
        const slot = ROOF_ROLES.has(role) ? roof : wall;
        this.#cursors[slot] = this.#append(plan, role, this.#cursors[slot] as number);
      }
    }
    const geometry = this.mesh.geometry;
    geometry.clearGroups();
    if (mappedBuildingsMerged) {
      for (let slot = 0; slot < surfaces.length; slot += 1) {
        const count = (selection.surfaceTriangles[slot] ?? 0) * 3;
        if (count > 0) geometry.addGroup(this.#starts[slot] as number, count, slot);
      }
    } else {
      this.#groupEachBuilding();
    }
    geometry.setDrawRange(0, end);
    for (const attribute of [
      this.#position,
      this.#normal,
      this.#uv,
      this.#colour,
      this.#tint,
      this.#facade,
      this.#trim,
      this.#style,
    ]) {
      attribute.clearUpdateRanges();
      if (end > 0) {
        attribute.addUpdateRange(0, end * attribute.itemSize);
        attribute.needsUpdate = true;
      }
    }
    const models = this.modelMesh.geometry;
    models.setDrawRange(0, modelEnd);
    for (const attribute of [
      this.#modelPosition,
      this.#modelNormal,
      this.#modelUv,
      this.#modelColour,
      this.#modelTint,
    ]) {
      attribute.clearUpdateRanges();
      if (modelEnd > 0) {
        attribute.addUpdateRange(0, modelEnd * attribute.itemSize);
        attribute.needsUpdate = true;
      }
    }
    this.#groundSelection();
    this.#stats = {
      buildings: selection.count,
      near: selection.near,
      far: selection.farCount,
      triangles: selection.triangles,
      drawCalls: geometry.groups.length + (selection.modelCount > 0 ? 1 : 0),
      passed: selection.passed,
      modelled: selection.modelCount,
      modelTriangles: selection.modelTriangles,
    };
    this.#applyVisible();
    return this.#stats;
  }

  /**
   * Each drawn building as a ground-blob caster — #1657: its footprint's
   * minimum-area rectangle (`footprint-buildings.ts` §`minimumAreaRectangle`),
   * its middle, its long axis as the yaw, its half extents, and the height of
   * its eaves above its foot. Once a refill, never a frame.
   */
  #groundSelection(): void {
    const selection = this.#selection;
    const into = this.#grounded;
    into.count = 0;
    for (let at = 0; at < selection.count; at += 1) {
      const caster = into.casters[at];
      if (caster === undefined) break;
      const plan = this.buildings.plans[selection.plans[at] as number] as FootprintPlan;
      groundMappedBuilding(plan, caster);
      into.count += 1;
    }
  }

  /** The browser gate's control: a group — a draw call — per building and surface. */
  #groupEachBuilding(): void {
    const selection = this.#selection;
    for (let at = 0; at < selection.count; at += 1) {
      if (selection.modelled[at] === 1) continue;
      const plan = this.buildings.plans[selection.plans[at] as number] as FootprintPlan;
      let walls = 0;
      let roofs = 0;
      for (const role of selection.far[at] === 1 ? FAR_ROLES : NEAR_ROLES) {
        if (ROOF_ROLES.has(role)) roofs += roleTriangles(plan, role) * 3;
        else walls += roleTriangles(plan, role) * 3;
      }
      const geometry = this.mesh.geometry;
      const surfaces = selection.surfaces;
      geometry.addGroup(this.#wallAt[at] as number, walls, surfaces.indexOf(plan.surfaces.wall));
      geometry.addGroup(this.#roofAt[at] as number, roofs, surfaces.indexOf(plan.surfaces.roof));
    }
  }

  /**
   * Writes a plan's house model from vertex `at` of the models' buffer —
   * #1585: each vertex placed by `house-models.ts` §`placedPoint`, its normal
   * turned with it and taken through the stretch's inverse, its colour the
   * plan's wall paint as a model wears it (`building-paint.ts` §`modelPaint`),
   * and #621's seeded tint. Returns the vertex after it.
   */
  #appendModel(plan: FootprintPlan, placement: HousePlacement, at: number): number {
    const model = this.#houses?.models[placement.model];
    if (model === undefined) return at;
    return writeHouseModel(
      model,
      placement,
      modelPaint(mappedRolePaint(plan, 'wall')),
      plan.tint,
      {
        position: this.#modelPosition.array as Float32Array,
        normal: this.#modelNormal.array as Float32Array,
        uv: this.#modelUv.array as Float32Array,
        colour: this.#modelColour.array as Float32Array,
        tint: this.#modelTint.array as Float32Array,
      },
      at,
    );
  }

  /** Writes one role of a plan from vertex `at`; returns the vertex after it. */
  #append(plan: FootprintPlan, role: FootprintRole, at: number): number {
    const floats = plan.triangles[role];
    const vertices = roleTriangles(plan, role) * 3;
    const surface = surfaceOfRole(plan, role) as PhotographicSurface;
    const repeat = surfaceRepeat(REALISTIC_STRUCTURE_SURFACES[surface]);
    // A plan's texture coordinates are bays across and storeys up, and a
    // roof's storeys both ways: back to metres, then the photograph's repeats.
    const acrossMetres = role === 'roof' ? STOREY_METRES : BAY_METRES;
    const shade = MAPPED_ROLE_SHADE[role];
    const [red, green, blue] = mappedRolePaint(plan, role);
    const [trimRed, trimGreen, trimBlue] = mappedRolePaint(plan, 'trim');
    // A plan with a plinth stands in the ground at its foot; a raised part
    // does not, and nor does a driveway, which is laid on the ground.
    const grounded = plan.triangles.plinth.length > 0 && role !== 'driveway';
    // #1588: a soffit's and a gutter's underside, in the shade of the wall and the eaves;
    // #1589: a porch's ceiling likewise, and its deck in the shade of its roof;
    // #1590: an awning's underside likewise.
    const porch = role === 'porch';
    const underside =
      role === 'trim' || role === 'porch-trim' || porch || role === 'shopfront'
        ? FACADE_AO.soffit
        : 1;
    const upside = porch ? FACADE_AO.porchFloor : 1;
    const ground = plan.base + FOUNDATION_METRES;
    const position = this.#position.array as Float32Array;
    const normal = this.#normal.array as Float32Array;
    const uv = this.#uv.array as Float32Array;
    const colour = this.#colour.array as Float32Array;
    const tint = this.#tint.array as Float32Array;
    const facade = this.#facade.array as Float32Array;
    const trim = this.#trim.array as Float32Array;
    const style = this.#style.array as Float32Array;
    for (let vertex = 0; vertex < vertices; vertex += 1) {
      const from = vertex * FOOTPRINT_VERTEX_FLOATS;
      const to = at + vertex;
      const y = floats[from + 1] as number;
      position[to * 3] = floats[from] as number;
      position[to * 3 + 1] = y;
      position[to * 3 + 2] = floats[from + 2] as number;
      normal[to * 3] = floats[from + 3] as number;
      normal[to * 3 + 1] = floats[from + 4] as number;
      normal[to * 3 + 2] = floats[from + 5] as number;
      uv[to * 2] = ((floats[from + 6] as number) * acrossMetres) / repeat.across;
      uv[to * 2 + 1] = ((floats[from + 7] as number) * STOREY_METRES) / repeat.up;
      const facing = floats[from + 4] as number;
      const occluded = facing < -0.5 ? underside : facing > 0.5 ? upside : 1;
      const light = shade * occluded * (grounded ? groundingShade(y - ground) : 1);
      colour[to * 3] = red * light;
      colour[to * 3 + 1] = green * light;
      colour[to * 3 + 2] = blue * light;
      tint[to] = plan.tint;
      for (let at4 = 0; at4 < FACADE_FLOATS; at4 += 1) {
        facade[to * FACADE_FLOATS + at4] = floats[from + FACADE_OFFSET + at4] as number;
      }
      for (let at4 = 0; at4 < STYLE_FLOATS; at4 += 1) {
        style[to * STYLE_FLOATS + at4] = floats[from + STYLE_OFFSET + at4] as number;
      }
      trim[to * 3] = trimRed;
      trim[to * 3 + 1] = trimGreen;
      trim[to * 3 + 2] = trimBlue;
    }
    return at + vertices;
  }

  /**
   * The drawn building at `place`, nearest first, and where its triangles are
   * — for the tests, which read the buffers back against the plan.
   */
  drawnAt(place: number): DrawnMappedBuilding | undefined {
    if (place < 0 || place >= this.#selection.count) return undefined;
    return {
      plan: this.#selection.plans[place] as number,
      far: this.#selection.far[place] === 1,
      wallAt: this.#wallAt[place] as number,
      roofAt: this.#roofAt[place] as number,
      modelAt: this.#modelAt[place] as number,
    };
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    for (const material of this.#materials.values()) material.dispose();
    this.modelMesh.geometry.dispose();
    (this.modelMesh.material as Material).dispose();
  }
}

/** What one {@link VillageHouseBelt.update} drew — #1566. */
export interface VillageHouseStats {
  /** The plots drawn as house models. */
  readonly houses: number;
  readonly triangles: number;
  /** Of the frame's structure items, how many the models took: their triangles at the structure term's price. */
  readonly items: number;
  /**
   * The most items the procedural belts may admit this frame, in their own
   * order, so that what they draw and the models stay inside the term —
   * `+Infinity` with nothing modelled, which leaves their budget as it was.
   */
  readonly procedural: number;
  /** How many times the models' buffer has been rewritten, over the belt's life. */
  readonly rewrites: number;
}

/**
 * The procedural villages' houses and main-street blocks drawn as #1585's
 * house models — #1566, the owner's ruling of 2026-10-23 (the same set, the
 * same atlas, no model of its own).
 *
 * - **Which.** A structure item carrying a model (`settlements.ts`
 *   §`everyVillagePlot`, `ScatterItem.house`), in view, nearest first, while
 *   the structure term has room — the rung's structure items at
 *   `REALISTIC_TRIANGLES.structure`, #1586's pooled term, applied per frame.
 *   Every structure in view that no model stands for (the church, a row of
 *   shops, a wall, a signpost) is priced first, at its kind's heaviest shape
 *   (`realisticStructureTriangles`), so a model never pushes one of those out,
 *   and a main-street block at its row of shops'; then each house, nearest
 *   first, at its model's triangles, or at its kind's where the model does
 *   not fit, and is drawn as its kind; then each block, nearest first, where
 *   what is left holds its model. The procedural belts are then held to what is left
 *   ({@link VillageHouseStats.procedural}), counted in THEIR order — every
 *   item in view, structures first — and stopped at the first structure the
 *   rest of the term cannot hold, so the two together never pass it.
 *   ⚠️ **No near level, unlike a mapped plan's**: a village drawn half
 *   in models and half in its kinds would spend the calls of both, and the
 *   village frame's calls are frozen (`realistic-budget.ts`
 *   §`REALISTIC_VILLAGE_DRAW_CALLS`); the term is what bounds a far model's
 *   triangles.
 * - **Where.** Its door end toward the road, its front where the
 *   procedural building's is, reaching back over the plot's ground
 *   (`house-models.ts` §`placeOnPlot`). Never stretched.
 * - **Painted** by its plot's wall entry as a model wears a paint
 *   (`building-paint.ts` §`lotModelPaint`), with #621's tint, as a vertex
 *   colour: neighbours are other hues.
 * - **One mesh, one material** — `houseModelMaterial`, the mapped models'
 *   own material and atlas: one draw call, whatever the count, and none
 *   with nothing modelled. The procedural belts are handed every OTHER
 *   structure ({@link update}'s return), so a modelled plot is not drawn twice.
 *
 * Rewritten only when the modelled set changes, so a frame that keeps the
 * same houses allocates nothing and writes nothing.
 */
export class VillageHouseBelt {
  readonly mesh: Mesh;
  readonly #houses: RealisticHouses | undefined;
  readonly #position: BufferAttribute;
  readonly #normal: BufferAttribute;
  readonly #uv: BufferAttribute;
  readonly #colour: BufferAttribute;
  readonly #tint: BufferAttribute;
  /** The items the procedural belts draw this frame, reused. */
  readonly #procedural: ScatterItem[] = [];
  /** Which of the frame's items are modelled, by their place in it; grown, never shrunk. */
  #modelled = new Uint8Array(64);
  /** The frame's structure items in view, by place, and their distances: grown, never shrunk. */
  #order = new Int32Array(64);
  #distance = new Float64Array(64);
  /** What the buffer holds: x, z, model and paint a house, for {@link update}'s comparison. */
  #held = new Float64Array(4 * REALISTIC_STRUCTURE_ITEMS);
  #heldCount = 0;
  readonly #grounded = blobCasters(REALISTIC_STRUCTURE_ITEMS);
  #stats: VillageHouseStats = {
    houses: 0,
    triangles: 0,
    items: 0,
    procedural: Number.POSITIVE_INFINITY,
    rewrites: 0,
  };
  #shown = true;
  #switchedOn = true;
  /** Each structure kind's heaviest realistic shape, its price in the term. */
  readonly #price = new Map<SceneryKind, number>();

  /** @param houses the house models and their atlas (#1585); without them nothing is modelled. */
  constructor(houses: RealisticHouses | undefined) {
    this.#houses = houses;
    if (houses !== undefined) {
      for (const kind of STRUCTURE_KINDS) this.#price.set(kind, realisticStructureTriangles(kind));
    }
    const attribute = (size: number): BufferAttribute =>
      new BufferAttribute(new Float32Array(MAPPED_BUILDING_TRIANGLES * 3 * size), size).setUsage(
        DynamicDrawUsage,
      );
    this.#position = attribute(3);
    this.#normal = attribute(3);
    this.#uv = attribute(2);
    this.#colour = attribute(3);
    this.#tint = attribute(1);
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', this.#position);
    geometry.setAttribute('normal', this.#normal);
    geometry.setAttribute('uv', this.#uv);
    geometry.setAttribute('color', this.#colour);
    geometry.setAttribute('oylTint', this.#tint);
    geometry.setDrawRange(0, 0);
    this.mesh = new Mesh(geometry, houseModelMaterial(houses?.atlas));
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
  }

  addTo(scene: Scene): void {
    scene.add(this.mesh);
  }

  setShown(on: boolean): void {
    this.#shown = on;
    this.#applyVisible();
  }

  /** @see villageModelsShownOf */
  switchOn(on: boolean): void {
    this.#switchedOn = on;
  }

  /** What the last {@link update} drew. */
  get stats(): VillageHouseStats {
    return this.#stats;
  }

  /** The ground-blob casters under the modelled houses — #620's, as the structures' are. */
  get grounded(): BlobCasters {
    return this.#shown ? this.#grounded : NO_BLOB_CASTERS;
  }

  #applyVisible(): void {
    this.mesh.visible = this.#shown && this.#stats.houses > 0;
  }

  /**
   * Chooses the frame's modelled houses from `items`, inside `structureItems`
   * structures at the structure term's price, and returns every item the
   * procedural belts should draw — `items` itself when nothing is modelled.
   * @see VillageHouseBelt
   */
  update(
    items: readonly ScatterItem[],
    pose: CameraPose,
    structureItems: number,
  ): readonly ScatterItem[] {
    const houses = this.#houses;
    const price = REALISTIC_TRIANGLES.structure;
    const pool = Math.max(0, Math.min(structureItems, REALISTIC_STRUCTURE_ITEMS)) * price;
    if (this.#modelled.length < items.length) {
      this.#modelled = new Uint8Array(items.length * 2);
      this.#order = new Int32Array(items.length * 2);
      this.#distance = new Float64Array(items.length * 2);
    }
    const modelled = this.#modelled;
    modelled.fill(0, 0, items.length);
    let count = 0;
    if (houses !== undefined && this.#switchedOn) {
      // The structures in view, nearest first: an insertion sort over a few
      // dozen, in arrays kept between frames, so nothing is allocated.
      for (let at = 0; at < items.length; at += 1) {
        const item = items[at] as ScatterItem;
        if (!isStructureKind(item.kind) || !inView(item, pose)) continue;
        const distance = Math.hypot(item.x - pose.x, item.z - pose.z);
        let to = count;
        while (to > 0 && (this.#distance[to - 1] as number) > distance) {
          this.#order[to] = this.#order[to - 1] as number;
          this.#distance[to] = this.#distance[to - 1] as number;
          to -= 1;
        }
        this.#order[to] = at;
        this.#distance[to] = distance;
        count += 1;
      }
    }
    // First what no model can stand for — the church, the rows of shops, the
    // walls, hedges, fences and signposts — at its own price, and a
    // main-street block at its row of shops' price: a model never takes the
    // term from a structure that would be drawn as nothing else.
    let spent = 0;
    for (let rank = 0; rank < count; rank += 1) {
      const item = items[this.#order[rank] as number] as ScatterItem;
      const model = item.house === undefined ? undefined : houses?.models[item.house];
      if (model === undefined || item.kind !== 'building') {
        spent += this.#price.get(item.kind) ?? price;
      }
    }
    // Then the houses, nearest first: a model where the rest holds it, its
    // kind where that does. The houses before the blocks, because a house
    // left as its kind brings back its kind's meshes, a call a surface and
    // shape (`RealisticStructureBelts`), and a block left as its row of shops
    // is drawn in the mesh the other row of shops already is.
    let modelTriangles = 0;
    let drawn = 0;
    for (const blocks of [false, true]) {
      for (let rank = 0; rank < count; rank += 1) {
        const at = this.#order[rank] as number;
        const item = items[at] as ScatterItem;
        const model = item.house === undefined ? undefined : houses?.models[item.house];
        if (model === undefined || (item.kind === 'building') === blocks) continue;
        // A block's own price is already spent; its model costs the difference.
        const kind = this.#price.get(item.kind) ?? price;
        const cost = blocks ? model.triangles - kind : model.triangles;
        if (drawn < REALISTIC_STRUCTURE_ITEMS && spent + cost <= pool) {
          spent += cost;
          modelTriangles += model.triangles;
          modelled[at] = 1;
          drawn += 1;
        } else if (!blocks) {
          spent += kind;
        }
      }
    }
    const procedural = this.#procedural;
    procedural.length = 0;
    // What the procedural belts may admit, as they admit: in the list's
    // order, every item in view spending one, and a structure its price.
    let admits = Number.POSITIVE_INFINITY;
    if (drawn > 0) {
      admits = 0;
      let left = pool - modelTriangles;
      let open = true;
      for (let at = 0; at < items.length; at += 1) {
        if (modelled[at] === 1) continue;
        const item = items[at] as ScatterItem;
        procedural.push(item);
        if (!open || !inView(item, pose)) continue;
        if (isStructureKind(item.kind)) {
          const cost = this.#price.get(item.kind) ?? price;
          if (cost > left) {
            open = false;
            continue;
          }
          left -= cost;
        }
        admits += 1;
      }
    }
    this.#write(items, drawn);
    this.#stats = {
      houses: drawn,
      triangles: modelTriangles,
      items: Math.ceil(modelTriangles / price),
      procedural: admits,
      rewrites: this.#stats.rewrites + (this.#rewrote ? 1 : 0),
    };
    this.#applyVisible();
    return drawn > 0 ? procedural : items;
  }

  /** Whether the last {@link #write} rewrote the buffer. */
  #rewrote = false;

  /** Writes the modelled items into the buffer, unless it already holds exactly them. */
  #write(items: readonly ScatterItem[], drawn: number): void {
    this.#rewrote = false;
    const held = this.#held;
    let same = drawn === this.#heldCount;
    let place = 0;
    for (let at = 0; same && at < items.length; at += 1) {
      if (this.#modelled[at] === 0) continue;
      const item = items[at] as ScatterItem;
      same =
        held[place * 4] === item.x &&
        held[place * 4 + 1] === item.z &&
        held[place * 4 + 2] === item.house &&
        held[place * 4 + 3] === (item.paint ?? 0);
      place += 1;
    }
    if (same) return;
    this.#rewrote = true;
    this.#grounded.count = 0;
    let vertex = 0;
    place = 0;
    for (let at = 0; at < items.length; at += 1) {
      if (this.#modelled[at] === 0) continue;
      const item = items[at] as ScatterItem;
      held[place * 4] = item.x;
      held[place * 4 + 1] = item.z;
      held[place * 4 + 2] = item.house ?? -1;
      held[place * 4 + 3] = item.paint ?? 0;
      place += 1;
      vertex = this.#append(item, vertex);
    }
    this.#heldCount = drawn;
    const geometry = this.mesh.geometry;
    geometry.setDrawRange(0, vertex);
    for (const attribute of [this.#position, this.#normal, this.#uv, this.#colour, this.#tint]) {
      attribute.clearUpdateRanges();
      if (vertex > 0) {
        attribute.addUpdateRange(0, vertex * attribute.itemSize);
        attribute.needsUpdate = true;
      }
    }
  }

  /** Writes one plot's model from vertex `at`, and its ground blob; returns the vertex after it. */
  #append(item: ScatterItem, at: number): number {
    const index = item.house ?? -1;
    const geometry = this.#houses?.models[index];
    const model = HOUSE_MODELS[index];
    if (geometry === undefined || model === undefined) return at;
    const front = STRUCTURE_FOOTPRINTS[item.kind as StructureKind].front;
    const placement = placeOnPlot(index, item.x, item.y, item.z, item.rotation, front);
    const [red, green, blue] = lotModelPaint(item.paint, item.kind === 'building');
    const tint = packedInstanceTint(item.x, item.z, realisticTints.masonry);
    at = writeHouseModel(
      geometry,
      placement,
      [red, green, blue],
      tint,
      {
        position: this.#position.array as Float32Array,
        normal: this.#normal.array as Float32Array,
        uv: this.#uv.array as Float32Array,
        colour: this.#colour.array as Float32Array,
        tint: this.#tint.array as Float32Array,
      },
      at,
    );
    const caster = this.#grounded.casters[this.#grounded.count];
    if (caster !== undefined) {
      // A structure's own frame, as `structureCasters` writes one: along the
      // way it faces, its middle half its length behind its front.
      caster.x = item.x;
      caster.y = item.y;
      caster.z = item.z;
      caster.yaw = item.rotation;
      caster.round = false;
      caster.halfAlong = model.length / 2;
      caster.halfAcross = model.depth / 2;
      caster.centreAlong = front - model.length / 2;
      caster.height = model.height;
      caster.strength = 1;
      this.#grounded.count += 1;
    }
    return at;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as Material).dispose();
  }
}

/** The arrays one house model is written into. @see writeHouseModel */
interface HouseModelArrays {
  readonly position: Float32Array;
  readonly normal: Float32Array;
  readonly uv: Float32Array;
  readonly colour: Float32Array;
  readonly tint: Float32Array;
}

/**
 * Writes a house model's every vertex from vertex `at`, placed by
 * `house-models.ts` §`placedPoint`, its normal turned with it and taken
 * through the stretch's inverse, in one colour and one tint — #1585's
 * mapped models and, since #1566, the villages'. Returns the vertex after it.
 */
function writeHouseModel(
  model: HouseGeometry,
  placement: HousePlacement,
  colour: Rgb,
  tint: number,
  into: HouseModelArrays,
  at: number,
): number {
  const [red, green, blue] = colour;
  const { ax, az, stretchX, stretchZ } = placement;
  const vertices = model.triangles * 3;
  for (let vertex = 0; vertex < vertices; vertex += 1) {
    const to = at + vertex;
    const [x, y, z] = placedPoint(
      placement,
      model.position[vertex * 3] as number,
      model.position[vertex * 3 + 1] as number,
      model.position[vertex * 3 + 2] as number,
    );
    into.position[to * 3] = x;
    into.position[to * 3 + 1] = y;
    into.position[to * 3 + 2] = z;
    const along = (model.normal[vertex * 3] as number) / stretchX;
    const up = model.normal[vertex * 3 + 1] as number;
    const across = (model.normal[vertex * 3 + 2] as number) / stretchZ;
    const nx = along * ax - across * az;
    const nz = along * az + across * ax;
    const length = Math.hypot(nx, up, nz) || 1;
    into.normal[to * 3] = nx / length;
    into.normal[to * 3 + 1] = up / length;
    into.normal[to * 3 + 2] = nz / length;
    into.uv[to * 2] = model.uv[vertex * 2] as number;
    into.uv[to * 2 + 1] = model.uv[vertex * 2 + 1] as number;
    into.colour[to * 3] = red;
    into.colour[to * 3 + 1] = green;
    into.colour[to * 3 + 2] = blue;
    into.tint[to] = tint;
  }
  return at + vertices;
}

/**
 * Copies `from`'s casters onto the end of `into`'s, as far as `into` has room
 * — #1566: the village models' blobs after the procedural structures', in the
 * structures' one list. Allocates nothing.
 */
export function appendCasters(into: BlobCasters, from: BlobCasters): void {
  for (let at = 0; at < from.count; at += 1) {
    const caster = into.casters[into.count];
    const source = from.casters[at];
    if (caster === undefined || source === undefined) return;
    caster.x = source.x;
    caster.y = source.y;
    caster.z = source.z;
    caster.yaw = source.yaw;
    caster.round = source.round;
    caster.halfAlong = source.halfAlong;
    caster.halfAcross = source.halfAcross;
    caster.centreAlong = source.centreAlong;
    caster.height = source.height;
    caster.strength = source.strength;
    into.count += 1;
  }
}

/** A list of no ground-blob casters: what a belt that draws nothing hands the blob belt. */
const NO_BLOB_CASTERS: BlobCasters = { casters: [], count: 0 };

/**
 * #1657: puts the mapped buildings' list last in `lists` (slot 2), the belt's
 * `grounded` while they are shown and drawn, none otherwise. Apart from the
 * view so a Node test runs the line the product runs.
 */
export function mappedBlobList(
  lists: BlobCasters[],
  shown: boolean,
  mapped: MappedBuildingBelt | undefined,
): void {
  lists[2] = shown && mapped !== undefined ? mapped.grounded : NO_BLOB_CASTERS;
}

/**
 * Writes `plan` into `caster` as #1657 grounds it: a rectangle, not round,
 * at its footprint's minimum-area rectangle, turned so that +Z runs along the
 * rectangle's long axis, as tall as its eaves stand above its foot.
 */
function groundMappedBuilding(plan: FootprintPlan, caster: BlobCaster): void {
  const rectangle = minimumAreaRectangle(plan.footprint);
  caster.x = rectangle.cx;
  caster.y = plan.base + FOUNDATION_METRES;
  caster.z = rectangle.cz;
  caster.yaw = Math.atan2(rectangle.ux, rectangle.uz);
  caster.round = false;
  caster.halfAlong = rectangle.halfLong;
  caster.halfAcross = rectangle.halfShort;
  caster.centreAlong = 0;
  caster.height = Math.max(0, plan.eaves - plan.base - FOUNDATION_METRES);
  caster.strength = 1;
}

/**
 * One frame's turn of the mapped buildings — #1549, `RealisticDrawing`'s
 * rule, apart from the view so a test can ride it: refills `belt` when the
 * frame's chunk changed (or the rung did, {@link MappedBuildingBelt.invalidate}),
 * inside the rung's `structureItems` (at most `REALISTIC_STRUCTURE_ITEMS`),
 * each structure item and billboard counted at `REALISTIC_TRIANGLES.structure`.
 * Returns the most procedural structures may then draw until the next refill,
 * or `undefined` on a frame that is not a refill — which reads one number and
 * allocates nothing.
 *
 * **The frame's procedural structures and the mapped buildings are ranked
 * together, by distance from the rider, under the one cap** — #1586, ADR 0054
 * D-5.6's "the nearest come first, within the cap" (the owner's lane
 * direction). Until #1586 every procedural structure was taken first, so a
 * town's edge with 36 field boundaries ahead drew none of its buildings.
 * The billboards are still taken first: they carry no place here, and the
 * logo belts draw them uncapped whatever this decides.
 *
 * ⚠️ **The ranking decides how many procedural structures are drawn, not
 * which.** The returned cap is a count, and the structure belts admit the
 * first that many in view in the frame's own order (`settlements.ts`
 * §`structuresAt`: buildings and lots first, then field boundaries nearest the
 * rider), so the ones the cap drops are that order's tail.
 */
export function refillMappedBuildings(
  belt: MappedBuildingBelt,
  view: MappedBuildingsInView,
  scatter: readonly ScatterItem[],
  billboards: number,
  structureItems: number,
): number | undefined {
  if (!belt.needsRefill(view.chunk)) return undefined;
  const structure = REALISTIC_TRIANGLES.structure;
  const items = Math.min(structureItems, REALISTIC_STRUCTURE_ITEMS);
  let count = 0;
  for (const item of scatter) if (isStructureKind(item.kind)) count += 1;
  if (rivalDistances.length < count) rivalDistances = new Float64Array(count);
  let at = 0;
  for (const item of scatter) {
    if (!isStructureKind(item.kind)) continue;
    rivalDistances[at] = Math.hypot(item.x - view.x, item.z - view.z);
    at += 1;
  }
  rivalDistances.subarray(0, count).sort();
  const stats = belt.refill(
    view.x,
    view.z,
    Math.max(0, items - billboards) * structure,
    view.chunk,
    {
      distances: rivalDistances,
      count,
      triangles: structure,
    },
  );
  return items - Math.ceil(stats.triangles / structure);
}

/** {@link refillMappedBuildings}' scratch: grown, never shrunk, so a refill rarely allocates. */
let rivalDistances = new Float64Array(REALISTIC_STRUCTURE_ITEMS);

/** Which of #621's bounds a realistic item's tint is drawn inside. @see realisticTints */
type RealisticTintClass = 'foliage' | 'masonry';

/**
 * The bounds every realistic item's seeded tint is drawn inside — #621:
 * `instance-tint.ts`'s, unless the browser gate is drawing its control.
 * Read by the belts on every frame, so a change reaches the next frame of a
 * view that already exists.
 */
let realisticTints: Readonly<Record<RealisticTintClass, TintBound>> = {
  foliage: FOLIAGE_TINT,
  masonry: MASONRY_TINT,
};

/**
 * Draws every realistic tree, shrub, rock and structure inside these bounds
 * from the next frame on — #621's browser-gate control, which sets both to
 * `instance-tint.ts` §`NO_TINT` and requires two instances of one shape to
 * read back alike. Pass `FOLIAGE_TINT` and `MASONRY_TINT` to put it back.
 *
 * @test-facing `apps/web/browser/game-harness.ts` §`tintProbe` draws its
 * control with it, and `realistic-renderer.test.ts` §"#621" its zero-bound case;
 * the product never changes its bounds
 */
export function setRealisticTints(foliage: TintBound, masonry: TintBound): void {
  realisticTints = { foliage, masonry };
}

/**
 * How the trees are drawn in every view built after {@link setTreeLevels} —
 * the product's levels, unless the browser gate is building its control.
 */
let treeLevels: TreeLevels = REALISTIC_TREE_LEVELS;

/**
 * Builds every view created after this call with its trees drawn at `levels`
 * — #617's browser-gate controls: the hard swap with no middle level
 * (`realistic-budget.ts` §`HARD_SWAP_TREE_LEVELS`), whose frame must submit at
 * least 60 000 more triangles, and the same levels with no band, whose
 * hand-over must jump. Pass `REALISTIC_TREE_LEVELS` to put it back.
 *
 * @test-facing `apps/web/browser/game-harness.ts` §`treeLevelProbe` builds its
 * controls with it; the product never changes how its trees are drawn
 */
export function setTreeLevels(levels: TreeLevels): void {
  treeLevels = levels;
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
 * - {@link GroundBlobBelt}: the ground darkened under the scenery it drew (#620).
 * - The road's and the ground's photographic materials, swapped onto the
 *   stylised meshes, so the road stays one mesh and one draw call (#425).
 * - The environment map, prefiltered from the sky with this view's own
 *   renderer ({@link prefilteredSky}), which it is handed and owns.
 */
class RealisticDrawing {
  readonly vegetation: RealisticVegetationBelt;
  readonly structures: RealisticStructureBelts;
  readonly primitives: ScatterBelt;
  readonly riders: RealisticRiderBelt;
  /** The riders' bike-shaped shadow, made from the riders just built — #626. */
  readonly shadows: RiderSilhouetteBelt;
  /** What {@link shadows} casts. For the browser gate. */
  readonly silhouette: RiderSilhouette;
  readonly grounding: GroundBlobBelt;
  /** The start and finish gantries — #679. */
  readonly gantries: GantryBelt;
  /** The wordmark's boards, on the start gate and the billboards — #966. */
  readonly logos: LogoBelt;
  /** The village streets' kerbs and pavements, in ambientCG's paving — #1535. */
  readonly pavements: PavementBelt;
  /** What stands on them: lamp posts, bollards, benches and bins — #1536. */
  readonly furniture: FurnitureBelt;
  /** Who walks them, and the footways — #1541. */
  readonly people: PeopleBelt;
  /** The holiday's decorations on the villages in reach — #1624. */
  readonly decorations: DecorationBelt;
  /** The villages' houses and main-street blocks as #1585's models — #1566. */
  readonly villageHouses: VillageHouseBelt;
  readonly environment: Texture;
  /** The road's and the ground's photographic materials. @see setSurfaces */
  #road: MeshStandardMaterial;
  #ground: MeshStandardMaterial;
  /** What {@link setSurfaces} builds them from again. */
  readonly #world: RealisticWorld;
  readonly #fields: {
    readonly span: { value: number };
    readonly count: { value: number };
    readonly treeLine: { value: number };
  };
  #surfaces: RealisticSurfaces;
  /** This frame's structures, as ground-blob casters — #620. @see groundScenery */
  readonly #structureCasters = blobCasters(REALISTIC_STRUCTURE_ITEMS);
  /**
   * The three lists the blob belt reads, made once: the vegetation's, the
   * structures' and, since #1657, the mapped buildings', which
   * {@link groundScenery} points at the mapped belt's own each frame.
   */
  readonly #casterLists: BlobCasters[];
  /** Whether the mapped buildings are grounded — #1657's lever. @see mappedBlobsShownOf */
  #mappedBlobs = true;
  /** The rung's scenery budget, as the structure belts spend it. @see setBudget */
  #budget = Number.POSITIVE_INFINITY;
  /** The rung's structures — what the procedural and the mapped buildings share. @see setBudget */
  #structureItems: number = REALISTIC_STRUCTURE_ITEMS;
  /**
   * The most procedural structures a frame may draw while the mapped buildings
   * hold their share — #1549: the rung's structures less what the last refill
   * took. Unbounded with none drawn. @see updateMapped
   */
  #structureCap = Number.POSITIVE_INFINITY;
  /** What the last refill left the procedural structures, re-applied on every frame that carries the town. */
  #mappedCap = Number.POSITIVE_INFINITY;
  /** What this frame's village models left the procedural belts — #1566. @see updateScenery */
  #villageLeft = Number.POSITIVE_INFINITY;
  /** The structures the procedural belts drew this frame: the scenery less the modelled houses. */
  #procedural: readonly ScatterItem[] = [];
  /** The ride's buildings from map data, once a frame has carried them — #1549. */
  #mapped: MappedBuildingBelt | undefined;
  /** Whether the browser gate has switched them off. @see mappedBuildingsShownOf */
  #mappedOn = true;
  #shown = true;
  /** Where the belts were added, for the mapped buildings' belt, built later. */
  #scene: Scene | undefined;

  constructor(
    world: RealisticWorld,
    /** The renderer's `capabilities.getMaxAnisotropy()`. */
    maxAnisotropy: number,
    /**
     * The sky prefiltered with the view's own renderer, which this drawing
     * owns and disposes. @see prefilteredSky
     */
    environment: Texture,
    fields: {
      readonly span: { value: number };
      readonly count: { value: number };
      readonly treeLine: { value: number };
    },
    /**
     * The kit the rider chose — #623. Required, so a view whose world arrives
     * after the rider was dressed cannot build a realistic rider in the house
     * kit by forgetting to pass it on.
     */
    riderKit: RiderKit,
    /** Which of the surfaces' shaders the road and the ground are built with — #1523. */
    surfaces: RealisticSurfaces,
  ) {
    this.#world = world;
    this.#fields = fields;
    this.#surfaces = surfaces;
    const anisotropy = Math.min(REALISTIC_ANISOTROPY, maxAnisotropy);
    for (const texture of surfaceMapsOf(world)) texture.anisotropy = anisotropy;
    this.vegetation = new RealisticVegetationBelt(world.vegetation, treeLevels);
    this.structures = new RealisticStructureBelts(world.structures);
    this.primitives = new ScatterBelt(new Map(), {
      skip: REALISTIC_PRIMITIVE_SKIP,
      physical: true,
    });
    this.riders = new RealisticRiderBelt(world.body, world.bicycle, world.rider);
    this.riders.setRiderKit(riderKit);
    this.silhouette = this.riders.silhouette();
    this.shadows = new RiderSilhouetteBelt(this.silhouette);
    this.grounding = new GroundBlobBelt();
    this.gantries = new GantryBelt(world.banners);
    this.logos = new LogoBelt(world.wordmark, 'realistic');
    this.pavements = new PavementBelt('realistic', world.structures.get('paving'));
    this.furniture = new FurnitureBelt('realistic', world.structures.get('planks'));
    this.people = new PeopleBelt(world.body);
    this.decorations = new DecorationBelt('realistic');
    this.villageHouses = new VillageHouseBelt(world.houses);
    this.#casterLists = [this.vegetation.grounded, this.#structureCasters, NO_BLOB_CASTERS];
    this.#road = this.#roadMaterial();
    this.#ground = this.#groundMaterial();
    this.environment = environment;
  }

  get road(): MeshStandardMaterial {
    return this.#road;
  }

  get ground(): MeshStandardMaterial {
    return this.#ground;
  }

  /**
   * Builds the road and the ground again with `surfaces`' shaders, releasing
   * the materials they replace — #1523. Only one that changes is rebuilt; the
   * caller puts the new ones on the meshes.
   */
  setSurfaces(surfaces: RealisticSurfaces): void {
    const was = this.#surfaces;
    this.#surfaces = surfaces;
    const rebound = surfaces.bounded !== was.bounded;
    if (surfaces.roadWear !== was.roadWear || rebound) {
      this.#road.dispose();
      this.#road = this.#roadMaterial();
    }
    if (surfaces.groundBlend !== was.groundBlend || rebound) {
      this.#ground.dispose();
      this.#ground = this.#groundMaterial();
    }
  }

  #roadMaterial(): MeshStandardMaterial {
    const { road } = this.#world;
    return photographicRoadMaterial(
      road.colour,
      road.normal,
      this.#surfaces.roadWear,
      this.#surfaces.bounded,
    );
  }

  #groundMaterial(): MeshStandardMaterial {
    const world = this.#world;
    const fields = this.#fields;
    return photographicGroundMaterial(
      world.ground.colour,
      world.ground.normal,
      fields.span,
      fields.count,
      // #627: the verge, the rock and scree, and where the tree line is —
      // and since #1274 the bare rock a steep bank wears. Without them
      // (#1523's `ground-blend` lever) the ground is #425's photograph and
      // #460's patchwork alone, as it was before #627.
      this.#surfaces.groundBlend
        ? { verge: world.verge, rock: world.rock, crag: world.crag, treeLine: fields.treeLine }
        : { treeLine: fields.treeLine },
      this.#surfaces.bounded,
    );
  }

  addTo(scene: Scene): void {
    this.#scene = scene;
    this.#mapped?.addTo(scene);
    this.vegetation.addTo(scene);
    this.structures.addTo(scene);
    this.primitives.addTo(scene);
    this.riders.addTo(scene);
    this.shadows.addTo(scene);
    this.grounding.addTo(scene);
    this.gantries.addTo(scene);
    this.logos.addTo(scene);
    this.pavements.addTo(scene);
    this.furniture.addTo(scene);
    this.people.addTo(scene);
    this.decorations.addTo(scene);
    this.villageHouses.addTo(scene);
  }

  setShown(on: boolean): void {
    this.#shown = on;
    this.#mapped?.setShown(on);
    this.vegetation.setShown(on);
    this.structures.setShown(on);
    this.primitives.setShown(on);
    this.riders.setShown(on);
    this.grounding.setShown(on);
    this.gantries.setShown(on);
    this.logos.setShown(on);
    this.pavements.setShown(on);
    this.furniture.setShown(on);
    this.people.setShown(on);
    this.decorations.setShown(on);
    this.villageHouses.setShown(on);
    // #626: shown only by the view, on a rung that grounds riders by contact.
    if (!on) this.shadows.setShown(false);
  }

  /** Every scenery belt, handed the same frame. */
  updateScenery(items: readonly ScatterItem[], pose: CameraPose): void {
    this.vegetation.update(items, pose);
    // #1566: the village houses in reach as models, inside the structures'
    // share, and the procedural belts handed the rest with what is left.
    const share = Math.min(this.#budget, this.#structureCap, this.#structureItems);
    this.#procedural = this.villageHouses.update(items, pose, share);
    const left = this.villageHouses.stats.procedural;
    if (left !== this.#villageLeft) {
      this.#villageLeft = left;
      this.#applyStructureBudget();
    }
    this.structures.update(this.#procedural, pose);
    this.primitives.update(items, pose);
  }

  /** The procedural structures' budget: the rung's, inside the mapped buildings' and the village models' shares. */
  #structureBudget(): number {
    return Math.min(this.#budget, this.#structureCap, this.#villageLeft);
  }

  #applyStructureBudget(): void {
    this.structures.setBudget(this.#structureBudget());
  }

  /**
   * The rung's scenery budget, handed to BOTH belts that draw scenery — #478.
   *
   * One method so that the two cannot be given different numbers, and so that
   * a view has one line to call: until #478 the view budgeted the primitives
   * belt alone, and the trees — the realistic world's cost — were free.
   * @see RealisticVegetationBelt.setBudget
   */
  setBudget(items: number, structureItems: number): void {
    this.#budget = items;
    // #1549: a new rung is a new share between the procedural structures and
    // the mapped buildings, so the next frame refills whatever its chunk.
    if (structureItems !== this.#structureItems) this.#mapped?.invalidate();
    this.#structureItems = structureItems;
    this.vegetation.setBudget(items);
    this.#applyStructureBudget();
    this.primitives.setBudget(items);
  }

  /**
   * The ride's buildings from map data — #1549. Called once a frame, BEFORE
   * {@link updateScenery}, with the frame's own scenery and billboards.
   *
   * On a frame whose chunk changed (or whose rung did) the belt refills inside
   * the rung's structure term, the frame's procedural structures and the
   * mapped buildings ranked together by distance from the rider (#1586,
   * {@link refillMappedBuildings}) — every structure item and billboard in the
   * frame counted at `REALISTIC_TRIANGLES.structure`, which is what the
   * structure term prices each at. Until the next refill the procedural structures keep to
   * what the mapped buildings left them ({@link #structureCap}), so a
   * structure coming into view mid-chunk cannot push the term past
   * `MAPPED_BUILDING_TRIANGLES`: the farthest goes undrawn, as the rung's
   * budget already drops one.
   *
   * ⚠️ The cap holds the PROCEDURAL structure belt only. Billboards are
   * counted at a refill and not between: the logo belts draw them uncapped, so
   * a board that comes into view mid-chunk can put the structure term a few
   * items over until the next refill. The held-to-the-budget guarantee is
   * strict for structures, one refill behind for billboards.
   *
   * Every other frame reads one number and allocates nothing.
   */
  updateMapped(
    view: MappedBuildingsInView | undefined,
    scatter: readonly ScatterItem[],
    billboards: number,
  ): void {
    if (view === undefined || !this.#mappedOn) {
      this.#mapped?.setCarried(view !== undefined);
      this.#capStructures(Number.POSITIVE_INFINITY);
      return;
    }
    if (this.#mapped?.buildings !== view.buildings) {
      this.#mapped?.mesh.removeFromParent();
      this.#mapped?.modelMesh.removeFromParent();
      this.#mapped?.dispose();
      this.#mapped = new MappedBuildingBelt(
        view.buildings,
        this.#world.structures,
        this.#world.houses,
      );
      this.#mapped.setShown(this.#shown);
      if (this.#scene !== undefined) this.#mapped.addTo(this.#scene);
    }
    this.#mapped.setCarried(true);
    const cap = refillMappedBuildings(
      this.#mapped,
      view,
      scatter,
      billboards,
      this.#structureItems,
    );
    if (cap !== undefined) this.#mappedCap = cap;
    this.#capStructures(this.#mappedCap);
  }

  /** Holds the procedural structures to `cap` items. @see updateMapped */
  #capStructures(cap: number): void {
    if (cap === this.#structureCap) return;
    this.#structureCap = cap;
    this.#applyStructureBudget();
  }

  /** The mapped buildings' belt, once a frame has carried them — #1549. */
  get mapped(): MappedBuildingBelt | undefined {
    return this.#mapped;
  }

  /** @see mappedBuildingsShownOf */
  mappedShown(on: boolean): void {
    this.#mappedOn = on;
    this.#mapped?.switchOn(on);
    // The next frame with them on refills: what it drew before may be stale.
    if (on) this.#mapped?.invalidate();
  }

  /**
   * The ground blobs under this frame's scenery — #620. Called after
   * {@link updateScenery}, with the SAME items: the vegetation belt has
   * written what it drew as meshes, and the structures are the ones the
   * structure belts admit — in view, and inside the rung's budget counted over
   * every kind, which is `ScatterBelt.update`'s own rule.
   */
  groundScenery(
    items: readonly ScatterItem[],
    pose: CameraPose,
    corridor: RoadCorridor,
    terrain: TerrainMesh,
    sun: SunStyle,
  ): void {
    // #1566: the structures the procedural belts drew, and then the village
    // models', each in its own footprint.
    structureCasters(
      this.villageHouses.stats.houses > 0 ? this.#procedural : items,
      pose,
      this.#structureBudget(),
      (kind) => this.structures.heightOf(kind),
      this.#structureCasters,
    );
    appendCasters(this.#structureCasters, this.villageHouses.grounded);
    // #1657: the mapped buildings' blobs, written at their refill, read last
    // so that the procedural blobs keep the slots they had before them.
    mappedBlobList(this.#casterLists, this.#mappedBlobs, this.#mapped);
    this.grounding.update(this.#casterLists, corridor, terrain, sun);
  }

  /** @see mappedBlobsShownOf */
  mappedBlobsShown(on: boolean): void {
    this.#mappedBlobs = on;
  }

  /** How many scenery items the last frame drew, every belt together. */
  get sceneryDrawn(): number {
    return (
      this.vegetation.drawnItems +
      this.structures.drawnItems +
      this.primitives.drawnItems +
      this.villageHouses.stats.houses
    );
  }

  dispose(): void {
    this.#mapped?.dispose();
    this.vegetation.dispose();
    this.structures.dispose();
    this.primitives.dispose();
    this.riders.dispose();
    this.shadows.dispose();
    this.grounding.dispose();
    this.gantries.dispose();
    this.logos.dispose();
    this.pavements.dispose();
    this.furniture.dispose();
    this.people.dispose();
    this.decorations.dispose();
    this.villageHouses.dispose();
    this.#road.dispose();
    this.#ground.dispose();
    this.environment.dispose();
  }
}

/**
 * The environment map, prefiltered from `sky` with `renderer` — a
 * `PMREMGenerator` needs one, which is why a view builds it and not the load.
 * The generator is disposed as soon as the map exists, releasing its
 * ping-pong target (`realistic-budget.ts` §`environmentMapBytes`).
 */
function prefilteredSky(renderer: WebGLRenderer, sky: Texture): Texture {
  const generator = new PMREMGenerator(renderer);
  const environment = generator.fromEquirectangular(sky).texture;
  generator.dispose();
  return environment;
}

/**
 * The realistic world's drawing, built from the loaded world as a view builds
 * it — #1657 — but with no GPU: no anisotropy, and an empty map where a
 * view's renderer would prefilter the sky. `undefined` when no world is loaded.
 *
 * @test-facing `realistic-textures.test.ts` runs a ride's frame through its
 * `updateMapped`, `updateScenery` and `groundScenery`, and reads the mapped
 * buildings' blobs back off its `grounding` mesh; a view builds its own in
 * `#applyWorld`
 */
export function realisticDrawingOfLoadedWorld(): RealisticDrawing | undefined {
  const world = realisticWorld;
  return world === undefined
    ? undefined
    : new RealisticDrawing(
        world,
        1,
        new DataTexture(),
        { span: { value: 1 }, count: { value: 1 }, treeLine: { value: 0 } },
        RIDER_KITS.rider,
        REALISTIC_SURFACES_DRAWN,
      );
}

/**
 * This frame's structures as ground-blob casters, written into `into` — #620:
 * the ones the structure belts admit, which is `ScatterBelt.update`'s own
 * rule — in view, and inside the rung's `budget` counted over EVERY kind in
 * the frame's order — each with `settlements.ts` §`STRUCTURE_FOOTPRINTS`'
 * footprint and the height the realistic world builds it to. Stops at the
 * list's capacity. Allocates nothing.
 */
export function structureCasters(
  items: readonly ScatterItem[],
  pose: CameraPose,
  budget: number,
  heightOf: (kind: StructureKind) => number,
  into: BlobCasters,
): void {
  into.count = 0;
  let admitted = 0;
  for (const item of items) {
    if (!inView(item, pose)) continue;
    if (admitted >= budget) break;
    admitted += 1;
    if (!isStructureKind(item.kind)) continue;
    const caster = into.casters[into.count];
    if (caster === undefined) break;
    const footprint = STRUCTURE_FOOTPRINTS[item.kind];
    caster.x = item.x;
    caster.y = item.y;
    caster.z = item.z;
    caster.yaw = item.rotation;
    caster.round = false;
    caster.halfAlong = ((footprint.front - footprint.back) / 2) * item.scale;
    caster.halfAcross = footprint.x * item.scale;
    caster.centreAlong = ((footprint.front + footprint.back) / 2) * item.scale;
    caster.height = heightOf(item.kind) * item.scale;
    caster.strength = 1;
    into.count += 1;
  }
}

/** Whether an item is one of `settlements.ts`' structures, which carry a footprint. */
function isStructureKind(kind: SceneryKind): kind is StructureKind {
  return Object.hasOwn(STRUCTURE_FOOTPRINTS, kind);
}

/**
 * Frees the realistic world's textures and geometry from the GPU, keeping the
 * objects: three uploads a disposed texture again if anything draws it, so a
 * later view that asks for realism still can, while a phone that stepped down
 * holds none of it meanwhile.
 *
 * Exported because a view reaches it only with a live context, which jsdom has
 * none of: `realistic-renderer.test.ts` §"#639's review" calls it directly to
 * hold every layer of a merged tree to being freed ({@link texturesOf}).
 */
export function evictRealisticWorldFromGpu(): void {
  const world = realisticWorld;
  if (world === undefined) return;
  world.sky.texture.dispose();
  world.banners?.texture.dispose();
  world.wordmark.dispose();
  for (const texture of surfaceMapsOf(world)) texture.dispose();
  for (const shapes of world.vegetation.values()) {
    for (const shape of shapes) {
      for (const part of shape.parts) {
        part.geometry.dispose();
        for (const map of texturesOf(part.material)) map.dispose();
      }
      for (const part of shape.middle?.parts ?? []) part.geometry.dispose();
      shape.impostor?.texture.dispose();
      shape.impostor?.normals?.dispose();
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
  /** #622: whether three fogs it at all. */
  readonly fogged: boolean;
  /** #622: whether it breathes the realistic air. @see breathesTheAir */
  readonly atmospheric: boolean;
  /**
   * #622: whether it is drawn in BOTH worlds — the water's and the riders'
   * contact shadows' — and so is never taught the realistic air. @see withAtmosphere
   */
  readonly shared: boolean;
}

/**
 * Which world a view is drawing — for the owner's harness page, which says so
 * on screen (D-7's "and says so"), for the browser gate, and since #1647 for
 * the demo, which publishes it as `window.__oylDemo.world` (`demo/stage.ts`).
 * The rider app does not need to ask: `GameView` decides the world a ride is
 * on and says so itself when a load fails or a hot device leaves realism (#475).
 */
export function drawnWorldOf(view: GameView): QualitySettings['world'] {
  return view instanceof ThreeGameView ? view.drawnWorld : 'stylised';
}

/**
 * Draws the realistic riders' shadow as the #626 silhouette (`true`, what a
 * ride draws) or as the round blob it replaced (`false`) — the browser gate's
 * control, which must read round.
 *
 * @test-facing called by `game-harness.ts` for the #626 control; nothing in
 * the render path turns the silhouette off
 */
export function riderSilhouettesOf(view: GameView, on: boolean): void {
  if (view instanceof ThreeGameView) view.showRiderSilhouettes(on);
}

/**
 * Sets how dark a whole silhouette is drawn — #626's darkness gate, whose
 * control draws it at `1`, full black, which the gate must refuse (#872's
 * review: a shadow bounded in shape and not in darkness passed as black).
 *
 * @test-facing called by `game-harness.ts` for that control; a ride draws
 * {@link CONTACT_SHADOW_DARKNESS} and nothing in the render path changes it
 */
export function riderSilhouetteDarknessOf(view: GameView, darkness: number): void {
  if (view instanceof ThreeGameView) view.setRiderSilhouetteDarkness(darkness);
}

/**
 * The silhouette a view's realistic riders cast, while it draws the realistic
 * world — #626: the browser gate holds the SHIPPED shader's shadow to
 * `rider-silhouette.ts` §`silhouetteCoverage` over this very picture.
 *
 * @test-facing read by `game-harness.ts`; nothing in the render path asks
 */
export function realisticSilhouetteOf(view: GameView): RiderSilhouette | undefined {
  return view instanceof ThreeGameView ? view.realisticSilhouette : undefined;
}

/** #783's browser-gate controls. @see remoteRiderControlOf */
export type RemoteRiderControl = 'none' | 'each-own-mesh' | 'no-realistic-rule';

/**
 * #783's two controls, for the browser gate and nothing else: `'each-own-mesh'`
 * draws every remote rider in a rider belt of its own — four draw calls each,
 * which the stylised draw-call assertion must then catch — and
 * `'no-realistic-rule'` hands a realistic frame's remote riders all to the
 * stylised belt, which the triangle assertion must then catch.
 *
 * @test-facing called by `game-harness.ts`; nothing in the render path sets a
 * control
 */
export function remoteRiderControlOf(view: GameView, control: RemoteRiderControl): void {
  if (view instanceof ThreeGameView) view.setRemoteControl(control);
}

/**
 * Draws a view's realistic riders, or leaves them out while their shadows are
 * still cast — #626: the browser gate reads a shadow the rider would otherwise
 * stand on.
 *
 * @test-facing called by `game-harness.ts`; nothing in the render path hides
 * the riders while drawing their shadows
 */
export function realisticRidersShownOf(view: GameView, on: boolean): void {
  if (view instanceof ThreeGameView) view.showRealisticRiders(on);
}

/**
 * Where the realistic rider's shoulders were in a view's last frame, in world
 * space — #625: the browser gate reads them on two frames half a pedal stroke
 * apart. `undefined` for a view drawing no realistic rider.
 *
 * @test-facing read by `game-harness.ts` for the browser gate's rock
 * assertion; nothing in the render path needs to ask
 */
export function realisticShouldersOf(
  view: GameView,
): { readonly x: number; readonly y: number; readonly z: number } | undefined {
  return view instanceof ThreeGameView ? view.realisticShoulders() : undefined;
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
 * Where, in plan, every tree, shrub and rock a view's last realistic frame
 * submitted stands, at whatever level — #1534's browser gate, which holds them
 * off every settlement's ground. Empty for a stylised frame.
 *
 * @unwired reached only from the browser gate's harness; nothing in the render
 * path needs to ask.
 */
export function realisticVegetationPlacesOf(
  view: GameView,
): readonly { readonly kind: string; x: number; z: number }[] {
  return view instanceof ThreeGameView ? view.realisticVegetationPlaces() : [];
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
 * Moves a view's near plane and turns its near-plane cull off or on — #545.
 * The browser gate's measure and its control: a frame drawn with the near
 * plane where it ships and again with it nearer differs only where something
 * stood between the two planes, which is exactly what the shipped plane cut
 * away; with the cull off, a frame whose scenery the plane cuts must show it.
 *
 * @test-facing the browser gate's switch, read by `game-harness.ts`; the
 * product never moves the near plane nor turns the cull off.
 */
export function nearFieldOf(view: GameView, nearMetres: number, clear: boolean): void {
  if (view instanceof ThreeGameView) view.nearField(nearMetres, clear);
}

/**
 * Turns a view's ground blobs off or on — #620. The browser gate's control:
 * with them off, the ground under a tree's blob and the ground 5 m from it
 * must read alike, or the darkening measured with them on is the ground's.
 *
 * @test-facing the browser gate's switch, read by `game-harness.ts`; the
 * product never hides the blobs of a realistic frame.
 */
export function showGroundBlobsOf(view: GameView, on: boolean): void {
  if (view instanceof ThreeGameView) view.showGroundBlobs(on);
}

/**
 * What a view's last frame drew of the ground blobs — #620, for the browser
 * gate: how many, how many triangles that is, and each one's instance matrix
 * (column-major, sixteen numbers a blob), from which the harness reads where a
 * blob's middle is and how far it reaches. Nothing in the stylised world,
 * which draws none.
 *
 * @test-facing read by `game-harness.ts` for #620's probe and its cost
 * figures; nothing in the render path needs to ask.
 */
export function groundBlobsOf(view: GameView): {
  readonly blobs: number;
  readonly triangles: number;
  readonly matrices: readonly number[];
} {
  const mesh = view instanceof ThreeGameView ? view.groundBlobMesh : undefined;
  const blobs = mesh?.visible === true ? mesh.count : 0;
  const index = mesh?.geometry.getIndex();
  return {
    blobs,
    triangles: blobs * ((index?.count ?? 0) / 3),
    matrices: mesh === undefined ? [] : Array.from(mesh.instanceMatrix.array.slice(0, blobs * 16)),
  };
}

/**
 * The ground's vertex positions as the view last uploaded them — #1547, for
 * the browser gate: read off the renderer's own position attribute, a copy,
 * so a probe measures the triangles a GPU was handed rather than the
 * `TerrainMesh` they were built from. Empty for a view that is not three.js.
 *
 * @test-facing read by `game-harness.ts` for #1547's probe; nothing in the
 * render path needs to ask.
 */
export function terrainPositionsOf(view: GameView): Float32Array {
  if (!(view instanceof ThreeGameView)) return new Float32Array(0);
  const position = view.terrainMesh.geometry.getAttribute('position') as
    BufferAttribute | undefined;
  return position === undefined ? new Float32Array(0) : Float32Array.from(position.array);
}

/** How many numbers {@link writeTriangles} writes for a geometry: nine a triangle. */
function triangleNumbers(geometry: BufferGeometry): number {
  const index = geometry.getIndex();
  return (index === null ? geometry.getAttribute('position').count : index.count) * 3;
}

/**
 * Writes a geometry's triangles into `out` from `offset`, nine numbers a
 * triangle, scaled by `factor`; returns where it stopped. Into a sized array
 * rather than a growing one, so a realistic tree's half-million numbers are
 * one allocation (#545's review).
 */
function writeTriangles(
  geometry: BufferGeometry,
  factor: number,
  out: Float32Array,
  offset: number,
): number {
  const position = geometry.getAttribute('position');
  const index = geometry.getIndex();
  const corners = index === null ? position.count : index.count;
  let at = offset;
  for (let corner = 0; corner < corners; corner += 1) {
    const vertex = index === null ? corner : index.getX(corner);
    out[at] = position.getX(vertex) * factor;
    out[at + 1] = position.getY(vertex) * factor;
    out[at + 2] = position.getZ(vertex) * factor;
    at += 3;
  }
  return at;
}

/** Each loaded kind's shapes as triangles, built once per set of loaded geometries. */
const nearFieldTriangles = new WeakMap<object, readonly ShapeTriangles[]>();

/**
 * The shapes each kind is drawn as in a world, as triangles in the item's own
 * frame at a scale of 1 — what `near-field.ts` §`clearOfTheCamera` asks when
 * an item's box reaches the near plane — #545.
 *
 * - **Stylised**: {@link sceneryGeometries}, already fitted and centred by
 *   {@link prepareSceneryGeometry}. A kind with none loaded — the post, or a
 *   model that failed — is `undefined`, and is judged by its box.
 * - **Realistic**: each loaded shape's parts together, sized as
 *   {@link RealisticVegetationBelt} sizes an instance, `sceneryFitMetres` over
 *   the scan's extent. The structures and the post are `undefined`.
 *
 * Kept against the geometries they were built from, so a frame costs a
 * lookup. ⚠️ **Built when the models LOAD, not on the frame a tree first comes
 * near** — {@link warmNearFieldShapes}, from {@link loadSceneryModels} and
 * {@link loadRealisticWorld}. #545's review found the first version building a
 * realistic kind's half-million numbers, and `near-field.ts` sorting them, on
 * that frame; built lazily they still would be, so the warm is what moves the
 * cost off the render loop.
 */
function nearFieldShapesOf(
  world: DrawnWorld,
  kind: SceneryKind,
): readonly ShapeTriangles[] | undefined {
  if (world === 'realistic') {
    if (!isRealisticVegetation(kind)) return undefined;
    const shapes = realisticWorld?.vegetation.get(kind);
    if (shapes === undefined || shapes.length === 0) return undefined;
    const cached = nearFieldTriangles.get(shapes);
    if (cached !== undefined) return cached;
    const built = shapes.map((shape) => {
      const out = new Float32Array(
        shape.parts.reduce((sum, part) => sum + triangleNumbers(part.geometry), 0),
      );
      let at = 0;
      for (const part of shape.parts) {
        at = writeTriangles(part.geometry, sceneryFitMetres(kind) / shape.extent, out, at);
      }
      return out;
    });
    nearFieldTriangles.set(shapes, built);
    return built;
  }
  const geometries = sceneryGeometries.get(kind);
  if (geometries === undefined || geometries.length === 0) return undefined;
  const cached = nearFieldTriangles.get(geometries);
  if (cached !== undefined) return cached;
  const built = geometries.map((geometry) => {
    const out = new Float32Array(triangleNumbers(geometry));
    writeTriangles(geometry, 1, out, 0);
    return out;
  });
  nearFieldTriangles.set(geometries, built);
  return built;
}

/** One lookup per world, made once rather than a closure a frame. */
const NEAR_FIELD_SHAPES: Readonly<Record<DrawnWorld, ShapesOf>> = {
  stylised: (kind) => nearFieldShapesOf('stylised', kind),
  realistic: (kind) => nearFieldShapesOf('realistic', kind),
};

/** The shapes each kind is drawn as in a world. @see nearFieldShapesOf */
export function nearFieldShapes(world: DrawnWorld): ShapesOf {
  return NEAR_FIELD_SHAPES[world];
}

/**
 * Builds and prepares every kind's near-field shapes for a world, so that none
 * is built on a frame — #545's review. Called when that world's models load.
 */
function warmNearFieldShapes(world: DrawnWorld): void {
  try {
    for (const kind of SCENERY_KINDS) {
      for (const shape of nearFieldShapesOf(world, kind) ?? []) prepareShape(shape);
    }
  } catch {
    // ⚠️ Not a failed load: the models ARE loaded, and a load reported as
    // failed after its world was swapped in would leave the old one unreleased.
    // Whatever did not warm is built on the frame that first asks, as before.
  }
}

/**
 * Turns a view's realistic horizon back to the stylised world's pale one, or
 * on again — #544. The browser gate's control: with it off, the pale band the
 * owner saw on the tablet must read back off the drawing buffer, or the
 * measurement with it on proves nothing about that band.
 *
 * @test-facing the browser gate's control switch, read by `game-harness.ts`;
 * the product never turns the photographed horizon off.
 */
export function horizonFromSkyOf(view: GameView, on: boolean): void {
  if (view instanceof ThreeGameView) view.horizonFromSky(on);
}

/**
 * Holds every realistic plant still, or lets the breeze move it again — #630.
 * Module state, for `FOLIAGE`'s reason. For the browser gate's measurements
 * of the trees' LEVELS (#617, #639), which compare two drawings of the same
 * frame pixel for pixel and are about which level draws, not about motion:
 * the breeze has its own gate.
 *
 * @test-facing read by `game-harness.ts`; the product never holds the leaves.
 */
export function foliageStillOf(still: boolean): void {
  FOLIAGE.oylSwayScale.value = still ? 0 : 1;
}

/**
 * Turns a view's gantries off, or on again — #679. The browser gate's
 * control: with them off, the probe aimed at a banner must read what is
 * behind it.
 *
 * @test-facing the browser gate's control switch, read by `game-harness.ts`;
 * the product always draws them.
 */
export function gantriesShownOf(view: GameView, on: boolean): void {
  if (view instanceof ThreeGameView) view.gantriesShown(on);
}

/**
 * Turns a view's wordmark boards off, or on again — #966. The browser gate's
 * control: with them off, the probe aimed at the start gate's board or a
 * billboard must read no wordmark, and the stylised world must upload no
 * texture at all.
 *
 * @test-facing the browser gate's control switch, read by `game-harness.ts`;
 * the product always draws them.
 */
export function logosShownOf(view: GameView, on: boolean): void {
  if (view instanceof ThreeGameView) view.logosShown(on);
}

/**
 * Which way up the wordmark is drawn: the product's, or one of the browser
 * gate's controls — #966's review.
 *
 * @test-facing named by `game-harness.ts`, which turns the wordmark with
 * {@link wordmarkOrientationOf}; the product draws it upright.
 */
export type WordmarkOrientation = 'upright' | 'mirrored' | 'upside-down';

/**
 * Draws a view's wordmark mirrored or upside down, or upright again — #966's
 * review. The browser gate's control for the wordmark's orientation: drawn
 * either way wrong, the probe's reading must agree with the wrong picture.
 *
 * @test-facing the browser gate's control, read by `game-harness.ts`; the
 * product draws the wordmark upright.
 */
export function wordmarkOrientationOf(view: GameView, orientation: WordmarkOrientation): void {
  if (view instanceof ThreeGameView) view.wordmarkOrientation(orientation);
}

/**
 * How many wordmark boards a view drew in its last frame, in the world it drew
 * — #966.
 *
 * @test-facing read by `game-harness.ts`, which requires the gate's board
 * near the start line and a billboard's where the frame holds one.
 */
export function logoBoardsOf(view: GameView): number {
  const mesh = view instanceof ThreeGameView ? view.logoMesh : undefined;
  return mesh?.visible === true ? mesh.count : 0;
}

/**
 * Turns a view's buildings from map data off, or on again — #1549. The
 * browser gate's control (`&levers=-mapped-buildings`): with them off, the
 * probe aimed at a mapped wall must read the ground behind it, and the frame
 * spend none of their draw calls.
 *
 * @test-facing the browser gate's control switch, read by `game-harness.ts`;
 * the product always draws them.
 */
export function mappedBuildingsShownOf(view: GameView, on: boolean): void {
  if (view instanceof ThreeGameView) view.mappedBuildingsShown(on);
}

/**
 * Grounds a view's buildings from map data, or stops — #1657. The owner's
 * page's lever (`&levers=-mapped-blobs`): off, no mapped building is handed
 * to the ground-blob belt, which is the picture and the cost before #1657.
 * A setting of the view's, so it holds across a rung change.
 *
 * @test-facing the realistic page's lever, read by `realistic-harness.ts`;
 * the product always grounds them.
 */
export function mappedBlobsShownOf(view: GameView, on: boolean): void {
  if (view instanceof ThreeGameView) view.mappedBlobsShown(on);
}

/**
 * What a view's buildings from map data drew at its last refill, and the
 * belt itself — #1549, for the browser gate's counts. `undefined` before a
 * realistic frame has carried any.
 *
 * @test-facing read by `game-harness.ts` §`mappedTownProbe`; the product
 * reads the belt's stats nowhere
 */
export function mappedBuildingStatsOf(
  view: GameView,
): { readonly stats: MappedBuildingStats; readonly refills: number } | undefined {
  const belt = view instanceof ThreeGameView ? view.mappedBuildings : undefined;
  return belt === undefined ? undefined : { stats: belt.stats, refills: belt.refills };
}

/**
 * Draws a view's village houses and main-street blocks as #1585's models, or
 * as their kinds — #1566. The owner's page's lever
 * (`&levers=-village-models`): off, every plot is drawn as its procedural
 * building, which is the picture and the cost before #1566's models (its
 * placement and paint stay). A setting of the view's, so it holds across a
 * rung change.
 *
 * @test-facing the realistic page's lever, read by `realistic-harness.ts`;
 * the product always draws the models
 */
export function villageModelsShownOf(view: GameView, on: boolean): void {
  if (view instanceof ThreeGameView) view.villageModelsShown(on);
}

/**
 * What a view's village models drew on its last frame — #1566, for the
 * browser gate's counts. `undefined` before a realistic frame.
 *
 * @test-facing read by `realistic-harness.ts`; the product reads the stats nowhere
 */
export function villageHouseStatsOf(view: GameView): VillageHouseStats | undefined {
  return view instanceof ThreeGameView ? view.villageHouses : undefined;
}

/**
 * Turns a view's village pavements off, or on again — #1535. The browser
 * gate's control: with them off, the probe aimed at a pavement must read
 * something else there, or it was never reading the pavement.
 *
 * @test-facing the browser gate's control switch, read by `game-harness.ts`;
 * the product always draws them.
 */
export function pavementsShownOf(view: GameView, on: boolean): void {
  if (view instanceof ThreeGameView) view.pavementsShown(on);
}

/**
 * Turns a view's front paths off, or on again — #1564. The browser gate's
 * control: with them off, the village frame's drawn mesh holds none.
 *
 * @test-facing the browser gate's control switch, read by `game-harness.ts`;
 * the product always draws them.
 */
export function doorPathsShownOf(view: GameView, on: boolean): void {
  if (view instanceof ThreeGameView) view.doorPathsShown(on);
}

/**
 * Where each front path a view drew in its last frame is — #1564: the middle,
 * in plan, of each path's group of the drawn pavement mesh, in the world it
 * drew. Empty where the mesh was not drawn.
 *
 * @test-facing read by `game-harness.ts`, which holds them to the village's
 * built plots: exactly one on each, none on an unbuilt one.
 */
export function doorPathsDrawnOf(
  view: GameView,
): readonly { readonly x: number; readonly z: number }[] {
  const mesh = view instanceof ThreeGameView ? view.pavementMesh : undefined;
  if (mesh?.visible !== true) return [];
  const { geometry } = mesh;
  const positions = geometry.getAttribute('position');
  const index = geometry.index;
  if (positions === undefined || index === null) return [];
  return geometry.groups.map((group) => {
    let x = 0;
    let z = 0;
    for (let at = group.start; at < group.start + group.count; at += 1) {
      const vertex = index.getX(at);
      x += positions.getX(vertex);
      z += positions.getZ(vertex);
    }
    return { x: x / Math.max(1, group.count), z: z / Math.max(1, group.count) };
  });
}

/**
 * Turns a view's cross streets off, or on again — #1565. The browser gate's
 * control: with them off, a frame at a junction draws none.
 *
 * @test-facing the browser gate's control switch, read by `game-harness.ts`;
 * the product always draws them.
 */
export function sideRoadsShownOf(view: GameView, on: boolean): void {
  if (view instanceof ThreeGameView) view.sideRoadsShown(on);
}

/**
 * The mesh a view draws its cross streets with, and the road's own — #1565:
 * one mesh for every side road in view, wearing the road's material.
 *
 * @test-facing read by `three-renderer.test.ts` and `game-harness.ts`.
 */
export function sideRoadMeshOf(
  view: GameView,
): { readonly sideRoads: Mesh; readonly road: Mesh } | undefined {
  return view instanceof ThreeGameView
    ? { sideRoads: view.sideRoadMesh, road: view.roadMesh }
    : undefined;
}

/**
 * Turns a view's street furniture off, or on again — #1536. The browser
 * gate's control: with it off, the frame must change by the pixels the
 * furniture covered, and lose one draw call a surface (#1689).
 *
 * @test-facing the browser gate's control switch, read by `game-harness.ts`;
 * the product always draws it.
 */
export function furnitureShownOf(view: GameView, on: boolean): void {
  if (view instanceof ThreeGameView) view.furnitureShown(on);
}

/**
 * How many pieces of each furniture kind a view drew in its last frame, in the
 * world it drew — #1536: none away from a village, and none past
 * `streets.ts` §`FURNITURE_DRAW_METRES`.
 *
 * @test-facing read by `game-harness.ts`, which requires every kind beside a
 * village and none in open country.
 */
export function furnitureCountsOf(view: GameView): Readonly<Record<FurnitureKind, number>> {
  const belt = view instanceof ThreeGameView ? view.furnitureBelt : undefined;
  const counts = {} as Record<FurnitureKind, number>;
  for (const kind of FURNITURE_KINDS) counts[kind] = belt?.drawnOf(kind) ?? 0;
  return counts;
}

/**
 * What each holiday decorates with on this view — #1624. The product's is
 * `decorations.ts` §`HOLIDAY_DECORATIONS`; the owner's page hands its probe
 * here (`browser/realistic/config.ts` §`PROBE_DECORATIONS`), which no rider
 * reaches.
 *
 * @test-facing read by `realistic-harness.ts` and the suite; the product
 * always decorates with its own table
 */
export function decorationKindsOf(view: GameView, kinds: ItemTable): void {
  if (view instanceof ThreeGameView) view.decorationKinds = kinds;
}

/**
 * The decoration belt of the world a view drew last — #1624. Read by
 * `realistic-harness.ts`, which publishes its triangles, by the suite, and by
 * the demo's showcase (#1653, `demo/main.tsx`), which publishes them too; the
 * rider app reads the belt nowhere but in `render`.
 */
export function decorationBeltOf(view: GameView): DecorationBelt | undefined {
  return view instanceof ThreeGameView ? view.decorationBelt : undefined;
}

/**
 * How many pavement triangles a view drew in its last frame, in the world it
 * drew — #1535: nought away from a village.
 *
 * @test-facing read by `game-harness.ts`, which requires them beside a village
 * and none in open country.
 */
export function pavementTrianglesOf(view: GameView): number {
  const mesh = view instanceof ThreeGameView ? view.pavementMesh : undefined;
  if (mesh?.visible !== true) return 0;
  return (mesh.geometry.index?.count ?? 0) / 3;
}

/**
 * How many gantry boxes and banners a view drew in its last frame — #679.
 *
 * @test-facing read by `game-harness.ts`, which requires some near a line and
 * none mid-route.
 */
export function gantryCountsOf(view: GameView): {
  readonly boxes: number;
  readonly banners: number;
} {
  const meshes = view instanceof ThreeGameView ? view.gantryMeshes : undefined;
  return {
    boxes: meshes?.boxes.visible === true ? meshes.boxes.count : 0,
    banners: meshes?.banners.visible === true ? meshes.banners.count : 0,
  };
}

/**
 * Relights the realistic trees' far band by the world's sun, or (`false`) draws
 * the strips as they were before #630 — the browser gate's control. Module
 * state, for `FOLIAGE`'s reason: every view shares the loaded world's
 * materials.
 *
 * @test-facing the browser gate's control switch, read by `game-harness.ts`;
 * the product always lights them.
 */
export function impostorsLitOf(on: boolean): void {
  FOLIAGE.oylImpostorLit.value = on ? 1 : 0;
}

/**
 * Sets how much of each of the realistic ground's blends is drawn — #627:
 * verge, rock and scree, each 1 in the product. The browser gate's control
 * takes the rock to 0, and a steep bank must then read as the level grass
 * beside it does.
 *
 * `crag` — #1274 — is how much of a steep bank's rock wears the crag's
 * photograph: 1 in the product, and 0 for the control that draws the bank in
 * the scree's photograph, as it was drawn before.
 *
 * @test-facing the browser gate's control switch, read by `game-harness.ts`;
 * the product always draws all four.
 */
export function groundBlendOf(
  view: GameView,
  verge: number,
  rock: number,
  scree: number,
  crag = 1,
): void {
  if (view instanceof ThreeGameView) view.groundBlend(verge, rock, scree, crag);
}

/**
 * Which of the realistic surfaces' own shaders are built — #1523, the owner's
 * cost pairs for #627's ground blend (with #1274's crag) and #628's road wear
 * (with #879's). Each `false` builds that material WITHOUT its shader, as it
 * was before: the ground as #425's photograph and #460's patchwork, the road
 * with no wear. @see photographicRoadMaterial
 *
 * `bounded` is #1523's fix and not a layer: `true`, the product, draws the
 * same picture for less — the wear's patch loop only where a patch can reach
 * and the ground's derivatives taken once. `false` builds both shaders as
 * they were before it: the browser gate's reference for "the same picture",
 * and the owner's `-surface-bounds` before/after pair on the tablet.
 * @see photographicRoadMaterial @see photographicGroundMaterial
 */
export interface RealisticSurfaces {
  readonly groundBlend: boolean;
  readonly roadWear: boolean;
  readonly bounded: boolean;
}

/** What the product draws: both, bounded. */
const REALISTIC_SURFACES_DRAWN: RealisticSurfaces = {
  groundBlend: true,
  roadWear: true,
  bounded: true,
};

/**
 * Builds the realistic road and ground with `surfaces`' shaders, in this view
 * and in every realistic drawing it builds after — a setting of the view's, so
 * it survives a rung change.
 *
 * ⚠️ **Not {@link groundBlendOf} or {@link roadWearOf}**: those set uniforms on
 * the same program, so every fragment still pays for the blend and the wear.
 * This takes the code out of the program, which is what a tablet's GPU clock
 * can tell apart (#1523). A rebuilt ground's blend shares start at 1 again.
 *
 * @test-facing the owner's page's `-ground-blend` and `-road-wear` levers
 * (`realistic-harness.ts`) and the browser gate's read of them
 * (`game-harness.ts`); the product always draws both.
 */
export function realisticSurfacesOf(view: GameView, surfaces: RealisticSurfaces): void {
  if (view instanceof ThreeGameView) view.realisticSurfaces(surfaces);
}

/**
 * The uniforms the GPU holds for the realistic road's and ground's programs as
 * last drawn, by name and sorted — read from WebGL, not from the material, so
 * it is what was compiled and linked. `undefined` where the view has no
 * realistic drawing; a material not yet drawn reads `[]`.
 *
 * @test-facing the browser gate's check of {@link realisticSurfacesOf}
 * (`game-harness.ts`); the product never reads it.
 */
export function realisticSurfaceUniformsOf(
  view: GameView,
): { readonly road: readonly string[]; readonly ground: readonly string[] } | undefined {
  return view instanceof ThreeGameView ? view.realisticSurfaceUniforms() : undefined;
}

/**
 * Takes the realistic road's wear off, or puts it back — #628. The browser
 * gate's control: with the wear off, the wheel track must read back no
 * different from the lane's middle, or the difference the gate measured was
 * the photograph's own grain and the light. `'surface'` keeps only what a
 * wheel track does to the roughness and the relief — the specular term, which
 * the colour clamp does not reach (#879's review) — so the gate can read it
 * against `road-wear.ts` §`SURFACE_WEAR_ALLOWANCE`.
 *
 * @test-facing the browser gate's control switch, read by `game-harness.ts`;
 * the product never turns the wear off.
 */
export function roadWearOf(view: GameView, on: boolean | 'surface'): void {
  if (view instanceof ThreeGameView) view.roadWear(on);
}

/**
 * Holds the realistic water's Fresnel term at a constant, or (`undefined`)
 * lets it be computed again — #629. The browser gate's control: held, a near
 * and a grazing patch of the same lake must read alike, or the difference the
 * gate measured was the fog or the sky and not the Fresnel term.
 *
 * @test-facing the browser gate's control switch, read by `game-harness.ts`;
 * the product always computes Fresnel.
 */
export function waterFresnelOf(view: GameView, held: number | undefined): void {
  if (view instanceof ThreeGameView) view.waterFresnel(held);
}

/**
 * Whether a view's water reflects the scene's environment map — #629: on a
 * realistic rung with a world loaded, and never on a stylised one.
 *
 * @test-facing read by `game-harness.ts`, which requires it on the realistic
 * view and off after the step down.
 */
export function waterReflectsOf(view: GameView): boolean {
  return view instanceof ThreeGameView && view.waterReflects;
}

/**
 * Takes the realistic bicycle's rubber normal map off, or puts it back — #624.
 * The browser gate's control: with the tread off, the front tyre must read
 * back flatter than the floor the product's tread is held above, or the
 * variance the gate measured was the tyre's curve and the light rather than
 * the tread.
 *
 * @test-facing the browser gate's control switch, read by `game-harness.ts`;
 * the product never takes the tread off.
 */
export function bicycleTreadOf(view: GameView, on: boolean): void {
  if (view instanceof ThreeGameView) view.bicycleTread(on);
}

/**
 * Flattens a view's realistic air to one colour for every direction, or turns
 * its valley haze off — #622. The browser gate's controls: with the table
 * flattened, a probe towards the sun and one away must agree; with the haze
 * off, a valley floor must read as it did before #622.
 *
 * @test-facing the browser gate's control switch, read by `game-harness.ts`;
 * the product always breathes the directional air.
 */
export function atmosphereOf(
  view: GameView,
  air: { readonly table: 'directional' | 'flattened'; readonly valley: boolean },
): void {
  if (view instanceof ThreeGameView) view.atmosphere(air);
}

/**
 * What a view's last frame fogged with — #622. @see airOf
 *
 * @test-facing the shape `game-harness.ts` reads the view's air in; nothing in
 * the render path asks
 */
export interface AirReading {
  /** The fog's own colour, `fogColor`, in the output colour space. */
  readonly base: readonly [number, number, number];
  /** The table the shader read, in the output colour space, three floats a direction. */
  readonly table: readonly number[];
  readonly share: number;
  readonly turn: number;
  readonly density: number;
  readonly valleyMiddle: number;
  readonly valleyHaze: number;
}

/**
 * What a view's last frame fogged with — #622, so the browser gate predicts a
 * pixel from the same numbers the shader was handed.
 *
 * @test-facing read by `game-harness.ts`; nothing in the render path asks.
 */
export function airOf(view: GameView): AirReading | undefined {
  return view instanceof ThreeGameView ? view.airReading : undefined;
}

/**
 * Puts a view's realistic foliage back in the order three would draw it
 * unasked, or in #619's order again — lever 1's control. With it off, the
 * canopy is drawn among the opaque world rather than after it, and the frame
 * must read back identical: the order is a cost, never a picture.
 *
 * @test-facing the control switch the browser gate and the owner's page both
 * use, read by `game-harness.ts` and `realistic-harness.ts`; the product never
 * turns the order off
 */
export function foliageOrderedOf(view: GameView, on: boolean): void {
  if (view instanceof ThreeGameView) view.foliageOrdered(on);
}

/**
 * Draws a view's realistic firs with their depth pre-pass, without it, or —
 * the browser gate's control — with the EQUAL test and no pre-pass, which
 * draws no fir. Drawn and off must read back identical: the pre-pass is a
 * cost, never a picture. @see DepthPrepassMode
 *
 * @test-facing the owner's page's `-fir-prepass` lever (`realistic-harness.ts`)
 * and the browser gate's read of it (`game-harness.ts`); the product always
 * draws the pre-pass. The view builds its realistic belts when a rung first
 * asks for them, so a caller applies it again after a rung change.
 */
export function firDepthPrepassOf(view: GameView, mode: DepthPrepassMode): void {
  if (view instanceof ThreeGameView) view.firDepthPrepass(mode);
}

/**
 * One draw of a frame, as {@link drawOrderOf} reports it.
 *
 * @unwired the shape of what `drawOrderOf` hands the browser gate's harness
 */
export interface DrawnPiece {
  /** Whether its fragments may be discarded: an alpha-tested leaf, or a far tree's billboard. */
  readonly cut: boolean;
  /** Whether three draws it in its transparent pass, after every opaque draw. */
  readonly transparent: boolean;
}

/**
 * Every draw of one frame, in the order three made them — #619 lever 1.
 * Empty for a view that is not this adapter's, or has no context.
 *
 * @test-facing read by `game-harness.ts` for the browser gate's draw-order
 * assertion; the product never needs to ask what order it drew in
 */
export function drawOrderOf(view: GameView, frame: SceneFrame): readonly DrawnPiece[] {
  return view instanceof ThreeGameView ? view.drawOrder(frame) : [];
}

/**
 * The fog's colour and the horizon ring's foot in the last frame, linear —
 * #544: they are one colour, so where a hill meets the fog there is no edge.
 * `NaN`s for a view that is not this adapter's.
 *
 * @test-facing read by `game-harness.ts` for the browser gate's foot-equals-fog
 * assertion; nothing in the render path needs to ask.
 */
export function horizonColoursOf(view: GameView): {
  readonly fog: readonly [number, number, number];
  readonly foot: readonly [number, number, number];
} {
  const none = [Number.NaN, Number.NaN, Number.NaN] as const;
  return view instanceof ThreeGameView ? view.horizonColours : { fog: none, foot: none };
}

/**
 * Whether a view's bridges wear the realistic world's photographed stone —
 * #501's review. `#applyWorld` hands `BridgeBelt.setWorld` the loaded stone,
 * and without it the bridge falls back to a plain material with every other
 * gate green; the browser gate reads this on a realistic rung.
 *
 * @unwired reached only from the browser gate's harness; nothing in the render
 * path needs to ask.
 */
export function bridgesWearStoneOf(view: GameView): boolean {
  return view instanceof ThreeGameView && view.bridgesWearStone;
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
  // #545: `camera.ts`' near plane, which `near-field.test.ts` rides the
  // fixture routes against.
  readonly #camera = new PerspectiveCamera(
    CAMERA_FIELD_OF_VIEW_DEGREES,
    1,
    NEAR_PLANE_METRES,
    2_000,
  );
  /** Whether the near-plane cull is on. @see nearFieldOf */
  #clearOfTheCamera = true;
  /** Whether the realistic world's ground blobs are drawn. @see showGroundBlobsOf */
  #groundBlobsShown = true;
  /** Whether the mapped buildings are grounded — #1657. @see mappedBlobsShownOf */
  #mappedBlobsShown = true;
  /** Whether the villages' houses are drawn as #1585's models — #1566. @see villageModelsShownOf */
  #villageModelsShown = true;
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
   * #783's browser-gate controls, and nothing the product sets: every remote
   * rider in a mesh of its own, or the realistic world's rule for them off.
   * @see remoteRiderControlOf
   */
  #remoteControl: RemoteRiderControl = 'none';
  /** The belts the `'each-own-mesh'` control draws remote riders in, one each. */
  readonly #ownMeshes: RiderBelt[] = [];
  /**
   * The kit the rider chose, as {@link riderKitFor} answered for it — #623.
   * Held here as well as on the belts because the realistic belt is built
   * later, when a world has loaded, and must be dressed then too.
   */
  #riderKit: RiderKit = RIDER_KITS.rider;
  /** What {@link setSeason} was last told. #1623 to #1627 draw from it. */
  #season: Season = NO_SEASON;
  /** What each holiday decorates with — #1624: the product's, or the owner's page's probe. @see decorationKindsOf */
  #decorationKinds: ItemTable = HOLIDAY_DECORATIONS;
  /** Which surfaces' shaders the realistic road and ground are built with. @see realisticSurfacesOf */
  #surfaces: RealisticSurfaces = REALISTIC_SURFACES_DRAWN;
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
   * Whether the realistic world grounds its riders with the silhouette —
   * #626. Only the browser gate's control turns it off, to draw the round
   * blob it replaced. @see riderSilhouettesOf
   */
  #silhouetteShadows = true;
  /**
   * The world, as three objects built once and mutated thereafter — #240's
   * NFR-3. Every one of them is a fixed instance: the sky is the `Color` the
   * scene's background *is*, the fog is the `FogExp2` the scene holds, and the
   * ground is one `Mesh` that follows the camera. `#updateWorld` sets numbers
   * on these and never replaces them.
   */
  readonly #sky = new Color(UNSET_COLOUR);
  readonly #fog = new FogExp2(UNSET_COLOUR, 0);
  /**
   * What the far end of the world converges on this frame — the fog's colour
   * and the horizon ring's (#544). @see #updateWorld
   */
  readonly #horizonColour = new Color(UNSET_COLOUR);
  /**
   * Whether a realistic frame's horizon is the photographed sky's — the
   * product's only setting; `false` is the browser gate's control. @see horizonFromSkyOf
   */
  #horizonFromSky = true;
  /** Whether this frame's horizon is the photographed sky's. Set by `#updateWorld`. */
  #horizonIsSky = false;
  /**
   * #622: whether the fog leans towards the sky's own colour in each direction
   * or towards one mean for all of them — the product's only setting is
   * `'directional'`; `'flattened'` is the browser gate's control. @see atmosphereOf
   */
  #airTable: 'directional' | 'flattened' = 'directional';
  /** #622: whether the valley haze is on — always, but for the browser gate's control. */
  #valleyHaze = true;
  /** #622: this frame's air, linear, for the horizon ring; `undefined` off the realistic sky. */
  #air: RealisticAir | undefined;
  /** #622: the table {@link #airOutput} was last converted from, and at what intensity. */
  #airFrom: { readonly table: readonly LinearColour[]; readonly intensity: number } | undefined;
  /** #622: the last table {@link #airFor} worked out, linear and drawn. */
  #airLinear: readonly LinearColour[] = [];
  /** #622: this frame's table in the output colour space, as the shader reads it. @see ATMOSPHERE */
  readonly #airOutput = new Float32Array(HORIZON_AZIMUTH_BINS * 3);
  /** #622: the middle of this route's elevation, local metres. @see HorizonRelief.middle */
  #valleyMiddle = 0;
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
   * The stylised world's start and finish gantries, unlettered — #966. The
   * realistic world draws its own, lettered ({@link RealisticDrawing}).
   */
  readonly #gantries = new GantryBelt(undefined, 'stylised');
  /**
   * The stylised world's wordmark boards — #966, wearing the precached PNG
   * {@link loadGameWordmark} loaded before this view was built.
   */
  readonly #logos = new LogoBelt(gameWordmark, 'stylised');
  /** The stylised world's village pavements — #1535. The realistic world draws its own. */
  readonly #pavements = new PavementBelt('stylised');
  /** The stylised world's street furniture — #1536. The realistic world draws its own. */
  readonly #furniture = new FurnitureBelt('stylised');
  /** The stylised world's holiday decorations — #1624. The realistic world draws its own. */
  readonly #decorations = new DecorationBelt('stylised');
  /** The cross streets — #1565: ONE belt for both worlds, in whatever the road wears. */
  readonly #sideRoads: SideRoadBelt;
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
    snow: { bareColour: UNSET_COLOUR, aboveSnowMetres: 0, winterLoweringMetres: 0 },
  };
  #widthCssPixels = 1;
  #heightCssPixels = 1;
  /** Whether {@link destroy} has run, so a {@link prepare} still in flight draws nothing after it. */
  #destroyed = false;
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
    // #1565: the side roads, in the road's own material.
    this.#sideRoads = new SideRoadBelt(this.#roadMaterial);
    this.#sideRoads.addTo(this.#scene);

    this.#scatter.addTo(this.#scene);
    // #966: the start gate and the billboards, in the stylised world.
    this.#gantries.addTo(this.#scene);
    this.#logos.addTo(this.#scene);
    // #1535: the village pavements, in the stylised world.
    this.#pavements.addTo(this.#scene);
    // #1536: what stands on them.
    this.#furniture.addTo(this.#scene);
    // #1624: and the holiday's decorations.
    this.#decorations.addTo(this.#scene);

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
    this.#stage(frame);
    // #619 lever 2: this view's rung, written into the one uniform every
    // textured realistic material reads — here, because several views share
    // those materials. @see REALISTIC_TEXTURE_LOD_BIAS
    REALISTIC_TEXTURE_LOD_BIAS.value =
      this.#drawing === 'realistic' ? this.#quality.textureLodBias : 0;
    // #622, for the same reason. Only the realistic world's materials read
    // these, so a stylised frame has nothing to write.
    if (this.#drawing === 'realistic') {
      // #630: the ride's clock for the breeze, and the world's sun for the far band.
      FOLIAGE.oylWindTime.value = frame.water.seconds;
      // #1623: this view's season, for the reason the breeze's clock is written here.
      SEASON.oylAutumn.value = this.#season.nature.autumn;
      SEASON.oylWreath.value = wreathOf(this.#season);
      FOLIAGE.oylSunToward.value
        .set(frame.world.sun.x, frame.world.sun.y, frame.world.sun.z)
        .normalize();
      FOLIAGE.oylSunAmbient.value = frame.world.sun.ambient;
      FOLIAGE.oylSunDirect.value = frame.world.sun.direct;
      ATMOSPHERE.oylFogTable.value.set(this.#airOutput);
      ATMOSPHERE.oylFogShare.value = this.#air?.share ?? 0;
      ATMOSPHERE.oylSkyTurn.value = this.#air?.turn ?? 0;
      ATMOSPHERE.oylValleyMiddle.value = this.#valleyMiddle;
      ATMOSPHERE.oylValleyHaze.value = this.#valleyHaze ? REALISTIC_VALLEY_HAZE : 1;
    }
    this.#renderer.render(this.#scene, this.#camera);
  }

  /** Everything {@link render} does to the scene before it draws it. */
  #stage(frame: SceneFrame): void {
    this.#updateWorld(frame.world);
    this.#world = frame.world;
    // Worked out once a frame: the horizon, the near-plane cull and the camera
    // all read it.
    const rig = cameraRig(frame.camera);
    // #1623: in the realistic world, the ground under the route's own winter,
    // and the roofs' snow from the same cover. The stylised world draws no season.
    const winter = this.#drawing === 'realistic' ? this.#season.nature.winter : 0;
    SEASON.oylRoofSnow.value = roofSnowIn(frame.world, winter);
    this.#terrain.update(
      frame.terrain.mesh,
      winter === 0 ? frame.world.groundColour : groundColourIn(frame.world, winter),
    );
    this.#horizon.update(
      frame.terrain.horizon,
      frame.world,
      frame.camera,
      this.#horizonColour,
      // #544: in the realistic world no crest stands below the photograph's
      // own skyline, or the photographed field is drawn above the hills.
      this.#horizonIsSky
        ? skylineCrestFloor(rig.eye.y, HORIZON_RADIUS_METRES)
        : Number.NEGATIVE_INFINITY,
      this.#horizonIsSky ? REALISTIC_HORIZON_HAZE_SHARE : HORIZON_HAZE_SHARE,
      // #622: and its foot leans towards the sky in each direction as the fog does.
      this.#air,
    );
    this.#valleyMiddle = frame.terrain.horizon.middle;
    // #629: the realistic water reflects the scene's environment, turned as
    // the scene turns it (`#updateWorld`, which has run above).
    this.#water.setEnvironmentTurn(this.#scene.environmentRotation.y);
    this.#water.update(
      frame.water.surface,
      frame.world,
      frame.water.seconds,
      // #475: on the realistic rungs the water reflects the realistic sky.
      this.#drawing === 'realistic' ? realisticWorld?.sky : undefined,
    );
    this.#bridges.update(frame.water.bridges);
    this.#updateRoad(frame);
    // #1565: the cross streets, in whatever the road wears this frame.
    this.#sideRoads.setMaterial(this.#road.material as Material);
    this.#sideRoads.update(frame.sideRoads);
    // ⚠️ Both worlds' belts are handed the frame, and the hidden world's
    // return at once (ADR 0026 D-3): one frame, one arrangement, whichever
    // world draws it — so the two can never disagree about where a tree is.
    //
    // #545: and neither is handed an item the near plane would cut, for THIS
    // frame's aspect and THIS world's shapes. `near-field.ts` says what that is,
    // and why it asks the triangles rather than a box.
    const scenery = this.#clearOfTheCamera
      ? clearOfTheCamera(
          frame.scatter,
          rig,
          this.#camera.aspect,
          this.#drawing,
          nearFieldShapes(this.#drawing),
          // #630: the realistic foliage sways, so it is cleared by its sway too.
          this.#drawing === 'realistic' ? FOLIAGE_SWAY_METRES : 0,
        )
      : frame.scatter;
    this.#scatter.update(scenery, frame.camera);
    // #1549: the buildings from map data, refilled only at a chunk — before
    // the structures, whose share of the rung it may change.
    this.#realistic?.updateMapped(frame.mappedBuildings, frame.scatter, frame.billboards.length);
    this.#realistic?.updateScenery(scenery, frame.camera);
    this.#realistic?.groundScenery(
      scenery,
      frame.camera,
      frame.corridor,
      frame.terrain.mesh,
      frame.world.sun,
    );
    // #783: a realistic frame draws the nearest remote riders realistically,
    // the next few stylised, and no more. @see realisticRemoteSplit
    const realisticFrame = this.#drawing === 'realistic';
    const split =
      realisticFrame && this.#remoteControl !== 'no-realistic-rule'
        ? realisticRemoteSplit(frame.markers)
        : undefined;
    this.#realistic?.riders.place(split?.realistic ?? frame.markers);
    // #679: the gantries at the lines in reach, and none anywhere else —
    // and since #966 in both worlds, each drawing its own, with the wordmark
    // on the start gate and the billboards. The hidden world's draw nothing.
    this.#realistic?.gantries.update(frame.lines);
    this.#realistic?.logos.update(frame.lines, frame.billboards);
    this.#gantries.update(frame.lines);
    this.#logos.update(frame.lines, frame.billboards);
    // #1535: the village streets, in both worlds; the hidden world's draw nothing.
    this.#realistic?.pavements.update(frame.streets);
    this.#pavements.update(frame.streets);
    // #1536: and what stands on them, within reach of the camera.
    this.#realistic?.furniture.update(frame.streets, frame.camera);
    this.#furniture.update(frame.streets, frame.camera);
    // #1624: the holiday's decorations on the villages in reach, in ONE call;
    // none with no holiday. The hidden world's draw nothing.
    const holiday = this.#season.holiday;
    this.#realistic?.decorations.update(
      frame.streets,
      frame.camera,
      holiday,
      this.#decorationKinds,
    );
    this.#decorations.update(frame.streets, frame.camera, holiday, this.#decorationKinds);
    // #1541: and who walks them, in the realistic world only.
    this.#realistic?.people.update(frame.people);
    this.#updateMarkers(
      split?.stylised ??
        (realisticFrame
          ? frame.markers.filter((marker) => marker.kind === 'remote')
          : frame.markers),
    );
    this.#updateShadows(frame);
    this.#placeCamera(rig);
  }

  /**
   * The ride's first frame, drawn into ONE pixel before any frame is shown —
   * #547. @see GameView.prepare
   *
   * Three steps, because a first frame pays in three places:
   *
   * 1. **The scene is staged from the frame**, synchronously — exactly what
   *    {@link render} does before it draws, so every belt holds the rider, the
   *    pacer, the ground and the scenery the ride starts with. Synchronous
   *    because the frame's arrays are LENT (`landform.ts` §`TerrainMesh.lease`):
   *    the next frame the host builds writes over them.
   * 2. **`compile`** over the whole scene, hidden objects included, under
   *    the rung's lights and with `shadowMap.enabled` as the rung left it, so
   *    the program keys match what `render` will look up. With
   *    `KHR_parallel_shader_compile` the links run off the main thread and
   *    {@link programsLinked} polls for them — until they link, the view is
   *    destroyed, the context is lost, or {@link PREPARE_FENCE_LIMIT_MS}.
   * 3. **One render with the scissor at a single pixel, then a fence.** The
   *    draw is what the other two cannot reach: the depth programs the riders
   *    are cast into the map with, which three makes only inside
   *    `WebGLShadowMap.render`; every buffer's first upload; and whatever a
   *    driver does on a program's first DRAW rather than its link. The scissor
   *    keeps the picture to one pixel. The fence is polled, never waited on,
   *    so the main thread stays free until the GPU has finished; it is given
   *    up on after {@link PREPARE_FENCE_LIMIT_MS}.
   *
   * ⚠️ **Step 1 is not optional, measured.** A `prepare` that built every
   * program and drew the scene WITHOUT the ride's first frame in it — no
   * rider, no ground, no scenery placed — linked everything and left about
   * 600 ms of a 610 ms first frame where it was, in the pinned Chromium: most
   * of a first frame is its data's first upload, not its programs. Dropping
   * the fence is the same size of failure (≈ 560 ms): the warm-up is still on
   * the GPU when the first shown frame queues behind it.
   *
   * ⚠️ **What the pinned Chromium cannot tell apart**, stated: a scissor of
   * NOTHING warms it just as well as one pixel does (a driver may skip a draw
   * that covers no pixel, which is why it is one), and SwiftShader offers no
   * `KHR_parallel_shader_compile`, so dropping {@link programsLinked} leaves the gate
   * green — the programs are then linked, blocking, inside the warm-up render.
   * What {@link programsLinked} buys is a main thread that keeps running while a
   * phone links them, and only the tablet can show it.
   *
   * ⚠️ **It warms the CURRENT rung only.** A step down later — `surfaceDetail`
   * goes, and on the map rung `shadowMap.enabled` goes with it — still builds
   * programs on the frame it happens, once a ride, as before #547; and the
   * realistic world's are built when it is drawn.
   */
  async prepare(frame: SceneFrame): Promise<void> {
    const renderer = this.#renderer;
    if (renderer === undefined) {
      return;
    }
    try {
      this.#stage(frame);
      // Not `compileAsync`: its own poll can neither be stopped nor survive the
      // view going away. @see programsLinked
      renderer.compile(this.#scene, this.#camera);
      await programsLinked(
        renderer.getContext(),
        () => renderer.info.programs ?? [],
        () => this.#destroyed,
      );
      if (this.#destroyed) {
        return;
      }
      renderer.setScissorTest(true);
      renderer.setScissor(0, 0, 1, 1);
      try {
        renderer.render(this.#scene, this.#camera);
      } finally {
        renderer.setScissorTest(false);
      }
      await gpuFinished(renderer.getContext());
    } catch {
      // The first frame builds what it needs, as every first frame did before
      // #547. A context lost mid-warm-up is the ordinary way here.
    }
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
    this.#realistic?.setBudget(
      settings.scatterItems + settings.structureItems,
      settings.structureItems,
    );
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
    // #626: after the world, because which contact shadow is drawn depends on it.
    this.#applyContactShadows();
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
        this.#realistic = new RealisticDrawing(
          loaded,
          this.#renderer.capabilities.getMaxAnisotropy(),
          prefilteredSky(this.#renderer, loaded.sky.texture),
          this.#terrain.fields,
          this.#riderKit,
          this.#surfaces,
        );
        this.#realistic.addTo(this.#scene);
        this.#realistic.mappedBlobsShown(this.#mappedBlobsShown);
        this.#realistic.villageHouses.switchOn(this.#villageModelsShown);
        this.#realistic.setBudget(
          this.#quality.scatterItems + this.#quality.structureItems,
          this.#quality.structureItems,
        );
      }
    }
    const drawing = realistic ? this.#realistic : undefined;
    this.#scatter.setShown(!realistic);
    // #966: the stylised gate and boards, in the stylised world only.
    this.#gantries.setShown(!realistic);
    this.#logos.setShown(!realistic);
    this.#pavements.setShown(!realistic);
    this.#furniture.setShown(!realistic);
    this.#decorations.setShown(!realistic);
    // #783: shown in both worlds — in the realistic one it draws only the
    // remote riders `realisticRemoteSplit` hands it, and nothing on a frame
    // with none. @see #updateMarkers
    this.#riders.setShown(true);
    this.#skyDome.mesh.visible = !realistic;
    this.#realistic?.setShown(realistic);
    this.#realistic?.grounding.setShown(realistic && this.#groundBlobsShown);
    this.#road.material = drawing?.road ?? this.#roadMaterial;
    this.#terrain.setPhotographic(drawing?.ground);
    this.#bridges.setWorld(world, realistic ? loaded?.structures.get('stone') : undefined);
    this.#scene.background =
      drawing === undefined || loaded === undefined ? this.#sky : loaded.sky.texture;
    this.#scene.environment = drawing?.environment ?? null;
    this.#water.setEnvironment(drawing?.environment);
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

  /** The realistic rider's shoulders in the last frame. @see realisticShouldersOf */
  realisticShoulders(): { x: number; y: number; z: number } | undefined {
    const into = { x: 0, y: 0, z: 0 };
    return this.#realistic?.riders.shouldersOf(into) === true ? into : undefined;
  }

  /** Where the realistic vegetation the last frame drew stands. @see realisticVegetationPlacesOf */
  realisticVegetationPlaces(): readonly { readonly kind: string; x: number; z: number }[] {
    return this.#realistic?.vegetation.places() ?? [];
  }

  /** How many scenery items the last frame drew, in the world it drew. @see sceneryDrawnOf */
  get sceneryDrawn(): number {
    return this.#realistic?.sceneryDrawn ?? this.#scatter.drawnItems;
  }

  /** Which world the last rung this view was given is drawn in. @see drawnWorldOf */
  get drawnWorld(): QualitySettings['world'] {
    return this.#drawing;
  }

  /** @see horizonFromSkyOf */
  horizonFromSky(on: boolean): void {
    this.#horizonFromSky = on;
  }

  /** @see bicycleTreadOf */
  bicycleTread(on: boolean): void {
    this.#realistic?.riders.setTread(on);
  }

  /**
   * The rider's own kit colour — #623. @see GameView.setRiderKit
   *
   * ⚠️ **Through {@link riderKitFor}, whatever the type says**: the value came
   * off an athlete row, and anything that is not a palette key is drawn as the
   * house kit rather than handed to a shader.
   */
  setRiderKit(chosen: KitColour | undefined): void {
    const kit = riderKitFor(chosen);
    this.#riderKit = kit;
    this.#riders.setRiderKit(kit);
    this.#realistic?.riders.setRiderKit(kit);
  }

  /**
   * The ride's season — #1622. Held; since #1623 the realistic broadleaves
   * turn by its autumn from here on, and the ground and the roofs take its
   * winter on the next frame (`#stage`). @see GameView.setSeason
   */
  setSeason(season: Season): void {
    this.#season = season;
    SEASON.oylAutumn.value = season.nature.autumn;
    // #1626: the mapped doors' wreath, while the winter lights are on.
    SEASON.oylWreath.value = wreathOf(season);
  }

  /** @see seasonOf */
  get season(): Season {
    return this.#season;
  }

  /** @see riderKitsOf */
  get riderKits(): { readonly held: RiderKit; readonly stylised: RiderKit } {
    return { held: this.#riderKit, stylised: this.#riders.riderKit };
  }

  /** @see riderKitOf */
  riderKit(on: boolean): void {
    this.#realistic?.riders.setKitPattern(on);
  }

  /** @see atmosphereOf */
  atmosphere(air: { readonly table: 'directional' | 'flattened'; readonly valley: boolean }): void {
    this.#airTable = air.table;
    this.#valleyHaze = air.valley;
  }

  /** @see airOf */
  get airReading(): AirReading {
    const output = { r: 0, g: 0, b: 0 };
    this.#fog.color.getRGB(output, this.#renderer?.outputColorSpace ?? SRGBColorSpace);
    return {
      base: [output.r, output.g, output.b],
      table: Array.from(ATMOSPHERE.oylFogTable.value),
      share: ATMOSPHERE.oylFogShare.value,
      turn: ATMOSPHERE.oylSkyTurn.value,
      density: this.#fog.density,
      valleyMiddle: ATMOSPHERE.oylValleyMiddle.value,
      valleyHaze: ATMOSPHERE.oylValleyHaze.value,
    };
  }

  /** @see horizonColoursOf */
  get horizonColours(): {
    readonly fog: readonly [number, number, number];
    readonly foot: readonly [number, number, number];
  } {
    const fog = this.#fog.color;
    return { fog: [fog.r, fog.g, fog.b], foot: this.#horizon.foot };
  }

  /** @see nearFieldOf */
  nearField(nearMetres: number, clear: boolean): void {
    this.#camera.near = nearMetres;
    this.#camera.updateProjectionMatrix();
    this.#clearOfTheCamera = clear;
  }

  /** @see showGroundBlobsOf */
  showGroundBlobs(on: boolean): void {
    this.#groundBlobsShown = on;
    this.#realistic?.grounding.setShown(on && this.#drawing === 'realistic');
  }

  /** @see terrainPositionsOf */
  get terrainMesh(): Mesh {
    return this.#terrain.mesh;
  }

  /** @see groundBlobsOf */
  get groundBlobMesh(): InstancedMesh | undefined {
    return this.#realistic?.grounding.mesh;
  }

  /** @see groundBlendOf */
  groundBlend(verge: number, rock: number, scree: number, crag: number): void {
    const shares =
      this.#realistic === undefined ? undefined : GROUND_BLEND_SHARES.get(this.#realistic.ground);
    shares?.set(verge, rock, scree, crag);
  }

  /** @see gantriesShownOf */
  gantriesShown(on: boolean): void {
    this.#realistic?.gantries.switchOn(on);
    this.#gantries.switchOn(on);
  }

  /** @see gantryMeshesOf — the drawn world's. */
  get gantryMeshes():
    { readonly boxes: InstancedMesh; readonly banners: InstancedMesh } | undefined {
    return this.#drawing === 'realistic' ? this.#realistic?.gantries.meshes : this.#gantries.meshes;
  }

  /** @see logosShownOf */
  logosShown(on: boolean): void {
    this.#realistic?.logos.switchOn(on);
    this.#logos.switchOn(on);
  }

  /** @see wordmarkOrientationOf */
  wordmarkOrientation(orientation: WordmarkOrientation): void {
    this.#realistic?.logos.orientWordmark(orientation);
    this.#logos.orientWordmark(orientation);
  }

  /** @see logoBoardsOf — the drawn world's. */
  get logoMesh(): InstancedMesh | undefined {
    return this.#drawing === 'realistic' ? this.#realistic?.logos.mesh : this.#logos.mesh;
  }

  /** @see mappedBuildingsShownOf */
  mappedBuildingsShown(on: boolean): void {
    this.#realistic?.mappedShown(on);
  }

  /** @see mappedBlobsShownOf */
  mappedBlobsShown(on: boolean): void {
    this.#mappedBlobsShown = on;
    this.#realistic?.mappedBlobsShown(on);
  }

  /** @see mappedBuildingStatsOf */
  get mappedBuildings(): MappedBuildingBelt | undefined {
    return this.#realistic?.mapped;
  }

  /** @see villageModelsShownOf */
  villageModelsShown(on: boolean): void {
    this.#villageModelsShown = on;
    this.#realistic?.villageHouses.switchOn(on);
  }

  /** @see villageHouseStatsOf */
  get villageHouses(): VillageHouseStats | undefined {
    return this.#realistic?.villageHouses.stats;
  }

  /** @see pavementsShownOf */
  pavementsShown(on: boolean): void {
    this.#realistic?.pavements.switchOn(on);
    this.#pavements.switchOn(on);
  }

  /** @see peopleShownOf */
  peopleShown(on: boolean): void {
    this.#realistic?.people.switchOn(on);
  }

  /** @see peopleDrawnOf — the realistic world's, whether or not it is the one drawn. */
  get people(): PeopleBelt | undefined {
    return this.#realistic?.people;
  }

  /** @see peopleBodyFragmentsOf */
  peopleBodyFragments(): string[] {
    const renderer = this.#renderer;
    if (renderer === undefined) return [];
    const gl = renderer.getContext();
    // The bodies' programs, by `peopleBodyMaterial`'s key; the impostors' is `oyl-people-far`.
    return (renderer.info.programs ?? [])
      .filter((program) => /oyl-people-\d/.test(program.cacheKey))
      .flatMap((program) => gl.getAttachedShaders(program.program as WebGLProgram) ?? [])
      .filter((shader) => gl.getShaderParameter(shader, gl.SHADER_TYPE) === gl.FRAGMENT_SHADER)
      .map((shader) => gl.getShaderSource(shader) ?? '');
  }

  /** @see doorPathsShownOf */
  doorPathsShown(on: boolean): void {
    this.#realistic?.pavements.switchPathsOn(on);
    this.#pavements.switchPathsOn(on);
  }

  /** @see pavementTrianglesOf — the drawn world's. */
  get pavementMesh(): Mesh | undefined {
    return this.#drawing === 'realistic' ? this.#realistic?.pavements.mesh : this.#pavements.mesh;
  }

  /** @see sideRoadsShownOf */
  sideRoadsShown(on: boolean): void {
    this.#sideRoads.switchOn(on);
  }

  /** @see sideRoadMeshOf */
  get sideRoadMesh(): Mesh {
    return this.#sideRoads.mesh;
  }

  /** The road's mesh, for {@link sideRoadMeshOf}'s caller to compare materials. */
  get roadMesh(): Mesh {
    return this.#road;
  }

  /** @see furnitureShownOf */
  furnitureShown(on: boolean): void {
    this.#realistic?.furniture.switchOn(on);
    this.#furniture.switchOn(on);
  }

  /** @see furnitureCountsOf — the drawn world's. */
  get furnitureBelt(): FurnitureBelt | undefined {
    return this.#drawing === 'realistic' ? this.#realistic?.furniture : this.#furniture;
  }

  /** @see decorationBeltOf — the drawn world's. */
  get decorationBelt(): DecorationBelt | undefined {
    return this.#drawing === 'realistic' ? this.#realistic?.decorations : this.#decorations;
  }

  /** @see decorationKindsOf */
  set decorationKinds(kinds: ItemTable) {
    this.#decorationKinds = kinds;
  }

  /** @see realisticSurfacesOf */
  realisticSurfaces(surfaces: RealisticSurfaces): void {
    this.#surfaces = surfaces;
    const drawing = this.#realistic;
    if (drawing === undefined) return;
    drawing.setSurfaces(surfaces);
    if (this.#drawing === 'realistic') {
      this.#road.material = drawing.road;
      this.#terrain.setPhotographic(drawing.ground);
    }
  }

  /** @see windowRevealsOf, overhangShadowsOf — every facade material in the scene, compiled again. */
  facadesRecompiled(): void {
    this.#scene.traverse((node) => {
      const { material } = node as { material?: Material | Material[] };
      for (const each of Array.isArray(material)
        ? material
        : material === undefined
          ? []
          : [material]) {
        if (!drawsFacade(each)) continue;
        defineFacadeLevers(each);
        each.needsUpdate = true;
      }
    });
  }

  /** @see realisticSurfaceUniformsOf */
  realisticSurfaceUniforms(): { readonly road: string[]; readonly ground: string[] } | undefined {
    const renderer = this.#renderer;
    const drawing = this.#realistic;
    if (renderer === undefined || drawing === undefined) return undefined;
    const gl = renderer.getContext();
    const uniformsOf = (material: Material): string[] => {
      const { currentProgram } = renderer.properties.get(material) as {
        currentProgram?: { readonly program: WebGLProgram };
      };
      if (currentProgram === undefined) return [];
      const count = gl.getProgramParameter(currentProgram.program, gl.ACTIVE_UNIFORMS) as number;
      const names: string[] = [];
      for (let index = 0; index < count; index += 1) {
        const name = gl.getActiveUniform(currentProgram.program, index)?.name;
        if (name !== undefined) names.push(name);
      }
      return names.sort();
    };
    return { road: uniformsOf(drawing.road), ground: uniformsOf(drawing.ground) };
  }

  /** @see roadWearOf */
  roadWear(on: boolean | 'surface'): void {
    const wear = this.#realistic === undefined ? undefined : ROAD_WEAR.get(this.#realistic.road);
    if (wear === undefined) return;
    wear.on = on === false ? 0 : 1;
    wear.colour = on === true ? 1 : 0;
  }

  /** @see waterFresnelOf */
  waterFresnel(held: number | undefined): void {
    this.#water.holdFresnel(held);
  }

  /** @see waterReflectsOf */
  get waterReflects(): boolean {
    return this.#water.reflects;
  }

  /** @see filterWaterRipplesOf */
  filterWaterRipples(on: boolean): void {
    this.#water.setRippleFilter(on);
  }

  /** @see bridgesWearStoneOf */
  get bridgesWearStone(): boolean {
    return this.#bridges.wearsStone;
  }

  /** The sky the water reflected in the last frame. @see waterSkyOf */
  get waterSky(): readonly [number, number, number] {
    return this.#water.reflectedSky;
  }

  /** @see foliageOrderedOf */
  foliageOrdered(on: boolean): void {
    this.#realistic?.vegetation.setFoliageOrdered(on);
  }

  /** @see firDepthPrepassOf */
  firDepthPrepass(mode: DepthPrepassMode): void {
    this.#realistic?.vegetation.setDepthPrepass(mode);
  }

  /**
   * Renders one frame with every mesh's `onBeforeRender` noting it, then puts
   * each hook back. Shadow passes call `onBeforeShadow` instead, so what is
   * noted is the colour pass alone. @see drawOrderOf
   */
  drawOrder(frame: SceneFrame): readonly DrawnPiece[] {
    if (this.#renderer === undefined) return [];
    const drawn: DrawnPiece[] = [];
    const restores: (() => void)[] = [];
    this.#scene.traverse((node) => {
      const mesh = node as Partial<Mesh>;
      if (mesh.isMesh !== true || mesh.material === undefined) return;
      const material: Material | undefined = Array.isArray(mesh.material)
        ? mesh.material[0]
        : mesh.material;
      if (material === undefined) return;
      // Put back exactly as found: an own hook, or none over the prototype's.
      const own = Object.hasOwn(node, 'onBeforeRender');
      // eslint-disable-next-line @typescript-eslint/unbound-method -- restored onto its own object below
      const original = node.onBeforeRender;
      const previous = original.bind(node);
      const piece: DrawnPiece = {
        cut:
          material.alphaTest > 0 ||
          (material as Partial<ShaderMaterial>).uniforms?.['strip'] !== undefined,
        transparent: material.transparent,
      };
      node.onBeforeRender = (...args) => {
        drawn.push(piece);
        previous(...args);
      };
      restores.push(() => {
        if (own) node.onBeforeRender = original;
        else delete (node as Partial<Object3D>).onBeforeRender;
      });
    });
    try {
      this.render(frame);
    } finally {
      for (const restore of restores) restore();
    }
    return drawn;
  }

  /** Uploads one texture to this view's GPU now. @see uploadRealisticTexturesOf */
  initTexture(texture: Texture): void {
    this.#renderer?.initTexture(texture);
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
        found.push({
          visible,
          type: material.type,
          constructed: isConstructedMaterial(material),
          fogged: (material as Partial<MeshBasicMaterial>).fog === true,
          atmospheric: breathesTheAir(material),
          shared:
            this.#water.wears(material) ||
            this.#contactShadows.wears(material) ||
            this.#realistic?.shadows.wears(material) === true,
        });
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
    this.#gantries.setShading(shading);
    this.#logos.setShading(shading);
    this.#pavements.setShading(shading);
    this.#furniture.setShading(shading);
    this.#decorations.setShading(shading);
  }

  /**
   * The rung's way of grounding the riders — #426. @see QualitySettings.riderShadows
   *
   * ⚠️ **`shadowMap.enabled` is renderer state that three bakes into every lit
   * material's program**, so turning it on or off after the first frame needs
   * those programs rebuilt — the rider's two materials and the catcher. Done
   * only when the value CHANGES. The map is turned on at most once a ride and
   * off at most once: the map rung is above the ladder and a stylised ride
   * starts on it (#547), where `prepare` has already drawn it once; the
   * first step down leaves it, and `quality.ts` §`keepsShadowMap` is the latch that stops a
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
    this.#applyContactShadows();
  }

  /**
   * Which of the two contact shadows a `'contact'` rung draws — #626: the
   * realistic riders' bike-shaped silhouette in the realistic world, the round
   * blob in the stylised one. Never both, and neither on a `'map'` or
   * `'none'` rung.
   */
  #applyContactShadows(): void {
    const contact = this.#riderShadows === 'contact';
    const silhouette = this.#drawing === 'realistic' && this.#silhouetteShadows;
    this.#contactShadows.setShown(contact && !silhouette);
    this.#realistic?.shadows.setShown(contact && silhouette);
  }

  /** @see riderSilhouettesOf */
  showRiderSilhouettes(on: boolean): void {
    this.#silhouetteShadows = on;
    this.#applyContactShadows();
  }

  /** @see riderSilhouetteDarknessOf */
  setRiderSilhouetteDarkness(darkness: number): void {
    this.#realistic?.shadows.setDarkness(darkness);
  }

  /** The realistic riders' silhouette, while a realistic world is drawn. @see realisticSilhouetteOf */
  get realisticSilhouette(): RiderSilhouette | undefined {
    return this.#realistic?.silhouette;
  }

  /** @see realisticRidersShownOf */
  showRealisticRiders(on: boolean): void {
    this.#realistic?.riders.setShown(on);
  }

  /** Where this frame's shadows fall — #426. */
  #updateShadows(frame: SceneFrame): void {
    this.#contactShadows.place(frame.markers, frame.world.sun);
    this.#realistic?.shadows.place(frame.markers, frame.world.sun);
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
    this.#destroyed = true;
    this.#realistic?.dispose();
    this.#roadGeometry.dispose();
    this.#terrain.dispose();
    this.#horizon.dispose();
    this.#skyDome.dispose();
    this.#water.dispose();
    this.#bridges.dispose();
    this.#roadMaterial.dispose();
    this.#scatter.dispose();
    this.#gantries.dispose();
    this.#logos.dispose();
    this.#pavements.dispose();
    this.#furniture.dispose();
    this.#decorations.dispose();
    this.#sideRoads.dispose();
    this.#lighting.dispose();
    this.#riders.dispose();
    for (const belt of this.#ownMeshes) belt.dispose();
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
   * The realistic sky's air for a frame — #622: the horizon table as DRAWN
   * (times the background's `intensity`) for the ring, and the same in the
   * output colour space for the shader. The conversion is three's own
   * (`Color.getRGB`, as `WebGLMaterials.js` hands `fogColor` over), so a flat
   * table is the `fogColor` it is blended from. Converted only when the table
   * or the intensity changes, which on a ride is once.
   *
   * ⚠️ Converted with `outputColorSpace` UNCONDITIONALLY, where three picks the
   * fog's space by the bound render target — the same only while none is bound
   * when a realistic fogged material draws. See {@link ATMOSPHERE} before
   * adding one (#629, #701).
   */
  #airFor(sky: RealisticSky, intensity: number, turn: number): RealisticAir {
    const source = this.#airTable === 'flattened' ? sky.flatDirections : sky.directions;
    if (this.#airFrom?.table !== source || this.#airFrom.intensity !== intensity) {
      this.#airFrom = { table: source, intensity };
      this.#airLinear = source.map((each) => drawnHorizonColour(each, intensity));
      const space = this.#renderer?.outputColorSpace ?? SRGBColorSpace;
      const output = { r: 0, g: 0, b: 0 };
      this.#airLinear.forEach((each, bin) => {
        AIR_SCRATCH.setRGB(each[0], each[1], each[2]).getRGB(output, space);
        this.#airOutput[bin * 3] = output.r;
        this.#airOutput[bin * 3 + 1] = output.g;
        this.#airOutput[bin * 3 + 2] = output.b;
      });
    }
    return { table: this.#airLinear, share: REALISTIC_FOG_DIRECTION_SHARE, turn };
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
    this.#horizonColour.setHex(world.horizonColour);
    this.#horizonIsSky = false;
    this.#air = undefined;
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
      // #544: the far end converges on the sky DRAWN behind it. The stylised
      // horizon is a pale haze the stylised sky dome is painted to meet; the
      // photographed sky is darker than it, and every fogged surface and the
      // whole horizon ring used to converge on the pale one — a white film in
      // front of a grey sky, with a hard edge wherever it met either.
      if (this.#horizonFromSky) {
        this.#horizonColour.setRGB(...drawnHorizonColour(loaded.sky.skyline, intensity));
        this.#horizonIsSky = true;
        this.#air = this.#airFor(loaded.sky, intensity, turn);
      }
    } else {
      this.#lighting.apply(world.sun);
    }
    this.#fog.color.copy(this.#horizonColour);
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
      // #628: how far across the road each vertex is, which only the
      // realistic road's wear reads. @see writeRoadAcross
      this.#roadGeometry.setAttribute(
        ROAD_ACROSS_ATTRIBUTE,
        new BufferAttribute(new Float32Array(this.#vertexCapacity / 3), 1),
      );
      // #1523: which patches can reach each vertex's triangles, which only the
      // bounded wear reads. @see writeRoadPatchReach
      this.#roadGeometry.setAttribute(
        ROAD_REACH_ATTRIBUTE,
        new BufferAttribute(new Float32Array(this.#vertexCapacity / 3), 1),
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
    // #628: the realistic road's wear — the across-position and the patches in
    // this corridor. Only while the realistic road is drawn: the stylised
    // material reads neither, and the stylised frame pays for neither.
    const wear = this.#realistic === undefined ? undefined : ROAD_WEAR.get(this.#realistic.road);
    if (this.#drawing === 'realistic' && wear !== undefined) {
      const across = this.#roadGeometry.getAttribute(ROAD_ACROSS_ATTRIBUTE) as BufferAttribute;
      writeRoadAcross(frame.corridor, across.array as Float32Array);
      across.needsUpdate = true;
      const patches = roadPatchUniforms(frame.corridor, wear.patches);
      if (wear.bounded) {
        const reach = this.#roadGeometry.getAttribute(ROAD_REACH_ATTRIBUTE) as BufferAttribute;
        writeRoadPatchReach(frame.corridor, wear.patches, patches, reach.array as Float32Array);
        reach.needsUpdate = true;
      }
    }
    // Draw only the triangles this frame actually has, so a shorter corridor
    // does not draw stale ones left in the buffer from a longer one.
    this.#roadGeometry.setDrawRange(0, indices.length);
  }

  #updateMarkers(markers: readonly RiderMarker[]): void {
    if (this.#remoteControl === 'each-own-mesh') {
      // #783's control: the shape a room would cost if each rider were a mesh.
      const remote = markers.filter((marker) => marker.kind === 'remote');
      this.#riders.place(markers.filter((marker) => marker.kind !== 'remote'));
      while (this.#ownMeshes.length < remote.length) {
        const belt = new RiderBelt();
        belt.addTo(this.#scene);
        this.#ownMeshes.push(belt);
      }
      this.#ownMeshes.forEach((belt, index) => {
        const one = remote[index];
        belt.place(one === undefined ? [] : [one]);
      });
      return;
    }
    for (const belt of this.#ownMeshes) belt.hide();
    // #368. One call for all three, and a frame that carries none draws none —
    // `RiderBelt.place` sets every mesh's count from what it was handed, so
    // there is no "hide the ones that went" pass left to forget. #783: and for
    // a room's riders, as more instances of the same four meshes.
    this.#riders.place(markers);
  }

  /** @see remoteRiderControlOf */
  setRemoteControl(control: RemoteRiderControl): void {
    this.#remoteControl = control;
  }

  /**
   * ⚠️ **Where the camera stands and looks is `camera.ts` §`cameraRig`'s, not
   * this method's** — #424. It used to be worked out here from `pose.y`, a
   * level gaze from behind the rider whatever the road did, and `cameraRig`
   * says what that does to a low camera on a hill. This applies the answer.
   */
  #placeCamera({ eye, target }: CameraRig): void {
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
 * How long {@link ThreeGameView.prepare} waits on each of its two waits — the
 * programs' links and the GPU finishing its warm-up draw — before it lets the
 * ride draw anyway: **10 s**. Part T's stall was about 5 s on the Pixel Tablet,
 * and a warm-up that outlived twice that is not one a rider should wait out
 * with no world.
 */
export const PREPARE_FENCE_LIMIT_MS = 10_000;

/** How often {@link gpuFinished} and {@link programsLinked} look again. */
const PREPARE_FENCE_POLL_MS = 16;

/**
 * Settles the first time `done` answers true, or after
 * {@link PREPARE_FENCE_LIMIT_MS} whatever it answers. Polled on a timer, never
 * waited on, so the main thread stays free.
 */
function settledWhen(done: () => boolean): Promise<void> {
  const started = performance.now();
  return new Promise((resolve) => {
    const look = (): void => {
      if (done() || performance.now() - started > PREPARE_FENCE_LIMIT_MS) {
        resolve();
        return;
      }
      setTimeout(look, PREPARE_FENCE_POLL_MS);
    };
    look();
  });
}

/**
 * Settles once every program three holds has finished linking — the half of
 * `compileAsync` {@link ThreeGameView.prepare} needs, without the half it
 * cannot have (#606's review).
 *
 * ⚠️ **Why not `renderer.compileAsync`**, read from three 0.185.1's source:
 * its poll looks up each material's `currentProgram` on a timer of its own, and
 * nothing can stop it. A view destroyed mid-poll disposes those materials, the
 * lookup answers `{}`, and `program.isReady()` throws a TypeError out of three's
 * `setTimeout` where no `catch` can reach it; a context lost mid-poll reads
 * `COMPLETION_STATUS_KHR` as `null` for ever, so it polls every 10 ms for the
 * rest of the visit. Either way the promise never settles, and the ride never
 * draws its world. This polls the same status and stops on all three: the
 * view gone (`stopped`), the context lost, and the limit.
 *
 * Settles at once where there is no `KHR_parallel_shader_compile` to poll —
 * the programs then link, blocking, inside the warm-up draw, exactly as they
 * do under `compileAsync` on such a device. A program whose GL object is gone
 * counts as linked: there is nothing left to wait for.
 */
export function programsLinked(
  gl: WebGLRenderingContext | WebGL2RenderingContext,
  programs: () => readonly { readonly program: unknown }[],
  stopped: () => boolean,
): Promise<void> {
  const parallel = gl.getExtension('KHR_parallel_shader_compile');
  if (parallel === null) {
    return Promise.resolve();
  }
  return settledWhen(
    () =>
      stopped() ||
      gl.isContextLost() ||
      programs().every(
        ({ program }) =>
          program === undefined ||
          gl.getProgramParameter(program as WebGLProgram, parallel.COMPLETION_STATUS_KHR) === true,
      ),
  );
}

/**
 * Settles once the GPU has finished every command issued so far — polled on a
 * fence, so the main thread is never blocked on it the way a `readPixels` or a
 * `finish` would block it. Settles at once where there is no fence to make
 * (a WebGL 1 context, a lost one), and after {@link PREPARE_FENCE_LIMIT_MS}
 * whatever the fence says.
 */
export function gpuFinished(gl: WebGLRenderingContext | WebGL2RenderingContext): Promise<void> {
  if (!('fenceSync' in gl) || gl.isContextLost()) {
    return Promise.resolve();
  }
  const fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
  if (fence === null) {
    return Promise.resolve();
  }
  gl.flush();
  return settledWhen(
    () => gl.isContextLost() || gl.getSyncParameter(fence, gl.SYNC_STATUS) === gl.SIGNALED,
  ).then(() => {
    if (!gl.isContextLost()) {
      gl.deleteSync(fence);
    }
  });
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
