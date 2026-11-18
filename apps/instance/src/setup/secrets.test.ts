// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The secrets folder (#2781, ADR 0080 D-4), on a real temporary directory:
 * a secret made once and read back the same on every later start, owner-only
 * or a refusal that names the file and never its content, the environment
 * winning with nothing written, never inside the data the backups copy, and
 * no secret in any log line or problem.
 */

import { chmod, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { secretText } from '../analysis/hosted-key-testing.ts';
import { readSecretKey } from '../analysis/hosted-key.ts';
import { readServerConfig } from '../server-config.ts';
import { resolveSecrets, SECRET_FILES, type RawSecrets, type SecretsOptions } from './secrets.ts';

let directory: string | undefined;
afterEach(async () => {
  if (directory !== undefined) {
    await chmod(directory, 0o700).catch(() => undefined);
    await rm(directory, { recursive: true, force: true });
  }
  directory = undefined;
});

interface Box {
  readonly secrets: string;
  readonly raw: RawSecrets;
}

/** A box with its data and an EMPTY secrets folder beside it, as the home deployment has them. */
async function box(over: Partial<RawSecrets> = {}): Promise<Box> {
  directory = await mkdtemp(join(tmpdir(), 'oyl-secrets-'));
  const secrets = join(directory, 'secrets');
  await mkdir(secrets, { mode: 0o700 });
  await mkdir(join(directory, 'data'));
  return {
    secrets,
    raw: {
      directory: secrets,
      database: join(directory, 'data', 'instance.sqlite'),
      blobs: join(directory, 'data', 'blobs'),
      ...over,
    },
  };
}

/** {@link resolveSecrets}, with every log line kept. */
async function resolved(raw: RawSecrets, options: Partial<SecretsOptions> = {}) {
  const lines: string[] = [];
  const result = await resolveSecrets(raw, { log: (line) => lines.push(line), ...options });
  return { result, lines };
}

const KEY_FILE = SECRET_FILES.OYL_INSTANCE_SECRET_KEY;
const TOKEN_FILE = SECRET_FILES.OYL_INSTANCE_METRICS_TOKEN;

describe('made on the first start, read back the same on the next (#2781, ADR 0080 D-4)', () => {
  it('makes a 32-byte base64 secret key in its file, and the second start reads exactly it and makes nothing new', async () => {
    const { secrets, raw } = await box();
    const first = await resolved(raw);
    if (!first.result.ok) throw new Error(first.result.problems.join(' '));
    const written = (await readFile(join(secrets, KEY_FILE), 'utf8')).trim();
    expect(readSecretKey(written).kind).toBe('ok');
    expect(first.result.secretKey).toBe(written);
    expect(first.result.fromFiles).toEqual([
      { variable: 'OYL_INSTANCE_SECRET_KEY', file: KEY_FILE, text: written, generated: true },
    ]);
    // The configuration the instance starts with is the file's secret.
    const config = readServerConfig({ secretKey: first.result.secretKey }, 1);
    if (!config.ok) throw new Error(config.problems.join(' '));
    expect(config.config.secretKey).toEqual(Uint8Array.from(atob(written), (c) => c.charCodeAt(0)));

    const second = await resolved(raw);
    if (!second.result.ok) throw new Error(second.result.problems.join(' '));
    expect(second.result.secretKey).toBe(written);
    expect(second.result.fromFiles[0]?.generated).toBe(false);
    // Nothing else was left in the folder: no temporary file, no probe.
    expect(await readdir(secrets)).toEqual([KEY_FILE]);
    expect(first.lines.map((line) => JSON.parse(line) as unknown)).toEqual([
      { event: 'secret', variable: 'OYL_INSTANCE_SECRET_KEY', from: 'generated' },
    ]);
    expect(second.lines.map((line) => JSON.parse(line) as unknown)).toEqual([
      { event: 'secret', variable: 'OYL_INSTANCE_SECRET_KEY', from: 'file' },
    ]);
  });

  it('creates the file owner-only, 0600', async () => {
    const { secrets, raw } = await box();
    const { result } = await resolved(raw);
    expect(result.ok).toBe(true);
    expect((await stat(join(secrets, KEY_FILE))).mode & 0o777).toBe(0o600);
  });

  it('makes a folder that is not there yet, owner-only', async () => {
    const { secrets, raw } = await box();
    await rm(secrets, { recursive: true });
    const { result } = await resolved(raw);
    expect(result.ok).toBe(true);
    expect((await stat(secrets)).mode & 0o777).toBe(0o700);
    expect(await readdir(secrets)).toEqual([KEY_FILE]);
  });

  it('makes a metrics token only with metrics on, and the instance accepts it', async () => {
    const off = await box();
    const { result: without } = await resolved(off.raw);
    expect(without.ok && without.metricsToken).toBeUndefined();
    expect(await readdir(off.secrets)).toEqual([KEY_FILE]);
    await rm(directory as string, { recursive: true, force: true });

    const on = await box({ metrics: ' ON ' });
    const { result } = await resolved(on.raw);
    if (!result.ok) throw new Error(result.problems.join(' '));
    expect(result.metricsToken).toMatch(/^[0-9a-f]{64}$/);
    expect((await readFile(join(on.secrets, TOKEN_FILE), 'utf8')).trim()).toBe(result.metricsToken);
    expect(result.fromFiles.map((each) => each.variable)).toEqual([
      'OYL_INSTANCE_SECRET_KEY',
      'OYL_INSTANCE_METRICS_TOKEN',
    ]);
    const config = readServerConfig(
      { metrics: 'on', metricsToken: result.metricsToken, secretKey: result.secretKey },
      1,
    );
    expect(config.ok).toBe(true);
  });

  it('draws each secret from the generator: two folders get two different secrets', async () => {
    const one = await box();
    const { result: a } = await resolved(one.raw);
    await rm(directory as string, { recursive: true, force: true });
    const two = await box();
    const { result: b } = await resolved(two.raw);
    expect(a.ok && b.ok).toBe(true);
    expect(a.ok && a.secretKey).not.toBe(b.ok && b.secretKey);
  });
});

describe('the environment wins, and no file is written (#2781)', () => {
  it('uses a secret key and a token set in .env, and leaves the folder empty', async () => {
    const env = { secretKey: secretText(3), metricsToken: 'm'.repeat(40), metrics: 'on' };
    const { secrets, raw } = await box(env);
    const { result, lines } = await resolved(raw);
    expect(result).toEqual({
      ok: true,
      secretKey: env.secretKey,
      metricsToken: env.metricsToken,
      fromFiles: [],
    });
    expect(await readdir(secrets)).toEqual([]);
    expect(lines).toEqual([]);
  });

  it('uses .env over a file that holds another secret', async () => {
    const { secrets, raw } = await box();
    await writeFile(join(secrets, KEY_FILE), `${secretText(9)}\n`, { mode: 0o600 });
    const { result } = await resolved({ ...raw, secretKey: secretText(4) });
    expect(result.ok && result.secretKey).toBe(secretText(4));
    expect(result.ok && result.fromFiles).toEqual([]);
  });

  it('with no secrets folder named, makes nothing and leaves an unset secret unset', async () => {
    const { secrets, raw } = await box({ directory: undefined });
    const { result } = await resolved(raw);
    expect(result).toEqual({
      ok: true,
      secretKey: undefined,
      metricsToken: undefined,
      fromFiles: [],
    });
    expect(await readdir(secrets)).toEqual([]);
  });

  it('the operator’s commands read the file and never make one', async () => {
    const { secrets, raw } = await box();
    const { result: none } = await resolved(raw, { generate: false });
    expect(none).toEqual({
      ok: true,
      secretKey: undefined,
      metricsToken: undefined,
      fromFiles: [],
    });
    expect(await readdir(secrets)).toEqual([]);
    await resolved(raw);
    const { result: read } = await resolved(raw, { generate: false });
    expect(read.ok && read.secretKey).toBe(
      (await readFile(join(secrets, KEY_FILE), 'utf8')).trim(),
    );
  });
});

describe('owner-only, or the instance refuses to start (#2781)', () => {
  it('refuses a file others can read, naming the file and never its content', async () => {
    const { secrets, raw } = await box();
    const { result: made } = await resolved(raw);
    const secret = made.ok ? (made.secretKey ?? '') : '';
    await chmod(join(secrets, KEY_FILE), 0o644);
    const { result, lines } = await resolved(raw);
    expect(result.ok).toBe(false);
    const problems = result.ok ? [] : result.problems;
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(join(secrets, KEY_FILE));
    expect(problems[0]).toContain('chmod 600');
    expect(problems.join(' ')).not.toContain(secret);
    expect(lines).toEqual([]);
  });

  it('refuses a group-readable file too', async () => {
    const { secrets, raw } = await box();
    await resolved(raw);
    await chmod(join(secrets, KEY_FILE), 0o640);
    const { result } = await resolved(raw);
    expect(result.ok).toBe(false);
  });

  it('on a folder that keeps no permission bits — every file reads as everyone’s — starts, and says so', async () => {
    const { secrets, raw } = await box();
    const everyones = (): Promise<number> => Promise.resolve(0o777);
    const { result, lines } = await resolved(raw, { modeOf: everyones });
    if (!result.ok) throw new Error(result.problems.join(' '));
    expect(lines.map((line) => JSON.parse(line) as unknown)).toEqual([
      {
        event: 'secret',
        variable: 'OYL_INSTANCE_SECRET_KEY',
        from: 'generated',
        permissions: 'not-kept',
      },
    ]);
    // The probe it made to find that out is gone.
    expect(await readdir(secrets)).toEqual([KEY_FILE]);
  });
});

describe('never inside the data the backups copy (#2781, ADR 0080 D-4)', () => {
  it.each([
    ['the database’s folder', (root: string) => join(root, 'data')],
    ['a folder inside it', (root: string) => join(root, 'data', 'secrets')],
    ['the blobs', (root: string) => join(root, 'data', 'blobs', 'secrets')],
  ])('refuses %s, and writes nothing there', async (_name, place) => {
    const { raw } = await box();
    const inside = place(directory as string);
    const { result } = await resolved({ ...raw, directory: inside });
    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.problems.join(' ')).toContain('OYL_INSTANCE_SECRETS_DIR');
    const files = await readdir(join(directory as string, 'data'), { recursive: true });
    expect(files.filter((name) => name.includes(KEY_FILE))).toEqual([]);
  });

  it('takes a folder beside the data whose name only starts like it', async () => {
    const { raw } = await box();
    const { result } = await resolved({
      ...raw,
      directory: join(directory as string, 'data-secrets'),
    });
    expect(result.ok).toBe(true);
  });
});

describe('a file it cannot use is a refusal, never a new secret (#2781)', () => {
  it('refuses a file that is not a secret key, naming the file and not what it holds', async () => {
    const { secrets, raw } = await box();
    await writeFile(join(secrets, KEY_FILE), 'not-a-secret-at-all\n', { mode: 0o600 });
    const { result } = await resolved(raw);
    expect(result.ok).toBe(false);
    const said = result.ok ? '' : result.problems.join(' ');
    expect(said).toContain(join(secrets, KEY_FILE));
    expect(said).not.toContain('not-a-secret-at-all');
    expect(await readFile(join(secrets, KEY_FILE), 'utf8')).toBe('not-a-secret-at-all\n');
  });

  it('refuses a folder it cannot write, naming the folder', async () => {
    const { secrets, raw } = await box();
    await chmod(secrets, 0o500);
    const { result } = await resolved(raw);
    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.problems.join(' ')).toContain(secrets);
  });

  it('refuses a file it cannot read', async () => {
    const { secrets, raw } = await box();
    await mkdir(join(secrets, KEY_FILE));
    const { result } = await resolved(raw);
    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.problems.join(' ')).toContain('could not be read');
  });
});
