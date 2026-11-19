// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Scanning a code on the Connect screen, in Chromium — #2785, and since
 * #2828 the flow it starts: one scan, then one question about where the code
 * came from.
 *
 * `cardscan-harness.tsx` says what is real: everything from `getUserMedia`'s
 * stream to the text the flow reads, with a committed QR picture
 * (`card-qr-fixture.png`) where the camera's view would be. The press is the
 * rider's; what the spec checks is that the decoder read the picture, that
 * nothing was sent, that the camera's stream ended, and — at 320 and 1280 px —
 * what jsdom cannot measure: the large buttons, no sideways scroll on any
 * step, each refusal under the button pressed, and what the instance receives
 * on the screen before any press. Since #2856 a fresh device (`?fresh`) is
 * asked for the scan in place, and that question is measured here too.
 */

import { expect, test, type Locator, type Page } from '@playwright/test';

import { HARNESS_ORIGIN } from '../playwright.config';
import { CARD_QR_TEXT } from './cardscan-fixture';

/** The 44 px floor every control declares (SC 2.5.5). */
const TOUCH_TARGET_PIXELS = 44;

const VIEWPORTS = [
  { width: 320, height: 640 },
  { width: 1280, height: 800 },
] as const;

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

/** Every request that left the page. */
function offPage(page: Page): string[] {
  const requests: string[] = [];
  page.on('request', (request) => {
    if (!request.url().startsWith(HARNESS_ORIGIN)) requests.push(request.url());
  });
  return requests;
}

/** Scan the fixture: a card and a code. */
async function scan(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Scan a code' }).click();
  await expect(page.getByRole('heading', { name: 'Where did this code come from?' })).toBeVisible();
  await expect(page.locator('video')).toHaveCount(0);
}

