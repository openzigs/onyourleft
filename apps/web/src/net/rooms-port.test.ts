// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import {
  northProfile,
  roomRoute,
  ROOMS_ORIGIN,
  ScriptedInstance,
  signedInStorage,
  zoneNorth,
} from '../rooms/rooms-testing';
import { NO_CARD_DEVICE } from '../instance/testing';
import { routeDigest } from '../rooms/share';
import { createRoomsPort } from './rooms-port';

function port(
  instance: ScriptedInstance,
  zones = [zoneNorth(50_000)],
  storage = signedInStorage(),
) {
  return createRoomsPort({
    ...NO_CARD_DEVICE,
    storage,
    zones: () => Promise.resolve(zones),
    send: instance.send,
  });
}

const ROUTE = { id: 'route-1', profile: northProfile(3_000) };

describe('making a room — #784', () => {
  it('sends the route as GPX with no name, the course, the kind and the position, with the session', async () => {
    const instance = new ScriptedInstance();
    const answer = await port(instance).create({
      kind: 'race',
      ridingPosition: 'drops',
      drafting: false,
      route: ROUTE,
    });
    expect(answer.kind).toBe('created');
    expect(instance.seen).toHaveLength(1);
    const [request] = instance.seen;
    expect(request?.method).toBe('POST');
    expect(request?.path).toBe('/v1/rooms');
    expect(request?.authorization).toBe('Bearer session-token');
    const body = request?.body as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(
      ['drafting', 'grades', 'gpx', 'kind', 'lengthMetres', 'loop', 'ridingPosition'].sort(),
    );
    expect(body.kind).toBe('race');
    // #787: the maker's drafting, sent as chosen and kept with the room entered.
    expect(body.drafting).toBe(false);
    expect(body.ridingPosition).toBe('drops');
    expect(body.gpx).toMatch(/^<\?xml/);
    expect(body.gpx).not.toMatch(/<name>/);
    if (answer.kind === 'created') {
      expect(answer.room).toMatchObject({
        roomId: 'room-abc',
        kind: 'race',
        drafting: false,
        code: 'ABCDE-FGHJK-MNPQR',
      });
      // The digest of the bytes THIS device sent — what the room's routeRef must name.
      expect(answer.room.routeSha256).toBe(await routeDigest(body.gpx as string));
    }
  });

  it('refuses a route that starts in a privacy zone BEFORE any request is made — none carries geometry', async () => {
    const instance = new ScriptedInstance();
    const answer = await port(instance, [zoneNorth(0)]).create({
      kind: 'group',
      ridingPosition: 'hoods',
      drafting: true,
      route: ROUTE,
    });
    expect(answer).toEqual({ kind: 'refused', reason: 'start-in-a-zone' });
    expect(instance.seen).toEqual([]);
  });

  it('refuses a route through a zone, and one ending in one, before any request', async () => {
    for (const [centre, reason] of [
      [1_500, 'through-a-zone'],
      [3_000, 'end-in-a-zone'],
    ] as const) {
      const instance = new ScriptedInstance();
      const answer = await port(instance, [zoneNorth(centre)]).create({
        kind: 'group',
        ridingPosition: 'hoods',
        drafting: true,
        route: ROUTE,
      });
      expect(answer).toEqual({ kind: 'refused', reason });
      expect(instance.seen).toEqual([]);
    }
  });

  it('sends nothing for a device signed in nowhere', async () => {
    const instance = new ScriptedInstance();
    const empty = createRoomsPort({
      ...NO_CARD_DEVICE,
      storage: { ...signedInStorage(), getItem: () => null },
      zones: () => Promise.resolve([]),
      send: instance.send,
    });
    expect(
      await empty.create({ kind: 'group', ridingPosition: 'hoods', drafting: true, route: ROUTE }),
    ).toEqual({
      kind: 'refused',
      reason: 'not-signed-in',
    });
    expect(await empty.join('ABCDE-FGHJK-MNPQR')).toEqual({
      kind: 'refused',
      reason: 'not-signed-in',
    });
    expect(instance.seen).toEqual([]);
  });
});

