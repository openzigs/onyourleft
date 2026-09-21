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

import { sceneFrame } from '../src/game/scene';
import { corridorOrigin } from '../src/game/terrain';
import { qualitySettings, RIDER_SHADOW_MAP_RUNG, type QualitySettings } from '../src/game/quality';
import { loadSceneryModels, threeGameRenderer } from '../src/game/three-renderer';
import {
  SCATTER_KINDS,
  SCATTER_VARIANT_SLOTS,
  type ScatterItem,
  type ScatterKind,
} from '../src/game/scatter';
import { atStartLine } from '../src/game/simulation';

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
       * `?shadow-map`: every other spec case reloads this page, and a
       * measurement nobody asserts on should not cost all of them its frames.
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
    const only = (kind: ScatterKind | null): SceneFrame => ({
      ...frame,
      markers: [],
      scatter: kind === null ? [] : frame.scatter.filter((item) => item.kind === kind),
    });
    const drawnBy = (kind: ScatterKind | null): number => {
      view.render(only(kind));
      const before = indices();
      view.render(only(kind));
      return indices() - before;
    };
    const road = drawnBy(null);
    for (const kind of SCATTER_KINDS) {
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
  kind: ScatterKind,
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
    const only = (kind: ScatterKind | null, variant: number): SceneFrame => ({
      ...frame,
      markers: [],
      scatter:
        kind === null
          ? []
          : frame.scatter.filter((item) => item.kind === kind && item.variant === variant),
    });
    const drawnBy = (kind: ScatterKind | null, variant: number): number => {
      view.render(only(kind, variant));
      const before = indices();
      view.render(only(kind, variant));
      return indices() - before;
    };
    const road = drawnBy(null, 0);
    for (const kind of SCATTER_KINDS) {
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
    const closeUp = (kind: ScatterKind): SceneFrame => ({
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
    const alone = (kind: 'rider' | 'bot' | 'ghost', at: number): SceneFrame => ({
      ...probe,
      scatter: [],
      markers: [
        {
          kind,
          x: pose.x + 8 * pose.headingX,
          y: pose.y,
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
    // ⚠️ **At the road's own height 8 m up it**, where `alone` above uses the
    // camera pose's: the harness route climbs at 5 %, so `alone`'s rider stands
    // 0.4 m under the tarmac — invisible to a colour mean, and fatal to a blob
    // that is depth-tested against that tarmac. The first version of this probe
    // read 0 px for all three for exactly that reason.
    const onTarmac = onTheRoad(probe, 8, 0);
    const grounded = (kind: 'rider' | 'bot' | 'ghost'): SceneFrame => {
      const frame = alone(kind, 0);
      return { ...frame, markers: frame.markers.map((each) => ({ ...each, y: onTarmac.y })) };
    };
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
  const frameAt = (distance: number) =>
    sceneFrame({
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
 * Two seconds of riding at the 30 fps `QUALITY_LADDER` targets, which is long
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
  frameAt: (at: number) => SceneFrame,
  gl: WebGL2RenderingContext | WebGLRenderingContext | null,
): number {
  const started = performance.now();
  for (let index = 1; index <= SHADING_FRAMES; index += 1) {
    view.render(frameAt(index * SWEEP_STEP_METRES));
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

async function run(): Promise<void> {
  const canvas = document.querySelector<HTMLCanvasElement>('#world');
  const errors: string[] = [];
  // ⚠️ **Before anything is created, because `GameRenderer.create` is
  // synchronous** — `port.ts` fixes that, and `main.tsx` awaits this in exactly
  // the same place and for exactly the same reason. A harness that skipped it
  // would draw the primitive world and every assertion below would pass.
  await loadSceneryModels();
  if (canvas === null) {
    window.__oylGameHarness = {
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
      botCrankPixels: 0,
      contactShadowPixels: {},
      contactShadowLuminance: {},
      contactShadowNoise: 0,
      shadowMap: NO_SHADOW_MAP,
      errors: ['no canvas'],
    };
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
    const frameAt = (distance: number) =>
      sceneFrame({
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
          scatter: SCATTER_KINDS.map((kind, at) => placedAhead(pose, kind, 0, 40 + at * 15, 8)),
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
          scatter: SCATTER_KINDS.flatMap((kind, at) =>
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
          const ground = pixelFor(frame, canvas, {
            ...onTheRoad(frame, GROUND_PROBE.ahead, GROUND_PROBE.across),
            // The ground is a flat plane at the RIDER's height, not the road's.
            y: frame.camera.y - 0.25,
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
        // `shading` overridden.** `qualitySettings(3)` is the rung that turns
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
      contactShadowPixels = found.contactShadowPixels;
      contactShadowLuminance = found.contactShadowLuminance;
      contactShadowNoise = found.contactShadowNoise;
      if (new URLSearchParams(location.search).has('shadow-map')) {
        shadowMap = shadowMapProbe(probeFrame);
      }
    }
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
    botCrankPixels,
    contactShadowPixels,
    contactShadowLuminance,
    contactShadowNoise,
    shadowMap,
    errors,
  };
}

void run();
