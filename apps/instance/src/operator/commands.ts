// SPDX-License-Identifier: AGPL-3.0-or-later

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import {
  cp,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  statfs,
  writeFile,
} from 'node:fs/promises';
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
import { randomHex } from '../auth/crypto.ts';
import { recoveryCodeSha256 } from '../auth/identity.ts';
import { createDiskBlobStore } from '../blob/disk-blob-store.ts';
import { createRooms } from '../rooms/rooms.ts';
import { readServerConfig } from '../server-config.ts';
import { forgetWaitingRequests, integrityOk, rowCounts, vacuumInto } from '../store/backup.ts';
import { lockFolder, RUN_LIMIT_MS, type FolderLock } from './folder-lock.ts';
import { migrateForDeploy, openServingStore } from '../store/serving.ts';
import type { BackupRun, OperatorAction, SqlStore } from '../store/sql-store.ts';
import { createSync } from '../sync/sync.ts';

/**
 * What an operator runs against an instance's data (#791, #807, #52) —
 * `node src/operator/cli.ts <command>`, in the image and on a clone alike.
 *
 * | Command | Does |
 * |---|---|
 * | `migrate` | the deploy's migrate step: every migration not applied, with the marker a starting instance waits on (`store/serving.ts`) |
 * | `backup <directory> [--keep N] [--copy-to <directory>]` | an online snapshot — `VACUUM INTO` and the blob directory — into a new timestamped directory, with a manifest of what it holds; the oldest beyond `--keep` removed; and the snapshot copied to a second place (a USB drive, a share). Each run is recorded in the database (#2606), a failed one by its error's name |
 * | `backup-loop <directory> --interval <seconds> [--keep N] [--copy-to <directory>]` | the home deployment's `backup` service (#2606): `backup` every `--interval` seconds, and within 30 s of the owner's "back up now", until it is stopped |
 * | `restore <snapshot directory> [--force]` | the snapshot back into place, checked: SQLite's integrity check, every row count and blob count against the manifest, every blob's content against its name |
 * | `verify` | the row counts and the blob count of the data in place — what a restore on another machine is compared with |
 * | `room-open <roomId> --kind ride\|race --length <metres> [--grade <percent>] [--position hoods\|drops\|upright] [--countdown <ms>]` | a room and its course, until #784 and #785 let a rider make one |
 * | `model-key set --url https://… --model <name>` | the instance's one hosted model key, read from standard input, sealed under `OYL_INSTANCE_SECRET_KEY`, held for the operator: the athlete whose device holds `OYL_INSTANCE_OWNER_KEY` (#1097, ADR 0046 Q9) |
 * | `model-key status` | the hosted key's URL and model, that a key is held, and whether this secret opens it — never the key |
 * | `model-key clear` | the hosted key gone, scrubbed from the database's free pages and its log |
 * | `load-accounts add` | an APPROVED throwaway account, `Load N`, for each public key on standard input — what `tools/race-load.ts keys` printed — marked as the load run's (#1383) |
 * | `load-accounts erase` | every account `load-accounts add` made, erased as a rider's own erasure does it, and how many |
 * | `account-erase [--confirm]` | ONE rider's account, found by a recovery code on standard input that the rider emailed: its id and counts, and with `--confirm` erased as their own erasure does it (#1802) |
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
 *
 * ## The operator log (#2602)
 *
 * Every command that changes the instance's state writes an entry to the
 * operator log (migration 0040) — the owner's ruling of 2026-11-14 on #2601:
 * the log is the whole record, the CLI's and the app's. Its actor is
 * `{ source: 'cli' }` and NO athlete: the CLI runs on the host as whoever can
 * reach the data, which is not an athlete, so it names none rather than
 * borrowing the owner's. `verify`, `model-key status`, `instance-key show`
 * and `account-erase` without `--confirm` change nothing and log nothing.
 *
 * - **A change to rows** (`room-open`, `model-key set|clear`, the
 *   `instance-key` changes, `load-accounts`, `account-erase --confirm`) runs
 *   inside `SqlStore.recordOperatorAction`, so the change and its entry
 *   commit together or not at all; a refusal found there is logged
 *   `refused`, and a failure `failed`, with the change rolled back.
 * - **A change to files** (`migrate`, `backup`, `restore`) cannot share a
 *   transaction with a row: its entry is written once the work has ended,
 *   through the same function, and its report says `logged`. The command
 *   succeeds when its work did: an entry that cannot be written is
 *   `logged: false` and a line on standard error, never a failed command, so
 *   a log write cannot stop a deploy whose migrations applied. A restore's
 *   entry goes into the database it restored — what the replaced one
 *   recorded since the snapshot goes with it — and a snapshot from before
 *   the operator log has none until `migrate` (`logged: false`).
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

/** The CLI's actor in the operator log (#2602): the host, and no athlete. */
const FROM_THE_CLI = { source: 'cli' } as const;

/** Unix seconds, from the command's clock. */
function secondsOf(now: (() => Date) | undefined): number {
  return Math.floor((now ?? (() => new Date()))().getTime() / 1000);
}

/** A refusal found inside an operator action: logged `refused`, then thrown as the command's error. */
class Refused {
  readonly message: string;
  constructor(message: string) {
    this.message = message;
  }
}

