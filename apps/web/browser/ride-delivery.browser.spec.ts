// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A Delivery round's HUD in the real game stage, beside the leaning rider —
 * #1816, the check #1846's review of #1812 left for the first issue to run a
 * round inside a real game ride (its comment of 2026-10-28 on #1816).
 *
 * `ride-harness.tsx` §`?delivery=round` starts the widest ride the picker
 * starts (a pacer, a ghost and a wind) through the real `GameView` with a
 * round on, by the developer route and the Ride press, on day 7 with twelve
 * houses. `hud.browser.spec.ts` §"#1812" holds the round's two fields on the
 * HUD harness, which has no rider; this holds them, and the throw control
 * the actions panel carries on a Delivery ride, on the stage, at every overlay
 * viewport `ride-room.browser.spec.ts` §"#1356" uses, both ways (with anchor
 * positioning and without, #1120), at two stages of the round:
 *
 * - **its start**: *12 left*, day 7, the largest round there is;
 * - **nearly over**: *10 delivered, 2 missed*, reached by riding the round —
 *   two houses passed with no throw, then a throw toward the next house
 *   every quarter second of the ride's own clock (Playwright's, so the round
 *   takes seconds rather than minutes), which the assist's wider windows
 *   catch at every house after them.
 *
 * ## What is held
 *
 * At those viewports and stages: no HUD panel a rider can see is over the
 * leaning rider's box (`ride-stage.ts` §`riderBox`); every panel is whole,
 * on the stage and over no other panel; *Houses* and *Score* are laid out at
 * a size, uncovered, and over neither the actions panel nor *Pause* nor *End
 * ride*; the three throw buttons are whole and uncovered; and on a phone the
 * pacer's, the ghost's and the wind's readings give way (laid out at no size,
 * still in the list), as #1812's rule in `theme.css` §"A ROOM RIDE ON A
 * PHONE" makes them. The clearance between the secondary panel's bottom and
 * the rider's box top is printed at every phone viewport.
 *
 * ## The control
 *
 * The same ride with that give-way rule undone: the pacer, the ghost and the
 * wind back in the grid add a row to the secondary panel at every phone
 * viewport, and at the smallest corners layout, 736×360, that panel is then
 * over the rider. The case prints, for each phone viewport, how much taller
 * the panel is and what is over the rider, and holds 736×360 red.
 *
 * ## What it found, and `theme.css` §"A DELIVERY ROUND ON THE STAGE" fixed
 *
 * On its first run, with nothing changed but the ride: the actions panel,
 * carrying the throw row, ran 22 px below a 736×360 stage at the round's
 * start (44 px once the trainer line wrapped), and stood 12 px over the
 * rider at 360×800 and 360×752 without anchor positioning; and nearly over,
 * on both landscape tablets, *Houses* ran 9 px off the stage, its phrase
 * sizing the moving time's track.
 */

import { expect, test, type Page } from '@playwright/test';

import {
  OVERLAY_VIEWPORTS,
  TABLET_VIEWPORTS,
  bothWays,
  describeItem,
  inside,
  measure,
  named,
  openRide,
  overlap,
  riderBox,
  type Viewport,
} from './ride-stage';

import type { StageItem, StageMeasurement } from './ride-harness';

const DELIVERY_ROUND = '?delivery=round';

/** What a round adds to the secondary tier, and what gives way to it on a phone. */
const DELIVERY_READINGS = ['reading: Houses', 'reading: Score'] as const;
const GIVES_WAY = ['reading: Pacer', 'reading: Your best', 'reading: Wind'] as const;

/** The three throw buttons, `hud/ThrowControl.tsx` §`THROW_BUTTONS`. */
const THROWS = ['throw: Left', 'throw: Next house', 'throw: Right'] as const;

/** `theme.css` §"A ROOM RIDE ON A PHONE" undone: the readings back in the grid. */
const GIVE_WAY_UNDONE = `
  .oyl-game--riding .oyl-hud .oyl-hud__fields--secondary > .oyl-hud__field--gives-way {
    position: static !important; width: auto !important; height: auto !important;
    margin: 0 !important; overflow: visible !important; clip-path: none !important;
    white-space: normal !important;
  }`;

