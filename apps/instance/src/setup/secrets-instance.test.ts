// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The secrets folder as the RUNNING instance uses it (#2781, ADR 0080 D-4):
 * the production `startInstance` over a real SQLite file, started the way
 * `serve.ts` starts it — `resolveSecrets`, then `readServerConfig` — with no
 * secret in the environment and an empty secrets folder, then started AGAIN
 * on the same folder. The second start must serve the same instance card: a
 * secret made anew on every start passes every one-start test and fails here.
 * Then where the secret must NOT be: the data the backups copy, a log line,
 * and the operator log after the emergency kit is downloaded over real TCP
 * on the loopback listener; and the operator's CLI reading the same file.
 */

import { spawn, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { TEST_ORIGIN } from '../auth/identity-testing.ts';
import { adminBrowser, overHttp, passkeySessionOn, steppedUpForm } from '../admin/admin-testing.ts';
import { startInstance, type StartedInstance } from '../instance.ts';
import { freeLoopbackPort, testConfig } from '../instance-testing.ts';
import { readServerConfig } from '../server-config.ts';
import { openSqlStore } from '../store/open-sql-store.ts';
import { migrateForDeploy } from '../store/serving.ts';
import { registrationFixture } from '../store/testing/index.ts';
import { resolveSecrets, SECRET_FILES } from './secrets.ts';

const CLI = fileURLToPath(new URL('../operator/cli.ts', import.meta.url));
const MAIN = fileURLToPath(new URL('../main.ts', import.meta.url));
const COMMIT = '0123456789abcdef0123456789abcdef01234567';
const INSTANCE = fileURLToPath(new URL('../..', import.meta.url));
/** The longest the CLI child may take: below the case's own default, so a hung one cannot stall it. */
const CHILD_WAIT_MS = 4_000;

const OWNER = 'secrets-owner';
const OWNER_KEY = registrationFixture(OWNER).key.publicKey;

let running: StartedInstance | undefined;
let directory: string | undefined;
afterEach(async () => {
  await running?.stop();
  running = undefined;
  if (directory !== undefined) await rm(directory, { recursive: true, force: true });
  directory = undefined;
});

interface Box {
  readonly data: string;
  readonly database: string;
  readonly blobs: string;
  readonly secrets: string;
  readonly loopback: number;
}

/** A box as the home deployment lays it out: a data folder, and an EMPTY secrets folder beside it. */
async function box(): Promise<Box> {
  directory = await mkdtemp(join(tmpdir(), 'oyl-secrets-instance-'));
  const data = join(directory, 'data');
  const secrets = join(directory, 'secrets');
  await mkdir(data);
  await mkdir(secrets, { mode: 0o700 });
  const database = join(data, 'instance.sqlite');
  await migrateForDeploy(database);
  const store = await openSqlStore(database);
  await store.registerAthlete(registrationFixture(OWNER));
  await store.close();
  return {
    data,
    database,
    blobs: join(data, 'blobs'),
    secrets,
    loopback: await freeLoopbackPort(),
  };
}

/** One start, as `serve.ts` makes it, with no secret in the environment; every log line kept. */
async function start(
  at: Box,
  lines: string[],
): Promise<{ instance: StartedInstance; secret: string }> {
  const log = (line: string): void => {
    lines.push(line);
  };
  const secrets = await resolveSecrets(
    { directory: at.secrets, database: at.database, blobs: at.blobs },
    { log },
  );
  if (!secrets.ok) throw new Error(secrets.problems.join(' '));
  const read = readServerConfig(
    {
      database: at.database,
      blobs: at.blobs,
      origin: TEST_ORIGIN,
      roomWorkers: '1',
      secretKey: secrets.secretKey,
      adminPages: 'on',
      adminLoopbackPort: String(at.loopback),
    },
    1,
  );
  if (!read.ok) throw new Error(read.problems.join(' '));
  running = await startInstance({
    config: testConfig({ moderators: { owner: OWNER_KEY } }),
    server: read.config,
    version: '9.8.7',
    notices: 'notices',
    log,
    migrationPollMs: 50,
    kitSecrets: secrets.fromFiles,
  });
  await running.opened;
  await running.keysMaintained;
  return { instance: running, secret: secrets.secretKey ?? '' };
}

async function stop(): Promise<void> {
  await running?.stop();
  running = undefined;
}

/** What a device pins: the identity key `GET /v1/instance/keys` serves, and the card. */
async function pinned(instance: StartedInstance): Promise<{ identityKey: string; card: string }> {
  const answer = await fetch(`${instance.url}/v1/instance/keys`);
  expect(answer.status).toBe(200);
  const { identityKey } = (await answer.json()) as { identityKey: string };
  const keys = instance.instanceKeys();
  if (keys === undefined) throw new Error('the instance has no keys');
  return { identityKey, card: (await keys.show()).card };
}

/** Every file under `root`, whole. */
async function everyFile(root: string): Promise<Buffer[]> {
  const names = await readdir(root, { recursive: true });
  const files: Buffer[] = [];
  for (const name of names) {
    const path = join(root, name);
    if ((await stat(path)).isFile()) files.push(await readFile(path));
  }
  return files;
}

/** The secret in each spelling it could be written in: its base64 text, and its 32 bytes. */
const spellings = (secret: string): Buffer[] => [
  Buffer.from(secret, 'utf8'),
  Buffer.from(secret, 'base64'),
];

describe('a second start reads the secret the first one made (#2781, ADR 0080 D-4)', () => {
  it('serves the same instance card and identity key on both starts, from one secret file', async () => {
    const at = await box();
    const first = await start(at, []);
    const before = await pinned(first.instance);
    await stop();
    const second = await start(at, []);
    expect(second.secret).toBe(first.secret);
    expect(await pinned(second.instance)).toEqual(before);
    expect(await readdir(at.secrets)).toEqual([SECRET_FILES.OYL_INSTANCE_SECRET_KEY]);
  });
});

describe('where the made secret never is (#2781)', () => {
  it('not anywhere in the data the backups copy, in any spelling, after the instance made its keys under it', async () => {
    const at = await box();
    const { secret } = await start(at, []);
    await stop();
    const files = await everyFile(at.data);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      for (const spelling of spellings(secret)) expect(file.includes(spelling)).toBe(false);
    }
  });

  it('not in any log line, nor in the operator log, after the emergency kit is downloaded over the loopback listener', async () => {
    const at = await box();
    const lines: string[] = [];
    const { secret } = await start(at, lines);
    const browser = adminBrowser(overHttp(`http://127.0.0.1:${String(at.loopback)}`), {
      loopback: at.loopback,
    });
    const session = await passkeySessionOn(
      browser,
      { database: at.database, blobs: at.blobs },
      () => new Date(),
    );
    const form = await steppedUpForm(
      browser,
      session,
      'emergency_kit',
      {},
      { page: '/admin/keys' },
    );
    const kit = await browser.send('POST', '/admin/keys/emergency-kit', {
      cookie: session.token,
      form,
    });
    expect(kit.status).toBe(200);
    // The kit is where the secret IS: the same one the file holds.
    expect(await kit.text()).toContain(`OYL_INSTANCE_SECRET_KEY=${secret}`);
    await stop();

    const said = lines.join('\n');
    expect(lines.length).toBeGreaterThan(5);
    expect(said).not.toContain(secret);
    expect(said).not.toContain(Buffer.from(secret, 'base64').toString('hex'));
    expect(lines.filter((line) => line.includes('"event":"secret"'))).toEqual([
      JSON.stringify({ event: 'secret', variable: 'OYL_INSTANCE_SECRET_KEY', from: 'generated' }),
    ]);

    const store = await openSqlStore(at.database);
    try {
      const entries = await store.listOperatorLogPage(undefined, 200);
      expect(entries.map((entry) => entry.action)).toContain('emergency_kit_downloaded');
      expect(JSON.stringify(entries)).not.toContain(secret);
    } finally {
      await store.close();
    }
  });
});

