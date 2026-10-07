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
 * jsdom performs no layout (docs/agents/accessibility.md §4e), so nothing in the Vitest suite can
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

import { THEMES, type Theme } from '../src/design/tokens';
import { ALL_ROUTES, hrefFor, type RouteDefinition } from '../src/shell/routes';

import { NIGHTLY } from './nightly';
import { LIGHT_PHONE_WALKED_BY_CONTROLS_FIRST, reflowFaults, reflowMargin } from './reflow-faults';
import type { ReflowMeasurement } from './reflow-harness';

/** The three viewports #660 names: SC 1.4.10's 320×256, and a phone both ways up. */
const VIEWPORTS = [
  [320, 256],
  [390, 844],
  [844, 390],
] as const;

const DATASETS = ['empty', 'populated'] as const;

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

/*
 * #672: the walk runs under a light device and a dark one, at every viewport
 * in both. Colour moves no box, so what the dark walk can find is a route that
 * throws, or lays out differently, only in the dark palette — a
 * `color-scheme: dark` scrollbar is one thing that is not the same width
 * everywhere. Parametrised rather than copied, so a check added to the walk
 * reaches both.
 *
 * ⚠️ For one commit the dark walk ran at 320×256 alone, because #672's first
 * CI run (36422201251) finished 12 s inside the job's then 20-minute stop. #682
 * made that stop 25 minutes and the gate's own 840 s, and the whole dark set
 * came back. What it costs is six cases here and in `controls-first` (every
 * viewport but 320×256 and the phone): about 5.7 s each and 17 s of wall time
 * over two workers locally, and 38.7 s summed on the runner (run 36427026037).
 * docs/agents/browser-gate.md §4f records the job and gate times it was measured at.
 *
 * ⚠️ **Since #1076 the DARK walk runs NIGHTLY, and the light walk stays in the
 * required gate** — the owner's ruling of 2026-10-03, for about 22 s of the
 * required job on the slower runner. A reviewer who remembers both palettes
 * in `test:browser` is reading the old file. The dark walk is tagged
 * {@link NIGHTLY} and listed in `nightly.ts` with its reason; what it can find
 * that the light walk cannot is a fault that appears in the dark palette
 * only, and that is found the next morning rather than before the merge. The
 * dark palette's COLOURS stay required: `theme.browser.spec.ts`, and the dark
 * reads in `links`, `button-hierarchy` and `controls-first`.
 *
 * ⚠️ **Since #1128 the light walk at 390×844 is run by
 * `controls-first.browser.spec.ts`**, whose light phone walk opened the same
 * page with the same query in the same palette: it hands every route's
 * measurement to `reflow-faults.ts` §`reflowFaults` as well as to #666's rules,
 * and its two cases are named `… and every route reflows (#660)`. The light
 * walk here runs 320×256 and 844×390; the dark walk still runs all three.
 */

// The two describes below name the palettes, so a third palette would be
// walked by neither: fail at load rather than pass over it.
if (THEMES.join(',') !== 'light,dark') {
  throw new Error(
    `reflow.browser.spec.ts walks the light and dark palettes; tokens.ts §THEMES is now ${THEMES.join(', ')}`,
  );
}

test.describe('the light palette', () => {
  test.use({ colorScheme: 'light' });
  reflowWalks('light');
});

test.describe('the dark palette — #672, nightly since #1076', { tag: NIGHTLY }, () => {
  test.use({ colorScheme: 'dark' });
  reflowWalks('dark');
});

/**
 * One walk per fixture and viewport, under the palette the describe set. A
 * function declaration below the two describes that call it, so that a check
 * added to the walk reaches both palettes.
 */
