// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Controls first, detail tucked — #666, measured in the pinned Chromium.
 *
 * Every route in `shell/routes.ts` §`ALL_ROUTES` — imported, never listed here
 * (#142's rule) — is opened in `reflow.html` (the real `AppShell` over
 * `testing/populated-shell.tsx`'s fixtures, #660) and its first control is
 * required to START above the fold: at a phone's 390×844 over both fixtures,
 * and on the owner's tablet in the shell both ways up with the #439 insets and
 * the 50 px margin floor `rideview.browser.spec.ts` §`FOLD_MARGIN_PIXELS`
 * explains.
 *
 * "The fold" is the viewport's height less its bottom safe-area inset, or the
 * top of the navigation bar where one is fixed across the bottom, whichever is
 * higher — `reflow-harness.tsx` §`foldLine`. That is stricter than the issue's
 * `top < innerHeight` by the bar's height, on purpose: a control behind the
 * bar is not one a rider can see.
 *
 * ## And section by section
 *
 * A route whose first control is near the top can still bury every later one
 * under a paragraph — Settings on `main`, 4,377 px tall with its first control
 * above the fold. So every section that tucks its explanation into a "More
 * about" disclosure may lay out at most {@link SECTION_PROSE_BUDGET_PIXELS} of
 * prose between its heading and its own first control. ⚠️ The harness finds a
 * section BY its disclosure, so a section whose explanation was put back and
 * its disclosure deleted used to drop out of the measurement silently (#699's
 * review, B2) — Settings' only guard. {@link TUCKING_SECTIONS} pins which
 * sections tuck, route by route, and the walk fails a pinned one it did not
 * measure.
 *
 * ## Text the owner ruled must stay
 *
 * A consent screen cannot put its control above its consent text: the box
 * says the text was read. So a first control below the fold passes when
 * everything in its way is a heading or is marked `data-oyl-kept-visible`
 * (`design/KeptVisible.tsx`) — and fails the moment one ordinary
 * paragraph is added there — ON THE ROUTES {@link CONSENT_BEFORE_CONTROL}
 * NAMES, and nowhere else. #699's review found the exemption unbounded: with
 * Camera's reorder reverted and the mark added to one intro paragraph, Camera
 * passed "behind kept-visible text only" with its first control at 1,252 px on
 * a 781 px fold. So the set of routes that pass that way is asserted EQUAL to
 * that list over the viewports, and `a11y/kept-visible.a11y.test.tsx` requires
 * every marked sentence to be one its view lists as safety or privacy text.
 * The spec prints which routes pass that way.
 *
 * ## Devices, where a browser can pair
 *
 * The walk's fixture hands Devices a browser with no Bluetooth, which renders
 * no pairing row and so no control to measure (#699's review, N4). The last
 * case of the fold block opens Devices alone with `?bluetooth=available` — a
 * Bluetooth that answers "available" and is never asked to pair — at every
 * viewport. `devices.browser.spec.ts` measures the same state over the real
 * transport at the phone only.
 *
 * ## What counts as in the way
 *
 * `reflow-harness.tsx` §`PROSE_SELECTOR`: text blocks, and since #699's
 * review (N7) tables, figures, pictures, charts, canvases, and a bare `div` or
 * `section` holding text of its own. Not a label or a legend, which name a
 * control, and not a heading.
 *
 * ## The controls
 *
 * - `?disclosures=inline` copies every section's ⓘ panel, drawn, to straight
 *   under its section's heading — the explanation put back where it was
 *   before it was tucked. ⚠️ Until #1031 it copied each "More about"
 *   disclosure, which is gone: every one is a section's ⓘ now. Segments, Settings and Files must then FAIL:
 *   without it, a page that rendered nothing, or a reader that found no
 *   control, would pass. ⚠️ **Camera is not in that list, though #666 names
 *   it**: it tucks nothing. Its first control came above the fold by order —
 *   see {@link MUST_FAIL_INLINE}.
 * - The summary's 44 px row target is measured #316's three ways: the shipped
 *   box, the declaration, and the box with the floor stripped, which must be
 *   shorter than 44 — so the declaration is what holds the target. Since
 *   #1031 that is the Devices screen's disclosure, the one `.oyl-details` row
 *   left; the section ⓘ is measured the same three ways under §"#1013".
 *
 * ## The tab order (#665's deferred cross-check)
 *
 * A link tucked inside a closed `<details>` is pressed for with the real Tab
 * key and must not be reached until its summary is opened; and the sequence
 * real Chromium produces is compared with `a11y/audit.ts` §`tabbableElements`
 * run over the same live DOM, closed and open. This is the first time that
 * model has been held against a browser rather than against itself — and it
 * found one difference, which is not about `<details>`: a browser makes a
 * named radio group ONE tab stop, and the model counted every radio. #698
 * taught the model radio groups, so the whole sequence is compared, and
 * Settings' units group is in it. And one about layout: Chromium gives the content of a CLOSED
 * `<details>` a full-size box — see `reflow-harness.tsx` §`laidOut`.
 *
 * ## What it does NOT prove
 *
 * A real phone's or tablet's fonts, a text size above 100 %, or a screen
 * reader. It prints every route's margin so a near miss is visible.
 */

import { expect, test, type Page } from '@playwright/test';

import { THEMES } from '../src/design/tokens';
import { SCRIPTED_STATUS } from '../src/instance/testing';
import {
  ALL_ROUTES,
  hrefFor,
  routeById,
  type RouteDefinition,
  type RouteId,
} from '../src/shell/routes';

import {
  applyInsets,
  PIXEL_TABLET_LANDSCAPE_INSETS,
  PIXEL_TABLET_PORTRAIT_INSETS_ASSUMED,
  resolvedInsets,
  type Insets,
} from './insets';
import { LIGHT_PHONE_WALKED_BY_CONTROLS_FIRST, reflowFaults, reflowMargin } from './reflow-faults';
import type { ReflowMeasurement } from './reflow-harness';

/** SC 2.5.5 (AAA) — `shell.browser.spec.ts` §`TOUCH_TARGET_PIXELS`. */
const TOUCH_TARGET_PIXELS = 44;

/** `rideview.browser.spec.ts` §`FOLD_MARGIN_PIXELS`, for its reason (#439). */
const FOLD_MARGIN_PIXELS = 50;

interface Viewport {
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly insets?: Insets;
  /** The least a first control must clear the fold by. */
  readonly margin: number;
  /**
   * Which of {@link CONSENT_BEFORE_CONTROL}'s routes are measured to need the
   * exemption here — on a taller screen the consent text can end above the
   * fold, and then the route passes without it. Held exactly, both ways.
   */
  readonly consentBelowFold: readonly RouteId[];
  /**
   * The most lines the route's summary under its `h1` may lay out on — #993.
   * The owner's ruling is ONE line, and it is held at one on the tablet both
   * ways up. A phone is held to two: a sentence a tablet sets on one line is
   * two at 390 px, and a shorter limit would rule out half of what the
   * summaries need to say.
   */
  readonly summaryLines: number;
}

const PHONE: Viewport = {
  name: 'phone 390×844',
  width: 390,
  height: 844,
  margin: 0,
  consentBelowFold: ['side-camera'],
  summaryLines: 2,
};

/** The owner's tablet in the shell, both ways up (#439). */
const TABLETS: readonly Viewport[] = [
  {
    name: 'tablet in the shell 1280×800, insets 36/32',
    width: 1280,
    height: 800,
    insets: PIXEL_TABLET_LANDSCAPE_INSETS,
    margin: FOLD_MARGIN_PIXELS,
    consentBelowFold: ['side-camera'],
    summaryLines: 1,
  },
  {
    name: 'tablet in the shell 800×1280, insets 36/32 (assumed)',
    width: 800,
    height: 1280,
    insets: PIXEL_TABLET_PORTRAIT_INSETS_ASSUMED,
    margin: FOLD_MARGIN_PIXELS,
    // Measured: the side camera's first control clears this fold by 347 px.
    consentBelowFold: [],
    summaryLines: 1,
  },
];

/**
 * The routes #666 names as the ones its control must fail, less one: Camera
 * tucks nothing. Its first control came above the fold by ORDER — the side
 * camera's way in, which asks its own consent on the phone, now comes before
 * this device's consent text, which stays visible whole (ADR 0029) — so a copy
 * with every disclosure put back is the page as shipped, and cannot fail. The
 * before-and-after figure for Camera is in the pull request, read on `main`.
 * Files is here in its place: it is the other route #654 measured by height.
 */
const MUST_FAIL_INLINE = ['segments', 'settings', 'transfer'] as const;

/**
 * The routes whose first control may sit below the fold behind text marked
 * `data-oyl-kept-visible` — and the only ones (#699's review, B1).
 *
 * The side camera's own page asks this phone's consent before it offers
 * anything to press: ADR 0029 D-5 (anyone else in the room) and ADR 0033 (what
 * the phone films, where the pictures go, what a lost link does) are the text
 * the box says was read, so the box cannot come first. Measured on this
 * branch: its first control at y ≈ 1,175 against a fold of 781 on the phone,
 * and ≈ 901 against 768 on the tablet in landscape. A deviation from #666's
 * "first control above the fold on every route", put to the owner in the pull
 * request rather than decided here.
 */
const CONSENT_BEFORE_CONTROL: readonly RouteId[] = ['side-camera'];

/**
 * The routes where kept-visible text is read BEFORE acting and so stands above
 * the first control — #1009, the owner's ruling — and the opening of the text
 * that must stand there. Unlike {@link CONSENT_BEFORE_CONTROL} this is no fold
 * exemption: the first control must still clear the fold. It only lifts #993's
 * "kept-visible text below the controls" for the text named, and REQUIRES that
 * text above the first control, so moving it back below the actions is a
 * fault. Moderation: that every action is logged, names the moderator and
 * outlives an erased account (`views/ModerationView.tsx`
 * §`MODERATION_IS_LOGGED`), which a moderator reads before deciding.
 */
const READ_BEFORE_ACTING: Partial<Record<RouteId, string>> = {
  moderation: 'Everything you do here is written to the instance’s moderation log',
};

/**
 * A safety notice a route may stand above its first control — #1133 — by the
 * opening of its text, with the reason it stands there. Unlike
 * {@link READ_BEFORE_ACTING} it is ALLOWED and never REQUIRED: the notice is
 * drawn only in the state it describes, so a route without it is as right as
 * one with it. It lifts #993's "kept-visible text below the controls" for the
 * text named and nothing else; any other marked text above the first control
 * on the same route is still a fault (`?kept=unrelated`, below).
 */
const SAFETY_NOTICE_ABOVE_CONTROL: Partial<
  Record<RouteId, { readonly opening: string; readonly reason: string }>
> = {
  game: {
    opening: 'Not released',
    reason:
      '#940, #372: the trainer may still hold the last ride’s target, and a rider must ' +
      'see that before starting another, so the notice stands above Ride',
  },
};

/**
 * A kept sentence's text as it is read aloud: without a status message's
 * glyph (`design/StatusMessage.tsx` §`GLYPH`), which is `aria-hidden` and
 * laid out straight against the label — "✕Not released: …".
 */
function spoken(text: string): string {
  return text.replace(/^[i✓!✕](?=\p{Lu})/u, '');
}

/**
 * The sections that tuck their explanation, by heading, route by route —
 * #699's review, B2. The harness measures a section only where it finds the
 * ⓘ beside its heading (a "More about" disclosure until #1031), so a section
 * put back the way it was before #666 — its paragraph above its control and
 * its ⓘ deleted — is simply not measured. Pinning the list turns that into a fault. A route not named here
 * tucks nothing, and a disclosure found on one is a fault too, so a new one
 * is pinned deliberately.
 */
const TUCKING_SECTIONS: Partial<Record<RouteId, readonly string[]>> = {
  // ⚠️ Since #1031 every section's ⓘ is measured, not only the seven Settings,
  // two Segments and one Files sections that closed with a "More about": the
  // ⓘ is the one pattern, so the sections #1013 gave one (Analysis, Camera,
  // the game, the route builder, Routes, Workouts, Files' erase and its
  // file-not-a-connection) are held to the same prose budget and pinned here
  // too, in page order.
  analysis: ['Time in zone', 'Fitness and fatigue', 'Your thresholds', 'Duration personal bests'],
  camera: ['Filming a ride: the side camera', 'A side camera on a tripod'],
  game: ['Ride with others'],
  'route-builder': ['Waypoints'],
  // #1030 (PR #1032): the share note went behind its own ⓘ. #1442: and that
  // section is said beside a chosen route only, which this walk does not choose.
  routes: ['Saved routes', 'Import a route'],
  // #623: 'Your kit' is not here. The walk renders Settings with no kit port,
  // where the owner's ruling of 2026-09-28 leaves the kit control ABSENT and
  // with it the ⓘ that explained the choice.
  // #839: 'Words to mask' tucks what is masked and what masking cannot do
  // behind its ⓘ; where it is kept stays above the form.
  // #992: 'Appearance' tucks what each choice means, and that a device that
  // has not chosen starts dark.
  settings: [
    'Units',
    'Your weight',
    // #2432: what the heart-rate estimate is fitted on, and that a ride with
    // power needs neither input; where they are kept stays above the form.
    'Calorie estimate from heart rate',
    // #1813: what Delivery is and what each of its assists changes.
    'Delivery',
    // #1905: and the lap race's, the same way.
    'Lap race',
    'Menu sounds',
    // #2056: what the music is and that the header's mute silences it.
    'Music',
    'Appearance',
    'Announcements',
    'Sounds',
    // #2079: which panels the ride HUD shows, and that a larger size is drawn on a tablet.
    'Ride HUD',
    // #1433: what the order is for — the zoom keeps the top two.
    'Ride screen readings',
    'Game world',
    // #787: what the draft indicator shows and says, and that it is not the
    // room's own switch.
    'Draft',
    // #2425: what drafting on your own does, and that it is not a room's.
    'Draft on your own',
    'Words to mask',
    'Documents for the analysis',
    // #1237: what the typed goals are not, and why thresholds are checked
    // later; where they are kept stays above the form.
    'Workout goals',
  ],
  segments: ['Make a segment', 'Find your efforts'],
  transfer: ['Import', 'Erase this device', 'Why this is a file and not a connection'],
  workouts: ['Add a block', 'Import a workout'],
};

/**
 * Sections that are drawn only over the POPULATED fixture, so their ⓘ is
 * pinned for that walk alone — #1031. Home's week is an empty state until
 * there is a ride in it, and its ⓘ comes with the week.
 */
const TUCKING_WHEN_POPULATED: Partial<Record<RouteId, readonly string[]>> = {
  home: ['This week'],
  // #912: what the record holds is behind the ⓘ; the screen is a moderator's
  // only over the populated ports. Notices and Appeals tuck nothing: each item
  // is read before it is acted on, so each has one short line and no ⓘ.
  moderation: ['The record'],
  // #2604: Status tucks what Docker Desktop's disk figures are (#2622's review),
  // and is drawn only for the owner, whom only the populated ports are. #2605:
  // what Accounts is for, and what every registration mode shares, are behind
  // each heading's ⓘ. The mode heading names the populated instance's mode,
  // read from its fixture so the two cannot drift. #2607: why a restore is
  // steps rather than a button, and where a one-off snapshot is, are behind
  // Restoring a snapshot's ⓘ. #2611: the AI backend's purpose is behind its ⓘ.
  operate: [
    'Status',
    'Accounts',
    `Registration mode: ${SCRIPTED_STATUS.registration}`,
    'Restoring a snapshot',
    'AI backend',
    // #2612: that only names are shown, never a place or a power, is behind its ⓘ.
    'Rooms',
    // #2613: what the card and the fingerprint are, and what a rotation does, are behind its ⓘ.
    'Instance keys',
    // #2614: that the lines are memory only, and a worker's stay on standard output, is behind its ⓘ.
    'Recent problems',
  ],
  // #1439: what a new write-up does to the ride's saved one is behind the
  // section's ⓘ; the section has a heading only once an instance is
  // connected or a write-up is saved (#1103), which the populated ports are.
  'activity-detail': ['A write-up by your model'],
  // #2007: where a place on the route is and what stays; the editor has
  // sections only over a route it read, which the populated ports hold.
  'route-editor': ['Change part of the route'],
};

async function open(page: Page, viewport: Viewport, query: string): Promise<void> {
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  if (viewport.insets !== undefined) {
    await applyInsets(page, viewport.insets);
  }
  const response = await page.goto(`/reflow.html?${query}`);
  expect(
    response?.status(),
    'reflow.html did not load — is it named in vite.browser.config.ts build.rollupOptions.input?',
  ).toBe(200);
  await page.waitForFunction(() => window.__oylReflow !== undefined);
  expect(await page.evaluate(() => window.__oylReflow?.errors)).toEqual([]);
  expect(await page.evaluate(() => window.__oylReflow?.ready)).toBe(true);
  if (viewport.insets !== undefined) {
    // The insets must be the ones the page resolved, or this measured nothing.
    expect(await resolvedInsets(page)).toEqual(viewport.insets);
  }
}

async function hashFor(page: Page, route: RouteDefinition): Promise<string> {
  if (!route.path.split('/').some((segment) => segment.startsWith(':'))) {
    return hrefFor(route);
  }
  const parameter = await page.evaluate((id) => window.__oylReflow?.parameters[id], route.id);
  if (parameter === undefined) {
    throw new Error(`${route.id}: parameterised and the harness has no fixture id`);
  }
  return hrefFor(route, parameter);
}

/** One route's measurement, with no judgment made of it. */
async function measure(page: Page, route: RouteDefinition): Promise<ReflowMeasurement> {
  const hash = await hashFor(page, route);
  const seen = await page.evaluate(async (target) => window.__oylReflow?.visit(target), hash);
  if (seen === undefined) {
    throw new Error('the reflow harness published no measurement');
  }
  return seen;
}

async function visit(page: Page, route: RouteDefinition): Promise<ReflowMeasurement> {
  const seen = await measure(page, route);
  expect(seen.h1, `${route.id} did not render its own page`).toBe(route.title);
  expect(seen.settledWithinPatience, `${route.id} did not settle`).toBe(true);
  return seen;
}

/**
 * #660's judgment of the walk, carried by the light phone walk — #1128,
 * `reflow-faults.ts`: that walk opens the same page `reflow.browser.spec.ts`'s
 * light walk did at 390×844, so each route's one measurement is judged by both
 * specs' rules rather than taken twice.
 */
interface ReflowJudgment {
  readonly populated: boolean;
  readonly faults: string[];
  readonly margins: string[];
}

// The light phone walk below stands in for `reflow.browser.spec.ts`'s at this
// viewport, so it must BE that viewport: fail at load rather than leave it
// walked by neither spec.
if (
  PHONE.width !== LIGHT_PHONE_WALKED_BY_CONTROLS_FIRST.width ||
  PHONE.height !== LIGHT_PHONE_WALKED_BY_CONTROLS_FIRST.height
) {
  throw new Error(
    `controls-first's phone is ${String(PHONE.width)}×${String(PHONE.height)}, and reflow-faults.ts ` +
      'says the light reflow walk it carries is at ' +
      `${String(LIGHT_PHONE_WALKED_BY_CONTROLS_FIRST.width)}×${String(LIGHT_PHONE_WALKED_BY_CONTROLS_FIRST.height)}`,
  );
}

/**
 * The most prose a section that tucks its explanation may lay out between its
 * heading and its first control, in CSS px at a phone's width: a sentence of
 * three or four lines and a short line of state. Measured on this branch the
 * largest is printed with every run; the explanation put back (the control)
 * is several times this.
 */
const SECTION_PROSE_BUDGET_PIXELS = 130;

/**
 * #993's three rules for the top of a screen, as faults:
 *
 * - **one line under the title** — the shell's summary lays out on at most
 *   {@link Viewport.summaryLines};
 * - **kept-visible text below the controls** — nothing marked
 *   `data-oyl-kept-visible` before the first control, except on a consent
 *   route ({@link CONSENT_BEFORE_CONTROL}), whose box says the text was read,
 *   or the text a route names in {@link READ_BEFORE_ACTING} (#1009) — which
 *   must stand above the first control there — or the safety notice a route
 *   names in {@link SAFETY_NOTICE_ABOVE_CONTROL} (#1133), which may;
 * - **a help control a thumb and a screen reader can use** — where the route
 *   declares help, the ⓘ is a 44 × 44 target named "Help with …" whose panel
 *   holds the route's words while it is closed (in the page, so offline).
 */
function lineFaults(route: RouteDefinition, seen: ReflowMeasurement, viewport: Viewport): string[] {
  const faults: string[] = [];
  if (seen.summary === null) {
    faults.push(`${route.id}: no line under the title was laid out`);
  } else if (seen.summary.lines > viewport.summaryLines) {
    faults.push(
      `${route.id}: the line under the title lays out on ${String(seen.summary.lines)} lines, ` +
        `more than ${String(viewport.summaryLines)}: “${seen.summary.text}”`,
    );
  }
  const readFirst = READ_BEFORE_ACTING[route.id];
  const safety = SAFETY_NOTICE_ABOVE_CONTROL[route.id];
  const keptAbove = seen.keptBeforeFirstControl.filter(
    (text) =>
      (readFirst === undefined || !text.startsWith(readFirst)) &&
      (safety === undefined || !spoken(text).startsWith(safety.opening)),
  );
  if (keptAbove.length > 0 && !CONSENT_BEFORE_CONTROL.includes(route.id)) {
    faults.push(
      `${route.id}: kept-visible text stands above the first control, where #993 puts it below: ` +
        keptAbove.map((text) => `“${text}”`).join(', '),
    );
  }
  // #1009: text read before acting must BE before the first action.
  if (
    readFirst !== undefined &&
    seen.firstControl !== null &&
    !seen.keptBeforeFirstControl.some((text) => text.startsWith(readFirst))
  ) {
    faults.push(
      `${route.id}: “${readFirst}…” does not stand above the first control, where #1009 puts it`,
    );
  }
  if (route.help === undefined) {
    if (seen.help !== null) faults.push(`${route.id}: shows a help control and declares no help`);
  } else if (seen.help === null) {
    faults.push(`${route.id}: declares help and shows no help control`);
  } else {
    if (seen.help.width < TOUCH_TARGET_PIXELS || seen.help.height < TOUCH_TARGET_PIXELS) {
      faults.push(
        `${route.id}: the help control is ${seen.help.width.toFixed(0)} × ` +
          `${seen.help.height.toFixed(0)} px, under ${String(TOUCH_TARGET_PIXELS)}`,
      );
    }
    if (seen.help.name !== `Help with ${route.title}`) {
      faults.push(`${route.id}: the help control is named “${seen.help.name}”`);
    }
    if (seen.help.contents !== route.help.join(' ')) {
      faults.push(`${route.id}: the help panel holds “${seen.help.contents.slice(0, 80)}”`);
    }
  }
  return faults;
}

/** A route's first control and the fold, as a line and as faults, which may be none. */
function judge(
  route: RouteDefinition,
  seen: ReflowMeasurement,
  viewport: Viewport,
  populated = false,
): {
  readonly line: string;
  readonly faults: readonly string[];
  /** Whether the first control passed below the fold, behind kept-visible text only. */
  readonly exempted: boolean;
} {
  const margin = viewport.margin;
  const faults: string[] = [...lineFaults(route, seen, viewport)];
  const control = seen.firstControl;
  const sections = seen.sections
    .map(
      (section) =>
        `“${section.heading}” ${section.proseHeight.toFixed(0)} px` +
        (section.controlled ? '' : ' (no control of its own)'),
    )
    .join(', ');
  const sectionNote = sections === '' ? '' : `; prose above a section’s control: ${sections}`;
  const measured = seen.sections.map((section) => section.heading);
  const pinned = [
    ...(TUCKING_SECTIONS[route.id] ?? []),
    ...(populated ? (TUCKING_WHEN_POPULATED[route.id] ?? []) : []),
  ];
  if (measured.join('|') !== pinned.join('|')) {
    faults.push(
      `${route.id}: the sections measured as tucking are [${measured.join(', ')}], ` +
        `and TUCKING_SECTIONS pins [${pinned.join(', ')}] — a pinned section with no ` +
        `ⓘ beside its heading is one whose explanation was put back above its control`,
    );
  }
  for (const section of seen.sections) {
    // A section with no control of its own (an empty state) has nothing to
    // put first; its explanation is tucked for the page's length alone.
    if (section.controlled && section.proseHeight > SECTION_PROSE_BUDGET_PIXELS) {
      faults.push(
        `${route.id}: “${section.heading}” lays out ${section.proseHeight.toFixed(0)} px of prose ` +
          `before its first control — more than ${String(SECTION_PROSE_BUDGET_PIXELS)}`,
      );
    }
  }
  if (control === null) {
    return { line: `${route.id}: no control${sectionNote}`, faults, exempted: false };
  }
  const clearance = seen.fold - control.top;
  const onlyKept = seen.proseBeforeFirstControl.length === 0;
  const line =
    `${route.id}: first control at y = ${control.top.toFixed(0)} (${control.description} ` +
    `“${control.text}”), fold ${seen.fold.toFixed(0)}, margin ${clearance.toFixed(0)} px` +
    `, line under the title on ${String(seen.summary?.lines ?? 0)}` +
    (clearance > margin ? '' : onlyKept ? ' — below it, behind kept-visible text only' : '') +
    sectionNote;
  if (clearance <= margin && !onlyKept) {
    faults.push(
      `${line} — needs more than ${String(margin)} px, and has prose in the way: ` +
        seen.proseBeforeFirstControl.map((text) => `“${text}”`).join(', '),
    );
  }
  const exempted = clearance <= margin && onlyKept;
  if (exempted && !CONSENT_BEFORE_CONTROL.includes(route.id)) {
    faults.push(
      `${line} — and ${route.id} is not in CONSENT_BEFORE_CONTROL, the only routes whose ` +
        'first control may wait behind kept-visible text',
    );
  }
  return { line, faults, exempted };
}

async function walk(
  page: Page,
  viewport: Viewport,
  reflow?: ReflowJudgment,
): Promise<{
  readonly lines: string[];
  readonly faults: Map<string, readonly string[]>;
  readonly exempted: readonly RouteId[];
  /** #943: each empty state's action against the fold, on the empty fixture only. */
  readonly emptyLines: string[];
  readonly emptyFaults: Map<string, readonly string[]>;
}> {
  const lines: string[] = [];
  const faults = new Map<string, readonly string[]>();
  const exempted: RouteId[] = [];
  const emptyLines: string[] = [];
  const emptyFaults = new Map<string, readonly string[]>();
  const empty = await page.evaluate(() => window.__oylReflow?.data === 'empty');
  for (const route of ALL_ROUTES) {
    let seen: ReflowMeasurement;
    if (reflow === undefined) {
      seen = await visit(page, route);
    } else {
      // Judged for #660 first, and #666's own two checks made soft, so a route
      // that fails both is reported by both rather than by whichever ran first.
      seen = await measure(page, route);
      reflow.faults.push(...reflowFaults(route, seen, reflow.populated));
      reflow.margins.push(reflowMargin(route, seen));
      expect.soft(seen.h1, `${route.id} did not render its own page`).toBe(route.title);
      expect.soft(seen.settledWithinPatience, `${route.id} did not settle`).toBe(true);
    }
    const verdict = judge(route, seen, viewport, !empty);
    lines.push(verdict.line);
    if (verdict.faults.length > 0) {
      faults.set(route.id, verdict.faults);
    }
    if (verdict.exempted) {
      exempted.push(route.id);
    }
    if (empty) {
      const declared = await emptyStateDeclared(page, route.id);
      const emptyVerdict = judgeEmptyState(route.id, declared, seen, viewport.margin);
      if (emptyVerdict.line !== undefined) emptyLines.push(emptyVerdict.line);
      if (emptyVerdict.faults.length > 0) emptyFaults.set(route.id, emptyVerdict.faults);
    }
  }
  const unvisited = await page.evaluate(() => window.__oylReflow?.unvisited());
  expect(unvisited, 'routes in ALL_ROUTES the walk never opened').toEqual([]);
  return { lines, faults, exempted, emptyLines, emptyFaults };
}

/**
 * Whether a route declares an empty state the walk reaches — #943,
 * `testing/populated-shell.tsx` §`EMPTY_STATES`, read off the page rather than
 * imported, because importing it pulls the whole client into Playwright's
 * transform. Devices declares one only where a browser can pair, which the
 * walk's no-Bluetooth fixture is not; its own case below measures it.
 */
async function emptyStateDeclared(page: Page, id: RouteId): Promise<boolean> {
  const expectation = await page.evaluate((route) => window.__oylReflow?.emptyStates[route], id);
  if (expectation === undefined) {
    throw new Error(`${id}: testing/populated-shell.tsx §EMPTY_STATES has no entry`);
  }
  return expectation.kind === 'empty-state' && expectation.bluetooth !== true;
}

/**
 * #943: a route that declares an empty state shows exactly one, with exactly
 * one action, and that action STARTS above the fold by `margin` — the rule
 * {@link judge} holds a first control to. A route that declares none shows
 * none.
 */
function judgeEmptyState(
  id: RouteId,
  declared: boolean,
  seen: ReflowMeasurement,
  margin: number,
): { readonly line: string | undefined; readonly faults: readonly string[] } {
  if (!declared) {
    return {
      line: undefined,
      faults:
        seen.emptyStates.length === 0
          ? []
          : [`${id}: shows an empty state, and EMPTY_STATES declares none for it`],
    };
  }
  if (seen.emptyStates.length !== 1) {
    return {
      line: `${id}: ${String(seen.emptyStates.length)} empty states`,
      faults: [`${id}: shows ${String(seen.emptyStates.length)} empty states, not one`],
    };
  }
  const [state] = seen.emptyStates;
  if (state === undefined || state.top === null) {
    return { line: `${id}: no action`, faults: [`${id}: its empty state has no action`] };
  }
  const clearance = seen.fold - state.top;
  const line =
    `${id}: empty state’s action “${state.text}” at y = ${state.top.toFixed(0)}, ` +
    `fold ${seen.fold.toFixed(0)}, margin ${clearance.toFixed(0)} px`;
  const faults: string[] = [];
  if (state.actions !== 1) {
    faults.push(`${id}: its empty state holds ${String(state.actions)} actions, not one`);
  }
  if (clearance <= margin) {
    faults.push(`${line} — needs more than ${String(margin)} px`);
  }
  return { line, faults };
}

test.describe('#666 — the first control is above the fold on every route', () => {
  // #672: the walks run under a light device and a dark one — parametrised, so
  // a check added reaches both. Colour moves no box; what a dark walk can find
  // is a route that renders or fails differently in the dark palette.
  for (const theme of THEMES) {
    test.describe(`${theme} palette`, () => {
      test.use({ colorScheme: theme });

      for (const data of ['empty', 'populated'] as const) {
        // #1128: in the light palette this is ALSO #660's reflow walk at the
        // phone — `reflow-faults.ts` — so the case says so in its name.
        const reflows = theme === 'light' ? ', and every route reflows (#660)' : '';
        test(`at a ${PHONE.name}, ${data}${reflows}`, async ({ page }) => {
          test.setTimeout(180_000);
          await open(page, PHONE, `data=${data}`);
          expect(await page.evaluate(() => document.documentElement.dataset['theme'])).toBe(theme);
          const reflow: ReflowJudgment | undefined =
            theme === 'light'
              ? { populated: data === 'populated', faults: [], margins: [] }
              : undefined;
          const { lines, faults, exempted, emptyLines, emptyFaults } = await walk(
            page,
            PHONE,
            reflow,
          );
          if (reflow !== undefined) {
            console.log(
              `reflow ${data} ${String(PHONE.width)}×${String(PHONE.height)}\n  ${reflow.margins.join('\n  ')}`,
            );
            // Soft, so a #666 fault below is reported beside it, not instead.
            expect
              .soft(
                reflow.faults,
                'reflow (#660, reflow-faults.ts): a route at the phone in the light palette',
              )
              .toEqual([]);
            // Per route above, which names the route; this catches one raised
            // after the last route was measured — the reflow walk's last check.
            expect
              .soft(
                await page.evaluate(() => window.__oylReflow?.errors),
                'reflow (#660): errors the page raised during the walk',
              )
              .toEqual([]);
          }
          console.log(`controls first, ${PHONE.name}, ${data}\n  ${lines.join('\n  ')}`);
          expect([...faults.values()].flat()).toEqual([]);
          if (data === 'empty') {
            // #943: every declared empty state is measured, so none passes unseen.
            console.log(`empty states, ${PHONE.name}\n  ${emptyLines.join('\n  ')}`);
            expect([...emptyFaults.values()].flat()).toEqual([]);
            expect(emptyLines.length, 'no empty state was measured').toBeGreaterThanOrEqual(6);
          }
          // Equal, not only within: a listed route that stops needing the
          // exemption on a phone is one to take off the list.
          expect(exempted, 'routes behind kept-visible text only').toEqual(CONSENT_BEFORE_CONTROL);
          // The routes the control must fail on have something to measure, so
          // none of them passes by having no control.
          for (const id of MUST_FAIL_INLINE) {
            expect(lines.some((line) => line.startsWith(`${id}: no control`))).toBe(false);
          }
        });
      }

      for (const viewport of TABLETS) {
        test(`on a ${viewport.name}, with a ${String(FOLD_MARGIN_PIXELS)} px margin`, async ({
          page,
        }) => {
          test.setTimeout(180_000);
          await open(page, viewport, 'data=empty');
          expect(await page.evaluate(() => document.documentElement.dataset['theme'])).toBe(theme);
          const { lines, faults, exempted, emptyLines, emptyFaults } = await walk(page, viewport);
          console.log(`controls first, ${viewport.name}\n  ${lines.join('\n  ')}`);
          console.log(`  behind kept-visible text only: [${exempted.join(', ')}]`);
          console.log(`empty states, ${viewport.name}\n  ${emptyLines.join('\n  ')}`);
          test.info().annotations.push({ type: 'margins', description: lines.join('; ') });
          expect([...faults.values()].flat()).toEqual([]);
          expect([...emptyFaults.values()].flat()).toEqual([]);
          expect(emptyLines.length, 'no empty state was measured').toBeGreaterThanOrEqual(6);
          expect(exempted, 'routes behind kept-visible text only').toEqual(
            CONSENT_BEFORE_CONTROL.filter((id) => viewport.consentBelowFold.includes(id)),
          );
        });
      }
    });
  }

  for (const viewport of [PHONE, ...TABLETS]) {
    test(`Devices where a browser can pair, on a ${viewport.name}`, async ({ page }) => {
      await open(page, viewport, 'data=empty&bluetooth=available');
      const seen = await visit(page, routeById('devices'));
      const verdict = judge(routeById('devices'), seen, viewport);
      console.log(`controls first, Bluetooth available, ${viewport.name}\n  ${verdict.line}`);
      // The state is the one with the pairing rows, or this measured the
      // no-Bluetooth page again.
      expect(seen.firstControl?.text).toMatch(/^Pair /u);
      expect(verdict.faults).toEqual([]);
      expect(verdict.exempted).toBe(false);
      // #943: nothing is paired, so the garage's empty state is the one the
      // walk above cannot reach, and its action is held the same way.
      const empty = judgeEmptyState('devices', true, seen, viewport.margin);
      console.log(`  ${empty.line ?? ''}`);
      expect(empty.faults).toEqual([]);
    });
  }

  // #1133. A refused release puts the chooser's *Not released* notice — kept,
  // and above Ride on purpose (#940, #372) — in front of the game's first
  // control. SAFETY_NOTICE_ABOVE_CONTROL is what lets it stand there.
  for (const viewport of [PHONE, ...TABLETS]) {
    test(`the game with a refused release, on a ${viewport.name}`, async ({ page }) => {
      await open(page, viewport, 'data=populated&release=refused');
      const seen = await visit(page, routeById('game'));
      const verdict = judge(routeById('game'), seen, viewport, true);
      console.log(
        `controls first, a refused release, ${viewport.name}\n  ${verdict.line}\n` +
          `  kept above the first control: ${JSON.stringify(seen.keptBeforeFirstControl)}`,
      );
      // The state is the one with the notice above the first control, or this
      // measured the chooser without it and the allowance went unexercised.
      expect(
        seen.keptBeforeFirstControl.map(spoken).filter((text) => text.startsWith('Not released')),
      ).toHaveLength(1);
      expect(verdict.faults).toEqual([]);
      expect(verdict.exempted).toBe(false);
    });
  }

  test('#1133’s control: with an unrelated sentence marked above the chooser’s first control, the game fails', async ({
    page,
  }) => {
    await open(page, PHONE, 'data=populated&release=refused&kept=unrelated');
    const seen = await visit(page, routeById('game'));
    const verdict = judge(routeById('game'), seen, PHONE, true);
    console.log(
      `controls first, CONTROL (kept=unrelated), ${PHONE.name}\n  ${verdict.faults.join('\n  ')}`,
    );
    const kept = verdict.faults.filter((fault) => fault.includes('kept-visible text stands above'));
    // Red for the marked sentence, and for it alone: the safety notice beside
    // it is still allowed.
    expect(kept).toHaveLength(1);
    expect(kept[0]).toContain('Your trainer');
    expect(kept[0]).not.toContain('Not released');
  });

  test('#943’s control: with the drawing at half the viewport, Activities’ action falls below the fold', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await open(page, PHONE, 'data=empty&illustration=tall');
    const { emptyLines, emptyFaults } = await walk(page, PHONE);
    console.log(
      `empty states, CONTROL (drawing at 50vh), ${PHONE.name}\n  ${emptyLines.join('\n  ')}`,
    );
    expect(
      emptyFaults.get('activities'),
      'Activities’ empty-state action stayed above the fold with its drawing at 50vh',
    ).toBeDefined();
  });

  // #993's control. Every route with help or notes is opened with its old
  // line put back under the title — summary, help and notes in one paragraph —
  // and its notes copied above the view. On the tablet, the one-line rule must
  // then fail for every route with HELP on at least one of the two
  // orientations, and the notes rule for every route with notes on both.
  // ⚠️ Not the one-line rule for a route with notes alone: Ride's old line, with
  // its "Everything stays on this device.", was one line on the tablet both
  // ways up, and moving that sentence is the notes rule's to hold.
  test('#993’s control: with the line put back as it was, every route with help or notes fails', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const tooLong = new Set<RouteId>();
    for (const viewport of TABLETS) {
      await open(page, viewport, 'data=empty&line=before993');
      const { lines, faults } = await walk(page, viewport);
      console.log(
        `controls first, CONTROL (line put back), ${viewport.name}\n  ${lines.join('\n  ')}`,
      );
      for (const route of ALL_ROUTES) {
        const found = faults.get(route.id) ?? [];
        if (found.some((fault) => fault.includes('the line under the title lays out on'))) {
          tooLong.add(route.id);
        }
        if (route.notes !== undefined && !CONSENT_BEFORE_CONTROL.includes(route.id)) {
          expect(
            found.some((fault) => fault.includes('kept-visible text stands above')),
            `${route.id}: notes passed above its first control, on a ${viewport.name}`,
          ).toBe(true);
        }
      }
    }
    const withHelp = ALL_ROUTES.filter((route) => route.help !== undefined).map(
      (route) => route.id,
    );
    expect(withHelp.length, 'no route has help to put back').toBeGreaterThan(5);
    expect(
      withHelp.filter((id) => !tooLong.has(id)),
      'routes with help whose old line passed as one line on the tablet both ways up',
    ).toEqual([]);
  });

  test('the control: with the explanation put back, Segments, Settings and Files fail', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await open(page, PHONE, 'data=empty&disclosures=inline');
    const { lines, faults } = await walk(page, PHONE);
    console.log(
      `controls first, CONTROL (explanation put back), ${PHONE.name}\n  ${lines.join('\n  ')}`,
    );
    for (const id of MUST_FAIL_INLINE) {
      expect(faults.get(id), `${id} passed with its explanation put back`).toBeDefined();
    }
  });
});

