// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';

import { INSTANCE_SESSION_STORAGE_KEY } from '../instance/instance-port';
import { INSTANCE_ACCOUNT_STORAGE_KEY } from '../instance/sign-in';
import type {
  InstanceSend,
  InstanceSocketEvents,
  OpenInstanceSocket,
} from '../instance/instance-transport';
import { createRoomPort } from './room-port';
import { flush, ManualClock } from './testing';

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

  it('opens no socket for a room id the instance could not route', async () => {
    const sockets = recordingSockets();
    const clock = new ManualClock();
    const connection = createRoomPort({
      storage: storageWith(SIGNED_IN),
      send: ticketing(),
      openSocket: sockets.open,
      timers: clock,
      now: clock.now,
    }).join({ roomId: '../x', declaredMassKilograms: 71, sample: () => ({ powerWatts: 0 }) });
    await flush();
    await flush();
    expect(sockets.urls).toEqual([]);
    expect(connection.status().kind).toBe('lost');
    connection.leave();
  });

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
