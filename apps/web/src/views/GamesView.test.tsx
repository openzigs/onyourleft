// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The Games tab — #2292: its page of cards, and each game's course picker,
 * reached the way a rider reaches them, through the real shell from the tab,
 * and read back off the page. The week a card shows is written where a game
 * ride keeps it (`delivery/delivery-progress.ts` §`writeDeliveryProgress`)
 * and read back through the card, not handed to it.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { watts } from '@onyourleft/domain';

import { COURSE_TEXT } from '../game/courses';
import { writeDeliveryProgress } from '../game/delivery/delivery-progress';
import type { GamePort, RidableRoute } from '../game/GameView';
import { circuitRoute, northRoute } from '../game/route-fixtures-testing';
import { writeRealisticWorldChoice } from '../game/world-preference';
import { AppShell } from '../shell/AppShell';
import { gamePlayFromHash, gameRouteFromHash } from '../shell/routes';
import type { CapabilityProbe } from '../support/bluetooth-support';
import { activateWithKeyboard, mount, settle, type Mounted } from '../testing/mount';

import { GAME_COURSES_TEXT } from './GameCoursesView';
import { deliveryWeekProgressText, GAMES_TEXT, lapRaceLoopsText } from './GamesView';

const NO_BLUETOOTH: CapabilityProbe = { bluetooth: undefined, secureContext: true };

const LOOP_A: RidableRoute = {
  id: 'loop-a',
  name: 'Park loop',
  profile: circuitRoute(60),
  attempts: 0,
};
const LOOP_B: RidableRoute = {
  id: 'loop-b',
  name: 'Lake loop',
  profile: circuitRoute(90),
  attempts: 2,
};
const OUT: RidableRoute = {
  id: 'out',
  name: 'Out to the coast',
  profile: northRoute(2_000, () => 0),
  attempts: 0,
};

function portOf(routes: readonly RidableRoute[]): GamePort {
  return {
    listRoutes: () => Promise.resolve(routes),
    loadGhost: () => Promise.resolve(undefined),
    readSensors: () => ({
      rider: { power: watts(0), live: false, paired: false },
      cadence: { value: undefined, live: false, paired: false },
      heartRate: { value: undefined, live: false, paired: false },
    }),
  };
}

let mounted: Mounted | undefined;

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  localStorage.clear();
  globalThis.location.hash = '';
});

async function open(path: string, routes: readonly RidableRoute[]): Promise<void> {
  globalThis.location.hash = `#${path}`;
  mounted = await mount(<AppShell capabilities={NO_BLUETOOTH} game={portOf(routes)} />);
  await settle();
}

function link(name: string): HTMLAnchorElement | undefined {
  return [...document.querySelectorAll<HTMLAnchorElement>('a')].find(
    (each) => (each.textContent ?? '').replace(/\s+/g, ' ').trim() === name,
  );
}

function card(heading: string): Element | undefined {
  return [...document.querySelectorAll('.oyl-games__card')].find(
    (each) => each.querySelector('h2')?.textContent === heading,
  );
}

describe('the Games tab — #2292', () => {
  it('is a destination of its own, opening a page with a card for each game', async () => {
    await open('/', [LOOP_A]);
    const tab = link('Games');
    expect(tab, 'no Games tab').toBeDefined();
    await activateWithKeyboard(tab as HTMLAnchorElement);
    expect(document.querySelector('h1')?.textContent).toBe('Games');
    expect(tab?.getAttribute('aria-current')).toBe('page');
    expect(
      [...document.querySelectorAll('.oyl-games__card h2')].map((each) => each.textContent),
    ).toEqual([GAMES_TEXT.delivery, GAMES_TEXT.lapRace]);
  });

  it('shows the Delivery week this device kept, read back from where a ride keeps it', async () => {
    writeDeliveryProgress(localStorage, { day: 3, houses: 9, score: 14 });
    await open('/games', []);
    expect(card(GAMES_TEXT.delivery)?.textContent).toContain(
      'Day 3 of 7 · 14 parcels delivered this week',
    );
  });

  it('shows a fresh week when this device kept none — the control', async () => {
    await open('/games', []);
    expect(card(GAMES_TEXT.delivery)?.textContent).toContain('Day 1 of 7 · nothing delivered yet');
  });

  it('counts the loops the lap race can be ridden on, and no other route', async () => {
    await open('/games', [LOOP_A, OUT, LOOP_B]);
    expect(card(GAMES_TEXT.lapRace)?.textContent).toContain('2 loops to race on');
  });

  it('leads each card’s Play to that game’s course picker, the game named in it', async () => {
    await open('/games', [LOOP_A]);
    await activateWithKeyboard(link('Play Lap race') as HTMLAnchorElement);
    expect(document.querySelector('h1')?.textContent).toBe('Lap race: choose a course');
    // Still under the Games tab, a page of it rather than the tab's own page.
    expect(link('Games')?.getAttribute('aria-current')).toBe('true');
    globalThis.location.hash = '#/games';
    await settle();
    await activateWithKeyboard(link('Play Delivery') as HTMLAnchorElement);
    expect(document.querySelector('h1')?.textContent).toBe('Delivery: choose a course');
  });
});

