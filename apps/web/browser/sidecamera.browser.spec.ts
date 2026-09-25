// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **Is the tripod phone's filming sign the dominant thing on its screen, and
 * is its one stop control reachable?** — #528, measured in the pinned
 * Chromium.
 *
 * #528's criteria, each in the form a real engine can answer:
 *
 * 1. *"The recording indicator is unmistakable from across the room: full
 *    screen … A browser-gate measurement at a phone viewport shows it is the
 *    dominant element."* — the stage's box is the viewport; a 7 × 7 hit-test
 *    grid finds the stage (or the shell's own camera indicator, which says the
 *    same thing) at every point; the word is at least a fifth of the screen's
 *    short side and more than twice the size of any other text on the page;
 *    and it is on one line inside the screen.
 * 2. *"It must not depend on colour alone"* — the carrier is the word, which
 *    `SideCameraView.a11y.test.tsx` asserts in the text; here it is asserted
 *    to be LAID OUT, at a size, which a stylesheet that hid it would fail.
 * 3. *"One stop control, reachable, 44×44, and nothing else on screen during
 *    capture"* — exactly one visible control in the whole document, at least
 *    44 × 44, inside the viewport and topmost at its own centre, with the
 *    shell's header and navigation absent from the document.
 * 4. *"When the link is lost … with a visible countdown"* — the countdown is
 *    laid out, and the stop control is still the one uncovered control.
 *
 * ⚠️ **The control, without which every assertion above is true of a page
 * that styled nothing.** `unstyle()` strips the stage's class from the live
 * element, so the same markup is laid out as an ordinary block; the stage must
 * then NOT cover the screen. A green run with the control red would mean this
 * spec measures the markup, not `theme.css`.
 *
 * ⚠️ **44 × 44 is WCAG 2.2 SC 2.5.5 (AAA), not 2.5.8** — `shell.browser.spec.ts`
 * records why that correction is written down wherever the number appears.
 */

import { expect, test, type Page } from '@playwright/test';

import type { SideCameraMeasurement } from './sidecamera-harness';

/** The touch target, SC 2.5.5. */
const TOUCH_TARGET_PIXELS = 44;

/**
 * The smallest the word may be, as a share of the screen's shorter side.
 *
 * `theme.css` §"THE SIDE CAMERA" gives the arithmetic and its source: on a
 * phone about 70 mm across its short side, a fifth is a 14 mm em — capitals of
 * about 10 mm, legible at a little over a metre by the sign trade's
 * inch-per-ten-feet rule (read second-hand). The word is drawn larger than the
 * floor at every viewport here, and each case prints by how much. A phone's
 * limit, stated.
 */
const WORD_SHARE_OF_SHORT_SIDE = 0.2;

/** How much bigger than every other text the word must be. */
const WORD_DOMINANCE = 2;

const SUBPIXEL_TOLERANCE = 1;

interface Viewport {
  readonly name: string;
  readonly width: number;
  readonly height: number;
}

/**
 * Phones, both ways up. A side-on tripod is most likely landscape — a bicycle
 * is longer than it is tall — but a rider may stand the phone upright, and a
 * 320-pixel phone is the narrowest this client supports anywhere.
 */
const PHONES: readonly Viewport[] = [
  { name: 'a phone in landscape — 844×390', width: 844, height: 390 },
  { name: 'a phone upright — 390×844', width: 390, height: 844 },
  { name: 'a small phone in landscape — 640×360', width: 640, height: 360 },
  { name: 'a small phone upright — 360×640', width: 360, height: 640 },
  { name: 'the narrowest phone — 320×568', width: 320, height: 568 },
];

async function open(page: Page, viewport: Viewport): Promise<void> {
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  const response = await page.goto('/sidecamera.html');
  expect(
    response?.status(),
    'sidecamera.html did not load — is it named in vite.browser.config.ts build.rollupOptions.input?',
  ).toBe(200);
  await page.waitForFunction(() => window.__oylSideCamera !== undefined);
  const published = await page.evaluate(() => ({
    ready: window.__oylSideCamera?.ready,
    errors: window.__oylSideCamera?.errors,
  }));
  expect(published.errors, 'the side-camera harness reported an error').toEqual([]);
  expect(published.ready).toBe(true);
}

async function measure(page: Page): Promise<SideCameraMeasurement> {
  const measured = await page.evaluate(() => window.__oylSideCamera?.measure());
  if (measured === undefined) {
    throw new Error('the side-camera harness published no measurement');
  }
  return measured;
}

