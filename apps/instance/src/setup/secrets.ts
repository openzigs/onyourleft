// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The instance's secrets, made on its first start** (#2781, ADR 0080 D-4):
 * `OYL_INSTANCE_SECRET_KEY` always, and `OYL_INSTANCE_METRICS_TOKEN` when
 * metrics are on, so that a fresh install needs no `openssl rand` and no
 * `.env` edit.
 *
 * - **The environment wins.** A variable that is set is used as it is, and
 *   no file is read or written for it: an existing install is unchanged.
 * - **Otherwise, a file in `OYL_INSTANCE_SECRETS_DIR`** — one per secret,
 *   {@link SECRET_FILES} — read on every start and made only when it is not
 *   there: 32 bytes from the platform's cryptographic generator, written to a
 *   temporary file created owner-only (`0600`) and renamed into place, so a
 *   crash leaves the old state or the whole file and never half of one. The
 *   value used is the one READ BACK from the file, so the second start uses
 *   exactly what the first one did. With no directory set, nothing is made
 *   and an unset secret stays unset, as before #2781.
 * - **Never the data volume.** The `backup` service copies the database's
 *   folder and the blobs off the box; a snapshot holds the instance's keys
 *   wrapped under the secret, so the secret beside them would make a copy the
 *   instance's identity. A directory inside either is a refusal to start.
 * - **Owner-only, or a refusal to start** that names the file and never
 *   what it holds. ⚠️ A filesystem that keeps no permission bits — a Windows
 *   folder bind-mounted by Docker Desktop reports every file as everyone's —
 *   would refuse every start, so a file that looks open is checked against a
 *   probe made `0600` in the same folder: when the probe looks open too, the
 *   folder cannot show permissions, the start goes on, and the log says so
 *   (`permissions: 'not-kept'`). There the folder's own access on the host is
 *   what keeps the secret, and docs/operating-an-instance.md says so.
 * - **Nothing here writes a secret anywhere but its file**: a problem names
 *   the variable and the file, a log line the variable and where it came
 *   from, and an error's own message is dropped.
 */

import { randomBytes } from 'node:crypto';
import { mkdir, open, readFile, rename, stat, unlink } from 'node:fs/promises';
import { dirname, join, relative, resolve, isAbsolute } from 'node:path';

import { readSecretKey } from '../analysis/hosted-key.ts';
import { logEvent, type LogSink } from '../log.ts';
import { DEFAULT_BLOBS_PATH, DEFAULT_DATABASE_PATH, METRICS_TOKEN } from '../server-config.ts';

/** The secrets this module may make, and the file each is kept in. */
export const SECRET_FILES = {
  OYL_INSTANCE_SECRET_KEY: 'instance-secret-key',
  OYL_INSTANCE_METRICS_TOKEN: 'metrics-token',
} as const;

export type SecretVariable = keyof typeof SECRET_FILES;

/** How many random bytes each secret is made from. */
export const SECRET_BYTES = 32;

/** A secret read from its file in the secrets directory: what the emergency kit holds. */
export interface SecretFromFile {
  readonly variable: SecretVariable;
  /** The file's name in the directory. */
  readonly file: string;
  /** The secret, as `.env` would spell it. */
  readonly text: string;
  /** Whether this start made it. */
  readonly generated: boolean;
}

/** The raw values, as `serve.ts` reads them from the environment. */
export interface RawSecrets {
  /** `OYL_INSTANCE_SECRETS_DIR`. */
  readonly directory?: string | undefined;
  readonly secretKey?: string | undefined;
  readonly metricsToken?: string | undefined;
  /** `OYL_INSTANCE_METRICS`: a token is made only when it is `on`. */
  readonly metrics?: string | undefined;
  /** `OYL_INSTANCE_DATABASE` and `OYL_INSTANCE_BLOBS`: the data the backups copy. */
  readonly database?: string | undefined;
  readonly blobs?: string | undefined;
}

