// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **Appeals** (#911), through the real listener: a rider — a suspended one
 * through the way-out session — appeals the decision a statement of reasons
 * explains; the moderators' queue shows it; deciding it is logged, and a
 * reversal lifts the restriction in the same transaction. Every result is
 * read back through the path its consumer uses: the rider's
 * `GET /v1/statements`, the moderators' queue and log, and signing in.
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

let world: ModerationWorld | undefined;
afterEach(async () => {
  await world?.close();
  world = undefined;
});

async function start(): Promise<ModerationWorld> {
  world = await startModerationWorld();
  return world;
}

/** Restrict `rider` as `by`, and answer the statement's id. */
async function restrict(
  w: ModerationWorld,
  rider: Rider,
  path: 'suspend' | 'hide-display-name',
  by: Rider = w.owner,
): Promise<number> {
  const done = await w.as(by, 'POST', `/v1/moderation/athletes/${rider.athleteId}/${path}`, {
    reason: 'Abuse',
    statement: TEST_STATEMENT,
  });
  expect(done.status, JSON.stringify(done.body)).toBe(200);
  return (done.body as { logId: number }).logId;
}

/** A suspended rider's way-out session (#898). */
async function wayOut(w: ModerationWorld, rider: Rider): Promise<string> {
  w.clock.ms += 60_000;
  const opened = await w.call('POST', '/v1/auth/leave-session', {
    body: await rider.device.statement(await w.nonceFor(rider.device)),
  });
  expect(opened.status).toBe(200);
  return (opened.body as { sessionToken: string }).sessionToken;
}

const GROUNDS = 'I was quoting the other rider, not abusing them.';

async function appealOf(w: ModerationWorld, token: string) {
  const read = await w.call('GET', '/v1/statements', { token });
  expect(read.status).toBe(200);
  return (read.body as { statements: { appeal: unknown }[] }).statements[0]?.appeal;
}

describe('appealing a decision (#911)', () => {
  it('lets a SUSPENDED rider appeal through the way-out session, kept with the decision it names', async () => {
    const w = await start();
    const bea = await w.rider('Bea');
    const statementId = await restrict(w, bea, 'suspend');
    const token = await wayOut(w, bea);
    const filed = await w.call('POST', `/v1/statements/${String(statementId)}/appeal`, {
      token,
      body: { grounds: GROUNDS },
    });
    expect(filed.status, JSON.stringify(filed.body)).toBe(200);
    expect(await appealOf(w, token)).toEqual({
      appealId: (filed.body as { appealId: number }).appealId,
      filedAt: Math.floor(w.clock.ms / 1000),
      grounds: GROUNDS,
      outcome: null,
      decision: null,
      moderatorConflict: null,
      decidedAt: null,
    });
    // The way-out session reaches nothing else new: signing in is still refused.
    expect(codeOf((await w.signIn(bea.device)).body)).toBe('account_suspended');
  });

  it('takes one appeal per decision, and none against a decision about somebody else', async () => {
    const w = await start();
    const anna = await w.rider('Anna');
    const bea = await w.rider('Bea');
    const statementId = await restrict(w, bea, 'hide-display-name');
    const path = `/v1/statements/${String(statementId)}/appeal`;
    const notAnnas = await w.as(anna, 'POST', path, { grounds: GROUNDS });
    expect(notAnnas.status).toBe(404);
    expect(codeOf(notAnnas.body)).toBe('not_found');
    expect((await w.as(bea, 'POST', path, { grounds: GROUNDS })).status).toBe(200);
    const again = await w.as(bea, 'POST', path, { grounds: GROUNDS });
    expect(again.status).toBe(409);
    expect(codeOf(again.body)).toBe('already_appealed');
    expect(
      (await w.as(bea, 'POST', '/v1/statements/999999/appeal', { grounds: GROUNDS })).status,
    ).toBe(404);
  });

  it('refuses grounds that are empty, too long, or name a coordinate — by the rule, never the value', async () => {
    const w = await start();
    const bea = await w.rider('Bea');
    const path = `/v1/statements/${String(await restrict(w, bea, 'hide-display-name'))}/appeal`;
    for (const grounds of ['  ', 'x'.repeat(2001), 'I was at 51.50722, -0.12750 all day']) {
      const refused = await w.as(bea, 'POST', path, { grounds });
      expect(refused.status).toBe(400);
      expect(JSON.stringify(refused.body)).not.toContain('51.50722');
    }
    expect(await w.freshRead((store) => store.listAppeals(bea.athleteId))).toEqual([]);
  });
});

