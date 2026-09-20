// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The ride screen's layout, measured by a real engine — #373.
 *
 * `GameView` renders `Trainer: simulating −0.4% (352 sent)`, which is the
 * **only** rider-visible evidence that a gradient is reaching the trainer and
 * the thing every step of `docs/validation/0002-android-shell-and-game.md`
 * Part L is built around reading. Observed on a tablet on 2026-09-19: visible
 * in portrait, outside the viewport in landscape with no indication it existed.
 *
 * ## ⚠️ What the first run of this harness established, and it is bigger than #373
 *
 * Measured in the lockfile-pinned Chromium, on this harness, with the line
 * still in its old place (`.oyl-main` padding included, `scrollY === 0`):
 *
 * | viewport | header | world | `.oyl-hud` | controls at | old line at |
 * |---|---|---|---|---|---|
 * | 844×390 (phone, landscape) | 97 | 234 | **572** | 958 | 1062 |
 * | 390×844 (phone, portrait) | 178 | 201 | **628** | 1112 | 1216 |
 * | 1280×800 (tablet, landscape) | 97 | 367 | **572** | 1092 | 1196 |
 * | 768×1024 (tablet, portrait) | 138 | 367 | **572** | 1132 | 1236 |
 *
 * **The panel is 572 px tall and a landscape phone viewport is 390.** So the
 * HUD does not fit on screen in landscape *at all*, and neither do **Pause**
 * and **End ride** — at every one of the four viewports above, both controls
 * are below the fold. No placement of one 25 px line can change that, and
 * shrinking the world cannot either: the panel alone exceeds the viewport with
 * the canvas at zero.
 *
 * That is a finding about the ride screen rather than about this line, it is
 * filed as [#419](https://github.com/openzigs/onyourleft/issues/419), and
 * **this file does not pretend to fix it**. What #373 is
 * about is the line being *lost* — on the page background, after the panel,
 * with nothing to say it existed. What is asserted below is therefore the
 * property that actually holds and that actually helps: **a rider who reaches
 * the ride controls has the trainer line on screen.** They reach the controls
 * because they must, which is what makes it reachable *"without the rider
 * having to know it is there"*.
 *
 * ⚠️ **Read `ride-harness.tsx`'s header before reading a number here**, and in
 * particular the paragraph about the control. Every assertion below is taken
 * from the browser — `getBoundingClientRect`, `innerHeight`, `scrollY` — after
 * Chromium has laid the shipping markup out under the shipping stylesheet.
 */

import { expect, test, type Page } from '@playwright/test';

/**
 * The orientations, and why these two.
 *
 * ⚠️ **Landscape is the one that matters and portrait is the one that must not
 * regress.** #373 was observed on a tablet in landscape, which is also the
 * orientation a handlebar-mounted phone is most likely to be in; portrait is
 * where the old placement was visible, so a change that helped one and hurt the
 * other would be no change at all.
 *
 * 844×390 is an iPhone 14 on its side and 390×844 is the same device upright,
 * which is the pair `hud.browser.spec.ts` already measures the grid at.
 */
const ORIENTATIONS = [
  { name: 'landscape — 844×390', width: 844, height: 390 },
  { name: 'portrait — 390×844', width: 390, height: 844 },
] as const;

/**
 * How far past the bottom edge a box may measure and still count as on screen.
 *
 * ⚠️ One pixel, and it is `scrollIntoView` rather than slack. Chromium scrolls
 * to a fractional offset — measured here, `.oyl-hud__controls` lands at
 * `bottom: 844.390625` in an 844 px viewport after
 * `scrollIntoView({ block: 'end' })`, because the element's own box is
 * fractional. A strict comparison makes this gate fail on arithmetic rather
 * than on layout, and widening it further would let a whole line of text hide.
 */
const SUBPIXEL_TOLERANCE = 1;

interface Box {
  readonly top: number;
  readonly bottom: number;
  readonly height: number;
}

interface RideMeasurement {
  readonly viewport: { readonly width: number; readonly height: number };
  /** The shipped line, inside the HUD panel. `undefined` means it did not render. */
  readonly trainer: Box | undefined;
  /** The same sentence in its pre-#373 position. @see ride-harness.tsx */
  readonly control: Box | undefined;
  /** The panel itself, so a failure says whether the HUD or the line moved. */
  readonly hud: Box | undefined;
  /** The two mid-ride controls — the thing a rider has to reach. */
  readonly controls: Box | undefined;
  /** The world canvas, which is what decides how much room is left. */
  readonly world: Box | undefined;
  /** The route's own heading, so a failure says whether the chrome is real. */
  readonly heading: Box | undefined;
  /** What `theme.css` resolved `.oyl-hud__trainer`'s colour to, as a load check. */
  readonly trainerColour: string;
  readonly scrollY: number;
}

async function openRide(page: Page): Promise<void> {
  const response = await page.goto('/ride.html');
  // ⚠️ A page missing from `vite.browser.config.ts`'s `build.rollupOptions.input`
  // is simply not built, and the failure is a 404 sixty seconds later inside
  // `waitForFunction` with no mention of the config — the trap #266 confirmed
  // by deleting its own line.
  expect(
    response?.status(),
    'ride.html did not load — is it named in vite.browser.config.ts build.rollupOptions.input?',
  ).toBe(200);
  await page.waitForFunction(() => document.documentElement.hasAttribute('data-oyl-ride-ready'));
}

async function measure(page: Page): Promise<RideMeasurement> {
  return page.evaluate(() => {
    const boxOf = (selector: string): Box | undefined => {
      const element = document.querySelector(selector);
      if (element === null) {
        return undefined;
      }
      const rect = element.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom, height: rect.height };
    };
    const trainer = document.querySelector('.oyl-hud__trainer');
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      trainer: boxOf('.oyl-hud__trainer'),
      control: boxOf('[data-oyl-trainer-control]'),
      hud: boxOf('.oyl-hud'),
      controls: boxOf('.oyl-hud__controls'),
      world: boxOf('.oyl-game__world'),
      heading: boxOf('.oyl-main h1'),
      trainerColour: trainer === null ? '' : window.getComputedStyle(trainer).color,
      scrollY: window.scrollY,
    };
  });
}

