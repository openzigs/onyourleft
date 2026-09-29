// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The app shell, laid out by a real engine — #307's review.
 *
 * ## The hole this closes
 *
 * #307 made `.oyl-header` sticky and gave `.oyl-main` a `scroll-margin-top`,
 * and every gate in the repository stayed green while the result was, at
 * 320×256, a header covering **70% of the viewport** and a "Skip to main
 * content" that landed the `<h1>` **entirely behind it**. The review's durable
 * finding was that this repository's accessibility gate is structurally blind
 * to *layout*: jsdom performs no layout (CLAUDE.md §4e), `theme.a11y.test.ts`
 * reads the stylesheet as a file, and the browser gate rendered a map, a 3D
 * scene and a HUD panel — never the chrome.
 *
 * So `position`, `z-index`, `scroll-margin-top` and the height of persistent
 * chrome had **zero** coverage, and `test:a11y` passing was not evidence about
 * any of them. This file is the missing measurement.
 *
 * ## Which assertions are invariants and which are the literal regression
 *
 * Both kinds are here on purpose and they fail for different reasons.
 *
 * - {@link PERSISTENT_CHROME_BUDGET} is the **invariant**. It says nothing
 *   about `position: sticky`: it scrolls the page and asks how much of the
 *   viewport the chrome still covers. A header made sticky again at a phone's
 *   width fails it, and so would a fixed footer, a banner, or anything else
 *   somebody pins to the edge of a small screen later.
 * - the skip-link and stacking tests pin the two **specific** defects, so that
 *   a failure names the thing a rider would experience rather than a ratio.
 *
 * ## Why every assertion is taken from the browser
 *
 * Nothing here recomputes a layout. Every number is `getBoundingClientRect`,
 * `getComputedStyle`, `scrollY` or `elementFromPoint`, read out of Chromium
 * after it has laid the real markup out under the real stylesheet. A harness
 * that worked out where the `h1` ought to be would be measuring itself — the
 * lesson `hud-harness.tsx` records.
 *
 * ## What this does NOT prove
 *
 * That the shell looks right; there is no reference image and ADR 0009 forbids
 * deriving one from another product. That it works on a real phone; a 320 px
 * viewport in a headless Chromium is not a handlebar in the rain. And nothing
 * about colour beyond the one background asserted below —
 * `contrast.a11y.test.ts` owns the palette.
 */

import { expect, test, type Page } from '@playwright/test';

import { AA_LARGE_TEXT_OR_NON_TEXT, contrastRatio } from '../src/design/contrast';
import {
  COLOUR_TOKENS,
  PLATFORM_CHECK_MARK,
  THEMES,
  paletteColours,
  type ColourToken,
  type Theme,
} from '../src/design/tokens';
import { decodePng } from '../src/game/model-bytes-testing';
import {
  applyInsets,
  PIXEL_TABLET_LANDSCAPE_INSETS,
  PIXEL_TABLET_PORTRAIT_INSETS_ASSUMED,
  resolvedInsets,
  type Insets,
} from './insets';

/**
 * The viewports measured, and why each is here.
 *
 * ⚠️ 320×256 is not a device. It is the viewport **WCAG 2.2 SC 1.4.10 (Reflow,
 * AA)** names, and it is what a 1280×1024 window becomes at 400% zoom — so it
 * is the low-vision reader this product has, not a phone nobody owns. It is
 * first in the list because it is the one that found the defect.
 */
const VIEWPORTS = [
  { name: '320×256 — the SC 1.4.10 viewport', width: 320, height: 256 },
  { name: '375×667 — a phone', width: 375, height: 667 },
  { name: '768×1024 — a tablet', width: 768, height: 1024 },
  { name: '1024×640 — the smallest the sticky query admits', width: 1024, height: 640 },
  { name: '1280×800 — a laptop', width: 1280, height: 800 },
] as const;

/**
 * The most of a viewport that chrome may still cover once the page is scrolled.
 *
 * ⚠️ **17 %, down from 20 % — #671, and a reviewer who remembers 0.2 is reading
 * the old file.** The area is the header and the navigation together (#427),
 * and it is published per viewport on every run (`chrome area` in the log and
 * in each case's annotations). Measured in the lockfile-pinned Chromium,
 * before (`main` at 4b0ba28) and after #671:
 *
 *   320×256    0 px²       0.0 %  →       0 px²   0.0 %   nothing pinned
 *   375×667    23 561 px²  9.4 %  →  23 561 px²   9.4 %   the bar alone
 *   768×1024   90 112 px² 11.5 %  →  90 112 px²  11.5 %   the rail alone
 *   1024×640  123 712 px² 18.9 %  → 101 248 px²  15.4 %   rail + sticky header
 *   1280×800  156 224 px² 15.3 %  → 127 616 px²  12.5 %   rail + sticky header
 *
 * Only the two viewports where the header sticks moved, because everywhere
 * else it scrolls away; the worst case is still 1024×640, the smallest the
 * sticky query admits, and it is now a 48 px header beside the 88 px rail.
 *
 * **The margin is 1.6 points over that worst case**, and it is sized against
 * what can move: both boxes are DECLARED lengths now (`--oyl-header-height`,
 * the rail's 5.5rem), so a font-metric difference between Chromium builds
 * cannot move the area at all, and the margin is room for a header about 10 px
 * taller than the declared one and no more. The header #671 replaced — 72 px —
 * is 18.9 % at 1024×640 and fails, which is the measured control.
 */
const PERSISTENT_CHROME_BUDGET = 0.17;

/**
 * How far clear of the chrome a heading has to land after a fragment jump, in
 * CSS pixels.
 *
 * Without a sticky header the gap is `.oyl-main`'s own 1.5rem top padding —
 * 24px — so anything much under that is a regression against the layout with no
 * sticky header at all, and a heading flush against the bottom edge of the
 * chrome reads as part of the chrome rather than as the top of the page.
 *
 * ⚠️ This floor, not the sign of the gap, is what pins the `scroll-margin-top`
 * VALUE. #307 shipped `5rem` (80px); inside the media query the header measures
 * 97px, so the heading would land 7px clear — positive, and a
 * `heading >= chrome` assertion would pass it. 16px is under the 24px the
 * non-sticky layout gives and over the 7px that value produces, so the gate
 * fails the number rather than only failing its absence.
 */
const MINIMUM_HEADING_CLEARANCE = 16;

/** `#dde0df`, elevation 3 in `design/tokens.ts`, as Chromium reports a colour. */
const ELEVATION_3 = 'rgb(221, 224, 223)';

async function openShell(page: Page): Promise<void> {
  await page.goto('/shell.html');
  await page.waitForSelector('html[data-oyl-shell-ready]');
}

