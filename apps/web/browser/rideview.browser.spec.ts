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
 * ## The display is not the WebView — #436's review
 *
 * ⚠️ **This spec used to measure at 1280×800 and 1024×768 only, and a reviewer
 * who remembers that is reading the old file.** 1280×800 is the Pixel Tablet's
 * *display* in CSS pixels. The Android shell configures no fullscreen mode —
 * nothing in `capacitor.config.ts`, `MainActivity` or `styles.xml` — so the
 * WebView a rider actually has is shorter than that by the status bar and the
 * navigation bar. Measured in this Chromium against the page as it then was:
 *
 *   viewport                       Pause / Stop end    margin to the fold
 *   1280×800   the display         y = 737             +63
 *   1280×752   24 + 24 dp of bars  y = 737             +15
 *   1280×728   a 3-button nav      y = 737             −9    BELOW THE FOLD
 *   1024×720                       y = 717             +3
 *
 * So the gate was green and the control that ends a recording was off the
 * screen — #422's own defect, one panel up, behind #422's own gate. The control
 * that bound was no longer the workout: it was `RideControls`, in the live
 * group `theme.css` §`.oyl-ride` had recorded as "taller than it was".
 *
 * ⚠️ **720 is an ASSUMPTION and the file says so.** Nobody has read
 * `window.innerHeight` off the owner's tablet; validation 0002 Part Q6 asks for
 * it. 720 is 80 px of bars, which is more than the 48–72 a stock Android tablet
 * is known to spend, chosen to err short.
 *
 * ## Why a margin, and not only a pass
 *
 * {@link FOLD_MARGIN_PIXELS}. A control that clears the fold by 3 px in this
 * Chromium has not been shown to clear it anywhere else: this pull request's
 * own history has an 8 px difference between a Mac's fonts and the CI runner's,
 * and Android's are a third set. Every tablet case therefore PUBLISHES its
 * margin — as an annotation and on stdout — so that the number is in the run
 * rather than in somebody's memory of it.
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

/**
 * How far above the fold the lowest ride control must end, in CSS pixels.
 *
 * Not slack and not taste — it is what this gate cannot see. The fixture has
 * one metric card whose note wraps to a second line (160.6 px against 140.8);
 * a second row doing the same is 20 px. The fonts are 8 px different between
 * two machines this repository has already measured, and a third set on the
 * device. And the bar heights under {@link TABLET_IN_THE_SHELL} are assumed.
 * 50 is those three with a little left over, and a margin under it at a
 * "device" viewport is unproven on that device however green the run is.
 */
const FOLD_MARGIN_PIXELS = 50;

/** The owner's tablet on the bars — 2560×1600 at a device pixel ratio of 2. */
const TABLET: Viewport = { name: 'a landscape tablet — 1280×800', width: 1280, height: 800 };

/**
 * The same tablet, as the WebView sees it: the display less the system bars.
 * ⚠️ Assumed, not read off the device — @see this file's header.
 */
const TABLET_IN_THE_SHELL: Viewport = {
  name: 'a landscape tablet inside the Android shell — 1280×720',
  width: 1280,
  height: 720,
};

/** A smaller one, where there is room for two columns and not three. */
const SMALL_TABLET: Viewport = { name: 'a 4:3 tablet — 1024×768', width: 1024, height: 768 };

/** And that one less its bars, which is where the old layout cleared by 3 px. */
const SMALL_TABLET_IN_THE_SHELL: Viewport = {
  name: 'a 4:3 tablet inside the Android shell — 1024×720',
  width: 1024,
  height: 720,
};

/** Every viewport at which the screen is laid out in columns. */
const TABLETS: readonly Viewport[] = [
  TABLET,
  TABLET_IN_THE_SHELL,
  SMALL_TABLET,
  SMALL_TABLET_IN_THE_SHELL,
];

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

for (const viewport of TABLETS) {
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

    /**
     * ⚠️ The case #436's review asked for. "On screen" above is a pass or a
     * fail; this is the NUMBER, published on every run, and a floor under it.
     * What binds today is Pause / Stop in the live group — the controls that
     * end a recording — and they end where they do because of two things this
     * case is the only gate for: `RideView.tsx` renders the controls BEFORE
     * the clock, and `theme.css` puts the title and its summary on one row.
     */
    test('the lowest ride control clears the fold by a margin, and says by how much', async ({
      page,
    }, testInfo) => {
      await open(page, viewport);
      const seen = await measure(page);

      const during = seen.controls.filter((each) => each.group !== 'sensors');
      // The apparatus: a margin taken over no controls is `Infinity`, which
      // clears any floor there is.
      expect(during.map((each) => each.name)).toEqual(expect.arrayContaining(['Pause', 'Stop']));
      const lowest = during.reduce((low, each) => (each.box.bottom > low.box.bottom ? each : low));
      const margin = viewport.height - lowest.box.bottom;

      const note = `${margin.toFixed(1)} px under ${describeControl(lowest)} at ${String(
        viewport.width,
      )}×${String(viewport.height)}`;
      testInfo.annotations.push({ type: 'margin to the fold', description: note });
      // Printed as well as annotated, as `game.browser.spec.ts` does its costs.
      console.log(`margin to the fold — ${note}`);

      expect(margin, note).toBeGreaterThanOrEqual(FOLD_MARGIN_PIXELS);
    });

    test('the title and its one-line summary share a row', async ({ page }) => {
      // 40.8 px of the budget above. Stacked, they spend a line of the fold on
      // a sentence that fits beside the heading; the control below requires
      // them to be stacked again under the prose measure, so this is not true
      // of a page that simply has no summary.
      await open(page, viewport);
      const { title, summary } = await measure(page);

      expect(title?.height ?? 0).toBeGreaterThan(0);
      expect(summary?.height ?? 0).toBeGreaterThan(0);
      expect(summary?.left ?? 0).toBeGreaterThanOrEqual(title?.right ?? Infinity);
      expect(summary?.top ?? Infinity).toBeLessThan(title?.bottom ?? 0);
      expect(summary?.bottom ?? Infinity).toBeLessThanOrEqual(
        (title?.bottom ?? 0) + SUBPIXEL_TOLERANCE,
      );
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
      // And the title is stacked over its summary again, which is what makes
      // "they share a row" above a statement about the instruments layout.
      expect(seen.summary?.top ?? 0).toBeGreaterThanOrEqual(seen.title?.bottom ?? Infinity);
    });
  });
}

for (const viewport of [TABLET, TABLET_IN_THE_SHELL]) {
  test.describe(viewport.name, () => {
    test('has room for the sensors too', async ({ page }) => {
      // ⚠️ At the three-column width only. `theme.css` §`.oyl-ride` records why
      // the sensors are the group that may be below the fold on a smaller
      // tablet: pairing is what a rider does before a ride, not during one.
      await open(page, viewport);
      const seen = await measure(page);

      const pairing = seen.controls.filter((each) => each.group === 'sensors');
      expect(pairing.length).toBeGreaterThan(3);
      expect(pairing.filter((each) => !onScreen(each, viewport)).map(describeControl)).toEqual([]);
    });
  });
}

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
