// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The ride's stage beside the things a ride can carry, and at its edges — the
 * seventh of #1414's ride files, divided from `ride.browser.spec.ts` by
 * #2376 with nothing changed inside a case.
 *
 * ## Why it is a file of its own
 *
 * Playwright runs one file's cases in one worker (the config is not
 * `fullyParallel`, and `shared-load.ts` is why it must not be), and
 * `ride.browser.spec.ts` had grown back to 372 cases and 598 to 637 s in its
 * worker on the EPYC 7763, a 9V74 and a Xeon 8573C: one file was most of the 720 s
 * `chromium` stop of whichever browser shard held it, so no division of the
 * files between shards could bring that shard under 70 % of its stop.
 * docs/agents/ci.md §4c "Five browser shards — #2376" has the measurements.
 *
 * ## What is here
 *
 * The sections that were the second half of `ride.browser.spec.ts`, in the
 * order they had there, so a `§"…"` reference elsewhere to one of them under
 * that file's name now names this one: a workout eased (#585), sounds on, a
 * side camera paired (#551), a standing notice once it is put away (#437),
 * the cull, safe areas, #439's insets, #1441's gesture bar, a laptop's window
 * (#2076's ride so far giving way) and the end of a ride's steps. What every
 * one of them measures with — the viewports, `openRide`, the measuring and
 * both-ways helpers — is `ride-stage.ts`, and `ride.browser.spec.ts`'s header
 * says what each measurement does and does not prove; read it first.
 */

import { expect, test, type Page } from '@playwright/test';

import { applyInsets, PIXEL_TABLET_LANDSCAPE_INSETS, resolvedInsets } from './insets';
import {
  SUBPIXEL_TOLERANCE,
  type Viewport,
  OVERLAY_VIEWPORTS,
  STACKED_VIEWPORTS,
  openRide,
  sharedRide,
  measure,
  inside,
  overlap,
  describeItem,
  riderBox,
  named,
  withoutAnchors,
  bothWays,
  easedCollisions,
  EASED_RIDER_CLEARANCE_PIXELS,
  noticeText,
  RIDE_TOTAL_READINGS,
  LAPTOP_VIEWPORTS,
  roomGivesWay,
  layoutFaults,
} from './ride-stage';
import { attachSharedPageOnFailure, releaseSharedPage } from './shared-load';

import { workoutRescueText } from '../src/workout/rescue-text';

import type { StageItem, StageMeasurement } from './ride-harness';

// The page the cases below share goes when this file's cases do (`shared-load.ts`).
test.afterAll(releaseSharedPage);
// What a red shared case read, since the `page` fixture's screenshot is not it (#1076).
test.afterEach(async () => {
  await attachSharedPageOnFailure(test.info());
});

/** The sentence the ride harness's rescue has, whole — as #585 put it on the HUD. */
const WHOLE_EASED_SENTENCE = workoutRescueText(
  {
    kind: 'floor',
    reason: 'Pedalling has stopped, so the target has been dropped to the trainer’s lowest.',
  },
  'game',
);

/**
 * Put the whole sentence back in the Eased notice on the live page — the HUD
 * as #585 shipped it, before #605 cut it to its headline. Same element, same
 * surface, same cell: only the words change.
 */
async function restoreWholeEasedSentence(page: Page): Promise<void> {
  await page.evaluate((whole) => {
    const label = [...document.querySelectorAll('.oyl-hud__notices .oyl-status__label')].find(
      (each) => each.textContent?.startsWith('Eased'),
    );
    const body = label?.parentElement;
    if (label === undefined || body === null || body === undefined) {
      throw new Error('no Eased notice to restore');
    }
    body.replaceChildren(label, whole);
  }, WHOLE_EASED_SENTENCE);
}

test.describe('a ride with a workout eased — #585', () => {
  const QUERY = '?rescue=floor';

  for (const viewport of OVERLAY_VIEWPORTS) {
    test(`the Eased notice, whole and over nothing — ${viewport.name}`, async ({ page }) => {
      await openRide(page, viewport, QUERY);
      for (const [how, seen] of await bothWays(page)) {
        await test.step(how, async () => {
          // The apparatus: the Eased notice was laid out, with the floor's
          // sentence in it. Without this every assertion below is true of a ride
          // with no rescue at all.
          const notice = seen.panels.find((each) => each.name.includes('oyl-hud__notices'));
          expect(notice?.box.height ?? 0).toBeGreaterThan(40);
          const text = await noticeText(page);
          expect(text).toContain('Eased');
          expect(text).toContain('Pedalling has stopped');
          // The road notice gives way to it, control and all — `GameView`
          // §`roadNotice`.
          expect(text).not.toContain('workout is driving your trainer');
          expect(seen.items.some((each) => each.name === 'control: Trainer notice')).toBe(false);

          // On a phone the notice takes the route panel's cell (declared in
          // `theme.css` §"WHERE THERE IS NO FREE CELL"); on a tablet nothing
          // gives way. Both are asserted, so neither is true by accident.
          const onAPhone = Math.min(viewport.width, viewport.height) <= 480;
          const laidOut = seen.panels.filter((each) => each.box.height > 1);
          expect(laidOut).toHaveLength(onAPhone ? 4 : 5);
          const plan = named(seen.items, 'the plan view');
          expect(inside(plan.box, viewport) && plan.onTop).toBe(!onAPhone);

          // Published rather than bounded, for #512's reason: the runner's fonts
          // are not a Mac's, and these are the margins a longer line eats first.
          const above = laidOut
            .filter((each) => each !== notice && each.box.bottom <= (notice?.box.top ?? 0) + 1)
            .map((each) => (notice?.box.top ?? 0) - each.box.bottom);
          const rider = riderBox(viewport);
          console.log(
            `workout eased — ${viewport.name} — ${how} — notice ${(notice?.box.height ?? 0).toFixed(0)} px ` +
              `tall; ${above.length === 0 ? 'nothing above it' : `${Math.min(...above).toFixed(0)} px to the panel above`}` +
              (viewport.height > viewport.width
                ? `; ${(rider.top - (notice?.box.bottom ?? 0)).toFixed(0)} px above the rider's box`
                : `; ends at x = ${(notice?.box.right ?? 0).toFixed(0)}, rider from x = ${rider.left.toFixed(0)}`),
          );

          expect(easedCollisions(seen, viewport)).toEqual([]);
          // #605: the ONE sentence, and upright a margin above the rider rather
          // than a pass. @see EASED_RIDER_CLEARANCE_PIXELS
          expect(text).not.toContain('comes back by itself');
          if (viewport.height > viewport.width) {
            expect(rider.top - (notice?.box.bottom ?? Infinity)).toBeGreaterThanOrEqual(
              EASED_RIDER_CLEARANCE_PIXELS,
            );
          }
        });
      }
    });
  }

  // #605's control: the whole sentence back in the same notice, at the
  // viewport #605 was about. It must fall under the clearance again, or the
  // floor above is being held over a notice that could never have been near
  // the rider.
  //
  // ⚠️ What it models, and how closely (#605's review). It rewrites the live
  // notice's words and nothing else — same `<p>`, same glyph, same label, same
  // cell — so it is the HUD as #585 shipped it only if `StatusMessage`'s
  // plain (no-`more`) markup is what `GameView` still renders, which the
  // exact-text assertion below and the a11y suite hold. The figure it prints
  // VARIES BY MACHINE, because the fonts do: 20 px on one Mac, 6 px on the
  // reviewer's, 2 px on the CI runner. What was measured is that on a given
  // machine it prints the same figure as the defect itself — this rewrite and
  // `GameView` rendering the whole sentence (mutation M5) both printed 20 px
  // at 360×752 on a Mac, with byte-identical notice markup, three runs each.
  // It is not asserted to match any other machine's figure.
  for (const viewport of OVERLAY_VIEWPORTS.filter((each) => each.height === 752)) {
    test(`the control — the whole sentence comes within ${String(EASED_RIDER_CLEARANCE_PIXELS)} px of the rider — ${viewport.name}`, async ({
      page,
    }) => {
      await openRide(page, viewport, QUERY);
      await restoreWholeEasedSentence(page);
      const seen = await measure(page);
      // The whole cell is the one notice, glyph and label and the whole
      // sentence — nothing added and nothing left over from the headline.
      expect(await noticeText(page)).toBe(`!Eased: ${WHOLE_EASED_SENTENCE}`);
      const notice = seen.panels.find((each) => each.name.includes('oyl-hud__notices'));
      const clearance = riderBox(viewport).top - (notice?.box.bottom ?? Infinity);
      console.log(
        `workout eased, the whole sentence — ${viewport.name} — ${clearance.toFixed(0)} px above the rider's box`,
      );
      expect(clearance).toBeLessThan(EASED_RIDER_CLEARANCE_PIXELS);
    });
  }

  // The control: the road notice put back beside the Eased one, which is the
  // HUD as PR #599 first shipped it. On a phone on its side that put *Pause*
  // and *End ride* below the stage, and upright the cell ran over the rider —
  // so the same measurement must fail at both. Without it, every case above is
  // as true of a notice cell the measurement never looked at.
  for (const viewport of OVERLAY_VIEWPORTS.filter(
    (each) => each.height === 360 || each.height === 390 || each.height === 752,
  )) {
    test(`the control — the road notice beside it does not fit — ${viewport.name}`, async ({
      page,
    }) => {
      await openRide(page, viewport, QUERY);
      // As PR #599 shipped it: the WHOLE Eased sentence, which #605 cut to its
      // headline — with the headline alone the two notices together fit a
      // phone on its side, so this would be a control that could not fail.
      await restoreWholeEasedSentence(page);
      await page.evaluate(() => {
        const eased = document.querySelector('.oyl-hud__notices .oyl-status');
        if (eased === null) throw new Error('no Eased notice to put the road notice beside');
        const road = eased.cloneNode(true) as HTMLElement;
        road.textContent =
          'The road is not reaching your trainer: A workout is driving your trainer, so the ' +
          'hills on this route are not being sent to it — two things cannot set the ' +
          'resistance at once. End the workout on the Ride screen to feel the road instead.';
        eased.before(road);
      });
      const seen = await measure(page);
      expect(await noticeText(page)).toContain('workout is driving your trainer');
      expect(easedCollisions(seen, viewport)).not.toEqual([]);
    });
  }
});

/**
 * #400 — a ride with sounds on puts *Mute sounds* and *Sound volume* in the
 * actions panel, which makes it taller. WCAG 2.2 SC 1.4.2 needs both reachable
 * DURING a ride, so they must be on screen, uncovered, at every overlay
 * viewport — and the taller panel must still land on no other panel and not
 * on the rider.
 */
test.describe('a ride with sounds on', () => {
  for (const viewport of OVERLAY_VIEWPORTS) {
    test(`puts the mute and the volume on screen, over nothing — ${viewport.name}`, async ({
      page,
    }) => {
      await openRide(page, viewport, '?sounds=on');
      for (const [how, seen] of await bothWays(page)) {
        await test.step(how, () => {
          const sound = seen.items.filter((each) => each.name.startsWith('sound: '));
          // The apparatus: both controls were rendered. Without this every
          // assertion below is true of a ride where sounds stayed off.
          expect(sound.map((each) => each.name)).toEqual([
            'sound: Mute sounds',
            'sound: Sound volume',
          ]);
          // #512: the mute is ONE line tall, and the room the actions panel has
          // above it is published — because the first CI run of the 16 rem panel
          // found the label wrapped on the runner's fonts, the panel taller than
          // its row, and its bottom 10 px past a 736×360 stage, green on a Mac.
          // The panel is anchored to the stage's bottom, so what a taller panel
          // eats is the gap to whatever is above it. Read it off the run rather
          // than assuming a desktop's fonts are the runner's.
          const mute = named(seen.items, 'sound: Mute sounds').box;
          const actions = seen.panels.find((each) => each.name.includes('oyl-hud__actions'))?.box;
          const above = seen.panels
            .filter((each) => each.box !== actions && each.box.bottom <= (actions?.top ?? 0) + 1)
            .map((each) => (actions?.top ?? 0) - each.box.bottom);
          const headroom = above.length === 0 ? Number.NaN : Math.min(...above);
          console.log(
            `sounds on — ${viewport.name} — ${how} — mute ${mute.height.toFixed(0)} px tall; actions panel ` +
              `${(actions?.height ?? 0).toFixed(0)} px tall with ${Number.isNaN(headroom) ? 'nothing above it' : `${headroom.toFixed(0)} px to the panel above`}`,
          );
          expect(mute.height).toBeLessThan(60);
          const lost = [
            ...sound,
            named(seen.items, 'control: Pause'),
            named(seen.items, 'control: End ride'),
          ].filter((each) => !inside(each.box, viewport) || !each.onTop);
          expect(lost.map(describeItem)).toEqual([]);

          const laidOut = seen.panels.filter((each) => each.box.height > 0);
          expect(laidOut.filter((each) => !inside(each.box, viewport)).map(describeItem)).toEqual(
            [],
          );
          const collisions: string[] = [];
          laidOut.forEach((a, index) => {
            for (const b of laidOut.slice(index + 1)) {
              if (overlap(a.box, b.box)) collisions.push(`${describeItem(a)} × ${describeItem(b)}`);
            }
          });
          expect(collisions).toEqual([]);
          expect(
            laidOut.filter((each) => overlap(each.box, riderBox(viewport))).map(describeItem),
          ).toEqual([]);
        });
      }
    });
  }
});

/**
 * #551 — a ride with a tripod phone paired. `?side=filming` puts the side
 * camera's line and *Stop side camera* in the actions panel, which makes it
 * taller; `?side=lost` puts the lost link in the notice slot, the HUD's
 * exception, and keeps the stop. At every overlay viewport: the line, the
 * stop and the ride's own controls are on screen and uncovered, and no panel
 * lands on another or on the rider.
 */
function sideCameraCollisions(seen: StageMeasurement, viewport: Viewport): string[] {
  const laidOut = seen.panels.filter((each) => each.box.height > 1);
  const found = laidOut.filter((each) => !inside(each.box, viewport)).map(describeItem);
  laidOut.forEach((a, index) => {
    for (const b of laidOut.slice(index + 1)) {
      if (overlap(a.box, b.box)) found.push(`${describeItem(a)} × ${describeItem(b)}`);
    }
  });
  found.push(...laidOut.filter((each) => overlap(each.box, riderBox(viewport))).map(describeItem));
  const pressed = ['control: Pause', 'control: End ride', 'control: Lock', 'the side camera stop'];
  found.push(
    ...pressed
      .map((name) => named(seen.items, name))
      .filter((each) => !inside(each.box, viewport) || !each.onTop)
      .map(describeItem),
  );
  // The stop is the mute's size (`HudPanel.tsx` says why), so it is held to
  // the mute's floor: SC 2.5.5's 44 × 44.
  const stop = named(seen.items, 'the side camera stop');
  if (stop.box.width < 44 - SUBPIXEL_TOLERANCE || stop.box.height < 44 - SUBPIXEL_TOLERANCE) {
    found.push(`${describeItem(stop)} is smaller than 44 × 44`);
  }
  return found;
}

test.describe('a ride with a side camera paired — #551', () => {
  for (const viewport of OVERLAY_VIEWPORTS) {
    test(`filming: the line and its stop fit the actions panel — ${viewport.name}`, async ({
      page,
    }) => {
      await openRide(page, viewport, '?side=filming');
      for (const [how, seen] of await bothWays(page)) {
        await test.step(how, () => {
          // The apparatus: the line was rendered, in the actions panel, and has a
          // box. Without this every assertion below is true of a ride with no
          // pairing at all.
          const line = named(seen.items, 'the side camera line');
          expect(line.box.height, describeItem(line)).toBeGreaterThan(0);
          expect(inside(line.box, viewport) && line.onTop, describeItem(line)).toBe(true);
          const actions = seen.panels.find((each) => each.name.includes('oyl-hud__actions'));
          expect(actions === undefined ? false : overlap(line.box, actions.box)).toBe(true);
          // Published rather than bounded, for #512's reason (§"a ride with sounds
          // on"): the runner's fonts are not a Mac's, and the room above the
          // panel is what a taller line would eat first.
          const above = seen.panels
            .filter((each) => each !== actions && each.box.bottom <= (actions?.box.top ?? 0) + 1)
            .map((each) => (actions?.box.top ?? 0) - each.box.bottom);
          const rider = riderBox(viewport);
          console.log(
            `side camera filming — ${viewport.name} — ${how} — actions panel ` +
              `${(actions?.box.height ?? 0).toFixed(0)} px tall; ` +
              `${above.length === 0 ? 'nothing above it' : `${Math.min(...above).toFixed(0)} px to the panel above`}; ` +
              `rider box ends at y = ${rider.bottom.toFixed(0)}, x ${rider.left.toFixed(0)}–${rider.right.toFixed(0)}; ` +
              `panel from x = ${(actions?.box.left ?? 0).toFixed(0)}, y = ${(actions?.box.top ?? 0).toFixed(0)}`,
          );

          expect(sideCameraCollisions(seen, viewport)).toEqual([]);
        });
      }
    });

    test(`lost: the notice and the stop, over nothing — ${viewport.name}`, async ({ page }) => {
      await openRide(page, viewport, '?side=lost');
      for (const [how, seen] of await bothWays(page)) {
        await test.step(how, async () => {
          const notice = seen.panels.find((each) => each.name.includes('oyl-hud__notices'));
          expect(notice?.box.height ?? 0).toBeGreaterThan(20);
          const text = await page.evaluate(
            () => document.querySelector('.oyl-hud__notices')?.textContent ?? '',
          );
          expect(text).toContain('link lost');

          expect(sideCameraCollisions(seen, viewport)).toEqual([]);
        });
      }
    });
  }

  /**
   * #576 — sounds on AND a side camera paired. Each passed alone and the two
   * together did not fit a phone: the actions panel was 228 px on a Mac, ran
   * off a 736×360 stage and landed on the rider upright. The stage has no
   * navigation, so a Pause or End ride pushed off it is a ride the rider
   * cannot leave. Every control is held on screen and uncovered, the mute
   * and the volume included (WCAG 2.2 SC 1.4.2).
   */
  for (const viewport of OVERLAY_VIEWPORTS) {
    for (const side of ['filming', 'lost'] as const) {
      test(`with sounds on, ${side}: every control is reachable — ${viewport.name}`, async ({
        page,
      }) => {
        await openRide(page, viewport, `?side=${side}&sounds=on`);
        for (const [how, seen] of await bothWays(page)) {
          await test.step(how, () => {
            const sound = seen.items.filter((each) => each.name.startsWith('sound: '));
            // The apparatus: both halves were rendered.
            expect(sound.map((each) => each.name)).toEqual([
              'sound: Mute sounds',
              'sound: Sound volume',
            ]);
            named(seen.items, 'the side camera stop');
            const actions = seen.panels.find((each) => each.name.includes('oyl-hud__actions'));
            const above = seen.panels
              .filter((each) => each !== actions && each.box.bottom <= (actions?.box.top ?? 0) + 1)
              .map((each) => (actions?.box.top ?? 0) - each.box.bottom);
            // Published rather than bounded, for #512's reason: the runner's fonts
            // are not a Mac's. Upright, the room that runs out is the room above
            // the rider's box, so that margin is printed too.
            const rider = riderBox(viewport);
            console.log(
              `side camera ${side} + sounds on — ${viewport.name} — ${how} — actions panel ` +
                `${(actions?.box.height ?? 0).toFixed(0)} px tall; ` +
                `${above.length === 0 ? 'nothing above it' : `${Math.min(...above).toFixed(0)} px to the panel above`}` +
                (viewport.height > viewport.width
                  ? `; ${((actions?.box.top ?? 0) - rider.bottom).toFixed(0)} px below the rider's box`
                  : ''),
            );
            // #576, and #1120's fallback for it: on a phone on its side the
            // row is a panel of its own in the left column, between the top
            // panels and the bottom-start cell. The room either side of it,
            // published, because that strip is all the room there is.
            const row = seen.panels.find((each) => each.name.includes('side-camera-row'));
            if (row !== undefined) {
              const column = seen.panels.filter(
                (each) =>
                  each !== row && each.box.left < row.box.right && row.box.left < each.box.right,
              );
              const over = column
                .filter((each) => each.box.bottom <= row.box.top + 1)
                .map((each) => row.box.top - each.box.bottom);
              const under = column
                .filter((each) => each.box.top >= row.box.bottom - 1)
                .map((each) => each.box.top - row.box.bottom);
              console.log(
                `side camera ${side} + sounds on — ${viewport.name} — ${how} — the side ` +
                  `camera's row ${describeItem(row)}; ` +
                  `${over.length === 0 ? 'nothing above it' : `${Math.min(...over).toFixed(0)} px under the panel above`}; ` +
                  `${under.length === 0 ? 'nothing below it' : `${Math.min(...under).toFixed(0)} px above the panel below`}`,
              );
            }
            expect([
              ...sideCameraCollisions(seen, viewport),
              ...sound
                .filter((each) => !inside(each.box, viewport) || !each.onTop)
                .map(describeItem),
            ]).toEqual([]);
          });
        }
      });
    }
  }

  /**
   * #576's control — put back what the actions panel did before: the side
   * camera's row stacked inside it, under Pause and End ride and over the
   * sound row. The same measurement must then fail on a short landscape phone
   * AND upright, which is #576 reproduced; without this, every case above is
   * as true of a harness where sounds never came on.
   */
  for (const viewport of OVERLAY_VIEWPORTS.filter(
    (each) => each.height === 360 || each.height === 752,
  )) {
    test(`the control — the rows stacked as before #576 do not fit — ${viewport.name}`, async ({
      page,
    }) => {
      await openRide(page, viewport, '?side=filming&sounds=on');
      await page.addStyleTag({
        content:
          '.oyl-game--riding .oyl-hud .oyl-hud__actions { flex-flow: column nowrap !important; }' +
          '.oyl-game--riding .oyl-hud .oyl-hud__actions > .oyl-hud__side-camera-row {' +
          ' position: static !important; margin: 0 !important; padding: 0 !important;' +
          ' border: 0 !important; width: auto !important; }' +
          '.oyl-game--riding .oyl-hud .oyl-sound__mute-more { position: static !important;' +
          ' width: auto !important; height: auto !important; margin: 0 !important;' +
          ' clip-path: none !important; }',
      });
      const seen = await measure(page);
      // The apparatus: the row really is back inside the panel.
      expect(seen.panels.some((each) => each.name.includes('side-camera-row'))).toBe(false);
      expect(sideCameraCollisions(seen, viewport)).not.toEqual([]);
    });
  }

  /**
   * #1120's control for #576's fallback. On a phone on its side the row is
   * lifted out of the actions panel by anchor positioning, or — without it —
   * by grid placement (`theme.css` §"#576 WITHOUT ANCHOR POSITIONING"). With
   * neither, as `main` had it, the actions panel holds both rows and runs off
   * the stage: the same measurement must fail at 736×360 and at 844×390 —
   * where the moving time is not lifted at all, so it is this fallback and no
   * other that the cases above hold there. Not at 736×480, where `main`'s
   * panels ended within a pixel of the stage's edge: a control that passes or
   * fails on a sub-pixel is no control.
   *
   * ⚠️ **At 844×390 the ride is a WORKOUT since #2071.** The gradient left the
   * secondary panel for the primary one, the secondary panel lost a row, and
   * the actions panel holding both rows ended 5 px inside the stage on the
   * plain widest ride (it ended 61 px past it on `main`). A running workout
   * adds the trainer notice's row to the same panel, so without the fallback
   * it runs 42 px off the stage there, and with it the panel ends inside the
   * stage. The anchored and the fallback layouts of that same page are
   * measured first, so the pair still says it is the fallback that holds it.
   */
  for (const viewport of OVERLAY_VIEWPORTS.filter(
    (each) => each.width >= 736 && each.height <= 390,
  )) {
    test(`the control — without anchors and without the fallback, the rows do not fit — ${viewport.name}`, async ({
      page,
    }) => {
      const workout = viewport.height === 390;
      await openRide(page, viewport, `?side=filming&sounds=on${workout ? '&trainer=workout' : ''}`);
      if (workout) {
        // The same page fits as it ships, both ways (#1120): the overflow
        // below is the fallback's to prevent, not the workout's own.
        for (const [how, seen] of await bothWays(page)) {
          expect(sideCameraCollisions(seen, viewport), how).toEqual([]);
        }
      }
      const before = await withoutAnchors(page, 'none');
      // The apparatus: the row is back inside the panel, not a panel of its own.
      expect(before.panels.some((each) => each.name.includes('side-camera-row'))).toBe(false);
      const found = sideCameraCollisions(before, viewport);
      console.log(
        `#1120 control, #576 — ${viewport.name} — as main laid it out without anchors: ` +
          `${found.length === 0 ? 'nothing' : found.join('; ')}`,
      );
      expect(found).not.toEqual([]);
    });
  }

  /**
   * #577's review, finding 1 — a lost link that ENDED the pairing. It is
   * terminal, so it is the actions panel's line and the notice slot is left
   * free: on a phone that slot is the route panel's cell (#437), and a notice
   * nothing could act on or retire would have held it for the rest of the
   * ride. At every overlay viewport: no notice, the route panel's strip and
   * plan view on screen, the line in the actions panel, and nothing over
   * anything else.
   */
  for (const viewport of OVERLAY_VIEWPORTS) {
    test(`ended: the line, and the route panel back — ${viewport.name}`, async ({ page }) => {
      await openRide(page, viewport, '?side=ended');
      for (const [how, seen] of await bothWays(page)) {
        await test.step(how, () => {
          const line = named(seen.items, 'the side camera line');
          expect(inside(line.box, viewport) && line.onTop, describeItem(line)).toBe(true);
          const actions = seen.panels.find((each) => each.name.includes('oyl-hud__actions'));
          expect(actions === undefined ? false : overlap(line.box, actions.box)).toBe(true);
          expect(seen.panels.some((each) => each.name.includes('oyl-hud__notices'))).toBe(false);
          expect(seen.items.some((each) => each.name === 'the side camera stop')).toBe(false);
          for (const name of ['the elevation strip', 'the road ahead', 'the plan view']) {
            const item = named(seen.items, name);
            expect(inside(item.box, viewport) && item.onTop, describeItem(item)).toBe(true);
          }

          const laidOut = seen.panels.filter((each) => each.box.height > 1);
          const found = laidOut.filter((each) => !inside(each.box, viewport)).map(describeItem);
          laidOut.forEach((a, index) => {
            for (const b of laidOut.slice(index + 1)) {
              if (overlap(a.box, b.box)) found.push(`${describeItem(a)} × ${describeItem(b)}`);
            }
          });
          found.push(
            ...laidOut.filter((each) => overlap(each.box, riderBox(viewport))).map(describeItem),
          );
          expect(found).toEqual([]);
        });
      }
    });
  }

  // The control for the case above: the same page with the pairing still
  // OPEN puts the lost link in the notice slot, and on a phone that slot is
  // the route panel's cell — so the same "the plan view is on screen" must
  // fail there. Without it, an ended case whose notice rendered somewhere the
  // measurement never looked would pass as readily as one with no notice.
  for (const viewport of OVERLAY_VIEWPORTS.filter((each) => each.height === 360)) {
    test(`the control — an OPEN lost link takes the route cell — ${viewport.name}`, async ({
      page,
    }) => {
      await openRide(page, viewport, '?side=lost');
      const seen = await measure(page);
      expect(seen.panels.some((each) => each.name.includes('oyl-hud__notices'))).toBe(true);
      const plan = named(seen.items, 'the plan view');
      expect(inside(plan.box, viewport) && plan.onTop).toBe(false);
    });
  }

  // The control: the same measurement over a line made taller than the room
  // a short landscape phone has for it must fail. Without this, a line the
  // measurement never looked at would pass as readily as one that fits.
  test('the control — a line taller than the room there is fails the same measurement', async ({
    page,
  }) => {
    const shortest = OVERLAY_VIEWPORTS.find((each) => each.height === 360) as Viewport;
    await openRide(page, shortest, '?side=filming');
    await page.addStyleTag({ content: '.oyl-hud__side-camera { min-height: 12rem; }' });
    const seen = await measure(page);
    expect(sideCameraCollisions(seen, shortest)).not.toEqual([]);
  });
});

/**
 * #437 — once the notice is put away, the route panel is back.
 *
 * On a phone the open notice takes the route panel's cell (above), which used
 * to be for the whole ride. The rider's *Trainer notice* control puts it away
 * — so does the ride's clock, which the fast suite covers — and then the
 * elevation strip and the plan view must be on screen, whole, over no other
 * panel and not over the rider, with the sentence still in the document.
 */
test.describe('a ride with a standing notice, once it is put away — #437', () => {
  const QUERY = '?trainer=workout';
  // `<= 480`: the short corners layout's `max-height: 30rem` is inclusive.
  const PHONES = OVERLAY_VIEWPORTS.filter(
    (each) => Math.min(each.width, each.height) <= 480 && each.height !== 752,
  );

  for (const viewport of PHONES) {
    test(`shows the strip and the plan view again — ${viewport.name}`, async ({ page }) => {
      await openRide(page, viewport, QUERY);
      const open = await measure(page);
      // The apparatus: while the notice stands open the route panel is gone —
      // the state #437 started from — so "it is back" below is a change.
      expect(open.items.some((each) => each.name === 'the plan view' && each.box.height > 0)).toBe(
        false,
      );

      await page.getByRole('button', { name: 'Trainer notice' }).click();
      for (const [how, put] of await bothWays(page)) {
        await test.step(how, async () => {
          for (const name of ['the elevation strip', 'the road ahead', 'the plan view']) {
            const item = named(put.items, name);
            expect(item.box.height, describeItem(item)).toBeGreaterThan(0);
            expect(inside(item.box, viewport), describeItem(item)).toBe(true);
          }
          const laidOut = put.panels.filter((each) => each.box.height > 1);
          expect(laidOut).toHaveLength(4);
          const collisions: string[] = [];
          laidOut.forEach((a, index) => {
            for (const b of laidOut.slice(index + 1)) {
              if (overlap(a.box, b.box)) {
                collisions.push(`${describeItem(a)} × ${describeItem(b)}`);
              }
            }
          });
          expect(collisions).toEqual([]);
          expect(
            laidOut.filter((each) => overlap(each.box, riderBox(viewport))).map(describeItem),
          ).toEqual([]);
          // The sentence is still there for a screen reader, clipped rather than
          // removed — `display: none` would take it out of the accessibility tree.
          const hidden = await page.evaluate(() => {
            const wrapper = document.querySelector('.oyl-hud__notices');
            return {
              text: wrapper?.textContent ?? '',
              display: wrapper === null ? '' : window.getComputedStyle(wrapper).display,
              visibility: wrapper === null ? '' : window.getComputedStyle(wrapper).visibility,
            };
          });
          expect(hidden.text).toContain('workout is driving your trainer');
          expect(hidden.display).not.toBe('none');
          expect(hidden.visibility).not.toBe('hidden');
        });
      }
    });

    test(`the control — the old rule hides the route even when the notice is put away — ${viewport.name}`, async ({
      page,
    }) => {
      await openRide(page, viewport, QUERY);
      await page.getByRole('button', { name: 'Trainer notice' }).click();
      await page.evaluate(() => {
        window.__oylRide?.restoreNoticeTakesTheRoute();
      });
      const seen = await measure(page);
      expect(seen.items.some((each) => each.name === 'the plan view' && each.box.height > 0)).toBe(
        false,
      );
    });
  }
});

/**
 * `game/camera.ts` §`WORST_CASE_ASPECT` — the scenery cull is safe up to a
 * frame 6 : 1 and drops visible scenery on a hairpin from 8 : 1. Until #423 that
 * was an argument about how short a window anybody would make; the world is
 * full-bleed now, so it is a `max-width` instead, and this measures it.
 */
test.describe('the world is never wider than the cull allows', () => {
  test('pillarboxes a 6.5 : 1 window at 6 : 1', async ({ page }) => {
    const wide: Viewport = { name: '2600×400', width: 2600, height: 400, unstagedFails: true };
    await openRide(page, wide);
    const seen = await measure(page);

    expect(seen.stage?.width).toBe(wide.width);
    expect(seen.world?.height).toBe(wide.height);
    expect(seen.world?.width).toBe(6 * wide.height);
    // Centred, so the pillars are equal.
    expect(seen.world?.left).toBe((wide.width - 6 * wide.height) / 2);
  });

  test('the control — an ordinary window is not pillarboxed', async ({ page }) => {
    const tablet = OVERLAY_VIEWPORTS[0] as Viewport;
    await openRide(page, tablet);
    const seen = await measure(page);

    expect(seen.world?.width).toBe(tablet.width);
    expect(seen.world?.left).toBe(0);
  });
});

/**
 * Safe areas — a notch, a gesture bar, a status bar.
 *
 * ⚠️ A headless Chromium reports zero for every `env(safe-area-inset-*)`, so
 * this sets the custom properties Capacitor's Android shell injects
 * (`theme.css` §`--oyl-safe-top` is the chain) and measures the panels moving.
 * It proves the stylesheet honours an inset it is given. It does **not** prove
 * the owner's tablet gives it one — `docs/validation/0002-android-shell-and-
 * game.md` is where that is recorded, by somebody holding the tablet.
 */
test.describe('safe areas', () => {
  const TABLET = OVERLAY_VIEWPORTS[0] as Viewport;
  const INSET = 48;

  test('holds every panel clear of an inset, and runs the world under it', async ({ page }) => {
    await openRide(page, TABLET);
    const before = await measure(page);
    await page.evaluate((pixels) => {
      window.__oylRide?.setSafeArea(pixels);
    }, INSET);
    const after = await measure(page);

    // The control: without an inset the panels sit on the stage's own 8 px
    // padding, so "clear of 48 px" below is a thing that changed.
    expect(Math.min(...before.panels.map((each) => each.box.top))).toBeLessThan(INSET);

    for (const panel of after.panels) {
      expect(panel.box.left, describeItem(panel)).toBeGreaterThanOrEqual(INSET);
      expect(panel.box.top, describeItem(panel)).toBeGreaterThanOrEqual(INSET);
      expect(panel.box.right, describeItem(panel)).toBeLessThanOrEqual(TABLET.width - INSET);
      expect(panel.box.bottom, describeItem(panel)).toBeLessThanOrEqual(TABLET.height - INSET);
    }
    // Full-bleed means under the bars: the world is decorative and a world with
    // a bar cut out of it is not full-bleed.
    expect(after.world?.width).toBe(TABLET.width);
    expect(after.world?.height).toBe(TABLET.height);
  });
});

/**
 * #439 — the full-bleed ride must not scroll, with edge-to-edge insets applied
 * to the ENGINE (`insets.ts`), not to the page.
 *
 * Measured on the owner's tablet: `scrollHeight` 868 in an 800 px WebView,
 * insets 36 + 32. The stage is `position: fixed`, so a rider did not see the
 * page move — but a drag that missed a control scrolled the document under the
 * HUD. Every viewport the ride is laid out at, with the tablet's own insets:
 * a phone's are different numbers, and the arithmetic that failed is the same.
 */
test.describe('#439 — a ride with edge-to-edge insets does not scroll', () => {
  for (const viewport of [...OVERLAY_VIEWPORTS, ...STACKED_VIEWPORTS]) {
    test(`scrollHeight === innerHeight — ${viewport.name}`, async ({ page }) => {
      await applyInsets(page, PIXEL_TABLET_LANDSCAPE_INSETS);
      await openRide(page, viewport);
      // The apparatus: the insets are really there, or "does not scroll" is a
      // statement about a desktop browser.
      expect(await resolvedInsets(page)).toEqual(PIXEL_TABLET_LANDSCAPE_INSETS);

      const seen = await measure(page);
      expect(seen.pageOverflow).toBe(0);

      // ⚠️ The control: the shell's old `min-height: 100vh`. The same page must
      // scroll again, by exactly the two insets — which is #439's 68 px.
      await page.evaluate(() => {
        window.__oylRide?.restoreFullHeightShell();
      });
      const reverted = await measure(page);
      expect(reverted.pageOverflow).toBe(
        PIXEL_TABLET_LANDSCAPE_INSETS.top + PIXEL_TABLET_LANDSCAPE_INSETS.bottom,
      );
    });
  }
});

/**
 * #1441 — the ride's controls are never under the gesture bar, with the
 * tablet's insets applied to the ENGINE (`insets.ts`) and read back, at every
 * viewport the ride is laid out at: phone and tablet, upright and on its side.
 *
 * `.oyl-hud`'s padding is what holds them clear (`theme.css` §"Safe areas"),
 * and §"safe areas" above proves it moves the panels at one tablet through the
 * custom property. This is the gesture bar's half, through `env()`, at all of
 * them: the bottom of every control is at or above the inset's top edge.
 *
 * ⚠️ The control puts the padding back to the stage's own 8 px, and the
 * actions' sticky edge with it, and a control must then sit inside the inset
 * — or "clear of it" was a layout that never reached the bottom. Measured,
 * the controls end 9 px above the inset at every viewport with the padding and
 * 15 px inside it without.
 *
 * ⚠️ **320×256 too**, the stacked layout at its shortest. Its actions panel
 * is pinned by `position: sticky`, which cannot lift it above the top of
 * `.oyl-hud`, so with the tablet's 68 px of insets and the world at its old
 * 40vh the panel ran out of room: *Pause* and *End ride* ended at 252 of 224.
 * `theme.css` §"The STACKED layout's world gives up what the insets take" is
 * the fix, and the panel that holds the controls is asserted as well as the
 * controls: with the world short of only the bottom inset the controls
 * scraped clear by 4 px while their panel ended 5 px inside the inset.
 * Measured, the controls end 9 px above the inset at every viewport with the
 * fix, and the actions panel exactly at it.
 */
const WITHOUT_BOTTOM_INSET = `
  .oyl-game--riding .oyl-hud { padding-bottom: var(--oyl-space-sm) !important; }
  .oyl-game--riding .oyl-hud__actions { bottom: var(--oyl-space-sm) !important; }
`;

test.describe('#1441 — the ride’s controls are clear of the gesture bar', () => {
  for (const viewport of [...OVERLAY_VIEWPORTS, ...STACKED_VIEWPORTS]) {
    test(`every control ends above the bottom inset — ${viewport.name}`, async ({ page }) => {
      await applyInsets(page, PIXEL_TABLET_LANDSCAPE_INSETS);
      await openRide(page, viewport);
      expect(await resolvedInsets(page)).toEqual(PIXEL_TABLET_LANDSCAPE_INSETS);
      const fold = viewport.height - PIXEL_TABLET_LANDSCAPE_INSETS.bottom;
      const lowestOf = (items: readonly StageItem[]): number =>
        Math.max(...items.map((each) => each.box.bottom));

      const seen = await measure(page);
      const controls = seen.items.filter((each) => each.name.startsWith('control: '));
      expect(controls.length, 'the apparatus: the ride rendered its controls').toBeGreaterThan(1);
      const lowest = lowestOf(controls);
      expect(
        controls.filter((each) => each.box.bottom > fold + 0.5).map(describeItem),
        'a ride control is under the gesture bar',
      ).toEqual([]);
      const actions = seen.panels.filter((each) =>
        each.name.split(' ').includes('oyl-hud__actions'),
      );
      expect(actions, 'the apparatus: the ride rendered its actions panel').toHaveLength(1);
      expect(
        actions.filter((each) => each.box.bottom > fold + 0.5).map(describeItem),
        'the panel holding the ride controls is under the gesture bar',
      ).toEqual([]);

      await page.addStyleTag({ content: WITHOUT_BOTTOM_INSET });
      const reverted = (await measure(page)).items.filter((each) =>
        each.name.startsWith('control: '),
      );
      const revertedLowest = lowestOf(reverted);
      console.log(
        `#1441 ${viewport.name}: lowest control ends at ${lowest.toFixed(1)} of ` +
          `${String(fold)}; without the padding ${revertedLowest.toFixed(1)}`,
      );
      expect(
        revertedLowest,
        'without the padding the controls stay clear, so the assertion above cannot fail here',
      ).toBeGreaterThan(fold + 0.5);
    });
  }

  /*
   * The trainer line on TWO lines, whatever the fonts. On the CI runner's
   * wider glyphs it takes two in the short corners layout's 16 rem actions
   * panel, and on a Mac one, so the case above passed on a Mac while run
   * 39323488405 found the panel at [472,181 → 728,329] against a gesture bar
   * from 328 at 736×360. `min-height: 2lh` is the runner's wrap, set here so a
   * Mac measures what the runner does: it reproduced that box exactly.
   *
   * ⚠️ The control puts back the body's 1.55 leading `theme.css` §"#1441 — the
   * trainer line at the short corners layout" takes away, and the panel must
   * then be under the gesture bar again — so the rule is what holds it clear.
   * Measured on a Mac: the panel ends at 328.0 of 328 with the rule — on the
   * gesture bar's edge, where `align-self: end` puts it when the column fits —
   * and at 329.0 without. A pixel is the whole of the fault CI found, so the
   * control's margin is that pixel and no more; Chromium lays it out the same
   * on both, which is why the forced wrap reproduced CI's box to the pixel.
   */
  const SHORT_CORNERS = OVERLAY_VIEWPORTS.find(
    (each) => each.width === 736 && each.height === 360,
  ) as Viewport;
  const TRAINER_ON_TWO_LINES = `
    .oyl-game--riding .oyl-hud .oyl-hud__actions > .oyl-hud__trainer { min-height: 2lh !important; }
  `;
  const BODY_LEADING = `
    .oyl-game--riding .oyl-hud .oyl-hud__actions > .oyl-hud__trainer { line-height: 1.55 !important; }
  `;

  test(`the actions panel stays clear with the trainer line on two lines — ${SHORT_CORNERS.name}`, async ({
    page,
  }) => {
    await applyInsets(page, PIXEL_TABLET_LANDSCAPE_INSETS);
    await openRide(page, SHORT_CORNERS);
    expect(await resolvedInsets(page)).toEqual(PIXEL_TABLET_LANDSCAPE_INSETS);
    await page.addStyleTag({ content: TRAINER_ON_TWO_LINES });
    const fold = SHORT_CORNERS.height - PIXEL_TABLET_LANDSCAPE_INSETS.bottom;
    const actionsOf = (seen: StageMeasurement): StageItem => {
      const actions = seen.panels.filter((each) =>
        each.name.split(' ').includes('oyl-hud__actions'),
      );
      expect(actions, 'the apparatus: the ride rendered its actions panel').toHaveLength(1);
      return actions[0] as StageItem;
    };

    const seen = await measure(page);
    const line = named(seen.items, 'the trainer line');
    // The apparatus: two lines of the leading this case is about, so a
    // trainer line that went away cannot pass it.
    expect(line.box.height, 'the trainer line, on two lines').toBeGreaterThan(40);
    const controls = seen.items.filter((each) => each.name.startsWith('control: '));
    expect(controls.length, 'the apparatus: the ride rendered its controls').toBeGreaterThan(1);
    expect(
      controls.filter((each) => each.box.bottom > fold + 0.5).map(describeItem),
      'a ride control is under the gesture bar',
    ).toEqual([]);
    const panel = actionsOf(seen);
    expect(
      panel.box.bottom,
      `the panel holding the ride controls is under the gesture bar: ${describeItem(panel)}`,
    ).toBeLessThanOrEqual(fold + 0.5);

    await page.addStyleTag({ content: BODY_LEADING });
    const reverted = actionsOf(await measure(page));
    console.log(
      `#1441 ${SHORT_CORNERS.name}, the trainer line on two lines: the actions panel ends at ` +
        `${panel.box.bottom.toFixed(1)} of ${String(fold)}; at the body's leading ` +
        `${reverted.box.bottom.toFixed(1)}`,
    );
    expect(
      reverted.box.bottom,
      'at the body’s leading the panel stays clear, so the assertion above cannot fail here',
    ).toBeGreaterThan(fold + 0.5);
  });
});

/**
 * The owner's ruling of 2026-11-06 (#2034): what a phone's overlay gives way
 * — the ride so far among it — is tied to PHONES, so a laptop's or a
 * desktop's window under 47 rem tall draws it, on a plain ride and in a
 * room, and its layout holds the ride's own invariants there: every reading
 * and control on the stage and uncovered, every panel whole, none over
 * another or over the leaning rider. In a room the pacer, the ghost and the
 * wind give way first under 45 rem tall, and stay in a 1280×720 window; and under 40 rem tall (1024×600), while
 * two notices are drawn, the ride so far gives way (`theme.css` §"THE RIDE SO
 * FAR AT ARM'S LENGTH").
 */
/** A room with *Report*'s reasons open, sounds on and a side camera filming. */
const SIDE_CAMERA_ROOM = '?room=report&sounds=on&side=filming';

/** Two notices drawn: *Keep the screen on* and the road notice. */
const TWO_NOTICES = '?keepalive=failed&trainer=workout';

/** #2076's three, which a laptop's window under 40 rem tall gives way to two notices. */
const RIDE_SO_FAR: readonly string[] = [
  'reading: Distance',
  'reading: Climbed',
  'reading: Avg power',
];

for (const viewport of LAPTOP_VIEWPORTS) {
  for (const query of [
    '',
    '?room=following',
    TWO_NOTICES,
    // A room at its fullest with a side camera's row: `main` itself runs it
    // off a 1024×600 stage, so it is held where `main` holds it.
    ...(viewport.height >= 640 ? [SIDE_CAMERA_ROOM] : []),
  ]) {
    const state =
      query === ''
        ? ''
        : query === TWO_NOTICES
          ? ', with two notices drawn'
          : query === SIDE_CAMERA_ROOM
            ? ', in a room with Report open and a side camera'
            : ', in a room';
    test(`#2034 a laptop's window draws the ride so far${state} — ${viewport.name}`, async ({
      browser,
    }) => {
      const page = await sharedRide(browser, viewport, query);
      for (const [how, seen] of await bothWays(page)) {
        const rideSoFarGivesWay = query === TWO_NOTICES && viewport.height < 640;
        for (const name of RIDE_TOTAL_READINGS) {
          if (rideSoFarGivesWay && RIDE_SO_FAR.includes(name)) {
            expect(seen.givenWay, how).toContain(name);
            continue;
          }
          const reading = named(seen.items, name);
          expect(
            inside(reading.box, viewport) && reading.onTop,
            `${how}: ${describeItem(reading)}`,
          ).toBe(true);
        }
        // #2078: and the recent graph, which gives way under 40 rem tall
        // (1024×600) and, as on the 4:3 tablet, while two notices are drawn.
        const graphDrawn = viewport.height >= 640 && query !== TWO_NOTICES;
        if (graphDrawn) {
          const graph = named(seen.items, 'the recent graph');
          expect(inside(graph.box, viewport) && graph.onTop, `${how}: ${describeItem(graph)}`).toBe(
            true,
          );
        } else {
          expect(seen.givenWay, how).toContain('the recent graph');
        }
        const clipped = seen.items
          .filter((each) => each.box.width * each.box.height <= 1)
          .map((each) => each.name);
        // In a room the pacer, the ghost and the wind give way only where
        // they do not fit: under 40 rem tall, and under 45 rem with a side
        // camera's row (1366×657).
        const givesWay =
          (query === '?room=following' && roomGivesWay(viewport)) ||
          (query === SIDE_CAMERA_ROOM && viewport.height < 720);
        expect(clipped, how).toEqual(
          givesWay ? ['reading: Pacer', 'reading: Your best', 'reading: Wind'] : [],
        );
        const lost = seen.items
          .filter((each) => !clipped.includes(each.name))
          .filter((each) => !inside(each.box, viewport) || !each.onTop)
          .map(describeItem);
        expect(lost, how).toEqual([]);
        const rider = riderBox(viewport);
        const faults: string[] = [];
        seen.panels.forEach((a, index) => {
          if (!inside(a.box, viewport)) faults.push(`not whole: ${describeItem(a)}`);
          if (overlap(a.box, rider)) faults.push(`over the rider: ${describeItem(a)}`);
          for (const b of seen.panels.slice(index + 1)) {
            if (overlap(a.box, b.box)) faults.push(`${describeItem(a)} × ${describeItem(b)}`);
          }
        });
        expect(faults, how).toEqual([]);
      }
    });
  }
}

/**
 * PR #2220's review: the 1024×600 rule counts only DRAWN notices. Folding the
 * road notice away leaves its wrapper in the cell, visually hidden; with only
 * *Keep the screen on* drawn, the ride so far is drawn again.
 */
test('#2034 the folded road notice does not count — the ride so far comes back — a small laptop window — 1024×600', async ({
  page,
}) => {
  const viewport = LAPTOP_VIEWPORTS.find((each) => each.height === 600) as Viewport;
  await openRide(page, viewport, TWO_NOTICES);
  await expect.poll(async () => (await measure(page)).givenWay).toContain('reading: Distance');
  await page.getByRole('button', { name: 'Trainer notice' }).click();
  await expect.poll(async () => (await measure(page)).givenWay).not.toContain('reading: Distance');
  for (const [how, seen] of await bothWays(page)) {
    for (const name of RIDE_SO_FAR) {
      const reading = named(seen.items, name);
      expect(
        inside(reading.box, viewport) && reading.onTop,
        `${how}: ${describeItem(reading)}`,
      ).toBe(true);
    }
  }
});

/**
 * #2349 — the end-of-ride question, standing in the actions panel where
 * *Pause* and *End ride* were (`ride/EndRideQuestion.tsx`): its answers on the
 * stage, uncovered, with no scrolling, and the panel holding them whole, over
 * no other panel and not over the leaning rider, at every overlay viewport and
 * both ways — the layout's own invariants (`ride-stage.ts` §`layoutFaults`) —
 * for the question and for its discard step, whose warning makes it the
 * tallest. A reading the layout gives way to while it is open (upright, the
 * moving time: `theme.css` §"#2349") is clipped to a pixel and set aside.
 *
 * Here rather than in `ride-hud-layout.browser.spec.ts`, whose shard has no
 * time to spare: the first CI run of #2349 with these cases there ran that
 * shard past its 720 s budget with one case not run.
 */
const END_STEPS = [
  ['the question', '?end=asked', ['Keep riding', 'Save ride', 'Discard ride']],
  ['its discard step', '?end=discard', ['Discard ride', 'Keep riding']],
] as const;

for (const [step, query, answers] of END_STEPS) {
  for (const viewport of OVERLAY_VIEWPORTS) {
    test(`#2349 ${step} holds the HUD’s layout — ${viewport.name}`, async ({ browser }) => {
      const page = await sharedRide(browser, viewport, query);
      for (const [how, seen] of await bothWays(page)) {
        const clipped = [...seen.items, ...seen.panels]
          .filter((each) => each.box.width * each.box.height <= 1)
          .map((each) => each.name);
        const faults = layoutFaults(seen, viewport).filter(
          (fault) =>
            !clipped.some(
              (name) =>
                fault.startsWith(`lost: ${name} [`) || fault.startsWith(`not whole: ${name} [`),
            ),
        );
        expect(faults, how).toEqual([]);
        const names = seen.items.map((each) => each.name);
        for (const answer of answers) {
          expect(names, how).toContain(`end ride: ${answer}`);
          expect(clipped, how).not.toContain(`end ride: ${answer}`);
        }
        // Pause and End ride give way to it, rather than standing beside it.
        expect(names, how).not.toContain('control: End ride');
      }
    });
  }
}
