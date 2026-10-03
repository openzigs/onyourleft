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
 *
 * `?panes=page` is #723's control: the layout before the two panes scrolled
 * on their own, put back over the shipping stylesheet ({@link applyPanesControl}).
 *
 * `?shape=off` and `?shape=tall` are #941's: the cards without their drawn
 * shape, and with it three times as tall ({@link applyShapeControl}).
 *
 * `?sections=prose` and `?sections=uncontained` are #1014's: a screen of
 * sections, and a detail pane, with nothing to decide their columns; and
 * `?sections=columns` is its review's, the sections in #1014's first CSS
 * columns rather than in rows ({@link applySectionsControl}).
 *
 * `?chooser=as-shipped` is #1028's: Analysis' ride chooser 8rem wide with its
 * name allowed to wrap, as it shipped ({@link applyChooserControl}).
 */

import { StrictMode, type JSX } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';

import { viewGroupsLoaded } from './views-loaded';

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
import {
  ALL_ROUTES,
  matchHash,
  type RouteDefinition,
  type RouteId,
  type RouteLayout,
} from '../src/shell/routes';
import { webCryptoDigest } from '../src/transfer/browser';
import type { TransferPort } from '../src/transfer/store-port';
import {
  AVAILABLE_BLUETOOTH,
  EMPTY_STATES,
  PARAMETERS,
  POPULATED,
  PopulatedShell,
  SELECTIONS,
  fixtureRide,
  type EmptyStateExpectation,
  type PopulatedExpectation,
} from '../src/testing/populated-shell';

// The shipping stylesheet, which is the whole point.
import '../src/design/theme.css';
import '../src/design/tailwind.css';

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
  /**
   * The bottom of the pane holding it, in CSS px from the top of the document,
   * when that pane scrolls on its own and so CLIPS what is below its bottom —
   * #723. `null` when the pane scrolls with the page. A primary below it is
   * not on screen however far above the fold it is.
   */
  readonly clipBottom: number | null;
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
  /**
   * The activity library's cards (#1041): how many there are, how many grid
   * columns they are laid out in, how many tables the library holds (none),
   * and the shortest card link's height — or `null` on any other route.
   * Since #1041's review also the narrowest link and its facts' readings.
   */
  readonly library: {
    readonly cards: number;
    readonly columns: number;
    readonly tables: number;
    readonly shortestLink: number | null;
    /** The narrowest card link's width — a 44 px target both ways (#1041's review). */
    readonly narrowestLink: number | null;
    /**
     * The most lines any card's facts reading's numerals are laid out on — 1
     * unless one wraps — and how far the furthest spills past its own fact's
     * box, in CSS px (positive is a spill). A `10:23:45` in a track narrower
     * than its numerals does one or the other (#992, #1041's review).
     */
    readonly mostReadingLines: number;
    readonly readingSpill: number;
  } | null;
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
  /**
   * The text marked `data-oyl-kept-visible` that is laid out between the
   * route's summary and its first control — #993. The owner's ruling keeps
   * safety and privacy sentences on the screen, as compact notes BELOW the
   * controls; only a consent screen, whose box says the text was read, may put
   * them first.
   */
  readonly keptBeforeFirstControl: readonly string[];
  /**
   * The route's one line under its title — #993: how many lines the shell's
   * summary paragraph lays out on, from its height over its line height, and
   * its words.
   */
  readonly summary: { readonly text: string; readonly lines: number } | null;
  /** The screen's help control — #993 — or `null` where the route has none. */
  readonly help: HelpControl | null;
  /** Every section's ⓘ (#1013, the one pattern since #1031), and the prose above its section's first control. */
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
  /**
   * Every `design/EmptyState.tsx` in `main` that is laid out, and the action
   * inside each — #943. `actions` counts the buttons, which must be one;
   * `top` is the first one's, like {@link FirstControl.top}.
   */
  readonly emptyStates: readonly EmptyStatePlace[];
}

