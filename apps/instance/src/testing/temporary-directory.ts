// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Where the instance's tests put their files: in memory when the machine has
 * a RAM-backed directory to spare, on disk otherwise (#2398).
 *
 * ## Why
 *
 * Every instance test that opens a store writes a real SQLite file under
 * `os.tmpdir()`, in WAL mode at SQLite's default `synchronous = FULL`, so
 * every commit is an `fsync`. On a Linux runner an `fsync` reaches the disk,
 * and three Vitest workers making them at once wait on each other: the
 * instance project's cases went past their 5 s timeout on `main` and on pull
 * requests that did not touch it, all within one 40 s window of a run (run
 * 42551494214), while CPU time barely moved. Measured on #2398, the eight
 * files that timed out took 161.5 s of summed case time on a disk `/tmp` and
 * 39.0 s on `/dev/shm`, in the same Linux container on four CPUs; on macOS,
 * forcing every `fsync` to reach the drive (`PRAGMA fullfsync`) took them
 * from 6 s to 145 s of wall time with user CPU at 17.5 s against 21.8 s.
 *
 * ⚠️ **The store is not changed.** Its pragmas are the ones a running
 * instance has, and `node-sqlite.test.ts` reads them back; a test-only
 * `synchronous = OFF` would test a store nobody runs. An `fsync` on tmpfs
 * returns at once, which is the only thing that differs.
 *
 * ⚠️ **No timeout was raised**, which is the standing rule #2398 restates.
 *
 * ⚠️ **A root must also allow execution**: Docker mounts `/dev/shm` `noexec`,
 * and one test file runs scripts it writes there. On such a root, and on one
 * short of room, the tests stay on disk: slower, never wrong.
 *
 * The setup file beside this one runs it before every test file of the
 * `instance` project (its `vitest.config.ts`), and removes the directory
 * after the file: tmpfs is memory, so nothing a test leaves may outlive it.
 */

import {
  accessSync,
  constants,
  mkdtempSync,
  rmSync,
  statfsSync,
  writeFileSync,
  type StatsFs,
} from 'node:fs';
import { join } from 'node:path';

/** The RAM-backed directory every Linux has: POSIX shared memory's tmpfs. */
export const RAM_ROOT = '/dev/shm';

/** `statfs`'s `f_type` for tmpfs, from Linux's `magic.h`. */
export const TMPFS_MAGIC = 0x01021994;

/**
 * The free space below which the tests stay on disk: a container's `/dev/shm`
 * is 64 MiB unless it is given more, and a test that fills it fails with
 * `ENOSPC`, which is a worse red than a slow one.
 */
export const MINIMUM_FREE_BYTES = 1024 ** 3;

/**
 * Whether a file under `root` may be run. Linux refuses `access(X_OK)` on a
 * filesystem mounted `noexec`, as Docker mounts a container's `/dev/shm`, and
 * `home-deploy.test.ts` runs stand-in `docker` and `git` scripts it writes
 * under `os.tmpdir()`: on a `noexec` root they could not start.
 */
export function allowsExecution(root: string): boolean {
  let probe: string | undefined;
  try {
    probe = mkdtempSync(join(root, 'oyl-instance-probe-'));
    const file = join(probe, 'probe');
    writeFileSync(file, '', { mode: 0o700 });
    accessSync(file, constants.X_OK);
    return true;
  } catch {
    return false;
  } finally {
    if (probe !== undefined) rmSync(probe, { recursive: true, force: true });
  }
}

/**
 * `root` when it is a tmpfs with at least {@link MINIMUM_FREE_BYTES} free on
 * which a file may be run, otherwise `undefined` — on macOS, which has no
 * `/dev/shm`, always.
 */
export function ramTemporaryRoot(
  root: string = RAM_ROOT,
  statfs: (path: string) => Pick<StatsFs, 'type' | 'bavail' | 'bsize'> = statfsSync,
  executable: (path: string) => boolean = allowsExecution,
): string | undefined {
  let stats: Pick<StatsFs, 'type' | 'bavail' | 'bsize'>;
  try {
    stats = statfs(root);
  } catch {
    return undefined;
  }
  if (stats.type !== TMPFS_MAGIC) return undefined;
  if (stats.bavail * stats.bsize < MINIMUM_FREE_BYTES) return undefined;
  if (!executable(root)) return undefined;
  return root;
}

/**
 * Point `os.tmpdir()` at a fresh directory under `root`, which Node reads from
 * `TMPDIR` on every call, and return what undoes it: `TMPDIR` as it was, and
 * the directory removed with everything in it. With no `root`, nothing.
 */
export function useTemporaryDirectoryIn(root: string | undefined): () => void {
  if (root === undefined) return () => undefined;
  const before = process.env.TMPDIR;
  const directory = mkdtempSync(join(root, 'oyl-instance-test-'));
  process.env.TMPDIR = directory;
  return () => {
    if (before === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = before;
    rmSync(directory, { recursive: true, force: true });
  };
}
