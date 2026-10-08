// SPDX-License-Identifier: AGPL-3.0-or-later

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { cp, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { PHYSICS_VERSION, type RidingPosition } from '@onyourleft/physics';

import {
  HOSTED_KEY_UNREADABLE,
  hostedKeyFrom,
  hostedKeyState,
  hostedUrlFrom,
  importSecretKey,
  readSecretKey,
  sealHostedKey,
  SECRET_KEY_MALFORMED,
  type SecretKey,
} from '../analysis/hosted-key.ts';
import {
  createInstanceKeys,
  InstanceKeysUnavailable,
  NO_KEYS_SENTENCE,
  type InstanceKeys,
} from '../keys/instance-keys.ts';
import { readServerConfig } from '../server-config.ts';
import { integrityOk, rowCounts, vacuumInto } from '../store/backup.ts';
import { migrateForDeploy, openServingStore } from '../store/serving.ts';

/**
 * What an operator runs against an instance's data (#791, #807, #52) —
 * `node src/operator/cli.ts <command>`, in the image and on a clone alike.
 *
 * | Command | Does |
 * |---|---|
 * | `migrate` | the deploy's migrate step: every migration not applied, with the marker a starting instance waits on (`store/serving.ts`) |
 * | `backup <directory> [--keep N] [--copy-to <directory>]` | an online snapshot — `VACUUM INTO` and the blob directory — into a new timestamped directory, with a manifest of what it holds; the oldest beyond `--keep` removed; and the snapshot copied to a second place (a USB drive, a share) |
 * | `restore <snapshot directory> [--force]` | the snapshot back into place, checked: SQLite's integrity check, every row count and blob count against the manifest, every blob's content against its name |
 * | `verify` | the row counts and the blob count of the data in place — what a restore on another machine is compared with |
 * | `room-open <roomId> --kind ride\|race --length <metres> [--grade <percent>] [--position hoods\|drops\|upright] [--countdown <ms>]` | a room and its course, until #784 and #785 let a rider make one |
 * | `model-key set --url https://… --model <name>` | the instance's one hosted model key, read from standard input, sealed under `OYL_INSTANCE_SECRET_KEY`, held for the operator: the athlete whose device holds `OYL_INSTANCE_OWNER_KEY` (#1097, ADR 0046 Q9) |
 * | `model-key status` | the hosted key's URL and model, that a key is held, and whether this secret opens it — never the key |
 * | `model-key clear` | the hosted key gone, scrubbed from the database's free pages and its log |
 *
 * ⚠️ `restore` ends by ROTATING the encryption key (#1189, ADR 0047 D-5),
 * once the data is checked and in place, so a restored instance never serves
 * a key older than one a device has already seen; the identity key comes back
 * unchanged, so every pin holds. It needs `OYL_INSTANCE_SECRET_KEY` and
 * `OYL_INSTANCE_ORIGIN` for that, and says so when either is missing.
 *
 * ⚠️ `restore` writes where the instance keeps its data: **stop the
 * instance first** (`docs/operating-an-instance.md`). It refuses to write over
 * a database that is there unless told `--force`.
 *
 * Every command prints ONE JSON object, so a scheduled run's log is a record,
 * and names no row's contents — counts and times only.
 */

export interface DataPaths {
  readonly database: string;
  readonly blobs: string;
}

export class CommandError extends Error {
  override readonly name = 'CommandError';
}

export const MANIFEST = 'manifest.json';
export const DATABASE_FILE = 'instance.sqlite';
export const BLOBS_DIRECTORY = 'blobs';

export interface Manifest {
  readonly takenAt: string;
  readonly rows: Readonly<Record<string, number>>;
  readonly blobs: number;
  readonly databaseSha256: string;
}

async function filesUnder(root: string): Promise<string[]> {
  if (!existsSync(root)) return [];
  const found: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true, recursive: true })) {
    if (entry.isFile()) found.push(join(entry.parentPath, entry.name));
  }
  return found.sort();
}

/** The blobs under a blob store's root: its `objects/` tree (`blob/disk-blob-store.ts`). */
async function blobFiles(root: string): Promise<string[]> {
  return filesUnder(join(root, 'objects'));
}

async function sha256Of(path: string): Promise<string> {
  return createHash('sha256')
    .update(await readFile(path))
    .digest('hex');
}

function stamp(at: Date): string {
  return at.toISOString().replace(/[:.]/g, '-');
}

