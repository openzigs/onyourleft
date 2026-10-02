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
 * (`design/MoreAbout.tsx` §`KeptVisible`) — and fails the moment one ordinary
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
 * - `?disclosures=inline` copies every "More about" disclosure, OPEN, to
 *   straight under its section's heading — the explanation put back where it
 *   was before it was tucked. Segments, Settings and Files must then FAIL:
 *   without it, a page that rendered nothing, or a reader that found no
 *   control, would pass. ⚠️ **Camera is not in that list, though #666 names
 *   it**: it tucks nothing. Its first control came above the fold by order —
 *   see {@link MUST_FAIL_INLINE}.
 * - The summary's 44 px row target is measured #316's three ways: the shipped
 *   box, the declaration, and the box with the floor stripped, which must be
 *   shorter than 44 — so the declaration is what holds the target.
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
}

const PHONE: Viewport = {
  name: 'phone 390×844',
  width: 390,
  height: 844,
  margin: 0,
  consentBelowFold: ['side-camera'],
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
  },
  {
    name: 'tablet in the shell 800×1280, insets 36/32 (assumed)',
    width: 800,
    height: 1280,
    insets: PIXEL_TABLET_PORTRAIT_INSETS_ASSUMED,
    margin: FOLD_MARGIN_PIXELS,
    // Measured: the side camera's first control clears this fold by 347 px.
    consentBelowFold: [],
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
 * The sections that tuck their explanation, by heading, route by route —
 * #699's review, B2. The harness measures a section only where it finds a
 * "More about" disclosure, so a section put back the way it was before #666 —
 * its paragraph above its control and its disclosure deleted — is simply not
 * measured. Pinning the list turns that into a fault. A route not named here
 * tucks nothing, and a disclosure found on one is a fault too, so a new one
 * is pinned deliberately.
 */
const TUCKING_SECTIONS: Partial<Record<RouteId, readonly string[]>> = {
  // #623: 'Your kit' is not here. The walk renders Settings with no kit port,
  // where the owner's ruling of 2026-09-28 leaves the kit control ABSENT and
  // with it the "More about your kit" that explained the choice.
  // #839: 'Words to mask' tucks what is masked and what masking cannot do
  // under its "More about"; where it is kept stays above the form.
  // #992: 'Appearance' tucks what each choice means, and that a device that
  // has not chosen starts dark.
  settings: [
    'Units',
    'Your weight',
    'Appearance',
    'Announcements',
    'Sounds',
    'Game world',
    'Words to mask',
  ],
  segments: ['Make a segment', 'Find your efforts'],
  transfer: ['Import'],
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

async function visit(page: Page, route: RouteDefinition): Promise<ReflowMeasurement> {
  const hash = await hashFor(page, route);
  const seen = await page.evaluate(async (target) => window.__oylReflow?.visit(target), hash);
  if (seen === undefined) {
    throw new Error('the reflow harness published no measurement');
  }
  expect(seen.h1, `${route.id} did not render its own page`).toBe(route.title);
  expect(seen.settledWithinPatience, `${route.id} did not settle`).toBe(true);
  return seen;
}

/**
 * The most prose a section that tucks its explanation may lay out between its
 * heading and its first control, in CSS px at a phone's width: a sentence of
 * three or four lines and a short line of state. Measured on this branch the
 * largest is printed with every run; the explanation put back (the control)
 * is several times this.
 */
const SECTION_PROSE_BUDGET_PIXELS = 130;

/** A route's first control and the fold, as a line and as faults, which may be none. */
function judge(
  route: RouteDefinition,
  seen: ReflowMeasurement,
  margin: number,
): {
  readonly line: string;
  readonly faults: readonly string[];
  /** Whether the first control passed below the fold, behind kept-visible text only. */
  readonly exempted: boolean;
} {
  const faults: string[] = [];
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
  const pinned = TUCKING_SECTIONS[route.id] ?? [];
  if (measured.join('|') !== pinned.join('|')) {
    faults.push(
      `${route.id}: the sections measured as tucking are [${measured.join(', ')}], ` +
        `and TUCKING_SECTIONS pins [${pinned.join(', ')}] — a pinned section with no ` +
        `“More about” disclosure is one whose explanation was put back above its control`,
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
    const seen = await visit(page, route);
    const verdict = judge(route, seen, viewport.margin);
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
        test(`at a ${PHONE.name}, ${data}`, async ({ page }) => {
          test.setTimeout(180_000);
          await open(page, PHONE, `data=${data}`);
          expect(await page.evaluate(() => document.documentElement.dataset['theme'])).toBe(theme);
          const { lines, faults, exempted, emptyLines, emptyFaults } = await walk(page, PHONE);
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
      const verdict = judge(routeById('devices'), seen, viewport.margin);
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
    await open(page, PHONE, 'data=empty');
    await visit(page, routeById('settings'));
    const summaries = page.locator('main details.oyl-more > summary');
    const count = await summaries.count();
    expect(count, 'Settings has no “More about” disclosure to measure').toBeGreaterThan(0);
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
