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
 *   names, with its margin to the fold, on arrival AND with the item selected;
 *   see {@link PRIMARY_ON_ARRIVAL} and {@link PRIMARY_WHEN_SELECTED} for which
 *   are required above it and why the rest cannot be.
 * - **Rotating** from two panes to one with focus on a list link moves focus
 *   to the chosen item's heading rather than dropping it to `<body>`.
 * - **At two panes each pane scrolls on its own** (#723): the wheel over one
 *   moves neither the page nor the other, choosing an item low in a long list
 *   with Enter leaves `window.scrollY` where it was and lands focus — ring
 *   included — visibly inside the detail pane, and every pane lies between
 *   the header and the bottom inset at the top of the page and at its
 *   furthest scroll. `?panes=page` puts the layout before #723 back as that
 *   block's control. A primary a pane clips is not on screen, so since #723
 *   a primary's margin is to its pane's bottom where that is above the fold.
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

import { paletteColours, THEMES } from '../src/design/tokens';
import { ALL_ROUTES, hrefFor, hrefForSelection, type RouteDefinition } from '../src/shell/routes';

import {
  applyInsets,
  NO_INSETS,
  PIXEL_TABLET_LANDSCAPE_INSETS,
  PIXEL_TABLET_PORTRAIT_INSETS_ASSUMED,
  resolvedInsets,
  type Insets,
} from './insets';
import { NIGHTLY } from './nightly';
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
 *   list first — the ways into importing and drawing a route, then the saved
 *   routes — and the import's button ends a form with a file box, a tick box
 *   and a paragraph on closing a loop: about 1,260 px down against a 781 px
 *   fold. The phone's FIRST control is the list's *Import a route*, which
 *   moves focus to that form (`shell/ListDetail.tsx` §`CreateLink`).
 * - **Workouts** on the tablet both ways up, since #670 put the workout, its
 *   name and *Save workout* ahead of the block form (below it, the button was
 *   72 px under the landscape fold). On a phone, after the one-pane list —
 *   headed since #670's review by *Build a workout*, which moves focus to the
 *   builder — it is above the fold, by too little to hold: re-taken for
 *   #982, whose 48 px card drawings moved it down 32 px, it ends 45.9 px above
 *   the fold in this Chromium on a Mac (77.9 before) and 21.1 px on
 *   the CI runner (53.1 before, run 36881810211; after, run 36887027370).
 */
const PRIMARY_ON_ARRIVAL: Readonly<Record<string, readonly string[]>> = {
  activities: [TABLET_IN_THE_SHELL.name, TABLET_UPRIGHT.name, PHONE.name],
  routes: [TABLET_IN_THE_SHELL.name, TABLET_UPRIGHT.name],
  workouts: [TABLET_IN_THE_SHELL.name, TABLET_UPRIGHT.name],
};

/**
 * Where every primary on screen is REQUIRED to clear the fold WITH THE
 * FIXTURE'S ITEM SELECTED — #670's review (N1), which found this state never
 * measured and *Save workout* 48 px from the tablet's fold, *Import route*
 * 413 px under it. Since then a chosen item has the detail pane to itself:
 * the form that was under it is reached from the head of the list, where the
 * list's *Import a route* / *Build a workout* is the pane's one primary
 * (`shell/ListDetail.tsx` §`CreateLink`).
 *
 * Held at the two-pane tablet, where the insets are the shell's, for all
 * three; and for Activities on one pane too, where *Open ride details* ends
 * 665 px above the upright tablet's fold and 180 px above a phone's (measured
 * on #670's review branch, on a Mac). On one pane the list is hidden with an
 * item chosen, so Routes and Workouts have NO primary on screen: the item's
 * own actions — download, change, export, delete — are all secondary (#668),
 * and the way back to the form is the one-pane back link to the list. That is
 * published as "no primary on screen", not held.
 */
const PRIMARY_WHEN_SELECTED: Readonly<Record<string, readonly string[]>> = {
  activities: [TABLET_IN_THE_SHELL.name, TABLET_UPRIGHT.name, PHONE.name],
  routes: [TABLET_IN_THE_SHELL.name],
  workouts: [TABLET_IN_THE_SHELL.name],
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
      `y ${primary.top.toFixed(0)}–${primary.bottom.toFixed(0)}, fold ${seen.fold.toFixed(0)}` +
      (primary.clipBottom === null ? '' : `, pane ends ${primary.clipBottom.toFixed(0)}`) +
      `, margin ${(seenLine(seen, primary) - primary.bottom).toFixed(0)} px`,
  );
}

/**
 * The line a primary must clear: the fold, or — since #723, where a pane at
 * two panes scrolls on its own and clips what is below it — the bottom of its
 * pane, whichever is higher.
 */
function seenLine(
  seen: ReflowMeasurement,
  primary: ReflowMeasurement['primaries'][number],
): number {
  return Math.min(seen.fold, primary.clipBottom ?? Number.POSITIVE_INFINITY);
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

/**
 * The two panes' headings are level — #730.
 *
 * At two panes `ListDetail.tsx` puts the pane skip link before the list's
 * `<h2>`, so the heading was not `:first-child` and kept `h2`'s 40 px top
 * margin: the list's heading sat 40 px below the detail's on every list–detail
 * route. `theme.css` §`.oyl-pane-skip + h2` takes the margin away. The control
 * puts the 40 px back on that one rule and requires the headings apart again.
 */
async function paneHeadingTops(
  page: Page,
): Promise<{ readonly list: number | null; readonly detail: number | null }> {
  return page.evaluate(() => {
    const top = (pane: string): number | null =>
      document
        .querySelector(`[data-oyl-pane="${pane}"]:not([hidden]) :is(h2, h3)`)
        ?.getBoundingClientRect().top ?? null;
    return { list: top('list'), detail: top('detail') };
  });
}

test.describe('#730 — the two panes’ headings are level', () => {
  for (const control of [false, true]) {
    test(
      control
        ? 'the control — with the 40 px gap back, they are not'
        : 'at two panes, on every list–detail route',
      async ({ page }) => {
        await open(page, TABLET_IN_THE_SHELL);
        if (control) {
          await page.addStyleTag({
            // #1013: a list heading with an ⓘ is its wrapper's, so the gap goes
            // back on both forms of the rule.
            content:
              '.oyl-pane-skip + h2, .oyl-pane-skip + .oyl-section-head ' +
              '{ margin-top: var(--oyl-space-xl) !important; }',
          });
        }
        const lines: string[] = [];
        let measured = 0;
        for (const route of LIST_DETAIL) {
          for (const hash of [
            hrefFor(route),
            hrefForSelection(route, await selectionOf(page, route)),
          ]) {
            const seen = await visit(page, route, hash);
            expect(seen.listDetail?.panes, `${route.id}: panes decided`).toBe('2');
            const tops = await paneHeadingTops(page);
            lines.push(
              `${hash}: list heading ${tops.list?.toFixed(0) ?? '—'}, ` +
                `detail heading ${tops.detail?.toFixed(0) ?? '—'}`,
            );
            expect(tops.list, `${hash}: the list pane has no heading`).not.toBeNull();
            if (tops.list === null || tops.detail === null) continue;
            measured += 1;
            const apart = Math.abs(tops.list - tops.detail);
            if (control) {
              expect(apart, `${hash}: the control left the headings level`).toBeGreaterThan(30);
            } else {
              expect(
                apart,
                `${hash}: the list's heading and the detail's are not level`,
              ).toBeLessThanOrEqual(1);
            }
          }
        }
        console.log(`[#730]${control ? ' control' : ''}\n  ${lines.join('\n  ')}`);
        expect(measured, 'no route had a heading in both panes').toBeGreaterThan(0);
      },
    );
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
        // #738: the ELEMENT focus left, marked, so that coming back can be
        // held to it rather than to a link of the same name drawn again.
        await item.evaluate((link) => {
          (link as HTMLElement & { oylLeftFrom?: true }).oylLeftFrom = true;
        });
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
        // ⚠️ #738: and to the SAME element. On CI (run 36412215912) focus came
        // back to the Activities list at 800×1280 and was then lost: hidden,
        // the list measured a width of nothing, became cards, and was drawn
        // as a table again AFTER focus had returned to a card — so the link
        // that had focus was removed. Since #1041 the library is cards at
        // every width and measures nothing, so there is no second layout to
        // redraw it as; this is the corroboration in a real engine that
        // nothing else redraws it either.
        // ⚠️ It reads the expando at ONE moment, so a redraw that lands after
        // this `evaluate` still passes (#758).
        expect(
          await item.evaluate(
            (link) => (link as HTMLElement & { oylLeftFrom?: true }).oylLeftFrom === true,
          ),
          `${route.id}: the list was drawn again, so focus returned to a new link`,
        ).toBe(true);
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
      // Focus on a list link, which the rotation is about to hide (N4).
      await page.locator('[data-oyl-pane="list"] a[data-oyl-select]').first().focus();
      await page.setViewportSize({ width: 800, height: 1280 });
      await expect(page.locator('[data-oyl-panes]')).toHaveAttribute('data-oyl-panes', '1');
      await expect(page.locator('[data-oyl-pane="detail"] #oyl-selected-heading')).toHaveText(
        title ?? '',
      );
      await expect(
        page.locator('[data-oyl-pane="detail"] #oyl-selected-heading'),
        `${route.id}: focus did not follow the chosen item when the list was hidden`,
      ).toBeFocused();
      expect(new URL(page.url()).hash).toBe(hash);
    }
  });
});

