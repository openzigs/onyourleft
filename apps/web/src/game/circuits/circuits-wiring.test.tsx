// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * #2293 through the real game: the built-in circuits are offered in the
 * chooser, a press on one starts a solo lap race against bots and nothing
 * else, the ride screen carries the OpenStreetMap credit in the stylised
 * world, a room's course list never holds one, and `main.tsx` supplies them
 * (ADR 0064 D-5.1, D-5.3, D-8).
 *
 * ⚠️ **A synthetic fixture circuit, never a shipped one** (ADR 0064 D-6.4): a
 * frame drawn of a real circuit is a Produced Work of its file. The fixture is
 * `route-fixtures-testing.ts` §`circuitRoute`, keyed in the `circuit:`
 * namespace as `circuits.ts` keys a shipped one.
 *
 * The real `GameView`, chooser, simulation and race; the only doubles are the
 * port's two lists, the GL context and the animation frame. No port here has
 * an instance member: a circuit needs none (D-8.3).
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { kilograms, watts } from '@onyourleft/domain';
import { circuitRouteId } from '@onyourleft/store';

import { OSM_ATTRIBUTION } from '../../map/basemap';
import type { RoomsPort } from '../../net/rooms-port';
import { mount, queryAll, settle, type Mounted } from '../../testing/mount';
import { stripComments } from '../../units/no-inline-units';
import { GameView, type GamePort, type RidableRoute } from '../GameView';
import { DEFAULT_LAP_RACE_CHOICE } from '../lap-race/choice';
import type { GameRenderer } from '../port';
import { circuitRoute, northRoute } from '../route-fixtures-testing';
import type { SceneInput } from '../scene';
import { BUILT_IN_CIRCUITS_TEXT, LAP_RACE_CHOICE_TEXT } from '../StageChooser';
import { REALISTIC_WORLD_STORAGE_KEY, writeRealisticWorldChoice } from '../world-preference';

const inputs: SceneInput[] = [];

vi.mock('../scene', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../scene')>();
  return {
    ...actual,
    sceneFrame: (input: SceneInput) => {
      inputs.push(input);
      return actual.sceneFrame(input);
    },
  };
});

const FRAME_MS = 250;

let pending: FrameRequestCallback[] = [];
let nowMs = 0;
let mounted: Mounted | undefined;

beforeEach(() => {
  inputs.length = 0;
  pending = [];
  nowMs = 0;
  localStorage.removeItem(REALISTIC_WORLD_STORAGE_KEY);
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
});

/** The rider's own route: a straight road, not a loop. */
const OWN: RidableRoute = {
  id: 'own-route',
  name: 'My own road',
  profile: northRoute(1_500, () => 10),
  attempts: 2,
};

/** The ghost's switch, as the loadout labels it for a route with attempts. */
const OWN_GHOST = 'Race your own best attempt';

/** The chooser's *Preview without a trainer*, which rides a route with no race. */
const PREVIEW = 'Preview without a trainer';

/** The synthetic fixture circuit (D-6.4): a loop of about 250 m. */
const FIXTURE: RidableRoute = {
  id: circuitRouteId('fixture'),
  name: 'Fixture Circuit',
  profile: circuitRoute(40, (along) => 2 * Math.sin(along / 40)),
  attempts: 0,
};

function renderer(): GameRenderer {
  return {
    loadRealisticWorld: () => Promise.resolve({ loaded: true }),
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

function port(
  routes: readonly RidableRoute[],
  circuits: readonly RidableRoute[] | undefined,
): GamePort {
  return {
    listRoutes: () => Promise.resolve(routes),
    ...(circuits === undefined ? {} : { listCircuits: () => Promise.resolve(circuits) }),
    loadGhost: () => Promise.resolve(undefined),
    readSensors: () => ({
      rider: { power: watts(250), live: true, paired: true },
      cadence: { value: 90, live: true, paired: true },
      heartRate: { value: 140, live: true, paired: true },
    }),
  };
}

async function pump(count: number): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    const next = pending.shift();
    if (next === undefined) return;
    nowMs += FRAME_MS;
    await act(async () => {
      next(nowMs);
      await Promise.resolve();
    });
  }
}

const text = (): string => mounted?.container.textContent ?? '';
const stageText = (): string =>
  mounted?.container.querySelector('.oyl-game--riding')?.textContent ?? '';

async function until(condition: () => boolean, tries = 200): Promise<void> {
  for (let i = 0; i < tries && !condition(); i++) await settle();
  expect(condition()).toBe(true);
}

