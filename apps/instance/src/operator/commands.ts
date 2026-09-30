// SPDX-License-Identifier: AGPL-3.0-or-later

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { cp, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { PHYSICS_VERSION, type RidingPosition } from '@onyourleft/physics';

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
  options: { readonly force?: boolean } = {},
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
    ms: Math.round(performance.now() - started),
  };
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
