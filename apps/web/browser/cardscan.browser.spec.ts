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
    await expect(page.getByText('That code is from another of your devices')).toBeVisible();
    await expect(page.locator('video')).toHaveCount(0);
    expect(await page.evaluate(() => window.__oylCardScan?.tracks())).toEqual(['ended', 'ended']);
    expect(await page.evaluate(() => window.__oylCardScan?.asked())).toBe(2);
    // The card box is untouched: a line from another device is for "Add this device".
    await expect(page.getByLabel('The instance’s card (optional)')).toHaveValue('');
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
