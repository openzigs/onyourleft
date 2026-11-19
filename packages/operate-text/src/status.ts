// SPDX-License-Identifier: Apache-2.0

/**
 * **Status**' words and rows (#2604, moved by #2644, ADR 0069 D-7): what
 * `GET /v1/operate/status` says, turned into rows of label and value that the
 * app's `OperateStatusPanel` and the instance's admin Status page both draw.
 *
 * Every value a row carries is a count, a size, a length of time, a closed
 * word or the deployed commit. The answer it reads carries nothing secret,
 * nobody's name or id, no path on the host and no coordinate, so no row can:
 * {@link OperateStatusAnswer} has no field that could hold one.
 *
 * Plain data in, strings out: nothing here renders, reads a clock or asks
 * anything. The caller passes `now`.
 *
 * ⚠️ **Every sentence here is DRAFT wording awaiting the owner's approval.**
 */

import { REGISTRATION_MODE_TEXT, type OperateRegistrationMode } from './accounts';
import { bytesText, countText, durationText, momentText } from './words';

/** One disk the instance's data is on. */
export interface OperateStatusDisk {
  readonly holds: 'database' | 'blobs' | 'database_and_blobs';
  readonly freeBytes: number;
  readonly totalBytes: number;
  /** Under a tenth free, as the instance judged it. */
  readonly low: boolean;
}

/** Where a backup's off-box copy stands, by the instance's own names for it. */
export type OperateOffBox = 'copied' | 'failed' | 'not-configured';

/** The newest backup's record, `null` in the answer until one is recorded. */
export interface OperateStatusLastBackup {
  /** ISO 8601, UTC. */
  readonly at: string;
  readonly offBox: OperateOffBox;
  /** The backup service's interval, in seconds. */
  readonly intervalSeconds: number;
}

/** The instance keys' state, by the instance's own name for it. */
export type OperateKeysWord =
  'ready' | 'no-secret' | 'no-origin' | 'no-keys' | 'unreadable' | 'busy';

/** The migrations' state, by the instance's own name for it. */
export type OperateMigrationsWord = 'at-head' | 'migrating' | 'behind' | 'ahead' | 'unknown';

/** The tunnel's state: asked of cloudflared, or not known. */
export type OperateTunnel =
  | { readonly state: 'unknown' | 'not_ready' }
  | { readonly state: 'ready'; readonly connections: number };

/**
 * What `GET /v1/operate/status` says, as far as its rows read it. Stated here
 * structurally because a package imports no app: `apps/web`'s checked
 * `OperateStatus` (`instance/operate-port.ts`) is passed in as it is, so a
 * word the port admits and this type does not is a type error at the panel.
 */
export interface OperateStatusAnswer {
  /** Whether `GET /ready` would say ready. */
  readonly ready: boolean;
  readonly checks: {
    readonly database: boolean;
    readonly migrations: OperateMigrationsWord;
    readonly rooms: boolean;
  };
  readonly version: string;
  /** The deployed commit, 40 lower-case hex, or `null` when the operator named none. */
  readonly commit: string | null;
  /** The instance runs this repository's own source, so its commit may be compared with `main`. */
  readonly upstream: boolean;
  readonly registration: OperateRegistrationMode;
  readonly uptimeSeconds: number;
  readonly disk: readonly OperateStatusDisk[];
  readonly lastBackup: OperateStatusLastBackup | null;
  readonly tunnel: OperateTunnel;
  readonly counts: {
    readonly athletes: {
      readonly active: number;
      readonly pending: number;
      readonly suspended: number;
    };
    readonly roomsOpen: number;
    readonly analysis: { readonly queued: number; readonly running: number };
  };
  readonly keys: OperateKeysWord;
}

/** A warning drawn with a row's value: its short label and its sentence. */
export interface OperateRowWarning {
  readonly label: string;
  readonly text: string;
}

/** One row of a section: what is shown, and its value in words. */
export interface OperateRow {
  readonly label: string;
  readonly value: string;
  /** The value is a machine name — the deployed commit — and is drawn as code. */
  readonly code: boolean;
  /** Drawn with the value when there is something to warn about, or `null`. */
  readonly warning: OperateRowWarning | null;
}

/** This repository, whose `main` a deployed commit is compared with. */
const REPOSITORY = 'https://github.com/openzigs/onyourleft';

const COMMIT = /^[0-9a-f]{40}$/;

/**
 * GitHub's page comparing `commit` with `main`, or `undefined` when there is
 * nothing to compare: drawn only for a full 40-hex commit of an instance
 * running this repository's source. A link the owner opens; neither the app
 * nor the instance asks GitHub anything (#2601's decision 3).
 */
export function compareWithMainUrl(
  status: Pick<OperateStatusAnswer, 'commit' | 'upstream'>,
): string | undefined {
  const { commit } = status;
  if (!status.upstream || commit === null || !COMMIT.test(commit)) return undefined;
  return `${REPOSITORY}/compare/${commit}...main`;
}

/** The compare link's words. */
export const COMPARE_WITH_MAIN_LABEL = 'Compare with main';

/** Said in place of the section when the owner's read of it did not come. */
export const STATUS_UNREADABLE_TEXT =
  'The instance’s status could not be read, so it is not shown here.';

/** Behind the section's ⓘ: what it reads, and that it changes nothing. */
export const STATUS_PURPOSE_TEXT =
  'Read from your instance as this page opened. It changes nothing on the instance, and shows ' +
  'counts and names only.';

/** Said above the rows when the instance is ready. */
export const STATUS_READY_TEXT = 'The instance is up and ready for riders.';

/** Said above the rows, as a warning, when it is not. */
export const STATUS_NOT_READY_TEXT =
  'The instance is up but not ready for riders. The checks below say which failed.';

