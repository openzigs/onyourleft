// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **Statements of reasons** (#910), through the real listener: a restriction
 * is refused without its Art. 17(3) fields, the fields are kept with the log
 * entry in one transaction, and the affected rider — suspended or not —
 * reads them back through `GET /v1/statements`, which is the path the app
 * uses, and nobody else's.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { NO_LEGAL_SETTINGS } from '../legal.ts';
import {
  codeOf,
  startModerationWorld,
  TEST_STATEMENT,
  type ModerationWorld,
  type Rider,
} from './moderation-testing.ts';
import { namesACoordinate, readStatementFields } from './statements.ts';
import { wholeModerationLog } from '../store/testing/index.ts';

let world: ModerationWorld | undefined;
afterEach(async () => {
  await world?.close();
  world = undefined;
});

async function start(): Promise<ModerationWorld> {
  world = await startModerationWorld({
    config: {
      legal: { ...NO_LEGAL_SETTINGS, contactEmail: 'moderator@club.example' },
    },
  });
  return world;
}

interface StatementRead {
  readonly statementId: number;
  readonly restriction: string;
  readonly facts: string;
  readonly [field: string]: unknown;
}

async function statementsOf(w: ModerationWorld, rider: Rider, token = rider.token) {
  const answer = await w.call('GET', '/v1/statements', { token });
  expect(answer.status, JSON.stringify(answer.body)).toBe(200);
  return (answer.body as { statements: StatementRead[] }).statements;
}

const FULL = {
  facts: 'The display name is a slur aimed at another rider.',
  decidedOn: 'report',
  legalGround: null,
  termsGround: 'The terms of service, on abuse of other riders.',
  notifierNamed: null,
  moderatorConflict: true,
  endsAt: null,
};

describe('a restriction carries its statement of reasons (#910)', () => {
  it('is refused without one, and nothing is applied or logged', async () => {
    const w = await start();
    const bea = await w.rider('Bea');
    for (const path of ['suspend', 'hide-display-name']) {
      const refused = await w.as(
        w.owner,
        'POST',
        `/v1/moderation/athletes/${bea.athleteId}/${path}`,
        {
          reason: 'Abuse',
        },
      );
      expect(refused.status, path).toBe(400);
      expect(codeOf(refused.body)).toBe('validation_failed');
    }
    expect(await w.freshRead((store) => wholeModerationLog(store))).toEqual([]);
    const athlete = await w.freshRead((store) => store.getAthlete(bea.athleteId));
    expect(athlete).toMatchObject({ suspendedAt: null, displayNameHiddenAt: null });
    expect(await statementsOf(w, bea)).toEqual([]);
  });

  it('is kept with the log entry, and the rider reads every Art. 17(3) part of it, redress included', async () => {
    const w = await start();
    const bea = await w.rider('Bea');
    const done = await w.as(
      w.owner,
      'POST',
      `/v1/moderation/athletes/${bea.athleteId}/hide-display-name`,
      {
        reason: 'Slur',
        statement: FULL,
      },
    );
    expect(done.status).toBe(200);
    const { logId } = done.body as { logId: number };
    expect(await statementsOf(w, bea)).toEqual([
      {
        statementId: logId,
        at: Math.floor(w.clock.ms / 1000),
        restriction: 'hide_display_name',
        endsAt: null,
        facts: FULL.facts,
        decidedOn: 'report',
        legalGround: null,
        termsGround: FULL.termsGround,
        notifierNamed: null,
        moderatorConflict: true,
        automated: false,
        appeal: null,
        redress: {
          appeal: true,
          contactEmail: 'moderator@club.example',
          outOfCourt: false,
          court: true,
        },
      },
    ]);
  });

  it('is read by a SUSPENDED rider through the way-out session, which reaches nothing else new', async () => {
    const w = await start();
    const bea = await w.rider('Bea');
    expect(
      (
        await w.as(w.owner, 'POST', `/v1/moderation/athletes/${bea.athleteId}/suspend`, {
          reason: 'Cheating',
          statement: { ...TEST_STATEMENT, endsAt: Math.floor(w.clock.ms / 1000) + 86_400 },
        })
      ).status,
    ).toBe(200);
    // Signing in is refused, as since #775.
    w.clock.ms += 60_000;
    expect(codeOf((await w.signIn(bea.device)).body)).toBe('account_suspended');
    const opened = await w.call('POST', '/v1/auth/leave-session', {
      body: await bea.device.statement(await w.nonceFor(bea.device)),
    });
    expect(opened.status).toBe(200);
    const token = (opened.body as { sessionToken: string }).sessionToken;
    const [statement, ...more] = await statementsOf(w, bea, token);
    expect(more).toEqual([]);
    expect(statement).toMatchObject({ restriction: 'suspend', facts: TEST_STATEMENT.facts });
    expect(statement?.endsAt).toBe(Math.floor((w.clock.ms - 60_000) / 1000) + 86_400);
    expect(codeOf((await w.call('GET', '/v1/auth/account', { token })).body)).toBe(
      'account_suspended',
    );
  });

  it('shows a rider their own statements and nobody else’s', async () => {
    const w = await start();
    const anna = await w.rider('Anna');
    const bea = await w.rider('Bea');
    await w.as(w.owner, 'POST', `/v1/moderation/athletes/${bea.athleteId}/hide-display-name`, {
      reason: 'Slur',
      statement: TEST_STATEMENT,
    });
    expect(await statementsOf(w, anna)).toEqual([]);
    expect(await statementsOf(w, bea)).toHaveLength(1);
  });

  it('never tells the rider who reported them, unless the moderator names them', async () => {
    const w = await start();
    const anna = await w.rider('Anna');
    const bea = await w.rider('Bea');
    await w.as(anna, 'POST', '/v1/reports', { athleteId: bea.athleteId, reason: 'Abusive name' });
    const [report] = await w.freshRead((store) => store.listOpenReports());
    await w.as(w.owner, 'POST', `/v1/moderation/athletes/${bea.athleteId}/hide-display-name`, {
      reason: 'Slur',
      reportId: report!.id,
      statement: TEST_STATEMENT,
    });
    const read = JSON.stringify(await statementsOf(w, bea));
    expect(read).not.toContain(anna.athleteId);
    expect(read).not.toContain('Abusive name');
    expect(read).not.toContain('Anna');
  });

  it('writes no statement for an action that changed nothing', async () => {
    const w = await start();
    const bea = await w.rider('Bea');
    const suspend = () =>
      w.as(w.owner, 'POST', `/v1/moderation/athletes/${bea.athleteId}/suspend`, {
        reason: 'Cheating',
        statement: TEST_STATEMENT,
      });
    expect((await suspend()).status).toBe(200);
    expect((await suspend()).status).toBe(409);
    expect(await w.freshRead((store) => store.listStatements(bea.athleteId))).toHaveLength(1);
  });

  it('refuses, in the database itself, any change to a statement once written', async () => {
    const w = await start();
    const bea = await w.rider('Bea');
    await w.as(w.owner, 'POST', `/v1/moderation/athletes/${bea.athleteId}/suspend`, {
      reason: 'Cheating',
      statement: TEST_STATEMENT,
    });
    const { openDatabase } = await import('../store/node-sqlite.ts');
    const database = openDatabase(w.path);
    try {
      expect(() => database.exec(`UPDATE statement SET facts = 'rewritten'`)).toThrow(
        /append-only/,
      );
      expect(() => database.exec('DELETE FROM statement')).toThrow(/append-only/);
    } finally {
      database.close();
    }
  });
});

