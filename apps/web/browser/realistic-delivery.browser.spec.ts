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
 * A file of its own because `realistic-town.browser.spec.ts` holds the 7
 * loads a nightly shard may (`nightly-split.test.ts`, #1698); this one runs
 * in `browser-5`, beside `realistic-mapped.browser.spec.ts`.
 */

import { expect, test } from '@playwright/test';

import {
  DELIVERY_VILLAGE_DRAW_CALLS,
  REALISTIC_VILLAGE_DRAW_CALLS,
} from '../src/game/realistic-budget';
import { VILLAGE_HOLD_METRES } from '../src/demo/synthetic-road';

import { NIGHTLY } from './nightly';
import { REALISTIC_LOAD_BUDGET_MS, ride } from './realistic-ride';

/** #1814's worst case, as its own gate counts it: twenty of each piece. */
const PIECES = 20;

/** #1689's frame, exactly as `realistic-town.browser.spec.ts` §`DECORATED` writes it, with a round. */
const DELIVERING = `?ladder=0&panel=0&seconds=1&at=${String(VILLAGE_HOLD_METRES)}&route=village&date=2026-10-31&delivery=${String(PIECES)}`;

test.describe('the realistic page’s village frame, delivering — #1815', { tag: NIGHTLY }, () => {
  test('draws the decorated village hold with a Delivery round’s worst case inside DELIVERY_VILLAGE_DRAW_CALLS', async ({
    page,
  }) => {
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
    // And it is a ceiling Delivery needs: the same frame is over the frozen 50 by the belt's calls.
    expect(village.result.lastFrame.calls).toBeGreaterThan(REALISTIC_VILLAGE_DRAW_CALLS);
    // A held frame's mean is its count (#1294).
    expect(village.result.drawCalls).toBe(village.result.lastFrame.calls);
  });
});
