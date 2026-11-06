// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The ride HUD at the rider's own text size and with their panels turned off
 * — #2079, `game/hud/hud-layout-preference.ts`.
 *
 * #2079's criterion: *every text size passes the HUD layout specs at all nine
 * viewports*. `ride.browser.spec.ts` and its siblings measure the normal size;
 * this lays the same page out at *large* and *extra large*, written to the
 * device where Settings writes them (`ride-harness.tsx` §`?text=`), at every
 * overlay viewport, both ways (#1120), on a plain ride, in a room, in a
 * room's lap race, in a Delivery round and in a workout — PR #2235's review
 * found a race's standings over the leaning rider at 800×1280 in a room and
 * a lap race, which the plain ride alone did not show — and holds the
 * layout's own invariants:
 *
 * - every reading and control on the stage, uncovered, with no scrolling;
 * - every panel whole, and none laid over another;
 * - no panel over the leaning rider;
 * - a primary reading visibly larger than a secondary one;
 * - and the size the rider chose drawn where Settings says it is — on a
 *   tablet — and the normal size on a phone, which has no room for it.
 *
 * A reading a layout gives way to a mode's own (#419: a room's, a round's, a
 * race's) is clipped to a pixel, and a phone's route panel is not drawn while
 * a notice stands in its cell (#437); each mode's own spec holds which give
 * way at the normal size. Here an item or a panel laid out at no size is set
 * aside and named in the log, and power, *Pause* and *End ride* never are.
 *
 * And with every panel a rider may turn off turned off (`?hide=`), the same
 * invariants, the panels gone and the notices' cell still the HUD's.
 */

import { expect, test } from '@playwright/test';

import {
  OVERLAY_VIEWPORTS,
  TABLET_VIEWPORTS,
  bothWays,
  layoutFaults,
  measure,
  sharedRide,
  type Viewport,
} from './ride-stage';
import type { StageMeasurement } from './ride-harness';
import { attachSharedPageOnFailure, releaseSharedPage } from './shared-load';

test.afterAll(releaseSharedPage);

test.afterEach(async () => {
  await attachSharedPageOnFailure(test.info());
});

/** The primary value's size in px on a phone, at every text size: 2.5 rem. */
const PHONE_PRIMARY_PIXELS = 40;

/** The primary value's size in px on a tablet at the normal size: #2130's 3.815 rem. */
const TABLET_NORMAL_PRIMARY_PIXELS = 61.04;

/**
 * What `theme.css` §"THE HUD'S TEXT SIZE" sets a primary value at on a
 * tablet: 4.375 and 5 rem, each larger than #2130's normal size (PR #2235's
 * review: the first cut, 3.125 and 3.75 rem, was smaller than it).
 */
const PRIMARY_PIXELS = { large: 70, 'extra-large': 80 } as const;

/** The owner's least clearance between a race's standings and the actions panel. */
const STANDINGS_MARGIN_PIXELS = 16;

/** The landscape tablets, where the standings hang over the actions panel. */
const LANDSCAPE_TABLET = new Set(
  TABLET_VIEWPORTS.filter((each) => each.width > each.height).map((each) => each.name),
);

/** The rides the ride specs measure, by the harness's query. */
const MODES = [
  ['a plain ride', ''],
  // A room at its tallest: a race's standings, a rider followed, *Report*'s
  // reasons open and the sound row (`ride-room.browser.spec.ts` §"#1407").
  ['a room', '?room=report&sounds=on'],
  // And with a side camera's row on the route panel too (§"#1409").
  ['a room with a side camera', '?room=following&sounds=on&side=lost'],
  ['a lap race', '?room=lap-race'],
  ['a Delivery round', '?delivery=round'],
  ['a workout', '?trainer=workout'],
] as const;

/** What is never given way, at any size, in any mode. */
const ALWAYS_DRAWN = ['reading: Power', 'control: Pause', 'control: End ride'];

/** The layout's faults, less a clipped item's, and the clipped items' names. */
function sizeFaults(
  seen: StageMeasurement,
  viewport: Viewport,
): { readonly faults: string[]; readonly clipped: string[] } {
  const clipped = [...seen.items, ...seen.panels]
    .filter((each) => each.box.width * each.box.height <= 1)
    .map((each) => each.name);
  const faults = layoutFaults(seen, viewport).filter(
    (fault) =>
      !clipped.some(
        (name) => fault.startsWith(`lost: ${name} [`) || fault.startsWith(`not whole: ${name} [`),
      ),
  );
  return { faults, clipped };
}

for (const size of ['large', 'extra-large'] as const) {
  for (const [mode, query] of MODES) {
    for (const viewport of OVERLAY_VIEWPORTS) {
      test(`#2079 the HUD at ${size} text holds its layout — ${mode} — ${viewport.name}`, async ({
        browser,
      }) => {
        const page = await sharedRide(
          browser,
          viewport,
          `${query === '' ? '?' : `${query}&`}text=${size}`,
        );
        const tablet = TABLET_VIEWPORTS.includes(viewport);
        for (const [how, seen] of await bothWays(page)) {
          const { faults, clipped } = sizeFaults(seen, viewport);
          console.log(
            `#2079 ${size} ${mode} ${viewport.name} ${how}: clipped ${clipped.join(', ')}`,
          );
          expect(faults, how).toEqual([]);
          const names = seen.items.map((each) => each.name);
          for (const name of ALWAYS_DRAWN) {
            expect(names, how).toContain(name);
            expect(clipped, how).not.toContain(name);
          }
          // The owner's ruling of 2026-11-06 (#2034): a race's standings keep
          // 16 px or more above the actions panel on the landscape tablets.
          const standings = seen.panels.find((each) => each.name.includes('oyl-hud__standings'));
          const actions = seen.panels.find((each) => each.name.includes('oyl-hud__actions'));
          if (
            LANDSCAPE_TABLET.has(viewport.name) &&
            standings !== undefined &&
            actions !== undefined
          ) {
            const margin = actions.box.top - standings.box.bottom;
            console.log(
              `#2079 ${size} ${mode} ${viewport.name} ${how}: ${margin.toFixed(0)} px above the actions panel`,
            );
            expect(margin, how).toBeGreaterThanOrEqual(STANDINGS_MARGIN_PIXELS);
          }
          // Drawn at the rider's size on a tablet, and at the normal size on a
          // phone, which Settings says has no room for it.
          expect(seen.primaryValuePixels, how).toBe(
            tablet ? PRIMARY_PIXELS[size] : PHONE_PRIMARY_PIXELS,
          );
        }
      });
    }
  }
}

test('#2079 the control — without the text size the primary value is the normal size', async ({
  browser,
}) => {
  const tablet = TABLET_VIEWPORTS[0];
  if (tablet === undefined) throw new Error('no tablet viewport');
  const page = await sharedRide(browser, tablet);
  const seen = await measure(page);
  expect(seen.primaryValuePixels).toBe(TABLET_NORMAL_PRIMARY_PIXELS);
  // Each size larger than the normal one, the reason for the setting.
  expect(PRIMARY_PIXELS.large).toBeGreaterThan(TABLET_NORMAL_PRIMARY_PIXELS);
  expect(PRIMARY_PIXELS['extra-large']).toBeGreaterThan(PRIMARY_PIXELS.large);
});

/**
 * #2079's last criterion: 48 px targets for the toggles. Each choice in
 * Settings' *Ride HUD* panel is its whole label, so the label is the target:
 * measured on a phone and a tablet, where a rider sets them.
 */
for (const viewport of [
  { width: 360, height: 800 },
  { width: 1280, height: 800 },
] as const) {
  test(`#2079 every Ride HUD choice in Settings is a 48 px target — ${String(viewport.width)}×${String(viewport.height)}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto('/reflow.html?data=populated');
    await page.waitForFunction(() => window.__oylReflow?.ready === true);
    await page.evaluate(async () => window.__oylReflow?.visit('#/settings'));
    const choices = await page.evaluate(() =>
      [...document.querySelectorAll('.oyl-hud-layout__choice')].map((each) => {
        const box = each.getBoundingClientRect();
        return { text: (each.textContent ?? '').trim(), width: box.width, height: box.height };
      }),
    );
    expect(choices).toHaveLength(7);
    for (const choice of choices) {
      expect(choice.height, choice.text).toBeGreaterThanOrEqual(48);
      expect(choice.width, choice.text).toBeGreaterThanOrEqual(48);
    }
  });
}

for (const viewport of OVERLAY_VIEWPORTS) {
  test(`#2079 the HUD with every panel a rider may hide hidden — ${viewport.name}`, async ({
    browser,
  }) => {
    const page = await sharedRide(browser, viewport, '?hide=readings,route,graph,standings');
    for (const [how, seen] of await bothWays(page)) {
      expect(layoutFaults(seen, viewport), how).toEqual([]);
      const names = seen.items.map((each) => each.name);
      // The route panel and the graph are gone; power and the controls are not.
      expect(names, how).not.toContain('the elevation strip');
      expect(names, how).not.toContain('the plan view');
      expect(names, how).not.toContain('the recent graph');
      expect(names, how).toContain('reading: Power');
      expect(names, how).toContain('control: Pause');
      // The secondary tier keeps only the ride's times.
      expect(seen.secondary, how).toEqual(['Moving', 'Elapsed', 'Clock']);
    }
  });
}