describe('a room route an instance holding keys refuses in plaintext — #1210', () => {
  it('reads `sealed_required` as cannot-seal, not as the instance refusing', async () => {
    const instance = new ScriptedInstance();
    instance.created = {
      status: 403,
      body: { error: { code: 'sealed_required', message: 'Sealed.' } },
    };
    expect(
      await port(instance).create({
        kind: 'group',
        ridingPosition: 'hoods',
        drafting: true,
        route: ROUTE,
      }),
    ).toEqual({ kind: 'refused', reason: 'cannot-seal' });
    // A 403 that is not `sealed_required` (nor #788's `not_eligible`) is still the instance refusing.
    instance.created = { status: 403, body: { error: { code: 'forbidden' } } };
    expect(
      await port(instance).create({
        kind: 'group',
        ridingPosition: 'hoods',
        drafting: true,
        route: ROUTE,
      }),
    ).toEqual({ kind: 'refused', reason: 'instance-refused' });
  });
});

describe('joining a room by its code — #784', () => {
  it('sends the code in a POST body, never in a path, and rides the route only once it is the room’s', async () => {
    const instance = new ScriptedInstance();
    const { gpx, sha256 } = await roomRoute();
    instance.offer('room-xyz', 'group', gpx, sha256);
    const answer = await port(instance).join('abcde-fghjk-mnpqr');
    expect(answer.kind).toBe('joined');
    expect(instance.seen.map((each) => `${each.method} ${each.path}`)).toEqual([
      'POST /v1/rooms/join',
      'GET /v1/rooms/room-xyz/route',
    ]);
    expect(instance.seen[0]?.body).toEqual({ code: 'abcde-fghjk-mnpqr' });
    for (const each of instance.seen) expect(each.path.toLowerCase()).not.toContain('abcde');
    if (answer.kind === 'joined') {
      expect(answer.room.code).toBeUndefined();
      expect(answer.room.profile.totalDistance).toBeGreaterThan(1_900);
      // The digest the fetched route was checked against, for the welcome's routeRef.
      expect(answer.room.routeSha256).toBe(sha256);
    }
  });

  it('refuses a route whose bytes are not the room’s routeRef — fetched by hash and checked against it', async () => {
    const instance = new ScriptedInstance();
    const { gpx, sha256 } = await roomRoute();
    instance.offer('room-xyz', 'group', gpx, sha256);
    instance.route = { status: 200, body: { sha256, gpx: gpx.replace('<ele>', '<ele>1') } };
    expect(await port(instance).join('ABCDE-FGHJK-MNPQR')).toEqual({
      kind: 'refused',
      reason: 'not-the-rooms-route',
    });
  });

  it('tells a wrong code and a code tried too often apart, in words', async () => {
    const instance = new ScriptedInstance();
    expect(await port(instance).join('00000-00000-00000')).toEqual({
      kind: 'refused',
      reason: 'no-such-room',
    });
    instance.joined = { status: 429, body: null };
    expect(await port(instance).join('00000-00000-00000')).toEqual({
      kind: 'refused',
      reason: 'rate-limited',
    });
  });
});

describe('a race — #785', () => {
  it('starts a race through the room’s own start, and reads its result', async () => {
    const instance = new ScriptedInstance();
    const rooms = port(instance);
    expect(await rooms.start('room-xyz')).toEqual({ kind: 'started' });
    instance.publish([
      {
        place: 1,
        displayName: 'Ann',
        you: false,
        finishMs: 60_000,
        wattsPerKilogram: 4.2,
        flags: [],
      },
    ]);
    const result = await rooms.results('room-xyz');
    expect(result.kind).toBe('result');
    expect(instance.seen.map((each) => `${each.method} ${each.path}`)).toEqual([
      'POST /v1/rooms/room-xyz/start',
      'GET /v1/rooms/room-xyz/results',
    ]);
  });

  it('refuses a result that is not in the published shape, rather than showing part of it', async () => {
    const instance = new ScriptedInstance();
    instance.results = { status: 200, body: { rows: [{ place: 1, watts: 300 }] } };
    expect(await port(instance).results('room-xyz')).toEqual({
      kind: 'refused',
      reason: 'instance-refused',
    });
  });
});

