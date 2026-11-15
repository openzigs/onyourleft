// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * `GET` and `POST /v1/operate/backups` (#2606), called through the real
 * listener, sealed, as every caller who might try them. A backup is taken the
 * way the operator takes one — `backup`, in this process, against the
 * world's own database file, on a connection of its own that it closes — and
 * read back through the route, which reads it on the instance's.
 */

import { toHex } from '@onyourleft/domain';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { TEST_ORIGIN } from '../auth/identity-testing.ts';
import { createDiskBlobStore } from '../blob/disk-blob-store.ts';
import { privateSpellings, secretBytes } from '../keys/instance-keys-testing.ts';
import {
  codeOf,
  startModerationWorld,
  type ModerationWorld,
} from '../moderation/moderation-testing.ts';
import { OFF_BOX_FAILED, type Manifest } from '../operator/commands.ts';
import { runCommand } from '../operator/run.ts';
import { openDatabase } from '../store/node-sqlite.ts';
import type { OperatorLogEntry } from '../store/sql-store.ts';
import { seedWorld } from '../store/testing/index.ts';

const BACKUPS = '/v1/operate/backups';

interface BackupBody {
  readonly backups: readonly Record<string, unknown>[];
  readonly pending: { readonly requestedAt: string } | null;
}

let directory: string | undefined;
afterEach(async () => {
  if (directory !== undefined) await rm(directory, { recursive: true, force: true });
  directory = undefined;
});

/** The operator's CLI, in this process, against the world's own database file. */
async function cli(
  world: ModerationWorld,
  argv: readonly string[],
  extra: { secret?: string; ownerKey?: string; input?: string } = {},
): Promise<{ readonly code: number; readonly printed: string; readonly complained: string }> {
  let printed = '';
  let complained = '';
  const out = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    printed += String(chunk);
    return true;
  });
  const err = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    complained += String(chunk);
    return true;
  });
  try {
    const code = await runCommand(argv, {
      database: world.path,
      blobs: `${world.path}.blobs`,
      secret: extra.secret,
      ownerKey: extra.ownerKey,
      readStandardInput: () => Promise.resolve(extra.input ?? ''),
    });
    return { code, printed, complained };
  } finally {
    out.mockRestore();
    err.mockRestore();
  }
}

const backupsOf = async (world: ModerationWorld): Promise<BackupBody> => {
  const answer = await world.as(world.owner, 'GET', BACKUPS);
  expect(answer.status).toBe(200);
  return answer.body as BackupBody;
};

const logEntries = async (world: ModerationWorld) =>
  (
    (await world.as(world.owner, 'GET', '/v1/operate/log')).body as {
      entries: { action: string; detail: string | null; outcome: string; source: string }[];
    }
  ).entries;

const wholeLog = (world: ModerationWorld): Promise<readonly OperatorLogEntry[]> =>
  world.freshRead((store) => store.listOperatorLogPage(undefined, 200));

async function scratch(): Promise<string> {
  directory = await mkdtemp(join(tmpdir(), 'oyl-operate-backups-'));
  return directory;
}

