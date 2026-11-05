// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A room ride's HUD, measured by a real engine — #1347, #789, #1356, #1358,
 * #1398, #1407, #875 and #1409.
 *
 * Sections of `ride.browser.spec.ts` until #1414, which divided that file so
 * the browser gate's shards could divide it too: its header is still this
 * file's — the viewports, the control and both ways (#1120) — and says which
 * section went where. What these cases share with the other four files is
 * `ride-stage.ts`.
 */

import { expect, test, type Page } from '@playwright/test';

import {
  SUBPIXEL_TOLERANCE,
  type Viewport,
  OVERLAY_VIEWPORTS,
  openRide,
  sharedRide,
  measure,
  inside,
  overlap,
  describeItem,
  riderBox,
  named,
  ANCHORED,
  UNANCHORED,
  bothWays,
  TABLET_VIEWPORTS,
} from './ride-stage';
import { attachSharedPageOnFailure, releaseSharedPage } from './shared-load';
import { AA_LARGE_TEXT_OR_NON_TEXT, AA_TEXT, contrastRatio } from '../src/design/contrast';
import { RIDE_TIME_TARGET_PIXELS } from '../src/design/ride-time-controls';
import { HORIZON_HAZE } from '../src/game/world';

import type { StageItem, StageMeasurement, VoiceMeasurement } from './ride-harness';

// The page the cases below share goes when this file's cases do (`shared-load.ts`).
test.afterAll(releaseSharedPage);
// What a red shared case read, since the `page` fixture's screenshot is not it (#1076).
test.afterEach(async () => {
  await attachSharedPageOnFailure(test.info());
});

/**
 * #1347 — a race's standings on the HUD, `ride-harness.tsx` §`WITH_STANDINGS`:
 * a running race whose room has named nine riders and sent its standings, so
 * the panel is at its widest — seven lines, two of them the longest name a
 * room admits.
 *
 * ## What is held
 *
 * At the three tablet viewports, with anchor positioning and without: the
 * standings panel is on the stage, whole, uncovered, laid over no other panel
 * and **clear of the leaning rider's box**, and shows seven lines. At every
 * other overlay viewport — the phones — it is visually hidden (`theme.css`
 * §"A RACE'S STANDINGS") and still in the document, seven lines, for a screen
 * reader; and no panel the rider can see is over the rider on a tablet.
 *
 * ## The control
 *
 * The same page with the panel moved to the middle of the stage — what a
 * layout that put it under the primary readings' row and centred it would
 * do — is over the rider at every tablet viewport, so "clear of the rider"
 * is a measurement that can fail here.
 */
const WITH_STANDINGS = '?room=standings';

function standingsPanel(seen: StageMeasurement): StageItem {
  const panel = seen.panels.find((each) => each.name.includes('oyl-hud__standings'));
  if (panel === undefined) throw new Error('no standings panel among the HUD panels');
  return panel;
}

test.describe('a race’s standings on the HUD — #1347', () => {
  for (const viewport of OVERLAY_VIEWPORTS) {
    const tablet = TABLET_VIEWPORTS.includes(viewport);
    test(`${tablet ? 'whole, over no panel and clear of the rider' : 'visually hidden, and still there to be read'} — ${viewport.name}`, async ({
      page,
    }) => {
      await openRide(page, viewport, WITH_STANDINGS);
      const lines = await page.locator('.oyl-hud__standings li').count();
      expect(lines).toBe(7);
      for (const [how, seen] of await bothWays(page)) {
        await test.step(how, () => {
          const panel = standingsPanel(seen);
          const rider = riderBox(viewport);
          const over = seen.panels
            .filter((each) => each.box.height > 1)
            .filter((each) => overlap(each.box, rider));
          console.log(
            `#1347 standings — ${viewport.name} — ${how}: ${panel.box.width.toFixed(0)} × ` +
              `${panel.box.height.toFixed(0)} px at [${panel.box.left.toFixed(0)},${panel.box.top.toFixed(0)}]` +
              `, its bottom ${(rider.top - panel.box.bottom).toFixed(0)} px above the rider's box` +
              `, its left ${(panel.box.left - rider.right).toFixed(0)} px right of it` +
              `; panels over the rider: ${over.length === 0 ? 'none' : over.map(describeItem).join(', ')}`,
          );
          if (!tablet) {
            expect(panel.box.width, 'hidden by clip on a phone').toBeLessThanOrEqual(1);
            expect(panel.box.height, 'hidden by clip on a phone').toBeLessThanOrEqual(1);
            return;
          }
          expect(inside(panel.box, viewport), describeItem(panel)).toBe(true);
          expect(panel.onTop, describeItem(panel)).toBe(true);
          expect(panel.box.height).toBeGreaterThan(100);
          const collisions = seen.panels
            .filter((each) => each !== panel && each.box.height > 1)
            .filter((each) => overlap(each.box, panel.box))
            .map(describeItem);
          expect(collisions).toEqual([]);
          expect(over.map(describeItem)).toEqual([]);
        });
      }
    });
  }

  for (const viewport of TABLET_VIEWPORTS) {
    test(`the control — moved to the middle of the stage, it is over the rider — ${viewport.name}`, async ({
      page,
    }) => {
      await openRide(page, viewport, WITH_STANDINGS);
      await page.addStyleTag({
        content:
          '.oyl-game--riding .oyl-hud .oyl-hud__standings { justify-self: center !important; align-self: end !important; }',
      });
      const panel = standingsPanel(await measure(page));
      expect(overlap(panel.box, riderBox(viewport)), describeItem(panel)).toBe(true);
    });
  }
});

/**
 * #789 — *Report* on the HUD, `ride-harness.tsx` §`REPORT_OPEN`: the running
 * race of §"#1347", the rider following the rider *Follow* reaches first —
 * the longest name a room admits — and *Report* pressed, so the actions
 * panel carries *Follow*, *Report* and the three reasons: the room's row at
 * its tallest.
 *
 * ## What is held
 *
 * At every overlay viewport — a rider on a phone has to be able to report
 * too, and the tablet-only standings are not where they can — with anchor
 * positioning and without: each room control shown is on the stage, inside
 * the viewport, uncovered, and at least `.oyl-button`'s 44 px in both axes;
 * *Pause* and *End ride* are still on the stage and uncovered; and the
 * actions panel is over no other panel. At the three tablet viewports no
 * panel is over the leaning rider's box either.
 *
 * ## What is only published
 *
 * The rider's clearance from the actions panel at the phone viewports. (A room
 * ride's HUD was over the rider on a phone with or without a report until
 * #1356; §"#1356" holds the following state, Report closed, clear of it.)
 *
 * **On a phone in LANDSCAPE** (844×390, 736×360, 736×480) the actions panel
 * is capped at 16 rem, so the reasons take the row in place of *Follow* and
 * *Report* (both laid out at no size). Held there as well: the actions panel
 * is no taller open than closed, each reason is 44 px, and *Pause* and *End
 * ride* are exactly where they were before *Report* was pressed (the first
 * version of this row pushed them 53 px further down). Until #1358 that was
 * all that was held there, because following a rider with the longest name a
 * room admits already put *Pause* below a 736×360 stage with Report closed.
 * #1356 fixed the cause, the readings above it, so since #1358 the reasons,
 * *Pause* and *End ride* are held on the stage and uncovered there too, and
 * the actions panel over no other panel. The closed state costs no line
 * anywhere: *Report* shares *Follow*'s row.
 *
 * ## The controls
 *
 * The same race with nobody followed (`?room=standings`) has *Follow* and no
 * *Report* and no reasons, and following with *Report* not pressed
 * (`?room=following`) has *Follow* and *Report* and no reasons — so a case
 * that found them everywhere would not be reading this state. The second is
 * also what "no worse" is measured against.
 */
const REPORT_OPEN = '?room=report';

const FOLLOWING = '?room=following';

const ROOM_REPORT_CONTROLS = [
  'room: Follow the next rider near you',
  'room: Report Wilhelmina Vandersteen-Oduya Mbe',
  'room: Name: an offensive display name',
  'room: Cheating, or riding that cannot be real',
  'room: Other: something else about how they rode',
] as const;