test.describe('#670 — each primary action’s place, published', () => {
  for (const viewport of [TABLET_IN_THE_SHELL, TABLET_UPRIGHT, PHONE, REFLOW]) {
    test(`at ${viewport.name}, on arrival and with an item selected`, async ({ page }) => {
      await open(page, viewport);
      const margin = viewport.insets === NO_INSETS ? 0 : FOLD_MARGIN_PIXELS;
      const lines: string[] = [];
      const faults: string[] = [];
      for (const route of LIST_DETAIL) {
        const arrival = await visit(page, route, hrefFor(route));
        lines.push(...primaryLines(route, viewport, arrival).map((line) => `${line} [arrival]`));
        if ((PRIMARY_ON_ARRIVAL[route.id] ?? []).includes(viewport.name)) {
          const first = arrival.primaries[0];
          if (first === undefined || seenLine(arrival, first) - first.bottom <= margin) {
            faults.push(
              `${route.id} @ ${viewport.name}: its primary must clear the fold by more than ` +
                `${String(margin)} px — ${primaryLines(route, viewport, arrival).join('; ')}`,
            );
          }
        }

        const selected = await visit(
          page,
          route,
          hrefForSelection(route, await selectionOf(page, route)),
        );
        lines.push(...primaryLines(route, viewport, selected).map((line) => `${line} [selected]`));
        if ((PRIMARY_WHEN_SELECTED[route.id] ?? []).includes(viewport.name)) {
          if (selected.primaries.length === 0) {
            faults.push(`${route.id} @ ${viewport.name}, selected: no primary on screen`);
          }
          for (const primary of selected.primaries) {
            if (seenLine(selected, primary) - primary.bottom <= margin) {
              faults.push(
                `${route.id} @ ${viewport.name}, selected: “${primary.text}” must clear the fold ` +
                  `by more than ${String(margin)} px — ` +
                  primaryLines(route, viewport, selected).join('; '),
              );
            }
          }
        }
      }
      console.log(`[#670] primaries @ ${viewport.name}\n  ${lines.join('\n  ')}`);
      expect(faults).toEqual([]);
    });
  }
});

/**
 * #723 — at two panes, the list and the detail scroll ON THEIR OWN.
 *
 * Measured with real input: the wheel over a pane, and Enter on a list link.
 * Choosing an item low in the list must not move the page (`window.scrollY`),
 * and scrolling one pane must not move the other. Every pane's top must be
 * below the header and the status bar's band, and its bottom above the bottom
 * inset — the margins are published.
 *
 * The control is `reflow.html?panes=page`, the layout #723 replaced, over the
 * same routes: the wheel over the list must then scroll the page, and
 * choosing a low item must move it.
 */

/** What a pane is doing, read off the live page. */
interface PaneState {
  readonly top: number;
  readonly bottom: number;
  readonly scrollTop: number;
  /** How far the pane could scroll: `scrollHeight − clientHeight`. */
  readonly scrollRange: number;
  readonly overflowY: string;
  /** The content box's left and right edges: the border box less the padding. */
  readonly contentLeft: number;
  readonly contentRight: number;
}

interface PageState {
  readonly scrollY: number;
  /** How far the DOCUMENT could scroll. */
  readonly documentRange: number;
  readonly innerHeight: number;
  /** The header's bottom edge, or `null` where there is none. */
  readonly headerBottom: number | null;
  /** The list–detail grid's own left and right edges. */
  readonly gridLeft: number;
  readonly gridRight: number;
  readonly list: PaneState | null;
  readonly detail: PaneState | null;
}

async function pageState(page: Page): Promise<PageState> {
  return page.evaluate(() => {
    const pane = (name: string): PaneState | null => {
      const element = document.querySelector<HTMLElement>(`[data-oyl-pane="${name}"]`);
      if (element === null || element.hidden) return null;
      const box = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        top: box.top,
        bottom: box.bottom,
        scrollTop: element.scrollTop,
        scrollRange: element.scrollHeight - element.clientHeight,
        overflowY: style.overflowY,
        contentLeft: box.left + Number.parseFloat(style.paddingLeft),
        contentRight: box.right - Number.parseFloat(style.paddingRight),
      };
    };
    const root = document.documentElement;
    return {
      scrollY: window.scrollY,
      documentRange: root.scrollHeight - root.clientHeight,
      innerHeight: window.innerHeight,
      headerBottom: document.querySelector('.oyl-header')?.getBoundingClientRect().bottom ?? null,
      gridLeft: document.querySelector('.oyl-list-detail')?.getBoundingClientRect().left ?? 0,
      gridRight: document.querySelector('.oyl-list-detail')?.getBoundingClientRect().right ?? 0,
      list: pane('list'),
      detail: pane('detail'),
    };
  });
}

/** Longer than Chromium keeps a wheel gesture latched to the scroller it began on. */
const WHEEL_LATCH_MS = 800;

/**
 * How long a wheel may take to reach the page, or to start the scroll it was
 * expected to start, before the case gives up waiting and lets its assertions
 * say what did not happen. A BOUND, never a sleep: every wait below returns the
 * moment its evidence arrives.
 */
const INPUT_LANDS_WITHIN_MS = 5_000;

