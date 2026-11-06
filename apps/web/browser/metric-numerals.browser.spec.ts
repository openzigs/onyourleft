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

import { OVERLAY_VIEWPORTS, openRide, TABLET_VIEWPORTS } from './ride-stage';

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

/**
 * #2130, the owner's screenshot review of 2026-11-05 — **every unit on its
 * number's line.** At 1280×800 *To go*'s `km` fell onto a line of its own
 * under `39.94`: at 2.45 rem the number is 95.9 px and ` km` 17.5 px, in a
 * 108 px track. A unit is read with its number, and one dropped under it reads
 * as a different field's.
 *
 * Each reading is first set to the widest it shows in ordinary riding — a
 * speed under 100 km/h (`99.9`), a distance to go under 100 km (`99.99`, #2130's
 * case at two decimals), a gradient of `-19.9`, a four-digit power and
 * three-digit heart rate and cadence — by writing the digits into the
 * reading's own text node, so the measurement is the stylesheet's layout of
 * the widest value rather than of whatever the ride happened to read. Then
 * every unit drawn BESIDE its number (computed `display: inline`) must sit
 * inside its number's line: its box within the digits' box, top and bottom. A
 * unit on the next line is below the digits' box.
 *
 * ⚠️ **A primary unit set `display: block` is not a wrap: it is #2071's
 * layout,** the four primary units drawn under their numbers as a row of their
 * own wherever four primary tracks share the panel. That layout is read
 * too: a block unit anywhere but the primary panel, or a primary panel with
 * some units beside and some under, fails. A field is counted in the panel it
 * is DRAWN in: #2071's gradient, positioned into the secondary panel's first
 * cell on the 4:3 tablet and on an upright phone, is a secondary reading there.
 *
 * The moving and elapsed times are set to `9:59:59` too: they have no unit,
 * and are read only for the gap below.
 *
 * **Control:** the 1280×800 secondary tier set back to six equal 5.5 rem
 * tracks with the 8 px gap it had, the layout of the screenshot, drops *To
 * go*'s unit under its number.
 */
const WIDEST_ORDINARY_VALUES: Readonly<Record<string, string>> = {
  Power: '1999',
  Cadence: '199',
  'Heart rate': '199',
  Gradient: '19.9',
  Speed: '99.9',
  'To go': '99.99',
  Moving: '9:59:59',
  Elapsed: '9:59:59',
};

/**
 * #2130, the owner's ruling of 2026-11-06 — **a long route.** From 100 km to
 * go (or 100 mi) the countdown is one decimal (`fields.ts`
 * §`remainingDistance`), so a route under 200 km or 200 mi is never wider
 * than `199.9`, which is what the ruling asks this spec to write, in either
 * unit. `139.82 km` filled its track and wrapped `km` at every tablet before
 * it. (`fields.test.ts` §"a long countdown" holds the formatter itself.)
 */
interface ValueSet {
  readonly name: string;
  readonly digits: Readonly<Record<string, string>>;
  /** A unit written in place of the one drawn, by label — the imperial case. */
  readonly units: Readonly<Record<string, string>>;
}

const VALUE_SETS: readonly ValueSet[] = [
  { name: 'the widest ordinary values', digits: WIDEST_ORDINARY_VALUES, units: {} },
  {
    name: '199.9 km to go',
    digits: { ...WIDEST_ORDINARY_VALUES, 'To go': '199.9' },
    units: { 'To go': 'km' },
  },
  {
    name: '199.9 mi to go',
    digits: { ...WIDEST_ORDINARY_VALUES, 'To go': '199.9' },
    units: { 'To go': 'mi' },
  },
];

interface UnitLine {
  readonly label: string;
  readonly panel: 'primary' | 'secondary';
  /** The unit's computed `display`, or `none` for a reading with no unit. */
  readonly display: string;
  readonly beside: boolean;
  /** The reading's drawn digits and unit together, in CSS px. */
  readonly ink: {
    readonly left: number;
    readonly right: number;
    readonly top: number;
    readonly bottom: number;
  };
}

