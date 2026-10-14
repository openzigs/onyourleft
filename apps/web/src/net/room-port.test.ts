// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';

import { INSTANCE_SESSION_STORAGE_KEY } from '../instance/instance-port';
import { INSTANCE_ACCOUNT_STORAGE_KEY } from '../instance/sign-in';
import type {
  InstanceSend,
  InstanceSocketEvents,
  OpenInstanceSocket,
} from '../instance/instance-transport';
import { createRoomPort, roomPortOver } from './room-port';
import { UNNAMED_RIDER } from './room-session';
import { flush, frameRider, ManualClock, ScriptedRoom } from './testing';

const ORIGIN = 'https://ride.example';

function storageWith(entries: Record<string, string>): Storage {
  const map = new Map(Object.entries(entries));
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => map.set(key, value),
    removeItem: (key: string) => map.delete(key),
    clear: () => map.clear(),
    key: () => null,
    length: map.size,
  };
}

const SIGNED_IN = {
  [INSTANCE_ACCOUNT_STORAGE_KEY]: JSON.stringify({ origin: ORIGIN, instanceAthleteId: 'ath-1' }),
  [INSTANCE_SESSION_STORAGE_KEY]: JSON.stringify({ origin: ORIGIN, token: 'session-token' }),
};

function ticketing(): InstanceSend & ReturnType<typeof vi.fn> {
  return vi.fn(() =>
    Promise.resolve(
      new Response(JSON.stringify({ ticket: 'the-ticket', expiresAt: 1 }), { status: 200 }),
    ),
  );
}

function recordingSockets(): {
  readonly open: OpenInstanceSocket;
  readonly urls: string[];
  readonly events: InstanceSocketEvents[];
  readonly sent: string[];
} {
  const urls: string[] = [];
  const events: InstanceSocketEvents[] = [];
  const sent: string[] = [];
  return {
    urls,
    events,
    sent,
    open: (url, on) => {
      urls.push(url);
      events.push(on);
      return { send: (text) => sent.push(text), close: () => undefined };
    },
  };
}