/**
 * ⚠️ #731's review: after a synthetic wheel, `settleScroll` alone could return
 * BEFORE the scroll had started — two samples 60 ms apart agree just as well
 * when nothing has happened yet, and under load Chromium took longer than that
 * to begin. A positive case then read "the detail did not scroll" (3 in 64 under
 * a ten-worker stress run), and a negative one — "the wheel over a list at its
 * end did not move the page", which is #723's `overscroll-behavior` check —
 * could pass having measured nothing at all. So every wheel is followed by
 * EVIDENCE that it landed before anything settles:
 *
 * - the page's own `wheel` event, counted by a passive listener, which says the
 *   input reached the renderer — the only evidence a gesture expected to move
 *   nothing can give; and
 * - where something IS expected to move, that movement itself: `moved` is
 *   polled until it holds, so settling starts from a scroll in progress rather
 *   than from before one.
 *
 * `page.evaluate` of a SYNCHRONOUS function throughout, never a
 * `waitForFunction` with an async predicate, which resolves on its first poll
 * (§4f).
 */
async function wheelOver(
  page: Page,
  name: 'list' | 'detail',
  deltaY: number,
  moved?: (before: PageState, now: PageState) => boolean,
): Promise<void> {
  const box = await page.locator(`[data-oyl-pane="${name}"]`).boundingBox();
  if (box === null) throw new Error(`the ${name} pane has no box to wheel over`);
  // Aim at the part of the pane that is ON SCREEN. Under the control the page
  // scrolls, and a point taken from the pane's box alone was above the viewport
  // once the page had scrolled to its end: that wheel reached nothing, which
  // nothing noticed until the wheel's arrival was waited for.
  const viewport = page.viewportSize();
  const top = Math.max(box.y, 0);
  const bottom = Math.min(box.y + box.height, viewport?.height ?? box.y + box.height);
  if (bottom - top < 20) {
    throw new Error(`no part of the ${name} pane is on screen to wheel over`);
  }
  await page.mouse.move(box.x + box.width / 2, top + Math.min((bottom - top) / 2, 200));
  await page.evaluate(() => {
    const counted = window as unknown as { __oylWheels?: number };
    if (counted.__oylWheels === undefined) {
      window.addEventListener(
        'wheel',
        () => {
          counted.__oylWheels = (counted.__oylWheels ?? 0) + 1;
        },
        { passive: true, capture: true },
      );
    }
    counted.__oylWheels = 0;
  });
  const before = await pageState(page);
  await page.mouse.wheel(0, deltaY);
  await expect
    .poll(
      () => page.evaluate(() => (window as unknown as { __oylWheels?: number }).__oylWheels ?? 0),
      {
        message: `the wheel over the ${name} pane never reached the page`,
        timeout: INPUT_LANDS_WITHIN_MS,
      },
    )
    .toBeGreaterThan(0);
  if (moved !== undefined) {
    const deadline = Date.now() + INPUT_LANDS_WITHIN_MS;
    while (!moved(before, await pageState(page)) && Date.now() < deadline) {
      await page.waitForTimeout(30);
    }
  }
  await settleScroll(page);
}

/** Anything the wheel could have scrolled: the page, or either pane. */
function anythingScrolled(before: PageState, now: PageState): boolean {
  return (
    now.scrollY !== before.scrollY ||
    now.list?.scrollTop !== before.list?.scrollTop ||
    now.detail?.scrollTop !== before.detail?.scrollTop
  );
}

/** Two animation frames: whatever the compositor was going to draw next is drawn. */
async function nextFrames(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            resolve();
          });
        });
      }),
  );
}

/**
 * Until neither the page nor either pane has moved across three samples, each
 * two FRAMES and 60 ms apart — frames rather than time alone, so a loaded
 * machine that draws slowly is waited for rather than out-waited. Settles a
 * movement already evidenced; it is not, on its own, evidence one happened.
 */
async function settleScroll(page: Page): Promise<void> {
  let last = '';
  let same = 0;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const now = JSON.stringify(await pageState(page));
    same = now === last ? same + 1 : 0;
    if (same >= 2) return;
    last = now;
    await nextFrames(page);
    await page.waitForTimeout(60);
  }
}

/** Where a pane must lie, as faults and one published line. */
function paneBoundsFaults(
  where: string,
  state: PageState,
  insets: Insets,
): { faults: string[]; line: string } {
  const faults: string[] = [];
  const ceiling = Math.max(state.headerBottom ?? 0, insets.top);
  const floor = state.innerHeight - insets.bottom;
  const parts: string[] = [];
  for (const [name, box] of [
    ['list', state.list],
    ['detail', state.detail],
  ] as const) {
    if (box === null) {
      faults.push(`${where}: the ${name} pane is not on screen`);
      continue;
    }
    parts.push(
      `${name} ${box.top.toFixed(0)}–${box.bottom.toFixed(0)} ` +
        `(top +${(box.top - ceiling).toFixed(0)}, bottom +${(floor - box.bottom).toFixed(0)}, ` +
        `scrolls ${box.scrollRange.toFixed(0)} px)`,
    );
    if (box.overflowY !== 'auto') {
      faults.push(
        `${where}: the ${name} pane does not scroll on its own (overflow-y ${box.overflowY})`,
      );
    }
    if (box.top < ceiling) {
      faults.push(
        `${where}: the ${name} pane starts at ${box.top.toFixed(0)}, under the header or the ` +
          `inset band (${ceiling.toFixed(0)})`,
      );
    }
    // The room a pane keeps for a focus ring costs its content nothing: the
    // list's content starts at the grid's left edge and the detail's ends at
    // its right, where they were before the panes scrolled on their own.
    const edge =
      name === 'list' ? box.contentLeft - state.gridLeft : state.gridRight - box.contentRight;
    if (Math.abs(edge) > 0.5) {
      faults.push(
        `${where}: the ${name} pane's content is ${edge.toFixed(1)} px in from the grid's ` +
          `${name === 'list' ? 'left' : 'right'} edge`,
      );
    }
    // ⚠️ Held to the fold, NOT to §4f's 50 px floor, and on the tablet it
    // publishes about +9 px. That is not a missed floor. The floor is for a
    // CONTROL whose place depends on fonts, which moved by 49 px between a Mac
    // and the CI runner. A pane's bottom is set by `.oyl-main`'s padding and the
    // shell's `min-height`, which is built from `env(safe-area-inset-bottom)`
    // and does not depend on fonts. What lies between the pane's content and
    // the fold is the pane's own 8 px ring padding and `main`'s bottom padding,
    // and nothing in it can be tapped. A control at a pane's end scrolls up to
    // that edge and no further, so it stays clear of the gesture bar for as
    // long as `env()` reports the real inset. (#731's review.)
    if (box.bottom > floor) {
      faults.push(
        `${where}: the ${name} pane ends at ${box.bottom.toFixed(0)}, past the bottom inset ` +
          `(${floor.toFixed(0)})`,
      );
    }
  }
  return {
    faults,
    line:
      `${where} at scrollY ${String(state.scrollY)} of ${state.documentRange.toFixed(0)}: header ` +
      `ends ${state.headerBottom?.toFixed(0) ?? '—'}, band ${String(insets.top)}, fold ` +
      `${floor.toFixed(0)}; ${parts.join('; ')}`,
  };
}

/**
 * {@link paneBoundsFaults} at the top of the page AND at its furthest scroll:
 * since #723 the page scrolls by the footer's one line, and a pane must not
 * slide under the header when it does.
 */
