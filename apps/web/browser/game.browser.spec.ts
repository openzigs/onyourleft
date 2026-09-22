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

import { test as base, devices, expect } from '@playwright/test';

import { HARNESS_ORIGIN } from '../playwright.config';
import { MINIMUM_RIDER_FRAME_SHARE, riderFrameBox } from '../src/game/camera';

import type { RealisticMeasurement, RiderExtent } from './game-harness';
import { MINIMUM_TINT_CONTRAST_RATIO } from '../src/game/terrain';

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
  };
  /** ADR 0026 — measured only by the `?realistic` load. */
  readonly realistic: RealisticMeasurement;
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
 * What one frame of the harness route costs, with the scenery taken out: **7**.
 *
 * | | calls |
 * |---|--:|
 * | the ground beside the road, lit — a landform since #458 (was one flat quad) | 1 |
 * | the hills on the horizon (#458) | 1 |
 * | the sky's gradient (#425) | 1 |
 * | the road, however many marks and edge lines it carries (#242) | 1 |
 * | every rider's merged body and bicycle, instanced (#349, #368) | 1 |
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
 */
const SCENE_DRAW_CALLS = 1 + 1 + 1 + 1 + 3 + 1;

/**
 * The most meshes the scenery belt may ever hold: **20**.
 *
 * | kind | shapes |
 * |---|--:|
 * | `tree-broadleaf`, `tree-conifer`, `shrub`, `rock` | 2 each |
 * | `building` | 3 |
 * | `post`, which ADR 0022 D-3 leaves procedural | 1 |
 * | `barn`, `church`, `shop-row`, `shed` — #460, built from numbers | 1 each |
 * | `wall`, `hedge`, `fence`, `signpost` — #460, built from numbers | 1 each |
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
const SCATTER_MESH_CEILING = 4 * 2 + 3 + 1 + 4 + 4;

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
 * than 13. A green run pays two loads — the plain page and `?shadow-map` — and
 * nothing here retries a load that failed, which is the flake-hiding
 * `playwright.config.ts` refuses.
 */
const test = base.extend<object, { harnessRun: (query?: string) => Promise<HarnessRun> }>({
  harnessRun: [
    async ({ browser }, use) => {
      const runs = new Map<string, Promise<HarnessRun>>();
      const load = async (query: string): Promise<HarnessRun> => {
        const context = await browser.newContext(DESKTOP_CHROME);
        try {
          const page = await context.newPage();
          const requested: string[] = [];
          page.on('request', (request) => requested.push(request.url()));
          await page.goto(`${HARNESS_ORIGIN}/game.html${query}`);
          // The harness publishes at the end of `run()` and nowhere else, so
          // waiting on the property existing is waiting on the run having
          // finished — not on a timer. ⚠️ Since #341 that run is
          // **asynchronous**: it awaits the scenery models before it creates
          // anything, exactly as `main.tsx` does.
          await page.waitForFunction(() => window.__oylGameHarness !== undefined);
          const result = await page.evaluate(() => window.__oylGameHarness as GameHarnessResult);
          return { result, requested };
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

/** The shared run's result, which is all but one case in this file reads. */
async function harness(
  run: (query?: string) => Promise<HarnessRun>,
  query = '',
): Promise<GameHarnessResult> {
  return (await run(query)).result;
}

test.describe('the game renderer in a real browser', () => {
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
});

/**
 * #460 — places, not houses. `game-harness.ts` §`settlementProbe` draws a
 * village and its fields and times the frame with and without them.
 */
test.describe('a village and its fields — #460', () => {
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
      `render scale unchanged`;
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
    // says nothing about a phone, which is why the rung is off by default and
    // `docs/validation/0002-android-shell-and-game.md` Part T is the procedure
    // that decides it. What is asserted is only that there WAS a measurement:
    // a shadow reached the buffer, and the rung drew its shadow pass.
    const map = result.shadowMap;
    expect(map.measured).toBe(true);
    expect(map.shadowPixels).toBeGreaterThan(0);
    expect(map.mapDrawCalls).toBeGreaterThan(map.contactDrawCalls);
    expect(map.contactFrameMs).toBeGreaterThan(0);
    expect(map.mapFrameMs).toBeGreaterThan(0);
    const mapCost = map.mapFrameMs - map.contactFrameMs;
    const shadowMeasured =
      `contact ${map.contactFrameMs.toFixed(3)} ms (${String(map.contactDrawCalls)} calls, rider alone), ` +
      `shadow map ${map.mapFrameMs.toFixed(3)} ms (${String(map.mapDrawCalls)} calls), ` +
      `difference ${mapCost >= 0 ? '+' : ''}${mapCost.toFixed(3)} ms a frame, against a ` +
      `same-rung spread of ${map.noiseMs.toFixed(3)} ms; ${String(map.shadowPixels)} px darkened ` +
      `by the map under the rider alone`;
    testInfo.annotations.push({
      type: 'frame cost of the rider shadow map',
      description: shadowMeasured,
    });
    console.log(`frame cost of the rider shadow map — ${shadowMeasured}`);
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

  test('costs three draw calls rather than the twenty its parts would', async ({ harnessRun }) => {
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
    // `instanceColor` multiplying: a tint can only ever darken the rider's own
    // palette towards itself, so no tint can wash a mostly-blue palette out
    // into a pale grey. What is available is hue and value, and they land on
    // the two pairs differently.
    //
    // **Bot against the other two: HUE.** Its orange is the only tint that
    // suppresses blue, so it is the only one of the three whose red channel
    // leads. Stated as an ordering for the reason the rest of this file uses
    // them — every step between a colour and a read-back byte is monotone per
    // channel, so an ordering survives where a value does not.
    expect(bot?.[0] ?? 0).toBeGreaterThan(bot?.[2] ?? 255);
    expect(rider?.[2] ?? 0).toBeGreaterThan(rider?.[0] ?? 255);
    expect(ghost?.[2] ?? 0).toBeGreaterThan(ghost?.[0] ?? 255);

    // **Rider against ghost: VALUE.** Both lead on blue, because the rider's
    // jersey is blue and the ghost's cool grey cannot take that away. What
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
 * The realistic world, in a real engine — ADR 0026, #425, #474, #369.
 *
 * ⚠️ **One page load for all of it** (#456's memo, `?realistic`): the realistic
 * set is about 31 MiB and a prefiltered sky, and every case here reads the one
 * run `game-harness.ts` §`realisticProbe` makes. The default load is the
 * other half of D-7 and is asserted below too: it fetches none of the set.
 */
test.describe('the realistic world — ADR 0026', () => {
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
    // The criterion, read off the drawing buffer: the tint still separates the
    // steepest climb from the steepest descent over the photographic road.
    expect(measured.descentLuminance).toBeGreaterThan(measured.climbLuminance);
    expect(contrast(measured.climbLuminance, measured.descentLuminance)).toBeGreaterThanOrEqual(
      MINIMUM_TINT_CONTRAST_RATIO,
    );
    // The control: the same probe on two level roads reads alike, so what was
    // measured above is the tint and not where the probe landed.
    expect(contrast(measured.levelClimbLuminance, measured.levelDescentLuminance)).toBeLessThan(
      1.05,
    );
    // And the photograph reached the GPU: this world samples textures.
    expect(measured.texturesCreated).toBeGreaterThan(5);
  });

  test('turns the realistic rider’s legs with the cranks, and holds them when the cadence goes — #369, #349', async ({
    harnessRun,
  }) => {
    const measured = await realistic(harnessRun);
    expect(measured.crankTurnPixels).toBeGreaterThan(50);
    expect(measured.crankHeldPixels).toBe(0);
  });

  test('steps down to the stylised world whole, and publishes what realism costs', async ({
    harnessRun,
  }) => {
    const measured = await realistic(harnessRun);
    expect(measured.afterStepDownWorld).toBe('stylised');
    expect(measured.afterStepDownStandard).toBe(0);
    // Published, never asserted: SwiftShader on a desktop says nothing about a
    // Mali GPU. Validation 0002 Part Z is the tablet.
    console.log(
      `realistic world: loaded in ${measured.loadMs.toFixed(0)} ms; ` +
        `${measured.realisticFrameMs.toFixed(1)} ms a frame against ${measured.stylisedFrameMs.toFixed(1)} ms stylised ` +
        `(SwiftShader, not a phone); ${String(measured.drawCalls)} draw calls; scenery drawn ` +
        `${String(measured.sceneryDrawnTop)} at the top rung, ${String(measured.sceneryDrawnBudgeted)} ` +
        `at a budget of ${String(measured.sceneryProbeBudget)}`,
    );
  });
});
