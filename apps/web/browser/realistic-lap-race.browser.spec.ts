// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The owner's realistic page with a lap race drawn — #1972, for #1903's
 * tablet reading (ADR 0060 D-10.2).
 *
 * `?world=stylised&race=worst` hands every frame the worst case #1902/#1961
 * budgets: the rider and seven bots, five of the eight hit, every pick-up
 * point of a three-lap race and ten puddles, in the scenery-free STYLISED
 * frame, drawn by the product's own belt. The frame is held to
 * `realistic-budget.ts` §`LAP_RACE_SCENE_DRAW_CALLS` — the ceiling the page
 * reports for the frame it drew — and the controls are that the belt drew
 * every piece it was handed, that the page's three surfaces (its published
 * state, its `OYL-REALISTIC` line and its readout) all say a race was drawn,
 * and that a load with no race says none and keeps the village's ceiling.
 *
 * Required, not nightly: the stylised world is every rider's, it fetches none
 * of the realistic set, and the load is one of about four seconds. What a
 * frame of it COSTS on the tablet's GPU is the owner's reading, taken from
 * this page, once it is staged into the debug APK (`realistic:stage`).
 */

import { expect, test } from '@playwright/test';

import {
  DELIVERY_VILLAGE_DRAW_CALLS,
  LAP_RACE_SCENE_DRAW_CALLS,
  REALISTIC_VILLAGE_DRAW_CALLS,
  STYLISED_SCENE_DRAW_CALLS,
} from '../src/game/realistic-budget';

import { REALISTIC_LOAD_BUDGET_MS, ride } from './realistic-ride';

/** The held frame, as `realistic-delivery.browser.spec.ts` holds its own, in the stylised world. */
const HELD = '?world=stylised&ladder=0&seconds=1&at=2550';
const RACING = `${HELD}&panel=0&race=worst`;

test.describe('the realistic page’s lap race — #1972', () => {
  test('draws the rider and seven bots with every pick-up point and ten puddles inside LAP_RACE_SCENE_DRAW_CALLS', async ({
    page,
  }) => {
    test.setTimeout(REALISTIC_LOAD_BUDGET_MS);
    const raced = await ride(page, RACING, 'stylised');
    console.log(
      `#1972 stylised, racing ${JSON.stringify(raced.page.race)}: ` +
        `${String(raced.result.lastFrame.calls)} draw calls a frame ` +
        `(the page's mean ${String(raced.result.drawCalls)}), ` +
        `${String(raced.result.lastFrame.triangles)} triangles, frame ms ` +
        `${JSON.stringify(raced.result.frameMs)}, held to ${String(raced.page.raceCeiling)}`,
    );
    // Not vacuous: the belt drew every piece it was handed, read back off its instances.
    expect(raced.page.race).toEqual({ racers: 8, pickUps: 9, hazards: 10, hits: 5 });
    // The three numbers the issue leaves unchanged, written out so moving one fails here.
    expect(LAP_RACE_SCENE_DRAW_CALLS).toBe(14);
    expect(REALISTIC_VILLAGE_DRAW_CALLS).toBe(50);
    expect(DELIVERY_VILLAGE_DRAW_CALLS).toBe(53);
    // The ceiling the page chose for the frame it drew is the race's, and the frame is inside it.
    expect(raced.page.raceCeiling).toBe(LAP_RACE_SCENE_DRAW_CALLS);
    expect(raced.result.lastFrame.calls).toBeLessThanOrEqual(LAP_RACE_SCENE_DRAW_CALLS);
    // And it is a ceiling a race needs: the scenery-free frame alone is 11, the belt's three on top.
    expect(raced.result.lastFrame.calls).toBeGreaterThan(STYLISED_SCENE_DRAW_CALLS);
    // A race is not a village: the village's ceiling is no part of what the page published.
    expect(raced.page.villageCeiling).toBeUndefined();
    // A held frame's mean is its count (#1294).
    expect(raced.result.drawCalls).toBe(raced.result.lastFrame.calls);
  });

  test('says on its OYL-REALISTIC line and its readout that a race was drawn, and what the belt drew', async ({
    page,
  }) => {
    test.setTimeout(REALISTIC_LOAD_BUDGET_MS);
    const lines: string[] = [];
    page.on('console', (message) => {
      if (message.text().startsWith('OYL-REALISTIC {')) lines.push(message.text());
    });
    await ride(page, HELD.replace('?', '?race=worst&'), 'stylised');
    // The line `adb logcat` shows: the result, and the race beside it.
    expect(lines).toHaveLength(1);
    const logged = JSON.parse((lines[0] ?? '').slice('OYL-REALISTIC '.length)) as {
      race?: unknown;
      world?: unknown;
    };
    expect(logged.world).toBe('stylised');
    expect(logged.race).toEqual({ racers: 8, pickUps: 9, hazards: 10, hits: 5 });
    // The readout at the top of the page, which the tablet shows the owner.
    await expect(page.locator('pre')).toContainText(
      'lap race: 8 racers, 9 pick-ups, 10 puddles, 5 hits',
    );
  });

  test('a load with no race says none, and keeps the village ceiling', async ({ page }) => {
    test.setTimeout(REALISTIC_LOAD_BUDGET_MS);
    const lines: string[] = [];
    page.on('console', (message) => {
      if (message.text().startsWith('OYL-REALISTIC {')) lines.push(message.text());
    });
    const ordinary = await ride(page, `${HELD}&panel=0`, 'stylised');
    expect(ordinary.page.race).toBeUndefined();
    expect(ordinary.page.raceCeiling).toBeUndefined();
    expect(ordinary.page.villageCeiling).toBe(REALISTIC_VILLAGE_DRAW_CALLS);
    expect(lines).toHaveLength(1);
    expect(JSON.parse((lines[0] ?? '').slice('OYL-REALISTIC '.length))).not.toHaveProperty('race');
  });
});
