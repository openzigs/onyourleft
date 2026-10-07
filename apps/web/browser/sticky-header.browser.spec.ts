// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A control focused by Shift+Tab is never under the sticky header — #990.
 *
 * Where the header sticks (`theme.css`, `(min-width: 64rem) and (min-height:
 * 40rem)`), Chromium scrolls a control that Shift+Tab reaches above the
 * viewport just far enough to put it at the TOP edge, which is where the
 * header is. Before #990 only the game's chooser allowed for that (#983):
 * on Settings, a long page, a control reached backwards could be focused
 * while the header covered it (WCAG 2.2 SC 2.4.11). `theme.css` now gives the
 * whole document a `scroll-padding-top` of the header's own height
 * (`--oyl-header-height`, #671) plus the top inset.
 *
 * The walk opens Settings in `reflow.html` (the real `AppShell` over the
 * populated fixtures, #660), focuses the last control in `main`, and presses
 * Shift+Tab until focus leaves `main`, reading after each press how many
 * pixels of the focused control lie under the header. Every one must be
 * clear.
 *
 * ⚠️ **The control** puts `scroll-padding-top: 0` on the root, inline — the
 * padding taken away — and the same walk must then find a control under the
 * header. Without it a page too short to scroll, a header that did not stick
 * or a walk that focused nothing would all pass.
 *
 * ## What it does NOT prove
 *
 * A real tablet's fonts, or any route but Settings: the padding is the
 * document's, so it applies to every route by construction, and Settings is
 * the one #983's review saw it on.
 */

import { expect, test, type Page } from '@playwright/test';

import { applyInsets, PIXEL_TABLET_LANDSCAPE_INSETS, resolvedInsets, type Insets } from './insets';

interface Viewport {
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly insets: Insets;
}

const VIEWPORTS: readonly Viewport[] = [
  {
    name: 'a desktop window — 1280×800',
    width: 1280,
    height: 800,
    insets: { top: 0, right: 0, bottom: 0, left: 0 },
  },
  {
    name: 'a landscape tablet inside the Android shell — 1280×800, insets 36/32',
    width: 1280,
    height: 800,
    insets: PIXEL_TABLET_LANDSCAPE_INSETS,
  },
];

/** A sub-pixel's slack: a box that ends at the header's edge is clear of it. */
const SUBPIXEL_TOLERANCE = 0.5;

interface Focused {
  readonly name: string;
  /** How many CSS pixels of the control's height are under the header. */
  readonly covered: number;
}

async function open(page: Page, viewport: Viewport): Promise<void> {
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  await applyInsets(page, viewport.insets);
  const response = await page.goto('/reflow.html?data=populated');
  expect(
    response?.status(),
    'reflow.html did not load — is it named in vite.browser.config.ts build.rollupOptions.input?',
  ).toBe(200);
  await page.waitForFunction(() => window.__oylReflow !== undefined);
  expect(await page.evaluate(() => window.__oylReflow?.errors)).toEqual([]);
  expect(await page.evaluate(() => window.__oylReflow?.ready)).toBe(true);
  expect(await resolvedInsets(page)).toEqual(viewport.insets);
  const seen = await page.evaluate(async () => window.__oylReflow?.visit('#/settings'));
  expect(seen?.settledWithinPatience, '#/settings did not settle').toBe(true);
  expect(seen?.errors, '#/settings raised an error').toEqual([]);
}

/** Focus the last control in `main`, then Shift+Tab back through every one. */
async function backwardsWalk(page: Page): Promise<readonly Focused[]> {
  await page.evaluate(() => {
    const controls = [
      ...document.querySelectorAll<HTMLElement>(
        'main input, main select, main textarea, main button, main a[href], main summary',
      ),
    ].filter(
      (each) =>
        each.tabIndex >= 0 &&
        !(each as HTMLInputElement).disabled &&
        each.checkVisibility() &&
        each.getBoundingClientRect().height > 0,
    );
    const last = controls.at(-1);
    if (last === undefined) throw new Error('Settings has no controls');
    window.scrollTo(0, document.documentElement.scrollHeight);
    last.focus();
  });
  const read = () =>
    page.evaluate(() => {
      const element = document.activeElement as HTMLElement | null;
      const main = document.querySelector('main');
      if (element === null || main === null || !main.contains(element)) {
        return undefined;
      }
      const header = document.querySelector('.oyl-header')?.getBoundingClientRect();
      if (header === undefined) throw new Error('no header');
      const box = element.getBoundingClientRect();
      const covered = Math.max(
        0,
        Math.min(box.bottom, header.bottom) - Math.max(box.top, header.top),
      );
      const name = (
        element.getAttribute('aria-label') ??
        (element as HTMLInputElement).labels?.[0]?.textContent ??
        element.textContent ??
        element.tagName
      )
        .trim()
        .slice(0, 60);
      return {
        name,
        covered,
        sticky: getComputedStyle(document.querySelector('.oyl-header')!).position,
      };
    });
  const seen: Focused[] = [];
  for (let press = 0; press < 400; press += 1) {
    const reading = await read();
    if (reading === undefined) break;
    expect(reading.sticky, 'the header does not stick at this viewport').toBe('sticky');
    seen.push({ name: reading.name, covered: reading.covered });
    await page.keyboard.press('Shift+Tab');
  }
  return seen;
}

for (const viewport of VIEWPORTS) {
  test.describe(`#990 — ${viewport.name}`, () => {
    test('no control reached by Shift+Tab on Settings is under the sticky header', async ({
      page,
    }) => {
      await open(page, viewport);
      const seen = await backwardsWalk(page);
      // The apparatus: the walk went through a page of controls.
      expect(seen.length).toBeGreaterThan(10);
      const under = seen.filter((each) => each.covered > SUBPIXEL_TOLERANCE);
      expect(under, 'focused under the header').toEqual([]);
    });

    test('the control — with the scroll padding removed, one is under the header', async ({
      page,
    }) => {
      await open(page, viewport);
      await page.evaluate(() => {
        document.documentElement.style.scrollPaddingTop = '0px';
      });
      const seen = await backwardsWalk(page);
      expect(seen.length).toBeGreaterThan(10);
      expect(seen.filter((each) => each.covered > SUBPIXEL_TOLERANCE).length).toBeGreaterThan(0);
    });
  });
}
