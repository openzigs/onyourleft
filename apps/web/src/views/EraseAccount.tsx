// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState, type JSX } from 'react';

import { Button } from '../design/Button';
import { StatusMessage } from '../design/StatusMessage';
import type { StatementsPort } from '../instance/statements-port';
import { ERASE_ACCOUNT_TEXT } from './erase-account-text';

export { ERASE_ACCOUNT_TEXT } from './erase-account-text';

/**
 * **Deleting your account on an instance, from the app** (#906 item 3, Google
 * Play's account-deletion requirement). The account is created at *Connect*,
 * so the app that created it must offer to delete it.
 *
 * {@link EraseAccountControl} is the press and its confirmation, shared by
 * the Instance screen's {@link EraseAccountPanel} (a rider who is signed in)
 * and `StatementsPanel`'s *Your data on this instance* (a suspended rider,
 * #1517). Both call `StatementsPort.eraseAccount`: `DELETE /v1/account` with
 * the step-up the instance requires, a statement signed just now by this
 * device's key (#898 item 2). ⚠️ It deletes nothing on this device (ADR 0036
 * D-3 (b)); once the instance has deleted the account, the device forgets its
 * sign-in there, as *Disconnect* does.
 *
 * ⚠️ Rider-facing wording, quoted in the pull request for the owner's approval.
 */

/** The press's words, which differ between a signed-in rider and a suspended one. */
export interface EraseAccountWords {
  readonly erase: string;
  readonly confirm: string;
  readonly confirmErase: string;
  readonly keep: string;
}

/** The press, a confirmation, and what the instance answered. */
export function EraseAccountControl({
  port,
  words,
  onErased,
}: {
  readonly port: Pick<StatementsPort, 'eraseAccount'>;
  readonly words: EraseAccountWords;
  /** The account is gone and this device no longer holds its sign-in. */
  readonly onErased: () => void;
}): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [refusal, setRefusal] = useState<string | undefined>(undefined);
  return (
    <>
      {confirming ? (
        <>
          <p>{words.confirm}</p>
          <Button
            variant="danger"
            unavailable={busy}
            onClick={() => {
              if (busy) return;
              setBusy(true);
              void port.eraseAccount().then((outcome) => {
                setBusy(false);
                if (outcome.kind === 'erased') {
                  onErased();
                } else {
                  setRefusal(outcome.text);
                }
              });
            }}
          >
            {words.confirmErase}
          </Button>{' '}
          <Button
            variant="secondary"
            unavailable={busy}
            onClick={() => {
              // The DELETE is already sent: the confirmation stays until its
              // answer, so *Keep* can never be followed by "deleted".
              if (busy) return;
              setConfirming(false);
              setRefusal(undefined);
            }}
          >
            {words.keep}
          </Button>
        </>
      ) : (
        <p>
          <Button
            variant="danger"
            onClick={() => {
              setConfirming(true);
            }}
          >
            {words.erase}
          </Button>
        </p>
      )}
      {refusal === undefined ? null : (
        <StatusMessage tone="warning" label="Not deleted" live>
          {refusal}
        </StatusMessage>
      )}
    </>
  );
}

/** The Instance screen's section, drawn for a rider who is signed in (#906). */
export function EraseAccountPanel({
  port,
  onErased,
}: {
  readonly port: Pick<StatementsPort, 'eraseAccount'>;
  readonly onErased: () => void;
}): JSX.Element {
  return (
    <section className="oyl-panel" aria-labelledby="oyl-instance-erase">
      <h2 id="oyl-instance-erase">{ERASE_ACCOUNT_TEXT.heading}</h2>
      <p>{ERASE_ACCOUNT_TEXT.intro}</p>
      <EraseAccountControl port={port} words={ERASE_ACCOUNT_TEXT} onErased={onErased} />
    </section>
  );
}