async function open(
  gamePort: GamePort,
  extra: { readonly rooms?: RoomsPort; readonly roomId?: string; readonly delivery?: boolean } = {},
): Promise<void> {
  mounted = await mount(
    <GameView
      port={gamePort}
      renderer={() => Promise.resolve(renderer())}
      now={() => nowMs}
      riderMass={kilograms(72)}
      {...extra}
    />,
  );
  await until(() => !text().includes('Loading your routes'));
}

async function choose(route: RidableRoute): Promise<void> {
  const radio = queryAll<HTMLInputElement>(mounted?.container ?? document.body, 'input').find(
    (input) => input.type === 'radio' && input.value === route.id,
  );
  expect(radio, `a card for ${route.name}`).toBeDefined();
  await act(async () => {
    radio?.click();
    await Promise.resolve();
  });
  await settle();
}

async function pressRide(): Promise<void> {
  const ride = queryAll<HTMLButtonElement>(mounted?.container ?? document.body, 'button').find(
    (button) => (button.textContent ?? '').startsWith('Ride '),
  );
  expect(ride).toBeDefined();
  await act(async () => {
    ride?.click();
    await Promise.resolve();
  });
  await settle();
}

describe('the built-in circuits in the chooser — #2293', () => {
  it('are offered after the rider’s own routes, under their heading, with the credit and the way to the licence', async () => {
    await open(port([OWN], [FIXTURE]));
    const section = mounted?.container.querySelector('.oyl-chooser__circuits');
    expect(section?.querySelector('h3')?.textContent).toBe(BUILT_IN_CIRCUITS_TEXT.heading);
    expect(section?.textContent).toContain(FIXTURE.name);
    const credit = section?.querySelector('[data-credit="circuits"]');
    expect(credit?.textContent).toContain(OSM_ATTRIBUTION);
    expect(credit?.querySelector('a')?.getAttribute('href')).toBe('#/about/credits');
    // One radio group: the rider's route and the circuit are one choice.
    const radios = queryAll<HTMLInputElement>(mounted?.container ?? document.body, 'input').filter(
      (input) => input.type === 'radio' && input.closest('.oyl-chooser__routes') !== null,
    );
    expect(radios.map((radio) => radio.value)).toStrictEqual([OWN.id, FIXTURE.id]);
    expect(new Set(radios.map((radio) => radio.name)).size).toBe(1);
    // The rider's own route is still the one chosen first.
    expect(radios[0]?.checked).toBe(true);
  });

  it('chosen, the loadout is the race’s alone: no switch, no ghost, no pacer, no preview', async () => {
    await open(port([OWN], [FIXTURE]));
    // The rider's own road is not a loop: no race on it, and a pacer and a ghost are offered.
    expect(text()).toContain(LAP_RACE_CHOICE_TEXT.notALoop);
    expect(mounted?.container.querySelector('.oyl-game__pacer')).not.toBeNull();
    expect(text()).toContain(OWN_GHOST);
    expect(mounted?.container.querySelector('.oyl-game__ghost')).not.toBeNull();
    expect(text()).toContain(PREVIEW);
    await choose(FIXTURE);
    expect(text()).toContain(LAP_RACE_CHOICE_TEXT.onCircuit);
    expect(text()).not.toContain(LAP_RACE_CHOICE_TEXT.label);
    expect(text()).not.toContain(LAP_RACE_CHOICE_TEXT.notALoop);
    expect(mounted?.container.querySelector('.oyl-game__pacer')).toBeNull();
    expect(text()).not.toContain(OWN_GHOST);
    expect(mounted?.container.querySelector('.oyl-game__ghost')).toBeNull();
    expect(text()).not.toContain(PREVIEW);
    // The race's own choices are shown without a switch being turned on.
    expect(text()).toContain(LAP_RACE_CHOICE_TEXT.laps);
    expect(text()).toContain(`Ride ${FIXTURE.name}`);
  });

  it('chosen with the realistic world, offers no Delivery round: a circuit is raced and nothing else', async () => {
    writeRealisticWorldChoice(localStorage, true);
    await open(port([OWN], [FIXTURE]));
    expect(mounted?.container.querySelector('.oyl-game__delivery')).not.toBeNull();
    await choose(FIXTURE);
    expect(mounted?.container.querySelector('.oyl-game__delivery')).toBeNull();
    expect(text()).toContain(LAP_RACE_CHOICE_TEXT.onCircuit);
  });

  it('are offered to a rider with no routes of their own, who is told how to add one', async () => {
    await open(port([], [FIXTURE]));
    expect(text()).toContain(`Ride ${FIXTURE.name}`);
    expect(text()).toContain(BUILT_IN_CIRCUITS_TEXT.noRoutes);
  });

  it('are not offered at all with no circuits member on the port: today’s empty chooser', async () => {
    await open(port([], undefined));
    expect(text()).not.toContain(BUILT_IN_CIRCUITS_TEXT.heading);
    expect(text()).toContain('Choose a route');
    expect(
      queryAll<HTMLButtonElement>(mounted?.container ?? document.body, 'button').some((button) =>
        (button.textContent ?? '').startsWith('Ride '),
      ),
    ).toBe(false);
  });
});

