// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The home screen, laid out by a real engine — #428.
 *
 * The **real** `shell/AppShell.tsx` at the **real** `/`, under the **real**
 * `design/theme.css`, handed the repository's own analysis double holding a
 * full history and a stub ride controller — so every card the screen can
 * draw is on it. jsdom performs no layout (docs/agents/accessibility.md §4e): "uses the full
 * width of a landscape tablet" and "does not overflow at 320 px" are
 * measurements, and this is where they are taken.
 *
 * ## The control
 *
 * `window.__oylHome.constrain()` puts the prose reading measure back on
 * `main` — the rule every other reading route keeps — and the spec requires
 * the cards to stop short of the window again. Without it, "fills the width"
 * is as true of a page whose main rendered nothing.
 *
 * ## #1010: Next up, This week, and the ride cards as art
 *
 * `measure()` also publishes the fold (the viewport less its bottom inset, or
 * the top of a bottom navigation bar — `reflow-harness.tsx` §`foldLine`'s
 * rule); *Next up*'s card, its fill, its drawings (since #2043 only the
 * route's small climb, where the frame shows it), words and Ride; *This week*'s and
 * the Trainer card's boxes and the ride cards' section; and each ride card
 * with its picture, its band, the band's computed fill, its words and its
 * link — the link's box, its declared `min-height`/`min-width`, the box it
 * has with that floor stripped, and what is hit at the card's middle.
 *
 * The newest ride of the fixture was ridden on a saved route, so *Next up* is
 * the route kind — the one that draws a profile and makes the one route read.
 *
 * `home.html?rides=none` is a first open instead (#1429): the same shell with
 * no ride at all, ready once the empty state is drawn. It is a STATE, not a
 * control, and combines with the controls below (`?rides=none&hero=tall`).
 *
 * The controls, each the defect its assertion exists for:
 *
 * - `home.html?chart=narrow` — the week chart back at the 8.5rem it had
 *   beside the sentence, which is the chart the owner's review of #2049
 *   (2026-11-05) found too small to read;
 * - `home.html?hero=tall` — a picture 90 vh tall put back across Next up above
 *   its words, which must push its Ride under a phone's fold;
 * - `home.html?picture=back` — #2043's: the picture #1010 drew put back above
 *   Next up's words at the 12rem floor it had, which is the card #2043
 *   replaced — its Ride under 30 % of the window, and the card over 20 %;
 * - `home.html?dashboard=off` — the landscape dashboard rule deleted, so Next
 *   up no longer has the sensors beside it;
 * - `home.html?columns=one` — #2044's: every module one column wide, which
 *   must push the week module under a landscape tablet's fold;
 * - `home.html?band=overlay` — the words laid over the picture on a clear
 *   band, which is what "text on art" would be.
 *
 * ⚠️ Since #2043 Next up has no picture of its own, so the first two put one
 * back as the card's first flex item, a whole line wide — `::before`, which
 * pushes the row under it exactly as #1010's picture pushed its band. The
 * short-viewport control (`?short=off`) went with the picture: the rule it
 * deleted no longer holds Next up's Ride above any fold.
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';

import {
  altitudeMetres,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  metres,
  routeProfile,
  seconds,
  unixSeconds,
  watts,
  type RoutePoint,
} from '@onyourleft/domain';
import { activityId, athleteId, type RouteRecord } from '@onyourleft/store';

import { tabbableElements } from '../src/a11y/audit';
import { stubAnalysis } from '../src/analysis/testing';
import { routeStub, stubRouteId } from '../src/routes/testing';
import { stubActivity } from '../src/detail/testing';
import { idleSnapshot, stubRideController } from '../src/ride/testing';
import { AppShell } from '../src/shell/AppShell';
import { viewGroupsLoaded } from './views-loaded';
import type { CapabilityProbe } from '../src/support/bluetooth-support';

// The shipping stylesheet, which is the whole point.
import '../src/design/theme.css';
import '../src/design/tailwind.css';

const NO_BLUETOOTH: CapabilityProbe = { bluetooth: undefined, secureContext: true };
const ATHLETE = athleteId('harness');
const DAY = 86_400;
const PATIENCE_MS = 10_000;

/** A route over a hill, so Next up has a shape to draw — `shape-cards.test.tsx`'s. */
const ROUTE: RouteRecord = ((): RouteRecord => {
  const points: RoutePoint[] = [];
  for (let along = 0; along <= 24_000; along += 50) {
    points.push({
      position: geographicPosition(
        degreesLatitude(51.5 + along / 111_195),
        degreesLongitude(-0.12),
      ),
      elevation: altitudeMetres(40 + 220 * Math.sin((Math.PI * along) / 24_000) ** 2),
    });
  }
  return {
    id: stubRouteId('harness-route'),
    createdBy: ATHLETE,
    name: 'Box Hill and back',
    profile: routeProfile(points),
    visibility: 'private',
    createdAt: unixSeconds(1_700_000_000),
    updatedAt: unixSeconds(1_700_000_000),
  };
})();

export interface Box {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly width: number;
  readonly height: number;
}

export interface HomeMeasurement {
  readonly viewport: { readonly width: number; readonly height: number };
  readonly main: Box | undefined;
  readonly mainClass: string;
  /** Every panel, in document order. */
  readonly cards: readonly Box[];
  /** `scrollWidth − innerWidth`: anything above zero is horizontal scrolling. */
  readonly horizontalOverflow: number;
  /** The fold, in CSS px from the top of the viewport. */
  readonly fold: number;
  /** #1010: Next up, or `undefined` when none was drawn. */
  readonly nextUp: NextUpMeasurement | undefined;
  readonly week: Box | undefined;
  readonly trainer: Box | undefined;
  /** #2044: the last ride's module. */
  readonly lastRide: Box | undefined;
  /** #2044: every child of the module grid, in DOM order. */
  readonly modules: readonly ModuleMeasurement[];
  /**
   * #2044: for each tab stop in the grid, in tab order
   * (`a11y/audit.ts` §`tabbableElements`), the index in {@link modules} of
   * the module it is in.
   */
  readonly tabModules: readonly number[];
  /** The ride cards' section. */
  readonly start: Box | undefined;
  /** The ride cards, in document order. */
  readonly rideCards: readonly RideCardMeasurement[];
  /** The Trainer card's glyph, or `undefined` when none was drawn. */
  readonly trainerGlyph: Box | undefined;
  /**
   * The week chart beside the days-ridden sentence — #2049, in #939's ring's
   * place — or `undefined` when none was drawn.
   */
  readonly weekChart: Box | undefined;
  /**
   * The box the chart is laid out in (`.oyl-home__days`, the week card's
   * content width), and each bar with the value written over it — the owner's
   * review of #2049 (2026-11-05): the chart fills the card's width, and every
   * bar says its value.
   */
  readonly weekDays: Box | undefined;
  readonly weekBars: readonly {
    readonly bar: Box;
    readonly value: Box | undefined;
    readonly text: string;
  }[];
  /** Every `.oyl-button` in main that is a PRIMARY, by its text. */
  readonly primaries: readonly string[];
}

export interface ModuleMeasurement {
  /** Its first heading's words, or the start of its text when it has none. */
  readonly name: string;
  readonly box: Box;
}

export interface NextUpMeasurement {
  readonly card: Box;
  /** The card's computed `background-color`: what its words stand on. */
  readonly fill: string;
  /** Every drawing the card renders, `display: none` ones left out. */
  readonly pictures: readonly Box[];
  /** Every line of the card's words, as line boxes. */
  readonly words: readonly Box[];
  readonly name: string;
  readonly ride: Box;
  readonly rideText: string;
  readonly rideHref: string;
  /** Whether the route's own shape is drawn, rather than the kit's hills. */
  readonly drawsProfile: boolean;
}

export interface RideCardMeasurement {
  readonly card: Box;
  /** The card's picture — `.oyl-ride-card__art` — or `undefined` when not rendered. */
  readonly art: Box | undefined;
  /** The band the words stand on — `.oyl-ride-card__body`. */
  readonly band: Box;
  /** The band's computed `background-color`. */
  readonly bandFill: string;
  /** The heading's TEXT and the line under it, as line boxes. */
  readonly words: readonly Box[];
  readonly linkText: string;
  readonly link: Box;
  /** The link's computed `min-height` and `min-width`, in px. */
  readonly declaredMinHeight: number;
  readonly declaredMinWidth: number;
  /** The link's box with `min-height` and `min-width` set to 0. */
  readonly stripped: Box;
  /**
   * The computed `min-height` while it was stripped — `0px`, or the strip did
   * not take and `stripped` is the floored box again.
   */
  readonly strippedMinHeight: string;
  /** Whether `elementFromPoint` at the card's middle is this card's link. */
  readonly middleHitsOwnLink: boolean;
  /** The text of whatever link the middle hit, for a failure message. */
  readonly middleHit: string;
}

declare global {
  interface Window {
    __oylHome?: {
      readonly ready: boolean;
      readonly errors: readonly string[];
      readonly measure: () => HomeMeasurement;
      readonly constrain: () => void;
    };
  }
}

const errors: string[] = [];

function boxOf(element: Pick<Element, 'getBoundingClientRect'>): Box {
  const rect = element.getBoundingClientRect();
  return {
    left: rect.left,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    width: rect.width,
    height: rect.height,
  };
}

/** A box, or `undefined` for an element that is absent or not rendered. */
function boxOrNothing(element: Element | null): Box | undefined {
  if (element === null || element.getClientRects().length === 0) {
    return undefined;
  }
  return boxOf(element);
}

/** The line boxes of every element `selector` finds inside `root`. */
function lineBoxes(root: Element, selector: string): Box[] {
  return [...root.querySelectorAll(selector)].flatMap((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    return [...range.getClientRects()].map((rect) => boxOf({ getBoundingClientRect: () => rect }));
  });
}

function measureNextUp(): NextUpMeasurement | undefined {
  const card = document.querySelector('.oyl-next-up');
  const ride = card?.querySelector<HTMLAnchorElement>('a.oyl-next-up__ride');
  if (card === null || card === undefined || ride === null || ride === undefined) {
    return undefined;
  }
  return {
    card: boxOf(card),
    fill: getComputedStyle(card).backgroundColor,
    pictures: [...card.querySelectorAll('svg')].flatMap((svg) => boxOrNothing(svg) ?? []),
    words: lineBoxes(card, 'h2, p'),
    name: (card.querySelector('.oyl-next-up__name')?.textContent ?? '').trim(),
    ride: boxOf(ride),
    rideText: (ride.textContent ?? '').trim(),
    rideHref: ride.getAttribute('href') ?? '',
    drawsProfile: card.querySelector('.oyl-next-up__profile') !== null,
  };
}

function measure(): HomeMeasurement {
  window.scrollTo(0, 0);
  const main = document.querySelector('main');
  const modules = [...document.querySelectorAll('.oyl-home > *')];
  const head = {
    viewport: { width: window.innerWidth, height: window.innerHeight },
    main: main === null ? undefined : boxOf(main),
    mainClass: main?.className ?? '',
    cards: [...document.querySelectorAll('.oyl-home > .oyl-panel')].map(boxOf),
    horizontalOverflow: document.documentElement.scrollWidth - window.innerWidth,
    fold: foldLine(),
    nextUp: measureNextUp(),
    week: boxOrNothing(document.querySelector('.oyl-home__week')),
    trainer: boxOrNothing(document.querySelector('.oyl-home__trainer')),
    lastRide: boxOrNothing(document.querySelector('.oyl-home__last')),
    modules: modules.map((module) => ({
      name: (module.querySelector('h2')?.textContent ?? module.textContent ?? '')
        .trim()
        .slice(0, 40),
      box: boxOf(module),
    })),
    tabModules: tabbableElements(document)
      .map((stop) => modules.findIndex((module) => module.contains(stop)))
      .filter((index) => index >= 0),
    start: boxOrNothing(document.querySelector('.oyl-home__start')),
    trainerGlyph: boxOrNothing(document.querySelector('.oyl-home__glyph')),
    weekChart: boxOrNothing(document.querySelector('.oyl-week-chart')),
    weekDays: boxOrNothing(document.querySelector('.oyl-home__days')),
    weekBars: [...document.querySelectorAll('.oyl-week-chart__bar')].map((bar) => {
      const day = bar.getAttribute('data-oyl-week-day') ?? '';
      const value = document.querySelector(`.oyl-week-chart__value[data-oyl-week-day="${day}"]`);
      return { bar: boxOf(bar), value: boxOrNothing(value), text: value?.textContent ?? '' };
    }),
    primaries: [...document.querySelectorAll('main .oyl-button')]
      .filter(
        (button) =>
          !button.classList.contains('oyl-button--secondary') &&
          !button.classList.contains('oyl-button--tertiary') &&
          !button.classList.contains('oyl-button--danger'),
      )
      .map((button) => (button.textContent ?? '').trim()),
  };
  const rideCards = [...document.querySelectorAll('.oyl-home__rides > li')].map(measureCard);
  window.scrollTo(0, 0);
  return { ...head, rideCards };
}

function measureCard(card: Element): RideCardMeasurement {
  const link = card.querySelector<HTMLAnchorElement>('a');
  const band = card.querySelector('.oyl-ride-card__body');
  if (link === null || band === null) {
    throw new Error('home harness: a ride card holds no link or no band');
  }
  window.scrollTo(0, 0);
  const style = getComputedStyle(link);
  const shipped = boxOf(link);
  link.style.minHeight = '0';
  link.style.minWidth = '0';
  const stripped = boxOf(link);
  const strippedMinHeight = getComputedStyle(link).minHeight;
  link.style.minHeight = '';
  link.style.minWidth = '';
  const box = boxOf(card);
  const art = boxOrNothing(card.querySelector('.oyl-ride-card__art'));
  const bandBox = boxOf(band);
  const words = lineBoxes(card, 'h3, p');
  // The middle is hit-tested where it is on screen: `elementFromPoint` finds
  // nothing outside the viewport, so a card below the fold is scrolled to
  // first, and the page put back at its top afterwards (`measure`).
  card.scrollIntoView({ block: 'center' });
  const seen = card.getBoundingClientRect();
  const hit = document.elementFromPoint(seen.left + seen.width / 2, seen.top + seen.height / 2);
  const hitLink = hit?.closest('a') ?? null;
  return {
    card: box,
    art,
    band: bandBox,
    bandFill: getComputedStyle(band).backgroundColor,
    words,
    linkText: (link.textContent ?? '').trim(),
    link: shipped,
    declaredMinHeight: Number.parseFloat(style.minHeight),
    declaredMinWidth: Number.parseFloat(style.minWidth),
    stripped,
    strippedMinHeight,
    middleHitsOwnLink: hitLink === link,
    middleHit: (hitLink?.textContent ?? hit?.tagName ?? 'nothing').trim(),
  };
}

/** `reflow-harness.tsx` §`foldLine`, for the same reason. */
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
    if (box.width >= window.innerWidth - 1 && box.top > window.innerHeight / 2) {
      fold = Math.min(fold, box.top);
    }
  }
  return fold;
}

