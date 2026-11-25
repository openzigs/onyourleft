// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * In-browser routing, in a real engine — #2734.
 *
 * `valhalla-browser` routes in a module worker in WebAssembly, which Vitest
 * cannot run, so this is where the product's adapter
 * (`src/routing/valhalla-browser-provider.ts`) meets the real SDK, on the
 * synthetic grid off Null Island (`valhalla-grid.ts`). It holds four of the
 * issue's criteria:
 *
 * - the provider contract the scripted double passes in Vitest passes here
 *   against the adapter, and fails with map tiles off (the control);
 * - dragging one of five waypoints asks the SDK's router for two legs,
 *   counted at the router, not at a double;
 * - a leg the engine cannot route here is drawn straight with a sentence that
 *   names no coordinate, and a leg with no road stays a failed leg;
 * - with no network, the planner draws four waypoints as three straight legs
 *   and saves them, read back from the store; with the network on, the same
 *   clicks follow the grid's roads (the control).
 *
 * And that every request the engine makes, from the page or its worker, is to
 * this origin: the SDK reports nowhere else.
 *
 * What it does not prove is `routing-harness.tsx`'s list.
 */

import { expect, test, type Page } from '@playwright/test';

import { HARNESS_ORIGIN } from '../playwright.config';

async function open(page: Page): Promise<void> {
  const response = await page.goto(`${HARNESS_ORIGIN}/routing.html`);
  if (response === null || !response.ok()) {
    throw new Error(
      `routing.html did not load (${String(response?.status())}). Is it named in ` +
        `vite.browser.config.ts's build.rollupOptions.input?`,
    );
  }
  await page.waitForFunction(() => window.__oylRouting?.ready === true);
}

/** Metres from `point` to the segment `a`–`b`, on a flat earth: fine at a few hundred metres. */
function offSegment(
  point: { latitude: number; longitude: number },
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const metresPerDegree = 111_320;
  const [px, py] = [point.longitude * metresPerDegree, point.latitude * metresPerDegree];
  const [ax, ay] = [a.longitude * metresPerDegree, a.latitude * metresPerDegree];
  const [bx, by] = [b.longitude * metresPerDegree, b.latitude * metresPerDegree];
  const length = (bx - ax) ** 2 + (by - ay) ** 2;
  const t =
    length === 0
      ? 0
      : Math.max(0, Math.min(1, ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / length));
  return Math.hypot(px - (ax + t * (bx - ax)), py - (ay + t * (by - ay)));
}

/** How far the furthest point of a saved route lies from the straight legs between its waypoints. */
function furthestFromStraight(
  positions: readonly { latitude: number; longitude: number }[],
  waypoints: readonly { latitude: number; longitude: number }[],
): number {
  let furthest = 0;
  for (const position of positions) {
    let nearest = Number.POSITIVE_INFINITY;
    for (let leg = 0; leg + 1 < waypoints.length; leg += 1) {
      nearest = Math.min(nearest, offSegment(position, waypoints[leg]!, waypoints[leg + 1]!));
    }
    furthest = Math.max(furthest, nearest);
  }
  return furthest;
}

/** The planner's four waypoints: its origin and three nudges north (`RouteBuilderView` §`place`). */
const WAYPOINTS = [0, 1, 2, 3].map((step) => ({
  latitude: 0.05 + step * 0.002,
  longitude: 0.0502,
}));

/** Places four waypoints with the planner's own button, and saves the route under `name`. */
async function drawAndSave(page: Page, name: string): Promise<void> {
  const add = page.getByRole('button', { name: 'Add a waypoint', exact: true });
  for (let count = 0; count < 4; count += 1) await add.click();
  await expect(page.getByRole('rowheader', { name: '3 to 4', exact: true })).toBeVisible();
  await expect(page.getByText('Being routed')).toHaveCount(0);
  await page.getByLabel('Name').fill(name);
  await page.getByRole('button', { name: 'Save to your routes' }).click();
  await expect(page.getByText(`Saved “${name}” to your routes.`)).toBeVisible();
}

async function savedPositions(
  page: Page,
  name: string,
): Promise<readonly { latitude: number; longitude: number }[]> {
  const routes = await page.evaluate(() => window.__oylRouting?.saved());
  const route = routes?.find((each) => each.name === name);
  if (route === undefined) throw new Error(`no route called ${name} was read back`);
  return route.profile.positions;
}

test.describe('in-browser routing in a real engine — #2734', () => {
  test('the adapter passes the provider contract on the synthetic grid, and fails it with map tiles off', async ({
    page,
  }) => {
    const origins = new Set<string>();
    page.context().on('request', (request) => origins.add(new URL(request.url()).origin));
    await open(page);
    const results = await page.evaluate(() => window.__oylRouting?.contract());
    expect(results?.length).toBeGreaterThan(0);
    for (const result of results ?? []) expect(result.failure, result.name).toBeUndefined();
    // The control: the same checks, an engine that fetches nothing. The two that route fail.
    const off = await page.evaluate(() => window.__oylRouting?.contractWithTilesOff());
    expect(off?.filter((result) => result.failure !== undefined)).toHaveLength(2);
    // The SDK, its worker and its WebAssembly, and every tile: this origin and nowhere else.
    expect([...origins]).toStrictEqual([HARNESS_ORIGIN]);
  });

  test('dragging one of five waypoints asks the engine for the two legs beside it, and no more', async ({
    page,
  }) => {
    await open(page);
    const counts = await page.evaluate(() => window.__oylRouting?.drag());
    expect(counts).toStrictEqual({ drawn: 4, dragged: 2 });
  });

  test('a leg off the graph is drawn straight and says why without a coordinate; a leg with no road stays failed', async ({
    page,
  }) => {
    await open(page);
    const refusals = await page.evaluate(() => window.__oylRouting?.refusals());
    expect(refusals?.offTheGraph.mode).toBe('freehand');
    expect(refusals?.offTheGraph.message).toContain('outside the area');
    expect(refusals?.offTheGraph.message).not.toMatch(/\d\.\d/);
    expect(refusals?.unconnected.state).toBe('failed');
    expect(refusals?.unconnected.message).toContain('No route by road');
    expect(refusals?.unconnected.message).not.toMatch(/\d\.\d/);
  });

  test('with no network, four waypoints are three straight legs, saved and read back; with it, they follow roads', async ({
    page,
    context,
  }) => {
    // No network first, in a context whose cache has never seen the engine:
    // the engine's code is fetched on the first leg, and cannot be.
    await open(page);
    await context.setOffline(true);
    try {
      await drawAndSave(page, 'Offline');
      await expect(page.getByRole('cell', { name: 'Freehand', exact: true })).toHaveCount(3);
      await expect(
        page.getByText("The app's road map couldn't be loaded right now", { exact: false }),
      ).toHaveCount(3);
    } finally {
      await context.setOffline(false);
    }
    expect(furthestFromStraight(await savedPositions(page, 'Offline'), WAYPOINTS)).toBeLessThan(1);

    // The control: online, the same clicks follow the grid's streets, so the
    // line strays from the straight one by the 22 m to the corner.
    await open(page);
    await drawAndSave(page, 'Online');
    await expect(page.getByRole('cell', { name: 'Following roads', exact: true })).toHaveCount(3);
    expect(furthestFromStraight(await savedPositions(page, 'Online'), WAYPOINTS)).toBeGreaterThan(
      10,
    );
  });
});
