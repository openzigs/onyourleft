// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A backup folder's lease (#2606, third review), on the real SQLite store:
 * one holder at a time, in this process and across processes; a holder that
 * is alive keeps it however long it runs; one that died loses it five
 * minutes after its last heartbeat.
 */

import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { openDatabase } from '../store/node-sqlite.ts';
import { openServingStore } from '../store/serving.ts';
import type { SqlStore } from '../store/sql-store.ts';
import { MIGRATIONS } from '../store/migrations/index.ts';
import { migrateAllBut } from '../store/testing/index.ts';
import {
  BackupFolderBusy,
  BackupLeaseLost,
  HEARTBEAT_MS,
  LEASE_STALE_MS,
  placeOf,
  takeLease,
} from './backup-lease.ts';
import { runCommand } from './run.ts';

const INSTANCE = fileURLToPath(new URL('../..', import.meta.url));
const PROBE = fileURLToPath(new URL('./lease-probe-testing.ts', import.meta.url));
const FOLDER = '/probe/backups';

let directory: string | undefined;
const stores: SqlStore[] = [];
afterEach(async () => {
  vi.useRealTimers();
  for (const store of stores.splice(0)) await store.close();
  if (directory !== undefined) await rm(directory, { recursive: true, force: true });
  directory = undefined;
});

async function migrated(): Promise<string> {
  directory = await mkdtemp(join(tmpdir(), 'oyl-backup-lease-'));
  const database = join(directory, 'instance.sqlite');
  const quiet = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  try {
    expect(await runCommand(['migrate'], { database, blobs: join(directory, 'blobs') })).toBe(0);
  } finally {
    quiet.mockRestore();
  }
  return database;
}

/** A store on its own connection, closed after the case: another run's. */
function connection(database: string): SqlStore {
  const store = openServingStore(database);
  stores.push(store);
  return store;
}

/** A lease row written straight into the database: a run in another container. */
function leaseHeldBy(database: string, token: string, heartbeatAt: number): void {
  const opened = openDatabase(database);
  try {
    opened
      .prepare('INSERT INTO backup_lease VALUES (?, ?, ?, ?)')
      .run(placeOf(FOLDER), token, 'elsewhere:1', heartbeatAt);
  } finally {
    opened.close();
  }
}

function tokenHolding(database: string): unknown {
  const opened = openDatabase(database);
  try {
    return (
      opened.prepare('SELECT token FROM backup_lease WHERE place = ?').get(placeOf(FOLDER)) as
        { token: string } | undefined
    )?.token;
  } finally {
    opened.close();
  }
}

const T = 1_790_000_000_000;

