// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The Ride screen, measured by a real engine at the viewport it is used at — #422.
 *
 * ⚠️ `views/RideView.tsx` at `#/`, where a ride is recorded, a trainer is given
 * control and a structured workout is started. Not the trainer game's stage,
 * which is `ride.browser.spec.ts`.
 *
 * ## What happened
 *
 * The owner's Pixel Tablet, landscape, 2026-09-20. The Ride screen rendered a
 * portrait-width column under a prose reading measure, was cut off at the ride
 * controls, and left about half the display blank. **`WorkoutPanel` was below
 * the fold.** The owner was trying to answer #372's open safety question —
 * does ERG release when a workout ends? — and started a plain recording
 * believing it was a workout. The wire: Request Control, 103 seconds of
 * nothing, Stop. Zero ERG targets. They reported that the trainer *"feels the
 * same after ending as during"*, which read as a clean pass and was no evidence
 * at all. **A layout defect produced a false answer to a safety question.**
 *
 * ## Why no gate saw it
 *
 * `test:a11y` renders this route into jsdom on every run and audits it, and
 * jsdom performs no layout (docs/agents/accessibility.md §4e): a control in the document and a
 * control on the screen are the same observation there. The browser gate
 * measured the shell's chrome at 320×256 and the HUD at a phone's width, and
 * **nothing measured this screen at all**, at any viewport.
 *
 * ## The control
 *
 * ⚠️ `constrain()` puts the page back the way #422 found it — the prose measure
 * on the live `main`, and one column inside it — and the control that starts a
 * workout must be **below the fold again**. That is the defect, in
 * the pinned Chromium, on every run; without it "every control is on screen"
 * is just as true of a page that rendered no controls.
 *
 * ## The display is not the WebView — #436's review
 *
 * ⚠️ **This spec used to measure at 1280×800 and 1024×768 only, and a reviewer
 * who remembers that is reading the old file.** 1280×800 is the Pixel Tablet's
 * *display* in CSS pixels. The Android shell configures no fullscreen mode —
 * nothing in `capacitor.config.ts`, `MainActivity` or `styles.xml` — so the
 * WebView a rider actually has is shorter than that by the status bar and the
 * navigation bar. Measured in this Chromium against the page as it then was:
 *
 *   viewport                       Pause / Stop end    margin to the fold
 *   1280×800   the display         y = 737             +63
 *   1280×752   24 + 24 dp of bars  y = 737             +15
 *   1280×728   a 3-button nav      y = 737             −9    BELOW THE FOLD
 *   1024×720                       y = 717             +3
 *
 * So the gate was green and the control that ends a recording was off the
 * screen — #422's own defect, one panel up, behind #422's own gate. The control
 * that bound was no longer the workout: it was `RideControls`, in the live
 * group `theme.css` §`.oyl-ride` had recorded as "taller than it was".
 *
 * ⚠️ **720 was an ASSUMPTION, and it was the wrong mechanism — #439.** It has
 * been READ OFF THE DEVICE since, and a reviewer who remembers
 * `TABLET_IN_THE_SHELL` being 1280×720 is reading the old file. On 2026-09-21,
 * over `apps/mobile/tools/webview-probe.mjs`, the owner's tablet reported
 * `innerWidth × innerHeight` **1280 × 800** with safe-area insets **top 36,
 * bottom 32**: the app targets API 36, Android enforces edge-to-edge from 35,
 * so the WebView is the whole display and the bars are drawn OVER it. The
 * guess was conservative — 720 is less than 800 − 36 − 32 — so the gate was
 * safe, but it measured height where the real question is insets, and that is
 * how #439's 68 px of scroll went unseen. `insets.ts` applies them to the
 * engine; the fold at such a viewport is `height − bottom inset`.
 *
 * ## Why a margin, and not only a pass
 *
 * {@link FOLD_MARGIN_PIXELS}. A control that clears the fold by 3 px in this
 * Chromium has not been shown to clear it anywhere else: this pull request's
 * own history has an 8 px difference between a Mac's fonts and the CI runner's,
 * and Android's are a third set. Every tablet case therefore PUBLISHES its
 * margin — as an annotation and on stdout — so that the number is in the run
 * rather than in somebody's memory of it.
 *
 * ⚠️ **Read `rideview-harness.tsx`'s header before reading a number here.**
 */

import { expect, test, type Browser, type Page } from '@playwright/test';

import {
  applyInsets,
  NO_INSETS,
  PIXEL_TABLET_LANDSCAPE_INSETS,
  PIXEL_TABLET_PORTRAIT_INSETS_ASSUMED,
  resolvedInsets,
  type Insets,
} from './insets';
import type { RideViewControl, RideViewMeasurement, RideViewNotice } from './rideview-harness';
import { attachSharedPageOnFailure, releaseSharedPage, sharedPage } from './shared-load';

import { RIDE_TIME_TARGET_PIXELS } from '../src/design/ride-time-controls';

/** Sub-pixel layout, not slack. @see ride.browser.spec.ts */
const SUBPIXEL_TOLERANCE = 1;

/** `theme.css` §`--oyl-color-surface-raised`, as `getComputedStyle` spells it. */
const UNSTYLED = 'rgba(0, 0, 0, 0)';

/** The control the owner could not see. @see rideview-harness.tsx §WORKOUT */
const STARTS_A_WORKOUT = 'Ride Sweet spot, three by twelve';
/** The sensors group's one control since #659 — `ride/SensorPairing.tsx` §`ConnectedSensors`. */
const DEVICES_LINK = 'Pair or forget devices on Devices';

interface Viewport {
  readonly name: string;
  readonly width: number;
  readonly height: number;
  /** Edge-to-edge insets the engine is told about. Absent, none. @see insets.ts */
  readonly insets?: Insets;
}

const insetsOf = (viewport: Viewport): Insets => viewport.insets ?? NO_INSETS;

/**
 * How far above the fold the lowest ride control must end, in CSS pixels.
 *
 * Not slack and not taste — it is what this gate cannot see. The fixture has
 * one metric card whose note wraps to a second line (160.6 px against 140.8);
 * a second row doing the same is 20 px. The fonts are 8 px different between
 * two machines this repository has already measured, and a third set on the
 * device. And the bar heights under {@link SMALL_TABLET_IN_THE_SHELL} are
 * still assumed. 50 is those three with a little left over, and a margin under it at a
 * "device" viewport is unproven on that device however green the run is.
 */
const FOLD_MARGIN_PIXELS = 50;

/** The owner's tablet on the bars — 2560×1600 at a device pixel ratio of 2. */
const TABLET: Viewport = { name: 'a landscape tablet — 1280×800', width: 1280, height: 800 };

/**
 * The same tablet, as the WebView sees it: the WHOLE display, edge-to-edge,
 * with the system bars reported as insets. ⚠️ **Read off the device on
 * 2026-09-21** (#439) — @see this file's header and `insets.ts`.
 */
const TABLET_IN_THE_SHELL: Viewport = {
  name: 'a landscape tablet inside the Android shell — 1280×800, edge-to-edge, insets 36/32',
  width: 1280,
  height: 800,
  insets: PIXEL_TABLET_LANDSCAPE_INSETS,
};

/**
 * Upright. ⚠️ The size is the display turned; the insets are the landscape
 * reading reused, NOT read off the device — @see insets.ts.
 */
const TABLET_UPRIGHT_IN_THE_SHELL: Viewport = {
  name: 'a tablet upright inside the Android shell — 800×1280, edge-to-edge, insets 36/32 (assumed)',
  width: 800,
  height: 1280,
  insets: PIXEL_TABLET_PORTRAIT_INSETS_ASSUMED,
};

/** A smaller one, where there is room for two columns and not three. */
const SMALL_TABLET: Viewport = { name: 'a 4:3 tablet — 1024×768', width: 1024, height: 768 };

/**
 * And that one less its bars, which is where the old layout cleared by 3 px.
 * ⚠️ Still the old mechanism — a shorter viewport — and still assumed: nobody
 * has held a 4:3 tablet running this app. Kept because it is the conservative
 * reading of a device nobody has measured.
 */
const SMALL_TABLET_IN_THE_SHELL: Viewport = {
  name: 'a 4:3 tablet inside the Android shell — 1024×720',
  width: 1024,
  height: 720,
};

/** Every viewport at which the screen is laid out in columns. */
const TABLETS: readonly Viewport[] = [
  TABLET,
  TABLET_IN_THE_SHELL,
  SMALL_TABLET,
  SMALL_TABLET_IN_THE_SHELL,
];

async function open(page: Page, viewport: Viewport, query = ''): Promise<void> {
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  if (viewport.insets !== undefined) {
    await applyInsets(page, viewport.insets);
  }
  const response = await page.goto(`/rideview.html${query}`);
  expect(
    response?.status(),
    'rideview.html did not load — is it named in vite.browser.config.ts build.rollupOptions.input?',
  ).toBe(200);
  await page.waitForFunction(() => window.__oylRideView !== undefined);
  const published = await page.evaluate(() => ({
    ready: window.__oylRideView?.ready,
    errors: window.__oylRideView?.errors,
  }));
  expect(published.errors, 'the Ride-screen harness reported an error').toEqual([]);
  expect(published.ready).toBe(true);
}

/**
 * {@link open}, loaded once for every case in a row that only MEASURES the
 * screen at this viewport and query — #1051, `shared-load.ts`. A case that
 * changes the page (a control putting a rule back, opening the Eased detail)
 * takes its own `page` and calls `open`.
 */
async function sharedRideView(browser: Browser, viewport: Viewport, query = ''): Promise<Page> {
  return sharedPage(
    browser,
    `rideview.html${query} at ${viewport.name}`,
    (page) => open(page, viewport, query),
    test.info(),
  );
}

// The page the cases below share goes when this file's cases do (`shared-load.ts`).
test.afterAll(releaseSharedPage);
// What a red shared case read, since the `page` fixture's screenshot is not it (#1076).
test.afterEach(async () => {
  await attachSharedPageOnFailure(test.info());
});

async function measure(page: Page): Promise<RideViewMeasurement> {
  const measured = await page.evaluate(() => window.__oylRideView?.measure());
  if (measured === undefined) {
    throw new Error('the Ride-screen harness published no measurement');
  }
  return measured;
}

/** On the screen and clear of the bars drawn over it. */
function onScreen(control: RideViewControl, viewport: Viewport): boolean {
  const { box } = control;
  const insets = insetsOf(viewport);
  return (
    box.width > 0 &&
    box.height > 0 &&
    box.left >= insets.left - SUBPIXEL_TOLERANCE &&
    box.top >= insets.top - SUBPIXEL_TOLERANCE &&
    box.right <= viewport.width - insets.right + SUBPIXEL_TOLERANCE &&
    box.bottom <= viewport.height - insets.bottom + SUBPIXEL_TOLERANCE &&
    control.onTop
  );
}

function describeControl(control: RideViewControl): string {
  const { box } = control;
  return `[${control.group}] ${control.name} — y ${box.top.toFixed(0)}–${box.bottom.toFixed(0)}${
    control.onTop ? '' : ' COVERED'
  }`;
}

for (const viewport of TABLETS) {
  test.describe(viewport.name, () => {
    /**
     * ⚠️ The apparatus. The fixture is mid-ride with control granted, a saved
     * workout and a threshold, so that `WorkoutPanel` renders the control the
     * owner could not see. A page that rendered *"Ask the trainer for control
     * first"* instead has no such control, and every case below would pass
     * over its absence.
     */
    test('the harness rendered the screen at its fullest', async ({ browser }) => {
      const page = await sharedRideView(browser, viewport);
      const seen = await measure(page);

      expect(seen.viewport).toEqual({ width: viewport.width, height: viewport.height });
      expect(seen.cardBackground).not.toBe(UNSTYLED);
      expect(seen.cardBackground).not.toBe('');
      const names = seen.controls.map((each) => each.name);
      expect(names).toEqual(expect.arrayContaining(['Pause', 'Stop', 'Set target', 'End ERG']));
      expect(names).toContain(STARTS_A_WORKOUT);
      // #659: pairing is on Devices, so what the sensors group offers is the
      // way there — the link, and no pairing button.
      expect(
        seen.controls.filter((each) => each.group === 'sensors').map((each) => each.name),
      ).toEqual([DEVICES_LINK]);
    });

    test('is not held to the prose reading measure', async ({ browser }) => {
      const page = await sharedRideView(browser, viewport);
      const seen = await measure(page);

      expect(seen.mainClass).toBe('oyl-main oyl-main--instruments');
      expect(seen.mainMaxWidth).toBe('none');
      // Every pixel the rail (#427) leaves: from its right edge to the window's.
      expect(seen.primaryNav?.left).toBe(0);
      expect(seen.main?.left).toBeCloseTo(seen.primaryNav?.right ?? -1, 0);
      expect(seen.main?.right).toBe(viewport.width);
    });

    /**
     * #422's first criterion and its comment's. Everything a rider does DURING
     * a ride — the live group and the trainer group, which is `RideControls`,
     * `TrainerPanel` and `WorkoutPanel`.
     */
    test('every ride control is on screen with no scrolling', async ({ browser }) => {
      const page = await sharedRideView(browser, viewport);
      const seen = await measure(page);

      expect(seen.scrollY).toBe(0);
      const during = seen.controls.filter((each) => each.group !== 'sensors');
      expect(during.length).toBeGreaterThanOrEqual(6);
      expect(during.filter((each) => !onScreen(each, viewport)).map(describeControl)).toEqual([]);
    });

    /**
     * ⚠️ The case #436's review asked for. "On screen" above is a pass or a
     * fail; this is the NUMBER, published on every run, and a floor under it.
     * What binds today is Pause / Stop in the live group — the controls that
     * end a recording — and they end where they do because of two things this
     * case is the only gate for: `RideView.tsx` renders the controls BEFORE
     * the clock, and `theme.css` puts the title and its summary on one row.
     */
    test('the lowest ride control clears the fold by a margin, and says by how much', async ({
      browser,
    }, testInfo) => {
      const page = await sharedRideView(browser, viewport);
      const seen = await measure(page);

      const during = seen.controls.filter((each) => each.group !== 'sensors');
      // The apparatus: a margin taken over no controls is `Infinity`, which
      // clears any floor there is.
      expect(during.map((each) => each.name)).toEqual(expect.arrayContaining(['Pause', 'Stop']));
      const lowest = during.reduce((low, each) => (each.box.bottom > low.box.bottom ? each : low));
      // The fold is where the bars begin, not where the display ends (#439).
      const margin = viewport.height - insetsOf(viewport).bottom - lowest.box.bottom;

      const note = `${margin.toFixed(1)} px under ${describeControl(lowest)} at ${String(
        viewport.width,
      )}×${String(viewport.height)}`;
      testInfo.annotations.push({ type: 'margin to the fold', description: note });
      // Printed as well as annotated, as `game.browser.spec.ts` does its costs.
      console.log(`margin to the fold — ${note}`);

      expect(margin, note).toBeGreaterThanOrEqual(FOLD_MARGIN_PIXELS);
    });

    test('the title and its one-line summary share a row', async ({ browser }) => {
      // 40.8 px of the budget above. Stacked, they spend a line of the fold on
      // a sentence that fits beside the heading; the control below requires
      // them to be stacked again under the prose measure, so this is not true
      // of a page that simply has no summary.
      const page = await sharedRideView(browser, viewport);
      const { title, summary } = await measure(page);

      expect(title?.height ?? 0).toBeGreaterThan(0);
      expect(summary?.height ?? 0).toBeGreaterThan(0);
      expect(summary?.left ?? 0).toBeGreaterThanOrEqual(title?.right ?? Infinity);
      expect(summary?.top ?? Infinity).toBeLessThan(title?.bottom ?? 0);
      expect(summary?.bottom ?? Infinity).toBeLessThanOrEqual(
        (title?.bottom ?? 0) + SUBPIXEL_TOLERANCE,
      );
    });

    test('the trainer is BESIDE the live metrics, not under them', async ({ browser }) => {
      // "Landscape uses the width." The two groups share a top edge and do not
      // share a column.
      const page = await sharedRideView(browser, viewport);
      const { groups } = await measure(page);

      expect(groups.live).toBeDefined();
      expect(groups.trainer).toBeDefined();
      expect(groups.trainer?.top).toBeCloseTo(groups.live?.top ?? -1, 0);
      expect(groups.trainer?.left ?? 0).toBeGreaterThanOrEqual(groups.live?.right ?? Infinity);
    });

    /**
     * ⚠️ **The control, and it is the defect itself.** With the measure back,
     * the control that starts a workout is below the fold — which is what the
     * owner's tablet showed, and what made a recording look like a workout.
     */
    test('the control — under the prose measure, a workout cannot be started without scrolling', async ({
      page,
    }) => {
      await open(page, viewport);
      await page.evaluate(() => {
        window.__oylRideView?.constrain();
      });
      const seen = await measure(page);

      expect(seen.mainClass).toBe('oyl-main oyl-main--prose');
      expect(seen.mainMaxWidth).not.toBe('none');
      const start = seen.controls.find((each) => each.name === STARTS_A_WORKOUT);
      expect(start?.box.height ?? 0).toBeGreaterThan(0);
      expect(start?.box.bottom ?? 0).toBeGreaterThan(viewport.height - insetsOf(viewport).bottom);
      // And the title is stacked over its summary again, which is what makes
      // "they share a row" above a statement about the instruments layout.
      expect(seen.summary?.top ?? 0).toBeGreaterThanOrEqual(seen.title?.bottom ?? Infinity);
    });
  });
}

