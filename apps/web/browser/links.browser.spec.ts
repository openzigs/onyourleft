// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Every link on every route paints with the app's own colours — #661.
 *
 * ## The hole this closes
 *
 * Until #661 `theme.css` had no rule for a plain `a`, so every link in running
 * text was the browser's default `rgb(0, 0, 238)`. `contrast.a11y.test.ts` walks
 * pairs of TOKENS, and a colour no token supplies is in no pair — so the one
 * colour on the page that was nobody's choice was also the one colour no gate
 * could see. `theme.a11y.test.ts` reads the stylesheet as a file and could say a
 * rule was present; nothing asked what a real engine actually painted.
 *
 * So this reads it back. On the real `AppShell` with the real route table under
 * the real `theme.css` (`shell-harness.tsx`), for every route in `ALL_ROUTES` —
 * derived, never listed — it takes the computed `color` of every `a`, the
 * colour of its underline, and the colour of the first opaque surface behind
 * it, and requires:
 *
 * 1. the colour and the underline to be token values, converted from
 *    `design/tokens.ts` rather than re-typed here;
 * 2. the surface to be a token value too, and the (colour, surface) pair to be
 *    one `CONTRAST_REQUIREMENTS` declares — which is what makes "every surface a
 *    link sits on" a measurement rather than a list somebody wrote;
 * 3. a link in running text — an `a` with no class of its own — to be
 *    underlined (WCAG 2.2 SC 1.4.1).
 *
 * Then it drives each link in running text into hover, keyboard focus and a
 * press, confirms the element really is in that state (`matches(':hover')`
 * and friends — a state that never applied would pass over the resting
 * colour), and requires the state's own token.
 *
 * ## The controls
 *
 * - The `:where(a…)` block is deleted from the live stylesheet through the
 *   CSSOM, and the same walk must then find a link that is NOT a token colour.
 *   That is #661's third criterion in its own words — "its control is a
 *   stylesheet with the `a` rule removed" — and without it every assertion
 *   above is equally true of a stylesheet that failed to load into a page
 *   whose links all happened to be classed.
 * - The walk counts what it measured and fails on nothing: every route in the
 *   table visited, and links in running text found. The shell is handed no
 *   ports (`shell-harness.tsx` §"Why the shell is rendered with no ports"), so
 *   most views render their honest cannot-do-this-here branch, and measured
 *   that way no route puts a link on a status message's surface. So the page
 *   is opened with `?links=specimens`, which adds one link inside each of the
 *   four real `StatusMessage` tones; they are counted apart from a route's own
 *   links, and each must be found on its own message's surface.
 *
 * ## What this does NOT prove
 *
 * - **`:visited`.** A browser reports a visited link's computed style as if it
 *   were unvisited — a privacy rule every engine applies, because otherwise a
 *   page could read a reader's history one `getComputedStyle` at a time. So no
 *   gate running in a browser can read `linkVisited` back, and this one does
 *   not pretend to. The visited state is held by `theme.a11y.test.ts` §"paints
 *   every link state with its own token" (the rule reads the token) and by
 *   `contrast.a11y.test.ts` (the token clears every surface).
 * - Anything about a link the shell does not render with no ports — a ride's
 *   name in the activity list, for one. Those are the same `a` with the same
 *   rule; what this cannot see is one that sits on a surface nobody declared.
 * - The surface is read from the DOM ancestry, not from what is under the
 *   pixel. A link absolutely positioned over something that is not its
 *   ancestor would be checked against the wrong surface; none is today.
 */

import { expect, test, type Page } from '@playwright/test';

import {
  COLOUR_TOKENS,
  CONTRAST_REQUIREMENTS,
  type ColourToken,
  type LinkStateToken,
} from '../src/design/tokens';
import { ALL_ROUTES, hrefFor } from '../src/shell/routes';

/** `#0b5c55` → `rgb(11, 92, 85)`, which is how Chromium reports a computed colour. */
function computedForm(hex: string): string {
  const value = Number.parseInt(hex.slice(1), 16);
  return `rgb(${String(value >> 16)}, ${String((value >> 8) & 0xff)}, ${String(value & 0xff)})`;
}

/**
 * Every token each computed colour could be. Several tokens share a value —
 * `canvas` and `accentInk` are both white, `accent` and `link` the same teal —
 * so a colour names a SET of tokens and a pair is declared if any combination
 * of the two sets is.
 */
const TOKENS_BY_COLOUR = new Map<string, ColourToken[]>();
for (const [token, hex] of Object.entries(COLOUR_TOKENS) as [ColourToken, string][]) {
  const key = computedForm(hex);
  TOKENS_BY_COLOUR.set(key, [...(TOKENS_BY_COLOUR.get(key) ?? []), token]);
}