/** Two animation frames, which is when a scroll a focus call caused has settled. */
async function settled(page: Page): Promise<void> {
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

for (const viewport of VIEWPORTS) {
  test.describe(viewport.name, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test('the stylesheet loaded and the page can scroll, or nothing below means anything', async ({
      page,
    }) => {
      // The control, and it is not ceremony. Both of the measurements this file
      // exists for are trivially satisfied by a broken page: chrome that is
      // zero pixels tall is inside any budget, and a document shorter than the
      // viewport cannot scroll, so a fragment jump moves nothing and the `h1`
      // is "clear of the header" by having never moved. Every viewport above
      // 320×640 reported exactly that on this harness's first run, before
      // `shell-harness.tsx` §SPACER_PIXELS existed.
      await openShell(page);

      const state = await page.evaluate(() => {
        const header = document.querySelector('.oyl-header');
        const region = document.querySelector('.oyl-main');
        if (header === null || region === null) throw new Error('no .oyl-header or no .oyl-main');
        return {
          headerBackground: getComputedStyle(header).backgroundColor,
          scrollable: document.documentElement.scrollHeight - window.innerHeight,
          overflowsViewport: region.getBoundingClientRect().height - window.innerHeight,
        };
      });

      // ⚠️ Not the header's HEIGHT, which this used to require be positive:
      // since #671 the header is zero tall below the rail breakpoint on
      // purpose. Its computed surface below says the stylesheet loaded, and
      // §"#671" measures the height against what `theme.css` declares.
      expect(
        state.headerBackground,
        'the header is not painted in the elevation-3 surface. Either theme.css did not load, ' +
          'or the ramp and the rules that use it have drifted apart',
      ).toBe(ELEVATION_3);
      expect(
        state.scrollable,
        'the document is not taller than the viewport, so nothing below can scroll and the ' +
          'skip-link assertions would pass over a page that never moved',
      ).toBeGreaterThan(200);

      // ⚠️ The second half of the control, and the one that is easy to leave
      // out. A `focus()` on an element that already fits on screen scrolls to
      // the top of the document and stops — `scroll-margin-top` is never
      // consulted, and the skip-link test below passes without ever exercising
      // the property it is about. Measured: with the harness spacer placed
      // after the footer instead of inside `main`, `scroll-margin-top: 5rem` —
      // the value #307 shipped and its review blocked on — left the entire
      // spec green. `main` taller than the viewport is what the product's own
      // views are, and it is what makes the measurement real.
      expect(
        state.overflowsViewport,
        '<main> fits inside the viewport, so focusing it scrolls to the top of the document ' +
          'and scroll-margin-top is never applied. Every skip-link assertion in this file is ' +
          'then vacuous — see shell-harness.tsx §SPACER_PIXELS',
      ).toBeGreaterThan(0);
    });

    test('content is not required to scroll in two dimensions (SC 1.4.10)', async ({ page }) => {
      await openShell(page);

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );

      // The literal requirement of SC 1.4.10 for vertical-scrolling content:
      // at 320 CSS px there is no horizontal scrollbar. Sub-pixel rounding is
      // tolerated; a wrapped nav or an over-wide table is not.
      expect(
        overflow,
        'the page scrolls horizontally, which SC 1.4.10 forbids',
      ).toBeLessThanOrEqual(1);
    });

    test('persistent chrome leaves the viewport to the content', async ({ page }) => {
      await openShell(page);

      // Scroll well past anything in the flow. Whatever still covers part of
      // the viewport after this is, by definition, persistent.
      await page.evaluate(() => {
        window.scrollTo(0, 2000);
      });
      await settled(page);

      const covered = await page.evaluate(() => {
        const header = document.querySelector('.oyl-header');
        const nav = document.querySelector('nav[aria-label="Primary"]');
        if (header === null || nav === null) throw new Error('no .oyl-header or no Primary nav');
        // ⚠️ Since #427 the header is not the only chrome: the navigation is a
        // bar pinned to the bottom or a rail pinned to the side. So what is
        // measured is AREA — how much of the viewport the header and the
        // navigation still cover between them — and a height share is the
        // special case of it the header alone used to be.
        const clip = (box: DOMRect) => ({
          left: Math.max(box.left, 0),
          top: Math.max(box.top, 0),
          right: Math.min(box.right, window.innerWidth),
          bottom: Math.min(box.bottom, window.innerHeight),
        });
        const area = (box: { left: number; top: number; right: number; bottom: number }) =>
          Math.max(0, box.right - box.left) * Math.max(0, box.bottom - box.top);
        const a = clip(header.getBoundingClientRect());
        const b = clip(nav.getBoundingClientRect());
        const both = {
          left: Math.max(a.left, b.left),
          top: Math.max(a.top, b.top),
          right: Math.min(a.right, b.right),
          bottom: Math.min(a.bottom, b.bottom),
        };
        const visible = area(a) + area(b) - area(both);
        return {
          visible,
          viewport: window.innerWidth * window.innerHeight,
          scrollY: window.scrollY,
        };
      });

      expect(covered.scrollY, 'the page did not scroll, so this measures nothing').toBeGreaterThan(
        0,
      );

      const share = covered.visible / covered.viewport;
      // Published, not only bounded (#671): the budget is set from these.
      const published = `${covered.visible.toFixed(0)} px², ${(share * 100).toFixed(2)} % of ${String(
        covered.viewport,
      )} px²`;
      console.log(`chrome area, ${viewport.name}: ${published}`);
      test.info().annotations.push({ type: 'chrome area', description: published });
      expect(
        share,
        `the header and the navigation still cover ${covered.visible.toFixed(0)} px² of a ${String(
          covered.viewport,
        )} px² viewport — ${(share * 100).toFixed(1)}%. Persistent chrome on a small viewport is ` +
          'the #307 regression: at 320×256, the viewport SC 1.4.10 names, a sticky eleven-link ' +
          'header left 78px for the content. theme.css bounds this with a media query; see the ' +
          'block below .oyl-main',
      ).toBeLessThanOrEqual(PERSISTENT_CHROME_BUDGET);
    });

    /*
     * ⚠️ This covers **every route change as well as the skip link**, and that
     * is worth saying because the skip link looks like a rare path.
     * `AppShell.skipToContent` calls `mainRef.current.focus()`, and so does the
     * `useEffect` that runs on every route change — the same call, the same
     * scroll, the same `scroll-margin-top`. A rider who never presses Tab meets
     * this on every tap of the navigation.
     */
    test('“Skip to main content” lands the heading where it can be read', async ({ page }) => {
      await openShell(page);

      // Tab, rather than `focus()`, because the skip link is revealed by
      // `:focus-visible` and a scripted focus does not reliably satisfy it.
      // This is also what a keyboard user actually does, and the skip link is
      // the first focusable thing in the document.
      await page.keyboard.press('Tab');
      await expect(page.locator('.oyl-skip-link')).toBeFocused();

      await page.locator('.oyl-skip-link').press('Enter');
      await settled(page);

      const landed = await page.evaluate(() => {
        const header = document.querySelector('.oyl-header');
        const heading = document.querySelector('h1');
        const main = document.querySelector('.oyl-main');
        if (header === null || heading === null || main === null) {
          throw new Error('the shell is missing its header, its h1 or its main');
        }
        const headerBox = header.getBoundingClientRect();
        const headingBox = heading.getBoundingClientRect();
        return {
          // Zero when the header has scrolled away, its height when pinned.
          headerBottom: Math.max(0, Math.min(headerBox.bottom, window.innerHeight)),
          headingTop: headingBox.top,
          headingBottom: headingBox.bottom,
          viewport: window.innerHeight,
          focusedMain: document.activeElement === main,
          scrollY: window.scrollY,
        };
      });

      // The control for this one: if focus never reached `main`, the scroll
      // that follows from it never happened either and the numbers below are
      // about a page nobody skipped into.
      expect(landed.focusedMain, 'focus did not reach <main>, so no fragment jump occurred').toBe(
        true,
      );

      expect(
        landed.headingTop - landed.headerBottom,
        `the h1 is at y=${landed.headingTop.toFixed(0)} with the header occupying ` +
          `0..${landed.headerBottom.toFixed(0)}. The heading a rider was just sent to is ` +
          'underneath the chrome, or close enough to it to read as part of it — #307 shipped ' +
          'this with scroll-margin-top: 5rem (80px) against a header of 97px to 178px',
      ).toBeGreaterThanOrEqual(MINIMUM_HEADING_CLEARANCE);

      expect(
        landed.headingBottom,
        'the h1 is below the fold after skipping to it, which is the same failure upside down',
      ).toBeLessThanOrEqual(landed.viewport);
    });

    test('the focused skip link is painted above the header, not under it', async ({ page }) => {
      await openShell(page);
      await page.keyboard.press('Tab');
      await expect(page.locator('.oyl-skip-link')).toBeFocused();
      await settled(page);

      const hit = await page.evaluate(() => {
        const link = document.querySelector('.oyl-skip-link');
        const header = document.querySelector('.oyl-header');
        if (link === null || header === null) throw new Error('no skip link or no header');
        const box = link.getBoundingClientRect();
        const centre = document.elementFromPoint(
          box.left + box.width / 2,
          box.top + box.height / 2,
        );

        // The control: a point inside the header and clear of the link has to
        // hit the header. Without it, an `elementFromPoint` that returned
        // `null` for everything — an off-screen link, a zero-size box — would
        // make the assertion below unfalsifiable.
        //
        // ⚠️ Since #671 the header has NO box below the rail breakpoint, so
        // there it is the far end of the `h1`'s box that has to hit the `h1`
        // — the same proof that hit-testing sees this page, on the one thing
        // every route is sure to have, and clear of the link, which on a
        // phone sits over the heading's start.
        const headerBox = header.getBoundingClientRect();
        const heading = document.querySelector('h1');
        if (heading === null) throw new Error('no h1');
        const headingBox = heading.getBoundingClientRect();
        const [target, x, y] =
          headerBox.height > 0
            ? [header, headerBox.right - 4, headerBox.top + headerBox.height / 2]
            : [heading, headingBox.right - 4, headingBox.top + headingBox.height / 2];
        const elsewhere = document.elementFromPoint(x, y);

        return {
          onLink: centre !== null && link.contains(centre),
          onHeaderElsewhere: elsewhere !== null && target.contains(elsewhere),
          linkHeight: box.height,
        };
      });

      expect(hit.linkHeight, 'the skip link has no box to hit-test').toBeGreaterThan(0);
      expect(
        hit.onHeaderElsewhere,
        'a point inside the header (or, where the header is folded away, the h1) does not hit ' +
          'it, so this hit test proves nothing',
      ).toBe(true);
      expect(
        hit.onLink,
        'the focused skip link is not the topmost thing at its own centre. The header is ' +
          'painted over it — invisible to the only input method that uses it, while remaining ' +
          'perfectly focusable and therefore invisible to the accessibility audit too. ' +
          'theme.css keeps the header’s z-index below the link’s 10 for exactly this reason',
      ).toBe(true);
    });
  });
}

/**
 * The apparatus control for the chrome budget, and it is the one this file
 * would be worthless without.
 *
 * "How much of the viewport does the chrome still cover after scrolling" is
 * trivially inside any budget when the answer is **zero for the wrong reason**
 * — and that is exactly what this spec did on its first draft. The harness
 * extended the document with a spacer placed after `.oyl-shell`, so scrolling
 * carried the whole shell off the top; the header measured 0 px; and the
 * budget test passed *with `position: sticky` restored unconditionally*, which
 * is the precise defect it exists to catch.
 *
 * So this asserts the apparatus can see pinned chrome at all. At 1280×800 the
 * header is sticky by design, and after a long scroll it has to still be
 * covering part of the viewport. If it does not, every per-viewport budget
 * assertion above is passing over nothing and this is the test that says so.
 */
test.describe('the apparatus can see chrome that stays', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('a pinned header is still measured after the page has scrolled', async ({ page }) => {
    await openShell(page);
    await page.evaluate(() => {
      window.scrollTo(0, 2000);
    });
    await settled(page);

    const visible = await page.evaluate(() => {
      const header = document.querySelector('.oyl-header');
      if (header === null) throw new Error('no .oyl-header');
      const box = header.getBoundingClientRect();
      return Math.max(0, Math.min(box.bottom, window.innerHeight) - Math.max(box.top, 0));
    });

    expect(
      visible,
      'the header covers nothing after scrolling on a viewport where theme.css makes it ' +
        'sticky. Either the sticky rule is gone, or — the failure this test was written for — ' +
        'the harness has scrolled past the header’s own containing block, in which case every ' +
        'chrome-budget assertion in this file is vacuous. See shell-harness.tsx §SPACER_PIXELS',
    ).toBeGreaterThan(0);
  });
});

/**
 * The coupling `theme.css` claims between the two rules it puts in one block.
 *
 * `scroll-margin-top` is meaningless when the header is not sticky and wrong
 * when it is absent. Declaring them together is what stops one being edited
 * without the other, and this is what says the pairing still holds — read off
 * the browser at both ends of the query rather than out of the stylesheet.
 */
test.describe('the sticky header and its scroll margin are one decision', () => {
  test('both are off below the breakpoint and both are on above it', async ({ browser }) => {
    async function read(width: number, height: number): Promise<[string, string]> {
      const page = await browser.newPage({ viewport: { width, height } });
      await openShell(page);
      const measured = await page.evaluate(() => {
        const header = document.querySelector('.oyl-header');
        const main = document.querySelector('.oyl-main');
        if (header === null || main === null) throw new Error('no header or no main');
        return [getComputedStyle(header).position, getComputedStyle(main).scrollMarginTop] as [
          string,
          string,
        ];
      });
      await page.close();
      return measured;
    }

    const [smallPosition, smallMargin] = await read(375, 667);
    expect(smallPosition, 'the header sticks at a phone’s width, which #307’s review found').toBe(
      'static',
    );
    expect(
      smallMargin,
      'a scroll margin is reserved for a header that is not there, pushing the heading down for ' +
        'no reason',
    ).toBe('0px');

    const [largePosition, largeMargin] = await read(1280, 800);
    expect(
      largePosition,
      'the header no longer sticks anywhere, which leaves the scroll margin below guarding ' +
        'nothing — delete both or restore both',
    ).toBe('sticky');
    expect(
      Number.parseFloat(largeMargin),
      'the header sticks and nothing compensates the fragment jump for it',
    ).toBeGreaterThan(0);
  });
});

/**
 * A smaller header, and the band under the status bar — #671.
 *
 * ## What was wrong
 *
 * Since #427 put the navigation in a bar and a rail, the header held only the
 * wordmark, and it was still 72 px: on a phone a third header above the
 * section row and the `h1`, while the bar already said where you were. And
 * with the tablet's edge-to-edge insets the header began at y = 36 — `body` is
 * padded by the inset — so a band of canvas showed under the status bar while
 * the rail beside it painted to y = 0. Capacitor's status-bar colour does
 * nothing on Android 16, so the page has to paint that band itself.
 *
 * ## What is measured, and the control that makes it mean something
 *
 * At the three viewports #671 names and the two tablet ones #439 measured:
 * the header's height, read from the browser and published; and, with the
 * insets applied to the ENGINE (`insets.ts`) and read back, the pixel at
 * (50 %, 18) — the middle of a 36 px status bar — read off a screenshot and
 * required to be the header's surface token, at load and again after a long
 * scroll, when content has passed beneath it.
 *
 * ⚠️ **The control is the header as it was**, put back over the shipped
 * stylesheet by {@link BEFORE_671}: the same page must then FAIL both — a
 * header of at least 72 px and a pixel that is not the token. Without it a
 * pixel sampled from a page that never applied its insets, or a header that
 * never rendered, would pass as readily as a correct one.
 *
 * ## What this does NOT prove
 *
 * Anything on the owner's tablet. The insets are the ones read off it (#439),
 * and the upright ones are assumed; whether a real status bar shows the band
 * as the header's colour is a device check, written into the pull request.
 */
