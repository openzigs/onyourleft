// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #1552 attribution on a mapped ride — the OpenStreetMap credit on the ride
 * screen, in a real engine, exactly when the ride's world was given map data.
 *
 * `ride.html?corridor=archive` reads the harness route's corridor through the
 * product's own port from the synthetic archive (`ride-corridor.ts`), rides
 * it, and the credit must be in the HUD overlay as text, found by an
 * accessible locator, on its opaque panel, on screen and over nothing at every
 * overlay viewport. `?corridor=none` is the control: the realistic world asked
 * for and no map data, so no credit.
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
} from './ride-stage';

/** `tokens.ts` §`hudInkMuted`, as the engine reports it. */
const HUD_INK_MUTED = 'rgb(168, 182, 194)';

/** The credit as an assistive technology finds it: text in the HUD's region. */
const credit = (page: Page) =>
  page.getByRole('region', { name: 'Ride metrics' }).getByText(OSM_ATTRIBUTION, { exact: true });

test.describe('#1552 attribution on a mapped ride', () => {
  for (const viewport of OVERLAY_VIEWPORTS) {
    test(`the credit is in the overlay, on its panel, on screen and over nothing — ${viewport.name}`, async ({
      browser,
    }) => {
      const page = await sharedRide(browser, viewport, '?corridor=archive');
      await expect(credit(page)).toBeVisible();
      await expect(credit(page)).toHaveCount(1);
      // Not a live region: nothing about it changes.
      expect(
        await credit(page).evaluate(
          (line) => line.closest('[role="status"], [role="alert"], [aria-live]') !== null,
        ),
      ).toBe(false);
      // On the opaque HUD surface, in the muted ink whose pair is AA.
      const painted = await credit(page).evaluate((line) => ({
        colour: getComputedStyle(line).color,
        panel: (() => {
          const panel = line.closest('.oyl-hud__panel');
          return panel === null ? undefined : getComputedStyle(panel).backgroundColor;
        })(),
      }));
      expect(painted).toEqual({ colour: HUD_INK_MUTED, panel: HUD_SURFACE });

      const rider = riderBox(viewport);
      for (const [how, seen] of await bothWays(page)) {
        const line = named(seen.items, 'the map credit');
        expect(inside(line.box, viewport) && line.onTop, `${how}: ${describeItem(line)}`).toBe(
          true,
        );
        // It is in the actions panel, so Pause and End ride must still be
        // on screen and on top, and no panel may have grown over the rider.
        for (const control of ['control: Pause', 'control: End ride']) {
          const seenControl = named(seen.items, control);
          expect(
            inside(seenControl.box, viewport) && seenControl.onTop,
            `${how}: ${describeItem(seenControl)}`,
          ).toBe(true);
        }
        expect(
          seen.panels.filter((each) => overlap(each.box, rider)).map(describeItem),
          how,
        ).toEqual([]);
      }
    });
  }

  test('the control — the realistic world asked for, no map data: no credit', async ({ page }) => {
    const viewport = OVERLAY_VIEWPORTS[0];
    if (viewport === undefined) throw new Error('no overlay viewport');
    await openRide(page, viewport, '?corridor=none');
    // The ride is on the stage, so "absent" is not "not rendered yet".
    await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
    await expect(page.getByText(OSM_ATTRIBUTION)).toHaveCount(0);
  });
});
