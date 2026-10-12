// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The owner's realistic page's instruments, in the pinned Chromium — #616.
 *
 * `realistic.html` is NOT a gate (`realistic-harness.ts` says so): its numbers
 * come from the tablet's GPU. What IS checkable here is that the instruments
 * #615 reads on the tablet measure what they claim to:
 *
 * 1. **The triangle counter** — counted at the WebGL draw calls
 *    (`realistic/draws.ts`) — agrees with three's own
 *    `renderer.info.render.triangles` for the same frame, within 1 %.
 * 2. **The layer switch** (`realistic/layers.ts`) placed every object in the
 *    real view's scene, and every layer it can switch holds something there.
 * 3. **The control**: the same frame with `?layers=-vegetation` counts at least
 *    100 000 fewer triangles. Without it, a counter returning a constant — or a
 *    switch that hid nothing — would pass (1) and (2) untouched.
 *
 * Both loads hold the rider still (`at=`) and the ladder still (`ladder=0`), so
 * the two frames are the same frame bar the one layer: the rung, the camera
 * and the scenery's placement do not move between them.
 *
 * And since #1283, a fourth: **the tree levers**. `?levers=-generated-trees`
 * loads every tree's scan INSTEAD of the generated ones, and since #1294
 * `?levers=-generated-conifers` the scanned firs alone — read off the files
 * the page fetches, so a lever that changed a label and loaded the same trees
 * is seen — with each frame's triangles and draw calls printed, which are the
 * figures validation 0002's #1283 and #1294 rows start from.
 *
 * ⚠️ **What it does not prove**: anything about the tablet's GPU clock, which
 * is what the switch is FOR — that is validation 0002's Part for #616, run by
 * the owner. And it holds only the vegetation to a number; the other six
 * layers are held to "placed, and not empty" and to `layers.test.ts`.
 */

import { expect, test, type Page } from '@playwright/test';

import {
  REALISTIC_BROADLEAVES,
  REALISTIC_CONIFERS,
  type RealisticModel,
} from '../src/game/realistic-assets';
import { REALISTIC_WOODED_DRAW_CALLS } from '../src/game/realistic-budget';

import { NIGHTLY } from './nightly';
import { LAYERS } from './realistic/config';
import type { RealisticSample } from './realistic-harness';

/** A realistic load's budget: the same 31 MiB `game.browser.spec.ts` §#607 pays for. */
const REALISTIC_LOAD_BUDGET_MS = 150_000;

/** The route's default start, held still: a stretch with trees on it. */
const HELD = '?ladder=0&panel=0&seconds=1&at=2550';

/** How far the draw-call count and three's may differ on one frame (#616). */
const AGREEMENT = 0.01;

/**
 * The least #616's control must remove: a counter that reports a constant
 * removes none.
 *
 * ⚠️ **It was 100 000 until #1294, and a reviewer who remembers that is
 * reading the scanned firs' figure.** The vegetation on this frame was about
 * 156 700 triangles while its firs were scans of 24 000 each; with the
 * generated firs it is 92 666 (131 684 against 39 018, 2026-10-12), which is
 * the point of generating them. 60 000 is still two thirds of the layer.
 */
const VEGETATION_AT_LEAST = 60_000;

/**
 * The most draw calls the owner's page may REPORT held at `at=2550` with the
 * trees a ride draws: **33**, the figure #1289 left it at with two seeds a
 * species, two under `REALISTIC_WOODED_DRAW_CALLS`.
 *
 * **This is the figure #1294's criterion names**: "at or under 33 at
 * `at=2550`" is the page's own `drawCalls`, a mean over its window. It is
 * asserted, and so is the frame's own count below.
 */
const PAGE_DRAW_CALLS_AT_2550 = 33;

/**
 * What one held frame at `at=2550` makes, counted at the WebGL draw calls:
 * **31**, with the generated firs and with the scanned ones alike (two shapes
 * stand where two stood, and they add no call), on a Mac and on the CI runner,
 * 2026-10-12. Held at the measured figure, so one added call is a red test
 * and not two calls of room under {@link PAGE_DRAW_CALLS_AT_2550}.
 *
 * ⚠️ **The page's mean read 32 to 35 for this frame until #1294**, because
 * its window also held the warm-up and the page's first render, which makes
 * 60 calls (`realistic-harness.ts` §`RealisticSample.drawCalls`). The window
 * now starts where the warm-up ends, so a held frame's mean IS its count, and
 * the test below holds the two equal.
 */
const FRAME_DRAW_CALLS_AT_2550 = 31;

type Published = NonNullable<Window['__oylRealistic']>;