const HEADER_VIEWPORTS: readonly {
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly insets: Insets;
}[] = [
  { name: '320×256', width: 320, height: 256, insets: PIXEL_TABLET_LANDSCAPE_INSETS },
  { name: '390×844', width: 390, height: 844, insets: PIXEL_TABLET_LANDSCAPE_INSETS },
  { name: '844×390', width: 844, height: 390, insets: PIXEL_TABLET_LANDSCAPE_INSETS },
  {
    name: 'tablet 1280×800, insets 36/32',
    width: 1280,
    height: 800,
    insets: PIXEL_TABLET_LANDSCAPE_INSETS,
  },
  {
    name: 'tablet 800×1280, insets 36/32 (assumed)',
    width: 800,
    height: 1280,
    insets: PIXEL_TABLET_PORTRAIT_INSETS_ASSUMED,
  },
];

/** The wordmark bar #671 replaced, in CSS pixels, measured on `main` at 4b0ba28. */
const WORDMARK_BAR_PIXELS = 72;

/** Where the status bar's middle is: half the 36 px inset read off the tablet. */
const STATUS_BAR_ROW = 18;

/**
 * The header's rules as they were before #671, laid over the shipped
 * stylesheet — the control. The same declarations `theme.css` had at 4b0ba28,
 * plus the one thing that undoes the band: the pseudo-element's content.
 */
const BEFORE_671 = `
  .oyl-header { display: block !important; min-height: 0 !important;
    padding: var(--oyl-space-md) !important;
    border-bottom: 1px solid var(--oyl-color-border) !important; }
  .oyl-wordmark { position: static !important; width: auto !important; height: auto !important;
    margin: 0 0 var(--oyl-space-sm) !important; overflow: visible !important;
    clip-path: none !important; white-space: normal !important; }
  .oyl-header::before { content: none !important; }
`;

interface HeaderReading {
  readonly height: number;
  readonly top: number;
  readonly atLoad: string;
  readonly afterScroll: string;
  readonly headerTopAfterScroll: number;
}

async function readHeader(
  page: Page,
  viewport: (typeof HEADER_VIEWPORTS)[number],
  path: (name: string) => string,
  control: boolean,
): Promise<HeaderReading> {
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  await applyInsets(page, viewport.insets);
  await openShell(page);
  // The insets must be the ones the page resolved, or this measured nothing.
  expect(await resolvedInsets(page)).toEqual(viewport.insets);
  if (control) {
    await page.addStyleTag({ content: BEFORE_671 });
    await settled(page);
  }
  const box = await page.evaluate(() => {
    const header = document.querySelector('.oyl-header');
    if (header === null) throw new Error('no .oyl-header');
    const measured = header.getBoundingClientRect();
    return { height: measured.height, top: measured.top };
  });
  const pixel = async (name: string): Promise<string> => {
    const file = path(name);
    await page.screenshot({
      path: file,
      clip: { x: Math.floor(viewport.width / 2), y: STATUS_BAR_ROW, width: 1, height: 1 },
    });
    const png = decodePng(file);
    return `#${[0, 1, 2]
      .map((channel) => (png.data[channel] ?? 0).toString(16).padStart(2, '0'))
      .join('')}`;
  };
  const atLoad = await pixel('at-load.png');
  await page.evaluate(() => {
    window.scrollTo(0, 2000);
  });
  await settled(page);
  expect(await page.evaluate(() => window.scrollY), 'the page did not scroll').toBeGreaterThan(0);
  const scrolled = await pixel('after-scroll.png');
  // A POSITIONED element scrolled under the band — a pane, a map, anything
  // with `position: relative` — paints above an unpositioned one in document
  // order, and so above a band with no `z-index` of its own. The same pixel is
  // read again with everything in `main` positioned and opaque, which changes
  // no box: the harness's spacer is transparent, and a band beneath a
  // transparent box reads as a band above it.
  await page.addStyleTag({
    content: '.oyl-main * { position: relative; background: var(--oyl-color-canvas); }',
  });
  await settled(page);
  const positioned = await pixel('after-scroll-positioned.png');
  const afterScroll = scrolled === positioned ? scrolled : `${scrolled} / ${positioned} positioned`;
  const headerTopAfterScroll = await page.evaluate(
    () => document.querySelector('.oyl-header')?.getBoundingClientRect().top ?? Number.NaN,
  );
  return { ...box, atLoad, afterScroll, headerTopAfterScroll };
}

for (const viewport of HEADER_VIEWPORTS) {
  test.describe(`#671 — the header at ${viewport.name}`, () => {
    test('is under 72 px, and the status bar’s band is the header’s surface', async ({
      page,
    }, info) => {
      const read = await readHeader(page, viewport, (name) => info.outputPath(name), false);
      const published =
        `header ${read.height.toFixed(1)} px at y=${read.top.toFixed(0)}; ` +
        `(50 %, ${String(STATUS_BAR_ROW)}) ${read.atLoad} at load, ${read.afterScroll} scrolled`;
      console.log(`#671 ${viewport.name}: ${published}`);
      info.annotations.push({ type: 'header', description: published });

      expect(
        read.height,
        `the header is ${read.height.toFixed(1)} px — the wordmark bar #671 folded was ` +
          `${String(WORDMARK_BAR_PIXELS)} px`,
      ).toBeLessThan(WORDMARK_BAR_PIXELS);
      if (viewport.width < 600) {
        expect(read.height, 'below the rail breakpoint the wordmark bar is folded away').toBe(0);
      }
      expect(
        read.atLoad,
        'the band under the status bar is not the header’s surface — a strip of canvas where ' +
          'the tablet showed one (theme.css §`.oyl-header::before`)',
      ).toBe(COLOUR_TOKENS.surfaceOverlay);
      expect(
        read.afterScroll,
        'content scrolled up into the status bar’s band instead of passing beneath it',
      ).toBe(COLOUR_TOKENS.surfaceOverlay);
      if (read.height > 0 && viewport.width >= 1024 && viewport.height >= 640) {
        // Where it sticks, it sticks under the band rather than behind it.
        expect(read.headerTopAfterScroll, 'the sticky header is under the status bar').toBe(
          viewport.insets.top,
        );
      }
    });

    test('the control — the header as it was fails both', async ({ page }, info) => {
      const read = await readHeader(page, viewport, (name) => info.outputPath(name), true);
      console.log(
        `#671 control ${viewport.name}: header ${read.height.toFixed(1)} px, ` +
          `(50 %, ${String(STATUS_BAR_ROW)}) ${read.atLoad}`,
      );
      expect(
        read.height,
        'the old header measures under 72 px, so the height assertion cannot fail',
      ).toBeGreaterThanOrEqual(WORDMARK_BAR_PIXELS);
      expect(
        read.atLoad,
        'the band is the header’s colour without the rule that paints it, so the pixel ' +
          'assertion cannot fail',
      ).toBe(COLOUR_TOKENS.canvas);
    });
  });
}

test.describe('#671 — the app’s name on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('is off the screen and still the banner’s name, and the h1 is the first heading', async ({
    page,
  }) => {
    await openShell(page);
    await expect(page.getByRole('banner', { name: 'On Your Left' })).toHaveCount(1);
    await expect(page).toHaveTitle(/ — On Your Left$/);
    const state = await page.evaluate(() => {
      const wordmark = document.querySelector('.oyl-wordmark');
      const first = document.querySelector('h1, h2, h3, h4, h5, h6, [role="heading"]');
      if (wordmark === null) throw new Error('no wordmark');
      const box = wordmark.getBoundingClientRect();
      return { area: box.width * box.height, first: first?.tagName ?? null };
    });
    expect(state.area, 'the wordmark is still drawn on a phone').toBeLessThanOrEqual(1);
    expect(state.first).toBe('H1');
  });
});

/**
 * The skip link, and the jump it makes, clear the status bar — #726.
 *
 * `.oyl-skip-link` has no positioned ancestor, so it is placed against the
 * initial containing block rather than below `body`'s safe-area padding: with
 * the tablet's 36 px top inset the focused link sat at y = 8, its top 28 px
 * under the status bar. And where the header does not stick, the jump itself
 * scrolled `main` to y = 0, leaving the `h1` 24 px down and its top 12 px
 * under the bar. In this Chromium #671's band is drawn beneath the link, so
 * the existing hit-test passes either way; on a device the OS status bar is
 * drawn over the WebView, which only a measurement against the inset can see.
 *
 * Measured at #671's viewports with the #439 insets applied to the engine and
 * read back. The control is the two rules as they were, and must fail: the
 * link's top under the inset everywhere, and the `h1` under the band wherever
 * the header does not stick (where it sticks, 7rem still clamps the jump).
 */
const BEFORE_726 = `
  .oyl-skip-link { top: var(--oyl-space-sm) !important; }
  @media not ((min-width: 64rem) and (min-height: 40rem)) {
    .oyl-main { scroll-margin-top: 0 !important; }
  }
`;

interface SkipReading {
  readonly linkTop: number;
  readonly headingTop: number;
  readonly ceiling: number;
  readonly scrollY: number;
  readonly sticks: boolean;
}

async function readSkip(
  page: Page,
  viewport: (typeof HEADER_VIEWPORTS)[number],
  control: boolean,
): Promise<SkipReading> {
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  await applyInsets(page, viewport.insets);
  await openShell(page);
  expect(await resolvedInsets(page)).toEqual(viewport.insets);
  if (control) {
    await page.addStyleTag({ content: BEFORE_726 });
    await settled(page);
  }
  await page.keyboard.press('Tab');
  await expect(page.locator('.oyl-skip-link')).toBeFocused();
  await settled(page);
  const linkTop = await page.evaluate(
    () => document.querySelector('.oyl-skip-link')?.getBoundingClientRect().top ?? Number.NaN,
  );
  await page.locator('.oyl-skip-link').press('Enter');
  await expect(page.locator('main')).toBeFocused();
  await settled(page);
  const landed = await page.evaluate(() => {
    const header = document.querySelector('.oyl-header');
    const heading = document.querySelector('h1');
    if (header === null || heading === null) throw new Error('no header or no h1');
    const headerBox = header.getBoundingClientRect();
    return {
      headingTop: heading.getBoundingClientRect().top,
      // The header's bottom where it is on screen, and 0 where it has gone.
      headerBottom: Math.max(0, headerBox.bottom),
      scrollY: window.scrollY,
      sticks: getComputedStyle(header).position === 'sticky',
    };
  });
  return {
    linkTop,
    headingTop: landed.headingTop,
    ceiling: Math.max(viewport.insets.top, landed.headerBottom),
    scrollY: landed.scrollY,
    sticks: landed.sticks,
  };
}

for (const viewport of HEADER_VIEWPORTS) {
  test.describe(`#726 — the skip link at ${viewport.name}`, () => {
    test('is below the status bar, and lands the h1 below it', async ({ page }, info) => {
      const read = await readSkip(page, viewport, false);
      const published =
        `link top ${read.linkTop.toFixed(0)} against an inset of ${String(viewport.insets.top)}; ` +
        `h1 at ${read.headingTop.toFixed(0)}, ${(read.headingTop - read.ceiling).toFixed(0)} px ` +
        `clear of the chrome, scrollY ${String(read.scrollY)}`;
      console.log(`#726 ${viewport.name}: ${published}`);
      info.annotations.push({ type: 'skip link', description: published });
      expect(
        read.linkTop,
        'the focused skip link starts under the status bar (theme.css §`.oyl-skip-link`)',
      ).toBeGreaterThanOrEqual(viewport.insets.top);
      expect(
        read.headingTop - read.ceiling,
        'the h1 a rider skipped to is under the status bar or the header ' +
          '(theme.css §`.oyl-main` scroll-margin-top)',
      ).toBeGreaterThanOrEqual(MINIMUM_HEADING_CLEARANCE);
    });

    test('the control — the rules as they were fail', async ({ page }) => {
      const read = await readSkip(page, viewport, true);
      console.log(
        `#726 control ${viewport.name}: link top ${read.linkTop.toFixed(0)}, h1 ` +
          `${(read.headingTop - read.ceiling).toFixed(0)} px clear, scrollY ${String(read.scrollY)}`,
      );
      expect(
        read.linkTop,
        'the old skip link clears the inset, so the link assertion cannot fail',
      ).toBeLessThan(viewport.insets.top);
      if (!read.sticks) {
        expect(
          read.headingTop - read.ceiling,
          'the jump clears the status bar with no scroll margin, so the h1 assertion cannot fail',
        ).toBeLessThan(MINIMUM_HEADING_CLEARANCE);
      }
    });
  });
}

