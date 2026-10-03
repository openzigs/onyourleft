// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The menus' game-style controls, as the pinned Chromium draws them — #994.
 *
 * jsdom performs no layout and no cascade, so the unit suites can say what
 * each control IS (a checkbox with the switch role, a radio group, a box with
 * − and + beside it, a file input inside a drop zone) and nothing about what it
 * is DRAWN as. This reads the real shell over the reflow harness's POPULATED
 * ports (`reflow.html`):
 *
 * - **the section tabs** — segmented, a 44 px target, and the current page
 *   told by more than colour (a fill, a weight AND an underline);
 * - **every switch** — a 44 × 24 track in a 44 px row, and under forced
 *   colours handed back to the platform;
 * - **every step button** — a 44 × 44 target, and a press that moves the box;
 * - **the riding position's segments** — each a 44 px target;
 * - **a drop zone** — drawn on a tablet, not on a phone, and a file dropped
 *   on it reaches the input.
 *
 * Every 44 px claim is measured the #316 three ways: the shipped box, the
 * declaration, and the box with its floor stripped, which must FALL SHORT —
 * without that last one a box that happens to be tall enough reads exactly
 * like one that is held there.
 *
 * ## The controls
 *
 * The section tab's `[aria-current]` rule is deleted through the CSSOM and the
 * current tab must then be indistinguishable from the others; the switch's
 * forced-colours rule is deleted and the switch must then stay drawn by us.
 */

import { expect, test, type Page } from '@playwright/test';

import { hrefFor, routeById } from '../src/shell/routes';

const TARGET = 44;
const PHONE = { width: 390, height: 844 };
const TABLET = { width: 1280, height: 800 };

async function open(page: Page, viewport: { width: number; height: number }): Promise<void> {
  await page.setViewportSize(viewport);
  const response = await page.goto('/reflow.html?data=populated');
  expect(response?.status(), 'reflow.html did not load').toBe(200);
  await page.waitForFunction(() => window.__oylReflow?.ready === true);
}

async function visit(page: Page, id: Parameters<typeof routeById>[0]): Promise<void> {
  const hash = hrefFor(routeById(id));
  const seen = await page.evaluate(async (target) => window.__oylReflow?.visit(target), hash);
  expect(seen?.routeId, `${id} did not render`).toBe(id);
}

/**
 * The #316 three ways, for every element `selector` finds: its shipped
 * height (and width, when `square`), its declared floor, and its height with
 * that floor stripped through an inline style.
 */
async function threeWays(
  page: Page,
  selector: string,
  floor: { readonly height: string; readonly width?: string },
): Promise<{
  readonly count: number;
  readonly shipped: { readonly width: number; readonly height: number }[];
  readonly declared: string[];
  readonly stripped: number[];
}> {
  return page.evaluate(
    ({ selector, floor }) => {
      const elements = [...document.querySelectorAll<HTMLElement>(selector)].filter((each) =>
        each.checkVisibility(),
      );
      const shipped = elements.map((each) => {
        const box = each.getBoundingClientRect();
        return { width: box.width, height: box.height };
      });
      const declared = elements.map((each) =>
        String(getComputedStyle(each).getPropertyValue(floor.height)),
      );
      // All at once: a row of segments stretches each one to the tallest, so
      // one stripped beside floored siblings would still be held up by them.
      for (const each of elements) {
        each.style.setProperty(floor.height, '0');
        if (floor.width !== undefined) each.style.setProperty(floor.width, '0');
      }
      const stripped = elements.map((each) => each.getBoundingClientRect().height);
      for (const each of elements) {
        each.style.removeProperty(floor.height);
        if (floor.width !== undefined) each.style.removeProperty(floor.width);
      }
      return { count: elements.length, shipped, declared, stripped };
    },
    { selector, floor },
  );
}

