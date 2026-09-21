// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The home screen, measured in the pinned Chromium — #428.
 *
 * Two of #428's criteria are about layout and jsdom performs none: *"uses the
 * full width on a landscape tablet; does not overflow at 320 px"*. Read
 * `home-harness.tsx`'s header for what is rendered and for the control.
 */

import { expect, test, type Page } from '@playwright/test';

import type { HomeMeasurement } from './home-harness';

const SUBPIXEL_TOLERANCE = 1;

async function open(page: Page, width: number, height: number): Promise<HomeMeasurement> {
  await page.setViewportSize({ width, height });
  const response = await page.goto('/home.html');
  expect(
    response?.status(),
    'home.html did not load — is it named in vite.browser.config.ts build.rollupOptions.input?',
  ).toBe(200);
  await page.waitForFunction(() => window.__oylHome !== undefined);
  const published = await page.evaluate(() => ({
    ready: window.__oylHome?.ready,
    errors: window.__oylHome?.errors,
  }));
  expect(published.errors, 'the home harness reported an error').toEqual([]);
  expect(published.ready).toBe(true);
  return measure(page);
}

async function measure(page: Page): Promise<HomeMeasurement> {
  const measured = await page.evaluate(() => window.__oylHome?.measure());
  if (measured === undefined) throw new Error('the home harness published no measurement');
  return measured;
}

/** How many cards share the first row. */
const firstRow = (seen: HomeMeasurement): number =>
  seen.cards.filter((card) => Math.abs(card.top - (seen.cards[0]?.top ?? -1)) < 2).length;

test.describe('a landscape tablet — 1280×800', () => {
  test('the cards use the width: main runs to the window, and more than one card shares a row', async ({
    page,
  }) => {
    const seen = await open(page, 1280, 800);
    // The apparatus: a full history renders every card.
    expect(seen.cards.length).toBeGreaterThanOrEqual(4);
    expect(seen.mainClass).toBe('oyl-main oyl-main--dashboard');
    expect(seen.main?.right).toBeCloseTo(1280, 0);
    expect(firstRow(seen)).toBeGreaterThanOrEqual(3);
  });

  test('the control — under the reading measure the cards stop short of the window', async ({
    page,
  }) => {
    const seen = await open(page, 1280, 800);
    await page.evaluate(() => {
      window.__oylHome?.constrain();
    });
    const constrained = await measure(page);
    expect(constrained.main?.right ?? Infinity).toBeLessThan(1280 - 200);
    expect(firstRow(constrained)).toBeLessThan(firstRow(seen));
  });
});

for (const [width, height] of [
  [320, 256],
  [320, 568],
  [390, 844],
] as const) {
  test(`does not overflow at ${String(width)}×${String(height)}`, async ({ page }) => {
    const seen = await open(page, width, height);
    expect(seen.cards.length).toBeGreaterThanOrEqual(4);
    expect(seen.horizontalOverflow).toBeLessThanOrEqual(0);
    for (const card of seen.cards) {
      expect(card.right).toBeLessThanOrEqual(width + SUBPIXEL_TOLERANCE);
      expect(card.left).toBeGreaterThanOrEqual(-SUBPIXEL_TOLERANCE);
    }
  });
}
