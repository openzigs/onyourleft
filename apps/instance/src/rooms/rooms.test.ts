// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A rider's room through the real handler and listener (#784, #785): making
 * one, joining by its code, its route, a ticket into it, its end, and a race's
 * result — each read back as a real client would, and a stranger refused.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { PHYSICS_VERSION } from '@onyourleft/physics';

import {
  startIdentityInstance,
  testDevice,
  type IdentityInstance,
} from '../auth/identity-testing.ts';
import { createRoom } from '../room/core/room.ts';
import { roomSettings } from '../room/core/settings.ts';
import { helloText, reportText } from '../room/core/room-testing.ts';
import { finalResults } from '../room/node/room-host.ts';
import { sha256Hex } from '../blob/blob-store.ts';
import {
  DEFAULT_ROOM_LIMITS,
  MAXIMUM_OPEN_ROOMS_PER_ATHLETE,
  UNRIDDEN_ROOM_LIFETIME_MS,
} from './rooms.ts';
import { erasedAccount, madeRoom, riderIn, ROOM_GPX, roomBody } from './rooms-testing.ts';
import { normaliseRoomCode } from './code.ts';

let world: IdentityInstance | undefined;
afterEach(async () => {
  await world?.close();
  world = undefined;
});

async function open(options: Parameters<typeof startIdentityInstance>[0] = {}) {
  world = await startIdentityInstance(options);
  return world;
}

const rider = async (w: IdentityInstance) => riderIn(w, await testDevice());

describe('making a room — #784', () => {
  it('makes a PRIVATE room on the rider’s route, with a code, the rider a member of it', async () => {
    const w = await open();
    const anna = await rider(w);
    const room = await madeRoom(w, anna.token);
    expect(normaliseRoomCode(room.code)).toBeDefined();
    expect(room.code).toMatch(/^[0-9A-Z]{5}-[0-9A-Z]{5}-[0-9A-Z]{5}$/);
    expect(room.routeSha256).toBe(await sha256Hex(new TextEncoder().encode(ROOM_GPX)));
    await w.freshRead(async (store) => {
      expect((await store.getRoom(room.roomId))?.visibility).toBe('private');
      expect(await store.isRoomMember(room.roomId, anna.athleteId)).toBe(true);
      expect((await store.getRoomCourse(room.roomId))?.countdownMs).toBeNull();
    });
    expect(w.roomRoutes.has(room.routeSha256)).toBe(true);
  });

  it('has no way to make a room public: a body naming a visibility is refused whole, and nothing is made', async () => {
    const w = await open();
    const anna = await rider(w);
    const answer = await w.call('POST', '/v1/rooms', {
      token: anna.token,
      body: roomBody({ visibility: 'public' }),
    });
    expect(answer.status).toBe(400);
    expect(JSON.stringify(answer.body)).toContain('visibility');
    expect(w.roomRoutes.size).toBe(0);
  });

  it('refuses a course it cannot ride, naming the field and never the route', async () => {
    const w = await open();
    const anna = await rider(w);
    for (const [body, field] of [
      [roomBody({ kind: 'league' }), 'kind'],
      [roomBody({ grades: [[5, 0]] }), 'grades'],
      [
        roomBody({
          grades: [
            [0, 0],
            [0, 1],
          ],
        }),
        'grades',
      ],
      [roomBody({ grades: [[0, 90]] }), 'grades'],
      [roomBody({ lengthMetres: -1 }), 'lengthMetres'],
      [roomBody({ gpx: '' }), 'gpx'],
    ] as const) {
      const answer = await w.call('POST', '/v1/rooms', { token: anna.token, body });
      expect(answer.status, field).toBe(400);
      expect(
        (answer.body as { error: { fields: { field: string }[] } }).error.fields[0]?.field,
      ).toBe(field);
      expect(JSON.stringify(answer.body)).not.toContain('51.5');
    }
  });

  it('makes a group ride that starts on its first rider, and a race that counts down', async () => {
    const w = await open();
    const anna = await rider(w);
    const ride = await madeRoom(w, anna.token, { kind: 'group' });
    await w.freshRead(async (store) => {
      expect((await store.getRoom(ride.roomId))?.kind).toBe('group');
      expect((await store.getRoomCourse(ride.roomId))?.countdownMs).toBe(0);
      expect((await store.getRoom(ride.roomId))?.physicsVersion).toBe(PHYSICS_VERSION);
    });
  });
});

