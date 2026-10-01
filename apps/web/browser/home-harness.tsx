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
 * ## #939: the hero band and the ride cards
 *
 * `measure()` also publishes the hero band's box, the fold (the viewport less
 * its bottom inset, or the top of a bottom navigation bar —
 * `reflow-harness.tsx` §`foldLine`'s rule), and each ride card with its link:
 * the link's box, its declared `min-height`/`min-width`, the box it has with
 * that floor stripped, and what is hit at the card's middle.
 *
 * `home.html?hero=tall` is #939's control: the band at 60 vh, which must push
 * the first ride card's control under a phone's fold — so a measurement that
 * finds it above the fold has measured the band and not a page that drew none.
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';

import { metres, seconds, unixSeconds, watts } from '@onyourleft/domain';
import { activityId, athleteId } from '@onyourleft/store';

import { stubAnalysis } from '../src/analysis/testing';
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
  /** Every card, in document order. */
  readonly cards: readonly Box[];
  /** `scrollWidth − innerWidth`: anything above zero is horizontal scrolling. */
  readonly horizontalOverflow: number;
  /** #939: the hero band, or `undefined` when none was drawn. */
  readonly hero: Box | undefined;
  /** The hero's ground — its hills and road — or `undefined`. */
  readonly ground: Box | undefined;
  /**
   * Every line of the `h1`'s and the summary's TEXT — their line boxes, not
   * their padded boxes — so "the words stand on the sky" is a measurement.
   */
  readonly titleText: readonly Box[];
  /** The fold, in CSS px from the top of the viewport. */
  readonly fold: number;
  /** The ride cards, in document order. */
  readonly rideCards: readonly RideCardMeasurement[];
}

export interface RideCardMeasurement {
  readonly card: Box;
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

function measure(): HomeMeasurement {
  const main = document.querySelector('main');
  const hero = document.querySelector('.oyl-home-hero');
  const ground = document.querySelector('.oyl-home-hero__ground');
  return {
    viewport: { width: window.innerWidth, height: window.innerHeight },
    main: main === null ? undefined : boxOf(main),
    mainClass: main?.className ?? '',
    cards: [...document.querySelectorAll('.oyl-home > .oyl-panel')].map(boxOf),
    horizontalOverflow: document.documentElement.scrollWidth - window.innerWidth,
    hero: hero === null ? undefined : boxOf(hero),
    ground: ground === null ? undefined : boxOf(ground),
    titleText: [...document.querySelectorAll('main > h1, main > h1 + p')].flatMap((element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      return [...range.getClientRects()].map((rect) =>
        boxOf({ getBoundingClientRect: () => rect }),
      );
    }),
    fold: foldLine(),
    rideCards: ((cards) => {
      window.scrollTo(0, 0);
      return cards;
    })([...document.querySelectorAll('.oyl-home__rides > li')].map(measureCard)),
  };
}

function measureCard(card: Element): RideCardMeasurement {
  const link = card.querySelector<HTMLAnchorElement>('a');
  if (link === null) {
    throw new Error('home harness: a ride card holds no link');
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
  // The middle is hit-tested where it is on screen: `elementFromPoint` finds
  // nothing outside the viewport, so a card below the fold is scrolled to
  // first, and the page put back at its top afterwards (`measure`).
  card.scrollIntoView({ block: 'center' });
  const seen = card.getBoundingClientRect();
  const hit = document.elementFromPoint(seen.left + seen.width / 2, seen.top + seen.height / 2);
  const hitLink = hit?.closest('a') ?? null;
  return {
    card: box,
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

/** `?short=off`: delete Home's short-viewport rule, and fail if there is none. */
function deleteShortViewportRule(): void {
  let deleted = 0;
  for (const sheet of document.styleSheets) {
    const rules = sheet.cssRules;
    for (let index = rules.length - 1; index >= 0; index -= 1) {
      const rule = rules[index];
      if (
        rule instanceof CSSMediaRule &&
        // The build writes `(max-height: 30rem)` in range syntax.
        ['(max-height: 30rem)', '(height <= 30rem)'].includes(rule.conditionText) &&
        rule.cssText.includes('.oyl-home-hero')
      ) {
        sheet.deleteRule(index);
        deleted += 1;
      }
    }
  }
  if (deleted !== 1) {
    throw new Error(
      `home harness: expected one short-viewport Home rule, deleted ${String(deleted)}`,
    );
  }
}

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
  if (new URLSearchParams(window.location.search).get('hero') === 'tall') {
    // #939's control: the band at 60 vh, a screen rather than a band.
    const tall = document.createElement('style');
    tall.textContent = '.oyl-home-hero { min-height: 60vh; }';
    document.head.append(tall);
  }
  if (new URLSearchParams(window.location.search).get('short') === 'off') {
    deleteShortViewportRule();
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
  await document.fonts.ready;
  window.__oylHome = { ready: true, errors, measure, constrain };
}

run().catch((error: unknown) => {
  errors.push(error instanceof Error ? error.message : String(error));
  window.__oylHome = { ready: false, errors, measure, constrain };
});
