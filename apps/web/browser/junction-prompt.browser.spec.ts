// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The ride HUD's junction pop-up, through real layout — #2898, #3053.
 *
 * jsdom performs no layout, so a touch target is measured here
 * (`apps/web/CLAUDE.md`): on a tablet, at 1280×800 and upright, every way the
 * pop-up draws and the U-turn are at least #94's 72 px each way
 * (`HudCore.tsx` §`CONTROL_MINIMUM_PIXELS`), wholly on the screen and clear of
 * the leaning rider, and a tap on a way changes which way is chosen.
 *
 * #3053: the pop-up is in the upper middle of the view, over no panel and over
 * no part of the rider (`theme.css` §"#3053"), and the controls' fade never
 * reaches it: with no touch for longer than `CONTROLS_HIDE_MILLISECONDS`, every
 * way is still drawn at full ink, is what a finger at its middle lands on, and
 * takes that first tap. The screenshots are attached to the run for the
 * owner's check on #733.
 *
 * ⚠️ **Not on a phone, nor on a 4:3 tablet.** Measured once in this harness
 * for #3053's pull request: on a phone on its side (844×390) the pop-up is
 * drawn over the top panels' readings while it is up, upright (390×844) over
 * the route panel, and at 1024×768 over the secondary panel's last 14 px. It
 * is clear of the rider at all three. Which gives way there is a trade for the
 * owner, recorded on that pull request. What it does not prove
 * besides is `junction-prompt-harness.tsx`'s: that stage has no world behind it.
 */

import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';

import { HARNESS_ORIGIN } from '../playwright.config';
import type { Box } from './ride-harness';
import { inside, overlap, riderBox } from './ride-stage';

declare global {
  interface Window {
    __oylJunction?: { readonly ready: boolean; readonly errors: readonly string[] };
  }
}

/** #94's floor for a gloved rider on a moving bike, mirrored from `HudCore.tsx`. */
const CONTROL_MINIMUM_PIXELS = 72;

/** `controls-reveal.ts` §`CONTROLS_HIDE_MILLISECONDS`, mirrored. */
const CONTROLS_HIDE_MILLISECONDS = 5_000;

const VIEWPORTS = [
  { name: 'a landscape tablet', width: 1280, height: 800 },
  { name: 'an upright tablet', width: 800, height: 1280 },
] as const;

/** The HUD's panels: what the pop-up is drawn clear of on a tablet. */
const PANELS = [
  '.oyl-hud__fields--primary',
  '.oyl-hud__fields--secondary',
  '.oyl-hud__route',
  '.oyl-hud__actions',
] as const;

async function open(page: Page, ways: 'cross' | 'tee'): Promise<void> {
  const response = await page.goto(`${HARNESS_ORIGIN}/junction-prompt.html?ways=${ways}`);
  if (response === null || !response.ok()) {
    throw new Error(
      `junction-prompt.html did not load (${String(response?.status())}). Is it named in ` +
        `vite.browser.config.ts's build.rollupOptions.input?`,
    );
  }
  await page.waitForFunction(() => window.__oylJunction !== undefined);
  const published = await page.evaluate(() => window.__oylJunction);
  if (published === undefined || !published.ready) {
    throw new Error(`the harness did not become ready: ${published?.errors.join('; ') ?? ''}`);
  }
  await expect(popupWays(page).first()).toBeVisible();
  // It grows to its size as it appears (`theme.css` §"#3053"): measured once it has.
  await page
    .locator('.oyl-hud__junction-popup')
    .evaluate((element) => Promise.all(element.getAnimations().map((each) => each.finished)));
}

/** The pop-up's ways. */
function popupWays(page: Page): Locator {
  return page.locator('.oyl-hud__junction-popup button[data-oyl-way]');
}

/**
 * A screenshot for the owner, attached to the run and kept as a file in the
 * test's output directory (`playwright.config.ts` §`outputDir`), where a
 * local run of this spec leaves it.
 */
async function shoot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const path = testInfo.outputPath(`${name}.png`);
  // Every finite animation run to its end, the controls' fade too: under the
  // installed clock the page's own animations do not advance.
  await page.screenshot({ path, animations: 'disabled' });
  await testInfo.attach(name, { path, contentType: 'image/png' });
}

async function boxOf(control: Locator): Promise<Box> {
  const found = await control.boundingBox();
  expect(found).not.toBeNull();
  return {
    left: found?.x ?? 0,
    top: found?.y ?? 0,
    width: found?.width ?? 0,
    height: found?.height ?? 0,
    right: (found?.x ?? 0) + (found?.width ?? 0),
    bottom: (found?.y ?? 0) + (found?.height ?? 0),
  };
}

