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
 * jsdom performs no layout (CLAUDE.md §4e): a control in the document and a
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

import { expect, test, type Page } from '@playwright/test';

import {
  applyInsets,
  NO_INSETS,
  PIXEL_TABLET_LANDSCAPE_INSETS,
  PIXEL_TABLET_PORTRAIT_INSETS_ASSUMED,
  resolvedInsets,
  type Insets,
} from './insets';
import type { RideViewControl, RideViewMeasurement, RideViewNotice } from './rideview-harness';

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
    test('the harness rendered the screen at its fullest', async ({ page }) => {
      await open(page, viewport);
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

    test('is not held to the prose reading measure', async ({ page }) => {
      await open(page, viewport);
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
    test('every ride control is on screen with no scrolling', async ({ page }) => {
      await open(page, viewport);
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
      page,
    }, testInfo) => {
      await open(page, viewport);
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

    test('the title and its one-line summary share a row', async ({ page }) => {
      // 40.8 px of the budget above. Stacked, they spend a line of the fold on
      // a sentence that fits beside the heading; the control below requires
      // them to be stacked again under the prose measure, so this is not true
      // of a page that simply has no summary.
      await open(page, viewport);
      const { title, summary } = await measure(page);

      expect(title?.height ?? 0).toBeGreaterThan(0);
      expect(summary?.height ?? 0).toBeGreaterThan(0);
      expect(summary?.left ?? 0).toBeGreaterThanOrEqual(title?.right ?? Infinity);
      expect(summary?.top ?? Infinity).toBeLessThan(title?.bottom ?? 0);
      expect(summary?.bottom ?? Infinity).toBeLessThanOrEqual(
        (title?.bottom ?? 0) + SUBPIXEL_TOLERANCE,
      );
    });

    test('the trainer is BESIDE the live metrics, not under them', async ({ page }) => {
      // "Landscape uses the width." The two groups share a top edge and do not
      // share a column.
      await open(page, viewport);
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

      expect(fixed.pageOverflow).toBeGreaterThan(0);
      expect(reverted.pageOverflow).toBe(fixed.pageOverflow);
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
      page,
    }) => {
      await open(page, viewport, EASED);
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
      page,
    }, testInfo) => {
      await open(page, viewport, EASED);
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
];

const EVERY_NOTICE = {
  name: 'every standing notice at once',
  query: '?workout=eased&keepalive=failed&notification=refused&storage=full&side=lost',
  labels: STANDING_NOTICES.flatMap((each) => each.labels),
};

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
        const note =
          `lowest control ${controlMargin.toFixed(1)} px (${describeControl(lowest)}); ` +
          `${standing.map((each) => describeNotice(each, viewport)).join('; ')}; ` +
          `the metric cards end ${metricsMargin.toFixed(1)} px above the fold ` +
          `— at ${String(viewport.width)}×${String(viewport.height)}`;
        testInfo.annotations.push({ type: '#692 margins to the fold', description: note });
        console.log(`#692 — ${state.name} — ${viewport.name} — ${note}`);

        expect(during.filter((each) => !onScreen(each, viewport)).map(describeControl)).toEqual([]);
        expect(controlMargin, note).toBeGreaterThanOrEqual(FOLD_MARGIN_PIXELS);
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

/** Two rows of cards at the small step rather than the medium one, and the gap. */
const CARDS_TIGHTEN_BY_PIXELS = 30;

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
    const heightWith = async (query: string): Promise<number> => {
      await open(page, viewport, query);
      return (await measure(page)).metrics?.height ?? 0;
    };
    const none = await heightWith('');
    const standing = await heightWith('?notification=refused');
    const beside = await heightWith(KEEP_ALIVE_FAILED);
    const note = `the metric cards ${none.toFixed(1)} px tall with no notice, ${standing.toFixed(1)} px with No notification, ${beside.toFixed(1)} px with Keep the screen on`;
    testInfo.annotations.push({ type: '#692 metric cards', description: note });
    console.log(`#692 — the metric cards — ${note}`);

    expect(none, note).toBeGreaterThan(0);
    expect(none - standing, note).toBeGreaterThanOrEqual(CARDS_TIGHTEN_BY_PIXELS);
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
