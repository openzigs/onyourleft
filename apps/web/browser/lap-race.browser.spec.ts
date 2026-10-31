// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The lap race's belt in the pinned Chromium — #1902, under ADR 0060 D-10.4.
 * `lap-race-harness.ts` says what each page function draws.
 *
 * 1. **A fixed number of calls, whatever the count**: a real view's frame of
 *    eight racers, every pick-up point of a three-lap race and 1 or 10
 *    puddles costs the same number of calls, and no more than three over the
 *    same eight racers with no race; the controls are that the belt drew
 *    what it was handed. The seven bots cost nothing over the rider alone:
 *    they are instances of the riders' own meshes (#368).
 * 2. The same for the belt alone in each world's materials, by three's own
 *    count.
 * 3. **The owner's photograph**: a real frame with a pick-up point, two
 *    puddles and two racers hit, attached to the run (ADR 0060 D-1).
 */

import { expect, test, type Page } from '@playwright/test';

async function open(page: Page): Promise<void> {
  const response = await page.goto('/lap-race.html');
  expect(
    response?.status(),
    'lap-race.html did not load — is it named in vite.browser.config.ts build.rollupOptions.input?',
  ).toBe(200);
  await page.waitForFunction(() => window.__oylLapRace?.ready === true);
}

/** ADR 0060 D-10.4's "instanced so the raise stays small": the most calls the belt may add. */
const MOST_LAP_RACE_CALLS = 3;

test.describe('the lap race’s belt — #1902', () => {
  test('adds the same calls to a real view’s frame of eight racers for one puddle as for ten, and no more than three', async ({
    page,
  }) => {
    await open(page);
    const one = await page.evaluate(() => window.__oylLapRace?.viewCalls(1));
    const ten = await page.evaluate(() => window.__oylLapRace?.viewCalls(10));
    console.log(`#1902 view calls: one ${JSON.stringify(one)}, ten ${JSON.stringify(ten)}`);
    // The controls: eight racers, every pick-up point, the puddles and five hits drawn.
    expect(one?.racers).toBe(8);
    expect(one?.drawn).toEqual({ pickUps: 9, hazards: 1, hits: 5 });
    expect(ten?.drawn).toEqual({ pickUps: 9, hazards: 10, hits: 5 });
    // The bots cost nothing: eight racers draw in the rider's own calls.
    expect(one?.without).toBe(one?.alone);
    const added = (one?.with ?? 0) - (one?.without ?? 0);
    expect(added).toBeGreaterThan(0);
    expect(added).toBeLessThanOrEqual(MOST_LAP_RACE_CALLS);
    expect(ten?.with).toBe(one?.with);
  });

  for (const world of ['stylised', 'realistic'] as const) {
    test(`draws in the same three calls for one puddle and for ten in the ${world} world’s materials`, async ({
      page,
    }) => {
      await open(page);
      const counted = await page.evaluate(
        (w) =>
          [1, 10].map((count) => {
            const harness = window.__oylLapRace;
            if (harness === undefined) throw new Error('no harness');
            return harness.probeCalls(w, count);
          }),
        world,
      );
      console.log(`#1902 ${world} belt calls: ${JSON.stringify(counted)}`);
      const [one, ten] = counted;
      expect(one?.drawn).toEqual({ pickUps: 9, hazards: 1, hits: 5 });
      expect(ten?.drawn).toEqual({ pickUps: 9, hazards: 10, hits: 5 });
      expect(one?.hidden).toBe(0);
      expect(ten?.hidden).toBe(0);
      expect(one?.shown).toBe(MOST_LAP_RACE_CALLS);
      expect(ten?.shown).toBe(one?.shown);
    });
  }

  test('photographs a lap-race frame for the owner', async ({ page }, testInfo) => {
    await open(page);
    await page.evaluate(() => window.__oylLapRace?.showcase());
    const shot = await page.locator('#lap-race-showcase').screenshot();
    await testInfo.attach('lap-race-showcase', { body: shot, contentType: 'image/png' });
    // A PNG, and not a flat fill: a one-colour frame compresses to a few hundred bytes.
    expect(shot.subarray(1, 4).toString('ascii')).toBe('PNG');
    expect(shot.byteLength).toBeGreaterThan(5000);
  });
});
