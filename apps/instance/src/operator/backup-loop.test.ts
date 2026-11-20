// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * `backup-loop` (#2606), the home deployment's `backup` service, driven with
 * a fake clock against the real SQLite store of a running instance: the owner
 * asks for a backup through the real route, the loop serves it, and what it
 * did is read back through `GET /v1/operate/backups` and the Status.
 *
 * The clock moves only when the loop waits, so every case is as many polls
 * as it says, and none sleeps.
 */

import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  startSoleModeratorWorld,
  type SoleModeratorWorld,
} from '../moderation/moderation-testing.ts';
import { openDatabase } from '../store/node-sqlite.ts';
import { openServingStore } from '../store/serving.ts';
import { BACKUP_RECORD_DAYS } from '../store/sql-store.ts';
import {
  backup,
  BACKUP_POLL_SECONDS,
  backupLoop,
  OFF_BOX_WATCHDOG,
  offBoxLimitMs,
  PARTIAL_AGE_MS,
  renameRetrying,
  UNRECORDED_ALLOWANCE,
  type DataPaths,
  type Manifest,
} from './commands.ts';

import { MIGRATIONS } from '../store/migrations/index.ts';
import { placeOf } from './backup-lease.ts';
import { createDiskBlobStore } from '../blob/disk-blob-store.ts';
import { migrateAllBut } from '../store/testing/index.ts';
import { runCommand } from './run.ts';

const BACKUPS = '/v1/operate/backups';
const INSTANCE = fileURLToPath(new URL('../..', import.meta.url));
const CLI = fileURLToPath(new URL('./cli.ts', import.meta.url));

interface BackupBody {
  readonly backups: readonly {
    readonly id: number;
    readonly at: string;
    readonly outcome: string;
    readonly error: string | null;
    readonly snapshot: string | null;
    readonly offBox: string | null;
    readonly freeBytes: { readonly backups: number | null; readonly offBox: number | null };
    readonly intervalSeconds: number | null;
    readonly requested: boolean;
  }[];
  readonly pending: { readonly requestedAt: string } | null;
}

let directory: string | undefined;
let world: SoleModeratorWorld | undefined;
beforeEach(() => {
  // A run's report goes to the test, and a failed run's line to stderr.
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await world?.close();
  world = undefined;
  if (directory !== undefined) await rm(directory, { recursive: true, force: true });
  directory = undefined;
});

async function started(): Promise<{
  world: SoleModeratorWorld;
  paths: DataPaths;
  backups: string;
}> {
  world = await startSoleModeratorWorld();
  directory = await mkdtemp(join(tmpdir(), 'oyl-backup-loop-'));
  return {
    world,
    paths: { database: world.path, blobs: `${world.path}.blobs` },
    backups: join(directory, 'backups'),
  };
}

const backupsOf = async (on: SoleModeratorWorld): Promise<BackupBody> => {
  const answer = await on.as(on.owner, 'GET', BACKUPS);
  expect(answer.status).toBe(200);
  return answer.body as BackupBody;
};

/**
 * Runs the loop on the world's clock. Each wait moves the clock by what the
 * loop asked for, then calls `step` with how many waits there have been;
 * `step` answering `true` stops the loop before its next poll.
 */
async function drive(
  on: SoleModeratorWorld,
  paths: DataPaths,
  backups: string,
  intervalSeconds: number,
  step: (waits: number) => Promise<boolean>,
) {
  const stop = new AbortController();
  const waited: number[] = [];
  const reports: unknown[] = [];
  const result = await backupLoop(paths, backups, {
    intervalSeconds,
    now: () => new Date(on.clock.ms),
    signal: stop.signal,
    wait: async (ms) => {
      waited.push(ms);
      on.clock.ms += ms;
      if (await step(waited.length)) stop.abort();
    },
    report: (line) => reports.push(line),
  });
  return { result, waited, reports };
}

/** A record of the backup service's, `secondsAgo` before the world's now: what a restart finds. */
async function earlierServiceRun(on: SoleModeratorWorld, secondsAgo: number, interval: number) {
  await on.freshRead((store) =>
    store.recordBackup({
      outcome: 'done',
      at: Math.floor(on.clock.ms / 1000) - secondsAgo,
      snapshot: 'snapshot-earlier',
      rows: 1,
      blobs: 0,
      databaseSha256: '0'.repeat(64),
      sizeBytes: 1,
      offBox: 'copied',
      removed: 0,
      backupsFreeBytes: null,
      offBoxFreeBytes: null,
      intervalSeconds: interval,
    }),
  );
}

describe('backup-loop: on the interval (#2606)', () => {
  it('with no request, runs at once with nothing recorded, then once each interval — never between', async () => {
    const { world: on, paths, backups } = await started();
    const counts: number[] = [];
    const { result, waited } = await drive(on, paths, backups, 120, async (waits) => {
      counts.push((await backupsOf(on)).backups.length);
      return waits === 5;
    });
    // Four polls 30 s apart reach the interval; the fifth poll ran.
    expect(waited).toEqual(Array.from({ length: 5 }, () => BACKUP_POLL_SECONDS * 1000));
    expect(counts).toEqual([1, 1, 1, 1, 2]);
    expect(result).toEqual({ command: 'backup-loop', runs: 2 });
    const made = (await backupsOf(on)).backups;
    expect(Date.parse(made[0]?.at ?? '') - Date.parse(made[1]?.at ?? '')).toBe(120_000);
    expect(made.every((record) => record.intervalSeconds === 120 && !record.requested)).toBe(true);
    expect(await readdir(backups)).toHaveLength(2);
  });

  it('after a restart, runs an interval after the service’s newest record, not at once', async () => {
    const { world: on, paths, backups } = await started();
    await earlierServiceRun(on, 60, 3600);
    const { result } = await drive(on, paths, backups, 3600, (waits) =>
      Promise.resolve(waits === 3),
    );
    expect(result.runs).toBe(0);
    expect((await backupsOf(on)).backups).toHaveLength(1);
  });
});

