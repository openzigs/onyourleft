// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A drawn route's heights, in a real engine — #2013.
 *
 * The Vitest suites read synthetic height tiles through a stand-in decoder,
 * because Node has none. This is where the **platform's** decoder reads the
 * same tiles: `src/terrain/decode.ts` §`platformWebpPixels`, with the options
 * that keep a decoder from changing the colour bytes a height is packed in.
 * And where the product's one `fetch` (`src/terrain/terrain-source.ts`) reads
 * a real file by byte range from a real server.
 *
 * It also takes the owner's screenshots: the route planner's profile of a
 * route drawn across the hills tile, at the tablet's 1280×800 and on a phone
 * (#2013's last criterion; `.claude/delivery.md` §"Owner-only criteria").
 *
 * What it does not prove is `terrain-harness.tsx`'s list.
 */

import { expect, test, type Page, type Request } from '@playwright/test';

import { HARNESS_ORIGIN } from '../playwright.config';
import type { TerrainHarness } from './terrain-harness';
import { hillHeight, TERRAIN_ARCHIVE_FILE } from './terrain-fixture';

async function open(page: Page): Promise<TerrainHarness> {
  const response = await page.goto(`${HARNESS_ORIGIN}/terrain.html`);
  if (response === null || !response.ok()) {
    throw new Error(
      `terrain.html did not load (${String(response?.status())}). Is it named in ` +
        `vite.browser.config.ts's build.rollupOptions.input?`,
    );
  }
  await page.waitForFunction(() => window.__oylTerrain?.ready === true);
  const state = await page.evaluate(() => window.__oylTerrain);
  if (state === undefined) throw new Error('the harness published nothing');
  return state;
}

test.describe('a drawn route’s heights in a real engine — #2013', () => {
  test('the platform’s decoder hands back the heights that were written, to the pixel', async ({
    page,
  }) => {
    const state = await open(page);
    expect(state.errors).toEqual([]);
    expect(state.slope?.pixels).toBe(512 * 512);
    // Terrarium's own step is 1/256 m. A decoder that premultiplied, or
    // converted a colour space, would be out by metres.
    expect(state.slope?.worstErrorMetres).toBeLessThan(1 / 256);
  });

  test('an oversize tile is refused unread, and a malformed one yields no height', async ({
    page,
  }) => {
    const state = await open(page);
    expect(state.oversize).toEqual({ refused: 'wrong-size' });
    // The body is cut short after a few hundred bytes. Whatever the engine
    // makes of the rest, none of it is a height: the tile is refused, or
    // every pixel it could not decode is no-data.
    const malformed = state.malformed;
    expect(malformed).toBeDefined();
    if (malformed !== undefined && 'valid' in malformed) {
      expect(malformed.valid).toBeLessThan(512 * 8);
      expect(malformed.noData).toBeGreaterThan(512 * 500);
    } else {
      expect(['undecodable', 'no-heights', 'timed-out']).toContain(malformed?.refused);
    }
    // And along a line over both, through the reader: no height, and no throw.
    expect(state.hostileLine.length).toBeGreaterThan(5);
    expect(state.hostileLine.every((height) => height === undefined || height === null)).toBe(true);
  });

  test('a line’s heights come through the one fetch, as byte ranges of the one file', async ({
    page,
  }) => {
    const requests: Request[] = [];
    page.on('request', (request) => {
      if (request.url().includes('.pmtiles')) requests.push(request);
    });
    const state = await open(page);
    expect(state.errors).toEqual([]);

    // The hills, sampled every 15 m along the tile's middle row: the heights
    // rise and fall as the formula says, within one pixel's worth of slope.
    expect(state.line.length).toBeGreaterThan(300);
    const heights = state.line.map(Number);
    expect(heights.every((height) => Number.isFinite(height))).toBe(true);
    expect(heights[0]).toBeGreaterThan(hillHeight(39.5) - 2);
    expect(heights[0]).toBeLessThan(hillHeight(39.5) + 2);
    expect(heights.at(-1)).toBeGreaterThan(hillHeight(469.5) - 2);
    expect(heights.at(-1)).toBeLessThan(hillHeight(469.5) + 2);
    expect(Math.max(...heights) - Math.min(...heights)).toBeGreaterThan(120);

    // Every request names the one file and carries a Range, and no cookie.
    expect(requests.length).toBeGreaterThan(1);
    for (const request of requests) {
      expect(request.url()).toBe(`${HARNESS_ORIGIN}/${TERRAIN_ARCHIVE_FILE}`);
      const headers = await request.allHeaders();
      expect(headers['range']).toMatch(/^bytes=\d+-\d+$/);
      expect(headers['cookie']).toBeUndefined();
    }
  });

  for (const viewport of [
    { name: 'the tablet', width: 1280, height: 800 },
    { name: 'a phone', width: 390, height: 844 },
  ] as const) {
    test(`the planner shows the drawn route’s climb, on ${viewport.name}`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      const state = await open(page);
      expect(state.errors).toEqual([]);

      const sentence = page.getByText(/from Mapterhorn terrain at/);
      await expect(sentence).toBeVisible();
      await expect(sentence).toContainText('sampled every 15 m');
      // Three straight legs over the hills: a climb, and no "saved flat".
      await expect(sentence).toContainText(/climbing \d{3} m and descending \d+ m/);
      await expect(page.getByText('No elevation profile yet.')).toHaveCount(0);
      await expect(page.getByText(/climbing stays empty/)).toHaveCount(0);
      await expect(
        page.getByText(/the climbing is that of the ground under the straight line/),
      ).toBeVisible();

      // Written under the run's output directory as well as attached, so a
      // local run leaves the files where the pull request says they are.
      const size = `${String(viewport.width)}x${String(viewport.height)}`;
      const whole = testInfo.outputPath(`planner-${size}.png`);
      await page.screenshot({ path: whole, fullPage: true });
      await testInfo.attach(`planner-${size}.png`, { path: whole, contentType: 'image/png' });
      await sentence.scrollIntoViewIfNeeded();
      const profile = testInfo.outputPath(`planner-profile-${size}.png`);
      await page.screenshot({ path: profile });
      await testInfo.attach(`planner-profile-${size}.png`, {
        path: profile,
        contentType: 'image/png',
      });
    });
  }
});
