// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import {
  northProfile,
  roomRoute,
  ScriptedInstance,
  signedInStorage,
  zoneNorth,
} from '../rooms/rooms-testing';
import { createRoomsPort } from './rooms-port';

function port(
  instance: ScriptedInstance,
  zones = [zoneNorth(50_000)],
  storage = signedInStorage(),
) {
  return createRoomsPort({ storage, zones: () => Promise.resolve(zones), send: instance.send });
}

const ROUTE = { id: 'route-1', profile: northProfile(3_000) };

describe('making a room — #784', () => {
  it('sends the route as GPX with no name, the course, the kind and the position, with the session', async () => {
    const instance = new ScriptedInstance();
    const answer = await port(instance).create({
      kind: 'race',
      ridingPosition: 'drops',
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
      ['grades', 'gpx', 'kind', 'lengthMetres', 'loop', 'ridingPosition'].sort(),
    );
    expect(body.kind).toBe('race');
    expect(body.ridingPosition).toBe('drops');
    expect(body.gpx).toMatch(/^<\?xml/);
    expect(body.gpx).not.toMatch(/<name>/);
    if (answer.kind === 'created') {
      expect(answer.room).toMatchObject({
        roomId: 'room-abc',
        kind: 'race',
        code: 'ABCDE-FGHJK-MNPQR',
      });
    }
  });

  it('refuses a route that starts in a privacy zone BEFORE any request is made — none carries geometry', async () => {
    const instance = new ScriptedInstance();
    const answer = await port(instance, [zoneNorth(0)]).create({
      kind: 'group',
      ridingPosition: 'hoods',
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
        route: ROUTE,
      });
      expect(answer).toEqual({ kind: 'refused', reason });
      expect(instance.seen).toEqual([]);
    }
  });

  it('sends nothing for a device signed in nowhere', async () => {
    const instance = new ScriptedInstance();
    const empty = createRoomsPort({
      storage: { ...signedInStorage(), getItem: () => null },
      zones: () => Promise.resolve([]),
      send: instance.send,
    });
    expect(await empty.create({ kind: 'group', ridingPosition: 'hoods', route: ROUTE })).toEqual({
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