describe('backup-loop: “back up now” (#2606)', () => {
  it('serves a request made through the route within one poll, long before the interval — and marks it served by that record', async () => {
    const { world: on, paths, backups } = await started();
    // The service ran 20 minutes ago, every hour: the next is 40 minutes off.
    await earlierServiceRun(on, 20 * 60, 3600);
    let requestedAt = '';
    const { result } = await drive(on, paths, backups, 3600, async (waits) => {
      if (waits === 1) {
        const asked = await on.as(on.owner, 'POST', BACKUPS);
        expect(asked.status).toBe(202);
        requestedAt = (asked.body as { requestedAt: string }).requestedAt;
        expect((await backupsOf(on)).pending).toEqual({ requestedAt });
      }
      return waits === 3;
    });
    expect(result.runs).toBe(1);
    const body = await backupsOf(on);
    expect(body.pending).toBeNull();
    const [served, earlier] = body.backups;
    expect(earlier?.snapshot).toBe('snapshot-earlier');
    expect(served).toMatchObject({ outcome: 'done', requested: true, intervalSeconds: 3600 });
    const delay = Date.parse(served?.at ?? '') - Date.parse(requestedAt);
    expect(delay).toBeGreaterThanOrEqual(0);
    expect(delay).toBeLessThanOrEqual(BACKUP_POLL_SECONDS * 1000);
    // Read through the store on its own connection: exactly that record served it.
    const requested = await on.freshRead((store) => store.listBackupRecords(10));
    expect(requested.filter((record) => record.requested).map((record) => record.id)).toEqual([
      served?.id,
    ]);
    // And the Status shows it as the last backup.
    const status = await on.as(on.owner, 'GET', '/v1/operate/status');
    expect((status.body as { lastBackup: unknown }).lastBackup).toEqual({
      at: served?.at,
      offBox: 'not-configured',
      intervalSeconds: 3600,
    });
  });

  it('serves a request left waiting when the service stopped, once, after it starts again', async () => {
    const { world: on, paths, backups } = await started();
    await earlierServiceRun(on, 20 * 60, 3600);
    // The first service is stopped right after the owner asks: before it polls again.
    const first = await drive(on, paths, backups, 3600, async () => {
      expect((await on.as(on.owner, 'POST', BACKUPS)).status).toBe(202);
      return true;
    });
    expect(first.result.runs).toBe(0);
    expect((await backupsOf(on)).pending).not.toBeNull();

    const second = await drive(on, paths, backups, 3600, (waits) => Promise.resolve(waits === 4));
    expect(second.result.runs).toBe(1);
    const body = await backupsOf(on);
    expect(body.pending).toBeNull();
    expect(body.backups.map((record) => record.requested)).toEqual([true, false]);
  });

  it('records a run that fails by its error’s name, marks the request served by it, and keeps going', async () => {
    const { world: on, paths } = await started();
    await earlierServiceRun(on, 20 * 60, 3600);
    // Where the snapshots should go is a file: no directory can be made there.
    const blocked = join(directory ?? '', 'not-a-directory');
    await writeFile(blocked, 'a file');
    const { result, reports } = await drive(on, paths, blocked, 3600, async (waits) => {
      if (waits === 1) expect((await on.as(on.owner, 'POST', BACKUPS)).status).toBe(202);
      return waits === 4;
    });
    expect(result.runs).toBe(1);
    expect(reports).toEqual([
      { command: 'backup', failed: expect.stringMatching(/^E[A-Z]+$/) as unknown },
    ]);
    const body = await backupsOf(on);
    expect(body.pending).toBeNull();
    expect(body.backups[0]).toMatchObject({
      outcome: 'failed',
      error: expect.stringMatching(/^E[A-Z]+$/) as unknown,
      snapshot: null,
      requested: true,
    });
    // A message would name the folder; a name does not.
    expect(JSON.stringify(body)).not.toContain(directory ?? 'unreachable');
    // A failed run is not a last backup: the Status still shows the earlier one.
    const status = await on.as(on.owner, 'GET', '/v1/operate/status');
    expect((status.body as { lastBackup: { offBox: string } }).lastBackup.offBox).toBe('copied');
    // And, the request served, the owner may ask again.
    expect((await on.as(on.owner, 'POST', BACKUPS)).status).toBe(202);
  });
});

/** A migrated database of its own, in the test's directory, with nothing else in it. */
async function migratedAlone(): Promise<DataPaths & { readonly root: string }> {
  directory = await mkdtemp(join(tmpdir(), 'oyl-backup-loop-'));
  const paths = { database: join(directory, 'instance.sqlite'), blobs: join(directory, 'blobs') };
  const quiet = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  try {
    expect(await runCommand(['migrate'], paths)).toBe(0);
  } finally {
    quiet.mockRestore();
  }
  return { ...paths, root: directory };
}

/** The real database, made to refuse every backup record: the write a run ends with. */
function refuseEveryRecord(database: string): void {
  const opened = openDatabase(database);
  try {
    opened.exec(`create trigger backup_record_refuses_test before insert on backup_record
      begin select raise(abort, 'the record was refused'); end`);
  } finally {
    opened.close();
  }
}

