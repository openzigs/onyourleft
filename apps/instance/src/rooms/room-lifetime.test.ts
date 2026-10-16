// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * How a room that is over lets go of its route, and says so (#948, from
 * #929's re-review): a room made on the same bytes as one ending keeps its
 * route (N-a), a delete that failed is tried again (N-b), the sweep ends only
 * what it claimed from the router, a race that ended with no result says so
 * to its members (N-d), and a room's maker is told they made it when they
 * join it by its code (N1). Each read back as a real client would.
 */

import { afterEach, describe, expect, it } from 'vitest';

import type { BlobStore } from '../blob/blob-store.ts';
import {
  startIdentityInstance,
  testDevice,
  type IdentityInstance,
} from '../auth/identity-testing.ts';
import { madeRoom, riderIn, ROOM_GPX } from './rooms-testing.ts';
import type { SweepGuard } from './rooms.ts';

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

/** A router that holds no room: every claim granted, and each claim and release kept. */
function routerHoldingNothing(): SweepGuard & { readonly calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    claim: (roomId) => {
      calls.push(`claim ${roomId}`);
      return true;
    },
    release: (roomId) => {
      calls.push(`release ${roomId}`);
    },
  };
}

const openRooms = (w: IdentityInstance, athleteId: string) =>
  w.freshRead((store) => store.countOpenPrivateRoomsMadeBy(athleteId));

const markStarted = (w: IdentityInstance, roomId: string) =>
  w.freshRead((store) => store.markRaceStarted(roomId, 1_790_000_010));

describe('a room made on the bytes of a room that is ending keeps its route — #948 N-a', () => {
  it('waits for the ending room’s delete, and writes the route again after it', async () => {
    let deleteEntered = (): void => undefined;
    const deleting = new Promise<void>((resolve) => (deleteEntered = resolve));
    let letDeleteGo = (): void => undefined;
    const deleteMayGo = new Promise<void>((resolve) => (letDeleteGo = resolve));
    let putSeen = (): void => undefined;
    const w = await open({
      roomRoutesSeenBy: (inner: BlobStore): BlobStore => ({
        ...inner,
        // Said once the bytes are WRITTEN, not when the write is asked for.
        put: async (bytes, sha256) => {
          const key = await inner.put(bytes, sha256);
          putSeen();
          return key;
        },
        delete: async (sha256) => {
          deleteEntered();
          await deleteMayGo;
          await inner.delete(sha256);
        },
      }),
    });
    const anna = await rider(w);
    const bea = await rider(w);
    const first = await madeRoom(w, anna.token);

    // The first room ends, and is held at its delete…
    const ending = w.rooms.roomLetGo(first.roomId, 'finished');
    await deleting;
    // …while a second room is made on the same bytes. Without the route's
    // turn it writes the file before the delete; with it, it cannot start.
    const written = new Promise<void>((resolve) => (putSeen = resolve));
    const making = madeRoom(w, bea.token);
    await Promise.race([written, making, new Promise((resolve) => setTimeout(resolve, 300))]);
    letDeleteGo();
    const [, second] = await Promise.all([ending, making]);

    expect(second.routeSha256).toBe(first.routeSha256);
    // Read back as its maker's app does: the route is there to hand out.
    const got = await w.call('GET', `/v1/rooms/${second.roomId}/route`, { token: bea.token });
    expect(got.status).toBe(200);
    expect(got.body).toEqual({ sha256: second.routeSha256, gpx: ROOM_GPX });
  });
});

describe('a route delete that fails is tried again — #948 N-b', () => {
  /** A route store whose next `failures.left` deletes throw. */
  const failingDeletes =
    (failures: { left: number }) =>
    (inner: BlobStore): BlobStore => ({
      ...inner,
      delete: async (sha256) => {
        if (failures.left > 0) {
          failures.left -= 1;
          throw new Error('the disk said no');
        }
        await inner.delete(sha256);
      },
    });

  it('leaves the room open when its delete throws, and the next sweep deletes the route', async () => {
    const w = await open({ roomRoutesSeenBy: failingDeletes({ left: 1 }) });
    const anna = await rider(w);
    const race = await madeRoom(w, anna.token);
    await markStarted(w, race.roomId);

    await expect(w.rooms.roomLetGo(race.roomId, 'finished')).rejects.toThrow('the disk said no');
    expect(w.roomRoutes.has(race.routeSha256)).toBe(true);
    expect(await openRooms(w, anna.athleteId)).toBe(1);

    expect(await w.rooms.sweep(routerHoldingNothing())).toBe(1);
    expect(w.roomRoutes.has(race.routeSha256)).toBe(false);
    await w.freshRead(async (store) => {
      expect((await store.getPrivateRoom(race.roomId))?.closedAt).not.toBeNull();
    });
  });

  it('ends every other due room past one that fails, and throws once it has tried them all', async () => {
    const w = await open({ roomRoutesSeenBy: failingDeletes({ left: 1 }) });
    const anna = await rider(w);
    const one = await madeRoom(w, anna.token);
    const two = await madeRoom(w, anna.token, { gpx: ROOM_GPX.replace('51.502000', '51.509000') });
    for (const room of [one, two]) await markStarted(w, room.roomId);

    const guard = routerHoldingNothing();
    await expect(w.rooms.sweep(guard)).rejects.toThrow('the disk said no');
    expect(await openRooms(w, anna.athleteId)).toBe(1);
    // Every claim is released, the failed one's too.
    expect(guard.calls.filter((call) => call.startsWith('release')).length).toBe(2);

    expect(await w.rooms.sweep(routerHoldingNothing())).toBe(1);
    expect(await openRooms(w, anna.athleteId)).toBe(0);
    expect(w.roomRoutes.size).toBe(0);
  });
});