for (const viewport of VIEWPORTS) {
  test(`#2898 #3053 every way and the U-turn is a ride-time target on the screen, the pop-up clear of the rider and the panels — ${viewport.name}`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const stage = { ...viewport, unstagedFails: false };
    const rider = riderBox(stage);
    for (const ways of ['cross', 'tee'] as const) {
      await open(page, ways);
      await expect(popupWays(page)).toHaveCount(ways === 'cross' ? 3 : 2);
      const uTurn = page.locator('.oyl-hud__junction-u-turn');
      await expect(uTurn).toHaveCount(1);
      const popup = page.locator('.oyl-hud__junction-popup');
      for (const control of [...(await popupWays(page).all()), uTurn, popup]) {
        const box = await boxOf(control);
        const name = (await control.getAttribute('class')) ?? '';
        if (control !== popup) {
          expect(box.width, `${name} wide`).toBeGreaterThanOrEqual(CONTROL_MINIMUM_PIXELS);
          expect(box.height, `${name} tall`).toBeGreaterThanOrEqual(CONTROL_MINIMUM_PIXELS);
        }
        expect(inside(box, stage), `${name} on the screen: ${JSON.stringify(box)}`).toBe(true);
        expect(
          overlap(box, rider),
          `${name} [${JSON.stringify(box)}] over the leaning rider [${JSON.stringify(rider)}]`,
        ).toBe(false);
      }
      // The pop-up is over no panel at the tablet's sizes, and in their upper half.
      const drawn = await boxOf(popup);
      expect(drawn.bottom, 'the pop-up in the upper half').toBeLessThanOrEqual(viewport.height / 2);
      for (const selector of PANELS) {
        const panel = page.locator(selector);
        if ((await panel.count()) === 0) continue;
        const box = await boxOf(panel.first());
        expect(
          overlap(drawn, box),
          `the pop-up [${JSON.stringify(drawn)}] over ${selector} [${JSON.stringify(box)}]`,
        ).toBe(false);
      }
      await shoot(
        page,
        testInfo,
        `junction-${ways}-${String(viewport.width)}x${String(viewport.height)}`,
      );
    }
  });
}

test('#2898 a tap on a way chooses it, and the prompt says so', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await open(page, 'cross');
  const left = popupWays(page).first();
  await expect(left).not.toContainText('Chosen');
  // A click is the same discrete press a tap is (ADR 0088 D-3.1.1).
  await left.click();
  await expect(left).toContainText('Chosen');
});

test('#3053 with no touch for longer than the fade, the pop-up is drawn whole and takes the first tap', async ({
  page,
}, testInfo) => {
  await page.clock.install();
  await page.setViewportSize({ width: 1280, height: 800 });
  await open(page, 'cross');
  await page.clock.runFor(CONTROLS_HIDE_MILLISECONDS + 1_000);
  await expect(page.locator('.oyl-hud')).toHaveAttribute('data-oyl-controls', 'hidden');
  // Run the controls' fade and the panel's closing to their ends: under the
  // installed clock the page's animations do not advance by themselves.
  await page.evaluate(() => {
    for (const each of document.getAnimations()) each.finish();
  });
  // The opacity an element is drawn at: its own, times every ancestor's.
  const drawnAt = (control: Locator): Promise<number> =>
    control.evaluate((element) => {
      let product = 1;
      for (let at: Element | null = element; at !== null; at = at.parentElement) {
        product *= Number(getComputedStyle(at).opacity);
      }
      return product;
    });
  // The control: Pause, which hides, is faded out on this page.
  expect(await drawnAt(page.locator('.oyl-hud__controls button').first())).toBe(0);
  for (const way of await popupWays(page).all()) {
    // Drawn at full ink, and what a finger at its middle lands on.
    expect(await drawnAt(way)).toBe(1);
    const box = await boxOf(way);
    const hit = await page.evaluate(
      ({ x, y }) => document.elementFromPoint(x, y)?.closest('button')?.dataset['oylWay'] ?? null,
      { x: box.left + box.width / 2, y: box.top + box.height / 2 },
    );
    expect(hit).toBe(await way.getAttribute('data-oyl-way'));
  }
  await shoot(page, testInfo, 'junction-controls-hidden-1280x800');
  // The first tap, with the controls hidden, takes the way.
  const left = popupWays(page).first();
  await expect(left).not.toContainText('Chosen');
  await left.click();
  await expect(left).toContainText('Chosen');
});
