// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The page the reflow walk drives — #660, WCAG 2.2 SC 1.4.10.
 *
 * It renders the **real** `shell/AppShell.tsx` under the **real**
 * `design/theme.css`, handed the in-memory ports of
 * `src/testing/populated-shell.tsx` (moved there by #668, so the one-primary
 * gate walks the same fixture). They are either **empty** (a device that has
 * recorded nothing) or **populated** (forty rides with long names, a ride with
 * a track, a chart, laps, a map and a side-camera report, a segment with
 * efforts, a route — on the Routes screen and in the game's picker — a
 * workout). `?data=empty` or `?data=populated` chooses which; there is no
 * default, because a page that silently picked one would make the other half
 * of the walk a copy of it.
 *
 * ## What it exists to catch
 *
 * #654's first pass found the Activities screen laid out 447 px wide inside a
 * 320 px phone and Credits 595 px wide, and **no gate looked**: jsdom performs
 * no layout (CLAUDE.md §4e), and the only 320 px check in the browser gate
 * measured the shell harness, whose views are handed no ports and so render
 * no table at all. This page is where every route is laid out by a real engine,
 * with the data that makes a route wide.
 *
 * ## What it deliberately does NOT decide
 *
 * **Which routes are walked.** `reflow.browser.spec.ts` takes them from
 * `shell/routes.ts` §`ALL_ROUTES`. This page takes them from the same table,
 * independently, and reports which of them it was never asked to render — so a
 * spec that walked a hand list, or dropped one route, is caught by a page that
 * never saw its own list shortened (#142's rule).
 *
 * **What a parameterised route's parameter is** is the one thing it does
 * decide, because only the fixtures know which ride and which segment exist:
 * {@link PARAMETERS}. A parameterised route with no entry there is a fault the
 * spec reports rather than a route it skips.
 *
 * ## The control
 *
 * `?control=overflow` appends a deliberately over-wide element to `.oyl-main`
 * on every route, and `?control=scroller`, `unnamed` and `grouped` each append
 * a box that scrolls sideways inside itself and lacks one of the three things
 * such a box needs. Each must turn the walk's own fault list non-empty —
 * without them, a page that rendered nothing would pass.
 *
 * ## The list–detail layout — #670
 *
 * Each measurement also carries the panes of a `list-detail` route
 * ({@link ListDetailBoxes}), the rail's right edge and every primary button's
 * place, for `list-detail.browser.spec.ts`. `?layout=prose` is that spec's
 * control: before anything renders, the three `list-detail` routes of the
 * real table are switched back to `prose`, which is the reading measure #670
 * replaced. And a page opened WITH a hash keeps it, so a fresh load of
 * `#/activities/selected/<id>` is a fresh load of that selection.
 */

import { StrictMode, type JSX } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';

import { unixSeconds } from '@onyourleft/domain';
import { activityId, openActivityStore, routeId } from '@onyourleft/store';

import { tabbableElements } from '../src/a11y/audit';
import { Button } from '../src/design/Button';
import { ScrollTable } from '../src/design/ScrollTable';
import { VisuallyHidden } from '../src/design/VisuallyHidden';
import { OSM_ATTRIBUTION } from '../src/map/basemap';
import type { MapPort } from '../src/map/port';
import { LOCAL_ATHLETE, localAthleteRecord } from '../src/local-athlete';
import { PRIMARY_BUTTON_SELECTOR } from '../src/a11y/button-hierarchy';
import { ALL_ROUTES, matchHash, type RouteId, type RouteLayout } from '../src/shell/routes';
import type { CapabilityProbe } from '../src/support/bluetooth-support';
import { webCryptoDigest } from '../src/transfer/browser';
import type { TransferPort } from '../src/transfer/store-port';
import {
  PARAMETERS,
  POPULATED,
  PopulatedShell,
  SELECTIONS,
  type PopulatedExpectation,
} from '../src/testing/populated-shell';

// The shipping stylesheet, which is the whole point.
import '../src/design/theme.css';

/** How long the DOM must be still before a route counts as settled. */
const QUIET_MS = 250;
/** The most a route is waited for, first for its `h1` and then for quiet. */
const PATIENCE_MS = 10_000;

/** A box in CSS px from the viewport's top-left, as `getBoundingClientRect` gives it. */
export interface Box {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

/** A `list-detail` route's panes — #670. A hidden pane has no box. */
export interface ListDetailBoxes {
  /** `data-oyl-panes`: how many panes `ListDetail` decided on. */
  readonly panes: string | null;
  readonly container: Box;
  readonly list: Box | null;
  readonly detail: Box | null;
}

/** A primary button's place, in CSS px from the top of the DOCUMENT. */
export interface PrimaryPlace {
  readonly text: string;
  readonly top: number;
  readonly bottom: number;
  /** Which pane holds it, or `null` outside any. */
  readonly pane: string | null;
}

/** One box that scrolls sideways inside itself, and what a keyboard user gets. */
export interface ScrollBox {
  readonly description: string;
  readonly overflow: number;
  readonly focusable: boolean;
  readonly role: string | null;
  readonly name: string;
}

export interface ReflowMeasurement {
  readonly hash: string;
  /** The route `matchHash` resolved the hash to, which the spec compares with the one it asked for. */
  readonly routeId: RouteId;
  readonly h1: string;
  readonly viewport: { readonly width: number; readonly height: number };
  /** `scrollWidth − clientWidth` of the document. Positive is a failure. */
  readonly documentOverflow: number;
  /** The element reaching furthest right, for a failure message that names it. */
  readonly widest: string;
  /** CSS px between that element's right edge and the viewport's. Negative is an overflow. */
  readonly spare: number;
  readonly scrollBoxes: readonly ScrollBox[];
  /** The activity library's `data-layout`, or `null` on any other route. */
  readonly libraryLayout: string | null;
  /** The height of the library's sort control, or `null` on any other route. */
  readonly sortControlHeight: number | null;
  /**
   * What this page expects of the route's fixtures — {@link POPULATED} — or
   * `undefined` when it has no entry, which the spec fails in both walks.
   */
  readonly expectation: PopulatedExpectation | undefined;
  /** Whether the expectation's marker is on the page, or `null` when it has none. */
  readonly markerPresent: boolean | null;
  /**
   * Every uncaught error and unhandled rejection raised since the previous
   * route was opened — so one raised while a route rendered, or while the page
   * settled, is charged to that route rather than being read once, before the
   * walk began (#683's review).
   */
  readonly errors: readonly string[];
  readonly settledWithinPatience: boolean;
  /**
   * The first control in `main`, in document order, that is laid out — #666.
   * `null` when the route has none. A `<summary>` is not counted: a
   * disclosure is where the explanation went, not what a rider came to do.
   */
  readonly firstControl: FirstControl | null;
  /**
   * Where the fold is, in CSS px from the top: the viewport's height less the
   * safe-area inset at the bottom (#439), or the top of a navigation bar fixed
   * across the bottom, whichever is higher — what covers the page is not
   * above the fold.
   */
  readonly fold: number;
  /**
   * The prose laid out between the route's summary and its first control that
   * is NOT marked `data-oyl-kept-visible` — #666. Empty means everything in
   * the way is a heading or text the owner ruled must stay on the screen, so
   * a route whose consent text pushes its first control below the fold is
   * judged by this instead of by the fold.
   */
  readonly proseBeforeFirstControl: readonly string[];
  /** Every "More about" disclosure, and the prose above its section's first control. */
  readonly sections: readonly SectionProse[];
  /** Every `<details>` in `main`, and how many of them are open as measured. */
  readonly disclosures: { readonly total: number; readonly open: number };
  /** The list–detail panes, or `null` on a route that has none — #670. */
  readonly listDetail: ListDetailBoxes | null;
  /** The right edge of the navigation RAIL, or `0` where it is a bar or absent. */
  readonly railRight: number;
  /** Every primary button in `main` that is laid out — #670's published positions. */
  readonly primaries: readonly PrimaryPlace[];
  /** The `main` element's layout class, e.g. `oyl-main--list-detail`. */
  readonly mainLayout: string | null;
}

/**
 * A section that tucks its explanation (#666), and the CSS px of prose laid
 * out between its heading and its first control — the one sentence, and
 * nothing the owner did not rule must stay.
 */
export interface SectionProse {
  readonly heading: string;
  readonly summary: string;
  readonly proseHeight: number;
  /** Whether the section has a control at all after its heading. */
  readonly controlled: boolean;
}

/** One control's place on the page, in CSS px from the top of the viewport. */
export interface FirstControl {
  readonly description: string;
  readonly text: string;
  readonly top: number;
}

declare global {
  interface Window {
    /**
     * A stable name for an element, for comparing a real Tab sequence with the
     * model's — #666. The probed link is `link`.
     */
    __oylTabKey?: (element: Element) => string;
    /**
     * `a11y/audit.ts` §`tabbableElements` over the live page, inside `main`,
     * as keys — and, separately, the radios in it that a browser does NOT
     * stop on: every radio of a named group but the checked one (or the first,
     * when none is checked). The model counts each radio; a browser makes a
     * group one tab stop and moves within it by arrow key. #666 found that
     * difference by comparing the two (filed as #698), and it is reported
     * apart from the sequence so that the rest can be compared exactly.
     */
    __oylTabModel?: () => { readonly stops: string[]; readonly radiosWithinAGroup: string[] };
    __oylReflow?: {
      readonly ready: boolean;
      readonly errors: readonly string[];
      readonly data: 'empty' | 'populated';
      readonly parameters: Partial<Record<RouteId, string>>;
      /** The item each `list-detail` route selects in the populated fixture — #670. */
      readonly selections: Partial<Record<RouteId, string>>;
      readonly populated: Partial<Record<RouteId, PopulatedExpectation>>;
      readonly visit: (hash: string) => Promise<ReflowMeasurement>;
      /** Every id in `ALL_ROUTES` this page has not rendered. */
      readonly unvisited: () => readonly RouteId[];
    };
  }
}

const errors: string[] = [];
/** How much of {@link errors} the previous {@link visit} has already reported. */
let reported = 0;
const visited = new Set<RouteId>();

async function realMap(): Promise<MapPort> {
  return (await import('../src/map/maplibre')).mapLibrePort;
}

/**
 * The Files screen's port, over this browser's own IndexedDB — #666. Without
 * one the screen shows its not-available sentence and none of its forms, and
 * the forms are what #654 measured at 3,554 px. A database of the harness's
 * own name, never written to: nothing on the walk imports a file.
 */
function transferPort(): TransferPort {
  const now = unixSeconds(Math.floor(Date.now() / 1000));
  return {
    store: openActivityStore('oyl-reflow-harness'),
    athleteId: LOCAL_ATHLETE,
    newActivityId: () => activityId(crypto.randomUUID()),
    newRouteId: () => routeId(crypto.randomUUID()),
    now: () => now,
    timeZone: 'UTC',
    digest: webCryptoDigest,
    save: () => undefined,
    drafts: { forget: () => undefined },
    athleteRow: localAthleteRecord(now),
  };
}

/**
 * A Bluetooth that answers "available" and is never asked to pair — #699's
 * review, N4. `?bluetooth=available` hands it to the shell so the Devices
 * screen renders its pairing rows, which the fixture's no-Bluetooth browser
 * leaves out of every other walk.
 */
const AVAILABLE_BLUETOOTH: CapabilityProbe = {
  bluetooth: {
    getAvailability: async () => Promise.resolve(true),
    requestDevice: async () => Promise.reject(new Error('the reflow harness pairs nothing')),
  },
  secureContext: true,
};

function shell(populated: boolean): JSX.Element {
  const bluetooth = new URLSearchParams(window.location.search).get('bluetooth') === 'available';
  return (
    <PopulatedShell
      populated={populated}
      {...(bluetooth ? { capabilities: AVAILABLE_BLUETOOTH } : {})}
      transfer={transferPort()}
      map={realMap}
      basemap={{
        archiveUrl: new URL('/basemap-fixture.pmtiles', window.location.origin).toString(),
        attribution: OSM_ATTRIBUTION,
      }}
    />
  );
}

async function nextFrame(): Promise<void> {
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      resolve();
    });
  });
}

