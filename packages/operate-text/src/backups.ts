// SPDX-License-Identifier: Apache-2.0

/**
 * **Backups**' words (#2607, moved by #2644, ADR 0069 D-7): the sentences the
 * Backups section says over what `GET /v1/operate/backups` returns (#2606),
 * and where the `backup` service sees a snapshot — and since #2647 each
 * record's line and the restore steps, which the app's `OperateBackupsPanel`
 * and the admin Backups page both draw.
 *
 * The instance never sends a host path, so none is named: `/backups` is the
 * folder inside the `backup` service that `OYL_BACKUP_DIR` is mounted at, and
 * a snapshot is a `snapshot-<time>` directory NAME.
 *
 * ⚠️ **Every sentence here is DRAFT wording awaiting the owner's approval.**
 */

import type { OperateLine } from './analysis';
import type { OperateOffBox, OperateRow } from './status';
import { bytesText, countText, durationText, momentText } from './words';

/** Said in place of the list when the owner's read of it did not come. */
export const BACKUPS_UNREADABLE_TEXT =
  'The backups could not be read from the instance, so they are not shown here.';

/** Said while a "back up now" waits for the `backup` service. */
export const BACKUP_WAITING_TEXT =
  'Waiting for the backup service. It takes the snapshot within 30 seconds, and this list is ' +
  'read again until it appears.';

/** Said when "back up now" was not taken for a reason other than the instance's refusal. */
export const BACKUP_NOT_ASKED_TEXT =
  'The instance did not take the request, so no backup was asked for. Try again.';

/** The confirmation's sentence: what "back up now" removes, in plain words. */
export const BACK_UP_NOW_CONFIRM_TEXT =
  'The backup service takes a snapshot within 30 seconds. It keeps the number of snapshots it ' +
  'is set to keep, so the oldest one beyond that number is removed, as a scheduled backup ' +
  'would remove it.';

/** The steps' one line: where they are run. */
export const RESTORE_PREFACE_TEXT =
  'Restore stops the instance, so it stays on the host. Run these in the folder that holds compose.yaml.';

/** Behind the steps' ⓘ: why restore is not a button, and what it puts back. */
export const RESTORE_WHY_TEXT =
  'A restore replaces everything the instance holds and needs it stopped, so the app does not ' +
  'run it. The operator log goes back to what it held when the snapshot was taken.';

/** Behind the steps' ⓘ: where a one-off snapshot is. */
export const RESTORE_ONE_OFF_TEXT =
  'A one-off snapshot, such as the one taken before a deploy, is under /backups/pre-deploy, ' +
  'and the steps say so for one.';

/** Above the list: what it is, and its order. */
export const BACKUPS_LIST_TEXT = 'The snapshots the backup service recorded, newest first.';

/** In place of the list while nothing is recorded. */
export const NO_BACKUP_TEXT = 'No backup is recorded yet.';

/** In place of the restore steps while there is no snapshot. */
export const NO_SNAPSHOT_TO_RESTORE_TEXT = 'There is no snapshot to restore yet.';

/** The warning a failed run is drawn with. */
export const BACKUP_FAILED_TEXT =
  'This backup run failed. The snapshots below it are as they were.';

/** The warning a snapshot whose off-box copy failed is drawn with. */
export const OFF_BOX_FAILED_TEXT =
  'This snapshot is only on the machine the instance runs on. Check the off-box drive or share.';

/** A snapshot's off-box copy, as one clause of its line in the list. */
export const BACKUP_OFF_BOX_TEXT: Readonly<Record<OperateOffBox, string>> = {
  copied: 'off-box copy made',
  failed: 'off-box copy FAILED',
  'not-configured': 'no off-box copy is set up',
};

/**
 * The warning the list is drawn with when the newest scheduled snapshot is
 * older than two of the backup service's intervals: at least one run was
 * missed.
 */
export function backupsStaleText(ageSeconds: number, intervalSeconds: number): string {
  return `The newest scheduled snapshot is ${durationText(ageSeconds)} old, more than twice the backup interval of ${durationText(intervalSeconds)}: a backup was missed.`;
}

/**
 * Where the `backup` service sees a snapshot: `deploy.sh` writes its one-off
 * (no interval) under `pre-deploy`.
 */
export function snapshotPlace(snapshot: {
  readonly snapshot: string;
  readonly intervalSeconds: number | null;
}): string {
  return snapshot.intervalSeconds === null
    ? `/backups/pre-deploy/${snapshot.snapshot}`
    : `/backups/${snapshot.snapshot}`;
}