/** Sets a value set's digits and units, then reads each unit's place against its digits. */
async function unitLines(
  page: Page,
  set: ValueSet = VALUE_SETS[0] as ValueSet,
): Promise<readonly UnitLine[]> {
  return page.evaluate(
    ({ widest, units }) => {
      const lines: UnitLine[] = [];
      for (const field of document.querySelectorAll<HTMLElement>('.oyl-hud .oyl-hud__field')) {
        const value = field.querySelector<HTMLElement>(':scope > .oyl-hud__value');
        if (value === null) continue;
        // A reading a layout clips out of sight (#1912's give-way) is not drawn.
        if (field.getBoundingClientRect().width < 2) continue;
        const label = field.querySelector('.oyl-hud__label')?.textContent ?? '';
        // Where it is DRAWN: #2071's gradient drawn in the secondary panel's
        // first cell is in the primary list and at the secondary size there.
        const panel =
          field.closest('.oyl-hud__fields--primary') === null ||
          getComputedStyle(field).position === 'absolute'
            ? 'secondary'
            : 'primary';
        const wide = widest[label];
        const unit = value.querySelector<HTMLElement>(':scope > .oyl-hud__unit');
        if (unit === null) {
          // A reading with no unit — the moving time, a word — is read for
          // its gap to the next one and for nothing else.
          const only = [...value.childNodes].find((node): node is Text => node instanceof Text);
          if (only !== undefined && wide !== undefined) only.data = wide;
          const whole = document.createRange();
          whole.selectNodeContents(value);
          const { left, right, top, bottom } = whole.getBoundingClientRect();
          lines.push({
            label,
            panel,
            display: 'none',
            beside: true,
            ink: { left, right, top, bottom },
          });
          continue;
        }
        const digits = [...value.childNodes].findLast(
          (node): node is Text => node instanceof Text && node.compareDocumentPosition(unit) === 4,
        );
        if (digits !== undefined && wide !== undefined) {
          digits.data = wide;
          const sign = value.querySelector(':scope > .oyl-hud__sign');
          if (sign !== null) sign.textContent = '-';
        }
        const written = units[label];
        // The unit's own leading space is kept: it is part of the drawn width.
        if (written !== undefined)
          unit.textContent = (unit.textContent ?? '').replace(/\S+/, written);
        const range = document.createRange();
        range.setStart(value, 0);
        range.setEndBefore(unit);
        const number = range.getBoundingClientRect();
        const box = unit.getClientRects()[0] ?? unit.getBoundingClientRect();
        // The unit's TEXT, not its box: a primary unit set `display: block`
        // has a box as wide as its track, and the track is not ink.
        const unitText = document.createRange();
        unitText.selectNodeContents(unit);
        const drawn = unitText.getBoundingClientRect();
        lines.push({
          label,
          panel,
          display: getComputedStyle(unit).display,
          beside: box.top >= number.top - 1 && box.bottom <= number.bottom + 1,
          ink: {
            left: Math.min(number.left, drawn.left),
            right: Math.max(number.right, drawn.right),
            top: Math.min(number.top, drawn.top),
            bottom: Math.max(number.bottom, drawn.bottom),
          },
        });
      }
      return lines;
    },
    { widest: set.digits, units: set.units },
  );
}

/** What is wrong with the units' lines, or nothing. */
function unitLineFaults(lines: readonly UnitLine[]): string[] {
  const faults: string[] = [];
  const withUnits = lines.filter((each) => each.display !== 'none');
  const primaryBlocks = withUnits.filter(
    (each) => each.panel === 'primary' && each.display === 'block',
  );
  const primary = withUnits.filter((each) => each.panel === 'primary');
  if (primaryBlocks.length > 0 && primaryBlocks.length !== primary.length) {
    faults.push(
      `the primary panel mixes units beside and under their numbers: ${primaryBlocks.map((each) => each.label).join(', ')} under`,
    );
  }
  for (const each of withUnits) {
    if (each.display === 'block') {
      if (each.panel !== 'primary') faults.push(`${each.label}'s unit is a block of its own`);
    } else if (!each.beside) {
      faults.push(`${each.label}'s unit wrapped under its number`);
    }
  }
  return faults;
}