test.describe('Report on the HUD, its reasons open — #789', () => {
  for (const viewport of OVERLAY_VIEWPORTS) {
    const tablet = TABLET_VIEWPORTS.includes(viewport);
    const shortLandscape = viewport.width > viewport.height && !tablet;
    test(`every room control on the stage, uncovered, 44 px${tablet ? ', and no panel over the rider' : ''} — ${viewport.name}`, async ({
      page,
    }) => {
      // The control: nobody followed, so no Report and no reasons.
      await openRide(page, viewport, WITH_STANDINGS);
      const nobody = (await measure(page)).items.map((each) => each.name);
      expect(nobody).toContain(ROOM_REPORT_CONTROLS[0]);
      for (const name of ROOM_REPORT_CONTROLS.slice(1)) expect(nobody).not.toContain(name);

      // The state the reasons open from: following, Report closed.
      await openRide(page, viewport, FOLLOWING);
      const before = await measure(page);
      const closed = before.items.map((each) => each.name);
      const closedActions = before.panels.find((each) => each.name.includes('oyl-hud__actions'));
      const closedPause = named(before.items, 'control: Pause');
      console.log(
        `#789 following, Report closed — ${viewport.name}: Pause ${describeItem(closedPause)}; the actions panel ` +
          `${closedActions?.box.width.toFixed(0) ?? '?'} × ${closedActions?.box.height.toFixed(0) ?? '?'} px at ` +
          `[${closedActions?.box.left.toFixed(0) ?? '?'},${closedActions?.box.top.toFixed(0) ?? '?'}]`,
      );
      expect(closed.slice().filter((name) => name.startsWith('room: '))).toEqual(
        ROOM_REPORT_CONTROLS.slice(0, 2),
      );

      await openRide(page, viewport, REPORT_OPEN);
      for (const [how, seen] of await bothWays(page)) {
        await test.step(how, () => {
          const actions = seen.panels.find((each) => each.name.includes('oyl-hud__actions'));
          if (actions === undefined) throw new Error('no actions panel');
          const rider = riderBox(viewport);
          const over = seen.panels
            .filter((each) => each.box.height > 1)
            .filter((each) => overlap(each.box, rider));
          console.log(
            `#789 Report open — ${viewport.name} — ${how}: the actions panel ` +
              `${actions.box.width.toFixed(0)} × ${actions.box.height.toFixed(0)} px at ` +
              `[${actions.box.left.toFixed(0)},${actions.box.top.toFixed(0)}], its top ` +
              `${(actions.box.top - rider.bottom).toFixed(0)} px below the rider's box; ` +
              `panels over the rider: ${over.length === 0 ? 'none' : over.map(describeItem).join(', ')}`,
          );
          for (const name of ['control: Pause', 'control: End ride']) {
            const control = named(seen.items, name);
            if (shortLandscape) {
              // No worse than following: exactly where it was before Report
              // was pressed.
              const was = named(before.items, name);
              for (const edge of ['left', 'top', 'right', 'bottom'] as const) {
                expect(
                  Math.abs(control.box[edge] - was.box[edge]),
                  `${name} ${edge}`,
                ).toBeLessThanOrEqual(SUBPIXEL_TOLERANCE);
              }
            }
            expect(inside(control.box, viewport), describeItem(control)).toBe(true);
            expect(control.onTop, describeItem(control)).toBe(true);
          }
          // On a phone on its side the reasons take the row in place of
          // Follow and Report (`theme.css` §"#789 on a phone on its side").
          const shown = shortLandscape ? ROOM_REPORT_CONTROLS.slice(2) : ROOM_REPORT_CONTROLS;
          if (shortLandscape) {
            for (const name of ROOM_REPORT_CONTROLS.slice(0, 2)) {
              const hidden = named(seen.items, name);
              expect(hidden.box.width * hidden.box.height, describeItem(hidden)).toBe(0);
            }
          }
          const room = shown.map((name) => named(seen.items, name));
          for (const control of room) {
            expect(control.box.width, control.name).toBeGreaterThanOrEqual(44 - SUBPIXEL_TOLERANCE);
            expect(control.box.height, control.name).toBeGreaterThanOrEqual(
              44 - SUBPIXEL_TOLERANCE,
            );
          }
          const collisions = seen.panels
            .filter((each) => each !== actions && each.box.height > 1)
            .filter((each) => overlap(each.box, actions.box))
            .map(describeItem);
          if (shortLandscape) {
            // No taller open than closed: the reasons cost the panel no line.
            expect(
              actions.box.height,
              `the actions panel open (${actions.box.height.toFixed(0)} px) against closed ` +
                `(${closedActions?.box.height.toFixed(0) ?? '?'} px)`,
            ).toBeLessThanOrEqual((closedActions?.box.height ?? 0) + SUBPIXEL_TOLERANCE);
          }
          for (const control of room) {
            expect(inside(control.box, viewport), describeItem(control)).toBe(true);
            expect(control.onTop, describeItem(control)).toBe(true);
          }
          expect(collisions).toEqual([]);
          if (tablet) expect(over.map(describeItem)).toEqual([]);
        });
      }
    });
  }
});

/**
 * #1356 — a room ride's HUD at every overlay viewport: the race of §"#1347",
 * the rider following the rider with the longest name a room admits
 * (`?room=following`), so the secondary tier carries the room's three
 * readings — *Following* under that name, *Nearby* and *Draft* — beside a
 * pacer, a ghost and a wind, and the actions panel carries *Follow* and
 * *Report*. It is the widest room ride the harness can start.
 *
 * ## What is held
 *
 * Both ways (with anchor positioning and without): every panel a rider can
 * see is whole and over no other panel, and none is over the leaning rider —
 * the two cases every ride above is held to. The room's three readings are
 * on the stage and uncovered. On a phone the pacer's, the ghost's and the
 * wind's readings are laid out at no size and still in the secondary list
 * (`theme.css` §"A ROOM RIDE ON A PHONE", the trade #419 asks to have
 * recorded); on a tablet they are on the stage like every other reading.
 *
 * Until #1358 the bottom row on a phone on its side was excused here: on the
 * CI runner's fonts *Follow* and *Report* ran it a few pixels below the
 * stage. It is held whole with the rest now (§"#1358").
 *
 * ## The control
 *
 * The same page with that rule undone — the three readings back in the grid
 * and the followed rider's name free to wrap, the HUD as #783 and #789 left
 * it — is over the rider at 736×360 and at 360×752, the two viewports #1347's
 * run printed. So "no panel over the rider" can fail for a room ride.
 */
const ROOM_GIVES_WAY = ['reading: Pacer', 'reading: Your best', 'reading: Wind'] as const;

const ROOM_READINGS = [
  'reading: Wilhelmina Vandersteen-Oduya Mbe',
  'reading: Nearby',
  'reading: Draft',
] as const;

const ROOM_RULE_UNDONE = `
  .oyl-game--riding .oyl-hud .oyl-hud__fields--secondary > .oyl-hud__field--gives-way {
    position: static !important; width: auto !important; height: auto !important;
    margin: 0 !important; overflow: visible !important; clip-path: none !important;
    white-space: normal !important;
  }
  .oyl-game--riding .oyl-hud .oyl-hud__field--room .oyl-hud__label {
    overflow: visible !important; white-space: normal !important;
  }`;

/** The panels a rider can see: on a phone the race's standings are a 1 px clipped box. */
function seenPanels(seen: StageMeasurement): readonly StageItem[] {
  return seen.panels.filter((each) => each.box.height > 1);
}

test.describe('a room ride’s HUD — #1356', () => {
  for (const viewport of OVERLAY_VIEWPORTS) {
    const tablet = TABLET_VIEWPORTS.includes(viewport);
    test.describe(viewport.name, () => {
      test('every panel is whole, and no panel is laid over another', async ({ browser }) => {
        const page = await sharedRide(browser, viewport, FOLLOWING);
        for (const [how, seen] of await bothWays(page)) {
          const panels = seenPanels(seen);
          expect(panels.length, how).toBeGreaterThanOrEqual(4);
          expect(
            panels.filter((each) => !inside(each.box, viewport)).map(describeItem),
            how,
          ).toEqual([]);
          const collisions: string[] = [];
          panels.forEach((a, index) => {
            for (const b of panels.slice(index + 1)) {
              if (overlap(a.box, b.box)) collisions.push(`${describeItem(a)} × ${describeItem(b)}`);
            }
          });
          expect(collisions, how).toEqual([]);
        }
      });

      test('no panel is laid over the rider', async ({ browser }) => {
        const page = await sharedRide(browser, viewport, FOLLOWING);
        const rider = riderBox(viewport);
        for (const [how, seen] of await bothWays(page)) {
          const over = seenPanels(seen).filter((each) => overlap(each.box, rider));
          expect(over.map(describeItem), how).toEqual([]);
        }
      });

      test(`the room’s readings are on the stage${tablet ? ', and so is every other' : ', and the pacer, the ghost and the wind give way'}`, async ({
        browser,
      }) => {
        const page = await sharedRide(browser, viewport, FOLLOWING);
        for (const [how, seen] of await bothWays(page)) {
          for (const name of ROOM_READINGS) {
            const reading = named(seen.items, name);
            expect(inside(reading.box, viewport), `${how}: ${describeItem(reading)}`).toBe(true);
            expect(reading.onTop, `${how}: ${describeItem(reading)}`).toBe(true);
          }
          for (const name of ROOM_GIVES_WAY) {
            const reading = named(seen.items, name);
            if (tablet) {
              expect(inside(reading.box, viewport), `${how}: ${describeItem(reading)}`).toBe(true);
              expect(reading.onTop, `${how}: ${describeItem(reading)}`).toBe(true);
            } else {
              expect(reading.box.width * reading.box.height, `${how}: ${name}`).toBeLessThanOrEqual(
                1,
              );
            }
          }
          // Laid out at no size, and still in the list a screen reader reads.
          expect(seen.secondary, how).toEqual([
            'Speed',
            'To go',
            'Moving',
            // #2072: in the primary panel's clock row on the stage.
            'Elapsed',
            'Clock',
            'Pacer',
            'Your best',
            'Wilhelmina Vandersteen-Oduya Mbe',
            'Nearby',
            'Draft',
            'Wind',
          ]);
        }
      });
    });
  }

  for (const viewport of OVERLAY_VIEWPORTS.filter(
    (each) => (each.width === 736 && each.height === 360) || each.height === 752,
  )) {
    test(`the control — with the rule undone, a panel is over the rider — ${viewport.name}`, async ({
      page,
    }) => {
      await openRide(page, viewport, FOLLOWING);
      await page.addStyleTag({ content: ROOM_RULE_UNDONE });
      const seen = await measure(page);
      const pacer = named(seen.items, 'reading: Pacer');
      expect(pacer.box.width * pacer.box.height, 'the rule undone').toBeGreaterThan(1);
      const over = seenPanels(seen).filter((each) => overlap(each.box, riderBox(viewport)));
      expect(over.map(describeItem)).not.toEqual([]);
    });
  }
});