/**
 * The touch target — #316.
 *
 * ## What was wrong
 *
 * `.oyl-button` declared no minimum size at all. Its height was the sum of
 * three tokens nobody thinks of as belonging to a button — `--oyl-space-sm`
 * twice, `--oyl-font-size-md` at `body`'s `line-height: 1.55`, and two 2 px
 * borders — which came to **44.8 px**. It cleared 44 by 0.8 px, by coincidence,
 * and each of those three drops it under on its own. #307 had already moved the
 * type scale under this control in the week the number was measured.
 *
 * `select` had been given an explicit `min-height: 2.75rem` by #307 (PR #311) with a
 * comment explaining the value. The button beside it got nothing — so the
 * repository had already decided the number mattered, on the control that
 * matters less.
 *
 * ## ⚠️ The citation
 *
 * 44×44 is **SC 2.5.5 (Target Size (Enhanced), AAA)**. SC 2.5.8 (Target Size
 * (Minimum), AA) is **24×24** — a different criterion with a different number,
 * and `theme.css` records that an earlier comment of its own confused the two.
 * This product is used on a handlebar, in gloves, in the rain; clearing the AA
 * minimum easily is not the same as being usable there, and 44 is chosen for
 * that reason rather than read off a conformance table.
 *
 * ## Why here and not in the fast suite
 *
 * jsdom performs no layout and resolves no custom property (CLAUDE.md §4e), so
 * nothing in `pnpm run test` can measure a button. `theme.a11y.test.ts` reads
 * the stylesheet as a file: it can see a declaration, never what the
 * declaration does — which is the same blindness that let #307 ship a header
 * covering 70 % of a 320×256 viewport.
 *
 * ## Three assertions, and they fail for three different reasons
 *
 * - **the shipped box** is what a rider's thumb actually lands on, and it is
 *   per-viewport because a wrapped label and a narrow container are layout,
 *   not arithmetic.
 * - **the declaration** is what stops the target being emergent again. ⚠️ On
 *   its own it is weak: with the tokens as they are, deleting `min-height`
 *   leaves the box at 44.8 px and the assertion above still passes.
 * - **the tokens on their own** is the one that goes red for the arithmetic.
 *   A floor absorbs what it stands on: once `min-height` is declared, the
 *   padding can halve and the button stays 44 px while every other control
 *   built from the same tokens starts below the target, with nothing anywhere
 *   saying so. This measures the button with its floor taken away, which is
 *   the number the issue's table is about.
 */

/**
 * The smallest a control a rider touches may be, in CSS px, in both axes.
 *
 * WCAG 2.2 **SC 2.5.5 (Target Size (Enhanced), AAA)**. ⚠️ Not SC 2.5.8, which
 * is the AA criterion and is 24×24 — see this block's header.
 */
const TOUCH_TARGET_PIXELS = 44;

/** Where `shell-harness.tsx` puts the specimens, and how many it renders. */
const SPECIMEN_SELECTOR = '[data-oyl-touch-target] .oyl-button';
const SPECIMEN_COUNT = 5;

interface SpecimenBox {
  readonly label: string;
  readonly secondary: boolean;
  readonly height: number;
  readonly width: number;
  readonly borderTop: string;
}

async function specimenBoxes(page: Page): Promise<readonly SpecimenBox[]> {
  return page.evaluate((selector) => {
    return [...document.querySelectorAll(selector)].map((element) => {
      const box = element.getBoundingClientRect();
      return {
        label: (element.textContent ?? '').trim(),
        secondary: element.classList.contains('oyl-button--secondary'),
        height: box.height,
        width: box.width,
        // The apparatus control: `.oyl-button` is the only rule in the
        // stylesheet that gives a button a 2px border, so a specimen reporting
        // anything else is a specimen `theme.css` never reached — and every
        // number beside it is then about an unstyled `<button>`.
        borderTop: getComputedStyle(element).borderTopWidth,
      };
    });
  }, SPECIMEN_SELECTOR);
}

for (const viewport of VIEWPORTS) {
  test.describe(`${viewport.name} — the touch target`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test('every mid-ride control is at least a 44×44 target as Chromium lays it out', async ({
      page,
    }) => {
      await openShell(page);
      const boxes = await specimenBoxes(page);

      // ⚠️ The control that matters most here. Handed no ports, every one of
      // the shell's eleven routes renders a StatusMessage instead of a
      // control — measured: zero buttons, zero inputs, zero selects on all of
      // them. A `querySelectorAll` that found nothing is an empty list, and
      // every `for` loop below it passes cheerfully. See
      // `shell-harness.tsx` §TouchTargets.
      expect(
        boxes.length,
        `found ${String(boxes.length)} specimens at ${SPECIMEN_SELECTOR}, not ${String(
          SPECIMEN_COUNT,
        )}. Every assertion below iterates them, so a missing specimen is a silent pass — see ` +
          'shell-harness.tsx §TouchTargets',
      ).toBe(SPECIMEN_COUNT);

      // #316's fifth criterion: both variants, because a rider mid-ride
      // presses Pause and Stop, which are `oyl-button--secondary`.
      expect(
        boxes.filter((box) => box.secondary).length,
        'no secondary specimen, so oyl-button--secondary is unmeasured',
      ).toBeGreaterThan(0);
      expect(boxes.filter((box) => !box.secondary).length, 'no primary specimen').toBeGreaterThan(
        0,
      );

      for (const box of boxes) {
        expect(
          box.borderTop,
          `“${box.label}” has no 2px border, so theme.css did not style it and its size is a ` +
            'measurement of an unstyled button',
        ).toBe('2px');
      }

      for (const box of boxes) {
        expect(
          box.height,
          `“${box.label}” is ${box.height.toFixed(1)}px tall. WCAG 2.2 SC 2.5.5 asks for ` +
            `${String(TOUCH_TARGET_PIXELS)}px, and this control is tapped by a rider in gloves ` +
            'on a moving bike',
        ).toBeGreaterThanOrEqual(TOUCH_TARGET_PIXELS);
        expect(
          box.width,
          `“${box.label}” is ${box.width.toFixed(1)}px wide. A target is two-dimensional`,
        ).toBeGreaterThanOrEqual(TOUCH_TARGET_PIXELS);
      }
    });
  });
}

test.describe('the touch target is declared rather than emergent', () => {
  // One viewport. Nothing in `theme.css` puts `.oyl-button`'s minimum behind a
  // media query, and the per-viewport block above is what would catch it if
  // somebody did: it measures the box a rider touches at all five.
  test.use({ viewport: { width: 1280, height: 800 } });

  test('the minimum is a declaration on .oyl-button, in both axes', async ({ page }) => {
    await openShell(page);

    const declared = await page.evaluate((selector) => {
      return [...document.querySelectorAll(selector)].map((element) => {
        const style = getComputedStyle(element);
        return {
          label: (element.textContent ?? '').trim(),
          // Computed rather than specified, so this is in CSS px and a `rem`
          // whose root moved is caught as well as a value that was edited.
          minHeight: Number.parseFloat(style.minHeight),
          minWidth: Number.parseFloat(style.minWidth),
        };
      });
    }, SPECIMEN_SELECTOR);

    expect(declared.length, 'no specimens to read a declaration from').toBe(SPECIMEN_COUNT);

    for (const control of declared) {
      expect(
        control.minHeight,
        `“${control.label}” declares min-height ${String(control.minHeight)}px. Before #316 it ` +
          'declared none at all and stood 0.8px clear of the target by arithmetic nobody owned',
      ).toBeGreaterThanOrEqual(TOUCH_TARGET_PIXELS);
      expect(
        control.minWidth,
        `“${control.label}” declares min-width ${String(control.minWidth)}px. Asserting a width ` +
          'that only the label produces would re-create the emergent guarantee in the other axis',
      ).toBeGreaterThanOrEqual(TOUCH_TARGET_PIXELS);
    }
  });

  /*
   * ⚠️ This is the assertion #316 is actually about, and the one that goes red
   * for each of the three token changes.
   *
   * The declaration above holds the button at 44px whatever the tokens do —
   * which fixes the button and hides the tokens. Drop `--oyl-space-sm` to
   * 0.25rem and the button still measures 44px while the arithmetic behind it
   * has fallen to 36.8px; the next control written from the same spacing scale
   * starts under the target and no gate anywhere says so.
   *
   * So the floor is taken away and the button is measured again. When this
   * fires, the repair is not to widen the tolerance: it is to decide, in the
   * open, either that the token moves back or that this control now leans on
   * its floor — and to write which down here.
   *
   * Measured in the lockfile-pinned Chromium on this branch: 44.8px, from
   * 16px of padding, 24.8px of line box and 4px of border.
   */
  test('the tokens the button is built from still reach the target on their own', async ({
    page,
  }) => {
    await openShell(page);

    const intrinsic = await page.evaluate((selector) => {
      return [...document.querySelectorAll(selector)].map((element) => {
        const styled = element as HTMLElement;
        const before = styled.style.cssText;
        styled.style.minHeight = '0px';
        styled.style.minWidth = '0px';
        const style = getComputedStyle(styled);
        const box = styled.getBoundingClientRect();
        const measured = {
          label: (styled.textContent ?? '').trim(),
          height: box.height,
          // Whether the floor was really taken off. Without this the numbers
          // below could be the floored ones and the whole test would be the
          // one above again, wearing a different name.
          neutralised: style.minHeight,
          // The line box, the padding and the borders — the three terms of the
          // arithmetic, read back so the failure shows its working.
          lineHeight: Number.parseFloat(style.lineHeight),
          padding: Number.parseFloat(style.paddingTop) + Number.parseFloat(style.paddingBottom),
          border:
            Number.parseFloat(style.borderTopWidth) + Number.parseFloat(style.borderBottomWidth),
        };
        styled.style.cssText = before;
        return measured;
      });
    }, SPECIMEN_SELECTOR);

    expect(intrinsic.length, 'no specimens to strip a floor from').toBe(SPECIMEN_COUNT);

    for (const control of intrinsic) {
      expect(
        control.neutralised,
        `“${control.label}” still reports a min-height of ${control.neutralised} after it was ` +
          'stripped, so this test is measuring the floor and not the arithmetic under it',
      ).toBe('0px');

      // The second apparatus control: a label that wrapped to two lines is
      // tall for a reason that has nothing to do with the tokens, and it would
      // sail over 44px with the padding halved. Every label here is one word
      // or a short phrase and none of them wraps at 1280px; this says so
      // rather than assuming it.
      expect(
        control.height - control.padding - control.border,
        `“${control.label}” wraps to more than one line, so its height is not the arithmetic ` +
          'this test is about',
      ).toBeLessThan(control.lineHeight * 2);

      expect(
        control.height,
        `“${control.label}” is ${control.height.toFixed(1)}px tall once min-height is taken ` +
          `away: ${control.padding.toFixed(1)}px of padding (--oyl-space-sm), ` +
          `${control.lineHeight.toFixed(1)}px of line box (--oyl-font-size-md at body's ` +
          `line-height) and ${control.border.toFixed(1)}px of border. That is under ` +
          `${String(TOUCH_TARGET_PIXELS)}px, so min-height is now the only thing holding this ` +
          'control at the target and every other control built from the same tokens is below ' +
          'it. Move the token back, or decide here that this button leans on its floor',
      ).toBeGreaterThanOrEqual(TOUCH_TARGET_PIXELS);
    }
  });
});

