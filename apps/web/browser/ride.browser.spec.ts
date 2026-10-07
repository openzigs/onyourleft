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
 */

import { expect, test, type Browser, type Page } from '@playwright/test';

import { applyInsets, PIXEL_TABLET_LANDSCAPE_INSETS, resolvedInsets } from './insets';
import { attachSharedPageOnFailure, releaseSharedPage, sharedPage } from './shared-load';

import { AA_LARGE_TEXT_OR_NON_TEXT, contrastRatio } from '../src/design/contrast';

import { riderFrameBox } from '../src/game/camera';
import { MAXIMUM_LEAN_RADIANS } from '../src/game/racing-line';
import { workoutRescueText } from '../src/workout/rescue-text';

import type { AnchorFallback, Box, StageItem, StageMeasurement } from './ride-harness';

/**
 * How far past an edge a box may measure and still count as inside it.
 *
 * ⚠️ One pixel, and it is sub-pixel layout rather than slack: a panel whose
 * height comes from `1.05` line-heights and `0.8rem` labels has a fractional
 * box, and a strict comparison fails this gate on arithmetic rather than on
 * layout. Widening it further would let a whole line of text hide.
 */
const SUBPIXEL_TOLERANCE = 1;

/**
 * `hud-value-size.test.ts` §`MINIMUM_TIER_RATIO`, as the engine resolves it.
 *
 * Restated rather than imported: that file reads the stylesheet as text, and
 * this reads what Chromium made of it — a rule overridden by a later one, or
 * by a media query, satisfies the first and not the second.
 */
const MINIMUM_TIER_RATIO = 1.5;

/** `theme.css` §`--oyl-color-hud-surface`, as `getComputedStyle` spells it. */
const HUD_SURFACE = 'rgb(16, 22, 28)';

interface Viewport {
  readonly name: string;
  readonly width: number;
  readonly height: number;
  /**
   * Whether the same DOM **without the stage** puts *End ride* below the fold
   * here — i.e. whether this viewport can carry the control.
   *
   * ⚠️ Not every viewport can, and pretending otherwise would be asserting the
   * opposite of the bug: upright on a tall screen the unstaged page FITS,
   * exactly as #373's old placement was visible in portrait. So the control
   * runs at every LANDSCAPE overlay viewport and at all four stacked ones, and
   * at no upright overlay viewport.
   *
   * ⚠️ **Which leaves the column layout with no control of this kind, and that
   * is stated rather than papered over.** What stands in for it there is the
   * apparatus case — fourteen items, four panels, the surface token resolved —
   * and the mutation record: a 7 rem track floor, a 14 rem plan view and a
   * route panel moved back to the bottom each turned column-layout cases red
   * when they were tried (B6, B8 and B11 in the pull request). A control that
   * cannot honestly fail is worse than none.
   */
  readonly unstagedFails: boolean;
}

/**
 * Where the HUD is an OVERLAY — `theme.css` §`.oyl-game--riding`.
 *
 * ⚠️ Both layouts and both of their edges: the smallest viewport each admits as
 * well as the ordinary ones, because a layout is most likely to overflow at
 * the bottom of the range it claims.
 */
const OVERLAY_VIEWPORTS: readonly Viewport[] = [
  {
    name: 'a landscape tablet — 1280×800, the owner’s',
    width: 1280,
    height: 800,
    unstagedFails: true,
  },
  { name: 'a 4:3 tablet in landscape — 1024×768', width: 1024, height: 768, unstagedFails: true },
  { name: 'a tablet upright — 800×1280', width: 800, height: 1280, unstagedFails: false },
  { name: 'a phone in landscape — 844×390', width: 844, height: 390, unstagedFails: true },
  { name: 'the smallest corners layout — 736×360', width: 736, height: 360, unstagedFails: true },
  /**
   * #512: the TALLEST of the short corners layout (`theme.css` §"A SHORT
   * corners layout", `max-height: 30rem`). A leaning rider's box grows with
   * the viewport's height while the panels, in rem, do not, so this is where
   * the bottom row is nearest a rider leaning at the cap — 12 px, measured.
   * Until #512 it was measured nowhere, and a 20 rem actions panel here was
   * over the rider by about 50 px.
   */
  {
    name: 'the tallest short corners layout — 736×480',
    width: 736,
    height: 480,
    unstagedFails: true,
  },
  { name: 'a phone upright — 390×844', width: 390, height: 844, unstagedFails: false },
  {
    name: 'a narrow Android phone upright, in the app — 360×800',
    width: 360,
    height: 800,
    unstagedFails: false,
  },
  { name: 'the smallest column layout — 360×752', width: 360, height: 752, unstagedFails: false },
];

/**
 * Where it is not — `theme.css` §`.oyl-game--riding` says why each is here.
 *
 * 320×256 is SC 1.4.10's viewport, which is a 1280×1024 window at 400 %.
 * 390×664 is a phone upright in a browser with the browser's own bars showing:
 * too short for three panels to clear the rider's helmet, by measurement.
 */
const STACKED_VIEWPORTS: readonly Viewport[] = [
  { name: 'reflow — 320×256', width: 320, height: 256, unstagedFails: true },
  { name: 'a small phone on its side — 640×360', width: 640, height: 360, unstagedFails: true },
  { name: 'a phone upright in a browser — 390×664', width: 390, height: 664, unstagedFails: false },
  // ⚠️ Was "the smallest column layout" until the pull request's first CI run:
  // on the runner's fonts the three top panels are 373 px here, 8 px over the
  // rider's helmet, while the same case was green on a Mac. `theme.css`
  // §"COLUMN" records what that changed.
  { name: 'a very narrow phone upright — 320×704', width: 320, height: 704, unstagedFails: true },
];

async function openRide(page: Page, viewport: Viewport, query = ''): Promise<void> {
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  const response = await page.goto(`/ride.html${query}`);
  // ⚠️ A page missing from `vite.browser.config.ts`'s `build.rollupOptions.input`
  // is simply not built, and the failure is a 404 sixty seconds later inside
  // `waitForFunction` with no mention of the config — the trap #266 confirmed
  // by deleting its own line.
  expect(
    response?.status(),
    'ride.html did not load — is it named in vite.browser.config.ts build.rollupOptions.input?',
  ).toBe(200);
  await page.waitForFunction(() => window.__oylRide !== undefined);
  const published = await page.evaluate(() => ({
    ready: window.__oylRide?.ready,
    errors: window.__oylRide?.errors,
  }));
  // The harness rides for real, so "ready" means the picker offered a route,
  // the ride started, the stage appeared and the trainer line was written.
  expect(published.errors, 'the ride harness reported an error').toEqual([]);
  expect(published.ready).toBe(true);
}

/**
 * {@link openRide}, loaded once for every case in a row that only MEASURES the
 * page at this viewport and query — #1051, `shared-load.ts`. A case that
 * changes the page (a control taking the stage's class off, an inset, a click)
 * takes its own `page` and calls `openRide`.
 */
async function sharedRide(browser: Browser, viewport: Viewport, query = ''): Promise<Page> {
  return sharedPage(
    browser,
    `ride.html${query} at ${String(viewport.width)}×${String(viewport.height)}`,
    (page) => openRide(page, viewport, query),
    test.info(),
  );
}

// The page the cases below share goes when this file's cases do (`shared-load.ts`).
test.afterAll(releaseSharedPage);
// What a red shared case read, since the `page` fixture's screenshot is not it (#1076).
test.afterEach(async () => {
  await attachSharedPageOnFailure(test.info());
});

async function measure(page: Page): Promise<StageMeasurement> {
  const measured = await page.evaluate(() => window.__oylRide?.measure());
  if (measured === undefined) {
    throw new Error('the ride harness published no measurement');
  }
  return measured;
}

function inside(box: Box, viewport: Viewport): boolean {
  return (
    box.left >= -SUBPIXEL_TOLERANCE &&
    box.top >= -SUBPIXEL_TOLERANCE &&
    box.right <= viewport.width + SUBPIXEL_TOLERANCE &&
    box.bottom <= viewport.height + SUBPIXEL_TOLERANCE &&
    box.width > 0 &&
    box.height > 0
  );
}

function overlap(a: Box, b: Box): boolean {
  return (
    a.left < b.right - SUBPIXEL_TOLERANCE &&
    b.left < a.right - SUBPIXEL_TOLERANCE &&
    a.top < b.bottom - SUBPIXEL_TOLERANCE &&
    b.top < a.bottom - SUBPIXEL_TOLERANCE
  );
}

function describeItem(item: StageItem): string {
  const { box } = item;
  return (
    `${item.name} [${box.left.toFixed(0)},${box.top.toFixed(0)} → ` +
    `${box.right.toFixed(0)},${box.bottom.toFixed(0)}]${item.onTop ? '' : ' COVERED'}`
  );
}

