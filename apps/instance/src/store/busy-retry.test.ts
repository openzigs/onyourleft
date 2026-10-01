// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The retry of a statement that met another connection's lock (#985).
 *
 * The first half is the rule over a fake connection: which errors are run
 * again, how many times, and never inside a transaction. The second is the
 * real thing — another THREAD holds the write lock past this connection's
 * busy timeout and then lets go, and a store write must land rather than
 * fail with "database is locked"; held for good, the write fails, bounded.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { CompiledQuery, type DatabaseConnection, type QueryResult } from 'kysely';
import { afterEach, describe, expect, it } from 'vitest';
import { BUSY_RETRY_DELAYS_MILLISECONDS, isBusy, retryingConnection } from './busy-retry.ts';
import { BUSY_TIMEOUT_MILLISECONDS } from './node-sqlite.ts';
import { openSqlStore } from './open-sql-store.ts';

/** `node:sqlite`'s error, as it throws one. */
function sqliteError(errcode: number, errstr: string): Error {
  return Object.assign(new Error(errstr), { code: 'ERR_SQLITE_ERROR', errcode, errstr });
}

const BUSY = sqliteError(5, 'database is locked');

function failing(errors: readonly Error[]): DatabaseConnection & { readonly calls: number } {
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    executeQuery: <R>(): Promise<QueryResult<R>> => {
      const error = errors[calls];
      calls += 1;
      return error === undefined ? Promise.resolve({ rows: [] }) : Promise.reject(error);
    },
    streamQuery: () => {
      throw new Error('not used');
    },
  };
}

const QUERY = CompiledQuery.raw('begin');

describe('which errors are SQLITE_BUSY', () => {
  it('reads the primary code out of an extended one, and nothing else', () => {
    expect(isBusy(BUSY)).toBe(true);
    // SQLITE_BUSY_SNAPSHOT, 5 | 2 << 8.
    expect(isBusy(sqliteError(517, 'database is locked'))).toBe(true);
    // SQLITE_LOCKED is a different code, and so is a constraint failure.
    expect(isBusy(sqliteError(6, 'database table is locked'))).toBe(false);
    expect(isBusy(sqliteError(19, 'UNIQUE constraint failed'))).toBe(false);
    expect(isBusy(new Error('database is locked'))).toBe(false);
    expect(isBusy(undefined)).toBe(false);
  });
});

describe('a statement that met the lock (#985)', () => {
  it('outside a transaction, is run again after each pause, and lands', async () => {
    const inner = failing([BUSY, BUSY]);
    const pauses: number[] = [];
    const connection = retryingConnection(inner, {
      inTransaction: () => false,
      delaysMilliseconds: [10, 20, 30],
      sleep: (milliseconds) => {
        pauses.push(milliseconds);
        return Promise.resolve();
      },
    });
    await expect(connection.executeQuery(QUERY)).resolves.toEqual({ rows: [] });
    expect(inner.calls).toBe(3);
    expect(pauses).toEqual([10, 20]);
  });

  it('gives up after the last pause, with the error SQLite gave', async () => {
    const inner = failing([BUSY, BUSY, BUSY, BUSY, BUSY]);
    const connection = retryingConnection(inner, {
      inTransaction: () => false,
      delaysMilliseconds: [1, 1],
      sleep: () => Promise.resolve(),
    });
    await expect(connection.executeQuery(QUERY)).rejects.toBe(BUSY);
    expect(inner.calls).toBe(3);
  });

  it('inside a transaction, is not run again', async () => {
    const inner = failing([BUSY]);
    const connection = retryingConnection(inner, {
      inTransaction: () => true,
      delaysMilliseconds: [1],
      sleep: () => Promise.resolve(),
    });
    await expect(connection.executeQuery(QUERY)).rejects.toBe(BUSY);
    expect(inner.calls).toBe(1);
  });

  it('that failed for any other reason, is not run again', async () => {
    const unique = sqliteError(19, 'UNIQUE constraint failed');
    const inner = failing([unique]);
    const connection = retryingConnection(inner, {
      inTransaction: () => false,
      delaysMilliseconds: [1],
      sleep: () => Promise.resolve(),
    });
    await expect(connection.executeQuery(QUERY)).rejects.toBe(unique);
    expect(inner.calls).toBe(1);
  });

  it('waits about twenty seconds in all by default, at the default busy timeout', () => {
    const attempts = BUSY_RETRY_DELAYS_MILLISECONDS.length + 1;
    const patience =
      attempts * BUSY_TIMEOUT_MILLISECONDS +
      BUSY_RETRY_DELAYS_MILLISECONDS.reduce((sum, delay) => sum + delay, 0);
    expect(patience).toBeGreaterThanOrEqual(15_000);
    expect(patience).toBeLessThanOrEqual(30_000);
    expect(BUSY_RETRY_DELAYS_MILLISECONDS.every((delay) => delay > 0)).toBe(true);
  });
});

