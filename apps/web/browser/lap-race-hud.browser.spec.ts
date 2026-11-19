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

import { HUD_CONTROLS_FADE_MS, MOTION_DURATION_MS } from '../src/design/tokens';
import { CONTROLS_HIDE_MILLISECONDS } from '../src/game/hud/controls-reveal';
import { STANDINGS_RETURN_MS } from '../src/game/hud/standings-follow';

import { applyInsets, NO_INSETS, PIXEL_TABLET_LANDSCAPE_INSETS, type Insets } from './insets';

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
  }
  /* #2599: and at its full height, as it would be drawn there with no room
     rule: the list's height is the room's on a stage where it is shown. */
  .oyl-game--riding .oyl-hud .oyl-hud__standings-scroll { max-height: none !important; }`;

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
 * - *Pause* and *End ride* are on the stage at 48 px or more (#669), and
 *   *Show laps* 44 px or more;
 * - on a tablet every line is in the document, the rider's own line is in
 *   view, and where the list is shorter than its lines it is a named,
 *   focusable region that scrolls inside itself (the owner's ruling on PR
 *   #2621: scroll with a finger rather than hide lines);
 * - at 1280×800 and upright, where there is room, every line is in view
 *   without scrolling (§`ROOMY` says at which text sizes);
 * - and the FIRST frame drawn already has them off the actions panel (PR
 *   #2621's review): the room is measured before paint, not a frame later.
 *
 * Then, at 1024×768, a rider scrolls it: by a finger's gesture, which never
 * presses *Use item*, and by a wheel, after which the list eases back to the
 * rider's own line {@link STANDINGS_RETURN_MS} after the last scroll —
 * Playwright's clock, not a real wait.
 *
 * The control lets the list run its full height, and the standings are then
 * over the actions panel at 1024×768.
 */

const CORNER_STAGES = ['corner-back', 'corner-middle'] as const;

/** The owner's least clearance between the standings and the actions panel (2026-11-06, #2034). */
const CLEARANCE_PIXELS = 16;

/**
 * Where every line is in view without scrolling, by text size: the owner's
 * landscape tablet and the upright one at the normal text, and the upright
 * one at every size. ⚠️ **Not 1280×800 at the large sizes**, measured: on the
 * CI runner's fonts the room there is a line short of the eighth for the
 * rider-4th stage at large and extra large text, where a Mac holds all 8.
 */
const ROOMY: Readonly<Record<string, ReadonlySet<string>>> = {
  normal: new Set(['1280×800', '800×1280']),
  large: new Set(['800×1280']),
  'extra-large': new Set(['800×1280']),
};

const LIST_HEIGHT_UNDONE = `
  .oyl-hud .oyl-hud__standings-scroll { max-height: none !important; }`;

const CORNER_CASES = [
  ...OVERLAY_VIEWPORTS.map((viewport) => ({ viewport, text: 'normal' })),
  ...(['large', 'extra-large'] as const).flatMap((text) =>
    TABLET_VIEWPORTS.map((viewport) => ({ viewport, text })),
  ),
];

/**
 * What is wrong with the corner of one stage, as sentences. `roomy` is
 * whether every line must be in view without scrolling: {@link ROOMY}'s
 * answer, unless the caller draws the corner with less room than that was
 * measured in (#2837's cases, in the shell or with the AI bots' sentence).
 */
function cornerFaults(
  stage: LapRaceStageMeasurement,
  viewport: Viewport,
  text: string,
  roomy: boolean = ROOMY[text]?.has(sized(viewport)) === true,
): string[] {
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
    const inView = stage.standingsLines.filter((line) => line.inView);
    if (!stage.standingsLines.some((line) => line.you && line.inView)) {
      faults.push('the rider’s own line out of view');
    }
    if (roomy && inView.length !== 8) {
      faults.push(`${String(inView.length)} of 8 lines in view where there is room for all`);
    }
    const swap = stage.swap;
    if (swap !== undefined && laidOut(swap) && swap.height < 44) {
      faults.push(`Show laps ${swap.height.toFixed(0)} px tall`);
    }
    const list = stage.standingsList;
    if (list === undefined) {
      faults.push('no standings list');
    } else if (list.scrollHeight > list.clientHeight + 1) {
      // Shorter than its lines: it must scroll, inside itself, and be reachable.
      if (!list.scrolls || list.overflowY !== 'auto') faults.push('the list does not scroll');
      if (list.overscroll !== 'contain') faults.push(`the list's overscroll is ${list.overscroll}`);
      if (list.role !== 'region' || list.label === null || list.tabIndex !== 0) {
        faults.push('the list is not a named, focusable region');
      }
    }
  }
  return faults;
}

