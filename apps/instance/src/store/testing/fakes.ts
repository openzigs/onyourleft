// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Deliberately broken stores, one per cause of `CLAUDE.md` §5's defect shape
 * (#769). Each reports success and each loses the write a different way; the
 * round trip in `index.ts` must go RED against every one of them
 * (`harness.test.ts`), which is what shows it can.
 *
 * Each breaks `putActivityRecord` — the write that carries a rider's signed
 * record — and leaves the rest of the real store alone, so the only thing a
 * red result can be about is the write.
 */

import { openSqlStore } from '../open-sql-store.ts';
import { openDatabase } from '../node-sqlite.ts';
import type { ActivityRecord, SqlStore } from '../sql-store.ts';
import type { StoreFactory } from './index.ts';

/** Wrong storage: the record goes into this store object's memory, and the read is served from it. */
export const memoryStoreFactory: StoreFactory = async (path) => {
  const real = await openSqlStore(path);
  const memory = new Map<string, ActivityRecord>();
  const key = (athleteId: string, contentSha256: string): string =>
    `${athleteId}\u0000${contentSha256}`;
  return {
    ...real,
    putActivityRecord: (record) => {
      memory.set(key(record.athleteId, record.contentSha256), record);
      return Promise.resolve('stored');
    },
    getActivityRecord: async (athleteId, contentSha256) =>
      memory.get(key(athleteId, contentSha256)) ??
      (await real.getActivityRecord(athleteId, contentSha256)),
  };
};

/** Wrong key: the record is committed, under a content key the reader does not use. */
export const wrongKeyStoreFactory: StoreFactory = async (path) => {
  const real = await openSqlStore(path);
  return {
    ...real,
    putActivityRecord: (record) =>
      real.putActivityRecord({
        ...record,
        contentSha256: [...record.contentSha256].reverse().join(''),
      }),
  };
};

/**
 * Wrong time: the insert runs inside a transaction that is never committed,
 * on a second connection. Closing the store closes that connection, and SQLite
 * rolls the transaction back.
 */
export const uncommittedStoreFactory: StoreFactory = async (path) => {
  const real = await openSqlStore(path);
  const side = openDatabase(path);
  let open = true;
  const store: SqlStore = {
    ...real,
    putActivityRecord: (record) => {
      if (!side.isTransaction) side.exec('BEGIN');
      side
        .prepare(
          'INSERT INTO activity_record (athlete_id, content_sha256, signed_record, received_at) VALUES (?, ?, ?, ?)',
        )
        .run(record.athleteId, record.contentSha256, record.signedRecord, record.receivedAt);
      return Promise.resolve('stored');
    },
    close: async () => {
      if (open) {
        open = false;
        side.close();
      }
      await real.close();
    },
  };
  return store;
};