for (const viewport of [TABLET, TABLET_IN_THE_SHELL]) {
  test.describe(viewport.name, () => {
    test('has room for the sensors too', async ({ page }) => {
      // ⚠️ At the three-column width only. `theme.css` §`.oyl-ride` records why
      // the sensors are the group that may be below the fold on a smaller
      // tablet: pairing is what a rider does before a ride, not during one.
      await open(page, viewport);
      const seen = await measure(page);

      const pairing = seen.controls.filter((each) => each.group === 'sensors');
      // #659: one control, the link to Devices, where pairing now is.
      expect(pairing.map((each) => each.name)).toEqual([DEVICES_LINK]);
      expect(pairing.filter((each) => !onScreen(each, viewport)).map(describeControl)).toEqual([]);
    });
  });
}

/**
 * The measure is gone from this route, so nothing else bounds its width. On a
 * phone the screen is one column and a page that scrolls — which it always was
 * — and what must not happen is a column wider than the screen.
 */
for (const viewport of [
  { name: 'a phone upright — 390×844', width: 390, height: 844 },
  { name: 'a phone in landscape — 844×390', width: 844, height: 390 },
  { name: 'reflow — 320×256', width: 320, height: 256 },
]) {
  test.describe(viewport.name, () => {
    test('nothing is wider than the viewport', async ({ page }) => {
      await open(page, viewport);
      const seen = await measure(page);

      // Six in the live and trainer groups, and the link to Devices. It was
      // more than eight until #659 moved the four Pair buttons and the Forget
      // off this screen; the count is the apparatus, not the claim.
      expect(seen.controls.length).toBeGreaterThanOrEqual(7);
      const wide = seen.controls.filter(
        (each) => each.box.right > viewport.width + SUBPIXEL_TOLERANCE || each.box.left < 0,
      );
      expect(wide.map(describeControl)).toEqual([]);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });
  });
}

/**
 * #439 on the Ride tab — `layout: 'instruments'`, a different layout from the
 * game's, and a page that keeps its header and footer.
 *
 * ⚠️ **Measured, and the answer is that #439's arithmetic does NOT apply here.**
 * The Ride tab is taller than the screen on its own content: at 1280×800 with
 * insets 36/32 the three groups end at y = 752 and the page footer runs from
 * 776 to 855, so the document is 887 px against an 800 px WebView — and
 * upright it is 1556 against 1280. A shell whose `min-height` is shorter than
 * its content never binds, so the old rule and the new one lay this page out
 * identically. What this page scrolls by is its footer, by design; what the
 * rider needs DURING a ride is above the fold and clear of the bars, which the
 * cases above measure at {@link TABLET_IN_THE_SHELL} with the insets applied.
 *
 * So the assertion is the finding: reverting the rule changes nothing. A later
 * change that made this page shorter than the screen would turn it red, and
 * that is the day #439 starts to apply here.
 *
 * ⚠️ **Upright, that day was #1012**: the readings went from one to a row to
 * two, and the upright page became shorter than the screen. There the case
 * now holds the rule doing its job — no scroll, and the old rule's 68 px back
 * as the control. In landscape the page is still taller than the screen.
 */
for (const viewport of [TABLET_IN_THE_SHELL, TABLET_UPRIGHT_IN_THE_SHELL]) {
  test.describe(`#439 — ${viewport.name}`, () => {
    test('the engine really has the insets', async ({ page }) => {
      await open(page, viewport);
      expect(await resolvedInsets(page)).toEqual(insetsOf(viewport));
    });

    test('the page is taller than the screen on its own content, so the shell height does not bind', async ({
      page,
    }) => {
      await open(page, viewport);
      const fixed = await measure(page);
      await page.evaluate(() => {
        window.__oylRideView?.restoreFullHeightShell();
      });
      const reverted = await measure(page);

      if (viewport === TABLET_UPRIGHT_IN_THE_SHELL) {
        // ⚠️ #1012: the day this comment predicted. Two readings to a row
        // rather than one made the upright page SHORTER than the screen, so
        // #439's rule binds here now: the page fits, and the old rule puts
        // the insets' 68 px back as scroll.
        //
        // ⚠️ #1021: if content grows and the upright page is taller than the
        // screen again, move this viewport back to the `else` branch below —
        // the shell height has stopped binding, which is that branch's claim.
        // Do NOT loosen these two assertions to make it pass.
        const insets = insetsOf(viewport);
        expect(fixed.pageOverflow).toBeLessThanOrEqual(0);
        expect(reverted.pageOverflow).toBeCloseTo(insets.top + insets.bottom, 0);
      } else {
        expect(fixed.pageOverflow).toBeGreaterThan(0);
        expect(reverted.pageOverflow).toBe(fixed.pageOverflow);
      }
    });
  });
}

/**
 * #605 — a workout RUNNING with the stall rescue holding its target at the
 * trainer's floor, on the Ride screen (PR #599's review, item 1).
 *
 * ⚠️ **What building this state found.** Nothing had measured the Ride screen
 * with a workout running at all — the fixture above is the CHOOSER, whose
 * *Ride* control was the one #422 was about. Running, at 1280×800 inside the
 * Android shell, *End workout* was the LAST thing in the trainer column,
 * under a 248 px ERG form every press of which the controller refuses while a
 * workout runs, three lines of reading, and the four-sentence Eased notice:
 * **233 px under the fold** — the control that ends what is holding a stalled
 * rider, off the screen. With no rescue it cleared the fold by 24 px, under
 * {@link FOLD_MARGIN_PIXELS}. Three changes, each measured:
 *
 *   - the ERG form is not offered while a workout owns the target
 *     (`TrainerPanel.tsx` §`workoutOwnsTarget`) — 183 px;
 *   - *End workout* comes first in the running section, the reading last
 *     (`WorkoutPanel.tsx` §`riding`);
 *   - the Eased notice is ONE sentence on the screen, the rest behind *How
 *     the target comes back* (`workout/rescue-text.ts` §`workoutRescueHeadline`,
 *     the owner's ruling on #605) — 55 px, which is the headroom #669's 48 px
 *     controls spent (4 px each for *Pause* / *Stop* and *End workout*).
 *
 * The control puts the section back as #585 shipped it — the whole sentence,
 * and *End workout* last — and requires *End workout* to fall under the
 * floor again. It does NOT put the ERG form back; that half is a mutation in
 * the pull request, and `TrainerPanel.test.tsx` §"#605".
 */
const EASED = '?workout=eased';

/** The margin to the fold of a box's bottom edge. */
function foldMargin(bottom: number, viewport: Viewport): number {
  return viewport.height - insetsOf(viewport).bottom - bottom;
}

/**
 * #605's review: the four TABLETS are all landscape, where *Pause* and *Stop*
 * sit in another column from the trainer group — so "opening the detail moves
 * no control" was partly true by construction. The upright tablet was then the
 * one layout where they shared a column with the notice, so it is measured too.
 *
 * ⚠️ **Since #692 the upright tablet is two columns as well**, and a reviewer
 * who remembers the live group stacked over the trainer group there is reading
 * the old file: nothing in the live column can move the trainer column now, at
 * any size. What #605's review measured upright — the order, *End workout*
 * before the notice — is held by the four landscape controls below, because
 * upright it is 300 px clear either way and a control there cannot fail. The
 * cases that hold margins still run upright, and publish them.
 */
const EASED_VIEWPORTS: readonly Viewport[] = [...TABLETS, TABLET_UPRIGHT_IN_THE_SHELL];

for (const viewport of EASED_VIEWPORTS) {
  test.describe(`a workout eased — #605 — ${viewport.name}`, () => {
    /**
     * ⚠️ The apparatus. A page that rendered the chooser, or a running
     * workout with no rescue, has no Eased notice — and every margin below
     * would be taken over controls that were never pushed down by one.
     */
    test('the harness rendered a running workout with its Eased notice, one sentence showing', async ({
      browser,
    }) => {
      const page = await sharedRideView(browser, viewport, EASED);
      const seen = await measure(page);

      const names = seen.controls.map((each) => each.name);
      expect(names).toEqual(
        expect.arrayContaining(['Pause', 'Stop', 'End workout', 'How the target comes back']),
      );
      expect(names).not.toContain(STARTS_A_WORKOUT);
      // The ERG form is not offered while the workout owns the target.
      expect(names).not.toContain('Set target');
      expect(names).not.toContain('End ERG');

      expect(seen.eased?.box.height ?? 0).toBeGreaterThan(40);
      expect(seen.eased?.open).toBe(false);
      // The one visible sentence is the rescue's own reason, and the detail
      // is in the document but closed.
      const sentence = await page.evaluate(
        () =>
          document.querySelector('.oyl-ride__group--trainer .oyl-status__sentence')?.textContent ??
          '',
      );
      expect(sentence).toBe(
        'Eased: Pedalling has stopped, so the target has been dropped to the trainer’s lowest.',
      );
      expect(seen.eased?.text).toContain('Press End workout to leave it.');
    });

    test('with no rescue there is no Eased notice — the apparatus’s control', async ({ page }) => {
      await open(page, viewport, '?workout=running');
      const seen = await measure(page);

      expect(seen.controls.map((each) => each.name)).toContain('End workout');
      expect(seen.eased).toBeUndefined();
    });

    test('the notice and every ride control are on screen, and clear the fold by a margin', async ({
      browser,
    }, testInfo) => {
      const page = await sharedRideView(browser, viewport, EASED);
      const seen = await measure(page);

      expect(seen.scrollY).toBe(0);
      const during = seen.controls.filter((each) => each.group !== 'sensors');
      expect(during.filter((each) => !onScreen(each, viewport)).map(describeControl)).toEqual([]);

      const lowest = during.reduce((low, each) => (each.box.bottom > low.box.bottom ? each : low));
      const end = during.find((each) => each.name === 'End workout');
      const controlMargin = foldMargin(lowest.box.bottom, viewport);
      const endMargin = foldMargin(end?.box.bottom ?? Infinity, viewport);
      const noticeMargin = foldMargin(seen.eased?.box.bottom ?? Infinity, viewport);
      const note =
        `lowest control ${controlMargin.toFixed(1)} px (${describeControl(lowest)}); ` +
        `End workout ${endMargin.toFixed(1)} px; the Eased notice ${noticeMargin.toFixed(1)} px, ` +
        `${(seen.eased?.box.height ?? 0).toFixed(0)} px tall — at ${String(viewport.width)}×${String(viewport.height)}`;
      testInfo.annotations.push({ type: 'workout eased, margin to the fold', description: note });
      console.log(`workout eased, margin to the fold — ${note}`);

      expect(controlMargin, note).toBeGreaterThanOrEqual(FOLD_MARGIN_PIXELS);
      expect(noticeMargin, note).toBeGreaterThanOrEqual(FOLD_MARGIN_PIXELS);

      // ⚠️ #605's re-review held the ERG line above this notice to ONE line
      // upright, because in one column every line it wrapped to came off the
      // notice's margin. Since #692 the upright tablet is two columns and the
      // notice is 500 px clear of the fold, so what that rule protected is
      // the assertion above, and it is held directly. A reviewer who
      // remembers the one-line check is reading the old file.
      expect((seen.eased?.box.top ?? -1) >= insetsOf(viewport).top).toBe(true);
    });

    test('opening the detail moves no control', async ({ page }, testInfo) => {
      await open(page, viewport, EASED);
      const closed = await measure(page);
      await page.evaluate(() => {
        window.__oylRideView?.openEasedDetail();
      });
      const opened = await measure(page);

      expect(opened.eased?.open).toBe(true);
      expect(opened.eased?.box.height ?? 0).toBeGreaterThan((closed.eased?.box.height ?? 0) + 20);
      const at = (seen: typeof closed, name: string): number | undefined =>
        seen.controls.find((each) => each.name === name)?.box.top;
      for (const name of ['Pause', 'Stop', 'End workout', 'How the target comes back']) {
        expect(at(opened, name), name).toBe(at(closed, name));
      }
      // #605's review: and the page did not jump, and no ride control went
      // off the screen — the opened text's own end is unbounded (below), what
      // the rider needs to press is not.
      expect(opened.scrollY).toBe(0);
      const during = opened.controls.filter((each) => each.group !== 'sensors');
      expect(during.filter((each) => !onScreen(each, viewport)).map(describeControl)).toEqual([]);
      const note = `the opened notice ends ${foldMargin(opened.eased?.box.bottom ?? Infinity, viewport).toFixed(1)} px above the fold`;
      testInfo.annotations.push({ type: 'workout eased, detail open', description: note });
      console.log(`workout eased, detail open — ${viewport.name} — ${note}`);
      // Published and NOT bounded. The rider opened it, and what it holds is
      // the explanation the owner's ruling lets be tucked away; a longer read
      // that runs past the fold is a page that scrolls, not a control lost —
      // which is what the loop above holds. ⚠️ Measured: on the CI runner's
      // fonts the opened notice ends 45.9 px UNDER the fold at
      // `TABLET_IN_THE_SHELL` (27.7 px above it on a Mac), so a bound here
      // would be a bound on this machine's fonts.
    });

    // ⚠️ Landscape only since #692. Upright, the trainer group is its own
    // column now, so *End workout* last is still 300 px clear of the fold
    // there and the control cannot fail; the ORDER it guards is the same
    // component at every size, and the four landscape tablets hold it.
    if (viewport.width > viewport.height) {
      test('the control — as #585 shipped it, End workout is under the floor', async ({
        page,
      }, testInfo) => {
        await open(page, viewport, EASED);
        await page.evaluate(() => {
          window.__oylRideView?.restoreAsShipped();
        });
        const seen = await measure(page);

        expect(seen.eased?.text).toContain('Press End workout to leave it.');
        expect(seen.eased?.open).toBe(false);
        const end = seen.controls.find((each) => each.name === 'End workout');
        expect(end?.box.height ?? 0).toBeGreaterThan(0);
        const margin = foldMargin(end?.box.bottom ?? -Infinity, viewport);
        testInfo.annotations.push({
          type: 'control, End workout margin',
          description: `${margin.toFixed(1)} px`,
        });
        console.log(
          `workout eased, as #585 shipped it — ${viewport.name} — End workout ${margin.toFixed(1)} px`,
        );
        expect(margin).toBeLessThan(FOLD_MARGIN_PIXELS);
      });
    }
  });
}

