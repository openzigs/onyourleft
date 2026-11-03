// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * **A short loop drawn on the planner is a lap race's course** — #2102 phase
 * 1, its two criteria, against the real local store.
 *
 * 1. A loop built through the planner — three taps on its map, *Close the
 *    loop*, a target chosen — is saved, and read back on a connection that
 *    never saw the write it passes the lap race's loop test (start equals end
 *    within `LOOP_CLOSURE_METRES`, `routeProfile`'s `loop: true`), with the
 *    length the planner's readout said.
 * 2. That saved loop is a choosable course where a lap race is chosen: the
 *    game's route picker offers its lap race, and the room panel on the same
 *    screen makes a race room on it, whose request to the instance says it is
 *    a loop. The game reads routes as `main.tsx` §`listRoutes` does, from the
 *    store; the room port is `createRoomsPort` over a scripted instance, as
 *    `rooms-shell.test.tsx` builds it.
 *
 * Synthetic positions only: a triangle of about 1.9 km on no particular road.
 */

import {
  degreesLatitude,
  degreesLongitude,
  distanceBetween,
  geographicPosition,
  kilograms,
  LOOP_CLOSURE_METRES,
  routeProfile,
  watts,
  type GeographicPosition,
} from '@onyourleft/domain';
import type { RouteRecord } from '@onyourleft/store';
import {
  ATHLETE_A,
  createStoreHarness,
  seedAthletes,
  type StoreHarness,
} from '@onyourleft/store/testing';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { GamePort, RidableRoute } from '../game/GameView';
import type { GameRenderer } from '../game/port';
import { LAP_RACE_CHOICE_TEXT } from '../game/StageChooser';
import { INSTANCE_SESSION_STORAGE_KEY } from '../instance/instance-port';
import { INSTANCE_ACCOUNT_STORAGE_KEY } from '../instance/sign-in';
import { NO_CARD_DEVICE } from '../instance/testing';
import { OSM_ATTRIBUTION } from '../map/basemap';
import { stubMapPort } from '../map/testing';
import { createRoomPort } from '../net/room-port';
import { createRoomsPort } from '../net/rooms-port';
import { ROOMS_ORIGIN, ScriptedInstance } from '../rooms/rooms-testing';
import type { RoutePort } from '../routes/store-port';
import { AppShell } from '../shell/AppShell';
import type { CapabilityProbe } from '../support/bluetooth-support';
import {
  activateWithKeyboard,
  chooseOption,
  mount,
  queryAll,
  settle,
  submitForm,
  typeInto,
  type Mounted,
} from '../testing/mount';
import { RouteBuilderView, SAVED_LOOP_TEXT } from '../views/RouteBuilderView';
import { IS_A_LOOP_TEXT } from './loop';

const BASEMAP = { archiveUrl: 'https://tiles.example.org/b.pmtiles', attribution: OSM_ATTRIBUTION };

function at(latitude: number, longitude: number): GeographicPosition {
  return geographicPosition(degreesLatitude(latitude), degreesLongitude(longitude));
}

/** Three corners of a triangle about 1.9 km round. */
const CORNERS = [at(40, -105), at(40.006, -105), at(40.003, -104.994)];
const ROUND = CORNERS.reduce(
  (sum, corner, index) => sum + distanceBetween(corner, CORNERS[(index + 1) % CORNERS.length]!),
  0,
);

let harness: StoreHarness | undefined;
let mounted: Mounted | undefined;

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', () => 0);
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
});

