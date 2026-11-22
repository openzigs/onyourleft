// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The ride HUD's junction prompt, through real layout — #2898.
 *
 * jsdom performs no layout, so a touch target is measured here
 * (`apps/web/CLAUDE.md`): on a tablet, at 1280×800 and upright, every way the
 * prompt draws and its U-turn are at least #94's 72 px each way
 * (`HudCore.tsx` §`CONTROL_MINIMUM_PIXELS`), wholly on the screen and clear of
 * the leaning rider, and a tap on a way changes which way is chosen. The
 * screenshots are attached to the run for the owner's 1280×800 check (#2898's
 * last criterion).
 *
 * ⚠️ **Not on a phone.** On a phone on its side (844×390) the prompt's second
 * row and its U-turn run below the stage, under *Pause* and *End ride*: what
 * gives way there, as a Delivery round's trainer line does (`theme.css` §"A
 * DELIVERY ROUND ON THE STAGE"), is a trade for the owner, recorded in
 * #2898's pull request and left to the ride that first mounts the prompt
 * (#2896). What it does not prove besides is
 * `junction-prompt-harness.tsx`'s: that stage has a world behind it.
 */

import { expect, test, type Page } from '@playwright/test';

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

const VIEWPORTS = [
  { name: 'a landscape tablet', width: 1280, height: 800 },
  { name: 'an upright tablet', width: 800, height: 1280 },
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
  await expect(page.locator('button[data-oyl-way]').first()).toBeVisible();
}

for (const viewport of VIEWPORTS) {
  test(`#2898 every way and the U-turn is a ride-time target on the screen — ${viewport.name}`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const stage = { ...viewport, unstagedFails: false };
    const rider = riderBox(stage);
    for (const ways of ['cross', 'tee'] as const) {
      await open(page, ways);
      const controls = page.locator('button[data-oyl-way], .oyl-hud__junction-u-turn');
      await expect(controls).toHaveCount(ways === 'cross' ? 4 : 3);
      const panel = page.locator('.oyl-hud__actions');
      for (const control of [...(await controls.all()), panel]) {
        const found = await control.boundingBox();
        const name = (await control.getAttribute('class')) ?? '';
        expect(found, name).not.toBeNull();
        const box: Box = {
          left: found?.x ?? 0,
          top: found?.y ?? 0,
          width: found?.width ?? 0,
          height: found?.height ?? 0,
          right: (found?.x ?? 0) + (found?.width ?? 0),
          bottom: (found?.y ?? 0) + (found?.height ?? 0),
        };
        if (control !== panel) {
          expect(box.width, `${name} wide`).toBeGreaterThanOrEqual(CONTROL_MINIMUM_PIXELS);
          expect(box.height, `${name} tall`).toBeGreaterThanOrEqual(CONTROL_MINIMUM_PIXELS);
        }
        expect(inside(box, stage), `${name} on the screen: ${JSON.stringify(box)}`).toBe(true);
        expect(
          overlap(box, rider),
          `${name} [${JSON.stringify(box)}] over the leaning rider [${JSON.stringify(rider)}]`,
        ).toBe(false);
      }
      const shot = await page.screenshot();
      await testInfo.attach(
        `junction-${ways}-${String(viewport.width)}x${String(viewport.height)}`,
        {
          body: shot,
          contentType: 'image/png',
        },
      );
    }
  });
}

test('#2898 a tap on a way chooses it, and the prompt says so', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await open(page, 'cross');
  const left = page.locator('button[data-oyl-way]').first();
  await expect(left).not.toContainText('Chosen');
  // A click is the same discrete press a tap is (ADR 0088 D-3.1.1).
  await left.click();
  await expect(left).toContainText('Chosen');
});
