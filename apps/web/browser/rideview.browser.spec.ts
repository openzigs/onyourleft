// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The Ride screen, measured by a real engine at the viewport it is used at — #422.
 *
 * ⚠️ `views/RideView.tsx` at `#/`, where a ride is recorded, a trainer is given
 * control and a structured workout is started. Not the trainer game's stage,
 * which is `ride.browser.spec.ts`.
 *
 * ## What happened
 *
 * The owner's Pixel Tablet, landscape, 2026-09-20. The Ride screen rendered a
 * portrait-width column under a prose reading measure, was cut off at the ride
 * controls, and left about half the display blank. **`WorkoutPanel` was below
 * the fold.** The owner was trying to answer #372's open safety question —
 * does ERG release when a workout ends? — and started a plain recording
 * believing it was a workout. The wire: Request Control, 103 seconds of
 * nothing, Stop. Zero ERG targets. They reported that the trainer *"feels the
 * same after ending as during"*, which read as a clean pass and was no evidence
 * at all. **A layout defect produced a false answer to a safety question.**
 *
 * ## Why no gate saw it
 *
 * `test:a11y` renders this route into jsdom on every run and audits it, and
 * jsdom performs no layout (CLAUDE.md §4e): a control in the document and a
 * control on the screen are the same observation there. The browser gate
 * measured the shell's chrome at 320×256 and the HUD at a phone's width, and
 * **nothing measured this screen at all**, at any viewport.
 *
 * ## The control
 *
 * ⚠️ `constrain()` puts the page back the way #422 found it — the prose measure
 * on the live `main`, and one column inside it — and the control that starts a
 * workout must be **below the fold again**. That is the defect, in
 * the pinned Chromium, on every run; without it "every control is on screen"
 * is just as true of a page that rendered no controls.
 *
 * ⚠️ **Read `rideview-harness.tsx`'s header before reading a number here.**
 */

import { expect, test, type Page } from '@playwright/test';

import type { RideViewControl, RideViewMeasurement } from './rideview-harness';

/** Sub-pixel layout, not slack. @see ride.browser.spec.ts */
const SUBPIXEL_TOLERANCE = 1;

/** `theme.css` §`--oyl-color-surface-raised`, as `getComputedStyle` spells it. */
const UNSTYLED = 'rgba(0, 0, 0, 0)';

/** The control the owner could not see. @see rideview-harness.tsx §WORKOUT */
const STARTS_A_WORKOUT = 'Ride Sweet spot, three by twelve';

interface Viewport {
  readonly name: string;
  readonly width: number;
  readonly height: number;
}

/** The owner's tablet on the bars — 2560×1600 at a device pixel ratio of 2. */
const TABLET: Viewport = { name: 'a landscape tablet — 1280×800', width: 1280, height: 800 };

/** A smaller one, where there is room for two columns and not three. */
const SMALL_TABLET: Viewport = { name: 'a 4:3 tablet — 1024×768', width: 1024, height: 768 };

async function open(page: Page, viewport: Viewport): Promise<void> {
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  const response = await page.goto('/rideview.html');
  expect(
    response?.status(),
    'rideview.html did not load — is it named in vite.browser.config.ts build.rollupOptions.input?',
  ).toBe(200);
  await page.waitForFunction(() => window.__oylRideView !== undefined);
  const published = await page.evaluate(() => ({
    ready: window.__oylRideView?.ready,
    errors: window.__oylRideView?.errors,
  }));
  expect(published.errors, 'the Ride-screen harness reported an error').toEqual([]);
  expect(published.ready).toBe(true);
}

async function measure(page: Page): Promise<RideViewMeasurement> {
  const measured = await page.evaluate(() => window.__oylRideView?.measure());
  if (measured === undefined) {
    throw new Error('the Ride-screen harness published no measurement');
  }
  return measured;
}

function onScreen(control: RideViewControl, viewport: Viewport): boolean {
  const { box } = control;
  return (
    box.width > 0 &&
    box.height > 0 &&
    box.left >= -SUBPIXEL_TOLERANCE &&
    box.top >= -SUBPIXEL_TOLERANCE &&
    box.right <= viewport.width + SUBPIXEL_TOLERANCE &&
    box.bottom <= viewport.height + SUBPIXEL_TOLERANCE &&
    control.onTop
  );
}

function describeControl(control: RideViewControl): string {
  const { box } = control;
  return `[${control.group}] ${control.name} — y ${box.top.toFixed(0)}–${box.bottom.toFixed(0)}${
    control.onTop ? '' : ' COVERED'
  }`;
}

