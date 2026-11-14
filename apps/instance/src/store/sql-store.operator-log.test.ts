// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The operator log's store half (#2602): ONE store function runs an action's
 * change and appends its entry in one transaction, the log is append-only in
 * the SCHEMA, and erasing an account keeps it. Every read is on a fresh
 * connection (`testing/index.ts`), never the one that wrote.
 */

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';

import { openDatabase } from './node-sqlite.ts';
import { openSqlStore } from './open-sql-store.ts';
import { OperatorEntryError, type OperatorEntry, type SqlStore } from './sql-store.ts';
import {
  ATHLETE_A,
  ATHLETE_B,
  athleteFixture,
  createStoreHarness,
  deviceKeyFixture,
  registrationFixture,
  type StoreHarness,
} from './testing/index.ts';

let harness: StoreHarness | undefined;
afterEach(async () => {
  await harness?.destroy();
  harness = undefined;
});

async function withAthletes(): Promise<StoreHarness> {
  harness = await createStoreHarness();
  await harness.write(async (store) => {
    await store.registerAthlete(registrationFixture(ATHLETE_A));
    await store.registerAthlete(registrationFixture(ATHLETE_B));
  });
  return harness;
}

const FROM_THE_APP: OperatorEntry = {
  actor: { source: 'app', athleteId: ATHLETE_A },
  action: 'room_open',
  at: 1_790_003_000,
};

const ROOM = {
  id: 'operator-room',
  kind: 'group',
  visibility: 'private',
  routeSha256: 'ab'.repeat(32),
  physicsVersion: 1,
} as const;

const wholeLog = (store: SqlStore) => store.listOperatorLogPage(undefined, 200);

