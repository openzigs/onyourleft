// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The power-zone colours as the pinned Chromium paints them — #2039, ADR 0063
 * D-4.
 *
 * `zones.a11y.test.tsx` checks the ramp's values and that every reader of a
 * zone colour renders the zones' numbers and names; neither can say what a
 * page PAINTS. This reads it back, in both palettes, from the two drawings
 * that paint zones:
 *
 * - the workout builder's block chart (`workouts/BlockChart.tsx`), in
 *   `reflow.html?builder=blocks` on Workouts, which adds one block of each
 *   kind through the builder's own form;
 * - a saved workout's card on Workouts, which draws the same chart at the
 *   card's size (the owner's ruling of 2026-11-04 on #2125), with the list's
 *   one key over the cards;
 * - the Ride screen's running-workout graph (`workout/WorkoutGraph.tsx`), in
 *   `rideview.html?workout=stepped`.
 *
 * For each, every band path's computed `fill` must be ADR 0063's colour for
 * its zone — written out below rather than read from `tokens.ts`, so the
 * spec checks the page against the decision and not against itself — and the
 * zone key beside the drawing must name that zone, by number and name, over a
 * swatch painted the same colour.
 *
 * `game/hud/PlanTrace.tsx` and `views/AnalysisView.tsx`, which #2039 also
 * names, paint no zone colour (`zones.a11y.test.tsx` finds the readers by
 * their imports), so there is nothing of theirs to read here.
 */

import { expect, test, type Page } from '@playwright/test';

import { POWER_ZONE_NAMES } from '@onyourleft/domain';

import { THEMES, type Theme } from '../src/design/tokens';

/** ADR 0063 D-4, zone 1 to 7, as Chromium reports a computed colour. */
const ZONE_COLOURS: Readonly<Record<Theme, readonly string[]>> = {
  dark: [
    'rgb(148, 154, 161)',
    'rgb(45, 116, 202)',
    'rgb(95, 195, 114)',
    'rgb(249, 223, 93)',
    'rgb(245, 148, 65)',
    'rgb(203, 87, 77)',
    'rgb(207, 145, 243)',
  ],
  light: [
    'rgb(108, 114, 120)',
    'rgb(0, 70, 140)',
    'rgb(0, 125, 48)',
    'rgb(150, 130, 0)',
    'rgb(143, 76, 0)',
    'rgb(130, 11, 15)',
    'rgb(126, 67, 159)',
  ],
};

/** The class suffix of each zone's band, zone 1 first: `oyl-block-chart__band-<suffix>`. */
const BAND_SUFFIXES = ['recovery', 'endurance', 'tempo', 'threshold', 'vo2', 'anaerobic', 'sprint'];

interface ZonesSeen {
  readonly bands: readonly { readonly zone: number; readonly fill: string }[];
  readonly key: readonly {
    readonly zone: number;
    readonly text: string;
    readonly swatch: string;
  }[];
}

/** Every band in `drawing` and every entry of the zone key that follows it. */
async function zonesIn(page: Page, drawing: string, keyWithin: string): Promise<ZonesSeen> {
  return page.evaluate(
    ({ drawing, keyWithin, suffixes }) => {
      const svg = document.querySelector(drawing);
      const bands = [...(svg?.querySelectorAll('path') ?? [])].flatMap((path) => {
        const name = [...path.classList].find((each) => each.startsWith('oyl-block-chart__band-'));
        if (name === undefined) return [];
        const zone = suffixes.indexOf(name.slice('oyl-block-chart__band-'.length)) + 1;
        return [{ zone, fill: getComputedStyle(path).fill }];
      });
      const holder = svg?.closest(keyWithin) ?? document;
      const key = [...holder.querySelectorAll('[data-oyl-zone-key] [data-oyl-zone]')].map(
        (entry) => ({
          zone: Number(entry.getAttribute('data-oyl-zone')),
          text: entry.textContent?.trim() ?? '',
          swatch:
            entry.querySelector('.oyl-zone-key__swatch') === null
              ? 'no swatch'
              : getComputedStyle(entry.querySelector('.oyl-zone-key__swatch') as Element)
                  .backgroundColor,
        }),
      );
      return { bands, key };
    },
    { drawing, keyWithin, suffixes: BAND_SUFFIXES },
  );
}

