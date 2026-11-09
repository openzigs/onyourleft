// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * #2362 through the real app: the built-in Delivery levels are listed first
 * on the Delivery picker, a rider with **no saved route and no instance**
 * starts a round on level 1 from it, the round is said through the HUD's one
 * live region — its first house, and a parked car or bin ahead in words —
 * the ride screen carries the OpenStreetMap credit for the whole ride, the
 * week is untouched, a room's course list never holds a level, and `main.tsx`
 * supplies them (ADR 0065 D-2.5, D-6.5, D-8.1, D-9.3, D-10.9).
 *
 * ⚠️ **What is listed is the app's own catalogue; what is ridden is the
 * synthetic fixture level** (ADR 0065 D-7.5): a frame built from a shipped
 * level is a Produced Work of its file, so the port this test hands the
 * game answers level 1's id with `fixtures/fixture-level.json` under that
 * id. The listing reads no level file at all (D-2.5), and the test holds
 * that only the chosen level is read.
 *
 * The real `AppShell`, `GameCoursesView`, `GameView`, chooser, simulation,
 * round, obstacles, HUD and announcer; the doubles are the port's lists, the
 * GL context, the clock and the platform's random source. No port here has
 * an instance member, and no instance is configured: a level needs none.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { kilograms, watts } from '@onyourleft/domain';
import { levelRouteId } from '@onyourleft/store';

import { OSM_ATTRIBUTION } from '../../../map/basemap';
import type { RoomsPort } from '../../../net/rooms-port';
import { AppShell } from '../../../shell/AppShell';
import {
  gamePlayFromHash,
  gameRouteFromHash,
  hrefForGamePlay,
  LEVEL_GAME_SUMMARY,
  routeById,
} from '../../../shell/routes';
import type { CapabilityProbe } from '../../../support/bluetooth-support';
import { mount, queryAll, settle, type Mounted } from '../../../testing/mount';
import { stripComments } from '../../../units/no-inline-units';
import { GAME_COURSES_TEXT } from '../../../views/GameCoursesView';
import { endRideAnswer } from '../../end-ride-testing';
import { GameView, type GamePort, type RidableRoute } from '../../GameView';
import { DELIVERY_CHOICE_TEXT } from '../../StageChooser';
import { ANNOUNCEMENTS_STORAGE_KEY, DEFAULT_ANNOUNCEMENTS } from '../../hud/announce-preference';
import type { GameRenderer } from '../../port';
import { northRoute } from '../../route-fixtures-testing';
import { SHIPPED_LEVELS } from '../../shipped-levels';
import { readRealisticWorldChoice, writeRealisticWorldChoice } from '../../world-preference';
import { DELIVERY_PROGRESS_STORAGE_KEY, readDeliveryProgress } from '../delivery-progress';
import type { WeekProgress } from '../round';

import { LEVEL_CATALOGUE } from './catalogue';
import { parseLevelFile, type LevelFile } from './level-file';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_JSON = JSON.parse(
  readFileSync(join(HERE, 'fixtures', 'fixture-level.json'), 'utf8'),
) as Record<string, unknown>;

/** The fixture level, under `id` and its listed name: what this test's port answers for a chosen level. */
function fixtureAs(id: string): LevelFile {
  const name = LEVEL_CATALOGUE.find((level) => level.id === id)?.name ?? 'Fixture Lane';
  return parseLevelFile({ ...FIXTURE_JSON, id, name }, id);
}

const NO_BLUETOOTH: CapabilityProbe = { bluetooth: undefined, secureContext: true };
const FIRST = SHIPPED_LEVELS.list()[0];
if (FIRST === undefined) throw new Error('the app ships no level');

/** A week part-way through, so a change to it would show. */
const WEEK: WeekProgress = { day: 3, houses: 9, score: 7 };

/** Every level id the port was asked to read in full. */
const read: string[] = [];

