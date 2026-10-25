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
 * And since #1624, a sixth: **the holiday decorations**. With
 * `decorations=probe` and a day in Halloween, every anchor of the village in
 * reach carries one box (`realistic/config.ts` §`PROBE_DECORATIONS`); with
 * `levers=-decorations` there is no holiday. The difference is exactly one
 * draw call, in both worlds, and its control is the belt's own triangles read
 * off its mesh, which must be above nought — so a belt with nothing in it
 * cannot pass by adding no call.
 *
 * And since #1689, a seventh: **the village frame's freeze**. The decorated
 * village hold draws exactly `realistic-budget.ts`
 * §`REALISTIC_VILLAGE_DRAW_CALLS` calls, so a feature that adds a village call
 * is red until it removes one, and a merge that saves one lowers the number.
 *
 * And since #1559, a fifth: **the village road**. `?route=village` rides
 * `route.ts` §`villageRoute`, and its hold at `VILLAGE_HOLD_METRES` is
 * validation 0002 AE2's frame: the page's census of the frame it drew holds a
 * church and a row of shops in the camera's view, #1535's pavements and every
 * kind of #1536's furniture. The default URL's road is read back too, by its
 * fingerprint, on the #616 load: the same road every row was taken on.
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
import { GROUND_BLOB_TRIANGLES } from '../src/game/ground-blob';
import {
  MAPPED_BUILDING_MAX,
  REALISTIC_DECORATION_TRIANGLES,
  REALISTIC_VILLAGE_DRAW_CALLS,
  REALISTIC_WOODED_DRAW_CALLS,
} from '../src/game/realistic-budget';

import { NIGHTLY } from './nightly';
import { LAYERS } from './realistic/config';
import {
  realisticRoute,
  routeDigest,
  VILLAGE_HOLD_METRES,
  villageRoute,
} from '../src/demo/synthetic-road';
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
 * trees a ride draws: **34**, one under `REALISTIC_WOODED_DRAW_CALLS`.
 *
 * ⚠️ **#1294's criterion names 33** — "at or under 33 at `at=2550`", the
 * figure #1289 left it at — and a reviewer who remembers 33 is reading the
 * page before #1523. #1523 draws each fir mesh after a depth-only pre-pass,
 * which is three calls on this frame ({@link FRAME_DRAW_CALLS_AT_2550}); with
 * `levers=-fir-prepass` the frame makes the 31 it made before. It is the
 * page's own `drawCalls`, a mean over its window, and is asserted, as is the
 * frame's own count below.
 */
const PAGE_DRAW_CALLS_AT_2550 = 34;

/**
 * What one held frame at `at=2550` makes, counted at the WebGL draw calls:
 * **34**, with the generated firs and with the scanned ones alike (two shapes
 * stand where two stood, and they add no call), on a Mac, 2026-10-24 — 31,
 * on a Mac and on the CI runner on 2026-10-12, and three for #1523's fir
 * pre-passes ({@link FRAME_DRAW_CALLS_WITHOUT_PREPASS}). Held at the measured
 * figure, so one added call is a red test.
 *
 * ⚠️ **The page's mean read 32 to 35 for this frame until #1294**, because
 * its window also held the warm-up and the page's first render, which makes
 * 60 calls (`realistic-harness.ts` §`RealisticSample.drawCalls`). The window
 * now starts where the warm-up ends, so a held frame's mean IS its count, and
 * the test below holds the two equal.
 */
const FRAME_DRAW_CALLS_AT_2550 = 34;

/**
 * #1523: the same held frame with `levers=-fir-prepass`: **31**, the figure
 * #1294 measured — so the three calls above are the pre-passes and nothing
 * else.
 */
const FRAME_DRAW_CALLS_WITHOUT_PREPASS = 31;

type Published = NonNullable<Window['__oylRealistic']>;

