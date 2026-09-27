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
import type { RideViewControl, RideViewMeasurement } from './rideview-harness';

/** Sub-pixel layout, not slack. @see ride.browser.spec.ts */
const SUBPIXEL_TOLERANCE = 1;

/** `theme.css` §`--oyl-color-surface-raised`, as `getComputedStyle` spells it. */
const UNSTYLED = 'rgba(0, 0, 0, 0)';

/** The control the owner could not see. @see rideview-harness.tsx §WORKOUT */
const STARTS_A_WORKOUT = 'Ride Sweet spot, three by twelve';

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
      expect(seen.controls.filter((each) => each.group === 'sensors').length).toBeGreaterThan(3);
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
      expect(pairing.length).toBeGreaterThan(3);
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

      expect(seen.controls.length).toBeGreaterThan(8);
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
 *     controls will spend.
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
 * no control" was partly true by construction. The upright tablet is the one
 * layout where they share a column with the notice, so it is measured too.
 *
 * ⚠️ **What that measured, said plainly.** Upright, the live group stacks
 * ABOVE the trainer group, and the notice is the last control-bearing thing
 * in the page — so there too nothing that can move sits below it, and "moves
 * no control" holds by the ORDER. What the case guards is that order: putting
 * *End workout* back after the notice (as #585 shipped it) turns it red here
 * as at the landscape sizes, and the fold case with it. The upright notice's
 * margin to the fold is the smallest of the five, and its figure is the one
 * #669's larger controls will spend: *Pause* / *Stop* and *End workout* sit
 * above it in the same column, about 4 px each at 48 px, while #669 leaves
 * the disclosure's summary alone. Published, not bounded beyond the floor —
 * #669 is not merged, and a bound on a projection is a bound on a guess.
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

      // #605's re-review. Upright, the ERG line — the target sentence and the
      // refusal after it — sits above the notice in the same column, so every
      // line it wraps to is a line off the notice's margin. It is held to ONE.
      // `controller.ts` §`MANUAL_ERG_DURING_WORKOUT` says why it is as short as
      // it is: the reviewer's longer wording wraps on the runner's fonts.
      if (viewport.height > viewport.width) {
        const erg = await page.evaluate(() => {
          const line = document.querySelector('.oyl-trainer__erg');
          if (line === null) return undefined;
          return {
            height: line.getBoundingClientRect().height,
            lineHeight: Number.parseFloat(window.getComputedStyle(line).lineHeight),
            text: (line.textContent ?? '').replace(/\s+/g, ' '),
          };
        });
        expect(erg?.text).toBe(
          'ERG, optional: Holding 250 W. End the workout to set a target by hand.',
        );
        expect(
          erg?.height ?? Infinity,
          `the ERG line wraps: ${String(erg?.height)} px`,
        ).toBeLessThan(1.5 * (erg?.lineHeight ?? 0));
      }
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
 * sentence); every ride control is still on the screen; and at every tablet
 * BOTH the notice's own bottom and *Pause* / *Stop* clear
 * {@link FOLD_MARGIN_PIXELS} — landscape, every ride control does — as
 * shipped AND with every live and trainer button held to 48 px: #669's larger
 * controls, which are not merged, applied in the harness as a what-if rather
 * than argued from a margin.
 *
 * ⚠️ **The notice's floor is §4f's 50 px and it was 0 until #693's review**,
 * and a reviewer who remembers the notice being "bounded only by being on the
 * screen" is reading the old file. Under *Pause* / *Stop* — where the pull
 * request first put it — it ended 15.7 px above the fold on the owner's tablet
 * in the shell and 3.7 px at 1024×720, so the safety sentence #647 exists to
 * show was unproven on the owner's own tablet by §4f's own rule.
 *
 * Upright, the live group is stacked over the trainer's, and the lowest ride
 * control is the workout chooser: there the floor is held on *Pause* /
 * *Stop* and on the notice, and the chooser's margin is published and held to
 * be on the screen. Beside the heading the notice is one line upright and
 * costs the chooser its height less the heading's; #692 is the room a
 * standing notice needs there, and #669's 48 px alone spend most of what main
 * leaves it.
 *
 * ⚠️ **Two controls, and they fail for different reasons.** Put back UNDER
 * *Pause* / *Stop* — the review's finding — the notice's own margin must fall
 * under the floor at the in-shell tablets; moved ABOVE them, where
 * `notificationNotice` sits, *Pause* must. Without the first, a green run could
 * be a layout where the heading did nothing; without the second, one where the
 * notice was never measured against the controls at all.
 */
const KEEP_ALIVE_FAILED = '?keepalive=failed';
const KEEP_SCREEN_ON_TEXT = '!Keep the screen on: your ride may stop if the screen goes off.';