describe('a ride on a built-in circuit — #2293, ADR 0064 D-5.3 and D-8', () => {
  it('is a lap race against bots, in the stylised world, with the OpenStreetMap credit for the whole ride', async () => {
    await open(port([OWN], [FIXTURE]));
    await choose(FIXTURE);
    await pressRide();
    await until(() => mounted?.container.querySelector('.oyl-game--riding') !== null);
    let missing = 0;
    for (let frame = 0; frame < 40; frame += 1) {
      await pump(1);
      if (!stageText().includes(OSM_ATTRIBUTION)) missing += 1;
    }
    expect(missing).toBe(0);
    // The race's field is on the road: the default choice's bots, every frame.
    const drawn = inputs.filter((input) => input.raceBots !== undefined);
    expect(drawn.length).toBeGreaterThan(30);
    expect(drawn.at(-1)?.raceBots).toHaveLength(DEFAULT_LAP_RACE_CHOICE.bots);
    // ...and the road is the circuit's, ridden from its line.
    expect(drawn.at(-1)?.state.ride.distance ?? 0).toBeGreaterThan(5);
  });

  it('the same game on the rider’s own route in the stylised world shows no credit and no race', async () => {
    await open(port([OWN], [FIXTURE]));
    await pressRide();
    await until(() => mounted?.container.querySelector('.oyl-game--riding') !== null);
    await pump(20);
    expect(stageText()).not.toBe('');
    expect(stageText()).not.toContain(OSM_ATTRIBUTION);
    expect(inputs.some((input) => input.raceBots !== undefined)).toBe(false);
  });

  it('is still the race when the shell asks every ride for a Delivery round', async () => {
    writeRealisticWorldChoice(localStorage, true);
    await open(port([OWN], [FIXTURE]), { delivery: true });
    await choose(FIXTURE);
    await pressRide();
    await until(() => mounted?.container.querySelector('.oyl-game--riding') !== null);
    await pump(10);
    const drawn = inputs.filter((input) => input.raceBots !== undefined);
    expect(drawn.at(-1)?.raceBots).toHaveLength(DEFAULT_LAP_RACE_CHOICE.bots);
  });

  it('is refused where it could not race — the shell’s room — rather than ridden as something else', async () => {
    await open(port([OWN], [FIXTURE]), { roomId: 'room-from-the-shell' });
    await choose(FIXTURE);
    await pressRide();
    await pump(5);
    expect(mounted?.container.querySelector('.oyl-game--riding')).toBeNull();
    expect(text()).toContain(`Ride ${FIXTURE.name}`);
  });
});

describe('a room’s course list never holds a circuit — ADR 0064 D-8.1', () => {
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

  it('offers the rider’s own routes to make a room on, and no circuit', async () => {
    await open(port([OWN], [FIXTURE]), { rooms: ROOMS });
    const make = mounted?.container.querySelector('.oyl-rooms__make');
    expect(make).not.toBeNull();
    const options = queryAll<HTMLOptionElement>(make ?? document.body, 'option').map(
      (option) => option.value,
    );
    expect(options).toStrictEqual([OWN.id]);
    expect(make?.textContent).not.toContain(FIXTURE.name);
  });

  it('with no routes of the rider’s own, still offers none, circuits or not', async () => {
    await open(port([], [FIXTURE]), { rooms: ROOMS });
    const make = mounted?.container.querySelector('.oyl-rooms__make');
    expect(make?.textContent).toContain('Save a route first');
    expect(queryAll(make ?? document.body, 'option')).toHaveLength(0);
  });
});

describe('main.tsx supplies the circuits to the game', () => {
  const SOURCE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const main = stripComments(readFileSync(join(SOURCE_ROOT, 'main.tsx'), 'utf8'));
  const gamePort = main.slice(
    main.indexOf('function buildGamePort('),
    main.indexOf('function buildGameTrainerPort('),
  );

  it('builds the game port with listCircuits over the shipped files', () => {
    expect(gamePort).toMatch(
      /listCircuits: async \(\): Promise<readonly RidableRoute\[\]> =>\s*\(await import\('\.\/game\/circuits\/circuits'\)\)\.loadBuiltInCircuits\(\)/,
    );
  });
});
