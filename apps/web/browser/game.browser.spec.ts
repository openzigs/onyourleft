// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The renderer, in a real browser with a real GL context.
 *
 * The second spec in the browser gate, and it exists for the same reason as the
 * first: **jsdom implements no WebGL**, so `game/three-renderer.ts` cannot be
 * constructed in the Vitest suite at all. Everything about the game that *is*
 * arithmetic — the fixed-tick simulation, the corridor geometry, the quality
 * ladder, the marker placement, the whole HUD — is asserted in jsdom, and what
 * is left here is only what genuinely needs a context.
 *
 * ⚠️ **This is the only automated check that #91's renderer works at all.**
 * ADR 0008 D-2's spike — 30 fps sustained for 20 minutes on floor hardware in a
 * Capacitor WebView with live BLE — is not this, cannot be run in CI, and was
 * **waived rather than passed** for this branch (see the 2026-09-08 amendment on
 * ADR 0008). What this spec establishes is much narrower and is worth stating
 * exactly: the renderer constructs, the geometry is one a driver accepts, and a
 * frame reaches the drawing buffer. It says nothing about frame *rate*, nothing
 * about thermal behaviour, and nothing about how any of it behaves on a phone.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { test as base, devices, expect } from '@playwright/test';

import { HARNESS_ORIGIN } from '../playwright.config';
import { MINIMUM_RIDER_FRAME_SHARE, riderFrameBox } from '../src/game/camera';

import type {
  BendMeasurement,
  LineMeasurement,
  NearFieldMeasurement,
  PresenceCostMeasurement,
  RideStartMeasurement,
  HorizonReading,
  RealisticMeasurement,
  RiderExtent,
  TreeHandOver,
  TreeLevelMeasurement,
  WaterBand,
} from './game-harness';
import { FRESNEL_CONTROL, FRESNEL_REFERENCE, WATER_BAND_ROWS } from './realistic-surfaces-fixture';
import { MINIMUM_TINT_CONTRAST_RATIO } from '../src/game/terrain';
import { type InstanceTint, NO_TINT, tintedLinear } from '../src/game/instance-tint';
import { GROUND_BLOB_DARKNESS } from '../src/game/ground-blob';
import { REALISTIC_VALLEY_HAZE } from '../src/game/realistic-light';
import {
  PRESENCE_CHECK_MILLISECONDS,
  PRESENCE_GRID_COLUMNS,
  PRESENCE_GRID_ROWS,
} from '../src/camera/presence';
import {
  PHOTOGRAPHIC_STRUCTURE_SURFACES,
  REALISTIC_BICYCLE_MAP_NAMES,
  REALISTIC_RIDER_MAP_NAMES,
  REALISTIC_VEGETATION,
  REALISTIC_VEGETATION_KINDS,
} from '../src/game/realistic-assets';
import { modelFacts } from '../src/game/realistic-bytes-testing';
import { REALISTIC_WOODED_DRAW_CALLS } from '../src/game/realistic-budget';
import { WORN_ROAD_CONTRAST_FLOOR } from '../src/game/road-wear';

/**
 * Said beside every frame time this spec publishes — #473. Since #473 the
 * harness TIMES frames built as `GameView` builds them, lent and drawn at once
 * (`game-harness.ts` §`lentSceneFrame`); every figure published before it also
 * paid for a ~55 KB copy per frame the product never makes, so a figure from
 * before #473 is not comparable with one after it.
 */
const LENT_FRAMES_NOTE = 'frames built lent, as GameView builds them (no copy since #473)';

/** One read-back pixel, as four bytes. */
type Pixel = readonly [number, number, number, number];

/** What `game-harness.ts` publishes. Mirrored rather than imported — see below. */
interface GameHarnessResult {
  readonly created: boolean;
  readonly hasContext: boolean;
  readonly framesDrawn: number;
  readonly quadCount: number;
  readonly vertexCount: number;
  readonly indexCount: number;
  readonly highestIndex: number;
  readonly drawCallsPerFrame: number;
  readonly markerKinds: readonly string[];
  readonly world: {
    readonly skyColour: number;
    readonly groundColour: number;
    readonly horizonColour: number;
    readonly fogDensity: number;
    readonly sun: {
      readonly x: number;
      readonly y: number;
      readonly z: number;
      readonly ambient: number;
      readonly direct: number;
    };
  };
  readonly skyPixel: Pixel;
  readonly groundPixel: Pixel;
  readonly roadPixel: Pixel;
  readonly roadFarPixel: Pixel;
  readonly roadProbeRows: readonly [number, number];
  readonly riderFrame: { readonly landscape: RiderExtent; readonly portrait: RiderExtent };
  readonly line: {
    readonly on: LineMeasurement;
    readonly onUpright: LineMeasurement;
    readonly off: LineMeasurement;
    readonly straightOn: LineMeasurement;
    readonly straightOff: LineMeasurement;
  };
  readonly bend: { readonly right: BendMeasurement; readonly mirrored: BendMeasurement };
  readonly nearField: NearFieldMeasurement;
  readonly resourcesAfterFirstFrame: number;
  readonly resourcesAfterAllFrames: number;
  readonly resourcesAfterSecondSweep: number;
  readonly centreLinePixel: Pixel;
  readonly roadBesidePixel: Pixel;
  readonly centreLineRowFraction: number;
  readonly roadOnDescentPixel: Pixel;
  readonly scatterItemCount: number;
  readonly scatterKindCount: number;
  readonly drawCallsWithScatter: number;
  readonly drawCallsWithoutScatter: number;
  readonly sceneryPixelsChanged: number;
  readonly sceneryPixelWith: Pixel;
  readonly sceneryPixelWithout: Pixel;
  readonly sceneryColumnFraction: number;
  readonly sceneryRowFraction: number;
  readonly litMarkerPixels: number;
  readonly flatMarkerPixels: number;
  readonly litMarkerSpread: number;
  readonly flatMarkerSpread: number;
  readonly litMarkerBrightest: Pixel;
  readonly litMarkerDarkest: Pixel;
  /** How the rider's own pixels answer a quarter turn of the cranks — #349. */
  readonly crankTurnPixels: number;
  readonly crankStillPixels: number;
  readonly riderPixels: number;
  readonly riderLeftBehindPixels: number;
  readonly riderMovePixels: number;
  readonly litFrameMs: number;
  readonly flatFrameMs: number;
  readonly shadedFrames: number;
  readonly frameMsNoise: number;
  readonly litDrawCalls: number;
  readonly flatDrawCalls: number;
  readonly sceneryIndicesModelled: Readonly<Record<string, number>>;
  readonly sceneryIndicesPlain: Readonly<Record<string, number>>;
  readonly sceneryInstances: Readonly<Record<string, number>>;
  readonly texturesCreated: number;
  readonly texturesBaseline: number;
  readonly treeRedPixels: number;
  readonly treeGreenPixels: number;
  readonly buildingGreenPixels: number;
  readonly buildingBluePixels: number;
  readonly sceneryCallsByVariants: readonly number[];
  readonly variantIndices: Readonly<Record<string, readonly number[]>>;
  readonly riderMeanColour: Readonly<Record<string, Pixel>>;
  readonly riderSilhouettePixels: Readonly<Record<string, number>>;
  readonly riderBuriedPixels: number;
  readonly settlement: {
    readonly structures: number;
    readonly kinds: number;
    readonly pixels: number;
    readonly drawCalls: number;
    readonly drawCallsBare: number;
    readonly withMs: number;
    readonly withoutMs: number;
  };
  readonly water: {
    readonly crossings: number;
    readonly beside: Pixel;
    readonly besideDry: Pixel;
    readonly deck: Pixel;
    readonly deckDry: Pixel;
    readonly underDeck: Pixel;
    readonly drawCalls: number;
    readonly drawCallsDry: number;
    readonly shadedMs: number;
    readonly flatMs: number;
    readonly rippleBanding: number;
    readonly rippleBandingUnfiltered: number;
    readonly ripplePairs: number;
  };
  readonly gradient: {
    readonly skyHigh: Pixel;
    readonly skyLow: Pixel;
    readonly flatSkyHigh: Pixel;
    readonly flatSkyLow: Pixel;
    readonly roadSpreadDetailed: number;
    readonly roadSpreadPlain: number;
    readonly groundChangedByDetail: number;
    readonly lapChanged: number;
    readonly lapChangedUnwrapped: number;
    readonly horizonPixels: number;
    readonly climbBuried: number;
    readonly climbLifted: number;
    readonly descentBelow: number;
    readonly flatClimbBuried: number;
    readonly flatDescentBelow: number;
    readonly terrainVertices: number;
    readonly terrainIndices: number;
    readonly terrainIndicesByRung: readonly number[];
  };
  readonly botCrankPixels: number;
  readonly contactShadowPixels: Readonly<Record<string, number>>;
  readonly contactShadowLuminance: Readonly<Record<string, readonly [number, number]>>;
  readonly contactShadowNoise: number;
  readonly shadowMap: {
    readonly measured: boolean;
    readonly contactFrameMs: number;
    readonly mapFrameMs: number;
    readonly noiseMs: number;
    readonly contactDrawCalls: number;
    readonly mapDrawCalls: number;
    readonly shadowPixels: number;
    readonly ghostShadowPixels: number;
  };
  /** #390 — measured only by the `?shadow-map` load. */
  readonly presenceCost: PresenceCostMeasurement;
  /** #547 — measured only by the `?shadow-map` load. */
  readonly rideStart: RideStartMeasurement;
  /** ADR 0026 — measured only by the `?realistic` load. */
  readonly realistic: RealisticMeasurement;
  /** #617 — measured only by the `?realistic&trees` load (#644). */
  readonly trees: TreeLevelMeasurement;
  readonly errors: readonly string[];
}

/** The five kinds ADR 0022 D-3 gives a model, and the one it leaves alone. */
const MODELLED_KINDS = ['tree-broadleaf', 'tree-conifer', 'shrub', 'rock', 'building'] as const;
const PROCEDURAL_KIND = 'post';

/** How many frames the harness drives. Mirrors `FRAMES` in `game-harness.ts`. */
const FRAMES = 100;

/**
 * The most a lit frame may cost against an unlit one: **1.5×** — #286.
 *
 * ⚠️ **A ratio rather than a millisecond budget, so it survives the machine.**
 * Measured on the two this change was run on: **1.10** on the CI runner
 * (7.419 ms lit against 6.764 ms flat) and **0.99** on a developer's laptop
 * (3.333 against 3.372 — the shading is under that machine's noise floor
 * there). Both were taken with a same-shading run-to-run spread under 2 % of
 * the mean, so the bound has about four times the margin it needs against the
 * worse of the two, and roughly thirty times the noise.
 *
 * What it is for: a future change to the shading path — a second lamp, a
 * per-pixel material, a shadow map — that made the lit world half again as
 * expensive as the unlit one would be a decision somebody should take rather
 * than a line somebody adds, which is the same argument `three-seam.test.ts`
 * makes about the lamps themselves.
 *
 * ⚠️ It says nothing about the **device floor**. Both machines are desktops
 * with a software rasteriser; ADR 0008 D-2's gate is #247 and is outstanding.
 */
const SHADING_CEILING = 1.5;

/**
 * Whether a read-back pixel is the colour a scene that drew nothing leaves.
 *
 * ⚠️ **Colour only.** The renderer is built with `alpha: false`, so every pixel
 * in the drawing buffer reads alpha 255 whether anything was drawn or not —
 * including the alpha of the clear colour itself. A check that counted the
 * alpha channel would pass over a completely black frame, which is precisely
 * the frame this gate exists to catch.
 *
 * ⚠️ **And it is the weakest claim in this file, deliberately kept narrow.** A
 * read-back compared against a fixed colour stops meaning anything the moment
 * somebody changes that colour, and nothing tells them it has: #241 turned the
 * background from black into a route-derived sky and silently voided the one
 * assertion that said the road geometry reached the screen. Every other
 * assertion below is therefore *relative* — one pixel against another, or a
 * pixel against the `WorldStyle` the harness publishes — and the two tests
 * that still use this one are about the clear colour specifically.
 */
function isClearColour(pixel: Pixel): boolean {
  return pixel[0] === 0 && pixel[1] === 0 && pixel[2] === 0;
}

/** The red, green and blue of a packed `0xRRGGBB`, as three bytes. */
function channelsOf(packed: number): readonly [number, number, number] {
  return [(packed >> 16) & 255, (packed >> 8) & 255, packed & 255];
}

/** The three colour channels, by the name a failure should name. */
const CHANNELS = ['red', 'green', 'blue'] as const;

/**
 * How closely the rider the renderer DREW must agree with the rectangle
 * `camera.ts` §`riderFrameBox` says they are drawn into, as a fraction of the
 * frame: two points.
 *
 * It is not zero for three reasons, none of them slack: the read-back is
 * quantised to a row of pixels (0.3 % of a 360 px frame); the box is the
 * rider's bounding planes and the model is a helmet and two tyres, which are
 * round; and the rider's rear wheel is nearer the camera than the point they
 * are placed at, so it reaches a little lower in the frame than a box standing
 * at that point does.
 */
const RIDER_BOX_TOLERANCE = 0.02;

/**
 * How much cheaper than the control's first frame every prepared frame must be
 * — #547. **4**, where the pinned Chromium measured about 60 (≈ 9 ms against
 * ≈ 540 ms): wide enough that a busy runner does not flip it, and narrow enough
 * that a `prepare` which built the programs without the ride's first frame
 * staged — ≈ 600 ms left in the first frame, measured while it was written —
 * fails it, and so does one that does not wait for the GPU (≈ 560 ms). `game-harness.ts` §`rideStartProbe`.
 */
const RIDE_START_STALL_FACTOR = 4;

/**
 * What one frame of the harness route costs, with the scenery taken out: **9**.
 *
 * | | calls |
 * |---|--:|
 * | the ground beside the road, lit — a landform since #458 (was one flat quad) | 1 |
 * | the hills on the horizon (#458) | 1 |
 * | the sky's gradient (#425) | 1 |
 * | the road, however many marks and edge lines it carries (#242) | 1 |
 * | every rider's bicycle, instanced (#349, #368) | 1 |
 * | every rider's upper body, rolled against it about the hips (#546) | 1 |
 * | every rider's crankset, which turns on its own axis (#349, #368) | 1 |
 * | every rider's four leg segments, as one instanced mesh (#349, #368) | 1 |
 * | every rider's contact shadow, as one instanced transparent mesh (#426) | 1 |
 *
 * ⚠️ **5 → 6 with #426, deliberately, and this line is where it is published.**
 * The riders floated, and the blob under the rider and the pacer is ONE draw
 * however many of them there are — the frame here carries two and pays one
 * call, and a ghost would add none because it casts none. What was weighed
 * against it: a draw call is #240's NFR-2 budget, and this is the cheapest one
 * that grounds three objects; the alternative that draws the real shape — the
 * shadow map on `quality.ts` §`RIDER_SHADOW_MAP_RUNG` — costs a shadow pass of
 * all three rider meshes plus a catcher, and §"measures what the shading
 * costs" publishes its count and its frame time rather than bounding them.
 * ⚠️ The table said **6** above a sum of 5 between #368 and #426, because its
 * heading was never moved when #368 took a call away; it is right again now.
 *
 * ⚠️ **It was 4 before #349 and 6 between #349 and #368, and it is 5 now** —
 * which is the direction nobody expects a change that gives two more objects a
 * bicycle each to move a draw-call count in. #349 drew one bicycle in three
 * calls and left the bot a cone and the ghost an octahedron at one apiece;
 * #368 instances all three riders into the same three meshes, so the two
 * solids' calls are gone and no new ones arrive. The frame this is measured on
 * carries a rider and a bot; a ghost would add **no** call at all.
 *
 * Written out as a sum rather than as a literal so that a red run says which
 * term moved: the road splitting into three meshes and the riders growing a
 * fourth mesh are very different findings and a bare `5` cannot tell them
 * apart.
 *
 * ⚠️ **6 → 7 with #458, deliberately.** The flat quad was replaced by the
 * landform — one call for one call — and the hills on the horizon are the one
 * that is new: a ring of 48 quads, unfogged, drawn first. What it buys is that
 * the corridor's ground no longer ends in sky once it runs out, and that a
 * route has a skyline at all. §"the gradient shows beside the road" publishes
 * what the landform itself costs in vertices and indices.
 *
 * ⚠️ **7 → 8 with #425, deliberately**: the sky is a dome of vertex colours
 * where it was the scene's background colour, which costs a draw call and no
 * texture. The background is still set, underneath it.
 *
 * ⚠️ **8 → 9 with #546, deliberately — the riders' term is 4, not 3.** The
 * owner ruled on 2026-09-25 that a rider's body stays more upright than the
 * bicycle through a bend, with the combined lean still true to physics, and a
 * body merged into the bicycle's vertices can only roll with it. So the upper
 * body — arms, torso, helmet — is its own instanced mesh (`bicycle.ts`
 * §`RIDER_UPPER_BODY_PARTS`), rolled about the hips: one call for all three
 * riders, and a ghost still adds none.
 *
 * ⚠️ **Unchanged by #547, and no longer the frame a stylised ride STARTS on.**
 * It is measured at level 0, the contact rung, which is still what every ride
 * draws after its first step down and what the realistic world falls back to.
 * A stylised ride starts on `quality.ts` §`RIDER_SHADOW_MAP_RUNG` since #547,
 * and that frame is this one plus {@link SHADOW_MAP_EXTRA_DRAW_CALLS}.
 */
const SCENE_DRAW_CALLS = 1 + 1 + 1 + 1 + 4 + 1;

/**
 * What the shadow map rung draws beyond the contact rung — #426, and since
 * #547 the difference between a stylised ride's first frame and
 * {@link SCENE_DRAW_CALLS}:
 *
 * | | calls |
 * |---|--:|
 * | the contact shadows, which the map rung does not draw | −1 |
 * | the shadow catcher under the riders | +1 |
 * | the shadow pass: each of the four rider meshes into the map | +4 |
 *
 * Written as a sum for {@link SCENE_DRAW_CALLS}' reason. The riders' term is
 * that constant's riders' term: a fifth rider mesh costs a call twice.
 */
const SHADOW_MAP_EXTRA_DRAW_CALLS = -1 + 1 + 4;

/**
 * The most meshes the scenery belt may ever hold: **24**.
 *
 * | kind | shapes |
 * |---|--:|
 * | `tree-broadleaf`, `tree-conifer`, `shrub`, `rock` | 2 each |
 * | `building` | 3 |
 * | `post`, which ADR 0022 D-3 leaves procedural | 1 |
 * | `barn`, `church`, `shop-row`, `shed` — #460, #500, built from numbers | 2 each |
 * | `wall`, `hedge`, `fence`, `signpost` — #460, built from numbers | 1 each |
 *
 * ⚠️ **20 → 24 with #500, deliberately.** Each of the four buildings the
 * stylised world draws from numbers has two proportions now
 * (`buildings.ts` §`BUILDING_VARIANTS`), and a shape is a mesh. A mesh with no
 * instance this frame is not drawn, and the rungs below the top draw one
 * shape a kind (`QualitySettings.sceneryVariants`), so a village costs at most
 * four more calls at the top rung and none below it. What that costs on a
 * phone is the device run #500's last criterion asks for.
 *
 * ⚠️ **12 → 20 with #460, deliberately, and this is the line that says so.**
 * Four kinds of building and four of roadside structure, each one shape and
 * so one mesh and at most one draw call — a village and its walled fields for
 * eight calls however many houses and walls it has. No model was added: every
 * one of the eight is built in `three-renderer.ts` §`STRUCTURE_STYLE` from
 * numbers, so ADR 0022's one-author pack and `MAXIMUM_SCENERY_VARIANTS` are
 * untouched. What the calls cost on a phone is validation 0002 Part X, and a
 * frame of a village is timed in §"a village and its fields".
 *
 * ⚠️ **A ceiling rather than the count, and #367's sixth criterion asks for
 * exactly that**: *"a budget that says how many variants may exist at all, so
 * this cannot be grown later without meeting the same gate."* The gate is this
 * file — a thirteenth mesh is a red run here, and going green again means
 * re-measuring what the draw calls cost and publishing the number in
 * `docs/validation/0002-android-shell-and-game.md` Part M the way Part H
 * publishes the geometry cost.
 *
 * ⚠️ **It was 6 before #367**, one mesh a kind, which is what #244 spent.
 */
const SCATTER_MESH_CEILING = 4 * 2 + 3 + 1 + 4 * 2 + 4;

/**
 * One load of the harness page, and every request it made on the way.
 *
 * The request list is collected from before `goto` rather than after, because
 * a request made during the load is one that is over by the time a
 * `page.evaluate` could look.
 */
interface HarnessRun {
  readonly result: GameHarnessResult;
  readonly requested: readonly string[];
  /**
   * Every shader three could not compile or link on the load — #501. A GLSL
   * error is not an exception: three logs it, the mesh draws nothing, and
   * every other assertion here can stay green over a bridge that vanished.
   */
  readonly shaderErrors: readonly string[];
}

/**
 * The project's own device, as the options a context takes.
 *
 * ⚠️ A worker-scoped fixture cannot use the `page` fixture, so it opens its own
 * context — and a context opened with no options is NOT the one every other
 * case in this gate runs in. Spreading the same device the project names in
 * `playwright.config.ts` is what keeps the shared load's page the same page.
 */
const { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch } = devices['Desktop Chrome'];
const DESKTOP_CHROME = { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch };

/**
 * ⚠️ **The harness is loaded ONCE per query per worker, and every case reads
 * that one run — #456.** Until then every case in this file reloaded the page,
 * which is about nine seconds on a runner with no GPU: 43 cases were 6 to 7.3
 * minutes of the required job's wall clock and the whole of its critical path.
 *
 * It is safe for a reason that is a property of the harness rather than of
 * this file: `game-harness.ts` does ALL of its work in one `run()` and
 * publishes one object at the end of it, so the cases never drove the page —
 * each loaded it, waited for that object and asserted on a different field of
 * the serialised copy `page.evaluate` handed back, which nothing writes to.
 * What the cases share is that copy; every assertion on it is unchanged, and so
 * is every case's name, so a red run still names the claim that broke.
 *
 * ⚠️ **A red case costs a reload, and that was measured rather than assumed.**
 * Playwright replaces a worker after any failing case, and this memo lives in
 * the worker, so the case after a failure loads the page afresh: with the road
 * taken out of the scene nine cases went red and the file took 49 s rather
 * than 13. A green run pays four loads — the plain page, `?shadow-map`,
 * since ADR 0026 `?realistic`, which #607 pays for in a hook of its own
 * (§`paysForTheRealisticLoad`), and since #644 `?realistic&trees`, which the
 * same hook pays for — and nothing here retries a load that failed,
 * which is the flake-hiding `playwright.config.ts` refuses.
 */
const test = base.extend<object, { harnessRun: (query?: string) => Promise<HarnessRun> }>({
  harnessRun: [
    async ({ browser }, use, workerInfo) => {
      const runs = new Map<string, Promise<HarnessRun>>();
      const ledger = loadLedger(workerInfo.project.outputDir);
      const load = async (query: string): Promise<HarnessRun> => {
        ledger.begin(query);
        const context = await browser.newContext(DESKTOP_CHROME);
        try {
          const page = await context.newPage();
          const requested: string[] = [];
          page.on('request', (request) => requested.push(request.url()));
          const shaderErrors: string[] = [];
          page.on('console', (message) => {
            // #644: each phase as it ends, so a load its budget kills still
            // says in the CI log how far it got.
            if (message.text().startsWith('harness phase: ')) {
              console.log(`game.html${query} ${message.text()}`);
            }
            if (message.type() === 'error' && message.text().includes('THREE.WebGLProgram')) {
              shaderErrors.push(message.text().slice(0, 400));
            }
          });
          const loadStarted = Date.now();
          await page.goto(`${HARNESS_ORIGIN}/game.html${query}`);
          // The harness publishes at the end of `run()` and nowhere else, so
          // waiting on the property existing is waiting on the run having
          // finished — not on a timer. ⚠️ Since #341 that run is
          // **asynchronous**: it awaits the scenery models before it creates
          // anything, exactly as `main.tsx` does.
          await page.waitForFunction(() => window.__oylGameHarness !== undefined);
          const result = await page.evaluate(() => window.__oylGameHarness as GameHarnessResult);
          // #644: the phases are printed as they end (above); this is the total.
          console.log(
            `game.html${query}: loaded in ${String(Math.round((Date.now() - loadStarted) / 1000))} s`,
          );
          ledger.end(query);
          return { result, requested, shaderErrors };
        } catch (error) {
          ledger.fail(query, error);
          throw error;
        } finally {
          await context.close();
        }
      };
      await use((query = '') => {
        let run = runs.get(query);
        if (run === undefined) {
          run = load(query);
          runs.set(query, run);
        }
        return run;
      });
    },
    { scope: 'worker' },
  ],
});

/**
 * What one load of a query has come to in THIS run, across every worker — #651.
 *
 * ⚠️ **The memo above lives in a worker, and a worker does not outlive a
 * failure**, so without this a load that HUNG was paid for again by the next
 * case to ask: Playwright replaces the worker after a timeout, the new worker
 * has no memo, and it loads the page afresh under the next case's budget — and
 * so on down every case that reads that query. For `?realistic` that was
 * bounded by #607's hook to one budget a describe; for the plain page, which
 * about forty-five cases in sixteen describes read inside their own 60 s, it
 * was not bounded at all: forty-five minutes, in a job that stops at twenty.
 *
 * So each load is written down where every worker can read it — the run's
 * output directory, which Playwright empties when a run starts — and a load
 * that an EARLIER worker began and never finished is not begun again. The case
 * that asks fails at once, naming the case and describe that paid for it. What
 * is refused is a second attempt at the same hung load, which is a retry by
 * another name; a load that finished is loaded again as before, which is
 * #456's accepted cost of a red ASSERTION and is unchanged.
 *
 * A load another LIVE worker is still making is not a hang, and is not refused.
 * Today that cannot happen — only the `game` project runs this file (the
 * `chromium` project `testIgnore`s it, `playwright.config.ts` §`projects`), and
 * that project is one group in one worker — but a second worker reading a
 * query would be, and refusing it would be a false failure. Only a worker that
 * is gone — whose process no longer exists — left its load unfinished for good.
 *
 * ⚠️ **An entry is written to a temporary file and renamed over the old one**,
 * because `rename` within a directory is atomic and `writeFileSync` is not: a
 * worker killed mid-write — which is exactly when this ledger matters — would
 * otherwise leave a truncated entry, and the next hook would throw a
 * `SyntaxError` from `JSON.parse` instead of the message naming the describe.
 */
interface LoadLedger {
  begin(query: string): void;
  end(query: string): void;
  fail(query: string, error: unknown): void;
}

type LoadEntry =
  | { readonly state: 'loading'; readonly pid: number; readonly by: string }
  | { readonly state: 'loaded' }
  | { readonly state: 'failed'; readonly by: string; readonly reason: string };

function loadLedger(outputDir: string): LoadLedger {
  const directory = join(outputDir, 'game-harness-loads');
  mkdirSync(directory, { recursive: true });
  const entryPath = (query: string): string =>
    join(directory, `${encodeURIComponent(query === '' ? 'plain' : query)}.json`);
  const write = (query: string, entry: LoadEntry): void => {
    const temporary = `${entryPath(query)}.${process.pid}.tmp`;
    writeFileSync(temporary, JSON.stringify(entry));
    renameSync(temporary, entryPath(query));
  };
  const read = (query: string): LoadEntry | undefined =>
    existsSync(entryPath(query))
      ? (JSON.parse(readFileSync(entryPath(query), 'utf8')) as LoadEntry)
      : undefined;
  const asking = (): string => base.info().titlePath.slice(1).join(' › ');
  return {
    begin(query) {
      const earlier = read(query);
      const page = `game.html${query}`;
      if (earlier?.state === 'failed') {
        throw new Error(
          `${page} already failed to load in this run, for “${earlier.by}”: ${earlier.reason} ` +
            '— not loading it again (#651); that failure is the one to read.',
        );
      }
      if (earlier?.state === 'loading' && !processIsAlive(earlier.pid)) {
        throw new Error(
          `${page} was being loaded for “${earlier.by}” by a worker that did not survive it, ` +
            'so that load hung or crashed — not loading it again (#651); that failure, ' +
            'which names its describe, is the one to read.',
        );
      }
      write(query, { state: 'loading', pid: process.pid, by: asking() });
    },
    end(query) {
      write(query, { state: 'loaded' });
    },
    fail(query, error) {
      const reason = error instanceof Error ? error.message.split('\n')[0] : String(error);
      write(query, { state: 'failed', by: asking(), reason: reason ?? '' });
    },
  };
}

