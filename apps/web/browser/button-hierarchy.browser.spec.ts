// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The kinds of button and the segmented control, as the pinned Chromium draws
 * them — #668, #688's hovered secondary, and #992's filled kinds: the
 * secondary TONAL (`surfaceOverlay`, no outline) and the tertiary TEXT.
 *
 * jsdom resolves no stylesheet and performs no layout (CLAUDE.md §4e), so
 * `contrast.a11y.test.ts` can only check the pairs `design/tokens.ts` DECLARES.
 * #688 is what that leaves open: a state nobody meant to draw is a pair nobody
 * declared, and the secondary's hover drew `accent` on `accentHover` — 1.40:1 —
 * through every gate. So this spec reads back what each state is ACTUALLY
 * painted with, and holds it both ways: the colours equal the tokens the rule
 * names, AND that token pair is one `CONTRAST_REQUIREMENTS` declares and that
 * clears its threshold. A read-back that equalled some other pair, or a pair
 * that was declared and not drawn, fails.
 *
 * It drives `shell.html?hierarchy=specimens` — `shell-harness.tsx`
 * §`HierarchySpecimens` — because no route this page renders without ports
 * has a toggle or a segmented control on it.
 *
 * ## The controls
 *
 * - `&hover-rule=off` deletes the rule #688 added; the hovered secondary must
 *   then read back as #688 found it, under 4.5:1. Without it the positive
 *   case could be reading a page that never hovered.
 * - The segment floor is stripped, #316's third measurement: with no
 *   `min-height` a segment is shorter than 44 px, so the declaration is what
 *   holds the target.
 * - An off toggle and an unchecked segment carry no inner ring, so the ring
 *   the on ones carry is a difference and not a style everything has.
 */

import { expect, test, type Locator, type Page } from '@playwright/test';

import { AA_TEXT, contrastRatio } from '../src/design/contrast';
import {
  CONTRAST_REQUIREMENTS,
  THEMES,
  paletteColours,
  type ColourToken,
  type Theme,
} from '../src/design/tokens';

const PAGE = '/shell.html?hierarchy=specimens';
const WITHOUT_HOVER_RULE = `${PAGE}&hover-rule=off`;
const READY = 'html[data-oyl-shell-ready]';

/** SC 2.5.5 (AAA). Not SC 2.5.8, which is 24 px. */
const TOUCH_TARGET_PIXELS = 44;

/** The buttons' own transition is 120 ms; this is what a read waits past. */
const TRANSITION_WAIT_MS = 400;

/** Every kind and state `shell-harness.tsx` renders, by `data-oyl-kind`. */
const KINDS = [
  'primary',
  'secondary',
  'tertiary',
  'toggle-off',
  'toggle-on',
  'primary-disabled',
  'secondary-disabled',
  'toggle-on-disabled',
] as const;

const SEGMENTS = ['Kilometres', 'Miles', 'Nautical miles'] as const;

/** Whether `fg` on `bg` is declared at `minimum` or stricter. */
function declared(fg: ColourToken, bg: ColourToken, minimum: number): boolean {
  return CONTRAST_REQUIREMENTS.some(
    (pair) => pair.foreground === fg && pair.background === bg && pair.minimum >= minimum,
  );
}

async function open(page: Page, url = PAGE): Promise<void> {
  await page.goto(url);
  await page.waitForSelector(READY);
  const kinds = await page
    .locator('[data-oyl-hierarchy] [data-oyl-kind]')
    .evaluateAll((all) => all.map((element) => (element as HTMLElement).dataset['oylKind']));
  expect(kinds, 'the specimens did not render — see shell-harness.tsx §HierarchySpecimens').toEqual(
    KINDS,
  );
  expect(await page.locator('[data-oyl-segment]').count()).toBe(SEGMENTS.length);
}

function kind(page: Page, name: (typeof KINDS)[number]): Locator {
  return page.locator(`[data-oyl-kind="${name}"]`);
}

interface Painted {
  readonly color: string;
  readonly background: string;
  readonly border: string;
  readonly shadow: string;
  readonly outline: string;
  readonly outlineColor: string;
}