/**
 * #1358 — a room ride with a rider near, so the actions panel carries
 * *Follow*: `?room=standings` (nobody followed yet) and `?room=following`
 * (*Follow* and *Report*, the longest name a room admits as the gap's label).
 *
 * ## What is held
 *
 * At every overlay viewport, both ways (#1120): every panel a rider can see
 * is whole and over no other, and every reading and every control — the
 * readings, the elevation strip, the plan view, the trainer line, *Pause*,
 * *End ride*, *Follow* and *Report* — is inside the viewport, uncovered, with
 * nothing scrolled. Two exceptions, each a recorded trade and each held to
 * it here: on a phone the pacer's, the ghost's and the wind's readings are
 * laid out at no size (§"#1356"), and on a phone on its side so is the
 * trainer line (`theme.css` §"*Follow* ON A PHONE ON ITS SIDE").
 *
 * ## The cause, and the controls
 *
 * #1358 guessed that *Follow* made the bottom row too tall for a 736×360
 * stage. On a Mac's fonts it was not: with #1356's rule undone (the HUD as
 * #783 and #789 left it) and the room's row — *Follow* and *Report* — taken
 * out, 736×360 still puts the plan view, *Pause* and *End ride* below the
 * stage. The secondary panel's third row pushed the bottom row down. On
 * `?room=standings` that holds only while the readings' phrases make that
 * row 216 px rather than 202 (it moved with the ride's values under load),
 * so the first control is `?room=following`, whose followed name makes it
 * 256 px on every run.
 *
 * With #1356, *Follow* fitted on a Mac and not on the CI runner, whose fonts
 * set the trainer line on two lines: the actions panel was 204 px and the
 * bottom row ran 9 px below a 736×360 stage and 4 px below an 844×390 one
 * (run 38927851553). So the second control puts the trainer line back, two
 * lines tall as the runner sets it, and requires the bottom row to leave a
 * 736×360 stage again, on any machine's fonts.
 */
const ROOM_WITH_A_RIDER_NEAR = [WITH_STANDINGS, FOLLOWING] as const;

const TRAINER_LINE = 'the trainer line';

/** A phone on its side: the short corners layout (`theme.css` §"A SHORT corners layout"). */
function onItsSide(viewport: Viewport): boolean {
  return viewport.width >= 736 && viewport.height >= 360 && viewport.height <= 480;
}

function lostFromTheStage(seen: StageMeasurement, viewport: Viewport): string[] {
  const phone = !TABLET_VIEWPORTS.includes(viewport);
  const givesWay = [
    ...(phone ? ROOM_GIVES_WAY : []),
    ...(onItsSide(viewport) ? [TRAINER_LINE] : []),
  ] as readonly string[];
  return seen.items
    .filter((each) => !givesWay.includes(each.name))
    .filter((each) => !inside(each.box, viewport) || !each.onTop)
    .map(describeItem);
}

test.describe('a room ride with a rider near, every reading and control on the stage — #1358', () => {
  for (const viewport of OVERLAY_VIEWPORTS) {
    for (const query of ROOM_WITH_A_RIDER_NEAR) {
      test(`${query} — ${viewport.name}`, async ({ browser }) => {
        const page = await sharedRide(browser, viewport, query);
        for (const [how, seen] of await bothWays(page)) {
          expect(seen.scrollY, how).toBe(0);
          expect(seen.stageScrollTop, how).toBe(0);
          expect(seen.pageOverflow, how).toBeLessThanOrEqual(0);
          const names = seen.items.map((each) => each.name);
          // The state this is about: a rider near, so Follow is on the HUD.
          expect(names, how).toContain('room: Follow the next rider near you');
          expect(names, how).toContain('the plan view');
          expect(lostFromTheStage(seen, viewport), how).toEqual([]);
          const panels = seenPanels(seen);
          expect(
            panels.filter((each) => !inside(each.box, viewport)).map(describeItem),
            how,
          ).toEqual([]);
          const collisions: string[] = [];
          panels.forEach((a, index) => {
            for (const b of panels.slice(index + 1)) {
              if (overlap(a.box, b.box)) collisions.push(`${describeItem(a)} × ${describeItem(b)}`);
            }
          });
          expect(collisions, how).toEqual([]);
          // The trade, and only where it is made.
          const line = named(seen.items, TRAINER_LINE);
          if (onItsSide(viewport)) {
            expect(
              line.box.width * line.box.height,
              `${how}: ${describeItem(line)}`,
            ).toBeLessThanOrEqual(1);
          } else {
            expect(line.box.height, `${how}: ${describeItem(line)}`).toBeGreaterThan(1);
          }
        }
      });
    }
  }

  test('the control — Follow and Report taken out, the layout before #1356 still runs off a 736×360 stage', async ({
    page,
  }) => {
    const viewport = OVERLAY_VIEWPORTS.find(
      (each) => each.width === 736 && each.height === 360,
    ) as Viewport;
    await openRide(page, viewport, FOLLOWING);
    await page.addStyleTag({
      content: `${ROOM_RULE_UNDONE}
        .oyl-game--riding .oyl-hud .oyl-hud__room-row { display: none !important; }`,
    });
    const seen = await measure(page);
    for (const name of ROOM_REPORT_CONTROLS.slice(0, 2)) {
      const taken = named(seen.items, name);
      expect(taken.box.width * taken.box.height, `${name}: taken out`).toBe(0);
    }
    const lost = lostFromTheStage(seen, viewport).filter(
      (each) => !each.startsWith('room: ') && !each.startsWith('reading: '),
    );
    console.log(
      `#1358 cause — Follow and Report taken out, #1356 undone, 736×360: ${lost.join('; ')}`,
    );
    expect(lost.some((each) => each.startsWith('the plan view'))).toBe(true);
    expect(lost.some((each) => each.startsWith('control: Pause'))).toBe(true);
  });

  test('the control — the trainer line back, on two lines, runs the bottom row off a 736×360 stage', async ({
    page,
  }) => {
    const viewport = OVERLAY_VIEWPORTS.find(
      (each) => each.width === 736 && each.height === 360,
    ) as Viewport;
    await openRide(page, viewport, FOLLOWING);
    await page.addStyleTag({
      content: `
        .oyl-game--riding .oyl-hud .oyl-hud__actions > .oyl-hud__trainer {
          position: static !important; width: auto !important; height: auto !important;
          margin: 0 !important; overflow: visible !important; clip-path: none !important;
          white-space: normal !important; min-height: 2lh !important;
        }`,
    });
    const seen = await measure(page);
    const line = named(seen.items, TRAINER_LINE);
    expect(line.box.height, 'the trainer line put back').toBeGreaterThan(30);
    const notWhole = seenPanels(seen)
      .filter((each) => !inside(each.box, viewport))
      .map(describeItem);
    console.log(`#1358 — the trainer line back, two lines, 736×360: ${notWhole.join('; ')}`);
    expect(notWhole.some((each) => each.includes('oyl-hud__actions'))).toBe(true);
  });
});

/**
 * #1398 — a room ride with sounds on: `?room=following&sounds=on`, so the
 * actions panel carries the room's row (*Follow* and *Report*, #789) and
 * #400's mute and volume together.
 *
 * ## What is held
 *
 * At every overlay viewport, both ways (#1120), what §"#1358" holds of a room
 * ride — nothing scrolled, every reading and control inside the viewport and
 * uncovered with that section's two recorded trades, every panel whole and
 * over no other — and, as §"#1356" does, no panel over the leaning rider. The
 * mute and the volume are among the controls held. Where `theme.css`
 * §"A ROOM RIDE WITH SOUNDS ON, ON A PHONE" lifts the sound row out of the
 * actions panel (a phone on its side, a tablet) it is held as a panel of its
 * own, and everywhere else it is held inside the actions panel.
 *
 * ## The cause, and the control
 *
 * Before #1398, on the CI runner's fonts, the actions panel ran 7 px below a
 * 736×360 stage and 3 px below an 844×390 one, reached 7 px into the race's
 * standings at 1024×768, and started 24 px into the leaning rider at 360×752
 * and 10 px into him at 360×800. The control undoes the block and requires
 * the same measurement to fail at 736×360, 1024×768 and 360×752.
 *
 * Not held here: the same ride with *Report*'s reasons open, and a race
 * waiting on its start line with sounds on. §"#1407" holds both.
 */