/**
 * #647 — the platform refused to keep the ride alive (on Android, the
 * recording service did not start), so the ride may stop if the screen goes
 * off, and `RideView` says so BESIDE the Live group's heading
 * (`theme.css` §`.oyl-ride__heading`).
 *
 * What is held: the sentence is whole, on the screen, uncovered and in no
 * `<details>` (the owner's ruling on #654's re-review — it is a safety
 * sentence); every ride control is still on the screen; and at every tablet,
 * both ways up, the notice's own bottom and EVERY ride control clear
 * {@link FOLD_MARGIN_PIXELS}.
 *
 * ⚠️ **The notice's floor is §4f's 50 px and it was 0 until #693's review**,
 * and a reviewer who remembers the notice being "bounded only by being on the
 * screen" is reading the old file. Under *Pause* / *Stop* — where the pull
 * request first put it — it ended 15.7 px above the fold on the owner's tablet
 * in the shell and 3.7 px at 1024×720, so the safety sentence #647 exists to
 * show was unproven on the owner's own tablet by §4f's own rule.
 *
 * ⚠️ **Since #692 upright holds every ride control, not only *Pause* /
 * *Stop*,** and a reviewer who remembers the workout chooser published and
 * not held here is reading the old file: that was #692, and the trainer
 * group is its own column upright now. ⚠️ And **#647's two controls are
 * gone** — the notice moved under *Pause* / *Stop*, and above them — because
 * since #692 *Pause* / *Stop* come straight after the Live heading, and a
 * 51 px notice either side of them leaves both 350 px clear of the fold: a
 * control that cannot fail. §"#692" below carries the control for the
 * arrangement that replaced them.
 */
const KEEP_ALIVE_FAILED = '?keepalive=failed';
const KEEP_SCREEN_ON_TEXT = '!Keep the screen on: your ride may stop without it.';

for (const viewport of EASED_VIEWPORTS) {
  test.describe(`a ride that may stop with the screen off — #647 — ${viewport.name}`, () => {
    test('the notice is there, whole, and in no disclosure — and absent without the refusal', async ({
      page,
    }) => {
      await open(page, viewport, KEEP_ALIVE_FAILED);
      const seen = await measure(page);
      expect(seen.keepScreenOn?.text).toBe(KEEP_SCREEN_ON_TEXT);
      expect(seen.keepScreenOn?.inDisclosure).toBe(false);
      expect(seen.keepScreenOn?.box.height ?? 0).toBeGreaterThan(20);

      await open(page, viewport);
      expect((await measure(page)).keepScreenOn).toBeUndefined();
    });

    test('the notice and every ride control clear the fold by a margin', async ({
      page,
    }, testInfo) => {
      await open(page, viewport, KEEP_ALIVE_FAILED);
      const seen = await measure(page);

      expect(seen.scrollY).toBe(0);
      const during = seen.controls.filter((each) => each.group !== 'sensors');
      expect(during.map((each) => each.name)).toEqual(expect.arrayContaining(['Pause', 'Stop']));
      // The apparatus: Pause is the height #669 gives it, so the margins
      // below are taken over the controls a rider gets.
      const pause = during.find((each) => each.name === 'Pause');
      expect(pause?.box.height ?? 0).toBeGreaterThanOrEqual(
        RIDE_TIME_TARGET_PIXELS - SUBPIXEL_TOLERANCE,
      );
      expect(during.filter((each) => !onScreen(each, viewport)).map(describeControl)).toEqual([]);
      const notice = seen.keepScreenOn;
      expect(notice?.onTop).toBe(true);
      expect((notice?.box.top ?? -1) >= insetsOf(viewport).top).toBe(true);

      const lowest = lowestOf(during);
      const controlMargin = foldMargin(lowest.box.bottom, viewport);
      const noticeMargin = foldMargin(notice?.box.bottom ?? Infinity, viewport);
      const note =
        `lowest control ${controlMargin.toFixed(1)} px (${describeControl(lowest)}); ` +
        `the notice ${noticeMargin.toFixed(1)} px, ${(notice?.box.height ?? 0).toFixed(0)} px tall ` +
        `— at ${String(viewport.width)}×${String(viewport.height)}`;
      testInfo.annotations.push({
        type: 'keep the screen on, margin to the fold',
        description: note,
      });
      console.log(`keep the screen on, margin to the fold — ${viewport.name} — ${note}`);

      expect(noticeMargin, note).toBeGreaterThanOrEqual(FOLD_MARGIN_PIXELS);
      expect(controlMargin, note).toBeGreaterThanOrEqual(FOLD_MARGIN_PIXELS);
    });
  });
}

/**
 * #692 — room for a standing notice at in-shell tablet sizes.
 *
 * ## What was wrong, measured
 *
 * A standing notice is one that stays for the rest of a ride: #647's *Keep
 * the screen on*, #526's *No notification* (Android only — the platform this
 * app ships to a tablet on), the recorder's *Device full* or *Save failed*,
 * #551's lost side camera, #605's *Eased*. Measured in the pinned Chromium on a
 * Mac before #692, each alone:
 *
 *   1280×800 in the shell   *No notification*   *Pause* −77.9 px, UNDER the fold
 *   1024×720                *No notification*   *Pause* −65.1 px, UNDER the fold
 *   800×1280 upright        *Save failed*       the workout's *Ride* −11.5 px
 *   800×1280 upright        *No notification*   the workout's *Ride* −36.3 px
 *
 * None of those states had ever been rendered by this gate. *No notification*
 * stood ABOVE *Pause* (`RideView.tsx` §`RideControls`), where #436's review
 * had already measured what a line there costs; and upright the Live group was
 * stacked over the trainer group, so anything the Live group gained — a notice,
 * the side camera, a wrapped clock — came off the workout chooser's margin.
 *
 * ## What #692 does, and the one rule under it
 *
 * **Nothing whose height changes during a ride sits above a ride control in
 * its column.** Two changes make that true:
 *
 *   - `RideView.tsx`: in the Live group the ride controls come straight after
 *     the heading, then the side camera (which carries a control), then the
 *     standing notices, then the metric cards and the clock. The notices are
 *     on the screen, high, and the metrics are what moves.
 *   - `theme.css` §`.oyl-ride`: a tablet held upright is two columns, the
 *     trainer BESIDE the live group, as landscape is. Width alone gave 800 px
 *     one column; with the height a tablet upright has, two fit.
 *
 * #647's notice stays beside the Live heading and #605's *Eased* stays in the
 * running workout's section, each on the screen as the owner ruled; the
 * controls stay #669's 48 px.
 *
 * ## What is held, and what is only published
 *
 * Each standing notice alone, at every tablet, both ways up, inside the shell
 * with the #439 insets on the engine: every ride control on the screen with no
 * scrolling and clear of {@link FOLD_MARGIN_PIXELS}, and the notice itself on
 * the screen, uncovered and clear of the same floor. With EVERY one of them
 * standing at once the controls are held the same; the notices' own margins
 * are published and held only to START on the screen — five notices at once
 * are more sentences than a landscape tablet's column holds above its fold,
 * and what goes past it is the last sentence, never a control. The metric
 * cards' margin is published everywhere: they are what moves now.
 *
 * ⚠️ The upright insets are the landscape reading reused, not read off the
 * device (`insets.ts`).
 *
 * ## The control
 *
 * `asBefore692()` puts the screen back as it was on the live elements — the
 * metric cards above the controls, *No notification* above *Pause*, and one
 * column upright — and with *No notification* standing the lowest ride control
 * must fall under the floor at every in-shell tablet. Without it, "every
 * control clears the fold" is as true of a page that rendered no notice.
 */
const STANDING_NOTICES: readonly {
  readonly name: string;
  readonly query: string;
  /** The label each notice this state stands opens with. */
  readonly labels: readonly string[];
}[] = [
  { name: 'keep the screen on', query: '?keepalive=failed', labels: ['Keep the screen on:'] },
  { name: 'no notification', query: '?notification=refused', labels: ['No notification:'] },
  { name: 'device full', query: '?storage=full', labels: ['Device full:'] },
  { name: 'side camera lost', query: '?side=lost', labels: ['Side camera:'] },
  { name: 'a workout eased', query: '?workout=eased', labels: ['Eased:'] },
  // #1240: a workout's heart-rate hold — its notice, with the longest sentence
  // `workout/hold-text.ts` can produce, in the running workout's section.
  { name: 'a heart-rate hold', query: '?workout=hold', labels: ['Heart-rate hold:'] },
];

const EVERY_NOTICE = {
  name: 'every standing notice at once',
  query: '?workout=eased&keepalive=failed&notification=refused&storage=full&side=lost',
  // One workout on the stub: eased, not also holding (#1240's hold has its own case).
  labels: STANDING_NOTICES.filter((each) => each.query !== '?workout=hold').flatMap(
    (each) => each.labels,
  ),
};

/** Live-group notices that are not standing IN the column. @see the #692 case */
const NOT_IN_THE_COLUMN: readonly string[] = ['Keep the screen on:', 'Side camera:'];

function lowestOf(among: readonly RideViewControl[]): RideViewControl {
  return among.reduce((low, each) => (each.box.bottom > low.box.bottom ? each : low));
}

function describeNotice(notice: RideViewNotice, viewport: Viewport): string {
  return `${notice.label} ${foldMargin(notice.box.bottom, viewport).toFixed(1)} px (${notice.box.height.toFixed(0)} px tall)`;
}