describe('the production room port — #782', () => {
  it('mints a ticket over the instance, with the session token and the declared mass', async () => {
    const send = ticketing();
    const sockets = recordingSockets();
    const clock = new ManualClock();
    createRoomPort({
      storage: storageWith(SIGNED_IN),
      send,
      openSocket: sockets.open,
      timers: clock,
      now: clock.now,
    }).join({ roomId: 'room-1', declaredMassKilograms: 71, sample: () => ({ powerWatts: 0 }) });
    await flush();
    await flush();
    expect(send).toHaveBeenCalledTimes(1);
    const [url, init] = send.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${ORIGIN}/v1/rooms/room-1/ticket`);
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer session-token');
    expect(JSON.parse(init.body as string)).toEqual({ declaredMassKilograms: 71 });
    // The socket: the room's own path on the address's socket origin.
    expect(sockets.urls).toEqual(['wss://ride.example/v1/rooms/room-1/socket']);
    sockets.events[0]?.onOpen();
    expect(JSON.parse(sockets.sent[0] ?? '{}')).toMatchObject({
      type: 'hello',
      ticket: 'the-ticket',
    });
    // The token never rides on the socket.
    expect(sockets.sent.join('')).not.toContain('session-token');
  });

  it('sends nothing and opens nothing for a rider with no instance: the game rides alone', async () => {
    const send = ticketing();
    const sockets = recordingSockets();
    const clock = new ManualClock();
    const connection = createRoomPort({
      storage: storageWith({}),
      send,
      openSocket: sockets.open,
      timers: clock,
      now: clock.now,
    }).join({ roomId: 'room-1', declaredMassKilograms: 71, sample: () => ({ powerWatts: 0 }) });
    await flush();
    await clock.advance(120_000);
    expect(send).not.toHaveBeenCalled();
    expect(sockets.urls).toEqual([]);
    expect(connection.status()).toEqual({ kind: 'refused', reason: 'not-signed-in' });
    expect(connection.others(0)).toEqual([]);
    expect(connection.own()).toBeUndefined();
  });

  // #782's review (B1): the ticket's POST carries the rider's session token,
  // so a hostile id must reach neither it nor the socket — and must be refused
  // for good, since every retry would send it again.
  for (const roomId of [
    '../x',
    'x/../../auth/devices/PK/revoke?',
    'room-1?',
    'room%2F..',
    'a.b',
    '',
  ]) {
    it(`sends nothing, opens nothing and retries nothing for the room id ${JSON.stringify(roomId)}`, async () => {
      const send = ticketing();
      const sockets = recordingSockets();
      const clock = new ManualClock();
      const connection = createRoomPort({
        storage: storageWith(SIGNED_IN),
        send,
        openSocket: sockets.open,
        timers: clock,
        now: clock.now,
      }).join({ roomId, declaredMassKilograms: 71, sample: () => ({ powerWatts: 0 }) });
      await flush();
      await clock.advance(120_000);
      expect(send).not.toHaveBeenCalled();
      expect(sockets.urls).toEqual([]);
      expect(connection.status()).toEqual({ kind: 'refused', reason: 'invalid-room' });
      connection.leave();
    });
  }

  it('asks for no ticket, and sends no weight, for a rider who declared none — #782 review (N5)', async () => {
    const send = ticketing();
    const sockets = recordingSockets();
    const clock = new ManualClock();
    const connection = createRoomPort({
      storage: storageWith(SIGNED_IN),
      send,
      openSocket: sockets.open,
      timers: clock,
      now: clock.now,
    }).join({
      roomId: 'room-1',
      declaredMassKilograms: undefined,
      sample: () => ({ powerWatts: 0 }),
    });
    await flush();
    await clock.advance(120_000);
    expect(send).not.toHaveBeenCalled();
    expect(sockets.urls).toEqual([]);
    expect(connection.status()).toEqual({ kind: 'refused', reason: 'no-declared-mass' });
  });

  // #782's review (N6): each "never" the instance can say is its own reason.
  for (const [status, reason] of [
    [401, 'not-signed-in'],
    [403, 'not-eligible'],
    [404, 'no-such-room'],
    [400, 'instance-refused'],
    [409, 'instance-refused'],
  ] as const) {
    it(`reads a ${String(status)} to the ticket as refused for good: ${reason}`, async () => {
      const send = vi.fn(() => Promise.resolve(new Response('{}', { status })));
      const clock = new ManualClock();
      const connection = createRoomPort({
        storage: storageWith(SIGNED_IN),
        send,
        openSocket: recordingSockets().open,
        timers: clock,
        now: clock.now,
      }).join({ roomId: 'room-1', declaredMassKilograms: 71, sample: () => ({ powerWatts: 0 }) });
      await flush();
      await flush();
      await clock.advance(120_000);
      expect(connection.status()).toEqual({ kind: 'refused', reason });
      expect(send).toHaveBeenCalledTimes(1);
    });
  }

  for (const status of [429, 500, 503]) {
    it(`reads a ${String(status)} to the ticket as unreachable, and tries again`, async () => {
      const send = vi.fn(() => Promise.resolve(new Response('{}', { status })));
      const clock = new ManualClock();
      const connection = createRoomPort({
        storage: storageWith(SIGNED_IN),
        send,
        openSocket: recordingSockets().open,
        timers: clock,
        now: clock.now,
      }).join({ roomId: 'room-1', declaredMassKilograms: 71, sample: () => ({ powerWatts: 0 }) });
      await flush();
      await flush();
      expect(connection.status().kind).toBe('lost');
      await clock.advance(2_000);
      expect(send.mock.calls.length).toBeGreaterThan(1);
      connection.leave();
    });
  }

  it('lets the screen sleep once the room refuses for good', async () => {
    const release = vi.fn();
    const clock = new ManualClock();
    createRoomPort({
      storage: storageWith({}),
      keepAlive: () => release,
      timers: clock,
      now: clock.now,
    }).join({ roomId: 'room-1', declaredMassKilograms: 71, sample: () => ({ powerWatts: 0 }) });
    await flush();
    expect(release).toHaveBeenCalledTimes(1);
  });
});

describe('a link that fails at once — #782', () => {
  it('reports it as lost, after the caller holds the connection, and throws nothing', async () => {
    const clock = new ManualClock();
    const connection = roomPortOver(
      () => ({
        ticket: () => {
          throw new Error('no instance');
        },
        open: () => {
          throw new Error('never');
        },
      }),
      { timers: clock, now: clock.now, keepAlive: () => () => undefined },
    ).join({ roomId: 'room-1', declaredMassKilograms: 71, sample: () => ({ powerWatts: 0 }) });
    await flush();
    expect(connection.status().kind).toBe('lost');
    connection.leave();
  });
});

describe('a race’s standings, read through the port — #1347', () => {
  async function racing() {
    const clock = new ManualClock();
    const room = new ScriptedRoom();
    const connection = roomPortOver(() => room.link(), { timers: clock, now: clock.now }).join({
      roomId: 'room-1',
      declaredMassKilograms: 71,
      sample: () => ({ powerWatts: 0 }),
    });
    await flush();
    room.accept();
    room.welcome(1, 'race');
    return { room, connection };
  }

  it('is empty before the room’s first frame', async () => {
    const { room, connection } = await racing();
    room.roster([{ riderId: 1, name: 'Me' }]);
    expect(connection.standings()).toEqual([]);
    connection.leave();
  });

  it('lists every rider in the newest frame by distance, named by the roster, with the room’s own gap and W/kg', async () => {
    const { room, connection } = await racing();
    room.roster([
      { riderId: 0, name: 'Anna' },
      { riderId: 1, name: 'Me' },
      { riderId: 2, name: 'Bea' },
    ]);
    room.frame(1, [
      { ...frameRider(0, 900), gapDeciseconds: -125, wattsPerKilogramTenths: 41 },
      { ...frameRider(1, 1_000), gapDeciseconds: 0, wattsPerKilogramTenths: 35 },
      { ...frameRider(2, 1_000), gapDeciseconds: 0, wattsPerKilogramTenths: 0, flags: 3 },
    ]);
    // The newest frame wins: the room moved Anna ahead.
    room.frame(2, [
      { ...frameRider(0, 1_100), gapDeciseconds: -82, wattsPerKilogramTenths: 42 },
      { ...frameRider(1, 1_000), gapDeciseconds: 0, wattsPerKilogramTenths: 36 },
      { ...frameRider(2, 1_000), gapDeciseconds: 0, wattsPerKilogramTenths: 0, flags: 3 },
    ]);
    expect(connection.standings()).toEqual([
      {
        riderId: 0,
        name: 'Anna',
        distanceMetres: 1_100,
        gapSeconds: -8.2,
        wattsPerKilogram: 4.2,
        flags: 0,
        own: false,
      },
      // Level on distance: by seat, so the order does not flicker between frames.
      {
        riderId: 1,
        name: 'Me',
        distanceMetres: 1_000,
        gapSeconds: 0,
        wattsPerKilogram: 3.6,
        flags: 0,
        own: true,
      },
      {
        riderId: 2,
        name: 'Bea',
        distanceMetres: 1_000,
        gapSeconds: 0,
        wattsPerKilogram: 0,
        flags: 3,
        own: false,
      },
    ]);
    connection.leave();
  });

  it('names a seat the roster has not named as the hidden-name word, never "Rider N"', async () => {
    const { room, connection } = await racing();
    room.roster([{ riderId: 1, name: 'Me' }]);
    room.frame(1, [frameRider(1, 10), frameRider(7, 5)]);
    expect(connection.standings().map((each) => each.name)).toEqual(['Me', UNNAMED_RIDER]);
    expect(UNNAMED_RIDER).toBe('Rider');
    // A later roster names them.
    room.roster([
      { riderId: 1, name: 'Me' },
      { riderId: 7, name: 'Cat' },
    ]);
    expect(connection.standings().map((each) => each.name)).toEqual(['Me', 'Cat']);
    connection.leave();
  });
});
