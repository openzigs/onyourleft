// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The Durable Object adapter (#781) over the faked runtime, in every test run.
 * `room-object.workerd.test.ts` runs the alarm and hibernation cases again
 * under a real `workerd`; `../conformance.test.ts` holds its frames to the
 * reference byte for byte.
 */

import { describe, expect, it } from 'vitest';

import { decodeRoomMessage, encodeMessage } from '@onyourleft/protocol';

import { admitConformance, conformanceSettings, wallClockSettings } from '../conformance-room.ts';
import { CLOSED_BY_ROOM } from '../conformance-testing.ts';
import { helloText, reportText } from '../core/room-testing.ts';
import { roomSettings } from '../core/settings.ts';
import {
  FakeRoomHarness,
  FakeSocket,
  hangUp,
  MAXIMUM_KEYS_PER_STORAGE_CALL,
  openSocket,
  START,
  UPGRADE,
} from './fake-runtime-testing.ts';
import { connectionOf, LOBBY_LOG_LIMIT, LOBBY_LOG_PREFIX } from './room-object.ts';

/** Fires the alarm the adapter set, at the time it asked for, as the platform does. */
async function fireAlarm(harness: FakeRoomHarness): Promise<number> {
  const at = harness.ctx.storage.alarm;
  if (at === null) throw new Error('no alarm is set');
  harness.ctx.storage.alarm = null;
  harness.nowMs = at;
  await harness.room.alarm();
  return at;
}

function types(socket: FakeSocket): string[] {
  return socket.sent.map((text) => {
    if (text === CLOSED_BY_ROOM) return 'closed';
    const decoded = decodeRoomMessage(text);
    return decoded.ok ? decoded.message.type : 'undecodable';
  });
}

async function hello(harness: FakeRoomHarness, athlete: string): Promise<FakeSocket> {
  const socket = await openSocket(harness.room);
  await harness.room.webSocketMessage(socket, helloText(`ticket-${athlete}`));
  return socket;
}

describe('sockets — the Hibernation API and the attachment', () => {
  it('accepts every socket through the Hibernation API, numbering connections from 1 in its attachment', async () => {
    const harness = new FakeRoomHarness(conformanceSettings(), admitConformance, false);
    const first = await openSocket(harness.room);
    const second = await openSocket(harness.room);
    expect([connectionOf(first), connectionOf(second)]).toEqual([1, 2]);
    expect(harness.ctx.getWebSockets()).toEqual([first, second]);
  });

  it('answers 404 for anything but an upgrade or a start', async () => {
    const harness = new FakeRoomHarness(conformanceSettings(), admitConformance, false);
    expect(await harness.room.fetch({ ...UPGRADE, headers: { get: () => null } })).toEqual({
      status: 404,
      text: 'not found',
    });
    expect(await harness.room.fetch({ ...START, method: 'GET' })).toMatchObject({ status: 404 });
    expect(await harness.room.fetch(START)).toMatchObject({ status: 200 });
  });

  it('drops a binary frame, and closes a socket it has no connection for', async () => {
    const harness = new FakeRoomHarness(conformanceSettings(), admitConformance, false);
    const socket = await hello(harness, 'ann');
    await harness.room.webSocketMessage(socket, new ArrayBuffer(8));
    expect(types(socket)).toEqual(['welcome']);
    const stranger = new FakeSocket();
    await harness.room.webSocketMessage(stranger, helloText('ticket-bea'));
    expect(stranger.closedByObject).toBe(true);
    expect((await harness.room.view()).seats).toHaveLength(1);
  });

  it('asks the admission once per hello and never for a report — no round trip per message', async () => {
    const harness = new FakeRoomHarness(
      roomSettings({ ...conformanceSettings(), countdownMs: 0 }),
      admitConformance,
      false,
    );
    const socket = await hello(harness, 'ann');
    await harness.room.fetch(START);
    for (let second = 1; second <= 60; second += 1) {
      harness.nowMs = second * 1000 - 500;
      await harness.room.webSocketMessage(socket, reportText(second, harness.nowMs, 250));
      await fireAlarm(harness);
    }
    expect((await harness.room.view()).tick).toBe(60);
    expect(harness.admissions).toBe(1);
  });
});

