// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #1539 in a real engine: a route's corridor read over real range requests
 * from a synthetic archive at the harness's own origin, kept in real
 * IndexedDB, and read back from it with the network refused.
 *
 * The network half of ADR 0032 D-4 item 3: **every request the page made is
 * to the harness's own origin**, read from `page.on('request')`. Its control
 * is the same page with map tiles off, which must make **no** request for the
 * archive at all — if it did, the probe would be blind to the switch.
 */

import { expect, test, type Page } from '@playwright/test';

import { HARNESS_ORIGIN } from '../playwright.config';
import { CORRIDOR_MAX_TILES } from '../src/game/world-data/corridor';
import { MAP_TILES_STORAGE_KEY } from '../src/map/tiles-preference';
import { CORRIDOR_ARCHIVE_FILE, expectedCorridorCounts } from './corridor-fixture';
import type { CorridorHarness } from './corridor-harness';

async function readCorridor(page: Page, query = ''): Promise<CorridorHarness> {
  const response = await page.goto(`${HARNESS_ORIGIN}/corridor.html${query}`);
  expect(response?.ok()).toBe(true);
  await page.waitForFunction(() => window.__oylCorridor !== undefined, undefined, {
    timeout: 30_000,
  });
  return (await page.evaluate(() => window.__oylCorridor)) as CorridorHarness;
}

function recordRequests(page: Page): string[] {
  const requested: string[] = [];
  page.on('request', (request) => requested.push(request.url()));
  return requested;
}

test.describe('#1539 corridor read', () => {
  test('reads the route’s corridor from the configured archive, and asks no other origin', async ({
    page,
  }) => {
    const requested = recordRequests(page);
    const corridor = await readCorridor(page);
    const expected = expectedCorridorCounts();
    expect(corridor.errors).toStrictEqual([]);
    expect(corridor.state).toBe('ready');
    expect(corridor.coveredTiles).toBe(expected.tiles);
    expect(corridor.buildings).toBe(expected.buildings);
    expect(corridor.landUse).toBe(expected.landUse);
    expect(corridor.paths).toBe(expected.paths);
    const archive = requested.filter((url) => url.endsWith(`/${CORRIDOR_ARCHIVE_FILE}`));
    expect(archive.length).toBeGreaterThan(expected.tiles);
    const origins = new Set(requested.map((url) => new URL(url).origin));
    expect([...origins]).toStrictEqual([HARNESS_ORIGIN]);
    // The floor for the fixture's corridor at this origin, for the PR body.
    console.log(
      `#1539 corridor read: ${String(expected.tiles)} tiles in ${corridor.milliseconds.toFixed(0)} ms at the harness origin`,
    );
  });

  test('control: with map tiles off the archive is never asked for, and the line says off', async ({
    page,
  }) => {
    await page.addInitScript((key) => {
      localStorage.setItem(key, 'off');
    }, MAP_TILES_STORAGE_KEY);
    const requested = recordRequests(page);
    const corridor = await readCorridor(page);
    expect(corridor.state).toBe('off');
    expect(corridor.why).toBe('map-tiles-off');
    expect(requested.filter((url) => url.includes('.pmtiles'))).toStrictEqual([]);
  });
});

test.describe('#1539 the 600-tile corridor', () => {
  test('reads all 600 tiles at the harness origin — the floor of the budget', async ({ page }) => {
    const corridor = await readCorridor(page, '?long');
    expect(corridor.errors).toStrictEqual([]);
    expect(corridor.state).toBe('ready');
    expect(corridor.coveredTiles).toBe(CORRIDOR_MAX_TILES);
    // Recorded, not asserted: a loopback number is the floor, and the hosted
    // one carries R2's latency (ADR 0010 D-1); #1553 measures it on the tablet.
    console.log(
      `#1539 corridor read: ${String(CORRIDOR_MAX_TILES)} tiles in ${corridor.milliseconds.toFixed(0)} ms at the harness origin`,
    );
  });
});

test.describe('#1539 offline from the store', () => {
  test('a second load with the archive refused is ready from IndexedDB', async ({ page }) => {
    expect((await readCorridor(page)).state).toBe('ready');
    await page.route('**/*.pmtiles', (route) => route.abort());
    const again = await readCorridor(page);
    expect(again.state).toBe('ready');
    expect(again.buildings).toBe(expectedCorridorCounts().buildings);
  });

  test('control: a fresh context with the archive refused is unavailable, and draws today’s world', async ({
    browser,
  }) => {
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      await page.route('**/*.pmtiles', (route) => route.abort());
      const corridor = await readCorridor(page);
      expect(corridor.state).toBe('unavailable');
      expect(corridor.why).toBe('offline');
      expect(corridor.sceneDigest).toBe(corridor.proceduralDigest);
    } finally {
      await context.close();
    }
  });
});
