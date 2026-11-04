// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A private lap race on a rider's own loop — #1910.
 *
 * Made through the real route, read back as the room is opened: the store on
 * a FRESH connection (`freshRead`), into `room/room-plan.ts`'s plan, the core's
 * settings and the welcome a rider's client is sent. A test that reads the row
 * it just wrote, on the handle that wrote it, would not show the write landed
 * where the room is opened from.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { decodeRoomMessage, encodeMessage } from '@onyourleft/protocol';

import {
  startIdentityInstance,
  testDevice,
  type IdentityInstance,
} from '../auth/identity-testing.ts';
import { createRoom } from '../room/core/room.ts';
import { admitByTable, helloText, reportText, sentTo, useText } from '../room/core/room-testing.ts';
import { finalResults } from '../room/node/room-host.ts';
import { planFor, settingsFromPlan, type RoomPlan } from '../room/room-plan.ts';
import { MAXIMUM_COURSE_METRES, MAXIMUM_ROOM_LAPS } from './rooms.ts';
import { madeRoom, riderIn, roomBody } from './rooms-testing.ts';

let world: IdentityInstance | undefined;
afterEach(async () => {
  await world?.close();
  world = undefined;
});

async function open() {
  world = await startIdentityInstance({});
  return world;
}

const rider = async (w: IdentityInstance) => riderIn(w, await testDevice());

/** A lap race's body on a loop: `lengthMetres` is one lap. */
const lapBody = (lapRace: unknown, overrides: Readonly<Record<string, unknown>> = {}) => ({
  loop: true,
  lapRace,
  ...overrides,
});

/** The plan a room is opened with, read on a fresh connection to the store. */
async function planOf(w: IdentityInstance, roomId: string): Promise<RoomPlan | undefined> {
  let plan: RoomPlan | undefined;
  await w.freshRead(async (store) => {
    const room = await store.getRoom(roomId);
    plan =
      room === undefined
        ? undefined
        : planFor(room, await store.getRoomCourse(roomId), 'any-seated-rider');
  });
  return plan;
}

function fieldOf(body: unknown): { field: string; problem: string } | undefined {
  return (body as { error?: { fields?: { field: string; problem: string }[] } }).error?.fields?.[0];
}

