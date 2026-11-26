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

import { expect, test, type Page } from '@playwright/test';

import {
  HUD_SURFACE,
  OVERLAY_VIEWPORTS,
  STACKED_VIEWPORTS,
  TABLET_VIEWPORTS,
  bothWays,
  inside,
  layoutFaults,
  measure,
  named,
  openRide,
  overlap,
  rideTotalsDrawn,
  riderBox,
  roomGivesWay,
  sharedRide,
  type Viewport,
} from './ride-stage';
import type { StageMeasurement } from './ride-harness';
import { applyInsets, PIXEL_TABLET_PORTRAIT_INSETS_ASSUMED, resolvedInsets } from './insets';
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
const ALWAYS_DRAWN = ['reading: Power (3 s)', 'control: Pause', 'control: End ride'];

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
          // The owner's ruling of 2026-11-06 (#2034): in a room at these
          // sizes the pacer, the ghost and the wind give way wherever
          // `roomGivesWay(viewport, true)` says — on every tablet and phone.
          if (query.includes('room=')) {
            for (const name of ['reading: Pacer', 'reading: Your best', 'reading: Wind']) {
              const reading = seen.items.find((each) => each.name === name);
              expect(reading, `${how}: ${name}`).toBeDefined();
              const hidden = (reading?.box.width ?? 0) * (reading?.box.height ?? 0) <= 1;
              expect(hidden, `${how}: ${name}`).toBe(roomGivesWay(viewport, true));
            }
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
    // Four panels, three sizes, the two arrangements (#2383), the two route
    // panels (#2385), the totals strip (#2387), the two ways to show power
    // (#2420), the two Delivery layouts (#2514), the climb callout (#2593)
    // and the ride controls' auto-hide (#2600).
    expect(choices).toHaveLength(18);
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
      expect(names, how).toContain('reading: Power (3 s)');
      expect(names, how).toContain('control: Pause');
      // The secondary tier keeps only the ride's times.
      expect(seen.secondary, how).toEqual(['Moving', 'Elapsed', 'Clock']);
    }
  });
}

/**
 * #2383 — THE FOCUS READOUT, at every overlay viewport, in every mode, both
 * ways (#1120): the same invariants as every other arrangement (everything
 * on the stage, uncovered; no panel over another or over the leaning rider;
 * a large value visibly larger than a small one), and its own:
 *
 * - the readout holds the six readings #2383 names and the ride's time
 *   (#2382), in that order, and on this harness, which records, no dash;
 * - neither tier is drawn, and the readout is centred on the stage;
 * - and a ride with a mode of its own — a room, a lap race, a Delivery round
 *   — keeps the full arrangement (`HudCore.tsx` §`isModeReading`): measured
 *   with the readout in it, a panel was over the leaning rider on an upright
 *   phone and a race's standings over the controls on the 4:3 tablet.
 */
const FOCUS_LABELS = [
  // #2420: the 3 s average, the default every ride draws.
  'Power (3 s)',
  'Cadence',
  'Heart rate',
  'Speed',
  'Avg power',
  'Distance',
  'Elapsed',
];

/** Whether a ride the harness is asked for has a mode of its own. */
function hasOwnMode(query: string): boolean {
  return query.includes('room=') || query.includes('delivery=');
}

for (const [mode, query] of MODES.filter(([, each]) => !hasOwnMode(each))) {
  for (const viewport of OVERLAY_VIEWPORTS) {
    test(`#2383 the focus readout holds its layout — ${mode} — ${viewport.name}`, async ({
      browser,
    }) => {
      const page = await sharedRide(
        browser,
        viewport,
        `${query === '' ? '?' : `${query}&`}arrangement=focus`,
      );
      const tablet = TABLET_VIEWPORTS.includes(viewport);
      for (const [how, seen] of await bothWays(page)) {
        const { faults, clipped } = sizeFaults(seen, viewport);
        console.log(`#2383 ${mode} ${viewport.name} ${how}: clipped ${clipped.join(', ')}`);
        expect(faults, how).toEqual([]);
        expect(seen.focus, how).toEqual(FOCUS_LABELS);
        for (const label of FOCUS_LABELS) {
          expect(clipped, how).not.toContain(`reading: ${label}`);
        }
        expect(
          seen.focusValues.filter((value) => value.startsWith('—')),
          how,
        ).toEqual([]);
        expect(seen.primary, how).toEqual([]);
        expect(seen.secondary, how).toEqual([]);
        for (const name of ALWAYS_DRAWN) expect(clipped, how).not.toContain(name);
        expect(seen.primaryValuePixels, how).toBe(
          tablet ? TABLET_NORMAL_PRIMARY_PIXELS : PHONE_PRIMARY_PIXELS,
        );
        const focus = seen.panels.find((each) => each.name.includes('oyl-hud__focus'));
        expect(focus, how).toBeDefined();
        if (focus !== undefined) {
          const centre = (focus.box.left + focus.box.right) / 2;
          expect(Math.abs(centre - viewport.width / 2), how).toBeLessThanOrEqual(1);
        }
      }
    });
  }
}