describe('the tick is an alarm, and it stops — #781 criterion 2', () => {
  it('ticks on with nobody connected until the rejoin window closes, then sets no further alarm', async () => {
    const settings = wallClockSettings(); // a one-second countdown, a two-second rejoin window
    const harness = new FakeRoomHarness(settings, admitConformance, false);
    const ann = await hello(harness, 'ann');
    await harness.room.fetch(START);
    expect(harness.ctx.storage.alarm).toBe(settings.frameIntervalMs);
    await fireAlarm(harness); // the countdown ends, and tick 1
    await fireAlarm(harness); // tick 2
    expect((await harness.room.view()).phase).toBe('running');

    await hangUp(harness.room, ann);
    expect(harness.ctx.getWebSockets()).toEqual([]);
    const ticksWhileEmpty: number[] = [];
    while (harness.ctx.storage.alarm !== null && ticksWhileEmpty.length < 100) {
      await fireAlarm(harness);
      ticksWhileEmpty.push((await harness.room.view()).tick);
    }
    // The room kept simulating the held rider, coasting, for the rejoin window…
    expect(ticksWhileEmpty.length).toBeGreaterThanOrEqual(2);
    // …and then finished the race and asked for nothing more.
    const view = await harness.room.view();
    expect(view.phase).toBe('finished');
    expect(view.seats.map((s) => s.state)).toEqual(['dnf']);
    expect(harness.ctx.storage.alarm).toBeNull();
    expect(ticksWhileEmpty.length).toBeLessThanOrEqual(
      settings.rejoinWindowMs / settings.frameIntervalMs + 2,
    );
    expect(await harness.room.nextTickAtMs()).toBeUndefined();
  });

  it('closes an emptied group ride and stops asking for alarms', async () => {
    const settings = roomSettings({
      ...wallClockSettings(),
      kind: 'ride',
      emptyGraceMs: 3_000,
    });
    const harness = new FakeRoomHarness(settings, admitConformance, false);
    const ann = await hello(harness, 'ann'); // a ride starts itself on its first rider
    expect(harness.ctx.storage.alarm).not.toBeNull();
    await fireAlarm(harness);
    await hangUp(harness.room, ann);
    let fired = 0;
    while (harness.ctx.storage.alarm !== null && fired < 100) {
      await fireAlarm(harness);
      fired += 1;
    }
    expect((await harness.room.view()).phase).toBe('closed');
    expect(fired).toBeLessThanOrEqual(5);
  });

  it('keeps its cadence from the alarm it asked for, and does not try to catch up after a late one', async () => {
    const harness = new FakeRoomHarness(wallClockSettings(), admitConformance, false);
    await hello(harness, 'ann');
    await harness.room.fetch(START);
    const storage = harness.ctx.storage;
    // On time, or a little late: the next is a frame after the one asked for.
    storage.alarm = null;
    harness.nowMs = 1_120;
    await harness.room.alarm();
    expect(storage.alarm).toBe(2_000);
    // More than a frame late: a frame from now.
    storage.alarm = null;
    harness.nowMs = 7_300;
    await harness.room.alarm();
    expect(storage.alarm).toBe(8_300);
  });

  it('sets no alarm for a lobby, so a lobby can hibernate', async () => {
    const harness = new FakeRoomHarness(conformanceSettings(), admitConformance, false);
    await hello(harness, 'ann');
    await hello(harness, 'bea');
    expect(harness.ctx.storage.alarmsSet).toEqual([]);
  });
});

