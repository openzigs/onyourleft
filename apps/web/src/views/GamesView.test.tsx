// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The Games tab — #2292: its page of cards, and each game's course picker,
 * reached the way a rider reaches them, through the real shell from the tab,
 * and read back off the page. The week a card shows is written where a game
 * ride keeps it (`delivery/delivery-progress.ts` §`writeDeliveryProgress`)
 * and read back through the card, not handed to it.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { watts } from '@onyourleft/domain';

import { COURSE_TEXT } from '../game/courses';
import { writeDeliveryProgress } from '../game/delivery/delivery-progress';
import { deliveryTown } from '../game/delivery/delivery-town-testing';
import type { GamePort, RidableRoute } from '../game/GameView';
import { circuitRoute, northRoute } from '../game/route-fixtures-testing';
import { DELIVERY_COURSE_TEXT } from '../game/StageChooser';
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

  it('shows the rider’s best time round a loop, the fastest over every loop and no other route', async () => {
    const fast = { ...LOOP_B, bestSeconds: 754 };
    const slow = { ...LOOP_A, bestSeconds: 900 };
    // A route that is not a loop is no lap race, however fast the rider was on it.
    const out = { ...OUT, bestSeconds: 60 };
    await open('/games', [slow, out, fast]);
    expect(card(GAMES_TEXT.lapRace)?.textContent).toContain('2 loops to race on · your best 12:34');
  });

  it('says nothing of a best before the rider has ridden a loop — the control', async () => {
    await open('/games', [LOOP_A]);
    expect(card(GAMES_TEXT.lapRace)?.textContent).toContain('1 loop to race on');
    expect(card(GAMES_TEXT.lapRace)?.textContent).not.toContain('best');
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

describe('the navigation through a game — the owner’s ruling of 2026-11-06', () => {
  function primary(name: string): HTMLAnchorElement | undefined {
    return [...document.querySelectorAll<HTMLAnchorElement>('nav[aria-label="Primary"] a')].find(
      (each) => (each.textContent ?? '').trim() === name,
    );
  }

  it('keeps Games current from the tab through the course picker to the setup it opens', async () => {
    await open('/', [LOOP_A]);
    await activateWithKeyboard(primary('Games') as HTMLAnchorElement);
    expect(primary('Games')?.getAttribute('aria-current')).toBe('page');
    await activateWithKeyboard(link('Play Lap race') as HTMLAnchorElement);
    expect(primary('Games')?.getAttribute('aria-current')).toBe('true');
    await activateWithKeyboard(
      link(`${GAME_COURSES_TEXT.choose}: ${LOOP_A.name}`) as HTMLAnchorElement,
    );
    // The setup, which lives in the Ride group, opened from Games.
    expect(document.querySelector('h1')?.textContent).toBe('Trainer game');
    expect(primary('Games')?.getAttribute('aria-current')).toBe('true');
    expect(primary('Ride')?.hasAttribute('aria-current')).toBe(false);
    // Games is a group of one page, so the setup draws no row of Ride's pages.
    expect(document.querySelector('nav[aria-label="Ride pages"]')).toBeNull();
    expect(document.querySelectorAll('a[aria-current]')).toHaveLength(1);
  });

  it('leaves an ordinary ride’s setup under Ride — the control', async () => {
    await open(`/game?route=${LOOP_A.id}`, [LOOP_A]);
    expect(document.querySelector('h1')?.textContent).toBe('Trainer game');
    expect(primary('Ride')?.getAttribute('aria-current')).toBe('true');
    expect(primary('Games')?.hasAttribute('aria-current')).toBe(false);
    expect(document.querySelector('nav[aria-label="Ride pages"]')).not.toBeNull();
  });
});

describe('the way back from a course picker — the owner’s ruling of 2026-11-06', () => {
  it('offers Back to Games on both pickers, in every state, and it goes there', async () => {
    // The lap race's list, Delivery's realistic-world notice, and the empty state.
    for (const [path, routes] of [
      ['/games/lap-race', [LOOP_A]],
      ['/games/delivery', [OUT]],
      ['/games/lap-race', []],
    ] as const) {
      await open(path, routes);
      const back = link(GAME_COURSES_TEXT.back);
      expect(back?.getAttribute('href'), path).toBe('#/games');
      mounted?.unmount();
      mounted = undefined;
    }
    await open('/games/delivery', [OUT]);
    await activateWithKeyboard(link(GAME_COURSES_TEXT.back) as HTMLAnchorElement);
    expect(document.querySelector('h1')?.textContent).toBe('Games');
  });
});

describe('a lap race with no loop to race on — the owner’s ruling of 2026-11-06', () => {
  it('says none of the rider’s routes is a loop, with the way to Routes, above the greyed cards', async () => {
    await open('/games/lap-race', [OUT]);
    const none = document.querySelector('.oyl-game-courses__none');
    expect(none?.textContent).toContain(GAME_COURSES_TEXT.noLoops);
    expect(none?.querySelector('a')?.getAttribute('href')).toBe('#/routes');
    expect(none?.querySelector('a')?.textContent).toBe(GAME_COURSES_TEXT.openRoutes);
    const course = document.querySelector('.oyl-game-courses__course');
    expect(course?.textContent).toContain(COURSE_TEXT.notALoop);
    // Above them: the line comes before the first card in the document.
    expect(
      none !== null &&
        course !== null &&
        (none.compareDocumentPosition(course) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
    ).toBe(true);
  });

  it('says nothing of it when one route is a loop — the control', async () => {
    await open('/games/lap-race', [OUT, LOOP_A]);
    expect(document.querySelector('.oyl-game-courses__none')).toBeNull();
    expect(document.querySelector('main')?.textContent).not.toContain(GAME_COURSES_TEXT.noLoops);
  });
});

describe('Delivery’s courses, counted — #2294 through the picker', () => {
  // Two towns the count is proved on (`delivery/courses.test.ts`): a whole
  // street of houses, and one ended after two.
  const FULL = deliveryTown('full-town');
  const SHORT = deliveryTown('short-town', { lastAlong: 220 });
  const TOWNS: readonly RidableRoute[] = [
    { id: 'short-town', name: 'Short street', profile: SHORT.profile, attempts: 0 },
    { id: 'full-town', name: 'High street', profile: FULL.profile, attempts: 0 },
  ];

  async function openCounted(): Promise<void> {
    writeRealisticWorldChoice(localStorage, true);
    writeDeliveryProgress(localStorage, { day: 2, houses: 5, score: 3 });
    const corridors = new Map([
      ['full-town', FULL.corridor],
      ['short-town', SHORT.corridor],
    ]);
    const port: GamePort = {
      ...portOf(TOWNS),
      loadWorldCorridor: (route) => {
        const corridor = corridors.get(route.id);
        return Promise.resolve(
          corridor === undefined
            ? { kind: 'unavailable', why: 'outside-coverage' }
            : { kind: 'ready', corridor },
        );
      },
    };
    globalThis.location.hash = '#/games/delivery';
    mounted = await mount(<AppShell capabilities={NO_BLUETOOTH} game={port} />);
    await settle();
  }

  function entry(name: string): Element | undefined {
    return [...document.querySelectorAll('.oyl-game-courses__course')].find(
      (each) => each.querySelector('h3')?.textContent === name,
    );
  }

  it('says up to how many houses a route holds, and greys one that holds no round with why', async () => {
    await openCounted();
    await vi.waitFor(() => {
      expect(entry('High street')?.textContent).toContain('Delivery: up to 5 houses on the round');
    });
    await vi.waitFor(() => {
      expect(entry('Short street')?.textContent).toContain(
        `${DELIVERY_COURSE_TEXT.noRound}: 2 mapped houses in reach, and a round needs 3`,
      );
    });
    // The order given: counts arrive one at a time, and no card moves.
    expect(
      [...document.querySelectorAll('.oyl-game-courses__course h3')].map((h) => h.textContent),
    ).toEqual(['Short street', 'High street']);
    expect(entry('Short street')?.querySelector('a')).toBeNull();
    const choose = link(`${GAME_COURSES_TEXT.choose}: High street`);
    expect(gamePlayFromHash(choose?.getAttribute('href') ?? '')).toBe('delivery');
  });

  it('counts nothing, and greys nothing, with no corridor port — the control', async () => {
    writeRealisticWorldChoice(localStorage, true);
    await open('/games/delivery', TOWNS);
    expect(document.querySelector('main')?.textContent).not.toContain('Delivery: up to');
    expect(document.querySelector('main')?.textContent).not.toContain(DELIVERY_COURSE_TEXT.noRound);
    expect(link(`${GAME_COURSES_TEXT.choose}: Short street`)).toBeDefined();
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