/** The route the tab-order cases drive: Settings tucks links in its disclosures. */
const TUCKED_LINK_ROUTE = 'settings';

/** A summary to open whose disclosure holds at least one link, and that link. */
async function tuckedLink(page: Page): Promise<{ summary: string; link: string }> {
  const found = await page.evaluate(() => {
    for (const details of document.querySelectorAll('main details:not([open])')) {
      const link = details.querySelector(':scope > :not(summary) a[href], :scope > a[href]');
      const summary = details.querySelector(':scope > summary');
      if (link !== null && summary !== null) {
        details.setAttribute('data-oyl-probe', 'tucked');
        link.setAttribute('data-oyl-probe', 'link');
        return { summary: summary.textContent ?? '', link: link.textContent ?? '' };
      }
    }
    return undefined;
  });
  if (found === undefined) {
    throw new Error(`${TUCKED_LINK_ROUTE} has no link tucked in a closed <details>`);
  }
  return found;
}

async function tabModel(
  page: Page,
): Promise<{ readonly stops: string[]; readonly radios: number }> {
  const model = await page.evaluate(() => window.__oylTabModel?.());
  if (model === undefined) throw new Error('the harness published no tab model');
  return model;
}

/** Press Tab from the top of `main` until focus leaves it; return what was focused. */
async function tabThroughMain(page: Page): Promise<string[]> {
  await page.evaluate(() => {
    const main = document.querySelector('main');
    if (!(main instanceof HTMLElement)) throw new Error('no main');
    main.focus();
  });
  const seen: string[] = [];
  for (let press = 0; press < 400; press += 1) {
    await page.keyboard.press('Tab');
    const where = await page.evaluate(() => {
      const active = document.activeElement;
      if (active === null || document.querySelector('main')?.contains(active) !== true) {
        return null;
      }
      return window.__oylTabKey?.(active) ?? null;
    });
    if (where === null) break;
    seen.push(where);
  }
  return seen;
}