async function painted(locator: Locator): Promise<Painted> {
  return locator.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      color: style.color,
      background: style.backgroundColor,
      border: style.borderTopColor,
      shadow: style.boxShadow,
      outline: style.outlineStyle,
      outlineColor: style.outlineColor,
    };
  });
}

/**
 * The colour checks, in one palette (#672). Every colour this spec reads back
 * is compared with THAT palette's token, so the same assertions run under a
 * light and a dark device — `paletteColours` is the dark palette over the
 * theme-independent HUD, exactly as `contrast.a11y.test.ts` measures it.
 */
function paintedIn(theme: Theme): {
  rgbOf: (token: ColourToken) => string;
  expectToken: (rgb: string, token: ColourToken, where: string) => void;
  expectLabelPair: (
    read: Painted,
    expected: { readonly fg: ColourToken; readonly bg: ColourToken },
    where: string,
  ) => void;
  colours: Readonly<Record<ColourToken, string>>;
} {
  const colours = paletteColours(theme);

  /** A token as Chromium reports a computed colour. */
  function rgbOf(token: ColourToken): string {
    const hex = colours[token];
    const channel = (at: number): number => Number.parseInt(hex.slice(at, at + 2), 16);
    return `rgb(${String(channel(1))}, ${String(channel(3))}, ${String(channel(5))})`;
  }

  /**
   * ⚠️ A computed colour is compared with the token EXPECTED, never looked up:
   * several tokens share a value (`ink` and `focus`, `canvas` and `accentInk`,
   * `accent` and `link`), so a reverse lookup names whichever comes first and
   * reads `accentInk` back as `canvas`.
   */
  function expectToken(rgb: string, token: ColourToken, where: string): void {
    expect(rgb, `${theme}: ${where}: expected ${token} (${colours[token]})`).toBe(rgbOf(token));
  }

  /**
   * The label on its fill, as tokens, and whether that pair is a declared text
   * pair clearing AA. Both halves are asserted: equality to the tokens the rule
   * names, and the declaration — so the read cannot be green for a colour that
   * is merely legible, nor for a declaration nothing draws.
   */
  function expectLabelPair(
    read: Painted,
    expected: { readonly fg: ColourToken; readonly bg: ColourToken },
    where: string,
  ): void {
    expectToken(read.color, expected.fg, `${where}, its label`);
    expectToken(read.background, expected.bg, `${where}, its fill`);
    expect(declared(expected.fg, expected.bg, AA_TEXT), `${where}: not a declared text pair`).toBe(
      true,
    );
    expect(contrastRatio(colours[expected.fg], colours[expected.bg])).toBeGreaterThanOrEqual(
      AA_TEXT,
    );
  }

  return { rgbOf, expectToken, expectLabelPair, colours };
}

/*
 * #672: every colour read below is read in BOTH palettes — the light one, and
 * the dark one under a device that prefers dark, which the inline theme script
 * `shell.html` carries like every page turns into `data-theme="dark"`.
 */
