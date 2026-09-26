// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A bend, read back off the drawing buffer in the pinned Chromium — #543.
 *
 * ⚠️ **Read `bend-harness.ts`'s header first**: it says what is measured —
 * the KINK in each edge of the road, a turn less the mean of the turns either
 * side of it — and why the turn alone could not tell a curve from a corner.
 *
 * What this does NOT prove: that the owner's route is smooth on the tablet.
 * The fixture is arithmetic sampled the way a planner samples a road; #543's
 * last criterion is a re-check on the same route, on the device, and that is
 * the owner's.
 */

import { expect, test, type Page } from '@playwright/test';

import { MAXIMUM_CORRIDOR_JOINT_DEGREES } from '../src/game/terrain';
import type { BendMeasurement, BendReading } from './bend-harness';

async function measure(page: Page): Promise<BendMeasurement> {
  const response = await page.goto('/bend.html');
  expect(
    response?.status(),
    'bend.html did not load — is it named in vite.browser.config.ts build.rollupOptions.input?',
  ).toBe(200);
  await page.waitForFunction(() => window.__oylBend !== undefined, undefined, {
    timeout: 60_000,
  });
  const published = await page.evaluate(() => window.__oylBend);
  expect(published?.errors, 'the bend harness reported an error').toEqual([]);
  const measurement = published?.measurement;
  if (measurement === undefined) {
    throw new Error('the bend harness published no measurement');
  }
  return measurement;
}

function describe(reading: BendReading): string {
  return (
    `inner edge: ${String(reading.inner.chords)} chords, turned ${reading.inner.turnedDegrees.toFixed(1)}°, ` +
    `worst kink ${reading.inner.worstKinkDegrees.toFixed(1)}°; outer edge: ${String(reading.outer.chords)} ` +
    `chords, turned ${reading.outer.turnedDegrees.toFixed(1)}°, worst kink ${reading.outer.worstKinkDegrees.toFixed(1)}°`
  );
}

test.describe('a bend is drawn as a curve — #543', () => {
  test('the harness saw the whole bend, on both edges, in both frames', async ({ page }) => {
    const { drawn, unsmoothed, size } = await measure(page);
    // The apparatus: rays that missed the road would report no kink at all.
    for (const reading of [drawn, unsmoothed]) {
      expect(reading.roadPixels, describe(reading)).toBeGreaterThan((size * size) / 20);
      for (const edge of [reading.inner, reading.outer]) {
        expect(edge.chords, describe(reading)).toBeGreaterThan(10);
      }
    }
    // The fixture's bend turns through 100°, and every edge must be seen to
    // turn through most of it — a green kink bound over a few chords of
    // straight would say nothing. (A turn is summed within one unbroken run of
    // rays, and the ends of the bend meet the frame, so it reads short of 100°:
    // 94.7° and 98.7° drawn, 89.7° and 96.6° for the control, measured.)
    for (const reading of [drawn, unsmoothed]) {
      expect(reading.inner.turnedDegrees, describe(reading)).toBeGreaterThan(80);
      expect(reading.outer.turnedDegrees, describe(reading)).toBeGreaterThan(80);
    }
  });

  test('no edge of the drawn road kinks by more than the stated bound', async ({ page }) => {
    const { drawn } = await measure(page);
    console.log(`#543 drawn — ${describe(drawn)}`);
    expect(drawn.inner.worstKinkDegrees, describe(drawn)).toBeLessThan(
      MAXIMUM_CORRIDOR_JOINT_DEGREES,
    );
    expect(drawn.outer.worstKinkDegrees, describe(drawn)).toBeLessThan(
      MAXIMUM_CORRIDOR_JOINT_DEGREES,
    );
  });

  test('the control — the route’s own centreline, unsmoothed, kinks at its corners', async ({
    page,
  }) => {
    // ⚠️ The defect, on every run. Without it "no kink above the bound" is
    // equally true of a measurement too blunt to see one.
    const { unsmoothed } = await measure(page);
    console.log(`#543 control — ${describe(unsmoothed)}`);
    expect(
      Math.max(unsmoothed.inner.worstKinkDegrees, unsmoothed.outer.worstKinkDegrees),
      describe(unsmoothed),
    ).toBeGreaterThan(2 * MAXIMUM_CORRIDOR_JOINT_DEGREES);
  });
});