function constrain(): void {
  const main = document.querySelector('main');
  if (main === null || !main.classList.contains('oyl-main--dashboard')) {
    throw new Error('home harness: main does not carry the class the control removes');
  }
  main.classList.replace('oyl-main--dashboard', 'oyl-main--prose');
}

/**
 * Delete every rule `matches` picks out of the shipped sheets, and fail unless
 * exactly one went: a control that deleted nothing would measure the shipped
 * page and call it the defect.
 */
function deleteOneRule(what: string, matches: (rule: CSSRule) => boolean): void {
  let deleted = 0;
  for (const sheet of document.styleSheets) {
    const rules = sheet.cssRules;
    for (let index = rules.length - 1; index >= 0; index -= 1) {
      const rule = rules[index];
      if (rule !== undefined && matches(rule)) {
        sheet.deleteRule(index);
        deleted += 1;
      }
    }
  }
  if (deleted !== 1) {
    throw new Error(`home harness: expected one ${what} rule, deleted ${String(deleted)}`);
  }
}

/** `?dashboard=off`: the landscape dashboard's container rule. */
function deleteDashboardRule(): void {
  deleteOneRule(
    'dashboard',
    (rule) =>
      rule instanceof CSSContainerRule &&
      ['(min-width: 60rem)', '(width >= 60rem)'].includes(rule.conditionText) &&
      rule.cssText.includes('.oyl-next-up'),
  );
}

