// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The operator's commands (#791, #807, #52), run as an operator runs them —
 * `node src/operator/cli.ts …` in a child process — against a real database
 * and a real blob directory. A backup is TAKEN while the store is open and
 * writing, RESTORED into a second, empty place, and the restored data read
 * back through the store on a fresh connection: a known activity record,
 * every row count and every blob.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { createDiskBlobStore } from '../blob/disk-blob-store.ts';
import { openServingStore } from '../store/serving.ts';
import { ATHLETE_A, activityRecordFixture, seedWorld } from '../store/testing/index.ts';

const INSTANCE = fileURLToPath(new URL('../..', import.meta.url));
const CLI = fileURLToPath(new URL('./cli.ts', import.meta.url));

let directory: string | undefined;
afterEach(async () => {
  if (directory !== undefined) await rm(directory, { recursive: true, force: true });
  directory = undefined;
});

function run(data: { database: string; blobs: string }, ...args: string[]) {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd: INSTANCE,
    encoding: 'utf8',
    env: { ...process.env, OYL_INSTANCE_DATABASE: data.database, OYL_INSTANCE_BLOBS: data.blobs },
    timeout: 30_000,
  });
  const report =
    result.status === 0
      ? (JSON.parse(result.stdout.trim().split('\n').at(-1) ?? '{}') as Record<string, unknown>)
      : {};
  return { status: result.status, stderr: result.stderr, report };
}

async function populated() {
  directory = await mkdtemp(join(tmpdir(), 'oyl-instance-operator-'));
  const live = {
    database: join(directory, 'live', 'instance.sqlite'),
    blobs: join(directory, 'live', 'blobs'),
  };
  expect(run(live, 'migrate').status).toBe(0);
  const store = openServingStore(live.database);
  await seedWorld(store);
  const blobs = createDiskBlobStore(live.blobs);
  const keys = [
    await blobs.put(new TextEncoder().encode('a FIT file')),
    await blobs.put(new TextEncoder().encode('a second FIT file')),
  ];
  return { directory, live, store, keys };
}

/** A copy of a snapshot with one blob removed from it. */
async function withoutOneBlob(snapshot: string, copy: string): Promise<string> {
  await cp(snapshot, copy, { recursive: true });
  const blobs = (
    await readdir(join(copy, 'blobs', 'objects'), { recursive: true, withFileTypes: true })
  )
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name));
  await rm(blobs[0] ?? '');
  return copy;
}

