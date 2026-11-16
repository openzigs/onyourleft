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
 * And since #1623, **the route's own season**: the same held frame on a
 * July day and on an autumn or a winter one draws a different picture in the
 * same draw calls and triangles, from the same files.
 *
 * The default URL's road is read back too, by its fingerprint, on the #616
 * load (#1559): the same road every validation 0002 row was taken on.
 *
 * And since #1638, **the `cityfar` candidate** (validation 0002 AE5's third
 * row): on `town=city`'s hold it draws more of the city's far boxes than the
 * product's 36, inside the page's 35 calls and the belt's six. Here, not
 * beside #1636's city in `realistic-mapped.browser.spec.ts`, because that
 * file's nightly shard has no room for a load (`nightly-split.test.ts` §"#1698").
 *
 * ⚠️ **The page's other describes are in two more files since #1698**: the
 * tree levers (#1283, #1294, #1523) in `realistic-trees.browser.spec.ts`, and
 * the village road (#1559), the mapped-blobs lever (#1657) and the holiday
 * decorations (#1624) in `realistic-town.browser.spec.ts`. One file was one
 * nightly job, and its loads outgrew that job's 840 s stop; each file is a
 * job of its own now (docs/agents/ci.md §4c §"Four nightly browser shards —
 * #1698"), and `realistic-ride.ts` is the load they share.
 *
 * ⚠️ **What it does not prove**: anything about the tablet's GPU clock, which
 * is what the switch is FOR — that is validation 0002's Part for #616, run by
 * the owner. And it holds only the vegetation to a number; the other six
 * layers are held to "placed, and not empty" and to `layers.test.ts`.
 */

import { expect, test, type Page } from '@playwright/test';

import {
  MAPPED_BUILDING_DRAW_CALLS,
  MAPPED_BUILDING_MAX,
  MAPPED_BUILDING_TRIANGLES,
  REALISTIC_WOODED_DRAW_CALLS,
} from '../src/game/realistic-budget';

import { NIGHTLY } from './nightly';
import { LAYERS } from './realistic/config';
import { realisticRoute, routeDigest } from '../src/demo/synthetic-road';
import { HELD, REALISTIC_LOAD_BUDGET_MS, ride, SIXTEENTH_PAGE } from './realistic-ride';
import { classAlong } from './urban-runs';

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

/*
 * #1623's two helpers, at the top of the file rather than inside its describe
 * (#1698): `nightly-split.test.ts` counts a describe's loads by its
 * `ride(page` and `ridden(page` calls, and `ridden`'s own `ride` inside the
 * describe would count one load too many.
 */

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

test.describe('the route’s own season, in the realistic world — #1623', { tag: NIGHTLY }, () => {
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

test.describe('the realistic page’s candidate city cap — #1638', { tag: NIGHTLY }, () => {
  // On `SIXTEENTH_PAGE`, as #1636's city is: what is read is the frame's
  // calls and the page's counters, which the canvas's size does not decide.
  test.use({ viewport: SIXTEENTH_PAGE });

  test('draws more of the city’s far boxes at a cityfar candidate, inside the 35 calls and the belt’s six', async ({
    page,
  }) => {
    test.setTimeout(REALISTIC_LOAD_BUDGET_MS);
    const candidate = 2 * MAPPED_BUILDING_MAX;
    // AE5's hold: `cityCentreFixture`'s city between its two towers, the people off.
    const capped = await ride(
      page,
      `?ladder=0&panel=0&seconds=1&town=city&at=1500&levers=-people&cityfar=${String(candidate)}`,
    );
    const mapped = capped.page.mapped;
    console.log(
      `#1638 AE5 cityfar=${String(candidate)}: ${String(capped.result.lastFrame.calls)} draw ` +
        `calls, ${String(capped.result.lastFrame.triangles)} triangles, mapped ${JSON.stringify(mapped)}`,
    );
    expect(capped.result.drawingBuffer).toEqual([SIXTEENTH_PAGE.width, SIXTEENTH_PAGE.height]);
    expect(classAlong(capped.page.urbanRuns ?? [], 1_500)).toBe('city-centre');
    // The candidate took: more than the 36, every one past them at the far level.
    expect(mapped?.buildings).toBeGreaterThan(MAPPED_BUILDING_MAX);
    expect(mapped?.buildings).toBeLessThanOrEqual(candidate);
    expect(mapped?.far).toBeGreaterThanOrEqual((mapped?.buildings ?? 0) - MAPPED_BUILDING_MAX);
    // The budgets it may not move.
    expect(mapped?.triangles).toBeLessThanOrEqual(MAPPED_BUILDING_TRIANGLES);
    expect(mapped?.drawCalls).toBeLessThanOrEqual(MAPPED_BUILDING_DRAW_CALLS);
    expect(capped.result.lastFrame.calls).toBeGreaterThan(0);
    expect(capped.result.lastFrame.calls).toBeLessThanOrEqual(REALISTIC_WOODED_DRAW_CALLS);
  });
});