for (const [mode, query] of MODES.filter(([, each]) => hasOwnMode(each))) {
  test(`#2383 ${mode} keeps the full arrangement with focus chosen`, async ({ browser }) => {
    const viewport = OVERLAY_VIEWPORTS.find((each) => each.width === 360 && each.height === 800);
    if (viewport === undefined) throw new Error('no 360×800 viewport');
    const page = await sharedRide(browser, viewport, `${query}&arrangement=focus`);
    const seen = await measure(page);
    expect(sizeFaults(seen, viewport).faults).toEqual([]);
    expect(seen.focus).toEqual([]);
    expect(seen.primary).toContain('Power (3 s)');
  });
}

/**
 * #2387 — THE TOTALS STRIP, at every overlay viewport, on a plain ride and in
 * a workout, in both arrangements, both ways (#1120): the same invariants as
 * every other arrangement (everything on the stage, uncovered; no panel over
 * another or over the leaning rider), and its own:
 *
 * - drawn along the bottom between the route panel and the actions panel
 *   where `theme.css` §"THE TOTALS STRIP" has the room — the two landscape
 *   tablets — and, on a tablet held upright (the owner's ruling of
 *   2026-11-09), on the actions panel in its column, beside the route panel;
 *   and given way everywhere else on the stage — the phones — said so;
 * - its five readings (six on a loop) in order, and on this harness, which
 *   records, the port's figures: `RIDE_TOTALS`' energy and climb, and its
 *   distance over the moving time as the average speed — so the strip is
 *   read through `GameView`, not built beside it;
 * - and the focus readout and the full tiers what they are without it.
 */
const STRIP_LABELS = ['Route', 'To go', 'Avg speed', 'Energy', 'Climbed'];

/** `RIDE_TOTALS` and `MOVING_SECONDS` in `ride-harness.tsx`, as the strip shows them. */
const STRIP_FIGURES = { 'Avg speed': '20.0 km/h', Energy: '15300 kJ', Climbed: '4850 m' };

/**
 * Where the stage has room for the strip: the two landscape tablets, and the
 * owner's tablet upright (`theme.css` §"THE TOTALS STRIP ON A TABLET HELD
 * UPRIGHT": under 51 rem wide and 68 rem tall or more). Not a phone, either
 * way.
 */
const STRIP_DRAWN = new Set(
  OVERLAY_VIEWPORTS.filter(
    (each) =>
      (each.width >= 960 && each.height >= 640) ||
      (each.width >= 736 && each.width < 816 && each.height >= 1088),
  ).map((each) => each.name),
);

/** The upright tablets the strip is drawn on, which place it on the actions panel. */
const STRIP_UPRIGHT = new Set(
  OVERLAY_VIEWPORTS.filter((each) => STRIP_DRAWN.has(each.name) && each.height > each.width).map(
    (each) => each.name,
  ),
);

/**
 * Where the strip is on the stage, beside the panels it is placed by:
 * landscape, along the bottom between the route panel and the actions panel;
 * upright, on the actions panel and in its column, beside the route panel.
 */
function stripPlaceFaults(seen: StageMeasurement, viewport: Viewport): string[] {
  const strip = stripPanel(seen);
  if (strip === undefined) return ['no strip'];
  const route = seen.panels.find((each) => each.name.includes('oyl-hud__route'));
  const actions = seen.panels.find((each) => each.name.includes('oyl-hud__actions'));
  if (actions === undefined) return ['no actions panel'];
  const faults: string[] = [];
  if (route !== undefined && route.box.width > 1 && strip.box.left <= route.box.right) {
    faults.push(
      `strip ${String(strip.box.left)} not right of the route panel ${String(route.box.right)}`,
    );
  }
  if (STRIP_UPRIGHT.has(viewport.name)) {
    // On the actions panel, in the bottom row beside the route panel, and no
    // wider than the actions panel's column. With the route turned off what is
    // left of its panel is 82 px tall and the strip stands above it.
    if (strip.box.bottom > actions.box.top) faults.push('strip not above the actions panel');
    if (route !== undefined && route.box.width > 1 && route.box.height > 100) {
      if (strip.box.top < route.box.top) faults.push('strip above the route panel’s top');
    }
    if (strip.box.right > actions.box.right + 1) faults.push('strip past the actions panel');
    // #2418: its left edge is the actions panel's, not its column's.
    if (Math.abs(strip.box.left - actions.box.left) > 1) {
      faults.push(
        `strip's left edge ${String(Math.round(strip.box.left))} not the actions panel's ${String(Math.round(actions.box.left))}`,
      );
    }
  } else {
    if (viewport.height - strip.box.bottom > 16) faults.push('strip not along the bottom');
    if (strip.box.right >= actions.box.left) faults.push('strip not left of the actions panel');
  }
  return faults;
}

/** The strip's panel, where it is drawn. */
function stripPanel(seen: StageMeasurement): StageMeasurement['panels'][number] | undefined {
  return seen.panels.find((each) => each.name.includes('oyl-hud__totals'));
}

