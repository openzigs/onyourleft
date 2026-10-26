// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **Blocking a rider from a race's result — #1516**, through the real handler
 * and listener. The app never holds another rider's athlete id, so it blocks
 * by the ROW the result names a rider on: `POST /v1/rooms/{roomId}/blocks`.
 *
 * Every block is read back the two ways a real consumer reads it: the
 * blocker's own `GET /v1/blocks`, and the result itself, where a block
 * between two riders, either way, takes each one's name off the other's row.
 *
 * And the privacy half: a row the result does not name to the caller — their
 * own, an erased rider's, one who blocked them — blocks nobody, so a block by
 * row never hands the caller an athlete id the result did not already put a
 * name to (`GET /v1/blocks` lists the ids a rider blocked).
 */

import { afterEach, describe, expect, it } from 'vitest';

import {
  startIdentityInstance,
  testDevice,
  type IdentityInstance,
} from '../auth/identity-testing.ts';
import { madeRoom, riderIn } from './rooms-testing.ts';

let world: IdentityInstance | undefined;
afterEach(async () => {
  await world?.close();
  world = undefined;
});

type Rider = Awaited<ReturnType<typeof riderIn>>;

const NAMES = ['Anna', 'Bea', 'Cat'] as const;

/** Three riders, named, who finished a race in that order; and a fourth who never rode it. */
async function finishedRace(finished = true) {
  world = await startIdentityInstance();
  const w = world;
  const riders: Rider[] = [];
  for (const name of NAMES) {
    const each = await riderIn(w, await testDevice());
    const named = await w.call('POST', '/v1/auth/display-name', {
      token: each.token,
      body: { displayName: name },
    });
    expect(named.status).toBeLessThan(300);
    riders.push(each);
  }
  const [anna, bea, cat] = riders as [Rider, Rider, Rider];
  const outsider = await riderIn(w, await testDevice());
  const room = await madeRoom(w, anna.token);
  await w.freshRead(async (store) => {
    for (const [index, each] of riders.entries()) {
      await store.putResult({
        roomId: room.roomId,
        athleteId: each.athleteId,
        finishMs: 600_000 + index * 1_000,
        flags: 0,
        place: index + 1,
        wattsPerKilogram: 4,
        flaggedDurationsSeconds: [],
      });
    }
    if (finished) await store.markRaceFinished(room.roomId, 1_790_000_100);
  });
  const block = (rider: Rider, row: unknown) =>
    w.call('POST', `/v1/rooms/${room.roomId}/blocks`, { token: rider.token, body: { row } });
  const blocks = async (rider: Rider) =>
    ((await w.call('GET', '/v1/blocks', { token: rider.token })).body as { athleteIds: string[] })
      .athleteIds;
  const names = async (rider: Rider) =>
    (
      (await w.call('GET', `/v1/rooms/${room.roomId}/results`, { token: rider.token })).body as {
        rows: { displayName: string | null }[];
      }
    ).rows.map((row) => row.displayName);
  return { w, anna, bea, cat, outsider, room, block, blocks, names };
}

describe('blocking a rider from a race’s result — #1516', () => {
  it('blocks the rider on a named row: the blocker’s own block, and each name off the other’s result', async () => {
    const { anna, bea, cat, block, blocks, names } = await finishedRace();
    expect(await names(bea)).toEqual(['Anna', 'Bea', 'Cat']);

    const blocked = await block(bea, 1);
    expect(blocked.status).toBe(204);
    // The answer names nobody.
    expect(blocked.body).toBeNull();
    expect(await blocks(bea)).toEqual([anna.athleteId]);
    // A block is the blocker's own: Anna has none, and Cat is untouched.
    expect(await blocks(anna)).toEqual([]);
    expect(await blocks(cat)).toEqual([]);
    // Either way, neither is named to the other; Cat still sees both.
    expect(await names(bea)).toEqual([null, 'Bea', 'Cat']);
    expect(await names(anna)).toEqual(['Anna', null, 'Cat']);
    expect(await names(cat)).toEqual(['Anna', 'Bea', 'Cat']);
  });

  it('blocks nobody from a row the result does not name to the caller, so it hands over no athlete id', async () => {
    const { w, bea, cat, block, blocks, names } = await finishedRace();
    // Cat blocks Bea by id: Bea now sees Cat's row as "a rider".
    expect((await w.call('POST', `/v1/blocks/${bea.athleteId}`, { token: cat.token })).status).toBe(
      204,
    );
    expect(await names(bea)).toEqual(['Anna', 'Bea', null]);
    // Bea "blocks" that row: the same answer as any block, and nothing kept.
    expect((await block(bea, 3)).status).toBe(204);
    expect(await blocks(bea)).toEqual([]);
    // Her own row blocks nobody either.
    expect((await block(bea, 2)).status).toBe(204);
    expect(await blocks(bea)).toEqual([]);
  });

  it('is not_found, and blocks nobody, for a row out of range, a stranger, or a race not yet over', async () => {
    const { bea, outsider, block, blocks } = await finishedRace();
    for (const row of [0, 4, -1, 1.5, '1']) {
      expect((await block(bea, row)).status, String(row)).not.toBe(204);
    }
    expect(await blocks(bea)).toEqual([]);
    // Not a rider in the race: the same as a race that does not exist.
    expect((await block(outsider, 1)).status).toBe(404);
    expect(await blocks(outsider)).toEqual([]);
  });

  it('is not_found while the race is still being ridden (ADR 0028 D-7.7)', async () => {
    const { bea, block, blocks } = await finishedRace(false);
    expect((await block(bea, 1)).status).toBe(404);
    expect(await blocks(bea)).toEqual([]);
  });
});

