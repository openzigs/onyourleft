// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The ride HUD at the rider's own text size and with their panels turned off
 * — #2079, `game/hud/hud-layout-preference.ts`.
 *
 * #2079's criterion: *every text size passes the HUD layout specs at all nine
 * viewports*. `ride.browser.spec.ts` and its siblings measure the normal size;
 * this lays the same page out at *large* and *extra large*, written to the
 * device where Settings writes them (`ride-harness.tsx` §`?text=`), at every
 * overlay viewport, both ways (#1120), and holds the layout's own invariants:
 *
 * - every reading and control on the stage, uncovered, with no scrolling;
 * - every panel whole, and none laid over another;
 * - no panel over the leaning rider;
 * - a primary reading visibly larger than a secondary one;
 * - and the size the rider chose drawn where Settings says it is — on a
 *   tablet — and the normal size on a phone, which has no room for it.
 *
 * And with every panel a rider may turn off turned off (`?hide=`), the same
 * invariants, the panels gone and the notices' cell still the HUD's.
 */

import { expect, test } from '@playwright/test';

import {
  MINIMUM_TIER_RATIO,
  OVERLAY_VIEWPORTS,
  TABLET_VIEWPORTS,
  bothWays,
  describeItem,
  inside,
  measure,
  overlap,
  riderBox,
  sharedRide,
  type Viewport,
} from './ride-stage';
import type { StageMeasurement } from './ride-harness';
import { attachSharedPageOnFailure, releaseSharedPage } from './shared-load';

test.afterAll(releaseSharedPage);

test.afterEach(async () => {
  await attachSharedPageOnFailure(test.info());
});

/** The primary value's size in px at the normal text size: `theme.css`'s 2.5 rem. */
const NORMAL_PRIMARY_PIXELS = 40;

/** What `theme.css` §"THE HUD'S TEXT SIZE" sets a primary value at on a tablet. */
const PRIMARY_PIXELS = { large: 50, 'extra-large': 60 } as const;

/** The layout's own invariants, as the ride's specs hold them, as failure lines. */
function layoutFaults(seen: StageMeasurement, viewport: Viewport): string[] {
  const faults: string[] = [];
  if (seen.scrollY !== 0 || seen.stageScrollTop !== 0) faults.push('the stage scrolled');
  for (const item of seen.items) {
    if (!inside(item.box, viewport) || !item.onTop) faults.push(`lost: ${describeItem(item)}`);
  }
  for (const panel of seen.panels) {
    if (!inside(panel.box, viewport)) faults.push(`not whole: ${describeItem(panel)}`);
  }
  seen.panels.forEach((a, index) => {
    for (const b of seen.panels.slice(index + 1)) {
      if (overlap(a.box, b.box)) faults.push(`${describeItem(a)} × ${describeItem(b)}`);
    }
  });
  const rider = riderBox(viewport);
  for (const panel of seen.panels) {
    if (overlap(panel.box, rider)) faults.push(`over the rider: ${describeItem(panel)}`);
  }
  if (seen.primaryValuePixels / seen.secondaryValuePixels < MINIMUM_TIER_RATIO) {
    faults.push(
      `primary ${String(seen.primaryValuePixels)} px over secondary ${String(seen.secondaryValuePixels)} px`,
    );
  }
  return faults;
}

for (const size of ['large', 'extra-large'] as const) {
  for (const viewport of OVERLAY_VIEWPORTS) {
    test(`#2079 the HUD at ${size} text holds its layout — ${viewport.name}`, async ({
      browser,
    }) => {
      const page = await sharedRide(browser, viewport, `?text=${size}`);
      const tablet = TABLET_VIEWPORTS.includes(viewport);
      for (const [how, seen] of await bothWays(page)) {
        expect(layoutFaults(seen, viewport), how).toEqual([]);
        // Drawn at the rider's size on a tablet, and at the normal size on a
        // phone, which Settings says has no room for it.
        expect(seen.primaryValuePixels, how).toBe(
          tablet ? PRIMARY_PIXELS[size] : NORMAL_PRIMARY_PIXELS,
        );
      }
    });
  }
}

test('#2079 the control — without the text size the primary value is the normal size', async ({
  browser,
}) => {
  const tablet = TABLET_VIEWPORTS[0];
  if (tablet === undefined) throw new Error('no tablet viewport');
  const page = await sharedRide(browser, tablet);
  const seen = await measure(page);
  expect(seen.primaryValuePixels).toBe(NORMAL_PRIMARY_PIXELS);
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