describe('the operator’s commands read the same file (#2781)', () => {
  it('`instance-key show` in a child process, with the secrets folder and no secret in its environment, shows the running instance’s card', async () => {
    const at = await box();
    const { instance } = await start(at, []);
    const { card } = await pinned(instance);
    await stop();
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      OYL_INSTANCE_DATABASE: at.database,
      OYL_INSTANCE_BLOBS: at.blobs,
      OYL_INSTANCE_ORIGIN: TEST_ORIGIN,
      OYL_INSTANCE_SECRETS_DIR: at.secrets,
    };
    delete env.OYL_INSTANCE_SECRET_KEY;
    const shown = spawnSync(process.execPath, [CLI, 'instance-key', 'show'], {
      cwd: INSTANCE,
      encoding: 'utf8',
      env,
      timeout: CHILD_WAIT_MS,
    });
    expect(shown.status, shown.stderr).toBe(0);
    expect((JSON.parse(shown.stdout) as { card: string }).card).toBe(card);
  });
});

describe('the entry point makes and uses the secret (#2781, serve.ts)', () => {
  it('`node src/main.ts` with the secrets folder and no secret in its environment makes the file, serves keys under it, and prints no secret', async () => {
    const at = await box();
    const port = await freeLoopbackPort();
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      OYL_INSTANCE_COMMIT: COMMIT,
      OYL_INSTANCE_PORT: String(port),
      OYL_INSTANCE_DATABASE: at.database,
      OYL_INSTANCE_BLOBS: at.blobs,
      OYL_INSTANCE_ORIGIN: TEST_ORIGIN,
      OYL_INSTANCE_ROOM_WORKERS: '1',
      OYL_INSTANCE_SECRETS_DIR: at.secrets,
    };
    delete env.OYL_INSTANCE_SECRET_KEY;
    const child = spawn(process.execPath, [MAIN], {
      cwd: INSTANCE,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let printed = '';
    child.stdout.on('data', (chunk: Buffer) => (printed += chunk.toString('utf8')));
    child.stderr.on('data', (chunk: Buffer) => (printed += chunk.toString('utf8')));
    const exited = new Promise<void>((done) => child.on('exit', () => done()));
    let served: Response | undefined;
    try {
      const url = `http://127.0.0.1:${String(port)}`;
      for (let i = 0; ; i += 1) {
        const ready = await fetch(`${url}/ready`).catch(() => undefined);
        if (ready?.status === 200) break;
        if (i > 60) throw new Error(`the instance did not become ready: ${printed}`);
        await new Promise((done) => setTimeout(done, 50));
      }
      served = await fetch(`${url}/v1/instance/keys`);
    } finally {
      child.kill('SIGTERM');
      await exited;
    }
    // Keys are served only under a secret: this one came from the file alone.
    expect(served.status).toBe(200);
    const path = join(at.secrets, SECRET_FILES.OYL_INSTANCE_SECRET_KEY);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    const secret = (await readFile(path, 'utf8')).trim();
    expect(printed).toContain(
      '"event":"secret","variable":"OYL_INSTANCE_SECRET_KEY","from":"generated"',
    );
    expect(printed).not.toContain(secret);
  });
});