for (const theme of THEMES) {
  test.describe(`${theme} palette`, () => {
    test.use({ colorScheme: theme });
    const { rgbOf, expectToken, expectLabelPair, colours } = paintedIn(theme);

    test('the page is in this palette, so a read below is not the other one by default', async ({
      page,
    }) => {
      await open(page);
      expect(await page.evaluate(() => document.documentElement.dataset['theme'])).toBe(theme);
      expectToken(
        await page.evaluate(() => getComputedStyle(document.body).backgroundColor),
        'canvas',
        'the page',
      );
    });

    test.describe('#688 — a hovered secondary button', () => {
      test.use({ viewport: { width: 1280, height: 800 } });

      test('draws its label on a light fill, a declared pair that clears 4.5:1', async ({
        page,
      }) => {
        await open(page);
        const secondary = kind(page, 'secondary');
        await secondary.hover();
        await page.waitForTimeout(TRANSITION_WAIT_MS);
        expect(await secondary.evaluate((element) => element.matches(':hover'))).toBe(true);
        const read = await painted(secondary);
        expectLabelPair(read, { fg: 'accentHover', bg: 'selected' }, 'a hovered secondary');
        // #992: tonal, so its edge is its own fill — no outline under a pointer.
        expectToken(read.border, 'selected', 'a hovered secondary, its border');
      });

      test('the control — without the rule it is #688’s pair again, under 4.5:1', async ({
        page,
      }) => {
        await open(page, WITHOUT_HOVER_RULE);
        expect(
          await page.evaluate(() => document.documentElement.dataset['oylHoverRuleRemoved']),
          'the hover rule was not found to remove, so this control measures nothing',
        ).toBe('1');
        const secondary = kind(page, 'secondary');
        await secondary.hover();
        await page.waitForTimeout(TRANSITION_WAIT_MS);
        const read = await painted(secondary);
        expectToken(read.color, 'accent', 'without the rule, the label');
        expectToken(read.background, 'accentHover', 'without the rule, the fill');
        expect(contrastRatio(colours.accent, colours.accentHover)).toBeLessThan(AA_TEXT);
        expect(declared('accent', 'accentHover', AA_TEXT)).toBe(false);
      });
    });

    test.describe('#668 — a link drawn as a button', () => {
      test.use({ viewport: { width: 1280, height: 800 } });

      test('is painted as the button it is drawn as, and not underlined as a link', async ({
        page,
      }) => {
        await open(page);
        const link = page.locator('[data-oyl-link-button]');
        const decoration = (): Promise<string> =>
          link.evaluate((element) => getComputedStyle(element).textDecorationLine);
        expectLabelPair(
          await painted(link),
          { fg: 'accent', bg: 'surfaceOverlay' },
          'a button-link',
        );
        expect(await decoration()).toBe('none');
        await link.hover();
        await page.waitForTimeout(TRANSITION_WAIT_MS);
        expectLabelPair(
          await painted(link),
          { fg: 'accentHover', bg: 'selected' },
          'a hovered one',
        );
        expect(await decoration()).toBe('none');
      });
    });

    test.describe('#668 — every state of every kind is a declared pair', () => {
      test.use({ viewport: { width: 1280, height: 800 } });

      /** The tertiary has no fill of its own, so it is read by its own case below. */
      const AT_REST: Readonly<
        Record<Exclude<(typeof KINDS)[number], 'tertiary'>, { fg: ColourToken; bg: ColourToken }>
      > = {
        primary: { fg: 'accentInk', bg: 'accent' },
        secondary: { fg: 'accent', bg: 'surfaceOverlay' },
        'toggle-off': { fg: 'accent', bg: 'surfaceOverlay' },
        'toggle-on': { fg: 'accentHover', bg: 'selected' },
        'primary-disabled': { fg: 'inkMuted', bg: 'surface' },
        'secondary-disabled': { fg: 'inkMuted', bg: 'surface' },
        'toggle-on-disabled': { fg: 'inkMuted', bg: 'surface' },
      };

      const UNDER_A_POINTER: Partial<
        Record<(typeof KINDS)[number], { fg: ColourToken; bg: ColourToken }>
      > = {
        primary: { fg: 'accentInk', bg: 'accentHover' },
        secondary: { fg: 'accentHover', bg: 'selected' },
        'toggle-off': { fg: 'accentHover', bg: 'selected' },
        'toggle-on': { fg: 'accentHover', bg: 'selected' },
      };

      test('at rest', async ({ page }) => {
        await open(page);
        for (const name of KINDS) {
          if (name === 'tertiary') continue;
          expectLabelPair(await painted(kind(page, name)), AT_REST[name], `${name} at rest`);
        }
      });

      test('#992 — every kind but the tertiary is FILLED, and the secondary has no outline', async ({
        page,
      }) => {
        await open(page);
        const primary = await painted(kind(page, 'primary'));
        const secondary = await painted(kind(page, 'secondary'));
        const off = await painted(kind(page, 'toggle-off'));
        // A tonal secondary's edge is its own fill: no outline in another colour.
        expect(secondary.border).toBe(secondary.background);
        expect(off.border).toBe(off.background);
        expect(primary.border).toBe(primary.background);
        // And the three kinds are three fills: none of them is the page.
        const pageFill = rgbOf('canvas');
        expect(new Set([primary.background, secondary.background, pageFill]).size).toBe(3);
      });

      test('#992 — the tertiary is text: no fill, no edge, an underlined accent label', async ({
        page,
      }) => {
        await open(page);
        const tertiary = kind(page, 'tertiary');
        const read = async () => ({
          ...(await painted(tertiary)),
          ...(await tertiary.evaluate((element) => {
            const style = getComputedStyle(element);
            return {
              underline: style.textDecorationLine,
              thickness: style.textDecorationThickness,
              height: element.getBoundingClientRect().height,
            };
          })),
        });
        const atRest = await read();
        expect(atRest.background, 'a tertiary has a fill').toBe('rgba(0, 0, 0, 0)');
        expect(atRest.border, 'a tertiary has an edge').toBe('rgba(0, 0, 0, 0)');
        expectToken(atRest.color, 'accent', 'a tertiary, its label');
        expect(atRest.underline).toBe('underline');
        expect(atRest.height).toBeGreaterThanOrEqual(TOUCH_TARGET_PIXELS);
        // Its label stands on the page behind it, and that is a declared pair.
        expect(declared('accent', 'canvas', AA_TEXT)).toBe(true);
        await tertiary.hover();
        await page.waitForTimeout(TRANSITION_WAIT_MS);
        const hovered = await read();
        expect(hovered.background).toBe('rgba(0, 0, 0, 0)');
        expectToken(hovered.color, 'accentHover', 'a hovered tertiary, its label');
        expect(hovered.thickness).toBe('2px');
        expect(declared('accentHover', 'canvas', AA_TEXT)).toBe(true);
        expect(contrastRatio(colours.accentHover, colours.canvas)).toBeGreaterThanOrEqual(AA_TEXT);
      });

      test('under a pointer, and while pressed', async ({ page }) => {
        await open(page);
        for (const [name, expected] of Object.entries(UNDER_A_POINTER)) {
          const button = kind(page, name as (typeof KINDS)[number]);
          await button.hover();
          await page.waitForTimeout(TRANSITION_WAIT_MS);
          expectLabelPair(await painted(button), expected, `${name} under a pointer`);
          await page.mouse.down();
          await page.waitForTimeout(TRANSITION_WAIT_MS);
          expect(await button.evaluate((element) => element.matches(':active'))).toBe(true);
          expectLabelPair(await painted(button), expected, `${name} pressed`);
          await page.mouse.up();
        }
      });

      test('focused from the keyboard: the ring is the focus token, offset onto the page', async ({
        page,
      }) => {
        await open(page);
        for (const name of ['primary', 'secondary', 'toggle-off', 'toggle-on'] as const) {
          const button = kind(page, name);
          await button.focus();
          expect(await button.evaluate((element) => element.matches(':focus-visible'))).toBe(true);
          const read = await painted(button);
          expect(read.outline, `${name} focused`).toBe('solid');
          expectToken(read.outlineColor, 'focus', `${name} focused, its ring`);
          // Offset by 2 px, the ring lands on the page behind the button.
          expect(declared('focus', 'canvas', 3)).toBe(true);
          // And the label keeps its own declared pair while focused.
          expectLabelPair(read, AT_REST[name], `${name} focused`);
        }
      });

      test('an on toggle is told apart by weight as well as colour (SC 1.4.1)', async ({
        page,
      }) => {
        await open(page);
        const on = await painted(kind(page, 'toggle-on'));
        const off = await painted(kind(page, 'toggle-off'));
        // The doubled border: an inset ring inside the 2 px border, in the accent.
        expect(off.shadow).toBe('none');
        expect(on.shadow).toMatch(/inset/);
        expect(on.shadow).toContain(rgbOf('accent'));
        expect(on.shadow).toMatch(/0px 0px 0px 2px/);
        expect(await kind(page, 'toggle-on').getAttribute('aria-pressed')).toBe('true');
        expect(await kind(page, 'toggle-off').getAttribute('aria-pressed')).toBe('false');
        // And the weight survives a disabled on toggle, in the disabled border.
        const disabledOn = await painted(kind(page, 'toggle-on-disabled'));
        expect(disabledOn.shadow).toContain(rgbOf('border'));
        expect(declared('border', 'surface', 3)).toBe(true);
      });

      test('pressing does not move the layout: an on toggle is the same size as an off one', async ({
        page,
      }) => {
        await open(page);
        const box = (name: (typeof KINDS)[number]) =>
          kind(page, name).evaluate((element) => {
            const rect = element.getBoundingClientRect();
            return rect.height;
          });
        expect(await box('toggle-on')).toBe(await box('toggle-off'));
      });
    });

    test.describe('#668 — a segmented control, painted and operated', () => {
      test.use({ viewport: { width: 1280, height: 800 } });

      const segment = (page: Page, label: string): Locator =>
        page.locator(`[data-oyl-segment="${label}"]`);

      test('checked and unchecked are declared pairs, and checked is told by weight too', async ({
        page,
      }) => {
        await open(page);
        const checked = await painted(segment(page, 'Miles'));
        const unchecked = await painted(segment(page, 'Kilometres'));
        expectLabelPair(checked, { fg: 'accentHover', bg: 'selected' }, 'the checked segment');
        expectLabelPair(unchecked, { fg: 'accent', bg: 'canvas' }, 'an unchecked segment');
        expect(unchecked.shadow).toBe('none');
        expect(checked.shadow).toMatch(/inset/);
        expect(checked.shadow).toContain(rgbOf('accent'));
        expect(declared('accent', 'selected', 3)).toBe(true);
        // The radio itself: checked, drawn in the accent, on the segment's fill.
        const radio = segment(page, 'Miles').locator('input');
        expect(await radio.isChecked()).toBe(true);
        expect(await radio.evaluate((input) => getComputedStyle(input).accentColor)).toBe(
          rgbOf('accent'),
        );
      });

      test('an unchecked segment under a pointer is a declared pair', async ({ page }) => {
        await open(page);
        const kilometres = segment(page, 'Kilometres');
        await kilometres.hover();
        expectLabelPair(
          await painted(kilometres),
          { fg: 'accentHover', bg: 'surface' },
          'a hovered segment',
        );
      });

      test('the arrow keys move the choice — the platform’s radio group, not a rebuilt one', async ({
        page,
      }) => {
        await open(page);
        const miles = segment(page, 'Miles').locator('input');
        await miles.focus();
        const ring = await miles.evaluate((input) => {
          const style = getComputedStyle(input);
          return { style: style.outlineStyle, colour: style.outlineColor };
        });
        expect(ring.style).toBe('solid');
        expectToken(ring.colour, 'focus', 'the focused radio, its ring');
        expect(declared('focus', 'selected', 3)).toBe(true);
        await page.keyboard.press('ArrowRight');
        expect(await segment(page, 'Nautical miles').locator('input').isChecked()).toBe(true);
        expect(await miles.isChecked()).toBe(false);
        // The fill follows the check, not the focus.
        expectToken(
          (await painted(segment(page, 'Nautical miles'))).background,
          'selected',
          'now checked',
        );
        expectToken((await painted(segment(page, 'Miles'))).background, 'canvas', 'now unchecked');
      });
    });
  });
}

