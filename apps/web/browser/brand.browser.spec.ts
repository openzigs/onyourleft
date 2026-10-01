// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The owner's wordmark and logo, in the page's two palettes — #965.
 *
 * jsdom loads no stylesheet and decodes no picture, so the Vitest suite can
 * say only that both variants are in the markup with `alt=""` beside the name.
 * Which one a rider SEES is `theme.css` §"The owner's wordmark and logo", a
 * `data-theme` switch, and only a browser can read it. Against the PRODUCT
 * build, at the tablet's width where the header shows the wordmark:
 *
 * - exactly one wordmark is drawn, it is the palette's own variant (navy
 *   letters on the light header, the dark palette's ink on the dark one), it
 *   decoded, and it is the 24 px the header's line was laid out for;
 * - the banner is still named "On Your Left";
 * - About draws exactly one logo, the palette's own, decoded.
 *
 * ⚠️ **The control** takes the switch's dark-palette selectors out through the
 * CSSOM and requires the dark page to draw the LIGHT wordmark — navy letters on
 * a dark header, which is the defect two variants exist to prevent. It is what
 * says the dark case above measured the switch rather than a page that happened
 * to draw the right file.
 */

import { expect, test, type Page } from '@playwright/test';

import { PRODUCT_ORIGIN } from '../playwright.config';

interface Drawn {
  readonly sources: readonly string[];
  readonly decoded: boolean;
  readonly height: number;
  readonly width: number;
}

async function drawn(page: Page, selector: string): Promise<Drawn> {
  return page.evaluate((query) => {
    const visible = [...document.querySelectorAll<HTMLImageElement>(query)].filter(
      (image) => image.checkVisibility() && image.getBoundingClientRect().width > 0,
    );
    const first = visible[0];
    return {
      sources: visible.map((image) => image.currentSrc),
      decoded: first !== undefined && first.complete && first.naturalWidth > 0,
      height: first?.getBoundingClientRect().height ?? 0,
      width: first?.getBoundingClientRect().width ?? 0,
    };
  }, selector);
}

async function open(page: Page, scheme: 'light' | 'dark', hash: string): Promise<void> {
  await page.emulateMedia({ colorScheme: scheme });
  await page.goto(`${PRODUCT_ORIGIN}/${hash}`);
  await expect
    .poll(() => page.evaluate(() => document.documentElement.getAttribute('data-theme')))
    .toBe(scheme);
}

/** Wait until every brand picture on the page has finished loading. */
async function loaded(page: Page, selector: string): Promise<void> {
  await page.waitForFunction(
    (query) =>
      [...document.querySelectorAll<HTMLImageElement>(query)].every((image) => image.complete),
    selector,
  );
}

test.describe('#965 — the owner’s wordmark and logo, in both palettes', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  for (const scheme of ['light', 'dark'] as const) {
    test(`the header draws the ${scheme} wordmark, and only it`, async ({ page }) => {
      await open(page, scheme, '');
      await expect(page.getByRole('banner', { name: 'On Your Left' })).toHaveCount(1);
      await loaded(page, '.oyl-wordmark__image');
      const seen = await drawn(page, '.oyl-wordmark__image');
      expect(seen.sources).toHaveLength(1);
      expect(seen.sources[0]).toMatch(new RegExp(`/wordmark-${scheme}-[^/]+\\.png$`));
      expect(seen.decoded).toBe(true);
      expect(seen.height).toBe(24);
    });

    test(`About draws the ${scheme} logo, and only it`, async ({ page }) => {
      await open(page, scheme, '#/about');
      await page.waitForSelector('.oyl-brand-logo__image', { state: 'attached' });
      await loaded(page, '.oyl-brand-logo__image');
      const seen = await drawn(page, '.oyl-brand-logo__image');
      expect(seen.sources).toHaveLength(1);
      expect(seen.sources[0]).toMatch(new RegExp(`/logo-${scheme}-[^/]+\\.png$`));
      expect(seen.decoded).toBe(true);
      expect(seen.width).toBeGreaterThan(100);
      expect(seen.width).toBeLessThanOrEqual(256);
    });
  }

  test('control: without the palette switch, the dark page draws the light wordmark', async ({
    page,
  }) => {
    await open(page, 'dark', '');
    await loaded(page, '.oyl-wordmark__image');
    const removed = await page.evaluate(() => {
      // The minifier merges selectors, so a dark rule may share a rule with a
      // light one (`.oyl-brand--dark, :root[data-theme=dark] .oyl-brand--light`):
      // only the selectors naming the dark palette are taken out.
      let count = 0;
      for (const sheet of document.styleSheets) {
        const rules = sheet.cssRules;
        for (let index = rules.length - 1; index >= 0; index -= 1) {
          const rule = rules[index];
          if (!(rule instanceof CSSStyleRule) || !rule.selectorText.includes('oyl-brand')) {
            continue;
          }
          const parts = rule.selectorText.split(',');
          const kept = parts.filter((part) => !part.includes('data-theme'));
          count += parts.length - kept.length;
          if (kept.length === 0) {
            sheet.deleteRule(index);
          } else if (kept.length < parts.length) {
            rule.selectorText = kept.join(',');
          }
        }
      }
      return count;
    });
    expect(removed, 'the dark palette’s brand rules were not found').toBe(3);
    // The light picture was `display: none` until now: give the engine the
    // frames it takes to lay it out (and, on a loaded runner, to decode it).
    await expect
      .poll(async () => (await drawn(page, '.oyl-wordmark__image')).sources)
      .toEqual([expect.stringMatching(/\/wordmark-light-[^/]+\.png$/)]);
  });
});
