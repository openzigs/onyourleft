// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **A closed notice's notifier details go six months after its decision**
 * (#1381, the owner's ruling of 2026-10-30), through the real listener: the
 * name, the email address and the words the notifier typed are erased — from
 * the moderators' queue and from the database file — and the decision, its
 * dates, the items and the reference stay, as does the record's word on
 * whether the notifier gave a name and an address.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { openDatabase } from '../store/node-sqlite.ts';
import { noticeDetailsDueAt } from './notice-retention.ts';
import { startModerationWorld, type ModerationWorld, type Rider } from './moderation-testing.ts';

let world: ModerationWorld | undefined;
afterEach(async () => {
  await world?.close();
  world = undefined;
});

const ROOM = '0123456789abcdef0123456789abcdef';

/** Unix seconds of a UTC date and time. */
const at = (iso: string): number => Date.parse(iso) / 1000;

/** Send the notice page's form, every free-text field marked with `marker`; answer its id. */
async function notice(w: ModerationWorld, marker: string): Promise<number> {
  const response = await fetch(`${w.url}/report`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      kind: 'illegal_content',
      explanation: `${marker}-explanation: a threat on this room’s route`,
      items: `route:${ROOM}`,
      location: `${marker}-location`,
      name: `${marker}-name`,
      email: `${marker}-email@example.com`,
      bona_fide: 'on',
    }).toString(),
  });
  expect(response.status).toBe(200);
  const queue = await w.as(w.owner, 'GET', '/v1/moderation/notices');
  return (queue.body as { notices: { noticeId: number }[] }).notices.at(-1)?.noticeId ?? 0;
}

const step = async (w: ModerationWorld, noticeId: number, body: Record<string, unknown>) =>
  w.as(await signedIn(w), 'POST', `/v1/moderation/notices/${String(noticeId)}/steps`, body);

async function queued(w: ModerationWorld, noticeId: number) {
  const queue = await w.as(await signedIn(w), 'GET', '/v1/moderation/notices');
  return (queue.body as { notices: Record<string, unknown>[] }).notices.find(
    (each) => each.noticeId === noticeId,
  );
}

/**
 * The owner, with a session alive at the world's clock: a test moves it six
 * months on, and a session lasts thirty days.
 */
async function signedIn(w: ModerationWorld): Promise<Rider> {
  const session = await w.signIn(w.owner.device);
  expect(session.status).toBe(200);
  return { ...w.owner, token: session.body.sessionToken as string };
}

const erase = (w: ModerationWorld) => w.identity.moderation.eraseExpiredNoticeDetails();

describe('when a notice’s notifier details are due (#1381)', () => {
  it.each([
    ['the same day and time, six months on', '2026-01-15T10:20:30Z', '2026-07-15T10:20:30Z'],
    ['into the next year', '2026-12-01T00:00:00Z', '2027-06-01T00:00:00Z'],
    ['the end of a shorter month, never later', '2026-08-31T23:59:59Z', '2027-02-28T23:59:59Z'],
    ['the end of February in a leap year', '2027-08-31T12:00:00Z', '2028-02-29T12:00:00Z'],
  ])('%s', (_, decided, due) => {
    expect(noticeDetailsDueAt(at(decided))).toBe(at(due));
  });
});