describe('what one athlete may hold open — #784', () => {
  it('refuses a sixth room that is not over, and makes one again once one is over', async () => {
    const w = await open();
    const anna = await rider(w);
    const made = [];
    for (let i = 0; i < MAXIMUM_OPEN_ROOMS_PER_ATHLETE; i += 1) {
      made.push(await madeRoom(w, anna.token, { lengthMetres: 100 + i }));
    }
    const sixth = await w.call('POST', '/v1/rooms', { token: anna.token, body: roomBody() });
    expect(sixth.status).toBe(429);
    // Another athlete is not held to Anna's rooms.
    const bea = await rider(w);
    expect((await w.call('POST', '/v1/rooms', { token: bea.token, body: roomBody() })).status).toBe(
      200,
    );
    await w.rooms.roomLetGo(made[0]?.roomId ?? '', 'finished');
    expect(
      (await w.call('POST', '/v1/rooms', { token: anna.token, body: roomBody() })).status,
    ).toBe(200);
  });
});

describe('the room code is a bearer secret — #784', () => {
  it('is never stored, never logged, and never in an error — create, join and a wrong join', async () => {
    const w = await open();
    const anna = await rider(w);
    const room = await madeRoom(w, anna.token);
    const bea = await rider(w);
    expect(
      (await w.call('POST', '/v1/rooms/join', { token: bea.token, body: { code: room.code } }))
        .status,
    ).toBe(200);
    const wrong = `${room.code.slice(0, -1)}${room.code.endsWith('0') ? '1' : '0'}`;
    const refused = await w.call('POST', '/v1/rooms/join', {
      token: bea.token,
      body: { code: wrong },
    });
    expect(refused.status).toBe(404);
    const canonical = normaliseRoomCode(room.code) as string;
    for (const secret of [room.code, canonical, wrong, normaliseRoomCode(wrong) as string]) {
      expect(JSON.stringify(refused.body)).not.toContain(secret);
      for (const line of w.instance.lines) expect(line).not.toContain(secret);
      expect(await w.databaseBytes()).not.toContain(secret);
    }
    // The log did see the requests: a check over no lines would pass anything.
    expect(w.instance.lines.filter((line) => line.includes('/v1/rooms/join')).length).toBe(2);
  });

  it('answers a wrong code, a code nobody made and garbage alike', async () => {
    const w = await open();
    const bea = await rider(w);
    const answers = await Promise.all(
      ['00000-00000-00000', 'not a code', 12].map((code) =>
        w.call('POST', '/v1/rooms/join', { token: bea.token, body: { code } }),
      ),
    );
    expect(new Set(answers.map((answer) => JSON.stringify(answer)))).toHaveProperty('size', 1);
    expect(answers[0]?.status).toBe(404);
  });

  it('limits tries per athlete, right or wrong: past ten, even the right code is refused', async () => {
    const w = await open();
    const anna = await rider(w);
    const room = await madeRoom(w, anna.token);
    const guesser = await rider(w);
    const { limit } = DEFAULT_ROOM_LIMITS.joinsPerAthlete;
    for (let i = 0; i < limit; i += 1) {
      const answer = await w.call('POST', '/v1/rooms/join', {
        token: guesser.token,
        body: { code: '00000-00000-00000' },
      });
      expect(answer.status).toBe(404);
    }
    const late = await w.call('POST', '/v1/rooms/join', {
      token: guesser.token,
      body: { code: room.code },
    });
    expect(late.status).toBe(429);
    await w.freshRead(async (store) => {
      expect(await store.isRoomMember(room.roomId, guesser.athleteId)).toBe(false);
    });
    // Another athlete is not limited by the guesser's tries.
    const bea = await rider(w);
    expect(
      (await w.call('POST', '/v1/rooms/join', { token: bea.token, body: { code: room.code } }))
        .status,
    ).toBe(200);
    // And the window ends: a quarter of an hour on, the guesser may try again.
    w.clock.ms += DEFAULT_ROOM_LIMITS.joinsPerAthlete.windowMs;
    expect(
      (await w.call('POST', '/v1/rooms/join', { token: guesser.token, body: { code: room.code } }))
        .status,
    ).toBe(200);
  });

  it('limits tries per address too, whoever is signed in there', async () => {
    const w = await open({
      roomLimits: { ...DEFAULT_ROOM_LIMITS, joinsPerAddress: { limit: 3, windowMs: 60_000 } },
    });
    const anna = await rider(w);
    const room = await madeRoom(w, anna.token);
    for (let i = 0; i < 3; i += 1) {
      const fresh = await rider(w);
      await w.call('POST', '/v1/rooms/join', { token: fresh.token, body: { code: '0' } });
    }
    const fourth = await rider(w);
    expect(
      (await w.call('POST', '/v1/rooms/join', { token: fourth.token, body: { code: room.code } }))
        .status,
    ).toBe(429);
    // Every key — an address among them — is forgotten when its window ends,
    // without anybody asking: the privacy policy's "at most an hour" (#892).
    expect(w.rooms.heldRateLimitKeys()).toBeGreaterThan(0);
    w.clock.ms += DEFAULT_ROOM_LIMITS.createsPerAthlete.windowMs;
    w.rooms.sweepRateLimits();
    expect(w.rooms.heldRateLimitKeys()).toBe(0);
  });
});

