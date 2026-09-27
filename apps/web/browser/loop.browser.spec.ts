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
 * ⚠️ **Two of its checks are of the road as it was drawn before #543**, the
 * check and its control, because they measure the profile's closure. #572
 * added the two that measure the loop start the PRODUCT draws: the same
 * reading through the real `sceneFrame` and its own camera, and a kink read of
 * the start from straight above, with the stored profile drawn by the product
 * as its control. The harness's header §"The road the product draws" says why
 * the second is needed at all: the product's chase camera cannot see #440 any
 * more.
 *
 * What this does NOT prove: that the owner's own route is fixed. A route saved
 * before #440 keeps its gap in its stored profile until it is imported again —
 * validation 0002 Part Q says so, and asks for exactly that.
 */

import { expect, test, type Page, type TestInfo } from '@playwright/test';

import { MAXIMUM_CORRIDOR_JOINT_DEGREES } from '../src/game/terrain';
import type { LoopStartMeasurement, RoadRows, StartFromAbove } from './loop-harness';

/** How far from the middle of the frame the far road may converge. */
const CENTRED_WITHIN = 0.05;
/** How far off the middle the control must put it, to count as the break. */
const BROKEN_BEYOND = 0.15;

/**
 * How far from the middle the far road may converge in the PRODUCT's frame —
 * #572. {@link CENTRED_WITHIN}, restated rather than loosened, from a
 * measurement.
 *
 * Measured on #572's pull request: **52.5 %** of the width, 2.5 points (16 px)
 * inside it. That is through the product's own camera, on the rider's racing
 * line; through the centreline's camera the same drawing reads 58.6 %, which is
 * the camera turned part-way along the closing segment's genuine 12 m jog
 * (`loop-harness.ts` §`startFrame`). So this bound is about the product as it
 * is, racing line included, and a change to the line that moves the reading
 * past it is a change to re-measure here rather than a bound to widen.
 *
 * ⚠️ **It does not see #440.** The stored profile drawn by the product reads
 * 52.7 %: #543's mean gives the jump and the jog the same heading at the line.
 * {@link MAXIMUM_CORRIDOR_JOINT_DEGREES}, read from above, is the check that
 * does.
 */
const DRAWN_CENTRED_WITHIN = CENTRED_WITHIN;

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

function describeAbove(reading: StartFromAbove): string {
  return reading.edges
    .map(
      (edge, index) =>
        `edge ${String(index + 1)}: ${String(edge.chords)} chords, worst kink ${edge.worstKinkDegrees.toFixed(
          1,
        )}°`,
    )
    .join('; ');
}

function worstKink(reading: StartFromAbove): number {
  return Math.max(...reading.edges.map((edge) => edge.worstKinkDegrees));
}

/** Publishes a margin the way `rideview.browser.spec.ts` publishes its fold margin. */
function publish(testInfo: TestInfo, type: string, note: string): void {
  testInfo.annotations.push({ type, description: note });
  console.log(`${type} — ${note}`);
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

test.describe('the start of a loop as the product draws it — #572', () => {
  test('the harness drew the product’s road, and saw the whole start from above', async ({
    page,
  }) => {
    const { drawn, fromAbove, width, height, aboveSize } = await measure(page);
    // The apparatus, as above: a frame with no road converges nowhere.
    expect(drawn.roadPixels).toBeGreaterThan((width * height) / 10);
    // From above, both edges must be walked the whole way through the start —
    // the frame is 63 m across and the closing jog and #543's mean over it
    // take 35.6 m — or a green kink bound says nothing. 33 chords a side in
    // both frames, measured; the control's edges break for a column where the
    // jump's ramp meets the road, and are walked on either side of it.
    for (const reading of [fromAbove.closed, fromAbove.stored]) {
      expect(reading.roadPixels, describeAbove(reading)).toBeGreaterThan(
        (aboveSize * aboveSize) / 20,
      );
      for (const edge of reading.edges) {
        expect(edge.chords, describeAbove(reading)).toBeGreaterThan(25);
      }
    }
  });

  test('the product’s camera looks down the road at the start, and says by how much', async ({
    page,
  }, testInfo) => {
    const { drawn, width } = await measure(page);
    const off = Math.abs(drawn.aheadCentre - 0.5);
    const margin = DRAWN_CENTRED_WITHIN - off;
    const note = `${describe(drawn)}; margin to the ${String(DRAWN_CENTRED_WITHIN * 100)} % bound ${(
      margin * 100
    ).toFixed(1)} points (${(margin * width).toFixed(0)} px)`;
    publish(testInfo, 'loop start, product camera', note);
    expect(off, note).toBeLessThanOrEqual(DRAWN_CENTRED_WITHIN);
    // With #543's mean switched off (or carried across the wrap as though a
    // loop were a line) the camera still reads inside the bound — 45.2 %,
    // measured — and it is THIS that goes red: a row of the road in two pieces.
    expect(drawn.runs.filter((count) => count > 1)).toEqual([]);
  });

  test('the product draws the start of a loop without a corner, and says by how much', async ({
    page,
  }, testInfo) => {
    // The bound is #543's own, which `bend.browser.spec.ts` holds a bend to:
    // the loop's start is a stretch of road like any other and gets no bound
    // of its own. Measured on #572's pull request: 2.0° and 3.1°. Reverting
    // #440's closure in `routeProfile` turns this red at 25.7° — the product
    // then draws exactly the control below.
    const { fromAbove } = await measure(page);
    const worst = worstKink(fromAbove.closed);
    const note = `${describeAbove(fromAbove.closed)}; margin to the ${String(
      MAXIMUM_CORRIDOR_JOINT_DEGREES,
    )}° bound ${(MAXIMUM_CORRIDOR_JOINT_DEGREES - worst).toFixed(1)}°`;
    publish(testInfo, 'loop start, worst kink from above', note);
    expect(worst, note).toBeLessThan(MAXIMUM_CORRIDOR_JOINT_DEGREES);
  });

  test('the control — the product draws a pre-#440 profile’s jump with a corner at each end', async ({
    page,
  }) => {
    // ⚠️ The defect, drawn by today's product, on every run: #543's mean turns
    // the stored profile's jump into a ramp, and a ramp has a corner where it
    // meets the road at each end — 25.7° and 10.8°, measured. Without this,
    // "no corner" is equally true of a harness that looked at a straight road.
    const { fromAbove } = await measure(page);
    expect(worstKink(fromAbove.stored), describeAbove(fromAbove.stored)).toBeGreaterThan(
      MAXIMUM_CORRIDOR_JOINT_DEGREES,
    );
  });
});