const FOLLOWING_WITH_SOUNDS = `${FOLLOWING}&sounds=on`;

const SOUND_ROW = 'oyl-sound';

/** Where `theme.css` §"#1398" lifts the sound row out of the actions panel. */
function soundRowLifted(viewport: Viewport): boolean {
  return onItsSide(viewport) || TABLET_VIEWPORTS.includes(viewport);
}

function roomWithSoundsFailures(seen: StageMeasurement, viewport: Viewport): string[] {
  const panels = seenPanels(seen);
  const found = lostFromTheStage(seen, viewport);
  found.push(...panels.filter((each) => !inside(each.box, viewport)).map(describeItem));
  panels.forEach((a, index) => {
    for (const b of panels.slice(index + 1)) {
      if (overlap(a.box, b.box)) found.push(`${describeItem(a)} × ${describeItem(b)}`);
    }
  });
  const rider = riderBox(viewport);
  found.push(
    ...panels
      .filter((each) => overlap(each.box, rider))
      .map((each) => `${describeItem(each)} over the rider`),
  );
  return found;
}

test.describe('a room ride with sounds on — #1398', () => {
  for (const viewport of OVERLAY_VIEWPORTS) {
    test(`every panel whole and clear of the rider, every reading and control on the stage — ${viewport.name}`, async ({
      browser,
    }) => {
      const page = await sharedRide(browser, viewport, FOLLOWING_WITH_SOUNDS);
      for (const [how, seen] of await bothWays(page)) {
        // The state this is about: the room's row and the sound row, both.
        const names = seen.items.map((each) => each.name);
        expect(names, how).toContain('room: Follow the next rider near you');
        expect(names, how).toContain('room: Report Wilhelmina Vandersteen-Oduya Mbe');
        expect(names, how).toContain('sound: Mute sounds');
        expect(names, how).toContain('sound: Sound volume');
        expect(seen.scrollY, how).toBe(0);
        expect(seen.stageScrollTop, how).toBe(0);
        expect(seen.pageOverflow, how).toBeLessThanOrEqual(0);
        const panels = seenPanels(seen);
        console.log(`#1398 — ${viewport.name} — ${how}: ${panels.map(describeItem).join('; ')}`);
        expect(
          panels.some((each) => each.name === SOUND_ROW),
          `${how}: the sound row a panel of its own`,
        ).toBe(soundRowLifted(viewport));
        expect(roomWithSoundsFailures(seen, viewport), how).toEqual([]);
      }
    });
  }

  // ⚠️ #1409: the 1024×768 control depends on the CI runner's fonts. What it
  // finds there is the actions panel 7 px into the race's standings, a
  // margin narrower glyphs may close, so on another machine's fonts that
  // control may find nothing and fail. Measured only on the runner's fonts,
  // as are the other two: 7 px off the stage at 736×360 and 24 px into the
  // rider at 360×752.
  // ⚠️ #2041 closed that 7 px: the HUD's numbers are Barlow with tabular
  // figures (ADR 0063 D-5), narrower than the system face, and on CI's fonts
  // the 1024×768 control then found nothing. So 1024×768 is no longer a
  // control here; the case above still holds it.
  for (const viewport of OVERLAY_VIEWPORTS.filter((each) =>
    ['736×360', '360×752'].includes(`${String(each.width)}×${String(each.height)}`),
  )) {
    test(`the control — with the block undone, the same measurement fails — ${viewport.name}`, async ({
      page,
    }) => {
      await openRide(page, viewport, FOLLOWING_WITH_SOUNDS);
      await page.addStyleTag({
        content: `
          .oyl-game--riding .oyl-hud .oyl-hud__actions { flex-flow: column nowrap !important; }
          .oyl-game--riding .oyl-hud .oyl-hud__actions > * { flex: initial !important; }
          .oyl-game--riding .oyl-hud .oyl-hud__actions > .oyl-sound {
            position: static !important; padding: 0 !important; border: 0 !important;
            width: auto !important; background: none !important;
          }
          .oyl-game--riding .oyl-hud .oyl-sound__mute-more {
            position: static !important; width: auto !important; height: auto !important;
            margin: 0 !important; overflow: visible !important; clip-path: none !important;
          }`,
      });
      const seen = await measure(page);
      expect(
        seenPanels(seen).some((each) => each.name === SOUND_ROW),
        'the block undone',
      ).toBe(false);
      const failures = roomWithSoundsFailures(seen, viewport);
      console.log(`#1398 control — ${viewport.name}: ${failures.join('; ')}`);
      expect(failures).not.toEqual([]);
    });
  }
});

/**
 * #1407 — the two room rides with sounds on that §"#1398" left over:
 * *Report*'s reasons open (`?room=report&sounds=on`) and a race waiting on
 * its start line (`?room=race&sounds=on`: the room's maker's notice, with
 * *Start the race*, and no room row) — and, since #875, that race with the
 * room's Discord voice link as its notice's last line
 * (`?room=race-voice&sounds=on`, {@link RACE_VOICE_WITH_SOUNDS}).
 *
 * ## What is held
 *
 * What §"#1398" holds, at every overlay viewport and both ways (#1120):
 * nothing scrolled, every reading and control inside the viewport and
 * uncovered, every panel whole, over no other and not over the leaning rider.
 * Each thing that gives way is held to giving way exactly where `theme.css`
 * records it, and nowhere else:
 *
 * - *Follow* and *Report* while the reasons are open, on a phone on its side
 *   (§"#789 on a phone on its side") and, since #1407, on an upright phone;
 * - the volume while the reasons are open, on an upright phone (§"#1407");
 * - the route panel's elevation strip and plan view while the race's notice
 *   stands in its cell on a phone (#437).
 *
 * The three reasons are held whole (no visible word clipped) and 44 px.
 *
 * ## The cause, and the control
 *
 * On `main` after #1398, on the CI runner's fonts, the open reasons put the
 * actions panel 69 px into the leaning rider at 360×752, 55 px at 360×800 and
 * 42 px at 390×844, and the race ran its actions panel and its notice 7 px
 * below a 736×360 stage. The control undoes §"#1407" and requires the same
 * measurement to fail at 360×752 and at 736×360.
 */
const REPORT_WITH_SOUNDS = `${REPORT_OPEN}&sounds=on`;

const RACE_WITH_SOUNDS = '?room=race&sounds=on';

/**
 * #875: the same race on its line, its welcome carrying the room's Discord
 * voice link, which `GameView` draws as a button beside *Start the race*
 * (`game/room-voice.ts`). Held to everything `?room=race&sounds=on` is, both
 * ways; §"#875" holds the button itself.
 */
const RACE_VOICE_WITH_SOUNDS = '?room=race-voice&sounds=on';

const VOLUME = 'sound: Sound volume';

/** `REPORT_REASONS_MS` in `RoomReport.tsx`: the reasons close by themselves. */
const REPORT_REASONS_TIMEOUT_MS = 15_000;

const ROUTE_READINGS = ['the elevation strip', 'the plan view'] as const;

/** What `theme.css` records as giving way in this state at this viewport. */
function givesWayIn1407(query: string, viewport: Viewport): readonly string[] {
  const phone = !TABLET_VIEWPORTS.includes(viewport);
  if (query === RACE_WITH_SOUNDS || query === RACE_VOICE_WITH_SOUNDS) {
    return phone ? ROUTE_READINGS : [];
  }
  if (!phone) return [];
  return onItsSide(viewport)
    ? ROOM_REPORT_CONTROLS.slice(0, 2)
    : [...ROOM_REPORT_CONTROLS.slice(0, 2), VOLUME];
}

/**
 * §"#1398"'s findings less the recorded trades, each of which must be laid
 * out at no size (or clipped to 1 px): a trade that stopped being one is a
 * finding too.
 *
 * A finding is dropped by the NAME it starts with, and only for an item that
 * did give way (a box of at most 1 px²): such an item is off the stage or
 * covered by construction, and nobody sees it. An item recorded as giving way
 * that is still laid out keeps every finding about it, and adds "not given
 * way".
 */
function failuresGivingWay(
  seen: StageMeasurement,
  viewport: Viewport,
  givesWay: readonly string[],
): string[] {
  const gone: string[] = [];
  const found: string[] = [];
  for (const name of givesWay) {
    const item = named(seen.items, name);
    if (item.box.width * item.box.height > 1) found.push(`${describeItem(item)} not given way`);
    else gone.push(name);
  }
  found.unshift(
    ...roomWithSoundsFailures(seen, viewport).filter(
      (each) => !gone.some((name) => each.startsWith(`${name} [`)),
    ),
  );
  return found;
}

/** Each open reason whose visible word is clipped, and by how much. */
async function reasonsClipped(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll('.oyl-hud__report-reasons > button')]
      .filter((each) => each.scrollWidth > each.clientWidth)
      .map(
        (each) =>
          `${each.textContent ?? ''}: ${String(each.scrollWidth)} px in ${String(each.clientWidth)}`,
      ),
  );
}

