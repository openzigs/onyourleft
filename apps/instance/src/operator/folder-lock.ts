// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * One backup run at a time in a backup folder (#2606, second review B1).
 *
 * Two runs into one folder — the `backup` service and a `backup` run by hand,
 * or two services after a misconfiguration — must never touch each other's
 * work: a run that cleaned up "partial" snapshots could delete the one the
 * other was still writing, which that run would then rename and record as a
 * complete snapshot. So a run holds a lock file in each folder it writes,
 * for the whole run, and cleans up only while it holds it.
 *
 * The lock is a file created with `O_EXCL` (`open(…, 'wx')`): one creation
 * wins on a local disk, on a network share and on Docker Desktop's bind mount
 * of a Windows drive alike, where `flock` is not reliable. It holds the
 * holder's process id, host name (a container's own), when it was taken and
 * a random token. A lock is STALE — left by a run that died — when:
 *
 * - it is this host's and this process id's, and this process does not hold
 *   it: the `backup` service restarted, and Node is process 1 again;
 * - it is this host's, and no process with its id is alive;
 * - it is older than {@link RUN_LIMIT_MS}, which no run lasts.
 *
 * A stale lock is moved aside and checked to be the one judged stale before
 * it is deleted, so two runs taking over the same stale lock cannot both win.
 */

import { randomBytes } from 'node:crypto';
import { open, readFile, rename, rm, stat } from 'node:fs/promises';
import { hostname } from 'node:os';
import { join } from 'node:path';

/** The lock file's name in a backup folder. */
export const LOCK_FILE = '.backup.lock';

/**
 * Longer than any backup run lasts: a lock, or a partial snapshot, older
 * than this was left by a run that died.
 */
export const RUN_LIMIT_MS = 6 * 60 * 60 * 1000;

/** What a run that finds its folder locked by a live run is refused with. Names no path. */
export class BackupFolderBusy extends Error {
  override readonly name = 'BackupFolderBusy';
}

export interface FolderLock {
  release(): Promise<void>;
}

interface Holder {
  readonly pid: number;
  readonly host: string;
  readonly startedAt: number;
  readonly token: string;
}

/** The lock paths this process holds now. */
const held = new Set<string>();

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: it exists, and belongs to somebody else.
    return (error as { code?: unknown }).code === 'EPERM';
  }
}

/** The holder a lock file names, or `undefined` when it names none (a run that died writing it). */
async function holderOf(path: string): Promise<Holder | undefined> {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as Partial<Holder>;
    if (
      typeof parsed.pid === 'number' &&
      typeof parsed.host === 'string' &&
      typeof parsed.startedAt === 'number' &&
      typeof parsed.token === 'string'
    ) {
      return parsed as Holder;
    }
  } catch {
    // Unreadable or half-written: judged by its age alone.
  }
  return undefined;
}

function isStale(path: string, holder: Holder | undefined, ageMs: number, now: number): boolean {
  if (ageMs > RUN_LIMIT_MS) return true;
  if (holder === undefined) return false;
  if (now - holder.startedAt > RUN_LIMIT_MS) return true;
  if (holder.host !== hostname()) return false;
  if (holder.pid === process.pid) return !held.has(path);
  return !isAlive(holder.pid);
}

/**
 * Takes `folder`'s lock, or throws {@link BackupFolderBusy} while a live run
 * holds it. The folder must exist.
 */
export async function lockFolder(
  folder: string,
  options: { readonly now?: () => number } = {},
): Promise<FolderLock> {
  const now = options.now ?? Date.now;
  const path = join(folder, LOCK_FILE);
  const mine: Holder = {
    pid: process.pid,
    host: hostname(),
    startedAt: now(),
    token: randomBytes(16).toString('hex'),
  };
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const file = await open(path, 'wx');
      try {
        await file.writeFile(JSON.stringify(mine));
      } finally {
        await file.close();
      }
      held.add(path);
      return {
        async release() {
          held.delete(path);
          // Only our own: never a lock another run took after ours was judged stale.
          if ((await holderOf(path))?.token === mine.token) await rm(path, { force: true });
        },
      };
    } catch (error) {
      if ((error as { code?: unknown }).code !== 'EEXIST') throw error;
    }
    let ageMs: number;
    try {
      ageMs = now() - (await stat(path)).mtimeMs;
    } catch {
      continue; // Released meanwhile: try again.
    }
    const holder = await holderOf(path);
    if (!isStale(path, holder, ageMs, now())) {
      throw new BackupFolderBusy(
        'Another backup run is writing to this folder. Nothing was taken.',
      );
    }
    const aside = `${path}.stale-${mine.token}`;
    try {
      await rename(path, aside);
    } catch {
      continue; // Another run took it over first.
    }
    const moved = await holderOf(aside);
    if (moved?.token !== holder?.token) {
      // Not the lock judged stale: a fresh one replaced it in between. Put it back.
      await rename(aside, path).catch(() => undefined);
      throw new BackupFolderBusy(
        'Another backup run is writing to this folder. Nothing was taken.',
      );
    }
    await rm(aside, { force: true });
  }
  throw new BackupFolderBusy('Another backup run is writing to this folder. Nothing was taken.');
}
