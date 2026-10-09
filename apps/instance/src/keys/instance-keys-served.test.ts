// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The instance's own keys, end to end (#1189, ADR 0047 D-5): a running
 * instance with and without `OYL_INSTANCE_SECRET_KEY`, one started after days
 * off, the operator's `instance-key` command in a child process, a backup, a
 * rotation and a restore, and every place a private half must NOT be — a log
 * line, an error body, `/metrics` and the account export.
 */

import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { instanceKeyStatementBytes } from '@onyourleft/domain';

import { secretText } from '../analysis/hosted-key-testing.ts';
import { verifyEd25519 } from '../auth/crypto.ts';
import { TEST_ORIGIN, type IdentityInstance } from '../auth/identity-testing.ts';
import { startInstance, type StartedInstance } from '../instance.ts';
import { testConfig } from '../instance-testing.ts';
import { backup, instanceKey, restore } from '../operator/commands.ts';
import { readServerConfig } from '../server-config.ts';
import { migrateForDeploy, openServingStore } from '../store/serving.ts';
import { authorised, syncWorld } from '../sync/sync-testing.ts';
import {
  createInstanceKeys,
  NO_SECRET_SENTENCE,
  type InstanceKeysShown,
  type ServedKeys,
} from './instance-keys.ts';
import { privateSpellings, secretBytes } from './instance-keys-testing.ts';

const INSTANCE = fileURLToPath(new URL('../..', import.meta.url));
const CLI = fileURLToPath(new URL('../operator/cli.ts', import.meta.url));
const SECRET = secretText(21);
const DAY_MS = 86_400_000;
const T0_MS = 1_790_000_000_000;

let directory: string | undefined;
let running: StartedInstance | undefined;
let world: IdentityInstance | undefined;
afterEach(async () => {
  await running?.stop();
  running = undefined;
  await world?.close();
  world = undefined;
  if (directory !== undefined) await rm(directory, { recursive: true, force: true });
  directory = undefined;
});

interface Data {
  readonly database: string;
  readonly blobs: string;
}

async function freshData(): Promise<Data> {
  directory = await mkdtemp(join(tmpdir(), 'oyl-instance-keys-served-'));
  const data = {
    database: join(directory, 'live', 'instance.sqlite'),
    blobs: join(directory, 'live', 'blobs'),
  };
  await mkdir(join(directory, 'live'), { recursive: true });
  await migrateForDeploy(data.database);
  return data;
}

function secretOf(text: string): Uint8Array {
  return Uint8Array.from(atob(text), (character) => character.charCodeAt(0));
}

/** A running instance over `data`, every log line kept, on `clock`. */
async function serve(
  data: Data,
  options: { secret?: string; metricsToken?: string; clock?: { ms: number } } = {},
) {
  const read = readServerConfig(
    {
      database: data.database,
      blobs: data.blobs,
      origin: TEST_ORIGIN,
      roomWorkers: '1',
      secretKey: options.secret,
      ...(options.metricsToken === undefined
        ? {}
        : { metrics: 'on', metricsToken: options.metricsToken }),
    },
    1,
  );
  if (!read.ok) throw new Error(read.problems.join(' '));
  const lines: string[] = [];
  const clock = options.clock;
  running = await startInstance({
    config: testConfig(),
    server: read.config,
    version: '9.8.7',
    notices: 'notices',
    log: (line) => lines.push(line),
    migrationPollMs: 50,
    ...(clock === undefined ? {} : { now: () => clock.ms }),
  });
  await running.opened;
  await running.keysMaintained;
  return { instance: running, lines };
}

async function servedKeys(url: string): Promise<{ status: number; body: unknown; text: string }> {
  const response = await fetch(`${url}/v1/instance/keys`);
  const text = await response.text();
  return { status: response.status, body: JSON.parse(text) as unknown, text };
}

async function verifiesAll(keys: ServedKeys): Promise<boolean> {
  for (const each of keys.statements) {
    if (
      !(await verifyEd25519(
        keys.identityKey,
        instanceKeyStatementBytes(each.statement),
        each.signature,
      ))
    ) {
      return false;
    }
  }
  return keys.statements.length > 0;
}

async function keyRows(data: Data) {
  const store = openServingStore(data.database);
  try {
    return await store.listInstanceKeys();
  } finally {
    await store.close();
  }
}

