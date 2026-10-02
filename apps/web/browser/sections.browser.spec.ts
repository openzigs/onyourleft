// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Tablet layouts that use the space — #1014, epic #935 Phase 2, measured in
 * the pinned Chromium.
 *
 * Every route `shell/routes.ts` §`ALL_ROUTES` declares `sections` — imported,
 * never listed here (#142's rule) — is opened in `reflow.html` (the real
 * `AppShell` over `testing/populated-shell.tsx`'s fixtures, #660) on the
 * owner's tablet in the shell, both ways up with the #439 insets applied to
 * the engine, and its sections are counted into columns: the distinct left
 * edges of `.oyl-sections`' children that do not span it. And the detail
 * panes of Routes and Workouts, which are columned by their pane's own
 * container query rather than by `main`'s.
 *
 * What is held:
 *
 * - **Landscape uses the width.** On every `sections` route `main` reaches
 *   the viewport's right edge rather than stopping at the reading measure, its
 *   sections lie in at least two columns, and Devices' garage (#942) holds at
 *   least three cards in a row — two was all the measure left it.
 * - **Upright, two columns where content allows.** Every `sections` route but
 *   two: Settings, whose broad cards keep one column there so a segmented
 *   choice keeps its one row (`theme.css` §"Broad sections"), and Devices,
 *   whose garage was already two cards wide upright.
 * - **The line under the title keeps the reading measure** wherever `main`
 *   dropped it.
 * - **A phone is unchanged**: one column on every one of these routes.
 * - **The detail panes**: Routes with nothing chosen and with a route chosen,
 *   and Workouts with nothing chosen, in two columns both ways up.
 *
 * What is NOT held here, because other gates already hold it unchanged by
 * #1014: the first control above the fold with the 50 px floor both ways up
 * (`controls-first.browser.spec.ts`), reflow at 320 px and on a phone on its
 * side (`reflow.browser.spec.ts`), the list–detail panes (`list-detail`), and
 * the kept-visible text (`a11y/kept-visible.a11y.test.tsx`). CSS columns keep
 * the DOM's order, so the reading and tab order are not something this layout
 * can change.
 *
 * ## The controls
 *
 * - `?sections=prose` puts the `sections` routes of the real table back on the
 *   reading measure, so `main` is no container. Every route must then fail:
 *   one column, `main` short of the edge, a garage two cards wide.
 * - `?sections=uncontained` takes the container off the detail pane. Each
 *   detail pane must then be one column.
 */

import { expect, test, type Page } from '@playwright/test';

import { ALL_ROUTES, type RouteDefinition } from '../src/shell/routes';

import {
  applyInsets,
  NO_INSETS,
  PIXEL_TABLET_LANDSCAPE_INSETS,
  PIXEL_TABLET_PORTRAIT_INSETS_ASSUMED,
  resolvedInsets,
  type Insets,
} from './insets';

interface Viewport {
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly insets: Insets;
}

const TABLET_IN_THE_SHELL: Viewport = {
  name: 'tablet in the shell 1280×800, insets 36/32',
  width: 1280,
  height: 800,
  insets: PIXEL_TABLET_LANDSCAPE_INSETS,
};
const TABLET_UPRIGHT: Viewport = {
  name: 'tablet upright 800×1280, insets 36/32 (assumed)',
  width: 800,
  height: 1280,
  insets: PIXEL_TABLET_PORTRAIT_INSETS_ASSUMED,
};
const PHONE: Viewport = { name: 'phone 390×844', width: 390, height: 844, insets: NO_INSETS };

const SECTIONS = ALL_ROUTES.filter((route) => route.layout === 'sections');

/** Upright, these keep one column of sections — and why is in the file header. */
const ONE_COLUMN_UPRIGHT: readonly string[] = ['settings', 'devices'];

/** Within this of the viewport's right edge counts as reaching it: `main`'s own padding. */
const EDGE_SLACK_PIXELS = 32;

/** The detail panes #1014 columns, as `#/<route>` or `#/<route>/selected/<id>`. */
const DETAIL_PANES = [
  { route: 'routes', selected: false },
  { route: 'routes', selected: true },
  { route: 'workouts', selected: false },
] as const;

/** What a screen of sections lays out, read back from the engine. */
interface SectionsLayout {
  readonly h1: string | null;
  /** Distinct left edges of the children of `.oyl-sections` that span no columns. */
  readonly columns: number;
  /** How many children were counted — a page that rendered none has no columns either. */
  readonly counted: number;
  /** The most of Devices' garage cards that share one row, or `null` with no garage. */
  readonly garageRow: number | null;
  /** `main`'s right edge, against the viewport's width. */
  readonly mainRight: number;
  readonly viewportWidth: number;
  /** The line under the title: its width, and the `max-width` it is held to. */
  readonly summaryWidth: number | null;
  readonly summaryMaxWidth: string | null;
}

async function open(page: Page, viewport: Viewport, control = ''): Promise<void> {
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  await applyInsets(page, viewport.insets);
  // `bluetooth=available` so Devices renders its garage (#699's review, N4);
  // no other route reads it.
  const response = await page.goto(`/reflow.html?data=populated&bluetooth=available${control}`);
  expect(
    response?.status(),
    'reflow.html did not load — is it named in vite.browser.config.ts build.rollupOptions.input?',
  ).toBe(200);
  await page.waitForFunction(() => window.__oylReflow !== undefined);
  expect(await page.evaluate(() => window.__oylReflow?.errors)).toEqual([]);
  expect(await page.evaluate(() => window.__oylReflow?.ready)).toBe(true);
  expect(await resolvedInsets(page)).toEqual(viewport.insets);
}

/** Opens `hash` and reads the sections inside `root` (a selector) back from the engine. */
async function layoutAt(page: Page, hash: string, root: string): Promise<SectionsLayout> {
  const seen = await page.evaluate(async (target) => window.__oylReflow?.visit(target), hash);
  expect(seen?.settledWithinPatience, `${hash} did not settle`).toBe(true);
  expect(seen?.errors, `${hash} raised an error`).toEqual([]);
  return page.evaluate((selector): SectionsLayout => {
    const main = document.querySelector('main');
    const scope = document.querySelector(selector);
    const grid = scope?.querySelector('.oyl-sections') ?? null;
    const lefts = new Set<number>();
    let counted = 0;
    if (grid !== null) {
      for (const child of grid.children) {
        const box = child.getBoundingClientRect();
        // Spanning every column (a title, a table) is not a column; nor is a
        // child with no box.
        if (box.width === 0 || box.height === 0 || getComputedStyle(child).columnSpan === 'all') {
          continue;
        }
        counted += 1;
        lefts.add(Math.round(box.left));
      }
    }
    let garageRow: number | null = null;
    const cards = [...document.querySelectorAll('main .oyl-pairing > li')];
    if (cards.length > 0) {
      const rows = new Map<number, number>();
      for (const card of cards) {
        const top = Math.round(card.getBoundingClientRect().top);
        rows.set(top, (rows.get(top) ?? 0) + 1);
      }
      garageRow = Math.max(...rows.values());
    }
    const summary = document.querySelector('main > h1 + p');
    return {
      h1: document.querySelector('main > h1')?.textContent ?? null,
      columns: lefts.size,
      counted,
      garageRow,
      mainRight: main?.getBoundingClientRect().right ?? 0,
      viewportWidth: window.innerWidth,
      summaryWidth: summary?.getBoundingClientRect().width ?? null,
      summaryMaxWidth: summary === null ? null : getComputedStyle(summary).maxWidth,
    };
  }, root);
}

function hashOf(route: RouteDefinition): string {
  return `#${route.path}`;
}

test.describe('#1014 — a screen of sections uses a tablet’s width', () => {
  test('the walk finds the screens #1014 names', () => {
    expect(SECTIONS.map((route) => route.id).sort()).toEqual([
      'about',
      'analysis',
      'camera',
      'devices',
      'segments',
      'settings',
      'transfer',
    ]);
  });

  test(`landscape — ${TABLET_IN_THE_SHELL.name}: columns, the full width, a measured line`, async ({
    page,
  }) => {
    await open(page, TABLET_IN_THE_SHELL);
    const report: string[] = [];
    for (const route of SECTIONS) {
      const seen = await layoutAt(page, hashOf(route), 'main');
      expect(seen.h1, `${route.id} did not render its own page`).toBe(route.title);
      report.push(
        `  ${route.id}: ${String(seen.columns)} columns of ${String(seen.counted)} sections` +
          `${seen.garageRow === null ? '' : `, garage ${String(seen.garageRow)} a row`}` +
          `, main ends ${String(Math.round(seen.viewportWidth - seen.mainRight))} px from the edge`,
      );
      expect(
        seen.viewportWidth - seen.mainRight,
        `${route.id}: main stops short of the viewport's edge`,
      ).toBeLessThanOrEqual(EDGE_SLACK_PIXELS);
      if (seen.garageRow === null) {
        expect(seen.columns, `${route.id}: its sections are not in columns`).toBeGreaterThanOrEqual(
          2,
        );
      } else {
        expect(
          seen.garageRow,
          `${route.id}: the garage is not three cards wide`,
        ).toBeGreaterThanOrEqual(3);
      }
      expect(
        seen.summaryMaxWidth,
        `${route.id}: the line under the title lost its measure`,
      ).not.toBe('none');
      // A pixel for the engine's rounding of the measure's `ch` to three places.
      expect(seen.summaryWidth ?? 0).toBeLessThanOrEqual(
        Number.parseFloat(seen.summaryMaxWidth ?? '0') + 1,
      );
    }
    console.log(`[#1014] ${TABLET_IN_THE_SHELL.name}\n${report.join('\n')}`);
  });

  test(`upright — ${TABLET_UPRIGHT.name}: two columns where content allows`, async ({ page }) => {
    await open(page, TABLET_UPRIGHT);
    const report: string[] = [];
    for (const route of SECTIONS) {
      const seen = await layoutAt(page, hashOf(route), 'main');
      expect(seen.h1, `${route.id} did not render its own page`).toBe(route.title);
      report.push(
        `  ${route.id}: ${String(seen.columns)} columns of ${String(seen.counted)} sections` +
          `${seen.garageRow === null ? '' : `, garage ${String(seen.garageRow)} a row`}`,
      );
      if (ONE_COLUMN_UPRIGHT.includes(route.id)) {
        expect(seen.columns, `${route.id}: expected one column upright`).toBeLessThanOrEqual(1);
      } else {
        expect(seen.columns, `${route.id}: its sections are not in columns`).toBeGreaterThanOrEqual(
          2,
        );
      }
    }
    console.log(`[#1014] ${TABLET_UPRIGHT.name}\n${report.join('\n')}`);
  });

  test(`a phone is unchanged — ${PHONE.name}: one column`, async ({ page }) => {
    await open(page, PHONE);
    for (const route of SECTIONS) {
      const seen = await layoutAt(page, hashOf(route), 'main');
      expect(seen.h1, `${route.id} did not render its own page`).toBe(route.title);
      expect(seen.columns, `${route.id}: columns on a phone`).toBeLessThanOrEqual(1);
    }
  });

  test('the control — switched back to prose, every route fails in landscape', async ({ page }) => {
    await open(page, TABLET_IN_THE_SHELL, '&sections=prose');
    for (const route of SECTIONS) {
      const seen = await layoutAt(page, hashOf(route), 'main');
      expect(seen.h1, `${route.id} did not render its own page`).toBe(route.title);
      expect(
        seen.viewportWidth - seen.mainRight,
        `${route.id}: main reached the edge without the layout`,
      ).toBeGreaterThan(EDGE_SLACK_PIXELS);
      if (seen.garageRow === null) {
        expect(seen.columns, `${route.id}: columns without the layout`).toBeLessThanOrEqual(1);
      } else {
        expect(seen.garageRow, `${route.id}: three cards wide without the layout`).toBeLessThan(3);
      }
    }
  });
});

test.describe('#1014 — a detail pane decides its own columns', () => {
  for (const viewport of [TABLET_IN_THE_SHELL, TABLET_UPRIGHT]) {
    test(`two columns at ${viewport.name}`, async ({ page }) => {
      await open(page, viewport);
      const selections = await page.evaluate(() => window.__oylReflow?.selections);
      for (const pane of DETAIL_PANES) {
        const id = selections?.[pane.route];
        expect(id, `${pane.route}: the harness names no item to select`).toBeDefined();
        const hash = pane.selected ? `#/${pane.route}/selected/${String(id)}` : `#/${pane.route}`;
        const seen = await layoutAt(page, hash, '.oyl-list-detail__detail:not([hidden])');
        console.log(`[#1014] ${viewport.name} ${hash}: ${String(seen.columns)} columns`);
        expect(seen.columns, `${hash}: the detail pane is not in columns`).toBeGreaterThanOrEqual(
          2,
        );
      }
    });
  }

  test('the control — with no container on the pane, each is one column', async ({ page }) => {
    await open(page, TABLET_IN_THE_SHELL, '&sections=uncontained');
    const selections = await page.evaluate(() => window.__oylReflow?.selections);
    for (const pane of DETAIL_PANES) {
      const id = selections?.[pane.route];
      const hash = pane.selected ? `#/${pane.route}/selected/${String(id)}` : `#/${pane.route}`;
      const seen = await layoutAt(page, hash, '.oyl-list-detail__detail:not([hidden])');
      expect(seen.counted, `${hash}: the pane holds no sections to count`).toBeGreaterThanOrEqual(
        2,
      );
      expect(seen.columns, `${hash}: columns with no container`).toBeLessThanOrEqual(1);
    }
  });
});
