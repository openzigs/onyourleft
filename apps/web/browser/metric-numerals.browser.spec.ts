// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The metric type as the pinned Chromium paints it — #2041, ADR 0063 D-5.
 *
 * `design/metric-type.test.ts` holds the rule; this reads what it does, on
 * the three places a rider reads a number:
 *
 * 1. **A Home figure** (`reflow.html?data=populated`, walked to Home): the
 *    figure resolves to Barlow, not the fallback (`document.fonts.check`), and
 *    its digits are one width — the figure's own element, cloned and set to
 *    `1111` and to `8888`, measures the same. **Control:** the same clones
 *    with proportional figures measure differently, so equal widths are the
 *    rule's doing and not the face's.
 * 2. **A Ride screen metric** (`rideview.html` at 1280×800): Barlow, and the
 *    primary numeral's rendered cap height, read from the digits' own ink
 *    (`measureText`'s ascent in the computed font), is at least ADR 0063
 *    D-5's 27.4 CSS px — 16 arc-minutes at a 1 m mount on a 10.1-inch
 *    1280×800 tablet, which is an assumption about the owner's tablet.
 * 3. **A HUD primary value** (`hud.html`): Barlow.
 */

import { expect, test, type Page } from '@playwright/test';

/** ADR 0063 D-5: a primary ride numeral's cap height, in CSS px at 1280×800. */
const PRIMARY_CAP_FLOOR_PX = 27.4;

interface NumeralRead {
  readonly family: string;
  readonly weight: string;
  readonly size: string;
  /** The status of the Barlow `@font-face` at the element's weight, or 'absent' when there is none. */
  readonly status: string;
}

/** The computed face of the first element matching `selector`, and whether Barlow is what draws it. */
async function numeral(page: Page, selector: string): Promise<NumeralRead> {
  return page.evaluate(async (target) => {
    await document.fonts.ready;
    const element = document.querySelector(target);
    if (element === null) throw new Error(`no ${target} on the page`);
    const style = getComputedStyle(element);
    await document.fonts.load(`${style.fontWeight} ${style.fontSize} Barlow`).catch(() => []);
    return {
      family: style.fontFamily,
      weight: style.fontWeight,
      size: style.fontSize,
      // `document.fonts.check` is true with no Barlow face at all and with only
      // the 600 face (the figure is then faux-bolded), so the face itself is read.
      status:
        [...document.fonts].find(
          (candidate) =>
            candidate.family.replaceAll(/['"]/g, '') === 'Barlow' &&
            candidate.weight === style.fontWeight,
        )?.status ?? 'absent',
    };
  }, selector);
}

/** The widths of `1111` and `8888` set in a copy of the element, with its own or proportional figures. */
async function digitWidths(
  page: Page,
  selector: string,
  figures: 'own' | 'proportional-nums',
): Promise<readonly [number, number]> {
  return page.evaluate(
    ({ target, figures }) => {
      const element = document.querySelector(target);
      if (element === null) throw new Error(`no ${target} on the page`);
      const widthOf = (text: string): number => {
        const copy = element.cloneNode(false) as HTMLElement;
        copy.textContent = text;
        copy.style.display = 'inline-block';
        copy.style.position = 'absolute';
        copy.style.visibility = 'hidden';
        if (figures !== 'own') copy.style.fontVariantNumeric = figures;
        element.parentElement?.append(copy);
        const width = copy.getBoundingClientRect().width;
        copy.remove();
        return width;
      };
      return [widthOf('1111'), widthOf('8888')] as const;
    },
    { target: selector, figures },
  );
}

test.describe('#2041 — the metric numerals', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('a Home figure is Barlow, and 1111 is as wide as 8888', async ({ page }) => {
    await page.goto('/reflow.html?data=populated');
    await page.waitForFunction(() => window.__oylReflow?.ready === true);
    await page.evaluate(async () => window.__oylReflow?.visit('#/'));
    const figure = 'main .oyl-reading__value';
    const read = await numeral(page, figure);
    console.log(`#2041 Home figure: ${JSON.stringify(read)}`);
    expect(read.family.startsWith('Barlow')).toBe(true);
    expect(read.weight).toBe('700');
    expect(read.status, 'the Barlow 700 face did not load').toBe('loaded');
    const [ones, eights] = await digitWidths(page, figure, 'own');
    expect(ones).toBeGreaterThan(0);
    expect(
      Math.abs(ones - eights),
      `1111 is ${String(ones)} px and 8888 ${String(eights)} px`,
    ).toBeLessThan(0.5);
  });

  test('the control — with proportional figures, 1111 and 8888 differ', async ({ page }) => {
    await page.goto('/reflow.html?data=populated');
    await page.waitForFunction(() => window.__oylReflow?.ready === true);
    await page.evaluate(async () => window.__oylReflow?.visit('#/'));
    const [ones, eights] = await digitWidths(page, 'main .oyl-reading__value', 'proportional-nums');
    expect(Math.abs(ones - eights)).toBeGreaterThan(1);
  });

  test('a Ride screen metric is Barlow, with a primary cap height of at least 27.4 px', async ({
    page,
  }) => {
    await page.goto('/rideview.html');
    await page.waitForFunction(() => window.__oylRideView?.ready === true);
    const metric = '.oyl-reading--metric .oyl-reading__value';
    const read = await numeral(page, metric);
    expect(read.family.startsWith('Barlow')).toBe(true);
    expect(read.weight).toBe('700');
    expect(read.status, 'the Barlow 700 face did not load on the Ride screen').toBe('loaded');
    const cap = await page.evaluate((target) => {
      const element = document.querySelector(target);
      if (element === null) throw new Error(`no ${target}`);
      const style = getComputedStyle(element);
      const context = document.createElement('canvas').getContext('2d');
      if (context === null) throw new Error('no 2D context');
      context.font = `${style.fontWeight} ${style.fontSize} Barlow`;
      return context.measureText('0123456789').actualBoundingBoxAscent;
    }, metric);
    console.log(`#2041 Ride metric: ${JSON.stringify(read)}, cap ${cap.toFixed(1)} px`);
    expect(cap).toBeGreaterThanOrEqual(PRIMARY_CAP_FLOOR_PX);
  });

  test('a HUD primary value is Barlow', async ({ page }) => {
    await page.goto('/hud.html');
    await page.waitForFunction(() => window.__oylHudHarness?.ready === true);
    const read = await numeral(page, '.oyl-hud__fields--primary .oyl-hud__value');
    console.log(`#2041 HUD value: ${JSON.stringify(read)}`);
    expect(read.family.startsWith('Barlow')).toBe(true);
    expect(read.weight).toBe('700');
    expect(read.status, 'the Barlow 700 face did not load on the HUD').toBe('loaded');
  });

  test('the control — with every .woff2 refused, the 700 face does not load', async ({ page }) => {
    await page.route('**/*.woff2', (route) => route.abort());
    await page.goto('/reflow.html?data=populated');
    await page.waitForFunction(() => window.__oylReflow?.ready === true);
    await page.evaluate(async () => window.__oylReflow?.visit('#/'));
    const read = await numeral(page, 'main .oyl-reading__value');
    expect(read.status).not.toBe('loaded');
  });
});
