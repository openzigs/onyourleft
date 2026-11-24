// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * An open-world ride through new areas builds no shader program after its
 * first frame — #3107.
 *
 * The owner's tablet, 2026-11-23: a new area loading stalled the ride for
 * 0.9 s to 1.2 s, three times a minute, inside three's `setProgram` — a WebGL
 * program linked the first time a material was drawn, mid-ride. The ride's
 * first frame is prepared off the screen with every program it needs
 * (`three-renderer.ts` §`prepare`, #547); what it did not need, and a later
 * frame did, was built on that later frame.
 *
 * `open-world-harness.tsx` rides the real `GameView`, the real renderer and
 * the product's own session over a dense fixture town three blocks long, and
 * counts every `linkProgram` the page issues. This holds:
 *
 * - **no program is linked after the ride's first drawn frame**, across a
 *   kilometre and a half that takes in the first named street (the names'
 *   belt and its glyph atlas), a change of the road's view, a change of block
 *   and a junction every 100 m;
 * - **the renderer does not read each program's info log** in this build,
 *   which is a production build, as the product's is.
 *
 * The second case rides the same town in the **realistic world**, where the
 * stalls were reported, with houses that begin 700 m on: the first set of
 * mapped buildings with a house in it arrives mid-ride, and no program is
 * linked for it (PR #3117's review). Before the buildings' programs were made
 * ready with the view, that frame linked one for each surface the houses wear.
 *
 * What it does not prove is the harness's: a tablet's milliseconds, and what
 * land use, footways and villages add.
 */

import { expect, test, type Page } from '@playwright/test';

import { HARNESS_ORIGIN } from '../playwright.config';
import { NIGHTLY } from './nightly';
import type { OpenWorldHarness, OpenWorldRideReport } from './open-world-harness';

declare global {
  interface Window {
    __oylOpenWorld?: OpenWorldHarness;
  }
}

async function open(page: Page, query = ''): Promise<void> {
  const response = await page.goto(`${HARNESS_ORIGIN}/open-world.html${query}`);
  if (response?.status() !== 200) {
    throw new Error(
      `open-world.html did not load (${String(response?.status())}). Is it named in ` +
        '`vite.browser.config.ts` §`rollupOptions.input`?',
    );
  }
  // Polled on a timer: the page keeps `requestAnimationFrame` for itself, to
  // draw the ride a frame at a time, so the default polling never runs.
  await page.waitForFunction(
    () => window.__oylOpenWorld?.ready === true || (window.__oylOpenWorld?.errors.length ?? 0) > 0,
    undefined,
    { polling: 100 },
  );
  expect(await page.evaluate(() => window.__oylOpenWorld?.errors ?? [])).toEqual([]);
}

/** Rides on to `metres` from the start, on frames `frameMs` of ride time apart: a second, unless told. */
function ride(page: Page, metres: number, frameMs = 1_000): Promise<OpenWorldRideReport> {
  return page.evaluate(
    async ([to, each]) => {
      const harness = window.__oylOpenWorld;
      if (harness === undefined) throw new Error('no harness');
      return harness.ride(to, each);
    },
    [metres, frameMs] as const,
  );
}

test('#3107 an open-world ride through new areas links no program after its first frame', async ({
  page,
}) => {
  // A small stage: what is counted is programs, not pixels.
  await page.setViewportSize({ width: 640, height: 400 });
  await open(page);
  const warmUp = await page.evaluate(async () => window.__oylOpenWorld?.start());
  // The warm-up is where the ride's programs are linked: it is not vacuous.
  expect(warmUp).toBeGreaterThan(10);

  // To 500 m: unnamed streets only. To 1 300 m: the first named street comes
  // into view and the road's view is replaced at 1 km. To 2 100 m: the rider
  // crosses into the next block at 1 650 m and the blocks held change.
  const stretches = [await ride(page, 500), await ride(page, 1_300), await ride(page, 2_100)];
  // The next block's tiles are read between frames, off this ride's clock: on
  // a slow runner they may land a little later, so the ride goes on, short of
  // the block after, until the blocks held have changed.
  const blocksChanged = (): number =>
    stretches.slice(2).reduce((sum, stretch) => sum + stretch.corridorChanges, 0);
  for (let to = 2_300; blocksChanged() === 0 && to <= 3_300; to += 200) {
    stretches.push(await ride(page, to));
  }
  const named = stretches[1] as OpenWorldRideReport;
  const crossed = stretches[stretches.length - 1] as OpenWorldRideReport;
  const facts = stretches
    .map(
      (stretch) =>
        `to ${stretch.ridden.toFixed(0)} m: ${String(stretch.frames)} frames, ` +
        `${String(stretch.links)} links at ${JSON.stringify(stretch.linkedAt)}, ` +
        `new programs ${JSON.stringify(stretch.newPrograms)}`,
    )
    .join('; ');
  console.log(
    `#3107 the warm-up linked ${String(warmUp)} programs; ${facts}; ` +
      `${String(crossed.nameLetters)} name letters in the last frame`,
  );

  // The ride went through what it claims to: frames, names, a new view, a new block.
  for (const stretch of stretches) expect(stretch.frames).toBeGreaterThan(10);
  expect(crossed.ridden).toBeGreaterThanOrEqual(2_100);
  expect(named.nameLetters, 'the first named street is in view').toBeGreaterThan(0);
  expect(named.viewChanges, 'the road’s view was replaced').toBeGreaterThanOrEqual(1);
  expect(blocksChanged(), 'the blocks held changed').toBeGreaterThanOrEqual(1);

  // No program built inside a frame of the ride.
  for (const stretch of stretches) {
    expect(stretch.links, facts).toBe(0);
    expect(stretch.newPrograms, facts).toEqual([]);
  }

  // And the renderer does not read each program's info log as it links.
  expect(await page.evaluate(() => window.__oylOpenWorld?.shaderErrorsChecked())).toBe(false);
});

/**
 * The realistic world is a rung a rider chooses, and its load is slow with no
 * GPU: on the required runner this case took 44 s of its 60, so it runs
 * nightly (`nightly.ts`), as the other realistic loads do.
 */
test.describe('an open-world ride in the realistic world — #3107', { tag: NIGHTLY }, () => {
  test('#3107 a realistic open-world ride links no program when its first mapped buildings arrive', async ({
    page,
  }) => {
    // A smaller stage still: the realistic world is slow to draw without a GPU.
    await page.setViewportSize({ width: 320, height: 200 });
    await open(page, '?world=realistic');
    const warmUp = await page.evaluate(async () => window.__oylOpenWorld?.start());
    expect(warmUp).toBeGreaterThan(10);

    // To 150 m: no building is drawn, the first house standing 700 m on, past
    // what the ride's first plan reaches (600 m) and what the belt draws to
    // (400 m). To 650 m: houses are planned, come into reach and are drawn.
    // On frames 3 s apart: a link is counted whatever the frame's length, and
    // the realistic world takes a tenth of a second a frame to draw with no GPU.
    const stretches = [await ride(page, 150, 3_000), await ride(page, 650, 3_000)];
    const [before, among] = stretches as [OpenWorldRideReport, OpenWorldRideReport];
    const facts = stretches
      .map(
        (stretch) =>
          `to ${stretch.ridden.toFixed(0)} m in the ${stretch.world} world: ` +
          `${String(stretch.frames)} frames, ${String(stretch.buildings)} buildings at the most, ` +
          `${String(stretch.links)} links at ${JSON.stringify(stretch.linkedAt)}, ` +
          `new programs ${JSON.stringify(stretch.newPrograms)}`,
      )
      .join('; ');
    console.log(`#3107 realistic: the warm-up linked ${String(warmUp)} programs; ${facts}`);

    // The ride was the realistic world's, with no building drawn in its first
    // stretch and houses drawn in its second: they arrived mid-ride.
    for (const stretch of stretches) {
      expect(stretch.world).toBe('realistic');
      expect(stretch.frames).toBeGreaterThan(0);
    }
    expect(before.buildings, 'no building is in reach of the start').toBe(0);
    expect(among.buildings, 'houses were drawn').toBeGreaterThan(0);

    // And no program was built inside a frame of the ride.
    for (const stretch of stretches) {
      expect(stretch.links, facts).toBe(0);
      expect(stretch.newPrograms, facts).toEqual([]);
    }
  });
});
