// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The menus' Phase 1 look, as the pinned Chromium paints it — #992, the
 * owner's rulings of 2026-10-02 on epic #935.
 *
 * `theme.a11y.test.ts` holds `theme.css` to the tokens and jsdom performs no
 * cascade, so neither can say what a tile or a title is DRAWN as once every
 * rule has met every other. This walks every route in `shell/routes.ts`
 * §`ALL_ROUTES` on the reflow harness's POPULATED page (`reflow.html`, the
 * real `AppShell` over in-memory ports), in both palettes, and reads back:
 *
 * - **every filled tile** — a panel, a list item, an empty state, a Settings
 *   card, a Home ride card — is `surfaceRaised` with NO border and the card
 *   radius (`--oyl-radius-card`, 12 px);
 * - **every view's title** is the display step, at the heaviest weight, in the
 *   display face (`--oyl-font-family-display`).
 *
 * ## The controls
 *
 * The `.oyl-panel` rule and the `h1, .oyl-display` rule are deleted from the
 * shipping sheet through the CSSOM, and Analysis' panels and title must then
 * FAIL the same reads. Without them a walk that found the right colours on a
 * page where the rules never applied would be indistinguishable from this one.
 *
 * ## What this does NOT prove
 *
 * That the tiles read as tiles to a person: the step from `canvas` to
 * `surfaceRaised` is 1.21:1 (light) and 1.23:1 (dark), inside
 * `tokens.ts` §`MAXIMUM_ELEVATION_STEP`, and whether that is enough without an
 * outline is the owner's look on a real screen.
 */

import { expect, test, type Page } from '@playwright/test';

import { FONT_SIZE_TOKENS, THEMES, paletteColours, type Theme } from '../src/design/tokens';
import { ALL_ROUTES, hrefFor, type RouteDefinition } from '../src/shell/routes';

/** Every element drawn as a filled tile. A panel inside a Settings card is the card's. */
const TILES = [
  'main .oyl-panel:not(.oyl-settings-card .oyl-panel)',
  'main .oyl-pane-list__item',
  'main .oyl-empty-state',
  'main .oyl-settings-card',
  'main .oyl-ride-card',
].join(', ');

/** `--oyl-radius-card`, 0.75rem at the root's 16 px. */
const CARD_RADIUS = '12px';

/** `theme.css` §`--oyl-font-family-display`, as Chromium reports a computed family. */
const DISPLAY_FAMILY = 'system-ui, -apple-system, "Segoe UI", sans-serif';

interface Look {
  readonly routeId: string | null;
  readonly title: {
    readonly size: number;
    readonly weight: number;
    readonly family: string;
  } | null;
  readonly tiles: readonly {
    readonly what: string;
    readonly background: string;
    readonly border: number;
    readonly radius: string;
  }[];
}

function rgb(theme: Theme, token: 'surfaceRaised'): string {
  const hex = paletteColours(theme)[token];
  const channel = (at: number): number => Number.parseInt(hex.slice(at, at + 2), 16);
  return `rgb(${String(channel(1))}, ${String(channel(3))}, ${String(channel(5))})`;
}

async function open(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 800 });
  const response = await page.goto('/reflow.html?data=populated');
  expect(response?.status(), 'reflow.html did not load').toBe(200);
  await page.waitForFunction(() => window.__oylReflow?.ready === true);
}

async function hashFor(page: Page, route: RouteDefinition): Promise<string | undefined> {
  if (!route.path.split('/').some((segment) => segment.startsWith(':'))) {
    return hrefFor(route);
  }
  const parameter = await page.evaluate((id) => window.__oylReflow?.parameters[id], route.id);
  return parameter === undefined ? undefined : hrefFor(route, parameter);
}