describe('blocking a rider from a race’s result — #1516', () => {
  it('posts the row, and nothing else, to the room’s own block route, with the session token', async () => {
    const instance = new ScriptedInstance();
    expect(await port(instance).blockRider('room-xyz', 2)).toEqual({ kind: 'blocked' });
    expect(instance.seen).toEqual([
      {
        method: 'POST',
        path: '/v1/rooms/room-xyz/blocks',
        // A row: never a name, never an athlete id.
        body: { row: 2 },
        authorization: expect.stringMatching(/^Bearer /) as unknown,
      },
    ]);
  });

  for (const [status, answer] of [
    [404, { kind: 'refused', reason: 'no-such-room' }],
    [400, { kind: 'refused', reason: 'instance-refused' }],
    [503, { kind: 'unreachable' }],
  ] as const) {
    it(`reads a ${String(status)} as ${JSON.stringify(answer)}`, async () => {
      const instance = new ScriptedInstance();
      instance.blocked = { status, body: { error: { code: 'x' } } };
      expect(await port(instance).blockRider('room-xyz', 1)).toEqual(answer);
    });
  }

  it('sends nothing for a device signed in nowhere, nor for a room id the router could not route', async () => {
    const instance = new ScriptedInstance();
    const empty = createRoomsPort({
      ...NO_CARD_DEVICE,
      storage: { ...signedInStorage(), getItem: () => null },
      zones: () => Promise.resolve([]),
      send: instance.send,
    });
    expect(await empty.blockRider('room-xyz', 1)).toEqual({
      kind: 'refused',
      reason: 'not-signed-in',
    });
    expect(await port(instance).blockRider('../blocks', 1)).toEqual({ kind: 'unreachable' });
    expect(instance.seen).toEqual([]);
  });
});

describe('the notice page the references link to — #1381', () => {
  it('is the notice page on the instance this device is signed in to, and asking sends nothing', () => {
    const instance = new ScriptedInstance();
    expect(port(instance).noticePage()).toBe(`${ROOMS_ORIGIN}/report`);
    expect(instance.seen).toEqual([]);
  });

  it('is nothing on a device holding no instance session', () => {
    const empty = createRoomsPort({
      ...NO_CARD_DEVICE,
      storage: { ...signedInStorage(), getItem: () => null },
      zones: () => Promise.resolve([]),
      send: new ScriptedInstance().send,
    });
    expect(empty.noticePage()).toBeUndefined();
  });
});

