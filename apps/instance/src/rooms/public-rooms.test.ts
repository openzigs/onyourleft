// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **Public rooms** (#788), through the real handler and listener: made by an
 * eligible rider on their own route, listed by ONE non-editorial rule, joined
 * from the listing by an eligible rider — and every refusal ADR 0028 D-6.4
 * owes before one is listed: off by default, 18+ and #775's predicate,
 * blocks either way, and three a day. Each is read back as a real client
 * reads it — the listing, the route, a ticket — or from a fresh connection.
 */

import { afterEach, describe, expect, it } from 'vitest';

import {
  startSoleModeratorWorld,
  TEST_STATEMENT,
  codeOf,
  type SoleModeratorWorld,
} from '../moderation/moderation-testing.ts';
import { readLegalSettings } from '../legal.ts';
import { climbOf, PUBLIC_ROOMS_PER_ATHLETE_PER_DAY, type ListedRoom } from './rooms.ts';
import {
  adultIn,
  madePublicRoom,
  madeRoom,
  PUBLIC_ROOMS_ON,
  publicRoomBody,
  roomBody,
} from './rooms-testing.ts';
import { newRoomCode } from './code.ts';

let world: SoleModeratorWorld | undefined;
afterEach(async () => {
  await world?.close();
  world = undefined;
});

const FIXED_CODE = 'ABCDEFGHJKMNPQR';

async function open(on = true): Promise<SoleModeratorWorld> {
  let drawn = 0;
  world = await startSoleModeratorWorld({
    ...(on ? PUBLIC_ROOMS_ON : {}),
    // So a test can try a public room's code — drawn, and never shown: the
    // world's FIRST room has a code the test knows, every other a random one.
    roomCode: () => (drawn++ === 0 ? FIXED_CODE : newRoomCode()),
  });
  return world;
}

const listing = async (w: SoleModeratorWorld, token: string) =>
  w.call('GET', '/v1/rooms/public', { token });

const listed = async (w: SoleModeratorWorld, token: string): Promise<readonly ListedRoom[]> => {
  const answer = await listing(w, token);
  expect(answer.status).toBe(200);
  return (answer.body as { rooms: ListedRoom[] }).rooms;
};

const joinFromListing = (w: SoleModeratorWorld, token: string, roomId: string) =>
  w.call('POST', `/v1/rooms/${roomId}/join`, { token });

const ticket = (w: SoleModeratorWorld, token: string, roomId: string) =>
  w.call('POST', `/v1/rooms/${roomId}/ticket`, { token, body: { declaredMassKilograms: 70 } });

describe('off unless the operator turns them on — #788', () => {
  it('reads an environment that says nothing as public rooms OFF', () => {
    expect(readLegalSettings({}, []).publicRooms).toBe(false);
  });

  it('on an instance left at that default: no public room is made, listed or joined', async () => {
    const w = await open(false);
    const anna = await adultIn(w);
    const made = await w.call('POST', '/v1/rooms', { token: anna.token, body: publicRoomBody(w) });
    expect(made.status).toBe(400);
    expect(JSON.stringify(made.body)).toContain('visibility');
    expect(w.roomRoutes.size).toBe(0);
    const list = await listing(w, anna.token);
    expect(list.status).toBe(404);
    expect(codeOf(list.body)).toBe('not_found');
    // A private room is made as ever, and its id joins nothing from a listing.
    const room = await madeRoom(w, anna.token);
    const bea = await adultIn(w);
    expect((await joinFromListing(w, bea.token, room.roomId)).status).toBe(404);
  });
});