describe('who may enter a rider’s room — #784', () => {
  it('tickets its creator and whoever joined by its code, and nobody else', async () => {
    const w = await open();
    const anna = await rider(w);
    const room = await madeRoom(w, anna.token);
    const bea = await rider(w);
    const stranger = await rider(w);
    await w.call('POST', '/v1/rooms/join', { token: bea.token, body: { code: room.code } });
    const ticket = (token: string) =>
      w.call('POST', `/v1/rooms/${room.roomId}/ticket`, {
        token,
        body: { declaredMassKilograms: 70 },
      });
    expect((await ticket(anna.token)).status).toBe(200);
    expect((await ticket(bea.token)).status).toBe(200);
    // A stranger who knows the room's id — it is in every socket's path — is
    // told what a room that does not exist tells them.
    expect(await ticket(stranger.token)).toEqual(
      await w.call('POST', '/v1/rooms/nope/ticket', {
        token: stranger.token,
        body: { declaredMassKilograms: 70 },
      }),
    );
    expect((await ticket(stranger.token)).status).toBe(404);
  });

  it('hands the route to its members, byte for byte as sent, and to nobody else', async () => {
    const w = await open();
    const anna = await rider(w);
    const room = await madeRoom(w, anna.token);
    const bea = await rider(w);
    const stranger = await rider(w);
    await w.call('POST', '/v1/rooms/join', { token: bea.token, body: { code: room.code } });
    const got = await w.call('GET', `/v1/rooms/${room.roomId}/route`, { token: bea.token });
    expect(got.status).toBe(200);
    expect(got.body).toEqual({ sha256: room.routeSha256, gpx: ROOM_GPX });
    expect(
      (await w.call('GET', `/v1/rooms/${room.roomId}/route`, { token: stranger.token })).status,
    ).toBe(404);
  });
});