/** Whether a process exists — signal 0 checks without sending anything. */
function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: it exists and belongs to somebody else, which is still alive.
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** The shared run's result, which is all but one case in this file reads. */
async function harness(
  run: (query?: string) => Promise<HarnessRun>,
  query = '',
): Promise<GameHarnessResult> {
  return (await run(query)).result;
}

/**
 * What the `?realistic` load may take — #607. Two and a half times the 60 s a
 * case gets, because that load is the slowest thing in the gate by far: about
 * 31 MiB of textures and a prefiltered sky, then #545's sweep of the hairpin.
 * On CI it took 33 s, 36 s and 48 s on green runs and over 60 s on two red
 * ones — a spread, on the same commit, that is the runner rather than the code.
 *
 * ⚠️ **#644: #617 took that load past this budget, and the answer was to move
 * the cost rather than raise the number.** Timed phase by phase on the CI
 * runner (ubuntu-latest, run 36318760634, 2026-09-27, `95b4ab8` with the
 * budget lifted so the load could finish): **182 s**, of which #617's tree
 * probes were 117.7 s — the triangle counts 25.6, the hand-over 25.5, its
 * control 25.4 and the nearest tree 41.2 — and everything else 64 s. The
 * trees are a load of their own now (`?realistic&trees`, §`TREES_QUERY`),
 * paying for it in this same hook under this same budget, and cheaper: the
 * product's three measurements share one view, and the two that only count
 * draw calls draw a sixteenth of the pixels. The harness prints every phase
 * as it ends (`game-harness.ts` §`phaseEnds`), so the next load that outgrows
 * this says which phase grew.
 *
 * ⚠️ **It is 120 s since #651, not 150, and a reviewer who remembers 150 is
 * reading the old file.** #651's issue asked for exactly this — "if the sum
 * can't fit, lower the budgets" — and §`paysForTheRealisticLoad` is the sum.
 * On the slower of the two runners CI lands on (an AMD EPYC 7763) the load
 * took 64 s, 70 s and 77 s alone (runs 36320822283, 36334163962 and
 * 36337270885 — the last with #621's seeded-tint probe added — and 77 s again
 * on 36340917231), so 120 s is 1.56 times the slowest.
 *
 * ⚠️ **It is 165 s since #682, and a reviewer who remembers 120 is reading the
 * old file.** A day later the same load took 91 s to 111 s on that runner's
 * green `main` runs (thirteen read on 2026-09-28, 36370135206 to 36405580515;
 * 111 s on 36405580515) — 93 % of 120 s, a green run 9 s from red. No one
 * phase grew: #624's tread added 1.9 s and the rest is the runner's spread
 * (texture formats 21.4 s to 24.1 s, house window 11.7 s to 13.1 s). 165 s is
 * 1.49 times the slowest, and §`paysForTheRealisticLoad` is the sum it fits in.
 */
const REALISTIC_LOAD_BUDGET_MS = 165_000;
/**
 * `?realistic&trees` — 79 s to 80 s alone on the last three of #651's runs, so
 * 120 s was 1.5 times. ⚠️ **160 s since #682**: on 36405580515 it took 105 s,
 * 88 % of 120. #720 added a phase to it (`trees: unmerged control`, 11.7 s to
 * 16.1 s), and that run was slower than the one before it in every phase: the
 * load had been 82 s to 83 s on that runner before #720 and 86 s on the first
 * run after (36396660625). 160 s is 1.52 times 105.
 */
const TREES_LOAD_BUDGET_MS = 160_000;

/**
 * #627's figures for the ground's contrast (`game-harness.ts`
 * §`GroundBlendMeasurement`, a variance of relative luminance over a
 * square's mean): the least a bank of rock must differ from level grass
 * beside it, the most it may, and how much rock must have been drawn at all.
 */
const BLEND_MARGIN = 0.01;
const BLEND_CEILING = 1;
const BLEND_MINIMUM_ROCK_PIXELS = 200;
/**
 * How many times the grass's highest contrast the bank must read — **4** — and
 * how far the control may stray outside the grass's range, as a factor —
 * **1.5**. On a Mac on 2026-09-29 the bank read 0.096 against grass of 0.0017
 * to 0.0058, and 0.0081 with the rock off: 1.4 times the grass's highest,
 * which is the raking light on grass the level squares do not have.
 */
const BLEND_FACTOR = 4;
const BLEND_LIGHT_FACTOR = 1.5;

/**
 * #629: how much larger the grazing water's Fresnel term, read back, must be
 * than the near water's — **0.2** — and the most either may read: **1.05**, a
 * whole reflection and the read-back's own spread.
 */
const WATER_FRESNEL_MARGIN = 0.2;
const WATER_FRESNEL_CEILING = 1.05;

/**
 * #628: how much lighter a wheel track must read than its lane's middle, as a
 * share of relative luminance after the light and AgX — **0.01** — and the
 * most it may: **0.08**. `road-wear.ts` §`WHEEL_TRACK_LIGHTEN` asks for 0.05
 * of the diffuse colour and the wear's clamp allows 0.06; AgX and the track's
 * flatter relief bring that to about 0.025 read back (2.47 % on a Mac,
 * 2026-09-29), and the same two strips read −0.09 % with the wear off — the
 * control holds that under the floor.
 */
const WHEEL_TRACK_FLOOR = 0.01;
const WHEEL_TRACK_CEILING = 0.08;

/**
 * Pays for the `?realistic` load in a `beforeAll` with its own budget — #607.
 *
 * ⚠️ **It is the fail-fast as much as the budget, and the fail-fast is the
 * half that saves the job.** Until #607 the load ran inside the first case that
 * asked for it, under that case's 60 s. When it ran long that case went red,
 * Playwright replaced the worker, the memo above went with the worker, and the
 * NEXT realistic case loaded the page again under its own 60 s — and so on down
 * every case in the describe, about a minute each, until the job hit
 * `timeout-minutes: 20` and was cancelled (run 36275996016, `main`).
 *
 * A `beforeAll` that fails does not do that: Playwright marks the rest of its
 * describe "did not run" rather than trying each. Measured on Playwright 1.63.0
 * with a load longer than the case timeout: without the hook, four cases red at
 * a timeout each; with it and a budget shorter than the load, one failure and
 * three "did not run"; with a budget longer than the load, all four green. A
 * case that fails an ASSERTION still costs one reload — in the new worker's copy
 * of this hook, under this budget rather than a case's — which is #456's
 * accepted cost, no worse.
 *
 * Every case still asks `harnessRun('?realistic')` for its result; this only
 * decides when the load is paid for and what it may take. No retry: the load
 * runs once per worker, exactly as before, and `playwright.config.ts` refuses
 * retries on purpose.
 *
 * ⚠️ **This paragraph said "loads that never finish cost at most three budgets
 * — seven and a half minutes, inside the job's twenty", and it was false
 * (#651).** It counted the budgets and not the job: the rest of the job took
 * 16m42s by then, so three hung budgets on top came to about 21.8 minutes and
 * the runner would have cancelled the job — reporting nothing — before the
 * third one said which describe it was. And it left out the plain page, whose
 * load no hook paid for: a hung one cost 60 s a case, down forty-five cases.
 *
 * ⚠️ **The figures below are #682's, and a reviewer who remembers 355 s of
 * budgets, 179 s of the rest of the gate and 42 s inside `timeout-minutes: 20`
 * is reading the old file** — by 2026-09-28 green loads sat at up to 93 % of
 * their budgets, and a green gate took 547 s of its 580 (36405580515). #682
 * raised the job's stop to 25 minutes and spent part of it here.
 *
 * What a hang costs now, and why it fits. The ledger (§`loadLedger`) makes a
 * hung load cost ONE budget per query per run, whichever describe paid it,
 * and every other describe that reads that query fails at once in its own hook
 * (§`paysForTheLoad`). The game spec is a Playwright project of its own,
 * listed LAST (`playwright.config.ts` §`projects`), so its four loads run one
 * after another in one worker once the rest of the gate is done. On the slower
 * of the two runners CI lands on (a job over 1 000 s; #651 read it as an AMD
 * EPYC 7763) the rest of the gate — from Playwright's start to the game
 * spec's first load — took up to 245 s (runs 36395959573 and 36405580515; it
 * grows as specs are added). If every one of the four loads hung:
 *
 *     60 + 70 + 165 + 160    the four budgets: plain, `?shadow-map`,
 *                            `?realistic`, `?realistic&trees`
 *   = 455 s
 *   +  30 s                  21 describes failing, each replacing the worker,
 *                            and the two servers starting (measured below)
 *   + 245 s                  the rest of the gate, first
 *   +  84 s                  `realistic.browser.spec.ts`' instruments case,
 *                            if its page hangs too: it waits its own 150 s
 *                            for a load that took at most 66 s green
 *   = 814 s                  inside the gate's own 840 (`GATE_BUDGET_MS`)
 *
 * ⚠️ **The 84 s assumes that case's FIRST load hangs.** If the first is green
 * and its control load hangs instead, the case takes about 180 s where green
 * took 66 s — 114 s — and the sum is 844 s, 4 s past 840. The linear sum
 * over-counts: that spec runs on the `chromium` project in one of the two
 * workers, and while it waits the other worker finishes the remaining specs
 * and takes this group (`playwright.config.ts` §`projects`: nothing waits for
 * `chromium` to finish), so the wait overlaps the rest of the gate and these
 * loads rather than adding to them in a line. That is reasoned, not measured;
 * if the overlap were ever under 4 s, the gate would stop itself at 840 s with
 * the last describe here interrupted — inside the job, naming what ran.
 *
 * and the gate cannot outlive the job: on that runner the step starts as late
 * as 592 s in (run 36395959573) and builds for 9 s before Playwright starts,
 * so 840 s ends it by 1 441 s — 59 s inside `timeout-minutes: 25`'s 1 500,
 * with only the coverage publish and upload (2–3 s) after it. ⚠️ **Nothing
 * re-checks either margin** — the 26 s between 814 and 840, or the 59 s
 * between 1 441 and 1 500. A spec added to the gate eats the first and a step
 * added before the gate eats the second, and neither says so until a hang
 * meets it. Each budget is at least 1.49 times what its load took alone there
 * (§`PLAIN_LOAD_BUDGET_MS` and §`REALISTIC_LOAD_BUDGET_MS` give the margins).
 *
 * Measured with every load made to hang and every budget cut to a tenth —
 * 36.5 s of budgets — locally, `--project game`, on #651's branch:
 * 45 s in all. Four `beforeAll` timeouts, each under the describe that paid
 * for that load; seventeen more describes failed at once by the ledger, each
 * naming the describe whose load hung; fifty cases "did not run". The 8.5 s
 * besides the budgets is the servers and the 21 worker replacements, and does
 * not shrink with the budgets; the 30 s above is it scaled by how much slower
 * that runner draws the same loads (about three and a half times). With the
 * ledger's refusal switched off, the same run took 158 s: 21 hooks each paid
 * a hung budget of their own.
 */
function paysForTheRealisticLoad(): void {
  paysForTheLoad('?realistic', REALISTIC_LOAD_BUDGET_MS);
}

/**
 * What the plain page and `?shadow-map` may take — #651.
 *
 * ⚠️ **Until #651 these two loads were paid inside the first case that asked,
 * under that case's 60 s**, which was a budget for a CASE standing in for one
 * for a LOAD. On the EPYC 7763 (run 36320822283) the plain load took 33.5 s
 * and `?shadow-map` 54.6 s — 5.4 s from its case's timeout. They are paid in
 * hooks of their own now, for #607's reason.
 *
 * ⚠️ **And each is cheaper since #651**: the two loads ran every probe, and
 * each case reads one load's copy, so each load now takes only its own cases'
 * (`game-harness.ts` §`SHADOW_MAP_LOAD`). Measured phase by phase on that
 * runner (run 36334163962), that was 12.6 s of the plain page's 34 and about
 * 16 s of `?shadow-map`'s 55. They took 22 s and 39 s after (runs
 * 36337270885 and 36340917231), so the budgets are 2.3 and 1.7 times that.
 *
 * ⚠️ **60 s and 70 s since #682, not 50 and 65.** On 2026-09-28 the slower
 * runner's green `main` runs took them to 39 s and 45 s (36405580515; thirteen
 * runs read, 36370135206 to 36405580515) — 78 % and 69 %. The plain load
 * starts while the other worker is still on the last `chromium` spec (§`projects`
 * in `playwright.config.ts`), which is some of that. 60 s and 70 s are 1.54
 * and 1.56 times the slowest.
 *
 * ⚠️ **Alone, and that is measured**: the game spec runs after everything
 * else (`playwright.config.ts` §`projects`). Run beside the rest of the gate,
 * as #651 tried, the plain load took 58 s and `?shadow-map` passed 120 s
 * (run 36326756014) — SwiftShader draws on the CPU the other worker is using.
 */
const PLAIN_LOAD_BUDGET_MS = 60_000;
/** @see PLAIN_LOAD_BUDGET_MS */
const SHADOW_MAP_LOAD_BUDGET_MS = 70_000;

/**
 * Pays for a load in a `beforeAll` under its own budget — #607, generalised by
 * #651. Every describe calls it for every load its cases read: once the load is
 * in the worker's memo every later hook reads it for nothing, and if it hung,
 * the ledger (§`loadLedger`) refuses the next worker's attempt at once — so a
 * hung load costs ONE budget, whichever describe paid it, and that describe is
 * the one its failure names.
 *
 * ⚠️ **Every describe, not the first, and that is measured (#651).** With the
 * hook in the first describe alone, a hung plain page cost its one budget and
 * then failed each of the forty-odd cases after it, in every describe, one at
 * a time — and Playwright replaces the worker after EVERY failure, which is a
 * new process and a new Chromium each. Locally, with every load hung and each
 * budget cut to a tenth, that was 47 failures and 115 s for 36.5 s of budgets.
 * A hook that the ledger refuses fails its describe once and marks the rest
 * "did not run", which replaces the worker once a describe.
 */
function paysForTheLoad(query: string, budget: number): void {
  test.beforeAll(async ({ harnessRun }) => {
    test.setTimeout(budget);
    await harnessRun(query);
  });
}

/**
 * #620's stated strength, written here a second time on purpose: the ground
 * blob's darkness at its middle, as the share of the ENCODED pixel it takes
 * away (`ground-blob.ts` §`GROUND_BLOB_DARKNESS`). A change to the constant
 * is a change to this line too, which is what makes it a decision.
 */
const GROUND_BLOB_STATED = 0.3;
/**
 * The window the darkening read back must fall in: the stated 0.3 ± 0.05.
 *
 * #621's review is why it has TWO sides: a floor alone passed a tint 1.5
 * times too strong, which looked better. Half the strength (0.15) and 1.5
 * times it (0.45) each miss this by 0.10. ⚠️ The margin is a CHOSEN
 * tolerance, not a measured pipeline effect: the probe reads a tree 7 m ahead
 * over 21 × 3 strips, where the fog gives back next to nothing and the
 * darkening read back is 0.299 against the stated 0.3. #686's review scaled
 * the shader's alpha and found ×0.75 and ×1.25 red by 0.026 and 0.023, ×1.15
 * green at 0.344 — ±0.05 is ±17 % of the strength.
 */
const GROUND_BLOB_WINDOW = [GROUND_BLOB_STATED - 0.05, GROUND_BLOB_STATED + 0.05] as const;

/**
 * #621's margins, read back off the drawing buffer. The control's is the
 * issue's own: two instances of one shape drawn untinted differ by under 2 %
 * in their widest channel. The product's is set under what the pinned Chromium
 * measured on 2026-09-27 — the two trees 11.2 % apart (0.7 % untinted), the
 * two houses' walls 7.1 % (0.2 % untinted) — and twice the control's.
 */
const TINT_CONTROL_MAXIMUM = 0.02;
const TINT_PRODUCT_MINIMUM = 0.04;
/**
 * How far an instance's shift may miss what `instance-tint.ts` §`tintedLinear`
 * predicts from its own untinted reading, as a share of the shift predicted —
 * the ceiling #621's review found missing. @see shiftMissedBy
 *
 * The prediction leaves out the tone mapping, and AgX draws every shift at
 * about three quarters of its size here: on the pinned Chromium on 2026-09-27
 * the trees missed by 0.27 and 0.28 and the houses by 0.18 and 0.26, so the
 * product clears this by 0.12. A tint never applied misses by exactly 1, and
 * each of these, measured on the same build, went red here and nowhere else in
 * this case (every floor stayed green): the hue scale written in degrees where
 * the shader turns radians — the review's mutation — 0.69 at the least; the
 * brightness scale at ten times, 5.2 at the least; the decode's sign flipped,
 * 1.71; the brightness alone flipped, 1.66. The prediction is made in linear
 * light from the sRGB bytes of the untinted reading, which is not the space
 * the tint is applied in (before the light and AgX) — hence a tolerance
 * derived from the measurement rather than from the bounds.
 */
const TINT_SHIFT_TOLERANCE = 0.4;
/**
 * The fewest pixels a tree in #621's probe may cover and still be a tree: the
 * middle-level broadleaf 20 m ahead covered 313 and 321 on the pinned Chromium.
 */
const TINT_TREE_MINIMUM_PIXELS = 150;