/** The list's box and whether the rider's own line is in it, in the viewport, for a stage. */
async function ownLine(
  page: Page,
  stage: string,
): Promise<{
  inView: boolean;
  scrollTop: number;
  more: string | null;
  x: number;
  y: number;
  left: number;
  right: number;
}> {
  return page.evaluate((name) => {
    const list = document.querySelector<HTMLElement>(
      `[data-oyl-lap-race-stage="${name}"] .oyl-hud__standings-scroll`,
    );
    const own = list?.querySelector('.oyl-hud__standings-line--you');
    if (list === null || list === undefined || own === null || own === undefined) {
      throw new Error(`no list or own line on ${name}`);
    }
    const view = list.getBoundingClientRect();
    const box = own.getBoundingClientRect();
    return {
      inView: box.top >= view.top - 1 && box.bottom <= view.bottom + 1,
      scrollTop: list.scrollTop,
      more: list.getAttribute('data-oyl-more'),
      x: view.left + view.width / 2,
      y: view.top + view.height / 2,
      left: view.left,
      right: view.right,
    };
  }, stage);
}

for (const { viewport, text } of CORNER_CASES) {
  test(`#2599 a lap race's standings stay off the actions panel at ${text} text — ${viewport.name}`, async ({
    page,
  }) => {
    const measured = await open(page, viewport, `?corner=race&text=${text}`);
    expect(measured.map((each) => each.stage)).toEqual([...CORNER_STAGES]);
    const first = await page.evaluate(() => window.__oylLapRaceHudFirstFrame);
    expect(
      first?.map((each) => each.stage),
      'the first frame was read',
    ).toEqual([...CORNER_STAGES]);
    for (const frame of first ?? []) {
      // PR #2621's second review: the list opens on the own line before paint.
      if (isTablet(viewport)) {
        expect(
          frame.ownInView,
          `${viewport.name}, ${frame.stage}: the own line in the first frame`,
        ).toBe(true);
      }
      const { standings, actions } = frame;
      if (standings === undefined || actions === undefined) continue;
      expect(
        overlap(standings, actions),
        `${viewport.name}, ${frame.stage}: the first frame drew the standings ` +
          `[${standings.top.toFixed(0)} → ${standings.bottom.toFixed(0)}] over the actions panel ` +
          `from ${actions.top.toFixed(0)}`,
      ).toBe(false);
    }
    for (const stage of measured) {
      expect(stage.standingsLines.length, stage.stage).toBe(8);
      const inView = stage.standingsLines.filter((line) => line.inView).length;
      console.log(
        `#2599 ${viewport.name}, ${text} text, ${stage.stage}: ${String(inView)} of 8 lines in view`,
      );
      expect(cornerFaults(stage, viewport, text), `${viewport.name}, ${stage.stage}`).toEqual([]);
    }
  });
}