/**
 * Run `change` on `store` as a CLI operator action (#2602): the change and
 * its entry in ONE transaction. A {@link Refused} value is logged `refused`
 * and thrown as a {@link CommandError}; anything thrown is logged `failed`
 * and thrown on, the change rolled back.
 */
async function asOperatorAction<T>(
  store: SqlStore,
  action: OperatorAction,
  change: (inside: SqlStore) => Promise<T | Refused>,
  detail: (value: T) => string | null = () => null,
  now?: () => Date,
): Promise<T> {
  const { value } = await store.recordOperatorAction<T | Refused>(
    { actor: FROM_THE_CLI, action, at: secondsOf(now) },
    async (inside) => {
      const changed = await change(inside);
      return changed instanceof Refused
        ? { outcome: 'refused', value: changed }
        : { outcome: 'done', detail: detail(changed), value: changed };
    },
  );
  if (value instanceof Refused) throw new CommandError(value.message);
  return value;
}

/**
 * What a file command writes to standard error when its work is done and its
 * entry could not be written (#2602): a fixed sentence and the action's name,
 * no value.
 */
export function unloggedSentence(action: OperatorAction): string {
  return `operator: ${action} is done, but its entry could not be written to the operator log.\n`;
}

/**
 * Log a command whose change is FILES once it has ended (#2602): `done` with
 * `detail`, or — when `work` threw — `failed`, and the error thrown on. Answers
 * whether the entry was written. The command's outcome is its WORK's: a log
 * that cannot be written — a database with no operator log yet (one not
 * migrated, or restored from before it), a full disk, a lock still held after
 * the retries — leaves the work done and `logged: false`, and anything but a
 * missing table says so on standard error. A deploy whose migrations applied
 * is never stopped by its log entry.
 */
async function loggedAfter<T>(
  database: string,
  action: OperatorAction,
  work: () => Promise<T>,
  detail: (value: T) => string | null,
): Promise<{ readonly value: T; readonly logged: boolean }> {
  let failure: { readonly error: unknown } | undefined;
  let value: T | undefined;
  try {
    value = await work();
  } catch (error) {
    failure = { error };
  }
  let logged = false;
  if (existsSync(database)) {
    const store = openServingStore(database);
    try {
      await store.recordOperatorAction(
        { actor: FROM_THE_CLI, action, at: secondsOf(undefined) },
        () => {
          // Keep this guard: it is what logs a failed run `failed` and never
          // `done`, whatever a future `detail` does with an undefined value.
          if (failure !== undefined) throw failure.error;
          return { outcome: 'done', detail: detail(value as T), value: undefined };
        },
      );
      logged = true;
    } catch (error) {
      // The work's own error is the one an operator needs, and work that
      // succeeded stays a success: a log that could not be written leaves
      // `logged` false.
      if (
        failure === undefined &&
        !(error instanceof Error && /no such table/.test(error.message))
      ) {
        process.stderr.write(unloggedSentence(action));
      }
    } finally {
      await store.close();
    }
  }
  if (failure !== undefined) throw failure.error;
  return { value: value as T, logged };
}

export async function migrate(paths: DataPaths) {
  await mkdir(dirname(paths.database), { recursive: true });
  const started = performance.now();
  const { value: report, logged } = await loggedAfter(
    paths.database,
    'migrate',
    () => migrateForDeploy(paths.database),
    (done) => `applied=${String(done.changed)}`,
  );
  return { command: 'migrate', ...report, ms: Math.round(performance.now() - started), logged };
}

/** What `backup` and `backup-loop` are told, beyond where the snapshots go. */
export interface BackupOptions {
  readonly keep?: number;
  readonly copyTo?: string;
  readonly now?: () => Date;
  /** The backup service's interval, written into the record: `backup-loop`'s runs only (#2606). */
  readonly intervalSeconds?: number;
  /** The owner's waiting request this run serves (#2606). */
  readonly requestId?: number;
}

/**
 * What an error is recorded as (#2606): its code when it is one of Node's
 * (`ENOSPC`, `EACCES`), or its name — never its message, which may hold a
 * path (`log.ts`'s rule).
 */
export function errorName(error: unknown): string {
  const code = (error as { readonly code?: unknown } | null)?.code;
  if (typeof code === 'string' && /^E[A-Z0-9]{1,30}$/.test(code)) return code;
  const name = error instanceof Error ? error.name : '';
  return /^[A-Za-z0-9_]{1,64}$/.test(name) ? name : 'Error';
}

/**
 * The sentence `backup` writes to standard error when the snapshot was taken
 * and recorded but its off-box copy was not (#2606). It names no path.
 */
export const OFF_BOX_FAILED =
  'operator: the snapshot was taken and recorded, but its off-box copy (--copy-to) failed.\n';

/**
 * How many snapshots beyond `--keep` a place may hold because their runs
 * could not be recorded (#2606, second review M1). Such a run removes no
 * older snapshot — a recorded restore point is never given up for one that
 * is not — and when the place already holds `--keep` + this many, it
 * removes the snapshot it has just taken instead.
 */
export const UNRECORDED_ALLOWANCE = 2;