/**
 * Another thread takes the write lock, says so, and holds it until it is
 * signalled or `holdMilliseconds` pass. Plain JavaScript, so Node runs it as
 * it is.
 */
const HOLDER = `
const { workerData, parentPort } = require('node:worker_threads');
const { DatabaseSync } = require('node:sqlite');
const database = new DatabaseSync(workerData.path);
database.exec('BEGIN IMMEDIATE');
database.exec("INSERT INTO athlete (id, display_name, created_at, registration_state) VALUES ('holder', 'Holder', 1, 'active')");
parentPort.postMessage('held');
Atomics.wait(new Int32Array(workerData.gate), 0, 0, workerData.holdMilliseconds);
database.exec('COMMIT');
database.close();
parentPort.postMessage('released');
`;

interface Holder {
  readonly held: Promise<void>;
  readonly released: Promise<void>;
  readonly letGo: () => void;
}

function holdTheLock(path: string, holdMilliseconds: number): Holder {
  const gate = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
  const worker = new Worker(HOLDER, { eval: true, workerData: { path, gate, holdMilliseconds } });
  let onHeld: () => void = () => undefined;
  let onReleased: () => void = () => undefined;
  const held = new Promise<void>((resolve) => (onHeld = resolve));
  const released = new Promise<void>((resolve, reject) => {
    onReleased = resolve;
    worker.once('error', reject);
  });
  worker.on('message', (message: string) => (message === 'held' ? onHeld() : onReleased()));
  return {
    held,
    released,
    letGo: () => {
      const view = new Int32Array(gate);
      Atomics.store(view, 0, 1);
      Atomics.notify(view, 0);
    },
  };
}

let directory: string | undefined;
afterEach(async () => {
  if (directory !== undefined) await rm(directory, { recursive: true, force: true });
  directory = undefined;
});

async function migrated(): Promise<string> {
  directory = await mkdtemp(join(tmpdir(), 'oyl-instance-busy-'));
  const path = join(directory, 'instance.sqlite');
  await (await openSqlStore(path)).close();
  return path;
}

const ATHLETE = {
  id: 'rider',
  displayName: 'Rider',
  createdAt: 1_790_000_000,
  registrationState: 'active',
} as const;

/**
 * Each case below took 0.7–2.0 s with ten busy loops on a two-CPU container
 * (Node 24.21, 2026-10-01) and about 0.1 s idle; there is no CI figure yet, so
 * the timeout is ten times the loaded one rather than three times a CI one.
 */
const LOADED = { timeout: 20_000 };

describe('a write while another connection holds the lock past the busy timeout (#985)', () => {
  it(
    'lands once the lock is let go, rather than failing with "database is locked"',
    LOADED,
    async () => {
      const path = await migrated();
      // A 50 ms busy timeout against a 200 ms hold: the first attempt cannot
      // get the lock, so only the retry lands the write. The pauses add up to
      // 3.7 s, so a loaded runner that is slow to wake the holder still lands.
      const store = await openSqlStore(path, {
        busyTimeoutMilliseconds: 50,
        busyRetryDelaysMilliseconds: [200, 500, 1_000, 2_000],
      });
      const holder = holdTheLock(path, 200);
      await holder.held;
      await store.putAthlete(ATHLETE);
      await holder.released;
      expect((await store.getAthlete('rider'))?.displayName).toBe('Rider');
      expect((await store.getAthlete('holder'))?.displayName).toBe('Holder');
      await store.close();
    },
  );

  it('a transaction lands too: its BEGIN IMMEDIATE is what is run again', LOADED, async () => {
    const path = await migrated();
    const store = await openSqlStore(path, {
      busyTimeoutMilliseconds: 50,
      busyRetryDelaysMilliseconds: [200, 500, 1_000, 2_000],
    });
    await store.putAthlete(ATHLETE);
    const holder = holdTheLock(path, 200);
    await holder.held;
    // putDeviceKey is a transaction (it reads the athlete, then writes).
    await store.putDeviceKey({
      publicKey: 'key-of-rider',
      athleteId: 'rider',
      addedAt: 1_790_000_000,
      revokedAt: null,
    });
    await holder.released;
    expect(await store.listDeviceKeys('rider')).toHaveLength(1);
    await store.close();
  });

  it(
    'fails, bounded, when the lock is never let go — and nothing was written',
    LOADED,
    async () => {
      const path = await migrated();
      const store = await openSqlStore(path, {
        busyTimeoutMilliseconds: 20,
        busyRetryDelaysMilliseconds: [10, 10],
      });
      const holder = holdTheLock(path, 30_000);
      await holder.held;
      await expect(store.putAthlete(ATHLETE)).rejects.toThrow(/database is locked/);
      holder.letGo();
      await holder.released;
      expect(await store.getAthlete('rider')).toBeUndefined();
      await store.close();
    },
  );
});
