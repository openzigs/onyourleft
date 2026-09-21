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
 * ⚠️ **Read `ride-harness.tsx`'s header before reading a number here**, and in
 * particular what the page does not prove.
 */

import { expect, test, type Page } from '@playwright/test';

import { applyInsets, PIXEL_TABLET_LANDSCAPE_INSETS, resolvedInsets } from './insets';

import { riderFrameBox } from '../src/game/camera';

import type { Box, StageItem, StageMeasurement } from './ride-harness';

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
 * `game/camera.ts` §`riderFrameBox`, in this viewport's pixels.
 *
 * ⚠️ Non-vacuous by construction rather than by luck: it throws on a box too
 * small to overlap anything, because "no panel overlaps a rectangle of no
 * size" is true of every layout there is.
 */
function riderBox(viewport: Viewport): Box {
  const rider = riderFrameBox(viewport.width / viewport.height);
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

for (const viewport of OVERLAY_VIEWPORTS) {
  test.describe(viewport.name, () => {
    /**
     * ⚠️ The apparatus check, and it is not ceremony. Every case below is a
     * statement about a list, and a list of nothing satisfies all of them. The
     * first version of `ride-harness.tsx` (#373) unmounted the whole shell and
     * set its ready flag anyway; this is what a harness like that fails.
     */
    test('the harness is on the stage, with the widest HUD a rider can start', async ({ page }) => {
      await openRide(page, viewport);
      const seen = await measure(page);

      expect(seen.viewport).toEqual({ width: viewport.width, height: viewport.height });
      // The stylesheet resolved: the token rather than `rgba(0, 0, 0, 0)`.
      expect(seen.panelBackground).toBe(HUD_SURFACE);
      expect(seen.primary).toEqual(['Power', 'Cadence', 'Heart rate']);
      // A pacer, a ghost AND a wind — six, where an ordinary ride has four.
      expect(seen.secondary).toEqual(['Speed', 'Gradient', 'To go', 'Pacer', 'Your best', 'Wind']);
      expect(seen.panels).toHaveLength(4);
      // Nine readings, the strip, the plan view, the trainer line, two controls.
      expect(seen.items).toHaveLength(14);
    });

    test('the world fills the viewport', async ({ page }) => {
      await openRide(page, viewport);
      const seen = await measure(page);

      for (const box of [seen.stage, seen.world]) {
        expect(box?.left).toBe(0);
        expect(box?.top).toBe(0);
        expect(box?.width).toBe(viewport.width);
        expect(box?.height).toBe(viewport.height);
      }
    });

    test('the page chrome is absent', async ({ page }) => {
      await openRide(page, viewport);
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
    test('every reading and every control is on screen with no scrolling', async ({ page }) => {
      await openRide(page, viewport);
      const seen = await measure(page);

      expect(seen.scrollY).toBe(0);
      expect(seen.stageScrollTop).toBe(0);
      expect(seen.pageOverflow).toBeLessThanOrEqual(0);
      const lost = seen.items.filter((each) => !inside(each.box, viewport) || !each.onTop);
      expect(lost.map(describeItem)).toEqual([]);
    });

    /**
     * ⚠️ The stage is `overflow: hidden` in the overlay layouts, so a panel that
     * outgrew its cell would be CLIPPED — and a clipped panel still has a box,
     * which is why this asks about the panels as well as about what is in them.
     */
    test('every panel is whole, and no panel is laid over another', async ({ page }) => {
      await openRide(page, viewport);
      const seen = await measure(page);

      expect(seen.panels.filter((each) => !inside(each.box, viewport)).map(describeItem)).toEqual(
        [],
      );
      const collisions: string[] = [];
      seen.panels.forEach((a, index) => {
        for (const b of seen.panels.slice(index + 1)) {
          if (overlap(a.box, b.box)) {
            collisions.push(`${describeItem(a)} × ${describeItem(b)}`);
          }
        }
      });
      expect(collisions).toEqual([]);
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
    test('no panel is laid over the rider', async ({ page }) => {
      await openRide(page, viewport);
      const seen = await measure(page);

      const box = riderBox(viewport);
      expect(seen.panels.filter((each) => overlap(each.box, box)).map(describeItem)).toEqual([]);
    });

    test('a primary reading is visibly larger than a secondary one', async ({ page }) => {
      await openRide(page, viewport);
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
    test('the trainer line is above the ride controls, in their panel', async ({ page }) => {
      await openRide(page, viewport);
      const seen = await measure(page);

      const line = named(seen.items, 'the trainer line').box;
      const pause = named(seen.items, 'control: Pause').box;
      const actions = seen.panels.find((each) => each.name.includes('oyl-hud__actions'))?.box;
      expect(actions).toBeDefined();
      expect(line.bottom).toBeLessThanOrEqual(pause.top);
      for (const box of [line, pause]) {
        expect(box.top).toBeGreaterThanOrEqual(actions?.top ?? Number.POSITIVE_INFINITY);
        expect(box.bottom).toBeLessThanOrEqual(actions?.bottom ?? 0);
      }
    });

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
for (const viewport of STACKED_VIEWPORTS) {
  test.describe(viewport.name, () => {
    test('the harness is on the stage, stacked', async ({ page }) => {
      await openRide(page, viewport);
      const seen = await measure(page);

      expect(seen.panelBackground).toBe(HUD_SURFACE);
      expect(seen.items).toHaveLength(14);
      expect(seen.stage?.width).toBe(viewport.width);
      expect(seen.stage?.height).toBe(viewport.height);
      // Stacked: the world is a letterbox at the top, not the whole stage.
      expect(seen.world?.height ?? 0).toBeLessThan(viewport.height / 2);
      expect(seen.world?.height ?? 0).toBeGreaterThan(0);
    });

    test('Pause, End ride and the trainer line are on screen with no scrolling', async ({
      page,
    }) => {
      await openRide(page, viewport);
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

    test('nothing is wider than the viewport', async ({ page }) => {
      // SC 1.4.10 is about scrolling in TWO dimensions. 320 px is the width at
      // which #423's first layout ran the heart rate off the right-hand edge.
      await openRide(page, viewport);
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
      const seen = await measure(page);

      // The apparatus: the notice is laid out, and it is a sentence.
      const notice = seen.panels.find((each) => each.name.includes('oyl-hud__notices'));
      expect(notice?.box.height ?? 0).toBeGreaterThan(40);
      const laidOut = seen.panels.filter((each) => each.box.height > 0);
      const onAPhone = Math.min(viewport.width, viewport.height) < 480;
      expect(laidOut).toHaveLength(onAPhone ? 4 : 5);

      expect(laidOut.filter((each) => !inside(each.box, viewport)).map(describeItem)).toEqual([]);
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