/** The help control beside a screen's title — #993. */
export interface HelpControl {
  /** Its accessible name, as the platform computes it would be read: its text with `aria-hidden` parts left out. */
  readonly name: string;
  readonly width: number;
  readonly height: number;
  /** The panel's text, read while it is closed — it is in the page, so it is there offline. */
  readonly contents: string;
}

/** One empty state's action — #943. */
export interface EmptyStatePlace {
  readonly art: string;
  readonly actions: number;
  readonly text: string;
  readonly top: number | null;
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
     * as keys — and how many radios the page holds inside `main`, so a spec
     * comparing it with real Tab presses can say it compared a radio group.
     * Until #698 the model counted every radio and the radios a browser does
     * not stop on were reported apart; the model now makes a named group one
     * stop, as Chromium does, and the whole sequence is compared.
     */
    __oylTabModel?: () => { readonly stops: string[]; readonly radios: number };
    __oylReflow?: {
      readonly ready: boolean;
      readonly errors: readonly string[];
      readonly data: 'empty' | 'populated';
      readonly parameters: Partial<Record<RouteId, string>>;
      /** The item each `list-detail` route selects in the populated fixture — #670. */
      readonly selections: Partial<Record<RouteId, string>>;
      readonly populated: Partial<Record<RouteId, PopulatedExpectation>>;
      /** `testing/populated-shell.tsx` §`EMPTY_STATES` — #943. */
      readonly emptyStates: Partial<Record<RouteId, EmptyStateExpectation>>;
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
 * the forms are what #654 measured at 3,554 px.
 *
 * One database per walk (#690): the EMPTY walk's is never written to, and the
 * POPULATED walk's holds {@link TRANSFER_RIDES} of the library's long-named
 * rides, which is what puts the Export panel's ride chooser on the screen —
 * a `<select>` whose options are those names. The import-outcome table is
 * filled by {@link importOnTransfer}, on the populated walk's visit.
 */
const TRANSFER_RIDES = 3;

function transferPort(populated: boolean): TransferPort {
  const now = unixSeconds(Math.floor(Date.now() / 1000));
  return {
    store: openActivityStore(`oyl-reflow-harness-${populated ? 'populated' : 'empty'}`),
    athleteId: LOCAL_ATHLETE,
    newActivityId: () => activityId(crypto.randomUUID()),
    newRouteId: () => routeId(crypto.randomUUID()),
    now: () => now,
    timeZone: 'UTC',
    digest: webCryptoDigest,
    save: () => undefined,
    drafts: { forget: () => undefined },
    instance: { forget: () => undefined },
    theme: { forget: () => undefined },
    hostedModel: { forget: () => undefined },
    athleteRow: localAthleteRecord(now),
  };
}

async function fillTransferStore(port: TransferPort): Promise<void> {
  await port.store.ensureAthlete(port.athleteRow);
  for (let index = 0; index < TRANSFER_RIDES; index += 1) {
    if ((await port.store.getActivity(port.athleteId, fixtureRide(index).id)) === undefined) {
      await port.store.putActivity({ ...fixtureRide(index), athleteId: port.athleteId });
    }
  }
}

/**
 * A file name with no break opportunity in it, which is where an outcome row
 * gets wide — and the bytes of no format this client reads, so the row says
 * why it was refused.
 */
const UNREADABLE_FILE_NAME =
  'an-export-from-another-platform-whose-name-has-no-break-opportunity-anywhere-in-it-at-all.fit';

/**
 * Import one file through the Files screen's own form, as a rider would, so
 * its outcome table has a row — #690. `?data=populated` only, and only once:
 * the table replaces its rows on each import.
 */
async function importOnTransfer(): Promise<void> {
  if (document.querySelector('.oyl-main .oyl-scroll-region tbody tr') !== null) {
    return;
  }
  const input = document.querySelector<HTMLInputElement>('#oyl-import-files');
  if (input === null) {
    throw new Error('the Files screen has no #oyl-import-files to import through');
  }
  const files = new DataTransfer();
  files.items.add(new File([new Uint8Array([1, 2, 3, 4])], UNREADABLE_FILE_NAME));
  input.files = files.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await nextFrame();
  const start = [...document.querySelectorAll<HTMLButtonElement>('.oyl-main button')].find(
    (button) => button.textContent === 'Import 1 file',
  );
  if (start === undefined) {
    throw new Error('choosing a file did not offer “Import 1 file”');
  }
  start.click();
  const deadline = performance.now() + PATIENCE_MS;
  while (document.querySelector('.oyl-main .oyl-scroll-region tbody tr') === null) {
    if (performance.now() > deadline) {
      throw new Error('the import never put a row in the outcome table');
    }
    await nextFrame();
  }
}

/**
 * What this page expects of each route — {@link POPULATED}, and for the Files
 * screen its own (#690), because this page, unlike the shell's other callers,
 * fills that screen's store and imports a file: both the ride chooser and the
 * outcome table must be on the populated page, and neither on the empty one.
 */
const EXPECTATIONS: Record<RouteId, PopulatedExpectation> = {
  ...POPULATED,
  transfer: {
    kind: 'fixture',
    marker: '.oyl-main:has(#oyl-export-ride option):has(.oyl-scroll-region tbody tr)',
  },
};

function shell(populated: boolean, transfer: TransferPort): JSX.Element {
  const bluetooth = new URLSearchParams(window.location.search).get('bluetooth') === 'available';
  // #945's control: the router as it was before #945, every change of fragment
  // applied outside `startTransition` (`shell/useRoute.ts` §`RouteUpdates`).
  const synchronous = new URLSearchParams(window.location.search).get('routes') === 'synchronous';
  return (
    <PopulatedShell
      populated={populated}
      {...(bluetooth ? { capabilities: AVAILABLE_BLUETOOTH } : {})}
      {...(synchronous ? { routeUpdates: 'synchronous' as const } : {})}
      transfer={transfer}
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

/**
 * Resolve once the route cross-fade (#945) has finished, if one is running.
 *
 * ⚠️ React runs a transition's passive effects — where a view starts reading
 * its port — only once the view transition has finished, so for the 200 ms of
 * the fade the DOM is still, and {@link untilQuiet} would call a view that has
 * not begun to load "settled". A frame first, so a transition React has just
 * started has its animations.
 */
async function viewTransitionsFinished(): Promise<void> {
  await nextFrame();
  const fades = document
    .getAnimations()
    .filter((animation) => {
      const effect = animation.effect;
      return (
        effect instanceof KeyframeEffect &&
        (effect.pseudoElement ?? '').startsWith('::view-transition')
      );
    })
    .map(async (animation) =>
      animation.finished.then(
        () => undefined,
        () => undefined,
      ),
    );
  await Promise.all(fades);
  await nextFrame();
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

/** The activity library's cards, as {@link ReflowMeasurement.library} says. */
function libraryCards(): ReflowMeasurement['library'] {
  const library = document.querySelector('.oyl-library');
  if (library === null) return null;
  const list = library.querySelector<HTMLElement>('.oyl-activity-cards');
  const columns =
    list === null
      ? 0
      : getComputedStyle(list)
          .gridTemplateColumns.split(' ')
          .filter((track) => track.trim() !== '').length;
  const links = [...library.querySelectorAll('.oyl-activity-card__name a')].map((link) =>
    link.getBoundingClientRect(),
  );
  const values = [...library.querySelectorAll('.oyl-activity-card__facts .oyl-reading__value')];
  const lines = values.map((value) => value.getClientRects().length);
  const spills = values.map((value) => {
    const fact = value.closest('dd');
    return fact === null
      ? 0
      : value.getBoundingClientRect().right - fact.getBoundingClientRect().right;
  });
  return {
    cards: library.querySelectorAll('.oyl-activity-cards > li').length,
    columns,
    tables: library.querySelectorAll('table').length,
    shortestLink: links.length === 0 ? null : Math.min(...links.map((box) => box.height)),
    narrowestLink: links.length === 0 ? null : Math.min(...links.map((box) => box.width)),
    mostReadingLines: lines.length === 0 ? 0 : Math.max(...lines),
    readingSpill: spills.length === 0 ? 0 : Math.max(...spills),
  };
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

/** Text marked kept-visible between the route's summary and its first control — #993. */
function keptBeforeFirstControl(): string[] {
  const main = document.querySelector('main');
  if (main === null) {
    return [];
  }
  const control = laidOutControls(main)[0] ?? null;
  const summary = main.querySelector(':scope > h1 + p');
  return [...main.querySelectorAll('[data-oyl-kept-visible]')]
    .filter(
      (element) =>
        laidOut(element) &&
        element.parentElement?.closest('[data-oyl-kept-visible]') == null &&
        (summary === null || inOrder(summary, element)) &&
        (control === null || (!element.contains(control) && inOrder(element, control))),
    )
    .map((element) => textOf(element).slice(0, 80));
}

/** The route's summary under its `h1`, and how many lines it lays out on — #993. */
function summaryLines(): { readonly text: string; readonly lines: number } | null {
  const summary = document.querySelector('main > h1 + p');
  if (summary === null || !laidOut(summary)) {
    return null;
  }
  // Counted from the TEXT's own line boxes rather than the paragraph's height:
  // Home's line is a grid item beside #939's hero, stretched to its row and
  // padded, so its box says nothing about how its words wrapped.
  const range = document.createRange();
  range.selectNodeContents(summary);
  const tops = new Set(
    [...range.getClientRects()]
      .filter((rect) => rect.width > 0 && rect.height > 0)
      .map((rect) => Math.round(rect.top)),
  );
  return { text: textOf(summary), lines: tops.size };
}

/** The help control under a screen's title, and what it holds — #993. */
function helpControl(): HelpControl | null {
  const toggle = document.querySelector('main > .oyl-help > summary');
  if (toggle === null) {
    return null;
  }
  const box = toggle.getBoundingClientRect();
  const visibleText = [...toggle.querySelectorAll('*:not([aria-hidden="true"])')]
    .filter((element) => element.children.length === 0)
    .map((element) => element.textContent ?? '')
    .join(' ');
  return {
    name: (toggle.getAttribute('aria-label') ?? visibleText).replace(/\s+/g, ' ').trim(),
    width: box.width,
    height: box.height,
    contents: [...(toggle.parentElement?.querySelectorAll('.oyl-help__panel > p') ?? [])]
      .map(textOf)
      .join(' '),
  };
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
 * Every section that tucks its explanation behind its heading's ⓘ, that
 * heading, and the height of the prose between it and the section's first
 * control — #666 applied section by section: a long page whose first control
 * is near the top can still bury every later one under a paragraph, which is
 * Settings on `main`.
 *
 * ⚠️ **Since #1031 a tucking section is one with a `SectionHeading`'s ⓘ**
 * (`design/SectionHelp.tsx`), and a reviewer who remembers this reading
 * `details.oyl-more` is reading the old file: the "More about" disclosure that
 * closed a section beneath its controls is gone, and the ⓘ is the one pattern.
 * Its heading is the one in its own row, not the last one before it.
 */
function sections(): SectionProse[] {
  const main = document.querySelector('main');
  if (main === null) {
    return [];
  }
  const headings = [...main.querySelectorAll('h2, h3, h4')].filter(laidOut);
  const controls = laidOutControls(main);
  const found: SectionProse[] = [];
  for (const details of main.querySelectorAll('.oyl-section-head > details.oyl-section-help')) {
    const heading = details.parentElement?.querySelector(':scope > :is(h2, h3, h4)');
    if (heading === null || heading === undefined || !laidOut(heading)) {
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
 * each section's ⓘ panel copied, drawn, to straight under its section's
 * heading row, where the explanation stood before it was tucked. The fold and
 * the section rules must then FAIL on the routes that tuck anything, or they
 * are not measuring it.
 *
 * ⚠️ Since #1031 it copies the ⓘ's PANEL (`.oyl-section-help__panel`), not a
 * "More about" disclosure: those are gone. The panel alone, so the copy is
 * prose under the heading and not a second ⓘ, and it lands where an open ⓘ
 * draws it — in the flow, before the section's controls.
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
  for (const panel of main.querySelectorAll(
    '.oyl-section-head > details.oyl-section-help > .oyl-section-help__panel',
  )) {
    const head = panel.closest('.oyl-section-head');
    const copy = panel.cloneNode(true) as HTMLElement;
    copy.setAttribute('data-oyl-inline-copy', '');
    head?.after(copy);
  }
}

/**
 * #993's control: the line under the title as it was before the ruling — the
 * route's one line, its help and its notes in ONE paragraph straight under the
 * `h1` — and the notes ALSO copied above the view, where kept-visible text
 * stood before the first control. The one-line rule must then fail on every
 * route with help or notes, and the "notes below the controls" rule on every
 * route with notes; otherwise neither is measuring anything.
 *
 * ⚠️ Where a route's help repeats its old first sentence whole (Trainer game,
 * Camera), the paragraph is LONGER than the one it replaced. It is a control
 * that must fail, not a reconstruction of the old page.
 *
 * Copies, for {@link inlineDisclosureCopies}' reason: React owns the real ones.
 */
function putTheLineBack(route: RouteDefinition): void {
  const main = document.querySelector('main');
  const title = main?.querySelector(':scope > h1');
  if (main === null || main === undefined || title === null || title === undefined) {
    return;
  }
  const line = document.createElement('p');
  line.className = 'oyl-muted';
  line.setAttribute('data-oyl-inline-copy', '');
  line.textContent = [route.summary, ...(route.help ?? []), ...(route.notes ?? [])].join(' ');
  title.after(line);
  // Anywhere in `main`: a list–detail route's notes are in its list pane at
  // two panes (`ListDetail.tsx` §`notes`).
  const notes = main.querySelector('.oyl-note');
  if (notes !== null) {
    const copy = notes.cloneNode(true) as HTMLElement;
    copy.setAttribute('data-oyl-inline-copy', '');
    line.after(copy);
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
      clipBottom: clipBottomOf(element),
    };
  });
}

/** {@link ReflowMeasurement.emptyStates}. */
function emptyStates(): EmptyStatePlace[] {
  const main = document.querySelector('main');
  if (main === null) {
    return [];
  }
  return [...main.querySelectorAll('[data-oyl-empty-state]')].filter(laidOut).map((element) => {
    const actions = [...element.querySelectorAll('.oyl-button')];
    const first = actions[0];
    return {
      art: element.getAttribute('data-oyl-empty-state') ?? '',
      actions: actions.length,
      text: (first?.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 60),
      top: first === undefined ? null : first.getBoundingClientRect().top + window.scrollY,
    };
  });
}

/** {@link PrimaryPlace.clipBottom}: the bottom of a pane that scrolls on its own. */
function clipBottomOf(element: Element): number | null {
  const pane = element.closest('[data-oyl-pane]');
  if (pane === null || getComputedStyle(pane).overflowY === 'visible') {
    return null;
  }
  return pane.getBoundingClientRect().bottom + window.scrollY;
}

async function visit(hash: string): Promise<ReflowMeasurement> {
  const control = new URLSearchParams(window.location.search).get('control');
  removeInlineCopies();
  window.location.hash = hash;
  const { route } = matchHash(hash);
  const headed = await untilHeading(route.title);
  await viewTransitionsFinished();
  let quiet = await untilQuiet();
  if (
    route.id === 'transfer' &&
    new URLSearchParams(window.location.search).get('data') === 'populated'
  ) {
    await importOnTransfer();
    quiet = await untilQuiet();
  }
  await document.fonts.ready;
  applyControl(control);
  if (new URLSearchParams(window.location.search).get('disclosures') === 'inline') {
    inlineDisclosureCopies();
  }
  if (new URLSearchParams(window.location.search).get('line') === 'before993') {
    putTheLineBack(route);
  }
  await nextFrame();
  visited.add(route.id);
  // Read through a `Partial` view on purpose: the spec's "no entry" fault has
  // to be reachable if the `Record` type is ever loosened.
  const expectation = (EXPECTATIONS as Partial<Record<RouteId, PopulatedExpectation>>)[route.id];
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
    library: libraryCards(),
    sortControlHeight:
      document.querySelector('#oyl-library-sort')?.getBoundingClientRect().height ?? null,
    expectation,
    markerPresent: marker === undefined ? null : document.querySelector(marker) !== null,
    errors: raised,
    settledWithinPatience: headed && quiet,
    firstControl: firstControl(),
    fold: foldLine(),
    proseBeforeFirstControl: proseBeforeFirstControl(),
    keptBeforeFirstControl: keptBeforeFirstControl(),
    summary: summaryLines(),
    help: helpControl(),
    sections: sections(),
    disclosures: {
      total: document.querySelectorAll('main details').length,
      open: document.querySelectorAll('main details[open]').length,
    },
    listDetail: listDetailBoxes(),
    railRight: railRight(),
    primaries: primaries(),
    emptyStates: emptyStates(),
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

/**
 * `?panes=page` — #723's control. The layout #723 replaced, put back by a
 * stylesheet of the harness's own after the shipping one: the shell as tall as
 * its content, `main` a block, and the panes growing with what they hold, so
 * they scroll with the page again. Every rule it undoes is one #723 added, so
 * the spec's "the panes scroll on their own" assertions must FAIL under it.
 */
function applyPanesControl(): void {
  if (new URLSearchParams(window.location.search).get('panes') !== 'page') {
    return;
  }
  const style = document.createElement('style');
  style.setAttribute('data-oyl-control', 'panes=page');
  style.textContent = `
    .oyl-shell:has(.oyl-list-detail--two) { height: auto !important; }
    .oyl-main--list-detail:has(.oyl-list-detail--two) { display: block !important; }
    .oyl-list-detail--two { grid-template-rows: none !important; align-items: start !important; }
    .oyl-list-detail--two > .oyl-list-detail__list,
    .oyl-list-detail--two > .oyl-list-detail__detail { overflow-y: visible !important; }
  `;
  document.head.append(style);
}

/**
 * #1014's first cut, verbatim: CSS columns, which flowed the sections DOWN the
 * first column and on into the next. `?sections=columns` deletes the shipped
 * grid's rules through the CSSOM and puts these back, so
 * `sections.browser.spec.ts`' row-major check has the layout it replaced to
 * fail on, and the heights it publishes have a "before".
 */
const FIRST_CUT_COLUMNS = `
.oyl-sections > * { break-inside: avoid; }
.oyl-sections :is(h2, h3) { break-after: avoid; }
.oyl-sections > .oyl-sections__title,
.oyl-sections > :has(.oyl-scroll-region) { column-span: all; }
@container oyl-pane (min-width: 40rem) {
  .oyl-sections:not(.oyl-sections--broad) { columns: 2; column-gap: var(--oyl-space-lg); }
  .oyl-sections > .oyl-panel + .oyl-panel { margin-block-start: var(--oyl-space-md); }
}
@container oyl-pane (min-width: 64rem) {
  .oyl-sections:not(.oyl-sections--broad) { columns: 3; }
}
@container oyl-pane (min-width: 54rem) {
  .oyl-sections--broad { columns: 2; column-gap: var(--oyl-space-lg); }
}
`;

/**
 * Deletes every shipped rule that names `.oyl-sections` — the grid's
 * top-level rules (two in `theme.css`, three once the build splits the
 * title's selector list from its `:has()`) and its three container queries —
 * and fails unless it found all three queries and a top-level rule: a control
 * that deleted nothing would measure the shipped page and call it the defect.
 */
function deleteSectionsGrid(): void {
  let containers = 0;
  let styles = 0;
  for (const sheet of document.styleSheets) {
    const rules = sheet.cssRules;
    for (let index = rules.length - 1; index >= 0; index -= 1) {
      const rule = rules[index];
      if (rule instanceof CSSStyleRule && rule.selectorText.includes('.oyl-sections')) {
        sheet.deleteRule(index);
        styles += 1;
      } else if (rule instanceof CSSContainerRule && rule.cssText.includes('.oyl-sections')) {
        sheet.deleteRule(index);
        containers += 1;
      }
    }
  }
  if (containers !== 3 || styles < 2) {
    throw new Error(
      `reflow harness: expected three .oyl-sections container queries and two or more rules, ` +
        `deleted ${String(containers)} and ${String(styles)}`,
    );
  }
}

/**
 * `?sections=prose`, `?sections=uncontained` and `?sections=columns` — #1014's
 * controls, one for each container its columns are decided by and one for the
 * rows. `prose` switches the `sections` routes of the REAL table back to the
 * reading measure before anything renders, so `main` is no container and their
 * sections are one column again; `uncontained` takes the container off a
 * list–detail route's detail pane, by a stylesheet of the harness's own after
 * the shipping one, so the pane's sections are one column again; `columns`
 * puts the first cut's CSS columns in place of the grid
 * ({@link FIRST_CUT_COLUMNS}). `sections.browser.spec.ts`' column assertions
 * must FAIL under the first two, and its row-major one under the third.
 */
function applySectionsControl(): void {
  const sections = new URLSearchParams(window.location.search).get('sections');
  if (sections === 'prose') {
    for (const route of ALL_ROUTES) {
      if (route.layout === 'sections') {
        (route as { layout: RouteLayout }).layout = 'prose';
      }
    }
  } else if (sections === 'uncontained') {
    const style = document.createElement('style');
    style.setAttribute('data-oyl-control', 'sections=uncontained');
    style.textContent = '.oyl-list-detail__detail { container: none !important; }';
    document.head.append(style);
  } else if (sections === 'columns') {
    deleteSectionsGrid();
    const style = document.createElement('style');
    style.setAttribute('data-oyl-control', 'sections=columns');
    style.textContent = FIRST_CUT_COLUMNS;
    document.head.append(style);
  }
}

/**
 * `?shape=off` and `?shape=tall` — #941. `off` takes the drawn shape off every
 * route and workout card and puts the card back as a plain block, which is the
 * page before #941: the margin `list-detail.browser.spec.ts` §"#941" holds the
 * shipped cards are measured against is read from it, in the same run and the
 * same fonts. `tall` is that block's control: the shape at three times its
 * declared height (9rem, since #982 made the declared height 3rem), so a card
 * grows by far more than the drawing's own cost and must push the primary
 * below it past the bound §"#941" holds.
 */
function applyShapeControl(): void {
  const shape = new URLSearchParams(window.location.search).get('shape');
  if (shape === null) {
    return;
  }
  if (shape !== 'off' && shape !== 'tall') {
    throw new Error(`reflow harness: ?shape must be "off" or "tall", not ${shape}`);
  }
  const style = document.createElement('style');
  style.setAttribute('data-oyl-control', `shape=${shape}`);
  style.textContent =
    shape === 'off'
      ? `
    .oyl-shape-card { display: block !important; }
    .oyl-shape-card > p { margin-bottom: 1em !important; }
    .oyl-shape-card__art { display: none !important; }
  `
      : `
    .oyl-shape-card {
      --oyl-shape-card-art-height: 9rem !important;
    }
  `;
  document.head.append(style);
}

/**
 * `?illustration=tall` — #943's control. Every empty state's drawing at half
 * the viewport's height rather than its declared 48 px, so the spec's "the
 * action starts above the fold" must FAIL — at least on Activities — or it is
 * not measuring the action.
 */
function applyIllustrationControl(): void {
  const illustration = new URLSearchParams(window.location.search).get('illustration');
  if (illustration === null) {
    return;
  }
  if (illustration !== 'tall') {
    throw new Error(`reflow harness: ?illustration must be "tall", not ${illustration}`);
  }
  const style = document.createElement('style');
  style.setAttribute('data-oyl-control', 'illustration=tall');
  style.textContent = `.oyl-empty-state { --oyl-empty-state-art-height: 50vh !important; }`;
  document.head.append(style);
}

/**
 * `?chooser=as-shipped` — #1028's control. Analysis' ride chooser as it
 * shipped before #1028: `.oyl-input`'s 8rem, and a `base-select` whose
 * closed control wraps its text, which on the owner's tablet put a ride's
 * name over four lines. Laid over the shipping stylesheet by a stylesheet of
 * the harness's own, so `ride-chooser.browser.spec.ts`' one-line and
 * full-width checks must FAIL under it, or they measure nothing.
 */
function applyChooserControl(): void {
  const chooser = new URLSearchParams(window.location.search).get('chooser');
  if (chooser === null) {
    return;
  }
  if (chooser !== 'as-shipped') {
    throw new Error(`reflow harness: ?chooser must be "as-shipped", not ${chooser}`);
  }
  const style = document.createElement('style');
  style.setAttribute('data-oyl-control', 'chooser=as-shipped');
  style.textContent = '#oyl-zone-ride { width: 8rem !important; white-space: normal !important; }';
  document.head.append(style);
}

/**
 * The route cross-fade (#945), made instant unless `?motion=on`.
 *
 * Every navigation on this page still goes through the real `startTransition`
 * and `<ViewTransition>` — focus, the lazy-view retry and the layout are
 * measured through the path a rider takes — but its animations last no time.
 * The layout walks here make hundreds of navigations, and a 200 ms fade each
 * (with React running the new view's effects only once the fade has finished)
 * cost the browser gate about two minutes on the CI runner. What the fade
 * itself does is `motion.browser.spec.ts`'s, which opens this page with
 * `?motion=on`.
 */
function applyMotionSetting(): void {
  if (new URLSearchParams(window.location.search).get('motion') === 'on') {
    return;
  }
  const style = document.createElement('style');
  style.setAttribute('data-oyl-control', 'motion=instant');
  style.textContent =
    '::view-transition-group(*), ::view-transition-image-pair(*), ' +
    '::view-transition-old(*), ::view-transition-new(*) { animation-duration: 0s !important; }';
  document.head.append(style);
}

async function main(): Promise<void> {
  const host = document.querySelector('#shell');
  if (host === null) {
    throw new Error('reflow harness: #shell is missing from reflow.html');
  }
  const data = new URLSearchParams(window.location.search).get('data');
  if (data !== 'empty' && data !== 'populated') {
    throw new Error(`reflow harness: ?data must be "empty" or "populated", not ${String(data)}`);
  }
  applyMotionSetting();
  applyLayoutControl();
  applyPanesControl();
  applySectionsControl();
  applyShapeControl();
  applyIllustrationControl();
  applyChooserControl();
  // A page opened with a hash keeps it (#670: a fresh load of a selection).
  if (window.location.hash === '') {
    window.location.hash = '#/';
  }
  const transfer = transferPort(data === 'populated');
  if (data === 'populated') {
    await fillTransferStore(transfer);
  }
  flushSync(() => {
    createRoot(host).render(<StrictMode>{shell(data === 'populated', transfer)}</StrictMode>);
  });
  window.__oylReflow = {
    ready: true,
    errors,
    data,
    parameters: PARAMETERS,
    selections: SELECTIONS,
    populated: EXPECTATIONS,
    emptyStates: EMPTY_STATES,
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
window.__oylTabModel = () => {
  const main = document.querySelector('main');
  const model = tabbableElements(document).filter(
    (element) => main?.contains(element) === true && element !== main,
  );
  return {
    stops: model.map(tabKey),
    radios: main?.querySelectorAll('input[type="radio"]').length ?? 0,
  };
};

// #674: the view groups first, so every view renders on the render that asks. @see viewGroupsLoaded
// ⚠️ Except under `?chunks=lazy` (#945), where each group is fetched on its
// first visit as it is in the product — so a spec can make one fail.
(new URLSearchParams(window.location.search).get('chunks') === 'lazy'
  ? Promise.resolve()
  : viewGroupsLoaded()
)
  .then(() => main())
  .catch((error: unknown) => {
    errors.push(error instanceof Error ? error.message : String(error));
    window.__oylReflow = {
      ready: false,
      errors,
      data: 'empty',
      parameters: PARAMETERS,
      selections: SELECTIONS,
      populated: EXPECTATIONS,
      emptyStates: EMPTY_STATES,
      visit: () => Promise.reject(new Error('the reflow harness did not start')),
      unvisited: () => ALL_ROUTES.map((route) => route.id),
    };
  });
