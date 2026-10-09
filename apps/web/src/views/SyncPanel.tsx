// SPDX-License-Identifier: AGPL-3.0-or-later

import { useId, useState, type JSX } from 'react';

import { Button } from '../design/Button';
import { ConfirmDialog } from '../design/ConfirmDialog';
import { StatusMessage } from '../design/StatusMessage';
import type { SyncReport } from '../instance/sync';
import { keyFingerprint, type SyncOutcome, type SyncPort } from '../instance/sync-port';

/**
 * The Instance screen's sync panel (#1195): the one control that syncs this
 * device with its instance, what the last sync did, and the question a sync
 * raises when another device's key signed a ride — is it yours?
 *
 * ## Nothing for a rider with no instance
 *
 * {@link SyncPort.availability} is `none` with no instance account on this
 * device, and this panel then renders NOTHING: no control, no sentence, no
 * request. It is drawn only by the connected Instance screen in any case.
 *
 * ## A key is admitted only after the rider confirms it
 *
 * A key the instance listed is a question here, never an answer:
 * {@link SyncPort.admitKey} is called from the confirmation dialog's own
 * confirm and from nowhere else, and the dialog opens on *Keep it untrusted*.
 *
 * Every sentence here is the wording the owner approved on 2026-10-09 (#1195).
 */

/** The panel's heading. */
export const SYNC_HEADING = 'Sync';

/** What the control does, said beside it. */
export const SYNC_LEAD =
  'Sync sends this device’s rides, and what goes with them, to this instance, sealed for it ' +
  'alone, and brings back what your other devices sent there. Everything stays on this device ' +
  'too, and a ride you deleted here is deleted there, never brought back.';

/** The control. */
export const SYNC_CONTROL_LABEL = 'Sync now';

/** While it runs. */
export const SYNC_RUNNING_TEXT = 'Syncing…';

/** The partial-failure sentence. */
export function syncFailuresText(count: number): string {
  return count === 1
    ? 'One thing did not sync. Nothing on this device was changed by it, and the next sync tries it again.'
    : `${String(count)} things did not sync. Nothing on this device was changed by them, and the ` +
        'next sync tries them again.';
}

/** The key question's heading and lead. */
export const KEYS_HEADING = 'Rides signed by a device this one does not know';
export const KEYS_LEAD =
  'Another device signed rides on your account, and this device has not been told it is yours, ' +
  'so it did not take them. Open the Instance screen on your other device: in its list of your ' +
  'devices, the line marked This device shows a code. Trust a device only if its code is the ' +
  'same as the one here.';
export const ADMIT_CONTROL_LABEL = 'This is one of my devices';
export const ADMIT_CONFIRM_LABEL = 'Trust this device';
export const ADMIT_CANCEL_LABEL = 'Keep it untrusted';
export function admitConfirmTitle(fingerprint: string): string {
  return `Trust the device ${fingerprint}?`;
}
export const ADMIT_CONFIRM_BODY =
  'Only if you checked that your other device shows this same code. Its rides come to this ' +
  'device at the next sync.';
export const ADMITTED_TEXT = 'Trusted. Sync again to bring its rides to this device.';

/** One line per count that is not nothing: what the last sync did. */
export function syncReportLines(report: SyncReport): readonly string[] {
  const lines: string[] = [];
  const count = (n: number, one: string, many: string): string =>
    n === 1 ? one : many.replace('{n}', String(n));
  if (report.pushed > 0) lines.push(count(report.pushed, 'Sent 1 ride.', 'Sent {n} rides.'));
  if (report.pulled > 0) {
    lines.push(count(report.pulled, 'Brought back 1 ride.', 'Brought back {n} rides.'));
  }
  const items = report.itemsPushed + report.itemsPulled;
  if (items > 0) {
    lines.push(
      count(
        items,
        'Synced 1 write-up or side-camera report.',
        'Synced {n} write-ups and side-camera reports.',
      ),
    );
  }
  const texts = report.textsPushed + report.textsPulled;
  if (texts > 0) {
    lines.push(
      count(texts, 'Synced 1 goal, note or document.', 'Synced {n} goals, notes and documents.'),
    );
  }
  if (report.textConflicts > 0) {
    lines.push(
      count(
        report.textConflicts,
        'One text was changed here and on another device: the other version is kept as a new document named “(from another device)”.',
        '{n} texts were changed here and on another device: each other version is kept as a new document named “(from another device)”.',
      ),
    );
  }
  const deleted = report.deletedOnInstance + report.textsDeletedOnInstance;
  if (deleted > 0) {
    lines.push(
      count(
        deleted,
        'Deleted 1 thing on the instance that you deleted here.',
        'Deleted {n} things on the instance that you deleted here.',
      ),
    );
  }
  const hidden = report.hiddenOnInstance + report.textsHiddenOnInstance;
  if (hidden > 0) {
    lines.push(
      count(
        hidden,
        'Another device deleted 1 thing you still have here. It stays on this device.',
        'Another device deleted {n} things you still have here. They stay on this device.',
      ),
    );
  }
  if (lines.length === 0) lines.push('Everything was already in sync.');
  return lines;
}