describe('backup and a performed restore — #791 criterion 4, #52, #807', () => {
  it('takes an online snapshot while the store is open, restores it somewhere empty, and every row, blob and a known activity come back', async () => {
    const { directory: root, live, store, keys } = await populated();
    // The store is still open — and writes once more — while the backup runs.
    const backup = run(live, 'backup', join(root, 'backups'));
    await store.putActivityRecord(activityRecordFixture(ATHLETE_A, 'after-the-backup'));
    await store.close();
    expect(backup.status, backup.stderr).toBe(0);
    expect(backup.report).toMatchObject({ command: 'backup', blobs: 2 });

    const [snapshot] = await readdir(join(root, 'backups'));
    const second = {
      database: join(root, 'second-machine', 'instance.sqlite'),
      blobs: join(root, 'second-machine', 'blobs'),
    };
    const restored = run(second, 'restore', join(root, 'backups', snapshot ?? ''));
    expect(restored.status, restored.stderr).toBe(0);
    expect(restored.report).toMatchObject({ command: 'restore', integrity: true, blobs: 2 });
    expect(restored.report.rows).toEqual(backup.report.rows);
    expect(typeof restored.report.ms).toBe('number');

    // Read back through the store, on a fresh connection, as the instance would.
    const fresh = openServingStore(second.database);
    try {
      const known = activityRecordFixture(ATHLETE_A);
      const read = await fresh.getActivityRecord(ATHLETE_A, known.contentSha256);
      expect(read?.signedRecord).toEqual(known.signedRecord);
      // What was written after the snapshot is, rightly, not in it.
      const after = activityRecordFixture(ATHLETE_A, 'after-the-backup');
      expect(await fresh.getActivityRecord(ATHLETE_A, after.contentSha256)).toBeUndefined();
    } finally {
      await fresh.close();
    }
    const blobs = createDiskBlobStore(second.blobs);
    for (const key of keys) expect(await blobs.has(key)).toBe(true);
    expect(run(second, 'verify').report).toEqual({
      command: 'verify',
      integrity: true,
      rows: backup.report.rows,
      blobs: 2,
    });
  }, 30_000);

  it('refuses a restore over a database in place without --force, and a snapshot whose database was changed', async () => {
    const { directory: root, live, store } = await populated();
    await store.close();
    expect(run(live, 'backup', join(root, 'backups')).status).toBe(0);
    const [snapshot] = await readdir(join(root, 'backups'));
    const path = join(root, 'backups', snapshot ?? '');
    const over = run(live, 'restore', path);
    expect(over.status).toBe(1);
    expect(over.stderr).toContain('--force');
    expect(run(live, 'restore', path, '--force').status).toBe(0);

    // A snapshot that lost a blob on the way (a copy cut short) restores
    // nothing it can vouch for: its counts no longer match its manifest.
    const lost = run(
      { database: join(root, 'short', 'instance.sqlite'), blobs: join(root, 'short', 'blobs') },
      'restore',
      await withoutOneBlob(path, join(root, 'short-snapshot')),
    );
    expect(lost.status).toBe(1);
    expect(lost.stderr).toContain('does not match its snapshot');

    await writeFile(join(path, 'instance.sqlite'), 'not the database the manifest describes');
    const empty = {
      database: join(root, 'empty', 'instance.sqlite'),
      blobs: join(root, 'empty', 'blobs'),
    };
    const tampered = run(empty, 'restore', path);
    expect(tampered.status).toBe(1);
    expect(existsSync(empty.database)).toBe(false);
  }, 30_000);

  it('keeps the newest N snapshots, and copies each to a second place — the off-box copy', async () => {
    const { directory: root, live, store } = await populated();
    await store.close();
    for (let i = 0; i < 3; i += 1) {
      const taken = run(
        live,
        'backup',
        join(root, 'on-box'),
        '--keep',
        '2',
        '--copy-to',
        join(root, 'usb'),
      );
      expect(taken.status, taken.stderr).toBe(0);
      await new Promise((done) => setTimeout(done, 5));
    }
    expect(await readdir(join(root, 'on-box'))).toHaveLength(2);
    expect(await readdir(join(root, 'usb'))).toEqual(await readdir(join(root, 'on-box')));
  }, 30_000);
});

describe('room-open — a room until #784 and #785 let a rider make one', () => {
  it('opens a room the instance can serve, and refuses nonsense', async () => {
    directory = await mkdtemp(join(tmpdir(), 'oyl-instance-operator-'));
    const data = { database: join(directory, 'instance.sqlite'), blobs: join(directory, 'blobs') };
    expect(run(data, 'migrate').status).toBe(0);
    expect(
      run(data, 'room-open', 'tunnel-test', '--kind', 'ride', '--length', '20000').status,
    ).toBe(0);
    const store = openServingStore(data.database);
    try {
      expect(await store.getRoom('tunnel-test')).toMatchObject({ kind: 'group' });
      expect(await store.getRoomCourse('tunnel-test')).toMatchObject({ lengthMetres: 20_000 });
    } finally {
      await store.close();
    }
    expect(run(data, 'room-open', 'x', '--kind', 'party', '--length', '1').status).toBe(1);
    expect(run(data, 'room-open', 'x', '--kind', 'race', '--length', '-5').status).toBe(1);
    expect(run(data, 'sideways').status).toBe(2);
  }, 30_000);
});
