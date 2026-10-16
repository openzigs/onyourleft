// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **One item hidden, and the rest left alone** (#913), through the real
 * listener: a room's listing, the route shown in a room, a row of a race's
 * result — each hidden with a statement of reasons, logged in the same
 * transaction, nothing deleted, and read back through the path a rider uses:
 * joining by the code, fetching the route, reading the result.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { openDatabase } from '../store/node-sqlite.ts';
import { madeRoom } from '../rooms/rooms-testing.ts';
import {
  codeOf,
  startModerationWorld,
  TEST_STATEMENT,
  type ModerationWorld,
  type Rider,
} from './moderation-testing.ts';
import { wholeModerationLog } from '../store/testing/index.ts';

let world: ModerationWorld | undefined;
afterEach(async () => {
  await world?.close();
  world = undefined;
});

async function start(): Promise<ModerationWorld> {
  world = await startModerationWorld({ registration: 'open' });
  return world;
}

const hide = (w: ModerationWorld, item: string, by: Rider = w.owner) =>
  w.as(by, 'POST', '/v1/moderation/items/hide', {
    item,
    reason: 'From a notice',
    statement: { ...TEST_STATEMENT, decidedOn: 'notice' },
  });

/** A room Anna made and Bea joined. */
async function room(w: ModerationWorld) {
  const anna = await w.rider('Anna');
  const bea = await w.rider('Bea');
  const made = await madeRoom(w, anna.token);
  expect((await w.as(bea, 'POST', '/v1/rooms/join', { code: made.code })).status).toBe(200);
  return { anna, bea, ...made };
}

/** A finished race in `roomId`: Anna first, Bea second, Cat third. */
async function finished(w: ModerationWorld, roomId: string, riders: readonly Rider[]) {
  await w.freshRead(async (store) => {
    for (const [index, each] of riders.entries()) {
      await store.putResult({
        roomId,
        athleteId: each.athleteId,
        finishMs: 600_000 + index * 1000,
        flags: 0,
        place: index + 1,
        wattsPerKilogram: 4 - index * 0.5,
        flaggedDurationsSeconds: [],
      });
    }
    await store.markRaceFinished(roomId, 1_790_000_100);
  });
}

interface Row {
  readonly place: number | null;
  readonly displayName: string | null;
  readonly you: boolean;
  readonly wattsPerKilogram: number | null;
  readonly finishMs: number | null;
}

async function rowsFor(w: ModerationWorld, viewer: Rider, roomId: string): Promise<readonly Row[]> {
  const got = await w.as(viewer, 'GET', `/v1/rooms/${roomId}/results`);
  expect(got.status).toBe(200);
  return (got.body as { rows: Row[] }).rows;
}

describe('hiding one row of a race’s result (#913)', () => {
  it('hides that row from every other rider, keeps it for its own, and leaves the rest', async () => {
    const w = await start();
    const { anna, bea, roomId, code } = await room(w);
    const cat = await w.rider('Cat');
    expect((await w.as(cat, 'POST', '/v1/rooms/join', { code })).status).toBe(200);
    await finished(w, roomId, [anna, bea, cat]);
    const hidden = await hide(w, `result:${roomId}:2`);
    expect(hidden.status, JSON.stringify(hidden.body)).toBe(200);
    for (const viewer of [anna, cat]) {
      const rows = await rowsFor(w, viewer, roomId);
      expect(rows.map((row) => row.place)).toEqual([1, 2, 3]);
      expect(rows[1]).toEqual({
        place: 2,
        displayName: null,
        you: false,
        finishMs: null,
        wattsPerKilogram: null,
        flags: [],
      });
      expect(rows[0]?.displayName).toBe('Anna');
      expect(rows[2]?.displayName).toBe('Cat');
    }
    // Bea's own row is hers, as before; nothing was deleted.
    expect((await rowsFor(w, bea, roomId))[1]).toMatchObject({
      you: true,
      wattsPerKilogram: 3.5,
    });
    expect(await w.freshRead((store) => store.listRoomResults(roomId))).toHaveLength(3);
  });

  it('writes the log entry and Bea’s statement in the same transaction, and Bea reads it', async () => {
    const w = await start();
    const { anna, bea, roomId } = await room(w);
    await finished(w, roomId, [anna, bea]);
    const { logId } = (await hide(w, `result:${roomId}:2`)).body as { logId: number };
    const [entry] = (await w.freshRead((store) => wholeModerationLog(store))).slice(-1);
    expect(entry).toMatchObject({
      id: logId,
      action: 'hide_item',
      targetAthleteId: bea.athleteId,
      actorAthleteId: w.owner.athleteId,
    });
    const read = await w.as(bea, 'GET', '/v1/statements');
    expect((read.body as { statements: unknown[] }).statements).toEqual([
      expect.objectContaining({
        statementId: logId,
        restriction: 'hide_item',
        decidedOn: 'notice',
      }),
    ]);
    // And Anna, whose item it is not, has none.
    expect(
      ((await w.as(anna, 'GET', '/v1/statements')).body as { statements: unknown[] }).statements,
    ).toEqual([]);
  });

  it('is restored for everybody when an appeal reverses it', async () => {
    const w = await start();
    const { anna, bea, roomId } = await room(w);
    await finished(w, roomId, [anna, bea]);
    const { logId } = (await hide(w, `result:${roomId}:2`)).body as { logId: number };
    const filed = await w.as(bea, 'POST', `/v1/statements/${String(logId)}/appeal`, {
      grounds: 'That was a fair ride.',
    });
    const { appealId } = filed.body as { appealId: number };
    await w.as(w.owner, 'POST', `/v1/moderation/appeals/${String(appealId)}/decide`, {
      outcome: 'reversed',
      decision: 'It was. Shown again.',
    });
    expect((await rowsFor(w, anna, roomId))[1]).toMatchObject({ displayName: 'Bea' });
  });
});

