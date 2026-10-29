// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Delivery's belt in the pinned Chromium — #1814, resting on the owner's
 * ruling DL6b (epic #1803, ADR 0059 D-3). `delivery-harness.ts` says what
 * each page function draws.
 *
 * 1. **At most three calls, whatever the count**: a real view's frame
 *    carrying 1 and 20 of each piece costs the same number of calls more than
 *    the same frame with no round, read at WebGL's own draw entry points; the
 *    controls are that the belt drew 1 and 20 of each, and that a round with
 *    nothing in view adds nothing. The same for the belt alone in each world's
 *    materials, by three's own count.
 * 2. **A marker leaves its house**: a parcel thrown by `throw.ts` delivers to
 *    the first of two houses, and on the next frame the view's belt draws the
 *    second's marker and not the first's, read off its instances.
 * 3. **One instanced call, three shapes**: one obstacle of each kind,
 *    square-on, paints only where its own shape is, so the kinds sharing a
 *    call do not draw over each other.
 * 4. **The owner's photograph**: a real frame with a parcel, a marker and
 *    each obstacle, attached to the run.
 *
 * ⚠️ An ordinary ride's village frame is `realistic-town.browser.spec.ts`',
 * which this change does not touch: no view builds the belt until a frame
 * carries a round.
 */

import { expect, test, type Page } from '@playwright/test';

async function open(page: Page): Promise<void> {
  const response = await page.goto('/delivery.html');
  expect(
    response?.status(),
    'delivery.html did not load — is it named in vite.browser.config.ts build.rollupOptions.input?',
  ).toBe(200);
  await page.waitForFunction(() => window.__oylDelivery?.ready === true);
}

/** DL6b's "instanced so the raise stays small": the most calls the belt may add. */
const MOST_DELIVERY_CALLS = 3;

test.describe('Delivery’s belt — #1814', () => {
  test('adds the same calls to a real view’s frame for one of each piece as for twenty, and no more than three', async ({
    page,
  }) => {
    await open(page);
    const one = await page.evaluate(() => window.__oylDelivery?.viewCalls(1));
    const twenty = await page.evaluate(() => window.__oylDelivery?.viewCalls(20));
    console.log(`#1814 view calls: one ${JSON.stringify(one)}, twenty ${JSON.stringify(twenty)}`);
    // The controls: the belt drew what it was handed, and a round with nothing in view adds nothing.
    expect(one?.drawn).toEqual({ parcels: 1, markers: 1, obstacles: 1 });
    expect(twenty?.drawn).toEqual({ parcels: 20, markers: 20, obstacles: 20 });
    expect(one?.empty).toBe(one?.without);
    expect(twenty?.empty).toBe(twenty?.without);
    const added = (one?.with ?? 0) - (one?.without ?? 0);
    expect(added).toBeGreaterThan(0);
    expect(added).toBeLessThanOrEqual(MOST_DELIVERY_CALLS);
    expect((twenty?.with ?? 0) - (twenty?.without ?? 0)).toBe(added);
  });

  for (const world of ['stylised', 'realistic'] as const) {
    test(`draws in the same three calls for one of each and for twenty in the ${world} world’s materials`, async ({
      page,
    }) => {
      await open(page);
      const counted = await page.evaluate(
        (w) =>
          [1, 20].map((count) => {
            const harness = window.__oylDelivery;
            if (harness === undefined) throw new Error('no harness');
            return harness.probeCalls(w, count);
          }),
        world,
      );
      console.log(`#1814 ${world} belt calls: ${JSON.stringify(counted)}`);
      const [one, twenty] = counted;
      expect(one?.drawn).toEqual({ parcels: 1, markers: 1, obstacles: 1 });
      expect(twenty?.drawn).toEqual({ parcels: 20, markers: 20, obstacles: 20 });
      expect(one?.hidden).toBe(0);
      expect(twenty?.hidden).toBe(0);
      expect(one?.shown).toBe(MOST_DELIVERY_CALLS);
      expect(twenty?.shown).toBe(one?.shown);
    });

    test(`draws each obstacle kind’s own shape only, in one instanced call, in the ${world} world’s materials`, async ({
      page,
    }) => {
      await open(page);
      const read = await page.evaluate((w) => window.__oylDelivery?.kinds(w), world);
      console.log(`#1814 ${world} kinds: ${JSON.stringify(read)}`);
      // Points: in the bin above the cone's tip; low in the middle; on the trolley's upright.
      expect(read?.bin).toEqual([true, true, true]);
      expect(read?.trolley).toEqual([false, false, true]);
      expect(read?.cone).toEqual([false, true, false]);
    });
  }

  test('takes a marker off its house on the frame after a parcel is delivered there, read from what the view drew', async ({
    page,
  }) => {
    await open(page);
    const reading = await page.evaluate(() => window.__oylDelivery?.markerLeaves());
    console.log(`#1814 marker: ${JSON.stringify(reading)}`);
    expect(reading?.delivered).toBe(true);
    expect(reading?.before).toEqual({ markers: 2, first: true, second: true });
    expect(reading?.after).toEqual({ markers: 1, first: false, second: true });
  });

  test('photographs a Delivery frame for the owner', async ({ page }, testInfo) => {
    await open(page);
    await page.evaluate(() => window.__oylDelivery?.showcase());
    const shot = await page.locator('#delivery-showcase').screenshot();
    await testInfo.attach('delivery-showcase', { body: shot, contentType: 'image/png' });
    // A PNG, and not a flat fill: a one-colour frame compresses to a few hundred bytes.
    expect(shot.subarray(1, 4).toString('ascii')).toBe('PNG');
    expect(shot.byteLength).toBeGreaterThan(5000);
  });
});
