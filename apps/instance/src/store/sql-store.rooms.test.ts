// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A rider's room (#784, migration 0013), each claim read back on a fresh
 * connection (`docs/agents/quality-gate.md` §5): the room, its course, its code's digest and its
 * creator are written together or not at all; membership is per (room,
 * athlete); a room is over once.
 */

import { afterEach, describe, expect, it } from 'vitest';
import type { NewPrivateRoom } from './sql-store.ts';
import {
  ATHLETE_A,
  ATHLETE_B,
  ATHLETE_C,
  createStoreHarness,
  seedWorld,
  SHARED_PRIVATE_ROOM,
  type StoreHarness,
} from './testing/index.ts';

let harness: StoreHarness | undefined;
afterEach(async () => {
  await harness?.destroy();
  harness = undefined;
});

async function world(): Promise<StoreHarness> {
  harness = await createStoreHarness();
  await harness.write(seedWorld);
  return harness;
}

const ROUTE = '1'.repeat(64);

function newRoom(id: string, code: string, creator = ATHLETE_B): NewPrivateRoom {
  return {
    room: { id, kind: 'race', visibility: 'private', routeSha256: ROUTE, physicsVersion: 1 },
    course: {
      roomId: id,
      lengthMetres: 2_500,
      grades: [
        [0, 0],
        [500, 3.5],
      ],
      ridingPosition: 'hoods',
      capacity: null,
      countdownMs: 10_000,
      rejoinWindowMs: null,
      raceStartedAt: null,
    },
    codeSha256: code.repeat(64),
    routeLoop: true,
    creatorAthleteId: creator,
    createdAt: 1_790_001_000,
  };
}