describe('a lobby survives eviction — #781 criterion 3', () => {
  async function busyLobby() {
    const harness = new FakeRoomHarness(conformanceSettings(), admitConformance, false);
    harness.nowMs = 100;
    const ann = await hello(harness, 'ann');
    const bea = await hello(harness, 'bea');
    harness.nowMs = 200;
    await harness.room.webSocketMessage(bea, reportText(1, 5_000, 180)); // a report in the lobby
    await hangUp(harness.room, ann); // rider 0 leaves the lobby, so the seat numbers have a gap
    const cai = await hello(harness, 'cai');
    const forger = await openSocket(harness.room);
    await harness.room.webSocketMessage(forger, helloText('forged'));
    return { harness, bea, cai };
  }

  it('restores the same room from the lobby log and the sockets’ attachments', async () => {
    const { harness, bea, cai } = await busyLobby();
    const before = await harness.room.view();
    expect(before.seats.map((s) => [s.riderId, s.athleteId])).toEqual([
      [1, 'bea'],
      [2, 'cai'],
    ]);

    const restored = harness.evict();
    expect(await restored.view()).toEqual(before);

    // A newcomer gets the NEXT seat number, which only a faithful replay knows.
    const dan = await hello(harness, 'dan');
    expect(decodeRoomMessage(dan.sent[0] ?? '')).toMatchObject({
      ok: true,
      message: { type: 'welcome', riderId: 3 },
    });
    // The sockets that were open before the eviction are the ones the race is sent to.
    await harness.room.fetch(START);
    while ((await harness.room.view()).tick === 0) await fireAlarm(harness);
    const frame = decodeRoomMessage(bea.sent.at(-1) ?? '');
    expect(frame).toMatchObject({ ok: true, message: { type: 'frame', ackSequence: 1 } });
    expect(types(cai).at(-1)).toBe('frame');
    expect(frame.ok && frame.message.type === 'frame' && frame.message.riders.length).toBe(3);
  });

  it('replays the admission’s answers rather than asking again', async () => {
    const { harness } = await busyLobby();
    const asked = harness.admissions;
    harness.evict();
    await harness.room.view();
    expect(harness.admissions).toBe(asked);
  });

  it('keeps the connection counter across the eviction, so no two sockets share a number', async () => {
    const { harness } = await busyLobby();
    const opened = harness.ctx.getWebSockets().length;
    expect(opened).toBe(2);
    harness.evict();
    expect(connectionOf(await openSocket(harness.room))).toBe(5);
  });

  it('deletes the log when the room leaves the lobby, and refuses to reopen a lost race as a lobby', async () => {
    const { harness, bea, cai } = await busyLobby();
    await harness.room.fetch(START);
    expect(harness.ctx.storage.keys().filter((k) => k.startsWith(LOBBY_LOG_PREFIX))).toEqual([]);
    expect(harness.ctx.storage.alarm).not.toBeNull();

    harness.evict(); // a restart mid-race: the platform may do this, and the core is gone
    expect((await harness.room.view()).seats).toEqual([]);
    expect(types(bea).slice(-2)).toEqual(['refuse', 'closed']);
    expect(decodeRoomMessage(bea.sent.at(-2) ?? '')).toEqual({
      ok: true,
      message: { type: 'refuse', reason: 'room-closed' },
    });
    expect(cai.closedByObject).toBe(true);
    expect(harness.ctx.storage.alarm).toBeNull();
    expect(await harness.room.fetch(UPGRADE)).toMatchObject({ status: 410 });
    expect(await harness.room.fetch(START)).toMatchObject({ status: 410 });
  });

  it('does not read a room it has left the lobby of as an empty lobby after a later eviction', async () => {
    const { harness } = await busyLobby();
    await harness.room.fetch(START);
    harness.evict();
    harness.evict();
    const late = new FakeSocket();
    late.serializeAttachment({ connection: 9 });
    await harness.room.webSocketMessage(late, helloText('ticket-eve'));
    expect(types(late)).toEqual(['refuse', 'closed']);
  });

  it('closes a socket in a lost room even when sending it the refusal throws', async () => {
    const { harness } = await busyLobby();
    await harness.room.fetch(START);
    harness.evict();
    class Throwing extends FakeSocket {
      override send(): void {
        throw new Error('the socket is going');
      }
    }
    const late = new Throwing();
    late.serializeAttachment({ connection: 9 });
    await expect(
      harness.room.webSocketMessage(late, helloText('ticket-eve')),
    ).resolves.toBeUndefined();
    expect(late.closedByObject).toBe(true);
  });
});