/**
 * A link drawn as a button — #566's review.
 *
 * The Camera screen's "Use this phone as the side camera" is an `<a
 * class="oyl-button">` inside a sentence in a list item. An `<a>` is inline,
 * and `min-height`/`min-width` do not apply to a non-replaced inline box, whose
 * vertical padding takes no line space either: it looked like a button, stood
 * short of the target, and painted over the lines around it. `theme.css`
 * §`a.oyl-button` makes it the inline-block a `<button>` already is.
 *
 * This measures the REAL `CameraView` in the shipping shell (the harness's
 * `?pairing=on`, which is what makes the way in render), at the SC 1.4.10
 * viewport, a phone and a landscape tablet, and it carries its control: the
 * same link with `display: inline` put back must fail one of the two claims,
 * or a green run says nothing about the declaration.
 */
const LINK_VIEWPORTS = [
  { name: '320×256', width: 320, height: 256 },
  { name: '375×667 — a phone', width: 375, height: 667 },
  { name: '1280×800 — a landscape tablet', width: 1280, height: 800 },
] as const;

const SIDE_CAMERA_LINK = 'a.oyl-button[href="#/camera/side"]';

interface LinkTarget {
  readonly found: boolean;
  readonly height: number;
  readonly width: number;
  /** Whether the whole link lies inside its own list item — takes line space. */
  readonly inItsLine: boolean;
  /** Whether it stays clear of the next step's list item. */
  readonly clearOfNext: boolean;
}

async function sideCameraLink(page: Page, stripped: boolean): Promise<LinkTarget> {
  return page.evaluate(
    ({ selector, strip }) => {
      const link = document.querySelector<HTMLElement>(selector);
      const item = link?.closest('li');
      if (link === null || item === null || item === undefined) {
        return { found: false, height: 0, width: 0, inItsLine: false, clearOfNext: false };
      }
      const before = link.style.cssText;
      if (strip) {
        link.style.display = 'inline';
      }
      const box = link.getBoundingClientRect();
      const line = item.getBoundingClientRect();
      const next = item.nextElementSibling?.getBoundingClientRect();
      const measured = {
        found: true,
        height: box.height,
        width: box.width,
        inItsLine: box.top >= line.top - 0.5 && box.bottom <= line.bottom + 0.5,
        clearOfNext: next === undefined || box.bottom <= next.top + 0.5,
      };
      link.style.cssText = before;
      return measured;
    },
    { selector: SIDE_CAMERA_LINK, strip: stripped },
  );
}

for (const viewport of LINK_VIEWPORTS) {
  test.describe(`${viewport.name} — a link drawn as a button`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test('the side camera’s way in is a 44×44 target that takes its own line space', async ({
      page,
    }) => {
      await page.goto('/shell.html?pairing=on#/camera');
      await page.waitForSelector('html[data-oyl-shell-ready]');
      await page.waitForSelector(SIDE_CAMERA_LINK);

      const shipped = await sideCameraLink(page, false);
      expect(
        shipped.found,
        `no ${SIDE_CAMERA_LINK} inside a list item on #/camera, so there is nothing to measure — ` +
          'see shell-harness.tsx §PAIRING_ON',
      ).toBe(true);
      expect(
        shipped.height,
        `the link is ${shipped.height.toFixed(1)}px tall; SC 2.5.5 asks for ` +
          `${String(TOUCH_TARGET_PIXELS)}px`,
      ).toBeGreaterThanOrEqual(TOUCH_TARGET_PIXELS);
      expect(shipped.width).toBeGreaterThanOrEqual(TOUCH_TARGET_PIXELS);
      expect(
        shipped.inItsLine,
        'the link’s box spills out of its own list item, so it paints over the lines around it',
      ).toBe(true);
      expect(shipped.clearOfNext, 'the link overlaps the next step').toBe(true);

      // The control: the same link laid out inline, as it was before the fix,
      // must fail at least one of the claims above.
      const inline = await sideCameraLink(page, true);
      expect(inline.found).toBe(true);
      expect(
        inline.height < TOUCH_TARGET_PIXELS || !inline.inItsLine || !inline.clearOfNext,
        `laid out inline the link still measures ${inline.height.toFixed(1)}px and sits in its ` +
          'own line, so this test cannot tell the fix from its absence',
      ).toBe(true);
    });
  });
}

/**
 * #427 — the navigation is a BAR on a compact window and a RAIL on a wider
 * one, and every destination in it is a 44×44 target by the same three
 * measurements #316 made for `.oyl-button`.
 *
 * The three viewports #427 names: the SC 1.4.10 one, a phone, and a landscape
 * tablet — plus an upright tablet, which is the width the switch is for.
 */
const NAVIGATION_VIEWPORTS = [
  { name: '320×256', width: 320, height: 256, expect: 'row' },
  { name: '375×667 — a phone', width: 375, height: 667, expect: 'bar' },
  { name: '768×1024 — a tablet upright', width: 768, height: 1024, expect: 'rail' },
  { name: '1280×800 — a landscape tablet', width: 1280, height: 800, expect: 'rail' },
] as const;

/** How many primary destinations #427 allows at most. */
const MOST_DESTINATIONS = 5;

interface NavLinkBox {
  readonly label: string;
  readonly width: number;
  readonly height: number;
  readonly minWidth: number;
  readonly minHeight: number;
  readonly current: string | null;
  readonly iconBackground: string;
}

async function navLinks(page: Page): Promise<readonly NavLinkBox[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll('nav[aria-label="Primary"] a')].map((link) => {
      const box = link.getBoundingClientRect();
      const style = getComputedStyle(link);
      const icon = link.querySelector('svg');
      return {
        label: (link.textContent ?? '').trim(),
        width: box.width,
        height: box.height,
        minWidth: Number.parseFloat(style.minWidth),
        minHeight: Number.parseFloat(style.minHeight),
        current: link.getAttribute('aria-current'),
        iconBackground: icon === null ? '' : getComputedStyle(icon).backgroundColor,
      };
    }),
  );
}