async function ride(
  page: Page,
  query: string,
  world: 'realistic' | 'stylised' = 'realistic',
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
  if (world === 'realistic') {
    // Not vacuous: the realistic world itself, not the stylised fallback.
    expect(published.outcome?.loaded, JSON.stringify(published.outcome)).toBe(true);
  }
  expect(result.world).toBe(world);
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
    // #1559: the default URL rides the road every Part Z and AH row was taken
    // on (`route.test.ts` pins it), with no village in this frame.
    expect(all.page.routeDigest).toBe(routeDigest(realisticRoute()));
    expect(all.page.census?.structures.church.carried).toBe(0);
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

  test('draws a depth pre-pass for each fir mesh, and with #1523’s lever off the frame #1294 drew', async ({
    page,
  }) => {
    test.setTimeout(2 * REALISTIC_LOAD_BUDGET_MS);
    const drawn = await ride(page, HELD);
    const off = await ride(page, `${HELD}&levers=-fir-prepass`);
    console.log(
      `#1523 at=2550, held: ${String(drawn.result.lastFrame.calls)} draw calls and ` +
        `${String(drawn.result.lastFrame.triangles)} triangles with the firs' pre-pass; ` +
        `${String(off.result.lastFrame.calls)} and ${String(off.result.lastFrame.triangles)} without`,
    );
    expect(drawn.result.leversOff).toEqual([]);
    expect(off.result.leversOff).toEqual(['fir-prepass']);
    // The lever takes the pre-passes out and nothing else: the frame #1294 drew.
    expect(off.result.lastFrame.calls).toBe(FRAME_DRAW_CALLS_WITHOUT_PREPASS);
    expect(drawn.result.lastFrame.calls).toBe(FRAME_DRAW_CALLS_AT_2550);
    // At most one call for each fir mesh — two shapes at two levels — and the
    // triangles of the firs drawn twice.
    expect(drawn.result.lastFrame.calls - off.result.lastFrame.calls).toBeGreaterThan(0);
    expect(drawn.result.lastFrame.calls - off.result.lastFrame.calls).toBeLessThanOrEqual(
      2 * REALISTIC_CONIFERS.generated.length,
    );
    expect(drawn.result.lastFrame.triangles).toBeGreaterThan(off.result.lastFrame.triangles);
    // The lever chooses the pre-pass and nothing else: the rung does not move.
    expect(off.result.rung).toBe(drawn.result.rung);
  });
});

test.describe('the realistic page’s village road — #1559', { tag: NIGHTLY }, () => {
  test('holds a church, a row of shops, pavements and furniture in frame, read off the frame it drew', async ({
    page,
  }) => {
    test.setTimeout(REALISTIC_LOAD_BUDGET_MS);

    // Validation 0002 AE2's URL, the panel and the ladder held as the row is.
    const village = await ride(
      page,
      `?ladder=0&panel=0&seconds=1&at=${String(VILLAGE_HOLD_METRES)}&route=village`,
    );
    const census = village.page.census;
    console.log(
      `#1559 route=village at=${String(VILLAGE_HOLD_METRES)}: ${JSON.stringify(census)}; ` +
        `${String(village.result.lastFrame.triangles)} triangles in ` +
        `${String(village.result.lastFrame.calls)} draw calls`,
    );
    // Another road from the default one, and the one `route.test.ts` pins.
    expect(village.page.routeDigest).toBe(routeDigest(villageRoute()));
    expect(village.page.routeDigest).not.toBe(routeDigest(realisticRoute()));
    if (census === undefined) throw new Error('the page published no census');
    expect(census.structures.church.inView).toBeGreaterThanOrEqual(1);
    expect(census.structures['shop-row'].inView).toBeGreaterThanOrEqual(1);
    expect(census.structures.building.inView).toBeGreaterThan(5);
    // #1535's pavements and #1536's furniture, every kind of it in view.
    expect(census.streets).toBeGreaterThanOrEqual(1);
    expect(census.pavementTriangles).toBeGreaterThan(0);
    for (const [kind, counted] of Object.entries(census.furniture)) {
      expect(counted.inView, kind).toBeGreaterThan(0);
    }
    // And the frame was drawn, not only built.
    expect(village.result.lastFrame.triangles).toBeGreaterThan(0);
    expect(village.result.lastFrame.calls).toBeGreaterThan(0);
  });
});