async function ride(
  page: Page,
  query: string,
): Promise<{ result: RealisticSample; page: Published }> {
  const response = await page.goto(`/realistic.html${query}`);
  expect(
    response?.status(),
    'realistic.html did not load — is it named in vite.browser.config.ts build.rollupOptions.input?',
  ).toBe(200);
  await page.waitForFunction(
    () =>
      window.__oylRealistic?.result !== undefined ||
      (window.__oylRealistic?.errors.length ?? 0) > 0,
    undefined,
    { timeout: REALISTIC_LOAD_BUDGET_MS },
  );
  const published = await page.evaluate(() => window.__oylRealistic);
  expect(published?.errors, `realistic.html${query} reported an error`).toEqual([]);
  const result = published?.result;
  if (published === undefined || result === undefined) {
    throw new Error(`realistic.html${query} published no result`);
  }
  // Not vacuous: the realistic world itself, not the stylised fallback.
  expect(published.outcome?.loaded, JSON.stringify(published.outcome)).toBe(true);
  expect(result.world).toBe('realistic');
  return { result, page: published };
}

test.describe('the realistic page’s instruments — #616', { tag: NIGHTLY }, () => {
  test('counts triangles as three does, and switching the vegetation off removes them', async ({
    page,
  }) => {
    test.setTimeout(2 * REALISTIC_LOAD_BUDGET_MS);

    const all = await ride(page, HELD);
    const { triangles, rendererTriangles } = all.result.lastFrame;
    console.log(
      `#616 all layers on: ${String(triangles)} triangles counted at the draw calls, ` +
        `${String(rendererTriangles)} by three; ${String(all.result.drawCalls)} draw calls; ` +
        `layers ${JSON.stringify(all.page.layers)}`,
    );
    expect(all.result.layersOff).toEqual([]);
    // #639's own criterion, on the page it names and the load this already
    // pays for: the wooded view at `at=2550`, counted at the draw calls, is at
    // or under the budget. The rider and the ladder are held, so the window's
    // mean is one frame's count repeated. Each tree's materials drawn apart —
    // `three-renderer.ts` §`setRealisticMaterialsMerged` — puts it at 39.
    expect(all.result.drawCalls).toBeGreaterThan(0);
    expect(all.result.drawCalls).toBeLessThanOrEqual(REALISTIC_WOODED_DRAW_CALLS);
    expect(rendererTriangles, 'three drew no frame through the switch').toBeDefined();
    expect(triangles).toBeGreaterThan(0);
    expect(all.result.trianglesPerFrame).toBeGreaterThan(0);
    expect(Math.abs(triangles - (rendererTriangles ?? 0))).toBeLessThanOrEqual(
      AGREEMENT * (rendererTriangles ?? 0),
    );

    // Every object in the real scene is owned, and every layer is in it.
    const census = all.page.layers;
    expect(census?.unplaced).toEqual([]);
    for (const layer of LAYERS) {
      expect(census?.objects[layer], `the ${layer} layer holds nothing`).toBeGreaterThan(0);
    }

    // The control.
    const without = await ride(page, `${HELD}&layers=-vegetation`);
    console.log(
      `#616 -vegetation: ${String(without.result.lastFrame.triangles)} triangles, ` +
        `${String(triangles - without.result.lastFrame.triangles)} fewer`,
    );
    expect(without.result.layersOff).toEqual(['vegetation']);
    // The rung does not move: a layer is switched off, not stepped down to.
    expect(without.result.rung).toBe(all.result.rung);
    expect(triangles - without.result.lastFrame.triangles).toBeGreaterThanOrEqual(
      VEGETATION_AT_LEAST,
    );
  });
});

