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

test.describe('a landscape tablet — 1280×800', () => {
  test('main runs to the window', async ({ page }) => {
    const seen = await open(page, 1280, 800);
    // The apparatus: a full history renders every card.
    expect(seen.cards.length).toBeGreaterThanOrEqual(4);
    expect(seen.mainClass).toBe('oyl-main oyl-main--dashboard');
    expect(seen.main?.right).toBeCloseTo(1280, 0);
  });

  test('the control — under the reading measure main stops short of the window', async ({
    page,
  }) => {
    await open(page, 1280, 800);
    await page.evaluate(() => {
      window.__oylHome?.constrain();
    });
    const constrained = await measure(page);
    expect(constrained.main?.right ?? Infinity).toBeLessThan(1280 - 200);
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
    for (const card of [...seen.cards, ...seen.rideCards.map((ride) => ride.card)]) {
      expect(card.right).toBeLessThanOrEqual(width + SUBPIXEL_TOLERANCE);
      expect(card.left).toBeGreaterThanOrEqual(-SUBPIXEL_TOLERANCE);
    }
    expect(seen.nextUp?.card.right ?? Infinity).toBeLessThanOrEqual(width + SUBPIXEL_TOLERANCE);
  });
}

/**
 * #1010 — Next up, This week, and the ride cards as art.
 *
 * Next up's Ride is the view's first control and its one primary, and must
 * START above the fold: at a phone both ways up, and on the owner's tablet in
 * the shell both ways up with the #439 insets and
 * `rideview.browser.spec.ts` §`FOLD_MARGIN_PIXELS`' 50 px floor. Every margin
 * is printed. `controls-first.browser.spec.ts` measures Home among every
 * route as well; this is where the card itself, and its controls, are.
 */
const FOLD_MARGIN_PIXELS = 50;
/**
 * SC 2.5.5 (AAA) — `shell.browser.spec.ts` §`TOUCH_TARGET_PIXELS`. The card
 * links and Next up's Ride are ordinary `.oyl-button`s and declare exactly
 * this: 48 is the ride-time controls' alone (#669,
 * `design/ride-time-controls.ts`).
 */
const TOUCH_TARGET_PIXELS = 44;

/**
 * The owner's ruling of 2026-10-01 on #935 still governs the Trainer card's
 * glyph and the days ring: about 48 px tall, and not thin strips. (#1010 made
 * the ride cards' pictures their backgrounds; see below.)
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

const area = (box: Box | undefined): number => (box === undefined ? 0 : box.width * box.height);

const overlaps = (line: Box, box: Box | undefined): boolean =>
  box !== undefined &&
  line.right > box.left + SUBPIXEL_TOLERANCE &&
  line.left < box.right - SUBPIXEL_TOLERANCE &&
  line.bottom > box.top + SUBPIXEL_TOLERANCE &&
  line.top < box.bottom - SUBPIXEL_TOLERANCE;

const inside = (line: Box, box: Box | undefined): boolean =>
  box !== undefined &&
  line.left >= box.left - SUBPIXEL_TOLERANCE &&
  line.right <= box.right + SUBPIXEL_TOLERANCE &&
  line.top >= box.top - SUBPIXEL_TOLERANCE &&
  line.bottom <= box.bottom + SUBPIXEL_TOLERANCE;

/** Whether a computed `background-color` is fully opaque. */
function opaque(colour: string): boolean {
  const channels = /rgba?\(([^)]*)\)/
    .exec(colour)?.[1]
    ?.split(/[,\s/]+/)
    .filter(Boolean);
  if (channels === undefined) return false;
  return channels.length === 3 || Number.parseFloat(channels[3] ?? '0') === 1;
}

