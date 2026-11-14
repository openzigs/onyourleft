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
 *   on the warned stages and with none on the start stage (SC 1.4.1);
 * - every item's name fits the *Item* field, one stage per item;
 * - the "behind you" cue is on the *Place* field's lap line on every race
 *   stage (#2455 AC2), at its widest on the warned ones — the last of the
 *   most laps the chooser offers, the longest bot name, the window's edge:
 *   `Lap 10 of 10 · Sprinter 7 +5 s` — so *Place* fitting its box, its panel
 *   and its row is measured with it.
 *
 * ## The controls
 *
 * With the give-way rule undone the race adds a row to the secondary panel on
 * a phone, and at 736×360 a panel is then over the rider, so both "no row"
 * and "clear of the rider" can fail here. With the standings' clip undone on a
 * phone, the standings land on another panel or on the rider.
 */

import { expect, test, type Page } from '@playwright/test';

import {
  OVERLAY_VIEWPORTS,
  TABLET_VIEWPORTS,
  inside,
  overlap,
  riderBox,
  type Viewport,
} from './ride-stage';

import type { Box, LapRaceStageMeasurement } from './lap-race-hud-harness';

const TABLETS = new Set(['1280×800', '1024×768', '800×1280']);
const RACE_READINGS = ['Place', 'Item'] as const;

/** The stages with a hit coming: the gust held, then each other item (`lap-race-hud-harness.tsx`). */
const WARNED_STAGES = [
  'warned',
  'held-tailwind',
  'held-tow',
  'held-puddle',
  'held-rain-cape',
] as const;
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

async function open(
  page: Page,
  viewport: Viewport,
  query = '',
): Promise<readonly LapRaceStageMeasurement[]> {
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  const response = await page.goto(`/lap-race-hud.html${query}`);
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
      expect(measured.map((each) => each.stage)).toEqual(['none', 'start', ...WARNED_STAGES]);
      const none = stageOf(measured, 'none');
      expect(none.fields.some((each) => each.label === 'Place')).toBe(false);
      for (const name of ['start', ...WARNED_STAGES]) {
        const stage = stageOf(measured, name);
        const at = `${viewport.name}, ${name}`;
        expect(stage.panels.length, at).toBeGreaterThanOrEqual(4);
        expect(stageFaults(stage, viewport), at).toEqual([]);
        const secondary = stage.secondary;
        expect(secondary, `${at}: no secondary panel`).toBeDefined();
        if (secondary === undefined) continue;
        // #2455 AC2: the cue is laid out, so the fit below is the cue's.
        expect(field(stage, 'Place').detail, `${at}: the behind-you cue`).toBe(
          name === 'start' ? 'Lap 1 of 10 · Sprinter 5 +1 s' : 'Lap 10 of 10 · Sprinter 7 +5 s',
        );
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
        // #2434: Calories is drawn on a landscape tablet and gives way upright,
        // where it put *Item* in a third row and the standings over the rider
        // (`theme.css` §"THE CALORIE ESTIMATE IN THE RIDE SO FAR"); on a phone
        // it gives way with the ride so far.
        const landscapeTablet = isTablet(viewport) && viewport.width > viewport.height;
        expect(
          laidOut(field(stage, 'Calories').box),
          `${at}: Calories ${landscapeTablet ? 'gave way' : 'did not give way'}`,
        ).toBe(landscapeTablet);
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
      // The warning is a shape on the warned stages, and there is none on the start.
      for (const name of WARNED_STAGES) {
        const warned = field(stageOf(measured, name), 'Item');
        expect(warned.outlineStyle, name).toBe('dashed');
        expect(warned.outlineWidth, name).toBeGreaterThanOrEqual(2);
      }
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

/*
 * #2599 — the standings never over the actions panel.
 *
 * On the owner's tablet check of 2026-11-14 a solo lap race's standings, eight
 * lines with *Show laps* on their first row, ran down over the actions panel
 * at the bottom right, hiding all of the trainer's line but "Tra". The stages
 * above have neither *Use item* nor the swap, and fitted. `?corner=race`
 * draws the corner as the tablet did (`lap-race-hud-harness.tsx` §`CORNER`),
 * at every overlay viewport at the normal text and at the tablets at the
 * large and extra large, and holds:
 *
 * - the standings' box and the actions panel's never overlap, and on a
 *   tablet are the owner's 16 px apart (#2034);
 * - the trainer's line is inside the actions panel, on the stage, and the
 *   topmost thing at each of its corners, hit-tested;
 * - *Pause* and *End ride* are on the stage at 48 px or more (#669);
 * - on a tablet the standings are drawn with the rider's own line, and at
 *   1280×800 and upright, where there is room, with every line — the whole
 *   field of #2328 gives way only where the room is short.
 *
 * The control puts every line back where the room is short, and the
 * standings are then over the actions panel at 1024×768.
 */

const CORNER_STAGES = ['corner-back', 'corner-middle'] as const;

/** The owner's least clearance between the standings and the actions panel (2026-11-06, #2034). */
const CLEARANCE_PIXELS = 16;

/** Every line drawn where the room holds them: the owner's landscape tablet and the upright one. */
const ROOMY = new Set(['1280×800', '800×1280']);

const LINES_GIVE_WAY_UNDONE = `
  .oyl-hud .oyl-hud__standings-line--gives-way {
    position: static !important; width: auto !important; height: auto !important;
    margin: 0 !important; overflow: visible !important; clip-path: none !important;
    white-space: normal !important;
  }`;

const CORNER_CASES = [
  ...OVERLAY_VIEWPORTS.map((viewport) => ({ viewport, text: 'normal' })),
  ...(['large', 'extra-large'] as const).flatMap((text) =>
    TABLET_VIEWPORTS.map((viewport) => ({ viewport, text })),
  ),
];

/** What is wrong with the corner of one stage, as sentences. */
function cornerFaults(stage: LapRaceStageMeasurement, viewport: Viewport, text: string): string[] {
  const faults: string[] = [];
  const say = (box: Box): string =>
    `[${box.left.toFixed(0)},${box.top.toFixed(0)} → ${box.right.toFixed(0)},${box.bottom.toFixed(0)}]`;
  const { standings, actions, trainer } = stage;
  if (actions === undefined) return ['no actions panel'];
  if (standings !== undefined && laidOut(standings)) {
    if (overlap(standings, actions)) {
      faults.push(`the standings ${say(standings)} over the actions panel ${say(actions)}`);
    }
    const sideBySide = standings.right <= actions.left || actions.right <= standings.left;
    if (!sideBySide && actions.top - standings.bottom < CLEARANCE_PIXELS) {
      faults.push(
        `the standings ${(actions.top - standings.bottom).toFixed(0)} px above the actions panel`,
      );
    }
  }
  if (trainer === undefined) {
    faults.push('no trainer line');
  } else {
    if (!within(trainer.box, actions))
      faults.push(`the trainer line ${say(trainer.box)} out of its panel`);
    if (!inside(trainer.box, viewport))
      faults.push(`the trainer line ${say(trainer.box)} off the stage`);
    if (!trainer.topmost) faults.push(`the trainer line ${say(trainer.box)} covered`);
  }
  for (const label of ['Pause', 'End ride']) {
    const control = stage.controls.find((each) => each.label === label);
    if (control === undefined) {
      faults.push(`no ${label}`);
      continue;
    }
    if (!inside(control.box, viewport)) faults.push(`${label} ${say(control.box)} off the stage`);
    if (control.box.width < 48 || control.box.height < 48) {
      faults.push(`${label} ${control.box.width.toFixed(0)}×${control.box.height.toFixed(0)}`);
    }
  }
  if (isTablet(viewport)) {
    const drawn = stage.standingsLines.filter((line) => line.drawn);
    if (!stage.standingsLines.some((line) => line.you && line.drawn)) {
      faults.push('the rider’s own line gave way');
    }
    if (ROOMY.has(sized(viewport)) && text === 'normal' && drawn.length !== 8) {
      faults.push(`${String(drawn.length)} of 8 lines drawn where there is room for all`);
    }
  }
  return faults;
}

for (const { viewport, text } of CORNER_CASES) {
  test(`#2599 a lap race's standings stay off the actions panel at ${text} text — ${viewport.name}`, async ({
    page,
  }) => {
    const measured = await open(page, viewport, `?corner=race&text=${text}`);
    expect(measured.map((each) => each.stage)).toEqual([...CORNER_STAGES]);
    for (const stage of measured) {
      expect(stage.standingsLines.length, stage.stage).toBe(8);
      const drawn = stage.standingsLines.filter((line) => line.drawn).length;
      console.log(
        `#2599 ${viewport.name}, ${text} text, ${stage.stage}: ${String(drawn)} of 8 lines drawn`,
      );
      expect(cornerFaults(stage, viewport, text), `${viewport.name}, ${stage.stage}`).toEqual([]);
    }
  });
}

test('#2599 the corner measurement can fail: every line drawn puts the standings on the actions panel at 1024×768', async ({
  page,
}) => {
  const fourByThree = OVERLAY_VIEWPORTS.find((each) => sized(each) === '1024×768');
  if (fourByThree === undefined) throw new Error('no 4:3 tablet to control at');
  await open(page, fourByThree, '?corner=race&text=normal');
  await page.addStyleTag({ content: LINES_GIVE_WAY_UNDONE });
  const undone = await remeasure(page);
  const faults = undone.flatMap((stage) => cornerFaults(stage, fourByThree, 'normal'));
  console.log(`#2599 control, 1024×768 with every line drawn: ${faults.join('; ')}`);
  expect(faults.some((each) => each.includes('over the actions panel'))).toBe(true);
});
