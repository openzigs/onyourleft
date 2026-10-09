// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The hosted model key, end to end (#1097): set, read and cleared by the
 * operator's own command (`node src/operator/cli.ts model-key …`, in a child
 * process, the key on standard input), backed up and restored by the
 * operator's own backup, and read by a running instance — which still
 * registers other riders over HTTP (ADR 0046 ruling 5), exports only that a
 * key is held, and erases it with the account. The key is held for the
 * operator: the athlete whose device holds `OYL_INSTANCE_OWNER_KEY` (Q9).
 *
 * Every place the key must NOT be is searched for {@link MARKER}: the
 * database's bytes, a snapshot's bytes, the command's output and errors,
 * every log line, `/metrics`, an error response and the account export.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import {
  HOSTED_KEY_UNREADABLE,
  hostedKeyState,
  importSecretKey,
  readSecretKey,
} from '../analysis/hosted-key.ts';
import { MARKER, MARKER_KEY, secretText } from '../analysis/hosted-key-testing.ts';
import { TEST_ORIGIN, testDevice, type IdentityInstance } from '../auth/identity-testing.ts';
import { sealedAt } from '../sealed/sealed-testing.ts';
import { authorised, syncWorld } from '../sync/sync-testing.ts';
import { startInstance, type StartedInstance } from '../instance.ts';
import { testConfig } from '../instance-testing.ts';
import { readServerConfig } from '../server-config.ts';
import { migrateForDeploy, openServingStore } from '../store/serving.ts';
import {
  ATHLETE_A,
  ATHLETE_B,
  deviceKeyFixture,
  recoveryCodeFixture,
  registrationFixture,
} from '../store/testing/index.ts';

const INSTANCE = fileURLToPath(new URL('../..', import.meta.url));
const CLI = fileURLToPath(new URL('./cli.ts', import.meta.url));
const URL_TEXT = 'https://models.example/v1';
const SECRET = secretText(11);
const OTHER_SECRET = secretText(12);
/** The operator's device key: athlete A's, unless a case says otherwise. */
const OWNER_A = deviceKeyFixture(ATHLETE_A).publicKey;

let directory: string | undefined;
let running: StartedInstance | undefined;
afterEach(async () => {
  await running?.stop();
  running = undefined;
  if (directory !== undefined) await rm(directory, { recursive: true, force: true });
  directory = undefined;
});

interface Data {
  readonly database: string;
  readonly blobs: string;
}

/** A migrated database holding `athletes` athletes. */
async function instanceWith(...athletes: string[]): Promise<Data> {
  directory = await mkdtemp(join(tmpdir(), 'oyl-instance-model-key-'));
  const data = {
    database: join(directory, 'live', 'instance.sqlite'),
    blobs: join(directory, 'live', 'blobs'),
  };
  await mkdir(join(directory, 'live'), { recursive: true });
  await migrateForDeploy(data.database);
  const store = openServingStore(data.database);
  try {
    for (const athlete of athletes) await store.registerAthlete(registrationFixture(athlete));
  } finally {
    await store.close();
  }
  return data;
}

function cli(
  data: Data,
  args: readonly string[],
  options: {
    readonly secret?: string;
    readonly input?: string;
    /** `OYL_INSTANCE_OWNER_KEY`; `null` leaves it unset. */
    readonly ownerKey?: string | null;
  } = {},
) {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    OYL_INSTANCE_DATABASE: data.database,
    OYL_INSTANCE_BLOBS: data.blobs,
  };
  delete env.OYL_INSTANCE_SECRET_KEY;
  delete env.OYL_INSTANCE_OWNER_KEY;
  if (options.secret !== undefined) env.OYL_INSTANCE_SECRET_KEY = options.secret;
  const ownerKey = options.ownerKey === undefined ? OWNER_A : options.ownerKey;
  if (ownerKey !== null) env.OYL_INSTANCE_OWNER_KEY = ownerKey;
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd: INSTANCE,
    encoding: 'utf8',
    env,
    input: options.input ?? '',
    timeout: 30_000,
  });
  const report =
    result.status === 0
      ? (JSON.parse(result.stdout.trim().split('\n').at(-1) ?? '{}') as Record<string, unknown>)
      : {};
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, report };
}

const SET = ['model-key', 'set', '--url', URL_TEXT, '--model', 'a-model'] as const;

function setKey(data: Data, ownerKey: string = OWNER_A) {
  return cli(data, SET, { secret: SECRET, input: `${MARKER_KEY}\n`, ownerKey });
}