test.describe('#666 — a tucked link is not in the tab order until its summary is opened', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('real Tab presses skip it closed, reach it open, and agree with tabbableElements', async ({
    page,
  }) => {
    await open(page, PHONE, 'data=empty');
    await visit(page, routeById(TUCKED_LINK_ROUTE));
    const tucked = await tuckedLink(page);

    const closed = await tabThroughMain(page);
    const modelClosed = await tabModel(page);
    expect(closed.length, 'Tab reached nothing in main').toBeGreaterThan(0);
    expect(closed).not.toContain('link');
    expect(modelClosed.stops).not.toContain('link');
    expect(closed, 'real Chromium and tabbableElements disagree, closed').toEqual(
      modelClosed.stops,
    );
    // #698: Settings' units are a radio group, which a browser makes ONE tab
    // stop. The model does too now, so the comparison above covers it — this
    // says there was a group to compare, and that it met more than one radio.
    expect(modelClosed.radios, 'Settings has no radio group to compare').toBeGreaterThan(1);
    expect(
      closed.filter((key) => key.startsWith('input#oyl-units-')),
      'Tab should stop once on the units group',
    ).toHaveLength(1);

    await page.locator('[data-oyl-probe="tucked"] > summary').click();
    const opened = await tabThroughMain(page);
    const modelOpen = await tabModel(page);
    expect(
      opened,
      `“${tucked.link}” under “${tucked.summary}” was not reached once open`,
    ).toContain('link');
    expect(modelOpen.stops).toContain('link');
    expect(opened, 'real Chromium and tabbableElements disagree, open').toEqual(modelOpen.stops);
  });
});