test.describe('#994 — the section tabs', () => {
  for (const viewport of [PHONE, TABLET]) {
    test(`are segmented 44 px targets at ${String(viewport.width)}×${String(viewport.height)}`, async ({
      page,
    }) => {
      await open(page, viewport);
      await visit(page, 'activities');
      const tabs = await threeWays(page, '.oyl-subnav-link', { height: 'min-height' });
      expect(tabs.count, 'no section tab on Activities').toBeGreaterThan(1);
      for (const box of tabs.shipped) expect(box.height).toBeGreaterThanOrEqual(TARGET);
      expect(new Set(tabs.declared)).toEqual(new Set([`${String(TARGET)}px`]));
      for (const height of tabs.stripped) expect(height).toBeLessThan(TARGET);
    });
  }

  async function tabLooks(page: Page) {
    return page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('.oyl-subnav-link')].map((tab) => {
        const style = getComputedStyle(tab);
        return {
          current: tab.getAttribute('aria-current') === 'page',
          background: style.backgroundColor,
          weight: style.fontWeight,
          underline: style.textDecorationLine,
          borderStyle: style.borderTopStyle,
        };
      }),
    );
  }

  test('tell the current page by a fill, a weight and an underline, not by colour alone', async ({
    page,
  }) => {
    await open(page, PHONE);
    await visit(page, 'activities');
    const looks = await tabLooks(page);
    const current = looks.filter((look) => look.current);
    const others = looks.filter((look) => !look.current);
    expect(current).toHaveLength(1);
    expect(others.length).toBeGreaterThan(0);
    for (const other of others) {
      expect(current[0]?.background).not.toBe(other.background);
      expect(Number(current[0]?.weight)).toBeGreaterThan(Number(other.weight));
      expect(other.underline).toBe('none');
    }
    expect(current[0]?.underline).toContain('underline');
  });

  test('keep the underline and gain a doubled edge under forced colours', async ({ page }) => {
    await open(page, PHONE);
    await page.emulateMedia({ forcedColors: 'active' });
    await visit(page, 'activities');
    const current = (await tabLooks(page)).find((look) => look.current);
    expect(current?.underline).toContain('underline');
    expect(current?.borderStyle).toBe('double');
  });

  test('control: without the current-page rule the current tab is like the rest', async ({
    page,
  }) => {
    await open(page, PHONE);
    await visit(page, 'activities');
    const deleted = await page.evaluate(() => {
      let count = 0;
      for (const sheet of document.styleSheets) {
        const rules = sheet.cssRules;
        for (let index = rules.length - 1; index >= 0; index -= 1) {
          const rule = rules[index];
          if (
            rule instanceof CSSStyleRule &&
            rule.selectorText === ".oyl-subnav-link[aria-current='page']".replace(/'/g, '"')
          ) {
            sheet.deleteRule(index);
            count += 1;
          }
        }
      }
      return count;
    });
    expect(deleted, 'the current-page rule was not found to delete').toBe(1);
    const looks = await tabLooks(page);
    const current = looks.find((look) => look.current);
    const other = looks.find((look) => !look.current);
    expect(current?.background).toBe(other?.background);
    expect(current?.weight).toBe(other?.weight);
    expect(current?.underline).toBe(other?.underline);
  });
});

test.describe('#994 — switches', () => {
  async function switches(page: Page) {
    return page.evaluate(() =>
      [...document.querySelectorAll<HTMLInputElement>('main input[role="switch"]')]
        .filter((each) => each.checkVisibility())
        .map((each) => {
          const box = each.getBoundingClientRect();
          const row = each.closest('label') ?? each.labels?.[0] ?? null;
          return {
            type: each.type,
            appearance: getComputedStyle(each).appearance,
            width: box.width,
            height: box.height,
            row: row?.getBoundingClientRect().height ?? 0,
          };
        }),
    );
  }

  test('every switch on Settings is a 44 × 24 track in a 44 px row', async ({ page }) => {
    await open(page, PHONE);
    await visit(page, 'settings');
    const seen = await switches(page);
    expect(seen.length, 'no switch on Settings').toBeGreaterThanOrEqual(3);
    for (const each of seen) {
      expect(each.type).toBe('checkbox');
      expect(each.appearance).toBe('none');
      expect(each.width).toBe(TARGET);
      expect(each.height).toBe(24);
      expect(each.row).toBeGreaterThanOrEqual(TARGET);
    }
    // The engine's own accessibility tree says "switch", which is the point.
    await expect(
      page.getByRole('switch', { name: 'Announce the ride to a screen reader' }),
    ).toHaveCount(1);
  });

  test('a press turns a switch on, and the state is drawn by the thumb moving', async ({
    page,
  }) => {
    await open(page, PHONE);
    await visit(page, 'settings');
    const control = page.getByRole('switch', { name: 'Announce the ride to a screen reader' });
    const before = await control.evaluate((each) => getComputedStyle(each).backgroundImage);
    await control.click();
    await expect(control).toBeChecked();
    const after = await control.evaluate((each) => getComputedStyle(each).backgroundImage);
    expect(after).not.toBe(before);
  });

  test('is handed back to the platform under forced colours', async ({ page }) => {
    await open(page, PHONE);
    await page.emulateMedia({ forcedColors: 'active' });
    await visit(page, 'settings');
    for (const each of await switches(page)) expect(each.appearance).toBe('auto');
  });

  test('control: without the forced-colours rule the switch stays drawn by us', async ({
    page,
  }) => {
    await open(page, PHONE);
    await page.emulateMedia({ forcedColors: 'active' });
    await visit(page, 'settings');
    const deleted = await page.evaluate(() => {
      let count = 0;
      for (const sheet of document.styleSheets) {
        for (const media of [...sheet.cssRules]) {
          if (!(media instanceof CSSMediaRule) || !media.conditionText.includes('forced-colors')) {
            continue;
          }
          for (let index = media.cssRules.length - 1; index >= 0; index -= 1) {
            const rule = media.cssRules[index];
            if (rule instanceof CSSStyleRule && rule.selectorText.includes('role="switch"')) {
              media.deleteRule(index);
              count += 1;
            }
          }
        }
      }
      return count;
    });
    expect(deleted).toBe(1);
    for (const each of await switches(page)) expect(each.appearance).toBe('none');
  });
});