/** Every file under `root`, as Latin-1, so an ASCII secret anywhere in them is found. */
async function bytesUnder(root: string): Promise<string> {
  let all = '';
  for (const entry of await readdir(root, { recursive: true, withFileTypes: true })) {
    if (entry.isFile())
      all += (await readFile(join(entry.parentPath, entry.name))).toString('latin1');
  }
  return all;
}

/** The database's file, write-ahead log and shared-memory index, as Latin-1. */
async function databaseBytes(path: string): Promise<string> {
  let all = '';
  for (const suffix of ['', '-wal', '-shm']) {
    if (existsSync(`${path}${suffix}`))
      all += (await readFile(`${path}${suffix}`)).toString('latin1');
  }
  return all;
}

async function secretKeyOf(text: string) {
  const read = readSecretKey(text);
  if (read.kind !== 'ok') throw new Error('fixture secret');
  return importSecretKey(read.bytes);
}

describe('model-key set — encrypted at rest, read back (#1097)', () => {
  it('holds the key from standard input as ciphertext, and opens it again on a fresh connection', async () => {
    const data = await instanceWith(ATHLETE_A);
    const set = setKey(data);
    expect(set.status, set.stderr).toBe(0);
    expect(set.report).toEqual({
      command: 'model-key set',
      key: 'a key is held',
      url: URL_TEXT,
      model: 'a-model',
    });
    expect(set.stdout + set.stderr).not.toContain(MARKER);

    // The store is closed (the command's process has ended): the raw bytes.
    const bytes = await databaseBytes(data.database);
    expect(bytes).toContain(URL_TEXT);
    expect(bytes).not.toContain(MARKER);

    const store = openServingStore(data.database);
    try {
      const state = await hostedKeyState(store, await secretKeyOf(SECRET));
      expect(state).toEqual({
        kind: 'held',
        url: URL_TEXT,
        model: 'a-model',
        athleteId: ATHLETE_A,
        key: MARKER_KEY,
      });
    } finally {
      await store.close();
    }
  });

  it('status prints the URL, the model and that a key is held — never the key', async () => {
    const data = await instanceWith(ATHLETE_A);
    expect(setKey(data).status).toBe(0);
    const status = cli(data, ['model-key', 'status'], { secret: SECRET });
    expect(status.status, status.stderr).toBe(0);
    expect(status.report).toEqual({
      command: 'model-key status',
      key: 'a key is held',
      url: URL_TEXT,
      model: 'a-model',
      readable: true,
    });
    expect(status.stdout + status.stderr).not.toContain(MARKER);
  });
});

describe('never on argv (#1097)', () => {
  it.each([
    ['as a trailing argument', [...SET, MARKER_KEY]],
    ['as a --key flag', [...SET, '--key', MARKER_KEY]],
  ])('refuses a key passed %s, without echoing it, and holds nothing', async (_how, args) => {
    const data = await instanceWith(ATHLETE_A);
    const refused = cli(data, args, { secret: SECRET, input: `${MARKER_KEY}\n` });
    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain('standard input, never from the command line');
    expect(refused.stdout + refused.stderr).not.toContain(MARKER);
    expect(cli(data, ['model-key', 'status'], { secret: SECRET }).report).toEqual({
      command: 'model-key status',
      key: 'no key is held',
    });
  });

  it('refuses empty standard input', async () => {
    const data = await instanceWith(ATHLETE_A);
    const refused = cli(data, SET, { secret: SECRET, input: '' });
    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain('Standard input must hold the key');
  });
});