const SEGMENT_VIEWPORTS = [
  { name: '320×256', width: 320, height: 256 },
  { name: '390×844', width: 390, height: 844 },
  { name: '1280×800', width: 1280, height: 800 },
] as const;

async function segmentBoxes(
  page: Page,
  stripped: boolean,
): Promise<
  readonly {
    label: string;
    height: number;
    width: number;
    top: number;
    left: number;
    right: number;
    rowLeft: number;
    minHeight: string;
  }[]
> {
  return page.evaluate((strip) => {
    // ⚠️ Every floor comes off BEFORE any box is read: the segments share a
    // flex row that stretches each to the tallest, so one stripped segment
    // beside two with their floors measures 44 px and proves nothing.
    const segments = [...document.querySelectorAll<HTMLElement>('[data-oyl-segment]')];
    const before = segments.map((segment) => segment.style.cssText);
    if (strip) for (const segment of segments) segment.style.minHeight = '0px';
    const read = segments.map((segment) => {
      const box = segment.getBoundingClientRect();
      return {
        label: segment.dataset['oylSegment'] ?? '',
        height: box.height,
        width: box.width,
        top: box.top,
        left: box.left,
        right: box.right,
        rowLeft: segment.parentElement?.getBoundingClientRect().left ?? Number.NaN,
        minHeight: getComputedStyle(segment).minHeight,
      };
    });
    segments.forEach((segment, index) => {
      segment.style.cssText = before[index] ?? '';
    });
    return read;
  }, stripped);
}