for (const viewport of EASED_VIEWPORTS) {
  const upright = viewport.height > viewport.width;
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

    for (const grown of [undefined, 48] as const) {
      const what = grown === undefined ? 'as shipped' : `with #669's ${String(grown)} px controls`;
      test(`the notice${upright ? ', Pause and Stop clear' : ' and every ride control clear'} the fold by a margin — ${what}`, async ({
        page,
      }, testInfo) => {
        await open(page, viewport, KEEP_ALIVE_FAILED);
        if (grown !== undefined) {
          await page.evaluate((pixels) => {
            window.__oylRideView?.growControlsTo(pixels);
          }, grown);
        }
        const seen = await measure(page);

        expect(seen.scrollY).toBe(0);
        const during = seen.controls.filter((each) => each.group !== 'sensors');
        expect(during.map((each) => each.name)).toEqual(expect.arrayContaining(['Pause', 'Stop']));
        if (grown !== undefined) {
          // The what-if took: Pause is the height #669 gives it.
          const pause = during.find((each) => each.name === 'Pause');
          expect(pause?.box.height ?? 0).toBeGreaterThanOrEqual(grown - SUBPIXEL_TOLERANCE);
        }
        // Upright, the controls that END a recording; landscape, every ride
        // control. @see the note above this block
        const held = upright
          ? during.filter((each) => each.name === 'Pause' || each.name === 'Stop')
          : during;
        expect(during.filter((each) => !onScreen(each, viewport)).map(describeControl)).toEqual([]);
        const notice = seen.keepScreenOn;
        expect(notice?.onTop).toBe(true);
        expect((notice?.box.top ?? -1) >= insetsOf(viewport).top).toBe(true);

        const lowestOf = (among: readonly RideViewControl[]): RideViewControl =>
          among.reduce((low, each) => (each.box.bottom > low.box.bottom ? each : low));
        const lowest = lowestOf(during);
        const lowestHeld = lowestOf(held);
        const controlMargin = foldMargin(lowest.box.bottom, viewport);
        const heldMargin = foldMargin(lowestHeld.box.bottom, viewport);
        const noticeMargin = foldMargin(notice?.box.bottom ?? Infinity, viewport);
        const note =
          `${what}: lowest control ${controlMargin.toFixed(1)} px (${describeControl(lowest)}); ` +
          (upright ? `Pause / Stop ${heldMargin.toFixed(1)} px; ` : '') +
          `the notice ${noticeMargin.toFixed(1)} px, ${(notice?.box.height ?? 0).toFixed(0)} px tall ` +
          `— at ${String(viewport.width)}×${String(viewport.height)}`;
        testInfo.annotations.push({
          type: 'keep the screen on, margin to the fold',
          description: note,
        });
        console.log(`keep the screen on, margin to the fold — ${viewport.name} — ${note}`);

        expect(noticeMargin, note).toBeGreaterThanOrEqual(FOLD_MARGIN_PIXELS);
        expect(heldMargin, note).toBeGreaterThanOrEqual(FOLD_MARGIN_PIXELS);
      });
    }

    if (!upright && (viewport.insets !== undefined || viewport.height === 720)) {
      test('the control — under Pause and Stop, the notice itself falls under the floor', async ({
        page,
      }, testInfo) => {
        await open(page, viewport, KEEP_ALIVE_FAILED);
        const before = await measure(page);
        await page.evaluate(() => {
          window.__oylRideView?.noticeUnderControls();
        });
        const after = await measure(page);
        const noticeAt = (seen: RideViewMeasurement): number =>
          foldMargin(seen.keepScreenOn?.box.bottom ?? Infinity, viewport);
        const note = `the notice ${noticeAt(before).toFixed(1)} px → ${noticeAt(after).toFixed(1)} px`;
        testInfo.annotations.push({ type: 'control, notice under Pause', description: note });
        console.log(`keep the screen on, notice under Pause — ${viewport.name} — ${note}`);
        expect(noticeAt(before)).toBeGreaterThanOrEqual(FOLD_MARGIN_PIXELS);
        expect(noticeAt(after)).toBeLessThan(FOLD_MARGIN_PIXELS);
      });

      test('the control — above Pause and Stop, the notice puts them under the floor', async ({
        page,
      }, testInfo) => {
        await open(page, viewport, KEEP_ALIVE_FAILED);
        const before = await measure(page);
        await page.evaluate(() => {
          window.__oylRideView?.noticeAboveControls();
        });
        const after = await measure(page);
        const pauseAt = (seen: RideViewMeasurement): number =>
          seen.controls.find((each) => each.name === 'Pause')?.box.bottom ?? -Infinity;
        const margin = foldMargin(pauseAt(after), viewport);
        const note = `Pause ${foldMargin(pauseAt(before), viewport).toFixed(1)} px → ${margin.toFixed(1)} px`;
        testInfo.annotations.push({ type: 'control, notice above Pause', description: note });
        console.log(`keep the screen on, notice above Pause — ${viewport.name} — ${note}`);
        expect(foldMargin(pauseAt(before), viewport)).toBeGreaterThanOrEqual(FOLD_MARGIN_PIXELS);
        expect(margin).toBeLessThan(FOLD_MARGIN_PIXELS);
      });
    }
  });
}
