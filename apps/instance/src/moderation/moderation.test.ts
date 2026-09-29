// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Reports, the moderators' actions and the audit log (#83), through the real
 * listener and a real SQLite file. Every claim about what is stored is read
 * back through a SECOND store on the same file.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { openDatabase } from '../store/node-sqlite.ts';
import { DEFAULT_MODERATION_LIMITS } from './moderation.ts';
import { codeOf, startModerationWorld, type ModerationWorld } from './moderation-testing.ts';

let world: ModerationWorld | undefined;
afterEach(async () => {
  await world?.close();
  world = undefined;
});

async function start(): Promise<ModerationWorld> {
  world = await startModerationWorld();
  return world;
}

const seconds = (w: ModerationWorld): number => Math.floor(w.clock.ms / 1000);

describe('blocking (#83)', () => {
  it('lists the caller’s own blocks, and an unblock gives the other rider back', async () => {
    const w = await start();
    const anna = await w.rider('Anna');
    const bea = await w.rider('Bea');
    expect((await w.as(anna, 'POST', `/v1/blocks/${bea.athleteId}`)).status).toBe(204);
    expect((await w.as(anna, 'POST', `/v1/blocks/${bea.athleteId}`)).status).toBe(204);
    expect((await w.as(anna, 'GET', '/v1/blocks')).body).toEqual({ athleteIds: [bea.athleteId] });
    expect((await w.as(bea, 'GET', '/v1/blocks')).body).toEqual({ athleteIds: [] });
    expect((await w.as(bea, 'GET', `/v1/athletes/${anna.athleteId}`)).status).toBe(404);

    // Bea cannot lift Anna's block: only the blocker's own row is deleted.
    expect((await w.as(bea, 'DELETE', `/v1/blocks/${anna.athleteId}`)).status).toBe(204);
    expect((await w.as(bea, 'GET', `/v1/athletes/${anna.athleteId}`)).status).toBe(404);

    expect((await w.as(anna, 'DELETE', `/v1/blocks/${bea.athleteId}`)).status).toBe(204);
    expect((await w.as(bea, 'GET', `/v1/athletes/${anna.athleteId}`)).body).toEqual({
      athleteId: anna.athleteId,
      displayName: 'Anna',
    });
    expect(await w.freshRead((store) => store.listBlocks(anna.athleteId))).toEqual([]);
  });

  it('is stored on the instance, read back through a fresh connection', async () => {
    const w = await start();
    const anna = await w.rider();
    const bea = await w.rider();
    await w.as(anna, 'POST', `/v1/blocks/${bea.athleteId}`);
    expect(
      await w.freshRead((store) => store.blockedEitherWay(bea.athleteId, anna.athleteId)),
    ).toBe(true);
  });
});

describe('reports (#83)', () => {
  it('capture the reporter, the target, the reason and the time', async () => {
    const w = await start();
    const anna = await w.rider();
    const bea = await w.rider();
    const answer = await w.as(anna, 'POST', '/v1/reports', {
      athleteId: bea.athleteId,
      reason: '  Abusive display name  ',
    });
    expect(answer.status).toBe(204);
    const [report, ...rest] = await w.freshRead((store) => store.listReports(anna.athleteId));
    expect(rest).toEqual([]);
    expect(report).toMatchObject({
      athleteId: anna.athleteId,
      targetAthleteId: bea.athleteId,
      reason: 'Abusive display name',
      createdAt: seconds(w),
      closedAt: null,
    });
  });

  it(`are rate-limited per reporter: ${String(DEFAULT_MODERATION_LIMITS.reportsPerWindow)} an hour`, async () => {
    const w = await start();
    const anna = await w.rider();
    const bea = await w.rider();
    const cat = await w.rider();
    const report = (from: typeof anna) =>
      w.as(from, 'POST', '/v1/reports', { athleteId: bea.athleteId, reason: 'Spam' });
    for (let each = 0; each < DEFAULT_MODERATION_LIMITS.reportsPerWindow; each += 1) {
      expect((await report(anna)).status, `report ${String(each + 1)}`).toBe(204);
    }
    const over = await report(anna);
    expect(over.status).toBe(429);
    expect(codeOf(over.body)).toBe('rate_limited');
    expect((await w.freshRead((store) => store.listReports(anna.athleteId))).length).toBe(
      DEFAULT_MODERATION_LIMITS.reportsPerWindow,
    );
    // Another reporter has an allowance of their own.
    expect((await report(cat)).status).toBe(204);
    // And the window moves on.
    w.clock.ms += DEFAULT_MODERATION_LIMITS.reportWindowSeconds * 1000;
    expect((await report(anna)).status).toBe(204);
  });

  it('refuses a report with no reason, naming the field and not echoing the value', async () => {
    const w = await start();
    const anna = await w.rider();
    const answer = await w.as(anna, 'POST', '/v1/reports', { athleteId: 'someone', reason: '  ' });
    expect(answer.status).toBe(400);
    expect(JSON.stringify(answer.body)).toContain('"field":"reason"');
  });

  it('reach the moderators’ queue — the owner’s and the deputy’s — and nobody else’s', async () => {
    const w = await start();
    const anna = await w.rider();
    const bea = await w.rider();
    await w.as(anna, 'POST', '/v1/reports', { athleteId: bea.athleteId, reason: 'Spam' });
    for (const moderator of [w.owner, w.deputy]) {
      const queue = await w.as(moderator, 'GET', '/v1/moderation/reports');
      expect(queue.status).toBe(200);
      expect(queue.body).toEqual({
        reports: [
          {
            reportId: expect.any(Number) as number,
            reporterAthleteId: anna.athleteId,
            targetAthleteId: bea.athleteId,
            reason: 'Spam',
            createdAt: seconds(w),
          },
        ],
      });
    }
    expect((await w.as(anna, 'GET', '/v1/moderation/reports')).status).toBe(404);
  });
});

