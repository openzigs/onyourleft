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
 * ⚠️ **What it does not prove**: anything about the tablet's GPU clock, which
 * is what the switch is FOR — that is validation 0002's Part for #616, run by
 * the owner. And it holds only the vegetation to a number; the other six
 * layers are held to "placed, and not empty" and to `layers.test.ts`.
 */

import { expect, test, type Page } from '@playwright/test';

import { REALISTIC_WOODED_DRAW_CALLS } from '../src/game/realistic-budget';

import { LAYERS } from './realistic/config';
import type { RealisticSample } from './realistic-harness';

/** A realistic load's budget: the same 31 MiB `game.browser.spec.ts` §#607 pays for. */
const REALISTIC_LOAD_BUDGET_MS = 150_000;

/** The route's default start, held still: a stretch with trees on it. */
const HELD = '?ladder=0&panel=0&seconds=1&at=2550';

/** How far the draw-call count and three's may differ on one frame (#616). */
const AGREEMENT = 0.01;

/** The least #616's control must remove: a counter that reports a constant removes none. */
const VEGETATION_AT_LEAST = 100_000;

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

test.describe('the realistic page’s instruments — #616', () => {
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
