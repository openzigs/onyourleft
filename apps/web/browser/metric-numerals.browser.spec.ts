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
 * 4. **A HUD secondary numeral on the ride stage** (`ride.html` at 1280×800,
 *    #2130): the same cap-height read, held to the same 27.4 px, because D-5
 *    asks 2.45 rem or more of a secondary numeral for the same 16 arc-minutes.
 *    **Control:** the element set back to its old 1.5 rem measures under it
 *    (17.1 px in the pinned Chromium, against 27.95 px at 2.45 rem).
 */

import { expect, test, type Page } from '@playwright/test';

import { openRide, TABLET_VIEWPORTS } from './ride-stage';

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

/**
 * #2130: the first secondary HUD reading's numeral on the real ride stage —
 * the speed (`fields.ts` §`hudReadings` puts it first in the tier), which is
 * never a word, so the size measured is a numeral's.
 */
const SECONDARY_NUMERAL =
  '.oyl-hud__fields--secondary > .oyl-hud__field:first-child .oyl-hud__value';

/** The tablet D-5 states its floor for. */
const OWNERS_TABLET = {
  name: 'a landscape tablet — 1280×800, the owner’s',
  width: 1280,
  height: 800,
  unstagedFails: true,
} as const;

/**
 * The rendered cap height of the digits in the element's computed face, in CSS
 * px: `measureText`'s ascent of `0123456789`, as the Ride screen case reads it.
 */
async function capHeight(page: Page, selector: string): Promise<number> {
  return page.evaluate(async (target) => {
    await document.fonts.ready;
    const element = document.querySelector(target);
    if (element === null) throw new Error(`no ${target}`);
    const style = getComputedStyle(element);
    await document.fonts.load(`${style.fontWeight} ${style.fontSize} Barlow`);
    const context = document.createElement('canvas').getContext('2d');
    if (context === null) throw new Error('no 2D context');
    context.font = `${style.fontWeight} ${style.fontSize} Barlow`;
    return context.measureText('0123456789').actualBoundingBoxAscent;
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

  test('#2130 a HUD secondary numeral on the ride stage has a cap height of at least 27.4 px', async ({
    page,
  }) => {
    await openRide(page, OWNERS_TABLET);
    const cap = await capHeight(page, SECONDARY_NUMERAL);
    console.log(`#2130 HUD secondary numeral at 1280×800: cap ${cap.toFixed(2)} px`);
    expect(cap).toBeGreaterThanOrEqual(PRIMARY_CAP_FLOOR_PX);
  });

  test('#2130 the control — the same numeral at its old 1.5 rem is under the floor', async ({
    page,
  }) => {
    await openRide(page, OWNERS_TABLET);
    // The size it had until #2130, set on the element the case above measures,
    // so a pass above is the stylesheet's doing and not the measurement's.
    await page.evaluate((target) => {
      const element = document.querySelector<HTMLElement>(target);
      if (element === null) throw new Error(`no ${target}`);
      element.style.fontSize = '1.5rem';
    }, SECONDARY_NUMERAL);
    const cap = await capHeight(page, SECONDARY_NUMERAL);
    console.log(`#2130 control at 1.5 rem: cap ${cap.toFixed(2)} px`);
    expect(cap).toBeLessThan(PRIMARY_CAP_FLOOR_PX);
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

/**
 * #2130 — a four-digit power in its track on every tablet.
 *
 * At 3.815 rem a four-digit number is about 133 px of Barlow's tabular
 * figures, and a sprint can produce one. A number has no break opportunity, so
 * the primary panel gives power the wider track (`theme.css` §"THE TABLET'S
 * READINGS AT ARM'S LENGTH"). The ride's own power reading is set to `1999`
 * and its digits — the text, not the field — measured against the field.
 * **Control:** with the primary tracks made equal on the owner’s tablet, the same digits are
 * wider than the field.
 */
async function fourDigitPower(page: Page): Promise<{ digits: number; field: number }> {
  return page.evaluate(() => {
    const field = document.querySelector('.oyl-hud__fields--primary > .oyl-hud__field');
    const value = field?.querySelector('.oyl-hud__value');
    if (!(field instanceof HTMLElement) || !(value instanceof HTMLElement)) {
      throw new Error('no primary power reading on the stage');
    }
    const unit = value.querySelector('.oyl-hud__unit');
    value.textContent = '1999';
    if (unit !== null) value.append(' ', unit);
    const digits = value.firstChild;
    if (digits === null) throw new Error('the power reading has no text');
    const range = document.createRange();
    range.selectNodeContents(digits);
    return { digits: range.getBoundingClientRect().width, field: field.clientWidth };
  });
}

for (const viewport of TABLET_VIEWPORTS) {
  test(`#2130 a four-digit power fits its track — ${viewport.name}`, async ({ page }) => {
    await openRide(page, viewport);
    const { digits, field } = await fourDigitPower(page);
    console.log(`#2130 1999 W at ${viewport.name}: ${digits.toFixed(1)} px in ${String(field)} px`);
    expect(digits).toBeLessThanOrEqual(field);
  });
}

test('#2130 the control — with equal primary tracks, a four-digit power does not fit', async ({
  page,
}) => {
  await openRide(page, OWNERS_TABLET);
  await page.evaluate(() => {
    const panel = document.querySelector<HTMLElement>('.oyl-hud__fields--primary');
    if (panel === null) throw new Error('no primary panel');
    panel.style.gridTemplateColumns = 'repeat(4, minmax(0, 1fr))';
  });
  const { digits, field } = await fourDigitPower(page);
  expect(digits).toBeGreaterThan(field);
});