/**
 * Each of the strip's cells holds its own words, and no two cells overlap —
 * PR #2413's review. `layoutFaults` holds each panel and each item against the
 * stage, not a value against its own cell: a value with `white-space: nowrap`
 * in a cell narrower than it prints over the next one and no fault says so.
 * So the words' own box (a `Range` over the cell) against the cell's, here.
 * None where no strip is drawn.
 */
async function stripCellFaults(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const strip = document.querySelector('.oyl-hud__totals');
    if (strip === null || window.getComputedStyle(strip).display === 'none') return [];
    const cells = [...strip.children].map((cell) => {
      const range = document.createRange();
      range.selectNodeContents(cell);
      return {
        name: cell.querySelector('dt')?.textContent ?? '?',
        cell: cell.getBoundingClientRect(),
        words: range.getBoundingClientRect(),
      };
    });
    const faults: string[] = [];
    for (const { name, cell, words } of cells) {
      if (words.left < cell.left - 1 || words.right > cell.right + 1) {
        faults.push(
          `${name}: words ${String(Math.round(words.width))} px in a cell ${String(Math.round(cell.width))} px wide`,
        );
      }
    }
    cells.forEach((a, index) => {
      for (const b of cells.slice(index + 1)) {
        const across = Math.min(a.cell.right, b.cell.right) - Math.max(a.cell.left, b.cell.left);
        const down = Math.min(a.cell.bottom, b.cell.bottom) - Math.max(a.cell.top, b.cell.top);
        if (across > 1 && down > 1) faults.push(`${a.name} overlaps ${b.name}`);
      }
    });
    return faults;
  });
}

/** The least space between a value and the label under it, upright — #2418. */
const STRIP_ROW_GAP_PIXELS = 12;

/**
 * #2418, upright, where the strip is two rows in the actions panel's column:
 * no empty cell — each row's cells reach from the strip's first column to its
 * last, so a route ride's five (no Lap) leave no hole after *Climbed* — and a
 * value at least {@link STRIP_ROW_GAP_PIXELS} above the label under it. By
 * each `dt` and `dd`'s own box, as the rider reads them.
 */
async function stripUprightFaults(page: Page): Promise<string[]> {
  return page.evaluate((gap) => {
    const strip = document.querySelector('.oyl-hud__totals');
    if (strip === null || window.getComputedStyle(strip).display === 'none') return ['no strip'];
    const cells = [...strip.children].map((cell) => ({
      name: cell.querySelector('dt')?.textContent ?? '?',
      box: cell.getBoundingClientRect(),
      label: cell.querySelector('dt')?.getBoundingClientRect(),
      value: cell.querySelector('dd')?.getBoundingClientRect(),
    }));
    const rows = new Map<number, typeof cells>();
    for (const cell of cells) {
      const top = Math.round(cell.box.top);
      rows.set(top, [...(rows.get(top) ?? []), cell]);
    }
    const left = Math.min(...cells.map((each) => each.box.left));
    const right = Math.max(...cells.map((each) => each.box.right));
    const faults: string[] = [];
    if (rows.size < 2) faults.push(`${String(rows.size)} row`);
    const ordered = [...rows.entries()].sort(([a], [b]) => a - b).map(([, row]) => row);
    ordered.forEach((row, index) => {
      const first = Math.min(...row.map((each) => each.box.left));
      const last = Math.max(...row.map((each) => each.box.right));
      if (first > left + 1 || last < right - 1) {
        faults.push(
          `row ${String(index + 1)} (${row.map((each) => each.name).join(', ')}) leaves an empty cell: ${String(Math.round(first))}–${String(Math.round(last))} of ${String(Math.round(left))}–${String(Math.round(right))}`,
        );
      }
      const next = ordered[index + 1];
      if (next === undefined) return;
      const valueBottom = Math.max(...row.map((each) => each.value?.bottom ?? 0));
      const labelTop = Math.min(...next.map((each) => each.label?.top ?? Infinity));
      if (labelTop - valueBottom < gap) {
        faults.push(
          `row ${String(index + 2)}'s labels ${String(Math.round(labelTop - valueBottom))} px under row ${String(index + 1)}'s values`,
        );
      }
    });
    return faults;
  }, STRIP_ROW_GAP_PIXELS);
}

/**
 * The route and actions panels' boxes, to compare a ride with the strip and
 * one without. Rounded, and compared within a pixel either way by
 * {@link panelsMoved} (#2418): a sub-pixel difference in rounding is not a
 * panel moving.
 */
function bottomPanels(seen: StageMeasurement): Record<string, readonly number[]> {
  const boxes: Record<string, readonly number[]> = {};
  for (const name of ['oyl-hud__route', 'oyl-hud__actions']) {
    const panel = seen.panels.find((each) => each.name.includes(name));
    if (panel !== undefined) {
      const { box } = panel;
      boxes[name] = [box.left, box.top, box.right, box.bottom].map(Math.round);
    }
  }
  return boxes;
}