function port(routes: readonly RidableRoute[] = []): GamePort {
  return {
    listRoutes: () => Promise.resolve(routes),
    listDeliveryLevels: () => Promise.resolve(SHIPPED_LEVELS.list()),
    loadDeliveryLevel: (id) => {
      read.push(id);
      return Promise.resolve(
        LEVEL_CATALOGUE.some((level) => level.id === id) ? fixtureAs(id) : undefined,
      );
    },
    loadGhost: () => Promise.resolve(undefined),
    readSensors: () => ({
      rider: { power: watts(260), live: true, paired: true },
      cadence: { value: 90, live: true, paired: true },
      heartRate: { value: 140, live: true, paired: true },
    }),
  };
}

/** How many times the ride asked for the realistic world's files. */
let realisticAsked = 0;

function renderer(): GameRenderer {
  return {
    loadRealisticWorld: () => {
      realisticAsked += 1;
      return Promise.resolve({ loaded: true });
    },
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
}

const FRAME_MS = 250;
let pending: FrameRequestCallback[] = [];
let nowMs = 0;
let mounted: Mounted | undefined;

beforeEach(() => {
  pending = [];
  nowMs = 0;
  realisticAsked = 0;
  read.length = 0;
  localStorage.clear();
  writeRealisticWorldChoice(localStorage, true);
  localStorage.setItem(
    ANNOUNCEMENTS_STORAGE_KEY,
    JSON.stringify({ ...DEFAULT_ANNOUNCEMENTS, enabled: true }),
  );
  localStorage.setItem(DELIVERY_PROGRESS_STORAGE_KEY, JSON.stringify(WEEK));
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    pending.push(callback);
    return pending.length;
  });
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
});

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
  globalThis.location.hash = '';
});

async function pump(): Promise<void> {
  const due = pending;
  pending = [];
  nowMs += FRAME_MS;
  await act(async () => {
    for (const callback of due) callback(nowMs);
    await Promise.resolve();
  });
}

async function until(condition: () => boolean, tries = 200): Promise<void> {
  for (let i = 0; i < tries && !condition(); i++) await settle();
  expect(condition()).toBe(true);
}

const text = (): string => mounted?.container.textContent ?? '';
const region = (): string =>
  document.querySelector('[data-oyl-announcer="hud"]')?.textContent ?? '';
const stageText = (): string =>
  mounted?.container.querySelector('.oyl-game--riding')?.textContent ?? '';

function link(name: string): HTMLAnchorElement | undefined {
  return [...document.querySelectorAll<HTMLAnchorElement>('a')].find(
    (each) => (each.textContent ?? '').replace(/\s+/g, ' ').trim() === name,
  );
}

async function click(element: HTMLElement | undefined): Promise<void> {
  expect(element).toBeDefined();
  await act(async () => {
    element?.click();
    await Promise.resolve();
  });
  await settle();
}

function rideButton(): HTMLButtonElement | undefined {
  return queryAll<HTMLButtonElement>(mounted?.container ?? document.body, 'button').find((button) =>
    (button.textContent ?? '').startsWith('Ride '),
  );
}

async function openPicker(routes: readonly RidableRoute[] = []): Promise<void> {
  globalThis.location.hash = '#/games/delivery';
  mounted = await mount(<AppShell capabilities={NO_BLUETOOTH} game={port(routes)} />);
  await until(() => document.querySelector('[data-level]') !== null);
}

/** The setup on `href`, as the picker's link opens it, with this test's renderer and clock. */
async function openSetup(
  href: string,
  extra: { readonly rooms?: RoomsPort; readonly roomId?: string } = {},
): Promise<void> {
  globalThis.location.hash = href;
  mounted = await mount(
    <GameView
      port={port()}
      renderer={() => Promise.resolve(renderer())}
      now={() => nowMs}
      riderMass={kilograms(72)}
      {...extra}
    />,
  );
  await until(() => !text().includes('Loading your routes'));
}

/** The round's seed, as `drawRoundSeed` will draw it. */
function stubSeed(seed: number): void {
  vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation(
    <T extends ArrayBufferView>(array: T): T => {
      (array as unknown as Uint32Array)[0] = seed;
      return array;
    },
  );
}

