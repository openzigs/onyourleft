// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The record of each notice and complaint** (#912), through the real
 * listener: each step a moderator takes on a notice is recorded once, in its
 * order, append-only, and read back through the moderators' queue and the
 * record export — which carries no personal detail of a notifier.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { openDatabase } from '../store/node-sqlite.ts';
import {
  codeOf,
  startModerationWorld,
  TEST_STATEMENT,
  type ModerationWorld,
} from './moderation-testing.ts';

let world: ModerationWorld | undefined;
afterEach(async () => {
  await world?.close();
  world = undefined;
});

const ROOM = '0123456789abcdef0123456789abcdef';

/** Send the notice page's form; answer the notice's id from the queue. */
async function notice(w: ModerationWorld, fields: Record<string, string> = {}): Promise<number> {
  const response = await fetch(`${w.url}/report`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      kind: 'illegal_content',
      explanation: 'explanation-marker: a threat in this room’s route',
      items: `route:${ROOM}`,
      location: 'location-marker',
      ...fields,
    }).toString(),
  });
  expect(response.status).toBe(200);
  const queue = await w.as(w.owner, 'GET', '/v1/moderation/notices');
  return (queue.body as { notices: { noticeId: number }[] }).notices.at(-1)?.noticeId ?? 0;
}

const step = (w: ModerationWorld, noticeId: number, body: Record<string, unknown>) =>
  w.as(w.owner, 'POST', `/v1/moderation/notices/${String(noticeId)}/steps`, body);

async function queued(w: ModerationWorld) {
  const queue = await w.as(w.owner, 'GET', '/v1/moderation/notices');
  return (queue.body as { notices: Record<string, unknown>[] }).notices;
}

describe('the steps taken on a notice (#912)', () => {
  it('records acknowledged, decided with its log entry, and notifier told, each with when, read back in the queue', async () => {
    const w = (world = await startModerationWorld());
    const noticeId = await notice(w, { name: 'name-marker', email: 'email-marker@example.com' });
    const received = Math.floor(w.clock.ms / 1000);
    w.clock.ms += 60_000;
    expect((await step(w, noticeId, { step: 'acknowledged' })).status).toBe(204);
    const bea = await w.rider('Bea');
    const hidden = await w.as(
      w.owner,
      'POST',
      `/v1/moderation/athletes/${bea.athleteId}/hide-display-name`,
      {
        reason: 'From a notice',
        statement: { ...TEST_STATEMENT, decidedOn: 'notice' },
      },
    );
    const { logId } = hidden.body as { logId: number };
    w.clock.ms += 60_000;
    const decided = Math.floor(w.clock.ms / 1000);
    expect(
      (await step(w, noticeId, { step: 'decided', decision: 'Hid the name it named.', logId }))
        .status,
    ).toBe(204);
    w.clock.ms += 60_000;
    expect((await step(w, noticeId, { step: 'notifier_told' })).status).toBe(204);
    const [row] = await queued(w);
    expect(row).toMatchObject({
      noticeId,
      receivedAt: received,
      acknowledgedAt: received + 60,
      decidedAt: decided,
      decision: 'Hid the name it named.',
      logId,
      notifierToldAt: decided + 60,
    });
  });

  it('takes each step once, tells only once decided, and never acknowledges or tells a notifier with no address', async () => {
    const w = (world = await startModerationWorld());
    const withAddress = await notice(w, { email: 'a@example.com' });
    expect(codeOf((await step(w, withAddress, { step: 'notifier_told' })).body)).toBe(
      'moderation_not_applicable',
    );
    expect((await step(w, withAddress, { step: 'acknowledged' })).status).toBe(204);
    expect((await step(w, withAddress, { step: 'acknowledged' })).status).toBe(409);
    const anonymous = await notice(w);
    expect((await step(w, anonymous, { step: 'acknowledged' })).status).toBe(409);
    expect((await step(w, anonymous, { step: 'decided', decision: 'Not illegal.' })).status).toBe(
      204,
    );
    expect((await step(w, anonymous, { step: 'notifier_told' })).status).toBe(409);
    const rows = await queued(w);
    expect(rows.find((each) => each.noticeId === anonymous)).toMatchObject({
      acknowledgedAt: null,
      notifierToldAt: null,
      decision: 'Not illegal.',
    });
  });

  it('refuses a decision with no words, a coordinate, or a log entry that does not exist', async () => {
    const w = (world = await startModerationWorld());
    const noticeId = await notice(w);
    for (const body of [
      { step: 'decided' },
      { step: 'decided', decision: 'At 51.50722, -0.12750' },
      { step: 'decided', decision: 'Hid it.', logId: 999 },
      { step: 'shrugged' },
      { step: 'acknowledged', decision: 'words' },
    ]) {
      const refused = await step(w, noticeId, body);
      expect(refused.status, JSON.stringify(body)).toBe(400);
      expect(JSON.stringify(refused.body)).not.toContain('51.50722');
    }
    expect((await step(w, 999, { step: 'decided', decision: 'x' })).status).toBe(404);
    expect((await queued(w))[0]).toMatchObject({ decidedAt: null });
  });

  it('is shown to nobody but a moderator', async () => {
    const w = (world = await startModerationWorld());
    const noticeId = await notice(w);
    const rider = await w.rider('Somebody');
    const path = `/v1/moderation/notices/${String(noticeId)}/steps`;
    expect((await w.as(rider, 'POST', path, { step: 'decided', decision: 'x' })).status).toBe(404);
    expect((await w.as(rider, 'GET', '/v1/moderation/record')).status).toBe(404);
  });

  it('is append-only in the schema', async () => {
    const w = (world = await startModerationWorld());
    const noticeId = await notice(w);
    await step(w, noticeId, { step: 'decided', decision: 'Not illegal.' });
    const database = openDatabase(w.path);
    try {
      expect(() => database.exec(`UPDATE notice_step SET decision = 'rewritten'`)).toThrow(
        /append-only/,
      );
      expect(() => database.exec('DELETE FROM notice_step')).toThrow(/append-only/);
    } finally {
      database.close();
    }
  });
});