for (const viewport of EASED_VIEWPORTS) {
  for (const state of [...STANDING_NOTICES, EVERY_NOTICE]) {
    const alone = state !== EVERY_NOTICE;
    test.describe(`#692 — ${state.name} — ${viewport.name}`, () => {
      test(`every ride control clears the fold by a margin${alone ? ', and so does the notice' : ''}`, async ({
        page,
      }, testInfo) => {
        await open(page, viewport, state.query);
        const seen = await measure(page);

        expect(seen.scrollY).toBe(0);
        // The apparatus: every notice this state stands is on the page, so
        // the margins below are taken over a screen that has them.
        expect(seen.notices.map((each) => each.label)).toEqual(
          expect.arrayContaining([...state.labels]),
        );

        const during = seen.controls.filter((each) => each.group !== 'sensors');
        expect(during.map((each) => each.name)).toEqual(expect.arrayContaining(['Pause', 'Stop']));
        if (state.query.includes('side=lost')) {
          expect(during.map((each) => each.name)).toContain('Stop side camera');
        }

        // Published BEFORE anything below is asserted, so a red run still says
        // where every control and notice ended.
        const lowest = lowestOf(during);
        const controlMargin = foldMargin(lowest.box.bottom, viewport);
        const standing = seen.notices.filter((each) => state.labels.includes(each.label));
        const metricsMargin = foldMargin(seen.metrics?.bottom ?? Infinity, viewport);
        const topRowMargin = foldMargin(seen.metricsTopRow?.bottom ?? Infinity, viewport);
        const note =
          `lowest control ${controlMargin.toFixed(1)} px (${describeControl(lowest)}); ` +
          `${standing.map((each) => describeNotice(each, viewport)).join('; ')}; ` +
          `the metric cards end ${metricsMargin.toFixed(1)} px above the fold, ` +
          `their first row ${topRowMargin.toFixed(1)} px ` +
          `— at ${String(viewport.width)}×${String(viewport.height)}`;
        testInfo.annotations.push({ type: '#692 margins to the fold', description: note });
        console.log(`#692 — ${state.name} — ${viewport.name} — ${note}`);

        expect(during.filter((each) => !onScreen(each, viewport)).map(describeControl)).toEqual([]);
        expect(controlMargin, note).toBeGreaterThanOrEqual(FOLD_MARGIN_PIXELS);
        // #740 (#692's review): with ONE notice standing, the metric cards'
        // first row — the readings a rider looks at first — clears the fold
        // by the same floor. The whole list is published and not bounded: on
        // the CI runner's fonts its second row ended 1.3 px above the fold at
        // 1280×800 in the shell with *No notification* (run 36450645172), and
        // −22.7 px before #671's smaller header (run 36416451402).
        if (alone) {
          expect(seen.metricsTopRow, 'no metric cards on the page').toBeDefined();
          expect(topRowMargin, note).toBeGreaterThanOrEqual(FOLD_MARGIN_PIXELS);
        }

        // The rule itself, in the Live column: no standing notice starts above
        // a ride control's end. Two are not standing in that column: #647's is
        // BESIDE the heading, above everything by the owner's ruling, and the
        // side camera's own line is the label of the control under it. ⚠️ This
        // is what the CI runner's first run of #692 found — *No notification*
        // still inside `RideControls`, over *Stop side camera* (66.3 px).
        const liveControls = during.filter((each) => each.group === 'live');
        const lowestLive = lowestOf(liveControls);
        const above = seen.notices.filter(
          (each) =>
            each.group === 'live' &&
            !NOT_IN_THE_COLUMN.includes(each.label) &&
            each.box.top < lowestLive.box.bottom,
        );
        expect(
          above.map((each) => `${each.label} starts above ${describeControl(lowestLive)}`),
        ).toEqual([]);
        for (const notice of standing) {
          expect(notice.onTop, `${notice.label} is covered`).toBe(true);
          expect(notice.box.top, `${notice.label} starts under the bars`).toBeGreaterThanOrEqual(
            insetsOf(viewport).top - SUBPIXEL_TOLERANCE,
          );
          if (alone) {
            expect(foldMargin(notice.box.bottom, viewport), note).toBeGreaterThanOrEqual(
              FOLD_MARGIN_PIXELS,
            );
          } else {
            expect(notice.box.top, `${notice.label} starts below the fold`).toBeLessThan(
              viewport.height - insetsOf(viewport).bottom,
            );
          }
        }
      });
    });
  }
}

/** The in-shell tablets, where #692 was found. */
const IN_THE_SHELL: readonly Viewport[] = [
  TABLET_IN_THE_SHELL,
  SMALL_TABLET_IN_THE_SHELL,
  TABLET_UPRIGHT_IN_THE_SHELL,
];

for (const viewport of IN_THE_SHELL) {
  test.describe(`#692 — the control — ${viewport.name}`, () => {
    test('laid out as before #692, a standing notice puts a ride control under the floor', async ({
      page,
    }, testInfo) => {
      await open(page, viewport, '?notification=refused');
      const lowestMargin = (seen: RideViewMeasurement): { margin: number; name: string } => {
        const lowest = lowestOf(seen.controls.filter((each) => each.group !== 'sensors'));
        return { margin: foldMargin(lowest.box.bottom, viewport), name: lowest.name };
      };
      const fixed = lowestMargin(await measure(page));
      await page.evaluate(() => {
        window.__oylRideView?.asBefore692();
      });
      const before = await measure(page);
      const reverted = lowestMargin(before);
      const note =
        `lowest control ${fixed.margin.toFixed(1)} px (${fixed.name}) → ` +
        `${reverted.margin.toFixed(1)} px (${reverted.name}) laid out as before #692`;
      testInfo.annotations.push({ type: '#692 control', description: note });
      console.log(`#692 — the control — ${viewport.name} — ${note}`);

      // The apparatus: the control did rewrite the page. The metric cards are
      // above the controls again, and upright the trainer group is under the
      // live one again.
      const pause = before.controls.find((each) => each.name === 'Pause');
      expect(before.metrics?.bottom ?? Infinity).toBeLessThanOrEqual(pause?.box.top ?? -Infinity);
      if (viewport.height > viewport.width) {
        expect(before.groups.trainer?.top ?? 0).toBeGreaterThanOrEqual(
          before.groups.live?.bottom ?? Infinity,
        );
      }

      expect(fixed.margin, note).toBeGreaterThanOrEqual(FOLD_MARGIN_PIXELS);
      expect(reverted.margin, note).toBeLessThan(FOLD_MARGIN_PIXELS);
    });
  });
}

/**
 * #740 (#655's review, N1): a HAND-SET target the stall rescue has eased, with
 * the rider's next *Set* held. #655 put a *Held* line between the *Eased*
 * notice and the ERG form, which pushes *End ERG* — the control the Eased
 * sentence itself names — down, and no fixture rendered a manual rescue:
 * `?workout=eased` is a workout's, where the form is absent. `?erg=held` is,
 * and *End ERG* is held to the floor at every tablet, its margin published.
 */
for (const viewport of EASED_VIEWPORTS) {
  test(`#740 — a manual rescue with a Set held — End ERG clears the fold — ${viewport.name}`, async ({
    page,
  }, testInfo) => {
    await open(page, viewport, '?erg=held');
    const seen = await measure(page);
    expect(seen.scrollY).toBe(0);
    // The apparatus: both notices this state is about are on the page.
    expect(seen.notices.map((each) => each.label)).toEqual(
      expect.arrayContaining(['Eased:', 'Held:']),
    );
    const end = seen.controls.find((each) => each.group === 'trainer' && each.name === 'End ERG');
    expect(end, 'no End ERG on the page').toBeDefined();
    const held = seen.notices.find((each) => each.label === 'Held:');
    const margin = foldMargin(end?.box.bottom ?? Infinity, viewport);
    const note =
      `End ERG ${margin.toFixed(1)} px above the fold; the Held line ` +
      `${held?.box.height.toFixed(0) ?? '?'} px tall — at ` +
      `${String(viewport.width)}×${String(viewport.height)}`;
    testInfo.annotations.push({ type: '#740 End ERG', description: note });
    console.log(`#740 — End ERG — ${viewport.name} — ${note}`);
    expect(end?.onTop, 'End ERG is covered').toBe(true);
    expect(margin, note).toBeGreaterThanOrEqual(FOLD_MARGIN_PIXELS);
  });
}

test(`#740 — the control — the Held line above the form puts End ERG under the floor — ${TABLET_IN_THE_SHELL.name}`, async ({
  page,
}, testInfo) => {
  const viewport = TABLET_IN_THE_SHELL;
  await open(page, viewport, '?erg=held');
  const endMargin = (seen: RideViewMeasurement): number =>
    foldMargin(
      seen.controls.find((each) => each.group === 'trainer' && each.name === 'End ERG')?.box
        .bottom ?? -Infinity,
      viewport,
    );
  const fixed = endMargin(await measure(page));
  await page.evaluate(() => {
    window.__oylRideView?.heldAboveTheForm();
  });
  const reverted = endMargin(await measure(page));
  const note = `End ERG ${fixed.toFixed(1)} px → ${reverted.toFixed(1)} px with the Held line above the form`;
  testInfo.annotations.push({ type: '#740 control', description: note });
  console.log(`#740 — the control — ${note}`);
  expect(fixed, note).toBeGreaterThanOrEqual(FOLD_MARGIN_PIXELS);
  expect(reverted, note).toBeLessThan(FOLD_MARGIN_PIXELS);
});

/**
 * What the tightening takes off each ROW of cards: the padding at the small
 * step rather than the medium one, top and bottom (2 × 8 px). Per row since
 * #1012 — on the landscape tablet the four readings are one row now, where
 * this was "two rows and the gap", 30 px.
 */
const CARDS_TIGHTEN_PER_ROW_PIXELS = 16;

test.describe(`#692 — the metric cards — ${TABLET_IN_THE_SHELL.name}`, () => {
  /**
   * The cost #692 moved, and the rule that pays some of it back: with a
   * notice standing in the Live group the cards are what move down, so they
   * tighten (`theme.css` §"#692: while a notice stands"). Held as the cards'
   * height against the same screen with no notice, because where they END
   * depends on the fonts and is published above rather than bounded.
   */
  test('tighten while a notice stands in the Live group, and not for one beside the heading', async ({
    page,
  }, testInfo) => {
    const viewport = TABLET_IN_THE_SHELL;
    let rows = 0;
    const heightWith = async (query: string): Promise<number> => {
      await open(page, viewport, query);
      const seen = await measure(page);
      rows = Math.max(rows, seen.metricRows);
      return seen.metrics?.height ?? 0;
    };
    const none = await heightWith('');
    const standing = await heightWith('?notification=refused');
    const beside = await heightWith(KEEP_ALIVE_FAILED);
    const note = `the metric cards ${none.toFixed(1)} px tall with no notice, ${standing.toFixed(1)} px with No notification, ${beside.toFixed(1)} px with Keep the screen on`;
    testInfo.annotations.push({ type: '#692 metric cards', description: note });
    console.log(`#692 — the metric cards — ${note}`);

    expect(none, note).toBeGreaterThan(0);
    expect(rows, note).toBeGreaterThan(0);
    expect(none - standing, note).toBeGreaterThanOrEqual(
      rows * CARDS_TIGHTEN_PER_ROW_PIXELS - SUBPIXEL_TOLERANCE,
    );
    expect(beside, note).toBeCloseTo(none, 0);
  });
});

test.describe(`#692 — ${TABLET_UPRIGHT_IN_THE_SHELL.name}`, () => {
  test('the trainer is BESIDE the live group upright, as it is in landscape', async ({ page }) => {
    const viewport = TABLET_UPRIGHT_IN_THE_SHELL;
    await open(page, viewport);
    const { groups } = await measure(page);

    expect(groups.trainer?.top).toBeCloseTo(groups.live?.top ?? -1, 0);
    expect(groups.trainer?.left ?? 0).toBeGreaterThanOrEqual(groups.live?.right ?? Infinity);
  });
});

/**
 * #740 (#692's review): the NARROWEST two-column Ride screen — 768 px, the
 * `48rem` of `(min-width: 48rem) and (min-height: 60rem)`, which a 768×1024
 * tablet held upright is — measured rather than probed. With every standing
 * notice at once: the trainer beside the live group, no sideways scroll, and
 * every control inside the viewport. The control is one pixel narrower, where
 * the same page must be ONE column — so a green run says the two columns were
 * the breakpoint's doing, at its edge.
 */
for (const width of [768, 767] as const) {
  test(`#740 — ${String(width)}×1024 upright is ${width === 768 ? 'two columns, the narrowest there is' : 'one column (the control)'}`, async ({
    page,
  }) => {
    const viewport = { name: `${String(width)}×1024 upright`, width, height: 1024 };
    await open(page, viewport, EVERY_NOTICE.query);
    const seen = await measure(page);
    const sideways = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    const { live, trainer } = seen.groups;
    const beside = (trainer?.left ?? 0) >= (live?.right ?? Infinity);
    console.log(
      `#740 — ${String(width)}×1024 — live ${live?.width.toFixed(0) ?? '?'} px, trainer ${trainer?.width.toFixed(0) ?? '?'} px, ${beside ? 'beside' : 'under'}`,
    );
    if (width === 767) {
      expect(beside, 'one pixel under the breakpoint is still two columns').toBe(false);
      return;
    }
    expect(beside, 'the trainer is not beside the live group').toBe(true);
    expect(trainer?.top).toBeCloseTo(live?.top ?? -1, 0);
    expect(sideways, 'the page scrolls sideways').toBeLessThanOrEqual(0);
    expect(
      seen.controls
        .filter((each) => each.box.left < 0 || each.box.right > width)
        .map((each) => each.name),
    ).toEqual([]);
  });
}

/**
 * #669 — the workout chooser on the tablet held upright, inside the shell.
 *
 * ⚠️ **Nothing asserted this before #669, and it was already under the floor.**
 * Upright the screen was one column then, the trainer group under the live
 * one, and the workout's *Ride* the last ride control in it. ⚠️ Since #692 it
 * is two columns and *Ride* ends about 525 px clear; the case still holds the
 * floor and its control still moves *Ride*, and §"#692" is where the margin a
 * notice costs is held now. The #647 block
 * above held only *Pause* / *Stop* there and published this margin: on the CI
 * runner it read **38.9 px** on `main` before #669 and **29.3 px** with #669's
 * 48 px controls — under {@link FOLD_MARGIN_PIXELS} both times; on a Mac 63.7
 * and 54.1, one wrapped line of text apart. What #669 did about it is
 * `theme.css` §`.oyl-ride__group--trainer form.oyl-trainer__form > p`: the ERG
 * form's own sentence sits the row's 8 px under its controls instead of a
 * paragraph's margins either side of it, which a flex container does not
 * collapse.
 *
 * The control puts those margins back and requires *Ride* to move down by at
 * least {@link CHOOSER_FIX_PIXELS}. It does not require the reverted page to
 * be under the floor, because on a Mac's fonts it is not — that is the
 * one-line difference above — and a control that is red on one machine only is
 * a control of the fonts.
 */
const CHOOSER_FIX_PIXELS = 24;