describe('the Delivery picker lists the built-in levels — #2362, ADR 0065 D-8.1', () => {
  it(
    'with no saved route and no instance, lists both levels, each chosen opens a round, and level 1’s says its first house',
    { timeout: 30_000 },
    async () => {
      await openPicker();
      // Both levels are listed, in unlock order, each with a way to choose it.
      const names = [...document.querySelectorAll('[data-level] h3')].map(
        (each) => each.textContent,
      );
      expect(names).toStrictEqual(SHIPPED_LEVELS.list().map((level) => level.name));
      expect(names).toHaveLength(2);
      for (const level of SHIPPED_LEVELS.list()) {
        const href = link(`${GAME_COURSES_TEXT.choose}: ${level.name}`)?.getAttribute('href') ?? '';
        expect(gameRouteFromHash(href)).toBe(levelRouteId(level.id));
        expect(gamePlayFromHash(href)).toBe('delivery');
      }
      // The credit beside them (D-6.5), and the rider is told how a route of their own gets here.
      expect(document.querySelector('[data-credit="levels"]')?.textContent).toContain(
        OSM_ATTRIBUTION,
      );
      // #2362, round 2: in words that are true beside the levels.
      const empty = document.querySelector('[data-oyl-empty-state]')?.textContent ?? '';
      expect(empty).toContain(GAME_COURSES_TEXT.noRoutesBesideLevels);
      expect(empty).not.toContain(GAME_COURSES_TEXT.noRoutes);
      // Listing read no level's file (D-2.5).
      expect(read).toStrictEqual([]);

      // Level 1, chosen: the setup its link opens, with the round on.
      const href = link(`${GAME_COURSES_TEXT.choose}: ${FIRST.name}`)?.getAttribute('href') ?? '';
      mounted?.unmount();
      stubSeed(7);
      await openSetup(href);
      // Only the chosen level's file was read, in full.
      expect(read).toStrictEqual([FIRST.id]);
      expect(rideButton()?.textContent).toContain(FIRST.name);
      await click(rideButton());
      await until(() => mounted?.container.querySelector('.oyl-game--riding') !== null);

      const heard = new Set<string>();
      let creditless = 0;
      for (let frame = 0; frame < 480; frame += 1) {
        await pump();
        heard.add(region());
        if (!stageText().includes(OSM_ATTRIBUTION)) creditless += 1;
        const all = [...heard];
        if (
          all.some((each) => /^(Delivered to|Missed) the 1st house/.test(each)) &&
          all.some((each) => / ahead, in the (left|middle|right) lane\.$/.test(each))
        ) {
          break;
        }
      }
      const said = [...heard];
      // Its first house, said through the one live region, on the level's round of
      // houses and not the week's.
      const houses = fixtureAs(FIRST.id).round.houses;
      expect(houses).not.toBe(WEEK.houses);
      expect(
        said.some((each) =>
          new RegExp(
            `^(Delivered to|Missed) the 1st house\\. ${String(houses - 1)} houses left\\.$`,
          ).test(each),
        ),
      ).toBe(true);
      // And a parked car or a bin standing ahead, said in words before the rider reaches it.
      expect(
        said.some((each) =>
          /^A (parked car|bin) ahead, in the (left|middle|right) lane\.$/.test(each),
        ),
      ).toBe(true);
      // The credit, for the whole of the ride (D-6.5).
      expect(creditless).toBe(0);

      // Ended and discarded: the week is as it was (D-9.3).
      await click(
        queryAll<HTMLButtonElement>(mounted?.container ?? document.body, 'button').find((button) =>
          (button.textContent ?? '').startsWith('End ride'),
        ),
      );
      await click(endRideAnswer(document, 'Discard ride'));
      expect(readDeliveryProgress(localStorage)).toEqual(WEEK);
    },
  );

  it('lists the levels above every one of three saved routes', async () => {
    const routes = ['First road', 'Second road', 'Third road'].map((name, index): RidableRoute => ({
      id: `saved-${String(index)}`,
      name,
      profile: northRoute(1_500 + 100 * index, () => 0),
      attempts: 0,
    }));
    await openPicker(routes);
    const levels = [...document.querySelectorAll('[data-level]')];
    const saved = [...document.querySelectorAll('.oyl-game-courses__course')].filter(
      (each) => !each.hasAttribute('data-level'),
    );
    expect(levels).toHaveLength(2);
    expect(saved.map((each) => each.querySelector('h3')?.textContent)).toStrictEqual(
      routes.map((route) => route.name),
    );
    for (const level of levels) {
      for (const route of saved) {
        expect(level.compareDocumentPosition(route) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
          Node.DOCUMENT_POSITION_FOLLOWING,
        );
      }
    }
  });

  it('says under the title what the chosen card is: a built-in round’s on the level, a saved route’s after picking one, and back (round 4)', async () => {
    const routes: readonly RidableRoute[] = [
      { id: 'saved-0', name: 'First road', profile: northRoute(1_500, () => 0), attempts: 0 },
    ];
    globalThis.location.hash = hrefForGamePlay('delivery', levelRouteId(FIRST.id));
    mounted = await mount(<AppShell capabilities={NO_BLUETOOTH} game={port(routes)} />);
    const subtitle = (): string | null | undefined =>
      document.querySelector('.oyl-view-head p')?.textContent;
    const radio = (id: string): HTMLInputElement | undefined =>
      queryAll<HTMLInputElement>(document, '.oyl-chooser__card input[type="radio"]').find(
        (each) => each.value === id,
      );
    await until(() => radio('saved-0') !== undefined);
    await until(() => subtitle() === LEVEL_GAME_SUMMARY);
    await click(radio('saved-0'));
    expect(subtitle()).toBe(routeById('game').summary);
    // The address still names the level: the line follows the card, not the address.
    expect(gameRouteFromHash(globalThis.location.hash)).toBe(levelRouteId(FIRST.id));
    await click(radio(levelRouteId(FIRST.id)));
    expect(subtitle()).toBe(LEVEL_GAME_SUMMARY);
  });

  it('says a saved route’s line under the title on the plain setup', async () => {
    globalThis.location.hash = '#/game';
    mounted = await mount(<AppShell capabilities={NO_BLUETOOTH} game={port()} />);
    await until(() => document.querySelector('.oyl-view-head p') !== null);
    expect(document.querySelector('.oyl-view-head p')?.textContent).toBe(routeById('game').summary);
  });

  it('lists no level on the lap race’s picker', async () => {
    globalThis.location.hash = '#/games/lap-race';
    mounted = await mount(<AppShell capabilities={NO_BLUETOOTH} game={port()} />);
    await settle();
    await settle();
    expect(document.querySelector('[data-level]')).toBeNull();
    expect(document.querySelector('[data-credit="levels"]')).toBeNull();
  });
});

