// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The room router and its workers (#780), with real processes: two or more
 * room workers forked by the router, real `ws` clients over loopback.
 */

import { afterEach, describe, expect, it } from 'vitest';

import type { Frame } from '@onyourleft/protocol';

import { helloText } from '../core/room-testing.ts';
import { until } from './node-room-testing.ts';
import { closeFrameBytes, roomHash } from './router.ts';
import {
  joinRoom,
  ridePlan,
  startRouter,
  type RoomClient,
  type RouterHarness,
} from './router-testing.ts';

let harness: RouterHarness | undefined;
const clients: RoomClient[] = [];
afterEach(async () => {
  for (const client of clients.splice(0)) client.socket.terminate();
  await harness?.close();
  harness = undefined;
});

async function join(roomId: string, ticket: string | undefined, perMessageDeflate = true) {
  if (harness === undefined) throw new Error('no router');
  const client = await joinRoom(harness.url, roomId, ticket, { perMessageDeflate });
  clients.push(client);
  return client;
}

function framesWith(client: RoomClient, riders: number): Frame[] {
  return client.messages.filter(
    (m): m is Frame => m.type === 'frame' && m.riders.length === riders,
  );
}

describe('every room of one id lands on one worker — #780 criterion 2', () => {
  it('puts both riders of each of 24 rooms on one worker, over 3 workers, and each sees the other', async () => {
    harness = await startRouter({ workers: 3 });
    const rooms = Array.from({ length: 24 }, (_, i) => `room-${String(i)}`);
    const pairs: [RoomClient, RoomClient][] = [];
    for (const roomId of rooms) {
      pairs.push([
        await join(roomId, `ticket-a-${roomId}`),
        await join(roomId, `ticket-b-${roomId}`),
      ]);
    }
    // A room split over two workers would be two rooms of one rider each:
    // neither client would ever see a frame carrying two riders.
    await until(
      () => pairs.every(([a, b]) => framesWith(a, 2).length > 0 && framesWith(b, 2).length > 0),
      'every rider to see the other',
      10_000,
    );
    const pids = new Set(rooms.map((roomId) => harness?.router.placementOf(roomId)));
    expect(pids.has(undefined)).toBe(false);
    expect(pids.size).toBeGreaterThanOrEqual(2);
    for (const [a] of pairs)
      expect(framesWith(a, 2)[0]?.riders.map((r) => r.riderId)).toEqual([0, 1]);
  }, 20_000);

  it('spreads room ids by a stable hash', () => {
    expect(roomHash('room-1')).toBe(roomHash('room-1'));
    expect(new Set(Array.from({ length: 64 }, (_, i) => roomHash(`r${String(i)}`) % 4)).size).toBe(
      4,
    );
  });
});

describe('a worker that dies — #780 criterion 3', () => {
  it('tells its rooms’ clients the room is lost, and places no room on it again', async () => {
    harness = await startRouter({ workers: 2 });
    const ann = await join('doomed', 'ticket-ann');
    const bob = await join('doomed', 'ticket-bob');
    await until(() => framesWith(ann, 2).length > 0, 'the room to run', 5_000);
    const deadPid = harness.router.placementOf('doomed');
    expect(deadPid).toBeDefined();
    process.kill(deadPid as number, 'SIGKILL');

    expect(await ann.closed).toEqual({ code: 1011, reason: 'room-lost' });
    expect(await bob.closed).toEqual({ code: 1011, reason: 'room-lost' });
    await until(
      () => (harness?.router.workers() ?? []).every((w) => w.alive && w.pid !== deadPid),
      'a replacement worker',
      5_000,
    );
    // New rooms, and the lost room opened again, land only on live workers.
    for (const roomId of ['doomed', 'fresh-1', 'fresh-2', 'fresh-3']) {
      const rider = await join(roomId, `ticket-${roomId}`);
      await until(() => framesWith(rider, 1).length > 0, `${roomId} to run`, 5_000);
      expect(harness.router.placementOf(roomId)).not.toBe(deadPid);
    }
  }, 20_000);

  it('with no replacement started, places every new room on the workers still alive', async () => {
    harness = await startRouter({ workers: 2, respawn: false });
    const [first, second] = harness.router.workers();
    process.kill(first?.pid as number, 'SIGKILL');
    await until(() => harness?.router.workers()[0]?.alive === false, 'the death to be seen', 5_000);
    for (let i = 0; i < 6; i += 1) {
      const roomId = `after-${String(i)}`;
      const rider = await join(roomId, `ticket-${roomId}`);
      await until(() => rider.messages.length > 0, `${roomId}'s welcome`, 5_000);
      expect(harness.router.placementOf(roomId)).toBe(second?.pid);
    }
  }, 20_000);

  it('writes the close frame a client can read: unmasked, 1011, the reason', () => {
    expect([...closeFrameBytes({ code: 1011, reason: 'room-lost' })]).toEqual([
      0x88,
      11,
      0x03,
      0xf3,
      ...Buffer.from('room-lost'),
    ]);
  });
});