describe('the record export (#912)', () => {
  it('carries every notice and appeal with its steps, and no personal detail of a notifier', async () => {
    const w = (world = await startModerationWorld());
    const noticeId = await notice(w, {
      name: 'name-marker',
      email: 'email-marker@example.com',
    });
    await step(w, noticeId, { step: 'acknowledged' });
    await step(w, noticeId, { step: 'decided', decision: 'Not illegal.' });
    const bea = await w.rider('Bea');
    const hidden = await w.as(
      w.owner,
      'POST',
      `/v1/moderation/athletes/${bea.athleteId}/hide-display-name`,
      { reason: 'x', statement: TEST_STATEMENT },
    );
    const statementId = (hidden.body as { logId: number }).logId;
    await w.as(bea, 'POST', `/v1/statements/${String(statementId)}/appeal`, {
      grounds: 'grounds-marker',
    });
    const record = await w.as(w.owner, 'GET', '/v1/moderation/record');
    expect(record.status).toBe(200);
    expect(record.body).toMatchObject({
      notices: [
        {
          noticeId,
          items: [`route:${ROOM}`],
          notifierGaveName: true,
          notifierGaveEmail: true,
          decision: 'Not illegal.',
          notifierToldAt: null,
        },
      ],
      appeals: [
        {
          appellantAthleteId: bea.athleteId,
          statementId,
          outcome: null,
          decidedAt: null,
          appellantToldAt: null,
        },
      ],
    });
    const text = JSON.stringify(record.body);
    for (const marker of [
      'name-marker',
      'email-marker',
      'explanation-marker',
      'location-marker',
      'grounds-marker',
    ]) {
      expect(text).not.toContain(marker);
    }
  });

  it('keeps an erased rider’s appeal, naming an id that resolves to nobody', async () => {
    const w = (world = await startModerationWorld());
    const bea = await w.rider('Bea');
    const hidden = await w.as(
      w.owner,
      'POST',
      `/v1/moderation/athletes/${bea.athleteId}/hide-display-name`,
      { reason: 'x', statement: TEST_STATEMENT },
    );
    await w.as(
      bea,
      'POST',
      `/v1/statements/${String((hidden.body as { logId: number }).logId)}/appeal`,
      {
        grounds: 'Mine.',
      },
    );
    await w.freshRead((store) => store.eraseAthlete(bea.athleteId));
    expect(await w.freshRead((store) => store.getAthlete(bea.athleteId))).toBeUndefined();
    const record = await w.as(w.owner, 'GET', '/v1/moderation/record');
    expect((record.body as { appeals: unknown[] }).appeals).toEqual([
      expect.objectContaining({ appellantAthleteId: bea.athleteId }),
    ]);
  });
});
