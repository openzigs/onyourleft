// SPDX-License-Identifier: AGPL-3.0-or-later

import { PROTOCOL_VERSION } from '@onyourleft/protocol';
import { PHYSICS_VERSION } from '@onyourleft/physics';
import { describe, expect, it } from 'vitest';

import {
  BACKOFF_BASE_MS,
  BACKOFF_CEILING_MS,
  backoffMs,
  KEEPALIVE_INTERVAL_MS,
  REJOIN_GIVE_UP_MS,
  RoomSession,
  type RoomSample,
} from './room-session';
import { flush, frameRider, ManualClock, ScriptedRoom } from './testing';

function session(
  room: ScriptedRoom,
  clock: ManualClock,
  sample: () => RoomSample = () => ({ powerWatts: 200, cadenceRpm: 90 }),
): RoomSession {
  return new RoomSession({
    roomId: 'room-1',
    link: room.link(),
    timers: clock,
    now: clock.now,
    physicsVersion: PHYSICS_VERSION,
    sample,
    random: () => 0,
  });
}

async function joined(
  room: ScriptedRoom,
  clock: ManualClock,
  sample?: () => RoomSample,
): Promise<RoomSession> {
  const s = session(room, clock, sample);
  await flush();
  room.accept();
  room.welcome(3);
  return s;
}

/** Every key anywhere in a parsed value. */
function keysOf(value: unknown, into: string[] = []): string[] {
  if (Array.isArray(value)) for (const item of value) keysOf(item, into);
  else if (typeof value === 'object' && value !== null) {
    for (const [key, inner] of Object.entries(value)) {
      into.push(key);
      keysOf(inner, into);
    }
  }
  return into;
}

describe('joining a room — #782', () => {
  it('mints a ticket, says hello with it and this build’s versions, and is welcomed', async () => {
    const room = new ScriptedRoom();
    const clock = new ManualClock();
    const s = session(room, clock);
    expect(s.status.kind).toBe('connecting');
    await flush();
    expect(room.tickets).toEqual(['ticket-0']);
    room.accept();
    expect(room.socket.sent).toEqual([
      {
        type: 'hello',
        protocol: PROTOCOL_VERSION,
        physicsVersion: PHYSICS_VERSION,
        ticket: 'ticket-0',
      },
    ]);
    room.welcome(3);
    expect(s.status).toMatchObject({ kind: 'joined', riderId: 3 });
  });

  it('asks for no ticket for a room id no instance could route: refused, and never retried — #782 review (B1)', async () => {
    const room = new ScriptedRoom();
    const clock = new ManualClock();
    const s = new RoomSession({
      roomId: 'x/../../auth/devices/PK/revoke?',
      link: room.link(),
      timers: clock,
      now: clock.now,
      physicsVersion: PHYSICS_VERSION,
      sample: () => ({ powerWatts: 0 }),
    });
    await flush();
    await clock.advance(120_000);
    expect(s.status).toEqual({ kind: 'refused', reason: 'invalid-room' });
    expect(room.masses).toEqual([]);
    expect(room.sockets).toHaveLength(0);
  });

  it('opens nothing when this device holds no session: refused, and never retried', async () => {
    const room = new ScriptedRoom();
    room.ticketAnswer = () => ({ kind: 'refused', reason: 'not-signed-in' });
    const clock = new ManualClock();
    const s = session(room, clock);
    await flush();
    await clock.advance(60_000);
    expect(s.status).toEqual({ kind: 'refused', reason: 'not-signed-in' });
    expect(room.sockets).toHaveLength(0);
  });
});

describe('reporting power — #782, ADR 0028 D-2', () => {
  it('reports every report interval with an increasing sequence, the power and the cadence', async () => {
    const room = new ScriptedRoom();
    const clock = new ManualClock();
    await joined(room, clock);
    await clock.advance(2_000);
    const reports = room.socket.sent.filter((m) => m.type === 'report');
    expect(reports).toHaveLength(4);
    expect(reports.map((r) => (r.type === 'report' ? r.sequence : 0))).toEqual([1, 2, 3, 4]);
    expect(reports[0]).toEqual({
      type: 'report',
      sequence: 1,
      atMs: 500,
      powerWatts: 200,
      cadenceRpm: 90,
    });
  });

  it('never sends a position: no message carries a distance or a coordinate', async () => {
    const room = new ScriptedRoom();
    const clock = new ManualClock();
    await joined(room, clock);
    await clock.advance(3_000);
    const forbidden =
      /^(lat|latitude|lon|lng|longitude|position|coordinates?|distance|metres|decimetres|x|y|z|altitude|elevation)$/i;
    const keys = room.socket.texts.flatMap((text) => keysOf(JSON.parse(text)));
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.filter((key) => forbidden.test(key))).toEqual([]);
  });

  it('sends 0 W, never an invented number, when there is no live power reading', async () => {
    const room = new ScriptedRoom();
    const clock = new ManualClock();
    await joined(room, clock, () => ({ powerWatts: undefined }));
    await clock.advance(500);
    expect(room.socket.sent.at(-1)).toEqual({
      type: 'report',
      sequence: 1,
      atMs: 500,
      powerWatts: 0,
    });
  });
});

