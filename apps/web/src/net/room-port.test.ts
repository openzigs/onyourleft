// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';

import { NO_CARD_DEVICE } from '../instance/testing';
import { keylessInstance } from '../rooms/rooms-testing';
import { INSTANCE_SESSION_STORAGE_KEY } from '../instance/instance-port';
import { INSTANCE_ACCOUNT_STORAGE_KEY } from '../instance/sign-in';
import type {
  InstanceSend,
  InstanceSocketEvents,
  OpenInstanceSocket,
} from '../instance/instance-transport';
import { createRoomPort, roomPortOver } from './room-port';
import { ROOM_REPORT_REASON_KEYS } from './room-session';
import { flush, ManualClock } from './testing';

const ORIGIN = 'https://ride.example';

/**
 * Let the ticket's request settle: since #1210 a device with no card reads
 * the instance's keys first, and a `Response`'s body is read across tasks,
 * not only microtasks.
 */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await flush();
  }
}

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
      ...NO_CARD_DEVICE,
      storage: storageWith(SIGNED_IN),
      send: keylessInstance(send),
      openSocket: sockets.open,
      timers: clock,
      now: clock.now,
    }).join({ roomId: 'room-1', declaredMassKilograms: 71, sample: () => ({ powerWatts: 0 }) });
    await settle();
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
      ...NO_CARD_DEVICE,
      storage: storageWith({}),
      send: keylessInstance(send),
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
        ...NO_CARD_DEVICE,
        storage: storageWith(SIGNED_IN),
        send: keylessInstance(send),
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
      ...NO_CARD_DEVICE,
      storage: storageWith(SIGNED_IN),
      send: keylessInstance(send),
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
        ...NO_CARD_DEVICE,
        storage: storageWith(SIGNED_IN),
        send: keylessInstance(send),
        openSocket: recordingSockets().open,
        timers: clock,
        now: clock.now,
      }).join({ roomId: 'room-1', declaredMassKilograms: 71, sample: () => ({ powerWatts: 0 }) });
      await settle();
      await clock.advance(120_000);
      expect(connection.status()).toEqual({ kind: 'refused', reason });
      expect(send).toHaveBeenCalledTimes(1);
    });
  }

  it('reads `sealed_required` to the ticket as cannot-seal, not as not-eligible (#1210)', async () => {
    // An instance holding keys whose keys this device could not read: it
    // refuses the plaintext ticket before reading it, and says why.
    const send = vi.fn(() =>
      Promise.resolve(
        Response.json({ error: { code: 'sealed_required', message: 'Sealed.' } }, { status: 403 }),
      ),
    );
    const clock = new ManualClock();
    const connection = createRoomPort({
      ...NO_CARD_DEVICE,
      storage: storageWith(SIGNED_IN),
      send: keylessInstance(send),
      openSocket: recordingSockets().open,
      timers: clock,
      now: clock.now,
    }).join({ roomId: 'room-1', declaredMassKilograms: 71, sample: () => ({ powerWatts: 0 }) });
    await settle();
    await clock.advance(120_000);
    expect(connection.status()).toEqual({ kind: 'refused', reason: 'cannot-seal' });
    expect(send).toHaveBeenCalledTimes(1);
  });

  for (const status of [429, 500, 503]) {
    it(`reads a ${String(status)} to the ticket as unreachable, and tries again`, async () => {
      const send = vi.fn(() => Promise.resolve(new Response('{}', { status })));
      const clock = new ManualClock();
      const connection = createRoomPort({
        ...NO_CARD_DEVICE,
        storage: storageWith(SIGNED_IN),
        send: keylessInstance(send),
        openSocket: recordingSockets().open,
        timers: clock,
        now: clock.now,
      }).join({ roomId: 'room-1', declaredMassKilograms: 71, sample: () => ({ powerWatts: 0 }) });
      await settle();
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
      ...NO_CARD_DEVICE,
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
        report: () => {
          throw new Error('no instance');
        },
      }),
      { timers: clock, now: clock.now, keepAlive: () => () => undefined },
    ).join({ roomId: 'room-1', declaredMassKilograms: 71, sample: () => ({ powerWatts: 0 }) });
    await flush();
    expect(connection.status().kind).toBe('lost');
    // #789: a report over a link that throws files nothing, and says so.
    await expect(connection.report(1, 'cheating')).resolves.toEqual({ kind: 'unreachable' });
    connection.leave();
  });
});

describe('an in-ride report — #789', () => {
  function reporting(status: number, body: string | null = null) {
    return vi.fn((url: string) =>
      Promise.resolve(
        url.endsWith('/ticket')
          ? new Response(JSON.stringify({ ticket: 'the-ticket', expiresAt: 1 }), { status: 200 })
          : new Response(body, { status }),
      ),
    );
  }

  function joined(send: InstanceSend, storage = storageWith(SIGNED_IN)) {
    const clock = new ManualClock();
    return createRoomPort({
      ...NO_CARD_DEVICE,
      storage,
      send: keylessInstance(send),
      openSocket: recordingSockets().open,
      timers: clock,
      now: clock.now,
    }).join({ roomId: 'room-1', declaredMassKilograms: 71, sample: () => ({ powerWatts: 0 }) });
  }

  it('posts the seat and the reason to the room’s own report route, with the session token, and nothing else', async () => {
    const send = reporting(204);
    const connection = joined(send);
    await settle();
    send.mockClear();
    await expect(connection.report(3, 'display-name')).resolves.toEqual({ kind: 'reported' });
    expect(send).toHaveBeenCalledTimes(1);
    const [url, init] = send.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${ORIGIN}/v1/rooms/room-1/reports`);
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer session-token');
    // A seat and a reason: no screenshot, no position, no power, no mass.
    expect(JSON.parse(init.body as string)).toEqual({ riderId: 3, reason: 'display-name' });
    connection.leave();
  });

  for (const [status, kind] of [
    [429, 'rate-limited'],
    [404, 'gone'],
    [422, 'refused'],
    [503, 'unreachable'],
  ] as const) {
    it(`reads a ${String(status)} as ${kind}`, async () => {
      const send = reporting(status, '{}');
      const connection = joined(send);
      await settle();
      await expect(connection.report(1, 'other')).resolves.toEqual({ kind });
      connection.leave();
    });
  }

  it('sends nothing for a rider with no instance session, and says it was refused', async () => {
    const send = reporting(204);
    const connection = joined(send, storageWith({}));
    await settle();
    await expect(connection.report(1, 'cheating')).resolves.toEqual({ kind: 'refused' });
    expect(send).not.toHaveBeenCalled();
    connection.leave();
  });

  it('offers exactly the reasons the instance accepts', async () => {
    const instance = (await import(
      /* @vite-ignore */ new URL('../../../instance/src/moderation/moderation.ts', import.meta.url)
        .href
    )) as { ROOM_REPORT_REASONS: Record<string, string> };
    expect([...ROOM_REPORT_REASON_KEYS].sort()).toEqual(
      Object.keys(instance.ROOM_REPORT_REASONS).sort(),
    );
  });
});
