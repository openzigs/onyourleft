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
 */

import { StrictMode, type JSX } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';

import { Button } from '../src/design/Button';
import { ScrollTable } from '../src/design/ScrollTable';
import { VisuallyHidden } from '../src/design/VisuallyHidden';
import { OSM_ATTRIBUTION } from '../src/map/basemap';
import type { MapPort } from '../src/map/port';
import { ALL_ROUTES, matchHash, type RouteId } from '../src/shell/routes';
import {
  PARAMETERS,
  POPULATED,
  PopulatedShell,
  type PopulatedExpectation,
} from '../src/testing/populated-shell';

// The shipping stylesheet, which is the whole point.
import '../src/design/theme.css';

/** How long the DOM must be still before a route counts as settled. */
const QUIET_MS = 250;
/** The most a route is waited for, first for its `h1` and then for quiet. */
const PATIENCE_MS = 10_000;

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
}

declare global {
  interface Window {
    __oylReflow?: {
      readonly ready: boolean;
      readonly errors: readonly string[];
      readonly data: 'empty' | 'populated';
      readonly parameters: Partial<Record<RouteId, string>>;
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

function shell(populated: boolean): JSX.Element {
  return (
    <PopulatedShell
      populated={populated}
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

async function visit(hash: string): Promise<ReflowMeasurement> {
  const control = new URLSearchParams(window.location.search).get('control');
  window.location.hash = hash;
  const { route } = matchHash(hash);
  const headed = await untilHeading(route.title);
  const quiet = await untilQuiet();
  await document.fonts.ready;
  applyControl(control);
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
  };
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
  window.location.hash = '#/';
  flushSync(() => {
    createRoot(host).render(<StrictMode>{shell(data === 'populated')}</StrictMode>);
  });
  window.__oylReflow = {
    ready: true,
    errors,
    data,
    parameters: PARAMETERS,
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

try {
  main();
} catch (error: unknown) {
  errors.push(error instanceof Error ? error.message : String(error));
  window.__oylReflow = {
    ready: false,
    errors,
    data: 'empty',
    parameters: PARAMETERS,
    populated: POPULATED,
    visit: () => Promise.reject(new Error('the reflow harness did not start')),
    unvisited: () => ALL_ROUTES.map((route) => route.id),
  };
}