describe('a room that is over lets its route go — #784', () => {
  it('deletes the route once the room is over, and closes the room to everybody', async () => {
    const w = await open();
    const anna = await rider(w);
    const room = await madeRoom(w, anna.token, { kind: 'group' });
    // A lobby that only emptied is not over: a later socket opens it again.
    await w.rooms.roomLetGo(room.roomId, 'lobby');
    expect(w.roomRoutes.has(room.routeSha256)).toBe(true);
    // Past its empty grace, a group ride is over.
    await w.rooms.roomLetGo(room.roomId, 'closed');
    expect(w.roomRoutes.has(room.routeSha256)).toBe(false);
    expect(
      (await w.call('GET', `/v1/rooms/${room.roomId}/route`, { token: anna.token })).status,
    ).toBe(404);
    expect(
      (
        await w.call('POST', `/v1/rooms/${room.roomId}/ticket`, {
          token: anna.token,
          body: { declaredMassKilograms: 70 },
        })
      ).status,
    ).toBe(404);
    const bea = await rider(w);
    expect(
      (await w.call('POST', '/v1/rooms/join', { token: bea.token, body: { code: room.code } }))
        .status,
    ).toBe(404);
  });

  it('keeps a route another open room still rides', async () => {
    const w = await open();
    const anna = await rider(w);
    const first = await madeRoom(w, anna.token);
    const second = await madeRoom(w, anna.token);
    expect(second.routeSha256).toBe(first.routeSha256);
    await w.rooms.roomLetGo(first.roomId, 'finished');
    expect(w.roomRoutes.has(first.routeSha256)).toBe(true);
    await w.rooms.roomLetGo(second.roomId, 'finished');
    expect(w.roomRoutes.has(first.routeSha256)).toBe(false);
  });
});

describe('a room whose creator erases their account is over — #784', () => {
  it('ends every room they made — its route gone, nobody let in — and leaves the other athletes’ rooms as they were', async () => {
    const w = await open();
    const [anna, bea, cat, dan] = [await rider(w), await rider(w), await rider(w), await rider(w)];
    // Anna's own route, and a second room of hers on the route Cat's room rides.
    const annasOwn = await madeRoom(w, anna.token, {
      kind: 'group',
      gpx: ROOM_GPX.replace('51.502000', '51.503000'),
    });
    const annasShared = await madeRoom(w, anna.token);
    const cats = await madeRoom(w, cat.token);
    expect(cats.routeSha256).toBe(annasShared.routeSha256);
    for (const code of [annasOwn.code, cats.code]) {
      await w.call('POST', '/v1/rooms/join', { token: bea.token, body: { code } });
    }

    expect((await erasedAccount(w, anna)).status).toBe(204);

    // Anna's rooms are over: her own route is deleted from the instance…
    expect(w.roomRoutes.has(annasOwn.routeSha256)).toBe(false);
    await w.freshRead(async (store) => {
      expect((await store.getPrivateRoom(annasOwn.roomId))?.closedAt).not.toBeNull();
      expect((await store.getPrivateRoom(annasShared.roomId))?.closedAt).not.toBeNull();
      expect((await store.getPrivateRoom(cats.roomId))?.closedAt).toBeNull();
    });
    // …a member who joined it is not handed it, nor a ticket into it…
    expect(
      (await w.call('GET', `/v1/rooms/${annasOwn.roomId}/route`, { token: bea.token })).status,
    ).toBe(404);
    expect(
      (
        await w.call('POST', `/v1/rooms/${annasOwn.roomId}/ticket`, {
          token: bea.token,
          body: { declaredMassKilograms: 70 },
        })
      ).status,
    ).toBe(404);
    // …and nobody new joins it by its code.
    expect(
      (await w.call('POST', '/v1/rooms/join', { token: dan.token, body: { code: annasOwn.code } }))
        .status,
    ).toBe(404);

    // Cat's room is untouched: the route it shares with Anna's second room stays,
    // its member is handed it, and a new rider still joins it.
    expect(w.roomRoutes.has(cats.routeSha256)).toBe(true);
    const got = await w.call('GET', `/v1/rooms/${cats.roomId}/route`, { token: bea.token });
    expect(got.status).toBe(200);
    expect(got.body).toEqual({ sha256: cats.routeSha256, gpx: ROOM_GPX });
    expect(
      (await w.call('POST', '/v1/rooms/join', { token: dan.token, body: { code: cats.code } }))
        .status,
    ).toBe(200);
  });

  it('refuses the erasure without its step-up, and ends none of their rooms then', async () => {
    const w = await open();
    const anna = await rider(w);
    const room = await madeRoom(w, anna.token);
    expect(
      (await w.call('DELETE', '/v1/account', { token: anna.token, body: {} })).status,
    ).not.toBe(204);
    expect(w.roomRoutes.has(room.routeSha256)).toBe(true);
    await w.freshRead(async (store) => {
      expect((await store.getPrivateRoom(room.roomId))?.closedAt).toBeNull();
    });
  });
});