async function paneBoundsAtBothEnds(
  page: Page,
  where: string,
  insets: Insets,
): Promise<{ faults: string[]; lines: string[] }> {
  const faults: string[] = [];
  const lines: string[] = [];
  for (const to of ['top', 'bottom'] as const) {
    await page.evaluate((end) => {
      window.scrollTo(0, end === 'top' ? 0 : document.documentElement.scrollHeight);
    }, to);
    await settleScroll(page);
    const measured = paneBoundsFaults(where, await pageState(page), insets);
    faults.push(...measured.faults);
    lines.push(measured.line);
    if (to === 'bottom') {
      // The footer's line, which since #723 is below the fold, must come
      // clear of the bottom inset when the page is scrolled to it.
      const footer = await page.evaluate(() => {
        const text = document.querySelector('.oyl-footer p')?.firstChild;
        if (text === null || text === undefined) return null;
        const range = document.createRange();
        range.selectNodeContents(text);
        return { bottom: range.getBoundingClientRect().bottom, innerHeight: window.innerHeight };
      });
      const floor = (footer?.innerHeight ?? 0) - insets.bottom;
      lines.push(
        `${where}: the footer's line ends at ${footer?.bottom.toFixed(0) ?? '—'}, fold ${floor.toFixed(0)}`,
      );
      if (footer === null || footer.bottom > floor) {
        faults.push(
          `${where}: scrolled to the end, the footer's line ends at ` +
            `${footer?.bottom.toFixed(0) ?? '—'}, under the bottom inset (${floor.toFixed(0)})`,
        );
      }
    }
  }
  await page.evaluate(() => {
    window.scrollTo(0, 0);
  });
  return { faults, lines };
}

/**
 * Wheel the list, then choose an item from low in it with Enter — everything
 * wrong with what that did, as sentences. Empty is a pass. `undefined` when the
 * route's list is too short to scroll, so there is no "low" item to choose.
 */
async function independentScrollFaults(
  page: Page,
  route: RouteDefinition,
  lines: string[],
): Promise<string[] | undefined> {
  await visit(page, route, hrefFor(route));
  await page.evaluate(() => {
    window.scrollTo(0, 0);
  });
  const before = await pageState(page);
  const listRange =
    before.list?.overflowY === 'visible' ? before.documentRange : before.list?.scrollRange;
  if (before.list === null || listRange === undefined || listRange < 200) {
    return undefined;
  }
  const faults: string[] = [];

  // 1. The wheel over the list scrolls the list, and nothing else.
  await wheelOver(page, 'list', 100_000, anythingScrolled);
  const wheeled = await pageState(page);
  if (wheeled.scrollY !== before.scrollY) {
    faults.push(
      `${route.id}: the wheel over the list moved the page, scrollY ${String(before.scrollY)} → ` +
        `${String(wheeled.scrollY)}`,
    );
  }
  if ((wheeled.list?.scrollTop ?? 0) <= before.list.scrollTop) {
    faults.push(`${route.id}: the wheel over the list did not scroll the list`);
  }
  // …and a list already at its end does not hand the wheel on to the page,
  // which since #723 can scroll by the footer's line. NEW gestures, and two
  // of them: measured with `overscroll-behavior` taken away, Chromium keeps a
  // gesture latched to the list, and the first new one after the list reached
  // its end did not chain either — the second scrolled the page by 52 px.
  for (let gesture = 0; gesture < 2; gesture += 1) {
    await page.waitForTimeout(WHEEL_LATCH_MS);
    await wheelOver(page, 'list', 2_000);
  }
  const beyond = await pageState(page);
  if (beyond.scrollY !== wheeled.scrollY) {
    faults.push(
      `${route.id}: the wheel over a list at its end moved the page, scrollY ` +
        `${String(wheeled.scrollY)} → ${String(beyond.scrollY)}`,
    );
  }
  if (
    wheeled.detail === null ||
    before.detail === null ||
    Math.abs(wheeled.detail.top - before.detail.top) > 0.5 ||
    wheeled.detail.scrollTop !== before.detail.scrollTop
  ) {
    faults.push(
      `${route.id}: scrolling the list moved the detail pane, top ` +
        `${before.detail?.top.toFixed(0) ?? '—'} → ${wheeled.detail?.top.toFixed(0) ?? '—'}`,
    );
  }

  // 2. Choose the lowest item with Enter — a keyboard user's choice.
  const low = page.locator('[data-oyl-pane="list"] a[data-oyl-select]').last();
  await low.focus();
  await settleScroll(page);
  const chosenFrom = await pageState(page);
  await page.keyboard.press('Enter');
  const heading = page.locator('[data-oyl-pane="detail"] #oyl-selected-heading');
  await expect(heading, `${route.id}: focus did not move to the chosen item`).toBeFocused();
  await settleScroll(page);
  const chosen = await pageState(page);
  if (chosen.scrollY !== chosenFrom.scrollY) {
    faults.push(
      `${route.id}: choosing a low item moved the page, scrollY ${String(chosenFrom.scrollY)} → ` +
        `${String(chosen.scrollY)}`,
    );
  }
  if (Math.abs((chosen.list?.scrollTop ?? 0) - (chosenFrom.list?.scrollTop ?? 0)) > 1) {
    faults.push(`${route.id}: choosing an item scrolled the list away from it`);
  }
  // Focus lands VISIBLY inside the detail pane: its heading — AND the focus
  // ring drawn around it, which a pane that clips its overflow cuts off at
  // the edge — is inside the pane's box, and the heading is what is drawn at
  // its own centre.
  const landed = await heading.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    const ring =
      style.outlineStyle === 'none'
        ? 0
        : Number.parseFloat(style.outlineWidth) + Number.parseFloat(style.outlineOffset);
    const pane = element.closest('[data-oyl-pane]')?.getBoundingClientRect();
    const hit = document.elementFromPoint(box.left + 4, (box.top + box.bottom) / 2);
    return {
      top: box.top - ring,
      bottom: box.bottom + ring,
      left: box.left - ring,
      right: box.right + ring,
      ring,
      paneTop: pane?.top ?? Number.NaN,
      paneBottom: pane?.bottom ?? Number.NaN,
      paneLeft: pane?.left ?? Number.NaN,
      paneRight: pane?.right ?? Number.NaN,
      drawn: hit !== null && element.contains(hit),
    };
  });
  const inside =
    landed.top >= landed.paneTop &&
    landed.bottom <= landed.paneBottom &&
    landed.left >= landed.paneLeft &&
    landed.right <= landed.paneRight;
  if (landed.ring <= 0) {
    faults.push(`${route.id}: the focused heading draws no focus ring`);
  }
  if (!inside || !landed.drawn) {
    faults.push(
      `${route.id}: the focused heading and its ring (${landed.left.toFixed(0)},` +
        `${landed.top.toFixed(0)})–(${landed.right.toFixed(0)},${landed.bottom.toFixed(0)}) are ` +
        `not visibly inside the detail pane (${landed.paneLeft.toFixed(0)},` +
        `${landed.paneTop.toFixed(0)})–(${landed.paneRight.toFixed(0)},` +
        `${landed.paneBottom.toFixed(0)}), drawn: ${String(landed.drawn)}`,
    );
  }
  lines.push(
    `${route.id}: list scrolled ${String(before.list.scrollTop)} → ` +
      `${String(wheeled.list?.scrollTop ?? '—')} of ${listRange.toFixed(0)}, page scrollY ` +
      `${String(before.scrollY)} → ${String(wheeled.scrollY)}; chose the last item: scrollY ` +
      `${String(chosenFrom.scrollY)} → ${String(chosen.scrollY)}, heading and its ` +
      `${String(landed.ring)} px ring ${landed.top.toFixed(0)}–${landed.bottom.toFixed(0)} ` +
      `(x ${landed.left.toFixed(0)}–${landed.right.toFixed(0)}) in a detail pane ` +
      `${landed.paneTop.toFixed(0)}–${landed.paneBottom.toFixed(0)} ` +
      `(x ${landed.paneLeft.toFixed(0)}–${landed.paneRight.toFixed(0)})`,
  );
  return faults;
}

