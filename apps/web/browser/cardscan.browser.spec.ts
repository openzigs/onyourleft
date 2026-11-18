// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Scanning the instance card on the Connect form, in Chromium — #2785.
 *
 * `cardscan-harness.tsx` says what is real: everything from `getUserMedia`'s
 * stream to the text in the box, with a committed QR picture
 * (`card-qr-fixture.png`) where the camera's view would be. The press is the
 * rider's; what the spec checks is that the decoder read the picture into the
 * line box, that nothing was sent, and that the camera's stream ended.
 */

import { expect, test, type Page } from '@playwright/test';

import { HARNESS_ORIGIN } from '../playwright.config';
import { CARD_QR_TEXT } from './cardscan-fixture';

async function open(page: Page, query = ''): Promise<void> {
  const response = await page.goto(`${HARNESS_ORIGIN}/cardscan.html${query}`);
  expect(response?.status(), 'cardscan.html is not built: vite.browser.config.ts').toBe(200);
  await page.waitForFunction(() => window.__oylCardScan !== undefined);
  const published = await page.evaluate(() => ({
    ready: window.__oylCardScan?.ready,
    errors: window.__oylCardScan?.errors,
  }));
  expect(published.errors, 'the card-scan harness reported an error').toEqual([]);
  expect(published.ready).toBe(true);
}

test.describe('#2785 — the instance card’s scanner reads a real QR picture', () => {
  test('puts the scanned card and code in the line box, sends nothing, and stops the camera', async ({
    page,
  }) => {
    const requests: string[] = [];
    page.on('request', (request) => {
      if (!request.url().startsWith(HARNESS_ORIGIN)) requests.push(request.url());
    });
    await open(page);
    const line = page.getByLabel('The line your other device shows');
    await expect(line).toHaveValue('');

    await page.getByRole('button', { name: 'Scan the card with the camera' }).click();
    await expect(page.getByRole('button', { name: 'Close the scanner' })).toBeVisible();
    // The pixels went through a `<video>`, a canvas and jsQR: the box holds
    // exactly what the picture says.
    await expect(line).toHaveValue(CARD_QR_TEXT);
    await expect(page.getByText('That card came with a code')).toBeVisible();
    // #2823: the same line is what a server's setup page shows as a claim.
    await expect(page.getByLabel('The claim code from your server’s setup page')).toHaveValue(
      CARD_QR_TEXT,
    );
    await expect(page.locator('video')).toHaveCount(0);
    expect(await page.evaluate(() => window.__oylCardScan?.tracks())).toEqual(['ended', 'ended']);
    expect(await page.evaluate(() => window.__oylCardScan?.asked())).toBe(2);
    // #2826: the same line is a rider invite's too, which Connect takes from
    // the card box, and the empty address shows the card's own.
    await expect(page.getByLabel('The instance’s card (optional)')).toHaveValue(CARD_QR_TEXT);
    await expect(page.getByLabel('Instance address')).toHaveValue('https://instance.example.org');
    expect(requests, 'the scan sent something off the page').toEqual([]);
  });

  test('closing the scanner stops the camera with nothing read, and the paste box stays', async ({
    page,
  }) => {
    // A camera that sees no code, so the scan is still looking when it is closed.
    await open(page, '?blank');
    await page.getByRole('button', { name: 'Scan the card with the camera' }).click();
    await expect(page.getByText('Looking for the card’s code…')).toBeVisible();
    await page.getByRole('button', { name: 'Close the scanner' }).click();
    await expect(page.locator('video')).toHaveCount(0);
    expect(await page.evaluate(() => window.__oylCardScan?.tracks())).toEqual(['ended', 'ended']);
    await expect(page.getByLabel('The line your other device shows')).toHaveValue('');
    // Focus is back on the button that started the scan, and the paste box is
    // the next stops back by keyboard.
    await expect(page.getByRole('button', { name: 'Scan the card with the camera' })).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(page.getByLabel('The instance’s card (optional)')).toBeFocused();
  });
});

/**
 * #2823: the owner's claim, read by its own scanner, and the six digits it
 * then shows. The fixture is a card and a code, which is the shape of the
 * setup page's claim QR too (#2783). The port is the scripted one, so the
 * digits are `instance/testing.ts` §`SCRIPTED_COMPARISON_CODE`; what is
 * measured is what jsdom cannot: that they are drawn large and that the screen
 * still fits a 320 px window with them on it.
 */
test.describe('#2823 — the owner’s claim QR and its six digits', () => {
  for (const viewport of [
    { width: 320, height: 640 },
    { width: 1280, height: 800 },
  ]) {
    test(`reads the claim QR, then shows the digits large without a sideways scroll at ${String(viewport.width)} px`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      const requests: string[] = [];
      page.on('request', (request) => {
        if (!request.url().startsWith(HARNESS_ORIGIN)) requests.push(request.url());
      });
      await open(page);
      const box = page.getByLabel('The claim code from your server’s setup page');
      await page.getByRole('button', { name: 'Scan the claim code with the camera' }).click();
      await expect(box).toHaveValue(CARD_QR_TEXT);
      // Only the claim box: the other boxes are for other things.
      await expect(page.getByLabel('The line your other device shows')).toHaveValue('');
      await expect(page.locator('video')).toHaveCount(0);

      await page.getByRole('button', { name: 'Claim this server' }).click();
      const digits = page.locator('.oyl-instance__compare');
      await expect(digits).toHaveText('482 913');
      await expect(page.getByRole('button', { name: 'Sign in as the owner' })).toBeFocused();
      const drawn = await digits.evaluate((element) => {
        const groups = [...element.querySelectorAll('strong')].map((each) =>
          each.getBoundingClientRect(),
        );
        return {
          fontSize: Number.parseFloat(getComputedStyle(element).fontSize),
          right: Math.max(...groups.map((each) => each.right)),
          inner: window.innerWidth,
          scrollWidth: document.documentElement.scrollWidth,
        };
      });
      // Large: well over twice the body text, as the setup page draws them.
      expect(drawn.fontSize).toBeGreaterThanOrEqual(48);
      expect(drawn.right).toBeLessThanOrEqual(drawn.inner);
      expect(drawn.scrollWidth).toBeLessThanOrEqual(drawn.inner);
      expect(requests, 'the claim sent something off the page').toEqual([]);
    });
  }
});