/** Restore points already there: three older snapshots in each place. */
async function restorePoints(...places: string[]): Promise<readonly string[]> {
  const names = ['snapshot-2026-01-01', 'snapshot-2026-01-02', 'snapshot-2026-01-03'];
  for (const place of places) {
    for (const name of names) await mkdir(join(place, name), { recursive: true });
  }
  return names;
}

/** `polls` polls of the loop, 30 s of the clock apart, from 2026-09-01. */
async function pollFor(
  paths: DataPaths,
  destination: string,
  polls: number,
  options: { readonly intervalSeconds: number; readonly keep?: number; readonly copyTo?: string },
) {
  let now = Date.parse('2026-09-01T00:00:00Z');
  let waits = 0;
  const stop = new AbortController();
  const reports: unknown[] = [];
  const result = await backupLoop(paths, destination, {
    ...options,
    now: () => new Date(now),
    signal: stop.signal,
    wait: (ms) => {
      now += ms;
      waits += 1;
      if (waits === polls) stop.abort();
      return Promise.resolve();
    },
    report: (line) => reports.push(line),
  });
  return { result, reports };
}

describe('backup-loop: a failure never costs a restore point (#2606 review H1)', () => {
  it('takes one snapshot an interval, and removes nothing, while a request waits whose record cannot be written', async () => {
    const paths = await migratedAlone();
    const onBox = join(paths.root, 'on-box');
    const offBox = join(paths.root, 'off-box');
    const older = await restorePoints(onBox, offBox);
    const store = openServingStore(paths.database);
    try {
      expect((await store.requestBackup(1)).outcome).toBe('requested');
    } finally {
      await store.close();
    }
    refuseEveryRecord(paths.database);
    // Forty polls, twenty minutes, an interval of ten: two tries, not forty;
    // and the second, past `--keep` + the allowance, gives up its own snapshot.
    const { result } = await pollFor(paths, onBox, 40, {
      intervalSeconds: 600,
      keep: 2,
      copyTo: offBox,
    });
    expect(result.runs).toBe(2);
    for (const place of [onBox, offBox]) {
      const kept = await readdir(place);
      // Every restore point still there, and no more than the bound.
      expect(kept.filter((name) => older.includes(name))).toEqual(older);
      expect(kept.filter((name) => name.startsWith('snapshot-'))).toHaveLength(
        2 + UNRECORDED_ALLOWANCE,
      );
    }
  });

  it('tries a failed run once an interval when even its failure cannot be recorded, and leaves no partial snapshot', async () => {
    const paths = await migratedAlone();
    const onBox = join(paths.root, 'on-box');
    const older = await restorePoints(onBox);
    // The blobs cannot be read: every run fails after its snapshot was begun.
    await mkdir(paths.blobs, { recursive: true });
    await writeFile(join(paths.blobs, 'objects'), 'not a directory');
    const store = openServingStore(paths.database);
    try {
      expect((await store.requestBackup(1)).outcome).toBe('requested');
    } finally {
      await store.close();
    }
    refuseEveryRecord(paths.database);
    const { result, reports } = await pollFor(paths, onBox, 40, { intervalSeconds: 600, keep: 1 });
    expect(result.runs).toBe(2);
    expect(reports).toEqual([
      { command: 'backup', failed: expect.stringMatching(/^E[A-Z]+$/) as unknown },
      { command: 'backup', failed: expect.stringMatching(/^E[A-Z]+$/) as unknown },
    ]);
    // Only the restore points: no snapshot, and nothing partial for --keep to count.
    expect((await readdir(onBox)).sort()).toEqual(older);
  });

  it('removes a partial snapshot a stopped run left, here and off the box, and --keep does not count it', async () => {
    const paths = await migratedAlone();
    const onBox = join(paths.root, 'on-box');
    const offBox = join(paths.root, 'off-box');
    const longAgo = (Date.now() - PARTIAL_AGE_MS - 60_000) / 1000;
    for (const place of [onBox, offBox]) {
      const dead = join(place, '.partial-snapshot-2026-08-31T23-59-00-000Z');
      await mkdir(dead, { recursive: true });
      // Last changed longer ago than any run lasts: a run that died.
      await utimes(dead, longAgo, longAgo);
      await mkdir(join(place, 'snapshot-2026-08-01T00-00-00-000Z'), { recursive: true });
    }
    const quiet = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      const taken = await backup(paths, onBox, {
        keep: 2,
        copyTo: offBox,
        now: () => new Date('2026-09-01T00:00:00Z'),
      });
      expect(taken.removed).toBe(0);
    } finally {
      quiet.mockRestore();
    }
    for (const place of [onBox, offBox]) {
      expect((await readdir(place)).sort()).toEqual([
        'snapshot-2026-08-01T00-00-00-000Z',
        'snapshot-2026-09-01T00-00-00-000Z',
      ]);
    }
  });

  it('runs within an interval of starting even when its newest record is dated ahead of the clock', async () => {
    const paths = await migratedAlone();
    const store = openServingStore(paths.database);
    try {
      // Written by a clock running a day fast.
      await store.recordBackup({
        outcome: 'done',
        at: Date.parse('2026-09-02T00:00:00Z') / 1000,
        snapshot: 'snapshot-ahead',
        rows: 1,
        blobs: 0,
        databaseSha256: '0'.repeat(64),
        sizeBytes: 1,
        offBox: 'not-configured',
        removed: 0,
        backupsFreeBytes: null,
        offBoxFreeBytes: null,
        intervalSeconds: 120,
      });
    } finally {
      await store.close();
    }
    const { result } = await pollFor(paths, join(paths.root, 'on-box'), 5, {
      intervalSeconds: 120,
    });
    expect(result.runs).toBe(1);
  });
});