/** The document scrolled as far as it goes, and at rest. */
async function scrollPageToEnd(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.scrollTo(0, document.documentElement.scrollHeight);
  });
  await settleScroll(page);
}

/**
 * Focus the skip link WITHOUT the scroll a focus call makes, and say so (#726,
 * from #731's review). A plain `focus()` from the page's end scrolls the link
 * — and so the page — back to the top before Enter is pressed, so the jump
 * the skip link makes contributed nothing to what was measured after it:
 * `mainRef.current?.focus({ preventScroll: true })` left both cases green.
 * Measured this way, the jump left the `h1` at y = −10 150 on the control's
 * layout, which is why `AppShell.tsx` §`skipToContent` scrolls `main` in.
 */
async function focusSkipLinkInPlace(page: Page): Promise<void> {
  const before = await page.evaluate(() => window.scrollY);
  await page.locator('.oyl-skip-link').evaluate((link) => {
    (link as HTMLElement).focus({ preventScroll: true });
  });
  await expect(page.locator('.oyl-skip-link')).toBeFocused();
  expect(
    await page.evaluate(() => window.scrollY),
    'focusing the skip link moved the page, so the jump it makes is not what is measured',
  ).toBe(before);
}

/** Where `main`'s h1 is, against the header (or the inset band) and the fold. */
async function h1Landing(page: Page): Promise<{
  top: number;
  bottom: number;
  ceiling: number;
  floor: number;
  scrollY: number;
}> {
  const read = await page.evaluate(() => {
    const h1 = document.querySelector('main h1')?.getBoundingClientRect();
    return {
      top: h1?.top ?? Number.NaN,
      bottom: h1?.bottom ?? Number.NaN,
      header: document.querySelector('.oyl-header')?.getBoundingClientRect().bottom ?? 0,
      innerHeight: window.innerHeight,
      scrollY: window.scrollY,
    };
  });
  return {
    top: read.top,
    bottom: read.bottom,
    ceiling: Math.max(read.header, TABLET_IN_THE_SHELL.insets.top),
    floor: read.innerHeight - TABLET_IN_THE_SHELL.insets.bottom,
    scrollY: read.scrollY,
  };
}

test.describe('#723 — two panes scroll on their own', () => {
  for (const viewport of TWO_PANES) {
    test(`each pane lies between the header and the bottom inset at ${viewport.name}`, async ({
      page,
    }) => {
      await open(page, viewport);
      const faults: string[] = [];
      const lines: string[] = [];
      for (const route of LIST_DETAIL) {
        for (const hash of [
          hrefFor(route),
          hrefForSelection(route, await selectionOf(page, route)),
        ]) {
          await visit(page, route, hash);
          const measured = await paneBoundsAtBothEnds(page, hash, viewport.insets);
          faults.push(...measured.faults);
          lines.push(...measured.lines);
        }
      }
      console.log(`[#723] panes @ ${viewport.name}\n  ${lines.join('\n  ')}`);
      expect(faults).toEqual([]);
    });

    test(`the list and the detail scroll separately at ${viewport.name}`, async ({ page }) => {
      await open(page, viewport);
      const faults: string[] = [];
      const lines: string[] = [];
      let measured = 0;
      for (const route of LIST_DETAIL) {
        const found = await independentScrollFaults(page, route, lines);
        if (found !== undefined) {
          measured += 1;
          faults.push(...found);
        }
      }
      console.log(`[#723] scrolling @ ${viewport.name}\n  ${lines.join('\n  ')}`);
      // The populated Activities list is forty rides: a walk that found no
      // list long enough to scroll measured nothing.
      expect(measured, 'no list–detail route had a list long enough to scroll').toBeGreaterThan(0);
      expect(faults).toEqual([]);
    });

    test(`the control — the layout before #723 fails both at ${viewport.name}`, async ({
      page,
    }) => {
      await open(page, viewport, 'data=populated&panes=page');
      expect(
        await page.locator('style[data-oyl-control="panes=page"]').count(),
        'the control stylesheet is not on the page',
      ).toBe(1);
      const lines: string[] = [];
      let measured = 0;
      for (const route of LIST_DETAIL) {
        const selected = hrefForSelection(route, await selectionOf(page, route));
        await visit(page, route, selected);
        const bounds = await paneBoundsAtBothEnds(page, selected, viewport.insets);
        expect(
          bounds.faults.some((fault) => fault.includes('does not scroll on its own')),
          `${route.id}: the pre-#723 panes passed the bounds assertion — ${bounds.lines.join('; ')}`,
        ).toBe(true);
        const found = await independentScrollFaults(page, route, lines);
        if (found === undefined) continue;
        measured += 1;
        console.log(`[#723] control ${route.id} @ ${viewport.name}: ${found.join('; ')}`);
        expect(
          found.some((fault) => fault.includes('the wheel over the list moved the page')),
          `${route.id}: under the pre-#723 layout the wheel over the list did not move the page`,
        ).toBe(true);
        expect(
          found.some((fault) => fault.includes('choosing a low item moved the page')),
          `${route.id}: under the pre-#723 layout choosing a low item did not move the page`,
        ).toBe(true);
      }
      expect(measured, 'the control found no list long enough to scroll').toBeGreaterThan(0);
    });
  }

  test('scrolling the detail pane does not move the list, on the tablet', async ({ page }) => {
    await open(page, TABLET_IN_THE_SHELL);
    const lines: string[] = [];
    let measured = 0;
    for (const route of LIST_DETAIL) {
      for (const hash of [
        hrefFor(route),
        hrefForSelection(route, await selectionOf(page, route)),
      ]) {
        await visit(page, route, hash);
        const before = await pageState(page);
        if (before.detail === null || before.list === null || before.detail.scrollRange < 50) {
          continue;
        }
        measured += 1;
        await wheelOver(
          page,
          'detail',
          100_000,
          (from, now) => now.detail?.scrollTop !== from.detail?.scrollTop,
        );
        const after = await pageState(page);
        lines.push(
          `${hash}: detail ${String(before.detail.scrollTop)} → ` +
            `${String(after.detail?.scrollTop ?? '—')} of ${before.detail.scrollRange.toFixed(0)}, ` +
            `list top ${before.list.top.toFixed(0)} → ${after.list?.top.toFixed(0) ?? '—'}, ` +
            `scrollY ${String(before.scrollY)} → ${String(after.scrollY)}`,
        );
        expect(after.detail?.scrollTop, `${hash}: the detail did not scroll`).toBeGreaterThan(
          before.detail.scrollTop,
        );
        expect(after.scrollY, `${hash}: the wheel over the detail moved the page`).toBe(
          before.scrollY,
        );
        expect(after.list?.top, `${hash}: the list moved`).toBeCloseTo(before.list.top, 0);
        expect(after.list?.scrollTop, `${hash}: the list scrolled`).toBe(before.list.scrollTop);
      }
    }
    console.log(`[#723] detail scrolling @ ${TABLET_IN_THE_SHELL.name}\n  ${lines.join('\n  ')}`);
    expect(measured, 'no detail pane was long enough to scroll').toBeGreaterThan(0);
  });

  test('“Skip to main content” still lands the h1 in view, on the tablet', async ({ page }) => {
    await open(page, TABLET_IN_THE_SHELL);
    const lines: string[] = [];
    for (const route of LIST_DETAIL) {
      await visit(page, route, hrefForSelection(route, await selectionOf(page, route)));
      // From the page's furthest scroll, so the skip link has the 52 px of
      // footer line to undo rather than landing where the page already was.
      await scrollPageToEnd(page);
      await focusSkipLinkInPlace(page);
      await page.keyboard.press('Enter');
      await expect(page.locator('main')).toBeFocused();
      await settleScroll(page);
      const landed = await h1Landing(page);
      lines.push(
        `${route.id}: h1 ${landed.top.toFixed(0)}–${landed.bottom.toFixed(0)}, ` +
          `clear of the header by ${(landed.top - landed.ceiling).toFixed(0)} px`,
      );
      expect(landed.top, `${route.id}: the h1 is under the header`).toBeGreaterThanOrEqual(
        landed.ceiling,
      );
      expect(landed.bottom, `${route.id}: the h1 is below the fold`).toBeLessThanOrEqual(
        landed.floor,
      );
    }
    console.log(`[#723] skip link @ ${TABLET_IN_THE_SHELL.name}\n  ${lines.join('\n  ')}`);
  });

  /*
   * The skip-link case's control (#731's review). On #723's layout the page
   * scrolls by one footer line, so "the h1 is in view" would be true of almost
   * anything. Under the pre-#723 layout, where the page scrolls the whole list,
   * the SAME measurement taken from the page's end must find the h1 out of view
   * — which shows the assertions above can go red — and the skip link must
   * then still bring it back.
   */
  test('the control — from the end of a page that scrolls, the h1 is out of view until the skip link', async ({
    page,
  }) => {
    await open(page, TABLET_IN_THE_SHELL, 'data=populated&panes=page');
    let measured = 0;
    for (const route of LIST_DETAIL) {
      await visit(page, route, hrefForSelection(route, await selectionOf(page, route)));
      await scrollPageToEnd(page);
      const before = await h1Landing(page);
      if (before.scrollY < 200) continue;
      measured += 1;
      expect(
        before.top < before.ceiling || before.bottom > before.floor,
        `${route.id}: scrolled ${String(before.scrollY)} px, the h1 at ` +
          `${before.top.toFixed(0)}–${before.bottom.toFixed(0)} still read as in view`,
      ).toBe(true);
      await focusSkipLinkInPlace(page);
      await page.keyboard.press('Enter');
      await expect(page.locator('main')).toBeFocused();
      await settleScroll(page);
      const landed = await h1Landing(page);
      expect(landed.top, `${route.id}: the h1 is under the header`).toBeGreaterThanOrEqual(
        landed.ceiling,
      );
    }
    expect(
      measured,
      'no page under the control scrolled far enough to hide its h1',
    ).toBeGreaterThan(0);
  });
});

