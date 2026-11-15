// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * One taker of a backup folder's lease, in a process of its own, for
 * `backup-lease.test.ts`'s cross-process probe (#2606, third review):
 *
 *   node src/operator/lease-probe-testing.ts <database> <go-file> <token>
 *
 * It opens the store, prints `ready`, waits for the go file — so every taker
 * asks at the same instant — asks once, prints `taken` or `busy`, and exits
 * holding what it took (it never releases: a run that died).
 */

import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';

import { resolveExtensionless } from '../node-imports.ts';

registerHooks({ resolve: resolveExtensionless });

const [database = '', go = '', token = ''] = process.argv.slice(2);
const { openServingStore } = await import('../store/serving.ts');
const { placeOf, LEASE_STALE_MS } = await import('./backup-lease.ts');

const store = openServingStore(database);
process.stdout.write('ready\n');
while (!existsSync(go)) await new Promise((resolve) => setTimeout(resolve, 1));
const now = Date.now();
const taken = await store.takeBackupLease({
  place: placeOf('/probe/backups'),
  token,
  holder: `probe:${String(process.pid)}`,
  now,
  staleBefore: now - LEASE_STALE_MS,
});
process.stdout.write(`${taken}\n`);
await store.close();