test.describe('the realistic page’s mapped-blobs lever — #1657', { tag: NIGHTLY }, () => {
  test('grounds the mixed town’s buildings, and with the lever off draws none of their blobs', async ({
    page,
  }) => {
    test.setTimeout(2 * REALISTIC_LOAD_BUDGET_MS);
    // Inside #1581's mixed town, held; the people off, so that nothing but
    // the lever differs between the two frames.
    const town = '?ladder=0&panel=0&seconds=1&town=mixed&at=1300&levers=-people';
    const grounded = await ride(page, town);
    const off = await ride(page, `${town},-mapped-blobs`);
    const added = grounded.result.lastFrame.triangles - off.result.lastFrame.triangles;
    console.log(
      `#1657 town=mixed at=1300: ${String(grounded.result.lastFrame.triangles)} triangles in ` +
        `${String(grounded.result.lastFrame.calls)} draw calls grounded, ` +
        `${String(off.result.lastFrame.triangles)} in ${String(off.result.lastFrame.calls)} ` +
        `with the lever off: ${String(added / GROUND_BLOB_TRIANGLES)} mapped blobs`,
    );
    expect(grounded.result.leversOff).toEqual(['people']);
    expect(off.result.leversOff).toEqual(['mapped-blobs', 'people']);
    // The lever reaches the blobs: off, the frame draws fewer, a quad each,
    // and at most one a mapped building.
    expect(added).toBeGreaterThan(0);
    expect(added % GROUND_BLOB_TRIANGLES).toBe(0);
    expect(added).toBeLessThanOrEqual(MAPPED_BUILDING_MAX * GROUND_BLOB_TRIANGLES);
    // No call of its own: the blobs are the one belt's instances.
    expect(grounded.result.lastFrame.calls - off.result.lastFrame.calls).toBeLessThanOrEqual(1);
    expect(off.result.rung).toBe(grounded.result.rung);
  });
});

/**
 * #1624: the village road's hold, on Halloween, with the probe on every
 * anchor in reach — and the same with the holiday switched off.
 */
const DECORATED = `?ladder=0&panel=0&seconds=1&at=${String(VILLAGE_HOLD_METRES)}&route=village&date=2026-10-31&decorations=probe`;

test.describe('the realistic page’s holiday decorations, stylised — #1624', () => {
  test('draws the probe on every anchor in reach in ONE call more than with decorations off', async ({
    page,
  }) => {
    test.setTimeout(REALISTIC_LOAD_BUDGET_MS);
    const on = await ride(page, `${DECORATED}&world=stylised`, 'stylised');
    const off = await ride(page, `${DECORATED}&world=stylised&levers=-decorations`, 'stylised');
    console.log(
      `#1624 stylised: ${String(on.result.lastFrame.calls)} draw calls with the probe ` +
        `(${JSON.stringify(on.page.decorations)}), ${String(off.result.lastFrame.calls)} without`,
    );
    expect(off.result.leversOff).toEqual(['decorations']);
    // The control: the belt holds the probe, so the delta is not vacuous.
    expect(on.page.decorations?.triangles ?? 0).toBeGreaterThan(0);
    expect(on.page.decorations?.triangles ?? 0).toBeLessThanOrEqual(REALISTIC_DECORATION_TRIANGLES);
    expect(off.page.decorations?.triangles).toBe(0);
    expect(on.result.lastFrame.calls - off.result.lastFrame.calls).toBe(1);
    // The same triangles more, and no others: the belt is all that differs.
    expect(on.result.lastFrame.triangles - off.result.lastFrame.triangles).toBe(
      on.page.decorations?.triangles,
    );
  });
});

