// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * **A rider's room, through the real shell, wired as `main.tsx` wires it** —
 * #784 and #785.
 *
 * The real `AppShell` at the game route, handed a rooms port and a room port
 * built by `createRoomsPort` and `createRoomPort` over `localStorage` — as
 * `main.tsx` §`buildRoomsPort` and §`buildRoomPort` build them — with the
 * network scripted: the instance's HTTP answers (`rooms/rooms-testing.ts`) and a
 * room's socket played by hand. Every step is the rider's own: a code typed
 * into the picker's panel, *Join the room*, *Ride in the room*, *Start the
 * race*, *End ride*.
 *
 * ⚠️ This is how the room id reaches the game in the PRODUCT since #784 — the
 * picker's panel — which is what #919's review asked `room-shell-wiring` to be
 * extended to once it existed (#784's comment): the ticket asked for is the
 * room the panel entered, and no `roomId` is handed to the shell.
 */

import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { kilograms, watts } from '@onyourleft/domain';
import { encodeMessage, type RoomMessage } from '@onyourleft/protocol';

import type { GamePort, RidableRoute } from '../game/GameView';
import type { GameRenderer } from '../game/port';
import { ANNOUNCEMENTS_STORAGE_KEY, DEFAULT_ANNOUNCEMENTS } from '../game/hud/announce-preference';
import { RACE_TEXT, ROOM_REFUSED_TEXT } from '../game/room-ride';
import type { InstanceSocketEvents, OpenInstanceSocket } from '../instance/instance-transport';
import { INSTANCE_SESSION_STORAGE_KEY } from '../instance/instance-port';
import { INSTANCE_ACCOUNT_STORAGE_KEY } from '../instance/sign-in';
import { createRoomPort } from '../net/room-port';
import { createRoomsPort } from '../net/rooms-port';
import { routeDigest } from './share';
import { ASK_FOR_RESULT_LABEL, RACE_LEFT_EARLY_TEXT, RACE_NOT_OVER_TEXT } from './RaceResult';
import { AppShell } from '../shell/AppShell';
import type { CapabilityProbe } from '../support/bluetooth-support';
import { mount, settle, submitForm, typeInto, type Mounted } from '../testing/mount';
import {
  northProfile,
  roomRoute,
  ROOMS_ORIGIN,
  ScriptedInstance,
  zoneNorth,
} from './rooms-testing';

const NO_BLUETOOTH: CapabilityProbe = { bluetooth: undefined, secureContext: true };

const OWN_ROUTE: RidableRoute = {
  id: 'route-1',
  name: 'Up the hill',
  profile: northProfile(3_000),
  attempts: 0,
};

const GAME: GamePort = {
  listRoutes: () => Promise.resolve([OWN_ROUTE]),
  loadGhost: () => Promise.resolve(undefined),
  readSensors: () => ({
    rider: { power: watts(240), live: true, paired: true },
    cadence: { value: 88, live: true, paired: true },
    heartRate: { value: 140, live: true, paired: true },
  }),
};

const RENDERER: GameRenderer = {
  loadRealisticWorld: () => Promise.reject(new Error('not chosen')),
  create: () => ({
    hasContext: true,
    prepare: () => Promise.resolve(),
    render: () => undefined,
    setQuality: () => undefined,
    setRiderKit: () => undefined,
    resize: () => undefined,
    destroy: () => undefined,
  }),
};

let mounted: Mounted | undefined;
let frames: FrameRequestCallback[] = [];
let clock = 0;

beforeEach(() => {
  frames = [];
  clock = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.push(callback);
    return frames.length;
  });
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
  localStorage.setItem(
    INSTANCE_ACCOUNT_STORAGE_KEY,
    JSON.stringify({ origin: ROOMS_ORIGIN, instanceAthleteId: 'ath-1' }),
  );
  localStorage.setItem(
    INSTANCE_SESSION_STORAGE_KEY,
    JSON.stringify({ origin: ROOMS_ORIGIN, token: 'session-token' }),
  );
  globalThis.location.hash = '#/game';
});

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  globalThis.location.hash = '';
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** A room's socket, played by hand: what the client opened, and a way to answer on it. */
function handPlayedSockets(): {
  readonly open: OpenInstanceSocket;
  readonly urls: string[];
  say(message: RoomMessage): Promise<void>;
} {
  const urls: string[] = [];
  let events: InstanceSocketEvents | undefined;
  return {
    urls,
    open: (url, on) => {
      urls.push(url);
      events = on;
      queueMicrotask(() => {
        on.onOpen();
      });
      return { send: () => undefined, close: () => undefined };
    },
    say: async (message) => {
      // The socket is opened once the ticket has come back: wait for it.
      for (let i = 0; events === undefined && i < 20; i += 1) await settle();
      if (events === undefined) throw new Error('the client opened no socket');
      const on = events;
      await act(async () => {
        on.onText(encodeMessage(message));
        await Promise.resolve();
      });
    },
  };
}