/** The controls that are a stylesheet of their own. */
const STYLE_CONTROLS: ReadonlyMap<string, string> = new Map([
  // #1010's fold control: a picture a screen tall above Next up's words.
  ['hero=tall', ".oyl-next-up::before { content: ''; flex: 0 0 100%; min-height: 90vh; }"],
  // #2043's: an approximation of the card #2043 replaced, a 12rem picture back above the words (main's card was taller).
  ['picture=back', ".oyl-next-up::before { content: ''; flex: 0 0 100%; min-height: 12rem; }"],
  // #2049's: the week chart back at the 8.5rem it was beside the sentence.
  ['chart=narrow', '.oyl-week-chart { width: 8.5rem !important; }'],
  // #2044's: every module one column wide, the layout the grid replaced.
  [
    'columns=one',
    '.oyl-home { grid-template-columns: minmax(0, 1fr) !important; } ' +
      '.oyl-home > * { grid-column: 1 / -1 !important; }',
  ],
  // Words over the picture on a clear band: "text on art".
  [
    'band=overlay',
    '.oyl-ride-card__art { position: absolute; inset: 0; } ' +
      '.oyl-ride-card__body { position: relative; margin-top: 6rem; background: transparent !important; }',
  ],
]);

async function until<T>(what: string, look: () => T | undefined | null): Promise<T> {
  const deadline = performance.now() + PATIENCE_MS;
  for (;;) {
    const found = look();
    if (found !== undefined && found !== null) {
      return found;
    }
    if (performance.now() > deadline) {
      throw new Error(`home harness: gave up waiting for ${what}`);
    }
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        resolve();
      });
    });
  }
}

