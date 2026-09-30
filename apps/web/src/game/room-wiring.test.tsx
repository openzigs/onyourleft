// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * #782 and #783 through the real game: a ride in a room, driven through the
 * real `GameView`, the real picker, the real `GameSimulation`, the real
 * `RoomSession` behind `net/room-port.ts` §`roomPortOver` and a scripted room
 * (`net/testing.ts`) — and read back off what the RENDERER and the HUD were
 * handed, never off the session alone.
 *
 * The only doubles are the store behind `GamePort`, the GL context behind
 * `GameRenderer`, the clock, and the room's half of the wire.
 */

import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  altitudeMetres,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  kilograms,
  routeProfile,
  watts,
  type RoutePoint,
} from '@onyourleft/domain';

import { mount, queryAll, settle, type Mounted } from '../testing/mount';
import { roomPortOver, type RoomPort } from '../net/room-port';
import { flush, frameRider, ManualClock, ScriptedRoom } from '../net/testing';
import { REJOIN_GIVE_UP_MS } from '../net/room-session';
import { GameView, type GamePort, type RidableRoute } from './GameView';
import type { GameRenderer, SceneFrame } from './port';
import { ROOM_LOST_SPOKEN, ROOM_LOST_TEXT, ROOM_REFUSED_TEXT } from './room-ride';

/** Five level kilometres. */
function levelRoute(): RidableRoute {
  const points: RoutePoint[] = [];
  for (let index = 0; index <= 500; index += 1) {
    points.push({
      position: geographicPosition(
        degreesLatitude(51.5 + (index * 10) / 111_320),
        degreesLongitude(-0.12),
      ),
      elevation: altitudeMetres(10),
    });
  }
  return { id: 'route-level', name: 'Level', profile: routeProfile(points), attempts: 0 };
}

function pedallingPort(route: RidableRoute): GamePort {
  return {
    listRoutes: () => Promise.resolve([route]),
    loadGhost: () => Promise.resolve(undefined),
    readSensors: () => ({
      rider: { power: watts(250), live: true, paired: true },
      cadence: { value: 90, live: true, paired: true },
      heartRate: { value: 140, live: true, paired: true },
    }),
  };
}

function capturingRenderer(frames: SceneFrame[]): GameRenderer {
  return {
    loadRealisticWorld: () => Promise.reject(new Error('no realistic world was chosen')),
    create: () => ({
      hasContext: true,
      prepare: () => Promise.resolve(),
      render: (frame: SceneFrame) => {
        frames.push(frame);
      },
      setQuality: () => undefined,
      setRiderKit: () => undefined,
      resize: () => undefined,
      destroy: () => undefined,
    }),
  };
}

/** A mass nothing else in a frame could be by accident. */
const DECLARED_MASS = 73.37;
const FRAME_MS = 250;

let pending: FrameRequestCallback[] = [];
let nowMs = 0;
let mounted: Mounted | undefined;
let clock: ManualClock;

beforeEach(() => {
  pending = [];
  nowMs = 0;
  clock = new ManualClock();
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

async function pump(count: number): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    const next = pending.shift();
    if (next === undefined) return;
    nowMs += FRAME_MS;
    await clock.advance(FRAME_MS);
    await act(async () => {
      next(nowMs);
      await Promise.resolve();
    });
  }
}

function portFor(room: ScriptedRoom): RoomPort {
  return roomPortOver((mass) => room.link(mass), { timers: clock, now: () => nowMs });
}