describe('the operator store function (#2602)', () => {
  it('applies the change and appends its entry together, both read back on a fresh connection', async () => {
    const h = await withAthletes();
    const done = await h.write((store) =>
      store.recordOperatorAction(FROM_THE_APP, async (inside) => {
        await inside.putRoom(ROOM);
        return { outcome: 'done', detail: 'kind_ride,length=450', value: 'opened' };
      }),
    );
    expect(done.value).toBe('opened');
    expect(await h.read((store) => store.getRoom(ROOM.id))).toMatchObject({ id: ROOM.id });
    expect(await h.read(wholeLog)).toEqual([
      {
        id: done.logId,
        at: 1_790_003_000,
        source: 'app',
        actorAthleteId: ATHLETE_A,
        action: 'room_open',
        detail: 'kind_ride,length=450',
        outcome: 'done',
      },
    ]);
  });

  it('writes a CLI entry with no actor: the CLI has no athlete, and borrows none', async () => {
    const h = await withAthletes();
    await h.write((store) =>
      store.recordOperatorAction(
        { actor: { source: 'cli' }, action: 'model_key_clear', at: 1_790_003_001 },
        () => ({ outcome: 'done', value: undefined }),
      ),
    );
    expect(await h.read(wholeLog)).toMatchObject([
      { source: 'cli', actorAthleteId: null, action: 'model_key_clear', detail: null },
    ]);
  });

  it('keeps nothing of a change that throws, logs the attempt as failed, and throws on', async () => {
    const h = await withAthletes();
    await expect(
      h.write((store) =>
        store.recordOperatorAction(FROM_THE_APP, async (inside) => {
          await inside.putRoom(ROOM);
          throw new Error('the change broke after its first write');
        }),
      ),
    ).rejects.toThrow('the change broke');
    expect(await h.read((store) => store.getRoom(ROOM.id))).toBeUndefined();
    expect(await h.read(wholeLog)).toMatchObject([
      { action: 'room_open', outcome: 'failed', detail: null, actorAthleteId: ATHLETE_A },
    ]);
  });

  it('keeps nothing of the change when the log entry cannot be written', async () => {
    const h = await withAthletes();
    // The real SQLite store, made to refuse every insert into the log.
    const database = openDatabase(h.path);
    try {
      database.exec(`create trigger operator_log_refuses_test before insert on operator_log
        begin select raise(abort, 'the log refused this entry'); end`);
    } finally {
      database.close();
    }
    await expect(
      h.write((store) =>
        store.recordOperatorAction(FROM_THE_APP, async (inside) => {
          await inside.putRoom(ROOM);
          return { outcome: 'done', value: undefined };
        }),
      ),
    ).rejects.toThrow(/the log refused this entry/);
    // A fresh read: the paired change is not there, and neither is an entry.
    expect(await h.read((store) => store.getRoom(ROOM.id))).toBeUndefined();
    expect(await h.read(wholeLog)).toEqual([]);
  });

  it('refuses a detail that is free text, a decimal or a signed number, keeping nothing of the change', async () => {
    const h = await withAthletes();
    for (const detail of ['Rotated by hand', 'latitude=51.5', 'offset=-3', 'a'.repeat(40)]) {
      await expect(
        h.write((store) =>
          store.recordOperatorAction(FROM_THE_APP, async (inside) => {
            await inside.putRoom(ROOM);
            return { outcome: 'done', detail, value: undefined };
          }),
        ),
        detail,
      ).rejects.toThrow(OperatorEntryError);
      expect(await h.read((store) => store.getRoom(ROOM.id)), detail).toBeUndefined();
    }
    // Each attempt is in the log as failed, and no entry carries the detail refused.
    const log = await h.read(wholeLog);
    expect(log.map((entry) => [entry.outcome, entry.detail])).toEqual(
      Array.from({ length: 4 }, () => ['failed', null]),
    );
  });

  it('refuses an action that is not on the closed list, before anything runs', async () => {
    const h = await withAthletes();
    let ran = false;
    await expect(
      h.write((store) =>
        store.recordOperatorAction(
          { ...FROM_THE_APP, action: 'drop_everything' as OperatorEntry['action'] },
          () => {
            ran = true;
            return { outcome: 'done', value: undefined };
          },
        ),
      ),
    ).rejects.toThrow(OperatorEntryError);
    expect(ran).toBe(false);
    expect(await h.read(wholeLog)).toEqual([]);
  });

  it('rolls back what a store call inside the change rolled back itself, and keeps the rest', async () => {
    const h = await withAthletes();
    const invite = 'e'.repeat(64);
    await h.write((store) =>
      store.mintInviteCode(
        { codeSha256: invite, athleteId: ATHLETE_A, expiresAt: 1_800_000_000 },
        { reason: 'For the test', at: 1_790_002_900 },
      ),
    );
    // A registration that spends the invitation, then finds its key is
    // already B's and throws: inside its own transaction, the spend goes too.
    await h.write((store) =>
      store.recordOperatorAction(FROM_THE_APP, async (inside) => {
        await inside.putRoom(ROOM);
        await expect(
          inside.registerAthlete({
            ...registrationFixture('athlete-d'),
            athlete: athleteFixture('athlete-d'),
            key: { ...deviceKeyFixture(ATHLETE_B), athleteId: 'athlete-d' },
            inviteCodeSha256: invite,
          }),
        ).rejects.toThrow(/another athlete/);
        return { outcome: 'done', value: undefined };
      }),
    );
    expect(await h.read((store) => store.getRoom(ROOM.id))).toMatchObject({ id: ROOM.id });
    expect(await h.read((store) => store.listInviteCodes(ATHLETE_A))).toMatchObject([
      { codeSha256: invite, usedAt: null },
    ]);
    expect(await h.read((store) => store.getAthlete('athlete-d'))).toBeUndefined();
  });

  it('pages newest first, below the id it is given', async () => {
    const h = await withAthletes();
    await h.write(async (store) => {
      for (let at = 1; at <= 5; at += 1) {
        await store.recordOperatorAction({ ...FROM_THE_APP, at }, () => ({
          outcome: at % 2 === 0 ? 'refused' : 'done',
          value: undefined,
        }));
      }
    });
    expect(
      (await h.read((store) => store.listOperatorLogPage(undefined, 2))).map((e) => e.at),
    ).toEqual([5, 4]);
    const third = (await h.read(wholeLog))[2];
    expect(third?.at).toBe(3);
    expect(
      (await h.read((store) => store.listOperatorLogPage(third?.id, 10))).map((e) => [
        e.at,
        e.outcome,
      ]),
    ).toEqual([
      [2, 'refused'],
      [1, 'done'],
    ]);
  });
});