/** Run `count` animation frames, `ms` apart on the page's clock. */
async function frame(count = 1, ms = 1_000): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    clock += ms;
    await act(async () => {
      const due = frames;
      frames = [];
      for (const callback of due) callback(clock);
      await Promise.resolve();
    });
  }
}

const button = (name: string): HTMLButtonElement | undefined =>
  [...document.querySelectorAll<HTMLButtonElement>('button')].find(
    (each) => (each.textContent ?? '').trim() === name,
  );

async function press(name: string): Promise<void> {
  const found = button(name);
  if (found === undefined) throw new Error(`no “${name}” button`);
  await act(async () => {
    found.click();
    await Promise.resolve();
  });
  await settle();
}

/** The HUD's reading under `label`. */
function reading(label: string): string | undefined {
  const term = [...document.querySelectorAll('.oyl-hud__label')].find(
    (each) => each.textContent === label,
  );
  return term?.nextElementSibling?.textContent ?? undefined;
}

async function shell(
  instance: ScriptedInstance,
  sockets: ReturnType<typeof handPlayedSockets>,
  zones = [zoneNorth(50_000)],
) {
  mounted = await mount(
    <AppShell
      capabilities={NO_BLUETOOTH}
      game={GAME}
      gameRenderer={() => Promise.resolve(RENDERER)}
      riderMass={kilograms(70)}
      rooms={createRoomsPort({
        storage: localStorage,
        zones: () => Promise.resolve(zones),
        send: instance.send,
      })}
      room={createRoomPort({
        storage: localStorage,
        send: instance.send,
        openSocket: sockets.open,
      })}
    />,
  );
  await settle();
}

async function joinByCode(code: string): Promise<void> {
  const input = [...document.querySelectorAll<HTMLInputElement>('input')].find(
    (each) => each.closest('label')?.textContent?.startsWith('Room code') === true,
  );
  if (input === undefined) throw new Error('no room code box');
  await typeInto(input, code);
  const form = input.closest('form');
  if (form === null) throw new Error('the code box is in no form');
  await submitForm(form);
  await settle();
  await settle();
}