/** The last-backup field until a snapshot is recorded (#2606). */
export const NOT_RECORDED = 'not recorded';

/**
 * Behind Status's ⓘ (#2622's review): on Docker Desktop the data volume is
 * inside Docker's virtual machine, so the instance sees that disk and never
 * the host drive under it.
 */
export const DOCKER_DESKTOP_DISK_TEXT =
  'On Docker Desktop (Windows or macOS) the disk figures are Docker’s own virtual disk, not ' +
  'the drive it is stored on. Watch that drive yourself.';

/** The tunnel's state when the operator has not said where to ask (#2601's decision 4). */
export const TUNNEL_NOT_KNOWN = 'not known';

/** Each disk's row label, by what it holds. */
export const DISK_HOLDS_TEXT: Readonly<Record<OperateStatusDisk['holds'], string>> = {
  database: 'Disk holding the database',
  blobs: 'Disk holding the blobs',
  database_and_blobs: 'Disk holding the database and blobs',
};

/** The migrations' state in words. */
export const MIGRATIONS_TEXT: Readonly<Record<OperateMigrationsWord, string>> = {
  'at-head': 'up to date',
  migrating: 'being migrated now',
  behind: 'behind this build: run migrate',
  ahead: 'ahead of this build',
  unknown: 'not known',
};

/** The instance keys' state in words. */
export const KEYS_TEXT: Readonly<Record<OperateKeysWord, string>> = {
  ready: 'ready',
  'no-secret': 'no secret key set',
  'no-origin': 'no origin set',
  'no-keys': 'no keys made yet',
  unreadable: 'not readable with the secret key set',
  busy: 'busy: an operator command holds them',
};

/** The newest backup's off-box copy, as the end of Status's last-backup sentence. */
export const LAST_BACKUP_OFF_BOX_TEXT: Readonly<Record<OperateOffBox, string>> = {
  copied: 'its off-box copy succeeded',
  failed: 'its off-box copy FAILED',
  'not-configured': 'no off-box copy is set up',
};

/** The warning a disk under a tenth free is drawn with. */
export const DISK_LOW_WARNING: OperateRowWarning = {
  label: 'Low',
  text: 'Less than a tenth of this disk is free.',
};

/** The tunnel's state in words. */
export function tunnelText(tunnel: OperateTunnel): string {
  if (tunnel.state === 'ready') {
    return `ready, ${countText(tunnel.connections, 'connection', 'connections')}`;
  }
  return tunnel.state === 'not_ready' ? 'not ready' : TUNNEL_NOT_KNOWN;
}

function row(label: string, value: string, warning: OperateRowWarning | null = null): OperateRow {
  return { label, value, code: false, warning };
}

const okText = (ok: boolean): string => (ok ? 'ok' : 'not ok');

/** One disk's row: what it holds, and how much of it is free. */
export function diskRow(disk: OperateStatusDisk): OperateRow {
  return row(
    DISK_HOLDS_TEXT[disk.holds],
    `${bytesText(disk.freeBytes)} free of ${bytesText(disk.totalBytes)}`,
    disk.low ? DISK_LOW_WARNING : null,
  );
}

/**
 * The last backup's row: when, how long ago, and its off-box copy — with a
 * warning when it is older than two of the backup service's intervals, so at
 * least one run was missed. `now` is Unix milliseconds; a backup dated after
 * it is read as just taken, never as a negative age. `timeZone` is the zone
 * its moment is drawn in ({@link momentText}).
 */
export function lastBackupRow(
  backup: OperateStatusLastBackup | null,
  now: number,
  timeZone: string,
): OperateRow {
  if (backup === null) return row('Last backup', NOT_RECORDED);
  const ageSeconds = Math.max(0, Math.floor((now - Date.parse(backup.at)) / 1000));
  const stale = ageSeconds > 2 * backup.intervalSeconds;
  return row(
    'Last backup',
    `${momentText(backup.at, timeZone)}, ${durationText(ageSeconds)} ago; ${LAST_BACKUP_OFF_BOX_TEXT[backup.offBox]}.`,
    stale
      ? {
          label: 'Stale',
          text: `That is more than twice the backup interval of ${durationText(backup.intervalSeconds)}: a backup was missed.`,
        }
      : null,
  );
}

/**
 * Every row of the Status section, in the order it is drawn. `now` is Unix
 * milliseconds, for the last backup's age; `timeZone` the zone its moment is
 * drawn in ({@link momentText}).
 */
export function statusRows(
  status: OperateStatusAnswer,
  now: number,
  timeZone: string,
): readonly OperateRow[] {
  const { athletes, analysis } = status.counts;
  return [
    row('Version', status.version),
    status.commit === null
      ? row('Deployed commit', 'not named')
      : { label: 'Deployed commit', value: status.commit, code: true, warning: null },
    row('Database', okText(status.checks.database)),
    row('Migrations', MIGRATIONS_TEXT[status.checks.migrations]),
    row('Rooms', okText(status.checks.rooms)),
    row('Up for', durationText(status.uptimeSeconds)),
    ...(status.disk.length === 0 ? [row('Disk', 'not known')] : status.disk.map(diskRow)),
    lastBackupRow(status.lastBackup, now, timeZone),
    row('Tunnel', tunnelText(status.tunnel)),
    row('Registration', REGISTRATION_MODE_TEXT[status.registration].short),
    row(
      'Accounts',
      `${String(athletes.active)} active, ${String(athletes.pending)} awaiting approval, ${String(athletes.suspended)} suspended`,
    ),
    row('Rooms open', String(status.counts.roomsOpen)),
    row('Analysis jobs', `${String(analysis.queued)} waiting, ${String(analysis.running)} running`),
    row('Instance keys', KEYS_TEXT[status.keys]),
  ];
}
