// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A list beside its detail — #670, measured in the pinned Chromium.
 *
 * Every `list-detail` route of `shell/routes.ts` §`ALL_ROUTES` — taken from
 * the table, never listed here (#142's rule) — is opened in `reflow.html`
 * (the real `AppShell` over `testing/populated-shell.tsx`'s fixtures) with
 * the fixture's item selected, and laid out:
 *
 * - **Two panes** on the owner's tablet in landscape — 1280×800 with the #439
 *   insets applied to the engine (`insets.ts`), the shell's own geometry —
 *   and at 1280×720: the list's right edge left of the detail's left edge,
 *   both inside the viewport, and the two together spanning at least
 *   {@link MINIMUM_SPAN_SHARE} of the width the rail leaves.
 * - **One pane** upright (800×1280), on a phone (390×844) and at WCAG 2.2 SC
 *   1.4.10's 320×256: the chosen item alone, no sideways scroll either way,
 *   and choosing an item then pressing the browser's back returns to the list
 *   with that item focused.
 * - **The URL round-trips**: a FRESH page opened at a selection shows that
 *   item, and at an id the device does not hold says "not found".
 * - **Each primary action's place** is published at all four viewports #670
 *   names, with its margin to the fold; see {@link PRIMARY_ON_ARRIVAL} for
 *   which are required above it and why the rest cannot be.
 *
 * ## The control
 *
 * `reflow.html?layout=prose` switches the same routes of the real table back
 * to `prose` before anything renders — the reading measure #670 replaced —
 * and the width assertion must then FAIL on every one of them. Without it a
 * span computed from the wrong element, or a viewport the rail was never
 * subtracted from, would pass.
 *
 * ## What it does NOT prove
 *
 * Nothing about a real tablet's fonts or its rotation — the owner's device
 * check, which is why the pull request says `Refs`.
 */

import { expect, test, type Page } from '@playwright/test';

import { ALL_ROUTES, hrefFor, hrefForSelection, type RouteDefinition } from '../src/shell/routes';

import {
  applyInsets,
  NO_INSETS,
  PIXEL_TABLET_LANDSCAPE_INSETS,
  PIXEL_TABLET_PORTRAIT_INSETS_ASSUMED,
  resolvedInsets,
  type Insets,
} from './insets';
import type { ReflowMeasurement } from './reflow-harness';

/** `rideview.browser.spec.ts` §`FOLD_MARGIN_PIXELS`, for its reason (#439). */
const FOLD_MARGIN_PIXELS = 50;

/** #670's second criterion: the two panes use at least this much of what the rail leaves. */
const MINIMUM_SPAN_SHARE = 0.8;

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
const SHORT_LANDSCAPE: Viewport = {
  name: '1280×720',
  width: 1280,
  height: 720,
  insets: NO_INSETS,
};
const TABLET_UPRIGHT: Viewport = {
  name: 'tablet upright 800×1280, insets 36/32 (assumed)',
  width: 800,
  height: 1280,
  insets: PIXEL_TABLET_PORTRAIT_INSETS_ASSUMED,
};
const PHONE: Viewport = { name: 'phone 390×844', width: 390, height: 844, insets: NO_INSETS };
const REFLOW: Viewport = { name: 'SC 1.4.10 320×256', width: 320, height: 256, insets: NO_INSETS };

const TWO_PANES = [TABLET_IN_THE_SHELL, SHORT_LANDSCAPE] as const;
const ONE_PANE = [TABLET_UPRIGHT, PHONE, REFLOW] as const;

const LIST_DETAIL = ALL_ROUTES.filter((route) => route.layout === 'list-detail');

/**
 * Where each route's one primary is REQUIRED to be on screen on arrival, with
 * nothing chosen, clearing the fold by the viewport's margin (#439's 50 px on
 * the tablet, where the insets are the shell's). Everywhere else its place is
 * published and not held, and the reason is here — measured on #670's branch:
 *
 * - **Activities** everywhere but 320×256, where the header, the page's title
 *   and summary and the pane's heading already fill the 256 px (it starts at
 *   y ≈ 426).
 * - **Routes** on the tablet both ways up. On a phone the one pane puts the
 *   list first — the way into drawing a route, then the saved routes — and
 *   the import's button ends a form with a file box, a tick box and a
 *   paragraph on closing a loop: about 1,200 px down against a 781 px fold.
 *   The phone's FIRST control, *Draw a route on this device*, is at y ≈ 311.
 * - **Workouts** on the tablet both ways up, since #670 put the workout, its
 *   name and *Save workout* ahead of the block form (below it, the button was
 *   72 px under the landscape fold). On a phone it starts about 6 px under the
 *   fold, after the one-pane list.
 */
const PRIMARY_ON_ARRIVAL: Readonly<Record<string, readonly string[]>> = {
  activities: [TABLET_IN_THE_SHELL.name, TABLET_UPRIGHT.name, PHONE.name],
  routes: [TABLET_IN_THE_SHELL.name, TABLET_UPRIGHT.name],
  workouts: [TABLET_IN_THE_SHELL.name, TABLET_UPRIGHT.name],
};

async function open(page: Page, viewport: Viewport, query = 'data=populated'): Promise<void> {
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  await applyInsets(page, viewport.insets);
  const response = await page.goto(`/reflow.html?${query}`);
  expect(
    response?.status(),
    'reflow.html did not load — is it named in vite.browser.config.ts build.rollupOptions.input?',
  ).toBe(200);
  await page.waitForFunction(() => window.__oylReflow !== undefined);
  expect(await page.evaluate(() => window.__oylReflow?.errors)).toEqual([]);
  expect(await page.evaluate(() => window.__oylReflow?.ready)).toBe(true);
  // The insets must be the ones the page resolved, or this measured nothing.
  expect(await resolvedInsets(page)).toEqual(viewport.insets);
}

async function selectionOf(page: Page, route: RouteDefinition): Promise<string> {
  const id = await page.evaluate((routeId) => window.__oylReflow?.selections[routeId], route.id);
  if (id === undefined) {
    throw new Error(`${route.id}: list-detail and the harness names no item to select`);
  }
  return id;
}

async function visit(page: Page, route: RouteDefinition, hash: string): Promise<ReflowMeasurement> {
  const seen = await page.evaluate(async (target) => window.__oylReflow?.visit(target), hash);
  if (seen === undefined) {
    throw new Error('the reflow harness published no measurement');
  }
  expect(seen.h1, `${route.id} did not render its own page`).toBe(route.title);
  expect(seen.settledWithinPatience, `${route.id} did not settle`).toBe(true);
  expect(seen.errors, `${route.id} raised an error`).toEqual([]);
  return seen;
}

/** Everything wrong with a two-pane layout, as sentences. Empty is a pass. */
function twoPaneFaults(route: RouteDefinition, seen: ReflowMeasurement): string[] {
  const panes = seen.listDetail;
  if (panes === null) {
    return [`${route.id}: no list–detail layout on the page`];
  }
  const { list, detail } = panes;
  if (list === null || detail === null) {
    return [`${route.id}: ${list === null ? 'the list' : 'the detail'} pane is not on screen`];
  }
  const faults: string[] = [];
  if (!(list.right < detail.left)) {
    faults.push(
      `${route.id}: the list ends at x = ${list.right.toFixed(0)} and the detail starts at ` +
        `${detail.left.toFixed(0)} — not side by side`,
    );
  }
  for (const [name, box] of [
    ['list', list],
    ['detail', detail],
  ] as const) {
    if (box.left < 0 || box.right > seen.viewport.width) {
      faults.push(
        `${route.id}: the ${name} pane runs ${box.left.toFixed(0)}–${box.right.toFixed(0)}, ` +
          `outside the ${String(seen.viewport.width)} px viewport`,
      );
    }
  }
  const available = seen.viewport.width - seen.railRight;
  const span = detail.right - list.left;
  if (span < MINIMUM_SPAN_SHARE * available) {
    faults.push(
      `${route.id}: the panes span ${span.toFixed(0)} px of the ${available.toFixed(0)} the rail ` +
        `leaves (${((100 * span) / available).toFixed(1)} %), under ` +
        `${String(MINIMUM_SPAN_SHARE * 100)} %`,
    );
  }
  return faults;
}

/** One line per primary on the page: its place and its margin to the fold. */
function primaryLines(
  route: RouteDefinition,
  viewport: Viewport,
  seen: ReflowMeasurement,
): string[] {
  if (seen.primaries.length === 0) {
    return [`${route.id} @ ${viewport.name}: no primary on screen`];
  }
  return seen.primaries.map(
    (primary) =>
      `${route.id} @ ${viewport.name}: “${primary.text}” (${primary.pane ?? 'no'} pane) ` +
      `y ${primary.top.toFixed(0)}–${primary.bottom.toFixed(0)}, fold ${seen.fold.toFixed(0)}, ` +
      `margin ${(seen.fold - primary.bottom).toFixed(0)} px`,
  );
}

test.describe('#670 — two panes on a landscape tablet', () => {
  for (const viewport of TWO_PANES) {
    test(`side by side at ${viewport.name}, on every list–detail route`, async ({ page }) => {
      expect(LIST_DETAIL.length, 'no list–detail route in the table').toBeGreaterThan(0);
      await open(page, viewport);
      const faults: string[] = [];
      const lines: string[] = [];
      for (const route of LIST_DETAIL) {
        for (const hash of [
          hrefFor(route),
          hrefForSelection(route, await selectionOf(page, route)),
        ]) {
          const seen = await visit(page, route, hash);
          expect(seen.listDetail?.panes, `${route.id}: panes decided`).toBe('2');
          expect(seen.documentOverflow, `${route.id}: scrolls sideways`).toBeLessThanOrEqual(0);
          faults.push(...twoPaneFaults(route, seen));
          const { list, detail } = seen.listDetail ?? {};
          lines.push(
            `${hash}: list ${list?.left.toFixed(0) ?? '?'}–${list?.right.toFixed(0) ?? '?'}, ` +
              `detail ${detail?.left.toFixed(0) ?? '?'}–${detail?.right.toFixed(0) ?? '?'}, ` +
              `rail ${seen.railRight.toFixed(0)}`,
          );
        }
      }
      console.log(`[#670] ${viewport.name}\n  ${lines.join('\n  ')}`);
      expect(faults).toEqual([]);
    });

    test(`the control — switched back to prose, the width assertion fails at ${viewport.name}`, async ({
      page,
    }) => {
      await open(page, viewport, 'data=populated&layout=prose');
      for (const route of LIST_DETAIL) {
        const seen = await visit(
          page,
          route,
          hrefForSelection(route, await selectionOf(page, route)),
        );
        expect(seen.mainLayout, `${route.id}: the control did not reach the table`).toBe(
          'oyl-main--prose',
        );
        const faults = twoPaneFaults(route, seen);
        console.log(`[#670] control ${route.id} @ ${viewport.name}: ${faults.join('; ')}`);
        expect(
          faults.some((fault) => fault.includes('the panes span')),
          `${route.id}: the prose measure passed the width assertion`,
        ).toBe(true);
      }
    });
  }
});

test.describe('#670 — one pane below 840 px', () => {
  for (const viewport of ONE_PANE) {
    test(`one pane, no sideways scroll, and back returns to the item at ${viewport.name}`, async ({
      page,
    }) => {
      await open(page, viewport);
      for (const route of LIST_DETAIL) {
        const listed = await visit(page, route, hrefFor(route));
        expect(listed.listDetail?.panes, `${route.id}: panes decided`).toBe('1');
        expect(listed.documentOverflow, `${route.id}: scrolls sideways`).toBeLessThanOrEqual(0);

        const id = await selectionOf(page, route);
        const item = page.locator(`[data-oyl-pane="list"] a[data-oyl-select="${id}"]`);
        await item.focus();
        await page.keyboard.press('Enter');
        await expect(page.locator('#oyl-selected-heading')).toBeFocused();
        expect(page.url()).toContain(hrefForSelection(route, id));
        const chosen = await page.evaluate(() => ({
          list: document.querySelector<HTMLElement>('[data-oyl-pane="list"]')?.hidden,
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        }));
        expect(chosen.list, `${route.id}: the list is still on screen beside the item`).toBe(true);
        expect(
          chosen.overflow,
          `${route.id}: the chosen item scrolls sideways`,
        ).toBeLessThanOrEqual(0);

        await page.goBack();
        await expect(item, `${route.id}: back did not return focus to the item`).toBeFocused();
        expect(page.url()).toContain(hrefFor(route));
      }
    });
  }
});

test.describe('#670 — a selection in the URL', () => {
  for (const route of LIST_DETAIL) {
    test(`${route.id}: a fresh page at a selection shows it, and an unknown id says so`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 1280, height: 800 });
      const id = await (async () => {
        await page.goto('/reflow.html?data=populated');
        await page.waitForFunction(() => window.__oylReflow?.ready === true);
        return selectionOf(page, route);
      })();

      for (const [hash, expected] of [
        [hrefForSelection(route, id), undefined],
        [hrefForSelection(route, 'no-such-item'), /not found$/],
      ] as const) {
        await page.goto('about:blank');
        await page.goto(`/reflow.html?data=populated${hash}`);
        await page.waitForFunction(() => window.__oylReflow?.ready === true);
        const heading = page.locator('[data-oyl-pane="detail"] #oyl-selected-heading');
        await expect(heading).toBeVisible();
        expect(new URL(page.url()).hash).toBe(hash);
        if (expected === undefined) {
          await expect(
            page.locator(`[aria-current="true"][data-oyl-select="${id}"]`),
          ).toBeVisible();
          await expect(heading).not.toHaveText(/not found$/);
        } else {
          await expect(heading).toHaveText(expected);
        }
      }
    });
  }

  test('rotating with an item chosen keeps it chosen', async ({ page }) => {
    await open(page, TABLET_IN_THE_SHELL);
    for (const route of LIST_DETAIL) {
      const hash = hrefForSelection(route, await selectionOf(page, route));
      await page.setViewportSize({ width: 1280, height: 800 });
      const wide = await visit(page, route, hash);
      expect(wide.listDetail?.panes).toBe('2');
      const title = await page.locator('#oyl-selected-heading').textContent();
      await page.setViewportSize({ width: 800, height: 1280 });
      await expect(page.locator('[data-oyl-panes]')).toHaveAttribute('data-oyl-panes', '1');
      await expect(page.locator('[data-oyl-pane="detail"] #oyl-selected-heading')).toHaveText(
        title ?? '',
      );
      expect(new URL(page.url()).hash).toBe(hash);
    }
  });
});

test.describe('#670 — each primary action’s place on arrival, published', () => {
  for (const viewport of [TABLET_IN_THE_SHELL, TABLET_UPRIGHT, PHONE, REFLOW]) {
    test(`at ${viewport.name}`, async ({ page }) => {
      await open(page, viewport);
      const margin = viewport.insets === NO_INSETS ? 0 : FOLD_MARGIN_PIXELS;
      const lines: string[] = [];
      const faults: string[] = [];
      for (const route of LIST_DETAIL) {
        const seen = await visit(page, route, hrefFor(route));
        lines.push(...primaryLines(route, viewport, seen));
        if ((PRIMARY_ON_ARRIVAL[route.id] ?? []).includes(viewport.name)) {
          const first = seen.primaries[0];
          if (first === undefined || seen.fold - first.bottom <= margin) {
            faults.push(
              `${route.id} @ ${viewport.name}: its primary must clear the fold by more than ` +
                `${String(margin)} px — ${primaryLines(route, viewport, seen).join('; ')}`,
            );
          }
        }
      }
      console.log(`[#670] primaries @ ${viewport.name}\n  ${lines.join('\n  ')}`);
      expect(faults).toEqual([]);
    });
  }
});
