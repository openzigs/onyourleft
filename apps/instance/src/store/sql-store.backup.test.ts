// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The backup records and "back up now" in the store (#2606, migration 0042),
 * written through one connection and read back through a fresh one, as the
 * `backup` service writes them and the instance reads them.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { openDatabase } from './node-sqlite.ts';
import {
  BACKUP_RECORD_DAYS,
  BACKUP_REQUEST_GAP_SECONDS,
  type BackupRun,
  type SqlStore,
} from './sql-store.ts';
import { createStoreHarness, type StoreHarness } from './testing/index.ts';

let harness: StoreHarness | undefined;
afterEach(async () => {
  await harness?.destroy();
  harness = undefined;
});

const DAY = 86_400;
const T = 1_790_000_000;

function snapshotRun(at: number, intervalSeconds: number | null = 21_600): BackupRun {
  return {
    outcome: 'done',
    at,
    snapshot: `snapshot-${String(at)}`,
    rows: 10,
    blobs: 1,
    databaseSha256: 'a'.repeat(64),
    sizeBytes: 100,
    offBox: 'copied',
    removed: 0,
    backupsFreeBytes: 5,
    offBoxFreeBytes: 6,
    intervalSeconds,
  };
}

async function opened(): Promise<StoreHarness> {
  harness = await createStoreHarness();
  return harness;
}

const ats = (store: SqlStore) =>
  store.listBackupRecords(500).then((records) => records.map((record) => record.at));

describe('backup records (#2606)', () => {
  it('reads a run back as it was written, newest first, on a fresh connection', async () => {
    const store = await opened();
    await store.write(async (writer) => {
      await writer.recordBackup(snapshotRun(T));
      await writer.recordBackup({
        outcome: 'failed',
        at: T + 60,
        error: 'ENOSPC',
        intervalSeconds: null,
      });
    });
    const records = await store.read((reader) => reader.listBackupRecords(10));
    expect(records).toEqual([
      expect.objectContaining({
        at: T + 60,
        outcome: 'failed',
        error: 'ENOSPC',
        snapshot: null,
        offBox: null,
        requested: false,
      }),
      expect.objectContaining({
        at: T,
        outcome: 'done',
        error: null,
        snapshot: `snapshot-${String(T)}`,
        rows: 10,
        blobs: 1,
        databaseSha256: 'a'.repeat(64),
        sizeBytes: 100,
        offBox: 'copied',
        removed: 0,
        backupsFreeBytes: 5,
        offBoxFreeBytes: 6,
        intervalSeconds: 21_600,
        requested: false,
      }),
    ]);
  });

  it('never holds a record more than 30 days older than the newest run, and keeps every younger one', async () => {
    const store = await opened();
    // A run every five days for forty days: nine runs, more than any count a
    // `--keep` would name, so a deletion by count could not pass by chance.
    await store.write(async (writer) => {
      for (let day = 0; day <= 40; day += 5) await writer.recordBackup(snapshotRun(T + day * DAY));
    });
    const newest = T + 40 * DAY;
    const kept = await store.read(ats);
    expect(Math.min(...kept)).toBeGreaterThanOrEqual(newest - BACKUP_RECORD_DAYS * DAY);
    // Exactly the runs of the last 30 days: day 10 to day 40.
    expect(kept).toEqual([40, 35, 30, 25, 20, 15, 10].map((day) => T + day * DAY));
  });

  it('answers the backup service’s newest — done, or any — and never a one-off run', async () => {
    const store = await opened();
    await store.write(async (writer) => {
      await writer.recordBackup(snapshotRun(T));
      await writer.recordBackup({
        outcome: 'failed',
        at: T + 10,
        error: 'Error',
        intervalSeconds: 60,
      });
      // The pre-deploy snapshot: no interval.
      await writer.recordBackup(snapshotRun(T + 20, null));
    });
    expect((await store.read((reader) => reader.newestServiceBackup(true)))?.at).toBe(T);
    expect((await store.read((reader) => reader.newestServiceBackup(false)))?.at).toBe(T + 10);
  });
});