test.describe('Report’s reasons open, and a race on its start line, with sounds on — #1407', () => {
  for (const query of [REPORT_WITH_SOUNDS, RACE_WITH_SOUNDS, RACE_VOICE_WITH_SOUNDS]) {
    for (const viewport of OVERLAY_VIEWPORTS) {
      test(`${query}: every panel whole and clear of the rider, every reading and control on the stage — ${viewport.name}`, async ({
        browser,
      }) => {
        const page = await sharedRide(browser, viewport, query);
        const clippedAnchored = query === REPORT_WITH_SOUNDS ? await reasonsClipped(page) : [];
        const ways = await bothWays(page);
        // After `bothWays` the page is laid out without anchor positioning.
        const clippedUnanchored = query === REPORT_WITH_SOUNDS ? await reasonsClipped(page) : [];
        expect(clippedAnchored, ANCHORED).toEqual([]);
        expect(clippedUnanchored, UNANCHORED).toEqual([]);
        for (const [how, seen] of ways) {
          // The state this is about.
          const names = seen.items.map((each) => each.name);
          expect(names, how).toContain('sound: Mute sounds');
          expect(names, how).toContain(VOLUME);
          if (query === REPORT_WITH_SOUNDS) {
            for (const name of ROOM_REPORT_CONTROLS) expect(names, how).toContain(name);
            for (const name of ROOM_REPORT_CONTROLS.slice(2)) {
              const reason = named(seen.items, name);
              expect(reason.box.width, `${how}: ${describeItem(reason)}`).toBeGreaterThanOrEqual(
                44 - SUBPIXEL_TOLERANCE,
              );
              expect(reason.box.height, `${how}: ${describeItem(reason)}`).toBeGreaterThanOrEqual(
                44 - SUBPIXEL_TOLERANCE,
              );
            }
          } else {
            expect(
              names.filter((name) => name.startsWith('room: ')),
              how,
            ).toEqual([]);
          }
          expect(seen.scrollY, how).toBe(0);
          expect(seen.stageScrollTop, how).toBe(0);
          expect(seen.pageOverflow, how).toBeLessThanOrEqual(0);
          const panels = seenPanels(seen);
          console.log(
            `#1407 — ${query} — ${viewport.name} — ${how}: ${panels.map(describeItem).join('; ')}`,
          );
          expect(
            panels.some((each) => each.name === SOUND_ROW),
            `${how}: the sound row a panel of its own`,
          ).toBe(soundRowLifted(viewport));
          expect(failuresGivingWay(seen, viewport, givesWayIn1407(query, viewport)), how).toEqual(
            [],
          );
        }
      });
    }
  }

  for (const viewport of OVERLAY_VIEWPORTS) {
    for (const way of ['Escape', 'timeout'] as const) {
      test(`closing the reasons by ${way} returns focus to Report (WCAG 2.4.3) — ${viewport.name}`, async ({
        page,
      }) => {
        // The timeout is `RoomReport.tsx`'s `setTimeout`: a clock installed
        // before the load lets the case jump past it rather than wait 16 s at
        // every viewport, which pushed the shard past its global timeout.
        if (way === 'timeout') await page.clock.install();
        await openRide(page, viewport, REPORT_WITH_SOUNDS);
        await page.locator('.oyl-hud__report-reasons > button').first().focus();
        if (way === 'Escape') await page.keyboard.press('Escape');
        else await page.clock.fastForward(REPORT_REASONS_TIMEOUT_MS + 1_000);
        await expect(page.locator('.oyl-hud__report-reasons')).toHaveCount(0);
        const active = await page.evaluate(
          () => document.activeElement?.className ?? document.activeElement?.tagName,
        );
        expect(active).toContain('oyl-hud__report');
      });
    }
  }

  for (const [query, size] of [
    [REPORT_WITH_SOUNDS, '360×752'],
    [RACE_WITH_SOUNDS, '736×360'],
  ] as const) {
    const viewport = OVERLAY_VIEWPORTS.find(
      (each) => `${String(each.width)}×${String(each.height)}` === size,
    ) as Viewport;
    test(`the control — with §"#1407" undone, the same measurement fails — ${query} — ${viewport.name}`, async ({
      page,
    }) => {
      await openRide(page, viewport, query);
      await page.addStyleTag({
        content: `
          .oyl-game--riding .oyl-hud .oyl-hud__room-row > :is(.oyl-hud__follow, .oyl-hud__report) {
            display: inline-flex !important;
          }
          .oyl-game--riding .oyl-hud .oyl-hud__report-reasons { flex-wrap: wrap !important; }
          .oyl-game--riding .oyl-hud .oyl-sound > .oyl-sound__volume { display: flex !important; }
          .oyl-game--riding .oyl-hud:has(.oyl-hud__race) .oyl-hud__actions > .oyl-sound {
            position: static !important; padding: 0 !important; border: 0 !important;
            width: auto !important; background: none !important;
          }
          .oyl-game--riding .oyl-hud .oyl-hud__actions:has(.oyl-hud__report-reasons) > .oyl-sound {
            flex-basis: 8rem !important;
          }`,
      });
      const seen = await measure(page);
      const failures = roomWithSoundsFailures(seen, viewport).filter(
        (each) => !givesWayIn1407(query, viewport).some((name) => each.startsWith(`${name} [`)),
      );
      console.log(`#1407 control — ${query} — ${viewport.name}: ${failures.join('; ')}`);
      expect(failures).not.toEqual([]);
    });
  }
});

/**
 * #875 — a race's *Join voice on Discord* on its start line
 * (`?room=race-voice&sounds=on`), the owner's ruling of 2026-11-04: *"Make it
 * a button first."* `theme.css` §"A RACE'S VOICE BUTTON, ON ITS LINE".
 *
 * ## What is held
 *
 * Where `theme.css` shows it — 47 rem tall or more (the tablets and the
 * upright phones), and 64 rem wide or more at any height over 30 rem (the
 * laptops: 1280×720 and 1024×600, measured here though neither is an overlay
 * viewport of the other specs) — both ways (#1120):
 *
 * - **a target**: the link's box at least 48 × 48 (the owner's ride-time
 *   size, `design/ride-time-controls.ts` §`RIDE_TIME_TARGET_PIXELS`), drawn
 *   as a secondary button at that size, the topmost thing at its centre and
 *   2 px inside each corner, its words exactly the approved ones, none
 *   running out of its box and each half on one line, still a link to the
 *   room's invite;
 * - **on a panel that reads over a bright sky**: the panel's computed
 *   background opaque and at least 3:1 (WCAG 2.2 SC 1.4.11) against the
 *   world's brightest sky, its horizon haze (`game/world.ts`
 *   §`HORIZON_HAZE`); the button's own fill opaque, and its label at least
 *   4.5:1 on it;
 * - **in its place**: inside the viewport and the notice cell, beside
 *   *Start the race* (no lower than its row and no more than a tenth
 *   taller, and *Start the race* still its one 48 px line), over neither the race's notice
 *   nor *Start the race*, over no other panel, and not over the leaning
 *   rider's box (`game/camera.ts` §`riderFrameBox`).
 *
 * On a phone on its side (736×360, 844×390, 736×480) and at 802×600, under
 * 64 rem wide and under 47 rem tall, it is laid out at no size: the recorded
 * trade.
 *
 * ## The controls
 *
 * Each undoes one half and requires the same measurement to fail: the link
 * drawn as the bare text it replaced (a target under 48 px); the panel and
 * the button drawn with no fill (no contrast with the sky); the button shown
 * on a 736×360 phone on its side (squeezed beside *Start the race* into
 * 107 px, its words run out of it: measured 26 px); and, at
 * 360×752, the button put under *Start the race* rather than beside it
 * (over the rider).
 */
const VOICE_WORDS = 'Join voice on Discord (opens Discord)';

/** The fake invite `ride-harness.tsx` §`RACE_VOICE`'s welcome carries. */
const VOICE_INVITE = 'https://discord.gg/example';

/**
 * How much taller than *Start the race* the button may be: two lines at the
 * HUD's 1.2 leading come to 50 px beside its 48.
 */
const VOICE_ROW_SLACK = 1.1;

/**
 * Where the button is shown (`theme.css`): 47 rem tall or more, or 64 rem
 * wide or more and over 30 rem tall.
 */
function voiceShown(viewport: Viewport): boolean {
  return viewport.height >= 752 || (viewport.width >= 1024 && viewport.height > 480);
}

/**
 * The overlay viewports, and the band between 30 and 47 rem tall that none of
 * them is in (review 5777449216 on #2141): the two edges of the wide screens
 * the button is shown on there, and 802×600, which it is not.
 */
const VOICE_VIEWPORTS: readonly Viewport[] = [
  ...OVERLAY_VIEWPORTS,
  { name: 'a laptop — 1280×720', width: 1280, height: 720, unstagedFails: true },
  { name: 'the narrowest wide screen — 1024×600', width: 1024, height: 600, unstagedFails: true },
  {
    name: 'under 64 rem wide and under 47 rem tall — 802×600',
    width: 802,
    height: 600,
    unstagedFails: true,
  },
];

