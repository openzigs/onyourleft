// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useEffect, useRef, useState, type JSX } from 'react';

import { Button } from '../design/Button';
import { ConfirmDialog } from '../design/ConfirmDialog';
import { SectionHeading } from '../design/SectionHelp';
import { StatusMessage } from '../design/StatusMessage';
import type {
  OperateBackup,
  OperateBackUpNow,
  OperateBackups,
  OperateBackupsRead,
  OperatePort,
} from '../instance/operate-port';
import { bytesText, durationText } from './OperateStatusPanel';

/**
 * **Backups** (#2607, epic #2601): the third section of the owner's Operate
 * area, over the records the `backup` service writes (#2606,
 * `GET /v1/operate/backups`) and its "back up now" (`POST`).
 *
 * ## What is shown is read back
 *
 * The list is the port's read of the instance, never edited in place. After
 * "back up now" the panel reads it again, and while the instance says a
 * request is waiting the button is replaced by a sentence saying so and the
 * list is read again every {@link BACKUPS_REREAD_MILLISECONDS} until the
 * request is served — so the snapshot that appears is the instance's record of
 * it, and a request the instance accepted and never served shows nothing new.
 *
 * ## Restore is steps, not a button
 *
 * Restore replaces everything the instance holds and stops it, so it stays on
 * the operator's CLI: the port has no restore and the instance no route for
 * one. This section shows `docs/operating-an-instance.md` §"Restore" as the
 * home deployment's commands, with the chosen snapshot's directory NAME filled
 * in. The instance never sends a host path, so none is shown: `/backups` is
 * the folder inside the `backup` service that `OYL_BACKUP_DIR` is mounted at.
 * The snapshot picker sends nothing; "Back up now" is the section's only
 * control that does.
 *
 * ⚠️ **Every sentence here is DRAFT wording awaiting the owner's approval.**
 */

/** How often the list is read again while a "back up now" waits: the service looks every 30 s. */
export const BACKUPS_REREAD_MILLISECONDS = 5_000;

/** Run `tick` every `milliseconds` until the returned function is called. */
export type Every = (milliseconds: number, tick: () => void) => () => void;

const everyInterval: Every = (milliseconds, tick) => {
  const handle = setInterval(tick, milliseconds);
  return () => {
    clearInterval(handle);
  };
};

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

const OFF_BOX_TEXT: Readonly<
  Record<Extract<OperateBackup, { outcome: 'done' }>['offBox'], string>
> = {
  copied: 'off-box copy made',
  failed: 'off-box copy FAILED',
  'not-configured': 'no off-box copy is set up',
};

/** A moment, in UTC, so the screen says the same thing wherever it is read. */
function when(iso: string): string {
  return `${iso.slice(0, 16).replace('T', ' ')} UTC`;
}

function count(value: number, one: string, many: string): string {
  return `${String(value)} ${value === 1 ? one : many}`;
}

type Snapshot = Extract<OperateBackup, { outcome: 'done' }>;

/** The backup service's newest snapshot, or `undefined`: a one-off is not one of its runs. */
function newestServiceSnapshot(backups: OperateBackups): Snapshot | undefined {
  return backups.records.find(
    (each): each is Snapshot => each.outcome === 'done' && each.intervalSeconds !== null,
  );
}

/** Where the `backup` service sees a snapshot: deploy.sh writes its one-off under `pre-deploy`. */
export function snapshotPlace(snapshot: Snapshot): string {
  return snapshot.intervalSeconds === null
    ? `/backups/pre-deploy/${snapshot.snapshot}`
    : `/backups/${snapshot.snapshot}`;
}