for (const viewport of [TABLET, SMALL_TABLET]) {
  test.describe(viewport.name, () => {
    /**
     * ⚠️ The apparatus. The fixture is mid-ride with control granted, a saved
     * workout and a threshold, so that `WorkoutPanel` renders the control the
     * owner could not see. A page that rendered *"Ask the trainer for control
     * first"* instead has no such control, and every case below would pass
     * over its absence.
     */
    test('the harness rendered the screen at its fullest', async ({ page }) => {
      await open(page, viewport);
      const seen = await measure(page);

      expect(seen.viewport).toEqual({ width: viewport.width, height: viewport.height });
      expect(seen.cardBackground).not.toBe(UNSTYLED);
      expect(seen.cardBackground).not.toBe('');
      const names = seen.controls.map((each) => each.name);
      expect(names).toEqual(expect.arrayContaining(['Pause', 'Stop', 'Set target', 'End ERG']));
      expect(names).toContain(STARTS_A_WORKOUT);
      expect(seen.controls.filter((each) => each.group === 'sensors').length).toBeGreaterThan(3);
    });

    test('is not held to the prose reading measure', async ({ page }) => {
      await open(page, viewport);
      const seen = await measure(page);

      expect(seen.mainClass).toBe('oyl-main oyl-main--instruments');
      expect(seen.mainMaxWidth).toBe('none');
      expect(seen.main?.width).toBe(viewport.width);
    });

    /**
     * #422's first criterion and its comment's. Everything a rider does DURING
     * a ride — the live group and the trainer group, which is `RideControls`,
     * `TrainerPanel` and `WorkoutPanel`.
     */
    test('every ride control is on screen with no scrolling', async ({ page }) => {
      await open(page, viewport);
      const seen = await measure(page);

      expect(seen.scrollY).toBe(0);
      const during = seen.controls.filter((each) => each.group !== 'sensors');
      expect(during.length).toBeGreaterThanOrEqual(6);
      expect(during.filter((each) => !onScreen(each, viewport)).map(describeControl)).toEqual([]);
    });

    test('the trainer is BESIDE the live metrics, not under them', async ({ page }) => {
      // "Landscape uses the width." The two groups share a top edge and do not
      // share a column.
      await open(page, viewport);
      const { groups } = await measure(page);

      expect(groups.live).toBeDefined();
      expect(groups.trainer).toBeDefined();
      expect(groups.trainer?.top).toBeCloseTo(groups.live?.top ?? -1, 0);
      expect(groups.trainer?.left ?? 0).toBeGreaterThanOrEqual(groups.live?.right ?? Infinity);
    });

    /**
     * ⚠️ **The control, and it is the defect itself.** With the measure back,
     * the control that starts a workout is below the fold — which is what the
     * owner's tablet showed, and what made a recording look like a workout.
     */
    test('the control — under the prose measure, a workout cannot be started without scrolling', async ({
      page,
    }) => {
      await open(page, viewport);
      await page.evaluate(() => {
        window.__oylRideView?.constrain();
      });
      const seen = await measure(page);

      expect(seen.mainClass).toBe('oyl-main oyl-main--prose');
      expect(seen.mainMaxWidth).not.toBe('none');
      const start = seen.controls.find((each) => each.name === STARTS_A_WORKOUT);
      expect(start?.box.height ?? 0).toBeGreaterThan(0);
      expect(start?.box.bottom ?? 0).toBeGreaterThan(viewport.height);
    });
  });
}

test.describe(TABLET.name, () => {
  test('has room for the sensors too', async ({ page }) => {
    // ⚠️ At THIS viewport only. `theme.css` §`.oyl-ride` records why the
    // sensors are the group that may be below the fold on a smaller tablet:
    // pairing is what a rider does before a ride, not during one.
    await open(page, TABLET);
    const seen = await measure(page);

    const pairing = seen.controls.filter((each) => each.group === 'sensors');
    expect(pairing.filter((each) => !onScreen(each, TABLET)).map(describeControl)).toEqual([]);
  });
});

/**
 * The measure is gone from this route, so nothing else bounds its width. On a
 * phone the screen is one column and a page that scrolls — which it always was
 * — and what must not happen is a column wider than the screen.
 */
for (const viewport of [
  { name: 'a phone upright — 390×844', width: 390, height: 844 },
  { name: 'a phone in landscape — 844×390', width: 844, height: 390 },
  { name: 'reflow — 320×256', width: 320, height: 256 },
]) {
  test.describe(viewport.name, () => {
    test('nothing is wider than the viewport', async ({ page }) => {
      await open(page, viewport);
      const seen = await measure(page);

      expect(seen.controls.length).toBeGreaterThan(8);
      const wide = seen.controls.filter(
        (each) => each.box.right > viewport.width + SUBPIXEL_TOLERANCE || each.box.left < 0,
      );
      expect(wide.map(describeControl)).toEqual([]);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });
  });
}