describe('what is refused before any room state changes — #780 criterion 1', () => {
  it('refuses an upgrade with 503 while the instance is not ready, and 404 for no such room', async () => {
    let ready = false;
    harness = await startRouter({
      workers: 1,
      ready: () => ready,
      lookup: (roomId) =>
        Promise.resolve(
          roomId === 'real' ? { kind: 'open', plan: ridePlan(roomId) } : { kind: 'unknown' },
        ),
    });
    await expect(join('real', 'ticket-ann')).rejects.toThrow('upgrade answered 503');
    ready = true;
    await expect(join('nowhere', 'ticket-ann')).rejects.toThrow('upgrade answered 404');
    const ann = await join('real', 'ticket-ann');
    await until(() => ann.messages.length > 0, 'a welcome');
    expect(ann.messages[0]?.type).toBe('welcome');
  }, 10_000);

  it('tells a rider rejoining a race that has ended — or was interrupted — that it is closed, in words', async () => {
    harness = await startRouter({ workers: 1, lookup: () => Promise.resolve({ kind: 'ended' }) });
    const late = await join('over', 'ticket-ann');
    expect(await late.closed).toEqual({ code: 4005, reason: 'room-closed' });
    expect(late.messages).toEqual([{ type: 'refuse', reason: 'room-closed' }]);
  });

  it('closes a hello with no ticket, a bad ticket, and a spent ticket with their documented codes — and seats nobody', async () => {
    const spent = new Set<string>();
    harness = await startRouter({
      workers: 1,
      admit: (_roomId, ticket) => {
        if (ticket !== 'good' || spent.has(ticket)) return undefined;
        spent.add(ticket);
        return { athleteId: 'ann', declaredMassKilograms: 70 };
      },
    });
    const noTicket = await join('gate', undefined);
    const hello = JSON.parse(helloText('unused')) as Record<string, unknown>;
    delete hello.ticket;
    noTicket.socket.send(JSON.stringify(hello));
    const bad = await join('gate', 'forged');
    expect(await noTicket.closed).toMatchObject({ code: 1008 });
    expect(await bad.closed).toEqual({ code: 4003, reason: 'ticket-refused' });
    const first = await join('gate', 'good');
    await until(() => first.messages.length > 0, 'a welcome');
    const reused = await join('gate', 'good');
    expect(await reused.closed).toEqual({ code: 4003, reason: 'ticket-refused' });
    expect(first.messages.map((m) => m.type)).toEqual(['welcome']);
  }, 10_000);
});

describe('compression is off unless the operator turns it on — #780 criterion 5, ruling Q16', () => {
  it('answers a client that offers permessage-deflate with no extension by default', async () => {
    harness = await startRouter({ workers: 1 });
    const client = await join('quiet', undefined);
    expect(client.extensions).toBeUndefined();
  });

  it('accepts it when the operator enables it', async () => {
    harness = await startRouter({
      workers: 1,
      worker: { compression: true, maxBufferedBytes: 256 * 1024, pingIntervalMs: 0 },
    });
    const client = await join('squeezed', undefined);
    expect(client.extensions).toMatch(/^permessage-deflate/);
  });
});