describe('a group ride joined by its code — #784', () => {
  it('rides the room the panel entered: its route fetched by hash and checked, then a ticket for THAT room', async () => {
    const instance = new ScriptedInstance();
    const { gpx, sha256 } = await roomRoute(2_500);
    instance.offer('room-joined', 'group', gpx, sha256);
    const sockets = handPlayedSockets();
    await shell(instance, sockets);
    await joinByCode('abcde-fghjk-mnpqr');
    expect(document.body.textContent).toContain('You are in a group ride on the room’s route.');
    await press('Ride in the room');
    await settle();
    expect(instance.seen.map((each) => `${each.method} ${each.path}`)).toEqual([
      'POST /v1/rooms/join',
      'GET /v1/rooms/room-joined/route',
      'POST /v1/rooms/room-joined/ticket',
    ]);
    expect(sockets.urls).toEqual(['wss://ride.example/v1/rooms/room-joined/socket']);
    // The road ridden is the room's: its length, read back from the room's own GPX.
    expect(reading('To go')).toMatch(/^2\.5/);
  });

  it('leaves a room whose welcome names another route than the one fetched and checked — #784’s review (N1)', async () => {
    const instance = new ScriptedInstance();
    const { gpx, sha256 } = await roomRoute(2_500);
    instance.offer('room-joined', 'group', gpx, sha256);
    const sockets = handPlayedSockets();
    await shell(instance, sockets);
    await joinByCode('ABCDE-FGHJK-MNPQR');
    await press('Ride in the room');
    await settle();
    await sockets.say({
      type: 'welcome',
      riderId: 1,
      routeRef: { sha256: sha256.replace(/^./, sha256.startsWith('0') ? '1' : '0') },
      roomConfig: {
        kind: 'ride',
        ridingPosition: 'hoods',
        reportIntervalMs: 500,
        frameIntervalMs: 1000,
      },
    });
    await frame(2);
    expect(document.body.textContent).toContain(ROOM_REFUSED_TEXT['not-the-rooms-route']);
  });

  it('rides one of the rider’s own routes ALONE, even while a room is entered', async () => {
    const instance = new ScriptedInstance();
    const { gpx, sha256 } = await roomRoute(2_500);
    instance.offer('room-joined', 'group', gpx, sha256);
    const sockets = handPlayedSockets();
    await shell(instance, sockets);
    await joinByCode('ABCDE-FGHJK-MNPQR');
    await press(`Ride ${OWN_ROUTE.name}`);
    await settle();
    // No ticket and no socket: the rider's own route is not the room's road.
    expect(instance.seen.some((each) => each.path.endsWith('/ticket'))).toBe(false);
    expect(sockets.urls).toEqual([]);
    expect(reading('To go')).toMatch(/^3\.0/);
  });

  it('announces a rider joining and leaving, with announcements on — and nothing for the room as it was found', async () => {
    localStorage.setItem(
      ANNOUNCEMENTS_STORAGE_KEY,
      JSON.stringify({
        ...DEFAULT_ANNOUNCEMENTS,
        enabled: true,
        powerEverySeconds: 'never',
        distanceEvery: 'never',
      }),
    );
    const instance = new ScriptedInstance();
    const { gpx, sha256 } = await roomRoute(2_500);
    instance.offer('room-joined', 'group', gpx, sha256);
    const sockets = handPlayedSockets();
    await shell(instance, sockets);
    await joinByCode('ABCDE-FGHJK-MNPQR');
    await press('Ride in the room');
    await settle();
    const region = (): string =>
      document.querySelector('[data-oyl-announcer="hud"]')?.textContent ?? '';
    const rider = (riderId: number, decimetres: number) => ({
      riderId,
      decimetres,
      centimetresPerSecond: 900,
      draftPercent: 0,
      flags: 0,
    });
    await sockets.say({
      type: 'welcome',
      riderId: 0,
      routeRef: { sha256 },
      roomConfig: {
        kind: 'ride',
        ridingPosition: 'hoods',
        reportIntervalMs: 500,
        frameIntervalMs: 1000,
      },
    });
    await sockets.say({ type: 'frame', tick: 1, riders: [rider(0, 10), rider(1, 12)] });
    await frame(3);
    expect(region()).not.toContain('joined');
    await sockets.say({
      type: 'frame',
      tick: 2,
      riders: [rider(0, 20), rider(1, 22), rider(2, 5)],
    });
    await frame(4);
    expect(region()).toBe('A rider joined the room.');
    await sockets.say({ type: 'frame', tick: 3, riders: [rider(0, 30), rider(2, 15)] });
    await frame(4);
    expect(region()).toBe('A rider left the room.');
  });
});