/** Each bottom panel's edge that is more than a pixel from where it is in `plain`. */
function panelsMoved(seen: StageMeasurement, plain: StageMeasurement): string[] {
  const now = bottomPanels(seen);
  const before = bottomPanels(plain);
  const faults: string[] = [];
  for (const [name, box] of Object.entries(before)) {
    const moved = now[name];
    if (moved === undefined) {
      faults.push(`${name} gone`);
      continue;
    }
    box.forEach((edge, index) => {
      const there = moved[index] ?? Number.NaN;
      if (!(Math.abs(there - edge) <= 1)) {
        faults.push(
          `${name} ${['left', 'top', 'right', 'bottom'][index] ?? '?'} ${String(edge)} → ${String(there)}`,
        );
      }
    });
  }
  return faults;
}

for (const arrangement of ['full', 'focus'] as const) {
  for (const [mode, query] of MODES.filter(([, each]) => !hasOwnMode(each))) {
    for (const viewport of OVERLAY_VIEWPORTS) {
      test(`#2387 the totals strip holds its layout — ${arrangement} — ${mode} — ${viewport.name}`, async ({
        browser,
      }) => {
        const page = await sharedRide(
          browser,
          viewport,
          `${query === '' ? '?' : `${query}&`}totals=strip&arrangement=${arrangement}`,
        );
        const drawn = STRIP_DRAWN.has(viewport.name);
        for (const [how, seen] of await bothWays(page)) {
          const { faults, clipped } = sizeFaults(seen, viewport);
          console.log(
            `#2387 ${arrangement} ${mode} ${viewport.name} ${how}: given way ${seen.givenWay.join(', ')}; clipped ${clipped.join(', ')}`,
          );
          expect(faults, how).toEqual([]);
          expect(seen.totals, how).toEqual(STRIP_LABELS);
          for (const name of ALWAYS_DRAWN) expect(clipped, how).not.toContain(name);
          // Neither arrangement is changed by it.
          if (arrangement === 'focus') {
            expect(seen.focus, how).toEqual(FOCUS_LABELS);
            expect(seen.primary, how).toEqual([]);
          } else {
            expect(seen.focus, how).toEqual([]);
            expect(seen.primary, how).toContain('Power (3 s)');
          }
          const strip = stripPanel(seen);
          if (!drawn) {
            expect(strip, how).toBeUndefined();
            expect(seen.givenWay, how).toContain('the totals strip');
            continue;
          }
          expect(seen.givenWay, how).not.toContain('the totals strip');
          expect(strip, how).toBeDefined();
          if (strip === undefined) continue;
          expect(stripPlaceFaults(seen, viewport), how).toEqual([]);
          // Each cell holds its words wherever the strip is drawn, not only
          // upright: at 1280×800 #2387's one row had no per-cell check.
          expect(await stripCellFaults(page), how).toEqual([]);
          if (STRIP_UPRIGHT.has(viewport.name)) {
            expect(await stripUprightFaults(page), how).toEqual([]);
          }
          // Every reading on it on the stage and uncovered (`layoutFaults`
          // holds each item), with the port's figures.
          const names = seen.items.map((each) => each.name);
          for (const label of STRIP_LABELS) expect(names, how).toContain(`totals: ${label}`);
          for (const [label, figure] of Object.entries(STRIP_FIGURES)) {
            expect(seen.totalsValues[STRIP_LABELS.indexOf(label)], `${how}: ${label}`).toBe(figure);
          }
        }
      });
    }
  }
}

for (const viewport of OVERLAY_VIEWPORTS.filter((each) => STRIP_DRAWN.has(each.name))) {
  test(`#2387 the totals strip on a loop names the lap, first — ${viewport.name}`, async ({
    browser,
  }) => {
    const page = await sharedRide(browser, viewport, '?lap=riding&totals=strip');
    for (const [how, seen] of await bothWays(page)) {
      expect(sizeFaults(seen, viewport).faults, how).toEqual([]);
      expect(seen.totals, how).toEqual(['Lap', ...STRIP_LABELS]);
      expect(seen.totalsValues[0], how).toBe('1');
      expect(stripPanel(seen), how).toBeDefined();
      expect(await stripCellFaults(page), how).toEqual([]);
      if (STRIP_UPRIGHT.has(viewport.name)) {
        expect(stripPlaceFaults(seen, viewport), how).toEqual([]);
        expect(await stripUprightFaults(page), how).toEqual([]);
      }
    }
  });

  test(`#2387 the totals strip keeps its own size at extra-large text — ${viewport.name}`, async ({
    browser,
  }) => {
    const page = await sharedRide(browser, viewport, '?text=extra-large&totals=strip');
    for (const [how, seen] of await bothWays(page)) {
      expect(sizeFaults(seen, viewport).faults, how).toEqual([]);
      expect(stripPanel(seen), how).toBeDefined();
      expect(seen.primaryValuePixels, how).toBe(PRIMARY_PIXELS['extra-large']);
    }
  });
}