test.describe('the realistic page’s holiday decorations — #1624', { tag: NIGHTLY }, () => {
  test('draws the probe in ONE call, inside the frame’s calls and its own triangles, fetching nothing more', async ({
    page,
  }) => {
    test.setTimeout(3 * REALISTIC_LOAD_BUDGET_MS);
    const fetched: string[] = [];
    // What the page fetched over the network: not the `blob:` URLs it makes
    // of what it has already decoded, which are new names every load.
    page.on('request', (request) => {
      if (!request.url().startsWith('blob:')) fetched.push(new URL(request.url()).pathname);
    });
    const on = await ride(page, DECORATED);
    const withProbe = [...fetched].sort();
    fetched.length = 0;
    const off = await ride(page, `${DECORATED}&levers=-decorations`);
    const without = [...fetched].sort();
    console.log(
      `#1624 realistic: ${String(on.result.lastFrame.calls)} draw calls and ` +
        `${String(on.result.lastFrame.triangles)} triangles with the probe ` +
        `(${JSON.stringify(on.page.decorations)}), ${String(off.result.lastFrame.calls)} and ` +
        `${String(off.result.lastFrame.triangles)} without`,
    );
    expect(on.page.decorations?.triangles ?? 0).toBeGreaterThan(0);
    expect(on.page.decorations?.triangles ?? 0).toBeLessThanOrEqual(REALISTIC_DECORATION_TRIANGLES);
    expect(off.page.decorations?.triangles).toBe(0);
    expect(on.result.lastFrame.calls - off.result.lastFrame.calls).toBe(1);
    expect(on.result.lastFrame.triangles - off.result.lastFrame.triangles).toBe(
      on.page.decorations?.triangles,
    );
    // Zero bytes (ruling (c)): the probe is boxes from numbers, so the page
    // fetches exactly what it fetches with no holiday.
    expect(withProbe).toEqual(without);
    expect(off.result.rung).toBe(on.result.rung);

    // ⚠️ **The ceiling is held on the wooded frame it was set for, not on the
    // village's.** #1624 asked for the village view at or under
    // `REALISTIC_WOODED_DRAW_CALLS`, and on `main` before #1624 that frame
    // already makes 58 calls with no decoration at all (2026-10-24, on a Mac
    // and in the pinned Chromium) — every structure kind, the furniture's
    // four kinds, the pavements and the people. The belt's own share of it is
    // the one call held above; since #1689 the village frame is frozen at
    // `REALISTIC_VILLAGE_DRAW_CALLS` by its own test below. With the probe and
    // a holiday on, the wooded hold is the frame THIS ceiling counts.
    const wooded = await ride(page, `${HELD}&date=2026-10-31&decorations=probe`);
    console.log(
      `#1624 at=2550 with the probe: ${String(wooded.result.lastFrame.calls)} draw calls ` +
        `(${JSON.stringify(wooded.page.decorations)})`,
    );
    expect(wooded.result.lastFrame.calls).toBeLessThanOrEqual(REALISTIC_WOODED_DRAW_CALLS);
    expect(wooded.result.lastFrame.calls).toBe(FRAME_DRAW_CALLS_AT_2550);
  });
});

test.describe('the realistic page’s village frame, frozen — #1689', { tag: NIGHTLY }, () => {
  test('draws the decorated village hold in exactly REALISTIC_VILLAGE_DRAW_CALLS calls', async ({
    page,
  }) => {
    test.setTimeout(REALISTIC_LOAD_BUDGET_MS);
    // #1624's frame: the village hold, the ladder held at the top rung, on
    // Halloween with the probe on every anchor in reach — so the decoration
    // belt's one call is inside the figure, as the owner's ruling counts it.
    const village = await ride(page, DECORATED);
    console.log(
      `#1689 route=village at=${String(VILLAGE_HOLD_METRES)}, decorated: ` +
        `${String(village.result.lastFrame.calls)} draw calls a frame (the page's mean ` +
        `${String(village.result.drawCalls)}), ${String(village.result.lastFrame.triangles)} ` +
        `triangles, frozen at ${String(REALISTIC_VILLAGE_DRAW_CALLS)}`,
    );
    // Not vacuous: the village is in frame, and the belt holds the probe.
    const census = village.page.census;
    if (census === undefined) throw new Error('the page published no census');
    expect(census.structures.church.inView).toBeGreaterThanOrEqual(1);
    expect(census.structures['shop-row'].inView).toBeGreaterThanOrEqual(1);
    for (const [kind, counted] of Object.entries(census.furniture)) {
      expect(counted.inView, kind).toBeGreaterThan(0);
    }
    expect(village.page.decorations?.triangles ?? 0).toBeGreaterThan(0);
    // The freeze: no call more — and none fewer, so a merge that saves one
    // lowers the number in the same pull request (the ruling's step 3).
    expect(village.result.lastFrame.calls).toBeLessThanOrEqual(REALISTIC_VILLAGE_DRAW_CALLS);
    expect(village.result.lastFrame.calls).toBe(REALISTIC_VILLAGE_DRAW_CALLS);
    // A held frame's mean is its count (#1294).
    expect(village.result.drawCalls).toBe(village.result.lastFrame.calls);
  });
});