function reflowWalks(theme: Theme): void {
  for (const data of DATASETS) {
    for (const [width, height] of VIEWPORTS) {
      if (
        theme === 'light' &&
        width === LIGHT_PHONE_WALKED_BY_CONTROLS_FIRST.width &&
        height === LIGHT_PHONE_WALKED_BY_CONTROLS_FIRST.height
      ) {
        // #1128: `controls-first.browser.spec.ts` walks this page and judges
        // every route with `reflowFaults` — see `reflow-faults.ts`.
        continue;
      }
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
          margins.push(reflowMargin(route, seen));
        }
        // Asked of the PAGE, which reads `ALL_ROUTES` for itself: a walk over a
        // hand list, or one that dropped a route, leaves the page holding a
        // route it never rendered.
        const unvisited = await page.evaluate(() => window.__oylReflow?.unvisited());
        expect(unvisited, 'routes in ALL_ROUTES the walk never opened').toEqual([]);
        console.log(`reflow ${data} ${String(width)}×${String(height)}\n  ${margins.join('\n  ')}`);
        expect(faults).toEqual([]);
        // Per route above, which names the route; this catches one raised after
        // the last route was measured.
        const raised = await page.evaluate(() => window.__oylReflow?.errors);
        expect(raised, 'errors the page raised during the walk').toEqual([]);
      });
    }
  }
}

/**
 * #1087 — the workout builder WITH blocks reflows at 320×256 and 844×390.
 *
 * The walks above render the builder with no blocks, so its block list and
 * block chart (#1043, #1050) — drawn only once a block exists — were never
 * reflow-checked. `?builder=blocks` adds one block of each kind through the
 * builder's own *Add block* form (`reflow-harness.tsx` §`buildOnWorkouts`),
 * and the Workouts route is judged by the same `reflowFaults` as every route
 * in the walk. Its control keeps each block's line on one line
 * (`&blocks=nowrap`), which must scroll the page sideways at 320×256 — so a
 * green case here laid the block list out.
 */
test.describe('the workout builder with blocks reflows — #1087', () => {
  const route = ALL_ROUTES.find((each) => each.id === 'workouts');
  if (route === undefined) {
    throw new Error('ALL_ROUTES has no workouts route');
  }
  for (const [width, height] of VIEWPORTS.filter(([w]) => w !== 390)) {
    test(`at ${String(width)}×${String(height)}`, async ({ page }) => {
      await open(page, width, height, 'data=populated&builder=blocks');
      const seen = await visit(page, hrefFor(route));
      const builder = page.locator('.oyl-main .oyl-sections').first();
      // The fixture is what it says, or this walked the empty builder again.
      expect(await builder.locator('ol > li').count()).toBe(4);
      expect(await builder.locator('svg.oyl-block-chart').count()).toBe(1);
      console.log(
        `reflow builder=blocks ${String(width)}×${String(height)}: ${reflowMargin(route, seen)}`,
      );
      expect(reflowFaults(route, seen, true)).toEqual([]);
    });
  }

  test('the control — a block line that cannot wrap scrolls the page sideways at 320×256', async ({
    page,
  }) => {
    await open(page, 320, 256, 'data=populated&builder=blocks&blocks=nowrap');
    const seen = await visit(page, hrefFor(route));
    const faults = reflowFaults(route, seen, true);
    expect(
      faults.some((fault) => fault.includes('the document scrolls sideways')),
      faults.join('\n'),
    ).toBe(true);
  });
});

/**
 * #1041, measured: the activity library is a card per ride at EVERY width —
 * one column on a phone and in #670's list pane beside a ride, and more than
 * one where one pane is wide enough for two cards (the tablet upright) — and
 * there is no table at any of them, in any frame. Until #1041 it was a table
 * from 32 rem (#660's `library/layout.ts`), which the 800×1280 case here used
 * to require. And its sort control is a `select` with the 44 px target every
 * control here has (#316), as is each card's link.
 */