describe('backup: one run at a time in a folder (#2606, second review B1)', () => {
  it('records every snapshot two runs at once leave complete against its manifest, and refuses the second by name', async () => {
    const paths = await migratedAlone();
    const blobs = createDiskBlobStore(paths.blobs);
    // Fifty: enough to be caught mid-copy, few enough to be quick anywhere (third review F5).
    for (let i = 0; i < 50; i += 1) await blobs.put(new TextEncoder().encode(`blob ${String(i)}`));
    const onBox = join(paths.root, 'on-box');
    const quiet = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    let outcomes: PromiseSettledResult<unknown>[];
    try {
      // The second run starts once the first is writing its partial snapshot:
      // the moment a run that cleans up partials would delete it.
      let settled = false;
      const first = backup(paths, onBox, {
        keep: 5,
        now: () => new Date('2026-09-01T00:00:00Z'),
      }).finally(() => {
        settled = true;
      });
      const writing = async (): Promise<boolean> =>
        (await readdir(onBox).catch(() => [] as string[])).some((name) =>
          name.startsWith('.partial-snapshot-'),
        );
      while (!settled && !(await writing())) {
        await new Promise((resolve) => setImmediate(resolve));
      }
      const second = backup(paths, onBox, {
        keep: 5,
        now: () => new Date('2026-09-01T00:00:01Z'),
      });
      outcomes = await Promise.allSettled([first, second]);
    } finally {
      quiet.mockRestore();
    }
    // Every snapshot there is whole: its blob count is its manifest's.
    const names = (await readdir(onBox)).filter((name) => name.startsWith('snapshot-'));
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      const manifest = JSON.parse(
        await readFile(join(onBox, name, 'manifest.json'), 'utf8'),
      ) as Manifest;
      const held = await readdir(join(onBox, name, 'blobs', 'objects'), {
        recursive: true,
        withFileTypes: true,
      });
      expect(held.filter((entry) => entry.isFile())).toHaveLength(manifest.blobs);
    }
    const store = openServingStore(paths.database);
    try {
      const records = await store.listBackupRecords(10);
      // Every snapshot recorded done is one of those whole ones.
      for (const record of records.filter((each) => each.outcome === 'done')) {
        expect(names).toContain(record.snapshot);
      }
      expect(records.map((record) => record.error).sort()).toEqual(['BackupFolderBusy', null]);
    } finally {
      await store.close();
    }
    expect(outcomes.map((outcome) => outcome.status).sort()).toEqual(['fulfilled', 'rejected']);
  });

  it('removes no partial younger than any run lasts, even while holding the lock', async () => {
    const paths = await migratedAlone();
    const onBox = join(paths.root, 'on-box');
    const young = join(onBox, '.partial-snapshot-2026-08-31T23-59-00-000Z');
    await mkdir(young, { recursive: true });
    const quiet = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      await backup(paths, onBox, { keep: 2, now: () => new Date('2026-09-01T00:00:00Z') });
    } finally {
      quiet.mockRestore();
    }
    expect(await readdir(onBox)).toContain('.partial-snapshot-2026-08-31T23-59-00-000Z');
  });

  it('tries a rename again when Windows answers EPERM or EACCES for a moment, and not for anything else', async () => {
    const calls: string[] = [];
    let failures = ['EPERM', 'EACCES'];
    await renameRetrying('from', 'to', () => {
      const code = failures.shift();
      calls.push(code ?? 'ok');
      return code === undefined
        ? Promise.resolve()
        : Promise.reject(Object.assign(new Error('held'), { code }));
    });
    expect(calls).toEqual(['EPERM', 'EACCES', 'ok']);
    failures = ['ENOENT'];
    await expect(
      renameRetrying('from', 'to', () =>
        Promise.reject(Object.assign(new Error('gone'), { code: failures[0] })),
      ),
    ).rejects.toThrow('gone');
  });
});

/** A lease row written straight into the database: a live run in another container. */
function leaseHeldElsewhere(database: string, folder: string): void {
  const opened = openDatabase(database);
  try {
    opened
      .prepare('INSERT INTO backup_lease VALUES (?, ?, ?, ?)')
      .run(placeOf(folder), 'elsewhere', 'elsewhere:1', Date.now());
  } finally {
    opened.close();
  }
}

