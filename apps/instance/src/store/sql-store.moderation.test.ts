// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The moderation half of the store (#83): the log is append-only in the
 * SCHEMA, an action and its log entry are one transaction, and a block is
 * the blocker's to lift. Read back on a fresh connection every time.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { openDatabase } from './node-sqlite.ts';
import { openSqlStore } from './open-sql-store.ts';
import type { ModerationAction } from './sql-store.ts';
import {
  ATHLETE_A,
  ATHLETE_B,
  ATHLETE_C,
  createStoreHarness,
  seedWorld,
  type StoreHarness,
  wholeModerationLog,
} from './testing/index.ts';

let harness: StoreHarness | undefined;
afterEach(async () => {
  await harness?.destroy();
  harness = undefined;
});

/** The log, less the invitations (#775) and room removals (#789) `seedWorld` makes. */
const actions = (entries: readonly { action: string }[]) =>
  entries.filter((entry) => entry.action !== 'mint_invite' && entry.action !== 'remove_from_room');

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
    expect(actions(await h.read((store) => wholeModerationLog(store)))).toEqual([
      { ...suspendB, id: expect.any(Number) as number, roomId: null },
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
    expect(actions(await h.read((store) => wholeModerationLog(store)))).toHaveLength(1);
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

  it('ends every session of an athlete whose registration is refused (#775)', async () => {
    const h = await seeded();
    await h.write(async (store) => {
      await store.putAthlete({
        id: 'pending-d',
        displayName: 'D',
        createdAt: 1,
        registrationState: 'pending',
      });
      await store.putDeviceKey({
        publicKey: 'key-d',
        athleteId: 'pending-d',
        addedAt: 1,
        revokedAt: null,
      });
      await store.putSession({
        tokenSha256: 'd'.repeat(64),
        athleteId: 'pending-d',
        deviceKey: 'key-d',
        expiresAt: 1_800_000_000,
        revokedAt: null,
      });
    });
    await h.write((store) =>
      store.moderate({
        ...suspendB,
        action: 'refuse_registration',
        targetAthleteId: 'pending-d',
      }),
    );
    expect((await h.read((store) => store.getAthlete('pending-d')))?.registrationState).toBe(
      'refused',
    );
    expect((await h.read((store) => store.listSessions('pending-d')))[0]?.revokedAt).toBe(
      suspendB.at,
    );
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
    expect(await h.read(async (store) => (await store.sight(ATHLETE_A, ATHLETE_B))?.blocked)).toBe(
      true,
    );
    expect(await h.read(async (store) => (await store.sight(ATHLETE_B, ATHLETE_A))?.blocked)).toBe(
      true,
    );
    expect(await h.read(async (store) => (await store.sight(ATHLETE_A, ATHLETE_C))?.blocked)).toBe(
      false,
    );
    expect(await h.write((store) => store.deleteBlock(ATHLETE_B, ATHLETE_A))).toBe(false);
    expect(await h.read(async (store) => (await store.sight(ATHLETE_A, ATHLETE_B))?.blocked)).toBe(
      true,
    );
    expect(await h.write((store) => store.deleteBlock(ATHLETE_A, ATHLETE_B))).toBe(true);
    expect(await h.read(async (store) => (await store.sight(ATHLETE_A, ATHLETE_B))?.blocked)).toBe(
      false,
    );
  });
});