describe('erasing a closed notice’s notifier details (#1381)', () => {
  it('erases them six months after the decision, and keeps the decision, its dates, the items and the reference', async () => {
    const w = (world = await startModerationWorld());
    const closed = await notice(w, 'closed');
    const open = await notice(w, 'open');
    const receivedAt = Math.floor(w.clock.ms / 1000);
    expect((await step(w, closed, { step: 'acknowledged' })).status).toBe(204);
    w.clock.ms += 60_000;
    const decidedAt = Math.floor(w.clock.ms / 1000);
    expect((await step(w, closed, { step: 'decided', decision: 'Not illegal.' })).status).toBe(204);
    const due = noticeDetailsDueAt(decidedAt);

    // A second before it is due, nothing is erased.
    w.clock.ms = (due - 1) * 1000;
    expect(await erase(w)).toBe(0);
    expect(await queued(w, closed)).toMatchObject({
      notifierName: 'closed-name',
      notifierEmail: 'closed-email@example.com',
      location: 'closed-location',
      detailsErasedAt: null,
    });

    // On the second it is due, they go: read back through the moderators' queue.
    w.clock.ms = due * 1000;
    expect(await erase(w)).toBe(1);
    expect(await queued(w, closed)).toEqual({
      noticeId: closed,
      receivedAt,
      kind: 'illegal_content',
      explanation: '',
      items: [`route:${ROOM}`],
      location: null,
      notifierName: null,
      notifierEmail: null,
      bonaFide: true,
      detailsErasedAt: due,
      acknowledgedAt: receivedAt,
      decidedAt,
      decision: 'Not illegal.',
      logId: null,
      notifierToldAt: null,
    });
    // A notice with no decision is still being handled, and keeps everything.
    expect(await queued(w, open)).toMatchObject({
      explanation: 'open-explanation: a threat on this room’s route',
      notifierName: 'open-name',
      detailsErasedAt: null,
    });

    // The record still says they gave a name and an address.
    const record = await w.as(await signedIn(w), 'GET', '/v1/moderation/record');
    expect((record.body as { notices: unknown[] }).notices).toContainEqual(
      expect.objectContaining({
        noticeId: closed,
        notifierGaveName: true,
        notifierGaveEmail: true,
        decision: 'Not illegal.',
        decidedAt,
      }),
    );

    // Gone from the file, its log and its free pages — and the open notice's are not.
    const bytes = await w.databaseBytes();
    for (const marker of ['closed-explanation', 'closed-location', 'closed-name', 'closed-email']) {
      expect(bytes, marker).not.toContain(marker);
    }
    expect(bytes).toContain('open-name');

    // There is nobody left to tell, and nothing is erased twice.
    expect((await step(w, closed, { step: 'notifier_told' })).status).toBe(409);
    expect(await erase(w)).toBe(0);
  });

  it('answers what it did, and erases only a closed notice once', async () => {
    const w = (world = await startModerationWorld());
    const noticeId = await notice(w, 'store');
    const now = Math.floor(w.clock.ms / 1000);
    expect(await w.freshRead((s) => s.eraseNoticeDetails(999, now))).toBe('not_found');
    expect(await w.freshRead((s) => s.eraseNoticeDetails(noticeId, now))).toBe('not_closed');
    await step(w, noticeId, { step: 'decided', decision: 'Not illegal.' });
    expect(await w.freshRead((s) => s.eraseNoticeDetails(noticeId, now))).toBe('erased');
    expect(await w.freshRead((s) => s.eraseNoticeDetails(noticeId, now))).toBe('already');
    expect(await queued(w, noticeId)).toMatchObject({ detailsErasedAt: now, notifierName: null });
  });

  it('is the only change the schema lets anybody make to a notice', async () => {
    const w = (world = await startModerationWorld());
    const kept = await notice(w, 'kept');
    const erased = await notice(w, 'erased');
    await step(w, erased, { step: 'decided', decision: 'Not illegal.' });
    w.clock.ms = noticeDetailsDueAt(Math.floor(w.clock.ms / 1000)) * 1000;
    expect(await erase(w)).toBe(1);
    const database = openDatabase(w.path);
    try {
      const erasing = `SET explanation = '', location = NULL, notifier_name = NULL, notifier_email = NULL`;
      // The erasure itself, on a notice with no erasure recorded: refused.
      expect(() => database.exec(`UPDATE notice ${erasing} WHERE id = ${String(kept)}`)).toThrow(
        /append-only/,
      );
      // Anything more than the erasure, on an erased notice: refused.
      for (const change of [
        `SET explanation = 'rewritten'`,
        `SET items = '[]'`,
        `SET received_at = 1`,
        `SET bona_fide = 0`,
        `SET kind = 'intimate_image'`,
      ]) {
        expect(
          () => database.exec(`UPDATE notice ${change} WHERE id = ${String(erased)}`),
          change,
        ).toThrow(/append-only/);
      }
      expect(() => database.exec('DELETE FROM notice')).toThrow(/append-only/);
      expect(() => database.exec('UPDATE notice_erasure SET gave_name = 0')).toThrow(/append-only/);
      expect(() => database.exec('DELETE FROM notice_erasure')).toThrow(/append-only/);
    } finally {
      database.close();
    }
    expect(await queued(w, kept)).toMatchObject({ notifierName: 'kept-name' });
  });
});