/**
 * #941 — route and workout cards with their shape drawn on them, and since
 * #982 (the owner's ruling on epic #935) drawn about 48 px tall.
 *
 * Each Routes and Workouts card draws its route's climb or its workout's
 * blocks across its foot (`theme.css` §`.oyl-shape-card`). What is held here,
 * on the loads the blocks above already make:
 *
 * - **A primary moves down by the drawings' own cost and by no more**, in both
 *   palettes. #941's strip took the facts line's 1 em bottom margin and added
 *   no height, and this case held every margin at least equal to the same page
 *   without the shapes (`reflow.html?shape=off`, the card as it was before
 *   #941). A 48 px drawing cannot add nothing, so since #982 the hold is
 *   {@link SHAPE_CARD_COST_PIXELS} per card ABOVE the primary in its own
 *   column — counted on the page without the shapes — and not a pixel more:
 *   a card that also wrapped its words, gained a gap or doubled its drawing
 *   fails. Read in the same run, so the fonts that differ between a Mac and
 *   the CI runner cancel. Where #670 holds a primary above the fold, and above
 *   §4f's 50 px floor on the tablet ({@link PRIMARY_ON_ARRIVAL},
 *   {@link PRIMARY_WHEN_SELECTED}), that hold still applies, in the block
 *   above, unchanged.
 * - **The control**: `reflow.html?shape=tall` draws the shape at three times
 *   its declared height, and *Import route* on the upright tablet — the one
 *   place a held primary sits below the route cards — must then come out
 *   UNDER the bound above. Without it a shape that never rendered, or a
 *   measurement of the wrong element, would pass.
 * - **The shapes are there, decoration, 48 px tall, and painted with their
 *   tokens** in both palettes: one `aria-hidden` `<svg>` per card, holding at
 *   least one path, with no text, and each path's computed fill the kit's
 *   token for the palette (`illustration/paint.ts`), never a literal. The
 *   height is pinned because {@link SHAPE_CARD_COST_PIXELS} is derived from
 *   it.
 * - **The card's one link is a 44 × 44 target**, #316's three ways: the box,
 *   the declared `min-height`, and the box with that floor stripped, which
 *   must fall under 44 on one line — so the target is the floor's doing.
 */
const SHAPE_ROUTES = LIST_DETAIL.filter(
  (route) => route.id === 'routes' || route.id === 'workouts',
);

/** The drawing's declared height, `theme.css` §`.oyl-shape-card` (3rem). */
const SHAPE_ART_PIXELS = 48;

/**
 * What one card's drawing costs the page below it: its height, less the facts
 * line's 1 em bottom margin (16 px) that it takes the place of. #982.
 */
const SHAPE_CARD_COST_PIXELS = SHAPE_ART_PIXELS - 16;

interface PrimaryMargin {
  /** The primary's margin to its line, px. */
  readonly margin: number;
  /** How many laid-out shape cards end above it in its own column. */
  readonly cardsAbove: number;
}

/** Every primary's margin to its line, keyed by route, state and text. */
async function primaryMargins(page: Page, viewport: Viewport): Promise<Map<string, PrimaryMargin>> {
  const margins = new Map<string, PrimaryMargin>();
  for (const route of SHAPE_ROUTES) {
    for (const [state, hash] of [
      ['arrival', hrefFor(route)],
      ['selected', hrefForSelection(route, await selectionOf(page, route))],
    ] as const) {
      const seen = await visit(page, route, hash);
      const above = await page.evaluate(
        (primaries) => {
          const panes = document.querySelector('[data-oyl-panes]')?.getAttribute('data-oyl-panes');
          const cards = [...document.querySelectorAll('.oyl-main .oyl-shape-card')]
            .filter((card) => card.getClientRects().length > 0)
            .map((card) => ({
              bottom: card.getBoundingClientRect().bottom + window.scrollY,
              pane: card.closest('[data-oyl-pane]')?.getAttribute('data-oyl-pane') ?? null,
            }));
          return primaries.map(
            (primary) =>
              cards.filter(
                (card) =>
                  card.bottom <= primary.top && (panes === '1' || card.pane === primary.pane),
              ).length,
          );
        },
        seen.primaries.map(({ top, pane }) => ({ top, pane })),
      );
      seen.primaries.forEach((primary, index) => {
        margins.set(`${route.id} [${state}] “${primary.text}” @ ${viewport.name}`, {
          margin: seenLine(seen, primary) - primary.bottom,
          cardsAbove: above[index] ?? 0,
        });
      });
    }
  }
  return margins;
}

/** The least margin the shipped cards may leave a primary: #982's bound. */
function boundFor(before: PrimaryMargin): number {
  return before.margin - before.cardsAbove * SHAPE_CARD_COST_PIXELS - 0.5;
}

/*
 * #941 is two describes since #1137. The primaries' margins with the drawings
 * on and their control are LAYOUT measurements, and run NIGHTLY on the owner's
 * ruling of 2026-10-05 (`nightly.ts`); what a card's drawing is to assistive
 * technology (one `aria-hidden` shape, empty of text) and its link's 44 × 44
 * target stay in the required describe below it.
 */