/** The *Houses* field's value and the phrase under it, as the rider reads them. */
async function houses(page: Page): Promise<{ readonly left: string; readonly detail: string }> {
  return page.evaluate(() => {
    const field = [...document.querySelectorAll('.oyl-hud__field--delivery')].find(
      (each) => each.querySelector('dt')?.textContent === 'Houses',
    );
    return {
      left: field?.querySelector('dd')?.firstChild?.textContent ?? '',
      detail: (field?.querySelector('.oyl-hud__detail')?.textContent ?? '').trim(),
    };
  });
}

/**
 * Ride the round on to *10 delivered, 2 missed* on Playwright's clock: no
 * throw until two houses are missed, then one toward the next house every
 * quarter second (`throw-input.ts` §`THROW_KEYS`, the up arrow).
 */
async function rideToNearlyOver(page: Page): Promise<void> {
  const done = '10\u00a0delivered, 2\u00a0missed';
  for (let step = 0; step < 4_000; step += 1) {
    const now = await houses(page);
    if (now.detail === done) return;
    const missed = Number(/(\d+)\u00a0missed/.exec(now.detail)?.[1] ?? '0');
    if (missed > 2) {
      throw new Error(`the round missed a third house: ${now.detail}`);
    }
    if (missed === 2) await page.keyboard.press('ArrowUp');
    await page.clock.runFor(250);
  }
  throw new Error(`the round never reached ${done}: ${(await houses(page)).detail}`);
}

/** The panels a rider can see: a 1 px clipped box is not one. */
function seenPanels(seen: StageMeasurement): readonly StageItem[] {
  return seen.panels.filter((each) => each.box.height > 1);
}

function panelNamed(seen: StageMeasurement, className: string): StageItem {
  const found = seen.panels.find((each) => each.name.split(' ').includes(className));
  if (found === undefined) throw new Error(`no ${className} among the HUD panels`);
  return found;
}

/** Put the page at `viewport`, laid out again before it is measured. */
async function resizeTo(page: Page, viewport: Viewport): Promise<void> {
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  await page.waitForFunction(
    ([width, height]) => window.innerWidth === width && window.innerHeight === height,
    [viewport.width, viewport.height] as const,
  );
}

/** Everything §"What is held" says, at one viewport, both ways. */
async function holdTheStage(page: Page, viewport: Viewport, stage: string): Promise<void> {
  const tablet = TABLET_VIEWPORTS.includes(viewport);
  const rider = riderBox(viewport);
  for (const [how, seen] of await bothWays(page)) {
    const at = `${stage}, ${viewport.name}, ${how}`;
    const panels = seenPanels(seen);
    expect(panels.length, at).toBeGreaterThanOrEqual(4);
    // Whole, on the stage, and over no other panel.
    expect(panels.filter((each) => !inside(each.box, viewport)).map(describeItem), at).toEqual([]);
    const collisions: string[] = [];
    panels.forEach((a, index) => {
      for (const b of panels.slice(index + 1)) {
        if (overlap(a.box, b.box)) collisions.push(`${describeItem(a)} × ${describeItem(b)}`);
      }
    });
    expect(collisions, at).toEqual([]);
    // No panel over the leaning rider.
    expect(
      panels.filter((each) => overlap(each.box, rider)).map(describeItem),
      `${at}: over the rider`,
    ).toEqual([]);
    // *Houses* and *Score*: at a size, uncovered, clear of the actions and its two controls.
    const actions = panelNamed(seen, 'oyl-hud__actions');
    const controls = ['control: Pause', 'control: End ride'].map((name) => named(seen.items, name));
    for (const name of DELIVERY_READINGS) {
      const reading = named(seen.items, name);
      expect(inside(reading.box, viewport), `${at}: ${describeItem(reading)}`).toBe(true);
      expect(reading.onTop, `${at}: ${describeItem(reading)}`).toBe(true);
      expect(overlap(reading.box, actions.box), `${at}: ${name} over the actions`).toBe(false);
      for (const control of controls) {
        expect(overlap(reading.box, control.box), `${at}: ${name} over ${control.name}`).toBe(
          false,
        );
      }
    }
    // The throw control, whole and uncovered, inside the actions panel.
    for (const name of THROWS) {
      const button = named(seen.items, name);
      expect(inside(button.box, viewport), `${at}: ${describeItem(button)}`).toBe(true);
      expect(button.onTop, `${at}: ${describeItem(button)}`).toBe(true);
    }
    // On a phone the pacer, the ghost and the wind give way, still in the list.
    for (const name of GIVES_WAY) {
      const reading = named(seen.items, name);
      if (tablet) {
        expect(inside(reading.box, viewport), `${at}: ${describeItem(reading)}`).toBe(true);
      } else {
        expect(reading.box.width * reading.box.height, `${at}: ${name}`).toBeLessThanOrEqual(1);
      }
    }
    expect(seen.secondary, at).toEqual([
      'Speed',
      'Gradient',
      'To go',
      'Moving',
      'Pacer',
      'Your best',
      'Wind',
      'Houses',
      'Score',
    ]);
    if (!tablet) {
      const secondary = panelNamed(seen, 'oyl-hud__fields--secondary');
      console.log(
        `#1816 ${at}: the secondary panel's bottom is ${(rider.top - secondary.box.bottom).toFixed(1)} px above the rider's box`,
      );
    }
  }
}