test.describe('#994 — steppers', () => {
  test('every step button on Settings is a 44 × 44 target, measured three ways', async ({
    page,
  }) => {
    await open(page, PHONE);
    await visit(page, 'settings');
    const steps = await threeWays(page, '.oyl-stepper__step', {
      height: 'min-block-size',
      width: 'min-inline-size',
    });
    expect(steps.count, 'no step button on Settings').toBeGreaterThanOrEqual(2);
    for (const box of steps.shipped) {
      expect(box.height).toBeGreaterThanOrEqual(TARGET);
      expect(box.width).toBeGreaterThanOrEqual(TARGET);
    }
    expect(new Set(steps.declared)).toEqual(new Set([`${String(TARGET)}px`]));
    for (const height of steps.stripped) expect(height).toBeLessThan(TARGET);
  });

  test('a press on + moves the weight box, which still takes typing', async ({ page }) => {
    await open(page, PHONE);
    await visit(page, 'settings');
    const box = page.locator('#oyl-rider-mass');
    await box.fill('62');
    await page.getByRole('button', { name: 'Increase weight' }).click();
    await expect(box).toHaveValue('62.5');
    await page.getByRole('button', { name: 'Decrease weight' }).click();
    await page.getByRole('button', { name: 'Decrease weight' }).click();
    await expect(box).toHaveValue('61.5');
  });
});

test.describe('#994 — the riding position', () => {
  test('is three segments, each a 44 px target measured three ways', async ({ page }) => {
    await open(page, PHONE);
    await visit(page, 'game');
    const segments = await threeWays(page, '.oyl-game__position label', {
      height: 'min-height',
    });
    expect(segments.count).toBe(3);
    for (const box of segments.shipped) expect(box.height).toBeGreaterThanOrEqual(TARGET);
    expect(new Set(segments.declared)).toEqual(new Set([`${String(TARGET)}px`]));
    for (const height of segments.stripped) expect(height).toBeLessThan(TARGET);
  });
});