test.describe('#2599 the standings scroll at 1024×768', () => {
  const fourByThree = OVERLAY_VIEWPORTS.find((each) => sized(each) === '1024×768');
  if (fourByThree === undefined) throw new Error('no 4:3 tablet');

  test('scroll, hold every racer, and open on the rider’s own line', async ({ page }) => {
    const measured = await open(page, fourByThree, '?corner=race&text=normal');
    for (const stage of measured) {
      const list = stage.standingsList;
      expect(list?.scrolls, stage.stage).toBe(true);
      expect(list?.scrollHeight ?? 0, stage.stage).toBeGreaterThan((list?.clientHeight ?? 0) + 1);
      expect(stage.standingsLines.length, stage.stage).toBe(8);
      expect(
        stage.standingsLines.some((line) => line.you && line.inView),
        `${stage.stage}: the own line in view on open`,
      ).toBe(true);
    }
    // The rider last of eight: the list opens scrolled to its foot, more above.
    expect(stageOf(measured, 'corner-back').standingsList?.more).toBe('above');
  });

  test.describe('on a touch screen', () => {
    // A synthesized touch gesture needs a page that takes touch input: on
    // the CI runner's Linux Chromium without it the gesture moved nothing.
    test.use({ hasTouch: true });

    /** A finger down at `x, from`, drawn to `to` in twelve steps, and lifted: raw touch input. */
    async function swipe(page: Page, x: number, from: number, to: number): Promise<void> {
      const cdp = await page.context().newCDPSession(page);
      const at = async (
        type: 'touchStart' | 'touchMove' | 'touchEnd',
        y: number | undefined,
      ): Promise<void> => {
        await cdp.send('Input.dispatchTouchEvent', {
          type,
          touchPoints: y === undefined ? [] : [{ x: Math.round(x), y: Math.round(y) }],
        });
      };
      await at('touchStart', from);
      for (let step = 1; step <= 12; step += 1)
        await at('touchMove', from + ((to - from) * step) / 12);
      await at('touchEnd', undefined);
    }

    /** Two frames, so a scroll the gesture started has been drawn. */
    async function frames(page: Page): Promise<void> {
      await page.evaluate(
        () =>
          new Promise((resolve) => {
            requestAnimationFrame(() => requestAnimationFrame(resolve));
          }),
      );
    }

    test('a finger drawn down scrolls the list up', async ({ page }) => {
      await open(page, fourByThree, '?corner=race&text=normal');
      await page.evaluate(() => {
        window.scrollTo(0, 0);
      });
      const before = await ownLine(page, 'corner-back');
      await swipe(page, before.x, before.y - 40, before.y + 80);
      await expect
        .poll(async () => (await ownLine(page, 'corner-back')).scrollTop, {
          message: 'the list scrolled up under the finger',
        })
        .toBeLessThan(before.scrollTop);
    });

    test('a finger drawn up on a list at its foot never moves the page', async ({ page }) => {
      await open(page, fourByThree, '?corner=race&text=normal');
      await page.evaluate(() => {
        window.scrollTo(0, 0);
      });
      // The rider last of eight: the list opens at its foot, so a finger
      // drawn up has nothing left to scroll there, and the pan would chain.
      const before = await ownLine(page, 'corner-back');
      expect(before.more, 'the list opens at its foot').toBe('above');
      await swipe(page, before.x, before.y + 40, before.y - 80);
      await frames(page);
      expect(await page.evaluate(() => window.scrollY), 'the page did not move').toBe(0);
    });

    test('a swipe that starts on the list and lifts over Use item never presses it', async ({
      page,
    }) => {
      await open(page, fourByThree, '?corner=race&text=normal');
      await page.evaluate(() => {
        window.scrollTo(0, 0);
      });
      const list = await ownLine(page, 'corner-back');
      const item = await page.evaluate(() => {
        const button = [
          ...document.querySelectorAll(
            '[data-oyl-lap-race-stage="corner-back"] .oyl-hud__actions button',
          ),
        ].find((each) => each.textContent?.trim() === 'Use item');
        const box = button?.getBoundingClientRect();
        return box === undefined
          ? undefined
          : { x: box.left + box.width / 2, y: box.top + box.height / 2 };
      });
      if (item === undefined) throw new Error('no Use item');
      // Down the one column both share, from the list's middle to Use item's.
      const x = Math.min(Math.max(item.x, list.left + 8), list.right - 8);
      const lifted = await page.evaluate(
        ([px, py]) => document.elementFromPoint(px ?? 0, py ?? 0)?.closest('button')?.textContent,
        [x, item.y],
      );
      expect(lifted?.trim(), 'the finger lifts over Use item').toBe('Use item');
      // And it goes down on the list, not on a control: touch events go to
      // the element the finger went down on, so this is what keeps a swipe
      // that ends over Use item from ever being Use item's.
      const downOn = await page.evaluate(
        ([px, py]) =>
          document.elementFromPoint(px ?? 0, py ?? 0)?.closest('.oyl-hud__standings-scroll') !==
          null,
        [x, list.y],
      );
      expect(downOn, 'the finger goes down on the list').toBe(true);
      await swipe(page, x, list.y, item.y);
      await frames(page);
      expect(await page.evaluate(() => window.__oylLapRaceHudItemsUsed ?? 0)).toBe(0);
    });
  });

  for (const motion of ['no-preference', 'reduce'] as const) {
    test(`eases back to the own line ${String(STANDINGS_RETURN_MS)} ms after the last scroll — motion ${motion}`, async ({
      page,
    }) => {
      await page.emulateMedia({ reducedMotion: motion });
      await page.clock.install();
      await open(page, fourByThree, '?corner=race&text=normal');
      await page.evaluate(() => {
        window.scrollTo(0, 0);
      });
      const opened = await ownLine(page, 'corner-back');
      expect(opened.inView).toBe(true);
      await page.mouse.move(opened.x, opened.y);
      await page.mouse.wheel(0, -1_000);
      await expect.poll(async () => (await ownLine(page, 'corner-back')).scrollTop).toBe(0);
      expect((await ownLine(page, 'corner-back')).inView, 'scrolled away from the own line').toBe(
        false,
      );
      await page.clock.runFor(STANDINGS_RETURN_MS - 500);
      const early = await ownLine(page, 'corner-back');
      expect(early.inView, 'still the rider’s, before the time').toBe(false);
      // The cue is written for the return's target at once, so an early
      // return shows here even while a smooth scroll is still on its way.
      expect(early.more, 'no return begun before the time').toBe('below');
      await page.clock.runFor(1_000);
      await expect.poll(async () => (await ownLine(page, 'corner-back')).inView).toBe(true);
    });
  }
});

