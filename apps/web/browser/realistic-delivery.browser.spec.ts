// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The owner's realistic page's village frame while a Delivery round runs —
 * #1815, on the owner's ruling DL6b of 2026-10-27 (epic #1803, ADR 0059 D-3).
 *
 * The frame is `realistic-town.browser.spec.ts` §"#1689"'s — the village
 * road's hold on Halloween, the top rung held — with `?delivery=20`: twenty
 * parcels, twenty house markers and twenty obstacles, every kind among them,
 * drawn by the product's own belt (`realistic/delivery.ts`). It is held to
 * `realistic-budget.ts` §`DELIVERY_VILLAGE_DRAW_CALLS`, the ceiling the page
 * reports for the frame it drew, and the controls are that the belt drew
 * every piece it was handed and the village is in frame.
 *
 * ⚠️ **The ordinary ride's half is not here.** The same frame with no round
 * is #1689's freeze at exactly `REALISTIC_VILLAGE_DRAW_CALLS`, in
 * `realistic-town.browser.spec.ts`, which #1815 does not touch; that the
 * Delivery ceiling is never what an ordinary frame is held to is
 * `realistic-budget-village.test.ts`, in the required suite.
 *
 * #2362 adds the same round on the synthetic fixture level (`town=level`):
 * the level's line and its own file's footprints, with every obstacle kind a
 * parked car among them, still in the one instanced mesh, held to the same
 * ceiling. Here and not in `realistic-town.browser.spec.ts`, which #2362's
 * issue names, because that file already holds the loads its nightly shard
 * may (`nightly-split.test.ts`).
 *
 * A file of its own because `realistic-town.browser.spec.ts` holds the 7
 * loads a nightly shard may (`nightly-split.test.ts`, #1698); this one runs
 * in `browser-5`, beside `realistic-mapped.browser.spec.ts`.
 *
 * ## #2453 — a house marker and a pick-up point, seen from 100 m
 *
 * The owner, on the tablet's realistic world, 2026-11-10: "I don't know
 * which houses I am supposed to deliver to", and in a lap race with items on,
 * "I am not seeing any items to pick up", while the HUD's item field showed
 * the rider collecting one. The pieces were in the frame and drawn; they were
 * too SMALL to see coming. On this page's village hold at the tablet's
 * 1280×800, ONE marker 100 m up the road changed 2 pixels of the frame and
 * ONE pick-up point 115, in either world (`realistic/sighting.ts`).
 *
 * Each must now change at least {@link SIGHTED_PIXELS} from 100 m: the floor
 * `lap-race.browser.spec.ts` §"#1969" holds a pick-up point to from 50 m,
 * there chosen as about four times what a thin line changed, now at the
 * issue's distance. Its controls: the same piece 50 m BEHIND the rider changes
 * nothing, so the count is the piece and not two renders differing; and the
 * frame with each is attached for the owner. The realistic world's half is
 * nightly, as every realistic load is (#866), and pays for no load of its
 * own: it is read off #1815's decorated village hold once that case has held
 * its ceilings, the page resized to the tablet's frame and the round taken
 * off the frame it draws again (`nightly-split.test.ts` holds this shard to
 * the loads it has). The stylised world's, on the same page and road, is
 * required, so the size cannot shrink back unseen.
 */

import { expect, test, type Page, type TestInfo } from '@playwright/test';

import {
  DELIVERY_VILLAGE_DRAW_CALLS,
  DELIVERY_VILLAGE_FRAME_TRIANGLES,
  REALISTIC_VILLAGE_DRAW_CALLS,
} from '../src/game/realistic-budget';
import { VILLAGE_HOLD_METRES } from '../src/demo/synthetic-road';
import { REALISTIC_DUSK_EXPOSURE_SHARE, REALISTIC_EXPOSURE } from '../src/game/realistic-light';

import { NIGHTLY } from './nightly';
import { REALISTIC_LOAD_BUDGET_MS, ride } from './realistic-ride';

/**
 * #2453: the fewest pixels one house marker, or one pick-up point, may change
 * on a 1280×800 frame from {@link SIGHTED_FROM_METRES} up the road. Before
 * #2453 they changed 2 and 115 there; after it, about 630 and 510.
 */
const SIGHTED_PIXELS = 400;

/** #2453's distance: the issue's "reads clearly from at least 100 m". */
const SIGHTED_FROM_METRES = 100;

/** The village hold in the stylised world, with no round and no race and the panel off. */
const SIGHTED = `?world=stylised&ladder=0&panel=0&seconds=1&at=${String(VILLAGE_HOLD_METRES)}&route=village`;

/**
 * #2453: the page already loaded, at the owner's tablet's 1280×800, its last
 * frame drawn again with ONE house marker and then ONE pick-up point
 * {@link SIGHTED_FROM_METRES} up the road, and with each 50 m behind the
 * rider as the control. Each frame is attached for the owner.
 */
async function seenFromAfar(page: Page, testInfo: TestInfo, world: string): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 800 });
  // Two frames, so the page has drawn at the new size before it is read.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
  for (const piece of ['marker', 'pick-up'] as const) {
    const seen = await page.evaluate(
      ([what, from]) => {
        const sight = window.__oylRealisticSighting;
        const canvas = document.querySelector('canvas');
        if (sight === undefined || canvas === null)
          throw new Error('the page published no sighting');
        return {
          buffer: [canvas.width, canvas.height],
          far: sight(what, from, true),
          // The control: behind the rider, inside the corridor's 60 m.
          behind: sight(what, -50),
        };
      },
      [piece, SIGHTED_FROM_METRES] as const,
    );
    const { photo, ...far } = seen.far;
    console.log(
      `#2453 ${world} ${piece} from ${String(SIGHTED_FROM_METRES)} m: ${JSON.stringify(far)}`,
    );
    expect(seen.buffer).toEqual([1280, 800]);
    expect(seen.behind.changed, `${piece} behind the rider`).toBe(0);
    expect(far.changed, `${piece} from ${String(SIGHTED_FROM_METRES)} m`).toBeGreaterThanOrEqual(
      SIGHTED_PIXELS,
    );
    if (photo !== undefined) {
      await testInfo.attach(`${world}-${piece}-${String(SIGHTED_FROM_METRES)}m`, {
        body: Buffer.from(photo.slice(photo.indexOf(',') + 1), 'base64'),
        contentType: 'image/png',
      });
    }
  }
}

