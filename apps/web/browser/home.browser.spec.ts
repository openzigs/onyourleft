// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The home screen, measured in the pinned Chromium — #428.
 *
 * Two of #428's criteria are about layout and jsdom performs none: *"uses the
 * full width on a landscape tablet; does not overflow at 320 px"*. Read
 * `home-harness.tsx`'s header for what is rendered and for the control.
 */

import { expect, test, type Page } from '@playwright/test';

import {
  applyInsets,
  PIXEL_TABLET_LANDSCAPE_INSETS,
  PIXEL_TABLET_PORTRAIT_INSETS_ASSUMED,
  resolvedInsets,
  type Insets,
} from './insets';
import type { HomeMeasurement } from './home-harness';

const SUBPIXEL_TOLERANCE = 1;

async function open(
  page: Page,
  width: number,
  height: number,
  options: { readonly query?: string; readonly insets?: Insets } = {},
): Promise<HomeMeasurement> {
  await page.setViewportSize({ width, height });
  if (options.insets !== undefined) {
    await applyInsets(page, options.insets);
  }
  const response = await page.goto(`/home.html${options.query ?? ''}`);
  expect(
    response?.status(),
    'home.html did not load — is it named in vite.browser.config.ts build.rollupOptions.input?',
  ).toBe(200);
  await page.waitForFunction(() => window.__oylHome !== undefined);
  const published = await page.evaluate(() => ({
    ready: window.__oylHome?.ready,
    errors: window.__oylHome?.errors,
  }));
  expect(published.errors, 'the home harness reported an error').toEqual([]);
  expect(published.ready).toBe(true);
  return measure(page);
}

async function measure(page: Page): Promise<HomeMeasurement> {
  const measured = await page.evaluate(() => window.__oylHome?.measure());
  if (measured === undefined) throw new Error('the home harness published no measurement');
  return measured;
}

/** How many cards share the first row. */
const firstRow = (seen: HomeMeasurement): number =>
  seen.cards.filter((card) => Math.abs(card.top - (seen.cards[0]?.top ?? -1)) < 2).length;

test.describe('a landscape tablet — 1280×800', () => {
  test('the cards use the width: main runs to the window, and more than one card shares a row', async ({
    page,
  }) => {
    const seen = await open(page, 1280, 800);
    // The apparatus: a full history renders every card.
    expect(seen.cards.length).toBeGreaterThanOrEqual(4);
    expect(seen.mainClass).toBe('oyl-main oyl-main--dashboard');
    expect(seen.main?.right).toBeCloseTo(1280, 0);
    expect(firstRow(seen)).toBeGreaterThanOrEqual(3);
  });

  test('the control — under the reading measure the cards stop short of the window', async ({
    page,
  }) => {
    const seen = await open(page, 1280, 800);
    await page.evaluate(() => {
      window.__oylHome?.constrain();
    });
    const constrained = await measure(page);
    expect(constrained.main?.right ?? Infinity).toBeLessThan(1280 - 200);
    expect(firstRow(constrained)).toBeLessThan(firstRow(seen));
  });
});

for (const [width, height] of [
  [320, 256],
  [320, 568],
  [390, 844],
] as const) {
  test(`does not overflow at ${String(width)}×${String(height)}`, async ({ page }) => {
    const seen = await open(page, width, height);
    expect(seen.cards.length).toBeGreaterThanOrEqual(4);
    expect(seen.horizontalOverflow).toBeLessThanOrEqual(0);
    for (const card of seen.cards) {
      expect(card.right).toBeLessThanOrEqual(width + SUBPIXEL_TOLERANCE);
      expect(card.left).toBeGreaterThanOrEqual(-SUBPIXEL_TOLERANCE);
    }
  });
}

/**
 * #939 — the hero band and the three ride cards.
 *
 * The first control is the Free ride card's link, which must START above the
 * fold: at a phone's 390×844, and on the owner's tablet in the shell both ways
 * up with the #439 insets and `rideview.browser.spec.ts` §`FOLD_MARGIN_PIXELS`'
 * 50 px floor. The hero's height and that margin are printed on every run.
 * `controls-first.browser.spec.ts` measures Home among every route as well;
 * this is where the band itself, and its control, are measured.
 */
const FOLD_MARGIN_PIXELS = 50;
/** SC 2.5.5 (AAA) — `shell.browser.spec.ts` §`TOUCH_TARGET_PIXELS`. */
const TOUCH_TARGET_PIXELS = 44;
/** What `theme.css` §`.oyl-ride-card__link` declares: the screen's biggest control. */
const RIDE_CARD_TARGET_PIXELS = 48;