/**
 * `game/camera.ts` §`riderFrameBox`, in this viewport's pixels, for a rider
 * leaning as far as one is ever drawn (#499).
 *
 * ⚠️ Non-vacuous by construction rather than by luck: it throws on a box too
 * small to overlap anything, because "no panel overlaps a rectangle of no
 * size" is true of every layout there is.
 */
function riderBox(viewport: Viewport, lean: number = MAXIMUM_LEAN_RADIANS): Box {
  // At the lean cap (#499): the bicycle stays mid-frame on the racing line
  // because the camera follows it across, but the rider's top rolls up to
  // 0.95 m to one side. A panel over a leaning rider is over the rider, at
  // EVERY overlay viewport — #512 closed the one (736×360) that used to be
  // held to the upright box, by narrowing the short corners layout's bottom
  // row rather than by moving the camera.
  const rider = riderFrameBox(viewport.width / viewport.height, lean);
  const box: Box = {
    left: rider.left * viewport.width,
    right: rider.right * viewport.width,
    top: rider.top * viewport.height,
    bottom: rider.bottom * viewport.height,
    width: (rider.right - rider.left) * viewport.width,
    height: (rider.bottom - rider.top) * viewport.height,
  };
  if (box.width < 10 || box.height < 40 || !inside(box, viewport)) {
    throw new Error(`the rider's frame box is not a usable rectangle: ${JSON.stringify(box)}`);
  }
  return box;
}

function named(items: readonly StageItem[], name: string): StageItem {
  const found = items.find((each) => each.name === name);
  if (found === undefined) {
    throw new Error(`the stage has no "${name}" — found: ${items.map((i) => i.name).join(', ')}`);
  }
  return found;
}

/**
 * #1120 — how many `@supports (anchor-name: …)` blocks `theme.css` has, and
 * how many `@supports not (anchor-name: …)` fallbacks. One each for #576's
 * side-camera row on a phone on its side, #1111's moving time below 802 px on
 * its side, and #1111's moving time upright. A block added or taken away
 * changes these, and the case that reads them says which.
 */
const ANCHOR_BLOCKS = 3;
const ANCHOR_FALLBACK_BLOCKS = 3;

/**
 * #1120 — the stage measured as an engine with NO anchor positioning lays it
 * out: Android System WebView older than Chrome 125. `ride-harness.tsx`
 * §`withoutAnchors` takes every `@supports (anchor-name: …)` block out of the
 * live stylesheet, puts every `@supports not (anchor-name: …)` block in force
 * (or, for the control, takes those out too — `main` before #1120), measures,
 * and puts the stylesheet back, in one synchronous call on the page as it is:
 * no load of its own, and a shared page is left as it was.
 *
 * ⚠️ **It cannot pass over a page where nothing was taken out.** Every call is
 * required to have taken out every anchor block, put every fallback in force
 * (or taken them out), left NOTHING on the stage with an `anchor-name` or a
 * `position-anchor` as the engine computes them, and put every rule back
 * exactly. §"the instrument" also holds that the same count was MORE than
 * zero, before, wherever the layout uses anchors at all.
 */
async function withoutAnchors(
  page: Page,
  fallback: AnchorFallback = 'shipped',
): Promise<StageMeasurement & { readonly anchoredBefore: number }> {
  const found = await page.evaluate((which) => window.__oylRide?.withoutAnchors(which), fallback);
  if (found === undefined) {
    throw new Error('the ride harness published no withoutAnchors');
  }
  expect(found.removed, 'every @supports (anchor-name: …) block taken out').toBe(ANCHOR_BLOCKS);
  expect(found.forced, 'every @supports not (anchor-name: …) block put in force').toBe(
    fallback === 'shipped' ? ANCHOR_FALLBACK_BLOCKS : 0,
  );
  expect(found.dropped, 'the fallbacks taken out too, for the control').toBe(
    fallback === 'shipped' ? 0 : ANCHOR_FALLBACK_BLOCKS,
  );
  expect(found.anchoredAfter, 'nothing on the stage laid out by anchor positioning').toBe(0);
  expect(found.restored, 'the stylesheet put back exactly').toBe(true);
  return { ...found.measurement, anchoredBefore: found.anchoredBefore };
}

/**
 * Whether the layout at this viewport uses anchor positioning at all
 * (`theme.css`): the short corners layout — 46 rem wide or more, 22.5 to 30 rem
 * tall — and the column layout, under 46 rem wide and 47 rem tall or more.
 */
function usesAnchorPositioning(viewport: Viewport): boolean {
  const short = viewport.width >= 736 && viewport.height >= 360 && viewport.height <= 480;
  const column = viewport.width >= 360 && viewport.width < 736 && viewport.height >= 752;
  return short || column;
}

/**
 * #1120 — where the layout `main` gave an engine without anchor positioning
 * put a panel over the leaning rider on the widest ride: the moving time a
 * third secondary row (`theme.css` §"THE MOVING TIME ON A NARROW PHONE ON ITS
 * SIDE" and §"THE MOVING TIME ON AN UPRIGHT PHONE"). Measured on this
 * repository's CI fonts. At 360×800, 736×480 and 844×390 the widest ride had
 * the room, so this cannot fail there and is not run there; what failed at
 * 360×800 was a standing notice beside it, which §"a ride with a standing
 * notice" holds both ways.
 */
const MAIN_FALLBACK_OVER_THE_RIDER = new Set(['736×360', '390×844', '360×752']);

/** The two ways a stage is laid out (#1120), each with the words a failure carries. */
const ANCHORED = 'with anchor positioning';
const UNANCHORED = 'without anchor positioning (#1120)';

/** One measurement of the page as it is, and one as an engine without anchors lays it out. */
async function bothWays(page: Page): Promise<(readonly [string, StageMeasurement])[]> {
  return [
    [ANCHORED, await measure(page)],
    [UNANCHORED, await withoutAnchors(page)],
  ];
}

/**
 * #1124: the least room `9:59:59` may have in its field, in CSS pixels — at
 * every overlay viewport, both ways (with anchor positioning and without).
 * Until #1124 the field was a fixed track or a fixed 6 rem and the time was
 * measured into what was left: 1.0 px at 844×390 and both landscape tablets
 * on the CI runner's DejaVu Sans, which a font change would have turned red
 * with nothing wrong in the product. The field is sized from its value's
 * own digits now (`theme.css` §"THE MOVING TIME'S OWN WIDTH — #1124"), and
 * the spare width is published at every viewport and held to this, as the
 * fold checks hold 50 px.
 */