describe('18+ and #775’s predicate, on making, listing and joining — #788, ruling Q5', () => {
  it('refuses all three to an athlete who has not confirmed they are 18 or over, and lets an adult', async () => {
    const w = await open();
    const minor = await w.rider('Not declared');
    const adult = await adultIn(w);

    const refused = await w.call('POST', '/v1/rooms', {
      token: minor.token,
      body: publicRoomBody(w),
    });
    expect(refused.status).toBe(403);
    expect(codeOf(refused.body)).toBe('not_eligible');
    expect(w.roomRoutes.size).toBe(0);

    const room = await madePublicRoom(w, adult.token);
    expect(codeOf((await listing(w, minor.token)).body)).toBe('not_eligible');
    const joined = await joinFromListing(w, minor.token, room.roomId);
    expect(joined.status).toBe(403);
    await w.freshRead(async (store) => {
      expect(await store.isRoomMember(room.roomId, minor.athleteId)).toBe(false);
    });

    // The same rider, once they confirm: listed, joined, and in.
    await w.call('POST', '/v1/auth/adult', { token: minor.token, body: { confirmed: true } });
    expect((await listed(w, minor.token)).map((each) => each.roomId)).toEqual([room.roomId]);
    expect((await joinFromListing(w, minor.token, room.roomId)).status).toBe(200);
    expect((await ticket(w, minor.token, room.roomId)).status).toBe(200);
  });

  it('refuses a suspended creator’s room-making as it refuses a ticket', async () => {
    const w = await open();
    const anna = await adultIn(w);
    await w.as(w.owner, 'POST', `/v1/moderation/athletes/${anna.athleteId}/suspend`, {
      reason: 'Cheating',
      statement: TEST_STATEMENT,
    });
    const made = await w.call('POST', '/v1/rooms', { token: anna.token, body: publicRoomBody(w) });
    expect(made.status).not.toBe(200);
    expect(w.roomRoutes.size).toBe(0);
  });
});

describe('making a public room — #788', () => {
  it('makes a PUBLIC room with no code shown, its creator a member, and its start kept', async () => {
    const w = await open();
    const anna = await adultIn(w);
    const answer = await w.call('POST', '/v1/rooms', {
      token: anna.token,
      body: publicRoomBody(w, 45),
    });
    expect(answer.status).toBe(200);
    const body = answer.body as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(['roomId', 'routeSha256']);
    const roomId = body.roomId as string;
    await w.freshRead(async (store) => {
      expect((await store.getRoom(roomId))?.visibility).toBe('public');
      expect(await store.isRoomMember(roomId, anna.athleteId)).toBe(true);
      expect((await store.getPrivateRoom(roomId))?.startsAt).toBe(
        Math.floor(w.clock.ms / 1000) + 45 * 60,
      );
    });
    // Its code was drawn and thrown away: the code joins nothing.
    const bea = await adultIn(w);
    expect(
      (await w.call('POST', '/v1/rooms/join', { token: bea.token, body: { code: FIXED_CODE } }))
        .status,
    ).toBe(404);
  });

  it('needs a start within the next twelve hours, and refuses one on a private room', async () => {
    const w = await open();
    const anna = await adultIn(w);
    for (const body of [
      publicRoomBody(w, 13 * 60),
      publicRoomBody(w, -60),
      roomBody({ visibility: 'public' }),
      roomBody({ startsAt: Math.floor(w.clock.ms / 1000) + 60 }),
      roomBody({ visibility: 'secret' }),
    ]) {
      const answer = await w.call('POST', '/v1/rooms', { token: anna.token, body });
      expect(answer.status, JSON.stringify(body.visibility)).toBe(400);
    }
    expect(w.roomRoutes.size).toBe(0);
  });

  it(`makes at most ${String(PUBLIC_ROOMS_PER_ATHLETE_PER_DAY)} a day per athlete — the owner’s ruling of 2026-10-15`, async () => {
    const w = await open();
    const anna = await adultIn(w);
    // A private room first: it is not one of the three.
    await madeRoom(w, anna.token);
    for (let n = 0; n < PUBLIC_ROOMS_PER_ATHLETE_PER_DAY; n += 1) {
      await madePublicRoom(w, anna.token, 30, { gpx: `${roomBody().gpx as string}${String(n)}` });
    }
    const fourth = await w.call('POST', '/v1/rooms', {
      token: anna.token,
      body: publicRoomBody(w, 30, { gpx: `${roomBody().gpx as string}-4` }),
    });
    expect(fourth.status).toBe(429);
    // Nothing of the fourth is kept: not a room, not its route (the
    // private room's route is the fixture's own, a fourth blob).
    expect(w.roomRoutes.size).toBe(PUBLIC_ROOMS_PER_ATHLETE_PER_DAY + 1);
    expect(await listed(w, anna.token)).toHaveLength(PUBLIC_ROOMS_PER_ATHLETE_PER_DAY);
    // Another athlete's three are their own.
    await madePublicRoom(w, (await adultIn(w)).token);
    // A day on, a fourth is made.
    w.clock.ms += 24 * 60 * 60_000 + 1000;
    expect(
      (
        await w.call('POST', '/v1/rooms', {
          token: anna.token,
          body: publicRoomBody(w, 30, { gpx: `${roomBody().gpx as string}-5` }),
        })
      ).status,
    ).toBe(200);
  });
});

