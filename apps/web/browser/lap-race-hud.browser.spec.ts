// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A lap race on the HUD, laid out — #1904's fourth criterion: the race's
 * panels stay inside the stage at 736×360 and 360×752, and clear of the
 * leaning rider (the #1356 and #1398 classes), held at every overlay viewport
 * `ride-stage.ts` names, those two among them.
 *
 * `lap-race-hud-harness.tsx` renders the widest ride the picker starts three
 * ways — with no race, at a race's start, and on its last lap with a warning
 * up — through the real `HudPanel` and the real stylesheet. It says what the
 * page does not prove: no lap race runs in a real ride until #1906.
 *
 * ## What is held, at every overlay viewport, on both race stages
 *
 * - every panel a rider can see is whole on the stage, over no other panel,
 *   and over no part of the leaning rider's box (`ride-stage.ts`
 *   §`riderBox`);
 * - *Place* and *Item* are laid out at a size, inside the secondary panel,
 *   their values fitting their boxes, over no other reading and over neither
 *   *Pause* nor *End ride*;
 * - on a phone the pacer's, the ghost's and the wind's readings give way, and
 *   the secondary panel has **no more rows** than the same ride with no race;
 * - the race's standings are a panel of their own on a tablet and visually
 *   hidden on a phone (ADR 0051 D-7);
 * - the warning is a SHAPE: the *Item* field is drawn with a dashed outline
 *   on the warned stage and with none on the start stage (SC 1.4.1).
 *
 * ## The controls
 *
 * With the give-way rule undone the race adds a row to the secondary panel on
 * a phone, and at 736×360 a panel is then over the rider, so both "no row"
 * and "clear of the rider" can fail here. With the standings' clip undone on a
 * phone, the standings land on another panel or on the rider.
 */

import { expect, test, type Page } from '@playwright/test';

import { OVERLAY_VIEWPORTS, inside, overlap, riderBox, type Viewport } from './ride-stage';

import type { Box, LapRaceStageMeasurement } from './lap-race-hud-harness';

const TABLETS = new Set(['1280×800', '1024×768', '800×1280']);
const RACE_READINGS = ['Place', 'Item'] as const;
const GIVES_WAY = ['Pacer', 'Your best', 'Wind'] as const;

const GIVE_WAY_UNDONE = `
  .oyl-game--riding .oyl-hud .oyl-hud__fields--secondary > .oyl-hud__field--gives-way {
    position: static !important; width: auto !important; height: auto !important;
    margin: 0 !important; overflow: visible !important; clip-path: none !important;
    white-space: normal !important;
  }`;

const STANDINGS_SHOWN = `
  .oyl-game--riding .oyl-hud .oyl-hud__standings {
    position: static !important; width: min(100%, 18rem) !important; height: auto !important;
    margin: 0 !important; overflow: visible !important; clip-path: none !important;
    white-space: normal !important; grid-area: notices !important;
    align-self: start !important; justify-self: end !important;
  }`;

function sized(viewport: Viewport): string {
  return `${String(viewport.width)}×${String(viewport.height)}`;
}

function isTablet(viewport: Viewport): boolean {
  return TABLETS.has(sized(viewport));
}

function laidOut(box: Box): boolean {
  return box.width > 1 && box.height > 1;
}

async function open(page: Page, viewport: Viewport): Promise<readonly LapRaceStageMeasurement[]> {
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  const response = await page.goto('/lap-race-hud.html');
  expect(
    response?.status(),
    'lap-race-hud.html did not load — is it named in vite.browser.config.ts build.rollupOptions.input?',
  ).toBe(200);
  await page.waitForFunction(() => window.__oylLapRaceHud !== undefined);
  const published = await page.evaluate(() => window.__oylLapRaceHud);
  expect(published?.errors, 'the lap race HUD harness reported an error').toEqual([]);
  expect(published?.ready).toBe(true);
  return remeasure(page);
}

async function remeasure(page: Page): Promise<readonly LapRaceStageMeasurement[]> {
  const measured = await page.evaluate(() => window.__oylLapRaceHudMeasure?.());
  if (measured === undefined) throw new Error('the lap race HUD harness published no measurement');
  return measured;
}

function stageOf(
  measured: readonly LapRaceStageMeasurement[],
  stage: string,
): LapRaceStageMeasurement {
  const found = measured.find((each) => each.stage === stage);
  if (found === undefined) throw new Error(`the harness rendered no ${stage} stage`);
  return found;
}

function field(stage: LapRaceStageMeasurement, label: string) {
  const found = stage.fields.find((each) => each.label === label);
  if (found === undefined) {
    throw new Error(
      `the ${stage.stage} stage has no ${label} field: ${stage.fields.map((f) => f.label).join(', ')}`,
    );
  }
  return found;
}

/** Whether `box` lies within `panel`, to a pixel of sub-pixel layout. */
function within(box: Box, panel: Box): boolean {
  return (
    box.left >= panel.left - 1 &&
    box.right <= panel.right + 1 &&
    box.top >= panel.top - 1 &&
    box.bottom <= panel.bottom + 1
  );
}

/** The secondary panel's rows: the distinct tops of the readings laid out inside it. */
function rows(stage: LapRaceStageMeasurement): number {
  const panel = stage.secondary;
  if (panel === undefined) return 0;
  const tops = stage.fields
    .filter((each) => laidOut(each.box) && within(each.box, panel))
    .map((each) => Math.round(each.box.top));
  return new Set(tops).size;
}