test.describe('the activity library is cards at every width', () => {
  const activities = ALL_ROUTES.find((each) => each.id === 'activities');
  if (activities === undefined) {
    throw new Error('the route table has no activities route');
  }
  // ⚠️ 844×390 is ONE column: at 840 px and wider the library is the list pane
  // of a list–detail layout, 22.5rem wide, too narrow for two cards.
  const expected = [
    [320, 256, 'one'],
    [390, 844, 'one'],
    [844, 390, 'one'],
    [800, 1280, 'several'],
  ] as const;
  for (const [width, height, columns] of expected) {
    test(`cards in ${columns === 'one' ? 'one column' : 'several columns'} at ${String(width)}×${String(height)}`, async ({
      page,
    }) => {
      // Every animation frame from navigation on records whether the library
      // drew a table, so one drawn for a single frame is seen (#683's review,
      // when a table was drawn first and then swapped for cards).
      await page.addInitScript(() => {
        const frames: boolean[] = [];
        (window as unknown as { __oylTableFrames: boolean[] }).__oylTableFrames = frames;
        const sample = (): void => {
          const library = document.querySelector('.oyl-library');
          if (library !== null) {
            frames.push(library.querySelector('table') !== null);
          }
          requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      });
      await open(page, width, height, 'data=populated');
      const seen = await visit(page, hrefFor(activities));
      const library = seen.library;
      expect(library, 'the library was not drawn').not.toBeNull();
      expect(library?.tables).toBe(0);
      expect(library?.cards ?? 0).toBeGreaterThan(0);
      if (columns === 'one') {
        expect(library?.columns).toBe(1);
      } else {
        expect(library?.columns ?? 0).toBeGreaterThan(1);
      }
      expect(library?.shortestLink ?? 0).toBeGreaterThanOrEqual(TOUCH_TARGET_PIXELS);
      // The fixture's ride of `10:23:45` named "Spin" (`SHORT_LONG_RIDE`): its
      // link is 44 px wide by its own floor, and its duration fits its fact on
      // one line — the facts' tracks are 10rem since #1052 (9rem from #992).
      expect(library?.narrowestLink ?? 0).toBeGreaterThanOrEqual(TOUCH_TARGET_PIXELS);
      expect(library?.mostReadingLines, 'a reading wrapped').toBe(1);
      expect(library?.readingSpill ?? 1, 'a reading spilled out of its fact').toBeLessThanOrEqual(
        0.5,
      );
      const frames = await page.evaluate(
        () => (window as unknown as { __oylTableFrames: boolean[] }).__oylTableFrames,
      );
      expect(frames.length, 'no frame drew the library').toBeGreaterThan(0);
      expect(new Set(frames), 'a frame drew the library as a table').toEqual(new Set([false]));
      expect(seen.sortControlHeight ?? 0).toBeGreaterThanOrEqual(TOUCH_TARGET_PIXELS);
      expect(reflowFaults(activities, seen, true)).toEqual([]);
    });
  }
});

/**
 * #1052, measured: Home's facts — *Last ride* and *This week* — hold every
 * reading to one line inside its own fact at every viewport here. The
 * populated fixture's last ride moves for `10:23:45` and its week for
 * `28:35:45`, the widest a duration under a hundred hours draws, and they are
 * asserted to be on the page, so a fixture that stopped drawing one cannot
 * pass this green. Until #1052 the facts' tracks were 9rem, sized from a Mac's
 * font; on the CI runner's Linux font the same numerals are about 153 px.
 */
test.describe("Home's facts hold a ten-hour duration on one line", () => {
  const home = ALL_ROUTES.find((each) => each.id === 'home');
  if (home === undefined) {
    throw new Error('the route table has no home route');
  }
  for (const [width, height] of [...VIEWPORTS, [1280, 800]] as const) {
    test(`at ${String(width)}×${String(height)}`, async ({ page }) => {
      await open(page, width, height, 'data=populated');
      const seen = await visit(page, hrefFor(home));
      const facts = seen.homeFacts;
      expect(facts, 'Home was not drawn').not.toBeNull();
      const durations = (facts?.readings ?? []).filter((reading) =>
        /^\d+:\d\d:\d\d$/.test(reading),
      );
      // Last ride's moving time and this week's: both, and both ten hours or more.
      expect(durations, "Home's durations").toHaveLength(2);
      for (const duration of durations) {
        expect(duration, 'a duration under ten hours').toMatch(/^\d{2,}:/);
      }
      console.log(
        `home facts at ${String(width)}×${String(height)}: ${(facts?.readings ?? []).join(', ')}; ` +
          `spill ${String(facts?.readingSpill)} px, ${String(facts?.mostReadingLines)} line(s)`,
      );
      expect(facts?.mostReadingLines, 'a reading wrapped').toBe(1);
      expect(facts?.readingSpill ?? 1, 'a reading spilled out of its fact').toBeLessThanOrEqual(
        0.5,
      );
      expect(reflowFaults(home, seen, true)).toEqual([]);
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
