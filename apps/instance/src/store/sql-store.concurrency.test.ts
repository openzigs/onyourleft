// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **Two writers at once, and no `SQLITE_BUSY` reaches a caller** (#769).
 *
 * Two connections in two THREADS — `node:sqlite` is synchronous, so two
 * connections in one thread never actually contend — each writing athletes
 * and device keys to one file as fast as they can. With WAL, the busy timeout
 * and IMMEDIATE transactions (`node-sqlite.ts`), every write lands.
 *
 * The control runs the same two writers with the busy timeout at nought and
 * requires `SQLITE_BUSY` (in SQLite's words, "database is locked") to reach a
 * caller: without it this test would be green on a machine where the two
 * threads simply never overlapped.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { afterEach, describe, expect, it } from 'vitest';
import { openSqlStore } from './open-sql-store.ts';

const WRITES_PER_THREAD = 300;
const WORKER = new URL('./testing/concurrent-writer-testing.ts', import.meta.url);

let directory: string | undefined;
afterEach(async () => {
  if (directory !== undefined) await rm(directory, { recursive: true, force: true });
  directory = undefined;
});

function writer(path: string, prefix: string, busyTimeoutMilliseconds?: number): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(WORKER, {
      workerData: { path, prefix, count: WRITES_PER_THREAD, busyTimeoutMilliseconds },
    });
    worker.once('message', (errors: string[]) => resolve(errors));
    worker.once('error', reject);
    worker.once('exit', (code) => {
      if (code !== 0) reject(new Error(`The writer exited with ${code}.`));
    });
  });
}

async function migrated(): Promise<string> {
  directory = await mkdtemp(join(tmpdir(), 'oyl-instance-concurrency-'));
  const path = join(directory, 'instance.sqlite');
  await (await openSqlStore(path)).close();
  return path;
}

describe('two writers on one database (#769)', () => {
  it('both land every write, and no SQLITE_BUSY escapes', { timeout: 30_000 }, async () => {
    const path = await migrated();
    const errors = await Promise.all([writer(path, 'left'), writer(path, 'right')]);
    expect(errors.flat()).toEqual([]);
    const store = await openSqlStore(path);
    for (const prefix of ['left', 'right']) {
      for (const index of [0, WRITES_PER_THREAD - 1]) {
        expect(await store.listDeviceKeys(`${prefix}-${index}`)).toHaveLength(1);
      }
    }
    await store.close();
  });

  it(
    'is a test that can fail: with no busy timeout, SQLITE_BUSY does escape (the control)',
    { timeout: 30_000 },
    async () => {
      const path = await migrated();
      const errors = await Promise.all([writer(path, 'left', 0), writer(path, 'right', 0)]);
      expect(errors.flat().some((message) => /database is locked/.test(message))).toBe(true);
    },
  );
});