/** The stage's box is the whole viewport. */
function coversTheScreen(measured: SideCameraMeasurement): boolean {
  const { stage, viewport } = measured;
  return (
    stage !== undefined &&
    stage.left <= SUBPIXEL_TOLERANCE &&
    stage.top <= SUBPIXEL_TOLERANCE &&
    stage.right >= viewport.width - SUBPIXEL_TOLERANCE &&
    stage.bottom >= viewport.height - SUBPIXEL_TOLERANCE
  );
}

function expectOneReachableStop(measured: SideCameraMeasurement): void {
  const { controls, viewport } = measured;
  expect(
    controls.map((control) => control.name),
    'the filming screen offers exactly one control',
  ).toEqual(['Stop filming']);
  const [stop] = controls;
  if (stop === undefined) {
    return;
  }
  expect(stop.box.width).toBeGreaterThanOrEqual(TOUCH_TARGET_PIXELS);
  expect(stop.box.height).toBeGreaterThanOrEqual(TOUCH_TARGET_PIXELS);
  expect(stop.onTop, 'something is drawn over the stop control').toBe(true);
  expect(stop.box.left).toBeGreaterThanOrEqual(-SUBPIXEL_TOLERANCE);
  expect(stop.box.top).toBeGreaterThanOrEqual(-SUBPIXEL_TOLERANCE);
  expect(stop.box.right).toBeLessThanOrEqual(viewport.width + SUBPIXEL_TOLERANCE);
  expect(stop.box.bottom).toBeLessThanOrEqual(viewport.height + SUBPIXEL_TOLERANCE);
}

for (const viewport of PHONES) {
  test.describe(viewport.name, () => {
    test('the filming sign covers the screen, and nothing else is on it', async ({ page }) => {
      await open(page, viewport);
      const measured = await measure(page);

      expect(coversTheScreen(measured), `the stage is ${JSON.stringify(measured.stage)}`).toBe(
        true,
      );
      expect(measured.chromePresent, 'the shell’s header or navigation is still there').toBe(false);
      expect(measured.scrollY).toBe(0);
      const strays = measured.grid.filter((what) => what === 'other').length;
      expect(strays, 'a hit-test point found something that is not the sign').toBe(0);
      // The shell's own indicator pill may take a corner; the sign has the rest.
      const onStage = measured.grid.filter((what) => what === 'stage').length;
      expect(onStage / measured.grid.length).toBeGreaterThanOrEqual(0.9);
    });

    test('the word is the dominant thing on it, on one line, inside the screen', async ({
      page,
    }) => {
      await open(page, viewport);
      const measured = await measure(page);
      const shortSide = Math.min(measured.viewport.width, measured.viewport.height);

      // Published, so a change of font or engine shows up in the log.
      console.log(
        `${viewport.name}: word ${measured.wordFontSize.toFixed(1)} px = ` +
          `${((measured.wordFontSize / shortSide) * 100).toFixed(1)} % of the short side; ` +
          `largest other text ${measured.largestOtherFontSize.toFixed(1)} px`,
      );
      expect(measured.wordFontSize).toBeGreaterThanOrEqual(shortSide * WORD_SHARE_OF_SHORT_SIDE);
      expect(measured.wordFontSize).toBeGreaterThanOrEqual(
        measured.largestOtherFontSize * WORD_DOMINANCE,
      );
      const { word } = measured;
      expect(word, 'the word is not on the page').toBeDefined();
      if (word === undefined) {
        return;
      }
      // One line: a wrapped word is two words' height.
      expect(word.height).toBeLessThan(measured.wordFontSize * 1.5);
      expect(word.left).toBeGreaterThanOrEqual(-SUBPIXEL_TOLERANCE);
      expect(word.right).toBeLessThanOrEqual(measured.viewport.width + SUBPIXEL_TOLERANCE);
    });

    test('offers one stop control, 44×44, reachable and uncovered', async ({ page }) => {
      await open(page, viewport);
      expectOneReachableStop(await measure(page));
    });

    test('shows a countdown when the link is lost, and the stop is still the one control', async ({
      page,
    }) => {
      await open(page, viewport);
      await page.evaluate(() => {
        window.__oylSideCamera?.loseLink();
      });
      await expect
        .poll(async () => (await measure(page)).countdown)
        .toMatch(/Stopping in \d+ seconds?/);
      const measured = await measure(page);
      expect(coversTheScreen(measured)).toBe(true);
      expect(measured.grid.filter((what) => what === 'other')).toEqual([]);
      expectOneReachableStop(measured);
    });

    test('control: without the stage’s rule, the same markup does not cover the screen', async ({
      page,
    }) => {
      await open(page, viewport);
      await page.evaluate(() => {
        window.__oylSideCamera?.unstyle();
      });
      const measured = await measure(page);
      expect(coversTheScreen(measured)).toBe(false);
    });
  });
}