test('#2599 the corner measurement can fail: the list at its full height is on the actions panel at 1024×768', async ({
  page,
}) => {
  const fourByThree = OVERLAY_VIEWPORTS.find((each) => sized(each) === '1024×768');
  if (fourByThree === undefined) throw new Error('no 4:3 tablet to control at');
  await open(page, fourByThree, '?corner=race&text=normal');
  await page.addStyleTag({ content: LIST_HEIGHT_UNDONE });
  const undone = await remeasure(page);
  const faults = undone.flatMap((stage) => cornerFaults(stage, fourByThree, 'normal'));
  console.log(`#2599 control, 1024×768 with the list at its full height: ${faults.join('; ')}`);
  expect(faults.some((each) => each.includes('over the actions panel'))).toBe(true);
});

/*
 * #2837 — the standings take the room the hidden ride controls leave.
 *
 * The owner's tablet race of 2026-11-18, seven bots: *"the position menu
 * should get bigger when the other one reduces or make it bigger to begin
 * with. Can only see 3 people."* The ride controls fade until touched
 * (#2600), and hidden the actions panel is its trainer's line; in a race that
 * line is drawn at the stage's bottom edge (`theme.css` §"#2837"), and the
 * standings measure the room to it there (`standings-room.ts`).
 *
 * `?corner=race&controls=hide` is the corner with the auto-hide on
 * (`lap-race-hud-harness.tsx` §`CORNER`): `corner-back` holds nothing, so its
 * controls hide; `corner-middle` holds an item, which holds them drawn (ADR
 * 0075 D-5), so it is each case's control on the same page. `&note=ai` adds
 * the AI bots' sentence, as a race against a rider's own model draws it. The
 * controls' wait runs on Playwright's clock, not a real one.
 *
 * Held, on the tablets — the owner's in the shell with its insets (the
 * tablet's real viewport, `insets.ts`) among them — at each text size:
 *
 * - DRAWN, the corner is #2599's: the standings 16 px or more above the
 *   actions panel, the rider's own line in view;
 * - HIDDEN, every one of the eight lines is in view without scrolling, the
 *   standings are taller by the lines they were short of, still on the stage,
 *   over no panel, clear of the leaning rider and 16 px or more above the
 *   trainer's line, which is on the stage at its bottom edge and the topmost
 *   thing at each of its corners;
 * - the stage whose controls are held is exactly as it was;
 * - RETURNED by a touch on the road, the corner is the drawn one again;
 * - and on the way there the panel stays in its own place for as long as its
 *   controls are fading, then comes down to its line with no step.
 *
 * The control leaves the hidden panel in its own place, as it was before
 * #2837: the standings then do not grow by a line. And on a phone, whose
 * stage draws no standings, the hidden panel does not move at all.
 */