describe('the sweep ends only a room it claimed from the router — #948', () => {
  it('claims a due room before ending it and releases it after, and leaves one the router keeps', async () => {
    const w = await open();
    const anna = await rider(w);
    const kept = await madeRoom(w, anna.token);
    const ended = await madeRoom(w, anna.token, {
      gpx: ROOM_GPX.replace('51.502000', '51.508000'),
    });
    const fresh = await madeRoom(w, anna.token, {
      gpx: ROOM_GPX.replace('51.502000', '51.507000'),
    });
    for (const room of [kept, ended]) await markStarted(w, room.roomId);

    const calls: string[] = [];
    const count = await w.rooms.sweep({
      claim: (roomId) => {
        calls.push(`claim ${roomId}`);
        return roomId !== kept.roomId;
      },
      release: (roomId) => {
        calls.push(`release ${roomId}`);
      },
    });
    expect(count).toBe(1);
    // A room not due is never claimed; one the router refused is never released.
    expect(calls).not.toContain(`claim ${fresh.roomId}`);
    expect(calls).not.toContain(`release ${kept.roomId}`);
    expect(calls.indexOf(`claim ${ended.roomId}`)).toBeGreaterThanOrEqual(0);
    expect(calls.indexOf(`claim ${ended.roomId}`)).toBeLessThan(
      calls.indexOf(`release ${ended.roomId}`),
    );
    expect(w.roomRoutes.has(kept.routeSha256)).toBe(true);
    expect(w.roomRoutes.has(ended.routeSha256)).toBe(false);
  });
});

describe('a race that is over with no result says so — #948 N-d', () => {
  it('tells a member of a race a restart interrupted that it has no result, and a stranger nothing', async () => {
    const w = await open();
    const [anna, bea, stranger] = [await rider(w), await rider(w), await rider(w)];
    const race = await madeRoom(w, anna.token);
    await w.call('POST', '/v1/rooms/join', { token: bea.token, body: { code: race.code } });
    const asked = (token: string) => w.call('GET', `/v1/rooms/${race.roomId}/results`, { token });

    // Started, and still being ridden: not over yet.
    await markStarted(w, race.roomId);
    expect((await asked(bea.token)).status).toBe(404);

    // The instance restarts in the middle of it: its first sweep ends it.
    expect(await w.rooms.sweep(routerHoldingNothing())).toBe(1);
    const told = await asked(bea.token);
    expect(told.status).toBe(409);
    expect((told.body as { error: { code: string } }).error.code).toBe('race_without_result');
    expect((await asked(anna.token)).status).toBe(409);
    // A stranger who knows the id is told what a room that does not exist tells them.
    expect(await asked(stranger.token)).toEqual(
      await w.call('GET', '/v1/rooms/nope/results', { token: stranger.token }),
    );
    expect((await asked(stranger.token)).status).toBe(404);
  });
});

describe('the rider who made a room is told so when they join it by its code — #948 N1', () => {
  it('answers `creator` true to its maker and false to anybody else', async () => {
    const w = await open();
    const [anna, bea] = [await rider(w), await rider(w)];
    const race = await madeRoom(w, anna.token);
    const joinedBy = async (token: string) =>
      (
        (await w.call('POST', '/v1/rooms/join', { token, body: { code: race.code } })).body as {
          creator: unknown;
        }
      ).creator;
    expect(await joinedBy(anna.token)).toBe(true);
    expect(await joinedBy(bea.token)).toBe(false);
    // Joining again changes nobody's role: the maker is still the one who may start it.
    expect(await joinedBy(anna.token)).toBe(true);
    await w.freshRead(async (store) => {
      expect(await store.getRoomCreator(race.roomId)).toBe(anna.athleteId);
    });
  });
});
