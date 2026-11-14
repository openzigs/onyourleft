// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The Operate area (#2603), laid out in a real engine.
 *
 * `reflow.browser.spec.ts` already walks this route with every other; what is
 * measured HERE is the owner's own device and what that walk cannot say about
 * this screen in particular, on `reflow.html`'s populated fixture (the owner's
 * log — `instance/testing.ts` §`SCRIPTED_OPERATOR_LOG`: a refused entry whose
 * detail is as long and unbroken as the instance's grammar admits):
 *
 * - on the owner's tablet (1024×600), an upright phone (390×844) and at 320 px
 *   no box on the screen reaches past the viewport and the page does not
 *   scroll sideways, and every button is at least the project's 44 × 44
 *   target (`theme.css` §`.oyl-button`; `shell.browser.spec.ts`
 *   §`TOUCH_TARGET_PIXELS`);
 * - the Instance screen's *Operate this instance*, drawn for the owner, is a
 *   target of that size too;
 * - the route is not in the navigation, and an account that is not the owner
 *   gets no control on it but the way back.
 *
 * ## The control
 *
 * An entry's detail is drawn in `code`, which `theme.css` §`.oyl-main code`
 * lets break where it must. The same page with that rule deleted through the
 * CSSOM must scroll sideways at 320 px — the long detail is what does it.
 * Without that, a page that laid out nothing long, or a measurement read off
 * the wrong element, would pass.
 */

import { expect, test, type Page } from '@playwright/test';

import { hrefFor, routeById } from '../src/shell/routes';

import type { ReflowMeasurement } from './reflow-harness';

/** SC 2.5.5's 44 × 44 — `shell.browser.spec.ts` §`TOUCH_TARGET_PIXELS`, for its reason. */
const TOUCH_TARGET_PIXELS = 44;

const OPERATE = hrefFor(routeById('operate'));
const INSTANCE = hrefFor(routeById('instance'));

/** The owner's tablet in landscape, an upright phone, and the reflow floor. */
const VIEWPORTS = [
  [1024, 600],
  [390, 844],
  [320, 256],
] as const;

async function load(page: Page, data: 'empty' | 'populated', width: number, height: number) {
  await page.setViewportSize({ width, height });
  const response = await page.goto(`/reflow.html?data=${data}`);
  expect(response?.status(), 'reflow.html did not load').toBe(200);
  await page.waitForFunction(() => window.__oylReflow !== undefined);
  expect(await page.evaluate(() => window.__oylReflow?.errors)).toEqual([]);
}

async function visit(page: Page, hash: string): Promise<ReflowMeasurement> {
  const measured = await page.evaluate(async (to) => window.__oylReflow?.visit(to), hash);
  if (measured === undefined) throw new Error('the reflow harness published no measurement');
  return measured;
}

async function open(page: Page, data: 'empty' | 'populated', width = 320, height = 256) {
  await load(page, data, width, height);
  const measured = await visit(page, OPERATE);
  expect(measured.routeId).toBe('operate');
  expect(measured.h1).toBe('Operate');
  return measured;
}

/** Every button narrower or shorter than a target, and every box past the right edge, inside `main`. */
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
    for (const button of main.querySelectorAll('button, a.oyl-button')) {
      const box = button.getBoundingClientRect();
      if (box.width < target || box.height < target) {
        faults.push(`${button.textContent ?? ''} is ${String(box.width)} × ${String(box.height)}`);
      }
    }
    return faults;
  }, TOUCH_TARGET_PIXELS);
}

test.describe('the Operate area — #2603', () => {
  for (const [width, height] of VIEWPORTS) {
    test(`the owner’s log fits with no sideways scroll, and every button is a target, at ${String(width)}×${String(height)}`, async ({
      page,
    }) => {
      const measured = await open(page, 'populated', width, height);
      expect(measured.markerPresent, 'the owner’s log did not reach the view').toBe(true);
      expect(measured.documentOverflow).toBeLessThanOrEqual(0);
      expect(await layoutFaults(page)).toEqual([]);
      // A page of two, and the control for the next, both laid out.
      await expect(page.locator('main .oyl-operate__log > li')).toHaveCount(2);
      await expect(page.getByRole('button', { name: 'Show older entries' })).toHaveCount(1);
    });
  }

  for (const [width, height] of VIEWPORTS.slice(0, 2)) {
    test(`the Instance screen offers the owner Operate as a target, at ${String(width)}×${String(height)}`, async ({
      page,
    }) => {
      await load(page, 'populated', width, height);
      const measured = await visit(page, INSTANCE);
      expect(measured.routeId).toBe('instance');
      expect(measured.documentOverflow).toBeLessThanOrEqual(0);
      const link = page.getByRole('link', { name: 'Operate this instance' });
      await expect(link).toHaveAttribute('href', OPERATE);
      const box = await link.boundingBox();
      expect(box?.width ?? 0).toBeGreaterThanOrEqual(TOUCH_TARGET_PIXELS);
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(TOUCH_TARGET_PIXELS);
    });
  }

  test('is in no navigation, and gives an account that is not the owner only the way back', async ({
    page,
  }) => {
    await open(page, 'empty', 1024, 600);
    await expect(page.locator(`nav a[href="${OPERATE}"]`)).toHaveCount(0);
    await expect(page.locator('main button, main input')).toHaveCount(0);
    await expect(page.locator('main')).toContainText('not this instance’s owner');
    const instance = await visit(page, INSTANCE);
    expect(instance.routeId).toBe('instance');
    await expect(page.getByRole('link', { name: 'Operate this instance' })).toHaveCount(0);
  });

  test('CONTROL: without the rule that breaks a long code word, the page scrolls sideways at 320 px', async ({
    page,
  }) => {
    await open(page, 'populated');
    const deleted = await page.evaluate(() => {
      let count = 0;
      // Walked into every grouping rule, and out of a selector LIST: the
      // minifier merges this rule with any other that declares the same thing.
      const target = '.oyl-main code';
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
    expect(deleted, 'theme.css has no .oyl-main code rule to delete').toBe(1);
    const measured = await visit(page, OPERATE);
    expect(measured.documentOverflow).toBeGreaterThan(0);
  });
});