/** Each band painted in ADR 0063's colour for its zone, and named beside it in that colour. */
function zoneFaults(theme: Theme, seen: ZonesSeen): string[] {
  const faults: string[] = [];
  for (const { zone, fill } of seen.bands) {
    const expected = ZONE_COLOURS[theme][zone - 1];
    if (fill !== expected)
      faults.push(`zone ${String(zone)} is filled ${fill}, not ${String(expected)}`);
    const entry = seen.key.find((each) => each.zone === zone);
    const label = `${String(zone)} ${POWER_ZONE_NAMES[zone - 1] ?? ''}`;
    if (entry === undefined) faults.push(`zone ${label} is painted and not named in the key`);
    else {
      if (entry.text !== label)
        faults.push(`zone ${String(zone)} is named "${entry.text}", not "${label}"`);
      if (entry.swatch !== expected) faults.push(`zone ${label}'s swatch is ${entry.swatch}`);
    }
  }
  return faults;
}

for (const theme of THEMES) {
  test.describe(`#2039 — the zone colours, painted (${theme})`, () => {
    test.use({ colorScheme: theme, viewport: { width: 1280, height: 800 } });

    test('the workout builder’s block chart', async ({ page }) => {
      await page.goto('/reflow.html?data=populated&builder=blocks');
      await page.waitForFunction(() => window.__oylReflow?.ready === true);
      // The harness's own walk to Workouts, which adds the blocks once the builder is on the page.
      await page.evaluate(async () => window.__oylReflow?.visit('#/workouts'));
      expect(await page.evaluate(() => document.documentElement.dataset['theme'])).toBe(theme);
      // The builder's chart, in the detail pane: the list's cards draw one too.
      const seen = await zonesIn(
        page,
        '[data-oyl-pane="detail"] svg.oyl-block-chart',
        '[data-oyl-pane="detail"]',
      );
      console.log(`#2039 ${theme} block chart: ${JSON.stringify(seen)}`);
      // One block of each kind paints several zones; a walk over one proves little.
      expect(new Set(seen.bands.map((band) => band.zone)).size).toBeGreaterThanOrEqual(3);
      expect(zoneFaults(theme, seen)).toEqual([]);
    });

    // The owner's ruling of 2026-11-04 on #2125: a saved workout's card is
    // drawn in the zone colours, and the list names them once over its cards.
    test('a saved workout’s card on Workouts', async ({ page }) => {
      await page.goto('/reflow.html?data=populated');
      await page.waitForFunction(() => window.__oylReflow?.ready === true);
      await page.evaluate(async () => window.__oylReflow?.visit('#/workouts'));
      expect(await page.evaluate(() => document.documentElement.dataset['theme'])).toBe(theme);
      // The rider's own list: the built-ins after it (#2304) draw cards too.
      const seen = await zonesIn(
        page,
        '[data-oyl-list="saved"] .oyl-shape-card svg.oyl-block-chart',
        '[data-oyl-list="saved"]',
      );
      console.log(`#2125 ${theme} saved workout card: ${JSON.stringify(seen)}`);
      // The populated workout is 60 % and 90 % of threshold: zones 2 and 3.
      expect(seen.bands.map((band) => band.zone).sort()).toEqual([2, 3]);
      expect(zoneFaults(theme, seen)).toEqual([]);
    });

    // #2304: a built-in's card is drawn as a saved one is, and its list names
    // the zones its cards paint once, in its own key.
    test('a built-in workout’s card on Workouts', async ({ page }) => {
      await page.goto('/reflow.html?data=populated');
      await page.waitForFunction(() => window.__oylReflow?.ready === true);
      await page.evaluate(async () => window.__oylReflow?.visit('#/workouts?list=built-in'));
      expect(await page.evaluate(() => document.documentElement.dataset['theme'])).toBe(theme);
      const seen = await zonesIn(
        page,
        '[data-oyl-built-in="threshold-2x20"] svg.oyl-block-chart',
        '[data-oyl-built-ins]',
      );
      console.log(`#2304 ${theme} built-in card: ${JSON.stringify(seen)}`);
      // A warm-up from 45 % to 70 %, openers at 105 %, efforts at 95 % and
      // easy riding at 55 %: zones 1, 2 and 4.
      expect([...new Set(seen.bands.map((band) => band.zone))].sort()).toEqual([1, 2, 4]);
      expect(zoneFaults(theme, seen)).toEqual([]);
    });

    test('the Ride screen’s running-workout graph', async ({ page }) => {
      await page.goto('/rideview.html?workout=stepped');
      await page.waitForFunction(() => window.__oylRideView?.ready === true);
      const seen = await zonesIn(
        page,
        '[data-oyl-lane="plan"] svg',
        '[data-oyl-workout-graph="panel"]',
      );
      console.log(`#2039 ${theme} workout graph: ${JSON.stringify(seen)}`);
      expect(seen.bands.length).toBeGreaterThan(0);
      expect(zoneFaults(theme, seen)).toEqual([]);
    });
  });
}