describe('a backup folder’s lease (#2606)', () => {
  it('is one run’s at a time, and free once released', async () => {
    const database = await migrated();
    const first = await takeLease(connection(database), FOLDER, { now: () => T });
    await expect(takeLease(connection(database), FOLDER, { now: () => T })).rejects.toBeInstanceOf(
      BackupFolderBusy,
    );
    await first?.release();
    const second = await takeLease(connection(database), FOLDER, { now: () => T });
    expect(second).toBeDefined();
    await second?.release();
    expect(tokenHolding(database)).toBeUndefined();
  });

  it('gives a dead holder’s lease, interleaved, to the first of two takers and not the second', async () => {
    const database = await migrated();
    // A run that died: its last heartbeat just over five minutes ago.
    leaseHeldBy(database, 'dead', T - LEASE_STALE_MS - 1);
    // Both takers judge it at the same instant; the first takes it over, and
    // the second finds a fresh heartbeat that is not the one it judged.
    const a = await takeLease(connection(database), FOLDER, { now: () => T });
    await expect(takeLease(connection(database), FOLDER, { now: () => T })).rejects.toBeInstanceOf(
      BackupFolderBusy,
    );
    expect(tokenHolding(database)).not.toBe('dead');
    await a?.release();
  });

  it('leaves a holder that beats its heartbeat alone, however long it runs; takes it five minutes after the beats stop', async () => {
    const database = await migrated();
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    let now = T;
    const holder = await takeLease(connection(database), FOLDER, { now: () => now });
    // An hour of a hung off-box copy: the process is alive, and beats.
    for (let i = 0; i < 120; i += 1) {
      now += HEARTBEAT_MS;
      await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);
    }
    await expect(
      takeLease(connection(database), FOLDER, { now: () => now }),
    ).rejects.toBeInstanceOf(BackupFolderBusy);
    await holder?.confirm();
    // It dies: the timer stops, and nothing else releases its row.
    vi.clearAllTimers();
    now += LEASE_STALE_MS - 1;
    await expect(
      takeLease(connection(database), FOLDER, { now: () => now }),
    ).rejects.toBeInstanceOf(BackupFolderBusy);
    now += 2;
    const taker = await takeLease(connection(database), FOLDER, { now: () => now });
    expect(taker).toBeDefined();
    // The dead holder, were it to wake, finds the lease gone and stops.
    await expect(holder?.confirm()).rejects.toBeInstanceOf(BackupLeaseLost);
    // And its release leaves the new holder's lease alone.
    await holder?.release();
    expect(tokenHolding(database)).toBeDefined();
    await taker?.release();
  });

  it('is not lost to a heartbeat that could not be written: the next beat tries again, and confirm reads the row (#2627)', async () => {
    const database = await migrated();
    let now = T;
    const holder = await takeLease(connection(database), FOLDER, { now: () => now });
    const opened = openDatabase(database);
    try {
      opened.exec(`create trigger backup_lease_refuses_test before update on backup_lease
        begin select raise(abort, 'the heartbeat was refused'); end`);
      now += HEARTBEAT_MS;
      await holder?.beat();
      // Nobody took the row, so the run still holds its folder.
      await holder?.confirm();
      opened.exec('drop trigger backup_lease_refuses_test');
      now += HEARTBEAT_MS;
      await holder?.beat();
      expect(
        opened
          .prepare('SELECT heartbeat_at FROM backup_lease WHERE place = ?')
          .get(placeOf(FOLDER)),
      ).toEqual({ heartbeat_at: T + 2 * HEARTBEAT_MS });
      await holder?.confirm();
    } finally {
      opened.close();
    }
    await holder?.release();
    expect(tokenHolding(database)).toBeUndefined();
  });

  it('is lost once its row is another run’s, and says so before anything is recorded', async () => {
    const database = await migrated();
    const holder = await takeLease(connection(database), FOLDER, { now: () => T });
    const opened = openDatabase(database);
    try {
      opened
        .prepare('UPDATE backup_lease SET token = ?, holder = ? WHERE place = ?')
        .run('another', 'elsewhere:1', placeOf(FOLDER));
    } finally {
      opened.close();
    }
    await expect(holder?.confirm()).rejects.toBeInstanceOf(BackupLeaseLost);
    await holder?.release();
    expect(tokenHolding(database)).toBe('another');
  });

  it('counts a lease it cannot read back as lost, not held (#2627)', async () => {
    const database = await migrated();
    const holder = await takeLease(connection(database), FOLDER, { now: () => T });
    const opened = openDatabase(database);
    try {
      // Another connection takes the table away: the read in `confirm` fails.
      opened.exec('DROP TABLE backup_lease');
    } finally {
      opened.close();
    }
    await expect(holder?.confirm()).rejects.toBeInstanceOf(BackupLeaseLost);
    await holder?.release();
  });

  it('is one lease for a folder and a symlink to it, and keyed by the resolved path before the folder exists (#2627)', async () => {
    const database = await migrated();
    const real = join(directory ?? '', 'real-backups');
    const link = join(directory ?? '', 'linked-backups');
    // Not made yet: keyed by the path as given, resolved.
    expect(placeOf(join(directory ?? '', 'x', '..', 'real-backups'))).toBe(placeOf(real));
    await mkdir(real);
    await symlink(real, link);
    expect(placeOf(link)).toBe(placeOf(real));
    const held = await takeLease(connection(database), real, { now: () => T });
    await expect(takeLease(connection(database), link, { now: () => T })).rejects.toBeInstanceOf(
      BackupFolderBusy,
    );
    await held?.release();
  });

  it('is no lease at all on a database from before migration 0042', async () => {
    directory = await mkdtemp(join(tmpdir(), 'oyl-backup-lease-'));
    const database = join(directory, 'instance.sqlite');
    const names = Object.keys(MIGRATIONS);
    await migrateAllBut(database, names.length - names.indexOf('0042-backup-records'));
    expect(await takeLease(connection(database), FOLDER)).toBeUndefined();
  });
});

/**
 * `count` processes ask for the lease at the same instant: each opens the
 * store and says `ready`, and only then is the go file written.
 */
async function race(database: string, count: number): Promise<string[]> {
  const go = join(directory ?? '', 'go');
  const children = Array.from({ length: count }, (_, index) =>
    spawn(process.execPath, [PROBE, database, go, `taker-${String(index)}`], { cwd: INSTANCE }),
  );
  try {
    const answers = children.map(
      (child) =>
        new Promise<string[]>((resolve) => {
          let output = '';
          child.stdout.on('data', (chunk: Buffer) => {
            output += chunk.toString();
          });
          // 'close', not 'exit': stdout may still be draining at exit (fourth review).
          child.on('close', () => resolve(output.trim().split('\n')));
        }),
    );
    const ready = children.map(
      (child) =>
        new Promise<void>((resolve) => {
          const onData = (chunk: Buffer) => {
            if (chunk.toString().includes('ready')) {
              child.stdout.off('data', onData);
              resolve();
            }
          };
          child.stdout.on('data', onData);
          child.on('exit', () => resolve());
        }),
    );
    await Promise.all(ready);
    await writeFile(go, 'go');
    return (await Promise.all(answers)).map((lines) => lines.at(-1) ?? '');
  } finally {
    for (const child of children) child.kill('SIGKILL');
  }
}

describe('a backup folder’s lease across processes (#2606, third review F1)', () => {
  it('goes to exactly one of four processes asking at the same instant for a free folder', async () => {
    const database = await migrated();
    expect((await race(database, 4)).sort()).toEqual(['busy', 'busy', 'busy', 'taken']);
  });

  it('goes to exactly one of four processes taking over a dead holder’s lease at once', async () => {
    const database = await migrated();
    leaseHeldBy(database, 'dead', Date.now() - LEASE_STALE_MS - 60_000);
    expect((await race(database, 4)).sort()).toEqual(['busy', 'busy', 'busy', 'taken']);
    expect(tokenHolding(database)).toMatch(/^taker-[0-3]$/);
  });
});