/**
 * The owner's ruling of 2026-11-09: the strip on the owner's tablet held
 * upright, 800×1280. Beyond the cases above: with the route panel turned off,
 * where the actions panel's two rows are no longer held open by the route
 * panel and the strip must still sit on the actions panel, not over it; and
 * with the Pixel Tablet's insets, which lift every bottom panel towards the
 * rider (`insets.ts` §`PIXEL_TABLET_PORTRAIT_INSETS_ASSUMED`).
 */
const UPRIGHT_TABLET = OVERLAY_VIEWPORTS.find((each) => each.width === 800 && each.height === 1280);

test('#2387 upright, the totals strip sits on the actions panel with the route panel off', async ({
  browser,
}) => {
  if (UPRIGHT_TABLET === undefined) throw new Error('no 800×1280 viewport');
  const page = await sharedRide(browser, UPRIGHT_TABLET, '?totals=strip&hide=route');
  for (const [how, seen] of await bothWays(page)) {
    expect(sizeFaults(seen, UPRIGHT_TABLET).faults, how).toEqual([]);
    expect(stripPlaceFaults(seen, UPRIGHT_TABLET), how).toEqual([]);
  }
});

test('#2387 upright, the totals strip clears the rider with the tablet’s insets', async ({
  page,
}) => {
  if (UPRIGHT_TABLET === undefined) throw new Error('no 800×1280 viewport');
  // Its own page (ride-stage.ts §`sharedRide`): the insets are the engine's,
  // told before anything is laid out, so `env()` itself reports them.
  await applyInsets(page, PIXEL_TABLET_PORTRAIT_INSETS_ASSUMED);
  await openRide(page, UPRIGHT_TABLET, '?totals=strip');
  expect(await resolvedInsets(page)).toEqual(PIXEL_TABLET_PORTRAIT_INSETS_ASSUMED);
  const seen = await measure(page);
  const actions = seen.panels.find((each) => each.name.includes('oyl-hud__actions'));
  // The insets are in force: the actions panel is lifted off the bottom.
  expect(
    UPRIGHT_TABLET.height - (actions?.box.bottom ?? UPRIGHT_TABLET.height),
  ).toBeGreaterThanOrEqual(PIXEL_TABLET_PORTRAIT_INSETS_ASSUMED.bottom);
  expect(sizeFaults(seen, UPRIGHT_TABLET).faults).toEqual([]);
  expect(stripPlaceFaults(seen, UPRIGHT_TABLET)).toEqual([]);
  expect(await stripCellFaults(page)).toEqual([]);
  expect(await stripUprightFaults(page)).toEqual([]);
});

/**
 * At every text size upright the strip is drawn, each value in its own cell,
 * and no panel moves for it: the route and actions panels have the boxes they
 * have with no strip (the theme's §"THE TOTALS STRIP ON A TABLET HELD
 * UPRIGHT" says so, and PR #2413's review asked that it be held).
 */
for (const size of ['normal', 'large', 'extra-large'] as const) {
  for (const [mode, query] of [
    ['a plain ride', ''],
    ['a workout', 'trainer=workout&'],
  ] as const) {
    test(`#2387 upright at ${size} text, the totals strip fits and no panel moves — ${mode}`, async ({
      browser,
    }) => {
      if (UPRIGHT_TABLET === undefined) throw new Error('no 800×1280 viewport');
      const text = size === 'normal' ? '' : `text=${size}&`;
      const plain = await measure(await sharedRide(browser, UPRIGHT_TABLET, `?${query}${text}`));
      const page = await sharedRide(browser, UPRIGHT_TABLET, `?${query}${text}totals=strip`);
      const seen = await measure(page);
      expect(stripPanel(seen)).toBeDefined();
      expect(sizeFaults(seen, UPRIGHT_TABLET).faults).toEqual([]);
      expect(stripPlaceFaults(seen, UPRIGHT_TABLET)).toEqual([]);
      expect(await stripCellFaults(page)).toEqual([]);
      expect(await stripUprightFaults(page)).toEqual([]);
      expect(panelsMoved(seen, plain)).toEqual([]);
      expect(Object.keys(bottomPanels(seen))).toEqual(['oyl-hud__route', 'oyl-hud__actions']);
    });
  }
}

/**
 * And a tablet upright 51 to 60 rem wide — PR #2413's review: there the larger
 * text sizes' actions column is 132 to 212 px, and a strip in it had 27 to
 * 54 px cells, every value printed over the next. It keeps the strip hidden;
 * and whatever a later rule draws there, each value is held to its own cell.
 */
for (const size of ['large', 'extra-large'] as const) {
  test(`#2387 a wider upright tablet, 820×1180, at ${size} text: no strip over its own cells`, async ({
    browser,
  }) => {
    const viewport: Viewport = {
      name: 'a wider tablet upright — 820×1180',
      width: 820,
      height: 1180,
      unstagedFails: false,
    };
    const page = await sharedRide(browser, viewport, `?text=${size}&totals=strip`);
    expect(await stripCellFaults(page)).toEqual([]);
    const seen = await measure(page);
    expect(stripPanel(seen)).toBeUndefined();
    expect(seen.givenWay).toContain('the totals strip');
  });
}

