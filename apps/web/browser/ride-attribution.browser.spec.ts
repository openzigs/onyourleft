// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #1552 attribution on a mapped ride — the OpenStreetMap credit on the ride
 * screen, in a real engine, exactly when the ride's world was given map data.
 *
 * `ride.html?corridor=archive` reads the harness route's corridor through the
 * product's own port from the synthetic archive (`ride-corridor.ts`), rides
 * it, and the credit must be in the HUD's region as text, found by an
 * accessible locator, OUTSIDE every panel, in its place on the road on its
 * own opaque backing, and over nothing — no panel, no control, not the leaning
 * rider — at every overlay viewport, both with anchor positioning and
 * without. `?corridor=none` is the control: the realistic world asked for and
 * no map data, so no credit.
 *
 * ⚠️ **Where it is, since the owner's ruling on #1572** (ADR 0054 D-3.6, D-8
 * Q3): a small line in a corner of the game view, clear of the HUD —
 * `theme.css` §"THE MAP DATA'S CREDIT" says which corner, and why a phone on
 * its side has none to give and gets the bottom-centre under the rider. The first
 * version put it inside the actions panel; this file held it there.
 *
 * ⚠️ The issue names `game.html?realistic&corridor=archive`. `game.html` is
 * the renderer's probe page and mounts no `GameView`, so it has no HUD to
 * carry a credit; `ride.html` is the page that rides the real `GameView` under
 * the real shell, and is where this is measured. `ride-corridor.ts` says why
 * the page's renderer stays in the stylised world.
 */

import { expect, test, type Page } from '@playwright/test';

import { OSM_ATTRIBUTION } from '../src/map/basemap';

import {
  HUD_SURFACE,
  OVERLAY_VIEWPORTS,
  bothWays,
  describeItem,
  inside,
  named,
  openRide,
  overlap,
  riderBox,
  sharedRide,
  SUBPIXEL_TOLERANCE,
  type Viewport,
} from './ride-stage';
import { attachSharedPageOnFailure, releaseSharedPage } from './shared-load';

import type { StageMeasurement } from './ride-harness';

// The page the cases below share goes when this file's cases do (`shared-load.ts`).
test.afterAll(releaseSharedPage);
// What a red shared case read, since the `page` fixture's screenshot is not it (#1076).
test.afterEach(async () => {
  await attachSharedPageOnFailure(test.info());
});

/** `tokens.ts` §`hudInkMuted`, as the engine reports it. */
const HUD_INK_MUTED = 'rgb(168, 182, 194)';

/** The credit as an assistive technology finds it: text in the HUD's region. */
const credit = (page: Page) =>
  page.getByRole('region', { name: 'Ride metrics' }).getByText(OSM_ATTRIBUTION, { exact: true });

/** `theme.css` §`--oyl-space-sm`: the gap the HUD's grid keeps between its panels. */
const PANEL_GAP = 8;

/** `HudPanel`'s class for the credit, which the harness measures as a panel. */
const CREDIT_CLASS = 'oyl-hud__attribution';

/** The column layout (`theme.css` §"COLUMN"): under 46 rem wide, 47 rem tall or more. */
function isColumn(viewport: Viewport): boolean {
  return viewport.width < 736 && viewport.height >= 752;
}

/** The SHORT corners layout (a phone on its side): 46 rem wide or more, 30 rem tall or less. */
function isShortCorners(viewport: Viewport): boolean {
  return viewport.width >= 736 && viewport.height <= 480;
}

/**
 * The rides the HUD is most crowded on, each with map data: what `ride.browser`,
 * `ride-notices`, `ride-workout` and `ride-room` measure without a credit.
 * A crowded panel is where a corner line would first meet something.
 */
const CROWDED: readonly { readonly name: string; readonly query: string }[] = [
  // #576: on a phone on its side the side camera's row is lifted into the
  // bottom-start strip, which on CI's fonts left the credit no room there.
  { name: 'sounds on and a side camera filming', query: '&side=filming&sounds=on' },
  // #647's standing notice, which takes the route panel's cell on a phone.
  { name: 'a standing notice and a workout', query: '&keepalive=failed&trainer=workout' },
  // #789: a race with *Report*'s three reasons open — the tallest actions panel.
  { name: 'a race with Report open', query: '&room=report' },
  // #1347: a race's standings, a panel of its own on a tablet.
  { name: 'a race with its standings', query: '&room=standings' },
];

/**
 * The credit, measured: on screen, on top, over no other panel and no item
 * on the stage (a reading, a control, a line), and clear of the leaning rider.
 */
function clearOfEverything(seen: StageMeasurement, viewport: Viewport, how: string): void {
  const line = seen.panels.find((each) => each.name === CREDIT_CLASS);
  if (line === undefined) throw new Error(`${how}: no credit on the stage`);
  expect(inside(line.box, viewport) && line.onTop, `${how}: ${describeItem(line)}`).toBe(true);
  expect(
    seen.panels
      .filter((each) => each !== line && each.box.height > 1 && overlap(each.box, line.box))
      .map(describeItem),
    `${how}: panels under ${describeItem(line)}`,
  ).toEqual([]);
  expect(
    seen.items
      .filter((each) => each.name !== 'the map credit' && overlap(each.box, line.box))
      .map(describeItem),
    `${how}: items under ${describeItem(line)}`,
  ).toEqual([]);
  expect(overlap(line.box, riderBox(viewport)), `${how}: over the rider`).toBe(false);
}