describe('the listing — #788, ADR 0028 D-7.1', () => {
  it('is ordered by start, then by when each was made — and by nothing else', async () => {
    const w = await open();
    const made: Record<string, string> = {};
    // Starts fixed in absolute time, so two rooms share a start exactly and
    // only when each was made can tell them apart.
    const base = Math.floor(w.clock.ms / 1000);
    // Made in an order the listing must NOT keep: by creation alone it
    // would be late-1, soon-1, late-2, …; three share each start, so a
    // listing that broke the tie on the (random) id would show it.
    for (const [name, minutes] of [
      ['late-1', 90],
      ['soon-1', 20],
      ['late-2', 90],
      ['soon-2', 20],
      ['middle', 60],
      ['soon-3', 20],
      ['late-3', 90],
    ] as const) {
      w.clock.ms += 1000;
      made[name] = (
        await madePublicRoom(w, (await adultIn(w)).token, 0, { startsAt: base + minutes * 60 })
      ).roomId;
    }
    const viewer = await adultIn(w);
    const rooms = await listed(w, viewer.token);
    expect(rooms.map((each) => each.roomId)).toEqual(
      ['soon-1', 'soon-2', 'soon-3', 'middle', 'late-1', 'late-2', 'late-3'].map(
        (name) => made[name],
      ),
    );
    // What a listed room says — and no slot, flag or score besides.
    for (const room of rooms) {
      expect(Object.keys(room).sort()).toEqual([
        'climbMetres',
        'createdAt',
        'drafting',
        'kind',
        'lengthMetres',
        'loop',
        'ridingPosition',
        'roomId',
        'startsAt',
      ]);
    }
  });

  it('breaks a tie of start and creation on the room’s id, never on anything a rider or the operator chose', async () => {
    const w = await open();
    const ids: string[] = [];
    for (let n = 0; n < 3; n += 1) {
      ids.push((await madePublicRoom(w, (await adultIn(w)).token, 30)).roomId);
    }
    const rooms = await listed(w, (await adultIn(w)).token);
    expect(rooms.map((each) => each.roomId)).toEqual([...ids].sort());
  });

  it('shows a course’s length and climb, and never its route or a coordinate', async () => {
    const w = await open();
    const anna = await adultIn(w);
    await madePublicRoom(w, anna.token);
    const answer = await listing(w, anna.token);
    const [room] = (answer.body as { rooms: ListedRoom[] }).rooms;
    expect(room?.lengthMetres).toBe(222.4);
    // 110 m at 2 %, then down: 2.2 m, to the metre.
    expect(room?.climbMetres).toBe(2);
    const text = JSON.stringify(answer.body);
    for (const leak of ['gpx', 'lat', 'lon', '51.5', '-0.12', 'trkpt', 'grades']) {
      expect(text).not.toContain(leak);
    }
  });

  it('leaves out a private room, a room that is over, a race that started and a room a moderator hid', async () => {
    const w = await open();
    const anna = await adultIn(w);
    await madeRoom(w, anna.token);
    const over = await madePublicRoom(w, anna.token);
    const started = await madePublicRoom(w, (await adultIn(w)).token);
    const hidden = await madePublicRoom(w, (await adultIn(w)).token);
    const kept = await madePublicRoom(w, (await adultIn(w)).token);
    await w.freshRead(async (store) => {
      await store.closePrivateRoom(over.roomId, 1);
      await store.markRaceStarted(started.roomId, 1);
    });
    const hid = await w.as(w.owner, 'POST', '/v1/moderation/items/hide', {
      item: `room:${hidden.roomId}`,
      reason: 'From a notice',
      statement: { ...TEST_STATEMENT, decidedOn: 'notice' },
    });
    expect(hid.status).toBe(200);
    const viewer = await adultIn(w);
    expect((await listed(w, viewer.token)).map((each) => each.roomId)).toEqual([kept.roomId]);
    for (const roomId of [over.roomId, started.roomId, hidden.roomId]) {
      expect((await joinFromListing(w, viewer.token, roomId)).status, roomId).toBe(404);
    }
  });
});