/** The colour a computed `rgb()`/`rgba()` names, as hex, and its alpha. */
function hexOf(computed: string): { readonly hex: string; readonly alpha: number } {
  const parts = /^rgba?\(([^)]*)\)$/
    .exec(computed)?.[1]
    ?.split(/[\s,/]+/)
    .filter(Boolean);
  if (parts === undefined || parts.length < 3) {
    throw new Error(`not a computed rgb() colour: ${computed}`);
  }
  const hex = parts
    .slice(0, 3)
    .map((each) => Math.round(Number(each)).toString(16).padStart(2, '0'))
    .join('');
  return { hex: `#${hex}`, alpha: parts[3] === undefined ? 1 : Number(parts[3]) };
}

const SKY = `#${HORIZON_HAZE.toString(16).padStart(6, '0')}`;

function voiceOf(seen: StageMeasurement, how: string): VoiceMeasurement {
  expect(seen.voice, `${how}: no voice button on the race's line`).toBeDefined();
  return seen.voice as VoiceMeasurement;
}

/** The button as a target a rider can press. */
function voiceTargetFailures(voice: VoiceMeasurement): string[] {
  const found: string[] = [];
  const { box } = voice.button;
  const minimum = RIDE_TIME_TARGET_PIXELS - SUBPIXEL_TOLERANCE;
  if (box.width < minimum || box.height < minimum) {
    found.push(`${describeItem(voice.button)} under ${String(RIDE_TIME_TARGET_PIXELS)} px`);
  }
  for (const each of ['oyl-button', 'oyl-button--secondary', 'oyl-button--ride']) {
    if (!voice.classes.split(/\s+/).includes(each)) found.push(`not drawn as ${each}`);
  }
  if (!voice.button.onTop || !voice.cornersOnTop) {
    found.push(`${describeItem(voice.button)} not wholly the topmost thing`);
  }
  if (voice.overflow > SUBPIXEL_TOLERANCE) {
    found.push(`its words run ${voice.overflow.toFixed(0)} px out of the button`);
  }
  if (voice.halfLines.length !== 2 || voice.halfLines.some((lines) => lines !== 1)) {
    found.push(`its two halves set on ${voice.halfLines.join(' and ')} lines, not one each`);
  }
  return found;
}

/** The panel against a bright sky, and the label on the button. */
function voiceContrastFailures(voice: VoiceMeasurement): string[] {
  const found: string[] = [];
  const panel = hexOf(voice.panelBackground);
  const fill = hexOf(voice.fill);
  const label = hexOf(voice.label);
  if (panel.alpha < 1) found.push(`the panel is not opaque: ${voice.panelBackground}`);
  else if (contrastRatio(panel.hex, SKY) < AA_LARGE_TEXT_OR_NON_TEXT) {
    found.push(`the panel ${panel.hex} is ${contrastRatio(panel.hex, SKY).toFixed(2)}:1 on ${SKY}`);
  }
  if (fill.alpha < 1) found.push(`the button's fill is not opaque: ${voice.fill}`);
  else if (contrastRatio(label.hex, fill.hex) < AA_TEXT) {
    found.push(`the label is ${contrastRatio(label.hex, fill.hex).toFixed(2)}:1 on its fill`);
  }
  return found;
}

/** The button's place: on the stage, beside *Start the race*, over nothing and not the rider. */
function voicePlaceFailures(
  seen: StageMeasurement,
  voice: VoiceMeasurement,
  viewport: Viewport,
): string[] {
  const found: string[] = [];
  const { box } = voice.button;
  const button = describeItem(voice.button);
  if (!inside(voice.panel, viewport)) found.push(`${button}'s panel off the stage`);
  const cell = voice.cell;
  if (
    cell === undefined ||
    voice.panel.left < cell.left - SUBPIXEL_TOLERANCE ||
    voice.panel.right > cell.right + SUBPIXEL_TOLERANCE ||
    voice.panel.top < cell.top - SUBPIXEL_TOLERANCE ||
    voice.panel.bottom > cell.bottom + SUBPIXEL_TOLERANCE
  ) {
    found.push(`${button}'s panel outside the notice cell`);
  }
  if (voice.notice === undefined || overlap(voice.panel, voice.notice)) {
    found.push(`${button} over the race's notice`);
  }
  if (voice.start === undefined) found.push('no Start the race beside it');
  else {
    if (overlap(voice.panel, voice.start)) found.push(`${button} over Start the race`);
    if (box.top > voice.start.bottom) found.push(`${button} below Start the race, not beside it`);
    if (voice.start.height > RIDE_TIME_TARGET_PIXELS + SUBPIXEL_TOLERANCE) {
      found.push(`Start the race squeezed to ${voice.start.height.toFixed(0)} px tall beside it`);
    }
    // Set as tight as the row it joins: a taller row is paid for out of an
    // upright phone's clearance above the rider.
    if (box.height > voice.start.height * VOICE_ROW_SLACK) {
      found.push(`${button} taller than Start the race's ${voice.start.height.toFixed(0)} px row`);
    }
  }
  for (const panel of seenPanels(seen)) {
    if (!panel.name.includes('oyl-hud__notices') && overlap(voice.panel, panel.box)) {
      found.push(`${button} over ${describeItem(panel)}`);
    }
  }
  if (overlap(voice.panel, riderBox(viewport))) found.push(`${button} over the rider`);
  return found;
}

test.describe('a race’s voice button on its line — #875', () => {
  for (const viewport of VOICE_VIEWPORTS) {
    test(`${voiceShown(viewport) ? 'a 48 px secondary button on an opaque panel, beside Start the race, over nothing' : 'laid out at no size where it does not fit'} — ${viewport.name}`, async ({
      browser,
    }) => {
      const page = await sharedRide(browser, viewport, RACE_VOICE_WITH_SOUNDS);
      for (const [how, seen] of await bothWays(page)) {
        const voice = voiceOf(seen, how);
        console.log(
          `#875 — ${viewport.name} — ${how}: ${describeItem(voice.button)}; panel ` +
            `${voice.panelBackground}; rider top ${riderBox(viewport).top.toFixed(0)}`,
        );
        expect(voice.text, how).toBe(VOICE_WORDS);
        expect(voice.href, how).toBe(VOICE_INVITE);
        if (!voiceShown(viewport)) {
          expect(voice.button.box.width * voice.button.box.height, how).toBe(0);
          continue;
        }
        expect(voiceTargetFailures(voice), how).toEqual([]);
        expect(voiceContrastFailures(voice), how).toEqual([]);
        expect(voicePlaceFailures(seen, voice, viewport), how).toEqual([]);
      }
    });
  }

  const at = (size: string): Viewport =>
    VOICE_VIEWPORTS.find(
      (each) => `${String(each.width)}×${String(each.height)}` === size,
    ) as Viewport;

  test('the control — the link drawn as the bare text it replaced is under 48 px — 1280×800', async ({
    page,
  }) => {
    await openRide(page, at('1280×800'), RACE_VOICE_WITH_SOUNDS);
    await page.evaluate(() => {
      document.querySelector('.oyl-hud__voice > a')?.removeAttribute('class');
    });
    const voice = voiceOf(await measure(page), ANCHORED);
    const failures = voiceTargetFailures(voice);
    console.log(`#875 control, target: ${failures.join('; ')}`);
    expect(failures.some((each) => each.includes('under 48 px'))).toBe(true);
  });

  test('the control — the panel and the button with no fill do not read over the sky — 1280×800', async ({
    page,
  }) => {
    await openRide(page, at('1280×800'), RACE_VOICE_WITH_SOUNDS);
    await page.addStyleTag({
      content: `.oyl-hud .oyl-hud__voice, .oyl-hud .oyl-hud__voice > .oyl-button {
        background: transparent !important; transition: none !important; }`,
    });
    const voice = voiceOf(await measure(page), ANCHORED);
    const failures = voiceContrastFailures(voice);
    console.log(`#875 control, contrast: ${failures.join('; ')}`);
    expect(failures.some((each) => each.startsWith('the panel'))).toBe(true);
  });

  test('the control — shown on a phone on its side, it does not fit — 736×360', async ({
    page,
  }) => {
    const viewport = at('736×360');
    await openRide(page, viewport, RACE_VOICE_WITH_SOUNDS);
    await page.addStyleTag({
      content: '.oyl-game--riding .oyl-hud .oyl-hud__voice { display: block !important; }',
    });
    const seen = await measure(page);
    const voice = voiceOf(seen, ANCHORED);
    const failures = [...voiceTargetFailures(voice), ...voicePlaceFailures(seen, voice, viewport)];
    console.log(`#875 control, a phone on its side: ${failures.join('; ')}`);
    expect(failures).not.toEqual([]);
  });

  test('the control — shown under 64 rem wide and under 47 rem tall, it does not fit — 802×600', async ({
    page,
  }) => {
    const viewport = at('802×600');
    await openRide(page, viewport, RACE_VOICE_WITH_SOUNDS);
    await page.addStyleTag({
      content: '.oyl-game--riding .oyl-hud .oyl-hud__voice { display: block !important; }',
    });
    const seen = await measure(page);
    const voice = voiceOf(seen, ANCHORED);
    const failures = [...voiceTargetFailures(voice), ...voicePlaceFailures(seen, voice, viewport)];
    console.log(`#875 control, 802×600: ${failures.join('; ')}`);
    expect(failures).not.toEqual([]);
  });

  test('the control — under Start the race rather than beside it, it is over the rider — 360×752', async ({
    page,
  }) => {
    const viewport = at('360×752');
    await openRide(page, viewport, RACE_VOICE_WITH_SOUNDS);
    await page.addStyleTag({
      content: `.oyl-game--riding .oyl-hud .oyl-hud__race-actions {
        flex-direction: column !important; align-items: flex-start !important; }`,
    });
    const seen = await measure(page);
    const failures = voicePlaceFailures(seen, voiceOf(seen, ANCHORED), viewport);
    console.log(`#875 control, below: ${failures.join('; ')}`);
    expect(failures.some((each) => each.endsWith('over the rider'))).toBe(true);
  });
});