for (const viewport of NAVIGATION_VIEWPORTS) {
  test.describe(`#427 — the navigation at ${viewport.name}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test(`is a ${viewport.expect}`, async ({ page }) => {
      await openShell(page);
      const nav = await page.evaluate(() => {
        const element = document.querySelector('nav[aria-label="Primary"]');
        if (element === null) throw new Error('no Primary nav');
        const box = element.getBoundingClientRect();
        return {
          position: getComputedStyle(element).position,
          left: box.left,
          top: box.top,
          bottom: box.bottom,
          width: box.width,
          height: box.height,
          innerWidth: window.innerWidth,
          innerHeight: window.innerHeight,
        };
      });
      switch (viewport.expect) {
        case 'row':
          // Too short for a pinned bar inside the chrome budget: an ordinary
          // row that scrolls away with the header.
          expect(nav.position).toBe('static');
          break;
        case 'bar':
          expect(nav.position).toBe('fixed');
          expect(nav.bottom).toBeCloseTo(nav.innerHeight, 0);
          expect(nav.width).toBeCloseTo(nav.innerWidth, 0);
          expect(nav.height).toBeLessThan(nav.innerHeight / 5);
          break;
        case 'rail':
          expect(nav.position).toBe('fixed');
          expect(nav.left).toBe(0);
          expect(nav.top).toBe(0);
          expect(nav.height).toBeCloseTo(nav.innerHeight, 0);
          expect(nav.width).toBeLessThan(nav.innerWidth / 5);
          break;
      }
    });

    test('holds at most five destinations, each a 44×44 target as Chromium lays it out', async ({
      page,
    }) => {
      await openShell(page);
      const links = await navLinks(page);
      // The apparatus: an empty list passes every loop below.
      expect(links.length).toBeGreaterThan(2);
      expect(links.length).toBeLessThanOrEqual(MOST_DESTINATIONS);
      for (const link of links) {
        expect(
          link.height,
          `“${link.label}” is ${link.height.toFixed(1)}px tall`,
        ).toBeGreaterThanOrEqual(TOUCH_TARGET_PIXELS);
        expect(
          link.width,
          `“${link.label}” is ${link.width.toFixed(1)}px wide`,
        ).toBeGreaterThanOrEqual(TOUCH_TARGET_PIXELS);
      }
    });

    test('marks where you are with a shape, not only a colour', async ({ page }) => {
      await openShell(page);
      const links = await navLinks(page);
      const current = links.filter((link) => link.current !== null);
      const others = links.filter((link) => link.current === null);
      expect(current).toHaveLength(1);
      // A filled pill behind the current icon, where the others have none.
      expect(current[0]?.iconBackground).not.toBe('rgba(0, 0, 0, 0)');
      for (const link of others) {
        expect(link.iconBackground).toBe('rgba(0, 0, 0, 0)');
      }
    });
  });
}

test.describe('#427 — a navigation target is declared rather than emergent', () => {
  test.use({ viewport: { width: 375, height: 667 } });

  test('the minimum is a declaration, in both axes', async ({ page }) => {
    await openShell(page);
    const links = await navLinks(page);
    expect(links.length).toBeGreaterThan(2);
    for (const link of links) {
      expect(link.minHeight, `“${link.label}” declares no 44px min-height`).toBeGreaterThanOrEqual(
        TOUCH_TARGET_PIXELS,
      );
      expect(link.minWidth, `“${link.label}” declares no 44px min-width`).toBeGreaterThanOrEqual(
        TOUCH_TARGET_PIXELS,
      );
    }
  });

  test('the icon, the label and the padding reach the target on their own', async ({ page }) => {
    // #316's third measurement: strip the floor and measure again, so the
    // declaration above cannot hide a token that moved under it.
    await openShell(page);
    const stripped = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('nav[aria-label="Primary"] a')].map((link) => {
        const before = link.style.cssText;
        link.style.minHeight = '0px';
        link.style.minWidth = '0px';
        const box = link.getBoundingClientRect();
        const measured = {
          label: (link.textContent ?? '').trim(),
          height: box.height,
          width: box.width,
          neutralised: getComputedStyle(link).minHeight,
        };
        link.style.cssText = before;
        return measured;
      }),
    );
    expect(stripped.length).toBeGreaterThan(2);
    for (const link of stripped) {
      expect(link.neutralised).toBe('0px');
      expect(
        link.height,
        `“${link.label}” is ${link.height.toFixed(1)}px tall unfloored`,
      ).toBeGreaterThanOrEqual(TOUCH_TARGET_PIXELS);
      expect(
        link.width,
        `“${link.label}” is ${link.width.toFixed(1)}px wide unfloored`,
      ).toBeGreaterThanOrEqual(TOUCH_TARGET_PIXELS);
    }
  });
});

/**
 * #397 — the announcement controls on Settings clear WCAG 2.2 SC 2.5.8's
 * 24×24 CSS px (Level AA). ⚠️ Not 44: that is SC 2.5.5 (AAA), and CLAUDE.md
 * §4f records this repository getting the two the wrong way round once.
 */
const MINIMUM_TARGET_PIXELS = 24;

test.describe('#397 — the announcement controls', () => {
  test.use({ viewport: { width: 375, height: 667 } });

  async function controls(page: Page) {
    return page.evaluate(() =>
      [...document.querySelectorAll('.oyl-announce input, .oyl-announce select')].map((each) => {
        const box = each.getBoundingClientRect();
        return { name: each.tagName, width: box.width, height: box.height };
      }),
    );
  }

  test('every control is at least 24×24', async ({ page }) => {
    await page.goto('/shell.html#/settings');
    await page.waitForSelector('html[data-oyl-shell-ready]');
    const seen = await controls(page);
    // Eight since #475, and every one is measured below: the announcements'
    // switch and four rows (power, distance, next block, and #399's climb
    // ahead), #400's Sounds panel — which carries the same class so its switch
    // and its volume slider are held to the same floor — and #475's Game world
    // switch, which carries it for the same reason and shipped without it.
    expect(seen.length).toBe(8);
    for (const control of seen) {
      expect(control.width, control.name).toBeGreaterThanOrEqual(MINIMUM_TARGET_PIXELS);
      expect(control.height, control.name).toBeGreaterThanOrEqual(MINIMUM_TARGET_PIXELS);
    }
  });

  test('the control — without the declared size the switch is under 24', async ({ page }) => {
    await page.goto('/shell.html#/settings');
    await page.waitForSelector('html[data-oyl-shell-ready]');
    await page.evaluate(() => {
      const box = document.querySelector<HTMLInputElement>('.oyl-announce input');
      if (box !== null) {
        box.style.width = 'auto';
        box.style.height = 'auto';
      }
    });
    const seen = await controls(page);
    const input = seen.find((each) => each.name === 'INPUT');
    expect(input?.height ?? Infinity).toBeLessThan(MINIMUM_TARGET_PIXELS);
  });
});

/**
 * The live-camera indicator — #382,
 * [ADR 0029](../../../docs/adr/0029-camera-imagery-as-a-data-class.md) D-5.
 *
 * ## What is being decided, because #382 asks for it to be decided
 *
 * *"Cannot be hidden by a scrolled page or an overlay"* is not a property a
 * `z-index` has. Any element can be drawn over any other by something with a
 * higher stacking order, and `camera/indicator.tsx` says so in terms. What can
 * be claimed, and is claimed here, is three things:
 *
 * 1. **Scrolling cannot move it.** The page is 4000 px tall — that is
 *    {@link SPACER_PIXELS} in the harness — and the indicator's box is read
 *    before and after scrolling to the bottom.
 * 2. **Nothing this product draws covers it.** The harness lays a full-viewport
 *    element at `z-index: 20` over the page, which is the ride stage's own
 *    value and the highest this stylesheet declares — and the ride is exactly
 *    when a camera is most likely to be running. The indicator must still be
 *    the element `elementFromPoint` returns at its own centre.
 * 3. **It is on screen at every viewport measured**, including the 320×256 one
 *    WCAG 2.2 SC 1.4.10 names, where the chrome has least room.
 *
 * ⚠️ **The hit test is the assertion `indicator-style.test.ts` cannot make.**
 * That suite reads the stylesheet and proves no other rule declares a higher
 * number; it cannot see that an ancestor's `transform`, `filter` or `opacity`
 * creates a stacking context and traps a child's `z-index` inside it, however
 * large the number is. Only a real engine knows.
 *
 * ⚠️ **The control is `?camera=live` being absent.** Every other case on this
 * page loads `/shell.html` with no query string and the indicator is not
 * rendered at all — so the last case here asserts the absence, and without it
 * every assertion above would be equally true of a harness that had quietly
 * stopped switching the camera on.
 */
test.describe('the live camera indicator', () => {
  /** The product's own maximum stacking order, and the overlay's. @see shell-harness */
  const OVERLAY_STACKING = 20;

  async function openWithCamera(page: Page): Promise<void> {
    await page.goto('/shell.html?camera=live');
    await page.waitForSelector('html[data-oyl-shell-ready]');
    await page.waitForSelector('[data-oyl-camera-indicator]');
  }

  test('is rendered, on screen, at the viewport WCAG 2.2 names', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 256 });
    await openWithCamera(page);
    const box = await page.locator('[data-oyl-camera-indicator]').boundingBox();
    expect(box, 'the indicator has no box at all').not.toBeNull();
    expect(box?.y ?? -1).toBeGreaterThanOrEqual(0);
    expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(256);
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(320);
  });

  test('a scrolled page cannot carry it off the screen', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openWithCamera(page);
    const before = await page.locator('[data-oyl-camera-indicator]').boundingBox();

    await page.evaluate(() => {
      globalThis.scrollTo(0, document.documentElement.scrollHeight);
    });
    await settled(page);

    // The control on the control: a page that could not scroll would make the
    // comparison below trivially true, which is exactly what `SPACER_PIXELS`
    // in the harness exists to prevent and what the header's own measurement
    // got wrong first time.
    expect(await page.evaluate(() => globalThis.scrollY)).toBeGreaterThan(100);

    const after = await page.locator('[data-oyl-camera-indicator]').boundingBox();
    expect(after?.y).toBeCloseTo(before?.y ?? -1, 0);
    expect(after?.x).toBeCloseTo(before?.x ?? -1, 0);
  });

  test('nothing this product draws covers it', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openWithCamera(page);

    const hit = await page.evaluate(() => {
      const region = document.querySelector('[data-oyl-camera-indicator]');
      const overlay = document.querySelector('[data-oyl-overlay]');
      if (region === null || overlay === null) {
        return { found: false, topmost: '', overlayStacking: '' };
      }
      const box = region.getBoundingClientRect();
      const at = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
      return {
        found: true,
        // `closest` rather than the element itself: the point lands on the
        // text node's inline box, whose parent is the region.
        topmost:
          at?.closest('[data-oyl-camera-indicator]') === region ? 'indicator' : 'something else',
        overlayStacking: globalThis.getComputedStyle(overlay).zIndex,
      };
    });

    // The overlay is really there and really at the product's maximum: without
    // this the hit test would be over an empty page and would pass for a
    // reason unrelated to stacking.
    expect(hit.found, 'the harness rendered no overlay to be covered by').toBe(true);
    expect(Number(hit.overlayStacking)).toBe(OVERLAY_STACKING);
    expect(hit.topmost).toBe('indicator');
  });

  test('the control — with no camera running there is no indicator at all', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openShell(page);
    await expect(page.locator('[data-oyl-camera-indicator]')).toHaveCount(0);
  });
});

/**
 * The camera, in a real engine — #382, ADR 0029 D-9.
 *
 * ⚠️ **This is the only place in the repository where the re-encode from raw
 * pixels actually runs.** Everything above it — `frame.ts`'s refusal,
 * `browser-camera.test.ts`'s scripted devices, `session.test.ts`'s scripted
 * camera — is green against bytes a test author chose. The guarantee ADR 0029
 * D-9 rests on is one line in one adapter: the video track is drawn onto a
 * canvas and the **canvas** is asked for a JPEG, so the output is built from
 * pixels and has nowhere to put an Exif GPS IFD.
 *
 * Chromium is launched with `--use-fake-device-for-media-stream`
 * (`playwright.config.ts` §`LAUNCH_ARGS`), which supplies a synthetic camera —
 * a rolling colour pattern — so `getUserMedia` resolves on a runner with no
 * hardware.
 *
 * ⚠️ **What it does NOT prove.** Nothing about a phone's own camera, which is
 * the device that actually writes Exif — a synthetic stream has no metadata to
 * carry in the first place, so a green run here says the *pipeline* produces a
 * clean JPEG and not that a hostile source was cleaned. What defends the second
 * is the construction: a canvas holds pixels. `docs/validation/0002-…` Part S
 * is where somebody with a real phone records what the shipped path produced.
 */
test.describe('the camera, in a real engine', () => {
  test('a real getUserMedia, a real canvas encode, and no metadata in the result', async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['camera']);
    await page.goto('/shell.html');
    await page.waitForSelector('html[data-oyl-shell-ready]');

    const result = (await page.evaluate(async () =>
      (globalThis as unknown as { __oylCamera: () => Promise<unknown> }).__oylCamera(),
    )) as {
      opened: boolean;
      availability?: string;
      permission?: string;
      mediaType?: string;
      bytes?: number;
      width?: number;
      height?: number;
      soi?: number[];
    };

    expect(result.opened, 'the synthetic camera did not open').toBe(true);
    expect(result.permission).toBe('granted');
    // A real frame, not an empty buffer: the fake device is 640×480 by default
    // and a JPEG of it is thousands of bytes. A zero here would mean the
    // encode produced nothing and every assertion below would be about nothing.
    expect(result.width ?? 0).toBeGreaterThan(0);
    expect(result.height ?? 0).toBeGreaterThan(0);
    expect(result.bytes ?? 0).toBeGreaterThan(1000);
    // The browser really produced a JPEG — read from the bytes rather than from
    // the media type this client asked for. 0xFF 0xD8 is the SOI marker.
    expect(result.soi).toStrictEqual([0xff, 0xd8]);
    expect(result.mediaType).toBe('image/jpeg');
    // And `capturedFrame` accepted it, which is `frame.ts`'s refusal not
    // firing: a re-encode that had carried a marker through would have thrown
    // inside the harness and `opened` would be an unhandled rejection rather
    // than `true`.
  });
});

/**
 * The rider's own computer, in a real engine — #387.
 *
 * ⚠️ **The origin this client contacts, asserted where it is contacted.**
 * `map/basemap.ts` §`styleOrigins` and `map.browser.spec.ts` constrain which
 * hosts the MAP may reach; the analysis endpoint is not in the map's context
 * and neither needs to change for it (#387 checked: the map is built from
 * `basemapStyle`, which names no analysis address, and the analysis request is
 * issued by `camera/analysis-transport.ts`, which names no map). So this block
 * is the analysis's own version of #63's criterion 3 — every request the page
 * makes is recorded, and the only one leaving the harness origin must be the
 * one POST to the one address the rider typed.
 *
 * The endpoint is served by `page.route` rather than a process, because a
 * gate that needs a model server running fails on every runner. What the
 * route stands in for is the rider's machine; what is REAL is everything on
 * this side of it — the synthetic camera, the canvas encode, the controller,
 * the transport and Chromium's own `fetch`, CORS preflight included.
 *
 * ⚠️ **The control is `address === null`**: the same page and the same
 * controller with nothing configured, which must make no request at all.
 * Without it, "exactly one request, to the right place" could not be told from
 * a page that sent to every address it knew.
 */
test.describe('the rider’s own computer, in a real engine', () => {
  const ENDPOINT = 'http://127.0.0.1:4399';
  const COMPLETIONS = `${ENDPOINT}/v1/chat/completions`;

  async function probe(page: Page, address: string | null): Promise<Record<string, unknown>> {
    return (await page.evaluate(
      async (value) =>
        (
          globalThis as unknown as {
            __oylAnalysis: (address: string | null) => Promise<unknown>;
          }
        ).__oylAnalysis(value),
      address,
    )) as Record<string, unknown>;
  }

  test('sends one POST to the address the rider typed, and contacts nothing else', async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['camera']);
    const posted: { method: string; body: string | null; headers: Record<string, string> }[] = [];
    await page.route(`${ENDPOINT}/**`, async (route) => {
      const request = route.request();
      const cors = {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'POST, OPTIONS',
        'access-control-allow-headers': 'content-type',
      };
      if (request.method() === 'OPTIONS') {
        await route.fulfill({ status: 204, headers: cors });
        return;
      }
      posted.push({
        method: request.method(),
        body: request.postData(),
        headers: request.headers(),
      });
      await route.fulfill({
        status: 200,
        headers: { ...cors, 'content-type': 'application/json' },
        body: JSON.stringify({ choices: [{ message: { content: 'ready' } }] }),
      });
    });

    await page.goto('/shell.html');
    await page.waitForSelector('html[data-oyl-shell-ready]');
    const harnessOrigin = new URL(page.url()).origin;
    const elsewhere: string[] = [];
    page.on('request', (request) => {
      if (new URL(request.url()).origin !== harnessOrigin) {
        elsewhere.push(`${request.method()} ${request.url()}`);
      }
    });

    const result = await probe(page, ENDPOINT);
    expect(result['kind'], JSON.stringify(result)).toBe('described');
    expect(result['captured']).toBe(1);

    // Exactly one request left the harness origin, and it is the one.
    expect(elsewhere.filter((line) => !line.startsWith('OPTIONS '))).toStrictEqual([
      `POST ${COMPLETIONS}`,
    ]);
    expect(posted).toHaveLength(1);
    const sent = posted[0];
    expect(sent?.method).toBe('POST');
    // No cookie and no credential of the page's rode along.
    expect(sent?.headers['cookie']).toBeUndefined();
    expect(sent?.headers['authorization']).toBeUndefined();
    // No referrer: the rider's machine learns nothing about the page.
    expect(sent?.headers['referer']).toBeUndefined();

    // ADR 0029 D-7: the picture, a fixed prompt, and nothing else.
    const body = JSON.parse(sent?.body ?? '{}') as Record<string, unknown>;
    expect(Object.keys(body).sort()).toStrictEqual(['max_tokens', 'messages', 'model', 'stream']);
    const text = sent?.body ?? '';
    expect(text).not.toMatch(/latitude|longitude/);
    // The picture really is a JPEG the browser encoded: /9j/ is base64 for
    // FF D8 FF, the start of one. A real frame, not an empty string.
    const picture = /data:image\/jpeg;base64,([A-Za-z0-9+/=]+)/.exec(text)?.[1] ?? '';
    expect(picture.startsWith('/9j/')).toBe(true);
    expect(picture.length).toBeGreaterThan(1000);
  });

  test('the control — with nothing configured it makes no request at all', async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['camera']);
    await page.goto('/shell.html');
    await page.waitForSelector('html[data-oyl-shell-ready]');
    const harnessOrigin = new URL(page.url()).origin;
    const elsewhere: string[] = [];
    page.on('request', (request) => {
      if (new URL(request.url()).origin !== harnessOrigin) {
        elsewhere.push(`${request.method()} ${request.url()}`);
      }
    });

    const result = await probe(page, null);
    expect(result['failure'], JSON.stringify(result)).toBe('not-configured');
    // No picture was taken either: there was nowhere to send one.
    expect(result['captured']).toBe(0);
    expect(elsewhere).toStrictEqual([]);
  });

  test('refuses an address on the internet before anything is sent', async ({ page, context }) => {
    await context.grantPermissions(['camera']);
    await page.goto('/shell.html');
    await page.waitForSelector('html[data-oyl-shell-ready]');
    const harnessOrigin = new URL(page.url()).origin;
    const elsewhere: string[] = [];
    page.on('request', (request) => {
      if (new URL(request.url()).origin !== harnessOrigin) {
        elsewhere.push(`${request.method()} ${request.url()}`);
      }
    });

    const result = await probe(page, 'https://api.example.com');
    expect(result['failure'], JSON.stringify(result)).toBe('not-configured');
    expect(elsewhere).toStrictEqual([]);
  });
});

/**
 * #667 — the native controls, styled and still native.
 *
 * `shell-harness.tsx` §`NativeControls` renders them under
 * `?controls=specimens`, copied from the views that ship them, because a shell
 * handed no ports draws no form at all. `theme.a11y.test.ts` reads the
 * declarations; this is what they DO, read back from the pinned Chromium.
 *
 * ## The select, and its control
 *
 * `appearance: base-select` is opted into inside `@supports`, and this is the
 * first consumer of it in the repository. The positive cases open the picker
 * by keyboard and by click, measure every option at 44 px, read the role the
 * platform's own accessibility tree reports, and hold the picker's computed
 * colours to the tokens exactly. ⚠️ **The control is the same page with the
 * `@supports` block deleted from the shipping sheet** (`&base-select=off`):
 * there the closed skin is `appearance: none` and the option boxes are NOT 44
 * px — a platform popup lays nothing out in the page at all — so a green
 * positive run cannot be a measurement of something else.
 *
 * ## What was found building it, and is not a defect
 *
 * `Enter` on a CLOSED select does not open the picker, with or without
 * `base-select`: that is Chromium's keyboard model for a select (Space,
 * Alt+ArrowDown and a click open it), and keeping the platform's keyboard model
 * is the whole reason the owner allowed `base-select` rather than a listbox.
 * `Enter` on an option in an OPEN picker chooses it and closes the picker, and
 * that is asserted.
 *
 * ## What this does NOT prove
 *
 * Anything on a real phone or in the Android WebView — #667's tablet criterion
 * is a device check nobody running this gate can make. And the UNCHECKED box's
 * outline and a range's track are drawn by the platform in its own greys,
 * which `accent-color` does not reach and no token names.
 */
const CONTROLS_PAGE = '/shell.html?controls=specimens';
const CONTROLS_WITHOUT_BASE_SELECT = `${CONTROLS_PAGE}&base-select=off`;

/** The checkbox and radio rows the harness renders — two markups, four rows. */
const ROW_SELECTOR = '[data-oyl-native-row]';
const ROW_COUNT = 4;

/** A token, in a palette, as Chromium reports a computed colour. */
function rgbOf(token: ColourToken, theme: Theme = 'light'): string {
  const hex = paletteColours(theme)[token];
  const channel = (at: number): number => Number.parseInt(hex.slice(at, at + 2), 16);
  return `rgb(${String(channel(1))}, ${String(channel(3))}, ${String(channel(5))})`;
}

async function openControls(page: Page, url = CONTROLS_PAGE, theme?: Theme): Promise<void> {
  await page.goto(url);
  await page.waitForSelector('html[data-oyl-shell-ready]');
  if (theme !== undefined) {
    // #672: the palette under test is really the one painting.
    expect(await page.evaluate(() => document.documentElement.dataset['theme'])).toBe(theme);
  }
  expect(
    await page.locator('[data-oyl-native-control]').count(),
    'the native control specimens did not render — see shell-harness.tsx §NativeControls',
  ).toBe(8);
}

interface RowBox {
  readonly markup: string;
  readonly height: number;
  readonly width: number;
  readonly minHeight: string;
  /** The checkbox or radio inside or beside the row, as laid out. */
  readonly control: { readonly width: number; readonly height: number };
}

async function rowBoxes(page: Page, stripped: boolean): Promise<readonly RowBox[]> {
  return page.evaluate(
    ({ selector, strip }) =>
      [...document.querySelectorAll<HTMLElement>(selector)].map((row) => {
        const before = row.style.cssText;
        if (strip) row.style.minHeight = '0px';
        const box = row.getBoundingClientRect();
        const control =
          row.querySelector('input') ??
          (row.nextElementSibling instanceof HTMLInputElement ? row.nextElementSibling : null);
        const controlBox = control?.getBoundingClientRect();
        const measured = {
          control: { width: controlBox?.width ?? 0, height: controlBox?.height ?? 0 },
          markup: row.dataset['oylNativeRow'] ?? '',
          height: box.height,
          width: box.width,
          minHeight: getComputedStyle(row).minHeight,
        };
        row.style.cssText = before;
        return measured;
      }),
    { selector: ROW_SELECTOR, strip: stripped },
  );
}

for (const viewport of VIEWPORTS) {
  test.describe(`#667 — ${viewport.name} — a checkbox or radio row`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test('is at least a 44×44 target as Chromium lays it out, whichever markup it uses', async ({
      page,
    }) => {
      await openControls(page);
      const rows = await rowBoxes(page, false);
      expect(rows.length).toBe(ROW_COUNT);
      expect(new Set(rows.map((row) => row.markup))).toEqual(new Set(['beside', 'wrapping']));
      for (const row of rows) {
        expect(
          row.height,
          `a ${row.markup} row is ${row.height.toFixed(1)}px tall`,
        ).toBeGreaterThanOrEqual(TOUCH_TARGET_PIXELS);
        expect(
          row.width,
          `a ${row.markup} row is ${row.width.toFixed(1)}px wide`,
        ).toBeGreaterThanOrEqual(TOUCH_TARGET_PIXELS);
        // A flex row squeezes its box when the sentence beside it wraps, which
        // is how #667 first shipped Settings' switch at 22.6 px on CI's fonts.
        // A squeezed box is narrower than it is tall.
        expect(row.control.height, `the box in a ${row.markup} row`).toBeGreaterThan(0);
        expect(
          row.control.width,
          `the box in a ${row.markup} row is ${row.control.width.toFixed(1)}×` +
            `${row.control.height.toFixed(1)}px — squeezed by its row`,
        ).toBe(row.control.height);
      }
    });

    test('a real Settings row keeps its box square and its size when the sentence wraps', async ({
      page,
    }) => {
      // Settings' announcement switches are the rows with a box sized by the
      // stylesheet (24 px), which is the box a flex row can squeeze — #667's
      // first CI run found one at 22.6 px through §"#397" below. Read on the
      // real route, not a specimen, at every viewport including 320 px.
      await page.goto('/shell.html#/settings');
      await page.waitForSelector('html[data-oyl-shell-ready]');
      const boxes = await page.evaluate(() =>
        [...document.querySelectorAll('.oyl-announce label > input[type="checkbox"]')].map(
          (input) => {
            const box = input.getBoundingClientRect();
            const row = input.parentElement?.getBoundingClientRect();
            return { width: box.width, height: box.height, row: row?.height ?? 0 };
          },
        ),
      );
      expect(boxes.length, 'no announcement switch on Settings to measure').toBeGreaterThan(0);
      for (const box of boxes) {
        expect(box.row).toBeGreaterThanOrEqual(TOUCH_TARGET_PIXELS);
        expect(box.width, 'a switch squeezed by its row').toBe(box.height);
        expect(box.height).toBeGreaterThanOrEqual(24);
      }
    });

    test("the file input's button is a 44 px target", async ({ page }) => {
      await openControls(page);
      const height = await page
        .locator('[data-oyl-native-control="file"]')
        .evaluate((input) => input.getBoundingClientRect().height);
      expect(height).toBeGreaterThanOrEqual(TOUCH_TARGET_PIXELS);
    });
  });
}

test.describe('#667 — the row target is declared, and nothing else holds it', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('the 44 px minimum is a declaration on every row', async ({ page }) => {
    await openControls(page);
    for (const row of await rowBoxes(page, false)) {
      expect(Number.parseFloat(row.minHeight), `a ${row.markup} row`).toBeGreaterThanOrEqual(
        TOUCH_TARGET_PIXELS,
      );
    }
  });

  test('with the floor stripped off, a row falls short — the floor is what holds it', async ({
    page,
  }) => {
    // #316's third measurement, and here it is expected to FAIL the target:
    // a row is one line of body text beside a 13 px box, about 25 px, so the
    // declaration is the only thing that makes it 44. A row that still
    // measured 44 with its floor gone would mean something else — a wrapped
    // line, a padding — had started carrying the target without anybody
    // deciding it, which is the emergent guarantee #316 removed.
    await openControls(page);
    const rows = await rowBoxes(page, true);
    expect(rows.length).toBe(ROW_COUNT);
    for (const row of rows) {
      expect(row.minHeight, 'the floor was not taken off, so this measures it').toBe('0px');
      expect(row.height, `a ${row.markup} row with no floor`).toBeGreaterThan(0);
      expect(row.height, `a ${row.markup} row with no floor`).toBeLessThan(TOUCH_TARGET_PIXELS);
    }
  });
});

