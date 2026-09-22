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
  routeProfile,
  type RoutePoint,
} from '@onyourleft/domain';

import { cameraRig, verticalHalfTangent } from '../src/game/camera';
import type { CameraPose, SceneFrame } from '../src/game/port';
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
  hillRoute,
  northRoute,
  valleyRoute,
} from '../src/game/route-fixtures-testing';
import { GRADIENT_TINT_FULL_SCALE_PERCENT } from '../src/game/terrain';
import { structuresAt } from '../src/game/settlements';
import { waterways } from '../src/game/waterways';
import { VERGE_DROP_METRES } from '../src/game/landform';
import {
  drawnWorldOf,
  loadRealisticWorld,
  loadSceneryModels,
  sceneMaterialsOf,
  sceneryDrawnOf,
  threeGameRenderer,
  waterSkyOf,
} from '../src/game/three-renderer';
import { realisticWorldNotice } from '../src/game/realistic-assets';
import {
  scatterSeed,
  STRUCTURE_KINDS,
  SCENERY_KINDS,
  SCATTER_VARIANT_SLOTS,
  type ScatterItem,
  type SceneryKind,
} from '../src/game/scatter';
import { atStartLine } from '../src/game/simulation';

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

/** One read-back pixel, as four bytes. */
type Pixel = readonly [number, number, number, number];

