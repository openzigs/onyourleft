// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The owner's realistic page in a town, in the pinned Chromium — #1559,
 * #1657, #1624 and #1689; in a file of their own since #1698.
 *
 * - **The village road** (#1559): `?route=village` rides `route.ts`
 *   §`villageRoute`, and its hold at `VILLAGE_HOLD_METRES` is validation 0002
 *   AE2's frame: the page's census of the frame it drew holds a church and a
 *   row of shops in the camera's view, #1535's pavements and every kind of
 *   #1536's furniture.
 * - **The mapped-blobs lever** (#1657): `levers=-mapped-blobs` takes the
 *   mapped buildings' ground blobs out of the mixed town's frame, and nothing
 *   else.
 * - **The holiday decorations** (#1624): with `decorations=probe` and a day in
 *   Halloween, every anchor of the village in reach carries one box
 *   (`realistic/config.ts` §`PROBE_DECORATIONS`); with `levers=-decorations`
 *   there is no holiday. The difference is exactly one draw call, in both
 *   worlds, and its control is the belt's own triangles read off its mesh,
 *   which must be above nought — so a belt with nothing in it cannot pass by
 *   adding no call. The stylised world's half is NOT nightly: it runs in the
 *   required gate.
 * - **The village frame's freeze** (#1689): the decorated village hold draws
 *   exactly `realistic-budget.ts` §`REALISTIC_VILLAGE_DRAW_CALLS` calls, so a
 *   feature that adds a village call is red until it removes one, and a merge
 *   that saves one lowers the number.
 *
 * ⚠️ **Until #1698 these describes were in `realistic.browser.spec.ts`**,
 * which one nightly job ran alone until its loads outgrew the job's 840 s
 * stop. This file's nightly describes are a job of their own
 * (docs/agents/ci.md §4c §"Four nightly browser shards — #1698");
 * `realistic-ride.ts` is the load it shares with the page's other two files.
 */

import { expect, test } from '@playwright/test';

import { GROUND_BLOB_TRIANGLES } from '../src/game/ground-blob';
import {
  MAPPED_BUILDING_MAX,
  REALISTIC_DECORATION_TRIANGLES,
  REALISTIC_VILLAGE_DRAW_CALLS,
  REALISTIC_WOODED_DRAW_CALLS,
} from '../src/game/realistic-budget';

import { NIGHTLY } from './nightly';
import {
  realisticRoute,
  routeDigest,
  VILLAGE_HOLD_METRES,
  villageRoute,
} from '../src/demo/synthetic-road';
import { FRAME_DRAW_CALLS_AT_2550, HELD, REALISTIC_LOAD_BUDGET_MS, ride } from './realistic-ride';

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

test.describe('the realistic page’s city centre — #1636', { tag: NIGHTLY }, () => {
  test('draws a city centre’s shop fronts and its tower inside the page’s 35 calls', async ({
    page,
  }) => {
    test.setTimeout(2 * REALISTIC_LOAD_BUDGET_MS);
    // Inside `cityCentreFixture`'s city, held between its two towers; the
    // people off, so the frame is the city's and the road's.
    for (const at of [1_430, 1_500]) {
      const city = await ride(
        page,
        `?ladder=0&panel=0&seconds=1&town=city&at=${String(at)}&levers=-people`,
      );
      console.log(
        `#1636 town=city at=${String(at)}: ${String(city.result.lastFrame.triangles)} triangles in ` +
          `${String(city.result.lastFrame.calls)} draw calls`,
      );
      expect(city.result.lastFrame.calls).toBeGreaterThan(0);
      expect(city.result.lastFrame.calls).toBeLessThanOrEqual(REALISTIC_WOODED_DRAW_CALLS);
    }
    expect(REALISTIC_WOODED_DRAW_CALLS).toBe(35);
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
