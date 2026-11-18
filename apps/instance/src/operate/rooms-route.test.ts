// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * `GET /v1/operate/rooms` and `POST /v1/operate/rooms/{roomId}/end` (#2612),
 * called sealed through the real listener, as every caller who might try
 * them. The rooms are made through `POST /v1/rooms` as a rider's app makes
 * them; what the room workers hold is a list (`rooms-testing.ts`), so these
 * cases measure the routes, the store and the log. The workers themselves —
 * sockets closed `4005`, a rejoin refused — are `rooms-instance.test.ts`'s.
 * Everything kept is read back: through the routes, and through a second
 * connection to the database file.
 */

import { toHex } from '@onyourleft/domain';
import { afterEach, describe, expect, it } from 'vitest';

import { TEST_ORIGIN } from '../auth/identity-testing.ts';
import { privateSpellings, secretBytes } from '../keys/instance-keys-testing.ts';
import {
  codeOf,
  startModerationWorld,
  type ModerationWorld,
  type Rider,
} from '../moderation/moderation-testing.ts';
import { madeRoom, roomBody } from '../rooms/rooms-testing.ts';
import { openDatabase } from '../store/node-sqlite.ts';
import type { OperatorLogEntry } from '../store/sql-store.ts';
import { roomShortCode } from './operate.ts';
import { fakeRoomRouter, type FakeRoomRouter } from './rooms-testing.ts';

const ROOMS = '/v1/operate/rooms';
const endOf = (roomId: string): string => `/v1/operate/rooms/${roomId}/end`;

interface ShownRoom {
  readonly roomId: string;
  readonly shortCode: string;
  readonly kind: string;
  readonly visibility: string;
  readonly phase: string;
  readonly openedAt: string;
  readonly host: string | null;
  readonly riders: readonly (string | null)[];
  readonly riderCount: number;
}

let opened: ModerationWorld | undefined;
afterEach(async () => {
  await opened?.close();
  opened = undefined;
});

/** A world whose room workers are `router`, or which has no room router at all (`null`). */
async function world(router: FakeRoomRouter | null = fakeRoomRouter()) {
  opened = await startModerationWorld(router === null ? {} : { operateRooms: router });
  return opened;
}

const roomsOf = async (w: ModerationWorld): Promise<readonly ShownRoom[]> => {
  const answer = await w.as(w.owner, 'GET', ROOMS);
  expect(answer.status).toBe(200);
  return (answer.body as { rooms: ShownRoom[] }).rooms;
};

const wholeLog = (w: ModerationWorld): Promise<readonly OperatorLogEntry[]> =>
  w.freshRead((store) => store.listOperatorLogPage(undefined, 200));

const isOpen = async (w: ModerationWorld, roomId: string): Promise<boolean> =>
  (await w.freshRead((store) => store.getPrivateRoom(roomId)))?.closedAt === null;

/** A rider joins `code`'s room, as their app does. */
async function joins(w: ModerationWorld, rider: Rider, code: string): Promise<void> {
  expect((await w.as(rider, 'POST', '/v1/rooms/join', { code })).status).toBe(200);
}