test.describe(`#669 — the workout chooser — ${TABLET_UPRIGHT_IN_THE_SHELL.name}`, () => {
  const viewport = TABLET_UPRIGHT_IN_THE_SHELL;

  async function rideMargin(page: Page): Promise<number> {
    const seen = await measure(page);
    const ride = seen.controls.find((each) => each.name === STARTS_A_WORKOUT);
    expect(ride, 'the chooser rendered no Ride control').toBeDefined();
    expect(ride?.box.height ?? 0).toBeGreaterThanOrEqual(
      RIDE_TIME_TARGET_PIXELS - SUBPIXEL_TOLERANCE,
    );
    return foldMargin(ride?.box.bottom ?? Infinity, viewport);
  }

  test('its Ride clears the fold by a margin, and says by how much', async ({ page }, testInfo) => {
    await open(page, viewport);
    const seen = await measure(page);
    expect(seen.scrollY).toBe(0);
    const during = seen.controls.filter((each) => each.group !== 'sensors');
    expect(during.filter((each) => !onScreen(each, viewport)).map(describeControl)).toEqual([]);
    // The apparatus: Ride is the lowest ride control upright, so this is the
    // screen's own fold margin and not a margin over a control higher up.
    const lowest = during.reduce((low, each) => (each.box.bottom > low.box.bottom ? each : low));
    expect(lowest.name).toBe(STARTS_A_WORKOUT);

    const margin = await rideMargin(page);
    const note = `${margin.toFixed(1)} px under ${describeControl(lowest)} at ${String(viewport.width)}×${String(viewport.height)}`;
    testInfo.annotations.push({
      type: '#669 workout chooser, margin to the fold',
      description: note,
    });
    console.log(`#669 workout chooser, margin to the fold — ${note}`);
    expect(margin, note).toBeGreaterThanOrEqual(FOLD_MARGIN_PIXELS);
  });

  test('the control — with the ERG sentence spaced as before #669, Ride is lower', async ({
    page,
  }, testInfo) => {
    await open(page, viewport);
    const fixed = await rideMargin(page);
    await page.addStyleTag({
      content:
        '.oyl-ride__group--trainer form.oyl-trainer__form > p { margin: 1rem 0 !important; }',
    });
    const reverted = await rideMargin(page);
    // Published against the floor and never asserted under it (#710's
    // review): as reverted it read 54.1 on a Mac and 29.3 on the CI runner,
    // a whole wrapped line apart, so which side of the floor it lands on is
    // the fonts' and not this control's.
    const note =
      `Ride ${fixed.toFixed(1)} px → ${reverted.toFixed(1)} px; as before #669 it is ` +
      `${reverted >= FOLD_MARGIN_PIXELS ? 'clear of' : 'under'} the ${String(FOLD_MARGIN_PIXELS)} px floor`;
    testInfo.annotations.push({
      type: 'control, ERG sentence spaced as before',
      description: note,
    });
    console.log(`#669 workout chooser, as before — ${note}`);
    expect(fixed - reverted, note).toBeGreaterThanOrEqual(CHOOSER_FIX_PIXELS);
  });
});

/**
 * #1012 — the readings, and the one sensor banner (epic #935 Phase 2).
 *
 * The live numbers are `design/Reading.tsx` at the metric size: two to a row
 * on a phone and all four in a row on the landscape tablet, where the Live
 * group takes two of three columns. What can go wrong is #259's failure on a
 * new screen — a number at 61 px in a card too narrow for it spilling onto
 * the one beside it — so every card is read for spill at every phone and
 * tablet, with every reading at the widest it can be (`?readings=widest`,
 * 1888 W) and the readings forced four to a row as the control.
 */
const READING_VIEWPORTS: readonly Viewport[] = [
  { name: 'the narrowest phone — 320×568', width: 320, height: 568 },
  { name: 'a phone — 360×800', width: 360, height: 800 },
  { name: 'a phone — 390×844', width: 390, height: 844 },
  { name: 'a phone — 412×915', width: 412, height: 915 },
  TABLET_UPRIGHT_IN_THE_SHELL,
  SMALL_TABLET_IN_THE_SHELL,
  TABLET_IN_THE_SHELL,
];

/** How many readings to a row each viewport is meant to show. */
function readingsPerRow(viewport: Viewport): number {
  if (viewport === TABLET_IN_THE_SHELL) return 4;
  if (viewport.width <= 320) return 1;
  return 2;
}

for (const viewport of READING_VIEWPORTS) {
  test(`#1012 — every reading fits its card, ${String(readingsPerRow(viewport))} to a row — ${viewport.name}`, async ({
    page,
  }, testInfo) => {
    await open(page, viewport, '?readings=widest');
    const seen = await measure(page);
    const note = seen.readings
      .map(
        (each) =>
          `${each.label} ${each.reading.width.toFixed(0)} px in ${each.card.width.toFixed(0)} px`,
      )
      .join('; ');
    testInfo.annotations.push({ type: '#1012 readings', description: note });
    console.log(`#1012 — readings — ${viewport.name} — ${note}`);

    expect(seen.readings, 'the fixture shows four readings').toHaveLength(4);
    expect(seen.metricRows, note).toBe(4 / readingsPerRow(viewport));
    for (const each of seen.readings) {
      expect(each.spill, `${each.label} spills out of its card — ${note}`).toBeLessThanOrEqual(0);
      // Inside the card's padding, not only its border: a number running
      // into the padding is a number touching the next card's edge.
      expect(each.reading.right, `${each.label} — ${note}`).toBeLessThanOrEqual(
        each.contentRight + SUBPIXEL_TOLERANCE,
      );
    }
  });
}

test('#1012 — the control — four readings to a row on a phone spill out of their cards', async ({
  page,
}) => {
  await open(page, { name: 'a phone — 390×844', width: 390, height: 844 }, '?readings=widest');
  const before = await measure(page);
  await page.evaluate(() => {
    window.__oylRideView?.crammedReadings();
  });
  const after = await measure(page);
  expect(before.readings.filter((each) => each.spill > 0)).toEqual([]);
  // The apparatus: the control did lay them out four to a row.
  expect(after.metricRows).toBe(1);
  expect(after.readings.filter((each) => each.spill > 0).length).toBeGreaterThan(0);
});

for (const viewport of [
  { name: 'a phone — 390×844', width: 390, height: 844 },
  TABLET_IN_THE_SHELL,
  TABLET_UPRIGHT_IN_THE_SHELL,
] as const) {
  test(`#1012 — nothing paired: ONE banner and one Pair a sensor, on the screen — ${viewport.name}`, async ({
    page,
  }, testInfo) => {
    await open(page, viewport, '?sensors=none');
    const seen = await measure(page);
    const banner = seen.sensorBanner;
    expect(banner, 'no sensor banner').toBeDefined();
    expect(seen.readings, 'the four tiles are still there').toEqual([]);
    expect(banner?.links).toBe(1);
    // #1021: named for what it pairs (WCAG 2.4.4).
    expect(banner?.link.name).toBe('Pair a sensor');
    expect(banner?.link.onTop, 'Pair is covered').toBe(true);
    expect(banner?.link.box.height ?? 0).toBeGreaterThanOrEqual(44 - SUBPIXEL_TOLERANCE);
    // After every ride control in its column (#692): it stands where the
    // readings would.
    const live = seen.controls.filter((each) => each.group === 'live');
    expect(banner?.box.top ?? -Infinity).toBeGreaterThanOrEqual(lowestOf(live).box.bottom);
    const margin = foldMargin(banner?.link.box.bottom ?? Infinity, viewport);
    const note = `Pair ${margin.toFixed(1)} px above the fold`;
    testInfo.annotations.push({ type: '#1012 banner', description: note });
    console.log(`#1012 — banner — ${viewport.name} — ${note}`);
    expect(margin, note).toBeGreaterThanOrEqual(FOLD_MARGIN_PIXELS);
  });
}

/**
 * #1029 — the screen with nothing paired, on the owner's tablet in landscape
 * (seen on 2026-10-03): the readings and the status fill the width, and the
 * lower half is used.
 *
 * Three claims, each read off the engine's layout:
 *
 *   - the Trainer group's card runs at least to the bottom of the Live group,
 *     where it was one status line alone at the top of its column — and its
 *     control, the card's stretch taken off through a style tag, must leave
 *     it a long way short;
 *   - elapsed and moving time are readings at the live readings' metric size
 *     on the landscape tablet, and `xxl` on a phone, inside their own boxes;
 *   - before a ride, the other ways to ride START on the first screen, under
 *     the Live group, so the empty lower half is no longer empty.
 */
interface NothingPaired {
  readonly live: Box1029;
  readonly trainerCard: Box1029 | undefined;
  readonly other: Box1029 | undefined;
  readonly clock: readonly {
    readonly fontSize: number;
    readonly right: number;
    readonly within: number;
  }[];
  readonly metricFontSize: number;
  readonly xxlFontSize: number;
}

interface Box1029 {
  readonly top: number;
  readonly bottom: number;
}

async function nothingPaired(page: Page): Promise<NothingPaired> {
  return page.evaluate(() => {
    const box = (element: Element | null): { top: number; bottom: number } | undefined => {
      if (element === null) return undefined;
      const rect = element.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom };
    };
    const live = box(document.querySelector('.oyl-ride__group--live'));
    if (live === undefined) throw new Error('the Ride screen rendered no Live group');
    const root = getComputedStyle(document.documentElement);
    const rem = Number.parseFloat(root.fontSize);
    const token = (name: string): number => Number.parseFloat(root.getPropertyValue(name)) * rem;
    return {
      live,
      trainerCard: box(document.querySelector('.oyl-ride__group--trainer > .oyl-trainer-card')),
      other: box(document.querySelector('.oyl-ride__group--other')),
      clock: [
        ...document.querySelectorAll(
          '.oyl-ride__clock .oyl-ride__time:not(.oyl-ride__time--recorded)',
        ),
      ].map((pair) => {
        const value = pair.querySelector('.oyl-reading__value');
        if (value === null) throw new Error('a clock term has no reading');
        return {
          fontSize: Number.parseFloat(getComputedStyle(value).fontSize),
          right: value.getBoundingClientRect().right,
          within: pair.getBoundingClientRect().right,
        };
      }),
      metricFontSize: token('--oyl-font-size-metric'),
      xxlFontSize: token('--oyl-font-size-xxl'),
    };
  });
}

for (const viewport of [TABLET_IN_THE_SHELL, SMALL_TABLET_IN_THE_SHELL] as const) {
  test(`#1029 — nothing paired: the trainer card is the Live group's height, and other rides start on the first screen — ${viewport.name}`, async ({
    page,
  }, testInfo) => {
    await open(page, viewport, '?sensors=none&ride=idle');
    const seen = await nothingPaired(page);
    const card = seen.trainerCard;
    const other = seen.other;
    expect(card, 'no trainer card').toBeDefined();
    expect(other, 'no other ways to ride').toBeDefined();
    const short = seen.live.bottom - (card?.bottom ?? -Infinity);
    const otherMargin = foldMargin(other?.top ?? Infinity, viewport);
    const note = `card ends ${(-short).toFixed(1)} px past the Live group; other rides start ${otherMargin.toFixed(1)} px above the fold`;
    testInfo.annotations.push({ type: '#1029 nothing paired', description: note });
    console.log(`#1029 — nothing paired — ${viewport.name} — ${note}`);

    expect(short, note).toBeLessThanOrEqual(SUBPIXEL_TOLERANCE);
    expect(other?.top ?? -Infinity, note).toBeGreaterThanOrEqual(seen.live.bottom);
    expect(otherMargin, note).toBeGreaterThan(0);

    // The control: the card without its stretch is one tile at the top of
    // its column, a long way short of the Live group — the defect.
    await page.addStyleTag({
      content: '.oyl-ride__group--trainer > .oyl-trainer-card { flex: none !important; }',
    });
    const unstretched = await nothingPaired(page);
    const shortUnstretched = seen.live.bottom - (unstretched.trainerCard?.bottom ?? Infinity);
    console.log(
      `#1029 — control — ${viewport.name} — unstretched, the card ends ${shortUnstretched.toFixed(1)} px short of the Live group`,
    );
    // Fails the assertion above, by more than layout rounding.
    expect(shortUnstretched).toBeGreaterThan(10 * SUBPIXEL_TOLERANCE);
  });
}

for (const [viewport, size] of [
  [TABLET_IN_THE_SHELL, 'metric'],
  [SMALL_TABLET_IN_THE_SHELL, 'xxl'],
  [{ name: 'a phone — 360×800', width: 360, height: 800 }, 'xxl'],
] as const) {
  test(`#1029 — elapsed and moving time are readings at the ${size} size, inside their boxes — ${viewport.name}`, async ({
    page,
  }) => {
    // A ride an hour in, so the widest time a ride usually shows is measured.
    await open(page, viewport);
    const seen = await nothingPaired(page);
    expect(seen.clock).toHaveLength(2);
    const expected = size === 'metric' ? seen.metricFontSize : seen.xxlFontSize;
    for (const each of seen.clock) {
      expect(each.fontSize).toBeCloseTo(expected, 1);
      expect(each.right).toBeLessThanOrEqual(each.within + SUBPIXEL_TOLERANCE);
    }
  });
}

/**
 * #1042 — the result card after a ride is saved, at its fullest
 * (`rideview.html?ride=saved`: hours of elapsed time, four-digit power, a
 * heart rate and the longest game outcome sentence).
 *
 * It stands only on a STOPPED ride, so there is no ride control for it to
 * cover; what is held is that the rider can reach *Done*, the ride's page and
 * *Start a new ride* with no scrolling, each {@link FOLD_MARGIN_PIXELS} clear
 * of the fold, and that no fact spills out of its track. The margins are
 * published at every tablet.
 */
const SAVED_CARD_VIEWPORTS: readonly Viewport[] = [...TABLETS, TABLET_UPRIGHT_IN_THE_SHELL];

for (const viewport of SAVED_CARD_VIEWPORTS) {
  test.describe(`#1042 — the result card — ${viewport.name}`, () => {
    test('Done, the ride’s page and Start a new ride clear the fold, and no fact spills', async ({
      page,
    }, testInfo) => {
      await open(page, viewport, '?ride=saved');
      const seen = await measure(page);
      const card = seen.resultCard;
      expect(card, 'the result card did not render').toBeDefined();
      // No ride control on a stopped ride: there is nothing for it to cover.
      const rideControls = seen.controls.filter(
        (each) => each.group === 'live' && ['Pause', 'Stop', 'Resume'].includes(each.name),
      );
      expect(rideControls).toEqual([]);
      const named = (name: string): RideViewControl => {
        const found = seen.controls.find((each) => each.group === 'live' && each.name === name);
        expect(found, `no ${name} in the live group`).toBeDefined();
        return found!;
      };
      const done = named('Done');
      const another = named('Start a new ride');
      const margins = {
        done: foldMargin(done.box.bottom, viewport),
        link: foldMargin(card!.link.box.bottom, viewport),
        another: foldMargin(another.box.bottom, viewport),
        card: foldMargin(card!.box.bottom, viewport),
      };
      const note =
        `Done ${margins.done.toFixed(1)} px, ${card!.link.name} ${margins.link.toFixed(1)} px, ` +
        `Start a new ride ${margins.another.toFixed(1)} px, the card ${margins.card.toFixed(1)} px ` +
        `above the fold; spill ${String(card!.spill)} px`;
      testInfo.annotations.push({ type: '#1042', description: note });
      console.log(`#1042 — ${viewport.name} — ${note}`);
      expect(seen.scrollY).toBe(0);
      for (const control of [done, another]) {
        expect(onScreen(control, viewport), describeControl(control)).toBe(true);
      }
      expect(card!.link.onTop, note).toBe(true);
      expect(margins.done, note).toBeGreaterThanOrEqual(FOLD_MARGIN_PIXELS);
      expect(margins.link, note).toBeGreaterThanOrEqual(FOLD_MARGIN_PIXELS);
      expect(margins.another, note).toBeGreaterThanOrEqual(FOLD_MARGIN_PIXELS);
      expect(card!.spill, note).toBe(0);
      // 44 px targets, the button's own and the link drawn as one.
      expect(done.box.height).toBeGreaterThanOrEqual(44);
      expect(card!.link.box.height).toBeGreaterThanOrEqual(44);
    });
  });
}