/** No sideways scroll, and what the instance receives open on the screen. */
async function expectFits(page: Page, where: string): Promise<void> {
  const widths = await page.evaluate(() => ({
    inner: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(widths.scrollWidth, where).toBeLessThanOrEqual(widths.inner);
  const receives = page.locator('details[open] > summary', {
    hasText: 'What the server receives from this app',
  });
  await expect(receives, where).toHaveCount(1);
  await expect(
    page.getByText('Connecting itself sends no ride, route, position or heart rate of yours.'),
    where,
  ).toBeVisible();
}

/** `status` is drawn directly under `pressed`: below it, and before anything else is. */
async function expectUnder(pressed: Locator, status: Locator, where: string): Promise<void> {
  const button = await pressed.boundingBox();
  const said = await status.boundingBox();
  expect(button, where).not.toBeNull();
  expect(said, where).not.toBeNull();
  expect(said!.y, where).toBeGreaterThanOrEqual(button!.y + button!.height - 1);
  // The form's own gap, 8 px, and nothing between.
  expect(said!.y - (button!.y + button!.height), where).toBeLessThanOrEqual(16);
  // And in the button's column, not beside it.
  expect(Math.abs(said!.x - button!.x), where).toBeLessThanOrEqual(1);
}

test.describe('#2785 — the scanner reads a real QR picture', () => {
  test('reads the card and code once, sends nothing, stops the camera, and asks where it came from', async ({
    page,
  }) => {
    const requests = offPage(page);
    await open(page);
    await page.getByRole('button', { name: 'Scan a code' }).click();
    // The pixels went through a `<video>`, a canvas and jsQR: the question
    // names the address the picture's card says.
    await expect(
      page.getByRole('heading', { name: 'Where did this code come from?' }),
    ).toBeVisible();
    await expect(
      page.getByText('The code is for the server at https://instance.example.org.'),
    ).toBeVisible();
    // #2828: no box was filled, three or otherwise.
    await expect(page.locator('textarea')).toHaveCount(0);
    await expect(page.locator('video')).toHaveCount(0);
    expect(await page.evaluate(() => window.__oylCardScan?.tracks())).toEqual(['ended', 'ended']);
    expect(await page.evaluate(() => window.__oylCardScan?.asked())).toBe(2);
    expect(requests, 'the scan sent something off the page').toEqual([]);
  });

  test('closing the scanner stops the camera with nothing read, and paste is the next stop', async ({
    page,
  }) => {
    // A camera that sees no code, so the scan is still looking when it is closed.
    await open(page, '?blank');
    await page.getByRole('button', { name: 'Scan a code' }).click();
    await expect(page.getByText('Looking for the card’s code…')).toBeVisible();
    await page.getByRole('button', { name: 'Close the scanner' }).click();
    await expect(page.locator('video')).toHaveCount(0);
    expect(await page.evaluate(() => window.__oylCardScan?.tracks())).toEqual(['ended', 'ended']);
    // Focus is back on the button that started the scan, and Paste a code
    // instead is the next stop by keyboard.
    await expect(page.getByRole('button', { name: 'Scan a code' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Paste a code instead' })).toBeFocused();
  });
});

test.describe('#2828 — one scan, then one question, at 320 and 1280 px', () => {
  for (const viewport of VIEWPORTS) {
    const at = `${String(viewport.width)} px`;

    test(`opens on one large Scan a code, first on the screen, at ${at}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await open(page);
      const scanButton = page.getByRole('button', { name: 'Scan a code' });
      const box = await scanButton.boundingBox();
      // Large: the column's width up to its measure, and taller than the floor.
      expect(box!.height).toBeGreaterThanOrEqual(56);
      const column = await scanButton.evaluate((element) => {
        const holder = element.parentElement!;
        const style = getComputedStyle(holder);
        return (
          holder.clientWidth -
          Number.parseFloat(style.paddingLeft) -
          Number.parseFloat(style.paddingRight)
        );
      });
      expect(box!.width).toBeGreaterThanOrEqual(Math.min(column, 28 * 16) - 1);
      expect(box!.width).toBeGreaterThanOrEqual(viewport.width === 320 ? 250 : 28 * 16 - 1);
      // The first control on the screen, and above the fold.
      const first = await page.evaluate(
        () =>
          document.querySelector('main button, main textarea, main input, main summary')
            ?.textContent,
      );
      expect(first).toBe('Scan a code');
      expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
      await expect(page.getByRole('button', { name: 'Paste a code instead' })).toBeVisible();
      await expectFits(page, `start at ${at}`);
    });

    test(`asks one question with three large choices, and each opens its step, at ${at}`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      const requests = offPage(page);
      await open(page);
      await scan(page);
      for (const name of [
        'My server’s setup page',
        'Someone invited me',
        'Another of my devices',
      ]) {
        const box = await page.getByRole('button', { name }).boundingBox();
        expect(box!.height, name).toBeGreaterThanOrEqual(56);
        expect(box!.x + box!.width, name).toBeLessThanOrEqual(viewport.width);
      }
      await expectFits(page, `question at ${at}`);

      for (const [choice, heading, press] of [
        ['My server’s setup page', 'Claim your server', 'Claim this server'],
        ['Someone invited me', 'Join with this invite', 'Connect'],
        ['Another of my devices', 'Add this device', 'Add this device'],
      ] as const) {
        await page.getByRole('button', { name: choice }).click();
        await expect(page.getByRole('heading', { name: heading })).toBeFocused();
        const button = page.getByRole('button', { name: press, exact: true });
        const box = await button.boundingBox();
        expect(box!.height, heading).toBeGreaterThanOrEqual(TOUCH_TARGET_PIXELS);
        await expectFits(page, `${heading} at ${at}`);
        await page.getByRole('button', { name: 'Use another code' }).click();
        await scan(page);
      }
      expect(requests, 'a step sent something before its press').toEqual([]);
    });

    test(`goes straight to Connect for a pasted card alone, at ${at}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await open(page);
      await page.getByRole('button', { name: 'Paste a code instead' }).click();
      const box = page.getByLabel('The code, or the line under it');
      await expect(box).toBeFocused();
      // The walkthrough's gap: the paste box's label stands apart from Scan a code.
      const scanBox = await page.getByRole('button', { name: 'Scan a code' }).boundingBox();
      const labelBox = await page.getByText('The code, or the line under it').boundingBox();
      expect(labelBox!.y - (scanBox!.y + scanBox!.height)).toBeGreaterThanOrEqual(16);
      await box.fill(CARD_QR_TEXT.split(' ')[0] ?? '');
      await page.getByRole('button', { name: 'Continue' }).click();
      await expect(page.getByRole('heading', { name: 'Connect with this code' })).toBeFocused();
      await expect(page.getByText('Where did this code come from?')).toHaveCount(0);
      // The address is the card's, in the expert's shut disclosure.
      await expect(page.getByLabel('Server address')).toBeHidden();
      await page.getByText('Enter the address yourself').click();
      await expect(page.getByLabel('Server address')).toHaveValue('https://instance.example.org');
      await expectFits(page, `card at ${at}`);
    });

    test(`shows a whole address, each label above its box, and Connect under the name, at ${at}`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await open(page);
      await page.getByRole('button', { name: 'Paste a code instead' }).click();
      await page.getByLabel('The code, or the line under it').fill(CARD_QR_TEXT);
      await page.getByRole('button', { name: 'Continue' }).click();
      await page.getByRole('button', { name: 'Someone invited me' }).click();
      const name = page.getByLabel('The name other riders will see (optional)');
      const connect = page.getByRole('button', { name: 'Connect', exact: true });
      const nothingSent = page.getByText('Nothing is sent until you press “Connect”.');
      const expert = page.getByText('Enter the address yourself');
      // Name, what is sent, Connect, then the expert's disclosure: in that order, down the page.
      const order = await Promise.all(
        [name, nothingSent, connect, expert].map(async (each) => (await each.boundingBox())!.y),
      );
      expect(order, `order at ${at}`).toEqual([...order].sort((a, b) => a - b));
      await expert.click();
      const address = page.getByLabel('Server address');
      await expect(address).toHaveValue('https://instance.example.org');
      for (const [label, field] of [
        ['Server address', address],
        ['The name other riders will see (optional)', name],
      ] as const) {
        const labelBox = await page.getByText(label, { exact: true }).boundingBox();
        const fieldBox = await field.boundingBox();
        // Above its box, not beside it.
        expect(labelBox!.y + labelBox!.height, label).toBeLessThanOrEqual(fieldBox!.y + 1);
        // The column's width, up to its measure of 32rem.
        const column = await field.evaluate((element) => element.parentElement!.clientWidth);
        expect(fieldBox!.width, label).toBeGreaterThanOrEqual(Math.min(column, 32 * 16) - 1);
      }
      // The whole example origin is in view: nothing of it is scrolled out of the box.
      const clipped = await address.evaluate(
        (element) => element.scrollWidth - element.clientWidth,
      );
      expect(clipped, `address clipped at ${at}`).toBeLessThanOrEqual(0);
      await expectFits(page, `invite with the address open at ${at}`);
    });

    test(`says a refused code directly under the button pressed, at ${at}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await open(page);
      await page.getByRole('button', { name: 'Paste a code instead' }).click();
      await page.getByLabel('The code, or the line under it').fill('https://example.org/wifi');
      const pressed = page.getByRole('button', { name: 'Continue' });
      await pressed.click();
      const said = page
        .getByRole('status')
        .filter({ hasText: 'That is not a code this app can use' });
      await expect(said).toBeVisible();
      await expectUnder(pressed, said, `paste refused at ${at}`);
      await expectFits(page, `paste refused at ${at}`);
    });
  }
});

/**
 * #2823: the owner's claim, from the scan, and the six digits it then shows.
 * The fixture is a card and a code, which is the shape of the setup page's
 * claim QR too (#2783). The port is the scripted one, so the digits are
 * `instance/testing.ts` §`SCRIPTED_COMPARISON_CODE`; what is measured is what
 * jsdom cannot: that they are drawn large and that the screen still fits a
 * 320 px window with them on it.
 */
test.describe('#2823 — the owner’s claim QR and its six digits', () => {
  for (const viewport of VIEWPORTS) {
    test(`reads the claim QR, then shows the digits large without a sideways scroll at ${String(viewport.width)} px`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      const requests = offPage(page);
      await open(page);
      await scan(page);
      await page.getByRole('button', { name: 'My server’s setup page' }).click();

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
      await expectFits(page, `claim pending at ${String(viewport.width)} px`);
      expect(requests, 'the claim sent something off the page').toEqual([]);
    });
  }
});

/**
 * #2856: on a device nobody has agreed anything on, *Scan a code* asks for the
 * camera where it was pressed, for the scan alone, and one yes reads the code.
 * The harness's `?fresh` is that device. What is measured is what jsdom
 * cannot: that no camera was asked for before the yes, that the question and
 * its two answers fit a 320 px window at a size a thumb can press, and that
 * the real decoder then reads the picture. Each run attaches a screenshot of
 * the question, for the owner to read the draft wording in place.
 */
test.describe('#2856 — a fresh device is asked in place, for the scan alone', () => {
  const STATEMENT =
    'The camera is used only to read this code, and it goes off as soon as the code is read or ' +
    'you close the scanner. No picture is kept or sent anywhere, and nothing on the Camera screen ' +
    'is switched on.';

  for (const viewport of VIEWPORTS) {
    const at = `${String(viewport.width)} px`;

    test(`asks before any camera is asked for, and one yes reads the code, at ${at}`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize(viewport);
      const requests = offPage(page);
      await open(page, '?fresh');
      await page.getByRole('button', { name: 'Scan a code' }).click();

      const statement = page.getByText(STATEMENT);
      await expect(statement).toBeVisible();
      const yes = page.getByRole('button', { name: 'Use the camera' });
      const no = page.getByRole('button', { name: 'Not now' });
      // It replaced the button pressed: it has the focus, and says what it is the yes to.
      await expect(yes).toBeFocused();
      await expect(yes).toHaveAccessibleDescription(STATEMENT);
      // The press alone asked the platform for no camera, and drew no picture.
      expect(await page.evaluate(() => window.__oylCardScan?.asked())).toBe(0);
      await expect(page.locator('video')).toHaveCount(0);

      const said = await statement.boundingBox();
      const yesBox = await yes.boundingBox();
      const noBox = await no.boundingBox();
      // Read first, then the yes, then the no, down the page, and all above the fold.
      expect(said!.y + said!.height, at).toBeLessThanOrEqual(yesBox!.y + 1);
      expect(yesBox!.y + yesBox!.height, at).toBeLessThanOrEqual(noBox!.y + 1);
      expect(noBox!.y + noBox!.height, at).toBeLessThanOrEqual(viewport.height);
      // The yes is as large as the button it replaced; the no is a full target.
      expect(yesBox!.height, at).toBeGreaterThanOrEqual(56);
      expect(noBox!.height, at).toBeGreaterThanOrEqual(TOUCH_TARGET_PIXELS);
      expect(noBox!.width, at).toBeGreaterThanOrEqual(TOUCH_TARGET_PIXELS);
      for (const box of [said!, yesBox!, noBox!]) {
        expect(box.x, at).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width, at).toBeLessThanOrEqual(viewport.width);
      }
      await expect(page.getByRole('button', { name: 'Paste a code instead' })).toBeVisible();
      await expectFits(page, `the scan’s question at ${at}`);
      await testInfo.attach(`scan-question-${String(viewport.width)}`, {
        body: await page.screenshot(),
        contentType: 'image/png',
      });

      await yes.click();
      await expect(
        page.getByRole('heading', { name: 'Where did this code come from?' }),
      ).toBeVisible();
      await expect(page.locator('video')).toHaveCount(0);
      expect(await page.evaluate(() => window.__oylCardScan?.tracks())).toEqual(['ended', 'ended']);
      expect(requests, 'the scan sent something off the page').toEqual([]);
    });
  }

  test('Not now asks for no camera, and the focus is back on Scan a code', async ({ page }) => {
    await open(page, '?fresh&blank');
    await page.getByRole('button', { name: 'Scan a code' }).click();
    await page.getByRole('button', { name: 'Not now' }).click();
    await expect(page.getByText(STATEMENT)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Scan a code' })).toBeFocused();
    expect(await page.evaluate(() => window.__oylCardScan?.asked())).toBe(0);
    // Asked again the next time, and one yes then opens the scanner.
    await page.getByRole('button', { name: 'Scan a code' }).click();
    await page.getByRole('button', { name: 'Use the camera' }).click();
    await expect(page.getByText('Looking for the card’s code…')).toBeVisible();
    await expect(page.locator('video')).toHaveCount(1);
  });
});
