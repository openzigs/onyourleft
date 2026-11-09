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
 *   control at its start and nearly over (#1816), a sixth file since;
 * - **`ride-conditions.browser.spec.ts`**, a seventh since #2376 and the
 *   second half of what was here: a workout eased (#585), sounds on, a side
 *   camera paired (#551), a standing notice once it is put away (#437), the
 *   cull, safe areas, #439's insets, #1441's gesture bar, a laptop's window
 *   and the end of a ride's steps. This file had grown back to 372 cases and
 *   598 to 637 s in one worker on the slower runners, most of a browser
 *   shard's 720 s stop on its own (docs/agents/ci.md §4c "Five browser shards
 *   — #2376"); a `§"…"` reference elsewhere to one of those sections under
 *   this file's name now names that one.
 *
 * What more than one of them reads — the viewports, `openRide`, the
 * measuring and both-ways helpers — is `ride-stage.ts`, unchanged but for
 * its `export`s. docs/agents/ci.md §4c "Five ride files — #1414" has
 * the measurements before and after.
 */

import { expect, test, type Page } from '@playwright/test';

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
  CLOCK_READING,
  clockInTheClockRow,
  gradientInPrimary,
  RIDE_TOTAL_READINGS,
  rideTotalsDrawn,
} from './ride-stage';
import { attachSharedPageOnFailure, releaseSharedPage } from './shared-load';

import { PLAN_SMALLEST_PIXELS } from '../src/game/hud/plan';

import type { Box, StageMeasurement } from './ride-harness';

/** The route panel's gap on an upright phone, `--oyl-space-sm` (#2075). */
const ROUTE_PANEL_GAP_PIXELS = 8;

/**
 * SC 1.4.3's large text, in CSS pixels: 18 pt. #2291's band colours are 3:1
 * pairs on the HUD's surface, which carry text only this size or larger.
 */
const LARGE_TEXT_PIXELS = 24;

/**
 * What Chromium paints the gradient's digits and sign in — #2291 — and what
 * its band's token resolves to, read off the custom property rather than
 * typed here, so the assertion is "the digits are THEIR band's colour".
 */
async function gradientPaint(page: Page): Promise<{
  band: string;
  digits: { colour: string; size: number } | undefined;
  sign: string | undefined;
  ink: string;
  token: string;
}> {
  return page.evaluate(() => {
    const field = document.querySelector('.oyl-hud__fields--primary [data-grade-band]');
    if (field === null) throw new Error('no banded gradient on the stage');
    const band = field.getAttribute('data-grade-band') ?? '';
    // A custom property resolves to its hex; a probe's `color` is how Chromium spells it.
    const probe = document.createElement('span');
    probe.style.color = `var(--oyl-color-hud-grade-${band})`;
    field.append(probe);
    const token = window.getComputedStyle(probe).color;
    probe.style.color = 'var(--oyl-color-hud-ink)';
    const ink = window.getComputedStyle(probe).color;
    probe.remove();
    const digits = field.querySelector('.oyl-hud__digits');
    const sign = field.querySelector('.oyl-hud__sign');
    return {
      band,
      digits:
        digits === null
          ? undefined
          : {
              colour: window.getComputedStyle(digits).color,
              size: Number.parseFloat(window.getComputedStyle(digits).fontSize),
            },
      sign: sign === null ? undefined : window.getComputedStyle(sign).color,
      ink,
      token,
    };
  });
}

/** The #2291 case, shared by the overlay and the stacked layouts. */
async function expectGradientInItsBand(page: Page): Promise<void> {
  const paint = await gradientPaint(page);
  const how = JSON.stringify(paint);
  expect(paint.digits, how).toBeDefined();
  expect(paint.digits?.colour, how).toBe(paint.token);
  // Large text wherever it is drawn, so the band's 3:1 is the pair it needs.
  expect(paint.digits?.size ?? 0, how).toBeGreaterThanOrEqual(
    LARGE_TEXT_PIXELS - SUBPIXEL_TOLERANCE,
  );
  // The sign, small text, keeps the ink.
  if (paint.sign !== undefined) expect(paint.sign, how).toBe(paint.ink);
}

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
      // #2071: the gradient is the fourth primary reading.
      expect(seen.primary).toEqual(['Power', 'Cadence', 'Heart rate', 'Gradient']);
      // A pacer, a ghost AND a wind — seven, where an ordinary ride has five;
      // and since #1111 the moving time, beside the distance to go; and since
      // #2072 the elapsed time and the clock, beside the moving time.
      expect(seen.secondary).toEqual([
        'Speed',
        'To go',
        'Moving',
        'Elapsed',
        'Clock',
        // #2076: the ride so far, in the document wherever it is drawn.
        'Distance',
        'Climbed',
        'Avg power',
        // #2077: the rider's effort, after the ride so far.
        'W/kg',
        'Zone',
        'Pacer',
        'Your best',
        'Wind',
      ]);
      expect(seen.panels).toHaveLength(4);
      // Twelve readings, the strip, the plan view, the trainer line, two
      // controls and, since #1482, the touch lock — since #2075 the road ahead
      // beside the strip, and since #2076 and #2077 the ride so far and the
      // rider's effort, where they are drawn. And since #2078 the recent
      // graph, where it is drawn.
      expect(seen.items).toHaveLength(rideTotalsDrawn(viewport) ? 25 : 19);
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
     * #2072: the clock row — *Elapsed* at its widest (9:59:59, as the moving
     * time) and the time of day — drawn inside the PRIMARY panel's box, on
     * top, clear of each other and of the moving time, both ways (#1120).
     * The clock is in that row at every overlay viewport but a short corners
     * phone under 51 rem, where since #2071 it is a secondary reading in the
     * cell the gradient left — inside the secondary panel, uncovered (`theme.css`
     * §"THE CLOCK ROW").
     */
    test('the clock row is inside the primary panel, uncovered, clear of the moving time — #2072', async ({
      browser,
    }) => {
      const page = await sharedRide(browser, viewport);
      for (const [how, seen] of await bothWays(page)) {
        const primary = seen.panels.find((each) => each.name.includes('oyl-hud__fields--primary'));
        if (primary === undefined) throw new Error(`${how}: no primary panel`);
        const within = (box: Box): boolean =>
          box.left >= primary.box.left - SUBPIXEL_TOLERANCE &&
          box.right <= primary.box.right + SUBPIXEL_TOLERANCE &&
          box.top >= primary.box.top - SUBPIXEL_TOLERANCE &&
          box.bottom <= primary.box.bottom + SUBPIXEL_TOLERANCE;
        const elapsed = named(seen.items, 'reading: Elapsed');
        const clock = named(seen.items, CLOCK_READING);
        const moving = named(seen.items, 'reading: Moving');
        const inTheRow = clockInTheClockRow(viewport) ? [elapsed, clock] : [elapsed];
        for (const each of inTheRow) {
          expect(
            within(each.box),
            `${how}: ${describeItem(each)} in ${describeItem(primary)}`,
          ).toBe(true);
          expect(each.onTop, `${how}: ${describeItem(each)}`).toBe(true);
          expect(overlap(each.box, moving.box), `${how}: ${describeItem(each)} × Moving`).toBe(
            false,
          );
        }
        expect(overlap(elapsed.box, clock.box), `${how}: Elapsed × Clock`).toBe(false);
        if (!clockInTheClockRow(viewport)) {
          const secondary = seen.panels.find((each) =>
            each.name.includes('oyl-hud__fields--secondary'),
          );
          if (secondary === undefined) throw new Error(`${how}: no secondary panel`);
          expect(
            clock.box.left >= secondary.box.left - SUBPIXEL_TOLERANCE &&
              clock.box.right <= secondary.box.right + SUBPIXEL_TOLERANCE &&
              clock.box.bottom <= secondary.box.bottom + SUBPIXEL_TOLERANCE,
            `${how}: ${describeItem(clock)} in ${describeItem(secondary)}`,
          ).toBe(true);
          expect(clock.onTop, `${how}: ${describeItem(clock)}`).toBe(true);
        }
        // And the readings a screen reader meets, in #94's order.
        expect(seen.secondary.slice(2, 5), how).toEqual(['Moving', 'Elapsed', 'Clock']);
      }
    });

    /**
     * #2071: the gradient — in the PRIMARY panel at the primary size where
     * four primary tracks fit, and otherwise in the secondary panel's first
     * cell (`theme.css` §"THE GRADIENT, PRIMARY"). Either way inside its
     * panel, uncovered, over no other reading, both ways (#1120).
     */
    test('the gradient is inside its panel, uncovered, over no other reading — #2071', async ({
      browser,
    }) => {
      const page = await sharedRide(browser, viewport);
      for (const [how, seen] of await bothWays(page)) {
        const where = gradientInPrimary(viewport)
          ? 'oyl-hud__fields--primary'
          : 'oyl-hud__fields--secondary';
        const panel = seen.panels.find((each) => each.name.includes(where));
        if (panel === undefined) throw new Error(`${how}: no ${where} panel`);
        const gradient = named(seen.items, 'reading: Gradient');
        expect(
          gradient.box.left >= panel.box.left - SUBPIXEL_TOLERANCE &&
            gradient.box.right <= panel.box.right + SUBPIXEL_TOLERANCE &&
            gradient.box.top >= panel.box.top - SUBPIXEL_TOLERANCE &&
            gradient.box.bottom <= panel.box.bottom + SUBPIXEL_TOLERANCE,
          `${how}: ${describeItem(gradient)} in ${describeItem(panel)}`,
        ).toBe(true);
        expect(gradient.onTop, `${how}: ${describeItem(gradient)}`).toBe(true);
        expect(
          seen.items
            .filter(
              (each) =>
                each !== gradient &&
                each.name.startsWith('reading: ') &&
                overlap(each.box, gradient.box),
            )
            .map(describeItem),
          how,
        ).toEqual([]);
        // In the primary list in the document, wherever it is drawn.
        expect(seen.primary, how).toEqual(['Power', 'Cadence', 'Heart rate', 'Gradient']);
      }
    });

    /**
     * #2075, and the owner's screenshot review of 2026-11-05: the road
     * ahead is the route panel's full width and TALLER than the whole route's
     * strip, on its own row under it — except on a phone, upright or on its
     * side, which has no row to give (`theme.css` §"THE ROAD AHEAD"): there
     * it is beside the whole route's strip at its height. Upright, the two
     * strips and their captions take the whole panel but the plan view's
     * `PLAN_SMALLEST_PIXELS` column, where they had three fifths of it. Both
     * ways (#1120).
     */
    test('the road ahead is the route panel’s width and taller, or beside the strip on a phone — #2075', async ({
      browser,
    }) => {
      const page = await sharedRide(browser, viewport);
      // A phone, upright or on its side, has no row to give (`theme.css`
      // §"THE ROAD AHEAD"); upright, the plan view is a column beside them.
      const beside = Math.min(viewport.width, viewport.height) <= 480;
      const upright = viewport.width < 736 && viewport.height >= 752;
      for (const [how, seen] of await bothWays(page)) {
        const whole = named(seen.items, 'the elevation strip');
        const ahead = named(seen.items, 'the road ahead');
        const plan = named(seen.items, 'the plan view');
        const route = seen.panels.find((each) => each.name.includes('oyl-hud__route'));
        if (route === undefined) throw new Error(`${how}: no route panel`);
        expect(ahead.onTop, `${how}: ${describeItem(ahead)}`).toBe(true);
        expect(
          ahead.box.right <= route.box.right + SUBPIXEL_TOLERANCE &&
            ahead.box.bottom <= route.box.bottom + SUBPIXEL_TOLERANCE,
          `${how}: ${describeItem(ahead)} in ${describeItem(route)}`,
        ).toBe(true);
        if (beside) {
          expect(Math.abs(ahead.box.top - whole.box.top), how).toBeLessThanOrEqual(
            SUBPIXEL_TOLERANCE,
          );
          expect(Math.abs(ahead.box.height - whole.box.height), how).toBeLessThanOrEqual(
            SUBPIXEL_TOLERANCE,
          );
          expect(ahead.box.left, how).toBeGreaterThan(whole.box.right - SUBPIXEL_TOLERANCE);
          expect(ahead.box.width, how).toBeGreaterThan(whole.box.width);
        }
        if (beside && upright) {
          // The phone's width: the strips run from the whole route's strip's
          // start to the plan view's column, and the plan view is no wider
          // than the box its rider's mark is sized for.
          expect(plan.box.width, `${how}: ${describeItem(plan)}`).toBeLessThanOrEqual(
            PLAN_SMALLEST_PIXELS + SUBPIXEL_TOLERANCE,
          );
          const gap = plan.box.left - ahead.box.right;
          expect(
            gap,
            `${how}: ${describeItem(ahead)} beside ${describeItem(plan)}`,
          ).toBeLessThanOrEqual(ROUTE_PANEL_GAP_PIXELS + SUBPIXEL_TOLERANCE);
        }
        if (!beside) {
          expect(ahead.box.top, how).toBeGreaterThan(whole.box.bottom - SUBPIXEL_TOLERANCE);
          expect(Math.abs(ahead.box.left - whole.box.left), how).toBeLessThanOrEqual(
            SUBPIXEL_TOLERANCE,
          );
          expect(Math.abs(ahead.box.width - whole.box.width), how).toBeLessThanOrEqual(
            SUBPIXEL_TOLERANCE,
          );
          expect(ahead.box.height, how).toBeGreaterThan(whole.box.height);
        }
      }
    });

    /**
     * The owner's review of 2026-11-05: every grade band is the strip's full
     * height as the engine draws it, so a descent or a flat stretch is as
     * readable as a climb. Read off each band's own box.
     */
    test('the gradient’s digits are its band’s colour, at a large-text size — #2291', async ({
      browser,
    }) => {
      await expectGradientInItsBand(await sharedRide(browser, viewport));
    });

    /**
     * #2291: the whole route's strip is shaded by its grade bands, each a
     * column clipped to the route's shape — so each band's box is inside the
     * strip's, and the bands together span it.
     */
    test('the whole route’s strip is drawn in its grade bands — #2291', async ({ browser }) => {
      const page = await sharedRide(browser, viewport);
      const read = await page.evaluate(() => {
        const strip = document.querySelector('.oyl-hud__profile-svg');
        if (strip === null) throw new Error('no elevation strip on the stage');
        const box = strip.getBoundingClientRect();
        const runs = [...strip.querySelectorAll('.oyl-hud__profile-run')].map((run) => {
          const each = run.getBoundingClientRect();
          return { band: run.getAttribute('data-band') ?? '', left: each.left, right: each.right };
        });
        return { left: box.left, right: box.right, runs };
      });
      expect(read.runs.length).toBeGreaterThan(0);
      expect(read.runs[0]?.left ?? Number.NaN).toBeCloseTo(read.left, 0);
      expect(read.runs.at(-1)?.right ?? Number.NaN).toBeCloseTo(read.right, 0);
    });

    test('every band on the road ahead is the strip’s full height — #2075', async ({ browser }) => {
      const page = await sharedRide(browser, viewport);
      const read = await page.evaluate(() => {
        const strip = document.querySelector('[data-testid="oyl-hud-look-ahead"]');
        if (strip === null) throw new Error('no road ahead on the stage');
        const box = strip.getBoundingClientRect();
        return {
          height: box.height,
          bands: [...strip.querySelectorAll('.oyl-hud__ahead-run')].map((band) => {
            const each = band.getBoundingClientRect();
            return {
              band: band.getAttribute('data-band') ?? '',
              top: each.top - box.top,
              bottom: box.bottom - each.bottom,
              width: each.width,
            };
          }),
        };
      });
      expect(read.bands.length).toBeGreaterThan(0);
      for (const band of read.bands) {
        expect(
          Math.max(Math.abs(band.top), Math.abs(band.bottom)),
          `${band.band}: ${JSON.stringify(band)} in a ${String(read.height)} px strip`,
        ).toBeLessThanOrEqual(SUBPIXEL_TOLERANCE);
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

/**
 * #2076 — the ride so far, and since #2077 the rider's W/kg and zone after it:
 * DRAWN on a tablet and where the HUD stacks, inside
 * the secondary panel, uncovered and over no other reading; GIVEN WAY by clip
 * on a phone's overlay, and still in the secondary list in #94's order, where
 * a screen reader meets it (`theme.css` §"THE RIDE SO FAR"). Both ways (#1120).
 */
/**
 * #2078 — the last ten minutes of power and heart rate: in the route panel at
 * its full width, uncovered and on the stage on a tablet, drawn where the HUD
 * stacks, and not drawn on a phone's overlay (`theme.css` §"THE LAST TEN
 * MINUTES"). Both ways (#1120). Every other case here holds the route panel
 * clear of the leaning rider and of every other panel with the graph in it.
 */
for (const viewport of [...OVERLAY_VIEWPORTS, ...STACKED_VIEWPORTS]) {
  test(`#2078 the recent graph is in the route panel where there is room for it — ${viewport.name}`, async ({
    browser,
  }) => {
    const page = await sharedRide(browser, viewport);
    for (const [how, seen] of await bothWays(page)) {
      if (!rideTotalsDrawn(viewport)) {
        expect(seen.givenWay, how).toContain('the recent graph');
        expect(
          seen.items.map((each) => each.name),
          how,
        ).not.toContain('the recent graph');
        continue;
      }
      const graph = named(seen.items, 'the recent graph');
      const route = seen.panels.find((each) => each.name.includes('oyl-hud__route'));
      if (route === undefined) throw new Error(`${how}: no route panel`);
      expect(graph.box.height, `${how}: ${describeItem(graph)}`).toBeGreaterThan(40);
      expect(
        graph.box.left >= route.box.left - SUBPIXEL_TOLERANCE &&
          graph.box.right <= route.box.right + SUBPIXEL_TOLERANCE &&
          graph.box.bottom <= route.box.bottom + SUBPIXEL_TOLERANCE,
        `${how}: ${describeItem(graph)} in ${describeItem(route)}`,
      ).toBe(true);
      if (!STACKED_VIEWPORTS.includes(viewport)) {
        expect(inside(graph.box, viewport) && graph.onTop, `${how}: ${describeItem(graph)}`).toBe(
          true,
        );
      }
    }
  });
}

for (const viewport of [...OVERLAY_VIEWPORTS, ...STACKED_VIEWPORTS]) {
  test(`#2076 the ride so far is drawn where there is a row for it — ${viewport.name}`, async ({
    browser,
  }) => {
    const page = await sharedRide(browser, viewport);
    // The recorder's figures, through the port and `GameView` to the fields
    // (`ride-harness.tsx` §`RIDE_TOTALS`) — read from the document, where they
    // are whether drawn or given way.
    const values = await page.evaluate(() =>
      [...document.querySelectorAll('.oyl-hud__field--total .oyl-hud__value')].map((each) =>
        (each.textContent ?? '').replace(/\s+/g, ' ').trim(),
      ),
    );
    expect(values).toEqual(['199.9 km', '4850 m', '425 W']);
    // #2077: the zone of the harness's 342 W over the rider's own 250 W
    // threshold, its number and name, and this ride's time in all seven zones.
    const zone = await page.evaluate(() => {
      const field = document.querySelector('.oyl-hud__field--effort:has(.oyl-hud__zone-bar)');
      return {
        reads: (field?.querySelector('dd')?.textContent ?? '').replace(/\s+/g, ' ').trim(),
        swatch: field?.querySelector('.oyl-hud__zone-swatch--6') !== null,
        parts: field?.querySelectorAll('.oyl-hud__zone-bar-part').length ?? 0,
        // #2384: and the zone strip, zone 6 lit and named in words.
        lit: field?.querySelector('.oyl-hud__zone-strip')?.getAttribute('data-oyl-zone-lit'),
        named: field?.querySelector('.oyl-hud__zone-strip')?.getAttribute('aria-label'),
      };
    });
    // #2384: and drawn, not merely present: the attributes above are React's
    // whatever the CSS does, so read the boxes. A strip `display: none`, or
    // squeezed to nothing by the row's flex, has no width; the lit segment is
    // taller than an unlit one.
    const boxes = await page.evaluate(() => {
      const strip = document.querySelector('.oyl-hud__field--effort .oyl-hud__zone-strip');
      const lit = strip
        ?.querySelector('.oyl-hud__zone-strip-segment--lit')
        ?.getBoundingClientRect();
      const unlit = strip
        ?.querySelector('.oyl-hud__zone-strip-segment:not(.oyl-hud__zone-strip-segment--lit)')
        ?.getBoundingClientRect();
      return {
        width: strip?.getBoundingClientRect().width ?? 0,
        lit: lit?.height ?? 0,
        unlit: unlit?.height ?? 0,
      };
    });
    // The effort field is clipped away with the totals on a phone's corners
    // layout, so the boxes are read where the totals are drawn.
    if (rideTotalsDrawn(viewport)) {
      expect(boxes.width, 'the strip is drawn at a width').toBeGreaterThan(30);
      expect(boxes.unlit, 'an unlit segment is drawn').toBeGreaterThan(0);
      expect(boxes.lit, 'the lit segment stands taller').toBeGreaterThan(boxes.unlit);
    }
    expect(zone).toEqual({
      reads: '6 Anaerobic',
      swatch: true,
      parts: 7,
      lit: '6',
      named: 'Zone 6 of 7: Anaerobic',
    });
    for (const [how, seen] of await bothWays(page)) {
      expect(seen.secondary, how).toEqual(
        expect.arrayContaining(['Distance', 'Climbed', 'Avg power']),
      );
      if (!rideTotalsDrawn(viewport)) {
        // #2078: and the recent graph, not drawn on a phone's overlay either.
        expect(seen.givenWay, how).toEqual([...RIDE_TOTAL_READINGS, 'the recent graph']);
        continue;
      }
      expect(seen.givenWay, how).toEqual([]);
      const panel = seen.panels.find((each) => each.name.includes('oyl-hud__fields--secondary'));
      if (panel === undefined) throw new Error(`${how}: no secondary panel`);
      // Stacked, the readings scroll: drawn, in their panel and over no other
      // reading is what holds there; on a tablet they are on the stage too.
      const stacked = STACKED_VIEWPORTS.includes(viewport);
      for (const name of RIDE_TOTAL_READINGS) {
        const reading = named(seen.items, name);
        expect(
          reading.box.width * reading.box.height,
          `${how}: ${describeItem(reading)}`,
        ).toBeGreaterThan(1);
        if (!stacked) {
          expect(
            inside(reading.box, viewport) && reading.onTop,
            `${how}: ${describeItem(reading)}`,
          ).toBe(true);
        }
        expect(
          reading.box.left >= panel.box.left - SUBPIXEL_TOLERANCE &&
            reading.box.right <= panel.box.right + SUBPIXEL_TOLERANCE &&
            reading.box.top >= panel.box.top - SUBPIXEL_TOLERANCE &&
            reading.box.bottom <= panel.box.bottom + SUBPIXEL_TOLERANCE,
          `${how}: ${describeItem(reading)} in ${describeItem(panel)}`,
        ).toBe(true);
        expect(
          seen.items
            .filter(
              (each) =>
                each !== reading &&
                each.name.startsWith('reading: ') &&
                overlap(each.box, reading.box),
            )
            .map(describeItem),
          how,
        ).toEqual([]);
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
      // Twelve readings since #2072's elapsed time and clock, and the rest as
      // above — the ride so far and the rider's effort (#2076, #2077), the
      // road ahead (#2075) and the recent graph (#2078), drawn where the HUD
      // stacks.
      expect(seen.items).toHaveLength(25);
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

    test('the gradient’s digits are its band’s colour, at a large-text size — #2291', async ({
      browser,
    }) => {
      await expectGradientInItsBand(await sharedRide(browser, viewport));
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
      // anchor blocks out and no fallback in their place must change the
      // stage here, or the "without anchor positioning" pass above is as true
      // of a fallback that was never needed.
      //
      // ⚠️ **Since #2072 that change is a secondary row, not a collision.**
      // Without the fallback the elapsed time and the clock go back into the
      // grid beside the moving time, so its second row holds three readings
      // with no phrase under them and the gaps move to the third: the tier is a
      // row taller than with the fallback, and on this fixture the notice
      // then ends 9 px above the leaning rider, where it ended over it on
      // `main`. The collisions the fallback prevents are held by the controls
      // at 736×360 and 360×752 (§`MAIN_FALLBACK_OVER_THE_RIDER`).
      if (viewport.width === 360 && viewport.height === 800) {
        await test.step('the control — without anchors and without the fallback (#1120)', async () => {
          const bare = await withoutAnchors(page, 'none');
          const shipped = await withoutAnchors(page, 'shipped');
          const found = standingNoticeFindings(bare, viewport);
          const secondary = (seen: StageMeasurement): number =>
            seen.panels.find((each) => each.name.includes('oyl-hud__fields--secondary'))?.box
              .height ?? 0;
          console.log(
            `#1120 control with Trainer notice — ${viewport.name} — as main laid it out ` +
              `without anchors: ${found.length === 0 ? 'nothing found' : found.join('; ')}; ` +
              `secondary tier ${secondary(bare).toFixed(1)} px, with the fallback ` +
              `${secondary(shipped).toFixed(1)} px`,
          );
          // A secondary row is 45 px at its shortest.
          expect(secondary(bare)).toBeGreaterThan(secondary(shipped) + 40);
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