/** `controls-reveal.ts` §`CONTROLS_HIDE_MILLISECONDS`, and a frame more. */
const HIDE_AFTER_MILLISECONDS = CONTROLS_HIDE_MILLISECONDS + 100;

/** The stage whose controls hide, and the one whose rider holds an item. */
const HIDES = 'corner-back';
const HELD = 'corner-middle';

/** `theme.css` §"#2837" undone: the hidden actions panel in its own place. */
const HIDDEN_PANEL_IN_PLACE = `
  .oyl-game--riding .oyl-hud .oyl-hud__actions { translate: none !important; }`;

interface GrowCase {
  readonly viewport: Viewport;
  readonly text: 'normal' | 'large' | 'extra-large';
  readonly insets: Insets;
  /** Whether the AI bots' sentence is under the summary. */
  readonly note: boolean;
  /**
   * Whether the drawn corner is short of the eight lines here on every
   * machine measured — by two lines or more on a Mac — so that "it grows" is
   * asserted of a list that had lines to gain.
   */
  readonly short: boolean;
}

/**
 * Whether {@link ROOMY} speaks for a case's DRAWN corner: only as it was
 * measured, with no insets and no sentence under the summary. ⚠️ Measured on
 * this pull request's first CI run: in the shell at the normal text with the
 * AI bots' sentence, the runner's fonts hold 7 of the 8 lines where a Mac
 * holds all 8 — and hidden, both hold 8.
 */
function drawnRoomy(each: GrowCase): boolean {
  return (
    each.insets === NO_INSETS && !each.note && ROOMY[each.text]?.has(sized(each.viewport)) === true
  );
}

function tablet(size: string): Viewport {
  const found = TABLET_VIEWPORTS.find((each) => sized(each) === size);
  if (found === undefined) throw new Error(`no ${size} tablet`);
  return found;
}

const IN_THE_SHELL = PIXEL_TABLET_LANDSCAPE_INSETS;

const GROW_CASES: readonly GrowCase[] = [
  // A race of seven bots at 1280×800: all eight lines from the start.
  { viewport: tablet('1280×800'), text: 'normal', insets: NO_INSETS, note: false, short: false },
  // The owner's tablet in the shell, a race against the rider's own model.
  { viewport: tablet('1280×800'), text: 'normal', insets: IN_THE_SHELL, note: true, short: false },
  { viewport: tablet('1280×800'), text: 'large', insets: IN_THE_SHELL, note: true, short: true },
  {
    viewport: tablet('1280×800'),
    text: 'extra-large',
    insets: IN_THE_SHELL,
    note: true,
    short: true,
  },
  { viewport: tablet('1024×768'), text: 'normal', insets: NO_INSETS, note: false, short: true },
  { viewport: tablet('1024×768'), text: 'large', insets: NO_INSETS, note: true, short: true },
  { viewport: tablet('1024×768'), text: 'extra-large', insets: NO_INSETS, note: true, short: true },
  // Upright there is room for every line already: nothing to gain, nothing lost.
  { viewport: tablet('800×1280'), text: 'large', insets: NO_INSETS, note: true, short: false },
];

function growQuery(each: GrowCase): string {
  return `?corner=race&controls=hide&text=${each.text}${each.note ? '&note=ai' : ''}`;
}

function growName(each: GrowCase): string {
  const shell = each.insets === NO_INSETS ? '' : ', in the shell';
  return `${each.viewport.name}${shell}, ${each.text} text${each.note ? ', AI bots' : ''}`;
}

function linesInView(stage: LapRaceStageMeasurement): number {
  return stage.standingsLines.filter((line) => line.inView).length;
}

function standingsOf(stage: LapRaceStageMeasurement): Box {
  if (stage.standings === undefined) throw new Error(`no standings on ${stage.stage}`);
  return stage.standings;
}

