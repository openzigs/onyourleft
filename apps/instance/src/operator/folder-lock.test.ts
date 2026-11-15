// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The backup folder's lock (#2606, second review B1), on a real directory:
 * one holder at a time, and a lock left by a run that died taken over.
 */

import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { BackupFolderBusy, LOCK_FILE, lockFolder, RUN_LIMIT_MS } from './folder-lock.ts';

let directory: string | undefined;
afterEach(async () => {
  if (directory !== undefined) await rm(directory, { recursive: true, force: true });
  directory = undefined;
});

async function folder(): Promise<string> {
  directory = await mkdtemp(join(tmpdir(), 'oyl-folder-lock-'));
  return directory;
}

const holder = (fields: { pid: number; host?: string; startedAt?: number }) =>
  JSON.stringify({
    pid: fields.pid,
    host: fields.host ?? hostname(),
    startedAt: fields.startedAt ?? Date.now(),
    token: 'someone-else',
  });

describe('a backup folder’s lock (#2606)', () => {
  it('is held by one run at a time, and free again once released', async () => {
    const place = await folder();
    const first = await lockFolder(place);
    await expect(lockFolder(place)).rejects.toBeInstanceOf(BackupFolderBusy);
    await first.release();
    expect(await readdir(place)).toEqual([]);
    const second = await lockFolder(place);
    await second.release();
  });

  it('refuses while a live process on this host holds it', async () => {
    const place = await folder();
    // The test runner's parent: alive, and not this process.
    await writeFile(join(place, LOCK_FILE), holder({ pid: process.ppid }));
    await expect(lockFolder(place)).rejects.toBeInstanceOf(BackupFolderBusy);
  });

  it('refuses a lock another host holds, however its process looks from here', async () => {
    const place = await folder();
    await writeFile(join(place, LOCK_FILE), holder({ pid: 999_999, host: 'another-container' }));
    await expect(lockFolder(place)).rejects.toBeInstanceOf(BackupFolderBusy);
  });

  it.each([
    [
      'this process id, which this process does not hold: a restart',
      () => holder({ pid: process.pid }),
    ],
    ['a process id on this host that is not alive', () => holder({ pid: 2 ** 22 + 12_345 })],
    [
      'any holder older than a run lasts',
      () =>
        holder({
          pid: process.ppid,
          host: 'another-container',
          startedAt: Date.now() - RUN_LIMIT_MS - 1,
        }),
    ],
  ])('takes over a lock left by %s', async (_case, written) => {
    const place = await folder();
    await writeFile(join(place, LOCK_FILE), written());
    const lock = await lockFolder(place);
    await lock.release();
    expect(await readdir(place)).toEqual([]);
  });

  it('leaves a lock alone on release that is not its own', async () => {
    const place = await folder();
    const lock = await lockFolder(place);
    await writeFile(join(place, LOCK_FILE), holder({ pid: process.ppid }));
    await lock.release();
    expect(await readdir(place)).toEqual([LOCK_FILE]);
  });
});