describe('GET /v1/operate/rooms — every open room, and who is in it (#2612)', () => {
  it('lists each room with its kind, phase, host and riders by display name, from the workers', async () => {
    const router = fakeRoomRouter();
    const w = await world(router);
    const ann = await w.rider('Ann');
    const bea = await w.rider('Bea');
    const cal = await w.rider('Cal');
    const race = await madeRoom(w, ann.token);
    await joins(w, bea, race.code);
    w.clock.ms += 60_000;
    const ride = await madeRoom(w, cal.token, { kind: 'group' });
    w.clock.ms += 60_000;
    const lap = await madeRoom(w, cal.token, { loop: true, lapRace: { laps: 3, items: true } });
    router.held.push(
      { roomId: race.roomId, phase: 'countdown', athleteIds: [ann.athleteId, bea.athleteId] },
      { roomId: ride.roomId, phase: 'running', athleteIds: [cal.athleteId] },
    );

    const rooms = await roomsOf(w);
    // Newest first; the lap race nobody has opened is a lobby with nobody in it.
    expect(rooms.map((room) => room.roomId)).toEqual([lap.roomId, ride.roomId, race.roomId]);
    expect(rooms[0]).toMatchObject({
      kind: 'lap-race',
      phase: 'lobby',
      host: 'Cal',
      riders: [],
      riderCount: 0,
    });
    expect(rooms[1]).toMatchObject({
      kind: 'group',
      phase: 'riding',
      host: 'Cal',
      riders: ['Cal'],
      riderCount: 1,
    });
    expect(rooms[2]).toEqual({
      roomId: race.roomId,
      shortCode: race.roomId.slice(0, 6),
      kind: 'race',
      visibility: 'private',
      phase: 'countdown',
      openedAt: new Date(w.clock.ms - 120_000).toISOString().replace(/\.\d{3}Z$/, '.000Z'),
      host: 'Ann',
      riders: ['Ann', 'Bea'],
      riderCount: 2,
    });
  });

  it('carries no place, no rider’s id, no route and no secret the instance holds', async () => {
    const router = fakeRoomRouter();
    const w = await world(router);
    const ann = await w.rider('Ann');
    const race = await madeRoom(w, ann.token);
    router.held.push({ roomId: race.roomId, phase: 'running', athleteIds: [ann.athleteId] });
    const listed = await w.as(w.owner, 'GET', ROOMS);
    const ended = await w.as(w.owner, 'POST', endOf(race.roomId), {
      reason: 'stuck',
      confirm: roomShortCode(race.roomId),
    });
    expect([listed.status, ended.status]).toEqual([200, 200]);
    const privateHalves: string[] = [];
    for (const row of await w.freshRead((store) => store.listInstanceKeys())) {
      privateHalves.push(...(await privateSpellings(row, secretBytes(7), TEST_ORIGIN)));
      privateHalves.push(toHex(row.wrapped), btoa(String.fromCharCode(...row.wrapped)));
    }
    const bodies = JSON.stringify([listed.body, ended.body]);
    for (const marker of [
      ...privateHalves,
      btoa(String.fromCharCode(...secretBytes(7))),
      toHex(secretBytes(7)),
      ann.token,
      w.owner.token,
      w.deputy.token,
      ann.athleteId,
      w.owner.athleteId,
      race.code,
      race.routeSha256,
      // The route's coordinates, which the room relays and never shows.
      '51.5',
      '-0.12',
    ]) {
      expect(bodies).not.toContain(marker);
    }
  });

  it('answers unavailable where the instance has no room router, as on the Durable Object adapter', async () => {
    const w = await world(null);
    const ann = await w.rider('Ann');
    const race = await madeRoom(w, ann.token);
    const listed = await w.as(w.owner, 'GET', ROOMS);
    const ended = await w.as(w.owner, 'POST', endOf(race.roomId), {
      reason: 'other',
      confirm: roomShortCode(race.roomId),
    });
    expect([codeOf(listed.body), codeOf(ended.body)]).toEqual(['unavailable', 'unavailable']);
    expect(await isOpen(w, race.roomId)).toBe(true);
    expect(await wholeLog(w)).toEqual([]);
  });
});