describe('backup: the folders’ leases (#2606, third review)', () => {
  it('neither writes nor prunes off the box while another live run holds that folder', async () => {
    const paths = await migratedAlone();
    const onBox = join(paths.root, 'on-box');
    const offBox = join(paths.root, 'off-box');
    const older = await restorePoints(offBox);
    leaseHeldElsewhere(paths.database, offBox);
    const quiet = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      const taken = await backup(paths, onBox, {
        keep: 1,
        copyTo: offBox,
        now: () => new Date('2026-09-01T00:00:00Z'),
      });
      expect(taken.offBox).toBe('failed');
      expect(taken.recorded).toBe(true);
    } finally {
      quiet.mockRestore();
    }
    expect((await readdir(offBox)).sort()).toEqual(older);
    expect(await readdir(onBox)).toEqual(['snapshot-2026-09-01T00-00-00-000Z']);
  });

  it('is refused by name, taking nothing, while another live run holds its folder', async () => {
    const paths = await migratedAlone();
    const onBox = join(paths.root, 'on-box');
    const older = await restorePoints(onBox);
    leaseHeldElsewhere(paths.database, onBox);
    await expect(backup(paths, onBox, { keep: 1 })).rejects.toThrow(/Another backup run/);
    expect((await readdir(onBox)).sort()).toEqual(older);
    const store = openServingStore(paths.database);
    try {
      expect((await store.listBackupRecords(1))[0]).toMatchObject({
        outcome: 'failed',
        error: 'BackupFolderBusy',
      });
    } finally {
      await store.close();
    }
  });

  it('stops before recording or pruning when its heartbeat cannot be written', async () => {
    const paths = await migratedAlone();
    const onBox = join(paths.root, 'on-box');
    const older = await restorePoints(onBox);
    const opened = openDatabase(paths.database);
    try {
      opened.exec(`create trigger backup_lease_refuses_test before update on backup_lease
        begin select raise(abort, 'the heartbeat was refused'); end`);
    } finally {
      opened.close();
    }
    await expect(
      backup(paths, onBox, { keep: 1, now: () => new Date('2026-09-01T00:00:00Z') }),
    ).rejects.toThrow(/no longer holds/);
    // Nothing pruned: every restore point is there.
    expect((await readdir(onBox)).filter((name) => older.includes(name))).toEqual(older);
    const store = openServingStore(paths.database);
    try {
      const [record] = await store.listBackupRecords(1);
      expect(record).toMatchObject({ outcome: 'failed', error: 'BackupLeaseLost' });
    } finally {
      await store.close();
    }
  });
});

describe('backup-loop: the hold-off reads the folder against every record (#2606, third review F6)', () => {
  it('does not hold off for the newest snapshot when a record names it, however many records came after', async () => {
    const paths = await migratedAlone();
    const onBox = join(paths.root, 'on-box');
    const quiet = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      // The newest snapshot on disk, recorded by a run by hand ten minutes ago.
      await backup(paths, onBox, { now: () => new Date('2026-08-31T23:50:00Z') });
    } finally {
      quiet.mockRestore();
    }
    const store = openServingStore(paths.database);
    try {
      // Sixty records after it, each of a snapshot in another folder.
      for (let i = 0; i < 60; i += 1) {
        await store.recordBackup({
          outcome: 'failed',
          at: Date.parse('2026-08-31T23:30:00Z') / 1000 + i,
          error: 'Error',
          intervalSeconds: null,
        });
      }
    } finally {
      await store.close();
    }
    // No service run is recorded, so one is due at once: the recorded
    // snapshot is no reason to wait.
    const { result } = await pollFor(paths, onBox, 10, { intervalSeconds: 3600 });
    expect(result.runs).toBe(1);
  });

  it('ignores a snapshot folder named after now, which a wrong clock left', async () => {
    const paths = await migratedAlone();
    const onBox = join(paths.root, 'on-box');
    await mkdir(join(onBox, 'snapshot-2027-01-01T00-00-00-000Z'), { recursive: true });
    const { result } = await pollFor(paths, onBox, 3, { intervalSeconds: 3600 });
    expect(result.runs).toBe(1);
  });
});

describe('backup: past the bound, the newest unrecorded snapshot is kept (#2606, third review F7)', () => {
  it('drops the oldest unrecorded snapshot newer than the recorded ones, never a recorded one', async () => {
    const paths = await migratedAlone();
    const onBox = join(paths.root, 'on-box');
    const quiet = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      // A recorded restore point first.
      await backup(paths, onBox, { keep: 1, now: () => new Date('2026-09-01T00:00:00Z') });
      // And one from before #2606, older than it, that no record names
      // (fourth review): F7 may never take it.
      await mkdir(join(onBox, 'snapshot-2026-08-31T00-00-00-000Z'), { recursive: true });
      refuseEveryRecord(paths.database);
      for (const hour of ['01', '02', '03', '04', '05']) {
        await backup(paths, onBox, {
          keep: 1,
          now: () => new Date(`2026-09-01T${hour}:00:00Z`),
        });
      }
    } finally {
      quiet.mockRestore();
    }
    // --keep 1 + 2 = 3: the older unrecorded one and the recorded one stay,
    // so only the newest of the failed runs' snapshots is left beside them.
    expect((await readdir(onBox)).sort()).toEqual([
      'snapshot-2026-08-31T00-00-00-000Z',
      'snapshot-2026-09-01T00-00-00-000Z',
      'snapshot-2026-09-01T05-00-00-000Z',
    ]);
  });
});

describe('backup: a snapshot carries no lease of the run that took it (#2606, fourth review)', () => {
  it("leaves no backup_lease row in the snapshot's database, so a restored one is not busy", async () => {
    const paths = await migratedAlone();
    const onBox = join(paths.root, 'on-box');
    const quiet = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      await backup(paths, onBox, { keep: 3, now: () => new Date('2026-09-01T00:00:00Z') });
    } finally {
      quiet.mockRestore();
    }
    const opened = openDatabase(
      join(onBox, 'snapshot-2026-09-01T00-00-00-000Z', 'instance.sqlite'),
    );
    try {
      expect(opened.prepare('SELECT count(*) AS n FROM backup_lease').get()).toEqual({ n: 0 });
    } finally {
      opened.close();
    }
  });
});