/**
 * #2130, the owner's ruling of 2026-11-06: **at least 8 px between a reading's
 * unit and the next reading** on a tablet. At 1024×768 `139.82 km` ran into
 * `9:59:59` with no gap, and even `39.94 km` was 4 px from it.
 */
const READING_GAP_FLOOR_PX = 8;

/**
 * The gap from each drawn reading (its digits and unit, not its track) to the
 * next one on the same line, left to right. Two readings are on one line when
 * their ink overlaps vertically, which also catches a primary reading beside
 * a secondary one.
 */
function readingGaps(lines: readonly UnitLine[]): { pair: string; gap: number }[] {
  const gaps: { pair: string; gap: number }[] = [];
  const sorted = [...lines].sort((a, b) => a.ink.left - b.ink.left);
  for (const [index, each] of sorted.entries()) {
    const next = sorted
      .slice(index + 1)
      .find((other) => other.ink.top < each.ink.bottom && other.ink.bottom > each.ink.top);
    if (next !== undefined) {
      gaps.push({ pair: `${each.label} → ${next.label}`, gap: next.ink.left - each.ink.right });
    }
  }
  return gaps;
}

function narrowGaps(lines: readonly UnitLine[]): string[] {
  return readingGaps(lines)
    .filter((each) => each.gap < READING_GAP_FLOOR_PX)
    .map((each) => `${each.pair}: ${each.gap.toFixed(1)} px`);
}

const TABLETS = new Set(TABLET_VIEWPORTS.map((each) => each.name));

/**
 * #2079's text sizes, PR #2235's re-review: the owner's 8 px between readings
 * (2026-11-06) holds at *large* and *extra large* too, where the primary
 * readings are 4.375 and 5 rem — on the tablets, the only screens the setting
 * changes.
 */
const TEXT_SIZES = [
  { size: '', query: (base: string) => base },
  ...(['large', 'extra-large'] as const).map((size) => ({
    size: ` at ${size} text`,
    query: (base: string) => `${base === '' ? '?' : `${base}&`}text=${size}`,
  })),
];

for (const viewport of OVERLAY_VIEWPORTS) {
  for (const [base, { size, query: sized }] of ['', '?room=following'].flatMap((each) =>
    TEXT_SIZES.filter((text) => text.size === '' || TABLETS.has(viewport.name)).map(
      (text) => [each, text] as const,
    ),
  )) {
    const query = sized(base);
    test(`#2130 every unit is on its number's line — ${viewport.name}${base === '' ? '' : ', in a room'}${size}`, async ({
      page,
    }) => {
      await openRide(page, viewport, query);
      for (const set of VALUE_SETS) {
        const lines = await unitLines(page, set);
        expect(lines.some((each) => each.label === 'To go')).toBe(true);
        expect(unitLineFaults(lines), `${viewport.name} ${query}, ${set.name}`).toEqual([]);
        if (TABLETS.has(viewport.name)) {
          const gaps = readingGaps(lines).map((each) => each.gap);
          console.log(
            `#2130 ${viewport.name}${query}, ${set.name}: narrowest gap ${Math.min(...gaps).toFixed(1)} px`,
          );
          expect(narrowGaps(lines), `${viewport.name} ${query}, ${set.name}`).toEqual([]);
        }
      }
    });
  }
}

test("#2130 the control — six equal tracks drop To go's unit under its number", async ({
  page,
}) => {
  await openRide(page, OWNERS_TABLET);
  await page.evaluate(() => {
    const panel = document.querySelector<HTMLElement>('.oyl-hud__fields--secondary');
    if (panel === null) throw new Error('no secondary panel');
    panel.style.gridTemplateColumns = 'repeat(6, minmax(5.5rem, 1fr))';
    panel.style.columnGap = '8px';
  });
  const faults = unitLineFaults(await unitLines(page));
  expect(faults).toContain("To go's unit wrapped under its number");
});