test.describe('#994 — drop zones', () => {
  async function zone(page: Page) {
    return page.evaluate(() => {
      const found = document.querySelector<HTMLElement>('main .oyl-drop');
      const hint = found?.querySelector<HTMLElement>('.oyl-drop__hint');
      return {
        border: found === null || found === undefined ? '' : getComputedStyle(found).borderTopStyle,
        hintShown: hint?.checkVisibility() ?? false,
      };
    });
  }

  test('is drawn on a tablet, and is nothing on a phone, which has nothing to drag', async ({
    page,
  }) => {
    await open(page, TABLET);
    await visit(page, 'routes');
    expect(await zone(page)).toEqual({ border: 'dashed', hintShown: true });
    await page.setViewportSize(PHONE);
    expect(await zone(page)).toEqual({ border: 'none', hintShown: false });
  });

  test('hands a dropped file to the input, as though it was chosen', async ({ page }) => {
    await open(page, TABLET);
    await visit(page, 'routes');
    const chosen = await page.evaluate(() => {
      const target = document.querySelector('main .oyl-drop');
      const transfer = new DataTransfer();
      transfer.items.add(new File(['<gpx/>'], 'circuit.gpx', { type: 'application/gpx+xml' }));
      for (const type of ['dragenter', 'dragover', 'drop']) {
        target?.dispatchEvent(
          new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: transfer }),
        );
      }
      const input = target?.querySelector<HTMLInputElement>('input[type="file"]');
      return [...(input?.files ?? [])].map((file) => file.name);
    });
    expect(chosen).toEqual(['circuit.gpx']);
  });

  test('hands a single-file input only the first of several dropped files, as its picker would', async ({
    page,
  }) => {
    await open(page, TABLET);
    await visit(page, 'routes');
    const chosen = await page.evaluate(() => {
      const target = document.querySelector('main .oyl-drop');
      const transfer = new DataTransfer();
      for (const name of ['first.gpx', 'second.gpx']) {
        transfer.items.add(new File(['<gpx/>'], name, { type: 'application/gpx+xml' }));
      }
      target?.dispatchEvent(
        new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }),
      );
      const input = target?.querySelector<HTMLInputElement>('input[type="file"]');
      return { multiple: input?.multiple, names: [...(input?.files ?? [])].map((f) => f.name) };
    });
    expect(chosen).toEqual({ multiple: false, names: ['first.gpx'] });
  });
});