test.describe('a Delivery round’s HUD on the stage, beside the leaning rider — #1816', () => {
  test('at the round’s start, 12 left on day 7, at every overlay viewport', async ({ page }) => {
    await openRide(page, OVERLAY_VIEWPORTS[0] as Viewport, DELIVERY_ROUND);
    expect(await houses(page)).toEqual({
      left: '12',
      detail: '0\u00a0delivered, 0\u00a0missed',
    });
    for (const viewport of OVERLAY_VIEWPORTS) {
      await test.step(viewport.name, async () => {
        await resizeTo(page, viewport);
        await holdTheStage(page, viewport, 'at its start');
      });
    }
  });

  test('nearly over, 10 delivered and 2 missed, at every overlay viewport', async ({ page }) => {
    test.setTimeout(240_000);
    await page.clock.install();
    await openRide(page, OVERLAY_VIEWPORTS[0] as Viewport, DELIVERY_ROUND);
    await rideToNearlyOver(page);
    expect(await houses(page)).toEqual({
      left: '0',
      detail: '10\u00a0delivered, 2\u00a0missed',
    });
    for (const viewport of OVERLAY_VIEWPORTS) {
      await test.step(viewport.name, async () => {
        await resizeTo(page, viewport);
        await holdTheStage(page, viewport, 'nearly over');
      });
    }
  });

  test('the control — with the give-way rule undone, a row is added, and at 736×360 a panel is over the rider', async ({
    page,
  }) => {
    await openRide(page, OVERLAY_VIEWPORTS[0] as Viewport, DELIVERY_ROUND);
    const red: string[] = [];
    let smallest: readonly StageItem[] | undefined;
    for (const viewport of OVERLAY_VIEWPORTS.filter((each) => !TABLET_VIEWPORTS.includes(each))) {
      await resizeTo(page, viewport);
      const before = await measure(page);
      const rowsBefore = panelNamed(before, 'oyl-hud__fields--secondary').box.height;
      const undone = await page.addStyleTag({ content: GIVE_WAY_UNDONE });
      const after = await measure(page);
      await undone.evaluate((element: Element) => {
        element.remove();
      });
      const pacer = named(after.items, 'reading: Pacer');
      expect(
        pacer.box.width * pacer.box.height,
        `${viewport.name}: the rule undone`,
      ).toBeGreaterThan(1);
      const rider = riderBox(viewport);
      const over = seenPanels(after).filter((each) => overlap(each.box, rider));
      const rowsAfter = panelNamed(after, 'oyl-hud__fields--secondary').box.height;
      const added = rowsAfter - rowsBefore;
      console.log(
        `#1816 control, ${viewport.name}: secondary panel ${added.toFixed(1)} px taller; over the rider: ${over.length === 0 ? 'none' : over.map(describeItem).join(', ')}`,
      );
      if (over.length > 0 || added > 10) red.push(viewport.name);
      if (viewport.width === 736 && viewport.height === 360) smallest = over;
    }
    console.log(`#1816 control: red at ${red.join('; ')}`);
    expect(smallest?.map(describeItem) ?? [], 'over the rider at 736×360').not.toEqual([]);
  });
});
