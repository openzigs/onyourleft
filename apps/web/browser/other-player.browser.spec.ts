// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The rider's own music player's controls are 48 px targets, as Chromium lays
 * them out — #2073.
 *
 * A touch target is a layout claim, so it is measured here and never read off
 * the CSS (apps/web/CLAUDE.md). `shell-harness.tsx`'s `?own-player=heard` renders
 * the real `AppShell` under the real `theme.css` with the controls showing, as
 * they show only inside the Android shell once the rider's own player is
 * heard. Measured at the two sizes the issue's screenshots are taken at: a
 * tablet at 1280×800 and a phone at 412×915.
 *
 * The far-end case is the phone's own auto margin (`theme.css`'s anchored
 * mute block), which a later two-class rule outranked until #2242's review.
 *
 * The last case strips `.oyl-other-player__button`'s declaration and watches
 * the measurement fall below 48, so the number is the rule's and not an
 * accident of the words' length.
 */

import { expect, test, type Page } from '@playwright/test';

import { OTHER_PLAYER_GROUP_NAME } from '../src/shell/OtherPlayerControls';

/** The issue's target, in CSS px: Android's 48 dp, one CSS px a dp in a WebView. */
const TARGET_PIXELS = 48;

const VIEWPORTS = [
  { name: 'tablet', width: 1280, height: 800 },
  { name: 'phone', width: 412, height: 915 },
] as const;

const GROUP = `header [role="group"][aria-label="${OTHER_PLAYER_GROUP_NAME}"]`;

interface Box {
  readonly label: string;
  readonly width: number;
  readonly height: number;
  readonly top: number;
}

async function open(page: Page): Promise<void> {
  await page.goto('/shell.html?own-player=heard');
  await page.waitForSelector('html[data-oyl-shell-ready]');
  await page.waitForSelector(`${GROUP} button`);
}

async function boxes(page: Page): Promise<readonly Box[]> {
  return page.evaluate((selector) => {
    return [...document.querySelectorAll(`${selector} button`)].map((element) => {
      const box = element.getBoundingClientRect();
      return {
        label: (element.textContent ?? '').trim(),
        width: box.width,
        height: box.height,
        top: box.top,
      };
    });
  }, GROUP);
}

for (const viewport of VIEWPORTS) {
  test.describe(`${viewport.name} — the rider’s own music player`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test('each control is at least a 48×48 target', async ({ page }) => {
      await open(page);
      const found = await boxes(page);
      // Non-vacuity: a list that found nothing would pass every loop below.
      expect(found.map((box) => box.label)).toStrictEqual([
        'Previous track',
        'Pause music',
        'Next track',
      ]);
      for (const box of found) {
        expect(
          box.height,
          `“${box.label}” is ${box.height.toFixed(1)}px tall`,
        ).toBeGreaterThanOrEqual(TARGET_PIXELS);
        expect(
          box.width,
          `“${box.label}” is ${box.width.toFixed(1)}px wide`,
        ).toBeGreaterThanOrEqual(TARGET_PIXELS);
      }
    });

    test('the three are one row, so the header grows by one target and no more', async ({
      page,
    }) => {
      await open(page);
      const tops = new Set((await boxes(page)).map((box) => Math.round(box.top)));
      expect([...tops], 'the controls wrapped onto a second row').toHaveLength(1);
    });

    test('the three sit at the header’s far end, not beside the wordmark', async ({ page }) => {
      await open(page);
      const placed = await page.evaluate((selector) => {
        const header = document.querySelector('header.oyl-header');
        const group = document.querySelector(selector);
        if (header === null || group === null) return undefined;
        const box = header.getBoundingClientRect();
        const end = box.right - Number.parseFloat(getComputedStyle(header).paddingInlineEnd);
        return { end, right: group.getBoundingClientRect().right };
      }, GROUP);
      expect(placed, 'no header or no controls').toBeDefined();
      if (placed === undefined) return;
      expect(
        Math.abs(placed.end - placed.right),
        `the controls end at x=${placed.right.toFixed(1)}, the header's content at x=${placed.end.toFixed(1)}`,
      ).toBeLessThanOrEqual(1);
    });
  });
}

test.describe('the 48 px is the declaration’s', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('stripping it takes the controls below 48', async ({ page }) => {
    await open(page);
    const removed = await page.evaluate(() => {
      let count = 0;
      for (const sheet of [...document.styleSheets]) {
        const rules = [...sheet.cssRules];
        for (let index = rules.length - 1; index >= 0; index -= 1) {
          const rule = rules[index];
          if (
            rule instanceof CSSStyleRule &&
            rule.selectorText === '.oyl-other-player .oyl-other-player__button'
          ) {
            sheet.deleteRule(index);
            count += 1;
          }
        }
      }
      return count;
    });
    expect(removed).toBe(1);
    const tallest = Math.max(...(await boxes(page)).map((box) => box.height));
    expect(tallest).toBeLessThan(TARGET_PIXELS);
  });
});
