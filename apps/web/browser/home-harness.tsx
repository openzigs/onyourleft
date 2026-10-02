// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The home screen, laid out by a real engine — #428.
 *
 * The **real** `shell/AppShell.tsx` at the **real** `/`, under the **real**
 * `design/theme.css`, handed the repository's own analysis double holding a
 * full history and a stub ride controller — so every card the screen can
 * draw is on it. jsdom performs no layout (CLAUDE.md §4e): "uses the full
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
 * rule); *Next up*'s card, picture, band, words and Ride; *This week*'s and
 * the Trainer card's boxes and the ride cards' section; and each ride card
 * with its picture, its band, the band's computed fill, its words and its
 * link — the link's box, its declared `min-height`/`min-width`, the box it
 * has with that floor stripped, and what is hit at the card's middle.
 *
 * The newest ride of the fixture was ridden on a saved route, so *Next up* is
 * the route kind — the one that draws a profile and makes the one route read.
 *
 * The controls, each the defect its assertion exists for:
 *
 * - `home.html?hero=tall` — Next up's picture at 90 vh, which must push its
 *   Ride under a phone's fold;
 * - `home.html?dashboard=off` — the landscape dashboard rule deleted, so Next
 *   up no longer has This week beside it;
 * - `home.html?band=overlay` — the words laid over the picture on a clear
 *   band, which is what "text on art" would be;
 * - `home.html?short=off` — the short-viewport rule deleted.
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
  /** The ride cards' section. */
  readonly start: Box | undefined;
  /** The ride cards, in document order. */
  readonly rideCards: readonly RideCardMeasurement[];
  /** The Trainer card's glyph, or `undefined` when none was drawn. */
  readonly trainerGlyph: Box | undefined;
  /** The last-seven-days ring, or `undefined` when none was drawn. */
  readonly daysRing: Box | undefined;
  /** Every `.oyl-button` in main that is a PRIMARY, by its text. */
  readonly primaries: readonly string[];
}

export interface NextUpMeasurement {
  readonly card: Box;
  readonly art: Box | undefined;
  readonly band: Box | undefined;
  /** The band's computed `background-color`. */
  readonly bandFill: string;
  /** Every line of the band's words, as line boxes. */
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
  const band = card.querySelector('.oyl-next-up__band');
  return {
    card: boxOf(card),
    art: boxOrNothing(card.querySelector('.oyl-next-up__art')),
    band: boxOrNothing(band),
    bandFill: band === null ? '' : getComputedStyle(band).backgroundColor,
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
    start: boxOrNothing(document.querySelector('.oyl-home__start')),
    trainerGlyph: boxOrNothing(document.querySelector('.oyl-home__glyph')),
    daysRing: boxOrNothing(document.querySelector('.oyl-home__ring')),
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

/** `?short=off`: Home's short-viewport rule. The build writes range syntax. */
function deleteShortViewportRule(): void {
  deleteOneRule(
    'short-viewport Home',
    (rule) =>
      rule instanceof CSSMediaRule &&
      ['(max-height: 30rem)', '(height <= 30rem)'].includes(rule.conditionText) &&
      rule.cssText.includes('.oyl-next-up__art'),
  );
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
  // #1010's fold control: Next up's picture a screen tall.
  ['hero=tall', '.oyl-next-up__art { min-height: 90vh; }'],
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
  for (const [key, value] of query) {
    const css = STYLE_CONTROLS.get(`${key}=${value}`);
    if (css !== undefined) {
      const style = document.createElement('style');
      style.textContent = css;
      document.head.append(style);
    } else if (key === 'short' && value === 'off') {
      deleteShortViewportRule();
    } else if (key === 'dashboard' && value === 'off') {
      deleteDashboardRule();
    } else {
      throw new Error(`home harness: no ?${key}=${value} control`);
    }
  }
  const now = Math.floor(Date.now() / 1000);
  const rides = Array.from({ length: 60 }, (_unused, index) => ({
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
  // The fitness card is the last to fill: its sentences need the read back.
  await until('the fitness sentences', () =>
    [...document.querySelectorAll('.oyl-home li')].find((each) =>
      (each.textContent ?? '').startsWith('Fitness'),
    ),
  );
  await until('Next up on the route', () =>
    document.querySelector('.oyl-next-up__profile') === null ? undefined : true,
  );
  await document.fonts.ready;
  window.__oylHome = { ready: true, errors, measure, constrain };
}

run().catch((error: unknown) => {
  errors.push(error instanceof Error ? error.message : String(error));
  window.__oylHome = { ready: false, errors, measure, constrain };
});