describe('joining from the listing — #788', () => {
  it('makes the joiner a member, who fetches the route and is ticketed, as a code’s joiner is', async () => {
    const w = await open();
    const anna = await adultIn(w);
    const room = await madePublicRoom(w, anna.token);
    const bea = await adultIn(w);
    const joined = await joinFromListing(w, bea.token, room.roomId);
    expect(joined.status).toBe(200);
    expect(joined.body).toEqual({
      roomId: room.roomId,
      kind: 'race',
      ridingPosition: 'hoods',
      drafting: true,
      loop: false,
      routeSha256: room.routeSha256,
    });
    await w.freshRead(async (store) => {
      expect(await store.isRoomMember(room.roomId, bea.athleteId)).toBe(true);
    });
    const route = await w.call('GET', `/v1/rooms/${room.roomId}/route`, { token: bea.token });
    expect((route.body as { sha256: string }).sha256).toBe(room.routeSha256);
    expect((await ticket(w, bea.token, room.roomId)).status).toBe(200);
  });

  it('joins no private room by its id', async () => {
    const w = await open();
    const room = await madeRoom(w, (await adultIn(w)).token);
    const bea = await adultIn(w);
    expect((await joinFromListing(w, bea.token, room.roomId)).status).toBe(404);
    await w.freshRead(async (store) => {
      expect(await store.isRoomMember(room.roomId, bea.athleteId)).toBe(false);
    });
  });
});

describe('a block keeps two riders out of one public room, either way round — #788', () => {
  async function blockedPair(direction: 'creator-blocks' | 'joiner-blocks') {
    const w = await open();
    const anna = await adultIn(w);
    const bea = await adultIn(w);
    const [blocker, blocked] = direction === 'creator-blocks' ? [anna, bea] : [bea, anna];
    expect(
      (await w.call('POST', `/v1/blocks/${blocked.athleteId}`, { token: blocker.token })).status,
    ).toBeLessThan(300);
    const room = await madePublicRoom(w, anna.token);
    return { w, anna, bea, room };
  }

  for (const direction of ['creator-blocks', 'joiner-blocks'] as const) {
    it(`lists the room to neither, and refuses the join (${direction})`, async () => {
      const { w, bea, room } = await blockedPair(direction);
      expect(await listed(w, bea.token)).toEqual([]);
      expect((await joinFromListing(w, bea.token, room.roomId)).status).toBe(404);
      await w.freshRead(async (store) => {
        expect(await store.isRoomMember(room.roomId, bea.athleteId)).toBe(false);
      });
      // Anybody else sees it and joins.
      const cat = await adultIn(w);
      expect((await listed(w, cat.token)).map((each) => each.roomId)).toEqual([room.roomId]);
      expect((await joinFromListing(w, cat.token, room.roomId)).status).toBe(200);
    });
  }

  it('refuses the ticket of a rider who blocked somebody in the room after joining it', async () => {
    const w = await open();
    const anna = await adultIn(w);
    const room = await madePublicRoom(w, anna.token);
    const bea = await adultIn(w);
    expect((await joinFromListing(w, bea.token, room.roomId)).status).toBe(200);
    expect((await ticket(w, bea.token, room.roomId)).status).toBe(200);
    await w.call('POST', `/v1/blocks/${anna.athleteId}`, { token: bea.token });
    expect((await ticket(w, bea.token, room.roomId)).status).toBe(404);
    // …and the rider blocked is refused too: neither is placed with the other.
    expect((await ticket(w, anna.token, room.roomId)).status).toBe(404);
  });

  it('still tickets two riders with a block between them into a PRIVATE room they share a code for', async () => {
    const w = await open();
    const anna = await adultIn(w);
    const bea = await adultIn(w);
    const room = await madeRoom(w, anna.token);
    await w.call('POST', '/v1/rooms/join', { token: bea.token, body: { code: room.code } });
    await w.call('POST', `/v1/blocks/${anna.athleteId}`, { token: bea.token });
    expect((await ticket(w, bea.token, room.roomId)).status).toBe(200);
  });
});

describe('the climb a listing states', () => {
  it('sums each rising step over its own length, and stops at the course’s end', () => {
    expect(
      climbOf(1_000, [
        [0, 5],
        [200, -3],
        [600, 2],
      ]),
    ).toBe(18);
    expect(
      climbOf(100, [
        [0, 4],
        [200, 10],
      ]),
    ).toBe(4);
    expect(climbOf(500, [[0, -2]])).toBe(0);
  });
});