describe('an instance with no operator secret (#1189)', () => {
  it('makes no key, and answers /v1/instance/keys unavailable, naming the variable', async () => {
    const data = await freshData();
    const { instance, lines } = await serve(data);
    const answer = await servedKeys(instance.url);
    expect(answer.status).toBe(503);
    expect(answer.body).toEqual({
      error: { code: 'unavailable', message: NO_SECRET_SENTENCE },
    });
    expect(answer.text).toContain('OYL_INSTANCE_SECRET_KEY');
    expect(await keyRows(data)).toEqual([]);
    expect(lines.map((line) => JSON.parse(line) as Record<string, unknown>)).toContainEqual({
      event: 'instance-keys',
      state: 'no-secret',
      keysProblem: NO_SECRET_SENTENCE,
    });
    // Everything else is served.
    expect((await fetch(`${instance.url}/ready`)).status).toBe(200);
  });
});

describe('an instance with an operator secret (#1189)', () => {
  it('makes its keys on the first start and serves statements that verify under the identity key', async () => {
    const data = await freshData();
    const { instance } = await serve(data, { secret: SECRET });
    const answer = await servedKeys(instance.url);
    expect(answer.status, answer.text).toBe(200);
    const keys = answer.body as ServedKeys;
    expect(await verifiesAll(keys)).toBe(true);
    expect(keys.endorsements).toEqual([]);
    expect((await keyRows(data)).map((row) => row.role).sort()).toEqual(['encryption', 'identity']);
  });

  it('comes up after days off with an in-date statement before /v1/instance/keys answers', async () => {
    const data = await freshData();
    const clock = { ms: T0_MS };
    await serve(data, { secret: SECRET, clock });
    await running?.stop();
    running = undefined;
    // Three days off: every statement the database holds has expired.
    clock.ms = T0_MS + 3 * DAY_MS;
    const store = openServingStore(data.database);
    try {
      const statements = await store.listInstanceKeyStatements();
      expect(statements.every((each) => (each.notAfter ?? 0) * 1000 <= clock.ms)).toBe(true);
    } finally {
      await store.close();
    }
    const { instance } = await serve(data, { secret: SECRET, clock });
    const keys = (await servedKeys(instance.url)).body as ServedKeys;
    expect(keys.statements).toHaveLength(1);
    expect(keys.statements[0]!.statement.notAfter * 1000).toBeGreaterThan(clock.ms);
    expect(keys.statements[0]!.statement.issuedAt * 1000).toBe(clock.ms);
    expect(await verifiesAll(keys)).toBe(true);
  });
});

describe('restore rotates the encryption key, and keeps the identity key (#1189, D-5)', () => {
  it('serves a key above the post-rotation key’s serial after a restore, with the fingerprint unchanged', async () => {
    const data = await freshData();
    const environment = { secret: SECRET, origin: TEST_ORIGIN };
    let now = T0_MS / 1000;
    const at = { ...environment, now: () => now };
    await instanceKey(data, { action: 'init' }, at);
    const before = (await instanceKey(data, { action: 'show' }, at)) as InstanceKeysShown;
    const snapshots = join(directory!, 'snapshots');
    const taken = await backup(data, snapshots);

    now += 3600;
    const rotated = await instanceKey(data, { action: 'rotate', dropOld: false }, at);
    expect(rotated).toMatchObject({ serial: T0_MS / 1000 + 3600 });

    now += 3600;
    const restored = await restore(data, taken.snapshot, { force: true, keys: at });
    expect(restored.keys).toMatchObject({ rotated: true, serial: T0_MS / 1000 + 7200 });
    const after = await instanceKey(data, { action: 'show' }, at);
    expect(after).toMatchObject({ fingerprint: before.fingerprint, card: before.card });

    const store = openServingStore(data.database);
    let keys: ServedKeys;
    try {
      keys = await createInstanceKeys({
        store,
        secret: secretOf(SECRET),
        origin: TEST_ORIGIN,
        now: () => now,
      }).served();
    } finally {
      await store.close();
    }
    expect(keys.statements[0]!.statement.serial).toBeGreaterThan(
      (rotated as unknown as { serial: number }).serial,
    );
    expect(await verifiesAll(keys)).toBe(true);
  });

  it('says why it did not rotate when the secret is not set, and still restores', async () => {
    const data = await freshData();
    await instanceKey(data, { action: 'init' }, { secret: SECRET, origin: TEST_ORIGIN });
    const taken = await backup(data, join(directory!, 'snapshots'));
    const restored = await restore(data, taken.snapshot, {
      force: true,
      keys: { origin: TEST_ORIGIN },
    });
    expect(restored.keys).toEqual({ rotated: false, problem: NO_SECRET_SENTENCE });
    expect(restored.integrity).toBe(true);
  });

  it('issues a key above --serial-above', async () => {
    const data = await freshData();
    const environment = { secret: SECRET, origin: TEST_ORIGIN };
    await instanceKey(data, { action: 'init' }, environment);
    const rotated = await instanceKey(
      data,
      { action: 'rotate', dropOld: false, serialAbove: 4_000_000_000 },
      environment,
    );
    expect(rotated).toMatchObject({ serial: 4_000_000_001 });
  });
});