function Row({ backup }: { readonly backup: OperateBackup }): JSX.Element {
  const age = `${durationText(backup.ageSeconds)} ago`;
  if (backup.outcome === 'failed') {
    return (
      <li>
        <strong>{when(backup.at)}</strong>, {age}: no snapshot was made (<code>{backup.error}</code>
        ).
        <StatusMessage tone="warning" label="Failed">
          This backup run failed. The snapshots below it are as they were.
        </StatusMessage>
      </li>
    );
  }
  return (
    <li>
      <strong>{when(backup.at)}</strong>, {age}
      {backup.requested ? ', asked for from the app' : ''}
      {backup.intervalSeconds === null ? ', a one-off' : ''}: {bytesText(backup.sizeBytes)},{' '}
      {count(backup.rows, 'row', 'rows')}, {count(backup.blobs, 'blob', 'blobs')};{' '}
      {OFF_BOX_TEXT[backup.offBox]}. <code>{backup.snapshot}</code>
      {backup.offBox === 'failed' ? (
        <StatusMessage tone="warning" label="Off-box copy failed">
          This snapshot is only on the machine the instance runs on. Check the off-box drive or
          share.
        </StatusMessage>
      ) : null}
    </li>
  );
}

function RestoreSteps({ snapshots }: { readonly snapshots: readonly Snapshot[] }): JSX.Element {
  const [chosenId, setChosenId] = useState<number | undefined>(undefined);
  const chosen = snapshots.find((each) => each.id === chosenId) ?? snapshots[0];
  return (
    <section aria-labelledby="oyl-operate-restore">
      <SectionHeading
        level={3}
        id="oyl-operate-restore"
        help={
          <>
            <p>{RESTORE_WHY_TEXT}</p>
            <p>{RESTORE_ONE_OFF_TEXT}</p>
          </>
        }
      >
        Restoring a snapshot
      </SectionHeading>
      <p>{RESTORE_PREFACE_TEXT}</p>
      {chosen === undefined ? (
        <p className="oyl-muted">There is no snapshot to restore yet.</p>
      ) : (
        <>
          <p>
            <label htmlFor="oyl-operate-restore-snapshot">Snapshot to restore</label>{' '}
            <select
              className="oyl-input oyl-input--block"
              id="oyl-operate-restore-snapshot"
              value={String(chosen.id)}
              onChange={(event) => {
                setChosenId(Number(event.target.value));
              }}
            >
              {snapshots.map((each) => (
                <option key={each.id} value={String(each.id)}>
                  {when(each.at)}: {each.snapshot}
                </option>
              ))}
            </select>
          </p>
          <ol className="oyl-operate__restore">
            <li>
              Stop the instance and the backup service:{' '}
              <code>docker compose stop instance backup</code>
            </li>
            <li>
              Restore the snapshot. <code>--force</code> writes over the data that is there now;
              without it the restore refuses:{' '}
              <code>
                {`docker compose run --rm --no-deps --entrypoint node backup src/operator/cli.ts restore ${snapshotPlace(chosen)} --force`}
              </code>
            </li>
            <li>
              A restore rotates the instance’s encryption key as its last step, but the backup
              service holds no secret key, so rotate it in the instance service:{' '}
              <code>
                docker compose run --rm --no-deps -T instance node src/operator/cli.ts instance-key
                rotate
              </code>
            </li>
            <li>
              Check what is in place: it should say {count(chosen.rows, 'row', 'rows')} and{' '}
              {count(chosen.blobs, 'blob', 'blobs')}.{' '}
              <code>
                docker compose run --rm --no-deps -T instance node src/operator/cli.ts verify
              </code>
            </li>
            <li>
              Start them again: <code>docker compose up -d instance backup</code>
            </li>
          </ol>
        </>
      )}
    </section>
  );
}