describe('public rooms — #788', () => {
  const LISTED = {
    roomId: 'room-pub',
    kind: 'group',
    ridingPosition: 'hoods',
    drafting: true,
    loop: false,
    startsAt: 1_790_001_800,
    lengthMetres: 3_000,
    climbMetres: 24,
  } as const;

  it('makes a listed room through the same privacy refusal, sending its start and no code coming back', async () => {
    const zoned = new ScriptedInstance();
    expect(
      await port(zoned, [zoneNorth(0)]).create({
        kind: 'group',
        ridingPosition: 'hoods',
        drafting: true,
        route: ROUTE,
        startsAt: LISTED.startsAt,
      }),
    ).toEqual({ kind: 'refused', reason: 'start-in-a-zone' });
    expect(zoned.seen).toEqual([]);

    const instance = new ScriptedInstance();
    instance.created = { status: 200, body: { roomId: 'room-pub', routeSha256: 'x' } };
    const answer = await port(instance).create({
      kind: 'group',
      ridingPosition: 'hoods',
      drafting: true,
      route: ROUTE,
      startsAt: LISTED.startsAt,
    });
    const body = instance.seen[0]?.body as Record<string, unknown>;
    expect(body.visibility).toBe('public');
    expect(body.startsAt).toBe(LISTED.startsAt);
    expect(answer.kind).toBe('created');
    if (answer.kind === 'created') {
      expect(answer.room.code).toBeUndefined();
      expect(answer.room.listed).toEqual({ startsAt: LISTED.startsAt });
      expect(answer.room.madeIt).toBe(true);
    }
  });

  it('sends no visibility for a room shared by its code', async () => {
    const instance = new ScriptedInstance();
    await port(instance).create({
      kind: 'group',
      ridingPosition: 'hoods',
      drafting: true,
      route: ROUTE,
    });
    const body = instance.seen[0]?.body as Record<string, unknown>;
    expect('visibility' in body).toBe(false);
    expect('startsAt' in body).toBe(false);
  });

  it('reads the listing in the instance’s order, with the session and nothing else', async () => {
    const instance = new ScriptedInstance();
    const second = { ...LISTED, roomId: 'room-two', startsAt: LISTED.startsAt + 600 };
    instance.listing = { status: 200, body: { rooms: [LISTED, second] } };
    const answer = await port(instance).listPublic();
    expect(answer).toEqual({ kind: 'listed', rooms: [LISTED, second] });
    expect(instance.seen.map((each) => `${each.method} ${each.path}`)).toEqual([
      'GET /v1/rooms/public',
    ]);
    expect(instance.seen[0]?.authorization).toBe('Bearer session-token');
  });

  it('says an instance with public rooms off offers none, and an account not eligible is not', async () => {
    const off = new ScriptedInstance();
    off.listing = { status: 404, body: { error: { code: 'not_found' } } };
    expect(await port(off).listPublic()).toEqual({ kind: 'refused', reason: 'no-public-rooms' });
    const minor = new ScriptedInstance();
    minor.listing = { status: 403, body: { error: { code: 'not_eligible' } } };
    expect(await port(minor).listPublic()).toEqual({ kind: 'refused', reason: 'not-eligible' });
    minor.joinedPublic = { status: 403, body: { error: { code: 'not_eligible' } } };
    expect(await port(minor).joinPublic(LISTED)).toEqual({
      kind: 'refused',
      reason: 'not-eligible',
    });
  });

  it('refuses a listing that is not one, whole', async () => {
    for (const rooms of [
      [{ ...LISTED, climbMetres: 'lots' }],
      [{ ...LISTED, roomId: '../escape' }],
      [{ ...LISTED, kind: 'league' }],
      'none',
    ]) {
      const instance = new ScriptedInstance();
      instance.listing = { status: 200, body: { rooms } };
      expect(await port(instance).listPublic()).toEqual({
        kind: 'refused',
        reason: 'instance-refused',
      });
    }
  });

  it('asks nothing of an instance it is not signed in to', async () => {
    const instance = new ScriptedInstance();
    const empty = port(instance, [], { ...signedInStorage(), getItem: () => null });
    expect(await empty.listPublic()).toEqual({ kind: 'refused', reason: 'not-signed-in' });
    expect(await empty.joinPublic(LISTED)).toEqual({ kind: 'refused', reason: 'not-signed-in' });
    expect(instance.seen).toEqual([]);
  });

  it('joins from the listing by the room’s id, then fetches and checks its route, as a code’s joiner does', async () => {
    const instance = new ScriptedInstance();
    const { gpx, sha256 } = await roomRoute();
    instance.list(LISTED, gpx, sha256);
    const answer = await port(instance).joinPublic(LISTED);
    expect(instance.seen.map((each) => `${each.method} ${each.path}`)).toEqual([
      'POST /v1/rooms/room-pub/join',
      'GET /v1/rooms/room-pub/route',
    ]);
    expect(instance.seen[0]?.body).toBeNull();
    expect(answer.kind).toBe('joined');
    if (answer.kind === 'joined') {
      expect(answer.room.code).toBeUndefined();
      expect(answer.room.listed).toEqual({ startsAt: LISTED.startsAt });
      expect(answer.room.madeIt).toBe(false);
      expect(answer.room.routeSha256).toBe(sha256);
    }

    // A route that is not the room's is not ridden.
    const other = new ScriptedInstance();
    const elsewhere = await roomRoute(1_000);
    other.list(LISTED, elsewhere.gpx, sha256);
    expect(await port(other).joinPublic(LISTED)).toEqual({
      kind: 'refused',
      reason: 'not-the-rooms-route',
    });
  });
});