describe('making a room — #784', () => {
  it('shows the code to share, and refuses a route in a privacy zone with no request at all', async () => {
    const instance = new ScriptedInstance();
    const sockets = handPlayedSockets();
    await shell(instance, sockets, [zoneNorth(0)]);
    await press('Make a room');
    expect(document.body.textContent).toContain(
      'This route starts inside one of your privacy zones.',
    );
    expect(instance.seen).toEqual([]);
    mounted?.unmount();
    mounted = undefined;

    const clear = new ScriptedInstance();
    await shell(clear, handPlayedSockets());
    await press('Make a room');
    expect(clear.seen.map((each) => each.path)).toEqual(['/v1/rooms']);
    expect(document.body.textContent).toContain('Its code is ABCDE-FGHJK-MNPQR.');
  });
});

describe('a private race — #785', () => {
  async function inARace(): Promise<{
    instance: ScriptedInstance;
    sockets: ReturnType<typeof handPlayedSockets>;
    sha256: string;
  }> {
    const instance = new ScriptedInstance();
    const { gpx, sha256 } = await roomRoute(2_500);
    instance.offer('room-race', 'race', gpx, sha256);
    const sockets = handPlayedSockets();
    await shell(instance, sockets);
    await joinByCode('ABCDE-FGHJK-MNPQR');
    await press('Ride in the room');
    await settle();
    await sockets.say({
      type: 'welcome',
      riderId: 1,
      routeRef: { sha256 },
      roomConfig: {
        kind: 'race',
        ridingPosition: 'hoods',
        reportIntervalMs: 500,
        frameIntervalMs: 1000,
      },
    });
    return { instance, sockets, sha256 };
  }

  /** A race this rider MADE on their own route, ridden and welcomed. */
  async function inARaceTheyMade(): Promise<{
    instance: ScriptedInstance;
    sockets: ReturnType<typeof handPlayedSockets>;
  }> {
    const instance = new ScriptedInstance();
    const sockets = handPlayedSockets();
    await shell(instance, sockets);
    const race = [...document.querySelectorAll<HTMLInputElement>('input[type="radio"]')].find(
      (each) => each.closest('label')?.textContent?.startsWith('Race') === true,
    );
    if (race === undefined) throw new Error('no Race choice');
    await act(async () => {
      race.click();
      await Promise.resolve();
    });
    await press('Make a room');
    expect(document.body.textContent).toContain('Its code is ABCDE-FGHJK-MNPQR.');
    const sent = instance.seen.find((each) => each.path === '/v1/rooms')?.body as { gpx: string };
    await press('Ride in the room');
    await settle();
    await sockets.say({
      type: 'welcome',
      riderId: 1,
      routeRef: { sha256: await routeDigest(sent.gpx) },
      roomConfig: {
        kind: 'race',
        ridingPosition: 'hoods',
        reportIntervalMs: 500,
        frameIntervalMs: 1000,
      },
    });
    return { instance, sockets };
  }

  it('offers a rider who joined by the code no start, and says the room’s maker starts it — the owner’s ruling of 2026-09-30', async () => {
    const { instance } = await inARace();
    await frame(2);
    expect(document.body.textContent).toContain(RACE_TEXT.waitingForItsMaker);
    expect(button('Start the race')).toBeUndefined();
    expect(instance.seen.some((each) => each.path.endsWith('/start'))).toBe(false);
  });

  it('holds the rider on the line until the room starts the race, whatever they pedal, and its maker starts it', async () => {
    const { instance, sockets } = await inARaceTheyMade();
    await frame(5);
    const atTheLine = reading('To go');
    expect(document.body.textContent).toContain(RACE_TEXT.waiting);
    // Pedalling 240 W for five seconds moved nothing: the rider is held.
    await frame(5);
    expect(reading('To go')).toBe(atTheLine);

    await press('Start the race');
    expect(instance.seen.at(-1)).toMatchObject({
      method: 'POST',
      path: '/v1/rooms/room-abc/start',
    });
    await sockets.say({ type: 'countdown', startsInMs: 10_000 });
    await frame(1, 3_000);
    expect(document.body.textContent).toContain('The race starts in 7 seconds.');
    // Counting down is still held: the room's first frame is what starts it.
    await frame(5);
    expect(reading('To go')).toBe(atTheLine);
    await sockets.say({ type: 'frame', tick: 1, riders: [] });
    await frame(3);
    expect(reading('To go')).not.toBe(atTheLine);
    // And the start is said, whatever the rider chose about announcements.
    expect(document.querySelector('[data-oyl-announcer="hud"]')?.textContent).toBe('Go.');
  });

  it('asks nothing for a race the rider leaves while it runs, and shows its result on a press once the instance has it — #785’s review (N5)', async () => {
    const { instance, sockets } = await inARace();
    await sockets.say({ type: 'frame', tick: 1, riders: [] });
    await frame(3);
    await press('End ride');
    await settle();
    // Offered, and nothing asked: no list, no request.
    expect(document.body.textContent).toContain(RACE_LEFT_EARLY_TEXT);
    expect(document.querySelector('ol')).toBeNull();
    expect(instance.seen.some((each) => each.path.endsWith('/results'))).toBe(false);
    // Asked while the race is still ridden: the instance withholds it, and says nothing more.
    await press(ASK_FOR_RESULT_LABEL);
    await settle();
    expect(document.body.textContent).toContain(RACE_NOT_OVER_TEXT);
    expect(document.querySelector('ol')).toBeNull();
    // Asked once it is over: the room's own order.
    instance.publish([
      {
        place: 1,
        displayName: 'Ann',
        you: false,
        finishMs: 3_725_000,
        wattsPerKilogram: 6.6,
        flags: [],
      },
      {
        place: 2,
        displayName: 'Me',
        you: true,
        finishMs: 3_900_000,
        wattsPerKilogram: 3.4,
        flags: [],
      },
    ]);
    await press(ASK_FOR_RESULT_LABEL);
    await settle();
    const rows = [...document.querySelectorAll('.oyl-race-result__rows li')].map(
      (row) => row.textContent,
    );
    expect(rows).toHaveLength(2);
    expect(rows[1]).toContain('2nd You');
    expect(instance.seen.filter((each) => each.path.endsWith('/results'))).toHaveLength(2);
  });

  it('shows no ordered result while the race runs, and the room’s own after it — W/kg beside others, every flag to everyone', async () => {
    const { instance, sockets } = await inARace();
    await sockets.say({ type: 'frame', tick: 1, riders: [] });
    await frame(3);
    expect(document.querySelector('ol')).toBeNull();
    expect(document.body.textContent).not.toContain('Race result');
    instance.publish([
      {
        place: 1,
        displayName: 'Ann',
        you: false,
        finishMs: 3_725_000,
        wattsPerKilogram: 6.6,
        flags: [{ durationSeconds: 1200, overWattsPerKilogram: 6.5 }],
      },
      {
        place: 2,
        displayName: null,
        you: false,
        finishMs: null,
        wattsPerKilogram: null,
        flags: [],
      },
      {
        place: 3,
        displayName: 'Me',
        you: true,
        finishMs: 3_900_000,
        wattsPerKilogram: 3.4,
        flags: [],
      },
    ]);
    await sockets.say({ type: 'finish', order: [0, 2, 1] });
    await frame(2);
    // Said over: still no list on the stage while the rider is on it.
    expect(document.body.textContent).toContain(
      'The race is over. End the ride to see its result.',
    );
    expect(document.querySelector('ol')).toBeNull();
    await press('End ride');
    await settle();
    await settle();
    const rows = [...document.querySelectorAll('.oyl-race-result__rows li')].map(
      (row) => row.textContent,
    );
    expect(rows).toHaveLength(3);
    expect(rows[0]).toContain('1st Ann — 1:02:05, 6.6 W/kg');
    expect(rows[0]).toContain('Flagged: over 6.5 W/kg for 20 minutes.');
    expect(rows[1]).toContain('2nd A rider');
    // The rider's own line may carry their own watts; nobody else's does.
    expect(rows[2]).toMatch(/3rd You — 1:05:00, 3\.4 W\/kg, \d+ W/);
    for (const other of rows.slice(0, 2)) expect(other).not.toMatch(/\d W\b(?!\/kg)/);
    expect(instance.seen.at(-1)).toMatchObject({ path: '/v1/rooms/room-race/results' });
  });
});