/** An sRGB byte as linear light. */
function linearOfByte(byte: number): number {
  const value = byte / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

/** Linear light as an sRGB byte. */
function byteOfLinear(value: number): number {
  const clamped = Math.max(0, Math.min(1, value));
  return 255 * (clamped <= 0.0031308 ? 12.92 * clamped : 1.055 * clamped ** (1 / 2.4) - 0.055);
}

/**
 * What an instance read back untinted as `control` should read tinted by
 * `tint`, by `instance-tint.ts` §`tintedLinear` — #621's review.
 */
function tintPredicted(control: readonly number[], tint: InstanceTint): number[] {
  const [r, g, b] = control.map(linearOfByte);
  return tintedLinear([r ?? 0, g ?? 0, b ?? 0], tint).map(byteOfLinear);
}

/**
 * How far an instance's tint missed its prediction, as a share of the shift
 * predicted: `|read − predicted| / |predicted − control|` over the three
 * channels, each a vector from the instance's own untinted reading. Nought is
 * the prediction exactly; ONE is a tint never applied at all.
 */
function shiftMissedBy(
  reading: readonly number[],
  predicted: readonly number[],
  control: readonly number[],
): number {
  let miss = 0;
  let shift = 0;
  for (const channel of [0, 1, 2]) {
    const base = control[channel] ?? 0;
    const read = (reading[channel] ?? 0) - base;
    const wanted = (predicted[channel] ?? 0) - base;
    miss += (read - wanted) ** 2;
    shift += wanted ** 2;
  }
  return Math.sqrt(miss) / Math.max(1e-6, Math.sqrt(shift));
}

/**
 * The luma variance the front tyre's tread must read back between — #624, in
 * 8-bit luma squared over `game-harness.ts` §`treadProbe`'s 27 pixels.
 *
 * Measured on the pinned Chromium on 2026-09-27: **23.4** as the product draws
 * it and **4.3** with the rubber's normal map off. The variance a normal map
 * adds grows about as the square of its strength, so at half strength the
 * tread reads about 4.3 + 19.1 / 4 ≈ 9 and at twice it about 4.3 + 19.1 × 4 ≈
 * 81: the floor sits between the half and the product, the ceiling between
 * the product and the double. The mutations in #624's pull request are what
 * checked it.
 */
const TREAD_VARIANCE_FLOOR = 14;
const TREAD_VARIANCE_CEILING = 45;

/**
 * How many times the control's luma variance the product's must be — #624,
 * #715's review. The window above is the right shape for catching a tread
 * drawn at half or double strength, and the WRONG shape for anything else:
 *
 * ⚠️ **The absolute floor and ceiling are valid for this pose and this sun
 * only.** They are 8-bit luma, so they move with everything that lights the
 * square — the sun's elevation or intensity, the exposure, the tone mapping,
 * the environment map, `TREAD_PROBE_ROUND_DEGREES`. #715's reviewer moved the
 * probe round the wheel and read (product / control): 75° 33.92 / 9.27, 90°
 * 23.25 / 4.32, 105° 13.39 / 2.68 — the tread plainly there at 105° and the
 * window red. If the lighting moves and this goes red with no change to the
 * bicycle, re-measure at the new light, re-derive the window from the new
 * product and control exactly as the note above does, and restate both
 * figures here. Do NOT widen the window to make it pass: a window wide enough
 * for every light is too wide to see half a tread.
 *
 * This ratio is the half that does not move with the light, because the light
 * scales the product and its control together. Measured ratios: **3.66** at
 * 75°, **5.38** at 90°, **5.00** at 105°; a tread at half strength at 90°
 * reads about 9 / 4.3 ≈ **2.1**. Three sits under every measured pose and over
 * the half-strength tread. What it cannot see is a DOUBLED tread (a larger
 * ratio passes), which is why the ceiling stays.
 */
const TREAD_VARIANCE_OVER_CONTROL = 3;

/** #617's trees' own load — #644. @see TreeLevelMeasurement */
const TREES_QUERY = '?realistic&trees';

/** Where the committed realistic files are. */
const REALISTIC_PUBLIC = fileURLToPath(new URL('../public/realistic/', import.meta.url));

/**
 * How many images the realistic world holds, once per image — #618's review:
 * eight surface maps (#627 added the verge and the rock), two a photographic structure surface, the bicycle's four
 * (#624), and every image in
 * a vegetation model plus its impostor, read off the committed files exactly as
 * `realistic-textures.test.ts` reads them.
 */
function realisticImageCount(): number {
  const models = REALISTIC_VEGETATION_KINDS.flatMap((kind) => REALISTIC_VEGETATION[kind]);
  return (
    // The road, the grass, and #627's verge and rock: two maps each.
    8 +
    2 * PHOTOGRAPHIC_STRUCTURE_SURFACES.length +
    // #624: the bicycle's four drawn maps.
    REALISTIC_BICYCLE_MAP_NAMES.length +
    // #623: the rider's kit, relief and occlusion maps.
    REALISTIC_RIDER_MAP_NAMES.length +
    models.reduce(
      (sum, model) =>
        sum +
        modelFacts(join(REALISTIC_PUBLIC, model.file)).images.length +
        (model.impostor === undefined ? 0 : 1),
      0,
    )
  );
}

/** Bytes a 4×4 block of each GPU format a realistic texture can be uploaded as. */
const BLOCK_BYTES: Readonly<Record<string, number>> = {
  'ASTC 4x4': 16,
  'ETC2 RGB': 8,
  'ETC2 RGBA': 16,
  BC7: 16,
};

/** The bytes a block-compressed mip chain of a size is, level by level down to 1×1. */
function blockChainBytes(width: number, height: number, blockBytes: number): number {
  let total = 0;
  for (let w = width, h = height; ; w = Math.max(1, w >> 1), h = Math.max(1, h >> 1)) {
    total += Math.ceil(w / 4) * Math.ceil(h / 4) * blockBytes;
    if (w === 1 && h === 1) return total;
  }
}

test.describe('the game renderer in a real browser', () => {
  paysForTheLoad('', PLAIN_LOAD_BUDGET_MS);

  test('constructs against a live WebGL context', async ({ harnessRun }) => {
    const result = await harness(harnessRun);

    expect(result.errors).toEqual([]);
    expect(result.created).toBe(true);
    // The claim jsdom cannot make. If SwiftShader ever stops giving the runner a
    // context this goes red, which is the right outcome: a renderer nobody can
    // construct is not a renderer that works.
    expect(result.hasContext).toBe(true);
  });

  test('accepts the geometry terrain.ts builds', async ({ harnessRun }) => {
    const result = await harness(harnessRun);

    // A vertex buffer whose length disagrees with its index buffer is a
    // type-correct object that a driver rejects at draw time, which is why this
    // is asserted here rather than only in `terrain.test.ts`.
    //
    // ⚠️ Stated as the invariant rather than as an arithmetic identity, since
    // #242. It used to read `vertexCount === (quadCount + 1) * 6`, which was
    // true of a single-lane strip and says nothing about a road that is three
    // lanes and a run of centre-line marks — an index buffer's only contract
    // with a driver is that every index it holds names a vertex that exists.
    expect(result.quadCount).toBeGreaterThan(0);
    expect(result.indexCount).toBeGreaterThan(0);
    expect(result.indexCount % 3).toBe(0);
    expect(result.highestIndex).toBeLessThan(result.vertexCount / 3);
  });

  test('draws the road itself at the centre of the frame', async ({ harnessRun }) => {
    const result = await harness(harnessRun);

    expect(result.framesDrawn).toBe(FRAMES);

    // ⚠️ **This is the only assertion in the repository that says the corridor
    // geometry reaches the screen**, and it was vacuous twice before it was
    // this. It read `alpha !== 0` first, which `alpha: false` makes true of an
    // undrawn frame; then "the centre pixel is not black", which #241's sky
    // and ground made true whatever the geometry did. Commenting out both
    // `scene.add(this.#road)` and `scene.add(marker)` left all 19 tests green.
    //
    // So it is stated as a relative claim instead, in two halves. `ROAD_COLOUR`
    // is a desaturated blue, so the road reads blue > green > red; the ground
    // under this temperate route is vegetation and reads green-dominant, which
    // is what the centre shows when the road is removed. And the road is
    // neither of its two neighbours, which is what catches a frame showing the
    // sky at the centre because the ground went with it.
    const [roadRed, roadGreen, roadBlue] = result.roadPixel;

    expect(roadBlue).toBeGreaterThan(roadGreen);
    expect(roadGreen).toBeGreaterThan(roadRed);
    expect(result.roadPixel.slice(0, 3)).not.toEqual(result.skyPixel.slice(0, 3));
    expect(result.roadPixel.slice(0, 3)).not.toEqual(result.groundPixel.slice(0, 3));
  });

  test('survives its buffers being reused across frames', async ({ harnessRun }) => {
    // A hundred frames, because the renderer reuses and only grows its vertex
    // buffer. A single-frame harness cannot see a reuse bug at all.
    const result = await harness(harnessRun);

    expect(result.framesDrawn).toBe(FRAMES);
    expect(result.errors).toEqual([]);
  });

  test('places the rider and the bot on the road', async ({ harnessRun }) => {
    const result = await harness(harnessRun);

    expect(result.markerKinds).toContain('rider');
    expect(result.markerKinds).toContain('bot');
  });
});

test.describe('the world #241 derives from the route reaches the screen', () => {
  paysForTheLoad('', PLAIN_LOAD_BUDGET_MS);

  /**
   * ⚠️ **This is the criterion that catches #240's named defect for this
   * epic.** A `WorldStyle` computed by `world.ts`, carried on `SceneFrame` and
   * never read by `three-renderer.ts` passes every test in the jsdom suite and
   * changes nothing a rider sees. Only a read-back can tell the two apart, and
   * only in a browser: jsdom has no WebGL at all.
   */
  test('draws a sky above the horizon, where the clear colour used to be', async ({
    harnessRun,
  }) => {
    const result = await harness(harnessRun);

    expect(isClearColour(result.skyPixel)).toBe(false);
  });

  test('draws ground beside the road, where the clear colour used to be', async ({
    harnessRun,
  }) => {
    const result = await harness(harnessRun);

    expect(isClearColour(result.groundPixel)).toBe(false);
  });

  test('draws a sky and a ground that are not the same thing', async ({ harnessRun }) => {
    // A renderer that painted one flat colour over the whole frame would pass
    // both tests above and fail this one. There has to be a horizon.
    const result = await harness(harnessRun);

    expect(result.skyPixel.slice(0, 3)).not.toEqual(result.groundPixel.slice(0, 3));
  });

  test('puts the derived colours on the screen, not an arbitrary pair', async ({ harnessRun }) => {
    // Asserted as channel ORDERING rather than as values, deliberately. Every
    // step between `world.ts` and a read-back byte — colour management, the
    // output transfer function, the fog blend — is monotone per channel, so an
    // ordering survives all of them where an exact value does not. `world.ts`
    // makes the sky blue-dominant at every latitude and altitude, and the
    // harness route is temperate and near sea level, so its ground is
    // vegetation and green-dominant.
    const result = await harness(harnessRun);
    const [skyRed, skyGreen, skyBlue] = result.skyPixel;
    const [groundRed, groundGreen, groundBlue] = result.groundPixel;

    expect(skyBlue).toBeGreaterThan(skyGreen);
    expect(skyGreen).toBeGreaterThan(skyRed);
    expect(groundGreen).toBeGreaterThan(groundRed);
    expect(groundGreen).toBeGreaterThan(groundBlue);
  });

  /**
   * ⚠️ **These two are the only things that can see `WorldStyle.fogDensity`
   * and `WorldStyle.horizonColour`**, and until they existed neither field was
   * covered by anything. `this.#fog.density = 0` in `#updateWorld` left 4 704
   * jsdom tests and all 19 browser tests green; so did
   * `this.#fog.color.setHex(0xff00ff)`. `world.test.ts` proves the *numbers*
   * are right — six tests, solved from `FOG_OCCLUSION_AT_VIEW_END` and
   * `VIEW_AHEAD_METRES` — and nothing proved either number reached the screen.
   * The depth cue is the whole reason #241 prefers fog to a longer corridor.
   *
   * One road pixel cannot show fog, because fog changes no pixel's identity.
   * Two at different depths can: the only difference between `roadPixel` and
   * `roadFarPixel` is how far each has converged toward the horizon.
   */
  test('fades the distant road, rather than drawing it at full strength', async ({
    harnessRun,
  }) => {
    const result = await harness(harnessRun);

    // ⚠️ **#424, and the reason this test and the one below mean anything
    // again.** The far probe was a fixed 58 % up the frame, worked out against
    // a camera 3 m up on a 60° lens. When #424 moved the camera the far end of
    // the road dropped to 54 % — and the probe was reading the SKY. Nothing
    // went red: *"the distant road is a different colour from the near road"*
    // is true of the sky too. Measured: with the old probe put back, the four
    // lines below go red and everything else in this block stays green.
    // `game-harness.ts` §`inTheFrame` aims both probes from the geometry now,
    // and this holds them to what that has to produce. ⚠️ Here rather than in
    // a case of its own because, when it was written, every case in this file
    // reloaded a ten-second harness on CI; since #456 they share one load.
    const [near, far] = result.roadProbeRows;
    // Further up the road is further up the frame, and neither is in the sky.
    expect(far).toBeLessThan(near);
    expect(far).toBeGreaterThan(0.4);
    expect(near).toBeLessThan(0.9);
    // The sky is unfogged and is the scene's background; the far road is a
    // fogged surface. They are different colours on every route there is.
    expect(result.roadFarPixel.slice(0, 3)).not.toEqual(result.skyPixel.slice(0, 3));
    // And it is still tarmac under the haze: the fog is 37 % at this depth, so
    // the road's own blue-over-red ordering survives it.
    expect(result.roadFarPixel[2]).toBeGreaterThan(result.roadFarPixel[0] ?? 255);

    // Non-vacuity first: with no fog to apply there is nothing here to see,
    // and this test would be asserting that two different surfaces differ.
    expect(result.world.fogDensity).toBeGreaterThan(0);
    expect(result.roadFarPixel.slice(0, 3)).not.toEqual(result.roadPixel.slice(0, 3));
  });

  test('fades it toward the horizon colour the route derived, not an arbitrary one', async ({
    harnessRun,
  }) => {
    // Direction per channel, against the horizon colour the harness publishes
    // rather than against a colour written down here — the same reason the sky
    // and ground test asserts ordering rather than values, and the reason this
    // one survives a later sub-issue changing what the world looks like.
    //
    // `mix(road, horizon, f)` moves each channel toward the horizon's own
    // value, so the sign of every channel's shift is the sign of
    // `horizon − road`. A fog colour that is not the derived one moves at
    // least one channel the wrong way: magenta drives green down where the
    // derived haze drives it up.
    const result = await harness(harnessRun);
    const horizon = channelsOf(result.world.horizonColour);

    let checked = 0;
    for (const [index, name] of CHANNELS.entries()) {
      const near = result.roadPixel[index] ?? 0;
      const far = result.roadFarPixel[index] ?? 0;
      const target = horizon[index] ?? 0;
      // One byte of rounding either way, because the read-back is quantised.
      if (target > near + 1) {
        expect(far, `${name} should rise toward the horizon`).toBeGreaterThan(near);
        checked += 1;
      } else if (target < near - 1) {
        expect(far, `${name} should fall toward the horizon`).toBeLessThan(near);
        checked += 1;
      }
    }

    // Fails closed. If a future route left the road and the horizon the same
    // colour in some channel, that channel would be skipped above and this
    // test would quietly weaken; it goes red instead and somebody picks a
    // route where the claim means something.
    expect(checked).toBe(CHANNELS.length);
  });

  /**
   * ⚠️ **What the two tests above do not catch, stated rather than left to be
   * rediscovered.** A direction is a sign, so they separate the derived horizon
   * colour from any colour on the *other* side of the road colour — black, the
   * unset colour, magenta, this route's `groundColour` — and not from one on
   * the same side. `setHex(world.skyColour)` is the one such mistake in reach,
   * and it passes: this route's sky and horizon are both lighter than the road
   * in all three channels.
   *
   * Two things were measured before that was accepted. Separating them needs
   * the *magnitude* of the shift rather than its sign — the blend factor each
   * channel implies, which agrees to 1.04 under the real code and spreads to
   * 1.64 under the `skyColour` mutation. But the shift at this probe is 8 or 9
   * bytes, so one byte of read-back rounding moves each channel's factor by up
   * to 12 %, and the two ranges then overlap: a threshold that always caught
   * the mutation would sometimes fail the real code. And probing where the fog
   * has actually converged — which would separate them outright, the cut end
   * being 95 % faded by `FOG_OCCLUSION_AT_VIEW_END` — is not available on this
   * route, whose road crests about 500 m out and is hidden beyond it.
   *
   * A flaky browser gate is worse than a stated gap, so this is the gap. It
   * closes for free if a later sub-issue gives the harness a route that does
   * not crest.
   */

  test('allocates nothing new on the GPU on a second pass over the same route', async ({
    harnessRun,
  }) => {
    // #240's NFR-3, measured with three's own allocations rather than with
    // object identity: a renderer that rebuilt the ground mesh every frame
    // would create a buffer every frame, and this count would rise by 99 on
    // each pass.
    //
    // ⚠️ **This used to read `resourcesAfterAllFrames === resourcesAfterFirstFrame`
    // and #244 is what made that false — legitimately.** three creates a GPU
    // buffer the first time it *draws* an object, and the scenery belt has a
    // mesh per kind that is drawn only where the route puts that kind of thing
    // beside the road. A kind that first appears two hundred metres in
    // allocates its buffers two hundred metres in: **once**, for the life of
    // the view, bounded by six kinds. Driving the identical sweep a second time
    // and finding nothing further allocated is the claim that was wanted all
    // along, and for the belt it is strictly stronger — it covers every kind,
    // corridor length and scenery count the route reaches rather than whatever
    // happened to be on screen at frame one.
    //
    // ⚠️ **For the rest of the scene it is marginally weaker, and #268's review
    // is right to say so.** The old form pinned the ground, the road and the
    // markers to exact equality after frame one; the pair of tests below now
    // tolerates up to thirty buffers from any source across the first pass. The
    // residual hole is narrow — anything recurring is caught by the second
    // sweep, so what fits through it is an allocation that happens once, at one
    // distance, and never again — but it is a hole the previous assertion did
    // not have.
    const result = await harness(harnessRun);

    expect(result.resourcesAfterFirstFrame).toBeGreaterThan(0);
    expect(result.resourcesAfterSecondSweep).toBe(result.resourcesAfterAllFrames);
  });

  test("finishes allocating within one pass, and within the belt's own bound", async ({
    harnessRun,
  }) => {
    // The other half of the test above, and what stops it passing vacuously
    // over a renderer that allocates on the first pass without limit. Six
    // kinds, five buffers each — position, normal, uv, index and the instance
    // matrix — is everything the belt can ever ask the driver for beyond the
    // first frame, and nothing else in the scene appears after it.
    const result = await harness(harnessRun);
    const MOST_BUFFERS_A_KIND_CAN_ADD = 5;
    const KINDS = 6;

    expect(result.resourcesAfterAllFrames).toBeGreaterThanOrEqual(result.resourcesAfterFirstFrame);
    expect(result.resourcesAfterAllFrames - result.resourcesAfterFirstFrame).toBeLessThanOrEqual(
      MOST_BUFFERS_A_KIND_CAN_ADD * KINDS,
    );
  });
});

/**
 * #458 — *"the rider cannot see the gradient"*. `game-harness.ts`
 * §`gradientProbe` reads a height off the drawing buffer by occlusion, and
 * publishes the same two measurements over the flat quad's geometry as the
 * criterion's control.
 */
test.describe('the gradient shows beside the road — #458', () => {
  paysForTheLoad('', PLAIN_LOAD_BUDGET_MS);

  test('hides a block below the rider’s level beside a climb, and shows one beside a descent', async ({
    harnessRun,
  }, testInfo) => {
    const { gradient } = await harness(harnessRun);
    const measured = `the hills on the horizon cover ${String(gradient.horizonPixels)} px; climb: buried ${String(gradient.climbBuried)} px, lifted clear ${String(gradient.climbLifted)} px; descent: below the rider ${String(gradient.descentBelow)} px. Over the flat quad: climb ${String(gradient.flatClimbBuried)} px, descent ${String(gradient.flatDescentBelow)} px. The landform: ${String(gradient.terrainVertices)} vertices, ${String(gradient.terrainIndices)} indices; drawn per rung ${gradient.terrainIndicesByRung.join(' / ')}`;
    testInfo.annotations.push({ type: 'the gradient beside the road', description: measured });
    console.log(`the gradient beside the road — ${measured}`);

    // Non-vacuity: the block is on screen at that place — lifted clear of the
    // hillside it is drawn, so the zero below is the hill and not a block that
    // was never in the frame.
    expect(gradient.climbLifted).toBeGreaterThan(100);
    // The ground beside a 10 % climb stands ABOVE the rider's road level: a
    // block standing from 1.5 m below it to about 0.5 m above is entirely
    // inside the hillside.
    expect(gradient.climbBuried).toBe(0);
    // And beside a 10 % descent it falls BELOW it: a block whose base is 2.5 m
    // under the rider's road is standing in the air over the valley.
    expect(gradient.descentBelow).toBeGreaterThan(100);

    // ⚠️ **The control, which the criterion requires**: the flat quad's
    // geometry — a level plane 0.25 m under the rider — fails the same pair.
    // On the climb the top of the block stands above that plane and is drawn,
    // so a flat world cannot hide it…
    expect(gradient.flatClimbBuried).toBeGreaterThan(0);
    // …and on the descent the plane is ABOVE most of the block, so it hides
    // what the landform shows. (The quad as it shipped wrote no depth and would
    // have drawn this block; the climb half is the one it fails either way.)
    expect(gradient.flatDescentBelow).toBeLessThan(gradient.descentBelow);
    const passes = (buried: number, below: number) => buried === 0 && below > 100;
    expect(passes(gradient.climbBuried, gradient.descentBelow)).toBe(true);
    expect(passes(gradient.flatClimbBuried, gradient.flatDescentBelow)).toBe(false);
  });

  test('publishes what the landform costs, and takes its outer bands first down the ladder', async ({
    harnessRun,
  }) => {
    const { gradient } = await harness(harnessRun);
    // ⚠️ Folded in here (#456's rule: no new harness load, no new case where an
    // existing one will carry it). The hills on the horizon reach the screen:
    // against the same ridge sunk below the horizon, they cover some of it.
    expect(gradient.horizonPixels).toBeGreaterThan(500);
    // Published rather than bounded, like every GPU cost here — a software
    // rasteriser says nothing about a phone (validation 0002 Part V).
    expect(gradient.terrainVertices).toBeGreaterThan(0);
    const [full, ...lower] = gradient.terrainIndicesByRung;
    expect(full).toBe(gradient.terrainIndices);
    let previous = full ?? 0;
    for (const each of lower) {
      expect(each).toBeLessThanOrEqual(previous);
      previous = each;
    }
    expect(previous).toBeLessThan(full ?? 0);
  });
});

/**
 * #459 — a stream in the route's own valley, and the road carried over it on a
 * bridge. `game-harness.ts` §`waterProbe` reads the pixels.
 */
/**
 * #425's no-asset half — the sky's gradient and the road's and ground's
 * surface detail, both drawn by arithmetic. The photographic surfaces, KTX2 and
 * the HDRI wait for #431; this block is what can be claimed without them.
 */
test.describe('a sky with a gradient, and surfaces with detail — #425', () => {
  paysForTheLoad('', PLAIN_LOAD_BUDGET_MS);

  test('grades the sky from overhead to the haze, where it used to be one colour', async ({
    harnessRun,
  }, testInfo) => {
    const { gradient } = await harness(harnessRun);
    const key = (pixel: Pixel) => pixel.slice(0, 3).join(',');
    const measured = `sky 25° up ${key(gradient.skyHigh)}, 8° up ${key(gradient.skyLow)}; with the haze set to the sky ${key(gradient.flatSkyHigh)} and ${key(gradient.flatSkyLow)}. Road patch deviation ${gradient.roadSpreadDetailed.toFixed(2)} levels with detail, ${gradient.roadSpreadPlain.toFixed(2)} without; the ground's detail changes ${String(gradient.groundChangedByDetail)} px`;
    testInfo.annotations.push({ type: 'the sky and the surfaces', description: measured });
    console.log(`the sky and the surfaces — ${measured}`);

    // Two heights of one sky are two colours…
    expect(key(gradient.skyHigh)).not.toBe(key(gradient.skyLow));
    // …the higher one bluer, as overhead is…
    expect(gradient.skyHigh[2] - gradient.skyHigh[0]).toBeGreaterThan(
      gradient.skyLow[2] - gradient.skyLow[0],
    );
    // …and the control: with the haze set to the sky, which is the flat sky
    // this replaced, the two are one colour. What made them differ is the
    // gradient and nothing else.
    expect(key(gradient.flatSkyHigh)).toBe(key(gradient.flatSkyLow));
  });

  test('gives the road and the ground a surface, and takes it away on the next rung', async ({
    harnessRun,
  }) => {
    const { gradient } = await harness(harnessRun);
    // The road was one vertex colour across a patch this size: the grain is
    // what makes it vary, and the rung that drops the detail flattens it again.
    expect(gradient.roadSpreadDetailed).toBeGreaterThan(gradient.roadSpreadPlain + 0.5);
    expect(gradient.roadSpreadPlain).toBeLessThan(0.5);
    // The ground's mottle and patchwork reach the screen.
    expect(gradient.groundChangedByDetail).toBeGreaterThan(5_000);
    // #468's review, B3: the same place on lap three is the same colour as on
    // lap one — and the control, the patchwork with its lap wrap defeated,
    // which is what the first head drew, repaints the fields.
    console.log(
      `the patchwork a lap later — ${String(gradient.lapChanged)} px changed, ${String(gradient.lapChangedUnwrapped)} px unwrapped`,
    );
    expect(gradient.lapChangedUnwrapped).toBeGreaterThan(2_000);
    expect(gradient.lapChanged).toBeLessThan(gradient.lapChangedUnwrapped / 50);
  });
});

test.describe('water under a bridge — #459', () => {
  paysForTheLoad('', PLAIN_LOAD_BUDGET_MS);

  test('draws the stream beside the bridge, and the road’s deck above it', async ({
    harnessRun,
  }, testInfo) => {
    const { water } = await harness(harnessRun);
    const key = (pixel: Pixel) => pixel.slice(0, 3).join(',');
    const measured = `beside the bridge ${key(water.beside)} (dry ${key(water.besideDry)}); on the deck ${key(water.deck)} (dry ${key(water.deckDry)}), under it ${key(water.underDeck)}; ${String(water.drawCalls)} draw calls against ${String(water.drawCallsDry)} with no water or bridge; a frame of the valley ${water.shadedMs.toFixed(2)} ms with the water shaded, ${water.flatMs.toFixed(2)} ms flat`;
    testInfo.annotations.push({ type: 'water under a bridge', description: measured });
    console.log(`water under a bridge — ${measured}`);

    // Non-vacuity: the valley route has its stream.
    expect(water.crossings).toBeGreaterThan(0);
    // The stream is drawn beside the bridge: taking it away changes the pixel,
    // and what is there is water — blue over red, which ground is not.
    expect(key(water.beside)).not.toBe(key(water.besideDry));
    expect(water.beside[2]).toBeGreaterThan(water.beside[0]);
    // The deck is drawn ABOVE the water: taking the water away changes nothing
    // on the deck…
    expect(key(water.deck)).toBe(key(water.deckDry));
    // …and taking the ROAD away shows water there: it was under the deck all
    // along, which is what a bridge over a stream is.
    expect(key(water.underDeck)).not.toBe(key(water.deck));
    expect(water.underDeck[2]).toBeGreaterThan(water.underDeck[0]);
    // Two draw calls, whatever is in view: the water and the bridges.
    expect(water.drawCalls - water.drawCallsDry).toBe(2);
    // Published, never bounded: a software rasteriser says nothing about a
    // phone's GPU. Validation 0002 Part W is the phone.
    expect(water.shadedMs).toBeGreaterThan(0);
    expect(water.flatMs).toBeGreaterThan(0);
  });

  test('the water’s ripples are band-limited at a grazing angle — #501', async ({
    harnessRun,
  }, testInfo) => {
    // Validation 0002 Z10: *"the stream shows fine horizontal banding"*. The
    // figures are published rather than held to a guessed threshold: the
    // claim is that the band-limit lowers them, and the CONTROL is that with it
    // off the banding reads back — without that, "lower" could be a stream
    // that was never in the frame.
    const { water } = await harness(harnessRun);
    const measured = `a water pixel against the one above it, mean squared luminance difference ${water.rippleBanding.toFixed(2)} band-limited and ${water.rippleBandingUnfiltered.toFixed(2)} without, over ${String(water.ripplePairs)} pairs`;
    testInfo.annotations.push({ type: 'ripple banding', description: measured });
    console.log(`ripple banding — ${measured}`);
    expect(water.ripplePairs).toBeGreaterThan(500);
    expect(water.rippleBandingUnfiltered).toBeGreaterThan(0);
    expect(water.rippleBanding).toBeLessThan(water.rippleBandingUnfiltered);
  });
});

/**
 * #460 — places, not houses. `game-harness.ts` §`settlementProbe` draws a
 * village and its fields and times the frame with and without them.
 */
test.describe('a village and its fields — #460', () => {
  paysForTheLoad('', PLAIN_LOAD_BUDGET_MS);

  test('draws the structures, one call a kind, and publishes what they cost', async ({
    harnessRun,
  }, testInfo) => {
    const { settlement } = await harness(harnessRun);
    const measured = `${String(settlement.structures)} structures of ${String(settlement.kinds)} kinds cover ${String(settlement.pixels)} px; ${String(settlement.drawCalls)} draw calls against ${String(settlement.drawCallsBare)} without them; a frame ${settlement.withMs.toFixed(2)} ms with them, ${settlement.withoutMs.toFixed(2)} ms without`;
    testInfo.annotations.push({ type: 'a village and its fields', description: measured });
    console.log(`a village and its fields — ${measured}`);

    // Non-vacuity: the frame is a village, with more than one kind in it.
    expect(settlement.structures).toBeGreaterThan(10);
    expect(settlement.kinds).toBeGreaterThanOrEqual(3);
    // It reaches the drawing buffer — the named defect shape of this epic is a
    // list the renderer never draws.
    expect(settlement.pixels).toBeGreaterThan(500);
    // One call a mesh at most, however many items: never one per item. A
    // kind is one mesh, but a house is up to three (#367's variants), so the
    // bound is the kinds plus the two extra shapes a house can take.
    expect(settlement.drawCalls - settlement.drawCallsBare).toBeGreaterThan(0);
    expect(settlement.drawCalls - settlement.drawCallsBare).toBeLessThanOrEqual(
      settlement.kinds + 2,
    );
    expect(settlement.drawCalls - settlement.drawCallsBare).toBeLessThan(settlement.structures);
    // Published, never bounded — validation 0002 Part X is the phone.
    expect(settlement.withMs).toBeGreaterThan(0);
  });
});

test.describe('the road reads as a road — #242', () => {
  paysForTheLoad('', PLAIN_LOAD_BUDGET_MS);

  /**
   * ⚠️ **The criterion that catches #240's named defect one layer down.** A
   * colour attribute `terrain.ts` fills, carries on `RoadCorridor` and
   * `three-renderer.ts` never uploads passes all 26 of `terrain.test.ts` and
   * changes nothing a rider sees. Only a read-back can tell the two apart, and
   * only in a browser.
   *
   * Asserted as **one pixel against another**, in the manner the rest of this
   * file settled on: a road with no centre line is one flat colour across its
   * width, so the two probes agree and this goes red. A fixed colour would
   * decay the first time anybody adjusted the palette, and nothing would say
   * it had.
   */
  test('draws a centre line that the carriageway beside it does not have', async ({
    harnessRun,
  }) => {
    const result = await harness(harnessRun);
    const [lineRed, , lineBlue] = result.centreLinePixel;
    const [roadRed, , roadBlue] = result.roadBesidePixel;

    expect(result.centreLinePixel.slice(0, 3)).not.toEqual(result.roadBesidePixel.slice(0, 3));
    // Channel ordering, for the reason the sky-and-ground test gives: every
    // step between a colour and a read-back byte is monotone per channel, so
    // an ordering survives them where a value does not. The paint is warm and
    // the asphalt is a desaturated blue, and a road drawn in no colour at all
    // — a colour attribute never uploaded — satisfies neither.
    expect(lineRed).toBeGreaterThan(lineBlue);
    expect(roadBlue).toBeGreaterThan(roadRed);
    // Found on the road, not at the horizon or on a marker: the band the
    // harness searches is the road's own, and this pins that it stayed there.
    expect(result.centreLineRowFraction).toBeGreaterThan(0.4);
    expect(result.centreLineRowFraction).toBeLessThan(0.6);
  });

  test('paints the centre line brighter than the surface, not merely differently', async ({
    harnessRun,
  }) => {
    // The luminance half of #242's accessibility argument, at the screen
    // rather than at the constants: a marking a rider cannot pick out in
    // sunlight is not a marking. `terrain.test.ts` asserts the contrast ratio
    // the colours have; this asserts the direction survived the pipeline.
    const result = await harness(harnessRun);
    const brightness = (pixel: Pixel): number =>
      0.2126 * (pixel[0] ?? 0) + 0.7152 * (pixel[1] ?? 0) + 0.0722 * (pixel[2] ?? 0);

    expect(brightness(result.centreLinePixel)).toBeGreaterThan(
      brightness(result.roadBesidePixel) + 20,
    );
  });

  /**
   * ⚠️ **#242's fifth criterion, measured in the driver rather than asserted
   * in a review.** The road carries a surface, two edge lines and a run of
   * centre-line marks, and all of it is meant to cost **one** draw call —
   * #240's NFR-2 is explicit that draw calls, overdraw and fill rate are the
   * budget here and triangles are not.
   *
   * Four is the whole scene: the ground plane, the road, the rider's marker
   * and the bot's. The ghost is not in play in this harness and a hidden mesh
   * issues nothing. A road split into three meshes reads as six.
   */
  test('still draws the whole road in one call', async ({ harnessRun }) => {
    const result = await harness(harnessRun);

    // ⚠️ If this goes red at some number **other** than 6, read the
    // enumeration above before reading `terrain.ts`: the literal is the whole
    // scene, not the road, so a later sub-issue that adds a mesh — or a harness
    // that starts showing the ghost — moves it for a reason that has nothing to
    // do with the road being one call. Six is the failure that means what this
    // test's name says.
    //
    // ⚠️ **Against the scenery-free frame, since #244.** `drawCallsPerFrame` is
    // measured on a frame that now carries a scatter belt too, so the calls
    // this test is about are the ground, the road and the two markers — the
    // same enumeration, measured where the scenery is not.
    //
    // ⚠️ **Six rather than four, since #349, and the two extra are the
    // rider's.** It was one sphere and is now a bicycle: a merged body, a
    // crankset that turns, and four leg segments as one instanced mesh.
    // {@link SCENE_DRAW_CALLS} enumerates it, and the point of writing the sum
    // out is that a red run says which term moved.
    expect(result.drawCallsWithoutScatter).toBe(SCENE_DRAW_CALLS);
  });
});

test.describe('the gradient cue reaches the screen, on a frame after the first — #242', () => {
  paysForTheLoad('', PLAIN_LOAD_BUDGET_MS);

  /**
   * ⚠️ **This is the only test in the repository that can see a vertex buffer
   * that was written and never re-uploaded**, and that is this program's
   * dominant defect shape arriving in a new layer: *a write that reports
   * success while the read cannot see it*. three uploads an attribute the
   * first time it binds it and thereafter only when `needsUpdate` says to, so
   * dropping that one line in `#updateRoad` leaves the GPU holding the first
   * frame for the rest of the ride. Every other read-back in this file is
   * taken from a re-render of the first frame and would agree with it happily.
   *
   * The claim is also #242's third criterion at the screen: the tint is
   * luminance-carrying, so a descent is *brighter* than a climb — not merely a
   * different hue.
   */
  test('draws the descent brighter than the climb', async ({ harnessRun }) => {
    const result = await harness(harnessRun);
    const brightness = (pixel: Pixel): number =>
      0.2126 * (pixel[0] ?? 0) + 0.7152 * (pixel[1] ?? 0) + 0.0722 * (pixel[2] ?? 0);
    const [descentRed, descentGreen, descentBlue] = result.roadOnDescentPixel;

    // ⚠️ **The ordering check is what stops this passing for the wrong
    // reason, and it was measured rather than assumed.** A renderer that
    // never re-uploads still moves its *camera*, which comes from the frame
    // and not from a buffer — so it looks at 800 m of route while holding the
    // geometry of the first 460, and the probe lands on the ground plane. The
    // ground is green-dominant under this temperate route and a brightness
    // test alone reads that as a paler road and passes. The road is a
    // desaturated blue at every gradient `roadTint` can produce.
    expect(descentBlue).toBeGreaterThan(descentGreen);
    expect(descentGreen).toBeGreaterThan(descentRed);
    expect(brightness(result.roadOnDescentPixel)).toBeGreaterThan(
      brightness(result.roadPixel) + 10,
    );
  });
});

test.describe('the scenery reaches the screen, and costs one call a kind — #244', () => {
  paysForTheLoad('', PLAIN_LOAD_BUDGET_MS);

  /**
   * ⚠️ **This is the criterion that catches #240's named defect for this epic
   * one layer further down than #241's and #242's.** `scatter.ts` places the
   * scenery, `SceneFrame.scatter` carries it, and `three-renderer.ts`'s belt
   * turns it into instances — and an `InstancedMesh` that was built with
   * `count = 0`, or never added to the scene, or given a zero-scale matrix,
   * satisfies every one of the nineteen assertions in `three-renderer.test.ts`
   * and draws nothing at all. Only a frame rendered twice can tell those apart,
   * and only in a browser: jsdom has no WebGL.
   */
  test('changes what is beside the road when the scenery is added', async ({ harnessRun }) => {
    const result = await harness(harnessRun);

    // Non-vacuity first, and it is not ceremony: a harness route that placed
    // no scenery would make every assertion below a claim about two identical
    // frames, and the first of them would be the one that went red.
    expect(result.scatterItemCount).toBeGreaterThan(20);
    // Not one stray pixel. A belt that drew a single instance at the wrong
    // scale would move a handful; a belt that drew changes a region.
    expect(result.sceneryPixelsChanged).toBeGreaterThan(50);
    expect(result.sceneryPixelWith.slice(0, 3)).not.toEqual(result.sceneryPixelWithout.slice(0, 3));
  });

  test('finds that change beside the road rather than on it', async ({ harnessRun }) => {
    // The carriageway runs up the middle of the frame, so a difference found
    // there could be the road, a marker or a centre-line mark. The harness
    // searches the left of the frame only, and this pins that it stayed there:
    // scenery is the thing #244 put *beside* the road.
    const result = await harness(harnessRun);

    expect(result.sceneryColumnFraction).toBeLessThan(0.375);
    // ⚠️ **Inclusive since #458**, and the reason is the region rather than
    // the scenery: the search starts 40 % up the frame, and since the scenery
    // stands on the landform the strongest change is a near item whose lower
    // half runs off the bottom of that region — measured at exactly 0.4, the
    // region's own first row. A change found there is still inside it.
    expect(result.sceneryRowFraction).toBeGreaterThanOrEqual(0.4);
    expect(result.sceneryRowFraction).toBeLessThan(0.85);
  });

  /**
   * ⚠️ **#244's first criterion, measured in the driver rather than counted in
   * jsdom.** `three-renderer.test.ts` asserts that the belt holds six meshes
   * for five hundred items, which is a claim about a `Map`. This is the claim
   * about what the GPU was actually asked to do, and it is the one that would
   * have caught a per-item `Mesh` — a mistake that is invisible until a phone
   * is in hand, because it is correct in every other respect.
   */
  test('draws many items in at most one call per kind', async ({ harnessRun }) => {
    const result = await harness(harnessRun);

    expect(result.scatterKindCount).toBeGreaterThan(0);
    expect(result.scatterKindCount).toBeLessThanOrEqual(6);
    // The ratio is the point. A per-item mesh reads here as
    // `scatterItemCount` extra calls rather than a handful.
    expect(result.scatterItemCount).toBeGreaterThan(result.scatterKindCount * 4);
    // ⚠️ **A bound rather than an identity, since #367**, and a reviewer who
    // remembers `=== scatterKindCount` is reading the old file. A kind is drawn
    // across up to three meshes now, so the calls a frame spends on the scenery
    // are between the kinds it holds and {@link SCATTER_MESH_CEILING} — which
    // is still a constant, and is still a very long way below the item count.
    // The exact width of the belt is measured at each rung further down.
    const sceneryCalls = result.drawCallsWithScatter - result.drawCallsWithoutScatter;

    expect(sceneryCalls).toBeGreaterThanOrEqual(result.scatterKindCount);
    expect(sceneryCalls).toBeLessThanOrEqual(SCATTER_MESH_CEILING);
    // ⚠️ **The same ratio on a frame that was not prepared for it.** The two
    // counts above are measured back to back late in the run, with the scenery
    // removed from the second on purpose. `drawCallsPerFrame` is the **first**
    // frame the harness ever drew, of the whole scene, with no such
    // arrangement — and #268's review found it published and asserted by
    // nothing. {@link SCENE_DRAW_CALLS} is the scenery-free scene the test
    // above this one pins.
    expect(result.drawCallsPerFrame).toBe(SCENE_DRAW_CALLS + sceneryCalls);
  });
});

/**
 * The world has a light direction, and it reaches the screen — #286.
 *
 * ⚠️ **This is the only place the change can be observed at all.** `world.ts`
 * computes a sun and two intensities; `three-renderer.ts` turns them into an
 * `AmbientLight` and a `DirectionalLight` and mounts a `MeshLambertMaterial`
 * on everything with a form. Every one of those steps is asserted in jsdom
 * against objects that need no GL context — and **all of it passes for lamps
 * that were never added to the scene**, which is #240's named defect shape for
 * this epic arriving one more time. Only a shader can say whether a face is
 * lit, and only a browser has one.
 *
 * The probe is a single-coloured solid at the rider's own position, eight
 * metres from the camera, rendered once with it and once without, so the pixels
 * that changed are its silhouette and nothing else. At that range the fog takes
 * about a tenth of a percent across the whole object, so a brightness range
 * across it is shading or it is nothing.
 *
 * ⚠️ **It WAS the rider's own marker, until #349 made the rider a bicycle.** A
 * reviewer who remembers "a 0.9 m sphere" is reading the old file. The premise
 * every number here rests on is that the probe is **one colour**; a bicycle in
 * four of them reports a spread of 183 levels with the shading switched
 * entirely off, which is a measurement that has stopped meaning anything rather
 * than a criterion that has stopped holding. `game-harness.ts`
 * §`oneColourSolid` records why the bot's cone at the rider's position is the
 * substitute and why the bot's own marker, 120 m up the road, is not.
 */
test.describe('the world is lit, and can stop being — #286', () => {
  paysForTheLoad('?shadow-map', SHADOW_MAP_LOAD_BUDGET_MS);
  // Its first cases read the plain page too. Earlier describes have loaded it,
  // so on a green run this reads the memo for nothing; second, so that a hung
  // plain page never stops `?shadow-map` being paid for and measured.
  paysForTheLoad('', PLAIN_LOAD_BUDGET_MS);

  test('finds the probe at both shadings, so the spreads mean something', async ({
    harnessRun,
  }) => {
    const result = await harness(harnessRun);

    // Non-vacuity first. A probe that fell off the bottom of the frame would
    // make every assertion below a comparison of two empty sets, and a spread
    // of zero would then read as "the lit world is flat" — which is the wrong
    // conclusion from the right number.
    expect(result.litMarkerPixels).toBeGreaterThan(200);
    expect(result.flatMarkerPixels).toBeGreaterThan(200);
    // The same object, drawn twice: the shading changes its colours, never its
    // silhouette. A large disagreement here would mean the two runs are not
    // looking at the same thing and nothing below could be compared.
    expect(Math.abs(result.litMarkerPixels - result.flatMarkerPixels)).toBeLessThan(
      result.litMarkerPixels * 0.05,
    );
  });

  test('gives one object a lit face and a shaded one — criterion 1', async ({ harnessRun }) => {
    const result = await harness(harnessRun);

    // ⚠️ **#286's first acceptance criterion in its own words**: *a form-giving
    // difference between a lit and an unlit face, not only a hue difference*.
    // The unlit scene this replaced reports a spread of about zero here, which
    // is the whole reason the number is worth reading.
    expect(result.litMarkerSpread).toBeGreaterThan(20);
    // And the brightest and darkest pixels of the probe really are the same
    // object seen at two angles, rather than two different objects: they share
    // a hue and differ in level, which is what a diffuse light does.
    const brighter = result.litMarkerBrightest;
    const darker = result.litMarkerDarkest;
    for (const channel of [0, 1, 2] as const) {
      expect(brighter[channel]).toBeGreaterThanOrEqual(darker[channel]);
    }
  });

  test('draws it flat at the floor rung — criterion 4', async ({ harnessRun }) => {
    const result = await harness(harnessRun);

    // ⚠️ **The rung is the answer #286 gives to #245**, and this is what says
    // it is a real one rather than a field nothing reads. `QualitySettings.
    // shading` at `'flat'` puts back exactly the `MeshBasicMaterial` the
    // renderer used before #286 — one colour over the whole object.
    //
    // Not zero: the probe is drawn over a fogged road and a sky, and a couple
    // of its edge pixels can land on a boundary the depth buffer resolves in
    // the object's favour. A handful of levels is that; twenty is shading.
    expect(result.flatMarkerSpread).toBeLessThan(4);
    // Stated as a ratio too, because the pair is the claim: whatever the
    // driver's own rounding does to either number, the lit one is a different
    // kind of number from the flat one.
    expect(result.litMarkerSpread).toBeGreaterThan(result.flatMarkerSpread * 5);
  });

  test('costs no extra draw call, whichever material is on', async ({ harnessRun }) => {
    const result = await harness(harnessRun);

    // Shading is a fragment cost. The lit and the unlit material are mounted
    // on the same meshes, so the swap must not change what the driver is asked
    // to do — a rung that split a mesh, or added a pass, would show up here
    // and nowhere else.
    expect(result.litDrawCalls).toBeGreaterThan(0);
    expect(result.litDrawCalls).toBe(result.flatDrawCalls);
  });

  test('carries a real sun on the frame, derived from the route', async ({ harnessRun }) => {
    const result = await harness(harnessRun);
    const { sun } = result.world;

    // The harness route is at 51.5° N, so the sun is well up but not at the
    // zenith, and the two intensities are the ones `world.ts` solved. Read off
    // the published frame rather than recomputed, so a renderer handed a
    // different world would be visible here.
    expect(Math.hypot(sun.x, sun.y, sun.z)).toBeCloseTo(1, 6);
    expect(sun.y).toBeGreaterThan(0);
    expect(sun.ambient).toBeGreaterThan(0);
    expect(sun.direct).toBeGreaterThan(0);
    // The identity the unlit ground and road rest on: a horizontal surface
    // receives exactly one unit, so it renders at its own colour.
    expect(sun.ambient + sun.direct * sun.y).toBeCloseTo(1, 9);
  });

  /**
   * ⚠️ **What the shading costs, measured — and what the number does not say.**
   *
   * #286's third criterion asks for a frame-time figure *"from the browser gate
   * at minimum"*, and the owner's decision on the issue narrows it to a
   * **relative** one: the same scene and the same route, lit and flat. That is
   * what the harness measures, at one render scale, with the GPU flushed before
   * each clock is read.
   *
   * ⚠️ **No wall-clock budget is asserted, and a ratio is.** An absolute
   * millisecond threshold on a shared runner is a flaky gate, and a flaky gate
   * gets disabled — which would leave this epic with a performance claim nobody
   * re-runs, the exact defect #244's review found and #286 quotes back. A
   * **ratio** is dimensionless and survives the change of machine outright:
   * measured at 1.10 on the CI runner and 0.99 on a developer's laptop, both
   * against a noise floor under 2 % of the mean. {@link SHADING_CEILING} is
   * where the margin between those and the bound is argued.
   *
   * ⚠️ And it is a **headless Chromium**, on a software rasteriser in CI. ADR
   * 0008 D-2's rendering gate was waived rather than passed and #247 is
   * outstanding, so nothing here says a mid-range phone in a handlebar mount
   * can afford the shading. That is why the floor rung exists.
   */
  test('measures what the shading costs, rather than asserting it', async ({
    harnessRun,
  }, testInfo) => {
    // ⚠️ `?shadow-map`: the one case that also measures #426's shadow map,
    // folded in here because this is the case that already times rungs and
    // publishes them — and so that no other case pays for its frames.
    const result = await harness(harnessRun, '?shadow-map');

    expect(result.shadedFrames).toBeGreaterThanOrEqual(30);
    expect(result.litFrameMs).toBeGreaterThan(0);
    expect(result.flatFrameMs).toBeGreaterThan(0);
    expect(Number.isFinite(result.litFrameMs)).toBe(true);
    expect(Number.isFinite(result.flatFrameMs)).toBe(true);

    // ⚠️ **The noise floor is asserted to exist, because without it the pair
    // above is a number nobody can act on** — and a performance number nobody
    // can act on is what #286 quotes #244's review about. A run that reported
    // no spread at all between two identical measurements would mean the clock
    // is not measuring what it claims to.
    expect(result.frameMsNoise).toBeGreaterThan(0);
    // The gate itself. @see SHADING_CEILING
    expect(result.litFrameMs).toBeLessThan(result.flatFrameMs * SHADING_CEILING);

    const cost = result.litFrameMs - result.flatFrameMs;
    const measured =
      `lit ${result.litFrameMs.toFixed(3)} ms, flat ${result.flatFrameMs.toFixed(3)} ms, ` +
      `difference ${cost >= 0 ? '+' : ''}${cost.toFixed(3)} ms a frame, ` +
      `against a same-shading run-to-run spread of ${result.frameMsNoise.toFixed(3)} ms; ` +
      `${String(result.shadedFrames)} frames a measurement, same scene and route, ` +
      `render scale unchanged; ${LENT_FRAMES_NOTE}`;
    testInfo.annotations.push({ type: 'frame cost of the lighting', description: measured });
    // ⚠️ **And printed, not only annotated.** An annotation reaches the JSON
    // and HTML reports and **not the log**, which is the only artefact anybody
    // reads on a green run — so a number published solely there is a number
    // nobody re-runs, which is the failure #286 quotes #244's review about.
    // The list reporter prints a test's stdout beside its own line.
    console.log(`frame cost of the lighting — ${measured}`);

    // ------------------------------------------ the shadow map — #426
    //
    // ⚠️ **Published, not bounded.** A software rasteriser on a GPU-less runner
    // says nothing about a phone; `docs/validation/0002-android-shell-and-game.md`
    // Part T is what made the rung the stylised default (#547), on the tablet.
    // What is asserted is that there WAS a measurement — a shadow reached the
    // buffer — and exactly which calls the rung adds.
    const map = result.shadowMap;
    expect(map.measured).toBe(true);
    expect(map.shadowPixels).toBeGreaterThan(0);
    // #547, and #93's rule on the map rung: the SAME frame with the rider made
    // the ghost changes no pixel. `map.shadowPixels` above is its control — the
    // rider, in the same place, on the same rung, does cast.
    expect(map.ghostShadowPixels).toBe(0);
    expect(map.mapDrawCalls).toBe(map.contactDrawCalls + SHADOW_MAP_EXTRA_DRAW_CALLS);
    expect(map.contactFrameMs).toBeGreaterThan(0);
    expect(map.mapFrameMs).toBeGreaterThan(0);
    const mapCost = map.mapFrameMs - map.contactFrameMs;
    const shadowMeasured =
      `contact ${map.contactFrameMs.toFixed(3)} ms (${String(map.contactDrawCalls)} calls, rider alone), ` +
      `shadow map ${map.mapFrameMs.toFixed(3)} ms (${String(map.mapDrawCalls)} calls), ` +
      `difference ${mapCost >= 0 ? '+' : ''}${mapCost.toFixed(3)} ms a frame, against a ` +
      `same-rung spread of ${map.noiseMs.toFixed(3)} ms; ${String(map.shadowPixels)} px darkened ` +
      `by the map under the rider alone; ${LENT_FRAMES_NOTE}`;
    testInfo.annotations.push({
      type: 'frame cost of the rider shadow map',
      description: shadowMeasured,
    });
    console.log(`frame cost of the rider shadow map — ${shadowMeasured}`);
  });

  /**
   * **No start-of-ride stall with the shadow map — #547.** Part T measured a
   * GPU frame of 4 950 ms in the first seconds of a ride on the map rung on
   * the Pixel Tablet. `game-harness.ts` §`rideStartProbe` draws the first
   * frames of a ride on that rung twice: at once, as before #547 — the control,
   * which must build programs inside those frames — and after `prepare`, as
   * `GameView` does now, which must build none.
   *
   * ⚠️ **Both halves are asserted, and neither is a phone.** No program is
   * linked in the prepared frames, and none of them costs a
   * {@link RIDE_START_STALL_FACTOR}th of the control's first. What the tablet
   * pays at the start of a ride is validation 0002 Part T's to re-take.
   */
  test('builds no GPU program in the first frames of a ride on the shadow map rung — #547', async ({
    harnessRun,
  }, testInfo) => {
    const result = await harness(harnessRun, '?shadow-map');
    const start = result.rideStart;
    expect(start.measured, result.errors.join('; ')).toBe(true);
    // The control reproduces the stall's cause: the first frames build programs.
    expect(start.unpreparedLinks).toBeGreaterThan(0);
    // And `prepare` is where they went — not somewhere nobody measured.
    expect(start.linksInPrepare).toBeGreaterThanOrEqual(start.unpreparedLinks);
    expect(start.preparedLinks).toBe(0);
    expect(start.preparedFrameMs).toHaveLength(start.unpreparedFrameMs.length);
    // And the first frame's COST went, not only its links: no prepared frame
    // costs a quarter of the control's first. Measured on this machine, about
    // 9 ms against 540. `rideStartProbe` says why links alone were not enough.
    const [controlFirst = 0] = start.unpreparedFrameMs;
    expect(Math.max(...start.preparedFrameMs)).toBeLessThan(controlFirst / RIDE_START_STALL_FACTOR);
    const list = (values: readonly number[]) => values.map((each) => each.toFixed(1)).join(' / ');
    const measured =
      `without prepare: ${String(start.unpreparedLinks)} programs linked in the first ` +
      `${String(start.unpreparedFrameMs.length)} frames, ms ${list(start.unpreparedFrameMs)}; ` +
      `with prepare (${start.prepareMs.toFixed(1)} ms, ${String(start.linksInPrepare)} programs, ` +
      `KHR_parallel_shader_compile ${start.parallelCompile ? 'offered' : 'absent'}): ` +
      `${String(start.preparedLinks)} linked in those frames, ms ${list(start.preparedFrameMs)}`;
    testInfo.annotations.push({
      type: 'first frames of a ride on the shadow map',
      description: measured,
    });
    console.log(`first frames of a ride on the shadow map — ${measured}`);
  });

  /**
   * **What a presence check costs, with the renderer running** — #390's cost
   * criterion, and the combined figure rather than the check's own.
   * `game-harness.ts` §`presenceCostProbe` says how it is taken and what it
   * does not say; the short of it is that a headless Chromium on a software
   * rasteriser is not the Pixel Tablet #323's 24 ms p50 was taken on.
   *
   * ⚠️ **Published, not bounded**, for the shading measurement's reason. What
   * IS asserted is that the measurement is of something: the real sampler read
   * a whole grid off a real camera, and the frames were drawn.
   */
  test('what a presence check costs a frame, published beside #323’s 24 ms', async ({
    harnessRun,
  }, testInfo) => {
    const result = await harness(harnessRun, '?shadow-map');
    const cost = result.presenceCost;
    expect(cost.measured, `the presence probe did not run: ${cost.why}`).toBe(true);
    // 32 × 24: the sampler's own canvas, read back whole.
    expect(cost.cells).toBe(PRESENCE_GRID_COLUMNS * PRESENCE_GRID_ROWS);
    expect(cost.frameMs).toBeGreaterThan(0);
    expect(cost.frameWithSampleMs).toBeGreaterThan(0);
    expect(cost.sampleAloneMs).toBeGreaterThan(0);
    expect(Number.isFinite(cost.frameWithSampleMs - cost.frameMs)).toBe(true);

    const perSample = cost.frameWithSampleMs - cost.frameMs;
    // Two samples a check, one check every PRESENCE_CHECK_MILLISECONDS.
    const perSecond = (perSample * 2 * 1000) / PRESENCE_CHECK_MILLISECONDS;
    const measured =
      `renderer alone ${cost.frameMs.toFixed(3)} ms a frame, with one presence sample in every ` +
      `frame ${cost.frameWithSampleMs.toFixed(3)} ms (difference ` +
      `${perSample >= 0 ? '+' : ''}${perSample.toFixed(3)} ms), against a same-condition spread ` +
      `of ${cost.noiseMs.toFixed(3)} ms; a sample alone ${cost.sampleAloneMs.toFixed(3)} ms; at ` +
      `the production rate that is ${perSecond.toFixed(3)} ms of main thread a second, against ` +
      `#323's 24 ms p50 frame on the device floor (not this machine); the synthetic camera's ` +
      `pair read "${cost.observation}"`;
    testInfo.annotations.push({ type: 'frame cost of a presence check', description: measured });
    console.log(`frame cost of a presence check — ${measured}`);
  });

  /**
   * **A frozen source** — #516. A `<video>` whose source has stopped
   * delivering frames goes on drawing the last one, which used to read as a
   * still room and, fifteen seconds later, as nobody on the bike. Taken
   * through the REAL `videoLuminanceSampler` in a real engine, because the
   * frame marker it reads is a platform number no jsdom suite has: a
   * `canvas.captureStream(0)` never asked for a second frame must read
   * `unreadable`, and the same stream with a frame requested between the
   * samples — the control — must read `still`. The synthetic camera, which
   * IS delivering frames, must not be refused by the same guard.
   */
  test('a frozen source reads as unreadable, and a working camera does not', async ({
    harnessRun,
  }) => {
    const result = await harness(harnessRun, '?shadow-map');
    const cost = result.presenceCost;
    expect(cost.measured, `the presence probe did not run: ${cost.why}`).toBe(true);
    expect(cost.frozenObservation).toBe('unreadable');
    expect(cost.deliveringObservation).toBe('still');
    expect(cost.observation).not.toBe('unreadable');
  });
});

/**
 * The scenery is models, and they came from the files this repository commits —
 * #341, and ADR 0022 D-3 and D-7.
 *
 * ## Why this cannot be asserted anywhere else
 *
 * Nothing in the Vitest suite can open a `.glb` with a loader: `GLTFLoader`
 * reads a file over the network and hands its result to a `BufferGeometry`, and
 * jsdom has neither a server nor a GL context. `three-renderer.test.ts` asserts
 * what `prepareSceneryGeometry` does to a scene it is *handed* — the fit, the
 * base, the merge, the fallback — and every one of those assertions is green
 * against a build whose five committed models fail to parse, because a kind
 * that cannot be read keeps its primitive **on purpose**. That graceful
 * fallback is the right behaviour for a rider mid-ride and it is exactly what
 * makes a silent failure invisible, so this is where it is caught.
 */
test.describe('the scenery is models, not solids — #341', () => {
  paysForTheLoad('', PLAIN_LOAD_BUDGET_MS);

  test('draws more geometry for every kind ADR 0022 gives a model', async ({
    harnessRun,
  }, testInfo) => {
    const result = await harness(harnessRun);

    // ⚠️ **Non-vacuity first.** A kind with no items in the probe frame draws
    // nothing under either condition, and "0 is not greater than 0" would read
    // as a model that failed to load rather than as a frame with no buildings
    // in it. Every kind has to be present before the comparison means anything.
    for (const kind of [...MODELLED_KINDS, PROCEDURAL_KIND]) {
      expect(result.sceneryInstances[kind], `${kind} in the probe frame`).toBeGreaterThan(0);
      expect(result.sceneryIndicesPlain[kind], `${kind} as a solid`).toBeGreaterThan(0);
    }

    for (const kind of MODELLED_KINDS) {
      expect(
        result.sceneryIndicesModelled[kind],
        `${kind} draws more geometry as a model than as a solid`,
      ).toBeGreaterThan(result.sceneryIndicesPlain[kind] ?? 0);
    }

    // ⚠️ **Published rather than bounded**, the same posture #286's shading
    // measurement takes: what a model costs the GPU is the number ADR 0022
    // §"What this costs" says is unmeasured, and the honest thing to do with a
    // figure taken from a software rasteriser on a desktop is to print it. A
    // ceiling written from it would be a device-floor claim this machine
    // cannot make — that is #247, and validation 0002 Part E.
    const measured = [...MODELLED_KINDS, PROCEDURAL_KIND]
      .map(
        (kind) =>
          `${kind} ${String(result.sceneryIndicesPlain[kind])} → ` +
          `${String(result.sceneryIndicesModelled[kind])}`,
      )
      .join(', ');
    const note = `vertex indices for one instance, as a solid → as a model: ${measured}`;
    testInfo.annotations.push({ type: 'geometry cost of the scenery models', description: note });
    console.log(`geometry cost of the scenery models — ${note}`);
  });

  test('leaves `post` exactly as it was, because a post has no silhouette to buy', async ({
    harnessRun,
  }) => {
    // ADR 0022 D-3, in the one place it can be observed rather than read: a
    // marker post 1.1 m tall and 14 cm across is the same handful of pixels
    // whether it is modelled or extruded, and a model would cost a manifest
    // row, bundle bytes inside the APK and a share of #245's instance budget.
    const result = await harness(harnessRun);

    expect(result.sceneryIndicesModelled[PROCEDURAL_KIND]).toBe(
      result.sceneryIndicesPlain[PROCEDURAL_KIND],
    );
  });

  test('still costs one draw call a kind, however much geometry a model carries', async ({
    harnessRun,
  }) => {
    // ⚠️ **#341's own warning, and the thing this change is most likely to
    // break without anybody seeing it**: *"Six packs of individually-drawn
    // models would multiply draw calls by the item count and undo #245's
    // budget entirely."* The belt merges every part of a model into one
    // geometry for exactly this, and the number below is #244's, unchanged.
    const result = await harness(harnessRun);
    const sceneryCalls = result.drawCallsWithScatter - result.drawCallsWithoutScatter;

    expect(sceneryCalls).toBeGreaterThanOrEqual(result.scatterKindCount);
    expect(sceneryCalls).toBeLessThanOrEqual(SCATTER_MESH_CEILING);
  });

  test('fetches the committed models and its one atlas, and nothing else', async ({
    harnessRun,
  }) => {
    // ⚠️ **#240's NFR-5 — *"makes no network request"* — was true until #341
    // because there was no file to declare one.** A glTF may name an external
    // resource by URI, and every City Kit building names exactly one: the
    // colour atlas its pack paints every building from. `scenery-models.ts`
    // answers every resource that is not one of ours with 68 bytes of
    // transparent PNG held in the bundle, and this is the only place that
    // policy can be observed from outside the code that implements it.
    //
    // ⚠️ **The atlas is now FETCHED where it used to be refused, and this
    // assertion changed shape with it — #366.** A reviewer who remembers
    // `expect(requested.filter(url => url.includes('colormap'))).toEqual([])`
    // is reading the old file. The buildings' colour is in that image, it is
    // sampled once at load and thrown away, and *"no texture reaches the GPU"*
    // is asserted further down against `gl.createTexture` rather than against
    // this request list. What has not changed at all is the claim that
    // actually protects a rider: nothing off this origin.
    //
    // The request list is collected before the page is opened rather than
    // after, because a request made during the load is one that is over by the
    // time a `page.evaluate` could look — and since #456 it is the list from
    // the same load every other case in this file reads, which `HarnessRun`
    // records for exactly this case.
    const { requested } = await harnessRun();

    // ⚠️ **Distinct URLs, because the harness deliberately loads twice**: once
    // for the measurement and once more to restore the models after the
    // control run that clears them. What is being asserted is *which* files a
    // page reaches for, not how many times it asks.
    const models = new Set(requested.filter((url) => url.endsWith('.glb')));
    const atlases = new Set(requested.filter((url) => url.includes('colormap')));

    // Eleven since #367 — two shapes for each of the four natural kinds and
    // three buildings. {@link SCATTER_MESH_CEILING} is the same arithmetic from
    // the renderer's end.
    expect(models.size).toBe(11);
    // One atlas, shared by all three buildings, served from this origin.
    expect(atlases.size).toBe(1);
    for (const atlas of atlases) {
      expect(atlas.startsWith(HARNESS_ORIGIN)).toBe(true);
    }
    // And nothing at all off this origin — the stronger statement, and the one
    // that survives somebody renaming the atlas.
    expect(requested.filter((url) => !url.startsWith(HARNESS_ORIGIN))).toEqual([]);
  });

  test('uploads no texture to the GPU, however the colour got there — #366', async ({
    harnessRun,
  }) => {
    // ⚠️ **#366's fourth criterion, and the only way to make it.** The atlas is
    // fetched above; a renderer that kept the `Texture` and bound it would draw
    // an identical frame, at an identical draw-call count, with an identical
    // vertex buffer, and every other assertion in this file would stay green.
    // `gl.createTexture` is the one thing it could not avoid.
    const result = await harness(harnessRun);

    // ⚠️ **The instrument first.** A zero that was always going to be a zero is
    // not evidence: a counter patched onto the wrong prototype, or a probe body
    // that never ran, reports the same difference. three allocates four
    // textures of its own before it draws anything at all — one for each
    // sampler kind its default uniforms declare — so that is what a working
    // counter sees, and it is subtracted rather than asserted against.
    expect(result.texturesBaseline).toBeGreaterThan(0);
    expect(result.texturesCreated).toBe(0);
  });
});

/**
 * The rider is a bicycle, and it pedals — #349.
 *
 * ⚠️ **This is the only gate in the repository that can see the pedalling
 * reach a screen.** `bicycle.test.ts` says what the crank angle means,
 * `three-renderer.test.ts` says the renderer writes it into a matrix, and
 * `GameView.test.tsx` says a live cadence produces one — and all three are
 * satisfied by a renderer that draws none of it. That is #240's named defect
 * shape for this epic: *"geometry that is computed, asserted in jsdom, and
 * never drawn"*.
 *
 * ⚠️ **What it deliberately does not claim.** Not that the bicycle *looks*
 * right: there is no reference image, ADR 0009 forbids deriving one from
 * another product, and the measurements below are counts of pixels that
 * changed rather than a comparison with anything. And nothing about a phone —
 * #349's fourth criterion asks for a re-measurement against #246's baseline on
 * the device, and `docs/validation/0002-android-shell-and-game.md` Part K is
 * the procedure for it, with its result table empty.
 *
 * ⚠️ **And it cannot tell the crankset from the legs**, which was measured
 * rather than reasoned about: with `cranks.rotation.x` left unset — the legs
 * still following the angle — this gate stays **green**, because the legs alone
 * move more than enough pixels. What it says is that *the pedalling reaches the
 * screen*, which is the claim no other file can make; that the crankset itself
 * turns is `three-renderer.test.ts` §"turns the crankset by the angle the frame
 * carries", where it is read straight off the mesh.
 */
test.describe('the rider pedals, and it reaches the screen — #349', () => {
  paysForTheLoad('', PLAIN_LOAD_BUDGET_MS);

  test('changes what is on the screen when the cranks turn', async ({ harnessRun }, testInfo) => {
    const result = await harness(harnessRun);

    // The control first: two draws of the identical frame differ nowhere. Read
    // before the claim, because without it every number below could be noise.
    expect(result.crankStillPixels).toBe(0);
    expect(result.crankTurnPixels).toBeGreaterThan(0);
    // And it is a rider's worth of change rather than a stray pixel or two:
    // the legs and the crankset are a real share of the silhouette the shading
    // measurement already found.
    expect(result.riderPixels).toBeGreaterThan(0);
    expect(result.crankTurnPixels).toBeGreaterThan(result.riderPixels * 0.05);
    const measured =
      `a quarter turn moves ${String(result.crankTurnPixels)} px of a ` +
      `${String(result.riderPixels)} px rider; the same angle twice moves ` +
      `${String(result.crankStillPixels)}`;
    testInfo.annotations.push({ type: 'what the pedalling moves', description: measured });
    // ⚠️ **And printed, not only annotated**, for the reason the shading
    // measurement above gives: an annotation reaches the JSON and HTML reports
    // and not the log, and the log is the only artefact anybody reads on a
    // green run.
    console.log(`what the pedalling moves — ${measured}`);
  });

  test('carries its legs with it when it moves without pedalling', async ({
    harnessRun,
  }, testInfo) => {
    // ⚠️ **The gate the test above is blind to by construction**, and the
    // reason it is here is worth stating: every other probe on this page holds
    // the rider's position fixed and varies its crank angle, which is the half
    // a pose cache keyed on the angle gets right. The leg matrices are written
    // in **world** space, so they go stale when the rider moves as readily as
    // when the cranks turn — and `advanceCrank` returns the angle unchanged
    // whenever no cadence is being reported, which is every frame of every
    // power-only ride. Caught in review of #366–#368 after the limbs moved out
    // of a `Group` carrying the world transform and into an `InstancedMesh`
    // that does not.
    const result = await harness(harnessRun);

    // The control first, for the reason the crank control is read first: the
    // rider genuinely moved, so the zero below is a renderer that followed.
    expect(result.riderMovePixels).toBeGreaterThan(0);
    expect(result.riderLeftBehindPixels).toBe(0);
    const measured =
      `moving the rider 1 m across the road without pedalling moves ` +
      `${String(result.riderMovePixels)} px, and leaves ` +
      `${String(result.riderLeftBehindPixels)} px behind`;
    testInfo.annotations.push({
      type: 'what a move without pedalling moves',
      description: measured,
    });
    console.log(`what a move without pedalling moves — ${measured}`);
  });

  test('costs four draw calls rather than the twenty its parts would', async ({ harnessRun }) => {
    const result = await harness(harnessRun);

    // #240's NFR-2. `bicycle.ts` describes about two dozen solids, and a mesh
    // apiece would cost four times what all the scenery costs for the one
    // object in the middle of the frame.
    expect(result.drawCallsWithoutScatter).toBe(SCENE_DRAW_CALLS);
    expect(result.markerKinds).toContain('rider');
  });
});

/**
 * The scenery is painted in the colours its own models carry — #366.
 *
 * ⚠️ **This is the only gate that can see the colours reach a screen.**
 * `scenery-palette.test.ts` says what colours the committed bytes hold, and it
 * says it with a reader that shares no line with the renderer — which is what
 * makes it evidence about the *files*. It is satisfied in full by a renderer
 * that parses every one of them and then draws the world in one flat colour a
 * kind, because nothing in jsdom can construct a `WebGLRenderer` at all. What
 * is asserted below is what a driver actually put on the screen.
 *
 * ⚠️ **What it deliberately does not claim.** Not that the world looks *right*:
 * there is no reference image and ADR 0009 forbids deriving one from another
 * product. The assertions are about which channel leads in a pixel, which is a
 * property a flat-coloured world provably cannot have and a correct one
 * provably must.
 */
test.describe('the scenery carries its own colours — #366', () => {
  paysForTheLoad('', PLAIN_LOAD_BUDGET_MS);

  test('draws a broadleaf tree with a trunk that is not its canopy', async ({
    harnessRun,
  }, testInfo) => {
    // ⚠️ **The red count is the whole criterion.** One colour per kind was the
    // world before #366 and for a broadleaf tree that colour was `0x3f6b33`, a
    // green: every pixel of every tree was green-dominant and no arrangement of
    // lighting could make one lead on red. `woodBark` is (0.886, 0.514, 0.341),
    // which is red-dominant — so a trunk drawn from the model's own values
    // cannot be missed and a trunk drawn from ours cannot be mistaken for one.
    const result = await harness(harnessRun);

    expect(result.treeGreenPixels).toBeGreaterThan(0);
    expect(result.treeRedPixels).toBeGreaterThan(0);
    // A trunk rather than a stray pixel of dither at the silhouette's edge.
    expect(result.treeRedPixels).toBeGreaterThan(20);
    const measured =
      `a broadleaf tree covers ${String(result.treeRedPixels)} red-leading px ` +
      `and ${String(result.treeGreenPixels)} green-leading px`;
    testInfo.annotations.push({ type: 'the tree the pack draws', description: measured });
    console.log(`the tree the pack draws — ${measured}`);
  });

  test('draws a building in the colours its atlas carries', async ({ harnessRun }, testInfo) => {
    // #366's second criterion. The atlas gives it a green roof (66, 172, 124)
    // and slate walls (95, 100, 124), so both a green-leading and a
    // blue-leading pixel exist. The flat colour it had before #366 is
    // `0xa8968a`, which is red-leading, so **neither** does — and a building
    // drawn in that colour fails both of these at once rather than one.
    const result = await harness(harnessRun);

    expect(result.buildingGreenPixels).toBeGreaterThan(20);
    expect(result.buildingBluePixels).toBeGreaterThan(20);
    const measured =
      `a building covers ${String(result.buildingGreenPixels)} green-leading px ` +
      `and ${String(result.buildingBluePixels)} blue-leading px`;
    testInfo.annotations.push({ type: 'the building the atlas paints', description: measured });
    console.log(`the building the atlas paints — ${measured}`);
  });
});

/**
 * Each kind is drawn as several shapes, and what that costs — #367.
 *
 * ⚠️ **The measurement half of the issue, and it is the half the issue is
 * actually about.** *"Draw calls go from 5 to roughly 15–20. That is #240's
 * NFR-2… So this issue is not 'add as many variants as look nice'. It is: pick
 * a number, measure what it costs on the device floor, and put the number where
 * the ladder can see it."*
 *
 * The number is picked in `scenery-models.ts` §`MAXIMUM_SCENERY_VARIANTS`, the
 * ladder sees it in `quality.ts` §`QualitySettings.sceneryVariants`, and what
 * the belt actually submits is measured here and printed. ⚠️ **The device floor
 * is still not this**: `docs/validation/0002-android-shell-and-game.md` Part M
 * is the procedure for that, with its result table empty, exactly as Part H's
 * was left by #341.
 */
test.describe('a kind is drawn as several shapes, and it is measured — #367', () => {
  paysForTheLoad('', PLAIN_LOAD_BUDGET_MS);

  test('draws each of a kind’s variants as a different shape', async ({ harnessRun }) => {
    // ⚠️ **Per variant, which no other measurement here can say.** A belt that
    // had quietly collapsed every variant onto one geometry would hold the
    // right number of meshes, spend the right number of draw calls and draw the
    // world #367 exists to replace. Two equal index counts are two variants
    // drawing the same thing.
    const result = await harness(harnessRun);

    for (const [kind, counts] of Object.entries(result.variantIndices)) {
      if (!(MODELLED_KINDS as readonly string[]).includes(kind)) {
        // ADR 0022 D-3 leaves `post` a cylinder, and #460's eight structures
        // are built from numbers as one shape each: every slot is the same.
        continue;
      }
      const drawn = counts.filter((count) => count > 0);

      expect(drawn.length, `${kind} slots drawn`).toBeGreaterThan(0);
      expect(new Set(drawn).size, `${kind} distinct shapes`).toBeGreaterThan(1);
    }
  });

  test('spends a bounded number of draw calls, and fewer as the ladder drops', async ({
    harnessRun,
  }, testInfo) => {
    const result = await harness(harnessRun);
    const [atThree, atTwo, atOne] = result.sceneryCallsByVariants;

    // The ceiling first, which is the budget this issue is required to state.
    expect(atThree).toBeGreaterThan(0);
    expect(atThree).toBeLessThanOrEqual(SCATTER_MESH_CEILING);
    // ⚠️ **And it is a real ceiling rather than a generous one**: the frame
    // measured carries an item in every slot of every kind, so this IS the
    // whole belt rather than whatever one stretch of road happened to hold.
    expect(atThree).toBe(SCATTER_MESH_CEILING);
    // The ladder does something, and it never goes back up.
    //
    // ⚠️ **This is evidence about the BELT and about `setQuality`'s call to it,
    // and not about `QUALITY_LADDER`'s own numbers.** The harness sets
    // `sceneryVariants` directly at each of three counts rather than reading a
    // rung, which was measured rather than assumed: changing the ladder's
    // middle rung to the ceiling leaves this test green, and deleting
    // `setQuality`'s `setVariants` call turns it red. The ladder's own table is
    // `quality.test.ts` §"gives one up on the same rung as the first scenery
    // step", and the two together are the claim.
    expect(atTwo).toBeLessThan(atThree ?? 0);
    expect(atOne).toBeLessThan(atTwo ?? 0);
    // One shape a kind is what #244 spent, which is the floor rung's cost —
    // six then, and fourteen since #460 added eight kinds of one shape each.
    expect(atOne).toBe(14);

    const measured =
      `scenery draw calls at 3, 2 and 1 shapes a kind: ` +
      `${String(atThree)}, ${String(atTwo)}, ${String(atOne)}; the rest of the scene is ` +
      `${String(SCENE_DRAW_CALLS)}`;
    testInfo.annotations.push({ type: 'what the variants cost', description: measured });
    // ⚠️ **Printed as well as annotated**, for the reason the shading
    // measurement gives: an annotation reaches the JSON and HTML reports and
    // not the log, and the log is the only artefact anybody reads on a green
    // run.
    console.log(`what the variants cost — ${measured}`);
  });
});

/**
 * The rider's back — #623: the luma variance of `game-harness.ts` §`kitProbe`'s
 * 17 × 17 square, 8-bit, as the product draws the kit and with the kit in its
 * own mean colour.
 *
 * Measured on 2026-09-28 in this Chromium: **1 226** with the kit and **6.4**
 * in its mean colour. The floor, **200**, is thirty times the control and a
 * sixth of the product; the ceiling, **5 000**, four times the product — so a
 * kit drawn in a sixth of its contrast is red, and so is one drawn as a
 * checkerboard.
 */
const KIT_VARIANCE_FLOOR = 200;
const KIT_VARIANCE_CEILING = 5_000;
/**
 * The kit's own colour on the back, bounded both ways, 8-bit sRGB means of
 * the same square: the accent is a dark teal, so green and blue lead red
 * (measured 120 and 118 against 84, the white mark and the skin of the arms
 * in the square with it), and nothing is washed out or black.
 */
const KIT_HUE_MARGIN = 20;
const KIT_BRIGHTEST = 190;
const KIT_DARKEST = 40;
/**
 * #368 on the textured body: each pair of the three backs at least this far
 * apart in their furthest channel. Measured 70 (rider and bot), 52 (rider and
 * ghost) and 33 (bot and ghost) on #742's first head, and 72, 36 and 92 since
 * the pacer and the ghost wear `PACER_KIT`; #624's fork holds 30 on the paint, and the
 * back is held to 25 because the kit's white mark and the skin in the square
 * are tinted too, which pulls the three together.
 */
const KIT_TINTS_APART = 25;

/**
 * #623's second half: the rider's back in the CHOSEN kit colour (magenta,
 * `game-harness.ts` §`KIT_PROBE_CHOICE`), 8-bit sRGB means of `kitProbe`'s
 * square, in bytes, bounded both ways. Measured on 2026-09-28 in this
 * Chromium: 167.9, 97.8, 119.9 — red over green by 70.0 and blue over green
 * by 22.1 (the white mark and the skin in the square pull both in). The same
 * frame in the house kit read 83.6, 120.3, 117.6: red UNDER green by 36.7, so
 * a renderer that ignored the choice fails the first floor by over 70 bytes.
 */
const CHOSEN_BACK_RED_OVER_GREEN = { floor: 35, ceiling: 120 } as const;
const CHOSEN_BACK_BLUE_OVER_GREEN = { floor: 10, ceiling: 60 } as const;
/** The control's own ceiling: the house teal's green over its red (36.7 measured). */
const HOUSE_BACK_GREEN_OVER_RED_CEILING = 80;

/**
 * #368's hues, which #742's review found a multiplier over the teal house kit
 * had taken away with every assertion green — the stylised silhouettes' own
 * ratios, bounded both ways. @see the case "draws each of the three in its own
 * colour"
 */
const BOT_RED_OVER_GREEN = { floor: 1.3, ceiling: 4 } as const;
const GHOST_BLUE_OVER_GREEN = { floor: 1.5, ceiling: 6 } as const;
/** The rider's own teal silhouette, in bytes of green over red. */
const RIDER_GREEN_OVER_RED = { floor: 30, ceiling: 100 } as const;
/**
 * The same two hues on the realistic rider's BACK (`kitProbe`'s square), in
 * bytes, bounded both ways. Measured in this Chromium: the bot's red over its
 * green 24.1 with #623's `PACER_KIT` and 17.6 on #742's first head, whose teal
 * jersey under the orange had green leading red (the white mark and the skin
 * in the square are tinted too, which is why the gap is narrow); the ghost's
 * blue over its green 53.5, and 7.3 on that head.
 */
const BACK_BOT_RED_OVER_GREEN = { floor: 21, ceiling: 45 } as const;
const BACK_GHOST_BLUE_OVER_GREEN = { floor: 30, ceiling: 90 } as const;

/**
 * The bot and the ghost are bicycles, and a rider can still tell them apart —
 * #368.
 *
 * ⚠️ **What this gate can say about #93's third criterion, and what it
 * cannot.** It can say that the three are drawn in measurably different
 * colours, at the same place, in the same frame — which is the property that
 * had to be *re-established* once the shape stopped doing the work. It cannot
 * say that a rider glancing at a handlebar-mounted phone in sunlight tells them
 * apart, which is what that criterion is actually about:
 * `docs/validation/0002-android-shell-and-game.md` Part N is the procedure, at
 * 10 m, 50 m and 200 m, and its result table is empty.
 */
test.describe('the pacer and the ghost are bicycles — #368', () => {
  paysForTheLoad('', PLAIN_LOAD_BUDGET_MS);

  test('costs no draw call at all for the two that were solids', async ({ harnessRun }) => {
    // ⚠️ **The direction nobody expects.** #349 drew one bicycle in three calls
    // and left the bot a cone and the ghost an octahedron at one apiece; #368
    // instances all three riders into the same three meshes. So the frame was
    // five calls where it had been six, and a ghost would add none. (Six again
    // since #426's contact shadow — ONE call for however many riders cast
    // one, and the ghost casts none, so a ghost still adds nothing.)
    const result = await harness(harnessRun);

    expect(result.drawCallsWithoutScatter).toBe(SCENE_DRAW_CALLS);
    expect(result.markerKinds).toContain('rider');
    expect(result.markerKinds).toContain('bot');
  });

  test('draws each of the three in its own colour', async ({ harnessRun }, testInfo) => {
    // ⚠️ **Each drawn alone, at the same place, on the same frame**, so the
    // only thing that can differ between the three is the tint. Drawing them
    // together would measure whichever happened to be in front.
    const result = await harness(harnessRun);
    const { rider, bot, ghost } = result.riderMeanColour;

    for (const [kind, pixels] of Object.entries(result.riderSilhouettePixels)) {
      // Non-vacuity: a mean over nothing is `NOWHERE`, and three of those are
      // identical — which would satisfy nothing below and is worth saying so.
      expect(pixels, `${kind} silhouette`).toBeGreaterThan(50);
    }
    const key = (pixel: Pixel | undefined) => (pixel ?? []).slice(0, 3).join(',');
    const measured = `mean silhouette colour — rider ${key(rider)}, bot ${key(bot)}, ghost ${key(ghost)}; silhouettes ${Object.entries(
      result.riderSilhouettePixels,
    )
      .map(([kind, pixels]) => `${kind} ${String(pixels)} px`)
      .join(', ')}, rider 0.4 m under the road ${String(result.riderBuriedPixels)} px`;
    // ⚠️ **Printed before the assertions rather than after them**, so a red run
    // reports the colours it actually read. Every other measurement in this
    // file logs on the way out, and every one of them is silent on the run
    // where somebody most wants the number.
    testInfo.annotations.push({ type: 'telling the three apart', description: measured });
    console.log(`telling the three apart — ${measured}`);

    expect(new Set([key(rider), key(bot), key(ghost)]).size).toBe(3);

    // ⚠️ **#455: the probe stands the riders ON the road.** It used the camera
    // pose's height, which on this 5 % route is 0.4 m under the tarmac 8 m on,
    // so every mean below was taken over a bicycle whose wheels and lower frame
    // were inside the road. The control is that placement, drawn in the same
    // run: the rider on the tarmac shows clearly more of itself than the rider
    // buried in it — which is what says the colours are the whole bicycle's.
    expect(result.riderBuriedPixels).toBeGreaterThan(50);
    expect(result.riderSilhouettePixels['rider'] ?? 0).toBeGreaterThan(
      result.riderBuriedPixels * 1.1,
    );

    // ⚠️ **Three of them being different is not the claim; each PAIR being
    // told apart is, and the two pairs are told apart by different
    // properties.** That is a finding rather than a design, and it falls out of
    // `instanceColor` multiplying: a tint can only ever darken the kit it
    // multiplies, so no tint can wash a kit out into a pale grey. What is
    // available is hue and value, and they land on the pairs differently.
    //
    // ⚠️ **Since #623 a tint multiplies the kit its KIND wears**
    // (`three-renderer.ts` §`RIDER_KITS`): the rider wears the teal house kit,
    // the pacer and the ghost the blue `PACER_KIT` they were told apart in.
    // Orange times TEAL was near-black with green over red (#742's review: 7,9,1
    // where main drew 20,11,5) while every assertion here stayed green, because
    // the only one about the bot's hue was red over BLUE.
    //
    // **Bot against the other two: HUE.** Its orange is the only tint that
    // suppresses blue, so it is the only one of the three whose red channel
    // leads — over blue AND over green, which is what "orange" says and the
    // first of these alone did not. Stated as orderings and ratios for the
    // reason the rest of this file uses them — every step between a colour and
    // a read-back byte is monotone per channel, so an ordering survives where a
    // value does not.
    expect(bot?.[0] ?? 0).toBeGreaterThan(bot?.[2] ?? 255);
    // Red over green, bounded both ways: main drew 20 over 11, a ratio of 1.8;
    // teal under the tint read 7 over 9. At least 1.3 and at most 4, so a bot
    // gone green is red and so is one gone to a pure red.
    expect(bot?.[0] ?? 0).toBeGreaterThan((bot?.[1] ?? 255) * BOT_RED_OVER_GREEN.floor);
    expect(bot?.[0] ?? 255).toBeLessThan((bot?.[1] ?? 0) * BOT_RED_OVER_GREEN.ceiling);
    expect(rider?.[2] ?? 0).toBeGreaterThan(rider?.[0] ?? 255);
    // The rider's teal house kit (#623), bounded both ways: 12,59,56 measured,
    // green over red by 47. A kit left unwritten per instance is black under
    // the rider's white tint and read 8,22,22 — which every ordering here and
    // the value ratios below passed.
    expect((rider?.[1] ?? 0) - (rider?.[0] ?? 255)).toBeGreaterThan(RIDER_GREEN_OVER_RED.floor);
    expect((rider?.[1] ?? 255) - (rider?.[0] ?? 0)).toBeLessThan(RIDER_GREEN_OVER_RED.ceiling);
    expect(ghost?.[2] ?? 0).toBeGreaterThan(ghost?.[0] ?? 255);
    // The ghost's slate: blue well over green, bounded both ways — main drew
    // 71 over 24, a ratio of 3.0; teal under the grey read 26 over 22. At least
    // 1.5 and at most 6, so a ghost gone teal is red and so is one gone to a
    // pure blue.
    expect(ghost?.[2] ?? 0).toBeGreaterThan((ghost?.[1] ?? 255) * GHOST_BLUE_OVER_GREEN.floor);
    expect(ghost?.[2] ?? 255).toBeLessThan((ghost?.[1] ?? 0) * GHOST_BLUE_OVER_GREEN.ceiling);

    // **Rider against ghost: VALUE.** Both lead on blue over red, because the
    // rider's jersey is teal and the ghost's cool grey cannot take that away. What
    // separates them is that the ghost is a great deal darker — a shadow of
    // the attempt rather than a second rider — and the margin is stated as a
    // ratio because an absolute difference in bytes says nothing about a scene
    // whose exposure nobody has fixed.
    const luminance = (pixel: Pixel | undefined) =>
      0.2126 * (pixel?.[0] ?? 0) + 0.7152 * (pixel?.[1] ?? 0) + 0.0722 * (pixel?.[2] ?? 0);

    expect(luminance(rider)).toBeGreaterThan(luminance(ghost) * 1.8);
    expect(luminance(rider)).toBeGreaterThan(luminance(bot) * 1.8);

    // ------------------------------------------- their shadows — #426
    //
    // ⚠️ **Folded into this case rather than given one of its own**, because
    // every case here reloaded a ten-second harness until #456 (§4c) and this
    // one already draws each rider alone. The same rider at the same place, with the
    // shadows off and then with the `'contact'` every rung draws — so the
    // pixels that differ are the blob, and nothing else can be.
    const shadows = result.contactShadowPixels;
    const [riderWith, riderWithout] = result.contactShadowLuminance.rider ?? [0, 0];
    const [botWith, botWithout] = result.contactShadowLuminance.bot ?? [0, 0];
    const shadowed = `contact shadow — rider ${String(shadows.rider)} px (luminance ${riderWithout.toFixed(1)} → ${riderWith.toFixed(1)}), bot ${String(shadows.bot)} px (${botWithout.toFixed(1)} → ${botWith.toFixed(1)}), ghost ${String(shadows.ghost)} px; control ${String(result.contactShadowNoise)} px`;
    testInfo.annotations.push({ type: 'the riders’ contact shadows', description: shadowed });
    console.log(`the riders’ contact shadows — ${shadowed}`);
    // The control: the shadowless frame twice is the same frame, so a
    // difference below is the blob and not a renderer that is never still.
    expect(result.contactShadowNoise).toBe(0);
    // It reached the drawing buffer — over an unlit road that writes depth,
    // which is the whole of what the transparent, depth-tested, lifted draw
    // was for — under the rider and the pacer…
    //
    // ⚠️ A floor of 50 against a measured 110, and small on purpose: from a
    // chase camera the bicycle stands on most of its own blob, so what shows is
    // the rim either side of the wheels and the part the sun throws sideways.
    // The floor says "it reached the buffer", not how big it looks — T1 in
    // validation 0002 Part T is the person who says that.
    expect(shadows.rider ?? 0).toBeGreaterThan(50);
    expect(shadows.bot ?? 0).toBeGreaterThan(50);
    // …and it is a SHADOW: those pixels are darker with it than without.
    expect(riderWith).toBeLessThan(riderWithout * 0.9);
    expect(botWith).toBeLessThan(botWithout * 0.9);
    // ⚠️ The ghost casts none, and that is the decision #426 asked to be
    // recorded (`contact-shadow.ts` §`CASTS_CONTACT_SHADOW`) — which also makes
    // it the in-scene control: same frame, same place, no blob.
    expect(shadows.ghost).toBe(0);
  });

  test('turns the pacer’s own cranks, from its own odometer', async ({ harnessRun }) => {
    // ⚠️ **The claim no jsdom test can make**: `scene.ts` derives the angle,
    // `three-renderer.ts` writes it into an instance matrix, and all of it is
    // satisfied by a renderer that draws none of it — #240's named defect shape
    // for this epic. The two frames differ only in the bot's crank angle.
    const result = await harness(harnessRun);

    expect(result.botCrankPixels).toBeGreaterThan(0);
    // A pedalling bot's worth of change rather than a stray pixel, against its
    // own silhouette.
    expect(result.botCrankPixels).toBeGreaterThan(
      (result.riderSilhouettePixels['bot'] ?? 0) * 0.02,
    );
  });
});

/**
 * #424 — *"The rider's bicycle occupies a stated minimum share of frame height
 * at 16 : 9, measured in the browser gate — a number, so 'prominent' cannot
 * drift back to 'speck'."*
 *
 * `camera.test.ts` holds the ARITHMETIC to that number. This holds the
 * RENDERER to it: the real `threeGameRenderer`, the real `sceneFrame`, the real
 * bicycle, and the rider's extent read back off the drawing buffer by
 * differencing a frame with them against one without. `game-harness.ts`
 * §`riderExtent` says what that catches that arithmetic cannot.
 */
test.describe('the rider is prominent — #424', () => {
  paysForTheLoad('', PLAIN_LOAD_BUDGET_MS);

  /**
   * ⚠️ One case where there were three, and it was CI's clock rather than
   * taste: every case in this file reloaded the harness until #456, which is
   * ten seconds on the runner, and the job is stopped at a fixed number of
   * minutes. The
   * three claims are still three groups of assertions, in the order that makes
   * a failure readable — nothing measured, then too small, then misplaced.
   */
  test('fills at least a quarter of a 16 : 9 frame’s height, where `camera.ts` says', async ({
    harnessRun,
  }) => {
    const { riderFrame } = await harness(harnessRun);
    const { landscape, portrait } = riderFrame;

    // Non-vacuity. A probe that found no differing pixel reports a box of no
    // size, and "agrees with the arithmetic to two points" is not a claim to
    // make about a rider nobody drew.
    expect(landscape.pixels).toBeGreaterThan(500);
    expect(portrait.pixels).toBeGreaterThan(500);
    expect(landscape.aspect).toBeCloseTo(16 / 9, 5);
    expect(portrait.aspect).toBeCloseTo(10 / 16, 5);

    // #424's criterion. 18.1 % with the camera it replaced, which this fails.
    expect(landscape.bottom - landscape.top).toBeGreaterThanOrEqual(MINIMUM_RIDER_FRAME_SHARE);

    // ⚠️ What ties the layout gate to the renderer. `ride.browser.spec.ts`
    // requires that no HUD panel is over `riderFrameBox`; that is only a claim
    // about the RIDER while the rider is actually drawn there.
    const expected = riderFrameBox(landscape.aspect);
    expect(Math.abs(landscape.top - expected.top)).toBeLessThan(RIDER_BOX_TOLERANCE);
    expect(Math.abs(landscape.bottom - expected.bottom)).toBeLessThan(RIDER_BOX_TOLERANCE);
    // Centred, and about as wide as a handlebar.
    expect((landscape.left + landscape.right) / 2).toBeCloseTo(0.5, 1);
    expect(landscape.right - landscape.left).toBeLessThan(0.1);
  });

  test('the lens opens on an upright frame — #423', async ({ harnessRun }) => {
    // ⚠️ The control for the lens policy reaching the GPU. At 16 : 9 the
    // reference lens and the policy are the same lens, so the case above passes
    // for a renderer that never applied `verticalFieldOfViewDegrees`. Upright
    // they differ: 19 % of the frame's height on the 90° stop, 27 % on a fixed
    // 70°.
    const { portrait } = (await harness(harnessRun)).riderFrame;
    const expected = riderFrameBox(portrait.aspect);
    const fixedLens = riderFrameBox(16 / 9);

    expect(
      Math.abs(portrait.bottom - portrait.top - (expected.bottom - expected.top)),
    ).toBeLessThan(RIDER_BOX_TOLERANCE);
    // And the two predictions are far enough apart for that to mean something.
    expect(fixedLens.bottom - fixedLens.top - (expected.bottom - expected.top)).toBeGreaterThan(
      3 * RIDER_BOX_TOLERANCE,
    );
  });
});

/**
 * The racing line and the lean, read off the drawing buffer — #499.
 *
 * `line-on-the-road.test.ts` holds the FRAME to the line: the marker is where
 * the line says, leaning as `leanAt` says. That is arithmetic about what the
 * renderer was handed, and a renderer that ignored `RiderMarker.lean` — or
 * rolled about the wrong axis — would pass it. This reads the rider back.
 *
 * Both halves are drawn through the centreline's camera, which is held still
 * on purpose: `game-harness.ts` §`lineProbe` says why.
 */
test.describe('the rider rides a line and leans on it — #499', () => {
  paysForTheLoad('', PLAIN_LOAD_BUDGET_MS);

  test('is off-centre and rolled at a hairpin’s apex, and centred and upright without the line', async ({
    harnessRun,
  }) => {
    const { on, onUpright, off } = (await harness(harnessRun)).line;
    console.info(
      `#499 at the apex: on the line, centred at ${(on.centre * 100).toFixed(1)} % of the width ` +
        `with its top ${(on.topShift * 100).toFixed(2)} % from its bottom ` +
        `(${(onUpright.topShift * 100).toFixed(2)} % drawn upright there); ` +
        `on the centreline ${(off.centre * 100).toFixed(1)} % and ${(off.topShift * 100).toFixed(2)} %`,
    );
    // Non-vacuity: a probe that found no rider would read "centred" and
    // "upright" for free.
    for (const each of [on, onUpright, off]) {
      expect(each.pixels).toBeGreaterThan(500);
    }

    // The control. The centreline rider is where `riderFrameBox` says — the
    // middle — and upright: its top third over its bottom third.
    expect(Math.abs(off.centre - 0.5)).toBeLessThan(0.02);
    expect(Math.abs(off.topShift)).toBeLessThan(0.005);

    // On the line: 2.9 m to the inside of the bend at the apex, which from the
    // centreline's camera 4.5 m back is a long way off the middle of the frame.
    expect(Math.abs(on.centre - 0.5)).toBeGreaterThan(0.1);

    // Rolled, measurably, against the same rider at the same place drawn
    // upright (`lineProbe` says why that and not the centreline), and with its
    // top toward the SAME side of the frame it is on — the inside of the bend.
    // A renderer that rolled the wrong way would lean the rider out of the
    // corner, and this sign is the whole of that.
    const roll = on.topShift - onUpright.topShift;
    expect(Math.abs(roll)).toBeGreaterThan(0.01);
    expect(Math.sign(roll)).toBe(Math.sign(on.centre - 0.5));
    // #583: the hairpin turns RIGHT on the map, so its inside — where the apex
    // puts the rider — is the RIGHT of the screen. Until #583 the world was a
    // mirror of its map and this read 22.1 %, on the left; the sign checks
    // above are symmetric and passed either way.
    expect(on.centre).toBeGreaterThan(0.6);
  });

  /**
   * #546: on a straight the rider keeps to the RIGHT, where #499's line put
   * them on the dashed centre line — the owner's 2026-09-25 tablet ride, in
   * both worlds. Read off the screen rather than off `racing-line.ts`, because
   * which side of the road the normal is on the SCREEN is a question of the
   * renderer's handedness that no arithmetic in jsdom answers
   * (`racing-line.ts` §`ROAD_SIDE`).
   */
  test('keeps to the right of the road on a straight, where the centreline rider is in its middle — #546', async ({
    harnessRun,
  }) => {
    const { straightOn, straightOff } = (await harness(harnessRun)).line;
    console.info(
      `#546 on a straight: on the line, centred at ${(straightOn.centre * 100).toFixed(1)} % ` +
        `of the width; on the centreline ${(straightOff.centre * 100).toFixed(1)} %`,
    );
    for (const each of [straightOn, straightOff]) {
      expect(each.pixels).toBeGreaterThan(500);
    }
    // The control: the centreline rider, through the centreline's camera, is
    // in the middle of the frame — which is where the road's centre line is.
    // It would fail the assertion below, which is the defect #546 was filed on.
    expect(Math.abs(straightOff.centre - 0.5)).toBeLessThan(0.02);
    // The rider on the line: right of the middle, by a lane's worth.
    expect(straightOn.centre - 0.5).toBeGreaterThan(0.08);
  });
});

/**
 * Which way a bend turns on the screen — #583.
 *
 * `plan-agrees-with-world.test.ts` holds the arithmetic: the drawn road put
 * through the camera's own axes turns the way the HUD's plan does. What it
 * cannot say is how THREE draws those axes — which side of a frame is a
 * camera's right is the renderer's handedness, and a world stated in one
 * handedness and drawn in the other is a mirror with every unit test green.
 * That is exactly how #583 happened, so it is read here off a drawing buffer.
 */
test.describe('a bend to the right on the map is a bend to the right on the screen — #583', () => {
  paysForTheLoad('', PLAIN_LOAD_BUDGET_MS);

  test('draws the right-hand hairpin turning right, and its mirror — the pre-#583 drawing — turning left', async ({
    harnessRun,
  }) => {
    const { right, mirrored } = (await harness(harnessRun)).bend;
    const describeBend = (name: string, bend: typeof right): string =>
      `${name}: near road at ${(bend.nearCentre * 100).toFixed(1)} %, far road at ` +
      `${(bend.farCentre * 100).toFixed(1)} % of the width, ${String(bend.pixels)} road pixels`;
    console.info(
      `#583 ${describeBend('right-hand', right)}; ${describeBend('mirrored', mirrored)}`,
    );
    // Non-vacuity: a frame with no road "turns" nowhere.
    for (const each of [right, mirrored]) {
      expect(each.pixels).toBeGreaterThan(5_000);
    }
    // The right-hand bend: its far road is right of its near road, and right
    // of the frame's middle.
    expect(right.farCentre - right.nearCentre, describeBend('right-hand', right)).toBeGreaterThan(
      0.05,
    );
    expect(right.farCentre).toBeGreaterThan(0.5);
    // The control — the same bend drawn as every build before #583 drew it —
    // turns LEFT. Without it, the two assertions above would be equally true
    // of a measure that could not tell a mirror from a map.
    expect(
      mirrored.farCentre - mirrored.nearCentre,
      describeBend('mirrored', mirrored),
    ).toBeLessThan(-0.05);
    expect(mirrored.farCentre).toBeLessThan(0.5);
  });
});

/**
 * The camera passing scenery, read off the drawing buffer — #545.
 *
 * `near-field.test.ts` holds what the renderer is HANDED to the near plane:
 * over the fixture rides, `clearOfTheCamera` leaves nothing whose triangles
 * the plane cuts. That is arithmetic about a list and about the shapes read off
 * the files, and a renderer that drew the frame's own list instead of the
 * culled one — or built its shapes wrongly, or a camera whose near plane is not
 * `camera.ts`' — would pass it. This draws the closest pass and looks.
 *
 * The measure is `game-harness.ts` §`nearFieldProbe`'s: the same frame with the
 * near plane where it ships and half as far, whose difference is exactly what
 * the shipped plane cut away — over the scenery whose reach could bring it to
 * the plane at all, because moving the plane also moves the depth buffer's precision under a
 * far tree's foot, which is not a cut. At 8 : 1 in the realistic world —
 * 6 : 1, the widest the stylesheet allows, until #571 stood the scenery beside
 * the drawn road and nothing on the fixture reached that plane any more
 * (`game-harness.ts` §`nearFieldProbe` says why).
 */
test.describe('scenery the camera passes is not cut by the near plane — #545', () => {
  paysForTheRealisticLoad();

  test('shows no cut geometry at the closest pass, where the same frame uncut shows it', async ({
    harnessRun,
  }) => {
    // The realistic load: the world the owner saw it in. It shares that one
    // load with the realistic world's cases below.
    const result = await harness(harnessRun, '?realistic');
    expect(result.errors).toEqual([]);
    const near = result.nearField;
    console.info(
      `#545 at ${String(near.distance)} m in the ${near.world} world, the cull dropped a ` +
        `${near.cut.join(' and a ')} ${near.pivotMetres.toFixed(2)} m from the eye: ` +
        `${String(near.shippedPixels)} pixels cut with the cull, ` +
        `${String(near.controlPixels)} without it, ${String(near.noisePixels)} drawing it twice`,
    );
    // Non-vacuity: the probe drew the realistic world, and found a frame
    // where the renderer's own cull had something to drop.
    expect(near.world).toBe('realistic');
    expect(near.cut.length).toBeGreaterThan(0);
    // The noise floor is nothing: the same frame drawn twice is the same frame.
    expect(near.noisePixels).toBe(0);
    // The control — the defect, drawn: without the cull the near plane cuts
    // what the camera is passing, and the nearer plane shows it.
    expect(near.controlPixels).toBeGreaterThan(100);
    // And with it, nothing stands between the two planes.
    expect(near.shippedPixels).toBe(0);
  });
});

/**
 * The realistic world, in a real engine — ADR 0026, #425, #474, #369.
 *
 * ⚠️ **One page load for all of it** (#456's memo, `?realistic`): the realistic
 * set is about 31 MiB and a prefiltered sky, and every case here reads the one
 * run `game-harness.ts` §`realisticProbe` makes. The default load is the
 * other half of D-7 and is asserted below too: it fetches none of the set.
 */
test.describe('the realistic world — ADR 0026', () => {
  paysForTheRealisticLoad();
  // Two cases compare against the plain page — second, for #286's reason.
  paysForTheLoad('', PLAIN_LOAD_BUDGET_MS);

  const realistic = async (
    run: (query?: string) => Promise<HarnessRun>,
  ): Promise<RealisticMeasurement> => {
    const { result } = await run('?realistic');
    expect(result.errors).toEqual([]);
    expect(result.realistic.measured).toBe(true);
    return result.realistic;
  };

  test('is drawn only when it is loaded, and otherwise falls back and says so — D-7', async ({
    harnessRun,
  }) => {
    const measured = await realistic(harnessRun);
    // Before anything was loaded, a realistic rung drew the stylised world…
    expect(measured.fallbackWorld).toBe('stylised');
    // …a load that could not reach its files said so in a rider's words…
    expect(measured.failedLoad.loaded).toBe(false);
    expect(measured.failedNotice).toMatch(/standard world/);
    // …and once the real files loaded, the same rung drew the realistic world.
    expect(measured.loaded).toBe(true);
    expect(measured.drawnWorld).toBe('realistic');
    // Non-vacuity: it is a different picture, not the stylised one relabelled.
    expect(measured.worldChangedShare).toBeGreaterThan(0.5);
    // #478: the rung's scenery budget reaches BOTH realistic belts — the trees
    // as well as the posts — through the view's own `setQuality`. The control:
    // the same frame at the top rung draws more than the budget, so the cut is
    // the budget and not an empty frame.
    expect(measured.sceneryProbeBudget).toBeGreaterThan(0);
    expect(measured.sceneryDrawnTop).toBeGreaterThan(measured.sceneryProbeBudget);
    expect(measured.sceneryDrawnBudgeted).toBeGreaterThan(0);
    expect(measured.sceneryDrawnBudgeted).toBeLessThanOrEqual(measured.sceneryProbeBudget);
    // #475: the water on a realistic rung reflects the realistic sky — a
    // different colour at the brightness the stylised water was tuned to.
    const luminance = (rgb: readonly number[]): number =>
      0.2126 * (rgb[0] ?? 0) + 0.7152 * (rgb[1] ?? 0) + 0.0722 * (rgb[2] ?? 0);
    expect(measured.waterSkyRealistic).toHaveLength(3);
    expect(measured.waterSkyRealistic).not.toEqual(measured.waterSkyStylised);
    expect(luminance(measured.waterSkyRealistic)).toBeCloseTo(
      luminance(measured.waterSkyStylised),
      4,
    );
  });

  test('draws a window’s glass on a house’s road-facing wall, and the wall where a house has none — #500', async ({
    harnessRun,
  }) => {
    // The house stands on the road 24 m ahead, turned to face the camera, and
    // the probe is the middle of its first front window, projected from
    // `buildings.ts`' own outline — so it follows the plan rather than a pixel
    // somebody picked. Measured on the pinned Chromium: the pane about
    // 13/23/30, the same square with no openings 114/103/90, and the wall
    // beside the window 123/110/96.
    const measured = await realistic(harnessRun);
    const { windowGlass: glass, windowControl: control, windowWall: wall } = measured;
    const luminance = (rgb: readonly number[]): number =>
      0.2126 * (rgb[0] ?? 0) + 0.7152 * (rgb[1] ?? 0) + 0.0722 * (rgb[2] ?? 0);
    expect(glass).toHaveLength(3);
    expect(control).toHaveLength(3);
    expect(wall).toHaveLength(3);
    // THE CONTROL: with no openings the same square is the wall — brick, warm,
    // within a few levels of the wall beside the window. Without it, a dark
    // square could be a shadow, the fog, or a house never drawn at all.
    for (const channel of [0, 1, 2]) {
      expect(Math.abs((control[channel] ?? 0) - (wall[channel] ?? 0))).toBeLessThan(30);
    }
    expect(control[0] ?? 0).toBeGreaterThan(control[2] ?? 0);
    // The window: dark glass giving back a little sky — cool where brick is
    // warm, and well under half the wall's brightness.
    expect(luminance(glass)).toBeLessThan(luminance(control) / 2);
    expect(glass[2] ?? 0).toBeGreaterThan(glass[0] ?? 0);
  });

  test('tells two instances of one shape apart by their seeded tints, and not without them — #621', async ({
    harnessRun,
  }) => {
    // Two broadleaf trees of one variant at the middle level, drawn one after
    // the other where they are seen alike, and two houses of one shape in one
    // frame, turned alike — each pair placed where `instance-tint.ts` gives
    // them the most different brightness. @see tintProbe
    const { tint } = await realistic(harnessRun);
    /** The largest channel's difference, as a share of the pair's mean there. */
    const apart = (pair: readonly (readonly number[])[]): number => {
      const [a, b] = pair;
      let widest = 0;
      for (const channel of [0, 1, 2]) {
        const [x, y] = [a?.[channel] ?? 0, b?.[channel] ?? 0];
        widest = Math.max(widest, Math.abs(x - y) / Math.max(1, (x + y) / 2));
      }
      return widest;
    };
    console.log(
      `#621: trees ${JSON.stringify(tint.trees)} against ${JSON.stringify(tint.treesControl)} ` +
        `untinted over ${JSON.stringify(tint.treePixels)} pixels — ${(100 * apart(tint.trees)).toFixed(1)} % ` +
        `against ${(100 * apart(tint.treesControl)).toFixed(1)} %; houses ${JSON.stringify(tint.houses)} ` +
        `against ${JSON.stringify(tint.housesControl)} — ${(100 * apart(tint.houses)).toFixed(1)} % ` +
        `against ${(100 * apart(tint.housesControl)).toFixed(1)} %; tints ` +
        JSON.stringify([...tint.treeTints, ...tint.houseTints]),
    );
    // The ceiling (#621's review): each instance's shift from its OWN untinted
    // reading, predicted by `instance-tint.ts` §`tintedLinear` — the arithmetic
    // the bounds are tested on — and the shader's shift held to it.
    const missOf = (
      readings: readonly (readonly number[])[],
      controls: readonly (readonly number[])[],
      tints: readonly InstanceTint[],
    ): number[] =>
      readings.map((reading, at) => {
        const control = controls[at] ?? [];
        return shiftMissedBy(reading, tintPredicted(control, tints[at] ?? NO_TINT), control);
      });
    const treeMisses = missOf(tint.trees, tint.treesControl, tint.treeTints);
    const houseMisses = missOf(tint.houses, tint.housesControl, tint.houseTints);
    console.log(
      `#621: each shift against tintedLinear's — trees missed by ${treeMisses.map((m) => m.toFixed(2)).join(', ')}, ` +
        `houses by ${houseMisses.map((m) => m.toFixed(2)).join(', ')}`,
    );
    // Non-vacuity: both trees were drawn, and big enough for a mean to mean something.
    for (const pixels of tint.treePixels) expect(pixels).toBeGreaterThan(TINT_TREE_MINIMUM_PIXELS);
    // THE CONTROL: with every bound at nothing, the two of each pair read back
    // alike — so what separates them below is the tint, not the light, the
    // fog or the side each is seen from.
    expect(apart(tint.treesControl)).toBeLessThan(TINT_CONTROL_MAXIMUM);
    expect(apart(tint.housesControl)).toBeLessThan(TINT_CONTROL_MAXIMUM);
    // The product: the same pairs, told apart.
    expect(apart(tint.trees)).toBeGreaterThan(TINT_PRODUCT_MINIMUM);
    expect(apart(tint.houses)).toBeGreaterThan(TINT_PRODUCT_MINIMUM);
    // THE CEILING: each instance shifted as its tint predicts. A floor alone
    // passed the shader with its hue turned in radians where it meant degrees
    // — the trees 34.8 % apart and the houses mauve.
    expect(treeMisses).toHaveLength(2);
    expect(houseMisses).toHaveLength(2);
    for (const miss of [...treeMisses, ...houseMisses]) {
      expect(miss).toBeLessThan(TINT_SHIFT_TOLERANCE);
    }
  });

  test('darkens the ground under a tree by the blob’s stated strength, from both sides — #620', async ({
    harnessRun,
  }) => {
    // A tree 7 m ahead: the ground in its blob's core against the ground 5 m
    // away, drawn and hidden; and a tree whose blob reaches the road's edge,
    // read on the verge beside it. @see groundBlobProbe
    const { grounding } = await realistic(harnessRun);
    const mean = (rgb: readonly number[]): number =>
      ((rgb[0] ?? 0) + (rgb[1] ?? 0) + (rgb[2] ?? 0)) / 3;
    const luminance = (rgb: readonly number[]): number =>
      0.2126 * linearOfByte(rgb[0] ?? 0) +
      0.7152 * linearOfByte(rgb[1] ?? 0) +
      0.0722 * linearOfByte(rgb[2] ?? 0);
    const scaled = (rgb: readonly number[], share: number): number[] =>
      rgb.map((channel) => channel * share);
    const ratio = luminance(grounding.probe) / luminance(grounding.reference);
    const controlRatio = luminance(grounding.probeHidden) / luminance(grounding.referenceHidden);
    // What the blob took off the encoded pixel at its own middle: the drawn
    // ground against the same ground with the blobs hidden.
    const darkening = 1 - mean(grounding.probe) / mean(grounding.probeHidden);
    // The issue's ratio, predicted through the pipeline from the unblobbed
    // ground: the blob is blended over the ENCODED pixel (three tone-maps and
    // encodes inside the ground's own shader), and luminance is WCAG's.
    const ratioAt = (strength: number): number =>
      luminance(scaled(grounding.probeHidden, 1 - strength)) / luminance(grounding.referenceHidden);
    console.log(
      `#620: probe ${JSON.stringify(grounding.probe.map(Math.round))} against ` +
        `${JSON.stringify(grounding.reference.map(Math.round))} ${grounding.referenceMetres.toFixed(1)} m ` +
        `away (rims ${grounding.probeRim.toFixed(2)}, ${grounding.referenceRim.toFixed(2)}); luminance ratio ${ratio.toFixed(3)}, ` +
        `control ${controlRatio.toFixed(3)}; encoded darkening ${darkening.toFixed(3)} against ` +
        `${String(GROUND_BLOB_DARKNESS)} stated, window [${GROUND_BLOB_WINDOW[0].toFixed(2)}, ` +
        `${GROUND_BLOB_WINDOW[1].toFixed(2)}] → ratio [${ratioAt(GROUND_BLOB_WINDOW[1]).toFixed(3)}, ` +
        `${ratioAt(GROUND_BLOB_WINDOW[0]).toFixed(3)}]; verge ${mean(grounding.verge).toFixed(1)} ` +
        `against ${mean(grounding.vergeHidden).toFixed(1)} (rim ${grounding.vergeRim.toFixed(2)}); ` +
        `${String(grounding.drawCalls)} draw calls against ${String(grounding.drawCallsHidden)} hidden; ` +
        `${String(grounding.blobs)} blobs, ${String(grounding.triangles)} triangles; the wooded frame ` +
        `${String(grounding.woodedBlobs)} blobs, ${String(grounding.woodedTriangles)} triangles`,
    );
    // Non-vacuity: the probe is ground inside the blob's core, the reference
    // ground the blob does not reach, 5 m off, and no tree covers either.
    expect(grounding.probeClear).toBe(true);
    expect(grounding.probeRim).toBeLessThanOrEqual(0.35);
    expect(grounding.referenceClear).toBe(true);
    expect(grounding.referenceRim).toBeGreaterThanOrEqual(1);
    expect(grounding.referenceMetres).toBeCloseTo(5, 1);
    // THE CONTROL: with the blobs hidden the two points read alike, so what
    // separates them below is the blob, not the ground's texture or light.
    expect(Math.abs(controlRatio - 1)).toBeLessThan(0.03);
    // The strength, BOTH sides: the encoded darkening at the middle within
    // the window about the stated 0.3 — neither a blob too faint to read nor
    // one darker than it says.
    expect(GROUND_BLOB_DARKNESS).toBe(GROUND_BLOB_STATED);
    expect(darkening).toBeGreaterThan(GROUND_BLOB_WINDOW[0]);
    expect(darkening).toBeLessThan(GROUND_BLOB_WINDOW[1]);
    // And the issue's own ratio, both sides of what that window predicts.
    expect(ratio).toBeGreaterThan(ratioAt(GROUND_BLOB_WINDOW[1]));
    expect(ratio).toBeLessThan(ratioAt(GROUND_BLOB_WINDOW[0]));
    // The road's edge: the verge under B's blob darkens — a blob reaches the
    // edge. That the product's planes stop it there is `ground-blob.test.ts`'
    // hairpin: here the blob lies below the tarmac and the road's depth hides
    // it (@see groundBlobProbe). That the shader obeys a plane is the clip
    // case below.
    expect(grounding.edgeClear).toBe(true);
    expect(grounding.vergeRim).toBeLessThan(0.6);
    expect(mean(grounding.verge) / mean(grounding.vergeHidden)).toBeLessThan(0.9);
    // THE SHIPPED CLIP (#686's review): tree A's blob with a plane forced
    // through its middle keeping the screen's right half. The kept point
    // darkens by the blob's own alpha there and the clipped one not at all;
    // the control — both planes the no-op — darkens both. Each read against
    // the same point with the blobs hidden. @see groundBlobClip
    const { clip } = grounding;
    const darkened = (drawn: readonly number[], hidden: readonly number[]): number =>
      1 - mean(drawn) / mean(hidden);
    const clipFigures = (name: string, at: typeof clip.kept): string =>
      `${name} ${at.metres.toFixed(2)} m (${at.pixels.toFixed(0)} px) from the plane, rim ` +
      `${at.rim.toFixed(2)}, alpha ${at.expected.toFixed(3)}: forced ` +
      `${darkened(at.forced, at.hidden).toFixed(3)}, control ${darkened(at.control, at.hidden).toFixed(3)}`;
    console.log(
      `#620 clip: ${clipFigures('kept', clip.kept)}; ${clipFigures('clipped', clip.clipped)}`,
    );
    expect(clip.measured).toBe(true);
    expect(clip.kept.clear).toBe(true);
    expect(clip.clipped.clear).toBe(true);
    expect(clip.kept.metres).toBeGreaterThan(0);
    expect(clip.clipped.metres).toBeLessThan(0);
    // Non-vacuity: both points are where the blob is dark.
    expect(clip.kept.expected).toBeGreaterThan(0.15);
    expect(clip.clipped.expected).toBeGreaterThan(0.15);
    for (const at of [clip.kept, clip.clipped]) {
      // The control darkens both halves by the blob's alpha, from both sides.
      expect(Math.abs(darkened(at.control, at.hidden) - at.expected)).toBeLessThan(0.05);
    }
    expect(
      Math.abs(darkened(clip.kept.forced, clip.kept.hidden) - clip.kept.expected),
    ).toBeLessThan(0.05);
    expect(Math.abs(darkened(clip.clipped.forced, clip.clipped.hidden))).toBeLessThan(0.02);
    // The cost: one draw call for every blob, two triangles each.
    expect(grounding.drawCalls - grounding.drawCallsHidden).toBe(1);
    expect(grounding.blobs).toBe(2);
    expect(grounding.triangles).toBe(4);
    expect(grounding.woodedBlobs).toBeGreaterThan(0);
    expect(grounding.woodedTriangles).toBe(2 * grounding.woodedBlobs);
    expect(grounding.woodedTriangles).toBeLessThanOrEqual(124);
  });

  test('compiles every shader it draws with, in both worlds — #501', async ({ harnessRun }) => {
    // The stone bridge's world-metre projection and the water's band-limit are
    // both hand-written GLSL spliced into three's own; an error in either is a
    // log line and an invisible mesh, not a thrown exception.
    expect((await harnessRun()).shaderErrors).toEqual([]);
    expect((await harnessRun('?realistic')).shaderErrors).toEqual([]);
  });

  test('fetches the realistic set only when asked — the default world fetches none of it', async ({
    harnessRun,
  }) => {
    const plain = await harnessRun();
    expect(plain.requested.filter((url) => url.includes('/realistic/'))).toEqual([]);
    const asked = await harnessRun('?realistic');
    expect(asked.requested.filter((url) => url.includes('/realistic/')).length).toBeGreaterThan(10);
  });

  test('wears only materials three-renderer.ts constructed, on every visible mesh — D-11', async ({
    harnessRun,
  }) => {
    const measured = await realistic(harnessRun);
    expect(measured.visibleStandard).toBeGreaterThan(5);
    expect(measured.visibleStandardConstructed).toBe(measured.visibleStandard);
    // What a glTF's extensions would have made GLTFLoader build, had one got through.
    expect(measured.visiblePhysical).toBe(0);
    // The far band is drawn, and it too is this file's own material.
    expect(measured.visibleImpostorsConstructed).toBeGreaterThan(0);
  });

  test('keeps the road one draw call, and its gradient readable after the light and AgX — #242, #425', async ({
    harnessRun,
  }) => {
    const measured = await realistic(harnessRun);
    expect(measured.drawCalls - measured.drawCallsWithoutRoad).toBe(1);
    const contrast = (a: number, b: number): number =>
      (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    // #622 publishes the margin: the fog and its valley haze now reach this
    // pixel too, so a change to either is read against it here.
    console.log(
      `the realistic road's gradient after the light and AgX — climb ${measured.climbLuminance.toFixed(4)}, ` +
        `descent ${measured.descentLuminance.toFixed(4)}: ` +
        `${contrast(measured.climbLuminance, measured.descentLuminance).toFixed(3)}:1 against ` +
        `${String(MINIMUM_TINT_CONTRAST_RATIO)}:1 (${contrast(measured.unwornClimbLuminance, measured.unwornDescentLuminance).toFixed(3)}:1 ` +
        `with #628's wear off); the level control ` +
        `${contrast(measured.levelClimbLuminance, measured.levelDescentLuminance).toFixed(4)}:1`,
    );
    // The criterion, read off the drawing buffer: the tint still separates the
    // steepest climb from the steepest descent over the photographic road.
    expect(measured.descentLuminance).toBeGreaterThan(measured.climbLuminance);
    expect(contrast(measured.climbLuminance, measured.descentLuminance)).toBeGreaterThanOrEqual(
      MINIMUM_TINT_CONTRAST_RATIO,
    );
    // #628: and WITH the wear on, the road keeps most of its margin — 3.5 of
    // the 3.97 it read before, which `road-wear.ts` §`MAXIMUM_WEAR_SHARE` is
    // solved against.
    expect(contrast(measured.climbLuminance, measured.descentLuminance)).toBeGreaterThanOrEqual(
      WORN_ROAD_CONTRAST_FLOOR,
    );
    // The control: the same probe on two level roads reads alike, so what was
    // measured above is the tint and not where the probe landed.
    expect(contrast(measured.levelClimbLuminance, measured.levelDescentLuminance)).toBeLessThan(
      1.05,
    );
    // And the photograph reached the GPU: this world samples textures.
    expect(measured.texturesCreated).toBeGreaterThan(5);
  });

  test('wears the road: a wheel track reads lighter than its lane, and not with the wear off — #628', async ({
    harnessRun,
  }) => {
    const { roadWear } = await realistic(harnessRun);
    expect(roadWear.measured).toBe(true);
    const share = (track: number, middle: number): number => track / middle - 1;
    const worn = share(roadWear.track, roadWear.middle);
    const control = share(roadWear.trackControl, roadWear.middleControl);
    console.log(
      `the worn road at ${roadWear.distance.toFixed(0)} m: the wheel track ${roadWear.track.toFixed(4)} ` +
        `against its lane ${roadWear.middle.toFixed(4)} (${(worn * 100).toFixed(2)} %); ` +
        `with the wear off ${roadWear.trackControl.toFixed(4)} against ${roadWear.middleControl.toFixed(4)} ` +
        `(${(control * 100).toFixed(2)} %)`,
    );
    // A floor AND a ceiling (#621, #678): the track is lighter by more than
    // the photograph's own spread, and by no more than the wear's clamp could
    // make it after the light.
    expect(worn).toBeGreaterThan(WHEEL_TRACK_FLOOR);
    expect(worn).toBeLessThan(WHEEL_TRACK_CEILING);
    // The control: with the wear off the same two strips read alike, so the
    // difference above is the wear and not the grain, the sheen or the angle.
    expect(Math.abs(control)).toBeLessThan(WHEEL_TRACK_FLOOR);
  });

  test('blends the ground: a steep bank reads as rock where level grass beside it does not — #627', async ({
    harnessRun,
  }) => {
    const { groundBlend: blend } = await realistic(harnessRun);
    expect(blend.measured).toBe(true);
    const range = (values: readonly number[]): { low: number; high: number } => ({
      low: Math.min(...values),
      high: Math.max(...values),
    });
    const grass = range(blend.levels);
    const grassControl = range(blend.levelsControl);
    console.log(
      `the ground's contrast on the hill: a bank ${blend.bank.toFixed(4)} against level grass ` +
        `${grass.low.toFixed(4)} to ${grass.high.toFixed(4)}; with the rock off ` +
        `${blend.bankControl.toFixed(4)} against ${grassControl.low.toFixed(4)} to ` +
        `${grassControl.high.toFixed(4)} (${String(blend.rockPixels)} px of rock, ` +
        `${String(blend.bankSquares)} squares, ${String(blend.levels.length)} level)`,
    );
    // Non-vacuity: there was a bank, the blend drew rock on it, and there is
    // level grass enough beside it to know how grass reads.
    expect(blend.rockPixels).toBeGreaterThan(BLEND_MINIMUM_ROCK_PIXELS);
    expect(blend.bankSquares).toBeGreaterThan(0);
    expect(blend.levels.length).toBeGreaterThanOrEqual(4);
    // The bank reads unlike any of the grass beside it, by a margin — and by
    // no more than a photograph can (a ceiling).
    expect(blend.bank - grass.high).toBeGreaterThan(BLEND_MARGIN);
    expect(blend.bank).toBeGreaterThan(grass.high * BLEND_FACTOR);
    expect(blend.bank).toBeLessThan(BLEND_CEILING);
    // The control: with the rock blend off the bank is grass again, and reads
    // inside the grass-to-grass spread — widened by BLEND_LIGHT_FACTOR either
    // way, because the bank is grass under a raking light the level squares
    // are not under, and a normal map's relief shows more in one.
    expect(blend.bankControl).toBeLessThanOrEqual(grassControl.high * BLEND_LIGHT_FACTOR);
    expect(blend.bankControl).toBeGreaterThanOrEqual(grassControl.low / BLEND_LIGHT_FACTOR);
  });

  test('lets the water reflect the sky it is under, by Fresnel — the grazing water reflects more — #629', async ({
    harnessRun,
  }) => {
    const measured = await realistic(harnessRun);
    const water = measured.waterReflection;
    expect(water.measured).toBe(true);
    // Non-vacuity: a lake, many rows deep, and the realistic water drew it —
    // the environment map, which the stylised ladder's top must not keep.
    expect(water.reflects).toBe(true);
    expect(measured.waterReflectsAfterStepDown).toBe(false);
    // Each band's Fresnel term, read back: the drawn frame's departure from
    // the water's own body, against the reference's at a known F. The fog,
    // the sky and the body cancel (`game-harness.ts` §`WaterReflectionMeasurement`).
    const fresnel = (band: WaterBand, drawn: number): number =>
      (FRESNEL_REFERENCE * (drawn - band.body)) / (band.reference - band.body);
    const near = fresnel(water.near, water.near.drawn);
    const far = fresnel(water.far, water.far.drawn);
    const nearControl = fresnel(water.near, water.near.control);
    const farControl = fresnel(water.far, water.far.control);
    console.log(
      `the lake's Fresnel term read back: near ${near.toFixed(3)}, grazing ${far.toFixed(3)}; ` +
        `held at ${String(FRESNEL_CONTROL)}, ${nearControl.toFixed(3)} and ${farControl.toFixed(3)} ` +
        `(${String(water.rows)} rows, ${String(water.pixels)} px)`,
    );
    expect(water.rows).toBeGreaterThan(WATER_BAND_ROWS * 2);
    expect(water.pixels).toBeGreaterThan(1_000);
    // Fresnel-shaped, bounded both ways: the grazing water reflects much more
    // of the sky than the near water, the near water is still water (F0 is
    // 0.02, not 0), and neither reads past a whole reflection.
    expect(far - near).toBeGreaterThan(WATER_FRESNEL_MARGIN);
    expect(near).toBeGreaterThan(0);
    expect(far).toBeLessThan(WATER_FRESNEL_CEILING);
    // The control: Fresnel held at a constant reads that constant in both
    // bands, within 2 % — so the difference above is the Fresnel term and not
    // the fog, the angle to the sun or which part of the sky a band faces.
    expect(Math.abs(farControl - nearControl)).toBeLessThan(0.02 * FRESNEL_CONTROL);
    expect(Math.abs(nearControl - FRESNEL_CONTROL)).toBeLessThan(0.02 * FRESNEL_CONTROL);
  });

  test('hands the GPU every realistic texture compressed, and the RGBA8 control is labelled a fallback — #618', async ({
    harnessRun,
  }) => {
    const { textures, firstFrameMs, loadMs } = await realistic(harnessRun);
    // Non-vacuity, and EXACT (#618's review — a floor let up to eight maps go
    // missing): eight surface maps, fourteen structure maps, and every map in a
    // model plus its impostor, once per IMAGE, read off the committed files the
    // way `realistic-textures.test.ts` reads them.
    expect(textures.worn.length).toBe(realisticImageCount());
    expect(textures.uploaded).toBe(textures.worn.length);
    expect(textures.uploads).toHaveLength(textures.uploaded);
    // Which block formats THIS context gets. ⚠️ SwiftShader offers ASTC and
    // ETC — measured on 2026-09-27, against #618's own premise that it offers
    // neither — so on a Mac this reads ASTC and ETC2, the tablet's formats.
    // On the CI runner `KTX2Loader`'s own Linux rule turns them off, and it
    // reads BC7: still a GPU block format, and published so.
    const expected = textures.desktopRule ? ['BC7'] : ['ASTC 4x4', 'ETC2 RGB', 'ETC2 RGBA'];
    for (const format of textures.uploads) expect(expected, format).toContain(format);
    for (const texture of textures.worn)
      expect(expected, JSON.stringify(texture)).toContain(texture.format);
    // Nothing uploaded uncompressed — the claim.
    expect(textures.uploads).not.toContain('RGBA8');
    // ⚠️ THE CONTROL: the same file, through a loader told the device offers
    // no compressed format, goes up as RGBA8 AND says so. Without it, every
    // assertion above could be true of labels that said "compressed" whatever
    // was uploaded.
    expect(textures.control.uploads).toEqual(['RGBA8']);
    expect(textures.control.format).toBe('RGBA8 (fallback)');
    expect(textures.control.compressed).toBe(false);
    expect(expected).not.toContain(textures.control.uploads[0]);
    // The sky is #618's one exclusion: half-float, for PMREMGenerator.
    expect(textures.sky.format).toBe('half-float');
    // The GPU bytes, bounded BOTH ways (#618's review, #621's lesson — a floor
    // proves presence, not correctness): each texture is exactly its format's
    // block chain, every level down to 1×1, at 16 bytes a 4×4 block for ASTC
    // 4×4, ETC2 RGBA and BC7 and 8 for ETC2 RGB. A transcode that zeroed a
    // level, doubled one or dropped the chain is red here, on either runner.
    for (const texture of textures.worn) {
      expect(texture.width, JSON.stringify(texture)).toBeGreaterThanOrEqual(4);
      expect(texture.height, JSON.stringify(texture)).toBeGreaterThanOrEqual(4);
      expect(texture.bytes, JSON.stringify(texture)).toBe(
        blockChainBytes(texture.width, texture.height, BLOCK_BYTES[texture.format] ?? Number.NaN),
      );
    }
    const mib = (bytes: number): string => (bytes / 2 ** 20).toFixed(1);
    const held = textures.worn.reduce((sum, texture) => sum + texture.bytes, 0);
    const counts = new Map<string, number>();
    for (const format of textures.uploads) counts.set(format, (counts.get(format) ?? 0) + 1);
    console.log(
      `#618: ${String(textures.uploaded)} realistic textures uploaded as ` +
        `${[...counts].map(([format, count]) => `${String(count)} ${format}`).join(', ')}` +
        `${textures.desktopRule ? " (KTX2Loader's Linux desktop rule)" : ''}, ${mib(held)} MiB; ` +
        `the sky ${mib(textures.sky.bytes)} MiB at half-float; the control ${textures.control.format}; ` +
        `offered ${textures.offered.join(' ')} on ${textures.platform}; ` +
        `loaded in ${loadMs.toFixed(0)} ms, first realistic frame at ${firstFrameMs.toFixed(0)} ms (SwiftShader)`,
    );
  });

  test('draws the canopy after the opaque world, and the frame is the same picture — #619 lever 1', async ({
    harnessRun,
  }) => {
    const measured = await realistic(harnessRun);
    const { foliageOrder: ordered, foliageOrderControl: control } = measured;
    // Non-vacuity: the wooded frame has leaves AND an opaque world to order.
    expect(ordered.cut).toBeGreaterThan(0);
    expect(ordered.opaque).toBeGreaterThan(0);
    // Every alpha-tested leaf and billboard after the last opaque draw…
    expect(ordered.cutBeforeOpaque).toBe(0);
    // …where the CONTROL — the order three chose unasked, materials first —
    // drew some of the canopy before the ground, the road or a house. Without
    // it, "no leaf before the opaque world" could be a frame that happened to
    // put them there anyway.
    expect(control.cutBeforeOpaque).toBeGreaterThan(0);
    expect(control.cut).toBe(ordered.cut);
    // And the order is a cost, never a picture: the depth test keeps the
    // nearest fragment whichever arrives first.
    expect(measured.foliageOrderChangedPixels).toBe(0);
  });

  test('samples the photographs one mip coarser on the second rung only — #619 lever 2', async ({
    harnessRun,
  }) => {
    const measured = await realistic(harnessRun);
    // The second realistic rung carries the bias, and the shaders read it:
    // taking it away changes the picture.
    expect(measured.textureBiasReducedShare).toBeGreaterThan(0.01);
    // THE CONTROL: the top rung carries none, so taking it away changes nothing.
    expect(measured.textureBiasTopShare).toBe(0);
    // The stylised world is not checked here and cannot be: a view drawing it
    // writes 0 into the shared bias, so forcing its rung to 1 reaches no
    // shader. `realistic-renderer.test.ts` §"biases nothing the stylised world
    // draws" holds it, at the material.
    console.log(
      `#619: a mip coarser changes ${(measured.textureBiasReducedShare * 100).toFixed(1)} % of the ` +
        `second realistic rung's wooded frame; foliage ${String(measured.foliageOrder.cut)} cut draws ` +
        `after ${String(measured.foliageOrder.opaque)} opaque, against ` +
        `${String(measured.foliageOrderControl.cutBeforeOpaque)} before an opaque draw unasked`,
    );
  });

  test('reads the front tyre’s tread back between a floor and a ceiling and over three times its control, and the control under the floor — #624', async ({
    harnessRun,
  }) => {
    // A square of the front tyre's tread, facing a camera brought low, as the
    // product draws it and with the rubber's normal map off. @see treadProbe
    const { tread } = await realistic(harnessRun);
    console.log(
      `#624: the front tyre's tread, ${String(tread.pixels)} pixels ${tread.distanceMetres.toFixed(2)} m ` +
        `from the eye — luma variance ${tread.variance.toFixed(2)} (mean ${tread.mean.toFixed(1)}), ` +
        `${tread.controlVariance.toFixed(2)} with the normal map off, against a floor of ` +
        `${String(TREAD_VARIANCE_FLOOR)} and a ceiling of ${String(TREAD_VARIANCE_CEILING)}, ` +
        `${(tread.variance / Math.max(1e-6, tread.controlVariance)).toFixed(2)}× the control against ` +
        `${String(TREAD_VARIANCE_OVER_CONTROL)}×; ` +
        `the same square with no bicycle ${tread.emptyMean.toFixed(1)}`,
    );
    // Non-vacuity: the square is the tyre — dark rubber where the empty frame
    // is road — and it is the square the probe says it is.
    expect(tread.pixels).toBe(27);
    expect(tread.mean).toBeLessThan(tread.emptyMean / 2);
    expect(tread.mean).toBeGreaterThan(5);
    // THE CONTROL: the tyre's own curve and the light across it, with no
    // tread, fall under the floor — so what clears it below is the tread.
    expect(tread.controlVariance).toBeLessThan(TREAD_VARIANCE_FLOOR);
    // The product, bounded BOTH ways (#621's lesson): a tread drawn at half
    // strength is under the floor, and one drawn at twice it over the ceiling.
    expect(tread.variance).toBeGreaterThan(TREAD_VARIANCE_FLOOR);
    expect(tread.variance).toBeLessThan(TREAD_VARIANCE_CEILING);
    // And relative to the control, which does not move with the light: the
    // tread must add at least twice the variance the bare curve has.
    // @see TREAD_VARIANCE_OVER_CONTROL
    expect(tread.variance).toBeGreaterThan(TREAD_VARIANCE_OVER_CONTROL * tread.controlVariance);
  });

  test('still tells the three realistic bicycles apart by their tints, on the paint that now has a roughness map — #624, #368', async ({
    harnessRun,
  }) => {
    // The same bicycle, the same place and light, drawn as each rider in turn;
    // a square of its fork leg read back. @see treadProbe
    const {
      tread: { forks },
    } = await realistic(harnessRun);
    console.log(`#624: the fork as the rider, the bot and the ghost — ${JSON.stringify(forks)}`);
    const channelsApart = (a: readonly number[], b: readonly number[]): number =>
      Math.max(...[0, 1, 2].map((channel) => Math.abs((a[channel] ?? 0) - (b[channel] ?? 0))));
    for (const colour of [forks.rider, forks.bot, forks.ghost]) expect(colour).toHaveLength(3);
    // Non-vacuity: the pale paint is there, not the road or the sky.
    expect(Math.min(...forks.rider)).toBeGreaterThan(60);
    expect(channelsApart(forks.rider, forks.bot)).toBeGreaterThan(30);
    expect(channelsApart(forks.rider, forks.ghost)).toBeGreaterThan(30);
    expect(channelsApart(forks.bot, forks.ghost)).toBeGreaterThan(30);
    // Each in its own hue: the bot's orange is red over blue, the ghost's slate
    // blue over red, and the rider's white tint leaves the paint's own grey.
    expect((forks.bot[0] ?? 0) - (forks.bot[2] ?? 0)).toBeGreaterThan(30);
    expect((forks.ghost[2] ?? 0) - (forks.ghost[0] ?? 0)).toBeGreaterThan(5);
  });

  test('reads the kit’s pattern on the rider’s back, over its floor and under its ceiling, and its mean colour under the floor — #623', async ({
    harnessRun,
  }) => {
    // A square of the middle of the rider's back, from a camera brought close
    // behind, as the product draws it and with the kit in its own mean colour.
    // @see kitProbe
    const { kit } = await realistic(harnessRun);
    console.log(
      `#623: the rider's back, ${String(kit.pixels)} pixels — luma variance ${kit.variance.toFixed(2)} ` +
        `(mean ${kit.mean.toFixed(1)}), ${kit.controlVariance.toFixed(2)} in the kit's mean colour, ` +
        `against a floor of ${String(KIT_VARIANCE_FLOOR)} and a ceiling of ${String(KIT_VARIANCE_CEILING)}; ` +
        `the same square with no rider ${kit.emptyMean.toFixed(1)}; the back as the rider, the bot ` +
        `and the ghost ${JSON.stringify(kit.backs)}`,
    );
    // Non-vacuity: the square is the rider — it reads differently from the
    // road behind it — and it is the size the probe says.
    expect(kit.pixels).toBe(289);
    expect(Math.abs(kit.mean - kit.emptyMean)).toBeGreaterThan(10);
    // THE CONTROL: the body's shape, relief and light alone, in one colour.
    expect(kit.controlVariance).toBeLessThan(KIT_VARIANCE_FLOOR);
    // The product, bounded BOTH ways.
    expect(kit.variance).toBeGreaterThan(KIT_VARIANCE_FLOOR);
    expect(kit.variance).toBeLessThan(KIT_VARIANCE_CEILING);
    // The kit's own colour, bounded both ways: the jersey is the app's accent,
    // a dark teal — green and blue over red — and never washed out to white.
    const [r, g, b] = kit.backs.rider as [number, number, number];
    expect(g - r).toBeGreaterThan(KIT_HUE_MARGIN);
    expect(b - r).toBeGreaterThan(KIT_HUE_MARGIN);
    expect(Math.max(r, g, b)).toBeLessThan(KIT_BRIGHTEST);
    expect(Math.min(r, g, b)).toBeGreaterThan(KIT_DARKEST);
    // #368 on a textured body: each pair of the three told apart.
    const apart = (x: readonly number[], y: readonly number[]): number =>
      Math.max(...[0, 1, 2].map((channel) => Math.abs((x[channel] ?? 0) - (y[channel] ?? 0))));
    expect(apart(kit.backs.rider, kit.backs.bot)).toBeGreaterThan(KIT_TINTS_APART);
    expect(apart(kit.backs.rider, kit.backs.ghost)).toBeGreaterThan(KIT_TINTS_APART);
    expect(apart(kit.backs.bot, kit.backs.ghost)).toBeGreaterThan(KIT_TINTS_APART);
    // …and each in #368's own hue, which the pairwise distances above could
    // not see go: the pacer's red over its green, the ghost's blue over its.
    const [botRed, botGreen] = kit.backs.bot as [number, number, number];
    expect(botRed - botGreen).toBeGreaterThan(BACK_BOT_RED_OVER_GREEN.floor);
    expect(botRed - botGreen).toBeLessThan(BACK_BOT_RED_OVER_GREEN.ceiling);
    const [, ghostGreen, ghostBlue] = kit.backs.ghost as [number, number, number];
    expect(ghostBlue - ghostGreen).toBeGreaterThan(BACK_GHOST_BLUE_OVER_GREEN.floor);
    expect(ghostBlue - ghostGreen).toBeLessThan(BACK_GHOST_BLUE_OVER_GREEN.ceiling);
  });

  test('dresses the rider’s back in the kit colour the rider chose, and in the house kit when told the house kit — #623', async ({
    harnessRun,
  }) => {
    // The same square as the case above, the same frame, drawn after the view
    // was told a non-default palette entry through the product's own
    // `setRiderKit` — and then, the control, told the house kit again. A
    // renderer that ignored the choice reads both as the house teal, and the
    // chosen magenta's red over its green is then negative. @see kitProbe
    const { kit } = await realistic(harnessRun);
    const [red, green, blue] = kit.chosen.back as [number, number, number];
    const [houseRed, houseGreen, houseBlue] = kit.house as [number, number, number];
    console.log(
      `#623: the rider's back in ${kit.chosen.colour} ${JSON.stringify(kit.chosen.back)}, ` +
        `and told the house kit again ${JSON.stringify(kit.house)} ` +
        `(the product's house back ${JSON.stringify(kit.backs.rider)})`,
    );
    expect(kit.chosen.colour).toBe('magenta');
    // Magenta: red over green AND blue over green, each bounded both ways.
    expect(red - green).toBeGreaterThan(CHOSEN_BACK_RED_OVER_GREEN.floor);
    expect(red - green).toBeLessThan(CHOSEN_BACK_RED_OVER_GREEN.ceiling);
    expect(blue - green).toBeGreaterThan(CHOSEN_BACK_BLUE_OVER_GREEN.floor);
    expect(blue - green).toBeLessThan(CHOSEN_BACK_BLUE_OVER_GREEN.ceiling);
    expect(red).toBeGreaterThan(blue);
    // THE CONTROL: told the house kit, the same frame reads the house teal —
    // green over red within the house kit's own band — and matches the
    // product's own house back to within a byte or two.
    expect(houseGreen - houseRed).toBeGreaterThan(KIT_HUE_MARGIN);
    expect(houseBlue - houseRed).toBeGreaterThan(KIT_HUE_MARGIN);
    expect(houseGreen - houseRed).toBeLessThan(HOUSE_BACK_GREEN_OVER_RED_CEILING);
    for (const channel of [0, 1, 2]) {
      expect(Math.abs((kit.house[channel] ?? 0) - (kit.backs.rider[channel] ?? 255))).toBeLessThan(
        3,
      );
    }
    // #623's review (B1): on a ride the realistic rider is dressed ONLY by the
    // realistic drawing's constructor — `GameView` dresses a new view before its
    // first realistic render builds the drawing, and a step down and back builds
    // it again. The view dressed magenta while stepped down, then stepped back,
    // must read magenta's two bands; the house read above is the control that
    // the same square in the house kit reads otherwise.
    // @see KitMeasurement.dressedWithNoDrawing
    const dressed = kit.dressedWithNoDrawing;
    console.log(
      `#623: dressed while the view held no realistic drawing, then drawn ${JSON.stringify(dressed)}`,
    );
    expect(dressed).toHaveLength(3);
    const [dressedRed, dressedGreen, dressedBlue] = dressed as [number, number, number];
    expect(dressedRed - dressedGreen).toBeGreaterThan(CHOSEN_BACK_RED_OVER_GREEN.floor);
    expect(dressedRed - dressedGreen).toBeLessThan(CHOSEN_BACK_RED_OVER_GREEN.ceiling);
    expect(dressedBlue - dressedGreen).toBeGreaterThan(CHOSEN_BACK_BLUE_OVER_GREEN.floor);
    expect(dressedBlue - dressedGreen).toBeLessThan(CHOSEN_BACK_BLUE_OVER_GREEN.ceiling);
    // And the two are not one colour.
    expect(Math.abs(red - houseRed)).toBeGreaterThan(KIT_TINTS_APART);
  });

  test('turns the realistic rider’s legs with the cranks, and holds them when the cadence goes — #369, #349', async ({
    harnessRun,
  }) => {
    const measured = await realistic(harnessRun);
    expect(measured.crankTurnPixels).toBeGreaterThan(50);
    expect(measured.crankHeldPixels).toBe(0);
  });

  test('draws the distant hills between the ground and the sky, converging on the sky, with no hard edge — #544', async ({
    harnessRun,
  }) => {
    const measured = await realistic(harnessRun);
    const describe = (each: HorizonReading): string =>
      `${each.frame} ${String(each.offAxisDegrees)}°: sky ${each.sky.toFixed(4)}, ridge ` +
      `${each.ridge.toFixed(4)}, ground ${each.ground.toFixed(4)}, share ${shareOf(each).toFixed(2)}, ` +
      `crest ${crestContrast(each).toFixed(3)}:1, darkest above the relief ${each.darkestAboveRelief.toFixed(4)}`;
    console.log(
      `the distant hills — ${measured.horizon.map(describe).join('; ')} | control: ` +
        `${measured.horizonControl.map(describe).join('; ')}`,
    );
    expect(measured.horizon.length).toBe(4);
    expect(measured.horizonControl.length).toBe(4);
    for (const each of measured.horizon) {
      // A hill is darker than the sky it stands against and lighter than the
      // ground it is made of…
      expect(each.sky, describe(each)).toBeGreaterThan(each.ground);
      // …and nearer the sky: "converges on the sky's".
      expect(shareOf(each), describe(each)).toBeGreaterThan(CONVERGED_SHARE);
      expect(shareOf(each), describe(each)).toBeLessThanOrEqual(1);
      // No hard edge where the hill meets the sky.
      expect(crestContrast(each), describe(each)).toBeLessThanOrEqual(MAXIMUM_CREST_CONTRAST);
      // And above where the route's own relief would have put the crest there
      // is hill or sky, never the photograph's field and treeline — which are
      // darker than any lit ground in this world.
      expect(each.darkestAboveRelief, describe(each)).toBeGreaterThan(each.ground);
    }
    // …and none where it meets the fog: the ring's foot IS the fog's colour.
    expect(measured.horizonColours.foot).toEqual(measured.horizonColours.fog);
    // The control's fog and foot are the stylised world's own horizon — what
    // the owner saw — and not the photographed sky's.
    expect(measured.horizonControlExpected.length).toBe(3);
    expect(measured.horizonColoursControl.foot).toEqual(measured.horizonColoursControl.fog);
    measured.horizonControlExpected.forEach((channel, index) =>
      expect(measured.horizonColoursControl.fog[index]).toBeCloseTo(channel, 4),
    );
    expect(measured.horizonColoursControl.fog).not.toEqual(measured.horizonColours.fog);
    // The control is today's pale band, and it must fail where the owner saw
    // it fail: on the level, a ridge BRIGHTER than the sky behind it…
    const control = (frame: string): HorizonReading[] =>
      measured.horizonControl.filter((each) => each.frame === frame);
    for (const each of control('level')) {
      expect(shareOf(each), describe(each)).toBeGreaterThan(1);
    }
    // …and from the top of a descent, a pale ridge under the photograph's own
    // field and treeline: a hard edge.
    for (const each of control('descent')) {
      expect(crestContrast(each), describe(each)).toBeGreaterThan(MAXIMUM_CREST_CONTRAST);
      expect(each.darkestAboveRelief, describe(each)).toBeLessThan(each.ground);
    }
  });

  test('leans the fog towards the sky in the direction looked, and hazes a valley floor — #622', async ({
    harnessRun,
  }) => {
    const { air, atmosphere } = await realistic(harnessRun);
    const bytes = (rgb: readonly number[]): string =>
      rgb.map((channel) => (channel * 255).toFixed(1)).join('/');
    const shifted = (probe: { directional: readonly number[]; flattened: readonly number[] }) =>
      [0, 1, 2].map(
        (channel) => (probe.directional[channel] ?? 0) - (probe.flattened[channel] ?? 0),
      );
    console.log(
      `#622 air: fog factor ${air.fogFactor.toFixed(3)} (${air.fogFactorWithoutValley.toFixed(3)} ` +
        `without the valley's ×${air.valleyFactor.toFixed(3)}); towards the sun ${bytes(air.toward.directional)} ` +
        `(flattened ${bytes(air.toward.flattened)}, shift ${bytes(shifted(air.toward))} against ` +
        `${bytes(air.predictedToward)} predicted, fog ${bytes(air.fogToward)}); away ` +
        `${bytes(air.away.directional)} (flattened ${bytes(air.away.flattened)}, shift ` +
        `${bytes(shifted(air.away))} against ${bytes(air.predictedAway)} predicted, fog ${bytes(air.fogAway)}); ` +
        `valley off ${bytes(air.valleyOff)}, on ${bytes(air.toward.flattened)} against ` +
        `${bytes(air.valleyPredicted)} predicted; sky 30° up ${air.skyToward.toFixed(4)} towards the sun, ` +
        `${air.skyAway.toFixed(4)} away | materials: realistic ${String(atmosphere.realisticTaught)} taught, ` +
        `${String(atmosphere.realisticUntaught)} not, ${String(atmosphere.realisticShared)} shared; stylised ` +
        `${String(atmosphere.stylisedTaught)} of ${String(atmosphere.stylisedFogged)} taught`,
    );
    expect(air.measured).toBe(true);

    // ADR 0026 D-3: every mesh the realistic world fogs breathes its air but
    // the two materials both worlds share — the water (#629) and the riders'
    // contact shadows — and nothing the stylised world draws does.
    expect(atmosphere.realisticTaught).toBeGreaterThan(0);
    expect(atmosphere.realisticUntaught).toBe(0);
    expect(atmosphere.stylisedFogged).toBeGreaterThan(0);
    expect(atmosphere.stylisedTaught).toBe(0);

    // The CONTROL: with the table flattened to its mean, the probe with the
    // sun turned towards it and the one with the sun turned away agree — so
    // turning the sun changes nothing else on that pixel.
    for (let channel = 0; channel < 3; channel += 1) {
      const towards = air.toward.flattened[channel] ?? 0;
      const away = air.away.flattened[channel] ?? 0;
      expect(Math.abs(towards - away), `channel ${String(channel)}`).toBeLessThanOrEqual(
        AIR_CONTROL_AGREEMENT * Math.max(towards, away),
      );
    }

    // Each probe's directional shift is the one the table predicts at the
    // probe's depth — from BOTH sides, so a fog that leans too far fails as
    // surely as one that does not lean at all (#621's lesson).
    for (const [name, probe, predicted] of [
      ['towards the sun', air.toward, air.predictedToward],
      ['away from the sun', air.away, air.predictedAway],
    ] as const) {
      const measured = shifted(probe);
      for (let channel = 0; channel < 3; channel += 1) {
        const want = predicted[channel] ?? 0;
        expect(
          Math.abs((measured[channel] ?? 0) - want),
          `${name}, channel ${String(channel)}: ${bytes(measured)} against ${bytes(predicted)}`,
        ).toBeLessThanOrEqual(
          AIR_SHIFT_TOLERANCE.bytes / 255 + AIR_SHIFT_TOLERANCE.share * Math.abs(want),
        );
      }
    }
    // Not vacuous: the table leans the fog far enough at each probe that a
    // lean at half strength would fail the comparison above (AIR_SHIFT_FLOOR).
    for (const predicted of [air.predictedToward, air.predictedAway]) {
      expect(Math.max(...predicted.map(Math.abs))).toBeGreaterThan(AIR_SHIFT_FLOOR / 255);
    }
    // And the two probes differ in the direction the HDR's own band says: in
    // every channel where the band's two colours differ by more than a byte
    // at this fog, the drawn difference is that way round AND the size the
    // prediction says, from both sides (#621's lesson).
    //
    // ⚠️ The difference compared is each probe's SHIFT — its directional read
    // less its own flattened read — never the raw pixels (#703's review). The
    // raw pixels differ by about two bytes, which is less than the control
    // above allows the two frames' LIGHTING to differ (2 % of ~140 is 2.8), so
    // a lighting change the control accepts could flip or fake a raw sign on
    // its own: dimming the toward frame's direct light by a fifth (B11) did
    // not turn the control red. Fog mixes last and linearly, so a shift is
    // `f · (F_directional − F_flattened)` whatever lit the surface under it,
    // and the difference of two shifts carries no lighting at all.
    let compared = 0;
    for (let channel = 0; channel < 3; channel += 1) {
      const band = ((air.fogToward[channel] ?? 0) - (air.fogAway[channel] ?? 0)) * air.fogFactor;
      if (Math.abs(band) * 255 < 1) continue;
      compared += 1;
      const drawn =
        (air.toward.directional[channel] ?? 0) -
        (air.toward.flattened[channel] ?? 0) -
        ((air.away.directional[channel] ?? 0) - (air.away.flattened[channel] ?? 0));
      const want = (air.predictedToward[channel] ?? 0) - (air.predictedAway[channel] ?? 0);
      expect(Math.sign(drawn), `channel ${String(channel)}`).toBe(Math.sign(band));
      expect(
        Math.abs(drawn - want),
        `towards less away, channel ${String(channel)}: ${(drawn * 255).toFixed(2)} against ` +
          `${(want * 255).toFixed(2)} predicted`,
      ).toBeLessThanOrEqual(
        AIR_DIFFERENCE_TOLERANCE.bytes / 255 + AIR_DIFFERENCE_TOLERANCE.share * Math.abs(want),
      );
    }
    expect(compared).toBeGreaterThan(0);

    // The valley: the floor under a fog REALISTIC_VALLEY_HAZE times as dense,
    // predicted from the same pixel with the haze off, from both sides.
    expect(air.valleyFactor).toBeCloseTo(REALISTIC_VALLEY_HAZE, 6);
    for (let channel = 0; channel < 3; channel += 1) {
      const want = air.valleyPredicted[channel] ?? 0;
      const moved = want - (air.valleyOff[channel] ?? 0);
      expect(
        Math.abs((air.toward.flattened[channel] ?? 0) - want),
        `valley, channel ${String(channel)}`,
      ).toBeLessThanOrEqual(
        AIR_SHIFT_TOLERANCE.bytes / 255 + AIR_SHIFT_TOLERANCE.share * Math.abs(moved),
      );
    }
    expect(
      Math.max(
        ...[0, 1, 2].map((channel) =>
          Math.abs((air.valleyPredicted[channel] ?? 0) - (air.valleyOff[channel] ?? 0)),
        ),
      ),
    ).toBeGreaterThan(AIR_SHIFT_FLOOR / 255);

    // The sky the fog leans towards is the sky drawn: 30° up, the committed
    // photograph is about twice as bright on its sun's side, so the drawn sky
    // turned towards the world's sun must be brighter there than turned away.
    expect(air.skyToward).toBeGreaterThan(air.skyAway * SKY_SUN_SIDE_RATIO);
  });

  test('steps down to the stylised world whole, and publishes what realism costs', async ({
    harnessRun,
  }) => {
    const measured = await realistic(harnessRun);
    expect(measured.afterStepDownWorld).toBe('stylised');
    expect(measured.afterStepDownStandard).toBe(0);
    // #501's review: the bridge wore the loaded stone on the realistic rung —
    // `#applyWorld`'s one line nothing else here could see — and, the
    // control, gave it up with the rest of the realistic world.
    expect(measured.bridgesWearStone).toBe(true);
    expect(measured.bridgesWearStoneAfterStepDown).toBe(false);
    // Published, never asserted: SwiftShader on a desktop says nothing about a
    // Mali GPU. Validation 0002 Part Z is the tablet.
    console.log(
      `realistic world: loaded in ${measured.loadMs.toFixed(0)} ms; ` +
        `${measured.realisticFrameMs.toFixed(1)} ms a frame against ${measured.stylisedFrameMs.toFixed(1)} ms stylised ` +
        `(SwiftShader, not a phone); ${String(measured.drawCalls)} draw calls; scenery drawn ` +
        `${String(measured.sceneryDrawnTop)} at the top rung, ${String(measured.sceneryDrawnBudgeted)} ` +
        `at a budget of ${String(measured.sceneryProbeBudget)}; ${LENT_FRAMES_NOTE}`,
    );
  });
});

/**
 * #617's trees, in the realistic world, on a load of their own — #644.
 *
 * ⚠️ **These three cases read `?realistic&trees`, not `?realistic`**, and a
 * reviewer who remembers them in the describe above is reading the old file.
 * #617 put their probes inside the shared `?realistic` run, which took that
 * load from 33–48 s on the CI runner to past its 150 s budget and turned `main`
 * red. Moved whole: every assertion and control is unchanged. What a load of
 * their own owes that the shared one did not is the check that the realistic
 * world actually loaded ON IT — without `drawnWorld`, a page that fell back to
 * the stylised world would be measuring trees with no middle level at all.
 */
test.describe('the trees’ levels of detail in the realistic world — #617', () => {
  paysForTheLoad(TREES_QUERY, TREES_LOAD_BUDGET_MS);

  const trees = async (
    run: (query?: string) => Promise<HarnessRun>,
  ): Promise<TreeLevelMeasurement> => {
    const { result } = await run(TREES_QUERY);
    expect(result.errors).toEqual([]);
    expect(result.trees.measured).toBe(true);
    expect(result.trees.drawnWorld).toBe('realistic');
    return result.trees;
  };

  test('submits at least 60 000 fewer triangles with the trees’ middle level — #617', async ({
    harnessRun,
  }) => {
    const measured = await trees(harnessRun);
    console.log(
      `#617: ${String(measured.trianglesSubmitted)} triangles a frame, ` +
        `${String(measured.trianglesHardSwap)} with the hard swap; ` +
        `${String(measured.woodedScenery)} scenery items drawn in ${String(measured.drawCallsSubmitted)} draw calls`,
    );
    // Non-vacuity: a real frame with scenery in it, counted at the draw calls.
    expect(measured.woodedScenery).toBeGreaterThan(10);
    expect(measured.trianglesSubmitted).toBeGreaterThan(50_000);
    // The control is the same view with the six nearest trees full and no
    // middle level — what a frame drew before #617.
    expect(measured.trianglesHardSwap - measured.trianglesSubmitted).toBeGreaterThanOrEqual(
      TRIANGLES_FALL_AT_LEAST,
    );
  });

  test('draws the wooded view in at most 35 calls, into the same picture — #639', async ({
    harnessRun,
  }) => {
    const measured = await trees(harnessRun);
    console.log(
      `#639: the wooded view makes ${String(measured.drawCallsSubmitted)} draw calls ` +
        `(${String(measured.trianglesSubmitted)} triangles); from a world loaded one part a ` +
        `material, as before #639, ${String(measured.drawCallsUnmerged)} ` +
        `(${String(measured.trianglesUnmerged)} triangles); ${String(measured.unmergedPixelsChanged)} ` +
        `of ${String(measured.pixelsCompared)} pixels differ`,
    );
    // Non-vacuity: a real frame with scenery in it, counted at the draw calls.
    expect(measured.woodedScenery).toBeGreaterThan(10);
    expect(measured.drawCallsSubmitted).toBeGreaterThan(0);
    expect(measured.drawCallsSubmitted).toBeLessThanOrEqual(REALISTIC_WOODED_DRAW_CALLS);
    // THE CONTROL: the same frame from a world loaded one part a material, as
    // every load was before #639, must be OVER the ceiling — so the count
    // above is a count of merged trees, not of a frame that happened to hold
    // few. The same triangles, so the saving is calls and not geometry…
    expect(measured.drawCallsUnmerged).toBeGreaterThan(REALISTIC_WOODED_DRAW_CALLS);
    expect(measured.trianglesUnmerged).toBe(measured.trianglesSubmitted);
    // …and the same picture: the layers are read as the materials were.
    expect(measured.pixelsCompared).toBe(640 * 360);
    expect(measured.unmergedPixelsChanged).toBeLessThanOrEqual(MERGED_PIXELS_CHANGED);
  });

  test('hands a tree over between levels with no jump in the picture — #617', async ({
    harnessRun,
  }) => {
    const measured = await trees(harnessRun);
    // Band B — middle and impostor — as the seventh tree beside the road walks
    // out past the watched one (the control's swap is at the fifth, since it
    // has no band), and band A — full and middle — as the first does.
    // @see treeLevelProbe
    const bands = [
      { name: 'B', from: 0.5, to: 4 },
      { name: 'A', from: 5.5, to: 8 },
    ] as const;
    // Non-vacuity: the seven trees beside the road are not in the picture, so
    // what changes in it is the watched tree…
    expect(measured.handOverOffScreenCovered).toBe(0);
    // …which is on screen in every frame.
    expect(Math.min(...measured.handOver.covered)).toBeGreaterThan(200);
    console.log(
      `#617: colour moved a frame ${JSON.stringify(measured.handOver.changed)} dithered, ` +
        `${JSON.stringify(measured.handOverControl.changed)} with the hard swap; covered ` +
        `${JSON.stringify(measured.handOver.covered)} / ${JSON.stringify(measured.handOverControl.covered)}`,
    );
    // The product's largest one-frame change ANYWHERE in the ride, not only in
    // the windows: every frame outside a hand-over moves nothing, so this
    // costs nothing and does not rest on where the windows were drawn.
    const anywhere = largestMove(measured.handOver, -Infinity, Infinity);
    let smallestSwap = Infinity;
    for (const band of bands) {
      const product = largestMove(measured.handOver, band.from, band.to);
      const control = largestMove(measured.handOverControl, band.from, band.to);
      const walked = movesWithin(measured.handOver, band.from, band.to);
      console.log(
        `#617: band ${band.name}: the largest one-frame change in the picture is ` +
          `${String(product.moved)} dithered (at ${product.out.toFixed(1)} m), ` +
          `${String(control.moved)} with the hard swap (at ${control.out.toFixed(1)} m), ` +
          `${(100 * (product.moved / Math.max(1, control.moved))).toFixed(1)} % of it; ` +
          `${String(walked.total)} in all over ${String(walked.frames)} frames`,
      );
      // The control swaps the tree whole in one frame, at THIS band — so each
      // band is shown to be crossed, not only one…
      expect(control.moved, `band ${band.name}`).toBeGreaterThan(MINIMUM_SWAP_MOVE);
      smallestSwap = Math.min(smallestSwap, control.moved);
      // …and the product DOES hand over there — a product that never changed
      // level would move nothing and pass the bound below — spread over
      // several frames rather than one.
      expect(walked.total, `band ${band.name}`).toBeGreaterThan(0.5 * control.moved);
      expect(walked.frames, `band ${band.name}`).toBeGreaterThanOrEqual(3);
    }
    expect(anywhere.moved).toBeLessThanOrEqual(MAXIMUM_HAND_OVER_SHARE * smallestSwap);
    // And it arrives where the swap does: the same tree covering the same
    // pixels at the start and at the end — the impostor first, the full mesh last.
    expect(measured.handOver.covered[0]).toBe(measured.handOverControl.covered[0]);
    expect(measured.handOver.covered.at(-1)).toBe(measured.handOverControl.covered.at(-1));
    expect(measured.handOver.covered.at(-1)).not.toBe(measured.handOver.covered[0]);
  });

  test('draws the nearest tree IN THE PICTURE at full detail — #617’s review', async ({
    harnessRun,
  }) => {
    const measured = await trees(harnessRun);
    console.log(
      `#617: a tree 12 m ahead, with two behind the camera, adds ` +
        `${String(measured.nearestVisibleTriangles)} triangles; ` +
        `${String(measured.nearestVisibleTrianglesControl)} ranked as before the review`,
    );
    // It is the full mesh — 24 000 to 28 000 triangles — and nothing else
    // moves: the two behind the camera are impostors either way.
    expect(measured.nearestVisibleTriangles).toBeGreaterThan(20_000);
    // The control: ranked with the two behind the camera it is NOT the full
    // mesh alone. It lands in band A (full and middle) and pushes the 14 m
    // tree behind the camera from the band's full mesh down to the middle
    // level, so the frame gains about 12 000 — measured 11 980 on
    // 2026-09-26 — where the product's gains a whole full tree.
    expect(measured.nearestVisibleTrianglesControl).toBeGreaterThan(1_000);
    expect(
      measured.nearestVisibleTriangles - measured.nearestVisibleTrianglesControl,
    ).toBeGreaterThan(10_000);
  });
});

/**
 * How many of the wooded frame's pixels may differ between the product's trees
 * and the same trees loaded one part a material, as before #639: **none**. The
 * layered shader reads each layer's own maps, factor and normal scale through
 * explicit gradients scaled by the rung's bias, which is the level of detail
 * `texture(s, uv, bias)` picks; SwiftShader drew the two frames identically
 * on 2026-09-28.
 */
const MERGED_PIXELS_CHANGED = 0;

/**
 * The least #617's middle level must take off the wooded view's frame, against
 * the same view drawn as before it: **60 000** triangles — the issue's own
 * figure, which `realistic-budget.test.ts` also holds the worst case to.
 */
const TRIANGLES_FALL_AT_LEAST = 60_000;

/**
 * The most the picture may change in one frame of a hand-over, as a share of
 * how much it changes in the one frame the hard swap takes: **0.2**. #617's
 * "no single-frame jump", stated as a number, and measured against the swap
 * itself so it holds for band B too — where the middle mesh and the impostor
 * cover much the same pixels in different colours, which a covered-area count
 * cannot see (it measured 2.5 % a frame dithered AND swapped).
 *
 * Measured on 2026-09-26 in the pinned Chromium, with the rest of the picture
 * still (every frame outside a hand-over moves nothing at all): band B
 * **10.5 %** (12 642 against 120 906), band A **12.1 %** (11 601 against
 * 95 689). The dithered hand-over takes ten frames either way, and the swap
 * one. A little under twice the larger: a middle level drawn whole across band
 * B, not dithered, measured 22.7 % and fails it.
 *
 * ⚠️ Until #617's review this was 8 % of a tree's COVERED AREA, measured as
 * the tree moved; a reviewer who remembers that is reading the old file.
 *
 * ⚠️ **It is a bound from above, and a bound from above passes a product
 * that never hands over at all** — the second review measured exactly that
 * (a pace of nought: nothing moved in 91 frames, and the case was green). So
 * since then the case also holds the product to a FLOOR in each band — its
 * summed change at least half the swap's, over three frames or more — and to
 * the swap's own covered area at both ends, and this bound is taken over
 * every frame against the smaller swap (12 642 against 95 689, 13.2 %).
 */
const MAXIMUM_HAND_OVER_SHARE = 0.2;

/**
 * The least the hard swap must move the picture in one frame for the control
 * to be a swap at all: summed absolute 8-bit differences over every channel,
 * **50 000** — measured 95 689 and 120 906 on 2026-09-26, about half the
 * smaller.
 */
const MINIMUM_SWAP_MOVE = 50_000;

/**
 * How much the picture changed in all across the frames whose other trees
 * have walked out `from` to `to` metres, and in how many of them it changed
 * at all — what a hand-over that happened has and one that never did has not.
 */
function movesWithin(
  handOver: TreeHandOver,
  from: number,
  to: number,
): { readonly total: number; readonly frames: number } {
  let total = 0;
  let frames = 0;
  for (let at = 1; at < handOver.changed.length; at += 1) {
    const where = handOver.out[at] ?? Number.NaN;
    if (!(where >= from && where < to)) continue;
    const step = handOver.changed[at] ?? 0;
    total += step;
    if (step > 0) frames += 1;
  }
  return { total, frames };
}

/**
 * The largest frame-to-frame change in the picture across a hand-over, and
 * where — over the frames whose other trees have walked out `from` to `to`
 * metres.
 */
function largestMove(
  handOver: TreeHandOver,
  from: number,
  to: number,
): { readonly moved: number; readonly out: number } {
  let moved = 0;
  let out = Number.NaN;
  for (let at = 1; at < handOver.changed.length; at += 1) {
    const where = handOver.out[at] ?? Number.NaN;
    if (!(where >= from && where < to)) continue;
    const step = handOver.changed[at] ?? 0;
    if (step > moved) {
      moved = step;
      out = where;
    }
  }
  return { moved, out };
}

/**
 * How far the two #622 probes may differ with the direction table flattened —
 * the sun turned towards the point and away from it, at the same elevation:
 * **2 %** of the brighter, per channel, #622's own control figure. The road
 * there is lit as facing straight up, so the turn should change nothing.
 */
const AIR_CONTROL_AGREEMENT = 0.02;

/**
 * How far a #622 probe's drawn shift may stand from the predicted one: **1.5
 * bytes plus a tenth of the prediction**, per channel. The bytes are the
 * read-back's own quantisation: a shift is the difference of two 3 × 3 means.
 *
 * ⚠️ **A tenth, not the quarter #703 shipped with (#708), and the tenth is
 * measured rather than chosen.** The largest residual on the unmutated build is
 * **0.3 bytes** (towards the sun, channel 2: 3.8 drawn against 3.5 predicted;
 * the valley's worst is 0.2). Three local runs printed identical figures, and
 * #708's CI run (36374305671) read every shift within 0.1 byte of them with
 * the same 0.3 worst — so the fixed part alone covers the residual five times
 * over and the share is headroom, not the fit. At a quarter
 * a fog leaning at HALF strength missed by 3.64 bytes against a bound of 3.30
 * on one channel of six and passed the other five: #621's lesson from below.
 * At a tenth the same mutation misses channels 0 and 1 towards the sun and
 * channel 0 away by about 1.4, 1.0 and 0.7 bytes past their bounds (3.64
 * against 2.22 the worst), and a fog leaning TWICE as far misses by 7.4
 * against 2.22. Loosen this only with a residual measured past the fixed part.
 */
const AIR_SHIFT_TOLERANCE = { bytes: 1.5, share: 0.1 } as const;

/**
 * How far, as a share of the prediction, an effect drawn at HALF strength
 * misses it: **0.5**. The mutation {@link AIR_SHIFT_FLOOR} is sized against.
 */
const HALVED_EFFECT_MISS = 0.5;

/**
 * How far the drawn difference between the two #622 probes' shifts — towards
 * the sun less away from it — may stand from the predicted one: **0.75 bytes
 * plus a quarter of the prediction**, per channel. Tighter in bytes than
 * {@link AIR_SHIFT_TOLERANCE} because a difference of two shifts is ~1.6 bytes
 * where the band is compared at all, and a bound of 1.5 bytes around that would
 * admit the wrong sign. The CI runner read 1.5/1.8 against 1.6/1.6 predicted
 * (#703, run 36368471971), so the margin is about four times what it used.
 */
const AIR_DIFFERENCE_TOLERANCE = { bytes: 0.75, share: 0.25 } as const;

/**
 * The least a #622 prediction must move a pixel for its comparison to mean
 * anything: **4 bytes today, derived rather than typed (#711's review).**
 *
 * The comparison is `|drawn − predicted| ≤ bytes + share · |predicted|`. A
 * build whose effect is scaled by `k` draws `k · predicted`, and misses by
 * `|1 − k| · |predicted|`; that is past the bound only once
 * `|predicted| > bytes / (|1 − k| − share)`. The floor is that threshold for
 * an effect at HALF strength — `ceil(1.5 / (0.5 − 0.1)) = ceil(3.75) = 4` —
 * so a green floor says the largest prediction is big enough for a halved fog
 * lean (or a halved valley haze, which the valley check holds to the same
 * tolerance and the same floor) to fail somewhere, not merely an absent one.
 * The 3 bytes typed here before proved only the latter. Tightening or
 * loosening {@link AIR_SHIFT_TOLERANCE} moves this with it.
 */
const AIR_SHIFT_FLOOR = Math.ceil(
  AIR_SHIFT_TOLERANCE.bytes / (HALVED_EFFECT_MISS - AIR_SHIFT_TOLERANCE.share),
);

/**
 * How much brighter the drawn sky 30° up must be with the world's sun behind
 * it than with the sun turned away: **1.3 ×**. The committed photograph reads
 * 1.44 against 0.67 there (off the file, 2026-09-27); after the tone map the
 * ratio shrinks, and 1.3 is under what AgX leaves of it but far over what a
 * sky turned the wrong way round would give — darker towards the sun.
 */
const SKY_SUN_SIDE_RATIO = 1.3;

/**
 * How far from the ground toward the sky a distant ridge must be drawn, as a
 * share of the luminance between them: **more than 0.5**, so it is nearer the
 * sky's — #544's "converges on the sky's". Measured 0.57 to 0.78 across the
 * four columns on 2026-09-26, and 1.53 to 1.63 on the level in the control
 * (brighter than the sky: the pale band).
 */
const CONVERGED_SHARE = 0.5;

/**
 * The most contrast there may be across a distant ridge's crest, as a WCAG 2.2
 * ratio of the sky 4 to 9 pixels above it and the ridge 4 to 9 below: **1.35**
 * — #544's "no hard straight edge", stated as a number. Measured 1.10 to 1.28
 * on 2026-09-26, against 4.3 to 4.8 in the control from the top of a descent,
 * where the pale ridge stood under the photograph's dark treeline. For scale,
 * WCAG asks 3:1 of a boundary that must be SEEN; 1.35 is well under it.
 */
const MAXIMUM_CREST_CONTRAST = 1.35;

/**
 * Where a ridge's luminance lies between the ground's and the sky's behind it
 * — #544: 0 is the ground's own, 1 the sky's, above 1 brighter than the sky.
 */
function shareOf(reading: HorizonReading): number {
  return (reading.ridge - reading.ground) / (reading.sky - reading.ground);
}

/** The WCAG 2.2 contrast ratio across a ridge's crest. */
function crestContrast(reading: HorizonReading): number {
  const [light, dark] = [
    Math.max(reading.sky, reading.ridge),
    Math.min(reading.sky, reading.ridge),
  ];
  return (light + 0.05) / (dark + 0.05);
}
