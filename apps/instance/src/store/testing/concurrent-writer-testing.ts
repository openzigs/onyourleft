// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * One writer, run in its own thread by `sql-store.concurrency.test.ts` (#769).
 * Plain Node loads it (type stripping), not Vitest, so it imports only what
 * Node can run as it is.
 *
 * It writes `count` athletes, each with a device key — the device key is a
 * read-then-write transaction, the case a DEFERRED `begin` fails in WAL — and
 * posts back every error message it met. Test support, never shipped.
 */

import { parentPort, workerData } from 'node:worker_threads';
import { openSqlStore } from '../open-sql-store.ts';

interface Job {
  readonly path: string;
  readonly prefix: string;
  readonly count: number;
  readonly busyTimeoutMilliseconds?: number;
  readonly busyRetryDelaysMilliseconds?: readonly number[];
}

const job = workerData as Job;
const errors: string[] = [];
const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

async function run(): Promise<void> {
  const store = await openSqlStore(job.path, {
    ...(job.busyTimeoutMilliseconds === undefined
      ? {}
      : { busyTimeoutMilliseconds: job.busyTimeoutMilliseconds }),
    ...(job.busyRetryDelaysMilliseconds === undefined
      ? {}
      : { busyRetryDelaysMilliseconds: job.busyRetryDelaysMilliseconds }),
  });
  for (let index = 0; index < job.count; index += 1) {
    const athleteId = `${job.prefix}-${index}`;
    try {
      await store.putAthlete({
        id: athleteId,
        displayName: athleteId,
        createdAt: 1_790_000_000,
        registrationState: 'active',
      });
      await store.putDeviceKey({
        publicKey: `key-of-${athleteId}`,
        athleteId,
        addedAt: 1_790_000_000,
        revokedAt: null,
      });
    } catch (error) {
      errors.push(messageOf(error));
    }
  }
  await store.close();
}

// Opening is a write too (the migrator's transaction), so its failure is reported, not thrown.
await run().catch((error: unknown) => errors.push(messageOf(error)));
parentPort?.postMessage(errors);