describe('the refusals of set (#1097)', () => {
  it('refuses an http: URL', async () => {
    const data = await instanceWith(ATHLETE_A);
    const args = ['model-key', 'set', '--url', 'http://models.example/v1', '--model', 'a-model'];
    const refused = cli(data, args, { secret: SECRET, input: MARKER_KEY });
    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain('https:');
    expect(refused.stderr).not.toContain(MARKER);
  });

  it('refuses with no secret, and with a secret that is not 32 bytes — never echoing it', async () => {
    const data = await instanceWith(ATHLETE_A);
    expect(cli(data, SET, { input: MARKER_KEY }).stderr).toContain(
      'OYL_INSTANCE_SECRET_KEY is not set',
    );
    const short = btoa(`${MARKER}x`);
    const malformed = cli(data, SET, { secret: short, input: MARKER_KEY });
    expect(malformed.status).toBe(1);
    expect(malformed.stderr).toContain('32 bytes');
    expect(malformed.stderr).not.toContain(short);
  });

  it('refuses with no OYL_INSTANCE_OWNER_KEY, saying why, and holds nothing', async () => {
    const data = await instanceWith(ATHLETE_A);
    const refused = cli(data, SET, { secret: SECRET, input: MARKER_KEY, ownerKey: null });
    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain('OYL_INSTANCE_OWNER_KEY is not set');
    expect(refused.stderr).not.toContain(MARKER);
    expect(await databaseBytes(data.database)).not.toContain(URL_TEXT);
  });

  it('refuses an OYL_INSTANCE_OWNER_KEY that is no athlete’s device key here, and holds nothing', async () => {
    const data = await instanceWith(ATHLETE_A);
    const refused = setKey(data, deviceKeyFixture(ATHLETE_B).publicKey);
    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain('not a device key of any athlete on this instance');
    expect(refused.stderr).not.toContain(MARKER);
    expect(await databaseBytes(data.database)).not.toContain(URL_TEXT);
  });

  it('refuses an OYL_INSTANCE_OWNER_KEY that has been revoked, and holds nothing', async () => {
    const data = await instanceWith(ATHLETE_A);
    const store = openServingStore(data.database);
    try {
      // The operator's only key, revoked with their recovery code (the last-key rule).
      expect(
        await store.revokeDeviceKey(
          ATHLETE_A,
          OWNER_A,
          1_790_000_100,
          recoveryCodeFixture(ATHLETE_A),
          OWNER_A,
          0,
        ),
      ).not.toBe('not_found');
      expect((await store.findDeviceKey(OWNER_A))?.revokedAt).not.toBeNull();
    } finally {
      await store.close();
    }
    const refused = setKey(data);
    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain('not a device key of any athlete on this instance');
    expect(refused.stderr).not.toContain(MARKER);
    expect(await databaseBytes(data.database)).not.toContain(URL_TEXT);
  });
});

describe('held for the operator, on an instance with other riders (#1097, ADR 0046 Q9 and ruling 5)', () => {
  it.each([
    ['A', ATHLETE_A],
    ['B', ATHLETE_B],
  ])(
    'holds the key for the athlete whose device holds OYL_INSTANCE_OWNER_KEY (%s), with two riders registered',
    async (_name, operator) => {
      const data = await instanceWith(ATHLETE_A, ATHLETE_B);
      const set = setKey(data, deviceKeyFixture(operator).publicKey);
      expect(set.status, set.stderr).toBe(0);
      const store = openServingStore(data.database);
      try {
        expect(await hostedKeyState(store, await secretKeyOf(SECRET))).toMatchObject({
          kind: 'held',
          athleteId: operator,
          key: MARKER_KEY,
        });
      } finally {
        await store.close();
      }
    },
  );
});

describe('backups hold ciphertext only (#1097)', () => {
  it('backs up no plaintext, and a restore under another secret reads the key as unreadable', async () => {
    const data = await instanceWith(ATHLETE_A);
    expect(setKey(data).status).toBe(0);
    const backups = join(directory!, 'backups');
    const taken = cli(data, ['backup', backups]);
    expect(taken.status, taken.stderr).toBe(0);
    expect((taken.report.rows as Record<string, number>).hosted_model_key).toBe(1);
    const snapshot = taken.report.snapshot as string;
    const held = await bytesUnder(snapshot);
    expect(held).toContain(URL_TEXT);
    expect(held).not.toContain(MARKER);

    const elsewhere = {
      database: join(directory!, 'elsewhere', 'instance.sqlite'),
      blobs: join(directory!, 'elsewhere', 'blobs'),
    };
    expect(cli(elsewhere, ['restore', snapshot]).status).toBe(0);
    const other = cli(elsewhere, ['model-key', 'status'], { secret: OTHER_SECRET });
    expect(other.status, other.stderr).toBe(0);
    expect(other.report).toMatchObject({
      key: 'a key is held',
      readable: false,
      problem: HOSTED_KEY_UNREADABLE,
    });
    expect(cli(elsewhere, ['model-key', 'status'], { secret: SECRET }).report).toMatchObject({
      readable: true,
    });
  });
});

describe('model-key clear (#1097)', () => {
  it('clears the key, says whether there was one, and leaves no ciphertext in the database’s bytes', async () => {
    const data = await instanceWith(ATHLETE_A);
    expect(setKey(data).status).toBe(0);
    const store = openServingStore(data.database);
    let ciphertext: string;
    try {
      const held = await store.getHostedModelKey();
      ciphertext = Buffer.from(held!.ciphertext).toString('latin1');
    } finally {
      await store.close();
    }
    expect(await databaseBytes(data.database), 'the control: it was there').toContain(ciphertext);

    expect(cli(data, ['model-key', 'clear']).report).toEqual({
      command: 'model-key clear',
      cleared: true,
    });
    expect(cli(data, ['model-key', 'clear']).report).toEqual({
      command: 'model-key clear',
      cleared: false,
    });
    const after = await databaseBytes(data.database);
    expect(after).not.toContain(MARKER);
    // `secure_delete` (#1097's review): a deleted row is zeroed, not left in a free page.
    expect(after).not.toContain(ciphertext);
  });
});

