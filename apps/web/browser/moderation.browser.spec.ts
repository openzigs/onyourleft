// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The Moderation screen (#955), laid out in a real engine.
 *
 * `reflow.browser.spec.ts` already walks this route with every other at three
 * viewports; what is measured HERE is what that walk cannot say about this
 * screen in particular, on `reflow.html`'s populated fixture (a moderator's
 * queues — `instance/testing.ts` §`scriptedModerationQueues`: a report whose
 * reason holds one word wider than a phone, and a report about the moderator):
 *
 * - at 320 px no box on the screen reaches past the viewport, the page does
 *   not scroll sideways, and every action is a 44 × 44 target (SC 2.5.5, as
 *   `shell.browser.spec.ts` §`TOUCH_TARGET_PIXELS` holds the rest);
 * - the report about the moderator (#905) carries no control at all;
 * - the route is not in the navigation, and an account that is not the
 *   moderator gets no control on it.
 *
 * ## The control
 *
 * The same page with `theme.css`'s `.oyl-moderation__list li` rule deleted
 * through the CSSOM must scroll sideways at 320 px — the long word in a
 * report's reason is what does it. Without that, a page that laid out nothing long, or a measurement read
 * off the wrong element, would pass.
 */

import { expect, test, type Page } from '@playwright/test';

import { hrefFor, routeById } from '../src/shell/routes';

import type { ReflowMeasurement } from './reflow-harness';

/** SC 2.5.5's 44 × 44 — `shell.browser.spec.ts` §`TOUCH_TARGET_PIXELS`, for its reason. */
const TOUCH_TARGET_PIXELS = 44;

const MODERATION = hrefFor(routeById('moderation'));

async function open(page: Page, data: 'empty' | 'populated', width = 320, height = 256) {
  await page.setViewportSize({ width, height });
  const response = await page.goto(`/reflow.html?data=${data}`);
  expect(response?.status(), 'reflow.html did not load').toBe(200);
  await page.waitForFunction(() => window.__oylReflow !== undefined);
  expect(await page.evaluate(() => window.__oylReflow?.errors)).toEqual([]);
  return visit(page);
}

async function visit(page: Page): Promise<ReflowMeasurement> {
  const measured = await page.evaluate(async (hash) => window.__oylReflow?.visit(hash), MODERATION);
  if (measured === undefined) throw new Error('the reflow harness published no measurement');
  expect(measured.routeId).toBe('moderation');
  expect(measured.h1).toBe('Moderation');
  return measured;
}

/** Every button and box inside `main` narrower or shorter than a target, and every box past the right edge. */
async function layoutFaults(page: Page): Promise<string[]> {
  return page.evaluate((target) => {
    const faults: string[] = [];
    const main = document.querySelector('main');
    if (main === null) return ['no main'];
    for (const element of main.querySelectorAll('*')) {
      const box = element.getBoundingClientRect();
      if (box.width > 0 && box.right > window.innerWidth + 0.5) {
        faults.push(`${element.tagName.toLowerCase()} reaches ${String(box.right)} px`);
      }
    }
    for (const button of main.querySelectorAll('button')) {
      const box = button.getBoundingClientRect();
      if (box.width < target || box.height < target) {
        faults.push(`${button.textContent ?? ''} is ${String(box.width)} × ${String(box.height)}`);
      }
    }
    return faults;
  }, TOUCH_TARGET_PIXELS);
}

test.describe('the Moderation screen — #955', () => {
  for (const [width, height] of [
    [320, 256],
    [390, 844],
  ] as const) {
    test(`a moderator’s queues reflow, and every action is a target, at ${String(width)}×${String(height)}`, async ({
      page,
    }) => {
      const measured = await open(page, 'populated', width, height);
      expect(measured.markerPresent, 'the moderator’s queues did not reach the view').toBe(true);
      expect(measured.documentOverflow).toBeLessThanOrEqual(0);
      expect(await layoutFaults(page)).toEqual([]);
      expect(await page.locator('main button').count()).toBeGreaterThan(0);
    });
  }

  test('the report about the moderator is a conflict with no control on it — #905', async ({
    page,
  }) => {
    await open(page, 'populated');
    const conflict = page
      .locator('main li')
      .filter({ has: page.getByRole('heading', { name: 'Report 8' }) });
    await expect(conflict).toContainText('it is a conflict');
    await expect(conflict.locator('button, input')).toHaveCount(0);
    const decidable = page
      .locator('main li')
      .filter({ has: page.getByRole('heading', { name: 'Report 7' }) });
    await expect(decidable.getByRole('button', { name: 'Dismiss' })).toHaveCount(1);
  });

  test('is in no navigation, and gives an account that is not the moderator no control', async ({
    page,
  }) => {
    await open(page, 'empty', 390, 844);
    await expect(page.locator(`nav a[href="${MODERATION}"]`)).toHaveCount(0);
    await expect(page.locator('main button, main input')).toHaveCount(0);
    await expect(page.locator('main')).toContainText('not a moderator');
  });

  test('CONTROL: without the rule that breaks a long word, the page scrolls sideways at 320 px', async ({
    page,
  }) => {
    await open(page, 'populated');
    const deleted = await page.evaluate(() => {
      let count = 0;
      // Walked into every grouping rule, and out of a selector LIST: the
      // minifier merges this rule with any other that declares the same thing
      // (the Connect screen's), so the selector is taken out of the list.
      const target = '.oyl-moderation__list li';
      const walk = (holder: CSSStyleSheet | CSSGroupingRule): void => {
        const rules = holder.cssRules;
        for (let index = rules.length - 1; index >= 0; index -= 1) {
          const rule = rules[index];
          if (rule instanceof CSSStyleRule) {
            const selectors = rule.selectorText.split(',').map((each) => each.trim());
            if (!selectors.includes(target)) continue;
            const rest = selectors.filter((each) => each !== target);
            if (rest.length === 0) holder.deleteRule(index);
            else rule.selectorText = rest.join(', ');
            count += 1;
          } else if (rule instanceof CSSGroupingRule) {
            walk(rule);
          }
        }
      };
      for (const sheet of document.styleSheets) walk(sheet);
      return count;
    });
    expect(deleted, 'theme.css has no .oyl-moderation__list li rule to delete').toBe(1);
    const measured = await visit(page);
    expect(measured.documentOverflow).toBeGreaterThan(0);
  });
});
