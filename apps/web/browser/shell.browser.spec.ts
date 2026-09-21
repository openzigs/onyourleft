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
 * Measured on this branch in the lockfile-pinned Chromium: the worst case the
 * `@media (min-width: 64rem) and (min-height: 40rem)` block can admit is
 * 1024×640, where the header is 97 px — **15.2%**. Before the fix, 320×256 was
 * **70%**.
 *
 * ⚠️ 20% is a budget with headroom over the worst admitted case, and that is
 * deliberate rather than slack: it is loose enough that a font-metric
 * difference between Chromium builds cannot turn this red, and tight enough to
 * catch every failure of the shape that has actually occurred — a twelfth
 * route wrapping the nav to a second line at 1024 px takes the header to 138 px
 * and 21.6%, which fails.
 */
const PERSISTENT_CHROME_BUDGET = 0.2;

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
          headerHeight: header.getBoundingClientRect().height,
          headerBackground: getComputedStyle(header).backgroundColor,
          scrollable: document.documentElement.scrollHeight - window.innerHeight,
          overflowsViewport: region.getBoundingClientRect().height - window.innerHeight,
        };
      });

      expect(state.headerHeight, 'the header has no height — did theme.css load?').toBeGreaterThan(
        0,
      );
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
        const headerBox = header.getBoundingClientRect();
        const elsewhere = document.elementFromPoint(headerBox.right - 4, box.bottom + 8);

        return {
          onLink: centre !== null && link.contains(centre),
          onHeaderElsewhere: elsewhere !== null && header.contains(elsewhere),
          linkHeight: box.height,
        };
      });

      expect(hit.linkHeight, 'the skip link has no box to hit-test').toBeGreaterThan(0);
      expect(
        hit.onHeaderElsewhere,
        'a point inside the header does not hit the header, so this hit test proves nothing',
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
 * `select` had been given an explicit `min-height: 2.75rem` by #305 with a
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
    // Seven since #399 and #400, and every one is measured below: the
    // announcements' switch and four rows (power, distance, next block, and
    // #399's climb ahead), and #400's Sounds panel — which carries the same
    // class so its switch and its volume slider are held to the same floor.
    expect(seen.length).toBe(7);
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