export type SecretsResult =
  | {
      readonly ok: true;
      /** What `readServerConfig` is handed in place of the environment's. */
      readonly secretKey: string | undefined;
      readonly metricsToken: string | undefined;
      /** Every secret that came from a file, in {@link SECRET_FILES}' order. */
      readonly fromFiles: readonly SecretFromFile[];
    }
  | { readonly ok: false; readonly problems: readonly string[] };

export interface SecretsOptions {
  readonly log: LogSink;
  /**
   * Whether a missing file is made: the instance's start, `true`. The
   * operator's CLI (`operator/cli.ts`) reads the files and never makes one,
   * so a command run before the first start does not choose the secret.
   */
  readonly generate?: boolean;
  /** The generator: `node:crypto`'s unless a test says otherwise. */
  readonly random?: (bytes: number) => Uint8Array;
  /** A file's permission bits: `stat`'s unless a test stands in a filesystem that keeps none. */
  readonly modeOf?: (path: string) => Promise<number>;
}

const present = (value: string | undefined): value is string =>
  value !== undefined && value.trim() !== '';

const fileMode = async (path: string): Promise<number> => (await stat(path)).mode & 0o777;

/** Whether `inner` is `outer` or inside it. */
function within(inner: string, outer: string): boolean {
  const path = relative(outer, inner);
  return path === '' || (!path.startsWith('..') && !isAbsolute(path));
}

function base64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

const hex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

/** A secret made new: the key as `openssl rand -base64 32` spells one, the token as hex. */
function made(variable: SecretVariable, bytes: Uint8Array): string {
  return variable === 'OYL_INSTANCE_SECRET_KEY' ? base64(bytes) : hex(bytes);
}

function wellFormed(variable: SecretVariable, text: string): boolean {
  return variable === 'OYL_INSTANCE_SECRET_KEY'
    ? readSecretKey(text).kind === 'ok'
    : METRICS_TOKEN.test(text);
}

const errorCode = (error: unknown): string | undefined =>
  typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
    ? error.code
    : undefined;

/**
 * Whether `directory` keeps permission bits: a probe file created `0600`
 * there, read back, and removed. `undefined` when no probe could be made.
 */
async function keepsPermissions(
  directory: string,
  modeOf: (path: string) => Promise<number>,
  random: (bytes: number) => Uint8Array,
): Promise<boolean | undefined> {
  const probe = join(directory, `.permission-probe-${hex(random(8))}`);
  try {
    const handle = await open(probe, 'wx', 0o600);
    await handle.close();
    return ((await modeOf(probe)) & 0o077) === 0;
  } catch {
    return undefined;
  } finally {
    await unlink(probe).catch(() => undefined);
  }
}

/**
 * Write `text` to `path`, never in part: a new `0600` file beside it, renamed
 * into place. The setup code's file is written the same way (#2784).
 */