afterEach(async () => {
  mounted?.unmount();
  mounted = undefined;
  await harness?.destroy();
  harness = undefined;
  globalThis.location.hash = '';
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function openSeeded(): Promise<StoreHarness> {
  const opened = createStoreHarness();
  await seedAthletes(opened);
  harness = opened;
  return opened;
}

/** The planner's port, every call of it a write to the real store. */
function realPort(open: StoreHarness): RoutePort {
  return {
    athleteId: ATHLETE_A,
    store: {
      listRoutes: (owner, limit) => open.write((store) => store.listRoutes(owner, limit)),
      getRoute: (owner, id) => open.write((store) => store.getRoute(owner, id)),
      putRoute: (record) => open.write((store) => store.putRoute(record)),
      deleteRoute: (owner, id) => open.write((store) => store.deleteRoute(owner, id)),
      listPrivacyZones: (owner) => open.write((store) => store.listPrivacyZones(owner)),
    },
  };
}

function text(): string {
  return mounted?.container.textContent ?? '';
}

function buttonNamed(name: string): HTMLButtonElement {
  if (mounted === undefined) throw new Error('nothing is mounted');
  const found = queryAll<HTMLButtonElement>(mounted.container, 'button').find(
    (button) => button.textContent?.trim() === name,
  );
  if (found === undefined) throw new Error(`no “${name}” button`);
  return found;
}

/**
 * Tap three corners on the planner's map, close the loop, choose `target`
 * kilometres, and save it as `name`. Returns what the readout said.
 */
async function drawLoopAndSave(
  open: StoreHarness,
  target: string,
  name: string,
): Promise<{ readonly readout: string; readonly page: string }> {
  const engine = stubMapPort();
  mounted = await mount(
    <main>
      <h1>Draw a route</h1>
      <RouteBuilderView
        storage={{ read: () => undefined, write: () => undefined, forget: () => undefined }}
        map={() => Promise.resolve(engine)}
        basemap={BASEMAP}
        routes={realPort(open)}
        now={() => 1_700_000_000}
      />
    </main>,
  );
  await settle();
  await settle();
  for (const corner of CORNERS) {
    await act(async () => {
      engine.created[0]?.handlers?.tap(corner);
      await Promise.resolve();
    });
    await settle();
  }
  expect(text()).not.toContain(IS_A_LOOP_TEXT);
  await activateWithKeyboard(buttonNamed('Close the loop'));
  await settle();
  expect(text()).toContain(IS_A_LOOP_TEXT);

  const select = queryAll<HTMLSelectElement>(mounted.container, 'select').find(
    (each) => each.labels?.[0]?.textContent === 'Target length',
  );
  if (select === undefined) throw new Error('no target length chooser');
  await chooseOption(select, target);
  const readout = [...mounted.container.querySelectorAll('p')]
    .map((paragraph) => paragraph.textContent ?? '')
    .find((line) => line.startsWith('Loop length '));
  if (readout === undefined) throw new Error('no loop length readout');
  const page = text();

  const input = mounted.container.querySelector<HTMLInputElement>('input[name="name"]');
  const form = mounted.container.querySelector<HTMLFormElement>(
    'form[aria-label="Save this route"]',
  );
  if (input === null || form === null) throw new Error('the planner offers no save');
  await typeInto(input, name);
  await submitForm(form);
  for (let turn = 0; turn < 5; turn += 1) await settle();
  expect(text()).toContain(SAVED_LOOP_TEXT);
  mounted.unmount();
  mounted = undefined;
  return { readout, page };
}

async function readBack(open: StoreHarness): Promise<RouteRecord> {
  const listed = await open.read((store) => store.listRoutes(ATHLETE_A));
  expect(listed).toHaveLength(1);
  return listed[0]!;
}

describe('a short loop drawn on the planner — #2102', () => {
  it('reads back as a loop that passes the lap race’s test, as long as the readout said', async () => {
    const open = await openSeeded();
    const { readout, page } = await drawLoopAndSave(open, '3', 'Short loop');
    // About 1.9 km against 3 km: more than 15 % short, and said so.
    expect(page).toContain('Under the target');
    expect(page).toMatch(/It is 1\.1 km under the target/);
    await open.discard();
    const route = await readBack(open);

    expect(route.profile.loop).toBe(true);
    const first = route.profile.positions[0]!;
    const last = route.profile.positions.at(-1)!;
    expect(distanceBetween(first, last)).toBeLessThanOrEqual(LOOP_CLOSURE_METRES);
    // The lap race's own test: the domain refuses `loop: true` on ends further apart.
    expect(() =>
      routeProfile(
        route.profile.positions.map((position, index) => ({
          position,
          elevation: route.profile.elevations[index],
        })),
        { loop: true },
      ),
    ).not.toThrow();

    expect(route.profile.totalDistance).toBeCloseTo(ROUND, 0);
    expect(readout).toBe(
      `Loop length ${(route.profile.totalDistance / 1000).toFixed(1)} km, against a target of 3 km.`,
    );
  });

  it('is a course a lap race is chosen on: the picker offers its race, and a room is made on it as a loop', async () => {
    const open = await openSeeded();
    await drawLoopAndSave(open, '2', 'Short loop');
    const saved = await readBack(open);

    localStorage.setItem(
      INSTANCE_ACCOUNT_STORAGE_KEY,
      JSON.stringify({ origin: ROOMS_ORIGIN, instanceAthleteId: 'ath-1' }),
    );
    localStorage.setItem(
      INSTANCE_SESSION_STORAGE_KEY,
      JSON.stringify({ origin: ROOMS_ORIGIN, token: 'session-token' }),
    );
    globalThis.location.hash = '#/game';
    const instance = new ScriptedInstance();
    // As `main.tsx` §`listRoutes`: the rider's routes, from the store.
    const game: GamePort = {
      listRoutes: async (): Promise<readonly RidableRoute[]> =>
        (await open.read((store) => store.listRoutes(ATHLETE_A))).map((route) => ({
          id: route.id,
          name: route.name,
          profile: route.profile,
          attempts: 0,
        })),
      loadGhost: () => Promise.resolve(undefined),
      readSensors: () => ({
        rider: { power: watts(200), live: true, paired: true },
        cadence: { value: 88, live: true, paired: true },
        heartRate: { value: 140, live: true, paired: true },
      }),
    };
    const renderer: GameRenderer = {
      loadRealisticWorld: () => Promise.reject(new Error('not chosen')),
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
    const noBluetooth: CapabilityProbe = { bluetooth: undefined, secureContext: true };
    mounted = await mount(
      <AppShell
        capabilities={noBluetooth}
        game={game}
        gameRenderer={() => Promise.resolve(renderer)}
        riderMass={kilograms(70)}
        rooms={createRoomsPort({
          ...NO_CARD_DEVICE,
          storage: localStorage,
          zones: () => Promise.resolve([]),
          send: instance.send,
        })}
        room={createRoomPort({
          ...NO_CARD_DEVICE,
          storage: localStorage,
          send: instance.send,
          openSocket: () => ({ send: () => undefined, close: () => undefined }),
        })}
      />,
    );
    for (let turn = 0; turn < 5; turn += 1) await settle();

    // The game's route picker: the loop is chosen, and its lap race offered.
    expect(text()).toContain('Short loop');
    expect(text()).toContain(LAP_RACE_CHOICE_TEXT.label);
    expect(text()).not.toContain(LAP_RACE_CHOICE_TEXT.notALoop);

    // The room panel: the loop is a route a race room is made on.
    const routeSelect = queryAll<HTMLSelectElement>(mounted.container, 'select').find(
      (each) => each.closest('label')?.textContent?.startsWith('Route') === true,
    );
    if (routeSelect === undefined) throw new Error('no room route chooser');
    expect([...routeSelect.options].map((option) => option.value)).toEqual([saved.id]);
    await chooseOption(routeSelect, saved.id);
    const race = queryAll<HTMLInputElement>(mounted.container, 'input[type="radio"]').find(
      (each) => each.closest('label')?.textContent?.startsWith('Race') === true,
    );
    if (race === undefined) throw new Error('no Race choice');
    await act(async () => {
      race.click();
      await Promise.resolve();
    });
    await activateWithKeyboard(buttonNamed('Make a room'));
    for (let i = 0; i < 50 && !text().includes('Its code is'); i += 1) await settle();

    const made = instance.seen.find((each) => each.path === '/v1/rooms');
    if (made === undefined) throw new Error('no room was asked for');
    const body = made.body as { kind: string; loop: boolean; lengthMetres: number };
    expect(body.kind).toBe('race');
    expect(body.loop).toBe(true);
    expect(body.lengthMetres).toBeCloseTo(saved.profile.totalDistance, -1);
  });
});