describe('hiding a room’s route, or its listing (#913)', () => {
  it('stops the route reaching any member but its maker, and deletes nothing', async () => {
    const w = await start();
    const { anna, bea, roomId, routeSha256 } = await room(w);
    expect((await w.as(bea, 'GET', `/v1/rooms/${roomId}/route`)).status).toBe(200);
    expect((await hide(w, `route:${roomId}`)).status).toBe(200);
    const refused = await w.as(bea, 'GET', `/v1/rooms/${roomId}/route`);
    expect(refused.status).toBe(404);
    expect(codeOf(refused.body)).toBe('not_found');
    expect((await w.as(anna, 'GET', `/v1/rooms/${roomId}/route`)).status).toBe(200);
    expect(w.roomRoutes.has(routeSha256)).toBe(true);
  });

  it('takes nobody new into a room whose listing is hidden — the answer a closed room gives', async () => {
    const w = await start();
    const { roomId, code } = await room(w);
    expect((await hide(w, `room:${roomId}`)).status).toBe(200);
    const cat = await w.rider('Cat');
    const refused = await w.as(cat, 'POST', '/v1/rooms/join', { code });
    expect(refused.status).toBe(404);
    expect(codeOf(refused.body)).toBe('not_found');
  });

  it('withholds a hidden room’s route from its members too, and shows it to its maker', async () => {
    const w = await start();
    const { anna, bea, roomId } = await room(w);
    expect((await hide(w, `room:${roomId}`)).status).toBe(200);
    expect((await w.as(bea, 'GET', `/v1/rooms/${roomId}/route`)).status).toBe(404);
    expect((await w.as(anna, 'GET', `/v1/rooms/${roomId}/route`)).status).toBe(200);
  });
});

describe('a hidden result row and an erased rider (#913)', () => {
  it('stays with its rider when a rider who did not finish erases their account', async () => {
    const w = await start();
    const { anna, bea, roomId, code } = await room(w);
    const cat = await w.rider('Cat');
    expect((await w.as(cat, 'POST', '/v1/rooms/join', { code })).status).toBe(200);
    await w.freshRead(async (store) => {
      await store.putResult({
        roomId,
        athleteId: anna.athleteId,
        finishMs: 600_000,
        flags: 0,
        place: 1,
        wattsPerKilogram: 4,
        flaggedDurationsSeconds: [],
      });
      for (const each of [bea, cat]) {
        await store.putResult({
          roomId,
          athleteId: each.athleteId,
          finishMs: null,
          flags: 0,
          place: null,
          wattsPerKilogram: 3,
          flaggedDurationsSeconds: [],
        });
      }
      await store.markRaceFinished(roomId, 1_790_000_100);
    });
    const order = [bea, cat].sort((a, b) => (a.athleteId < b.athleteId ? -1 : 1));
    const [second, third] = order as [Rider, Rider];
    expect((await hide(w, `result:${roomId}:3`)).status).toBe(200);
    expect((await rowsFor(w, anna, roomId))[2]?.displayName).toBeNull();
    await w.freshRead((store) => store.eraseAthlete(second.athleteId));
    const rows = await rowsFor(w, anna, roomId);
    expect(rows.map((row) => row.displayName)).toEqual(['Anna', null]);
    expect((await rowsFor(w, third, roomId))[1]).toMatchObject({ you: true });
  });
});

describe('what hiding an item refuses (#913)', () => {
  it('needs a statement, an identifier, and an item that is somebody’s', async () => {
    const w = await start();
    const { roomId } = await room(w);
    const bare = await w.as(w.owner, 'POST', '/v1/moderation/items/hide', {
      item: `route:${roomId}`,
      reason: 'x',
    });
    expect(bare.status).toBe(400);
    for (const item of ['nonsense', 'rider:abc']) {
      expect((await hide(w, item)).status, item).toBe(400);
    }
    // A row of a race that is not over, and a room nobody made: nobody's item.
    expect((await hide(w, `result:${roomId}:1`)).status).toBe(404);
    expect((await hide(w, `room:${'f'.repeat(32)}`)).status).toBe(404);
    expect(
      (await w.freshRead((store) => wholeModerationLog(store))).filter((each) =>
        each.action.includes('hide_item'),
      ),
    ).toEqual([]);
  });

  it('hides an item once, refuses an ordinary rider, and refuses an item of a moderator’s, logging the attempt', async () => {
    const w = await start();
    const { anna, roomId } = await room(w);
    expect((await hide(w, `route:${roomId}`, anna)).status).toBe(404);
    expect((await hide(w, `route:${roomId}`)).status).toBe(200);
    expect((await hide(w, `route:${roomId}`)).status).toBe(409);
    const owners = await madeRoom(w, w.owner.token);
    const own = await hide(w, `room:${owners.roomId}`, w.deputy);
    expect(own.status).toBe(409);
    expect((await w.freshRead((store) => wholeModerationLog(store))).at(-1)).toMatchObject({
      action: 'refused_hide_item',
      targetAthleteId: w.owner.athleteId,
    });
  });

  it('is never deleted, and changed only by being restored', async () => {
    const w = await start();
    const { roomId } = await room(w);
    await hide(w, `route:${roomId}`);
    const database = openDatabase(w.path);
    try {
      expect(() => database.exec(`UPDATE hidden_item SET item = 'room:x'`)).toThrow(
        /restored once/,
      );
      expect(() => database.exec('DELETE FROM hidden_item')).toThrow(/never deleted/);
    } finally {
      database.close();
    }
  });
});