describe('the keepalive — ADR 0037 D-8.1, ruling Q3/Q6', () => {
  it('never lets the socket idle longer than the keepalive interval, moving or not', async () => {
    expect(KEEPALIVE_INTERVAL_MS).toBeLessThan(30_000);
    const room = new ScriptedRoom();
    const clock = new ManualClock();
    const sentAt: number[] = [];
    await joined(room, clock, () => {
      sentAt.push(clock.now());
      return { powerWatts: undefined };
    });
    await clock.advance(120_000);
    expect(sentAt.length).toBe(120_000 / KEEPALIVE_INTERVAL_MS);
    for (let i = 1; i < sentAt.length; i += 1) {
      expect((sentAt[i] as number) - (sentAt[i - 1] as number)).toBeLessThanOrEqual(
        KEEPALIVE_INTERVAL_MS,
      );
    }
  });
});

describe('rejoin — ADR 0037 D-8.2', () => {
  it('backs off exponentially, bounded, with at most a quarter taken off at random', () => {
    expect([0, 1, 2, 3, 4, 5, 10].map((n) => backoffMs(n, 0))).toEqual([
      500, 1_000, 2_000, 4_000, 8_000, 8_000, 8_000,
    ]);
    expect(backoffMs(0, 0)).toBe(BACKOFF_BASE_MS);
    expect(backoffMs(3, 0.999)).toBeGreaterThanOrEqual(3_000);
    expect(backoffMs(50, 0)).toBe(BACKOFF_CEILING_MS);
  });

  it('reconnects with a fresh ticket after the edge closes the socket, with no user action', async () => {
    const room = new ScriptedRoom();
    const clock = new ManualClock();
    const s = await joined(room, clock);
    await clock.advance(1_000);
    room.closeFromServer(1006);
    expect(s.status).toMatchObject({ kind: 'lost' });
    // No report goes anywhere while it is down.
    const before = room.sockets.length;
    await clock.advance(BACKOFF_BASE_MS - 1);
    expect(room.sockets).toHaveLength(before);
    await clock.advance(1);
    expect(room.sockets).toHaveLength(before + 1);
    expect(room.tickets).toEqual(['ticket-0', 'ticket-1']);
    room.accept();
    expect(room.socket.sent[0]).toMatchObject({ type: 'hello', ticket: 'ticket-1' });
    room.welcome(3);
    expect(s.status).toMatchObject({ kind: 'joined', riderId: 3 });
    expect(s.welcomes).toBe(2);
    await clock.advance(1_000);
    expect(room.socket.sent.filter((m) => m.type === 'report')).toHaveLength(2);
  });

  it('keeps trying on a growing backoff while nothing answers, and gives up past the rejoin window', async () => {
    const room = new ScriptedRoom();
    const clock = new ManualClock();
    const s = await joined(room, clock);
    room.closeFromServer(1006);
    room.ticketAnswer = () => ({ kind: 'unreachable' });
    await clock.advance(REJOIN_GIVE_UP_MS - 1);
    expect(s.status.kind).toBe('lost');
    await clock.advance(10_000);
    expect(s.status.kind).toBe('gone');
    const attempts = room.masses.length;
    await clock.advance(60_000);
    expect(room.masses.length).toBe(attempts);
  });

  it('takes a refusal as final: a full room is not retried', async () => {
    const room = new ScriptedRoom();
    const clock = new ManualClock();
    const s = session(room, clock);
    await flush();
    room.accept();
    room.send({ type: 'refuse', reason: 'room-full' });
    room.closeFromServer(4004, 'room-full');
    await clock.advance(30_000);
    expect(s.status).toEqual({ kind: 'refused', reason: 'room-full' });
    expect(room.sockets).toHaveLength(1);
  });

  it('asks again with a fresh ticket when one was spent or expired on the way, a few times', async () => {
    const room = new ScriptedRoom();
    const clock = new ManualClock();
    const s = session(room, clock);
    for (let i = 0; i < 3; i += 1) {
      await flush();
      room.accept();
      room.send({ type: 'refuse', reason: 'ticket-refused' });
      room.closeFromServer(4003, 'ticket-refused');
      await clock.advance(10_000);
    }
    expect(s.status).toEqual({ kind: 'refused', reason: 'ticket-refused' });
    expect(new Set(room.tickets).size).toBe(room.tickets.length);
  });

  it('does not come back after the rider leaves', async () => {
    const room = new ScriptedRoom();
    const clock = new ManualClock();
    const s = await joined(room, clock);
    s.leave();
    expect(room.socket.closedByClient).toBe(true);
    await clock.advance(60_000);
    expect(room.sockets).toHaveLength(1);
    expect(s.status.kind).toBe('left');
  });
});

describe('frames — #782', () => {
  it('hands out every other rider and keeps this rider’s own entry for correction', async () => {
    const room = new ScriptedRoom();
    const clock = new ManualClock();
    const s = await joined(room, clock);
    room.frame(1, [frameRider(3, 10), frameRider(4, 12)]);
    await clock.advance(1_000);
    room.frame(2, [frameRider(3, 20), frameRider(4, 24)]);
    expect(s.others(clock.now() + 5_000).map((r) => r.riderId)).toEqual([4]);
    expect(s.own()?.rider.distanceMetres).toBe(20);
    expect(s.own()?.atLocalMs).toBe(1_000);
  });
});