// #672: in both palettes. The file button, the accent and the check mark are
// what `accent-color` and `color-scheme` hand the platform, so each palette's
// is read back rather than assumed.
for (const theme of THEMES) {
  test.describe(`#667 — the file input, the boxes and the accent (${theme})`, () => {
    test.use({ viewport: { width: 1280, height: 800 }, colorScheme: theme });

    test('draws the file button as the secondary button, a token clear of its label', async ({
      page,
    }) => {
      await openControls(page, CONTROLS_PAGE, theme);
      const read = await page.evaluate(() => {
        const pick = (style: CSSStyleDeclaration) => ({
          color: style.color,
          backgroundColor: style.backgroundColor,
          borderTopColor: style.borderTopColor,
          borderTopWidth: style.borderTopWidth,
          borderTopLeftRadius: style.borderTopLeftRadius,
          paddingTop: style.paddingTop,
          paddingLeft: style.paddingLeft,
          fontSize: style.fontSize,
          minHeight: style.minHeight,
        });
        const input = document.querySelector('[data-oyl-native-control="file"]');
        const label = document.querySelector('label[for="specimen-file"]');
        const secondary = document.querySelector('[data-oyl-touch-target] .oyl-button--secondary');
        if (input === null || label === null || secondary === null) return undefined;
        return {
          file: pick(getComputedStyle(input, '::file-selector-button')),
          secondary: pick(getComputedStyle(secondary)),
          gap: input.getBoundingClientRect().left - label.getBoundingClientRect().right,
        };
      });
      expect(read, 'the file input, its label or a secondary button is missing').toBeDefined();
      expect(read?.file).toEqual(read?.secondary);
      expect(read?.file.color).toBe(rgbOf('accent', theme));
      expect(read?.file.backgroundColor).toBe(rgbOf('canvas', theme));
      // `--oyl-space-sm`, 8 px: "GPX fileChoose File" is the defect.
      expect(read?.gap).toBe(8);
    });

    test('paints checkboxes, radios, a range and a progress bar in the accent token', async ({
      page,
    }) => {
      await openControls(page, CONTROLS_PAGE, theme);
      const accents = await page.evaluate(() =>
        [
          ...document.querySelectorAll(
            '[data-oyl-native-control="checkbox"], [data-oyl-native-control="radio"], ' +
              '[data-oyl-native-control="range"], [data-oyl-native-control="progress"]',
          ),
        ].map((control) => getComputedStyle(control).accentColor),
      );
      expect(accents.length).toBe(6);
      for (const accent of accents) {
        expect(accent).toBe(rgbOf('accent', theme));
      }
    });

    test('a checked box is filled with the accent and its mark is the platform’s recorded glyph', async ({
      page,
    }, info) => {
      // The two pairs `tokens.ts` declares for #667, read off the pixels rather
      // than trusted: the platform chooses the mark's colour, not the stylesheet.
      await openControls(page, CONTROLS_PAGE, theme);
      const path = info.outputPath('checked-box.png');
      await page
        .locator('[data-oyl-native-row="wrapping"] [data-oyl-native-control="checkbox"]')
        .screenshot({ path });
      const png = decodePng(path);
      const hex = (at: number): string =>
        `#${[0, 1, 2]
          .map((channel) => (png.data[at + channel] ?? 0).toString(16).padStart(2, '0'))
          .join('')}`;
      const accent = paletteColours(theme).accent;
      const mark = PLATFORM_CHECK_MARK[theme];
      // The box is found by its fill, and only its interior is read, so the page
      // around a 13 px box cannot supply the "mark".
      let left = png.width;
      let right = -1;
      let top = png.height;
      let bottom = -1;
      for (let y = 0; y < png.height; y += 1) {
        for (let x = 0; x < png.width; x += 1) {
          if (hex((y * png.width + x) * 4) === accent) {
            left = Math.min(left, x);
            right = Math.max(right, x);
            top = Math.min(top, y);
            bottom = Math.max(bottom, y);
          }
        }
      }
      expect(right, `no pixel of the checked box is ${accent}, the accent token`).toBeGreaterThan(
        left,
      );
      const inside = new Map<string, number>();
      for (let y = top + 2; y <= bottom - 2; y += 1) {
        for (let x = left + 2; x <= right - 2; x += 1) {
          const colour = hex((y * png.width + x) * 4);
          inside.set(colour, (inside.get(colour) ?? 0) + 1);
        }
      }
      expect(inside.get(accent) ?? 0, 'the fill').toBeGreaterThan(10);
      // The platform's glyph, which `tokens.ts` §`PLATFORM_CHECK_MARK` records
      // per palette: `accentInk`'s white in light, Chromium's own dark glyph
      // (not `accentInk`) in dark.
      expect(
        inside.get(mark.colour) ?? 0,
        `the mark, in ${mark.colour}; inside the box: ${JSON.stringify([...inside])}`,
      ).toBeGreaterThan(5);
      expect(contrastRatio(mark.colour, accent)).toBeGreaterThanOrEqual(AA_LARGE_TEXT_OR_NON_TEXT);
    });
  });
}