async function lookAt(page: Page, hash: string): Promise<Look> {
  const seen = await page.evaluate(async (target) => window.__oylReflow?.visit(target), hash);
  return page.evaluate(
    ({ selector, routeId }) => {
      const heading = document.querySelector('main h1, h1');
      const style = heading === null ? null : getComputedStyle(heading);
      return {
        routeId,
        title:
          style === null
            ? null
            : {
                size: Number.parseFloat(style.fontSize),
                weight: Number(style.fontWeight),
                family: style.fontFamily,
              },
        tiles: [...document.querySelectorAll<HTMLElement>(selector)]
          .filter((tile) => tile.checkVisibility())
          .map((tile) => {
            const tileStyle = getComputedStyle(tile);
            return {
              what: tile.className,
              background: tileStyle.backgroundColor,
              border: Number.parseFloat(tileStyle.borderTopWidth),
              radius: tileStyle.borderTopLeftRadius,
            };
          }),
      };
    },
    { selector: TILES, routeId: seen?.routeId ?? null },
  );
}

/** Everything about one route that is not the Phase 1 look. Empty is a pass. */
function lookFaults(where: string, look: Look, theme: Theme): string[] {
  const faults: string[] = [];
  const display = Number.parseFloat(FONT_SIZE_TOKENS.display) * 16;
  if (look.title === null) {
    faults.push(`${where}: no title`);
  } else {
    if (Math.abs(look.title.size - display) > 0.1) {
      faults.push(`${where}: the title is ${String(look.title.size)} px, not the display step`);
    }
    if (look.title.weight < 800) {
      faults.push(`${where}: the title's weight is ${String(look.title.weight)}`);
    }
    if (look.title.family !== DISPLAY_FAMILY) {
      faults.push(`${where}: the title is set in ${look.title.family}`);
    }
  }
  for (const tile of look.tiles) {
    if (tile.background !== rgb(theme, 'surfaceRaised')) {
      faults.push(`${where}: "${tile.what}" is filled ${tile.background}`);
    }
    if (tile.border !== 0)
      faults.push(`${where}: "${tile.what}" has a ${String(tile.border)} px edge`);
    if (tile.radius !== CARD_RADIUS) {
      faults.push(`${where}: "${tile.what}" has a ${tile.radius} corner`);
    }
  }
  return faults;
}

for (const theme of THEMES) {
  test.describe(`#992 — the menus' look, ${theme} palette`, () => {
    test.use({ colorScheme: theme });

    test('every route: filled tiles with no outline, and a display title', async ({ page }) => {
      test.setTimeout(120_000);
      await open(page);
      expect(await page.evaluate(() => document.documentElement.dataset['theme'])).toBe(theme);
      const faults: string[] = [];
      let tiles = 0;
      for (const route of ALL_ROUTES) {
        const hash = await hashFor(page, route);
        if (hash === undefined) {
          faults.push(`${route.id}: parameterised and the harness has no fixture id`);
          continue;
        }
        const look = await lookAt(page, hash);
        tiles += look.tiles.length;
        faults.push(...lookFaults(route.id, look, theme));
      }
      expect(faults).toEqual([]);
      // A walk that found no tile at all read nothing.
      expect(tiles, 'no filled tile on any route').toBeGreaterThan(10);
    });
  });
}

test.describe('#992 — the controls', () => {
  test.use({ colorScheme: 'dark' });

  test('without the panel rule and the title rule, Analysis fails the same reads', async ({
    page,
  }) => {
    await open(page);
    const removed = await page.evaluate(() => {
      let count = 0;
      for (const sheet of [...document.styleSheets]) {
        for (let index = sheet.cssRules.length - 1; index >= 0; index -= 1) {
          const rule = sheet.cssRules[index];
          if (
            rule instanceof CSSStyleRule &&
            (rule.selectorText === '.oyl-panel' || rule.selectorText === 'h1, .oyl-display')
          ) {
            sheet.deleteRule(index);
            count += 1;
          }
        }
      }
      return count;
    });
    expect(removed, 'the two rules were not found to remove').toBe(2);
    // Not Home: its hero title has a display rule of its own (theme.css §"Home").
    const analysis = ALL_ROUTES.find((route) => route.id === 'analysis');
    if (analysis === undefined) throw new Error('no analysis route');
    const look = await lookAt(page, hrefFor(analysis));
    expect(look.tiles.length, 'Analysis drew no panel to read').toBeGreaterThan(0);
    const faults = lookFaults('analysis', look, 'dark');
    expect(faults.some((fault) => fault.includes('is filled'))).toBe(true);
    expect(faults.some((fault) => fault.includes('weight') || fault.includes('display'))).toBe(
      true,
    );
  });
});