describe('the operator’s instance-key command (#1189)', () => {
  function cli(data: Data, args: readonly string[], secret: string | null = SECRET) {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      OYL_INSTANCE_DATABASE: data.database,
      OYL_INSTANCE_BLOBS: data.blobs,
      OYL_INSTANCE_ORIGIN: TEST_ORIGIN,
    };
    delete env.OYL_INSTANCE_SECRET_KEY;
    if (secret !== null) env.OYL_INSTANCE_SECRET_KEY = secret;
    return spawnSync(process.execPath, [CLI, ...args], {
      cwd: INSTANCE,
      encoding: 'utf8',
      env,
      timeout: 30_000,
    });
  }

  it('inits, shows the card, rotates and drops the old key, from the command line — and never prints a private byte', async () => {
    const data = await freshData();
    const init = cli(data, ['instance-key', 'init']);
    expect(init.status, init.stderr).toBe(0);
    const shown = cli(data, ['instance-key', 'show']);
    expect(shown.status, shown.stderr).toBe(0);
    const report = JSON.parse(shown.stdout) as { card: string; fingerprint: string };
    expect(report.card).toMatch(/^oyl-instance:https:\/\/ride\.example#[A-Z2-7]{52}$/);
    const rotated = cli(data, ['instance-key', 'rotate', '--drop-old']);
    expect(rotated.status, rotated.stderr).toBe(0);
    expect(JSON.parse(rotated.stdout)).toMatchObject({ dropped: 1 });
    const rows = await keyRows(data);
    let printed = init.stdout + shown.stdout + rotated.stdout;
    printed += init.stderr + shown.stderr + rotated.stderr;
    for (const row of rows) {
      for (const spelling of await privateSpellings(row, secretOf(SECRET), TEST_ORIGIN)) {
        expect(printed).not.toContain(spelling);
      }
    }
  });

  it('refuses with no secret, naming the variable, and makes nothing', async () => {
    const data = await freshData();
    const refused = cli(data, ['instance-key', 'init'], null);
    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain('OYL_INSTANCE_SECRET_KEY');
    expect(await keyRows(data)).toEqual([]);
  });

  it('refuses a --serial-above that is not a whole number', async () => {
    const data = await freshData();
    expect(cli(data, ['instance-key', 'init']).status).toBe(0);
    const refused = cli(data, ['instance-key', 'rotate', '--serial-above', '12x']);
    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain('--serial-above');
  });
});

describe('key material leaks nowhere (#1189, D-5)', () => {
  it('appears in no log line, no error body and not /metrics', async () => {
    const data = await freshData();
    const token = 'k'.repeat(40);
    const { instance, lines } = await serve(data, { secret: SECRET, metricsToken: token });
    const keys = (await servedKeys(instance.url)).text;
    const errors = [
      await (await fetch(`${instance.url}/no-such-route`)).text(),
      await (await fetch(`${instance.url}/v1/instance/keys`, { method: 'POST' })).text(),
      await (await fetch(`${instance.url}/v1/auth/session`, { method: 'GET' })).text(),
    ].join('\n');
    const metrics = await (
      await fetch(`${instance.url}/metrics`, { headers: { authorization: `Bearer ${token}` } })
    ).text();
    expect(metrics.length).toBeGreaterThan(0);
    const rows = await keyRows(data);
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      for (const spelling of await privateSpellings(row, secretOf(SECRET), TEST_ORIGIN)) {
        expect(lines.join('\n')).not.toContain(spelling);
        expect(errors).not.toContain(spelling);
        expect(metrics).not.toContain(spelling);
        expect(keys).not.toContain(spelling);
      }
    }
  });

  it('appears nowhere in the account export', async () => {
    const synced = await syncWorld(1);
    world = synced.world;
    const rider = synced.riders[0]!;
    // Since #1191 every test world makes its keys as it starts, under the test
    // secret `startIdentityInstance` names (`secretBytes(7)`).
    const rows = await world.freshRead((store) => store.listInstanceKeys());
    expect(rows).toHaveLength(2);
    const exported = await authorised(world, rider.token, 'GET', '/v1/account/export');
    const text = await exported.text();
    expect(exported.status, text).toBe(200);
    for (const row of rows) {
      for (const spelling of await privateSpellings(row, secretBytes(7), TEST_ORIGIN)) {
        expect(text).not.toContain(spelling);
      }
    }
  });
});
