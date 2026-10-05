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
  // #1030 (PR #1032): the share note went behind its own ⓘ.
  routes: ['Saved routes', 'Import a route', 'Before you share a route'],
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
    'Menu sounds',
    'Appearance',
    'Announcements',
    'Sounds',
    'Game world',
    'Words to mask',
    'Documents for the analysis',
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
 *   must stand above the first control there;
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
  const keptAbove = seen.keptBeforeFirstControl.filter(
    (text) => readFirst === undefined || !text.startsWith(readFirst),
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
              .getPropertyValue('--oyl-color-accent')
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
    const summary = page.locator('main > details.oyl-help > summary');
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
      const title = document.querySelector('main > h1')?.getBoundingClientRect();
      return {
        shipped: { width: shipped.width, height: shipped.height },
        declared,
        stripped: { width: stripped.width, height: stripped.height },
        // Beside the title: its middle within the title's first line, and the
        // title's text stopping short of it.
        middle: shipped.top + shipped.height / 2,
        titleTop: title?.top ?? Number.NaN,
        titleRight:
          title === undefined
            ? Number.NaN
            : title.right -
              Number.parseFloat(
                getComputedStyle(document.querySelector('main > h1') as Element).paddingRight,
              ),
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
    expect(read.middle).toBeGreaterThan(read.titleTop);

    // The platform's own name for it, as a screen reader would be given it.
    await expect(summary).toHaveAccessibleName(`Help with ${route.title}`);
    const details = page.locator('main > details.oyl-help');
    await expect(details).not.toHaveAttribute('open');
    await summary.focus();
    await page.keyboard.press('Enter');
    await expect(details).toHaveAttribute('open', '');
    await expect(page.locator('main > details.oyl-help .oyl-help__panel')).toBeVisible();
    await page.keyboard.press('Space');
    await expect(details).not.toHaveAttribute('open');
  });
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
 * #1050 — *Save workout* with blocks in the builder.
 *
 * Every other walk here renders the workout builder with NO blocks, so the
 * block list and the block chart (#1043) — drawn only once a block exists —
 * were never laid out, and nothing measured where they put the builder's one
 * primary. `reflow.html?builder=blocks` adds one block of each kind through the
 * builder's own *Add block* form (`reflow-harness.tsx` §`buildOnWorkouts`),
 * and this publishes *Save workout*'s margin to the fold — to its pane's
 * bottom where that pane scrolls on its own (#723) — with and without them.
 *
 * - **Held** to §4f's 50 px floor on the owner's tablet both ways up. With
 *   the chart where #1043 drew it, between the list and the Save form, it
 *   could not be: in landscape the four blocks and the chart put *Save
 *   workout* about 46 px UNDER the fold on a Mac. The chart moved below the
 *   form (`WorkoutsView.tsx`, #1050), which is the issue's own remedy.
 * - **Published, not held, on a phone** (390×844), and the floor there is
 *   not one the layout can meet by moving the chart: one pane puts the list
 *   of saved workouts first, the builder after it, and the block list alone
 *   — each block a line and a 44 px *Remove* button — puts *Save workout*
 *   about 120 px under the fold with four blocks on a Mac. With none it is
 *   above the fold (`list-detail.browser.spec.ts` §`PRIMARY_ON_ARRIVAL`
 *   says by how little). A builder that grows with every block cannot keep a
 *   button below it on one screen; the phone's way to it is scrolling.
 * - **The control**: `&chart=above` puts the chart back between the list and
 *   the form on the live page, and on the landscape tablet *Save workout* must
 *   then fall under the floor — so the hold above is the chart's place doing
 *   the work, not a fixture too small to matter.
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

test.describe('#1050 — Save workout, with blocks in the builder', () => {
  for (const viewport of [...TABLETS, PHONE]) {
    const held = viewport !== PHONE;
    test(`its margin to the fold on a ${viewport.name}${held ? `, held to ${String(FOLD_MARGIN_PIXELS)} px` : ''}`, async ({
      page,
    }) => {
      await open(page, viewport, 'data=populated');
      const without = await saveWorkoutMargin(page);
      await open(page, viewport, 'data=populated&builder=blocks');
      const withBlocks = await saveWorkoutMargin(page);
      console.log(
        `[#1050] “${SAVE_WORKOUT}” @ ${viewport.name}: ${withBlocks.margin.toFixed(1)} px with ` +
          `${String(withBlocks.blocks)} blocks and the chart, ${without.margin.toFixed(1)} px with none`,
      );
      // The fixture is what it says, or this measured the empty builder twice.
      expect(without.blocks).toBe(0);
      expect(without.chart).toBe(0);
      expect(withBlocks.blocks).toBe(BUILDER_BLOCK_COUNT);
      expect(withBlocks.chart).toBe(1);
      if (held) {
        expect(withBlocks.margin).toBeGreaterThan(FOLD_MARGIN_PIXELS);
      }
    });
  }

  test('the control — with the chart above the form, Save workout falls under the floor on the landscape tablet', async ({
    page,
  }) => {
    const [landscape] = TABLETS;
    if (landscape === undefined) throw new Error('no tablet viewport');
    await open(page, landscape, 'data=populated&builder=blocks&chart=above');
    const above = await saveWorkoutMargin(page);
    console.log(
      `[#1050] control: “${SAVE_WORKOUT}” @ ${landscape.name}, chart above the form: ` +
        `${above.margin.toFixed(1)} px`,
    );
    expect(above.blocks).toBe(BUILDER_BLOCK_COUNT);
    expect(above.chart).toBe(1);
    // The chart really is above the form, or this measured the shipped page.
    expect(
      await page.evaluate(() => {
        const chart = document.querySelector('.oyl-main svg.oyl-block-chart');
        const form = document.querySelector('form[aria-label="Save this workout"]');
        return (
          chart !== null &&
          form !== null &&
          (chart.compareDocumentPosition(form) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
        );
      }),
    ).toBe(true);
    expect(above.margin).toBeLessThanOrEqual(FOLD_MARGIN_PIXELS);
  });
});