describe('a statement’s fields, read (#910)', () => {
  const NOW = 1_790_000_000_000;
  const read = (fields: Record<string, unknown>) => readStatementFields(fields, NOW);

  it('needs the facts, what it was decided on, and the law or the terms', () => {
    expect(read({ decidedOn: 'report' })).toEqual({
      ok: false,
      fields: [
        { field: 'statement.facts', problem: 'must not be empty' },
        {
          field: 'statement.legalGround',
          problem: 'give the law relied on, the terms relied on, or both',
        },
      ],
    });
    expect(read({ facts: 'x', decidedOn: 'a hunch', termsGround: 't' })).toMatchObject({
      ok: false,
      fields: [{ field: 'statement.decidedOn' }],
    });
    expect(read({ facts: 'x', decidedOn: 'notice', legalGround: 'The law' })).toMatchObject({
      ok: true,
      fields: { legalGround: 'The law', termsGround: null, moderatorConflict: false },
    });
  });

  it('refuses a coordinate in any field, naming the field and the rule, never the value', () => {
    for (const field of ['facts', 'legalGround', 'termsGround', 'notifierNamed']) {
      const outcome = read({
        facts: 'x',
        decidedOn: 'report',
        termsGround: 't',
        [field]: 'Lives at 51.50722, -0.12750 by the park',
      });
      expect(outcome.ok, field).toBe(false);
      const said = JSON.stringify(outcome);
      expect(said).toContain(`statement.${field}`);
      expect(said).toContain('must not name a coordinate');
      expect(said).not.toContain('51.50722');
    }
  });

  it('refuses an end in the past', () => {
    expect(
      read({ facts: 'x', decidedOn: 'report', termsGround: 't', endsAt: NOW / 1000 - 1 }),
    ).toMatchObject({ ok: false, fields: [{ field: 'statement.endsAt' }] });
  });

  it('tells a coordinate from an ordinary number', () => {
    expect(namesACoordinate('51.50722, -0.12750')).toBe(true);
    expect(namesACoordinate('51°30′26″N')).toBe(true);
    expect(namesACoordinate('Section 3.2 of the terms, rule 4')).toBe(false);
    expect(namesACoordinate('He rode 42.195 km at 3.5 W/kg')).toBe(false);
  });
});
