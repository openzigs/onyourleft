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
 * - **Rows, read across** (#1014's review). On every `sections` route at the
 *   tablet both ways up, the sections of one row start level, and the first
 *   section of the next row starts no lower than the tallest section of the
 *   row before ends plus one gap — and no higher than it ends. That is the
 *   row-major property: a rider reads across a row and on to the next, never
 *   1500 px down one column and back up for the second, which is what CSS
 *   columns did (Files 2287 px tall at 1280×800). Each route's height is
 *   published under the grid and under the columns it replaced.
 *
 * - **No section dwarfs its row** (#1026). On Settings and Files in landscape,
 *   in every row of two or more sections, the tallest is at most
 *   {@link ROW_BALANCE_LIMIT} times the shortest. #1025 measured one card of
 *   Settings at 1959 px beside one of 500 (3.9×) and Files' erase panel at
 *   1822 px beside 421 (4.3×). Every route's rows are published both ways up.
 *
 * What is NOT held here, because other gates already hold it unchanged by
 * #1014: the first control above the fold with the 50 px floor both ways up
 * (`controls-first.browser.spec.ts`), reflow at 320 px and on a phone on its
 * side (`reflow.browser.spec.ts`), the list–detail panes (`list-detail`), and
 * the kept-visible text (`a11y/kept-visible.a11y.test.tsx`). The grid places
 * the sections in the DOM's order with no `dense` packing, so the tab order is
 * not something this layout can change; the visual order is row-major, which
 * is what the rows check holds.
 *
 * ## The controls
 *
 * - `?sections=prose` puts the `sections` routes of the real table back on the
 *   reading measure, so `main` is no container. Every route must then fail:
 *   one column, `main` short of the edge, a garage two cards wide.
 * - `?sections=uncontained` takes the container off the detail pane. Each
 *   detail pane must then be one column.
 * - `?sections=columns` deletes the grid through the CSSOM and puts back
 *   #1014's first cut, CSS columns. Every route the grid lays in two or more
 *   rows of two or more columns must then fail the rows check.
 * - Files with its erase section's ⓘ opened puts the list of what an erase
 *   removes back in the section, which is what #1026 took out of it, and its
 *   row must then fail the balance check.
 */

import { expect, test, type Page } from '@playwright/test';

import { RIDE_ROUTE_IDS } from '../src/shell/route-motion';
import { ALL_ROUTES, hrefFor, type RouteDefinition, type RouteId } from '../src/shell/routes';

import {
  applyInsets,
  NO_INSETS,
  PIXEL_TABLET_LANDSCAPE_INSETS,
  PIXEL_TABLET_PORTRAIT_INSETS_ASSUMED,
  resolvedInsets,
  type Insets,
} from './insets';
import { NIGHTLY } from './nightly';

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

/**
 * The detail panes #1014 columns, as `#/<route>` or `#/<route>/selected/<id>`.
 * Routes with nothing chosen is not one since #1442: its second group, the
 * sharing warning, is said beside a chosen route only, so the import is that
 * pane's one group.
 */
const DETAIL_PANES = [
  { route: 'routes', selected: true },
  { route: 'workouts', selected: false },
] as const;

/** One child of `.oyl-sections`, in DOM order. */
interface SectionBox {
  readonly top: number;
  readonly bottom: number;
  /** Across every column: a title, or a section holding a table. */
  readonly spans: boolean;
}

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
  /** Every child with a box, in DOM order. */
  readonly boxes: readonly SectionBox[];
  /** `.oyl-sections`' row gap in pixels; 0 where it is `normal` (columns). */
  readonly rowGap: number;
  /** `.oyl-sections`' own height, and the document's. */
  readonly sectionsHeight: number;
  readonly pageHeight: number;
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
  return readLayout(page, root);
}

/** Reads the sections inside `root` (a selector) back from the engine, as the page stands. */
async function readLayout(page: Page, root: string): Promise<SectionsLayout> {
  return page.evaluate((selector): SectionsLayout => {
    const main = document.querySelector('main');
    const scope = document.querySelector(selector);
    const grid = scope?.querySelector('.oyl-sections') ?? null;
    const lefts = new Set<number>();
    const boxes: SectionBox[] = [];
    let counted = 0;
    if (grid !== null) {
      for (const child of grid.children) {
        const box = child.getBoundingClientRect();
        if (box.width === 0 || box.height === 0) {
          continue;
        }
        // Spanning every column (a title, a table) is not a column: a grid
        // track `1 / -1`, or the first cut's `column-span: all` (the control).
        const style = getComputedStyle(child);
        const spans =
          (getComputedStyle(grid).display === 'grid' && style.gridColumnEnd === '-1') ||
          style.columnSpan === 'all';
        boxes.push({ top: box.top + window.scrollY, bottom: box.bottom + window.scrollY, spans });
        if (spans) {
          continue;
        }
        counted += 1;
        lefts.add(Math.round(box.left));
      }
    }
    const rowGap = grid === null ? 0 : Number.parseFloat(getComputedStyle(grid).rowGap) || 0;
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
    const summary = document.querySelector('main > .oyl-view-head > h1 + p');
    return {
      h1: document.querySelector('main > .oyl-view-head > h1')?.textContent ?? null,
      columns: lefts.size,
      counted,
      garageRow,
      mainRight: main?.getBoundingClientRect().right ?? 0,
      viewportWidth: window.innerWidth,
      summaryWidth: summary?.getBoundingClientRect().width ?? null,
      summaryMaxWidth: summary === null ? null : getComputedStyle(summary).maxWidth,
      boxes,
      rowGap,
      sectionsHeight: grid?.getBoundingClientRect().height ?? 0,
      pageHeight: document.documentElement.scrollHeight,
    };
  }, root);
}

/** A pixel for the engine's rounding of a box's edges. */
const ROUNDING_PIXELS = 1;

/**
 * The rows `columns` columns make of `boxes` placed row by row in DOM order:
 * a spanning child is a row of its own, and any other fills the current row
 * until it holds `columns`. This is how the grid auto-places them with no
 * `dense`, so it is also the order a rider should read them in.
 */
function rowsOf(boxes: readonly SectionBox[], columns: number): SectionBox[][] {
  const rows: SectionBox[][] = [];
  let current: SectionBox[] = [];
  for (const box of boxes) {
    if (box.spans) {
      if (current.length > 0) rows.push(current);
      rows.push([box]);
      current = [];
      continue;
    }
    current.push(box);
    if (current.length === Math.max(columns, 1)) {
      rows.push(current);
      current = [];
    }
  }
  if (current.length > 0) rows.push(current);
  return rows;
}

/**
 * Every way `seen` is not row-major, in words: a row whose sections do not
 * start level, or a row that does not start between where the row before it
 * ends and one gap below that. Empty when it is.
 */
function rowMajorFaults(seen: SectionsLayout): string[] {
  // One column is a stack, whatever its margins: there is no row to read across.
  if (seen.columns < 2) return [];
  const rows = rowsOf(seen.boxes, seen.columns);
  const faults: string[] = [];
  rows.forEach((row, index) => {
    const tops = row.map((box) => box.top);
    const spread = Math.max(...tops) - Math.min(...tops);
    if (spread > ROUNDING_PIXELS) {
      faults.push(
        `row ${String(index + 1)}'s sections start ${String(Math.round(spread))} px apart`,
      );
    }
    const before = rows[index - 1];
    if (before === undefined) return;
    const ends = Math.max(...before.map((box) => box.bottom));
    const starts = Math.min(...tops);
    if (starts > ends + seen.rowGap + ROUNDING_PIXELS || starts < ends - ROUNDING_PIXELS) {
      faults.push(
        `row ${String(index + 1)} starts ${String(Math.round(starts - ends))} px from the end of ` +
          `row ${String(index)} (gap ${String(seen.rowGap)} px)`,
      );
    }
  });
  return faults;
}

/** Rows of two or more sections side by side, which is what a row check can say anything about. */
function hasSideBySideRows(seen: SectionsLayout): boolean {
  const rows = rowsOf(seen.boxes, seen.columns);
  return seen.columns >= 2 && rows.filter((row) => row.length >= 2).length >= 2;
}

/**
 * That the page holds what a "one column" or "no faults" reading is about — #1132's
 * review (N1). Fewer than two columns and no row faults are both true of a `main`
 * with nothing in it, which is what a page still showing its `Suspense` fallback
 * is: three cases passed over exactly that. Every `sections` route lays out two or
 * more sections (Segments, the fewest, has 2 in landscape), except Devices, which
 * has none and is read by its garage, so it must have cards.
 */
function expectSomethingToCount(seen: SectionsLayout, label: string): void {
  if (seen.garageRow === null) {
    expect(seen.counted, `${label}: no sections to count`).toBeGreaterThanOrEqual(2);
  } else {
    expect(seen.garageRow, `${label}: no garage cards to count`).toBeGreaterThanOrEqual(1);
  }
}

/**
 * A route's address on the harness. Since #2067 a `sections` route can take a
 * parameter (a ride's own page), which only the harness's fixtures can name.
 */
async function hashOf(page: Page, route: RouteDefinition): Promise<string> {
  if (!route.path.split('/').some((segment) => segment.startsWith(':'))) {
    return hrefFor(route);
  }
  const parameter = await page.evaluate((id) => window.__oylReflow?.parameters[id], route.id);
  if (parameter === undefined) {
    throw new Error(`${route.id}: parameterised and the harness has no fixture id`);
  }
  return hrefFor(route, parameter);
}

/*
 * `.oyl-sections__fits-column` promises that the section's table fits one grid
 * track (#2195). Nothing else measures that: a table that gained a column would
 * scroll sideways in its column with every count above still green.
 */
async function fitsColumnOverflow(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(
      document.querySelectorAll<HTMLElement>('.oyl-sections__fits-column .oyl-scroll-region'),
    )
      .filter((region) => region.scrollWidth > region.clientWidth)
      .map((region) => `${String(region.scrollWidth)} > ${String(region.clientWidth)}`),
  );
}

