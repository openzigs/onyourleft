// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  BACK_UP_NOW_CONFIRM_TEXT,
  BACKUP_FAILED_TEXT,
  BACKUP_NOT_ASKED_TEXT,
  BACKUP_WAITING_TEXT,
  backupLine,
  BACKUPS_LIST_TEXT,
  BACKUPS_UNREADABLE_TEXT,
  backupsStaleText,
  momentText,
  NO_BACKUP_TEXT,
  NO_SNAPSHOT_TO_RESTORE_TEXT,
  OFF_BOX_FAILED_TEXT,
  RESTORE_HEADING,
  RESTORE_ONE_OFF_TEXT,
  RESTORE_PREFACE_TEXT,
  RESTORE_WHY_TEXT,
  restoreSteps,
  type OperateLine,
} from '@onyourleft/operate-text';
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

/**
 * The section's sentences and words are `@onyourleft/operate-text`'s since
 * #2644 (ADR 0069 D-7), so the instance's admin Backups page says the same.
 * Re-exported so the names this panel's tests read are the ones they read
 * before the move; the declarations are the package's alone
 * (`operate-text-moved.test.ts`).
 */
export {
  BACK_UP_NOW_CONFIRM_TEXT,
  BACKUP_NOT_ASKED_TEXT,
  BACKUP_WAITING_TEXT,
  BACKUPS_UNREADABLE_TEXT,
} from '@onyourleft/operate-text';

type Snapshot = Extract<OperateBackup, { outcome: 'done' }>;

/** The backup service's newest snapshot, or `undefined`: a one-off is not one of its runs. */
function newestServiceSnapshot(backups: OperateBackups): Snapshot | undefined {
  return backups.records.find(
    (each): each is Snapshot => each.outcome === 'done' && each.intervalSeconds !== null,
  );
}

/** One shared line, its machine names drawn as code. */
function Line({ line }: { readonly line: OperateLine }): JSX.Element {
  return (
    <>
      {line.map((part, index) =>
        typeof part === 'string' ? part : <code key={String(index)}>{part.code}</code>,
      )}
    </>
  );
}

function Row({ backup }: { readonly backup: OperateBackup }): JSX.Element {
  const { moment, rest } = backupLine(backup);
  return (
    <li>
      <strong>{moment}</strong>
      <Line line={rest} />
      {backup.outcome === 'failed' ? (
        <StatusMessage tone="warning" label="Failed">
          {BACKUP_FAILED_TEXT}
        </StatusMessage>
      ) : backup.offBox === 'failed' ? (
        <StatusMessage tone="warning" label="Off-box copy failed">
          {OFF_BOX_FAILED_TEXT}
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
        {RESTORE_HEADING}
      </SectionHeading>
      <p>{RESTORE_PREFACE_TEXT}</p>
      {chosen === undefined ? (
        <p className="oyl-muted">{NO_SNAPSHOT_TO_RESTORE_TEXT}</p>
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
                  {momentText(each.at)}: {each.snapshot}
                </option>
              ))}
            </select>
          </p>
          <ol className="oyl-operate__restore">
            {restoreSteps(chosen).map((step, index) => (
              <li key={String(index)}>
                <Line line={step} />
              </li>
            ))}
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
    // One transient failure does not drop what was last read: a request that waits goes on being
    // looked for. The first read, and any other answer (signed out, no longer the owner), stands.
    if (mounted.current)
      setRead((last) => (next.kind === 'unreachable' && last?.kind === 'backups' ? last : next));
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
      <p>{BACKUPS_LIST_TEXT}</p>
      {newest !== undefined && staleInterval !== undefined ? (
        <StatusMessage tone="warning" label="Stale">
          {backupsStaleText(newest.ageSeconds, staleInterval)}
        </StatusMessage>
      ) : null}
      {read.records.length === 0 ? (
        <p className="oyl-muted">{NO_BACKUP_TEXT}</p>
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
