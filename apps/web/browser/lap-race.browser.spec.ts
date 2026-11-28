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

test.describe('a bot between the camera and the rider — #2596', () => {
  for (const shadows of ['contact', 'map'] as const) {
    test(`is faded out with its shadow, and the rider behind it is drawn exactly as with no bot, with the riders’ ${shadows === 'map' ? 'shadow map' : 'contact shadows'}`, async ({
      page,
    }) => {
      await open(page);
      const seen = await page.evaluate((s) => window.__oylLapRace?.fadeSeen(s), shadows);
      console.log(`#2596 ${shadows}, read: ${JSON.stringify(seen)}`);
      if (seen === undefined) throw new Error('no reading');
      // The squares are what they say: the rider's is the rider, and with the
      // fade off the bot fills its own and hides some of the rider's.
      expect(seen.riderDrawn).toBeGreaterThan(seen.pixels / 2);
      expect(seen.bot.whole).toBeGreaterThan(seen.pixels / 2);
      expect(seen.rider.whole).toBeGreaterThan(0);
      expect(seen.frame.whole).toBeGreaterThan(seen.bot.whole);
      // The product: the bot is not drawn, its shadow is not drawn, and the
      // rider is drawn exactly as with no bot.
      expect(seen.bot.faded).toBe(0);
      expect(seen.rider.faded).toBe(0);
      expect(seen.frame.faded).toBe(0);
      // Two places across: beside the rider, which the owner's ruling of
      // 2026-11-15 keeps whole (`rider-fade.ts`), so its square keeps every
      // pixel the bot drawn with the fade off does.
      expect(seen.aside.whole).toBeGreaterThan(seen.pixels / 2);
      expect(seen.aside.faded).toBe(seen.aside.whole);
      // One place across and a metre behind — the owner's tablet case: whole.
      expect(seen.beside.whole).toBeGreaterThan(seen.pixels / 2);
      expect(seen.beside.faded).toBe(seen.beside.whole);
    });
  }

  test('photographs it before and after, and a bot coming up the side, for the owner', async ({
    page,
  }, testInfo) => {
    await open(page);
    // Held in line behind the rider (a bike length and a 0.3 m wheel gap),
    // whole as before #2596 and faded as now; then the same bot coming up the
    // rider's side a place across, from behind to level, and one a place
    // across a metre behind — each of them whole since the ruling of 2026-11-15.
    const shots = [
      ['before', 2.05, 0, 'off'],
      ['after', 2.05, 0, 'fade'],
      ['leaving-1', 2.05, 0.55, 'fade'],
      ['leaving-2', 1.4, 0.55, 'fade'],
      ['leaving-3', 0.9, 0.55, 'fade'],
      ['leaving-4', 0.3, 0.55, 'fade'],
      // The owner's tablet case of 2026-11-15: one place across, a little behind, whole.
      ['beside', 1, 0.55, 'fade'],
    ] as const;
    for (const [name, back, across, fade] of shots) {
      const id = `rider-fade-${name}`;
      await page.evaluate(([i, b, a, f]) => window.__oylLapRace?.fadeShot(i, b, a, f), [
        id,
        back,
        across,
        fade,
      ] as const);
      const shot = await page.locator(`#${id}`).screenshot();
      await testInfo.attach(id, { body: shot, contentType: 'image/png' });
      expect(shot.byteLength).toBeGreaterThan(5000);
    }
  });
});

/** #3304: a road bicycle, nose to tail, metres (`lap-race/pack-layout.ts` §`BIKE_LENGTH_METRES`). */
const BIKE_LENGTH_METRES = 1.75;
/** #3304: a lane across, metres (`lanes.ts` §`LANE_OFFSETS_METRES`): the pull-off lane is one to the left. */
const LANE_METRES = 1.75;

test.describe('a group ride’s line — #3304', () => {
  test('draws the rider and five bots on a real view’s frame: four in the rider’s lane nose to tail, one a lane to the left', async ({
    page,
  }, testInfo) => {
    await open(page);
    const read = await page.evaluate(() => window.__oylLapRace?.groupRideLine());
    console.log(`#3304 group ride frame: ${JSON.stringify(read)}`);
    expect(read?.calls).toBeGreaterThan(0);
    // The frame is in a change of front, the first bot aside.
    expect(read?.phase).toBe('changing');
    expect(read?.aside).toBe('bot-1');
    const riders = read?.riders ?? [];
    expect(riders).toHaveLength(6);
    expect(riders.filter((each) => each.kind === 'rider')).toHaveLength(1);
    const bots = riders.filter((each) => each.kind === 'bot');
    expect(bots).toHaveLength(5);
    const inLine = bots.filter((bot) => Math.abs(bot.across) < 0.05);
    const aside = bots.filter((bot) => Math.abs(bot.across + LANE_METRES) < 0.05);
    expect(inLine).toHaveLength(4);
    expect(aside).toHaveLength(1);
    // The line: ahead of the rider, each a bike length and a wheel gap behind the one ahead.
    const line = [0, ...inLine.map((bot) => bot.ahead)].sort((a, b) => a - b);
    line.slice(1).forEach((ahead, index) => {
      const gap = ahead - (line[index] ?? 0);
      expect(gap).toBeGreaterThan(BIKE_LENGTH_METRES);
      expect(gap).toBeLessThan(BIKE_LENGTH_METRES + 1.5);
    });
    const shot = await page.locator('#group-ride-line').screenshot();
    await testInfo.attach('group-ride-line', { body: shot, contentType: 'image/png' });
  });
});