/*
 * The two #1014 describes below run NIGHTLY since #1137, on the owner's ruling
 * of 2026-10-05 (`nightly.ts`). What stays required on these screens: #1014's
 * detail panes and #1026's row balance (below them), the first control above
 * the fold both ways up on the tablet (`controls-first`), and reflow at 320 px
 * and on a phone (`reflow`).
 */
test.describe('#1014 — a screen of sections uses a tablet’s width', { tag: NIGHTLY }, () => {
  test('the walk finds the screens #1014 names, and those #2067 added', () => {
    expect(SECTIONS.map((route) => route.id).sort()).toEqual([
      'about',
      'activity-detail',
      'analysis',
      'camera',
      'credits',
      'devices',
      'instance',
      'more',
      'route-builder',
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
      const seen = await layoutAt(page, await hashOf(page, route), 'main');
      expect(seen.h1, `${route.id} did not render its own page`).toBe(route.title);
      expect(
        await fitsColumnOverflow(page),
        `${route.id}: a section kept in one column scrolls sideways`,
      ).toEqual([]);
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
      const seen = await layoutAt(page, await hashOf(page, route), 'main');
      expect(seen.h1, `${route.id} did not render its own page`).toBe(route.title);
      expect(
        await fitsColumnOverflow(page),
        `${route.id}: a section kept in one column scrolls sideways`,
      ).toEqual([]);
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
      const seen = await layoutAt(page, await hashOf(page, route), 'main');
      expect(seen.h1, `${route.id} did not render its own page`).toBe(route.title);
      expectSomethingToCount(seen, route.id);
      expect(seen.columns, `${route.id}: columns on a phone`).toBeLessThanOrEqual(1);
    }
  });

  test('the control — switched back to prose, every route fails in landscape', async ({ page }) => {
    await open(page, TABLET_IN_THE_SHELL, '&sections=prose');
    for (const route of SECTIONS) {
      const seen = await layoutAt(page, await hashOf(page, route), 'main');
      expect(seen.h1, `${route.id} did not render its own page`).toBe(route.title);
      expectSomethingToCount(seen, route.id);
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

test.describe('#1014 — the sections are read across, in rows', { tag: NIGHTLY }, () => {
  for (const viewport of [TABLET_IN_THE_SHELL, TABLET_UPRIGHT]) {
    test(`row-major at ${viewport.name}, and fails under the first cut's columns`, async ({
      page: grid,
      context,
    }) => {
      const columns = await context.newPage();
      await open(grid, viewport);
      await open(columns, viewport, '&sections=columns');
      const report: string[] = [];
      for (const route of SECTIONS) {
        const now = await layoutAt(grid, await hashOf(grid, route), 'main');
        const before = await layoutAt(columns, await hashOf(columns, route), 'main');
        expect(now.h1, `${route.id} did not render its own page`).toBe(route.title);
        expect(before.h1, `${route.id} did not render its own page (control)`).toBe(route.title);
        expectSomethingToCount(now, route.id);
        // #2067's screens were never laid out by #1014's first cut — they were
        // prose — so the cut's columns are no "before" for them: the route
        // builder's two groups come out as one fragmented box under it.
        if (!WIDENED_BY_2067.includes(route.id)) {
          expectSomethingToCount(before, `${route.id} (control)`);
        }
        const beforeFaults = rowMajorFaults(before);
        report.push(
          `  ${route.id}: page ${String(Math.round(before.pageHeight))} → ` +
            `${String(Math.round(now.pageHeight))} px, sections ` +
            `${String(Math.round(before.sectionsHeight))} → ${String(Math.round(now.sectionsHeight))} px` +
            ` (columns → grid, ${String(now.columns)} columns, ` +
            `${String(rowsOf(now.boxes, now.columns).length)} rows)` +
            `${beforeFaults.length === 0 ? '' : `; columns: ${beforeFaults[0] ?? ''}`}`,
        );
        expect(rowMajorFaults(now), `${route.id}: the sections are not in rows`).toEqual([]);
        if (hasSideBySideRows(now)) {
          // The control: the first cut's columns must fail the same check.
          expect(
            beforeFaults.length,
            `${route.id}: CSS columns passed the row check, so it measures nothing`,
          ).toBeGreaterThan(0);
        }
      }
      console.log(`[#1014] rows at ${viewport.name}\n${report.join('\n')}`);
      await columns.close();
    });
  }
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

/**
 * The most the tallest section of a row may be, as a multiple of the shortest
 * — #1026. Its goal was "about 1.5×"; the rows it leaves on Settings and Files
 * in landscape measure 1.45 and 1.61, and the one above that is Files'
 * *Confirm the erase* beside *Why this is a file and not a connection*, a
 * 166 px note no section here is as short as (1.83). Before #1026 they were
 * 3.9 and 4.3.
 */
const ROW_BALANCE_LIMIT = 2;

/** The routes #1026 split sections on, and so holds to {@link ROW_BALANCE_LIMIT}. */
const BALANCED_ROUTES: readonly string[] = ['settings', 'transfer'];

/** Each row of two or more sections, as its tallest height over its shortest. */
function rowBalances(seen: SectionsLayout): number[] {
  return rowsOf(seen.boxes, seen.columns)
    .filter((row) => row.length >= 2)
    .map((row) => {
      const heights = row.map((box) => box.bottom - box.top);
      return Math.max(...heights) / Math.min(...heights);
    });
}

test.describe('#1026 — no section dwarfs its row', () => {
  for (const viewport of [TABLET_IN_THE_SHELL, TABLET_UPRIGHT]) {
    test(`the rows at ${viewport.name}`, async ({ page }) => {
      await open(page, viewport);
      const report: string[] = [];
      for (const route of SECTIONS) {
        const seen = await layoutAt(page, await hashOf(page, route), 'main');
        expect(seen.h1, `${route.id} did not render its own page`).toBe(route.title);
        const balances = rowBalances(seen);
        report.push(
          `  ${route.id}: page ${String(Math.round(seen.pageHeight))} px, sections ` +
            seen.boxes.map((box) => String(Math.round(box.bottom - box.top))).join(' / ') +
            `, rows ${balances.map((each) => `${each.toFixed(2)}×`).join(', ') || 'none side by side'}`,
        );
        // Upright, Settings is one column and Files' last two rows hold a
        // short note: the rows are published, and held in landscape, where
        // #1025 measured the two giants.
        if (viewport === TABLET_IN_THE_SHELL && BALANCED_ROUTES.includes(route.id)) {
          expect(balances.length, `${route.id}: no row of sections side by side`).toBeGreaterThan(
            0,
          );
          for (const balance of balances) {
            expect(
              balance,
              `${route.id}: a section is ${balance.toFixed(2)}× the shortest in its row`,
            ).toBeLessThanOrEqual(ROW_BALANCE_LIMIT);
          }
        }
      }
      console.log(`[#1026] row balance at ${viewport.name}\n${report.join('\n')}`);
    });
  }

  test('the control — the erase list put back by its ⓘ, Files fails', async ({ page }) => {
    await open(page, TABLET_IN_THE_SHELL);
    const closed = await layoutAt(page, '#/transfer', 'main');
    expect(Math.max(...rowBalances(closed))).toBeLessThanOrEqual(ROW_BALANCE_LIMIT);
    const help = page.locator('details.oyl-section-help', {
      hasText: 'Help with Erase this device',
    });
    await help.locator('summary').click();
    await expect(help.getByText('What goes:')).toBeVisible();
    const opened = await readLayout(page, 'main');
    const worst = Math.max(...rowBalances(opened));
    console.log(`[#1026] control: Files with the erase list shown, worst row ${worst.toFixed(2)}×`);
    expect(
      worst,
      'the balance check passed with the erase list back in its section',
    ).toBeGreaterThan(ROW_BALANCE_LIMIT);
  });
});

/**
 * #2067 — the single-column screens use a tablet's width.
 *
 * Many screens were one column a reading measure wide (685 px of `main` at
 * 1280 px), leaving the other half of a landscape tablet empty. On the owner's
 * tablet this walks every route that is not a ride route (`route-motion.ts`
 * §`RIDE_ROUTE_IDS`) and not list–detail, and reads how far across the width
 * the shell gives `main` its content reaches — the right edge of the furthest
 * section of a screen of sections, or else of `main`'s own children, the title
 * block apart. Every route must reach
 * {@link SPAN_FLOOR} of it, except those {@link KEEPS_THE_MEASURE} names, and
 * that list is held exactly: a route that starts to use the width is taken
 * off it, and one that stops is a failure. Each route's figure is printed.
 *
 * On the routes #2067 turned into screens of sections, the sections are in the
 * order they are read — row by row, left to right — and on a phone they are
 * one column that does not scroll sideways at 320 px.
 *
 * ⚠️ **The control** puts those routes back on the reading measure
 * (`?sections=prose`), and every one of them must then fall short. "Today's
 * Settings fails", the issue's own control, does not: Settings has used the
 * width since #1014 (it reaches 100 % here), so the control is the routes
 * this issue changed.
 */
const SPAN_FLOOR = 0.75;

/** Not ride routes and not list–detail: what #2067 walks. */
const WALKED = ALL_ROUTES.filter(
  (route) => !RIDE_ROUTE_IDS.has(route.id) && route.layout !== 'list-detail',
);

/** The routes #2067 laid out in columns — prose until then. */
const WIDENED_BY_2067: readonly RouteId[] = [
  'more',
  'credits',
  'instance',
  'route-builder',
  'activity-detail',
];

/** The routes that keep the reading measure on a tablet, and why — held exactly. */
const KEEPS_THE_MEASURE: Partial<Record<RouteId, string>> = {
  'side-camera':
    'a phone’s screen — the phone is the side camera — whose consent is read before its first ' +
    'control (ADR 0029 D-5, ADR 0033), so the control may not stand beside the text',
  moderation:
    'in the walk’s fixture this device is not a moderator: one notice and one link to the ' +
    'Instance screen',
  'segment-detail':
    'one table and its compare: in two columns the table scrolled in half the width beside an ' +
    'almost empty column, which #2067 tried and put back',
  'not-found': 'two sentences and two links',
};

interface Span {
  /** How far across the width the shell gives `main` its content reaches, 0–1. */
  readonly share: number;
  readonly content: number;
  readonly available: number;
}

async function spanOf(page: Page): Promise<Span> {
  return page.evaluate(() => {
    const main = document.querySelector('main');
    const shell = main?.parentElement;
    if (main === null || shell === null || shell === undefined) throw new Error('no main');
    const mainStyle = getComputedStyle(main);
    const shellStyle = getComputedStyle(shell);
    const left = main.getBoundingClientRect().left + Number.parseFloat(mainStyle.paddingLeft);
    // The width `main` would have with no measure: the shell's, less `main`'s padding.
    const available =
      shell.getBoundingClientRect().right -
      Number.parseFloat(shellStyle.paddingRight) -
      Number.parseFloat(mainStyle.paddingRight) -
      left;
    // What is laid out across the width: a screen of sections' sections, or
    // else `main`'s own children, the title block apart. Their boxes, not
    // what is inside them: a table scrolled inside its region would claim
    // width nobody sees used.
    const grid = main.querySelector('.oyl-sections');
    const laidOut =
      grid === null
        ? [...main.children].filter((child) => !child.classList.contains('oyl-view-head'))
        : [...grid.children];
    let right = left;
    for (const element of laidOut) {
      const box = element.getBoundingClientRect();
      if (box.width > 0 && box.height > 0 && element.checkVisibility()) {
        right = Math.max(right, Math.min(box.right, left + available));
      }
    }
    return { share: (right - left) / available, content: right - left, available };
  });
}

/** Where each child of `main`'s `.oyl-sections` is drawn, in DOM order. */
async function sectionPlaces(page: Page): Promise<{ top: number; left: number }[]> {
  return page.evaluate(() =>
    [...(document.querySelector('main .oyl-sections')?.children ?? [])]
      .map((child) => child.getBoundingClientRect())
      .filter((box) => box.width > 0 && box.height > 0)
      .map((box) => ({ top: box.top, left: box.left })),
  );
}

/** Pairs of neighbours, in DOM order, that are not row by row, left to right. */
function outOfOrder(places: readonly { top: number; left: number }[]): string[] {
  const faults: string[] = [];
  for (let index = 1; index < places.length; index += 1) {
    const before = places[index - 1];
    const after = places[index];
    if (before === undefined || after === undefined) continue;
    const sameRow = Math.abs(after.top - before.top) <= 1;
    if (sameRow ? after.left <= before.left : after.top < before.top) {
      faults.push(
        `section ${String(index + 1)} at (${after.left.toFixed(0)}, ${after.top.toFixed(0)}) ` +
          `before section ${String(index)} at (${before.left.toFixed(0)}, ${before.top.toFixed(0)})`,
      );
    }
  }
  return faults;
}

function widened(id: RouteId): RouteDefinition {
  const route = ALL_ROUTES.find((each) => each.id === id);
  if (route === undefined) throw new Error(`${id} is not a route`);
  return route;
}

test.describe('#2067 — the single-column screens use a tablet’s width', () => {
  test(`every route not a ride route or list–detail, at ${TABLET_IN_THE_SHELL.name}`, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await open(page, TABLET_IN_THE_SHELL);
    const report: string[] = [];
    const short: string[] = [];
    for (const route of WALKED) {
      const seen = await layoutAt(page, await hashOf(page, route), 'main');
      expect(seen.h1, `${route.id} did not render its own page`).toBe(route.title);
      const span = await spanOf(page);
      const kept = KEEPS_THE_MEASURE[route.id] === undefined ? '' : ', keeps the measure';
      report.push(
        `  ${route.id}: ${(span.share * 100).toFixed(0)} % (${span.content.toFixed(0)} of ` +
          `${span.available.toFixed(0)} px)${kept}`,
      );
      if (span.share < SPAN_FLOOR) short.push(route.id);
    }
    console.log(`[#2067] ${TABLET_IN_THE_SHELL.name}\n${report.join('\n')}`);
    // Equal, not only within: both directions are a decision.
    expect(short.sort()).toEqual(Object.keys(KEEPS_THE_MEASURE).sort());
  });

  test(`the sections are in reading order, at ${TABLET_IN_THE_SHELL.name}`, async ({ page }) => {
    await open(page, TABLET_IN_THE_SHELL);
    for (const id of WIDENED_BY_2067) {
      await layoutAt(page, await hashOf(page, widened(id)), 'main');
      const places = await sectionPlaces(page);
      // The apparatus: a page of one section is in order by having one.
      expect(places.length, `${id}: fewer than two sections to order`).toBeGreaterThanOrEqual(2);
      expect(
        new Set(places.map((place) => Math.round(place.left))).size,
        `${id}: its sections are not side by side`,
      ).toBeGreaterThanOrEqual(2);
      expect(outOfOrder(places), id).toEqual([]);
    }
  });

  for (const viewport of [PHONE, { ...PHONE, name: 'phone 320×640', width: 320, height: 640 }]) {
    test(`one column, and no sideways scroll — ${viewport.name}`, async ({ page }) => {
      await open(page, viewport);
      for (const id of WIDENED_BY_2067) {
        await layoutAt(page, await hashOf(page, widened(id)), 'main');
        const places = await sectionPlaces(page);
        expect(places.length, `${id}: no sections`).toBeGreaterThanOrEqual(2);
        expect(new Set(places.map((place) => Math.round(place.left))).size, id).toBe(1);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
          ),
          `${id} scrolls sideways`,
        ).toBeLessThanOrEqual(0);
      }
    });
  }

  // The span above reads the right edges of grid cells, so a grid of empty
  // columns scores 100 %: the height is what shows the empty space (#2190's
  // review: Credits was 15220 px against 12240 on the measure).
  test(`no widened route is taller than on the reading measure, at ${TABLET_IN_THE_SHELL.name}`, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const heights = async (extra: string): Promise<Map<RouteId, number>> => {
      await open(page, TABLET_IN_THE_SHELL, extra);
      const seen = new Map<RouteId, number>();
      for (const id of WIDENED_BY_2067) {
        const layout = await layoutAt(page, await hashOf(page, widened(id)), 'main');
        seen.set(id, layout.pageHeight);
      }
      return seen;
    };
    const columns = await heights('');
    const prose = await heights('&sections=prose');
    for (const id of WIDENED_BY_2067) {
      const wide = columns.get(id) ?? 0;
      const narrow = prose.get(id) ?? 0;
      console.log(
        `[#2067] height ${id}: ${wide.toFixed(0)} px, on the measure ${narrow.toFixed(0)} px`,
      );
      expect(wide, `${id} is taller in columns than on the reading measure`).toBeLessThanOrEqual(
        narrow,
      );
    }
  });

  test(`a pair stays one column upright, at ${TABLET_UPRIGHT.name}`, async ({ page }) => {
    await open(page, TABLET_UPRIGHT);
    for (const id of ['route-builder', 'activity-detail'] as const) {
      await layoutAt(page, await hashOf(page, widened(id)), 'main');
      const places = await sectionPlaces(page);
      expect(places.length, `${id}: no sections`).toBeGreaterThanOrEqual(2);
      expect(
        new Set(places.map((place) => Math.round(place.left))).size,
        `${id}: two columns in a main narrower than the list–detail breakpoint`,
      ).toBe(1);
    }
  });

  test('the control — on the reading measure again, every route #2067 widened falls short', async ({
    page,
  }) => {
    await open(page, TABLET_IN_THE_SHELL, '&sections=prose');
    for (const id of WIDENED_BY_2067) {
      const route = widened(id);
      const seen = await layoutAt(page, await hashOf(page, route), 'main');
      expect(seen.h1, `${id} did not render its own page`).toBe(route.title);
      const span = await spanOf(page);
      console.log(`[#2067] control ${id}: ${(span.share * 100).toFixed(0)} %`);
      expect(span.share, `${id} reached the width on the measure`).toBeLessThan(SPAN_FLOOR);
    }
  });
});