describe('a room nobody rides is over within a day — #784', () => {
  const nobodyIn = (): boolean => false;

  it('ends a room nobody is riding a day after it was made, whether or not anybody joined it, and lets its route go', async () => {
    const w = await open();
    const anna = await rider(w);
    const bea = await rider(w);
    const never = await madeRoom(w, anna.token, { kind: 'group' });
    const joined = await madeRoom(w, anna.token, {
      gpx: ROOM_GPX.replace('51.502000', '51.504000'),
    });
    await w.call('POST', '/v1/rooms/join', { token: bea.token, body: { code: joined.code } });
    w.clock.ms += UNRIDDEN_ROOM_LIFETIME_MS - 1000;
    expect(await w.rooms.sweep(nobodyIn)).toBe(0);
    expect(w.roomRoutes.has(never.routeSha256)).toBe(true);
    w.clock.ms += 1000;
    expect(await w.rooms.sweep(nobodyIn)).toBe(2);
    expect(w.roomRoutes.has(never.routeSha256)).toBe(false);
    expect(w.roomRoutes.has(joined.routeSha256)).toBe(false);
    expect(
      (await w.call('POST', '/v1/rooms/join', { token: bea.token, body: { code: never.code } }))
        .status,
    ).toBe(404);
    // Over counts against nobody's five any more.
    await w.freshRead(async (store) => {
      expect(await store.countOpenPrivateRoomsMadeBy(anna.athleteId)).toBe(0);
    });
    // And a second sweep has nothing left to end.
    expect(await w.rooms.sweep(nobodyIn)).toBe(0);
  });

  it('does not end a room somebody is riding at that moment', async () => {
    const w = await open();
    const anna = await rider(w);
    const room = await madeRoom(w, anna.token, { kind: 'group' });
    w.clock.ms += 2 * UNRIDDEN_ROOM_LIFETIME_MS;
    expect(await w.rooms.sweep((roomId) => roomId === room.roomId)).toBe(0);
    expect(w.roomRoutes.has(room.routeSha256)).toBe(true);
  });

  it('ends at once a race that had started and that no worker holds — a restart interrupted it', async () => {
    const w = await open();
    const anna = await rider(w);
    const started = await madeRoom(w, anna.token);
    const waiting = await madeRoom(w, anna.token, {
      gpx: ROOM_GPX.replace('51.502000', '51.505000'),
    });
    await w.freshRead((store) => store.markRaceStarted(started.roomId, 1_790_000_010));
    expect(await w.rooms.sweep(nobodyIn)).toBe(1);
    await w.freshRead(async (store) => {
      expect((await store.getPrivateRoom(started.roomId))?.closedAt).not.toBeNull();
      // A lobby nobody has started opens again, and is kept until its day is up.
      expect((await store.getPrivateRoom(waiting.roomId))?.closedAt).toBeNull();
      expect(await store.countOpenPrivateRoomsMadeBy(anna.athleteId)).toBe(1);
    });
    expect(w.roomRoutes.has(waiting.routeSha256)).toBe(true);
  });

  it('ends a room whose creator is gone however they went', async () => {
    const w = await open();
    const anna = await rider(w);
    const room = await madeRoom(w, anna.token, { kind: 'group' });
    await w.freshRead((store) => store.eraseAthlete(anna.athleteId));
    expect(await w.rooms.sweep(nobodyIn)).toBe(1);
    expect(w.roomRoutes.has(room.routeSha256)).toBe(false);
  });
});