/** What is over the rider, or off the stage, or over another panel, at this stage. */
function stageFaults(stage: LapRaceStageMeasurement, viewport: Viewport): string[] {
  const rider = riderBox(viewport);
  const faults: string[] = [];
  const say = (name: string, box: Box): string =>
    `${name} [${box.left.toFixed(0)},${box.top.toFixed(0)} → ${box.right.toFixed(0)},${box.bottom.toFixed(0)}]`;
  stage.panels.forEach((panel, index) => {
    if (!inside(panel.box, viewport)) faults.push(`off the stage: ${say(panel.name, panel.box)}`);
    if (overlap(panel.box, rider)) faults.push(`over the rider: ${say(panel.name, panel.box)}`);
    for (const other of stage.panels.slice(index + 1)) {
      if (overlap(panel.box, other.box)) {
        faults.push(`${say(panel.name, panel.box)} × ${say(other.name, other.box)}`);
      }
    }
  });
  return faults;
}

for (const viewport of OVERLAY_VIEWPORTS) {
  test.describe(`#1904 — a lap race on the HUD at ${viewport.name}`, () => {
    test('stays on the stage, over no panel and clear of the leaning rider, its fields fitting', async ({
      page,
    }) => {
      const measured = await open(page, viewport);
      expect(measured.map((each) => each.stage)).toEqual(['none', 'start', 'warned']);
      const none = stageOf(measured, 'none');
      expect(none.fields.some((each) => each.label === 'Place')).toBe(false);
      for (const name of ['start', 'warned']) {
        const stage = stageOf(measured, name);
        const at = `${viewport.name}, ${name}`;
        expect(stage.panels.length, at).toBeGreaterThanOrEqual(4);
        expect(stageFaults(stage, viewport), at).toEqual([]);
        const secondary = stage.secondary;
        expect(secondary, `${at}: no secondary panel`).toBeDefined();
        if (secondary === undefined) continue;
        for (const label of RACE_READINGS) {
          const reading = field(stage, label);
          expect(laidOut(reading.box), `${at}: ${label} laid out at no size`).toBe(true);
          expect(within(reading.box, secondary), `${at}: ${label} spills out of its panel`).toBe(
            true,
          );
          expect(reading.valueOverflows, `${at}: ${label}'s value overflows`).toBe(false);
          for (const other of stage.fields.filter(
            (each) => each.label !== label && laidOut(each.box),
          )) {
            expect(overlap(reading.box, other.box), `${at}: ${label} on ${other.label}`).toBe(
              false,
            );
          }
          for (const control of stage.controls) {
            expect(overlap(reading.box, control.box), `${at}: ${label} on ${control.label}`).toBe(
              false,
            );
          }
        }
        for (const label of GIVES_WAY) {
          const reading = field(stage, label);
          expect(
            laidOut(reading.box),
            `${at}: ${label} ${isTablet(viewport) ? 'gave way' : 'did not give way'}`,
          ).toBe(isTablet(viewport));
        }
        if (!isTablet(viewport)) {
          expect(rows(stage), `${at}: the race put a row in the secondary panel`).toBe(rows(none));
        }
        // ADR 0051 D-7: a panel of its own on a tablet, visually hidden on a phone.
        const standings = stage.standings;
        expect(standings, `${at}: no standings`).toBeDefined();
        if (standings !== undefined) {
          expect(laidOut(standings), `${at}: standings shown`).toBe(isTablet(viewport));
        }
      }
      // The warning is a shape on the warned stage, and there is none on the start.
      const warned = field(stageOf(measured, 'warned'), 'Item');
      expect(warned.outlineStyle).toBe('dashed');
      expect(warned.outlineWidth).toBeGreaterThanOrEqual(2);
      expect(field(stageOf(measured, 'start'), 'Item').outlineStyle).toBe('none');
    });
  });
}

test.describe('#1904 — the lap race measurement can fail', () => {
  test('with the give-way rule undone, a row is added on a phone and a panel is over the rider at 736×360', async ({
    page,
  }) => {
    const portrait = OVERLAY_VIEWPORTS.find((each) => sized(each) === '360×752');
    const smallest = OVERLAY_VIEWPORTS.find((each) => sized(each) === '736×360');
    if (portrait === undefined || smallest === undefined)
      throw new Error('no viewport to control at');
    const before = stageOf(await open(page, portrait), 'start');
    await page.addStyleTag({ content: GIVE_WAY_UNDONE });
    const after = stageOf(await remeasure(page), 'start');
    expect(rows(after)).toBeGreaterThan(rows(before));

    await open(page, smallest);
    await page.addStyleTag({ content: GIVE_WAY_UNDONE });
    const undone = stageOf(await remeasure(page), 'warned');
    const faults = stageFaults(undone, smallest);
    console.log(`#1904 control, 736×360 with the give-way rule undone: ${faults.join('; ')}`);
    expect(faults.some((each) => each.startsWith('over the rider'))).toBe(true);
  });

  test('with the standings shown on a phone, they land on a panel or on the rider', async ({
    page,
  }) => {
    const smallest = OVERLAY_VIEWPORTS.find((each) => sized(each) === '736×360');
    if (smallest === undefined) throw new Error('no viewport to control at');
    await open(page, smallest);
    await page.addStyleTag({ content: STANDINGS_SHOWN });
    const shown = stageOf(await remeasure(page), 'warned');
    expect(shown.standings !== undefined && laidOut(shown.standings)).toBe(true);
    const faults = stageFaults(shown, smallest);
    console.log(`#1904 control, 736×360 with the standings shown: ${faults.join('; ')}`);
    expect(faults).not.toEqual([]);
  });
});