/**
 * And the edge of the rule: a tablet upright under 68 rem tall keeps it
 * hidden. At 768×1024 the strip measured 13 px under the leaning rider with
 * no insets, which a gesture bar's inset takes.
 */
test('#2387 a shorter upright tablet, 768×1024, gives the totals strip way', async ({
  browser,
}) => {
  const viewport: Viewport = {
    name: 'a shorter tablet upright — 768×1024',
    width: 768,
    height: 1024,
    unstagedFails: false,
  };
  // Not a viewport the HUD's layout is held at (its route panel meets the
  // leaning rider with no strip at all), so only the strip is held here.
  const seen = await measure(await sharedRide(browser, viewport, '?totals=strip'));
  expect(stripPanel(seen)).toBeUndefined();
  expect(seen.givenWay).toContain('the totals strip');
});

for (const [mode, query] of MODES.filter(([, each]) => hasOwnMode(each))) {
  test(`#2387 ${mode} draws no totals strip with the strip chosen`, async ({ browser }) => {
    const viewport = OVERLAY_VIEWPORTS[0];
    if (viewport === undefined) throw new Error('no overlay viewport');
    const page = await sharedRide(browser, viewport, `${query}&totals=strip`);
    const seen = await measure(page);
    expect(sizeFaults(seen, viewport).faults).toEqual([]);
    expect(seen.totals).toEqual([]);
    expect(stripPanel(seen)).toBeUndefined();
  });
}

test('#2387 the control — without the choice there is no totals strip', async ({ browser }) => {
  const viewport = OVERLAY_VIEWPORTS[0];
  if (viewport === undefined) throw new Error('no overlay viewport');
  const seen = await measure(await sharedRide(browser, viewport));
  expect(seen.totals).toEqual([]);
  expect(stripPanel(seen)).toBeUndefined();
});

for (const viewport of STACKED_VIEWPORTS.filter((each) => each.height > 300)) {
  test(`#2387 where the HUD is stacked the totals strip is in the flow — ${viewport.name}`, async ({
    browser,
  }) => {
    const seen = await measure(await sharedRide(browser, viewport, '?totals=strip'));
    const strip = stripPanel(seen);
    expect(seen.totals).toEqual(STRIP_LABELS);
    expect((strip?.box.width ?? 0) * (strip?.box.height ?? 0)).toBeGreaterThan(1);
    for (const other of seen.panels.filter((each) => each !== strip)) {
      expect(
        strip !== undefined && overlap(strip.box, other.box),
        `the strip over ${other.name}`,
      ).toBe(false);
    }
  });
}

/**
 * #2434, the owner's ruling of 2026-11-10: *Calories* on the HUD every ride
 * shows, with no setting changed — in the always-shown "ride so far" tier,
 * after *Avg power*, and NOT in the totals strip (`theme.css` §"THE CALORIE
 * ESTIMATE IN THE RIDE SO FAR"):
 * - where the ride so far is drawn (every tablet), on the stage, uncovered
 *   and inside the secondary panel, with the harness's widest figure and its
 *   basis, `≈ 9999 kcal estimate from power`, its unit on its number's line;
 * - where the ride so far gives way (a phone's overlay), given way with it,
 *   and still in the list a screen reader reads, in #94's order;
 * - and with no estimate, the dash and the card's reason in the same place,
 *   so the reading does not move when an estimate appears.
 */