/**
 * A race ridden through the room core, its final results stored as the Node
 * adapter stores them (`room-host.ts` §`finalResults`).
 */
async function ridden(
  w: IdentityInstance,
  roomId: string,
  riders: readonly { readonly athleteId: string; readonly watts: number }[],
): Promise<void> {
  const byTicket = new Map(
    riders.map((each, index) => [`ticket-${String(index)}`, each.athleteId]),
  );
  const room = createRoom(
    roomSettings({
      kind: 'race',
      ridingPosition: 'hoods',
      course: { sha256: 'a'.repeat(64), lengthMetres: 20_000, gradePercentAt: () => 0 },
      countdownMs: 0,
    }),
    (ticket) => {
      const athleteId = byTicket.get(ticket);
      return athleteId === undefined ? undefined : { athleteId, declaredMassKilograms: 70 };
    },
  );
  riders.forEach((_, index) => room.receive(index + 1, helloText(`ticket-${String(index)}`), 0));
  room.start(0);
  for (let t = 0; room.view().phase !== 'finished'; t += 1) {
    riders.forEach((each, index) => {
      room.receive(index + 1, reportText(t, t * 1000 + 500, each.watts), t * 1000 + 500);
    });
    room.tick((t + 1) * 1000);
    if (t > 4 * 3600) throw new Error('the race never finished');
  }
  await w.freshRead(async (store) => {
    for (const result of finalResults(room.view(), 1000)) {
      await store.putResult({ roomId, ...result });
    }
    // The room said it was over, as the Node adapter's `onRaceFinished` records.
    await store.markRaceFinished(roomId, 1_790_000_100);
  });
}

type Rows = {
  rows: {
    place: number | null;
    displayName: string | null;
    you: boolean;
    wattsPerKilogram: number | null;
    flags: { durationSeconds: number; overWattsPerKilogram: number }[];
  }[];
};