/** #1814's worst case, as its own gate counts it: twenty of each piece. */
const PIECES = 20;

/** #1689's frame, exactly as `realistic-town.browser.spec.ts` §`DECORATED` writes it, with a round. */
const DELIVERING = `?ladder=0&panel=0&seconds=1&at=${String(VILLAGE_HOLD_METRES)}&route=village&date=2026-10-31&delivery=${String(PIECES)}`;

/**
 * #2362: on the fixture level, half way along, its footprints either side
 * (ADR 0065 D-7.5). Since #2366 in rain and at dusk, a level's worst case:
 * the rain's one call on top of the round's, and the dusk's dimmer light,
 * which costs none. One load, because this shard's loads of the page are
 * counted (`nightly-split.test.ts` §"#1698") and it has none to spare.
 */
const LEVEL_HOLD_METRES = 1000;
const ON_THE_LEVEL = `?ladder=0&panel=0&seconds=1&at=${String(LEVEL_HOLD_METRES)}&town=level&delivery=${String(PIECES)}&weather=rain-dusk`;

test.describe('the realistic page’s village frame, delivering — #1815', { tag: NIGHTLY }, () => {
  test('draws the decorated village hold with a Delivery round’s worst case inside DELIVERY_VILLAGE_DRAW_CALLS', async ({
    page,
  }, testInfo) => {
    test.setTimeout(REALISTIC_LOAD_BUDGET_MS);
    const village = await ride(page, DELIVERING);
    console.log(
      `#1815 route=village at=${String(VILLAGE_HOLD_METRES)}, decorated, delivering ` +
        `${JSON.stringify(village.page.delivery)}: ${String(village.result.lastFrame.calls)} ` +
        `draw calls a frame (the page's mean ${String(village.result.drawCalls)}), ` +
        `${String(village.result.lastFrame.triangles)} triangles, frame ms ` +
        `${JSON.stringify(village.result.frameMs)}, held to ${String(village.page.villageCeiling)}`,
    );
    // Not vacuous: the village is in frame, and the belt drew every piece it was handed.
    const census = village.page.census;
    if (census === undefined) throw new Error('the page published no census');
    expect(census.structures.church.inView).toBeGreaterThanOrEqual(1);
    expect(census.structures['shop-row'].inView).toBeGreaterThanOrEqual(1);
    expect(village.page.decorations?.triangles ?? 0).toBeGreaterThan(0);
    expect(village.page.delivery).toEqual({ parcels: PIECES, markers: PIECES, obstacles: PIECES });
    // The ceiling the page chose for the frame it drew is Delivery's, not the frozen one.
    expect(village.page.villageCeiling).toBe(DELIVERY_VILLAGE_DRAW_CALLS);
    expect(village.result.lastFrame.calls).toBeLessThanOrEqual(DELIVERY_VILLAGE_DRAW_CALLS);
    // #2362, round 6: and its triangles, which the belt's three calls do not bound.
    expect(village.result.lastFrame.triangles).toBeLessThanOrEqual(
      DELIVERY_VILLAGE_FRAME_TRIANGLES,
    );
    // And it is a ceiling Delivery needs: the same frame is over the frozen 50 by the belt's calls.
    expect(village.result.lastFrame.calls).toBeGreaterThan(REALISTIC_VILLAGE_DRAW_CALLS);
    // A held frame's mean is its count (#1294).
    expect(village.result.drawCalls).toBe(village.result.lastFrame.calls);
    // #2453: the same load in the realistic world, a marker and a pick-up point from 100 m.
    await seenFromAfar(page, testInfo, 'realistic');
  });

  test('draws a round on the fixture level, a parked car among the obstacles, in rain and at dusk, inside DELIVERY_VILLAGE_DRAW_CALLS — #2362, #2366', async ({
    page,
  }) => {
    test.setTimeout(REALISTIC_LOAD_BUDGET_MS);
    const level = await ride(page, ON_THE_LEVEL);
    console.log(
      `#2362 town=level at=${String(LEVEL_HOLD_METRES)}, delivering ` +
        `${JSON.stringify(level.page.delivery)}: ${String(level.result.lastFrame.calls)} ` +
        `draw calls a frame (the page's mean ${String(level.result.drawCalls)}), ` +
        `${String(level.result.lastFrame.triangles)} triangles, held to ${String(level.page.villageCeiling)}`,
    );
    // Not vacuous: the belt drew every piece, every kind with a parked car among them.
    expect(level.page.delivery).toEqual({ parcels: PIECES, markers: PIECES, obstacles: PIECES });
    expect(level.page.villageCeiling).toBe(DELIVERY_VILLAGE_DRAW_CALLS);
    expect(level.result.lastFrame.calls).toBeLessThanOrEqual(DELIVERY_VILLAGE_DRAW_CALLS);
    expect(level.result.lastFrame.triangles).toBeLessThanOrEqual(DELIVERY_VILLAGE_FRAME_TRIANGLES);
    expect(level.result.drawCalls).toBe(level.result.lastFrame.calls);
    // #2366: the rain was drawn, in its one call, and the realistic world's exposure dimmed for dusk.
    expect(level.page.weather?.rain).toBe(true);
    expect(level.page.weather?.exposure).toBeCloseTo(
      REALISTIC_EXPOSURE * REALISTIC_DUSK_EXPOSURE_SHARE,
      6,
    );
    // PR #2522: the plants, the hedges and the far impostors went down with the
    // ground — darker, and warm — and no streak stood by the camera.
    const back = level.page.weather?.readback;
    console.log(`PR #2522 realistic weather readback: ${JSON.stringify(back)}`);
    for (const shade of [back?.foliageShade, back?.impostorSun]) {
      expect(shade?.[0] ?? Infinity).toBeLessThan(0.6);
      expect(shade?.[0] ?? 0).toBeGreaterThan((shade?.[2] ?? Infinity) * 1.2);
    }
    expect(back?.rainClearance ?? 0).toBeGreaterThanOrEqual(2.5);
  });
});

test.describe('the realistic page’s stylised world: a house marker and a pick-up point seen from 100 m — #2453', () => {
  test(`changes at least ${String(SIGHTED_PIXELS)} pixels of a 1280×800 frame with each, and none with either behind the rider`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(REALISTIC_LOAD_BUDGET_MS);
    await ride(page, SIGHTED, 'stylised');
    await seenFromAfar(page, testInfo, 'stylised');
  });
});