describe('moderator actions, each written to the append-only log (#83)', () => {
  async function reported(w: ModerationWorld) {
    const anna = await w.rider('Anna');
    const bea = await w.rider('Bea');
    await w.as(anna, 'POST', '/v1/reports', { athleteId: bea.athleteId, reason: 'Abuse' });
    const [report] = await w.freshRead((store) => store.listOpenReports());
    return { anna, bea, reportId: report!.id };
  }

  it('hide content: the name is hidden from others, and the entry is logged', async () => {
    const w = await start();
    const { anna, bea, reportId } = await reported(w);
    const hidden = await w.as(
      w.deputy,
      'POST',
      `/v1/moderation/athletes/${bea.athleteId}/hide-display-name`,
      {
        reason: 'Slur in the name',
        reportId,
      },
    );
    expect(hidden.status).toBe(200);
    expect(await w.freshRead((store) => store.listModerationLog())).toEqual([
      {
        id: (hidden.body as { logId: number }).logId,
        action: 'hide_display_name',
        actorAthleteId: w.deputy.athleteId,
        targetAthleteId: bea.athleteId,
        reportId,
        reason: 'Slur in the name',
        at: seconds(w),
      },
    ]);
    expect((await w.as(anna, 'GET', `/v1/athletes/${bea.athleteId}`)).body).toEqual({
      athleteId: bea.athleteId,
      displayName: 'Rider',
    });
    // The athlete still sees their own name; a new one is new content.
    expect((await w.as(bea, 'GET', '/v1/auth/session')).body).toEqual({
      athleteId: bea.athleteId,
      displayName: 'Bea',
    });
    await w.as(bea, 'POST', '/v1/auth/display-name', { displayName: 'Bee' });
    expect((await w.as(anna, 'GET', `/v1/athletes/${bea.athleteId}`)).body).toEqual({
      athleteId: bea.athleteId,
      displayName: 'Bee',
    });
    // The report the action decided has left the queue.
    expect((await w.as(w.owner, 'GET', '/v1/moderation/reports')).body).toEqual({ reports: [] });
  });

  it('suspend an account: hidden from others, every session ended, nothing it owns deleted', async () => {
    const w = await start();
    const { anna, bea } = await reported(w);
    await w.as(bea, 'POST', `/v1/blocks/${anna.athleteId}`);
    const rowsBefore = athleteRows(w.path, bea.athleteId);
    expect(Object.values(rowsBefore).some((count) => count > 0)).toBe(true);

    const suspended = await w.as(
      w.owner,
      'POST',
      `/v1/moderation/athletes/${bea.athleteId}/suspend`,
      {
        reason: 'Repeated abuse',
      },
    );
    expect(suspended.status).toBe(200);
    const [entry] = await w.freshRead((store) => store.listModerationLog());
    expect(entry).toMatchObject({
      action: 'suspend',
      actorAthleteId: w.owner.athleteId,
      targetAthleteId: bea.athleteId,
      reason: 'Repeated abuse',
      at: seconds(w),
    });

    const cat = await w.rider();
    expect((await w.as(cat, 'GET', `/v1/athletes/${bea.athleteId}`)).status).toBe(404);
    expect((await w.as(bea, 'GET', '/v1/auth/session')).status).toBe(401);
    const again = await w.signIn(bea.device);
    expect(again.status).toBe(403);
    expect(codeOf(again.body)).toBe('account_suspended');

    // Suspension is not a way to destroy somebody's data (#83): every row the
    // athlete owns, in every athlete-scoped table the schema has, is still there.
    const rowsAfter = athleteRows(w.path, bea.athleteId);
    expect(rowsAfter).toEqual(rowsBefore);

    const lifted = await w.as(
      w.owner,
      'POST',
      `/v1/moderation/athletes/${bea.athleteId}/unsuspend`,
      {
        reason: 'Appeal upheld',
      },
    );
    expect(lifted.status).toBe(200);
    expect((await w.signIn(bea.device)).status).toBe(200);
    expect((await w.as(cat, 'GET', `/v1/athletes/${bea.athleteId}`)).status).toBe(200);
    expect(
      (await w.freshRead((store) => store.listModerationLog())).map((each) => each.action),
    ).toEqual(['suspend', 'unsuspend']);
  });

  it('refuses a suspended athlete’s session on every request, not only by ending it', async () => {
    const w = await start();
    const bea = await w.rider();
    // Suspended beneath the moderation path, so the session is NOT revoked:
    // what refuses it is the per-request check in `authenticate`.
    const database = openDatabase(w.path);
    try {
      database.prepare('UPDATE athlete SET suspended_at = 1 WHERE id = ?').run(bea.athleteId);
    } finally {
      database.close();
    }
    expect((await w.as(bea, 'GET', '/v1/auth/session')).status).toBe(401);
  });

  it('dismiss a report: it leaves the queue, and the entry is logged', async () => {
    const w = await start();
    const { reportId } = await reported(w);
    const dismissed = await w.as(
      w.owner,
      'POST',
      `/v1/moderation/reports/${String(reportId)}/dismiss`,
      {
        reason: 'Not against the rules',
      },
    );
    expect(dismissed.status).toBe(200);
    expect(await w.freshRead((store) => store.listModerationLog())).toEqual([
      expect.objectContaining({
        action: 'dismiss_report',
        actorAthleteId: w.owner.athleteId,
        targetAthleteId: null,
        reportId,
        reason: 'Not against the rules',
        at: seconds(w),
      }) as unknown,
    ]);
    expect(await w.freshRead((store) => store.listOpenReports())).toEqual([]);
    const twice = await w.as(
      w.owner,
      'POST',
      `/v1/moderation/reports/${String(reportId)}/dismiss`,
      {
        reason: 'Again',
      },
    );
    expect(twice.status).toBe(409);
    expect(await w.freshRead((store) => store.listModerationLog())).toHaveLength(1);
  });

  it('refuses a moderator acting on a moderator, and logs nothing it did not do', async () => {
    const w = await start();
    for (const [actor, target] of [
      [w.deputy, w.owner],
      [w.owner, w.deputy],
      [w.owner, w.owner],
    ] as const) {
      const answer = await w.as(
        actor,
        'POST',
        `/v1/moderation/athletes/${target.athleteId}/suspend`,
        {
          reason: 'Because',
        },
      );
      expect(answer.status).toBe(409);
      expect(codeOf(answer.body)).toBe('moderation_not_applicable');
    }
    const nobody = await w.as(
      w.owner,
      'POST',
      `/v1/moderation/athletes/${'f'.repeat(32)}/suspend`,
      {
        reason: 'Because',
      },
    );
    expect(nobody.status).toBe(404);
    const noReason = await w.as(
      w.owner,
      'POST',
      `/v1/moderation/athletes/${w.deputy.athleteId}/suspend`,
      {},
    );
    expect(noReason.status).toBe(400);
    expect(await w.freshRead((store) => store.listModerationLog())).toEqual([]);
  });

  it('refuses every moderator action to an ordinary rider, and logs nothing', async () => {
    const w = await start();
    const { anna, bea, reportId } = await reported(w);
    for (const path of [
      `/v1/moderation/athletes/${bea.athleteId}/suspend`,
      `/v1/moderation/athletes/${bea.athleteId}/hide-display-name`,
      `/v1/moderation/reports/${String(reportId)}/dismiss`,
    ]) {
      expect((await w.as(anna, 'POST', path, { reason: 'Because' })).status, path).toBe(404);
    }
    expect(await w.freshRead((store) => store.listModerationLog())).toEqual([]);
    expect((await w.freshRead((store) => store.getAthlete(bea.athleteId)))?.suspendedAt).toBeNull();
  });
});

/** How many rows `athleteId` owns in every table with a foreign key to `athlete`, from the file. */
function athleteRows(path: string, athleteId: string): Record<string, number> {
  const database = openDatabase(path);
  try {
    const tables = (
      database
        .prepare(
          `SELECT DISTINCT m.name AS name FROM sqlite_schema AS m, pragma_foreign_key_list(m.name) AS f
           WHERE m.type = 'table' AND f."table" = 'athlete' ORDER BY m.name`,
        )
        .all() as { name: string }[]
    ).map((row) => row.name);
    return Object.fromEntries(
      tables.map((table) => [
        table,
        (
          database
            .prepare(`SELECT count(*) AS n FROM "${table}" WHERE athlete_id = ?`)
            .get(athleteId) as {
            n: number;
          }
        ).n,
      ]),
    );
  } finally {
    database.close();
  }
}
