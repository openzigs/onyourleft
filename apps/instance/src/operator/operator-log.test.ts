// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The operator's CLI writes the operator log (#2602; the owner's ruling of
 * 2026-11-14 on #2601): each command that changes state leaves ONE entry —
 * `source: 'cli'`, no athlete — read back through the store on a fresh
 * connection after the command closed its own. A refusal is logged
 * `refused` with nothing changed; a read is not logged at all.
 *
 * In this process (`runCommand`, which `cli.ts` only calls): a Node start is
 * most of a spawned run (#2568), and `commands.test.ts` spawns the real CLI.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { recoveryCodeSha256 } from '../auth/identity.ts';
import { secretBytes } from '../keys/instance-keys-testing.ts';
import { openServingStore } from '../store/serving.ts';
import type { OperatorLogEntry } from '../store/sql-store.ts';
import { athleteFixture, deviceKeyFixture } from '../store/testing/index.ts';
import { runCommand } from './run.ts';

let directory: string | undefined;
afterEach(async () => {
  if (directory !== undefined) await rm(directory, { recursive: true, force: true });
  directory = undefined;
});

interface Data {
  readonly database: string;
  readonly blobs: string;
}

const SECRET = btoa(String.fromCharCode(...secretBytes(5)));
const ORIGIN = 'https://ride.example';

async function cli(data: Data, args: readonly string[], input = ''): Promise<number> {
  const out = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  const err = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  try {
    return await runCommand(args, {
      ...data,
      secret: SECRET,
      origin: ORIGIN,
      readStandardInput: () => Promise.resolve(input),
    });
  } finally {
    out.mockRestore();
    err.mockRestore();
  }
}

async function migrated(): Promise<Data> {
  directory = await mkdtemp(join(tmpdir(), 'oyl-instance-operator-log-'));
  const data = { database: join(directory, 'instance.sqlite'), blobs: join(directory, 'blobs') };
  expect(await cli(data, ['migrate'])).toBe(0);
  return data;
}

/** The whole log, newest first, on a fresh connection. */
async function logOf(data: Data): Promise<readonly OperatorLogEntry[]> {
  const store = openServingStore(data.database);
  try {
    return await store.listOperatorLogPage(undefined, 200);
  } finally {
    await store.close();
  }
}

const brief = (entries: readonly OperatorLogEntry[]) =>
  entries.map((entry) => [entry.action, entry.detail, entry.outcome]);

describe('the operator CLI writes the operator log (#2602)', () => {
  it('logs migrate, with how many it applied, and as the CLI: no athlete', async () => {
    const data = await migrated();
    expect(await cli(data, ['migrate'])).toBe(0);
    const log = await logOf(data);
    expect(brief(log)).toEqual([
      ['migrate', 'applied=0', 'done'],
      ['migrate', expect.stringMatching(/^applied=[1-9][0-9]*$/), 'done'],
    ]);
    for (const entry of log) {
      expect(entry).toMatchObject({ source: 'cli', actorAthleteId: null });
    }
  });

  it('logs room-open with the room, and the keys’ init and rotation — and not `show`', async () => {
    const data = await migrated();
    expect(await cli(data, ['room-open', 'logged-room', '--kind', 'race', '--length', '900'])).toBe(
      0,
    );
    expect(await cli(data, ['instance-key', 'init'])).toBe(0);
    expect(await cli(data, ['instance-key', 'show'])).toBe(0);
    expect(await cli(data, ['instance-key', 'rotate'])).toBe(0);
    expect(brief(await logOf(data)).slice(0, 3)).toEqual([
      ['instance_key_rotate', null, 'done'],
      ['instance_key_init', null, 'done'],
      ['room_open', 'race', 'done'],
    ]);
    const store = openServingStore(data.database);
    try {
      expect(await store.getRoom('logged-room')).toMatchObject({ kind: 'race' });
    } finally {
      await store.close();
    }
  });

  it('logs load-accounts add and erase with their counts, and a refused add as refused, adding nothing', async () => {
    const data = await migrated();
    const keys = ['1a'.repeat(32), '2b'.repeat(32)];
    expect(await cli(data, ['load-accounts', 'add'], keys.join('\n'))).toBe(0);
    // The same keys again: every one already held, so refused, and nothing added.
    expect(await cli(data, ['load-accounts', 'add'], keys.join('\n'))).toBe(1);
    expect(await cli(data, ['load-accounts', 'erase'])).toBe(0);
    expect(brief(await logOf(data)).slice(0, 3)).toEqual([
      ['load_accounts_erase', 'erased=2', 'done'],
      ['load_accounts_add', null, 'refused'],
      ['load_accounts_add', 'added=2', 'done'],
    ]);
  });

  it('logs account-erase only when it erases, naming no athlete', async () => {
    const data = await migrated();
    const code = 'ABCD-EFGH-JKMN-PQRS';
    const codeSha256 = await recoveryCodeSha256(code);
    expect(codeSha256).toBeDefined();
    const store = openServingStore(data.database);
    try {
      await store.registerAthlete({
        athlete: athleteFixture('athlete-gone'),
        key: deviceKeyFixture('athlete-gone'),
        recoveryCodeSha256s: [codeSha256 ?? ''],
      });
    } finally {
      await store.close();
    }
    const before = (await logOf(data)).length;
    expect(await cli(data, ['account-erase'], code)).toBe(0);
    expect(await logOf(data)).toHaveLength(before);
    expect(await cli(data, ['account-erase', '--confirm'], code)).toBe(0);
    const [erased] = await logOf(data);
    expect(erased).toMatchObject({
      source: 'cli',
      actorAthleteId: null,
      action: 'account_erase',
      detail: null,
      outcome: 'done',
    });
    expect(JSON.stringify(erased)).not.toContain('athlete-gone');
  });

  it('logs a backup once it is taken, into the live database and not the snapshot', async () => {
    const data = await migrated();
    expect(await cli(data, ['backup', join(directory ?? '', 'backups')])).toBe(0);
    expect(brief(await logOf(data))[0]).toEqual(['backup', 'blobs=0,removed=0', 'done']);
  });
});