/**
 * #1083 — the result card's readings fit their facts at a ten-hour ride.
 *
 * The card's facts are `repeat(auto-fit, minmax(…, 1fr))` tracks, and a
 * reading is `xxl` tabular numerals that do not break: a track narrower than
 * `10:23:45` wraps it or runs it onto the fact beside it (#259's failure, and
 * #1046's and #1052's on the Activities cards and Home). The fixture's
 * elapsed time is `10:23:45` since #1083, and every reading is held to ONE
 * line and at most {@link READING_SPILL_PIXELS} past its own `dd`, at every
 * phone and tablet the card can stand on. The figures are published.
 */
const READING_SPILL_PIXELS = 0.5;

const RESULT_CARD_FIT_VIEWPORTS: readonly Viewport[] = [
  // Where 9rem tracks came out between 144 and 153 px: two tracks narrower
  // than the CI runner's `10:23:45`, which is what #1083 was filed for.
  { name: 'a phone — 375×667', width: 375, height: 667 },
  ...READING_VIEWPORTS.filter((viewport) => !SAVED_CARD_VIEWPORTS.includes(viewport)),
  ...SAVED_CARD_VIEWPORTS,
];

for (const viewport of RESULT_CARD_FIT_VIEWPORTS) {
  test(`#1083 — the result card’s readings fit at 10:23:45 — ${viewport.name}`, async ({
    page,
  }, testInfo) => {
    await open(page, viewport, '?ride=saved');
    const card = (await measure(page)).resultCard;
    expect(card, 'the result card did not render').toBeDefined();
    const note =
      `${card!.readings.join(', ')}: at most ${String(card!.mostReadingLines)} line(s), ` +
      `spill ${card!.readingSpill.toFixed(1)} px`;
    testInfo.annotations.push({ type: '#1083', description: note });
    console.log(`#1083 — ${viewport.name} — ${note}`);
    // The fixture really is a ten-hour ride, or nothing here was measured.
    expect(card!.readings, note).toContain('10:23:45');
    expect(card!.mostReadingLines, note).toBe(1);
    expect(card!.readingSpill, note).toBeLessThanOrEqual(READING_SPILL_PIXELS);
  });
}

// At 7rem the 4:3 tablet's card takes three tracks of about 123 px; at the
// landscape tablet all four facts fit whatever the floor, so it is no control.
test(`#1083 — the control — 7rem tracks wrap or spill a 10:23:45 — ${SMALL_TABLET_IN_THE_SHELL.name}`, async ({
  page,
}, testInfo) => {
  await open(page, SMALL_TABLET_IN_THE_SHELL, '?ride=saved');
  await page.evaluate(() => {
    window.__oylRideView?.narrowResultFacts();
  });
  const card = (await measure(page)).resultCard;
  expect(card, 'the result card did not render').toBeDefined();
  const note =
    `7rem tracks: at most ${String(card!.mostReadingLines)} line(s), ` +
    `spill ${card!.readingSpill.toFixed(1)} px`;
  testInfo.annotations.push({ type: '#1083 control', description: note });
  console.log(`#1083 — the control — ${note}`);
  expect(card!.mostReadingLines > 1 || card!.readingSpill > READING_SPILL_PIXELS, note).toBe(true);
});

test(`#1042 — the control — the card after the readings puts Done under the floor — ${TABLET_IN_THE_SHELL.name}`, async ({
  page,
}, testInfo) => {
  const viewport = TABLET_IN_THE_SHELL;
  await open(page, viewport, '?ride=saved');
  const doneMargin = (seen: RideViewMeasurement): number =>
    foldMargin(
      seen.controls.find((each) => each.group === 'live' && each.name === 'Done')?.box.bottom ??
        -Infinity,
      viewport,
    );
  const fixed = doneMargin(await measure(page));
  await page.evaluate(() => {
    window.__oylRideView?.cardAfterTheReadings();
  });
  const reverted = doneMargin(await measure(page));
  const note = `Done ${fixed.toFixed(1)} px → ${reverted.toFixed(1)} px with the card after the readings`;
  testInfo.annotations.push({ type: '#1042 control', description: note });
  console.log(`#1042 — the control — ${note}`);
  expect(fixed, note).toBeGreaterThanOrEqual(FOLD_MARGIN_PIXELS);
  expect(reverted, note).toBeLessThan(FOLD_MARGIN_PIXELS);
});

/**
 * #1307 — the running workout's graph on the Ride screen.
 *
 * Since the owner's ruling of 2026-10-12 the graph is a group of its own,
 * after the trainer group in the document, and `theme.css` §"THE WORKOUT'S
 * GRAPH ON THE RIDE SCREEN" decides where it is drawn:
 *
 * - landscape: under the readings — across the Live group's two columns at
 *   1280×800, across the whole width under both groups at 1024×768 — with
 *   its lanes SIDE BY SIDE;
 * - upright: under the trainer group in its column, lanes stacked.
 *
 * It is in the page's own flow at every size. Two claims need a browser:
 *
 * 1. **At 1280×800 the whole graph is on screen without scrolling**, in the
 *    states whose notice used to push it under the fold.
 * 2. **At 1024×768 it lies over NO text** — no control, no notice, no trainer
 *    or workout sentence — and the page scrolls to it. It may be under the
 *    fold there. ⚠️ A third pass pinned it to the bottom of the screen
 *    (`position: sticky`), and with the *Eased* notice standing it lay over
 *    "Holding 0 W.": a picture must never cover a sentence that says what the
 *    trainer holds.
 *
 * The fixtures (`rideview-harness.tsx` §`GRAPH_FIXTURES`): a hold that is
 * running, a target raised to the trainer's minimum, a target that steps, and
 * — `?workout=eased` — a trainer holding 0 W where the plan asks 225 W.
 */
interface GraphBox {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly width: number;
  readonly height: number;
}

interface GraphLane {
  readonly name: string;
  readonly box: GraphBox;
  readonly caption: GraphBox;
  readonly captionText: readonly string[];
  readonly captionFontSize: number;
  readonly svg: GraphBox;
  readonly well: GraphBox;
  readonly marks: readonly {
    readonly name: string;
    readonly box: GraphBox;
    readonly paint: string;
  }[];
  readonly chips: readonly {
    readonly text: string;
    readonly box: GraphBox;
    readonly fontSize: number;
    readonly colour: string;
  }[];
}