for (const viewport of SEGMENT_VIEWPORTS) {
  test.describe(`#668 — a segmented control at ${viewport.name}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test('each segment is at least a 44×44 target as Chromium lays it out', async ({ page }) => {
      await open(page);
      const segments = await segmentBoxes(page, false);
      expect(segments.map((segment) => segment.label)).toEqual(SEGMENTS);
      // The three-option specimen wraps on a phone and not on a tablet, so the
      // row-start check below is measured on a wrapped row, not passed over one.
      const rows = new Set(segments.map((segment) => segment.top)).size;
      expect(rows > 1, `${String(rows)} rows at ${viewport.name}`).toBe(viewport.width < 400);
      for (const segment of segments) {
        expect(segment.height, `${segment.label}'s height`).toBeGreaterThanOrEqual(
          TOUCH_TARGET_PIXELS,
        );
        expect(segment.width, `${segment.label}'s width`).toBeGreaterThanOrEqual(
          TOUCH_TARGET_PIXELS,
        );
        // Inside the viewport, and — where three options wrap on a phone —
        // the segment that starts a row lines up with the row rather than
        // hanging outside it on the join's −2px (theme.css
        // §`.oyl-segmented__options`, #694's review).
        expect(segment.right, `${segment.label} runs past the viewport`).toBeLessThanOrEqual(
          viewport.width,
        );
        expect(segment.left, `${segment.label} starts outside its row`).toBeGreaterThanOrEqual(
          segment.rowLeft,
        );
      }
    });
  });
}