describe('a private lap race on a rider’s own loop — #1910', () => {
  it('stores its laps and items with the course, and the room opens as that lap race', async () => {
    const w = await open();
    const anna = await rider(w);
    const three = await madeRoom(w, anna.token, lapBody({ laps: 3, items: true }));
    const five = await madeRoom(w, anna.token, lapBody({ laps: 5, items: false }));
    for (const [room, laps, items] of [
      [three, 3, true],
      [five, 5, false],
    ] as const) {
      const plan = await planOf(w, room.roomId);
      expect(plan?.lapRace).toMatchObject({ laps, items });
      const seed = plan?.lapRace?.seed ?? -1;
      expect(Number.isInteger(seed) && seed >= 0 && seed <= 0xffff_ffff).toBe(true);
      // Into the core, and out to a rider as the welcome a client decodes.
      const core = createRoom(settingsFromPlan(plan!), admitByTable());
      const welcome = decodeRoomMessage(
        encodeMessage(sentTo(core.receive(1, helloText('ticket-ann'), 0), 1)[0]!),
      );
      expect(welcome).toMatchObject({
        ok: true,
        message: {
          type: 'welcome',
          roomConfig: { kind: 'race', lapRace: { laps, items: items ? 'on' : 'off' } },
        },
      });
    }
    // Two rooms, two seeds: each drawn for its room.
    expect((await planOf(w, three.roomId))?.lapRace?.seed).not.toBe(
      (await planOf(w, five.roomId))?.lapRace?.seed,
    );
  });

  it('opens a room made without one as the race it always was, and tells a joiner of no lap race', async () => {
    const w = await open();
    const anna = await rider(w);
    const room = await madeRoom(w, anna.token, { loop: true });
    const bea = await rider(w);
    const joined = await w.call('POST', '/v1/rooms/join', {
      token: bea.token,
      body: { code: room.code },
    });
    expect(joined.status).toBe(200);
    expect(joined.body).not.toHaveProperty('lapRace');
    const plan = await planOf(w, room.roomId);
    expect(plan).toBeDefined();
    expect(plan?.lapRace).toBeUndefined();
    expect(settingsFromPlan(plan!).lapRace).toBeUndefined();
  });

  it('never sends the seed: not in the answer to the maker, nor to a joiner', async () => {
    const w = await open();
    const anna = await rider(w);
    const bea = await rider(w);
    const made = await w.call('POST', '/v1/rooms', {
      token: anna.token,
      body: roomBody(lapBody({ laps: 2, items: true })),
    });
    expect(made.status).toBe(200);
    const { roomId, code } = made.body as { roomId: string; code: string };
    const seed = String((await planOf(w, roomId))?.lapRace?.seed);
    const joined = await w.call('POST', '/v1/rooms/join', { token: bea.token, body: { code } });
    expect(joined.status).toBe(200);
    // #1912: the joiner is told the laps and the items before the start, and nothing more.
    expect((joined.body as { lapRace?: unknown }).lapRace).toEqual({ laps: 2, items: true });
    for (const answer of [made, joined]) {
      expect(JSON.stringify(answer.body)).not.toMatch(/seed/i);
      expect(JSON.stringify(answer.body)).not.toContain(seed);
    }
  });

  it('refuses a lap race on a route that is not a loop, saying why, and makes nothing', async () => {
    const w = await open();
    const anna = await rider(w);
    const answer = await w.call('POST', '/v1/rooms', {
      token: anna.token,
      body: roomBody(lapBody({ laps: 3, items: true }, { loop: false })),
    });
    expect(answer.status).toBe(400);
    expect(fieldOf(answer.body)).toEqual({
      field: 'lapRace',
      problem:
        'needs a loop route: a lap race rides the same road round, so it must end where it starts',
    });
    expect(w.roomRoutes.size).toBe(0);
  });

  it('refuses a lap race that is a group ride, public, out of range or malformed, naming the field', async () => {
    const w = await open();
    const anna = await rider(w);
    for (const [body, problem] of [
      [lapBody({ laps: 3, items: true }, { kind: 'group' }), /group ride/],
      [lapBody({ laps: 3, items: true }, { visibility: 'public' }), /private room only/],
      [lapBody({ laps: 0, items: true }), /1 to/],
      [lapBody({ laps: MAXIMUM_ROOM_LAPS + 1, items: true }), /1 to/],
      [lapBody({ laps: 2.5, items: true }), /whole number/],
      [lapBody({ laps: 3, items: 'yes' }), /items/],
      [lapBody({ laps: 3 }), /items/],
      [lapBody({ laps: 3, items: true, seed: 7 }), /only laps and items/],
      [lapBody([3, true]), /laps, items/],
      [lapBody({ laps: 3, items: true }, { lengthMetres: MAXIMUM_COURSE_METRES / 2 }), /1 000 km/],
    ] as const) {
      const answer = await w.call('POST', '/v1/rooms', { token: anna.token, body: roomBody(body) });
      expect(answer.status, JSON.stringify(body)).toBe(400);
      const field = fieldOf(answer.body);
      expect(field?.field, JSON.stringify(body)).toBe('lapRace');
      expect(field?.problem, JSON.stringify(body)).toMatch(problem);
    }
    expect(w.roomRoutes.size).toBe(0);
  });
});

/**
 * #1910's scoping criterion, in the `activity-store.scoping.test.ts` shape:
 * TWO athletes' private lap races in the fixture, and every path that makes or
 * reads one asked as each athlete about the other's.
 */
describe('one athlete’s private lap race is never another’s — #1910', () => {
  it('makes and reads each athlete’s own room only, and keeps each room’s settings its own', async () => {
    const w = await open();
    const anna = await rider(w);
    const bea = await rider(w);
    const annas = await madeRoom(w, anna.token, lapBody({ laps: 3, items: true }));
    const beas = await madeRoom(w, bea.token, lapBody({ laps: 7, items: false }));
    expect(annas.roomId).not.toBe(beas.roomId);

    for (const [who, own, theirs] of [
      [anna, annas, beas],
      [bea, beas, annas],
    ] as const) {
      // The route: a member's own room, and nothing of the other's.
      expect(
        (await w.call('GET', `/v1/rooms/${own.roomId}/route`, { token: who.token })).status,
      ).toBe(200);
      expect(
        (await w.call('GET', `/v1/rooms/${theirs.roomId}/route`, { token: who.token })).status,
      ).toBe(404);
      // A ticket into it.
      const ticket = (roomId: string) =>
        w.call('POST', `/v1/rooms/${roomId}/ticket`, {
          token: who.token,
          body: { declaredMassKilograms: 70 },
        });
      expect((await ticket(own.roomId)).status).toBe(200);
      expect((await ticket(theirs.roomId)).status).toBe(404);
      // Its results.
      expect(
        (await w.call('GET', `/v1/rooms/${theirs.roomId}/results`, { token: who.token })).status,
      ).toBe(404);
    }
    // Neither athlete is a member of the other's room, in the store.
    await w.freshRead(async (store) => {
      expect(await store.isRoomMember(beas.roomId, anna.athleteId)).toBe(false);
      expect(await store.isRoomMember(annas.roomId, bea.athleteId)).toBe(false);
    });
    // And each room opens with its own maker's settings, never the other's.
    expect((await planOf(w, annas.roomId))?.lapRace).toMatchObject({ laps: 3, items: true });
    expect((await planOf(w, beas.roomId))?.lapRace).toMatchObject({ laps: 7, items: false });
  });
});