describe('backup-loop: restore points stay bounded while records fail (#2606, second review M1)', () => {
  it('in a crash loop of ten one-poll restarts with a request waiting, takes one snapshot and keeps every restore point', async () => {
    const paths = await migratedAlone();
    const onBox = join(paths.root, 'on-box');
    const offBox = join(paths.root, 'off-box');
    const older = await restorePoints(onBox, offBox);
    const store = openServingStore(paths.database);
    try {
      expect((await store.requestBackup(1)).outcome).toBe('requested');
    } finally {
      await store.close();
    }
    refuseEveryRecord(paths.database);
    let runs = 0;
    for (let restart = 0; restart < 10; restart += 1) {
      // Each life is one poll, a minute apart.
      const life = await pollFor(paths, onBox, 1, {
        intervalSeconds: 600,
        keep: 2,
        copyTo: offBox,
      });
      runs += life.result.runs;
    }
    expect(runs).toBe(1);
    for (const place of [onBox, offBox]) {
      const kept = (await readdir(place)).filter((name) => name.startsWith('snapshot-'));
      expect(kept.filter((name) => older.includes(name))).toEqual(older);
      expect(kept).toHaveLength(older.length + 1);
    }
  });

  it('over many intervals with records failing, never holds more than --keep + the allowance, and gives up none it had', async () => {
    const paths = await migratedAlone();
    const onBox = join(paths.root, 'on-box');
    const store = openServingStore(paths.database);
    try {
      expect((await store.requestBackup(1)).outcome).toBe('requested');
    } finally {
      await store.close();
    }
    refuseEveryRecord(paths.database);
    // Ten intervals of polls, from an empty folder.
    const { result } = await pollFor(paths, onBox, 200, { intervalSeconds: 600, keep: 2 });
    expect(result.runs).toBe(10);
    const kept = (await readdir(onBox)).filter((name) => name.startsWith('snapshot-')).sort();
    expect(kept).toHaveLength(2 + UNRECORDED_ALLOWANCE);
    // The first ones taken: none was removed to make room for a later one.
    expect(kept[0]).toBe('snapshot-2026-09-01T00-00-00-000Z');
  });

  it('after an upgrade, waits an interval after the newest snapshot the shell loop left, before any run', async () => {
    const paths = await migratedAlone();
    const onBox = join(paths.root, 'on-box');
    // The shell loop's last snapshot, five minutes before the service starts: no record names it.
    await mkdir(join(onBox, 'snapshot-2026-08-31T23-55-00-000Z'), { recursive: true });
    const store = openServingStore(paths.database);
    try {
      expect((await store.requestBackup(1)).outcome).toBe('requested');
    } finally {
      await store.close();
    }
    const { result } = await pollFor(paths, onBox, 20, { intervalSeconds: 3600 });
    expect(result.runs).toBe(0);
    const later = await pollFor(paths, onBox, 140, { intervalSeconds: 3600 });
    expect(later.result.runs).toBe(1);
  });
});

describe('backup on a database from before migration 0042 (#2606, second review M2)', () => {
  it('prunes to --keep as it always did: it has no record to wait for', async () => {
    directory = await mkdtemp(join(tmpdir(), 'oyl-backup-loop-'));
    const paths = { database: join(directory, 'instance.sqlite'), blobs: join(directory, 'blobs') };
    const names = Object.keys(MIGRATIONS);
    const first = names.indexOf('0042-backup-records');
    if (first < 0) throw new Error('no migration named 0042-backup-records in MIGRATIONS');
    await migrateAllBut(paths.database, names.length - first);
    const onBox = join(directory, 'on-box');
    const quiet = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      for (const second of ['00', '01', '02']) {
        const taken = await backup(paths, onBox, {
          keep: 1,
          now: () => new Date(`2026-09-01T00:00:${second}Z`),
        });
        expect(taken.recorded).toBe(false);
      }
    } finally {
      quiet.mockRestore();
    }
    expect(await readdir(onBox)).toEqual(['snapshot-2026-09-01T00-00-02-000Z']);
  });
});