async function graphOnTheRideScreen(page: Page) {
  return page.evaluate(() => {
    const boxOf = (element: Element): GraphBox => {
      const rect = element.getBoundingClientRect();
      return {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      };
    };
    const group = document.querySelector('.oyl-ride__group--graph');
    const frame = group?.querySelector('[data-oyl-workout-graph="panel"] [role="img"]');
    const live = document.querySelector('.oyl-ride__group--live');
    const trainer = document.querySelector('.oyl-ride__group--trainer');
    const clock = document.querySelector('.oyl-ride__clock');
    const end = [...document.querySelectorAll('button')].find(
      (button) => button.textContent === 'End workout',
    );
    if (!group || !frame || !live || !trainer || !clock || !end) return undefined;
    const key = group.querySelector('.oyl-workout-graph__key');
    /** How far down a group's own content reaches: its box is stretched to its grid row. */
    const contentBottom = (element: Element): number =>
      Math.max(...[...element.children].map((child) => child.getBoundingClientRect().bottom));
    const lanes: GraphLane[] = [...frame.querySelectorAll('[data-oyl-lane]')].map((lane) => {
      const caption = lane.querySelector('.oyl-workout-graph__caption');
      const svg = lane.querySelector('svg');
      const well = lane.querySelector('.oyl-workout-graph__well');
      if (!caption || !svg || !well) throw new Error('a lane is missing a part');
      return {
        name: lane.getAttribute('data-oyl-lane') ?? '',
        box: boxOf(lane),
        caption: boxOf(caption),
        captionText: [...caption.querySelectorAll('span')].map((each) => each.textContent ?? ''),
        captionFontSize: Number.parseFloat(getComputedStyle(caption).fontSize),
        svg: boxOf(svg),
        well: boxOf(well),
        marks: [...svg.querySelectorAll('path')].map((path) => {
          const style = getComputedStyle(path);
          return {
            name: path.getAttribute('class') ?? '',
            box: boxOf(path),
            paint: style.stroke === 'none' ? style.fill : style.stroke,
          };
        }),
        chips: [...well.querySelectorAll('.oyl-workout-graph__scale')].map((chip) => {
          const style = getComputedStyle(chip);
          return {
            text: chip.textContent ?? '',
            box: boxOf(chip),
            fontSize: Number.parseFloat(style.fontSize),
            colour: style.color,
          };
        }),
      };
    });
    const groupBox = boxOf(group);
    // Everything on the Ride screen that carries text of its own — a
    // control, a notice, a sentence, a heading, a reading — and that the
    // graph's group lies over by more than a pixel.
    const overText = [...document.querySelectorAll('.oyl-ride *')]
      .filter((element) => !group.contains(element))
      .filter((element) =>
        [...element.childNodes].some(
          (node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').trim() !== '',
        ),
      )
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          Math.min(rect.bottom, groupBox.bottom) - Math.max(rect.top, groupBox.top) > 1 &&
          Math.min(rect.right, groupBox.right) - Math.max(rect.left, groupBox.left) > 1
        );
      })
      .map((element) => (element.textContent ?? '').trim().slice(0, 40));
    // How wide each LINE of the sentence under the graph is, top to bottom.
    const keyLines: number[] = [];
    if (key !== null) {
      const range = document.createRange();
      range.selectNodeContents(key);
      for (const rect of range.getClientRects()) {
        keyLines.push(rect.width);
      }
    }
    const reading = frame.querySelector('.oyl-workout-graph__reading');
    return {
      name: frame.getAttribute('aria-label') ?? '',
      group: groupBox,
      groupText: group.textContent ?? '',
      frame: boxOf(frame),
      frameBackground: getComputedStyle(frame).backgroundColor,
      readingColour: reading ? getComputedStyle(reading).color : '',
      // Whether anything in the frame is wider than the frame.
      frameOverflow: frame.scrollWidth - frame.clientWidth,
      live: boxOf(live),
      liveContentBottom: contentBottom(live),
      clock: boxOf(clock),
      trainer: boxOf(trainer),
      trainerContentBottom: contentBottom(trainer),
      end: boxOf(end),
      key: key === null ? undefined : boxOf(key),
      keyText: key?.textContent ?? '',
      keyFontSize: key === null ? 0 : Number.parseFloat(getComputedStyle(key).fontSize),
      lanes,
      overText,
      keyLines,
      position: getComputedStyle(group).position,
      // Document order: live, trainer, the graph, sensors.
      order: [...document.querySelectorAll('.oyl-ride > .oyl-ride__group')].map((each) =>
        [...each.classList].find((name) => name.startsWith('oyl-ride__group--')),
      ),
      // What the panel's own sentences say, to hold the graph to them.
      trainerText: trainer.textContent ?? '',
      rem: Number.parseFloat(getComputedStyle(document.documentElement).fontSize),
      theme: document.documentElement.dataset.theme,
      viewportHeight: window.innerHeight,
      scrollY: window.scrollY,
      sideways: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
}

type GraphSeen = NonNullable<Awaited<ReturnType<typeof graphOnTheRideScreen>>>;

/** How tall `theme.css` makes each lane's drawing where the lanes are STACKED, in rem. */
const LANE_REM: Readonly<Record<string, number>> = { plan: 3.5, 'heart-rate': 4, trace: 5.5 };

/** Landscape puts the lanes side by side; `theme.css` draws that line at 60rem. */
const lanesSideBySide = (viewport: Viewport): boolean => viewport.width >= 960;

/** What holds of the graph in EVERY state: where it is, and that each lane is legible. */
function expectGraphLaidOut(seen: GraphSeen, viewport: Viewport): void {
  expect(seen.name).toContain('Workout graph.');
  // After the trainer group in the document, wherever it is drawn.
  expect(seen.order).toEqual([
    'oyl-ride__group--live',
    'oyl-ride__group--trainer',
    'oyl-ride__group--graph',
    'oyl-ride__group--sensors',
  ]);
  // No wider than the screen, and nothing in it wider than it.
  expect(seen.frame.width).toBeGreaterThan(200);
  expect(seen.frame.left).toBeGreaterThanOrEqual(seen.group.left - 1);
  expect(seen.frame.right).toBeLessThanOrEqual(seen.group.right + 1);
  expect(seen.frame.right).toBeLessThanOrEqual(viewport.width);
  expect(seen.sideways).toBeLessThanOrEqual(0);
  expect(seen.frameOverflow).toBeLessThanOrEqual(0);
  // ⚠️ The paragraph that walked the lanes top to bottom is gone (the owner's
  // ruling): the lanes carry titles.
  expect(seen.groupText).not.toMatch(/Top:|Middle:|Bottom:/);
  // In the page's own flow, at every size: never pinned over what is above it.
  expect(seen.position).toBe('static');
  // What is said under the graph, when anything is, is under it and legible.
  if (seen.keyLines.length > 1) {
    // Two lines of a length, not one line and a last "W." on its own.
    expect(seen.keyLines.at(-1) ?? 0).toBeGreaterThan((seen.keyLines[0] ?? 0) * 0.4);
  }
  if (seen.key !== undefined) {
    if (viewport.width >= 1216) {
      // ⚠️ Three columns: BESIDE the frame, in a column of its own, so that it
      // adds nothing to the group's height however many lines it takes.
      expect(seen.key.left).toBeGreaterThanOrEqual(seen.frame.right);
      expect(seen.key.right).toBeLessThanOrEqual(seen.group.right + 1);
      expect(Math.abs(seen.key.top - seen.frame.top)).toBeLessThanOrEqual(1);
      expect(seen.key.width).toBeGreaterThan(150);
    } else {
      expect(seen.key.top).toBeGreaterThanOrEqual(seen.frame.bottom);
    }
    expect(seen.key.bottom).toBeLessThanOrEqual(seen.group.bottom + 1);
    expect(seen.keyFontSize).toBeGreaterThanOrEqual(12);
  }
  const sideBySide = lanesSideBySide(viewport);
  let above = seen.frame.top;
  let before = seen.frame.left;
  for (const lane of seen.lanes) {
    // A caption — what the lane is and its numbers — then the drawing, in order.
    expect(lane.captionText).toHaveLength(2);
    expect(
      lane.captionText.every((text) => text.length > 0),
      lane.name,
    ).toBe(true);
    expect(lane.captionFontSize, lane.name).toBeGreaterThanOrEqual(12);
    expect(lane.svg.top, lane.name).toBeGreaterThanOrEqual(lane.caption.bottom - 1);
    expect(lane.caption.left, lane.name).toBeGreaterThanOrEqual(seen.frame.left);
    expect(lane.caption.right, lane.name).toBeLessThanOrEqual(seen.frame.right);
    expect(lane.caption.top, lane.name).toBeGreaterThanOrEqual(seen.frame.top);
    expect(lane.svg.width, lane.name).toBeGreaterThan(120);
    if (sideBySide) {
      // Side by side, left to right, none over another, and every drawing the
      // same height on one line — whatever a caption wraps to.
      expect(lane.box.left, lane.name).toBeGreaterThanOrEqual(before - 1);
      expect(
        Math.abs(lane.svg.bottom - (seen.lanes[0]?.svg.bottom ?? 0)),
        lane.name,
      ).toBeLessThanOrEqual(1);
      // 4rem where the fold is the owner's tablet's (three columns), 5rem at 1024.
      expect(
        Math.abs(lane.svg.height - (viewport.width >= 1216 ? 4 : 5) * seen.rem),
        lane.name,
      ).toBeLessThanOrEqual(1);
      before = lane.box.right;
    } else {
      // Stacked: one above another, each its own height, sharing a left edge.
      expect(lane.caption.top, lane.name).toBeGreaterThanOrEqual(above - 1);
      expect(
        Math.abs(lane.svg.height - (LANE_REM[lane.name] ?? 0) * seen.rem),
        lane.name,
      ).toBeLessThanOrEqual(1);
      expect(
        Math.abs(lane.svg.left - (seen.lanes[0]?.svg.left ?? 0)),
        lane.name,
      ).toBeLessThanOrEqual(0.5);
      above = lane.svg.bottom;
    }
    for (const mark of lane.marks) {
      expect(mark.box.left, mark.name).toBeGreaterThanOrEqual(lane.svg.left - 2);
      expect(mark.box.right, mark.name).toBeLessThanOrEqual(lane.svg.right + 2);
      expect(mark.box.top, mark.name).toBeGreaterThanOrEqual(lane.svg.top - 2);
      expect(mark.box.bottom, mark.name).toBeLessThanOrEqual(lane.svg.bottom + 2);
    }
    for (const chip of lane.chips) {
      expect(chip.fontSize, chip.text).toBeGreaterThanOrEqual(12);
      // In the gutter LEFT of the drawing: a number never covers a mark.
      expect(chip.box.left, chip.text).toBeGreaterThanOrEqual(lane.well.left - 1);
      expect(chip.box.right, chip.text).toBeLessThanOrEqual(lane.svg.left);
      expect(chip.box.top, chip.text).toBeGreaterThanOrEqual(lane.caption.bottom - 1);
      expect(chip.box.bottom, chip.text).toBeLessThanOrEqual(seen.frame.bottom);
    }
    expect(lane.svg.bottom, lane.name).toBeLessThanOrEqual(seen.frame.bottom);
  }
  if (sideBySide) {
    expect(before).toBeLessThanOrEqual(seen.frame.right + 1);
  } else {
    // Upright: under the trainer group, in its column, below *End workout*.
    expect(seen.frame.left).toBeGreaterThanOrEqual(seen.trainer.left - 1);
    expect(seen.frame.right).toBeLessThanOrEqual(seen.trainer.right + 1);
    expect(seen.frame.top).toBeGreaterThanOrEqual(seen.trainerContentBottom - 1);
    expect(seen.frame.top).toBeGreaterThanOrEqual(seen.end.bottom);
    // DIRECTLY under it — its last margin and the grid’s gap, 40 px — and not pushed
    // down the column by the taller Live group beside them.
    expect(seen.frame.top - seen.trainerContentBottom).toBeLessThanOrEqual(3 * seen.rem);
  }
}

const laneOf = (seen: GraphSeen, name: string): GraphLane => {
  const lane = seen.lanes.find((each) => each.name === name);
  if (lane === undefined) {
    throw new Error(`no ${name} lane — drew: ${seen.lanes.map((each) => each.name).join(', ')}`);
  }
  return lane;
};

const markOf = (lane: GraphLane, name: string): GraphBox => {
  const found = lane.marks.find((each) => each.name === name);
  if (found === undefined) {
    throw new Error(
      `no ${name} in the ${lane.name} lane — drew: ${lane.marks.map((each) => each.name).join(', ')}`,
    );
  }
  return found.box;
};

const namesOf = (lane: GraphLane): readonly string[] => lane.marks.map((each) => each.name);

async function openGraph(page: Page, viewport: Viewport, state: string): Promise<GraphSeen> {
  await open(page, viewport, `?workout=${state}`);
  const seen = await graphOnTheRideScreen(page);
  if (seen === undefined) {
    throw new Error(`the Ride screen drew no workout graph for ?workout=${state}`);
  }
  return seen;
}

for (const viewport of EASED_VIEWPORTS) {
  test(`the running workout’s graph is drawn, each lane with its numbers — #1307 — ${viewport.name}`, async ({
    page,
  }) => {
    const seen = await openGraph(page, viewport, 'running');
    expectGraphLaidOut(seen, viewport);
    expect(seen.name).toContain('Target the trainer last confirmed: 225 W.');
    // Two lanes outside a hold, each with its numbers.
    expect(seen.lanes.map((each) => each.name)).toEqual(['plan', 'trace']);
    expect(laneOf(seen, 'plan').captionText).toEqual(['Whole workout', '5:12 of 12:00']);
    expect(laneOf(seen, 'trace').captionText[0]).toBe('Last 5 minutes');
    expect(laneOf(seen, 'trace').captionText[1]).toMatch(/^Target 225 W · You \d+ W$/);
    // Nothing needs explaining, so nothing is said under the graph.
    expect(seen.key).toBeUndefined();
    // Drawn: the plan ridden and to come, now, the target and the power.
    const plan = laneOf(seen, 'plan');
    const trace = laneOf(seen, 'trace');
    expect(markOf(plan, 'oyl-workout-graph__done').height).toBeGreaterThan(2);
    expect(markOf(plan, 'oyl-workout-graph__now').height).toBeGreaterThan(2);
    expect(markOf(trace, 'oyl-workout-graph__target').height).toBeGreaterThan(2);
    expect(markOf(trace, 'oyl-workout-graph__power').height).toBeGreaterThan(2);
    // ⚠️ The plan's bars use the lane: this workout's only target is 90 % of
    // threshold, and it is drawn 85 % of the lane tall — not 72 %, which is
    // what the block chart's fixed 125 % scale made of it.
    expect(markOf(plan, 'oyl-workout-graph__done').height / plan.svg.height).toBeGreaterThan(0.8);
    // No unexplained mark: the threshold rule is not drawn, and nothing is held instead.
    expect(namesOf(plan)).not.toContain('oyl-block-chart__rule');
    expect(namesOf(plan).filter((name) => /asked|held/.test(name))).toEqual([]);
    // The scale's two ends are written beside the last lane, top above bottom.
    expect(trace.chips.map((chip) => chip.text)).toEqual(['280 W', '170 W']);
    expect(trace.chips[0]?.box.bottom ?? 0).toBeLessThan(trace.chips[1]?.box.top ?? 0);
    console.log(
      `#1307 the workout graph — ${viewport.name}: ${seen.frame.width.toFixed(1)} × ${seen.frame.height.toFixed(1)} px at y = ${seen.frame.top.toFixed(1)}`,
    );
  });
}

/**
 * The ruling: on the owner's tablet the whole graph is on screen, without
 * scrolling — in the states whose notice used to push it under the fold, and
 * in the four the third review added.
 *
 * ⚠️ **At `TABLET_IN_THE_SHELL`, not at a bare 1280×800.** This file's header
 * records the device: 1280×800 with the system bars OVER the page, so the
 * fold is `height − bottom inset`, 768. The fourth pass asserted this at the
 * bare viewport, where the eased state passed with its sentence 8 px under
 * the system bar and the raised one 28 px.
 */
const LANDSCAPE_STATES = [
  'running',
  'holding',
  'hold',
  'eased',
  'raised',
  'paused',
  'paused-hold',
  'refused',
  'lost',
] as const;

for (const state of LANDSCAPE_STATES) {
  test(`the whole graph is on screen without scrolling — #1307 — ?workout=${state} — ${TABLET_IN_THE_SHELL.name}`, async ({
    page,
  }) => {
    const viewport = TABLET_IN_THE_SHELL;
    const insets = insetsOf(viewport);
    const fold = viewport.height - insets.bottom;
    const seen = await openGraph(page, viewport, state);
    expect(seen.scrollY).toBe(0);
    expect(seen.viewportHeight).toBe(viewport.height);
    // The apparatus: this IS the device's fold, not the window's edge.
    expect(fold).toBe(768);
    // ⚠️ The GROUP: the frame, every lane in it, and the sentence beside it.
    expect(seen.group.top).toBeGreaterThanOrEqual(insets.top);
    expect(seen.group.bottom).toBeLessThanOrEqual(fold);
    if (seen.key !== undefined) {
      expect(seen.key.bottom).toBeLessThanOrEqual(fold);
    }
    for (const lane of seen.lanes) {
      expect(lane.svg.bottom, lane.name).toBeLessThanOrEqual(fold);
      if (seen.key === undefined) {
        // Every caption on ONE line — in a hold too, where there are three.
        // (Beside a sentence the lanes are narrower and a long caption wraps.)
        expect(lane.caption.height, `${lane.name} caption`).toBeLessThanOrEqual(
          1.7 * lane.captionFontSize,
        );
      }
    }
    // Larger than it was in the trainer's 360 px column.
    expect(seen.group.width).toBeGreaterThan(700);
    // Under the readings: from the Live group's left edge, under all of it,
    // ending left of the trainer group — and over nothing.
    expect(Math.abs(seen.group.left - seen.live.left)).toBeLessThanOrEqual(1);
    expect(seen.group.right).toBeLessThanOrEqual(seen.trainer.left);
    expect(seen.group.top).toBeGreaterThanOrEqual(seen.liveContentBottom);
    expect(seen.overText).toEqual([]);
    console.log(
      `#1307 the graph on screen — ?workout=${state} — ${viewport.name}: y = ${seen.group.top.toFixed(1)} to ${seen.group.bottom.toFixed(1)}, ${(fold - seen.group.bottom).toFixed(1)} px clear of the fold at ${String(fold)}`,
    );
  });
}

/**
 * The same states at the 4:3 shell size this suite assumes (1024×720, fold
 * 688): published, not asserted. Under the fold there is accepted — the
 * owner's ruling is for 1280×800 — and this is here so that what "under the
 * fold" means there is a number in every run and not a guess.
 */
test(`where the graph is at the 4:3 shell size, state by state — #1307 — ${SMALL_TABLET_IN_THE_SHELL.name}`, async ({
  page,
}) => {
  const viewport = SMALL_TABLET_IN_THE_SHELL;
  const fold = viewport.height - insetsOf(viewport).bottom;
  for (const state of LANDSCAPE_STATES) {
    const seen = await openGraph(page, viewport, state);
    // In the flow and over nothing, here as everywhere.
    expect(seen.overText).toEqual([]);
    expect(seen.position).toBe('static');
    console.log(
      `#1307 the graph at the 4:3 shell — ?workout=${state}: y = ${seen.group.top.toFixed(1)} to ${seen.group.bottom.toFixed(1)}, fold at ${String(fold)}: ${seen.group.top >= fold ? 'wholly under the fold' : `${(fold - seen.group.top).toFixed(1)} px of it on screen`}`,
    );
  }
});

/**
 * 1024×768: two columns, and no room on screen for the graph once a notice
 * stands. It is under both groups, in the flow, and may be under the fold.
 * What is held is that it lies over nothing, and that it can be scrolled to.
 */
for (const state of LANDSCAPE_STATES) {
  test(`the graph lies over no text, and the page scrolls to it — #1307 — ?workout=${state} — ${SMALL_TABLET.name}`, async ({
    page,
  }) => {
    const viewport = SMALL_TABLET;
    const seen = await openGraph(page, viewport, state);
    expect(seen.scrollY).toBe(0);
    // ⚠️ No control, no notice, no sentence, no heading, no reading.
    expect(seen.overText).toEqual([]);
    // Under BOTH groups — below the last thing either of them says — and
    // across both columns.
    expect(seen.group.top).toBeGreaterThanOrEqual(seen.liveContentBottom);
    expect(seen.group.top).toBeGreaterThanOrEqual(seen.trainerContentBottom);
    expect(Math.abs(seen.group.left - seen.live.left)).toBeLessThanOrEqual(1);
    expect(Math.abs(seen.group.right - seen.trainer.right)).toBeLessThanOrEqual(1);
    expect(seen.group.width).toBeGreaterThan(700);
    // The page scrolls to it: brought to the foot of the screen, all of it is on screen…
    const scrolled = await page.evaluate(() => {
      const group = document.querySelector('.oyl-ride__group--graph');
      group?.scrollIntoView({ block: 'end' });
      const rect = group?.getBoundingClientRect();
      return { top: rect?.top ?? -1, bottom: rect?.bottom ?? Infinity, scrollY: window.scrollY };
    });
    expect(scrolled.top).toBeGreaterThanOrEqual(0);
    expect(scrolled.bottom).toBeLessThanOrEqual(viewport.height + SUBPIXEL_TOLERANCE);
    // …and, scrolled, it still lies over nothing.
    expect((await graphOnTheRideScreen(page))?.overText).toEqual([]);
    console.log(
      `#1307 the graph in the flow — ?workout=${state} — ${viewport.name}: y = ${seen.group.top.toFixed(1)} to ${seen.group.bottom.toFixed(1)} of ${String(viewport.height)} (${seen.group.bottom > viewport.height ? `${(seen.group.bottom - viewport.height).toFixed(1)} px under the fold` : 'on screen'}); scrolled ${scrolled.scrollY.toFixed(0)} px to bring it on`,
    );
  });
}

/** The states, one by one, at the owner's tablet both ways up. */
const GRAPH_STATE_VIEWPORTS: readonly Viewport[] = [
  TABLET_IN_THE_SHELL,
  TABLET_UPRIGHT_IN_THE_SHELL,
];

for (const viewport of GRAPH_STATE_VIEWPORTS) {
  test.describe(`the running workout’s graph, state by state — #1307 — ${viewport.name}`, () => {
    test('a trainer eased to 0 W: the plan’s height stays drawn, and 0 W is not on the lane’s bottom line', async ({
      page,
    }) => {
      const seen = await openGraph(page, viewport, 'eased');
      expectGraphLaidOut(seen, viewport);
      const plan = laneOf(seen, 'plan');
      const trace = laneOf(seen, 'trace');
      // What the plan asks for the rest of the block: an outline, at the
      // height of the part already ridden, from now to the end.
      const asked = markOf(plan, 'oyl-workout-graph__asked');
      const done = markOf(plan, 'oyl-workout-graph__done');
      const now = markOf(plan, 'oyl-workout-graph__now');
      expect(asked.height).toBeGreaterThan(plan.svg.height * 0.8);
      expect(Math.abs(asked.top - done.top)).toBeLessThanOrEqual(1.5);
      expect(asked.left).toBeGreaterThanOrEqual((now.left + now.right) / 2 - 2);
      expect(asked.right).toBeGreaterThan(plan.svg.right - 3);
      // At 0 W there is no step to shade.
      expect(namesOf(plan).filter((name) => name.includes('held'))).toEqual([]);
      // The 0 W target is a step with a height, its edge clear of the lane's bottom line.
      const edge = markOf(trace, 'oyl-workout-graph__target-edge');
      expect(trace.well.bottom - edge.bottom).toBeGreaterThanOrEqual(4);
      expect(markOf(trace, 'oyl-workout-graph__target').height).toBeGreaterThanOrEqual(4);
      expect(trace.captionText[1]).toMatch(/^Target 0 W \(plan asks 225 W\) · You \d+ W$/);
      expect(trace.chips.at(-1)?.text).toBe('0 W');
      // The one sentence under the graph, and nothing else.
      expect(seen.keyText).toBe(
        'At the line, the dashed outline is what the plan asks for now, 225\u00a0W. The trainer confirmed 0\u00a0W instead, so nothing is shaded.',
      );
    });

    test('a target raised to the trainer’s minimum: what it holds, shaded, over what the plan asks, outlined — and the blocks to come as planned', async ({
      page,
    }) => {
      const seen = await openGraph(page, viewport, 'raised');
      expectGraphLaidOut(seen, viewport);
      const plan = laneOf(seen, 'plan');
      const asked = markOf(plan, 'oyl-workout-graph__asked');
      const held = markOf(plan, 'oyl-workout-graph__held');
      const edge = markOf(plan, 'oyl-workout-graph__held-edge');
      // 100 W held where 75 W is asked: the shaded step is the taller, over the same stretch.
      expect(held.height).toBeGreaterThan(asked.height + 2);
      expect(Math.abs(held.left - asked.left)).toBeLessThanOrEqual(2);
      expect(Math.abs(held.right - asked.right)).toBeLessThanOrEqual(2);
      expect(Math.abs(edge.top - held.top)).toBeLessThanOrEqual(2);
      // The block still to come is filled, as the plan asks, to the lane's end,
      // and taller than either: 60 % against 30 %.
      const toCome = plan.marks.filter((mark) => mark.name.startsWith('oyl-block-chart__band-'));
      expect(toCome).toHaveLength(1);
      expect(toCome[0]?.box.left ?? 0).toBeGreaterThanOrEqual(asked.right - 2);
      expect(toCome[0]?.box.right ?? 0).toBeGreaterThan(plan.svg.right - 3);
      expect(toCome[0]?.box.height ?? 0).toBeGreaterThan(held.height + 4);
      expect(laneOf(seen, 'trace').captionText[1]).toMatch(
        /^Target 100 W \(plan asks 75 W\) · You \d+ W$/,
      );
      expect(seen.name).toContain(
        'Target the trainer last confirmed: 100 W, where the plan asks for 75 W.',
      );
      expect(seen.keyText).toBe(
        'At the line, the dashed outline is what the plan asks for now, 75\u00a0W. The shaded step is what the trainer confirmed instead, 100\u00a0W.',
      );
    });

    test('a target that steps: the steps use the lane, and the plan shows every interval', async ({
      page,
    }) => {
      const seen = await openGraph(page, viewport, 'stepped');
      expectGraphLaidOut(seen, viewport);
      const trace = laneOf(seen, 'trace');
      // 138 W and 263 W inside the window: the target's edge spans most of the lane.
      const edge = markOf(trace, 'oyl-workout-graph__target-edge');
      expect(edge.height / trace.svg.height).toBeGreaterThan(0.5);
      expect(edge.width).toBeGreaterThan(trace.svg.width * 0.95);
      expect(markOf(trace, 'oyl-workout-graph__power').height / trace.svg.height).toBeGreaterThan(
        0.5,
      );
      expect(trace.captionText[1]).toMatch(/^Target 263 W · You \d+ W$/);
      const [top, bottom] = trace.chips.map((chip) => Number.parseInt(chip.text, 10));
      expect(top ?? 0).toBeGreaterThanOrEqual(263);
      expect(bottom ?? Infinity).toBeLessThanOrEqual(138);
      expect(bottom ?? 0).toBeGreaterThan(90);
      // An ordinary block: nothing is marked as held instead, and nothing is said.
      const plan = laneOf(seen, 'plan');
      expect(namesOf(plan).filter((name) => /asked|held/.test(name))).toEqual([]);
      expect(seen.name).not.toContain('asks for');
      expect(seen.key).toBeUndefined();
      // The hardest interval is 85 % of the lane.
      const bands = plan.marks.filter((mark) => mark.name.startsWith('oyl-block-chart__band-'));
      expect(Math.max(...bands.map((mark) => mark.box.height)) / plan.svg.height).toBeGreaterThan(
        0.8,
      );
    });

    test('a heart-rate hold that is running: three lanes, heart rate against its range — and the hold’s own target is NOT marked as held instead', async ({
      page,
    }) => {
      const seen = await openGraph(page, viewport, 'holding');
      expectGraphLaidOut(seen, viewport);
      expect(seen.lanes.map((each) => each.name)).toEqual(['plan', 'heart-rate', 'trace']);
      const lane = laneOf(seen, 'heart-rate');
      const band = markOf(lane, 'oyl-workout-graph__range');
      const line = markOf(lane, 'oyl-workout-graph__heart-rate');
      // The band is a band, not a hairline, and the line moves through it.
      expect(band.height).toBeGreaterThanOrEqual(12);
      expect(band.width).toBeGreaterThan(lane.svg.width * 0.95);
      expect(line.height).toBeGreaterThan(band.height);
      expect(markOf(lane, 'oyl-workout-graph__range-edge').height).toBeGreaterThanOrEqual(12);
      expect(lane.captionText[0]).toBe('Heart rate');
      expect(lane.captionText[1]).toMatch(/^1[34]\d bpm$/);
      // The range's two edges, in bpm, each written beside its own edge of the band.
      expect(lane.chips.map((chip) => chip.text)).toEqual(['140', '130']);
      const middleOf = (chip: { readonly box: GraphBox } | undefined): number =>
        ((chip?.box.top ?? 0) + (chip?.box.bottom ?? 0)) / 2;
      expect(Math.abs(middleOf(lane.chips[0]) - band.top)).toBeLessThanOrEqual(2);
      expect(Math.abs(middleOf(lane.chips[1]) - band.bottom)).toBeLessThanOrEqual(2);
      expect(seen.name).toMatch(/Heart rate: 1[34]\d bpm, with a chosen range of 130–140 bpm\./);
      // The target the hold set, easing in the lane underneath.
      expect(
        markOf(laneOf(seen, 'trace'), 'oyl-workout-graph__target-edge').height,
      ).toBeGreaterThan(4);
      // ⚠️ The owner's ruling. The hold holds 119 W where the block started at
      // 125 W: that is the workout doing what it was asked. No dashed outline,
      // no shaded step, no "(plan asks …)", no clause in the name, no sentence.
      expect(namesOf(laneOf(seen, 'plan')).filter((name) => /asked|held/.test(name))).toEqual([]);
      expect(laneOf(seen, 'trace').captionText[1]).toMatch(/^Target 119 W · You \d+ W$/);
      expect(seen.name).toContain('Target the trainer last confirmed: 119 W.');
      expect(seen.name).not.toContain('asks for');
      expect(seen.key).toBeUndefined();
    });

    test('paused: the caption says what the trainer holds NOW, as the panel does, and nothing is marked', async ({
      page,
    }) => {
      const seen = await openGraph(page, viewport, 'paused');
      expectGraphLaidOut(seen, viewport);
      // The panel's own sentence, and the graph's caption: one number.
      expect(seen.trainerText).toContain('Holding 50 W.');
      expect(laneOf(seen, 'trace').captionText[1]).toBe('Paused · Target 50 W · You 0 W');
      // ⚠️ Not the newest sample's 225 W, which is what is still DRAWN.
      expect(seen.groupText).not.toContain('225');
      expect(markOf(laneOf(seen, 'trace'), 'oyl-workout-graph__target').height).toBeGreaterThan(2);
      expect(seen.name).toContain('Workout graph. Paused.');
      expect(seen.name).toContain('Target the trainer last confirmed: 50 W.');
      expect(seen.name).not.toContain('asks for');
      expect(namesOf(laneOf(seen, 'plan')).filter((name) => /asked|held/.test(name))).toEqual([]);
      expect(seen.key).toBeUndefined();
    });

    test('paused inside a heart-rate hold: the same, with the heart rate now', async ({ page }) => {
      const seen = await openGraph(page, viewport, 'paused-hold');
      expectGraphLaidOut(seen, viewport);
      expect(seen.lanes.map((each) => each.name)).toEqual(['plan', 'heart-rate', 'trace']);
      expect(seen.trainerText).toContain('Holding 50 W.');
      expect(laneOf(seen, 'trace').captionText[1]).toBe('Paused · Target 50 W · You 0 W');
      expect(laneOf(seen, 'heart-rate').captionText[1]).toBe('124 bpm');
      expect(seen.name).not.toContain('asks for');
      expect(namesOf(laneOf(seen, 'plan')).filter((name) => /asked|held/.test(name))).toEqual([]);
      expect(seen.key).toBeUndefined();
    });

    test('a block whose target was not sent: outlined at what the plan asks, nothing shaded, and said so', async ({
      page,
    }) => {
      const seen = await openGraph(page, viewport, 'refused');
      expectGraphLaidOut(seen, viewport);
      // The panel's own sentence for it (#1305).
      expect(seen.trainerText).toContain('so no target was sent for it');
      const plan = laneOf(seen, 'plan');
      expect(markOf(plan, 'oyl-workout-graph__asked').height).toBeGreaterThan(4);
      expect(namesOf(plan).filter((name) => name.includes('held'))).toEqual([]);
      // No confirmed target anywhere in the last lane either: only the power.
      const trace = laneOf(seen, 'trace');
      expect(namesOf(trace).filter((name) => name.includes('target'))).toEqual([]);
      expect(markOf(trace, 'oyl-workout-graph__power').width).toBeGreaterThan(10);
      expect(trace.captionText[1]).toMatch(/^No target sent \(plan asks 75 W\) · You \d+ W$/);
      expect(seen.name).toContain('No target was sent for this block, which asks for 75 W.');
      expect(seen.name).not.toContain('confirmed');
      expect(seen.keyText).toBe(
        'At the line, the dashed outline is what the plan asks for now, 75 W. No target was sent for it, so nothing is shaded.',
      );
    });

    test('control lost: no target is stated, nothing is "confirmed instead", and the plan lane is the plan', async ({
      page,
    }) => {
      const seen = await openGraph(page, viewport, 'lost');
      expectGraphLaidOut(seen, viewport);
      // The panel says it can no longer vouch for the number…
      expect(seen.trainerText).toContain('The trainer was last set to 150 W.');
      expect(seen.trainerText).not.toContain('Holding 150 W.');
      // …and the graph states no target: 150 W where the plan asks 250 W is
      // NOT drawn or said as something the trainer confirmed instead.
      expect(laneOf(seen, 'trace').captionText[1]).toMatch(/^No target · You \d+ W$/);
      const plan = laneOf(seen, 'plan');
      expect(namesOf(plan).filter((name) => /asked|held/.test(name))).toEqual([]);
      expect(
        plan.marks.filter((mark) => mark.name.startsWith('oyl-block-chart__band-')).length,
      ).toBe(1);
      expect(seen.key).toBeUndefined();
      expect(seen.name).toContain('Target the trainer last confirmed: 150 W.');
      expect(seen.name).not.toContain('asks for');
    });
  });
}

test('the running workout’s graph in the dark theme: the frame, the numbers and the marks are the dark palette’s — #1307', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  const seen = await openGraph(page, TABLET, 'holding');
  expect(seen.theme).toBe('dark');
  expectGraphLaidOut(seen, TABLET);
  // `tokens.ts` §DARK_COLOUR_TOKENS: surface, ink, inkMuted, accent, surfaceRaised.
  const SURFACE = 'rgb(25, 32, 31)';
  const INK = 'rgb(228, 235, 233)';
  const INK_MUTED = 'rgb(169, 183, 181)';
  expect(seen.frameBackground).toBe(SURFACE);
  expect(seen.readingColour).toBe(INK);
  const paints = new Map(
    seen.lanes.flatMap((lane) => lane.marks.map((mark) => [mark.name, mark.paint] as const)),
  );
  expect(paints.get('oyl-workout-graph__now')).toBe(INK);
  expect(paints.get('oyl-workout-graph__heart-rate')).toBe(INK);
  expect(paints.get('oyl-workout-graph__target-edge')).toBe(INK);
  expect(paints.get('oyl-workout-graph__range-edge')).toBe(INK_MUTED);
  expect(paints.get('oyl-workout-graph__done')).toBe(INK_MUTED);
  expect(paints.get('oyl-workout-graph__power')).toBe('rgb(108, 201, 189)');
  expect(paints.get('oyl-workout-graph__range')).toBe('rgb(34, 42, 41)');
  for (const chip of seen.lanes.flatMap((lane) => lane.chips)) {
    expect(chip.colour, chip.text).toBe(INK_MUTED);
  }
});
