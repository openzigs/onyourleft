// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Reports, the moderators' actions and the audit log (#83), through the real
 * listener and a real SQLite file. Every claim about what is stored is read
 * back through a SECOND store on the same file.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { openDatabase } from '../store/node-sqlite.ts';
import { DEFAULT_MODERATION_LIMITS, MAXIMUM_BLOCKS } from './moderation.ts';
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
      await w.freshRead(
        async (store) => (await store.sight(bea.athleteId, anna.athleteId))?.blocked,
      ),
    ).toBe(true);
  });
});

describe('blocks of anybody, bounded (#891)', () => {
  it('stores a block of an id nobody holds, and lists it back', async () => {
    const w = await start();
    const anna = await w.rider();
    const nobody = 'e'.repeat(32);
    expect((await w.as(anna, 'POST', `/v1/blocks/${nobody}`)).status).toBe(204);
    expect(await w.freshRead((store) => store.listBlocks(anna.athleteId))).toEqual([
      expect.objectContaining({ blockedAthleteId: nobody }),
    ]);
  });

  it(`holds an account to ${String(MAXIMUM_BLOCKS)} blocks, counting only its own`, async () => {
    const w = await start();
    const anna = await w.rider();
    const bea = await w.rider();
    const ids = Array.from({ length: MAXIMUM_BLOCKS }, (_, each) =>
      each.toString(16).padStart(32, '0'),
    );
    await w.freshRead(async (store) => {
      for (const id of ids) await store.putBlock(anna.athleteId, id, 1);
    });
    const over = await w.as(anna, 'POST', `/v1/blocks/${'e'.repeat(32)}`);
    expect(over.status).toBe(400);
    expect(codeOf(over.body)).toBe('validation_failed');
    // Blocking one already held is not a new row, and is answered as before.
    expect((await w.as(anna, 'POST', `/v1/blocks/${ids[0]!}`)).status).toBe(204);
    expect(await w.freshRead((store) => store.listBlocks(anna.athleteId))).toHaveLength(
      MAXIMUM_BLOCKS,
    );
    // Another rider's allowance is their own.
    expect((await w.as(bea, 'POST', `/v1/blocks/${'e'.repeat(32)}`)).status).toBe(204);
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

  it('stores a report about nobody closed, so it spends the allowance and never reaches the queue (#891)', async () => {
    const w = await start();
    const anna = await w.rider();
    const nobody = 'e'.repeat(32);
    expect(
      (await w.as(anna, 'POST', '/v1/reports', { athleteId: nobody, reason: 'Spam' })).status,
    ).toBe(204);
    expect(await w.freshRead((store) => store.listReports(anna.athleteId))).toEqual([
      expect.objectContaining({
        targetAthleteId: nobody,
        closedAt: seconds(w),
        closedByAthleteId: null,
        outcome: 'no_such_athlete',
      }),
    ]);
    expect(await w.freshRead((store) => store.listOpenReports())).toEqual([]);
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
    // The SAME name again is not new content, and stays hidden (#891's review).
    expect(
      (await w.as(bea, 'POST', '/v1/auth/display-name', { displayName: 'Bea' })).status,
    ).toBeLessThan(300);
    expect((await w.as(anna, 'GET', `/v1/athletes/${bea.athleteId}`)).body).toEqual({
      athleteId: bea.athleteId,
      displayName: 'Rider',
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
    await w.as(bea, 'POST', '/v1/reports', { athleteId: anna.athleteId, reason: 'Spam' });
    await w.as(bea, 'POST', '/v1/auth/display-name', { displayName: 'Bee' });
    await w.as(bea, 'POST', '/v1/auth/link-codes');
    await w.freshRead((store) =>
      store.putActivityRecord({
        athleteId: bea.athleteId,
        contentSha256: 'c'.repeat(64),
        signedRecord: new Uint8Array([1, 2, 3]),
        receivedAt: seconds(w),
      }),
    );
    const rowsBefore = athleteRows(w.path, bea.athleteId);
    for (const table of [
      'activity_record',
      'block',
      'device_key',
      'display_name_change',
      'link_code',
      'recovery_code',
      'report',
      'session',
    ]) {
      expect(rowsBefore[table], `${table} seeded`).toBeGreaterThan(0);
    }

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

  it('refuses a moderator acting on a moderator, changes nothing, and logs the attempt (#891)', async () => {
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
    // Each refused attempt is logged as refused; the 404 and the 400 are not.
    expect(await w.freshRead((store) => store.listModerationLog())).toEqual(
      [
        [w.deputy, w.owner],
        [w.owner, w.deputy],
        [w.owner, w.owner],
      ].map(([actor, target]): unknown =>
        expect.objectContaining({
          action: 'refused_suspend',
          actorAthleteId: actor!.athleteId,
          targetAthleteId: target!.athleteId,
          reason: 'Because',
        }),
      ),
    );
    for (const moderator of [w.owner, w.deputy]) {
      expect(
        (await w.freshRead((store) => store.getAthlete(moderator.athleteId)))?.suspendedAt,
      ).toBeNull();
    }
  });

  it('refuses a moderator dismissing a report about themselves, logs it, and lets the other moderator decide (#891)', async () => {
    const w = await start();
    const anna = await w.rider('Anna');
    await w.as(anna, 'POST', '/v1/reports', { athleteId: w.deputy.athleteId, reason: 'Rude' });
    const [report] = await w.freshRead((store) => store.listOpenReports());
    const path = `/v1/moderation/reports/${String(report!.id)}/dismiss`;

    const own = await w.as(w.deputy, 'POST', path, { reason: 'Nothing in it' });
    expect(own.status).toBe(409);
    expect(codeOf(own.body)).toBe('moderation_not_applicable');
    expect(await w.freshRead((store) => store.listOpenReports())).toHaveLength(1);
    expect(await w.freshRead((store) => store.listModerationLog())).toEqual([
      expect.objectContaining({
        action: 'refused_dismiss_report',
        actorAthleteId: w.deputy.athleteId,
        targetAthleteId: w.deputy.athleteId,
        reportId: report!.id,
        reason: 'Nothing in it',
      }),
    ]);

    expect((await w.as(w.owner, 'POST', path, { reason: 'Not against the rules' })).status).toBe(
      200,
    );
    expect(await w.freshRead((store) => store.listOpenReports())).toEqual([]);
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

describe('the suspended accounts and the log, a page at a time (#961)', () => {
  interface SuspendedPage {
    items: { athleteId: string; displayName: string; suspendedAt: number }[];
    next: string | null;
  }
  interface LogPage {
    entries: { logId: number; action: string; targetAthleteId: string | null }[];
    next: string | null;
  }

  async function suspend(w: ModerationWorld, athleteId: string): Promise<void> {
    w.clock.ms += 1000;
    const done = await w.as(w.owner, 'POST', `/v1/moderation/athletes/${athleteId}/suspend`, {
      reason: 'Cheating',
    });
    expect(done.status).toBe(200);
  }

  it('lists every suspended account, most recently suspended first, and no other', async () => {
    const w = await start();
    const anna = await w.rider('Anna');
    const bea = await w.rider('Bea');
    const cara = await w.rider('Cara');
    await suspend(w, anna.athleteId);
    await suspend(w, cara.athleteId);
    const listed = await w.as(w.deputy, 'GET', '/v1/moderation/suspended');
    expect(listed.status).toBe(200);
    expect(listed.body).toEqual({
      items: [
        { athleteId: cara.athleteId, displayName: 'Cara', suspendedAt: seconds(w) },
        { athleteId: anna.athleteId, displayName: 'Anna', suspendedAt: seconds(w) - 1 },
      ],
      next: null,
    });
    // A lifted suspension leaves the list.
    await w.as(w.owner, 'POST', `/v1/moderation/athletes/${cara.athleteId}/unsuspend`, {
      reason: 'Appeal upheld',
    });
    const after = (await w.as(w.owner, 'GET', '/v1/moderation/suspended')).body as SuspendedPage;
    expect(after.items.map((each) => each.athleteId)).toEqual([anna.athleteId]);
    expect(after.items.map((each) => each.athleteId)).not.toContain(bea.athleteId);
  });

  it('pages the suspended accounts: every one exactly once, ties on the second broken by id', async () => {
    const w = await start();
    const riders = [];
    for (let index = 0; index < 5; index += 1) riders.push(await w.rider(`Rider ${String(index)}`));
    // Two suspended in the same second, so the cursor's id half is what separates them.
    await suspend(w, riders[0]!.athleteId);
    await suspend(w, riders[1]!.athleteId);
    await w.as(w.owner, 'POST', `/v1/moderation/athletes/${riders[2]!.athleteId}/suspend`, {
      reason: 'Cheating',
    });
    await suspend(w, riders[3]!.athleteId);
    await suspend(w, riders[4]!.athleteId);

    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const query: string = cursor === null ? '?limit=2' : `?limit=2&cursor=${cursor}`;
      const page = await w.as(w.owner, 'GET', `/v1/moderation/suspended${query}`);
      expect(page.status).toBe(200);
      const body = page.body as SuspendedPage;
      expect(body.items.length).toBeLessThanOrEqual(2);
      seen.push(...body.items.map((each) => each.athleteId));
      cursor = body.next;
      pages += 1;
    } while (cursor !== null);
    expect(pages).toBe(3);
    expect([...seen].sort()).toEqual(riders.map((each) => each.athleteId).sort());
    expect(new Set(seen).size).toBe(5);
    // The order is suspendedAt, then id, both descending.
    const all = (await w.as(w.owner, 'GET', '/v1/moderation/suspended')).body as SuspendedPage;
    expect(all.items.map((each) => each.athleteId)).toEqual(seen);
    // A page that ends exactly at the end says there is no next one.
    const exact = (await w.as(w.owner, 'GET', '/v1/moderation/suspended?limit=5'))
      .body as SuspendedPage;
    expect(exact.items).toHaveLength(5);
    expect(exact.next).toBeNull();
  });

  it('pages the log newest first, and a cursor reaches further back without repeating', async () => {
    const w = await start();
    const anna = await w.rider('Anna');
    const bea = await w.rider('Bea');
    await suspend(w, anna.athleteId);
    await suspend(w, bea.athleteId);
    await w.as(w.owner, 'POST', `/v1/moderation/athletes/${anna.athleteId}/unsuspend`, {
      reason: 'Appeal upheld',
    });
    const first = await w.as(w.owner, 'GET', '/v1/moderation/log?limit=2');
    expect(first.status).toBe(200);
    const one = first.body as LogPage;
    expect(one.entries.map((each) => [each.action, each.targetAthleteId])).toEqual([
      ['unsuspend', anna.athleteId],
      ['suspend', bea.athleteId],
    ]);
    expect(one.next).not.toBeNull();
    const two = (await w.as(w.owner, 'GET', `/v1/moderation/log?limit=2&cursor=${one.next!}`))
      .body as LogPage;
    expect(two.entries.map((each) => [each.action, each.targetAthleteId])).toEqual([
      ['suspend', anna.athleteId],
    ]);
    expect(two.next).toBeNull();
    // An action logged while the moderator pages does not move what comes after the cursor.
    await suspend(w, anna.athleteId);
    const again = (await w.as(w.owner, 'GET', `/v1/moderation/log?limit=2&cursor=${one.next!}`))
      .body as LogPage;
    expect(again).toEqual(two);
    // The whole log, as the store keeps it, is the pages put together, reversed.
    const stored = await w.freshRead((store) => store.listModerationLog());
    const whole = (await w.as(w.owner, 'GET', '/v1/moderation/log')).body as LogPage;
    expect(whole.entries.map((each) => each.logId)).toEqual(
      stored.map((each) => each.id).reverse(),
    );
  });

  it('refuses a bad limit or a cursor it did not write, by name and never by value', async () => {
    const w = await start();
    for (const path of ['/v1/moderation/log', '/v1/moderation/suspended']) {
      for (const query of [
        '?limit=0',
        '?limit=201',
        '?limit=two',
        '?cursor=nonsense!',
        // A cursor shaped as the OTHER list writes one; for the log, its id is a
        // well-formed log id, so only the key refuses it.
        path.endsWith('log')
          ? `?cursor=${encodeURIComponent(btoa(JSON.stringify(['1', '2'])).replace(/=+$/, ''))}`
          : `?cursor=${encodeURIComponent(btoa(JSON.stringify(['log', '1'])).replace(/=+$/, ''))}`,
      ]) {
        const answer = await w.as(w.owner, 'GET', `${path}${query}`);
        expect(answer.status, `${path}${query}`).toBe(400);
        expect(codeOf(answer.body), `${path}${query}`).toBe('validation_failed');
        expect(JSON.stringify(answer.body)).not.toContain('nonsense');
      }
    }
  });

  it('answers an ordinary rider — suspended accounts or not, cursor or not — as though there were no such route', async () => {
    const w = await start();
    const anna = await w.rider('Anna');
    const bea = await w.rider('Bea');
    const nobody = await w.as(anna, 'GET', '/v1/moderation/suspended');
    await suspend(w, bea.athleteId);
    for (const path of [
      '/v1/moderation/suspended',
      '/v1/moderation/suspended?limit=0',
      '/v1/moderation/log',
      '/v1/moderation/log?cursor=nonsense!',
    ]) {
      const answer = await w.as(anna, 'GET', path);
      expect(answer.status, path).toBe(404);
      expect(answer.body, path).toEqual(nobody.body);
      expect(JSON.stringify(answer.body)).not.toContain(bea.athleteId);
    }
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