/**
 * #1409 — a room ride with sounds on and a side camera paired, and a room ride
 * with sounds on whose notice slot carries the room's sentence.
 *
 * ## What is held
 *
 * At every overlay viewport, both ways (#1120), what §"#1407" holds:
 * nothing scrolled, every reading and control inside the viewport and
 * uncovered, every panel whole, over no other and not over the leaning rider,
 * and each thing that gives way laid out at no size exactly where `theme.css`
 * records it and nowhere else:
 *
 * - `?room=following&sounds=on&side=filming` — *Follow*, *Report*, the mute,
 *   the volume, the side camera's line and *Stop side camera*. On a phone
 *   the side camera's line gives way, and on an upright phone the volume as
 *   well (`theme.css` §"#1409"). ⚠️ The owner's ruling of 2026-10-17: on an
 *   upright phone (and on a tablet) **the trainer line stays on the
 *   screen**, because it can carry a running workout's hold, the power the
 *   trainer is holding; until that ruling it gave way upright, and each
 *   side-camera case now requires it laid out, on the stage and uncovered.
 *   On a phone on its side #1358 gives it up in every room ride. On a phone
 *   on its side and on a tablet, the sound row and the side camera's row
 *   are each a panel of their own.
 * - `?room=following&sounds=on&side=lost` — the same with the side camera's
 *   link lost: its sentence is a notice in the bottom-start cell (#437, so on
 *   a phone the route panel's two readings give way to it), and the stop
 *   stays.
 * - `?room=report&sounds=on&side=filming` — *Report*'s reasons open as well:
 *   on a phone they take the row in place of *Follow* and *Report*
 *   (§"#789 on a phone on its side", §"#1407"), whole, beside *Stop* upright,
 *   where the volume has given way already.
 * - `?room=lost&sounds=on` and `?room=paused&sounds=on` — #1360's two room
 *   sentences in the notice slot with the lifted sound row (#1398). At
 *   1024×768 the sentence and the sound row share the left column.
 *
 * ## The cause, and the control
 *
 * On `main` after #1398, on the CI runner's fonts, with a side camera as well
 * the actions panel was over the race's standings at 1280×800 and 1024×768
 * (`[696,472 → 1016,760]` against `[728,289 → 1016,532]`, covering the
 * trainer line), ran 7 px below a 736×360 stage and 3 px below an 844×390
 * one, began 50 px into the leaning rider at 360×752 and 36 px at 360×800,
 * and covered *Stop side camera* at 390×844. The control takes §"#1409"'s
 * rules out of the live stylesheet, puts back #1398's exception for a side
 * camera, and requires the same measurement to fail at 1024×768, 736×360 and
 * 360×752.
 */
const ROOM_SOUNDS_SIDE = `${FOLLOWING_WITH_SOUNDS}&side=filming`;

const ROOM_SOUNDS_SIDE_LOST = `${FOLLOWING_WITH_SOUNDS}&side=lost`;

const REPORT_SOUNDS_SIDE = `${REPORT_WITH_SOUNDS}&side=filming`;

const ROOM_LOST_WITH_SOUNDS = '?room=lost&sounds=on';

const ROOM_PAUSED_WITH_SOUNDS = '?room=paused&sounds=on';

const SIDE_CAMERA_LINE = 'the side camera line';

const SIDE_CAMERA_STOP = 'the side camera stop';

const SIDE_CAMERA_ROW = 'oyl-hud__side-camera-row';

const WITH_A_SIDE_CAMERA = [ROOM_SOUNDS_SIDE, ROOM_SOUNDS_SIDE_LOST, REPORT_SOUNDS_SIDE] as const;

/** What `theme.css` records as giving way in this state at this viewport. */
function givesWayIn1409(query: string, viewport: Viewport): readonly string[] {
  if (TABLET_VIEWPORTS.includes(viewport)) return [];
  const upright = !onItsSide(viewport);
  return [
    // #437: on a phone a notice stands in the route panel's cell.
    ...(query === ROOM_SOUNDS_SIDE || query === REPORT_SOUNDS_SIDE ? [] : ROUTE_READINGS),
    ...(query === ROOM_SOUNDS_SIDE || query === REPORT_SOUNDS_SIDE ? [SIDE_CAMERA_LINE] : []),
    ...(upright && (WITH_A_SIDE_CAMERA as readonly string[]).includes(query) ? [VOLUME] : []),
    ...(query === REPORT_SOUNDS_SIDE ? ROOM_REPORT_CONTROLS.slice(0, 2) : []),
  ];
}

test.describe('a room ride with sounds on, a side camera paired or a notice standing — #1409', () => {
  for (const query of [...WITH_A_SIDE_CAMERA, ROOM_LOST_WITH_SOUNDS, ROOM_PAUSED_WITH_SOUNDS]) {
    const sideCamera = (WITH_A_SIDE_CAMERA as readonly string[]).includes(query);
    for (const viewport of OVERLAY_VIEWPORTS) {
      test(`${query}: every panel whole and clear of the rider, every reading and control on the stage — ${viewport.name}`, async ({
        browser,
      }) => {
        const page = await sharedRide(browser, viewport, query);
        if (query === REPORT_SOUNDS_SIDE) expect(await reasonsClipped(page)).toEqual([]);
        for (const [how, seen] of await bothWays(page)) {
          // The state this is about.
          const names = seen.items.map((each) => each.name);
          expect(names, how).toContain('sound: Mute sounds');
          expect(names, how).toContain(VOLUME);
          if (sideCamera) {
            expect(names, how).toContain(SIDE_CAMERA_STOP);
            expect(names, how).toContain(ROOM_REPORT_CONTROLS[1]);
          }
          if (query === REPORT_SOUNDS_SIDE) {
            for (const name of ROOM_REPORT_CONTROLS) expect(names, how).toContain(name);
          }
          if (sideCamera && !onItsSide(viewport)) {
            // The owner's ruling of 2026-10-17: the trainer line, which can
            // carry a workout's hold, is laid out, on the stage and uncovered.
            const line = named(seen.items, TRAINER_LINE);
            const shown = `${how}: ${describeItem(line)} shown (the owner's ruling, 2026-10-17)`;
            expect(line.box.width, shown).toBeGreaterThan(1);
            expect(line.box.height, shown).toBeGreaterThan(1);
            expect(line.onTop, shown).toBe(true);
            expect(inside(line.box, viewport), shown).toBe(true);
          }
          if (!sideCamera) {
            // #1360's sentence, in the notice slot.
            expect(
              seenPanels(seen).some((each) => each.name.includes('oyl-hud__notices')),
              how,
            ).toBe(true);
          }
          expect(seen.scrollY, how).toBe(0);
          expect(seen.stageScrollTop, how).toBe(0);
          expect(seen.pageOverflow, how).toBeLessThanOrEqual(0);
          const panels = seenPanels(seen);
          console.log(
            `#1409 — ${query} — ${viewport.name} — ${how}: ${panels.map(describeItem).join('; ')}`,
          );
          if (sideCamera) {
            const lifted = soundRowLifted(viewport);
            expect(
              panels.some((each) => each.name === SOUND_ROW),
              `${how}: the sound row a panel of its own`,
            ).toBe(lifted);
            expect(
              panels.some((each) => each.name.includes(SIDE_CAMERA_ROW)),
              `${how}: the side camera's row a panel of its own`,
            ).toBe(lifted);
          }
          expect(failuresGivingWay(seen, viewport, givesWayIn1409(query, viewport)), how).toEqual(
            [],
          );
        }
      });
    }
  }

  for (const viewport of OVERLAY_VIEWPORTS.filter((each) =>
    ['1024×768', '736×360', '360×752'].includes(`${String(each.width)}×${String(each.height)}`),
  )) {
    test(`the control — with §"#1409" taken out, the same measurement fails — ${viewport.name}`, async ({
      page,
    }) => {
      await openRide(page, viewport, ROOM_SOUNDS_SIDE);
      const taken = await page.evaluate(() => {
        // Every rule of §"#1409", and only those: each names the room's row
        // together with the sound row or the side camera's row.
        const ours = /oyl-hud__room-row\):has\(> \.oyl-(sound|hud__side-camera-row)\)/;
        let count = 0;
        const walk = (list: CSSRuleList, parent: CSSStyleSheet | CSSGroupingRule): void => {
          for (let index = list.length - 1; index >= 0; index -= 1) {
            const rule = list[index];
            if (rule instanceof CSSStyleRule && ours.test(rule.selectorText)) {
              parent.deleteRule(index);
              count += 1;
            } else if (rule instanceof CSSGroupingRule) {
              walk(rule.cssRules, rule);
            }
          }
        };
        for (const sheet of document.styleSheets) walk(sheet.cssRules, sheet);
        return count;
      });
      // Ten in `theme.css`: three on a phone on its side, one on a tablet and
      // six upright. Eleven in the built sheet, which splits the one
      // two-selector list into a rule per selector.
      expect(taken, 'the rules of §"#1409" taken out').toBe(11);
      // #1398's exception for a side camera, put back: the sound row stays in
      // the actions panel.
      await page.addStyleTag({
        content: `
          .oyl-game--riding .oyl-hud .oyl-hud__actions:has(> .oyl-hud__side-camera-row) > .oyl-sound {
            position: static !important; padding: 0 !important; border: 0 !important;
            width: auto !important; background: none !important;
          }`,
      });
      const seen = await measure(page);
      expect(
        seenPanels(seen).some((each) => each.name === SOUND_ROW),
        'the sound row back in the actions panel',
      ).toBe(false);
      const failures = roomWithSoundsFailures(seen, viewport);
      console.log(`#1409 control — ${viewport.name}: ${failures.join('; ')}`);
      expect(failures).not.toEqual([]);
    });
  }
});