for (const viewport of OVERLAY_VIEWPORTS) {
  test(`#2434 Calories is in the ride so far on the default HUD — ${viewport.name}`, async ({
    browser,
  }) => {
    const page = await sharedRide(browser, viewport);
    const cell = async (at: Page) =>
      at.evaluate(() => {
        const field = document.querySelector('.oyl-hud__field--calories');
        const value = field?.querySelector('dd');
        const unit = value?.querySelector('.oyl-hud__unit');
        const digits = document.createRange();
        if (value?.firstChild) digits.setStartBefore(value.firstChild);
        if (unit) digits.setEndBefore(unit);
        const number = digits.getBoundingClientRect();
        const unitBox = unit?.getClientRects()[0];
        const box = field?.getBoundingClientRect();
        return {
          text: (value?.textContent ?? '').replace(/\s+/g, ' ').trim(),
          inSecondary: field?.closest('.oyl-hud__fields--secondary') !== null,
          box: box === undefined ? undefined : [box.left, box.top].map(Math.round),
          width: Math.round(box?.width ?? 0),
          // Every secondary reading's left edge, so a track that changed
          // width with the estimate shows as a reading that moved.
          lefts: [
            ...document.querySelectorAll('.oyl-hud__fields--secondary > .oyl-hud__field'),
          ].map((each) => Math.round(each.getBoundingClientRect().left)),
          unitBeside:
            unitBox !== undefined &&
            unitBox.top >= number.top - 1 &&
            unitBox.bottom <= number.bottom + 1,
        };
      });
    for (const [how, seen] of await bothWays(page)) {
      const at = seen.secondary.indexOf('Avg power');
      expect(seen.secondary.slice(at, at + 2), how).toEqual(['Avg power', 'Calories']);
      expect(seen.totals, how).toEqual([]);
      if (rideTotalsDrawn(viewport)) {
        const reading = named(seen.items, 'reading: Calories');
        expect(inside(reading.box, viewport) && reading.onTop, how).toBe(true);
        expect(layoutFaults(seen, viewport), how).toEqual([]);
      } else {
        expect(seen.givenWay, how).toContain('reading: Calories');
      }
    }
    const estimated = await cell(page);
    expect(estimated.text).toBe('≈ 9999 kcal estimate from power');
    expect(estimated.inSecondary).toBe(true);
    if (rideTotalsDrawn(viewport)) expect(estimated.unitBeside).toBe(true);

    const none = await sharedRide(browser, viewport, '?calories=none');
    const dashed = await cell(none);
    expect(dashed.text).toBe('— kcal set your details in Settings');
    expect(dashed.text).not.toMatch(/\b0 kcal/);
    if (rideTotalsDrawn(viewport)) {
      // In the same track: its left edge and width — on the CI runner's
      // fonts the moving time's track grew 8 px with the figure until the
      // figure was given its widest width (`theme.css` §"THE CALORIE
      // ESTIMATE IN THE RIDE SO FAR"). Its top follows the rows above it,
      // whose own dashes are a few px shorter there than their figures.
      expect(dashed.box?.[0]).toBe(estimated.box?.[0]);
      expect(dashed.width).toBe(estimated.width);
      // And no reading beside it moved as the estimate appeared (#94).
      expect(dashed.lefts).toEqual(estimated.lefts);
      for (const [how, seen] of await bothWays(none)) {
        expect(layoutFaults(seen, viewport), how).toEqual([]);
      }
    }
  });
}

/**
 * #2593 — the climb callout on the stage, and the road ahead's title.
 *
 * The callout stands in the HUD's notice cell (`ClimbCallout.tsx`), and the
 * issue's constraint is that it covers neither the rider nor the road ahead:
 * #2513's lesson, a house marker hidden behind the HUD. `?climb=ahead` puts
 * an 800 m climb at 6 % 300 m up the road, so the callout says how far it is;
 * `?climb=on` starts the ride on it, so it counts down to the top. Each is
 * held to the layout's own invariants at every overlay viewport, both ways
 * (#1120) — every panel whole, none over another, none over the leaning
 * rider — with the callout among them, drawn and uncovered on a tablet; and
 * at the tablets' large text sizes, where the 4:3 tablet's middle row is
 * shortest. On a phone the notice cell is the route panel's, and the callout
 * does not take it (`theme.css` §"#2593"): there it must be clipped to a
 * pixel, its panel too and not only its cell, and the strip, the road ahead
 * and the plan drawn and uncovered for the whole climb.
 * Each on a plain ride and on a mapped one (`?corridor=archive`), whose map
 * credit hangs at the foot of the same notice row on a tablet: as a panel of
 * the stage it is held clear of the callout by the same invariants. The
 * control lays the same notice cell across the middle of the road, where a
 * callout centred over the road would stand, and the same measure must find
 * it over the rider.
 *
 * A Delivery round draws no callout (`climb-callout.test.tsx`), so its
 * throws' roadsides are as `ride-delivery.browser.spec.ts` holds them.
 */
const CLIMB_RIDES = [
  ['a plain ride', ''],
  ['a mapped ride', 'corridor=archive&'],
] as const;

const CLIMB_PHASES = [
  ['ahead', 'climb=ahead', /^Climb in \d+0 m · 6 % avg · 0\.8 km$/],
  ['on', 'climb=on', /^Top in \d+0 m · 6 %$/],
] as const;

const CALLOUT = 'the climb callout';

async function calloutText(page: Page): Promise<string | undefined> {
  return page.evaluate(
    () => document.querySelector('.oyl-hud__climb-callout-text')?.textContent ?? undefined,
  );
}

/** The layouts whose notice cell is the route panel's: a phone's, where the callout gives way. */
const ROUTE_CELL = new Set(
  OVERLAY_VIEWPORTS.filter((each) => !TABLET_VIEWPORTS.includes(each)).map((each) => each.name),
);

/** What the route panel draws, which a phone keeps for every climb. */
const ROUTE_PANEL = ['the elevation strip', 'the road ahead', 'the plan view'];

/**
 * On a tablet, the callout drawn, whole and uncovered, off the rider; on a
 * phone, the callout clipped to a pixel and the route panel drawn and
 * uncovered in its cell; and the layout's own faults.
 */
