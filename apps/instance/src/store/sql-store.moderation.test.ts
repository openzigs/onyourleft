// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The moderation half of the store (#83): the log is append-only in the
 * SCHEMA, an action and its log entry are one transaction, and a block is
 * the blocker's to lift. Read back on a fresh connection every time.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { openDatabase } from './node-sqlite.ts';
import type { ModerationAction } from './sql-store.ts';
import {
  ATHLETE_A,
  ATHLETE_B,
  ATHLETE_C,
  createStoreHarness,
  seedWorld,
  type StoreHarness,
} from './testing/index.ts';

let harness: StoreHarness | undefined;
afterEach(async () => {
  await harness?.destroy();
  harness = undefined;
});

/** The log, less the invitations `seedWorld` mints (#775). */
const actions = (entries: readonly { action: string }[]) =>
  entries.filter((entry) => entry.action !== 'mint_invite');

async function seeded(): Promise<StoreHarness> {
  harness = await createStoreHarness();
  await harness.write(seedWorld);
  return harness;
}

const suspendB: ModerationAction = {
  action: 'suspend',
  actorAthleteId: ATHLETE_A,
  targetAthleteId: ATHLETE_B,
  reportId: null,
  reason: 'Repeated abuse',
  at: 1_790_002_000,
};

describe('the moderation log (#83)', () => {
  it('refuses, in the database itself, any UPDATE or DELETE of an entry', async () => {
    const h = await seeded();
    await h.write((store) => store.moderate(suspendB));
    const database = openDatabase(h.path);
    try {
      expect(() => database.exec(`UPDATE moderation_log SET reason = 'nothing happened'`)).toThrow(
        /append-only/,
      );
      expect(() => database.exec('DELETE FROM moderation_log')).toThrow(/append-only/);
    } finally {
      database.close();
    }
    expect(actions(await h.read((store) => store.listModerationLog()))).toEqual([
      { ...suspendB, id: expect.any(Number) as number },
    ]);
  });

  it('applies an action and logs it together, and logs nothing for one it did not apply', async () => {
    const h = await seeded();
    expect(await h.write((store) => store.moderate(suspendB))).toEqual({
      outcome: 'applied',
      logId: expect.any(Number) as number,
    });
    expect(await h.write((store) => store.moderate(suspendB))).toEqual({
      outcome: 'not_applicable',
    });
    expect(
      await h.write((store) => store.moderate({ ...suspendB, targetAthleteId: 'nobody' })),
    ).toEqual({ outcome: 'not_found' });
    expect(actions(await h.read((store) => store.listModerationLog()))).toHaveLength(1);
    expect((await h.read((store) => store.getAthlete(ATHLETE_B)))?.suspendedAt).toBe(suspendB.at);
  });

  it('ends every session of a suspended athlete, and no other athlete’s', async () => {
    const h = await seeded();
    await h.write((store) => store.moderate(suspendB));
    for (const session of await h.read((store) => store.listSessions(ATHLETE_B))) {
      expect(session.revokedAt).toBe(suspendB.at);
    }
    for (const athlete of [ATHLETE_A, ATHLETE_C]) {
      for (const session of await h.read((store) => store.listSessions(athlete))) {
        expect(session.revokedAt).toBeNull();
      }
    }
  });

  it('closes the report an action decides, with who, when and what', async () => {
    const h = await seeded();
    const [report] = await h.read((store) => store.listReports(ATHLETE_A));
    // A's report is of B; an action naming the report must name its target.
    expect(
      await h.write((store) =>
        store.moderate({ ...suspendB, targetAthleteId: ATHLETE_C, reportId: report!.id }),
      ),
    ).toEqual({ outcome: 'not_found' });
    await h.write((store) =>
      store.moderate({ ...suspendB, actorAthleteId: ATHLETE_C, reportId: report!.id }),
    );
    const [closed] = await h.read((store) => store.listReports(ATHLETE_A));
    expect(closed).toMatchObject({
      closedAt: suspendB.at,
      closedByAthleteId: ATHLETE_C,
      outcome: 'suspend',
    });
    expect((await h.read((store) => store.listOpenReports())).map((each) => each.id)).not.toContain(
      report!.id,
    );
  });
});

describe('blocks (#83)', () => {
  it('are seen either way round, and lifted only by the blocker', async () => {
    harness = await createStoreHarness();
    const h = harness;
    await h.write(async (store) => {
      for (const athlete of [ATHLETE_A, ATHLETE_B, ATHLETE_C]) {
        await store.putAthlete({
          id: athlete,
          displayName: athlete,
          createdAt: 1,
          registrationState: 'active',
        });
      }
      await store.putBlock(ATHLETE_A, ATHLETE_B, 2);
    });
    expect(await h.read((store) => store.blockedEitherWay(ATHLETE_A, ATHLETE_B))).toBe(true);
    expect(await h.read((store) => store.blockedEitherWay(ATHLETE_B, ATHLETE_A))).toBe(true);
    expect(await h.read((store) => store.blockedEitherWay(ATHLETE_A, ATHLETE_C))).toBe(false);
    expect(await h.write((store) => store.deleteBlock(ATHLETE_B, ATHLETE_A))).toBe(false);
    expect(await h.read((store) => store.blockedEitherWay(ATHLETE_A, ATHLETE_B))).toBe(true);
    expect(await h.write((store) => store.deleteBlock(ATHLETE_A, ATHLETE_B))).toBe(true);
    expect(await h.read((store) => store.blockedEitherWay(ATHLETE_A, ATHLETE_B))).toBe(false);
  });
});