describe('the operator log is append-only in the schema (#2602)', () => {
  it('refuses UPDATE and DELETE against the real SQLite store', async () => {
    const h = await withAthletes();
    await h.write((store) =>
      store.recordOperatorAction(FROM_THE_APP, () => ({ outcome: 'done', value: undefined })),
    );
    const database = openDatabase(h.path);
    try {
      expect(() => database.exec("UPDATE operator_log SET outcome = 'refused'")).toThrow(
        /append-only/,
      );
      expect(() => database.exec('DELETE FROM operator_log')).toThrow(/append-only/);
    } finally {
      database.close();
    }
    expect(await h.read(wholeLog)).toMatchObject([{ outcome: 'done' }]);
  });

  it('refuses, in the schema, an app entry with no actor and a CLI entry with one', async () => {
    const h = await withAthletes();
    const database = openDatabase(h.path);
    try {
      expect(() =>
        database.exec(
          "INSERT INTO operator_log (at, source, actor_athlete_id, action, outcome) VALUES (1, 'app', NULL, 'migrate', 'done')",
        ),
      ).toThrow(/CHECK/);
      expect(() =>
        database.exec(
          "INSERT INTO operator_log (at, source, actor_athlete_id, action, outcome) VALUES (1, 'cli', 'athlete-a', 'migrate', 'done')",
        ),
      ).toThrow(/CHECK/);
      expect(() =>
        database.exec(
          "INSERT INTO operator_log (at, source, actor_athlete_id, action, outcome) VALUES (1, 'cli', NULL, 'migrate', 'maybe')",
        ),
      ).toThrow(/CHECK/);
    } finally {
      database.close();
    }
  });

  it('keeps every entry when the actor’s account is erased, as the moderation log does', async () => {
    const h = await withAthletes();
    await h.write((store) =>
      store.recordOperatorAction(FROM_THE_APP, () => ({ outcome: 'done', value: undefined })),
    );
    await h.write((store) => store.eraseAthlete(ATHLETE_A));
    expect(await h.read((store) => store.getAthlete(ATHLETE_A))).toBeUndefined();
    expect(await h.read(wholeLog)).toMatchObject([
      { actorAthleteId: ATHLETE_A, action: 'room_open', outcome: 'done' },
    ]);
  });
});

describe('a scrub inside an operator action (#2602, #1097)', () => {
  it('still leaves no byte of a cleared hosted key on disk once the action commits', async () => {
    harness = await createStoreHarness();
    await harness.write((store) => store.registerAthlete(registrationFixture(ATHLETE_A)));
    const marker = 'OPERATOR-SCRUB-MARKER-2602';
    const store = await openSqlStore(harness.path);
    try {
      await store.putHostedModelKey(ATHLETE_A, {
        url: 'https://models.example/v1',
        model: 'a-model',
        iv: new Uint8Array(12).fill(9),
        ciphertext: new TextEncoder().encode(marker),
        setAt: 1_790_000_000,
      });
      const onDisk = async (): Promise<string> => {
        let bytes = '';
        for (const suffix of ['', '-wal']) {
          const file = `${harness?.path ?? ''}${suffix}`;
          if (existsSync(file)) bytes += (await readFile(file)).toString('latin1');
        }
        return bytes;
      };
      expect(await onDisk()).toContain(marker);
      const cleared = await store.recordOperatorAction(
        { actor: { source: 'cli' }, action: 'model_key_clear', at: 1_790_003_002 },
        async (inside) => ({ outcome: 'done', value: await inside.clearHostedModelKey() }),
      );
      expect(cleared.value).toBe(true);
      // Read while this connection is open: closing it would checkpoint anyway.
      expect(await onDisk()).not.toContain(marker);
    } finally {
      await store.close();
    }
    expect(await harness.read((read) => read.getHostedModelKey())).toBeUndefined();
  });
});