describe('scrubbing a replaced or cleared key (#1097)', () => {
  async function heldCiphertext(data: Data): Promise<string> {
    const store = openServingStore(data.database);
    try {
      return Buffer.from((await store.getHostedModelKey())!.ciphertext).toString('latin1');
    } finally {
      await store.close();
    }
  }

  it('replacing the key leaves no part of the old ciphertext in the database or its log', async () => {
    const data = await instanceWith(ATHLETE_A);
    // A long key replaced by a short one: the row shrinks, so the start of the
    // old cell — its ciphertext's opening bytes among them — is freed rather
    // than written over, and only `secure_delete` zeroes it. (A LONGER
    // replacement covers the old cell whole and would prove nothing.)
    const long = cli(data, SET, { secret: SECRET, input: `${MARKER_KEY}${'x'.repeat(400)}\n` });
    expect(long.status, long.stderr).toBe(0);
    const old = (await heldCiphertext(data)).slice(0, 24);
    expect(await databaseBytes(data.database), 'the control: it was there').toContain(old);

    const replaced = cli(data, SET, { secret: SECRET, input: 'sk-short\n' });
    expect(replaced.status, replaced.stderr).toBe(0);
    expect(await heldCiphertext(data)).not.toContain(old);
    expect(await databaseBytes(data.database)).not.toContain(old);
  });

  it('truncates the log on clear while another connection is open, so the ciphertext is not left in the file', async () => {
    const data = await instanceWith(ATHLETE_A);
    expect(setKey(data).status).toBe(0);
    const ciphertext = await heldCiphertext(data);
    // Another connection held open — the running server, say — so closing the
    // command's own connection does not checkpoint and remove the log for it.
    const other = openServingStore(data.database);
    try {
      await other.getHostedModelKey();
      expect(cli(data, ['model-key', 'clear']).report).toMatchObject({ cleared: true });
      const after = await databaseBytes(data.database);
      expect(after).not.toContain(ciphertext);
      expect(after).not.toContain(MARKER);
    } finally {
      await other.close();
    }
  });
});

/** A running instance over `data`, with `secret`, every log line kept. */
async function serve(data: Data, secret: string | undefined, metricsToken?: string) {
  const read = readServerConfig(
    {
      database: data.database,
      blobs: data.blobs,
      origin: TEST_ORIGIN,
      roomWorkers: '1',
      secretKey: secret,
      ...(metricsToken === undefined ? {} : { metrics: 'on', metricsToken }),
    },
    1,
  );
  if (!read.ok) throw new Error(read.problems.join(' '));
  const lines: string[] = [];
  running = await startInstance({
    config: testConfig({ registration: 'open' }),
    server: read.config,
    version: '9.8.7',
    notices: 'notices',
    log: (line) => lines.push(line),
    migrationPollMs: 50,
  });
  await running.opened;
  await running.hostedKeyReported;
  return { instance: running, lines };
}

