// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * #2546's countdown, as a rider who asked for less motion and a rider with a
 * screen reader meet it: a solo lap race's *Race* notice through the real
 * `GameView`, read off the rendered element.
 *
 * jsdom loads no stylesheet, so what the notice's own classes are given is
 * read from `theme.css` as a file, as `hud/ItemControl.a11y.test.tsx` reads
 * it: no rule naming any class on the notice or inside it declares an
 * animation or a transition, so under `prefers-reduced-motion: reduce` (and
 * without it) the digits change in place. And the notice is no live region:
 * the seconds are on the screen only, and the HUD's one region says the
 * countdown once (`lap-race-countdown-wiring.test.tsx`).
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { watts } from '@onyourleft/domain';

import { mount, queryAll, settle, type Mounted } from '../testing/mount';
import { LIVE_REGION_SELECTOR } from '../testing/said-once';

import { GameView, type GamePort, type RidableRoute } from './GameView';
import type { LapRaceChoice } from './lap-race/choice';
import type { GameRenderer } from './port';
import { RACE_TEXT } from './room-ride';
import { circuitRoute } from './route-fixtures-testing';

// A path rather than `new URL(…, import.meta.url)`: under jsdom that URL is not a `file:` one.
const themeCss = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'design', 'theme.css'),
  'utf8',
).replace(/\/\*[\s\S]*?\*\//g, '');

/** Every `property` declared in a rule whose selector names `.className`, with the selector. */
function motionDeclaredFor(className: string): string[] {
  const found: string[] = [];
  // Every regular-expression metacharacter escaped, backslash included.
  const escaped = className.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const named = new RegExp(`\\.${escaped}(?![\\w-])`);
  for (const rule of themeCss.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = (rule[1] ?? '').trim();
    const block = rule[2] ?? '';
    if (!named.test(selector)) continue;
    for (const declaration of block.matchAll(/(?:^|;)\s*((?:animation|transition)[\w-]*)\s*:/g)) {
      found.push(`${selector} { ${declaration[1] ?? ''} }`);
    }
  }
  return found;
}

const ROUTE: RidableRoute = {
  id: 'lap-race',
  name: 'Race loop',
  profile: circuitRoute(40),
  attempts: 0,
};
const RACE: LapRaceChoice = { laps: 2, bots: 3, tier: 'hard', itemsOn: false };

const PORT: GamePort = {
  listRoutes: () => Promise.resolve([ROUTE]),
  loadGhost: () => Promise.resolve(undefined),
  readSensors: () => ({
    rider: { power: watts(250), live: true, paired: true },
    cadence: { value: 88, live: true, paired: true },
    heartRate: { value: 142, live: true, paired: true },
  }),
};

const RENDERER: GameRenderer = {
  loadRealisticWorld: () =>
    Promise.resolve({ loaded: false, offline: false, detail: 'no realistic world here' }),
  create: () => ({
    hasContext: true,
    prepare: () => Promise.resolve(),
    render: () => undefined,
    setQuality: () => undefined,
    setRiderKit: () => undefined,
    setSeason: () => undefined,
    resize: () => undefined,
    destroy: () => undefined,
  }),
};

let nowMs = 1_000_000;
let pending: FrameRequestCallback[] = [];
let mounted: Mounted | undefined;

beforeEach(() => {
  nowMs = 1_000_000;
  pending = [];
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    pending.push(callback);
    return pending.length;
  });
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query === '(prefers-reduced-motion: reduce)',
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
  }));
});

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  vi.unstubAllGlobals();
});

async function pump(): Promise<void> {
  const due = pending;
  pending = [];
  nowMs += 500;
  await act(async () => {
    for (const callback of due) callback(nowMs);
    await Promise.resolve();
  });
}

describe('a solo lap race’s countdown, with less motion asked for — #2546', () => {
  it('changes its digits in place: no animation or transition on the notice or in it, and no live region', async () => {
    mounted = await mount(
      <GameView
        port={PORT}
        renderer={() => Promise.resolve(RENDERER)}
        now={() => nowMs}
        lapRace={RACE}
      />,
    );
    await settle();
    const ride = queryAll<HTMLButtonElement>(mounted.container, 'button').find((button) =>
      (button.textContent ?? '').startsWith('Ride '),
    );
    await act(async () => {
      ride?.click();
      await Promise.resolve();
    });
    await settle();
    const seen: string[] = [];
    for (let frame = 0; frame < 4; frame += 1) {
      await pump();
      const notice = mounted.container.querySelector<HTMLElement>('.oyl-hud__race');
      if (notice === null) throw new Error('no Race notice on the countdown');
      seen.push(notice.textContent ?? '');
      // The rendered element and everything in it: nothing set to move.
      const elements = [notice, ...notice.querySelectorAll<HTMLElement>('*')];
      for (const element of elements) {
        expect(element.style.animation).toBe('');
        expect(element.style.transition).toBe('');
        for (const className of element.classList) {
          expect(motionDeclaredFor(className), className).toEqual([]);
        }
      }
      // The seconds are on the screen, never in a live region.
      expect(notice.closest(LIVE_REGION_SELECTOR)).toBeNull();
      expect(notice.querySelector(LIVE_REGION_SELECTOR)).toBeNull();
    }
    // Non-vacuity: the notice counted, and the reading found the notice's classes.
    expect(seen[0]).toContain(RACE_TEXT.counting(10));
    expect(seen[3]).toContain(RACE_TEXT.counting(8));
    expect(motionDeclaredFor('oyl-button').length).toBeGreaterThan(0);
  });
});
