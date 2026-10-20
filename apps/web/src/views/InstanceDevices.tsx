// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState, type JSX } from 'react';

import { Button } from '../design/Button';
import { StatusMessage } from '../design/StatusMessage';
import {
  AFTER_REVOKE_TEXT,
  formatDay,
  noticeText,
  REVOKE_MARK_TEXT,
  revokeMarks,
  type ListedKey,
} from '../instance/account-change-notices';
import type {
  AccountChangesOutcome,
  DevicesOutcome,
  InstanceDevice,
  InstancePort,
} from '../instance/instance-port';
import { keyFingerprint } from '../instance/sync-port';

/**
 * The Instance screen's device list (#773), with the account-change notices
 * and the marks after a revoke (#1208, ADR 0047 D-8).
 *
 * - **Every notice** the instance answers — each change another key made
 *   since THIS device last acknowledged — is shown above the list, in
 *   `account-change-notices.ts`'s words, and stays until the rider presses
 *   {@link ACCOUNT_NOTICES_TEXT.acknowledge}. That moves this device's mark
 *   only: the instance moves the mark of the session's key, never one named.
 * - **A revoke** is offered for every other live key — never this device's,
 *   which would sign it out. So it is never offered for the last key, which
 *   needs a recovery code; the instance's `last_device` is still said. Once one is revoked the list is read again and shown with
 *   `revokeMarks`' marks, {@link AFTER_REVOKE_TEXT} above it.
 *
 * ⚠️ **Every sentence here is DRAFT wording awaiting the owner's approval**
 * (ADR 0047 D-14 Q6), with #1193's in `account-change-notices.ts`.
 */

/** The words around the notices and the revoke control (draft, D-14 Q6). */
export const ACCOUNT_NOTICES_TEXT = {
  label: 'Changes to your account',
  acknowledge: 'I have read these',
  revoke: (name: string) => `Revoke ${name}`,
  confirm: (name: string) =>
    `Revoke ${name}? Its sign-ins end, and the link codes it made stop working. It cannot be added back.`,
  confirmRevoke: 'Revoke it',
  keep: 'Keep it',
} as const;

/** A day, in UTC, so the screen says the same thing wherever it is read. */
function day(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString().slice(0, 10);
}

/** How a key the rider may revoke is named on its button: as the notices name it. */
function revokeName(device: InstanceDevice): string {
  return `the key added on ${formatDay(device.addedAt)}`;
}

export function InstanceDevices({
  port,
  devices,
  changes,
  revoked,
  onRevoked,
  onAcknowledged,
}: {
  readonly port: InstancePort;
  readonly devices: DevicesOutcome | undefined;
  readonly changes: AccountChangesOutcome | undefined;
  /** The key this screen revoked, if it did: the list is then shown marked. */
  readonly revoked: string | undefined;
  /** A key was revoked: read the list and the log again, and mark it. */
  readonly onRevoked: (publicKey: string) => void;
  /** The mark moved: read the log again. */
  readonly onAcknowledged: () => void;
}): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState<string | undefined>(undefined);
  const [refusal, setRefusal] = useState<string | undefined>(undefined);

  if (devices === undefined) return <p className="oyl-muted">Reading your devices…</p>;
  if (devices.kind === 'unavailable') {
    return <StatusMessage tone="warning">{devices.text}</StatusMessage>;
  }

  const keys: readonly ListedKey[] = devices.devices;
  const thisDevice = devices.devices.find((device) => device.thisDevice)?.publicKey ?? '';
  const notices = changes?.kind === 'read' ? changes.notices : [];
  // D-8's marks, on keys a rider could still revoke: never this device, which
  // the rider is holding, and never a key already revoked.
  const marks =
    revoked === undefined || changes?.kind !== 'read'
      ? new Map<string, never>()
      : revokeMarks(keys, changes.changes, revoked);

  async function acknowledge(): Promise<void> {
    const through = Math.max(...notices.map((notice) => notice.id));
    setBusy(true);
    setRefusal(undefined);
    const outcome = await port.acknowledgeAccountChanges(through);
    setBusy(false);
    if (outcome.kind === 'unavailable') {
      setRefusal(outcome.text);
      return;
    }
    onAcknowledged();
  }

  async function revoke(publicKey: string): Promise<void> {
    setBusy(true);
    setRefusal(undefined);
    const outcome = await port.revokeDevice(publicKey);
    setBusy(false);
    setConfirming(undefined);
    if (outcome.kind === 'unavailable') {
      setRefusal(outcome.text);
      return;
    }
    onRevoked(publicKey);
  }

  return (
    <>
      {changes?.kind === 'unavailable' ? (
        <StatusMessage tone="warning" label={ACCOUNT_NOTICES_TEXT.label}>
          {changes.text}
        </StatusMessage>
      ) : null}
      {notices.length === 0 ? null : (
        <div className="oyl-instance__notices">
          <h3>{ACCOUNT_NOTICES_TEXT.label}</h3>
          <ul>
            {notices.map((notice) => (
              <li key={notice.id}>{noticeText(notice, keys, thisDevice)}</li>
            ))}
          </ul>
          <Button variant="secondary" disabled={busy} onClick={() => void acknowledge()}>
            {ACCOUNT_NOTICES_TEXT.acknowledge}
          </Button>
        </div>
      )}
      {refusal === undefined ? null : (
        <StatusMessage tone="danger" live>
          {refusal}
        </StatusMessage>
      )}
      {revoked === undefined ? null : <p>{AFTER_REVOKE_TEXT}</p>}
      <ul className="oyl-instance__devices">
        {devices.devices.map((device: InstanceDevice) => {
          const mark =
            device.thisDevice || device.revokedAt !== null
              ? undefined
              : marks.get(device.publicKey);
          // This device is live, so another live key is never the last one.
          const offered = !device.thisDevice && device.revokedAt === null;
          return (
            <li key={device.publicKey}>
              <strong>{device.thisDevice ? 'This device' : 'Another device'}</strong>{' '}
              <code>{keyFingerprint(device.publicKey)}</code>. Added {day(device.addedAt)}; last
              used {device.lastUsedAt === null ? 'never' : day(device.lastUsedAt)}
              {device.revokedAt === null ? '.' : `; removed ${day(device.revokedAt)}.`}
              {mark === undefined ? null : (
                <>
                  {' '}
                  <strong>{REVOKE_MARK_TEXT[mark]}</strong>
                </>
              )}
              {!offered ? null : confirming === device.publicKey ? (
                <span className="oyl-instance__revoke">
                  {' '}
                  {ACCOUNT_NOTICES_TEXT.confirm(revokeName(device))}{' '}
                  <Button
                    variant="danger"
                    disabled={busy}
                    onClick={() => void revoke(device.publicKey)}
                  >
                    {ACCOUNT_NOTICES_TEXT.confirmRevoke}
                  </Button>{' '}
                  <Button
                    variant="secondary"
                    disabled={busy}
                    onClick={() => {
                      setConfirming(undefined);
                    }}
                  >
                    {ACCOUNT_NOTICES_TEXT.keep}
                  </Button>
                </span>
              ) : (
                <>
                  {' '}
                  <Button
                    variant="secondary"
                    disabled={busy}
                    onClick={() => {
                      setConfirming(device.publicKey);
                    }}
                  >
                    {ACCOUNT_NOTICES_TEXT.revoke(revokeName(device))}
                  </Button>
                </>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}