test.describe('the realistic page’s tree levers — #1283, #1294', { tag: NIGHTLY }, () => {
  test('loads the generated trees, or with a lever off the scans it names, and never both', async ({
    page,
  }) => {
    test.setTimeout(3 * REALISTIC_LOAD_BUDGET_MS);

    const fetched: string[] = [];
    page.on('request', (request) => {
      const file = /\/realistic\/([^/?]+)$/.exec(new URL(request.url()).pathname)?.[1];
      if (file !== undefined) fetched.push(file);
    });
    const filesOf = (models: readonly RealisticModel[]): readonly string[] =>
      models.flatMap((model) =>
        [model.file, model.middle, model.impostor, model.impostorNormals].filter(
          (file): file is string => file !== undefined,
        ),
      );
    const treesOf = (set: 'generated' | 'scanned'): readonly string[] =>
      filesOf(REALISTIC_BROADLEAVES[set]);
    const firsOf = (set: 'generated' | 'scanned'): readonly string[] =>
      filesOf(REALISTIC_CONIFERS[set]);

    const generated = await ride(page, HELD);
    const withGenerated = [...fetched];
    // The product's trees: every generated file, and not one of the scans'.
    for (const file of treesOf('generated')) expect(withGenerated, file).toContain(file);
    for (const file of treesOf('scanned')) expect(withGenerated, file).not.toContain(file);
    for (const file of firsOf('generated')) expect(withGenerated, file).toContain(file);
    for (const file of firsOf('scanned')) expect(withGenerated, file).not.toContain(file);
    expect(generated.result.leversOff).toEqual([]);

    // #1294's lever: the scanned firs, beside the generated broadleaves.
    fetched.length = 0;
    const scannedFirs = await ride(page, `${HELD}&levers=-generated-conifers`);
    const withScannedFirs = [...fetched];
    for (const file of firsOf('scanned')) expect(withScannedFirs, file).toContain(file);
    for (const file of firsOf('generated')) expect(withScannedFirs, file).not.toContain(file);
    for (const file of treesOf('generated')) expect(withScannedFirs, file).toContain(file);
    for (const file of treesOf('scanned')) expect(withScannedFirs, file).not.toContain(file);
    expect(scannedFirs.result.leversOff).toEqual(['generated-conifers']);
    expect(scannedFirs.result.rung).toBe(generated.result.rung);

    // #1283's lever: every tree's scan, and no generated tree.
    fetched.length = 0;
    const scanned = await ride(page, `${HELD}&levers=-generated-trees`);
    const withScanned = [...fetched];
    for (const file of treesOf('scanned')) expect(withScanned, file).toContain(file);
    for (const file of treesOf('generated')) expect(withScanned, file).not.toContain(file);
    for (const file of firsOf('scanned')) expect(withScanned, file).toContain(file);
    for (const file of firsOf('generated')) expect(withScanned, file).not.toContain(file);
    expect(scanned.result.leversOff).toEqual(['generated-trees']);
    // The lever chooses trees and nothing else: the rung does not move.
    expect(scanned.result.rung).toBe(generated.result.rung);

    const calls = (run: typeof generated): string =>
      `${String(run.result.lastFrame.calls)} draw calls a frame (the page's mean ${String(run.result.drawCalls)})`;
    console.log(
      `#1294 at=2550, held: ${String(generated.result.lastFrame.triangles)} triangles in ` +
        `${calls(generated)} with every tree generated; ` +
        `${String(scannedFirs.result.lastFrame.triangles)} in ${calls(scannedFirs)} ` +
        `with the scanned firs; ${String(scanned.result.lastFrame.triangles)} in ` +
        `${calls(scanned)} with every tree a scan. Textures held: ` +
        `${String(generated.page.textures?.bytes)} bytes, ${String(scannedFirs.page.textures?.bytes)} ` +
        `and ${String(scanned.page.textures?.bytes)}`,
    );
    // Different trees are different frames — and each step toward generated
    // is lighter, here where most of the trees in view are conifers.
    expect(generated.result.lastFrame.triangles).toBeLessThan(
      scannedFirs.result.lastFrame.triangles,
    );
    expect(scannedFirs.result.lastFrame.triangles).toBeLessThanOrEqual(
      scanned.result.lastFrame.triangles,
    );
    // All inside #639's ceiling, which did not move; and less texture memory
    // held at each step. ⚠️ With THREE seeds a species, as #1283 was first
    // written, the page's mean was 35 of 35 on a Mac and 34 on the CI runner —
    // which is why there are two (#1289's review).
    //
    // #1294: the generated firs are two shapes where the scanned firs were
    // two, so the FRAME makes the calls it made: {@link FRAME_DRAW_CALLS_AT_2550},
    // and at or under the scanned firs' own frame, call for call.
    expect(generated.result.lastFrame.calls).toBeGreaterThan(0);
    expect(generated.result.lastFrame.calls).toBeLessThanOrEqual(FRAME_DRAW_CALLS_AT_2550);
    expect(generated.result.lastFrame.calls).toBeLessThanOrEqual(
      scannedFirs.result.lastFrame.calls,
    );
    // The issue's own criterion, on the figure it names: the page's mean. The
    // rider and the ladder are held, so every frame of the window is this
    // frame, and a mean that is not the frame's count has counted something
    // that is not the window: the warm-up, and the first render in it.
    expect(generated.result.drawCalls).toBeLessThanOrEqual(PAGE_DRAW_CALLS_AT_2550);
    for (const run of [generated, scannedFirs, scanned]) {
      expect(run.result.drawCalls).toBe(run.result.lastFrame.calls);
    }
    expect(scannedFirs.result.lastFrame.calls).toBeLessThanOrEqual(REALISTIC_WOODED_DRAW_CALLS);
    expect(scanned.result.lastFrame.calls).toBeLessThanOrEqual(REALISTIC_WOODED_DRAW_CALLS);
    expect(PAGE_DRAW_CALLS_AT_2550).toBeLessThan(REALISTIC_WOODED_DRAW_CALLS);
    expect(generated.page.textures?.bytes ?? Infinity).toBeLessThan(
      scannedFirs.page.textures?.bytes ?? 0,
    );
    expect(scannedFirs.page.textures?.bytes ?? Infinity).toBeLessThan(
      scanned.page.textures?.bytes ?? 0,
    );
  });
});