test.describe('#666 — a summary is a 44 px row, measured three ways (#316)', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('the shipped box, the declaration, and the box with the floor stripped', async ({
    page,
  }) => {
    // #1031: the "More about" disclosures Settings carried are each a
    // section's ⓘ now (measured under §"#1013"), and the one `.oyl-details`
    // row left is the Devices screen's "What this browser can and cannot do",
    // which renders where a browser can pair.
    await open(page, PHONE, 'data=empty&bluetooth=available');
    await visit(page, routeById('devices'));
    const summaries = page.locator('main details.oyl-details > summary');
    const count = await summaries.count();
    expect(count, 'Devices has no `.oyl-details` disclosure to measure').toBeGreaterThan(0);
    for (let index = 0; index < count; index += 1) {
      const summary = summaries.nth(index);
      const read = await summary.evaluate((element) => {
        const style = getComputedStyle(element);
        const shipped = element.getBoundingClientRect();
        const declared = Number.parseFloat(style.minHeight);
        const marker = getComputedStyle(element, '::before');
        (element as HTMLElement).style.minHeight = '0';
        const stripped = element.getBoundingClientRect().height;
        (element as HTMLElement).style.minHeight = '';
        return {
          height: shipped.height,
          width: shipped.width,
          declared,
          stripped,
          markerContent: marker.content,
          markerColour: marker.color,
        };
      });
      const where = `summary ${String(index)}`;
      expect(read.height, `${where}: the shipped box`).toBeGreaterThanOrEqual(TOUCH_TARGET_PIXELS);
      expect(read.width, `${where}: the shipped box`).toBeGreaterThanOrEqual(TOUCH_TARGET_PIXELS);
      expect(read.declared, `${where}: the declaration`).toBeGreaterThanOrEqual(
        TOUCH_TARGET_PIXELS,
      );
      expect(read.stripped, `${where}: with the floor stripped`).toBeLessThan(TOUCH_TARGET_PIXELS);
      // The marker is the rule's own, painted with a token, not the UA triangle.
      expect(read.markerContent).not.toBe('none');
      expect(read.markerColour).toBe(
        await page
          .evaluate(() =>
            getComputedStyle(document.documentElement)
              .getPropertyValue('--oyl-color-accent-text')
              .trim(),
          )
          .then(hexToRgb),
      );
    }
  });
});

function hexToRgb(hex: string): string {
  const channel = (at: number): number => Number.parseInt(hex.slice(at, at + 2), 16);
  return `rgb(${String(channel(1))}, ${String(channel(3))}, ${String(channel(5))})`;
}

test.describe('#993 — the help control beside a title', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('is a 44 px target three ways (#316), named, and opened and closed from the keyboard', async ({
    page,
  }) => {
    await open(page, PHONE, 'data=empty');
    const route = routeById('segments');
    await visit(page, route);
    const summary = page.locator('main > .oyl-view-head > details.oyl-help > summary');
    const read = await summary.evaluate((element) => {
      const style = getComputedStyle(element);
      const shipped = element.getBoundingClientRect();
      const declared = {
        width: Number.parseFloat(style.minWidth),
        height: Number.parseFloat(style.minHeight),
      };
      (element as HTMLElement).style.minWidth = '0';
      (element as HTMLElement).style.minHeight = '0';
      const stripped = element.getBoundingClientRect();
      (element as HTMLElement).style.minWidth = '';
      (element as HTMLElement).style.minHeight = '';
      const title = document.querySelector('main > .oyl-view-head > h1')?.getBoundingClientRect();
      // #2065: the line under the title shares its row where it fits, so it
      // too must stop short of the ⓘ.
      const line = document
        .querySelector('main > .oyl-view-head > h1 + p')
        ?.getBoundingClientRect();
      return {
        shipped: { width: shipped.width, height: shipped.height },
        declared,
        stripped: { width: stripped.width, height: stripped.height },
        // Beside the title: its middle within the title's first line, and the
        // title's text — and the line's — stopping short of it.
        middle: shipped.top + shipped.height / 2,
        titleTop: title?.top ?? Number.NaN,
        titleRight: title?.right ?? Number.NaN,
        lineRight: line?.right ?? Number.NaN,
        left: shipped.left,
      };
    });
    console.log(`#993 help control: ${JSON.stringify(read)}`);
    expect(read.shipped.width).toBeGreaterThanOrEqual(TOUCH_TARGET_PIXELS);
    expect(read.shipped.height).toBeGreaterThanOrEqual(TOUCH_TARGET_PIXELS);
    expect(read.declared.width).toBeGreaterThanOrEqual(TOUCH_TARGET_PIXELS);
    expect(read.declared.height).toBeGreaterThanOrEqual(TOUCH_TARGET_PIXELS);
    // The control: without the declaration the glyph alone is far short.
    expect(read.stripped.width).toBeLessThan(TOUCH_TARGET_PIXELS);
    expect(read.stripped.height).toBeLessThan(TOUCH_TARGET_PIXELS);
    expect(read.titleRight).toBeLessThanOrEqual(read.left);
    expect(read.lineRight).toBeLessThanOrEqual(read.left);
    expect(read.middle).toBeGreaterThan(read.titleTop);

    // The platform's own name for it, as a screen reader would be given it.
    await expect(summary).toHaveAccessibleName(`Help with ${route.title}`);
    const details = page.locator('main > .oyl-view-head > details.oyl-help');
    await expect(details).not.toHaveAttribute('open');
    await summary.focus();
    await page.keyboard.press('Enter');
    await expect(details).toHaveAttribute('open', '');
    await expect(
      page.locator('main > .oyl-view-head > details.oyl-help .oyl-help__panel'),
    ).toBeVisible();
    await page.keyboard.press('Space');
    await expect(details).not.toHaveAttribute('open');
  });
});

/**
 * #2065 review: opening the help must not move its ⓘ. The title block is as
 * wide as its words from the rail's breakpoint, and an open panel is words
 * too — unless the help is contained, the box grows to its cap and the ⓘ
 * (drawn at the box's end edge) jumps to the shell's far side.
 */
const HELP_VIEWPORTS = [
  { name: 'tablet 1280×800', width: 1280, height: 800 },
  { name: 'narrow 640×900', width: 640, height: 900 },
  { name: 'phone 412×915', width: 412, height: 915 },
] as const;

test.describe('#993 — opening the help does not move its control (#2065)', () => {
  for (const viewport of HELP_VIEWPORTS) {
    test(`on every route with a help, at ${viewport.name}`, async ({ page }) => {
      test.setTimeout(120_000);
      await open(
        page,
        { ...viewport, margin: 0, consentBelowFold: [], summaryLines: 2 },
        'data=empty',
      );
      const moved: string[] = [];
      let checked = 0;
      for (const route of ALL_ROUTES) {
        await visit(page, route);
        const details = page.locator('main > .oyl-view-head > details.oyl-help');
        if ((await details.count()) === 0) continue;
        const summary = details.locator('> summary');
        const box = async (): Promise<{ left: number; top: number }> =>
          summary.evaluate((element) => {
            const rect = element.getBoundingClientRect();
            return { left: rect.left, top: rect.top };
          });
        const closed = await box();
        await summary.click();
        await expect(details).toHaveAttribute('open', '');
        const opened = await box();
        await summary.click();
        await expect(details).not.toHaveAttribute('open');
        checked += 1;
        if (Math.abs(opened.left - closed.left) > 0.5 || Math.abs(opened.top - closed.top) > 0.5) {
          moved.push(
            `${route.id}: ${closed.left.toFixed(1)},${closed.top.toFixed(1)} → ` +
              `${opened.left.toFixed(1)},${opened.top.toFixed(1)}`,
          );
        }
      }
      expect(checked, 'routes with a help opened').toBeGreaterThan(3);
      expect(moved, 'routes whose ⓘ moved when its help opened').toEqual([]);
    });
  }
});

test.describe('#1013 — the help control beside a section heading', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('is a 44 px target three ways (#316), beside its heading, named, and opened and closed from the keyboard', async ({
    page,
  }) => {
    await open(page, PHONE, 'data=empty');
    await visit(page, routeById('analysis'));
    const head = page.locator('main .oyl-section-head').filter({ hasText: 'Your thresholds' });
    const summary = head.locator('details.oyl-section-help > summary');
    const read = await summary.evaluate((element) => {
      const style = getComputedStyle(element);
      const shipped = element.getBoundingClientRect();
      const declared = {
        width: Number.parseFloat(style.minWidth),
        height: Number.parseFloat(style.minHeight),
      };
      (element as HTMLElement).style.minWidth = '0';
      (element as HTMLElement).style.minHeight = '0';
      const stripped = element.getBoundingClientRect();
      (element as HTMLElement).style.minWidth = '';
      (element as HTMLElement).style.minHeight = '';
      const heading = element.closest('.oyl-section-head')?.querySelector('h2, h3, h4');
      const box = heading?.getBoundingClientRect();
      const text = document.createRange();
      if (heading !== null && heading !== undefined) text.selectNodeContents(heading);
      const words = [...text.getClientRects()];
      return {
        shipped: { width: shipped.width, height: shipped.height },
        declared,
        stripped: { width: stripped.width, height: stripped.height },
        middle: shipped.top + shipped.height / 2,
        headingTop: box?.top ?? Number.NaN,
        headingBottom: box?.bottom ?? Number.NaN,
        wordsRight: Math.max(...words.map((rect) => rect.right)),
        left: shipped.left,
      };
    });
    console.log(`#1013 section help control: ${JSON.stringify(read)}`);
    expect(read.shipped.width).toBeGreaterThanOrEqual(TOUCH_TARGET_PIXELS);
    expect(read.shipped.height).toBeGreaterThanOrEqual(TOUCH_TARGET_PIXELS);
    expect(read.declared.width).toBeGreaterThanOrEqual(TOUCH_TARGET_PIXELS);
    expect(read.declared.height).toBeGreaterThanOrEqual(TOUCH_TARGET_PIXELS);
    // The control: without the declaration the glyph alone is far short.
    expect(read.stripped.width).toBeLessThan(TOUCH_TARGET_PIXELS);
    expect(read.stripped.height).toBeLessThan(TOUCH_TARGET_PIXELS);
    // Beside the heading: on its row, and the heading's words stop short of it.
    expect(read.middle).toBeGreaterThan(read.headingTop);
    expect(read.middle).toBeLessThan(read.headingBottom);
    expect(read.wordsRight).toBeLessThanOrEqual(read.left);

    await expect(summary).toHaveAccessibleName('Help with Your thresholds');
    const details = head.locator('details.oyl-section-help');
    const panel = head.locator('.oyl-section-help__panel');
    await expect(details).not.toHaveAttribute('open');
    await expect(panel).toBeHidden();
    await summary.focus();
    await page.keyboard.press('Enter');
    await expect(details).toHaveAttribute('open', '');
    await expect(panel).toBeVisible();
    await expect(panel).toContainText('derived from these two numbers');
    await page.keyboard.press('Space');
    await expect(details).not.toHaveAttribute('open');
  });
});

/**
 * #1050, #1087 — *Save workout* with blocks in the builder.
 *
 * Every other walk here renders the workout builder with NO blocks, so the
 * block list and the block chart (#1043) — drawn only once a block exists —
 * were never laid out, and nothing measured where they put the builder's one
 * primary. `reflow.html?builder=blocks` adds one block of each kind through the
 * builder's own *Add block* form (`reflow-harness.tsx` §`buildOnWorkouts`),
 * and this publishes *Save workout*'s margin to the fold — to its pane's
 * bottom where that pane scrolls on its own (#723) — with and without them.
 *
 * - **Held** to §4f's 50 px floor on the owner's tablet both ways up AND, since
 *   #1087, on a phone (390×844), with blocks and without. #1050 moved the
 *   chart below the form; the block list was still above it, and each block
 *   (a line and a 44 px *Remove* button) moved *Save workout* down: on a phone
 *   it was about 120 px UNDER the fold with four blocks, and on the landscape
 *   tablet 65.9 px above it on CI (run 37168523170), 16 px over the floor —
 *   one more block's worth. So the Save form is first in the builder now
 *   (`WorkoutsView.tsx`, #1087), and its margin does not depend on how many
 *   blocks there are; the spec requires it to be the same with four as with
 *   none, within a pixel.
 * - **The control**: `&save=below` puts the Save form back after the block
 *   list on the live page, where #1050 left it, and on the phone *Save
 *   workout* must then fall under the floor — so the hold above is the form's
 *   place doing the work, not a fixture too small to matter.
 */
const SAVE_WORKOUT = 'Save workout';

/** How many blocks `?builder=blocks` adds: `reflow-harness.tsx` §`BUILDER_BLOCKS`. */
const BUILDER_BLOCK_COUNT = 4;

async function saveWorkoutMargin(
  page: Page,
): Promise<{ margin: number; blocks: number; chart: number }> {
  const seen = await visit(page, routeById('workouts'));
  const save = seen.primaries.find((primary) => primary.text === SAVE_WORKOUT);
  if (save === undefined) {
    throw new Error(
      `workouts: no laid-out “${SAVE_WORKOUT}” among ${JSON.stringify(seen.primaries)}`,
    );
  }
  // `primaries` is in document coordinates and the fold in the viewport's;
  // `visit` measures at the top of the page, so the two agree.
  const line = Math.min(seen.fold, save.clipBottom ?? Number.POSITIVE_INFINITY);
  const builder = page.locator('.oyl-main .oyl-sections').first();
  return {
    margin: line - save.bottom,
    blocks: await builder.locator('ol > li').count(),
    chart: await builder.locator('svg.oyl-block-chart').count(),
  };
}