test.describe('#668 — the segment target is declared, and nothing else holds it', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('the 44 px minimum is a declaration on every segment', async ({ page }) => {
    await open(page);
    for (const segment of await segmentBoxes(page, false)) {
      expect(Number.parseFloat(segment.minHeight), segment.label).toBeGreaterThanOrEqual(
        TOUCH_TARGET_PIXELS,
      );
    }
  });

  test('with the floor stripped off, a segment falls short — the floor is what holds it', async ({
    page,
  }) => {
    await open(page);
    const segments = await segmentBoxes(page, true);
    expect(segments.length).toBe(SEGMENTS.length);
    for (const segment of segments) {
      expect(segment.minHeight, 'the floor was not taken off').toBe('0px');
      expect(segment.height, segment.label).toBeGreaterThan(0);
      expect(segment.height, segment.label).toBeLessThan(TOUCH_TARGET_PIXELS);
    }
  });
});

/**
 * The SHIPPED segmented controls — Settings' units choice and, since #672, its
 * appearance choice — laid out by the reflow harness (`reflow.html`, the real
 * `AppShell` over the empty fixture). The cases above measure the specimen,
 * whose markup differs from Settings' (a `htmlFor`/`id` pair, a text node
 * before the label, a description inside the fieldset); this is the box a
 * rider actually taps.
 *
 * The appearance choice has three options, and on a phone (320 and 390 px) they
 * wrap — `theme.css` §"A SEGMENTED CONTROL" joins a wrapped row like tiles —
 * so what it is held to there is the target and the viewport, not one row.
 */
const SHIPPED_SEGMENTED = [
  { name: 'units', input: 'oyl-units', count: 2, oneRowFrom: 0 },
  { name: 'appearance', input: 'oyl-theme', count: 3, oneRowFrom: 600 },
] as const;