const MOVING_TIME_SPARE_PIXELS = 4;

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
      // Ten readings, the strip, the plan view, the trainer line, two controls.
      expect(seen.items).toHaveLength(15);
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
      expect(seen.items).toHaveLength(15);
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
      for (const name of ['the trainer line', 'control: Pause', 'control: End ride']) {
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
          for (const name of ['control: Pause', 'control: End ride']) {
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
          expect(controls).toHaveLength(3);
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
  for (const name of ['control: Pause', 'control: End ride']) {
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

/**
 * #585 — a running workout's stall rescue, on the game's HUD (PR #599's
 * review, finding B1). `?rescue=floor` is the workout fixture above with the
 * rescue in force, and the floor is the longest sentence
 * `workout/rescue-text.ts` builds.
 *
 * ⚠️ **Why this exists**: the harness's trainer double returned `undefined`
 * from `workoutRescue`, so no case here had ever laid the "Eased" notice out
 * — and beside the road notice a workout always has, it was 309 px tall on a
 * phone on its side and put *Pause* and *End ride* below the stage, with every
 * case in this file green. `GameView` §`roadNotice` now gives the Eased notice
 * the one notice cell while the rescue holds, and this measures that at every
 * overlay viewport; the control below puts the road notice back beside it and
 * requires the same measurement to fail.
 */
function easedCollisions(seen: StageMeasurement, viewport: Viewport): string[] {
  const laidOut = seen.panels.filter((each) => each.box.height > 1);
  const found = laidOut.filter((each) => !inside(each.box, viewport)).map(describeItem);
  laidOut.forEach((a, index) => {
    for (const b of laidOut.slice(index + 1)) {
      if (overlap(a.box, b.box)) found.push(`${describeItem(a)} × ${describeItem(b)}`);
    }
  });
  found.push(...laidOut.filter((each) => overlap(each.box, riderBox(viewport))).map(describeItem));
  found.push(
    ...['control: Pause', 'control: End ride']
      .map((name) => named(seen.items, name))
      .filter((each) => !inside(each.box, viewport) || !each.onTop)
      .map(describeItem),
  );
  return found;
}

/**
 * #605 — how far the Eased notice must end above the leaning rider's box on an
 * UPRIGHT screen, where the notice is stacked over the sky and the rider is
 * under it. The number §4f treats as proven on a device: #585 shipped this at
 * 2 px on the CI runner (20 on a Mac), which was inside the gate and proved
 * nothing about a Pixel 8's fonts. The one-sentence notice clears it by the
 * figure each run prints.
 */
const EASED_RIDER_CLEARANCE_PIXELS = 50;

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

/** The HUD's notice cell as a rider reads it. */
async function noticeText(page: Page): Promise<string> {
  return page.evaluate(() => document.querySelector('.oyl-hud__notices')?.textContent ?? '');
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
  const pressed = ['control: Pause', 'control: End ride', 'the side camera stop'];
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
 * #647 — the ride being recorded may stop if the screen goes off, because the
 * platform refused the recording service. `?keepalive=failed` puts
 * *"Keep the screen on: your ride may stop without it."* in the
 * HUD's notice cell, where it stays for as long as the refusal does: it is a
 * safety sentence, so there is no toggle and no disclosure (the owner's ruling
 * on #654's re-review).
 *
 * `&trainer=workout` adds the longest road notice, which stands open for a
 * ride's first seconds and has a *Trainer notice* control. ⚠️ **Since #693's
 * review (N2) the refusal changes that on upright phones under 25 rem wide
 * and nowhere else**: there (`GameView` §`ONE_NOTICE_ONLY_QUERY` — 360×800,
 * 360×752 and 390×844 here) the road notice and its control are off the HUD
 * while the refusal stands, because the two together ran over the rider, or
 * up to it, however the road notice got open; everywhere else it opens, and
 * is put away, exactly as it does without the refusal — and the pair is held
 * over nothing, clear of the rider's box by `EASED_RIDER_CLEARANCE_PIXELS`
 * upright.
 *
 * The control takes the rule away — `matchMedia` answering "no" to that one
 * query before the page loads — and requires the pair, open, to come within
 * the clearance of the rider at the two 360 px phones. Not at 390×844, where
 * the pair ended 51 px above the rider on a Mac: inside the rule for the CI
 * runner's tighter fonts, not because it collides there.
 */
async function keepScreenOnNotice(page: Page): Promise<{
  text: string;
  inDisclosure: boolean;
  roadNoticeShown: boolean;
  roadNoticeOnHud: boolean;
}> {
  return page.evaluate(() => {
    const label = [...document.querySelectorAll('.oyl-hud__notices .oyl-status__label')].find(
      (each) => each.textContent?.startsWith('Keep the screen on'),
    );
    const notice = label?.closest('.oyl-status');
    const road = document.querySelector('#oyl-hud-standing-notice');
    return {
      text: (notice?.textContent ?? '').replace(/\s+/g, ' '),
      inDisclosure: (notice?.closest('details') ?? null) !== null,
      roadNoticeShown: road !== null && !road.classList.contains('oyl-visually-hidden'),
      roadNoticeOnHud: road !== null,
    };
  });
}

/** The keep-the-screen-on notice laid out on the stage, over nothing. */
function keepScreenOnLaidOut(
  seen: StageMeasurement,
  viewport: Viewport,
  what: string,
): { readonly collisions: string[]; readonly clearance: number } {
  const notice = seen.panels.find((each) => each.name.includes('oyl-hud__notices'));
  const onAPhone = Math.min(viewport.width, viewport.height) <= 480;
  const laidOut = seen.panels.filter((each) => each.box.height > 1);
  expect(laidOut).toHaveLength(onAPhone ? 4 : 5);
  const rider = riderBox(viewport);
  const clearance = rider.top - (notice?.box.bottom ?? Infinity);
  console.log(
    `keep the screen on, ${what} — ${viewport.name} — notice cell ${(notice?.box.height ?? 0).toFixed(0)} px tall` +
      (viewport.height > viewport.width
        ? `; ${clearance.toFixed(0)} px above the rider's box`
        : `; ends at x = ${(notice?.box.right ?? 0).toFixed(0)}, rider from x = ${rider.left.toFixed(0)}`),
  );
  return { collisions: easedCollisions(seen, viewport), clearance };
}

const KEEP_SCREEN_ON_SEEN = '!Keep the screen on: your ride may stop without it.';

/** `GameView` §`ONE_NOTICE_ONLY_QUERY`'s phones: the column layout under 25 rem wide. */
const oneNoticeOnly = (viewport: Viewport): boolean =>
  viewport.width >= 360 && viewport.width < 400 && viewport.height >= 752;

test.describe('a ride that may stop with the screen off — #647', () => {
  for (const [query, what] of [
    ['?keepalive=failed', 'alone'],
    ['?keepalive=failed&trainer=workout', 'with the road notice'],
  ] as const) {
    for (const viewport of OVERLAY_VIEWPORTS) {
      test(`the notice, ${what}, whole and over nothing — ${viewport.name}`, async ({ page }) => {
        await openRide(page, viewport, query);
        const found = await keepScreenOnNotice(page);
        expect(found.text).toBe(KEEP_SCREEN_ON_SEEN);
        expect(found.inDisclosure).toBe(false);
        const withRoad = query.includes('trainer=workout');
        if (withRoad && !oneNoticeOnly(viewport)) {
          // As without the refusal: open for the ride's first seconds, beside
          // it, with its control on the HUD.
          expect(found.roadNoticeShown).toBe(true);
          const toggle = named((await measure(page)).items, 'control: Trainer notice');
          expect(inside(toggle.box, viewport) && toggle.onTop, describeItem(toggle)).toBe(true);
        } else {
          // Alone — and at the two narrowest upright phones, the road notice
          // and its control are not on the HUD while the refusal stands.
          expect(found.roadNoticeOnHud).toBe(false);
          expect(
            (await measure(page)).items.some((each) => each.name === 'control: Trainer notice'),
          ).toBe(false);
        }
        const described = withRoad && oneNoticeOnly(viewport) ? 'road notice off the HUD' : what;
        // #1120: and as an engine without anchor positioning lays it out.
        for (const [how, seen] of await bothWays(page)) {
          await test.step(how, () => {
            const { collisions, clearance } = keepScreenOnLaidOut(
              seen,
              viewport,
              `${described}, ${how}`,
            );
            expect(collisions).toEqual([]);
            if (viewport.height > viewport.width) {
              expect(clearance).toBeGreaterThanOrEqual(EASED_RIDER_CLEARANCE_PIXELS);
            }
          });
        }
      });
    }
  }

  // The control: the rule taken away. `matchMedia` answers "no" to
  // ONE_NOTICE_ONLY_QUERY before the page loads, so at the two 360 px
  // upright phones the road notice opens beside it as it does elsewhere — and
  // must come within the clearance of the rider, or the rule is being held
  // over a pair that always fitted.
  for (const viewport of OVERLAY_VIEWPORTS.filter((each) => each.width === 360)) {
    test(`the control — without the rule, the road notice open beside it comes within the clearance of the rider — ${viewport.name}`, async ({
      page,
    }) => {
      await page.addInitScript(() => {
        const real = window.matchMedia.bind(window);
        // `not all` matches nothing, in the browser's own MediaQueryList.
        window.matchMedia = (query: string): MediaQueryList =>
          real(query.includes('width < 25rem') ? 'not all' : query);
      });
      await openRide(page, viewport, '?keepalive=failed&trainer=workout');
      await expect.poll(async () => (await keepScreenOnNotice(page)).roadNoticeShown).toBe(true);
      // ⚠️ Clearance only, since #693's re-review shortened the sentence (to
      // one line on a Mac; the CI runner still wraps it): the pair open now
      // ends 26 px (360×800) and 1 px (360×752) ABOVE the rider's box on a
      // Mac, where the longer one ran 27 px into it — under the clearance
      // still, and so still the rule's reason.
      const { clearance } = keepScreenOnLaidOut(
        await measure(page),
        viewport,
        'without the rule, the road notice open',
      );
      expect(clearance).toBeLessThan(EASED_RIDER_CLEARANCE_PIXELS);
    });
  }
});

/**
 * #647 — #693's re-review, B2: *"Keep the screen on"* beside EACH other
 * notice the HUD never puts away. The notice cell stacks every one of them —
 * the *Trainer* fault, *Eased* (#585), the side camera's lost link (#551) and
 * this — so a pair is a taller cell over the same rider, and none of the
 * sentences may be put away to make room.
 *
 * Every pair is held over nothing at every overlay viewport and, upright, to
 * `EASED_RIDER_CLEARANCE_PIXELS` above the leaning rider's box — #605's floor
 * for the Eased notice, which the other two pairs meet by the same geometry
 * (a two-line notice and a one-line one), so they are held to it too rather
 * than only to "no collision". Each prints its clearance.
 *
 * What gets it there: *"Keep the screen on: your ride may stop without it."*
 * is shorter — one line at 360 px on a Mac, though still two on the CI runner,
 * whose fonts are wider — and two notices sharing the cell give up half their
 * vertical padding (`theme.css` §"Two notices in the one cell"), which on the
 * runner is what clears the floor. As round one
 * of #693 shipped it — the longer sentence, full padding — the pair beside
 * Eased ended 38 px above the rider at 360×752; the control below puts both
 * back and requires the same measurement to fall under the floor.
 */
const NEVER_PUT_AWAY: readonly (readonly [query: string, beside: string, words: string])[] = [
  ['&rescue=floor', 'Eased', 'Eased'],
  ['&side=lost', 'the side camera lost', 'Side camera'],
  ['&gradient=refused', 'a trainer fault', 'stopped accepting the road'],
];

/**
 * The stage measured on a SETTLED frame that has both notices in the cell. The
 * refusing trainer's fault can be absent for a frame (`ride-harness.tsx`
 * §`REFUSED`), so the check and the measurement are one evaluation.
 *
 * ⚠️ **The first frame with both is not always the settled one** (#871): on
 * `main` the pair beside Eased at 360×752 measured 55 px above the rider on 2
 * of 8 local runs and 69 px on the other six, and 41 px once on CI (#868's
 * first run). So a measurement counts only when the next poll, both notices
 * still present, reads the same notice cell — two equal consecutive readings
 * of its box. The cell and not the whole stage: the ride is running, and a
 * reading's box may change width with its value between any two polls.
 */
async function measureWithBoth(page: Page, words: string): Promise<StageMeasurement> {
  let found: StageMeasurement | undefined;
  let previous: string | undefined;
  await expect
    .poll(async () => {
      const reading = await page.evaluate((beside) => {
        const text = document.querySelector('.oyl-hud__notices')?.textContent ?? '';
        return text.includes(beside) && text.includes('Keep the screen on')
          ? window.__oylRide?.measure()
          : undefined;
      }, words);
      const key =
        reading === undefined
          ? undefined
          : JSON.stringify(
              reading.panels.find((each) => each.name.includes('oyl-hud__notices'))?.box,
            );
      const settled = key !== undefined && key === previous;
      previous = key;
      found = settled ? reading : undefined;
      return settled;
    })
    .toBe(true);
  if (found === undefined) throw new Error('unreachable');
  return found;
}

test.describe('keep the screen on, beside every notice that stays — #647', () => {
  for (const [query, beside, words] of NEVER_PUT_AWAY) {
    for (const viewport of OVERLAY_VIEWPORTS) {
      test(`beside ${beside}, over nothing — ${viewport.name}`, async ({ page }) => {
        await openRide(page, viewport, `?keepalive=failed${query}`);
        const settled = await measureWithBoth(page, words);
        // #1120: and the same settled frame as an engine without anchor
        // positioning lays it out — read straight after, with both notices
        // still in the cell (asserted).
        const bare = await withoutAnchors(page);
        expect(bare.panels.find((each) => each.name.includes('oyl-hud__notices'))?.box).toEqual(
          settled.panels.find((each) => each.name.includes('oyl-hud__notices'))?.box,
        );
        for (const [how, seen] of [
          [ANCHORED, settled],
          [UNANCHORED, bare],
        ] as const) {
          const notice = seen.panels.find((each) => each.name.includes('oyl-hud__notices'));
          const rider = riderBox(viewport);
          const clearance = rider.top - (notice?.box.bottom ?? Infinity);
          console.log(
            `keep the screen on beside ${beside} — ${viewport.name} — ${how} — notice cell ` +
              `${(notice?.box.height ?? 0).toFixed(0)} px tall` +
              (viewport.height > viewport.width
                ? `; ${clearance.toFixed(0)} px above the rider's box`
                : `; ends at x = ${(notice?.box.right ?? 0).toFixed(0)}, rider from x = ${rider.left.toFixed(0)}`),
          );
          expect(easedCollisions(seen, viewport), how).toEqual([]);
          if (viewport.height > viewport.width) {
            expect(clearance, how).toBeGreaterThanOrEqual(EASED_RIDER_CLEARANCE_PIXELS);
          }
        }
      });
    }
  }

  // The control: the cell as round one of #693 shipped it — the old, longer
  // sentence in the same notice, and both notices at the padding a notice has
  // alone. Same elements, same cell, same viewport; only the words and the
  // padding change. It must fall under the floor, or the floor above is being
  // held over a cell that could never have reached the rider.
  for (const viewport of OVERLAY_VIEWPORTS.filter((each) => each.height === 752)) {
    test(`the control — as round one shipped it, the pair beside Eased comes within ${String(EASED_RIDER_CLEARANCE_PIXELS)} px of the rider — ${viewport.name}`, async ({
      page,
    }) => {
      await openRide(page, viewport, '?keepalive=failed&rescue=floor');
      await measureWithBoth(page, 'Eased');
      await page.evaluate(() => {
        const statuses = [
          ...document.querySelectorAll<HTMLElement>('.oyl-hud__notices > .oyl-status'),
        ];
        const label = statuses
          .map((each) => each.querySelector('.oyl-status__label'))
          .find((each) => each?.textContent?.startsWith('Keep the screen on'));
        const body = label?.parentElement;
        if (label === null || label === undefined || body === null || body === undefined) {
          throw new Error('no keep-the-screen-on notice to restore');
        }
        body.replaceChildren(label, 'your ride may stop if the screen goes off.');
        for (const each of statuses) each.style.padding = 'var(--oyl-space-sm)';
      });
      const text = await noticeText(page);
      expect(text).toContain('Eased');
      expect(text).toContain('Keep the screen on: your ride may stop if the screen goes off.');
      const seen = await measure(page);
      const notice = seen.panels.find((each) => each.name.includes('oyl-hud__notices'));
      const clearance = riderBox(viewport).top - (notice?.box.bottom ?? Infinity);
      console.log(
        `keep the screen on beside Eased, as round one shipped it — ${viewport.name} — ${clearance.toFixed(0)} px above the rider's box`,
      );
      expect(clearance).toBeLessThan(EASED_RIDER_CLEARANCE_PIXELS);
    });
  }
});

/*
 * #940 — THE PRE-RIDE CHOOSER.
 *
 * `ride.html?picker=chooser` stops at the chooser with seven routes rather than
 * riding (`ride-harness.tsx` §`PICKER`). The LAST route's name is as long as a
 * route's name can be (`routes/save.ts` §`MAXIMUM_ROUTE_NAME_LENGTH`), so the
 * *Ride* named after it is the tallest it gets. Each case chooses that card as
 * a rider does, puts the page back at `scrollY === 0`, and reads *Ride*: on the
 * screen, the topmost thing at its own centre, and on the owner's tablet with
 * the #439 insets 50 px clear of the fold (`rideview.browser.spec.ts`
 * §`FOLD_MARGIN_PIXELS`' floor and its reason). Every margin is printed.
 *
 * ⚠️ **The control is `?picker=list`**: the same chooser with the old picker's
 * layout put back — the loadout above the routes, one route to a row, and
 * *Ride* after them — and *Ride* must then be under the tablet's floor.
 * Without it, every assertion here is true of a chooser with one short route.
 */

/** `rideview.browser.spec.ts` §`FOLD_MARGIN_PIXELS`, restated for a different page. */
const CHOOSER_FOLD_FLOOR_PIXELS = 50;

/** `design/ride-time-controls.ts` §`RIDE_TIME_TARGET_PIXELS`. */
const CHOOSER_RIDE_TARGET_PIXELS = 48;

interface ChooserViewport {
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly insets: boolean;
}

const TABLET_IN_THE_SHELL_CHOOSER: ChooserViewport = {
  name: 'a landscape tablet inside the Android shell — 1280×800, insets 36/32',
  width: 1280,
  height: 800,
  insets: true,
};

/** The three viewports #940 names. */
const CHOOSER_VIEWPORTS: readonly ChooserViewport[] = [
  { name: 'a phone upright — 390×844', width: 390, height: 844, insets: false },
  { name: 'a phone in landscape — 844×390', width: 844, height: 390, insets: false },
  TABLET_IN_THE_SHELL_CHOOSER,
];

/**
 * #940's second review: every size it measured a pinned *Ride* over the
 * promise at, and the two where the longest name outgrew the pin, beside
 * #940's own three and two between its layouts.
 */
const CHOOSER_REVIEW_VIEWPORTS: readonly ChooserViewport[] = [
  { name: '932×430', width: 932, height: 430, insets: false },
  { name: '844×390', width: 844, height: 390, insets: false },
  { name: '740×360', width: 740, height: 360, insets: false },
  { name: '640×360', width: 640, height: 360, insets: false },
  { name: '568×320', width: 568, height: 320, insets: false },
  { name: '320×640', width: 320, height: 640, insets: false },
  { name: '360×740', width: 360, height: 740, insets: false },
  { name: '390×844', width: 390, height: 844, insets: false },
  { name: '1024×768', width: 1024, height: 768, insets: false },
  { name: '800×1280', width: 800, height: 1280, insets: false },
  TABLET_IN_THE_SHELL_CHOOSER,
];

/** Where the chooser's *Ride* is, and the three readings of its size. */
interface ChooserRide {
  readonly text: string;
  readonly top: number;
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
  readonly width: number;
  readonly height: number;
  readonly onTop: boolean;
  readonly scrollY: number;
  readonly fold: number;
  readonly minHeight: number;
  readonly minWidth: number;
}

/**
 * Which notices stand above *Ride*. `promise` is the default fixture: a ready
 * trainer, so only #503's promise. `release` is a ready trainer whose last
 * release was not confirmed — the release fault AND the promise, the state in
 * which #940's pinned *Ride* hid the whole promise on every landscape phone.
 * `all` is the TALLEST stack (`ride-harness.tsx` §`ALL_NOTICES`): the release
 * fault, the trainer notice and the realistic world.
 */
type ChooserNotices = 'promise' | 'release' | 'all';

const CHOOSER_NOTICE_STATES: readonly ChooserNotices[] = ['promise', 'release', 'all'];

async function openChooser(
  page: Page,
  viewport: ChooserViewport,
  query: 'chooser' | 'list',
  notices: ChooserNotices = 'promise',
): Promise<void> {
  if (viewport.insets) {
    await applyInsets(page, PIXEL_TABLET_LANDSCAPE_INSETS);
  }
  await openRide(
    page,
    { ...viewport, unstagedFails: false },
    `?picker=${query}${notices === 'promise' ? '' : `&notices=${notices}`}`,
  );
}

/** The notice labels each state must render, in order, every one above *Ride*. */
const CHOOSER_NOTICE_LABELS: Readonly<Record<ChooserNotices, readonly string[]>> = {
  promise: ['Your trainer'],
  release: ['Not released', 'Your trainer'],
  // #1011: the realistic world is a compact line FIRST, so #503's promise —
  // or here the trainer notice standing in its place — is last before Ride.
  all: ['Realistic world', 'Not released', 'The road will not reach your trainer'],
};

/**
 * One reading of the chooser at the page's CURRENT scroll, with whatever is
 * pinned left where it is: whether *Ride* is the topmost thing at its centre,
 * and for every notice how many of a grid of points over its whole box the
 * hit test reaches (`elementFromPoint` lands inside the notice), how many lie
 * off the screen or under the shell's sticky header (scrolled past), and how
 * many land on something else — which is a notice OBSCURED.
 */
interface ChooserSight {
  readonly scrollY: number;
  readonly rideOnTop: boolean;
  readonly notices: readonly {
    readonly label: string;
    readonly reached: number;
    readonly offScreen: number;
    readonly obscured: number;
    readonly points: number;
    /** Page coordinates, for the order. */
    readonly top: number;
    readonly bottom: number;
  }[];
  /** *Ride*'s top in page coordinates. */
  readonly rideTop: number;
}

/** Read {@link ChooserSight} at each of `scrolls` (page offsets; clamped by the browser). */
async function sightsAt(page: Page, scrolls: readonly number[] | 'sweep'): Promise<ChooserSight[]> {
  return page.evaluate((asked) => {
    const chooser = document.querySelector('.oyl-chooser');
    if (chooser === null) throw new Error('no chooser');
    const ride = [...chooser.querySelectorAll<HTMLButtonElement>('button')].find((each) =>
      (each.textContent ?? '').startsWith('Ride '),
    );
    if (ride === undefined) throw new Error('the chooser has no Ride');
    const maximum = document.documentElement.scrollHeight - window.innerHeight;
    const offsets: number[] = [];
    if (asked === 'sweep') {
      for (let y = 0; y < maximum; y += 24) offsets.push(y);
      offsets.push(Math.max(0, maximum));
    } else {
      offsets.push(...asked);
    }
    const header = document.querySelector<HTMLElement>('.oyl-header');
    const readings = [];
    for (const offset of offsets) {
      window.scrollTo(0, offset);
      const rideBox = ride.getBoundingClientRect();
      const cx = rideBox.left + rideBox.width / 2;
      const cy = rideBox.top + rideBox.height / 2;
      const inView = cx >= 0 && cx < window.innerWidth && cy >= 0 && cy < window.innerHeight;
      const hit = inView ? document.elementFromPoint(cx, cy) : null;
      // Every notice above Ride: each status box, and since #1011 the
      // realistic world's one line.
      const notices = [...chooser.querySelectorAll<HTMLElement>('.oyl-chooser__notices > *')].map(
        (each) => {
          const box = each.getBoundingClientRect();
          let reached = 0;
          let offScreen = 0;
          let obscured = 0;
          let points = 0;
          // Every 6 px down and across over the WHOLE box, inset only by its
          // corner radius: a hit test 1 px inside a rounded corner is outside
          // the shape and lands on whatever is behind it.
          const inset =
            Math.max(1, Number.parseFloat(getComputedStyle(each).borderTopLeftRadius)) + 1;
          for (let y = box.top + inset; y <= box.bottom - inset; y += 6) {
            for (let x = box.left + inset; x <= box.right - inset; x += 6) {
              points += 1;
              if (x < 0 || y < 0 || x >= window.innerWidth || y >= window.innerHeight) {
                offScreen += 1;
                continue;
              }
              const at = document.elementFromPoint(x, y);
              if (at !== null && each.contains(at)) reached += 1;
              else if (at !== null && header !== null && header.contains(at)) offScreen += 1;
              else obscured += 1;
            }
          }
          return {
            label:
              each
                .querySelector('.oyl-status__label, .oyl-chooser__world-label')
                ?.textContent?.replace(/:\s*$/, '') ?? '',
            reached,
            offScreen,
            obscured,
            points,
            top: box.top + window.scrollY,
            bottom: box.bottom + window.scrollY,
          };
        },
      );
      readings.push({
        scrollY: window.scrollY,
        rideOnTop: hit !== null && ride.contains(hit),
        notices,
        rideTop: rideBox.top + window.scrollY,
      });
    }
    window.scrollTo(0, 0);
    return readings;
  }, scrolls);
}

/**
 * Tab through EVERY control in the chooser — forwards from the top of the
 * page, or backwards from its last control — and for each, read how much of
 * it lies behind anything pinned ANYWHERE in the document: any box whose
 * computed `position` is `sticky` or `fixed` (the shell's header and its
 * navigation included), less the control's own ancestors. Chromium scrolls a
 * newly focused control just into the viewport, so a control at an edge is
 * exactly where a pinned box sits (WCAG 2.2 SC 2.4.11, and 2.4.12's "any
 * part").
 */
async function tabWalk(
  page: Page,
  direction: 'forwards' | 'backwards',
): Promise<
  readonly {
    readonly name: string;
    readonly covered: number;
    readonly height: number;
  }[]
> {
  await page.evaluate((backwards) => {
    window.scrollTo(0, 0);
    (document.activeElement as HTMLElement | null)?.blur();
    if (backwards) {
      const chooser = document.querySelector('.oyl-chooser');
      const controls = [
        ...(chooser?.querySelectorAll<HTMLElement>('input, select, button, a[href]') ?? []),
      ].filter((each) => each.tabIndex >= 0 && !(each as HTMLInputElement).disabled);
      const last = controls.at(-1);
      if (last === undefined) throw new Error('the chooser has no controls');
      last.focus();
    }
  }, direction === 'backwards');
  const key = direction === 'forwards' ? 'Tab' : 'Shift+Tab';
  const seen: { name: string; covered: number; height: number }[] = [];
  const read = () =>
    page.evaluate(() => {
      const element = document.activeElement as HTMLElement | null;
      if (element === null || element === document.body) return { kind: 'nothing' as const };
      const chooser = document.querySelector('.oyl-chooser');
      if (chooser === null || !chooser.contains(element)) return { kind: 'outside' as const };
      const box = element.getBoundingClientRect();
      const pinned = [...document.querySelectorAll<HTMLElement>('*')].filter((each) => {
        const position = getComputedStyle(each).position;
        return (position === 'sticky' || position === 'fixed') && !each.contains(element);
      });
      let covered = 0;
      for (const pin of pinned) {
        const over = pin.getBoundingClientRect();
        const height = Math.min(box.bottom, over.bottom) - Math.max(box.top, over.top);
        const width = Math.min(box.right, over.right) - Math.max(box.left, over.left);
        if (height > 0 && width > 0) covered = Math.max(covered, height);
      }
      // Off the screen counts as covered: a focused control nobody can see.
      covered = Math.max(covered, -box.top, box.bottom - window.innerHeight, 0);
      // A label's own words, without a `<select>`'s options inside it.
      const label = (element as HTMLInputElement).labels?.[0];
      const words =
        label === undefined
          ? ''
          : [...label.childNodes]
              .filter((node) => node.nodeType === Node.TEXT_NODE)
              .map((node) => node.textContent ?? '')
              .join('');
      const name =
        element.getAttribute('aria-label') ??
        (words === '' ? (element.textContent ?? element.tagName) : words);
      return {
        kind: 'control' as const,
        name: name.trim().slice(0, 60),
        covered,
        height: box.height,
      };
    });
  if (direction === 'backwards') {
    const first = await read();
    if (first.kind === 'control') seen.push(first);
  }
  for (let press = 0; press < 60; press += 1) {
    await page.keyboard.press(key);
    const reading = await read();
    if (reading.kind === 'nothing') break;
    if (reading.kind === 'outside') {
      if (seen.length > 0) break;
      continue;
    }
    seen.push({ name: reading.name, covered: reading.covered, height: reading.height });
  }
  return seen;
}

/**
 * `routes/save.ts` §`MAXIMUM_ROUTE_NAME_LENGTH`, as the harness publishes it —
 * the spec runs in Node and does not import the client (`devices-fixture.ts`'
 * reason); the harness builds its longest name from the constant and refuses
 * to start if the two disagree.
 */
async function maximumRouteName(page: Page): Promise<number> {
  const published = await page.evaluate(() => document.documentElement.dataset.oylMaximumRouteName);
  const bound = Number(published);
  expect(bound, 'the harness published no route-name bound').toBeGreaterThan(0);
  return bound;
}

/** Choose the last card, as a rider does, and return its name. */
async function chooseLast(page: Page): Promise<string> {
  const lastName = await page.evaluate(() => {
    const radios = [...document.querySelectorAll<HTMLInputElement>('.oyl-chooser__radio')];
    const last = radios.at(-1);
    if (last === undefined || radios.length < 2) throw new Error('the chooser offers no routes');
    last.click();
    last.blur();
    return document.querySelector(`label[for="${last.id}"]`)?.textContent ?? '';
  });
  await page.waitForFunction(
    (name) =>
      [...document.querySelectorAll('button')].some((each) => each.textContent === `Ride ${name}`),
    lastName,
  );
  return lastName;
}

/** Choose the last card, as a rider does, then read *Ride* at the top of the page. */
async function chooseLastAndReadRide(page: Page): Promise<ChooserRide> {
  await chooseLast(page);
  return page.evaluate(() => {
    window.scrollTo(0, 0);
    const ride = [...document.querySelectorAll<HTMLButtonElement>('.oyl-chooser__go button')].find(
      (each) => (each.textContent ?? '').startsWith('Ride '),
    );
    if (ride === undefined) throw new Error('the chooser has no Ride');
    const box = ride.getBoundingClientRect();
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    const probe = document.createElement('div');
    probe.style.cssText =
      'position:fixed;visibility:hidden;bottom:0;height:env(safe-area-inset-bottom,0px)';
    document.body.append(probe);
    const inset = probe.getBoundingClientRect().height;
    probe.remove();
    // A navigation BAR along the bottom is a fold too (`controls-first`'s rule).
    const nav = document.querySelector<HTMLElement>('.oyl-nav');
    const navBox = nav?.getBoundingClientRect();
    const barTop =
      nav !== null &&
      navBox !== undefined &&
      getComputedStyle(nav).position === 'fixed' &&
      navBox.width >= window.innerWidth - 1
        ? navBox.top
        : window.innerHeight;
    const style = getComputedStyle(ride);
    const minHeight = Number.parseFloat(style.minHeight);
    const minWidth = Number.parseFloat(style.minWidth);
    return {
      text: ride.textContent ?? '',
      top: box.top,
      bottom: box.bottom,
      left: box.left,
      right: box.right,
      width: box.width,
      height: box.height,
      onTop: hit !== null && ride.contains(hit),
      scrollY: window.scrollY,
      fold: Math.min(window.innerHeight - inset, barTop),
      minHeight,
      minWidth,
    };
  });
}

/** The most space between the last notice and *Ride*: one notice's own margin. */
const CHOOSER_NOTICE_TO_RIDE_PIXELS = 16;

/**
 * Where #940's criterion — *Ride* on the screen at `scrollY === 0` — must hold,
 * and where it CANNOT without hiding a notice, which #503 forbids: on a phone
 * held sideways a release fault and the promise are taller than what the
 * shell leaves under its own title and summary (they end 15 px above the
 * fold on a Mac), and the tallest stack is taller than an upright phone's
 * screen above its navigation bar (21 px left). There the case requires
 * *Ride* to come straight after the last notice — the notices, and nothing
 * else, are what is in its way — and lets it be on the screen if the fonts
 * leave room.
 */
const RIDE_AT_THE_TOP: Readonly<Record<ChooserNotices, readonly string[]>> = {
  promise: CHOOSER_VIEWPORTS.map((each) => each.name),
  release: [CHOOSER_VIEWPORTS[0]?.name ?? '', TABLET_IN_THE_SHELL_CHOOSER.name],
  all: [TABLET_IN_THE_SHELL_CHOOSER.name],
};

test.describe('#940 — the pre-ride chooser', () => {
  for (const notices of CHOOSER_NOTICE_STATES) {
    for (const viewport of CHOOSER_VIEWPORTS) {
      const onScreen = RIDE_AT_THE_TOP[notices].includes(viewport.name);
      test(`notices ${notices}: ${onScreen ? 'Ride is on the screen' : 'Ride comes straight after the notices'} after choosing the last route — ${viewport.name}`, async ({
        page,
      }) => {
        await openChooser(page, viewport, 'chooser', notices);
        const ride = await chooseLastAndReadRide(page);
        const margin = ride.fold - ride.bottom;
        const lastNotice = await page.evaluate(() =>
          Math.max(
            ...[...document.querySelectorAll('.oyl-chooser__notices > *')].map(
              (each) => each.getBoundingClientRect().bottom,
            ),
          ),
        );
        console.log(
          `#940 notices ${notices} — ${viewport.name}: Ride at ${ride.top.toFixed(1)}–${ride.bottom.toFixed(1)} px (${ride.height.toFixed(0)} tall), ${margin.toFixed(1)} px above the fold; the notices end at ${lastNotice.toFixed(1)} px, ${(ride.fold - lastNotice).toFixed(1)} px above it`,
        );

        expect(ride.text.length).toBe('Ride '.length + (await maximumRouteName(page)));
        expect(ride.scrollY).toBe(0);
        expect(ride.left).toBeGreaterThanOrEqual(-SUBPIXEL_TOLERANCE);
        expect(ride.right).toBeLessThanOrEqual(viewport.width + SUBPIXEL_TOLERANCE);
        // ONE line, whatever the name (`.oyl-chooser__ride-label`).
        expect(ride.height).toBeLessThanOrEqual(CHOOSER_RIDE_TARGET_PIXELS + SUBPIXEL_TOLERANCE);
        if (onScreen) {
          expect(ride.top).toBeGreaterThanOrEqual(-SUBPIXEL_TOLERANCE);
          expect(margin).toBeGreaterThanOrEqual(viewport.insets ? CHOOSER_FOLD_FLOOR_PIXELS : 0);
          expect(ride.onTop, 'something covers Ride at its own centre').toBe(true);
        } else {
          // Ride straight after the last notice, and nothing else between:
          // what keeps it off the screen is the notices #503 needs read first.
          expect(ride.top - lastNotice).toBeGreaterThanOrEqual(0);
          expect(ride.top - lastNotice).toBeLessThanOrEqual(
            CHOOSER_NOTICE_TO_RIDE_PIXELS + SUBPIXEL_TOLERANCE,
          );
        }
      });
    }
  }

  for (const viewport of CHOOSER_VIEWPORTS) {
    test(`Ride is at least 48 × 48, as laid out and as declared — ${viewport.name}`, async ({
      page,
    }) => {
      await openChooser(page, viewport, 'chooser');
      const ride = await chooseLastAndReadRide(page);
      // The shipped box.
      expect(ride.height).toBeGreaterThanOrEqual(CHOOSER_RIDE_TARGET_PIXELS);
      expect(ride.width).toBeGreaterThanOrEqual(CHOOSER_RIDE_TARGET_PIXELS);
      // The declaration (`.oyl-button--ride`).
      expect(ride.minHeight).toBeGreaterThanOrEqual(CHOOSER_RIDE_TARGET_PIXELS);
      expect(ride.minWidth).toBeGreaterThanOrEqual(CHOOSER_RIDE_TARGET_PIXELS);
      // The third reading, the box with the floor stripped, is the case after
      // this loop: the last route's name wraps, and a two-line Ride is over 48
      // without any floor, so it is read on the first route's one line.
    });
  }

  test('the floor is what holds Ride at 48 px — a one-line Ride, stripped', async ({ page }) => {
    await openChooser(page, TABLET_IN_THE_SHELL_CHOOSER, 'chooser');
    const stripped = await page.evaluate(() => {
      const ride = [
        ...document.querySelectorAll<HTMLButtonElement>('.oyl-chooser__go button'),
      ].find((each) => (each.textContent ?? '').startsWith('Ride '));
      if (ride === undefined) throw new Error('the chooser has no Ride');
      const shipped = ride.getBoundingClientRect().height;
      ride.style.minHeight = '0px';
      ride.style.minWidth = '0px';
      return {
        text: ride.textContent ?? '',
        shipped,
        stripped: ride.getBoundingClientRect().height,
      };
    });
    expect(stripped.text).toBe('Ride Harness hills');
    expect(stripped.shipped).toBeGreaterThanOrEqual(CHOOSER_RIDE_TARGET_PIXELS);
    expect(stripped.stripped).toBeLessThan(CHOOSER_RIDE_TARGET_PIXELS);
  });

  test('the control — the old list puts Ride under the tablet’s floor', async ({ page }) => {
    await openChooser(page, TABLET_IN_THE_SHELL_CHOOSER, 'list');
    const ride = await chooseLastAndReadRide(page);
    const margin = ride.fold - ride.bottom;
    console.log(
      `#940 — the control, ${TABLET_IN_THE_SHELL_CHOOSER.name}: Ride ends ${margin.toFixed(1)} px above the fold`,
    );
    expect(margin).toBeLessThan(CHOOSER_FOLD_FLOOR_PIXELS);
  });

  for (const colorScheme of ['light', 'dark'] as const) {
    test(`a card's focus ring is 3:1, and the arrow keys move the choice — ${colorScheme}`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme });
      await openChooser(page, TABLET_IN_THE_SHELL_CHOOSER, 'chooser');
      expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe(colorScheme);
      await page.evaluate(() => {
        (document.activeElement as HTMLElement | null)?.blur();
      });
      let onRadio = false;
      for (let press = 0; press < 40 && !onRadio; press += 1) {
        await page.keyboard.press('Tab');
        onRadio = await page.evaluate(
          () => document.activeElement?.classList.contains('oyl-chooser__radio') ?? false,
        );
      }
      expect(onRadio, 'Tab never reached a route card').toBe(true);
      const rings = await page.evaluate(() => {
        const radio = document.activeElement as HTMLInputElement;
        const card = radio.closest('.oyl-chooser__card') as HTMLElement;
        const paintedBehind = (element: Element): string => {
          for (let at = element.parentElement; at !== null; at = at.parentElement) {
            const background = getComputedStyle(at).backgroundColor;
            if (background !== 'rgba(0, 0, 0, 0)' && background !== 'transparent') {
              return background;
            }
          }
          return getComputedStyle(document.documentElement).backgroundColor;
        };
        const read = (element: Element) => {
          const style = getComputedStyle(element);
          return {
            colour: style.outlineColor,
            style: style.outlineStyle,
            width: Number.parseFloat(style.outlineWidth),
            surface: paintedBehind(element),
          };
        };
        return {
          visible: radio.matches(':focus-visible'),
          checked: radio.checked,
          card: read(card),
          radio: read(radio),
        };
      });
      expect(rings.visible).toBe(true);
      for (const ring of [rings.card, rings.radio]) {
        expect(ring.style).toBe('solid');
        expect(ring.width).toBeGreaterThanOrEqual(2);
        expect(
          contrastRatio(hexOf(ring.colour), hexOf(ring.surface)),
          `${ring.colour} on ${ring.surface}`,
        ).toBeGreaterThanOrEqual(AA_LARGE_TEXT_OR_NON_TEXT);
      }

      // Native radio behaviour: an arrow key moves the choice, and Ride follows.
      const rideText = () =>
        page.evaluate(
          () => [...document.querySelectorAll('.oyl-chooser__go button')].at(-1)?.textContent,
        );
      const before = await rideText();
      await page.keyboard.press('ArrowDown');
      const after = {
        ride: await rideText(),
        focused: await page.evaluate(
          () => document.activeElement?.classList.contains('oyl-chooser__radio') ?? false,
        ),
      };
      expect(after.focused).toBe(true);
      expect(after.ride).not.toBe(before);

      // The tab order is notices, Ride, the cards, the loadout: Tab leaves the
      // group for the loadout and never meets Ride again, and Shift+Tab from
      // the group lands on Ride, now named for the route just chosen.
      const where = () =>
        page.evaluate(() => {
          const element = document.activeElement;
          if (element === null) return 'nothing';
          if (element.closest('.oyl-chooser__cards') !== null) return 'card';
          if (element.closest('.oyl-chooser__loadout') !== null) return 'loadout';
          if (element.closest('.oyl-chooser__go') !== null) return 'ride';
          return 'elsewhere';
        });
      const order: string[] = [];
      for (let press = 0; press < 20; press += 1) {
        await page.keyboard.press('Tab');
        const at = await where();
        if (at !== 'loadout' && order.length > 0) break;
        order.push(at);
      }
      expect(order[0], order.join(' → ')).toBe('loadout');
      expect(order, order.join(' → ')).not.toContain('ride');
      expect(order, order.join(' → ')).not.toContain('card');
      for (let press = 0; press < 20 && (await where()) !== 'card'; press += 1) {
        await page.keyboard.press('Shift+Tab');
      }
      await page.keyboard.press('Shift+Tab');
      expect(await where()).toBe('ride');
      expect(await rideText()).toBe(after.ride);
    });
  }
});

/*
 * #940's second review — the two blockers, as hit tests with NOTHING moved.
 *
 * - **#503**: whenever *Ride* is the topmost thing at its centre, every notice
 *   above it is reached by `elementFromPoint` over its WHOLE box at
 *   `scrollY === 0`; and at every scroll position, no point of a notice that is
 *   on the screen lands on anything but the notice (the shell's sticky header
 *   over a notice scrolled under it counts as scrolled past, not obscured).
 *   The notices also stand above *Ride* on the page. Measured in all three
 *   notice states, the release fault + promise among them, at every size the
 *   review measured a pinned *Ride* over the promise.
 * - **SC 2.4.11**: with the LONGEST route name chosen, a Tab walk forwards and
 *   a Shift+Tab walk backwards through every control in the chooser, in which
 *   no focused control lies behind anything pinned anywhere in the document,
 *   or off the screen — not wholly, and not by one pixel.
 */
test.describe('#940 — the notices are never hidden while Ride is offered, and focus is never under anything pinned', () => {
  for (const notices of CHOOSER_NOTICE_STATES) {
    for (const viewport of CHOOSER_REVIEW_VIEWPORTS) {
      test(`notices ${notices}: every notice is unobscured whenever Ride is — ${viewport.name}`, async ({
        page,
      }) => {
        await openChooser(page, viewport, 'chooser', notices);
        await chooseLast(page);
        const sights = await sightsAt(page, 'sweep');
        const first = sights[0] as ChooserSight;
        const share = (notice: ChooserSight['notices'][number]) =>
          ((100 * notice.reached) / notice.points).toFixed(0);
        console.log(
          `#940 #503 notices ${notices} — ${viewport.name}: at scrollY 0 Ride ${first.rideOnTop ? 'on top' : 'not on the screen'}, ${first.notices
            .map((each) => `${each.label} ${share(each)} %`)
            .join(
              ', ',
            )}; ${String(sights.filter((each) => each.rideOnTop).length)} of ${String(sights.length)} scroll positions show Ride`,
        );
        expect(first.scrollY).toBe(0);
        expect(first.notices.map((each) => each.label)).toEqual(CHOOSER_NOTICE_LABELS[notices]);
        for (const notice of first.notices) {
          expect(notice.bottom, `${notice.label} is not above Ride`).toBeLessThanOrEqual(
            first.rideTop + SUBPIXEL_TOLERANCE,
          );
        }
        if (first.rideOnTop) {
          for (const notice of first.notices) {
            expect(
              notice.reached,
              `Ride is on the screen at scrollY 0 and ${notice.label} is ${share(notice)} % reached`,
            ).toBe(notice.points);
          }
        }
        for (const sight of sights) {
          if (!sight.rideOnTop) continue;
          for (const notice of sight.notices) {
            expect(
              notice.obscured,
              `at scrollY ${sight.scrollY.toFixed(0)}, ${notice.label} is covered while Ride is on top`,
            ).toBe(0);
          }
        }
      });
    }
  }

  for (const notices of ['promise', 'all'] as const) {
    for (const viewport of CHOOSER_REVIEW_VIEWPORTS) {
      for (const direction of ['forwards', 'backwards'] as const) {
        test(`notices ${notices}, the longest route name: Tab ${direction}, and no focused control is under anything pinned — ${viewport.name}`, async ({
          page,
        }) => {
          await openChooser(page, viewport, 'chooser', notices);
          const name = await chooseLast(page);
          expect(name.length).toBe(await maximumRouteName(page));
          const walk = await tabWalk(page, direction);
          console.log(
            `#940 Tab ${direction}, notices ${notices} — ${viewport.name}: ${walk
              .map(
                (each) =>
                  `${each.name.slice(0, 24)} ${each.covered.toFixed(0)}/${each.height.toFixed(0)}`,
              )
              .join(' | ')}`,
          );
          expect(
            walk.some((each) => each.name.startsWith('Ride ')),
            'the walk never reached Ride',
          ).toBe(true);
          expect(walk.length).toBeGreaterThanOrEqual(8);
          for (const step of walk) {
            expect(
              step.covered,
              `${step.name} is behind something pinned, or off the screen, when focused`,
            ).toBeLessThanOrEqual(SUBPIXEL_TOLERANCE);
          }
        });
      }
    }
  }
});

/** `rgb(16, 22, 28)` → `#10161c`, for {@link contrastRatio}. */
function hexOf(rgb: string): string {
  const channels = /^rgba?\((\d+), (\d+), (\d+)/.exec(rgb);
  if (channels === null) throw new Error(`not an opaque rgb() colour: ${rgb}`);
  return `#${channels
    .slice(1, 4)
    .map((channel) => Number(channel).toString(16).padStart(2, '0'))
    .join('')}`;
}

/*
 * #1011 — Phase 2 of epic #935: the routes as TILES (the drawing fills the
 * tile, the facts on a solid band at its foot, the chosen tile told by a tick
 * and a word as well as its edge), two columns on a tablet and one on a phone,
 * one full-width *Ride*, and the realistic world as one line. Every #940 case
 * above still runs on this layout; these read what is new.
 *
 * Its control, `?picker=list` (the old layout, one route per row), must read
 * ONE column on the tablets — which is what makes "two columns" a measurement
 * of the shipped rule rather than of the harness.
 */
const TILE_VIEWPORTS: readonly (ChooserViewport & { readonly columns: number })[] = [
  { ...(CHOOSER_VIEWPORTS[0] as ChooserViewport), columns: 1 },
  { ...(CHOOSER_VIEWPORTS[1] as ChooserViewport), columns: 1 },
  { ...TABLET_IN_THE_SHELL_CHOOSER, columns: 2 },
  { name: 'a tablet upright — 800×1280', width: 800, height: 1280, insets: false, columns: 2 },
];

interface TileReading {
  readonly columns: number;
  readonly tiles: readonly {
    readonly width: number;
    readonly shapeWidth: number;
    readonly shapeHeight: number;
    readonly shapeLeftInset: number;
    readonly bandBottomInset: number;
    readonly shapeToBand: number;
    readonly bandBackground: string;
    readonly bandText: string;
    readonly chosenMark: boolean;
    readonly chosenVisible: boolean;
    readonly doubledEdge: string;
  }[];
  readonly rideWidth: number;
  readonly goWidth: number;
  readonly rideHeight: number;
  readonly overlay: string;
}

async function readTiles(page: Page): Promise<TileReading> {
  return page.evaluate(() => {
    const cards = [...document.querySelectorAll<HTMLElement>('.oyl-chooser__card')];
    const firstTop = cards[0]?.getBoundingClientRect().top ?? 0;
    const columns = cards.filter(
      (card) => Math.abs(card.getBoundingClientRect().top - firstTop) < 1,
    ).length;
    const ride = [...document.querySelectorAll<HTMLElement>('.oyl-chooser__go button')][0];
    const go = document.querySelector<HTMLElement>('.oyl-chooser__go');
    const probe = document.createElement('div');
    probe.style.background = 'var(--oyl-color-surface-overlay)';
    document.body.append(probe);
    const overlay = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return {
      columns,
      tiles: cards.map((card) => {
        const box = card.getBoundingClientRect();
        const border = Number.parseFloat(getComputedStyle(card).borderLeftWidth);
        const shape = card.querySelector('svg.oyl-chooser__shape')?.getBoundingClientRect();
        const band = card.querySelector<HTMLElement>('.oyl-chooser__facts');
        const bandBox = band?.getBoundingClientRect();
        const mark = card.querySelector<HTMLElement>('.oyl-chooser__chosen');
        const markBox = mark?.getBoundingClientRect();
        return {
          width: box.width - 2 * border,
          shapeWidth: shape?.width ?? 0,
          shapeHeight: shape?.height ?? 0,
          shapeLeftInset: (shape?.left ?? 0) - (box.left + border),
          bandBottomInset: box.bottom - border - (bandBox?.bottom ?? 0),
          shapeToBand: (bandBox?.top ?? 0) - (shape?.bottom ?? 0),
          bandBackground: band === null ? '' : getComputedStyle(band).backgroundColor,
          bandText: band?.textContent ?? '',
          chosenMark: mark !== null,
          chosenVisible:
            mark !== null &&
            markBox !== undefined &&
            markBox.width > 0 &&
            getComputedStyle(mark).visibility === 'visible',
          doubledEdge: getComputedStyle(card, '::before').boxShadow,
        };
      }),
      rideWidth: ride?.getBoundingClientRect().width ?? 0,
      goWidth: go?.getBoundingClientRect().width ?? 0,
      rideHeight: ride?.getBoundingClientRect().height ?? 0,
      overlay,
    };
  });
}

test.describe('#1011 — route tiles, one full-width Ride, the realistic world in one line', () => {
  for (const viewport of TILE_VIEWPORTS) {
    test(`tiles in ${String(viewport.columns)} column(s), each filled by its drawing over a solid band — ${viewport.name}`, async ({
      page,
    }) => {
      await openChooser(page, viewport, 'chooser');
      const read = await readTiles(page);
      console.log(
        `#1011 ${viewport.name}: ${String(read.columns)} column(s), tile ${read.tiles[0]?.width.toFixed(0) ?? '?'} px, drawing ${read.tiles[0]?.shapeWidth.toFixed(0) ?? '?'}×${read.tiles[0]?.shapeHeight.toFixed(0) ?? '?'} px; Ride ${read.rideWidth.toFixed(0)} of ${read.goWidth.toFixed(0)} px`,
      );
      expect(read.columns).toBe(viewport.columns);
      expect(read.tiles.length).toBeGreaterThan(1);
      for (const [index, tile] of read.tiles.entries()) {
        // The drawing fills the tile, edge to edge.
        expect(Math.abs(tile.shapeLeftInset)).toBeLessThanOrEqual(SUBPIXEL_TOLERANCE);
        expect(tile.shapeWidth).toBeGreaterThanOrEqual(tile.width - SUBPIXEL_TOLERANCE);
        expect(tile.shapeHeight).toBeGreaterThanOrEqual(100);
        // The facts on a solid band at the foot, in the declared surface.
        expect(Math.abs(tile.bandBottomInset)).toBeLessThanOrEqual(SUBPIXEL_TOLERANCE);
        // ...and the drawing stands on it: the slack in a row is sky, above.
        expect(Math.abs(tile.shapeToBand)).toBeLessThanOrEqual(SUBPIXEL_TOLERANCE);
        expect(tile.bandBackground).toBe(read.overlay);
        expect(tile.bandText).toMatch(/ · climb .+ · steepest \d+%$/);
        // The chosen tile: a tick and a word, and the doubled edge.
        expect(tile.chosenMark).toBe(index === 0);
        if (index === 0) {
          expect(tile.chosenVisible).toBe(true);
          expect(tile.doubledEdge).toContain('inset');
        } else {
          expect(tile.doubledEdge).toBe('none');
        }
      }
      // One full-width Ride, still 48 px.
      expect(read.rideWidth).toBeGreaterThanOrEqual(read.goWidth - SUBPIXEL_TOLERANCE);
      expect(read.rideHeight).toBeGreaterThanOrEqual(CHOOSER_RIDE_TARGET_PIXELS);
    });
  }

  test('control: the old one-per-row layout reads ONE column on the tablet', async ({ page }) => {
    await openChooser(page, TABLET_IN_THE_SHELL_CHOOSER, 'list');
    expect((await readTiles(page)).columns).toBe(1);
  });

  for (const viewport of CHOOSER_VIEWPORTS) {
    test(`the realistic world is ONE line, first, and the promise’s place is last — ${viewport.name}`, async ({
      page,
    }) => {
      await openChooser(page, viewport, 'chooser', 'all');
      const line = await page.evaluate(() => {
        const world = document.querySelector<HTMLElement>('.oyl-chooser__world');
        const notices = [...document.querySelectorAll('.oyl-chooser__notices > *')];
        const summary = world?.querySelector('summary')?.getBoundingClientRect();
        const words = world?.querySelector('p');
        const range = document.createRange();
        if (words) range.selectNodeContents(words);
        return {
          slack: (words?.getBoundingClientRect().width ?? 0) - range.getBoundingClientRect().width,
          height: world?.getBoundingClientRect().height ?? 0,
          first: notices[0] === world,
          summaryHeight: summary?.height ?? 0,
          summaryWidth: summary?.width ?? 0,
          link: world?.querySelector('a')?.textContent ?? '',
        };
      });
      console.log(
        `#1011 the realistic world's line — ${viewport.name}: ${line.height.toFixed(1)} px tall, ${line.slack.toFixed(1)} px to spare beside its words`,
      );
      expect(line.first).toBe(true);
      expect(line.link).toBe('Change in Settings');
      // One row: the ⓘ's 44 px target and the border, and nothing else.
      expect(line.height).toBeLessThanOrEqual(44 + 4 + SUBPIXEL_TOLERANCE);
      expect(line.summaryHeight).toBeGreaterThanOrEqual(44);
      expect(line.summaryWidth).toBeGreaterThanOrEqual(44);
    });
  }
});