test.describe('#1050, #1087 — Save workout, with blocks in the builder', () => {
  for (const viewport of [...TABLETS, PHONE]) {
    test(`its margin to the fold on a ${viewport.name}, held to ${String(FOLD_MARGIN_PIXELS)} px`, async ({
      page,
    }) => {
      await open(page, viewport, 'data=populated');
      const without = await saveWorkoutMargin(page);
      await open(page, viewport, 'data=populated&builder=blocks');
      const withBlocks = await saveWorkoutMargin(page);
      console.log(
        `[#1087] “${SAVE_WORKOUT}” @ ${viewport.name}: ${withBlocks.margin.toFixed(1)} px with ` +
          `${String(withBlocks.blocks)} blocks and the chart, ${without.margin.toFixed(1)} px with none`,
      );
      // The fixture is what it says, or this measured the empty builder twice.
      expect(without.blocks).toBe(0);
      expect(without.chart).toBe(0);
      expect(withBlocks.blocks).toBe(BUILDER_BLOCK_COUNT);
      expect(withBlocks.chart).toBe(1);
      expect(without.margin).toBeGreaterThan(FOLD_MARGIN_PIXELS);
      expect(withBlocks.margin).toBeGreaterThan(FOLD_MARGIN_PIXELS);
      // #1087: a block does not move it — a fifth or a tenth cannot spend the margin.
      expect(Math.abs(withBlocks.margin - without.margin)).toBeLessThanOrEqual(1);
    });
  }

  test('the control — with the Save form after the block list, Save workout falls under the floor on a phone', async ({
    page,
  }) => {
    await open(page, PHONE, 'data=populated&builder=blocks&save=below');
    const below = await saveWorkoutMargin(page);
    console.log(
      `[#1087] control: “${SAVE_WORKOUT}” @ ${PHONE.name}, the form after the list: ` +
        `${below.margin.toFixed(1)} px`,
    );
    expect(below.blocks).toBe(BUILDER_BLOCK_COUNT);
    expect(below.chart).toBe(1);
    // The form really is after the list, or this measured the shipped page.
    expect(
      await page.evaluate(() => {
        const list = document.querySelector('.oyl-main .oyl-sections ol');
        const form = document.querySelector('form[aria-label="Save this workout"]');
        return (
          list !== null &&
          form !== null &&
          (list.compareDocumentPosition(form) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
        );
      }),
    ).toBe(true);
    expect(below.margin).toBeLessThanOrEqual(FOLD_MARGIN_PIXELS);
  });
});

/**
 * #2007, the owner's screenshot ruling of 2026-11-06: the route editor's
 * whole-route buttons (Out and back, Reverse, Return to start, Undo) touched,
 * where the map's own buttons above them are held apart by `--oyl-space-sm`.
 * jsdom performs no layout, so the gap is read here, as the engine lays it
 * out: every two buttons of the row are apart along at least one axis by the
 * token, wrapped or not. The row is found by its heading, not by its class,
 * so a row that lost its class reads as buttons that touch, not as a row that
 * was not found.
 */
test.describe('#2007 — the route editor’s whole-route buttons do not touch', () => {
  /** `--oyl-space-sm`, 0.5rem, less a pixel's rounding. */
  const LEAST_GAP_PIXELS = 7.5;

  for (const viewport of [PHONE, ...TABLETS]) {
    test(`on a ${viewport.name}`, async ({ page }) => {
      await open(page, viewport, 'data=populated');
      await visit(page, routeById('route-editor'));
      const row = page.locator('main h2:text-is("Change the whole route") + div');
      // An edit, so Undo is on the row as well.
      await row.getByRole('button', { name: 'Reverse' }).click();
      await expect(row.getByRole('button', { name: 'Undo' })).toBeVisible();
      const buttons = await row.getByRole('button').evaluateAll((elements) =>
        elements.map((element) => {
          const box = element.getBoundingClientRect();
          return {
            name: element.textContent ?? '',
            left: box.left,
            right: box.right,
            top: box.top,
            bottom: box.bottom,
          };
        }),
      );
      expect(buttons.map((button) => button.name)).toEqual(
        expect.arrayContaining(['Out and back', 'Reverse', 'Undo']),
      );
      const touching: string[] = [];
      for (const [index, a] of buttons.entries()) {
        for (const b of buttons.slice(index + 1)) {
          const across = Math.max(b.left - a.right, a.left - b.right);
          const down = Math.max(b.top - a.bottom, a.top - b.bottom);
          const apart = Math.max(across, down);
          if (apart < LEAST_GAP_PIXELS) {
            touching.push(`${a.name} and ${b.name}: ${apart.toFixed(1)} px apart`);
          }
        }
      }
      console.log(
        `[#2007] ${viewport.name}: ${buttons.map((button) => button.name).join(', ')}` +
          `${touching.length === 0 ? '' : `; touching: ${touching.join('; ')}`}`,
      );
      expect(touching, 'buttons closer than --oyl-space-sm').toEqual([]);
    });
  }
});

/**
 * #2889, PR #2978: the open-world start picker's map, measured as the engine
 * lays it out and moves it.
 *
 * The layout review of 2026-11-20 first:
 *
 * - **The map fills its frame.** The canvas MapLibre draws into is as wide and
 *   as tall as `.oyl-map`, within a pixel's rounding, and it still is after
 *   the window widens from a phone's width to the landscape tablet's. A canvas
 *   sized once and never again would show as a map in part of its box.
 * - **The pin shows no clipped label.** It is a drawn pin, with no text on it
 *   to clip. A word in a 1.75 rem disc read "Star". Its graphic lies inside
 *   its own box, and its name is its `aria-label`.
 *
 * Then the owner's ruling of the same day, that the map is moved by hand and
 * carries no rows of text buttons ("they look cheap"):
 *
 * - **No text button rows.** No *Move north*, *Whole route* or *Move the pin
 *   …*, and no `.oyl-map__moves`. The cluster on the map has four icon
 *   buttons, each 48 × 48 px or larger and inside the map's frame.
 * - **A click drops the pin** where it lands, with the pin's tip on the point.
 * - **The wheel zooms** about the pointer, and **a mouse drag pans**.
 * - **On touch, one finger drags the map, two fingers pan, a pinch zooms, and
 *   a tap after a drag still drops the pin.** Until #3014 one finger was left
 *   to the page, and the owner found on the tablet that a drag did nothing.
 * - **On the focused map, arrow keys pan and `=`/`-` zoom.** **On the focused
 *   pin, an arrow key moves the pin and not the map**, and the move is said
 *   in the live region.
 *
 * Every movement is read off the pin. Where it stands on the canvas is what
 * the rider sees, and it is not a number the map reports about itself.
 *
 * The full-page screenshot that raised the review also showed the map drawn in
 * the left 400 px of its box and the rail stopping at the first screen.
 * Neither happens on a viewport screenshot or in these measurements: a
 * full-page capture in Chromium lays the page out again at the document's
 * height for one frame, and a WebGL canvas and a `position: fixed` rail do not
 * come through that intact.
 */
test.describe('#2889 — the open-world picker’s map, moved by hand', () => {
  /** The owner's ruling for this map's buttons. */
  const LEAST_TARGET_PIXELS = 48;
  /** `--oyl-space-xs`, 0.25rem, less a pixel's rounding. */
  const LEAST_GAP_PIXELS = 3.5;

  interface Box {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  }

  /** The map's frame and its canvas, both as the engine laid them out. */
  async function mapFrame(page: Page): Promise<{
    frame: { width: number; height: number };
    canvas: Box;
  }> {
    return page.evaluate(() => {
      const frame = document.querySelector('main .oyl-map');
      const canvas = frame?.querySelector('canvas');
      if (!(frame instanceof HTMLElement) || !(canvas instanceof HTMLCanvasElement)) {
        throw new Error('the picker drew no map canvas');
      }
      const box = canvas.getBoundingClientRect();
      return {
        frame: { width: frame.clientWidth, height: frame.clientHeight },
        canvas: { x: box.x, y: box.y, width: box.width, height: box.height },
      };
    });
  }

  function expectFilled(seen: Awaited<ReturnType<typeof mapFrame>>, where: string): void {
    console.log(
      `[#2889] ${where}: frame ${String(seen.frame.width)}×${String(seen.frame.height)}, ` +
        `canvas ${seen.canvas.width.toFixed(1)}×${seen.canvas.height.toFixed(1)}`,
    );
    expect(Math.abs(seen.canvas.width - seen.frame.width), `${where}: canvas width`).toBeLessThan(
      1.5,
    );
    expect(
      Math.abs(seen.canvas.height - seen.frame.height),
      `${where}: canvas height`,
    ).toBeLessThan(1.5);
  }

  /** The pin's tip, from the canvas's top left: where on the map the rider sees it. */
  async function pinTip(page: Page): Promise<{ x: number; y: number }> {
    return page.evaluate(() => {
      const pin = document.querySelector('main .oyl-map__waypoint--pin');
      const canvas = document.querySelector('main .oyl-map canvas');
      if (pin === null || canvas === null) throw new Error('no pin on the map');
      const box = pin.getBoundingClientRect();
      const origin = canvas.getBoundingClientRect();
      return { x: box.left + box.width / 2 - origin.left, y: box.bottom - origin.top };
    });
  }

  /** How far the pin's tip is from a point on the canvas. */
  function apart(a: { x: number; y: number }, b: { x: number; y: number }): number {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  /**
   * Waits until two readings of the pin a moment apart agree: the camera has
   * stopped. It first waits out MapLibre's 300 ms ease, which begins a frame
   * after the key or the wheel: read at once, a camera about to move reads
   * as one standing still.
   */
  async function settledPin(page: Page): Promise<{ x: number; y: number }> {
    await page.waitForTimeout(400);
    let last = await pinTip(page);
    await expect
      .poll(async () => {
        await page.waitForTimeout(150);
        const next = await pinTip(page);
        const still = apart(last, next) < 0.5;
        last = next;
        return still;
      })
      .toBe(true);
    return last;
  }

  async function openPicker(
    page: Page,
    viewport: Viewport,
    query = 'data=populated',
  ): Promise<Box> {
    await open(page, viewport, query);
    await visit(page, routeById('open-world'));
    await expect(page.locator('main .oyl-map canvas')).toHaveCount(1);
    return (await mapFrame(page)).canvas;
  }

  /** Drops the pin with a click at an offset from the map's centre, and returns where it is. */
  async function dropAt(
    page: Page,
    canvas: Box,
    dx: number,
    dy: number,
  ): Promise<{ x: number; y: number }> {
    await page.mouse.click(canvas.x + canvas.width / 2 + dx, canvas.y + canvas.height / 2 + dy);
    await expect(page.locator('main .oyl-map__waypoint--pin')).toHaveCount(1);
    return settledPin(page);
  }

  for (const viewport of [PHONE, ...TABLETS]) {
    test(`fills its frame, draws a whole pin and carries only its icon buttons, on a ${viewport.name}`, async ({
      page,
    }) => {
      await openPicker(page, viewport);
      expectFilled(await mapFrame(page), viewport.name);

      const gone = [
        'Move north',
        'Move west',
        'Move east',
        'Move south',
        'Whole route',
        'Move the pin north',
        'Move the pin south',
        'Move the pin east',
        'Move the pin west',
      ];
      const names = await page
        .locator('main button')
        .evaluateAll((elements) => elements.map((element) => element.textContent?.trim() ?? ''));
      expect(
        names.filter((name) => gone.includes(name)),
        'a text button row',
      ).toEqual([]);
      await expect(page.locator('main .oyl-map__moves')).toHaveCount(0);

      const cluster = page.getByRole('group', { name: 'Map controls' });
      await cluster.getByRole('button', { name: 'Put the pin at the map’s centre' }).click();
      const pin = page.getByRole('application', { name: 'The start pin' });
      await expect(pin).toHaveCount(1);

      const drawn = await pin.evaluate((element) => {
        const box = element.getBoundingClientRect();
        const art = element.querySelector('svg')?.getBoundingClientRect();
        return {
          text: element.textContent ?? '',
          scrollWidth: element.scrollWidth,
          clientWidth: element.clientWidth,
          inside:
            art !== undefined &&
            art.width > 0 &&
            art.left >= box.left - 0.5 &&
            art.right <= box.right + 0.5 &&
            art.top >= box.top - 0.5 &&
            art.bottom <= box.bottom + 0.5,
        };
      });
      console.log(`[#2889] ${viewport.name}: pin ${JSON.stringify(drawn)}`);
      expect(drawn.text, 'text on the pin, to be clipped').toBe('');
      expect(drawn.scrollWidth, 'the pin overflows its box').toBeLessThanOrEqual(drawn.clientWidth);
      expect(drawn.inside, 'the pin’s graphic runs outside the pin').toBe(true);

      const frame = await page.locator('main .oyl-map-frame').boundingBox();
      if (frame === null) throw new Error('no map frame');
      const buttons = await cluster.getByRole('button').evaluateAll((elements) =>
        elements.map((element) => {
          const box = element.getBoundingClientRect();
          return {
            name: element.textContent?.trim() ?? '',
            left: box.left,
            right: box.right,
            top: box.top,
            bottom: box.bottom,
          };
        }),
      );
      expect(buttons.map((button) => button.name)).toEqual([
        'Zoom in',
        'Zoom out',
        'Put the pin at the map’s centre',
        'Recentre the map',
      ]);
      const faults: string[] = [];
      for (const [index, a] of buttons.entries()) {
        const width = a.right - a.left;
        const height = a.bottom - a.top;
        if (width < LEAST_TARGET_PIXELS || height < LEAST_TARGET_PIXELS) {
          faults.push(`${a.name} is ${width.toFixed(1)}×${height.toFixed(1)} px`);
        }
        if (
          a.left < frame.x ||
          a.right > frame.x + frame.width ||
          a.top < frame.y ||
          a.bottom > frame.y + frame.height
        ) {
          faults.push(`${a.name} is not on the map`);
        }
        for (const b of buttons.slice(index + 1)) {
          const across = Math.max(b.left - a.right, a.left - b.right);
          const down = Math.max(b.top - a.bottom, a.top - b.bottom);
          if (Math.max(across, down) < LEAST_GAP_PIXELS) {
            faults.push(`${a.name} and ${b.name} touch`);
          }
        }
      }
      expect(faults, 'the map’s buttons').toEqual([]);
    });
  }

  test('the map still fills its frame after the window widens', async ({ page }) => {
    // A phone-wide window — the tablet's split screen — opened out to the
    // whole landscape tablet. Upright to landscape is no test of it: the
    // picker keeps the reading measure, so its map is 651 px wide both ways.
    const [landscape] = TABLETS;
    if (landscape === undefined) throw new Error('no landscape tablet');
    await openPicker(page, PHONE);
    const before = await mapFrame(page);
    expectFilled(before, PHONE.name);

    await page.setViewportSize({ width: landscape.width, height: landscape.height });
    // The frame widens with the column; wait for that, then for the canvas.
    await expect.poll(async () => (await mapFrame(page)).frame.width).not.toBe(before.frame.width);
    await expect
      .poll(async () => {
        const seen = await mapFrame(page);
        return Math.abs(seen.canvas.width - seen.frame.width) < 1.5;
      })
      .toBe(true);
    expectFilled(
      await mapFrame(page),
      `${PHONE.name} widened to ${String(landscape.width)}×${String(landscape.height)}`,
    );
  });

  /**
   * #3050: the owner dropped a pin on the tablet and saw no way to start. At
   * 1280×800 the page was 1,529 px tall and *Start the ride* stood at y ≈ 1,350,
   * under the map and both lists. Once a start is chosen — a pin, a saved
   * route, a past ride — the button must be on the screen where the rider is,
   * with nothing over it: its box between the top of the window and the fold
   * (`reflow-harness.tsx` §`foldLine`: the bottom inset, or a bottom bar), and
   * a hit test at its centre landing on it, so neither the sticky header nor
   * the navigation covers it. The rider does not scroll: a pin is dropped on
   * the map as the page opens, and a route or a ride is pressed where Playwright
   * scrolls it to, which is what a rider's own scroll to the list would do.
   *
   * The harness hands the picker a port (`?openworld=port`), as `main.tsx`
   * does; with none, as in every other walk, there is no button to find.
   */
  test.describe('#3050 — Start the ride is on screen once a start is chosen', () => {
    /** Where the button is, against the window, the fold and whatever is drawn over it. */
    async function startInView(page: Page): Promise<{
      top: number;
      bottom: number;
      fold: number;
      hit: boolean;
    }> {
      const button = page.getByRole('button', { name: 'Start the ride', exact: true });
      await expect(button).toHaveCount(1);
      return button.evaluate((element) => {
        const probe = document.createElement('div');
        probe.style.cssText =
          'position:fixed;visibility:hidden;padding-bottom:env(safe-area-inset-bottom,0px)';
        document.body.append(probe);
        const inset = Number.parseFloat(getComputedStyle(probe).paddingBottom);
        probe.remove();
        let fold = window.innerHeight - inset;
        const nav = document.querySelector('.oyl-nav');
        if (nav !== null && getComputedStyle(nav).position === 'fixed') {
          const bar = nav.getBoundingClientRect();
          if (bar.width >= window.innerWidth - 1 && bar.top > window.innerHeight / 2) {
            fold = Math.min(fold, bar.top);
          }
        }
        const box = element.getBoundingClientRect();
        const atCentre = document.elementFromPoint(
          box.left + box.width / 2,
          box.top + box.height / 2,
        );
        return {
          top: box.top,
          bottom: box.bottom,
          fold,
          hit: atCentre !== null && element.contains(atCentre),
        };
      });
    }

    function expectInView(seen: Awaited<ReturnType<typeof startInView>>, where: string): void {
      console.log(
        `[#3050] ${where}: Start the ride ${seen.top.toFixed(1)}–${seen.bottom.toFixed(1)}, ` +
          `fold ${seen.fold.toFixed(1)}, hit ${String(seen.hit)}`,
      );
      expect(seen.top, `${where}: Start the ride is above the window`).toBeGreaterThanOrEqual(0);
      expect(seen.bottom, `${where}: Start the ride is below the fold`).toBeLessThanOrEqual(
        seen.fold,
      );
      expect(seen.hit, `${where}: something is drawn over Start the ride`).toBe(true);
    }

    for (const viewport of [PHONE, ...TABLETS]) {
      test(`after a pin, a saved route and a past ride, on a ${viewport.name}`, async ({
        page,
      }) => {
        const canvas = await openPicker(page, viewport, 'data=populated&openworld=port');
        await expect(page.getByRole('button', { name: 'Start the ride', exact: true })).toHaveCount(
          0,
        );
        // A tap on the part of the map that is on the screen as the page opens.
        const fold = await page.evaluate(() => window.innerHeight);
        const seenBottom = Math.min(canvas.y + canvas.height, fold);
        await page.mouse.click(canvas.x + canvas.width / 2, (canvas.y + seenBottom) / 2);
        await expect(page.locator('main .oyl-map__waypoint--pin')).toHaveCount(1);
        expectInView(await startInView(page), `${viewport.name}, a pin`);

        // The next step, said where the pin's drop is said.
        const said = page.locator('section[aria-labelledby="oyl-open-world-pin"] [role="status"]');
        await expect(said).toHaveText(/^Pin dropped\. .*Start the ride/u);

        // The map's own buttons (`z-index` 1) pass beneath the bar, not over
        // it: scrolled so the first of them is behind the bar's middle, a hit
        // test there lands on the bar. They stand at the top of the map, above
        // the bar at every size, so a spacer the height of the window is put
        // above the view first, for the page to scroll them up through it.
        const beneath = await page.evaluate((height) => {
          const bar = document.querySelector('.oyl-open-world__go');
          const control = document.querySelector('main .oyl-map__controls button');
          const main = document.querySelector('.oyl-main');
          if (bar === null || control === null || main === null) {
            throw new Error('no bar, no map button or no main');
          }
          const spacer = document.createElement('div');
          spacer.style.height = `${String(height)}px`;
          main.prepend(spacer);
          const middle = (): number => {
            const box = bar.getBoundingClientRect();
            return box.top + box.height / 2;
          };
          const first = control.getBoundingClientRect();
          globalThis.scrollBy(0, first.top + first.height / 2 - middle());
          const now = control.getBoundingClientRect();
          const hit = document.elementFromPoint(now.left + now.width / 2, middle());
          const seen = {
            behind: Math.abs(now.top + now.height / 2 - middle()) < 2,
            onBar: hit !== null && bar.contains(hit),
          };
          spacer.remove();
          return seen;
        }, viewport.height);
        expect(beneath.behind, 'the map’s button was not scrolled behind the bar').toBe(true);
        expect(beneath.onBar, 'the map’s button is drawn over the bar').toBe(true);

        await page.getByRole('button', { name: 'The mill loop' }).click();
        expectInView(await startInView(page), `${viewport.name}, a saved route`);

        await page.getByRole('button', { name: /^Morning ride, / }).click();
        expectInView(await startInView(page), `${viewport.name}, a past ride`);

        // Tab never stops on a control drawn under the pinned button (WCAG 2.2
        // SC 2.4.11): `theme.css` §"#3050"'s scroll padding. As
        // `shell.browser.spec.ts` §`lowestFocusedBottom` does, a column of
        // buttons 16 px apart is Tabbed down from the top, so each press
        // scrolls the next one only just into view, against the bottom edge.
        const presses = await page.evaluate((height) => {
          const main = document.querySelector('.oyl-main');
          if (main === null) throw new Error('no .oyl-main');
          const column = document.createElement('div');
          column.dataset['oylProbe'] = 'column';
          for (let index = 0; index < Math.ceil((height * 2) / 60); index += 1) {
            const control = document.createElement('button');
            control.type = 'button';
            control.textContent = `Probe ${String(index)}`;
            control.style.display = 'block';
            control.style.marginBlock = '16px';
            column.append(control);
          }
          main.prepend(column);
          globalThis.scrollTo(0, 0);
          column.querySelector('button')?.focus({ preventScroll: true });
          return column.querySelectorAll('button').length - 1;
        }, viewport.height);
        const under: string[] = [];
        for (let press = 0; press < presses; press += 1) {
          await page.keyboard.press('Tab');
          const at = await page.evaluate(() => {
            const focused = document.activeElement;
            const bar = document.querySelector('.oyl-open-world__go');
            if (focused?.closest('[data-oyl-probe="column"]') == null || bar === null) {
              throw new Error('Tab left the probe column, or the bar is gone');
            }
            return {
              name: focused.textContent ?? '',
              bottom: focused.getBoundingClientRect().bottom,
              barTop: bar.getBoundingClientRect().top,
            };
          });
          if (at.bottom > at.barTop + 0.5) {
            under.push(`${at.name}: bottom ${at.bottom.toFixed(1)}, bar ${at.barTop.toFixed(1)}`);
          }
        }
        console.log(
          `[#3050] ${viewport.name}: ${String(presses)} Tab presses, ` +
            `${String(under.length)} under the bar`,
        );
        expect(under, 'focus drawn under the pinned Start the ride').toEqual([]);

        await page.getByRole('button', { name: 'Start the ride', exact: true }).click();
        expect(await page.evaluate(() => window.__oylOpenWorldBegun)).toBe(1);
      });
    }
  });

  test.describe('with a mouse and a keyboard, on the landscape tablet', () => {
    const [landscape] = TABLETS;
    if (landscape === undefined) throw new Error('no landscape tablet');

    test('a click drops the pin where it lands', async ({ page }) => {
      const canvas = await openPicker(page, landscape);
      const tip = await dropAt(page, canvas, 90, 50);
      const aimed = { x: canvas.width / 2 + 90, y: canvas.height / 2 + 50 };
      console.log(`[#2889] click at ${JSON.stringify(aimed)}, pin tip ${JSON.stringify(tip)}`);
      expect(apart(tip, aimed), 'the pin’s tip from the click').toBeLessThan(3);
    });

    test('the wheel zooms in about the pointer', async ({ page }) => {
      const canvas = await openPicker(page, landscape);
      const pointer = { x: canvas.width / 2, y: canvas.height / 2 };
      const before = apart(await dropAt(page, canvas, 120, 60), pointer);
      await page.mouse.move(canvas.x + pointer.x, canvas.y + pointer.y);
      for (let notch = 0; notch < 3; notch += 1) {
        await page.mouse.wheel(0, -200);
      }
      const after = apart(await settledPin(page), pointer);
      console.log(
        `[#2889] wheel: pin ${before.toFixed(1)} → ${after.toFixed(1)} px from the pointer`,
      );
      expect(after, 'the pin from the pointer, after the wheel').toBeGreaterThan(before * 1.5);
    });

    test('a mouse drag pans the map', async ({ page }) => {
      const canvas = await openPicker(page, landscape);
      const before = await dropAt(page, canvas, 120, 60);
      const from = { x: canvas.x + canvas.width / 2 - 100, y: canvas.y + canvas.height / 2 - 40 };
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      for (let step = 1; step <= 10; step += 1) {
        await page.mouse.move(from.x - step * 12, from.y - step * 6);
      }
      await page.mouse.up();
      const after = await settledPin(page);
      console.log(`[#2889] drag: pin ${JSON.stringify(before)} → ${JSON.stringify(after)}`);
      // A drag of (-120, -60), and inertia may carry it a little further.
      expect(after.x - before.x, 'across').toBeLessThan(-100);
      expect(after.y - before.y, 'down').toBeLessThan(-45);
    });

    test('arrow keys pan the focused map, and = and - zoom it', async ({ page }) => {
      const canvas = await openPicker(page, landscape);
      const centre = { x: canvas.width / 2, y: canvas.height / 2 };
      const start = await dropAt(page, canvas, 120, 60);
      const map = page.getByRole('application', {
        name: 'Map for placing the start of an open-world ride.',
      });
      await map.focus();
      await expect(map).toBeFocused();

      await page.keyboard.press('ArrowLeft');
      const panned = await settledPin(page);
      console.log(`[#2889] ArrowLeft: pin ${JSON.stringify(start)} → ${JSON.stringify(panned)}`);
      // The view moves west, so what is on it moves east.
      expect(panned.x - start.x, 'ArrowLeft').toBeGreaterThan(50);

      const before = apart(panned, centre);
      await page.keyboard.press('Equal');
      const zoomedIn = apart(await settledPin(page), centre);
      expect(zoomedIn, '= zooms in').toBeGreaterThan(before * 1.5);
      await page.keyboard.press('Minus');
      const zoomedOut = apart(await settledPin(page), centre);
      expect(zoomedOut, '- zooms out').toBeLessThan(zoomedIn / 1.5);
    });

    test('an arrow key on the focused pin moves the pin, says so, and leaves the map', async ({
      page,
    }) => {
      const canvas = await openPicker(page, landscape);
      const before = await dropAt(page, canvas, 120, 60);
      const pin = page.getByRole('application', { name: 'The start pin' });
      await pin.focus();
      await expect(pin).toBeFocused();
      await page.keyboard.press('ArrowUp');
      const said = page.locator('section[aria-labelledby="oyl-open-world-pin"] [role="status"]');
      await expect(said).toHaveText('Pin moved north.');
      const after = await settledPin(page);
      console.log(`[#2889] pin ArrowUp: ${JSON.stringify(before)} → ${JSON.stringify(after)}`);
      // About 55 m north is under a pixel at the whole-country view. Had the
      // key reached the map as well, the map would have moved 100 px.
      expect(Math.abs(after.y - before.y), 'the map moved under the pin').toBeLessThan(10);
      expect(after.y, 'the pin went south').toBeLessThanOrEqual(before.y + 0.5);
      await expect(pin).toBeFocused();
    });

    test('the pin is an application named for a screen reader, and leaves Alt+arrow alone (#2985)', async ({
      page,
    }) => {
      const canvas = await openPicker(page, landscape);
      const before = await dropAt(page, canvas, 120, 60);
      const pin = page.getByRole('application', { name: 'The start pin' });
      await expect(pin).toHaveAttribute('aria-roledescription', 'pin');
      await pin.focus();
      const said = page.locator('section[aria-labelledby="oyl-open-world-pin"] [role="status"]');
      await expect(said).toHaveText('Pin dropped.');
      for (const modifier of ['Alt', 'Control', 'Meta']) {
        await page.keyboard.press(`${modifier}+ArrowUp`);
      }
      const after = await settledPin(page);
      console.log(`[#2985] Alt+ArrowUp: ${JSON.stringify(before)} → ${JSON.stringify(after)}`);
      await expect(said, 'a modified arrow nudged the pin').toHaveText('Pin dropped.');
    });

    test('a double click drops the pin once and says so once (#2985)', async ({ page }) => {
      const canvas = await openPicker(page, landscape);
      // Every node the pin's live region is handed: one per drop it says.
      await page.evaluate(() => {
        const region = document.querySelector(
          'section[aria-labelledby="oyl-open-world-pin"] [role="status"]',
        );
        if (region === null) throw new Error('no live region for the pin');
        const seen: string[] = [];
        (globalThis as unknown as { pinSaid: string[] }).pinSaid = seen;
        new MutationObserver((records) => {
          for (const record of records) {
            for (const node of record.addedNodes) seen.push(node.textContent ?? '');
          }
        }).observe(region, { childList: true, subtree: true });
      });
      const at = { x: canvas.x + canvas.width / 2 + 120, y: canvas.y + canvas.height / 2 + 60 };
      await page.mouse.dblclick(at.x, at.y);
      await expect(page.locator('main .oyl-map__waypoint--pin')).toHaveCount(1);
      await settledPin(page);
      const said = await page.evaluate(
        () => (globalThis as unknown as { pinSaid: string[] }).pinSaid,
      );
      console.log(`[#2985] double click said ${JSON.stringify(said)}`);
      expect(said, 'the double click dropped the pin twice').toEqual(['Pin dropped.']);
    });
  });

  test.describe('on a touch screen, on the landscape tablet', () => {
    test.use({ hasTouch: true });
    const [landscape] = TABLETS;
    if (landscape === undefined) throw new Error('no landscape tablet');

    /** One touch gesture from `from` to `to`, a list of fingers each, in ten steps. */
    async function touch(
      page: Page,
      from: readonly { x: number; y: number }[],
      to: readonly { x: number; y: number }[],
    ): Promise<void> {
      const cdp = await page.context().newCDPSession(page);
      const at = (step: number): { x: number; y: number; id: number }[] =>
        from.map((finger, id) => {
          const end = to[id] ?? finger;
          return {
            x: finger.x + ((end.x - finger.x) * step) / 10,
            y: finger.y + ((end.y - finger.y) * step) / 10,
            id,
          };
        });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: at(0) });
      for (let step = 1; step <= 10; step += 1) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: at(step) });
      }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    }

    async function pinnedPicker(page: Page): Promise<{
      canvas: Box;
      centre: { x: number; y: number };
      before: { x: number; y: number };
    }> {
      if (landscape === undefined) throw new Error('no landscape tablet');
      const canvas = await openPicker(page, landscape);
      await page
        .getByRole('group', { name: 'Map controls' })
        .getByRole('button', { name: 'Put the pin at the map’s centre' })
        .click();
      await expect(page.locator('main .oyl-map__waypoint--pin')).toHaveCount(1);
      // A pin away from the centre, so a zoom moves it; dropped by a tap.
      await page.touchscreen.tap(
        canvas.x + canvas.width / 2 + 110,
        canvas.y + canvas.height / 2 + 50,
      );
      await expect.poll(async () => (await pinTip(page)).x).toBeGreaterThan(canvas.width / 2 + 100);
      const now = (await mapFrame(page)).canvas;
      return {
        canvas: now,
        centre: { x: now.x + now.width / 2, y: now.y + now.height / 2 },
        before: await settledPin(page),
      };
    }

    /**
     * How far the page has scrolled: the document and every box the map sits
     * in, so the reading does not depend on which of them the shell scrolls.
     */
    async function pageScrolled(page: Page): Promise<number> {
      return page.evaluate(() => {
        let total = globalThis.scrollY;
        let box = document.querySelector('main .oyl-map')?.parentElement ?? null;
        while (box !== null) {
          total += box.scrollTop;
          box = box.parentElement;
        }
        return total;
      });
    }

    test('one finger drags the map, and a tap after it still drops the pin (#3014)', async ({
      page,
    }) => {
      const { before } = await pinnedPicker(page);
      // From the top, so a page that took the swipe would have room to scroll.
      await page.evaluate(() => {
        globalThis.scrollTo(0, 0);
        let box = document.querySelector('main .oyl-map')?.parentElement ?? null;
        while (box !== null) {
          box.scrollTop = 0;
          box = box.parentElement;
        }
      });
      const top = await pageScrolled(page);
      // Where the map is now: the scroll may have moved it on the screen.
      const canvas = (await mapFrame(page)).canvas;
      const centre = { x: canvas.x + canvas.width / 2, y: canvas.y + canvas.height / 2 };
      // A finger drawn up the map, (-60, -160): a swipe that scrolled the
      // page while one finger was left to it.
      const drag = { x: -60, y: -160 };
      const from = { x: centre.x + 30, y: centre.y + 100 };
      await touch(page, [from], [{ x: from.x + drag.x, y: from.y + drag.y }]);
      const after = await settledPin(page);
      const scrolled = (await pageScrolled(page)) - top;
      console.log(
        `[#3014] one finger: ${JSON.stringify(before)} → ${JSON.stringify(after)}, ` +
          `page scrolled ${scrolled.toFixed(1)} px`,
      );
      // The pin stands still on the ground, so it moves on the screen exactly
      // as the map's centre does. Lifted, the finger is 90 px from there, so a
      // drag that dropped the pin instead of panning fails this too.
      const carried = { x: before.x + drag.x, y: before.y + drag.y };
      expect(apart(after, carried), 'one finger did not carry the map with it').toBeLessThan(20);
      expect(Math.abs(scrolled), 'the drag scrolled the page as well').toBeLessThan(3);

      const aimed = { x: canvas.width / 2 - 70, y: canvas.height / 2 - 40 };
      await page.touchscreen.tap(canvas.x + aimed.x, canvas.y + aimed.y);
      const tip = await settledPin(page);
      console.log(`[#3014] tap at ${JSON.stringify(aimed)}, pin tip ${JSON.stringify(tip)}`);
      expect(apart(tip, aimed), 'the pin’s tip from the tap').toBeLessThan(3);
    });

    test('two fingers pan the map', async ({ page }) => {
      const { centre, before } = await pinnedPicker(page);
      await touch(
        page,
        [
          { x: centre.x - 80, y: centre.y - 40 },
          { x: centre.x - 20, y: centre.y - 40 },
        ],
        [
          { x: centre.x - 200, y: centre.y - 40 },
          { x: centre.x - 140, y: centre.y - 40 },
        ],
      );
      const after = await settledPin(page);
      console.log(`[#2889] two fingers: ${JSON.stringify(before)} → ${JSON.stringify(after)}`);
      expect(after.x - before.x, 'two fingers did not pan the map').toBeLessThan(-80);
    });

    test('a pinch zooms the map', async ({ page }) => {
      const { canvas, centre, before } = await pinnedPicker(page);
      const middle = { x: centre.x - canvas.x, y: centre.y - canvas.y };
      const near = apart(before, middle);
      await touch(
        page,
        [
          { x: centre.x - 30, y: centre.y },
          { x: centre.x + 30, y: centre.y },
        ],
        [
          { x: centre.x - 150, y: centre.y },
          { x: centre.x + 150, y: centre.y },
        ],
      );
      const after = apart(await settledPin(page), middle);
      console.log(`[#2889] pinch: pin ${near.toFixed(1)} → ${after.toFixed(1)} px from the middle`);
      expect(after, 'the pinch did not zoom in').toBeGreaterThan(near * 1.5);
    });
  });
});

