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
import { LAND_CLASS_MAX_BYTES } from '../src/game/land-class';
import { CORRIDOR_MAX_TILES } from '../src/game/world-data/corridor';
import { MAP_TILES_STORAGE_KEY } from '../src/map/tiles-preference';
import {
  CORRIDOR_ARCHIVE_FILE,
  CORRIDOR_FIXTURE_VERDICTS,
  expectedCorridorCounts,
  FIXTURE_JUNCTIONS,
} from './corridor-fixture';
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
    expect(corridor.streets).toBe(expected.streets);
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

test.describe('#1546 nothing on a mapped wood', () => {
  const BLOCKED = new Set(['wood', 'water', 'park']);

  test('no structure stands on wood, water or park ground', async ({ page }) => {
    const corridor = await readCorridor(page);
    expect(corridor.errors).toStrictEqual([]);
    expect(corridor.state).toBe('ready');
    expect(corridor.classed.length).toBeGreaterThan(0);
    // The fixture's wood is there to be stood on: the ground under the items has some.
    expect(corridor.classed.some((item) => item.landClass === 'wood')).toBe(true);
    expect(
      corridor.classed.filter((item) => item.structure && BLOCKED.has(item.landClass)),
    ).toStrictEqual([]);
    console.log(
      `#1546 land-class mask: ${String(corridor.maskBytes)} bytes, built in ${corridor.maskMilliseconds.toFixed(1)} ms`,
    );
  });

  test('control: with -landclass a procedural building stands inside the wood', async ({
    page,
  }) => {
    const corridor = await readCorridor(page, '?levers=-landclass');
    expect(corridor.state).toBe('ready');
    expect(
      corridor.classed.filter(
        (item) => item.structure && item.kind !== 'signpost' && item.landClass === 'wood',
      ).length,
    ).toBeGreaterThan(0);
  });
});

test.describe('#1540 the mapped buildings’ verdicts', () => {
  test('plans the corridor’s footprints to the same verdicts as the unit test, exactly', async ({
    page,
  }) => {
    const corridor = await readCorridor(page);
    expect(corridor.errors).toStrictEqual([]);
    expect(corridor.state).toBe('ready');
    expect(corridor.verdicts).toStrictEqual(CORRIDOR_FIXTURE_VERDICTS);
    console.log(
      `#1540 footprint plans: ${String(corridor.buildings)} footprints planned in ${corridor.planMilliseconds.toFixed(1)} ms`,
    );
  });

  test('plans the 2 000-footprint town in Chromium within its 400 ms', async ({ page }) => {
    const corridor = await readCorridor(page);
    expect(corridor.errors).toStrictEqual([]);
    expect(corridor.townKept).toBe(2_000);
    console.log(
      `#1540 the dense town: 2000 footprints planned in ${corridor.townPlanMilliseconds.toFixed(1)} ms (fastest of three)`,
    );
    expect(corridor.townPlanMilliseconds).toBeLessThanOrEqual(400);
  });
});

test.describe('#1565 cross streets at their mapped junctions', () => {
  test('a T and a crossroads: the side roads are drawn at the fixture’s angles, read back from the meshes', async ({
    page,
  }) => {
    const corridor = await readCorridor(page);
    expect(corridor.errors).toStrictEqual([]);
    expect(corridor.state).toBe('ready');
    expect(corridor.streets).toBeGreaterThan(0);
    // The fixture's junctions in route order: the T comes first (its row is further south).
    expect(corridor.junctions).toHaveLength(FIXTURE_JUNCTIONS.length);
    FIXTURE_JUNCTIONS.forEach((fixture, index) => {
      const drawn = corridor.junctions[index];
      expect(drawn?.arms.map((arm) => arm.side)).toStrictEqual(fixture.arms.map((arm) => arm.side));
      expect(drawn?.meshAngles.map((arm) => arm.side)).toStrictEqual(
        fixture.arms.map((arm) => arm.side),
      );
      fixture.arms.forEach((arm, at) => {
        expect(Math.abs((drawn?.arms[at]?.angleDegrees ?? 0) - arm.angleDegrees)).toBeLessThan(2);
        expect(
          Math.abs((drawn?.meshAngles[at]?.angleDegrees ?? 0) - arm.angleDegrees),
        ).toBeLessThan(3);
      });
      expect(drawn?.triangles ?? 0).toBeGreaterThan(50);
    });
    console.log(
      `#1565 cross streets: ${corridor.junctions
        .map(
          (junction) =>
            `at ${junction.along.toFixed(0)} m, ${junction.meshAngles.map((arm) => `${arm.side > 0 ? 'right' : 'left'} ${arm.angleDegrees.toFixed(1)}°`).join(' and ')}, ${String(junction.triangles)} triangles`,
        )
        .join('; ')}`,
    );
  });

  test('control: with the streets layer off, there are none', async ({ page }) => {
    const corridor = await readCorridor(page, '?levers=-streets');
    expect(corridor.state).toBe('ready');
    expect(corridor.streets).toBeGreaterThan(0);
    expect(corridor.junctions).toStrictEqual([]);
  });
});

test.describe('#1539 the 600-tile corridor', () => {
  test('reads all 600 tiles at the harness origin — the floor of the budget', async ({ page }) => {
    const corridor = await readCorridor(page, '?long');
    expect(corridor.errors).toStrictEqual([]);
    expect(corridor.state).toBe('ready');
    expect(corridor.coveredTiles).toBe(CORRIDOR_MAX_TILES);
    // #1546: the mask of a 600-tile corridor, within its 8 MiB.
    expect(corridor.maskBytes).toBeLessThanOrEqual(LAND_CLASS_MAX_BYTES);
    console.log(
      `#1546 600-tile land-class mask: ${String(corridor.maskBytes)} bytes, built in ${corridor.maskMilliseconds.toFixed(1)} ms`,
    );
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