test.describe('#941 — the drawings’ cost to each primary', { tag: NIGHTLY }, () => {
  /*
   * In both palettes (#941 asks for both), parametrised over `THEMES` with
   * `colorScheme` as the reflow walk is. Not only for form's sake: the dark
   * palette is not purely colour — `theme.css` swaps the brand images under
   * `:root[data-theme='dark']` — so "layout does not depend on the palette" is
   * measured here rather than assumed. Four more cases, about 3 s each locally.
   */
  for (const theme of THEMES) {
    test.describe(`${theme} palette`, () => {
      test.use({ colorScheme: theme });

      for (const viewport of [TABLET_IN_THE_SHELL, TABLET_UPRIGHT, PHONE, REFLOW]) {
        test(`a primary moves down by the drawings' cost and no more at ${viewport.name}, ${theme}`, async ({
          page,
        }) => {
          await open(page, viewport, 'data=populated&shape=off');
          expect(await page.locator('style[data-oyl-control="shape=off"]').count()).toBe(1);
          expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe(theme);
          const before = await primaryMargins(page, viewport);
          await open(page, viewport);
          expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe(theme);
          const after = await primaryMargins(page, viewport);
          console.log(
            `[#941] margins @ ${viewport.name}, ${theme}\n  ` +
              [...after]
                .map(([key, { margin }]) => {
                  const was = before.get(key);
                  return (
                    `${key}: ${margin.toFixed(1)} px (without shapes ` +
                    `${(was?.margin ?? Number.NaN).toFixed(1)}, ` +
                    `${String(was?.cardsAbove ?? Number.NaN)} card(s) above)`
                  );
                })
                .join('\n  '),
          );
          // Both maps hold something, or the comparison below holds over
          // nothing: a harness that stopped finding primaries would make two
          // empty maps equal and `worse` empty (#941's review).
          expect(before.size, `no primary measured without the shapes`).toBeGreaterThan(0);
          expect(after.size, `no primary measured with the shapes`).toBeGreaterThan(0);
          expect([...after.keys()]).toEqual([...before.keys()]);
          const worse = [...after]
            .filter(([key, { margin }]) => {
              const was = before.get(key);
              return was === undefined || margin < boundFor(was);
            })
            .map(([key, { margin }]) => `${key}: ${margin.toFixed(1)} px`);
          expect(worse).toEqual([]);
        });
      }
    });
  }

  test('the control — a shape three times as tall pushes Import route past the bound on the upright tablet', async ({
    page,
  }) => {
    const key = `routes [arrival] “Import route” @ ${TABLET_UPRIGHT.name}`;
    await open(page, TABLET_UPRIGHT, 'data=populated&shape=off');
    const before = (await primaryMargins(page, TABLET_UPRIGHT)).get(key);
    await open(page, TABLET_UPRIGHT, 'data=populated&shape=tall');
    expect(await page.locator('style[data-oyl-control="shape=tall"]').count()).toBe(1);
    const tall = (await primaryMargins(page, TABLET_UPRIGHT)).get(key);
    expect(before).toBeDefined();
    expect(tall).toBeDefined();
    const bound = before === undefined ? Number.NaN : boundFor(before);
    console.log(
      `[#941] control: ${key}: ${String(tall?.margin)} px, without shapes ` +
        `${String(before?.margin)} px, bound ${String(bound)} px`,
    );
    // A card must be above it, or the bound is the floor itself and the
    // control says nothing about the drawing's cost.
    expect(before?.cardsAbove ?? 0).toBeGreaterThan(0);
    expect(tall?.margin ?? Number.POSITIVE_INFINITY).toBeLessThan(bound);
  });
});

test.describe('#941 — cards with their shape drawn on them', () => {
  for (const theme of THEMES) {
    test(`every card carries one painted, aria-hidden shape, in the ${theme} palette`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: theme });
      await open(page, TABLET_IN_THE_SHELL);
      expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe(theme);
      const colours = paletteColours(theme);
      for (const route of SHAPE_ROUTES) {
        await visit(page, route, hrefFor(route));
        const cards = await page.evaluate(() =>
          [...document.querySelectorAll('.oyl-main .oyl-shape-card')].map((card) => {
            const svgs = [...card.querySelectorAll('svg')];
            const svg = svgs[0];
            const box = svg?.getBoundingClientRect();
            return {
              svgs: svgs.length,
              hidden: svg?.getAttribute('aria-hidden') ?? null,
              text: svg?.textContent ?? null,
              width: box?.width ?? 0,
              height: box?.height ?? 0,
              fills: [...(svg?.querySelectorAll('path') ?? [])].map(
                (path) => getComputedStyle(path).fill,
              ),
            };
          }),
        );
        expect(cards.length, `${route.id}: no card on the page`).toBeGreaterThan(0);
        const token = route.id === 'routes' ? 'illoHillNear' : 'accent';
        for (const card of cards) {
          expect(card.svgs).toBe(1);
          expect(card.hidden).toBe('true');
          expect(card.text).toBe('');
          expect(card.width).toBeGreaterThan(0);
          expect(card.height, `${route.id}: the drawing's height`).toBeCloseTo(SHAPE_ART_PIXELS, 0);
          expect(card.fills.length).toBeGreaterThan(0);
          for (const fill of card.fills) {
            expect(fill, `${route.id} in ${theme}`).toBe(rgbOf(colours[token]));
          }
        }
      }
    });
  }

  test('the card’s link is a 44 × 44 target, measured three ways', async ({ page }) => {
    await open(page, PHONE);
    for (const route of SHAPE_ROUTES) {
      await visit(page, route, hrefFor(route));
      const link = page.locator('.oyl-main .oyl-shape-card a[data-oyl-select]').first();
      const shipped = await link.boundingBox();
      expect(shipped?.width ?? 0, `${route.id}: the link's width`).toBeGreaterThanOrEqual(44);
      expect(shipped?.height ?? 0, `${route.id}: the link's height`).toBeGreaterThanOrEqual(44);
      expect(await link.evaluate((element) => getComputedStyle(element).minHeight)).toBe('44px');
      // On one line, as #316's specimen is: the fixtures' names are long
      // enough to wrap to 44 px on a phone by themselves, which would make
      // this read the wrapping and not the floor.
      const stripped = await link.evaluate((element) => {
        const style = (element as HTMLElement).style;
        style.minHeight = '0';
        style.whiteSpace = 'nowrap';
        const height = element.getBoundingClientRect().height;
        style.minHeight = '';
        style.whiteSpace = '';
        return height;
      });
      expect(stripped, `${route.id}: the floor is what makes the target`).toBeLessThan(44);
    }
  });
});

/**
 * #982 — how many cards fit before scrolling, published. The populated fixture
 * holds one route and one workout, so a count of the cards it renders says
 * nothing; the first card is COPIED, thirty times, into its own list, and every
 * card whose bottom clears the line its pane is seen to (the fold, or the
 * bottom of a pane that scrolls on its own) is counted. Real layout, real
 * fonts, the copies removed again before anything else reads the page. Read
 * under `?shape=off` and as shipped in the same run, so the two counts differ
 * by the drawing alone. Published, not held: how many fit is the owner's
 * trade (#982), and the fold the controls must clear is held above.
 */
