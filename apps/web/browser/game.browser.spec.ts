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

/** What `game-harness.ts` publishes. Mirrored rather than imported — see below. */
interface GameHarnessResult {
  readonly created: boolean;
  readonly hasContext: boolean;
  readonly framesDrawn: number;
  readonly drewPixels: boolean;
  readonly quadCount: number;
  readonly vertexCount: number;
  readonly markerKinds: readonly string[];
  readonly skyPixel: readonly [number, number, number, number];
  readonly groundPixel: readonly [number, number, number, number];
  readonly roadPixel: readonly [number, number, number, number];
  readonly resourcesAfterFirstFrame: number;
  readonly resourcesAfterAllFrames: number;
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
 */
function isClearColour(pixel: readonly [number, number, number, number]): boolean {
  return pixel[0] === 0 && pixel[1] === 0 && pixel[2] === 0;
}

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
    expect(result.quadCount).toBeGreaterThan(0);
    expect(result.vertexCount).toBe((result.quadCount + 1) * 6);
  });

  test('draws a frame, rather than merely returning from render()', async ({ page }) => {
    const result = await harness(page);

    expect(result.framesDrawn).toBe(FRAMES);
    // Read back from the drawing buffer. `render` not throwing is a weaker claim
    // and is the one a harness gets for free.
    expect(result.drewPixels).toBe(true);
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

  test('allocates nothing new on the GPU after the first frame', async ({ page }) => {
    // #240's NFR-3, measured with three's own allocations rather than with
    // object identity: a renderer that rebuilt the ground mesh every frame
    // would create a buffer every frame, and this count would rise by 99.
    const result = await harness(page);

    expect(result.resourcesAfterFirstFrame).toBeGreaterThan(0);
    expect(result.resourcesAfterAllFrames).toBe(result.resourcesAfterFirstFrame);
  });
});
