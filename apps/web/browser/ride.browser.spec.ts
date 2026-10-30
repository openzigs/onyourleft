// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The ride's stage, measured by a real engine — #373, #419, #422 and #423.
 *
 * ## What was wrong, as three people measured it
 *
 * - **#373**, a tablet, 2026-09-19: `Trainer: simulating −0.4% (352 sent)` —
 *   the only rider-visible evidence a gradient is reaching the trainer — was
 *   outside the viewport in landscape.
 * - **#419**, this harness's own first run: the HUD panel was **572 px** tall
 *   under a canvas, so *Pause* and *End ride* sat at y = 958 of a 390 px
 *   viewport, y = 1112 of an 844 px one, and y = 1092 on a 1280×800 tablet.
 *   Below the fold at every viewport tried.
 * - **#422**, the owner's Pixel Tablet in landscape, 2026-09-20: the same, on
 *   hardware, beside a display that was about 53 % blank. ⚠️ #373 had moved the
 *   line *into* the panel and called landscape solved; the panel itself ran off
 *   the bottom, so it was not.
 *
 * #423 fixes all three by design rather than by moving things: while a ride
 * runs the world is full-bleed, the page chrome is absent, and the HUD is four
 * small opaque panels laid over the world's corners.
 *
 * ## ⚠️ A reviewer who remembers this file is reading the old one
 *
 * It used to assert that **reaching the ride controls** — by scrolling —
 * brought the trainer line on screen, and it carried a case named *"the HUD
 * panel is taller than a landscape phone viewport"* which asserted #419's
 * premise and said of itself that it would go red when #419 was fixed and
 * should then be **removed rather than loosened**. It has been: there is no
 * panel taller than a viewport any more, and nothing here scrolls to anything.
 * Every assertion below is taken at `scrollY === 0`.
 *
 * ## The viewports, and the one that was missing
 *
 * `shell.browser.spec.ts` measures at 320×256 and `hud.browser.spec.ts` at a
 * phone. **Nothing measured a ride screen at a landscape-tablet viewport**,
 * which is the single most likely way this app is used — clamped to the bars,
 * wide — and is where both defects were found. 1280×800 is the Pixel Tablet's
 * own CSS viewport (2560×1600 at a device pixel ratio of 2).
 *
 * ## The control, and the vacuous pass it is there to prevent
 *
 * ⚠️ "Every control is inside the viewport" is satisfied by a page that
 * rendered nothing, a stylesheet that failed to load, and a ride that never
 * started. So every landscape and every stacked viewport is measured **twice**
 * (an upright overlay viewport cannot carry this control, and
 * `Viewport.unstagedFails` says why and what stands in for it): as shipped, and
 * again after `unstage()` has taken `oyl-game--riding` off the live element —
 * the same DOM under the same stylesheet at the same viewport, minus the one
 * class #423 added. The second measurement is required to **fail**: *Pause* below the
 * fold again, which is #419's own finding. `ride-harness.tsx` says why React
 * does not put the class back.
 *
 * ## Both ways: with anchor positioning and without it — #1120
 *
 * Three rules on a phone draw a thing somewhere other than where the document
 * puts it — #576's side-camera row on its side, #1111's moving time below
 * 802 px on its side and upright — and each does it by CSS anchor positioning,
 * which is Android System WebView / Chrome 125 or later. An older WebView takes
 * the `@supports not (anchor-name: …)` fallbacks instead. So every case below
 * that holds a floor on the stage at an overlay viewport holds it TWICE, on
 * the same load: as the page is, and as an engine without anchor positioning
 * lays it out (§`withoutAnchors`, `ride-harness.tsx` §`withoutAnchors` — the
 * anchor blocks taken out through the CSSOM, the fallbacks put in force, and
 * the stylesheet put back, in one synchronous call). A failure says which
 * (`test.step`). ⚠️ The instrument cannot pass over a page where nothing was
 * taken out (§"the instrument"), and the controls take the fallbacks out as
 * well — `main` before #1120 — and require the floors to FAIL.
 *
 * ⚠️ **Read `ride-harness.tsx`'s header before reading a number here**, and in
 * particular what the page does not prove.
 *
 * ## Five files since #1414, and a reviewer who remembers one is reading the old file
 *
 * This was one spec of 609 cases, and Playwright runs one file's cases in one
 * worker (the config is not `fullyParallel`, and `shared-load.ts` is why it
 * must not be), so the file was a single six-minute group that `--shard`
 * could not divide: `browser-1` ran 10.8 of its 12 minutes (run 39045325469)
 * while `browser-2` ran 3.1. It is divided by section, with nothing changed
 * inside a case, so a `§"…"` reference elsewhere to a section of
 * `ride.browser.spec.ts` now names one of these:
 *
 * - **here**: the stage at every overlay and stacked viewport, the moving
 *   time's band, a standing notice and once it is put away, a workout eased
 *   (#585), sounds on, a side camera paired (#551), the cull, safe areas and
 *   #439's insets;
 * - **`ride-notices.browser.spec.ts`**: a ride that may stop with the screen
 *   off (#647), the room's notice (#785), and keep the screen on beside every
 *   notice that stays;
 * - **`pre-ride.browser.spec.ts`**: #940's pre-ride chooser, its notices
 *   never hidden while *Ride* is offered, and #1011's route tiles;
 * - **`ride-workout.browser.spec.ts`**: a running workout on the HUD (#1307),
 *   *Keep the plan* (#1244), a ride on a loop (#1312), and a lap ending while
 *   a re-plan waits;
 * - **`ride-room.browser.spec.ts`**: a race's standings (#1347), *Report*
 *   (#789), a room ride's HUD (#1356), a rider near (#1358), a room ride with
 *   sounds on (#1398), #1407, and sounds beside a side camera (#1409);
 * - **`ride-delivery.browser.spec.ts`**: a Delivery round's HUD and throw
 *   control at its start and nearly over (#1816), a sixth file since.
 *
 * What more than one of them reads — the viewports, `openRide`, the
 * measuring and both-ways helpers — is `ride-stage.ts`, unchanged but for
 * its `export`s. docs/agents/ci.md §4c "Five ride files — #1414" has
 * the measurements before and after.
 */

import { expect, test, type Page } from '@playwright/test';

import { applyInsets, PIXEL_TABLET_LANDSCAPE_INSETS, resolvedInsets } from './insets';
import {
  SUBPIXEL_TOLERANCE,
  MINIMUM_TIER_RATIO,
  HUD_SURFACE,
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
  usesAnchorPositioning,
  MAIN_FALLBACK_OVER_THE_RIDER,
  ANCHORED,
  bothWays,
  MOVING_TIME_SPARE_PIXELS,
  easedCollisions,
  EASED_RIDER_CLEARANCE_PIXELS,
  noticeText,
} from './ride-stage';
import { attachSharedPageOnFailure, releaseSharedPage } from './shared-load';

import { workoutRescueText } from '../src/workout/rescue-text';

import type { Box, StageItem, StageMeasurement } from './ride-harness';

// The page the cases below share goes when this file's cases do (`shared-load.ts`).
test.afterAll(releaseSharedPage);
// What a red shared case read, since the `page` fixture's screenshot is not it (#1076).
test.afterEach(async () => {
  await attachSharedPageOnFailure(test.info());
});

for (const viewport of OVERLAY_VIEWPORTS) {
  test.describe(viewport.name, () => {
    /**
     * ⚠️ The apparatus check, and it is not ceremony. Every case below is a
     * statement about a list, and a list of nothing satisfies all of them. The
     * first version of `ride-harness.tsx` (#373) unmounted the whole shell and
     * set its ready flag anyway; this is what a harness like that fails.
     */
    test('the harness is on the stage, with the widest HUD a rider can start', async ({
      browser,
    }) => {
      const page = await sharedRide(browser, viewport);
      const seen = await measure(page);

      expect(seen.viewport).toEqual({ width: viewport.width, height: viewport.height });
      // The stylesheet resolved: the token rather than `rgba(0, 0, 0, 0)`.
      expect(seen.panelBackground).toBe(HUD_SURFACE);
      expect(seen.primary).toEqual(['Power', 'Cadence', 'Heart rate']);
      // A pacer, a ghost AND a wind — seven, where an ordinary ride has five;
      // and since #1111 the moving time, beside the distance to go.
      expect(seen.secondary).toEqual([
        'Speed',
        'Gradient',
        'To go',
        'Moving',
        'Pacer',
        'Your best',
        'Wind',
      ]);
      expect(seen.panels).toHaveLength(4);
      // Ten readings, the strip, the plan view, the trainer line, two controls
      // and, since #1482, the touch lock.
      expect(seen.items).toHaveLength(16);
    });

    test('the world fills the viewport', async ({ browser }) => {
      const page = await sharedRide(browser, viewport);
      const seen = await measure(page);

      for (const box of [seen.stage, seen.world]) {
        expect(box?.left).toBe(0);
        expect(box?.top).toBe(0);
        expect(box?.width).toBe(viewport.width);
        expect(box?.height).toBe(viewport.height);
      }
    });

    test('the page chrome is absent', async ({ browser }) => {
      const page = await sharedRide(browser, viewport);
      const seen = await measure(page);

      expect(seen.chrome).toEqual({
        header: false,
        navigation: false,
        summary: false,
        footer: false,
        skipLink: false,
      });
    });

    /**
     * #419, #422 and #423's second criterion, in one assertion: **every**
     * reading, the strip, the plan view, the trainer line, *Pause* and *End
     * ride*, wholly inside the viewport, uncovered, with nothing scrolled —
     * and nothing scrollable, so there is no second position to be wrong at.
     */
    test('every reading and every control is on screen with no scrolling', async ({ browser }) => {
      const page = await sharedRide(browser, viewport);
      // #1120: and as an engine without anchor positioning lays it out.
      for (const [how, seen] of await bothWays(page)) {
        expect(seen.scrollY, how).toBe(0);
        expect(seen.stageScrollTop, how).toBe(0);
        expect(seen.pageOverflow, how).toBeLessThanOrEqual(0);
        const lost = seen.items.filter((each) => !inside(each.box, viewport) || !each.onTop);
        expect(lost.map(describeItem), how).toEqual([]);
      }
    });

    /**
     * ⚠️ The stage is `overflow: hidden` in the overlay layouts, so a panel that
     * outgrew its cell would be CLIPPED — and a clipped panel still has a box,
     * which is why this asks about the panels as well as about what is in them.
     */
    test('every panel is whole, and no panel is laid over another', async ({ browser }) => {
      const page = await sharedRide(browser, viewport);
      for (const [how, seen] of await bothWays(page)) {
        expect(
          seen.panels.filter((each) => !inside(each.box, viewport)).map(describeItem),
          how,
        ).toEqual([]);
        const collisions: string[] = [];
        seen.panels.forEach((a, index) => {
          for (const b of seen.panels.slice(index + 1)) {
            if (overlap(a.box, b.box)) {
              collisions.push(`${describeItem(a)} × ${describeItem(b)}`);
            }
          }
        });
        expect(collisions, how).toEqual([]);
      }
    });

    /**
     * The centre is clear — where the rider IS, rather than where a diagram
     * says the middle is.
     *
     * `camera.ts` §`riderFrameBox` is the rectangle the rider's bicycle is
     * drawn into, as fractions of the frame, derived from the camera's own
     * constants; `game.browser.spec.ts` checks that arithmetic against pixels
     * the real renderer drew. A panel over that box is a panel over the one
     * thing #424 exists to make prominent.
     */
    test('no panel is laid over the rider', async ({ browser }) => {
      const page = await sharedRide(browser, viewport);
      const box = riderBox(viewport);
      for (const [how, seen] of await bothWays(page)) {
        expect(seen.panels.filter((each) => overlap(each.box, box)).map(describeItem), how).toEqual(
          [],
        );
      }
    });

    /**
     * ⚠️ The control for the case above — #512. The same page, with the rider
     * UPRIGHT: the box is narrower by the helmet's roll, so a layout that only
     * ever measured this one was green over a rider who leaned. Reported
     * rather than asserted, so a reader of the run sees both widths.
     */
    test('the rider’s box, upright and at the lean cap, is a measurement', async ({
      browser,
    }, testInfo) => {
      const page = await sharedRide(browser, viewport);
      const upright = riderBox(viewport, 0);
      const leaning = riderBox(viewport);
      expect(leaning.width).toBeGreaterThan(upright.width * 2);
      for (const [how, seen] of await bothWays(page)) {
        // How much room the bottom row leaves, either side: the panels that
        // share the box's rows, and their horizontal clearance from it.
        const nearest = Math.min(
          ...seen.panels
            .filter((each) => each.box.bottom > leaning.top && each.box.top < leaning.bottom)
            .map((each) => Math.max(leaning.left - each.box.right, each.box.left - leaning.right)),
        );
        const clearance = Number.isFinite(nearest)
          ? `nearest panel edge on its rows ${nearest.toFixed(0)} px clear`
          : 'no panel on its rows';
        const measured = `leaning box ${leaning.left.toFixed(0)}–${leaning.right.toFixed(0)} px (upright ${upright.left.toFixed(0)}–${upright.right.toFixed(0)}); ${clearance}`;
        testInfo.annotations.push({ type: '#512', description: `${how}: ${measured}` });
        console.log(`#512 — ${viewport.name} — ${how} — ${measured}`);
        expect(
          seen.panels.filter((each) => overlap(each.box, upright)).map(describeItem),
          how,
        ).toEqual([]);
      }
    });

    /**
     * #1111: the moving time, at its widest (`ride-harness.tsx`
     * §`MOVING_SECONDS`, 9:59:59), on the stage and clear of the LEANING
     * rider and of every ride control — its margins published. The cases
     * above already hold it inside the viewport, uncovered, with no panel
     * over another or over the rider; this one names it, so the numbers a
     * reviewer asks for are in the run.
     */
    test('the moving time is on the stage, clear of the rider and of every control — #1111', async ({
      browser,
    }, testInfo) => {
      const page = await sharedRide(browser, viewport);
      // And `10:00:00` at the word size (`fields.ts` §`movingTimeReading`),
      // set on the live element for one synchronous read and put back: no
      // fixture rides for ten hours. With anchor positioning only: the field
      // is the same width without it (6 rem upright, the primary panel's
      // inner width on its side), which the 9:59:59 fit below reads both ways.
      const atTen = await page.evaluate(() => {
        const row = [...document.querySelectorAll<HTMLElement>('.oyl-hud__field')].find(
          (each) => each.querySelector('dt')?.textContent === 'Moving',
        );
        const value = row?.querySelector<HTMLElement>('dd');
        const text = value?.firstChild;
        if (row === undefined || value === undefined || value === null || !(text instanceof Text)) {
          return undefined;
        }
        const before = text.data;
        text.data = '10:00:00';
        value.classList.add('oyl-hud__value--word');
        const range = document.createRange();
        range.selectNodeContents(text);
        const measured = {
          width: range.getBoundingClientRect().width,
          lines: range.getClientRects().length,
          field: row.getBoundingClientRect().width,
        };
        text.data = before;
        value.classList.remove('oyl-hud__value--word');
        return measured;
      });
      const ten = atTen ?? { width: Infinity, lines: 0, field: 0 };
      const leaning = riderBox(viewport);

      for (const [how, seen] of await bothWays(page)) {
        const shown = seen.moving;
        expect(shown.text, how).toBe('9:59:59');
        // #1111's review: one line, and inside its own field, read off this
        // engine's fonts. A time broken at a colon reads as two numbers, and on
        // the CI runner's fonts `9:59:59` did break in an 89 px track (run
        // 37229623180) — `theme.css` §"THE MOVING TIME ON A NARROW PHONE ON ITS
        // SIDE" draws it across the primary panel there now. It is never
        // broken, so a time too wide would spill rather than wrap; the width is
        // what catches that.
        expect(shown.lines, how).toBe(1);
        expect(shown.width, how).toBeLessThanOrEqual(shown.field + SUBPIXEL_TOLERANCE);
        // #1124: and with room to spare, published below.
        const spare = shown.field - shown.width;
        expect(spare, `${how}: ${spare.toFixed(1)} px to spare`).toBeGreaterThanOrEqual(
          MOVING_TIME_SPARE_PIXELS,
        );
        expect(
          shown.secondaryOverflow,
          `${how}: the secondary tier past its panel`,
        ).toBeLessThanOrEqual(0);
        let fits =
          `9:59:59 ${shown.width.toFixed(1)} px in a ${shown.field.toFixed(1)} px field ` +
          `(${(shown.field - shown.width).toFixed(1)} px to spare)`;
        if (how === ANCHORED) {
          fits +=
            `; 10:00:00 at the word size ${ten.width.toFixed(1)} px in ${ten.field.toFixed(1)} px ` +
            `(${(ten.field - ten.width).toFixed(1)} px to spare)`;
          expect(ten.lines, fits).toBe(1);
          expect(ten.width, fits).toBeLessThanOrEqual(ten.field + SUBPIXEL_TOLERANCE);
        }
        console.log(`#1111 fit — ${viewport.name} — ${how} — ${fits}`);

        const field = named(seen.items, 'reading: Moving');
        expect(inside(field.box, viewport), how).toBe(true);
        expect(field.onTop, how).toBe(true);
        expect(overlap(field.box, leaning), how).toBe(false);
        const controls = seen.items.filter((each) => each.name.startsWith('control: '));
        expect(controls.length).toBeGreaterThanOrEqual(2);
        expect(
          controls.filter((each) => overlap(each.box, field.box)).map(describeItem),
          how,
        ).toEqual([]);
        // Nor over any other reading: below 802 px on its side it is drawn
        // INSIDE the primary panel, under the three numbers, which pads itself
        // to make the room (`theme.css` §"THE MOVING TIME ON A NARROW PHONE ON
        // ITS SIDE") — so the panel checks cannot see it land on them.
        expect(
          seen.items
            .filter((each) => each !== field && overlap(each.box, field.box))
            .map(describeItem),
          how,
        ).toEqual([]);

        // Edge-to-edge clearance between two boxes: the larger of the two axis
        // gaps, which is positive exactly when they do not overlap.
        const clear = (a: Box, b: Box): number =>
          Math.max(a.left - b.right, b.left - a.right, a.top - b.bottom, b.top - a.bottom);
        const toRider = clear(field.box, leaning);
        const toControl = Math.min(...controls.map((each) => clear(each.box, field.box)));
        const toBottom = viewport.height - field.box.bottom;
        const measured =
          `moving time ${describeItem(field)}; ${toRider.toFixed(1)} px clear of the leaning ` +
          `rider, ${toControl.toFixed(1)} px of the nearest control, ` +
          `${toBottom.toFixed(1)} px above the bottom of the stage`;
        testInfo.annotations.push({ type: '#1111', description: `${how}: ${measured}` });
        console.log(`#1111 — ${viewport.name} — ${how} — ${measured}`);
        expect(toRider, how).toBeGreaterThan(0);
      }
    });

    test('a primary reading is visibly larger than a secondary one', async ({ browser }) => {
      const page = await sharedRide(browser, viewport);
      const seen = await measure(page);

      expect(seen.secondaryValuePixels).toBeGreaterThan(0);
      expect(seen.primaryValuePixels / seen.secondaryValuePixels).toBeGreaterThanOrEqual(
        MINIMUM_TIER_RATIO,
      );
    });

    /**
     * #373's property, kept: the line is above the controls **in the panel the
     * controls are in**, so a rider who can see *Pause* can see it.
     */
    test('the trainer line is above the ride controls, in their panel', async ({ browser }) => {
      const page = await sharedRide(browser, viewport);
      for (const [how, seen] of await bothWays(page)) {
        const line = named(seen.items, 'the trainer line').box;
        const pause = named(seen.items, 'control: Pause').box;
        const actions = seen.panels.find((each) => each.name.includes('oyl-hud__actions'))?.box;
        expect(actions, how).toBeDefined();
        expect(line.bottom, how).toBeLessThanOrEqual(pause.top);
        for (const box of [line, pause]) {
          expect(box.top, how).toBeGreaterThanOrEqual(actions?.top ?? Number.POSITIVE_INFINITY);
          expect(box.bottom, how).toBeLessThanOrEqual(actions?.bottom ?? 0);
        }
      }
    });

    /**
     * #1120 — the instrument every "without anchor positioning" measurement in
     * this file is taken with. Where the layout uses anchors at all — a phone
     * on its side in the short corners layout, and the column layout — the
     * stage had something laid out by them BEFORE the blocks were taken out,
     * and nothing after; where it does not (a tablet, 800×1280), nothing
     * before either. So "it holds without anchors" is never a statement about
     * a page that did not use them, and never about a page they were left on.
     */
    test('the instrument — anchors in use exactly where the layout uses them, and none once taken out — #1120', async ({
      browser,
    }) => {
      const page = await sharedRide(browser, viewport);
      const bare = await withoutAnchors(page);
      const usesAnchors = usesAnchorPositioning(viewport);
      console.log(
        `#1120 instrument — ${viewport.name} — ${String(bare.anchoredBefore)} element(s) laid ` +
          `out by anchor positioning, 0 once the blocks are out`,
      );
      expect(bare.anchoredBefore > 0).toBe(usesAnchors);
    });

    /**
     * #1120's control. The layout `main` gave an engine without anchor
     * positioning — the anchor blocks gone and no fallback in their place —
     * must put a panel over the leaning rider here, which is what #1111's
     * review and #1120 measured (13 cases at 360×752 and 360×800; 16 at
     * 736×360): the moving time a third secondary row. Without this, every
     * "without anchor positioning" pass above is as true of a fallback that
     * was never needed, or never applied.
     */
    if (MAIN_FALLBACK_OVER_THE_RIDER.has(`${String(viewport.width)}×${String(viewport.height)}`)) {
      test('the control — without anchors and without the fallback, a panel is over the rider — #1120', async ({
        browser,
      }) => {
        const page = await sharedRide(browser, viewport);
        const leaning = riderBox(viewport);
        const before = await withoutAnchors(page, 'none');
        const over = before.panels.filter((each) => overlap(each.box, leaning)).map(describeItem);
        console.log(
          `#1120 control — ${viewport.name} — as main laid it out without anchors: ` +
            `${over.length === 0 ? 'nothing over the rider' : over.join('; ')}`,
        );
        expect(over).not.toEqual([]);
      });
    }

    /**
     * ⚠️ **The control.** See this file's header. Same DOM, same stylesheet,
     * same viewport, without the stage: *End ride* must not be reachable
     * without scrolling, or every case above passes over anything.
     */
    test('the control — without the stage, End ride is below the fold again', async ({ page }) => {
      test.skip(!viewport.unstagedFails, 'the stacked page fits here — see Viewport.unstagedFails');
      await openRide(page, viewport);
      await page.evaluate(() => {
        window.__oylRide?.unstage();
      });
      const seen = await measure(page);

      expect(seen.stage).toBeUndefined();
      const end = named(seen.items, 'control: End ride');
      expect(end.box.height).toBeGreaterThan(0);
      expect(end.box.bottom).toBeGreaterThan(viewport.height + SUBPIXEL_TOLERANCE);
    });
  });
}

/**
 * Where four panels cannot share the screen with a world.
 *
 * The stage becomes one scrolling column and the actions panel is pinned to
 * its bottom edge, so *Pause*, *End ride* and the trainer line are on screen
 * without a rider scrolling for them — which is #419's first criterion at the
 * viewports least able to meet it. The READINGS pass beneath and are scrolled
 * to; that is the cost, it is `theme.css` §`.oyl-game--riding`'s to argue, and
 * it is why this block does not assert what the overlay blocks assert.
 */
/**
 * #1124 — a phone on its side from 802 px to the first overlay viewport
 * (844×390), which no case above measures. From 802 px four EQUAL secondary
 * tracks fitted, 88 to 93.5 px, and `9:59:59` is 92.5 px on the CI runner's
 * fonts: measured for #1124, the time ran up to 4.5 px past its field at
 * 802×390 with every gate green. Here the time draws in the primary panel up
 * to 51 rem and in a content-sized fourth track from there; each viewport is
 * held to one line, {@link MOVING_TIME_SPARE_PIXELS} to spare and no overlap
 * with any other reading or control, both ways. A tall one (802×600, a
 * corners layout outside the short band) has three tracks.
 */
const MOVING_TIME_BAND_VIEWPORTS: readonly Viewport[] = [
  { name: 'a phone on its side — 802×390', width: 802, height: 390, unstagedFails: true },
  { name: 'a phone on its side — 816×390', width: 816, height: 390, unstagedFails: true },
  { name: 'a phone on its side — 820×390', width: 820, height: 390, unstagedFails: true },
  { name: 'a short tablet window — 802×600', width: 802, height: 600, unstagedFails: true },
];

for (const viewport of MOVING_TIME_BAND_VIEWPORTS) {
  test(`#1124 — the moving time fits its field with room to spare — ${viewport.name}`, async ({
    page,
  }, testInfo) => {
    await openRide(page, viewport);
    const leaning = riderBox(viewport);
    const rider =
      `the leaning rider [${leaning.left.toFixed(0)},${leaning.top.toFixed(0)} → ` +
      `${leaning.right.toFixed(0)},${leaning.bottom.toFixed(0)}]`;
    for (const [how, seen] of await bothWays(page)) {
      const shown = seen.moving;
      const spare = shown.field - shown.width;
      const field = named(seen.items, 'reading: Moving');
      const note =
        `${how}: 9:59:59 ${shown.width.toFixed(1)} px in a ${shown.field.toFixed(1)} px field ` +
        `(${spare.toFixed(1)} px to spare); secondary tier ${String(shown.secondaryOverflow)} px ` +
        `past its panel; ${describeItem(field)}`;
      testInfo.annotations.push({ type: '#1124', description: note });
      console.log(`#1124 — ${viewport.name} — ${note}`);
      expect(shown.text, note).toBe('9:59:59');
      expect(shown.lines, note).toBe(1);
      expect(spare, note).toBeGreaterThanOrEqual(MOVING_TIME_SPARE_PIXELS);
      // The room is not taken by running the grid past its panel.
      expect(shown.secondaryOverflow, note).toBeLessThanOrEqual(0);
      expect(inside(field.box, viewport), note).toBe(true);
      expect(
        seen.items
          .filter((each) => each !== field && overlap(each.box, field.box))
          .map(describeItem),
        note,
      ).toEqual([]);
      // #1169: and these widths hold the overlay viewports' "no panel over
      // the rider" too. At 802×600 the route and actions panels lay over the
      // leaning rider's box, on `main`, and these cases did not look.
      expect(
        seen.panels.filter((each) => overlap(each.box, leaning)).map(describeItem),
        `${how}: a panel over ${rider}`,
      ).toEqual([]);
    }
  });
}

/**
 * #1169 — the MIDDLE corners layout, more than 30 rem and under 47 rem tall,
 * which no overlay viewport above is (802×600 is in §"#1124"). Its bottom row
 * kept a tablet's 18 rem and 20 rem, and the leaning rider's box, which grows
 * with the height, lay under one or both panels from 736 to 880 px wide on
 * `main`. `theme.css` §"THE MIDDLE corners layout's bottom row" narrows the
 * panels to stop short of the box. The band's narrowest width at a short and
 * a tall height, where the panels are narrowest, and one wider, where on
 * `main` only the actions panel was over the rider. Each also holds the
 * controls inside the narrowed actions panel.
 */
const MIDDLE_CORNERS_VIEWPORTS: readonly Viewport[] = [
  { name: 'a short window, narrow — 736×560', width: 736, height: 560, unstagedFails: true },
  {
    name: 'the tallest middle corners layout — 736×751',
    width: 736,
    height: 751,
    unstagedFails: true,
  },
  { name: 'a short window — 840×600', width: 840, height: 600, unstagedFails: true },
];

for (const viewport of MIDDLE_CORNERS_VIEWPORTS) {
  test(`#1169 — no panel is laid over the leaning rider — ${viewport.name}`, async ({
    browser,
  }) => {
    const page = await sharedRide(browser, viewport);
    const leaning = riderBox(viewport);
    const rider =
      `the leaning rider [${leaning.left.toFixed(0)},${leaning.top.toFixed(0)} → ` +
      `${leaning.right.toFixed(0)},${leaning.bottom.toFixed(0)}]`;
    for (const [how, seen] of await bothWays(page)) {
      expect(
        seen.panels.filter((each) => overlap(each.box, leaning)).map(describeItem),
        `${how}: a panel over ${rider}`,
      ).toEqual([]);
      // The narrowing is not paid for with a control off its panel.
      const actions = seen.panels.find((each) => each.name.includes('oyl-hud__actions'));
      for (const name of ['control: Pause', 'control: End ride', 'control: Lock']) {
        const item = named(seen.items, name);
        expect(inside(item.box, viewport), `${how}: ${describeItem(item)}`).toBe(true);
        expect(
          actions !== undefined &&
            item.box.left >= actions.box.left - SUBPIXEL_TOLERANCE &&
            item.box.right <= actions.box.right + SUBPIXEL_TOLERANCE,
          `${how}: ${describeItem(item)} inside its panel`,
        ).toBe(true);
      }
    }
  });
}

for (const viewport of STACKED_VIEWPORTS) {
  test.describe(viewport.name, () => {
    test('the harness is on the stage, stacked', async ({ browser }) => {
      const page = await sharedRide(browser, viewport);
      const seen = await measure(page);

      expect(seen.panelBackground).toBe(HUD_SURFACE);
      // Ten readings since #1111's moving time, and the rest as above.
      expect(seen.items).toHaveLength(16);
      expect(seen.stage?.width).toBe(viewport.width);
      expect(seen.stage?.height).toBe(viewport.height);
      // Stacked: the world is a letterbox at the top, not the whole stage.
      expect(seen.world?.height ?? 0).toBeLessThan(viewport.height / 2);
      expect(seen.world?.height ?? 0).toBeGreaterThan(0);
    });

    test('Pause, End ride and the trainer line are on screen with no scrolling', async ({
      browser,
    }) => {
      const page = await sharedRide(browser, viewport);
      const seen = await measure(page);

      expect(seen.scrollY).toBe(0);
      expect(seen.stageScrollTop).toBe(0);
      // ⚠️ The PAGE cannot scroll even here. One scroller — the stage — and not
      // the scroll region inside a scrolling page that #419 rules out.
      expect(seen.pageOverflow).toBeLessThanOrEqual(0);
      for (const name of [
        'the trainer line',
        'control: Pause',
        'control: End ride',
        'control: Lock',
      ]) {
        const item = named(seen.items, name);
        expect(inside(item.box, viewport), describeItem(item)).toBe(true);
        expect(item.onTop, describeItem(item)).toBe(true);
      }
    });

    test('nothing is wider than the viewport', async ({ browser }) => {
      // SC 1.4.10 is about scrolling in TWO dimensions. 320 px is the width at
      // which #423's first layout ran the heart rate off the right-hand edge.
      const page = await sharedRide(browser, viewport);
      const seen = await measure(page);

      const wide = [...seen.items, ...seen.panels].filter(
        (each) => each.box.right > viewport.width + SUBPIXEL_TOLERANCE || each.box.left < 0,
      );
      expect(wide.map(describeItem)).toEqual([]);
    });

    test('the control — without the stage, End ride is below the fold again', async ({ page }) => {
      await openRide(page, viewport);
      await page.evaluate(() => {
        window.__oylRide?.unstage();
      });
      const seen = await measure(page);

      const end = named(seen.items, 'control: End ride');
      expect(end.box.bottom).toBeGreaterThan(viewport.height + SUBPIXEL_TOLERANCE);
    });
  });
}

/**
 * #1158 — the moving time where the HUD STACKS. #1124 sized the time's field
 * from its own digits in the corners layouts and upright; where the HUD
 * stacks it was still an `auto-fit` 5.5 rem track's reading, as narrow as
 * 88 px, and `9:59:59` is 92.5 px on the CI runner's DejaVu Sans. It is
 * `nowrap`, so it ran past its field into the gap: 2.5 px at 320×568, 4.0 px
 * at 412×700 and 4.2 px at 700×500, measured for #1124 in no gate's list.
 *
 * Each viewport here is held to one line,
 * {@link MOVING_TIME_SPARE_PIXELS} to spare, the secondary grid inside its
 * panel and no overlap with any other reading. The readings scroll beneath
 * the pinned actions panel in a stacked layout (§"Where four panels cannot
 * share the screen"), so neither being on screen nor clearing a control is
 * asserted. How many tracks a row holds and how many
 * rows the tier takes are published, because the fix changes both.
 */
const STACKED_MOVING_TIME_VIEWPORTS: readonly Viewport[] = [
  ...STACKED_VIEWPORTS,
  { name: 'a small phone upright — 320×568', width: 320, height: 568, unstagedFails: true },
  { name: 'a phone upright, short — 412×700', width: 412, height: 700, unstagedFails: true },
  { name: 'a small tablet window — 700×500', width: 700, height: 500, unstagedFails: true },
];

for (const viewport of STACKED_MOVING_TIME_VIEWPORTS) {
  test(`#1158 — stacked, the moving time fits its field with room to spare — ${viewport.name}`, async ({
    browser,
  }, testInfo) => {
    const page = await sharedRide(browser, viewport);
    const seen = await measure(page);
    const grid = await page.evaluate(() => {
      const secondary = document.querySelector('.oyl-hud__fields--secondary');
      if (secondary === null) return { tracks: 0, rows: 0 };
      const style = getComputedStyle(secondary);
      return {
        tracks: style.gridTemplateColumns.split(' ').length,
        rows: style.gridTemplateRows.split(' ').length,
      };
    });
    const shown = seen.moving;
    const spare = shown.field - shown.width;
    const field = named(seen.items, 'reading: Moving');
    const note =
      `9:59:59 ${shown.width.toFixed(1)} px in a ${shown.field.toFixed(1)} px field ` +
      `(${spare.toFixed(1)} px to spare); ${String(grid.tracks)} tracks × ` +
      `${String(grid.rows)} rows; secondary tier ${String(shown.secondaryOverflow)} px ` +
      `past its panel; ${describeItem(field)}`;
    testInfo.annotations.push({ type: '#1158', description: note });
    console.log(`#1158 — ${viewport.name} — ${note}`);
    expect(shown.text, note).toBe('9:59:59');
    expect(shown.lines, note).toBe(1);
    expect(spare, note).toBeGreaterThanOrEqual(MOVING_TIME_SPARE_PIXELS);
    expect(shown.secondaryOverflow, note).toBeLessThanOrEqual(0);
    expect(
      seen.items
        .filter(
          (each) =>
            each !== field && each.name.startsWith('reading: ') && overlap(each.box, field.box),
        )
        .map(describeItem),
      note,
    ).toEqual([]);
  });
}

/**
 * #1158's other edge: UPRIGHT the time is drawn beside the controls, out of
 * the grid (`theme.css` §"THE MOVING TIME ON AN UPRIGHT PHONE"), so the
 * stacked floor must not reach the upright tier, where height is what is
 * scarce. 640×960 is the width at which it would cost a row: six readings in
 * one row of 5.5 rem tracks, two rows of the time's (on DejaVu Sans from
 * 602 px to 669 px). Held as the count of 5.5 rem tracks the tier's own width
 * makes.
 */
test('#1158 — upright, the secondary tier keeps its 5.5 rem tracks — 640×960', async ({
  browser,
}) => {
  const viewport: Viewport = {
    name: 'a small tablet upright — 640×960',
    width: 640,
    height: 960,
    unstagedFails: false,
  };
  const page = await sharedRide(browser, viewport);
  const tier = await page.evaluate(() => {
    const secondary = document.querySelector('.oyl-hud__fields--secondary');
    if (secondary === null) return { tracks: 0, expected: -1, floor: 0 };
    const style = getComputedStyle(secondary);
    const floor = 5.5 * parseFloat(getComputedStyle(document.documentElement).fontSize);
    const gap = parseFloat(style.columnGap);
    const content =
      secondary.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    return {
      tracks: style.gridTemplateColumns.split(' ').length,
      expected: Math.floor((content + gap) / (floor + gap)),
      floor,
    };
  });
  expect(tier.tracks, JSON.stringify(tier)).toBe(tier.expected);
});

/**
 * A ride with something to say — `ride-harness.tsx` §`WITH_A_NOTICE`.
 *
 * *"The road is not reaching your trainer"* stands for the whole ride, it is
 * the HUD's fifth grid item, and it is the one with the most room to land on
 * the rider: the four panels are sized by their content and this is sized by a
 * sentence — the longest of the four `trainer-port.ts` can produce.
 *
 * ⚠️ On a phone the notice takes the route panel's cell, so there are FOUR grid
 * items there and five on a tablet. Both are asserted, because "the notice is
 * whole" is otherwise satisfied by a notice that was never laid out.
 */
test.describe('a ride with a standing notice', () => {
  const QUERY = '?trainer=workout';

  // Every overlay viewport but the smallest column one, which `theme.css`
  // §"WHERE THERE IS NO FREE CELL" records as a limit rather than a pass.
  for (const viewport of OVERLAY_VIEWPORTS.filter((each) => each.height !== 752)) {
    test(`is whole, over no panel and not over the rider — ${viewport.name}`, async ({ page }) => {
      await openRide(page, viewport, QUERY);
      for (const [how, seen] of await bothWays(page)) {
        await test.step(how, () => {
          // The apparatus: the notice is laid out, and it is a sentence.
          const notice = seen.panels.find((each) => each.name.includes('oyl-hud__notices'));
          expect(notice?.box.height ?? 0).toBeGreaterThan(40);
          const laidOut = seen.panels.filter((each) => each.box.height > 0);
          // `theme.css`'s short corners layout is `max-height: 30rem`, which is
          // 480 px INCLUSIVE — #512's 736×480 is on it.
          const onAPhone = Math.min(viewport.width, viewport.height) <= 480;
          expect(laidOut).toHaveLength(onAPhone ? 4 : 5);

          expect(laidOut.filter((each) => !inside(each.box, viewport)).map(describeItem)).toEqual(
            [],
          );
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
          // And the controls are still where a rider can press them.
          for (const name of ['control: Pause', 'control: End ride', 'control: Lock']) {
            const item = named(seen.items, name);
            expect(inside(item.box, viewport) && item.onTop, describeItem(item)).toBe(true);
          }
          // #1111: with a third control (*Trainer notice*) there is no width
          // beside the controls on an upright phone, and the moving time is set
          // ABOVE the actions panel on a surface of its own (`theme.css` §"THE
          // MOVING TIME ON AN UPRIGHT PHONE") — over the world, inside no panel,
          // so the panel checks above cannot see it. Held here, on this load.
          const moving = named(seen.items, 'reading: Moving');
          expect(inside(moving.box, viewport) && moving.onTop, describeItem(moving)).toBe(true);
          const leaning = riderBox(viewport);
          expect(overlap(moving.box, leaning), describeItem(moving)).toBe(false);
          const controls = seen.items.filter((each) => each.name.startsWith('control: '));
          // Pause, End ride, Trainer notice and, since #1482, the lock.
          expect(controls).toHaveLength(4);
          expect(
            controls.filter((each) => overlap(each.box, moving.box)).map(describeItem),
          ).toEqual([]);
          // #1111's review: and over no other laid-out panel. A panel is excused
          // only where the field is drawn wholly INSIDE it: the secondary panel
          // on a tablet and a wide phone on its side, where it is in the
          // document, and the primary panel below 802 px on its side, which
          // makes room for it (`theme.css` §"THE MOVING TIME ON A NARROW PHONE ON
          // ITS SIDE"). Upright it is inside none.
          const within = (inner: Box, outer: Box): boolean =>
            inner.left >= outer.left &&
            inner.right <= outer.right &&
            inner.top >= outer.top &&
            inner.bottom <= outer.bottom;
          expect(
            laidOut
              .filter(
                (each) =>
                  !(
                    (each.name.includes('oyl-hud__fields--secondary') ||
                      each.name.includes('oyl-hud__fields--primary')) &&
                    within(moving.box, each.box)
                  ),
              )
              .filter((each) => overlap(each.box, moving.box))
              .map(describeItem),
            describeItem(moving),
          ).toEqual([]);
          const clearOfRider = Math.max(
            moving.box.left - leaning.right,
            leaning.left - moving.box.right,
            moving.box.top - leaning.bottom,
            leaning.top - moving.box.bottom,
          );
          console.log(
            `#1111 with Trainer notice — ${viewport.name} — ${how} — ${describeItem(moving)}; ` +
              `${clearOfRider.toFixed(1)} px clear of the leaning rider`,
          );
        });
      }

      // #1120's control for this fixture, on the same load: at 360×800 the
      // plain ride had room without the fallback, and what failed on `main`
      // was this one — the notice beside the moving time as a third row. The
      // anchor blocks out and no fallback in their place must give a finding
      // here, or the "without anchor positioning" pass above is as true of a
      // fallback that was never needed.
      if (viewport.width === 360 && viewport.height === 800) {
        await test.step('the control — without anchors and without the fallback (#1120)', async () => {
          const bare = await withoutAnchors(page, 'none');
          const found = standingNoticeFindings(bare, viewport);
          console.log(
            `#1120 control with Trainer notice — ${viewport.name} — as main laid it out ` +
              `without anchors: ${found.length === 0 ? 'nothing found' : found.join('; ')}`,
          );
          expect(found).not.toEqual([]);
        });
      }
    });
  }
});

/**
 * What §"a ride with a standing notice" holds, as findings rather than
 * assertions, for #1120's control: a laid-out panel outside the viewport, over
 * another, or over the leaning rider; *Pause* or *End ride* off the screen or
 * covered; and the moving time over the rider, a control or a panel it is not
 * drawn wholly inside.
 */
function standingNoticeFindings(seen: StageMeasurement, viewport: Viewport): string[] {
  const leaning = riderBox(viewport);
  const laidOut = seen.panels.filter((each) => each.box.height > 0);
  const found = laidOut.filter((each) => !inside(each.box, viewport)).map(describeItem);
  laidOut.forEach((a, index) => {
    for (const b of laidOut.slice(index + 1)) {
      if (overlap(a.box, b.box)) found.push(`${describeItem(a)} × ${describeItem(b)}`);
    }
  });
  found.push(...laidOut.filter((each) => overlap(each.box, leaning)).map(describeItem));
  for (const name of ['control: Pause', 'control: End ride', 'control: Lock']) {
    const item = named(seen.items, name);
    if (!inside(item.box, viewport) || !item.onTop) found.push(describeItem(item));
  }
  const moving = named(seen.items, 'reading: Moving');
  const within = (inner: Box, outer: Box): boolean =>
    inner.left >= outer.left &&
    inner.right <= outer.right &&
    inner.top >= outer.top &&
    inner.bottom <= outer.bottom;
  if (overlap(moving.box, leaning)) found.push(`${describeItem(moving)} over the rider`);
  for (const each of seen.items.filter((item) => item.name.startsWith('control: '))) {
    if (overlap(each.box, moving.box))
      found.push(`${describeItem(moving)} × ${describeItem(each)}`);
  }
  for (const each of laidOut) {
    if (overlap(each.box, moving.box) && !within(moving.box, each.box)) {
      found.push(`${describeItem(moving)} × ${describeItem(each)}`);
    }
  }
  return found;
}

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
   */
  for (const viewport of OVERLAY_VIEWPORTS.filter(
    (each) => each.width >= 736 && each.height <= 390,
  )) {
    test(`the control — without anchors and without the fallback, the rows do not fit — ${viewport.name}`, async ({
      page,
    }) => {
      await openRide(page, viewport, '?side=filming&sounds=on');
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
          for (const name of ['the elevation strip', 'the plan view']) {
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
          for (const name of ['the elevation strip', 'the plan view']) {
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