/** The box the rider's own pixels fill, as fractions of the frame from the top left. */
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
       * scale, so timing rung 0 against rung 3 would be measuring two things
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
       * than whatever one stretch of the harness route happened to place. The
       * three entries are rungs 3, 2 and 1.
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
      };
      /** The realistic world — ADR 0026. Measured only by `?realistic`. @see realisticProbe */
      readonly realistic: RealisticMeasurement;
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
    };
    view.destroy();
  });
  return measured;
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
};

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
 * The right vector is `(headingZ, −headingX)` because the camera has no roll,
 * which is `three-renderer.test.ts` §`asTheCameraSeesIt`'s argument.
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
  const right = { x: pose.headingZ, z: -pose.headingX };
  // up = forward × right, for a camera with no roll. ⚠️ The other order is
  // DOWN, and the first version of this had it: the far road probe landed
  // below the near one and `game.browser.spec.ts` §"takes its distant probe
  // further up the ROAD" is what said so.
  const up = {
    x: right.z * forward.y,
    y: right.x * forward.z - right.z * forward.x,
    z: -right.x * forward.y,
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
  const x = pose.x + ahead * pose.headingX + across * pose.headingZ;
  const z = pose.z + ahead * pose.headingZ - across * pose.headingX;
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
 * Where the road's near lane is probed: 20 m up the road, 1.5 m right of the
 * centre line.
 *
 * 20 m, because `camera.ts` §`roadAppearsOverRiderMetres` puts everything
 * nearer than 14 m directly behind the rider's back. 1.5 m, because that is
 * clear of a 0.15 m centre-line mark, of the rider — whose 0.2 m half-width
 * shadows ±0.9 m of road at this depth — and of the edge line 3.3 m out.
 */
const NEAR_ROAD_PROBE = { ahead: 20, across: 1.5 } as const;

/**
 * The same lane, 150 m up the road: the only difference between the two
 * read-backs is how far each has converged on the horizon. Past the bot, which
 * `frameAt` puts 120 m ahead on the centre line and which is 1.2 m clear of
 * this ray at its own depth.
 */
const FAR_ROAD_PROBE = { ahead: 150, across: 1.5 } as const;

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
  fromRow: number,
  toRow: number,
): { readonly centre: Pixel; readonly beside: Pixel; readonly row: number } {
  const column = Math.floor(width / 2);
  const beside = column + Math.max(2, Math.round(width * BESIDE_FRACTION));
  let best: { centre: Pixel; beside: Pixel; row: number; apart: number } = {
    centre: NOWHERE,
    beside: NOWHERE,
    row: 0,
    apart: -1,
  };
  for (let row = Math.floor(fromRow); row <= Math.floor(toRow); row += 1) {
    const onLine = readPixel(gl, column, row);
    const onRoad = readPixel(gl, beside, row);
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

/** What the `?realistic` run measures — ADR 0026. @see realisticProbe */
export interface RealisticMeasurement {
  readonly measured: boolean;
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
  readonly levelClimbLuminance: number;
  readonly levelDescentLuminance: number;
  /** Pixels that changed when the rider's cranks turned, and when the cadence went and they were held. */
  readonly crankTurnPixels: number;
  readonly crankHeldPixels: number;
  /** How far the realistic frame differs from the stylised one across the whole picture, as a share. */
  readonly worldChangedShare: number;
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
  readonly afterStepDownStandard: number;
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
}

const NO_REALISTIC: RealisticMeasurement = {
  measured: false,
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
  levelClimbLuminance: 0,
  levelDescentLuminance: 0,
  crankTurnPixels: 0,
  crankHeldPixels: 0,
  worldChangedShare: 0,
  sceneryProbeBudget: 0,
  sceneryDrawnTop: 0,
  sceneryDrawnBudgeted: 0,
  afterStepDownWorld: '',
  afterStepDownStandard: 0,
  realisticFrameMs: 0,
  stylisedFrameMs: 0,
  waterSkyRealistic: [],
  waterSkyStylised: [],
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

/** How many pixels two read-backs of the same size disagree about. */
function pixelsChanged(a: Uint8Array, b: Uint8Array): number {
  let changed = 0;
  for (let at = 0; at < a.length; at += 4) {
    if (a[at] !== b[at] || a[at + 1] !== b[at + 1] || a[at + 2] !== b[at + 2]) changed += 1;
  }
  return changed;
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

  const started = performance.now();
  const outcome = await loadRealisticWorld();
  const loadMs = performance.now() - started;

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
  const wooded = riding(valleyRoute(), 900);

  let texturesCreated = 0;
  countingTextures((textures) => {
    view.render(wooded);
    texturesCreated = textures();
  });
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

  const roadLuminance = (frame: SceneFrame): number => {
    const bare: SceneFrame = { ...frame, markers: [], scatter: [] };
    view.render(bare);
    view.render(bare);
    return meanLuminanceAround(gl, pixelFor(bare, canvas, onTheRoad(bare, 20, 1.5)), 3);
  };
  const climbLuminance = roadLuminance(riding(climb, 400));
  const descentLuminance = roadLuminance(riding(descent, 400));
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

  const frameAt = (distance: number, build: FrameBuild): SceneFrame =>
    riding(valleyRoute(), 800 + distance, build);
  const realisticFrameMs = timeFrames(view, frameAt, gl);
  const stylisedFrameMs = timeFrames(plain, frameAt, plainGl);
  // #475: each view's last frame was its own world's. @see waterSkyOf
  const waterSkyRealistic = waterSkyOf(view);
  const waterSkyStylised = waterSkyOf(plain);
  plain.destroy();

  // D-3's step down: the stylised ladder's top, whole.
  view.setQuality(QUALITY_LADDER[0] as QualitySettings);
  view.render(wooded);
  const afterStepDownWorld = drawnWorldOf(view);
  const afterStepDownStandard = sceneMaterialsOf(view).filter(
    (each) => each.visible && each.type === 'MeshStandardMaterial',
  ).length;
  view.destroy();

  console.log(
    `realistic: loaded in ${loadMs.toFixed(0)} ms; a frame ${realisticFrameMs.toFixed(1)} ms against ` +
      `${stylisedFrameMs.toFixed(1)} ms stylised (SwiftShader); ${String(drawCalls)} draw calls; ` +
      `${String(texturesCreated)} textures; road ${climbLuminance.toFixed(4)} climbing, ` +
      `${descentLuminance.toFixed(4)} descending`,
  );

  return {
    measured: true,
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
    levelClimbLuminance,
    levelDescentLuminance,
    crankTurnPixels: pixelsChanged(atRest, turned),
    crankHeldPixels: pixelsChanged(turned, held),
    worldChangedShare,
    sceneryProbeBudget: REALISTIC_PROBE_BUDGET,
    sceneryDrawnTop,
    sceneryDrawnBudgeted,
    afterStepDownWorld,
    afterStepDownStandard,
    realisticFrameMs,
    stylisedFrameMs,
    waterSkyRealistic,
    waterSkyStylised,
  };
}

/**
 * Every measurement at its "nothing was measured" value — what a run that
 * could not measure publishes, and what the `?realistic` run publishes beside
 * the one measurement it takes.
 */
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
    botCrankPixels: 0,
    contactShadowPixels: {},
    contactShadowLuminance: {},
    contactShadowNoise: 0,
    shadowMap: NO_SHADOW_MAP,
    realistic: NO_REALISTIC,
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
  // ADR 0026. A run of its own, so the default run fetches none of the
  // realistic set — which `game.browser.spec.ts` asserts off the requests it
  // makes — and so the realistic world's load is paid by one page load only.
  if (new URLSearchParams(location.search).has('realistic')) {
    try {
      window.__oylGameHarness = { ...emptyHarness(errors), realistic: await realisticProbe() };
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
            pixelFor(frame, canvas, onTheRoad(frame, CENTRE_LINE_STRETCH.fromAhead, 0)).y,
            pixelFor(frame, canvas, onTheRoad(frame, CENTRE_LINE_STRETCH.toAhead, 0)).y,
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

        // ⚠️ **The same hundred frames again**, and the frames of this second
        // pass are deliberately not counted into {@link framesDrawn}. @see
        // {@link resourcesAfterSecondSweep} for what the pair of counts is for.
        void sweep(view, frameAt);
        view.render(frame);
        view.render(withoutScenery);
        view.render(frameAt(ON_THE_DESCENT_METRES));
        resourcesAfterSecondSweep = resources();

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
    if (probeFrame !== null) {
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
    if (variantFrame !== null) {
      variantIndices = variantIndicesByKind(variantFrame);
      sceneryCallsByVariants = sceneryCallsAcrossRungs(variantFrame);
    }
  } catch (error: unknown) {
    errors.push(error instanceof Error ? error.message : String(error));
  }

  // ---------------------------- the colours and the riders — #366, #368
  try {
    if (probeFrame !== null) {
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
      if (new URLSearchParams(location.search).has('shadow-map')) {
        shadowMap = shadowMapProbe(probeFrame);
      }
    }
    // #458, on a canvas of its own. @see gradientProbe
    gradient = gradientProbe();
    // #459. @see waterProbe
    water = waterProbe();
    // #460. @see settlementProbe
    settlement = settlementProbe();
    // #424, on canvases of their own — @see riderExtent. 16 : 9 is the
    // criterion's own frame; 10 : 16 is a tablet held upright.
    riderFrame = { landscape: riderExtent(640, 360), portrait: riderExtent(400, 640) };
  } catch (error: unknown) {
    errors.push(error instanceof Error ? error.message : String(error));
  }

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
    botCrankPixels,
    contactShadowPixels,
    contactShadowLuminance,
    contactShadowNoise,
    shadowMap,
    realistic: NO_REALISTIC,
    errors,
  };
}

void run();