describe('deciding an appeal (#911)', () => {
  async function appealed(w: ModerationWorld, path: 'suspend' | 'hide-display-name', by?: Rider) {
    const bea = await w.rider('Bea');
    const statementId = await restrict(w, bea, path, by);
    const token = path === 'suspend' ? await wayOut(w, bea) : bea.token;
    const filed = await w.call('POST', `/v1/statements/${String(statementId)}/appeal`, {
      token,
      body: { grounds: GROUNDS },
    });
    const appealId = (filed.body as { appealId: number }).appealId;
    return { bea, token, appealId };
  }

  it('shows the moderators the open appeal with the decision it appeals', async () => {
    const w = await start();
    const { bea, appealId } = await appealed(w, 'suspend');
    const queue = await w.as(w.owner, 'GET', '/v1/moderation/appeals');
    expect(queue.status).toBe(200);
    expect((queue.body as { appeals: unknown[] }).appeals).toEqual([
      expect.objectContaining({
        appealId,
        grounds: GROUNDS,
        appellantAthleteId: bea.athleteId,
        restriction: 'suspend',
        facts: TEST_STATEMENT.facts,
        decidedBy: w.owner.athleteId,
      }),
    ]);
    const rider = await w.rider('Somebody');
    expect((await w.as(rider, 'GET', '/v1/moderation/appeals')).status).toBe(404);
  });

  it('lifts the suspension in the same transaction as the log entry when it is reversed, and declares the conflict', async () => {
    const w = await start();
    const { bea, token, appealId } = await appealed(w, 'suspend');
    const decided = await w.as(
      w.owner,
      'POST',
      `/v1/moderation/appeals/${String(appealId)}/decide`,
      {
        outcome: 'reversed',
        decision: 'You were quoting. The suspension is lifted.',
      },
    );
    expect(decided.status, JSON.stringify(decided.body)).toBe(200);
    // The owner suspended Bea and decided the appeal: the owner's ruling of 2026-09-30.
    expect(decided.body).toMatchObject({ moderatorConflict: true });
    expect((await w.freshRead((store) => store.getAthlete(bea.athleteId)))?.suspendedAt).toBeNull();
    w.clock.ms += 60_000;
    expect((await w.signIn(bea.device)).status).toBe(200);
    const [entry] = (await w.freshRead((store) => store.listModerationLog())).slice(-1);
    expect(entry).toMatchObject({
      action: 'reverse_appeal',
      actorAthleteId: w.owner.athleteId,
      targetAthleteId: bea.athleteId,
      reason: 'You were quoting. The suspension is lifted.',
      id: (decided.body as { logId: number }).logId,
    });
    // The way-out session ended with the suspension; a full session reads the outcome.
    expect((await w.call('GET', '/v1/statements', { token })).status).toBe(401);
    const session = (await w.signIn(bea.device)).body.sessionToken as string;
    expect(await appealOf(w, session)).toMatchObject({
      outcome: 'reversed',
      decision: 'You were quoting. The suspension is lifted.',
      moderatorConflict: true,
    });
    expect(
      (await w.as(w.owner, 'GET', '/v1/moderation/appeals')).body as { appeals: unknown[] },
    ).toEqual({ appeals: [] });
  });

  it('restores a hidden display name when it is reversed, as other riders read it', async () => {
    const w = await start();
    const { bea, appealId } = await appealed(w, 'hide-display-name');
    const anna = await w.rider('Anna');
    const before = await w.as(anna, 'GET', `/v1/athletes/${bea.athleteId}`);
    expect(before.body).toMatchObject({ displayName: 'Rider' });
    await w.as(w.owner, 'POST', `/v1/moderation/appeals/${String(appealId)}/decide`, {
      outcome: 'reversed',
      decision: 'It is a family name.',
    });
    const after = await w.as(anna, 'GET', `/v1/athletes/${bea.athleteId}`);
    expect(after.body).toMatchObject({ displayName: 'Bea' });
  });

  it('leaves the restriction when it is upheld, decides once, and declares no conflict for another moderator', async () => {
    const w = await start();
    const { bea, appealId } = await appealed(w, 'suspend', w.deputy);
    const path = `/v1/moderation/appeals/${String(appealId)}/decide`;
    const upheld = await w.as(w.owner, 'POST', path, {
      outcome: 'upheld',
      decision: 'The messages were abuse.',
    });
    expect(upheld.status).toBe(200);
    expect(upheld.body).toMatchObject({ moderatorConflict: false });
    expect(
      (await w.freshRead((store) => store.getAthlete(bea.athleteId)))?.suspendedAt,
    ).not.toBeNull();
    const twice = await w.as(w.owner, 'POST', path, {
      outcome: 'reversed',
      decision: 'Changed my mind.',
    });
    expect(twice.status).toBe(409);
    expect(
      (await w.freshRead((store) => store.listModerationLog())).filter((each) =>
        each.action.endsWith('_appeal'),
      ),
    ).toHaveLength(1);
    // And the schema itself refuses to rewrite a decided appeal.
    const database = openDatabase(w.path);
    try {
      expect(() => database.exec(`UPDATE appeal SET outcome = 'reversed'`)).toThrow(/decided once/);
      expect(() => database.exec('DELETE FROM appeal')).toThrow(/never deleted/);
    } finally {
      database.close();
    }
  });

  it('refuses an outcome that is neither, and a decision with a coordinate', async () => {
    const w = await start();
    const { appealId } = await appealed(w, 'hide-display-name');
    const path = `/v1/moderation/appeals/${String(appealId)}/decide`;
    expect((await w.as(w.owner, 'POST', path, { outcome: 'maybe', decision: 'x' })).status).toBe(
      400,
    );
    expect(
      (
        await w.as(w.owner, 'POST', path, {
          outcome: 'upheld',
          decision: 'Seen at 51.50722, -0.12750',
        })
      ).status,
    ).toBe(400);
    expect(await w.freshRead((store) => store.listOpenAppeals())).toHaveLength(1);
  });
});
