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
import type { CapabilityProbe } from '../src/support/bluetooth-support';

// The shipping stylesheet, which is the whole point.
import '../src/design/theme.css';

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

function boxOf(element: Element): Box {
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
  return {
    viewport: { width: window.innerWidth, height: window.innerHeight },
    main: main === null ? undefined : boxOf(main),
    mainClass: main?.className ?? '',
    cards: [...document.querySelectorAll('.oyl-home > .oyl-panel')].map(boxOf),
    horizontalOverflow: document.documentElement.scrollWidth - window.innerWidth,
  };
}

function constrain(): void {
  const main = document.querySelector('main');
  if (main === null || !main.classList.contains('oyl-main--dashboard')) {
    throw new Error('home harness: main does not carry the class the control removes');
  }
  main.classList.replace('oyl-main--dashboard', 'oyl-main--prose');
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