describe('backup-loop: what it keeps (#2606, #1381)', () => {
  it('after forty days of runs, holds no record older than 30 days and every snapshot of the newest --keep, here and off the box', async () => {
    directory = await mkdtemp(join(tmpdir(), 'oyl-backup-loop-'));
    const paths = { database: join(directory, 'instance.sqlite'), blobs: join(directory, 'blobs') };
    const quiet = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      expect(await runCommand(['migrate'], paths)).toBe(0);
    } finally {
      quiet.mockRestore();
    }
    const DAY_MS = 86_400_000;
    let now = Date.parse('2026-09-01T00:00:00Z');
    const stop = new AbortController();
    const reports: { snapshot?: string }[] = [];
    // The clock jumps a run's interval at every wait: a run each poll.
    await backupLoop(paths, join(directory, 'on-box'), {
      intervalSeconds: 5 * 86_400,
      keep: 3,
      copyTo: join(directory, 'off-box'),
      now: () => new Date(now),
      signal: stop.signal,
      wait: () => {
        now += 5 * DAY_MS;
        if (reports.length === 9) stop.abort();
        return Promise.resolve();
      },
      report: (line) => reports.push(line as { snapshot?: string }),
    });
    expect(reports).toHaveLength(9);
    const store = openServingStore(paths.database);
    try {
      const records = await store.listBackupRecords(100);
      const newest = Math.max(...records.map((record) => record.at));
      for (const record of records) {
        expect(newest - record.at).toBeLessThanOrEqual(BACKUP_RECORD_DAYS * 86_400);
      }
      // The runs of the last 30 days, every one: day 10 to day 40.
      expect(records).toHaveLength(7);
      const newestThree = records.slice(0, 3).map((record) => record.snapshot);
      expect((await readdir(join(directory, 'on-box'))).sort()).toEqual([...newestThree].sort());
      expect((await readdir(join(directory, 'off-box'))).sort()).toEqual([...newestThree].sort());
    } finally {
      await store.close();
    }
  });

  it('prunes nothing off the box when the copy there failed, so a failing drive keeps what it had', async () => {
    directory = await mkdtemp(join(tmpdir(), 'oyl-backup-loop-'));
    const paths = { database: join(directory, 'instance.sqlite'), blobs: join(directory, 'blobs') };
    const quiet = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      expect(await runCommand(['migrate'], paths)).toBe(0);
    } finally {
      quiet.mockRestore();
    }
    const offBox = join(directory, 'off-box');
    const older = ['snapshot-2026-01-01', 'snapshot-2026-01-02', 'snapshot-2026-01-03'];
    for (const name of older) await mkdir(join(offBox, name), { recursive: true });
    // The copy's own place is taken by a file: this run's copy cannot be made.
    const at = new Date('2026-09-01T00:00:00Z');
    await writeFile(join(offBox, 'snapshot-2026-09-01T00-00-00-000Z'), 'in the way');
    const taken = await backup(paths, join(directory, 'on-box'), {
      keep: 1,
      copyTo: offBox,
      now: () => at,
    });
    expect(taken.offBox).toBe('failed');
    expect((await readdir(offBox)).filter((name) => older.includes(name))).toEqual(older);
    expect(await readdir(join(directory, 'on-box'))).toEqual(['snapshot-2026-09-01T00-00-00-000Z']);
  });

  it('refuses an interval that is not a whole number of seconds, and a --keep below one', async () => {
    const paths = { database: 'unused.sqlite', blobs: 'unused' };
    await expect(backupLoop(paths, 'x', { intervalSeconds: 0 })).rejects.toThrow(/--interval/);
    await expect(backupLoop(paths, 'x', { intervalSeconds: 1.5 })).rejects.toThrow(/--interval/);
    await expect(backupLoop(paths, 'x', { intervalSeconds: 60, keep: 0 })).rejects.toThrow(
      /--keep/,
    );
  });
});

describe('backup-loop on the command line (#2606)', () => {
  it('refuses a line with no --interval, or one that is not whole seconds, and stops at once when already stopped', async () => {
    directory = await mkdtemp(join(tmpdir(), 'oyl-backup-loop-'));
    const paths = { database: join(directory, 'instance.sqlite'), blobs: join(directory, 'blobs') };
    let printed = '';
    const out = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      printed += String(chunk);
      return true;
    });
    try {
      expect(await runCommand(['migrate'], paths)).toBe(0);
      expect(await runCommand(['backup-loop', join(directory, 'b')], paths)).toBe(1);
      expect(
        await runCommand(['backup-loop', join(directory, 'b'), '--interval', '6h'], paths),
      ).toBe(1);
      printed = '';
      expect(
        await runCommand(['backup-loop', join(directory, 'b'), '--interval', '60'], {
          ...paths,
          signal: AbortSignal.abort(),
        }),
      ).toBe(0);
      expect(JSON.parse(printed.trim())).toEqual({ command: 'backup-loop', runs: 0 });
    } finally {
      out.mockRestore();
    }
  });

  it('runs as the `backup` service runs it, and stops on SIGTERM with its report and exit 0', async () => {
    directory = await mkdtemp(join(tmpdir(), 'oyl-backup-loop-'));
    const paths = { database: join(directory, 'instance.sqlite'), blobs: join(directory, 'blobs') };
    const quiet = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      expect(await runCommand(['migrate'], paths)).toBe(0);
    } finally {
      quiet.mockRestore();
    }
    const child = spawn(
      process.execPath,
      [CLI, 'backup-loop', join(directory, 'backups'), '--interval', '21600', '--keep', '2'],
      {
        cwd: INSTANCE,
        env: {
          ...process.env,
          OYL_INSTANCE_DATABASE: paths.database,
          OYL_INSTANCE_BLOBS: paths.blobs,
        },
      },
    );
    try {
      let output = '';
      const exited = new Promise<number | null>((resolve) => child.on('exit', resolve));
      // The first run is at once, with nothing recorded: stop it once it has reported.
      await new Promise<void>((resolve) => {
        child.stdout.on('data', (chunk: Buffer) => {
          output += chunk.toString();
          if (output.includes('\n')) resolve();
        });
      });
      child.kill('SIGTERM');
      expect(await exited).toBe(0);
      const lines = output
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as unknown);
      expect(lines[0]).toMatchObject({ command: 'backup', recorded: true, logged: true });
      expect(lines.at(-1)).toEqual({ command: 'backup-loop', runs: 1 });
    } finally {
      child.kill('SIGKILL');
    }
  });
});