async function rideInRoom(
  room: ScriptedRoom,
  inRoom = true,
  declared = true,
): Promise<{ readonly drawn: SceneFrame[] }> {
  const roomId = inRoom ? 'room-1' : undefined;
  const drawn: SceneFrame[] = [];
  mounted = await mount(
    <GameView
      port={pedallingPort(levelRoute())}
      renderer={() => Promise.resolve(capturingRenderer(drawn))}
      now={() => nowMs}
      {...(declared ? { riderMass: kilograms(DECLARED_MASS) } : {})}
      room={portFor(room)}
      {...(roomId === undefined ? {} : { roomId })}
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
  await flush();
  return { drawn };
}

/** Every key and every plain number anywhere in a frame, typed arrays skipped. */
function walk(value: unknown, keys: string[], numbers: number[], seen = new Set<unknown>()): void {
  if (typeof value === 'number') {
    numbers.push(value);
    return;
  }
  if (typeof value !== 'object' || value === null || seen.has(value)) return;
  if (ArrayBuffer.isView(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) walk(item, keys, numbers, seen);
    return;
  }
  for (const [key, inner] of Object.entries(value)) {
    keys.push(key);
    walk(inner, keys, numbers, seen);
  }
}

const hudText = (): string => mounted?.container.textContent ?? '';

describe('a ride in a room — #782, #783', () => {
  it('rides exactly as before with no room id: nothing is joined and nothing remote is drawn', async () => {
    const room = new ScriptedRoom();
    const { drawn } = await rideInRoom(room, false);
    await pump(20);
    expect(room.masses).toEqual([]);
    expect(room.sockets).toEqual([]);
    expect(drawn.length).toBeGreaterThan(5);
    for (const frame of drawn) {
      expect(frame.markers.every((marker) => marker.kind !== 'remote')).toBe(true);
    }
    expect(hudText()).not.toContain('Nearby');
  });

  it('draws the other riders the room sends as remote markers, and none beyond the road it built', async () => {
    const room = new ScriptedRoom();
    const { drawn } = await rideInRoom(room);
    room.accept();
    room.welcome(0);
    for (let tick = 1; tick <= 5; tick += 1) {
      room.frame(tick, [
        frameRider(1, 20 + tick * 8),
        frameRider(2, 40 + tick * 8),
        // Four kilometres up the road: past the corridor, so not drawn.
        frameRider(3, 4_000 + tick * 8),
      ]);
      await pump(4);
    }
    const last = drawn.at(-1);
    expect(last?.markers.filter((marker) => marker.kind === 'remote')).toHaveLength(2);
    expect(last?.markers[0]?.kind).toBe('rider');
    // A count on the HUD — the riders within `room-ride.ts` §`NEARBY_METRES`,
    // so not the one four kilometres up the road.
    expect(hudText()).toContain('Nearby2 riders');
  });

  it('hands the renderer no declared mass: the mass goes to the ticket and nowhere else — #783', async () => {
    const room = new ScriptedRoom();
    const { drawn } = await rideInRoom(room);
    room.accept();
    room.welcome(0);
    for (let tick = 1; tick <= 4; tick += 1) {
      room.frame(tick, [frameRider(1, 10 + tick * 8)]);
      await pump(4);
    }
    // The ticket did carry it — the one place it is for.
    expect(room.masses).toContain(DECLARED_MASS);
    expect(drawn.some((frame) => frame.markers.some((m) => m.kind === 'remote'))).toBe(true);
    for (const frame of drawn) {
      const keys: string[] = [];
      const numbers: number[] = [];
      walk(frame, keys, numbers);
      expect(keys.filter((key) => /mass|kilogram|weight/i.test(key))).toEqual([]);
      expect(numbers).not.toContain(DECLARED_MASS);
    }
  });

  it('asks for no ticket for a rider with no declared weight, says why, and rides on — #782 review (N5)', async () => {
    const room = new ScriptedRoom();
    const { drawn } = await rideInRoom(room, true, false);
    await pump(12);
    // No ticket, so no weight — default or otherwise — left the device.
    expect(room.masses).toEqual([]);
    expect(room.sockets).toEqual([]);
    expect(hudText()).toContain(ROOM_REFUSED_TEXT['no-declared-mass']);
    expect(drawn.length).toBeGreaterThan(5);
  });

  it('shows the gap to ONE chosen rider, by seat, with no watts beside them, and no standings — #783', async () => {
    const room = new ScriptedRoom();
    await rideInRoom(room);
    room.accept();
    room.welcome(0);
    for (let tick = 1; tick <= 4; tick += 1) {
      room.frame(tick, [frameRider(1, 30 + tick * 8), frameRider(2, 60 + tick * 8)]);
      await pump(4);
    }
    // Before the rider chooses, no gap to anybody.
    expect(hudText()).toContain('Following—');
    const follow = queryAll<HTMLButtonElement>(mounted?.container ?? document, 'button').find(
      (button) => (button.textContent ?? '').startsWith('Follow'),
    );
    expect(follow).toBeDefined();
    await act(async () => {
      follow?.click();
      await Promise.resolve();
    });
    await pump(2);
    // The lowest seat first — by rider id, never by who is ahead.
    const field = queryAll(mounted?.container ?? document, 'dt').find(
      (dt) => dt.textContent === 'Rider 2',
    );
    expect(field).toBeDefined();
    const value = field?.nextElementSibling?.textContent ?? '';
    expect(value).toMatch(/ahead of you|behind you|Level/);
    // Ruling Q17: never watts beside another rider's name.
    expect(value).not.toMatch(/\d\s*W(?!\/kg)\b/);
    // ADR 0021 D-6: nothing on the HUD ranks the room.
    expect(hudText()).not.toMatch(/\b(1st|2nd|3rd|position \d|place \d|leader|standings?)\b/i);
    expect(queryAll(mounted?.container ?? document, 'ol')).toHaveLength(0);
  });

  it('says in words that the room is lost, keeps riding, and rejoins by itself with a fresh ticket — #782', async () => {
    const room = new ScriptedRoom();
    const { drawn } = await rideInRoom(room);
    room.accept();
    room.welcome(0);
    await pump(8);
    // The edge closes the socket mid-ride (ruling Q3/Q6).
    room.closeFromServer(1006);
    await pump(2);
    expect(hudText()).toContain(ROOM_LOST_TEXT);
    const announcer = mounted?.container.querySelector('[data-oyl-announcer="hud"]');
    expect(announcer?.textContent).toBe(ROOM_LOST_SPOKEN);
    // Nothing the rider did: the backoff runs out and a fresh ticket is asked for.
    await pump(4);
    expect(room.tickets).toEqual(['ticket-0', 'ticket-1']);
    room.accept();
    room.welcome(0);
    await pump(4);
    expect(hudText()).not.toContain(ROOM_LOST_TEXT);
    expect(drawn.length).toBeGreaterThan(10);
  });

  it('keeps the rider’s distance continuous across a dropped socket, and corrects toward the room without a jump or a step back — #782', async () => {
    const room = new ScriptedRoom();
    const { drawn } = await rideInRoom(room);
    room.accept();
    room.welcome(0);
    // On a straight road north, the rider's marker's northing IS its odometer.
    const odometer = (): number => drawn.at(-1)?.markers[0]?.z ?? Number.NaN;
    await pump(16);
    room.closeFromServer(1006);
    // Four seconds with no room at all: the ride goes on.
    await pump(16);
    room.accept();
    room.welcome(0);
    // The room coasted the rider while they were gone (#779), so it has them
    // 30 m BEHIND; then, a few frames on, 30 m AHEAD.
    for (let tick = 10; tick < 14; tick += 1) {
      room.frame(tick, [frameRider(0, odometer() - 30, 8)]);
      await pump(4);
    }
    for (let tick = 14; tick < 18; tick += 1) {
      room.frame(tick, [frameRider(0, odometer() + 30, 8)]);
      await pump(4);
    }
    const along = drawn.map((frame) => frame.markers[0]?.z ?? Number.NaN);
    expect(along.length).toBeGreaterThan(60);
    const steps = along.slice(1).map((z, index) => z - (along[index] as number));
    // Never backwards…
    expect(Math.min(...steps)).toBeGreaterThanOrEqual(-1e-6);
    // …and never a jump: at most a frame's riding (under 15 m/s here) plus a
    // frame's share of a 30 m correction spread over two seconds.
    expect(Math.max(...steps)).toBeLessThan(15 * (FRAME_MS / 1000) + (30 / 2) * (FRAME_MS / 1000));
    // The corrections happened: held while the room was behind, pushed while it was ahead.
    expect(steps.some((step) => step < 1e-6)).toBe(true);
  });

  it('stops trying past the room’s rejoin window and says the rider is on their own', async () => {
    const room = new ScriptedRoom();
    await rideInRoom(room);
    room.accept();
    room.welcome(0);
    await pump(4);
    room.ticketAnswer = () => ({ kind: 'unreachable' });
    room.closeFromServer(1006);
    // A minute with nothing answering, and no frame drawn meanwhile.
    nowMs += REJOIN_GIVE_UP_MS + 10_000;
    await clock.advance(REJOIN_GIVE_UP_MS + 10_000);
    await pump(2);
    expect(hudText()).toContain('riding on your own');
  });
});