export function SyncPanel({ port }: { readonly port: SyncPort }): JSX.Element | null {
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<SyncOutcome | undefined>(undefined);
  const [confirming, setConfirming] = useState<string | undefined>(undefined);
  const [admitted, setAdmitted] = useState<readonly string[]>([]);
  const [admitRefusal, setAdmitRefusal] = useState<string | undefined>(undefined);
  const headingId = useId();
  const keysHeadingId = useId();

  const availability = port.availability();
  if (availability.kind === 'none') return null;

  async function sync(): Promise<void> {
    setBusy(true);
    setAdmitRefusal(undefined);
    const next = await port.sync();
    setBusy(false);
    setOutcome(next);
    setAdmitted([]);
  }

  async function admit(publicKey: string): Promise<void> {
    const answer = await port.admitKey(publicKey);
    if (answer.kind === 'admitted') {
      setAdmitted((held) => [...held, publicKey]);
      setAdmitRefusal(undefined);
    } else {
      setAdmitRefusal(answer.text);
    }
  }

  const report = outcome?.kind === 'synced' ? outcome.report : undefined;
  return (
    <section className="oyl-panel" aria-labelledby={headingId}>
      <h2 id={headingId}>{SYNC_HEADING}</h2>
      {availability.kind === 'closed' ? (
        <StatusMessage tone="warning" label="Sync needs the card">
          {availability.text}
        </StatusMessage>
      ) : (
        <>
          <p className="oyl-ride__actions">
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => {
                void sync();
              }}
            >
              {SYNC_CONTROL_LABEL}
            </Button>
          </p>
          <p className="oyl-muted">{SYNC_LEAD}</p>
          <div role="status">
            {busy ? <p>{SYNC_RUNNING_TEXT}</p> : null}
            {outcome?.kind === 'refused' ? (
              <StatusMessage tone="danger" label="Not synced">
                {outcome.text}
              </StatusMessage>
            ) : null}
            {report === undefined ? null : (
              <ul className="oyl-instance__sync-report">
                {syncReportLines(report).map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            )}
            {report === undefined || report.failures.length === 0 ? null : (
              <StatusMessage tone="warning" label="Partly synced">
                {syncFailuresText(report.failures.length)}
              </StatusMessage>
            )}
          </div>
          {report === undefined || report.keysToConfirm.length === 0 ? null : (
            <section aria-labelledby={keysHeadingId}>
              <h3 id={keysHeadingId}>{KEYS_HEADING}</h3>
              <p>{KEYS_LEAD}</p>
              <ul className="oyl-instance__devices">
                {report.keysToConfirm.map((publicKey) => (
                  <li key={publicKey}>
                    <code>{keyFingerprint(publicKey)}</code>{' '}
                    {admitted.includes(publicKey) ? (
                      <span>{ADMITTED_TEXT}</span>
                    ) : (
                      <Button
                        variant="secondary"
                        onClick={() => {
                          setConfirming(publicKey);
                        }}
                      >
                        {ADMIT_CONTROL_LABEL}
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
              {admitRefusal === undefined ? null : (
                <StatusMessage tone="danger" label="Not trusted">
                  {admitRefusal}
                </StatusMessage>
              )}
            </section>
          )}
          <ConfirmDialog
            open={confirming !== undefined}
            onOpenChange={(open) => {
              if (!open) setConfirming(undefined);
            }}
            title={admitConfirmTitle(keyFingerprint(confirming ?? ''))}
            confirmLabel={ADMIT_CONFIRM_LABEL}
            cancelLabel={ADMIT_CANCEL_LABEL}
            onConfirm={() => (confirming === undefined ? undefined : admit(confirming))}
          >
            <p>{ADMIT_CONFIRM_BODY}</p>
          </ConfirmDialog>
        </>
      )}
    </section>
  );
}