describe('a block’s handle and the name it was made under (#1529)', () => {
  async function threeAthletes(): Promise<StoreHarness> {
    harness = await createStoreHarness();
    await harness.write(async (store) => {
      for (const athlete of [ATHLETE_A, ATHLETE_B, ATHLETE_C]) {
        await store.putAthlete({
          id: athlete,
          displayName: athlete,
          createdAt: 1,
          registrationState: 'active',
        });
      }
    });
    return harness;
  }

  it('gives every block its own opaque handle, never the blocked id, and keeps the name shown', async () => {
    const h = await threeAthletes();
    await h.write(async (store) => {
      await store.putBlock(ATHLETE_A, ATHLETE_B, 2, 'Bea');
      await store.putBlock(ATHLETE_A, ATHLETE_C, 3);
    });
    const held = await h.read((store) => store.listBlocks(ATHLETE_A));
    expect(held.map((block) => [block.blockedAthleteId, block.shownName])).toEqual([
      [ATHLETE_B, 'Bea'],
      [ATHLETE_C, null],
    ]);
    for (const block of held) {
      expect(block.handle).toMatch(/^[0-9a-f]{32}$/);
      expect(block.handle).not.toContain(block.blockedAthleteId);
    }
    expect(new Set(held.map((block) => block.handle)).size).toBe(2);
  });

  it('lifts a block by its handle for the blocker only: another athlete’s handle deletes nothing', async () => {
    const h = await threeAthletes();
    await h.write((store) => store.putBlock(ATHLETE_A, ATHLETE_B, 2, 'Bea'));
    const [block] = await h.read((store) => store.listBlocks(ATHLETE_A));
    const handle = block?.handle ?? '';
    // B, and C, holding A's handle: the row is A's, so nothing goes.
    expect(await h.write((store) => store.deleteBlockByHandle(ATHLETE_B, handle))).toBe(false);
    expect(await h.write((store) => store.deleteBlockByHandle(ATHLETE_C, handle))).toBe(false);
    expect(await h.read(async (store) => (await store.sight(ATHLETE_B, ATHLETE_A))?.blocked)).toBe(
      true,
    );
    expect(await h.write((store) => store.deleteBlockByHandle(ATHLETE_A, handle))).toBe(true);
    expect(await h.read(async (store) => (await store.sight(ATHLETE_A, ATHLETE_B))?.blocked)).toBe(
      false,
    );
    expect(await h.read((store) => store.listBlocks(ATHLETE_A))).toEqual([]);
  });

  it('forgets the name when the blocked athlete erases their account, and keeps the block (#899)', async () => {
    const h = await threeAthletes();
    await h.write(async (store) => {
      await store.putBlock(ATHLETE_A, ATHLETE_B, 2, 'Bea');
      await store.putBlock(ATHLETE_A, ATHLETE_C, 3, 'Cy');
    });
    await h.write((store) => store.eraseAthlete(ATHLETE_B));
    const held = await h.read((store) => store.listBlocks(ATHLETE_A));
    expect(held.map((block) => [block.blockedAthleteId, block.shownName])).toEqual([
      [ATHLETE_B, null],
      [ATHLETE_C, 'Cy'],
    ]);
  });
});

describe('the moderators’ two lists, read a page at a time (#961, #1166)', () => {
  it('reads every entry of a log longer than one page, oldest first, through the paged read', async () => {
    const h = await seeded();
    const before = (await h.read((store) => wholeModerationLog(store))).length;
    await h.write(async (store) => {
      for (let index = 0; index < 201; index += 1) {
        await store.logRefusedAction({ ...suspendB, reason: `Refused ${String(index)}` });
      }
    });
    const ids = (await h.read((store) => wholeModerationLog(store))).map((entry) => entry.id);
    expect(ids).toHaveLength(before + 201);
    expect(ids).toEqual([...ids].sort((left, right) => left - right));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('pages the suspended accounts through an index, never a scan of every athlete', async () => {
    const h = await seeded();
    const statements: string[] = [];
    const store = await openSqlStore(h.path, { onQuery: (sql) => statements.push(sql) });
    try {
      await store.listSuspendedAthletes(undefined, 51);
      await store.listSuspendedAthletes({ suspendedAt: 1_790_000_000, id: ATHLETE_B }, 51);
    } finally {
      await store.close();
    }
    const reads = statements.filter((each) => each.includes('suspended_at'));
    expect(reads).toHaveLength(2);
    const database = openDatabase(h.path);
    try {
      for (const read of reads) {
        // Unbound parameters are NULL to EXPLAIN: the plan, not the rows, is the point.
        const plan = (database.prepare(`EXPLAIN QUERY PLAN ${read}`).all() as { detail: string }[])
          .map((row) => row.detail)
          .join('\n');
        expect(plan, read).toMatch(/INDEX athlete_suspended\b/);
        expect(plan, read).not.toMatch(/TEMP B-TREE/);
      }
    } finally {
      database.close();
    }
  });
});