export async function writeWhole(
  path: string,
  text: string,
  random: (bytes: number) => Uint8Array,
): Promise<void> {
  const temporary = join(dirname(path), `.${hex(random(8))}.tmp`);
  const handle = await open(temporary, 'wx', 0o600);
  try {
    try {
      await handle.writeFile(`${text}\n`);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, path);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

/**
 * The secrets the instance starts with (#2781, ADR 0080 D-4): each from the
 * environment, else from its file in `OYL_INSTANCE_SECRETS_DIR`, made there
 * first if it is not — or why the instance must not start. Every problem is
 * reported, as `readServerConfig` reports its own.
 */
export async function resolveSecrets(
  raw: RawSecrets,
  options: SecretsOptions,
): Promise<SecretsResult> {
  const random = options.random ?? ((bytes: number) => new Uint8Array(randomBytes(bytes)));
  const modeOf = options.modeOf ?? fileMode;
  const metricsOn = present(raw.metrics) && raw.metrics.trim().toLowerCase() === 'on';
  const fromEnvironment: Record<SecretVariable, string | undefined> = {
    OYL_INSTANCE_SECRET_KEY: raw.secretKey,
    OYL_INSTANCE_METRICS_TOKEN: raw.metricsToken,
  };
  const wanted = (Object.keys(SECRET_FILES) as SecretVariable[]).filter(
    (variable) =>
      !present(fromEnvironment[variable]) && (variable === 'OYL_INSTANCE_SECRET_KEY' || metricsOn),
  );
  const unchanged = {
    ok: true,
    secretKey: raw.secretKey,
    metricsToken: raw.metricsToken,
    fromFiles: [],
  } as const;
  if (!present(raw.directory) || wanted.length === 0) return unchanged;

  const directory = resolve(raw.directory.trim());
  const data = [
    dirname(resolve(present(raw.database) ? raw.database.trim() : DEFAULT_DATABASE_PATH)),
    resolve(present(raw.blobs) ? raw.blobs.trim() : DEFAULT_BLOBS_PATH),
  ];
  if (data.some((each) => within(directory, each))) {
    return {
      ok: false,
      problems: [
        'OYL_INSTANCE_SECRETS_DIR must not be inside the database’s folder or the blobs: the backups copy those off the box, and a copy holding the secret beside the keys it opens is the instance’s identity.',
      ],
    };
  }

  const problems: string[] = [];
  const fromFiles: SecretFromFile[] = [];
  let permissionsKept: boolean | undefined;
  for (const variable of wanted) {
    const file = SECRET_FILES[variable];
    const path = join(directory, file);
    let generated = false;
    let text: string | undefined;
    try {
      text = await readFile(path, 'utf8');
    } catch (error) {
      if (errorCode(error) !== 'ENOENT') {
        problems.push(
          `${path} holds ${variable} and could not be read: it must be readable by the user the instance runs as.`,
        );
        continue;
      }
    }
    if (text === undefined && options.generate === false) continue;
    if (text === undefined) {
      try {
        await mkdir(directory, { recursive: true, mode: 0o700 });
        await writeWhole(path, made(variable, random(SECRET_BYTES)), random);
        text = await readFile(path, 'utf8');
        generated = true;
      } catch {
        problems.push(
          `${variable} is not set, and its file could not be made in ${directory}: the folder must be writable by the user the instance runs as (docs/operating-an-instance.md, "The instance’s secrets").`,
        );
        continue;
      }
    }
    if (((await modeOf(path)) & 0o077) !== 0) {
      permissionsKept ??= await keepsPermissions(directory, modeOf, random);
      if (permissionsKept !== false) {
        problems.push(
          `${path} holds ${variable} and can be read by others than its owner: make it owner-only (chmod 600) and start again.`,
        );
        continue;
      }
    }
    const trimmed = text.trim();
    if (!wellFormed(variable, trimmed)) {
      problems.push(
        `${path} does not hold a ${variable} the instance can use: restore it from the emergency kit, or set ${variable} in .env (docs/operating-an-instance.md, "The instance’s secrets").`,
      );
      continue;
    }
    fromFiles.push({ variable, file, text: trimmed, generated });
  }
  if (problems.length > 0) return { ok: false, problems };

  for (const each of fromFiles) {
    logEvent(options.log, 'secret', {
      variable: each.variable,
      from: each.generated ? 'generated' : 'file',
      ...(permissionsKept === false ? { permissions: 'not-kept' } : {}),
    });
  }
  const textOf = (variable: SecretVariable): string | undefined =>
    fromFiles.find((each) => each.variable === variable)?.text ?? fromEnvironment[variable];
  return {
    ok: true,
    secretKey: textOf('OYL_INSTANCE_SECRET_KEY'),
    metricsToken: textOf('OYL_INSTANCE_METRICS_TOKEN'),
    fromFiles,
  };
}
