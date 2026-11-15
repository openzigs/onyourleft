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

/**
 * A sixteenth of the default 1280 × 720 page, and the same 16:9 shape — #1915,
 * and since #1937 the page of every nightly case that loads a mapped town.
 *
 * A case that counts a frame's draw calls and triangles reads what the frustum
 * decides, and the frustum is the canvas's SHAPE, not its size: the renderer's
 * resize hands the camera only the aspect (`three-renderer.ts` §`#applySize`).
 * What the size does decide is each frame's fill under SwiftShader, and the
 * page publishes only after a second of frames each under
 * `MAXIMUM_FRAME_GAP_MS` (1 s, `realistic/loop.ts`), a slower one being a
 * stall that counts for nothing. On an EPYC 7763 runner a 1280 × 720 frame of
 * a mapped town, with #1884's rooms behind the glass, came near that second,
 * so a load waited on chance: 25 s to over 160 s, and past a case's 300 s.
 *
 * ⚠️ **Not for a case that reads a frame time**, which is the size's to
 * decide. A case on this page asserts `result.drawingBuffer` is this size, so
 * a later change cannot quietly put the expensive frames back.
 */
export const SIXTEENTH_PAGE = { width: 320, height: 180 } as const;

/**
 * A load's p50/p90 frame time, frame count and stalls, for a case's log line,
 * so that its CI readings can be compared with each other — #1937.
 */
export function frameReading({ frameMs, stalls }: RealisticSample): string {
  return (
    `${String(Math.round(frameMs.p50))}/${String(Math.round(frameMs.p90))} ms, ` +
    `${String(frameMs.count)} frames, ${String(stalls)} stall(s)`
  );
}

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