function isDeclaredPair(foreground: string, background: string): boolean {
  const fronts = TOKENS_BY_COLOUR.get(foreground) ?? [];
  const backs = TOKENS_BY_COLOUR.get(background) ?? [];
  return CONTRAST_REQUIREMENTS.some(
    (requirement) =>
      fronts.includes(requirement.foreground) && backs.includes(requirement.background),
  );
}

function stateColour(token: LinkStateToken): string {
  return computedForm(COLOUR_TOKENS[token]);
}

/** The browser's own link colour, which is what #661 found on every inline link. */
const USER_AGENT_LINK = 'rgb(0, 0, 238)';

interface MeasuredLink {
  readonly text: string;
  readonly className: string;
  readonly colour: string;
  readonly underline: string;
  readonly underlineColour: string;
  readonly surface: string;
  /** Inside `shell-harness.tsx`'s link specimens rather than the route's own markup. */
  readonly specimen: boolean;
}

/** Every `a` on the page, read back from the engine. */
async function measureLinks(page: Page): Promise<MeasuredLink[]> {
  return page.evaluate(() => {
    /** The first opaque background at or above an element, as computed. */
    function surfaceBehind(element: Element): string {
      for (let at: Element | null = element; at !== null; at = at.parentElement) {
        const background = getComputedStyle(at).backgroundColor;
        const alpha = /rgba\([^)]*,\s*([\d.]+)\)/.exec(background)?.[1];
        if (alpha === undefined) {
          return background;
        }
        if (Number(alpha) > 0) {
          // Translucent: not a token and not a surface a pair can describe,
          // so it is returned as it is and the pair check reports it.
          return background;
        }
      }
      return 'no opaque surface';
    }
    return [...document.querySelectorAll('a')].map((link) => {
      const style = getComputedStyle(link);
      return {
        text: (link.textContent ?? '').trim().slice(0, 60),
        className: link.className,
        colour: style.color,
        underline: style.textDecorationLine,
        underlineColour: style.textDecorationColor,
        surface: surfaceBehind(link),
        specimen: link.closest('[data-oyl-link-specimen]') !== null,
      };
    });
  });
}

/**
 * Open one route in a fresh document. The query string makes each a real
 * navigation rather than a same-document hash change, so nothing one route
 * left behind — a focus, a hover — is inherited by the next.
 */
async function openRoute(page: Page, route: (typeof ALL_ROUTES)[number]): Promise<void> {
  await page.goto(`/shell.html?links=specimens&route=${route.id}${hrefFor(route)}`);
  await page.waitForSelector('html[data-oyl-shell-ready]');
}

/** The surfaces only the harness's link specimens put a link on — see `shell-harness.tsx`. */
const STATUS_SURFACES: readonly ColourToken[] = [
  'infoSurface',
  'successSurface',
  'warningSurface',
  'dangerSurface',
];

/** A link in running text: an `a` that no class of its own restyles. */
const INLINE_LINK = 'a:not([class])';

