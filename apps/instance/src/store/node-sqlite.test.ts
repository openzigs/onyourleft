// SPDX-License-Identifier: AGPL-3.0-or-later

import { mkdtemp, rm } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Kysely, SqliteDialect, type SqliteDatabase } from 'kysely';
import { afterEach, describe, expect, it } from 'vitest';
import { BUSY_TIMEOUT_MILLISECONDS, kyselyDatabase, openDatabase } from './node-sqlite.ts';

interface Probe {
  readonly t: { readonly a: string; readonly b: number };
}

function seeded(): DatabaseSync {
  const database = new DatabaseSync(':memory:');
  database.exec(`CREATE TABLE t (a TEXT, b INTEGER); INSERT INTO t VALUES ('x', 1), ('y', 2)`);
  return database;
}

const kyselyOver = (database: SqliteDatabase): Kysely<Probe> =>
  new Kysely<Probe>({ dialect: new SqliteDialect({ database }) });

describe('Kysely over node:sqlite (#769)', () => {
  it('reads rows back, with every parameter bound', async () => {
    const db = kyselyOver(kyselyDatabase(seeded()));
    const rows = await db
      .selectFrom('t')
      .select(['a', 'b'])
      .where('a', '=', 'y')
      .where('b', '=', 2)
      .execute();
    expect(rows.map((row) => ({ ...row }))).toEqual([{ a: 'y', b: 2 }]);
    await db.destroy();
  });

  it('reads the rows an INSERT … RETURNING returns, and runs a plain write', async () => {
    const db = kyselyOver(kyselyDatabase(seeded()));
    const returned = await db
      .insertInto('t')
      .values({ a: 'z', b: 3 })
      .returning('a')
      .executeTakeFirst();
    expect(returned?.a).toBe('z');
    const written = await db.updateTable('t').set({ b: 9 }).where('a', '=', 'x').executeTakeFirst();
    expect(written.numUpdatedRows).toBe(1n);
    await db.destroy();
  });

  it('streams rows through iterate()', async () => {
    const db = kyselyOver(kyselyDatabase(seeded()));
    const streamed: string[] = [];
    for await (const row of db.selectFrom('t').select('a').orderBy('a').stream()) {
      streamed.push(row.a);
    }
    expect(streamed).toEqual(['x', 'y']);
    await db.destroy();
  });

  it('is needed: the database as it is reads NOTHING, silently (the control)', async () => {
    // What #769's comment measured: no `reader`, so every SELECT takes `run()`.
    const db = kyselyOver(seeded() as unknown as SqliteDatabase);
    expect(await db.selectFrom('t').selectAll().execute()).toEqual([]);
    await db.destroy();
  });
});

describe('the pragmas every connection gets (#769)', () => {
  let directory: string | undefined;
  afterEach(async () => {
    if (directory !== undefined) await rm(directory, { recursive: true, force: true });
    directory = undefined;
  });

  it('are WAL, a busy timeout and foreign keys, read back from a connection', async () => {
    directory = await mkdtemp(join(tmpdir(), 'oyl-instance-pragmas-'));
    const database = openDatabase(join(directory, 'instance.sqlite'));
    const pragma = (name: string): unknown =>
      Object.values(database.prepare(`PRAGMA ${name}`).get() ?? {})[0];
    expect(pragma('journal_mode')).toBe('wal');
    expect(pragma('busy_timeout')).toBe(BUSY_TIMEOUT_MILLISECONDS);
    expect(BUSY_TIMEOUT_MILLISECONDS).toBeGreaterThan(0);
    expect(pragma('foreign_keys')).toBe(1);
    database.close();
  });

  it('refuses a busy timeout that is not a whole number of milliseconds', async () => {
    directory = await mkdtemp(join(tmpdir(), 'oyl-instance-pragmas-'));
    const path = join(directory, 'instance.sqlite');
    for (const busyTimeoutMilliseconds of [-1, 1.5, Number.NaN]) {
      expect(() => openDatabase(path, { busyTimeoutMilliseconds })).toThrow(RangeError);
    }
    const database = openDatabase(path, { busyTimeoutMilliseconds: 0 });
    expect(Object.values(database.prepare('PRAGMA busy_timeout').get() ?? {})[0]).toBe(0);
    database.close();
  });

  it('takes the write lock when a transaction BEGINS, deterministically, in one thread', async () => {
    // `sql-store.concurrency.test.ts` shows the same in two threads, and can
    // miss it when they happen not to overlap (#842's review saw 1 run in 11).
    // Here the interleaving is written out: the transaction reads, a second
    // connection tries to write, then the transaction writes. With a bare
    // DEFERRED `begin` the second connection's write lands and the
    // transaction's own write is refused mid-way; with `BEGIN IMMEDIATE` the
    // second connection is the one refused, and the transaction commits.
    directory = await mkdtemp(join(tmpdir(), 'oyl-instance-pragmas-'));
    const path = join(directory, 'instance.sqlite');
    const setup = openDatabase(path);
    setup.exec(`CREATE TABLE t (a TEXT, b INTEGER)`);
    setup.close();
    const db = kyselyOver(kyselyDatabase(openDatabase(path, { busyTimeoutMilliseconds: 0 })));
    const other = openDatabase(path, { busyTimeoutMilliseconds: 0 });
    try {
      await db.transaction().execute(async (trx) => {
        await trx.selectFrom('t').selectAll().execute();
        expect(() => other.prepare(`INSERT INTO t VALUES ('other', 0)`).run()).toThrow(
          /database is locked/,
        );
        await trx.insertInto('t').values({ a: 'mine', b: 1 }).execute();
      });
      expect(
        other
          .prepare('SELECT a FROM t')
          .all()
          .map((row) => row.a),
      ).toEqual(['mine']);
    } finally {
      other.close();
      await db.destroy();
    }
  });
});
