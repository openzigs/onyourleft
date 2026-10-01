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
import type { Box, HomeMeasurement } from './home-harness';

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
/**
 * SC 2.5.5 (AAA) — `shell.browser.spec.ts` §`TOUCH_TARGET_PIXELS`. The card
 * links are ordinary `.oyl-button`s and declare exactly this: 48 is the
 * ride-time controls' alone (#669, `design/ride-time-controls.ts`).
 */
const TOUCH_TARGET_PIXELS = 44;

/**
 * The owner's ruling of 2026-10-01 on #935: drawings on cards and panels are
 * MEDIUM — about 48 px tall, and not thin strips. A picture is held to a
 * height in this band and to a shape no wider than `MAXIMUM_DRAWING_ASPECT`
 * times its height: the scene's own 320 × 120 is 2.67, a card's picture is 1.67,
 * and a 48 px band across a phone's card is 7.5.
 */
const MEDIUM_DRAWING_PIXELS = { least: 44, most: 56 } as const;
const MAXIMUM_DRAWING_ASPECT = 3;

/** Why `box` is not a medium drawing, or `undefined` when it is one. */
function notMedium(box: Box | undefined): string | undefined {
  if (box === undefined) return 'not drawn';
  if (box.height < MEDIUM_DRAWING_PIXELS.least || box.height > MEDIUM_DRAWING_PIXELS.most) {
    return `${box.height.toFixed(1)} px tall`;
  }
  if (box.width > MAXIMUM_DRAWING_ASPECT * box.height) {
    return `a strip, ${box.width.toFixed(1)} × ${box.height.toFixed(1)} px`;
  }
  return undefined;
}

const size = (box: Box | undefined): string =>
  box === undefined ? 'none' : `${box.width.toFixed(1)}×${box.height.toFixed(1)}`;

const FOLD_VIEWPORTS = [
  { name: 'phone 390×844', width: 390, height: 844, insets: undefined, margin: 0 },
  // #939's review (B2): a phone on its side, a #660 reflow viewport, where
  // the tablet's framed picture once put the first control 115 px under.
  { name: 'phone on its side 844×390', width: 844, height: 390, insets: undefined, margin: 0 },
  {
    name: 'small phone on its side 640×360',
    width: 640,
    height: 360,
    insets: undefined,
    margin: 0,
  },
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
          `first card's link ${margin.toFixed(1)} px above the fold (${seen.fold.toFixed(1)}); ` +
          `ride cards ${seen.rideCards.map((card) => card.card.height.toFixed(1)).join(' / ')} px tall`,
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
  test('the control — the hero at 90 vh puts the first control under a phone’s fold', async ({
    page,
  }) => {
    const shipped = await open(page, 390, 844);
    const seen = await open(page, 390, 844, { query: '?hero=tall' });
    const first = seen.rideCards[0];
    const grew = (seen.hero?.height ?? 0) - (shipped.hero?.height ?? 0);
    const moved = (first?.link.top ?? 0) - (shipped.rideCards[0]?.link.top ?? 0);
    console.log(
      `#939 control: hero ${(seen.hero?.height ?? 0).toFixed(1)} px (+${grew.toFixed(1)}), ` +
        `first link top ${(first?.link.top ?? 0).toFixed(1)} (+${moved.toFixed(1)}) against ` +
        `the fold ${seen.fold.toFixed(1)}`,
    );
    expect(seen.hero?.height ?? 0).toBeGreaterThanOrEqual(0.9 * 844 - SUBPIXEL_TOLERANCE);
    expect(first?.link.top ?? 0).toBeGreaterThan(seen.fold);
    // Whatever the fonts: the band is what moved the control, by as much as
    // the band grew (#939's review, N2) — not a margin of a few pixels that a
    // line of wrapping could close.
    expect(grew).toBeGreaterThan(100);
    expect(moved).toBeGreaterThanOrEqual(grew - 2 * SUBPIXEL_TOLERANCE);
  });

  test('the control — without the short-viewport rule a phone on its side has its first control under the fold', async ({
    page,
  }) => {
    const seen = await open(page, 844, 390, { query: '?short=off' });
    const margin = seen.fold - (seen.rideCards[0]?.link.top ?? -Infinity);
    console.log(
      `#939 short-viewport control at 844×390: hero ${(seen.hero?.height ?? 0).toFixed(1)} px, ` +
        `first link ${margin.toFixed(1)} px above the fold`,
    );
    expect(margin).toBeLessThan(0);
    expect(seen.hero?.height ?? 0).toBeGreaterThanOrEqual(390 / 3);
  });
});

