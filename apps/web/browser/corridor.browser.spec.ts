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

async function readCorridor(page: Page, query = '', timeout = 30_000): Promise<CorridorHarness> {
  const response = await page.goto(`${HARNESS_ORIGIN}/corridor.html${query}`);
  expect(response?.ok()).toBe(true);
  await page.waitForFunction(() => window.__oylCorridor !== undefined, undefined, { timeout });
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
    // Only a load that asks for the town's timing pays for it (#1604).
    expect(corridor.townRatios).toStrictEqual([]);
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

/**
 * #1540's 400 ms, normalised for the runner (#1600, #1604). A fixed wall-clock
 * limit measured the load on a shared runner: the same town planned in 74 ms
 * to 87 ms on a laptop and 246 ms to 479 ms on CI, with no change to the
 * planner. The harness times a fixed non-planner workload in the same page
 * (`corridor-harness.ts` §`referenceWorkload`) next to each town sample, and
 * the gate is on the median of town ÷ reference across the pairs: 400 ms over
 * what the reference takes on the calibration machine. There the limit is
 * 400 ms exactly, as #1540 set it.
 *
 * {@link REFERENCE_AT_BUDGET_MS} was read on that laptop on 2026-10-23, in
 * eight runs of this spec: the reference's fastest sample was 59.6 ms to
 * 63.6 ms, alongside a town of 70.0 ms to 74.3 ms and a median ratio of 1.01
 * to 1.20. Three runs of the browser shard on CI read 1.24, 1.19 and 1.34.
 */
const TOWN_BUDGET_MS = 400;
const REFERENCE_AT_BUDGET_MS = 63;
const TOWN_RATIO_LIMIT = TOWN_BUDGET_MS / REFERENCE_AT_BUDGET_MS;

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

  test('plans the 2 000-footprint town in Chromium within its 400 ms, normalised for the runner', async ({
    page,
  }) => {
    // The timing takes 12-13 s on a CI runner (#1604): room for a runner several times slower.
    test.setTimeout(150_000);
    const corridor = await readCorridor(page, '?levers=towntime', 120_000);
    expect(corridor.errors).toStrictEqual([]);
    expect(corridor.townKept).toBe(2_000);
    console.log(
      `#1540 the dense town: 2000 footprints planned in ${corridor.townPlanMilliseconds.toFixed(1)} ms (fastest), reference ${corridor.referenceMilliseconds.toFixed(1)} ms (fastest), town/reference ${corridor.townRatio.toFixed(3)} (median of ${corridor.townRatios.map((ratio) => ratio.toFixed(3)).join(', ')}), limit ${TOWN_RATIO_LIMIT.toFixed(3)}`,
    );
    expect(corridor.referenceMilliseconds).toBeGreaterThan(0);
    expect(corridor.townRatios.length).toBeGreaterThanOrEqual(3);
    expect(corridor.townRatio).toBeLessThanOrEqual(TOWN_RATIO_LIMIT);
  });

  test('control: a planner sixteen times slower is over the same normalised budget (#1600, #1604)', async ({
    page,
  }) => {
    // 22-25 s on a CI runner (#1604's review): room for a runner several times slower.
    test.setTimeout(150_000);
    const corridor = await readCorridor(page, '?levers=slowplan', 120_000);
    expect(corridor.errors).toStrictEqual([]);
    console.log(
      `#1604 control: town/reference ${corridor.townRatio.toFixed(3)} with the planner run sixteen times, limit ${TOWN_RATIO_LIMIT.toFixed(3)}`,
    );
    expect(corridor.townRatio).toBeGreaterThan(TOWN_RATIO_LIMIT);
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

test.describe('#1633 the urban class, built once at the press', () => {
  test('a synthetic city reads a city-centre run through the page', async ({ page }) => {
    const corridor = await readCorridor(page);
    expect(corridor.errors).toStrictEqual([]);
    // `corridor-harness.ts` §`cityRuns`: a village, a city centre by height
    // then by commerce, a village, in rural land either side.
    // The last run ends where the fixture road does, which a profile's grid
    // lands within a few metres of its 3 km.
    expect(corridor.cityRuns.slice(0, 4)).toStrictEqual([
      { urban: 'rural', metres: 300 },
      { urban: 'village', metres: 600 },
      { urban: 'city-centre', metres: 1_000 },
      { urban: 'village', metres: 600 },
    ]);
    expect(corridor.cityRuns.slice(4).map((run) => run.urban)).toStrictEqual(['rural']);
    // #1633's cost: printed, and not gated.
    console.log(
      `#1633 the dense town: urban class of 2000 footprints built in ${corridor.townUrbanMilliseconds.toFixed(1)} ms`,
    );
  });

  test('the read corridor’s runs span its route, from the map its plans were handed', async ({
    page,
  }) => {
    const corridor = await readCorridor(page);
    expect(corridor.state).toBe('ready');
    expect(corridor.urbanRuns.length).toBeGreaterThan(0);
    const spanned = corridor.urbanRuns.reduce((sum, run) => sum + run.metres, 0);
    expect(spanned).toBeCloseTo(corridor.routeMetres, 6);
  });

  test('control: with no corridor there is no urban map, and no run', async ({ browser }) => {
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      await page.route('**/*.pmtiles', (route) => route.abort());
      const corridor = await readCorridor(page);
      expect(corridor.state).toBe('unavailable');
      expect(corridor.urbanRuns).toStrictEqual([]);
    } finally {
      await context.close();
    }
  });
});