test.describe('#667 — the select opts into a styled picker and stays a select', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  async function state(page: Page) {
    return page.evaluate(() => {
      const select = document.querySelector<HTMLSelectElement>(
        '[data-oyl-native-control="select"]',
      );
      if (select === null) throw new Error('no select specimen');
      return {
        value: select.value,
        open: select.matches(':open'),
        appearance: getComputedStyle(select).appearance,
        options: [...select.options].map((option) => {
          const style = getComputedStyle(option);
          return {
            label: option.label,
            height: option.getBoundingClientRect().height,
            checked: option.selected,
            color: style.color,
            backgroundColor: style.backgroundColor,
          };
        }),
        picker: (() => {
          const style = getComputedStyle(select, '::picker(select)');
          return {
            appearance: style.appearance,
            color: style.color,
            backgroundColor: style.backgroundColor,
            borderTopColor: style.borderTopColor,
          };
        })(),
      };
    });
  }

  test('opens by Space and by click, and every option is a 44 px target', async ({ page }) => {
    await openControls(page);
    const select = page.locator('[data-oyl-native-control="select"]');
    expect((await state(page)).appearance).toBe('base-select');

    await select.focus();
    await page.keyboard.press('Space');
    await expect.poll(async () => (await state(page)).open).toBe(true);
    const opened = await state(page);
    expect(opened.options.length).toBe(4);
    for (const option of opened.options) {
      expect(option.height, `“${option.label}” in the open picker`).toBeGreaterThanOrEqual(
        TOUCH_TARGET_PIXELS,
      );
    }
    await page.keyboard.press('Escape');
    await expect.poll(async () => (await state(page)).open).toBe(false);

    await select.click();
    await expect.poll(async () => (await state(page)).open).toBe(true);
    await page.keyboard.press('Escape');
  });

  test('keeps the platform keyboard model: arrows and Enter choose, typing jumps', async ({
    page,
  }) => {
    await openControls(page);
    const select = page.locator('[data-oyl-native-control="select"]');
    await select.focus();
    await page.keyboard.press('Space');
    await expect.poll(async () => (await state(page)).open).toBe(true);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect.poll(async () => state(page)).toMatchObject({ value: '15', open: false });

    // Typeahead on the closed control: one option starts with "f".
    await page.keyboard.press('f');
    await expect.poll(async () => (await state(page)).value).toBe('45');
  });

  test('is still a combobox with options in the platform’s own accessibility tree', async ({
    page,
    context,
  }) => {
    await openControls(page);
    await page.locator('[data-oyl-native-control="select"]').focus();
    await page.keyboard.press('Space');
    await expect.poll(async () => (await state(page)).open).toBe(true);
    const session = await context.newCDPSession(page);
    const { nodes } = await session.send('Accessibility.getFullAXTree');
    const roles = nodes
      .filter((node) => node.ignored !== true)
      .map((node) => ({ role: String(node.role?.value), name: String(node.name?.value ?? '') }));
    expect(roles).toContainEqual({ role: 'combobox', name: 'Say your power' });
    // Chromium's internal name for a select's popup list; the platform layers
    // expose it as a listbox.
    expect(roles.some((node) => ['listbox', 'MenuListPopup'].includes(node.role))).toBe(true);
    expect(roles.filter((node) => node.role === 'option').map((node) => node.name)).toEqual([
      'never',
      'every 15 seconds',
      'every 30 seconds',
      'forty-five seconds',
    ]);
  });

  for (const theme of THEMES) {
    test.describe(theme, () => {
      test.use({ colorScheme: theme });
      test('paints the picker and its options with the tokens, exactly', async ({ page }) => {
        await openControls(page, CONTROLS_PAGE, theme);
        await page.locator('[data-oyl-native-control="select"]').focus();
        await page.keyboard.press('Space');
        await expect.poll(async () => (await state(page)).open).toBe(true);
        // Move the pointer and the focus away from any option, so each is read at
        // rest: the focused option is the checked one, which wins on colour.
        await page.mouse.move(1270, 790);
        const read = await state(page);
        expect(read.picker).toEqual({
          appearance: 'base-select',
          color: rgbOf('ink', theme),
          backgroundColor: rgbOf('canvas', theme),
          borderTopColor: rgbOf('border', theme),
        });
        const checked = read.options.filter((option) => option.checked);
        expect(checked.length).toBe(1);
        expect(checked[0]).toMatchObject({
          color: rgbOf('accentInk', theme),
          backgroundColor: rgbOf('accent', theme),
        });
        for (const option of read.options.filter((each) => !each.checked)) {
          expect(option, option.label).toMatchObject({
            color: rgbOf('ink', theme),
            backgroundColor: rgbOf('canvas', theme),
          });
        }
        await page.keyboard.press('Escape');
      });
    });
  }

  test('the control — without the @supports block it is the closed skin, and no option is 44 px', async ({
    page,
  }) => {
    await openControls(page, CONTROLS_WITHOUT_BASE_SELECT);
    expect(
      await page.evaluate(() => document.documentElement.dataset['oylBaseSelectRemoved']),
      'the harness removed no @supports (appearance: base-select) block, so this is not the control',
    ).toBe('1');
    expect((await state(page)).appearance).toBe('none');
    await page.locator('[data-oyl-native-control="select"]').focus();
    await page.keyboard.press('Space');
    const read = await state(page);
    expect(read.options.length).toBe(4);
    // The same assertion the positive case makes, required to FAIL here.
    expect(
      read.options.every((option) => option.height >= TOUCH_TARGET_PIXELS),
      'the platform popup laid its options out at 44 px, so the positive case may not have ' +
        'measured the styled picker at all',
    ).toBe(false);
    await page.keyboard.press('Escape');
  });

  for (const url of [CONTROLS_PAGE, CONTROLS_WITHOUT_BASE_SELECT]) {
    test(`hands the control back to the platform under forced colours — ${url}`, async ({
      page,
    }) => {
      await openControls(page, url);
      await page.emulateMedia({ forcedColors: 'active' });
      expect((await state(page)).appearance).toBe('auto');
    });
  }
});
