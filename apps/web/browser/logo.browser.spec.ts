// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * About shows its text without waiting for its logo — #1136.
 *
 * `logo-harness.tsx` says what the page is and why. With every request for a
 * logo held back (never answered, as a slow network looks to the page), a
 * navigation to About must put its text in the DOM well inside React's 800 ms
 * wait for a suspensey image; the control — the same view with the pre-#1136
 * `<img>` beside it — must not.
 *
 * ⚠️ The bound is {@link SHOWN_WITHIN_MS}, 500 ms: 300 ms short of React's
 * `SUSPENSEY_IMAGE_TIMEOUT`, which starts only once the render is done, so the
 * control cannot reach its text inside it; and a render of About, which takes
 * a few ms on a developer's machine, has the rest. A runner slow enough to
 * spend 500 ms rendering one view would fail the shipped case, not pass the
 * control.
 *
 * ⚠️ What it does not prove: anything about the product's own lazy chunk, whose
 * fallback stands under the heading while About's code downloads (#674) —
 * that is a download a rider needs, not a picture they do not.
 */

import { expect, test, type Page } from '@playwright/test';

import { HARNESS_ORIGIN } from '../playwright.config';

/** How soon About's text must be in the DOM after the navigation starts. */
const SHOWN_WITHIN_MS = 500;

/** Every request for the full logo, in either palette. */
const LOGO_REQUEST = /\/logo-(light|dark)-[^/]+\.png$/;

async function navigateWithTheLogoHeld(
  page: Page,
  query: string,
): Promise<{
  readonly ms: number;
  readonly logoRequested: boolean;
}> {
  let logoRequested = false;
  // Never answered: the picture stays on its way for as long as the case runs.
  await page.route(LOGO_REQUEST, () => {
    logoRequested = true;
  });
  const response = await page.goto(`${HARNESS_ORIGIN}/logo.html${query}`);
  expect(response?.status(), 'logo.html is not built: vite.browser.config.ts').toBe(200);
  await page.waitForFunction(() => window.__oylLogo !== undefined);
  const ms = await page.evaluate(() => window.__oylLogo?.go() ?? Promise.resolve(-1));
  return { ms, logoRequested };
}

test.describe('#1136 — About is shown while its logo is still loading', () => {
  test('About’s text is in the DOM at once, with the logo’s request unanswered', async ({
    page,
  }) => {
    const { ms } = await navigateWithTheLogoHeld(page, '');
    console.log(`#1136 About shown ${ms.toFixed(0)} ms after the navigation, logo held`);
    expect(ms).toBeGreaterThanOrEqual(0);
    expect(ms).toBeLessThan(SHOWN_WITHIN_MS);
    // The picture is still on the page, still loading — it was not left out.
    const image = page.locator('img.oyl-brand-logo__image');
    await expect(image).toHaveCount(1);
    expect(await image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBe(0);
  });

  test('control: the logo as it was before holds the page until React gives up', async ({
    page,
  }) => {
    const { ms, logoRequested } = await navigateWithTheLogoHeld(page, '?logo=before');
    console.log(`#1136 control: About shown ${ms.toFixed(0)} ms after the navigation`);
    expect(logoRequested, 'the control never asked for the logo').toBe(true);
    expect(ms).toBeGreaterThanOrEqual(SHOWN_WITHIN_MS);
  });
});
