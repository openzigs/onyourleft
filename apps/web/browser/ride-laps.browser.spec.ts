// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A loop's lap splits on the ride HUD — #2080, `game/hud/LapSplits.tsx`.
 *
 * `ride.html?lap=ended` rides the harness's four-metre loop with three laps
 * already stated by its port (`ride-harness.tsx` §`HARNESS_LAPS`): the first
 * of another course, the second the best of this one at 57:55, the third the
 * last at 59:59 — every time an hour-short lap can read, at its widest. The
 * panel is held at every overlay viewport, both ways (#1120), to the layout's
 * own invariants (`ride-stage.ts` §`layoutFaults`):
 *
 * - drawn whole on a tablet, at the end edge where a race's standings are,
 *   over no panel and clear of the leaning rider;
 * - visually hidden on a phone, whose corners are taken, and still in the
 *   document for a screen reader;
 * - not drawn at all on a point-to-point route;
 * - and in a race, swapped with the standings by a 48 px control on a tablet,
 *   which a phone does not display.
 */

import { expect, test, type Page } from '@playwright/test';

import {
  OVERLAY_VIEWPORTS,
  TABLET_VIEWPORTS,
  LAPTOP_VIEWPORTS,
  bothWays,
  layoutFaults,
  measure,
  openRide,
  sharedRide,
  type Viewport,
} from './ride-stage';
import type { StageMeasurement } from './ride-harness';
import { attachSharedPageOnFailure, releaseSharedPage } from './shared-load';

test.afterAll(releaseSharedPage);

test.afterEach(async () => {
  await attachSharedPageOnFailure(test.info());
});

/** What the panel says of the harness's laps: lap 4 under way, lap 3 the last, lap 2 the best. */
const HARNESS_ROWS = [
  ['Now', '4', '59:59', '—'],
  ['Last', '3', '59:59', '342 W'],
  ['Best', '2', '57:55', '342 W'],
];

/** What a phone's stage gives up while a lap's notice is up: the route panel's cell. */
const NOTICE_HAS_THE_ROUTE_CELL = [
  'lost: the elevation strip [0,0 → 0,0] COVERED',
  // #2075: and the road ahead beside the strip, in the same panel.
  'lost: the road ahead [0,0 → 0,0] COVERED',
  'lost: the plan view [0,0 → 0,0] COVERED',
  'not whole: oyl-hud__panel oyl-hud__route [0,0 → 0,0] COVERED',
];

/** The panel's rows, once the harness's laps have reached it. */
async function splitRows(page: Page): Promise<string[][]> {
  await page.waitForFunction(
    () =>
      document.querySelector('.oyl-hud__laps-row:nth-child(2) .oyl-hud__laps-value')
        ?.textContent === '3',
  );
  return page.evaluate(() =>
    [...document.querySelectorAll('.oyl-hud__laps-row')].map((row) =>
      [...row.querySelectorAll('.oyl-hud__laps-label, .oyl-hud__laps-value')].map(
        (cell) => cell.textContent ?? '',
      ),
    ),
  );
}

/** The panel's box, as drawn. */
async function splitsBox(page: Page): Promise<{ width: number; height: number }> {
  return page.evaluate(() => {
    const box = document.querySelector('.oyl-hud__laps')?.getBoundingClientRect();
    return { width: box?.width ?? 0, height: box?.height ?? 0 };
  });
}

/**
 * Where each case is held: every overlay viewport at the normal size, and the
 * tablets at #2079's large and extra large text (PR #2248's review: in a race
 * on a loop at 800×1280 the standings were over the leaning rider at both),
 * the only screens where the setting draws anything different.
 */
const SIZED_VIEWPORTS = [
  ...OVERLAY_VIEWPORTS.map((viewport) => ({ viewport, size: '', text: '' })),
  ...(['large', 'extra-large'] as const).flatMap((size) =>
    TABLET_VIEWPORTS.map((viewport) => ({
      viewport,
      size: ` at ${size} text`,
      text: `&text=${size}`,
    })),
  ),
];

/**
 * And a laptop's or a desktop's window under 47 rem tall: the owner's ruling of
 * 2026-11-06 (#2034) ties the splits' give-way to phones, so it draws them.
 */
const LOOP_VIEWPORTS = [
  ...SIZED_VIEWPORTS,
  ...LAPTOP_VIEWPORTS.map((viewport) => ({ viewport, size: '', text: '' })),
];

for (const { viewport, size, text } of LOOP_VIEWPORTS) {
  test(`#2080 a loop's lap splits hold the layout${size} — ${viewport.name}`, async ({
    browser,
  }) => {
    const page = await sharedRide(browser, viewport, `?lap=ended${text}`);
    expect(await splitRows(page)).toEqual(HARNESS_ROWS);
    const tablet = TABLET_VIEWPORTS.includes(viewport) || LAPTOP_VIEWPORTS.includes(viewport);
    const box = await splitsBox(page);
    if (tablet) {
      // Drawn: wide enough for its four columns, and a panel the rider reads.
      expect(box.width).toBeGreaterThan(150);
      expect(box.height).toBeGreaterThan(60);
    } else {
      // Clipped to nothing on a phone, and still in the document.
      expect(box.width * box.height).toBeLessThanOrEqual(1);
    }
    for (const [how, seen] of await bothWays(page)) {
      // ⚠️ On a phone the lap's notice takes the route panel's cell for its
      // seconds (#437, `ride-workout.browser.spec.ts` §"#1312"), so the strip
      // and the plan view are not laid out — exactly those, and nothing else.
      expect(layoutFaults(seen, viewport), how).toEqual(tablet ? [] : NOTICE_HAS_THE_ROUTE_CELL);
      if (tablet) {
        expect(
          seen.panels.some((panel) => panel.name.includes('oyl-hud__laps')),
          how,
        ).toBe(true);
      }
    }
  });
}

test('#2080 the control — a point-to-point route draws no lap splits', async ({ browser }) => {
  const tablet = TABLET_VIEWPORTS[0];
  if (tablet === undefined) throw new Error('no tablet viewport');
  const page = await sharedRide(browser, tablet);
  await measure(page);
  expect(await page.locator('.oyl-hud__laps').count()).toBe(0);
});

/**
 * The layout's faults less those of a reading clipped to a pixel: what a
 * layout gives way to a race (#419) — on the 4:3 tablet a room's readings
 * (#2130), and at #2079's large text a room's gaps and wind on a landscape
 * tablet. `ride-room.browser.spec.ts` and `ride-hud-layout.browser.spec.ts`
 * hold which give way; here they are named in the log and set aside.
 */
function raceFaults(seen: StageMeasurement, viewport: Viewport, label: string): string[] {
  // A reading clipped to a pixel, or a control a state does not draw (*Follow*
  // and *Report* while *Report*'s reasons are open, laid out at no size).
  const clipped = seen.items
    .filter((each) => each.box.width * each.box.height <= 1)
    .map((each) => each.name);
  if (clipped.length > 0)
    console.log(`#2080 ${label} — ${viewport.name}: gave way ${clipped.join(', ')}`);
  return layoutFaults(seen, viewport).filter(
    (fault) => !clipped.some((name) => fault.startsWith(`lost: ${name} [`)),
  );
}

/** The race's swap control, by its words. */
function swapControl(page: Page, words: string) {
  return page.locator('.oyl-hud__swap', { hasText: words });
}

/**
 * The races on a loop the swap is held in: a lap race, the same with
 * *Report*'s reasons open (the actions panel at its tallest), and an ORDINARY
 * race with *Report* open (PR #2248's review: its standings, with the swap,
 * ran 23 px into the actions panel at 1024×768 at large text).
 */
const RACES_ON_A_LOOP = [
  ['a lap race', '?room=lap-race&lap=ended'],
  ['a lap race with Report open', '?room=lap-race-report&lap=ended'],
  ['a race with Report open', '?room=report&lap=ended'],
] as const;

/** The owner's least clearance between the panel and the actions panel (2026-11-06). */
const MARGIN_PIXELS = 16;

for (const [race, query] of RACES_ON_A_LOOP) {
  for (const { viewport, size, text } of SIZED_VIEWPORTS) {
    test(`#2080 in ${race} on a loop, the splits swap with the standings${size} — ${viewport.name}`, async ({
      page,
    }) => {
      await openRide(page, viewport, `${query}${text}`);
      await page.waitForSelector('.oyl-hud__standings');
      const tablet = TABLET_VIEWPORTS.includes(viewport);
      if (!tablet) {
        // A phone draws neither panel, so it offers no control to swap them.
        const seen = await measure(page);
        expect(seen.givenWay).toContain('control: Show laps');
        expect(await swapControl(page, 'Show laps').isVisible()).toBe(false);
        return;
      }
      /** The shown panel's clearance above the actions panel, logged and held. */
      const clearance = (seen: StageMeasurement, panel: string, how: string): void => {
        const shown = seen.panels.find((each) => each.name.includes(panel));
        const actions = seen.panels.find((each) => each.name.includes('oyl-hud__actions'));
        const margin = (actions?.box.top ?? 0) - (shown?.box.bottom ?? 0);
        console.log(
          `#2080 ${race}: ${panel} with the swap${size}, ${how} — ${viewport.name}: ` +
            `${margin.toFixed(0)} px above the actions panel`,
        );
        expect(margin, `${panel}, ${how}`).toBeGreaterThanOrEqual(MARGIN_PIXELS);
      };
      const toLaps = swapControl(page, 'Show laps');
      const before = await toLaps.boundingBox();
      expect(before?.height ?? 0).toBeGreaterThanOrEqual(48);
      for (const [how, seen] of await bothWays(page)) {
        expect(raceFaults(seen, viewport, `standings${size}, ${how}`), `standings, ${how}`).toEqual(
          [],
        );
        clearance(seen, 'oyl-hud__standings', how);
      }
      await toLaps.click();
      expect(await page.locator('.oyl-hud__standings').count()).toBe(0);
      expect(await splitRows(page)).toEqual(HARNESS_ROWS);
      // The press took its panel away; the focus is on the control that brings it back.
      const back = swapControl(page, 'Show standings');
      await expect(back).toBeFocused();
      // The owner's ruling of 2026-11-06 (#2034): the same small button in
      // the same corner — the box the finger pressed is the box it presses back.
      const after = await back.boundingBox();
      for (const side of ['x', 'y', 'width', 'height'] as const) {
        expect(Math.abs((after?.[side] ?? -99) - (before?.[side] ?? 99)), side).toBeLessThanOrEqual(
          1,
        );
      }
      for (const [how, seen] of await bothWays(page)) {
        expect(raceFaults(seen, viewport, `splits${size}, ${how}`), `splits, ${how}`).toEqual([]);
        clearance(seen, 'oyl-hud__laps', how);
      }
    });
  }
}