describe('what the lobby log records', () => {
  it('writes every call the core is made in the lobby — a start and a tick that leave it a lobby included — and replays them', async () => {
    const settings = roomSettings({ ...conformanceSettings(), kind: 'ride' });
    const harness = new FakeRoomHarness(settings, admitConformance, false);
    await harness.room.fetch(START); // a group ride starts itself: in its lobby this is a no-op
    harness.nowMs = 1_000;
    await harness.room.alarm(); // nothing asked for it, and a lobby does not tick
    const log = await harness.ctx.storage.list<{ op: string }>({ prefix: LOBBY_LOG_PREFIX });
    expect([...log.values()].map((event) => event.op)).toEqual(['start', 'tick']);
    harness.evict();
    expect(await harness.room.view()).toEqual({
      phase: 'lobby',
      tick: 0,
      seats: [],
      finishOrder: [],
    });
  });

  it('reads a socket that errored as a socket that closed', async () => {
    const harness = new FakeRoomHarness(conformanceSettings(), admitConformance, false);
    const ann = await hello(harness, 'ann');
    ann.closedByClient = true;
    await harness.room.webSocketError(ann);
    expect((await harness.room.view()).seats).toEqual([]);
  });
});

describe('the lobby log is bounded', () => {
  it(`takes no new socket, and closes a sender, once ${String(LOBBY_LOG_LIMIT)} calls are written`, async () => {
    const harness = new FakeRoomHarness(conformanceSettings(), admitConformance, false);
    const ann = await hello(harness, 'ann');
    for (let sequence = 1; sequence < LOBBY_LOG_LIMIT; sequence += 1) {
      await harness.room.webSocketMessage(ann, reportText(sequence, sequence, 100));
    }
    expect(harness.ctx.storage.keys().filter((k) => k.startsWith(LOBBY_LOG_PREFIX))).toHaveLength(
      LOBBY_LOG_LIMIT,
    );
    expect(await harness.room.fetch(UPGRADE)).toMatchObject({ status: 503 });
    await harness.room.webSocketMessage(ann, reportText(LOBBY_LOG_LIMIT, LOBBY_LOG_LIMIT, 100));
    expect(ann.closedByObject).toBe(true);
    // Its leaving is written past the limit, so a restore does not seat a rider who is gone.
    expect((await harness.room.view()).seats).toEqual([]);
    harness.evict();
    expect((await harness.room.view()).seats).toEqual([]);
  });

  it(`starts a lobby whose log is longer than one storage call's ${String(MAXIMUM_KEYS_PER_STORAGE_CALL)} keys, and deletes all of it — #781's review`, async () => {
    const harness = new FakeRoomHarness(conformanceSettings(), admitConformance, false);
    const ann = await hello(harness, 'ann');
    const entries = 2 * MAXIMUM_KEYS_PER_STORAGE_CALL + 1;
    for (let sequence = 1; sequence < entries; sequence += 1) {
      await harness.room.webSocketMessage(ann, reportText(sequence, sequence, 100));
    }
    const lobbyKeys = () =>
      harness.ctx.storage.keys().filter((k) => k.startsWith(LOBBY_LOG_PREFIX));
    expect(lobbyKeys()).toHaveLength(entries);

    expect(await harness.room.fetch(START)).toMatchObject({ status: 200 });
    // The race ticks: an alarm is set, and the log is gone in full.
    expect(harness.ctx.storage.alarm).not.toBeNull();
    expect(lobbyKeys()).toEqual([]);
    harness.evict(); // the marker was written after the deletes: a restart reads the race as lost
    expect((await harness.room.view()).seats).toEqual([]);
    expect(types(ann).slice(-2)).toEqual(['refuse', 'closed']);
  });
});

describe('what the adapter sends is what the core said, encoded', () => {
  it('sends a refusal and closes, for a ticket the admission does not accept', async () => {
    const harness = new FakeRoomHarness(conformanceSettings(), admitConformance, false);
    const socket = await openSocket(harness.room);
    await harness.room.webSocketMessage(socket, helloText('forged'));
    expect(socket.sent).toEqual([
      encodeMessage({ type: 'refuse', reason: 'ticket-refused' }),
      CLOSED_BY_ROOM,
    ]);
  });

  it('fans a frame out to the rest of the room when one socket throws on send', async () => {
    const harness = new FakeRoomHarness(
      roomSettings({ ...conformanceSettings(), countdownMs: 0 }),
      admitConformance,
      false,
    );
    const ann = await hello(harness, 'ann');
    const bea = await hello(harness, 'bea');
    await harness.room.fetch(START);
    ann.closedByClient = true; // gone, and the platform has not said so yet
    await fireAlarm(harness);
    expect(types(bea).at(-1)).toBe('frame');
  });
});