describe('a race’s result — #785', () => {
  it('shows every rider, in all three riders’ results, the flag one of them raised over 20 minutes', async () => {
    const w = await open();
    const [anna, bea, cat] = [await rider(w), await rider(w), await rider(w)];
    const room = await madeRoom(w, anna.token);
    for (const each of [bea, cat]) {
      await w.call('POST', '/v1/rooms/join', { token: each.token, body: { code: room.code } });
    }
    // Anna holds 490 W at 70 kg — 7 W/kg, over the 6.5 W/kg 20-minute ceiling
    // — and the others ride inside every ceiling.
    await ridden(w, room.roomId, [
      { athleteId: anna.athleteId, watts: 490 },
      { athleteId: bea.athleteId, watts: 230 },
      { athleteId: cat.athleteId, watts: 210 },
    ]);
    for (const viewer of [anna, bea, cat]) {
      const got = await w.call('GET', `/v1/rooms/${room.roomId}/results`, { token: viewer.token });
      expect(got.status).toBe(200);
      const rows = (got.body as Rows).rows;
      expect(rows.map((row) => row.place)).toEqual([1, 2, 3]);
      expect(rows[0]?.flags).toEqual([{ durationSeconds: 1200, overWattsPerKilogram: 6.5 }]);
      expect(rows[1]?.flags).toEqual([]);
      expect(rows[0]?.wattsPerKilogram).toBe(7);
      expect(rows.filter((row) => row.you)).toHaveLength(1);
      // W/kg, never watts: no field anywhere names a power.
      expect(JSON.stringify(got.body)).not.toMatch(/"(watts|power)[A-Za-z]*"(?<!PerKilogram")/i);
    }
  }, 30_000);

  it('is not read by anybody while the race runs — not even a rider already over the line (ADR 0028 D-7.7)', async () => {
    const w = await open();
    const [anna, bea] = [await rider(w), await rider(w)];
    const room = await madeRoom(w, anna.token);
    await w.call('POST', '/v1/rooms/join', { token: bea.token, body: { code: room.code } });
    // Anna crossed the line; Bea is still riding.
    await w.freshRead((store) =>
      store.putResult({
        roomId: room.roomId,
        athleteId: anna.athleteId,
        finishMs: 600_000,
        flags: 0,
        place: 1,
        wattsPerKilogram: 4,
        flaggedDurationsSeconds: [],
      }),
    );
    const as = (token: string) => w.call('GET', `/v1/rooms/${room.roomId}/results`, { token });
    expect((await as(anna.token)).status).toBe(404);
    await w.freshRead((store) => store.markRaceFinished(room.roomId, 1_790_000_200));
    expect((await as(anna.token)).status).toBe(200);
  });

  it('is read by the race’s riders only: a member who did not ride, and a stranger, are refused', async () => {
    const w = await open();
    const [anna, bea, watcher, stranger] = [
      await rider(w),
      await rider(w),
      await rider(w),
      await rider(w),
    ];
    const room = await madeRoom(w, anna.token);
    for (const each of [bea, watcher]) {
      await w.call('POST', '/v1/rooms/join', { token: each.token, body: { code: room.code } });
    }
    await ridden(w, room.roomId, [
      { athleteId: anna.athleteId, watts: 300 },
      { athleteId: bea.athleteId, watts: 250 },
    ]);
    const as = (token: string) => w.call('GET', `/v1/rooms/${room.roomId}/results`, { token });
    expect((await as(anna.token)).status).toBe(200);
    expect((await as(bea.token)).status).toBe(200);
    expect((await as(watcher.token)).status).toBe(404);
    expect((await as(stranger.token)).status).toBe(404);
  }, 30_000);

  it('keeps the others’ results when one rider erases their account, and shows them as “a rider” with no name', async () => {
    const w = await open();
    const [anna, bea, cat] = [await rider(w), await rider(w), await rider(w)];
    const room = await madeRoom(w, anna.token);
    for (const each of [bea, cat]) {
      await w.call('POST', '/v1/rooms/join', { token: each.token, body: { code: room.code } });
    }
    await ridden(w, room.roomId, [
      { athleteId: anna.athleteId, watts: 330 },
      { athleteId: bea.athleteId, watts: 290 },
      { athleteId: cat.athleteId, watts: 250 },
    ]);
    const erased = await erasedAccount(w, bea);
    expect(erased.status).toBe(204);
    await w.freshRead(async (store) => {
      const left = await store.listRoomResults(room.roomId);
      expect(left.map((result) => result.athleteId).sort()).toEqual(
        [anna.athleteId, cat.athleteId].sort(),
      );
    });
    for (const viewer of [anna, cat]) {
      const rows = (
        (await w.call('GET', `/v1/rooms/${room.roomId}/results`, { token: viewer.token }))
          .body as Rows
      ).rows;
      expect(rows.map((row) => row.place)).toEqual([1, 2, 3]);
      expect(rows[1]).toEqual({
        place: 2,
        displayName: null,
        you: false,
        finishMs: null,
        wattsPerKilogram: null,
        flags: [],
      });
      expect(rows[0]?.displayName).not.toBeNull();
      expect(rows[2]?.displayName).not.toBeNull();
    }
  }, 30_000);
});
