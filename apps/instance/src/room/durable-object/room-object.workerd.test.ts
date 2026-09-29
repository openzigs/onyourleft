// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The Durable Object adapter (#781) under a real `workerd`, on the runtime's
 * own clock: the alarm that ticks a room and stops, and a lobby evicted and
 * restored. `pnpm --filter @onyourleft/instance run test:workerd` — not in CI
 * (`vitest.workerd.config.ts` says why), and it needs no Cloudflare account.
 *
 * ⚠️ The eviction here is the runtime's own, not a simulation of it: `workerd`
 * evicts a Durable Object after about ten seconds with no event and no alarm
 * (`preventEviction` in `workerd.capnp`, which the config here leaves unset),
 * and hibernatable sockets stay open across it. The case waits for it and
 * reads a new object generation back as the proof it happened.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { decodeRoomMessage, type RoomMessage } from '@onyourleft/protocol';

import { helloText, reportText } from '../core/room-testing.ts';
import {
  roomUrl,
  RoomSocket,
  stateOf,
  startWorkerd,
  waitForState,
  type Workerd,
} from '../workerd-testing.ts';

let runtime: Workerd | undefined;

beforeAll(async () => {
  runtime = await startWorkerd();
});

afterAll(async () => {
  await runtime?.stop();
});

function room(name: string): string {
  if (runtime === undefined) throw new Error('workerd did not start');
  return roomUrl(runtime, 'WALL_CLOCK', `${name}-${String(Date.now())}`);
}

function messages(socket: RoomSocket): RoomMessage[] {
  return socket.received.flatMap((text) => {
    const decoded = decodeRoomMessage(text);
    return decoded.ok ? [decoded.message] : [];
  });
}

function frames(received: readonly string[]): number {
  return received.filter((text) => text.includes('"type":"frame"')).length;
}

async function hello(base: string, athlete: string): Promise<RoomSocket> {
  const socket = await RoomSocket.open(base);
  socket.send(helloText(`ticket-${athlete}`));
  await socket.sync();
  return socket;
}

describe('the tick is a storage alarm, and it stops — #781 criterion 2', () => {
  it('ticks on with no socket connected until the rejoin window closes, then clears its alarm', async () => {
    const base = room('alarm');
    const ann = await hello(base, 'ann');
    expect((await fetch(`${base}/start`, { method: 'POST' })).status).toBe(200);
    // A one-second countdown, then frames on the runtime's own alarms.
    await ann.until((received) => frames(received) >= 2, 5_000);
    const running = await stateOf(base);
    expect(running.view.phase).toBe('running');
    expect(running.alarm).not.toBeNull();

    ann.hangUp();
    const empty = await waitForState(base, (s) => s.sockets === 0 && s.closed.length === 1, 5_000);
    // Still ticking with nobody there: the held rider is coasted.
    const ticking = await waitForState(base, (s) => s.view.tick >= empty.view.tick + 1, 3_000);
    expect(ticking.sockets).toBe(0);
    expect(ticking.view.seats.map((s) => s.state)).toEqual(['held']);

    // The two-second rejoin window closes, the race finishes, and nothing is scheduled.
    const finished = await waitForState(base, (s) => s.view.phase === 'finished', 6_000);
    expect(finished.view.seats.map((s) => s.state)).toEqual(['dnf']);
    expect(finished.alarm).toBeNull();
    expect(finished.nextTickAtMs).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 2_500));
    const later = await stateOf(base);
    expect(later.view.tick).toBe(finished.view.tick);
    expect(later.alarm).toBeNull();
  });
});

describe('a lobby hibernates and is restored — #781 criterion 3', () => {
  it('is evicted by the runtime with its sockets open, and comes back the same room', async () => {
    const base = room('lobby');
    const ann = await hello(base, 'ann');
    const bea = await hello(base, 'bea');
    bea.send(reportText(1, 5_000, 180)); // a report in the lobby, which the replay must reproduce
    await bea.sync();
    ann.hangUp(); // seat 0 leaves, so a newcomer's seat number depends on a faithful replay
    await waitForState(base, (s) => s.closed.length === 1, 5_000);
    const cai = await hello(base, 'cai');
    const before = await stateOf(base);
    expect(before.view.seats.map((s) => [s.riderId, s.athleteId])).toEqual([
      [1, 'bea'],
      [2, 'cai'],
    ]);
    expect(before.alarm).toBeNull();

    // No event and no alarm for longer than the runtime's ten seconds.
    await new Promise((resolve) => setTimeout(resolve, 12_000));

    const after = await stateOf(base);
    expect(after.generation).toBeGreaterThan(before.generation); // a new object: it was evicted
    expect(after.admissions).toBe(0); // the replay did not ask the admission again
    expect(after.sockets).toBe(2); // the runtime kept both sockets open across it
    expect(after.view).toEqual(before.view);

    const dan = await hello(base, 'dan');
    expect(messages(dan)[0]).toMatchObject({ type: 'welcome', riderId: 3 });

    // The sockets opened before the eviction are the ones the race reaches.
    expect((await fetch(`${base}/start`, { method: 'POST' })).status).toBe(200);
    await bea.until((received) => frames(received) >= 1, 5_000);
    await cai.until((received) => frames(received) >= 1, 5_000);
    const frame = messages(bea).find((m) => m.type === 'frame');
    expect(frame).toMatchObject({ type: 'frame', ackSequence: 1 });
    expect(frame?.type === 'frame' ? frame.riders.map((r) => r.riderId) : []).toEqual([1, 2, 3]);
    for (const socket of [bea, cai, dan]) socket.hangUp();
  });
});