describe('a rider’s room — #784', () => {
  it('writes the room, its course, its code’s digest and its creator together', async () => {
    const opened = await world();
    expect(await opened.write((store) => store.createPrivateRoom(newRoom('mine', 'a')))).toBe(
      'created',
    );
    await opened.read(async (store) => {
      expect(await store.getRoom('mine')).toEqual({
        id: 'mine',
        kind: 'race',
        visibility: 'private',
        routeSha256: ROUTE,
        physicsVersion: 1,
      });
      expect((await store.getRoomCourse('mine'))?.grades).toEqual([
        [0, 0],
        [500, 3.5],
      ]);
      expect(await store.getPrivateRoom('mine')).toEqual({
        roomId: 'mine',
        codeSha256: 'a'.repeat(64),
        routeLoop: true,
        createdAt: 1_790_001_000,
        closedAt: null,
      });
      expect((await store.findPrivateRoomByCode('a'.repeat(64)))?.roomId).toBe('mine');
      expect(await store.isRoomMember('mine', ATHLETE_B)).toBe(true);
      expect(await store.isRoomMember('mine', ATHLETE_A)).toBe(false);
    });
  });

  it('refuses a second room with the same code’s digest, and writes nothing of it', async () => {
    const opened = await world();
    await opened.write((store) => store.createPrivateRoom(newRoom('first', 'b')));
    expect(await opened.write((store) => store.createPrivateRoom(newRoom('second', 'b')))).toBe(
      'code-taken',
    );
    await opened.read(async (store) => {
      expect(await store.getRoom('second')).toBeUndefined();
      expect(await store.getRoomCourse('second')).toBeUndefined();
      expect(await store.isRoomMember('second', ATHLETE_B)).toBe(false);
    });
  });

  it('holds membership per room and per athlete, keeping the first row', async () => {
    const opened = await world();
    await opened.write(async (store) => {
      await store.createPrivateRoom(newRoom('ours', 'c'));
      await store.addRoomMember('ours', ATHLETE_C, 1_790_001_100);
      await store.addRoomMember('ours', ATHLETE_C, 1_790_001_200);
      // Joining a room is not joining another.
      await store.addRoomMember(SHARED_PRIVATE_ROOM.id, ATHLETE_C, 1_790_001_300);
    });
    await opened.read(async (store) => {
      expect(await store.isRoomMember('ours', ATHLETE_C)).toBe(true);
      expect(await store.isRoomMember('ours', ATHLETE_A)).toBe(false);
      // The creator keeps their role: adding them again as a rider changes nothing.
      await store.addRoomMember('ours', ATHLETE_B, 1_790_001_400);
      expect(await store.isRoomMember('ours', ATHLETE_B)).toBe(true);
      // The owner's ruling of 2026-09-30: its creator is who may start it —
      // never a rider who joined, and nobody for a room nobody made.
      expect(await store.getRoomCreator('ours')).toBe(ATHLETE_B);
      expect(await store.getRoomCreator('no-such-room')).toBeUndefined();
    });
  });

  it('counts the open rooms an athlete MADE, and nobody else’s or any they only joined', async () => {
    const opened = await world();
    await opened.write(async (store) => {
      await store.createPrivateRoom(newRoom('b-one', 'f', ATHLETE_B));
      await store.createPrivateRoom(newRoom('b-two', 'g', ATHLETE_B));
      await store.createPrivateRoom(newRoom('c-one', 'h', ATHLETE_C));
      await store.addRoomMember('c-one', ATHLETE_B, 1_790_001_500);
      await store.closePrivateRoom('b-two', 1_790_001_600);
    });
    await opened.read(async (store) => {
      expect(await store.countOpenPrivateRoomsMadeBy(ATHLETE_B)).toBe(1);
      expect(await store.countOpenPrivateRoomsMadeBy(ATHLETE_C)).toBe(1);
      // ATHLETE_A made the seeded room, which is open.
      expect(await store.countOpenPrivateRoomsMadeBy(ATHLETE_A)).toBe(1);
    });
  });

  it('closes a room once, and counts only the open rooms that share its route', async () => {
    const opened = await world();
    await opened.write(async (store) => {
      await store.createPrivateRoom(newRoom('one', 'd'));
      await store.createPrivateRoom(newRoom('two', 'e'));
    });
    expect(await opened.read((store) => store.countOpenPrivateRoomsWithRoute(ROUTE, 'one'))).toBe(
      1,
    );
    expect(await opened.write((store) => store.closePrivateRoom('two', 1_790_002_000))).toBe(true);
    expect(await opened.write((store) => store.closePrivateRoom('two', 1_790_003_000))).toBe(false);
    await opened.read(async (store) => {
      expect((await store.getPrivateRoom('two'))?.closedAt).toBe(1_790_002_000);
      expect(await store.countOpenPrivateRoomsWithRoute(ROUTE, 'one')).toBe(0);
    });
  });

  it('lists the open rooms an athlete MADE, for their erasure — nobody else’s, none they joined, none over', async () => {
    const opened = await world();
    await opened.write(async (store) => {
      await store.createPrivateRoom(newRoom('b-one', 'f', ATHLETE_B));
      await store.createPrivateRoom(newRoom('b-two', 'g', ATHLETE_B));
      await store.createPrivateRoom(newRoom('b-over', 'i', ATHLETE_B));
      await store.createPrivateRoom(newRoom('c-one', 'h', ATHLETE_C));
      await store.addRoomMember('c-one', ATHLETE_B, 1_790_001_500);
      await store.closePrivateRoom('b-over', 1_790_001_600);
    });
    await opened.read(async (store) => {
      expect(await store.listOpenPrivateRoomsMadeBy(ATHLETE_B)).toEqual(['b-one', 'b-two']);
      expect(await store.listOpenPrivateRoomsMadeBy(ATHLETE_C)).toEqual(['c-one']);
      expect(await store.listOpenPrivateRoomsMadeBy(ATHLETE_A)).toEqual([SHARED_PRIVATE_ROOM.id]);
    });
  });

  it('lists every open room for the sweep: its age, whether its race started, and whether its creator is still here', async () => {
    const opened = await world();
    await opened.write(async (store) => {
      await store.createPrivateRoom(newRoom('started', 'j', ATHLETE_B));
      await store.markRaceStarted('started', 1_790_001_700);
      await store.createPrivateRoom(newRoom('orphan', 'k', ATHLETE_C));
      await store.createPrivateRoom(newRoom('shut', 'l', ATHLETE_C));
      await store.closePrivateRoom('shut', 1_790_001_800);
      await store.eraseAthlete(ATHLETE_C);
    });
    const rooms = await opened.read((store) => store.listOpenPrivateRooms());
    expect(rooms).toEqual([
      { roomId: 'orphan', createdAt: 1_790_001_000, raceStarted: false, creatorPresent: false },
      {
        roomId: SHARED_PRIVATE_ROOM.id,
        createdAt: 1_790_000_600,
        raceStarted: false,
        creatorPresent: true,
      },
      { roomId: 'started', createdAt: 1_790_001_000, raceStarted: true, creatorPresent: true },
    ]);
  });

  it('keeps the first time a race was said to be over', async () => {
    const opened = await world();
    await opened.write(async (store) => {
      await store.createPrivateRoom(newRoom('raced', 'm'));
    });
    expect(
      (await opened.read((store) => store.getRoomCourse('raced')))?.raceFinishedAt,
    ).toBeUndefined();
    await opened.write(async (store) => {
      await store.markRaceFinished('raced', 1_790_002_000);
      await store.markRaceFinished('raced', 1_790_003_000);
    });
    expect((await opened.read((store) => store.getRoomCourse('raced')))?.raceFinishedAt).toBe(
      1_790_002_000,
    );
  });
});
