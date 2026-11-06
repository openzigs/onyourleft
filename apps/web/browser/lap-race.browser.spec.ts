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
 * 4. **A pick-up point seen from afar** (#1969): one pick-up point
 *    `PICK_UP_SEEN_FROM_METRES` (50 m) up the road on a 1280×800 frame, read
 *    as the pixels it changes. Until #1969 it changed 91 there: a 2 cm band
 *    across the road and two pennants edge-on to the rider — the thin teal
 *    line the owner saw. Its flags now face the rider, and it must change at
 *    least {@link PICK_UP_PIXELS_AT_50_METRES}. The frame is attached to the
 *    run for the owner.
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

/**
 * #1969: the fewest pixels one pick-up point may change on a 1280×800 frame
 * from 50 m (`three-renderer.ts` §`PICK_UP_SEEN_FROM_METRES`). Chosen: about
 * four times the 91 the edge-on pennants changed, and under the 517 the
 * rider-facing flags change in the pinned Chromium, so the old shape is red
 * and the new one has room. Whether the flags are recognisable is the
 * owner's call from the photograph; this holds them from shrinking back to a
 * line.
 */
const PICK_UP_PIXELS_AT_50_METRES = 400;

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

  test('a pick-up point changes the frame visibly from 50 m up the road — #1969', async ({
    page,
  }, testInfo) => {
    await open(page);
    const from = await page.evaluate(() => window.__oylLapRace?.pickUpSeenFrom);
    expect(from).toBe(50);
    const seen = await page.evaluate(
      (at) =>
        [at / 2, at, at * 1.5, at * 2].map((ahead) => ({
          ahead,
          ...window.__oylLapRace?.pickUpSeen(ahead),
        })),
      from ?? 0,
    );
    console.log(`#1969 one pick-up point, 1280×800: ${JSON.stringify(seen)}`);
    const atTheDistance = seen.find((each) => each.ahead === from);
    expect(atTheDistance?.changed).toBeGreaterThanOrEqual(PICK_UP_PIXELS_AT_50_METRES);
    // Nearer is never smaller: the reading is of the pick-up point and not of noise.
    const changed = seen.map((each) => each.changed ?? 0);
    expect([...changed].sort((a, b) => b - a)).toEqual(changed);
    await page.evaluate((at) => window.__oylLapRace?.pickUpSeen(at, true), from ?? 0);
    const shot = await page.locator('#lap-race-pick-up').screenshot();
    await testInfo.attach('lap-race-pick-up-50m', { body: shot, contentType: 'image/png' });
  });

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