/**
 * #1912: a private lap race ridden to its finish — made through the route, its
 * plan read as the room is opened, raced through the room core with items on
 * and one rider over a ceiling, its results stored as the Node adapter stores
 * them and read through the results route as each rider reads them.
 */
describe('a lap race’s result — #1912', () => {
  it('publishes the room’s finish order with the flag a rider raised, and nothing of the items, offsets or lanes', async () => {
    const w = await open();
    const anna = await rider(w);
    const bea = await rider(w);
    const made = await madeRoom(w, anna.token, lapBody({ laps: 3, items: true }));
    await w.call('POST', '/v1/rooms/join', { token: bea.token, body: { code: made.code } });
    const plan = await planOf(w, made.roomId);
    if (plan === undefined) throw new Error('the lap race has no plan');
    const tickets = new Map([
      ['ticket-anna', anna.athleteId],
      ['ticket-bea', bea.athleteId],
    ]);
    const room = createRoom(settingsFromPlan({ ...plan, countdownMs: 0 }), (ticket) => {
      const athleteId = tickets.get(ticket);
      return athleteId === undefined
        ? undefined
        : { athleteId, declaredMassKilograms: 70, displayName: athleteId };
    });
    room.receive(1, helloText('ticket-anna'), 0);
    room.receive(2, helloText('ticket-bea'), 0);
    room.start(0);
    const events: string[] = [];
    for (let t = 0; room.view().phase !== 'finished'; t += 1) {
      const at = t * 1000 + 500;
      // Anna sprints at 1 300 W — 18.6 W/kg, over the 5-second ceiling — for
      // eight seconds, then rides at 260 W; Bea uses every item she holds.
      room.receive(1, reportText(t, at, t < 8 ? 1_300 : 260), at);
      room.receive(2, reportText(t, at, 250), at);
      room.receive(2, useText(t + 1, at + 10), at + 10);
      const out = room.tick((t + 1) * 1000);
      for (const message of sentTo(out, 1)) {
        if (message.type === 'frame')
          events.push(...(message.itemEvents ?? []).map((e) => e.event));
      }
      if (t > 600) throw new Error('the lap race never finished');
    }
    // Items were in play: picked up and used.
    expect(events).toContain('pick-up');
    expect(events).toContain('use');
    const order = room.view().finishOrder;
    await w.freshRead(async (store) => {
      for (const result of finalResults(room.view(), 1000)) {
        await store.putResult({ roomId: made.roomId, ...result });
      }
      await store.markRaceFinished(made.roomId, 1_790_000_100);
    });

    const athleteOf = new Map(room.view().seats.map((seat) => [seat.riderId, seat.athleteId]));
    const LAP_WORDS = /item|offset|lane|held|hit|pick|lap|puddle|gust|tow|tailwind|cape/iu;
    for (const viewer of [anna, bea]) {
      const got = await w.call('GET', `/v1/rooms/${made.roomId}/results`, { token: viewer.token });
      expect(got.status).toBe(200);
      const rows = (got.body as { rows: { place: number; you: boolean; flags: unknown[] }[] }).rows;
      // The room's own finish order, read back through the route.
      expect(rows.map((row) => row.place)).toEqual([1, 2]);
      const annaPlace = order.findIndex((riderId) => athleteOf.get(riderId) === anna.athleteId);
      expect(rows[annaPlace]?.flags).toEqual([{ durationSeconds: 5, overWattsPerKilogram: 18 }]);
      expect(rows[1 - annaPlace]?.flags).toEqual([]);
      // Nothing of the race's items, offsets or lanes, in any key.
      expect(keysOf(got.body).filter((key) => LAP_WORDS.test(key))).toEqual([]);
    }
    // Nor in what is stored.
    await w.freshRead(async (store) => {
      const stored = await store.listRoomResults(made.roomId);
      expect(stored).toHaveLength(2);
      expect(keysOf(stored).filter((key) => LAP_WORDS.test(key))).toEqual([]);
    });
  }, 30_000);
});

/** Every key anywhere in a value. */
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