describe('a press on a level is always a round — ADR 0065 D-8.1', () => {
  it('rides the level’s round with the chooser’s Delivery switch turned off', async () => {
    await openSetup(hrefForGamePlay('delivery', levelRouteId(FIRST.id)));
    const toggle = queryAll<HTMLInputElement>(document, 'input[role="switch"]').find((box) =>
      (box.closest('label')?.textContent ?? '').includes(DELIVERY_CHOICE_TEXT.label),
    );
    expect(toggle?.checked).toBe(true);
    await click(toggle);
    expect(toggle?.checked).toBe(false);
    await click(rideButton());
    await until(() => mounted?.container.querySelector('.oyl-game--riding') !== null);
    await pump();
    const houses = [...document.querySelectorAll('.oyl-hud__field--delivery')].find((each) =>
      (each.textContent ?? '').startsWith('Houses'),
    );
    // The level's round, every house still expecting: its own count, not the week's.
    expect(houses?.querySelector('.oyl-hud__value')?.firstChild?.textContent).toBe(
      String(fixtureAs(FIRST.id).round.houses),
    );
  });
});

describe('a level is refused where it is not a solo round — ADR 0065 D-8.1', () => {
  it('starts no ride from a level’s Ride button while the shell holds a room', async () => {
    await openSetup(hrefForGamePlay('delivery', levelRouteId(FIRST.id)), { roomId: 'room-1' });
    await click(rideButton());
    await pump();
    expect(mounted?.container.querySelector('.oyl-game--riding')).toBeNull();
  });
});

