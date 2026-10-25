// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The owner's realistic page in a village, in the pinned Chromium — #1559,
 * #1624 and #1689; in a file of their own since #1698.
 *
 * - **The village road** (#1559): `?route=village` rides `route.ts`
 *   §`villageRoute`, and its hold at `VILLAGE_HOLD_METRES` is validation 0002
 *   AE2's frame: the page's census of the frame it drew holds a church and a
 *   row of shops in the camera's view, #1535's pavements and every kind of
 *   #1536's furniture.
 * - **The holiday decorations** (#1624, #1625): on a day in Halloween, the
 *   village in reach carries the product's own pumpkins and jack-o'-lanterns
 *   (`decorations.ts` §`HOLIDAY_DECORATIONS`; until #1625 a probe box on
 *   every anchor); with `levers=-decorations` there is no holiday. Since
 *   #1626 the same on 20 Dec in the winter lights (the mapped doors' wreath,
 *   drawn in the facade, is `realistic-wreath.browser.spec.ts`', in another
 *   shard). The difference is exactly one draw call, in both
 *   worlds, and its control is the belt's own triangles read off its mesh,
 *   which must be above nought — so a belt with nothing in it cannot pass by
 *   adding no call. The stylised world's half is NOT nightly: it runs in the
 *   required gate.
 * - **The village frame's freeze** (#1689): the decorated village hold draws
 *   exactly `realistic-budget.ts` §`REALISTIC_VILLAGE_DRAW_CALLS` calls, so a
 *   feature that adds a village call is red until it removes one, and a merge
 *   that saves one lowers the number.
 *
 * ⚠️ **The mapped towns' describes — the mapped-blobs lever (#1657) and the
 * city centre (#1636) — are in `realistic-mapped.browser.spec.ts`** since the
 * combined PR that brought #1636 and #1689 together: with both, this file's
 * loads passed the 7 a shard may hold (`nightly-split.test.ts`, #1698).
 *
 * ⚠️ **Until #1698 these describes were in `realistic.browser.spec.ts`**,
 * which one nightly job ran alone until its loads outgrew the job's 840 s
 * stop. This file's nightly describes are a job of their own
 * (docs/agents/ci.md §4c §"Four nightly browser shards — #1698");
 * `realistic-ride.ts` is the load it shares with the page's other two files.
 */

import { expect, test } from '@playwright/test';

import {
  REALISTIC_DECORATION_TRIANGLES,
  REALISTIC_VILLAGE_DRAW_CALLS,
  REALISTIC_WINTER_LIGHTS_TRIANGLES,
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

/**
 * #1624, #1625: the village road's hold, on Halloween, with the product's
 * own pumpkins on the houses in reach — and the same with the holiday
 * switched off.
 */
const DECORATED = `?ladder=0&panel=0&seconds=1&at=${String(VILLAGE_HOLD_METRES)}&route=village&date=2026-10-31`;

test.describe('the realistic page’s holiday decorations, stylised — #1624', () => {
  test('draws Halloween’s pumpkins on the houses in reach in ONE call more than with decorations off', async ({
    page,
  }) => {
    test.setTimeout(REALISTIC_LOAD_BUDGET_MS);
    const on = await ride(page, `${DECORATED}&world=stylised`, 'stylised');
    const off = await ride(page, `${DECORATED}&world=stylised&levers=-decorations`, 'stylised');
    console.log(
      `#1624 stylised: ${String(on.result.lastFrame.calls)} draw calls with the pumpkins ` +
        `(${JSON.stringify(on.page.decorations)}), ${String(off.result.lastFrame.calls)} without`,
    );
    expect(off.result.leversOff).toEqual(['decorations']);
    // The control: the belt holds pumpkins, so the delta is not vacuous.
    expect(on.page.decorations?.triangles ?? 0).toBeGreaterThan(0);
    expect(on.page.decorations?.triangles ?? 0).toBeLessThanOrEqual(REALISTIC_DECORATION_TRIANGLES);
    expect(off.page.decorations?.triangles).toBe(0);
    expect(on.result.lastFrame.calls - off.result.lastFrame.calls).toBe(1);
    // The same triangles more, and no others: the belt is all that differs.
    expect(on.result.lastFrame.triangles - off.result.lastFrame.triangles).toBe(
      on.page.decorations?.triangles,
    );
  });

  test('draws the winter lights and the village doors’ wreaths in ONE call more, inside the page’s ceiling — #1626', async ({
    page,
  }) => {
    test.setTimeout(REALISTIC_LOAD_BUDGET_MS);
    const on = await ride(page, `${WINTER}&world=stylised`, 'stylised');
    const off = await ride(page, `${WINTER}&world=stylised&levers=-decorations`, 'stylised');
    console.log(
      `#1626 stylised: ${String(on.result.lastFrame.calls)} draw calls with the winter lights ` +
        `(${JSON.stringify(on.page.decorations)}), ${String(off.result.lastFrame.calls)} without`,
    );
    expect(on.page.decorations?.triangles ?? 0).toBeGreaterThan(0);
    expect(on.page.decorations?.triangles ?? 0).toBeLessThanOrEqual(
      REALISTIC_WINTER_LIGHTS_TRIANGLES,
    );
    expect(off.page.decorations?.triangles).toBe(0);
    expect(on.result.lastFrame.calls - off.result.lastFrame.calls).toBe(1);
    expect(on.result.lastFrame.triangles - off.result.lastFrame.triangles).toBe(
      on.page.decorations?.triangles,
    );
    // The stylised village frame is inside the page's ceiling with them.
    expect(on.result.lastFrame.calls).toBeLessThanOrEqual(REALISTIC_WOODED_DRAW_CALLS);
  });
});

/**
 * #1626: the village road's hold in the winter lights — lamp posts wound,
 * eaves strung, village doors wreathed — and the same with the holiday off.
 */
const WINTER = `?ladder=0&panel=0&seconds=1&at=${String(VILLAGE_HOLD_METRES)}&route=village&date=2026-12-20`;

test.describe('the realistic page’s holiday decorations — #1624', { tag: NIGHTLY }, () => {
  test('draws Halloween’s pumpkins in ONE call, inside the frame’s calls and its own triangles, fetching nothing more', async ({
    page,
  }) => {
    test.setTimeout(4 * REALISTIC_LOAD_BUDGET_MS);
    const fetched: string[] = [];
    // What the page fetched over the network: not the `blob:` URLs it makes
    // of what it has already decoded, which are new names every load.
    page.on('request', (request) => {
      if (!request.url().startsWith('blob:')) fetched.push(new URL(request.url()).pathname);
    });
    const on = await ride(page, DECORATED);
    const withPumpkins = [...fetched].sort();
    fetched.length = 0;
    const off = await ride(page, `${DECORATED}&levers=-decorations`);
    const without = [...fetched].sort();
    console.log(
      `#1624 realistic: ${String(on.result.lastFrame.calls)} draw calls and ` +
        `${String(on.result.lastFrame.triangles)} triangles with the pumpkins ` +
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
    // Zero bytes (ruling (c)): the pumpkins are built from numbers, so the page
    // fetches exactly what it fetches with no holiday.
    expect(withPumpkins).toEqual(without);
    expect(off.result.rung).toBe(on.result.rung);

    // ⚠️ **The ceiling is held on the wooded frame it was set for, not on the
    // village's.** #1624 asked for the village view at or under
    // `REALISTIC_WOODED_DRAW_CALLS`, and on `main` before #1624 that frame
    // already makes 58 calls with no decoration at all (2026-10-24, on a Mac
    // and in the pinned Chromium) — every structure kind, the furniture's
    // four kinds, the pavements and the people. The belt's own share of it is
    // the one call held above; since #1689 the village frame is frozen at
    // `REALISTIC_VILLAGE_DRAW_CALLS` by its own test below, and #1625's
    // pumpkins add no call to it past the belt's one, the delta held above.
    // With the pumpkins and a holiday on, the wooded hold is the frame THIS
    // ceiling counts.
    const wooded = await ride(page, `${HELD}&date=2026-10-31`);
    console.log(
      `#1624 at=2550 on Halloween: ${String(wooded.result.lastFrame.calls)} draw calls ` +
        `(${JSON.stringify(wooded.page.decorations)})`,
    );
    expect(wooded.result.lastFrame.calls).toBeLessThanOrEqual(REALISTIC_WOODED_DRAW_CALLS);
    expect(wooded.result.lastFrame.calls).toBe(FRAME_DRAW_CALLS_AT_2550);

    // #1626: the winter lights on the same hold, against the same frame with
    // no holiday. ⚠️ **One load shared, not one each**: this shard's loads are
    // held inside 60 % of its stop (`nightly-split.test.ts`, #1698), and the
    // frame with no holiday is the same on 31 Oct and 20 Dec — 58 calls and
    // 153 681 triangles on both, measured 2026-10-25 in the pinned Chromium —
    // because the route's season is uniforms and colours, not geometry.
    const winter = await ride(page, WINTER);
    console.log(
      `#1626 realistic: ${String(winter.result.lastFrame.calls)} draw calls with the winter ` +
        `lights (${JSON.stringify(winter.page.decorations)}), ${String(off.result.lastFrame.calls)} without`,
    );
    expect(winter.page.decorations?.triangles ?? 0).toBeGreaterThan(0);
    expect(winter.page.decorations?.triangles ?? 0).toBeLessThanOrEqual(
      REALISTIC_WINTER_LIGHTS_TRIANGLES,
    );
    expect(winter.result.lastFrame.calls - off.result.lastFrame.calls).toBe(1);
    expect(winter.result.lastFrame.triangles - off.result.lastFrame.triangles).toBe(
      winter.page.decorations?.triangles,
    );
  });
});

test.describe('the realistic page’s village frame, frozen — #1689', { tag: NIGHTLY }, () => {
  test('draws the decorated village hold in exactly REALISTIC_VILLAGE_DRAW_CALLS calls', async ({
    page,
  }) => {
    test.setTimeout(REALISTIC_LOAD_BUDGET_MS);
    // #1624's frame: the village hold, the ladder held at the top rung, on
    // Halloween — since #1625 with the product's own pumpkins in reach rather
    // than the probe — so the decoration belt's one call is inside the
    // figure, as the owner's ruling counts it.
    const village = await ride(page, DECORATED);
    console.log(
      `#1689 route=village at=${String(VILLAGE_HOLD_METRES)}, decorated: ` +
        `${String(village.result.lastFrame.calls)} draw calls a frame (the page's mean ` +
        `${String(village.result.drawCalls)}), ${String(village.result.lastFrame.triangles)} ` +
        `triangles, frozen at ${String(REALISTIC_VILLAGE_DRAW_CALLS)}`,
    );
    // Not vacuous: the village is in frame, and the belt holds pumpkins.
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