describe('“back up now” in the store (#2606)', () => {
  it('writes a request, refuses a second while it waits, and serves it once', async () => {
    const store = await opened();
    const asked = await store.write((writer) => writer.requestBackup(T));
    expect(asked).toEqual({
      outcome: 'requested',
      request: { id: expect.any(Number) as unknown, requestedAt: T },
    });
    if (asked.outcome !== 'requested') throw new Error('not requested');
    expect(await store.write((writer) => writer.requestBackup(T + 1))).toEqual({
      outcome: 'pending',
    });
    expect(await store.read((reader) => reader.pendingBackupRequest())).toEqual(asked.request);

    const first = await store.write((writer) =>
      writer.recordBackup(snapshotRun(T + 30), asked.request.id),
    );
    expect(first.served).toBe(true);
    // A second run naming the same request does not serve it again.
    const second = await store.write((writer) =>
      writer.recordBackup(snapshotRun(T + 31 + BACKUP_REQUEST_GAP_SECONDS), asked.request.id),
    );
    expect(second.served).toBe(false);
    expect(await store.read((reader) => reader.pendingBackupRequest())).toBeUndefined();
    const records = await store.read((reader) => reader.listBackupRecords(10));
    expect(records.map((record) => [record.id, record.requested])).toEqual([
      [second.id, false],
      [first.id, true],
    ]);
    // Read in the schema itself: the request names the record that served it.
    const database = openDatabase(store.path);
    try {
      expect(database.prepare('SELECT record_id FROM backup_request').all()).toEqual([
        { record_id: first.id },
      ]);
    } finally {
      database.close();
    }
  });

  it('refuses a request within 15 minutes of a snapshot, and not after, nor after a failed run', async () => {
    const store = await opened();
    await store.write((writer) => writer.recordBackup(snapshotRun(T)));
    expect(
      await store.write((writer) => writer.requestBackup(T + BACKUP_REQUEST_GAP_SECONDS - 1)),
    ).toEqual({
      outcome: 'too_soon',
    });
    expect(await store.read((reader) => reader.pendingBackupRequest())).toBeUndefined();
    await store.write((writer) =>
      writer.recordBackup({
        outcome: 'failed',
        at: T + BACKUP_REQUEST_GAP_SECONDS,
        error: 'Error',
        intervalSeconds: null,
      }),
    );
    expect(
      (await store.write((writer) => writer.requestBackup(T + BACKUP_REQUEST_GAP_SECONDS))).outcome,
    ).toBe('requested');
  });

  it('deletes a served request with its 30 days, and never a waiting one', async () => {
    const store = await opened();
    await store.write(async (writer) => {
      const old = await writer.requestBackup(T);
      if (old.outcome !== 'requested') throw new Error('not requested');
      await writer.recordBackup(snapshotRun(T + 10), old.request.id);
    });
    // A request that waits through a month (no service running) is still there.
    const waiting = await store.write((writer) => writer.requestBackup(T + 20 * DAY));
    await store.write((writer) => writer.recordBackup(snapshotRun(T + 60 * DAY)));
    const database = openDatabase(store.path);
    try {
      expect(database.prepare('SELECT requested_at FROM backup_request').all()).toEqual([
        { requested_at: T + 20 * DAY },
      ]);
    } finally {
      database.close();
    }
    expect(waiting.outcome).toBe('requested');
  });

  it('deletes a request with the record that served it, even one stamped later by a clock running ahead', async () => {
    const store = await opened();
    await store.write(async (writer) => {
      // The instance's clock ran forty days ahead of the backup service's.
      const asked = await writer.requestBackup(T + 40 * DAY);
      if (asked.outcome !== 'requested') throw new Error('not requested');
      await writer.recordBackup(snapshotRun(T), asked.request.id);
    });
    // A month on, the record goes; its request must not be left naming it.
    await store.write((writer) => writer.recordBackup(snapshotRun(T + 31 * DAY)));
    expect(await store.read(ats)).toEqual([T + 31 * DAY]);
    const database = openDatabase(store.path);
    try {
      expect(database.prepare('SELECT count(*) AS n FROM backup_request').get()).toEqual({ n: 0 });
    } finally {
      database.close();
    }
  });

  it('holds a record to its shape in the schema: no path for a snapshot, no message for an error', async () => {
    const store = await opened();
    await store.write(() => Promise.resolve());
    const database = openDatabase(store.path);
    try {
      for (const insert of [
        `INSERT INTO backup_record (at, outcome, snapshot, off_box) VALUES (1, 'done', '/backups/snapshot-x', 'copied')`,
        `INSERT INTO backup_record (at, outcome, error) VALUES (1, 'failed', 'ENOENT: no such file, open ''/home/me''')`,
        `INSERT INTO backup_record (at, outcome, snapshot, off_box) VALUES (1, 'done', 'snapshot-x', 'lost')`,
        `INSERT INTO backup_record (at, outcome) VALUES (1, 'failed')`,
      ]) {
        expect(() => database.exec(insert), insert).toThrow(/CHECK/);
      }
    } finally {
      database.close();
    }
  });
});