/**
 * #3134 — the route planner's map and the route editor's, moved by touch on
 * the landscape tablet, as the open-world picker's is (§"#2889" above).
 *
 * The owner found on the tablet (build 1124c) that a finger on the planner's
 * map did nothing: a one-finger drag did not pan it, a pinch did not zoom it,
 * and its compass buttons were the only way to move it. `map/maplibre.ts`
 * §`EXPLORABLE` turns MapLibre's touch pan off on an explorable map (#2003),
 * so that a thumb on a saved route's map scrolls the page; on a map a rider
 * draws on, that left nothing to move it by hand. These cases are #3134's
 * acceptance, in `reflow.html`'s real shell at the tablet's 1280×800 with its
 * insets and touch emulation:
 *
 * - **One finger on empty map pans it**, the page does not scroll under it,
 *   and no waypoint is added.
 * - **A pinch zooms it**, and no waypoint is added.
 * - **A tap still adds a waypoint, and a finger on a waypoint still moves
 *   it** — the waypoint, and not the map under it.
 * - **The route editor's map pans by one finger as well**: it is the same
 *   editable map.
 *
 * Every movement is read off a marker: a marker stands still on the ground,
 * so it moves on the screen exactly as the map does. The planner's waypoint
 * list is read as well, so a drag that added a point fails twice.
 *
 * ⚠️ Not proved here: how a real finger on the owner's tablet feels — #3134's
 * third criterion is the owner's.
 */
