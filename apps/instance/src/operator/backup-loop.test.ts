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
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
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
import { backup, BACKUP_POLL_SECONDS, backupLoop, type DataPaths } from './commands.ts';
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
    // Forty polls, twenty minutes, an interval of ten: two tries, not forty.
    const { result } = await pollFor(paths, onBox, 40, {
      intervalSeconds: 600,
      keep: 2,
      copyTo: offBox,
    });
    expect(result.runs).toBe(2);
    for (const place of [onBox, offBox]) {
      const kept = await readdir(place);
      // Every restore point still there, and only the two snapshots taken.
      expect(kept.filter((name) => older.includes(name))).toEqual(older);
      expect(kept.filter((name) => name.startsWith('snapshot-'))).toHaveLength(older.length + 2);
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
    for (const place of [onBox, offBox]) {
      await mkdir(join(place, '.partial-snapshot-2026-08-31T23-59-00-000Z'), { recursive: true });
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