describe('POST /v1/operate/rooms/{roomId}/end — the owner ends a room (#2612)', () => {
  it('ends it by its typed code: closed, its route deleted, logged room_ended, and gone from the list', async () => {
    const router = fakeRoomRouter();
    const w = await world(router);
    const ann = await w.rider('Ann');
    const bea = await w.rider('Bea');
    const race = await madeRoom(w, ann.token);
    await joins(w, bea, race.code);
    const other = await madeRoom(w, bea.token, { gpx: `${String(roomBody().gpx)}<!-- b -->` });
    router.held.push({
      roomId: race.roomId,
      phase: 'running',
      athleteIds: [ann.athleteId, bea.athleteId],
    });
    expect(w.roomRoutes.has(race.routeSha256)).toBe(true);

    const ended = await w.as(w.owner, 'POST', endOf(race.roomId), {
      reason: 'abuse',
      // Typed as the owner might: upper case, with a space.
      confirm: ` ${roomShortCode(race.roomId).toUpperCase()}`,
    });
    expect(ended).toEqual({
      status: 200,
      body: { endedAt: new Date(Math.floor(w.clock.ms / 1000) * 1000).toISOString() },
    });
    // The worker was asked, after the close committed.
    expect(router.ended).toEqual([race.roomId]);
    // Read back: the store, the list, the route's file, a rider's ticket, the log.
    expect(await isOpen(w, race.roomId)).toBe(false);
    expect((await roomsOf(w)).map((room) => room.roomId)).toEqual([other.roomId]);
    expect(w.roomRoutes.has(race.routeSha256)).toBe(false);
    const ticket = await w.as(bea, 'POST', `/v1/rooms/${race.roomId}/ticket`, {
      declaredMassKilograms: 70,
    });
    expect(codeOf(ticket.body)).toBe('not_found');
    const log = (await w.as(w.owner, 'GET', '/v1/operate/log')).body as {
      entries: { action: string; detail: string | null; outcome: string; source: string }[];
    };
    expect(log.entries).toEqual([
      expect.objectContaining({
        action: 'room_ended',
        detail: 'abuse,race,riders=2',
        outcome: 'done',
        source: 'app',
      }),
    ]);
    // The other room is untouched, and a second end finds nothing to end.
    expect(await isOpen(w, other.roomId)).toBe(true);
    const again = await w.as(w.owner, 'POST', endOf(race.roomId), {
      reason: 'abuse',
      confirm: roomShortCode(race.roomId),
    });
    expect(codeOf(again.body)).toBe('not_found');
    expect(await wholeLog(w)).toHaveLength(1);
  });

  it.each([
    ['no confirm', { reason: 'other' }],
    ['the wrong code', { reason: 'other', confirm: 'zzzzzz' }],
    ['another room’s code', { reason: 'other', confirm: 'OTHER' }],
    ['no reason', { confirm: 'CODE' }],
    ['a reason not on the list', { reason: 'because', confirm: 'CODE' }],
    ['a field it does not take', { reason: 'other', confirm: 'CODE', force: true }],
  ])('changes nothing and logs nothing for %s', async (_case, given) => {
    const router = fakeRoomRouter();
    const w = await world(router);
    const ann = await w.rider('Ann');
    const race = await madeRoom(w, ann.token);
    const other = await madeRoom(w, ann.token, { kind: 'group' });
    router.held.push({ roomId: race.roomId, phase: 'running', athleteIds: [ann.athleteId] });
    const body = Object.fromEntries(
      Object.entries(given).map(([key, value]) => [
        key,
        value === 'CODE'
          ? roomShortCode(race.roomId)
          : value === 'OTHER'
            ? roomShortCode(other.roomId)
            : value,
      ]),
    );
    const answer = await w.as(w.owner, 'POST', endOf(race.roomId), body);
    expect(answer.status).toBe(400);
    expect(codeOf(answer.body)).toBe('validation_failed');
    expect(router.asked).toEqual([]);
    expect(await isOpen(w, race.roomId)).toBe(true);
    expect(w.roomRoutes.has(race.routeSha256)).toBe(true);
    expect(await wholeLog(w)).toEqual([]);
  });

  it('ends nothing when its log entry cannot be written: closed and logged, or neither', async () => {
    const router = fakeRoomRouter();
    const w = await world(router);
    const ann = await w.rider('Ann');
    const race = await madeRoom(w, ann.token);
    router.held.push({ roomId: race.roomId, phase: 'running', athleteIds: [ann.athleteId] });
    const database = openDatabase(w.path);
    try {
      database.exec(`create trigger operator_log_refuses_test before insert on operator_log
        begin select raise(abort, 'the log refused this entry'); end`);
    } finally {
      database.close();
    }
    const answer = await w.as(w.owner, 'POST', endOf(race.roomId), {
      reason: 'other',
      confirm: roomShortCode(race.roomId),
    });
    expect(answer.status).toBe(500);
    // No worker was asked to close a socket, and the room is open in the store and the list.
    expect(router.asked).toEqual([race.roomId]);
    expect(router.ended).toEqual([]);
    expect(await isOpen(w, race.roomId)).toBe(true);
    expect((await roomsOf(w)).map((room) => room.roomId)).toEqual([race.roomId]);
  });
});

describe('/v1/operate/rooms — the owner’s, and nobody else’s (#2612)', () => {
  it('answers the deputy and a rider as no route, for a room each is in too — changing nothing', async () => {
    const router = fakeRoomRouter();
    const w = await world(router);
    const ann = await w.rider('Ann');
    const race = await madeRoom(w, ann.token);
    // The deputy joined the room: being in it gives them nothing here.
    await joins(w, w.deputy, race.code);
    router.held.push({
      roomId: race.roomId,
      phase: 'running',
      athleteIds: [ann.athleteId, w.deputy.athleteId],
    });
    const body = { reason: 'other', confirm: roomShortCode(race.roomId) };
    for (const caller of [w.deputy, ann]) {
      for (const [method, path] of [
        ['GET', ROOMS],
        ['POST', endOf(race.roomId)],
      ] as const) {
        const nowhere = await w.as(caller, method, '/v1/no-such-route');
        const answer = await w.as(caller, method, path, method === 'GET' ? undefined : body);
        expect(answer.status).toBe(404);
        expect(codeOf(answer.body)).toBe('not_found');
        expect(answer).toEqual(nowhere);
      }
    }
    expect(router.asked).toEqual([]);
    expect(await isOpen(w, race.roomId)).toBe(true);
    expect(await wholeLog(w)).toEqual([]);
    // The control: the owner reaches both.
    expect((await w.as(w.owner, 'POST', endOf(race.roomId), body)).status).toBe(200);
  });
});
