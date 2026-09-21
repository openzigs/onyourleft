// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The start of a loop, measured in the pinned Chromium — #440.
 *
 * ⚠️ **Read `loop-harness.ts`'s header first**: it records the cause, which is
 * in `packages/domain/src/route/profile.ts` and not in the camera, and why the
 * control is a profile exactly as a pre-#440 build stored one. The camera is
 * untouched by the fix, and deliberately: moving it until the break is out of
 * frame is #348 → #355's trap in reverse.
 *
 * What this does NOT prove: that the owner's own route is fixed. A route saved
 * before #440 keeps its gap in its stored profile until it is imported again —
 * validation 0002 Part Q says so, and asks for exactly that.
 */

import { expect, test, type Page } from '@playwright/test';

import type { LoopStartMeasurement, RoadRows } from './loop-harness';

/** How far from the middle of the frame the far road may converge. */
const CENTRED_WITHIN = 0.05;
/** How far off the middle the control must put it, to count as the break. */
const BROKEN_BEYOND = 0.15;

async function measure(page: Page): Promise<LoopStartMeasurement> {
  const response = await page.goto('/loop.html');
  expect(
    response?.status(),
    'loop.html did not load — is it named in vite.browser.config.ts build.rollupOptions.input?',
  ).toBe(200);
  await page.waitForFunction(() => window.__oylLoop !== undefined);
  const published = await page.evaluate(() => window.__oylLoop);
  expect(published?.errors, 'the loop harness reported an error').toEqual([]);
  const measurement = published?.measurement;
  if (measurement === undefined) {
    throw new Error('the loop harness published no measurement');
  }
  return measurement;
}

function describe(rows: RoadRows): string {
  return `far road centred at ${(rows.aheadCentre * 100).toFixed(1)} % of the width, ${String(
    rows.roadPixels,
  )} road pixels`;
}

test.describe('the start of a loop — #440', () => {
  test('the harness drew a road in both frames', async ({ page }) => {
    const { closed, stored, width, height } = await measure(page);
    // The apparatus: a frame that drew no road "converges" nowhere, and 0 is
    // far from the middle, so the control below would pass over nothing.
    expect(closed.roadPixels).toBeGreaterThan((width * height) / 10);
    expect(stored.roadPixels).toBeGreaterThan((width * height) / 10);
    expect(closed.gapMetres).toBeGreaterThan(10);
  });

  test('the road is continuous at the start: the camera looks down it, and no row splits', async ({
    page,
  }) => {
    const { closed } = await measure(page);
    expect(Math.abs(closed.aheadCentre - 0.5), describe(closed)).toBeLessThanOrEqual(
      CENTRED_WITHIN,
    );
    expect(closed.runs.filter((count) => count > 1)).toEqual([]);
  });

  test('the control — the same loop as a pre-#440 build stored it is broken', async ({ page }) => {
    // ⚠️ The defect, on every run. Without it "the camera looks down the road"
    // is equally true of a harness that happened to build a straight road.
    const { stored } = await measure(page);
    expect(Math.abs(stored.aheadCentre - 0.5), describe(stored)).toBeGreaterThan(BROKEN_BEYOND);
  });
});
