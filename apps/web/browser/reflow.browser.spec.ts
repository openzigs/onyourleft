// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * No screen scrolls sideways on a phone — #660, WCAG 2.2 SC 1.4.10 (Reflow).
 *
 * Every route in `shell/routes.ts` §`ALL_ROUTES` — imported, never listed here
 * (#142's rule) — is opened in `reflow.html` at the three viewports #660 names,
 * with the real shell over **empty** and **populated** fixtures, and the
 * document is asserted not to scroll horizontally. A parameterised route is
 * opened with the fixture id the harness publishes; a parameterised route the
 * harness has no id for is a FAILURE, not a skip (#654's re-review).
 *
 * ## Why this is a browser gate
 *
 * jsdom performs no layout (CLAUDE.md §4e), so nothing in the Vitest suite can
 * say how wide a table lays out. The Activities screen was 447 px wide in a
 * 320 px phone and Credits 595 px, through every gate green — the one 320 px
 * check here measured the shell harness, whose views render no table at all.
 *
 * ## What else a route must satisfy
 *
 * - **It rendered.** Its `h1` is its own title, so a blank page, the not-found
 *   page and a route that never arrived cannot pass.
 * - **A populated route is populated.** The harness declares, for every route,
 *   what is on the page when its fixture reached the view — present in the
 *   populated walk and absent in the empty one — or why nothing on it comes
 *   from a fixture. A route it declares nothing for is a fault in both walks.
 * - **Nothing threw.** An uncaught error or an unhandled rejection raised
 *   while a route rendered or settled is that route's fault.
 * - **A box that scrolls sideways inside itself is reachable.** SC 1.4.10
 *   exempts a table's two-dimensional layout only when a keyboard user can
 *   scroll it: the box takes focus, is a `region` and has a name (#654's
 *   re-review) — the role `a11y/audit.ts` §`table-in-scroll-region` requires,
 *   not merely any role. The document itself must still not scroll.
 *
 * ## The controls
 *
 * - `?control=overflow` puts an over-wide element in `main`. The same fault
 *   function must report it — otherwise a harness that measured nothing, or a
 *   `scrollWidth` read off the wrong element, would pass every route.
 * - `?control=scroller`, `unnamed` and `grouped` each put a box that scrolls
 *   inside itself and lacks one thing: focus, a name, the `region` role. The
 *   scroll-box rule must report each, for the thing it lacks.
 * - `?control=region` puts the same box done properly — focusable, a region,
 *   named. The rule must NOT report it, so it cannot pass by flagging
 *   everything that scrolls and the product then being made to scroll nothing.
 *
 * ## What it does NOT prove
 *
 * Nothing about a real phone's fonts, a text-size setting above 100 %, or a
 * screen reader. It measures CSS pixels in the pinned Chromium, and prints
 * every route's margin so a near miss is visible rather than green.
 */

import { expect, test, type Page } from '@playwright/test';

import { THEMES } from '../src/design/tokens';
import { ALL_ROUTES, hrefFor, type RouteDefinition } from '../src/shell/routes';

import type { ReflowMeasurement } from './reflow-harness';

/** The three viewports #660 names: SC 1.4.10's 320×256, and a phone both ways up. */
const VIEWPORTS = [
  [320, 256],
  [390, 844],
  [844, 390],
] as const;

const DATASETS = ['empty', 'populated'] as const;

/** Sub-pixel rounding in `scrollWidth`; a whole pixel is a real overflow. */
const SUBPIXEL_TOLERANCE = 0;

/** SC 2.5.5's 44 × 44 — `shell.browser.spec.ts` §`TOUCH_TARGET_PIXELS`, for its reason. */
const TOUCH_TARGET_PIXELS = 44;

async function open(page: Page, width: number, height: number, query: string): Promise<void> {
  await page.setViewportSize({ width, height });
  const response = await page.goto(`/reflow.html?${query}`);
  expect(
    response?.status(),
    'reflow.html did not load — is it named in vite.browser.config.ts build.rollupOptions.input?',
  ).toBe(200);
  await page.waitForFunction(() => window.__oylReflow !== undefined);
  const published = await page.evaluate(() => ({
    ready: window.__oylReflow?.ready,
    errors: window.__oylReflow?.errors,
  }));
  expect(published.errors, 'the reflow harness reported an error').toEqual([]);
  expect(published.ready).toBe(true);
}

/** The hash a route is opened at, or a fault when a parameter is needed and there is none. */
async function hashFor(page: Page, route: RouteDefinition): Promise<string | { fault: string }> {
  if (!route.path.split('/').some((segment) => segment.startsWith(':'))) {
    return hrefFor(route);
  }
  const parameter = await page.evaluate((id) => window.__oylReflow?.parameters[id], route.id);
  return parameter === undefined
    ? { fault: `${route.id}: parameterised (${route.path}) and the harness has no fixture id` }
    : hrefFor(route, parameter);
}

async function visit(page: Page, hash: string): Promise<ReflowMeasurement> {
  const measured = await page.evaluate(async (target) => window.__oylReflow?.visit(target), hash);
  if (measured === undefined) {
    throw new Error('the reflow harness published no measurement');
  }
  return measured;
}

/**
 * Everything wrong with one route's measurement, as sentences. Empty is a pass.
 * The controls call this too, which is what makes them controls.
 */
function reflowFaults(
  route: RouteDefinition,
  seen: ReflowMeasurement,
  populated: boolean,
): string[] {
  const faults: string[] = [];
  const where = `${route.id} at ${String(seen.viewport.width)}×${String(seen.viewport.height)}`;
  if (seen.routeId !== route.id) {
    faults.push(`${where}: opened ${seen.hash} and got the ${seen.routeId} route`);
  }
  if (seen.h1 !== route.title) {
    faults.push(`${where}: the h1 is "${seen.h1}", not "${route.title}"`);
  }
  if (!seen.settledWithinPatience) {
    faults.push(`${where}: the page did not settle`);
  }
  if (seen.documentOverflow > SUBPIXEL_TOLERANCE) {
    faults.push(
      `${where}: the document scrolls sideways by ${String(seen.documentOverflow)} px — widest is ${seen.widest}`,
    );
  }
  const expected = seen.expectation;
  if (expected === undefined) {
    faults.push(
      `${where}: reflow-harness.tsx §POPULATED says nothing about this route — name what its ` +
        'fixture puts on the page, or why nothing on it comes from one',
    );
  } else if (expected.kind === 'fixture' && seen.markerPresent !== populated) {
    faults.push(
      populated
        ? `${where}: the populated fixture did not reach the view (no ${expected.marker})`
        : `${where}: ${expected.marker} is on the EMPTY page, so it cannot tell the two walks apart`,
    );
  } else if (expected.kind === 'constant' && seen.markerPresent !== true) {
    faults.push(`${where}: ${expected.marker} is missing, and it does not depend on the fixtures`);
  }
  for (const error of seen.errors) {
    faults.push(`${where}: the page raised "${error}"`);
  }
  for (const box of seen.scrollBoxes) {
    if (!box.focusable || box.role !== 'region' || box.name === '') {
      faults.push(
        `${where}: ${box.description} scrolls sideways by ${String(box.overflow)} px and is not a ` +
          `focusable, named region (focusable ${String(box.focusable)}, role ${String(box.role)}, ` +
          `name "${box.name}")`,
      );
    }
  }
  return faults;
}

/*
 * #672: the walk runs under a light device and a dark one (the dark one at
 * {@link DARK_VIEWPORTS}). Colour moves no box,
 * so what the dark walk can find is a route that throws, or lays out
 * differently, only in the dark palette — a `color-scheme: dark` scrollbar is
 * one thing that is not the same width everywhere. Parametrised rather than
 * copied, so a check added to the walk reaches both.
 */
/**
 * The viewports the dark walk runs at — SC 1.4.10's 320×256 alone, measured
 * rather than guessed: on #672's first CI run the dark walks of this spec and
 * `controls-first`'s added 64 s of test time to a job that finished 12 s inside
 * its 20-minute stop. What a dark walk can find that a light one cannot is a
 * route that fails in the dark palette, and 320×256 is where a
 * `color-scheme: dark` scrollbar or a wider box would show first.
 */
const DARK_VIEWPORTS = VIEWPORTS.filter(([width]) => width === 320);

for (const theme of THEMES) {
  test.describe(`${theme} palette`, () => {
    test.use({ colorScheme: theme });

    for (const data of DATASETS) {
      for (const [width, height] of theme === 'light' ? VIEWPORTS : DARK_VIEWPORTS) {
        test(`every route in the route table reflows at ${String(width)}×${String(height)}, ${data}, ${theme}`, async ({
          page,
        }) => {
          test.setTimeout(180_000);
          await open(page, width, height, `data=${data}`);
          // #672: the dark walk is dark — not a light page walked twice.
          expect(await page.evaluate(() => document.documentElement.dataset['theme'])).toBe(theme);
          const faults: string[] = [];
          const margins: string[] = [];
          for (const route of ALL_ROUTES) {
            const hash = await hashFor(page, route);
            if (typeof hash !== 'string') {
              faults.push(hash.fault);
              continue;
            }
            const seen = await visit(page, hash);
            faults.push(...reflowFaults(route, seen, data === 'populated'));
            margins.push(
              `${route.id}: ${seen.spare.toFixed(1)} px spare` +
                (seen.scrollBoxes.length === 0
                  ? ''
                  : ` (scroll boxes: ${seen.scrollBoxes.map((box) => `${box.description} +${String(box.overflow)}`).join(', ')})`),
            );
          }
          // Asked of the PAGE, which reads `ALL_ROUTES` for itself: a walk over a
          // hand list, or one that dropped a route, leaves the page holding a
          // route it never rendered.
          const unvisited = await page.evaluate(() => window.__oylReflow?.unvisited());
          expect(unvisited, 'routes in ALL_ROUTES the walk never opened').toEqual([]);
          console.log(
            `reflow ${data} ${String(width)}×${String(height)}\n  ${margins.join('\n  ')}`,
          );
          expect(faults).toEqual([]);
          // Per route above, which names the route; this catches one raised after
          // the last route was measured.
          const raised = await page.evaluate(() => window.__oylReflow?.errors);
          expect(raised, 'errors the page raised during the walk').toEqual([]);
        });
      }
    }
  });
}

/**
 * #660's second criterion, measured: the library is a card list on a phone and
 * in #670's list pane, and stays a table where its columns fit — decided by `library/layout.ts` from the
 * width the library is given. And its sort control is a `select` with the
 * 44 px target every control here has (#316).
 */
test.describe('the activity library is cards on a phone and a table where it fits', () => {
  const activities = ALL_ROUTES.find((each) => each.id === 'activities');
  if (activities === undefined) {
    throw new Error('the route table has no activities route');
  }
  // ⚠️ 844×390 is CARDS since #670: at 840 px and wider the library is the
  // list pane of a list–detail layout, 22.5rem wide, which is narrower than a
  // table's columns. The table is where one pane is wide enough for it — the
  // tablet upright.
  const expected = [
    [320, 256, 'cards'],
    [390, 844, 'cards'],
    [844, 390, 'cards'],
    [800, 1280, 'table'],
  ] as const;
  for (const [width, height, layout] of expected) {
    test(`a ${layout === 'cards' ? 'card list' : 'table'} at ${String(width)}×${String(height)}`, async ({
      page,
    }) => {
      // The first frame: every animation frame from navigation on records the
      // library's layout, so a table drawn for one frame and then swapped for
      // cards is seen. `rAF` callbacks run just before the browser paints, so
      // what one reads is what that frame drew (#683's review).
      await page.addInitScript(() => {
        const frames: string[] = [];
        (window as unknown as { __oylLayoutFrames: string[] }).__oylLayoutFrames = frames;
        const sample = (): void => {
          const drawn = document.querySelector('.oyl-library')?.getAttribute('data-layout');
          if (drawn !== undefined && drawn !== null) {
            frames.push(drawn);
          }
          requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      });
      await open(page, width, height, 'data=populated');
      const seen = await visit(page, hrefFor(activities));
      expect(seen.libraryLayout).toBe(layout);
      const frames = await page.evaluate(
        () => (window as unknown as { __oylLayoutFrames: string[] }).__oylLayoutFrames,
      );
      expect(frames.length, 'no frame drew the library').toBeGreaterThan(0);
      expect(frames[0], 'the first frame that drew the library').toBe(layout);
      expect(new Set(frames), 'every frame that drew the library').toEqual(new Set([layout]));
      expect(seen.sortControlHeight ?? 0).toBeGreaterThanOrEqual(TOUCH_TARGET_PIXELS);
      expect(reflowFaults(activities, seen, true)).toEqual([]);
    });
  }
});

test.describe('the controls', () => {
  const route = ALL_ROUTES[0];
  if (route === undefined) {
    throw new Error('ALL_ROUTES is empty');
  }

  for (const [width, height] of VIEWPORTS) {
    test(`an over-wide element fails the walk at ${String(width)}×${String(height)}`, async ({
      page,
    }) => {
      await open(page, width, height, 'data=empty&control=overflow');
      const seen = await visit(page, hrefFor(route));
      const faults = reflowFaults(route, seen, false);
      expect(faults.some((fault) => fault.includes('the document scrolls sideways'))).toBe(true);
    });
  }

  for (const [control, lacks] of [
    ['scroller', 'focusable false'],
    ['unnamed', 'name ""'],
    ['grouped', 'role group'],
  ] as const) {
    test(`a sideways scroller with ${lacks} fails the walk`, async ({ page }) => {
      await open(page, 320, 256, `data=empty&control=${control}`);
      const seen = await visit(page, hrefFor(route));
      const faults = reflowFaults(route, seen, false);
      expect(seen.documentOverflow).toBeLessThanOrEqual(0);
      expect(
        faults.filter(
          (fault) => fault.includes('is not a focusable, named region') && fault.includes(lacks),
        ),
      ).toHaveLength(1);
    });
  }

  test('a real ScrollTable wider than the phone, with hidden text at its far end, passes it', async ({
    page,
  }) => {
    await open(page, 320, 256, 'data=empty&control=region');
    const seen = await visit(page, hrefFor(route));
    expect(seen.scrollBoxes.length).toBeGreaterThan(0);
    expect(reflowFaults(route, seen, false)).toEqual([]);
  });
});