/** The Backups section: the snapshots, "back up now", and the steps of a restore. */
export function OperateBackupsPanel({
  port,
  every = everyInterval,
}: {
  readonly port: Pick<OperatePort, 'backups' | 'backUpNow'>;
  /** The clock the list is read again on while a request waits. */
  readonly every?: Every;
}): JSX.Element {
  const [read, setRead] = useState<OperateBackupsRead | undefined>(undefined);
  const [confirming, setConfirming] = useState(false);
  /** What the last "back up now" came to, when it was not a request the instance took. */
  const [asked, setAsked] = useState<Exclude<OperateBackUpNow, { kind: 'requested' }> | undefined>(
    undefined,
  );
  const mounted = useRef(true);
  const waitingRef = useRef<HTMLDivElement>(null);

  const reread = useCallback(async (): Promise<void> => {
    const next = await port.backups();
    if (mounted.current) setRead(next);
  }, [port]);

  useEffect(() => {
    mounted.current = true;
    void reread();
    return () => {
      mounted.current = false;
    };
  }, [reread]);

  const waiting = read?.kind === 'backups' && read.pendingSince !== null;
  useEffect(() => {
    if (!waiting) return undefined;
    return every(BACKUPS_REREAD_MILLISECONDS, () => {
      void reread();
    });
  }, [waiting, every, reread]);

  async function backUpNow(): Promise<void> {
    const answer = await port.backUpNow();
    if (!mounted.current) return;
    if (answer.kind !== 'requested') {
      // Refused or not taken: the list is left as it was read.
      setAsked(answer);
      return;
    }
    setAsked(undefined);
    await reread();
  }

  if (read === undefined) {
    return (
      <section className="oyl-panel" aria-labelledby="oyl-operate-backups">
        <h2 id="oyl-operate-backups">Backups</h2>
        <p className="oyl-muted">Reading the backups…</p>
      </section>
    );
  }
  if (read.kind !== 'backups') {
    return (
      <section className="oyl-panel" aria-labelledby="oyl-operate-backups">
        <h2 id="oyl-operate-backups">Backups</h2>
        <StatusMessage tone="warning" label="Not read" live>
          {BACKUPS_UNREADABLE_TEXT}
        </StatusMessage>
      </section>
    );
  }
  const newest = newestServiceSnapshot(read);
  // Older than two of the backup service's intervals: at least one run was missed.
  const staleInterval =
    newest !== undefined &&
    newest.intervalSeconds !== null &&
    newest.ageSeconds > 2 * newest.intervalSeconds
      ? newest.intervalSeconds
      : undefined;
  const snapshots = read.records.filter((each): each is Snapshot => each.outcome === 'done');
  return (
    <section className="oyl-panel" aria-labelledby="oyl-operate-backups">
      <h2 id="oyl-operate-backups">Backups</h2>
      {waiting ? (
        <div ref={waitingRef} tabIndex={-1}>
          <StatusMessage tone="info" label="Waiting" live>
            {BACKUP_WAITING_TEXT}
          </StatusMessage>
        </div>
      ) : (
        <p>
          <Button
            variant="secondary"
            onClick={() => {
              setConfirming(true);
            }}
          >
            Back up now
          </Button>
        </p>
      )}
      {asked === undefined ? null : (
        <StatusMessage tone="warning" label="Not asked" live>
          {asked.kind === 'refused' ? asked.sentence : BACKUP_NOT_ASKED_TEXT}
        </StatusMessage>
      )}
      <p>The snapshots the backup service recorded, newest first.</p>
      {newest !== undefined && staleInterval !== undefined ? (
        <StatusMessage tone="warning" label="Stale">
          {`The newest scheduled snapshot is ${durationText(newest.ageSeconds)} old, more than twice the backup interval of ${durationText(staleInterval)}: a backup was missed.`}
        </StatusMessage>
      ) : null}
      {read.records.length === 0 ? (
        <p className="oyl-muted">No backup is recorded yet.</p>
      ) : (
        <ol className="oyl-operate__backups">
          {read.records.map((backup) => (
            <Row key={backup.id} backup={backup} />
          ))}
        </ol>
      )}
      <RestoreSteps snapshots={snapshots} />
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Back up now?"
        confirmLabel="Back up now"
        cancelLabel="Not now"
        onConfirm={backUpNow}
        onClosed={() => {
          // The button the dialog was opened from is gone while a request waits.
          if (waitingRef.current === null) return false;
          waitingRef.current.focus();
          return true;
        }}
      >
        <p>{BACK_UP_NOW_CONFIRM_TEXT}</p>
      </ConfirmDialog>
    </section>
  );
}