async function cardsBeforeScrolling(
  page: Page,
  fold: number,
): Promise<{ fit: number; top: number; height: number; seen: number }> {
  return page.evaluate((line) => {
    const first = document.querySelector('.oyl-main .oyl-shape-card');
    const list = first?.parentElement;
    if (first === null || first === undefined || list === null || list === undefined) {
      return { fit: -1, top: 0, height: 0, seen: 0 };
    }
    const box = first.getBoundingClientRect();
    const copies: Element[] = [];
    for (let index = 0; index < 30; index += 1) {
      const copy = first.cloneNode(true) as Element;
      list.append(copy);
      copies.push(copy);
    }
    const pane = first.closest('[data-oyl-pane]');
    const paneBottom =
      pane === null || getComputedStyle(pane).overflowY === 'visible'
        ? Number.POSITIVE_INFINITY
        : pane.getBoundingClientRect().bottom + window.scrollY;
    const seen = Math.min(line, paneBottom);
    const fit = [...list.querySelectorAll(':scope > .oyl-shape-card')].filter(
      (card) => card.getBoundingClientRect().bottom + window.scrollY <= seen,
    ).length;
    for (const copy of copies) {
      copy.remove();
    }
    return { fit, top: box.top + window.scrollY, height: box.height, seen };
  }, fold);
}

test.describe('#982 — how many cards fit before scrolling, published', () => {
  for (const viewport of [TABLET_IN_THE_SHELL, TABLET_UPRIGHT, PHONE]) {
    test(`at ${viewport.name}`, async ({ page }) => {
      const counts = new Map<string, Record<'off' | 'shipped', string>>();
      for (const [query, column] of [
        ['data=populated&shape=off', 'off'],
        ['data=populated', 'shipped'],
      ] as const) {
        await open(page, viewport, query);
        for (const route of SHAPE_ROUTES) {
          const seen = await visit(page, route, hrefFor(route));
          const { fit, top, height, seen: line } = await cardsBeforeScrolling(page, seen.fold);
          expect(fit, `${route.id}: no card on the page`).toBeGreaterThanOrEqual(0);
          const entry = counts.get(route.id) ?? { off: '', shipped: '' };
          counts.set(route.id, {
            ...entry,
            [column]:
              `${String(fit)} (first card y ${top.toFixed(0)}, ${height.toFixed(1)} px tall, ` +
              `seen to y ${line.toFixed(0)})`,
          });
        }
      }
      console.log(
        `[#982] cards before scrolling @ ${viewport.name}\n  ` +
          [...counts]
            .map(([id, { off, shipped }]) => `${id}: ${shipped}; without shapes ${off}`)
            .join('\n  '),
      );
    });
  }
});

/** `#7db678` → `rgb(125, 182, 120)`, as `getComputedStyle` reports a fill. */
function rgbOf(hex: string): string {
  const value = Number.parseInt(hex.slice(1), 16);
  return `rgb(${String((value >> 16) & 255)}, ${String((value >> 8) & 255)}, ${String(value & 255)})`;
}

/**
 * #1072 — a card carried into its detail, with Motion (ADR 0041).
 *
 * Each frame for 0.7 s after the press, the detail's wrapper
 * (`ListDetail.tsx` §"Carrying a card into its detail") is read for its
 * computed transform: a card carried shows frames that are not at rest, and
 * ends at rest. ⚠️ **The control is the same selection by ADDRESS**: the hash
 * set by hand, which no press asked for, must show no frame off rest — so
 * the carried assertion is about the press, and not about some transition the
 * pane always runs. And under `prefers-reduced-motion: reduce` a press must
 * move nothing either, with the same press under no preference, on a list
 * mounted afresh in the same page, as that case's control.
 *
 * Since #1137 the carry runs NIGHTLY (`nightly.ts`, the owner's ruling of
 * 2026-10-05) and the reduced-motion case is its own describe, which stays in
 * the required job; the helpers below are shared by both.
 */

/** Frames whose transform was off rest, read for 0.7 s around `act`. */
async function framesOffRest(page: Page, act: () => Promise<void>): Promise<string[]> {
  await page.evaluate(() => {
    const held = window as unknown as { oylCarry?: string[] };
    held.oylCarry = [];
    const until = performance.now() + 700;
    const sample = (): void => {
      const wrapper = document.querySelector('[data-oyl-pane="detail"] .oyl-list-detail__carried');
      if (wrapper !== null) held.oylCarry?.push(getComputedStyle(wrapper).transform);
      if (performance.now() < until) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await act();
  await page.waitForTimeout(750);
  const frames = await page.evaluate(
    () => (window as unknown as { oylCarry?: string[] }).oylCarry ?? [],
  );
  expect(frames.length, 'no frame of the detail was read').toBeGreaterThan(10);
  // It ends where it belongs, whatever happened on the way.
  expect(['none', 'matrix(1, 0, 0, 1, 0, 0)']).toContain(frames.at(-1));
  return frames.filter((each) => each !== 'none' && each !== 'matrix(1, 0, 0, 1, 0, 0)');
}

/** Motion's features arrive in a chunk of their own; a press before them is not carried. */
async function motionLoaded(page: Page): Promise<void> {
  await page.waitForFunction(() =>
    performance
      .getEntriesByType('resource')
      .some((entry) => entry.name.includes('motion-features')),
  );
  await page.waitForTimeout(100);
}

async function press(page: Page, route: RouteDefinition): Promise<() => Promise<void>> {
  await visit(page, route, hrefFor(route));
  await motionLoaded(page);
  const id = await selectionOf(page, route);
  return async () => {
    await page.locator(`[data-oyl-pane="list"] a[data-oyl-select="${id}"]`).click();
  };
}

test.describe('#1072 — a card carried into its detail', { tag: NIGHTLY }, () => {
  for (const viewport of [SHORT_LANDSCAPE, PHONE]) {
    test(`on every list–detail route at ${viewport.name}, and the control by address`, async ({
      page,
    }) => {
      await open(page, viewport);
      expect(LIST_DETAIL.map((route) => route.id).sort()).toEqual([
        'activities',
        'routes',
        'workouts',
      ]);
      for (const route of LIST_DETAIL) {
        const carried = await framesOffRest(page, await press(page, route));
        expect(carried.length, `${route.id}: the card was not carried`).toBeGreaterThan(0);

        // The control: the same item chosen by address, with no press.
        await visit(page, route, hrefFor(route));
        const id = await selectionOf(page, route);
        const byAddress = await framesOffRest(page, async () => {
          await page.evaluate(
            (hash) => {
              window.location.hash = hash;
            },
            hrefForSelection(route, id),
          );
        });
        expect(byAddress, `${route.id}: a selection by address moved`).toEqual([]);
      }
    });
  }
});

/*
 * #1072's reduced-motion half stays REQUIRED (#1137): a rider who asked for
 * less motion is an accessibility claim, and the carry above it is appearance.
 */
test.describe('#1072 — a card is not carried under reduced motion', () => {
  test('under reduced motion a press moves nothing, and the control moves', async ({ page }) => {
    // Asked before the page loads: Motion reads the preference when an
    // element mounts (ADR 0041's amendment for #1072 says what that costs).
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await open(page, SHORT_LANDSCAPE);
    const [first, second] = LIST_DETAIL;
    if (first === undefined || second === undefined) throw new Error('no list–detail routes');
    const reduced = await framesOffRest(page, await press(page, first));
    expect(reduced, 'a transform ran under prefers-reduced-motion: reduce').toEqual([]);
    // The control: no preference, on a list mounted afresh — a press carries.
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    const moved = await framesOffRest(page, await press(page, second));
    expect(moved.length, 'the control did not move: the reading is blind').toBeGreaterThan(0);
  });
});