/** Load the corner with the auto-hide on, on Playwright's clock, and measure it drawn. */
async function openHiding(page: Page, each: GrowCase): Promise<readonly LapRaceStageMeasurement[]> {
  if (each.insets !== NO_INSETS) await applyInsets(page, each.insets);
  await page.clock.install();
  return open(page, each.viewport, growQuery(each));
}

/** Run the controls' wait out, and the fade and the panel's closing to their end. */
async function hide(page: Page): Promise<void> {
  await page.clock.fastForward(HIDE_AFTER_MILLISECONDS);
  const hud = page.locator(`[data-oyl-lap-race-stage="${HIDES}"] .oyl-hud`);
  await expect(hud).toHaveAttribute('data-oyl-controls', 'hidden');
  // A CSS animation runs on the page's own clock, not `page.clock`'s.
  await hud
    .locator('.oyl-hud__actions')
    .evaluate((panel) =>
      Promise.all(panel.getAnimations({ subtree: true }).map((each) => each.finished)),
    );
}

/** What is wrong with the stage whose controls are hidden, as sentences. */
function hiddenFaults(
  stage: LapRaceStageMeasurement,
  drawn: LapRaceStageMeasurement,
  each: GrowCase,
): string[] {
  const faults: string[] = [];
  const say = (box: Box): string =>
    `[${box.left.toFixed(0)},${box.top.toFixed(0)} → ${box.right.toFixed(0)},${box.bottom.toFixed(0)}]`;
  const { viewport, insets } = each;
  const floor = viewport.height - insets.bottom;
  const standings = standingsOf(stage);
  const { actions, trainer } = stage;
  if (linesInView(stage) !== 8) faults.push(`${String(linesInView(stage))} of 8 lines in view`);
  if (!stage.standingsLines.some((line) => line.you && line.inView)) {
    faults.push('the rider’s own line out of view');
  }
  if (stage.standingsList?.scrolls === true) faults.push('the list still scrolls');
  if (standings.top < insets.top - 1 || standings.bottom > floor + 1 || standings.left < 0) {
    faults.push(`the standings ${say(standings)} off the stage`);
  }
  if (overlap(standings, riderBox(viewport))) {
    faults.push(`the standings ${say(standings)} over the rider`);
  }
  for (const panel of stage.panels) {
    if (panel.name.includes('oyl-hud__standings')) continue;
    if (overlap(panel.box, standings)) {
      faults.push(`the standings ${say(standings)} over ${panel.name} ${say(panel.box)}`);
    }
  }
  if (actions === undefined || trainer === undefined) {
    faults.push('no actions panel or no trainer line');
    return faults;
  }
  // The drawn part of the hidden panel begins at its box's top: the line.
  if (actions.top - standings.bottom < CLEARANCE_PIXELS - 0.5) {
    faults.push(
      `the standings ${(actions.top - standings.bottom).toFixed(0)} px above the trainer's line`,
    );
  }
  if (trainer.box.bottom > floor + 1) {
    faults.push(`the trainer line ${say(trainer.box)} off the stage`);
  }
  if (floor - trainer.box.bottom > 2 * CLEARANCE_PIXELS) {
    faults.push(`the trainer line ${say(trainer.box)} not at the stage's bottom edge`);
  }
  if (!trainer.topmost) faults.push(`the trainer line ${say(trainer.box)} covered`);
  const grew = standings.height - standingsOf(drawn).height;
  const gained = 8 - linesInView(drawn);
  if (gained > 0 && grew < 1) faults.push(`the standings no taller, ${String(gained)} lines short`);
  if (gained === 0 && Math.abs(grew) > 1) {
    faults.push(`the standings ${grew.toFixed(0)} px taller with no line to gain`);
  }
  return faults;
}

