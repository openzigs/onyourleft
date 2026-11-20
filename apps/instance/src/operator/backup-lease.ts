// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * One backup run at a time in a backup folder (#2606), held as a LEASE ROW in
 * the instance's own database (`backup_lease`, migration 0042).
 *
 * Two runs into one folder must never touch each other's work: a run that
 * cleaned up "partial" snapshots could delete the one the other was still
 * writing. Every run — `backup-loop`, a `backup` run by hand, `deploy.sh`'s
 * pre-deploy snapshot — already opens the instance's database, from whatever
 * container it runs in, and SQLite's write lock is the one atomic step they
 * all share. A lock FILE in the folder was not (the third review of #2625
 * found two holders at once): judging it stale and taking it over were two
 * steps, and a run that hung for hours lost it to an age rule.
 *
 * - **Taking it** is one `BEGIN IMMEDIATE` transaction
 *   (`SqlStore.takeBackupLease`): free, or held by a run whose heartbeat is
 *   older than {@link LEASE_STALE_MS}, taken over by a conditional update on
 *   that run's token — of two takers, one wins.
 * - **Holding it**: the holder writes its heartbeat every
 *   {@link HEARTBEAT_MS} for the whole run, the off-box copy included. A run
 *   that is hung but alive keeps beating, and keeps its lease; only a run
 *   that died stops, and its lease is free {@link LEASE_STALE_MS} later — the
 *   way out of a stuck lease, with no command to run.
 * - **Losing it**: {@link Lease.confirm} reads the lease's row before the run
 *   records or prunes anything, and the run stops unless the row is still
 *   its own (#2627). A heartbeat that could not be written is tried again at
 *   the next beat, and decides nothing by itself: a run whose row nobody took
 *   still holds its folder.
 * - **A database from before migration 0042** has no lease table: the run
 *   goes on with none, as runs did before.
 *
 * The folder is named in the row by the SHA-256 of its real path, never the
 * path (#2627: two paths to one folder, through a symlink, are one lease).
 */

import { createHash, randomBytes } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { hostname } from 'node:os';
import { resolve } from 'node:path';

import type { SqlStore } from '../store/sql-store.ts';

/** How often the holder shows it is alive. */
export const HEARTBEAT_MS = 30_000;

/** A lease whose heartbeat is older than this was left by a run that died. */
export const LEASE_STALE_MS = 5 * 60_000;

/** What a run that finds its folder held by a live run is refused with. Names no path. */
export class BackupFolderBusy extends Error {
  override readonly name = 'BackupFolderBusy';
}

/** What a run that lost its lease stops with, before it records or prunes. */
export class BackupLeaseLost extends Error {
  override readonly name = 'BackupLeaseLost';
}

export interface Lease {
  /** One heartbeat now: what the timer calls. One that cannot be written is tried again at the next. */
  beat(): Promise<void>;
  /** A heartbeat now, then throws {@link BackupLeaseLost} unless the lease's row is still this run's. */
  confirm(): Promise<void>;
  release(): Promise<void>;
}

/**
 * The lease row's key for `folder`: the SHA-256 of its real path, symlinks
 * followed (#2627), or of its resolved path while it cannot be read — a
 * folder not made yet.
 */
export function placeOf(folder: string): string {
  let path: string;
  try {
    path = realpathSync(folder);
  } catch {
    path = resolve(folder);
  }
  return createHash('sha256').update(path).digest('hex');
}

export interface LeaseOptions {
  /** Unix ms: a test's clock. */
  readonly now?: () => number;
  /** How often the timer beats; {@link HEARTBEAT_MS} unless a test says. */
  readonly everyMs?: number;
}

/**
 * Takes `folder`'s lease through `store`, or throws {@link BackupFolderBusy}
 * while a live run holds it. `undefined` on a database with no lease table.
 */
export async function takeLease(
  store: SqlStore,
  folder: string,
  options: LeaseOptions = {},
): Promise<Lease | undefined> {
  const now = options.now ?? Date.now;
  const place = placeOf(folder);
  const token = randomBytes(16).toString('hex');
  let taken: 'taken' | 'busy';
  try {
    const at = now();
    taken = await store.takeBackupLease({
      place,
      token,
      holder: `${hostname()}:${String(process.pid)}`,
      now: at,
      staleBefore: at - LEASE_STALE_MS,
    });
  } catch (error) {
    if (error instanceof Error && /no such table/.test(error.message)) return undefined;
    throw error;
  }
  if (taken === 'busy') {
    throw new BackupFolderBusy('Another backup run holds this folder. Nothing was taken.');
  }
  // A beat decides nothing (#2627): one that cannot be written is tried again
  // at the next, and `confirm` reads the row.
  const beat = async (): Promise<void> => {
    await store.heartbeatBackupLease(place, token, now()).catch(() => false);
  };
  const timer = setInterval(() => void beat(), options.everyMs ?? HEARTBEAT_MS);
  // A run that ends releases it; the timer never keeps the process alive.
  timer.unref();
  return {
    beat,
    async confirm() {
      await beat();
      const held = await store.holdsBackupLease(place, token).catch(() => false);
      if (!held) throw new BackupLeaseLost('This run no longer holds its backup folder.');
    },
    async release() {
      clearInterval(timer);
      await store.releaseBackupLease(place, token).catch(() => undefined);
    },
  };
}