/** Put the ride controls on screen, the way a rider reaching for *Pause* does. */
async function reachTheControls(page: Page): Promise<void> {
  await page.evaluate(() => {
    document.querySelector('.oyl-hud__controls')?.scrollIntoView({ block: 'end' });
  });
  await page.evaluate(
    async () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            resolve();
          });
        });
      }),
  );
}

for (const orientation of ORIENTATIONS) {
  test.describe(orientation.name, () => {
    test.use({ viewport: { width: orientation.width, height: orientation.height } });

    /**
     * ⚠️ The apparatus check, and it is not ceremony. A harness whose stylesheet
     * failed to load, whose panel rendered nothing, or whose `.oyl-main` view
     * was hidden by taking out the wrong node would make every assertion below
     * vacuous in the direction that passes — which is not hypothetical: the
     * first version of `ride-harness.tsx` unmounted the whole shell and set its
     * ready flag anyway.
     */
    test('the harness rendered the shell, the panel and both copies of the line', async ({
      page,
    }) => {
      await openRide(page);
      const seen = await measure(page);

      expect(seen.viewport).toEqual({ width: orientation.width, height: orientation.height });
      expect(seen.heading?.height ?? 0).toBeGreaterThan(0);
      expect(seen.world?.height ?? 0).toBeGreaterThan(0);
      expect(seen.hud?.height ?? 0).toBeGreaterThan(0);
      expect(seen.controls?.height ?? 0).toBeGreaterThan(0);
      expect(seen.trainer?.height ?? 0).toBeGreaterThan(0);
      expect(seen.control?.height ?? 0).toBeGreaterThan(0);
      // The stylesheet resolved: `--oyl-color-hud-ink-muted` rather than the
      // browser's default black. A page with no CSS lays out too, and lays out
      // differently.
      expect(seen.trainerColour).not.toBe('rgb(0, 0, 0)');
    });

    /**
     * Where the line is, structurally. This is the half that a stylesheet
     * cannot drift away from: the element is *inside* the panel's box, and the
     * copy in its old position is not.
     */
    test('the trainer line is inside the HUD panel, and the old placement is not', async ({
      page,
    }) => {
      await openRide(page);
      const seen = await measure(page);

      expect(seen.trainer?.top ?? 0).toBeGreaterThanOrEqual(seen.hud?.top ?? 0);
      expect(seen.trainer?.bottom ?? 0).toBeLessThanOrEqual(seen.hud?.bottom ?? 0);
      expect(seen.control?.top ?? 0).toBeGreaterThan(seen.hud?.bottom ?? 0);
    });

    /**
     * ⚠️ **Above the controls, which is what ties its reachability to something
     * that must already be true.** A rider has to reach *Pause* and *End ride*;
     * anything above them is passed on the way. Below them it would be one more
     * thing after the last thing a rider looks for.
     */
    test('the trainer line comes before the ride controls', async ({ page }) => {
      await openRide(page);
      const seen = await measure(page);

      expect(seen.trainer?.bottom ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(
        seen.controls?.top ?? 0,
      );
    });

    /**
     * #373's first acceptance criterion, in the form the measurement supports:
     * *"reachable … without the rider having to know it is there"*.
     *
     * ⚠️ The panel does not fit a landscape phone viewport at all — see this
     * file's header for the four measurements — so "visible at `scrollY === 0`"
     * is not a property any placement of this line can have. What it can have,
     * and now does, is being on screen at the moment the rider is looking at the
     * controls.
     */
    test('reaching the ride controls brings the trainer line on screen', async ({ page }) => {
      await openRide(page);
      await reachTheControls(page);
      const seen = await measure(page);

      // The control for this whole case: if the page did not scroll, the
      // assertions below are about the initial layout and say nothing.
      expect(seen.scrollY).toBeGreaterThan(0);
      expect(seen.controls?.bottom ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(
        seen.viewport.height + SUBPIXEL_TOLERANCE,
      );
      expect(seen.trainer?.top ?? -1).toBeGreaterThanOrEqual(0);
      expect(seen.trainer?.bottom ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(
        seen.viewport.height + SUBPIXEL_TOLERANCE,
      );
    });
  });
}

/**
 * ⚠️ **The control, and the reason the run above means anything.**
 *
 * The same sentence in its pre-#373 position — after the panel, on the page
 * background — must **still be off screen** with the ride controls in view. If
 * it is not, then the viewport is taller than the page, the stylesheet did not
 * load, or the panel rendered nothing; in every one of those the case above
 * passes while measuring nothing, which is the vacuous pass this repository has
 * shipped five separate times.
 *
 * It is landscape-only because that is where #373 was reported: in portrait the
 * old placement was visible, so requiring it to overflow there would be
 * asserting the opposite of the bug.
 */
test.describe('the control — the old placement, landscape', () => {
  test.use({ viewport: { width: 844, height: 390 } });

  test('is still below the fold when the controls are in view', async ({ page }) => {
    await openRide(page);
    await reachTheControls(page);
    const seen = await measure(page);

    expect(seen.control?.top ?? 0).toBeGreaterThan(seen.viewport.height);
  });

  /**
   * And the measurement this harness exists to have on record: the panel is
   * taller than the viewport, so the world canvas is not what is pushing the
   * controls off screen and shrinking it would not bring them back.
   *
   * ⚠️ Asserted rather than written in a comment, because it is the premise the
   * case above rests on. If a later change makes the panel fit, this goes red
   * and the *"reaching the controls"* framing should be revisited — which is
   * the outcome to want, not a failure, and is
   * [#419](https://github.com/openzigs/onyourleft/issues/419)'s fourth
   * criterion: it is **removed** there rather than loosened.
   */
  test('the HUD panel is taller than a landscape phone viewport', async ({ page }) => {
    await openRide(page);
    const seen = await measure(page);

    expect(seen.hud?.height ?? 0).toBeGreaterThan(seen.viewport.height);
  });
});
