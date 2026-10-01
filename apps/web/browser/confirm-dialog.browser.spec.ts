// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The confirmation before a ride is deleted — #950's Radix alert dialog, in a
 * real engine with the real keyboard.
 *
 * `design/ConfirmDialog.test.tsx` holds the focus trap in jsdom by delivering
 * the keydown Radix's `FocusScope` listens for; jsdom itself moves no focus on
 * Tab. Here the Tab key is Chromium's, so what is measured is what a keyboard
 * user gets: focus opens on the way out, stays inside while it is open — both
 * directions, and past the browser's own focus guards at the body's edges —
 * and goes back to the Delete that opened it. It also lays the dialog out at
 * the viewport WCAG 2.2 SC 1.4.10 names and reads its colours back as tokens
 * in both palettes, because `tailwind.css` is what draws it.
 *
 * It rides on `reflow.html` over the POPULATED fixture (forty rides), which
 * this gate already builds, so it costs no page of its own.
 *
 * ⚠️ **Its control** is the same five Tab presses with no dialog open, from
 * the same Delete: they must reach controls beyond it. Without that, a trap
 * that did nothing would still pass on any page whose only tab stops happened
 * to be the dialog's two buttons.
 */

import { expect, test, type Page } from '@playwright/test';

import { THEMES, paletteColours } from '../src/design/tokens';

import type { ReflowMeasurement } from './reflow-harness';

async function openActivities(page: Page, width: number, height: number): Promise<void> {
  await page.setViewportSize({ width, height });
  const response = await page.goto('/reflow.html?data=populated');
  expect(response?.status(), 'reflow.html did not load').toBe(200);
  await page.waitForFunction(() => window.__oylReflow?.ready === true);
  const seen: ReflowMeasurement | undefined = await page.evaluate(async () =>
    window.__oylReflow?.visit('#/activities'),
  );
  expect(seen?.routeId).toBe('activities');
}

/** The first ride's Delete, found by its words as a rider would find it. */
function firstDelete(page: Page) {
  return page.locator('main button', { hasText: /^Delete/ }).first();
}

/** What has focus, as text a failure message can name. */
async function focused(page: Page): Promise<string> {
  return page.evaluate(() => {
    const active = document.activeElement;
    if (active === null || active === document.body) return 'the page';
    const inDialog = active.closest('[role="alertdialog"]') !== null;
    return `${inDialog ? 'dialog: ' : 'outside: '}${(active.textContent ?? active.tagName).trim()}`;
  });
}

function hex(rgb: string): string {
  const [r, g, b] = (rgb.match(/\d+/g) ?? []).map(Number);
  return `#${[r, g, b].map((each) => (each ?? 0).toString(16).padStart(2, '0')).join('')}`;
}

test.describe('#950 — the delete confirmation is a real modal', () => {
  test('opens on Keep the ride, and Tab and Shift+Tab never leave it', async ({ page }) => {
    await openActivities(page, 1280, 800);
    const remove = firstDelete(page);
    await remove.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('alertdialog')).toBeVisible();
    expect(await focused(page)).toBe('dialog: Keep the ride');

    // Twice round in each direction: past the last button, through the body's
    // edge (Radix's focus guards, and the browser's own chrome if it were a
    // real window), and back.
    const forward: string[] = [];
    for (let press = 0; press < 5; press += 1) {
      await page.keyboard.press('Tab');
      forward.push(await focused(page));
    }
    expect(
      forward.every((each) => each.startsWith('dialog: ')),
      forward.join(' → '),
    ).toBe(true);
    expect(new Set(forward)).toEqual(new Set(['dialog: Keep the ride', 'dialog: Delete the ride']));

    const backward: string[] = [];
    for (let press = 0; press < 5; press += 1) {
      await page.keyboard.press('Shift+Tab');
      backward.push(await focused(page));
    }
    expect(
      backward.every((each) => each.startsWith('dialog: ')),
      backward.join(' → '),
    ).toBe(true);
  });

  test('control: the same presses from the list DO leave its controls', async ({ page }) => {
    // Without a dialog open, five Tabs from the first Delete reach the next
    // rows' controls — so the in-dialog assertions above are not true of any
    // page whose tab order happens to be short.
    await openActivities(page, 1280, 800);
    await firstDelete(page).focus();
    const seen = new Set<string>();
    for (let press = 0; press < 5; press += 1) {
      await page.keyboard.press('Tab');
      seen.add(await focused(page));
    }
    expect(seen.size).toBeGreaterThan(2);
    expect([...seen].some((each) => each.startsWith('dialog: '))).toBe(false);
  });

  test('Escape closes it, deletes nothing, and gives focus back to that Delete', async ({
    page,
  }) => {
    await openActivities(page, 1280, 800);
    const remove = firstDelete(page);
    const name = await remove.textContent();
    await remove.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('alertdialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    expect(await focused(page)).toBe(`outside: ${(name ?? '').trim()}`);
    await expect(firstDelete(page)).toHaveText(name ?? '');
  });

  test('fits a 320 × 256 phone: both answers reachable, nothing scrolls sideways', async ({
    page,
  }) => {
    await openActivities(page, 320, 256);
    await firstDelete(page).focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toBeVisible();
    const sideways = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(sideways, 'the page scrolls sideways with the dialog open').toBeLessThanOrEqual(0);
    for (const answer of ['Keep the ride', 'Delete the ride']) {
      const button = dialog.getByRole('button', { name: answer });
      await button.focus();
      await button.scrollIntoViewIfNeeded();
      const box = await button.boundingBox();
      expect(box, answer).not.toBeNull();
      expect(box?.x ?? -1).toBeGreaterThanOrEqual(0);
      expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(320);
      // And the dialog is above the page's chrome, the header included: what
      // is at the button's centre is the button.
      const topmost = await page.evaluate(
        ({ x, y }) => document.elementFromPoint(x, y)?.textContent?.trim() ?? '',
        { x: (box?.x ?? 0) + (box?.width ?? 0) / 2, y: (box?.y ?? 0) + (box?.height ?? 0) / 2 },
      );
      expect(topmost).toBe(answer);
    }
  });

  for (const theme of THEMES) {
    test(`is drawn in the ${theme} palette's tokens`, async ({ browser }) => {
      const context = await browser.newContext({ colorScheme: theme });
      const page = await context.newPage();
      try {
        await openActivities(page, 1280, 800);
        await firstDelete(page).focus();
        await page.keyboard.press('Enter');
        await expect(page.getByRole('alertdialog')).toBeVisible();
        const drawn = await page.evaluate(() => {
          const dialog = document.querySelector('[role="alertdialog"]');
          const overlay = dialog?.parentElement;
          const style = dialog === null ? undefined : getComputedStyle(dialog);
          return {
            theme: document.documentElement.dataset['theme'],
            surface: style?.backgroundColor ?? '',
            ink: style?.color ?? '',
            edge: style?.borderTopColor ?? '',
            overlay:
              overlay === null || overlay === undefined
                ? ''
                : getComputedStyle(overlay).backgroundColor,
          };
        });
        const colours = paletteColours(theme);
        expect(drawn.theme).toBe(theme);
        expect(hex(drawn.surface)).toBe(colours.canvas);
        expect(hex(drawn.ink)).toBe(colours.ink);
        expect(hex(drawn.edge)).toBe(colours.border);
        expect(hex(drawn.overlay)).toBe(colours.surfaceOverlay);
      } finally {
        await context.close();
      }
    });
  }
});