describe('a game’s course picker — #2292', () => {
  it('offers each loop for the lap race, leading to the setup with the race on', async () => {
    await open('/games/lap-race', [OUT, LOOP_A]);
    const choose = link(`${GAME_COURSES_TEXT.choose}: ${LOOP_A.name}`);
    expect(choose, 'the loop is not offered').toBeDefined();
    const href = choose?.getAttribute('href') ?? '';
    expect(gameRouteFromHash(href)).toBe(LOOP_A.id);
    expect(gamePlayFromHash(href)).toBe('lap-race');
    await activateWithKeyboard(choose as HTMLAnchorElement);
    expect(document.querySelector('h1')?.textContent).toBe('Trainer game');
  });

  it('draws a route that is not a loop with the reason, and nothing to choose it by', async () => {
    await open('/games/lap-race', [OUT, LOOP_A]);
    const entries = [...document.querySelectorAll('.oyl-game-courses__course')];
    // The loop that can be raced first, the one that cannot after it.
    expect(entries.map((each) => each.querySelector('h3')?.textContent)).toEqual([
      LOOP_A.name,
      OUT.name,
    ]);
    const out = entries[1];
    expect(out?.textContent).toContain(COURSE_TEXT.notALoop);
    expect(out?.querySelector('a')).toBeNull();
    expect(entries[0]?.textContent).not.toContain(COURSE_TEXT.notALoop);
  });

  it('says a Delivery round needs the realistic world, and offers no course, where it is not chosen', async () => {
    await open('/games/delivery', [OUT]);
    expect(document.querySelector('main')?.textContent).toContain(
      GAME_COURSES_TEXT.deliveryNeedsWorld,
    );
    expect(link(GAME_COURSES_TEXT.changeWorld)?.getAttribute('href')).toBe('#/settings');
    expect(document.querySelector('.oyl-game-courses__course')).toBeNull();
  });

  it('offers every saved route for Delivery with the realistic world chosen, leading to the setup with the round on', async () => {
    writeRealisticWorldChoice(localStorage, true);
    await open('/games/delivery', [OUT, LOOP_A]);
    expect(document.querySelector('main')?.textContent).not.toContain(
      GAME_COURSES_TEXT.deliveryNeedsWorld,
    );
    const href = link(`${GAME_COURSES_TEXT.choose}: ${OUT.name}`)?.getAttribute('href') ?? '';
    expect(gameRouteFromHash(href)).toBe(OUT.id);
    expect(gamePlayFromHash(href)).toBe('delivery');
    expect(link(`${GAME_COURSES_TEXT.choose}: ${LOOP_A.name}`)).toBeDefined();
  });

  it('says how a route gets here when the rider has none', async () => {
    await open('/games/lap-race', []);
    expect(document.querySelector('[data-oyl-empty-state]')?.textContent).toContain(
      GAME_COURSES_TEXT.noRoutes,
    );
    expect(link(GAME_COURSES_TEXT.importRoute)?.getAttribute('href')).toBe('#/routes');
  });
});

describe('the cards’ words', () => {
  it('counts parcels and loops in the singular and the plural', () => {
    expect(deliveryWeekProgressText({ day: 2, score: 1 })).toBe(
      'Day 2 of 7 · 1 parcel delivered this week',
    );
    expect(lapRaceLoopsText(1)).toBe('1 loop to race on');
    expect(lapRaceLoopsText(0)).toBe('No loops to race on yet');
  });
});
