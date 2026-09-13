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

import { expect, test } from '@playwright/test';

import { HARNESS_ORIGIN } from '../playwright.config';

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
  };
  readonly skyPixel: Pixel;
  readonly groundPixel: Pixel;
  readonly roadPixel: Pixel;
  readonly roadFarPixel: Pixel;
  readonly resourcesAfterFirstFrame: number;
  readonly resourcesAfterAllFrames: number;
  readonly centreLinePixel: Pixel;
  readonly roadBesidePixel: Pixel;
  readonly centreLineRowFraction: number;
  readonly roadOnDescentPixel: Pixel;
  readonly errors: readonly string[];
}

/** How many frames the harness drives. Mirrors `FRAMES` in `game-harness.ts`. */
const FRAMES = 100;

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

async function harness(page: import('@playwright/test').Page): Promise<GameHarnessResult> {
  await page.goto(`${HARNESS_ORIGIN}/game.html`);
  // The harness publishes synchronously at the end of `run()`, so waiting on the
  // property existing is waiting on the module having executed — not on a timer.
  await page.waitForFunction(() => window.__oylGameHarness !== undefined);
  return page.evaluate(() => window.__oylGameHarness as GameHarnessResult);
}

test.describe('the game renderer in a real browser', () => {
  test('constructs against a live WebGL context', async ({ page }) => {
    const result = await harness(page);

    expect(result.errors).toEqual([]);
    expect(result.created).toBe(true);
    // The claim jsdom cannot make. If SwiftShader ever stops giving the runner a
    // context this goes red, which is the right outcome: a renderer nobody can
    // construct is not a renderer that works.
    expect(result.hasContext).toBe(true);
  });

  test('accepts the geometry terrain.ts builds', async ({ page }) => {
    const result = await harness(page);

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

  test('draws the road itself at the centre of the frame', async ({ page }) => {
    const result = await harness(page);

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

  test('survives its buffers being reused across frames', async ({ page }) => {
    // A hundred frames, because the renderer reuses and only grows its vertex
    // buffer. A single-frame harness cannot see a reuse bug at all.
    const result = await harness(page);

    expect(result.framesDrawn).toBe(FRAMES);
    expect(result.errors).toEqual([]);
  });

  test('places the rider and the bot on the road', async ({ page }) => {
    const result = await harness(page);

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
  test('draws a sky above the horizon, where the clear colour used to be', async ({ page }) => {
    const result = await harness(page);

    expect(isClearColour(result.skyPixel)).toBe(false);
  });

  test('draws ground beside the road, where the clear colour used to be', async ({ page }) => {
    const result = await harness(page);

    expect(isClearColour(result.groundPixel)).toBe(false);
  });

  test('draws a sky and a ground that are not the same thing', async ({ page }) => {
    // A renderer that painted one flat colour over the whole frame would pass
    // both tests above and fail this one. There has to be a horizon.
    const result = await harness(page);

    expect(result.skyPixel.slice(0, 3)).not.toEqual(result.groundPixel.slice(0, 3));
  });

  test('puts the derived colours on the screen, not an arbitrary pair', async ({ page }) => {
    // Asserted as channel ORDERING rather than as values, deliberately. Every
    // step between `world.ts` and a read-back byte — colour management, the
    // output transfer function, the fog blend — is monotone per channel, so an
    // ordering survives all of them where an exact value does not. `world.ts`
    // makes the sky blue-dominant at every latitude and altitude, and the
    // harness route is temperate and near sea level, so its ground is
    // vegetation and green-dominant.
    const result = await harness(page);
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
  test('fades the distant road, rather than drawing it at full strength', async ({ page }) => {
    const result = await harness(page);

    // Non-vacuity first: with no fog to apply there is nothing here to see,
    // and this test would be asserting that two different surfaces differ.
    expect(result.world.fogDensity).toBeGreaterThan(0);
    expect(result.roadFarPixel.slice(0, 3)).not.toEqual(result.roadPixel.slice(0, 3));
  });

  test('fades it toward the horizon colour the route derived, not an arbitrary one', async ({
    page,
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
    const result = await harness(page);
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

  test('allocates nothing new on the GPU after the first frame', async ({ page }) => {
    // #240's NFR-3, measured with three's own allocations rather than with
    // object identity: a renderer that rebuilt the ground mesh every frame
    // would create a buffer every frame, and this count would rise by 99.
    const result = await harness(page);

    expect(result.resourcesAfterFirstFrame).toBeGreaterThan(0);
    expect(result.resourcesAfterAllFrames).toBe(result.resourcesAfterFirstFrame);
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
  test('draws a centre line that the carriageway beside it does not have', async ({ page }) => {
    const result = await harness(page);
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
    page,
  }) => {
    // The luminance half of #242's accessibility argument, at the screen
    // rather than at the constants: a marking a rider cannot pick out in
    // sunlight is not a marking. `terrain.test.ts` asserts the contrast ratio
    // the colours have; this asserts the direction survived the pipeline.
    const result = await harness(page);
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
  test('still draws the whole road in one call', async ({ page }) => {
    const result = await harness(page);

    expect(result.drawCallsPerFrame).toBe(4);
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
  test('draws the descent brighter than the climb', async ({ page }) => {
    const result = await harness(page);
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