describe('a level rides in the realistic world whatever Settings chose — the owner’s ruling on PR #2378', () => {
  it('rides its round in the realistic world with the standard world chosen, and writes no choice', async () => {
    writeRealisticWorldChoice(localStorage, false);
    const stored = { ...localStorage };
    await openSetup(hrefForGamePlay('delivery', levelRouteId(FIRST.id)));
    await click(rideButton());
    await until(() => mounted?.container.querySelector('.oyl-game--riding') !== null);
    await pump();
    const houses = [...document.querySelectorAll('.oyl-hud__field--delivery')].find((each) =>
      (each.textContent ?? '').startsWith('Houses'),
    );
    // The level's round, every house still expecting.
    expect(houses?.querySelector('.oyl-hud__value')?.firstChild?.textContent).toBe(
      String(fixtureAs(FIRST.id).round.houses),
    );
    // Its world asked for, for this ride.
    expect(realisticAsked).toBe(1);
    // And the rider's choice left as it was: nothing on the device written but what was there.
    expect(readRealisticWorldChoice(localStorage)).toBe(false);
    expect({ ...localStorage }).toStrictEqual(stored);
  });

  for (const realistic of [false, true]) {
    it(`says on the level’s card in the setup what its round holds, ${realistic ? 'in the realistic world' : 'with the standard world chosen'} (review of PR #2378, round 3)`, async () => {
      writeRealisticWorldChoice(localStorage, realistic);
      globalThis.location.hash = hrefForGamePlay('delivery', levelRouteId(FIRST.id));
      mounted = await mount(
        <GameView
          port={port([
            { id: 'saved-0', name: 'First road', profile: northRoute(1_500, () => 0), attempts: 0 },
          ])}
          renderer={() => Promise.resolve(renderer())}
          now={() => nowMs}
          riderMass={kilograms(72)}
        />,
      );
      await until(() => !text().includes('Loading your routes'));
      const card = (id: string): Element | undefined =>
        [...document.querySelectorAll('.oyl-chooser__card')].find(
          (each) => each.querySelector('input')?.getAttribute('value') === id,
        );
      const houses = fixtureAs(FIRST.id).round.houses;
      expect(card(levelRouteId(FIRST.id))?.querySelector('.oyl-chooser__course')?.textContent).toBe(
        `Delivery: up to ${String(houses)} houses on the round`,
      );
      // A saved route says nothing in the standard world, where it offers no round.
      if (!realistic) {
        expect(card('saved-0')?.querySelector('.oyl-chooser__course')).toBeNull();
      }
    });
  }

  it('lists the levels on the Delivery picker with the standard world chosen, the routes’ notice under them', async () => {
    writeRealisticWorldChoice(localStorage, false);
    const routes: readonly RidableRoute[] = [
      { id: 'saved-0', name: 'First road', profile: northRoute(1_500, () => 0), attempts: 0 },
    ];
    await openPicker(routes);
    const levels = [...document.querySelectorAll('[data-level]')];
    expect(levels.map((each) => each.querySelector('h3')?.textContent)).toStrictEqual(
      SHIPPED_LEVELS.list().map((level) => level.name),
    );
    for (const level of SHIPPED_LEVELS.list()) {
      expect(link(`${GAME_COURSES_TEXT.choose}: ${level.name}`)).toBeDefined();
    }
    expect(document.querySelector('[data-credit="levels"]')?.textContent).toContain(
      OSM_ATTRIBUTION,
    );
    // The rider's own routes: the notice and the way to Settings, as before, and no route offered.
    expect(text()).toContain(GAME_COURSES_TEXT.deliveryNeedsWorld);
    expect(link(GAME_COURSES_TEXT.changeWorld)).toBeDefined();
    expect(text()).not.toContain('First road');
    expect(readRealisticWorldChoice(localStorage)).toBe(false);
  });

  it('asks for no realistic world on a saved route with the standard world chosen', async () => {
    writeRealisticWorldChoice(localStorage, false);
    globalThis.location.hash = '#/game';
    mounted = await mount(
      <GameView
        port={port([
          { id: 'saved-0', name: 'First road', profile: northRoute(1_500, () => 0), attempts: 0 },
        ])}
        renderer={() => Promise.resolve(renderer())}
        now={() => nowMs}
        riderMass={kilograms(72)}
      />,
    );
    await until(() => !text().includes('Loading your routes'));
    await click(rideButton());
    await until(() => mounted?.container.querySelector('.oyl-game--riding') !== null);
    await pump();
    expect(realisticAsked).toBe(0);
  });
});