test.describe('links — #661', () => {
  test('every link on every route paints with a token, over a declared pair', async ({ page }) => {
    const faults: string[] = [];
    let measured = 0;
    let inline = 0;
    let routes = 0;
    const specimenSurfaces = new Set<ColourToken>();
    for (const route of ALL_ROUTES) {
      await openRoute(page, route);
      routes += 1;
      for (const link of await measureLinks(page)) {
        measured += 1;
        if (link.specimen) {
          for (const token of TOKENS_BY_COLOUR.get(link.surface) ?? []) {
            specimenSurfaces.add(token);
          }
        } else if (link.className === '') {
          inline += 1;
        }
        if (link.className === '') {
          if (link.colour !== stateColour('link')) {
            faults.push(`${route.id}: "${link.text}" at rest is ${link.colour}, not \`link\``);
          }
        }
        const where = `${route.id}: "${link.text}"${link.className === '' ? '' : ` (.${link.className})`}`;
        if (!TOKENS_BY_COLOUR.has(link.colour)) {
          faults.push(`${where} is ${link.colour}, which is no token`);
        }
        if (!TOKENS_BY_COLOUR.has(link.underlineColour)) {
          faults.push(`${where} is underlined in ${link.underlineColour}, which is no token`);
        }
        if (!TOKENS_BY_COLOUR.has(link.surface)) {
          faults.push(`${where} sits on ${link.surface}, which is no token surface`);
        } else if (!isDeclaredPair(link.colour, link.surface)) {
          faults.push(
            `${where} is ${link.colour} on ${link.surface}, a pair CONTRAST_REQUIREMENTS does not declare`,
          );
        }
        if (link.className === '' && !link.underline.includes('underline')) {
          faults.push(`${where} is not underlined, so only its colour says it is a link`);
        }
      }
    }
    // The walk counts what it measured, because every assertion above is true
    // of an empty list: a derivation that produced no routes, or a harness
    // that rendered no link in running text on any of them, would pass it.
    console.log(
      `#661: ${String(measured)} links, ${String(inline)} in running text, over ${String(routes)} routes`,
    );
    expect(ALL_ROUTES.length).toBeGreaterThan(0);
    expect(routes).toBe(ALL_ROUTES.length);
    expect(measured).toBeGreaterThan(0);
    expect(inline, 'no route rendered a link in running text of its own').toBeGreaterThan(0);
    // The specimens are only worth their place if each one really sat on its
    // message's surface: a StatusMessage that stopped painting one would put
    // all four on the canvas, and every pair would still be declared.
    expect([...STATUS_SURFACES].filter((surface) => !specimenSurfaces.has(surface))).toEqual([]);
    expect(faults).toEqual([]);
  });

  test('a link under a pointer, focused from the keyboard and pressed paints its own token', async ({
    page,
  }) => {
    let driven = 0;
    const faults: string[] = [];
    for (const route of ALL_ROUTES) {
      await openRoute(page, route);
      // A press ends in a click, and a click on a hash link navigates — which
      // would re-render the page under the loop. Cancelled in the capture phase.
      await page.evaluate(() => {
        document.addEventListener(
          'click',
          (event) => {
            event.preventDefault();
          },
          { capture: true },
        );
      });
      const links = page.locator(INLINE_LINK);
      const count = await links.count();
      for (let index = 0; index < count; index += 1) {
        const link = links.nth(index);
        if (!(await link.isVisible())) {
          continue;
        }
        const name = `${route.id}: "${((await link.textContent()) ?? '').trim()}"`;

        await link.hover();
        const hovered = await link.evaluate((element) => ({
          state: element.matches(':hover'),
          colour: getComputedStyle(element).color,
          underline: getComputedStyle(element).textDecorationLine,
        }));
        expect(hovered.state, `${name} never came under the pointer`).toBe(true);
        if (hovered.colour !== stateColour('linkHover')) {
          faults.push(`${name} under a pointer is ${hovered.colour}`);
        }
        if (!hovered.underline.includes('underline')) {
          faults.push(`${name} loses its underline under a pointer`);
        }

        const box = await link.boundingBox();
        if (box !== null) {
          await page.mouse.down();
          const pressed = await link.evaluate((element) => ({
            state: element.matches(':active'),
            colour: getComputedStyle(element).color,
          }));
          await page.mouse.up();
          expect(pressed.state, `${name} was never pressed`).toBe(true);
          if (pressed.colour !== stateColour('linkActive')) {
            faults.push(`${name} while pressed is ${pressed.colour}`);
          }
        }

        // Off the link, so the focus colour is not the hover colour by accident.
        await page.mouse.move(0, 0);
        // A key press first, so the engine's focus-visible heuristic treats the
        // next focus as a keyboard one — asserted below rather than assumed.
        await page.keyboard.press('Shift');
        await link.focus();
        const focused = await link.evaluate((element) => ({
          state: element.matches(':focus-visible'),
          hovered: element.matches(':hover'),
          colour: getComputedStyle(element).color,
          underline: getComputedStyle(element).textDecorationLine,
        }));
        expect(focused.state, `${name} never matched :focus-visible`).toBe(true);
        expect(focused.hovered, `${name} was still under the pointer`).toBe(false);
        if (focused.colour !== stateColour('linkHover')) {
          faults.push(`${name} focused from the keyboard is ${focused.colour}`);
        }
        if (!focused.underline.includes('underline')) {
          faults.push(`${name} loses its underline when focused`);
        }
        await link.blur();
        driven += 1;
      }
    }
    console.log(`#661: ${String(driven)} links driven through hover, press and focus`);
    expect(driven).toBeGreaterThan(0);
    expect(faults).toEqual([]);
  });

  test('the control — with the `a` rules taken out, a link is the browser’s blue again', async ({
    page,
  }) => {
    let stripped = 0;
    const offToken: string[] = [];
    for (const route of ALL_ROUTES) {
      await openRoute(page, route);
      stripped += await page.evaluate(() => {
        let removed = 0;
        for (const sheet of document.styleSheets) {
          const rules = sheet.cssRules;
          for (let index = rules.length - 1; index >= 0; index -= 1) {
            const rule = rules[index];
            if (rule instanceof CSSStyleRule && rule.selectorText.startsWith(':where(a')) {
              sheet.deleteRule(index);
              removed += 1;
            }
          }
        }
        return removed;
      });
      for (const link of await measureLinks(page)) {
        if (!TOKENS_BY_COLOUR.has(link.colour)) {
          offToken.push(link.colour);
        }
      }
    }
    // Four per route: the resting, visited, hover-and-focus and pressed rules.
    // Zero would mean the selector moved and this control stripped nothing.
    expect(stripped).toBe(ALL_ROUTES.length * 4);
    expect(offToken.length).toBeGreaterThan(0);
    expect(offToken).toContain(USER_AGENT_LINK);
  });
});