test.describe('#1030 — a file input drawn as a button, with what was chosen as a chip', () => {
  /** The Routes import's picker, as drawn: what the eye sees and what a press lands on. */
  async function picker(page: Page) {
    return page.evaluate(() => {
      const input = document.querySelector<HTMLInputElement>('main #route-file');
      const button = input?.parentElement?.querySelector<HTMLElement>('.oyl-file__button');
      if (input === null || input === undefined || button === null || button === undefined) {
        return undefined;
      }
      // In the middle of the viewport, clear of a phone's bottom navigation:
      // a point outside the viewport hit-tests nothing.
      button.scrollIntoView({ block: 'center' });
      const inputBox = input.getBoundingClientRect();
      const buttonBox = button.getBoundingClientRect();
      const centreX = buttonBox.left + buttonBox.width / 2;
      const centreY = buttonBox.top + buttonBox.height / 2;
      return {
        inputOpacity: getComputedStyle(input).opacity,
        buttonShown: button.checkVisibility(),
        buttonWords: button.textContent,
        buttonBackground: getComputedStyle(button).backgroundColor,
        pressLandsOnInput: document.elementFromPoint(centreX, centreY) === input,
        inputCoversButton:
          Math.abs(inputBox.left - buttonBox.left) <= 1 &&
          Math.abs(inputBox.top - buttonBox.top) <= 1 &&
          inputBox.width + 1 >= buttonBox.width &&
          inputBox.height + 1 >= buttonBox.height,
        height: buttonBox.height,
      };
    });
  }

  for (const viewport of [PHONE, TABLET]) {
    test(`hides the browser's own picker and draws a button the input covers at ${String(viewport.width)}×${String(viewport.height)}`, async ({
      page,
    }) => {
      await open(page, viewport);
      await visit(page, 'routes');
      const drawn = await picker(page);
      expect(drawn, 'no file picker on Routes').toBeDefined();
      expect(drawn?.inputOpacity).toBe('0');
      expect(drawn?.buttonShown).toBe(true);
      expect(drawn?.buttonWords).toBe('Choose file');
      expect(drawn?.buttonBackground).not.toBe('rgba(0, 0, 0, 0)');
      expect(drawn?.pressLandsOnInput).toBe(true);
      expect(drawn?.inputCoversButton).toBe(true);
      expect(drawn?.height).toBeGreaterThanOrEqual(TARGET);
    });
  }

  test('is a 44 px target that the floor holds up, the #316 three ways', async ({ page }) => {
    await open(page, PHONE);
    await visit(page, 'routes');
    // The input is out of the flow, so the button is the box a press lands in:
    // its floor stripped, the input must shrink with it.
    const measured = await page.evaluate(() => {
      const button = document.querySelector<HTMLElement>('main .oyl-file__button');
      const input = document.querySelector<HTMLElement>('main .oyl-file__input');
      const shipped = input?.getBoundingClientRect().height ?? 0;
      const declared = button === null ? '' : getComputedStyle(button).minHeight;
      button?.style.setProperty('min-height', '0');
      const stripped = input?.getBoundingClientRect().height ?? 0;
      button?.style.removeProperty('min-height');
      return { shipped, declared, stripped };
    });
    expect(measured.shipped).toBeGreaterThanOrEqual(TARGET);
    expect(measured.declared).toBe(`${String(TARGET)}px`);
    expect(measured.stripped).toBeLessThan(TARGET);
  });

  test('a press on the button is a trusted press on the input', async ({ page }) => {
    await open(page, PHONE);
    await visit(page, 'routes');
    // A real pointer press at the BUTTON's centre, not a click on an element:
    // what is under that point is what takes it. What is asserted is that the
    // INPUT receives a trusted click there, which is what opens the platform's
    // picker. Waiting for Playwright's `filechooser` instead passed on a Mac
    // and timed out twice on the Linux runner (runs 37083214238, 37085293517)
    // with the hit-test above green, so it is not the claim this case makes.
    const button = page.locator('main .oyl-file__button').first();
    await button.evaluate((element) => {
      element.scrollIntoView({ block: 'center' });
      const input = element.parentElement?.querySelector('input');
      input?.addEventListener(
        'click',
        (event) => {
          event.preventDefault();
          document.body.dataset['oylFileClick'] = event.isTrusted ? 'trusted' : 'synthetic';
        },
        { once: true },
      );
    });
    const box = await button.boundingBox();
    if (box === null) throw new Error('the button has no box');
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    expect(await page.evaluate(() => document.body.dataset['oylFileClick'])).toBe('trusted');
  });

  test('draws the input’s keyboard focus on the button, and not without its rule', async ({
    page,
  }) => {
    await open(page, PHONE);
    await visit(page, 'routes');
    const ring = async (): Promise<string> => {
      await page.keyboard.press('Shift');
      await page.locator('main #route-file').focus();
      return page.evaluate(() => {
        const button = document.querySelector<HTMLElement>('main #route-file + .oyl-file__button');
        return button === null ? '' : getComputedStyle(button).outlineStyle;
      });
    };
    expect(await ring()).toBe('solid');
    const deleted = await page.evaluate(() => {
      let count = 0;
      for (const sheet of document.styleSheets) {
        for (let index = sheet.cssRules.length - 1; index >= 0; index -= 1) {
          const rule = sheet.cssRules[index];
          if (
            rule instanceof CSSStyleRule &&
            rule.selectorText === '.oyl-file__input:focus-visible + .oyl-file__button'
          ) {
            sheet.deleteRule(index);
            count += 1;
          }
        }
      }
      return count;
    });
    expect(deleted, 'the focus rule was not found to delete').toBe(1);
    await page.locator('main h1').focus();
    expect(await ring()).toBe('none');
  });

  test('shows the chosen file as a chip, whose remove empties the input and returns focus', async ({
    page,
  }) => {
    await open(page, TABLET);
    await visit(page, 'routes');
    await page.locator('main #route-file').setInputFiles({
      name: 'circuit.gpx',
      mimeType: 'application/gpx+xml',
      buffer: Buffer.from('<gpx/>'),
    });
    const chip = page.locator('main .oyl-file__chip');
    await expect(chip).toHaveText('circuit.gpx');
    const remove = chip.getByRole('button', { name: 'Remove circuit.gpx' });
    const box = await remove.boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(TARGET);
    expect(box?.height).toBeGreaterThanOrEqual(TARGET);
    // The drop zone stays round it.
    expect(await zone(page)).toEqual({ border: 'dashed', hintShown: true });
    await remove.click();
    await expect(chip).toHaveCount(0);
    const after = await page.evaluate(() => ({
      files: document.querySelector<HTMLInputElement>('main #route-file')?.files?.length,
      focused: document.activeElement?.id,
    }));
    expect(after).toEqual({ files: 0, focused: 'route-file' });
  });

  async function zone(page: Page) {
    return page.evaluate(() => {
      const found = document.querySelector<HTMLElement>('main .oyl-drop');
      const hint = found?.querySelector<HTMLElement>('.oyl-drop__hint');
      return {
        border: found === null || found === undefined ? '' : getComputedStyle(found).borderTopStyle,
        hintShown: hint?.checkVisibility() ?? false,
      };
    });
  }
});
