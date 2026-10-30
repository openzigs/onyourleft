// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **A moderator's removal of a rider from a room carries a statement of
 * reasons** (#1384, the owner's ruling of 2026-10-16), through the real
 * listener: refused without one, with nothing applied or logged; kept with
 * the log entry when given, and read back by the removed rider through
 * `GET /v1/statements`, the path the app uses; appealable (#911), and a
 * reversal lets them back into the room. A room HOST's removal is unchanged
 * and needs none.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { openDatabase } from '../store/node-sqlite.ts';
import {
  codeOf,
  startModerationWorld,
  TEST_STATEMENT,
  type ModerationWorld,
  type Rider,
} from './moderation-testing.ts';
import { createModeration } from './moderation.ts';
import { wholeModerationLog } from '../store/testing/index.ts';

let world: ModerationWorld | undefined;
afterEach(async () => {
  await world?.close();
  world = undefined;
});

async function start(): Promise<ModerationWorld> {
  world = await startModerationWorld();
  return world;
}

const ROOM = 'room-1';
const removePath = (rider: Rider): string =>
  `/v1/moderation/rooms/${ROOM}/athletes/${rider.athleteId}/remove`;

async function statementsOf(w: ModerationWorld, rider: Rider) {
  const answer = await w.call('GET', '/v1/statements', { token: rider.token });
  expect(answer.status, JSON.stringify(answer.body)).toBe(200);
  return (answer.body as { statements: { statementId: number; restriction: string }[] }).statements;
}

describe('a moderator removing a rider from a room (#1384)', () => {
  it('is refused without a statement of reasons, and nothing is applied or logged', async () => {
    const w = await start();
    const bea = await w.rider('Bea');
    const refused = await w.as(w.owner, 'POST', removePath(bea), { reason: 'Abusive in the room' });
    expect(refused.status).toBe(400);
    expect(codeOf(refused.body)).toBe('validation_failed');
    expect((refused.body as { error: { fields: { field: string }[] } }).error.fields).toEqual([
      expect.objectContaining({ field: 'statement' }),
    ]);
    expect(await w.freshRead((store) => store.isRemovedFromRoom(ROOM, bea.athleteId))).toBe(false);
    expect(await w.freshRead((store) => wholeModerationLog(store))).toEqual([]);
    expect(await statementsOf(w, bea)).toEqual([]);
  });

  it('refuses a statement naming a coordinate, by the field and the rule and never the value', async () => {
    const w = await start();
    const bea = await w.rider('Bea');
    const facts = 'Seen at 51.50740, -0.12780 heckling riders.';
    const refused = await w.as(w.owner, 'POST', removePath(bea), {
      reason: 'Abusive in the room',
      statement: { ...TEST_STATEMENT, facts },
    });
    expect(refused.status).toBe(400);
    expect(JSON.stringify(refused.body)).not.toContain('51.5074');
    expect((refused.body as { error: { fields: unknown[] } }).error.fields).toEqual([
      { field: 'statement.facts', problem: 'must not name a coordinate (ADR 0004 decision D)' },
    ]);
    expect(await w.freshRead((store) => store.isRemovedFromRoom(ROOM, bea.athleteId))).toBe(false);
  });

  it('with one, removes them, and the rider reads it back through the statements route', async () => {
    const w = await start();
    const bea = await w.rider('Bea');
    const done = await w.as(w.owner, 'POST', removePath(bea), {
      reason: 'Abusive in the room',
      statement: TEST_STATEMENT,
    });
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    const { logId } = done.body as { logId: number };
    expect(await w.freshRead((store) => store.isRemovedFromRoom(ROOM, bea.athleteId))).toBe(true);
    expect(await statementsOf(w, bea)).toEqual([
      expect.objectContaining({
        statementId: logId,
        restriction: 'remove_from_room',
        facts: TEST_STATEMENT.facts,
        termsGround: TEST_STATEMENT.termsGround,
        automated: false,
        appeal: null,
      }),
    ]);
  });

  it('is appealable, and a reversal lets the rider back into the room', async () => {
    const w = await start();
    const bea = await w.rider('Bea');
    const done = await w.as(w.owner, 'POST', removePath(bea), {
      reason: 'Abusive in the room',
      statement: TEST_STATEMENT,
    });
    const { logId } = done.body as { logId: number };
    const filed = await w.call('POST', `/v1/statements/${String(logId)}/appeal`, {
      token: bea.token,
      body: { grounds: 'It was another rider with my name.' },
    });
    expect(filed.status, JSON.stringify(filed.body)).toBe(200);
    const { appealId } = filed.body as { appealId: number };
    const decided = await w.as(
      w.owner,
      'POST',
      `/v1/moderation/appeals/${String(appealId)}/decide`,
      { outcome: 'reversed', decision: 'It was somebody else.' },
    );
    expect(decided.status, JSON.stringify(decided.body)).toBe(200);
    expect(await w.freshRead((store) => store.isRemovedFromRoom(ROOM, bea.athleteId))).toBe(false);
  });

  it('a reversal lifts only the removal it explains, never a later one after it was lifted', async () => {
    const w = await start();
    const bea = await w.rider('Bea');
    const first = await w.as(w.owner, 'POST', removePath(bea), {
      reason: 'Abusive in the room',
      statement: TEST_STATEMENT,
    });
    const { logId } = first.body as { logId: number };
    const filed = await w.call('POST', `/v1/statements/${String(logId)}/appeal`, {
      token: bea.token,
      body: { grounds: 'It was another rider with my name.' },
    });
    const { appealId } = filed.body as { appealId: number };
    // The removal is lifted some other way (its row is gone) and a new one is
    // made later: the reversal of the first must leave the second standing.
    const database = openDatabase(w.path);
    try {
      database.exec(`DELETE FROM room_removal WHERE room_id = '${ROOM}'`);
    } finally {
      database.close();
    }
    w.clock.ms += 5_000;
    const again = await w.as(w.owner, 'POST', removePath(bea), {
      reason: 'Abusive again',
      statement: TEST_STATEMENT,
    });
    expect(again.status, JSON.stringify(again.body)).toBe(200);
    await w.as(w.owner, 'POST', `/v1/moderation/appeals/${String(appealId)}/decide`, {
      outcome: 'reversed',
      decision: 'The first was somebody else.',
    });
    expect(await w.freshRead((store) => store.isRemovedFromRoom(ROOM, bea.athleteId))).toBe(true);
  });
});

describe('a room host removing a rider (#1384: unchanged)', () => {
  it('needs no statement, and writes none', async () => {
    const w = await start();
    const anna = await w.rider('Anna');
    const bea = await w.rider('Bea');
    const removed = await w.freshRead(async (store) =>
      createModeration({
        store,
        now: () => w.clock.ms,
        moderators: { owner: w.owner.device.publicKey },
      }).removeFromRoom(anna.athleteId, 'host', ROOM, bea.athleteId, { reason: 'Rude' }),
    );
    expect(removed.ok).toBe(true);
    expect(await w.freshRead((store) => store.isRemovedFromRoom(ROOM, bea.athleteId))).toBe(true);
    expect(await statementsOf(w, bea)).toEqual([]);
  });
});
