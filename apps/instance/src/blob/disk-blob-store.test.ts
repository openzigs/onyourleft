// SPDX-License-Identifier: AGPL-3.0-or-later

import { spawnSync } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { InvalidBlobKeyError, sha256Hex } from './blob-store.ts';
import { describeBlobStoreConformance } from './conformance-testing.ts';
import { createDiskBlobStore } from './disk-blob-store.ts';
import { crashBlob } from './testing/crash-blob-testing.ts';

describeBlobStoreConformance('on local disk', async () => {
  const root = await mkdtemp(join(tmpdir(), 'oyl-instance-blobs-'));
  return {
    open: () => Promise.resolve(createDiskBlobStore(root)),
    dispose: () => rm(root, { recursive: true, force: true }),
  };
});

describe('the disk blob store (#770)', () => {
  let directory: string | undefined;
  afterEach(async () => {
    if (directory !== undefined) await rm(directory, { recursive: true, force: true });
    directory = undefined;
  });

  async function scratch(): Promise<string> {
    directory = await mkdtemp(join(tmpdir(), 'oyl-instance-blobs-'));
    return directory;
  }

  it('leaves no blob under its final name when the writer is killed mid-write', async () => {
    const root = join(await scratch(), 'blobs');
    const blob = crashBlob();
    const key = await sha256Hex(blob);
    const killAfter = 8 * 1024;

    const child = spawnSync(
      process.execPath,
      [
        fileURLToPath(new URL('./testing/crash-writer-testing.ts', import.meta.url)),
        root,
        `${killAfter}`,
      ],
      { encoding: 'utf8' },
    );
    expect(child.signal, child.stderr).toBe('SIGKILL');

    // The control: the write had started, and stopped part-way.
    const orphans = await readdir(join(root, 'incoming'));
    expect(orphans).toHaveLength(1);
    const partial = (await stat(join(root, 'incoming', orphans[0]!))).size;
    expect(partial).toBeGreaterThanOrEqual(killAfter);
    expect(partial).toBeLessThan(blob.length);

    const reader = createDiskBlobStore(root);
    expect(await reader.has(key)).toBe(false);
    expect(await reader.get(key)).toBeUndefined();

    // And the orphan does not stand in the way of the next write.
    expect(await reader.put(blob)).toBe(key);
    expect(await createDiskBlobStore(root).get(key)).toEqual(blob);
  });

  it('refuses ../ and an absolute path before the filesystem: the file named stays', async () => {
    const outside = await scratch();
    const root = join(outside, 'blobs');
    const victim = join(outside, 'victim');
    await writeFile(victim, 'still here');
    const store = createDiskBlobStore(root);
    for (const key of ['../victim', '../../victim', victim]) {
      await expect(store.delete(key)).rejects.toBeInstanceOf(InvalidBlobKeyError);
      await expect(store.get(key)).rejects.toBeInstanceOf(InvalidBlobKeyError);
    }
    expect(await readFile(victim, 'utf8')).toBe('still here');
    await expect(stat(root)).rejects.toThrow();
  });

  it('removes its incoming file when a write fails, and stores nothing', async () => {
    const root = await scratch();
    const failing = createDiskBlobStore(root, {
      chunkBytes: 1024,
      afterChunk: () => {
        throw new Error('the disk is full');
      },
    });
    const blob = crashBlob();
    await expect(failing.put(blob)).rejects.toThrow('the disk is full');
    expect(await readdir(join(root, 'incoming'))).toEqual([]);
    expect(await createDiskBlobStore(root).has(await sha256Hex(blob))).toBe(false);
  });

  it('stores a blob under objects/<first byte>/<key>', async () => {
    const root = await scratch();
    const key = await createDiskBlobStore(root).put(new TextEncoder().encode('abc'));
    expect(await readFile(join(root, 'objects', key.slice(0, 2), key), 'utf8')).toBe('abc');
  });
});