test.describe('#939 — medium drawings, about 48 px tall (the owner’s ruling of 2026-10-01)', () => {
  for (const viewport of FOLD_VIEWPORTS) {
    test(viewport.name, async ({ page }) => {
      const seen = await open(page, viewport.width, viewport.height, {
        ...(viewport.insets === undefined ? {} : { insets: viewport.insets }),
      });
      // The apparatus: three cards, and the panels that carry a drawing.
      expect(seen.rideCards).toHaveLength(3);
      console.log(
        `#939 drawings at ${viewport.name}: cards ` +
          seen.rideCards.map((card) => size(card.art)).join(', ') +
          `; trainer glyph ${size(seen.trainerGlyph)}; days ring ${size(seen.daysRing)}` +
          `; hero picture ${size(seen.ground)}`,
      );
      for (const card of seen.rideCards) {
        expect(notMedium(card.art), `${card.linkText}'s picture`).toBeUndefined();
        // Beside the heading, inside the card, and over none of its words.
        const art = card.art;
        const covered = card.words.filter(
          (line) =>
            art !== undefined &&
            line.right > art.left + SUBPIXEL_TOLERANCE &&
            line.left < art.right &&
            line.bottom > art.top + SUBPIXEL_TOLERANCE &&
            line.top < art.bottom - SUBPIXEL_TOLERANCE,
        );
        expect(covered, `${card.linkText}: words under the picture`).toEqual([]);
        expect(card.art?.top ?? -1).toBeGreaterThanOrEqual(card.card.top - SUBPIXEL_TOLERANCE);
        expect(card.art?.right ?? Infinity).toBeLessThanOrEqual(
          card.card.right + SUBPIXEL_TOLERANCE,
        );
      }
      expect(notMedium(seen.trainerGlyph), 'the Trainer card’s glyph').toBeUndefined();
      expect(notMedium(seen.daysRing), 'the days ring').toBeUndefined();
      // The hero's picture is at least medium (8rem on a tablet), and never a
      // strip across the band.
      const ground = seen.ground;
      expect(ground?.height ?? 0).toBeGreaterThanOrEqual(MEDIUM_DRAWING_PIXELS.least);
      expect(ground?.width ?? Infinity).toBeLessThanOrEqual(
        MAXIMUM_DRAWING_ASPECT * (ground?.height ?? 0),
      );
    });
  }

  // The controls: each puts back a card picture the ruling superseded, and the
  // same measurement must refuse it.
  for (const control of [
    { art: 'hidden', width: 640, height: 360, why: 'no card picture under 30rem tall' },
    { art: 'band', width: 390, height: 844, why: 'the 8rem band #939 first shipped' },
    { art: 'strip', width: 390, height: 844, why: 'a 48 px band across the card' },
  ] as const) {
    test(`the control — ?art=${control.art} (${control.why}) is not a medium drawing`, async ({
      page,
    }) => {
      const seen = await open(page, control.width, control.height, {
        query: `?art=${control.art}`,
      });
      expect(seen.rideCards).toHaveLength(3);
      const reasons = seen.rideCards.map((card) => notMedium(card.art));
      console.log(`#939 drawing control ?art=${control.art}: ${reasons.join(', ')}`);
      for (const reason of reasons) {
        expect(reason).toBeDefined();
      }
    });
  }
});

test.describe('#939 — three equal cards, each one `.oyl-button` link at 44×44', () => {
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
        // 2. The declaration: `.oyl-button`'s own 44, and not #669's 48.
        expect(card.declaredMinHeight, card.linkText).toBe(TOUCH_TARGET_PIXELS);
        expect(card.declaredMinWidth, card.linkText).toBe(TOUCH_TARGET_PIXELS);
        expect(card.link.height, card.linkText).toBeGreaterThanOrEqual(card.declaredMinHeight);
        // 3. With the floor stripped, the tokens still hold the target — the
        // measurement `shell.browser.spec.ts` §#316 makes for every
        // `.oyl-button` (44.8 px: padding, line box and border). #939 asked
        // that the stripped box fall SHORT; for an `.oyl-button` it cannot,
        // and #316/#669 govern. The floor must really be off, or this is
        // measurement 1 again.
        expect(card.strippedMinHeight, `${card.linkText}: the floor was not stripped`).toBe('0px');
        expect(card.stripped.height, card.linkText).toBeGreaterThanOrEqual(TOUCH_TARGET_PIXELS);
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
