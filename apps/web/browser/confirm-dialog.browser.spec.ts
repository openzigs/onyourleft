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

import { THEMES, paletteColours, type Theme } from '../src/design/tokens';

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
    // Radix moves focus in from an effect, which may run after the dialog is
    // already visible — so this waits for the focus it claims (#963).
    await expect.poll(() => focused(page)).toBe('dialog: Keep the ride');

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
    // ⚠️ Not a one-shot read (#963). Radix's `FocusScope` hands focus back in a
    // `setTimeout(0)` AFTER the dialog has left the DOM, so for a moment focus
    // is on the page's body: measured 3 to 50 ms on an idle Mac, and a read
    // straight after the dialog went failed 13 runs in 20 under CPU load. So
    // this waits for the one focus it claims — that Delete, outside the
    // dialog — and still fails if focus never comes back, or lands anywhere
    // else (#963's mutation: `ConfirmDialog` not calling `returnTo.focus()`).
    await expect
      .poll(() => focused(page), { message: 'focus did not go back to that Delete' })
      .toBe(`outside: ${(name ?? '').trim()}`);
    await expect(remove).toBeFocused();
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

  /*
   * #1002, the owner's ruling of 2026-10-02: the SAFE answer is the filled
   * primary and takes focus; the destructive one is `danger` — red-toned and
   * lighter than it. Read back from the engine in both palettes, with a
   * control that swaps the two kinds on the live elements and must fail.
   */
  for (const theme of THEMES) {
    test(`#1002 — Keep is the filled primary with focus, Delete is danger, in the ${theme} palette`, async ({
      browser,
    }) => {
      const context = await browser.newContext({ colorScheme: theme });
      const page = await context.newPage();
      try {
        await openDialog(page);
        await expect.poll(() => focused(page)).toBe('dialog: Keep the ride');
        const drawn = await readAnswers(page);
        expect(drawn.theme).toBe(theme);
        expect(asTokens(drawn.keep), 'Keep the ride').toEqual(expectedKeep(theme));
        expect(asTokens(drawn.remove), 'Delete the ride').toEqual(expectedDelete(theme));
        expect(asRuled(drawn, theme)).toBe(true);
        for (const answer of [drawn.keep, drawn.remove]) {
          expect(answer.width).toBeGreaterThanOrEqual(TOUCH_TARGET_PIXELS);
          expect(answer.height).toBeGreaterThanOrEqual(TOUCH_TARGET_PIXELS);
        }

        // Under a pointer the danger fills with its red, and its label is the red's ink.
        await page
          .getByRole('alertdialog')
          .getByRole('button', { name: 'Delete the ride' })
          .hover();
        await page.waitForTimeout(TRANSITION_WAIT_MS);
        const colours = paletteColours(theme);
        const hovered = (await readAnswers(page)).remove;
        expect(hex(hovered.background)).toBe(colours.dangerAction);
        expect(hex(hovered.color)).toBe(colours.dangerActionInk);
      } finally {
        await context.close();
      }
    });

    test(`#1002 control — the kinds swapped back as #996 drew them fail, in the ${theme} palette`, async ({
      browser,
    }) => {
      const context = await browser.newContext({ colorScheme: theme });
      const page = await context.newPage();
      try {
        await openDialog(page);
        await page.evaluate(() => {
          const [keep, remove] = [...document.querySelectorAll('[role="alertdialog"] button')];
          if (keep === undefined || remove === undefined) throw new Error('no answers');
          keep.className = 'oyl-button oyl-button--tertiary';
          remove.className = 'oyl-button';
        });
        await page.mouse.move(0, 0);
        await page.waitForTimeout(TRANSITION_WAIT_MS);
        expect(asRuled(await readAnswers(page), theme)).toBe(false);
      } finally {
        await context.close();
      }
    });
  }

  test('#1002 — under forced colours the danger keeps a dashed edge, and Keep a solid one', async ({
    browser,
  }) => {
    for (const forcedColors of ['active', 'none'] as const) {
      const context = await browser.newContext({ forcedColors });
      const page = await context.newPage();
      try {
        await openDialog(page);
        const drawn = await readAnswers(page);
        expect(drawn.keep.edge, `Keep, forced colours ${forcedColors}`).toBe('solid');
        // The control: without a forced palette the edge is solid, so the
        // dashed one is the forced-colours rule and nothing else.
        expect(drawn.remove.edge, `Delete, forced colours ${forcedColors}`).toBe(
          forcedColors === 'active' ? 'dashed' : 'solid',
        );
      } finally {
        await context.close();
      }
    }
  });
});

/** SC 2.5.5 (AAA), `.oyl-button`'s floor. */
const TOUCH_TARGET_PIXELS = 44;

/** The buttons' own transition is 120 ms; a read waits past it. */
const TRANSITION_WAIT_MS = 400;

async function openDialog(page: Page): Promise<void> {
  await openActivities(page, 1280, 800);
  await firstDelete(page).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('alertdialog')).toBeVisible();
  await page.mouse.move(0, 0);
  await page.waitForTimeout(TRANSITION_WAIT_MS);
}

interface Answer {
  readonly background: string;
  readonly color: string;
  readonly border: string;
  readonly edge: string;
  readonly width: number;
  readonly height: number;
}

interface Answers {
  readonly theme: string | undefined;
  readonly keep: Answer;
  readonly remove: Answer;
}

async function readAnswers(page: Page): Promise<Answers> {
  return page.evaluate(() => {
    const read = (name: string) => {
      const button = [...document.querySelectorAll('[role="alertdialog"] button')].find(
        (each) => (each.textContent ?? '').trim() === name,
      );
      if (button === undefined) throw new Error(`no “${name}” in the dialog`);
      const style = getComputedStyle(button);
      const box = button.getBoundingClientRect();
      return {
        background: style.backgroundColor,
        color: style.color,
        border: style.borderTopColor,
        edge: style.borderTopStyle,
        width: box.width,
        height: box.height,
      };
    };
    return {
      theme: document.documentElement.dataset['theme'],
      keep: read('Keep the ride'),
      remove: read('Delete the ride'),
    };
  });
}

function asTokens(answer: Answer) {
  return {
    background: hex(answer.background),
    color: hex(answer.color),
    border: hex(answer.border),
  };
}

function expectedKeep(theme: Theme) {
  const colours = paletteColours(theme);
  return { background: colours.accent, color: colours.accentInk, border: colours.accent };
}

function expectedDelete(theme: Theme) {
  const colours = paletteColours(theme);
  return {
    background: colours.dangerSurface,
    color: colours.dangerAction,
    border: colours.dangerAction,
  };
}

/** Whether the two answers are drawn as #1002 rules: Keep filled, Delete danger. */
function asRuled(drawn: Answers, theme: Theme): boolean {
  const same = (a: object, b: object): boolean => JSON.stringify(a) === JSON.stringify(b);
  return (
    same(asTokens(drawn.keep), expectedKeep(theme)) &&
    same(asTokens(drawn.remove), expectedDelete(theme))
  );
}