export async function backup(paths: DataPaths, destination: string, options: BackupOptions = {}) {
  if (!existsSync(paths.database)) throw new CommandError('There is no database to back up.');
  if (options.keep !== undefined && (!Number.isInteger(options.keep) || options.keep < 1)) {
    throw new CommandError('--keep is a whole number of snapshots, 1 or more.');
  }
  const at = (options.now ?? (() => new Date()))();
  // One run at a time in a folder, for the whole run (second review B1): a
  // run that cannot take the lock is refused, and recorded `failed` by name.
  let here: FolderLock;
  try {
    await mkdir(destination, { recursive: true });
    here = await lockFolder(destination);
  } catch (error) {
    await recordFailedBackup(paths.database, at, error, options);
    throw error;
  }
  try {
    // The off-box place is locked too; one that cannot be locked is a copy
    // that failed, and is neither written nor pruned.
    let there: FolderLock | undefined;
    if (options.copyTo !== undefined) {
      try {
        await mkdir(options.copyTo, { recursive: true });
        there = await lockFolder(options.copyTo);
      } catch {
        there = undefined;
      }
    }
    try {
      return await takeAndRecord(paths, destination, at, options, there !== undefined);
    } finally {
      await there?.release();
    }
  } finally {
    await here.release();
  }
}

async function takeAndRecord(
  paths: DataPaths,
  destination: string,
  at: Date,
  options: BackupOptions,
  offBoxLocked: boolean,
) {
  let taken: Awaited<ReturnType<typeof takeBackup>>;
  try {
    taken = await takeBackup(paths, destination, at, options, offBoxLocked);
  } catch (error) {
    await recordFailedBackup(paths.database, at, error, options);
    throw error;
  }
  const { recorded, logged, prune } = await recordTakenBackup(paths.database, at, taken, options);
  // Pruned only once the run is recorded (#2606 review H1): a run whose
  // record cannot be written removes no older snapshot.
  let removed = 0;
  let kept = true;
  if (prune) {
    for (const old of taken.prune) {
      await rm(old, { recursive: true, force: true });
      removed += 1;
    }
  } else if (options.keep !== undefined) {
    // …and holds no more than `--keep` + UNRECORDED_ALLOWANCE (second review
    // M1): past that it gives up the snapshot it has just taken, never one
    // that was there before.
    const limit = options.keep + UNRECORDED_ALLOWANCE;
    const places = [taken.snapshot, ...(taken.copiedTo === null ? [] : [taken.copiedTo])];
    for (const made of places) {
      const count = (await readdir(dirname(made))).filter((name) =>
        name.startsWith('snapshot-'),
      ).length;
      if (count > limit) {
        await rm(made, { recursive: true, force: true });
        if (made === taken.snapshot) kept = false;
      }
    }
  }
  return {
    command: taken.command,
    snapshot: taken.snapshot,
    copiedTo: taken.copiedTo,
    rows: taken.rows,
    blobs: taken.blobs,
    removed,
    ms: taken.ms,
    offBox: taken.run.offBox,
    recorded,
    logged,
    kept,
  };
}

/**
 * The prefix a snapshot is written under until it is complete (#2606): a
 * run cut short — a stop past the grace period, a crash, a full disk —
 * leaves a `.partial-snapshot-…` directory, which `--keep` never counts and
 * a later run removes. Only a complete snapshot is renamed `snapshot-…`.
 */
export const PARTIAL = '.partial-';

/**
 * Removes the partial snapshots a run that died left in `place`. Called only
 * while holding `place`'s lock (`folder-lock.ts`), and — a second guard —
 * removes only a partial last changed longer ago than any run lasts.
 */
async function removePartials(place: string): Promise<void> {
  for (const name of await readdir(place)) {
    if (!name.startsWith(`${PARTIAL}snapshot-`)) continue;
    const path = join(place, name);
    const changed = await stat(path).then(
      (found) => found.mtimeMs,
      () => undefined,
    );
    if (changed !== undefined && Date.now() - changed > RUN_LIMIT_MS) {
      await rm(path, { recursive: true, force: true });
    }
  }
}

/**
 * `rename`, tried again a few times when Windows answers `EACCES` or `EPERM`
 * because a scanner holds a handle in the folder for a moment (second review).
 */
export async function renameRetrying(
  from: string,
  to: string,
  move: (from: string, to: string) => Promise<void> = rename,
): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await move(from, to);
      return;
    } catch (error) {
      const code = (error as { code?: unknown }).code;
      if (attempt >= 4 || (code !== 'EACCES' && code !== 'EPERM')) throw error;
      await new Promise((resolve) => setTimeout(resolve, 100 * 2 ** attempt));
    }
  }
}

/** Free bytes an unprivileged process may write at `path`, or `null` when it cannot be read. */
async function freeBytesAt(path: string): Promise<number | null> {
  try {
    const space = await statfs(path);
    return space.bavail * space.bsize;
  } catch {
    return null;
  }
}

async function bytesUnder(root: string): Promise<number> {
  let total = 0;
  for (const file of await filesUnder(root)) total += (await stat(file)).size;
  return total;
}