async function run(): Promise<void> {
  const host = document.querySelector('#shell');
  if (host === null) {
    throw new Error('home harness: #shell is missing from home.html');
  }
  window.location.hash = '#/';
  const query = new URLSearchParams(window.location.search);
  // #1429: `?rides=none` is a first open — no ride on this device at all.
  const firstOpen = query.get('rides') === 'none';
  for (const [key, value] of query) {
    const css = STYLE_CONTROLS.get(`${key}=${value}`);
    if (key === 'rides' && value === 'none') {
      continue;
    } else if (css !== undefined) {
      const style = document.createElement('style');
      style.textContent = css;
      document.head.append(style);
    } else if (key === 'dashboard' && value === 'off') {
      deleteDashboardRule();
    } else {
      throw new Error(`home harness: no ?${key}=${value} control`);
    }
  }
  const now = Math.floor(Date.now() / 1000);
  const rides = Array.from({ length: firstOpen ? 0 : 60 }, (_unused, index) => ({
    activity: stubActivity({
      id: activityId(`ride-${String(index)}`),
      name: `An evening ride ${String(index)}`,
      startedAt: unixSeconds(now - (60 - index) * DAY),
      startedAtTimeZone: 'UTC',
      movingTime: seconds(3600),
      distance: metres(32_400),
      effortWeightedPower: watts(210),
      loadCoveredTime: seconds(3600),
      // The newest ride was on the saved route, so Next up draws it.
      ...(index === 59 ? { routeId: ROUTE.id } : {}),
    }),
  }));
  // #674: the view groups first, so every view renders on the render that asks.
  await viewGroupsLoaded();
  flushSync(() => {
    createRoot(host).render(
      <StrictMode>
        <AppShell
          capabilities={NO_BLUETOOTH}
          analysis={stubAnalysis(ATHLETE, rides)}
          routes={routeStub(ATHLETE, [ROUTE])}
          rideController={stubRideController(idleSnapshot()).controller}
        />
      </StrictMode>,
    );
  });
  if (firstOpen) {
    // The empty state is drawn once the read has come back with nothing.
    await until('the first-open state', () => document.querySelector('#oyl-home-empty'));
  } else {
    // The fitness card is the last to fill: its sentences need the read back.
    await until('the fitness sentences', () =>
      [...document.querySelectorAll('.oyl-home li')].find((each) =>
        (each.textContent ?? '').startsWith('Fitness'),
      ),
    );
    await until('Next up on the route', () =>
      document.querySelector('.oyl-next-up__profile') === null ? undefined : true,
    );
  }
  await document.fonts.ready;
  window.__oylHome = { ready: true, errors, measure, constrain };
}

run().catch((error: unknown) => {
  errors.push(error instanceof Error ? error.message : String(error));
  window.__oylHome = { ready: false, errors, measure, constrain };
});
