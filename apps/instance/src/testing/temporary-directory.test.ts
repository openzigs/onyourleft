// SPDX-License-Identifier: AGPL-3.0-or-later

import { existsSync, mkdtempSync, readdirSync, rmSync, statfsSync, writeFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { startIdentityInstance } from '../auth/identity-testing.ts';
import {
  allowsExecution,
  MINIMUM_FREE_BYTES,
  RAM_ROOT,
  TMPFS_MAGIC,
  ramTemporaryRoot,
  useTemporaryDirectoryIn,
} from './temporary-directory.ts';

const tmpfs = (bytesFree: number) => () => ({ type: TMPFS_MAGIC, bavail: bytesFree, bsize: 1 });
const runs = () => true;

describe('the tests’ temporary directory (#2398)', () => {
  it('is in memory for this file, where the machine has a tmpfs with room, and a store opened by a test lands there', async () => {
    const root = ramTemporaryRoot();
    // A GitHub-hosted Linux runner has a `/dev/shm` that qualifies, and the
    // timeouts were there: if it stopped qualifying, this fix would be off
    // with every test still green, so there it is a red instead.
    if (process.env.GITHUB_ACTIONS === 'true' && process.platform === 'linux') {
      expect(root, 'the runner’s /dev/shm no longer qualifies (#2398)').toBe(RAM_ROOT);
    }
    if (root === undefined) {
      // macOS, or a `/dev/shm` short of room or mounted `noexec`: the disk, as before.
      expect(tmpdir().startsWith(RAM_ROOT)).toBe(false);
      return;
    }
    // Read back through what a test calls: `os.tmpdir()`, then a world's own
    // `mkdtemp` under it, which is where its SQLite file is.
    expect(tmpdir().startsWith(join(RAM_ROOT, 'oyl-instance-test-'))).toBe(true);
    const world = await startIdentityInstance();
    try {
      expect(world.path.startsWith(tmpdir())).toBe(true);
      expect(statfsSync(world.path).type).toBe(TMPFS_MAGIC);
    } finally {
      await world.close();
    }
    const own = await mkdtemp(join(tmpdir(), 'probe-'));
    expect(statfsSync(own).type).toBe(TMPFS_MAGIC);
  });

  it('is a tmpfs root only: not a disk, not a missing directory, not a tmpfs short of room or mounted noexec', () => {
    expect(ramTemporaryRoot('/r', tmpfs(MINIMUM_FREE_BYTES), runs)).toBe('/r');
    expect(ramTemporaryRoot('/r', tmpfs(MINIMUM_FREE_BYTES - 1), runs)).toBeUndefined();
    expect(ramTemporaryRoot('/r', tmpfs(MINIMUM_FREE_BYTES), () => false)).toBeUndefined();
    expect(
      ramTemporaryRoot('/r', () => ({ type: 0xef53, bavail: MINIMUM_FREE_BYTES, bsize: 1 }), runs),
    ).toBeUndefined();
    expect(
      ramTemporaryRoot(
        '/r',
        () => {
          throw Object.assign(new Error('no such directory'), { code: 'ENOENT' });
        },
        runs,
      ),
    ).toBeUndefined();
    expect(ramTemporaryRoot(join(tmpdir(), 'not-there'))).toBeUndefined();
  });

  it('points TMPDIR at a fresh directory under the root, and undoing it restores TMPDIR and removes what was written', () => {
    const root = mkdtempSync(join(tmpdir(), 'root-'));
    const before = process.env.TMPDIR;
    try {
      for (const previous of ['/somewhere/else', undefined]) {
        if (previous === undefined) delete process.env.TMPDIR;
        else process.env.TMPDIR = previous;
        const undo = useTemporaryDirectoryIn(root);
        const directory = tmpdir();
        expect(directory.startsWith(join(root, 'oyl-instance-test-'))).toBe(true);
        writeFileSync(join(directory, 'instance.sqlite'), 'rows');
        undo();
        expect(process.env.TMPDIR).toBe(previous);
        expect(existsSync(directory)).toBe(false);
      }
    } finally {
      if (before === undefined) delete process.env.TMPDIR;
      else process.env.TMPDIR = before;
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('says a directory allows execution only where a file written there passes access(X_OK), and leaves nothing behind', () => {
    const root = mkdtempSync(join(tmpdir(), 'exec-'));
    try {
      expect(allowsExecution(root)).toBe(true);
      expect(readdirSync(root)).toEqual([]);
      expect(allowsExecution(join(root, 'not-there'))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('changes nothing with no root', () => {
    const before = process.env.TMPDIR;
    useTemporaryDirectoryIn(undefined)();
    expect(process.env.TMPDIR).toBe(before);
  });
});
