// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * One side of a race between two CONNECTIONS, run in its own thread by
 * `sql-store.concurrency.test.ts` (#867, from #889's review). Plain Node loads
 * it (type stripping), not Vitest, so it imports only what Node can run.
 *
 * For each athlete in turn it meets the other thread at a barrier and then
 * either revokes one of the athlete's last two keys or renames them into the
 * last slot of the window — so the two threads' transactions start together,
 * on two connections to one file. It posts back every outcome and every error.
 *
 * `deferred` is the CONTROL: the same store over a connection whose
 * transactions begin DEFERRED, which is what `node-sqlite.ts` rewrites away.
 * It changes this file's connection only; nothing shipped reads it.
 * Test support, never shipped.
 */

import { DatabaseSync } from 'node:sqlite';
import { parentPort, workerData } from 'node:worker_threads';
import { Kysely, SqliteDialect } from 'kysely';
import { kyselyDatabase, openDatabase } from '../node-sqlite.ts';
import type { InstanceDatabase } from '../schema.ts';
import { createSqlStore } from '../sql-store.ts';

export interface RaceJob {
  readonly path: string;
  readonly side: 0 | 1;
  readonly count: number;
  readonly operation: 'revoke' | 'rename';
  readonly deferred: boolean;
  /** One slot per athlete: each side adds one, and both go once it reads two. */
  readonly gate: SharedArrayBuffer;
}

export interface RaceReport {
  readonly outcomes: string[];
  readonly errors: string[];
}

const job = workerData as RaceJob;
const gate = new Int32Array(job.gate);
const outcomes: string[] = [];
const errors: string[] = [];
const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

function meet(index: number): void {
  if (Atomics.add(gate, index, 1) === 1) Atomics.notify(gate, index);
  else Atomics.wait(gate, index, 1, 2_000);
}

function connection(): DatabaseSync {
  const database = openDatabase(job.path);
  if (!job.deferred) return database;
  // What `kyselyDatabase` prepares, with its IMMEDIATE put back to DEFERRED.
  return {
    close: () => database.close(),
    prepare: (sql: string) => database.prepare(sql === 'BEGIN IMMEDIATE' ? 'BEGIN DEFERRED' : sql),
  } as unknown as DatabaseSync;
}

async function run(): Promise<void> {
  const store = createSqlStore(
    new Kysely<InstanceDatabase>({
      dialect: new SqliteDialect({ database: kyselyDatabase(connection()) }),
    }),
  );
  for (let index = 0; index < job.count; index += 1) {
    const athleteId = `racer-${index}`;
    meet(index);
    try {
      outcomes.push(
        job.operation === 'revoke'
          ? await store.revokeDeviceKey(
              athleteId,
              `key-${job.side}-of-${athleteId}`,
              50,
              null,
              `key-${job.side}-of-${athleteId}`,
            )
          : await store.renameAthlete(athleteId, `Side ${job.side}`, 100, {
              count: 3,
              windowSeconds: 86_400,
            }),
      );
    } catch (error) {
      outcomes.push('error');
      errors.push(messageOf(error));
    }
  }
  await store.close();
}

await run().catch((error: unknown) => errors.push(messageOf(error)));
parentPort?.postMessage({ outcomes, errors } satisfies RaceReport);