/**
 * **Seeing and undoing those blocks — #1529**: the app never holds another
 * rider's athlete id, so it reads its blocks from `GET /v1/blocks/handles`,
 * each by an opaque handle and the name the result showed it, and undoes one
 * with `DELETE /v1/blocks/handles/{handle}`. Read back through the result
 * itself, where the names come back, and the blocker's own list.
 */
describe('seeing and undoing a block made from a race’s result — #1529', () => {
  type Held = { handle: string; name: string | null; blockedAt: number };
  const handles = async (w: IdentityInstance, rider: Rider): Promise<Held[]> => {
    const answer = await w.call('GET', '/v1/blocks/handles', { token: rider.token });
    expect(answer.status).toBe(200);
    return (answer.body as { blocks: Held[] }).blocks;
  };
  const unblock = (w: IdentityInstance, rider: Rider, handle: string) =>
    w.call('DELETE', `/v1/blocks/handles/${handle}`, { token: rider.token });

  it('lists the block by the name the row showed and a handle, never an athlete id', async () => {
    const { w, anna, bea, block } = await finishedRace();
    expect((await block(bea, 1)).status).toBe(204);
    const held = await handles(w, bea);
    expect(held).toEqual([
      {
        handle: expect.stringMatching(/^[0-9a-f]{32}$/) as unknown,
        name: 'Anna',
        blockedAt: expect.any(Number) as unknown,
      },
    ]);
    // Nothing in the answer is Anna's id.
    expect(JSON.stringify(held)).not.toContain(anna.athleteId);
    expect(await handles(w, anna)).toEqual([]);
  });

  it('lists a block made by id with no name: a name is kept only from a row the caller was shown', async () => {
    const { w, bea, cat } = await finishedRace();
    expect((await w.call('POST', `/v1/blocks/${bea.athleteId}`, { token: cat.token })).status).toBe(
      204,
    );
    expect((await handles(w, cat)).map((each) => each.name)).toEqual([null]);
  });

  it('undoes the block by its handle: the names come back on the result, and the list is empty', async () => {
    const { w, bea, anna, block, blocks, names } = await finishedRace();
    await block(bea, 1);
    const [held] = await handles(w, bea);
    expect((await unblock(w, bea, held?.handle ?? '')).status).toBe(204);
    expect(await handles(w, bea)).toEqual([]);
    expect(await blocks(bea)).toEqual([]);
    expect(await names(bea)).toEqual(['Anna', 'Bea', 'Cat']);
    expect(await names(anna)).toEqual(['Anna', 'Bea', 'Cat']);
  });

  it('undoes nothing for another rider’s handle, or one that is not a handle, and answers the same', async () => {
    const { w, bea, anna, cat, block, names } = await finishedRace();
    await block(bea, 1);
    const [held] = await handles(w, bea);
    for (const [rider, handle] of [
      [anna, held?.handle ?? ''],
      [cat, held?.handle ?? ''],
      [bea, '0'.repeat(32)],
      [bea, 'not-a-handle'],
    ] as const) {
      expect((await unblock(w, rider, handle)).status).toBe(204);
    }
    expect((await handles(w, bea)).map((each) => each.name)).toEqual(['Anna']);
    expect(await names(anna)).toEqual(['Anna', null, 'Cat']);
  });
});