test.describe('#1552 attribution on a mapped ride', () => {
  for (const viewport of OVERLAY_VIEWPORTS) {
    test(`the credit is in its place, out of every panel, on its own backing and over nothing — ${viewport.name}`, async ({
      browser,
    }) => {
      const page = await sharedRide(browser, viewport, '?corridor=archive');
      await expect(credit(page)).toBeVisible();
      await expect(credit(page)).toHaveCount(1);
      const painted = await credit(page).evaluate((line) => ({
        // Not a live region: nothing about it changes.
        live: line.closest('[role="status"], [role="alert"], [aria-live]') !== null,
        // Clear of the HUD: in no panel, not even the actions panel it was in.
        inPanel: line.closest('.oyl-hud__panel') !== null,
        colour: getComputedStyle(line).color,
        // #423: over the world, so its own backing is the HUD's opaque surface.
        backing: getComputedStyle(line).backgroundColor,
        opacity: getComputedStyle(line).opacity,
      }));
      expect(painted).toEqual({
        live: false,
        inPanel: false,
        colour: HUD_INK_MUTED,
        backing: HUD_SURFACE,
        opacity: '1',
      });

      const rider = riderBox(viewport);
      for (const [how, seen] of await bothWays(page)) {
        clearOfEverything(seen, viewport, how);
        const line = named(seen.items, 'the map credit');
        const route = seen.panels.find((each) => each.name.includes('oyl-hud__route'));
        if (route === undefined) throw new Error(`${how}: no route panel`);
        const where = `${how}: ${describeItem(line)} beside ${describeItem(route)}`;
        if (isShortCorners(viewport)) {
          // A phone on its side: bottom-centre, between the bottom panels and
          // under the rider (`theme.css` says why it is not a corner there).
          const centre = (line.box.left + line.box.right) / 2;
          expect(Math.abs(centre - viewport.width / 2), where).toBeLessThanOrEqual(
            SUBPIXEL_TOLERANCE,
          );
          expect(Math.abs(line.box.bottom - route.box.bottom), where).toBeLessThanOrEqual(
            SUBPIXEL_TOLERANCE,
          );
          // …and kept from both bottom panels by at least the gap the HUD's
          // grid keeps between panels (`--oyl-space-sm`), as a panel would be.
          const actions = seen.panels.find((each) => each.name.includes('oyl-hud__actions'));
          if (actions === undefined) throw new Error(`${how}: no actions panel`);
          expect(line.box.left - route.box.right, where).toBeGreaterThanOrEqual(PANEL_GAP);
          expect(
            actions.box.left - line.box.right,
            `${where}, ${describeItem(actions)}`,
          ).toBeGreaterThanOrEqual(PANEL_GAP);
        } else {
          // The corner: the start edge, where the primary readings begin…
          const primary = seen.panels.find((each) =>
            each.name.includes('oyl-hud__fields--primary'),
          );
          if (primary === undefined) throw new Error(`${how}: no primary panel`);
          expect(Math.abs(line.box.left - primary.box.left), where).toBeLessThanOrEqual(
            SUBPIXEL_TOLERANCE,
          );
          // …hung from the route panel: above it on a tablet, under it (in
          // the sky) on a phone upright.
          const gap = isColumn(viewport)
            ? line.box.top - route.box.bottom
            : route.box.top - line.box.bottom;
          expect(gap, where).toBeGreaterThan(0);
          expect(gap, where).toBeLessThan(16 + SUBPIXEL_TOLERANCE);
        }
        // Pause and End ride are still on screen and on top…
        for (const control of ['control: Pause', 'control: End ride']) {
          const seenControl = named(seen.items, control);
          expect(
            inside(seenControl.box, viewport) && seenControl.onTop,
            `${how}: ${describeItem(seenControl)}`,
          ).toBe(true);
        }
        // …and no panel, the credit among them, is over the rider.
        expect(
          seen.panels.filter((each) => overlap(each.box, rider)).map(describeItem),
          how,
        ).toEqual([]);
      }
    });
  }

  for (const crowded of CROWDED) {
    for (const viewport of OVERLAY_VIEWPORTS) {
      test(`on a crowded ride — ${crowded.name} — the credit is still over nothing — ${viewport.name}`, async ({
        browser,
      }) => {
        const page = await sharedRide(browser, viewport, `?corridor=archive${crowded.query}`);
        await expect(credit(page)).toBeVisible();
        for (const [how, seen] of await bothWays(page)) {
          clearOfEverything(seen, viewport, how);
        }
      });
    }
  }

  test('the HUD keeps its light palette on a dark page, so the pair is the same AA pair', async ({
    page,
  }) => {
    const viewport = OVERLAY_VIEWPORTS[0];
    if (viewport === undefined) throw new Error('no overlay viewport');
    await page.emulateMedia({ colorScheme: 'dark' });
    await openRide(page, viewport, '?corridor=archive');
    const painted = await credit(page).evaluate((line) => ({
      dark: window.matchMedia('(prefers-color-scheme: dark)').matches,
      colour: getComputedStyle(line).color,
      backing: getComputedStyle(line).backgroundColor,
    }));
    expect(painted).toEqual({ dark: true, colour: HUD_INK_MUTED, backing: HUD_SURFACE });
  });

  test('the control — the realistic world asked for, no map data: no credit', async ({ page }) => {
    const viewport = OVERLAY_VIEWPORTS[0];
    if (viewport === undefined) throw new Error('no overlay viewport');
    await openRide(page, viewport, '?corridor=none');
    // The ride is on the stage, so "absent" is not "not rendered yet".
    await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
    await expect(page.getByText(OSM_ATTRIBUTION)).toHaveCount(0);
  });
});