describe('a ride on a level carries the OpenStreetMap credit in every world — ADR 0065 D-6.5', () => {
  it('shows it for the whole ride with the standard world chosen', async () => {
    writeRealisticWorldChoice(localStorage, false);
    await openSetup(hrefForGamePlay('delivery', levelRouteId(FIRST.id)));
    await click(rideButton());
    await until(() => mounted?.container.querySelector('.oyl-game--riding') !== null);
    let creditless = 0;
    for (let frame = 0; frame < 40; frame += 1) {
      await pump();
      if (!stageText().includes(OSM_ATTRIBUTION)) creditless += 1;
    }
    expect(stageText()).not.toBe('');
    expect(creditless).toBe(0);
  });
});

describe('a room’s course list never holds a level — ADR 0065 D-8.1', () => {
  const ROOMS: RoomsPort = {
    create: () => Promise.resolve({ kind: 'unreachable' }),
    join: () => Promise.resolve({ kind: 'refused', reason: 'no-such-room' }),
    listPublic: () => Promise.resolve({ kind: 'refused', reason: 'no-public-rooms' }),
    joinPublic: () => Promise.resolve({ kind: 'refused', reason: 'no-such-room' }),
    start: () => Promise.resolve({ kind: 'started' }),
    results: () => Promise.resolve({ kind: 'unreachable' }),
    blockRider: () => Promise.resolve({ kind: 'unreachable' }),
    noticePage: () => undefined,
  };

  it('offers no level to make a room on, with the level’s card in the chooser', async () => {
    await openSetup(hrefForGamePlay('delivery', levelRouteId(FIRST.id)), { rooms: ROOMS });
    expect(rideButton()?.textContent).toContain(FIRST.name);
    const make = mounted?.container.querySelector('.oyl-rooms__make');
    expect(make?.textContent).toContain('Save a route first');
    expect(queryAll(make ?? document.body, 'option')).toHaveLength(0);
  });
});

describe('main.tsx supplies the levels to the game', () => {
  const SOURCE_ROOT = join(HERE, '..', '..', '..');
  const main = stripComments(readFileSync(join(SOURCE_ROOT, 'main.tsx'), 'utf8'));
  const gamePort = main.slice(
    main.indexOf('function buildGamePort('),
    main.indexOf('function buildGameTrainerPort('),
  );

  it('builds the game port with the shipped levels’ list and their one-at-a-time load', () => {
    expect(gamePort).toMatch(
      /listDeliveryLevels: async \(\) => \(await import\('\.\/game\/shipped-levels'\)\)\.SHIPPED_LEVELS\.list\(\)/,
    );
    expect(gamePort).toMatch(
      /loadDeliveryLevel: async \(id: string\) =>\s*\(await import\('\.\/game\/shipped-levels'\)\)\.SHIPPED_LEVELS\.load\(id\)/,
    );
  });
});