test.describe('#2837 a lap race’s standings take the room the hidden controls leave', () => {
  // The touch that brings the controls back is a real one.
  test.use({ hasTouch: true });

  for (const each of GROW_CASES) {
    test(`grow when the controls hide and give the room back when a touch returns them — ${growName(each)}`, async ({
      page,
    }) => {
      const { viewport, text } = each;
      const at = growName(each);
      const drawn = await openHiding(page, each);
      for (const stage of drawn) {
        expect(
          cornerFaults(stage, viewport, text, drawnRoomy(each)),
          `${at}, ${stage.stage}, drawn`,
        ).toEqual([]);
      }
      const before = stageOf(drawn, HIDES);
      if (each.short) {
        expect(linesInView(before), `${at}: short of the eight lines while drawn`).toBeLessThan(8);
      }
      if (sized(viewport) === '1280×800' && text === 'normal' && !each.note) {
        expect(linesInView(before), `${at}: all eight lines from the start`).toBe(8);
      }

      await hide(page);
      await expect
        .poll(async () => linesInView(stageOf(await remeasure(page), HIDES)), {
          message: `${at}: every line in view once the controls have hidden`,
        })
        .toBe(8);
      const hidden = await remeasure(page);
      console.log(
        `#2837 ${at}: ${String(linesInView(before))} of 8 lines drawn, ` +
          `${String(linesInView(stageOf(hidden, HIDES)))} hidden, the standings ` +
          `${standingsOf(before).height.toFixed(0)} → ${standingsOf(stageOf(hidden, HIDES)).height.toFixed(0)} px`,
      );
      expect(hiddenFaults(stageOf(hidden, HIDES), before, each), `${at}, hidden`).toEqual([]);
      // The same page's control: an item held holds the controls, and the room.
      await expect(page.locator(`[data-oyl-lap-race-stage="${HELD}"] .oyl-hud`)).toHaveAttribute(
        'data-oyl-controls',
        'shown',
      );
      expect(standingsOf(stageOf(hidden, HELD)), `${at}: the held stage`).toEqual(
        standingsOf(stageOf(drawn, HELD)),
      );

      // A touch on the road returns the controls, and the room with them.
      await page.evaluate(() => {
        window.scrollTo(0, 0);
      });
      await page.touchscreen.tap(viewport.width / 2, viewport.height / 2);
      await expect(page.locator(`[data-oyl-lap-race-stage="${HIDES}"] .oyl-hud`)).toHaveAttribute(
        'data-oyl-controls',
        'shown',
      );
      await expect
        .poll(async () => standingsOf(stageOf(await remeasure(page), HIDES)).height, {
          message: `${at}: the standings as tall as they were drawn`,
        })
        .toBeCloseTo(standingsOf(before).height, 0);
      const returned = stageOf(await remeasure(page), HIDES);
      expect(cornerFaults(returned, viewport, text, drawnRoomy(each)), `${at}, returned`).toEqual(
        [],
      );
      expect(linesInView(returned), `${at}, returned`).toBe(linesInView(before));
    });
  }

  // No fade and no closing to wait out: the move is a 0.01 ms transition there
  // (`theme.css` §"Motion is opt-in"), and the room is measured as it ends.
  test('grow for a rider who asked for less motion — a 4:3 tablet', async ({ page }) => {
    const each = GROW_CASES.find((one) => sized(one.viewport) === '1024×768' && one.short);
    if (each === undefined) throw new Error('no short case at 1024×768');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const drawn = await openHiding(page, each);
    await hide(page);
    await expect.poll(async () => linesInView(stageOf(await remeasure(page), HIDES))).toBe(8);
    const hidden = stageOf(await remeasure(page), HIDES);
    expect(hiddenFaults(hidden, stageOf(drawn, HIDES), each)).toEqual([]);
  });

  test('the hidden panel keeps its own place until the fade has run, then comes down to its line with no step', async ({
    page,
  }) => {
    const each = GROW_CASES.find((one) => sized(one.viewport) === '1024×768' && one.short);
    if (each === undefined) throw new Error('no short case at 1024×768');
    const drawn = stageOf(await openHiding(page, each), HIDES);
    const inPlace = drawn.actions?.top;
    if (inPlace === undefined) throw new Error('no actions panel');
    const out = HUD_CONTROLS_FADE_MS.out;
    const close = MOTION_DURATION_MS.medium;
    const stage = page.locator(`[data-oyl-lap-race-stage="${HIDES}"]`);
    // The page's own clock runs the animations, not `page.clock`, and the hold
    // lasts 800 ms of it: a runner that stalls that long between the attribute
    // and the sampling would find the hold over. So the panel's animations are
    // paused in the mutation's own microtask, before a frame has been drawn
    // (reading the style forces them into being), and nothing here races.
    await stage.locator('.oyl-hud').evaluate((hud) => {
      new MutationObserver((_records, observer) => {
        if (hud.getAttribute('data-oyl-controls') !== 'hidden') return;
        const panel = hud.querySelector('.oyl-hud__actions');
        if (panel === null) return;
        getComputedStyle(panel).getPropertyValue('animation-name');
        for (const animation of panel.getAnimations()) animation.pause();
        observer.disconnect();
      }).observe(hud, { attributes: true, attributeFilter: ['data-oyl-controls'] });
    });
    await page.clock.fastForward(HIDE_AFTER_MILLISECONDS);
    await expect(stage.locator('.oyl-hud')).toHaveAttribute('data-oyl-controls', 'hidden');
    // The panel's own animations, already held, are set to each moment in turn,
    // as `ride-chrome.browser.spec.ts` §`sampleFade` does for the fade.
    const fading = [0, out / 2, out - 1];
    const closing = [out + close / 4, out + close / 2, out + (3 * close) / 4];
    const tops = await stage.locator('.oyl-hud__actions').evaluate(
      (panel, times) => {
        const origin = panel.closest('[data-oyl-lap-race-stage]')?.getBoundingClientRect().top ?? 0;
        const animations = panel.getAnimations();
        if (animations.length < 2) throw new Error(`${String(animations.length)} animations held`);
        for (const animation of animations) animation.pause();
        const sampled = times.map((atMs) => {
          for (const animation of animations) animation.currentTime = atMs;
          return panel.getBoundingClientRect().top - origin;
        });
        for (const animation of animations) animation.finish();
        return { sampled, ended: panel.getBoundingClientRect().top - origin };
      },
      [...fading, ...closing],
    );
    const where = growName(each);
    // While the controls fade, the panel they fade in has not moved.
    for (const [index, atMs] of fading.entries()) {
      expect(tops.sampled[index], `${where}: in its own place at ${String(atMs)} ms`).toBeCloseTo(
        inPlace,
        0,
      );
    }
    // Then it comes down, each sample lower than the last, to where it ends.
    const coming = [inPlace, ...tops.sampled.slice(fading.length), tops.ended];
    coming.slice(1).forEach((top, index) => {
      expect(top, `${where}: lower at closing sample ${String(index)}`).toBeGreaterThan(
        (coming[index] ?? 0) + 1,
      );
    });
    expect(tops.ended - inPlace, `${where}: down by most of the panel`).toBeGreaterThan(100);
  });

  test('on a phone, where no standings are drawn, the hidden panel stays where it was', async ({
    page,
  }) => {
    const phone = OVERLAY_VIEWPORTS.find((one) => sized(one) === '844×390');
    if (phone === undefined) throw new Error('no phone in landscape');
    await page.clock.install();
    const drawn = stageOf(await open(page, phone, '?corner=race&controls=hide'), HIDES);
    expect(laidOut(standingsOf(drawn)), 'no standings on a phone’s stage').toBe(false);
    await hide(page);
    const hidden = stageOf(await remeasure(page), HIDES);
    expect(hidden.actions?.top).toBeCloseTo(drawn.actions?.top ?? Number.NaN, 0);
  });

  test('the growth can fail: with the hidden panel left in its own place, the standings gain no line', async ({
    page,
  }) => {
    const each = GROW_CASES.find((one) => sized(one.viewport) === '1024×768' && one.short);
    if (each === undefined) throw new Error('no short case to control at');
    const drawn = await openHiding(page, each);
    const before = stageOf(drawn, HIDES);
    await page.addStyleTag({ content: HIDDEN_PANEL_IN_PLACE });
    await hide(page);
    // Two frames, so a room measured as the closing ended has been drawn.
    await page.evaluate(
      () =>
        new Promise((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(resolve));
        }),
    );
    const hidden = stageOf(await remeasure(page), HIDES);
    const faults = hiddenFaults(hidden, before, each);
    console.log(`#2837 control, ${growName(each)} with the panel in place: ${faults.join('; ')}`);
    expect(linesInView(hidden)).toBe(linesInView(before));
    expect(faults.some((fault) => fault.includes('the standings no taller'))).toBe(true);
  });
});