const FOLD_VIEWPORTS = [
  { name: 'phone 390×844', width: 390, height: 844, insets: undefined, margin: 0 },
  {
    name: 'tablet in the shell, landscape 1280×800',
    width: 1280,
    height: 800,
    insets: PIXEL_TABLET_LANDSCAPE_INSETS,
    margin: FOLD_MARGIN_PIXELS,
  },
  {
    name: 'tablet in the shell, upright 800×1280',
    width: 800,
    height: 1280,
    insets: PIXEL_TABLET_PORTRAIT_INSETS_ASSUMED,
    margin: FOLD_MARGIN_PIXELS,
  },
] as const;

test.describe('#939 — the hero is a band, and the first ride card starts above the fold', () => {
  for (const viewport of FOLD_VIEWPORTS) {
    test(viewport.name, async ({ page }) => {
      const seen = await open(page, viewport.width, viewport.height, {
        ...(viewport.insets === undefined ? {} : { insets: viewport.insets }),
      });
      if (viewport.insets !== undefined) {
        // The override took effect, or this measured a page with no insets.
        expect(await resolvedInsets(page)).toEqual(viewport.insets);
      }
      const first = seen.rideCards[0];
      expect(seen.hero, 'the hero band was not drawn').toBeDefined();
      expect(first?.linkText).toBe('Start a ride');
      const margin = seen.fold - (first?.link.top ?? Infinity);
      console.log(
        `#939 ${viewport.name}: hero ${(seen.hero?.height ?? 0).toFixed(1)} px tall, ` +
          `first card's link ${margin.toFixed(1)} px above the fold (${seen.fold.toFixed(1)})`,
      );
      expect(margin).toBeGreaterThan(viewport.margin);
      // The words stand on the sky and never on the hills or the road: the
      // only pairs declared for text over art are `ink` and `inkMuted` on
      // `illoSky` (#936).
      const ground = seen.ground;
      expect(ground, 'the hero has no ground').toBeDefined();
      expect(seen.titleText.length).toBeGreaterThanOrEqual(2);
      const onTheGround = seen.titleText.filter(
        (line) =>
          ground !== undefined &&
          line.right > ground.left &&
          line.left < ground.right &&
          line.bottom > ground.top &&
          line.top < ground.bottom,
      );
      expect(onTheGround, 'a line of the title or summary stands on the hills').toEqual([]);
      // A band, not a screen: under a third of the viewport.
      expect(seen.hero?.height ?? Infinity).toBeLessThan(viewport.height / 3);
    });
  }

  test('the control — the hero at 60 vh puts the first control under a phone’s fold', async ({
    page,
  }) => {
    const seen = await open(page, 390, 844, { query: '?hero=tall' });
    const first = seen.rideCards[0];
    console.log(
      `#939 control: hero ${(seen.hero?.height ?? 0).toFixed(1)} px, first link top ` +
        `${(first?.link.top ?? 0).toFixed(1)} against the fold ${seen.fold.toFixed(1)}`,
    );
    expect(seen.hero?.height ?? 0).toBeGreaterThanOrEqual(0.6 * 844 - SUBPIXEL_TOLERANCE);
    expect(first?.link.top ?? 0).toBeGreaterThan(seen.fold);
  });
});

test.describe('#939 — three equal cards, each one link at least 44×44', () => {
  for (const [width, height] of [
    [390, 844],
    [1280, 800],
  ] as const) {
    test(`${String(width)}×${String(height)}`, async ({ page }) => {
      const seen = await open(page, width, height);
      expect(seen.rideCards.map((card) => card.linkText)).toEqual([
        'Start a ride',
        'Choose a route',
        'Choose a workout',
      ]);
      const widths = seen.rideCards.map((card) => card.card.width);
      for (const card of seen.rideCards) {
        // Equal: one track width.
        expect(Math.abs(card.card.width - (widths[0] ?? 0))).toBeLessThanOrEqual(
          SUBPIXEL_TOLERANCE,
        );
        // 1. The shipped box.
        expect(card.link.height, card.linkText).toBeGreaterThanOrEqual(TOUCH_TARGET_PIXELS);
        expect(card.link.width, card.linkText).toBeGreaterThanOrEqual(TOUCH_TARGET_PIXELS);
        // 2. The declaration.
        expect(card.declaredMinHeight, card.linkText).toBe(RIDE_CARD_TARGET_PIXELS);
        expect(card.declaredMinWidth, card.linkText).toBe(RIDE_CARD_TARGET_PIXELS);
        expect(card.link.height, card.linkText).toBeGreaterThanOrEqual(card.declaredMinHeight);
        // 3. With the floor stripped the box falls short of it: the floor
        // holds the target, not the arithmetic of the tokens under it.
        expect(card.stripped.height, card.linkText).toBeLessThan(card.declaredMinHeight);
        // The stretched link: the card's middle is this card's link, and no other.
        expect(card.middleHitsOwnLink, `${card.linkText}: hit ${card.middleHit}`).toBe(true);
      }
      if (width >= 1280) {
        // Three across on a landscape tablet.
        const tops = new Set(seen.rideCards.map((card) => Math.round(card.card.top)));
        expect(tops.size).toBe(1);
      }
    });
  }
});