describe('GET /v1/operate/backups — what the backup service recorded (#2606)', () => {
  let world: ModerationWorld;
  beforeAll(async () => {
    world = await startModerationWorld();
    // A populated instance: three athletes' rows, and two blobs.
    await world.freshRead(seedWorld);
    const blobs = createDiskBlobStore(`${world.path}.blobs`);
    await blobs.put(new TextEncoder().encode('a FIT file'));
    await blobs.put(new TextEncoder().encode('a second FIT file'));
  });
  afterAll(() => world.close());

  it('reads a backup with an off-box copy back through the route, its counts those of its manifest.json', async () => {
    const root = await scratch();
    const taken = await cli(world, [
      'backup',
      join(root, 'backups'),
      '--copy-to',
      join(root, 'offbox'),
    ]);
    expect(taken.code, taken.complained).toBe(0);
    const [name] = await readdir(join(root, 'backups'));
    const manifest = JSON.parse(
      await readFile(join(root, 'backups', name ?? '', 'manifest.json'), 'utf8'),
    ) as Manifest;

    const [record] = (await backupsOf(world)).backups;
    expect(record).toMatchObject({
      outcome: 'done',
      error: null,
      snapshot: name,
      rows: Object.values(manifest.rows).reduce((sum, n) => sum + n, 0),
      blobs: manifest.blobs,
      databaseSha256: manifest.databaseSha256,
      offBox: 'copied',
      removed: 0,
      // A one-off run, not the backup service's.
      intervalSeconds: null,
      requested: false,
      // Whole seconds: the record keeps the run's start to the second.
      at: new Date(Math.floor(Date.parse(manifest.takenAt) / 1000) * 1000).toISOString(),
    });
    expect(manifest.blobs).toBe(2);
    expect(record?.sizeBytes).toEqual(expect.any(Number));
    expect(record?.sizeBytes as number).toBeGreaterThan(0);
    const free = record?.freeBytes as { backups: number; offBox: number };
    expect(free.backups).toBeGreaterThan(0);
    expect(free.offBox).toBeGreaterThan(0);
    // The directory's name, and no folder it is in.
    expect(JSON.stringify(record)).not.toContain(root);
    // A one-off run is no last backup of the service's.
    const status = await world.as(world.owner, 'GET', '/v1/operate/status');
    expect((status.body as { lastBackup: unknown }).lastBackup).toBeNull();
  });

  it('records the copy `failed` when the off-box place cannot be written, and still records the snapshot', async () => {
    const root = await scratch();
    // The off-box "drive" is a file: nothing can be copied under it.
    await writeFile(join(root, 'unplugged'), 'not a drive');
    const taken = await cli(world, [
      'backup',
      join(root, 'backups'),
      '--copy-to',
      join(root, 'unplugged', 'offbox'),
    ]);
    expect(taken.code).toBe(1);
    expect(taken.complained).toBe(OFF_BOX_FAILED);
    expect(JSON.parse(taken.printed.trim())).toMatchObject({ offBox: 'failed', recorded: true });
    const [name] = await readdir(join(root, 'backups'));
    const [record] = (await backupsOf(world)).backups;
    expect(record).toMatchObject({ outcome: 'done', snapshot: name, offBox: 'failed' });
    expect((record?.freeBytes as { offBox: unknown }).offBox).toBeNull();
    expect((await logEntries(world))[0]).toMatchObject({
      action: 'backup',
      source: 'cli',
      outcome: 'done',
      detail: 'blobs=2,removed=0,offbox_failed',
    });
  });
});

describe('POST /v1/operate/backups — “back up now” (#2606)', () => {
  it('asks once: a second ask while it waits is refused `too_many`, and the log holds one of each', async () => {
    const world = await startModerationWorld();
    try {
      const first = await world.as(world.owner, 'POST', BACKUPS);
      expect(first.status).toBe(202);
      const requestedAt = (first.body as { requestedAt: string }).requestedAt;
      expect(Date.parse(requestedAt)).toBe(Math.floor(world.clock.ms / 1000) * 1000);
      const second = await world.as(world.owner, 'POST', BACKUPS);
      expect(second.status).toBe(429);
      expect(codeOf(second.body)).toBe('too_many');

      expect((await backupsOf(world)).pending).toEqual({ requestedAt });
      const asked = (await logEntries(world)).filter(
        (entry) => entry.action === 'backup_requested',
      );
      expect(asked).toEqual([
        {
          id: expect.any(Number) as unknown,
          at: expect.any(String) as unknown,
          source: 'app',
          action: 'backup_requested',
          detail: 'pending',
          outcome: 'refused',
        },
        {
          id: expect.any(Number) as unknown,
          at: requestedAt,
          source: 'app',
          action: 'backup_requested',
          detail: null,
          outcome: 'done',
        },
      ]);
      // As the owner's athlete, read through the store.
      expect((await wholeLog(world))[0]?.actorAthleteId).toBe(world.owner.athleteId);
    } finally {
      await world.close();
    }
  });

  it('refuses `too_many` within 15 minutes of a backup, and asks once they are past', async () => {
    const world = await startModerationWorld();
    try {
      // A snapshot the backup service recorded 14 minutes ago, by the world's clock.
      const now = Math.floor(world.clock.ms / 1000);
      await world.freshRead((store) =>
        store.recordBackup({
          outcome: 'done',
          at: now - 14 * 60,
          snapshot: 'snapshot-recent',
          rows: 1,
          blobs: 0,
          databaseSha256: '0'.repeat(64),
          sizeBytes: 1,
          offBox: 'copied',
          removed: 0,
          backupsFreeBytes: null,
          offBoxFreeBytes: null,
          intervalSeconds: 3600,
        }),
      );
      const refused = await world.as(world.owner, 'POST', BACKUPS);
      expect(codeOf(refused.body)).toBe('too_many');
      expect((await logEntries(world))[0]).toMatchObject({
        action: 'backup_requested',
        detail: 'too_soon',
        outcome: 'refused',
      });
      expect((await backupsOf(world)).pending).toBeNull();
      world.clock.ms += 2 * 60_000;
      expect((await world.as(world.owner, 'POST', BACKUPS)).status).toBe(202);
    } finally {
      await world.close();
    }
  });

  it('asks for nothing when its log entry cannot be written: applied and logged, or neither', async () => {
    const world = await startModerationWorld();
    try {
      const database = openDatabase(world.path);
      try {
        database.exec(`create trigger operator_log_refuses_test before insert on operator_log
          begin select raise(abort, 'the log refused this entry'); end`);
      } finally {
        database.close();
      }
      const answer = await world.as(world.owner, 'POST', BACKUPS);
      expect(answer.status).toBe(500);
      expect(await world.freshRead((store) => store.pendingBackupRequest())).toBeUndefined();
    } finally {
      await world.close();
    }
  });
});