/**
 * #1912 — a LAP RACE in a room on the HUD, `ride-harness.tsx` §`LAP_RACE`:
 * the running race of §"#1347" a lap race, so beside the room's readings,
 * row and standings the HUD carries the race's *Place* and *Item* — this
 * rider holding the widest item name, *Tailwind*. Three states: the race
 * as it runs, with *Follow* pressed, and with *Report* open too — the
 * owner's ruling on PR #2098 (2026-11-03) asked for the last two, which in
 * the review's screenshots ran the actions panel 19 px below a 736×360
 * stage and over the rider by 50 to 97 px.
 *
 * ## What is held, at every overlay viewport, both ways
 *
 * - Every panel a rider can see is whole on the stage and over no other
 *   panel; none is over the leaning rider's box; and *Place* and *Item* are
 *   laid out, on the stage and uncovered — 736×360 among them, the #1356
 *   class.
 * - **On a phone the room's row gives way** (`theme.css` §"#1912: a LAP RACE
 *   in a ROOM, on a phone"): *Follow*, *Report* and the reasons are laid out
 *   at no size. On a tablet each is on the stage and uncovered, but for
 *   *Follow* and *Report* while the reasons are open, which take their place
 *   (§"#1912 on a TABLET").
 * - On a phone *Use item* is the actions panel's own 8 px gap under *Pause*.
 * - **Upright without anchor positioning the moving time is in the
 *   secondary panel** (`theme.css` §"#1912, the owner's ruling"), in the
 *   cell the room's readings left, and not beside *Pause*.
 *
 * ## The control
 *
 * The same page with the *Item* field forced to the full width of the stage
 * and tall is over another panel or the rider at 736×360, so "whole and over
 * nothing" can fail here.
 */
const LAP_RACE_ROOM = '?room=lap-race';
const LAP_RACE_STATES = [
  { query: LAP_RACE_ROOM, state: 'as it runs', followed: false },
  { query: '?room=lap-race-following', state: 'Follow pressed', followed: true },
  { query: '?room=lap-race-report', state: 'Report open', followed: true },
] as const;
const LAP_RACE_READINGS = ['reading: Place', 'reading: Item'] as const;

/** Upright, where the moving time is lifted beside *Pause* (`theme.css` §"#1111"). */
function upright(viewport: Viewport): boolean {
  return viewport.width >= 360 && viewport.width < 736 && viewport.height >= 752;
}

test.describe('a lap race in a room on the HUD — #1912', () => {
  for (const viewport of OVERLAY_VIEWPORTS) {
    const tablet = TABLET_VIEWPORTS.includes(viewport);
    for (const { query, state, followed } of LAP_RACE_STATES) {
      test.describe(`${viewport.name}, ${state}`, () => {
        test(`every panel is whole, over no other panel and clear of the rider; Place and Item on the stage; the room’s row ${tablet ? 'on the stage' : 'gives way'}`, async ({
          browser,
        }) => {
          const page = await sharedRide(browser, viewport, query);
          const rider = riderBox(viewport);
          for (const [how, seen] of await bothWays(page)) {
            const panels = seenPanels(seen);
            expect(panels.length, how).toBeGreaterThanOrEqual(4);
            expect(
              panels.filter((each) => !inside(each.box, viewport)).map(describeItem),
              how,
            ).toEqual([]);
            const collisions: string[] = [];
            panels.forEach((a, index) => {
              for (const b of panels.slice(index + 1)) {
                if (overlap(a.box, b.box))
                  collisions.push(`${describeItem(a)} × ${describeItem(b)}`);
              }
            });
            expect(collisions, how).toEqual([]);
            expect(
              panels.filter((each) => overlap(each.box, rider)).map(describeItem),
              how,
            ).toEqual([]);
            for (const name of LAP_RACE_READINGS) {
              const reading = named(seen.items, name);
              expect(
                reading.box.width * reading.box.height,
                `${how}: ${name} laid out`,
              ).toBeGreaterThan(1);
              expect(inside(reading.box, viewport), `${how}: ${describeItem(reading)}`).toBe(true);
              expect(reading.onTop, `${how}: ${describeItem(reading)}`).toBe(true);
            }
            const roomRow = seen.items.filter((each) => each.name.startsWith('room: '));
            if (followed) {
              // Follow and Report, and with Report open its reasons as well.
              expect(roomRow.length, `${how}: the room's row`).toBeGreaterThanOrEqual(
                state === 'Report open' ? 3 : 2,
              );
            }
            for (const each of roomRow) {
              // On a tablet the open reasons take the row in place of Follow
              // and Report (`theme.css` §"#1912 on a TABLET").
              const inPlace =
                state === 'Report open' &&
                (each.name.startsWith('room: Follow') || each.name.startsWith('room: Report'));
              if (tablet && !inPlace) {
                expect(inside(each.box, viewport), `${how}: ${describeItem(each)}`).toBe(true);
                expect(each.onTop, `${how}: ${describeItem(each)}`).toBe(true);
              } else {
                expect(
                  each.box.width * each.box.height,
                  `${how}: ${describeItem(each)} gives way`,
                ).toBeLessThanOrEqual(1);
              }
            }
            if (!tablet) {
              // *Use item* the panel's own gap under *Pause*, and no margin
              // besides (`theme.css` §"#1912: a LAP RACE in a ROOM, on a phone").
              const pause = named(seen.items, 'control: Pause');
              const item = named(seen.items, 'control: Use item');
              expect(
                item.box.top - pause.box.bottom,
                `${how}: Use item under Pause`,
              ).toBeLessThanOrEqual(8 + SUBPIXEL_TOLERANCE);
            }
            if (how === UNANCHORED && upright(viewport)) {
              const moving = named(seen.items, 'reading: Moving');
              const secondary = panels.find((each) =>
                each.name.includes('oyl-hud__fields--secondary'),
              );
              expect(secondary, `${how}: the secondary panel`).toBeDefined();
              if (secondary !== undefined) {
                expect(
                  moving.box.left >= secondary.box.left - SUBPIXEL_TOLERANCE &&
                    moving.box.right <= secondary.box.right + SUBPIXEL_TOLERANCE &&
                    moving.box.top >= secondary.box.top - SUBPIXEL_TOLERANCE &&
                    moving.box.bottom <= secondary.box.bottom + SUBPIXEL_TOLERANCE,
                  `${how}: ${describeItem(moving)} in ${describeItem(secondary)}`,
                ).toBe(true);
              }
            }
          }
        });
      });
    }
  }

  test('the control — the Item field forced wide and tall is over another panel or the rider — 736×360', async ({
    page,
  }) => {
    const viewport = OVERLAY_VIEWPORTS.find((each) => each.width === 736 && each.height === 360);
    if (viewport === undefined) throw new Error('no 736×360 viewport');
    await openRide(page, viewport, LAP_RACE_ROOM);
    await page.addStyleTag({
      content:
        '.oyl-game--riding .oyl-hud .oyl-hud__field--lap-race { min-width: 100vw !important; min-height: 60vh !important; }',
    });
    const seen = await measure(page);
    const panels = seenPanels(seen);
    const rider = riderBox(viewport);
    const crossed =
      panels.some((a, index) => panels.slice(index + 1).some((b) => overlap(a.box, b.box))) ||
      panels.some((each) => overlap(each.box, rider)) ||
      panels.some((each) => !inside(each.box, viewport));
    expect(crossed).toBe(true);
  });
});
