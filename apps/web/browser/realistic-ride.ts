// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * One load of the owner's realistic page, read back as its spec files read it
 * — #616, and shared since #1698.
 *
 * Until #1698 this was the head of `realistic.browser.spec.ts`, and every
 * describe that loads `realistic.html` lived in that one file. Each lever adds
 * loads of the page, and the one file outgrew the nightly job that ran it
 * alone (run 40188796060: 840 s reached with every case green), so its
 * describes are three files now — `realistic.browser.spec.ts`,
 * `realistic-trees.browser.spec.ts` and `realistic-town.browser.spec.ts` —
 * each run by a nightly job of its own, and this is what they share.
 *
 * ⚠️ **A load is `ride(page, …)` or a helper named `ridden(page, …)`, and
 * `nightly-split.test.ts` counts them by those names** to hold each nightly
 * job's loads inside its stop. A load made another way is a load that count
 * does not see.
 */

import { expect, type Page } from '@playwright/test';

import type { RealisticSample } from './realistic-harness';

/** A realistic load's budget: the same 31 MiB `game.browser.spec.ts` §#607 pays for. */
export const REALISTIC_LOAD_BUDGET_MS = 150_000;

/** The route's default start, held still: a stretch with trees on it. */
export const HELD = '?ladder=0&panel=0&seconds=1&at=2550';

/**
 * What one held frame at `at=2550` makes, counted at the WebGL draw calls:
 * **34**, with the generated firs and with the scanned ones alike (two shapes
 * stand where two stood, and they add no call), on a Mac, 2026-10-24 — 31,
 * on a Mac and on the CI runner on 2026-10-12, and three for #1523's fir
 * pre-passes (`realistic-trees.browser.spec.ts`
 * §`FRAME_DRAW_CALLS_WITHOUT_PREPASS`). Held at the measured figure, so one
 * added call is a red test.
 *
 * ⚠️ **The page's mean read 32 to 35 for this frame until #1294**, because
 * its window also held the warm-up and the page's first render, which makes
 * 60 calls (`realistic-harness.ts` §`RealisticSample.drawCalls`). The window
 * now starts where the warm-up ends, so a held frame's mean IS its count, and
 * the tree levers' case holds the two equal.
 */
export const FRAME_DRAW_CALLS_AT_2550 = 34;

type Published = NonNullable<Window['__oylRealistic']>;

/** Loads `realistic.html` with `query` and returns what it published, refusing an error. */
export async function ride(
  page: Page,
  query: string,
  world: 'realistic' | 'stylised' = 'realistic',
): Promise<{ result: RealisticSample; page: Published }> {
  const response = await page.goto(`/realistic.html${query}`);
  expect(
    response?.status(),
    'realistic.html did not load — is it named in vite.browser.config.ts build.rollupOptions.input?',
  ).toBe(200);
  await page.waitForFunction(
    () =>
      window.__oylRealistic?.result !== undefined ||
      (window.__oylRealistic?.errors.length ?? 0) > 0,
    undefined,
    { timeout: REALISTIC_LOAD_BUDGET_MS },
  );
  const published = await page.evaluate(() => window.__oylRealistic);
  expect(published?.errors, `realistic.html${query} reported an error`).toEqual([]);
  const result = published?.result;
  if (published === undefined || result === undefined) {
    throw new Error(`realistic.html${query} published no result`);
  }
  if (world === 'realistic') {
    // Not vacuous: the realistic world itself, not the stylised fallback.
    expect(published.outcome?.loaded, JSON.stringify(published.outcome)).toBe(true);
  }
  expect(result.world).toBe(world);
  return { result, page: published };
}