function calloutFaults(seen: StageMeasurement, viewport: Viewport): string[] {
  const { faults, clipped } = sizeFaults(seen, viewport);
  const callout = named(seen.items, CALLOUT);
  if (ROUTE_CELL.has(viewport.name)) {
    if (!clipped.includes(CALLOUT)) faults.push(`drawn on a phone: ${CALLOUT}`);
    for (const name of ROUTE_PANEL) {
      const each = named(seen.items, name);
      if (!inside(each.box, viewport) || !each.onTop) faults.push(`lost: ${name}`);
    }
    return faults;
  }
  if (!inside(callout.box, viewport) || !callout.onTop) faults.push(`lost: ${CALLOUT}`);
  if (overlap(callout.box, riderBox(viewport))) faults.push(`${CALLOUT} over the rider`);
  return faults;
}

for (const [ride, mapped] of CLIMB_RIDES) {
  for (const [phase, query, said] of CLIMB_PHASES) {
    for (const viewport of OVERLAY_VIEWPORTS) {
      test(`#2593 the climb callout holds the layout — ${phase} — ${ride} — ${viewport.name}`, async ({
        browser,
      }) => {
        const page = await sharedRide(browser, viewport, `?${mapped}${query}`);
        expect(await calloutText(page)).toMatch(said);
        for (const [how, seen] of await bothWays(page)) {
          const callout = named(seen.items, CALLOUT);
          console.log(
            `#2593 ${phase} ${viewport.name} ${how}: ${CALLOUT} ${callout.box.width.toFixed(0)}×${callout.box.height.toFixed(0)} at ${callout.box.left.toFixed(0)},${callout.box.top.toFixed(0)}`,
          );
          expect(calloutFaults(seen, viewport), how).toEqual([]);
          if (mapped !== '') expect(named(seen.items, 'the map credit').onTop, how).toBe(true);
        }
      });
    }
  }
}

for (const [ride, mapped] of CLIMB_RIDES) {
  for (const size of ['large', 'extra-large'] as const) {
    for (const viewport of TABLET_VIEWPORTS) {
      test(`#2593 the climb callout at ${size} text holds the layout — ${ride} — ${viewport.name}`, async ({
        browser,
      }) => {
        const page = await sharedRide(browser, viewport, `?${mapped}climb=on&text=${size}`);
        expect(await calloutText(page)).toMatch(/^Top in /);
        for (const [how, seen] of await bothWays(page)) {
          expect(calloutFaults(seen, viewport), how).toEqual([]);
          expect(seen.primaryValuePixels, how).toBe(PRIMARY_PIXELS[size]);
        }
      });
    }
  }
}

test('#2593 the control — the callout across the middle of the road is over the rider', async ({
  page,
}) => {
  const owners = OVERLAY_VIEWPORTS[0];
  if (owners === undefined) throw new Error('no 1280×800 viewport');
  await openRide(page, owners, '?climb=on');
  await page.addStyleTag({
    content:
      '.oyl-game--riding .oyl-hud__notices { justify-self: center !important; align-self: end !important; }',
  });
  const seen = await measure(page);
  const faults = calloutFaults(seen, owners);
  console.log(`#2593 control at ${owners.name}: ${JSON.stringify(faults)}`);
  expect(faults).toContain(`${CALLOUT} over the rider`);
});

test('#2593 the control — turned off in Settings, there is no callout on the climb', async ({
  browser,
}) => {
  const owners = OVERLAY_VIEWPORTS[0];
  if (owners === undefined) throw new Error('no 1280×800 viewport');
  const page = await sharedRide(browser, owners, '?climb=on&callout=off');
  expect(await calloutText(page)).toBeUndefined();
  // The strip's caption still names the climb.
  expect(
    await page.evaluate(
      () => document.querySelector('[data-testid="oyl-hud-next-climb"]')?.textContent,
    ),
  ).toMatch(/^Top in /);
});

for (const viewport of OVERLAY_VIEWPORTS) {
  test(`#2593 the road ahead's title is on the strip, on the panel's surface — ${viewport.name}`, async ({
    browser,
  }) => {
    const page = await sharedRide(browser, viewport);
    const found = await page.evaluate(() => {
      const title = document.querySelector('[data-testid="oyl-hud-ahead-title"]');
      const strip = document.querySelector('.oyl-hud__ahead-svg');
      if (title === null || strip === null) return undefined;
      const a = title.getBoundingClientRect();
      const b = strip.getBoundingClientRect();
      const style = window.getComputedStyle(title);
      return {
        text: title.textContent,
        within:
          a.width > 0 &&
          a.height > 0 &&
          a.left >= b.left - 1 &&
          a.right <= b.right + 1 &&
          a.top >= b.top - 1 &&
          a.bottom <= b.bottom + 1,
        // At the strip's far end: the rider is its near edge.
        atTheFarEnd: a.right >= b.right - 1 && a.top <= b.top + 1,
        background: style.backgroundColor,
        share: (a.width * a.height) / (b.width * b.height),
      };
    });
    console.log(`#2593 title ${viewport.name}: ${JSON.stringify(found)}`);
    expect(found?.text).toBe('Next 2 km');
    expect(found?.within).toBe(true);
    expect(found?.atTheFarEnd).toBe(true);
    expect(found?.background).toBe(HUD_SURFACE);
  });
}