for (const viewport of SEGMENT_VIEWPORTS) {
  for (const control of SHIPPED_SEGMENTED) {
    test.describe(`#668 — Settings' ${control.name} choice at ${viewport.name}`, () => {
      test.use({ viewport: { width: viewport.width, height: viewport.height } });

      test('each segment is a 44×44 target inside the viewport', async ({ page }) => {
        await page.goto('/reflow.html?data=empty');
        await page.waitForFunction(() => window.__oylReflow?.ready === true);
        const seen = await page.evaluate(async () => window.__oylReflow?.visit('#/settings'));
        expect(seen?.h1).toBe('Settings');
        const segments = await page
          .locator(
            `fieldset.oyl-segmented:has(input[name="${control.input}"]) .oyl-segmented__options > label`,
          )
          .evaluateAll((all) =>
            all.map((label) => {
              const box = label.getBoundingClientRect();
              return {
                label: (label.textContent ?? '').trim(),
                top: box.top,
                left: box.left,
                right: box.right,
                width: box.width,
                height: box.height,
              };
            }),
          );
        expect(segments, `Settings rendered no ${control.name} segments`).toHaveLength(
          control.count,
        );
        const first = segments[0];
        for (const segment of segments) {
          expect(segment.height, `${segment.label}'s height`).toBeGreaterThanOrEqual(
            TOUCH_TARGET_PIXELS,
          );
          expect(segment.width, `${segment.label}'s width`).toBeGreaterThanOrEqual(
            TOUCH_TARGET_PIXELS,
          );
          if (viewport.width >= control.oneRowFrom) {
            // One row: the join and the end radii only mean anything on one.
            expect(segment.top, `${segment.label} wrapped to a second row`).toBe(first?.top);
          }
          expect(segment.left, `${segment.label} starts off the viewport`).toBeGreaterThanOrEqual(
            0,
          );
          expect(segment.right, `${segment.label} runs past the viewport`).toBeLessThanOrEqual(
            viewport.width,
          );
        }
      });
    });
  }
}

/**
 * An on toggle under a forced palette — Windows High Contrast and its kin.
 * The forced palette flattens the `selected` fill and removes every
 * box-shadow, so the `@media (forced-colors: active)` rule in `theme.css`
 * draws the on state as a double border instead, with the padding taking the
 * two wider pixels back. The control deletes that one rule through the CSSOM
 * and requires the on toggle to be drawn exactly as the off one — the state
 * lost — so the positive read cannot be a page where forcing never applied.
 */
test.describe('#668 — an on toggle under forced colours', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  async function borders(page: Page) {
    const read = (name: 'toggle-on' | 'toggle-off') =>
      kind(page, name).evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          style: style.borderTopStyle,
          width: Number.parseFloat(style.borderTopWidth),
          shadow: style.boxShadow,
          height: element.getBoundingClientRect().height,
        };
      });
    return { on: await read('toggle-on'), off: await read('toggle-off') };
  }

  test('is told by a double border, and the box does not move', async ({ page }) => {
    await page.emulateMedia({ forcedColors: 'active' });
    await open(page);
    expect(await page.evaluate(() => matchMedia('(forced-colors: active)').matches)).toBe(true);
    const { on, off } = await borders(page);
    expect(on.shadow, 'a forced palette keeps no shadow').toBe('none');
    expect(on.style).toBe('double');
    expect(on.width).toBe(4);
    expect(off.style).toBe('solid');
    expect(off.width).toBe(2);
    expect(on.height).toBeGreaterThanOrEqual(TOUCH_TARGET_PIXELS);
    expect(on.height).toBe(off.height);
  });

  test('the control — without the rule, on and off are drawn alike', async ({ page }) => {
    await page.emulateMedia({ forcedColors: 'active' });
    await open(page);
    const removed = await page.evaluate(() => {
      let count = 0;
      for (const sheet of document.styleSheets) {
        for (const rule of [...sheet.cssRules]) {
          if (!(rule instanceof CSSMediaRule) || !rule.conditionText.includes('forced-colors')) {
            continue;
          }
          for (let index = rule.cssRules.length - 1; index >= 0; index -= 1) {
            const inner = rule.cssRules[index];
            if (
              inner instanceof CSSStyleRule &&
              inner.selectorText.includes('.oyl-button--toggle[aria-pressed')
            ) {
              rule.deleteRule(index);
              count += 1;
            }
          }
        }
      }
      return count;
    });
    expect(removed, 'the forced-colours toggle rule was not found to remove').toBe(1);
    const { on, off } = await borders(page);
    expect(on.shadow).toBe('none');
    expect(on.style).toBe(off.style);
    expect(on.width).toBe(off.width);
  });
});