async function post(url: string, path: string, body: unknown) {
  const response = await fetch(`${url}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, text: await response.text() };
}

/** Challenge, sign, sign in — a registration when the key is new. */
async function signIn(url: string) {
  const device = await testDevice();
  const challenge = JSON.parse(
    (await post(url, '/v1/auth/challenge', { publicKey: device.publicKey })).text,
  ) as {
    nonce: string;
  };
  // A new key registers only sealed on an instance holding keys (#1192).
  return sealedAt(url, TEST_ORIGIN, {
    method: 'POST',
    path: '/v1/auth/session',
    body: await device.statement(challenge.nonce),
    signer: device.signingKey,
  });
}

describe('a running instance holding a key (#1097)', () => {
  it('logs that a key restored under another secret cannot be read, and does not crash — no key in any log line or /metrics', async () => {
    const data = await instanceWith(ATHLETE_A);
    expect(setKey(data).status).toBe(0);
    const token = 'm'.repeat(40);
    const { instance, lines } = await serve(data, OTHER_SECRET, token);
    const report = lines
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .find((line) => line.event === 'hosted-model-key');
    expect(report).toEqual({
      event: 'hosted-model-key',
      state: 'unreadable',
      hostedKeyProblem: HOSTED_KEY_UNREADABLE,
    });
    expect((await instance.hostedModelKey()).kind).toBe('unreadable');
    const metrics = await (
      await fetch(`${instance.url}/metrics`, { headers: { authorization: `Bearer ${token}` } })
    ).text();
    expect(metrics.length).toBeGreaterThan(0);
    expect(metrics).not.toContain(MARKER);
    expect(lines.join('\n')).not.toContain(MARKER);
    expect((await fetch(`${instance.url}/ready`)).status).toBe(200);
  });

  it('opens the key with the secret it was sealed under, and logs only that it is held', async () => {
    const data = await instanceWith(ATHLETE_A);
    expect(setKey(data).status).toBe(0);
    const { instance, lines } = await serve(data, SECRET);
    expect(lines.map((line) => JSON.parse(line) as Record<string, unknown>)).toContainEqual({
      event: 'hosted-model-key',
      state: 'held',
    });
    expect(await instance.hostedModelKey()).toMatchObject({ kind: 'held', key: MARKER_KEY });
    expect(lines.join('\n')).not.toContain(MARKER);
  });

  it('registers other riders over HTTP while a key is held, and keeps the key for the operator (ADR 0046 ruling 5)', async () => {
    const data = await instanceWith(ATHLETE_A);
    expect(setKey(data).status).toBe(0);
    const { instance, lines } = await serve(data, SECRET);

    for (let rider = 0; rider < 2; rider += 1) {
      const another = await signIn(instance.url);
      expect(another.status, another.text).toBe(200);
      expect(another.text).not.toContain(MARKER);
    }
    expect(await instance.hostedModelKey()).toMatchObject({
      kind: 'held',
      athleteId: ATHLETE_A,
    });
    expect(lines.join('\n')).not.toContain(MARKER);
  });
});

/**
 * Sync — the account export and erasure (#35) — is served by a handler handed
 * one, which the running instance is not yet (`docs/agents/instance.md`); the
 * sync world is that handler over a real database file.
 */
describe('the account export and erasure (#1097, #35)', () => {
  let world: IdentityInstance | undefined;
  afterEach(async () => {
    await world?.close();
    world = undefined;
  });

  it('exports only that a key is held, and DELETE /v1/account erases it with the account', async () => {
    const synced = await syncWorld(1);
    world = synced.world;
    const rider = synced.riders[0]!;
    const data = { database: world.path, blobs: join(world.path, '..', 'blobs') };
    expect(setKey(data, rider.device.publicKey).status).toBe(0);
    const reader = openServingStore(data.database);
    let ciphertext: string;
    try {
      ciphertext = Buffer.from((await reader.getHostedModelKey())!.ciphertext).toString('latin1');
    } finally {
      await reader.close();
    }

    const exported = await authorised(world, rider.token, 'GET', '/v1/account/export');
    const text = await exported.text();
    expect(exported.status, text).toBe(200);
    const body = JSON.parse(text) as { hostedModelKey: unknown; notIncluded: string[] };
    expect(body.hostedModelKey).toBe('a hosted model key is held');
    expect(body.notIncluded.some((line) => line.startsWith('A hosted model key'))).toBe(true);
    expect(text).not.toContain(MARKER);
    expect(text).not.toContain(URL_TEXT);

    const erased = await authorised(world, rider.token, 'DELETE', '/v1/account', {
      recoveryCode: rider.recoveryCodes[0],
    });
    expect(erased.status, await erased.clone().text()).toBeLessThan(300);
    // Scrubbed (#1097's review): erasure runs with `secure_delete` on and truncates the log.
    expect(await databaseBytes(data.database)).not.toContain(ciphertext);
    expect(cli(data, ['model-key', 'status'], { secret: SECRET }).report).toEqual({
      command: 'model-key status',
      key: 'no key is held',
    });
  });

  it('exports null for another rider while the operator’s key is held', async () => {
    const synced = await syncWorld(2);
    world = synced.world;
    const [operator, other] = synced.riders;
    const data = { database: world.path, blobs: join(world.path, '..', 'blobs') };
    expect(setKey(data, operator!.device.publicKey).status).toBe(0);
    const exported = await authorised(world, other!.token, 'GET', '/v1/account/export');
    expect(((await exported.json()) as { hostedModelKey: unknown }).hostedModelKey).toBeNull();
  });

  it('exports null for an athlete with no key held', async () => {
    const synced = await syncWorld(1);
    world = synced.world;
    const exported = await authorised(world, synced.riders[0]!.token, 'GET', '/v1/account/export');
    expect(((await exported.json()) as { hostedModelKey: unknown }).hostedModelKey).toBeNull();
  });
});