describe('/v1/operate/backups — the owner’s, and nobody else’s (#2606)', () => {
  let world: ModerationWorld;
  beforeAll(async () => {
    world = await startModerationWorld({ registration: 'approval' });
  });
  afterAll(() => world.close());

  it('answers the deputy, an approved rider and one awaiting approval exactly as no route, for both — changing nothing', async () => {
    const approved = await world.rider('Approved');
    expect(
      (
        await world.as(
          world.owner,
          'POST',
          `/v1/moderation/registrations/${approved.athleteId}/approve`,
          { reason: 'Known' },
        )
      ).status,
    ).toBe(200);
    const pending = await world.rider('Waiting');
    const log = await wholeLog(world);

    for (const method of ['GET', 'POST'] as const) {
      const nowhere = await world.as(approved, method, '/v1/no-such-route');
      for (const caller of [world.deputy, approved, pending]) {
        const answer = await world.as(caller, method, BACKUPS);
        expect(answer).toEqual(nowhere);
        expect(codeOf(answer.body)).toBe('not_found');
      }
      expect(codeOf((await world.call(method, BACKUPS, { signer: null })).body)).toBe(
        'unauthenticated',
      );
      expect(
        codeOf((await world.call(method, BACKUPS, { token: world.owner.token, plain: true })).body),
      ).toBe('sealed_required');
    }
    // Read back through the store: nothing asked for, nothing logged.
    expect(await world.freshRead((store) => store.pendingBackupRequest())).toBeUndefined();
    expect(await wholeLog(world)).toEqual(log);
  });
});

describe('/v1/operate/backups carries no secret the instance holds (#2606)', () => {
  it('holds every secret-bearing value as a marker and returns none of them, nor a host path', async () => {
    const world = await startModerationWorld();
    try {
      const root = await scratch();
      const secret = btoa(String.fromCharCode(...secretBytes(9)));
      const hostedKey = 'sk-MARKER-hosted-key-2606';
      expect(
        (
          await cli(
            world,
            ['model-key', 'set', '--url', 'https://models.example/v1', '--model', 'm'],
            {
              secret,
              ownerKey: world.owner.device.publicKey,
              input: hostedKey,
            },
          )
        ).code,
      ).toBe(0);
      // Asked first: the CLI's clock is the real one, ahead of the world's.
      const asked = await world.as(world.owner, 'POST', BACKUPS);
      expect(
        (await cli(world, ['backup', join(root, 'backups'), '--copy-to', join(root, 'offbox')]))
          .code,
      ).toBe(0);
      const listed = await world.as(world.owner, 'GET', BACKUPS);
      expect(listed.status).toBe(200);
      expect((listed.body as BackupBody).backups).toHaveLength(1);
      expect(asked.status).toBe(202);

      const privateHalves: string[] = [];
      for (const row of await world.freshRead((store) => store.listInstanceKeys())) {
        privateHalves.push(...(await privateSpellings(row, secretBytes(7), TEST_ORIGIN)));
        privateHalves.push(toHex(row.wrapped), btoa(String.fromCharCode(...row.wrapped)));
      }
      const bodies = JSON.stringify([listed.body, asked.body]);
      for (const marker of [
        ...privateHalves,
        secret,
        hostedKey,
        world.owner.token,
        world.deputy.token,
        world.owner.device.publicKey,
        root,
        world.path,
        tmpdir(),
      ]) {
        expect(bodies).not.toContain(marker);
      }
    } finally {
      await world.close();
    }
  });
});