async function untilHeading(title: string): Promise<boolean> {
  const deadline = performance.now() + PATIENCE_MS;
  while (performance.now() < deadline) {
    if (document.querySelector('h1')?.textContent === title) {
      return true;
    }
    await nextFrame();
  }
  return false;
}

/** Resolve once the DOM has not changed for {@link QUIET_MS}, or at the deadline. */
async function untilQuiet(): Promise<boolean> {
  let last = performance.now();
  const observer = new MutationObserver(() => {
    last = performance.now();
  });
  observer.observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    characterData: true,
  });
  const deadline = performance.now() + PATIENCE_MS;
  try {
    while (performance.now() < deadline) {
      await nextFrame();
      if (performance.now() - last >= QUIET_MS) {
        return true;
      }
    }
    return false;
  } finally {
    observer.disconnect();
  }
}

function describe(element: Element): string {
  const id = element.id === '' ? '' : `#${element.id}`;
  const classes = [...element.classList].map((name) => `.${name}`).join('');
  return `${element.tagName.toLowerCase()}${id}${classes}`;
}

function nameOf(element: Element): string {
  const label = element.getAttribute('aria-label');
  if (label !== null && label.trim() !== '') {
    return label.trim();
  }
  const ids = element.getAttribute('aria-labelledby');
  if (ids === null) {
    return '';
  }
  return ids
    .split(/\s+/)
    .map((id) => document.getElementById(id)?.textContent ?? '')
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Every element that scrolls sideways inside itself right now, measured.
 *
 * A box whose content is wider than it, with `overflow-x` of `auto` or
 * `scroll`, is a scroll container a mouse can scroll and a keyboard can reach
 * only if it can take focus. SC 1.4.10 exempts a table's two-dimensional
 * layout from reflow only on that condition (#654's re-review).
 */
function scrollBoxes(): ScrollBox[] {
  const found: ScrollBox[] = [];
  for (const element of document.body.querySelectorAll('*')) {
    if (!(element instanceof HTMLElement)) {
      continue;
    }
    const overflowX = getComputedStyle(element).overflowX;
    if (overflowX !== 'auto' && overflowX !== 'scroll') {
      continue;
    }
    const overflow = element.scrollWidth - element.clientWidth;
    if (overflow <= 1) {
      continue;
    }
    found.push({
      description: describe(element),
      overflow,
      focusable: element.tabIndex >= 0,
      role: element.getAttribute('role'),
      name: nameOf(element),
    });
  }
  return found;
}

/** The element whose right edge reaches furthest, for a failure message that names it. */
function clipped(element: Element): boolean {
  for (
    let parent = element.parentElement;
    parent !== null && parent !== document.body;
    parent = parent.parentElement
  ) {
    if (getComputedStyle(parent).overflowX !== 'visible') {
      return true;
    }
  }
  return false;
}

/** What a person actually sees: replaced elements, controls and tables. */
const CONTENT_ELEMENTS = 'img, svg, canvas, video, input, select, button, textarea, table';

/**
 * The content reaching furthest right, and how far its edge is from the
 * viewport's — the route's MARGIN, which the spec prints so a near miss is
 * visible rather than green. Measured over TEXT and over
 * {@link CONTENT_ELEMENTS} rather than every box, because a block stretches to
 * its container and would report the container's edge whatever is in it.
 * Anything inside a box that clips or scrolls is skipped: it can be wider than
 * the page without widening it.
 */
function widest(): { readonly description: string; readonly spare: number } {
  let right = -Infinity;
  let which = 'nothing';
  const consider = (box: DOMRect, owner: Element, what: string): void => {
    if (box.width > 0 && box.right > right && !clipped(owner)) {
      right = box.right;
      which = what;
    }
  };
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const owner = node.parentElement;
    if (
      owner === null ||
      (node.textContent ?? '').trim() === '' ||
      getComputedStyle(owner).overflowX !== 'visible'
    ) {
      continue;
    }
    range.selectNodeContents(node);
    consider(range.getBoundingClientRect(), owner, `text in ${describe(owner)}`);
  }
  for (const element of document.body.querySelectorAll(CONTENT_ELEMENTS)) {
    consider(element.getBoundingClientRect(), element, describe(element));
  }
  return {
    description: `${which} (right edge ${right.toFixed(1)} px)`,
    spare: document.documentElement.clientWidth - right,
  };
}

function applyControl(control: string | null): void {
  const main = document.querySelector('.oyl-main');
  if (control === null || main === null || main.querySelector('[data-oyl-control]') !== null) {
    return;
  }
  const specimen = document.createElement('div');
  specimen.dataset['oylControl'] = control;
  if (control === 'overflow') {
    // Wider than any viewport the walk uses, and unbreakable.
    specimen.style.width = '1200px';
    specimen.style.height = '4px';
  } else if (control === 'scroller' || control === 'unnamed' || control === 'grouped') {
    // Contained, so the DOCUMENT does not scroll — only this box does. Each
    // has two of the three things a scroll box needs and lacks one, so each
    // proves its own part of the rule: `scroller` is a named region that
    // cannot take focus (a `ScrollTable` that lost its `tabIndex`), `unnamed`
    // is a focusable region with no name, and `grouped` is focusable and named
    // with a role that is not `region` (#683's review — any role used to pass).
    specimen.style.overflowX = 'auto';
    specimen.setAttribute('role', control === 'grouped' ? 'group' : 'region');
    if (control !== 'unnamed') {
      specimen.setAttribute('aria-label', 'A wide specimen');
    }
    if (control !== 'scroller') {
      specimen.tabIndex = 0;
    }
    const inner = document.createElement('div');
    inner.style.width = '1200px';
    inner.style.height = '4px';
    specimen.append(inner);
  } else if (control === 'region') {
    // The POSITIVE control: a table done properly must NOT be a fault, so the
    // rule cannot pass by flagging everything that scrolls. It is the REAL
    // `ScrollTable`, with a visually hidden name at the far end of a wide row —
    // the case that once escaped the region and widened the page (theme.css
    // §`.oyl-scroll-region`, `position: relative`).
    main.append(specimen);
    flushSync(() => {
      createRoot(specimen).render(
        <ScrollTable caption="A wide specimen">
          <tbody>
            <tr>
              <td style={{ minWidth: '1200px' }}>Wide</td>
              <td>
                <Button>
                  Delete<VisuallyHidden> the wide specimen</VisuallyHidden>
                </Button>
              </td>
            </tr>
          </tbody>
        </ScrollTable>,
      );
    });
    return;
  }
  main.append(specimen);
}

/**
 * What counts as a control for #666's "first control above the fold": a
 * button, a form control, or a link drawn as a button — which is how #668
 * made every next step that is an action look. A link inside a sentence is a
 * reference rather than the thing a rider came to do, so a page of prose with
 * a link in its third paragraph has no control, not a late one. A `<summary>`
 * is not a control here either, and nor is anything inside one: a disclosure
 * is where the explanation went.
 */
const CONTROL_SELECTOR = 'button, input:not([type="hidden"]), select, textarea, a[href].oyl-button';

/**
 * Whether an element is drawn — one in a closed `<details>` is not.
 *
 * ⚠️ **Not "has a box"**, and #666 found that out by mutation: Chromium 153
 * lays out the content of a CLOSED `<details>` and hides it (the content slot
 * is `content-visibility: hidden`, so find-in-page can open it), so a tucked
 * paragraph reports a full-size `getBoundingClientRect()`. The first version
 * of this function read the box, and counted every tucked paragraph as prose
 * in the way. `checkVisibility()` is the platform's own answer, and a box is
 * still required so an empty element does not count.
 */
function laidOut(element: Element): boolean {
  const box = element.getBoundingClientRect();
  return element.checkVisibility() && (box.width > 0 || box.height > 0);
}

/**
 * What counts as prose — or anything else a rider reads or looks at — in the
 * way of a control. Text blocks; and since #699's review (N7) a table, a
 * figure, a picture, a chart and a canvas, which have a box of their own
 * however little text they hold; and a bare `div`, `section`, `article` or
 * `aside` whose OWN text is not in any of those, which is text a view wrote
 * without a paragraph around it. Not a label or a legend (a control's own
 * name), not a heading, and nothing inside a control, a link or a summary.
 */
const PROSE_SELECTOR = 'p, li, dd, dt, .oyl-status, figcaption, blockquote';
const MEDIA_SELECTOR = 'table, figure, img, svg, canvas, [role="img"]';
const BARE_TEXT_SELECTOR = 'div, section, article, aside';
const NOT_PROSE = 'label, legend, h1, h2, h3, h4, h5, h6, button, a, summary, [aria-hidden="true"]';

function ownText(element: Element): string {
  return [...element.childNodes]
    .filter((node) => node.nodeType === Node.TEXT_NODE)
    .map((node) => node.textContent ?? '')
    .join('')
    .trim();
}

/** A block `proseBetween` counts, and the words it reports it by. */
function proseWords(element: Element): string | undefined {
  if (element.closest(NOT_PROSE) !== null) {
    return undefined;
  }
  if (element.matches(PROSE_SELECTOR)) {
    const text = textOf(element);
    return text === '' ? undefined : text;
  }
  if (element.matches(MEDIA_SELECTOR)) {
    const name =
      element.getAttribute('aria-label') ?? element.getAttribute('alt') ?? textOf(element);
    return `[${element.tagName.toLowerCase()}] ${name}`.trim();
  }
  if (element.matches(BARE_TEXT_SELECTOR) && ownText(element) !== '') {
    return ownText(element);
  }
  return undefined;
}

function inOrder(first: Node, second: Node): boolean {
  return (first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
}

function textOf(element: Element): string {
  return (element.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/** The controls of `main` that are laid out, in document order. */
function laidOutControls(main: Element): Element[] {
  return [...main.querySelectorAll(CONTROL_SELECTOR)].filter(
    (element) => element.closest('summary') === null && laidOut(element),
  );
}

/**
 * The prose blocks of `main` that lie wholly between `after` and `before`, are
 * laid out, hold no control and are not marked `data-oyl-kept-visible` — the
 * outermost of each, so a list is counted once and not again for its items.
 */
function proseBetween(main: Element, after: Element | null, before: Element | null): Element[] {
  const blocks = [
    ...main.querySelectorAll(`${PROSE_SELECTOR}, ${MEDIA_SELECTOR}, ${BARE_TEXT_SELECTOR}`),
  ].filter(
    (element) =>
      laidOut(element) &&
      proseWords(element) !== undefined &&
      element.closest('[data-oyl-kept-visible], summary') === null &&
      element.querySelector(CONTROL_SELECTOR) === null &&
      (after === null || inOrder(after, element)) &&
      (before === null || (!element.contains(before) && inOrder(element, before))),
  );
  return blocks.filter(
    (element) => !blocks.some((other) => other !== element && other.contains(element)),
  );
}

function proseBeforeFirstControl(): string[] {
  const main = document.querySelector('main');
  if (main === null) {
    return [];
  }
  const control = laidOutControls(main)[0] ?? null;
  // The route's own summary is the shell's (#48), under its `h1`, and is the
  // one sentence every route keeps.
  const summary = main.querySelector(':scope > h1 + p');
  return proseBetween(main, summary, control).map((element) =>
    (proseWords(element) ?? '').slice(0, 80),
  );
}

/**
 * Every "More about" disclosure, its section's heading, and the height of the
 * prose between that heading and the section's first control — #666 applied
 * section by section: a long page whose first control is near the top can
 * still bury every later one under a paragraph, which is Settings on `main`.
 */
function sections(): SectionProse[] {
  const main = document.querySelector('main');
  if (main === null) {
    return [];
  }
  const headings = [...main.querySelectorAll('h2, h3')].filter(laidOut);
  const controls = laidOutControls(main);
  const found: SectionProse[] = [];
  for (const details of main.querySelectorAll('details.oyl-more')) {
    if (details.hasAttribute('data-oyl-inline-copy')) {
      continue;
    }
    const heading = headings.filter((each) => inOrder(each, details)).at(-1);
    if (heading === undefined) {
      continue;
    }
    // The section ends at the next heading of its own level or higher.
    const end = headings.find((each) => inOrder(heading, each) && each.tagName <= heading.tagName);
    const control =
      controls.find(
        (each) => inOrder(heading, each) && (end === undefined || inOrder(each, end)),
      ) ?? null;
    found.push({
      heading: textOf(heading),
      summary: textOf(details.querySelector('summary') ?? details),
      proseHeight: proseBetween(main, heading, control ?? end ?? null).reduce(
        (sum, element) => sum + element.getBoundingClientRect().height,
        0,
      ),
      controlled: control !== null,
    });
  }
  return found;
}

function firstControl(): FirstControl | null {
  const main = document.querySelector('main');
  if (main === null) {
    return null;
  }
  for (const element of main.querySelectorAll(CONTROL_SELECTOR)) {
    // A control inside a closed `<details>` is not laid out: it has no box.
    if (element.closest('summary') !== null || !laidOut(element)) {
      continue;
    }
    const box = element.getBoundingClientRect();
    return {
      description: describe(element),
      text: (element.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 60),
      top: box.top + window.scrollY,
    };
  }
  return null;
}

function foldLine(): number {
  const probe = document.createElement('div');
  probe.style.cssText =
    'position:fixed;visibility:hidden;padding-bottom:env(safe-area-inset-bottom,0px)';
  document.body.append(probe);
  const inset = Number.parseFloat(getComputedStyle(probe).paddingBottom);
  probe.remove();
  let fold = window.innerHeight - inset;
  const nav = document.querySelector('.oyl-nav');
  if (nav !== null && getComputedStyle(nav).position === 'fixed') {
    const box = nav.getBoundingClientRect();
    // A bar across the bottom, not a rail down the side.
    if (box.width >= window.innerWidth - 1 && box.top > window.innerHeight / 2) {
      fold = Math.min(fold, box.top);
    }
  }
  return fold;
}

/**
 * The control #666 names: a copy of the page with its explanation put back —
 * each "More about" disclosure copied, OPEN, to straight under its section's
 * heading, where the explanation stood before it was tucked. The fold and the
 * section rules must then FAIL on the routes that tuck anything, or they are
 * not measuring it.
 *
 * A copy rather than a move: the disclosure is React's, and moving a node
 * React owns makes the next render fail to remove it. The copies are the
 * harness's own and are removed before each route is opened.
 */
function inlineDisclosureCopies(): void {
  const main = document.querySelector('main');
  if (main === null) {
    return;
  }
  const headings = [...main.querySelectorAll('h2, h3')];
  for (const details of main.querySelectorAll('details.oyl-more')) {
    const heading = headings.filter((each) => inOrder(each, details)).at(-1);
    const copy = details.cloneNode(true) as HTMLElement;
    copy.setAttribute('open', '');
    copy.setAttribute('data-oyl-inline-copy', '');
    if (heading === undefined) {
      main.querySelector(':scope > h1 + p')?.after(copy);
    } else {
      heading.after(copy);
    }
  }
}

function removeInlineCopies(): void {
  for (const copy of document.querySelectorAll('[data-oyl-inline-copy]')) {
    copy.remove();
  }
}

function boxOf(element: Element | null): Box | null {
  if (element === null || !laidOut(element)) {
    return null;
  }
  const box = element.getBoundingClientRect();
  return { left: box.left, right: box.right, top: box.top, bottom: box.bottom };
}

function listDetailBoxes(): ListDetailBoxes | null {
  const container = document.querySelector('main .oyl-list-detail');
  const box = boxOf(container);
  if (container === null || box === null) {
    return null;
  }
  return {
    panes: container.getAttribute('data-oyl-panes'),
    container: box,
    list: boxOf(container.querySelector('[data-oyl-pane="list"]')),
    detail: boxOf(container.querySelector('[data-oyl-pane="detail"]')),
  };
}

function railRight(): number {
  const nav = document.querySelector('.oyl-nav');
  if (nav === null || getComputedStyle(nav).position !== 'fixed') {
    return 0;
  }
  const box = nav.getBoundingClientRect();
  // A rail down the side, not a bar across the bottom.
  return box.height >= window.innerHeight / 2 && box.left < window.innerWidth / 2 ? box.right : 0;
}

function primaries(): PrimaryPlace[] {
  const main = document.querySelector('main');
  if (main === null) {
    return [];
  }
  return [...main.querySelectorAll(PRIMARY_BUTTON_SELECTOR)].filter(laidOut).map((element) => {
    const box = element.getBoundingClientRect();
    return {
      text: (element.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 60),
      top: box.top + window.scrollY,
      bottom: box.bottom + window.scrollY,
      pane: element.closest('[data-oyl-pane]')?.getAttribute('data-oyl-pane') ?? null,
    };
  });
}

async function visit(hash: string): Promise<ReflowMeasurement> {
  const control = new URLSearchParams(window.location.search).get('control');
  removeInlineCopies();
  window.location.hash = hash;
  const { route } = matchHash(hash);
  const headed = await untilHeading(route.title);
  const quiet = await untilQuiet();
  await document.fonts.ready;
  applyControl(control);
  if (new URLSearchParams(window.location.search).get('disclosures') === 'inline') {
    inlineDisclosureCopies();
  }
  await nextFrame();
  visited.add(route.id);
  // Read through a `Partial` view on purpose: the spec's "no entry" fault has
  // to be reachable if the `Record` type is ever loosened.
  const expectation = (POPULATED as Partial<Record<RouteId, PopulatedExpectation>>)[route.id];
  const marker =
    expectation === undefined || expectation.kind === 'none' ? undefined : expectation.marker;
  const raised = errors.slice(reported);
  reported = errors.length;
  const root = document.documentElement;
  const reach = widest();
  return {
    hash,
    routeId: route.id,
    h1: document.querySelector('h1')?.textContent ?? '',
    viewport: { width: window.innerWidth, height: window.innerHeight },
    documentOverflow: root.scrollWidth - root.clientWidth,
    widest: reach.description,
    spare: reach.spare,
    scrollBoxes: scrollBoxes(),
    libraryLayout: document.querySelector('.oyl-library')?.getAttribute('data-layout') ?? null,
    sortControlHeight:
      document.querySelector('#oyl-library-sort')?.getBoundingClientRect().height ?? null,
    expectation,
    markerPresent: marker === undefined ? null : document.querySelector(marker) !== null,
    errors: raised,
    settledWithinPatience: headed && quiet,
    firstControl: firstControl(),
    fold: foldLine(),
    proseBeforeFirstControl: proseBeforeFirstControl(),
    sections: sections(),
    disclosures: {
      total: document.querySelectorAll('main details').length,
      open: document.querySelectorAll('main details[open]').length,
    },
    listDetail: listDetailBoxes(),
    railRight: railRight(),
    primaries: primaries(),
    mainLayout:
      [...(document.querySelector('main')?.classList ?? [])].find((name) =>
        name.startsWith('oyl-main--'),
      ) ?? null,
  };
}

/**
 * `?layout=prose` — #670's control. The `list-detail` routes of the REAL
 * table go back to the reading measure before anything renders, so the
 * spec's width assertion must fail on them.
 */
function applyLayoutControl(): void {
  if (new URLSearchParams(window.location.search).get('layout') !== 'prose') {
    return;
  }
  for (const route of ALL_ROUTES) {
    if (route.layout === 'list-detail') {
      (route as { layout: RouteLayout }).layout = 'prose';
    }
  }
}

function main(): void {
  const host = document.querySelector('#shell');
  if (host === null) {
    throw new Error('reflow harness: #shell is missing from reflow.html');
  }
  const data = new URLSearchParams(window.location.search).get('data');
  if (data !== 'empty' && data !== 'populated') {
    throw new Error(`reflow harness: ?data must be "empty" or "populated", not ${String(data)}`);
  }
  applyLayoutControl();
  // A page opened with a hash keeps it (#670: a fresh load of a selection).
  if (window.location.hash === '') {
    window.location.hash = '#/';
  }
  flushSync(() => {
    createRoot(host).render(<StrictMode>{shell(data === 'populated')}</StrictMode>);
  });
  window.__oylReflow = {
    ready: true,
    errors,
    data,
    parameters: PARAMETERS,
    selections: SELECTIONS,
    populated: POPULATED,
    visit,
    unvisited: () => ALL_ROUTES.map((route) => route.id).filter((id) => !visited.has(id)),
  };
}

window.addEventListener('error', (event) => {
  errors.push(event.message);
});
// A rejected promise nothing awaits raises no `error` event, and is the more
// likely failure in a view that reads a port.
window.addEventListener('unhandledrejection', (event) => {
  const reason: unknown = event.reason;
  errors.push(`unhandled rejection: ${reason instanceof Error ? reason.message : String(reason)}`);
});

function tabKey(element: Element): string {
  if (element.getAttribute('data-oyl-probe') === 'link') {
    return 'link';
  }
  const index = [...document.querySelectorAll('*')].indexOf(element);
  return `${describe(element)}@${String(index)}`;
}

window.__oylTabKey = tabKey;
/** A radio a browser reaches by arrow key within its group rather than by Tab. */
function withinARadioGroup(element: Element): boolean {
  if (!(element instanceof HTMLInputElement) || element.type !== 'radio' || element.name === '') {
    return false;
  }
  const group = [...document.querySelectorAll<HTMLInputElement>('input[type="radio"]')].filter(
    (radio) => radio.name === element.name && radio.form === element.form,
  );
  const stop = group.find((radio) => radio.checked) ?? group[0];
  return stop !== element;
}

window.__oylTabModel = () => {
  const main = document.querySelector('main');
  const model = tabbableElements(document).filter(
    (element) => main?.contains(element) === true && element !== main,
  );
  return {
    stops: model.filter((element) => !withinARadioGroup(element)).map(tabKey),
    radiosWithinAGroup: model.filter(withinARadioGroup).map(tabKey),
  };
};

try {
  main();
} catch (error: unknown) {
  errors.push(error instanceof Error ? error.message : String(error));
  window.__oylReflow = {
    ready: false,
    errors,
    data: 'empty',
    parameters: PARAMETERS,
    selections: SELECTIONS,
    populated: POPULATED,
    visit: () => Promise.reject(new Error('the reflow harness did not start')),
    unvisited: () => ALL_ROUTES.map((route) => route.id),
  };
}