test.describe('#3134 — the route planner’s map moves by touch on the landscape tablet', () => {
  test.use({ hasTouch: true });
  const [landscape] = TABLETS;

  interface Point {
    readonly x: number;
    readonly y: number;
  }

  interface Canvas extends Point {
    readonly width: number;
    readonly height: number;
  }

  function apart(a: Point, b: Point): number {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  /** The map's canvas as the engine laid it out, on the screen. */
  async function mapCanvas(page: Page): Promise<Canvas> {
    return page.evaluate(() => {
      const canvas = document.querySelector('main .oyl-map canvas');
      if (!(canvas instanceof HTMLCanvasElement)) throw new Error('no map canvas');
      const box = canvas.getBoundingClientRect();
      return { x: box.x, y: box.y, width: box.width, height: box.height };
    });
  }

  /** Each marker's centre, from the canvas's top left, by the number it shows. */
  async function markers(page: Page): Promise<Record<string, Point>> {
    return page.evaluate(() => {
      const canvas = document.querySelector('main .oyl-map canvas');
      if (canvas === null) throw new Error('no map canvas');
      const origin = canvas.getBoundingClientRect();
      const seen: Record<string, { x: number; y: number }> = {};
      for (const marker of document.querySelectorAll('main .oyl-map .oyl-map__waypoint')) {
        const box = marker.getBoundingClientRect();
        seen[marker.textContent] = {
          x: box.left + box.width / 2 - origin.left,
          y: box.top + box.height / 2 - origin.top,
        };
      }
      return seen;
    });
  }

  /** One marker, once the camera has stopped: two readings a moment apart agree. */
  async function settled(page: Page, label: string): Promise<Point> {
    // MapLibre's ease, and a pan's inertia, begin a frame after the finger lifts.
    await page.waitForTimeout(400);
    const read = async (): Promise<Point> => {
      const at = (await markers(page))[label];
      if (at === undefined) throw new Error(`no marker ${label} on the map`);
      return at;
    };
    let last = await read();
    await expect
      .poll(async () => {
        await page.waitForTimeout(150);
        const next = await read();
        const still = apart(last, next) < 0.5;
        last = next;
        return still;
      })
      .toBe(true);
    return last;
  }

  /** One touch gesture from `from` to `to`, a list of fingers each, in ten steps. */
  async function touch(page: Page, from: readonly Point[], to: readonly Point[]): Promise<void> {
    const cdp = await page.context().newCDPSession(page);
    const at = (step: number): { x: number; y: number; id: number }[] =>
      from.map((finger, id) => {
        const end = to[id] ?? finger;
        return {
          x: finger.x + ((end.x - finger.x) * step) / 10,
          y: finger.y + ((end.y - finger.y) * step) / 10,
          id,
        };
      });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: at(0) });
    for (let step = 1; step <= 10; step += 1) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: at(step) });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }

  /**
   * How far the page has scrolled: the document and every box the map sits
   * in, so the reading does not depend on which of them the shell scrolls.
   */
  async function pageScrolled(page: Page): Promise<number> {
    return page.evaluate(() => {
      let total = globalThis.scrollY;
      let box = document.querySelector('main .oyl-map')?.parentElement ?? null;
      while (box !== null) {
        total += box.scrollTop;
        box = box.parentElement;
      }
      return total;
    });
  }

  /** The markers on the map. */
  function onMap(page: Page): ReturnType<Page['locator']> {
    return page.locator('main .oyl-map .oyl-map__waypoint');
  }

  /** The waypoints in the planner's list, which is what a save would keep. */
  function listed(page: Page): ReturnType<Page['locator']> {
    return page.locator('main').getByRole('button', { name: /^Delete waypoint \d+$/ });
  }

  /** Opens a route over a fixture, scrolled so that its map is on the screen. */
  async function openWithMap(
    page: Page,
    route: RouteId,
    data: 'empty' | 'populated',
  ): Promise<Canvas> {
    if (landscape === undefined) throw new Error('no landscape tablet');
    await open(page, landscape, `data=${data}`);
    await visit(page, routeById(route));
    await expect(page.locator('main .oyl-map canvas')).toHaveCount(1);
    await page.locator('main .oyl-map').scrollIntoViewIfNeeded();
    return mapCanvas(page);
  }

  /**
   * The planner with no draft — the populated fixture seeds one — and one
   * waypoint tapped down away from the map's centre, so that a zoom moves it.
   */
  async function plannerWithOne(page: Page): Promise<{ canvas: Canvas; before: Point }> {
    const canvas = await openWithMap(page, 'route-builder', 'empty');
    const aimed = { x: canvas.width / 2 + 110, y: canvas.height / 2 + 50 };
    await page.touchscreen.tap(canvas.x + aimed.x, canvas.y + aimed.y);
    await expect(onMap(page)).toHaveCount(1);
    const before = await settled(page, '1');
    expect(apart(before, aimed), 'the tapped waypoint from the tap').toBeLessThan(3);
    return { canvas, before };
  }

  test('one finger on empty map pans it, scrolls nothing and adds no waypoint', async ({
    page,
  }) => {
    const { canvas, before } = await plannerWithOne(page);
    await expect(listed(page)).toHaveCount(1);
    const top = await pageScrolled(page);
    const centre = { x: canvas.x + canvas.width / 2, y: canvas.y + canvas.height / 2 };
    // From the far side of the centre to the waypoint, up and to the left.
    const drag = { x: -80, y: -100 };
    const from = { x: centre.x - 100, y: centre.y + 60 };
    await touch(page, [from], [{ x: from.x + drag.x, y: from.y + drag.y }]);
    const after = await settled(page, '1');
    const scrolled = (await pageScrolled(page)) - top;
    console.log(
      `[#3134] one finger: ${JSON.stringify(before)} → ${JSON.stringify(after)}, ` +
        `page scrolled ${scrolled.toFixed(1)} px`,
    );
    const carried = { x: before.x + drag.x, y: before.y + drag.y };
    expect(apart(after, carried), 'one finger did not carry the map with it').toBeLessThan(20);
    expect(Math.abs(scrolled), 'the drag scrolled the page as well').toBeLessThan(3);
    await expect(onMap(page)).toHaveCount(1);
    await expect(listed(page)).toHaveCount(1);
  });

  test('a pinch zooms it and adds no waypoint', async ({ page }) => {
    const { canvas, before } = await plannerWithOne(page);
    const middle = { x: canvas.width / 2, y: canvas.height / 2 };
    const near = apart(before, middle);
    const centre = { x: canvas.x + middle.x, y: canvas.y + middle.y };
    await touch(
      page,
      [
        { x: centre.x - 30, y: centre.y - 20 },
        { x: centre.x + 30, y: centre.y - 20 },
      ],
      [
        { x: centre.x - 150, y: centre.y - 20 },
        { x: centre.x + 150, y: centre.y - 20 },
      ],
    );
    const after = apart(await settled(page, '1'), middle);
    console.log(
      `[#3134] pinch: marker ${near.toFixed(1)} → ${after.toFixed(1)} px from the middle`,
    );
    expect(after, 'the pinch did not zoom in').toBeGreaterThan(near * 1.5);
    await expect(onMap(page)).toHaveCount(1);
    await expect(listed(page)).toHaveCount(1);
  });

  test('a pinch whose first finger lands and moves first zooms it too', async ({ page }) => {
    const { canvas, before } = await plannerWithOne(page);
    const middle = { x: canvas.width / 2, y: canvas.height / 2 };
    const near = apart(before, middle);
    const centre = { x: canvas.x + middle.x, y: canvas.y + middle.y };
    const top = await pageScrolled(page);
    const cdp = await page.context().newCDPSession(page);
    const y = centre.y - 20;
    // A real hand: one finger is down and drifting before the other lands.
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: centre.x - 30, y, id: 0 }],
    });
    for (let step = 1; step <= 3; step += 1) {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: centre.x - 30, y: y - step * 8, id: 0 }],
      });
    }
    const first = { x: centre.x - 30, y: y - 24 };
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [
        { ...first, id: 0 },
        { x: centre.x + 30, y: first.y, id: 1 },
      ],
    });
    for (let step = 1; step <= 10; step += 1) {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [
          { x: first.x - step * 12, y: first.y, id: 0 },
          { x: centre.x + 30 + step * 12, y: first.y, id: 1 },
        ],
      });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    const after = apart(await settled(page, '1'), middle);
    const scrolled = (await pageScrolled(page)) - top;
    console.log(
      `[#3134] staggered pinch: marker ${near.toFixed(1)} → ${after.toFixed(1)} px from the ` +
        `middle, page scrolled ${scrolled.toFixed(1)} px`,
    );
    expect(after, 'the pinch did not zoom in').toBeGreaterThan(near * 1.5);
    expect(Math.abs(scrolled), 'the pinch scrolled the page').toBeLessThan(3);
    await expect(onMap(page)).toHaveCount(1);
  });

  test('a tap adds a waypoint, and a finger on a waypoint moves it and not the map', async ({
    page,
  }) => {
    const { canvas, before } = await plannerWithOne(page);
    await page.touchscreen.tap(
      canvas.x + canvas.width / 2 - 120,
      canvas.y + canvas.height / 2 - 60,
    );
    await expect(onMap(page)).toHaveCount(2);
    await expect(listed(page)).toHaveCount(2);
    const second = await settled(page, '2');

    const drag = { x: 60, y: 70 };
    const from = { x: canvas.x + before.x, y: canvas.y + before.y };
    await touch(page, [from], [{ x: from.x + drag.x, y: from.y + drag.y }]);
    const moved = await settled(page, '1');
    const stayed = await settled(page, '2');
    console.log(
      `[#3134] marker 1 ${JSON.stringify(before)} → ${JSON.stringify(moved)}, ` +
        `marker 2 ${JSON.stringify(second)} → ${JSON.stringify(stayed)}`,
    );
    const carried = { x: before.x + drag.x, y: before.y + drag.y };
    expect(apart(moved, carried), 'the waypoint did not follow the finger').toBeLessThan(5);
    expect(apart(stayed, second), 'the map moved under the waypoint').toBeLessThan(3);
    await expect(onMap(page)).toHaveCount(2);
    await expect(listed(page)).toHaveCount(2);
  });

  test('the route editor’s map pans by one finger as well', async ({ page }) => {
    const canvas = await openWithMap(page, 'route-editor', 'populated');
    // A tap picks the place on the line nearest it: the stretch's marker A.
    await page.touchscreen.tap(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);
    await expect(onMap(page)).toHaveCount(1);
    const label = 'A';
    const before = await settled(page, label);
    // A finger on empty map: the corner farthest from the marker.
    const [corner] = [
      { x: 40, y: 40 },
      { x: canvas.width - 40, y: 40 },
      { x: 40, y: canvas.height - 40 },
      { x: canvas.width - 40, y: canvas.height - 40 },
    ].sort((a, b) => apart(b, before) - apart(a, before));
    if (corner === undefined) throw new Error('no corner');
    const drag = {
      x: corner.x < canvas.width / 2 ? 60 : -60,
      y: corner.y < canvas.height / 2 ? 60 : -60,
    };
    const from = { x: canvas.x + corner.x, y: canvas.y + corner.y };
    await touch(page, [from], [{ x: from.x + drag.x, y: from.y + drag.y }]);
    const after = await settled(page, label);
    console.log(`[#3134] editor one finger: ${JSON.stringify(before)} → ${JSON.stringify(after)}`);
    const carried = { x: before.x + drag.x, y: before.y + drag.y };
    expect(apart(after, carried), 'one finger did not carry the editor’s map').toBeLessThan(20);
    // A drag is not a tap: it picked no second place, so there is still no B.
    expect(Object.keys(await markers(page))).toEqual([label]);
  });
});