/**
 * Takes the snapshot, and copies it off the box. Removes NOTHING: it answers
 * the old snapshots `--keep` would remove, and `backup` removes them once the
 * run is recorded.
 *
 * ⚠️ The off-box copy has no time limit. A share that stops answering blocks
 * the copy inside a file-system call, which Node cannot cancel, and the loop
 * waits with it; the snapshot on the box is already complete. Watch
 * `docker compose logs backup` and the age of the last backup in Status;
 * #2626 is the child-process watchdog that would stop it.
 */
async function takeBackup(
  paths: DataPaths,
  destination: string,
  at: Date,
  options: BackupOptions,
  offBoxLocked: boolean,
) {
  const started = performance.now();
  const name = `snapshot-${stamp(at)}`;
  const snapshot = join(destination, name);
  await removePartials(destination);
  const partial = join(destination, `${PARTIAL}${name}`);
  let manifest: Manifest;
  let blobs: string[];
  try {
    await mkdir(partial, { recursive: true });
    const database = join(partial, DATABASE_FILE);
    vacuumInto(paths.database, database);
    // The snapshot does not hold a "back up now" as waiting (#2606 review
    // L1): this run serves it, so restoring the snapshot would ask again.
    forgetWaitingRequests(database);
    blobs = await blobFiles(paths.blobs);
    if (blobs.length > 0) {
      await cp(join(paths.blobs, 'objects'), join(partial, BLOBS_DIRECTORY, 'objects'), {
        recursive: true,
      });
    }
    manifest = {
      takenAt: at.toISOString(),
      rows: rowCounts(database),
      blobs: blobs.length,
      databaseSha256: await sha256Of(database),
    };
    await writeFile(join(partial, MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`);
    await renameRetrying(partial, snapshot);
  } catch (error) {
    await rm(partial, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }

  // A copy that fails leaves the snapshot taken and recorded (#2606): the
  // record says `failed`, and the off-box place's older copies are not
  // pruned, so a drive that is full or gone keeps what it had.
  let copiedTo: string | null = null;
  let offBox: 'copied' | 'failed' | 'not-configured' = 'not-configured';
  if (options.copyTo !== undefined) {
    const copy = join(options.copyTo, name);
    const partialCopy = join(options.copyTo, `${PARTIAL}${name}`);
    try {
      if (!offBoxLocked) throw new Error('the off-box place is not this run’s');
      await removePartials(options.copyTo);
      await cp(snapshot, partialCopy, { recursive: true });
      await renameRetrying(partialCopy, copy);
      copiedTo = copy;
      offBox = 'copied';
    } catch {
      offBox = 'failed';
      await rm(partialCopy, { recursive: true, force: true }).catch(() => undefined);
    }
  }
  const prune: string[] = [];
  if (options.keep !== undefined) {
    // By COUNT, the newest `--keep` of each place: the names sort by time.
    const places = [
      destination,
      ...(offBox === 'copied' && options.copyTo !== undefined ? [options.copyTo] : []),
    ];
    for (const place of places) {
      const snapshots = (await readdir(place))
        .filter((each) => each.startsWith('snapshot-'))
        .sort();
      for (const old of snapshots.slice(0, Math.max(0, snapshots.length - options.keep))) {
        prune.push(join(place, old));
      }
    }
  }
  const run: BackupRun = {
    outcome: 'done',
    at: Math.floor(at.getTime() / 1000),
    snapshot: name,
    rows: Object.values(manifest.rows).reduce((sum, n) => sum + n, 0),
    blobs: manifest.blobs,
    databaseSha256: manifest.databaseSha256,
    sizeBytes: await bytesUnder(snapshot),
    offBox,
    removed: prune.length,
    backupsFreeBytes: await freeBytesAt(destination),
    offBoxFreeBytes: options.copyTo === undefined ? null : await freeBytesAt(options.copyTo),
    intervalSeconds: options.intervalSeconds ?? null,
  };
  return {
    command: 'backup',
    snapshot,
    copiedTo,
    rows: manifest.rows,
    blobs: manifest.blobs,
    ms: Math.round(performance.now() - started),
    run,
    prune,
  };
}

/**
 * A taken snapshot's record and its operator log entry, in ONE transaction
 * (#2606, #2602): the record, the 30-day pruning of old records, the owner's
 * request marked served, and the entry commit together or not at all. As
 * for any file command, a record that cannot be written leaves the snapshot
 * taken: `recorded` and `logged` are false, and anything but a database from
 * before these tables says so on standard error.
 *
 * `prune` says whether the old snapshots may be removed: when the run is
 * recorded, or the database has no record tables to write (one from before
 * migration 0042, which pruned as it always had). A record that FAILED to be
 * written prunes nothing (#2606 review H1).
 */
async function recordTakenBackup(
  database: string,
  at: Date,
  taken: { readonly run: BackupRun & { readonly outcome: 'done' } },
  options: BackupOptions,
): Promise<{ readonly recorded: boolean; readonly logged: boolean; readonly prune: boolean }> {
  const store = openServingStore(database);
  try {
    await store.recordOperatorAction(
      { actor: FROM_THE_CLI, action: 'backup', at: secondsOf(() => at) },
      async (inside) => {
        const { served } = await inside.recordBackup(taken.run, options.requestId);
        const detail = [
          `blobs=${String(taken.run.blobs)}`,
          `removed=${String(taken.run.removed)}`,
          ...(taken.run.offBox === 'failed' ? ['offbox_failed'] : []),
          ...(served ? ['requested'] : []),
        ].join(',');
        return { outcome: 'done', detail, value: undefined };
      },
    );
    return { recorded: true, logged: true, prune: true };
  } catch (error) {
    const noTables = error instanceof Error && /no such table/.test(error.message);
    if (!noTables) process.stderr.write(unloggedSentence('backup'));
    return { recorded: false, logged: false, prune: noTables };
  } finally {
    await store.close();
  }
}

/**
 * A failed run's record — by its error's name — and its `failed` entry
 * (#2606). The record is its own transaction: an operator action that throws
 * keeps nothing it wrote. A request it was serving is marked served by it,
 * so a run that fails is not retried every 30 s; the owner sees it failed and
 * asks again. When even that record cannot be written, `backup-loop` holds
 * the request back for an interval itself (#2606 review H1).
 */
async function recordFailedBackup(
  database: string,
  at: Date,
  error: unknown,
  options: BackupOptions,
): Promise<void> {
  if (!existsSync(database)) return;
  const store = openServingStore(database);
  try {
    await store
      .recordBackup(
        {
          outcome: 'failed',
          at: Math.floor(at.getTime() / 1000),
          error: errorName(error),
          intervalSeconds: options.intervalSeconds ?? null,
        },
        options.requestId,
      )
      .catch(() => undefined);
    await store
      .recordOperatorAction(
        { actor: FROM_THE_CLI, action: 'backup', at: secondsOf(() => at) },
        () => {
          throw error;
        },
      )
      .catch(() => undefined);
  } finally {
    await store.close();
  }
}

/** A snapshot directory's name, and the time it names, Unix ms. */
function snapshotTime(name: string): number | undefined {
  const parts = /^snapshot-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/.exec(name);
  if (parts === null) return undefined;
  const [, day, hours, minutes, seconds, ms] = parts;
  const at = Date.parse(
    `${day ?? ''}T${hours ?? ''}:${minutes ?? ''}:${seconds ?? ''}.${ms ?? ''}Z`,
  );
  return Number.isNaN(at) ? undefined : at;
}

/** The newest complete snapshot in `folder`, by the time its name holds, or `undefined`. */
async function newestSnapshotIn(
  folder: string,
): Promise<{ readonly name: string; readonly at: number } | undefined> {
  let names: string[];
  try {
    names = await readdir(folder);
  } catch {
    return undefined;
  }
  let newest: { readonly name: string; readonly at: number } | undefined;
  for (const name of names) {
    const at = snapshotTime(name);
    if (at !== undefined && (newest === undefined || at > newest.at)) newest = { name, at };
  }
  return newest;
}

/** How often `backup-loop` looks for the owner's "back up now" (#2606): within 30 s. */
export const BACKUP_POLL_SECONDS = 30;

/** What `backup-loop` writes to standard error when it cannot read the database: no path, no value. */
export const LOOP_CANNOT_READ =
  'operator: backup-loop could not read the database for a waiting request; it tries again shortly.\n';

/** `ms`, or less when `signal` is aborted first. */
function waitFor(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted === true) {
      resolve();
      return;
    }
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal?.removeEventListener('abort', done);
      resolve();
    }
    signal?.addEventListener('abort', done, { once: true });
  });
}

/**
 * The home deployment's `backup` service (#2606): `backup` every
 * `intervalSeconds`, and within {@link BACKUP_POLL_SECONDS} of the owner's
 * "back up now" — until `signal` is aborted.
 *
 * - **On the interval, as the shell loop it replaces did**: a run, then the
 *   interval, then a run. The first is due an interval after the service's
 *   newest recorded run, so a restart does not take an extra snapshot (and
 *   prune an older one); with none recorded, at once.
 * - **A request is served once.** The run that serves it marks it served in
 *   the same transaction as its record (`SqlStore.recordBackup`), and a
 *   request waits in the database, so a restart serves it after. Every run
 *   restarts the interval.
 * - **A failure never makes it run more often than its interval** (#2606
 *   review H1). A request it tried and that is still waiting — its record
 *   could not be written — is not tried again until an interval has passed,
 *   remembered here and not in the database, which is what failed. Across a
 *   restart the folder remembers: the newest snapshot no record names holds
 *   off every run for an interval after it (second review M1). And a run
 *   whose record failed removes no older snapshot, and keeps at most
 *   `--keep` + {@link UNRECORDED_ALLOWANCE} in a place (`backup`).
 * - **It keeps going.** A failed run is recorded by its error's name and the
 *   loop carries on; a database it cannot read is tried again at the next poll.
 *
 * It opens the database only for a moment at each poll and run, never
 * holding a connection between them.
 */
export async function backupLoop(
  paths: DataPaths,
  destination: string,
  options: Omit<BackupOptions, 'requestId'> & {
    readonly intervalSeconds: number;
    readonly signal?: AbortSignal;
    /** How the loop waits: a test's moves its clock. */
    readonly wait?: (ms: number) => Promise<void>;
    /** Each run's report, or a failed run's error name. */
    readonly report?: (line: unknown) => void;
  },
) {
  if (!Number.isInteger(options.intervalSeconds) || options.intervalSeconds < 1) {
    throw new CommandError('--interval is a whole number of seconds, 1 or more.');
  }
  if (options.keep !== undefined && (!Number.isInteger(options.keep) || options.keep < 1)) {
    throw new CommandError('--keep is a whole number of snapshots, 1 or more.');
  }
  const clock = options.now ?? (() => new Date());
  const wait = options.wait ?? ((ms: number) => waitFor(ms, options.signal));
  const report =
    options.report ?? ((line: unknown) => process.stdout.write(`${JSON.stringify(line)}\n`));
  const intervalMs = options.intervalSeconds * 1000;
  // A function, so each check reads the signal as it is then.
  const stopped = (): boolean => options.signal?.aborted === true;
  let nextDue: number | undefined;
  let runs = 0;
  /** When each request was last tried, Unix ms: in memory, as the database is what may be failing. */
  const attempted = new Map<number, number>();
  /**
   * Until when no run starts at all, Unix ms (second review M1): an interval
   * after the newest snapshot in the folder that no record names — a run
   * whose record failed, before a restart, or the shell loop's before
   * #2606 — so neither a restart nor a waiting request takes another early.
   */
  let quietUntil = Number.NEGATIVE_INFINITY;
  while (!stopped()) {
    let pending: { readonly id: number } | undefined;
    try {
      const store = openServingStore(paths.database);
      try {
        if (nextDue === undefined) {
          const last = await store.newestServiceBackup(false);
          // Never later than an interval from now, whatever the clock said
          // when that record was written (#2606 review).
          const now = clock().getTime();
          nextDue =
            last === undefined ? now : Math.min(last.at * 1000 + intervalMs, now + intervalMs);
          const onDisk = await newestSnapshotIn(destination);
          if (
            onDisk !== undefined &&
            !(await store.listBackupRecords(50)).some((record) => record.snapshot === onDisk.name)
          ) {
            quietUntil = Math.min(onDisk.at + intervalMs, now + intervalMs);
            nextDue = Math.max(nextDue, quietUntil);
          }
        }
        pending = await store.pendingBackupRequest();
      } finally {
        await store.close();
      }
    } catch {
      process.stderr.write(LOOP_CANNOT_READ);
      await wait(BACKUP_POLL_SECONDS * 1000);
      continue;
    }
    const now = clock().getTime();
    const tried = pending === undefined ? undefined : attempted.get(pending.id);
    const served =
      pending !== undefined &&
      now >= quietUntil &&
      (tried === undefined || now - tried >= intervalMs)
        ? pending.id
        : undefined;
    if (served !== undefined || now >= nextDue) {
      if (served !== undefined) attempted.set(served, now);
      try {
        report(
          await backup(paths, destination, {
            ...(options.keep === undefined ? {} : { keep: options.keep }),
            ...(options.copyTo === undefined ? {} : { copyTo: options.copyTo }),
            now: clock,
            intervalSeconds: options.intervalSeconds,
            ...(served === undefined ? {} : { requestId: served }),
          }),
        );
      } catch (error) {
        report({ command: 'backup', failed: errorName(error) });
      }
      runs += 1;
      nextDue = clock().getTime() + intervalMs;
    }
    if (stopped()) break;
    await wait(Math.min(BACKUP_POLL_SECONDS * 1000, Math.max(0, nextDue - clock().getTime())));
  }
  return { command: 'backup-loop', runs };
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
  // Logged into the database it RESTORED, once the data is in place and checked.
  const { value, logged } = await loggedAfter(
    paths.database,
    'restore',
    () => placeRestore(paths, snapshot, options),
    (done) =>
      `blobs=${String(done.blobs)},${done.keys.rotated ? 'keys_rotated' : 'keys_not_rotated'}`,
  );
  return { ...value, logged };
}

async function placeRestore(
  paths: DataPaths,
  snapshot: string,
  options: { readonly force?: boolean; readonly keys?: KeyEnvironment },
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

/**
 * `operation` over the instance's keys — as an operator action when `action`
 * is named (#2602): the keys over the action's store, so what it writes and
 * its log entry commit together. `show` and the rotation inside `restore`
 * (logged as the restore) name none.
 */
async function withInstanceKeys<T>(
  paths: DataPaths,
  environment: KeyEnvironment,
  operation: (keys: InstanceKeys) => Promise<T>,
  action?: OperatorAction,
): Promise<T> {
  if (!existsSync(paths.database)) throw new CommandError('There is no database here.');
  const { secret, origin } = keyEnvironment(environment);
  const store = openServingStore(paths.database);
  const now = environment.now ?? (() => Math.floor(Date.now() / 1000));
  const keysOver = (over: SqlStore): InstanceKeys =>
    createInstanceKeys({ store: over, secret, origin, now });
  try {
    if (action === undefined) return await operation(keysOver(store));
    return await asOperatorAction(
      store,
      action,
      async (inside) => {
        try {
          return await operation(keysOver(inside));
        } catch (error) {
          // A missing secret or origin is a refusal, logged `refused`, not a failure.
          if (
            error instanceof InstanceKeysUnavailable &&
            (error.code === 'no-secret' || error.code === 'no-origin')
          ) {
            return new Refused(error.message);
          }
          throw error;
        }
      },
      undefined,
      () => new Date(now() * 1000),
    );
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
  const logged: Readonly<Record<InstanceKeyAction['action'], OperatorAction | undefined>> = {
    init: 'instance_key_init',
    show: undefined,
    rotate: 'instance_key_rotate',
    'rotate-identity': 'instance_key_rotate_identity',
    reset: 'instance_key_reset',
  };
  return withInstanceKeys(
    paths,
    environment,
    async (keys) => {
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
    },
    logged[action.action],
  );
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
    await asOperatorAction(
      store,
      'model_key_set',
      async (inside) => {
        const device = await inside.findDeviceKey(ownerKey);
        if (device === undefined || device.revokedAt !== null) {
          return new Refused(
            'OYL_INSTANCE_OWNER_KEY is not a device key of any athlete on this instance: the operator signs in first. Nothing was written.',
          );
        }
        const sealed = await sealHostedKey(secret, {
          athleteId: device.athleteId,
          url: url.url.href,
          model,
          key,
        });
        const put = await inside.putHostedModelKey(device.athleteId, {
          url: url.url.href,
          model,
          ...sealed,
          setAt: secondsOf(options.now),
        });
        if (put.outcome === 'no-athlete') {
          return new Refused(
            'The operator’s athlete is not on this instance. Nothing was written.',
          );
        }
        return put.outcome;
      },
      () => null,
      options.now,
    );
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
    const cleared = await asOperatorAction(
      store,
      'model_key_clear',
      (inside) => inside.clearHostedModelKey(),
      (held) => (held ? 'cleared' : 'none_held'),
    );
    return { command: 'model-key clear', cleared };
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
    // The room and its course, and the entry, together (#2602).
    await asOperatorAction(
      store,
      'room_open',
      async (inside) => {
        await inside.putRoom({
          id: roomId,
          kind: options.kind === 'ride' ? 'group' : 'race',
          visibility: 'private',
          routeSha256,
          physicsVersion: PHYSICS_VERSION,
        });
        await inside.putRoomCourse({
          roomId,
          lengthMetres: options.lengthMetres,
          grades: [[0, options.gradePercent ?? 0]],
          ridingPosition: position,
          capacity: null,
          countdownMs: options.countdownMs ?? null,
          rejoinWindowMs: null,
          raceStartedAt: null,
        });
        return options.kind;
      },
      (kind) => kind,
    );
  } finally {
    await store.close();
  }
  return { command: 'room-open', kind: options.kind, lengthMetres: options.lengthMetres };
}

/** A device public key as `tools/race-load.ts keys` prints it: raw Ed25519, lower-case hex. */
const LOAD_PUBLIC_KEY = /^[0-9a-f]{64}$/;

/**
 * `load-accounts add` (#1383, the owner's ruling of 2026-10-15 on #464): an
 * account for each public key on standard input, one per line — what
 * `tools/race-load.ts keys` printed — ACTIVE, so the load run's riders can
 * take a ticket on an instance whose registration is `approval`, without
 * changing that registration. Each is named `Load N` in the order given and
 * marked `load_run_at`, the mark `load-accounts erase` erases by.
 *
 * ⚠️ Operator-only: there is no route to this, and it runs where the
 * database is. It refuses, writing nothing, a key any account on this
 * instance already holds — a rider's or an earlier run's: it adds only
 * accounts it makes. No recovery codes: a throwaway account is erased, never
 * recovered.
 */
export async function loadAccountsAdd(
  paths: DataPaths,
  input: string,
  options: { readonly now?: () => Date } = {},
) {
  const keys = input
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
  if (keys.length === 0) {
    throw new CommandError(
      'Standard input holds no public keys: give it what `race-load keys` printed, one per line. Nothing was written.',
    );
  }
  const malformed = keys.findIndex((key) => !LOAD_PUBLIC_KEY.test(key));
  if (malformed >= 0) {
    throw new CommandError(
      `Line ${String(malformed + 1)} of standard input is not a public key as \`race-load keys\` prints one (64 lower-case hex characters). Nothing was written.`,
    );
  }
  if (new Set(keys).size !== keys.length) {
    throw new CommandError('Standard input names a public key twice. Nothing was written.');
  }
  if (!existsSync(paths.database)) throw new CommandError('There is no database here.');
  const store = openServingStore(paths.database);
  try {
    // Every account and the entry together (#2602): a run that fails part way adds none.
    await asOperatorAction(
      store,
      'load_accounts_add',
      async (inside) => {
        let held = 0;
        for (const key of keys) if ((await inside.findDeviceKey(key)) !== undefined) held += 1;
        if (held > 0) {
          return new Refused(
            `${String(held)} of these keys already belong to an account on this instance, and this command adds only accounts it makes. Nothing was written.`,
          );
        }
        const at = secondsOf(options.now);
        for (const [index, publicKey] of keys.entries()) {
          const athleteId = randomHex(16);
          await inside.registerAthlete({
            athlete: {
              id: athleteId,
              displayName: `Load ${String(index + 1)}`,
              createdAt: at,
              registrationState: 'active',
            },
            key: { publicKey, athleteId, addedAt: at, revokedAt: null },
            recoveryCodeSha256s: [],
            loadRunAt: at,
          });
        }
        return keys.length;
      },
      (added) => `added=${String(added)}`,
      options.now,
    );
    return {
      command: 'load-accounts add',
      added: keys.length,
      held: (await store.listLoadAthletes()).length,
    };
  } finally {
    await store.close();
  }
}

/**
 * Erase each account `which` names the way a rider's own erasure does it
 * (`sync/routes.ts` §`eraseAccount`): any room it made closed first, then its
 * files and every row it owns — all through `store`, an operator action's.
 * Answers how many.
 */
async function eraseAccounts(
  paths: DataPaths,
  store: SqlStore,
  which: () => Promise<readonly string[]>,
): Promise<number> {
  const sync = createSync({ store, blobs: createDiskBlobStore(paths.blobs) });
  const rooms = createRooms({
    store,
    routes: createDiskBlobStore(join(paths.blobs, 'rooms')),
    nameFor: () => Promise.resolve(undefined),
    now: () => Date.now(),
  });
  const athletes = await which();
  for (const athleteId of athletes) {
    await rooms.closeRoomsMadeBy(athleteId);
    await sync.eraseAccount(athleteId);
  }
  return athletes.length;
}

/**
 * `load-accounts erase` (#1383): every account `load-accounts add` made, and
 * no other, erased the way a rider's own erasure does it
 * (`sync/routes.ts` §`eraseAccount`) — any room it made closed first, then
 * its files and every row it owns. It finds them by their mark alone, so a
 * rider's account is never in its reach. Prints how many it erased.
 */
export async function loadAccountsErase(paths: DataPaths) {
  if (!existsSync(paths.database)) throw new CommandError('There is no database here.');
  const store = openServingStore(paths.database);
  try {
    // The erasures and the entry together (#2602). A file removed before a
    // rollback is gone; its rows are not, and a retry finds them again.
    const erased = await asOperatorAction(
      store,
      'load_accounts_erase',
      (inside) => eraseAccounts(paths, inside, () => inside.listLoadAthletes()),
      (count) => `erased=${String(count)}`,
    );
    return {
      command: 'load-accounts erase',
      erased,
      remaining: (await store.listLoadAthletes()).length,
    };
  } finally {
    await store.close();
  }
}

/**
 * `account-erase [--confirm]` (#1802): ONE rider's account, erased when a
 * recovery code the rider sent — by email, the route
 * `docs/delete-your-account.md` gives a rider without the app — matches it.
 * The owner's ruling of 2026-10-27: the code proves the account is the
 * sender's, never a display name, which is neither unique nor secret.
 *
 * The code is read from standard input (`input`), never the command line,
 * and is printed nowhere: not in the report, and not in a refusal. A code
 * that is not the shape of one, matches no account, or was already used
 * erases nothing and says which. Without `confirm` it erases nothing and
 * says what it would: the account's id and counts, never a name or a
 * coordinate. With it, the erasure is the rider's own
 * (`sync/routes.ts` §`eraseAccount`) — every room the account made closed
 * first, then its files and every row it owns — and is read back.
 */
export async function accountErase(
  paths: DataPaths,
  options: { readonly input: string; readonly confirm: boolean },
) {
  const codeSha256 = await recoveryCodeSha256(options.input.trim());
  if (codeSha256 === undefined) {
    throw new CommandError(
      'Standard input does not hold a recovery code: sixteen letters and digits, as the rider was shown them, hyphens and spaces allowed. Nothing was erased.',
    );
  }
  if (!existsSync(paths.database)) throw new CommandError('There is no database here.');
  const store = openServingStore(paths.database);
  try {
    const code = await store.findRecoveryCode(codeSha256);
    if (code === undefined) {
      throw new CommandError(
        'No account on this instance holds that recovery code. Nothing was erased.',
      );
    }
    if (code.usedAt !== null) {
      throw new CommandError(
        'That recovery code was already used, so it no longer proves the account is the sender’s: ask them for one they have not used. Nothing was erased.',
      );
    }
    const { athleteId } = code;
    const holds = {
      athleteId,
      deviceKeys: (await store.listDeviceKeys(athleteId)).length,
      activities: await store.countActivityRecords(athleteId),
      openRoomsMade: await store.countOpenPrivateRoomsMadeBy(athleteId),
      results: (await store.listResults(athleteId)).length,
    };
    if (!options.confirm) {
      return {
        command: 'account-erase',
        ...holds,
        erased: false,
        next: 'Nothing was erased. Run it again with --confirm, the same code on standard input, to erase this account.',
      };
    }
    // The erasure and the entry together (#2602); the entry names no athlete.
    await asOperatorAction(
      store,
      'account_erase',
      (inside) => eraseAccounts(paths, inside, () => Promise.resolve([athleteId])),
      () => null,
    );
    if ((await store.getAthlete(athleteId)) !== undefined) {
      throw new CommandError('The account is still here after its erasure: run it again.');
    }
    return { command: 'account-erase', ...holds, erased: true };
  } finally {
    await store.close();
  }
}