test.describe('the route’s own season, in the realistic world — #1623', { tag: NIGHTLY }, () => {
  type Ridden = Awaited<ReturnType<typeof ride>> & {
    readonly files: readonly string[];
    readonly shot: Buffer;
  };

  /** Rides `query` on `date`: the run, the realistic files its load fetched, and its held frame. */
  const ridden = async (page: Page, query: string, date: string): Promise<Ridden> => {
    const fetched: string[] = [];
    const listen = (request: { url: () => string }): void => {
      const file = /\/realistic\/([^/?]+)$/.exec(new URL(request.url()).pathname)?.[1];
      if (file !== undefined) fetched.push(file);
    };
    page.on('request', listen);
    const run = await ride(page, `${query}&date=${date}`);
    page.off('request', listen);
    const shot = await page.screenshot();
    await test.info().attach(`${query}&date=${date}`, { body: shot, contentType: 'image/png' });
    return { ...run, files: [...new Set(fetched)].sort(), shot };
  };

  /** The same frame in the same calls, from the same files, as `july`. */
  const costsNothing = (run: Ridden, july: Ridden): void => {
    // Not vacuous: the page fetched the world it draws.
    expect(july.files.length).toBeGreaterThan(10);
    // A season is uniforms on materials already drawn, and no call of its own.
    expect(run.result.lastFrame.calls).toBe(july.result.lastFrame.calls);
    expect(run.result.lastFrame.triangles).toBe(july.result.lastFrame.triangles);
    expect(run.result.drawCalls).toBe(july.result.drawCalls);
    // No texture, no sky and no model is added: the same files, the same bytes held.
    expect(run.files).toEqual(july.files);
    expect(run.page.textures?.bytes).toBe(july.page.textures?.bytes);
    expect(run.result.rung).toBe(july.result.rung);
  };

  // ⚠️ Two loads a test, and no more: the nightly run stops at 840 s
  // (`playwright.config.ts` §`GATE_BUDGET_MS`), and this describe's first
  // version, at seven loads, ran it out on the runner. The same date loaded
  // twice drew the same frame to the pixel on a Mac (2026-10-24), which is
  // what makes each "differs" below the season rather than noise; the
  // hemisphere is held in `seasonal-nature.test.ts`.
  test('turns the broadleaves on 20 October at 51.5° N, at no cost', async ({ page }) => {
    test.setTimeout(3 * REALISTIC_LOAD_BUDGET_MS);
    const july = await ridden(page, HELD, '2026-07-15');
    const october = await ridden(page, HELD, '2026-10-20');
    console.log(
      `#1623 at=2550, held: ${String(july.result.lastFrame.calls)} draw calls in July, ` +
        `${String(october.result.lastFrame.calls)} on 20 October; ` +
        `${String(july.files.length)} realistic files fetched each`,
    );
    costsNothing(october, july);
    // Deep in this route's autumn: its broadleaves turn.
    expect(october.shot.equals(july.shot)).toBe(false);
  });

  test('lays a winter’s snow on a nordic town’s ground and roofs, at no cost', async ({ page }) => {
    test.setTimeout(3 * REALISTIC_LOAD_BUDGET_MS);
    const town = '?town=mixed&place=nordic&ladder=0&panel=0&seconds=1&at=1100';
    const july = await ridden(page, town, '2026-07-15');
    const january = await ridden(page, town, '2026-01-15');
    costsNothing(january, july);
    // The ground and the roofs are drawn under the route's own winter.
    expect(january.shot.equals(july.shot)).toBe(false);
  });
});