describe('backup: a hung off-box copy is stopped by its watchdog (#2626)', () => {
  /**
   * A copier that never finishes: what a share that stopped answering does to
   * a copy. It starts the copy it was given, and writes its pid beside it, so
   * the test can see it is gone once the run ends.
   */
  const HUNG = [
    process.execPath,
    '-e',
    "const fs = require('node:fs'); fs.mkdirSync(process.argv[2]); fs.writeFileSync(process.argv[2] + '.pid', String(process.pid)); setInterval(() => {}, 1 << 30);",
  ];
  /** A limit of 200 ms, whatever the snapshot's size: the watchdog's parameter, not a test timeout. */
  const QUICK = { floorMs: 200, bytesPerSecond: Number.MAX_SAFE_INTEGER, copier: HUNG };

  it('ends the run, records off-box failed, keeps the snapshot on the box and prunes nothing off it', async () => {
    const { world: on, paths, backups } = await started();
    const offBox = join(directory ?? '', 'off-box');
    const older = await restorePoints(offBox);
    const stop = new AbortController();
    const reports: unknown[] = [];
    const result = await backupLoop(paths, backups, {
      intervalSeconds: 3600,
      keep: 1,
      copyTo: offBox,
      offBoxWatchdog: QUICK,
      now: () => new Date(on.clock.ms),
      signal: stop.signal,
      wait: (ms) => {
        on.clock.ms += ms;
        stop.abort();
        return Promise.resolve();
      },
      report: (line) => reports.push(line),
    });
    expect(result.runs).toBe(1);
    expect(reports).toEqual([expect.objectContaining({ offBox: 'failed', recorded: true })]);
    // Read back as the owner reads it: the run is done, and its copy failed.
    const body = await backupsOf(on);
    expect(body.backups[0]).toMatchObject({ outcome: 'done', offBox: 'failed' });
    // The hung share is not asked for its free space: that read would hang too.
    expect(body.backups[0]?.freeBytes.offBox).toBeNull();
    expect(body.backups[0]?.freeBytes.backups).toEqual(expect.any(Number));
    const status = await on.as(on.owner, 'GET', '/v1/operate/status');
    expect((status.body as { lastBackup: { offBox: string } }).lastBackup.offBox).toBe('failed');
    // The snapshot on the box is whole: its manifest is there and names its database.
    const [snapshot] = await readdir(backups);
    expect(snapshot).toBe(body.backups[0]?.snapshot);
    const manifest = JSON.parse(
      await readFile(join(backups, snapshot ?? '', 'manifest.json'), 'utf8'),
    ) as Manifest;
    expect(manifest.databaseSha256).toMatch(/^[0-9a-f]{64}$/);
    // Off the box: every older restore point kept, no copy made, and the
    // partial copy left for a later run's cleanup, untouched.
    const there = await readdir(offBox);
    expect(there.filter((name) => name.startsWith('snapshot-')).sort()).toEqual(older);
    expect(there).toContain(`.partial-${snapshot ?? ''}`);
    const pidFile = there.find((name) => name.endsWith('.pid'));
    expect(pidFile).toBe(`.partial-${snapshot ?? ''}.pid`);
    // And the copier is gone: the run waited for it to exit. (Were it alive,
    // it is killed here, so a failing case leaves no process behind.)
    const pid = Number(await readFile(join(offBox, pidFile ?? ''), 'utf8'));
    let alive = true;
    try {
      process.kill(pid, 0);
      process.kill(pid, 'SIGKILL');
    } catch (error) {
      alive = (error as { readonly code?: unknown }).code !== 'ESRCH';
    }
    expect(alive).toBe(false);
  });

  it('records off-box failed and removes the partial copy when the copier exits with an error', async () => {
    const paths = await migratedAlone();
    const onBox = join(paths.root, 'on-box');
    const offBox = join(paths.root, 'off-box');
    const older = await restorePoints(offBox);
    const quiet = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      const taken = await backup(paths, onBox, {
        keep: 1,
        copyTo: offBox,
        now: () => new Date('2026-09-01T00:00:00Z'),
        offBoxWatchdog: {
          ...OFF_BOX_WATCHDOG,
          // Makes a partial copy, then fails.
          copier: [
            process.execPath,
            '-e',
            "require('node:fs').mkdirSync(process.argv[2]); process.exit(3);",
          ],
        },
      });
      expect(taken).toMatchObject({ offBox: 'failed', recorded: true, copiedTo: null });
    } finally {
      quiet.mockRestore();
    }
    expect((await readdir(offBox)).sort()).toEqual(older);
    expect(await readdir(onBox)).toEqual(['snapshot-2026-09-01T00-00-00-000Z']);
  });

  it('records off-box failed and prunes nothing when the copier cannot be started', async () => {
    const paths = await migratedAlone();
    const onBox = join(paths.root, 'on-box');
    const offBox = join(paths.root, 'off-box');
    const older = await restorePoints(offBox);
    const quiet = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      const taken = await backup(paths, onBox, {
        keep: 1,
        copyTo: offBox,
        now: () => new Date('2026-09-01T00:00:00Z'),
        offBoxWatchdog: {
          ...OFF_BOX_WATCHDOG,
          // No such program: the spawn fails, and Node emits `error` with no `exit`.
          copier: [join(paths.root, 'no-such-copier')],
        },
      });
      expect(taken).toMatchObject({ offBox: 'failed', recorded: true, copiedTo: null });
    } finally {
      quiet.mockRestore();
    }
    expect((await readdir(offBox)).sort()).toEqual(older);
    expect(await readdir(onBox)).toEqual(['snapshot-2026-09-01T00-00-00-000Z']);
  });

  it('gives the copy the snapshot’s size at the watchdog’s rate, and never less than its floor', () => {
    const watchdog = { floorMs: 1000, bytesPerSecond: 1_000_000 };
    expect(offBoxLimitMs(0, watchdog)).toBe(1000);
    expect(offBoxLimitMs(500_000, watchdog)).toBe(1000);
    expect(offBoxLimitMs(5_000_000, watchdog)).toBe(5000);
    expect(offBoxLimitMs(5_000_001, watchdog)).toBe(5001);
    // The defaults: a 15-minute floor, and 1 MB/s past it.
    expect(offBoxLimitMs(0, OFF_BOX_WATCHDOG)).toBe(15 * 60_000);
    expect(offBoxLimitMs(2_000_000_000, OFF_BOX_WATCHDOG)).toBe(2_000_000);
  });
});