/** One backup record, as far as its line in the list says it (#2647). */
export type OperateBackupLine =
  | {
      readonly outcome: 'done';
      /** ISO 8601, UTC. */
      readonly at: string;
      readonly ageSeconds: number;
      readonly snapshot: string;
      readonly rows: number;
      readonly blobs: number;
      readonly sizeBytes: number;
      readonly offBox: OperateOffBox;
      readonly intervalSeconds: number | null;
      readonly requested: boolean;
    }
  | {
      readonly outcome: 'failed';
      readonly at: string;
      readonly ageSeconds: number;
      /** A name or Node's code (`ENOSPC`), never a message. */
      readonly error: string;
      readonly intervalSeconds: number | null;
      readonly requested: boolean;
    };

/**
 * A record's line in the list (moved by #2647): when it ran, drawn strong,
 * and the rest — its age, whether the owner asked for it or it was a one-off,
 * its size, rows, blobs and off-box copy, and its directory's name; or, for a
 * failed run, the error's code.
 */
export function backupLine(backup: OperateBackupLine): {
  readonly moment: string;
  readonly rest: OperateLine;
} {
  const moment = momentText(backup.at);
  const age = `${durationText(backup.ageSeconds)} ago`;
  if (backup.outcome === 'failed') {
    return { moment, rest: [`, ${age}: no snapshot was made (`, { code: backup.error }, ').'] };
  }
  const asked = backup.requested ? ', asked for from the app' : '';
  const oneOff = backup.intervalSeconds === null ? ', a one-off' : '';
  return {
    moment,
    rest: [
      `, ${age}${asked}${oneOff}: ${bytesText(backup.sizeBytes)}, ${countText(backup.rows, 'row', 'rows')}, ${countText(backup.blobs, 'blob', 'blobs')}; ${BACKUP_OFF_BOX_TEXT[backup.offBox]}. `,
      { code: backup.snapshot },
    ],
  };
}

/** The heading over the restore steps. */
export const RESTORE_HEADING = 'Restoring a snapshot';

/**
 * The restore steps for one snapshot (moved by #2647): the home deployment's
 * commands from `docs/operating-an-instance.md` §"Restore", with the
 * snapshot's place filled in. Run on the host; never by the app or a page.
 */
export function restoreSteps(snapshot: {
  readonly snapshot: string;
  readonly intervalSeconds: number | null;
  readonly rows: number;
  readonly blobs: number;
}): readonly OperateLine[] {
  return [
    ['Stop the instance and the backup service: ', { code: 'docker compose stop instance backup' }],
    [
      'Restore the snapshot. ',
      { code: '--force' },
      ' writes over the data that is there now; without it the restore refuses: ',
      {
        code: `docker compose run --rm --no-deps --entrypoint node backup src/operator/cli.ts restore ${snapshotPlace(snapshot)} --force`,
      },
    ],
    [
      'A restore rotates the instance’s encryption key as its last step, but the backup service holds no secret key, so rotate it in the instance service: ',
      {
        code: 'docker compose run --rm --no-deps -T instance node src/operator/cli.ts instance-key rotate',
      },
    ],
    [
      `Check what is in place: it should say ${countText(snapshot.rows, 'row', 'rows')} and ${countText(snapshot.blobs, 'blob', 'blobs')}. `,
      { code: 'docker compose run --rm --no-deps -T instance node src/operator/cli.ts verify' },
    ],
    ['Start them again: ', { code: 'docker compose up -d instance backup' }],
  ];
}

/** A record's further facts, as the route answers them (#2647): the admin page draws them under its line. */
export interface OperateBackupFacts {
  readonly databaseSha256: string | null;
  readonly removed: number | null;
  readonly freeBytes: { readonly backups: number | null; readonly offBox: number | null };
  readonly intervalSeconds: number | null;
}

/** The facts of a record beyond its line, as rows: what the route answers and the line does not say. */
export function backupFactRows(facts: OperateBackupFacts): readonly OperateRow[] {
  const row = (label: string, value: string, code = false): OperateRow => ({
    label,
    value,
    code,
    warning: null,
  });
  const free = (bytes: number | null): string =>
    bytes === null ? 'not recorded' : `${bytesText(bytes)} free`;
  return [
    ...(facts.databaseSha256 === null ? [] : [row('Database SHA-256', facts.databaseSha256, true)]),
    row('Old snapshots removed', facts.removed === null ? 'not recorded' : String(facts.removed)),
    row('Where snapshots go', free(facts.freeBytes.backups)),
    row('Where off-box copies go', free(facts.freeBytes.offBox)),
    row(
      'Backup interval',
      facts.intervalSeconds === null
        ? 'a one-off run'
        : `every ${durationText(facts.intervalSeconds)}`,
    ),
  ];
}
