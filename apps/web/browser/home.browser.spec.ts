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
import type { Box, HomeMeasurement, ModuleMeasurement } from './home-harness';

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
 * #947 — the badges reflow at 320 px (WCAG 2.2 SC 1.4.10).
 *
 * The harness's sixty rides earn the first ride and three distance badges, so
 * the list is there to measure. ⚠️ The control is on the SAME page, after the
 * shipped layout is measured: the list's columns are given a floor the phone
 * cannot hold — the `min(100%, …)` cap taken off and the floor widened — and
 * the same measurement must then find a badge past the viewport's edge.
 * Without it, "nothing overflows" is as true of a list that rendered nothing.
 */
test.describe('#947 — the badges reflow at 320 px', () => {
  test('every badge inside the viewport, and the control spills', async ({ page }) => {
    await open(page, 320, 568);
    const badges = () =>
      page.evaluate(() => {
        const items = [...document.querySelectorAll('.oyl-progress__badges > li')];
        return {
          count: items.length,
          words: items.map((each) => each.textContent),
          right: Math.max(...items.map((each) => each.getBoundingClientRect().right)),
          overflow: document.documentElement.scrollWidth - window.innerWidth,
        };
      });
    const shipped = await badges();
    expect(shipped.count).toBeGreaterThanOrEqual(3);
    expect(shipped.words.join(' ')).toContain('ridden in all');
    expect(shipped.right).toBeLessThanOrEqual(320 + SUBPIXEL_TOLERANCE);
    expect(shipped.overflow).toBeLessThanOrEqual(0);

    await page.addStyleTag({
      content:
        '.oyl-progress__badges { grid-template-columns: repeat(auto-fill, minmax(22rem, 1fr)); }',
    });
    const control = await badges();
    expect(control.count).toBe(shipped.count);
    expect(control.right).toBeGreaterThan(320 + SUBPIXEL_TOLERANCE);
  });
});

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
      // Ride is a 44 px target at least. (#1010 also held Next up the biggest
      // card on the screen and its Ride wider than the ride cards' links:
      // both were the picture's and its band's, which #2043 took away.)
      expect(next?.ride.height ?? 0).toBeGreaterThanOrEqual(TOUCH_TARGET_PIXELS);
      expect(next?.ride.width ?? 0).toBeGreaterThanOrEqual(TOUCH_TARGET_PIXELS);
    });
  }

  test('the control — a picture at 90 vh on Next up puts its Ride under a phone’s fold', async ({
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
});

/**
 * #2043 — Next up is a compact quick-launch, not a picture.
 *
 * The owner: *"The home screen has a generic image that takes up a lot of
 * real estate."* Measured on `main` before #2043 at 1280×800: the card 544 px
 * tall (68 %) and its Ride's top at 641 (80 %); at 412×915 the card 383 px
 * (42 %) and its Ride at 439 (48 %). Now its Ride's top is above 30 % of the
 * window at both, and the card at most 20 % of a 1280×800 window — each
 * measured with `getBoundingClientRect` and printed. No insets: these are the
 * windows the issue measured.
 *
 * ⚠️ **The control** (`?picture=back`) puts #1010's picture back above the
 * words at the 12rem floor it had — the card #2043 replaced — and both
 * measurements must fail on it, or the bounds were too loose to see it.
 */
const RIDE_TOP_SHARE = 0.3;
const NEXT_UP_HEIGHT_SHARE = 0.2;
const QUICK_LAUNCH_VIEWPORTS = [
  { name: 'tablet 1280×800', width: 1280, height: 800, boundsHeight: true },
  { name: 'phone 412×915', width: 412, height: 915, boundsHeight: false },
] as const;

test.describe('#2043 — Next up is a compact quick-launch', () => {
  for (const viewport of QUICK_LAUNCH_VIEWPORTS) {
    test(viewport.name, async ({ page }) => {
      const seen = await open(page, viewport.width, viewport.height);
      const next = seen.nextUp;
      expect(next, 'Next up was not drawn').toBeDefined();
      expect(next?.rideText).toBe('Ride');
      const rideTop = (next?.ride.top ?? Infinity) / viewport.height;
      const height = (next?.card.height ?? Infinity) / viewport.height;
      console.log(
        `#2043 ${viewport.name}: Next up ${(next?.card.width ?? 0).toFixed(1)}×` +
          `${(next?.card.height ?? 0).toFixed(1)} px (${(100 * height).toFixed(1)} % of the window), ` +
          `its Ride's top at ${(next?.ride.top ?? 0).toFixed(1)} (${(100 * rideTop).toFixed(1)} %)`,
      );
      expect(rideTop).toBeLessThan(RIDE_TOP_SHARE);
      if (viewport.boundsHeight) {
        expect(height).toBeLessThanOrEqual(NEXT_UP_HEIGHT_SHARE);
      }
    });
  }

  test('the control — #1010’s picture put back fails both', async ({ page }) => {
    for (const viewport of QUICK_LAUNCH_VIEWPORTS) {
      const seen = await open(page, viewport.width, viewport.height, { query: '?picture=back' });
      const rideTop = (seen.nextUp?.ride.top ?? 0) / viewport.height;
      const height = (seen.nextUp?.card.height ?? 0) / viewport.height;
      console.log(
        `#2043 control at ${viewport.name}: Next up ${(100 * height).toFixed(1)} % of the window, ` +
          `its Ride's top at ${(100 * rideTop).toFixed(1)} %`,
      );
      expect(rideTop).toBeGreaterThanOrEqual(RIDE_TOP_SHARE);
      if (viewport.boundsHeight) {
        expect(height).toBeGreaterThan(NEXT_UP_HEIGHT_SHARE);
      }
    }
  });
});

/**
 * Since #2043 Next up is not one of the picture cards: it is checked here for
 * what is left of #1010's rule — every word on its own solid fill, none on a
 * drawing — and that its one drawing, the route's climb, is small.
 */
test.describe('#1010 — the pictures are the cards, and every word is on a solid band', () => {
  for (const viewport of FOLD_VIEWPORTS) {
    test(viewport.name, async ({ page }) => {
      const seen = await openAt(page, viewport);
      expect(seen.rideCards).toHaveLength(3);
      const next = seen.nextUp;
      expect(next, 'Next up was not drawn').toBeDefined();
      expect(next?.words.length ?? 0).toBeGreaterThanOrEqual(3);
      expect(opaque(next?.fill ?? ''), `Next up's fill ${next?.fill ?? ''}`).toBe(true);
      expect(
        next?.words.filter((line) => !inside(line, next.card)),
        'Next up: words off the card',
      ).toEqual([]);
      for (const picture of next?.pictures ?? []) {
        expect(picture.height, 'Next up draws a picture, not a small climb').toBeLessThanOrEqual(
          MEDIUM_DRAWING_PIXELS.most,
        );
        expect(
          next?.words.filter((line) => overlaps(line, picture)),
          'Next up: words on its drawing',
        ).toEqual([]);
      }
      const drawings = (next?.pictures ?? []).map(
        (box) => `a ${box.width.toFixed(0)}×${box.height.toFixed(0)} px climb`,
      );
      console.log(
        `#2043 Next up at ${viewport.name}: ${drawings.length === 0 ? 'no drawing' : drawings.join(', ')}`,
      );
      const tiles = seen.rideCards.map((card) => ({
        name: card.linkText,
        card: card.card,
        art: card.art,
        band: card.band,
        fill: card.bandFill,
        words: card.words,
      }));
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

/**
 * #2044 — Home is a grid of modules.
 *
 * The four modules, in their one reading order: Next up (the quick-launch),
 * the sensors (the Trainer card, #2045's slot), the last ride (#2048's) and
 * the week (#2049's). ⚠️ A reviewer who remembers §"#1010 — a landscape
 * tablet is a dashboard" holding Next up down to the fold, with This week and
 * the Trainer card stacked beside it, is reading the old file: #2043 made Next
 * up a compact row and #2044 made the first screen two rows of two.
 *
 * - At 1280×800 in the shell all four are wholly above the fold. **Control:**
 *   `?columns=one`, every module one column wide, puts the week under it.
 * - At 412×915 they are one column in that order, and every child of the grid
 *   is lower on the screen than the one before it in the DOM.
 * - The tab order follows the visual order on every layout: each tab stop's
 *   module is never before the previous stop's in reading order — rows top to
 *   bottom, and left to right within a row.
 */
const LANDSCAPE_TABLET = FOLD_VIEWPORTS[3];

interface GridViewport {
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly insets: Insets | undefined;
}

const GRID_VIEWPORTS: readonly GridViewport[] = [
  LANDSCAPE_TABLET,
  FOLD_VIEWPORTS[4],
  FOLD_VIEWPORTS[1],
  { name: 'phone 412×915', width: 412, height: 915, insets: undefined },
];
const PHONE_412 = GRID_VIEWPORTS[3] as GridViewport;

async function openGrid(page: Page, viewport: GridViewport, query?: string) {
  const seen = await open(page, viewport.width, viewport.height, {
    ...(viewport.insets === undefined ? {} : { insets: viewport.insets }),
    ...(query === undefined ? {} : { query }),
  });
  if (viewport.insets !== undefined) {
    expect(await resolvedInsets(page)).toEqual(viewport.insets);
  }
  return seen;
}

/** The four modules' boxes, in reading order, from one measurement. */
function fourModules(seen: HomeMeasurement): readonly (readonly [string, Box | undefined])[] {
  return [
    ['Next up', seen.nextUp?.card],
    ['the sensors', seen.trainer],
    ['the last ride', seen.lastRide],
    ['the week', seen.week],
  ];
}

const describeBoxes = (boxes: readonly (readonly [string, Box | undefined])[]): string =>
  boxes
    .map(
      ([name, box]) =>
        `${name} ${(box?.left ?? NaN).toFixed(0)},${(box?.top ?? NaN).toFixed(0)}` +
        `–${(box?.bottom ?? NaN).toFixed(0)}`,
    )
    .join('; ');

/**
 * Whether the modules' visual reading order is their DOM order: sorted by top
 * (a row's modules share one, within a pixel) and then by left, they are
 * still in DOM order. Returns their DOM indices in visual order.
 */
function visualOrder(modules: readonly ModuleMeasurement[]): readonly number[] {
  return modules
    .map((module, index) => ({ index, box: module.box }))
    .sort((a, b) =>
      Math.abs(a.box.top - b.box.top) > SUBPIXEL_TOLERANCE
        ? a.box.top - b.box.top
        : a.box.left - b.box.left,
    )
    .map((each) => each.index);
}

test.describe('#2044 — Home is a grid of modules', () => {
  test('a landscape tablet: Next up beside the sensors, the last ride beside the week, all four above the fold', async ({
    page,
  }) => {
    const seen = await openAt(page, LANDSCAPE_TABLET);
    const four = fourModules(seen);
    console.log(`#2044 tablet 1280×800, fold ${seen.fold.toFixed(1)}: ${describeBoxes(four)}`);
    for (const [name, box] of four) {
      expect(box, `${name} was not drawn`).toBeDefined();
      expect(box?.top ?? -1, `${name} starts above the screen`).toBeGreaterThanOrEqual(0);
      expect(box?.bottom ?? Infinity, `${name} is not wholly above the fold`).toBeLessThanOrEqual(
        seen.fold + SUBPIXEL_TOLERANCE,
      );
    }
    const { nextUp: next, trainer, lastRide, week, start } = seen;
    // Two rows of two: each wide module beside a narrow one, level with it.
    expect(trainer?.left ?? 0).toBeGreaterThanOrEqual((next?.card.right ?? Infinity) - 1);
    expect(Math.abs((trainer?.top ?? 0) - (next?.card.top ?? -1))).toBeLessThanOrEqual(1);
    expect(week?.left ?? 0).toBeGreaterThanOrEqual((lastRide?.right ?? Infinity) - 1);
    expect(Math.abs((week?.top ?? 0) - (lastRide?.top ?? -1))).toBeLessThanOrEqual(1);
    expect(lastRide?.top ?? 0).toBeGreaterThanOrEqual(
      Math.max(next?.card.bottom ?? Infinity, trainer?.bottom ?? Infinity) - 1,
    );
    // The last ride takes columns 1–2, as wide as Next up above it, so column
    // 2 is not left empty beside the week.
    expect(Math.abs((lastRide?.left ?? 0) - (next?.card.left ?? -1))).toBeLessThanOrEqual(1);
    expect(Math.abs((lastRide?.right ?? 0) - (next?.card.right ?? -1))).toBeLessThanOrEqual(1);
    // The ride cards after all four, three across the whole width.
    expect(start?.top ?? 0).toBeGreaterThanOrEqual(
      Math.max(week?.bottom ?? Infinity, lastRide?.bottom ?? Infinity) - 1,
    );
    expect(new Set(seen.rideCards.map((card) => Math.round(card.card.top))).size).toBe(1);
  });

  test('a first open on a landscape tablet: the other ways to start take the last ride’s columns 1–2', async ({
    page,
  }) => {
    const seen = await openAt(page, LANDSCAPE_TABLET, '?rides=none');
    const empty = await page.locator('.oyl-home__empty').boundingBox();
    expect(empty, 'the first-open state was not drawn').not.toBeNull();
    const next = seen.nextUp?.card;
    console.log(
      `#2044 first open: empty ${(empty?.x ?? NaN).toFixed(0)}–${((empty?.x ?? 0) + (empty?.width ?? 0)).toFixed(0)}, ` +
        `Next up ${(next?.left ?? NaN).toFixed(0)}–${(next?.right ?? NaN).toFixed(0)}`,
    );
    expect(Math.abs((empty?.x ?? 0) - (next?.left ?? -1))).toBeLessThanOrEqual(1);
    expect(
      Math.abs((empty?.x ?? 0) + (empty?.width ?? 0) - (next?.right ?? -1)),
    ).toBeLessThanOrEqual(1);
  });

  test('the control — one column puts a module under the landscape tablet’s fold', async ({
    page,
  }) => {
    const seen = await openAt(page, LANDSCAPE_TABLET, '?columns=one');
    const four = fourModules(seen);
    console.log(`#2044 control, one column, fold ${seen.fold.toFixed(1)}: ${describeBoxes(four)}`);
    const below = four.filter(([, box]) => (box?.bottom ?? 0) > seen.fold + SUBPIXEL_TOLERANCE);
    expect(below.map(([name]) => name)).not.toEqual([]);
  });

  test('the control — without the dashboard rule the sensors are under Next up, not beside it', async ({
    page,
  }) => {
    const seen = await openAt(page, LANDSCAPE_TABLET, '?dashboard=off');
    console.log(
      `#2044 dashboard control: the sensors at ${(seen.trainer?.top ?? 0).toFixed(1)}, Next up ` +
        `ends at ${(seen.nextUp?.card.bottom ?? 0).toFixed(1)}`,
    );
    expect(seen.trainer?.top ?? 0).toBeGreaterThanOrEqual(
      (seen.nextUp?.card.bottom ?? Infinity) - 1,
    );
  });

  /*
   * The owner's screenshot review of #2045 (2026-11-05): with four sensors
   * paired the module was ~430–480 px tall and pushed Last ride and This week
   * under the tablet's fold. Each device is one compact row now.
   */
  test('four sensors paired: the last ride and the week are still above the landscape tablet’s fold', async ({
    page,
  }) => {
    const seen = await openAt(page, LANDSCAPE_TABLET, '?sensors=four');
    const four = fourModules(seen);
    console.log(
      `#2045 four sensors, tablet 1280×800, fold ${seen.fold.toFixed(1)}, sensors ` +
        `${(seen.trainer?.height ?? NaN).toFixed(0)} px tall: ${describeBoxes(four)}`,
    );
    expect(await page.locator('.oyl-home__sensor-row').count()).toBe(4);
    for (const [name, box] of four) {
      expect(box, `${name} was not drawn`).toBeDefined();
      expect(box?.bottom ?? Infinity, `${name} is not wholly above the fold`).toBeLessThanOrEqual(
        seen.fold + SUBPIXEL_TOLERANCE,
      );
    }
  });

  test('the control — four sensors on stacked rows push the last ride and the week under the fold', async ({
    page,
  }) => {
    const seen = await openAt(page, LANDSCAPE_TABLET, '?sensors=four&rows=stacked');
    console.log(
      `#2045 control, stacked rows, fold ${seen.fold.toFixed(1)}, sensors ` +
        `${(seen.trainer?.height ?? NaN).toFixed(0)} px tall: ${describeBoxes(fourModules(seen))}`,
    );
    expect(seen.lastRide?.bottom ?? 0).toBeGreaterThan(seen.fold + SUBPIXEL_TOLERANCE);
    expect(seen.week?.bottom ?? 0).toBeGreaterThan(seen.fold + SUBPIXEL_TOLERANCE);
  });

  test('a phone 412×915: one column, quick-launch, sensors, last ride, week, then the rest', async ({
    page,
  }) => {
    const seen = await openGrid(page, PHONE_412);
    const four = fourModules(seen);
    console.log(
      `#2044 phone 412×915: ${describeBoxes(four)}; then ` +
        seen.modules
          .slice(4)
          .map((module) => `${module.name} ${module.box.top.toFixed(0)}`)
          .join(', '),
    );
    // DOM order: the four are the grid's first four children, in this order.
    expect(seen.modules.slice(0, 4).map((module) => module.box)).toEqual(
      four.map(([, box]) => box),
    );
    // Visual order: every child lower than the one before it, one column.
    for (const [index, module] of seen.modules.entries()) {
      expect(Math.abs(module.box.left - (seen.modules[0]?.box.left ?? -1))).toBeLessThanOrEqual(
        SUBPIXEL_TOLERANCE,
      );
      if (index > 0) {
        expect(module.box.top, `${module.name} is not under the one before it`).toBeGreaterThan(
          seen.modules[index - 1]?.box.bottom ?? Infinity,
        );
      }
    }
  });

  for (const viewport of GRID_VIEWPORTS) {
    test(`the tab order follows the visual order — ${viewport.name}`, async ({ page }) => {
      const seen = await openGrid(page, viewport);
      const order = visualOrder(seen.modules);
      // The modules' visual order is their DOM order...
      expect(
        order.map((index) => seen.modules[index]?.name),
        'the modules on the screen are not in DOM order',
      ).toEqual(seen.modules.map((module) => module.name));
      // ...and the tab stops walk the modules in it, never back.
      expect(seen.tabModules.length).toBeGreaterThanOrEqual(5);
      const back = seen.tabModules.filter(
        (module, index) => index > 0 && module < (seen.tabModules[index - 1] ?? 0),
      );
      console.log(
        `#2044 tab order at ${viewport.name}: ${String(seen.tabModules.length)} stops over modules ` +
          seen.tabModules.join(' '),
      );
      expect(back, 'a tab stop goes back to a module before the last one').toEqual([]);
    });
  }
});

/** #1010's two-column layout, as #2044 re-ordered it. */
test.describe('#2044 — a portrait tablet, and a phone on its side, are two columns', () => {
  for (const viewport of [FOLD_VIEWPORTS[4], FOLD_VIEWPORTS[1]]) {
    test(viewport.name, async ({ page }) => {
      const seen = await openAt(page, viewport);
      const { nextUp: next, trainer, lastRide, week, start } = seen;
      // Next up and the sensors across both columns; the last ride and the week side by side.
      expect(Math.abs((next?.card.width ?? 0) - (start?.width ?? -1))).toBeLessThanOrEqual(1);
      expect(Math.abs((trainer?.width ?? 0) - (start?.width ?? -1))).toBeLessThanOrEqual(1);
      expect(trainer?.top ?? 0).toBeGreaterThanOrEqual((next?.card.bottom ?? Infinity) - 1);
      expect(lastRide?.top ?? 0).toBeGreaterThanOrEqual((trainer?.bottom ?? Infinity) - 1);
      expect(Math.abs((week?.top ?? 0) - (lastRide?.top ?? -1))).toBeLessThanOrEqual(1);
      expect(week?.left ?? 0).toBeGreaterThanOrEqual((lastRide?.right ?? Infinity) - 1);
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

/**
 * #1429 — a first open, and the More tab, at a phone, a tablet and a desktop.
 *
 * A first open (`home.html?rides=none`): ONE primary, the first step, and the
 * other three ways to start — a route, a workout, an import — each a link
 * whose bottom is above the fold, with no link on Home twice. Before #1429
 * the walkthrough's 412×915 had all three under the fold, behind three picture
 * cards, and three links to the Ride screen.
 *
 * ⚠️ **The control** is #1010's: Next up's picture at 90 vh (`?hero=tall`),
 * which must push the three links under a phone's fold — or "above the fold"
 * was a page too short to have one.
 *
 * The More tab: its link opens a page titled More, whose list holds every page
 * under the tab and Instance, each link a 44 px target above the fold, going
 * to the page it names.
 */
const FIRST_OPEN_VIEWPORTS = [
  { name: 'phone 412×915, the walkthrough’s', width: 412, height: 915, insets: undefined },
  { name: 'phone 390×844', width: 390, height: 844, insets: undefined },
  {
    name: 'tablet in the shell, upright 800×1280',
    width: 800,
    height: 1280,
    insets: PIXEL_TABLET_PORTRAIT_INSETS_ASSUMED,
  },
  {
    name: 'tablet in the shell, landscape 1280×800',
    width: 1280,
    height: 800,
    insets: PIXEL_TABLET_LANDSCAPE_INSETS,
  },
  { name: 'desktop 1440×900', width: 1440, height: 900, insets: undefined },
] as const;

const OTHER_WAYS = ['#/game', '#/workouts', '#/transfer'] as const;

interface FirstOpenReading {
  readonly fold: number;
  readonly primaries: readonly string[];
  /** Every link in main, by its `href`, in document order. */
  readonly hrefs: readonly string[];
  /** Each of {@link OTHER_WAYS}'s bottom edge, in the same order. */
  readonly otherWays: readonly number[];
}

async function readFirstOpen(
  page: Page,
  viewport: (typeof FIRST_OPEN_VIEWPORTS)[number],
  query = '',
): Promise<FirstOpenReading> {
  const seen = await open(page, viewport.width, viewport.height, {
    query: `?rides=none${query}`,
    ...(viewport.insets === undefined ? {} : { insets: viewport.insets }),
  });
  if (viewport.insets !== undefined) {
    expect(await resolvedInsets(page)).toEqual(viewport.insets);
  }
  const read = await page.evaluate((wanted) => {
    window.scrollTo(0, 0);
    return {
      hrefs: [...document.querySelectorAll('main a')].map(
        (link) => link.getAttribute('href') ?? '',
      ),
      otherWays: wanted.map(
        (href) =>
          document.querySelector(`main a[href="${href}"]`)?.getBoundingClientRect().bottom ??
          Number.POSITIVE_INFINITY,
      ),
    };
  }, OTHER_WAYS);
  return { fold: seen.fold, primaries: seen.primaries, ...read };
}

test.describe('#1429 — a first open has one first step, and the rest above the fold', () => {
  for (const viewport of FIRST_OPEN_VIEWPORTS) {
    test(viewport.name, async ({ page }) => {
      const read = await readFirstOpen(page, viewport);
      console.log(
        `#1429 ${viewport.name}: fold ${read.fold.toFixed(1)}; route / workout / import end at ` +
          read.otherWays.map((bottom) => bottom.toFixed(1)).join(' / '),
      );
      expect(read.primaries, 'one primary, the first step').toEqual(['Start a ride']);
      expect(
        read.hrefs.filter((href, index) => read.hrefs.indexOf(href) !== index),
        `a link on Home twice: ${read.hrefs.join(', ')}`,
      ).toEqual([]);
      for (const [index, bottom] of read.otherWays.entries()) {
        expect(bottom, `${OTHER_WAYS[index] ?? ''} is under the fold`).toBeLessThanOrEqual(
          read.fold + SUBPIXEL_TOLERANCE,
        );
      }
    });
  }

  test('the control — Next up’s picture at 90 vh puts the other ways under a phone’s fold', async ({
    page,
  }) => {
    const read = await readFirstOpen(page, FIRST_OPEN_VIEWPORTS[0], '&hero=tall');
    console.log(
      `#1429 control: fold ${read.fold.toFixed(1)}; route / workout / import end at ` +
        read.otherWays.map((bottom) => bottom.toFixed(1)).join(' / '),
    );
    expect(Math.min(...read.otherWays)).toBeGreaterThan(read.fold);
  });
});

test.describe('#1429 — the More tab opens a page that is what its label says', () => {
  for (const viewport of FIRST_OPEN_VIEWPORTS) {
    test(viewport.name, async ({ page }) => {
      const seen = await open(page, viewport.width, viewport.height, {
        ...(viewport.insets === undefined ? {} : { insets: viewport.insets }),
      });
      await page
        .getByRole('navigation', { name: 'Primary' })
        .getByRole('link', { name: 'More' })
        .click();
      await page.waitForSelector('main .oyl-more a');
      const read = await page.evaluate(() => {
        window.scrollTo(0, 0);
        return {
          title: document.querySelector('h1')?.textContent ?? '',
          current:
            document
              .querySelector('nav[aria-label="Primary"] a[aria-current="page"]')
              ?.textContent?.trim() ?? '',
          menu: [...document.querySelectorAll('main .oyl-more a')].map((link) => ({
            text: (link.textContent ?? '').trim(),
            href: link.getAttribute('href') ?? '',
            bottom: link.getBoundingClientRect().bottom,
            height: link.getBoundingClientRect().height,
          })),
        };
      });
      console.log(
        `#1429 More ${viewport.name}: fold ${seen.fold.toFixed(1)}; ` +
          read.menu.map((each) => `${each.text} ${each.bottom.toFixed(0)}`).join(', '),
      );
      expect(read.title).toBe('More');
      expect(read.current).toBe('More');
      expect(read.menu.map((each) => [each.text, each.href])).toEqual([
        ['Devices', '#/devices'],
        ['Files', '#/transfer'],
        ['Camera', '#/camera'],
        ['Settings', '#/settings'],
        ['Instance', '#/settings/instance'],
        ['About', '#/about'],
      ]);
      for (const each of read.menu) {
        expect(each.bottom, `${each.text} is under the fold`).toBeLessThanOrEqual(
          seen.fold + SUBPIXEL_TOLERANCE,
        );
        expect(each.height, `${each.text} is not a 44 px target`).toBeGreaterThanOrEqual(
          TOUCH_TARGET_PIXELS,
        );
      }
    });
  }
});
