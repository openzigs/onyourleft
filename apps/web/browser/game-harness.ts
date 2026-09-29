// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The page the game half of the browser gate drives.
 *
 * It imports the **real** adapter — `game/three-renderer.ts`, the one file that
 * names `three` — and feeds it a corridor built by the **real** `terrain.ts`
 * from a route profile built by the **real** `packages/domain`. Nothing here is
 * a stand-in, for the reason `harness.ts` gives about the map: everything this
 * page exercises is exactly what `game/port.ts` records the jsdom suite cannot
 * reach.
 *
 * jsdom implements no WebGL, so a `WebGLRenderer` cannot be constructed there at
 * all. Four things therefore go unchecked without this page:
 *
 * 1. **That the renderer constructs against a real GL context**, rather than
 *    merely satisfying our own types.
 * 2. **That the geometry `terrain.ts` produces is one a real GL implementation
 *    accepts** — a vertex buffer whose length disagrees with its index buffer is
 *    a type-correct object that a driver rejects.
 * 3. **That a frame actually draws.** `render` returning without throwing is not
 *    the same claim; the harness reads back the drawing buffer and reports what
 *    was written to it.
 * 4. **That the world `world.ts` derived reaches the screen** — #241. A
 *    `WorldStyle` added to `SceneFrame` that `three-renderer.ts` never reads
 *    passes every jsdom test and changes nothing a rider sees, which is #240's
 *    named defect shape for this epic. So the read-back is taken at four points
 *    rather than one: above the horizon, beside the road, on the road, and on
 *    the road again further away.
 * 5. **That the road's markings reach the screen, and cost one draw call** —
 *    #242, and the same defect shape one layer down. A colour attribute
 *    `terrain.ts` fills and `three-renderer.ts` never uploads passes every
 *    jsdom test too. So a fifth read-back finds the centre line against the
 *    carriageway beside it, and the driver's own draw calls are counted.
 *
 * 6. **That the scenery is on the screen at all, and costs one draw call per
 *    kind** — #244. An `InstancedMesh` built with `count = 0`, never added to
 *    the scene, or left with a zero-scale matrix passes every assertion in
 *    `three-renderer.test.ts` and draws nothing. So the harness renders **the
 *    same frame twice, once with `SceneFrame.scatter` and once with it
 *    emptied**, and reports where beside the road the two frames disagree —
 *    together with the driver's own draw-call count for each, which is what
 *    turns "one call per kind" from a review note into a measurement.
 *
 * ⚠️ **It publishes measurements and asserts nothing.** Every claim is in
 * `game.browser.spec.ts`, and every claim there is now *relative* — one pixel
 * against another, or a pixel against the `WorldStyle` this page publishes.
 * This harness used to export a `drewPixels` boolean instead, computed as
 * "the centre pixel is not black". It was true of a frame that drew nothing
 * the moment #241 gave the scene a non-black sky, and the road and every
 * marker could be removed from the scene with all 19 browser tests green. A
 * read-back compared against a fixed colour decays the moment somebody changes
 * that colour, and nothing says it has.
 *
 * ⚠️ What it does **not** prove is that the scene *looks right*. There is no
 * reference image, and #19 forbids deriving one from another product. That limit
 * is stated in `game/port.ts` and in the pull request rather than papered over.
 */

import {
  altitudeMetres,
  elevationAt,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  metres,
  metresPerSecond,
  routeProfile,
  type RoutePoint,
} from '@onyourleft/domain';
import type { KitColour } from '@onyourleft/store';

import {
  CAMERA_ABOVE_METRES,
  NEAR_PLANE_METRES,
  cameraRig,
  verticalHalfTangent,
} from '../src/game/camera';
import { emptyRiderJoints, RIDER_BICYCLE_PARTS, riderJoints } from '../src/game/bicycle';
import type { CameraPose, GameView, RiderMarker, SceneFrame } from '../src/game/port';
import type { WorldStyle } from '../src/game/world';

import { sceneFrame as builtSceneFrame } from '../src/game/scene';
import { retainedFrame } from '../src/game/frame-testing';
import { corridorOrigin } from '../src/game/terrain';
import {
  QUALITY_LADDER,
  qualitySettings,
  REALISTIC_LADDER,
  RIDER_SHADOW_MAP_RUNG,
  type QualitySettings,
} from '../src/game/quality';
import {
  circuitRoute,
  hairpinRoute,
  hillRoute,
  lakeValleyRoute,
  northRoute,
  valleyRoute,
} from '../src/game/route-fixtures-testing';
import { GRADIENT_TINT_FULL_SCALE_PERCENT } from '../src/game/terrain';
import { structuresAt } from '../src/game/settlements';
import { waterways } from '../src/game/waterways';
import { HORIZON_RADIUS_METRES, HORIZON_SEGMENTS, VERGE_DROP_METRES } from '../src/game/landform';
import {
  directionalFogColour,
  ridgeLift,
  skylineCrestFloor,
  valleyHazeFactor,
  type LinearColour,
} from '../src/game/realistic-light';
import { srgbByteToLinear } from '../src/game/scenery-palette';
import { buildingPlan, onFace, OPENING_RECESS_METRES } from '../src/game/buildings';
import {
  bicycleTreadOf,
  riderKitOf,
  compressedRealisticLoaders,
  drawnWorldOf,
  bridgesWearStoneOf,
  loadRealisticWorld,
  realisticTextureFormat,
  realisticTextureReport,
  uploadRealisticTexturesOf,
  loadSceneryModels,
  airOf,
  atmosphereOf,
  type AirReading,
  horizonColoursOf,
  horizonFromSkyOf,
  drawOrderOf,
  foliageOrderedOf,
  sceneMaterialsOf,
  type DrawnPiece,
  sceneryDrawnOf,
  setBuildingOpenings,
  setRealisticTints,
  setRealisticMaterialsMerged,
  setTreeLevels,
  threeGameRenderer,
  waterSkyOf,
  filterWaterRipplesOf,
  groundBlobsOf,
  nearFieldOf,
  nearFieldShapes,
  showGroundBlobsOf,
  roadWearOf,
  groundBlendOf,
  impostorsLitOf,
  foliageStillOf,
  gantriesShownOf,
  gantryCountsOf,
  waterFresnelOf,
  waterReflectsOf,
} from '../src/game/three-renderer';
import { bannerPlace, standPoint } from '../src/game/gantry';
import { FINISH_WORD } from '../src/game/gantry-wording';
import { PATCH_CELL_METRES, patchInCell, WHEEL_TRACK_OFFSETS_METRES } from '../src/game/road-wear';
import { groundBlobAlpha, groundUnder } from '../src/game/ground-blob';
import { clearOfTheCamera, nearPyramid, sceneryReach } from '../src/game/near-field';
import {
  REALISTIC_SURFACES,
  realisticUrl,
  realisticWorldNotice,
} from '../src/game/realistic-assets';
import {
  FOLIAGE_TINT,
  instanceTint,
  MASONRY_TINT,
  NO_TINT,
  type InstanceTint,
  type TintBound,
} from '../src/game/instance-tint';
import { HARD_SWAP_TREE_LEVELS, REALISTIC_TREE_LEVELS } from '../src/game/realistic-budget';
import type { TreeLevels } from '../src/game/tree-levels';
import { COUNTED_DRAWS, trianglesInDraw } from './realistic/draws';
import { FRESNEL_CONTROL, FRESNEL_REFERENCE, WATER_BAND_ROWS } from './realistic-surfaces-fixture';
import {
  scatterSeed,
  STRUCTURE_KINDS,
  SCENERY_KINDS,
  SCATTER_VARIANT_SLOTS,
  type ScatterItem,
  type SceneryKind,
} from '../src/game/scatter';
import { atStartLine } from '../src/game/simulation';
import {
  CAMERA_CONSTRAINTS,
  platformMediaDevices,
  videoLuminanceSampler,
  type MediaStreamLike,
} from '../src/camera/browser-camera';
import { observePair, PRESENCE_PAIR_GAP_MILLISECONDS } from '../src/camera/presence';

/**
 * A frame this page may hold while it builds others — #469.
 *
 * Since #469 the ground's and the water's arrays are LENT by the build that
 * made them and written over by the next (`landform.ts` §`TerrainMesh.lease`).
 * The ride loop draws each frame as soon as it is built; this page does not —
 * it compares a climb with a descent and lap one with lap three, and draws a
 * frame again after a sweep of a hundred others. Every frame this page HOLDS
 * is therefore a {@link retainedFrame}, a copy that owns its arrays, which is
 * the one difference from what `GameView` draws — and every frame it TIMES is
 * not, since #473: {@link lentSceneFrame}. The renderer refuses a lent
 * frame that has been written over, so a builder here that skipped the copy
 * would throw rather than draw the wrong ground.
 */
function sceneFrame(input: Parameters<typeof builtSceneFrame>[0]): SceneFrame {
  return retainedFrame(builtSceneFrame(input));
}

/** How a frame is built: {@link sceneFrame}'s copy, or {@link lentSceneFrame}. */
type FrameBuild = (input: Parameters<typeof builtSceneFrame>[0]) => SceneFrame;

/**
 * A frame built exactly as `GameView` builds one — LENT, drawn at once and
 * never held — #473.
 *
 * ⚠️ **Every TIMED frame on this page is one of these, and until #473 none
 * was.** {@link sceneFrame}'s copy is about 55 KB a frame that the product
 * never makes, and every frame-time figure this page published — the shading
 * cost, the shadow-map cost, the realistic world's frame time — carried it.
 * {@link timeFrames} is the one place a frame is built and drawn in the same
 * breath, so it is the one place a lent frame is safe here, and it is also
 * what puts the product's lending path back in front of a real browser: the
 * renderer refuses a lent frame that has been written over, so a sweep here
 * that held one would throw rather than draw the wrong ground.
 */
const lentSceneFrame: FrameBuild = builtSceneFrame;

/** What {@link gradientProbe} publishes — #458. */
interface GradientMeasurement {
  /**
   * #425: two sky pixels, straight ahead 25° and 8° above the horizon — and
   * the same two with the route's haze set to its sky, which is the flat sky
   * this replaced.
   */
  readonly skyHigh: Pixel;
  readonly skyLow: Pixel;
  readonly flatSkyHigh: Pixel;
  readonly flatSkyLow: Pixel;
  /**
   * #425: how much the road varies across a patch of carriageway, with the
   * surface detail on and off — the standard deviation of luminance, in
   * levels — and how many pixels of the frame the ground's detail changes.
   */
  readonly roadSpreadDetailed: number;
  readonly roadSpreadPlain: number;
  readonly groundChangedByDetail: number;
  /**
   * #468's review, B3: pixels that differ between the same place on a loop
   * seen on lap one and on lap three, with the surface detail on — and the
   * same comparison with the patchwork's lap wrap defeated, which is the field
   * colours as #468's first head drew them.
   */
  readonly lapChanged: number;
  readonly lapChangedUnwrapped: number;
  /** Pixels the hills on the horizon cover, against the same ridge sunk below it. */
  readonly horizonPixels: number;
  /** Pixels a block BELOW the rider's road level changes, 40 m up a 10 % climb. */
  readonly climbBuried: number;
  /** The same block lifted clear of that hillside: that it is drawn at all. */
  readonly climbLifted: number;
  /** Pixels a block below the rider's road level changes, 40 m down a 10 % descent. */
  readonly descentBelow: number;
  /** The climb's buried block again, over the flat quad's geometry. */
  readonly flatClimbBuried: number;
  /** The descent's block again, over the flat quad's geometry. */
  readonly flatDescentBelow: number;
  /** Vertices and indices the landform uploads, and the indices each rung draws. */
  readonly terrainVertices: number;
  readonly terrainIndices: number;
  readonly terrainIndicesByRung: readonly number[];
}

/** What {@link waterProbe} publishes — #459. */
interface WaterMeasurement {
  /** How many streams and lakes the valley route has. */
  readonly crossings: number;
  /** A pixel on the stream beside the bridge, with the water drawn and without. */
  readonly beside: Pixel;
  readonly besideDry: Pixel;
  /** A pixel on the bridge's deck, with the water drawn and without. */
  readonly deck: Pixel;
  readonly deckDry: Pixel;
  /** The same deck pixel with the ROAD taken out: what is under the deck. */
  readonly underDeck: Pixel;
  /** Draw calls on the valley frame, and on the same frame with no water or bridge. */
  readonly drawCalls: number;
  readonly drawCallsDry: number;
  /** Milliseconds a frame of the valley, water shaded and flat. */
  readonly shadedMs: number;
  readonly flatMs: number;
  /**
   * #501: how much the water's pixels differ from the pixel above them — the
   * mean squared difference in luminance, 0–255 — with the ripple band-limit
   * on, and off as the control; and how many pixel pairs that was over.
   * @see rippleBanding
   */
  readonly rippleBanding: number;
  readonly rippleBandingUnfiltered: number;
  readonly ripplePairs: number;
}

/** What {@link settlementProbe} publishes — #460. */
interface SettlementMeasurement {
  /** How many structures the village frame carries, and of how many kinds. */
  readonly structures: number;
  readonly kinds: number;
  /** Pixels the structures change, against the same frame without them. */
  readonly pixels: number;
  /** Draw calls with the structures, and without. */
  readonly drawCalls: number;
  readonly drawCallsBare: number;
  /** Milliseconds a frame, with the structures and without. */
  readonly withMs: number;
  readonly withoutMs: number;
}

/** What {@link shadowMapProbe} publishes. */
type ShadowMapMeasurement = NonNullable<Window['__oylGameHarness']>['shadowMap'];

/**
 * The closest pass of scenery to the camera on a ride, as the renderer drew
 * it — #545. @see nearFieldProbe
 */
export interface NearFieldMeasurement {
  /** Route distance of the frame the probe chose, in metres. */
  readonly distance: number;
  /** How far the nearest dropped item's pivot is from the eye in plan, in metres. */
  readonly pivotMetres: number;
  /** What the renderer's cull dropped in that frame, by kind. */
  readonly cut: readonly string[];
  /** Pixels that differ between the near plane where it ships and one half as far, cull on. */
  readonly shippedPixels: number;
  /** The same with the cull off — the control. */
  readonly controlPixels: number;
  /** The shipped frame drawn twice and compared: what "differs" means with nothing changed. */
  readonly noisePixels: number;
  /** Which world the probe's view drew — the realistic one, or the measure is of the wrong world. */
  readonly world: string;
}

/** One read-back pixel, as four bytes. */
type Pixel = readonly [number, number, number, number];

/** The box the rider's own pixels fill, as fractions of the frame from the top left. */
/**
 * The rider at a hairpin's apex, as the renderer drew them — #499. @see lineProbe
 */
export interface LineMeasurement {
  /** Pixels the rider changed. Zero means there was nothing to measure. */
  readonly pixels: number;
  /** Where the rider's pixels are centred, as a fraction of the frame's width. */
  readonly centre: number;
  /**
   * How far the top third of the rider's pixels is centred from the bottom
   * third, as a fraction of the frame's width: nought for an upright rider,
   * and toward the inside of the bend for one leaning into it.
   */
  readonly topShift: number;
}

/**
 * Which way a bend turns ON THE SCREEN — #583. @see bendProbe
 */
export interface BendMeasurement {
  /** Road pixels in the frame. Zero means there was nothing to measure. */
  readonly pixels: number;
  /** The centre of the road across its NEAR quarter of rows, as a fraction of the width. */
  readonly nearCentre: number;
  /** The centre of the road across its FAR quarter of rows, as a fraction of the width. */
  readonly farCentre: number;
}

export interface RiderExtent {
  /** The canvas's width over its height. */
  readonly aspect: number;
  readonly top: number;
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
  /** How many pixels the rider changed. Zero means there was nothing to measure. */
  readonly pixels: number;
}

declare global {
  interface Window {
    __oylGameHarness?: {
      readonly created: boolean;
      readonly hasContext: boolean;
      readonly framesDrawn: number;
      readonly quadCount: number;
      readonly vertexCount: number;
      /** How many triangle indices the road's index list holds. */
      readonly indexCount: number;
      /** The highest vertex any of those indices names. */
      readonly highestIndex: number;
      /**
       * How many draw calls the **first** frame of the whole scene issued —
       * #242's fifth criterion, measured rather than reviewed.
       *
       * The road is meant to be **one** of them however many lanes and marks
       * it carries, so the total is the ground, the road, the two markers this
       * harness puts on the route, and — since #244 — one call per scatter
       * kind that frame has beside it. A road split into three meshes reads as
       * three more than it should.
       *
       * ⚠️ **`drawCallsWithoutScatter` is what #242's own test asserts on**,
       * because it is measured on a frame with the scenery deliberately
       * removed. This one is the unprepared frame, and `game.browser.spec.ts`
       * checks it against `4 + scatterKindCount` — a harness field no spec
       * reads is a measurement nobody is making, which is what #268's review
       * found here.
       */
      readonly drawCallsPerFrame: number;
      readonly markerKinds: readonly string[];
      /**
       * The world `world.ts` derived for the harness route.
       *
       * Published so the spec can state what it expects on the screen as a
       * claim **relative to the derived numbers** rather than against a
       * hard-coded colour. #241 is itself the change that showed why: the
       * background stopped being black, and every assertion written as
       * "this pixel is not the clear colour" quietly stopped meaning anything.
       */
      readonly world: WorldStyle;
      /** Well above the horizon: the sky, which nothing fogs. */
      readonly skyPixel: Pixel;
      /** Low and far to the side: ground, outside the 7 m road. */
      readonly groundPixel: Pixel;
      /** Dead centre, which the chase camera puts on the road ahead. */
      readonly roadPixel: Pixel;
      /**
       * The same road, further up the frame and so further away.
       *
       * ⚠️ **This is the only thing that can see `WorldStyle.fogDensity` and
       * `WorldStyle.horizonColour`.** Both are read by `#updateWorld` and
       * neither changes any single pixel's *identity* — they change how far a
       * surface has converged toward the horizon by the time you see it. One
       * road pixel tells you nothing; two at different depths tell you the
       * whole of it. Setting `#fog.density = 0` in the renderer left all 19
       * browser tests green before this existed.
       */
      readonly roadFarPixel: Pixel;
      /**
       * How far down the frame the near and the far road probes were taken, as
       * fractions from the top — #424. Published so the spec can hold them to
       * the order they must be in: a far probe that is not ABOVE the near one
       * is not further up the road, whatever colour it read.
       */
      readonly roadProbeRows: readonly [number, number];
      /**
       * The rider as the renderer actually drew them, read back off the drawing
       * buffer — #424's first criterion. @see riderExtent
       */
      readonly riderFrame: { readonly landscape: RiderExtent; readonly portrait: RiderExtent };
      /**
       * The rider at the apex of a 20 m hairpin on the line, and — the control —
       * the same rider on the centreline, upright (#499). @see lineProbe
       */
      readonly line: {
        readonly on: LineMeasurement;
        readonly onUpright: LineMeasurement;
        readonly off: LineMeasurement;
        /**
         * The rider on a STRAIGHT, on the line and — the control — on the
         * centreline, through the centreline's camera — #546. @see lineProbe
         */
        readonly straightOn: LineMeasurement;
        readonly straightOff: LineMeasurement;
      };
      /**
       * A bend that turns RIGHT on the map, and — the control — the same bend
       * mirrored east for west, which is exactly how a build before #583 drew
       * the right-hand one. @see bendProbe
       */
      readonly bend: { readonly right: BendMeasurement; readonly mirrored: BendMeasurement };
      /**
       * GPU buffers and textures three had created after the first frame, and
       * after {@link FRAMES}. Equal means nothing new was allocated per frame.
       */
      readonly resourcesAfterFirstFrame: number;
      readonly resourcesAfterAllFrames: number;
      /**
       * The same count again, after the whole sweep has been driven a **second**
       * time over exactly the same frames.
       *
       * ⚠️ **This exists because the pair above it stopped meaning what it
       * said, and #244 is what made that visible.** three creates a GPU buffer
       * the first time it *draws* an object, and the scenery belt has six
       * meshes that are drawn only when the route puts that kind of thing
       * beside the road. A kind that first appears two hundred metres in
       * allocates its five buffers two hundred metres in — once, for the life
       * of the view, bounded by six kinds. That is not a per-frame allocation
       * and #240's NFR-3 is not about it, but it does make
       * `resourcesAfterAllFrames === resourcesAfterFirstFrame` false.
       *
       * Driving the identical sweep again and finding **no further allocation
       * at all** is the statement that was actually wanted, and it is strictly
       * stronger: it covers every kind the route has, every corridor length it
       * produces and every scenery count it reaches, rather than whatever
       * happened to be on screen at frame one.
       */
      readonly resourcesAfterSecondSweep: number;
      /**
       * The brightest disagreement between the road's centre column and the
       * carriageway beside it, found in the band the road fills — #242.
       *
       * ⚠️ **A pixel on the centre line and a pixel on the road beside it, which
       * is #242's browser-gate criterion in its own words.** It is *found*
       * rather than assumed, and both halves of that are deliberate: a mark is
       * periodic, so a fixed row lands in a gap as often as on paint; and a
       * 0.15 m line is a couple of pixels wide at this distance, so a fixed
       * column is one camera tweak away from missing it. A road with no centre
       * line makes every row in the band identical across its width, so the
       * best difference is zero and the spec's assertion goes red — which is
       * the only outcome that matters here.
       */
      readonly centreLinePixel: Pixel;
      /** Its pair: the same row, a little way across the carriageway. */
      readonly roadBesidePixel: Pixel;
      /** Where in the frame the pair was found, as a fraction of its height. */
      readonly centreLineRowFraction: number;
      /**
       * {@link roadPixel} again, on a **later frame** where the route descends.
       *
       * ⚠️ **This is the only probe that can see a buffer that was written and
       * never re-uploaded**, which is this program's dominant defect shape —
       * *a write that reports success while the read cannot see it* — arriving
       * in a vertex buffer. three uploads an attribute the first time it binds
       * it and thereafter only when `needsUpdate` says to, so dropping that one
       * line leaves the GPU holding frame one forever. Every other read-back
       * here is taken from a re-render of frame one and would agree with it
       * perfectly.
       *
       * The harness route climbs for its first half and descends for its
       * second, and #242 tints the surface by signed gradient — so a rider
       * moved onto the descent is the same road, the same camera and a
       * different colour.
       */
      readonly roadOnDescentPixel: Pixel;
      /**
       * How many items and how many distinct kinds the scatter frame carried.
       *
       * Published so the spec can state #244's first criterion as a *ratio*:
       * many items, at most one draw call each kind. A frame that happened to
       * carry six items would make the draw-call claim vacuous, so the spec
       * checks this first.
       */
      readonly scatterItemCount: number;
      readonly scatterKindCount: number;
      /** Draw calls for one frame carrying {@link scatterItemCount} items. */
      readonly drawCallsWithScatter: number;
      /** Draw calls for the identical frame with `scatter` emptied. */
      readonly drawCallsWithoutScatter: number;
      /**
       * How many pixels beside the road changed when the scenery was added.
       *
       * ⚠️ **The only thing in the repository that can say the scenery is
       * drawn.** Everything else about the belt — six meshes, the counts, the
       * matrices, the cull — is asserted in jsdom against objects that need no
       * GL context, and all of it passes for a belt that was never added to a
       * scene. #240's named defect shape for this epic, one layer further down
       * than the two above it.
       */
      readonly sceneryPixelsChanged: number;
      /** The most-changed pixel of those, with and without the scenery. */
      readonly sceneryPixelWith: Pixel;
      readonly sceneryPixelWithout: Pixel;
      /** Where it was found, as fractions of the frame's width and height. */
      readonly sceneryColumnFraction: number;
      readonly sceneryRowFraction: number;
      /**
       * How many pixels the rider's own marker occupies, lit and flat — #286.
       *
       * Found by rendering the same frame with the rider's marker and without
       * it and taking the pixels that changed, so it is the marker's silhouette
       * and nothing else: no road, no scenery, no fog gradient. Published so
       * the spec can check the two spreads below are taken over a real object
       * rather than over three stray pixels.
       */
      readonly litMarkerPixels: number;
      readonly flatMarkerPixels: number;
      /**
       * The range of brightness **across the rider's own marker** — #286's
       * first criterion, in the only place it can actually be observed.
       *
       * ⚠️ **This is the whole of what says the world has a light direction.**
       * A sphere lit from one side has a bright face and a dark one; the same
       * sphere unlit is one flat colour from edge to edge, because nothing in
       * the scene varies over 1.8 m at 8 m from the camera — the fog takes
       * 0.1 % over that depth. So a large spread is shading and a spread of
       * nothing is the unlit world #241 shipped.
       *
       * It is measured at the **target** rung and at the **floor** rung of
       * `QUALITY_LADDER`, which is what makes #245's answer checkable: the
       * floor rung is supposed to put the flat world back, and a rung that
       * changed nothing would report the same spread twice.
       */
      readonly litMarkerSpread: number;
      readonly flatMarkerSpread: number;
      /** The brightest and darkest of the lit marker's own pixels. */
      readonly litMarkerBrightest: Pixel;
      readonly litMarkerDarkest: Pixel;
      /**
       * How many of the rider's pixels change when the cranks turn — #349.
       *
       * ⚠️ **The one measurement that says the pedalling reaches the screen.**
       * A crank angle carried on the frame and read by nobody, or read once and
       * never re-read, passes every assertion in `bicycle.test.ts` and every
       * assertion in `three-renderer.test.ts` — it is #240's named defect shape
       * for this epic, and it has caught this repository five times. So the
       * same frame is drawn at two crank angles a quarter turn apart and the
       * pixels that differ are counted.
       *
       * {@link crankStillPixels} is its control, and without it this number
       * means nothing: it is the same comparison between two frames drawn at
       * the **same** angle, which must be zero. A renderer that redrew the
       * rider slightly differently every frame — or a read-back that returned
       * noise — would otherwise look exactly like a turning crankset.
       */
      readonly crankTurnPixels: number;
      readonly crankStillPixels: number;
      /** How many pixels the bicycle itself occupies — #349. @see crankTurnPixels */
      readonly riderPixels: number;
      /**
       * How many pixels differ between the same rider, in the same place, at
       * the same crank angle, arrived at two ways — #366–#368's review.
       *
       * **It must be zero**, and it is the one number here that goes non-zero
       * for a defect no other probe on this page can see. One of the two reads
       * moves the rider there without its crank angle changing; the other
       * arrives at an angle that then changes back, so no pose cache can serve
       * it. A renderer holding its leg matrices in world space and caching them
       * on the crank angle alone draws the first with its legs
       * {@link RIDER_MOVE_METRES} behind, which is every frame of every ride
       * with no cadence sensor on it.
       *
       * {@link riderMovePixels} is its control: the rider genuinely moved, so a
       * zero above is a renderer that followed rather than a probe that varied
       * nothing.
       */
      readonly riderLeftBehindPixels: number;
      readonly riderMovePixels: number;
      /**
       * The relative cost of the shading, in milliseconds a frame — #286.
       *
       * ⚠️ **Same scene, same route, same drawing-buffer size; the only
       * difference is the material.** The floor rung also halves the render
       * scale, so timing rung 0 against rung 4 would be measuring two things
       * at once — these two sweeps run at rung 0's own settings with
       * `shading` overridden, which is the *"before and after"* the owner's
       * decision on #286 asks for and is the only frame-cost claim this
       * repository can make today.
       *
       * ⚠️ **What it is not.** It is a headless Chromium on whatever hardware
       * the run happens to be on — a software rasteriser in CI. ADR 0008 D-2's
       * gate is about the **device floor** and #247 is outstanding, so nothing
       * here says a mid-range phone can afford it. That is stated in the pull
       * request and in `QualitySettings.shading` rather than papered over.
       *
       * Each is the mean over {@link shadedFrames} frames, taken twice and
       * averaged, with the GPU flushed before the clock is read.
       */
      readonly litFrameMs: number;
      readonly flatFrameMs: number;
      /** How many frames each of those two means was taken over. */
      readonly shadedFrames: number;
      /**
       * How far apart two measurements of the **same** shading came out.
       *
       * ⚠️ **Without this the pair above is uninterpretable**, and #286 exists
       * partly because this epic keeps producing performance numbers nobody
       * can act on. The lit and the flat means are each taken
       * {@link SHADING_ROUNDS} times; this is the widest range within either
       * group. A lit-minus-flat difference smaller than it is a difference
       * this measurement cannot see, which is a finding rather than a failure.
       */
      readonly frameMsNoise: number;
      /**
       * Draw calls for one frame, lit and flat.
       *
       * Shading is a *fragment* cost and must not be a draw-call cost: the
       * lit and the unlit material are mounted on the same meshes, so the two
       * numbers are equal and a swap that split a mesh would show up here.
       */
      readonly litDrawCalls: number;
      readonly flatDrawCalls: number;
      /**
       * How many vertex indices the **scenery** submitted for one frame of each
       * kind, with #341's models loaded — the whole point of the change, read
       * off the driver rather than off a geometry the harness built itself.
       *
       * ⚠️ **Its partner below is what makes it evidence.** A number on its own
       * says nothing: a world of primitives submits indices too. So the same
       * frame is measured twice — once with the models and once with them
       * cleared, which is the only control available for "did the committed
       * `.glb` files actually parse in a real engine" — and the five kinds
       * ADR 0022 D-3 gives a model must draw **more** than they did, while
       * `post`, which it deliberately leaves alone, must draw exactly the same.
       */
      readonly sceneryIndicesModelled: Readonly<Record<string, number>>;
      /** The same measurement with the models cleared. @see sceneryIndicesModelled */
      readonly sceneryIndicesPlain: Readonly<Record<string, number>>;
      /** How many items of each kind that frame held, so neither is vacuous. */
      readonly sceneryInstances: Readonly<Record<string, number>>;
      /**
       * WebGL textures created across a whole sweep — #366's fourth criterion.
       *
       * ⚠️ **Zero is the assertion, and it is the only way to make it.** The
       * buildings' colour comes out of a 512 × 512 atlas that is fetched,
       * sampled once at load and thrown away, and every step of that is
       * invisible from outside: a renderer that kept the `Texture` and bound it
       * would draw an identical frame, at an identical draw-call count, with an
       * identical vertex buffer. `gl.createTexture` is what it could not avoid.
       */
      readonly texturesCreated: number;
      /**
       * Textures three creates for itself, before anything of ours is drawn.
       *
       * ⚠️ **What makes {@link texturesCreated} more than a zero that was
       * always going to be zero.** That figure is a difference, and a counter
       * that had been patched onto the wrong prototype — or a `body` that never
       * ran — would report a difference of nothing just as loudly. This is the
       * same counter over the same run, and it is four: three allocates a 1 × 1
       * for each of the 2D, array, 3D and cube samplers its default uniforms
       * declare, whether or not this program has an image anywhere.
       */
      readonly texturesBaseline: number;
      /**
       * A broadleaf tree's own pixels, split by which channel leads — #366.
       *
       * ⚠️ **The red-dominant count is the whole of the first criterion.** One
       * flat colour a kind was the world before #366 and the colour was
       * `0x3f6b33`, a green: every pixel of every tree was green-dominant and
       * no arrangement of lighting could make one red. `woodBark` is
       * (0.886, 0.514, 0.341), which is red-dominant, so a trunk drawn from the
       * model's own values cannot be missed and a trunk drawn from ours cannot
       * be mistaken for one.
       */
      readonly treeRedPixels: number;
      readonly treeGreenPixels: number;
      /**
       * A building's own pixels, likewise — #366's second criterion.
       *
       * The atlas gives it a green roof (66, 172, 124) and slate walls
       * (95, 100, 124), so both a green-dominant and a blue-dominant pixel
       * exist. The flat colour it had before #366 is `0xa8968a`, which is
       * red-dominant, so **neither** does.
       */
      readonly buildingGreenPixels: number;
      readonly buildingBluePixels: number;
      /**
       * Scenery draw calls at each `sceneryVariants` rung — #367.
       *
       * Measured on {@link variantFrame}, which carries an item in every
       * variant slot of every kind, so this is the belt's real width rather
       * than whatever one stretch of the harness route happened to place.
       *
       * ⚠️ **The three entries are `sceneryVariants` of 3, 2 and 1 — variant
       * counts, not rung numbers**, and this line said *"rungs 3, 2 and 1"*
       * until #485. It never was a rung index: `sceneryCallsAcrossRungs`
       * overrides that one figure on rung 0's settings and sweeps the three
       * values the ladder uses, so no rung is entered at all. Since #482 the
       * ladder is five rungs and rung 3's own count is 1, which is what made
       * the old wording read as a statement that is simply false.
       */
      readonly sceneryCallsByVariants: readonly number[];
      /**
       * What each of a kind's shapes costs in vertex indices — #367.
       *
       * ⚠️ **Two entries that are equal mean two variants drawing the same
       * geometry**, which is what a table whose second file failed to load
       * produces — and it is indistinguishable from a working belt in every
       * other measurement here, including the draw-call counts above.
       */
      readonly variantIndices: Readonly<Record<string, readonly number[]>>;
      /**
       * The mean colour of each rider's own silhouette — #368.
       *
       * ⚠️ **Each drawn alone at the same place**, so the only thing that can
       * differ between the three is the tint. #93's third criterion is that a
       * rider tells them apart at a glance, and with the shape no longer doing
       * it this is the measurement that says the colour still can.
       */
      readonly riderMeanColour: Readonly<Record<string, Pixel>>;
      /** How many pixels each rider covers, drawn alone. @see riderMeanColour */
      readonly riderSilhouettePixels: Readonly<Record<string, number>>;
      /**
       * The rider's silhouette drawn where `alone` put it before #455 — at the
       * camera pose's height, 0.4 m under the tarmac 8 m up a 5 % road. The
       * CONTROL for {@link riderSilhouettePixels}: the placement fix is what
       * made the probe see the whole bicycle, and this says by how much.
       */
      readonly riderBuriedPixels: number;
      /**
       * #458 — does the ground beside the road show the gradient? A probe
       * object is drawn beside a 10 % climb and a 10 % descent, and the pixels
       * it changes are counted. @see gradientProbe
       */
      readonly gradient: GradientMeasurement;
      /**
       * #459 — the stream under the bridge, and the deck above it. @see waterProbe
       */
      readonly water: WaterMeasurement;
      /** #460 — a village and its fields, drawn and timed. @see settlementProbe */
      readonly settlement: SettlementMeasurement;
      /** #545 — the closest pass of scenery to the camera, drawn. @see nearFieldProbe */
      readonly nearField: NearFieldMeasurement;
      /**
       * Pixels the bot's own cranks move over half a development — #368.
       *
       * ⚠️ **From its odometer, not from a cadence it does not have.** The two
       * frames differ only in how far up the road the bot is said to be, which
       * is the one input `bicycle.ts` §`simulatedCrankAngle` takes.
       */
      readonly botCrankPixels: number;
      /**
       * Pixels each rider's contact shadow darkens, drawn alone — #426.
       *
       * The same rider at the same place on the same frame, once with
       * `riderShadows: 'none'` and once with the `'contact'` every rung of the
       * ladder draws: the pixels that differ are the blob and nothing else.
       * ⚠️ **The ghost's is the decision, not a failure**: it casts none
       * (`contact-shadow.ts` §`CASTS_CONTACT_SHADOW`), so its entry is 0.
       */
      readonly contactShadowPixels: Readonly<Record<string, number>>;
      /**
       * The mean luminance of those pixels with the shadow and without — #426.
       * A blob that reached the buffer and made the road LIGHTER, or one that
       * only moved a colour sideways, is not a shadow.
       */
      readonly contactShadowLuminance: Readonly<Record<string, readonly [number, number]>>;
      /**
       * The control for {@link contactShadowPixels}: the same shadowless frame
       * drawn twice and compared. Anything but 0 means the difference above is
       * a renderer that is never still rather than a shadow.
       */
      readonly contactShadowNoise: number;
      /**
       * The riders' shadow MAP, measured — #426's second half, and published
       * rather than asserted. Only when the page is loaded with
       * `?shadow-map`: the spec's other cases share one load of this page
       * without it (#456), and a measurement nobody asserts on should not cost
       * that load its frames.
       */
      readonly shadowMap: {
        readonly measured: boolean;
        /** Mean ms a frame on the full rung — contact shadows. */
        readonly contactFrameMs: number;
        /** Mean ms a frame on `RIDER_SHADOW_MAP_RUNG`. */
        readonly mapFrameMs: number;
        /** The widest spread between two rounds of the same rung. */
        readonly noiseMs: number;
        /** Draw calls on one frame of each — the shadow pass is extra calls. */
        readonly contactDrawCalls: number;
        readonly mapDrawCalls: number;
        /** Pixels the map shadow darkens under the rider alone, against `'none'`. */
        readonly shadowPixels: number;
        /** Pixels that differ, map against `'none'`, with the rider made the ghost — #547. */
        readonly ghostShadowPixels: number;
      };
      /**
       * What a presence check costs with the renderer running — #390.
       * Measured only under `?shadow-map`, the load that already times rungs.
       * @see presenceCostProbe
       */
      readonly presenceCost: PresenceCostMeasurement;
      /**
       * The first frames of a ride on the shadow map rung, with and without
       * `prepare` — #547. Measured only under `?shadow-map`. @see rideStartProbe
       */
      readonly rideStart: RideStartMeasurement;
      /** The realistic world — ADR 0026. Measured only by `?realistic`. @see realisticProbe */
      readonly realistic: RealisticMeasurement;
      /** #617's trees. Measured only by `?realistic&trees` (#644). @see treeLevelRun */
      readonly trees: TreeLevelMeasurement;
      readonly errors: readonly string[];
    };
  }
}

/** How many frames the harness drives. #241's own criterion asks for 100. */
const FRAMES = 100;

/** A kilometre of climbing road, generated — as everything here is — from numbers. */
function harnessRoute(): ReturnType<typeof routeProfile> {
  const points: RoutePoint[] = [];
  for (let index = 0; index <= 100; index += 1) {
    points.push({
      position: geographicPosition(
        degreesLatitude(51.5 + (index * 10) / 111_320),
        degreesLongitude(-0.12),
      ),
      elevation: altitudeMetres(index <= 50 ? index * 0.5 : (100 - index) * 0.5),
    });
  }
  return routeProfile(points);
}

/**
 * Where on {@link harnessRoute} the rider is for the last frame, in metres.
 *
 * The route crests at 500 m, so 800 is squarely on the descent — and far
 * enough past the crest that the profile's 100 m gradient window has settled.
 */
const ON_THE_DESCENT_METRES = 800;

const NOWHERE: Pixel = [0, 0, 0, 0];

/** What the harness reports for the rider before it has measured one. */
const NO_RIDER: RiderExtent = { aspect: 0, top: 0, bottom: 0, left: 0, right: 0, pixels: 0 };

/** Two kilometres of dead-level road. @see riderExtent */
function levelRoute(): ReturnType<typeof routeProfile> {
  const points: RoutePoint[] = [];
  for (let index = 0; index <= 200; index += 1) {
    points.push({
      position: geographicPosition(
        degreesLatitude(51.5 + (index * 10) / 111_320),
        degreesLongitude(-0.12),
      ),
      elevation: altitudeMetres(0),
    });
  }
  return routeProfile(points);
}

/**
 * How much of the frame the rider fills, **measured on pixels the real
 * renderer drew** — #424's first criterion.
 *
 * *"The rider's bicycle occupies a stated minimum share of frame height at
 * 16 : 9, measured in the browser gate — a number, so 'prominent' cannot drift
 * back to 'speck'."* `camera.ts` §`riderFrameBox` is that number as arithmetic,
 * and arithmetic can agree with itself over a renderer that draws the rider
 * somewhere else: a `fov` never applied, a marker scaled, a camera placed by
 * some other rule. So the same frame is rendered twice — once with the rider
 * and nothing else that moves, once with no rider at all — and the box of the
 * pixels that differ is the rider.
 *
 * On a LEVEL road, because `riderFrameBox` is stated for one: on the harness's
 * own 5 % hill the rider stands plumb on a tilted road and their feet are half
 * a point lower in the frame.
 *
 * On a canvas of its own, for {@link sceneryIndicesByKind}'s reason. ⚠️ And
 * at TWO shapes. 16 : 9 is the criterion. 10 : 16 is the control for #423's
 * lens: a renderer that never applied `verticalFieldOfViewDegrees` would draw
 * an upright frame on the 70° reference lens, where the rider fills 23 % of
 * the height rather than the 16 % the 90° stop gives — and the 16 : 9
 * measurement, where both lenses are the same lens, could not tell.
 */
function riderExtent(width: number, height: number): RiderExtent {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  // ⚠️ With the riders' shadows OFF since #426: this measures the RIDER's share
  // of the frame, and a blob on the road beside the wheels is not the rider.
  const view = threeGameRenderer.create(canvas, NO_RIDER_SHADOWS);
  view.resize(width, height);
  const profile = levelRoute();
  const start = atStartLine(profile);
  const frame = sceneFrame({
    profile,
    origin: corridorOrigin(profile),
    state: { ...start, ride: { ...start.ride, distance: metres(1_000) } },
  });
  const riderOnly: SceneFrame = {
    ...frame,
    scatter: [],
    markers: frame.markers.filter((marker) => marker.kind === 'rider'),
  };
  const nobody: SceneFrame = { ...frame, scatter: [], markers: [] };
  const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
  if (gl === null || riderOnly.markers.length !== 1) {
    view.destroy();
    return { ...NO_RIDER, aspect: width / height };
  }
  // Twice each, and only the second read: the first draw of a geometry uploads
  // it, and an upload can cost the frame it happens on.
  view.render(riderOnly);
  view.render(riderOnly);
  const present = readRegion(gl, 0, 0, width, height);
  view.render(nobody);
  view.render(nobody);
  const absent = readRegion(gl, 0, 0, width, height);
  view.destroy();

  let pixels = 0;
  let lowRow = height;
  let highRow = -1;
  let lowColumn = width;
  let highColumn = -1;
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      const at = (row * width + column) * 4;
      if (
        present[at] === absent[at] &&
        present[at + 1] === absent[at + 1] &&
        present[at + 2] === absent[at + 2]
      ) {
        continue;
      }
      pixels += 1;
      lowRow = Math.min(lowRow, row);
      highRow = Math.max(highRow, row);
      lowColumn = Math.min(lowColumn, column);
      highColumn = Math.max(highColumn, column);
    }
  }
  if (pixels === 0) {
    return { ...NO_RIDER, aspect: width / height };
  }
  // `readPixels` rows run from the BOTTOM, so the highest row is the top.
  return {
    aspect: width / height,
    top: 1 - (highRow + 1) / height,
    bottom: 1 - lowRow / height,
    left: lowColumn / width,
    right: (highColumn + 1) / width,
    pixels,
  };
}

/** What the harness reports for the line before it has measured one. */
const NO_LINE: LineMeasurement = { pixels: 0, centre: 0, topShift: 0 };

/**
 * The rider at the apex of a 20 m hairpin, **read back off the drawing
 * buffer** — #499's browser criterion: measurably off-centre, and measurably
 * rolled, with the same rider on the centreline and upright as the control.
 *
 * ⚠️ **Both are drawn through the CENTRELINE's camera.** The product's camera
 * follows the rider across the road (`scene.ts` §`cameraPose`), so through its
 * own camera a rider on the line is in the middle of the frame exactly as one
 * on the centreline is — which is the point of following them, and would make
 * "off-centre" unmeasurable. Holding the camera still is what turns the line
 * into pixels.
 *
 * The rider alone is isolated as `riderExtent` isolates it — the same frame
 * with and without them, and the pixels that differ — at 9 m/s, which at this
 * bend's apex is about 20° of lean.
 *
 * ⚠️ **The roll is measured against the SAME rider at the same place, drawn
 * upright — `onUpright` — and not against the centreline rider.** Seen 2.9 m
 * off to one side the bicycle is side-on to the camera by a third of a right
 * angle, so its wheels and its forward-leaning torso already put the top of
 * the silhouette off its bottom by an amount that has nothing to do with lean.
 * The first version of this compared against the centreline and read a 20°
 * lean as a shift of 0.4 % of the frame — smaller than the geometry it was
 * confounded with.
 */
function lineProbe(
  width: number,
  height: number,
): {
  readonly on: LineMeasurement;
  readonly onUpright: LineMeasurement;
  readonly off: LineMeasurement;
  readonly straightOn: LineMeasurement;
  readonly straightOff: LineMeasurement;
} {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const view = threeGameRenderer.create(canvas, NO_RIDER_SHADOWS);
  view.resize(width, height);
  const profile = hairpinRoute(20);
  const apex = 400 + (Math.PI * 20) / 2;
  const start = atStartLine(profile);
  const state = {
    ...start,
    ride: { speed: metresPerSecond(9), distance: metres(apex) },
  };
  const origin = corridorOrigin(profile);
  const onTheLine = sceneFrame({ profile, origin, state });
  const onTheCentre = sceneFrame({ profile, origin, state, centreline: true });
  const still = onTheCentre.camera;
  const riderOnly = (frame: SceneFrame): SceneFrame => ({
    ...frame,
    camera: still,
    scatter: [],
    markers: frame.markers.filter((marker) => marker.kind === 'rider'),
  });
  const nobody: SceneFrame = { ...onTheCentre, scatter: [], markers: [] };
  const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
  if (gl === null) {
    view.destroy();
    return {
      on: NO_LINE,
      onUpright: NO_LINE,
      off: NO_LINE,
      straightOn: NO_LINE,
      straightOff: NO_LINE,
    };
  }
  const drawn = (frame: SceneFrame): Uint8Array => {
    // Twice, and only the second read: `riderExtent` says why.
    view.render(frame);
    view.render(frame);
    return readRegion(gl, 0, 0, width, height);
  };
  let absent = drawn(nobody);
  const measured = (present: Uint8Array): LineMeasurement => {
    let pixels = 0;
    let columns = 0;
    const rows: { readonly row: number; readonly column: number }[] = [];
    for (let row = 0; row < height; row += 1) {
      for (let column = 0; column < width; column += 1) {
        const at = (row * width + column) * 4;
        if (
          present[at] === absent[at] &&
          present[at + 1] === absent[at + 1] &&
          present[at + 2] === absent[at + 2]
        ) {
          continue;
        }
        pixels += 1;
        columns += column;
        rows.push({ row, column });
      }
    }
    if (pixels === 0) {
      return NO_LINE;
    }
    let low = height;
    let high = -1;
    for (const each of rows) {
      low = Math.min(low, each.row);
      high = Math.max(high, each.row);
    }
    const third = (high - low + 1) / 3;
    const centreOf = (from: number, to: number): number => {
      let sum = 0;
      let count = 0;
      for (const each of rows) {
        if (each.row >= from && each.row < to) {
          sum += each.column;
          count += 1;
        }
      }
      return count === 0 ? 0 : sum / count;
    };
    // `readPixels` rows run from the BOTTOM, so the highest rows are the top.
    const top = centreOf(high + 1 - third, high + 1);
    const bottom = centreOf(low, low + third);
    return { pixels, centre: (columns / pixels + 0.5) / width, topShift: (top - bottom) / width };
  };
  const leaning = riderOnly(onTheLine);
  const on = measured(drawn(leaning));
  const onUpright = measured(
    drawn({ ...leaning, markers: leaning.markers.map((marker) => ({ ...marker, lean: 0 })) }),
  );
  const off = measured(drawn(riderOnly(onTheCentre)));

  // #546: on a straight, where #499's line put the rider on the dashed centre
  // line and the owner's ruling puts them on the right. Through the
  // centreline's camera again, so the road's middle is the frame's middle and
  // "right of it" is a side of the SCREEN — which is what `racing-line.ts`
  // §`ROAD_SIDE` claims and cannot show by itself. The control is the same
  // rider on the centreline, where #499 drew every straight.
  const straight = northRoute(1_000, () => 0);
  const straightState = {
    ...atStartLine(straight),
    ride: { speed: metresPerSecond(9), distance: metres(500) },
  };
  const straightOrigin = corridorOrigin(straight);
  const straightOnTheLine = sceneFrame({
    profile: straight,
    origin: straightOrigin,
    state: straightState,
  });
  const straightOnTheCentre = sceneFrame({
    profile: straight,
    origin: straightOrigin,
    state: straightState,
    centreline: true,
  });
  const straightStill = (frame: SceneFrame): SceneFrame => ({
    ...frame,
    camera: straightOnTheCentre.camera,
    scatter: [],
    markers: frame.markers.filter((marker) => marker.kind === 'rider'),
  });
  absent = drawn({ ...straightOnTheCentre, scatter: [], markers: [] });
  const straightOn = measured(drawn(straightStill(straightOnTheLine)));
  const straightOff = measured(drawn(straightStill(straightOnTheCentre)));
  view.destroy();
  return { on, onUpright, off, straightOn, straightOff };
}

/** What {@link bendProbe} reports when it did not run. */
const NO_BEND: BendMeasurement = { pixels: 0, nearCentre: 0, farCentre: 0 };

/**
 * Which way a bend turns on the screen — #583.
 *
 * `hairpinRoute(20)` turns toward the EAST: a right-hand bend on the map.
 * Until #583 the world put east on `+x`, which a right-handed renderer draws
 * on a northbound camera's LEFT, so this bend was drawn turning left — #546's
 * branch measured the apex rider at 22.1 % of the width, on the inside.
 *
 * ## The measure
 *
 * The rider 5 m short of the bend, through the CENTRELINE's camera (the
 * product's follows the rider across the road — {@link lineProbe} says why
 * that would move the frame). Only the road is drawn: the frame with and
 * without its index list, the pixels that differ being the road, which is
 * `loop-harness.ts` §`roadMask`'s isolation. The road's centre across its far
 * quarter of rows, against its centre across its near quarter, is which way it
 * goes: further right for a right-hand bend.
 *
 * ## The control
 *
 * The same hairpin mirrored east for west (`hairpinRoute(20, 'left')`). Drawn
 * by this build it is, point for point, what a build before #583 drew for the
 * right-hand one — the projection is the only thing #583 changed, and
 * mirroring the route is mirroring its input. `plan-agrees-with-world.test.ts`
 * pins that equivalence in the fast suite. It must read turning LEFT, or the
 * measure could not tell a mirrored world from a correct one.
 */
function bendProbe(
  width: number,
  height: number,
): { readonly right: BendMeasurement; readonly mirrored: BendMeasurement } {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const view = threeGameRenderer.create(canvas, NO_RIDER_SHADOWS);
  view.resize(width, height);
  const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
  if (gl === null) {
    view.destroy();
    return { right: NO_BEND, mirrored: NO_BEND };
  }
  const drawn = (frame: SceneFrame): Uint8Array => {
    // Twice, and only the second read: `riderExtent` says why.
    view.render(frame);
    view.render(frame);
    return readRegion(gl, 0, 0, width, height);
  };
  const measured = (profile: ReturnType<typeof hairpinRoute>): BendMeasurement => {
    const state = {
      ...atStartLine(profile),
      ride: { speed: metresPerSecond(9), distance: metres(395) },
    };
    const frame = sceneFrame({
      profile,
      origin: corridorOrigin(profile),
      state,
      centreline: true,
    });
    const road: SceneFrame = { ...frame, scatter: [], markers: [] };
    const present = drawn(road);
    const absent = drawn({ ...road, corridor: { ...road.corridor, indices: new Uint32Array(0) } });
    // `readPixels` rows run from the BOTTOM, so the first occupied rows are the near road.
    const rows: number[] = [];
    let pixels = 0;
    for (let row = 0; row < height; row += 1) {
      let low = -1;
      let high = -1;
      for (let column = 0; column < width; column += 1) {
        const at = (row * width + column) * 4;
        if (
          present[at] !== absent[at] ||
          present[at + 1] !== absent[at + 1] ||
          present[at + 2] !== absent[at + 2]
        ) {
          pixels += 1;
          if (low === -1) low = column;
          high = column;
        }
      }
      if (low !== -1) rows.push((low + high + 1) / 2 / width);
    }
    if (rows.length < 8) return NO_BEND;
    const quarter = Math.floor(rows.length / 4);
    const mean = (values: readonly number[]): number =>
      values.reduce((sum, value) => sum + value, 0) / values.length;
    return {
      pixels,
      nearCentre: mean(rows.slice(0, quarter)),
      farCentre: mean(rows.slice(rows.length - quarter)),
    };
  };
  const right = measured(hairpinRoute(20));
  const mirrored = measured(hairpinRoute(20, 'left'));
  view.destroy();
  return { right, mirrored };
}

/** What {@link nearFieldProbe} reports when it did not run. */
const NO_NEAR_FIELD: NearFieldMeasurement = {
  distance: Number.NaN,
  pivotMetres: Number.NaN,
  cut: [],
  shippedPixels: Number.NaN,
  controlPixels: Number.NaN,
  noisePixels: Number.NaN,
  world: '',
};

/**
 * How much nearer than it ships the control draws the near plane: half.
 *
 * Nearer than that and the depth buffer's precision — which goes as
 * `near / far` — starts to flicker the far road against the ground beside it,
 * and that reads here as a difference: at a tenth, about fifty pixels of a
 * frame with nothing near the eye at all. Half uncovers everything the shipped
 * plane cut between a quarter and half a metre from the eye.
 */
const CONTROL_NEAR_SHARE = 0.5;

/**
 * The closest pass of scenery to the camera on a ride, drawn — #545's second
 * criterion.
 *
 * ## The measure
 *
 * A frame is drawn with the near plane where it ships and again with it half
 * as far ({@link CONTROL_NEAR_SHARE}). The two differ ONLY where something
 * stood between the two planes — which is what the shipped plane cuts away. So
 * the count of pixels that differ is how much cut geometry the shipped frame
 * has: nought means none.
 *
 * ## Which frame
 *
 * A right-hand 300 m circuit (#583), ridden a metre at a time with the camera on the racing
 * line, in the REALISTIC world the owner saw it in, on an 8 : 1 canvas —
 * `near-field.test.ts` §`'the control frame'`'s aspect, wider than any the
 * stylesheet allows. ⚠️ **It was a 20 m hairpin at 6 : 1, the widest the
 * stylesheet allows, until #571**, which stood the scenery beside the drawn
 * road rather than the route: the conifer that reached a 6 : 1 plane inside
 * the hairpin stood 5.8 m from the drawn road's centreline, inside the 6.5 m
 * the scatter's verge keeps clear, and placed beside the ribbon nothing on any
 * fixture route reaches a 6 : 1 plane. At 8 : 1 the hairpin
 * still has a pass, but one whose uncut frame differs by 16 pixels, too few
 * for the control below to mean anything; the circuit's closest pass, a
 * signpost, differs by about 5 000. The frame is the
 * one where `near-field.ts` §`clearOfTheCamera`, asked with the renderer's own
 * loaded shapes, drops the most — the closest pass, and the only kind of frame
 * on which a green "nothing cut" could be wrong.
 *
 * ## The control
 *
 * The same frame with the cull off ({@link nearFieldOf}) must differ, and
 * plainly: that is the defect, drawn. Without it, a frame with nothing near the
 * eye, or a near plane the hook failed to move, would report "nothing cut" for
 * free. And the shipped frame drawn twice is the noise floor, so a renderer
 * that is never still cannot pass as a clean one.
 */
function nearFieldProbe(
  width: number,
  height: number,
  settings: QualitySettings,
): NearFieldMeasurement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const view = threeGameRenderer.create(canvas, settings);
  view.resize(width, height);
  const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
  if (gl === null) {
    view.destroy();
    return NO_NEAR_FIELD;
  }
  const world = drawnWorldOf(view);
  const shapes = nearFieldShapes(world);
  // ⚠️ The RIGHT-hand circuit since #583. The closest pass this probe was
  // written round — a signpost, about 5 000 pixels — was found on the circuit
  // as a build before #583 drew it, which was a mirror of its map: drawn the
  // right way round, the left-hand `circuitRoute` brings nothing to an 8 : 1
  // plane at all (`near-field.test.ts` §RIDES, measured), and this probe's
  // control would have nothing to show. The right-hand one is that drawing.
  const profile = circuitRoute(300, () => 20, 'right');
  const origin = corridorOrigin(profile);
  const start = atStartLine(profile);
  const inputAt = (distance: number): Parameters<typeof builtSceneFrame>[0] => ({
    profile,
    origin,
    state: { ...start, ride: { speed: metresPerSecond(8), distance: metres(distance) } },
  });
  let chosen: { distance: number; pivot: number; cut: readonly string[] } | undefined;
  for (let distance = 0; distance < profile.totalDistance; distance += 1) {
    const lent = lentSceneFrame(inputAt(distance));
    const rig = cameraRig(lent.camera);
    const kept = new Set(clearOfTheCamera(lent.scatter, rig, width / height, world, shapes));
    const dropped = lent.scatter.filter((item) => !kept.has(item));
    if (dropped.length === 0) continue;
    const pivot = Math.min(
      ...dropped.map((item) => Math.hypot(item.x - rig.eye.x, item.z - rig.eye.z)),
    );
    if (chosen === undefined || pivot < chosen.pivot) {
      chosen = { distance, pivot, cut: dropped.map((item) => item.kind) };
    }
  }
  if (chosen === undefined) {
    view.destroy();
    return NO_NEAR_FIELD;
  }
  // Only the scenery that COULD reach the plane — an item whose pivot is
  // further off in plan than its own reach (`near-field.ts` §`sceneryReach`)
  // plus the pyramid's cannot be cut. What stands further off is not neutral
  // to this measure: moving the near plane moves the depth buffer's precision
  // everywhere, and a far tree's foot against the ground changes by a few
  // pixels — eight, on the frame this probe picks, with nothing near the eye.
  const built = sceneFrame(inputAt(chosen.distance));
  const rig = cameraRig(built.camera);
  const pyramid = nearPyramid(rig, width / height);
  const frame: SceneFrame = {
    ...built,
    scatter: built.scatter.filter((item) => {
      const reach = sceneryReach(item.kind, world);
      const plan = Math.hypot(reach.x, Math.max(-reach.back, reach.front)) * item.scale;
      return Math.hypot(item.x - rig.eye.x, item.z - rig.eye.z) <= plan + pyramid.radius;
    }),
  };
  const drawn = (near: number, clear: boolean): Uint8Array => {
    nearFieldOf(view, near, clear);
    // Twice, and only the second read: `riderExtent` says why.
    view.render(frame);
    view.render(frame);
    return readRegion(gl, 0, 0, width, height);
  };
  const differing = (a: Uint8Array, b: Uint8Array): number =>
    compareRegions(a, b, width, height, 0, 0, width, height).changed;
  const shipped = drawn(NEAR_PLANE_METRES, true);
  const again = drawn(NEAR_PLANE_METRES, true);
  const shippedNear = drawn(NEAR_PLANE_METRES * CONTROL_NEAR_SHARE, true);
  const control = drawn(NEAR_PLANE_METRES, false);
  const controlNear = drawn(NEAR_PLANE_METRES * CONTROL_NEAR_SHARE, false);
  nearFieldOf(view, NEAR_PLANE_METRES, true);
  view.destroy();
  return {
    distance: chosen.distance,
    pivotMetres: chosen.pivot,
    cut: chosen.cut,
    shippedPixels: differing(shipped, shippedNear),
    controlPixels: differing(control, controlNear),
    noisePixels: differing(shipped, again),
    world,
  };
}

/**
 * Logs how long each phase of the run took — #644, which is what a load that
 * outgrew its budget needed and did not have. Each call closes the phase that
 * began at the previous one. `game.browser.spec.ts` prints each line as it
 * arrives, so a load its budget kills still says how far it got; it is never
 * asserted, because a timing assertion on a shared runner is a flake.
 */
let phaseStarted = performance.now();
function phaseEnds(name: string): void {
  const now = performance.now();
  console.info(`harness phase: ${name} ${((now - phaseStarted) / 1000).toFixed(1)} s`);
  phaseStarted = now;
}

/** What the harness reports for the world before a frame has produced one. */
const NO_WORLD: WorldStyle = {
  skyColour: 0,
  groundColour: 0,
  horizonColour: 0,
  fogDensity: 0,
  // Straight up and dark, which is the same reasoning the three colours above
  // use: no rider ever sees it, and a *plausible* sun here would let a spec
  // that stopped reading the real one go on passing.
  sun: { x: 0, y: 1, z: 0, ambient: 0, direct: 0 },
};

/** One pixel out of the drawing buffer, in readPixels coordinates (origin bottom left). */
function readPixel(
  gl: WebGL2RenderingContext | WebGLRenderingContext,
  x: number,
  y: number,
): Pixel {
  const pixels = new Uint8Array(4);
  gl.readPixels(Math.floor(x), Math.floor(y), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  return [pixels[0] ?? 0, pixels[1] ?? 0, pixels[2] ?? 0, pixels[3] ?? 0];
}

/**
 * Counts every GPU resource three creates, for the whole of `body`.
 *
 * ⚠️ This is how #241's *"no new mesh is allocated per frame"* is actually
 * checked, and it is a **stronger** claim than comparing object identities: an
 * implementation that rebuilt a mesh but reused the JavaScript wrapper would
 * satisfy an identity check and fail this one. three allocates a buffer or a
 * texture the first time it draws an object and never again while the object
 * lives, so a per-frame allocation shows up here as a count that keeps rising.
 *
 * The two creators are patched on the prototype rather than on one context,
 * because three obtains the context itself and the harness never sees it.
 */
function countingGpuResources(body: (resources: () => number) => void): void {
  const gl = WebGL2RenderingContext.prototype;
  // Unbound on purpose, and re-bound with `.call` below: a prototype patch has
  // to hold the original method separately from any instance, and every WebGL
  // context in the page shares this one.
  /* eslint-disable @typescript-eslint/unbound-method */
  const realCreateBuffer = gl.createBuffer;
  const realCreateTexture = gl.createTexture;
  /* eslint-enable @typescript-eslint/unbound-method */
  let created = 0;
  gl.createBuffer = function patchedCreateBuffer(this: WebGL2RenderingContext) {
    created += 1;
    return realCreateBuffer.call(this);
  };
  gl.createTexture = function patchedCreateTexture(this: WebGL2RenderingContext) {
    created += 1;
    return realCreateTexture.call(this);
  };
  try {
    body(() => created);
  } finally {
    gl.createBuffer = realCreateBuffer;
    gl.createTexture = realCreateTexture;
  }
}

/**
 * Counts every draw call the driver is asked for, for the whole of `body`.
 *
 * ⚠️ **#242's fifth criterion — "still one draw call for the road" — is a
 * claim about what a driver is asked to do, and this is the only place in the
 * repository that can watch.** A road split into three meshes would pass every
 * jsdom assertion about vertices and colours and quietly triple the cost of
 * the thing #240's NFR-2 says the budget is actually made of.
 *
 * Patched on the prototype for the reason above: three obtains its own context
 * and the harness never sees it. All four entry points are patched, not only
 * the indexed one, so a future mesh drawn some other way still counts.
 */
function countingDrawCalls(body: (calls: () => number) => void): void {
  const gl = WebGL2RenderingContext.prototype;
  const names = [
    'drawElements',
    'drawArrays',
    'drawElementsInstanced',
    'drawArraysInstanced',
  ] as const;
  const originals = new Map<string, (...args: never[]) => unknown>();
  let calls = 0;
  for (const name of names) {
    // Unbound on purpose, and re-bound with `.apply` below: a prototype patch
    // has to hold the original method separately from any instance, exactly as
    // `countingGpuResources` does.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const original: (...args: never[]) => unknown = gl[name];
    originals.set(name, original);
    (gl as unknown as Record<string, unknown>)[name] = function patched(
      this: WebGL2RenderingContext,
      ...args: never[]
    ): unknown {
      calls += 1;
      return original.apply(this, args);
    };
  }
  try {
    body(() => calls);
  } finally {
    for (const name of names) {
      (gl as unknown as Record<string, unknown>)[name] = originals.get(name);
    }
  }
}

/**
 * {@link countingDrawCalls}, counting only the calls that draw something — a
 * non-zero element count and, for an instanced call, a non-zero instance
 * count. three submits a mesh whose draw range is empty as a call of count
 * zero, which a plain count reads as a mesh that drew.
 */
function countingNonEmptyDrawCalls(body: (calls: () => number) => void): void {
  const gl = WebGL2RenderingContext.prototype;
  const counts: Record<string, (args: readonly number[]) => boolean> = {
    drawElements: (args) => (args[1] ?? 0) > 0,
    drawArrays: (args) => (args[2] ?? 0) > 0,
    drawElementsInstanced: (args) => (args[1] ?? 0) > 0 && (args[4] ?? 0) > 0,
    drawArraysInstanced: (args) => (args[2] ?? 0) > 0 && (args[3] ?? 0) > 0,
  };
  const originals = new Map<string, (...args: never[]) => unknown>();
  let calls = 0;
  for (const [name, drawsSomething] of Object.entries(counts)) {
    const original = (gl as unknown as Record<string, (...args: never[]) => unknown>)[name];
    if (original === undefined) continue;
    originals.set(name, original);
    (gl as unknown as Record<string, unknown>)[name] = function patched(
      this: WebGL2RenderingContext,
      ...args: never[]
    ): unknown {
      if (drawsSomething(args)) calls += 1;
      return original.apply(this, args);
    };
  }
  try {
    body(() => calls);
  } finally {
    for (const [name, original] of originals) {
      (gl as unknown as Record<string, unknown>)[name] = original;
    }
  }
}

/**
 * Runs `body` with a count of the **vertex indices** every draw call submitted.
 *
 * ⚠️ **Indices rather than draw calls, because #341 changes one and must not
 * change the other.** The belt draws one instanced call per kind whatever a
 * kind's shape is, so a call count is exactly the wrong instrument for asking
 * whether a model reached the driver — it is the number that has to stay
 * *unchanged*, and `drawCallsWithScatter` is where that is asserted. What a
 * model does change is how much geometry each of those calls carries.
 *
 * `count` is the element count of one instance, so an instanced call submits
 * `count × instanceCount`. The same prototype patch `countingDrawCalls` uses,
 * for the reason recorded there.
 */
function countingIndices(body: (indices: () => number) => void): void {
  const gl = WebGL2RenderingContext.prototype;
  const originals = new Map<string, (...args: never[]) => unknown>();
  let indices = 0;
  const submitted: Record<string, (args: readonly number[]) => number> = {
    // (mode, count, type, offset)
    drawElements: (args) => args[1] ?? 0,
    // (mode, count, type, offset, instanceCount)
    drawElementsInstanced: (args) => (args[1] ?? 0) * (args[4] ?? 0),
    // (mode, first, count)
    drawArrays: (args) => args[2] ?? 0,
    // (mode, first, count, instanceCount)
    drawArraysInstanced: (args) => (args[2] ?? 0) * (args[3] ?? 0),
  };
  for (const [name, count] of Object.entries(submitted)) {
    // Unbound on purpose and re-bound with `.apply` below, exactly as
    // `countingDrawCalls` does. Read through a `Record` index rather than by
    // property name, which is why no `unbound-method` exemption is needed here
    // and one is needed there.
    const original = (gl as unknown as Record<string, (...args: never[]) => unknown>)[name];
    if (original === undefined) {
      continue;
    }
    originals.set(name, original);
    (gl as unknown as Record<string, unknown>)[name] = function patched(
      this: WebGL2RenderingContext,
      ...args: never[]
    ): unknown {
      indices += count(args);
      return original.apply(this, args);
    };
  }
  try {
    body(() => indices);
  } finally {
    for (const name of Object.keys(submitted)) {
      (gl as unknown as Record<string, unknown>)[name] = originals.get(name);
    }
  }
}

/**
 * Runs `body` with a count of the triangles every draw call submitted, as
 * `realistic/draws.ts` counts them — #617, and #616's instrument on the
 * product's own page rather than only the owner's. Patched and restored for
 * `countingIndices`' reason.
 */
function countingTriangles(body: (triangles: () => number, calls: () => number) => void): void {
  const gl = WebGL2RenderingContext.prototype as unknown as Record<string, unknown>;
  const originals = new Map<string, (...args: unknown[]) => unknown>();
  let triangles = 0;
  // #639: the draw calls too, at the same entry points — #616's counter, as
  // the owner's page counts them (`realistic-harness.ts`).
  let calls = 0;
  for (const name of COUNTED_DRAWS) {
    const original = gl[name] as ((...args: unknown[]) => unknown) | undefined;
    if (original === undefined) continue;
    originals.set(name, original);
    gl[name] = function counted(this: unknown, ...args: unknown[]): unknown {
      triangles += trianglesInDraw(name, args);
      calls += 1;
      return original.apply(this, args);
    };
  }
  try {
    body(
      () => triangles,
      () => calls,
    );
  } finally {
    for (const [name, original] of originals) gl[name] = original;
  }
}

/**
 * How much geometry the scenery submits for one frame, kind by kind.
 *
 * ⚠️ **On a canvas of its own**, not the harness's: `GameView.destroy` releases
 * the context's resources, and building a second view over the wreckage of the
 * first is a way to measure something other than what is being asked about.
 *
 * Each kind is rendered alone, with the markers removed and the road left in —
 * the road draws the same indices every frame, so it cancels when the baseline
 * below is subtracted, and removing it would change the depth buffer the
 * scenery is drawn against. Each frame is drawn **twice** and only the second
 * is counted: three uploads a buffer the first time it draws a geometry, and
 * the upload is not a draw call but the shader compile that comes with it can
 * fail a frame outright.
 */
function sceneryIndicesByKind(frame: SceneFrame): Record<string, number> {
  const canvas = document.createElement('canvas');
  canvas.width = 600;
  canvas.height = 400;
  const counts: Record<string, number> = {};
  countingIndices((indices) => {
    const view = threeGameRenderer.create(canvas, qualitySettings(0));
    view.resize(600, 400);
    const only = (kind: SceneryKind | null): SceneFrame => ({
      ...frame,
      markers: [],
      scatter: kind === null ? [] : frame.scatter.filter((item) => item.kind === kind),
    });
    const drawnBy = (kind: SceneryKind | null): number => {
      view.render(only(kind));
      const before = indices();
      view.render(only(kind));
      return indices() - before;
    };
    const road = drawnBy(null);
    for (const kind of SCENERY_KINDS) {
      counts[kind] = drawnBy(kind) - road;
    }
    view.destroy();
  });
  return counts;
}

/**
 * One scenery item placed in front of the camera, in the rider's own frame.
 *
 * ⚠️ **Nothing about *placement* may be read off a frame built this way**: the
 * belt is handed a `SceneFrame` and does not know who built it, which is the
 * property being used here. Where `scatter.ts` really puts things is
 * `arrangement-unchanged.test.ts`, on the real route, in jsdom.
 */
function placedAhead(
  pose: CameraPose,
  kind: SceneryKind,
  variant: number,
  along: number,
  across: number,
): ScatterItem {
  return {
    kind,
    x: pose.x + along * pose.headingX + across * pose.headingZ,
    y: pose.y,
    z: pose.z + along * pose.headingZ - across * pose.headingX,
    rotation: 0,
    scale: 1,
    variant,
  };
}

/**
 * Counts every WebGL texture created for the whole of `body` — #366.
 *
 * Narrower than {@link countingGpuResources} on purpose: that one counts
 * buffers too, and a buffer count that moves for an unrelated reason would make
 * *"no texture reaches the GPU"* unreadable. Patched on the prototype for the
 * reason every counter here is — three obtains its own context and the harness
 * never sees it.
 */
function countingTextures(body: (textures: () => number) => void): void {
  const gl = WebGL2RenderingContext.prototype;
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const real = gl.createTexture;
  let created = 0;
  gl.createTexture = function patchedCreateTexture(this: WebGL2RenderingContext) {
    created += 1;
    return real.call(this);
  };
  try {
    body(() => created);
  } finally {
    gl.createTexture = real;
  }
}

/** Which channel leads in each pixel of a region, counted. @see treeRedPixels */
function channelLead(
  present: Uint8Array,
  absent: Uint8Array,
): { readonly red: number; readonly green: number; readonly blue: number } {
  let red = 0;
  let green = 0;
  let blue = 0;
  for (let at = 0; at + 3 < present.length; at += 4) {
    // Only where the object actually is: a pixel identical to the frame drawn
    // without it is sky, ground or road, and counting those would make every
    // count a property of the background.
    if (
      present[at] === absent[at] &&
      present[at + 1] === absent[at + 1] &&
      present[at + 2] === absent[at + 2]
    ) {
      continue;
    }
    const r = present[at] ?? 0;
    const g = present[at + 1] ?? 0;
    const b = present[at + 2] ?? 0;
    // ⚠️ **A strict lead, by a margin.** A near-grey pixel has a nominal
    // leader that is one byte of dither, and counting those would let a scene
    // drawn entirely in one flat colour satisfy two of these three at once.
    const margin = 8;
    if (r >= g + margin && r >= b + margin) {
      red += 1;
    } else if (g >= r + margin && g >= b + margin) {
      green += 1;
    } else if (b >= r + margin && b >= g + margin) {
      blue += 1;
    }
  }
  return { red, green, blue };
}

/** The mean colour of the pixels an object covers, and how many there are. */
function meanOver(
  present: Uint8Array,
  absent: Uint8Array,
): { readonly mean: Pixel; readonly pixels: number } {
  let red = 0;
  let green = 0;
  let blue = 0;
  let pixels = 0;
  for (let at = 0; at + 3 < present.length; at += 4) {
    if (
      present[at] === absent[at] &&
      present[at + 1] === absent[at + 1] &&
      present[at + 2] === absent[at + 2]
    ) {
      continue;
    }
    red += present[at] ?? 0;
    green += present[at + 1] ?? 0;
    blue += present[at + 2] ?? 0;
    pixels += 1;
  }
  if (pixels === 0) {
    return { mean: NOWHERE, pixels: 0 };
  }
  return {
    mean: [Math.round(red / pixels), Math.round(green / pixels), Math.round(blue / pixels), 255],
    pixels,
  };
}

/**
 * What each variant of each kind costs in vertex indices — #367.
 *
 * ⚠️ **Per variant, which is what {@link sceneryIndicesByKind} cannot say.**
 * That one filters the frame by *kind*, so a kind with three shapes reports the
 * sum of whatever the frame held — and a belt that had quietly collapsed every
 * variant onto one geometry would report the same total. Filtering by the pair
 * gives one number per mesh, and two numbers that are equal are two variants
 * drawing the same thing.
 */
function variantIndicesByKind(frame: SceneFrame): Record<string, readonly number[]> {
  const canvas = document.createElement('canvas');
  canvas.width = 600;
  canvas.height = 400;
  const counts: Record<string, readonly number[]> = {};
  countingIndices((indices) => {
    const view = threeGameRenderer.create(canvas, qualitySettings(0));
    view.resize(600, 400);
    const only = (kind: SceneryKind | null, variant: number): SceneFrame => ({
      ...frame,
      markers: [],
      scatter:
        kind === null
          ? []
          : frame.scatter.filter((item) => item.kind === kind && item.variant === variant),
    });
    const drawnBy = (kind: SceneryKind | null, variant: number): number => {
      view.render(only(kind, variant));
      const before = indices();
      view.render(only(kind, variant));
      return indices() - before;
    };
    const road = drawnBy(null, 0);
    for (const kind of SCENERY_KINDS) {
      counts[kind] = Array.from(
        { length: SCATTER_VARIANT_SLOTS },
        (_, slot) => drawnBy(kind, slot) - road,
      );
    }
    view.destroy();
  });
  return counts;
}

/**
 * How many draw calls the scenery costs at each `sceneryVariants` rung — #367.
 *
 * ⚠️ **The difference between the frame and the same frame with no scenery**,
 * rather than the whole frame's count, so the ground, the road and the riders
 * are subtracted at every rung and what is left is the belt's own width. That
 * width is the number this issue is about: #240's NFR-2 names draw calls first,
 * and #367's own framing is that a variant is one more of them.
 */
function sceneryCallsAcrossRungs(frame: SceneFrame): readonly number[] {
  const canvas = document.createElement('canvas');
  canvas.width = 600;
  canvas.height = 400;
  let found: readonly number[] = [];
  countingDrawCalls((calls) => {
    const view = threeGameRenderer.create(canvas, qualitySettings(0));
    view.resize(600, 400);
    const bare: SceneFrame = { ...frame, scatter: [] };
    found = [3, 2, 1].map((variants) => {
      view.setQuality({ ...qualitySettings(0), sceneryVariants: variants });
      // Drawn once first at each rung: three compiles a program and allocates
      // an instance buffer the first time it draws a mesh, and neither is a
      // draw call — but the rung above may have left a mesh it never touched.
      view.render(frame);
      view.render(bare);
      const beforeBare = calls();
      view.render(bare);
      const bareCalls = calls() - beforeBare;
      const beforeFull = calls();
      view.render(frame);
      return calls() - beforeFull - bareCalls;
    });
    view.destroy();
  });
  return found;
}

/**
 * #458's first criterion, read off pixels: *"the ground beside the road is
 * higher than the rider's road level on the climb and lower on the descent —
 * with a control: the flat-quad ground must fail the same assertion."*
 *
 * ## How a height is read off a picture
 *
 * By **occlusion**, which is the one thing about a height a drawing buffer
 * states outright. A block is stood 14 m to the left of the road and 40 m
 * ahead of the rider, and the pixels it changes are counted:
 *
 * - **On the climb** it stands from 1.5 m below the rider's road level to about
 *   half a metre above it, and it is hidden — so the ground there is higher
 *   than the rider's road. The
 *   same block lifted 5 m clear of that hillside is drawn, which is what says
 *   the zero is the hill and not a block that was never on screen.
 * - **On the descent** its base is 2.5 m BELOW the rider's road level and it
 *   is drawn — so the ground there is lower still.
 *
 * ## The control, and what it is
 *
 * The same two blocks over **the flat quad's geometry**: a level plane 0.25 m
 * under the rider, put through the same renderer in place of the landform.
 * On the climb the block's top stands above it and is drawn, and on the
 * descent the plane hides what the landform shows — so the pair of
 * assertions fails, which is the criterion's control. Measured: 87 px and
 * 0 px, against the landform's 0 px and 266 px. ⚠️ The quad as it
 * shipped also wrote NO depth, which could only make it hide less, so a plane
 * that does write depth is the stronger version of it rather than a weaker
 * one.
 *
 * On its own canvas, for {@link sceneryIndicesByKind}'s reason.
 */
function gradientProbe(): GradientMeasurement {
  const canvas = document.createElement('canvas');
  canvas.width = 600;
  canvas.height = 400;
  const view = threeGameRenderer.create(canvas, NO_RIDER_SHADOWS);
  view.resize(600, 400);
  const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
  const profile = hillRoute();
  const origin = corridorOrigin(profile);
  const start = atStartLine(profile);
  const riding = (distance: number): SceneFrame => {
    const frame = sceneFrame({
      profile,
      origin,
      state: { ...start, ride: { ...start.ride, distance: metres(distance) } },
    });
    return { ...frame, markers: [], scatter: [] };
  };
  /** The flat quad's geometry: every vertex of the landform on a level plane under the rider. */
  const flattened = (frame: SceneFrame): SceneFrame => {
    const vertices = Float32Array.from(frame.terrain.mesh.vertices);
    const normals = new Float32Array(vertices.length);
    for (let at = 0; at < vertices.length; at += 3) {
      vertices[at + 1] = frame.camera.y - 0.25;
      normals[at + 1] = 1;
    }
    return {
      ...frame,
      terrain: { ...frame.terrain, mesh: { ...frame.terrain.mesh, vertices, normals } },
    };
  };
  /** A block 14 m left of the road, 40 m up it, its base `base` metres from the rider's road. */
  const block = (frame: SceneFrame, base: number): ScatterItem => ({
    ...placedAhead(frame.camera, 'building', 0, 40, -14),
    y: frame.camera.y + base,
    scale: 0.35,
  });
  const changed = (frame: SceneFrame, base: number): number => {
    if (gl === null) return 0;
    const bare = frame;
    const withBlock: SceneFrame = { ...frame, scatter: [block(frame, base)] };
    view.render(bare);
    view.render(bare);
    const absent = readRegion(gl, 0, 0, canvas.width, canvas.height);
    view.render(withBlock);
    view.render(withBlock);
    const present = readRegion(gl, 0, 0, canvas.width, canvas.height);
    return shadingAcross(present, absent).pixels;
  };
  // 100 m into the climb and 100 m into the descent: 40 m on is still on it.
  const climb = riding(400);
  const descent = riding(900);
  // The hills on the horizon, by difference: the same level frame with the
  // ridge sunk to its own foot, which is below the horizon, draws none.
  const level = riding(100);
  const sunk: SceneFrame = {
    ...level,
    terrain: {
      ...level.terrain,
      horizon: {
        ...level.terrain.horizon,
        tops: new Float32Array(level.terrain.horizon.tops.length).fill(level.terrain.horizon.foot),
      },
    },
  };
  let horizonPixels = 0;
  if (gl !== null) {
    view.render(sunk);
    view.render(sunk);
    const without = readRegion(gl, 0, 0, canvas.width, canvas.height);
    view.render(level);
    view.render(level);
    horizonPixels = shadingAcross(
      readRegion(gl, 0, 0, canvas.width, canvas.height),
      without,
    ).pixels;
  }
  // ------------------------------------------------ the sky — #425
  const skyPoint = (frame: SceneFrame, degrees: number) => {
    const { eye } = cameraRig(frame.camera);
    const far = 1_500;
    return pixelFor(frame, canvas, {
      x: eye.x + frame.camera.headingX * far,
      y: eye.y + far * Math.tan((degrees * Math.PI) / 180),
      z: eye.z + frame.camera.headingZ * far,
    });
  };
  const flatSky: SceneFrame = {
    ...level,
    world: { ...level.world, horizonColour: level.world.skyColour },
  };
  const skyAt = (frame: SceneFrame): readonly [Pixel, Pixel] => {
    if (gl === null) return [NOWHERE, NOWHERE];
    view.render(frame);
    view.render(frame);
    const high = skyPoint(frame, 25);
    const low = skyPoint(frame, 8);
    return [readPixel(gl, high.x, high.y), readPixel(gl, low.x, low.y)];
  };
  const [skyHigh, skyLow] = skyAt(level);
  const [flatSkyHigh, flatSkyLow] = skyAt(flatSky);

  // -------------------------------- the road's and ground's detail — #425
  const patchSpread = (frame: SceneFrame, ahead: number, across: number): number => {
    if (gl === null) return 0;
    view.render(frame);
    view.render(frame);
    // Clear of the centre line and the edge line — a patch of carriageway
    // alone, whose one vertex colour made it flat before #425.
    const centre = pixelFor(frame, canvas, onTheRoad(frame, ahead, across));
    const region = readRegion(gl, Math.floor(centre.x) - 7, Math.floor(centre.y) - 6, 14, 12);
    const levels: number[] = [];
    for (let at = 0; at + 3 < region.length; at += 4) {
      levels.push(luminanceOf([region[at] ?? 0, region[at + 1] ?? 0, region[at + 2] ?? 0, 255]));
    }
    const mean = levels.reduce((sum, each) => sum + each, 0) / levels.length;
    // The standard deviation, in levels: a patch of one colour reads nought.
    return Math.sqrt(levels.reduce((sum, each) => sum + (each - mean) ** 2, 0) / levels.length);
  };
  view.setQuality({ ...NO_RIDER_SHADOWS, surfaceDetail: true });
  const roadSpreadDetailed = patchSpread(level, 16, 1.8);
  const groundDetailed =
    gl === null
      ? undefined
      : (view.render(level), view.render(level), readRegion(gl, 0, 0, canvas.width, canvas.height));
  // ------------------------- the patchwork on lap three — #468 review B3
  // A level loop, so nothing but the lap can differ between the two frames.
  const circuit = circuitRoute(400, () => 20);
  const circuitOrigin = corridorOrigin(circuit);
  const circuitStart = atStartLine(circuit);
  const onCircuit = (odometer: number): SceneFrame => {
    const frame = sceneFrame({
      profile: circuit,
      origin: circuitOrigin,
      state: { ...circuitStart, ride: { ...circuitStart.ride, distance: metres(odometer) } },
    });
    return { ...frame, markers: [], scatter: [] };
  };
  /** The first head's patchwork: a field count no lap reaches wraps nothing. */
  const unwrapped = (frame: SceneFrame): SceneFrame => ({
    ...frame,
    terrain: { ...frame.terrain, mesh: { ...frame.terrain.mesh, fieldCount: 1e9 } },
  });
  const whole = (frame: SceneFrame): Uint8Array | undefined => {
    if (gl === null) return undefined;
    view.render(frame);
    view.render(frame);
    return readRegion(gl, 0, 0, canvas.width, canvas.height);
  };
  const lapsApart = (first: SceneFrame, third: SceneFrame): number => {
    const one = whole(first);
    const three = whole(third);
    return one === undefined || three === undefined ? 0 : shadingAcross(three, one).pixels;
  };
  const lapOne = onCircuit(600);
  const lapThree = onCircuit(600 + 2 * circuit.totalDistance);
  const lapChanged = lapsApart(lapOne, lapThree);
  const lapChangedUnwrapped = lapsApart(unwrapped(lapOne), unwrapped(lapThree));
  view.setQuality({ ...NO_RIDER_SHADOWS, surfaceDetail: false });
  const roadSpreadPlain = patchSpread(level, 16, 1.8);
  const groundPlain =
    gl === null
      ? undefined
      : (view.render(level), view.render(level), readRegion(gl, 0, 0, canvas.width, canvas.height));
  const groundChangedByDetail =
    groundDetailed === undefined || groundPlain === undefined
      ? 0
      : shadingAcross(groundDetailed, groundPlain).pixels;
  view.setQuality(NO_RIDER_SHADOWS);

  const measured = {
    skyHigh,
    skyLow,
    flatSkyHigh,
    flatSkyLow,
    roadSpreadDetailed,
    roadSpreadPlain,
    groundChangedByDetail,
    lapChanged,
    lapChangedUnwrapped,
    horizonPixels,
    climbBuried: changed(climb, -1.5),
    climbLifted: changed(climb, 9),
    descentBelow: changed(descent, -2.5),
    flatClimbBuried: changed(flattened(climb), -1.5),
    flatDescentBelow: changed(flattened(descent), -2.5),
    terrainVertices: climb.terrain.mesh.vertices.length / 3,
    terrainIndices: climb.terrain.mesh.indices.length,
    terrainIndicesByRung: QUALITY_LADDER.map((rung) =>
      Math.min(
        climb.terrain.mesh.indices.length,
        rung.terrainBands * climb.terrain.mesh.indicesPerBand,
      ),
    ),
  };
  view.destroy();
  return measured;
}

/** What {@link gradientProbe} reports when it did not run. */
const NO_GRADIENT: GradientMeasurement = {
  skyHigh: NOWHERE,
  skyLow: NOWHERE,
  flatSkyHigh: NOWHERE,
  flatSkyLow: NOWHERE,
  roadSpreadDetailed: 0,
  roadSpreadPlain: 0,
  groundChangedByDetail: 0,
  lapChanged: 0,
  lapChangedUnwrapped: 0,
  horizonPixels: 0,
  climbBuried: -1,
  climbLifted: 0,
  descentBelow: 0,
  flatClimbBuried: -1,
  flatDescentBelow: 0,
  terrainVertices: 0,
  terrainIndices: 0,
  terrainIndicesByRung: [],
};

/**
 * #459's fourth criterion, off pixels: *"the browser gate reads a water pixel
 * under the bridge and proves the road deck is drawn above it"*.
 *
 * The rider is 40 m short of the valley route's bridge. Two points are probed,
 * each with the water drawn and without it:
 *
 * - **beside the bridge**, on the stream 20 m out from the road: the water is
 *   drawn there, so taking it away changes the pixel;
 * - **on the deck**, over the stream's centre: the ROAD is drawn there, above
 *   the water, so taking the water away changes nothing — and taking the ROAD
 *   away shows water, which is what says the water really is under the deck
 *   rather than absent from it.
 *
 * Draw calls and the shader's cost are published, the frame timed with the
 * water shaded and flat.
 */
function waterProbe(): WaterMeasurement {
  const canvas = document.createElement('canvas');
  canvas.width = 600;
  canvas.height = 400;
  const profile = valleyRoute();
  const origin = corridorOrigin(profile);
  const ways = waterways(profile, scatterSeed(profile));
  const crossing = ways.crossings[0]?.distance ?? 1_000;
  const start = atStartLine(profile);
  const riding = (distance: number): SceneFrame => {
    const frame = sceneFrame({
      profile,
      origin,
      state: { ...start, ride: { ...start.ride, distance: metres(distance) } },
    });
    return { ...frame, markers: [], scatter: [] };
  };
  const frame = riding(crossing - 40);
  const dry: SceneFrame = {
    ...frame,
    water: {
      ...frame.water,
      surface: { ...frame.water.surface, indices: new Uint32Array(0) },
      bridges: [],
    },
  };
  // The road AND the bridge's slab under it taken out: what is beneath the deck.
  const noRoad: SceneFrame = {
    ...frame,
    corridor: { ...frame.corridor, indices: new Uint32Array(0) },
    water: { ...frame.water, bridges: [] },
  };
  // The route runs due north from its origin: x is across it, z along it.
  const water = (ways.crossings[0]?.waterElevation ?? 0) - origin.elevation;
  const deckY = elevationAt(profile, crossing) - origin.elevation;
  const empty: WaterMeasurement = {
    crossings: ways.crossings.length + ways.lakes.length,
    beside: NOWHERE,
    besideDry: NOWHERE,
    deck: NOWHERE,
    deckDry: NOWHERE,
    underDeck: NOWHERE,
    drawCalls: 0,
    drawCallsDry: 0,
    shadedMs: 0,
    flatMs: 0,
    rippleBanding: 0,
    rippleBandingUnfiltered: 0,
    ripplePairs: 0,
  };
  let measured = empty;
  countingDrawCalls((calls) => {
    const view = threeGameRenderer.create(canvas, NO_RIDER_SHADOWS);
    view.resize(600, 400);
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    if (gl === null) {
      view.destroy();
      return;
    }
    const besideAt = pixelFor(frame, canvas, { x: -20, y: water, z: crossing });
    const deckAt = pixelFor(frame, canvas, { x: 1.5, y: deckY, z: crossing });
    const read = (scene: SceneFrame): readonly [Pixel, Pixel, number] => {
      view.render(scene);
      const before = calls();
      view.render(scene);
      const drawn = calls() - before;
      return [readPixel(gl, besideAt.x, besideAt.y), readPixel(gl, deckAt.x, deckAt.y), drawn];
    };
    const [beside, deck, drawCalls] = read(frame);
    const [besideDry, deckDry, drawCallsDry] = read(dry);
    const [, underDeck] = read(noRoad);
    // #501: the banding, off the whole frame. The water is wherever drawing
    // it changed the pixel, with the band-limit on or off.
    const whole = (scene: SceneFrame): Uint8Array => {
      view.render(scene);
      view.render(scene);
      return readRegion(gl, 0, 0, canvas.width, canvas.height);
    };
    const withoutWater = whole(dry);
    const filtered = whole(frame);
    filterWaterRipplesOf(view, false);
    const unfiltered = whole(frame);
    filterWaterRipplesOf(view, true);
    const banding = rippleBanding(filtered, unfiltered, withoutWater, canvas.width);
    const timed = (settings: QualitySettings): number => {
      view.setQuality(settings);
      for (let index = 0; index < 5; index += 1) view.render(frame);
      awaitTheGpu(gl);
      const started = performance.now();
      for (let index = 0; index < SHADING_FRAMES; index += 1) {
        view.render({ ...frame, water: { ...frame.water, seconds: index / 30 } });
      }
      awaitTheGpu(gl);
      return (performance.now() - started) / SHADING_FRAMES;
    };
    const shaded = { ...NO_RIDER_SHADOWS, water: 'shaded' as const };
    const flat = { ...NO_RIDER_SHADOWS, water: 'flat' as const };
    // Alternating, for the reason `run` alternates the shading rounds: what
    // the machine does at the start of a round is charged to both.
    const rounds = [timed(shaded), timed(flat), timed(flat), timed(shaded)];
    measured = {
      ...empty,
      beside,
      besideDry,
      deck,
      deckDry,
      underDeck,
      drawCalls,
      drawCallsDry,
      shadedMs: ((rounds[0] ?? 0) + (rounds[3] ?? 0)) / 2,
      flatMs: ((rounds[1] ?? 0) + (rounds[2] ?? 0)) / 2,
      rippleBanding: banding.filtered,
      rippleBandingUnfiltered: banding.unfiltered,
      ripplePairs: banding.pairs,
    };
    view.destroy();
  });
  return measured;
}

/**
 * #501: the banding validation 0002 Z10 found on the stream, as a number —
 * the mean squared difference in luminance between a water pixel and the one
 * directly above it, over every such pair that is water in both frames.
 *
 * ⚠️ **Vertical neighbours, because the bands are horizontal**: a ripple finer
 * than a pixel at a grazing angle aliases into stripes across the screen, so
 * one row disagrees with the next. Water is where drawing it changed the pixel
 * in BOTH frames, so the two figures are over the same pixels.
 */
function rippleBanding(
  filtered: Uint8Array,
  unfiltered: Uint8Array,
  dry: Uint8Array,
  width: number,
): { readonly filtered: number; readonly unfiltered: number; readonly pairs: number } {
  const luma = (pixels: Uint8Array, at: number): number =>
    0.2126 * (pixels[at] ?? 0) + 0.7152 * (pixels[at + 1] ?? 0) + 0.0722 * (pixels[at + 2] ?? 0);
  const water = (at: number): boolean =>
    [filtered, unfiltered].every(
      (pixels) =>
        pixels[at] !== dry[at] || pixels[at + 1] !== dry[at + 1] || pixels[at + 2] !== dry[at + 2],
    );
  let pairs = 0;
  let on = 0;
  let off = 0;
  const row = width * 4;
  for (let at = 0; at + row < filtered.length; at += 4) {
    if (!water(at) || !water(at + row)) continue;
    pairs += 1;
    on += (luma(filtered, at) - luma(filtered, at + row)) ** 2;
    off += (luma(unfiltered, at) - luma(unfiltered, at + row)) ** 2;
  }
  return pairs === 0
    ? { filtered: 0, unfiltered: 0, pairs }
    : { filtered: on / pairs, unfiltered: off / pairs, pairs };
}

/**
 * #460: a village and its walled fields, on level farmland, 60 m short of the
 * first house. The structures are drawn — the pixels they change against the
 * same frame without them — and the frame is timed both ways, which is the
 * browser's half of "frame time with the new kinds on"; the phone's is
 * validation 0002 Part X.
 */
function settlementProbe(): SettlementMeasurement {
  const canvas = document.createElement('canvas');
  canvas.width = 600;
  canvas.height = 400;
  const profile = northRouteForHarness();
  const origin = corridorOrigin(profile);
  const seed = scatterSeed(profile);
  const firstHouse = structuresAt(profile, origin, seed, 0, profile.totalDistance, {
    maxItems: 100_000,
    riderMetres: 0,
  }).find((item) => item.kind === 'building');
  const start = atStartLine(profile);
  const frame = sceneFrame({
    profile,
    origin,
    state: {
      ...start,
      ride: { ...start.ride, distance: metres(Math.max(0, (firstHouse?.z ?? 500) - 60)) },
    },
  });
  const structural = new Set<string>(STRUCTURE_KINDS);
  const bare: SceneFrame = {
    ...frame,
    scatter: frame.scatter.filter((item) => !structural.has(item.kind)),
  };
  const built = frame.scatter.filter((item) => structural.has(item.kind));
  let measured: SettlementMeasurement = {
    structures: built.length,
    kinds: new Set(built.map((item) => item.kind)).size,
    pixels: 0,
    drawCalls: 0,
    drawCallsBare: 0,
    withMs: 0,
    withoutMs: 0,
  };
  countingDrawCalls((calls) => {
    const view = threeGameRenderer.create(canvas, NO_RIDER_SHADOWS);
    view.resize(600, 400);
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    if (gl === null) {
      view.destroy();
      return;
    }
    const drawn = (scene: SceneFrame): readonly [Uint8Array, number] => {
      view.render(scene);
      const before = calls();
      view.render(scene);
      return [readRegion(gl, 0, 0, canvas.width, canvas.height), calls() - before];
    };
    const [present, drawCalls] = drawn(frame);
    const [absent, drawCallsBare] = drawn(bare);
    const timed = (scene: SceneFrame): number => {
      for (let index = 0; index < 5; index += 1) view.render(scene);
      awaitTheGpu(gl);
      const started = performance.now();
      for (let index = 0; index < SHADING_FRAMES; index += 1) view.render(scene);
      awaitTheGpu(gl);
      return (performance.now() - started) / SHADING_FRAMES;
    };
    const rounds = [timed(frame), timed(bare), timed(bare), timed(frame)];
    measured = {
      ...measured,
      pixels: shadingAcross(present, absent).pixels,
      drawCalls,
      drawCallsBare,
      withMs: ((rounds[0] ?? 0) + (rounds[3] ?? 0)) / 2,
      withoutMs: ((rounds[1] ?? 0) + (rounds[2] ?? 0)) / 2,
    };
    view.destroy();
  });
  return measured;
}

/** Six kilometres of level, low farmland — somewhere a village stands. */
function northRouteForHarness(): ReturnType<typeof routeProfile> {
  return northRoute(6_000, () => 40);
}

/** What {@link settlementProbe} reports when it did not run. */
const NO_SETTLEMENT: SettlementMeasurement = {
  structures: 0,
  kinds: 0,
  pixels: 0,
  drawCalls: 0,
  drawCallsBare: 0,
  withMs: 0,
  withoutMs: 0,
};

/** What {@link waterProbe} reports when it did not run. */
const NO_WATER: WaterMeasurement = {
  crossings: 0,
  beside: NOWHERE,
  besideDry: NOWHERE,
  deck: NOWHERE,
  deckDry: NOWHERE,
  underDeck: NOWHERE,
  drawCalls: 0,
  drawCallsDry: 0,
  shadedMs: 0,
  flatMs: 0,
  rippleBanding: 0,
  rippleBandingUnfiltered: 0,
  ripplePairs: 0,
};

/** What one rider's silhouette looks like, drawn alone. @see colourProbes */
interface RiderProbe {
  readonly mean: Pixel;
  readonly pixels: number;
}

/**
 * The colour claims of #366 and #368, read back off a drawing buffer.
 *
 * ⚠️ **Its own canvas and its own view**, for the reason the model measurement
 * above has one: everything here needs several renders of frames that are not
 * the sweep's, and reusing the sweep's view would leave its counters holding
 * them.
 */
function colourProbes(probe: SceneFrame): {
  readonly texturesCreated: number;
  readonly texturesBaseline: number;
  readonly treeRed: number;
  readonly treeGreen: number;
  readonly buildingGreen: number;
  readonly buildingBlue: number;
  readonly riders: Readonly<Record<string, RiderProbe>>;
  readonly riderBuriedPixels: number;
  readonly botCrankPixels: number;
  readonly contactShadowPixels: Readonly<Record<string, number>>;
  readonly contactShadowLuminance: Readonly<Record<string, readonly [number, number]>>;
  readonly contactShadowNoise: number;
} {
  const canvas = document.createElement('canvas');
  canvas.width = 600;
  canvas.height = 400;
  let treeRed = 0;
  let treeGreen = 0;
  let buildingGreen = 0;
  let buildingBlue = 0;
  let botCrankPixels = 0;
  let riderBuriedPixels = 0;
  const riders: Record<string, RiderProbe> = {};
  let textures = 0;
  let baselineTextures = 0;
  let contactShadowNoise = 0;
  const contactShadowPixels: Record<string, number> = {};
  const contactShadowLuminance: Record<string, readonly [number, number]> = {};
  countingTextures((counted) => {
    // ⚠️ Shadows OFF for the colour claims (#426): a rider's mean silhouette
    // colour is the rider's, and a blob of darkened road around the wheels
    // would be averaged into it. They are turned on below, for the shadow's own.
    const view = threeGameRenderer.create(canvas, NO_RIDER_SHADOWS);
    view.resize(600, 400);
    const gl = canvas.getContext('webgl2');
    const whole = () =>
      gl === null ? new Uint8Array(0) : readRegion(gl, 0, 0, canvas.width, canvas.height);
    // ⚠️ **Baselined against a frame with nothing in it, not against zero.**
    // three allocates four textures of its own the first time it renders
    // anything at all — a 1 × 1 for each of the 2D, array, 3D and cube
    // samplers its default uniforms declare — and they exist whether or not
    // this program has an image anywhere. What #366's fourth criterion is
    // about is whether the **scenery** adds one, so the baseline is taken
    // after the first frame and what is published is the difference.
    view.render({ ...probe, markers: [], scatter: [] });
    const baseline = counted();
    baselineTextures = baseline;

    // ⚠️ **One kind at a time, close enough to fill a good share of the
    // frame.** The probe frame's own items are 40 m to 115 m up the road, which
    // is a few hundred pixels between them; a colour read off that would be
    // mostly fog. Each is moved to 12 m and scaled up, which changes nothing
    // about what colour it is.
    const pose = probe.camera;
    const closeUp = (kind: SceneryKind): SceneFrame => ({
      ...probe,
      markers: [],
      scatter: [{ ...placedAhead(pose, kind, 0, 14, 0), scale: 1.4 }],
    });
    const empty: SceneFrame = { ...probe, markers: [], scatter: [] };
    view.render(empty);
    const nothing = whole();
    view.render(closeUp('tree-broadleaf'));
    const tree = channelLead(whole(), nothing);
    treeRed = tree.red;
    treeGreen = tree.green;
    view.render(closeUp('building'));
    const building = channelLead(whole(), nothing);
    buildingGreen = building.green;
    buildingBlue = building.blue;

    // ------------------------------------------------ the riders — #368
    //
    // ⚠️ **Each alone, at the same place, on the same frame**, so the only
    // thing that differs between the three is the tint. Drawing them together
    // would measure whichever happened to be in front.
    //
    // ⚠️ **At the road's own height 8 m up it — #455.** This used the camera
    // pose's `y`, the road height at the RIDER, and the harness route climbs
    // at 5 %: 8 m on, the tarmac is 0.4 m higher, so every rider this probe
    // drew stood with its wheels and the lower half of its frame inside the
    // road. #448 moved the shadow probe below onto the tarmac and left the
    // colour probes measuring half-buried bicycles; this puts all of them on
    // it. `game.browser.spec.ts` §"draws each of the three in its own colour"
    // publishes the silhouette sizes, which grew when this landed.
    const onTarmac = onTheRoad(probe, 8, 0);
    const alone = (kind: 'rider' | 'bot' | 'ghost', at: number): SceneFrame => ({
      ...probe,
      scatter: [],
      markers: [
        {
          kind,
          x: pose.x + 8 * pose.headingX,
          y: onTarmac.y,
          z: pose.z + 8 * pose.headingZ,
          headingX: pose.headingX,
          headingZ: pose.headingZ,
          lean: 0,
          bodyLean: 0,
          crankAngle: at,
        },
      ],
    });
    for (const kind of ['rider', 'bot', 'ghost'] as const) {
      view.render(alone(kind, 0));
      const found = meanOver(whole(), nothing);
      riders[kind] = { mean: found.mean, pixels: found.pixels };
    }
    // The control for #455: the rider where `alone` used to stand it.
    const buried = alone('rider', 0);
    view.render({ ...buried, markers: buried.markers.map((each) => ({ ...each, y: pose.y })) });
    riderBuriedPixels = meanOver(whole(), nothing).pixels;
    // Half a turn of the bot's own cranks, which is what half a development of
    // road does to them. A quarter, for the reason the rider's probe gives.
    view.render(alone('bot', 0));
    const botAtTop = whole();
    view.render(alone('bot', Math.PI / 2));
    botCrankPixels = shadingAcross(whole(), botAtTop).pixels;

    // ---------------------------------------- the contact shadows — #426
    //
    // Each rider alone, at the same place, first with the shadows off and
    // then with the `'contact'` every ladder rung draws: the pixels that
    // differ are the blob. The control is the shadowless frame drawn twice.
    // ⚠️ And inside the texture count on purpose: the soft edge is a vertex
    // ALPHA, and #366's "no texture reaches the GPU" is asserted over this.
    //
    // ⚠️ **On the tarmac, as `alone` now is for every probe — #455.** Until
    // then this was the only probe that put its rider there: `alone` used the
    // camera pose's height and stood the riders 0.4 m under the road, which is
    // invisible to a colour mean and fatal to a blob depth-tested against that
    // road. The first version of this probe read 0 px for all three for
    // exactly that reason.
    const grounded = (kind: 'rider' | 'bot' | 'ghost'): SceneFrame => alone(kind, 0);
    for (const kind of ['rider', 'bot', 'ghost'] as const) {
      view.setQuality(NO_RIDER_SHADOWS);
      view.render(grounded(kind));
      const without = whole();
      view.render(grounded(kind));
      contactShadowNoise = Math.max(contactShadowNoise, shadingAcross(whole(), without).pixels);
      view.setQuality(qualitySettings(0));
      view.render(grounded(kind));
      const withShadow = whole();
      const found = luminanceAcross(withShadow, without);
      contactShadowPixels[kind] = found.pixels;
      contactShadowLuminance[kind] = [found.with, found.without];
    }
    view.destroy();
    textures = counted() - baseline;
  });
  return {
    texturesCreated: textures,
    texturesBaseline: baselineTextures,
    treeRed,
    treeGreen,
    buildingGreen,
    buildingBlue,
    riders,
    riderBuriedPixels,
    botCrankPixels,
    contactShadowPixels,
    contactShadowLuminance,
    contactShadowNoise,
  };
}

/** The full rung with the riders' shadows off — what a probe of the RIDER draws with. */
const NO_RIDER_SHADOWS: QualitySettings = { ...qualitySettings(0), riderShadows: 'none' };

/** What the harness reports for the shadow map when it did not measure it. */
const NO_SHADOW_MAP: ShadowMapMeasurement = {
  measured: false,
  contactFrameMs: 0,
  mapFrameMs: 0,
  noiseMs: 0,
  contactDrawCalls: 0,
  mapDrawCalls: 0,
  shadowPixels: 0,
  ghostShadowPixels: 0,
};

/**
 * The first frames of a ride on the shadow map rung, with and without
 * `prepare` — #547. @see rideStartProbe
 */
export interface RideStartMeasurement {
  readonly measured: boolean;
  /** Whether this context offers `KHR_parallel_shader_compile`. Published, not asserted. */
  readonly parallelCompile: boolean;
  /** Programs linked inside `prepare` — the work moved out of the ride. */
  readonly linksInPrepare: number;
  /** Milliseconds `prepare` took to settle, wall clock; the main thread is free between polls. */
  readonly prepareMs: number;
  /** Programs linked in the first {@link RIDE_START_FRAMES} frames after `prepare`. */
  readonly preparedLinks: number;
  /** The same frames' GPU-awaited milliseconds, one each. */
  readonly preparedFrameMs: readonly number[];
  /** Programs linked in the first frames of a view drawn WITHOUT `prepare` — the control. */
  readonly unpreparedLinks: number;
  readonly unpreparedFrameMs: readonly number[];
}

const NO_RIDE_START: RideStartMeasurement = {
  measured: false,
  parallelCompile: false,
  linksInPrepare: 0,
  prepareMs: 0,
  preparedLinks: 0,
  preparedFrameMs: [],
  unpreparedLinks: 0,
  unpreparedFrameMs: [],
};

/** The first frames of a ride {@link rideStartProbe} watches. */
const RIDE_START_FRAMES = 10;

/**
 * Counts `linkProgram` calls on every WebGL 2 context while `body` runs — one
 * per GPU program three builds. Async, unlike {@link countingDrawCalls},
 * because `prepare` is.
 */
async function countingLinks<T>(body: (links: () => number) => Promise<T>): Promise<T> {
  const gl = WebGL2RenderingContext.prototype;
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const original = gl.linkProgram;
  let links = 0;
  gl.linkProgram = function patched(this: WebGL2RenderingContext, program: WebGLProgram): void {
    links += 1;
    original.call(this, program);
  };
  try {
    return await body(() => links);
  } finally {
    gl.linkProgram = original;
  }
}

/**
 * **Where the start-of-ride stall went** — #547, and the browser half of its
 * second criterion.
 *
 * Part T on the Pixel Tablet: the first 12 s of a ride with the shadow map had
 * a GPU 99th percentile of 4 950 ms, most likely every program compiling
 * inside the first `render`. Two fresh views on {@link RIDER_SHADOW_MAP_RUNG},
 * each on its own canvas and so its own context, draw the ride's first
 * {@link RIDE_START_FRAMES} frames, each timed with the GPU awaited:
 *
 * - **the control** draws at once, as every first frame did before #547, and
 *   must link programs inside those frames — the stall, reproduced;
 * - **the product's order** awaits `prepare` with the ride's first frame, as
 *   `GameView` does, and must link NONE in them.
 *
 * ⚠️ **Links are the precise half and milliseconds the coarse one.** A
 * `linkProgram` issued inside a frame is a program built inside it, whatever
 * it costs here. But links are not all a first frame pays for — every buffer's
 * first upload and a driver's first-draw work are in it too, and while this
 * probe was being written a `prepare` that linked everything without the
 * ride's first frame staged left 600 of a 610 ms first frame where it was,
 * with a link count of zero (`three-renderer.ts` §`prepare`).
 * So the spec also holds the prepared frames' worst against the control's
 * first, by a wide factor. A software rasteriser's milliseconds are not a
 * phone's; the tablet's are validation 0002 Part T's to re-take.
 *
 * ⚠️ **Not the GPU process's program cache.** The control's first frame costs
 * hundreds of milliseconds on a page that has already drawn this scene on
 * dozens of other contexts, which is the measurement that says the cost is per
 * context — and why warming a throwaway context while the picker is shown, as
 * #547 floated, was not the fix taken.
 */
async function rideStartProbe(): Promise<RideStartMeasurement> {
  const profile = harnessRoute();
  const origin = corridorOrigin(profile);
  const start = atStartLine(profile);
  const frameAt = (distance: number) =>
    lentSceneFrame({
      profile,
      origin,
      state: { ...start, ride: { ...start.ride, distance: metres(distance) } },
      botDistance: distance + 4,
    });
  const firstFrames = async (prepared: boolean) =>
    countingLinks(async (links) => {
      const canvas = document.createElement('canvas');
      canvas.width = 600;
      canvas.height = 400;
      const view = threeGameRenderer.create(canvas, RIDER_SHADOW_MAP_RUNG);
      view.resize(600, 400);
      const gl = canvas.getContext('webgl2');
      const parallelCompile = gl?.getExtension('KHR_parallel_shader_compile') != null;
      const beforePrepare = links();
      const prepareStarted = performance.now();
      if (prepared) {
        // As `GameView` does: the first frame it builds is the one it prepares with.
        await view.prepare(frameAt(0));
      }
      const prepareMs = performance.now() - prepareStarted;
      const linksInPrepare = links() - beforePrepare;
      const beforeFrames = links();
      const frameMs: number[] = [];
      for (let index = 1; index <= RIDE_START_FRAMES; index += 1) {
        const started = performance.now();
        view.render(frameAt(index * SWEEP_STEP_METRES));
        awaitTheGpu(gl);
        frameMs.push(performance.now() - started);
      }
      const frameLinks = links() - beforeFrames;
      view.destroy();
      return { parallelCompile, prepareMs, linksInPrepare, frameLinks, frameMs };
    });
  // The control first, so the product's view is never the first to build a
  // program this page's GPU process has not seen.
  const unprepared = await firstFrames(false);
  const prepared = await firstFrames(true);
  return {
    measured: true,
    parallelCompile: prepared.parallelCompile,
    linksInPrepare: prepared.linksInPrepare,
    prepareMs: prepared.prepareMs,
    preparedLinks: prepared.frameLinks,
    preparedFrameMs: prepared.frameMs,
    unpreparedLinks: unprepared.frameLinks,
    unpreparedFrameMs: unprepared.frameMs,
  };
}

/** @see presenceCostProbe */
export interface PresenceCostMeasurement {
  readonly measured: boolean;
  /** Why not, when it was not — no camera API, or the synthetic camera did not open. */
  readonly why: string;
  /** Cells in one sample: `PRESENCE_GRID_COLUMNS × PRESENCE_GRID_ROWS` when it worked. */
  readonly cells: number;
  /** What one real pair taken `PRESENCE_PAIR_GAP_MILLISECONDS` apart showed. */
  readonly observation: string;
  /** Mean ms a frame, the renderer alone. */
  readonly frameMs: number;
  /** Mean ms a frame that also took one presence sample. */
  readonly frameWithSampleMs: number;
  /** Mean ms of one sample with nothing being drawn. */
  readonly sampleAloneMs: number;
  /** The widest spread between two rounds of the same condition. */
  readonly noiseMs: number;
  /**
   * #516: what a pair drawn from a source that has STOPPED delivering frames
   * showed — a `canvas.captureStream(0)` never asked for a second frame, read
   * through the real sampler. `unreadable` is the guard working.
   */
  readonly frozenObservation: string;
  /**
   * #516's control: the same picture, the same stream, with a new frame
   * requested between the samples. `still` — the room did not change, and the
   * source said it had moved on.
   */
  readonly deliveringObservation: string;
}

const NO_PRESENCE_COST: PresenceCostMeasurement = {
  measured: false,
  why: 'not asked for',
  cells: 0,
  observation: '',
  frameMs: 0,
  frameWithSampleMs: 0,
  sampleAloneMs: 0,
  noiseMs: 0,
  frozenObservation: '',
  deliveringObservation: '',
};

/**
 * **A frozen source, through the real sampler** — #516.
 *
 * A muted track, a stalled webcam and a hidden tab all leave a `<video>`
 * drawing its last frame, and no test machine can produce one of those on
 * demand. A `canvas.captureStream(0)` can: it delivers a frame only when
 * `requestFrame()` is called, so never calling it again IS a source that has
 * stopped. The picture is a left-to-right ramp, readable by every one of
 * `presence.ts`' dark, bright and flat limits, so what decides the answer is
 * the frame marker and nothing else.
 */
async function frozenSourceProbe(): Promise<{ frozen: string; delivering: string }> {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 48;
  const context = canvas.getContext('2d');
  if (context === null) {
    return { frozen: 'no 2D context', delivering: 'no 2D context' };
  }
  const ramp = context.createLinearGradient(0, 0, canvas.width, 0);
  ramp.addColorStop(0, '#202020');
  ramp.addColorStop(1, '#e0e0e0');
  context.fillStyle = ramp;
  context.fillRect(0, 0, canvas.width, canvas.height);
  const stream = canvas.captureStream(0);
  const [track] = stream.getVideoTracks() as (MediaStreamTrack & { requestFrame?: () => void })[];
  if (track?.requestFrame === undefined) {
    return { frozen: 'no requestFrame', delivering: 'no requestFrame' };
  }
  track.requestFrame();
  const sampler = videoLuminanceSampler(stream);
  const pause = async (milliseconds: number): Promise<void> =>
    new Promise((resolve) => {
      setTimeout(resolve, milliseconds);
    });
  try {
    const first = await sampler.sample();
    await pause(PRESENCE_PAIR_GAP_MILLISECONDS);
    const second = await sampler.sample();
    const frozen = observePair(first, second);
    // The control. A requested frame reaches the element within a frame or
    // two; polled rather than waited for once, so a slow runner is not a
    // false red. ⚠️ The SAME ramp is painted again before each request:
    // measured on the way in, `requestFrame()` over a canvas nothing has
    // drawn on since delivers no new frame at all, and the control read
    // `unreadable` for that reason rather than the guard's.
    let third = second;
    for (
      let attempt = 0;
      attempt < 40 && observePair(second, third) === 'unreadable';
      attempt += 1
    ) {
      context.fillRect(0, 0, canvas.width, canvas.height);
      track.requestFrame();
      await pause(50);
      third = await sampler.sample();
    }
    return { frozen, delivering: observePair(second, third) };
  } finally {
    sampler.release();
    track.stop();
  }
}

/**
 * **What #390's presence check costs a frame, with the renderer running** — the
 * issue's cost criterion, and ⚠️ the COMBINED cost rather than the check's own:
 * #328 records the trap of timing a camera operation in isolation on a thread
 * that is also drawing the world.
 *
 * It opens Chromium's synthetic camera (`playwright.config.ts` §`LAUNCH_ARGS`)
 * through the **real** `videoLuminanceSampler` — the same `drawImage` into a
 * 32 × 24 canvas and `getImageData` production runs — and times
 * {@link SHADING_FRAMES} frames of the real renderer with and without one
 * sample in each, alternating the order for `run`'s reason and flushing the
 * GPU before each clock is read. **One sample in every frame** is sixty times
 * the production rate (two samples every two seconds), so the difference is
 * a ceiling on what one frame in sixty pays, not a per-frame average.
 *
 * ⚠️ **What it does NOT say.** A headless Chromium on a software rasteriser is
 * not the device floor, and #323's 24 ms p50 is a Pixel Tablet figure; the
 * spec publishes both numbers side by side and asserts no wall-clock bound, for
 * the reason `game.browser.spec.ts` §"measures what the shading costs" gives.
 */
async function presenceCostProbe(frame: SceneFrame): Promise<PresenceCostMeasurement> {
  const devices = platformMediaDevices();
  if (devices === undefined) {
    return { ...NO_PRESENCE_COST, why: 'no camera API in this browser' };
  }
  let stream: MediaStreamLike;
  try {
    stream = await devices.getUserMedia(CAMERA_CONSTRAINTS);
  } catch (error: unknown) {
    return {
      ...NO_PRESENCE_COST,
      why: `the synthetic camera did not open: ${error instanceof Error ? error.name : 'unknown'}`,
    };
  }
  const sampler = videoLuminanceSampler(stream);
  const canvas = document.createElement('canvas');
  const view = threeGameRenderer.create(canvas, NO_RIDER_SHADOWS);
  try {
    // Warm: the first sample starts the <video> and waits for its first frame.
    const first = await sampler.sample();
    await new Promise((resolve) => {
      setTimeout(resolve, PRESENCE_PAIR_GAP_MILLISECONDS);
    });
    const second = await sampler.sample();
    const observation = observePair(first, second);

    view.resize(600, 400);
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    const timed = async (withSample: boolean): Promise<number> => {
      for (let index = 0; index < 5; index += 1) view.render(frame);
      awaitTheGpu(gl);
      const started = performance.now();
      for (let index = 0; index < SHADING_FRAMES; index += 1) {
        view.render(frame);
        // An `await` in both, so the difference is the sample and not the
        // microtask that carries it.
        await (withSample ? sampler.sample() : Promise.resolve());
      }
      awaitTheGpu(gl);
      return (performance.now() - started) / SHADING_FRAMES;
    };
    const plain: number[] = [];
    const sampled: number[] = [];
    for (let round = 0; round < SHADING_ROUNDS; round += 1) {
      const order = round % 2 === 0 ? [false, true] : [true, false];
      for (const withSample of order) {
        (withSample ? sampled : plain).push(await timed(withSample));
      }
    }
    const alone: number[] = [];
    const started = performance.now();
    for (let index = 0; index < SHADING_FRAMES; index += 1) {
      await sampler.sample();
    }
    alone.push((performance.now() - started) / SHADING_FRAMES);

    const mean = (values: readonly number[]) =>
      values.reduce((total, each) => total + each, 0) / values.length;
    const range = (values: readonly number[]) => Math.max(...values) - Math.min(...values);
    const frozenSource = await frozenSourceProbe();
    return {
      measured: true,
      why: '',
      cells: first.values.length,
      observation,
      frameMs: mean(plain),
      frameWithSampleMs: mean(sampled),
      sampleAloneMs: mean(alone),
      noiseMs: Math.max(range(plain), range(sampled)),
      frozenObservation: frozenSource.frozen,
      deliveringObservation: frozenSource.delivering,
    };
  } finally {
    view.destroy();
    sampler.release();
    for (const track of stream.getVideoTracks()) track.stop();
  }
}

/**
 * Where two frames differ, and the mean luminance of those pixels in each.
 * @see contactShadowLuminance
 */
function luminanceAcross(
  present: Uint8Array,
  absent: Uint8Array,
): { readonly pixels: number; readonly with: number; readonly without: number } {
  let pixels = 0;
  let withTotal = 0;
  let withoutTotal = 0;
  for (let at = 0; at + 3 < present.length; at += 4) {
    if (
      present[at] === absent[at] &&
      present[at + 1] === absent[at + 1] &&
      present[at + 2] === absent[at + 2]
    ) {
      continue;
    }
    pixels += 1;
    withTotal += luminanceOf([present[at] ?? 0, present[at + 1] ?? 0, present[at + 2] ?? 0, 255]);
    withoutTotal += luminanceOf([absent[at] ?? 0, absent[at + 1] ?? 0, absent[at + 2] ?? 0, 255]);
  }
  return pixels === 0
    ? { pixels: 0, with: 0, without: 0 }
    : { pixels, with: withTotal / pixels, without: withoutTotal / pixels };
}

/**
 * The riders' shadow MAP, measured on its own canvas — #426.
 *
 * ⚠️ **Published, never asserted against a budget**, and #426 says why: this
 * is a headless Chromium on a software rasteriser, and a GPU-less runner's
 * number says nothing about what a phone's GPU pays. The device measurement is
 * `docs/validation/0002-android-shell-and-game.md` Part T. What IS asserted is
 * that the measurement measured something: a shadow reached the buffer, and
 * the map rung drew more calls than the contact one.
 *
 * Alternating which rung goes first each round, and warming each with a
 * discarded sweep, for exactly the reasons the shading measurement gives.
 */
function shadowMapProbe(probe: SceneFrame): ShadowMapMeasurement {
  const canvas = document.createElement('canvas');
  canvas.width = 600;
  canvas.height = 400;
  const profile = harnessRoute();
  const origin = corridorOrigin(profile);
  const start = atStartLine(profile);
  const frameAt = (distance: number, build: FrameBuild = sceneFrame) =>
    build({
      profile,
      origin,
      state: { ...start, ride: { ...start.ride, distance: metres(distance) } },
      botDistance: distance + 4,
    });
  let result: ShadowMapMeasurement = NO_SHADOW_MAP;
  countingDrawCalls((calls) => {
    const view = threeGameRenderer.create(canvas, qualitySettings(0));
    view.resize(600, 400);
    const gl = canvas.getContext('webgl2');
    const whole = () =>
      gl === null ? new Uint8Array(0) : readRegion(gl, 0, 0, canvas.width, canvas.height);
    const contact = qualitySettings(0);
    const riderOnly: SceneFrame = {
      ...probe,
      scatter: [],
      markers: probe.markers.filter((marker) => marker.kind === 'rider'),
    };

    const drawnWith = (settings: QualitySettings): number => {
      view.setQuality(settings);
      view.render(riderOnly);
      const before = calls();
      view.render(riderOnly);
      return calls() - before;
    };
    const contactDrawCalls = drawnWith(contact);
    const mapDrawCalls = drawnWith(RIDER_SHADOW_MAP_RUNG);
    const withMap = whole();
    view.setQuality(NO_RIDER_SHADOWS);
    view.render(riderOnly);
    const shadowPixels = luminanceAcross(withMap, whole());
    // #547: the same frame with the rider made the GHOST, which casts no
    // shadow on this rung either (`three-renderer.ts` §`RiderBelt.#castersOnly`).
    // Everything else is identical, so any pixel that differs is its shadow.
    const ghostOnly: SceneFrame = {
      ...riderOnly,
      markers: riderOnly.markers.map((marker) => ({ ...marker, kind: 'ghost' as const })),
    };
    view.setQuality(RIDER_SHADOW_MAP_RUNG);
    view.render(ghostOnly);
    const ghostWithMap = whole();
    view.setQuality(NO_RIDER_SHADOWS);
    view.render(ghostOnly);
    const ghostShadow = luminanceAcross(ghostWithMap, whole());

    for (const settings of [contact, RIDER_SHADOW_MAP_RUNG]) {
      view.setQuality(settings);
      void timeFrames(view, frameAt, gl);
    }
    const contactRounds: number[] = [];
    const mapRounds: number[] = [];
    for (let round = 0; round < SHADOW_MAP_ROUNDS; round += 1) {
      const order =
        round % 2 === 0 ? [contact, RIDER_SHADOW_MAP_RUNG] : [RIDER_SHADOW_MAP_RUNG, contact];
      for (const settings of order) {
        view.setQuality(settings);
        (settings === contact ? contactRounds : mapRounds).push(timeFrames(view, frameAt, gl));
      }
    }
    view.destroy();
    const mean = (values: readonly number[]) =>
      values.reduce((total, each) => total + each, 0) / values.length;
    const range = (values: readonly number[]) => Math.max(...values) - Math.min(...values);
    result = {
      measured: true,
      contactFrameMs: mean(contactRounds),
      mapFrameMs: mean(mapRounds),
      noiseMs: Math.max(range(contactRounds), range(mapRounds)),
      contactDrawCalls,
      mapDrawCalls,
      // Only pixels the map made DARKER count as its shadow.
      shadowPixels: shadowPixels.with < shadowPixels.without ? shadowPixels.pixels : 0,
      // Every pixel that differs, darker or not: the ghost changes nothing.
      ghostShadowPixels: ghostShadow.pixels,
    };
  });
  return result;
}

/** Rounds of each rung in {@link shadowMapProbe}: two, alternating, after a warm-up. */
const SHADOW_MAP_ROUNDS = 2;

/**
 * Where a point in the world lands in the frame, as fractions of its width and
 * height from the TOP LEFT — #424.
 *
 * ⚠️ **Every fixed-position probe in this file used to be a pair of fractions
 * somebody worked out against a camera 3 m up, 8 m back, on a 60° lens**, and
 * #424 moved all three. They did not go red. They went on passing while
 * pointing at other things: the "distant road" probe, 58 % up the frame, was
 * looking at the SKY — the far end of the road is 54 % up now — and *"the
 * distant road is a different colour from the near road"* is true of the sky
 * too. A probe that has silently moved off its subject is this repository's
 * usual defect arriving through a camera.
 *
 * So the probes are aimed from the geometry instead: a point on the road, so
 * many metres ahead and so many to the side, put through the camera the frame
 * actually carries. `camera.ts` is used to AIM and never to assert — what says
 * a probe landed on tarmac is still its colour, read back from the GPU.
 *
 * ⚠️ **The screen's right is `(−headingZ, headingX)` — the road's own normal —
 * and this comment said `(headingZ, −headingX)` until #546.** In a
 * right-handed renderer a camera looking along `+z` with `+y` up has `−x` on
 * its right, which is `(−headingZ, headingX)` for a heading of `(0, 1)`, and
 * the old vector was the screen's LEFT. It went unnoticed because every probe
 * was symmetric about a camera on the centreline, and a point mirrored across
 * the road is still road; #546 moved the camera 1.75 m to the right with the
 * rider, and the mirrored near-road probe landed on the grass beyond the far
 * edge. `game.browser.spec.ts` §"#546" reads the rider on the RIGHT of the
 * screen with the line's positive offset, which is the measurement this rests
 * on.
 *
 * ⚠️ **Since #583 that vector is the MAP's right as well.** Until then the
 * corridor put east on `+x`, so `−x` — the screen's right on a northbound
 * camera — was west, and the whole world was drawn as a mirror of its map.
 * #583 put east on `−x` (`terrain.ts` §`localGroundPosition`) and nothing here
 * had to change: this function is about the camera, not the compass.
 * `game.browser.spec.ts` §"#583" is what reads which way a bend turns.
 */
function inTheFrame(
  frame: SceneFrame,
  aspect: number,
  point: { readonly x: number; readonly y: number; readonly z: number },
): { readonly across: number; readonly down: number } {
  const pose = frame.camera;
  const { eye, target } = cameraRig(pose);
  const axis = { x: target.x - eye.x, y: target.y - eye.y, z: target.z - eye.z };
  const length = Math.hypot(axis.x, axis.y, axis.z);
  const forward = { x: axis.x / length, y: axis.y / length, z: axis.z / length };
  const right = { x: -pose.headingZ, z: pose.headingX };
  // up = right × forward, for a camera with no roll, in a right-handed frame.
  // ⚠️ With the mirrored right this used to be `forward × right`, which is the
  // same vector: the two sign errors cancelled, and `game.browser.spec.ts`
  // §"takes its distant probe further up the ROAD" is what caught the order
  // when only one of them was made.
  const up = {
    x: -right.z * forward.y,
    y: right.z * forward.x - right.x * forward.z,
    z: right.x * forward.y,
  };
  const to = { x: point.x - eye.x, y: point.y - eye.y, z: point.z - eye.z };
  const depth = to.x * forward.x + to.y * forward.y + to.z * forward.z;
  const t = verticalHalfTangent(aspect);
  return {
    across: (1 + (to.x * right.x + to.z * right.z) / (depth * t * aspect)) / 2,
    down: (1 - (to.x * up.x + to.y * up.y + to.z * up.z) / (depth * t)) / 2,
  };
}

/**
 * A point on the road `ahead` metres up it from the rider and `across` metres
 * to the right of its centreline, at the road's own height there.
 *
 * Read off the frame's corridor — the vertices that were drawn — rather than
 * off the route, so the probe and the tarmac cannot disagree about where the
 * road is.
 */
function onTheRoad(
  frame: SceneFrame,
  ahead: number,
  across: number,
): { readonly x: number; readonly y: number; readonly z: number } {
  const pose = frame.camera;
  // ⚠️ **From the CENTRELINE abreast of the camera, not from the camera** —
  // #546. The camera follows the rider across the road (#499), and since #546
  // the rider holds the right-hand side on a straight, so the camera stands
  // 1.75 m off the centreline where #499's line left it on it. Measured from
  // the camera, `across: 0` was 1.75 m from the painted centre line and every
  // probe stated against the road's middle missed it.
  let baseX = pose.x;
  let baseZ = pose.z;
  let closest = Number.POSITIVE_INFINITY;
  const centre = frame.corridor.centre;
  for (let index = 1; index < centre.length; index += 1) {
    const a = centre[index - 1];
    const b = centre[index];
    if (a === undefined || b === undefined) continue;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const lengthSquared = dx * dx + dz * dz;
    if (lengthSquared === 0) continue;
    const t = Math.max(0, Math.min(1, ((pose.x - a.x) * dx + (pose.z - a.z) * dz) / lengthSquared));
    const footX = a.x + t * dx;
    const footZ = a.z + t * dz;
    const apart = Math.hypot(pose.x - footX, pose.z - footZ);
    if (apart < closest) {
      closest = apart;
      baseX = footX;
      baseZ = footZ;
    }
  }
  // `across` to the screen's right, which is the road's normal (@see inTheFrame).
  const x = baseX + ahead * pose.headingX - across * pose.headingZ;
  const z = baseZ + ahead * pose.headingZ + across * pose.headingX;
  // The centreline point nearest that spot: the corridor samples the road about
  // every ten metres and this route is straight, so nearest is within 5 m and a
  // 5 % grade puts that inside a quarter of a metre of height.
  let nearest = frame.corridor.centre[0];
  let best = Number.POSITIVE_INFINITY;
  for (const each of frame.corridor.centre) {
    const apart = Math.hypot(each.x - x, each.z - z);
    if (apart < best) {
      best = apart;
      nearest = each;
    }
  }
  return { x, y: nearest?.y ?? pose.y, z };
}

/** {@link inTheFrame} as the pixel `readPixels` wants: origin BOTTOM left. */
function pixelFor(
  frame: SceneFrame,
  canvas: HTMLCanvasElement,
  point: { readonly x: number; readonly y: number; readonly z: number },
): { readonly x: number; readonly y: number } {
  const at = inTheFrame(frame, canvas.width / canvas.height, point);
  return { x: canvas.width * at.across, y: canvas.height * (1 - at.down) };
}

/**
 * Where the road's near lane is probed: 20 m up the road, 1.5 m LEFT of the
 * centre line — the lane the rider is not in.
 *
 * 20 m, because `camera.ts` §`roadAppearsOverRiderMetres` puts everything
 * nearer than 14 m directly behind the rider's back. 1.5 m, because that is
 * clear of a 0.15 m centre-line mark, of the rider — whose 0.2 m half-width
 * shadows ±0.9 m of road at this depth — and of the edge line 3.3 m out.
 * ⚠️ Left since #546: the rider holds the right-hand lane 1.75 m out now, and
 * the camera with them, so the right lane at 1.5 m is behind their back.
 */
const NEAR_ROAD_PROBE = { ahead: 20, across: -1.5 } as const;

/**
 * The same lane, 150 m up the road: the only difference between the two
 * read-backs is how far each has converged on the horizon. Past the bot, which
 * `frameAt` puts 120 m ahead on its line — the right-hand lane since #546 —
 * and so clear of this ray.
 */
const FAR_ROAD_PROBE = { ahead: 150, across: -1.5 } as const;

/**
 * Where the GROUND is probed: 6 m ahead of the rider, 4.5 m left of the centre
 * line. Off the 7 m carriageway by a metre, and inside the 6.5 m at which
 * `scatter.ts` first allows anything to stand — the one strip of this world
 * that is guaranteed to be bare ground whatever the seed places.
 */
const GROUND_PROBE = { ahead: 6, across: -4.5 } as const;

/**
 * The stretch of the centre column in which a centre-line mark can be seen:
 * from just past where the road appears over the rider's helmet to just short
 * of the bot. @see findCentreLine
 */
const CENTRE_LINE_STRETCH = { fromAhead: 16, toAhead: 100 } as const;

/**
 * How far across the carriageway the second probe sits, as a fraction of width.
 *
 * One percent of 600 px is six pixels, which at this depth is about half a
 * metre of road: outside a 0.15 m centre line and a long way inside a 7 m
 * road's edge lines.
 */
const BESIDE_FRACTION = 0.01;

/** Perceived brightness of a pixel, for comparing two of them. */
function luminanceOf(pixel: Pixel): number {
  return 0.2126 * pixel[0] + 0.7152 * pixel[1] + 0.0722 * pixel[2];
}

/** What one object's own pixels look like, found by rendering it twice. */
interface MarkerShading {
  readonly pixels: number;
  readonly spread: number;
  readonly brightest: Pixel;
  readonly darkest: Pixel;
}

/**
 * The brightness range across the pixels two frames disagree about — #286.
 *
 * ⚠️ **The difference is only used to decide *which* pixels belong to the
 * object; the spread is then taken over the frame that has it.** That is what
 * makes this a shading measurement rather than a "something changed"
 * measurement: a flat object also changes every one of those pixels, and it
 * changes them all to the *same* value.
 *
 * ⚠️ The edge pixels of a silhouette are not excluded and do not need to be:
 * the renderer is built with `antialias: false`, so a pixel is either the
 * object or the background and there is no blend between them to widen the
 * range artificially.
 */
function shadingAcross(present: Uint8Array, absent: Uint8Array): MarkerShading {
  let pixels = 0;
  let brightest: Pixel = NOWHERE;
  let darkest: Pixel = NOWHERE;
  let high = Number.NEGATIVE_INFINITY;
  let low = Number.POSITIVE_INFINITY;
  for (let at = 0; at < present.length; at += 4) {
    if (
      present[at] === absent[at] &&
      present[at + 1] === absent[at + 1] &&
      present[at + 2] === absent[at + 2]
    ) {
      continue;
    }
    pixels += 1;
    const pixel: Pixel = [
      present[at] ?? 0,
      present[at + 1] ?? 0,
      present[at + 2] ?? 0,
      present[at + 3] ?? 0,
    ];
    const luminance = luminanceOf(pixel);
    if (luminance > high) {
      high = luminance;
      brightest = pixel;
    }
    if (luminance < low) {
      low = luminance;
      darkest = pixel;
    }
  }
  return {
    pixels,
    spread: pixels === 0 ? 0 : high - low,
    brightest,
    darkest,
  };
}

/**
 * The row in {@link ROAD_BAND} where the centre column differs most from the
 * carriageway beside it.
 *
 * ⚠️ **Searched rather than assumed, and the search is what makes this a gate
 * rather than a coincidence.** A centre-line mark is periodic in route
 * distance, so which rows of the frame carry paint depends on where the rider
 * is; and the mark is two or three pixels wide at this depth, so a hard-coded
 * row would be one camera adjustment from measuring asphalt and saying so
 * confidently. What the search cannot manufacture is a difference that is not
 * there: with no centre line every row in this band is one flat colour across
 * its whole width.
 */
function findCentreLine(
  gl: WebGL2RenderingContext | WebGLRenderingContext,
  width: number,
  from: { readonly x: number; readonly y: number },
  to: { readonly x: number; readonly y: number },
): { readonly centre: Pixel; readonly beside: Pixel; readonly row: number } {
  // ⚠️ **Along the centre line's own image, not down the frame's middle** —
  // #546. The camera follows the rider, who holds the right-hand lane on a
  // straight since #546, so the painted line is left of the frame's middle
  // and converges on it with distance. A straight road's centre line is a
  // straight line on the screen, so the column is interpolated between the
  // two ends of the stretch, each put through the camera by `pixelFor`.
  const offset = Math.max(2, Math.round(width * BESIDE_FRACTION));
  let best: { centre: Pixel; beside: Pixel; row: number; apart: number } = {
    centre: NOWHERE,
    beside: NOWHERE,
    row: 0,
    apart: -1,
  };
  for (let row = Math.floor(from.y); row <= Math.floor(to.y); row += 1) {
    const share = to.y === from.y ? 0 : (row - from.y) / (to.y - from.y);
    const column = Math.round(from.x + (to.x - from.x) * share);
    const onLine = readPixel(gl, column, row);
    const onRoad = readPixel(gl, column + offset, row);
    const apart = Math.abs(luminanceOf(onLine) - luminanceOf(onRoad));
    if (apart > best.apart) {
      best = { centre: onLine, beside: onRoad, row, apart };
    }
  }
  return best;
}

/**
 * Where the scenery is looked for: beside the road, spanning the horizon.
 *
 * ⚠️ **Beside the road is enforced by the *columns*, and it is the half that
 * makes this a scenery probe rather than a road probe.** The chase camera puts
 * the carriageway up the middle of the frame, so the central quarter is
 * excluded outright: a difference found there could be the road, a marker or a
 * centre-line mark moving, none of which is what #244 added.
 *
 * The rows span the horizon — from a little below it, where the ground plane
 * is, to well above it, where only sky was before. Scenery stands *on* the
 * ground and reaches *above* it, so a belt that drew reaches into rows that
 * were sky and rows that were ground, and a belt that drew nothing leaves both
 * exactly as they were.
 */
const SCENERY_REGION = {
  fromColumn: 0.0,
  toColumn: 0.375,
  fromRow: 0.4,
  toRow: 0.85,
} as const;

/** Reads a rectangle of the drawing buffer, four bytes a pixel. */
function readRegion(
  gl: WebGL2RenderingContext | WebGLRenderingContext,
  x: number,
  y: number,
  width: number,
  height: number,
): Uint8Array {
  const pixels = new Uint8Array(width * height * 4);
  gl.readPixels(x, y, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  return pixels;
}

/** What the two frames disagree about, and where they disagree most. */
interface SceneryDifference {
  readonly changed: number;
  readonly with: Pixel;
  readonly without: Pixel;
  readonly columnFraction: number;
  readonly rowFraction: number;
}

/**
 * Compares the same region of two frames, and reports the biggest disagreement.
 *
 * ⚠️ **Searched rather than probed at a fixed point**, for the reason
 * {@link findCentreLine} gives: where a tree lands in the frame depends on
 * where the rider is and on a camera that a later sub-issue may move, and a
 * hard-coded pixel is one adjustment away from measuring empty sky and saying
 * so confidently. What a search cannot manufacture is a difference that is not
 * there — a belt that drew nothing leaves every pixel in this region identical,
 * the count is zero, and the spec goes red.
 */
function compareRegions(
  withScenery: Uint8Array,
  withoutScenery: Uint8Array,
  width: number,
  height: number,
  originColumn: number,
  originRow: number,
  frameWidth: number,
  frameHeight: number,
): SceneryDifference {
  let changed = 0;
  let best = { apart: -1, at: 0 };
  for (let index = 0; index < width * height; index += 1) {
    const at = index * 4;
    const apart =
      Math.abs((withScenery[at] ?? 0) - (withoutScenery[at] ?? 0)) +
      Math.abs((withScenery[at + 1] ?? 0) - (withoutScenery[at + 1] ?? 0)) +
      Math.abs((withScenery[at + 2] ?? 0) - (withoutScenery[at + 2] ?? 0));
    if (apart > 0) {
      changed += 1;
    }
    if (apart > best.apart) {
      best = { apart, at };
    }
  }
  const index = best.at / 4;
  const column = originColumn + (index % width);
  const row = originRow + Math.floor(index / width);
  return {
    changed,
    with: [
      withScenery[best.at] ?? 0,
      withScenery[best.at + 1] ?? 0,
      withScenery[best.at + 2] ?? 0,
      withScenery[best.at + 3] ?? 0,
    ],
    without: [
      withoutScenery[best.at] ?? 0,
      withoutScenery[best.at + 1] ?? 0,
      withoutScenery[best.at + 2] ?? 0,
      withoutScenery[best.at + 3] ?? 0,
    ],
    columnFraction: column / frameWidth,
    rowFraction: row / frameHeight,
  };
}

/** How far the rider moves between the frames of a sweep, in metres. */
const SWEEP_STEP_METRES = 3.7;

/**
 * How many frames each of #286's two frame-cost means is taken over: **60**.
 *
 * Two seconds of riding at 30 fps (`QUALITY_LADDER`'s first capped rung — level
 * 2 since #482; the top two rungs draw at the display's rate), which is long
 * enough that one slow frame is a sixtieth of the answer and short enough that
 * the whole measurement — four sweeps, two at each shading — is under a second
 * on top of a gate that already runs for twenty.
 */
const SHADING_FRAMES = 60;

/**
 * How many times each shading is timed, so the two alternate: **4**.
 *
 * ⚠️ **Alternating matters more than the count does.** A machine that is
 * warming up, or a compositor that takes a frame, drifts *monotonically* over
 * a run — so timing all of one shading and then all of the other charges the
 * drift entirely to whichever went second. Interleaving and averaging charges
 * it to both.
 *
 * ⚠️ **More than two, so that a noise floor exists at all.** Two measurements
 * of the same shading give one spread and no sense of whether it is typical;
 * four give the range {@link frameMsNoise} reports, which is what turns
 * *"lighting costs 0.1 ms"* into a statement somebody can act on. A difference
 * smaller than the spread between two identical measurements is not a cost
 * that has been measured, and saying so is the whole point.
 *
 * ⚠️ **Even rather than odd**, because the order alternates: an odd count puts
 * one shading first one more time than the other, and whatever a machine does
 * at the start of a round is then charged unevenly.
 */
const SHADING_ROUNDS = 4;

/**
 * How far the rider is moved, across the road, to check its legs come with it:
 * **1 m** — #366–#368's review. @see riderLeftBehindPixels
 *
 * ⚠️ **Across rather than along**, so the rider stays at the same depth and
 * the same size: a move along the road changes the silhouette by perspective,
 * which would make the control non-zero for a reason that has nothing to do
 * with the legs. A metre is under half the road's own half-width, so the
 * rider is still over tarmac and entirely in frame, and it is several times a
 * leg's own width, so a leg left behind does not overlap the one that moved.
 */
const RIDER_MOVE_METRES = 1;

/**
 * Blocks until everything asked of the GPU has actually happened.
 *
 * ⚠️ **`readPixels` and not `finish()`, and the difference was measured.**
 * WebGL calls are queued, so `render` returning means the driver has been
 * *asked*, not that anything was drawn — and a timing loop that does not
 * synchronise reports how fast JavaScript can submit commands, which is
 * exactly the number a shading change does not move.
 *
 * `gl.finish()` is the call that is supposed to do this and **in this browser
 * it does not**: with `finish()` alone, timing the identical scene into a
 * 1 800 × 1 200 drawing buffer instead of a 600 × 400 one — nine times the
 * fill — came out at 0.137 ms a frame against 0.136, which is a clock that is
 * not watching the rasteriser at all. Chromium's WebGL runs over a command
 * buffer in another process and `finish` is free to return once that is
 * flushed. `readPixels` cannot: it has to hand back a pixel that exists.
 *
 * The same pair of measurements with this in place reads 3.4 ms and 6.7 ms,
 * which is a clock that responds to fill — not the ninefold a purely
 * fill-bound scene would give, because a frame here is also vertex work and
 * command submission that the buffer's size does not touch.
 *
 * One pixel, so the read itself is not what is being timed.
 */
function awaitTheGpu(gl: WebGL2RenderingContext | WebGLRenderingContext | null): void {
  if (gl === null) {
    return;
  }
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
}

/**
 * Drives {@link SHADING_FRAMES} frames and returns the mean milliseconds each.
 *
 * ⚠️ The GPU is synchronised **once, at the end**, rather than after every
 * frame: a per-frame stall would measure the round trip as well as the work,
 * and sixty frames' worth of it would swamp the difference being looked for.
 * What matters is that nothing is left queued when the clock is read.
 * @see awaitTheGpu
 */
function timeFrames(
  view: { render: (frame: SceneFrame) => void },
  frameAt: (at: number, build: FrameBuild) => SceneFrame,
  gl: WebGL2RenderingContext | WebGLRenderingContext | null,
): number {
  const started = performance.now();
  for (let index = 1; index <= SHADING_FRAMES; index += 1) {
    // Built and drawn in one breath, as `GameView` does: lent, not copied (#473).
    view.render(frameAt(index * SWEEP_STEP_METRES, lentSceneFrame));
  }
  awaitTheGpu(gl);
  return (performance.now() - started) / SHADING_FRAMES;
}

/**
 * Drives the rider up the route once, at {@link SWEEP_STEP_METRES} a frame.
 *
 * A function rather than a loop in place because it is run **twice** and the
 * two runs have to cover exactly the same distances — a second pass over even
 * slightly different ones would be measuring a different stretch of route
 * rather than the same one again. @see the harness's `resourcesAfterSecondSweep`.
 */
function sweep(
  view: { render: (frame: SceneFrame) => void },
  frameAt: (at: number) => SceneFrame,
): number {
  let drawn = 0;
  for (let index = 1; index <= FRAMES - 5; index += 1) {
    view.render(frameAt(index * SWEEP_STEP_METRES));
    drawn += 1;
  }
  return drawn;
}

/** The scenery budget the `?realistic` run draws one frame at — #478. @see RealisticMeasurement.sceneryDrawnBudgeted */
const REALISTIC_PROBE_BUDGET = 6;

/** One frame's opaque-pass draw order, counted — #619 lever 1. @see foliageOrderOf */
export interface FoliageOrder {
  readonly cut: number;
  readonly opaque: number;
  readonly cutBeforeOpaque: number;
}

/**
 * Counts a frame's opaque-pass draws: the transparent pass comes after every
 * opaque draw whatever the order, so it is left out.
 */
function foliageOrderOf(pieces: readonly DrawnPiece[]): FoliageOrder {
  const opaquePass = pieces.filter((piece) => !piece.transparent);
  const lastOpaque = opaquePass.map((piece) => !piece.cut).lastIndexOf(true);
  return {
    cut: opaquePass.filter((piece) => piece.cut).length,
    opaque: opaquePass.filter((piece) => !piece.cut).length,
    cutBeforeOpaque: opaquePass.slice(0, Math.max(0, lastOpaque)).filter((piece) => piece.cut)
      .length,
  };
}

/** What {@link groundBlobProbe} measures — #620. Every colour is a mean of sRGB bytes. */
export interface GroundBlobMeasurement {
  /** The ground at the tree's blob's middle, and 5 m from it, with the blobs drawn. */
  readonly probe: readonly number[];
  readonly reference: readonly number[];
  /** The same two points with the blobs hidden — the control. */
  readonly probeHidden: readonly number[];
  readonly referenceHidden: readonly number[];
  /** How far the probe is from the blob's middle as a share of its rim, and whether no tree covers it. */
  readonly probeRim: number;
  readonly probeClear: boolean;
  /** How far the reference is from the blob's middle, as a share of its rim (≥ 1 is outside it). */
  readonly referenceRim: number;
  readonly referenceClear: boolean;
  /** Metres between the two points, horizontally. */
  readonly referenceMetres: number;
  /** A point on the verge 0.5 m off the road's edge under a blob, drawn and hidden. */
  readonly verge: readonly number[];
  readonly vergeHidden: readonly number[];
  /** How far the verge point is from its blob's middle, as a share of its rim. */
  readonly vergeRim: number;
  /** Whether no tree covers the verge point. */
  readonly edgeClear: boolean;
  /**
   * The SHIPPED shader's road clip, made observable on level ground — #686's
   * review. @see GroundBlobClipMeasurement
   */
  readonly clip: GroundBlobClipMeasurement;
  /** Draw calls for the probe frame with the blobs, and without. */
  readonly drawCalls: number;
  readonly drawCallsHidden: number;
  /** The blobs and their triangles in the probe frame, and in the wooded valley frame. */
  readonly blobs: number;
  readonly triangles: number;
  readonly woodedBlobs: number;
  readonly woodedTriangles: number;
}

/**
 * The road clip of `three-renderer.ts` §`GROUND_BLOB_VERTEX` and
 * §`GROUND_BLOB_FRAGMENT`, read back off the drawing buffer — #686's review.
 *
 * Tree A's blob is drawn with a clip plane forced through its middle, facing
 * the screen's right, so the shader should keep the right half and discard
 * the left; then — **the control** — with both planes the no-op `(0, 0, −1)`,
 * so both halves darken. Each colour is a mean of sRGB bytes at one point, the
 * blobs drawn and hidden; `expected` is `ground-blob.ts` §`groundBlobAlpha`
 * at that point.
 */
export interface GroundBlobClipMeasurement {
  /** Whether the harness could reach the blob mesh's clip attributes at all. */
  readonly measured: boolean;
  /** The point on the side the forced plane keeps, and the one it clips. */
  readonly kept: GroundBlobClipPoint;
  readonly clipped: GroundBlobClipPoint;
}

export interface GroundBlobClipPoint {
  /** Metres from the forced plane, positive on the kept side. */
  readonly metres: number;
  /** Pixels between the point and the plane's line through the blob's middle, on screen. */
  readonly pixels: number;
  /** Whether no tree covers the strip read. */
  readonly clear: boolean;
  /** How far from the middle as a share of the rim, and the blob's alpha there. */
  readonly rim: number;
  readonly expected: number;
  /** The forced plane, the control's no-op planes, and the blobs hidden. */
  readonly forced: readonly number[];
  readonly control: readonly number[];
  readonly hidden: readonly number[];
}

const NO_CLIP_POINT: GroundBlobClipPoint = {
  metres: 0,
  pixels: 0,
  clear: false,
  rim: 0,
  expected: 0,
  forced: [],
  control: [],
  hidden: [],
};

const NO_GROUNDING: GroundBlobMeasurement = {
  probe: [],
  reference: [],
  probeHidden: [],
  referenceHidden: [],
  probeRim: 0,
  probeClear: false,
  referenceRim: 0,
  referenceClear: false,
  referenceMetres: 0,
  verge: [],
  vergeHidden: [],
  vergeRim: 0,
  edgeClear: false,
  clip: { measured: false, kept: NO_CLIP_POINT, clipped: NO_CLIP_POINT },
  drawCalls: 0,
  drawCallsHidden: 0,
  blobs: 0,
  triangles: 0,
  woodedBlobs: 0,
  woodedTriangles: 0,
};

/**
 * What the realistic textures were handed to the GPU as — #618. @see textureProbe
 */
export interface TextureMeasurement {
  /** The compressed-texture extensions THIS context offers, and the platform, which decide the formats. */
  readonly offered: readonly string[];
  readonly platform: string;
  /**
   * Whether `KTX2Loader.detectSupport`'s own Linux rule applies here — Linux
   * outside Android offering ASTC, ETC2, BPTC and S3TC together, where it
   * turns ASTC and ETC off because a desktop driver decodes them in software.
   * SwiftShader on the CI runner is that case, and draws BC7.
   */
  readonly desktopRule: boolean;
  /** Every texture the loaded world holds but the sky, as `realisticTextureReport` labels it. */
  readonly worn: readonly {
    readonly role: string;
    readonly format: string;
    readonly bytes: number;
    /** The base level's size, which the spec derives each block chain's bytes from. */
    readonly width: number;
    readonly height: number;
  }[];
  /** The sky, which #618 leaves at half-float. */
  readonly sky: { readonly format: string; readonly bytes: number };
  /** The internal format of every upload a fresh view made of those textures, read off the GL calls. */
  readonly uploads: readonly string[];
  /** How many textures were handed to that view. */
  readonly uploaded: number;
  /**
   * The CONTROL: the road's colour map through a loader told the device offers
   * no compressed format — its label, and what it was uploaded as. It must be
   * RGBA8 and labelled a fallback, or the claim above is about labels.
   */
  readonly control: {
    readonly format: string;
    readonly compressed: boolean;
    readonly uploads: readonly string[];
  };
}

const NO_TEXTURES: TextureMeasurement = {
  offered: [],
  platform: '',
  desktopRule: false,
  worn: [],
  sky: { format: '', bytes: 0 },
  uploads: [],
  uploaded: 0,
  control: { format: '', compressed: false, uploads: [] },
};

/**
 * A GL internal format by name — the ones a realistic texture can be uploaded
 * as. WebGL 2 has no query for a texture's format once it is uploaded, so the
 * probe reads the argument the renderer passed.
 */
const GL_TEXTURE_FORMATS: ReadonlyMap<number, string> = new Map([
  [0x93b0, 'ASTC 4x4'],
  [0x93d0, 'ASTC 4x4'],
  [0x9274, 'ETC2 RGB'],
  [0x9275, 'ETC2 RGB'],
  [0x9278, 'ETC2 RGBA'],
  [0x9279, 'ETC2 RGBA'],
  [0x8d64, 'ETC1'],
  [0x8e8c, 'BC7'],
  [0x8e8d, 'BC7'],
  [0x83f0, 'BC1'],
  [0x83f1, 'BC1'],
  [0x8c4c, 'BC1'],
  [0x8c4d, 'BC1'],
  [0x83f3, 'BC3'],
  [0x8c4f, 'BC3'],
  [0x8058, 'RGBA8'],
  [0x8c43, 'RGBA8'],
]);

/** Records the internal format of every texture upload `body` makes, by name. */
function recordingUploads(body: () => void): string[] {
  const gl = WebGL2RenderingContext.prototype;
  /* eslint-disable @typescript-eslint/unbound-method */
  const storage = gl.texStorage2D;
  const compressed = gl.compressedTexImage2D;
  const image = gl.texImage2D;
  /* eslint-enable @typescript-eslint/unbound-method */
  const seen: string[] = [];
  const note = (internal: number): void => {
    seen.push(GL_TEXTURE_FORMATS.get(internal) ?? `0x${internal.toString(16)}`);
  };
  gl.texStorage2D = function (this: WebGL2RenderingContext, ...args: Parameters<typeof storage>) {
    note(args[2]);
    storage.apply(this, args);
  };
  gl.compressedTexImage2D = function (this: WebGL2RenderingContext, ...args: unknown[]) {
    if (args[1] === 0) note(args[2] as number);
    (compressed as (...rest: unknown[]) => void).apply(this, args);
  };
  gl.texImage2D = function (this: WebGL2RenderingContext, ...args: unknown[]) {
    if (args[1] === 0) note(args[2] as number);
    (image as (...rest: unknown[]) => void).apply(this, args);
  };
  try {
    body();
  } finally {
    gl.texStorage2D = storage;
    gl.compressedTexImage2D = compressed;
    gl.texImage2D = image;
  }
  return seen;
}

/**
 * The realistic textures, uploaded and read back — #618.
 *
 * On a FRESH view, so every texture is uploaded here rather than having been
 * uploaded already by a frame the probe drew: three uploads a texture once.
 * Then the control, on the same view: the road's colour map transcoded for a
 * device that offers nothing, which must go up as RGBA8 and be labelled so.
 */
async function textureProbe(canvasOf: () => HTMLCanvasElement): Promise<TextureMeasurement> {
  const canvas = canvasOf();
  const view = threeGameRenderer.create(canvas, REALISTIC_LADDER[0] as QualitySettings);
  view.resize(64, 64);
  const gl = canvas.getContext('webgl2');
  try {
    if (gl === null) return NO_TEXTURES;
    const offered = (gl.getSupportedExtensions() ?? []).filter((name) =>
      /compressed|compression/.test(name),
    );
    const platform = navigator.platform;
    const has = (name: string): boolean => offered.includes(name);
    const desktopRule =
      platform.includes('Linux') &&
      !navigator.userAgent.includes('Android') &&
      has('WEBGL_compressed_texture_astc') &&
      has('WEBGL_compressed_texture_etc') &&
      has('EXT_texture_compression_bptc') &&
      has('WEBGL_compressed_texture_s3tc');
    const report = realisticTextureReport();
    let uploaded = 0;
    const uploads = recordingUploads(() => {
      uploaded = uploadRealisticTexturesOf(view);
    });
    const none = compressedRealisticLoaders({ has: () => false, get: () => null });
    let control: TextureMeasurement['control'];
    try {
      const texture = await none.texture(realisticUrl(REALISTIC_SURFACES.road.colour));
      const label = realisticTextureFormat(texture);
      const controlUploads = recordingUploads(() => {
        uploadRealisticTexturesOf(view, [texture]);
      });
      texture.dispose();
      control = { format: label.format, compressed: label.compressed, uploads: controlUploads };
    } finally {
      none.dispose();
    }
    const sky = report.find((each) => each.role === 'sky');
    return {
      offered,
      platform,
      desktopRule,
      worn: report
        .filter((each) => each.role !== 'sky')
        .map(({ role, format, bytes, width, height }) => ({ role, format, bytes, width, height })),
      sky: { format: sky?.format ?? '', bytes: sky?.bytes ?? 0 },
      uploads,
      uploaded,
      control,
    };
  } finally {
    view.destroy();
  }
}

/**
 * The realistic front tyre's tread, read back — #624. Luma is the 8-bit
 * `luminanceOf` of each pixel of a square of the tyre; `variance` is over
 * that square.
 */
export interface TreadMeasurement {
  /** How many pixels the square is. */
  readonly pixels: number;
  /** As the product draws it. */
  readonly variance: number;
  readonly mean: number;
  /** THE CONTROL: the same frame with the rubber's normal map off. */
  readonly controlVariance: number;
  /** The same square with no bicycle in the frame — what says the square is the tyre. */
  readonly emptyMean: number;
  /** How far from the eye the square is, in metres. */
  readonly distanceMetres: number;
  /**
   * The mean sRGB of a 3 × 3 square of the right fork leg, the same bicycle
   * drawn as each of the three riders in turn — #368's tint, still on the
   * paint now that the paint has a roughness map.
   */
  readonly forks: Readonly<Record<'rider' | 'bot' | 'ghost', readonly number[]>>;
}

const NO_TREAD: TreadMeasurement = {
  pixels: 0,
  variance: 0,
  mean: 0,
  controlVariance: 0,
  emptyMean: 0,
  distanceMetres: 0,
  forks: { rider: [], bot: [], ghost: [] },
};

/**
 * Where the front tyre is read — #624: the camera brought down to 0.45 m, the
 * bicycle turned to face it, and the TREAD read a quarter turn up the wheel
 * from the contact patch, where it faces the eye, 0.8 m from it.
 *
 * ⚠️ **A quarter turn up, and not at the contact patch itself — measured.**
 * The tread is the crown all the way round; at the patch it faces the road and
 * is lit by nothing but the ground, and on 2026-09-27 a square 50° round from
 * it read luma 2 of 255 with a variance of 0.0003 with the tread and without,
 * where 90° round read 26 and told them apart four times over. And close, for
 * the mipmaps: at the chase camera 4.5 m back and 2 m up a tread period is
 * under two pixels of this probe's 640 × 360, where the ridges average toward
 * flat — which is what a rider on a phone sees too, and why the owner's look
 * is at `?at=900` and on the tablet.
 *
 * The square is 3 × 9: narrow ACROSS the tyre, where its own curve turns the
 * light fastest, and long ALONG it, over about one tread period.
 *
 * ⚠️ Moving any of these moves the light on the square, and so the absolute
 * window `game.browser.spec.ts` holds the tread to — read
 * §`TREAD_VARIANCE_OVER_CONTROL` there before changing one.
 */
const TREAD_PROBE_EYE_METRES = 0.45;
const TREAD_PROBE_DISTANCE_METRES = 0.8;
const TREAD_PROBE_ROUND_DEGREES = 90;
const TREAD_PROBE_HALF = { across: 1, along: 4 } as const;

/**
 * The front tyre's tread in the realistic world, read back — #624.
 *
 * One rider, turned to face a camera brought low, on a bare level road; a
 * square of pixels on the front tyre's tread 90° round from the road, aimed from the
 * wheel's own geometry (`bicycle.ts` §`RIDER_BICYCLE_PARTS`) through the frame's
 * own camera ({@link pixelFor}), never from fractions of the frame. Its luma
 * variance is the tread's shading.
 *
 * **The control** is the same frame with the rubber's normal map off
 * (`three-renderer.ts` §`bicycleTreadOf`): what is left is the tyre's curve and
 * the light across it, and that must fall below the floor the product is held
 * above. **The empty frame** — no bicycle at all — says the square was the
 * tyre and not the road behind it.
 */
function treadProbe(
  view: GameView,
  gl: WebGL2RenderingContext,
  canvas: HTMLCanvasElement,
  base: SceneFrame,
): TreadMeasurement {
  const [rider] = base.markers.filter((marker) => marker.kind === 'rider');
  const front = RIDER_BICYCLE_PARTS.find((part) => part.solid.shape === 'ring' && part.z > 0);
  const fork = RIDER_BICYCLE_PARTS.find((part) => part.name === 'fork 1');
  if (
    rider === undefined ||
    front === undefined ||
    fork === undefined ||
    front.solid.shape !== 'ring'
  ) {
    return NO_TREAD;
  }
  const outer = front.solid.radius + front.solid.thickness;
  const pose = base.camera;
  const roadY = pose.y;
  const camera: CameraPose = {
    ...pose,
    eyeRoadY: roadY + TREAD_PROBE_EYE_METRES - CAMERA_ABOVE_METRES,
    targetRoadY: roadY + TREAD_PROBE_EYE_METRES / 2,
  };
  const { eye } = cameraRig(camera);
  // Facing the camera: the bicycle's heading is back along the camera's.
  const facing = { x: -pose.headingX, z: -pose.headingZ };
  const round = (TREAD_PROBE_ROUND_DEGREES * Math.PI) / 180;
  // The hub is placed so the probed point is TREAD_PROBE_DISTANCE_METRES from
  // the eye along the ground, and the marker behind the hub by the hub's own z.
  const hubAhead = TREAD_PROBE_DISTANCE_METRES + outer * Math.sin(round);
  const hub = { x: eye.x + pose.headingX * hubAhead, z: eye.z + pose.headingZ * hubAhead };
  const marker = {
    ...rider,
    x: hub.x - facing.x * front.z,
    y: roadY,
    z: hub.z - facing.z * front.z,
    headingX: facing.x,
    headingZ: facing.z,
    lean: 0,
    bodyLean: 0,
  };
  const point = {
    x: hub.x + facing.x * outer * Math.sin(round),
    y: roadY + front.y - outer * Math.cos(round),
    z: hub.z + facing.z * outer * Math.sin(round),
  };
  const frame: SceneFrame = { ...base, camera, markers: [marker], scatter: [] };
  const empty: SceneFrame = { ...frame, markers: [] };
  const centre = pixelFor(frame, canvas, point);
  const width = TREAD_PROBE_HALF.across * 2 + 1;
  const height = TREAD_PROBE_HALF.along * 2 + 1;
  const lumas = (scene: SceneFrame): number[] => {
    view.render(scene);
    view.render(scene);
    const pixels = readRegion(
      gl,
      Math.round(centre.x) - TREAD_PROBE_HALF.across,
      Math.round(centre.y) - TREAD_PROBE_HALF.along,
      width,
      height,
    );
    const out: number[] = [];
    for (let at = 0; at < pixels.length; at += 4) {
      out.push(luminanceOf([pixels[at] ?? 0, pixels[at + 1] ?? 0, pixels[at + 2] ?? 0, 255]));
    }
    return out;
  };
  const meanOf = (values: readonly number[]): number =>
    values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
  const varianceOf = (values: readonly number[]): number => {
    const mean = meanOf(values);
    return meanOf(values.map((value) => (value - mean) ** 2));
  };
  const product = lumas(frame);
  let control: number[];
  try {
    bicycleTreadOf(view, false);
    control = lumas(frame);
  } finally {
    bicycleTreadOf(view, true);
  }
  const emptied = lumas(empty);
  // #368: the same bicycle as each rider in turn, a square of its fork read.
  // A point in the bicycle's own frame is `x` across it and `z` along its
  // heading: across is the heading turned a quarter to the right.
  const forkPoint = {
    x: marker.x + fork.x * facing.z + fork.z * facing.x,
    y: roadY + fork.y,
    z: marker.z - fork.x * facing.x + fork.z * facing.z,
  };
  const forkAt = pixelFor(frame, canvas, forkPoint);
  const forkOf = (kind: 'rider' | 'bot' | 'ghost'): number[] => {
    const scene: SceneFrame = { ...frame, markers: [{ ...marker, kind }] };
    view.render(scene);
    view.render(scene);
    const pixels = readRegion(gl, Math.round(forkAt.x) - 1, Math.round(forkAt.y) - 1, 3, 3);
    return [0, 1, 2].map((channel) => {
      let sum = 0;
      for (let at = channel; at < pixels.length; at += 4) sum += pixels[at] ?? 0;
      return sum / 9;
    });
  };
  const forks = { rider: forkOf('rider'), bot: forkOf('bot'), ghost: forkOf('ghost') };
  return {
    pixels: product.length,
    variance: varianceOf(product),
    mean: meanOf(product),
    controlVariance: varianceOf(control),
    emptyMean: meanOf(emptied),
    distanceMetres: Math.hypot(point.x - eye.x, point.y - eye.y, point.z - eye.z),
    forks,
  };
}

/**
 * The realistic rider's back, read back — #623. Luma is the 8-bit
 * `luminanceOf` of each pixel of a square of the back; `variance` is over it.
 */
export interface KitMeasurement {
  /** How many pixels the square is. */
  readonly pixels: number;
  /** As the product draws it. */
  readonly variance: number;
  /** THE CONTROL: the same frame with the kit drawn in its own mean colour. */
  readonly controlVariance: number;
  /** The same square with no rider — what says the square is the rider's back. */
  readonly emptyMean: number;
  readonly mean: number;
  /**
   * The mean sRGB of the square, the same rider drawn as each of the three in
   * turn — #368's measure, on a textured body.
   */
  readonly backs: Readonly<Record<'rider' | 'bot' | 'ghost', readonly number[]>>;
  /**
   * #623's second half: the rider's back in a CHOSEN kit colour
   * ({@link KIT_PROBE_CHOICE}), and — the control — the same frame after the
   * view is told the house kit again. The mean sRGB of the same square, as
   * {@link backs}. A renderer that ignored the choice reads the two alike.
   */
  readonly chosen: { readonly colour: KitColour; readonly back: readonly number[] };
  readonly house: readonly number[];
  /**
   * #623's review (B1): the same square after the view was dressed in
   * {@link KIT_PROBE_CHOICE} while it held NO realistic drawing — stepped down
   * to the stylised world — and then stepped back, which builds the drawing
   * again. On a ride that is the only way the kit reaches the realistic
   * rider: `GameView` dresses the view straight after `create`, before its
   * first realistic render builds the drawing, and a step down and back
   * builds it anew. Both go through the drawing's CONSTRUCTOR, where
   * {@link chosen} dresses a drawing that already exists and cannot see it.
   */
  readonly dressedWithNoDrawing: readonly number[];
}

const NO_KIT: KitMeasurement = {
  pixels: 0,
  variance: 0,
  controlVariance: 0,
  emptyMean: 0,
  mean: 0,
  backs: { rider: [], bot: [], ghost: [] },
  chosen: { colour: 'house', back: [] },
  house: [],
  dressedWithNoDrawing: [],
};

/**
 * The non-default palette entry the rider's back is read in — #623. Magenta,
 * because its hue is the furthest of the palette's from the house teal's, so a
 * renderer that drew the house kit instead reads green over red where magenta
 * reads red over green: the two cannot be mistaken for each other.
 */
const KIT_PROBE_CHOICE: KitColour = 'magenta';

/**
 * Where the rider's back is read — #623: the camera brought to KIT_PROBE_EYE
 * metres above the road, KIT_PROBE_BEHIND behind the rider, looking down at
 * the middle of the back, where the kit's mark and the pockets' seams are. The
 * square is KIT_PROBE_HALF either side of that point, so it takes in the
 * mark's edges, the jersey round it and a seam, never one flat panel alone.
 */
const KIT_PROBE_EYE_METRES = 1.75;
const KIT_PROBE_BEHIND_METRES = 1.6;
const KIT_PROBE_HALF = 8;
/** How far the back's surface stands off the line from hips to shoulders. */
const KIT_PROBE_BACK_METRES = 0.1;

/**
 * The realistic rider's back, read back — #623.
 *
 * One rider, from behind, on a bare level road, with a camera brought close; a
 * square of pixels on the middle of its back, aimed from `bicycle.ts`
 * §`riderJoints` — the hips and the shoulders the renderer poses the body to —
 * through the frame's own camera ({@link pixelFor}). Its luma variance is the
 * kit's pattern and relief.
 *
 * **The control** is the same frame with the kit drawn in its own mean colour
 * (`three-renderer.ts` §`riderKitOf`): what is left is the body's shape, its
 * relief and the light, and that must fall below the floor the kit is held
 * above. **The empty frame** says the square was the rider.
 */
function kitSquare(base: SceneFrame, canvas: HTMLCanvasElement): KitSquare | undefined {
  const [rider] = base.markers.filter((marker) => marker.kind === 'rider');
  if (rider === undefined) return undefined;
  const pose = base.camera;
  const roadY = pose.y;
  const heading = { x: pose.headingX, z: pose.headingZ };
  const camera: CameraPose = {
    ...pose,
    eyeRoadY: roadY + KIT_PROBE_EYE_METRES - CAMERA_ABOVE_METRES,
    targetRoadY: roadY + 1,
  };
  const { eye } = cameraRig(camera);
  const joints = riderJoints(0, emptyRiderJoints(), 0);
  // The rider faces the way the camera looks, its hips KIT_PROBE_BEHIND ahead.
  const ahead = KIT_PROBE_BEHIND_METRES - joints.hips.z;
  const marker = {
    ...rider,
    x: eye.x + heading.x * ahead,
    y: roadY,
    z: eye.z + heading.z * ahead,
    headingX: heading.x,
    headingZ: heading.z,
    lean: 0,
    bodyLean: 0,
    crankAngle: 0,
  };
  // The middle of the back: between the hips and the shoulders, stood off the
  // line between them towards the sky and the tail.
  const dy = joints.shoulders.y - joints.hips.y;
  const dz = joints.shoulders.z - joints.hips.z;
  const length = Math.hypot(dy, dz);
  const local = {
    y: joints.hips.y + 0.5 * dy + (KIT_PROBE_BACK_METRES * dz) / length,
    z: joints.hips.z + 0.5 * dz - (KIT_PROBE_BACK_METRES * dy) / length,
  };
  const point = {
    x: marker.x + local.z * heading.x,
    y: roadY + local.y,
    z: marker.z + local.z * heading.z,
  };
  const frame: SceneFrame = { ...base, camera, markers: [marker], scatter: [] };
  return { frame, marker, centre: pixelFor(frame, canvas, point) };
}

/** The frame {@link kitProbe} reads the rider's back in, and where. */
interface KitSquare {
  readonly frame: SceneFrame;
  readonly marker: RiderMarker;
  readonly centre: { readonly x: number; readonly y: number };
}

/** A {@link KitSquare}'s pixels, `scene` drawn twice first. */
function readKitSquare(
  view: GameView,
  gl: WebGL2RenderingContext,
  square: KitSquare,
  scene: SceneFrame = square.frame,
): Uint8Array {
  view.render(scene);
  view.render(scene);
  const side = KIT_PROBE_HALF * 2 + 1;
  return readRegion(
    gl,
    Math.round(square.centre.x) - KIT_PROBE_HALF,
    Math.round(square.centre.y) - KIT_PROBE_HALF,
    side,
    side,
  );
}

/** The mean 8-bit sRGB of a square of pixels. */
function meanRgbOf(pixels: Uint8Array): number[] {
  return [0, 1, 2].map((channel) => {
    let sum = 0;
    for (let at = channel; at < pixels.length; at += 4) sum += pixels[at] ?? 0;
    return sum / (pixels.length / 4);
  });
}

/** @see kitSquare */
function kitProbe(
  view: GameView,
  gl: WebGL2RenderingContext,
  canvas: HTMLCanvasElement,
  base: SceneFrame,
): KitMeasurement {
  const square = kitSquare(base, canvas);
  if (square === undefined) return NO_KIT;
  const { frame, marker } = square;
  const read = (scene: SceneFrame): Uint8Array => readKitSquare(view, gl, square, scene);
  const lumas = (pixels: Uint8Array): number[] => {
    const out: number[] = [];
    for (let at = 0; at < pixels.length; at += 4) {
      out.push(luminanceOf([pixels[at] ?? 0, pixels[at + 1] ?? 0, pixels[at + 2] ?? 0, 255]));
    }
    return out;
  };
  const meanOf = (values: readonly number[]): number =>
    values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
  const varianceOf = (values: readonly number[]): number => {
    const mean = meanOf(values);
    return meanOf(values.map((value) => (value - mean) ** 2));
  };
  const rgbOf = meanRgbOf;
  const product = lumas(read(frame));
  let control: number[];
  try {
    riderKitOf(view, false);
    control = lumas(read(frame));
  } finally {
    riderKitOf(view, true);
  }
  const emptied = lumas(read({ ...frame, markers: [] }));
  const backOf = (kind: 'rider' | 'bot' | 'ghost'): number[] =>
    rgbOf(read({ ...frame, markers: [{ ...marker, kind }] }));
  const backs = { rider: backOf('rider'), bot: backOf('bot'), ghost: backOf('ghost') };
  // #623: the same frame in the chosen colour, then — the control — told the
  // house kit again, through the product's own `setRiderKit`.
  let chosen: number[];
  try {
    view.setRiderKit(KIT_PROBE_CHOICE);
    chosen = rgbOf(read(frame));
  } finally {
    view.setRiderKit('house');
  }
  const house = rgbOf(read(frame));
  return {
    pixels: product.length,
    variance: varianceOf(product),
    controlVariance: varianceOf(control),
    emptyMean: meanOf(emptied),
    mean: meanOf(product),
    backs,
    chosen: { colour: KIT_PROBE_CHOICE, back: chosen },
    house,
    dressedWithNoDrawing: NO_KIT.dressedWithNoDrawing,
  };
}

/** What the `?realistic` run measures — ADR 0026. @see realisticProbe */
export interface RealisticMeasurement {
  readonly measured: boolean;
  /** #622: the air, read and predicted. @see airProbe */
  readonly air: AirMeasurement;
  /** #628: the worn road's wheel track against its lane, worn and not. @see roadWearProbe */
  readonly roadWear: RoadWearMeasurement;
  /** #627: a steep bank against level grass, blended and not. @see groundBlendProbe */
  readonly groundBlend: GroundBlendMeasurement;
  /** #630: the far band lit by the world's sun, and a tree in the breeze. @see foliageProbe */
  readonly foliage: FoliageMeasurement;
  /** #679: a finish gantry's banner, read, and what the gantries cost. @see gantryProbe */
  readonly gantry: GantryMeasurement;
  /** #629: a lake's near and grazing water, reflecting and held. @see waterReflectionProbe */
  readonly waterReflection: WaterReflectionMeasurement;
  /**
   * #622: visible meshes that three fogs, in the realistic frame and in the
   * same frame drawn stylised — how many breathe the realistic air, and how
   * many are fogged and do not, apart from the two both worlds share (the
   * water, #629, and the riders' contact shadows).
   */
  readonly atmosphere: {
    readonly realisticTaught: number;
    readonly realisticUntaught: number;
    readonly realisticShared: number;
    readonly stylisedTaught: number;
    readonly stylisedFogged: number;
  };
  /** #618: what the textures were handed to the GPU as, and the RGBA8 control. @see textureProbe */
  readonly textures: TextureMeasurement;
  /**
   * #618: milliseconds from asking for the world to the first realistic frame
   * finished on this machine's GPU — the load, a view, and the frame that
   * uploads what it draws. Published, never asserted: SwiftShader is not the
   * tablet, whose figure is validation 0002's.
   */
  readonly firstFrameMs: number;
  /** Which world a realistic rung drew BEFORE anything was loaded: D-7's fallback. */
  readonly fallbackWorld: string;
  /** What a load that could not reach its files reported, and what a rider is told. */
  readonly failedLoad: { readonly loaded: boolean; readonly offline: boolean };
  readonly failedNotice: string;
  /** The real load: whether it succeeded, and how long it took on this machine. */
  readonly loaded: boolean;
  readonly loadMs: number;
  /** Which world a realistic rung drew once the world was loaded. */
  readonly drawnWorld: string;
  /** Visible meshes by material class, and how many of the physically based ones this file constructed. */
  readonly visibleStandard: number;
  readonly visibleStandardConstructed: number;
  readonly visiblePhysical: number;
  readonly visibleImpostors: number;
  readonly visibleImpostorsConstructed: number;
  /** Textures three created for the first realistic frame. */
  readonly texturesCreated: number;
  /** Draw calls for a realistic frame, and for the same frame with the road emptied. */
  readonly drawCalls: number;
  readonly drawCallsWithoutRoad: number;
  /** Mean relative luminance of the road 20 m ahead, on the steepest climb and descent, and on the level. */
  readonly climbLuminance: number;
  readonly descentLuminance: number;
  /** #628: the climb and the descent with the road's wear off — published, for the margin the wear spent. */
  readonly unwornClimbLuminance: number;
  readonly unwornDescentLuminance: number;
  readonly levelClimbLuminance: number;
  readonly levelDescentLuminance: number;
  /** Pixels that changed when the rider's cranks turned, and when the cadence went and they were held. */
  readonly crankTurnPixels: number;
  readonly crankHeldPixels: number;
  /** How far the realistic frame differs from the stylised one across the whole picture, as a share. */
  readonly worldChangedShare: number;
  /**
   * #619 lever 1: the wooded frame's opaque-pass draws, in the order three made
   * them — `cut` draws are alpha-tested leaves and billboards, `opaque` the
   * rest, and `cutBeforeOpaque` how many cut draws came before the LAST opaque
   * one. The product's order is the first; `…Control` is the order three
   * chose unasked (`foliageOrderedOf(view, false)`), which must interleave.
   */
  readonly foliageOrder: FoliageOrder;
  readonly foliageOrderControl: FoliageOrder;
  /** #619 lever 1: pixels that differ between the two orders' frames. Zero: the order is a cost, not a picture. */
  readonly foliageOrderChangedPixels: number;
  /**
   * #619 lever 2: the share of the wooded frame that changes when a rung's
   * texture bias is taken to 0 — at the second realistic rung, which carries
   * one, and at the top rung, the control, which must carry none.
   */
  readonly textureBiasReducedShare: number;
  readonly textureBiasTopShare: number;
  /**
   * #478: the scenery items the realistic world drew for the same frame at the
   * top rung, and at a rung whose budget is `sceneryProbeBudget` — the line in
   * `setQuality` that hands both belts the rung's budget, which jsdom cannot
   * reach because it has no view without a GL context.
   */
  readonly sceneryProbeBudget: number;
  readonly sceneryDrawnTop: number;
  readonly sceneryDrawnBudgeted: number;
  /** After stepping down to the stylised ladder: which world, and how many physically based meshes remain visible. */
  readonly afterStepDownWorld: string;
  /** #629: whether the water still reflected the environment map after the step down — it must not. */
  readonly waterReflectsAfterStepDown: boolean;
  readonly afterStepDownStandard: number;
  /**
   * #501's review: whether the bridges wore the photographed stone on the
   * realistic rung, and — the control — whether they still did after the step
   * down. @see bridgesWearStoneOf
   */
  readonly bridgesWearStone: boolean;
  readonly bridgesWearStoneAfterStepDown: boolean;
  /** SwiftShader milliseconds a frame — published, never asserted. */
  readonly realisticFrameMs: number;
  readonly stylisedFrameMs: number;
  /**
   * #475: the sky colour the water reflected in the last realistic frame and
   * in the last stylised one, linear RGB — the realistic sky's hue at the
   * stylised sky's brightness. @see waterSkyOf
   */
  readonly waterSkyRealistic: readonly number[];
  readonly waterSkyStylised: readonly number[];
  /**
   * #500: the mean sRGB of a small square at a house's front ground-floor
   * window, facing the camera, read back off the drawing buffer — and the
   * same square on a view built with no openings, which must read the wall
   * — and a square of that same wall beside the window, for scale.
   */
  readonly windowGlass: readonly number[];
  readonly windowControl: readonly number[];
  readonly windowWall: readonly number[];
  /** #621: two trees and two houses of one shape, tinted and not. @see tintProbe */
  readonly tint: TintMeasurement;
  /** #620: the ground under a tree's blob and 5 m from it, with and without the blobs. @see groundBlobProbe */
  readonly grounding: GroundBlobMeasurement;
  /** #624: the front tyre's tread, read back, with and without its normal map. @see treadProbe */
  readonly tread: TreadMeasurement;
  /** #623: the rider's back, read back, with the kit and in its mean colour. @see kitProbe */
  readonly kit: KitMeasurement;
  /**
   * #544: the distant hills against the sky, read off the drawing buffer — as
   * the product draws them, and (the control) with the view's horizon put back
   * to the stylised world's pale one, which is the band the owner saw.
   * @see horizonReadings
   */
  readonly horizon: readonly HorizonReading[];
  readonly horizonControl: readonly HorizonReading[];
  /** The fog's colour and the ring's foot, linear, as drawn and in the control. @see horizonColoursOf */
  readonly horizonColours: {
    readonly fog: readonly number[];
    readonly foot: readonly number[];
  };
  readonly horizonColoursControl: {
    readonly fog: readonly number[];
    readonly foot: readonly number[];
  };
  /**
   * What the control's fog and foot must be: the last control frame's own
   * `world.horizonColour` — the stylised world's pale horizon — in linear
   * light, so the gate pins that the control really is today's band.
   */
  readonly horizonControlExpected: readonly number[];
}

/**
 * The trees' levels of detail — #617, measured by a load of their own since
 * #644 (`?realistic&trees`), because inside the `?realistic` load they were
 * more than half of it and took it past its budget. @see treeLevelRun
 */
export interface TreeLevelMeasurement {
  /** Whether the load measured anything at all. */
  readonly measured: boolean;
  /**
   * The world the product's view drew the wooded frame in — which must be the
   * realistic one, or every count below is the stylised world's, where a tree
   * has no middle level to hand over to. #644: the `?realistic` load asserts
   * its own world; a load of their own has to assert this one's.
   */
  readonly drawnWorld: string;
  /**
   * #617: the triangles one frame of the wooded view submits at the WebGL draw
   * calls (`realistic/draws.ts` §`trianglesInDraw`), as the product draws its
   * trees and — the control — with the hard swap and no middle level
   * (`realistic-budget.ts` §`HARD_SWAP_TREE_LEVELS`), on the same view.
   */
  readonly trianglesSubmitted: number;
  readonly trianglesHardSwap: number;
  /**
   * #639: the draw calls the same frame of the wooded view makes, counted at
   * the same entry points (#616's counter), as the product draws its trees.
   */
  readonly drawCallsSubmitted: number;
  /**
   * #639's control: the same frame from a world loaded with each tree's parts
   * kept one per material, as every load was before #639
   * (`three-renderer.ts` §`setRealisticMaterialsMerged`) — its draw calls and
   * triangles, and how many of the frame's pixels differ from the product's,
   * of how many compared.
   */
  readonly drawCallsUnmerged: number;
  readonly trianglesUnmerged: number;
  readonly unmergedPixelsChanged: number;
  readonly pixelsCompared: number;
  /** How many scenery items the wooded view drew, so a view with no trees is not a saving. */
  readonly woodedScenery: number;
  /** @see TreeHandOver */
  readonly handOver: TreeHandOver;
  readonly handOverControl: TreeHandOver;
  /**
   * #617's review: the pixels the hand-over's seven off-screen trees cover on
   * their own — which must be none, or the watched tree's covered area is
   * not the watched tree's.
   */
  readonly handOverOffScreenCovered: number;
  /**
   * #617's review: the triangles ONE tree 12 m ahead adds to a frame in which
   * two more stand behind the camera — as the product ranks them (the camera
   * sees only this one, so it is the full mesh), and as the ranking before
   * the review did (the two behind take the full slot and the band, so it is
   * the middle level).
   */
  readonly nearestVisibleTriangles: number;
  readonly nearestVisibleTrianglesControl: number;
}

/**
 * One still tree across both its hand-overs, frame by frame — #617. The trees
 * it is ranked against walk out past it 0.1 m a frame, as a rider's 6 m/s at
 * 60 frames a second would close on it. @see treeLevelProbe
 */
export interface TreeHandOver {
  /** How far the other trees have walked out, in metres, in each frame. */
  readonly out: readonly number[];
  /** The pixels that differ from the same view with no tree at all. */
  readonly covered: readonly number[];
  /**
   * How far the picture's colour moved from the frame before, in 8-bit steps
   * summed over every channel of every pixel. @see colourMoved
   */
  readonly changed: readonly number[];
}

/**
 * One column of the distant hills, read back — #544. Relative luminances
 * (WCAG 2.2's formula) of the sky just above the ridge's crest, the ridge just
 * below it, and the lit ground beside the road, which is what a hill is made
 * of before distance hazes it.
 */
export interface HorizonReading {
  /** Which frame, and how far off the rider's heading the column looks, in degrees. */
  readonly frame: string;
  readonly offAxisDegrees: number;
  readonly sky: number;
  readonly ridge: number;
  readonly ground: number;
  /**
   * The darkest pixel between where the route's own relief puts the crest and
   * just above the crest as drawn — where, before #544, a rider standing above
   * the ridge saw the photograph's own field and treeline over the hills.
   */
  readonly darkestAboveRelief: number;
}

/**
 * The realistic road's wheel track against its lane's middle — #628. Mean
 * relative luminances, each over a 5 × 5 window at every one of
 * {@link WEAR_PROBE_AHEAD} metres up the road, on the left lane's two wheel
 * tracks (`road-wear.ts` §`WHEEL_TRACK_OFFSETS_METRES`) and at that lane's
 * middle, on a level road — with the wear on, and (the control) off.
 */
export interface RoadWearMeasurement {
  readonly measured: boolean;
  /** Route distance of the frame the probe chose: one with no patch in its span. */
  readonly distance: number;
  readonly track: number;
  readonly middle: number;
  readonly trackControl: number;
  readonly middleControl: number;
}

const NO_ROAD_WEAR: RoadWearMeasurement = {
  measured: false,
  distance: 0,
  track: 0,
  middle: 0,
  trackControl: 0,
  middleControl: 0,
};

/** How far up the road the wheel track is read, in metres: past the rider's back (`NEAR_ROAD_PROBE`). */
const WEAR_PROBE_AHEAD: readonly number[] = [14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26];

/**
 * A level road on a bearing of {@link WEAR_PROBE_BEARING_DEGREES} — #628.
 *
 * ⚠️ **Not due north, measured.** The asphalt is mapped in world metres, so on
 * a road running along an axis a strip a fixed distance across it samples ONE
 * column of the photograph all the way up — and two such columns differed by
 * 7.7 % with the wear off, which is no control at all. On a slant the strip
 * crosses the tile's columns as it goes, and the photograph averages out.
 */
function slantedLevelRoute(): ReturnType<typeof northRoute> {
  const bearing = (WEAR_PROBE_BEARING_DEGREES * Math.PI) / 180;
  const metresPerDegree = 111_320;
  const points: RoutePoint[] = [];
  for (let along = 0; along <= 2_000; along += 10) {
    const north = along * Math.cos(bearing);
    const east = along * Math.sin(bearing);
    points.push({
      position: geographicPosition(
        degreesLatitude(51.5 + north / metresPerDegree),
        degreesLongitude(-0.12 + east / (metresPerDegree * Math.cos((51.5 * Math.PI) / 180))),
      ),
      elevation: altitudeMetres(10),
    });
  }
  return routeProfile(points, { loop: false });
}

/** The bearing of {@link slantedLevelRoute}, in degrees: **37**, an axis-free angle. */
const WEAR_PROBE_BEARING_DEGREES = 37;

/** The left lane's middle, across the road — the lane the rider is not in (`NEAR_ROAD_PROBE`). */
const LEFT_LANE_MIDDLE_METRES = -1.75;

/**
 * @see RoadWearMeasurement
 *
 * ⚠️ **On a stretch with no patch**: a patch's tone is a wear term too, and
 * one lying on half of the probe would read as a wheel track's difference or
 * hide one. The frame is chosen by the patches' own rule
 * (`road-wear.ts` §`patchInCell`), not by looking.
 */
function roadWearProbe(
  view: GameView,
  gl: WebGL2RenderingContext,
  canvas: HTMLCanvasElement,
  riding: (profile: ReturnType<typeof northRoute>, distance: number) => SceneFrame,
  route: ReturnType<typeof northRoute>,
): RoadWearMeasurement {
  // The left lane's INNER track. ⚠️ Not the outer one, measured: at 2.55 m
  // out it is 0.8 m from the edge line, and at this camera a 5 × 5 window 26 m
  // up the road reaches the paint — the lane read flat to 0.1 % from 0.7 m to
  // 2.1 m out with the wear off, and 6 % brighter at 2.5 m.
  const tracks = WHEEL_TRACK_OFFSETS_METRES.filter((offset) => offset < 0 && offset > -2);
  const clear = (distance: number): boolean => {
    const from = distance + Math.min(...WEAR_PROBE_AHEAD) - 6;
    const to = distance + Math.max(...WEAR_PROBE_AHEAD) + 6;
    for (
      let cell = Math.floor(from / PATCH_CELL_METRES) - 1;
      cell <= Math.floor(to / PATCH_CELL_METRES) + 1;
      cell += 1
    ) {
      const patch = patchInCell(cell);
      if (
        patch !== undefined &&
        patch.distance + patch.length > from &&
        patch.distance - patch.length < to
      ) {
        return false;
      }
    }
    return true;
  };
  let distance = 400;
  while (!clear(distance) && distance < 1_200) distance += 5;
  const frame: SceneFrame = { ...riding(route, distance), markers: [], scatter: [] };
  const read = (across: readonly number[]): number => {
    let total = 0;
    for (const ahead of WEAR_PROBE_AHEAD) {
      for (const each of across) {
        total += meanLuminanceAround(gl, pixelFor(frame, canvas, onTheRoad(frame, ahead, each)), 2);
      }
    }
    return total / (WEAR_PROBE_AHEAD.length * across.length);
  };
  view.render(frame);
  view.render(frame);
  const worn = { track: read(tracks), middle: read([LEFT_LANE_MIDDLE_METRES]) };
  roadWearOf(view, false);
  view.render(frame);
  view.render(frame);
  const control = { track: read(tracks), middle: read([LEFT_LANE_MIDDLE_METRES]) };
  roadWearOf(view, true);
  return {
    measured: true,
    distance,
    track: worn.track,
    middle: worn.middle,
    trackControl: control.track,
    middleControl: control.middle,
  };
}

/**
 * A lake's water near the camera and at a grazing angle further off — #629.
 * Mean relative luminances (linear) over the bottom and the top
 * {@link WATER_BAND_ROWS} rows of the lake's pixels (where drawing the water
 * changed the frame), in four renders of one frame: as the product draws it;
 * with Fresnel held at 0 — the water's own body, no sky; held at
 * {@link FRESNEL_REFERENCE} — the reference; and held at
 * {@link FRESNEL_CONTROL} — the control.
 *
 * ⚠️ **Why a reference, measured.** The first version divided each band by the
 * body alone and read the grazing water LESS reflective than the near (1.31
 * against 1.59): the far band is mostly fog, which pulls any ratio to 1. The
 * fog mixes in linear light AFTER the Fresnel mix, so `(L − L₀) = (1 − f)·F·(S
 * − B)` for a band's fog share `f`, sky `S` and body `B`, and dividing by the
 * same difference at a KNOWN F cancels the fog, the sky and the body:
 * `F = F_ref · (L − L₀) / (L_ref − L₀)`. The control is the same arithmetic on
 * a frame drawn at another constant F, which must read that constant in both
 * bands.
 */
export interface WaterReflectionMeasurement {
  readonly measured: boolean;
  /** Whether the view's water reflected the environment map. */
  readonly reflects: boolean;
  /** How many of the frame's pixels were water, and in how many rows. */
  readonly pixels: number;
  readonly rows: number;
  /** Each band: as drawn, the body (F = 0), the reference and the control. */
  readonly near: WaterBand;
  readonly far: WaterBand;
}

/** One band's four read-backs. @see WaterReflectionMeasurement */
export interface WaterBand {
  readonly drawn: number;
  readonly body: number;
  readonly reference: number;
  readonly control: number;
}

const NO_BAND: WaterBand = { drawn: 0, body: 0, reference: 0, control: 0 };

const NO_WATER_REFLECTION: WaterReflectionMeasurement = {
  measured: false,
  reflects: false,
  pixels: 0,
  rows: 0,
  near: NO_BAND,
  far: NO_BAND,
};

/** How much higher than the chase camera #629's probe looks at the lake from, in metres. */
const LAKE_PROBE_RISE_METRES = 10;

/** Where on `lakeValleyRoute` the camera stands: inside its lake's stretch, which runs from about 1 329 m to 1 668 m. */
const LAKE_PROBE_DISTANCE = 1_360;

/** @see WaterReflectionMeasurement */
function waterReflectionProbe(
  view: GameView,
  gl: WebGL2RenderingContext,
  canvas: HTMLCanvasElement,
  riding: (profile: ReturnType<typeof northRoute>, distance: number) => SceneFrame,
): WaterReflectionMeasurement {
  const base = riding(lakeValleyRoute(), LAKE_PROBE_DISTANCE);
  // ⚠️ **Turned to face the lake, and raised**, measured: looking up the
  // road, the lake (16 m to 110 m off it, `waterways.ts` §`LAKE_NEAR_METRES`)
  // enters the frame only far ahead, so all 29 rows of it were grazing — a
  // Fresnel term of 0.71 in the nearest band and 0.79 in the farthest — and
  // faced square on from the chase camera's height the bank hid all but 24
  // rows. From {@link LAKE_PROBE_RISE_METRES} higher the near shore is about
  // 30° below the eye and the far shore about 6°. The side the lake lies on
  // is found by looking both ways.
  const facing = (side: number): SceneFrame => ({
    ...base,
    markers: [],
    scatter: [],
    camera: {
      ...base.camera,
      headingX: side,
      headingZ: 0,
      eyeRoadY: base.camera.eyeRoadY + LAKE_PROBE_RISE_METRES,
    },
  });
  const waterIn = (scene: SceneFrame): number => {
    const dried: SceneFrame = {
      ...scene,
      water: { ...scene.water, surface: { ...scene.water.surface, indices: new Uint32Array(0) } },
    };
    view.render(dried);
    view.render(dried);
    const without = readRegion(gl, 0, 0, canvas.width, canvas.height);
    view.render(scene);
    view.render(scene);
    const drawn = readRegion(gl, 0, 0, canvas.width, canvas.height);
    let count = 0;
    for (let at = 0; at < drawn.length; at += 4) {
      if (Math.abs((drawn[at] ?? 0) - (without[at] ?? 0)) > 2) count += 1;
    }
    return count;
  };
  const west = facing(1);
  const east = facing(-1);
  const frame = waterIn(west) >= waterIn(east) ? west : east;
  const dry: SceneFrame = {
    ...frame,
    water: {
      ...frame.water,
      surface: { ...frame.water.surface, indices: new Uint32Array(0) },
      bridges: [],
    },
  };
  const whole = (scene: SceneFrame): Uint8Array => {
    view.render(scene);
    view.render(scene);
    return readRegion(gl, 0, 0, canvas.width, canvas.height);
  };
  const withoutWater = whole(dry);
  const product = whole(frame);
  const reflects = waterReflectsOf(view);
  waterFresnelOf(view, 0);
  const body = whole(frame);
  waterFresnelOf(view, FRESNEL_REFERENCE);
  const reference = whole(frame);
  waterFresnelOf(view, FRESNEL_CONTROL);
  const control = whole(frame);
  waterFresnelOf(view, undefined);
  const width = canvas.width;
  // Water is where drawing it changed the pixel. Rows are bottom-up, as
  // `readPixels` returns them: row 0 is the bottom of the frame, the nearest.
  const rowsWithWater: number[] = [];
  let pixels = 0;
  const isWater = (at: number): boolean =>
    Math.abs((product[at] ?? 0) - (withoutWater[at] ?? 0)) +
      Math.abs((product[at + 1] ?? 0) - (withoutWater[at + 1] ?? 0)) +
      Math.abs((product[at + 2] ?? 0) - (withoutWater[at + 2] ?? 0)) >
    6;
  // Only a pixel whose four neighbours are water too: a shore pixel is part
  // bank, and the bank does not answer Fresnel.
  const inside = (row: number, column: number): boolean =>
    row > 0 &&
    column > 0 &&
    row + 1 < canvas.height &&
    column + 1 < width &&
    isWater((row * width + column) * 4) &&
    isWater(((row - 1) * width + column) * 4) &&
    isWater(((row + 1) * width + column) * 4) &&
    isWater((row * width + column - 1) * 4) &&
    isWater((row * width + column + 1) * 4);
  for (let row = 0; row < canvas.height; row += 1) {
    let any = false;
    for (let column = 0; column < width; column += 1) {
      if (isWater((row * width + column) * 4)) {
        any = true;
        pixels += 1;
      }
    }
    if (any) rowsWithWater.push(row);
  }
  const rowsInside = rowsWithWater.filter((row) => {
    for (let column = 1; column + 1 < width; column += 1) if (inside(row, column)) return true;
    return false;
  });
  const band = (rows: readonly number[], pixelsOf: Uint8Array): number => {
    let total = 0;
    let count = 0;
    for (const row of rows) {
      for (let column = 0; column < width; column += 1) {
        const at = (row * width + column) * 4;
        if (!inside(row, column)) continue;
        total += relativeLuminanceOf(
          pixelsOf[at] ?? 0,
          pixelsOf[at + 1] ?? 0,
          pixelsOf[at + 2] ?? 0,
        );
        count += 1;
      }
    }
    return count === 0 ? 0 : total / count;
  };
  const nearRows = rowsInside.slice(0, WATER_BAND_ROWS);
  const farRows = rowsInside.slice(-WATER_BAND_ROWS);
  const bandOf = (rows: readonly number[]): WaterBand => ({
    drawn: band(rows, product),
    body: band(rows, body),
    reference: band(rows, reference),
    control: band(rows, control),
  });
  return {
    measured: true,
    reflects,
    pixels,
    rows: rowsWithWater.length,
    near: bandOf(nearRows),
    far: bandOf(farRows),
  };
}

/**
 * A steep bank against level grass beside it, on #458's hill — #627. Each is a
 * {@link BLEND_WINDOW}-pixel square, and what is read in it is the texture's
 * own contrast: the variance of each pixel's relative luminance over the
 * square's mean, which the light on a bank (a scale on the whole square)
 * leaves alone.
 *
 * The squares are FOUND, not aimed: the bank is where taking the rock blend
 * off changes the picture, and the level grass is ground that neither the
 * rock nor the verge changes. Several level squares are read, whose range is
 * the grass-to-grass spread the control is held to.
 */
export interface GroundBlendMeasurement {
  readonly measured: boolean;
  /** Pixels the rock blend changed, and how many candidate squares lay wholly inside them. */
  readonly rockPixels: number;
  readonly bankSquares: number;
  /** The contrast of the bank, and of up to {@link LEVEL_SQUARES} level squares, as drawn. */
  readonly bank: number;
  readonly levels: readonly number[];
  /** The same squares with the rock blend off: the control. */
  readonly bankControl: number;
  readonly levelsControl: readonly number[];
}

const NO_GROUND_BLEND: GroundBlendMeasurement = {
  measured: false,
  rockPixels: 0,
  bankSquares: 0,
  bank: 0,
  levels: [],
  bankControl: 0,
  levelsControl: [],
};

/**
 * How many level squares are read, each at least three squares' width from
 * the others: their range is the grass-to-grass spread.
 */
const LEVEL_SQUARES = 8;

/** The side of a square {@link groundBlendProbe} reads, in pixels. */
const BLEND_WINDOW = 9;

/** Where on #458's hill the probe stands: on its 10 % climb. */
const BLEND_PROBE_DISTANCE = 520;

/** How far from the steep ground {@link groundBlendProbe}'s camera stands, and how far above it. */
const BLEND_PROBE_STAND_METRES = 14;
const BLEND_PROBE_RISE_METRES = 4;

/** @see GroundBlendMeasurement */
function groundBlendProbe(
  view: GameView,
  gl: WebGL2RenderingContext,
  canvas: HTMLCanvasElement,
  riding: (profile: ReturnType<typeof northRoute>, distance: number) => SceneFrame,
): GroundBlendMeasurement {
  const ridden = riding(hillRoute(), BLEND_PROBE_DISTANCE);
  // ⚠️ **Turned to face the steepest ground, and raised**, measured: from the
  // chase camera on this climb the only ground past 40° is 40 m or more off
  // the road, a strip 20 rows high at the horizon with no 9-pixel square
  // wholly inside it. So the camera is stood {@link BLEND_PROBE_STAND_METRES}
  // from the steep vertex nearest the rider, looking at it from above.
  const mesh = ridden.terrain.mesh;
  let steep = -1;
  let best = Number.POSITIVE_INFINITY;
  for (let vertex = 0; vertex < mesh.normals.length / 3; vertex += 1) {
    if ((mesh.normals[vertex * 3 + 1] ?? 1) > Math.cos((45 * Math.PI) / 180)) continue;
    const apart = Math.hypot(
      (mesh.vertices[vertex * 3] ?? 0) - ridden.camera.x,
      (mesh.vertices[vertex * 3 + 2] ?? 0) - ridden.camera.z,
    );
    if (apart < best) {
      best = apart;
      steep = vertex;
    }
  }
  if (steep < 0) return { ...NO_GROUND_BLEND, measured: true };
  const at = {
    x: mesh.vertices[steep * 3] ?? 0,
    y: mesh.vertices[steep * 3 + 1] ?? 0,
    z: mesh.vertices[steep * 3 + 2] ?? 0,
  };
  const towardX = at.x - ridden.camera.x;
  const towardZ = at.z - ridden.camera.z;
  const toward = Math.hypot(towardX, towardZ) || 1;
  const headingX = towardX / toward;
  const headingZ = towardZ / toward;
  const frame: SceneFrame = {
    ...ridden,
    markers: [],
    scatter: [],
    camera: {
      ...ridden.camera,
      x: at.x - headingX * BLEND_PROBE_STAND_METRES,
      z: at.z - headingZ * BLEND_PROBE_STAND_METRES,
      headingX,
      headingZ,
      eyeRoadY: at.y + BLEND_PROBE_RISE_METRES,
      targetRoadY: at.y,
    },
  };
  const bare: SceneFrame = {
    ...frame,
    terrain: {
      ...frame.terrain,
      mesh: { ...frame.terrain.mesh, indices: new Uint32Array(0) },
    },
  };
  const whole = (scene: SceneFrame): Uint8Array => {
    view.render(scene);
    view.render(scene);
    return readRegion(gl, 0, 0, canvas.width, canvas.height);
  };
  const noGround = whole(bare);
  const drawn = whole(frame);
  groundBlendOf(view, 1, 0, 1);
  const rockless = whole(frame);
  groundBlendOf(view, 0, 0, 1);
  const bareGrass = whole(frame);
  groundBlendOf(view, 1, 1, 1);
  const width = canvas.width;
  const differs = (a: Uint8Array, b: Uint8Array, at: number): boolean =>
    Math.abs((a[at] ?? 0) - (b[at] ?? 0)) +
      Math.abs((a[at + 1] ?? 0) - (b[at + 1] ?? 0)) +
      Math.abs((a[at + 2] ?? 0) - (b[at + 2] ?? 0)) >
    3;
  let rockPixels = 0;
  const rock = new Uint8Array(width * canvas.height);
  const grass = new Uint8Array(width * canvas.height);
  for (let pixel = 0; pixel < rock.length; pixel += 1) {
    const at = pixel * 4;
    const ground = differs(drawn, noGround, at);
    if (ground && differs(drawn, rockless, at)) {
      rock[pixel] = 1;
      rockPixels += 1;
    }
    if (ground && !differs(drawn, rockless, at) && !differs(drawn, bareGrass, at)) grass[pixel] = 1;
  }
  const whollyIn = (mask: Uint8Array, x: number, y: number): boolean => {
    for (let dy = 0; dy < BLEND_WINDOW; dy += 1) {
      for (let dx = 0; dx < BLEND_WINDOW; dx += 1) {
        if (mask[(y + dy) * width + x + dx] !== 1) return false;
      }
    }
    return true;
  };
  const banks: [number, number][] = [];
  const levels: [number, number][] = [];
  for (let y = 0; y + BLEND_WINDOW < canvas.height; y += 3) {
    for (let x = 0; x + BLEND_WINDOW < width; x += 3) {
      if (whollyIn(rock, x, y)) banks.push([x, y]);
      else if (whollyIn(grass, x, y)) levels.push([x, y]);
    }
  }
  const contrast = (pixels: Uint8Array, [x, y]: readonly [number, number]): number => {
    const values: number[] = [];
    for (let dy = 0; dy < BLEND_WINDOW; dy += 1) {
      for (let dx = 0; dx < BLEND_WINDOW; dx += 1) {
        const at = ((y + dy) * width + x + dx) * 4;
        values.push(relativeLuminanceOf(pixels[at] ?? 0, pixels[at + 1] ?? 0, pixels[at + 2] ?? 0));
      }
    }
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    if (!(mean > 0)) return 0;
    return values.reduce((sum, value) => sum + (value / mean - 1) ** 2, 0) / values.length;
  };
  // The bank square nearest the bottom of the frame (the nearest, and the
  // largest on screen); two level squares nearest the same row.
  const bank = [...banks].sort((a, b) => a[1] - b[1])[0];
  if (bank === undefined || levels.length < 2) {
    return { ...NO_GROUND_BLEND, measured: true, rockPixels, bankSquares: banks.length };
  }
  const byRow = [...levels].sort(
    (a, b) => Math.abs(a[1] - bank[1]) - Math.abs(b[1] - bank[1]) || a[0] - b[0],
  );
  const chosen: [number, number][] = [];
  for (const square of byRow) {
    if (chosen.length >= LEVEL_SQUARES) break;
    if (
      chosen.every(
        (other) =>
          Math.max(Math.abs(other[0] - square[0]), Math.abs(other[1] - square[1])) >=
          BLEND_WINDOW * 3,
      )
    ) {
      chosen.push(square);
    }
  }
  return {
    measured: true,
    rockPixels,
    bankSquares: banks.length,
    bank: contrast(drawn, bank),
    levels: chosen.map((square) => contrast(drawn, square)),
    bankControl: contrast(rockless, bank),
    levelsControl: chosen.map((square) => contrast(rockless, square)),
  };
}

/**
 * #630, in two parts.
 *
 * 1. **The far band's light.** One broadleaf tree 45 m up a view turned so
 *    the world's sun is square to its right, drawn as an impostor (a view of
 *    its own, whose levels draw every tree as one), at eight turns of the
 *    tree — the eight views of the strip. The tree's pixels are split at the
 *    middle of their extent, and the mean relative luminance of each half is
 *    summed over the turns: the sun's side and the shade's side, lit and
 *    (the control) unlit. Over eight turns the SCRIPT's sun, which turns with
 *    the tree, is on each side as often as the other, so the unlit strip's
 *    two halves read within its own variation; the world's sun does not turn.
 * 2. **The breeze.** One tree 12 m ahead at the top rung, a full mesh, with no
 *    water in the frame (whose ripples run on the same clock): the pixels
 *    that differ between the ride at two times, and — the control — between
 *    two draws at the same time.
 */
export interface FoliageMeasurement {
  readonly measured: boolean;
  readonly sunSide: number;
  readonly shadeSide: number;
  readonly sunSideUnlit: number;
  readonly shadeSideUnlit: number;
  /** How many of the impostor tree's pixels were read, summed over the turns. */
  readonly impostorPixels: number;
  readonly treePixels: number;
  readonly swayChanged: number;
  readonly heldChanged: number;
}

const NO_FOLIAGE: FoliageMeasurement = {
  measured: false,
  sunSide: 0,
  shadeSide: 0,
  sunSideUnlit: 0,
  shadeSideUnlit: 0,
  impostorPixels: 0,
  treePixels: 0,
  swayChanged: 0,
  heldChanged: 0,
};

/** @see FoliageMeasurement */
function foliageProbe(
  view: GameView,
  gl: WebGL2RenderingContext,
  canvas: HTMLCanvasElement,
  riding: (profile: ReturnType<typeof northRoute>, distance: number) => SceneFrame,
  top: QualitySettings,
): FoliageMeasurement {
  const base = riding(
    northRoute(2_000, () => 10),
    400,
  );
  const noWater = (frame: SceneFrame): SceneFrame => ({
    ...frame,
    markers: [],
    water: {
      ...frame.water,
      surface: { ...frame.water.surface, indices: new Uint32Array(0) },
      bridges: [],
    },
  });
  // 1. The far band. The view turned so the sun is on the right.
  const sun = base.world.sun;
  const flat = Math.hypot(sun.x, sun.z) || 1;
  const headingX = sun.z / flat;
  const headingZ = -sun.x / flat;
  const turned: SceneFrame = noWater({
    ...base,
    camera: { ...base.camera, headingX, headingZ },
  });
  const treeAt = (ahead: number, rotation: number): ScatterItem => ({
    kind: 'tree-broadleaf',
    x: turned.camera.x + headingX * ahead,
    y: turned.camera.y,
    z: turned.camera.z + headingZ * ahead,
    rotation,
    scale: 1,
    variant: 0,
  });
  // Undithered: a dithered hand-over draws the first rank as the band between
  // the full mesh and the middle one, whatever `near` says (`tree-levels.ts`).
  setTreeLevels({
    ...REALISTIC_TREE_LEVELS,
    near: 0,
    middle: 0,
    dithered: false,
    // At its level at once, so two draws settle a turn: this probe is about
    // light, not the hand-over.
    handOverFrames: 1,
  });
  const farCanvas = document.createElement('canvas');
  let far: GameView;
  try {
    far = threeGameRenderer.create(farCanvas, top);
  } finally {
    setTreeLevels(REALISTIC_TREE_LEVELS);
  }
  far.resize(canvas.width, canvas.height);
  const farGl = farCanvas.getContext('webgl2');
  if (farGl === null) {
    far.destroy();
    return NO_FOLIAGE;
  }
  const settled = (
    target: GameView,
    context: WebGL2RenderingContext,
    frame: SceneFrame,
    renders = 11,
  ): Uint8Array => {
    for (let at = 0; at < renders; at += 1) target.render(frame);
    return readRegion(context, 0, 0, canvas.width, canvas.height);
  };
  const width = canvas.width;
  const sides = (): { sun: number; shade: number; pixels: number } => {
    const empty = settled(far, farGl, { ...turned, scatter: [] }, 2);
    let sunTotal = 0;
    let shadeTotal = 0;
    let pixels = 0;
    for (let turn = 0; turn < 8; turn += 1) {
      const drawn = settled(
        far,
        farGl,
        { ...turned, scatter: [treeAt(45, (turn * Math.PI) / 4)] },
        2,
      );
      let low = width;
      let high = -1;
      const tree: number[] = [];
      for (let pixel = 0; pixel < drawn.length / 4; pixel += 1) {
        const at = pixel * 4;
        if (
          Math.abs((drawn[at] ?? 0) - (empty[at] ?? 0)) +
            Math.abs((drawn[at + 1] ?? 0) - (empty[at + 1] ?? 0)) +
            Math.abs((drawn[at + 2] ?? 0) - (empty[at + 2] ?? 0)) >
          6
        ) {
          tree.push(pixel);
          low = Math.min(low, pixel % width);
          high = Math.max(high, pixel % width);
        }
      }
      const middle = (low + high) / 2;
      let right = 0;
      let rightCount = 0;
      let left = 0;
      let leftCount = 0;
      for (const pixel of tree) {
        const at = pixel * 4;
        const luminance = relativeLuminanceOf(
          drawn[at] ?? 0,
          drawn[at + 1] ?? 0,
          drawn[at + 2] ?? 0,
        );
        if (pixel % width > middle) {
          right += luminance;
          rightCount += 1;
        } else {
          left += luminance;
          leftCount += 1;
        }
      }
      // The sun is on the right: the right half is its side.
      sunTotal += rightCount === 0 ? 0 : right / rightCount;
      shadeTotal += leftCount === 0 ? 0 : left / leftCount;
      pixels += tree.length;
    }
    return { sun: sunTotal / 8, shade: shadeTotal / 8, pixels };
  };
  const lit = sides();
  impostorsLitOf(false);
  let unlit: ReturnType<typeof sides>;
  try {
    unlit = sides();
  } finally {
    impostorsLitOf(true);
  }
  far.destroy();

  // 2. The breeze, on the product's own view.
  const near = noWater(
    riding(
      northRoute(2_000, () => 10),
      400,
    ),
  );
  const oneTree: SceneFrame = {
    ...near,
    scatter: [
      {
        kind: 'tree-broadleaf',
        ...onTheRoad(near, 14, -6),
        rotation: 0.3,
        scale: 1,
        variant: 0,
      },
    ],
  };
  const at = (seconds: number): SceneFrame => ({
    ...oneTree,
    water: { ...oneTree.water, seconds },
  });
  const empty = settled(view, gl, { ...at(10), scatter: [] });
  const first = settled(view, gl, at(10));
  const later = settled(view, gl, at(11.3));
  const again = settled(view, gl, at(10));
  return {
    measured: true,
    sunSide: lit.sun,
    shadeSide: lit.shade,
    sunSideUnlit: unlit.sun,
    shadeSideUnlit: unlit.shade,
    impostorPixels: lit.pixels,
    treePixels: pixelsChanged(first, empty),
    swayChanged: pixelsChanged(first, later),
    heldChanged: pixelsChanged(first, again),
  };
}

/**
 * A finish gantry 30 m ahead, on a level road due north — #679. A strip of
 * the drawing buffer aimed from geometry at the middle of its banner is read
 * for its lettering: the variance of relative luminance over the strip's
 * mean, and its mean colour. Then the same frame with the gantries off (the
 * first control: the strip must read what is behind), and the draw calls and
 * triangles the gantries add there and — the second control — half-way along
 * the route, out of reach of every line.
 */
export interface GantryMeasurement {
  readonly measured: boolean;
  /** Whether the finish was in the frame's lines at all. */
  readonly inReach: boolean;
  readonly lettering: number;
  readonly letteringOff: number;
  readonly mean: readonly number[];
  readonly meanOff: readonly number[];
  /** Draw calls and triangles the gantries add, near the line and mid-route. */
  readonly callsNear: number;
  readonly trianglesNear: number;
  readonly callsMiddle: number;
  readonly trianglesMiddle: number;
  /** What the belt drew near the line: boxes and banners. */
  readonly boxes: number;
  readonly banners: number;
}

const NO_GANTRY: GantryMeasurement = {
  measured: false,
  inReach: false,
  lettering: 0,
  letteringOff: 0,
  mean: [],
  meanOff: [],
  callsNear: 0,
  trianglesNear: 0,
  callsMiddle: 0,
  trianglesMiddle: 0,
  boxes: 0,
  banners: 0,
};

/** The strip read on the banner, in pixels: wide, because the lettering runs across it. */
const BANNER_STRIP = { width: 41, height: 9 } as const;

/** @see GantryMeasurement */
function gantryProbe(
  view: GameView,
  gl: WebGL2RenderingContext,
  canvas: HTMLCanvasElement,
  riding: (profile: ReturnType<typeof northRoute>, distance: number) => SceneFrame,
): GantryMeasurement {
  const route = northRoute(3_000, () => 10);
  const total = route.totalDistance as number;
  const bare = (frame: SceneFrame): SceneFrame => ({ ...frame, markers: [], scatter: [] });
  const near = bare(riding(route, total - 30));
  const middle = bare(riding(route, total / 2));
  const finish = near.lines.find((line) => line.stand.text === FINISH_WORD);
  if (finish === undefined) return { ...NO_GANTRY, measured: true };
  const place = bannerPlace('gantry');
  // A little above the banner's middle: the main word's row.
  const aim = standPoint(finish, place.across, place.up + place.height * 0.1, place.along);
  const centre = pixelFor(near, canvas, aim);
  const read = (): { contrast: number; mean: number[] } => {
    view.render(near);
    view.render(near);
    const pixels = readRegion(
      gl,
      Math.round(centre.x) - (BANNER_STRIP.width - 1) / 2,
      Math.round(centre.y) - (BANNER_STRIP.height - 1) / 2,
      BANNER_STRIP.width,
      BANNER_STRIP.height,
    );
    const values: number[] = [];
    const mean = [0, 0, 0];
    for (let at = 0; at < pixels.length; at += 4) {
      values.push(relativeLuminanceOf(pixels[at] ?? 0, pixels[at + 1] ?? 0, pixels[at + 2] ?? 0));
      for (let channel = 0; channel < 3; channel += 1) {
        mean[channel] = (mean[channel] ?? 0) + (pixels[at + channel] ?? 0) / (pixels.length / 4);
      }
    }
    const average = values.reduce((sum, value) => sum + value, 0) / values.length;
    const contrast =
      average > 0
        ? values.reduce((sum, value) => sum + (value / average - 1) ** 2, 0) / values.length
        : 0;
    return { contrast, mean };
  };
  const cost = (frame: SceneFrame): { calls: number; triangles: number } => {
    const once = (): { calls: number; triangles: number } => {
      let result = { calls: 0, triangles: 0 };
      view.render(frame);
      countingTriangles((triangles, calls) => {
        view.render(frame);
        result = { calls: calls(), triangles: triangles() };
      });
      return result;
    };
    const on = once();
    gantriesShownOf(view, false);
    const off = once();
    gantriesShownOf(view, true);
    return { calls: on.calls - off.calls, triangles: on.triangles - off.triangles };
  };
  const drawn = read();
  const counts = gantryCountsOf(view);
  gantriesShownOf(view, false);
  let off: ReturnType<typeof read>;
  try {
    off = read();
  } finally {
    gantriesShownOf(view, true);
  }
  const atTheLine = cost(near);
  const midRoute = cost(middle);
  return {
    measured: true,
    inReach: true,
    lettering: drawn.contrast,
    letteringOff: off.contrast,
    mean: drawn.mean,
    meanOff: off.mean,
    callsNear: atTheLine.calls,
    trianglesNear: atTheLine.triangles,
    callsMiddle: midRoute.calls,
    trianglesMiddle: midRoute.triangles,
    boxes: counts.boxes,
    banners: counts.banners,
  };
}

/** What {@link airProbe} reports when it did not run. */
const NO_AIR: AirMeasurement = {
  measured: false,
  toward: { directional: [0, 0, 0], flattened: [0, 0, 0] },
  away: { directional: [0, 0, 0], flattened: [0, 0, 0] },
  predictedToward: [0, 0, 0],
  predictedAway: [0, 0, 0],
  fogToward: [0, 0, 0],
  fogAway: [0, 0, 0],
  fogFactor: 0,
  fogFactorWithoutValley: 0,
  valleyFactor: 0,
  valleyOff: [0, 0, 0],
  valleyPredicted: [0, 0, 0],
  skyToward: 0,
  skyAway: 0,
};

const NO_REALISTIC: RealisticMeasurement = {
  measured: false,
  air: NO_AIR,
  roadWear: NO_ROAD_WEAR,
  groundBlend: NO_GROUND_BLEND,
  foliage: NO_FOLIAGE,
  gantry: NO_GANTRY,
  waterReflection: NO_WATER_REFLECTION,
  atmosphere: {
    realisticTaught: 0,
    realisticUntaught: 0,
    realisticShared: 0,
    stylisedTaught: 0,
    stylisedFogged: 0,
  },
  textures: NO_TEXTURES,
  firstFrameMs: 0,
  fallbackWorld: '',
  failedLoad: { loaded: false, offline: false },
  failedNotice: '',
  loaded: false,
  loadMs: 0,
  drawnWorld: '',
  visibleStandard: 0,
  visibleStandardConstructed: 0,
  visiblePhysical: 0,
  visibleImpostors: 0,
  visibleImpostorsConstructed: 0,
  texturesCreated: 0,
  drawCalls: 0,
  drawCallsWithoutRoad: 0,
  climbLuminance: 0,
  descentLuminance: 0,
  unwornClimbLuminance: 0,
  unwornDescentLuminance: 0,
  levelClimbLuminance: 0,
  levelDescentLuminance: 0,
  crankTurnPixels: 0,
  crankHeldPixels: 0,
  worldChangedShare: 0,
  foliageOrder: { cut: 0, opaque: 0, cutBeforeOpaque: 0 },
  foliageOrderControl: { cut: 0, opaque: 0, cutBeforeOpaque: 0 },
  foliageOrderChangedPixels: 0,
  textureBiasReducedShare: 0,
  textureBiasTopShare: 0,
  sceneryProbeBudget: 0,
  sceneryDrawnTop: 0,
  sceneryDrawnBudgeted: 0,
  afterStepDownWorld: '',
  waterReflectsAfterStepDown: false,
  afterStepDownStandard: 0,
  bridgesWearStone: false,
  bridgesWearStoneAfterStepDown: false,
  realisticFrameMs: 0,
  stylisedFrameMs: 0,
  waterSkyRealistic: [],
  waterSkyStylised: [],
  windowGlass: [],
  windowControl: [],
  windowWall: [],
  tint: {
    trees: [],
    treesControl: [],
    treePixels: [],
    treeTints: [],
    houses: [],
    housesControl: [],
    houseTints: [],
  },
  grounding: NO_GROUNDING,
  tread: NO_TREAD,
  kit: NO_KIT,
  horizon: [],
  horizonControl: [],
  horizonColours: { fog: [], foot: [] },
  horizonColoursControl: { fog: [], foot: [] },
  horizonControlExpected: [],
};

const NO_TREES: TreeLevelMeasurement = {
  measured: false,
  drawnWorld: '',
  trianglesSubmitted: 0,
  trianglesHardSwap: 0,
  drawCallsSubmitted: 0,
  drawCallsUnmerged: 0,
  trianglesUnmerged: 0,
  unmergedPixelsChanged: 0,
  pixelsCompared: 0,
  woodedScenery: 0,
  handOver: { out: [], covered: [], changed: [] },
  handOverControl: { out: [], covered: [], changed: [] },
  handOverOffScreenCovered: 0,
  nearestVisibleTriangles: 0,
  nearestVisibleTrianglesControl: 0,
};

/** Relative luminance of an sRGB pixel, WCAG 2.2's own formula. */
function relativeLuminanceOf(red: number, green: number, blue: number): number {
  const linear = (byte: number): number => {
    const channel = byte / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue);
}

/** The mean relative luminance of a small square of the drawing buffer around a pixel. */
function meanLuminanceAround(
  gl: WebGL2RenderingContext | WebGLRenderingContext,
  centre: { readonly x: number; readonly y: number },
  half: number,
): number {
  const side = half * 2 + 1;
  const pixels = readRegion(
    gl,
    Math.round(centre.x) - half,
    Math.round(centre.y) - half,
    side,
    side,
  );
  let total = 0;
  for (let at = 0; at < pixels.length; at += 4) {
    total += relativeLuminanceOf(pixels[at] ?? 0, pixels[at + 1] ?? 0, pixels[at + 2] ?? 0);
  }
  return total / (side * side);
}

/**
 * How far above and below a crest the sky and the ridge are read, in pixels:
 * **4 to 9** either side. Clear of the crest's own anti-aliased row and of the
 * interpolation between two ring segments, which bends the drawn crest a
 * pixel or two off the straight chord this probe projects; inside the ring
 * and above the corridor's own ground at every column {@link horizonReadings}
 * reads, measured on 2026-09-26.
 */
const CREST_CLEARANCE_PIXELS = [4, 9] as const;

/**
 * Reads the distant hills in one column of a frame just drawn — #544.
 *
 * ⚠️ **Aimed from the geometry**, like every probe here since #424 (@see
 * inTheFrame): the crest is the ring's own top at that bearing, lifted by
 * the same `realistic-light.ts` §`ridgeLift` `three-renderer.ts`
 * §`HorizonRing.update` draws with when the horizon is the photographed sky's
 * — one function, so the probe and the drawn ridge cannot disagree about where
 * the crest is.
 */
function horizonReading(
  gl: WebGL2RenderingContext,
  canvas: HTMLCanvasElement,
  frame: SceneFrame,
  name: string,
  offAxisDegrees: number,
  lifted: boolean,
): HorizonReading {
  const pose = frame.camera;
  const turn = (offAxisDegrees * Math.PI) / 180;
  const dx = pose.headingX * Math.cos(turn) - pose.headingZ * Math.sin(turn);
  const dz = pose.headingX * Math.sin(turn) + pose.headingZ * Math.cos(turn);
  const bearing = (Math.atan2(dz, dx) + 2 * Math.PI) % (2 * Math.PI);
  const at = (bearing / (2 * Math.PI)) * HORIZON_SEGMENTS;
  const lower = Math.floor(at);
  const tops = frame.terrain.horizon.tops;
  const from = tops[lower % HORIZON_SEGMENTS] as number;
  const to = tops[(lower + 1) % HORIZON_SEGMENTS] as number;
  const lift = lifted
    ? ridgeLift(tops, skylineCrestFloor(cameraRig(pose).eye.y, HORIZON_RADIUS_METRES))
    : 0;
  const onTheRing = (y: number): { readonly x: number; readonly y: number } =>
    pixelFor(frame, canvas, {
      x: pose.x + dx * HORIZON_RADIUS_METRES,
      y,
      z: pose.z + dz * HORIZON_RADIUS_METRES,
    });
  const relief = from + (to - from) * (at - lower);
  const crest = onTheRing(relief + lift);
  const reliefCrest = onTheRing(relief);
  const [near, far] = CREST_CLEARANCE_PIXELS;
  const band = (rowFrom: number): number => {
    const rows = far - near + 1;
    const pixels = readRegion(gl, Math.round(crest.x), Math.round(rowFrom), 1, rows);
    let total = 0;
    for (let row = 0; row < rows; row += 1) {
      total += relativeLuminanceOf(
        pixels[row * 4] ?? 0,
        pixels[row * 4 + 1] ?? 0,
        pixels[row * 4 + 2] ?? 0,
      );
    }
    return total / rows;
  };
  const beside = onTheRoad(frame, GROUND_PROBE.ahead, GROUND_PROBE.across);
  const scanFrom = Math.round(reliefCrest.y);
  const scanRows = Math.max(1, Math.round(crest.y) + far - scanFrom + 1);
  const scanned = readRegion(gl, Math.round(crest.x), scanFrom, 1, scanRows);
  let darkestAboveRelief = Number.POSITIVE_INFINITY;
  for (let row = 0; row < scanRows; row += 1) {
    darkestAboveRelief = Math.min(
      darkestAboveRelief,
      relativeLuminanceOf(
        scanned[row * 4] ?? 0,
        scanned[row * 4 + 1] ?? 0,
        scanned[row * 4 + 2] ?? 0,
      ),
    );
  }
  return {
    darkestAboveRelief,
    frame: name,
    offAxisDegrees,
    // The drawing buffer's rows count UP, so the sky is above the crest's row.
    sky: band(crest.y + near),
    ridge: band(crest.y - far),
    ground: meanLuminanceAround(
      gl,
      pixelFor(frame, canvas, { ...beside, y: beside.y - VERGE_DROP_METRES }),
      2,
    ),
  };
}

/** An output-space colour, each channel 0 to 1: the mean of a region's bytes over 255. */
type OutputRgb = readonly [number, number, number];

/**
 * What #622's probes read back. Every colour is in the OUTPUT space — the
 * bytes over 255 — because that is where three's fog is mixed
 * (`fog_fragment` runs after the tone map and the colour-space conversion), so
 * a fog's effect on a pixel is linear THERE and can be predicted exactly.
 */
export interface AirMeasurement {
  readonly measured: boolean;
  /**
   * The probe region with the sun turned TOWARDS it and AWAY from it — the
   * same point, the same distance and height, one frame each — with the
   * direction table as the product draws it and flattened to its mean.
   */
  readonly toward: { readonly directional: OutputRgb; readonly flattened: OutputRgb };
  readonly away: { readonly directional: OutputRgb; readonly flattened: OutputRgb };
  /**
   * What the table says the directional fog adds at each probe over the
   * flattened one: `f · (F_directional − F_flattened)`, from the numbers the
   * view handed its shader (`airOf`) and the fog factor at the probe's depth.
   */
  readonly predictedToward: OutputRgb;
  readonly predictedAway: OutputRgb;
  /** The directional fog's own colour at each probe, from the table — the HDR's band, as the fog carries it. */
  readonly fogToward: OutputRgb;
  readonly fogAway: OutputRgb;
  /** The fog factor at the probe, with the valley haze, and without it. */
  readonly fogFactor: number;
  readonly fogFactorWithoutValley: number;
  /** The valley haze's factor on the fog's density at the probe. */
  readonly valleyFactor: number;
  /** The probe with the valley haze off (flattened table), and what the haze should make of it. */
  readonly valleyOff: OutputRgb;
  readonly valleyPredicted: OutputRgb;
  /** The drawn SKY 30° up, with the sun turned towards the camera's heading and away: luminance. */
  readonly skyToward: number;
  readonly skyAway: number;
}

/**
 * A route that drops 150 m into a wide, flat valley — #622's probe. The rims
 * set the middle of the route's elevation 75 m above the floor, a full
 * `REALISTIC_VALLEY_DEPTH_METRES` and more, so the floor hazes at the whole
 * `REALISTIC_VALLEY_HAZE`; the camera, 120 m down the descent
 * ({@link AIR_RIDER_ALONG_METRES}), stands above the middle and looks down onto
 * the floor, well clear of the horizon, where the fog has taken about 70 % of
 * the road without the haze and 85 % with it — so the road under it still
 * counts, and the control means something.
 */
function airValleyRoute(): ReturnType<typeof northRoute> {
  return northRoute(2_000, (along) => {
    if (along <= 400) return 150;
    if (along <= 700) return 150 - ((along - 400) / 300) * 150;
    if (along <= 1_300) return 0;
    if (along <= 1_600) return ((along - 1_300) / 300) * 150;
    return 150;
  });
}

/** Where on the valley's floor the air is read: the road's middle, this far along the route. */
const AIR_PROBE_ALONG_METRES = 760;

/** Where the rider is for #622's probe: on the descent, above the middle of the route's elevation. */
const AIR_RIDER_ALONG_METRES = 520;

/** The mean output-space colour of a square of the drawing buffer. */
function outputAround(
  gl: WebGL2RenderingContext,
  centre: { readonly x: number; readonly y: number },
  half: number,
): OutputRgb {
  const side = half * 2 + 1;
  const pixels = readRegion(
    gl,
    Math.round(centre.x) - half,
    Math.round(centre.y) - half,
    side,
    side,
  );
  const sum = [0, 0, 0];
  for (let at = 0; at < pixels.length; at += 4) {
    for (let channel = 0; channel < 3; channel += 1) {
      sum[channel] = (sum[channel] ?? 0) + (pixels[at + channel] ?? 0) / 255;
    }
  }
  const count = side * side;
  return [(sum[0] ?? 0) / count, (sum[1] ?? 0) / count, (sum[2] ?? 0) / count];
}

/** A table read back from `airOf`, three floats a direction, as colours. */
function tableOf(flat: readonly number[]): LinearColour[] {
  const table: LinearColour[] = [];
  for (let at = 0; at + 2 < flat.length; at += 3) {
    table.push([flat[at] ?? 0, flat[at + 1] ?? 0, flat[at + 2] ?? 0]);
  }
  return table;
}

/**
 * The realistic air, read off a real drawing buffer — #622.
 *
 * One point on a valley floor — the road's middle, 240 m ahead of a rider on
 * the descent and about 90 m below the eye — read in two frames that differ ONLY in which way the sun
 * stands: turned towards the point, and turned away from it, at the same
 * elevation. The road there is lit as facing straight up
 * (`photographicRoadMaterial`), so a sun turned about the vertical lights it
 * the same, and the one thing the turn changes on that pixel is which part of
 * the sky's horizon the fog leans towards — the flattened table is the
 * control that shows it.
 *
 * ⚠️ **Predicted, not only compared.** three mixes its fog in the output space
 * after everything else (`fog_fragment` is the last chunk), so on any surface
 * `directional − flattened = f · (F_directional − F_flattened)` exactly, with
 * `f` the fog factor at the point's view depth. Both `F`s come from the numbers
 * the view handed its shader (`airOf`) through `realistic-light.ts`
 * §`directionalFogColour` — so the gate holds the SHADER to the arithmetic, from
 * both sides, rather than asking only that something moved. Likewise the
 * valley haze: with it off the pixel gives the surface under the fog, and with
 * it on it must be that surface under a fog `REALISTIC_VALLEY_HAZE` times as
 * dense.
 */
function airProbe(
  view: GameView,
  gl: WebGL2RenderingContext,
  canvas: HTMLCanvasElement,
  riding: (profile: ReturnType<typeof northRoute>, distance: number) => SceneFrame,
): AirMeasurement {
  const base = riding(airValleyRoute(), AIR_RIDER_ALONG_METRES);
  const point = onTheRoad(base, AIR_PROBE_ALONG_METRES - AIR_RIDER_ALONG_METRES, 0);
  const { eye, target } = cameraRig(base.camera);
  const toPoint = { x: point.x - eye.x, z: point.z - eye.z };
  const azimuth = Math.atan2(toPoint.z, toPoint.x);
  const withSun = (frame: SceneFrame, bearing: number): SceneFrame => {
    const sun = frame.world.sun;
    const across = Math.hypot(sun.x, sun.z);
    return {
      ...frame,
      markers: [],
      scatter: [],
      world: {
        ...frame.world,
        sun: { ...sun, x: Math.cos(bearing) * across, z: Math.sin(bearing) * across },
      },
    };
  };
  const toward = withSun(base, azimuth);
  const away = withSun(base, azimuth + Math.PI);
  const at = pixelFor(base, canvas, point);
  const read = (frame: SceneFrame): OutputRgb => {
    view.render(frame);
    view.render(frame);
    return outputAround(gl, at, 1);
  };
  const reading = (
    frame: SceneFrame,
    table: 'directional' | 'flattened',
    valley = true,
  ): { rgb: OutputRgb; air: AirReading | undefined } => {
    atmosphereOf(view, { table, valley });
    const rgb = read(frame);
    return { rgb, air: airOf(view) };
  };
  const towardDirectional = reading(toward, 'directional');
  const towardFlattened = reading(toward, 'flattened');
  const awayDirectional = reading(away, 'directional');
  const awayFlattened = reading(away, 'flattened');
  const valleyOff = reading(toward, 'flattened', false);
  atmosphereOf(view, { table: 'directional', valley: true });
  const air = towardDirectional.air;
  if (air === undefined) return NO_AIR;

  // The fog factor at the point, as `ATMOSPHERE_FRAGMENT` works it out.
  const axis = { x: target.x - eye.x, y: target.y - eye.y, z: target.z - eye.z };
  const length = Math.hypot(axis.x, axis.y, axis.z);
  const depth =
    ((point.x - eye.x) * axis.x + (point.y - eye.y) * axis.y + (point.z - eye.z) * axis.z) / length;
  const valleyFactor = valleyHazeFactor(point.y, air.valleyMiddle, air.valleyHaze);
  const factor = (density: number): number => 1 - Math.exp(-density * density * depth * depth);
  const fogFactor = factor(air.density * valleyFactor);
  const fogFactorWithoutValley = factor(air.density);

  const fogAt = (
    reading: AirReading | undefined,
    bearing: number,
  ): readonly [number, number, number] =>
    reading === undefined
      ? [0, 0, 0]
      : directionalFogColour(
          reading.base,
          tableOf(reading.table),
          reading.share,
          bearing,
          reading.turn,
        );
  const shift = (
    directional: AirReading | undefined,
    flattened: AirReading | undefined,
  ): OutputRgb => {
    const on = fogAt(directional, azimuth);
    const off = fogAt(flattened, azimuth);
    return [0, 1, 2].map(
      (channel) => fogFactor * ((on[channel] ?? 0) - (off[channel] ?? 0)),
    ) as unknown as OutputRgb;
  };
  // The valley: the surface under the fog, from the frame with the haze off,
  // under the denser fog.
  const flatFog = fogAt(valleyOff.air, azimuth);
  const valleyPredicted = [0, 1, 2].map((channel) => {
    const fog = flatFog[channel] ?? 0;
    const seen = valleyOff.rgb[channel] ?? 0;
    const surface = (seen - fogFactorWithoutValley * fog) / (1 - fogFactorWithoutValley);
    return surface + fogFactor * (fog - surface);
  }) as unknown as OutputRgb;

  // #622's first consumer of `skyRotation` from the world's side: the sky DRAWN
  // 30° up, straight ahead, with the sun turned to the camera's heading and
  // away from it. The committed photograph is twice as bright 30° up on its
  // sun's side (1.44 against 0.67, read off the file on 2026-09-27), so a sky
  // turned the wrong way round reads darker towards the sun.
  const level = riding(
    northRoute(2_000, () => 10),
    400,
  );
  const heading = Math.atan2(level.camera.headingZ, level.camera.headingX);
  const levelRig = cameraRig(level.camera);
  const up30 = {
    x: levelRig.eye.x + level.camera.headingX * 100,
    y: levelRig.eye.y + 100 * Math.tan((30 * Math.PI) / 180),
    z: levelRig.eye.z + level.camera.headingZ * 100,
  };
  const skyPixel = pixelFor(level, canvas, up30);
  const skyLuminance = (frame: SceneFrame): number => {
    view.render(frame);
    view.render(frame);
    return meanLuminanceAround(gl, skyPixel, 2);
  };
  const skyToward = skyLuminance(withSun(level, heading));
  const skyAway = skyLuminance(withSun(level, heading + Math.PI));

  return {
    measured: true,
    toward: { directional: towardDirectional.rgb, flattened: towardFlattened.rgb },
    away: { directional: awayDirectional.rgb, flattened: awayFlattened.rgb },
    predictedToward: shift(towardDirectional.air, towardFlattened.air),
    predictedAway: shift(awayDirectional.air, awayFlattened.air),
    fogToward: fogAt(towardDirectional.air, azimuth),
    fogAway: fogAt(awayDirectional.air, azimuth),
    fogFactor,
    fogFactorWithoutValley,
    valleyFactor,
    valleyOff: valleyOff.rgb,
    valleyPredicted,
    skyToward,
    skyAway,
  };
}

/** How many pixels two read-backs of the same size disagree about. */
/**
 * How far the picture's colour moved between two frames: the summed absolute
 * difference of every channel, in 8-bit steps — #617's review, for a
 * hand-over between two levels that cover the same pixels in different
 * colours, which {@link pixelsChanged} against a background cannot see.
 */
function colourMoved(a: Uint8Array, b: Uint8Array): number {
  let moved = 0;
  for (let at = 0; at < a.length; at += 4) {
    moved +=
      Math.abs((a[at] ?? 0) - (b[at] ?? 0)) +
      Math.abs((a[at + 1] ?? 0) - (b[at + 1] ?? 0)) +
      Math.abs((a[at + 2] ?? 0) - (b[at + 2] ?? 0));
  }
  return moved;
}

function pixelsChanged(a: Uint8Array, b: Uint8Array): number {
  let changed = 0;
  for (let at = 0; at < a.length; at += 4) {
    if (a[at] !== b[at] || a[at + 1] !== b[at + 1] || a[at + 2] !== b[at + 2]) changed += 1;
  }
  return changed;
}

/**
 * What {@link tintProbe} reads back — #621. Each colour is a mean sRGB triple.
 */
export interface TintMeasurement {
  /** The two trees' mean colours as the product draws them. */
  readonly trees: readonly (readonly number[])[];
  /** The same two with every tint bound at nothing — the control. */
  readonly treesControl: readonly (readonly number[])[];
  /** How many pixels each tree covered: the non-vacuity of the means. */
  readonly treePixels: readonly number[];
  /** The tints `instance-tint.ts` gives the two trees, for the log. */
  readonly treeTints: readonly InstanceTint[];
  /** The mean of a square of each house's front wall, as the product draws it. */
  readonly houses: readonly (readonly number[])[];
  readonly housesControl: readonly (readonly number[])[];
  readonly houseTints: readonly InstanceTint[];
}

/**
 * Two instances of one shape, told apart by their tints alone — #621.
 *
 * - **Two broadleaf trees** of one variant, 20 m up a level road, turned
 *   alike, drawn at the middle level (two trees level with the rider and off
 *   the frame take the first two ranks, as #617's probe places them) — ONE AT
 *   A TIME, the second under a metre from where the first stood, so the two
 *   are seen from one angle in one light and differ only in which item they
 *   are. Side by side in one frame they read 9 % apart with no tint at all.
 * - **Two houses** of one shape, 40 m ahead either side of the road, turned
 *   alike and in ONE frame, a square of each front wall read back: two parallel
 *   walls of one photograph under one sun.
 *
 * Each pair is placed, to a sixteenth of a metre, where `instance-tint.ts`
 * gives the two the most different brightness — the tint is a function of
 * where an item stands, so this chooses the pair and never the tint.
 *
 * A tree's colour is the mean of the pixels it changes against the same frame
 * without it.
 *
 * **The control** is the same frames with every bound at nothing
 * (`three-renderer.ts` §`setRealisticTints`): the two must read back alike,
 * which is what says the difference in the product is the tint and not the
 * light, the fog or the angle each is seen from.
 */
function tintProbe(
  view: GameView,
  gl: WebGL2RenderingContext,
  canvas: HTMLCanvasElement,
  base: SceneFrame,
): TintMeasurement {
  const frame: SceneFrame = { ...base, markers: [] };
  const pose = frame.camera;
  const whole = (): Uint8Array => readRegion(gl, 0, 0, canvas.width, canvas.height);
  const fromRider = (ahead: number, across: number): ScatterItem => ({
    kind: 'tree-broadleaf',
    x: pose.x + ahead * pose.headingX - across * pose.headingZ,
    y: onTheRoad(frame, ahead, 0).y,
    z: pose.z + ahead * pose.headingZ + across * pose.headingX,
    rotation: 0,
    scale: 1,
    variant: 0,
  });
  /** The pair, out of sixteen nudges each, whose tints' brightness differs most. */
  const widestPair = <T extends { readonly x: number; readonly z: number }>(
    place: (nudge: number) => readonly [T, T],
    bound: TintBound,
  ): readonly [T, T] => {
    let best: readonly [T, T] = place(0);
    let widest = -1;
    for (let a = 0; a < 16; a += 1) {
      for (let b = 0; b < 16; b += 1) {
        const [first] = place(a / 16);
        const [, second] = place(b / 16);
        const apart = Math.abs(
          instanceTint(first.x, first.z, bound).brightness -
            instanceTint(second.x, second.z, bound).brightness,
        );
        if (apart > widest) {
          widest = apart;
          best = [first, second];
        }
      }
    }
    return best;
  };
  const tintsOf = (items: readonly ScatterItem[], bound: TintBound): InstanceTint[] =>
    items.map((item) => instanceTint(item.x, item.z, bound));

  // The trees: ONE at a time, 20 m ahead, and the second a few centimetres
  // from where the first stood — another item with its own tint, seen from
  // the same angle in the same light. Two trees side by side are seen from
  // either side and lit at different angles to the canopy, and read 9 %
  // apart UNTINTED on the pinned Chromium, which buries the tint. Two fillers
  // off the frame take ranks 0 and 1, so the tree is rank 2: the middle level.
  const fillers = [fromRider(0, -12), fromRider(0, -13)];
  const trees = widestPair(
    (nudge) => [fromRider(20, nudge / 2), fromRider(20, -nudge / 2)] as const,
    FOLIAGE_TINT,
  );
  const settle = (scene: SceneFrame): void => {
    for (let at = 0; at < 12; at += 1) view.render(scene);
  };
  settle({ ...frame, scatter: fillers });
  const bare = whole();
  const treeReadings = trees.map((tree) => {
    const scene: SceneFrame = { ...frame, scatter: [...fillers, tree] };
    settle(scene);
    const product = whole();
    let control: Uint8Array;
    try {
      setRealisticTints(NO_TINT, NO_TINT);
      view.render(scene);
      control = whole();
    } finally {
      setRealisticTints(FOLIAGE_TINT, MASONRY_TINT);
    }
    // The tree's pixels: what it changed against the frame without it.
    const sum = { product: [0, 0, 0], control: [0, 0, 0], pixels: 0 };
    for (let at = 0; at < bare.length; at += 4) {
      const moved =
        Math.abs((control[at] ?? 0) - (bare[at] ?? 0)) +
        Math.abs((control[at + 1] ?? 0) - (bare[at + 1] ?? 0)) +
        Math.abs((control[at + 2] ?? 0) - (bare[at + 2] ?? 0));
      if (moved <= 12) continue;
      sum.pixels += 1;
      for (let channel = 0; channel < 3; channel += 1) {
        (sum.product[channel] as number) += product[at + channel] ?? 0;
        (sum.control[channel] as number) += control[at + channel] ?? 0;
      }
    }
    return sum;
  });
  const meanOf = (sum: readonly number[], pixels: number): number[] =>
    sum.map((channel) => (pixels === 0 ? 0 : channel / pixels));

  // The houses: one shape, both facing back down the road, a square of each
  // front wall half-way between its first window and the door.
  const houseAt = (across: number): ScatterItem => {
    const at = onTheRoad(frame, 40, across);
    const towards = onTheRoad(frame, 10, across);
    const rotation = Math.atan2(towards.x - at.x, towards.z - at.z);
    return { kind: 'building', ...at, rotation, scale: 1, variant: 0 };
  };
  const houses = widestPair(
    (nudge) => [houseAt(11 + nudge), houseAt(-11 - nudge)] as const,
    MASONRY_TINT,
  );
  const plan = buildingPlan('building', 0);
  const front = plan.openings.find((opening) => opening.face.normal[2] > 0.999);
  const firstWindow = plan.openings.find(
    (opening) => opening.face.normal[2] > 0.999 && opening.kind === 'window',
  );
  const us = firstWindow?.outline.map(([u]) => u) ?? [0];
  const vs = firstWindow?.outline.map(([, v]) => v) ?? [0];
  const wallOf = (house: ScatterItem): { x: number; y: number; z: number } => {
    if (front === undefined) return { x: 0, y: 0, z: 0 };
    const [x, y, z] = onFace(
      front.face,
      (Math.min(...us) + Math.max(...us)) / 4,
      (Math.min(...vs) + Math.max(...vs)) / 2,
      0,
    );
    const cos = Math.cos(house.rotation);
    const sin = Math.sin(house.rotation);
    return { x: house.x + x * cos + z * sin, y: house.y + y, z: house.z - x * sin + z * cos };
  };
  const squareOf = (house: ScatterItem): number[] => {
    const centre = pixelFor(frame, canvas, wallOf(house));
    const half = 2;
    const side = half * 2 + 1;
    const pixels = readRegion(
      gl,
      Math.round(centre.x) - half,
      Math.round(centre.y) - half,
      side,
      side,
    );
    const sum = [0, 0, 0];
    for (let at = 0; at < pixels.length; at += 4) {
      for (let channel = 0; channel < 3; channel += 1) {
        (sum[channel] as number) += pixels[at + channel] ?? 0;
      }
    }
    return sum.map((channel) => channel / (side * side));
  };
  const withHouses: SceneFrame = { ...frame, scatter: [...houses] };
  let housesControl: number[][];
  try {
    setRealisticTints(NO_TINT, NO_TINT);
    view.render(withHouses);
    view.render(withHouses);
    housesControl = houses.map(squareOf);
  } finally {
    setRealisticTints(FOLIAGE_TINT, MASONRY_TINT);
  }
  view.render(withHouses);
  const housesProduct = houses.map(squareOf);

  return {
    trees: treeReadings.map((sum) => meanOf(sum.product, sum.pixels)),
    treesControl: treeReadings.map((sum) => meanOf(sum.control, sum.pixels)),
    treePixels: treeReadings.map((sum) => sum.pixels),
    treeTints: tintsOf(trees, FOLIAGE_TINT),
    houses: housesProduct,
    housesControl,
    houseTints: tintsOf(houses, MASONRY_TINT),
  };
}

/**
 * The ground under the realistic scenery, darkened — #620.
 *
 * Two broadleaf trees on the level road, and nothing else: **A**, 7 m ahead,
 * 9 m to the left and 1.4 times the size, whose blob is probed; and **B**, 18 m
 * ahead, 6 m to the left and as large, whose shadow this route's sun throws
 * towards the road's left edge.
 *
 * - **The probe** is the ground in A's blob's core, at its whole darkness —
 *   read off the blob's own instance matrix, so the probe is where the product
 *   put it — at the point nearest the middle no tree covers; and the reference
 *   the ground 5 m from it, outside both blobs, off the road, clear of the
 *   trees and at nearly the probe's depth. Both read with the blobs drawn,
 *   and — **the control** — hidden, where the two must agree to 3 %: what is
 *   measured with them drawn is the blob, not the ground.
 * - **The road's edge**: a point on the verge 0.5 m off it, abreast of B's
 *   blob, drawn and hidden, which must darken: a blob reaches the road's edge.
 *   ⚠️ **Nothing here asserts that it stops there, and that is measured**: on
 *   this level road the verge drops 0.25 m, so a blob beside it lies BELOW
 *   the tarmac and the road's own depth hides whatever of it reaches under
 *   the carriageway — the shader's clip deleted, the road read back
 *   unchanged. Where it would show is ground above the road.
 *   `ground-blob.test.ts` holds the planes on the hairpin for every blob and
 *   every sun, and {@link groundBlobClip} holds the shipped shader's use of
 *   them, with a plane forced through a blob on this road.
 * - **The cost**: non-empty draw calls with the blobs and without.
 */
function groundBlobProbe(
  view: GameView,
  gl: WebGL2RenderingContext,
  canvas: HTMLCanvasElement,
  base: SceneFrame,
): Omit<GroundBlobMeasurement, 'woodedBlobs' | 'woodedTriangles'> {
  const frame: SceneFrame = { ...base, markers: [] };
  const pose = frame.camera;
  const right = { x: -pose.headingZ, z: pose.headingX };
  /** Half the width, in pixels, of the strip the probe and the reference are read over. */
  const STRIP = 10;
  const tree = (ahead: number, across: number, scale: number): ScatterItem => {
    const at = onTheRoad(frame, ahead, across);
    return {
      kind: 'tree-broadleaf',
      x: at.x,
      y: groundAt(at.x, at.z, at.y),
      z: at.z,
      rotation: 0,
      scale,
      variant: 0,
    };
  };
  function groundAt(x: number, z: number, otherwise: number): number {
    const under = { y: otherwise, nx: 0, ny: 1, nz: 0 };
    return groundUnder(frame.terrain.mesh, frame.corridor.centre, x, z, under)
      ? under.y
      : otherwise;
  }
  // ⚠️ A is NEAR, and large, on purpose. The first version stood it 25 m
  // ahead at scale 1, where ground 30 m from a 2 m eye is foreshortened to
  // under a pixel a metre on this 640 × 360 canvas: the blob's core was three
  // pixels tall and every 3 × 3 read mixed it with the ground beyond it, which
  // read back as half the darkening. 7 m ahead at 1.4 puts the core about ten
  // pixels tall.
  const scene: SceneFrame = { ...frame, scatter: [tree(7, -9, 1.4), tree(18, -6, 1.4)] };
  // A strip 21 pixels wide and 3 tall on the ground — wide, because the
  // ground's photograph varies pixel to pixel and a mean over 63 of them is
  // what lets the control hold to 3 % (over 27 it read 3.4 % apart); short, because ground is foreshortened
  // up the screen. The road-edge points are read 3 × 3: they are 0.5 m either
  // side of an edge.
  const meanAround = (point: { x: number; y: number; z: number }, halfWidth = STRIP): number[] => {
    const at = pixelFor(scene, canvas, point);
    const width = halfWidth * 2 + 1;
    const pixels = readRegion(gl, Math.round(at.x) - halfWidth, Math.round(at.y) - 1, width, 3);
    const sum = [0, 0, 0];
    for (let index = 0; index < pixels.length; index += 4) {
      for (let channel = 0; channel < 3; channel += 1) {
        (sum[channel] as number) += pixels[index + channel] ?? 0;
      }
    }
    return sum.map((channel) => channel / (width * 3));
  };
  const settle = (): void => {
    for (let at = 0; at < 4; at += 1) view.render(scene);
  };
  showGroundBlobsOf(view, true);
  settle();
  const drawn = groundBlobsOf(view);
  const blob = (
    slot: number,
  ): {
    readonly x: number;
    readonly y: number;
    readonly z: number;
    readonly rim: (x: number, z: number) => number;
    readonly at: (u: number, v: number) => { readonly x: number; readonly z: number };
  } => {
    const m = drawn.matrices.slice(slot * 16, slot * 16 + 16);
    const [ax, , az] = [m[0] ?? 0, m[1] ?? 0, m[2] ?? 0];
    const [lx, , lz] = [m[8] ?? 0, m[9] ?? 0, m[10] ?? 0];
    const x = m[12] ?? 0;
    const z = m[14] ?? 0;
    return {
      x,
      y: m[13] ?? 0,
      z,
      // Where (x, z) is in the blob's own unit coordinates, as the shader sees it.
      rim: (px: number, pz: number) => {
        const det = ax * lz - az * lx;
        const u = ((px - x) * lz - (pz - z) * lx) / det;
        const v = (ax * (pz - z) - az * (px - x)) / det;
        return Math.hypot(u, v);
      },
      at: (u: number, v: number) => ({ x: x + ax * u + lx * v, z: z + az * u + lz * v }),
    };
  };
  const a = blob(0);
  const b = blob(1);

  // Which pixels a tree covers: the frame with the blobs hidden, against the
  // same frame with no tree at all. A probe must see the GROUND — a leaf card
  // hanging over it would read the same drawn and hidden, and halve the
  // darkening measured (the first run of this probe did exactly that).
  showGroundBlobsOf(view, false);
  settle();
  const withTrees = readRegion(gl, 0, 0, canvas.width, canvas.height);
  const bare: SceneFrame = { ...scene, scatter: [] };
  for (let at = 0; at < 4; at += 1) view.render(bare);
  const withoutTrees = readRegion(gl, 0, 0, canvas.width, canvas.height);
  showGroundBlobsOf(view, true);
  settle();
  const clearOfTrees = (point: { x: number; y: number; z: number }, halfWidth = STRIP): boolean => {
    const centre = pixelFor(scene, canvas, point);
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -halfWidth; dx <= halfWidth; dx += 1) {
        const px = Math.round(centre.x) + dx;
        const py = Math.round(centre.y) + dy;
        if (px < 0 || py < 0 || px >= canvas.width || py >= canvas.height) return false;
        const index = (py * canvas.width + px) * 4;
        for (let channel = 0; channel < 3; channel += 1) {
          if ((withTrees[index + channel] ?? 0) !== (withoutTrees[index + channel] ?? 0))
            return false;
        }
      }
    }
    return true;
  };
  const grounded = (point: { x: number; z: number }): { x: number; y: number; z: number } => ({
    ...point,
    y: groundAt(point.x, point.z, a.y),
  });
  // The probe: the point of A's blob's CORE — where the blob is at its whole
  // darkness — nearest its middle that no tree covers.
  const core: { x: number; y: number; z: number }[] = [];
  for (const u of [0, -0.15, 0.15, -0.3, 0.3]) {
    for (const v of [0, -0.15, 0.15, -0.3, 0.3]) {
      if (Math.hypot(u, v) <= 0.3) core.push(grounded(a.at(u, v)));
    }
  }
  core.sort((p, q) => a.rim(p.x, p.z) - a.rim(q.x, q.z));
  const probePoint = core.find(clearOfTrees) ?? { x: a.x, y: a.y, z: a.z };
  // The reference: 5 m from the probe, outside both blobs, clear of the
  // trees, and off the road and its verge.
  const lateralOf = (point: { x: number; z: number }): number =>
    Math.abs((point.x - pose.x) * right.x + (point.z - pose.z) * right.z);
  // Straight across the view first — the same row of ground, so the same
  // mottle and the same depth — then eight directions between.
  const directions = [
    right,
    { x: -right.x, z: -right.z },
    ...Array.from({ length: 8 }, (_, step) => ({
      x: Math.cos(((step + 0.5) / 8) * 2 * Math.PI),
      z: Math.sin(((step + 0.5) / 8) * 2 * Math.PI),
    })),
  ];
  const candidates = directions
    .map((direction) =>
      grounded({ x: probePoint.x + 5 * direction.x, z: probePoint.z + 5 * direction.z }),
    )
    .filter(
      (point) =>
        a.rim(point.x, point.z) >= 1.2 &&
        b.rim(point.x, point.z) >= 1.2 &&
        lateralOf(point) >= 6.5 &&
        clearOfTrees(point),
    );
  const reference = candidates[0] ?? grounded({ x: probePoint.x, z: probePoint.z + 5 });
  // The road's edge abreast of B's middle: its distance up the road from the
  // centreline point abreast of the camera.
  const aheadOfB = (b.x - pose.x) * pose.headingX + (b.z - pose.z) * pose.headingZ;
  // B stands on the LEFT, where `across` is negative (@see onTheRoad).
  const vergeAt = onTheRoad(scene, aheadOfB, -(3.5 + 0.5));
  const verge = { ...vergeAt, y: groundAt(vergeAt.x, vergeAt.z, vergeAt.y) };

  const read = (): number[][] => [
    meanAround(probePoint),
    meanAround(reference),
    meanAround(verge, 1),
  ];
  const [probe, referenceShown, vergeShown] = read();
  let drawCalls = 0;
  let drawCallsHidden = 0;
  countingNonEmptyDrawCalls((calls) => {
    view.render(scene);
    const before = calls();
    view.render(scene);
    drawCalls = calls() - before;
    showGroundBlobsOf(view, false);
    view.render(scene);
    const middle = calls();
    view.render(scene);
    drawCallsHidden = calls() - middle;
  });
  settle();
  const [probeHidden, referenceHidden, vergeHidden] = read();
  showGroundBlobsOf(view, true);
  view.render(scene);
  const clip = groundBlobClip(view, gl, canvas, scene, a, right, clearOfTrees, grounded);
  return {
    probe: probe ?? [],
    reference: referenceShown ?? [],
    probeHidden: probeHidden ?? [],
    referenceHidden: referenceHidden ?? [],
    probeRim: a.rim(probePoint.x, probePoint.z),
    probeClear: clearOfTrees(probePoint),
    referenceRim: a.rim(reference.x, reference.z),
    referenceClear: clearOfTrees(reference),
    referenceMetres: Math.hypot(reference.x - probePoint.x, reference.z - probePoint.z),
    verge: vergeShown ?? [],
    vergeHidden: vergeHidden ?? [],
    vergeRim: b.rim(verge.x, verge.z),
    edgeClear: clearOfTrees(verge, 1),
    clip,
    drawCalls,
    drawCallsHidden,
    blobs: drawn.blobs,
    triangles: drawn.triangles,
  };
}

/**
 * What a blob mesh's geometry is to {@link groundBlobClip}: named by shape, so
 * this harness names no `three` (`three-seam.test.ts`).
 */
interface BlobClipAttribute {
  readonly array: Float32Array;
  clone(): BlobClipAttribute;
}
interface BlobClipGeometry {
  getAttribute(name: string): BlobClipAttribute | undefined;
  setAttribute(name: string, attribute: BlobClipAttribute): unknown;
}

/**
 * The SHIPPED ground-blob shader's road clip, observed — #686's review, which
 * found it pinned only as text: the vertex lines that carry the planes and the
 * fragment's offset to the fragment test were covered by nothing, and
 * inverting the offset, or never passing the planes on, left every gate green.
 *
 * On this level road the clip cannot be seen as the product lays it — a blob
 * beside the road lies below the tarmac, and the road's depth hides what
 * reaches under it (@see groundBlobProbe). So this forces a plane: tree A's
 * blob is drawn with the geometry's two clip ATTRIBUTES swapped for copies the
 * harness writes, slot 0's first plane `(right, 0)` — through the middle,
 * keeping the screen's right half — and its second the no-op. The belt keeps
 * writing its own attributes, which are not drawn until they are put back.
 * ⚠️ **Nothing here ships**: the swap is this harness's, done on the mesh the
 * view already hands `groundBlobsOf`, and the product has no way to force a
 * plane at all. What is drawn is the real `GROUND_BLOB_VERTEX` and
 * `GROUND_BLOB_FRAGMENT` in the real engine.
 *
 * One point each side of the plane, in A's blob where it is dark and no tree
 * covers it, far enough from the plane's line on screen that the strip read
 * does not straddle it; read with the forced plane, with the control (both
 * planes the no-op), and with the blobs hidden.
 */
function groundBlobClip(
  view: GameView,
  gl: WebGL2RenderingContext,
  canvas: HTMLCanvasElement,
  scene: SceneFrame,
  a: {
    readonly x: number;
    readonly z: number;
    readonly rim: (x: number, z: number) => number;
  },
  right: { readonly x: number; readonly z: number },
  clearOfTrees: (point: { x: number; y: number; z: number }, halfWidth?: number) => boolean,
  grounded: (point: { x: number; z: number }) => { x: number; y: number; z: number },
): GroundBlobClipMeasurement {
  const none: GroundBlobClipMeasurement = {
    measured: false,
    kept: NO_CLIP_POINT,
    clipped: NO_CLIP_POINT,
  };
  const mesh = (view as unknown as { readonly groundBlobMesh?: { geometry: BlobClipGeometry } })
    .groundBlobMesh;
  const geometry = mesh?.geometry;
  const first = geometry?.getAttribute('blobClipFirst');
  const second = geometry?.getAttribute('blobClipSecond');
  if (geometry === undefined || first === undefined || second === undefined) return none;
  /** Half the width of the strip read at each point: small, so it stays one side of the line. */
  const HALF = 3;
  const heading = { x: right.z, z: -right.x };
  const pick = (
    side: 1 | -1,
  ): { x: number; y: number; z: number; metres: number; pixels: number } | undefined => {
    for (const metres of [0.6, 0.8, 1.0, 0.45, 1.2]) {
      for (const along of [0, 0.3, -0.3, 0.6, -0.6]) {
        const point = grounded({
          x: a.x + right.x * metres * side + heading.x * along,
          z: a.z + right.z * metres * side + heading.z * along,
        });
        if (a.rim(point.x, point.z) > 0.6 || !clearOfTrees(point, HALF)) continue;
        const onLine = grounded({
          x: point.x - right.x * metres * side,
          z: point.z - right.z * metres * side,
        });
        const pixels = Math.abs(
          pixelFor(scene, canvas, point).x - pixelFor(scene, canvas, onLine).x,
        );
        if (pixels < HALF + 3) continue;
        return { ...point, metres: metres * side, pixels };
      }
    }
    return undefined;
  };
  const keptAt = pick(1);
  const clippedAt = pick(-1);
  if (keptAt === undefined || clippedAt === undefined) return none;
  const mean = (point: { x: number; y: number; z: number }): number[] => {
    const at = pixelFor(scene, canvas, point);
    const width = HALF * 2 + 1;
    const pixels = readRegion(gl, Math.round(at.x) - HALF, Math.round(at.y) - 1, width, 3);
    const sum = [0, 0, 0];
    for (let index = 0; index < pixels.length; index += 4) {
      for (let channel = 0; channel < 3; channel += 1) {
        (sum[channel] as number) += pixels[index + channel] ?? 0;
      }
    }
    return sum.map((channel) => channel / (width * 3));
  };
  const drawWith = (plane: readonly [number, number, number]): number[][] => {
    const forcedFirst = first.clone();
    const forcedSecond = second.clone();
    forcedFirst.array.set(plane, 0);
    forcedSecond.array.set([0, 0, -1], 0);
    geometry.setAttribute('blobClipFirst', forcedFirst);
    geometry.setAttribute('blobClipSecond', forcedSecond);
    for (let at = 0; at < 4; at += 1) view.render(scene);
    const read = [mean(keptAt), mean(clippedAt)];
    geometry.setAttribute('blobClipFirst', first);
    geometry.setAttribute('blobClipSecond', second);
    return read;
  };
  const [keptForced, clippedForced] = drawWith([right.x, right.z, 0]);
  const [keptControl, clippedControl] = drawWith([0, 0, -1]);
  showGroundBlobsOf(view, false);
  for (let at = 0; at < 4; at += 1) view.render(scene);
  const keptHidden = mean(keptAt);
  const clippedHidden = mean(clippedAt);
  showGroundBlobsOf(view, true);
  for (let at = 0; at < 4; at += 1) view.render(scene);
  const point = (
    at: { x: number; y: number; z: number; metres: number; pixels: number },
    forced: number[] | undefined,
    control: number[] | undefined,
    hidden: number[],
  ): GroundBlobClipPoint => {
    const rim = a.rim(at.x, at.z);
    return {
      metres: at.metres,
      pixels: at.pixels,
      clear: clearOfTrees(at, HALF),
      rim,
      expected: groundBlobAlpha(rim),
      forced: forced ?? [],
      control: control ?? [],
      hidden,
    };
  };
  return {
    measured: true,
    kept: point(keptAt, keptForced, keptControl, keptHidden),
    clipped: point(clippedAt, clippedForced, clippedControl, clippedHidden),
  };
}

/**
 * The realistic world, measured in a real engine — ADR 0026, #425, #474, #369.
 *
 * What jsdom cannot see, and each is one field of {@link RealisticMeasurement}:
 *
 * - **D-7's fallback**: a realistic rung given to a view before any world is
 *   loaded draws the stylised world, and a load that cannot reach its files
 *   says so in the sentence a rider would read.
 * - **D-11 over a real scene**: every physically based material on a visible
 *   mesh is one `three-renderer.ts` constructed, and nothing is the
 *   `MeshPhysicalMaterial` a glTF's extensions would have made `GLTFLoader`
 *   build.
 * - **#242 after light and tone mapping**: the road 20 m ahead on the
 *   steepest climb and the steepest descent, read back off the drawing
 *   buffer, with the control — the same two routes level, which must read
 *   alike, so the contrast measured is the tint's and not the probe's.
 * - **One draw call for the road**, by emptying it.
 * - **#349 for the realistic rider**: the cranks turned, the picture changed;
 *   the cadence gone, the legs held.
 * - **D-3's step down** to the stylised ladder's top, whole.
 */
async function realisticProbe(): Promise<RealisticMeasurement> {
  const WIDTH = 640;
  const HEIGHT = 360;
  // ⚠️ Sized through the VIEW, never by reading the canvas back: `create`
  // applies the view's own size, one CSS pixel, to the canvas before anything
  // resizes it, so `view.resize(canvas.width, …)` asks for a 1 × 1 buffer —
  // which the first version of this probe did, and read four black pixels.
  const canvasOf = (): HTMLCanvasElement => document.createElement('canvas');
  const top = REALISTIC_LADDER[0] as QualitySettings;

  // D-7, before anything is loaded: the rung asks for realism and gets the stylised world.
  const early = threeGameRenderer.create(canvasOf(), top);
  const fallbackWorld = drawnWorldOf(early);
  early.destroy();
  const unreachable = (): Promise<never> => Promise.reject(new Error('Failed to fetch'));
  const failed = await loadRealisticWorld({
    model: unreachable,
    texture: unreachable,
    sky: unreachable,
  });
  const failedNotice = realisticWorldNotice(failed) ?? '';
  phaseEnds('realistic: fallback and failed load');

  const started = performance.now();
  // #475: through the renderer the product ships, which is how `GameView`
  // asks — so a `threeGameRenderer.loadRealisticWorld` that stopped loading
  // anything would leave every realistic assertion below reading the stylised
  // world.
  const outcome = await threeGameRenderer.loadRealisticWorld();
  const loadMs = performance.now() - started;
  phaseEnds('realistic: loadRealisticWorld');

  const steepness = GRADIENT_TINT_FULL_SCALE_PERCENT / 100 + 0.02;
  const climb = northRoute(2_000, (along) => along * steepness);
  const descent = northRoute(2_000, (along) => 2_000 * steepness - along * steepness);
  const level = northRoute(2_000, () => 10);
  const riding = (
    profile: ReturnType<typeof northRoute>,
    distance: number,
    build: FrameBuild = sceneFrame,
  ): SceneFrame => {
    const start = atStartLine(profile);
    return build({
      profile,
      origin: corridorOrigin(profile),
      state: { ...start, ride: { ...start.ride, distance: metres(distance) } },
      crankAngle: 0.4,
    });
  };

  const canvas = canvasOf();
  const view = threeGameRenderer.create(canvas, top);
  view.resize(WIDTH, HEIGHT);
  const gl = canvas.getContext('webgl2');
  if (gl === null) {
    view.destroy();
    return {
      ...NO_REALISTIC,
      fallbackWorld,
      failedLoad: failed.loaded
        ? { loaded: true, offline: false }
        : { loaded: false, offline: failed.offline },
      failedNotice,
    };
  }
  const drawnWorld = drawnWorldOf(view);
  const bridgesWearStone = bridgesWearStoneOf(view);
  const wooded = riding(valleyRoute(), 900);

  let texturesCreated = 0;
  countingTextures((textures) => {
    view.render(wooded);
    texturesCreated = textures();
  });
  // #618: to here is the first realistic frame — the load, a view, and the
  // frame that uploads what it draws — finished on the GPU.
  gl.finish();
  const firstFrameMs = performance.now() - started;
  const materials = sceneMaterialsOf(view).filter((each) => each.visible);
  const standard = materials.filter((each) => each.type === 'MeshStandardMaterial');
  const impostors = materials.filter((each) => each.type === 'ShaderMaterial' && each.constructed);

  let drawCalls = 0;
  let drawCallsWithoutRoad = 0;
  // ⚠️ Non-empty calls only: three still issues a road's draw with a count of
  // zero when its index list is empty, so a plain count cannot tell a road
  // from no road. @see countingNonEmptyDrawCalls
  countingNonEmptyDrawCalls((calls) => {
    view.render(wooded);
    const before = calls();
    view.render(wooded);
    drawCalls = calls() - before;
    const roadless: SceneFrame = {
      ...wooded,
      corridor: { ...wooded.corridor, indices: new Uint32Array(0) },
    };
    view.render(roadless);
    const middle = calls();
    view.render(roadless);
    drawCallsWithoutRoad = calls() - middle;
  });
  phaseEnds('realistic: view, textures, draw calls');

  const textures = await textureProbe(canvasOf);
  phaseEnds('realistic: texture formats — #618');

  const roadLuminance = (frame: SceneFrame): number => {
    const bare: SceneFrame = { ...frame, markers: [], scatter: [] };
    view.render(bare);
    view.render(bare);
    return meanLuminanceAround(gl, pixelFor(bare, canvas, onTheRoad(bare, 20, 1.5)), 3);
  };
  // #544: the distant hills on a level road, and from the top of a descent —
  // where the rider stands above most of the ridge, which is where the
  // photograph's own field and treeline used to show above the hills — then
  // the same frames with the horizon put back to the stylised world's.
  const horizonFrames = [
    { name: 'level', frame: riding(level, 400), columns: [-30, 30] },
    { name: 'descent', frame: riding(descent, 300), columns: [30, 45] },
  ].map((each) => ({ ...each, frame: { ...each.frame, markers: [], scatter: [] } }));
  const readHorizon = (fromSky: boolean): HorizonReading[] => {
    horizonFromSkyOf(view, fromSky);
    return horizonFrames.flatMap(({ name, frame, columns }) => {
      view.render(frame);
      view.render(frame);
      return columns.map((off) => horizonReading(gl, canvas, frame, name, off, fromSky));
    });
  };
  const horizon = readHorizon(true);
  const horizonColours = horizonColoursOf(view);
  const horizonControl = readHorizon(false);
  const horizonColoursControl = horizonColoursOf(view);
  // The control's last frame is the descent's; its fog is that frame's world
  // horizon, as `three-renderer.ts` §`#updateWorld` sets it with no sky.
  const lastControlWorld = horizonFrames[horizonFrames.length - 1]?.frame.world;
  const horizonControlExpected =
    lastControlWorld === undefined
      ? []
      : [16, 8, 0].map((shift) =>
          srgbByteToLinear((lastControlWorld.horizonColour >> shift) & 0xff),
        );
  horizonFromSkyOf(view, true);
  phaseEnds('realistic: horizon');

  // #622: the air — towards the sun and away, the table flattened, the valley.
  const air = airProbe(view, gl, canvas, riding);
  phaseEnds('realistic: air — #622');

  // #628: the wheel track, before the climb and descent are read with the wear on.
  const roadWear = roadWearProbe(view, gl, canvas, riding, slantedLevelRoute());
  phaseEnds('realistic: road wear — #628');

  // #627: the ground, on the hill.
  const groundBlend = groundBlendProbe(view, gl, canvas, riding);
  phaseEnds('realistic: ground blend — #627');

  // #630: the far band's light, and the breeze.
  const foliage = foliageProbe(view, gl, canvas, riding, top);
  phaseEnds('realistic: foliage — #630');

  // #679: the finish gantry, read, and what the gantries cost.
  const gantry = gantryProbe(view, gl, canvas, riding);
  phaseEnds('realistic: gantry — #679');

  // #629: the water, on the lake.
  const waterReflection = waterReflectionProbe(view, gl, canvas, riding);
  phaseEnds('realistic: water reflection — #629');

  const climbLuminance = roadLuminance(riding(climb, 400));
  const descentLuminance = roadLuminance(riding(descent, 400));
  // #628: the same two with the wear off — what the wear spent of the margin.
  roadWearOf(view, false);
  const unwornClimbLuminance = roadLuminance(riding(climb, 400));
  const unwornDescentLuminance = roadLuminance(riding(descent, 400));
  roadWearOf(view, true);
  const levelClimbLuminance = roadLuminance(riding(level, 400));
  const levelDescentLuminance = roadLuminance(riding(level, 400));

  // #349 for the realistic rider: a quarter turn changes the picture; a frame
  // that carries no angle holds the last one.
  const withCrank = (angle: number | undefined): SceneFrame => ({
    ...wooded,
    scatter: [],
    markers: wooded.markers.map((marker) =>
      marker.kind === 'rider' ? { ...marker, crankAngle: angle } : marker,
    ),
  });
  const whole = (): Uint8Array => readRegion(gl, 0, 0, canvas.width, canvas.height);
  view.render(withCrank(0.4));
  view.render(withCrank(0.4));
  const atRest = whole();
  view.render(withCrank(0.4 + Math.PI / 2));
  const turned = whole();
  view.render(withCrank(undefined));
  const held = whole();
  phaseEnds('realistic: road luminance and cranks');

  // #500: a house on the road 24 m ahead, turned to face the camera, and its
  // front ground-floor window read back — then the same square on a view
  // built with no openings, which must read the wall. Without the control, a
  // dark square could be a shadow, the fog or a house that was never drawn.
  const houseFrame = ((): SceneFrame => {
    const base = riding(level, 400);
    const at = onTheRoad(base, 24, 0);
    const towards = onTheRoad(base, 10, 0);
    const rotation = Math.atan2(towards.x - at.x, towards.z - at.z);
    const house: ScatterItem = { kind: 'building', ...at, rotation, scale: 1, variant: 0 };
    return { ...base, markers: [], scatter: [house] };
  })();
  const onTheHouse = (u: number, v: number, w: number): { x: number; y: number; z: number } => {
    const [house] = houseFrame.scatter;
    const face = buildingPlan('building', 0).openings.find(
      (opening) => opening.face.normal[2] > 0.999,
    )?.face;
    if (house === undefined || face === undefined) return { x: 0, y: 0, z: 0 };
    const [x, y, z] = onFace(face, u, v, w);
    const cos = Math.cos(house.rotation);
    const sin = Math.sin(house.rotation);
    return { x: house.x + x * cos + z * sin, y: house.y + y, z: house.z - x * sin + z * cos };
  };
  const frontWindow = buildingPlan('building', 0).openings.find(
    (opening) => opening.face.normal[2] > 0.999 && opening.kind === 'window',
  );
  const windowCentre = (() => {
    const us = frontWindow?.outline.map(([u]) => u) ?? [0];
    const vs = frontWindow?.outline.map(([, v]) => v) ?? [0];
    return {
      u: (Math.min(...us) + Math.max(...us)) / 2,
      v: (Math.min(...vs) + Math.max(...vs)) / 2,
    };
  })();
  const meanRgbAround = (
    context: WebGL2RenderingContext,
    point: { readonly x: number; readonly y: number; readonly z: number },
  ): number[] => {
    const centre = pixelFor(houseFrame, canvas, point);
    const half = 1;
    const side = half * 2 + 1;
    const pixels = readRegion(
      context,
      Math.round(centre.x) - half,
      Math.round(centre.y) - half,
      side,
      side,
    );
    let [red, green, blue] = [0, 0, 0];
    for (let at = 0; at < pixels.length; at += 4) {
      red += pixels[at] ?? 0;
      green += pixels[at + 1] ?? 0;
      blue += pixels[at + 2] ?? 0;
    }
    return [red, green, blue].map((channel) => channel / (side * side));
  };
  const glassPoint = onTheHouse(windowCentre.u, windowCentre.v, -OPENING_RECESS_METRES);
  // The wall beside it: half-way between the window and the door, at the same height.
  const wallPoint = onTheHouse(windowCentre.u / 2, windowCentre.v, 0);
  view.render(houseFrame);
  view.render(houseFrame);
  const windowGlass = meanRgbAround(gl, glassPoint);
  const windowWall = meanRgbAround(gl, wallPoint);
  setBuildingOpenings(false);
  const plainHouseCanvas = canvasOf();
  let plainHouse: ReturnType<typeof threeGameRenderer.create>;
  try {
    plainHouse = threeGameRenderer.create(plainHouseCanvas, top);
    plainHouse.resize(WIDTH, HEIGHT);
    plainHouse.render(houseFrame);
    plainHouse.render(houseFrame);
  } finally {
    // Only after it has drawn: whenever a view builds its belts, this one's are
    // built with none, and every view after it with them again — and in a
    // `finally`, so a throw above cannot leave every later view with none.
    setBuildingOpenings(true);
  }
  const plainHouseGl = plainHouseCanvas.getContext('webgl2');
  const windowControl = plainHouseGl === null ? [] : meanRgbAround(plainHouseGl, glassPoint);
  plainHouse.destroy();
  phaseEnds('realistic: house window');

  // #621, on the same view and the level road.
  const tint = tintProbe(view, gl, canvas, riding(level, 400));
  phaseEnds('realistic: seeded tints');

  // #624, on the same view and the same road.
  const tread = treadProbe(view, gl, canvas, riding(level, 400));
  phaseEnds('realistic: the tread — #624');

  // #623, on the same view and the same road.
  const kit = kitProbe(view, gl, canvas, riding(level, 400));
  phaseEnds('realistic: the kit — #623');

  // #620, on the same view and the same road; then what a whole wooded frame
  // spends on its blobs.
  const groundingProbe = groundBlobProbe(view, gl, canvas, riding(level, 400));
  view.render(wooded);
  view.render(wooded);
  const woodedBlobs = groundBlobsOf(view);
  const grounding: GroundBlobMeasurement = {
    ...groundingProbe,
    woodedBlobs: woodedBlobs.blobs,
    woodedTriangles: woodedBlobs.triangles,
  };
  phaseEnds('realistic: ground blobs');

  // The same frame in the stylised world, on a view of its own: how much of the
  // picture the realistic world actually changed.
  const plainCanvas = canvasOf();
  const plain = threeGameRenderer.create(plainCanvas, qualitySettings(0));
  plain.resize(WIDTH, HEIGHT);
  const plainGl = plainCanvas.getContext('webgl2');
  plain.render(wooded);
  const stylisedPixels =
    plainGl === null
      ? new Uint8Array(0)
      : readRegion(plainGl, 0, 0, plainCanvas.width, plainCanvas.height);
  view.render(wooded);
  const realisticPixels = whole();
  const worldChangedShare =
    stylisedPixels.length === realisticPixels.length
      ? pixelsChanged(stylisedPixels, realisticPixels) / (canvas.width * canvas.height)
      : 0;
  // #622: which of each world's fogged meshes breathe the realistic air.
  const fogged = (list: ReturnType<typeof sceneMaterialsOf>) =>
    list.filter((each) => each.visible && each.fogged);
  const realisticFogged = fogged(sceneMaterialsOf(view));
  const stylisedFogged = fogged(sceneMaterialsOf(plain));
  const atmosphere = {
    realisticTaught: realisticFogged.filter((each) => each.atmospheric).length,
    realisticUntaught: realisticFogged.filter((each) => !each.atmospheric && !each.shared).length,
    realisticShared: realisticFogged.filter((each) => each.shared).length,
    stylisedTaught: stylisedFogged.filter((each) => each.atmospheric).length,
    stylisedFogged: stylisedFogged.length,
  };
  phaseEnds('realistic: stylised comparison');

  // #478: the same frame at the top rung and at a rung with a budget of six.
  // Only the budget differs, so the world is not rebuilt between the two.
  view.render(wooded);
  const sceneryDrawnTop = sceneryDrawnOf(view);
  view.setQuality({
    ...top,
    scatterItems: REALISTIC_PROBE_BUDGET,
    structureItems: 0,
  });
  view.render(wooded);
  const sceneryDrawnBudgeted = sceneryDrawnOf(view);
  view.setQuality(top);

  // #619. ⚠️ Every comparison below reads two frames of ONE settled hand-over
  // (#617 walks a tree between levels over ten frames): the frame is rendered
  // until it has settled, and after that each change is one more render of the
  // same pose, so a difference is the lever and never a tree mid-way. Settling
  // is paid twice — once here and once after the rung change below, whose
  // budget re-ranks the trees — because this load is already the browser
  // gate's longest (#644).
  const settle = (frame: SceneFrame): void => {
    for (let at = 0; at < 11; at += 1) view.render(frame);
  };
  const drawnOnce = (): Uint8Array => {
    view.render(wooded);
    return whole();
  };
  // #619 lever 1: the canopy after every opaque draw — then the control, the
  // order three chose unasked, which must interleave and draw the same picture.
  // `drawOrderOf` draws the frame it reports, so its pixels are read after it.
  settle(wooded);
  const foliageOrder = foliageOrderOf(drawOrderOf(view, wooded));
  const orderedPixels = whole();
  foliageOrderedOf(view, false);
  const foliageOrderControl = foliageOrderOf(drawOrderOf(view, wooded));
  const unorderedPixels = whole();
  foliageOrderedOf(view, true);
  const foliageOrderChangedPixels = pixelsChanged(orderedPixels, unorderedPixels);
  // #619 lever 2: a rung's frame against the same rung with its bias taken to
  // 0. Only the bias differs between the two, so no budget moves between them.
  const shareChanged = (a: Uint8Array, b: Uint8Array): number =>
    a.length === 0 ? 0 : pixelsChanged(a, b) / (a.length / 4);
  // The top rung first, where the frame is already settled: the CONTROL.
  const topPixels = drawnOnce();
  view.setQuality({ ...top, textureLodBias: 0 });
  const textureBiasTopShare = shareChanged(topPixels, drawnOnce());
  const reduced = REALISTIC_LADDER[1] as QualitySettings;
  view.setQuality(reduced);
  settle(wooded);
  const reducedPixels = drawnOnce();
  view.setQuality({ ...reduced, textureLodBias: 0 });
  const textureBiasReducedShare = shareChanged(reducedPixels, drawnOnce());
  view.setQuality(top);

  const frameAt = (distance: number, build: FrameBuild): SceneFrame =>
    riding(valleyRoute(), 800 + distance, build);
  const realisticFrameMs = timeFrames(view, frameAt, gl);
  const stylisedFrameMs = timeFrames(plain, frameAt, plainGl);
  phaseEnds('realistic: budget and frame timing');
  // #475: each view's last frame was its own world's. @see waterSkyOf
  const waterSkyRealistic = waterSkyOf(view);
  const waterSkyStylised = waterSkyOf(plain);
  // #619: there is deliberately no "stylised view forced to a bias" frame
  // here. `render` writes 0 into the one shared bias uniform whenever a view
  // draws the stylised world, so a stylised view at a rung of 1 never reaches
  // a shader and such a comparison could not fail. What guards the stylised
  // world is `realistic-renderer.test.ts` §"biases nothing the stylised world
  // draws", at the material.
  plain.destroy();

  // D-3's step down: the stylised ladder's top, whole.
  view.setQuality(QUALITY_LADDER[0] as QualitySettings);
  view.render(wooded);
  const afterStepDownWorld = drawnWorldOf(view);
  const waterReflectsAfterStepDown = waterReflectsOf(view);
  const bridgesWearStoneAfterStepDown = bridgesWearStoneOf(view);
  const afterStepDownStandard = sceneMaterialsOf(view).filter(
    (each) => each.visible && each.type === 'MeshStandardMaterial',
  ).length;
  phaseEnds('realistic: step down');

  // #623's review (B1): dressed while the view holds no realistic drawing —
  // as `GameView` dresses a new view — then stepped back, which builds the
  // drawing again. @see KitMeasurement.dressedWithNoDrawing
  const kitSquareOnce = kitSquare(riding(level, 400), canvas);
  let dressedWithNoDrawing: number[] = [];
  if (kitSquareOnce !== undefined) {
    view.setRiderKit(KIT_PROBE_CHOICE);
    view.setQuality(top);
    dressedWithNoDrawing = meanRgbOf(readKitSquare(view, gl, kitSquareOnce));
  }
  view.destroy();
  phaseEnds('realistic: the kit, dressed with no drawing — #623');

  console.log(
    `realistic: loaded in ${loadMs.toFixed(0)} ms; a frame ${realisticFrameMs.toFixed(1)} ms against ` +
      `${stylisedFrameMs.toFixed(1)} ms stylised (SwiftShader); ${String(drawCalls)} draw calls; ` +
      `${String(texturesCreated)} textures; road ${climbLuminance.toFixed(4)} climbing, ` +
      `${descentLuminance.toFixed(4)} descending; a window ${windowGlass.map((c) => c.toFixed(0)).join('/')} ` +
      `against ${windowControl.map((c) => c.toFixed(0)).join('/')} with no openings and ` +
      `${windowWall.map((c) => c.toFixed(0)).join('/')} on the wall beside it`,
  );

  return {
    measured: true,
    roadWear,
    groundBlend,
    foliage,
    gantry,
    waterReflection,
    waterReflectsAfterStepDown,
    textures,
    firstFrameMs,
    fallbackWorld,
    failedLoad: failed.loaded
      ? { loaded: true, offline: false }
      : { loaded: false, offline: failed.offline },
    failedNotice,
    loaded: outcome.loaded,
    loadMs,
    drawnWorld,
    visibleStandard: standard.length,
    visibleStandardConstructed: standard.filter((each) => each.constructed).length,
    visiblePhysical: materials.filter((each) => each.type === 'MeshPhysicalMaterial').length,
    visibleImpostors: materials.filter((each) => each.type === 'ShaderMaterial').length,
    visibleImpostorsConstructed: impostors.length,
    texturesCreated,
    drawCalls,
    drawCallsWithoutRoad,
    climbLuminance,
    descentLuminance,
    unwornClimbLuminance,
    unwornDescentLuminance,
    levelClimbLuminance,
    levelDescentLuminance,
    crankTurnPixels: pixelsChanged(atRest, turned),
    crankHeldPixels: pixelsChanged(turned, held),
    worldChangedShare,
    air,
    atmosphere,
    foliageOrder,
    foliageOrderControl,
    foliageOrderChangedPixels,
    textureBiasReducedShare,
    textureBiasTopShare,
    sceneryProbeBudget: REALISTIC_PROBE_BUDGET,
    sceneryDrawnTop,
    sceneryDrawnBudgeted,
    afterStepDownWorld,
    afterStepDownStandard,
    bridgesWearStone,
    bridgesWearStoneAfterStepDown,
    realisticFrameMs,
    stylisedFrameMs,
    waterSkyRealistic,
    waterSkyStylised,
    windowGlass,
    windowControl,
    windowWall,
    tint,
    grounding,
    tread,
    kit: { ...kit, dressedWithNoDrawing },
    horizon,
    horizonControl,
    horizonColours,
    horizonColoursControl,
    horizonControlExpected,
  };
}

/** One frame's draw calls and triangles, and its pixels when asked. @see woodedFrameOf */
interface WoodedFrame {
  readonly triangles: number;
  readonly calls: number;
  readonly pixels?: Uint8Array;
}

/**
 * Draws `frame` twice and counts the SECOND, for `sceneryIndicesByKind`'s
 * reason, at #616's entry points — and reads it back at `size` when asked.
 */
function woodedFrameOf(
  view: GameView,
  gl: WebGL2RenderingContext,
  frame: SceneFrame,
  size?: { readonly width: number; readonly height: number },
): WoodedFrame {
  let triangles = 0;
  let calls = 0;
  countingTriangles((counted, called) => {
    view.render(frame);
    const before = counted();
    const callsBefore = called();
    view.render(frame);
    triangles = counted() - before;
    calls = called() - callsBefore;
  });
  return {
    triangles,
    calls,
    ...(size === undefined ? {} : { pixels: readRegion(gl, 0, 0, size.width, size.height) }),
  };
}

/**
 * The trees' levels of detail in a real engine — #617.
 *
 * - **Triangles**: the wooded frame on a view drawing the product's levels and
 *   on one drawing the hard swap with no middle level, counted at the draw
 *   calls. Each frame is drawn twice and the second counted, for
 *   `sceneryIndicesByKind`'s reason.
 * - **The hand-over**: one broadleaf tree standing still 18.5 m ahead and 6 m
 *   off the road, and seven more level with the rider and 12 to 18 m off to
 *   the left, which walk out 0.1 m a frame — consecutive frames at 6 m/s —
 *   until all seven are further than it. The camera can see those seven
 *   (`three-renderer.ts` §`treeCanBeSeen`, which reckons with the widest
 *   frame there is), so they are ranked, and this 16 : 9 frame does not show
 *   them, which `handOverOffScreenCovered` checks. So the watched tree is
 *   eighth at first (the impostor), passes through band B into the middle
 *   level, through band A, and ends the nearest (the full mesh) — BOTH
 *   hand-overs — while it is the only tree in the picture and the picture
 *   is otherwise still, so what changes frame to frame is its level. The
 *   control is the same counts with no band and no pacing, which swaps it
 *   in one frame at each. ⚠️ Until #617's review this probe moved the TREE
 *   and put two trees behind the camera to fill the first ranks; a tree
 *   behind the camera is not ranked now, and a tree is known frame to frame
 *   by where it stands, so a moving one would be a new tree every frame.
 * - **The nearest tree in the picture** — #617's review: two trees behind the
 *   camera and one 12 m ahead, counted at the draw calls with and without
 *   the one ahead. Its control is the ranking before the review.
 */
function treeLevelProbe(
  wooded: SceneFrame,
  level: SceneFrame,
  width: number,
  height: number,
  top: QualitySettings,
): Pick<
  TreeLevelMeasurement,
  | 'drawnWorld'
  | 'trianglesSubmitted'
  | 'trianglesHardSwap'
  | 'drawCallsSubmitted'
  | 'woodedScenery'
  | 'handOver'
  | 'handOverControl'
  | 'handOverOffScreenCovered'
  | 'nearestVisibleTriangles'
  | 'nearestVisibleTrianglesControl'
> & { readonly woodedPicture: Uint8Array } {
  const build = (levels: TreeLevels): { view: GameView; gl: WebGL2RenderingContext } => {
    setTreeLevels(levels);
    const canvas = document.createElement('canvas');
    let view: GameView;
    try {
      view = threeGameRenderer.create(canvas, top);
    } finally {
      // Only the view just built draws with them: every later one is the product's.
      setTreeLevels(REALISTIC_TREE_LEVELS);
    }
    const gl = canvas.getContext('webgl2');
    if (gl === null) {
      view.destroy();
      throw new Error('#617: no WebGL 2 context for the tree levels');
    }
    return { view, gl };
  };
  // #644: the product's three measurements share ONE view. A view is the
  // dearest thing here — about twelve seconds apiece on the CI runner, measured
  // phase by phase — and the counts and the hand-over read the same with it
  // shared as with a view each, which was checked number for number. Each
  // control still gets a view of its own, because `setTreeLevels` reaches only
  // a view built after it.
  let productView: { view: GameView; gl: WebGL2RenderingContext } | undefined;
  // #644: where only the draw calls are counted, the frame is drawn at a
  // sixteenth of the pixels and the same 16 : 9 — what three culls and what
  // `treeCanBeSeen` ranks depend on the frame's shape, not its size, and the
  // counts were checked to come out the same number for number. SwiftShader
  // pays per pixel; nothing here reads one back.
  const COUNTED = { width: width / 4, height: height / 4 };
  const withLevels = <T>(
    levels: TreeLevels,
    body: (view: GameView, gl: WebGL2RenderingContext) => T,
    size: { readonly width: number; readonly height: number } = { width, height },
  ): T => {
    const shared = levels === REALISTIC_TREE_LEVELS;
    if (shared) productView ??= build(levels);
    const { view, gl } = shared && productView !== undefined ? productView : build(levels);
    try {
      view.resize(size.width, size.height);
      return body(view, gl);
    } finally {
      if (!shared) view.destroy();
    }
  };
  const trianglesOf = (
    levels: TreeLevels,
    picture = false,
  ): WoodedFrame & { trees: number; world: string } =>
    withLevels(
      levels,
      (view, gl) => ({
        ...woodedFrameOf(view, gl, wooded, picture ? { width, height } : undefined),
        trees: sceneryDrawnOf(view),
        world: drawnWorldOf(view),
      }),
      // #639: the product's frame is also READ BACK, at full size, as the
      // picture #639's control must reproduce; the shared view is fresh here.
      picture ? { width, height } : COUNTED,
    );
  const product = trianglesOf(REALISTIC_TREE_LEVELS, true);
  const hardSwap = trianglesOf(HARD_SWAP_TREE_LEVELS);
  phaseEnds('trees: triangles');

  // A broadleaf: a conifer's needles are thin enough that its covered area
  // shimmers by 7 % a frame at one level, which would bury the hand-over.
  const tree = (ahead: number, across: number): ScatterItem => ({
    kind: 'tree-broadleaf',
    ...onTheRoad(level, ahead, across),
    rotation: 0,
    scale: 1,
    variant: 0,
  });
  // Placed from the RIDER rather than from the centreline, because the rank is
  // a distance from the rider, who rides 1.75 m right of it (#546).
  const pose = level.camera;
  const fromRider = (ahead: number, across: number): ScatterItem => ({
    kind: 'tree-broadleaf',
    x: pose.x + ahead * pose.headingX - across * pose.headingZ,
    y: onTheRoad(level, ahead, 0).y,
    z: pose.z + ahead * pose.headingZ + across * pose.headingX,
    rotation: 0,
    scale: 1,
    variant: 0,
  });
  // The watched tree stands still, 18.5 m ahead: a tree is known frame to
  // frame by WHERE it stands (`tree-levels.ts` §`TreeHandOver`), as every
  // tree in a ride is. What moves is the seven others, level with the rider
  // and 12 to 18 m off to the left — ranked, because the camera can see
  // them, and out of this 16 : 9 frame — walking out 0.1 m a frame until
  // all seven are further than the watched tree.
  const watched = tree(18.5, 6);
  const watchedDistance = Math.hypot(watched.x - pose.x, watched.z - pose.z);
  const asideAt = (out: number): ScatterItem[] =>
    [12, 13, 14, 15, 16, 17, 18].map((distance) => fromRider(0, -(distance + out)));
  const steps = Array.from({ length: 91 }, (_, index) => index * 0.1);
  let offScreen = 0;
  const handOverOf = (levels: TreeLevels): TreeHandOver =>
    withLevels(levels, (view, gl) => {
      const bare: SceneFrame = { ...level, scatter: [] };
      view.render(bare);
      const nothing = readRegion(gl, 0, 0, width, height);
      for (const out of [steps[0] ?? 0, steps.at(-1) ?? 0]) {
        view.render({ ...level, scatter: asideAt(out) });
        offScreen = Math.max(
          offScreen,
          pixelsChanged(nothing, readRegion(gl, 0, 0, width, height)),
        );
      }
      let previous: Uint8Array | undefined;
      const changed: number[] = [];
      const covered = steps.map((out) => {
        view.render({ ...level, scatter: [...asideAt(out), watched] });
        const pixels = readRegion(gl, 0, 0, width, height);
        changed.push(previous === undefined ? 0 : colourMoved(previous, pixels));
        previous = pixels;
        return pixelsChanged(nothing, pixels);
      });
      return { out: steps, covered, changed };
    });
  const handOver = handOverOf(REALISTIC_TREE_LEVELS);
  phaseEnds('trees: hand-over');
  const handOverControl = handOverOf({
    ...REALISTIC_TREE_LEVELS,
    dithered: false,
    handOverFrames: 1,
  });
  phaseEnds('trees: hand-over control');
  if (!(watchedDistance > 18.2 && watchedDistance < 19.8)) {
    throw new Error(`#617: the watched tree is ${String(watchedDistance)} m away`);
  }

  // Two trees behind the camera, which is 4.5 m behind the rider, and one in
  // the picture. Rendered until every hand-over has settled, then counted.
  const passed = [tree(-10, 0), tree(-14, 0)];
  const nearestOf = (levels: TreeLevels): number =>
    withLevels(
      levels,
      (view) => {
        const settled = (frame: SceneFrame): number => {
          let triangles = 0;
          for (let at = 0; at < 3 * levels.handOverFrames; at += 1) view.render(frame);
          countingTriangles((counted) => {
            const before = counted();
            view.render(frame);
            triangles = counted() - before;
          });
          return triangles;
        };
        const without = settled({ ...level, scatter: passed });
        return settled({ ...level, scatter: [...passed, tree(12, 6)] }) - without;
      },
      COUNTED,
    );
  const nearestVisibleTriangles = nearestOf(REALISTIC_TREE_LEVELS);
  const nearestVisibleTrianglesControl = nearestOf({
    ...REALISTIC_TREE_LEVELS,
    rankOnly: 'in-view',
  });
  phaseEnds('trees: nearest visible');
  productView?.view.destroy();
  console.log(
    `#617: the wooded view submits ${String(product.triangles)} triangles against ` +
      `${String(hardSwap.triangles)} with the hard swap (${String(hardSwap.triangles - product.triangles)} fewer), ` +
      `${String(product.trees)} scenery items drawn, in ${String(product.calls)} draw calls`,
  );
  return {
    drawnWorld: product.world,
    trianglesSubmitted: product.triangles,
    trianglesHardSwap: hardSwap.triangles,
    drawCallsSubmitted: product.calls,
    woodedPicture: product.pixels ?? new Uint8Array(0),
    woodedScenery: product.trees,
    handOver,
    handOverControl,
    handOverOffScreenCovered: offScreen,
    nearestVisibleTriangles,
    nearestVisibleTrianglesControl,
  };
}

/**
 * Every measurement at its "nothing was measured" value — what a run that
 * could not measure publishes, and what the `?realistic` run publishes beside
 * the one measurement it takes.
 */
/**
 * The `?realistic&trees` load — #644. #617's probes were added to the
 * `?realistic` run and made it more than twice as long, past its budget on the
 * CI runner; here they are a load of their own, with the same frames they
 * were measured on there: the wooded view at 900 m of the valley route, and
 * the level road at 400 m with no riders. The realistic world is loaded first,
 * through the renderer the product ships, exactly as `realisticProbe` does.
 */
async function treeLevelRun(): Promise<TreeLevelMeasurement> {
  const top = REALISTIC_LADDER[0] as QualitySettings;
  await threeGameRenderer.loadRealisticWorld();
  phaseEnds('trees: loadRealisticWorld');
  // #630: in still air. Every measurement of this load compares two drawings
  // of one frame pixel for pixel — two levels, two material layouts — and is
  // about WHICH level draws; the breeze moves a merged and an unmerged tree by
  // a rounding apart (3 pixels of 230 400, measured), and has its own gate on
  // the `?realistic` load. Module state and this load's alone: the page is
  // this load's.
  foliageStillOf(true);
  const riding = (profile: ReturnType<typeof northRoute>, distance: number): SceneFrame => {
    const start = atStartLine(profile);
    return sceneFrame({
      profile,
      origin: corridorOrigin(profile),
      state: { ...start, ride: { ...start.ride, distance: metres(distance) } },
      crankAngle: 0.4,
    });
  };
  const wooded = riding(valleyRoute(), 900);
  const level = {
    ...riding(
      northRoute(2_000, () => 10),
      400,
    ),
    markers: [],
  };
  const { woodedPicture, ...probed } = treeLevelProbe(wooded, level, 640, 360, top);
  // #639's control: the world loaded as it was before #639, each tree's parts
  // one per material, and the same wooded frame on a fresh view at the same
  // size, drawn twice as the product's was.
  setRealisticMaterialsMerged(false);
  let unmerged: WoodedFrame;
  try {
    // `loadRealisticWorld` itself, which REPLACES the loaded world: the port's
    // is `loadRealisticWorldOnce`, which answers with the world already loaded.
    const outcome = await loadRealisticWorld();
    if (!outcome.loaded)
      throw new Error(`#639: the control's world did not load: ${outcome.detail}`);
    const canvas = document.createElement('canvas');
    const view = threeGameRenderer.create(canvas, top);
    const gl = canvas.getContext('webgl2');
    try {
      if (gl === null) throw new Error('#639: no WebGL 2 context for the control');
      view.resize(640, 360);
      unmerged = woodedFrameOf(view, gl, wooded, { width: 640, height: 360 });
    } finally {
      view.destroy();
    }
  } finally {
    setRealisticMaterialsMerged(true);
  }
  phaseEnds('trees: unmerged control');
  const pixels = unmerged.pixels ?? new Uint8Array(0);
  return {
    measured: true,
    ...probed,
    drawCallsUnmerged: unmerged.calls,
    trianglesUnmerged: unmerged.triangles,
    unmergedPixelsChanged:
      pixels.length === woodedPicture.length ? pixelsChanged(woodedPicture, pixels) : Number.NaN,
    pixelsCompared: woodedPicture.length / 4,
  };
}

function emptyHarness(errors: readonly string[]): NonNullable<Window['__oylGameHarness']> {
  return {
    created: false,
    hasContext: false,
    framesDrawn: 0,
    quadCount: 0,
    vertexCount: 0,
    indexCount: 0,
    highestIndex: 0,
    drawCallsPerFrame: 0,
    markerKinds: [],
    world: NO_WORLD,
    skyPixel: NOWHERE,
    groundPixel: NOWHERE,
    roadPixel: NOWHERE,
    roadFarPixel: NOWHERE,
    roadProbeRows: [0, 0],
    riderFrame: { landscape: NO_RIDER, portrait: NO_RIDER },
    line: {
      on: NO_LINE,
      onUpright: NO_LINE,
      off: NO_LINE,
      straightOn: NO_LINE,
      straightOff: NO_LINE,
    },
    bend: { right: NO_BEND, mirrored: NO_BEND },
    resourcesAfterFirstFrame: 0,
    resourcesAfterAllFrames: 0,
    resourcesAfterSecondSweep: 0,
    centreLinePixel: NOWHERE,
    roadBesidePixel: NOWHERE,
    centreLineRowFraction: 0,
    roadOnDescentPixel: NOWHERE,
    scatterItemCount: 0,
    scatterKindCount: 0,
    drawCallsWithScatter: 0,
    drawCallsWithoutScatter: 0,
    sceneryPixelsChanged: 0,
    sceneryPixelWith: NOWHERE,
    sceneryPixelWithout: NOWHERE,
    sceneryColumnFraction: 0,
    sceneryRowFraction: 0,
    litMarkerPixels: 0,
    flatMarkerPixels: 0,
    litMarkerSpread: 0,
    flatMarkerSpread: 0,
    litMarkerBrightest: NOWHERE,
    litMarkerDarkest: NOWHERE,
    crankTurnPixels: 0,
    crankStillPixels: 0,
    riderPixels: 0,
    riderLeftBehindPixels: 0,
    riderMovePixels: 0,
    litFrameMs: 0,
    flatFrameMs: 0,
    shadedFrames: SHADING_FRAMES,
    frameMsNoise: 0,
    litDrawCalls: 0,
    flatDrawCalls: 0,
    sceneryIndicesModelled: {},
    sceneryIndicesPlain: {},
    sceneryInstances: {},
    texturesCreated: 0,
    texturesBaseline: 0,
    treeRedPixels: 0,
    treeGreenPixels: 0,
    buildingGreenPixels: 0,
    buildingBluePixels: 0,
    sceneryCallsByVariants: [],
    variantIndices: {},
    riderMeanColour: {},
    riderSilhouettePixels: {},
    riderBuriedPixels: 0,
    gradient: NO_GRADIENT,
    water: NO_WATER,
    settlement: NO_SETTLEMENT,
    nearField: NO_NEAR_FIELD,
    botCrankPixels: 0,
    contactShadowPixels: {},
    contactShadowLuminance: {},
    contactShadowNoise: 0,
    shadowMap: NO_SHADOW_MAP,
    presenceCost: NO_PRESENCE_COST,
    rideStart: NO_RIDE_START,
    realistic: NO_REALISTIC,
    trees: NO_TREES,
    errors,
  };
}

async function run(): Promise<void> {
  const canvas = document.querySelector<HTMLCanvasElement>('#world');
  const errors: string[] = [];
  // ⚠️ **Before anything is created, because `GameRenderer.create` is
  // synchronous** — `port.ts` fixes that, and `main.tsx` awaits this in exactly
  // the same place and for exactly the same reason. A harness that skipped it
  // would draw the primitive world and every assertion below would pass.
  await loadSceneryModels();
  phaseEnds('scenery models');
  // ADR 0026. A run of its own, so the default run fetches none of the
  // realistic set — which `game.browser.spec.ts` asserts off the requests it
  // makes — and so the realistic world's load is paid by one page load only.
  if (new URLSearchParams(location.search).has('trees')) {
    try {
      const trees = await treeLevelRun();
      window.__oylGameHarness = { ...emptyHarness(errors), trees };
    } catch (error: unknown) {
      errors.push(error instanceof Error ? error.message : String(error));
      window.__oylGameHarness = emptyHarness(errors);
    }
    return;
  }
  if (new URLSearchParams(location.search).has('realistic')) {
    try {
      const realistic = await realisticProbe();
      // #545, in the world the owner saw it in — after `realisticProbe`, which
      // is what loaded that world. @see nearFieldProbe
      const nearField = nearFieldProbe(1_600, 200, REALISTIC_LADDER[0] as QualitySettings);
      phaseEnds('near field');
      window.__oylGameHarness = { ...emptyHarness(errors), realistic, nearField };
    } catch (error: unknown) {
      errors.push(error instanceof Error ? error.message : String(error));
      window.__oylGameHarness = emptyHarness(errors);
    }
    return;
  }
  if (canvas === null) {
    window.__oylGameHarness = emptyHarness(['no canvas']);
    return;
  }

  /**
   * Which of the two default loads this is — #651. They ran the SAME probes,
   * every one of them, and each case reads only one load's copy: the shading's
   * cost, #426's shadow map, #390's presence check and #547's ride start are
   * read off `?shadow-map` alone, and everything else off the plain page
   * alone (`game.browser.spec.ts`, every `harness(harnessRun, …)`). So each
   * load now takes only what its own cases read. Measured on the runner, phase
   * by phase (run 36334163962): the plain page spent 12.6 s of its 34 timing
   * the shading for nobody, and `?shadow-map` about 16 s of its 55 on the
   * models, the variants, the colours, the ground, the water, the settlements
   * and the three probes after them, for nobody. The sweeps and the light
   * probe before the timing still run in both: they are what the timing is
   * taken on the far side of, and they cost about 5 s.
   */
  const SHADOW_MAP_LOAD = new URLSearchParams(location.search).has('shadow-map');

  let created = false;
  let hasContext = false;
  let framesDrawn = 0;
  let quadCount = 0;
  let vertexCount = 0;
  let indexCount = 0;
  let highestIndex = 0;
  let drawCallsPerFrame = 0;
  let markerKinds: readonly string[] = [];
  let world: WorldStyle = NO_WORLD;
  let skyPixel: Pixel = NOWHERE;
  let groundPixel: Pixel = NOWHERE;
  let roadPixel: Pixel = NOWHERE;
  let roadFarPixel: Pixel = NOWHERE;
  let roadProbeRows: readonly [number, number] = [0, 0];
  let riderFrame = { landscape: NO_RIDER, portrait: NO_RIDER };
  let line = {
    on: NO_LINE,
    onUpright: NO_LINE,
    off: NO_LINE,
    straightOn: NO_LINE,
    straightOff: NO_LINE,
  };
  let bend = { right: NO_BEND, mirrored: NO_BEND };
  let resourcesAfterFirstFrame = 0;
  let resourcesAfterAllFrames = 0;
  let resourcesAfterSecondSweep = 0;
  let centreLinePixel: Pixel = NOWHERE;
  let roadBesidePixel: Pixel = NOWHERE;
  let centreLineRowFraction = 0;
  let roadOnDescentPixel: Pixel = NOWHERE;
  let scatterItemCount = 0;
  let scatterKindCount = 0;
  let drawCallsWithScatter = 0;
  let drawCallsWithoutScatter = 0;
  let sceneryPixelsChanged = 0;
  let sceneryPixelWith: Pixel = NOWHERE;
  let sceneryPixelWithout: Pixel = NOWHERE;
  let sceneryColumnFraction = 0;
  let sceneryRowFraction = 0;
  let litMarkerPixels = 0;
  let flatMarkerPixels = 0;
  let crankTurnPixels = 0;
  let crankStillPixels = 0;
  let riderPixels = 0;
  let riderLeftBehindPixels = 0;
  let riderMovePixels = 0;
  let litMarkerSpread = 0;
  let flatMarkerSpread = 0;
  let litMarkerBrightest: Pixel = NOWHERE;
  let litMarkerDarkest: Pixel = NOWHERE;
  let litFrameMs = 0;
  let flatFrameMs = 0;
  let frameMsNoise = 0;
  let litDrawCalls = 0;
  let flatDrawCalls = 0;
  let sceneryIndicesModelled: Record<string, number> = {};
  let sceneryIndicesPlain: Record<string, number> = {};
  const sceneryInstances: Record<string, number> = {};
  let texturesCreated = 0;
  let texturesBaseline = 0;
  let treeRedPixels = 0;
  let treeGreenPixels = 0;
  let buildingGreenPixels = 0;
  let buildingBluePixels = 0;
  let sceneryCallsByVariants: readonly number[] = [];
  let variantIndices: Record<string, readonly number[]> = {};
  const riderMeanColour: Record<string, Pixel> = {};
  const riderSilhouettePixels: Record<string, number> = {};
  let riderBuriedPixels = 0;
  let gradient: GradientMeasurement = NO_GRADIENT;
  let water: WaterMeasurement = NO_WATER;
  let settlement: SettlementMeasurement = NO_SETTLEMENT;
  let botCrankPixels = 0;
  let contactShadowPixels: Record<string, number> = {};
  let contactShadowLuminance: Record<string, readonly [number, number]> = {};
  let contactShadowNoise = 0;
  let shadowMap: ShadowMapMeasurement = NO_SHADOW_MAP;
  let presenceCost: PresenceCostMeasurement = NO_PRESENCE_COST;
  let rideStart: RideStartMeasurement = NO_RIDE_START;
  /** The frame the model comparison is measured on. @see sceneryIndicesByKind */
  let probeFrame: SceneFrame | null = null;
  /** The frame the variant measurements are taken on. @see variantIndices */
  let variantFrame: SceneFrame | null = null;

  try {
    const profile = harnessRoute();
    const origin = corridorOrigin(profile);

    const start = atStartLine(profile);
    const frameAt = (distance: number, build: FrameBuild = sceneFrame) =>
      build({
        profile,
        origin,
        state: { ...start, ride: { ...start.ride, distance: metres(distance) } },
        botDistance: distance + 120,
      });

    countingGpuResources((resources) => {
      countingDrawCalls((calls) => {
        const view = threeGameRenderer.create(canvas, qualitySettings(0));
        created = true;
        hasContext = view.hasContext;
        view.resize(600, 400);

        const frame = frameAt(0);
        // ⚠️ **The #341 probe's scenery is built, not placed, and that is a
        // finding rather than a shortcut.** The comparison measures each kind
        // on its own, so a kind this route's frames happen not to hold draws
        // nothing under **both** conditions and reads exactly like a model that
        // failed to load. No frame of this route holds all six — the harness
        // route was searched, 25 m at a time for 1.5 km, and buildings and
        // conifers never share one. So the probe carries one item of each,
        // placed in front of the camera by the same `along`/`across` frame the
        // belt culls in, which also makes each number below the index count of
        // exactly one instance.
        //
        // ⚠️ Nothing about **placement** may be read off this: the belt is
        // handed a `SceneFrame` and does not know who built it, which is the
        // property being used here. Where `scatter.ts` really puts things is
        // `arrangement-unchanged.test.ts`, on the real route, in jsdom.
        const pose = frame.camera;
        probeFrame = {
          ...frame,
          scatter: SCENERY_KINDS.map((kind, at) => placedAhead(pose, kind, 0, 40 + at * 15, 8)),
        };
        // ⚠️ **A second probe, for #367, and it is a different shape of
        // frame.** The one above carries exactly one item of each kind, which
        // is what makes each index count the cost of a single instance — and
        // every one of those items is variant 0, so it would measure a world
        // with no variety at all however many shapes a kind had. This one
        // carries one item per **slot** per kind, so every mesh the belt owns
        // is asked for and the draw-call count below is the belt's real width.
        variantFrame = {
          ...frame,
          markers: [],
          scatter: SCENERY_KINDS.flatMap((kind, at) =>
            Array.from({ length: SCATTER_VARIANT_SLOTS }, (_, slot) =>
              placedAhead(pose, kind, slot, 40 + at * 15, 8 + slot * 4),
            ),
          ),
        };
        world = frame.world;
        quadCount = frame.corridor.quadCount;
        vertexCount = frame.corridor.vertices.length;
        indexCount = frame.corridor.indices.length;
        for (const index of frame.corridor.indices) {
          highestIndex = Math.max(highestIndex, index);
        }
        markerKinds = frame.markers.map((marker) => marker.kind);
        scatterItemCount = frame.scatter.length;
        scatterKindCount = new Set(frame.scatter.map((each) => each.kind)).size;

        // A hundred frames rather than one. The first uploads the buffers, and
        // a bug that only appears when a buffer is *reused* would be invisible
        // in a single-frame harness.
        const before = calls();
        view.render(frame);
        framesDrawn += 1;
        drawCallsPerFrame = calls() - before;
        resourcesAfterFirstFrame = resources();

        // ⚠️ **The ninety-five after it move the rider**, which the harness
        // did not do before #242. A corridor rebuilt at a new distance is a
        // new set of vertices and a new set of centre-line marks, and a road
        // whose buffer grew by one mark as the rider crossed a period would
        // allocate on the GPU forever — #240's NFR-3, and the whole reason
        // `terrain.ts` emits a zero-area quad for a mark outside the corridor
        // rather than leaving it out.
        //
        // It is a named function since #244 because the whole sweep is driven
        // **twice** — see {@link resourcesAfterSecondSweep} — and a second pass
        // over slightly different distances would be measuring a different
        // route rather than the same one again.
        // ⚠️ **Counted, not asserted on the sweep's behalf.** This read
        // `framesDrawn = FRAMES - 4` until #268's review: a literal that goes
        // on claiming a hundred after somebody changes `sweep`'s bounds, which
        // leaves `game.browser.spec.ts`'s `framesDrawn === FRAMES` green over a
        // harness that stopped doing what it says.
        framesDrawn += sweep(view, frameAt);

        // Read the drawing buffer back. `preserveDrawingBuffer` is off, so this
        // is only valid immediately after a render and before the compositor
        // takes the frame — which is why it happens here rather than in the
        // spec, and why the frame being read is re-rendered first.
        view.render(frame);
        framesDrawn += 1;
        const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
        if (gl !== null) {
          // ⚠️ **Aimed from the geometry since #424** — @see inTheFrame for
          // what the fixed fractions these replace were pointing at by the time
          // the camera had moved. The sky is the one probe that is still a
          // fraction, because it is the one with no geometry to aim at: 5 %
          // down a frame whose horizon is about half way down it.
          skyPixel = readPixel(gl, canvas.width * 0.5, canvas.height * 0.95);
          const beside = onTheRoad(frame, GROUND_PROBE.ahead, GROUND_PROBE.across);
          const ground = pixelFor(frame, canvas, {
            ...beside,
            // ⚠️ Since #458 the ground is the ROAD's height less the verge
            // drop, at the probe's own distance up the road — it used to be a
            // flat plane at the RIDER's height, and this read `camera.y`.
            y: beside.y - VERGE_DROP_METRES,
          });
          groundPixel = readPixel(gl, ground.x, ground.y);
          const near = pixelFor(
            frame,
            canvas,
            onTheRoad(frame, NEAR_ROAD_PROBE.ahead, NEAR_ROAD_PROBE.across),
          );
          roadPixel = readPixel(gl, near.x, near.y);
          // The fourth probe, and the only one that can see the fog.
          const far = pixelFor(
            frame,
            canvas,
            onTheRoad(frame, FAR_ROAD_PROBE.ahead, FAR_ROAD_PROBE.across),
          );
          roadFarPixel = readPixel(gl, far.x, far.y);
          roadProbeRows = [1 - near.y / canvas.height, 1 - far.y / canvas.height];
          const found = findCentreLine(
            gl,
            canvas.width,
            pixelFor(frame, canvas, onTheRoad(frame, CENTRE_LINE_STRETCH.fromAhead, 0)),
            pixelFor(frame, canvas, onTheRoad(frame, CENTRE_LINE_STRETCH.toAhead, 0)),
          );
          centreLinePixel = found.centre;
          roadBesidePixel = found.beside;
          centreLineRowFraction = found.row / canvas.height;
        }

        // ⚠️ **The same frame twice, once with the scenery and once with it
        // emptied** — #244. Everything else known about the belt is asserted in
        // jsdom against objects that need no GL context, and every one of those
        // assertions passes for a belt that was never added to the scene, or
        // whose instances are all scaled to zero, or whose count never leaves
        // nought. Only a frame that was drawn twice can tell the difference,
        // and only in a browser.
        //
        // The order matters and is the cheap way round: the scenery frame is
        // rendered first so that its GPU buffers were already created by the
        // ninety-odd frames above it, and the difference in `calls()` between
        // the two is the number of draw calls the scenery itself costs.
        const withoutScenery: SceneFrame = { ...frame, scatter: [] };
        const originColumn = Math.floor(canvas.width * SCENERY_REGION.fromColumn);
        const originRow = Math.floor(canvas.height * SCENERY_REGION.fromRow);
        const regionWidth = Math.floor(canvas.width * SCENERY_REGION.toColumn) - originColumn;
        const regionHeight = Math.floor(canvas.height * SCENERY_REGION.toRow) - originRow;

        const beforeWithScenery = calls();
        view.render(frame);
        framesDrawn += 1;
        drawCallsWithScatter = calls() - beforeWithScenery;
        const sceneryPresent =
          gl === null
            ? undefined
            : readRegion(gl, originColumn, originRow, regionWidth, regionHeight);

        const beforeWithoutScenery = calls();
        view.render(withoutScenery);
        framesDrawn += 1;
        drawCallsWithoutScatter = calls() - beforeWithoutScenery;
        if (gl !== null && sceneryPresent !== undefined) {
          const sceneryAbsent = readRegion(gl, originColumn, originRow, regionWidth, regionHeight);
          const found = compareRegions(
            sceneryPresent,
            sceneryAbsent,
            regionWidth,
            regionHeight,
            originColumn,
            originRow,
            canvas.width,
            canvas.height,
          );
          sceneryPixelsChanged = found.changed;
          sceneryPixelWith = found.with;
          sceneryPixelWithout = found.without;
          sceneryColumnFraction = found.columnFraction;
          sceneryRowFraction = found.rowFraction;
        }

        // The last frame, and the only one read back from a *different* place
        // on the route. @see roadOnDescentPixel
        const descending = frameAt(ON_THE_DESCENT_METRES);
        view.render(descending);
        framesDrawn += 1;
        if (gl !== null) {
          const at = pixelFor(
            descending,
            canvas,
            onTheRoad(descending, NEAR_ROAD_PROBE.ahead, NEAR_ROAD_PROBE.across),
          );
          roadOnDescentPixel = readPixel(gl, at.x, at.y);
        }
        resourcesAfterAllFrames = resources();
        phaseEnds('default: first sweep and read-backs');

        // ⚠️ **The same hundred frames again**, and the frames of this second
        // pass are deliberately not counted into {@link framesDrawn}. @see
        // {@link resourcesAfterSecondSweep} for what the pair of counts is for.
        void sweep(view, frameAt);
        view.render(frame);
        view.render(withoutScenery);
        view.render(frameAt(ON_THE_DESCENT_METRES));
        resourcesAfterSecondSweep = resources();
        phaseEnds('default: second sweep');

        // ------------------------------------------------ the light — #286
        //
        // ⚠️ **Everything below runs at rung 0's own render scale, with only
        // `shading` overridden.** `qualitySettings(4)` is the rung that turns
        // the shading off in the product, and it *also* halves the drawing
        // buffer — so measuring against it would confound a shading cost with
        // a fill-rate cost, and a pixel read back at half the resolution is a
        // different pixel. The rung itself is asserted in jsdom
        // (`three-renderer.test.ts` §"the scenery can lose its shading"); what
        // needs a driver is what the shading *does*, and this isolates it.
        const lit = { ...qualitySettings(0), shading: 'lit' as const };
        const flat = { ...qualitySettings(0), shading: 'flat' as const };

        // One marker alone, and then nothing at all. The difference is that
        // object's silhouette, 8 m from the camera, with no road gradient, no
        // scenery and no fog in it. @see shadingAcross
        const riderOnly: SceneFrame = {
          ...frame,
          markers: frame.markers.filter((marker) => marker.kind === 'rider'),
          scatter: [],
        };
        const noMarkers: SceneFrame = { ...riderOnly, markers: [] };
        // ⚠️ **A marker POST at the rider's own position, and it is the third
        // thing this probe has been.** The spread below is the whole of what
        // says the world has a light direction, and it rests on the probe being
        // **one colour**: whatever varies across it is then the light and
        // nothing else.
        //
        // It was the rider's own sphere until #349, which made the rider a
        // bicycle in four colours — reading as a spread of 183 levels with the
        // shading switched entirely off. #349 moved it to the **bot's** cone,
        // and #368 has now made that a bicycle too: there is no solid marker
        // left in this scene at all.
        //
        // ⚠️ So the probe is a piece of **scenery**, and `post` is the one kind
        // ADR 0022 D-3 leaves procedural — a five-sided cylinder painted in one
        // colour, with faces at several orientations, which is exactly what the
        // cone was chosen for. Everything else about the probe is identical:
        // same distance, same depth, same absence of a fog gradient. It is
        // scaled up because a post is 1.1 m tall and the claim is about levels
        // across a silhouette rather than about eight pixels of one.
        const oneColourSolid: SceneFrame = {
          ...frame,
          markers: [],
          scatter: [{ ...placedAhead(pose, 'post', 0, 9, 0), scale: 4 }],
        };
        /** The same frame with the probe taken out. @see oneColourSolid */
        const withoutTheSolid: SceneFrame = { ...oneColourSolid, scatter: [] };
        const wholeFrame = () =>
          gl === null ? undefined : readRegion(gl, 0, 0, canvas.width, canvas.height);

        for (const [settings, record] of [
          [lit, 'lit'],
          [flat, 'flat'],
        ] as const) {
          view.setQuality(settings);
          const beforeCalls = calls();
          view.render(oneColourSolid);
          const drawn = calls() - beforeCalls;
          const present = wholeFrame();
          view.render(withoutTheSolid);
          const absent = wholeFrame();
          if (present !== undefined && absent !== undefined) {
            const found = shadingAcross(present, absent);
            if (record === 'lit') {
              litMarkerPixels = found.pixels;
              litMarkerSpread = found.spread;
              litMarkerBrightest = found.brightest;
              litMarkerDarkest = found.darkest;
              litDrawCalls = drawn;
            } else {
              flatMarkerPixels = found.pixels;
              flatMarkerSpread = found.spread;
              flatDrawCalls = drawn;
            }
          }
        }

        // ----------------------------------------- the pedalling — #349
        //
        // ⚠️ **At rung 0's own settings, and on the rider-only frame**, so the
        // only thing that can differ between the two reads is the rider. The
        // control is drawn first and compared against the identical frame
        // before it, which is what makes a non-zero difference below evidence
        // of the cranks rather than of a renderer that is never still.
        // ⚠️ With the riders' shadows off (#426): what is counted below is the
        // BICYCLE's own silhouette, and a blob under it is not the bicycle.
        view.setQuality({ ...lit, riderShadows: 'none' });
        const cranksAt = (angle: number): SceneFrame => ({
          ...riderOnly,
          markers: riderOnly.markers.map((marker) => ({ ...marker, crankAngle: angle })),
        });
        view.render(cranksAt(0));
        const atTopOfTheStroke = wholeFrame();
        view.render(noMarkers);
        const withNoRider = wholeFrame();
        if (atTopOfTheStroke !== undefined && withNoRider !== undefined) {
          // The bicycle's **own** silhouette, which is a different object from
          // the one-colour solid the shading probe above uses — so the share of
          // it the cranks move is stated against the thing that actually moved.
          riderPixels = shadingAcross(atTopOfTheStroke, withNoRider).pixels;
        }
        view.render(cranksAt(0));
        view.render(cranksAt(0));
        const theSameAgain = wholeFrame();
        // ⚠️ **A quarter turn, not a half.** Half a turn swaps the two crank
        // arms, and a crankset is very nearly symmetric under that — the
        // strongest-looking angle is the one that changes the least.
        view.render(cranksAt(Math.PI / 2));
        const aQuarterTurnOn = wholeFrame();
        if (
          atTopOfTheStroke !== undefined &&
          theSameAgain !== undefined &&
          aQuarterTurnOn !== undefined
        ) {
          crankStillPixels = shadingAcross(theSameAgain, atTopOfTheStroke).pixels;
          crankTurnPixels = shadingAcross(aQuarterTurnOn, atTopOfTheStroke).pixels;
        }

        // ------------- the legs come with the rider — #366–#368's review
        //
        // ⚠️ **The defect this measures is invisible to every probe above**,
        // and that is the point: each of them holds the rider's position fixed
        // and varies the crank angle, which is exactly the half a pose cache
        // keyed on the angle gets right. A rider who is *moving and not
        // pedalling* — every frame of every power-only ride — is what leaves
        // world-space leg matrices behind.
        //
        // The two reads below are **the same rider in the same place at the
        // same angle**, reached two ways: once by moving there without the
        // angle changing, and once by arriving at an angle that then changes
        // back, which no cache can serve. A renderer that carries its legs
        // draws the identical frame; one that does not draws a pair of legs a
        // metre to one side.
        const HELD_ANGLE = 1.1;
        /** Across the road rather than along it: same depth, most pixels. */
        const movedAcross = (across: number, angle: number): SceneFrame => ({
          ...riderOnly,
          markers: riderOnly.markers.map((marker) => ({
            ...marker,
            x: marker.x + marker.headingZ * across,
            z: marker.z - marker.headingX * across,
            crankAngle: angle,
          })),
        });
        view.render(movedAcross(0, HELD_ANGLE));
        const beforeTheMove = wholeFrame();
        view.render(movedAcross(RIDER_MOVE_METRES, HELD_ANGLE));
        const movedWithoutPedalling = wholeFrame();
        view.render(movedAcross(RIDER_MOVE_METRES, HELD_ANGLE + 0.4));
        view.render(movedAcross(RIDER_MOVE_METRES, HELD_ANGLE));
        const posedWhereItStands = wholeFrame();
        if (
          beforeTheMove !== undefined &&
          movedWithoutPedalling !== undefined &&
          posedWhereItStands !== undefined
        ) {
          // The control: the rider really did move, so the zero below is a
          // renderer that followed rather than a probe that changed nothing.
          riderMovePixels = shadingAcross(movedWithoutPedalling, beforeTheMove).pixels;
          riderLeftBehindPixels = shadingAcross(movedWithoutPedalling, posedWhereItStands).pixels;
        }

        // ⚠️ **Warmed with a whole discarded sweep at each shading, not one
        // frame.** three compiles a program the first time it draws a
        // material, and the flat one has just been drawn for the first time —
        // but a compile is not the only thing that settles: the first timed
        // sweep of a run came out about a third of a millisecond a frame above
        // every later one whichever shading it was, and that is a warm-up, not
        // a cost. Throwing one away at each shading is what makes the rounds
        // below comparable to each other.
        phaseEnds('default: light and pedalling');
        // Read off `?shadow-map` alone — @see SHADOW_MAP_LOAD
        if (SHADOW_MAP_LOAD) {
          for (const settings of [lit, flat]) {
            view.setQuality(settings);
            void timeFrames(view, frameAt, gl);
          }

          const litRounds: number[] = [];
          const flatRounds: number[] = [];
          for (let round = 0; round < SHADING_ROUNDS; round += 1) {
            // ⚠️ **Which shading goes first alternates**, and that is a defect
            // found by reading the numbers rather than a precaution. With `flat`
            // always first it came out consistently *faster* to light the scene
            // — about 0.3 ms a frame, across every run — because whatever the
            // machine does at the start of a round was charged to whichever
            // sweep opened it, every time. Averaging two orders charges it to
            // both, and the sign stopped being stable, which is the honest
            // answer for a difference this far inside the noise.
            const flatFirst = round % 2 === 0;
            for (const shading of flatFirst ? ([flat, lit] as const) : ([lit, flat] as const)) {
              view.setQuality(shading);
              const each = timeFrames(view, frameAt, gl);
              (shading === lit ? litRounds : flatRounds).push(each);
            }
          }
          const mean = (values: readonly number[]) =>
            values.reduce((total, each) => total + each, 0) / values.length;
          const range = (values: readonly number[]) => Math.max(...values) - Math.min(...values);
          litFrameMs = mean(litRounds);
          flatFrameMs = mean(flatRounds);
          // The widest disagreement between two measurements of the *same*
          // shading — see `frameMsNoise`. The larger of the two groups, because
          // the question is how much this measurement moves on its own.
          frameMsNoise = Math.max(range(litRounds), range(flatRounds));
          phaseEnds('default: shading timing');
        }

        view.destroy();
      });
    });
  } catch (error: unknown) {
    errors.push(error instanceof Error ? error.message : String(error));
  }

  // ------------------------------------------------ the models — #341
  //
  // ⚠️ **Outside the block above, and on its own canvas, because it has to
  // `await`.** The counters up there are prototype patches held for the length
  // of a synchronous body; suspending inside one would leave every other
  // script on the page counted into it. And the second half of the comparison
  // needs the models *cleared*, which is asynchronous by the same signature
  // the loading is.
  try {
    // Read off the plain page alone — @see SHADOW_MAP_LOAD
    if (probeFrame !== null && !SHADOW_MAP_LOAD) {
      const frame: SceneFrame = probeFrame;
      for (const item of frame.scatter) {
        sceneryInstances[item.kind] = (sceneryInstances[item.kind] ?? 0) + 1;
      }
      sceneryIndicesModelled = sceneryIndicesByKind(frame);
      // The control. Clearing the models is what a kind whose file could not be
      // read gets, so this measures the world as it stood before #341 — in the
      // same browser, on the same frame, through the same view.
      await loadSceneryModels(() => Promise.reject(new Error('cleared for the control')));
      sceneryIndicesPlain = sceneryIndicesByKind(frame);
      phaseEnds('default: models');
      await loadSceneryModels();
    }
  } catch (error: unknown) {
    errors.push(error instanceof Error ? error.message : String(error));
  }

  // -------------------------------------------- the variants — #367
  //
  // Outside the synchronous block for the reason the one above it is: the
  // counters there are prototype patches held for a synchronous body, and this
  // needs its own view and its own frames.
  try {
    if (variantFrame !== null && !SHADOW_MAP_LOAD) {
      variantIndices = variantIndicesByKind(variantFrame);
      sceneryCallsByVariants = sceneryCallsAcrossRungs(variantFrame);
      phaseEnds('default: variants');
    }
  } catch (error: unknown) {
    errors.push(error instanceof Error ? error.message : String(error));
  }

  // ---------------------------- the colours and the riders — #366, #368
  try {
    // #426's shadow map: read off `?shadow-map` alone — @see SHADOW_MAP_LOAD
    if (probeFrame !== null && SHADOW_MAP_LOAD) {
      shadowMap = shadowMapProbe(probeFrame);
      phaseEnds('default: shadow map');
    }
    // Everything else in this block is read off the plain page alone.
    if (probeFrame !== null && !SHADOW_MAP_LOAD) {
      const found = colourProbes(probeFrame);
      texturesCreated = found.texturesCreated;
      texturesBaseline = found.texturesBaseline;
      treeRedPixels = found.treeRed;
      treeGreenPixels = found.treeGreen;
      buildingGreenPixels = found.buildingGreen;
      buildingBluePixels = found.buildingBlue;
      for (const [kind, each] of Object.entries(found.riders)) {
        riderMeanColour[kind] = each.mean;
        riderSilhouettePixels[kind] = each.pixels;
      }
      botCrankPixels = found.botCrankPixels;
      riderBuriedPixels = found.riderBuriedPixels;
      contactShadowPixels = found.contactShadowPixels;
      contactShadowLuminance = found.contactShadowLuminance;
      contactShadowNoise = found.contactShadowNoise;
      phaseEnds('default: colours');
    }
    if (!SHADOW_MAP_LOAD) {
      // #458, on a canvas of its own. @see gradientProbe
      gradient = gradientProbe();
      phaseEnds('default: gradient');
      // #459. @see waterProbe
      water = waterProbe();
      phaseEnds('default: water');
      // #460. @see settlementProbe
      settlement = settlementProbe();
      phaseEnds('default: settlement');
      // #424, on canvases of their own — @see riderExtent. 16 : 9 is the
      // criterion's own frame; 10 : 16 is a tablet held upright.
      riderFrame = { landscape: riderExtent(640, 360), portrait: riderExtent(400, 640) };
      phaseEnds('default: rider extent');
      // #499, on a canvas of its own. @see lineProbe
      line = lineProbe(640, 360);
      phaseEnds('default: line');
      // #583, on a canvas of its own. @see bendProbe
      bend = bendProbe(640, 360);
      phaseEnds('default: bend');
    }
  } catch (error: unknown) {
    errors.push(error instanceof Error ? error.message : String(error));
  }

  // #390, on a canvas of its own and outside the block above, because it has
  // to `await` a camera. Only on the load that already times rungs.
  try {
    if (probeFrame !== null && SHADOW_MAP_LOAD) {
      presenceCost = await presenceCostProbe(probeFrame);
      phaseEnds('default: presence cost');
    }
  } catch (error: unknown) {
    errors.push(error instanceof Error ? error.message : String(error));
  }

  // #547, on canvases of its own, and awaited for the same reason: `prepare`
  // is. Only on the load that already measures the shadow map.
  try {
    if (SHADOW_MAP_LOAD) {
      rideStart = await rideStartProbe();
      phaseEnds('default: ride start');
    }
  } catch (error: unknown) {
    errors.push(error instanceof Error ? error.message : String(error));
  }

  phaseEnds('default run');
  window.__oylGameHarness = {
    created,
    hasContext,
    framesDrawn,
    quadCount,
    vertexCount,
    indexCount,
    highestIndex,
    drawCallsPerFrame,
    markerKinds,
    world,
    skyPixel,
    groundPixel,
    roadPixel,
    roadFarPixel,
    roadProbeRows,
    riderFrame,
    line,
    bend,
    resourcesAfterFirstFrame,
    resourcesAfterAllFrames,
    resourcesAfterSecondSweep,
    centreLinePixel,
    roadBesidePixel,
    centreLineRowFraction,
    roadOnDescentPixel,
    scatterItemCount,
    scatterKindCount,
    drawCallsWithScatter,
    drawCallsWithoutScatter,
    sceneryPixelsChanged,
    sceneryPixelWith,
    sceneryPixelWithout,
    sceneryColumnFraction,
    sceneryRowFraction,
    crankTurnPixels,
    crankStillPixels,
    riderPixels,
    riderLeftBehindPixels,
    riderMovePixels,
    litMarkerPixels,
    flatMarkerPixels,
    litMarkerSpread,
    flatMarkerSpread,
    litMarkerBrightest,
    litMarkerDarkest,
    litFrameMs,
    flatFrameMs,
    shadedFrames: SHADING_FRAMES,
    frameMsNoise,
    litDrawCalls,
    flatDrawCalls,
    sceneryIndicesModelled,
    sceneryIndicesPlain,
    sceneryInstances,
    texturesCreated,
    texturesBaseline,
    treeRedPixels,
    treeGreenPixels,
    buildingGreenPixels,
    buildingBluePixels,
    sceneryCallsByVariants,
    variantIndices,
    riderMeanColour,
    riderSilhouettePixels,
    riderBuriedPixels,
    gradient,
    water,
    settlement,
    nearField: NO_NEAR_FIELD,
    botCrankPixels,
    contactShadowPixels,
    contactShadowLuminance,
    contactShadowNoise,
    shadowMap,
    presenceCost,
    rideStart,
    realistic: NO_REALISTIC,
    trees: NO_TREES,
    errors,
  };
}

void run();