const FOLD_VIEWPORTS = [
  { name: 'phone 390×844', width: 390, height: 844, insets: undefined, margin: 0 },
  // #939's review (B2): a phone on its side, a #660 reflow viewport.
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

async function openAt(
  page: Page,
  viewport: (typeof FOLD_VIEWPORTS)[number],
  query?: string,
): Promise<HomeMeasurement> {
  const seen = await open(page, viewport.width, viewport.height, {
    ...(viewport.insets === undefined ? {} : { insets: viewport.insets }),
    ...(query === undefined ? {} : { query }),
  });
  if (viewport.insets !== undefined) {
    // The override took effect, or this measured a page with no insets.
    expect(await resolvedInsets(page)).toEqual(viewport.insets);
  }
  return seen;
}

test.describe('#1010 — Next up is the first thing, and its Ride starts above the fold', () => {
  for (const viewport of FOLD_VIEWPORTS) {
    test(viewport.name, async ({ page }) => {
      const seen = await openAt(page, viewport);
      const next = seen.nextUp;
      expect(next, 'Next up was not drawn').toBeDefined();
      // The apparatus: the fixture's newest ride was on a saved route, so this
      // is the route kind, drawing that route's own shape.
      expect(next?.name).toBe('Box Hill and back');
      expect(next?.drawsProfile).toBe(true);
      expect(next?.rideText).toBe('Ride');
      expect(next?.rideHref).toBe('#/game?route=harness-route');
      const margin = seen.fold - (next?.ride.top ?? Infinity);
      console.log(
        `#1010 ${viewport.name}: Next up ${(next?.card.width ?? 0).toFixed(1)}×` +
          `${(next?.card.height ?? 0).toFixed(1)} px, its Ride ${margin.toFixed(1)} px above the ` +
          `fold (${seen.fold.toFixed(1)}); ride cards ` +
          seen.rideCards.map((card) => card.card.height.toFixed(1)).join(' / ') +
          ' px tall',
      );
      expect(margin).toBeGreaterThan(viewport.margin);
      // The one primary on the screen, and the first control in it.
      expect(seen.primaries).toEqual(['Ride']);
      // The biggest thing on the screen: larger than every other card that
      // starts on it. (On a phone on its side This week starts under the
      // fold, and Next up's picture gives up height there to keep Ride on it.)
      for (const other of [seen.week, seen.trainer, ...seen.rideCards.map((card) => card.card)]) {
        if (other !== undefined && other.top < seen.fold) {
          expect(area(next?.card)).toBeGreaterThan(area(other));
        }
      }
      // Ride is a 44 px target at least, and big: wider than the ride cards' links.
      expect(next?.ride.height ?? 0).toBeGreaterThanOrEqual(TOUCH_TARGET_PIXELS);
      expect(next?.ride.width ?? 0).toBeGreaterThan(
        Math.max(...seen.rideCards.map((card) => card.link.width)),
      );
    });
  }

  test('the control — Next up’s picture at 90 vh puts its Ride under a phone’s fold', async ({
    page,
  }) => {
    const shipped = await open(page, 390, 844);
    const seen = await open(page, 390, 844, { query: '?hero=tall' });
    const grew = (seen.nextUp?.card.height ?? 0) - (shipped.nextUp?.card.height ?? 0);
    const moved = (seen.nextUp?.ride.top ?? 0) - (shipped.nextUp?.ride.top ?? 0);
    console.log(
      `#1010 control: Next up ${(seen.nextUp?.card.height ?? 0).toFixed(1)} px ` +
        `(+${grew.toFixed(1)}), its Ride at ${(seen.nextUp?.ride.top ?? 0).toFixed(1)} ` +
        `(+${moved.toFixed(1)}) against the fold ${seen.fold.toFixed(1)}`,
    );
    expect(seen.nextUp?.ride.top ?? 0).toBeGreaterThan(seen.fold);
    // The picture is what moved the control, by as much as the card grew.
    expect(grew).toBeGreaterThan(100);
    expect(moved).toBeGreaterThanOrEqual(grew - 2 * SUBPIXEL_TOLERANCE);
  });

  test('the control — without the short-viewport rule a phone on its side has Ride lower', async ({
    page,
  }) => {
    const shipped = await open(page, 640, 360);
    const seen = await open(page, 640, 360, { query: '?short=off' });
    const shippedMargin = shipped.fold - (shipped.nextUp?.ride.top ?? Infinity);
    const margin = seen.fold - (seen.nextUp?.ride.top ?? -Infinity);
    console.log(
      `#1010 short-viewport control at 640×360: Ride ${margin.toFixed(1)} px above the fold ` +
        `without the rule, ${shippedMargin.toFixed(1)} with it`,
    );
    expect(margin).toBeLessThan(0);
  });
});

test.describe('#1010 — the pictures are the cards, and every word is on a solid band', () => {
  for (const viewport of FOLD_VIEWPORTS) {
    test(viewport.name, async ({ page }) => {
      const seen = await openAt(page, viewport);
      expect(seen.rideCards).toHaveLength(3);
      const tiles = [
        {
          name: 'Next up',
          card: seen.nextUp?.card,
          art: seen.nextUp?.art,
          band: seen.nextUp?.band,
          fill: seen.nextUp?.bandFill ?? '',
          words: seen.nextUp?.words ?? [],
        },
        ...seen.rideCards.map((card) => ({
          name: card.linkText,
          card: card.card,
          art: card.art,
          band: card.band,
          fill: card.bandFill,
          words: card.words,
        })),
      ];
      console.log(
        `#1010 art at ${viewport.name}: ` +
          tiles
            .map(
              (tile) =>
                `${tile.name} ${(tile.art?.width ?? 0).toFixed(0)}×${(tile.art?.height ?? 0).toFixed(0)}` +
                ` over a ${(tile.band?.height ?? 0).toFixed(0)} px band`,
            )
            .join('; '),
      );
      for (const tile of tiles) {
        const { card, art, band } = tile;
        expect(card, tile.name).toBeDefined();
        // The picture is the card's whole width from its top, and every pixel
        // of height the band does not take: the background, not a thumbnail.
        expect(art, `${tile.name}: no picture`).toBeDefined();
        expect(Math.abs((art?.width ?? 0) - (card?.width ?? 0))).toBeLessThanOrEqual(
          2 * SUBPIXEL_TOLERANCE,
        );
        expect(Math.abs((art?.top ?? 0) - (card?.top ?? 0))).toBeLessThanOrEqual(
          SUBPIXEL_TOLERANCE,
        );
        expect(Math.abs((art?.bottom ?? 0) - (band?.top ?? 0))).toBeLessThanOrEqual(
          SUBPIXEL_TOLERANCE,
        );
        expect(Math.abs((band?.bottom ?? 0) - (card?.bottom ?? 0))).toBeLessThanOrEqual(
          2 * SUBPIXEL_TOLERANCE,
        );
        expect(art?.height ?? 0).toBeGreaterThanOrEqual(MEDIUM_DRAWING_PIXELS.least);
        // Every word on the band, the band a solid fill, and no word on the art.
        expect(tile.words.length).toBeGreaterThanOrEqual(2);
        expect(opaque(tile.fill), `${tile.name}: band fill ${tile.fill}`).toBe(true);
        expect(
          tile.words.filter((line) => !inside(line, band)),
          `${tile.name}: words off the band`,
        ).toEqual([]);
        expect(
          tile.words.filter((line) => overlaps(line, art)),
          `${tile.name}: words on the picture`,
        ).toEqual([]);
      }
      // The ride cards keep their pictures at the size a picture needs.
      for (const card of seen.rideCards) {
        expect(card.art?.height ?? 0, card.linkText).toBeGreaterThanOrEqual(
          MEDIUM_DRAWING_PIXELS.least,
        );
      }
      // The two drawings #1010 left medium.
      expect(notMedium(seen.trainerGlyph), 'the Trainer card’s glyph').toBeUndefined();
      expect(notMedium(seen.daysRing), 'the days ring').toBeUndefined();
    });
  }

  test('the control — words laid over the picture on a clear band are refused', async ({
    page,
  }) => {
    const seen = await open(page, 390, 844, { query: '?band=overlay' });
    expect(seen.rideCards).toHaveLength(3);
    for (const card of seen.rideCards) {
      const onArt = card.words.filter((line) => overlaps(line, card.art));
      console.log(
        `#1010 band control: ${card.linkText} fill ${card.bandFill}, ${String(onArt.length)} lines on the picture`,
      );
      expect(onArt.length).toBeGreaterThan(0);
      expect(opaque(card.bandFill)).toBe(false);
    }
  });
});

const LANDSCAPE_TABLET = FOLD_VIEWPORTS[3];

test.describe('#1010 — a landscape tablet is a dashboard that uses the height', () => {
  test('Next up beside This week and the Trainer card, down to the fold; the ride cards after', async ({
    page,
  }) => {
    const seen = await openAt(page, LANDSCAPE_TABLET);
    const { nextUp: next, week, trainer, start } = seen;
    expect(next).toBeDefined();
    expect(week).toBeDefined();
    expect(trainer).toBeDefined();
    // Beside: This week and Trainer right of Next up, sharing its two rows.
    expect(week?.left ?? 0).toBeGreaterThanOrEqual((next?.card.right ?? Infinity) - 1);
    expect(trainer?.left ?? 0).toBeGreaterThanOrEqual((next?.card.right ?? Infinity) - 1);
    expect(Math.abs((week?.top ?? 0) - (next?.card.top ?? 0))).toBeLessThanOrEqual(1);
    expect(trainer?.top ?? 0).toBeGreaterThanOrEqual((week?.bottom ?? Infinity) - 1);
    expect(Math.abs((trainer?.bottom ?? 0) - (next?.card.bottom ?? 0))).toBeLessThanOrEqual(1);
    // The whole height: the dashboard ends on the screen, close to the fold.
    const spare = seen.fold - (next?.card.bottom ?? Infinity);
    console.log(
      `#1010 dashboard: Next up ${(next?.card.width ?? 0).toFixed(1)}×` +
        `${(next?.card.height ?? 0).toFixed(1)} px, ending ${spare.toFixed(1)} px above the ` +
        `fold (${seen.fold.toFixed(1)}); the ride cards start at ${(start?.top ?? 0).toFixed(1)}`,
    );
    expect(spare).toBeGreaterThanOrEqual(0);
    expect(spare).toBeLessThan(0.1 * seen.fold);
    expect(next?.card.height ?? 0).toBeGreaterThanOrEqual(0.5 * seen.fold);
    // The ride cards after it, three across the whole width.
    expect(start?.top ?? 0).toBeGreaterThanOrEqual((next?.card.bottom ?? Infinity) - 1);
    expect(new Set(seen.rideCards.map((card) => Math.round(card.card.top))).size).toBe(1);
  });

  test('the control — without the dashboard rule This week is under Next up, not beside it', async ({
    page,
  }) => {
    const seen = await openAt(page, LANDSCAPE_TABLET, '?dashboard=off');
    console.log(
      `#1010 dashboard control: This week at ${(seen.week?.top ?? 0).toFixed(1)}, Next up ends ` +
        `at ${(seen.nextUp?.card.bottom ?? 0).toFixed(1)}`,
    );
    expect(seen.week?.top ?? 0).toBeGreaterThanOrEqual((seen.nextUp?.card.bottom ?? Infinity) - 1);
    // And Next up no longer reaches the fold.
    expect(seen.fold - (seen.nextUp?.card.bottom ?? Infinity)).toBeGreaterThan(0.1 * seen.fold);
  });
});

test.describe('#1010 — a portrait tablet, and a phone on its side, are two columns', () => {
  for (const viewport of [FOLD_VIEWPORTS[4], FOLD_VIEWPORTS[1]]) {
    test(viewport.name, async ({ page }) => {
      const seen = await openAt(page, viewport);
      const { nextUp: next, week, trainer, start } = seen;
      // Next up across both columns; This week and Trainer side by side under it.
      expect(Math.abs((next?.card.width ?? 0) - (start?.width ?? -1))).toBeLessThanOrEqual(1);
      expect(week?.top ?? 0).toBeGreaterThanOrEqual((next?.card.bottom ?? Infinity) - 1);
      expect(Math.abs((week?.top ?? 0) - (trainer?.top ?? -1))).toBeLessThanOrEqual(1);
      expect(trainer?.left ?? 0).toBeGreaterThanOrEqual((week?.right ?? Infinity) - 1);
    });
  }
});

test.describe('the ride cards — each one `.oyl-button` link at 44×44', () => {
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
        // 3. With the floor stripped, the tokens still hold the target — the
        // measurement `shell.browser.spec.ts` §#316 makes for every
        // `.oyl-button`. The floor must really be off, or this is 1 again.
        expect(card.strippedMinHeight, `${card.linkText}: the floor was not stripped`).toBe('0px');
        expect(card.stripped.height, card.linkText).toBeGreaterThanOrEqual(TOUCH_TARGET_PIXELS);
        // The stretched link: the card's middle is this card's link, and no other.
        expect(card.middleHitsOwnLink, `${card.linkText}: hit ${card.middleHit}`).toBe(true);
      }
    });
  }
});