export async function migrate(paths: DataPaths) {
  await mkdir(dirname(paths.database), { recursive: true });
  const started = performance.now();
  const report = await migrateForDeploy(paths.database);
  return { command: 'migrate', ...report, ms: Math.round(performance.now() - started) };
}

export async function backup(
  paths: DataPaths,
  destination: string,
  options: { readonly keep?: number; readonly copyTo?: string; readonly now?: () => Date } = {},
) {
  if (!existsSync(paths.database)) throw new CommandError('There is no database to back up.');
  if (options.keep !== undefined && (!Number.isInteger(options.keep) || options.keep < 1)) {
    throw new CommandError('--keep is a whole number of snapshots, 1 or more.');
  }
  const started = performance.now();
  const at = (options.now ?? (() => new Date()))();
  const snapshot = join(destination, `snapshot-${stamp(at)}`);
  await mkdir(snapshot, { recursive: true });
  const database = join(snapshot, DATABASE_FILE);
  vacuumInto(paths.database, database);
  const blobs = await blobFiles(paths.blobs);
  if (blobs.length > 0) {
    await cp(join(paths.blobs, 'objects'), join(snapshot, BLOBS_DIRECTORY, 'objects'), {
      recursive: true,
    });
  }
  const manifest: Manifest = {
    takenAt: at.toISOString(),
    rows: rowCounts(database),
    blobs: blobs.length,
    databaseSha256: await sha256Of(database),
  };
  await writeFile(join(snapshot, MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`);

  let copiedTo: string | null = null;
  if (options.copyTo !== undefined) {
    copiedTo = join(options.copyTo, `snapshot-${stamp(at)}`);
    await cp(snapshot, copiedTo, { recursive: true });
  }
  const removed: string[] = [];
  if (options.keep !== undefined) {
    for (const place of [destination, ...(options.copyTo === undefined ? [] : [options.copyTo])]) {
      const snapshots = (await readdir(place))
        .filter((name) => name.startsWith('snapshot-'))
        .sort();
      for (const old of snapshots.slice(0, Math.max(0, snapshots.length - options.keep))) {
        await rm(join(place, old), { recursive: true, force: true });
        removed.push(old);
      }
    }
  }
  return {
    command: 'backup',
    snapshot,
    copiedTo,
    rows: manifest.rows,
    blobs: manifest.blobs,
    removed: removed.length,
    ms: Math.round(performance.now() - started),
  };
}

export async function verify(paths: DataPaths) {
  if (!existsSync(paths.database)) throw new CommandError('There is no database to verify.');
  return {
    command: 'verify',
    integrity: integrityOk(paths.database),
    rows: rowCounts(paths.database),
    blobs: (await blobFiles(paths.blobs)).length,
  };
}

export async function restore(
  paths: DataPaths,
  snapshot: string,
  options: {
    readonly force?: boolean;
    /** `OYL_INSTANCE_SECRET_KEY` and `OYL_INSTANCE_ORIGIN`, for the rotation it ends with (#1189). */
    readonly keys?: KeyEnvironment;
  } = {},
) {
  const started = performance.now();
  const manifestPath = join(snapshot, MANIFEST);
  if (!existsSync(manifestPath))
    throw new CommandError('That is not a snapshot: it has no manifest.');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Manifest;
  const source = join(snapshot, DATABASE_FILE);
  if ((await sha256Of(source)) !== manifest.databaseSha256) {
    throw new CommandError('The snapshot’s database is not the one its manifest describes.');
  }
  if (existsSync(paths.database) && options.force !== true) {
    throw new CommandError(
      'There is a database in place already. Stop the instance, and pass --force to replace it.',
    );
  }
  // Built and CHECKED beside the live data, and only then moved into place:
  // a restore that does not match its snapshot leaves the data exactly as it
  // was (#895's review, N1), which is what `deploy.sh` tells an operator.
  await mkdir(dirname(paths.database), { recursive: true });
  const stagedDatabase = `${paths.database}.restoring`;
  const stagedBlobs = `${paths.blobs}.restoring`;
  for (const suffix of ['', '-wal', '-shm'])
    await rm(`${stagedDatabase}${suffix}`, { force: true });
  await rm(stagedBlobs, { recursive: true, force: true });
  await cp(source, stagedDatabase);
  const blobSource = join(snapshot, BLOBS_DIRECTORY, 'objects');
  await mkdir(join(stagedBlobs, 'objects'), { recursive: true });
  if (existsSync(blobSource)) {
    await cp(blobSource, join(stagedBlobs, 'objects'), { recursive: true });
  }

  // Judged, not assumed: SQLite's own check, every count, every blob's content.
  const integrity = integrityOk(stagedDatabase);
  const rows = rowCounts(stagedDatabase);
  const blobs = await blobFiles(stagedBlobs);
  const mismatched: string[] = [];
  for (const blob of blobs) {
    const name = blob.split(/[\\/]/).at(-1) ?? '';
    if ((await sha256Of(blob)) !== name) mismatched.push(name.slice(0, 12));
  }
  const rowsMatch = JSON.stringify(rows) === JSON.stringify(manifest.rows);
  const blobsMatch = blobs.length === manifest.blobs && mismatched.length === 0;
  if (!integrity || !rowsMatch || !blobsMatch) {
    for (const suffix of ['', '-wal', '-shm'])
      await rm(`${stagedDatabase}${suffix}`, { force: true });
    await rm(stagedBlobs, { recursive: true, force: true });
    throw new CommandError(
      `The restore does not match its snapshot: integrity ${String(integrity)}, rows ${String(rowsMatch)}, blobs ${String(blobsMatch)}. Nothing in place was changed.`,
    );
  }
  // Into place: the database by a rename, and the blob directory REPLACED —
  // not merged, so a blob the snapshot does not hold is not left behind.
  for (const suffix of ['', '-wal', '-shm'])
    await rm(`${paths.database}${suffix}`, { force: true });
  await rename(stagedDatabase, paths.database);
  await rm(paths.blobs, { recursive: true, force: true });
  await rename(stagedBlobs, paths.blobs);
  return {
    command: 'restore',
    takenAt: manifest.takenAt,
    integrity,
    rows,
    blobs: blobs.length,
    keys: await rotateAfterRestore(paths, options.keys ?? {}),
    ms: Math.round(performance.now() - started),
  };
}

/** What the instance-key commands and `restore` read from the environment (#1189). */
export interface KeyEnvironment {
  /** `OYL_INSTANCE_SECRET_KEY`. */
  readonly secret?: string | undefined;
  /** `OYL_INSTANCE_ORIGIN`. */
  readonly origin?: string | undefined;
  /** The box's clock, Unix seconds; the real one unless a test's. */
  readonly now?: () => number;
}

/** The secret's bytes and the origin, or a refusal naming the variable — never its value. */
function keyEnvironment(environment: KeyEnvironment): {
  readonly secret: Uint8Array | undefined;
  readonly origin: string | null;
} {
  const read = readSecretKey(environment.secret);
  if (read.kind === 'malformed') throw new CommandError(SECRET_KEY_MALFORMED);
  const config = readServerConfig({ origin: environment.origin }, 1);
  if (!config.ok) throw new CommandError(config.problems.join(' '));
  return { secret: read.kind === 'ok' ? read.bytes : undefined, origin: config.config.origin };
}

async function withInstanceKeys<T>(
  paths: DataPaths,
  environment: KeyEnvironment,
  operation: (keys: InstanceKeys) => Promise<T>,
): Promise<T> {
  if (!existsSync(paths.database)) throw new CommandError('There is no database here.');
  const { secret, origin } = keyEnvironment(environment);
  const store = openServingStore(paths.database);
  try {
    const keys = createInstanceKeys({
      store,
      secret,
      origin,
      now: environment.now ?? (() => Math.floor(Date.now() / 1000)),
    });
    return await operation(keys);
  } catch (error) {
    // A fixed sentence naming the variable; never a key.
    if (error instanceof InstanceKeysUnavailable) throw new CommandError(error.message);
    throw error;
  } finally {
    await store.close();
  }
}

/**
 * The rotation `restore` ends with (ADR 0047 D-5): a new encryption key with
 * a serial of at least now, above every key the restored database issued.
 * Reported, never thrown: the data is already in place and checked.
 */
async function rotateAfterRestore(paths: DataPaths, environment: KeyEnvironment) {
  try {
    return await withInstanceKeys(paths, environment, async (keys) => {
      const shown = await keys.show().catch((error: unknown) => {
        // A snapshot from before the keys existed: nothing to rotate.
        if (error instanceof InstanceKeysUnavailable && error.code === 'no-keys') return undefined;
        throw error;
      });
      if (shown === undefined) return { rotated: false, problem: NO_KEYS_SENTENCE };
      const rotated = await keys.rotate();
      return { rotated: true, serial: rotated.serial, keyId: rotated.keyId };
    });
  } catch (error) {
    return {
      rotated: false,
      problem: error instanceof CommandError ? error.message : 'the keys could not be rotated',
    };
  }
}

/** The actions `instance-key` takes. */
export type InstanceKeyAction =
  | { readonly action: 'init' }
  | { readonly action: 'show' }
  | { readonly action: 'rotate'; readonly dropOld: boolean; readonly serialAbove?: number }
  | { readonly action: 'rotate-identity'; readonly compromised: boolean }
  | { readonly action: 'reset' };

/** `instance-key …` (#1189, ADR 0047 D-5, D-6): the instance's own keys. Never a private byte. */
export async function instanceKey(
  paths: DataPaths,
  action: InstanceKeyAction,
  environment: KeyEnvironment,
) {
  if (
    action.action === 'rotate' &&
    action.serialAbove !== undefined &&
    !(Number.isSafeInteger(action.serialAbove) && action.serialAbove >= 0)
  ) {
    throw new CommandError('--serial-above is a whole number: the serial a device names.');
  }
  return withInstanceKeys(paths, environment, async (keys) => {
    const command = `instance-key ${action.action}`;
    switch (action.action) {
      case 'init': {
        const done = await keys.maintain();
        return { command, made: done.made, ...(await keys.show()) };
      }
      case 'show':
        return { command, ...(await keys.show()) };
      case 'rotate':
        return {
          command,
          ...(await keys.rotate({
            dropOld: action.dropOld,
            ...(action.serialAbove === undefined ? {} : { serialAbove: action.serialAbove }),
          })),
        };
      case 'rotate-identity':
        return {
          command,
          endorsed: !action.compromised,
          repin: 'every device pins again from the new card',
          ...(await keys.rotateIdentity({ compromised: action.compromised })),
        };
      case 'reset':
        return {
          command,
          repin: 'every device pins again from the new card',
          ...(await keys.reset()),
        };
    }
  });
}

/** The operator's secret, imported, or a refusal naming the variable and never its value. */
async function secretKey(text: string | undefined): Promise<SecretKey | undefined> {
  const read = readSecretKey(text);
  if (read.kind === 'malformed') throw new CommandError(SECRET_KEY_MALFORMED);
  return read.kind === 'ok' ? importSecretKey(read.bytes) : undefined;
}

/** What `model-key status` and `set` say of a held key: that it is held, never what it is. */
const KEY_HELD = 'a key is held';

/** The longest model name accepted. */
const MAXIMUM_MODEL_NAME = 200;

/**
 * `model-key set --url https://… --model <name>` (#1097): seal the key read
 * from STANDARD INPUT — never from the command line, where `ps` and a shell's
 * history would show it — under `OYL_INSTANCE_SECRET_KEY`, and hold it for
 * the operator. ADR 0046's Q9 ruling: the operator is *"the athlete whose
 * device holds `OYL_INSTANCE_OWNER_KEY`, the key that already makes them
 * moderator"*. Refused, writing nothing, when that variable is unset or its
 * device key is not a live key of an athlete here. Any number of other
 * riders may be registered (ruling 5); the key serves none of them
 * (`analysis/source.ts`).
 */
export async function modelKeySet(
  paths: DataPaths,
  options: {
    readonly url: string;
    readonly model: string;
    /** Standard input, exactly as read. */
    readonly input: string;
    readonly secret: string | undefined;
    /** `OYL_INSTANCE_OWNER_KEY`: the device key whose athlete is the operator. */
    readonly ownerKey: string | undefined;
    readonly now?: () => Date;
  },
) {
  const url = hostedUrlFrom(options.url);
  if (!url.ok) throw new CommandError(url.problem);
  const model = options.model.trim();
  if (model === '' || model.length > MAXIMUM_MODEL_NAME || !/^[\x21-\x7e]+$/.test(model)) {
    throw new CommandError('--model is the model’s name: printable characters, no spaces.');
  }
  const key = hostedKeyFrom(options.input);
  if (key === undefined) {
    throw new CommandError(
      'Standard input must hold the key and nothing else: one line of printable characters, no spaces.',
    );
  }
  const secret = await secretKey(options.secret);
  if (secret === undefined) {
    throw new CommandError(
      'OYL_INSTANCE_SECRET_KEY is not set: the key is encrypted under it, so it is needed to hold one.',
    );
  }
  const ownerKey = options.ownerKey?.trim() ?? '';
  if (ownerKey === '') {
    throw new CommandError(
      'OYL_INSTANCE_OWNER_KEY is not set: the key is held for the operator, the athlete whose device holds it. Nothing was written.',
    );
  }
  const store = openServingStore(paths.database);
  try {
    const device = await store.findDeviceKey(ownerKey);
    if (device === undefined || device.revokedAt !== null) {
      throw new CommandError(
        'OYL_INSTANCE_OWNER_KEY is not a device key of any athlete on this instance: the operator signs in first. Nothing was written.',
      );
    }
    const sealed = await sealHostedKey(secret, {
      athleteId: device.athleteId,
      url: url.url.href,
      model,
      key,
    });
    const put = await store.putHostedModelKey(device.athleteId, {
      url: url.url.href,
      model,
      ...sealed,
      setAt: Math.floor((options.now ?? (() => new Date()))().getTime() / 1000),
    });
    if (put.outcome === 'no-athlete') {
      throw new CommandError(
        'The operator’s athlete is not on this instance. Nothing was written.',
      );
    }
  } finally {
    await store.close();
  }
  return { command: 'model-key set', key: KEY_HELD, url: url.url.href, model };
}

/** `model-key status`: the URL, the model and that a key is held — never the key. */
export async function modelKeyStatus(paths: DataPaths, secretText: string | undefined) {
  const secret = await secretKey(secretText);
  const store = openServingStore(paths.database);
  try {
    const state = await hostedKeyState(store, secret);
    if (state.kind === 'none') return { command: 'model-key status', key: 'no key is held' };
    return {
      command: 'model-key status',
      key: KEY_HELD,
      url: state.url,
      model: state.model,
      readable: state.kind === 'held',
      ...(state.kind === 'unreadable' ? { problem: HOSTED_KEY_UNREADABLE } : {}),
      ...(state.kind === 'no-secret'
        ? { problem: 'OYL_INSTANCE_SECRET_KEY is not set, so the key cannot be read.' }
        : {}),
    };
  } finally {
    await store.close();
  }
}

/** `model-key clear`: the key gone, scrubbed (`SqlStore.clearHostedModelKey`). */
export async function modelKeyClear(paths: DataPaths) {
  const store = openServingStore(paths.database);
  try {
    return { command: 'model-key clear', cleared: await store.clearHostedModelKey() };
  } finally {
    await store.close();
  }
}

const POSITIONS: readonly RidingPosition[] = ['upright', 'hoods', 'drops'];

export async function roomOpen(
  paths: DataPaths,
  roomId: string,
  options: {
    readonly kind: string;
    readonly lengthMetres: number;
    readonly gradePercent?: number;
    readonly position?: string;
    readonly routeSha256?: string;
    readonly countdownMs?: number;
  },
) {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(roomId)) {
    throw new CommandError('A room id is 1 to 128 letters, digits, - and _.');
  }
  if (options.kind !== 'ride' && options.kind !== 'race') {
    throw new CommandError('--kind is ride or race.');
  }
  if (!(options.lengthMetres > 0) || !Number.isFinite(options.lengthMetres)) {
    throw new CommandError('--length is a distance in metres above 0.');
  }
  const position = (options.position ?? 'hoods') as RidingPosition;
  if (
    options.countdownMs !== undefined &&
    (!Number.isInteger(options.countdownMs) || options.countdownMs < 0)
  ) {
    throw new CommandError('--countdown is a whole number of milliseconds.');
  }
  if (!POSITIONS.includes(position))
    throw new CommandError('--position is upright, hoods or drops.');
  const routeSha256 = options.routeSha256 ?? 'ab'.repeat(32);
  if (!/^[0-9a-f]{64}$/.test(routeSha256))
    throw new CommandError('--route is a lower-case SHA-256.');
  const store = openServingStore(paths.database);
  try {
    await store.putRoom({
      id: roomId,
      kind: options.kind === 'ride' ? 'group' : 'race',
      visibility: 'private',
      routeSha256,
      physicsVersion: PHYSICS_VERSION,
    });
    await store.putRoomCourse({
      roomId,
      lengthMetres: options.lengthMetres,
      grades: [[0, options.gradePercent ?? 0]],
      ridingPosition: position,
      capacity: null,
      countdownMs: options.countdownMs ?? null,
      rejoinWindowMs: null,
      raceStartedAt: null,
    });
  } finally {
    await store.close();
  }
  return { command: 'room-open', kind: options.kind, lengthMetres: options.lengthMetres };
}
