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
  bothWays,
  layoutFaults,
  measure,
  openRide,
  sharedRide,
} from './ride-stage';
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
  'lost: the plan view [0,0 → 0,0] COVERED',
  'not whole: oyl-hud__panel oyl-hud__route [0,0 → 0,0] COVERED',
];

/** The panel's rows, once the harness's laps have reached it. */
async function splitRows(page: Page): Promise<string[][]> {
  await page.waitForFunction(
    () => document.querySelector('.oyl-hud__laps tbody tr:nth-child(2) td')?.textContent === '3',
  );
  return page.evaluate(() =>
    [...document.querySelectorAll('.oyl-hud__laps tbody tr')].map((row) =>
      [...row.children].map((cell) => cell.textContent ?? ''),
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

for (const viewport of OVERLAY_VIEWPORTS) {
  test(`#2080 a loop's lap splits hold the layout — ${viewport.name}`, async ({ browser }) => {
    const page = await sharedRide(browser, viewport, '?lap=ended');
    expect(await splitRows(page)).toEqual(HARNESS_ROWS);
    const tablet = TABLET_VIEWPORTS.includes(viewport);
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

/** The race's swap control, by its words. */
function swapControl(page: Page, words: string) {
  return page.locator('.oyl-hud__swap', { hasText: words });
}

for (const viewport of OVERLAY_VIEWPORTS) {
  test(`#2080 in a race on a loop, the splits swap with the standings — ${viewport.name}`, async ({
    page,
  }) => {
    await openRide(page, viewport, '?room=lap-race&lap=ended');
    await page.waitForSelector('.oyl-hud__standings');
    const tablet = TABLET_VIEWPORTS.includes(viewport);
    if (!tablet) {
      // A phone draws neither panel, so it offers no control to swap them.
      const seen = await measure(page);
      expect(seen.givenWay).toContain('control: Show laps');
      expect(await swapControl(page, 'Show laps').isVisible()).toBe(false);
      return;
    }
    const toLaps = swapControl(page, 'Show laps');
    const box = await toLaps.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(48);
    for (const [how, seen] of await bothWays(page)) {
      const standings = seen.panels.find((each) => each.name.includes('oyl-hud__standings'));
      const actions = seen.panels.find((each) => each.name.includes('oyl-hud__actions'));
      console.log(
        `#2080 standings with the swap, ${how} — ${viewport.name}: ` +
          `${((actions?.box.top ?? 0) - (standings?.box.bottom ?? 0)).toFixed(0)} px above the actions panel`,
      );
      expect(layoutFaults(seen, viewport), `standings, ${how}`).toEqual([]);
    }
    await toLaps.click();
    expect(await page.locator('.oyl-hud__standings').count()).toBe(0);
    expect(await splitRows(page)).toEqual(HARNESS_ROWS);
    // The press took its panel away; the focus is on the control that brings it back.
    const back = swapControl(page, 'Show standings');
    await expect(back).toBeFocused();
    expect((await back.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(48);
    for (const [how, seen] of await bothWays(page)) {
      expect(layoutFaults(seen, viewport), `splits, ${how}`).toEqual([]);
    }
  });
}