/**
 * #2065 — the title block costs less than half what it did.
 *
 * Every route in `ALL_ROUTES` is opened in `reflow.html` at the owner's tablet
 * size and at a phone, and its title block is measured: from the top of
 * `main` to the bottom of the line under the `h1`. Every route must come in at
 * no more than HALF of the tallest title block the same walk measures with
 * today's rules put back ({@link TITLE_BLOCK_AS_IT_WAS}) — the control, in
 * the same engine and the same fonts, so a runner whose system face sets the
 * line wider moves both figures together. And the control itself must fail:
 * every route's old title block is over that ceiling.
 *
 * Measured in the pinned Chromium on macOS, 2026-11-04 (CSS px; before is
 * the control, after the shipped rules):
 *
 *   1280×800  before 107.8 on most routes, 115.8 on a list–detail route and
 *             66.8 on Ride (#422 had put its line beside the title); the
 *             ceiling is 57.9. After: 53.8 on every route.
 *   412×915   before 107.8 where the line took one row, 132.6 where it took
 *             two and 175.5 where the title took two (Instance, Not found);
 *             the ceiling is 87.8. After: 62.8 where the line wraps under
 *             the title on one row, 83.6 where it takes two, and 64.6 where
 *             a short title leaves it 20rem to sit beside it (Ride, More).
 *
 * ⚠️ **Why half of the TALLEST, and not half of each route's own.** The
 * issue's criterion is "half of today's measured value", one value, and the
 * reason it gives is the 100–150 px every screen spent. Half of each route's
 * own figure cannot be met by any layout that keeps the line at the body
 * size: a phone route whose title and line took 108 px would need both in
 * 54 px, and a title row and two rows of 16 px text are more than that with
 * no padding at all. The per-route figures are printed so that the owner's
 * before-and-after review sees every one of them.
 *
 * ## What it does NOT prove
 *
 * A real tablet's or phone's system face, which sets the line; or a text size
 * above 100 %, where the line wraps sooner. The figures are printed so a near
 * miss is visible.
 */
const TITLE_BLOCK_VIEWPORTS = [
  { name: 'tablet 1280×800', width: 1280, height: 800 },
  { name: 'phone 412×915', width: 412, height: 915 },
] as const;

/**
 * The title block's rules as they were before #2065, put back over the
 * shipping stylesheet. `display: contents` takes the box away, so the `h1`,
 * the line and the help lay out as `main`'s own children again, under the
 * display step, the paragraph's margins and `main`'s `lg` top padding — and,
 * on Ride from 60rem, #422's two grid columns.
 */
const TITLE_BLOCK_AS_IT_WAS = `
  .oyl-main { padding-top: var(--oyl-space-lg) !important; }
  .oyl-main:has(.oyl-help) { position: relative; }
  .oyl-view-head { display: contents; }
  .oyl-view-head > h1 { font-size: var(--oyl-font-size-display); margin: 0 0 var(--oyl-space-sm); }
  .oyl-main:has(.oyl-help) .oyl-view-head > h1 {
    padding-inline-end: calc(2.75rem + var(--oyl-space-sm));
  }
  .oyl-view-head > h1 + p { flex: none; margin: 1em 0; line-height: inherit; }
  @media (min-width: 60rem) {
    .oyl-main--instruments {
      grid-template-columns: auto minmax(0, 1fr);
      column-gap: var(--oyl-space-lg);
    }
    .oyl-main--instruments > *,
    .oyl-main--instruments .oyl-view-head > * { grid-column: 1 / -1; }
    .oyl-main--instruments .oyl-view-head > h1 {
      grid-column: 1;
      align-self: baseline;
      margin-bottom: var(--oyl-space-md);
    }
    .oyl-main--instruments .oyl-view-head > h1 + p {
      grid-column: 2;
      align-self: baseline;
      margin: 0 0 var(--oyl-space-md);
    }
  }
`;

/** Every route's title block: the top of `main` to the bottom of the line under the `h1`. */
async function titleBlocks(
  page: Page,
  viewport: (typeof TITLE_BLOCK_VIEWPORTS)[number],
  asItWas: boolean,
): Promise<ReadonlyMap<RouteId, number>> {
  await open(page, { ...viewport, margin: 0, consentBelowFold: [], summaryLines: 2 }, 'data=empty');
  if (asItWas) {
    await page.addStyleTag({ content: TITLE_BLOCK_AS_IT_WAS });
  }
  const heights = new Map<RouteId, number>();
  for (const route of ALL_ROUTES) {
    await visit(page, route);
    const height = await page.evaluate(() => {
      const main = document.querySelector('main');
      const line = document.querySelector('main > .oyl-view-head > h1 + p');
      if (main === null || line === null) return null;
      return line.getBoundingClientRect().bottom - main.getBoundingClientRect().top;
    });
    if (height === null) {
      throw new Error(`${route.id}: no line under the title to measure`);
    }
    heights.set(route.id, height);
  }
  const unvisited = await page.evaluate(() => window.__oylReflow?.unvisited());
  expect(unvisited, 'routes in ALL_ROUTES the walk never opened').toEqual([]);
  return heights;
}

test.describe('#2065 — the title block costs less than half what it did', () => {
  for (const viewport of TITLE_BLOCK_VIEWPORTS) {
    test(`on every route, at a ${viewport.name}`, async ({ browser }, info) => {
      test.setTimeout(180_000);
      const asItWas = await browser.newPage();
      const before = await titleBlocks(asItWas, viewport, true);
      await asItWas.close();
      const shipped = await browser.newPage();
      const after = await titleBlocks(shipped, viewport, false);
      await shipped.close();

      const ceiling = Math.max(...before.values()) / 2;
      const lines = ALL_ROUTES.map(
        (route) =>
          `${route.id}: ${(before.get(route.id) ?? Number.NaN).toFixed(1)} → ` +
          `${(after.get(route.id) ?? Number.NaN).toFixed(1)} px`,
      );
      const published = `ceiling ${ceiling.toFixed(1)} px, half of the tallest before`;
      console.log(`#2065 title block, ${viewport.name}, ${published}\n  ${lines.join('\n  ')}`);
      info.annotations.push({
        type: 'title block',
        description: `${published}; ${lines.join('; ')}`,
      });

      const over = ALL_ROUTES.filter((route) => (after.get(route.id) ?? Infinity) > ceiling).map(
        (route) => `${route.id}: ${(after.get(route.id) ?? Number.NaN).toFixed(1)} px`,
      );
      expect(over, `title blocks over ${ceiling.toFixed(1)} px`).toEqual([]);
      // The control: today's rules fail on every route, or the ceiling is one
      // the old layout met somewhere and the case above proves less than it says.
      const metAsItWas = ALL_ROUTES.filter((route) => (before.get(route.id) ?? 0) <= ceiling).map(
        (route) => route.id,
      );
      expect(metAsItWas, 'routes whose OLD title block is within the ceiling').toEqual([]);
    });
  }
});

/**
 * #3185 — the route planner's distance and climbing, on the screen with its
 * map.
 *
 * The UI evaluation of PR 3149 found the totals under the legs table and the
 * surface choice: 2196 px down on a phone, off the tablet's screen as the
 * legs grew, so a rider dragged a waypoint, scrolled two screens to read the
 * result, and scrolled back. The strip (`views/RouteBuilderView.tsx`
 * §"The numbers beside the map") is directly above the map. Measured here, in
 * `reflow.html`'s real shell over the populated fixture's draft, at the phone
 * and the tablet both ways up: with the map scrolled onto the screen, the
 * strip is on it too, whole, uncovered (a hit test at its centre lands in
 * it), and nothing stands between the strip and the map.
 *
 * ⚠️ Not proved here: the map's own share of the screen, which #3185's
 * second suggestion asks for and its lane leaves for later.
 */
test.describe('#3185 — the route planner’s distance and climbing stay on the screen with its map', () => {
  for (const viewport of [PHONE, ...TABLETS]) {
    test(`directly above the map, and on the screen with it, at a ${viewport.name}`, async ({
      page,
    }) => {
      await open(page, viewport, 'data=populated');
      await visit(page, routeById('route-builder'));
      await expect(page.locator('main .oyl-map canvas')).toHaveCount(1);
      await expect(page.locator('main .oyl-planner__summary')).toHaveCount(1);
      await page.locator('main .oyl-map').scrollIntoViewIfNeeded();
      const seen = await page.evaluate(() => {
        const strip = document.querySelector('main .oyl-planner__summary');
        const map = document.querySelector('main .oyl-map');
        if (strip === null || map === null) throw new Error('no strip or no map');
        const box = strip.getBoundingClientRect();
        const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
        return {
          top: box.top,
          bottom: box.bottom,
          mapTop: map.getBoundingClientRect().top,
          window: window.innerHeight,
          uncovered: hit !== null && strip.contains(hit),
          text: strip.textContent,
          page: document.documentElement.scrollHeight,
        };
      });
      console.log(
        `[#3185] ${viewport.name}: strip ${seen.top.toFixed(0)}–${seen.bottom.toFixed(0)} px, ` +
          `map from ${seen.mapTop.toFixed(0)} px, window ${String(seen.window)} px, ` +
          `page ${String(seen.page)} px: "${seen.text}"`,
      );
      expect(seen.text, 'the strip names both figures').toMatch(/Distance.*Climbing/);
      expect(seen.top, 'the strip starts on the screen').toBeGreaterThanOrEqual(0);
      expect(seen.bottom, 'the strip ends on the screen').toBeLessThanOrEqual(seen.window);
      expect(seen.uncovered, 'the strip is not under the shell’s chrome').toBe(true);
      const between = seen.mapTop - seen.bottom;
      expect(between, 'the gap from the strip to the map').toBeGreaterThanOrEqual(0);
      expect(between, 'the gap from the strip to the map').toBeLessThanOrEqual(8);
    });
  }
});
